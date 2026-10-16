#!/usr/bin/env node
// ── 作战指令推送入口（S2 · 企微 Webhook markdown，复用 OPS_WEBHOOK 通道）────
//
// 覆盖场景：盘前(pre) / 盘后(post) / 盘中(intraday 触发式)。
//
// 用法：
//   node scripts/push_battle_orders.mjs --scene pre [--limit 15] [--dry]
//   node scripts/push_battle_orders.mjs --scene post [--limit 15] [--dry]
//   node scripts/push_battle_orders.mjs --scene intraday [--limit 15] [--dry]
//
// 盘前/盘后 个股名单（用户拍板）：昨涨停池(ztpool_history) + 涨幅榜强势(intraday.hot.rows)
//   · 涨停池：昨日涨停股（最契合"明日重点关注"）
//   · 涨幅榜强势：intraday 快照 hot.rows 中量比>=2 且 涨幅>=5% 的放量强势股
//   两者合并去重，按上限取前 N 只。
//
// 价位数据源（解耦部署依赖）：
//   · 优先读本地 data/bt_kline/{code}.json（本机已抓，快）；
//   · 缺失时实时回退抓东财 push2his 历史 K 线（CI 无 bt_kline 时照样算支撑/压力/入手/止损）。
//
// 盘中（触发式）：读 intraday.json hot.rows，筛选"现价站稳分时均价线 + 量比>=2"的个股，
//   价位基于快照实时字段（现价/分时均价线 f9）→ calcIntraday。无符合信号则静默不推送。
//
// 纪律（与 push_ai_report 同源）：未配置 OPS_WEBHOOK → 仅打印预览、不推送；
//   推送失败不抛非零（不炸数据管线）。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadKline, calcLevels, calcIntraday,
  renderPreMarket, renderPostMarket, renderIntraday,
} from '../src/battle_orders.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZT_FILE = join(ROOT, 'data', 'ztpool_history.json');
const INTRADAY_FILE = join(ROOT, 'data', 'intraday.json');
const WEBHOOK_ENV = 'OPS_WEBHOOK';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36';
const EM_KLINE_HOSTS = ['push2his.eastmoney.com', '1.push2his.eastmoney.com', '2.push2his.eastmoney.com'];

const argv = process.argv.slice(2);
const scene = (argv.find((a) => a === '--scene') ? argv[argv.indexOf('--scene') + 1] : '') || '';
const DRY = argv.includes('--dry');
const limitArg = argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) || 15 : 15;

if (scene !== 'pre' && scene !== 'post' && scene !== 'intraday') {
  console.error('[battle-orders] 缺参数：--scene pre|post|intraday');
  process.exit(1);
}

// ── K 线加载：本地优先，缺失实时回退东财历史 K 线 ──
function marketSecid(code) {
  if (/^6/.test(code)) return `1.${code}`; // 沪市
  return `0.${code}`; // 深市主板/创业板/北交所（兜底）
}
async function fetchRemoteKline(code) {
  const secid = marketSecid(code);
  for (const host of EM_KLINE_HOSTS) {
    for (let att = 0; att < 2; att++) {
      try {
        const url = `https://${host}/api/qt/stock/kline/get?fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&lmt=60&end=20500101&secid=${secid}`;
        const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const kl = j?.data?.klines;
        if (!Array.isArray(kl) || !kl.length) throw new Error('空 kline');
        const bars = kl.map((s) => {
          const [d, o, c, h, l, v] = s.split(',');
          return [d, +o, +c, +h, +l, +v];
        });
        return { c: code, n: j?.data?.name || code, bars };
      } catch (e) {
        if (att === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  return null;
}
async function tryLoadKline(code) {
  const local = loadKline(code);
  if (local) return local;
  try { return await fetchRemoteKline(code); } catch { return null; }
}

// ── 读取盘前/盘后个股名单 ──
function loadCandidates() {
  const map = new Map(); // code -> {code, name}
  try {
    const zt = JSON.parse(readFileSync(ZT_FILE, 'utf8'));
    const latest = Array.isArray(zt) ? zt[zt.length - 1] : null;
    if (latest?.pool) {
      for (const s of latest.pool) {
        if (s.c && s.n) map.set(String(s.c), { code: String(s.c), name: s.n });
      }
    }
  } catch (e) { console.warn('[battle-orders] 读 ztpool_history 失败：', e?.message); }
  try {
    if (existsSync(INTRADAY_FILE)) {
      const id = JSON.parse(readFileSync(INTRADAY_FILE, 'utf8'));
      const rows = id?.hot?.rows || [];
      for (const r of rows) {
        const lb = Number(r.liangbi) || 0;
        const cp = Number(r.change_pct) || 0;
        if (lb >= 2 && cp >= 5 && r.code && r.name) {
          if (!map.has(String(r.code))) map.set(String(r.code), { code: String(r.code), name: r.name });
        }
      }
    }
  } catch (e) { console.warn('[battle-orders] 读 intraday 失败：', e?.message); }
  return [...map.values()];
}

// ── 盘前/盘后：算日K价位（本地优先，缺失实时回退）──
async function buildStocks() {
  const cands = loadCandidates();
  const stocks = [];
  let skipped = 0;
  for (const c of cands) {
    const k = await tryLoadKline(c.code);
    const levels = k ? calcLevels(k.bars) : null;
    if (!levels) { skipped += 1; continue; } // 数据不足跳过
    stocks.push({ code: c.code, name: c.name, levels });
    if (stocks.length >= LIMIT) break;
  }
  return { stocks, total: cands.length, skipped };
}

// ── 盘中：触发信号（现价站稳均价线上方 + 量比>=2）──
function loadIntradaySignals() {
  let rows = [];
  try {
    if (existsSync(INTRADAY_FILE)) {
      const id = JSON.parse(readFileSync(INTRADAY_FILE, 'utf8'));
      rows = id?.hot?.rows || [];
    }
  } catch (e) { console.warn('[battle-orders] 读 intraday 失败：', e?.message); }
  const stocks = [];
  let total = 0;
  for (const r of rows) {
    const close = Number(r.close), avg = Number(r.avg_price), lb = Number(r.liangbi);
    if (!Number.isFinite(close) || !Number.isFinite(avg) || avg <= 0) continue;
    total += 1;
    if (close > avg && lb >= 2) {
      const levels = calcIntraday({ close, avgPrice: avg, liangbi: lb });
      if (!levels) continue;
      stocks.push({ code: String(r.code), name: r.name, levels, signal: `股价站稳分时均价线，量比${lb}` });
      if (stocks.length >= LIMIT) break;
    }
  }
  return { stocks, total };
}

// ── 基准交易日（用于标题）──
function tradeDateLabel() {
  try {
    const zt = JSON.parse(readFileSync(ZT_FILE, 'utf8'));
    const latest = Array.isArray(zt) ? zt[zt.length - 1] : null;
    const d = latest?.date; // YYYYMMDD
    if (d && /^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  } catch {}
  return '';
}

// ── 推送（markdown；失败不炸）──
async function pushMarkdown(content) {
  const wh = process.env[WEBHOOK_ENV];
  if (!wh) {
    console.log('[battle-orders] ⚠️ OPS_WEBHOOK 未配置 → 仅预览，不推送：\n');
    console.log(content);
    return { skipped: true };
  }
  try {
    const r = await fetch(wh, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
    });
    if (!r.ok) return { error: `webhook HTTP ${r.status}` };
    return { pushed: true };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// ── 主流程 ──
let content = null;
let summary = '';
if (scene === 'intraday') {
  const { stocks: istocks, total: itotal } = loadIntradaySignals();
  content = renderIntraday(istocks, '');
  summary = `触发信号 ${istocks.length} / 候选 ${itotal}`;
} else {
  const { stocks, total, skipped } = await buildStocks();
  const label = tradeDateLabel();
  content = scene === 'pre' ? renderPreMarket(stocks, label) : renderPostMarket(stocks, label);
  summary = `候选 ${total} · 编入 ${stocks.length} · 数据不足跳过 ${skipped}`;
}

if (!content) {
  console.log(`[battle-orders] ${scene} 无可用个股（${summary}）→ 不推送`);
  process.exit(0);
}

console.log(`[battle-orders] ${scene} 场景：${summary}`);
if (DRY) {
  console.log('[battle-orders] --dry 预览：\n');
  console.log(content);
  process.exit(0);
}
const res = await pushMarkdown(content);
if (res.pushed) console.log(`[battle-orders] ✅ 已推送 ${scene} 作战指令（${summary}）`);
else if (res.skipped) console.log('[battle-orders] 已预览（未配置 webhook）');
else console.error(`[battle-orders] ❌ 推送失败：${res.error}（不炸管线）`);
