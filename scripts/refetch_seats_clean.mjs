// 重抓并重建 seats 聚合（净化版）：因为存量 detail 多为 v1（仅买方），无法从 detail 复算卖侧，
// 而卖侧聚合本身也含「类别汇总行」污染（2026-09-30 近岸蛋白 卖侧 4 行汇总合计 190.55 亿）。
//
// 做法：对每天重新抓 66 只票的买卖双侧明细 → 净化汇总行 → 重算 6 个分项 + 集中度 +
//       逐票买卖双侧 detail（统一为 v2 格式）。这样买卖两侧同源同口径，也能让前端拿到卖侧明细。
//
// 注意：会向东方财富发起 66 只 × 2 请求 × NATIVE_DAYS 天，请勿频繁运行。
// 用法：node scripts/refetch_seats_clean.mjs [--days 2026-09-30] [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchSeats } from '../src/sources.js';

const FILE = 'data/archive.json';
const DRY = process.argv.includes('--dry');
const argOf = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const only = argOf('--days');

const a = JSON.parse(readFileSync(FILE, 'utf8'));
const targets = a.all_days.filter((d) => (only ? d.trade_date === only : true) && Array.isArray(d.lhb_aggr) && d.lhb_aggr.length);
console.log('待重抓天数:', targets.length, targets.map((d) => d.trade_date).join(', '));

for (const d of targets) {
  const aggr = d.lhb_aggr.map((l) => ({ code: l.code, name: l.name, net_buy_wan: l.net_buy_wan }));
  process.stdout.write(`[${d.trade_date}] 抓取 ${aggr.length} 只票的双侧明细 … `);
  let seats;
  try {
    seats = await fetchSeats(d.trade_date, aggr);
  } catch (e) { console.log('失败:', e.message); continue; }
  const old = d.summary?.seats || {};
  const buy = (seats.inst_buy + seats.north_buy + seats.hot_buy);
  const sell = (seats.inst_sell + seats.north_sell + seats.hot_sell);
  const withSell = Object.values(seats.detail).filter((v) => v && !Array.isArray(v) && (v.s || []).length).length;
  console.log(`cover ${seats.cover}%｜明细 ${Object.keys(seats.detail).length} 只（含卖侧 ${withSell}）`);
  console.log(`        买侧 ${buy.toFixed(2)} 亿（旧 ${((old.inst_buy || 0) + (old.north_buy || 0) + (old.hot_buy || 0)).toFixed(2)}）`
    + `｜卖侧 ${sell.toFixed(2)} 亿（旧 ${((old.inst_sell || 0) + (old.north_sell || 0) + (old.hot_sell || 0)).toFixed(2)}）`);
  console.log(`        top3 ${seats.buy_top3_pct}%（旧 ${old.buy_top3_pct}%）｜conc TOP5 ${seats.conc_top.map((x) => x.join(' ')).join(' / ')}`);
  if (!DRY) {
    d.summary = d.summary || {};
    d.summary.seats = seats;
  }
}

if (DRY) console.log('\n（--dry 未写盘）');
else {
  writeFileSync(FILE, JSON.stringify(a, null, 2), 'utf8');
  console.log('\n已写盘', FILE);
}
