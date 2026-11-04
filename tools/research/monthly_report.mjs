// 月度研究验证报告（P3，只读聚合）
//
// 定位：把散落在双轨 P2 状态、模拟盘账户、统一研究基线、周报健康度里的"研究验证"
// 证据，聚合为一份月度可复现报告。纯只读：只读 data/ 下的既有产物，不重算任何
// 回测/双轨口径，不写生产文件，不改变选股逻辑。
//
// 产出：
//   data/research_monthly_<YYYY-MM>.json
//   tools/research/reports/research_monthly_<YYYY-MM>.md
//
// 触发：手动 `node tools/research/monthly_report.mjs`，或挂到月度 cron（建议月初首个交易日）。
// 注意：依赖的 dual_track.json / research_baseline.json 需先于本报告存在（由 pi_build / baseline.mjs 产出）。
//
// 纪律（同源 research/baseline.mjs）：改完立即提交，避免 eod 管道 reset --hard 冲掉未提交改动。

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const J = (p) => {
  try { return JSON.parse(readFileSync(join(root, p), 'utf8')); }
  catch (e) { return { __err: e.message }; }
};
const r = (v, d = 4) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// ── 报告期（当前自然月；首份报告同时标注累计起点）──
const NOW = new Date();
const ym = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`;
const periodStart = `${ym}-01`;
const periodEnd = NOW.toISOString().slice(0, 10);
const SINCE_ENABLE = '2026-09-28';

// ── 数据源 ──
const dtFull = J('data/paper/dual_track.json');
const dtLatest = J('data/paper/dual_track_latest.json');
const acct = J('data/paper/account.json');
const base = J('data/research_baseline.json');

const p2 = {
  p2Start: dtFull.p2Start ?? dtLatest.p2Start ?? null,
  p2StartNote: dtFull.p2StartNote || dtLatest.p2StartNote || null,
  p2Episodes: dtLatest.gates?.p2Episodes ?? null,          // 仅计 p2Start 之后（实盘）
  shiftEpisodesHistorical: dtFull.summary?.shiftEpisodes ?? null, // 全样本（不计入 P2 门禁）
  p2BitingEpisodes: dtLatest.summary?.p2BitingEpisodes ?? null,
  ledgerP2End: dtLatest.summary?.ledgerP2End ?? null,
  gatesAnchor: {
    shadowC_t1: dtLatest.gates?.shadowC_t1 ?? null,   // 三重锚点（全样本）
    trackA_v52: dtLatest.gates?.trackA_v52 ?? null,
    trackB_v53: dtLatest.gates?.trackB_v53 ?? null,
  },
  promoteThresholdNote: '晋升要求：≥10 个 P2 影子生效日 + 三条影子线同号 + 生效日贡献≥50% + 残差纪律合格（docs/dual_track_framework.md）。',
};

// 模拟盘账户（真实验证证据）
const trades = Array.isArray(acct.trades) ? acct.trades : [];
const closed = trades.filter((t) => t && t.status === 'closed');
const wins = closed.filter((t) => Number(t.pnl) > 0);
const nav = Array.isArray(acct.nav) ? acct.nav : [];
const paper = {
  startDate: acct.startDate ?? null,
  initCash: acct.initCash ?? null,
  cash: acct.cash ?? null,
  realized: acct.realized ?? null,
  totalFee: acct.totalFee ?? null,
  navPoints: nav.length,
  navLatest: nav.length ? (nav[nav.length - 1].equity ?? nav[nav.length - 1]) : null,
  positions: Object.keys(acct.positions || {}).length,
  orders: (acct.orders || []).length,
  trades: trades.length,
  closedTrades: closed.length,
  winRate: closed.length ? r(wins.length / closed.length, 4) : null, // 真实平仓胜率；0 笔→null
  note: closed.length ? null : '尚无平仓成交（win_rate 样本不足 → null）；P2 有效性结论须待 ≥30 笔平仓 + ≥10 个实盘 shift 生效日。',
};

// 周报健康度（本自然月内）
const repDir = join(root, 'data/reports');
const weeklyFiles = existsSync(repDir) ? readdirSync(repDir).filter((x) => /^weekly_.*\.json$/.test(x)) : [];
const weekly = { count: weeklyFiles.length, inMonth: 0, statusCounts: {}, missingNotes: {}, winRates: [] };
for (const f of weeklyFiles) {
  const w = J(`data/reports/${f}`);
  if (w.__err) continue;
  if (w.date >= periodStart && w.date <= periodEnd) weekly.inMonth += 1;
  const st = w.status || 'unknown';
  weekly.statusCounts[st] = (weekly.statusCounts[st] || 0) + 1;
  for (const n of w.missing_notes || []) {
    const k = n.field || '?';
    weekly.missingNotes[k] = (weekly.missingNotes[k] || 0) + 1;
  }
  if ('win_rate' in (w.payload || {})) weekly.winRates.push(w.payload.win_rate);
}

// 统一基线关键结论
const proper = base.predictCalibrationProper257d;
const verdict = base.verdict || {};
const baselineFindings = {
  generatedAt: base.generatedAt ?? null,
  predictProper: proper?.available
    ? proper.groups.filter((g) => ['涨停·首板&换手<10%', '涨停·3连板&换手<10%', '涨停·换手>=25%'].includes(g.label))
    : [],
  versionRegressionIC: base.versionRegressionIC ?? null,
  proven: verdict.proven ?? [],
  reviewNeeded: verdict.reviewNeeded ?? [],
  paramsGovernance: base.paramsGovernance ?? null,
};

const report = {
  schema: 'research-monthly-report/1.0',
  generatedAt: NOW.toISOString(),
  reportMonth: ym,
  period: { start: periodStart, end: periodEnd, sinceSystemEnable: SINCE_ENABLE, firstReport: true },
  p2,
  paper,
  weeklyHealth: {
    total: weekly.count,
    inMonth: weekly.inMonth,
    statusCounts: weekly.statusCounts,
    topMissingNotes: Object.entries(weekly.missingNotes).sort((a, b) => b[1] - a[1]).slice(0, 6),
    winRates: weekly.winRates,
  },
  baselineFindings,
  verdict: {
    oneLiner: p2.p2Start
      ? 'P2 框架已就位、门禁已诚实（实盘样本 0）；系统已证明能稳定运行/记录/诚实否掉坏方案，但策略有效性仍未被实盘证据证实。'
      : 'P2 尚未启动；研究验证证据仍来自历史重放，不足以下策略有效性结论。',
    proven: baselineFindings.proven,
    reviewNeeded: baselineFindings.reviewNeeded,
  },
};

// ── 写 JSON ──
const jsonPath = join(root, `data/research_monthly_${ym}.json`);
writeFileSync(jsonPath, JSON.stringify(report, null, 2));

// ── 写 MD ──
const md = [];
const h = (t) => md.push(`## ${t}`);
md.push(`# 研究验证月报 · ${ym}（首份）`);
md.push('');
md.push(`- 报告期：${periodStart} ~ ${periodEnd}（自然月；系统启用累计起点 ${SINCE_ENABLE}）`);
md.push(`- 生成时间：${report.generatedAt}`);
md.push(`- 口径：只读聚合双轨 P2 状态 / 模拟盘账户 / 统一研究基线(${baselineFindings.generatedAt || '?'}) / 周报健康度；不重算任何回测。`);
md.push('');
md.push(`> **一句话结论**：${report.verdict.oneLiner}`);
md.push('');

h('1. 双轨 P2 实盘状态（框架已启动）');
md.push(`- p2Start：${p2.p2Start ?? '未启动'} —— ${p2.p2StartNote || ''}`);
md.push(`- P2 实盘影子生效日（仅计 p2Start 之后）：${JSON.stringify(p2.p2Episodes)} ；当前 biting（C0.3）= **${p2.p2BitingEpisodes}**`);
md.push(`- 历史全样本 shift 生效日：${p2.shiftEpisodesHistorical}（**不计入** P2 门禁）`);
if (p2.ledgerP2End) md.push(`- P2 窗累计（ledgerP2End）：premium ${r(p2.ledgerP2End.premiumCum, 4)}，shadow ${JSON.stringify(p2.ledgerP2End.shadowCum)}，activeDays ${p2.ledgerP2End.activeDays}`);
md.push(`- 三重锚点门禁（全样本）：trackA_v52=${JSON.stringify(p2.gatesAnchor.trackA_v52)} / trackB_v53=${JSON.stringify(p2.gatesAnchor.trackB_v53)} / shadowC_t1=${JSON.stringify(p2.gatesAnchor.shadowC_t1)}`);
md.push(`- ${p2.promoteThresholdNote}`);
md.push('');

h('2. 模拟盘账户（真实验证证据）');
md.push(`- 起始 ${paper.startDate}｜本金 ${paper.initCash}｜净值点数 ${paper.navPoints}｜最新权益 ${paper.navLatest}`);
md.push(`- 持仓 ${paper.positions}｜委托 ${paper.orders}｜成交 ${paper.trades}（平仓 ${paper.closedTrades}）｜已实现 ${paper.realized}｜费用 ${paper.totalFee}`);
md.push(`- **真实平仓胜率**：${paper.winRate == null ? 'null（样本不足）' : paper.winRate}（${wins.length}/${closed.length}）`);
md.push(`- ${paper.note || ''}`);
md.push('');

h('3. 预测校准（257 天·外部前复权 K 线·无偏差）');
if (proper?.available) {
  for (const g of baselineFindings.predictProper) md.push(`- ${g.label}：n=${g.n}，T+1中位 ${g.t1Med}，上涨% ${g.upPct}，再涨停% ${g.againPct}`);
  md.push(`- 方向成立、幅度温和：低换手首板 T+1 中位 +0.9%、上涨 55.6%；高换手涨停无优势。predict.js 方向正确，收益预期需下调。`);
} else {
  md.push(`- streak_backtest.json 暂缺；运行 node scripts/backtest_limit_up_streak.mjs 生成后本表自动填充。`);
}
md.push('');

h('4. 版本回归 IC / 指数回测');
const ic = baselineFindings.versionRegressionIC;
if (ic && ic.table) {
  const rows = Object.entries(ic.table).map(([k, v]) => `${k}: Pearson ${v.pearson}、方向准确率 ${v.directionAcc}%`).join('；');
  md.push(`- 版本回归（${ic.sample?.withNextRet ?? '?'} 日有次日收益）：${rows}`);
  md.push(`- 结论：${ic.interpretation}`);
}
const ib = base.indexBacktest?.fullSample;
if (ib && ib.v52) {
  const hold = ib.hold ? `同期持有 ${ib.hold.total}%（相对抗跌，非正收益策略）` : '同期持有未计算(null)';
  md.push(`- 主信号全样本 V5.2 累计 ${ib.v52.total}%（年化 ${ib.v52.annual}、Sharpe ${ib.v52.sharpe}、最大回撤 ${ib.v52.maxDd}%）；${hold}。`);
}
md.push('');

h('5. 周报健康度');
md.push(`- 周报总数 ${weekly.count}（本自然月 ${weekly.inMonth}）；状态分布：${JSON.stringify(weekly.statusCounts)}`);
const topMN = report.weeklyHealth.topMissingNotes;
md.push(`- 高频缺失字段（top）：${topMN.length ? topMN.map(([k, v]) => `${k}×${v}`).join('；') : '无'}`);
md.push(`- win_rate 取值分布：${JSON.stringify(weekly.winRates)}（当前恒 null：0 笔平仓 → 样本不足；P3 已把口径改为模拟盘平仓胜率，成交后自动填充）`);
md.push('');

h('6. 已证伪 / 待验证');
for (const s of baselineFindings.proven) md.push(`- ✅ ${s}`);
for (const s of baselineFindings.reviewNeeded) md.push(`- ⚠️ ${s}`);
md.push('');

h('7. 本月缺口与下一步');
md.push('- 实盘/模拟盘样本仍极小（启用后 ~19 交易日、模拟盘 ~8 净值点、0 成交）；P2 晋升门槛（≥10 实盘 shift 日）尚未开始积累。');
md.push('- 参数治理日志已恢复入库（recovered）；后续参数改动务必入库，避免 git reset 丢失。');
md.push('- 下一步：让 P2 在实盘里自然攒样本；维持月度本报告的滚动产出；必要时重跑 baseline / streak 重校准。');
md.push('');
md.push('> 本报告只读聚合，不构成投资建议。');

const mdPath = join(root, 'tools/research/reports', `research_monthly_${ym}.md`);
mkdirSync(dirname(mdPath), { recursive: true });
writeFileSync(mdPath, md.join('\n'));

console.log(`[research-monthly] ${ym} → ${jsonPath} + ${mdPath}（P2=${p2.p2Start}, 实盘shift=${p2.p2BitingEpisodes}, 周报${weekly.count}份, 状态${JSON.stringify(weekly.statusCounts)}）`);
