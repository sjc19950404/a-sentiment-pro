// 通用工具：重试抓取、时间、数学
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

// 是否交易日（周一到周五，且非手动节假日）
export function isTradingDay(dateStr, manualHolidays = []) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun
  if (dow === 0 || dow === 6) return false;
  if (manualHolidays.includes(dateStr)) return false;
  return true;
}

// 从东财/同花顺风格数字串提取数值（处理亿/万/%）
export function parseNum(s) {
  if (s == null) return null;
  const str = String(s).replace(/,/g, '').trim();
  if (str === '' || str === '-' || str === '--') return null;
  const m = str.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
