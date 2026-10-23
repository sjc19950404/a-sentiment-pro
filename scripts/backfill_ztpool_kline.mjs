// 断更日涨停 membership 的 K 线补档（2026-10-23，一次性 transitional 脚本）
//
// 背景：ztpool_history 2026-10-19~10-22 断更（东财 getTopicZTPool 只给最近交易日，
// 不可回补），而窗口连板口径（N天M板，src/ztpool_window.js）需要这四天的涨停 membership。
// ui/kline 分片停在 10-20（pi_push 只提交 data/，kline 增量产出被 reset --hard 丢弃——
// 另一处已定位未修的架构问题），且增量只追加当日 bar、不补历史，故分片补不了这四天。
//
// 本脚本按需从东财 push2his 拉取「可能相关个股」的近期**不复权**日 K，用 src/zt_rebuild.js 的
// 权威涨停判定（classifyBar：涨停价=round(前收×(1+幅度),2) 精确相等，幅度按板块/ST）
// 现算这四天的 membership，落盘 data/ztpool_kline_membership.json——该文件在 data/ 下，
// pi_push 会正常提交，断更日后仍可复用；日更恢复后本文件自然失用（无害保留）。
//
// 口径诚实边界（与 zt_rebuild 残差一致，如实保留）：
// · 除权除息日：涨停价基准是除权参考价而非昨日收盘 → 该日涨停的除权股会被漏判（每日约 0~3 只）；
// · ST 历史状态取当前名称，期间摘帽/戴帽的个股幅度判定会错；
// · Universe 是代理口径（近两池 + 档案热点/龙虎码），不在其中的断更日涨停股会漏——宁缺毋假，
//   漏的只会让窗口数偏低（保守方向），不会虚增。
//
// 用法：node scripts/backfill_ztpool_kline.mjs [--dates 20261019,20261020,...]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyBar } from '../src/zt_rebuild.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'ztpool_kline_membership.json');
const pace = parseInt(process.env.SENT_KLINE_INTERVAL || '320', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. 断更日 = 近期交易日脊里缺失于 ztpool_history 的日期 ──────────────────────
function tradingSpine() {
  try {
    const r = JSON.parse(readFileSync(path.join(ROOT, 'data', 'archive-recent.json'), 'utf8'));
    const dates = [];
    for (const d of r.days || []) if (d && d.trade_date) dates.push(String(d.trade_date).replace(/-/g, ''));
    if (r.latest && r.latest.trade_date) dates.push(String(r.latest.trade_date).replace(/-/g, ''));
    return [...new Set(dates)].sort();
  } catch { return []; }
}
function historyDates() {
  try {
    const h = JSON.parse(readFileSync(path.join(ROOT, 'data', 'ztpool_history.json'), 'utf8'));
    return new Set((Array.isArray(h) ? h : []).map((d) => String(d.date)));
  } catch { return new Set(); }
}
const argvDates = (process.argv.find((a, i) => process.argv[i - 1] === '--dates') || '').split(',').filter(Boolean);
const histDates = historyDates();
const spine = tradingSpine();
// 只补「最近 10 个交易日脊」内的断更日：窗口连板只需最近 5 天，更早的日期既用不到、
// 也会超出 30 根 K 线的拉取范围（够不着的日期会落出假的 0，宁缺毋假）。
const gapDates = (argvDates.length ? argvDates : spine)
  .map((d) => String(d).replace(/-/g, ''))
  .filter((d) => d <= '20261023' && !histDates.has(d))
  .slice(-10);
console.log(`[backfill] 断更日（有交易日脊、无池历史）: ${gapDates.join(', ') || '（无）'}`);
if (!gapDates.length) process.exit(0);

// ── 2. Universe：近两期真实池 + 档案近 10 日 hot/lhb 码（代理口径） ───────────────
const universe = new Set();
try {
  const h = JSON.parse(readFileSync(path.join(ROOT, 'data', 'ztpool_history.json'), 'utf8'));
  for (const d of (Array.isArray(h) ? h : []).slice(-2)) for (const p of d.pool || []) universe.add(String(p.c));
} catch {}
try {
  const a = JSON.parse(readFileSync(path.join(ROOT, 'data', 'archive.json'), 'utf8'));
  for (const day of (a.all_days || []).slice(-10)) {
    for (const x of day.hot || []) if (x.code) universe.add(String(x.code));
    for (const x of day.lhb || []) if (x.code) universe.add(String(x.code));
  }
} catch {}
console.log(`[backfill] Universe（代理口径）: ${universe.size} 只`);

// ── 3. 逐只拉近期日 K，现算断更日涨停 membership ────────────────────────────────
const mktPrefix = (c) => (/^(6|9)/.test(c) ? 'sh' : /^(4|8)/.test(c) ? 'bj' : 'sz');
const gapSet = new Set(gapDates);
const membership = {}; // { '20261019': { code: lbc } }
for (const d of gapDates) membership[d] = {};

// 数据源：东财 push2his 日 K（fqt=0 **不复权**）——zt_rebuild.classifyBar 的涨停判定
// 要求不复权价才能逐位对齐交易所规则（qfq 前复权缩放除权前历史会系统性失配）；且与腾讯
// fqkline 不同主机，腾讯被限流时仍有源可用（2026-10-23 实测两者互备）。
const secid = (c) => (/^(6|9)/.test(c) ? '1.' : '0.') + c;

async function fetchBars(code) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid(code)}&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&end=20500101&lmt=30`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const node = j.data;
  const raw = node && node.klines; // ["date,open,close,high,low,volume"]（不复权）
  if (!Array.isArray(raw) || !raw.length) return null;
  return { name: node.name || '', bars: raw.map((s) => { const p = s.split(','); return [p[0], +(+p[1]).toFixed(3), +(+p[2]).toFixed(3), +(+p[3]).toFixed(3), +(+p[4]).toFixed(3)]; }) };
}

let done = 0, fail = 0;
for (const code of universe) {
  try {
    const k = await fetchBars(code);
    if (k && k.bars.length) {
      const full = `${mktPrefix(code)}${code}`;
      const bars = k.bars;
      for (let i = 1; i < bars.length; i++) {
        const ymd = String(bars[i][0]).replace(/-/g, '');
        if (!gapSet.has(ymd)) continue;
        const c = classifyBar(bars, i, full, k.name);
        if (c && c.zt) {
          // 连续板数一并现算（与东财 lbc 同口径），供展示层标注
          let lbc = 0;
          for (let j = i; j >= 5; j--) {
            const cc = classifyBar(bars, j, full, k.name);
            if (!cc || !cc.zt) break;
            lbc++;
          }
          membership[ymd][code] = lbc;
        }
      }
    }
  } catch (e) { fail++; if (fail <= 3) console.error('  ✗', code, e.message); }
  done++;
  if (done % 100 === 0) console.log(`  进度 ${done}/${universe.size} · 失败 ${fail}`);
  await sleep(pace + Math.round(Math.random() * 80));
}

const summary = {};
for (const d of gapDates) summary[d] = Object.keys(membership[d]).length;
console.log('[backfill] 断更日涨停只数（K线现算）:', JSON.stringify(summary));

if (existsSync(OUT)) {
  try {
    const old = JSON.parse(readFileSync(OUT, 'utf8'));
    for (const d of Object.keys(old.dates || {})) if (!(d in membership)) membership[d] = old.dates[d];
  } catch {}
}
writeFileSync(OUT, JSON.stringify({
  kind: 'ztpool-kline-membership',
  version: 1,
  generatedAt: new Date().toISOString(),
  note: '断更日（2026-10-19~10-22）涨停 membership 的东财不复权日K现算补档；除权日/ST变更可能漏判（每日约0~3只）；仅供 src/ztpool_window.js 窗口连板使用，不入情绪因子。',
  dates: membership,
}, null, 1));
console.log(`[backfill] ✓ 已落盘 ${OUT}（共 ${Object.keys(membership).length} 个断更日）`);
