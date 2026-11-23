#!/usr/bin/env node
/* strategy_verdict.mjs —— v5.3+P82 择时策略成立性判据（2026-11-24 用户拍板：先定判据再跑）
 *
 * 【判据（先写死，跑完不得改口）】
 * ① 相对基准超额：基准 = breadth 全市场等权次日收益 buy&hold 净值（与策略同一收益序列）
 * ② 卡尔玛比率（年化收益 ÷ 最大回撤）≥ 0.5
 * ③ 前90 / 中90 / 后91 三段超额符号必须一致（单段为正不算成立）
 * ④ 成本 0.15%/次（A股双边佣金+滑点+印花，用户指出旧 0.05% 偏低）后仍成立
 * ⑤ 19 日双轨账本只能验口径整齐，不回答策略成立——本脚本用 271 日回放判定
 *
 * 【清仓档归因（用户顺手要求）】新增的 10 天清仓不一致按"regime 切换日后1天 vs 其他日"
 * 分组：集中在切换日 → 1.11 天滞后所致可接受；否则是口径问题要回查。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { decodeArchive } = await import(resolve(ROOT, 'src/lhb_codec.js'));
const { computeAllVersions } = await import(resolve(ROOT, 'src/formula_versions.js'));
const { tierKey, ABSOLUTE_FALLBACK, BASELINE_TIER_POLICY } = await import(resolve(ROOT, 'src/tier_policy.js'));

const VERDICT = Object.freeze({ minCalmar: 0.5, costBps: 0.0015, segments: [90, 90, 91] });
console.log('[verdict] 判据先落库（跑后不改）：①相对全市场等权基准超额 ②Calmar≥0.5 '
  + '③前90/中90/后91超额符号一致 ④成本 0.15%/次后仍成立 ⑤样本=271日（19日账本不判成立）');

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

function qLinear(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.min(sorted.length - 1, Math.ceil(h));
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}
const POS = { overheat: 0.40, full: 1.0, half: 0.50, clear: 0 };

function run(costBps, strategy) {
  let nav = 1, bh = 1, peak = 1, maxDd = 0, lastPos = 0;
  const rows = [];
  for (let i = 0; i < days.length; i++) {
    const s = scores[i], r = mkt(days[i].trade_date);
    if (s == null || r == null) continue;
    let th = ABSOLUTE_FALLBACK, key;
    if (strategy === 'p82') {
      const hist = scores.slice(0, i).filter((x) => x != null).sort((a, b) => a - b);
      if (hist.length >= 60) th = { overheat: qLinear(hist, .82), full: qLinear(hist, .49), half: qLinear(hist, .02) };
    }
    key = tierKey(s, th);
    const pos = POS[key];
    nav *= (1 + pos * r) - Math.abs(pos - lastPos) * costBps;
    bh *= (1 + r);
    lastPos = pos;
    peak = Math.max(peak, nav); maxDd = Math.max(maxDd, (peak - nav) / peak);
    rows.push({ date: days[i].trade_date, key, r, strategyNav: nav, bhNav: bh });
  }
  const years = rows.length / 244;
  const ann = Math.pow(nav, 1 / years) - 1;
  const excess = nav / bh - 1;
  const calmar = maxDd > 0 ? ann / maxDd : null;
  return { nav, bh, maxDd, ann, excess, calmar, rows };
}

const old = run(0.0005, 'old');
const p82 = run(0.0005, 'p82');
const p82Cost = run(VERDICT.costBps, 'p82');
const pct = (x) => x == null ? '—' : (x * 100).toFixed(2) + '%';
console.log(`\n═══ 271日策略判据（基准=全市场等权 buy&hold）═══`);
for (const [name, o] of [['旧绝对档', old], ['P82(成本0.05%)', p82], ['P82(成本0.15%)', p82Cost]]) {
  console.log(`  ${name}: 策略 ${pct(o.nav - 1)} | 基准 ${pct(o.bh - 1)} | 超额 ${pct(o.excess)} | 年化 ${pct(o.ann)} | maxDD ${pct(o.maxDd)} | Calmar ${o.calmar?.toFixed(2)}`);
}

// ③ 三段超额符号（用分段末净值/基准末净值比）
const seg = (o) => {
  const out = []; let i = 0;
  for (const n of VERDICT.segments) {
    const part = o.rows.slice(i, i + n); i += n;
    if (!part.length) break;
    out.push((part.at(-1).strategyNav / part[0].strategyNav) / (part.at(-1).bhNav / part[0].bhNav) - 1);
  }
  return out;
};
const segOld = seg(old), segNew = seg(p82Cost);
console.log(`\n  前/中/后段超额: 旧 ${segOld.map(pct).join(' / ')}`);
console.log(`                    P82 ${segNew.map(pct).join(' / ')}`);
const sameSign = segNew.every((x) => x > 0) || segNew.every((x) => x < 0);

// 清仓档归因：新增不一致日 vs regime 切换日后1天
const mism = [];
for (let i = 0; i < old.rows.length; i++) if (old.rows[i].key !== p82.rows[i].key) mism.push(i);
let nearSwitch = 0, other = 0;
for (const i of mism) {
  const isNear = i > 0 && old.rows[i - 1].key !== old.rows[i - 2 < 0 ? 0 : i - 2]?.key;
  if (isNear) nearSwitch++; else other++;
}
console.log(`\n═══ 清仓档归因（${mism.length} 天不一致）═══`);
console.log(`  不匹配日中"旧档 regime 切换后1天": ${nearSwitch} | 其他日: ${other} | 切换占比 ${mism.length ? pct(nearSwitch / mism.length) : '—'}`);
const clearMismatch = mism.filter((i) => old.rows[i].key === 'clear' || p82.rows[i].key === 'clear');
console.log(`  其中涉及清仓档的不一致: ${clearMismatch.length} 天（旧→新: ${clearMismatch.map((i) => old.rows[i].key + '→' + p82.rows[i].key).slice(0, 12).join(', ')}）`);

const pass = {
  alpha: p82Cost.excess > 0,
  calmar: p82Cost.calmar != null && p82Cost.calmar >= VERDICT.minCalmar,
  signConsistent: sameSign,
  costRobust: p82Cost.excess > 0 && p82Cost.maxDd <= p82.maxDd * 1.2,
};
console.log(`\n═══ 判据判定（先定后跑）═══`);
for (const [k, v] of Object.entries(pass)) console.log(`  ${k}: ${v ? '✓ 通过' : '✗ 未通过'}`);
console.log(`\n总结: ${Object.values(pass).every(Boolean) ? '策略成立（按四条判据）' : '策略不成立——分位档只是刻度修正，救不了策略'}`);
