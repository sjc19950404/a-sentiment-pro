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
    assert.ok(!t.text.includes('甲'), 'seal 不再进报文（拍板 C：封板确认是事后信息，App 预警承担秒级）');
  assert.ok(t.text.includes('乙'), 'break 仍在报文');
  assert.equal(buildAlertText([{ code: 'x', name: '甲', kind: 'seal', label: '封板晋级' }], { bj: 'x' }), null, '纯 seal 事件 → null 不推');
  assert.ok(t.text.includes('基率非预测'));
  assert.equal(buildAlertText([], { bj: 'x' }), null);
  assert.equal(ALERT_DEFAULTS.caps.break, 3);
});

// ── 板块过滤（2026-11-11 拍板：A 涨幅≥2% + 普涨度>70%，白名单=实时强板块∪昨日主线）──
import { strongSectors } from '../src/first_board_alert.js';

test('fb_alert: strongSectors——涨幅≥2%且普涨度>70%；缺数据跳过', () => {
  const rows = [
    { sector: '影视院线', chg: 7.0, up: 12, down: 3 },   // 强
    { sector: '光伏设备', chg: 2.5, up: 8, down: 4 },    // 强（2.5≥2, 0.67? 8/12=0.667 ≤0.7 → 弱！）
    { sector: '游戏Ⅱ', chg: 2.5, up: 9, down: 3 },      // 强（0.75>0.7）
    { sector: '白酒', chg: 2.5, up: 4, down: 6 },        // 弱：普涨度 0.4
    { sector: '银行', chg: 1.5, up: 30, down: 12 },      // 弱：涨幅不够
  ];
  const s = strongSectors(rows);
  assert.ok(s.has('影视院线'));
  assert.ok(!s.has('光伏设备'), '8/12=0.667 未过 0.7 普涨度');
  assert.ok(s.has('游戏Ⅱ'));
  assert.ok(!s.has('白酒'));
  assert.ok(!s.has('银行'));
  assert.equal(s.get('影视院线').breadth, 0.8);
});

test('fb_alert: pushFilter——弱板块事件不推不计数、板块转强后新转移可推', () => {
  const weak = (sector) => sector === '光伏设备';   // 白名单只含光伏设备（模拟 shouldPush）
  const S = (sector, last, high, chg) => ({ code: '600001', name: '甲', sector, quote: { last, high, chg }, limitPrice: 10 });
  // 弱板块票封板：不产生事件（不推），但状态推进
  let r = detectEvents(null, [S('白酒', 10.0, 10.0, 9.98)], { pushFilter: weak });
  assert.equal(r.events.length, 0, '白名单外事件不产生');
  assert.equal(r.state.stocks['600001'].pos, 'sealed', '状态照常推进不丢');
  // 弱板块持续封板 → 无新事件
  r = detectEvents(r.state, [S('白酒', 10.0, 10.0, 9.98)], { pushFilter: weak });
  assert.equal(r.events.length, 0);
  // 白名单内票正常推
  const r2 = detectEvents(null, [S('光伏设备', 10.0, 10.0, 9.98)], { pushFilter: weak });
  assert.equal(r2.events.length, 1);
  assert.equal(r2.events[0].sector, '光伏设备');
  // 无 pushFilter（默认放行）——板块排行失败的降级路径
  const r3 = detectEvents(null, [S(null, 10.0, 10.0, 9.98)]);
  assert.equal(r3.events.length, 1, '无过滤钩子时全放行（fail-open）');
});

// ── 加速预警（2026-11-11 拍板 C：1分钟涨速差分）──
test('fb_alert: 加速事件——两tick差分≥accelPct 触发,每票每日限1次,sealed/touched不触发', () => {
  const mk = (chg) => ({ code: '600003', name: '丙', sector: '半导体', dtRebound: false, quote: { chg, lastPrice: 10, limitPrice: 11 } });
  const r1 = detectEvents(null, [mk(4.0)], { pushFilter: () => true });
  assert.equal(r1.events.filter((e) => e.kind === 'accel').length, 0, '首tick无prev.chg → 无差分不触发');
  const r2 = detectEvents(r1.state, [mk(6.8)], { pushFilter: () => true });
  const acc = r2.events.filter((e) => e.kind === 'accel');
  assert.equal(acc.length, 1, '涨2.8个点≥2.5 → 加速');
  assert.ok(acc[0].label.includes('2.8'), '文案含涨速');
  assert.equal(detectEvents(r2.state, [mk(9.7)], { pushFilter: () => true }).events.filter((e) => e.kind === 'accel').length, 0, '同票第二次不推（限1次）');
  // sealed 不触发
  const sealed = { code: '600004', name: '丁', sector: 's', dtRebound: false, quote: { chg: 4, lastPrice: 10, limitPrice: 11 } };
  const s1 = detectEvents(null, [sealed], { pushFilter: () => true });
  const s2 = detectEvents(s1.state, [{ ...sealed, quote: { chg: 10.02, lastPrice: 11, limitPrice: 11 } }], { pushFilter: () => true });
  assert.ok(s2.events.some((e) => e.kind === 'seal'), 'state记录seal');
  assert.equal(s2.events.filter((e) => e.kind === 'accel').length, 0, 'sealed 状态不触发加速');
  assert.ok(s2.state.stocks['600004'].chg === 10.02, 'state存chg供下tick差分');
});
