// 回测引擎测试：跨语言一致性（与 Python 工具夹具逐位比对）+ 语义断言 + 帕累托正确性
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BASE_PARAMS, V52_PARAMS, positions, turnoverCost, metrics, runBacktest, poolBacktest,
  paretoFrontier, weightGrid, scoreWith, gridSearch, sortByRank,
} from '../src/backtest.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/parity_v52.json', import.meta.url), 'utf8'));

// 夹具参数键（Python 命名）→ 引擎参数键
const toParams = (p) => ({
  hi: p.hi, lo: p.lo, panic: p.panic, overheat: p.overheat,
  maxPos: p.max_pos ?? 1.0, stopLoss: p.stop_loss ?? 0,
  ddTrigger: p.dd_trigger ?? 0, maxPosChg: p.max_pos_chg ?? 0,
  comm: p.comm ?? 0, stamp: p.stamp ?? 0, slip: p.slip ?? 0,
});

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol,
  `${msg}: JS=${a} PY=${b} 差=${Math.abs(a - b)} > ${tol}`);

const ints = ['trades', 'long_days', 'max_consec_loss'];

test('跨语言一致性：仓位/成本/策略收益/绩效 与 Python 夹具逐位一致', () => {
  for (const [name, c] of Object.entries(fx.single)) {
    const p = toParams(c.params);
    const r = runBacktest(fx.scores, fx.rets, p);
    r.pos.forEach((v, i) => close(v, c.positions[i], 1e-9, `${name}.positions[${i}]`));
    r.pos.forEach((_, i) => {
      const cost = turnoverCost(r.pos, p)[i];
      close(cost, c.cost[i], 1e-12, `${name}.cost[${i}]`);
      close(r.strat[i], c.strat[i], 1e-12, `${name}.strat[${i}]`);
    });
    const map = {
      total: 'total_ret', annual: 'annual', maxDd: 'max_dd', sharpe: 'sharpe',
      winRate: 'win_rate', profitRatio: 'profit_ratio', heldDays: 'long_days',
      emptyRatio: 'empty_ratio', opens: 'trades', calmar: 'calmar',
      sortino: 'sortino', maxConsecLoss: 'max_consec_loss',
    };
    for (const [js, py] of Object.entries(map)) {
      if (ints.includes(py)) assert.equal(r.perf[js], c.metrics[py], `${name}.${py}`);
      else close(r.perf[js], c.metrics[py], 1e-3, `${name}.${py}`);
    }
  }
});

test('跨语言一致性：多标的等权合成与 Python 夹具一致', () => {
  for (const [name, c] of Object.entries(fx.pool)) {
    const p = toParams(c.params);
    const { pos, strat, perf } = poolBacktest(fx.scores, fx.assets, p);
    pos.forEach((v, i) => close(v, c.pos[i], 1e-9, `pool.${name}.pos[${i}]`));
    strat.forEach((v, i) => close(v, c.strat[i], 1e-12, `pool.${name}.strat[${i}]`));
    close(perf.total, c.metrics.total_ret, 1e-3, `pool.${name}.total`);
    close(perf.maxDd, c.metrics.max_dd, 1e-3, `pool.${name}.maxDd`);
    assert.equal(perf.opens, c.metrics.trades, `pool.${name}.trades`);
  }
});

test('语义：T+1 生效——首日仓位恒为 0（信号只影响次日）', () => {
  const pos = positions([70, 70, 70], [0.01, 0.01, 0.01], BASE_PARAMS);
  assert.equal(pos[0], 0, '首日不建仓（T+1）');
  assert.equal(pos[1], 1, '首日强信号应在次日生效为满仓');
  assert.equal(pos.length, 3);
});

test('语义：过热区(≥overheat)只减仓不新建——空仓者保持空仓', () => {
  const pos = positions([85, 85, 85, 85], [0.01, 0.01, 0.01, 0.01], BASE_PARAMS);
  assert.deepEqual(pos, [0, 0, 0, 0]);
  // 已持仓者不新建但也未被清仓：先正常持有，再进入过热区
  const mixed = positions([70, 70, 85, 85, 85], [0.01, 0.01, 0.01, 0.01, 0.01], BASE_PARAMS);
  assert.equal(mixed[1], 1, '正常区满仓');
  assert.equal(mixed[2], 1, '过热区保持既有仓位（不清仓）');
});

test('语义：止损优先于仓位平滑（清仓跳变不受上限约束）', () => {
  const rets = [0, 0.001, 0.001, 0.001, 0.001, 0.001, -0.09, 0.001, 0.001];
  const scores = [70, 70, 70, 70, 70, 70, 70, 70, 70];
  const pos = positions(scores, rets, { ...BASE_PARAMS, maxPosChg: 0.2, stopLoss: -0.08 });
  assert.equal(pos[6], 1, '第6日前已渐近满仓');
  assert.equal(pos[7], 0, '第6日暴跌 9% → 次日强制清仓');
  assert.ok(Math.abs(pos[7] - pos[6]) > 0.2, '清仓跳变超过平滑上限 → 证明止损绕过平滑');
});

test('语义：仓位平滑把单日变动压在上限内（止损除外）', () => {
  const rets = new Array(12).fill(0.001);
  const scores = new Array(12).fill(70);
  const pos = positions(scores, rets, { ...BASE_PARAMS, maxPosChg: 0.2 });
  for (let i = 1; i < pos.length; i++) {
    assert.ok(Math.abs(pos[i] - pos[i - 1]) <= 0.2 + 1e-12, `第${i}日跳变超限`);
  }
  assert.equal(pos[pos.length - 1], 1, '持续强信号应最终到满仓');
});

test('语义：交易成本买卖不对称（卖出含印花税）', () => {
  const pos = [0.5, 1.0, 1.0, 0.0];
  const cost = turnoverCost(pos, { comm: 0.0003, stamp: 0.0005, slip: 0.0002 });
  close(cost[0], 0.5 * 0.0005, 1e-15, '首日建仓=买入口径');
  close(cost[1], 0.5 * 0.0005, 1e-15, '加仓=买入口径');
  assert.equal(cost[2], 0, '持仓不动无成本');
  close(cost[3], 1.0 * 0.001, 1e-15, '清仓=卖出口径(含印花税)');
});

test('帕累托：与 O(n²) 暴力法解集内容一致', () => {
  const rnd = (seed) => { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
  const r = rnd(7);
  const rows = Array.from({ length: 300 }, () => ({
    sharpe: r() * 4 - 2, maxDd: 0.05 + r() * 0.35, calmar: r() * 2 - 1,
  }));
  const fast = paretoFrontier(rows);
  const arr = rows.map((x) => [x.sharpe, x.maxDd]);
  const brute = rows.filter((_, i) => !arr.some(([s, d], j) => s > arr[i][0] + 1e-12 && d < arr[i][1] - 1e-12));
  const key = (x) => `${x.sharpe.toFixed(9)}|${x.maxDd.toFixed(9)}`;
  assert.deepEqual([...new Set(fast.map(key))].sort(), [...new Set(brute.map(key))].sort());
});

test('权重网格：和为 1，且全 1.0 步长时归一化等于基准权重', () => {
  const base = { a: 0.2, b: 0.3, c: 0.5 };
  const grid = weightGrid(base, [0.8, 1.0, 1.2]);
  assert.equal(grid.length, 27);
  for (const w of grid) close(Object.values(w).reduce((x, y) => x + y, 0), 1, 1e-12, '权重和');
  const one = weightGrid(base, [1.0])[0];
  for (const k of Object.keys(base)) close(one[k], base[k], 1e-12, `基准权重 ${k}`);
});

test('打分键校验：权重键与因子键完全错配时报错（防静默全 0 分）', () => {
  const factors = [{ s_net: 80, s_pos: 60 }];
  assert.throws(() => scoreWith(factors, { s_net20: 0.5, s_pos10: 0.5 }), /不匹配/);
  assert.deepEqual(scoreWith(factors, { s_net: 0.5, s_pos: 0.5 }), [70]);
});

test('网格寻优：结果非退化（回归：曾因权重键错配导致全部结果为 0）', () => {
  const days = 40;
  const factors = Array.from({ length: days }, (_, i) => ({
    s_net: 40 + (i * 7) % 55, s_pos: 35 + (i * 11) % 60, s_brd: 45 + (i * 3) % 50,
  }));
  const rets = { X: Array.from({ length: days }, (_, i) => Math.sin(i) * 0.01) };
  const base = { s_net: 0.4, s_pos: 0.3, s_brd: 0.3 };
  const scan = gridSearch(factors, rets, base, BASE_PARAMS, [0.8, 1.0, 1.2]);
  const uniq = new Set(scan.map((r) => `${r.sharpe}|${r.maxDd}`));
  assert.ok(uniq.size > 1, `网格结果应有多个不同结果，实际 ${uniq.size}`);
  assert.ok(scan.every((r) => Number.isFinite(r.sharpe)), '夏普应有限');
  assert.equal(sortByRank(scan)[0].maxDd, Math.min(...scan.map((r) => r.maxDd)), '排序首位应为最小回撤');
});

test('绩效指标：年化与最大回撤在构造序列上取预期值', () => {
  const strat = [0.01, -0.02, 0.03, -0.01];
  const pos = [1, 1, 1, 1];
  const m = metrics(strat, pos, 1);
  close(m.nav.at(-1), 1.01 * 0.98 * 1.03 * 0.99, 1e-12, '净值终值');
  close(m.maxDd, 1 - (1.01 * 0.98) / 1.01, 1e-12, '最大回撤');
  assert.equal(m.opens, 1);
  assert.equal(m.heldDays, 4);
  assert.equal(m.maxConsecLoss, 1);
});

test('默认参数：V5.2 增强口径只应在成本/风控维度区别于基准', () => {
  assert.equal(BASE_PARAMS.comm, 0);
  assert.equal(BASE_PARAMS.stopLoss, 0);
  assert.ok(V52_PARAMS.comm > 0 && V52_PARAMS.stopLoss < 0 && V52_PARAMS.maxPosChg > 0);
  assert.equal(BASE_PARAMS.hi, 44);
  assert.equal(BASE_PARAMS.lo, 65);
});
