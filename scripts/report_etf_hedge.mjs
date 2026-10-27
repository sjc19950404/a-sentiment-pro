#!/usr/bin/env node
// scripts/report_etf_hedge.mjs —— ETF 防守反击避险信号（只读计算，零实盘 / 零交易）
//
// 用户指令（2026-10-27）铁律：
//   ① 数据读取（只读）：dual_track_latest.json 的 cap（风控帽）与 regime；
//      红利低波(510880) 与 沪深300(510300) 真实日 K 线（算近 20 日动量）。
//   ② 判定：cap <= 0（强制空仓）且 当天为周五收盘 → 触发 ETF 动量择优选股；否则不动作。
//   ③ 绝对隔离：严禁调用 paper.js 任何买卖接口；严禁修改模拟盘账户。
//      本脚本只负责计算，并写出 data/etf_hedge_signal.json（写明建议买入标的 + 仓位）。
//   ④ 推送播报：该信号由 src/ai_report_push.js 的 buildEtfHedgeLine 副报文整合进盘后 EOD 企微推送。
//
// 注意：ETF(510880/510300) 不在 ui/kline 标的池内（kline 仅覆盖 A 股 sh600xxx），
//   故默认 ETF 日 K 线缺失 → momentum_missing=true → 触发时兜底等权持双 ETF，不报错、不谎报。
//   当日后若把 ETF 纳入 kline 抓取，动量择优将自动生效（无需改本脚本）。

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeEtfHedgeSignal } from '../src/etf_rotation.js';
import { bjDate } from '../src/time.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DUAL = join(ROOT, 'data', 'paper', 'dual_track_latest.json');
const KLINE = (code) => join(ROOT, 'ui', 'kline', `sh${code}.json`); // ETF 沪市 → sh 前缀
const OUT = join(ROOT, 'data', 'etf_hedge_signal.json');

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// 从 kline 文件提取收盘价序列（bars[][1] = close），升序
function closesOf(code) {
  const d = readJson(KLINE(code));
  if (!d || !Array.isArray(d.bars)) {
    console.log(`[etf-hedge] 警告：ui/kline/sh${code}.json 不存在或格式异常 → ETF 动量数据缺失（兜底等权）`);
    return null;
  }
  const closes = d.bars
    .map((b) => (Array.isArray(b) ? b[1] : (b && b.close)))
    .filter((v) => Number.isFinite(v));
  return closes.length ? closes : null;
}

function main() {
  // bjDate() 返回北京日期字符串 YYYY-MM-DD（非 Date 实例）；用 UTC 构造避开宿主机时区歧义
  const bjStr = bjDate();
  const [y, m, d] = bjStr.split('-').map(Number);
  const bjDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const now = { getDay: () => bjDay };

  // ① 读取 dual_track（只读）
  const dual = readJson(DUAL);
  const day = (dual && dual.day) || {};
  const regime = day.regime || {};
  const cap = Number.isFinite(regime.cap) ? regime.cap : null;
  const regimeKey = regime.key || null;

  // ② 读取 ETF 真实日 K 线（只读）
  const pricesMap = { '510880': closesOf('510880'), '510300': closesOf('510300') };

  // ③ 判定 + 计算（纯函数，零 IO）
  const sig = computeEtfHedgeSignal({ cap, regimeKey, pricesMap, now });
  sig.date = bjStr;
  sig.generated_at = new Date().toISOString().replace('Z', '+08:00');
  sig.source = { dual_track: 'data/paper/dual_track_latest.json', kline: ['ui/kline/sh510880.json', 'ui/kline/sh510300.json'] };

  writeFileSync(OUT, JSON.stringify(sig, null, 2));
  console.log(`[etf-hedge] 已写出 ${OUT} → active=${sig.active} forcedClose=${sig.forced_close} friday=${sig.is_friday} winner=${sig.winner || '-'} (cap=${cap}, regime=${regimeKey})`);
  return sig;
}

main();
