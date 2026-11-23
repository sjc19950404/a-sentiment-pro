#!/usr/bin/env node
/* signal_direction.mjs —— 诊断一：信号方向是不是反的（2026-11-24 用户拍板：先做、5分钟一张表）
 *
 * 271 天按当日市场判档分组，直接算各组**次日全市场等权收益**（breadth K 线，与基准
 * 同一序列）——不回放、不改仓位映射，只回答一个问题：
 *  · overheat 组次日收益 > half 组 → "过热只减仓"方向反了（牛市顶部收手）
 *  · overheat 组显著低 → 方向对，进诊断二（迟滞/成本）
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { decodeArchive } = await import(resolve(ROOT, 'src/lhb_codec.js'));
const { computeAllVersions } = await import(resolve(ROOT, 'src/formula_versions.js'));
const { marketTier } = await import(resolve(ROOT, 'src/picks.js'));

const arch = decodeArchive(JSON.parse(readFileSync(resolve(ROOT, 'data/archive.json'), 'utf8')));
const days = (arch.all_days || []).filter((d) => d && d.trade_date);
const scores = computeAllVersions(days, ['v5.2-pro'])['v5.2-pro'].map((r) => Number.isFinite(+r.score) ? +r.score : null);

const kline = {};
for (let i = 0; i < 8; i++) {
  const f = resolve(ROOT, 'data/.breadth_kline', `shard-${String(i).padStart(2, '0')}.json`);
  if (!existsSync(f)) break;
  Object.assign(kline, JSON.parse(readFileSync(f, 'utf8')));
}
const byDate = new Map();
for (const arr of Object.values(kline)) {
  if (!Array.isArray(arr)) continue;
  for (let i = 0; i + 1 < arr.length; i++) {
    const d8 = String(arr[i].d || '').replace(/\D/g, '');
    const c0 = Number(arr[i].c), c1 = Number(arr[i + 1].c);
    if (!d8 || !Number.isFinite(c0) || !Number.isFinite(c1) || c0 <= 0) continue;
    const a = byDate.get(d8) || []; a.push(c1 / c0 - 1); byDate.set(d8, a);
  }
}
const mkt = (date) => { const a = byDate.get(String(date).replace(/\D/g, '')); return a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };

const groups = new Map();
for (let i = 0; i < days.length; i++) {
  const s = scores[i], r = mkt(days[i].trade_date);
  if (s == null || r == null) continue;
  const t = marketTier(s);   // 当前生产口径（绝对分 80/65/24）——生产不切，诊断就按现行档
  if (!t) continue;
  const g = groups.get(t.key) || []; g.push(r); groups.set(t.key, g);
}
const pct = (x) => x == null ? '—' : (x * 100).toFixed(2) + '%';
const stat = (a) => {
  const srt = [...a].sort((x, y) => x - y);
  return { n: a.length, mean: a.reduce((x, y) => x + y, 0) / a.length,
    med: srt[Math.floor(srt.length / 2)], win: a.filter((x) => x > 0).length / a.length };
};
console.log('\n═══ 诊断一：当日判档 → 次日全市场等权收益（271日，现生产绝对档口径）═══');
console.log('档位 | 样本 | 次日均值 | 中位数 | 胜率');
for (const k of ['overheat', 'full', 'half', 'clear']) {
  const a = groups.get(k); if (!a) continue;
  const x = stat(a);
  console.log(`${k} | ${x.n} | ${pct(x.mean)} | ${pct(x.med)} | ${pct(x.win)}`);
}
const oh = groups.get('overheat'), hf = groups.get('half');
if (oh && hf) {
  const a = stat(oh), b = stat(hf);
  console.log(`\nΔ(overheat - half) 均值 = ${pct(a.mean - b.mean)} | 中位数 = ${pct(a.med - b.med)}`);
  console.log(a.mean > b.mean
    ? '⚠ 方向反了：过热档次日收益高于半仓档——"过热只减仓"是在强势段收手，仓位映射方向需倒置（进方案C形态）。'
    : '✓ 方向对：过热档次日收益低于半仓档——问题在执行抖动/成本，进诊断二（迟滞回放）。');
}
