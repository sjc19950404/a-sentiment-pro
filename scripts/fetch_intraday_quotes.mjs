#!/usr/bin/env node
// 日终快照侧车（轻量）：从「K线分片」提取监控标的（持仓 + 连板池）当日的真实日终价，
// 落盘 data/intraday-quotes-latest.json（EOD 定稿，非盘中实时）。
//
// 设计纪律（与项目军规一致）：
//   · 真实：取自 K线分片最后一根（与终端 K线 图 100% 同源），绝不编造、绝不写死假价。
//   · fail-open：缺分片 → 该票跳过（不占位）；全空 → 写 degraded 空档，绝不阻塞下游。
//
// 用法：node scripts/fetch_intraday_quotes.mjs   （无 --mock；盘中实时秒级刷新已彻底放弃）
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { pushOpsAlerts } from '../src/opsalerts.js';
import { runAntiNukeMonitor } from '../src/intraday_antinuke.js';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'intraday-quotes-latest.json');
const STATE_FILE = path.join(ROOT, 'data', 'intraday-antinuke-state.json');
const KLINE_DIR = path.join(ROOT, 'ui', 'kline');

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
    const acc = JSON.parse(readFileSync(path.join(ROOT, 'data', 'paper', 'account.json'), 'utf8'));
    const pos = (acc && acc.positions && typeof acc.positions === 'object') ? acc.positions : {};
    Object.keys(pos).forEach((c) => set.add(String(c)));
    (Array.isArray(acc && acc.pending) ? acc.pending : []).forEach((o) => { if (o && o.code) set.add(String(o.code)); });
  } catch { /* 无账户档 */ }
  try {
    const z = JSON.parse(readFileSync(path.join(ROOT, 'data', 'ztpool_history.json'), 'utf8'));
    const entries = Array.isArray(z) ? z : [];
    const last = entries.reduce((a, b) => (b.date > a.date ? b : a), entries[0] || { pool: [] });
    (last.pool || []).forEach((p) => { if (p && p.c) set.add(String(p.c)); });
  } catch { /* 无连板池 */ }
  return [...set];
}

// 从 K线分片最后一根取真实日终价（与终端 K线 图完全同源）
function eodOf(code) {
  const prefix = marketOf(code);
  const f = path.join(KLINE_DIR, `${prefix}${code}.json`);
  if (!existsSync(f)) return null;
  let k;
  try { k = JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
  const bars = (k && Array.isArray(k.bars)) ? k.bars : [];
  if (bars.length < 1) return null;
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const [, open, close, high, low] = last;
  const prevClose = prev ? prev[2] : open;
  const chgPct = (prevClose && prevClose !== 0) ? ((close - prevClose) / prevClose) * 100 : null;
  return {
    code: String(code),
    name: k.n || '',
    date: String(last[0]),
    open, close, high, low, prevClose,
    chgPct: chgPct == null ? null : Math.round(chgPct * 100) / 100,
  };
}

async function main() {
  const codes = watchCodes();
  console.log(`[eod-snapshot] 监控 ${codes.length} 只（持仓 + 连板池）`);
  const quotes = [];
  const missing = [];
  for (const c of codes) {
    const e = eodOf(c);
    if (!e) { missing.push(c); continue; }
    quotes.push(e);
  }
  const payload = {
    kind: 'eod-snapshot', version: 1, generatedAt: new Date().toISOString(),
    quotes, degraded: false,
    note: '日终静态定稿（取自 K线分片最后一根），与终端 K线 100% 同源；非盘中实时。',
  };
  if (!quotes.length) payload.degraded = true;
  atomicWriteJSON(OUT, JSON.stringify(payload, null, 1));
  console.log(`[eod-snapshot] 写出 ${quotes.length}/${codes.length} 只（缺分片 ${missing.length}） → ${OUT}`);
  if (missing.length) console.log(`   缺 K线分片：${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}`);

  // ── 挂件三配套·反核预警（2026-10-30）：监控冰点试错仓持仓是否出现「日内跌超 5% 后翻红」地天板特征 ──
  //   数据源即上方 K线分片当日 bar 的 low(深跌谷)/close(翻红)；fail-open，无 ice-trial 持仓/缺快照则静默。
  try {
    const acc = JSON.parse(readFileSync(path.join(ROOT, 'data', 'paper', 'account.json'), 'utf8'));
    const date = (quotes.find((x) => x && x.date) || {}).date || new Date().toISOString().slice(0, 10);
    let prevState = {};
    try { prevState = JSON.parse(readFileSync(STATE_FILE, 'utf8')) || {}; } catch { /* 首次 */ }
    const { alerts, state } = runAntiNukeMonitor({ account: acc, quotes, state: prevState, date });
    if (alerts.length) {
      atomicWriteJSON(STATE_FILE, JSON.stringify(state, null, 1));
      console.log(`[反核预警] 命中 ${alerts.length} 只，推送企微：`);
      for (const a of alerts) console.log(`   ${a.detail}`);
      const r = await pushOpsAlerts(alerts);
      if (r && r.error) console.error('[反核预警] 企微推送失败：', r.error);
      else console.log(`[反核预警] 企微推送成功 ${r.pushed} 条`);
    } else {
      // 即便无预警也回写 state（可能新增了已监控标的的日期键，保持去重态新鲜）
      atomicWriteJSON(STATE_FILE, JSON.stringify(state, null, 1));
    }
  } catch (e) {
    console.warn(`[反核预警] 监控跳过（${e.message || e}）`);
  }
}

void main().catch((e) => { console.error('[eod-snapshot] 致命错误：', e); process.exitCode = 1; });
