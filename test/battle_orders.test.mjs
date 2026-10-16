// 作战指令计算库单测（node --test）
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcLevels, fmt2, renderPreMarket, renderPostMarket } from '../src/battle_orders.js';

// 构造模拟日K：数值以字符串模拟腾讯源原始格式（测 Number 转换）
function mkBars(n, { close, high, low, vol }) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    bars.push([`2026-01-${String(i + 1).padStart(2, '0')}`, String(close - 0.1), String(close), String(high), String(low), String(vol)]);
  }
  return bars;
}

test('calcLevels: 字符串数值正常换算，价位合理', () => {
  const bars = mkBars(25, { close: 10, high: 11, low: 9, vol: 1000 });
  const r = calcLevels(bars);
  assert.ok(r, '应返回结果');
  assert.equal(r.prevClose, 10);
  // ma5=10, vwap=10, chipLower=9.7 → support=9.7
  assert.equal(r.support, 9.7);
  // 入手区间低→高
  assert.ok(r.entryLow <= r.entryHigh);
  assert.equal(r.entryLow, 9.7);
  assert.equal(r.entryHigh, 10);
  // 止损 = 区间下沿(9.7)下方1% ≈ 9.6
  assert.ok(Math.abs(r.stopLoss - 9.6) < 0.01);
});

test('calcLevels: 股价站上支撑时区间不倒置', () => {
  // 昨收低于支撑（支撑取 ma5，但 ma5>昨收）
  const bars = [
    ['d1', 9.5, 9.4, 9.6, 9.3, 1000],
    ['d2', 9.6, 9.5, 9.7, 9.4, 1000],
    ['d3', 9.7, 9.6, 9.8, 9.5, 1000],
    ['d4', 9.8, 9.7, 9.9, 9.6, 1000],
    ['d5', 9.9, 9.3, 10.0, 9.2, 1000], // 昨收 9.3（当天跌），但 ma5≈9.5 > 昨收
  ];
  const r = calcLevels(bars);
  assert.ok(r.entryLow < r.entryHigh, '区间应低→高');
  assert.ok(r.stopLoss < r.entryLow, '止损应在区间下沿下方');
});

test('calcLevels: 数据不足(<5根)返回 null', () => {
  const bars = mkBars(4, { close: 10, high: 11, low: 9, vol: 1000 });
  assert.equal(calcLevels(bars), null);
});

test('fmt2: 两位小数 + 非有限值占位', () => {
  assert.equal(fmt2(9.605), '9.61'); // 四舍五入
  assert.equal(fmt2(NaN), '—');
  assert.equal(fmt2(undefined), '—');
});

test('renderPreMarket: 数据不足个股被跳过 + 页脚免责', () => {
  const good = calcLevels(mkBars(25, { close: 10, high: 11, low: 9, vol: 1000 }));
  const md = renderPreMarket([
    { code: '000001', name: '测试股', levels: good },
    { code: '000002', name: '无数据', levels: null },
  ], '2026-10-16');
  assert.ok(md.includes('测试股(000001)'));
  assert.ok(!md.includes('无数据'));
  assert.ok(md.includes('非投资建议'));
  assert.ok(md.startsWith('## 📌 作战指令·盘前 2026-10-16'));
});

test('renderPostMarket: 盘后文案正确', () => {
  const good = calcLevels(mkBars(25, { close: 10, high: 11, low: 9, vol: 1000 }));
  const md = renderPostMarket([{ code: '000001', name: '测试股', levels: good }], '2026-10-16');
  assert.ok(md.includes('明日入手'));
  assert.ok(md.includes('非投资建议'));
});
