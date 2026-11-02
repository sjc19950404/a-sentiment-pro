#!/usr/bin/env node
// ── EOD 推送「优先级 + 时间错峰」引擎 ─────────────────────────────────────
//
// 优先级：月报 > 周报(+周盈利战报) > 盘后基础复盘 > AI 盘后情报。
//   · 月末最后一个交易日：仅【月报】+【盘后基础复盘数据】；【周报】【AI 盘后情报】静默。
//   · 周五（非月末）：【周报】+【周盈利战绩】+【盘后基础复盘数据】；【AI 盘后情报】静默。
//   · 普通交易日：【盘后基础复盘数据】+【AI 盘后情报】。
// 时间错峰：多条消息间隔 delayMs（默认 3s，env PUSH_STAGGER_MS 可调）依次发，防企微限流/指纹误判。
// 盘中紧急异动 / 盘前排雷与观察清单：由各自独立 cron 模式（candidates/intraday、pre_open）推送，
//   **不受本引擎 gate**——盘中 urgent 最高特权、盘前核心不省略（天然满足）。
//
// 纪律：只读 reports/archive/account；复用 OPS_WEBHOOK + pushReports 指纹去重；全程 fail-open。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { pushReports, PUSH_CONSTS, gateWeekly, gateMonthly } from '../src/ai_report_push.js';
import { composeEodPlan } from '../src/battle_report.js';
import { buildBattleReport, closedDaysOf } from './push_battle_report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS_DIR = join(ROOT, 'data', 'reports');
const INDEX_FILE = join(REPORTS_DIR, 'index.json');
const ARCHIVE_FILE = join(ROOT, 'data', 'archive.json');
const ACCOUNT_FILE = join(ROOT, 'data', 'paper', 'account.json');
const STATE_FILE = join(REPORTS_DIR, 'push_state.json');
const DELAY_MS = Number(process.env.PUSH_STAGGER_MS) || 3000;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// 读某类型最新一期报告（仅当在新鲜度窗口内；过期视为上一期残留，跳过）
function loadFresh(type) {
  const index = readJson(INDEX_FILE);
  const entry = index?.reports?.[type];
  if (!entry?.file) return null;
  const p = join(REPORTS_DIR, entry.file);
  if (!existsSync(p)) return null;
  const report = readJson(p);
  if (!report) return null;
  const age = Date.now() - Date.parse(report.generated_at);
  if (!Number.isFinite(age) || age > PUSH_CONSTS.FRESH_WINDOW_MS) {
    console.log(`[eod] ${type} ${entry.date} 超出新鲜度窗口 → 疑上一期残留，跳过`);
    return null;
  }
  return report;
}

async function main() {
  const closed = closedDaysOf();
  const post = loadFresh('post_market');
  const weekly = loadFresh('weekly');
  if (!post && !weekly) { console.log('[eod] 无新鲜盘后/周报可推，结束'); return; }
  const dataDate = (post && post.payload && post.payload.date) || (post && post.date) || (weekly && weekly.date);
  const isMonthEnd = gateMonthly(dataDate, closed).ok;
  const isWeekEnd = gateWeekly(dataDate, closed).ok;
  const plan = composeEodPlan({ isMonthEnd, isWeekEnd });
  console.log(`[eod] 数据日 ${dataDate}｜月末=${isMonthEnd}｜周五=${isWeekEnd}｜顺序=${plan.order.join(' → ')}｜AI情报=${plan.suppressAiBrief ? '静默' : '推送'}`);

  // 按优先级顺序组装报告数组（ai_brief 为 post_market 副报文，随主报文一起发，不单独入队）
  const reports = [];
  for (const slot of plan.order) {
    if (slot === 'post_market_base') { if (post) reports.push(post); }
    else if (slot === 'weekly') { if (weekly) reports.push(weekly); }
    else if (slot === 'weekly_performance' || slot === 'monthly_review') {
      const account = readJson(ACCOUNT_FILE);
      const archive = readJson(ARCHIVE_FILE);
      const refDate = (account && account.lastSettle) || dataDate;
      const battle = await buildBattleReport({ account, archive, refDate, closedDays: closed });
      if (battle) reports.push(battle);
    }
  }
  if (!reports.length) { console.log('[eod] 组合后无待推报告，结束'); return; }

  const { results, pushed, skipped } = await pushReports(reports, { stateFile: STATE_FILE, delayMs: DELAY_MS, suppressAiBrief: plan.suppressAiBrief });
  for (const r of results) console.log(`[eod] ${r.type} ${r.date}: ${r.pushed ? '已推送' : '未推送'}（${r.reason}）`);
  console.log(`[eod] 完成：推 ${pushed} / 跳 ${skipped} · 错峰 ${DELAY_MS}ms · 通道 ${PUSH_CONSTS.WEBHOOK_ENV}${process.env[PUSH_CONSTS.WEBHOOK_ENV] ? '' : '（未配置 → 仅落盘）'}`);
}

// ── 推演模式：--simulate YYYY-MM-DD（不推送，仅打印各时间点发哪几条）────────
const LABEL = {
  monthly_review: '🏆 月度大复盘',
  weekly: '📅 情绪周报',
  weekly_performance: '📊 周盈利战报',
  post_market_base: '📈 盘后基础复盘数据',
  ai_brief: '🤖 AI 盘后情报',
};
function simulate(dateArg) {
  const d = dateArg || '2026-10-30';
  const closed = closedDaysOf();
  const isMonthEnd = gateMonthly(d, closed).ok;
  const isWeekEnd = gateWeekly(d, closed).ok;
  const plan = composeEodPlan({ isMonthEnd, isWeekEnd });
  const gap = Number(process.env.PUSH_STAGGER_MS) || 3000;
  console.log(`\n══ 推送推演：假设数据日 = ${d} ══`);
  console.log(`闸门判定：月末=${isMonthEnd}｜周五=${isWeekEnd}｜形态=${isMonthEnd ? '月末态' : isWeekEnd ? '周五态' : '普通交易日态'}`);
  const t0 = new Date(`${d}T18:35:00`);
  const lines = [];
  plan.order.forEach((slot, i) => {
    const at = new Date(t0.getTime() + i * gap);
    lines.push(`  T+${(i * gap) / 1000}s（${at.toTimeString().slice(0, 8)}）→ ${LABEL[slot] || slot}`);
  });
  console.log('依次推送：\n' + lines.join('\n'));
  const suppressed = [];
  if (plan.suppressAiBrief) suppressed.push('🤖 AI 盘后情报');
  if (isMonthEnd) suppressed.push('📅 情绪周报', '📊 周盈利战报');
  console.log(suppressed.length ? `静默不发：${suppressed.join('、')}` : '静默不发：无');
  console.log('盘中紧急异动 / 盘前排雷与观察清单：由独立 cron 模式推送，最高特权/核心，不受本引擎影响。\n');
}

const argv = process.argv.slice(2);
const simIdx = argv.indexOf('--simulate');
if (simIdx >= 0) { simulate(argv[simIdx + 1]); process.exit(0); }
main().catch((e) => { console.error(`[eod] 致命错误（fail-open，不炸管线）: ${e?.message || e}`); process.exit(0); });
