import test from 'node:test';
import assert from 'node:assert/strict';
import { dynamicSlip, SLIP_PRESETS } from '../src/slippage_model.js';

test('slippage_model: 容量项——r 与冲击同向增长，当前规模可忽略量级', () => {
  const small = dynamicSlip({ buyAmt: 1e5, turnover: 1e8 });   // r=0.1%：模拟盘现状
  const big = dynamicSlip({ buyAmt: 1e6, turnover: 3e7 });     // r≈3.3%
  assert.ok(small > 0.0002, '容量项只在占比>0 时增量');
  assert.ok(small < 0.0004, `当前规模冲击可忽略（实测 ${small}）`);
  assert.ok(big > small, '占比越大冲击越大');
  const r5 = dynamicSlip({ buyAmt: 5e6, turnover: 1e8 });      // r=5% → +0.001
  assert.ok(Math.abs(r5 - 0.0012) < 1e-9, 'r=5% 时 base+0.001=0.0012');
});

test('slippage_model: 乘数与封顶——封单薄弱×1.5、炸板×1.2、合计封顶千5', () => {
  const base = dynamicSlip({ buyAmt: 1e5, turnover: 1e8 });
  assert.ok(Math.abs(dynamicSlip({ buyAmt: 1e5, turnover: 1e8, sealWeak: true }) / base - 1.5) < 1e-9);
  assert.ok(Math.abs(dynamicSlip({ buyAmt: 1e5, turnover: 1e8, reopen: true }) / base - 1.2) < 1e-9);
  assert.equal(dynamicSlip({ buyAmt: 1e9, turnover: 1e8, sealWeak: true, reopen: true }), 0.005, '封顶千5');
});

test('slippage_model: 数据缺失不造数——null 回落（调用方回落固定档）', () => {
  assert.equal(dynamicSlip(), null, '全缺 → null');
  assert.ok(Math.abs(dynamicSlip({ sealWeak: true }) - 0.0003) < 1e-12, '只有乘数依据 → base×1.5 可判');
  assert.equal(dynamicSlip({ buyAmt: null, turnover: 1e8 }), null, '半缺也不算容量项');
});

test('slippage_model: SLIP_PRESETS——low 恒等于 V52 现行值（旧口径锚点）', () => {
  assert.equal(SLIP_PRESETS.low, 0.0002);
  assert.ok(SLIP_PRESETS.low < SLIP_PRESETS.mid);
  assert.ok(SLIP_PRESETS.mid < SLIP_PRESETS.high);
});
