#!/usr/bin/env node
/**
 * 滑点敏感性对照回测（2026-11-10，六方向 #4 v1——两步走，backtest.js 零改动）。
 *
 * 做什么：同一 V5.2-pro 参数组（风控全开），仅扫 slip ∈ SLIP_PRESETS 四档，
 *   全样本 + 样本内/外（80/20，与 promote_params 同口径）各跑 poolBacktest 对照。
 *   结论问题：**现有回测结论对滑点假设是否稳健**——若 annual/maxDd 在千3 悲观档下
 *   仍同号同量级 → 结论稳健；若翻负 → 打板类策略不可用当前参数外推。
 * 不做什么：不改 backtest.js、不切默认口径（V52_PARAMS.slip=0.0002 语义不变）；
 *   容量校验在当前规模（单笔 10 万 vs 成交额 1 亿+，r≈0.1%）不构成约束——核算见
 *   src/slippage_model.js 头注，v2 竞价档落地后回填。
 */
import { readFileSync } from 'node:fs';
import { decodeArchive } from '../src/lhb_codec.js';
import { BASE_PARAMS, poolBacktest, scoreWith } from '../src/backtest.js';
import { SLIP_PRESETS, dynamicSlip } from '../src/slippage_model.js';
import config from '../src/config.js';

const arch = decodeArchive(JSON.parse(readFileSync('data/archive.json', 'utf8')));
const days = (arch.all_days || []).filter((d) => d && d.trade_date && !(d.emotion && d.emotion._backfill));
if (days.length < 5) { console.error(`[slip-compare] 样本不足（${days.length}）`); process.exit(1); }

const TR = config.params.train;
const { assets: ASSETS } = config.backtest;
const TH = TR.thresholds;
const COSTS = TR.costModel;
const { maxPos, stopLoss, ddTrigger, maxPosChg } = TR.stops;
const plainW = {};
for (const [wk, pk] of Object.entries(config.factorKeyMap)) plainW[pk] = TR.weights[wk];

const factorsByDay = days.map((d) => d.emotion?.factors || {});
const scored = scoreWith(factorsByDay, plainW);
const retsByAsset = {};
for (const a of ASSETS) retsByAsset[a] = days.map((d) => { const v = d.indexes?.[a]; return Number.isFinite(v) ? v / 100 : 0; });

const pFull = { ...BASE_PARAMS, ...TH, comm: COSTS.comm, stamp: COSTS.stamp, maxPos, stopLoss, ddTrigger, maxPosChg };
const n = days.length;
const oosStart = Math.floor(n * 0.8);
const oosRets = Object.fromEntries(ASSETS.map((a) => [a, retsByAsset[a].slice(oosStart)]));
const oosScored = scored.slice(oosStart);

const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(2) + '%' : '—');
const num2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');

console.log(`══ 滑点敏感性对照（V5.2-pro 全开，${n} 交易日 ${days[0].trade_date}~${days[n - 1].trade_date}，样本外 ${n - oosStart} 天）══`);
console.log('档位           slip      年化(全/外)        maxDd(全/外)    夏普(全/外)     开仓数\n');
for (const [name, slip] of Object.entries(SLIP_PRESETS)) {
  const all = poolBacktest(scored, retsByAsset, { ...pFull, slip });
  const oos = poolBacktest(oosScored, oosRets, { ...pFull, slip });
  console.log(
    `${name.padEnd(13)} ${(slip * 1000).toFixed(1)}‰   ${pct(all.perf.annual)}/${pct(oos.perf.annual).padEnd(11)}   ` +
    `${pct(all.perf.maxDd)}/${pct(oos.perf.maxDd).padEnd(10)}  ${num2(all.perf.sharpe)}/${num2(oos.perf.sharpe).padEnd(9)}  ${all.perf.opens}`
  );
}
// 附加：动态滑点公式抽样核算（展示容量项在不同规模下的量级——证明当前规模可忽略）
console.log('\n── dynamicSlip 抽样核算（paper 层 v2 接线依据）──');
for (const [tag, buyAmt, turnover] of [['10万/1亿', 1e5, 1e8], ['50万/5000万', 5e5, 5e7], ['100万/3000万', 1e6, 3e7]]) {
  console.log(`  买入 ${tag}：r=${((buyAmt / turnover) * 100).toFixed(2)}% → slip=${dynamicSlip({ buyAmt, turnover })}`);
}
console.log(`  封单薄弱×1.5、炸板×1.2 组合上限核算：${dynamicSlip({ buyAmt: 1e5, turnover: 1e8, sealWeak: true, reopen: true })}（cap 千5）`);
