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

export async function getKline(sym, minLen = 20, cacheDir = KLINE_DIR) {
  const cache = path.join(cacheDir, sym + '.json');
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  let lastErr;
  for (let att = 0; att < 3; att++) {
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
      if (att === 2) throw new Error(`${sym} 日K获取失败: ${e.message}`);
      await sleep(800 * (att + 1));
    }
  }
  throw lastErr || new Error(`${sym} 日K获取失败`);
}
