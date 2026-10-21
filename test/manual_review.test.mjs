// 人工审核改判台账（data/manual_review.json）—— 单测
// 锁死：① 台账结构守卫；② 覆盖主键与写入方/消费方一致；③ validateDay 的 warn↔dirty 翻转；
//       ④ 翻转确实改变因子剔除（dirtyFields），但不破坏"无覆盖=不动点"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManualMap, overrideKey, validateManualReview, mergeManualEntries,
  DEFAULT_REASONS, industryFromReason,
} from '../src/manual_review.js';
import { validateDay, dirtyArgsOf, SEVERITY } from '../src/dirty.js';

const DATE = '2026-03-03';

// ── 台账结构守卫 ────────────────────────────────────────────────────────────
test('validateManualReview: 合法台账通过', () => {
  const led = {
    kind: 'manual-review', version: 1,
    entries: [{ date: DATE, industry: '油气开采及服务', newStatus: 'dirty', reason: '确认异常应剔除', reviewer: 'me', ts: 't' }],
  };
  assert.deepEqual(validateManualReview(led), { ok: true, errors: [] });
});

test('validateManualReview: 缺 reason / 非法 newStatus / 其他缺 customReason 均拒', () => {
  assert.ok(!validateManualReview({ kind: 'manual-review', entries: [{ date: DATE, industry: 'X', newStatus: 'bad', reason: '确认异常应剔除' }] }).ok);
  assert.ok(!validateManualReview({ kind: 'manual-review', entries: [{ date: DATE, industry: 'X', newStatus: 'dirty' }] }).ok, '缺 reason');
  assert.ok(!validateManualReview({ kind: 'manual-review', entries: [{ date: DATE, industry: 'X', newStatus: 'warn', reason: '其他' }] }).ok, '其他缺 customReason');
  assert.ok(!validateManualReview({ kind: 'manual-review', entries: [{ date: 'bad', industry: 'X', newStatus: 'dirty', reason: '口径调整' }] }).ok, '非法 date');
});

test('validateManualReview: 字段类主键（date|field）合法', () => {
  const led = { kind: 'manual-review', entries: [{ date: DATE, field: 'summary.amount_yi', newStatus: 'warn', reason: '口径调整', reviewer: 'me', ts: 't' }] };
  assert.deepEqual(validateManualReview(led), { ok: true, errors: [] });
});

// ── 主键一致性（写入方 _serve.cjs 的 entryKey 与消费方必须同形）──────────────
test('overrideKey: 行业类走 reviewKey(date|行业)，字段类走 date|field', () => {
  assert.equal(overrideKey(DATE, { reason: '行业「油气开采及服务」涨幅 12%' }), `${DATE}|油气开采及服务`);
  assert.equal(overrideKey(DATE, { field: 'summary.amount_yi' }), `${DATE}|summary.amount_yi`);
  assert.equal(industryFromReason('行业「燃气」x'), '燃气');
});

test('buildManualMap: 同键后者覆盖前者', () => {
  const led = { kind: 'manual-review', entries: [
    { date: DATE, industry: 'A', newStatus: 'warn', reason: '口径调整', ts: '1' },
    { date: DATE, industry: 'A', newStatus: 'dirty', reason: '确认异常应剔除', ts: '2' },
  ] };
  const m = buildManualMap(led);
  assert.equal(m.size, 1);
  assert.equal(m.get(`${DATE}|A`).newStatus, 'dirty');
});

test('mergeManualEntries: 同键幂等合并、新条目覆盖旧条目（结构校验由调用方负责）', () => {
  const base = { kind: 'manual-review', entries: [{ date: DATE, industry: 'A', newStatus: 'warn', reason: '口径调整', ts: '1' }] };
  const next = mergeManualEntries(base, [{ date: DATE, industry: 'A', newStatus: 'dirty', reason: '确认异常应剔除', ts: '2' }]);
  assert.equal(next.entries.length, 1, '同键合并：长度不变');
  assert.equal(next.entries[0].newStatus, 'dirty', '新结论覆盖旧结论');
  // 不同键累加
  const two = mergeManualEntries(next, [{ date: DATE, industry: 'B', newStatus: 'warn', reason: '历史数据修正', ts: '3' }]);
  assert.equal(two.entries.length, 2);
});

// ── validateDay 翻转：warn → dirty（真正剔除）───────────────────────────────
// 构造一个触发 OUTLIER_INDUSTRY（WARN）的行业离群：≥20 行业、一个孤立峰。
function outlierDay() {
  const fillers = Array.from({ length: 20 }, (_, i) => ({ name: `行业${i}`, change_pct: 1 + (i % 5) * 0.2 }));
  return {
    trade_date: DATE,
    hot: [], industry: [{ name: '油气开采及服务', change_pct: 12 }, ...fillers],
    indexes: [], summary: {}, emotion: {},
  };
}

test('★ 无覆盖：行业离群判 warn（不剔除、dirtyFields 不含行业）', () => {
  const r = validateDay(outlierDay());
  assert.equal(r.status, 'warn');
  assert.ok(!r.dirtyFields.includes('industry[].change_pct'));
});

test('★ 覆盖 newStatus=dirty：warn→error，行业字段进入 dirtyFields（管线真剔除）', () => {
  const mr = { kind: 'manual-review', entries: [{ date: DATE, industry: '油气开采及服务', newStatus: 'dirty', reason: '确认异常应剔除', reviewer: 'me', ts: 't' }] };
  const r = validateDay(outlierDay(), { manualReview: mr });
  assert.equal(r.status, 'dirty');
  assert.ok(r.dirtyFields.includes('industry[].change_pct'));
  const args = dirtyArgsOf(r);
  assert.ok(args.has('industryUp') && args.has('industryTotal'), '行业剔除映射到 factor 入参');
  const flipped = r.issues.find((i) => i.field === 'industry[].change_pct');
  assert.equal(flipped.severity, SEVERITY.ERROR);
  assert.match(flipped.reason, /人工审核改判/);
});

// ── validateDay 翻转：error → warn（保留、不剔除）───────────────────────────
function amountDay() {
  return { trade_date: DATE, hot: [], industry: [], indexes: [], summary: { amount_yi: 99999 }, emotion: {} };
}

test('★ 无覆盖：成交额越界判 error（剔除）', () => {
  const r = validateDay(amountDay());
  assert.equal(r.status, 'dirty');
  assert.ok(r.dirtyFields.includes('summary.amount_yi'));
});

test('★ 覆盖 newStatus=warn：error→warn（保留、不再剔除）', () => {
  const mr = { kind: 'manual-review', entries: [{ date: DATE, field: 'summary.amount_yi', newStatus: 'warn', reason: '口径调整', reviewer: 'me', ts: 't' }] };
  const r = validateDay(amountDay(), { manualReview: mr });
  assert.equal(r.status, 'warn');
  assert.ok(!r.dirtyFields.includes('summary.amount_yi'));
  const kept = r.issues.find((i) => i.field === 'summary.amount_yi');
  assert.equal(kept.severity, SEVERITY.WARN);
});
