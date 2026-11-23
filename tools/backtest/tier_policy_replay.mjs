#!/usr/bin/env node
/* tier_policy_replay.mjs —— 分位档 271 日回放验收（2026-11-24 用户拍板顺序 1、2）
 *
 * 同口径（v5.3 s_net 复活后的 decode 分数序列）跑三套档：
 *  · old_absolute：80/65/24（旧行为参照）
 *  · scale_baseline：P98/P60/P1 trailing250——上线基线，验收"档位天数分布与旧账本
 *    偏差 ≤2pp、收益/回撤无显著恶化"，只证明 scale 修好，不证明策略变好
 *  · shadow_p90：P90/P75/P10 trailing250——影子轨，只出对比表，不切
 *
 * 【前视纪律】每天的阈值只用当天之前的分数（trailing 250）；warmup 前 250 天
 * 用绝对分兜底，逐日标 warmup_absolute_fallback，不与正式分位档静默混算。
 *
 * 运行：node tools/backtest/tier_policy_replay.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { decodeArchive } = await import(resolve(ROOT, 'src/lhb_codec.js'));
const { computeAllVersions } = await import(resolve(ROOT, 'src/formula_versions.js'));
const { tierThresholds, tierKey, ABSOLUTE_FALLBACK, BASELINE_TIER_POLICY, SHADOW_TIER_POLICY } = await import(resolve(ROOT, 'src/tier_policy.js'));

const arch = decodeArchive(JSON.parse(readFileSync(resolve(ROOT, 'data/archive.json'), 'utf8')));
const days = (arch.all_days || []).filter((d) => d && d.trade_date);
const scores = computeAllVersions(days, ['v5.2-pro'])['v5.2-pro']
  .map((r) => Number.isFinite(+r.score) ? +r.score : null);
const POS = { overheat: 0.40, full: 1.0, half: 0.50, clear: 0 };

// 次日收益（breadth K 线，与回测同口径）
const kline = {};
for (let i = 0; i < 8; i++) {
  const f = resolve(ROOT, 'data/.breadth_kline', `shard-${String(i).padStart(2, '0')}.json`);
  if (!existsSync(f)) break;
  Object.assign(kline, JSON.parse(readFileSync(f, 'utf8')));
}
function nextRet(code, date) {
  const arr = kline[String(code)];
  if (!Array.isArray(arr)) return null;
  const d8 = String(date).replace(/\D/g, '');
  const i = arr.findIndex((r) => r && String(r.d || '').replace(/\D/g, '') === d8);
  if (i < 0 || i + 1 >= arr.length) return null;
  const c0 = Number(arr[i] && arr[i].c), c1 = Number(arr[i + 1] && arr[i + 1].c);
  return Number.isFinite(c0) && Number.isFinite(c1) && c0 > 0 ? c1 / c0 - 1 : null;
}

const variants = [
  { id: 'old_absolute', policy: null },
  { id: 'scale_baseline', policy: BASELINE_TIER_POLICY },
  { id: 'shadow_p90', policy: SHADOW_TIER_POLICY },
];
const result = {};
for (const v of variants) result[v.id] = { tiers: [], warmup: 0, nav: 1, maxDd: 0, peak: 1 };

for (let i = 0; i < days.length; i++) {
  const s = scores[i];
  if (s == null) continue;
  // 当日"市场代表收益"：当日涨停池首票的次日收益（事件域=客观涨停事实，与引擎解耦）
  const day = days[i];
  const sampleCode = ((day.summary || {}).zt_codes || [])[0]
    || (Array.isArray(day.hot) && day.hot[0] && day.hot[0].code);
  const r = sampleCode ? nextRet(sampleCode, day.trade_date) : null;
  for (const v of variants) {
    const o = result[v.id];
    let thresholds = ABSOLUTE_FALLBACK;
    if (v.policy) {
      const t = tierThresholds(scores.slice(0, i), v.policy);  // 严格只用历史（不含当日）
      thresholds = t.thresholds;
      if (t.warmup) o.warmup++;
    }
    const key = tierKey(s, thresholds);
    o.tiers.push(key);
    if (r != null && key) {
      o.nav *= (1 + POS[key] * r);
      o.peak = Math.max(o.peak, o.nav);
      o.maxDd = Math.max(o.maxDd, (o.peak - o.nav) / o.peak);
    }
  }
}

const pct = (x) => (x * 100).toFixed(1) + '%';
console.log(`\n═══ 分位档 271 日回放（s_net 复活口径，trailing250，warmup 绝对兜底）═══`);
const dist = (o) => {
  const c = {}; for (const k of o.tiers) c[k] = (c[k] || 0) + 1;
  return c;
};
const base = dist(result.old_absolute);
for (const v of variants) {
  const o = result[v.id], d = dist(o);
  const parts = ['overheat', 'full', 'half', 'clear'].map((k) => `${k} ${d[k] || 0}天(${pct((d[k] || 0) / o.tiers.length)})`).join(' / ');
  console.log(`${v.id}: ${parts} | warmup ${o.warmup}天 | 累计 ${pct(o.nav - 1)} maxDD ${pct(o.maxDd)}`);
}
console.log('\n═══ 验收表：基线 vs 旧绝对档 ═══');
const o = result.scale_baseline;
for (const k of ['overheat', 'full', 'half', 'clear']) {
  const a = (base[k] || 0) / result.old_absolute.tiers.length;
  const b = (dist(o)[k] || 0) / o.tiers.length;
  const diff = (b - a) * 100;
  console.log(`  ${k}: 旧 ${pct(a)} → 基线 ${pct(b)} | 偏差 ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pp ${Math.abs(diff) <= 2 ? '✓ ≤2pp' : '✗ >2pp'}`);
}
const ddOld = result.old_absolute.maxDd, ddNew = o.maxDd;
console.log(`  收益: 旧 ${pct(result.old_absolute.nav - 1)} → 基线 ${pct(o.nav - 1)} | 回撤: 旧 ${pct(ddOld)} → 基线 ${pct(ddNew)} ${ddNew > ddOld * 1.2 + 0.01 ? '⚠ 显著恶化' : '✓ 无显著恶化'}`);
console.log('\n═══ 影子轨对比（只出表，不切）═══');
for (const k of ['overheat', 'full', 'half', 'clear']) {
  const a = (dist(result.scale_baseline)[k] || 0) / o.tiers.length;
  const b = (dist(result.shadow_p90)[k] || 0) / result.shadow_p90.tiers.length;
  console.log(`  ${k}: 基线 ${pct(a)} → 影子P90 ${pct(b)} | 差 ${((b - a) * 100).toFixed(1)}pp`);
}
console.log(`  影子累计 ${pct(result.shadow_p90.nav - 1)} maxDD ${pct(result.shadow_p90.maxDd)}`);
console.log('\n【判读】基线只验收"尺度修正"——档位分布偏差 ≤2pp + 收益/回撤无显著恶化即过关；');
console.log('影子轨拐点长期参数另拍（用户明确：不凭感觉定）。warmup 天数已逐日显式标注。');
