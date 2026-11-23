#!/usr/bin/env node
/* prob_calibration.mjs —— prob.score 校准回测（2026-11-24 拍板三，最高优先）
 *
 * 问题：选股卡展示 prob.score 连续值（如 64.8），自称"上涨概率"，但从没做过校准检验——
 * 如果 60–65 档实际次日上涨率只有 48%，这个数字对操作是负价值（伪精度）。
 *
 * 方法（point-in-time，只用信号当日可见数据）：
 *   1. 遍历 archive.json 全史交易日（除最后一日——需次日收盘定涨跌）；
 *   2. 对每日用**当日可见数据**重放 recommendPicks（与工作台卡同参数：
 *      emotionScore=当日情绪分/topN/stopLossPct/ztpool——不传 Pi 侧后验参数），
 *      取每个候选票的 prob.score；
 *   3. 次日涨跌 = 日 K 缓存（data/.breadth_kline，前复权收盘，251 交易日）
 *      次日收盘 > 信号日收盘；
 *   4. 按 50–55 / 55–60 / 60–65 / 65–70 四档统计实际命中率。
 *
 * 结论判据（拍板原文）：若高分档实际命中率显著低于名义（60–65 档 < 50%），
 * 则"概率"标签不成立——改为"相对强度分"并去小数点；若单调且接近名义，保留。
 *
 * 运行：node tools/backtest/prob_calibration.mjs [--min 50 --max 70]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const archive = JSON.parse(readFileSync(join(ROOT, 'data', 'archive.json'), 'utf8'));
const days = (archive.all_days || []).filter((x) => x && x.trade_date);

// 日 K 缓存（前复权收盘）
const kline = new Map();
for (const f of ['shard-00', 'shard-01', 'shard-02', 'shard-03', 'shard-04', 'shard-05', 'shard-06', 'shard-07']) {
  const p = join(ROOT, 'data', '.breadth_kline', `${f}.json`);
  if (!existsSync(p)) continue;
  const shard = JSON.parse(readFileSync(p, 'utf8'));
  for (const [code, arr] of Object.entries(shard)) kline.set(String(code), arr);
}
const nextClose = (code, date) => {
  const arr = kline.get(String(code));
  if (!arr) return null;
  const i = arr.findIndex((k) => k.d === date);
  if (i < 0 || i + 1 >= arr.length) return null;
  return { cur: arr[i].c, next: arr[i + 1].c };
};

// 与工作台卡同参数（paper_ui.js currentPicks 同款；不传 Pi 侧后验参数）
import { recommendPicks } from '../../src/picks.js';

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const MIN = getArg('--min', 50), MAX = getArg('--max', 70);

const buckets = new Map(); // label -> {n, win, scores[]}
const bucketOf = (s) => s < 55 ? '50-55' : s < 60 ? '55-60' : s < 65 ? '60-65' : '65-70';

let daysRun = 0, daysNoCandidates = 0, noKline = 0;
const t0 = Date.now();

for (let i = 0; i < days.length - 1; i++) {
  const day = days[i];
  const next = days[i + 1];
  const date = String(day.trade_date);
  const emotion = (day.emotion || {}).value;
  if (!Number.isFinite(+emotion)) { daysNoCandidates++; continue; }
  let r;
  try {
    r = recommendPicks(day, { emotionScore: +emotion, topN: 5 });
  } catch { daysNoCandidates++; continue; }
  const scored = [...(r.picks || []), ...(r.belowThreshold || [])];
  if (!scored.length) { daysNoCandidates++; continue; }
  daysRun++;
  for (const p of scored) {
    const s = p.prob && Number.isFinite(+p.prob.score) ? +p.prob.score : null;
    if (s == null || s < MIN || s >= MAX + 0.5) continue;
    const nc = nextClose(p.code, date);
    if (!nc) { noKline++; continue; }
    const up = nc.next > nc.cur;
    const label = bucketOf(s);
    if (!buckets.has(label)) buckets.set(label, { n: 0, win: 0 });
    const b = buckets.get(label);
    b.n++; if (up) b.win++;
  }
}

console.log(`\n═══ prob.score 校准回测 ═══`);
console.log(`样本窗口: ${days[0].trade_date} ~ ${days[days.length - 2].trade_date}（${daysRun} 个有效交易日，跳过 ${daysNoCandidates} 日无候选）`);
console.log(`次日口径: 日K前复权收盘 c[t+1] > c[t]（K线缓存 ${kline.size} 票，缺K线样本 ${noKline}）`);
console.log(`\n分档 | 样本 | 次日实际上涨率 | 名义含义`);
const order = ['50-55', '55-60', '60-65', '65-70'];
let monotonic = true, prev = -1;
for (const label of order) {
  const b = buckets.get(label) || { n: 0, win: 0 };
  const rate = b.n ? b.win / b.n * 100 : null;
  const flag = b.n < 30 ? '（样本<30，仅供参考）' : '';
  console.log(`${label} | ${b.n} | ${rate == null ? '—' : rate.toFixed(1) + '%'} | ≥${label.split('-')[0]}%${flag}`);
  if (rate != null && b.n >= 30) { if (prev >= 0 && rate < prev - 5) monotonic = false; prev = rate; }
}
const b6 = buckets.get('60-65') || { n: 0, win: 0 };
const r6 = b6.n ? b6.win / b6.n * 100 : null;
console.log(`\n── 结论 ──`);
if (b6.n < 30) {
  console.log(`60–65 档样本 ${b6.n} < 30：样本不足，暂不据此改标签；扩样后复跑（需更长回填或放低 MIN）。`);
} else if (r6 >= 55) {
  console.log(`60–65 档实际命中率 ${r6.toFixed(1)}% ≥ 55%：与名义方向一致，"概率"标签可暂留（建议持续监控）。`);
} else if (r6 >= 48) {
  console.log(`60–65 档实际命中率 ${r6.toFixed(1)}%：低于名义但未到负价值线（48%）——弱校准，建议改"相对强度分"并去小数点。`);
} else {
  console.log(`60–65 档实际命中率 ${r6.toFixed(1)}% < 48%：伪概率成立——按拍板改为"相对强度分"，去掉"概率"二字与小数点。`);
}
console.log(`单调性（高→低档，≥30 样本档）：${monotonic ? '未破坏' : '破坏（高分档命中率反低于低分档——分数无信息量或反向）'}`);
console.log(`耗时 ${(Date.now() - t0) / 1000 | 0}s`);
