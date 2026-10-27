// 外围（data/global.json）采集兜底校验（2026-10-12 用户指令）。
//
// 背景：fetch_global.mjs 抓取失败时保留上一次成功快照，并把
//   global.meta.lastAttempt = { outcome:'failed', ... } 写回。于是外围 quote 可能滞留在
//   数天前的旧值（如 10-08 的富时A50 在 10-12 仍被渲染成"今日隔夜"），阅读时极易误判。
//   旧 buildOverseas 只查 q.ok / chgPct，从不核验 quoteTime 陈旧度 → 旧值被静默展示。
//
// 混合策略（用户拍板）：
//   · quoteTime 日期 < 今日 且 ≥ STALE_DAYS 天（默认 2）→ action='null'（置空，渲染 —），
//     并在 alerts 打「已陈旧 N 天，采集失败未刷新，已置空」；
//   · 仅当日抓取失败、旧值 < STALE_DAYS 天（多为昨天）→ action='keep_tag'，保留数值但
//     在 cacheNote 强制追加【历史缓存，今日外围采集失败】标注，alerts 同步提示；
//   · quoteTime 为今日（age≤0）→ 新鲜，正常 keep；
//   · 单 quote ok=false → 无值可渲染，直接 null（与既有 ok=false→null 一致）。
//
// 纯函数：不读文件、不发请求；today 由调用方注入（默认 todayBeijing），便于测试。
import { bjDate } from './time.js';

// 陈旧天数阈值：≥ 此值即判定为"长期滞留"，宁可置空也不展示可能误导的旧值。
export const STALE_DAYS = 2;
export const EXTERNAL_CACHE_TAG = '【历史缓存，今日外围采集失败】';

function quoteDateStr(q) {
  if (!q || !q.quoteTime) return null;
  const s = String(q.quoteTime).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function dayDiff(a, b) {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round((db - da) / 86400000);
}

/**
 * 校验 global.json 的外围 quote 数组。
 * @param {object} global data/global.json（含 quotes[] 与 meta.lastAttempt）
 * @param {{today?:string}} [opts] today 为 YYYY-MM-DD，缺省取 todayBeijing()
 * @returns {{results: Record<string, {key:string,name:string,chgPct:number|null,state:string,stale:boolean,action:'keep'|'keep_tag'|'null',note:string|null}>, alerts: string[], today:string, fetchFailed:boolean}}
 */
export function validateExternal(global, opts = {}) {
  const today = opts.today || bjDate();
  const lastAttempt = global && global.meta && global.meta.lastAttempt;
  const fetchFailed = !!(lastAttempt && lastAttempt.outcome === 'failed');
  const quotes = (global && Array.isArray(global.quotes)) ? global.quotes : [];
  const results = {};
  const alerts = [];

  for (const q of quotes) {
    if (!q || !q.key) continue;
    const name = q.name || q.key;
    const qd = quoteDateStr(q);
    const age = qd ? dayDiff(qd, today) : null; // null = 无抓取时刻，无法判日期
    const ok = q.ok !== false;

    let action = 'keep';
    let note = null;
    if (!ok) {
      action = 'null';
    } else if (qd == null) {
      // 无 quoteTime：日期未知；若全局抓取失败则保守保留+标记，否则视为可用。
      if (fetchFailed) { action = 'keep_tag'; note = EXTERNAL_CACHE_TAG; }
    } else if (age <= 0) {
      action = 'keep'; // 当日抓取，新鲜
    } else if (age < STALE_DAYS) {
      // 仅当日抓取失败（fetchFailed）且旧值<阈值 → 保留+标记；否则视为可用（keep）。
      // 当日抓取失败时才需要警示"这是历史缓存"，正常刷新出的旧值不应被误标。
      if (fetchFailed) { action = 'keep_tag'; note = EXTERNAL_CACHE_TAG; }
      else action = 'keep';
    } else {
      action = 'null'; // 长期滞留 → 置空
    }

    // chgPct 单位换算（与 buildOverseas 同款）：global.json 存百分数值，报告层用小数。
    const chgPct = (action !== 'null' && q.chgPct != null && Number.isFinite(q.chgPct))
      ? q.chgPct / 100
      : null;
    const state = action === 'null' ? 'stale' : (q.state || (ok ? 'ok' : 'unknown'));

    if (action === 'null') {
      // 用户指令（2026-10-27）：时间差（年龄≥2天）导致的外围未刷新 → 中性「已陈旧 N 天（未刷新）」，
      // 绝不写「采集失败」（采集失败是另一回事，只在无日期陈旧的真正抓取失败场景标注）。
      if (age != null && age >= STALE_DAYS) {
        alerts.push(`外围「${name}」已陈旧 ${age} 天（未刷新），已置空`);
      } else {
        // 非时间差导致的置空（如单 quote ok=false、无 quoteTime 且抓取失败）：按是否真失败标注
        const failNote = fetchFailed ? '（采集失败未刷新）' : '（外围未刷新到最新会话）';
        alerts.push(`外围「${name}」${failNote}，已置空`);
      }
    } else if (action === 'keep_tag') {
      alerts.push(`外围「${name}」为历史缓存（今日采集失败），仅供参考`);
    }

    results[q.key] = { key: q.key, name, chgPct, state, stale: action === 'keep_tag', action, note };
  }

  return { results, alerts, today, fetchFailed };
}
