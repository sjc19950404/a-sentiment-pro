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
