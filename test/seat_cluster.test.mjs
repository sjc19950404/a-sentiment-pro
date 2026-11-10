import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSeatStats, normalizeFeatures, kmeans, labelClusters, clusterSeats } from '../src/seat_cluster.js';

const CODES = ['东方证券股份有限公司XX营业部', '机构专用', '沪股通专用'];

function mkDay(date, detail) { return { trade_date: date, summary: { seats: { detail } } }; }

test('seat_cluster: collectSeatStats——聚合天数/金额/机构股通占比/单票集中度', () => {
  const days = [
    mkDay('2026-11-01', { '600001': { b: [[0, 1000], [1, 500]], s: [[0, 800]] } }), // 0=营业部 1=机构专用
    mkDay('2026-11-02', { '600001': { b: [[0, 600]] } }),
    mkDay('2026-11-03', { '600002': { s: [[2, 300]] } }), // 2=沪深股通
  ];
  const rows = collectSeatStats(days, CODES);
  const bs = rows.find((r) => r.name === CODES[0]);
  assert.equal(bs.activeDays, 2);
  assert.equal(bs.buyWan, 1600);
  assert.equal(bs.sellWan, 800);
  assert.equal(bs.buyCnt, 2);
  assert.equal(bs.singleStockConc, 1); // 全部集中 600001
  const inst = rows.find((r) => r.name === CODES[1]);
  assert.equal(inst.instShare, 1);     // 机构专用全命中
  const north = rows.find((r) => r.name === CODES[2]);
  assert.equal(north.northShare, 1);   // 沪股通全命中
  // 码表外的席位 ID 跳过（宁缺毋假）
  const days2 = [mkDay('2026-11-01', { '600001': { b: [[9999, 100]] } })];
  assert.equal(collectSeatStats(days2, CODES).length, 0);
});

test('seat_cluster: normalizeFeatures——对数压长尾+零方差列恒0', () => {
  const rows = [
    { activeDays: 1, buyWan: 10 }, { activeDays: 10, buyWan: 10000 }, { activeDays: 100, buyWan: 1000000 },
  ];
  const f = normalizeFeatures(rows, ['activeDays', 'buyWan']);
  assert.equal(f[0].activeDays, 0);
  assert.equal(f[2].activeDays, 1);
  assert.ok(f[1].buyWan > 0.3 && f[1].buyWan < 0.7, '对数尺度下中点居中');
  const z = normalizeFeatures([{ a: 5 }, { a: 5 }], ['a']);
  assert.equal(z[0].a, 0, '零方差列恒0');
});

test('seat_cluster: kmeans——两个明显分离的簇被分开；样本数≤k 不聚类', () => {
  const feats = [
    { x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0, y: 0.1 },
    { x: 1, y: 1 }, { x: 0.9, y: 1 }, { x: 1, y: 0.9 },
  ];
  const a = kmeans(feats, ['x', 'y'], 2);
  assert.equal(new Set(a.slice(0, 3)).size, 1, '前三个同簇');
  assert.equal(new Set(a.slice(3)).size, 1, '后三个同簇');
  assert.equal(kmeans(feats, ['x', 'y'], 10).length, 6, '样本≤k 逐点独簇');
});

test('seat_cluster: labelClusters——北向/机构/高频/大额规则命名', () => {
  const rows = [
    { activeDays: 20, buyWan: 5000, instShare: 0, northShare: 0.9, avgBuyWan: 500 },
    { activeDays: 20, buyWan: 5000, instShare: 0.9, northShare: 0, avgBuyWan: 500 },
    { activeDays: 3, buyWan: 50000, instShare: 0, northShare: 0, avgBuyWan: 5000 },
    { activeDays: 1, buyWan: 100, instShare: 0, northShare: 0, avgBuyWan: 50 },
  ];
  const assign = [0, 1, 2, 3];
  const cls = labelClusters(rows, assign, 4);
  assert.equal(cls[0].label, '北向通道');
  assert.equal(cls[1].label, '机构通道');
  assert.equal(cls[2].label, '大额主力');
  assert.equal(cls[3].label, '偶发席位');
});

test('seat_cluster: clusterSeats 一站式——空簇被过滤、labels 全覆盖', () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ name: '营业部A' + i, broker: 'A', activeDays: 1 + i, buyWan: 100 * i, sellWan: 50 * i, buyCnt: i, sellCnt: i, instShare: 0, northShare: 0, avgBuyWan: 100, singleStockConc: 0.2 });
  const { clusters, labels } = clusterSeats(rows, 3);
  assert.ok(clusters.length > 0 && clusters.length <= 3);
  assert.equal(Object.keys(labels).length, 12);
  for (const c of clusters) assert.ok(c.size > 0);
});
