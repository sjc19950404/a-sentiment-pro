#!/usr/bin/env node
/* tier_expanding_replay.mjs —— expanding(min_n=60) 分位档回放（2026-11-24 用户拍板 B）
 *
 * 【先修收益口径（用户审计结论：旧口径不合格）】
 * 旧版用"当日涨停池首票次日收益"代表市场——241 天单票均值 1.74%/日（实盘不可能）、
 * 无费用滑点、假设涨停收盘可成交——906.7% 与 -29.4pp 比较全部作废。本版：
 *  · 标的收益 = breadth K 线**全市场等权次日收益均值**（指数化，回避单票涨停买不进）
 *  · 成本 = |仓位变动| × 0.0005（佣金万3 + 滑点万2；卖出印花万5按换仓一半粗略计入，
 *    明示为近似——精确撮合需回 dual_track 账本）
 *  · 复利净值法（明确标注）；不计杠杆、不做空
 *
 * 【策略】expanding 分位：阈值只用已见历史（严格不含当日），min_n=60（3 个月），
 * 前 60 天绝对分兜底标 warmup_absolute_fallback；P98/P60/P1 线性插值分位
 * （nearest-rank 会一格一格跳）；trailing250 保留影子轨。
 * 【分段考核】n<120 vs n≥120，看阈值收敛路径有无系统性偏向。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { decodeArchive } = await import(resolve(ROOT, 'src/lhb_codec.js'));
const { computeAllVersions } = await import(resolve(ROOT, 'src/formula_versions.js'));
const { tierKey, ABSOLUTE_FALLBACK, BASELINE_TIER_POLICY, SHADOW_TIER_POLICY } = await import(resolve(ROOT, 'src/tier_policy.js'));

const arch = decodeArchive(JSON.parse(readFileSync(resolve(ROOT, 'data/archive.json'), 'utf8')));
const days = (arch.all_days || []).filter((d) => d && d.trade_date);
const scores = computeAllVersions(days, ['v5.2-pro'])['v5.2-pro'].map((r) => Number.isFinite(+r.score) ? +r.score : null);

// 全市场等权次日收益（预计算；前复权收盘，breadth K 线）
const kline = {};
for (let i = 0; i < 8; i++) {
  const f = resolve(ROOT, 'data/.breadth_kline', `shard-${String(i).padStart(2, '0')}.json`);
  if (!existsSync(f)) break;
  Object.assign(kline, JSON.parse(readFileSync(f, 'utf8')));
}
const byDate = new Map(); // date -> [nextReturns]
for (const arr of Object.values(kline)) {
  if (!Array.isArray(arr)) continue;
  for (let i = 0; i + 1 < arr.length; i++) {
    const d8 = String(arr[i].d || '').replace(/\D/g, '');
    const c0 = Number(arr[i].c), c1 = Number(arr[i + 1].c);
    if (!d8 || !Number.isFinite(c0) || !Number.isFinite(c1) || c0 <= 0) continue;
    const a = byDate.get(d8) || []; a.push(c1 / c0 - 1); byDate.set(d8, a);
  }
}
const mktRet = (date) => {
  const a = byDate.get(String(date).replace(/\D/g, ''));
  if (!a || !a.length) return null;
  return a.reduce((x, y) => x + y, 0) / a.length;
};

// 线性插值分位（替代 nearest-rank）
function qLinear(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h), hi = Math.min(sorted.length - 1, Math.ceil(h));
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}
function expandingTh(i, policy) {
  const hist = scores.slice(0, i).filter((x) => x != null).sort((a, b) => a - b);
  if (hist.length < 60) return { th: { ...ABSOLUTE_FALLBACK }, warmup: true, n: hist.length };
  const q = policy.quantiles;
  return { th: { overheat: qLinear(hist, q.overheat), full: qLinear(hist, q.full), half: qLinear(hist, q.half) },
    warmup: false, n: hist.length };
}
function trailingTh(i, policy) {
  const hist = scores.slice(Math.max(0, i - 250), i).filter((x) => x != null).sort((a, b) => a - b);
  if (hist.length < 250) return { th: { ...ABSOLUTE_FALLBACK }, warmup: true, n: hist.length };
  const q = policy.quantiles;
  return { th: { overheat: qLinear(hist, q.overheat), full: qLinear(hist, q.full), half: qLinear(hist, q.half) },
    warmup: false, n: hist.length };
}

const POS = { overheat: 0.40, full: 1.0, half: 0.50, clear: 0 };
const variants = [
  { id: 'old_absolute', mode: null },
  { id: 'expanding_baseline_P82_49_2', mode: 'expanding', policy: BASELINE_TIER_POLICY },
  { id: 'trailing_baseline_P82_49_2', mode: 'trailing', policy: BASELINE_TIER_POLICY },
  { id: 'expanding_shadow_P90_75_10', mode: 'expanding', policy: SHADOW_TIER_POLICY },
];
const out = {};
for (const v of variants) out[v.id] = { tiers: [], warmup: 0, nav: 1, peak: 1, maxDd: 0, byAge: { young: [], mature: [] }, thHist: [] };

for (let i = 0; i < days.length; i++) {
  const s = scores[i]; if (s == null) continue;
  const r = mktRet(days[i].trade_date); if (r == null) continue;
  for (const v of variants) {
    const o = out[v.id];
    let th = ABSOLUTE_FALLBACK, warmup = false, n = 0;
    if (v.mode) {
      const t = v.mode === 'expanding' ? expandingTh(i, v.policy) : trailingTh(i, v.policy);
      th = t.th; warmup = t.warmup; n = t.n;
      if (warmup) o.warmup++;
    }
    const key = tierKey(s, th);
    const prevPos = o.lastPos || 0, pos = POS[key];
    const cost = Math.abs(pos - prevPos) * 0.0005;
    o.nav *= (1 + pos * r) - cost;
    o.lastPos = pos;
    o.peak = Math.max(o.peak, o.nav);
    o.maxDd = Math.max(o.maxDd, (o.peak - o.nav) / o.peak);
    o.tiers.push(key);
    if (v.mode === 'expanding') {
      o.byAge[n < 120 ? 'young' : 'mature'].push({ r, key, th });
      o.thHist.push({ date: days[i].trade_date, n, th });
    }
  }
}

const pct = (x) => (x * 100).toFixed(2) + '%';
console.log(`\n═══ expanding(min_n=60) 回放 | 全市场等权收益 + 仓位成本 0.05%/换仓 | 复利净值 ═══`);
for (const v of variants) {
  const o = out[v.id];
  console.log(`${v.id}: overheat ${o.tiers.filter((x) => x === 'overheat').length}d / full ${o.tiers.filter((x) => x === 'full').length}d / half ${o.tiers.filter((x) => x === 'half').length}d / clear ${o.tiers.filter((x) => x === 'clear').length}d | warmup ${o.warmup}d | 累计 ${pct(o.nav - 1)} | maxDD ${pct(o.maxDd)}`);
}
const base = out.old_absolute, b = out.expanding_baseline_P82_49_2;
console.log('\n═══ 基线验收（vs 旧绝对档，用户验收线：档位偏差≤2pp、收益/回撤无显著恶化）═══');
for (const k of ['overheat', 'full', 'half', 'clear']) {
  const a = base.tiers.filter((x) => x === k).length / base.tiers.length;
  const c = b.tiers.filter((x) => x === k).length / b.tiers.length;
  console.log(`  ${k}: ${pct(a)} → ${pct(c)} | ${((c - a) * 100).toFixed(1)}pp ${Math.abs(c - a) <= 0.02 ? '✓' : '✗'}`);
}
console.log(`  收益 ${pct(base.nav - 1)} → ${pct(b.nav - 1)} | 回撤 ${pct(base.maxDd)} → ${pct(b.maxDd)}`);

console.log('\n═══ 分段考核（expanding 阈值收敛：n<120 vs n≥120）═══');
for (const [age, arr] of Object.entries(b.byAge)) {
  if (!arr.length) continue;
  const ex = arr.filter((x) => x.key === 'overheat').length / arr.length;
  const th0 = arr[0].th, th1 = arr[arr.length - 1].th;
  console.log(`  ${age}: n=${arr.length}d 过热门槛 ${th0.overheat.toFixed(1)} → ${th1.overheat.toFixed(1)} | 过热占比 ${pct(ex)}`);
}
/* ── 用户验收线①：构造性验证——逐日档位一致率 ≥95%（占比构造相等不等于逐日等价） ── */
let agree = 0, total = 0;
for (let i = 0; i < base.tiers.length; i++) {
  if (b.tiers[i] && base.tiers[i]) { total++; if (b.tiers[i] === base.tiers[i]) agree++; }
}
const agreeRate = total ? agree / total : 0;
console.log(`\n═══ 验收线①：构造性验证 ═══`);
console.log(`  逐日档位一致率: ${agree}/${total} = ${pct(agreeRate)} ${agreeRate >= 0.95 ? '✓ ≥95%' : '✗ <95%——不构成等价，禁止切生产'}`);
/* ── 用户验收线②：收敛固化 + regime 切换滞后天数 ── */
const young = b.byAge.young, mature = b.byAge.mature;
const span = (arr) => arr.length ? Math.max(...arr.map((x) => x.th.overheat)) - Math.min(...arr.map((x) => x.th.overheat)) : NaN;
const ySpan = span(young), mSpan = span(mature);
const mDrift = mature.length > 1 ? Math.abs(mature.at(-1).th.overheat - mature[0].th.overheat) : NaN;
console.log(`\n═══ 验收线②：收敛与滞后 ═══`);
console.log(`  段内波动 n<120 ${ySpan.toFixed(2)} 分 | n≥120 ${mSpan.toFixed(2)} 分（诊断，不作门禁——用户口径是首→末漂移）`);
console.log(`  成熟段首→末门槛 ${mature[0]?.th.overheat.toFixed(1)} → ${mature.at(-1)?.th.overheat.toFixed(1)} | 漂移 ${mDrift.toFixed(2)} 分 ${mDrift <= 1.5 ? '✓ ≤1.5 分门禁' : '✗ 未收敛'}`);
let lagSum = 0, lagN = 0;
for (let i = 1; i < b.tiers.length; i++) {
  if (base.tiers[i] !== base.tiers[i - 1]) {   // 旧档发生 regime 切换
    let j = i; while (j < b.tiers.length && b.tiers[j] === b.tiers[i - 1]) j++;
    lagSum += Math.max(0, j - i + 1); lagN++;
  }
}
console.log(`  旧档 regime 切换 ${lagN} 次 | 分位档平均跟随滞后 ${lagN ? (lagSum / lagN).toFixed(2) : '—'} 天`);
if (agreeRate < 0.95 || !(mDrift <= 1.5)) { console.error('[tier] ❌ HARD FAIL：构造性/收敛验收未过——禁止切 7 处'); process.exit(1); }
console.log('\n注：影子轨 P90/P75/P10 与 trailing250 均只出对比表，不切。');
