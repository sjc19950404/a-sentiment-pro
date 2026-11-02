// 选股基底 v2 —— 纯趋势跟随（右侧动量，无任何左侧低吸/估值因子）。
//
// 设计约束（主线方向2·换赛道，方案B）：仅新增，不改动 v1(涨停接力) 任何逻辑。
//   - 行情源：getKline 前复权日线（open/close），只用 close 计算，不扩 high/low/volume（phase A）。
//   - 严格点进 T 日：所有 MA/斜率/涨幅只截取 T 日及之前序列，杜绝未来函数。
//   - 入场日若涨停（近1日涨幅≥9.5%）则剔除 → 既符合"不碰涨停"，又避免引擎把仓位误判为连板触发隔日强平。
//   - 相对强度只做"个股 vs 沪深300"，不做板块对标（降复杂度）。
//   - 出场/仓位/成本全部复用 paper_replay 的共享引擎（settleDay/batchSubmit），本模块只产出"选哪些"。

import { getKline } from './kline.js';
import { quoteSymbol } from './sources.js';

// —— 基础指标（输入已截断到 ≤T 的 close 序列）——
function sma(closes, n) {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

// MA(n) 在 lookback 窗口内的斜率（百分比）：(MA_now - MA_past) / MA_past
function maSlopePct(closes, n, lookback) {
  if (closes.length < n + lookback) return null;
  const maNow = sma(closes, n);
  const window = closes.slice(0, closes.length - lookback);
  const maPast = sma(window, n);
if (!maNow || !maPast) return null;
  return (maNow - maPast) / maPast;
}

function ret(closes, n) {
  if (closes.length <= n) return null;
  return closes[closes.length - 1] / closes[closes.length - 1 - n] - 1;
}

// 一字连续跌停：近 4 日内出现 ≥2 次 "open≈close 且日跌≥9.5%"
function hasConsecutiveLimitDown(closes, opens) {
  const L = closes.length;
  if (L < 3) return false;
  let cnt = 0;
  for (let i = L - 1; i >= L - 4 && i >= 1; i--) {
    const drop = closes[i] / closes[i - 1] - 1;
    const oneWord = Math.abs(closes[i] - opens[i]) < 1e-6;
    if (drop <= -0.095 && oneWord) cnt++;
    else cnt = 0;
    if (cnt >= 2) return true;
  }
  return false;
}

// 连板（连续涨停）：近 4 日内出现 ≥2 次 "日涨≥9.5%"
function hasConsecutiveLimitUp(closes) {
  const L = closes.length;
  if (L < 3) return false;
  let cnt = 0;
  for (let i = L - 1; i >= L - 4 && i >= 1; i--) {
    const up = closes[i] / closes[i - 1] - 1;
    if (up >= 0.095) cnt++;
    else cnt = 0;
    if (cnt >= 2) return true;
  }
  return false;
}

// 综合趋势分：MA 多头(0..2) + 均线斜率(0..2) 为主，相对沪深300强度(rs10+rs20)为辅
function scoreTrend({ closes, opens, hs300Closes }) {
  const n = closes.length;
  const close = closes[n - 1];
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  if (ma20 == null || ma60 == null) return null;
  const maBull = (close > ma20 ? 1 : 0) + (close > ma60 ? 1 : 0);
  const slope20 = maSlopePct(closes, 20, 5);
  const slope60 = maSlopePct(closes, 60, 10);
  if (slope20 == null || slope60 == null) return null;
  const slope = (slope20 > 0 ? 1 : 0) + (slope60 > 0 ? 1 : 0);
  const r10 = ret(closes, 10);
  const r20 = ret(closes, 20);
  if (r10 == null || r20 == null) return null;
  let rs10 = r10;
  let rs20 = r20;
  if (hs300Closes && hs300Closes.length > 10) {
    const h10 = ret(hs300Closes, 10);
    const h20 = ret(hs300Closes, 20);
    rs10 = r10 - (h10 || 0);
    rs20 = r20 - (h20 || 0);
  }
  // 趋势(maBull+slope ∈ 0..4) 主导；相对强度(典型 ~0.04) 乘 2 作次要修正
  const score = (maBull + slope) + (rs10 + rs20) * 2;
  return { score, maBull, slope20, slope60, rs10, rs20, close, ma20, ma60 };
}

// —— K 线缓存构建（带并发分块；命中 data/.bt_kline 缓存则不再联网）——
async function fetchOne(code, minLen) {
  try {
    const sym = quoteSymbol(code);
    if (!sym) return { code, err: '无行情前缀(非6位代码)' };
    const kl = await getKline(sym, minLen);
    const byDate = new Map();
    const posByDate = new Map();
    kl.forEach((row, idx) => {
      const d = String(row.date).replace(/-/g, '');
      byDate.set(d, row);
      posByDate.set(d, idx);
    });
    return { code, kl: { series: kl, byDate, posByDate } };
  } catch (e) {
    return { code, err: e.message };
  }
}

// T 日及之前 n 日收盘均线（严格点进时点，杜绝未来函数）。posByDate 缺 T → null。
export function maAt(kl, date, n) {
  const i = kl.posByDate.get(String(date).replace(/-/g, ''));
  if (i == null || i < n - 1) return null;
  let s = 0;
  for (let j = i - n + 1; j <= i; j++) s += +kl.series[j].close;
  return s / n;
}

export async function buildKlineCache(codes, { chunk = 10, minLen = 70 } = {}) {
  const cache = new Map();
  let ok = 0;
  let skip = 0;
  for (let i = 0; i < codes.length; i += chunk) {
    const batch = codes.slice(i, i + chunk);
    const res = await Promise.all(batch.map((c) => fetchOne(c, minLen)));
    for (const r of res) {
      if (r.err) {
        skip++;
        if (skip <= 12) console.error('  skip kline', r.code, r.err);
        continue;
      }
      cache.set(r.code, r.kl);
      ok++;
    }
  }
  return { cache, ok, skip };
}

export async function buildIndexCache(sym = 'sh000300', minLen = 100) {
  const r = await fetchOne(sym, minLen);
  if (r.err) throw r.err;
  return r.kl;
}

// 给定 code 的 K 线缓存 + 交易日，返回该日行情报价（停牌则回退到最近前一交易日收盘价）
export function klineQuoteOn(kl, date) {
  if (!kl) return null;
  const d = String(date).replace(/-/g, '');
  let rec = kl.byDate.get(d);
  if (!rec) {
    const keys = [...kl.byDate.keys()].filter((k) => k < d).sort();
    if (!keys.length) return null;
    rec = kl.byDate.get(keys[keys.length - 1]);
  }
  const arr = [...kl.byDate.keys()].sort();
  const i = arr.indexOf(String(rec.date).replace(/-/g, ''));
  const prev = i > 0 ? kl.byDate.get(arr[i - 1]) : null;
  return {
    name: kl.name,
    price: +rec.close, // 与 v1 一致：引擎以 q.price(收盘价) 撮合，保证买卖时点口径统一
    open: +rec.open,
    prevClose: prev ? +prev.close : null,
    changePct: prev ? +rec.close / +prev.close - 1 : null,
    src: 'kline',
  };
}

// —— 主入口：每日选股（纯趋势）——
// ctx = { tradeDate, klineCache: Map<code,{series,byDate,posByDate}>, hs300: {series,byDate,posByDate}, topN }
export function recommendPicksV2(day, ctx) {
  const { tradeDate, klineCache, hs300, topN } = ctx;
  const d = String(tradeDate).replace(/-/g, '');
  const hsPos = hs300 ? hs300.posByDate.get(d) : null;
  const hsCloses = hsPos != null ? hs300.series.slice(0, hsPos + 1).map((x) => x.close) : null;
  const out = [];
  for (const [code, kl] of klineCache) {
    const i = kl.posByDate.get(d);
    if (i == null || i < 69) continue; // 预热不足（MA60 + 斜率窗口）
    const closes = kl.series.slice(0, i + 1).map((x) => x.close);
    const opens = kl.series.slice(0, i + 1).map((x) => x.open);
    if (hasConsecutiveLimitDown(closes, opens)) continue; // 剔除一字断崖/连续跌停
    if (hasConsecutiveLimitUp(closes)) continue;          // 不碰连板
    const lastRet = closes.length >= 2 ? closes[i] / closes[i - 1] - 1 : 0;
    if (lastRet >= 0.095) continue;                       // 入场日涨停 → 剔除（不追涨停 + 避免引擎误判连板触发隔日强平）
    const sc = scoreTrend({ closes, opens, hs300Closes: hsCloses });
    if (!sc) continue;
    out.push({ code, ...sc });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, topN);
}

export default recommendPicksV2;
