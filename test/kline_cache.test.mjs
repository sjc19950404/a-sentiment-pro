import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getKline, isStaleKlineCache } from '../src/kline.js';

// C10（2026-11-09 审计修复）：K 线缓存时效校验规格
//   原实现「缓存命中即返回」——实测 1190 个缓存 1147 个最后日期停在 10-30，
//   回测静默用 10 天前数据。修复后：新鲜零变化 / 陈旧尝试刷新 / 刷新失败 fail-open 回落。

const DAY = 86400000;
const bjDayStr = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const today = () => bjDayStr(Date.now());
const daysAgo = (n) => bjDayStr(Date.now() - n * DAY);

const mkCache = (dir, sym, bars) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, sym + '.json'), JSON.stringify(bars));
};
const bars = (n, lastDate) => Array.from({ length: n }, (_, i) => ({
  date: i === n - 1 ? lastDate : daysAgo(n - i + 5),
  open: 10,
  close: 10.5,
}));

test('C10 isStaleKlineCache：空/不可解析→陈旧；阈值内新鲜；超阈值陈旧', () => {
  assert.equal(isStaleKlineCache([]), true, '空数组');
  assert.equal(isStaleKlineCache(null), true, 'null');
  assert.equal(isStaleKlineCache([{ date: 'oops', open: 1, close: 1 }]), true, '日期不可解析');
  assert.equal(isStaleKlineCache([{ date: today(), open: 1, close: 1 }]), false, '当日新鲜');
  assert.equal(isStaleKlineCache([{ date: daysAgo(9), open: 1, close: 1 }]), false, '9 天在 10 天阈值内');
  assert.equal(isStaleKlineCache([{ date: daysAgo(11), open: 1, close: 1 }]), true, '11 天陈旧');
  assert.equal(isStaleKlineCache([{ date: daysAgo(11), open: 1, close: 1 }], Date.now(), 15), false, '自定义阈值 15 天');
});

test('C10 getKline：新鲜缓存直接返回（零网络）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-'));
  mkCache(dir, 'sh600001', bars(30, today()));
  const k = await getKline('sh600001', 20, dir);
  assert.equal(k.length, 30);
  assert.equal(k[k.length - 1].date, today());
});

test('C10 getKline：陈旧缓存 + refreshStale:false → 离线只读旧缓存', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-'));
  mkCache(dir, 'sh600002', bars(30, daysAgo(40)));
  const k = await getKline('sh600002', 20, dir, { refreshStale: false });
  assert.equal(k.length, 30);
  assert.equal(k[k.length - 1].date, daysAgo(40));
});

test('C10 getKline：陈旧缓存 + 刷新失败 → fail-open 回落旧缓存（不抛错）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-'));
  mkCache(dir, 'sh600003', bars(30, daysAgo(40)));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('net down(test)'); };
  try {
    const k = await getKline('sh600003', 20, dir);
    assert.equal(k.length, 30, '回落旧缓存');
    assert.equal(k[k.length - 1].date, daysAgo(40));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('C10 getKline：陈旧缓存 + 刷新成功 → 返回新数据并写回缓存', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-'));
  mkCache(dir, 'sh600004', bars(20, daysAgo(40)));
  const origFetch = globalThis.fetch;
  const fresh = Array.from({ length: 25 }, (_, i) => [daysAgo(25 - i), '11', '12']);
  fresh[fresh.length - 1][0] = today();
  globalThis.fetch = async () => ({ json: async () => ({ data: { sh600004: { day: fresh } } }) });
  try {
    const k = await getKline('sh600004', 20, dir);
    assert.equal(k.length, 25, '刷新后长度');
    assert.equal(k[k.length - 1].date, today(), '刷新到最新日');
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'sh600004.json'), 'utf8'));
    assert.equal(disk.length, 25, '新数据已写回缓存');
  } finally {
    globalThis.fetch = origFetch;
  }
});
