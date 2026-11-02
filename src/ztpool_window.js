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
//   ② data/archive-recent.json 各交易日的 summary.zt_codes（档案口径，250/250 天
//      精确无断更——主数据源）；
//   ③ data/ztpool_history.json 真实涨停池（archive-recent 旧档缺 zt_codes 时的兜底）。
// 窗口脊 = archive-recent 的交易日序列。
// 窗口内某日无任何来源 → 按「未涨停」计（保守方向：只可能少计，不会虚增）。
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

/**
 * 读 archive-recent.json → 窗口脊 + 每日涨停名单（档案口径）。
 * @returns {{spine: string[], codesByDate: Object<string,string[]>}} spine 为 YYYYMMDD 升序
 */
export function loadRecent(root) {
  const out = { spine: [], codesByDate: {} };
  try {
    const p = join(root, 'data', 'archive-recent.json');
    if (!existsSync(p)) return out;
    const r = JSON.parse(readFileSync(p, 'utf8'));
    const add = (tradeDate, codes) => {
      if (!tradeDate || !Array.isArray(codes) || !codes.length) return;
      const ymd = String(tradeDate).replace(/-/g, '');
      if (!out.spine.includes(ymd)) out.spine.push(ymd);
      out.codesByDate[ymd] = codes.map(String);
    };
    for (const d of r.days || []) add(d.trade_date, d.zt_codes);
    if (r.latest) add(r.latest.trade_date, (r.latest.summary || {}).zt_codes);
    out.spine.sort();
  } catch { /* 损坏 → 空（调用方走降级） */ }
  return out;
}

/**
 * 计算当日涨停池每只股票的窗口连板数（N天M板 的 M）。
 *
 * @param {Array}  history   ztpool_history（兜底源，可含当日档——会被 todayPool 覆盖）
 * @param {Array}  todayPool 当日涨停池（[{c}] 或 [code]）
 * @param {string} todayYmd  当日 'YYYYMMDD'
 * @param {Object} [opts]    { windowDays=5, recent={spine,codesByDate}（loadRecent 产物） }
 * @returns {{ztLbw: Object<string,number>, lbw2: number, maxLbw: number|null, windowDates: string[], degraded: boolean}}
 *          degraded=true = 窗口脊不可用（archive-recent 缺失/无名单），退化为「当日单日」口径
 */
export function computeWindowBoards(history, todayPool, todayYmd, opts = {}) {
  const o = opts || {};
  const windowDays = o.windowDays || WINDOW_DAYS;
  const codesOf = (x) => (x && typeof x === 'object' ? String(x.c) : String(x));

  // ① 每日涨停名单：档案口径（主） + ztpool_history（兜底，档案缺席的日期才用）
  const byDate = new Map();
  for (const d of history || []) {
    if (!d || !d.date || !Array.isArray(d.pool) || !d.pool.length) continue;
    byDate.set(String(d.date), new Set(d.pool.map(codesOf)));
  }
  const recent = o.recent && o.recent.codesByDate ? o.recent.codesByDate : {};
  for (const [d, codes] of Object.entries(recent)) {
    if (Array.isArray(codes) && codes.length) byDate.set(String(d), new Set(codes.map(codesOf))); // 档案口径覆盖兜底
  }
  const todaySet = new Set((todayPool || []).map(codesOf));
  if (todayYmd) byDate.set(String(todayYmd), todaySet); // 当日池以实时为准

  // ② 窗口脊：archive-recent 交易日序列 + 当日，取最后 N 天；脊不可用则退化为当日单日
  const spine = o.recent && Array.isArray(o.recent.spine) && o.recent.spine.length ? o.recent.spine : null;
  let windowDates;
  let degraded = false;
  if (spine) {
    const set = new Set(spine.filter((d) => !todayYmd || d <= String(todayYmd)));
    if (todayYmd) set.add(String(todayYmd)); // 当日必在窗内（eod 前档案脊通常还没有当日档）
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
