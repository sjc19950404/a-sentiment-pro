#!/usr/bin/env node
/* regime_gated_replay.mjs —— 实验轨：只在因果走弱段启用择时（2026-11-24 用户拍板）
 *
 * 【因果 regime（用户定义，全 trailing，无前视）】
 * 走弱 = 指数收盘 < MA60 **且** breadth 站上20日线比例 < 50%，两者同时成立。
 * 上涨段强制 1/n（与 C 的满仓 beta 一致）——对照才干净，不事后划分牛熊。
 * 走弱段才启用 P82 + confirm3 + band3 减仓；三段（第61天起70/70/71）超额符号
 * 必须一致（不为负）才有资格回 A；否则永久归档为"下跌段减仓工具"，留风控层。
 *
 * 数据：breadth K 线全市场等权收益序列；指数用该序列的净值代表（不另找数据，
 * 同一条序列保证口径一致）；breadth 站上20日线比例 = 收盘价>MA20 的票占比（逐日）。
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

// breadth 序列：逐日全市场收益 + 站上 MA20 票数占比 + 指数（等权净值）
const kline = {};
for (let i = 0; i < 8; i++) {
  const f = resolve(ROOT, 'data/.breadth_kline', `shard-${String(i).padStart(2, '0')}.json`);
  if (!existsSync(f)) break;
  Object.assign(kline, JSON.parse(readFileSync(f, 'utf8')));
}
const byDate = new Map();
for (const arr of Object.values(kline)) {
  if (!Array.isArray(arr) || arr.length < 21) continue;
  for (let i = 20; i + 1 < arr.length; i++) {
    const d8 = String(arr[i].d || '').replace(/\D/g, '');
    const c0 = Number(arr[i].c), c1 = Number(arr[i + 1].c);
    if (!d8 || !Number.isFinite(c0) || !Number.isFinite(c1) || c0 <= 0) continue;
    const ma20 = arr.slice(i - 20, i + 1).reduce((a, r) => a + Number(r.c), 0) / 21;
    const e = byDate.get(d8) || { rs: [], above: 0, total: 0 };
    e.rs.push(c1 / c0 - 1);
    e.total++; if (c0 > ma20) e.above++;
    byDate.set(d8, e);
  }
}
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return s[lo] + (s[hi] - s[lo]) * (h - lo); };
const pct = (x) => x == null ? '—' : (x * 100).toFixed(2) + '%';
const POS = { overheat: .4, full: 1, half: .5, clear: 0 };

let idx = 1, idxMA = [], weakDays = 0, total = 0;
const panel = [];
for (let i = 0; i < days.length; i++) {
  const date = days[i].trade_date, e = byDate.get(String(date).replace(/\D/g, ''));
  const s = scores[i];
  if (!e || s == null) continue;
  const r = e.rs.reduce((a, b) => a + b, 0) / e.rs.length;
  idx *= (1 + r);
  idxMA.push(idx);
  const ma60 = idxMA.length >= 60 ? idxMA.slice(-60).reduce((a, b) => a + b, 0) / 60 : null;
  const breadthAbove = e.above / e.total;
  // 因果走弱：指数<MA60 且 breadth站上20日线比例<50%（trailing，无前视）
  const weak = ma60 != null && idx < ma60 && breadthAbove < 0.5;
  if (weak) weakDays++;
  total++;
  const hist = scores.slice(0, i).filter((x) => x != null).sort((a, b) => a - b);
  panel.push({ date, s, r, weak, th: hist.length >= 60 ? { overheat: q(hist, .82), full: q(hist, .49), half: q(hist, .02) } : null });
}
console.log(`[regime] 面板 ${panel.length} 天 | 因果走弱 ${weakDays} 天 (${pct(weakDays / total)})`);

function run(mode) {
  let nav = 1, bh = 1, lastKey = null, pending = null, pendingN = 0, lastPos = 0;
  const seg = [[], [], []];
  panel.forEach((x, i) => {
    // 上涨段强制满仓 beta（与 C 一致）；走弱段才启用 P82+confirm3+band3
    let key = 'full', pos = 1;
    if (mode === 'gated' && x.weak && x.th) {
      let k = marketTier(x.s, { overheat: x.th.overheat + 3, full: x.th.full + 3, half: x.th.half + 3 })?.key || 'full';
      if (k !== lastKey) { if (pending === k) pendingN++; else { pending = k; pendingN = 1; } }
      else { pending = null; pendingN = 0; }
      if (pendingN >= 3) { lastKey = k; pending = null; pendingN = 0; }
      key = lastKey || 'full';
      pos = POS[key];
    }
    nav *= (1 + pos * x.r) - Math.abs(pos - lastPos) * 0.0015;
    lastPos = pos; bh *= (1 + x.r);
    if (i >= 60) seg[i < 130 ? 0 : i < 200 ? 1 : 2].push({ nav, bh });
  });
  const excess = nav / bh - 1;
  const segEx = seg.map((a) => a.length ? (a.at(-1).nav / a[0].nav) / (a.at(-1).bh / a[0].bh) - 1 : null);
  return { excess, nav, segEx };
}
const beta = run('beta'), gated = run('gated');
console.log(`\n═══ 实验轨：因果 regime 门控（上涨段=满仓beta，走弱段=P82+confirm3+band3）═══`);
console.log(`  纯满仓 beta: 超额 ${pct(beta.excess)} | 三段 ${beta.segEx.map(pct).join(' / ')}`);
console.log(`  门控择时:   超额 ${pct(gated.excess)} | 三段 ${gated.segEx.map(pct).join(' / ')}`);
const ok = gated.segEx.every((x) => x >= -0.0001) && gated.excess > beta.excess;
console.log(`\n三段均不为负且优于 beta: ${ok ? '✓ 有资格回 A（交用户签）' : '✗ 永久归档为下跌段减仓工具，留风控层不上仓位层'}`);
