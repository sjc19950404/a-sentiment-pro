#!/usr/bin/env node
// 盘中报价侧车（轻量）：fetch 新浪行情快照 hq.sinajs.cn，覆盖「持仓股（账户）+ 连板池（当日）」，
// 计算盘中涨跌幅 chgPct，落盘 data/intraday-quotes-latest.json（side-car，推送时只读）。
//
// 设计纪律（与项目军规一致）：
//   · fail-open：抓取失败 → 写 degraded 空档，绝不阻塞推送；下游 buildIntradayAlert 会降级到
//     ztpool EOD 快照兜底。
//   · 轻量：单请求批量（hq.sinajs.cn 支持 list= 多码），分 60 一包；无持仓且连板池缺失 → 直接空档。
//   · 实时性：generatedAt 由下游新鲜度闸（30 分钟）校验，过期自动跳过防误报。
//
// 用法：
//   node scripts/fetch_intraday_quotes.mjs [--mock]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { fetchWithRetry } from '../src/util.js';
import { bjStamp } from '../src/time.js';
import { loadEnv } from '../src/loadenv.js';
loadEnv();

const args = process.argv.slice(2);
const MOCK = args.includes('--mock');
const OUT = new URL('../data/intraday-quotes-latest.json', import.meta.url);
const ROOT = new URL('../', import.meta.url);
const resolve = (p) => (p.startsWith('/') ? new URL('file://' + p) : new URL(p, ROOT));

function marketOf(code) {
  const c = String(code);
  if (/^(6|9)/.test(c)) return 'sh';
  if (/^(0|3)/.test(c)) return 'sz';
  if (/^(8|4)/.test(c)) return 'bj';
  return 'sh';
}

// 监控标的 = 账户持仓（positions + pending）+ 连板池（ztpool 末条）
function watchCodes() {
  const set = new Set();
  try {
    const acc = JSON.parse(readFileSync(resolve('data/paper/account.json'), 'utf8'));
    const pos = (acc && acc.positions && typeof acc.positions === 'object') ? acc.positions : {};
    Object.keys(pos).forEach((c) => set.add(String(c)));
    (Array.isArray(acc && acc.pending) ? acc.pending : []).forEach((o) => { if (o && o.code) set.add(String(o.code)); });
  } catch { /* 无账户档 */ }
  try {
    const z = JSON.parse(readFileSync(resolve('data/ztpool_history.json'), 'utf8'));
    const entries = Array.isArray(z) ? z : [];
    const last = entries.reduce((a, b) => (b.date > a.date ? b : a), entries[0] || { pool: [] });
    (last.pool || []).forEach((p) => { if (p && p.c) set.add(String(p.c)); });
  } catch { /* 无连板池 */ }
  return [...set];
}

function decodeGBK(buf) {
  try { return new TextDecoder('gbk').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

const SINA_HQ = 'https://hq.sinajs.cn/list=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

function parseHq(text, codes) {
  const out = [];
  for (const code of codes) {
    const mkt = marketOf(code);
    const re = new RegExp(`var hq_str_${mkt}${code}="([^"]*)"`);
    const mm = text.match(re);
    if (!mm) continue;
    const f = mm[1].split(',');
    if (f.length < 6) continue;
    const name = f[0];
    const prevClose = +f[2];
    const price = +f[3];
    const high = +f[4];
    const low = +f[5];
    if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose === 0) continue;
    const chgPct = Math.round(((price - prevClose) / prevClose) * 10000) / 100;
    out.push({ code: String(code), name, price, prevClose, chgPct, high, low });
  }
  return out;
}

async function fetchQuotes(codes) {
  const batches = [];
  for (let i = 0; i < codes.length; i += 60) batches.push(codes.slice(i, i + 60));
  const out = [];
  for (const b of batches) {
    const q = b.map((c) => `${marketOf(c)}${c}`).join(',');
    const text = await fetchWithRetry(SINA_HQ + q, {
      headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' },
      timeout: 15000,
      read: async (r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return decodeGBK(Buffer.from(await r.arrayBuffer()));
      },
    }, 3, 1000);
    out.push(...parseHq(text, b));
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

async function main() {
  const codes = watchCodes();
  console.log(`[intraday-quotes] 监控 ${codes.length} 只（持仓 + 连板池）`);
  if (!codes.length) {
    const payload = { kind: 'intraday-quotes', version: 1, generatedAt: bjStamp(), quotes: [], degraded: true, note: '无监控标的（账户无持仓且连板池缺失）' };
    atomicWriteJSON(fileURLToPath(OUT), JSON.stringify(payload, null, 1));
    console.log(`[intraday-quotes] 写出空档 ${fileURLToPath(OUT)}`);
    return;
  }
  if (MOCK) {
    const quotes = codes.map((c, i) => ({ code: String(c), name: '样本' + c, price: 10, prevClose: 10, chgPct: i === 0 ? -6.2 : 1.5, high: 10.5, low: 9.3 }));
    atomicWriteJSON(fileURLToPath(OUT), JSON.stringify({ kind: 'intraday-quotes', version: 1, generatedAt: bjStamp(), quotes, degraded: false }, null, 1));
    console.log(`[intraday-quotes] mock 写出 ${fileURLToPath(OUT)}（首只 -6.2% 急跌样本）`);
    return;
  }
  try {
    const quotes = await fetchQuotes(codes);
    atomicWriteJSON(fileURLToPath(OUT), JSON.stringify({
      kind: 'intraday-quotes', version: 1, generatedAt: bjStamp(), quotes, degraded: false,
      note: '新浪行情快照（持仓 + 连板池），chgPct = 盘中涨跌幅；fail-open 侧车。',
    }, null, 1));
    console.log(`[intraday-quotes] 抓取 ${quotes.length}/${codes.length} 只，写出 ${fileURLToPath(OUT)}`);
    quotes.filter((q) => q.chgPct <= -5).forEach((q) => console.log(`   急跌候选：${q.name}(${q.code}) ${q.chgPct}%`));
  } catch (e) {
    console.error(`[intraday-quotes] ⚠ 抓取失败：${e && e.message ? e.message : e}——写 degraded 空档（不阻塞推送）`);
    atomicWriteJSON(fileURLToPath(OUT), JSON.stringify({ kind: 'intraday-quotes', version: 1, generatedAt: bjStamp(), quotes: [], degraded: true, note: '行情抓取失败，兜底空档' }, null, 1));
  }
}

main().catch((e) => { console.error('[intraday-quotes] 致命错误：', e); process.exit(1); });
