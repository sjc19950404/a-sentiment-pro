#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sentiment V5.0 权重敏感性回测模块（离线）
=========================================
输入：CSV 日度因子文件，列：date, f1, f2, f3, f4, f5, close [, regime]
      f1=情绪定位 f2=盈亏效应 f3=广度量能 f4=题材结构 f5=主线板块内部结构（0~100）
      close=回测标的收盘（主线指数 / 等权主线篮子），regime 可选（bull/bear/other）

功能：
  1. 权重网格搜索（步进0.05，sum=1，wi>=0.05，共 C(19,4)=3876 组）
  2. 风险阈值扫描（高风险分界 20~30，低风险分界 60~70，步进1）
  3. 鲁棒性：±5 分噪声扰动 / 训练-验证分段
  4. 失效场景：按 regime（或按指数60日趋势自动标注）分组统计信号错误率
  5. 输出 reports/ 下 CSV + Markdown 报告
  6. --xlsx 导出回测结果 Excel（每日因子与仓位 / 交易明细 / 汇总指标 三表）
  7. --w1~--w5 / --lo --hi --panic --overheat 支持自定义权重与阈值调参（跳过网格）

优化目标优先级：① 最大回撤最小 ② 夏普最高 ③ 总收益最高

用法：
  python sentiment_backtest.py --factors factors.csv
  python sentiment_backtest.py --demo --out reports   # 合成数据自检
"""
import argparse
import itertools
import json
import math
import os
from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd

# ────────────────────────── 参数 ──────────────────────────
BASE_W = (0.25, 0.25, 0.20, 0.20, 0.10)   # V5 基准权重
W_MIN, W_STEP = 0.05, 0.05                # 权重下限与步进
BASE_HI, BASE_LO = 44.0, 65.0             # 风险分界：≤hi 减仓，≥lo 持有，≤24 清仓
PANIC = 24.0                              # 清仓线（固定）
OVERHEAT = 80.0                           # 过热线（仅提示，不加新仓）
ANN = 252                                 # 年化系数
RF = 0.0                                  # 无风险利率年化（夏普用，CLI --rf 调整）


@dataclass
class Perf:
    total_ret: float      # 总收益率
    annual: float         # 年化
    max_dd: float         # 最大回撤（正数，越小越好）
    sharpe: float         # 夏普（rf=0，日频年化）
    win_rate: float       # 持仓日胜率
    profit_ratio: float   # 盈亏比（毛利/毛亏）
    long_days: int        # 持仓天数
    empty_ratio: float    # 空仓期占比
    trades: int           # 开仓次数
    calmar: float = 0.0        # 年化/最大回撤
    sortino: float = 0.0       # 下行波动夏普
    max_consec_loss: int = 0   # 最大连续亏损天数


# ────────────────────────── 打分与信号 ──────────────────────────
def score(df: pd.DataFrame, w) -> pd.Series:
    return (df["f1"] * w[0] + df["f2"] * w[1] + df["f3"] * w[2]
            + df["f4"] * w[3] + df["f5"] * w[4])


def positions(s: pd.Series, hi: float = BASE_HI, lo: float = BASE_LO,
              panic: float = PANIC, overheat: float = OVERHEAT,
              max_pos: float = 1.0, stop_loss: float = 0.0,
              ret: pd.Series = None, dd_trigger: float = 0.0) -> pd.Series:
    """收盘打分 → 次日仓位（T+1）。满仓 max_pos / 半仓 0.5*max_pos / 空仓 0。
    过热区(≥overheat)不清仓但禁止新建仓：对已有持仓保持，对空仓者保持空仓。
    止损（stop_loss<0 启用，如 -0.08）：持仓期当日标的收盘跌幅 ≤ 止损线，次日强制清仓。
    回撤动态降仓（dd_trigger<0 启用，如 -0.15）：以当日收盘回撤计——
    回撤 ≥ |trigger| → 上限压至 0.4×max_pos；≥ 0.6×|trigger| → 0.7×max_pos；否则正常。
    全部决策只用当日收盘已知信息（score[i]、ret[i]、截至 ret[i] 的净值），T+1 生效，无前视。"""
    pos = pd.Series(np.nan, index=s.index)
    held = False
    r = ret.values if ret is not None else None
    eq = peak = 1.0
    prev_target = 0.0
    for i, v in enumerate(s.values):
        if r is not None:                      # 当日收盘：先结算昨日目标仓位的当日盈亏
            eq *= (1.0 + prev_target * r[i])
            peak = max(peak, eq)
        if dd_trigger < 0 and r is not None:   # 回撤动态降仓（类凯利风控）
            cur_dd = 1.0 - eq / peak
            if cur_dd >= -dd_trigger:
                cap = 0.4 * max_pos
            elif cur_dd >= 0.6 * -dd_trigger:
                cap = 0.7 * max_pos
            else:
                cap = max_pos
        else:
            cap = max_pos
        if stop_loss < 0 and held and r is not None and r[i] <= stop_loss:
            target = 0.0                           # 止损优先于信号：次日清仓
        elif v >= overheat:
            target = cap if held else 0.0          # 只减仓不新建
        elif v >= lo:
            target = cap
        elif v > panic:
            target = 0.5 * cap
        else:
            target = 0.0
        held = target > 0 or (held and target > 0)
        pos.iloc[i] = target
        prev_target = target
    return pos.shift(1).fillna(0.0)                # T+1 生效


# ────────────────────────── 绩效计算 ──────────────────────────
def _metrics(strat: pd.Series, pos: pd.Series, opens: int) -> Perf:
    """由策略日收益与仓位序列计算全部绩效指标（单标的与多标的组合共用）"""
    equity = (1 + strat).cumprod()
    total = equity.iloc[-1] - 1
    n = len(strat)
    annual = (1 + total) ** (ANN / n) - 1 if n > 0 and total > -1 else -1.0
    dd = (1 - equity / equity.cummax()).max()
    sd = strat.std(ddof=0)
    excess = strat - RF / ANN                      # 夏普计入无风险利率（--rf 可调，默认0）
    sharpe = excess.mean() / sd * math.sqrt(ANN) if sd > 1e-12 else 0.0
    held = strat[pos > 0]
    win = (held > 0).mean() if len(held) else 0.0
    gain = strat[strat > 0].sum()
    loss = -strat[strat < 0].sum()
    pr = gain / loss if loss > 1e-12 else float("inf")
    calmar = annual / float(dd) if dd > 1e-9 else 999.0
    neg = strat[strat < 0]
    sortino = (excess.mean() / neg.std(ddof=0) * math.sqrt(ANN)
               if len(neg) > 1 and neg.std(ddof=0) > 1e-12 else 999.0)
    mcl = run_len = 0                              # 最大连续亏损天数（游程计数）
    for x in (strat < 0).astype(int).values:
        run_len = run_len + 1 if x else 0
        mcl = max(mcl, run_len)
    return Perf(round(total, 4), round(annual, 4), round(float(dd), 4),
                round(sharpe, 3), round(win, 4), round(pr, 3) if math.isfinite(pr) else 999,
                int((pos > 0).sum()), round(float((pos == 0).mean()), 4), opens,
                round(calmar, 3) if calmar < 999 else 999, round(sortino, 3) if sortino < 999 else 999,
                mcl)


def perf(df: pd.DataFrame, w, hi: float = BASE_HI, lo: float = BASE_LO,
         panic: float = PANIC, overheat: float = OVERHEAT,
         max_pos: float = 1.0, stop_loss: float = 0.0, dd_trigger: float = 0.0) -> Perf:
    ret = df["close"].pct_change().fillna(0.0)
    pos = positions(score(df, w), hi, lo, panic, overheat, max_pos, stop_loss, ret, dd_trigger)
    strat = ret * pos
    opens = int(((pos > 0) & (pos.shift(1) == 0)).sum())
    return _metrics(strat, pos, opens)


def is_pool(df: pd.DataFrame) -> bool:
    return "asset_id" in df.columns


def pool_strat(df_pool: pd.DataFrame, w, hi: float = BASE_HI, lo: float = BASE_LO,
               panic: float = PANIC, overheat: float = OVERHEAT,
               max_pos: float = 1.0, stop_loss: float = 0.0,
               dd_trigger: float = 0.0):
    """多标的逐标的回测 → 等权合成组合 (strat, pos) 序列（按日期对齐，缺日跳过）"""
    strats, poss, opens = [], [], 0
    for _, g in df_pool.groupby("asset_id"):
        g = g.sort_values("date")
        ret = g["close"].pct_change().fillna(0.0)
        p = positions(score(g, w), hi, lo, panic, overheat, max_pos, stop_loss, ret, dd_trigger)
        strats.append(pd.Series((ret * p).values, index=g["date"].values))
        poss.append(pd.Series(p.values, index=g["date"].values))
        opens += int(((p > 0) & (p.shift(1) == 0)).sum())
    strat = pd.concat(strats, axis=1).mean(axis=1).sort_index()   # 等权：日收益取均值
    pos = pd.concat(poss, axis=1).mean(axis=1).sort_index()
    return strat, pos, opens


def perf_pool(df_pool: pd.DataFrame, w, hi: float = BASE_HI, lo: float = BASE_LO,
              panic: float = PANIC, overheat: float = OVERHEAT,
              max_pos: float = 1.0, stop_loss: float = 0.0, dd_trigger: float = 0.0) -> Perf:
    strat, pos, opens = pool_strat(df_pool, w, hi, lo, panic, overheat,
                                   max_pos, stop_loss, dd_trigger)
    return _metrics(strat, pos, opens)


def perf_auto(df: pd.DataFrame, w, **kw) -> Perf:
    """单标的/多标的自动路由（CSV 含 asset_id 列即多标的等权轮动）"""
    return perf_pool(df, w, **kw) if is_pool(df) else perf(df, w, **kw)


def rank_key(p: Perf):
    """优化优先级：回撤 ↑小 → 夏普 ↓大 → 年化 ↓大"""
    return (p.max_dd, -p.sharpe, -p.annual)


# ────────────────────────── 权重网格 ──────────────────────────
def weight_grid() -> list:
    """全部满足 sum=1、wi>=0.05、步进 0.05 的组合"""
    units = int(round(1 / W_STEP))                 # 20
    lo = int(round(W_MIN / W_STEP))                # 1
    out = []
    for c in itertools.combinations_with_replacement(range(lo, units + 1), 5):
        if sum(c) != units:
            continue
        for perm in set(itertools.permutations(c)):
            out.append(tuple(x * W_STEP for x in perm))
    return out


def _grid_chunk(df, chunk):
    return [{"w1": w[0], "w2": w[1], "w3": w[2], "w4": w[3], "w5": w[4], **asdict(perf_auto(df, w))}
            for w in chunk]


def grid_search(df: pd.DataFrame, verbose=True, workers: int = None) -> pd.DataFrame:
    """3876 组权重网格。多进程分块并行（60 组/块），并行不可用时自动回退串行。
    Windows spawn 安全：任务函数均为模块级，无 lambda/闭包。"""
    grids = weight_grid()
    rows = None
    try:
        from concurrent.futures import ProcessPoolExecutor
        chunks = [grids[i:i + 60] for i in range(0, len(grids), 60)]
        done = 0
        with ProcessPoolExecutor(max_workers=workers) as ex:
            for part in ex.map(_grid_chunk, [df] * len(chunks), chunks):
                rows = part if rows is None else rows + part
                done += len(part)
                if verbose and done % 600 < 60:
                    print(f"  grid {done}/{len(grids)}")
    except Exception as e:  # noqa: BLE001  冻结环境/沙箱等场景回退串行
        if verbose:
            print(f"  并行不可用({e})，转串行")
        rows = []
        for i, w in enumerate(grids):
            rows.append({"w1": w[0], "w2": w[1], "w3": w[2], "w4": w[3], "w5": w[4],
                         **asdict(perf_auto(df, w))})
            if verbose and (i + 1) % 500 == 0:
                print(f"  grid {i + 1}/{len(grids)}")
    res = pd.DataFrame(rows)
    res["_k"] = res.apply(lambda r: rank_key(Perf(**{k: r[k] for k in Perf.__dataclass_fields__})), axis=1)
    return res.sort_values("_k").drop(columns="_k").reset_index(drop=True)


# ────────────────────────── 阈值扫描 ──────────────────────────
def threshold_scan(df: pd.DataFrame, w) -> pd.DataFrame:
    rows = []
    for hi in range(20, 31):
        for lo in range(60, 71):
            p = perf_auto(df, w, hi=float(hi), lo=float(lo))
            rows.append({"hi": hi, "lo": lo, **asdict(p)})
    res = pd.DataFrame(rows)
    res["_k"] = res.apply(lambda r: rank_key(Perf(**{k: r[k] for k in Perf.__dataclass_fields__})), axis=1)
    return res.sort_values("_k").drop(columns="_k").reset_index(drop=True)


# ────────────────────────── 鲁棒性 ──────────────────────────
def noise_test(df: pd.DataFrame, w, eps=5.0, n=200, seed=42) -> dict:
    """给 f1~f5 加 U(-eps,+eps) 噪声，看绩效衰减"""
    rng = np.random.default_rng(seed)
    base = perf(df, w)
    dd, sh = [], []
    for _ in range(n):
        noisy = df.copy()
        for c in ["f1", "f2", "f3", "f4", "f5"]:
            noisy[c] = np.clip(noisy[c] + rng.uniform(-eps, eps, len(noisy)), 0, 100)
        p = perf_auto(noisy, w)
        dd.append(p.max_dd - base.max_dd)
        sh.append(p.sharpe - base.sharpe)
    return {"base": asdict(base),
            "dd_mean_delta": round(float(np.mean(dd)), 4),
            "sharpe_mean_delta": round(float(np.mean(sh)), 3),
            "sharpe_decay_pct": round(float(np.mean(sh)) / max(abs(base.sharpe), 1e-9) * 100, 1)}


def split_test(df: pd.DataFrame, w, train_frac=0.7) -> dict:
    k = int(len(df) * train_frac)
    return {"train": asdict(perf_auto(df.iloc[:k], w)), "valid": asdict(perf_auto(df.iloc[k:], w))}


# ────────────────────────── 滚动样本外验证 ──────────────────────────
def rolling_test(df: pd.DataFrame, w, train_window: int = 252, test_window: int = 63,
                 refit: bool = False, **kw) -> pd.DataFrame:
    """滚动窗口样本外验证（防过拟合）。
    - refit=False：固定参数按 test_window 切段逐段评估——检验参数跨期稳定性（快速）。
    - refit=True：真 walk-forward——训练窗 [start, start+train) 上阈值扫描选最优 (hi,lo)，
      在紧随其后的 test_window 上评估（训练段绝不参与测试），start 每次前移 test_window。
    外部稿 train_df 从未使用的"滚动"实为切段重命名；此处按语义诚实实现。"""
    rows = []
    start = 0
    n = len(df)
    while True:
        if refit:
            if start + train_window + test_window > n:
                break
            train_df = df.iloc[start:start + train_window]
            test_df = df.iloc[start + train_window:start + train_window + test_window]
            best = threshold_scan(train_df, w).iloc[0]
            hi, lo = float(best["hi"]), float(best["lo"])
        else:
            if start + test_window > n:
                break
            train_df, hi, lo = None, kw.get("hi", BASE_HI), kw.get("lo", BASE_LO)
            test_df = df.iloc[start:start + test_window]
        if len(test_df) < 10:
            break
        p = perf_auto(test_df, w, hi=hi, lo=lo,
                 panic=kw.get("panic", PANIC), overheat=kw.get("overheat", OVERHEAT),
                 max_pos=kw.get("max_pos", 1.0), stop_loss=kw.get("stop_loss", 0.0))
        rows.append({"start": test_df["date"].iloc[0].strftime("%Y-%m-%d"),
                     "end": test_df["date"].iloc[-1].strftime("%Y-%m-%d"),
                     "train_hi": hi, "train_lo": lo, **asdict(p)})
        start += test_window
    return pd.DataFrame(rows)


def rolling_summary(roll: pd.DataFrame) -> dict:
    """滚动验证汇总：样本外均值/最差段"""
    return {"segments": len(roll),
            "ann_mean": round(float(roll["annual"].mean()), 4),
            "sharpe_mean": round(float(roll["sharpe"].mean()), 3),
            "dd_worst": round(float(roll["max_dd"].max()), 4),
            "win_seg_pct": round(float((roll["total_ret"] > 0).mean()), 4)}


# ────────────────────────── 失效场景 ──────────────────────────
def label_regimes(df: pd.DataFrame) -> pd.DataFrame:
    """无 regime 列时：按标的60日收益自动标注 bull/bear/other"""
    df = df.copy()
    if "regime" not in df.columns:
        r60 = df["close"].pct_change(60)
        df["regime"] = np.where(r60 > 0.10, "bull", np.where(r60 < -0.10, "bear", "other"))
    return df


def regime_report(df: pd.DataFrame, w) -> pd.DataFrame:
    if is_pool(df):
        # 多标的：按组合等权日收益分组统计
        strat, pos, _ = pool_strat(df, w)
        idx = strat.index
        r60 = (1 + strat).cumprod().pct_change(60)
        reg = np.where(r60 > 0.10, "bull", np.where(r60 < -0.10, "bear", "other"))
        rows = []
        for g in pd.unique(reg):
            m = reg == g
            s = strat[m]
            rows.append({"regime": g, "days": int(m.sum()),
                         "total_ret": round(float((1 + s).prod() - 1), 4),
                         "sharpe": round(float(s.mean() / s.std(ddof=0) * math.sqrt(ANN)), 3) if s.std(ddof=0) > 1e-12 else 0.0,
                         "wrong_rate": round(float(((pos[m] > 0) & (s < 0)).mean()), 4)})
        return pd.DataFrame(rows)
    df = label_regimes(df)
    ret = df["close"].pct_change().fillna(0.0)
    pos = positions(score(df, w))
    rows = []
    for g, idx in df.groupby("regime").groups.items():
        m = df.index.isin(idx)
        s = ret[m] * pos[m]
        wrong = float(((pos[m] > 0) & (ret[m] < 0)).mean())   # 持仓期踩错率
        rows.append({"regime": g, "days": int(m.sum()), "total_ret": round(float((1 + s).prod() - 1), 4),
                     "sharpe": round(float(s.mean() / s.std(ddof=0) * math.sqrt(ANN)), 3) if s.std(ddof=0) > 1e-12 else 0.0,
                     "wrong_rate": round(wrong, 4)})
    return pd.DataFrame(rows)


# ────────────────────────── 报告 ──────────────────────────
def write_report(out, base_p, best_w, best_p, th, noise, split, regime,
                 hi: float = BASE_HI, lo: float = BASE_LO,
                 panic: float = PANIC, overheat: float = OVERHEAT,
                 max_pos: float = 1.0, stop_loss: float = 0.0,
                 dd_trigger: float = 0.0, roll: pd.DataFrame = None) -> str:
    th_top = th.head(5).to_string(index=False) if th is not None else "（自定义权重，未做网格扫描）"
    roll_sec = ""
    if roll is not None:
        rs = rolling_summary(roll)
        roll_sec = f"""
## 六、滚动窗口样本外验证（train={roll.attrs.get('train_window', '-')} test={roll.attrs.get('test_window', '-')} refit={roll.attrs.get('refit', False)}）
{len(roll)} 段样本外：年化均值 {rs['ann_mean']:.2%}｜夏普均值 {rs['sharpe_mean']}｜最差段回撤 {rs['dd_worst']:.2%}｜正收益段占比 {rs['win_seg_pct']:.0%}
```
{roll.to_string(index=False)}
```
> 样本外均值显著低于全样本 ⇒ 存在过拟合，优先降低参数激进程度。
"""
    md = f"""# Sentiment V5.0 权重敏感性回测报告

## 一、基准权重绩效（w1~w5 = {best_w}，阈值 lo={lo} hi={hi} panic={panic} overheat={overheat}，max_pos={max_pos}，stop_loss={stop_loss}，dd_trigger={dd_trigger}）
```
{json.dumps(asdict(base_p), ensure_ascii=False, indent=2)}
```

## 二、最优权重组合（3876 组网格，步进 0.05，wi>=0.05）
最优：w1={best_w[0]} w2={best_w[1]} w3={best_w[2]} w4={best_w[3]} w5={best_w[4]}
```
{json.dumps(asdict(best_p), ensure_ascii=False, indent=2)}
```
（完整网格见 weights_scan.csv；排序规则：最大回撤↑ → 夏普↓ → 年化↓）

## 三、最优风险阈值（固定最优权重，hi∈[20,30] × lo∈[60,70]）
前 5 组（hi=减仓线，lo=持有线）：
```
{th_top}
```

## 四、鲁棒性
噪声扰动（±5 分，200 次）：夏普平均衰减 {noise['sharpe_mean_delta']}（{noise['sharpe_decay_pct']}%），回撤平均恶化 {noise['dd_mean_delta']}
训练/验证分段（70/30）：
```
train: {json.dumps(split['train'])}
valid: {json.dumps(split['valid'])}
```

## 五、失效场景（regime 分组，wrong_rate=持仓期买错率）
```
{regime.to_string(index=False)}
```
> 人工干预规则：黑天鹅暴跌（单日跌停家数>100）/ 强政策事件当日，模型打分作废，人工覆盖仓位决策。
{roll_sec}
*本报告由离线规则回测自动生成，非投资建议。*
"""
    path = os.path.join(out, "report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return path


# ────────────────────────── 模型失效预警 ──────────────────────────
HIGH_RISK_SIGNALS = [
    "P_突发黑天鹅", "P重大政策转向", "O宏观超预期冲击",
    "B北向大额恐慌流出", "D大规模量价背离", "E大面积高位杀跌",
]


def model_fail_warning(score: float, alerts, penalty: float = 12.0) -> dict:
    """辅助模块高风险信号 → 修正参考分（原分不动，仅报告参考）。≥2 项共振标模型失效。"""
    hits = [a for a in alerts if a in HIGH_RISK_SIGNALS]
    modified = max(0.0, score - len(hits) * penalty)
    if len(hits) >= 2:
        flag = "【模型失效预警｜多维度风险共振，原始打分可靠性下降，建议人工干预】"
    elif len(hits) == 1:
        flag = "【单风险触发，适度降低预期】"
    else:
        flag = "模型状态正常"
    return {"origin": round(score, 2), "modified": round(modified, 2),
            "hits": hits, "flag": flag}


def risk_tier(score: float):
    """V5 五档：分数越高行情越强，80+ 过热警示"""
    if score >= 80:
        return "极低风险（情绪过热）", "高潮抱团，高位加速，禁止新开仓，仅可减仓兑现"
    if score >= 65:
        return "低风险", "行情强势，主线清晰，可参与主线"
    if score >= 45:
        return "中等风险", "震荡分歧，结构性行情，严格控仓"
    if score >= 25:
        return "高风险", "亏钱效应扩散，主线弱化，降低仓位"
    return "极高风险（冰点）", "大面积杀跌，空仓/轻仓防御"


def generate_daily_report(df: pd.DataFrame, w, alerts, out: str) -> str:
    """末日日报：五因子得分 + 综合分 + 失效预警修正 + 明日观测（多标的取末日各标的因子均值）"""
    if is_pool(df):
        last_date = df["date"].max()
        df = df[df["date"] == last_date].groupby("date", as_index=False)[["f1", "f2", "f3", "f4", "f5"]].mean()
        df["close"] = 1.0
    s = score(df, w)
    last = df.iloc[-1]
    date_str = pd.Timestamp(last["date"]).strftime("%Y-%m-%d")
    sc = float(s.iloc[-1])
    warn = model_fail_warning(sc, alerts)
    risk, signal = risk_tier(sc)
    names = ["F1 情绪定位", "F2 盈亏效应", "F3 广度量能", "F4 题材结构", "F5 主线板块内部结构"]
    lines = [f"# Sentiment V5.0 市场情绪日报｜{date_str}", "",
             "## 核心因子得分", ""]
    lines += [f"- {n}：{float(last[f'f{i + 1}']):.2f}" for i, n in enumerate(names)]
    lines += ["",
              f"> 原始综合得分：**{sc:.2f}**｜修正参考分：{warn['modified']}"
              f"（扣分项：{'、'.join(warn['hits']) if warn['hits'] else '无'}）",
              f"> 风险等级：**{risk}**｜操作建议：{signal}",
              f"> 模型状态：{warn['flag']}", "",
              "## 明日观测预警清单", "",
              "- 综合得分持续性监控",
              "- 主线涨停梯队完整性",
              "- 炸板率、高位大面数量变化",
              "- 成交额环比变化，量价是否继续背离",
              "- 北向资金、融资余额变动",
              "- 政策、外围市场、地缘风险预警（--alerts 传入触发项）", "",
              "> 免责声明：本模型仅为情绪观测复盘工具，不构成任何投资建议，市场存在黑天鹅，模型存在失效可能"]
    md = "\n".join(lines)
    path = os.path.join(out, f"daily_report_{date_str}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return path


# ────────────────────────── 可视化 ──────────────────────────
def plot_results(df: pd.DataFrame, w, out: str, hi: float = BASE_HI, lo: float = BASE_LO,
                 panic: float = PANIC, overheat: float = OVERHEAT,
                 max_pos: float = 1.0, stop_loss: float = 0.0,
                 dd_trigger: float = 0.0) -> str:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    for font in ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC"]:
        try:
            matplotlib.font_manager.findfont(font, fallback_to_default=False)
            plt.rcParams["font.sans-serif"] = [font]
            break
        except Exception:
            continue
    plt.rcParams["axes.unicode_minus"] = False

    ret = df["close"].pct_change().fillna(0.0)
    sc = score(df, w)
    pos = positions(sc, hi, lo, panic, overheat, max_pos, stop_loss, ret, dd_trigger)
    strat = ret * pos
    nav = (1 + strat).cumprod()
    x = pd.to_datetime(df["date"])

    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 12), sharex=False,
                                        height_ratios=[2, 3, 1.6])
    # 上：策略净值 vs 买入持有 + 仓位阴影
    ax1.plot(x, nav, color="#E63946", lw=2, label="策略净值")
    bh = (1 + ret).cumprod()
    ax1.plot(x, bh, color="#8D99AE", lw=1.2, alpha=0.8, label="买入持有")
    ax1.fill_between(x, nav, bh, where=nav >= bh, color="#E63946", alpha=0.10)
    ax1.fill_between(x, nav, bh, where=nav < bh, color="#2A9D8F", alpha=0.10)
    ax1.set_title("Sentiment V5.0 策略净值 vs 买入持有（阴影=超额）", fontsize=13)
    ax1.set_ylabel("净值")
    ax1.legend()
    ax1.grid(alpha=0.3)
    # 下：五因子 + 综合分 + 阈值线
    colors = ["#457B9D", "#2A9D8F", "#F4A261", "#E76F51", "#8D99AE"]
    for i, (c, n) in enumerate(zip(colors, ["F1情绪", "F2盈亏", "F3广度", "F4题材", "F5主线"])):
        ax2.plot(x, df[f"f{i + 1}"], color=c, lw=1, alpha=0.75, label=n)
    ax2.plot(x, sc, lw=2.2, color="red", label="综合Score")
    for y, c, n in ((lo, "green", f"开仓 {lo:g}"), (hi, "orange", f"减仓 {hi:g}"),
                    (panic, "red", f"清仓 {panic:g}"), (overheat, "magenta", f"过热 {overheat:g}")):
        ax2.axhline(y=y, ls="--", c=c, alpha=0.6, label=n)
    ax2.set_ylim(0, 100)
    ax2.set_title("五大因子与综合得分时序", fontsize=13)
    ax2.set_ylabel("分数 (0-100)")
    ax2.legend(loc="upper right", ncol=2, fontsize=9)
    ax2.grid(alpha=0.3)
    # 下：持仓日策略收益分布（盈亏稳定性；换仓日口径样本太少且选择性偏差，弃用）
    held = strat[pos > 0]
    ax3.hist(held, bins=30, color="#577590", alpha=0.75)
    ax3.axvline(x=0, color="red", ls="--", lw=1)
    if len(held) and held.std() > 0:
        ax3.axvline(x=held.mean(), color="orange", ls="-", lw=1.5,
                    label=f"均值 {held.mean():.3%}")
        ax3.legend(fontsize=9)
    ax3.set_title("持仓日策略收益分布（盈亏稳定性）", fontsize=13)
    ax3.set_xlabel("单日收益率")
    ax3.set_ylabel("天数")
    ax3.grid(alpha=0.3)
    plt.tight_layout()
    path = os.path.join(out, "nav_factors.png")
    plt.savefig(path, dpi=150)
    plt.close(fig)
    return path


# ────────────────────────── Excel 导出 ──────────────────────────
def daily_table(df: pd.DataFrame, w, hi: float = BASE_HI, lo: float = BASE_LO,
                panic: float = PANIC, overheat: float = OVERHEAT,
                max_pos: float = 1.0, stop_loss: float = 0.0,
                dd_trigger: float = 0.0) -> pd.DataFrame:
    """逐日明细：因子、综合分、仓位（T+1）、策略收益、净值"""
    sc = score(df, w)
    ret = df["close"].pct_change().fillna(0.0)
    pos = positions(sc, hi, lo, panic, overheat, max_pos, stop_loss, ret, dd_trigger)
    ret = df["close"].pct_change().fillna(0.0)
    strat = ret * pos
    dates = df["date"] if pd.api.types.is_datetime64_any_dtype(df["date"]) else pd.to_datetime(df["date"])
    out = pd.DataFrame({"date": dates.dt.strftime("%Y-%m-%d")})
    for i in range(5):
        out[f"f{i + 1}"] = df[f"f{i + 1}"].round(2)
    out["close"] = df["close"]
    out["score"] = sc.round(2)
    out["pos"] = pos
    out["strat_ret"] = strat.round(6)
    out["nav"] = (1 + strat).cumprod().round(4)
    return out


def trade_events(daily: pd.DataFrame) -> pd.DataFrame:
    """仓位变动事件明细（T+1 生效口径）：打分日触发 → 次日生效"""
    prev = daily["pos"].shift(1).fillna(0.0)       # 首日以前一仓位 0 计，避免 NaN 误判为事件
    ev = daily[daily["pos"] != prev].copy()
    rows = []
    for i, r in ev.iterrows():
        prev = daily["pos"].iloc[i - 1] if i > 0 else 0.0
        if r["pos"] > prev:
            action = "开仓" if prev == 0 else "加仓"
        else:
            action = "清仓" if r["pos"] == 0 else "减仓"
        rows.append({"生效日期": r["date"], "打分日": daily["date"].iloc[i - 1] if i > 0 else "-",
                     "综合分(前日)": daily["score"].iloc[i - 1] if i > 0 else "-",
                     "仓位变化": f"{prev:g} → {r['pos']:g}", "动作": action,
                     "close": r["close"], "当日策略收益": r["strat_ret"], "累计净值": r["nav"]})
    return pd.DataFrame(rows)


def export_excel(df: pd.DataFrame, w, out: str, hi: float = BASE_HI, lo: float = BASE_LO,
                 panic: float = PANIC, overheat: float = OVERHEAT,
                 max_pos: float = 1.0, stop_loss: float = 0.0, dd_trigger: float = 0.0,
                 rf: float = RF) -> str:
    """回测结果表打包。单标的：每日因子与仓位/交易明细/汇总指标；
    多标的（asset_id）：组合每日/交易明细(标记asset_id)/每标的绩效/汇总指标"""
    date_str = (df["date"].max() if is_pool(df) else df["date"].iloc[-1]).strftime("%Y-%m-%d")
    start_str = (df["date"].min() if is_pool(df) else df["date"].iloc[0]).strftime("%Y-%m-%d")
    path = os.path.join(out, f"Sentiment_Backtest_Result_{date_str}.xlsx")
    n_days = df["date"].nunique() if is_pool(df) else len(df)
    summary = pd.DataFrame({
        "类别": ["参数"] * 15,
        "名称": ["w1 情绪定位", "w2 盈亏效应", "w3 广度量能", "w4 题材结构", "w5 主线结构",
                 "开仓阈值(≥持有)", "减仓阈值(<)", "清仓阈值(≤)", "过热阈值(≥禁新建)",
                 "最大仓位", "单笔止损", "动态降仓回撤阈值", "无风险利率", "样本天数", "样本区间"],
        "数值": [w[0], w[1], w[2], w[3], w[4], lo, hi, panic, overheat, max_pos,
                 stop_loss, dd_trigger, rf, n_days, f"{start_str} ~ {date_str}"],
    })
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        if is_pool(df):
            p = perf_pool(df, w, hi, lo, panic, overheat, max_pos, stop_loss, dd_trigger)
            strat, pos, _ = pool_strat(df, w, hi, lo, panic, overheat, max_pos, stop_loss, dd_trigger)
            combo = pd.DataFrame({"date": strat.index, "pos": pos.round(2).values,
                                  "strat_ret": strat.round(6).values,
                                  "nav": (1 + strat).cumprod().round(4).values})
            # 每日明细 + 各标的 nav 列
            navs = {}
            for a, g in df.groupby("asset_id"):
                g = g.sort_values("date")
                ret = g["close"].pct_change().fillna(0.0)
                pa = positions(score(g, w), hi, lo, panic, overheat, max_pos, stop_loss, ret, dd_trigger)
                navs[f"nav_{a}"] = pd.Series((1 + ret * pa).cumprod().round(4).values, index=g["date"].values)
            combo = combo.merge(pd.DataFrame(navs), left_on="date", right_index=True, how="left")
            combo.to_excel(writer, sheet_name="组合每日净值", index=False)
            # 交易明细（逐标的，标记 asset_id）
            ev_rows = []
            for a, g in df.groupby("asset_id"):
                g = g.sort_values("date").reset_index(drop=True)
                ret = g["close"].pct_change().fillna(0.0)
                pa = positions(score(g, w), hi, lo, panic, overheat, max_pos, stop_loss, ret, dd_trigger)
                d = pd.DataFrame({"date": g["date"].values, "close": g["close"].values,
                                  "score": score(g, w).round(2).values,
                                  "pos": pa.values, "strat_ret": (ret * pa).values,
                                  "nav": (1 + ret * pa).cumprod().values})
                e = trade_events(d)
                if len(e):
                    e.insert(0, "asset_id", a)
                    ev_rows.append(e)
            (pd.concat(ev_rows, ignore_index=True) if ev_rows else pd.DataFrame()
             ).to_excel(writer, sheet_name="交易明细", index=False)
            # 每标的绩效
            per = []
            for a, g in df.groupby("asset_id"):
                pa = g.sort_values("date").reset_index(drop=True)
                per.append({"asset_id": a, **asdict(perf(pa, w, hi, lo, panic, overheat,
                                                         max_pos, stop_loss, dd_trigger))})
            pd.DataFrame(per).to_excel(writer, sheet_name="每标的绩效", index=False)
            p_metrics = [("总收益率", p.total_ret), ("年化收益", p.annual), ("最大回撤", p.max_dd),
                         ("夏普比率", p.sharpe), ("Calmar比率", p.calmar), ("Sortino比率", p.sortino),
                         ("最大连续亏损天数", p.max_consec_loss), ("持仓日胜率", p.win_rate),
                         ("盈亏比(毛利/毛亏)", p.profit_ratio), ("持仓天数", p.long_days),
                         ("空仓占比", p.empty_ratio), ("开仓次数", p.trades)]
            summary = pd.concat([summary, pd.DataFrame({"类别": ["指标"] * 12,
                                                        "名称": [m[0] for m in p_metrics],
                                                        "数值": [m[1] for m in p_metrics]})],
                                 ignore_index=True)
        else:
            p = perf(df, w, hi, lo, panic, overheat, max_pos, stop_loss, dd_trigger)
            daily = daily_table(df, w, hi, lo, panic, overheat, max_pos, stop_loss, dd_trigger)
            daily.to_excel(writer, sheet_name="每日因子与仓位", index=False)
            trade_events(daily).to_excel(writer, sheet_name="交易明细", index=False)
            summary = pd.concat([summary, pd.DataFrame({
                "类别": ["指标"] * 12,
                "名称": ["总收益率", "年化收益", "最大回撤", "夏普比率", "Calmar比率", "Sortino比率",
                         "最大连续亏损天数", "持仓日胜率", "盈亏比(毛利/毛亏)", "持仓天数",
                         "空仓占比", "开仓次数"],
                "数值": [p.total_ret, p.annual, p.max_dd, p.sharpe, p.calmar, p.sortino,
                         p.max_consec_loss, p.win_rate, p.profit_ratio, p.long_days,
                         p.empty_ratio, p.trades]})], ignore_index=True)
        summary.to_excel(writer, sheet_name="汇总指标", index=False)
    return path


# ────────────────────────── 热力图与批量净值 ──────────────────────────
def plot_heatmap(res: pd.DataFrame, x: str, y: str, out: str,
                 value: str = "sharpe", name: str = "threshold_heatmap.png") -> str:
    """参数扫描热力图（纯 matplotlib，不引入 seaborn）：颜色=绩效，标注数值"""
    pivot = res.pivot_table(index=y, columns=x, values=value, aggfunc="mean")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    for font in ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC"]:
        try:
            matplotlib.font_manager.findfont(font, fallback_to_default=False)
            plt.rcParams["font.sans-serif"] = [font]
            break
        except Exception:
            continue
    plt.rcParams["axes.unicode_minus"] = False
    fig, ax = plt.subplots(figsize=(max(8, len(pivot.columns) * 0.7), max(6, len(pivot.index) * 0.5)))
    im = ax.imshow(pivot.values, cmap="RdYlGn", aspect="auto")
    ax.set_xticks(range(len(pivot.columns)), [f"{c:g}" for c in pivot.columns])
    ax.set_yticks(range(len(pivot.index)), [f"{i:g}" for i in pivot.index])
    for i in range(len(pivot.index)):
        for j in range(len(pivot.columns)):
            v = pivot.values[i, j]
            if pd.notna(v):
                ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=7)
    ax.set_title(f"{y} × {x} → {value} 热力图（颜色越绿越优，可看参数高原）")
    ax.set_xlabel(x)
    ax.set_ylabel(y)
    fig.colorbar(im, ax=ax, label=value)
    plt.tight_layout()
    path = os.path.join(out, name)
    plt.savefig(path, dpi=150)
    plt.close(fig)
    return path


def batch_nav_plot(df: pd.DataFrame, rows: pd.DataFrame, out: str, w=None, top_n: int = 5,
                   **kw) -> str:
    """TopN 参数组合净值对比。rows 支持 weights_scan（w1~w5 列）与 threshold_scan（hi/lo 列）"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    for font in ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC"]:
        try:
            matplotlib.font_manager.findfont(font, fallback_to_default=False)
            plt.rcParams["font.sans-serif"] = [font]
            break
        except Exception:
            continue
    plt.rcParams["axes.unicode_minus"] = False
    fig, ax = plt.subplots(figsize=(14, 7))
    for i, (_, r) in enumerate(rows.head(top_n).iterrows()):
        if "w1" in rows.columns:
            ww = (r["w1"], r["w2"], r["w3"], r["w4"], r["w5"])
            kk = dict(kw)
            label = f"P{i + 1} w=({ww[0]:g},{ww[1]:g},{ww[2]:g},{ww[3]:g},{ww[4]:g}) sharpe={r['sharpe']}"
        else:
            ww = w or BASE_W
            kk = {**kw, "hi": float(r["hi"]), "lo": float(r["lo"])}
            label = f"P{i + 1} lo={r['lo']:g}/hi={r['hi']:g} sharpe={r['sharpe']}"
        if is_pool(df):
            strat, pos, _ = pool_strat(df, ww, **kk)
            nav = (1 + strat).cumprod()
            x = pd.to_datetime(nav.index)
        else:
            d = daily_table(df, ww, **kk)
            nav = d["nav"]
            x = pd.to_datetime(d["date"])
        ax.plot(x, nav, lw=1.6, label=label)
    ax.set_title(f"Top{top_n} 参数组合净值对比（防单点过拟合，看参数高原）")
    ax.set_ylabel("净值")
    ax.legend(fontsize=8)
    ax.grid(alpha=0.3)
    plt.tight_layout()
    path = os.path.join(out, "batch_nav_compare.png")
    plt.savefig(path, dpi=150)
    plt.close(fig)
    return path


# ────────────────────────── demo 数据 ──────────────────────────
def demo_df(n=900, seed=7) -> pd.DataFrame:
    """合成因子：与未来收益正相关（ρ≈0.3），用于管线自检，非真实结论"""
    rng = np.random.default_rng(seed)
    latent = np.zeros(n)
    for i in range(1, n):
        latent[i] = 0.9 * latent[i - 1] + rng.normal(0, 1)
    ret = 0.0003 + 0.010 * (latent / latent.std()) + rng.normal(0, 0.012, n)
    close = 3000 * np.exp(np.cumsum(ret))
    base = 50 + 25 * (latent / latent.std())[:, None] + rng.normal(0, 6, (n, 5))
    f = np.clip(base + rng.normal(0, 2, (n, 5)), 0, 100)
    df = pd.DataFrame(f, columns=["f1", "f2", "f3", "f4", "f5"])
    df.insert(0, "date", pd.bdate_range("2023-01-03", periods=n).strftime("%Y-%m-%d"))
    df["close"] = close.round(2)
    return df


# ────────────────────────── 主流程 ──────────────────────────
def main():
    global RF
    ap = argparse.ArgumentParser()
    ap.add_argument("--factors", help="因子 CSV（date,f1..f5,close[,regime]）")
    ap.add_argument("--demo", action="store_true", help="合成数据自检")
    ap.add_argument("--out", default="reports", help="输出目录")
    ap.add_argument("--fast", action="store_true", help="跳过全网格（仅基准+阈值+鲁棒性）")
    ap.add_argument("--rf", type=float, default=0.0, help="无风险利率年化（夏普计算，默认0）")
    ap.add_argument("--plot", action="store_true", help="输出净值+因子时序图 nav_factors.png")
    ap.add_argument("--report", action="store_true", help="按末日数据生成 Markdown 日报")
    ap.add_argument("--alerts", default="", help="当日辅助模块预警，逗号分隔（如 D大规模量价背离,P_突发黑天鹅）")
    ap.add_argument("--xlsx", action="store_true", help="导出回测结果 Excel（每日明细/交易明细/汇总指标三表）")
    ap.add_argument("--w1", type=float, default=None, help="自定义权重（给出任一 wi 即跳过网格，需 sum=1）")
    ap.add_argument("--w2", type=float, default=None)
    ap.add_argument("--w3", type=float, default=None)
    ap.add_argument("--w4", type=float, default=None)
    ap.add_argument("--w5", type=float, default=None)
    ap.add_argument("--lo", type=float, default=BASE_LO, help="开仓/持有阈值（默认65）")
    ap.add_argument("--hi", type=float, default=BASE_HI, help="减仓阈值（默认44）")
    ap.add_argument("--panic", type=float, default=PANIC, help="清仓阈值（默认24）")
    ap.add_argument("--overheat", type=float, default=OVERHEAT, help="过热阈值（默认80，只减不新建）")
    ap.add_argument("--max-pos", type=float, default=1.0, help="最大仓位上限 0~1（默认1）")
    ap.add_argument("--stop-loss", type=float, default=0.0, help="单笔止损（如 -0.08 启用；0=关闭）")
    ap.add_argument("--dd-trigger", type=float, default=0.0, help="回撤动态降仓触发（如 -0.15 启用；0=关闭）")
    ap.add_argument("--heatmap", action="store_true", help="阈值扫描热力图（lo×hi→夏普）")
    ap.add_argument("--batch-nav", type=int, default=0, metavar="N", help="TopN 参数组合净值对比图")
    ap.add_argument("--roll", action="store_true", help="滚动窗口样本外验证（rolling_test.csv）")
    ap.add_argument("--roll-refit", action="store_true", help="滚动验证逐窗重寻优阈值（walk-forward，较慢）")
    ap.add_argument("--train-win", type=int, default=252, help="滚动训练窗口（默认252交易日）")
    ap.add_argument("--test-win", type=int, default=63, help="滚动测试窗口（默认63交易日）")
    args = ap.parse_args()

    if not 0 < args.max_pos <= 1:
        raise SystemExit("--max-pos 须在 (0,1]")
    if args.stop_loss > 0:
        raise SystemExit("--stop-loss 须 ≤ 0（负数启用止损，0 关闭）")
    if args.dd_trigger > 0:
        raise SystemExit("--dd-trigger 须 ≤ 0（负数启用动态降仓，如 -0.15；0 关闭）")
    args.roll = args.roll or args.roll_refit   # refit 隐含启用滚动验证

    w_custom = [args.w1, args.w2, args.w3, args.w4, args.w5]
    if any(x is not None for x in w_custom):
        if any(x is None for x in w_custom):
            raise SystemExit("自定义权重需 --w1~--w5 五项齐全")
        if abs(sum(w_custom) - 1) > 1e-6:
            raise SystemExit(f"权重总和 {sum(w_custom):.4f} ≠ 1")
        w_custom = tuple(w_custom)
    else:
        w_custom = None    # 全部未传 → 置 None（[None]*5 是 truthy，直接 or 会踩坑）

    df = demo_df() if args.demo else pd.read_csv(args.factors)
    df.columns = [str(c).strip().lower() for c in df.columns]   # 兼容 Excel 模板 F1/F1 大小写
    missing = [c for c in ["date", "f1", "f2", "f3", "f4", "f5", "close"] if c not in df.columns]
    if missing:
        raise SystemExit(f"因子 CSV 缺列: {missing}（Excel 模板导出应含 date,f1..f5,close）")
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    os.makedirs(args.out, exist_ok=True)
    RF = args.rf
    th_kw = dict(hi=args.hi, lo=args.lo, panic=args.panic, overheat=args.overheat,
                 max_pos=args.max_pos, stop_loss=args.stop_loss, dd_trigger=args.dd_trigger)
    if is_pool(df):
        n_assets = df["asset_id"].nunique()
        print(f"[0/5] 检测到 asset_id 列 → 多标的等权轮动模式（{n_assets} 个标的）")

    print(f"[1/5] 基准绩效 …")
    base_p = perf_auto(df, w_custom or BASE_W, **th_kw)
    print(f"      {asdict(base_p)}")

    if w_custom is not None:
        best_w, best_p, scan = w_custom, base_p, None
        print(f"      使用自定义权重 w={w_custom}，跳过网格扫描")
    elif args.fast:
        best_w, best_p, scan = BASE_W, base_p, None
    else:
        print("[2/5] 权重网格扫描（3876 组，多进程并行）…")
        scan = grid_search(df)
        scan.to_csv(os.path.join(args.out, "weights_scan.csv"), index=False, encoding="utf-8-sig")
        bw = scan.iloc[0]
        best_w = (bw.w1, bw.w2, bw.w3, bw.w4, bw.w5)
        best_p = Perf(**{k: bw[k] for k in Perf.__dataclass_fields__})
        print(f"      最优 w={best_w} dd={best_p.max_dd} sharpe={best_p.sharpe}")

    print("[3/5] 阈值扫描 …")
    th = threshold_scan(df, best_w)
    th.to_csv(os.path.join(args.out, "threshold_scan.csv"), index=False, encoding="utf-8-sig")

    print("[4/5] 鲁棒性 …")
    noise = noise_test(df, best_w)
    split = split_test(df, best_w)
    regime = regime_report(df, best_w)
    regime.to_csv(os.path.join(args.out, "regime.csv"), index=False, encoding="utf-8-sig")

    roll = None
    if args.roll:
        print("[4.5] 滚动样本外验证 …")
        roll = rolling_test(df, best_w, args.train_win, args.test_win,
                            refit=args.roll_refit, **th_kw)
        roll.attrs.update(train_window=args.train_win, test_window=args.test_win,
                          refit=args.roll_refit)
        roll.to_csv(os.path.join(args.out, "rolling_test.csv"), index=False, encoding="utf-8-sig")
        rs = rolling_summary(roll)
        print(f"      {rs}")

    print("[5/5] 报告 …")
    path = write_report(args.out, base_p, best_w, best_p, th, noise, split, regime,
                        hi=args.hi, lo=args.lo, panic=args.panic, overheat=args.overheat,
                        max_pos=args.max_pos, stop_loss=args.stop_loss,
                        dd_trigger=args.dd_trigger, roll=roll)
    print("完成 →", os.path.abspath(path))

    if args.heatmap:
        p = plot_heatmap(th, "hi", "lo", args.out)
        print("热力图 →", os.path.abspath(p))
    if args.batch_nav:
        src = scan if scan is not None else th
        p = batch_nav_plot(df, src, args.out, w=best_w, top_n=args.batch_nav, **th_kw)
        print(f"Top{args.batch_nav} 净值对比 →", os.path.abspath(p))
    if args.plot:
        p = plot_results(df, best_w, args.out, **th_kw)
        print("图表 →", os.path.abspath(p))
    if args.xlsx:
        p = export_excel(df, best_w, args.out, **th_kw, rf=args.rf)
        print("Excel →", os.path.abspath(p))
    if args.report:
        alerts = [a.strip() for a in args.alerts.split(",") if a.strip()]
        p = generate_daily_report(df, best_w, alerts, args.out)
        print("日报 →", os.path.abspath(p))


if __name__ == "__main__":
    main()
