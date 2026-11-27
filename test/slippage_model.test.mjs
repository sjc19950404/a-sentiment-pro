import test from 'node:test';
import assert from 'node:assert/strict';
import { dynamicSlip, SLIP_PRESETS } from '../src/slippage_model.js';

test('slippage_model: 容量项——r 与冲击同向增长，当前规模可忽略量级', () => {
  const small = dynamicSlip({ buyAmt: 1e5, turnover: 1e8 });   // r=0.1%：模拟盘现状
  const big = dynamicSlip({ buyAmt: 1e6, turnover: 3e7 });     // r≈3.3%
  assert.ok(small > 0.0002, '容量项只在占比>0 时增量');
  assert.ok(small < 0.0004, `当前规模冲击可忽略（实测 ${small}）`);
  assert.ok(big > small, '占比越大冲击越大');
  const r5 = dynamicSlip({ buyAmt: 5e6, turnover: 1e8, r0: 0.05 });  // 旧口径显式 r0=0.05
  assert.ok(Math.abs(r5 - 0.0012) < 1e-9, '旧口径 r=5% → base+0.001=0.0012');
});

/* 【2026-11-27 拍板 B】默认口径分母=9:25 竞价额、r0=0.25（敏感性对照选定）。
 * 同一笔 10万/2000万竞价额（r=0.5%）：B 口径滑点应显著高于旧全天额口径。 */
test('slippage_model: 竞价额口径 r0=0.25 默认——同买入额滑点高于旧全天额口径', () => {
  const buy = 1e5, auctionAmt = 2e7, prevDayAmt = 6e8;   // 竞价额占全天 3.3%
  const b = dynamicSlip({ buyAmt: buy, turnover: auctionAmt });            // 默认 r0=0.25
  const old = dynamicSlip({ buyAmt: buy, turnover: prevDayAmt, r0: 0.05 }); // 旧口径显式
  /* 含 base=2bp 稀释，10万小额的总滑点放大约 1.3×；纯容量项放大 √(30/5)≈2.45×。 */
  assert.ok(b > old * 1.2, `竞价额口径应放大（B=${b} old=${old}）`);
  assert.ok(b < 0.005, '仍在千5封顶内');
  // 显式 r0 可复现旧值（对照通道）
  assert.ok(Math.abs(dynamicSlip({ buyAmt: 5e6, turnover: 1e8, r0: 0.05 }) - 0.0012) < 1e-9);
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

/* 【2026-11-27 拍板 B】paper 层 impactSlip 竞价额分支：开启+有竞价额走 dynamicSlip（纯增量），
 * 未开启/无竞价额 → 旧线性口径零变动（基线保护）。 */
test('impactSlip: 竞价额分支——显式开启才生效，缺额降级旧口径', async () => {
  const { impactSlip } = await import('../src/paper.js');
  const exec = { volImpactCoef: 0.02, auctionSlip: true };
  const withAuction = impactSlip(exec, { side: 'buy', notional: 1e5, auctionAmt: 2e7, amount: 6e8 });
  const noAuction = impactSlip(exec, { side: 'buy', notional: 1e5, amount: 6e8 });
  const off = impactSlip({ volImpactCoef: 0.02 }, { side: 'buy', notional: 1e5, auctionAmt: 2e7, amount: 6e8 });
  assert.ok(withAuction > noAuction, `竞价额口径应放大（${withAuction} > ${noAuction}）`);
  assert.equal(off, 0.02 * (1e5 / 6e8), '未开启 → 旧线性口径逐位不变');
  assert.equal(impactSlip(exec, { side: 'sell', notional: 1e5, auctionAmt: 2e7, amount: 6e8 }), 0.02 * (1e5 / 6e8), '卖出不接竞价额（涨停买专属）');
});
