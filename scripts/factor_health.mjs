#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 因子健康度仪表（2026-11-09，外部拍板规格）
// ─────────────────────────────────────────────────────────────────────────────
// 回答「因子会衰退吗」的持续监控：alpha 序列 / alpha 胜率 / 相对基准差值，
// 历史分位动态阈值 + 三态预警（✅健康 ⚠️观察 ❌告警）+ 分 regime 基准校验。
//
// 纪律（外部拍板，写死在此）：
// 1. 系统禁止自动修改规则——本仪表**只读 + 落盘账本**，绝不写 config/params/
//    任何回测参数；报警输出仅供人工评估，重大调整必须人工评估后上线。
// 2. 独立风控兜底闸口永存——本仪表是观察哨，不是风控的替代；pi_run 各 gate、
//    双轨锚点门禁、EOD 守卫链不受本仪表影响。
// 3. 每日 EOD 跑、按自然周聚合（周一为周起点，周内滚动更新当前周截面）；
//    幂等同周覆盖；fail-open 不拦 EOD 链。
//
// 口径：
// - 策略：V5.2 生产参数（train）全档重放，等权两资产池，含 turnover 成本——
//   与 paper_dual_track A 轨同款代码路径（positions/turnoverCost）。
// - 基准：两资产等权买入持有（不择时的对照组）。
// - alpha = 策略周收益 - 基准周收益（算术差，与周报 win_rate 口径族一致）。
// - regime：classifySeries 现场口径（与日报/回测同源），周内主导标签。
//
// 三态判定（阈值来自外部拍板，改动须人工评审）：
// - ❌ 告警：连续 ≥2 周负超额  OR  8 周超额胜率 <48%  OR  4 周均值alpha 低于
//   全史 30 分位且为负（拐头向下）
// - ⚠️ 观察：胜率 48%~52%  OR  单周超额转负  OR  4 周均值低于全史 30 分位
// - ✅ 健康：最新周超额 ≥0  且  胜率 ≥52%  且  无连续负超额
// - 历史不足 8 周 → status='warming'（积累期，不判健康也不告警，只报数据）
//
// 用法：node scripts/factor_health.mjs [--json]
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import config from '../src/config.js';
import { decodeArchive } from '../src/lhb_codec.js';
import { classifySeries } from '../src/regime.js';
import { BASE_PARAMS, scoreWith, positions, turnoverCost } from '../src/backtest.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HIST = join(ROOT, 'data', 'factor_health_history.json');

// ── 全档重放（与 experiment_dual_track A 轨同款路径）──
const arch = decodeArchive(JSON.parse(readFileSync(join(ROOT, 'data', 'archive.json'), 'utf8')));
const days = (arch.all_days || []).filter((d) => d?.trade_date && !(d.emotion?._backfill));
const factorsByDay = days.map((d) => d.emotion?.factors || {});
const ASSETS = config.backtest.assets;
const rets = {};
for (const a of ASSETS) rets[a] = days.map((d) => (Number.isFinite(d.indexes?.[a]) ? d.indexes[a] / 100 : 0));
const TR = config.params.train;
const plainW = {};
for (const [wk, pk] of Object.entries(config.factorKeyMap)) plainW[pk] = TR.weights[wk];
const P = { ...BASE_PARAMS, ...TR.thresholds, ...TR.stops, ...TR.costModel };
const scores = scoreWith(factorsByDay, plainW);

const n = days.length;
const stratDaily = new Array(n).fill(0);
const posDaily = new Array(n).fill(0);
for (const a of ASSETS) {
  const pa = positions(scores, rets[a], P);
  const ca = turnoverCost(pa, P);
  for (let i = 0; i < n; i++) {
    stratDaily[i] += (rets[a][i] * pa[i] - ca[i]) / ASSETS.length;
    posDaily[i] += pa[i] / ASSETS.length;
  }
}
const mktDaily = ASSETS.map((a) => rets[a]).reduce((acc, r) => acc.map((v, i) => v + r[i] / ASSETS.length), new Array(n).fill(0));

const regimeKeys = classifySeries(days.map((d) => ({
  trade_date: d.trade_date,
  value: d.emotion ? d.emotion.value : null,
  pct_rank: d.emotion ? d.emotion.pct_rank : null,
  seal_pct: d.summary ? d.summary.seal_pct : null,
}))).map((r) => r.key);

// ── 自然周分组（周一为周起点；weekKey 共享实现见 src/factor_health.js）──
const REGIME_LABEL = { ice: '冰点', ebb: '退潮', neutral: '中性', recover: '回暖', climax: '高潮', shift: '切换期' };

const byWeek = new Map();
for (let i = 0; i < n; i++) {
  const wk = weekKey(days[i].trade_date);
  if (!byWeek.has(wk)) byWeek.set(wk, { idx: [], regimes: {} });
  const w = byWeek.get(wk);
  w.idx.push(i);
  w.regimes[regimeKeys[i]] = (w.regimes[regimeKeys[i]] || 0) + 1;
}
const weeks = [...byWeek.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([wk, w]) => {
  const cum = (arr) => arr.reduce((acc, v) => acc * (1 + v), 1) - 1;
  const strat = cum(w.idx.map((i) => stratDaily[i]));
  const mkt = cum(w.idx.map((i) => mktDaily[i]));
  const regime = Object.entries(w.regimes).sort((x, y) => y[1] - x[1])[0][0];
  return {
    week: wk,
    end: days[w.idx[w.idx.length - 1]].trade_date,
    days: w.idx.length,
    strat: +strat.toFixed(6),
    mkt: +mkt.toFixed(6),
    alpha: +(strat - mkt).toFixed(6),
    regime,
    exposure: +(w.idx.reduce((s, i) => s + posDaily[i], 0) / w.idx.length).toFixed(4),
  };
});

// ── 判定引擎（纯函数在 src/factor_health.js，零 IO 零副作用，测试直接引用）──
import { judge, regimeBreakdown, weekKey } from '../src/factor_health.js';

const verdict = judge(weeks);
const snapshot = {
  updatedAt: new Date().toISOString(),
  status: verdict.status,
  headline: verdict.headline,
  metrics: { alphaWinRate8: verdict.alphaWinRate8, negStreak: verdict.negStreak, ma4Pct: verdict.ma4Pct },
  regimeCheck: regimeBreakdown(weeks),
  weeks,
};

// ── 落盘（账本累积 + 快照覆盖）──
writeFileSync(HIST, JSON.stringify(snapshot, null, 2) + '\n');

// ── 输出（仪表只报警，绝不改规则——见文件头纪律）──
console.log(`[factor-health] ${verdict.headline}`);
console.log(`  覆盖：${weeks.length} 周（${weeks[0]?.week} ~ ${weeks[weeks.length - 1]?.week}）｜最新周（截至 ${weeks[weeks.length - 1]?.end}）`);
const lw = weeks[weeks.length - 1];
console.log(`  最新周：策略 ${(lw.strat * 100).toFixed(2)}% | 基准 ${(lw.mkt * 100).toFixed(2)}% | 超额 ${(lw.alpha * 100).toFixed(2)}% | 主导 regime=${lw.regime} | 平均仓位 ${(lw.exposure * 100).toFixed(0)}%`);
console.log('  分 regime 校验（alpha 为正 = 策略在该环境下跑赢不择时基准）:');
for (const r of snapshot.regimeCheck) {
  console.log(`    ${r.label.padEnd(3)} ${r.weeks} 周 | 平均超额 ${(r.avgAlpha * 100).toFixed(2)}% | 胜率 ${(r.winRate * 100).toFixed(0)}%`);
}
console.log('  （仪表只读只报警；规则调整须人工评估后上线——见脚本头纪律）');
if (process.argv.includes('--json')) console.log(JSON.stringify(snapshot, null, 2));
