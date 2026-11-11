import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regimeTier, adjustThreshold, REGIME_THRESHOLD_DEFAULTS } from '../src/regime_threshold.js';

test('regime_threshold: 六态映射——热/冷/中性/未知', () => {
  assert.equal(regimeTier('高潮'), 'hot');
  assert.equal(regimeTier('主升'), 'hot');
  assert.equal(regimeTier('冰点'), 'cold');
  assert.equal(regimeTier('退潮'), 'cold');
  assert.equal(regimeTier('复苏'), 'neutral');
  assert.equal(regimeTier('震荡'), 'neutral');
  assert.equal(regimeTier('no_data'), null);
  assert.equal(regimeTier(null), null);
  assert.equal(regimeTier(undefined), null);
});

test('regime_threshold: 约定②审计字段完整 {key,base,regime,multiplier,final,adjusted}', () => {
  const a = adjustThreshold('approachPct', 7, '高潮');
  assert.deepEqual(Object.keys(a).sort(), ['adjusted', 'base', 'final', 'key', 'multiplier', 'regime', 'tier']);
  assert.equal(a.key, 'approachPct');
  assert.equal(a.base, 7);
  assert.equal(a.regime, '高潮');
  assert.equal(a.multiplier, 1.15);
  assert.equal(a.final, 8.05);
  assert.equal(a.adjusted, true);
});

test('regime_threshold: 约定③数据缺失/异常 → 直接返回基准值不报错', () => {
  for (const label of [null, undefined, '', 'no_data', '震荡', '复苏', '未知状态']) {
    const a = adjustThreshold('approachPct', 7, label);
    assert.equal(a.final, 7, `regime=${label} → 基准`);
    assert.equal(a.multiplier, 1);
    assert.equal(a.adjusted, false);
  }
  // 基准非法也原样返回
  const bad = adjustThreshold('approachPct', null, '高潮');
  assert.equal(bad.final, null);
  assert.equal(bad.adjusted, false);
});

test('regime_threshold: 冷档放宽 + 乘数限幅 clamp[0.7,1.3]', () => {
  const c = adjustThreshold('approachPct', 7, '冰点');
  assert.equal(c.final, 5.95);   // 7×0.85
  assert.equal(c.tier, 'cold');
  // 超限乘数被 clamp（配置覆盖模拟：乘数 2 → 限到 1.3）
  const clamped = adjustThreshold('approachPct', 7, '高潮', { multipliers: { hot: { approachPct: 2 } } });
  assert.equal(clamped.multiplier, 1.3);
  assert.equal(clamped.final, 9.1);
});

test('regime_threshold: 约定④v1 只接两 key——其他 key 不受范式影响', () => {
  const untouched = adjustThreshold('oneZiRatioMax', 0.02, '高潮');
  assert.equal(untouched.final, 0.02, '未注册乘数的 key 回基准');
  assert.equal(REGIME_THRESHOLD_DEFAULTS.multipliers.hot.oneZiRatioMax, undefined);
});
