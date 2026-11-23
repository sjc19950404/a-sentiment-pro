#!/usr/bin/env node
/* confirm_surface.mjs —— confirm2 上线前参数曲面 + 分段 + 基准风险（2026-11-24 用户拍板硬门禁）
 *
 * 九格 confirm∈{1,2,3} × band∈{2,3,5}：confirm1=无确认（基线），confirm2=连续2日确认，
 * band=阈值±N 分（与 diagnosis_deep 的 band3 同口径，保证可比）。
 * 用户判据（缺一不上线）：
 *  ① 非孤峰：confirm2 邻域 conf1/conf3 至少一格超额同号为正（否则尖峰）
 *  ② 分段：前90/中90/后91 超额符号三段一致
 *  ③ 基准风险：同 breadth 序列算 buy&hold 基准 maxDD 与 Calmar，与策略同表对比
 *
 * 只评 confirm2 迟滞（映射不动、不拆 overheat——那是另一个变量的单独 OOS）。
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
const q = (sorted, p) => { if (!sorted.length) return null; const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.min(sorted.length - 1, Math.ceil(h)); return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo); };

const panel = [];
for (let i = 0; i < days.length; i++) {
  const s = scores[i], r = mkt(days[i].trade_date);
  if (s == null || r == null) continue;
  const hist = scores.slice(0, i).filter((x) => x != null).sort((a, b) => a - b);
  const th = hist.length >= 60 ? { overheat: q(hist, .82), full: q(hist, .49), half: q(hist, .02) } : { overheat: 80, full: 65, half: 24 };
  panel.push({ date: days[i].trade_date, s, r, th });
}
const POS = { overheat: .4, full: 1, half: .5, clear: 0 };
const COST = 0.0015;
const pct = (x) => x == null ? '—' : (x * 100).toFixed(2) + '%';

function run(confirm, band) {
  let nav = 1, bh = 1, peak = 1, maxDd = 0, lastKey = null, pending = null, pendingN = 0, lastPos = 0;
  const seg = [[], [], []];
  panel.forEach((x, i) => {
    let key = marketTier(x.s, { overheat: x.th.overheat + band, full: x.th.full + band, half: x.th.half + band })?.key;
    if (confirm > 1) {
      if (key !== lastKey) { if (pending === key) pendingN++; else { pending = key; pendingN = 1; } }
      else { pending = null; pendingN = 0; }
      if (pendingN >= confirm) { lastKey = key; pending = null; pendingN = 0; }
      key = lastKey || key;
    }
    const pos = POS[key];
    nav *= (1 + pos * x.r) - Math.abs(pos - lastPos) * COST;
    lastPos = pos; bh *= (1 + x.r);
    peak = Math.max(peak, nav); maxDd = Math.max(maxDd, (peak - nav) / peak);
    seg[i < 90 ? 0 : i < 180 ? 1 : 2].push({ nav, bh });
  });
  const years = panel.length / 244;
  const ann = Math.pow(nav, 1 / years) - 1;
  const excess = nav / bh - 1;
  const segEx = seg.map((a) => a.length ? (a.at(-1).nav / a[0].nav) / (a.at(-1).bh / a[0].bh) - 1 : null);
  return { excess, nav, maxDd, calmar: maxDd > 0 ? ann / maxDd : null, segEx };
}

// 基准风险（同一 breadth 序列 buy&hold）
let bh = 1, bhPeak = 1, bhDd = 0;
for (const x of panel) { bh *= (1 + x.r); bhPeak = Math.max(bhPeak, bh); bhDd = Math.max(bhDd, (bhPeak - bh) / bhPeak); }
const bhAnn = Math.pow(bh, 1 / (panel.length / 244)) - 1;
console.log(`\n═══ 基准风险（全市场等权 buy&hold，同 breadth 序列）═══`);
console.log(`  收益 ${pct(bh - 1)} | 年化 ${pct(bhAnn)} | maxDD ${pct(bhDd)} | Calmar ${(bhAnn / bhDd).toFixed(2)}`);

console.log(`\n═══ 九格参数曲面：confirm{1,2,3} × band{2,3,5}（成本0.15%，P82映射不动）═══`);
console.log('confirm | band | 超额 | 策略收益 | maxDD | Calmar | 前/中/后段超额');
const cells = new Map();
for (const c of [1, 2, 3]) for (const b of [2, 3, 5]) {
  const o = run(c, b); cells.set(`${c}|${b}`, o);
  console.log(`  ${c} | ${b} | ${pct(o.excess)} | ${pct(o.nav - 1)} | ${pct(o.maxDd)} | ${o.calmar?.toFixed(2)} | ${o.segEx.map(pct).join(' / ')}`);
}
const c2 = [2, 3, 5].map((b) => cells.get(`2|${b}`));
const neigh = [cells.get(`1|3`), cells.get(`3|3`)];
const peakSign = c2.some((x) => x.excess > 0);
const notLonePeak = neigh.some((x) => x.excess > 0) && peakSign;
const c23 = c2[1]; // confirm2 + band3（用户原始 confirm2 对应的邻域中心）
const segConsistent = c23.segEx.every((x) => x > 0) || c23.segEx.every((x) => x < 0);
console.log(`\n═══ 验收判定（缺一不上线）═══`);
console.log(`① 非孤峰：confirm2 同号为正 ${c2.filter((x) => x.excess > 0).length}/3 格 | 邻域 conf1(band3) ${pct(neigh[0].excess)}、conf3(band3) ${pct(neigh[1].excess)} → ${notLonePeak ? '✓' : '✗ 尖峰，不上线'}`);
console.log(`② 分段(中心格 2|3)：${c23.segEx.map(pct).join(' / ')} → ${segConsistent ? '✓ 三段同号' : '✗ 符号不一致'}`);
console.log(`③ 基准风险已补：基准 maxDD ${pct(bhDd)} / Calmar ${(bhAnn / bhDd).toFixed(2)} vs 中心格 maxDD ${pct(c23.maxDd)} / Calmar ${c23.calmar?.toFixed(2)}`);
console.log(`\n总结：${notLonePeak && segConsistent ? '三条全过——可签 confirm2 上线（feature flag + 单入口 + 逐字对照）' : '未全过——confirm2 不上线，按用户判据改走 C 或继续找参数'}`);
