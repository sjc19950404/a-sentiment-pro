import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustThreshold, regimeTier, REGIME_THRESHOLD_DEFAULTS } from '../src/regime_threshold.js';

test('regime_threshold: 六态映射——高潮/主升→hot，冰点/退潮→cold，复苏/震荡→neutral', () => {
  assert.equal(regimeTier('高潮'), 'hot');
  assert.equal(regimeTier('主升'), 'hot');
  assert.equal(regimeTier('冰点'), 'cold');
  assert.equal(regimeTier('退潮'), 'cold');
  assert.equal(regimeTier('复苏'), 'neutral');
  assert.equal(regimeTier('震荡'), 'neutral');
});

test('regime_threshold: 约定③——缺失/未知/no_data → 回基准不猜（regime 如实留痕，tier=null 表示不认识）', () => {
  for (const s of [null, undefined, '', 'no_data', '乱写的状态']) {
    const r = adjustThreshold('approachPct', 7, s);
    assert.equal(r.adjusted, false, `状态 ${JSON.stringify(s)} → 不调整`);
    assert.equal(r.final, 7);
    assert.equal(r.multiplier, 1);
    assert.equal(r.regime, s || null, 'regime 审计字段如实记录传入标签（空 → null）');
    assert.equal(r.tier, null, '不认识的标签 tier=null');
  }
});

test('regime_threshold: 审计字段完整（约定②）——key/base/regime/multiplier/final 全在', () => {
  const r = adjustThreshold('approachPct', 7, '高潮');
  for (const k of ['key', 'base', 'regime', 'multiplier', 'final', 'adjusted']) assert.ok(k in r, `缺 ${k}`);
  assert.equal(r.key, 'approachPct');
  assert.equal(r.base, 7);
  assert.equal(r.regime, '高潮');
  assert.equal(r.multiplier, 1.15);
  assert.equal(r.final, 8.05);
  assert.equal(r.adjusted, true);
});

test('regime_threshold: 乘数与方向——hot 收紧 / cold 放宽；两 key 独立', () => {
  assert.equal(adjustThreshold('approachPct', 7, '高潮').final, 8.05);     // 7×1.15
  assert.equal(adjustThreshold('approachPct', 7, '冰点').final, 5.95);     // 7×0.85
  assert.equal(adjustThreshold('sectorMinChg', 2, '高潮').final, 2.5);     // 2×1.25
  assert.equal(adjustThreshold('sectorMinChg', 2, '冰点').final, 1.5);     // 2×0.75
  // 未接入的 key（第二步：竞价/封单/一字）→ 基准
  assert.equal(adjustThreshold('jjPctThreshold', 3, '高潮').adjusted, false);
});

test('regime_threshold: 限幅 clamp [0.7,1.3]——超限乘数被夹住', () => {
  const opts = { multipliers: { hot: { approachPct: 2.0 } } };
  const r = adjustThreshold('approachPct', 7, '高潮', opts);
  assert.equal(r.multiplier, 1.3, '2.0 被夹到上限 1.3');
  assert.equal(r.final, 9.1);
});

test('regime_threshold: 基准非法 → 原样返回不猜', () => {
  const r = adjustThreshold('approachPct', null, '高潮');
  assert.equal(r.adjusted, false);
  assert.equal(r.final, null);
  assert.equal(r.multiplier, 1);
});

test('regime_threshold: config 覆盖通道——opts 传入乘数表生效（config.paper.regimeThreshold 原样透传）', () => {
  const opts = { multipliers: { hot: { approachPct: 1.0 } }, clamp: [0.5, 2] };
  const r = adjustThreshold('approachPct', 7, '高潮', opts);
  assert.equal(r.final, 7, '乘数 1.0 → 不变（adjusted=false）');
  assert.equal(REGIME_THRESHOLD_DEFAULTS.multipliers.hot.approachPct, 1.15, '内置默认不被污染');
});
