// 盘中快照兜底源纯函数单测（2026-10-29 加固）
import test from 'node:test';
import assert from 'node:assert/strict';
import { applySnapshotFallback } from '../src/snapshot_fallback.js';

const TD = '2026-10-29';
// 统一基准：NOW = 2026-10-29 02:00 UTC = 北京 10:00
const NOW = Date.UTC(2026, 9, 29, 2, 0);
const bjOf = (ms) => {
  const d = new Date(ms);
  return `${TD} ${String(d.getUTCHours() + 8).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const mkPrev = (ageMin, over = {}) => ({
  tradeDate: TD,
  capturedAt: new Date(NOW - ageMin * 60000).toISOString(), // 真实年龄 = ageMin 分钟
  capturedAtBJ: bjOf(NOW - ageMin * 60000),
  hot: { count: 10, rows: [{ code: '600000' }] },
  screener: { count: 5, rows: [{ code: '600001' }] },
  pools: { zt: 3 },
  breadth: { up: 100, down: 50 },
  ...over,
});
const mkSnap = (over = {}) => ({
  tradeDate: TD,
  capturedAt: new Date(NOW).toISOString(),
  capturedAtBJ: bjOf(NOW),
  hot: null, screener: null, pools: null, breadth: null,
  dataHealth: {},
  ...over,
});

test('无历史快照 → 不兜底，prevUsable=false', () => {
  const s = mkSnap();
  const r = applySnapshotFallback(s, null, { tradeDate: TD, nowMs: NOW, ttlMin: 60 });
  assert.deepEqual(r.fallbackUsed, []);
  assert.equal(r.prevUsable, false);
  assert.equal(s.hot, null);
});

test('跨交易日 → 不兜底', () => {
  const s = mkSnap();
  const prev = mkPrev(10, { tradeDate: '2026-10-28' });
  const r = applySnapshotFallback(s, prev, { tradeDate: TD, nowMs: NOW, ttlMin: 60 });
  assert.deepEqual(r.fallbackUsed, []);
  assert.equal(r.prevUsable, false);
});

test('超出 TTL（>60 分钟）→ 不兜底', () => {
  const s = mkSnap();
  const prev = mkPrev(90); // 90 分钟前，超出 60 阈值
  const r = applySnapshotFallback(s, prev, { tradeDate: TD, nowMs: NOW, ttlMin: 60 });
  assert.deepEqual(r.fallbackUsed, []);
  assert.equal(r.prevUsable, false);
});

test('TTL 边界内（≤60 分钟）且本次全缺 → 四源全部兜底，保留 prev 真实年龄', () => {
  const s = mkSnap();
  const prev = mkPrev(30); // 30 分钟前，在 TTL 内
  const r = applySnapshotFallback(s, prev, { tradeDate: TD, nowMs: NOW, ttlMin: 60 });
  assert.deepEqual(r.fallbackUsed.sort(), ['breadth', 'hot', 'pools', 'screener']);
  assert.equal(r.prevUsable, true);
  assert.deepEqual(s.hot, prev.hot);
  assert.deepEqual(s.screener, prev.screener);
  assert.deepEqual(s.pools, prev.pools);
  assert.deepEqual(s.breadth, prev.breadth);
  // 保留真实数据年龄（不冒充实时）
  assert.equal(s.capturedAt, prev.capturedAt);
  assert.equal(s.capturedAtBJ, prev.capturedAtBJ);
  assert.deepEqual(s.dataHealth.fallbackUsed, ['breadth', 'hot', 'pools', 'screener']);
});

test('本次已抓到 hot → 不回退 hot；但 screener 缺席 → 兜底 screener', () => {
  const s = mkSnap({ hot: { count: 7, rows: [{ code: '600999' }] } });
  const prev = mkPrev(20);
  const r = applySnapshotFallback(s, prev, { tradeDate: TD, nowMs: NOW, ttlMin: 60 });
  assert.deepEqual(r.fallbackUsed.sort(), ['breadth', 'pools', 'screener']); // hot 不在内（本次已有）
  assert.deepEqual(s.hot, { count: 7, rows: [{ code: '600999' }] }); // 用本次，不回退
  assert.deepEqual(s.screener, prev.screener); // 兜底
});

test('prev 仅含部分源 → 只兜底存在的源', () => {
  const s = mkSnap();
  const prev = mkPrev(15, { screener: undefined, pools: undefined }); // 仅 hot + breadth
  const r = applySnapshotFallback(s, prev, { tradeDate: TD, nowMs: NOW, ttlMin: 60 });
  assert.deepEqual(r.fallbackUsed.sort(), ['breadth', 'hot']);
  assert.equal(s.screener, null); // prev 无 → 不兜底
  assert.equal(s.pools, null);
});

test('prev 对应 key 为 undefined/null → 不兜底该项', () => {
  const s = mkSnap();
  const prev = mkPrev(10, { hot: undefined, screener: null });
  const r = applySnapshotFallback(s, prev, { tradeDate: TD, nowMs: NOW, ttlMin: 60 });
  // breadth/pools 兜底；hot/screener 因 prev 缺值不兜底
  assert.deepEqual(r.fallbackUsed.sort(), ['breadth', 'pools']);
  assert.equal(s.hot, null);
  assert.equal(s.screener, null);
});
