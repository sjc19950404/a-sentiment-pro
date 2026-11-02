// 档案缺交易日检测（scripts/audit_archive_gaps.mjs）单测
//
// 锁三件事：
//   ① 判据对：交易日 = 工作日 − 休市日（calendar 的 trading 是空的、days 只记 closed，
//      所以必须自己算——这是最容易写错、也最该被锁住的非显然处）；
//   ② **不误报**：今天尚未采集不算缺失（误报会让人习惯性忽略告警，等于没告警）；
//   ③ 窗口生效：只报最近 N 个交易日，历史遗留缺口不淹没新缺口。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMissingTradeDays, tradingDaysInRange } from '../scripts/audit_archive_gaps.mjs';

const RANGE = { from: '2026-09-01', to: '2026-09-10', closed: [] };
const traded = () => tradingDaysInRange(RANGE);

test('tradingDaysInRange：排除周末与休市日（交易日必须自己算，calendar 没给现成列表）', () => {
  const d = tradingDaysInRange({ from: '2026-09-01', to: '2026-09-30', closed: ['2026-09-15'] });
  assert.ok(!d.includes('2026-09-05'), '周六不算交易日');
  assert.ok(!d.includes('2026-09-06'), '周日不算交易日');
  assert.ok(!d.includes('2026-09-15'), '休市日不算交易日');
  assert.ok(d.includes('2026-09-14'), '普通工作日算交易日');
});

test('findMissingTradeDays：档案齐全 → 无缺失', () => {
  const r = findMissingTradeDays({
    calendar: { coveredFrom: RANGE.from, coveredTo: RANGE.to, closed: [] },
    archiveDates: traded(), today: '2026-09-11', lookback: 30,
  });
  assert.deepEqual(r.recentMissing, []);
});

test('findMissingTradeDays：缺一天 → 精确报出是哪天（10-09 事故形态）', () => {
  const have = traded().filter((d) => d !== '2026-09-04');
  const r = findMissingTradeDays({
    calendar: { coveredFrom: RANGE.from, coveredTo: RANGE.to, closed: [] },
    archiveDates: have, today: '2026-09-11', lookback: 30,
  });
  assert.deepEqual(r.recentMissing, ['2026-09-04'], '只报真正缺的那天');
});

test('今天尚未采集**不**算缺失（宁红不假，但不冤枉还没跑的管道）', () => {
  // 档案到 09-09，今天 09-10（交易日、管道未跑）→ 上界取昨天 09-09 → 不该报缺
  const have = tradingDaysInRange({ from: '2026-09-01', to: '2026-09-09', closed: [] });
  const r = findMissingTradeDays({
    calendar: { coveredFrom: '2026-09-01', coveredTo: '2026-09-10', closed: [] },
    archiveDates: have, today: '2026-09-10', lookback: 30,
  });
  assert.deepEqual(r.recentMissing, [], '今天不该被算作缺失');
});

test('周末/休市日缺失不误报（本来就不该有数据）', () => {
  const r = findMissingTradeDays({
    calendar: { coveredFrom: '2026-09-01', coveredTo: '2026-09-10', closed: ['2026-09-07'] },
    archiveDates: traded().filter((d) => d !== '2026-09-07'), today: '2026-09-11', lookback: 30,
  });
  assert.deepEqual(r.recentMissing, [], '休市日本就没有数据');
});

test('lookback 窗口：只报最近 N 个交易日，更老的归历史遗留', () => {
  const r = findMissingTradeDays({
    calendar: { coveredFrom: '2026-09-01', coveredTo: '2026-09-30', closed: [] },
    archiveDates: [], today: '2026-10-01', lookback: 5,
  });
  assert.equal(r.recentMissing.length, 5, '只报最近 5 个');
  assert.ok(r.missing.length > 5, '全量缺失更多（窗口外，--all 才看）');
});

test('lookback=0（--all）：不设窗口，全部报出', () => {
  const r = findMissingTradeDays({
    calendar: { coveredFrom: RANGE.from, coveredTo: RANGE.to, closed: [] },
    archiveDates: [], today: '2026-09-11', lookback: 0,
  });
  assert.equal(r.recentMissing.length, r.missing.length);
});

// ── 纪律四（2026-10-12）：在档 ≠ 有数据 ──
test('空壳档视同缺失：在档但 up/zt 全 0 → 必须报出来（否则静默通过）', () => {
  // 所有交易日都在档，但 09-04 的核心字段全 0 → 对下游等于没有这一天
  const r = findMissingTradeDays({
    calendar: { coveredFrom: RANGE.from, coveredTo: RANGE.to, closed: [] },
    archiveDates: traded(), today: '2026-09-11', lookback: 30,
    hollowDates: ['2026-09-04'],
  });
  assert.deepEqual(r.recentMissing, ['2026-09-04'], '空壳必须当缺失报出来');
  assert.deepEqual(r.hollowDays, ['2026-09-04'], '且单独标出是空壳（缺档与空壳修法不同）');
});

test('空壳 + 真缺并存：都报，不重复不遗漏', () => {
  const have = traded().filter((d) => d !== '2026-09-07'); // 09-07 真缺，09-04 空壳
  const r = findMissingTradeDays({
    calendar: { coveredFrom: RANGE.from, coveredTo: RANGE.to, closed: [] },
    archiveDates: have, today: '2026-09-11', lookback: 30,
    hollowDates: ['2026-09-04'],
  });
  assert.deepEqual(r.recentMissing, ['2026-09-04', '2026-09-07'], '两类都进缺失，按交易日历顺序');
  assert.deepEqual(r.hollowDays, ['2026-09-04'], '空壳仍单独标出');
});

test('未传 hollowDates 时行为不变（向后兼容，老调用方不受影响）', () => {
  const have = traded().filter((d) => d !== '2026-09-04');
  const r = findMissingTradeDays({
    calendar: { coveredFrom: RANGE.from, coveredTo: RANGE.to, closed: [] },
    archiveDates: have, today: '2026-09-11', lookback: 30,
  });
  assert.deepEqual(r.recentMissing, ['2026-09-04']);
  assert.deepEqual(r.hollowDays, [], '默认无空壳');
});

// ── 已销案（2026-10-19）：已知且不可补的洞从 recentMissing 剔除，但单列 acknowledged 留痕 ──
test('ackDates：已销案日期不计入 recentMissing（仍单列 acknowledged 留痕）', () => {
  const r = findMissingTradeDays({
    calendar: { coveredFrom: RANGE.from, coveredTo: RANGE.to, closed: [] },
    archiveDates: traded().filter((d) => d !== '2026-09-04'), today: '2026-09-11', lookback: 30,
    ackDates: ['2026-09-04'],
  });
  assert.deepEqual(r.recentMissing, [], '销案后不报缺失');
  assert.deepEqual(r.acknowledged, ['2026-09-04'], '但单列 acknowledged 留痕');
});

test('ackDates 不影响新缺口：未销案的洞仍报', () => {
  const r = findMissingTradeDays({
    calendar: { coveredFrom: RANGE.from, coveredTo: RANGE.to, closed: [] },
    archiveDates: traded().filter((d) => d !== '2026-09-04' && d !== '2026-09-08'), today: '2026-09-11', lookback: 30,
    ackDates: ['2026-09-04'],
  });
  assert.deepEqual(r.recentMissing, ['2026-09-08'], '未销案的洞照常报');
  assert.deepEqual(r.acknowledged, ['2026-09-04']);
});

test('未传 ackDates 时行为不变（向后兼容，默认无 acknowledged）', () => {
  const have = traded().filter((d) => d !== '2026-09-04');
  const r = findMissingTradeDays({
    calendar: { coveredFrom: RANGE.from, coveredTo: RANGE.to, closed: [] },
    archiveDates: have, today: '2026-09-11', lookback: 30,
  });
  assert.deepEqual(r.recentMissing, ['2026-09-04']);
  assert.deepEqual(r.acknowledged, [], '默认无 acknowledged');
});
