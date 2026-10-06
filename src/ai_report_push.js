// ── AI 报告推送与调度闸门（S2 · 2026-10-06 用户拍板）──────────────────────
//
// Node/CI 专用模块：import 了 node:fs 与 freshness/calendar（读日历），
//   **不入浏览器 bundle**——页面侧 S3 的「复制 → 云端推送」走云函数代理
//   （决议 2），不经本模块；页面即时轨调度复用 marketPhase 而非本模块。
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
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { marketPhase } from './freshness.js';
import { resolveHolidays } from './calendar.js';

export const PUSH_CONSTS = {
  STATE_TTL_MS: 30 * 86400 * 1000, // 指纹记忆 30 天（对齐 scripts/alert_channel.mjs SEEN_TTL）
  STATE_CAP: 400,                  // 状态文件条目上限（防无限增长）
  MSG_CAP: 2000,                   // 企微 text ~2048 字节，留余量
  FRESH_WINDOW_MS: 15 * 60 * 1000, // --latest 新鲜度窗口：只推"本次运行刚生成"的报告
  WEBHOOK_ENV: 'OPS_WEBHOOK',      // 复用现有运维通道 secret
  // 盘前"数据截至"附注阈值（自然日）：gap>3 才附"假期无更新"。周末 gap=3 不附——
  // 每周一都带"假期"字样是周性噪音，且"数据截至 X 收盘"基础行已消歧（2026-10-07
  // 用户提议 >1 天附注，按噪音权衡定 3，一行可改；调 1 即恢复用户原提议）。
  STALE_NOTE_GAP_DAYS: 3,
};

// ── 指纹（内容去重键）──────────────────────────────────────────────────
/**
 * 报告 → 内容指纹（sha256 前 16 位十六进制）。
 * 稳定域 = report_type / date / trigger / status / payload / missing_notes；
 * 剔除 generated_at / generated_by / data_health / data_completeness /
 * concepts / sources / disclaimer（易变或派生，重跑即变但内容未变）。
 */
export function fingerprintOf(report) {
  const stable = {
    report_type: report?.report_type,
    date: report?.date,
    trigger: report?.trigger,
    status: report?.status,
    payload: report?.payload,
    missing_notes: report?.missing_notes,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

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
  writeFileSync(file, JSON.stringify(pruneState(state), null, 1) + '\n');
  return state;
}

// ── 文本渲染（企微 text，四类各一版；缺失用 — 而非 0，与报告 null 纪律一致）──
const pct = (v, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`);
const txt = (v) => (v == null ? '—' : String(v));
const overseas = (p, key) => pct((p.overseas || []).find((q) => q && q.key === key)?.chgPct);
const simLine = (p) => {
  const sim = p.simulation_stock;
  if (!sim?.sentiment_cycle) return null;
  const sc = sim.sentiment_cycle;
  const phase = sc.phase_label ?? sc.phase;
  return `情绪周期: ${phase}(${sc.regime_raw ?? '—'}) · 建议仓位: ${sim.position_suggestion ?? '—'} · 候选池 ${sim.candidate_pool?.length ?? 0} 只`;
};

/**
 * 报告 → 企微 text 消息（简版；完整 JSON/页面视图不进推送）。
 * 四类各自的行集 + 通用尾注（缺失披露数与数据状态）。
 */
export function renderPushText(report) {
  const p = report?.payload || {};
  const lines = [];
  switch (report?.report_type) {
    case 'pre_market':
      lines.push(`【AI 报告 · 盘前】${report.date}`);
      { // 数据截至标注（2026-10-07 拍板）：盘前报告恒为**前一交易日收盘口径**，
        // 头部日期即数据日期，但读者易误读为"生成当日"。恒加一行点破；间隔超
        // 3 个自然日（节后首日/小长假）再附"假期无更新"——A 股休市期间情绪面
        // 数据本来就不产生，不是漏抓。间隔按自然日近似（UTC 日界，仅作标注用）。
        const dataDay = Date.parse(`${report.date}T00:00:00Z`);
        const genDay = Date.parse(report.generated_at);
        const gap = Number.isFinite(dataDay) && Number.isFinite(genDay)
          ? Math.floor((genDay - dataDay) / 86400000) : null;
        lines.push(`数据截至 ${txt(report.date)} 收盘${gap != null && gap > PUSH_CONSTS.STALE_NOTE_GAP_DAYS ? `（距生成 ${gap} 天，假期无更新）` : ''}`);
      }
      { const s = simLine(p); if (s) lines.push(s); }
      lines.push(`前日盈亏 ${pct(p.pnl_daily)} · 累计 ${pct(p.pnl_cumulative)} · 前日净值 ${p.prev_nav != null ? p.prev_nav.toFixed(4) : '—'}`);
      lines.push(`隔夜: A50 ${overseas(p, 'a50')} · 费半 ${overseas(p, 'sox')} · 净敞口分歧 ${txt(p.overnight_exposure?.posGap)}`);
      lines.push(`最高连板 ${txt(p.simulation_stock?.sentiment_cycle?.highest_chain)} · 炸板率 ${pct(p.simulation_stock?.sentiment_cycle?.broken_limit_ratio)}`);
      break;
    case 'intraday':
      lines.push(`【AI 报告 · 盘中】${report.date}${report.trigger !== 'schedule' ? ` · ${report.trigger}` : ''}`);
      { const s = simLine(p); if (s) lines.push(s); }
      lines.push(`运行回撤 ${pct(p.drawdown_vs_threshold?.dd_now)} · 距 DD 档位 ${p.drawdown_vs_threshold?.distance_pp != null ? `${p.drawdown_vs_threshold.distance_pp}pp` : '—'}（${p.drawdown_vs_threshold?.basis ?? '—'}）`);
      lines.push(`昨收口径: 当日 ${pct(p.pnl_daily)} · 累计 ${pct(p.pnl_cumulative)} · A50 ${overseas(p, 'a50')}`);
      { const hot = (p.simulation_stock?.candidate_pool || []).filter((c) => c.intraday_chg != null)
          .slice(0, 3).map((c) => `${c.name ?? c.code} ${pct(c.intraday_chg)}`).join(' · ');
        if (hot) lines.push(`候选池盘中(强势榜在列): ${hot}`); }
      break;
    case 'post_market':
      lines.push(`【AI 报告 · 盘后】${report.date}`);
      lines.push(`当日盈亏 ${pct(p.pnl_daily)} · 累计 ${pct(p.pnl_cumulative)} · 收盘回撤 ${pct(p.close_drawdown)}`);
      if (p.market_context) lines.push(`市场: 涨跌 ${txt(p.market_context.up_down)} · 涨停/跌停 ${txt(p.market_context.zt_dt)} · 亏钱效应 ${txt(p.market_context.pain)}`);
      if (p.backtest_deviation) lines.push(`vs 回测 v52: delta ${pct(p.backtest_deviation.delta)}`);
      { const s = simLine(p); if (s) lines.push(s); }
      break;
    case 'weekly':
      lines.push(`【AI 报告 · 周报】截至 ${report.date}`);
      lines.push(`周收益 ${pct(p.week_return)} · 周最大回撤 ${pct(p.max_drawdown_week)} · 盈利日占比 ${pct(p.profit_trade_ratio)}`);
      lines.push(`趋势切换 ${txt(p.trend_switch_hits)} 次 · 胜率 ${p.win_rate != null ? pct(p.win_rate) : '—（剧本口径，绑定缺席则 null）'}`);
      if (p.trend_switch_effect?.shadow_note) lines.push(p.trend_switch_effect.shadow_note);
      break;
    default:
      lines.push(`【AI 报告 · ${txt(report?.report_type)}】${txt(report?.date)}`);
  }
  const degraded = report?.status && report.status !== 'ok' ? ` · 数据状态 ${report.status}` : '';
  lines.push(`缺失披露 ${report?.missing_notes?.length ?? 0} 项${degraded}（完整版见页面 · 不构成投资建议）`);
  let text = lines.join('\n');
  if (text.length > PUSH_CONSTS.MSG_CAP) text = `${text.slice(0, PUSH_CONSTS.MSG_CAP - 20)}\n…（超长截断）`;
  return text;
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
  const url = env?.[PUSH_CONSTS.WEBHOOK_ENV];
  let state = stateFile ? loadPushState(stateFile) : { schema_version: '1.0', pushed: [] };
  const results = [];
  let pushed = 0;
  if (!url) {
    for (const report of list) results.push({ type: report.report_type, date: report.date, pushed: false, reason: '未配置 OPS_WEBHOOK，仅落盘' });
    return { results, pushed: 0, skipped: list.length, state };
  }
  const fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  for (const report of list) {
    const verdict = shouldPush(report, state, now);
    if (!verdict.push) { results.push({ type: report.report_type, date: report.date, pushed: false, reason: verdict.reason }); continue; }
    if (!fetchFn) { results.push({ type: report.report_type, date: report.date, pushed: false, reason: '当前环境无 fetch' }); continue; }
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: renderPushText(report) } }),
      });
      if (!res.ok) {
        // 失败不记指纹 → 下个 tick 内容未变仍会重试（自愈）
        results.push({ type: report.report_type, date: report.date, pushed: false, reason: `webhook HTTP ${res.status}（未记指纹，下拍重试）` });
        continue;
      }
      pushed += 1;
      state = recordPushed(state, { fingerprint: verdict.fingerprint, type: report.report_type, date: report.date }, now);
      results.push({ type: report.report_type, date: report.date, pushed: true, reason: verdict.reason });
    } catch (e) {
      results.push({ type: report.report_type, date: report.date, pushed: false, reason: `推送失败: ${e?.message || e}（未记指纹，下拍重试）` });
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
