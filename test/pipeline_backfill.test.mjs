// 纪律三（2026-10-12）：跑批补跑判据 —— prevTradingDay / latestArchivedTradeDate
//
// 锁的是「永久缺失」这个具体事故形态：主源只返回最近交易日，某天盘后跑失败
// 且次日非交易日不被调度 → 该日**再也取不回**（不是晚一天补，是永久没了）。
// 所以非交易日也必须能正确回答「上一个交易日是谁」，才能判断要不要补跑。
// 10-09 即此：周五盘后没成、周六无 cron，10-12 开盘前才发现，险些永久缺失。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prevTradingDay, latestArchivedTradeDate } from '../src/pipeline.js';

test('prevTradingDay：跳过周末（周一 → 上周五）', () => {
  // 10-12 周一 → 上一交易日 10-09 周五（10-10/10-11 周末不算）
  assert.equal(prevTradingDay('2026-10-12', null), '2026-10-09');
});

test('prevTradingDay：周六也要能定位到周五（周末调度正是补跑场景）', () => {
  assert.equal(prevTradingDay('2026-10-10', null), '2026-10-09', '周六的上一交易日是周五');
});

test('prevTradingDay：跳过休市日（节假日不是交易日）', () => {
  assert.equal(prevTradingDay('2026-10-12', ['2026-10-09']), '2026-10-08', '10-09 休市 → 回到 10-08');
});

test('prevTradingDay：回溯上限内全是休市 → null（宁可没有，不给错日期）', () => {
  // 长假极端形态：往前 14 天全休市 → 认不出来，返回 null 由调用方当作「不补跑」
  const closed = ['2026-09-28', '2026-09-29', '2026-09-30'];
  for (let i = 1; i <= 11; i++) closed.push(`2026-10-${String(i).padStart(2, '0')}`);
  assert.equal(prevTradingDay('2026-10-12', closed), null);
});

test('latestArchivedTradeDate：索引缺失 → null（不抛，调用方按「未入档」处理）', () => {
  assert.equal(latestArchivedTradeDate('/nonexistent-dir-xyz/archive.json'), null);
});
