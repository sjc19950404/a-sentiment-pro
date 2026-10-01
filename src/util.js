// 通用工具：重试抓取、时间、数学
import { isTradingDay as calIsTradingDay } from './calendar.js';

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 带重试的 fetch（失败退避）
export async function fetchWithRetry(url, opts = {}, retries = 3, backoff = 1500) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(backoff * (i + 1));
    }
  }
  throw lastErr;
}

export function clamp(x, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}

// 线性映射到 0-100
export function linMap(x, lo, hi) {
  if (hi === lo) return 50;
  return clamp(((x - lo) / (hi - lo)) * 100);
}

// 历史分位（pct rank），返回 0-100
export function pctRank(value, arr) {
  if (!arr.length) return 50;
  const below = arr.filter((v) => v <= value).length;
  return (below / arr.length) * 100;
}

// 北京时区 today (YYYY-MM-DD)
export function todayBeijing() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// 是否交易日。
//
// ⚠ 本函数**保留在 util.js**（而不是搬去 calendar.js）是为了不动十余处调用点的 import 路径。
//   实现已委托给 src/calendar.js —— 那是交易日判定的**唯一出处**（含调休补班三态判定）。
//   这里只做一层兼容转接，不得再在本文件里自行实现任何日期判断逻辑。
//
// 参数兼容：
//   · 传数组（旧语义：休市日清单）→ 按"非周末且不在清单内"判定，与改造前逐位一致；
//   · 传日历对象（resolveHolidays() 的返回值）→ 走完整三态判定（含调休补班）；
//   · 不传 → 用默认日历（data/calendar.json + config.manualHolidays 兜底）。
//
// 注意：本函数是**同步**的，而 calendar.js 的载入也是同步读文件 + 缓存，故无异步化问题。
export function isTradingDay(dateStr, calendarOrHolidays) {
  if (calendarOrHolidays === undefined) return calIsTradingDay(dateStr, undefined);
  return calIsTradingDay(dateStr, calendarOrHolidays);
}

// 从东财/同花顺风格数字串提取数值（处理亿/万/%）
export function parseNum(s) {
  if (s == null) return null;
  const str = String(s).replace(/,/g, '').trim();
  if (str === '' || str === '-' || str === '--') return null;
  const m = str.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
