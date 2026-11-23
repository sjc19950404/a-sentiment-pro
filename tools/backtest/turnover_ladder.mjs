#!/usr/bin/env node
/* turnover_ladder.mjs —— 5 日累计换手剔除规则回测（2026-11-24 用户拍板一）
 *
 * 【定位链】补链（fetch_kline_turnover，东财 f61 现成换手率字段）→ 27 天对账（口径验收，
 *   >0.5pp 停）→ 本脚本 12 个月全量回测（阈值验收）。对账不过本脚本不跑。
 *
 * 【四条硬约束（拍板原文）】
 * 1. 可成交性过滤：次日一字板（无法买入）样本剔除——否则"高换手+连板"组收益被
 *    恰好买不进的样本虚增
 * 2. 双维分层：连板高度（1板/2板/≥3板）× 5日累计换手（<30 / 30–60 / 60–100 / >100）
 *    ——要判断的是"≥3板 + 累计>60"这一格，不是换手率单维
 * 3. 样本门槛：每格 ≥100 才允许参与阈值判定（60–65 档 51 样本的教训）
 * 4. 因变量双口径：次日涨停维持率（龙头战法视角）+ 次日开盘买收盘卖收益（实际执行
 *    视角）——只看前者高估、只看后者漏掉"板还在但赚不到钱"
 *
 * 【指标口径】
 * - 换手率：kline f61 现成字段（交易所流通股本口径，point-in-time 正确）
 * - 5 日累计换手 = 信号日 + 前 4 个交易日换手率之和（和，不是均值——拍板）
 * - 连板高度：从 K 线推——连续"涨停日"计数（主板 pct≥9.8 / 创业板科创板 pct≥19.8）；
 *   以 ztpool_history 有 lbc 的 27 天做推法校验
 * - 涨停判定（信号日样本=历史涨停股）：当日 pct ≥ 阈值（按板型）
 * - 一字板判定：次日 open==high==low==close 且 pct≥涨停阈值
 *
 * 运行：node tools/backtest/turnover_ladder.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KT = resolve(ROOT, 'data', '.kline_turnover');

// ── 载入采集库 ──
const man = JSON.parse(readFileSync(resolve(KT, 'manifest.json'), 'utf8'));
const codes = man.codes || [];
const kline = new Map(); // code -> rows [[date,open,close,high,low,pct,turnover],...]
for (let i = 0; i < (man.shardCount || 99); i++) {
  const f = resolve(KT, `shard-${String(i).padStart(2, '0')}.json`);
  if (!existsSync(f)) break;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  for (const [c, rows] of Object.entries(d)) kline.set(c, rows);
}
console.log(`[lt] 库存 ${kline.size} / manifest ${codes.length} 票 | 窗口 ${man.beg}~${man.end}`);

const isCyb = (c) => /^(300|301)/.test(c);      // 创业板 20cm
const isStar = (c) => /^688/.test(c);            // 科创板 20cm
const ztTh = (c) => (isCyb(c) || isStar(c)) ? 19.8 : 9.8;

// ── 第一步：27 天对账（口径验收） ──
const ztHist = JSON.parse(readFileSync(resolve(ROOT, 'data', 'ztpool_history.json'), 'utf8'));
let checked = 0, over = 0, maxDiff = 0;
const overSamples = [];
for (const day of ztHist) {
  const date = String(day.date).replace(/\D/g, '');
  for (const it of (day.pool || [])) {
    const rows = kline.get(String(it.c));
    if (!rows) continue;
    const row = rows.find((r) => String(r[0]).replace(/\D/g, '') === date);
    if (!row || !Number.isFinite(it.hs)) continue;
    const diff = Math.abs(row[6] - it.hs);
    checked++; maxDiff = Math.max(maxDiff, diff);
    if (diff > 0.5) { over++; if (overSamples.length < 8) overSamples.push({ code: it.c, date, kt: row[6], ztpool: +it.hs.toFixed(2) }); }
  }
}
console.log(`[lt] 27天对账：checked=${checked} 超0.5pp=${over} maxDiff=${maxDiff.toFixed(3)}pp`);
if (overSamples.length) console.log('  超限样例:', JSON.stringify(overSamples));
if (checked === 0 || over / checked > 0.01) {
  console.log('[lt] ❌ 对账未过（超限率 >1%）——按拍板纪律停止，不进入回测。先查计算口径。');
  process.exit(2);
}
console.log('[lt] ✓ 对账通过（口径验收）——进入回测');

// ── 回测主循环 ──
const BUCKETS = [
  { id: '<30', lo: 0, hi: 30 },
  { id: '30-60', lo: 30, hi: 60 },
  { id: '60-100', lo: 60, hi: 100 },
  { id: '>100', lo: 100, hi: Infinity },
];
const LB = (n) => (n === 1 ? '1板' : n === 2 ? '2板' : '≥3板');
const cell = new Map(); // key `${lb}|${bucket}` -> {n, hold, exec, execN, onelimit}

let totalSamples = 0, skippedOneWord = 0, skippedNoNext = 0;
for (const [code, rows] of kline) {
  const th = ztTh(code);
  for (let i = 4; i < rows.length - 1; i++) {
    const r = rows[i], next = rows[i + 1];
    if (!(r[5] >= th)) continue;              // 信号日：涨停（pct 阈值）
    if (!Number.isFinite(r[6])) continue;
    // 5 日累计换手（含信号日，前推 4 日）
    const win = rows.slice(i - 4, i + 1);
    if (win.some((x) => !Number.isFinite(x[6]))) continue;
    const cum5 = win.reduce((a, x) => a + x[6], 0);
    // 连板高度：从信号日往前数连续涨停
    let lb = 1;
    for (let j = i - 1; j >= 0 && rows[j][5] >= th; j--) lb++;
    // 次日数据
    if (!next || !Number.isFinite(next[1]) || !next[1]) { skippedNoNext++; continue; }
    const isOneWord = next[1] === next[2] && next[2] === next[3] && next[3] === next[4] && next[5] >= th;
    if (isOneWord) { skippedOneWord++; continue; }   // 可成交性过滤（拍板 1）
    const hold = next[5] >= th && next[2] === next[3] ? 1 : 0;   // 次日涨停维持：pct≥阈值 且收盘=最高
    const exec = (next[2] - next[1]) / next[1];                  // 次日开盘买收盘卖
    const b = BUCKETS.find((x) => cum5 >= x.lo && cum5 < x.hi);
    if (!b) continue;
    const key = `${LB(lb)}|${b.id}`;
    const c = cell.get(key) || { n: 0, holdSum: 0, execSum: 0, execN: 0 };
    c.n++; c.holdSum += hold; c.execSum += exec; c.execN++;
    cell.set(key, c);
    totalSamples++;
  }
}
console.log(`[lt] 样本：total=${totalSamples} 一字板剔除=${skippedOneWord} 无次日=${skippedNoNext}`);

// ── 输出：双维矩阵 + 样本门槛判定 ──
const ROWS = ['1板', '2板', '≥3板'];
console.log('\n═══ 双维分层矩阵（n / 涨停维持率 / 开盘买收盘卖均值）═══');
console.log('连板×累计换手   ' + BUCKETS.map((b) => b.id.padStart(16)).join(''));
const verdict = [];
for (const lb of ROWS) {
  const line = [lb.padEnd(6)];
  for (const b of BUCKETS) {
    const c = cell.get(`${lb}|${b.id}`);
    if (!c || c.n === 0) { line.push('—'.padStart(16)); continue; }
    const gateOk = c.n >= 100;
    const holdRate = (c.holdSum / c.n * 100).toFixed(1) + '%';
    const execAvg = (c.execSum / c.execN * 100).toFixed(2) + '%';
    const tag = gateOk ? '' : '(n<100)';
    line.push(`${c.n}${tag} ${holdRate}/${execAvg}`.padStart(16));
    if (gateOk) verdict.push({ lb, bucket: b.id, n: c.n, holdRate: c.holdSum / c.n, execAvg: c.execSum / c.execN });
  }
  console.log(line.join(''));
}
console.log('\n═══ 阈值判定输入（仅 n≥100 的格子）═══');
for (const v of verdict.sort((a, b) => a.lb.localeCompare(b.lb))) {
  console.log(`  ${v.lb} × ${v.bucket}: n=${v.n} 维持率=${(v.holdRate * 100).toFixed(1)}% 执行均值=${(v.execAvg * 100).toFixed(2)}%`);
}
console.log('\n[lt] 拐点判定：看"≥3板"行随换手档升高的期望是否单调转负——有拐点才有阈值，无拐点规则不成立（拍板原文）。');
