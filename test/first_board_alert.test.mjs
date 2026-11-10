import test from 'node:test';
import assert from 'node:assert/strict';
import { posOf, detectEvents, buildAlertText, ALERT_DEFAULTS } from '../src/first_board_alert.js';

const snap = (code, name, last, high, chg, limitPrice = 10.00) =>
  ({ code, name, quote: { last, high, chg }, limitPrice });

test('fb_alert: posOf 快照态判定——封板/摸板/逼近/未启动', () => {
  assert.equal(posOf({ last: 10.00, high: 10.00, chg: 9.98 }, 10.00), 'sealed');
  assert.equal(posOf({ last: 9.80, high: 10.00, chg: 7.8 }, 10.00), 'touched');
  assert.equal(posOf({ last: 9.30, high: 9.40, chg: 7.2 }, 10.00), 'approaching');
  assert.equal(posOf({ last: 9.00, high: 9.10, chg: 3.0 }, 10.00), 'none');
  assert.equal(posOf({ last: null, high: null, chg: null }, 10.00), null, '数据缺失不猜');
});

test('fb_alert: 状态机——封板→炸板→回封 全链事件', () => {
  // 第一轮：3% 未启动 → 无事件
  let r = detectEvents(null, [snap('600001', '甲', 9.10, 9.20, 3.0)]);
  assert.deepEqual(r.events, []);
  const s1 = r.state;
  // 第二轮：冲到 7.2% 首进逼近区 → approach 事件
  r = detectEvents(s1, [snap('600001', '甲', 9.30, 9.40, 7.2)]);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].kind, 'approach');
  // 第四轮：摸板 9.85 → touch 事件
  r = detectEvents(s1, [snap('600001', '甲', 9.85, 10.00, 8.5)]);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].kind, 'touch');
  // 第三轮：封板 → seal 事件
  r = detectEvents(r.state, [snap('600001', '甲', 10.00, 10.00, 9.98)]);
  assert.equal(r.events[0].kind, 'seal');
  assert.ok(r.events[0].label.includes('封板晋级'));
  // 第五轮：炸板 → break 事件
  r = detectEvents(r.state, [snap('600001', '甲', 9.60, 10.00, 6.0)]);
  assert.equal(r.events[0].kind, 'break');
  assert.ok(r.events[0].label.includes('炸板'));
  // 第六轮：回封 → seal 事件（语义=回封）
  r = detectEvents(r.state, [snap('600001', '甲', 10.00, 10.00, 9.98)]);
  assert.equal(r.events[0].kind, 'seal');
  assert.ok(r.events[0].label.includes('回封'));
});

test('fb_alert: 频控——break 每票 3 次封顶、approach 首次进入才报、日 cap60', () => {
  // approach: none→approaching 报一次，approaching 持续不再报
  let r = detectEvents(null, [snap('600001', '甲', 9.30, 9.40, 7.2)]);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].kind, 'approach');
  r = detectEvents(r.state, [snap('600001', '甲', 9.35, 9.40, 7.5)]);
  assert.equal(r.events.length, 0, 'approaching 持续不重复报');
  // break 三次后封顶：seal→break→(回封)→break→(回封)→break→(回封)→break 被拦
  let st = null; const kinds = [];
  const seq = [[10.00, 10.00, 9.98], [9.5, 10.00, 5.0], [10.00, 10.00, 9.98], [9.5, 10.00, 5.0], [10.00, 10.00, 9.98], [9.5, 10.00, 5.0], [10.00, 10.00, 9.98], [9.5, 10.00, 5.0], [10.00, 10.00, 9.98], [9.5, 10.00, 5.0]];
  for (const [last, high, chg] of seq) {
    const rr = detectEvents(st, [snap('600002', '乙', last, high, chg)]);
    rr.events.forEach((e) => kinds.push(e.kind));
    st = rr.state;
  }
  assert.equal(kinds.filter((k) => k === 'break').length, 3, 'break 频控 3 次');
  assert.equal(kinds.filter((k) => k === 'seal').length, 2, 'seal 频控 2 次（首封+1回封）');
  // 日 cap60：60 事件后不再发
  const snaps = Array.from({ length: 70 }, (_, i) => snap(`6000${String(i).padStart(2, '0')}`.slice(0, 6), 'X' + i, 10.0, 10.0, 9.98));
  const r2 = detectEvents({ notified: 55, stocks: {} }, snaps);
  assert.equal(r2.events.length, 5, '日总额 60 封顶');
});

test('fb_alert: 报文——分级排序(炸板最先)+基率声明；无事件 null', () => {
  const t = buildAlertText([
    { code: '600001', name: '甲', kind: 'seal', label: '封板晋级 2 板', chg: 9.98 },
    { code: '600002', name: '乙', kind: 'break', label: '炸板！昨封今摸板后回落，现涨幅 +5.0%', chg: 5.0 },
  ], { bj: '10:01', baseRate: 16.5 });
  assert.ok(t.text.startsWith('🚨【首板晋级盯盘】10:01'));
  assert.ok(t.text.indexOf('乙') < t.text.indexOf('甲'), '炸板排在封板前');
  assert.ok(t.text.includes('基率非预测'));
  assert.equal(buildAlertText([], { bj: 'x' }), null);
  assert.equal(ALERT_DEFAULTS.caps.break, 3);
});
