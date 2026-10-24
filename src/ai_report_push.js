// ── AI 报告推送与调度闸门（S2 · 2026-10-06 用户拍板）──────────────────────
//
// Node/CI 专用模块：import 了 node:fs 与 freshness/calendar（读日历），
//   **不入浏览器/Worker bundle**——Worker 推送代理（决议 2 云端代理）与页面
//   即时轨只 import 纯渲染层 src/push_text.js（PUSH_CONSTS/renderPushText，
//   零 Node 依赖三端通用，本模块 re-export 保持既有 import 路径零改动）；
//   页面即时轨调度复用 marketPhase 而非本模块。
//
// 推送纪律（沿 src/opsalerts.js::pushOpsAlerts 同一通道与同一哲学）：
//   · 同一企微机器人（env OPS_WEBHOOK，复用现有运维 secret，零新增配置）；
//     未配置 → 静默跳过（skipped），本地零打扰；
//   · 指纹防风暴 = **内容指纹去重**：剔除 generated_at 等易变字段后哈希——
//     同内容重跑（如 18:30 首抓后 21:00 补抓数据未变）不重推；数据真变了 →
//     新指纹 → 照推。宁可多推一条真变化，不静默漏推；
//   · urgent（event:* 四类，决议 3 枚举锁死）免指纹直达；
//   · fetch 失败绝不 throw（推送不能炸数据管线）：错误如实上报调用方，
//     且失败**不记指纹** → 下个 tick 自然重试（自愈，无需人工干预）。
//
// 调度闸门（纯函数，相位判据与 scripts/snapshot_intraday.mjs 同源）：
//   gatePreMarket —— 北京当日为交易日才生成（09:05 cron 用，9:00-9:10 窗口）；
//   gateIntraday  —— 相位 live（09:30-15:00）才生成（盘中 tick 用）；
//   gateWeekly    —— tradeDate 为本周最后交易日才生成（周五，或节前最后一天）。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { atomicWriteJSON } from './fsutil.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketPhase } from './freshness.js';
import { resolveHolidays } from './calendar.js';
import { PUSH_CONSTS, renderPushText, sanitizeWebhookUrl, fingerprintOf } from './push_text.js';
import { loadRiskBlacklist } from './risk_blacklist.js';

export { PUSH_CONSTS, renderPushText, fingerprintOf }; // 纯渲染层 re-export（Worker/浏览器经 push_text.js 直取，既有 import 路径零改动；fingerprintOf 统一实现见 push_text.js）

// ── 指纹（内容去重键）──────────────────────────────────────────────────
// 统一实现见 src/push_text.js::fingerprintOf（djb2，三端同构，2026-10-12 全系统审计 Fix 4）。
// 此处不再各写一份算法——与 Worker 代理保持同一哈希，避免同内容因算法分叉而双推。

/**
 * 防风暴判定（纯函数）。
 * @returns {{push:boolean, fingerprint:string, reason:string}}
 *   urgent（trigger ≠ schedule，决议 3 四类事件）恒放行（免防风暴直达）；
 *   否则 30 天内同指纹已推过 → 拦下。
 */
export function shouldPush(report, state, now = new Date()) {
  const fp = fingerprintOf(report);
  if (report?.urgent === true) return { push: true, fingerprint: fp, reason: 'urgent_direct（event:* 免防风暴直达，决议 3）' };
  const hit = (state?.pushed || []).some((p) => p && p.fingerprint === fp
    && now.getTime() - Date.parse(p.pushed_at) < PUSH_CONSTS.STATE_TTL_MS);
  return hit
    ? { push: false, fingerprint: fp, reason: 'duplicate_fingerprint（30 天内同内容已推）' }
    : { push: true, fingerprint: fp, reason: 'new_content' };
}

/** 状态修剪：超龄清理 + 条目上限（按 pushed_at 降序保最新 STATE_CAP 条）。 */
export function pruneState(state, now = new Date()) {
  const arr = (state?.pushed || [])
    .filter((p) => p && p.fingerprint && now.getTime() - Date.parse(p.pushed_at) < PUSH_CONSTS.STATE_TTL_MS)
    .sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at)))
    .slice(0, PUSH_CONSTS.STATE_CAP);
  return { schema_version: '1.0', pushed: arr };
}

/** 记一条成功推送（返回新状态对象，纯函数）。 */
export function recordPushed(state, entry, now = new Date()) {
  return pruneState({
    pushed: [...(state?.pushed || []), { ...entry, pushed_at: entry.pushed_at || now.toISOString() }],
  }, now);
}

// ── 状态文件 IO（坏档不炸推送：读失败按空状态处理）──────────────────────
export function loadPushState(file) {
  const empty = { schema_version: '1.0', pushed: [] };
  try {
    if (!file || !existsSync(file)) return empty;
    const s = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(s?.pushed) ? s : empty;
  } catch { return empty; }
}

export function savePushState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteJSON(file, JSON.stringify(pruneState(state), null, 1) + '\n');
  return state;
}

// ── 文本渲染（PUSH_CONSTS / renderPushText）已抽取至 src/push_text.js（纯函数层，
//    零 Node 依赖，Node/Worker/浏览器三端通用）——本模块 re-export 保持兼容。

// ── 企微「AI 游资内参」副报文（2026-10-24 用户方案）──────────────────────
// 设计：在现有推送层叠加**极简 AI 解读层**——所有 AI 文本在 EOD/夜间已由各 fetch
//   脚本预生成（signals 侧车档：舆情/板块情绪/妖股逻辑/排雷黑名单），推送时**只读取→
//   过滤→截断**，绝不在推送时刻调 GLM（延迟/成本/离线安全/确定性）。
//   · 排雷兵（pre_market）：黑名单 ∩（连板池 ∪ 自选池），命中 high/medium 才推，无雷静默。
//   · AI 盘后情报（post_market）：舆情+板块（题材，|舆情分|≥0.5 才推）+ 妖股（topN），各≤150字。
//   · 极端反转（reversal）：地天/天地板检测（EOD 近似），≤3 句突发警告（urgent）。
//   工程纪律：fail-open（任一数据缺失/为空→该副报文不推）；复用指纹/内容去重防刷屏。
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(SRC_DIR, '..', 'data');
const readJsonSafe = (rel) => {
  const p = join(DATA_DIR, rel);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};
// 连板池（今日）codes：ztpool_history.json 末条
function todayZtpoolCodes() {
  const hist = readJsonSafe('ztpool_history.json');
  const last = Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null;
  if (!last || !Array.isArray(last.pool)) return new Set();
  return new Set((last.pool).map((s) => String(s.c)));
}
// 自选池 codes：paper_universe.json 的 symbols 键
function pickCodes() {
  const u = readJsonSafe('paper_universe.json');
  const syms = u && u.symbols ? u.symbols : null;
  if (!syms) return new Set();
  return new Set(Object.keys(syms).map(String));
}
// 读 signals 的 AI 侧车（舆情/板块/妖股）——与 SPA/日报同源；degraded 一律当缺。
//   注意：llm/sectorSentiment/dragonLogic 位于 signals-latest.json 顶层（非 sig.signals 子对象）。
function readSignalsAi() {
  const sig = readJsonSafe('signals-latest.json');
  if (!sig || typeof sig !== 'object') return null;
  return {
    llm: sig.llm && sig.llm.degraded !== true ? sig.llm : null,
    sector: sig.sectorSentiment && sig.sectorSentiment.degraded !== true ? sig.sectorSentiment : null,
    dragon: sig.dragonLogic && sig.dragonLogic.degraded !== true ? sig.dragonLogic : null,
  };
}
// 极端反转检测（EOD 近似：今日 vs 昨日 ztpool）——地天板/天地板
function detectReversals() {
  const hist = readJsonSafe('ztpool_history.json');
  if (!Array.isArray(hist) || hist.length < 2) return [];
  const today = hist[hist.length - 1];
  const yest = hist[hist.length - 2];
  if (!today || !Array.isArray(today.pool)) return [];
  const yMap = new Map((yest.pool || []).map((s) => [String(s.c), s]));
  const out = [];
  for (const s of today.pool) {
    const zdp = typeof s.zdp === 'number' ? s.zdp : null;
    const yzdp = yMap.get(String(s.c));
    const yz = yzdp && typeof yzdp.zdp === 'number' ? yzdp.zdp : null;
    const ylbc = yzdp && yzdp.lbc ? yzdp.lbc : 0;
    if (zdp != null && zdp >= 9.5 && yz != null && yz <= -9.5) out.push({ code: s.c, name: s.n, type: '地天板' });
    else if (zdp != null && zdp <= -9.5 && (yz != null && yz >= 9.5 || ylbc >= 1)) out.push({ code: s.c, name: s.n, type: '天地板' });
  }
  return out.slice(0, 6);
}
// 长度硬截断（保尾行：数据采集时间 + 免责）
function capChars(text, n, keepTail = 2) {
  if (text.length <= n) return text;
  const lines = text.split('\n');
  if (lines.length > keepTail + 1) {
    const tail = lines.slice(-keepTail).join('\n');
    const head = lines.slice(0, lines.length - keepTail).join('\n');
    return `${head.length > n - 24 ? head.slice(0, n - 24) : head}\n…（截断）\n${tail}`;
  }
  return `${text.slice(0, n - 6)}\n…（截断）`;
}
// 内容级去重（与前一日完全一致则跳过防刷屏）：忽略 date 的指纹 + 近 2 天窗口
function contentSeenRecently(state, cfp, now, withinMs = 2 * 86400000) {
  return (state?.pushed || []).some((p) => p && p.cfp === cfp && Number.isFinite(Date.parse(p.pushed_at)) && now.getTime() - Date.parse(p.pushed_at) < withinMs);
}

/** 副报文：盘前排雷兵（黑名单 ∩ 连板池∪自选池；high/medium 才推）。 */
export function buildMineAlert(report) {
  const { data } = loadRiskBlacklist(join(DATA_DIR, 'llm_risk_blacklist.json'));
  if (!data || !Array.isArray(data.blacklist) || !data.blacklist.length) return null;
  const scope = new Set([...todayZtpoolCodes(), ...pickCodes()]);
  if (!scope.size) return null;
  // 降噪：按严重度降序（high > medium），单日命中 > 5 只只推前 5 并在末尾标注总数
  const sev = (b) => (b.riskLevel === 'high' ? 2 : b.riskLevel === 'medium' ? 1 : 0);
  const hits = data.blacklist
    .filter((b) => scope.has(String(b.code)) && (b.riskLevel === 'high' || b.riskLevel === 'medium'))
    .sort((a, b) => sev(b) - sev(a));
  const total = hits.length;
  if (!total) return null;
  const shown = hits.slice(0, 5);
  const text = [
    '☠ ⚠ 【AI 盘前排雷警报】',
    `今日您的自选池/连板池中，有 ${total} 只股票出现重大利空，已由系统强制拉黑：`,
    ...shown.map((h) => `☠ ${h.name}（${h.code}）：${(h.reasons || []).join('、')}`),
    total > 5 ? `等共 ${total} 只触发风险，请前往前端查看完整黑名单` : '(系统已拦截自动建仓，请手动规避)',
  ].join('\n');
  const cfp = fingerprintOf({ payload: { t: text } });
  return { text, cfp, dedupeContent: true, synthetic: { report_type: 'pre_market_mine', date: report.date, trigger: report.trigger, status: report.status, generated_at: report.generated_at, payload: { text }, missing_notes: null } };
}
/** 副报文：AI 盘后情报（舆情+板块 题材 ≥0.5 才推；妖股 topN；各≤150字）。 */
export function buildAiBrief(report) {
  const ai = readSignalsAi();
  if (!ai) return null;
  const blocks = [];
  const llm = ai.llm;
  if (llm && typeof llm.sentimentRaw === 'number' && Math.abs(llm.sentimentRaw) >= 0.5) {
    const dir = llm.sentimentRaw > 0 ? '乐观' : '悲观';
    const macro = ai.sector && ai.sector.macro ? ai.sector.macro.label : null;
    const blackTalk = ai.sector && ai.sector.blackTalk ? ` ${ai.sector.blackTalk}` : '';
    let t = `🎯 题材解读：智谱舆情 ${llm.sentimentRaw}（${dir}）${macro ? `，核心逻辑：${macro}。` : ''}${blackTalk}`;
    if (t.length > 150) t = `${t.slice(0, 149)}…`;
    blocks.push(t);
  }
  const pure = (ai.dragon && Array.isArray(ai.dragon.pureSentiment) ? ai.dragon.pureSentiment : []);
  if (pure.length) {
    const items = [];
    let used = '🐉 妖股透视：'.length;
    for (const x of pure) {
      const one = `${x.name}(${x.lb || '?'}板)→${(x.reason || '纯情绪博弈').slice(0, 30)}；`;
      if (used + one.length > 150) break;
      items.push(one); used += one.length;
    }
    if (items.length) blocks.push('🐉 妖股透视：' + items.join(''));
  }
  if (!blocks.length) return null;
  const text = ['🤖 【AI 盘后情报】', ...blocks].join('\n');
  const cfp = fingerprintOf({ payload: { t: text } });
  return { text, cfp, dedupeContent: true, synthetic: { report_type: 'post_market_ai', date: report.date, trigger: report.trigger, status: report.status, generated_at: report.generated_at, payload: { text }, missing_notes: null } };
}
/** 副报文：盘后地天/天地板异动复盘（随 21:00 post_market 一起推；EOD 日频近似）。 */
export function buildReversalAlert(report, now) {
  const revs = detectReversals();
  if (!revs.length) return null;
  const text = [
    '📉 【盘后极端异动复盘】',
    ...revs.slice(0, 3).map((r) => `今日极端异动：${r.name}（${r.code}）上演${r.type}，明日注意情绪反噬风险。`),
  ].join('\n');
  return { text, synthetic: { report_type: 'post_market_reversal', date: report.date, trigger: 'event:reversal', status: 'ok', generated_at: report.generated_at || (now && now.toISOString()) || new Date().toISOString(), payload: { text }, missing_notes: null } };
}

// 盘中异动单条预警（≤30 字硬约束）：急跌幅度 + 新闻一句话（若无则提示留意消息面）
function makeIntradayAlertLine(name, code, chg, news) {
  const tag = `⚠${name}急跌${chg.toFixed(1)}%`;
  if (news && news.summary) {
    const s = String(news.summary).slice(0, 30);
    const full = `${tag}，${s}`;
    return full.length > 30 ? `${tag}，${s.slice(0, 30 - tag.length - 2)}…` : full;
  }
  return `${tag}，留意消息面。`;
}

/** 副报文：盘中轻量 AI 监控（持仓 + 连板池急跌/异动 → ≤30 字预警；非极端不打扰）。 */
export function buildIntradayAlert(report, now) {
  const alerts = [];
  // 新闻侧车（盘中 cron 推送前一步预生成；仅含触发标的）
  const newsMap = (() => {
    const n = readJsonSafe('intraday-news-latest.json');
    return (n && n.news && typeof n.news === 'object') ? n.news : {};
  })();
  // 主源：盘中报价侧车（持仓 + 连板池，实时 chgPct），带新鲜度闸（30 分钟内）防误报
  const q = readJsonSafe('intraday-quotes-latest.json');
  const nowMs = (now && now.getTime && now.getTime()) || Date.now();
  const FRESH_MS = 30 * 60000;
  let usedQuotes = false;
  if (q && !q.degraded && Array.isArray(q.quotes)) {
    const age = nowMs - Date.parse(q.generatedAt);
    if (!Number.isFinite(age) || age <= FRESH_MS) {
      usedQuotes = true;
      for (const s of q.quotes) {
        if (typeof s.chgPct === 'number' && s.chgPct <= -5) alerts.push(makeIntradayAlertLine(s.name || s.code, s.code, s.chgPct, newsMap[s.code]));
      }
    } else {
      console.error(`[intraday-alert] 报价侧车过期（${(age / 60000).toFixed(0)}分钟），跳过（防误报）`);
    }
  }
  // 兜底（无侧车 / 过期 / 降级）：连板池 EOD 快照 zdp <= -5%
  if (!usedQuotes) {
    const hist = readJsonSafe('ztpool_history.json');
    const last = Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null;
    (last && Array.isArray(last.pool) ? last.pool : []).forEach((s) => {
      const zdp = typeof s.zdp === 'number' ? s.zdp : null;
      if (zdp != null && zdp <= -5) alerts.push(makeIntradayAlertLine(s.n || s.c, s.c, zdp, newsMap[s.c]));
    });
  }
  if (!alerts.length) return null;
  const capped = alerts.slice(0, 3); // 每条已 ≤30 字；封顶 3 条
  const text = ['🔔 【盘中异动预警】（持仓/连板池）', ...capped].join('\n');
  return { text, synthetic: { report_type: 'intraday_alert', date: report.date, trigger: 'event:intraday', status: 'ok', generated_at: report.generated_at || new Date().toISOString(), payload: { text }, missing_notes: null } };
}

// ── 实盘跟单指令（Signal Sync · 2026-10-24 用户需求）──────────────────────
// 把纸面引擎算出的买卖信号，单独成条、极简（每条 <100 字）推企微——与常规日报
//   完全独立，一眼看懂即可手动执行。不改动交易核心逻辑（paper.js），仅在编排层收集信号。
//   · buys：今天/明天要建仓的标的（含建议买价含滑点、仓位、止损底线）
//   · sells：系统触发的卖出（隔日强制了结/移动止盈/硬止损/亏损不过三/断板清仓/跌停逃生）
//     urgent=true 表示当日已触发（如跌停逃生），应立刻市价卖出；否则 T+1 次日开盘手动卖。
//   每条信号是一个独立 report（report_type='signal_sync'），由 pushReports 统一去重/推送。
export function buildSignalSyncReports({ date, buys = [], sells = [], stopLabel = '-5%' }) {
  const out = [];
  for (const b of buys) {
    if (!b || !b.code) continue;
    out.push({
      report_type: 'signal_sync',
      date,
      trigger: 'schedule',
      status: 'ok',
      generated_at: new Date().toISOString(),
      payload: { text: [
        `🚀【实盘跟单·买入】${date}`,
        `标的：${b.code} ${b.name || b.code}`,
        `买价：≈${b.price}（含滑点）`,
        `仓位：总资金${Math.round((b.pct ?? 0.1) * 100)}%`,
        `止损：${stopLabel}无条件`,
      ].join('\n') },
    });
  }
  for (const s of sells) {
    if (!s || !s.code) continue;
    out.push({
      report_type: 'signal_sync',
      date,
      trigger: 'schedule',
      status: 'ok',
      generated_at: new Date().toISOString(),
      payload: { text: [
        `🚨【实盘跟单·卖出】${date}`,
        `标的：${s.code} ${s.name || s.code}`,
        `原因：${s.reason || '系统触发卖出'}`,
        `动作：${s.urgent ? '立刻市价卖出（今日已触发）' : '明日开盘手动卖出（T+1 解冻）'}`,
      ].join('\n') },
    });
  }
  return out;
}

// ── 推送出口（唯一副作用点：fetch + 状态文件；均可注入以便单测）──────────
/**
 * 推送一组报告（按序；同批内也做指纹去重——重跑同内容只推一次）。
 * @param {Array<object>|object} reports 报告对象（信封完整结构）
 * @param {{env?:object, fetchImpl?:Function, stateFile?:string|null, now?:Date}} opts
 *   env.fetchImpl/stateFile 全部可注入（测试零网络零磁盘）；
 *   stateFile 为 null → 纯推送不落状态（不推荐 CI 用，仅供测试/预览）。
 * @returns {{results:Array, pushed:number, skipped:number, state:object}}
 *   永不 reject（告警纪律：推送失败不炸数据管线，错误进 results[].reason）。
 */
export async function pushReports(reports, { env = process.env, fetchImpl, stateFile = null, now = new Date() } = {}) {
  const list = (Array.isArray(reports) ? reports : [reports]).filter(Boolean);
  const rawWebhook = env?.[PUSH_CONSTS.WEBHOOK_ENV];
  // secret 值清洗（对齐 Worker push_proxy，2026-10-10 BOM 踩坑根治）：
  //   轻度污染（BOM/零宽/首尾空白）自愈；raw 非空但清洗后非法 → 全员标记
  //   「值非法」跳过推送，绝不静默把脏值当未配置（那是丢推送）。
  const url = rawWebhook ? sanitizeWebhookUrl(rawWebhook) : null;
  let state = stateFile ? loadPushState(stateFile) : { schema_version: '1.0', pushed: [] };
  const results = [];
  let pushed = 0;
  if (!rawWebhook) {
    for (const report of list) results.push({ type: report.report_type, date: report.date, pushed: false, reason: '未配置 OPS_WEBHOOK，仅落盘' });
    return { results, pushed: 0, skipped: list.length, state };
  }
  if (!url) {
    for (const report of list) results.push({ type: report.report_type, date: report.date, pushed: false, reason: 'OPS_WEBHOOK 值非法（不可见字符清洗后仍不合法）——用 scripts/set_ops_webhook.mjs 码位验证后重写（未记指纹）' });
    return { results, pushed: 0, skipped: list.length, state };
  }
  const fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  for (const report of list) {
    // ── 主报文 A（数据日报，复用既有 renderPushText；盘后强限制 800 字）──
    let aText = renderPushText(report);
    if (report.report_type === 'post_market' && aText.length > 800) aText = capChars(aText, 800);
    const messages = [{ text: aText, synthetic: report, urgent: report.urgent === true, cfp: null, dedupeContent: false }];
    // ── 副报文（fail-open：构造异常不影响主报文）──
    try {
      if (report.report_type === 'pre_market') { const m = buildMineAlert(report); if (m) messages.push(m); }
      if (report.report_type === 'post_market') {
        const m = buildAiBrief(report); if (m) messages.push(m);
        const rev = buildReversalAlert(report, now); if (rev) messages.push(rev);
      }
      if (report.report_type === 'intraday') { const a = buildIntradayAlert(report, now); if (a) messages.push(a); }
    } catch (e) {
      console.error(`[企微副报文] 构造异常（跳过副报文，不影响主报文）: ${e?.message || e}`);
    }
    for (const m of messages) {
      if (m.dedupeContent && m.cfp && contentSeenRecently(state, m.cfp, now)) {
        results.push({ type: m.synthetic.report_type, date: report.date, pushed: false, reason: 'ai_content_repeat（与前值一致，跳过防刷屏）' });
        continue;
      }
      const verdict = shouldPush(m.synthetic, state, now);
      if (!verdict.push) { results.push({ type: m.synthetic.report_type, date: report.date, pushed: false, reason: verdict.reason }); continue; }
      if (!fetchFn) { results.push({ type: m.synthetic.report_type, date: report.date, pushed: false, reason: '当前环境无 fetch' }); continue; }
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msgtype: 'text', text: { content: m.text } }),
        });
        // 解析企微响应体（fetch 注入的 mock 可能没有 .json()/.text()，标准 Response 两者俱在）
        let wechat = {};
        try {
          if (typeof res?.json === 'function') wechat = await res.json();
          else if (typeof res?.text === 'function') { try { wechat = JSON.parse(await res.text()); } catch { /* swallow */ } }
        } catch { wechat = {}; }
        console.log(`[企微推送结果] ${m.synthetic.report_type} ${report.date} → HTTP ${res.status}, errcode: ${wechat.errcode}, errmsg: ${wechat.errmsg}`);
        // 失败判据：HTTP 非 2xx OR 企微 errcode ≠ 0（93xxx 静默丢包场景：企微常以 HTTP 200 + errcode 9xxxx 表示群解散/机器人被拉起）
        const httpFail = !res.ok;
        const apiFail = wechat.errcode !== undefined && wechat.errcode !== 0;
        if (httpFail || apiFail) {
          // 失败不记指纹 → 下个 tick 内容未变仍会重试（自愈）
          const reason = httpFail
            ? `webhook HTTP ${res.status}（未记指纹，下拍重试）`
            : `企微 errcode=${wechat.errcode} errmsg=${wechat.errmsg}（未记指纹，下拍重试）`;
          results.push({ type: m.synthetic.report_type, date: report.date, pushed: false, reason });
          continue;
        }
        pushed += 1;
        state = recordPushed(state, {
          fingerprint: verdict.fingerprint,
          type: m.synthetic.report_type,
          date: report.date,
          cfp: m.cfp || undefined,
          // 推送前校验审计摘要仅挂主报文（m.cfp 缺席者即主报文；副报文不冒充校验结论）
          verified: m.cfp ? undefined : (report.push_verification ? {
            checked_at: report.push_verification.checkedAtBJ ?? null,
            snapshot_at: report.push_verification.snapshotAtBJ ?? null,
            removed: (report.push_verification.trend?.removed?.length || 0)
              + (report.push_verification.streak?.removed?.length || 0),
            degraded: report.push_verification.mode_degraded === true,
            skipped: report.push_verification.applied !== true,
          } : undefined),
        }, now);
        results.push({ type: m.synthetic.report_type, date: report.date, pushed: true, reason: verdict.reason });
      } catch (e) {
        results.push({ type: m.synthetic.report_type, date: report.date, pushed: false, reason: `推送失败: ${e?.message || e}（未记指纹，下拍重试）` });
      }
    }
  }
  if (stateFile) savePushState(stateFile, state);
  return { results, pushed, skipped: list.length - pushed, state };
}

// ── 调度闸门（纯函数；跳过 = 正常退出，不是错误）────────────────────────
/** 盘前闸门：北京当日为交易日（09:05 cron；非交易日不出盘前报告）。 */
export function gatePreMarket(now = new Date(), holidays = resolveHolidays()) {
  const ph = marketPhase(now, holidays);
  return ph.isTradingDay
    ? { ok: true, reason: `交易日 ${ph.bjDate}（北京 ${ph.bjTime}）→ 生成盘前报告` }
    : { ok: false, reason: `北京 ${ph.bjDate} 非交易日 → 盘前报告跳过` };
}

/** 盘中闸门：相位 live（09:30~15:00；与 snapshot_intraday 同一判据源）。 */
export function gateIntraday(now = new Date(), holidays = resolveHolidays()) {
  const ph = marketPhase(now, holidays);
  return ph.phase === 'live'
    ? { ok: true, reason: `相位 live（北京 ${ph.bjDate} ${ph.bjTime}）→ 生成盘中报告` }
    : { ok: false, reason: `相位 ${ph.phase}（北京 ${ph.bjDate} ${ph.bjTime}）→ 盘中报告跳过` };
}

/**
 * 周报闸门：tradeDate 必须是**本周最后一个交易日**（正常为周五；
 * 节前半周则为节前最后交易日——用 calendar.closed 判定，不写死周五）。
 * @param {string} tradeDate YYYY-MM-DD（dual_track 的数据日）
 * @param {string[]} closedDays 休市日数组（data/calendar.json::closed）
 */
export function gateWeekly(tradeDate, closedDays = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) return { ok: false, reason: `tradeDate 非法: ${tradeDate}` };
  const closed = new Set(closedDays);
  const cur = new Date(`${tradeDate}T00:00:00Z`);
  const dow = cur.getUTCDay(); // 0=周日 … 6=周六
  // 回退到本周一（ISO 周）
  cur.setUTCDate(cur.getUTCDate() - ((dow + 6) % 7));
  const weekMonday = cur.toISOString().slice(0, 10);
  // 从 tradeDate 次日起走到本周日：其间还有交易日 → tradeDate 不是本周最后交易日
  const probe = new Date(`${tradeDate}T00:00:00Z`);
  for (;;) {
    probe.setUTCDate(probe.getUTCDate() + 1);
    if (probe.getUTCDay() === 0) break; // 到周日为止（周六日本就非交易日）
    const iso = probe.toISOString().slice(0, 10);
    if (probe.getUTCDay() >= 1 && probe.getUTCDay() <= 5 && !closed.has(iso)) {
      return { ok: false, reason: `本周后续仍有交易日 ${iso} → 周报等 ${iso} 收盘后再生成（本周一 ${weekMonday}）` };
    }
  }
  return { ok: true, reason: `${tradeDate} 为本周（周一起 ${weekMonday}）最后交易日 → 生成周报` };
}

/**
 * 月报闸门：tradeDate 必须是**本月最后一个交易日**（用 calendar.closed 判定，不写死月末日）。
 * 与 gateWeekly 同思路：从 tradeDate 次日起走到本月最后一天，其间若还有交易日 → 不是月末。
 * @param {string} tradeDate YYYY-MM-DD
 * @param {string[]} closedDays 休市日数组（data/calendar.json::closed）
 */
export function gateMonthly(tradeDate, closedDays = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) return { ok: false, reason: `tradeDate 非法: ${tradeDate}` };
  const closed = new Set(closedDays);
  const cur = new Date(`${tradeDate}T00:00:00Z`);
  const month = cur.getUTCMonth();
  const probe = new Date(cur.getTime());
  for (;;) {
    probe.setUTCDate(probe.getUTCDate() + 1);
    if (probe.getUTCMonth() !== month) break; // 已进入下月 → 本月已走完
    const iso = probe.toISOString().slice(0, 10);
    const dow = probe.getUTCDay();
    if (dow >= 1 && dow <= 5 && !closed.has(iso)) {
      return { ok: false, reason: `本月后续仍有交易日 ${iso} → 月报等 ${iso} 收盘后生成` };
    }
  }
  return { ok: true, reason: `${tradeDate} 为本月最后交易日 → 生成月度大复盘` };
}
