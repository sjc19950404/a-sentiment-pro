#!/usr/bin/env node
/**
 * dir_two_rulers_compare.mjs — C3 双尺对照（2026-11-09 全层审计，只读不写）
 *
 * 背景：方向判据 directionOf 内部现算分位（全历史扩张窗 / 严格< / 分母含当日），
 *   而档案/页面展示的 pct_rank 是生产字段的另一套口径（60 日滚动等）——
 *   同名「分位」，±15pp 阈值作用在两把尺上结果未必一致。
 *
 * 本对照：对全部档案日，用两把尺各算一次方向（同阈值 ±15pp）：
 *   尺A（生产现况）= directionOf(情绪分序列)（内部现算分位）
 *   尺B（展示同源）= 档案 emotion.pct_rank 序列直接差分（同 lookback 同阈值）
 * 输出：两尺逐日 delta 差分布 + 方向判定不一致天数 + 不一致日样本。
 * 结论口径：差异小 → 双尺并存可接受（披露即可）；差异大 → 需拍板统一，不得静默改。
 */
import { directionOf } from '../src/regime.js';
import { decodeArchive } from '../src/lhb_codec.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arch = decodeArchive(JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8')));
const days = (arch.all_days || []).filter((d) => d && d.trade_date && d.emotion?.value != null && !d.emotion?._backfill);
const LOOKBACK = 3, UP = 15, DOWN = -15;

const dirOfDelta = (delta) => (delta >= UP ? 'up' : delta <= DOWN ? 'down' : 'flat');

let n = 0, diffDays = [], absDiffs = [];
for (let i = LOOKBACK; i < days.length; i++) {
  const scoreSeq = days.slice(0, i + 1).map((d) => d.emotion.value);
  const a = directionOf(scoreSeq, {}); // 尺A：生产现况
  const pr = days.slice(0, i + 1).map((d) => (d.emotion.pct_rank != null ? Number(d.emotion.pct_rank) : null));
  const cur = pr[pr.length - 1], base = pr[pr.length - 1 - LOOKBACK];
  if (a.dir == null || cur == null || base == null) continue;
  n++;
  const bDelta = Math.round((cur - base) * 10) / 10;
  const b = dirOfDelta(bDelta);
  absDiffs.push(Math.abs(a.delta - bDelta));
  if (a.dir !== b) diffDays.push({ date: days[i].trade_date, a: a.dir, b, aDelta: a.delta, bDelta });
}
absDiffs.sort((x, y) => x - y);
const q = (p) => absDiffs.length ? absDiffs[Math.floor(absDiffs.length * p)] : null;
console.log(`[C3双尺对照] 判定日 ${n} 个`);
console.log(`两尺 delta 差 |Δ|：中位 ${q(0.5)}pp · P90 ${q(0.9)}pp · 最大 ${q(1)}pp`);
console.log(`方向判定不一致 ${diffDays.length}/${n} = ${(n ? (diffDays.length / n) * 100 : 0).toFixed(1)}%`);
if (diffDays.length) {
  console.log('不一致样例（前 10）：');
  for (const d of diffDays.slice(0, 10)) console.log(`  ${d.date}: 尺A=${d.a}(${d.aDelta}pp) vs 尺B=${d.b}(${d.bDelta}pp)`);
}
