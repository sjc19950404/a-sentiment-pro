// 外围市场观测：解析 + 阈值判定。
// 夹具是 2026-09-30 美股收盘后从新浪抓到的**真实响应**（GBK 解码后原样保存）——
// 断言里的期望值全部来自该会话的公开收盘数据，不是回填的假数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseSinaVars, normalizeQuote, buildGlobalSnapshot, evaluateGlobalWatch, fmtPct, GLOBAL_SYMBOLS,
} from '../src/global.js';

const RAW = readFileSync(new URL('./fixtures/sina_global_20260930.txt', import.meta.url), 'utf8');
const SNAP = buildGlobalSnapshot({ raw: RAW, generatedAt: '2026-10-01T01:30:00Z', aShareTradeDate: '2026-09-30' });
const by = Object.fromEntries(SNAP.quotes.map((q) => [q.key, q]));
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}（容差 ${tol}）`);

// ── 解析 ──
test('16 个品种在真实响应里全部解析成功（漏抓会在这里暴露）', () => {
  assert.equal(SNAP.meta.quoteCount, GLOBAL_SYMBOLS.length);
  assert.equal(SNAP.meta.okCount, GLOBAL_SYMBOLS.length);
  assert.deepEqual(SNAP.meta.failed, []);
});

test('道指：现价/昨收/涨跌幅与公开收盘数据一致，且涨跌幅是算出来的而非抄字段', () => {
  near(by.dji.last, 50906.05);
  near(by.dji.prevClose, 51349.92);          // 昨收取自 [26]，不是用现价反推
  near(by.dji.chgPct, -0.8644, 0.001);
  assert.equal(by.dji.chgPctText, '-0.86%');
  near(by.dji.chgPctReported, -0.86);        // 源字段原值一并保留，可做口径漂移比对
});

test('纳指/标普 与报道一致；纳指收红、标普微跌（分化盘）', () => {
  near(by.ixic.chgPct, 0.237, 0.01);
  near(by.spx.chgPct, -0.2516, 0.01);
  assert.equal(by.ixic.chgPctText, '+0.24%');
});

test('费半收平：实际跌 0.0043%，显示必须是 0.00% 而不是 -0.00%', () => {
  assert.ok(by.sox.chgPct < 0, '费半当日确实是微跌（-0.54 点）');
  assert.ok(Math.abs(by.sox.chgPct) < 0.01);
  assert.equal(by.sox.chgPctText, '0.00%'); // 带负号会把「收平」读成「下跌」
});

test('fmtPct 抹掉负零，但不影响真正的负数', () => {
  assert.equal(fmtPct(-0.0043), '0.00%');
  assert.equal(fmtPct(-0.0043, 3), '-0.004%');
  assert.equal(fmtPct(-1.234), '-1.23%');
  assert.equal(fmtPct(0), '0.00%');
  assert.equal(fmtPct(null), '—');
});

test('港股用另一套字段布局（[6]现价 [3]昨收），解析结果自洽', () => {
  near(by.hsi.last, 24613.27);
  near(by.hsi.prevClose, 24523.57);
  near(by.hsi.chgPct, 0.3658, 0.01);
  assert.equal(by.hsi.sessionDate, '2026-09-30');
  near(by.hstech.chgPct, 0.1, 0.02);
});

test('A50 期货解析：现价取 [0]、昨收取 [7]（长假期间唯一实时锚）', () => {
  assert.ok(by.a50.ok);
  near(by.a50.prevClose, 13963, 0.01);
  assert.equal(by.a50.role, 'a_share_proxy');
  assert.equal(by.a50.dp, 1);
});

test('商品：WTI 昨收与公开报道的 90.42 精确吻合', () => {
  near(by.wti.prevClose, 90.42, 0.001);
  near(by.gold.prevClose, 4186.7, 0.01);
});

test('小数位按品种量级下发（美元指数 3 位、人民币 4 位、指数 2 位）', () => {
  assert.equal(by.dxy.lastText.split('.')[1].length, 3);
  assert.equal(by.cnh.lastText.split('.')[1].length, 4);
  assert.equal(by.dji.lastText.split('.')[1].length, 2);
});

test('人民币反号写在字段名里：USDCNH 上涨 → rmb_up_pct 为负（贬值）', () => {
  assert.ok(by.cnh.chgPct > 0, 'USDCNH 当日是上涨的（人民币贬值）');
  near(SNAP.rmb.usdcnh_chg_pct, by.cnh.chgPct, 1e-9);
  near(SNAP.rmb.rmb_up_pct, -by.cnh.chgPct, 1e-9);
  assert.ok(SNAP.rmb.rmb_up_pct < 0);
});

test('美股会话日取自 ET 时间戳，而不是北京日期', () => {
  assert.equal(SNAP.meta.usSessionDate, '2026-09-30'); // 北京已是 10-01，美股会话仍是 09-30
});

// ── 缺失与容错 ──
test('取不到的品种是 null，绝不写成 0（0 是真实行情值，缺失是缺失）', () => {
  const raw = 'var hq_str_gb_$dji="";\nvar hq_str_gb_sox="";';
  const s = buildGlobalSnapshot({ raw });
  const q = Object.fromEntries(s.quotes.map((x) => [x.key, x]));
  assert.equal(q.dji.ok, false);
  assert.equal(q.dji.last, null);
  assert.equal(q.dji.chgPct, null);
  assert.equal(q.dji.lastText, '—');
  assert.equal(s.meta.okCount, 0);
});

test('响应被截断/少了品种也能被发现：缺席的 code 同样计入 failed', () => {
  const s = buildGlobalSnapshot({ raw: 'var hq_str_gb_$dji="道琼斯,1,0,2026-10-01 04:00:00,0,1,1,1,1,1,0,0,0,0.00,--,0,0,0,0,0,0,0.0000,0,0.0000,,Sep 30 04:00PM EDT,1,0,1,2026";' });
  assert.equal(s.meta.okCount, 1);
  assert.equal(s.meta.failed.length, GLOBAL_SYMBOLS.length - 1); // 其余全是「没拿到」，不是 0
  assert.ok(!s.meta.failed.includes('dji'));
});

test('parseSinaVars 容忍空响应与缺字段，不抛错', () => {
  assert.deepEqual(parseSinaVars('var hq_str_xx="";'), { xx: [] });
  assert.deepEqual(parseSinaVars(''), {});
  const q = normalizeQuote({ key: 'foo', code: 'x', name: 'x', kind: 'us', role: 'us_index' }, []);
  assert.equal(q.ok, false);
  assert.equal(q.last, null);
});

// ── 阈值判定 ──
const watchOf = (map, rmb = {}) => evaluateGlobalWatch({
  quotes: Object.entries(map).map(([k, v]) => ({ key: k, ok: v != null, chgPct: v })),
  rmb,
});

test('费半跌超 2% → 电子链承压（warn）且整体判偏空', () => {
  const w = watchOf({ sox: -3 });
  assert.equal(w.signals[0].level, 'warn');
  assert.match(w.signals[0].text, /电子链/);
  assert.equal(w.bias, -2);
  assert.equal(w.verdict.key, 'negative');
});

test('费半微跌 0.5% → 落在阈值内，只报「无明确方向」；0.004% 的抖动不应带方向', () => {
  const w = watchOf({ sox: -0.5 });
  assert.equal(w.signals[0].level, 'info');
  assert.equal(w.bias, -0.5);
  assert.equal(w.verdict.key, 'neutral');
  const flat = watchOf({ sox: -0.0043 });
  assert.equal(flat.bias, 0); // 死区：0.05% 以内视为没动
  assert.equal(flat.verdict.key, 'neutral');
});

test('费半涨超 1.5% → 支撑（ok）', () => {
  const w = watchOf({ sox: 2 });
  assert.equal(w.signals[0].level, 'ok');
  assert.equal(w.bias, 2);
  assert.equal(w.verdict.key, 'positive');
});

test('A50 期货权重最高：-1.5% 单独就能把研判打到偏空', () => {
  const w = watchOf({ a50: -1.5 });
  assert.equal(w.signals[0].key, 'a50');
  assert.equal(w.signals[0].level, 'warn');
  assert.equal(w.bias, -3);
  assert.equal(w.verdict.key, 'negative');
});

test('美元指数走强与人民币贬值各算一条，且方向都是偏空', () => {
  const w = watchOf({ dxy: 1.0 }, { rmb_up_pct: -0.8 });
  const keys = w.signals.map((s) => s.key);
  assert.ok(keys.includes('dxy') && keys.includes('cnh'));
  assert.equal(w.signals.every((s) => s.level === 'warn'), true);
  assert.equal(w.bias, -3);
});

test('人民币升值 0.8% → 支撑；黄金大涨只算避险（偏空但弱）', () => {
  assert.equal(watchOf({}, { rmb_up_pct: 0.8 }).signals[0].level, 'ok');
  const g = watchOf({ gold: 2.5 });
  assert.equal(g.signals[0].key, 'gold');
  assert.equal(g.bias, -1);
});

test('中国金龙暴跌 3% → 外资 risk-off（-2），涨停/涨超则 +2', () => {
  assert.equal(watchOf({ hxc: -3.5 }).bias, -2);
  assert.equal(watchOf({ hxc: -3.5 }).verdict.key, 'negative');
  assert.equal(watchOf({ hxc: 2.5 }).bias, 2);
  assert.equal(watchOf({ hxc: 2.5 }).verdict.key, 'positive');
});

test('真实快照的研判：9-30 夜外围对 A 股不构成方向（中性）', () => {
  // A50 -0.34%、费半收平、金龙 +0.60% —— 三条都是「无明确方向」
  assert.equal(SNAP.watch.verdict.key, 'neutral');
  assert.ok(SNAP.watch.signals.every((s) => s.level === 'info'));
});

test('权重加总与 verdict 门槛自洽：|bias| ≥ 2 才给方向', () => {
  const w = watchOf({ sox: -2.0, a50: -0.5 });          // -2 + (-0.5) = -2.5
  assert.equal(w.bias, -2.5);
  assert.equal(w.verdict.key, 'negative');
  const n = watchOf({ a50: -0.5, sox: 0.5 });           // 两条 info，符号相抵 → 0
  assert.equal(n.bias, 0);
  assert.equal(n.verdict.key, 'neutral');
});

test('主锚必报、次锚触发才报：纳指在阈值内不占位，费半在阈值内必定出现', () => {
  const keys = (m, rmb) => watchOf(m, rmb).signals.map((s) => s.key);
  assert.ok(keys({ ixic: 0.3 }).length === 0, '纳指是次锚，未触发就静默');
  assert.deepEqual(keys({ sox: 0.3 }), ['sox'], '费半是主锚，未触发也要给出读数');
  assert.deepEqual(keys({ a50: 0.3 }), ['a50'], 'A50 是主锚');
  assert.deepEqual(keys({ hxc: 0.3 }), ['hxc'], '中国金龙是主锚');
});
