"""market_data.py — A 股行情数据层（2026-10-10 数据层迁移第一阶段）

替换旧接口直连（eastmoney-probe / push2his / 同花顺 getharden / 腾讯 qt.gtimg）：

  全市场快照   fetch_full_market_snapshot()   QuantDash CN_Stock（付费主路）
                                             → AkShare spot_em（兜底一）
                                             → QuantDash symbols 500/批 ×8（免费主路之一，
                                               本地代码表 paper_universe-lite，网络仅墙 push2 时可用）
  候选池行情   fetch_candidate_quotes(sym)    QuantDash symbols 批量 POST（免费版实测可用，≤500/批）
  涨跌停/炸板池 fetch_zt_pools(date)            AkShare zt_pool 族（push2ex，本地实测可达）
  主力净流入   fetch_main_net_screener()       AkShare fund_flow_rank（批量榜，绝不逐只）
  历史日线     fetch_history_daily(sym_bs,…)   BaoStock（收盘口径权威源）

纪律（与仓库宁缺毋假口径一致）：
  * 所有 DataFrame 必须经 normalize_snapshot() 统一字段后才可进策略层；
  * 空数据硬阻断（raise EmptyDataError），绝不带脏数据进信号层；
  * 全部批量请求，禁止逐只循环拉行情；QuantDash 走限速器（免费版实测 10 次/分钟——API 自报口径）；
  * 缺失 = None/NaN，绝不落 0（0 是合法行情值）。

CLI：
  python market_data.py intraday-raw     # 输出 JS 盘中快照桥接 JSON（snapshot_intraday.mjs 消费）
"""
from __future__ import annotations

import json
import re
import sys
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

# Windows 控制台默认 GBK，中文日志/北交所名会 UnicodeEncodeError——统一 UTF-8 输出
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent
BJ = ZoneInfo('Asia/Shanghai')

CANONICAL_COLS = ['symbol', 'name', 'price', 'prev_close', 'change_pct', 'volume', 'turnover_rate']


class EmptyDataError(RuntimeError):
    """空数据硬阻断：任何源返回空/全无效 → 抛出，禁止带脏数据进信号层。"""


# ── 降级日志（可追踪路径是验收标准之一）────────────────────────────────────────
_DEGRADATIONS: list[dict] = []


def log_degrade(chain: str, reason: str) -> None:
    rec = {'at': datetime.now(BJ).isoformat(timespec='seconds'), 'chain': chain, 'reason': reason[:300]}
    _DEGRADATIONS.append(rec)
    print(f'[market_data][degrade] {chain} ← {reason[:200]}', file=sys.stderr, flush=True)


def take_degradations() -> list[dict]:
    out, _DEGRADATIONS[:] = list(_DEGRADATIONS), []
    return out


# ── QuantDash 限速器（免费实配 10 次/分钟——API 实测自报，2026-10-10）──────────
class _QdRateLimiter:
    """10 次/分钟窗口 + 阻塞式节流：配额触顶时睡到下一个槽位释放（不失败不降级）。

    实测免费版 RateLimitError 自报「Rate limit exceeded (10/min)」——外部文档口径
    不可信，一切以 API 自报为准。全市场 symbols 兜底 = 8 请求/轮，配额内刚好一轮。
    """
    WINDOW_BUDGET = 9           # 10/min 留 1 余量
    MIN_INTERVAL = 6.8          # 秒（60/9≈6.7，物理上限之下）
    MAX_BLOCK_MS = 75_000       # 单次 acquire 最长阻塞：超时 raise 交由降级链

    def __init__(self) -> None:
        self._stamps: deque[float] = deque()
        self._last = 0.0

    def acquire(self) -> None:
        deadline = time.monotonic() + self.MAX_BLOCK_MS / 1000
        while True:
            now = time.monotonic()
            self._stamps = deque(s for s in self._stamps if now - s <= 60)
            if len(self._stamps) < self.WINDOW_BUDGET:
                break
            if now >= deadline:
                raise RuntimeError('QuantDash 免费配额阻塞超时（10 次/分钟 × 75s 等待）——交由降级链')
            time.sleep(min(1.0, max(0.05, self._stamps[0] + 60 - now)))
        wait = self.MIN_INTERVAL - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        now = time.monotonic()
        self._stamps.append(now)
        self._last = now


_QD_LIMITER = _QdRateLimiter()
_QD_CLIENT = None
_UNIVERSE_DISABLED = False      # 免费版 universe 模式 403 一次即进程级短路（省配额——10/min 每轮都金贵）


def _qd():
    """QuantDash 客户端懒加载：包未装 / key 未设 → raise，交由调用方降级。"""
    global _QD_CLIENT
    if _QD_CLIENT is None:
        import os
        if not os.environ.get('QUANTDASH_API_KEY'):
            raise RuntimeError('QUANTDASH_API_KEY 未设置（免费版候选池批量行情主路不可用）')
        from quantdash import QuantDash
        _QD_CLIENT = QuantDash()
    return _QD_CLIENT


def _qd_suffix(code: str) -> str:
    c = str(code).strip()
    return f'{c}.SH' if c.startswith(('6', '9')) else f'{c}.SZ'


def _flatten_quotes(rows: list[dict]) -> pd.DataFrame:
    """原生 quotes（list[Quote]）→ 展平 ext.* 的 DataFrame（量比等扩展字段在嵌套 ext dict 里）。

    trade_date 由 timestamp(ms) 按北京时区派生（与 SDK to_dataframe 同口径）——
    非交易日返回上一交易日日期，供下游「数据源交易日 ≠ 北京当日」守卫判定。
    """
    flat = []
    for q in rows or []:
        row = {k: v for k, v in q.items() if k not in ('ext', 'session')}
        ts = q.get('timestamp')
        if ts is not None:
            dt = pd.to_datetime(ts, unit='ms', utc=True).tz_convert(BJ)
            row['trade_date'] = dt.strftime('%Y-%m-%d')
        for k, v in (q.get('ext') or {}).items():
            if v is not None and not isinstance(v, dict):
                row[f'ext.{k}'] = v
        flat.append(row)
    return pd.DataFrame(flat)


def _bj_now() -> datetime:
    return datetime.now(BJ)


# ── normalize：统一字段为 symbol/name/price/prev_close/change_pct/volume/turnover_rate ──
_AK_ALIASES = {
    'symbol': ['代码', '股票代码'],
    'name': ['名称', '股票名称'],
    'price': ['最新价'],
    'prev_close': ['昨收', '昨收价', '前收盘'],
    'change_pct': ['涨跌幅'],
    'volume': ['成交量'],
    'turnover_rate': ['换手率'],
    'amount': ['成交额'],
    'liangbi': ['量比'],
    'pe_ttm': ['市盈率-动态', '市盈率TTM'],
    'pb': ['市净率'],
}


def _pick(df: pd.DataFrame, aliases: list[str]) -> pd.Series:
    for a in aliases:
        if a in df.columns:
            return df[a]
    return pd.Series([float('nan')] * len(df), index=df.index)


def _num(series: pd.Series) -> pd.Series:
    """宽进严出：任意类型 → 数值；无解读失败，不把空串/布尔当 0。"""
    return pd.to_numeric(series, errors='coerce')


def normalize_snapshot(df: pd.DataFrame, source: str) -> pd.DataFrame:
    """统一字段口径（策略层唯一入口）。

    - QuantDash：ext.change_pct / ext.turnover_rate 是小数 → ×100 转百分数；
    - AkShare：列名中文 → 规范列；量比/PE/PB 透传（缺失 = NaN，不造数）；
    - 无效行剔除（symbol 非 6 位数字、price 缺失/≤0 = 停牌/无行情）；
    - 结果为空 → raise EmptyDataError（硬阻断）。
    """
    if df is None or len(df) == 0:
        raise EmptyDataError(f'[{source}] 快照为空 DataFrame')
    out = pd.DataFrame(index=df.index)
    if source.startswith('quantdash'):
        # symbol 绝不过数值化（'600519.SH' to_numeric 会全灭）——直接字符串取 6 位
        out['symbol'] = df['symbol'].astype('string').str.extract(r'(\d{6})', expand=False) \
            if 'symbol' in df.columns else None
        out['name'] = df['ext.name'].astype('string') if 'ext.name' in df.columns else pd.NA
        out['price'] = _num(df['last_price']) if 'last_price' in df.columns else float('nan')
        out['prev_close'] = _num(df['prev_close']) if 'prev_close' in df.columns else float('nan')
        out['change_pct'] = _num(df['ext.change_pct']) * 100 if 'ext.change_pct' in df.columns else float('nan')
        out['volume'] = _num(df['volume']) if 'volume' in df.columns else float('nan')
        out['turnover_rate'] = _num(df['ext.turnover_rate']) * 100 if 'ext.turnover_rate' in df.columns else float('nan')
        out['amount'] = _num(df['amount']) if 'amount' in df.columns else float('nan')
        if 'trade_date' in df.columns:
            out['trade_date'] = df['trade_date'].astype('string')
        for extra, col in (('liangbi', 'liangbi'), ('pe_ttm', 'pe_ttm'), ('pb', 'pb')):
            out[extra] = float('nan')  # QuantDash 行情无量比/PE/PB 字段：缺失不造数
    else:
        for canon, aliases in _AK_ALIASES.items():
            out[canon] = _pick(df, aliases)
        if 'trade_date' in df.columns:
            out['trade_date'] = df['trade_date'].astype('string')

    out = out[out['symbol'].notna() & out['symbol'].str.fullmatch(r'\d{6}', na=False)]
    out['price'] = _num(out['price'])
    out = out[out['price'].notna() & (out['price'] > 0)]          # 停牌/无行情剔除
    for c in ('prev_close', 'change_pct', 'volume', 'turnover_rate', 'amount', 'liangbi', 'pe_ttm', 'pb'):
        if c in out.columns:
            out[c] = _num(out[c])
    # change_pct 缺失且两价齐全 → 由真实字段推导（明示 derivation，不属造数）
    derive = out['change_pct'].isna() & out['prev_close'].notna() & (out['prev_close'] > 0)
    if derive.any():
        out.loc[derive, 'change_pct'] = (out.loc[derive, 'price'] - out.loc[derive, 'prev_close']) \
            / out.loc[derive, 'prev_close'] * 100
    out = out.drop_duplicates(subset='symbol', keep='first').reset_index(drop=True)
    if len(out) == 0:
        raise EmptyDataError(f'[{source}] 快照规范化后为空（全部行无效）')
    out.attrs['source'] = source
    return out


# ── 全市场快照：三层降级链 ─────────────────────────────────────────────────────
_SNAPSHOT_CACHE: dict = {'df': None, 'at': 0.0, 'source': None}
MIN_SNAPSHOT_INTERVAL = 30      # 全市场扫描最小间隔（秒）——30-60s 周期的下限


def _load_local_universe() -> list[str]:
    p = ROOT / 'data' / 'paper_universe-lite.json'
    if not p.exists():
        raise RuntimeError(f'本地代码表缺失：{p}')
    syms = json.loads(p.read_text(encoding='utf-8'))['symbols']
    return [str(s['code']) for s in syms]


def _qd_symbols_fullmarket() -> pd.DataFrame:
    """兜底二：QuantDash symbols 500/批扫本地代码表（免费版实测可用，8 请求/轮）。"""
    codes = _load_local_universe()
    rows: list[dict] = []
    batch = 500
    for i in range(0, len(codes), batch):
        part = codes[i:i + batch]
        _QD_LIMITER.acquire()
        r = _qd().quotes.get_by_symbols([_qd_suffix(c) for c in part])
        rows.extend(r if r else [])
    if not rows:
        raise EmptyDataError('quantdash-symbols 兜底返回空')
    return _flatten_quotes(rows)


def fetch_full_market_snapshot(force: bool = False) -> pd.DataFrame:
    """全市场快照（一次请求完成，禁止逐只）。

    降级链：QuantDash CN_Stock universe（付费主路）
          → AkShare stock_zh_a_spot_em（免费兜底一；注意其底层是东财 push2，墙内网络不可达）
          → QuantDash symbols 500/批（免费兜底二，本地代码表）
    30s 进程内缓存复用（频控：全市场扫描 30-60 秒一次的下限闸）。
    """
    if not force and _SNAPSHOT_CACHE['df'] is not None \
            and time.monotonic() - _SNAPSHOT_CACHE['at'] < MIN_SNAPSHOT_INTERVAL:
        return _SNAPSHOT_CACHE['df']
    errors: list[str] = []
    global _UNIVERSE_DISABLED
    if not _UNIVERSE_DISABLED:
        try:
            _QD_LIMITER.acquire()
            df = _qd().quotes.get(universes='CN_Stock', to_dataframe=True)
            snap = normalize_snapshot(df, 'quantdash-universe')
            _SNAPSHOT_CACHE.update(df=snap, at=time.monotonic(), source='quantdash-universe')
            return snap
        except Exception as e:
            errors.append(f'quantdash-universe: {type(e).__name__} {e}')
            log_degrade('quantdash-universe → akshare-spot', errors[-1])
            if 'universe' in str(e) and ('Upgrade' in str(e) or 'Permission' in type(e).__name__):
                _UNIVERSE_DISABLED = True        # 付费墙：本进程后续轮次不再浪费配额试探
    try:
        import akshare as ak
        df = ak.stock_zh_a_spot_em()
        snap = normalize_snapshot(df, 'akshare-spot_em')
        _SNAPSHOT_CACHE.update(df=snap, at=time.monotonic(), source='akshare-spot_em')
        return snap
    except Exception as e:
        errors.append(f'akshare-spot: {type(e).__name__} {e}')
        log_degrade('akshare-spot → quantdash-symbols', errors[-1])
    try:
        df = _qd_symbols_fullmarket()
        snap = normalize_snapshot(df, 'quantdash-symbols')
        _SNAPSHOT_CACHE.update(df=snap, at=time.monotonic(), source='quantdash-symbols')
        return snap
    except Exception as e:
        errors.append(f'quantdash-symbols: {type(e).__name__} {e}')
    raise EmptyDataError('全市场快照三层链全部失败：' + ' | '.join(errors))


# ── 候选池批量行情（二次校验主路）──────────────────────────────────────────────
def fetch_candidate_quotes(symbols: list[str]) -> pd.DataFrame:
    """候选池批量行情：QuantDash symbols POST（≤500/批，批量不逐只）→ AkShare 快照切片兜底。"""
    codes = [str(s).strip() for s in symbols if re.fullmatch(r'\d{6}', str(s).strip() or '')]
    if not codes:
        raise EmptyDataError('fetch_candidate_quotes: 无有效 6 位代码')
    try:
        rows: list[dict] = []
        for i in range(0, len(codes), 500):
            _QD_LIMITER.acquire()
            r = _qd().quotes.get_by_symbols([_qd_suffix(c) for c in codes[i:i + 500]])
            rows.extend(r if r else [])
        return normalize_snapshot(_flatten_quotes(rows), 'quantdash-quotes')
    except Exception as e:
        log_degrade('quantdash-quotes → snapshot-slice', f'{type(e).__name__} {e}')
    snap = fetch_full_market_snapshot()          # 兜底：全市场快照切片（缓存命中零新增请求）
    sub = snap[snap['symbol'].isin(set(codes))].reset_index(drop=True)
    if len(sub) == 0:
        raise EmptyDataError(f'候选池行情为空（{len(codes)} 只请求，0 只返回）')
    return sub


# ── BaoStock 历史日线（收盘口径权威源）─────────────────────────────────────────
def fetch_history_daily(symbol_bs: str, start_date: str, end_date: str,
                        adjust: str = '2') -> pd.DataFrame:
    """历史日线（回测/日线校验统一入口）。symbol_bs 形如 'sh.600519'。

    日期格式：YYYY-MM-DD（BaoStock 口径，带横杠）；YYYYMMDD 自动转换。
    adjust：'2' 前复权（默认，回测口径）| '1' 后复权 | '3' 不复权。
    空/登录失败/参数拒收 → raise（禁止空 klines 流入下游——10-09 类崩溃的根因闸）。
    """
    def _d(s: str) -> str:
        s = str(s).replace('-', '')
        if not re.fullmatch(r'\d{8}', s):
            raise EmptyDataError(f'日期格式非法: {s!r}（需 YYYY-MM-DD 或 YYYYMMDD）')
        return f'{s[:4]}-{s[4:6]}-{s[6:]}'

    import baostock as bs
    lg = bs.login()
    if lg is None or lg.error_code != '0':
        raise EmptyDataError(f'BaoStock 登录失败: {getattr(lg, "error_code", "?")} {getattr(lg, "error_msg", "?")}')
    try:
        rs = bs.query_history_k_data_plus(
            symbol_bs,
            'date,code,open,high,low,close,volume,amount,turn,tradestatus,pctChg',
            start_date=_d(start_date), end_date=_d(end_date),
            frequency='d', adjustflag=adjust)
        if rs is None or rs.error_code != '0':
            raise EmptyDataError(f'BaoStock 查询失败: {symbol_bs} {start_date}~{end_date}'
                                 f'（rs={getattr(rs, "error_code", None)} {getattr(rs, "error_msg", "")}）')
        rows = []
        while rs.error_code == '0' and rs.next():
            rows.append(rs.get_row_data())
    finally:
        bs.logout()
    df = pd.DataFrame(rows, columns=rs.fields)
    if df.empty:
        raise EmptyDataError(f'BaoStock {symbol_bs} {start_date}~{end_date} 日线为空（klines 空 → 硬阻断）')
    for c in ('open', 'high', 'low', 'close', 'volume', 'amount', 'turn', 'pctChg'):
        df[c] = pd.to_numeric(df[c], errors='coerce')
    df['tradestatus'] = pd.to_numeric(df['tradestatus'], errors='coerce').astype('Int64')
    df = df.sort_values('date').reset_index(drop=True)
    return df


# ── 涨跌停/炸板池（v4 契约：{zt,zb,dt,max_lb,lb2,zt_codes,zt_lb,zt_detail,…}）────
def fetch_zt_pools(date_ymd: str) -> dict | None:
    """涨停/炸板/跌停池（AkShare zt_pool 族——push2ex，一次一池，绝不逐只）。

    zt_detail 契约与旧 fetchPools 完全一致：{c,n,lbc,zbc,hybk,fbt,fund}
    （fbt 原样六位数字串 '092500'，与 v4 一字判据 padStart(6,'0') 兼容；fund 单位元）。
    三池全失败 → None（调用方按缺席处理，宁缺毋假）。
    """
    import akshare as ak
    out: dict = {'zt': None, 'zb': None, 'dt': None, 'max_lb': None, 'lb2': None,
                 'zt_codes': None, 'zt_lb': None, 'zt_detail': None,
                 'dt_detail': None, 'zb_detail': None}
    any_ok = False
    try:
        zt = ak.stock_zt_pool_em(date=date_ymd)
        if zt is not None and len(zt):
            out['zt'] = len(zt)
            out['max_lb'] = int(zt['连板数'].max()) if '连板数' in zt.columns else None
            out['lb2'] = int((zt['连板数'] >= 2).sum()) if '连板数' in zt.columns else None
            out['zt_codes'] = [str(c) for c in zt['代码']]

            def _i(row, col, default):
                v = row.get(col)
                return int(v) if pd.notna(v) else default

            out['zt_lb'] = {str(r['代码']): _i(r, '连板数', 1) for _, r in zt.iterrows()}
            out['zt_detail'] = [{
                'c': str(r['代码']),
                'n': str(r.get('名称')) if pd.notna(r.get('名称')) else '',
                'lbc': _i(r, '连板数', 1), 'zbc': _i(r, '炸板次数', 0),
                'hybk': str(r.get('所属行业')) if pd.notna(r.get('所属行业')) else '',
                # fbt 只留数字（akshare 实测 '092500'；防 92500.0 数字形态——JS 侧 padStart(6,'0') 兜历史）
                'fbt': (re.sub(r'\D', '', str(r['首次封板时间'])) or None
                        if pd.notna(r.get('首次封板时间')) else None),
                'fund': (float(r['封板资金']) if pd.notna(r.get('封板资金')) else None),
            } for _, r in zt.iterrows()]
            any_ok = True
        else:
            out['zt'] = 0 if zt is not None else None
            any_ok = any_ok or zt is not None
    except Exception as e:
        log_degrade('zt-pool → null', f'{type(e).__name__} {e}')
    try:
        zb = ak.stock_zt_pool_zbgc_em(date=date_ymd)
        if zb is not None:
            out['zb'] = len(zb)
            out['zb_detail'] = [{'c': str(r['代码']), 'amount': float(r.get('成交额') or 0)}
                                for _, r in zb.iterrows()] if len(zb) else []
            any_ok = True
    except Exception as e:
        log_degrade('zb-pool → null', f'{type(e).__name__} {e}')
    try:
        dt = ak.stock_zt_pool_dtgc_em(date=date_ymd)
        if dt is not None:
            out['dt'] = len(dt)
            days_col = next((c for c in ('跌停天数', '连续跌停', 'days') if c in dt.columns), None)
            out['dt_detail'] = [{
                'c': str(r['代码']), 'fba': float(r.get('封单资金') or 0),
                'amount': float(r.get('成交额') or 0),
                'days': int(r[days_col]) if days_col and pd.notna(r.get(days_col)) else 0,
            } for _, r in dt.iterrows()] if len(dt) else []
            any_ok = True
    except Exception as e:
        log_degrade('dt-pool → null', f'{type(e).__name__} {e}')
    return out if any_ok else None


# ── 主力净流入（批量榜，绝不逐只）───────────────────────────────────────────────
def fetch_main_net_screener(top_n: int = 100) -> tuple[dict, list | None]:
    """主力净流入榜（AkShare fund_flow_rank，一次请求全市场排行）。

    返回 (main_net_map, screener_rows)：
      main_net_map   {code: 主力净流入(元)}——全市场口径（今日累计）
      screener_rows  主力净流入降序前 N，字段对齐旧 fetchScreenerTopMainNet 契约
                     （量比/PE/PB 从全市场快照合并；行业无量源 = None，不造数）
    失败 → ({}, None)（调用方按 main_net 缺席处理，宁缺毋假）。
    """
    try:
        import akshare as ak
        ff = ak.stock_individual_fund_flow_rank(indicator='今日')
        if ff is None or ff.empty:
            raise EmptyDataError('fund_flow_rank 返回空')
        code_col = next(c for c in ('代码', '股票代码') if c in ff.columns)
        mn_col = next(c for c in ff.columns if '主力净流入-净额' in str(c))
        ff = ff[[code_col, mn_col]].copy()
        ff.columns = ['symbol', 'main_net']
        ff['symbol'] = ff['symbol'].astype('string').str.zfill(6)
        ff['main_net'] = pd.to_numeric(ff['main_net'], errors='coerce')
        ff = ff.dropna(subset=['main_net'])
        if ff.empty:
            raise EmptyDataError('fund_flow_rank 规范化后为空')
        main_map = {r['symbol']: float(r['main_net']) for _, r in ff.iterrows()}
        try:
            snap = fetch_full_market_snapshot()   # 缓存命中零新增请求
            snap = snap.set_index('symbol')
        except Exception:
            snap = None
        rows = []
        for sym, mn in sorted(main_map.items(), key=lambda kv: kv[1], reverse=True)[:top_n]:
            row = {'code': sym, 'name': None, 'close': None, 'change_pct': None, 'huanshou': None,
                   'liangbi': None, 'pe_ttm': None, 'pb': None, 'main_net': mn, 'industry': None}
            if snap is not None and sym in snap.index:
                s = snap.loc[sym]
                row.update({'name': s['name'] if pd.notna(s['name']) else None,
                            'close': float(s['price']),
                            'change_pct': float(s['change_pct']) if pd.notna(s['change_pct']) else None,
                            'huanshou': float(s['turnover_rate']) if pd.notna(s['turnover_rate']) else None,
                            'liangbi': float(s['liangbi']) if 'liangbi' in snap.columns and pd.notna(s.get('liangbi')) else None,
                            'pe_ttm': float(s['pe_ttm']) if 'pe_ttm' in snap.columns and pd.notna(s.get('pe_ttm')) else None,
                            'pb': float(s['pb']) if 'pb' in snap.columns and pd.notna(s.get('pb')) else None})
            rows.append(row)
        return main_map, rows
    except Exception as e:
        log_degrade('main-net-rank → null', f'{type(e).__name__} {e}')
        return {}, None


# ── 派生源（一次快照多源复用，零新增请求）───────────────────────────────────────
def derive_hot(snap: pd.DataFrame, top: int = 200) -> list[dict]:
    """强势股榜（派生）：全市场快照按涨幅降序取前 N。

    口径变化明示：旧源 = 同花顺 getharen 强势榜（带 reason 标签）；
    新源 = 全市场快照派生涨幅榜——reason 为派生标注，不冒充同花顺标签。
    """
    src_date = None
    if 'trade_date' in snap.columns:
        d = snap['trade_date'].dropna()
        if len(d):
            src_date = str(d.mode().iloc[0])
    ranked = snap.sort_values('change_pct', ascending=False, na_position='last').head(top)
    date_str = src_date or _bj_now().strftime('%Y-%m-%d')
    return [{
        'code': r['symbol'], 'name': r['name'] if pd.notna(r['name']) else None,
        'reason': '全市场快照涨幅榜（新数据层派生）',
        'close': float(r['price']),
        'zhangfu': float(r['change_pct']) if pd.notna(r['change_pct']) else None,
        'huanshou': float(r['turnover_rate']) if pd.notna(r['turnover_rate']) else None,
        'date': date_str,
    } for _, r in ranked.iterrows()]


def derive_breadth(snap: pd.DataFrame) -> dict:
    """涨跌家数（派生）：快照内 change_pct 符号统计（沪深 A 全量，含派生口径注记）。"""
    chg = snap['change_pct'].dropna()
    return {'up': int((chg > 0).sum()), 'down': int((chg < 0).sum()), 'flat': int((chg == 0).sum())}


def derive_quotes_map(snap: pd.DataFrame, codes: list[str]) -> dict:
    """候选池行情字段映射（契约对齐旧 fetchHotQuotes：量比/PE-TTM/PB，缺失 = null 不造数）。"""
    sub = snap[snap['symbol'].isin(set(codes))]
    out: dict = {}
    for _, r in sub.iterrows():
        def g(c):
            v = r.get(c)
            return float(v) if c in r.index and pd.notna(v) else None
        out[r['symbol']] = {
            'close': float(r['price']),
            'change_pct': g('change_pct'), 'huanshou': g('turnover_rate'),
            'pe_ttm': g('pe_ttm'), 'pb': g('pb'), 'liangbi': g('liangbi'),
        }
    return out


# ── JS 盘中快照桥接（snapshot_intraday.mjs 的唯一数据入口）─────────────────────
def intraday_raw() -> dict:
    """组装盘中六源（契约与旧 sources.js 逐字段一致）——stdout JSON 供 JS 消费。"""
    errors: list[str] = []
    hot = pools = breadth = screener = None
    quotes: dict = {}
    main_net: dict = {}
    snap = None
    try:
        snap = fetch_full_market_snapshot()
        hot = derive_hot(snap)
        breadth = derive_breadth(snap)
        if hot:
            quotes = derive_quotes_map(snap, [h['code'] for h in hot])
    except Exception as e:
        errors.append(f'snapshot/hot/breadth: {type(e).__name__} {e}')
    try:
        pools = fetch_zt_pools(_bj_now().strftime('%Y%m%d'))
    except Exception as e:
        errors.append(f'pools: {type(e).__name__} {e}')
    try:
        main_net, screener = fetch_main_net_screener()
    except Exception as e:
        errors.append(f'main-net: {type(e).__name__} {e}')
    out = {
        'hot': hot, 'pools': pools, 'breadth': breadth,
        'quotes': quotes, 'mainNet': main_net, 'screener': screener,
        'meta': {
            'generatedAt': datetime.now(BJ).isoformat(timespec='seconds'),
            'snapshotSource': snap.attrs.get('source') if snap is not None else None,
            'snapshotRows': int(len(snap)) if snap is not None else 0,
            'errors': errors,
            'degradations': take_degradations(),
            'caliberNotes': [
                'hot=全市场快照派生涨幅榜（旧源为同花顺强势榜，reason 标签口径变化）',
                'breadth=快照内符号统计（旧源为东财指数涨跌家数）',
                'quantdash-symbols 路径覆盖本地代码表 3558 只沪深 A（不含北交所）',
            ],
        },
    }
    print(json.dumps(out, ensure_ascii=False))
    return out


def _cli() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == 'intraday-raw':
        intraday_raw()
    else:
        print(__doc__)


if __name__ == '__main__':
    _cli()
