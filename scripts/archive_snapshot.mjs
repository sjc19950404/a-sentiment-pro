#!/usr/bin/env node
/**
 * archive_snapshot.mjs — 归档日快照（2026-11-09 B2 用户拍板配套）
 *
 * 背景：archive 系列已移出 git（云端留存走 R2 同步），本地需要可回滚副本，
 *   但只保留最近 7 天（Pi SD 卡与磁盘卫生）。每次 EOD 后执行：
 *     data/.archive_snap/<YYYYMMDD>/archive*.json.gz（gzip 压缩单日快照）
 *   清理：日期目录名 < 今天−7 天 的目录整目录删除。
 * 纪律：只读归档文件、只写 .archive_snap/（gitignored）；fail-open 由调用方兜底。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data');
const SNAP = path.join(DATA, '.archive_snap');
const KEEP_DAYS = 7;

const ARCHIVES = [
  'archive.json',
  'archive-2025.json',
  'archive-2026.json',
  'archive-recent.json',
  'archive-index.json',
];

const bj = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // 北京日期（Pi 可能非 CST）
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};
const today = bj();
const dir = path.join(SNAP, today);

let saved = 0, bytes = 0;
fs.mkdirSync(dir, { recursive: true });
for (const f of ARCHIVES) {
  const p = path.join(DATA, f);
  if (!fs.existsSync(p)) continue;
  const gz = gzipSync(fs.readFileSync(p), { level: 6 });
  fs.writeFileSync(path.join(dir, f + '.gz'), gz);
  saved++; bytes += gz.length;
}

// 清理超过 KEEP_DAYS 的快照目录（目录名即 YYYYMMDD）
const cutoff = (() => {
  const d = new Date(Date.now() + 8 * 3600 * 1000 - KEEP_DAYS * 86400 * 1000);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
})();
let pruned = 0;
for (const name of fs.readdirSync(SNAP)) {
  if (!/^\d{8}$/.test(name)) continue;
  if (name < cutoff) {
    fs.rmSync(path.join(SNAP, name), { recursive: true, force: true });
    pruned++;
  }
}

console.log(`[archive_snapshot] ${today}：快照 ${saved} 个文件（${(bytes / 1048576).toFixed(1)}MB gz）｜清理过期 ${pruned} 个`);
