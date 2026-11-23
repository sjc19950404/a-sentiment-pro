#!/usr/bin/env node
/* regime_surface.mjs —— 门控策略九格参数曲面 + 风险 + 新三段判据（2026-11-24 用户拍板）
 *
 * 【固定映射（写死，不随参数浮动）】
 * 上涨段 = 1.0（与 C 的满仓 beta 一致）；因果走弱段 = 0.4（减仓一次到位）。
 * 【门控优先】走弱期内不再按过热/半仓档重复减仓——归因只有"门控"一个原因。
 * 【因果 regime】走弱 = 指数收盘 < MAn 且 breadth 站上20日线比例 < X%，全 trailing。
 *
 * 九格 MA∈{20,60,120} × breadth∈{40,50,60}：平台不选峰——中心格 MA60|50 的
 * 邻居至少一格"三段判据过 + 超额为正"，否则判尖峰不签。
 * 【新三段判据（用户改写）】前段(61-130,上涨段)超额 ≥ -0.5pp（不落后即可，构造段
 * 不算业绩）；中段、后段超额 > 0（真实检验）。
 * 【风险】策略 maxDD/Calmar vs beta 同表；只在跌市减仓的策略，回撤必须明显优于基准。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { decodeArchive } = await import(resolve(ROOT, 'src/lhb_codec.js'));

const arch = decodeArchive(JSON.parse(readFileSync(resolve(ROOT, 'data/archive.json'), 'utf8')));
const days = (arch.all_days || []).filter((d) => d && d.trade_date);

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
    e.rs.push(c1 / c0 - 1); e.total++; if (c0 > ma20) e.above++;
    byDate.set(d8, e);
  }
}
const pct = (x) => x == null ? '—' : (x * 100).toFixed(2) + '%';

// 基准序列（等权 buy&hold）
const basePanel = [];
let idx = 1;
for (const d of days) {
  const e = byDate.get(String(d.trade_date).replace(/\D/g, ''));
  if (!e) continue;
  const r = e.rs.reduce((a, b) => a + b, 0) / e.rs.length;
  idx *= (1 + r);
  basePanel.push({ r, idx, above: e.above / e.total });
}
let bh = 1, bhPeak = 1, bhDd = 0;
for (const x of basePanel) { bh *= (1 + x.r); bhPeak = Math.max(bhPeak, bh); bhDd = Math.max(bhDd, (bhPeak - bh) / bhPeak); }
const bhAnn = Math.pow(bh, 1 / (basePanel.length / 244)) - 1;

function run(MA, BREAD) {
  let nav = 1, peak = 1, maxDd = 0, lastPos = 1, hist = [];
  const seg = [[], [], []];
  basePanel.forEach((x, i) => {
    hist.push(x.idx);
    const ma = hist.length >= MA ? hist.slice(-MA).reduce((a, b) => a + b, 0) / MA : null;
    const weak = ma != null && x.idx < ma && x.above < BREAD / 100;
    const pos = weak ? 0.4 : 1.0;   // 写死映射：走弱减到 0.4、上涨满仓；不再叠过热档
    nav *= (1 + pos * x.r) - Math.abs(pos - lastPos) * 0.0015;
    lastPos = pos;
    peak = Math.max(peak, nav); maxDd = Math.max(maxDd, (peak - nav) / peak);
    if (i >= 60) seg[i < 130 ? 0 : i < 200 ? 1 : 2].push({ nav, bh: (bh / Math.pow(1 + x.r, 1)) }); // bh 近似：用当日前的净值比
  });
  const excess = nav / bh - 1;
  const ann = Math.pow(nav, 1 / (basePanel.length / 244)) - 1;
  // 分段超额：用段内 nav 相对涨幅 / 段内基准相对涨幅（基准按同期 r 复利算）
  const segEx = [];
  let si = 0;
  for (let g = 0; g < 3; g++) {
    const n = g === 0 ? 70 : g === 1 ? 70 : basePanel.length - 140;
    let sr = 1;
    for (let j = si; j < Math.min(si + n, basePanel.length); j++) sr *= (1 + basePanel[j].r);
    const part = seg[g];
    segEx.push(part.length ? (part.at(-1).nav / part[0].nav) / sr - 1 : null);
    si += n;
  }
  const gateOk = segEx[0] != null && segEx[0] >= -0.005 && segEx[1] > 0 && segEx[2] > 0;
  return { excess, nav, maxDd, calmar: maxDd > 0 ? ann / maxDd : null, segEx, gateOk };
}

console.log(`\n═══ 基准（全市场等权 buy&hold，同 breadth 序列）═══`);
console.log(`  收益 ${pct(bh - 1)} | 年化 ${pct(bhAnn)} | maxDD ${pct(bhDd)} | Calmar ${(bhAnn / bhDd).toFixed(2)}`);
console.log(`\n═══ 九格曲面：MA{20,60,120} × breadth{40,50,60}（写死映射 上涨1.0/走弱0.4，成本0.15%）═══`);
console.log('MA | breadth | 超额 | 收益 | maxDD | Calmar | 前段(不落后≥-0.5pp) / 中 / 后 | 新三段判据');
const cells = new Map();
for (const MA of [20, 60, 120]) for (const B of [40, 50, 60]) {
  const o = run(MA, B); cells.set(`${MA}|${B}`, o);
  console.log(`${MA} | ${B} | ${pct(o.excess)} | ${pct(o.nav - 1)} | ${pct(o.maxDd)} | ${o.calmar?.toFixed(2)} | ${o.segEx.map(pct).join(' / ')} | ${o.gateOk ? '✓' : '✗'}`);
}
// 平台判定：中心格 MA60|50 的四个邻居至少一个 gateOk 且超额为正
const center = cells.get('60|50');
const neigh = ['20|50', '120|50', '60|40', '60|60'].map((k) => ({ k, ...cells.get(k) }));
const platform = neigh.some((n) => n.gateOk && n.excess > 0);
console.log(`\n═══ 判定（按用户三条顺序）═══`);
console.log(`① 平台(非峰)：中心 MA60|50 超额 ${pct(center.excess)} 判据 ${center.gateOk ? '✓' : '✗'} | 邻居通过数 ${neigh.filter((n) => n.gateOk && n.excess > 0).length}/4 → ${platform ? '✓ 平台' : '✗ 尖峰不签'}`);
console.log(`② 新三段：前 ${pct(center.segEx[0])}（门槛≥-0.5pp） / 中 ${pct(center.segEx[1])} / 后 ${pct(center.segEx[2])} → ${center.gateOk ? '✓' : '✗'}`);
console.log(`③ 风险：基准 maxDD ${pct(bhDd)}/Calmar ${(bhAnn / bhDd).toFixed(2)} vs 中心 ${pct(center.maxDd)}/${center.calmar?.toFixed(2)} | 回撤改善 ${pct(bhDd - center.maxDd)}`);
console.log(`\n结论：${platform && center.gateOk && center.maxDd < bhDd ? '全过——可落 regime_gated 模式走 A 切换流程（用户签后执行）' : '未全过——门控候选不签，生产维持 C(alert_only)'}`);
