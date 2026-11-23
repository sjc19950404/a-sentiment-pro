#!/usr/bin/env python3
"""Tushare daily_basic 换手率采集（2026-11-24 用户拍板：替换东财慢速链）

251 次按 trade_date 拉全市场（不是 3655 次逐票），turnover_rate=流通股本换手率
（PIT 正确，用户指定的现成字段——不写第三种自行计算方案）。

前置：TUSHARE_TOKEN 环境变量或 .env（当前环境 token 为注释占位，需补齐）。
口径硬门禁：000636 / 20261123 必须 == 7.32%（东财 f61 与 ztpool hs 三方锚），
差 >0.01pp 直接停——查流通股本时点/复权口径，不带病采集。

落盘：data/.turnover_tushare/manifest.json（source/version/dateRange/fetchedAt/days）
      data/.turnover_tushare/YYYYMMDD.json（当日全市场 {code: turnover_rate}）
增量：manifest 已有 trade_date 跳过；--refresh 重拉。
"""
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / '.turnover_tushare'
OUT.mkdir(parents=True, exist_ok=True)


def get_token():
    t = os.environ.get('TUSHARE_TOKEN')
    if t:
        return t
    envf = ROOT / '.env'
    if envf.exists():
        for line in envf.read_text(encoding='utf-8').splitlines():
            if line.strip().startswith('TUSHARE_TOKEN='):
                return line.strip().split('=', 1)[1].strip().strip('"\'')
    print('[ts] ❌ 缺 TUSHARE_TOKEN——Pro 接口需要 token（当前 .env 为注释占位）。'
          '请设置环境变量或写入 .env 后重跑。')
    sys.exit(3)


def main():
    import tushare as ts
    token = get_token()
    pro = ts.pro_api(token)

    # ── 口径锚（先于任何落盘） ──
    try:
        anchor = pro.daily_basic(ts_code='000636.SZ', trade_date='20261123', fields='trade_date,turnover_rate')
    except Exception as e:
        print('[ts] ❌ daily_basic 调用失败（检查积分是否开通该接口）:', str(e)[:160])
        sys.exit(4)
    if anchor is None or anchor.empty:
        print('[ts] ❌ 锚点无数据（000636/20261123）——接口权限或数据日问题，停。')
        sys.exit(4)
    v = float(anchor.iloc[0]['turnover_rate'])
    print(f'[ts] 口径锚 000636/20261123 = {v:.2f}%（期望 7.32%，东财 f61 / ztpool hs 同值）')
    if abs(v - 7.32) > 0.01:
        print('[ts] ❌ 锚点偏差 >0.01pp——流通股本时点或复权口径不一致，按拍板停止采集查口径。')
        sys.exit(2)
    print('[ts] ✓ 锚点对齐——开始按日批量采集')

    # 交易日清单（archive 全史）
    archive = json.loads((ROOT / 'data' / 'archive.json').read_text(encoding='utf-8'))
    dates = sorted({str(d['trade_date']).replace('-', '')
                    for d in archive.get('all_days', []) if d and d.get('trade_date')})
    mpath = OUT / 'manifest.json'
    man = json.loads(mpath.read_text(encoding='utf-8')) if mpath.exists() else {
        'source': 'Tushare Pro daily_basic.turnover_rate（流通股本口径，PIT 正确）',
        'version': 'v1', 'fetchedAt': None, 'dates': [],
    }
    done = set(man['dates'])
    todo = [d for d in dates if d not in done]
    print(f'[ts] 交易日 {len(dates)} 天 | 已有 {len(done)} | 待采 {len(todo)}')

    ok = 0
    for i, d in enumerate(todo, 1):
        try:
            df = pro.daily_basic(trade_date=d, fields='ts_code,trade_date,turnover_rate')
            if df is not None and not df.empty:
                payload = {str(r.ts_code).split('.')[0]: (float(r.turnover_rate) if r.turnover_rate == r.turnover_rate else None)
                           for r in df.itertuples()}
            else:
                payload = {}
            (OUT / f'{d}.json').write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
            man['dates'].append(d)
            ok += 1
        except Exception as e:
            print(f'[ts] {d} 失败: {str(e)[:80]}（后续重跑自动补）')
            time.sleep(2)
        if i % 50 == 0:
            print(f'[ts] 进度 {i}/{len(todo)}')
            man['fetchedAt'] = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
            mpath.write_text(json.dumps(man, ensure_ascii=False, indent=2), encoding='utf-8')
        time.sleep(0.15)   # Tushare Pro 限流保守值

    man['fetchedAt'] = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
    mpath.write_text(json.dumps(man, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'[ts] 完成：新增 {ok} 天 / 共 {len(man["dates"])} 天。下一步：对账 → turnover_ladder 回测')


if __name__ == '__main__':
    main()
