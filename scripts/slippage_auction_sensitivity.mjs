#!/usr/bin/env node
/**
 * 动态滑点 v2 · 竞价额分母敏感性对照（2026-11-27 用户拍板 B 口径前置）。
 *
 * 背景：src/slippage_model.js::dynamicSlip 的容量项当前分母是「昨日全天成交额」
 * （r = 买入额 / 全天额，基准 0.05）。拍板 B：分母改用 9:25 真实竞价额 jjAmt。
 * 竞价额通常只占全天额的 1~10%，同一笔买入的 r 会放大 10~100 倍——公式不变时
 * 容量冲击会显著放大，故**先跑对照、凭分布重标定基准 r0**，不直接改生产口径。
 *
 * 方法（只读、不落库、不改任何生产参数）：
 *   - data/auction_score.json 7 天全样本；每只的 amtRatio = jjAmt / 昨日全天额，
 *     反推昨日额 = jjAmt / amtRatio（逐日精确，无需 ztpool 跨日对齐）
 *   - 对每只 × 三档买入额（10万/50万/100万）计算：
 *       旧：slip = 0.001 × √(r_old / 0.05)，r_old = buy / 昨日全天额
 *       新：slip = 0.001 × √(r_new / r0)，r_new = buy / 竞价额，r0 扫 [0.05, 0.1, 0.25, 0.5, 1]
 *   - 输出分布（P50/P90/P99/max）与触顶（cap=0.005）比例，供选定 r0
 *
 * 结论口径：选 r0 的目标不是让新旧数值相等（竞价额本就是更紧的流动性约束，
 * 冲击放大是预期行为），而是让 P99 不普遍触顶、且典型档（10万/中位票）不失控。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data/auction_score.json');
if (!existsSync(FILE)) {
  console.log('[slip-auction-sens] auction_score.json 尚无档');
  process.exit(0);
}
const days = JSON.parse(readFileSync(FILE, 'utf8'));
if (!Array.isArray(days) || !days.length) {
  console.log('[slip-auction-sens] 无有效日记录');
  process.exit(0);
}

const BASE = 0.001;
const CAP = 0.005;
const R0S = [0.05, 0.1, 0.25, 0.5, 1];
const BUYS = [1e5, 5e5, 1e6];
const slip = (r, r0) => Math.min(BASE * Math.sqrt(r / r0), CAP);

const rows = [];
for (const day of days) {
  for (const it of (day.items || [])) {
    const jjAmt = Number(it.jjAmt);
    const ratio = Number(it.amtRatio);
    if (!(jjAmt > 0) || !(ratio > 0)) continue;
    const prevAmt = jjAmt / ratio;      // 反推昨日全天成交额（逐日精确）
    for (const buy of BUYS) {
      const rOld = buy / prevAmt;
      const rNew = buy / jjAmt;
      rows.push({ date: day.trade_date, code: it.c, buy, rOld, rNew, old: slip(rOld, 0.05) });
    }
  }
}
if (!rows.length) { console.log('[slip-auction-sens] 无可核算样本'); process.exit(0); }

const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const stat = (vals) => {
  const a = [...vals].sort((x, y) => x - y);
  return { p50: q(a, 0.5), p90: q(a, 0.9), p99: q(a, 0.99), max: a[a.length - 1], capped: a.filter((v) => v >= CAP).length / a.length };
};
const fmt = (v) => (v * 10000).toFixed(2) + 'bp';   // 滑点用基点展示（0.0002 = 2bp）
const pct = (v) => (v * 100).toFixed(1) + '%';

console.log(`[slip-auction-sens] 样本：${days.length} 日 / ${rows.length} 条（日×票×买入档）`);
console.log('─'.repeat(78));
console.log(`旧口径（分母=昨日全天额, r0=0.05）: ${JSON.stringify(stat(rows.map((r) => r.old)), (k, v) => typeof v === 'number' && k !== 'capped' ? fmt(v) : v)}`);
console.log('─'.repeat(78));
for (const r0 of R0S) {
  const vals = rows.map((r) => slip(r.rNew, r0));
  const st = stat(vals);
  console.log(`新口径 r0=${String(r0).padEnd(4)} | P50 ${fmt(st.p50)} | P90 ${fmt(st.p90)} | P99 ${fmt(st.p99)} | max ${fmt(st.max)} | 触顶 ${pct(st.capped)}`);
}
console.log('─'.repeat(78));
console.log('分买入档（新口径 r0=0.25，中位/ P99）：');
for (const buy of BUYS) {
  const vals = rows.filter((r) => r.buy === buy).map((r) => slip(r.rNew, 0.25));
  const st = stat(vals);
  console.log(`  ${(buy / 1e4).toFixed(0)}万: P50 ${fmt(st.p50)} | P99 ${fmt(st.p99)} | 触顶 ${pct(st.capped)}`);
}
console.log('注：r_new/r_old 中位倍数 =', (q(rows.map((r) => r.rNew / r.rOld).sort((a, b) => a - b), 0.5)).toFixed(1));
