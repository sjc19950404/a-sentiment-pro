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

// ── 5 针升级（2026-11-09）：席位因子失效预警 + 博弈生态异动预警 ──
test('席位因子失效预警：连续 2 周 seatAlpha ≤ -5pp → alarm', () => {
  const r = judge(mk(Array(10).fill(0.01)), {
    seatWeeks: [
      { week: 'w1', seatAlpha: 0.01 }, { week: 'w2', seatAlpha: -0.06 }, { week: 'w3', seatAlpha: -0.07 },
    ],
  });
  assert.equal(r.status, 'alarm');
  assert.match(r.headline, /席位因子失效预警/);
  assert.equal(r.seatAlarm, true);
});

test('席位因子失效预警不误伤：单周 -6pp 但上一周为正 → 不告警', () => {
  const r = judge(mk(Array(10).fill(0.01)), {
    seatWeeks: [{ week: 'w1', seatAlpha: 0.02 }, { week: 'w2', seatAlpha: -0.06 }],
  });
  assert.notEqual(r.status, 'alarm');
});

test('博弈生态异动预警：分歧率 ≥P95 → alarm + divAlarm', () => {
  // 12 周：前 11 周低分歧（0~0.3），最后 1 周 0.7（≥P95）
  const divs = Array(11).fill(0).map((_, i) => ({ week: `w${i}`, rate: i % 2 ? 0.2 : 0.1 }));
  divs.push({ week: 'w11', rate: 0.7 });
  const r = judge(mk(Array(12).fill(0.01)), { divergWeeks: divs });
  assert.equal(r.status, 'alarm');
  assert.match(r.headline, /博弈生态异动预警/);
  assert.equal(r.divAlarm, true);
});

test('分歧观察带：≥P90 但 <P95 且未 3× 中位 → watch 含生态观察', () => {
  // 历史 14 周（含两个 0.6 抬 P95）+ cur=0.4：P95=0.6、P90=0.4 → cur 落在 [P90, P95) 观察带
  //   且未触发 3×中位（脚本已验证索引边界——手数分位索引两次出错，fixture 以脚本验证为准）
  const divs = [0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.2, 0.2, 0.6, 0.6].map((rate, i) => ({ week: `w${i}`, rate }));
  divs.push({ week: 'wN', rate: 0.4 });
  const r = judge(mk(Array(15).fill(0.01)), { divergWeeks: divs });
  assert.match(r.headline, /生态观察/);
});

test('无 extra（向后兼容）：单参调用行为与 3 针时代一致', () => {
  const r = judge(mk(Array(8).fill(0.01)));
  assert.equal(r.status, 'healthy');
  assert.equal(r.seatAlarm, false);
  assert.equal(r.divAlarm, false);
});

// ── 衰减归因（2026-11-09 外部拍板①）：三分类 + beta 辨析 ──
const mkMkt = (alphas, mkts) => alphas.map((a, i) => ({
  week: `2026-01-0${(i % 9) + 1}`, end: `2026-01-0${(i % 9) + 1}`,
  strat: a, mkt: mkts ? mkts[i] : 0, alpha: a, regime: 'ice', exposure: 0.5, days: 5,
}));

test('归因-结构衰减：分歧频率告警伴生 alpha 劣化 → structural', () => {
  const divs = Array(11).fill(0).map((_, i) => ({ week: `w${i}`, rate: i % 2 ? 0.2 : 0.1 }));
  divs.push({ week: 'w11', rate: 0.7 }); // ≥P95 → divAlarm
  const r = judge(mk(Array(12).fill(-0.005)), { divergWeeks: divs });
  assert.equal(r.status, 'alarm');
  assert.equal(r.attribution.type, 'structural');
  assert.equal(r.attribution.label, '结构衰减');
});

test('归因-拥挤衰减：席位过滤失效告警（生态正常）→ crowding', () => {
  const r = judge(mk(Array(12).fill(-0.005)), {
    seatWeeks: [{ week: 'w1', seatAlpha: 0.01 }, { week: 'w2', seatAlpha: -0.06 }, { week: 'w3', seatAlpha: -0.07 }],
  });
  assert.equal(r.status, 'alarm');
  assert.equal(r.attribution.type, 'crowding');
});

test('归因-beta 辨析：单周转负但 4 周基准为负且超额均值仍正 → 非因子衰减', () => {
  const weeks = mkMkt([...Array(7).fill(0.01), -0.005], [...Array(4).fill(0), -0.01, -0.01, -0.01, -0.01]);
  const r = judge(weeks);
  assert.equal(r.status, 'watch');
  assert.equal(r.attribution.type, 'beta');
  assert.match(r.attribution.label, /beta 下行/);
});

test('归因-时代衰减：连续 6+ 周温和负超额且生态/席位正常 → era', () => {
  const r = judge(mk(Array(10).fill(-0.002))); // negStreak=10，单周幅度小不触发拐头分位？仍 alarm（连续负）
  assert.equal(r.status, 'alarm');
  assert.equal(r.attribution.type, 'era');
});

test('归因-健康时为 null；warming 为 null', () => {
  assert.equal(judge(mk(Array(8).fill(0.01))).attribution, null);
  assert.equal(judge(mk([0.01, 0.01])).attribution, null);
});

test('归因-未归类：劣化但哨兵全正常且 negStreak<6 → unclassified', () => {
  // 8 周达标；2 连负触发 alarm，negStreak=2，无哨兵，mkt=0（不满足 beta）→ 未归类
  const r = judge(mk([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, -0.005, -0.005]));
  assert.equal(r.status, 'alarm');
  assert.equal(r.attribution.type, 'unclassified');
});
