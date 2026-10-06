#!/usr/bin/env node
// ── AI 报告生成入口（S1 最小版 · 归档轨）────────────────────────────────
//
// 用途：读六源真实数据档 → 调 src/ai_report.js 纯函数 → 落盘 data/reports/。
//   daily.yml 挂点属 S2（本版先手动/一次性运行，产出首屏示例报告）。
//
// 用法：
//   node scripts/build_ai_report.mjs                        # 盘后（默认）
//   node scripts/build_ai_report.mjs --type pre_market      # 盘前/盘中/weekly
//   node scripts/build_ai_report.mjs --type weekly --week-start 2026-09-28
//   node scripts/build_ai_report.mjs --sample               # 标记为首屏示例（index.json is_sample）
//
// 纪律：与 src/ai_report.js 同源同律——只读 data/、只写 data/reports/、
//   缺失 null 不补 0；脚本自身不做任何数值计算（生成器纯函数的唯一入口）。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '../src/contract.js';
import {
  buildInput, generatePreMarket, generateIntraday, generatePostMarket, generateWeekly,
  buildSimulationStock,
} from '../src/ai_report.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'data', 'reports');
const INDEX_FILE = join(OUT_DIR, 'index.json');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const has = (name) => process.argv.includes(`--${name}`);

const TYPE = arg('type') || 'post_market';
const WEEK_START = arg('week-start') || null;
const IS_SAMPLE = has('sample');
const WITH_SIM = has('sim'); // 模拟选股层（S1.5）：注入 candidate_pool / sentiment_cycle / 剧本模板

// 模拟选股缺失披露（信封级汇总；字段级缺失由 null + pool_basis/phase_source 承载）
const SIM_MISSING_NOTE = {
  field: 'simulation_stock.candidate_pool[].themes/fundamentals(八字段)/个股级主力资金',
  reason: '系统无基本面选股模块与个股级题材/主力资金数据源；基本面键 null 占位（决议 8），接数据源后直接填充不改 schema',
  ref: 'docs/ai_report_module_design.md#9.3',
};

const read = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null; // 缺档 = null（missing 语义，生成器自行披露）
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};

const input = buildInput({
  dualTrack: read('data/paper/dual_track_latest.json'),
  dualTrackDays: read('data/paper/dual_track.json')?.days ?? null,
  signals: read('data/signals-latest.json'),
  global: read('data/global.json'),
  backtest: read('data/backtest.json'),
  opsAlerts: read('data/ops-alerts-latest.json'),
  intraday: read('data/intraday.json'),
});

const opts = { generatedAt: new Date().toISOString(), generatedBy: 'ci' };
if (WITH_SIM) {
  // paper_universe.symbols 注入名称映射（code→{name, appearances}）；缺档则名称 null（不造数）
  opts.simulationStock = buildSimulationStock(input, {
    nameMap: read('data/paper_universe.json')?.symbols ?? null,
  });
}
const generators = {
  pre_market: () => generatePreMarket(input, opts),
  intraday: () => generateIntraday(input, { ...opts, trigger: arg('trigger') || 'schedule' }),
  post_market: () => generatePostMarket(input, opts),
  weekly: () => generateWeekly(input, { ...opts, weekStart: WEEK_START || input.tradeDate }),
};
const gen = generators[TYPE];
if (!gen) { console.error(`[ai-report] 未知 --type: ${TYPE}（enum: ${Object.keys(generators).join('|')}）`); process.exit(1); }

const report = gen();
if (!report.date) { console.error('[ai-report] tradeDate 缺失（dual_track/signals 均无日期）——不落盘'); process.exit(1); }

// 落盘前契约门禁：坏档不进提交（与 check_contract 同纪律）
const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'ai-report.schema.json'), 'utf8'));
const errs = validateContract(report, schema);
if (errs.length) {
  console.error('[ai-report] 契约违例，拒绝落盘：');
  for (const e of errs) console.error(`  ${e.path}: ${e.expect}（got ${e.got}）${e.hint || ''}`);
  process.exit(1);
}
if (WITH_SIM) report.missing_notes.push(SIM_MISSING_NOTE);

const file = `${TYPE}_${report.date}.json`;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, file), JSON.stringify(report, null, 1) + '\n');

// index.json：各类型最新一期索引（首屏示例标记）
const index = existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, 'utf8')) : { schema_version: '1.0', reports: {} };
index.generatedAt = report.generated_at;
index.reports[TYPE] = { date: report.date, file, is_sample: Boolean(IS_SAMPLE) || Boolean(index.reports[TYPE]?.is_sample) };
if (IS_SAMPLE) index.sampleNote = `首屏示例：首次打开页面时显示 ${report.date} 报告（docs/ai_report_module_design.md §3.4）`;
writeFileSync(INDEX_FILE, JSON.stringify(index, null, 1) + '\n');

console.log(`[ai-report] ${TYPE} ${report.date} → data/reports/${file}（status=${report.status}，${report.missing_notes.length} 条缺失披露，${IS_SAMPLE ? '首屏示例 ' : ''}契约通过）`);
