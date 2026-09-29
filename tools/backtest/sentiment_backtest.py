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


# ────────────────────────── 打分与信号 ──────────────────────────
def score(df: pd.DataFrame, w) -> pd.Series:
    return (df["f1"] * w[0] + df["f2"] * w[1] + df["f3"] * w[2]
            + df["f4"] * w[3] + df["f5"] * w[4])


def positions(s: pd.Series, hi: float = BASE_HI, lo: float = BASE_LO) -> pd.Series:
    """收盘打分 → 次日仓位（T+1）。1 全仓 / 0.5 减仓 / 0 空仓。
    过热区(≥80)不清仓但禁止新建仓：对已有持仓保持，对空仓者保持空仓。"""
    pos = pd.Series(np.nan, index=s.index)
    held = False
    for i, v in enumerate(s.values):
        if v >= OVERHEAT:
            target = 1.0 if held else 0.0          # 只减仓不新建
        elif v >= lo:
            target = 1.0
        elif v > PANIC:
            target = 0.5
        else:
            target = 0.0
        held = target > 0 or (held and target > 0)
        pos.iloc[i] = target
    return pos.shift(1).fillna(0.0)                # T+1 生效


# ────────────────────────── 绩效计算 ──────────────────────────
def perf(df: pd.DataFrame, w, hi: float = BASE_HI, lo: float = BASE_LO) -> Perf:
    ret = df["close"].pct_change().fillna(0.0)
    pos = positions(score(df, w), hi, lo)
    strat = ret * pos
    equity = (1 + strat).cumprod()
    total = equity.iloc[-1] - 1
    n = len(df)
    annual = (1 + total) ** (ANN / n) - 1 if n > 0 and total > -1 else -1.0
    dd = (1 - equity / equity.cummax()).max()
    sd = strat.std(ddof=0)
    sharpe = strat.mean() / sd * math.sqrt(ANN) if sd > 1e-12 else 0.0
    held = strat[pos > 0]
    win = (held > 0).mean() if len(held) else 0.0
    gain = strat[strat > 0].sum()
    loss = -strat[strat < 0].sum()
    pr = gain / loss if loss > 1e-12 else float("inf")
    opens = int(((pos > 0) & (pos.shift(1) == 0)).sum())
    return Perf(round(total, 4), round(annual, 4), round(float(dd), 4),
                round(sharpe, 3), round(win, 4), round(pr, 3) if math.isfinite(pr) else 999,
                int((pos > 0).sum()), round(float((pos == 0).mean()), 4), opens)


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


def grid_search(df: pd.DataFrame, verbose=True) -> pd.DataFrame:
    rows = []
    grids = weight_grid()
    for i, w in enumerate(grids):
        p = perf(df, w)
        rows.append({"w1": w[0], "w2": w[1], "w3": w[2], "w4": w[3], "w5": w[4], **asdict(p)})
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
            p = perf(df, w, hi=float(hi), lo=float(lo))
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
        p = perf(noisy, w)
        dd.append(p.max_dd - base.max_dd)
        sh.append(p.sharpe - base.sharpe)
    return {"base": asdict(base),
            "dd_mean_delta": round(float(np.mean(dd)), 4),
            "sharpe_mean_delta": round(float(np.mean(sh)), 3),
            "sharpe_decay_pct": round(float(np.mean(sh)) / max(abs(base.sharpe), 1e-9) * 100, 1)}


def split_test(df: pd.DataFrame, w, train_frac=0.7) -> dict:
    k = int(len(df) * train_frac)
    return {"train": asdict(perf(df.iloc[:k], w)), "valid": asdict(perf(df.iloc[k:], w))}


# ────────────────────────── 失效场景 ──────────────────────────
def label_regimes(df: pd.DataFrame) -> pd.DataFrame:
    """无 regime 列时：按标的60日收益自动标注 bull/bear/other"""
    df = df.copy()
    if "regime" not in df.columns:
        r60 = df["close"].pct_change(60)
        df["regime"] = np.where(r60 > 0.10, "bull", np.where(r60 < -0.10, "bear", "other"))
    return df


def regime_report(df: pd.DataFrame, w) -> pd.DataFrame:
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
def write_report(out, base_p, best_w, best_p, th, noise, split, regime) -> str:
    th_top = th.head(5).to_string(index=False)
    md = f"""# Sentiment V5.0 权重敏感性回测报告

## 一、基准权重绩效（w1~w5 = {BASE_W}，阈值 hi={BASE_HI} lo={BASE_LO}）
```
{json.dumps(asdict(base_p), ensure_ascii=False, indent=2)}
```

## 二、最优权重组合（3876 组网格，步进 0.05，wi>=0.05）
最优：w1={best_w[0]} w2={best_w[1]} w3={best_w[2]} w4={best_w[3]} w5={best_w[4]}
```
{json.dumps(asdict(best_p), ensure_ascii=False, indent=2)}
```
（完整 3876 行见 weights_scan.csv；排序规则：最大回撤↑ → 夏普↓ → 年化↓）

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

*本报告由离线规则回测自动生成，非投资建议。*
"""
    path = os.path.join(out, "report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--factors", help="因子 CSV（date,f1..f5,close[,regime]）")
    ap.add_argument("--demo", action="store_true", help="合成数据自检")
    ap.add_argument("--out", default="reports", help="输出目录")
    ap.add_argument("--fast", action="store_true", help="跳过全网格（仅基准+阈值+鲁棒性）")
    args = ap.parse_args()

    df = demo_df() if args.demo else pd.read_csv(args.factors)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    os.makedirs(args.out, exist_ok=True)

    print(f"[1/5] 基准绩效 …")
    base_p = perf(df, BASE_W)
    print(f"      {asdict(base_p)}")

    if args.fast:
        best_w, best_p, scan = BASE_W, base_p, None
    else:
        print("[2/5] 权重网格扫描（3876 组）…")
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

    print("[5/5] 报告 …")
    path = write_report(args.out, base_p, best_w, best_p, th, noise, split, regime)
    print("完成 →", os.path.abspath(path))


if __name__ == "__main__":
    main()
