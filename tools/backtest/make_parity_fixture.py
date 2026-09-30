#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成跨语言一致性夹具 test/fixtures/parity_v52.json。

用 Python 版（tools/backtest/sentiment_backtest.py，已多轮验证）计算 positions / turnover_cost /
_metrics 以及多标的等权合成的期望值，供 src/backtest.js 的 Node 单测逐位比对，
防止 JS 移植出现语义漂移。改动任一端的回测语义后必须重跑本脚本并提交新夹具：

    <gui312 venv python> make_parity_fixture.py
"""
import json
import os
import sys
from dataclasses import asdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sentiment_backtest as sb  # noqa: E402

FIXTURE = os.path.normpath(os.path.join(HERE, "..", "..", "test", "fixtures", "parity_v52.json"))
ASSETS = (("A", 1), ("B", 2), ("C", 3))

N = 40
SCORES = np.array([
    58, 70, 82, 66, 45, 30, 22, 12, 50, 67,
    72, 88, 90, 61, 47, 33, 20, 26, 55, 63,
    71, 79, 84, 69, 52, 41, 28, 18, 35, 60,
    68, 75, 81, 64, 48, 36, 25, 15, 44, 57,
], dtype=float)
RETS = np.round(np.random.default_rng(20260930).normal(0.001, 0.012, N), 6)
RETS[6] = -0.09      # 触发 -8% 止损
RETS[25] = -0.075    # 接近止损线但未触发
assert len(SCORES) == N

# 四个参数组合：基准 / 仅成本 / 全增强 / 更紧的仓位上限与降仓阈值
PARAM_SETS = {
    "base": {},
    "cost_only": dict(comm=0.0003, stamp=0.0005, slip=0.0002),
    "full": dict(comm=0.0003, stamp=0.0005, slip=0.0002, max_pos_chg=0.2,
                 stop_loss=-0.08, dd_trigger=-0.15, max_pos=1.0),
    "tight": dict(comm=0.0003, stamp=0.0005, slip=0.0002, max_pos_chg=0.35,
                  stop_loss=-0.05, dd_trigger=-0.08, max_pos=0.6),
}
TH = dict(hi=sb.BASE_HI, lo=sb.BASE_LO, panic=sb.PANIC, overheat=sb.OVERHEAT)

ASSET_RETS = {}
for name, seed in ASSETS:
    rr = np.round(np.random.default_rng(seed).normal(0.0008, 0.012, N), 6)
    if name == "B":
        rr[10] = -0.085            # 单标的独立触发止损
    ASSET_RETS[name] = rr


def leg(rr, scores, **kw):
    """单个标的：仓位 → 成本 → 策略收益（与 JS runBacktest 单腿同义）"""
    pos_kw = {k: kw[k] for k in ("max_pos", "stop_loss", "dd_trigger", "max_pos_chg") if k in kw}
    p = sb.positions(pd.Series(scores), ret=pd.Series(rr), **TH, **pos_kw)
    cost = sb.turnover_cost(p, kw.get("comm", 0.0), kw.get("stamp", 0.0), kw.get("slip", 0.0))
    return p, cost, pd.Series(rr) * p.values - cost


single, pool = {}, {}
for key, kw in PARAM_SETS.items():
    p, cost, strat = leg(RETS, SCORES, **kw)
    opens = int(((p > 0) & (p.shift(1) == 0)).sum())
    single[key] = {
        "params": {**TH, **kw},
        "positions": [round(float(x), 10) for x in p.tolist()],
        "cost": [round(float(x), 12) for x in cost.tolist()],
        "strat": [round(float(x), 12) for x in strat.tolist()],
        "metrics": asdict(sb._metrics(strat, p, opens)),
    }
    legs = [leg(ASSET_RETS[a], SCORES, **kw) for a, _ in ASSETS]
    strat_pool = np.mean([x[2].values for x in legs], axis=0)
    pos_pool = np.mean([x[0].values for x in legs], axis=0)
    opens_pool = sum(int(((x[0] > 0) & (x[0].shift(1) == 0)).sum()) for x in legs)
    pool[key] = {
        "params": {**TH, **kw},
        "strat": [round(float(x), 12) for x in strat_pool.tolist()],
        "pos": [round(float(x), 10) for x in pos_pool.tolist()],
        "metrics": asdict(sb._metrics(pd.Series(strat_pool), pd.Series(pos_pool), opens_pool)),
    }

out = {
    "meta": {
        "generatedBy": "tools/backtest/make_parity_fixture.py",
        "pythonTool": "tools/backtest/sentiment_backtest.py",
        "note": "JS 移植期望值：positions / turnover_cost / _metrics / 多标的等权合成",
        "n": N,
    },
    "scores": [float(x) for x in SCORES],
    "rets": [float(x) for x in RETS],
    "assets": {a: [float(x) for x in ASSET_RETS[a]] for a, _ in ASSETS},
    "single": single,
    "pool": pool,
}

os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
with open(FIXTURE, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f"夹具已写出 {FIXTURE}")
for k, v in single.items():
    m = v["metrics"]
    print(f"  single.{k}: 总收益={m['total_ret']} 夏普={m['sharpe']} 回撤={m['max_dd']} 开仓={m['trades']}")
for k, v in pool.items():
    m = v["metrics"]
    print(f"  pool.{k}:   总收益={m['total_ret']} 夏普={m['sharpe']} 回撤={m['max_dd']} 开仓={m['trades']}")
