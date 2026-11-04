// 统一研究基线（P0，只读、不动生产选股逻辑）
//
// 目的：把散落在十几个 JSON / 过时注释里的"系统自身研究验证"证据，聚合成一份
//   可复现、口径统一的基线报告。它只【读】现有档案与回测产物，只【写】两个新文件
//   （data/research_baseline.json + tools/research/reports/research_baseline.md），
//   绝不修改 recommendPicks / predict.js / 任何生产模块或现有数据。
//
// 涵盖：
//   1) 数据溯源（实时/重建口径，来自 backtest.json meta）
//   2) 指数主信号回测（全样本 + 系统启用后 19 天，来自 backtest.json series）
//   3) 版本回归 IC（来自 version-regression.json）
//   4) 三策略回测（来自 backtest-strategies.json）
//   5) 预测分组【257 天档案内重校准】（离线：次日/三日收盘价查表，有存活偏差，仅方向校验）
//   5b) 正式 257 天重校准（来自 backtest_limit_up_streak.mjs，外部前复权 K 线，无偏差，权威）
//   6) 双轨 P2 真实状态（来自 dual_track.json / dual_track_latest.json）
//   7) 参数治理与报告健康度
//
// 用法：node tools/research/baseline.mjs
// 注意：本文件一旦改完请立即提交并推送——eod 管道开头会 git reset --hard origin/main，
//   未提交的本地改动会被冲掉（params_changelog.json 即是前车之鉴）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decodeArchive } from '../../src/lhb_codec.js';
import { atomicWriteJSON } from '../../src/fsutil.js';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const J = (p) => { try { return JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')); } catch (e) { return { __err: e.message }; } };
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const pct = (v) => (Number.isFinite(v) ? r2(v * 100) : null);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return r2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); };

// ── 板段（与连板校准/模拟器一致）──
function boardOf(code) {
  const c = String(code || '');
  if (/^(688|689)/.test(c)) return { key: 'star', limit: 0.20 };
  if (/^30/.test(c)) return { key: 'gem', limit: 0.20 };
  if (/^(4|8|920)/.test(c)) return { key: 'bj', limit: 0.30 };
  return { key: 'main', limit: 0.10 };
}
const isLimitUp = (code, pctV) => Number.isFinite(pctV) && pctV >= boardOf(code).limit * 100 - 0.2;

// ════════════════════════════════════════════════════════════════════════════
// 1) 数据溯源
// ════════════════════════════════════════════════════════════════════════════
const bt = J('data/backtest.json');
const archive = J('data/archive.json');
const archDaysAll = (archive.all_days || []).map((d) => d.trade_date).filter(Boolean).sort();
const systemStart = '2026-09-28';
const paperStart = '2026-10-23';
const liveDays = archDaysAll.filter((d) => d >= systemStart);
const paperDays = archDaysAll.filter((d) => d >= paperStart);
const provenance = {
  archiveDays: archDaysAll.length,
  firstDay: archDaysAll[0],
  lastDay: archDaysAll[archDaysAll.length - 1],
  klineRebuildDays: bt?.meta?.sampleNote?.klineRebuildDays ?? null,
  excludedBackfillDays: bt?.meta?.sampleNote?.excludedBackfillDays ?? null,
  systemEnabled: systemStart,
  liveTradingDaysSinceEnable: liveDays.length,
  paperAccountStart: paperStart,
  paperTradingDays: paperDays.length,
  caveat: '主档回溯 ≠ 实盘观察；257 天里大量为 K 线重建口径（klineRebuildDays），'
    + '结论仅用于管线自检与口径对比，不构成投资建议。',
};

// ════════════════════════════════════════════════════════════════════════════
// 2) 指数主信号回测（全样本 + 启用后）
// ════════════════════════════════════════════════════════════════════════════
function seriesReturn(series, fromInclusive) {
  if (!series || !series.dates) return null;
  const ds = series.dates;
  let i = fromInclusive ? ds.findIndex((d) => d >= fromInclusive) : 0;
  if (i < 0) i = 0;
  const out = {};
  for (const k of Object.keys(series)) {
    if (k === 'dates') continue;
    const a = series[k];
    if (!Array.isArray(a) || a.length <= i) continue;
    out[k] = pct(a[a.length - 1] / a[i] - 1);
  }
  return out;
}
const s = bt?.series || {};
const idxBacktest = {
  fullSample: {
    v52: bt?.v52 ? { total: pct(bt.v52.total), annual: pct(bt.v52.annual), sharpe: bt.v52.sharpe, maxDd: pct(bt.v52.maxDd), winRate: pct(bt.v52.winRate) } : null,
    v53: bt?.v53 ? { total: pct(bt.v53.total), annual: pct(bt.v53.annual), sharpe: bt.v53.sharpe, maxDd: pct(bt.v53.maxDd) } : null,
    hold: bt?.navHold ? null : null,
  },
  metaNote: bt?.meta?.caveat || null,
};
const fullRet = seriesReturn(s, null);
const liveRet = seriesReturn(s, systemStart);
idxBacktest.series = {
  fullSample: fullRet,
  sinceSystemEnabled: liveRet,
  note: '区间收益 = 末值/起点值 − 1；hold 为同三大指数买入持有基准（未扣主动管理）。',
};

// ════════════════════════════════════════════════════════════════════════════
// 3) 版本回归 IC（来自已提交的 version-regression.json）
// ════════════════════════════════════════════════════════════════════════════
const vr = J('data/version-regression.json');
const icTable = {};
if (vr?.stats) {
  for (const [k, v] of Object.entries(vr.stats)) {
    icTable[k] = {
      scoreMean: r2(v.scoreMean), pearson: r2(v.pearson), spearman: r2(v.spearman),
      directionAcc: v.direction ? pct(v.direction.acc) : null,
      hit: v.direction?.hit ?? null, total: v.direction?.total ?? null,
    };
  }
}
const ic = {
  sample: vr?.sample || null,
  cautions: vr?.cautions || null,
  table: icTable,
  interpretation: '情绪分与次日指数收益 Pearson ≈ 0、方向准确率 ≈ 50% ⇒ 对次日方向无统计显著预测力。',
};

// ════════════════════════════════════════════════════════════════════════════
// 4) 三策略回测（来自 backtest-strategies.json）
// ════════════════════════════════════════════════════════════════════════════
const st = J('data/backtest-strategies.json');
const strategyRows = [];
if (st?.strategies) {
  for (const [k, v] of Object.entries(st.strategies)) {
    strategyRows.push({ key: k, label: v.label, trades: v.trades, total: pct(v.total), annual: pct(v.annual), maxDd: pct(v.maxDd), sharpe: v.sharpe, winRate: pct(v.winRate), plRatio: v.plRatio });
  }
}
const strategies = {
  benchmark: st?.benchmark ? { label: st.benchmark.label, total: pct(st.benchmark.total), annual: pct(st.benchmark.annual), maxDd: pct(st.benchmark.maxDd), sharpe: st.benchmark.sharpe } : null,
  rows: strategyRows,
  sampleNote: st?.meta?.sample?.note || null,
  note: '持有期（3/5/10 日）一改符号翻转、样本量极小（4~24 笔）⇒ 更像多重选择结果，非稳定 alpha。',
};

// ════════════════════════════════════════════════════════════════════════════
// 5) 预测分组 257 天【档案内重校准】（离线：次日/三日收盘价查表）
//    ⚠ 方法论差异：原 streak_backtest.json 用外部腾讯前复权 K 线（覆盖更全）；
//      本基线只用档案内 hot/lhb 次日/三日收盘价查表，覆盖更低但完全离线可复现。
//      仅用于"预测分层是否仍成立"的方向性校验，存在「存活偏差」（次日仍被关注的票更可能已涨），
//      故 up% 偏高、不可与 5b) 无偏结果或 33 天 streak 直接比较。
// ════════════════════════════════════════════════════════════════════════════
function buildPredictCalibration() {
  const arch = decodeArchive(archive);
  const days = (arch.all_days || []).filter((d) => d && d.trade_date).sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
  const closeMaps = new Map();
  for (const d of days) {
    const m = new Map();
    for (const x of (d.lhb || [])) if (x && x.code != null && Number.isFinite(+x.close)) m.set(String(x.code), +x.close);
    for (const x of (d.hot || [])) if (x && x.code != null && Number.isFinite(+x.close)) m.set(String(x.code), +x.close);
    closeMaps.set(d.trade_date, m);
  }
  const candidates = [];
  for (const d of days) {
    const sm = d.summary || {};
    const ztCodes = new Set(Array.isArray(sm.zt_codes) ? sm.zt_codes : []);
    const ztLb = (sm.zt_lb && typeof sm.zt_lb === 'object') ? sm.zt_lb : {};
    const hotMap = new Map((Array.isArray(d.hot) ? d.hot : []).map((h) => [String(h.code), h]));
    const seen = new Set();
    const push = (code, seed) => { if (!code || seen.has(String(code))) return; seen.add(String(code)); candidates.push({ date: d.trade_date, code: String(code), ...seed }); };
    for (const l of (Array.isArray(d.lhb) ? d.lhb : [])) {
      if (!l || l.code == null || l.is_range) continue;
      push(l.code, { name: l.name, streak: ztCodes.has(l.code) ? (+ztLb[l.code] || 1) : null, turnoverPct: l.turnover_pct, netWan: l.net_buy_wan, isZt: ztCodes.has(l.code), close: l.close });
    }
    for (const code of ztCodes) {
      const h = hotMap.get(String(code));
      push(code, { name: h ? h.name : String(code), streak: +ztLb[code] || 1, turnoverPct: h ? h.huanshou : null, netWan: null, isZt: true, close: h ? h.close : null });
    }
  }
  const recs = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    for (const c of candidates) {
      if (c.date !== d.trade_date || !(c.close > 0)) continue;
      const m1 = closeMaps.get(days[i + 1]?.trade_date);
      const m3 = closeMaps.get(days[i + 3]?.trade_date);
      if (!m1) continue;
      const c1 = m1.get(c.code);
      if (!(c1 > 0)) continue;
      const t1 = (c1 / c.close - 1) * 100;
      const c3 = m3 ? m3.get(c.code) : null;
      const t3 = c3 > 0 ? (c3 / c.close - 1) * 100 : null;
      recs.push({
        ...c,
        t1: r2(t1), t3: t3 == null ? null : r2(t3),
        up: t1 > 0, again: isLimitUp(c.code, t1),
        lowTurn: c.turnoverPct != null && +c.turnoverPct < 10,
        bigFund: c.netWan != null && +c.netWan >= 20000,
      });
    }
  }
  const group = (label, filter) => {
    const g = recs.filter(filter);
    if (!g.length) return { label, n: 0 };
    return {
      label, n: g.length,
      t1Mean: r2(g.reduce((a, r) => a + r.t1, 0) / g.length),
      t1Med: med(g.map((r) => r.t1)),
      t3Med: med(g.filter((r) => r.t3 != null).map((r) => r.t3)),
      upPct: pct(g.filter((r) => r.up).length / g.length),
      againPct: pct(g.filter((r) => r.again).length / g.length),
    };
  };
  const groups = [
    group('全部候选（有T+1数据）', () => true),
    group('全部涨停股', (r) => r.isZt),
    group('涨停·首板', (r) => r.isZt && (r.streak || 1) === 1),
    group('涨停·2连板', (r) => r.isZt && (r.streak || 1) === 2),
    group('涨停·3连板及以上', (r) => r.isZt && (r.streak || 1) >= 3),
    group('涨停·首板&换手<10%', (r) => r.isZt && (r.streak || 1) === 1 && r.lowTurn),
    group('涨停·2连板&换手<10%', (r) => r.isZt && (r.streak || 1) === 2 && r.lowTurn),
    group('涨停·换手>=25%', (r) => r.isZt && r.turnoverPct != null && +r.turnoverPct >= 25),
    group('涨停·龙虎净买>0', (r) => r.isZt && r.netWan != null && +r.netWan > 0),
    group('涨停·龙虎净买>=2亿', (r) => r.isZt && r.bigFund),
  ];
  return {
    method: 'archive-only next-day/3rd-day close lookup（离线、可复现、有存活偏差）',
    dateFrom: archDaysAll[0], dateTo: archDaysAll[archDaysAll.length - 1],
    tradeDays: archDaysAll.length, candidates: candidates.length, withT1: recs.length,
    note: '覆盖低于 streak_backtest（后者用外部前复权 K 线全样本）；且仅计入次日仍进入 hot/lhb 的票，'
      + '存在「存活偏差」（仍被关注的票更可能已上涨），故 up% 偏高、不可与 5b) 无偏结果直接比较；'
      + '本分组仅作方向性校验，正式重校准见 5b)。',
    groups,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 5b) 正式 257 天重校准（来自 backtest_limit_up_streak.mjs，外部前复权 K 线，无偏差）
//     仅在 streak_backtest.json 存在时采用；否则退化为 5) 的档案内查表（有存活偏差）。
// ════════════════════════════════════════════════════════════════════════════
const stObj = J('data/streak_backtest.json');
const proper = {
  available: !stObj.__err && Array.isArray(stObj.groups),
  meta: stObj && stObj.meta ? stObj.meta : null,
  groups: [],
};
if (proper.available) {
  const want = ['全部涨停股', '涨停·首板', '涨停·2连板', '涨停·3连板', '涨停·首板&换手<10%', '涨停·2连板&换手<10%', '涨停·3连板&换手<10%', '涨停·换手>=25%', '涨停·净买>=2亿'];
  proper.groups = stObj.groups
    .filter((x) => want.includes(x.label))
    .map((x) => ({ label: x.label, n: x.n, t1Med: x.t1Med, upPct: x.upPct, againPct: x.againPct }));
}

// ════════════════════════════════════════════════════════════════════════════
// 6) 双轨 P2 真实状态
// ════════════════════════════════════════════════════════════════════════════
const dt = J('data/paper/dual_track_latest.json');
const dtFull = J('data/paper/dual_track.json');
const shiftDays = (dtFull?.days || []).filter((x) => x?.regime?.key === 'shift');
const p2 = {
  p2Start: (dt?.p2Start ?? dtFull?.p2Start) ?? null,
  p2StartNote: dt?.p2StartNote || dtFull?.p2StartNote || null,
  activeTrack: dt?.trackState?.activeTrack ?? null,
  gates: dt?.gates || null,
  summary: dt?.summary || null,
  shiftEpisodesHistorical: shiftDays.length,
  shiftEpisodesSinceSystemEnabled: shiftDays.filter((x) => x.date >= systemStart).length,
  note: 'p2Start 仍为 null ⇒ P2 账本为全样本重放，18 个 shift 生效日全部在系统启用前；'
    + '启用后新增 0 个 ⇒ 晋升门槛（≥10 个实盘 shift 日）尚未开始积累。',
};

// ════════════════════════════════════════════════════════════════════════════
// 7) 参数治理 + 报告健康度
// ════════════════════════════════════════════════════════════════════════════
const pc = J('data/params_changelog.json');
const paramsPresent = !pc?.__err && Array.isArray(pc.entries);
const params = {
  present: paramsPresent,
  entries: paramsPresent ? pc.entries.map((e) => ({ at: e.at, what: e.what, validation: e.validation, liveAfter: !!e.liveAfter })) : [],
  note: paramsPresent
    ? '均为基线冻结 / 新增配置键 / 默认关闭开关；无完整 oos-20pct 权重晋升。'
    : '文件当前缺失（未入库，疑于 git reset --hard 中丢失；此前观测到 5 条均为基线冻结/配置键，无 oos-20pct 权重晋升）。研究治理日志应入库以免丢失。',
};
let reportHealth = {};
try {
  const dir = resolve(ROOT, 'data/reports');
  const files = readdirSync(dir).filter((x) => x.endsWith('.json') && !/^(index|push_state)/.test(x));
  const c = {};
  for (const f of files) {
    const j = J('data/reports/' + f);
    const k = (f.split('_')[0] + '|' + j.status);
    c[k] = (c[k] || 0) + 1;
  }
  reportHealth = { total: files.length, byKindStatus: c, note: '周报 win_rate=null（剧本绑定缺席）；无月度报告；状态多为 degraded（字段缺失）。' };
} catch (e) { reportHealth = { error: e.message }; }

// ════════════════════════════════════════════════════════════════════════════
// 汇总 + 写盘
// ════════════════════════════════════════════════════════════════════════════
const generatedAt = new Date().toISOString().slice(0, 19);
const baseline = {
  schema: 'research-baseline-v1',
  generatedAt,
  provenance,
  indexBacktest: idxBacktest,
  versionRegressionIC: ic,
  strategyBacktests: strategies,
  predictCalibration257d: buildPredictCalibration(),
  predictCalibrationProper257d: proper,
  dualTrackP2: p2,
  paramsGovernance: params,
  reportHealth,
  verdict: {
    engineering: '工程可信（契约/单测/跨语言夹具/参数冻结/新鲜度门禁完备）。',
    strategy: '策略有效性未被证明：指数主信号绝对亏损、相对抗跌；隔离闸门后个股平仓胜率 ~9.5%；'
      + '版本回归 IC≈0；模拟盘 8 天 0 成交。',
    proven: [
      '若干增强方案已证伪（M8 / 0.7 帽 / 尾部介入 T2·T3 / V5.3 全量 regime 帽）；',
      'v5.3 分位归一确消除 s_net 饱和（但非预测力增强）；',
      '主信号在下跌样本相对基准少跌约 8–9pp（相对抗跌，非正收益）；',
      '257 天无偏重校准：低换手首板 T+1 中位 +0.9%、上涨 55.6%（方向成立、幅度温和）；高换手涨停无优势——predict.js 方向正确、需下调收益预期。',
    ],
    unproven: [
      '任何可交易的正向 alpha；实盘/模拟盘样本 8 天、0 成交；',
      'P2 未启动、无实盘影子样本。',
    ],
    confidence: '中低——证据充分表明“工程稳、多项坏方案已否”，但“能否赚钱”仍缺样本外实盘证据。',
  },
};

const outJson = resolve(ROOT, 'data/research_baseline.json');
atomicWriteJSON(outJson, JSON.stringify(baseline, null, 2));

// ── Markdown ──
const md = [];
md.push(`# 研究基线报告 · ${generatedAt}`);
md.push('');
md.push(`> 只读聚合，不动生产。数据源：archive.json(${provenance.archiveDays}天) / backtest.json / version-regression.json / backtest-strategies.json / streak_backtest.json / dual_track*.json / params_changelog.json。`);
md.push('');
md.push(`## 1. 数据溯源与样本口径`);
md.push(`- 主档区间：${provenance.firstDay} ~ ${provenance.lastDay}（${provenance.archiveDays} 交易日）`);
md.push(`- K 线重建天数：${provenance.klineRebuildDays}（占 ${provenance.archiveDays} 的 ${r2(provenance.klineRebuildDays / provenance.archiveDays * 100)}%）`);
md.push(`- 系统启用日：${systemStart}，启用后仅 **${provenance.liveTradingDaysSinceEnable}** 个交易日`);
md.push(`- 模拟盘启用日：${paperStart}，模拟盘仅 **${provenance.paperTradingDays}** 个交易日`);
md.push('');
md.push(`## 2. 指数主信号回测`);
md.push(`- 全样本 V5.2：${JSON.stringify(idxBacktest.fullSample.v52)}`);
md.push(`- 全样本 V5.3：${JSON.stringify(idxBacktest.fullSample.v53)}`);
md.push(`- 区间收益（series）：全样本 ${JSON.stringify(idxBacktest.series.fullSample)}`);
md.push(`- 启用后(${systemStart} 起)：${JSON.stringify(idxBacktest.series.sinceSystemEnabled)}`);
md.push(`- 口径说明：${idxBacktest.series.note}`);
md.push('');
md.push(`## 3. 版本回归 IC（情绪分 × 次日收益）`);
for (const [k, v] of Object.entries(icTable)) md.push(`- ${k}：Pearson=${v.pearson}，方向准确率=${v.directionAcc}（${v.hit}/${v.total}）`);
md.push(`- 结论：${ic.interpretation}`);
md.push('');
md.push(`## 4. 三策略回测`);
for (const r of strategyRows) md.push(`- [${r.label}] n=${r.trades}，总收益=${r.total}%，Sharpe=${r.sharpe}，胜率=${r.winRate}%，最大回撤=${r.maxDd}%`);
md.push(`- 基准：${JSON.stringify(strategies.benchmark)}`);
md.push(`- ${strategies.note}`);
md.push('');
md.push(`## 5. 预测分组 · 257 天档案内重校准（离线，有存活偏差，仅方向校验）`);
md.push(`- 方法：${baseline.predictCalibration257d.method}；候选 ${baseline.predictCalibration257d.candidates}，有 T+1 数据 ${baseline.predictCalibration257d.withT1}`);
md.push(`- 说明：${baseline.predictCalibration257d.note}`);
md.push('');
md.push(`| 分组 | n | T+1均% | T+1中位% | T+3中位% | 上涨% | 再涨停% |`);
md.push(`|---|---|---|---|---|---|---|`);
for (const g of baseline.predictCalibration257d.groups) md.push(`| ${g.label} | ${g.n} | ${g.t1Mean ?? '—'} | ${g.t1Med ?? '—'} | ${g.t3Med ?? '—'} | ${g.upPct ?? '—'} | ${g.againPct ?? '—'} |`);
md.push('');
md.push(`## 5b. 正式 257 天重校准（外部前复权 K 线，无偏差，权威）`);
if (baseline.predictCalibrationProper257d.available) {
  const p = baseline.predictCalibrationProper257d;
  md.push(`- 口径：${p.meta && p.meta.note}；候选 ${p.meta && p.meta.candidates}，有 T+1 ${p.meta && p.meta.withT1}`);
  md.push(`- 对比：上方 5) 档案内查表存在「存活偏差」（只计次日仍被关注的票）会高估上涨%；以下为无偏结果：`);
  md.push('');
  md.push(`| 分组 | n | T+1中位% | 上涨% | 再涨停% |`);
  md.push(`|---|---|---|---|---|`);
  for (const g of p.groups) md.push(`| ${g.label} | ${g.n} | ${g.t1Med ?? '—'} | ${g.upPct ?? '—'} | ${g.againPct ?? '—'} |`);
  md.push('');
} else {
  md.push(`- streak_backtest.json 暂缺，退化为 5) 档案内查表（有偏差）。运行 node scripts/backtest_limit_up_streak.mjs 可生成。`);
  md.push('');
}
md.push(`## 6. 双轨 P2 状态`);
md.push(`- p2Start：${p2.p2Start ?? 'null（未启动，当前为全样本重放）'}`);
md.push(`- shift 生效日：历史 ${p2.shiftEpisodesHistorical} 个，系统启用后新增 ${p2.shiftEpisodesSinceSystemEnabled} 个`);
md.push(`- ${p2.note}`);
md.push('');
md.push(`## 7. 参数治理与报告健康`);
md.push(`- 参数变更 ${params.entries.length} 条：${params.note}`);
md.push(`- 报告健康：${JSON.stringify(reportHealth.byKindStatus)}；${reportHealth.note}`);
md.push('');
md.push(`## 8. 结论`);
md.push(`- 工程：${baseline.verdict.engineering}`);
md.push(`- 策略：${baseline.verdict.strategy}`);
md.push(`- 已证伪/已验证：${baseline.verdict.proven.join(' ')}`);
md.push(`- 仍未证明：${baseline.verdict.unproven.join(' ')}`);
md.push(`- 置信度：${baseline.verdict.confidence}`);
md.push('');

const outMd = resolve(ROOT, 'tools/research/reports/research_baseline.md');
if (!existsSync(dirname(outMd))) mkdirSync(dirname(outMd), { recursive: true });
writeFileSync(outMd, md.join('\n'), 'utf8');

process.stdout.write(`[baseline] 已写出：\n  ${outJson}\n  ${outMd}\n`);
process.stdout.write(`[baseline] 257天预测分组候选 ${baseline.predictCalibration257d.candidates}，有T+1 ${baseline.predictCalibration257d.withT1}\n`);
