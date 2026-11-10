#!/usr/bin/env node
/**
 * 席位聚类批处理 sidecar（2026-11-10，六方向 #2）。
 * 读 archive.json 全档席位明细 → src/seat_cluster.js 纯函数（确定性 k-means）
 *   → 落独立档 data/seat_labels.json。深夜闲时跑一次出一次标签；盘中后续只查表。
 * fail-open：异常只报错，不触碰主链。消费方（个股抽屉/报告标注）后续接线，拍板制。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { collectSeatStats, clusterSeats } from '../src/seat_cluster.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = join(ROOT, 'data/archive.json');
const OUT = join(ROOT, 'data/seat_labels.json');

const t0 = Date.now();
const arc = JSON.parse(readFileSync(ARCHIVE, 'utf8'));
const days = arc.all_days || arc.days || [];
const rows = collectSeatStats(days, arc.meta && arc.meta.seatCodes);
if (rows.length < 10) {
  console.error(`[seat-cluster] 席位样本过少（${rows.length} < 10）——不落档`);
  process.exit(2);
}
const { clusters, labels } = clusterSeats(rows, 5);
const rec = {
  generatedAt: new Date().toISOString(),
  days: days.length,
  seats: rows.length,
  clusters,
  labels,
};
writeFileSync(OUT, JSON.stringify(rec, null, 1) + '\n');
console.log(`[seat-cluster] ${days.length} 天 → ${rows.length} 席位 → ${clusters.length} 簇（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log(clusters.map((c) => `  簇${c.id} ${c.label} ×${c.size}（均上榜天数 ${c.centroid.activeDays}）`).join('\n'));
