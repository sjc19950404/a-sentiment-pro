"""candidate_pool.py — 候选池数据层（基于 market_data，2026-10-10 数据层迁移第一阶段）

流程（用户口径）：
  全市场扫描   scan_full_market()          → fetch_full_market_snapshot()（一次批量请求，禁止逐只）
  候选池构建   build_candidate_pool(df)     → v4 趋势轨条件镜像（3-7% 启动带 / 量比>2 / 主力净流入
                                              为正 / 非涨停 / 剔 ST·退市·北交所）——判据权威仍在
                                              src/ai_report.js，此处为 Python 侧同口径数据工具
  二次校验     revalidate_candidates(sym)  → fetch_candidate_quotes()（QuantDash 批量行情）
  空数据阻断    ——快照/校验为空即 raise EmptyDataError，绝不带脏数据进信号层

CLI：
  python candidate_pool.py smoke               # 四项冒烟（快照/候选池/历史日线/降级日志）
  python candidate_pool.py scan                # 全市场扫描 + 候选池构建，stdout JSON
  python candidate_pool.py watch --interval 60  # 盘中 30-60s 周期扫描 → data/intraday_scan.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

from market_data import (EmptyDataError, fetch_candidate_quotes, fetch_full_market_snapshot,
                         fetch_history_daily, fetch_main_net_screener, fetch_zt_pools,
                         log_degrade, normalize_snapshot, take_degradations)

ROOT = Path(__file__).resolve().parent
BJ = ZoneInfo('Asia/Shanghai')

# v4 趋势轨条件镜像（与 src/ai_report.js 同口径；调整须两处同步）
DEFAULTS = {
    'min_chg': 3.0,          # 启动带下沿
    'max_chg': 7.0,          # 启动带上沿
    'min_liangbi': 2.0,      # 量比 > 2
    'main_net_required': True,   # 主力净流入为正（缺数据 = 核验不了 = 不入选；unverified 模式除外）
}


def scan_full_market() -> pd.DataFrame:
    """全市场扫描（批量一次请求）。返回 normalize 后的快照——空数据在 market_data 层已硬阻断。"""
    return fetch_full_market_snapshot()


def _is_excluded_name(name) -> bool:
    if name is None or pd.isna(name):
        return False
    n = str(name)
    return 'ST' in n.upper() or '退' in n


def build_candidate_pool(df: pd.DataFrame, *, main_net_map: dict | None = None,
                         zt_codes: set | None = None, unverified_main_net: bool = False,
                         **overrides) -> tuple[pd.DataFrame, dict]:
    """候选池构建（v4 趋势轨条件镜像）。

    - main_net_map 给定：主力净流入为正硬条件（缺席代码 = 核验不了 = 剔除，宁缺毋假）；
    - unverified_main_net=True：主力量缺失时的降级模式——跳过该条件，但 basis 明示
      `main_net_unverified: true`（正式策略层不得在未核验时采信，本模式仅供数据巡检）。
    返回 (候选 DataFrame, basis 口径台账)。
    """
    cfg = {**DEFAULTS, **overrides}
    basis = {'conditions': {**cfg, 'main_net_unverified': unverified_main_net},
             'excluded': {}, 'input_rows': int(len(df)), 'source': df.attrs.get('source')}
    if df is None or df.empty:
        raise EmptyDataError('build_candidate_pool: 输入快照为空（前置阻断失效，拒绝执行）')
    pool = df.copy()

    m_st = pool['name'].map(_is_excluded_name)
    basis['excluded']['st_or_delisting'] = int(m_st.sum())
    pool = pool[~m_st]

    m_bj = pool['symbol'].str.startswith(('4', '8', '92'))
    basis['excluded']['bse'] = int(m_bj.sum())
    pool = pool[~m_bj]

    if zt_codes:
        m_zt = pool['symbol'].isin(set(zt_codes))
        basis['excluded']['limit_up_today'] = int(m_zt.sum())
        pool = pool[~m_zt]
    else:
        basis['excluded']['limit_up_today'] = None      # 涨停名单缺席 = 未过滤，如实标注

    pool = pool[pool['change_pct'].notna()]
    pool = pool[(pool['change_pct'] >= cfg['min_chg']) & (pool['change_pct'] <= cfg['max_chg'])]
    basis['excluded']['out_of_band'] = basis['input_rows'] - int(len(pool)) \
        - sum(v or 0 for k, v in basis['excluded'].items() if k != 'out_of_band' and v is not None)

    pool = pool[pool['liangbi'].notna() & (pool['liangbi'] > cfg['min_liangbi'])]
    if main_net_map is not None:
        pool = pool.copy()
        pool['main_net'] = pool['symbol'].map(lambda c: main_net_map.get(str(c)))
        verified = pool['main_net'].notna()
        basis['excluded']['main_net_uncheckable'] = int((~verified).sum())
        pool = pool[verified & (pool['main_net'] > 0)]
    elif cfg['main_net_required'] and not unverified_main_net:
        raise EmptyDataError('主力净流入榜缺席且未开启 unverified 模式——硬条件核验不了，宁缺毋假')
    return pool.reset_index(drop=True), basis


def revalidate_candidates(symbols: list[str]) -> pd.DataFrame:
    """候选池二次校验：QuantDash 批量行情 → normalize（内部空数据硬阻断）。"""
    df = fetch_candidate_quotes(symbols)
    missing = sorted(set(str(s) for s in symbols) - set(df['symbol']))
    if missing:
        log_degrade('revalidate → partial', f'{len(missing)} 只缺席: {missing[:8]}…')
    return df


def _json_safe(df: pd.DataFrame) -> list[dict]:
    out = []
    for _, r in df.iterrows():
        row = {}
        for c in df.columns:
            v = r[c]
            row[c] = None if pd.isna(v) else (v.item() if hasattr(v, 'item') else v)
        out.append(row)
    return out


def _scan_once(unverified: bool = False) -> dict:
    snap = scan_full_market()
    zt = fetch_zt_pools(datetime.now(BJ).strftime('%Y%m%d'))
    main_map, screener = fetch_main_net_screener()
    pool, basis = build_candidate_pool(
        snap, main_net_map=(main_map or None),
        zt_codes=set(zt['zt_codes'] or []) if zt else None,
        unverified_main_net=unverified and not main_map)
    top = pool.head(20)
    if len(top):
        revalidate_candidates(top['symbol'].tolist())      # 二次校验（QuantDash 批量）
    return {'generatedAt': datetime.now(BJ).isoformat(timespec='seconds'),
            'snapshot': {'source': basis['source'], 'rows': int(len(snap))},
            'candidatePool': {'count': int(len(pool)), 'basis': basis,
                              'top20': _json_safe(top)},
            'screenerRows': len(screener or []),
            'degradations': take_degradations()}


def cmd_smoke() -> int:
    print('══ 冒烟 1/4：全市场快照非空 ══')
    try:
        t0 = time.time()
        snap = scan_full_market()
        print(f'  PASS · {len(snap)} 行 · 源={snap.attrs.get("source")} · {time.time() - t0:.1f}s')
        ok1 = True
    except Exception as e:
        print(f'  FAIL · {type(e).__name__}: {e}')
        ok1 = False

    print('══ 冒烟 2/4：候选池生成 + 二次校验 ══')
    try:
        t0 = time.time()
        snap2 = scan_full_market()      # 自包含：不依赖检查 1 的变量（缓存命中零成本）
        zt = fetch_zt_pools(datetime.now(BJ).strftime('%Y%m%d'))
        main_map, screener = fetch_main_net_screener()
        pool, basis = build_candidate_pool(
            snap2, main_net_map=(main_map or None),
            zt_codes=set(zt['zt_codes'] or []) if zt else None,
            unverified_main_net=not main_map)
        revalidated = revalidate_candidates(pool.head(10)['symbol'].tolist()) if len(pool) else None
        print(f'  PASS · 候选 {len(pool)} 只 · 源={basis["source"]} · main_net_unverified='
              f'{basis["conditions"].get("main_net_unverified")} · 二次校验 '
              f'{len(revalidated) if revalidated is not None else 0}/{min(10, len(pool))} · {time.time() - t0:.1f}s'
              + ('（候选 0 = 量比/主力净流入本地不可核验——宁缺毋假，CI 全源下非零）' if len(pool) == 0 else ''))
        ok2 = True
    except Exception as e:
        print(f'  FAIL · {type(e).__name__}: {e}')
        ok2 = False

    print('══ 冒烟 3/4：BaoStock 历史日线 ══')
    try:
        hist = fetch_history_daily('sh.600519', '2026-10-01', '2026-10-10')
        print(f'  PASS · {len(hist)} 根 · 末日 {hist.iloc[-1]["date"]} 收盘 {hist.iloc[-1]["close"]}')
        ok3 = True
    except Exception as e:
        print(f'  FAIL · {type(e).__name__}: {e}')
        ok3 = False

    print('══ 冒烟 4/4：异常降级日志 ══')
    degrades = take_degradations()
    for d in degrades[:6]:
        print(f'  [degrade] {d["chain"]} ← {d["reason"][:120]}')
    print(f'  {"PASS" if isinstance(degrades, list) else "FAIL"} · 本轮降级记录 {len(degrades)} 条'
          + ('（链路正常时为 0——本地墙内网络应有 quantdash-universe→akshare→qd-symbols 链）' if not degrades else ''))
    ok4 = isinstance(degrades, list)

    allok = ok1 and ok2 and ok3 and ok4
    print(f'\n冒烟总判定：{"全部通过" if allok else "存在失败项"}')
    return 0 if allok else 1


def cmd_scan(unverified: bool) -> None:
    out = _scan_once(unverified)
    print(json.dumps(out, ensure_ascii=False, indent=1))


def cmd_watch(interval: int, unverified: bool) -> None:
    interval = max(30, min(60, interval))      # 频控硬闸：全市场扫描 30-60 秒一次
    out_path = ROOT / 'data' / 'intraday_scan.json'
    print(f'[watch] 启动：每 {interval}s 全市场扫描 → {out_path}（Ctrl+C 退出）')
    n = 0
    while True:
        n += 1
        t0 = time.time()
        try:
            out = _scan_once(unverified)
            out['tick'] = n
            tmp = out_path.with_suffix('.json.tmp')
            tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
            tmp.replace(out_path)
            print(f'[watch] #{n} 候选 {out["candidatePool"]["count"]} 只 · '
                  f'快照 {out["snapshot"]["rows"]} 行({out["snapshot"]["source"]}) · {time.time() - t0:.1f}s')
        except EmptyDataError as e:
            print(f'[watch] #{n} 空数据阻断：{e}（本轮跳过，不写盘）')
        except Exception as e:
            print(f'[watch] #{n} 异常：{type(e).__name__} {e}（本轮跳过）')
        time.sleep(max(0, interval - (time.time() - t0)))


def _cli() -> None:
    ap = argparse.ArgumentParser(description='候选池数据层 CLI')
    ap.add_argument('cmd', choices=['smoke', 'scan', 'watch'])
    ap.add_argument('--interval', type=int, default=60,
                    help='全市场扫描周期秒数（30-60 硬闸；QuantDash 免费版 10 次/分钟下建议 60）')
    ap.add_argument('--unverified-main-net', action='store_true',
                    help='主力净流入榜缺席时降级构建（巡检用，正式策略不得采信）')
    a = ap.parse_args()
    if a.cmd == 'smoke':
        sys.exit(cmd_smoke())
    if a.cmd == 'scan':
        cmd_scan(a.unverified_main_net)
    else:
        cmd_watch(a.interval, a.unverified_main_net)


if __name__ == '__main__':
    _cli()
