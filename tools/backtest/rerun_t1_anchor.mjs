#!/usr/bin/env node
// T1 锚点复跑工具（2026-11-07，门禁③重锚的「experiment 复跑证据」）。
//
// 背景：B1 方向判据（2026-11-06 落地）改变 classifySeries 现场重放的 regime 序列，
//   门禁③（影子线 ↔ 框架表 T1REF）在样本窗内漂移 0.06pp（-0.74% vs -0.68%）——
//   口径演进非实现漂移。按锚点纪律（paper_dual_track.mjs 门禁③注释）：重锚需
//   「人工更新 T1REF/T1_END 并附 experiment 复跑证据」。本脚本即该证据：
//
//   与 experiment_dual_track.mjs 逐行同款的重建/打分/仓位路径（poolRun→positionsBoost
//   →turnoverCost→metrics），唯一差异 = 样本窗截断到 T1_END（2026-09-30），与影子线
//   的 t1Cut 口径一致。输出 T1（帽0.3）/T1b（帽0.4）的窗内 total/maxDd/生效日数，
//   与影子线③实测对照一致后，方可将新值写回 T1REF。
//
// 用法：node tools/backtest/rerun_t1_anchor.mjs [T1_END=2026-09-30]
// 只读（不写任何档），输出仅供人工核对。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import config from '../../src/config.js';
import { decodeArchive } from '../../src/lhb_codec.js';
import { classifySeries } from '../../src/regime.js';
import { BASE_PARAMS, scoreWith, positions, turnoverCost, metrics } from '../../src/backtest.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const T1_END = process.argv[2] || '2026-09-30';

// ── 重建（与 experiment_dual_track.mjs 同款）──
const arch = decodeArchive(JSON.parse(readFileSync(join(ROOT, 'data', 'archive.json'), 'utf8')));
let days = (arch.all_days || []).filter((d) => d && d.trade_date && !(d.emotion && d.emotion._backfill));
// 样本窗截断（影子线 t1Cut 同口径：首个 > T1_END 的位置之前）
const cut = days.findIndex((d) => d.trade_date > T1_END);
if (cut !== -1) days = days.slice(0, cut);
const dates = days.map((d) => d.trade_date);
const factorsByDay = days.map((d) => d.emotion?.factors || {});
const ASSETS = config.backtest.assets;
const retsByAsset = {};
for (const a of ASSETS) {
  retsByAsset[a] = days.map((d) => {
    const v = d.indexes?.[a];
    return Number.isFinite(v) ? v / 100 : 0;
  });
}
const TR = config.params.train;
const plainW = {};
for (const [wk, pk] of Object.entries(config.factorKeyMap)) plainW[pk] = TR.weights[wk];
const pV52 = { ...BASE_PARAMS, ...TR.thresholds, ...TR.stops, ...TR.costModel };
const scores = scoreWith(factorsByDay, plainW);
const n = scores.length;

const regimeDays = days.map((d) => ({
  trade_date: d.trade_date,
  value: d.emotion ? d.emotion.value : null,
  pct_rank: d.emotion ? d.emotion.pct_rank : null,
  seal_pct: d.summary ? d.summary.seal_pct : null,
}));
const regimeKeys = classifySeries(regimeDays).map((r) => r.key);

// ── 与 experiment_dual_track.mjs 同款的 poolRun（positions 路径）──
function poolRun(sc, rts, p) {
  const assets = Object.keys(rts);
  const m = sc.length;
  const strat = new Array(m).fill(0);
  const pos = new Array(m).fill(0);
  let opens = 0;
  for (const a of assets) {
    const pa = positions(sc, rts[a], p);
    const ca = turnoverCost(pa, p);
    for (let i = 0; i < m; i++) {
      strat[i] += (rts[a][i] * pa[i] - ca[i]) / assets.length;
      pos[i] += pa[i] / assets.length;
      if (pa[i] > 0 && (i === 0 || pa[i - 1] === 0)) opens++;
    }
  }
  return { strat, pos, perf: metrics(strat, pos, opens, 0) };
}

const pct = (x) => (x * 100).toFixed(2) + '%';
console.log(`T1 锚点复跑（B1 口径）｜样本窗 ${dates[0]} ~ ${dates[dates.length - 1]}（${n} 日，T1_END=${T1_END}）`);
for (const cap of [0.3, 0.4]) {
  const p = { ...pV52, maxPosByDay: regimeKeys.map((k) => (k === 'shift' ? cap : null)) };
  const { perf } = poolRun(scores, retsByAsset, p);
  const active = regimeKeys.filter((k) => k === 'shift').length;
  console.log(`  C${cap.toFixed(1)}：total ${pct(perf.total)}｜maxDd ${pct(perf.maxDd)}｜精确值 total=${Number(perf.total.toFixed(6))} maxDd=${Number(perf.maxDd.toFixed(6))}（写 T1REF 用）｜shift 生效日 ${active}`);
}
console.log('（与影子线③实测对照一致后，将本输出的 total/maxDd 写回 paper_dual_track.mjs 的 T1REF）');
