// 窗口连板口径（N天M板）——2026-10-23 用户校准新增
//
// 为什么需要它：东财 getTopicZTPool 的 `lbc` 只数「连续」连板天数——昨天没涨停的票，
// 今天再涨停 lbc 也回到 1（首板）。公开复盘的「5天3板」「4天2板」「3天2板」这类
// 非连续连板会被系统性记成首板。实测（2026-10-23）：福莱新材/凡拓数创（5天3板）、
// 龙旗科技（4天2板）、中广天择（3天2板）当日均在涨停池但 lbc=1，「2板以上只数」
// 因此少算约三分之一，scorePnl 梯队评分被系统性压低。
//
// 本模块按「最近 N 个交易日（含当日）该股收盘涨停的天数」重算，与公开连板天梯的
// 「N天M板」同口径。**连续口径 lbc 原样保留**，两口径并列展示、互不覆盖；交易语义
// （连板池筛选 lbc≥2）不变——打板候选要的是连续梯队。
//
// membership 数据源（按优先级）：
//   ① 当日实时池（fetchPools 传入）；
//   ② data/ztpool_history.json 真实涨停池（每日 daily_fetch 入库）；
//   ③ data/ztpool_kline_membership.json——断更日（2026-10-19~10-22，东财不可回补）的
//      腾讯K线现算补档（scripts/backfill_ztpool_kline.mjs 一次性生成，qfq 前复权口径）。
// 窗口脊 = data/archive-recent.json 的交易日序列（档案口径，完整无断更）。
// 断更日未覆盖到的个股按「未涨停」计（保守方向：只可能少计，不会虚增）。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const WINDOW_DAYS = 5;

/** 读 data/ztpool_history.json（[{date:'YYYYMMDD', pool:[{c,lbc,...}]}]）；缺失/损坏返回 [] */
export function loadZtpoolHistory(root) {
  try {
    const p = join(root, 'data', 'ztpool_history.json');
    if (!existsSync(p)) return [];
    const days = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(days) ? days : [];
  } catch { return []; }
}

/** 读 archive-recent.json 的交易日序列（YYYYMMDD 升序，档案口径不断更） */
export function loadTradingSpine(root) {
  try {
    const p = join(root, 'data', 'archive-recent.json');
    if (!existsSync(p)) return [];
    const r = JSON.parse(readFileSync(p, 'utf8'));
    const dates = [];
    for (const d of r.days || []) if (d && d.trade_date) dates.push(String(d.trade_date).replace(/-/g, ''));
    if (r.latest && r.latest.trade_date) dates.push(String(r.latest.trade_date).replace(/-/g, ''));
    return [...new Set(dates)].sort();
  } catch { return []; }
}

/** 读断更日 K 线补档（{ 'YYYYMMDD': {code: lbc} }）；缺失返回 {} */
export function loadKlineMembership(root) {
  try {
    const p = join(root, 'data', 'ztpool_kline_membership.json');
    if (!existsSync(p)) return {};
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return (j && j.dates && typeof j.dates === 'object') ? j.dates : {};
  } catch { return {}; }
}

/**
 * 计算当日涨停池每只股票的窗口连板数（N天M板 的 M）。
 *
 * @param {Array}  history   ztpool_history（可含当日档——会被 todayPool 覆盖，以实时为准）
 * @param {Array}  todayPool 当日涨停池（[{c}] 或 [code]）
 * @param {string} todayYmd  当日 'YYYYMMDD'
 * @param {Object} [opts]    { windowDays=5, spine=[日期脊], kline={断更日补档} }
 * @returns {{ztLbw: Object<string,number>, lbw2: number, maxLbw: number|null, windowDates: string[], degraded: boolean}}
 *          degraded=true = 窗口脊不可用（archive-recent 缺失），退化为「当日单日」口径
 */
export function computeWindowBoards(history, todayPool, todayYmd, opts = {}) {
  const o = opts || {};
  const windowDays = o.windowDays || WINDOW_DAYS;
  const codesOf = (x) => (x && typeof x === 'object' ? String(x.c) : String(x));

  // ① 池 membership：历史真实池 + 断更日 K 线补档（真实池优先，不覆盖）
  const byDate = new Map();
  for (const d of history || []) {
    if (!d || !d.date || !Array.isArray(d.pool) || !d.pool.length) continue;
    byDate.set(String(d.date), new Set(d.pool.map(codesOf)));
  }
  const kline = o.kline || {};
  for (const [d, codes] of Object.entries(kline)) {
    if (!codes || typeof codes !== 'object' || byDate.has(d)) continue;
    byDate.set(String(d), new Set(Object.keys(codes).map(codesOf)));
  }
  const todaySet = new Set((todayPool || []).map(codesOf));
  if (todayYmd) byDate.set(String(todayYmd), todaySet); // 当日池以实时为准

  // ② 窗口脊：交易日序列（档案口径）+ 当日，取最后 N 天；脊不可用则退化为当日单日
  const spine = Array.isArray(o.spine) && o.spine.length ? o.spine : null;
  let windowDates;
  let degraded = false;
  if (spine) {
    const set = new Set(spine.filter((d) => !todayYmd || d <= String(todayYmd)));
    if (todayYmd) set.add(String(todayYmd)); // 当日必在窗内（盘中时档案脊通常还没有当日档）
    windowDates = [...set].sort().slice(-windowDays);
  } else {
    degraded = true;
    windowDates = todayYmd ? [String(todayYmd)] : [];
  }

  // ③ 逐票数窗口内的涨停天数
  const ztLbw = {};
  for (const code of todaySet) {
    let n = 0;
    for (const d of windowDates) if (byDate.get(d) && byDate.get(d).has(code)) n += 1;
    ztLbw[code] = n;
  }
  const vals = Object.values(ztLbw);
  return {
    ztLbw,
    lbw2: vals.filter((v) => v >= 2).length,
    maxLbw: vals.length ? Math.max(...vals) : null,
    windowDates,
    degraded,
  };
}
