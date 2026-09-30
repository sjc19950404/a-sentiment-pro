// 数据新鲜度：把「数据是否滞后」从粘滞的失败标记，改为按交易日历可计算的状态。
//
// 背景（旧口径的两个毛病，都由真实故障暴露）：
//   1) meta.stale 被当作「上一次尝试是否失败」的标记：只在回退路径置 true，
//      成功路径重建 meta 时才会清掉。若某次回退之后，后续运行只是「跳过」
//      （龙虎榜未公布 → main() 直接 return null，不写存档），stale 会一直粘着，
//      页面长期误报「数据滞后」——而数据其实已是最新收盘会话。
//   2) 「正常等待」（今天数据还没到发布时间）与「真滞后」（预期时间已过仍没更）
//      被混成同一句话，用户无法判断要不要管。
//
// 新口径按三条状态判定（均为纯函数，便于测试与跨端一致）：
//   fresh   存档交易日 ≥ 最近一个已收盘交易日 → 展示的就是最新已收盘会话
//   pending 落后 1 个交易日，但预期更新时刻还没到 → 正常等待（18:30 首抓 / 21:00 补抓）
//   behind  已过预期更新时刻仍然落后 → 真滞后，需要告警
//
// 「预期更新时刻」= 该交易日之后第一个交易日的 PUBLISH_HHMM（北京时区）。
// 用绝对时间戳下发，前端无需交易日历即可与本地时钟比较，也不受时区影响。
import { isTradingDay } from './util.js';

export const MARKET_CLOSE = '15:00'; // 收盘时刻，用于判定「当日是否已收盘」
export const PUBLISH_HHMM = '19:30'; // 某交易日数据应已落库的兜底时刻（18:30 首抓 + 1h 余量）

const BJ = 8 * 3600 * 1000;

/** 北京时区日期 YYYY-MM-DD */
export function bjDate(now = new Date()) {
  return new Date(now.getTime() + BJ).toISOString().slice(0, 10);
}

/** 北京时区时刻 HH:MM（两段式比较可当字符串用） */
export function bjTime(now = new Date()) {
  return new Date(now.getTime() + BJ).toISOString().slice(11, 16);
}

function shift(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function atBJ(dateStr, hhmm) {
  return Date.parse(`${dateStr}T${hhmm}:00+08:00`);
}

/** 上一个交易日（不含 dateStr 自身） */
export function prevSession(dateStr, holidays = []) {
  let d = shift(dateStr, -1);
  for (let i = 0; i < 400; i++) {
    if (isTradingDay(d, holidays)) return d;
    d = shift(d, -1);
  }
  return null;
}

/** 下一个交易日（不含 dateStr 自身） */
export function nextSession(dateStr, holidays = []) {
  let d = shift(dateStr, 1);
  for (let i = 0; i < 400; i++) {
    if (isTradingDay(d, holidays)) return d;
    d = shift(d, 1);
  }
  return null;
}

/** 最近一个已收盘交易日：交易日且已过 15:00 记当日，否则记上一交易日 */
export function lastClosedSession(now = new Date(), holidays = []) {
  const today = bjDate(now);
  if (isTradingDay(today, holidays) && bjTime(now) >= MARKET_CLOSE) return today;
  return prevSession(today, holidays);
}

/** 落后交易日数 = (from, to] 区间内的交易日数 */
export function countSessions(from, to, holidays = []) {
  if (!from || !to || from >= to) return 0;
  let n = 0;
  let d = from;
  for (let i = 0; i < 400; i++) {
    d = shift(d, 1);
    if (d > to) break;
    if (isTradingDay(d, holidays)) n++;
  }
  return n;
}

/** 该交易日数据「预期已更新完毕」的北京时刻（绝对时间戳）；前端可直接与本地时钟比较 */
export function publishDeadline(tradeDate, holidays = []) {
  const n = nextSession(tradeDate, holidays);
  return n ? atBJ(n, PUBLISH_HHMM) : null;
}

/**
 * 评估数据新鲜度。
 * @param {{tradeDate?: string|null}} meta 存档 meta（只需 tradeDate）
 * @param {Date} now 评估时刻
 * @param {string[]} holidays 手动节假日（config.manualHolidays）
 */
export function assessFreshness(meta = {}, now = new Date(), holidays = []) {
  const tradeDate = meta.tradeDate || null;
  const latestClosed = lastClosedSession(now, holidays);
  const behindSessions = countSessions(tradeDate, latestClosed, holidays);
  const deadline = tradeDate ? publishDeadline(tradeDate, holidays) : null;
  let state;
  if (!tradeDate) state = 'unknown';
  else if (behindSessions <= 0) state = 'fresh';
  else if (deadline != null && now.getTime() < deadline) state = 'pending';
  else state = 'behind';
  return {
    state,
    stale: state === 'behind',
    tradeDate,
    latestClosed,
    behindSessions,
    publishDeadline: deadline == null ? null : new Date(deadline).toISOString(),
    checkedAt: now.toISOString(),
  };
}

/** 滞后原因（人读文案；非滞后返回 null） */
export function staleReasonText(f) {
  if (!f || !f.stale) return null;
  return `落后 ${f.behindSessions} 个交易日（最近已收盘交易日 ${f.latestClosed}）`;
}

/**
 * 把判定结果写进 meta（管道与 CLI 共用，只改判定字段、不动数据）。
 * @param {object} meta 存档 meta（就地修改）
 * @param {string|null} tradeDate 存档当前覆盖的交易日
 * @param {Date} now 评估时刻
 * @param {string[]} holidays 手动节假日
 * @param {{outcome:string, reason?:string|null}|undefined} attempt 本次尝试结果；给出才覆盖 lastAttempt
 */
export function applyFreshnessMeta(meta, tradeDate, now = new Date(), holidays = [], attempt = undefined) {
  const f = assessFreshness({ tradeDate }, now, holidays);
  meta.tradeDate = tradeDate;
  meta.stale = f.stale;
  meta.staleReason = staleReasonText(f);
  meta.freshness = f;
  if (attempt) meta.lastAttempt = { at: now.toISOString(), ...attempt };
  return f;
}

/**
 * 判定字段里「有意义」的部分——用于判断是否值得落盘。
 * checkedAt / lastAttempt.at 每次评估都会变，不参与比较，避免产生无意义提交；
 * 但 lastAttempt.outcome 参与：让「最近一次没抓成（跳过/失败）」这类信息能真正落盘给页面看，
 * 同时因为只比结果不比时间戳，连续同类结果不会产生重复提交。
 */
export function freshnessKey(meta = {}) {
  const f = meta.freshness || {};
  return JSON.stringify([meta.tradeDate, meta.stale, meta.staleReason,
    f.state, f.latestClosed, f.behindSessions, f.publishDeadline,
    meta.lastAttempt?.outcome ?? null]);
}
