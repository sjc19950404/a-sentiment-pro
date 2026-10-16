// 作战指令：盘前/盘后个股价位计算 + 企微 markdown 渲染
//
// 定位：pure 计算 + 渲染库（不碰网络/推送），便于单测。
// 数据源：data/bt_kline/{code}.json 个股日K（bars:[date,open,close,high,low,vol]，不复权）。
// 推送接入见 scripts/push_battle_orders.mjs（负责读个股名单、调 calc、投 OPS_WEBHOOK）。
//
// 价位口径（用户规格 2026-10-16）：
//   压力位  = 近 10 日最高价（覆盖"近期高点 / 前一日上影线"）
//   支撑位  = min(5 日均线, 近 20 日量价加权均价 VWAP×0.97 筹码密集区下沿) —— 取保守
//   入手区间 = 支撑位 ~ 昨收
//   止损位  = 支撑位下方 1%（规格允许 0.5%~1%，取明确 1%）
//   每条强制"入手+止损成对"，价位全部两位小数。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KLINE_DIR = path.join(ROOT, 'data', 'bt_kline');

// ── 价格格式化：两位小数；非有限值回退占位 ──
export function fmt2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(2);
}
const r2 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

// ── 加载个股日K（文件名带交易所前缀：沪 sh / 深 sz / 北交所 bj）──
function klineFileName(code) {
  if (/^\d{6}$/.test(code)) {
    const p = code[0];
    if (p === '6') return `sh${code}.json`;       // 沪市主板 / 科创板(688)
    if (p === '0' || p === '3') return `sz${code}.json`; // 深市主板 / 创业板
    if (p === '8' || p === '4' || p === '9') return `bj${code}.json`; // 北交所
  }
  return `${code}.json`;
}
export function loadKline(code) {
  const primary = klineFileName(code);
  const fallbacks = [`${code}.json`, `sh${code}.json`, `sz${code}.json`, `bj${code}.json`];
  for (const f of [primary, ...fallbacks.filter((x) => x !== primary)]) {
    const p = path.join(KLINE_DIR, f);
    if (fs.existsSync(p)) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(j?.bars) && j.bars.length) return j;
      } catch { /* 损坏分片跳过 */ }
    }
  }
  return null;
}

// ── 核心：算价位 ──
// bars: [[date, open, close, high, low, vol], ...]（升序，末根为最新交易日）
// 返回 null 表示数据不足（<5 根），调用方应跳过该只（"数据不足"不编入指令）。
export function calcLevels(bars) {
  if (!Array.isArray(bars) || bars.length < 5) return null;
  // bt_kline 原始 bars 数值为字符串（腾讯源），统一转数字避免 NaN
  const bs = bars.map((b) => [b[0], +b[1], +b[2], +b[3], +b[4], +b[5]]);
  const last = bs[bs.length - 1];
  const prevClose = last[2];          // close
  const prevHigh = last[3];           // high（前一日上影线高点）
  const prevLow = last[4];            // low

  // 5 日均线
  const ma5Bars = bs.slice(-5);
  const ma5 = ma5Bars.reduce((s, b) => s + b[2], 0) / ma5Bars.length;

  // 压力位：近 10 日最高价（含前一日上影线）
  const recent10 = bs.slice(-10);
  const pressure = Math.max(...recent10.map((b) => b[3]));

  // 筹码密集区下沿：近 20 日 VWAP × 0.97
  const win20 = bs.slice(-20);
  let volSum = 0, pvSum = 0;
  for (const b of win20) {
    const v = b[5] || 0;
    volSum += v;
    pvSum += b[2] * v;
  }
  const vwap = volSum > 0 ? pvSum / volSum : ma5;
  const chipLower = vwap * 0.97;

  // 支撑位取保守（5 日线 / 筹码下沿 较低者）
  const support = Math.min(ma5, chipLower);

  // 入手区间 = 支撑与昨收构成的区间（保证低→高，避免股价站上支撑时区间倒置）；
  // 止损 = 区间下沿（支撑/昨收较低者）下方 1%
  const entryLow = Math.min(support, prevClose);
  const entryHigh = Math.max(support, prevClose);
  const stopLoss = entryLow * 0.99;

  return {
    prevClose: r2(prevClose),
    prevHigh: r2(prevHigh),
    prevLow: r2(prevLow),
    ma5: r2(ma5),
    pressure: r2(pressure),
    support: r2(support),
    chipLower: r2(chipLower),
    entryLow: r2(entryLow),
    entryHigh: r2(entryHigh),
    stopLoss: r2(stopLoss),
  };
}

// ── 免责声明（页脚一次，用户规格）──
const DISCLAIMER = '\n> ⚠️ 量化模型输出，仅供个人研究，非投资建议，据此操作风险自负';

// ── 单只条目（入手+止损必成对）──
function blockFor(stock, scene) {
  const L = stock.levels;
  if (!L) return null; // 数据不足跳过
  const lines = [];
  lines.push(`**${stock.name}(${stock.code})** 昨收 ${fmt2(L.prevClose)}`);
  lines.push(`> 压力位 ${fmt2(L.pressure)}｜支撑位 ${fmt2(L.support)}（5日线/筹码密集区）`);
  if (scene === 'pre') {
    lines.push('> 策略：开在支撑附近且放量→试底仓；高开破压→观望；低开破撑→放弃');
    lines.push(`> 入手 ${fmt2(L.entryLow)}~${fmt2(L.entryHigh)}｜止损 ${fmt2(L.stopLoss)}（支撑下1%）`);
  } else {
    lines.push(`> 明日入手 ${fmt2(L.entryLow)}~${fmt2(L.entryHigh)}｜明日止损 ${fmt2(L.stopLoss)}（支撑下1%）`);
  }
  return lines.join('\n');
}

// ── 渲染：盘前 ──
export function renderPreMarket(stocks, tradeDate) {
  const blocks = stocks.map((s) => blockFor(s, 'pre')).filter(Boolean);
  if (!blocks.length) return null;
  return `## 📌 作战指令·盘前 ${tradeDate || ''}\n` + blocks.join('\n\n') + DISCLAIMER;
}

// ── 渲染：盘后 ──
export function renderPostMarket(stocks, tradeDate) {
  const blocks = stocks.map((s) => blockFor(s, 'post')).filter(Boolean);
  if (!blocks.length) return null;
  return `## 📌 作战指令·盘后 ${tradeDate || ''}\n` + blocks.join('\n\n') + DISCLAIMER;
}
