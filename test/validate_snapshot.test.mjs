// 外围采集兜底校验（validateExternal）单测：混合策略三分支 + 边界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateExternal, STALE_DAYS, EXTERNAL_CACHE_TAG } from '../src/validate_snapshot.js';

const TODAY = '2026-10-12';
// 构造一条外围 quote（global.json::quotes 形态）
const q = (key, over = {}) => ({
  key, name: key.toUpperCase(), ok: true, chgPct: 0.4942, quoteTime: '2026-10-12T15:00:00+08:00', ...over,
});
const g = (quotes, lastAttempt) => ({ quotes, meta: { lastAttempt: lastAttempt || { outcome: 'ok' } } });

test('当日 quoteTime（age≤0）→ keep，chgPct 已 ÷100', () => {
  const r = validateExternal(g([q('a50')]), { today: TODAY });
  assert.equal(r.results.a50.action, 'keep');
  assert.ok(Math.abs(r.results.a50.chgPct - 0.004942) < 1e-9);
  assert.equal(r.results.a50.stale, false);
  assert.equal(r.alerts.length, 0);
});

test(`陈旧 ≥ STALE_DAYS 天（10-08→10-12, age=4）→ 置空 + 告警`, () => {
  const r = validateExternal(g([q('a50', { quoteTime: '2026-10-08T15:00:00+08:00' })]), { today: TODAY });
  assert.equal(r.results.a50.action, 'null');
  assert.equal(r.results.a50.chgPct, null);
  assert.match(r.alerts[0], /已陈旧 4 天/);
  assert.match(r.alerts[0], /已置空/);
});

test('当日抓取失败、旧值 < 阈值（age=1）→ 保留 + 历史缓存标记', () => {
  const r = validateExternal(
    g([q('a50', { quoteTime: '2026-10-11T15:00:00+08:00' })], { outcome: 'failed', reason: 'timeout' }),
    { today: TODAY },
  );
  assert.equal(r.results.a50.action, 'keep_tag');
  assert.ok(Math.abs(r.results.a50.chgPct - 0.004942) < 1e-9); // 保留原值
  assert.equal(r.results.a50.stale, true);
  assert.equal(r.results.a50.note, EXTERNAL_CACHE_TAG);
  assert.match(r.alerts[0], /历史缓存/);
});

test('单 quote ok=false → 直接置空（与既有 ok=false→null 一致）', () => {
  const r = validateExternal(g([q('a50', { ok: false, chgPct: null })]), { today: TODAY });
  assert.equal(r.results.a50.action, 'null');
  assert.equal(r.results.a50.chgPct, null);
});

test('无 quoteTime 且全局抓取失败 → 保守保留 + 标记', () => {
  const r = validateExternal(g([q('a50', { quoteTime: null })], { outcome: 'failed' }), { today: TODAY });
  assert.equal(r.results.a50.action, 'keep_tag');
  assert.equal(r.results.a50.note, EXTERNAL_CACHE_TAG);
});

test('无 quoteTime 且抓取正常 → 视为可用（keep，不告警）', () => {
  const r = validateExternal(g([q('a50', { quoteTime: null })]), { today: TODAY });
  assert.equal(r.results.a50.action, 'keep');
  assert.equal(r.alerts.length, 0);
});

test('global 缺失/quotes 缺失 → 安全返回空结果', () => {
  assert.deepEqual(validateExternal(null, { today: TODAY }).results, {});
  assert.deepEqual(validateExternal({}, { today: TODAY }).results, {});
});

test('sox 与 a50 独立判定（各自陈旧度不同）', () => {
  const r = validateExternal(g([
    q('a50', { quoteTime: '2026-10-08T15:00:00+08:00' }), // age 4 → null
    q('sox', { quoteTime: '2026-10-11T15:00:00+08:00' }), // age 1 + 无失败 → keep（非当日失败，按保守 keep）
  ]), { today: TODAY });
  assert.equal(r.results.a50.action, 'null');
  assert.equal(r.results.sox.action, 'keep');
});
