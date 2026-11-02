#!/usr/bin/env node
// ── 战绩报表构建 + 独立推送（周度盈利战报 + 月度大复盘）────────────────────
//
// 两个入口：
//   · buildBattleReport({account, archive, refDate, closedDays}) —— 纯构建（只读），
//     返回当期战报 report 对象或 null；供 scripts/push_eod.mjs 复用（纳入统一错峰编排）。
//   · 直接运行（node scripts/push_battle_report.mjs）—— 独立构建并推送（手动/兜底用）。
//
// 纪律（用户铁律）：**只读** account/archive，绝不写回账户、绝不干预引擎交易；
//   复用 OPS_WEBHOOK + pushReports 指纹去重；全程 fail-open。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { pushReports, PUSH_CONSTS, gateWeekly, gateMonthly } from '../src/ai_report_push.js';
import { computePeriodStats, buildWeeklyPerformanceReport, buildMonthlyReviewReport } from '../src/battle_report.js';
import { isoWeekStart } from '../src/ai_report.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const ACCOUNT_FILE = join(DATA, 'paper', 'account.json');
const ARCHIVE_FILE = join(DATA, 'archive.json');
const CALENDAR_FILE = join(DATA, 'calendar.json');
const STATE_FILE = join(DATA, 'reports', 'push_state.json');

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
export const closedDaysOf = () => { const c = readJson(CALENDAR_FILE); return Array.isArray(c?.closed) ? c.closed : []; };

// ── GLM（OpenAI 兼容；glm-* → bigmodel 网关；缺配置/失败 → fail-open）──
function glmConfig() {
  const API_URL = process.env.LLM_API_URL
    || ((process.env.LLM_MODEL || '').startsWith('glm') ? 'https://open.bigmodel.cn/api/paas/v4' : '');
  return { API_URL, API_KEY: process.env.LLM_API_KEY || '', MODEL: process.env.LLM_MODEL || '' };
}
async function fetchWithRetry(url, opts, retries = 2) {
  let last;
  for (let i = 0; i <= retries; i += 1) {
    try { return await fetch(url, opts); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  throw last;
}
async function callGLMText(system, user, { maxTokens = 300 } = {}) {
  const { API_URL, API_KEY, MODEL } = glmConfig();
  if (!API_URL || !API_KEY || !MODEL) return null;
  try {
    const res = await fetchWithRetry(`${API_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content;
    return typeof txt === 'string' && txt.trim() ? txt.trim() : null;
  } catch (e) { console.error(`[battle] GLM 调用失败（fail-open）: ${e?.message || e}`); return null; }
}

// ── 本月市场概况（从 archive 只读聚合，喂 GLM 做宏观复盘）──────────────────
function monthProfile(archive, month) {
  const days = (archive?.all_days || []).filter((d) => d && String(d.trade_date || '').startsWith(month));
  if (!days.length) return null;
  const emos = days.map((d) => (d.emotion && Number.isFinite(+d.emotion.value)) ? +d.emotion.value : null).filter((v) => v != null);
  const avg = emos.length ? emos.reduce((a, b) => a + b, 0) / emos.length : null;
  return {
    tradeDays: days.length,
    avgEmotion: avg != null ? Math.round(avg * 10) / 10 : null,
    maxEmotion: emos.length ? Math.max(...emos) : null,
    minEmotion: emos.length ? Math.min(...emos) : null,
    highDays: emos.filter((v) => v >= 70).length,
    lowDays: emos.filter((v) => v < 40).length,
  };
}

function ruleDiscipline(s, stopCount) {
  const ddTxt = s.maxDd <= 0.03 ? '回撤控制良好' : '回撤偏大需收敛';
  let t = `本周触发纪律${stopCount}次，最大回撤${(s.maxDd * 100).toFixed(1)}%，${ddTxt}。`;
  return t.length > 50 ? `${t.slice(0, 49)}…` : t;
}
async function weeklyDiscipline(s, stopCount) {
  const rule = ruleDiscipline(s, stopCount);
  const ai = await callGLMText(
    '你是 A 股模拟盘纪律督察。据事实写一句不超过 50 字的纪律点评（犀利、可执行、不喊单）。只输出点评正文。',
    `本周平仓 ${s.closedCount} 笔，胜率 ${s.winRate == null ? '—' : (s.winRate * 100).toFixed(0)}%，盈亏比 ${s.plRatio ?? '—'}，`
    + `触发止损/了结纪律 ${stopCount} 次，最大回撤 ${(s.maxDd * 100).toFixed(1)}%。`,
    { maxTokens: 80 },
  );
  const out = (ai || rule).replace(/\s+/g, ' ').trim();
  return out.length > 50 ? `${out.slice(0, 49)}…` : out;
}
async function monthlyMacro(s, prof, month) {
  const fallback = prof
    ? `本月${prof.tradeDays}个交易日、平均情绪${prof.avgEmotion ?? '—'}（${prof.highDays} 高/${prof.lowDays} 低）。`
      + `策略收益 ${(s.navDeltaPct * 100).toFixed(1)}%、最大回撤 ${(s.maxDd * 100).toFixed(1)}%。`
      + (s.maxDd > 0.1 ? '回撤触及风控关注线，下月宜降仓位、严止损。' : '下月维持纪律、跟随情绪档位调仓。')
    : '本月归档数据不足，无法给出宏观复盘；下月维持现有出场纪律。';
  const ai = await callGLMText(
    '你是 A 股策略月度复盘官。据给定事实写一段不超过 130 字的宏观复盘：①判断本月是连板妖股行情、权重行情还是退潮行情；'
    + '②本策略（打板/连板隔日了结 + 移动止盈 + 硬止损）是否适应本月行情；③给下月一条具体战术建议。犀利、务实、不喊单。只输出正文。',
    `月份：${month}（请据此而非训练记忆）。市场概况：${JSON.stringify(prof)}。`
    + `账户表现：总收益 ${(s.navDeltaPct * 100).toFixed(1)}%，最大回撤 ${(s.maxDd * 100).toFixed(1)}%，平仓 ${s.closedCount} 笔，`
    + `胜率 ${s.winRate == null ? '—' : (s.winRate * 100).toFixed(0)}%，盈亏比 ${s.plRatio ?? '—'}。`,
    { maxTokens: 260 },
  );
  const out = (ai || fallback).replace(/\s+/g, ' ').trim();
  return out.length > 200 ? `${out.slice(0, 199)}…` : out;
}

/**
 * 构建当期战报（只读 account/archive）。月末→月报，否则周五→周盈利战报，其它日→null。
 * @returns {Promise<object|null>} report 对象或 null（无可报内容也返回 null）
 */
export async function buildBattleReport({ account, archive, refDate, closedDays = [] }) {
  if (!account || !refDate) return null;
  const isMonthEnd = gateMonthly(refDate, closedDays).ok;
  const isWeekEnd = gateWeekly(refDate, closedDays).ok;

  if (isMonthEnd) {
    const month = refDate.slice(0, 7);
    const range = { startDate: `${month}-01`, endDate: refDate };
    const s = computePeriodStats(account, range);
    if (!s.started && Math.abs(s.navDeltaPct || 0) < 1e-9) { console.log('[battle] 本月无交易且净值无变动，跳过'); return null; }
    const macro = await monthlyMacro(s, monthProfile(archive, month), month);
    return buildMonthlyReviewReport({ date: refDate, month, range, s, macroReview: macro });
  }
  if (isWeekEnd) {
    const range = { startDate: isoWeekStart(refDate), endDate: refDate };
    const s = computePeriodStats(account, range);
    if (!s.started && Math.abs(s.navDeltaPct || 0) < 1e-9) { console.log('[battle] 本周无交易且净值无变动，跳过'); return null; }
    const stopCount = (account.logs || []).filter((l) => l && l.date >= range.startDate && l.date <= range.endDate
      && (l.stage === 'exit' || l.stage === 'stop') && l.result === 'submitted').length;
    const discipline = await weeklyDiscipline(s, stopCount);
    return buildWeeklyPerformanceReport({ date: refDate, range, s, discipline });
  }
  return null;
}

// ── 独立运行（手动/兜底）：构建并推送 ─────────────────────────────────────
async function main() {
  const account = readJson(ACCOUNT_FILE);
  if (!account) { console.log('[battle] 无账户档案，跳过'); return; }
  const archive = readJson(ARCHIVE_FILE);
  const refDate = account.lastSettle
    || (Array.isArray(archive?.all_days) && archive.all_days.length ? archive.all_days[archive.all_days.length - 1].trade_date : null);
  if (!refDate) { console.log('[battle] 无法确定最近交易日，跳过'); return; }
  const report = await buildBattleReport({ account, archive, refDate, closedDays: closedDaysOf() });
  if (!report) { console.log('[battle] 当日无战绩报表可推'); return; }
  const { results, pushed, skipped } = await pushReports([report], { stateFile: STATE_FILE });
  for (const r of results) console.log(`[battle] ${r.type} ${r.date}: ${r.pushed ? '已推送' : '未推送'}（${r.reason}）`);
  console.log(`[battle] 完成：推 ${pushed} / 跳 ${skipped} · 通道 ${PUSH_CONSTS.WEBHOOK_ENV}${process.env[PUSH_CONSTS.WEBHOOK_ENV] ? '' : '（未配置 → 仅落盘）'}`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((e) => { console.error(`[battle] 致命错误（fail-open）: ${e?.message || e}`); process.exit(0); });
