#!/usr/bin/env node
// ── 复盘 CLI：生成"选不出票"台账（2026-10-12 用户指令）──────────────────────
//
// 用法：
//   node scripts/review_nopick.mjs                 # 默认取最新一份 intraday_*.json
//   node scripts/review_nopick.mjs --date 2026-10-09
//   node scripts/review_nopick.mjs --out data/review
//
// 产物：data/review/no_pick_<tradeDate>.json（结构化台账，随数据提交入库，为次日开盘准备）
// 依赖：src/no_pick_reason.js（纯函数，可单测）
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeNoPickReview } from '../src/no_pick_reason.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : resolve(ROOT, 'data', 'review');

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

// 默认复盘单位 = 最新已收盘交易日（档案最全：industry/ztpool/题材齐全），
// 优先其盘中报告；否则退化为日期最大的 intraday_*.json（盘中实时快照可能尚未跑选股）。
const reportsDir = resolve(ROOT, 'data', 'reports');
let tradeDate = dateArg;
if (!tradeDate) {
  // 最新已收盘交易日取 archive-index.latestDate（轻量索引，与审计同源；all_days 顺序不可靠）
  const idx = readJson(resolve(ROOT, 'data', 'archive-index.json'));
  const lastDay = (idx && idx.latestDate) || null;
  if (lastDay && existsSync(resolve(reportsDir, `intraday_${lastDay}.json`))) {
    tradeDate = lastDay;
  } else {
    const files = readdirSync(reportsDir).filter((f) => /^intraday_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    if (!files.length) { console.error('[no_pick] 无 intraday_*.json，跳过'); process.exit(0); }
    tradeDate = files[files.length - 1].match(/(\d{4}-\d{2}-\d{2})/)[1];
  }
}

const report = readJson(resolve(reportsDir, `intraday_${tradeDate}.json`));
if (!report) { console.error(`[no_pick] 无盘中报告 intraday_${tradeDate}.json（跳过）`); process.exit(0); }

const arch = readJson(resolve(ROOT, 'data', 'archive.json'));
const days = (arch && arch.all_days || []).filter((d) => d && d.trade_date && !(d.emotion && d.emotion._backfill));
const day = days.find((d) => d.trade_date === tradeDate) || null;
const prev = days.filter((d) => d.trade_date < tradeDate).pop() || null;
const ztpool = (readJson(resolve(ROOT, 'data', 'ztpool_history.json')) || [])
  .find((d) => String(d.date) === tradeDate.replace(/-/g, '')) || null;

const review = computeNoPickReview({
  tradeDate, intradayReport: report, archiveDay: day, prevArchiveDay: prev, ztpoolDay: ztpool,
});

mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `no_pick_${tradeDate}.json`);
writeFileSync(out, JSON.stringify(review, null, 2) + '\n', 'utf8');

const tag = review.isEmpty ? '选不出票' : `有票(${review.selectedCount})`;
console.log(`[no_pick] ${tradeDate} 候选 ${review.candidateRaw} / 剔除 ${review.removedCount} / 存活 ${review.selectedCount} → ${tag}`);
console.log(`  炸板率=${(review.metrics.zhabanRate * 100).toFixed(0)}%  top5换手=${review.metrics.sectorTurnover5}/5  题材集中度=${review.metrics.topicConc ?? '—'}`);
console.log(`  结论: ${review.conclusion}`);
console.log(`  次日建议: ${review.suggestionForTomorrow.join('；')}`);
console.log(`  落盘: ${out}`);
