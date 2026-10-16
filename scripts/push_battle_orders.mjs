#!/usr/bin/env node
// ── 作战指令推送入口（S2 · 企微 Webhook markdown，复用 OPS_WEBHOOK 通道）────
//
// 覆盖场景：盘前(pre) / 盘后(post)。盘中(intraday) 暂缓（缺分时均价线抓取源）。
//
// 用法：
//   node scripts/push_battle_orders.mjs --scene pre [--limit 15] [--dry]
//   node scripts/push_battle_orders.mjs --scene post [--limit 15] [--dry]
//
// 个股名单（用户拍板）：昨涨停池(ztpool_history) + 涨幅榜强势(intraday.hot.rows)
//   · 涨停池：昨日涨停股（最契合"明日重点关注"）
//   · 涨幅榜强势：intraday 快照 hot.rows 中量比>=2 且 涨幅>=5% 的放量强势股
//   两者合并去重，按上限取前 N 只。
//
// 价位：data/bt_kline/{code}.json 日K → src/battle_orders.calcLevels
//   数据不足（缺 K 线 / <5 根）的个股自动跳过（不编入指令，绝不编造假点位）。
//
// 纪律（与 push_ai_report 同源）：未配置 OPS_WEBHOOK → 仅打印预览、不推送；
//   推送失败不抛非零（不炸数据管线）。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKline, calcLevels, renderPreMarket, renderPostMarket } from '../src/battle_orders.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZT_FILE = join(ROOT, 'data', 'ztpool_history.json');
const INTRADAY_FILE = join(ROOT, 'data', 'intraday.json');
const WEBHOOK_ENV = 'OPS_WEBHOOK';

const argv = process.argv.slice(2);
const scene = (argv.find((a) => a === '--scene') ? argv[argv.indexOf('--scene') + 1] : '') || '';
const DRY = argv.includes('--dry');
const limitArg = argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) || 15 : 15;

if (scene !== 'pre' && scene !== 'post') {
  console.error('[battle-orders] 缺参数：--scene pre|post');
  process.exit(1);
}

// ── 读取个股名单 ──
function loadCandidates() {
  const map = new Map(); // code -> {code, name}
  // ① 昨涨停池
  try {
    const zt = JSON.parse(readFileSync(ZT_FILE, 'utf8'));
    const latest = Array.isArray(zt) ? zt[zt.length - 1] : null;
    if (latest?.pool) {
      for (const s of latest.pool) {
        if (s.c && s.n) map.set(String(s.c), { code: String(s.c), name: s.n });
      }
    }
  } catch (e) { console.warn('[battle-orders] 读 ztpool_history 失败：', e?.message); }

  // ② 涨幅榜强势（量比>=2 且 涨幅>=5%）
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

// ── 计算 + 组装 ──
function buildStocks() {
  const cands = loadCandidates();
  const stocks = [];
  let skipped = 0;
  for (const c of cands) {
    const k = loadKline(c.code);
    const levels = k ? calcLevels(k.bars) : null;
    if (!levels) { skipped += 1; continue; } // 数据不足跳过
    stocks.push({ code: c.code, name: c.name, levels });
    if (stocks.length >= LIMIT) break;
  }
  return { stocks, total: cands.length, skipped };
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
const { stocks, total, skipped } = buildStocks();
const label = tradeDateLabel();
const content = scene === 'pre'
  ? renderPreMarket(stocks, label)
  : renderPostMarket(stocks, label);

if (!content) {
  console.log(`[battle-orders] ${scene} 无可用个股（候选 ${total} / 数据不足跳过 ${skipped}）→ 不推送`);
  process.exit(0);
}

console.log(`[battle-orders] ${scene} 场景：候选 ${total} · 编入 ${stocks.length} · 数据不足跳过 ${skipped}`);
if (DRY) {
  console.log('[battle-orders] --dry 预览：\n');
  console.log(content);
  process.exit(0);
}
const res = await pushMarkdown(content);
if (res.pushed) console.log(`[battle-orders] ✅ 已推送 ${scene} 作战指令（${stocks.length} 只）`);
else if (res.skipped) console.log('[battle-orders] 已预览（未配置 webhook）');
else console.error(`[battle-orders] ❌ 推送失败：${res.error}（不炸管线）`);
