#!/usr/bin/env node
/**
 * 公告避雷扫描 sidecar（2026-11-10，六方向 #6）。
 * 读 data/announcements-latest.json 的 details（标题级）→ src/ann_scan.js 纯函数扫描
 *   → 落独立档 data/ann_risk_scan.json。fail-open：任何异常只报错退出，不触碰主链；
 *   挂 EOD 链 best-effort 位。消费方（页面/推送标注）后续接线，拍板制。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { scanAnnouncements } from '../src/ann_scan.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data/announcements-latest.json');
const OUT = join(ROOT, 'data/ann_risk_scan.json');

function bjDate() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

try {
  const raw = JSON.parse(readFileSync(SRC, 'utf8'));
  const details = raw.details || [];
  if (!details.length) {
    console.error('[ann-scan] 公告档 details 为空——不落空档，退出');
    process.exit(2);
  }
  const r = scanAnnouncements(details);
  const rec = {
    date: raw.date || bjDate(),
    scannedAt: new Date().toISOString(),
    scanned: r.scanned, ok: r.ok,
    high: r.flagged.filter((f) => f.level === 'high').length,
    mid: r.flagged.filter((f) => f.level === 'mid').length,
    low: r.flagged.filter((f) => f.level === 'low').length,
    flagged: r.flagged,
  };
  const hist = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
  const list = Array.isArray(hist) ? hist : [];
  const idx = list.findIndex((d) => d.date === rec.date);
  if (idx >= 0) list[idx] = rec; else list.push(rec); // 幂等同日覆盖
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeFileSync(OUT, JSON.stringify(list, null, 1) + '\n');
  const top = r.flagged.filter((f) => f.level !== 'low').slice(0, 6)
    .map((f) => `${f.level === 'high' ? '🚨' : '⚠'} ${f.code} ${f.name || ''} [${f.words.join('/')}]`).join(' | ');
  console.log(`[ann-scan] ${rec.date} 扫描 ${r.scanned} 条：高危 ${rec.high} / 中危 ${rec.mid} / 已澄清 ${rec.low}${top ? '\n  ' + top : ''}`);
} catch (e) {
  console.error('[ann-scan] 异常（fail-open，不影响主链）:', e && e.message);
  process.exit(1);
}
