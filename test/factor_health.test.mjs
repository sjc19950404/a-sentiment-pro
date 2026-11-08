// 因子健康度仪表·判定引擎测试（2026-11-09，外部拍板规格的三态边界全覆盖）
// 纯函数 judge(regimeBreakdown) 来自 src/factor_health.js（零 IO 零副作用）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, weekKey } from '../src/factor_health.js';

// 合成周序列：alpha 固定值填充
const mk = (alphas) => alphas.map((a, i) => ({
  week: `2026-01-0${(i % 9) + 1}`, end: `2026-01-0${(i % 9) + 1}`,
  strat: a, mkt: 0, alpha: a, regime: 'ice', exposure: 0.5, days: 5,
}));

test('warming：历史 <8 周——只报数据不判定', () => {
  const r = judge(mk([0.01, 0.01, 0.01]));
  assert.equal(r.status, 'warming');
  assert.equal(r.alphaWinRate8, null);
});

test('healthy：8 周全正超额、最新周正、无连续负', () => {
  const r = judge(mk(Array(8).fill(0.01)));
  assert.equal(r.status, 'healthy');
  assert.equal(r.alphaWinRate8, 1);
});

test('watch：单周超额转负（其余全正）', () => {
  const r = judge(mk([...Array(7).fill(0.01), -0.005]));
  assert.equal(r.status, 'watch');
  assert.match(r.headline, /单周超额转负/);
});

test('watch：胜率 50% 落入 48~52 观察带（4/8 正，负周互不相邻 negStreak=1）', () => {
  const r = judge(mk([0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01]));
  assert.equal(r.status, 'watch');
  assert.match(r.headline, /观察带/);
});

test('alarm：连续 2 周负超额', () => {
  const r = judge(mk([...Array(6).fill(0.01), -0.01, -0.01]));
  assert.equal(r.status, 'alarm');
  assert.match(r.headline, /连续 2 周负超额/);
});

test('alarm：胜率 <48%（3/8 正）', () => {
  const r = judge(mk([0.01, 0.01, 0.01, -0.005, -0.005, -0.005, -0.005, -0.005]));
  assert.equal(r.status, 'alarm');
  assert.match(r.headline, /< 48%/);
});

test('alarm：4 周均值拐头向下（≥12 周，ma4 分位 <30% 且为负）', () => {
  const r = judge(mk([...Array(12).fill(0.02), -0.01, -0.01, -0.01, -0.01]));
  assert.equal(r.status, 'alarm');
  assert.match(r.headline, /拐头向下/);
});

test('判定优先级：连续负超额（alarm）压过胜率观察带（watch）', () => {
  // 3/8 正 → 胜率告警 + 仅结尾连续 2 负 → 两个告警理由合并
  const r = judge(mk([-0.005, 0.01, -0.005, 0.01, -0.005, 0.01, -0.01, -0.01]));
  assert.equal(r.status, 'alarm');
  assert.match(r.headline, /连续 2 周负超额/);
  assert.match(r.headline, /< 48%/);
});

test('weekKey：周一为周起点，跨周日正确归周', () => {
  assert.equal(weekKey('2026-11-09'), '2026-11-09'); // 周一 → 本周一
  assert.equal(weekKey('2026-11-08'), '2026-11-02'); // 周日 → 上周一
  assert.equal(weekKey('2026-11-06'), '2026-11-02'); // 周五 → 本周一
});
