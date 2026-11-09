import test from 'node:test';
import assert from 'node:assert/strict';
import { limitUpPct, isLimitUp, isLimitUpOld, LIMIT_CALIBER } from '../src/limit_caliber.js';

// C12（2026-11-09 用户拍板）：分板块涨停口径规格
test('limitUpPct：分板块阈值——主板10/创业科创20/ST5/北证30', () => {
  assert.equal(limitUpPct({ code: '600519' }), 10, '主板 60');
  assert.equal(limitUpPct({ code: '000001' }), 10, '主板 00');
  assert.equal(limitUpPct({ code: '002594' }), 10, '主板 002');
  assert.equal(limitUpPct({ code: '300750' }), 20, '创业板');
  assert.equal(limitUpPct({ code: '301236' }), 20, '创业板 301');
  assert.equal(limitUpPct({ code: '688981' }), 20, '科创板');
  assert.equal(limitUpPct({ code: '830799' }), 30, '北证 8');
  assert.equal(limitUpPct({ code: '430047' }), 30, '北证 4');
  assert.equal(limitUpPct({ code: '920001' }), 30, '北证 920');
  assert.equal(limitUpPct({ code: '600001', name: '*ST测试' }), 5, 'ST 主板 5%');
  assert.equal(limitUpPct({ code: '300001', name: 'ST创业' }), 5, 'ST 创业板仍 5%');
  assert.equal(limitUpPct({}), 10, '空入参保守按主板');
});

test('isLimitUp：容差 0.5pp——10cm 9.5 起算、20cm 19.5、5cm 4.5、30cm 29.5', () => {
  assert.equal(isLimitUp(9.5, { code: '600519' }), true);
  assert.equal(isLimitUp(9.4, { code: '600519' }), false, '9.4 未达主板容差');
  assert.equal(isLimitUp(9.99, { code: '300750' }), false, '20cm 票 +9.99% 不算涨停（旧口径 9.5 的核心误判）');
  assert.equal(isLimitUp(19.5, { code: '300750' }), true);
  assert.equal(isLimitUp(4.95, { code: '600001', name: 'ST测试' }), true, 'ST 5cm 命中');
  assert.equal(isLimitUp(5.2, { code: '600001', name: 'ST测试' }), true);
  assert.equal(isLimitUp(29.6, { code: '830799' }), true);
});

test('isLimitUp：非有限数不造数；旧口径封存判定保留可参照', () => {
  assert.equal(isLimitUp(null, { code: '600519' }), false);
  assert.equal(isLimitUp(undefined, {}), false);
  assert.equal(isLimitUp(NaN, { code: '300750' }), false);
  // 旧口径（对照工具专用，禁止新信号调用）：
  assert.equal(isLimitUpOld(9.6), true);
  assert.equal(isLimitUpOld(9.4), false);
  assert.equal(isLimitUpOld(15, 9.9), true, '9.9 阈值可显式传入（旧豁免闸口径）');
  // 命名常量（新旧两套口径分开，禁互相覆盖）
  assert.equal(LIMIT_CALIBER.OLD, 'v5.2-pro-old-limit');
  assert.equal(LIMIT_CALIBER.FIX, 'v5.2-pro-fix-limit');
});
