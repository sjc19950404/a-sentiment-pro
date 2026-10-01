// 参数晋升门禁：TRAIN_PARAMS → LIVE_PARAMS 的唯一合法通道（过拟合防线 · 2026-10-02 拍板）。
//
// 用法：
//   node scripts/promote_params.mjs                                 # 检查差异 + 跑样本外 20% 门禁，出报告（不改任何文件）
//   node scripts/promote_params.mjs --apply --why "理由" [--who 名字] # 门禁通过才把 train 写入 config.js
//                                                                    #   的 LIVE_PARAMS 块 + 追加 params_changelog.json
//
// 门禁规则（「样本外 20%」，与 scripts/backtest.mjs 同一引擎同一口径，不另写第二套）：
//   · 样本 = archive 里全部**非回填**交易日（回填天只有 s_net 占位值，混入即污染）；
//   · 切分：前 80% 为样本内，最后 20% 为样本外（OOS）；
//   · live 权重与 train 权重各算一版七因子分数 → 同一引擎（poolBacktest，含成本/风控，
//     参数取各自块）→ 只在 OOS 段上比较；
//   · 通过 = train 的 rankKey（回撤↑ → 夏普↓ → 年化↓，src/backtest.js 唯一排序口径）
//     不劣于 live。劣化 → 拒绝晋升（exit 1）。
//
// 诚实披露：当前真实样本仅 33 个交易日 → OOS ≈ 6 天。门禁是**流程防线**（防止
// 「改参数只看样本内」这一行为模式），不是统计证明。报告里如实写样本量。
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../src/config.js';
import { decodeArchive } from '../src/lhb_codec.js';
import { BASE_PARAMS, scoreWith, poolBacktest, rankKey } from '../src/backtest.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const whyArg = (() => { const i = args.indexOf('--why'); return i >= 0 ? args[i + 1] : null; })();
const whoArg = (() => { const i = args.indexOf('--who'); return i >= 0 ? args[i + 1] : null; })();
const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);

// ── 1. 差异检查 ─────────────────────────────────────────────────────────────
const BLOCKS = ['weights', 'thresholds', 'stops', 'lookback', 'costModel'];
const deepEqual = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const live = config.params.live;
const train = config.params.train;
const changed = BLOCKS.filter((b) => !deepEqual(live[b], train[b]));

if (!changed.length) {
  console.log('[promote] train 与 live 完全一致，无需晋升。');
  console.log('          要实验：改 config.js 的 TRAIN_PARAMS → 重跑本脚本。');
  process.exit(0);
}
console.log(`[promote] 检测到实验参数差异（${changed.length} 块）：${changed.join(' / ')}`);

// ── 2. 样本外 20% 门禁（与 backtest.mjs 同一数据口径）────────────────────────
const arch = decodeArchive(JSON.parse(readFileSync(path.join(ROOT, 'data', 'archive.json'), 'utf8')));
// 剔除回填天：只有 s_net 占位值不是综合分，混入会让每个指标都错且错得平滑（同 backtest.mjs 注）
const days = (arch.all_days || []).filter((d) => d && d.trade_date && !(d.emotion && d.emotion._backfill));
if (days.length < 10) {
  console.error(`[promote] 真实样本不足（${days.length} 天 < 10），无法跑样本外门禁 —— 拒绝盲晋升。`);
  process.exit(1);
}
const n = days.length;
const oosStart = Math.floor(n * 0.8); // 最后 20% 为样本外
const factorsByDay = days.map((d) => d.emotion?.factors || {});
const dates = days.map((d) => d.trade_date);
const ASSETS = config.backtest.assets;
const retsByAsset = {};
for (const a of ASSETS) {
  retsByAsset[a] = days.map((d) => {
    const v = d.indexes?.[a];
    return Number.isFinite(v) ? v / 100 : 0; // 存档为百分比 → 小数收益
  });
}

const evalOnOOS = (pBlock) => {
  // 权重带档位后缀（s_net20）→ 存档因子键（s_net），与 backtest.mjs 的 plainW 同口径
  const plainW = {};
  for (const [wk, pk] of Object.entries(config.factorKeyMap)) plainW[pk] = pBlock.weights[wk];
  const scores = scoreWith(factorsByDay, plainW);
  const p = {
    ...BASE_PARAMS,
    ...pBlock.thresholds,
    maxPos: pBlock.stops.maxPos, stopLoss: pBlock.stops.stopLoss,
    ddTrigger: pBlock.stops.ddTrigger, maxPosChg: pBlock.stops.maxPosChg,
    ...pBlock.costModel,
  };
  const oosRets = Object.fromEntries(ASSETS.map((a) => [a, retsByAsset[a].slice(oosStart)]));
  const m = poolBacktest(scores.slice(oosStart), oosRets, p);
  return { metrics: m, rank: rankKey(m) };
};

const liveRes = evalOnOOS(live);
const trainRes = evalOnOOS(train);
// rankKey = [maxDd, -sharpe, -annual]（升序更优，与 src/backtest.js sortByRank 同语义）：
// 「train 不劣于 live」= 字典序 train ≤ live（首个差异分量上 train 更优，或完全相等）
const lexCompare = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-12) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
};
const pass = lexCompare(trainRes.rank, liveRes.rank) <= 0;

console.log('\n── 样本外 20% 门禁（同 backtest.mjs 引擎/口径）─────────────────');
console.log(`样本: ${n} 个真实交易日 | 样本外: ${n - oosStart} 天（${dates[oosStart]} ~ ${dates[n - 1]}）`);
console.log(`live  : 回撤 ${r4(liveRes.metrics.maxDd)} | 夏普 ${liveRes.metrics.sharpe?.toFixed(3)} | 年化 ${r4(liveRes.metrics.annual)}`);
console.log(`train : 回撤 ${r4(trainRes.metrics.maxDd)} | 夏普 ${trainRes.metrics.sharpe?.toFixed(3)} | 年化 ${r4(trainRes.metrics.annual)}`);
console.log(`结论  : ${pass ? '通过（train 样本外不劣于 live）' : '拒绝（train 样本外劣化 —— 过拟合嫌疑，不许晋升）'}`);
if (n < 60) console.log(`⚠ 样本仅 ${n} 天（OOS ${n - oosStart} 天）：门禁是流程防线，不构成统计证明。`);

// ── 3. 报告落盘（晋升证据链）───────────────────────────────────────────────
const report = {
  at: new Date().toISOString(),
  changedBlocks: changed,
  sample: { realDays: n, oosDays: n - oosStart, oosRange: [dates[oosStart], dates[n - 1]], excludedBackfillDays: (arch.all_days || []).length - n },
  oos: {
    live: { maxDd: r4(liveRes.metrics.maxDd), sharpe: Math.round((liveRes.metrics.sharpe || 0) * 1000) / 1000, annual: r4(liveRes.metrics.annual) },
    train: { maxDd: r4(trainRes.metrics.maxDd), sharpe: Math.round((trainRes.metrics.sharpe || 0) * 1000) / 1000, annual: r4(trainRes.metrics.annual) },
  },
  rankKey: { live: liveRes.rank, train: trainRes.rank },
  pass,
  applied: false,
  disclaimer: '历史回测 ≠ 未来；样本外 20% 门禁为流程防线（防只看样本内调参），非统计证明。',
};
writeFileSync(path.join(ROOT, 'data', 'params_promotion_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`\n报告已写入 data/params_promotion_report.json`);

// ── 4. --apply：过门禁才执行晋升（机器重写 LIVE_PARAMS + 追加 changelog）───
if (!APPLY) {
  console.log('检查模式（未改任何文件）。通过后执行：node scripts/promote_params.mjs --apply --why "..."');
  process.exit(pass ? 0 : 1);
}
if (!pass) {
  console.error('[promote] 门禁未通过，拒绝晋升（--apply 无效）。');
  process.exit(1);
}
if (!whyArg || !whyArg.trim()) {
  console.error('[promote] --apply 必须带 --why "<改动理由>"（changelog 留痕纪律：who/when/why 缺一不可）。');
  process.exit(1);
}

// 4a. 机器重写 config.js 的 PROMOTE-MANAGED 块（train 五块 → LIVE_PARAMS）
const cfgPath = path.join(ROOT, 'src', 'config.js');
const src = readFileSync(cfgPath, 'utf8');
const BEGIN = '// ── [PROMOTE-MANAGED:BEGIN]';
const END = '// ── [PROMOTE-MANAGED:END]';
const bIdx = src.indexOf(BEGIN);
const eIdx = src.indexOf(END);
if (bIdx < 0 || eIdx < 0 || eIdx < bIdx) {
  console.error('[promote] config.js 中找不到 PROMOTE-MANAGED 标记块 —— 拒绝改写（防误伤）。');
  process.exit(1);
}
const trainSnapshot = Object.fromEntries(BLOCKS.map((b) => [b, JSON.parse(JSON.stringify(train[b]))]));
const newBlock = `${BEGIN} ──────────────────────────────────────────────\n`
  + `  // 本块由 scripts/promote_params.mjs --apply 机器重写：值必须与 params_changelog.json\n`
  + `  // 最后一条 entry.liveAfter 逐位相等（守卫测试锁定）。手工编辑 = 违规。\n`
  + `  const LIVE_PARAMS = ${JSON.stringify(trainSnapshot, null, 2)};\n`
  + `  ${END} ────────────────────────────────────────────────`;
const next = src.slice(0, bIdx) + newBlock + src.slice(eIdx + END.length);
writeFileSync(cfgPath, next, 'utf8');

// 4b. 追加 changelog entry（含 liveAfter 快照与门禁证据）
const logPath = path.join(ROOT, 'params_changelog.json');
const log = JSON.parse(readFileSync(logPath, 'utf8'));
let who = whoArg;
if (!who) {
  try { who = execSync('git config user.name').toString().trim() || 'unspecified'; }
  catch { who = 'unspecified'; }
}
log.entries.push({
  at: new Date().toISOString(),
  who,
  what: `晋升实验参数（${changed.join(' / ')}）：TRAIN_PARAMS → LIVE_PARAMS`,
  why: whyArg.trim(),
  validation: {
    type: 'oos-20pct', pass: true, oosDays: n - oosStart,
    oosRange: [dates[oosStart], dates[n - 1]],
    live: report.oos.live, train: report.oos.train,
    report: 'data/params_promotion_report.json',
  },
  liveAfter: trainSnapshot,
});
writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n', 'utf8');

console.log(`\n[promote] ✅ 晋升完成：LIVE_PARAMS 已更新（${changed.join(' / ')}）`);
console.log('          params_changelog.json 已追加记录。');
console.log('          下一步：node --test 全量回归（golden/lineage/governance 守卫都过才算数）。');
report.applied = true;
writeFileSync(path.join(ROOT, 'data', 'params_promotion_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
process.exit(0);
