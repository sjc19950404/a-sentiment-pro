import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifySchedule } from '../src/ci_verify.mjs';

// schedule 首次触发的机器化验收（2026-11-13 豆包复审质疑④）
const FROM = Date.parse('2026-11-16T08:10:00Z');
const OPT = { nowMs: Date.parse('2026-11-16T08:25:00Z'), fromMs: FROM, acceptDay: '2026-11-16' };
const run = (o = {}) => ({ event: 'schedule', created_at: '2026-11-16T08:10:00Z', conclusion: 'success', ...o });

test('ci_verify: 验收日之前 → PENDING（不算失败，不污染收口）', () => {
  const r = verifySchedule([], { ...OPT, nowMs: Date.parse('2026-11-13T08:25:00Z') });
  assert.equal(r.result, 'PENDING');
  assert.equal(r.code, 'pending');
});

test('ci_verify: 存在 event=schedule 且 success 且 created_at>=fromMs → PASS', () => {
  const r = verifySchedule([run()], OPT);
  assert.equal(r.result, 'PASS');
  assert.equal(r.code, 'ok');
});

test('ci_verify: 无任何 schedule run → FAIL/no_schedule_run', () => {
  const r = verifySchedule([run({ event: 'push' })], OPT);
  assert.equal(r.result, 'FAIL');
  assert.equal(r.code, 'no_schedule_run');
});

test('ci_verify: schedule run 存在但 conclusion 非 success → FAIL/run_failed', () => {
  const r = verifySchedule([run({ conclusion: 'failure' })], OPT);
  assert.equal(r.result, 'FAIL');
  assert.equal(r.code, 'run_failed');
});

test('ci_verify: schedule run 早于验收窗口 → FAIL/no_schedule_run（不拿旧 run 冒充）', () => {
  const r = verifySchedule([run({ created_at: '2026-11-13T08:10:00Z' })], OPT);
  assert.equal(r.result, 'FAIL');
  assert.equal(r.code, 'no_schedule_run');
});
