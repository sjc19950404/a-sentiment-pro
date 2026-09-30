// 存量重算：为历史每一天补齐「当日榜口径」的龙虎榜成交额/净额/家数。
//
// 起因：东财龙虎榜一次披露里混装两类榜单，字段语义不同 ——
//   ① 当日榜（日涨幅偏离 7% / 换手 20% / 振幅 15% / 无涨跌幅限制…）：席位买卖与净额都是当日口径；
//   ② 区间累计榜（"连续 3/10 个交易日涨跌幅偏离值累计达 X%"）：是区间累计值，
//      且 BILLBOARD_BUY_AMT 被填成区间累计成交额（2026-09-30 近岸蛋白 10 日榜 BUY==SELL==ACCUM==116.97 亿、净额 0）。
// 旧代码把两类不加区分地相加，并把"未去重的全部记录"当作上榜总成交，
// 得出 2026-09-30 = 511 亿（当日榜去重后真实 136.5 亿，3.7 倍），净买率被稀释成 2.4%（真实 5~6%），
// 定性从"中等力度"错判为"脉冲级、可信度低"。src/sources.js 已修，新抓取的档会直接带这些字段；
// 本脚本只回填已落盘的历史档。
//
// 存量 lhb 记录没有 BILLBOARD_DEAL_AMT，但当日榜记录满足 DEAL == BUY + SELL（已对源核验），
// 故用 buy_wan + sell_wan 还原。
//
// 用法：node scripts/recalc_lhb_daily.mjs [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = path.join(ROOT, 'data', 'archive.json');
const DRY = process.argv.includes('--dry');
const RANGE_RE = /连续[0-9一二三四五六七八九十]+个交易日/;
const r2 = (v) => Math.round(v * 100) / 100;

const a = JSON.parse(readFileSync(P, 'utf8'));
const rows = [];

for (const day of a.all_days || []) {
  const lhb = day.lhb || [];
  if (!lhb.length) continue;
  const daily = lhb.filter((l) => !RANGE_RE.test(String(l.reason || '')));
  // 同票多榜 → 每股一笔，取 |净额| 最大
  const by = new Map();
  for (const l of daily) {
    const prev = by.get(l.code);
    if (!prev || Math.abs(l.net_buy_wan || 0) > Math.abs(prev.net_buy_wan || 0)) by.set(l.code, l);
  }
  const stocks = [...by.values()];
  const amt = r2(stocks.reduce((x, l) => x + (l.buy_wan || 0) + (l.sell_wan || 0), 0) / 1e4);
  const net = r2(stocks.reduce((x, l) => x + (l.net_buy_wan || 0), 0) / 1e4);
  const rangeCount = lhb.length - daily.length;
  const s = (day.summary = day.summary || {});
  const before = s.lhb_daily_amt;
  s.lhb_daily_stocks = stocks.length;
  s.lhb_daily_net = net;
  s.lhb_daily_amt = amt;
  s.lhb_range_count = rangeCount;
  const oldTot = r2(lhb.reduce((x, l) => x + (l.buy_wan || 0) + (l.sell_wan || 0), 0) / 1e4);
  const rate = amt > 0 ? (net / amt * 100).toFixed(1) : '—';
  rows.push({ date: day.trade_date, oldTot, amt, net, rate, rangeCount, stocks: stocks.length, had: before != null });
}

console.log('日期        旧口径总成交   当日榜成交   当日榜净额   净买率  区间榜  当日榜只数');
for (const r of rows) {
  console.log(`${r.date}  ${String(r.oldTot).padStart(10)}  ${String(r.amt).padStart(10)}  ${String(r.net).padStart(10)}  ${String(r.rate + '%').padStart(6)}  ${String(r.rangeCount).padStart(5)}  ${String(r.stocks).padStart(8)}`);
}
const withHad = rows.filter((r) => r.had).length;
console.log(`\n共 ${rows.length} 天，其中已有当日榜字段（将被覆盖重算）：${withHad} 天`);

if (DRY) { console.log('（--dry：仅预览，未写盘）'); process.exit(0); }
a.meta = a.meta || {};
const stamp = new Date().toISOString().slice(0, 10);
a.meta.note = [a.meta.note, `龙虎榜统计口径修正：历史 ${rows.length} 天补齐当日榜口径（剔除连续N日累计榜），${stamp}`]
  .filter(Boolean).join('；');
writeFileSync(P, JSON.stringify(a, null, 2), 'utf8');
console.log(`已写回 ${path.relative(ROOT, P)}`);
