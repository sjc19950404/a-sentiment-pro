#!/usr/bin/env node
/* diagnosis_deep.mjs —— 诊断一补测三件 + 诊断二迟滞 + 定向测试（2026-11-24 用户拍板）
 *
 * 诊断一（用均值定性，中位数只描述形状）：补三件缺一不结论——
 *  ① bootstrap 10000 次 Δ 95%CI + permutation p（不用 t 检验；m≈4 → p<0.0125 才算过）
 *  ② winsorize 过热组前后各 1%/5% 极值后 Δ 还剩多少
 *  ③ 前/中/后 90 天 Δ 符号（三段两负一正=没有）
 * 三件全过才写"方向反了"；否则"方向中性、无 edge"。
 *
 * 诊断二（与诊断一并行，不串行）：连续2日确认 / ±3分带宽迟滞，成本 0.15%/次，
 * 看超额能否转正（转正→执行抖动，走 A 切7处；仍负→信号无 edge，走 C）。
 *
 * 定向测试：拆掉 overheat 减仓映射（仓位 0.4→1.0，保留 clear 空仓），其余不变，
 * 同 271 天重跑——超额改善→问题锁在 overheat 映射；无改善→整套择时无 edge。
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

// 逐日面板：日期/分数/绝对档/次日市场收益（P82 分位档另算供诊断二）
function qLinear(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.min(sorted.length - 1, Math.ceil(h));
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}
const panel = [];
for (let i = 0; i < days.length; i++) {
  const s = scores[i], r = mkt(days[i].trade_date);
  if (s == null || r == null) continue;
  const absKey = marketTier(s)?.key;
  const hist = scores.slice(0, i).filter((x) => x != null).sort((a, b) => a - b);
  let p82Key = absKey, th = null;
  if (hist.length >= 60) {
    th = { overheat: qLinear(hist, .82), full: qLinear(hist, .49), half: qLinear(hist, .02) };
    p82Key = marketTier(s, th)?.key;
  }
  panel.push({ date: days[i].trade_date, s, r, absKey, p82Key, th });
}

const pct = (x) => x == null ? '—' : (x * 100).toFixed(2) + '%';
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const oh = panel.filter((x) => x.absKey === 'overheat').map((x) => x.r);
const hf = panel.filter((x) => x.absKey === 'half').map((x) => x.r);
const dObs = mean(oh) - mean(hf);
console.log(`\n═══ 诊断一补测：Δ(overheat-half 次日收益) = ${pct(dObs)} | n=${oh.length}/${hf.length} ═══`);

// ── ① bootstrap CI + permutation p（不用 t 检验） ──
let rngState = 20261124;
const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
const B = 10000;
let bootD = [], permGe = 0;
const pool = oh.concat(hf);
for (let b = 0; b < B; b++) {
  let so = 0, sh = 0;
  for (let i = 0; i < oh.length; i++) so += oh[Math.floor(rnd() * oh.length)];
  for (let i = 0; i < hf.length; i++) sh += hf[Math.floor(rnd() * hf.length)];
  bootD.push(so / oh.length - sh / hf.length);
  // permutation：合并池随机重分组（同组大小）
  const shuf = pool.slice();
  for (let i = shuf.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuf[i], shuf[j]] = [shuf[j], shuf[i]]; }
  let po = 0, ph = 0;
  for (let i = 0; i < oh.length; i++) po += shuf[i];
  for (let i = 0; i < hf.length; i++) ph += shuf[oh.length + i];
  if (po / oh.length - ph / hf.length >= dObs) permGe++;
}
bootD.sort((a, b) => a - b);
const lo95 = bootD[Math.floor(0.025 * B)], hi95 = bootD[Math.floor(0.975 * B)];
const pPerm = (permGe + 1) / (B + 1);
console.log(`① bootstrap 95%CI [${pct(lo95)}, ${pct(hi95)}] | permutation 单尾 p=${pPerm.toFixed(4)}（多重检验门槛 m≈4 → p<0.0125）${pPerm < 0.0125 && lo95 > 0 ? ' ✓' : ' ✗'}`);

// ── ② winsorize 过热组极值 ──
const win = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  const l = s[Math.floor(p * (s.length - 1))], h = s[Math.floor((1 - p) * (s.length - 1))];
  return a.map((x) => Math.min(h, Math.max(l, x)));
};
const d1 = mean(win(oh, .01)) - mean(hf), d5 = mean(win(oh, .05)) - mean(hf);
console.log(`② winsorize 过热组: 1%→Δ ${pct(d1)} | 5%→Δ ${pct(d5)} ${d1 > 0 && d5 > 0 ? '✓ 尾部剔除后仍正' : '✗ 尾部依赖'}（原 Δ ${pct(dObs)}）`);

// ── ③ 分段稳定性（前/中/后按全样本序号 90/90/剩余） ──
const cuts = [panel.slice(0, 90), panel.slice(90, 180), panel.slice(180)];
const segD = cuts.map((part) => {
  const a = part.filter((x) => x.absKey === 'overheat').map((x) => x.r);
  const b = part.filter((x) => x.absKey === 'half').map((x) => x.r);
  return { d: a.length && b.length ? mean(a) - mean(b) : null, n: a.length + '/' + b.length };
});
console.log(`③ 分段 Δ: 前 ${pct(segD[0].d)}(n=${segD[0].n}) | 中 ${pct(segD[1].d)}(n=${segD[1].n}) | 后 ${pct(segD[2].d)}(n=${segD[2].n}) ${segD.every((x) => x.d != null && x.d > 0) ? '✓ 三段同号' : '✗ 符号不一致'}`);

const pass = pPerm < 0.0125 && lo95 > 0 && d1 > 0 && d5 > 0 && segD.every((x) => x.d != null && x.d > 0);
console.log(`\n【诊断一结论】${pass ? '方向反了（三件全过）' : '方向中性、无 edge（三件未全过）'}`);

// ═══ 诊断二：迟滞回放（与诊断一并行） ═══
const POS = { overheat: .4, full: 1, half: .5, clear: 0 };
const COST = 0.0015;
function replay(mode) {
  let nav = 1, bh = 1, peak = 1, maxDd = 0, lastKey = null, pending = null, pendingN = 0;
  for (const x of panel) {
    let key = x.p82Key;
    if (mode === 'confirm2') {
      if (key !== lastKey) { if (pending === key) pendingN++; else { pending = key; pendingN = 1; } }
      else { pending = null; pendingN = 0; }
      if (pendingN >= 2) { lastKey = key; pending = null; pendingN = 0; }
      key = lastKey || key;
    } else if (mode === 'band3' && x.th) {
      const t3 = { overheat: x.th.overheat + 3, full: x.th.full + 3, half: x.th.half + 3 };
      key = marketTier(x.s, t3)?.key || key;
    }
    const pos = POS[key];
    nav *= (1 + pos * x.r) - Math.abs(pos - (replay.prevPos || 0)) * COST;
    replay.prevPos = pos;
    bh *= (1 + x.r);
    peak = Math.max(peak, nav); maxDd = Math.max(maxDd, (peak - nav) / peak);
  }
  replay.prevPos = 0;
  return { excess: nav / bh - 1, nav, maxDd };
}
// 修正闭包：重跑时重置 prevPos
function replay2(mode) {
  let nav = 1, bh = 1, peak = 1, maxDd = 0, lastKey = null, pending = null, pendingN = 0, lastPos = 0;
  for (const x of panel) {
    let key = x.p82Key;
    if (mode === 'confirm2') {
      if (key !== lastKey) { if (pending === key) pendingN++; else { pending = key; pendingN = 1; } }
      else { pending = null; pendingN = 0; }
      if (pendingN >= 2) { lastKey = key; pending = null; pendingN = 0; }
      key = lastKey || key;
    } else if (mode === 'band3' && x.th) {
      key = marketTier(x.s, { overheat: x.th.overheat + 3, full: x.th.full + 3, half: x.th.half + 3 })?.key || key;
    }
    const pos = POS[key];
    nav *= (1 + pos * x.r) - Math.abs(pos - lastPos) * COST;
    lastPos = pos; bh *= (1 + x.r);
    peak = Math.max(peak, nav); maxDd = Math.max(maxDd, (peak - nav) / peak);
  }
  return { excess: nav / bh - 1, nav, maxDd };
}
console.log(`\n═══ 诊断二：迟滞回放（P82 + 成本0.15%，基准=全市场等权）═══`);
for (const m of ['none', 'confirm2', 'band3']) {
  const o = replay2(m);
  console.log(`  ${m}: 超额 ${pct(o.excess)} | 策略 ${pct(o.nav - 1)} | maxDD ${pct(o.maxDd)} ${o.excess > 0 ? '✓ 转正' : '✗ 仍负'}`);
}

// ═══ 定向测试：拆掉 overheat 减仓映射 ═══
function noOverheatCut() {
  let nav = 1, bh = 1, lastPos = 0;
  for (const x of panel) {
    const key = x.p82Key;
    const pos = key === 'overheat' ? 1.0 : POS[key];   // 只拆过热减仓；clear 空仓保留
    nav *= (1 + pos * x.r) - Math.abs(pos - lastPos) * COST;
    lastPos = pos; bh *= (1 + x.r);
  }
  return nav / bh - 1;
}
const baseExcess = replay2('none').excess, noCut = noOverheatCut();
console.log(`\n═══ 定向测试：只拆"过热减仓"（保留 clear 空仓）═══`);
console.log(`  原 P82 超额 ${pct(baseExcess)} → 拆过热后 ${pct(noCut)} | 改善 ${pct(noCut - baseExcess)} ${noCut > baseExcess ? '✓ 问题锁在 overheat 映射' : '✗ 整套择时无 edge→走C'}`);
