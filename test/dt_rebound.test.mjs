import test from 'node:test';
import assert from 'node:assert/strict';
import { posOf, detectEvents, buildAlertText, DT_DEFAULTS } from '../src/dt_rebound.js';

// 昨收 10.00 → 跌停 9.00 / 涨停 11.00（简化 ±10）
const snap = (code, name, last, chg) =>
  ({ code, name, quote: { last, chg }, dtPrice: 9.00, limitPrice: 11.00 });

test('dt_rebound: posOf 四态——封死跌停/脱离/翻红/反包涨停', () => {
  assert.equal(posOf({ last: 9.00, chg: -10 }, 9.00, 11.00), 'dt');
  assert.equal(posOf({ last: 9.50, chg: -5 }, 9.00, 11.00), 'lifted');
  assert.equal(posOf({ last: 10.10, chg: 1.0 }, 9.00, 11.00), 'red');
  assert.equal(posOf({ last: 11.00, chg: 10 }, 9.00, 11.00), 'sealed');
  assert.equal(posOf({ last: null, chg: null }, 9.00, 11.00), null, '缺失不猜');
});

test('dt_rebound: 全链——脱离跌停→翻红→地天封板→炸板，各事件一次', () => {
  let r = detectEvents(null, [snap('000520', '凤凰', 9.00, -10)]);
  assert.deepEqual(r.events, [], '封死跌停无事件（观察起点）');
  r = detectEvents(r.state, [snap('000520', '凤凰', 9.55, -4.5)]);
  assert.equal(r.events[0].kind, 'lift');
  r = detectEvents(r.state, [snap('000520', '凤凰', 10.20, 2.0)]);
  assert.equal(r.events[0].kind, 'red');
  r = detectEvents(r.state, [snap('000520', '凤凰', 11.00, 10)]);
  assert.equal(r.events[0].kind, 'seal');
  assert.ok(r.events[0].label.includes('地天'));
  r = detectEvents(r.state, [snap('000520', '凤凰', 10.40, 4.0)]);
  assert.equal(r.events[0].kind, 'dtBreak');
  // 频控：lift/red/seal 各1已用完，同方向再走不重报；dtBreak 还有 1 次额度
  r = detectEvents(r.state, [snap('000520', '凤凰', 11.00, 10)]);
  assert.equal(r.events.length, 0, 'seal 频控 1 已用完');
});

test('dt_rebound: 日 cap40 与频控常量', () => {
  const snaps = Array.from({ length: 45 }, (_, i) => snap(`0005${String(i).padStart(2, '0')}`.slice(-6), 'X' + i, 11.0, 10));
  const r = detectEvents({ notified: 38, stocks: {} }, snaps);
  assert.equal(r.events.length, 2, '日总额 40 封顶');
  assert.equal(DT_DEFAULTS.caps.dtBreak, 2);
});

test('dt_rebound: 报文——seal/dtBreak 排最前；空事件 null', () => {
  const t = buildAlertText([
    { code: '1', name: '甲', kind: 'lift', label: '脱离跌停（昨日跌停今日拉起）' },
    { code: '2', name: '乙', kind: 'seal', label: '反包封板——地天板达成' },
  ], { bj: '10:15' });
  assert.ok(t.text.startsWith('💪【跌停反包盯盘】10:15'));
  assert.ok(t.text.indexOf('乙') < t.text.indexOf('甲'), '地天达成排最前');
  assert.equal(buildAlertText([], { bj: 'x' }), null);
});
