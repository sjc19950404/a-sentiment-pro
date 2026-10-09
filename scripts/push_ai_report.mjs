#!/usr/bin/env node
// ── AI 报告推送入口（S2 · 企微 Webhook + 指纹防风暴，urgent 直达）─────────
//
// 用法：
//   node scripts/push_ai_report.mjs --latest post_market --latest weekly
//        按 data/reports/index.json 最新一期推送（可重复 --latest 多类型）；
//        仅推**新鲜度窗口内**（15 分钟）生成的报告——防把闸门跳过后残留的
//        上一期旧报告当新一期重推（旧内容另有指纹去重兜底，双保险）。
//   node scripts/push_ai_report.mjs data/reports/intraday_2026-10-08.json
//        显式文件推送（无新鲜度检查——点名要推的就是要推）。
//
// 通道：env OPS_WEBHOOK（现有运维企微机器人，零新增 secret；未配置 → 静默跳过）。
// 纪律：永不因推送失败退出非零（推送不炸数据管线；失败不记指纹 → 下拍自愈重试）；
//   仅参数错误（index 缺类型/文件不存在）exit 1——那是配置问题，必须红出来。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushReports, PUSH_CONSTS } from '../src/ai_report_push.js';
import { verifyIntradayPools, applyVerification } from '../src/pool_verify.js';
import { bjTime } from '../src/freshness.js';
import { atomicWriteJSON } from '../src/fsutil.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS_DIR = join(ROOT, 'data', 'reports');
const INDEX_FILE = join(REPORTS_DIR, 'index.json');
const STATE_FILE = join(REPORTS_DIR, 'push_state.json');

const argv = process.argv.slice(2);
const latestTypes = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--latest' && argv[i + 1]) { latestTypes.push(argv[i + 1]); i += 1; }
}
const files = argv.filter((a, i) => a !== '--latest' && argv[i - 1] !== '--latest');
if (!latestTypes.length && !files.length) {
  console.error('[ai-report-push] 缺参数：--latest <type>（可重复）或显式报告文件路径');
  process.exit(1);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const entries = []; // { path, report }——记来源路径，供校验台账写回

for (const f of files) {
  const p = f.startsWith('data/') || f.startsWith('/') ? resolve(ROOT, f) : resolve(process.cwd(), f);
  if (!existsSync(p)) { console.error(`[ai-report-push] 文件不存在: ${f}`); process.exit(1); }
  entries.push({ path: p, report: readJson(p) });
}

if (latestTypes.length) {
  if (!existsSync(INDEX_FILE)) { console.error('[ai-report-push] data/reports/index.json 不存在（先跑 build_ai_report.mjs）'); process.exit(1); }
  const index = readJson(INDEX_FILE);
  const now = Date.now();
  for (const type of latestTypes) {
    const entry = index.reports?.[type];
    if (!entry?.file) { console.error(`[ai-report-push] index 中无 ${type} 类型（先跑 build_ai_report.mjs --type ${type}）`); process.exit(1); }
    const p = join(REPORTS_DIR, entry.file);
    const report = readJson(p);
    // 新鲜度窗口：只推"本次运行刚生成"的（generated_at 距今 ≤ 15 分钟）
    const age = now - Date.parse(report.generated_at);
    if (!Number.isFinite(age) || age > PUSH_CONSTS.FRESH_WINDOW_MS) {
      console.log(`[ai-report-push] ${type} ${entry.date} 生成于 ${report.generated_at}（超出 ${PUSH_CONSTS.FRESH_WINDOW_MS / 60000} 分钟新鲜度窗口）→ 疑为上一期残留，跳过推送`);
      continue;
    }
    entries.push({ path: p, report });
  }
}

if (!entries.length) {
  console.log('[ai-report-push] 无待推报告（全部跳过），结束。');
  process.exit(0);
}

// ── 推送前校验（2026-10-10 用户指令）────────────────────────────────────────
//   盘中报告逐只重验双池规则：不满足的剔除（台账进推送文案 + 档案 push_verification）、
//   推送时刻进降级窗的自动降级明日观察池。校验是确定性的 → 剔除后内容 = 新指纹，
//   防风暴语义不变（重跑同快照同剔除 → 同指纹照旧去重）；台账写回档案随既有
//   `git add data/reports` 入库——提交规则零改动。复核快照缺席/非当日 → 如实跳过
//   （不拿旧快照冒充复核），台账记 note。
let intradaySnap = null;
try { intradaySnap = JSON.parse(readFileSync(join(ROOT, 'data', 'intraday.json'), 'utf8')); } catch { intradaySnap = null; }
const reports = [];
for (const e of entries) {
  if (e.report?.report_type === 'intraday') {
    const v = verifyIntradayPools(e.report, intradaySnap, { nowBJ: bjTime(new Date()) });
    applyVerification(e.report, v);
    const rm = (v.summary.trend?.removed?.length || 0) + (v.summary.streak?.removed?.length || 0);
    console.log(`[ai-report-push] 推送前校验 intraday ${e.report.date}（快照 ${v.summary.snapshotAtBJ ?? '—'}）：`
      + (v.summary.applied
        ? `核 ${v.summary.trend.checked + v.summary.streak.checked} 只 · 剔 ${rm} 只`
          + (v.summary.mode_degraded ? ` · 趋势池→明日观察池（距收盘 ${v.summary.minutes_to_close} 分）` : '')
        : `跳过——${v.summary.note}`));
    // 台账写回档案（无论推送成败：审计事实先落盘，推送失败重试时重新校验幂等）
    try { atomicWriteJSON(e.path, JSON.stringify(e.report, null, 1) + '\n'); }
    catch (err) { console.log(`[ai-report-push] 校验台账写回失败（不拦推送）: ${err?.message || err}`); }
  }
  reports.push(e.report);
}

const { results, pushed, skipped } = await pushReports(reports, { stateFile: STATE_FILE });
for (const r of results) console.log(`[ai-report-push] ${r.type} ${r.date}: ${r.pushed ? '已推送' : '未推送'}（${r.reason}）`);
console.log(`[ai-report-push] 完成：推 ${pushed} / 跳 ${skipped} · 状态落 ${'data/reports/push_state.json'} · 通道 ${PUSH_CONSTS.WEBHOOK_ENV}${process.env[PUSH_CONSTS.WEBHOOK_ENV] ? '' : '（未配置 → 仅落盘）'}`);
