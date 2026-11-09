// 日K取数：腾讯 ifzq 前复权（缓存优先，miss 真抓）——回测与影子账本**共用同一条路**。
//
// 为什么抽成共享模块（2026-10-11）：影子账本要拿自己的样本跟回测比，"口径一致"
//   是生命线。两边各写一份取数，迟早出现一处改了缓存/重试/过滤而另一处没改，
//   样本就不可比了——正是这类"多入口各自判断"制造过 pain 的假期旧对
//   （10-07 跑出 9-29→9-30 顶替 9-30→10-08）。故取数只留一份实现。
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from './fsutil.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const KLINE_DIR = path.join(ROOT, 'data', '.bt_kline');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 取日K（前复权）。
 * @param {string} sym 如 'sh000300'
 * @param {number} minLen 指数传 100（保证历史窗口足够）；个股传 20——新股 K 线天然短，
 *   一刀切 100 会把题材成员里的次新股整批拒掉（实测 86 只里 4 只被误杀）。
 * @param {string} [cacheDir] 缓存目录（测试可传临时目录，避免污染 data/.bt_kline）
 * @returns {Promise<Array<{date:string, open:number, close:number}>>}
 */
// 主源：腾讯 ifzq 前复权日K（原唯一源）；备源：新浪历史日K（腾讯被 WAF 拦截时降级，源无关缓存）。
async function fetchGtimgRows(sym) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,320,qfq`;
  const j = await (await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' } })).json();
  const node = j && j.data && j.data[sym];
  const rows = node && (node.qfqday || node.day);
  if (!Array.isArray(rows)) throw new Error('gtimg 无K线数据');
  return rows;
}
async function fetchSinaRows(sym) {
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=320&fqt=1`;
  const txt = await (await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' } })).text();
  const arr = JSON.parse(txt);
  if (!Array.isArray(arr) || !arr.length) throw new Error('sina 无K线数据');
  return arr.map((r) => [r.day, r.open, r.close]);
}

const DAY_MS = 86400000;

/**
 * K 线缓存是否陈旧（C10，2026-11-09 审计修复）。
 * 原实现「缓存命中即返回」，从不校验时效——实测 1190 个缓存里 1147 个最后日期
 * 停在 2026-10-30，回测会静默用 10 天前的数据，把最新信号日整段丢掉。
 * 判定用北京日历日差（不用时钟时刻），maxAgeDays 默认 10 天以覆盖春节等长假。
 * 非数组/空/日期不可解析 → 一律视为陈旧（宁可重抓，不用不可信数据）。
 */
export function isStaleKlineCache(k, nowMs = Date.now(), maxAgeDays = 10) {
  if (!Array.isArray(k) || !k.length) return true;
  const last = String((k[k.length - 1] && k[k.length - 1].date) || '');
  const lastMs = Date.parse(last + 'T00:00:00+08:00');
  if (!Number.isFinite(lastMs)) return true;
  const bjDay = (ms) => Math.floor((ms + 8 * 3600000) / DAY_MS);
  return bjDay(nowMs) - bjDay(lastMs) > maxAgeDays;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxCacheAgeDays=10] 缓存允许的最大陈旧天数
 * @param {boolean} [opts.refreshStale=true] 陈旧时是否尝试重抓（false=离线只读旧缓存）
 * @param {number} [opts.staleAttempts=1] 陈旧刷新只试 1 次——缓存批量陈旧（实测 1147 个）
 *   时若按 3 轮重试会打满数据源，宁快速回落旧缓存也不刷屏抓取
 */
export async function getKline(sym, minLen = 20, cacheDir = KLINE_DIR, opts = {}) {
  const { maxCacheAgeDays = 10, refreshStale = true, staleAttempts = 1 } = opts || {};
  const cache = path.join(cacheDir, sym + '.json');
  let staleFallback = null;
  if (existsSync(cache)) {
    let cached = null;
    try { cached = JSON.parse(readFileSync(cache, 'utf8')); } catch { cached = null; }
    if (Array.isArray(cached) && cached.length >= minLen) {
      if (!isStaleKlineCache(cached, Date.now(), maxCacheAgeDays)) return cached; // 新鲜 → 原路径零变化
      staleFallback = cached;
      if (!refreshStale) return cached; // 离线只读模式
    }
  }
  const attempts = staleFallback ? staleAttempts : 3;
  let lastErr;
  for (let att = 0; att < attempts; att++) {
    try {
      let rows;
      try { rows = await fetchGtimgRows(sym); }
      catch (e1) { rows = await fetchSinaRows(sym); }
      if (!Array.isArray(rows) || rows.length < minLen) {
        throw new Error(`K线结构异常/过短(${rows ? rows.length : 0} < ${minLen})`);
      }
      const k = rows.map((r) => ({ date: String(r[0]), open: +r[1], close: +r[2] }))
        .filter((x) => Number.isFinite(x.open) && x.open > 0 && Number.isFinite(x.close) && x.close > 0);
      if (k.length < minLen) throw new Error(`K线过滤后过短(${k.length} < ${minLen})`);
      mkdirSync(cacheDir, { recursive: true });
      atomicWriteJSON(cache, JSON.stringify(k));
      return k;
    } catch (e) {
      lastErr = e;
      if (att === attempts - 1) break;
      await sleep(800 * (att + 1));
    }
  }
  if (staleFallback) {
    // fail-open：刷新失败回落旧缓存，并明示陈旧（不让调用方误以为是最新数据）
    console.warn(`[kline] ⚠ ${sym} 缓存陈旧且刷新失败（${lastErr && lastErr.message}），回落旧缓存（末根 ${staleFallback[staleFallback.length - 1].date}）`);
    return staleFallback;
  }
  throw new Error(`${sym} 日K获取失败: ${lastErr ? lastErr.message : 'unknown'}`);
}
