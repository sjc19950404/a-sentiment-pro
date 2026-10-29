// 选股胜率复盘 · 纯函数归因测试：锁死整体/切片聚合的每一条计算，避免分母/盈亏比被悄悄改错。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeTrades, bandOf, holdDays, _stats } from '../src/select_attrition.js';

test('bandOf：情绪分分档（与 position_policy 阈值口径一致）', () => {
  assert.equal(bandOf(30), '冰点(<40)');
  assert.equal(bandOf(50), '中性(40-65)');
  assert.equal(bandOf(80), '发酵(>=65)');
  assert.equal(bandOf(null), '未知');
  assert.equal(bandOf(NaN), '未知');
});

test('holdDays：持有天数', () => {
  assert.equal(holdDays('2026-01-01', '2026-01-04'), 3);
  assert.equal(holdDays(null, '2026-01-04'), null);
  assert.equal(holdDays('bad', '2026-01-04'), null);
});

test('_stats：胜率 / 平均收益 / 盈亏比 计算', () => {
  // 2 盈(+0.10,+0.08) 2 亏(-0.05,-0.08)
  const arr = [{ ret: 0.10, win: true }, { ret: -0.05, win: false }, { ret: 0.08, win: true }, { ret: -0.08, win: false }];
  const s = _stats(arr);
  assert.equal(s.n, 4);
  assert.equal(s.winRate, 50);
  assert.ok(Math.abs(s.avgRet - 1.25) < 1e-9, `均收益应 1.25%，实得 ${s.avgRet}`);
  // 盈亏比 = sumWin/|sumLoss| = 0.18 / 0.13
  assert.ok(Math.abs(s.profitFactor - 0.18 / 0.13) < 1e-9, `盈亏比应 0.18/0.13，实得 ${s.profitFactor}`);
});

test('attributeTrades：整体 + 切片分组聚合', () => {
  const trades = [
    { ret: 0.10, win: true, weakToStrong: true, emotionBand: '冰点(<40)', sector: '半导体' },
    { ret: -0.20, win: false, weakToStrong: false, emotionBand: '发酵(>=65)', sector: '白酒' },
    { ret: 0.05, win: true, weakToStrong: true, emotionBand: '冰点(<40)', sector: '半导体' },
  ];
  const a = attributeTrades(trades);
  assert.equal(a.overall.n, 3);
  const wt = a.byWeakToStrong.find((g) => g.key === '弱转强');
  assert.equal(wt.n, 2); assert.equal(wt.winRate, 100);
  const eb = a.byEmotionBand.find((g) => g.key === '冰点(<40)');
  assert.equal(eb.n, 2);
  const sec = a.bySector.find((g) => g.key === '半导体');
  assert.equal(sec.n, 2);
});

test('attributeTrades：空输入零回归（不抛错）', () => {
  const a = attributeTrades([]);
  assert.equal(a.overall, null);
  assert.equal(a.byEmotionBand.length, 0);
  assert.equal(a.bySector.length, 0);
});

test('attributeTrades：弱转强三态（true/false/null 各自成组）', () => {
  const trades = [
    { ret: 0.10, win: true, weakToStrong: true },
    { ret: -0.05, win: false, weakToStrong: false },
    { ret: -0.10, win: false, weakToStrong: null },   // 回放无涨停池 → 未知
  ];
  const a = attributeTrades(trades);
  const keys = a.byWeakToStrong.map((g) => g.key);
  assert.ok(keys.includes('弱转强') && keys.includes('非弱转强') && keys.includes('未知(回放无涨停池)'), `三态应各自成组：${keys}`);
});

test('attributeTrades：盈亏比为 0 或 ∞ 的边界', () => {
  // 全亏 → sumWin=0 → profitFactor 0
  const allLoss = [{ ret: -0.05, win: false }, { ret: -0.10, win: false }];
  assert.equal(_stats(allLoss).profitFactor, 0);
  // 全盈 → sumLoss=0 → profitFactor ∞
  const allWin = [{ ret: 0.05, win: true }, { ret: 0.10, win: true }];
  assert.equal(_stats(allWin).profitFactor, Infinity);
});
