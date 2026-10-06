// AI 报告核心测试（S1）：null 纪律 / 数字搬运 / data_completeness（决议 5）/
// 双轨合并（决议 1）/ trigger 枚举（决议 3）/ 周报胜率口径（决议 4）/
// 契约校验（schemas/ai-report.schema.json）/ 真实档冒烟（不写死数字，CI 数据更新不红）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  buildInput, generatePreMarket, generateIntraday, generatePostMarket, generateWeekly,
  mergeReports, buildDataCompleteness, TRIGGER_ENUM, DD_TIER_EDGES, SCHEMA_VERSION,
} from '../src/ai_report.js';
import { validateContract } from '../src/contract.js';

const SCHEMA = JSON.parse(readFileSync(new URL('../schemas/ai-report.schema.json', import.meta.url), 'utf8'));

// ── 迷你夹具（形态对齐真实档，数字便于手工验算）─────────────────────────
const DT = {
  day: {
    date: '2026-09-30', score: 64.41,
    regime: { key: 'recover', label: '回暖', cap: 0.5 },
    trackA: { targetPos: { '上证指数': 0.7 }, poolPos: 0.5, executed: true },
    trackB: { refPos: { '上证指数': 0.3 }, poolPos: 0.3, executed: false },
    divergence: { posGap: 0.2 },
    dayReturns: { A: 0.00017, B: -0.00013 },
  },
  summary: {
    trackA: { total: -0.015005, maxDd: 0.137886, sharpe: -0.028276 },
    trackB: { total: -0.03483, maxDd: 0.087774 },
    trackC: { '0.5': { total: 0.012027, episodes: 18 } },
    divergence: { daysGt02: 226 },
  },
  sample: { days: 241 },
};
const DAYS = [
  { date: '2026-09-28', score: 32.11, regime: { key: 'ice' }, dayReturns: { A: -0.01049 } },
  { date: '2026-09-29', score: 75.93, regime: { key: 'recover' }, dayReturns: { A: 0.000503 } },
  { date: '2026-09-30', score: 64.41, regime: { key: 'recover' }, dayReturns: { A: 0.00017 } },
];
const SIG = {
  meta: { tradeDate: '2026-09-30' },
  signals: { latestEmotion: { value: 64.4 } },
  latest: { pct_rank: 44.1, up_count: 2393, down_count: 2730, flat_count: 167, amount_yi: 14380.2, zt_count: 52, dt_count: 9, indexes: { '上证指数': 0.31 } },
  regime: { turns: [
    { date: '2026-09-28', from: '退潮', to: '冰点' },
    { date: '2026-09-29', from: '冰点', to: '回暖' },
  ] },
  dailyReport: { sections: [{ id: 'regime', position: { range: '30%~50%' } }] },
  breadth: { snapshot: { verdict: { label: '宽度收窄', detail: '站上20日线仅 30.1%' } } },
  pain: { verdict: { label: '多空拉锯', reason: '翻绿 49%' } },
  seats: { verdict: { label: '游资主导' } },
};
const GLOBAL = { meta: { aShareTradeDate: '2026-09-30' }, quotes: [
  { key: 'a50', name: '富时中国A50期货', ok: true, state: 'ok', chgPct: 0.0915 },
  { key: 'sox', name: '费城半导体指数', ok: false, state: 'preopen', chgPct: null },
] };
const BT = { meta: { tradeDate: '2026-09-30' }, v52: { total: -0.015005 } };
const OPS = { updatedAt: '2026-10-01T20:28:01.779Z', count: 0, events: [] };

const mkInput = (extra = {}) => buildInput({ dualTrack: DT, dualTrackDays: DAYS, signals: SIG, global: GLOBAL, backtest: BT, opsAlerts: OPS, ...extra });
const GEN_AT = '2026-09-30T10:35:00.000Z';

// 即时轨账本（形态对齐 src/paper.js emptyAccount；nav 两日 → pnl_daily 可算）
const ACCT = {
  initCash: 100000, cash: 100017, freeze: 0, positions: {}, orders: [
    { code: '600825', status: 'filled', settleDate: '2026-09-30', estPrice: 10.0, qty: 500 },
  ], trades: [
    { code: '600825', date: '2026-09-30', px: 10.002, gross: 5001, fee: 5.0, name: 'x' },
  ], pending: [], logs: [], realized: 0, totalFee: 5,
  nav: [
    { date: '2026-09-29', equity: 100000 },
    { date: '2026-09-30', equity: 100017 },
  ],
};

const mustPass = (r, label) => {
  const errs = validateContract(r, SCHEMA);
  assert.deepEqual(errs, [], `${label} 契约违例: ${JSON.stringify(errs)}`);
};

// ── 1. 盘后报告：结构 / 搬运 / null 纪律 ───────────────────────────────
test('盘后报告：信封字段齐 + 数字只搬运 + 结构性 null 不补 0', () => {
  const r = generatePostMarket(mkInput(), { generatedAt: GEN_AT });
  mustPass(r, 'post_market');
  assert.equal(r.schema_version, SCHEMA_VERSION);
  assert.equal(r.report_type, 'post_market');
  assert.equal(r.generated_by, 'ci');
  assert.equal(r.urgent, false);
  assert.equal(r.payload.pnl_daily, DT.day.dayReturns.A, 'pnl_daily 必须逐位搬运 dayReturns.A');
  assert.equal(r.payload.pnl_cumulative, DT.summary.trackA.total);
  assert.equal(r.payload.close_drawdown, DT.summary.trackA.maxDd);
  assert.equal(r.payload.trend_switch_hits, 0, '09-30 当日无切换');
  assert.equal(r.payload.grid_triggers, null, '结构性缺失恒 null');
  assert.equal(r.payload.counter_trend_losses, null);
  assert.equal(r.payload.cost_ratio, null, '归档轨无成交明细 → null 非 0');
  assert.equal(r.payload.slippage_source, 'assumed_constant');
  assert.equal(r.payload.slippage_avg, 0.0002, '假设常量 = src/paper.js DEFAULT_SLIP');
  assert.equal(r.payload.backtest_deviation.delta, 0);
  assert.equal(r.payload.regime.position_range, '30%~50%');
  assert.equal(r.payload.overseas[0].chgPct, 0.0915);
  assert.equal(r.payload.overseas[1].chgPct, null, '盘前无数据 = null 绝不写 0');
  assert.equal(r.status, 'degraded', '归档轨 live-only 字段 null → degraded（与 09-30 示例一致）');
  const noteFields = r.missing_notes.map((n) => n.field).join(';');
  assert.match(noteFields, /grid_triggers/, '常驻缺失披露必须在场');
  assert.match(noteFields, /max_drawdown_daily/, '归档轨 live-only 披露必须在场');
});

// ── 2. data_completeness（决议 5）──────────────────────────────────────
test('data_completeness：null→missing / 假设常量→assumed / 实测→measured', () => {
  const r = generatePostMarket(mkInput(), { generatedAt: GEN_AT });
  const dc = r.data_completeness;
  assert.deepEqual(dc.grid_triggers, { source: 'missing', confidence: 'missing' });
  assert.deepEqual(dc.cost_ratio, { source: 'missing', confidence: 'missing' }, 'null 值强制 missing');
  assert.deepEqual(dc.slippage_avg, { source: 'assumed', confidence: 'assumed' });
  assert.deepEqual(dc.pnl_daily, { source: 'archived', confidence: 'measured' });
  assert.deepEqual(dc.close_drawdown, { source: 'archived', confidence: 'measured' });
  // 独立直调：overrides 生效
  const dc2 = buildDataCompleteness({ pnl_daily: 0.1, cost_ratio: null }, { pnl_daily: 'live' });
  assert.deepEqual(dc2.pnl_daily, { source: 'live', confidence: 'measured' });
  assert.deepEqual(dc2.cost_ratio, { source: 'missing', confidence: 'missing' });
});

// ── 3. 盘前报告 ───────────────────────────────────────────────────────
test('盘前报告：prev_nav 派生 / 隔夜敞口 / ATR 系结构性 null', () => {
  const r = generatePreMarket(mkInput(), { generatedAt: GEN_AT });
  mustPass(r, 'pre_market');
  assert.ok(Math.abs(r.payload.prev_nav - (1 + DT.summary.trackA.total) / (1 + DT.day.dayReturns.A)) < 1e-12, 'prev_nav=(1+cum)/(1+dayRet) 派生可逆');
  assert.deepEqual(r.payload.overnight_exposure, { a50_chgPct: 0.0915, posGap: 0.2 });
  assert.equal(r.payload.positions.poolPos, 0.5);
  for (const k of ['key_levels', 'events_today', 'atr', 'suggested_step']) assert.equal(r.payload[k], null, `${k} 恒 null`);
  assert.equal(r.data_completeness.atr.source, 'missing');
});

// ── 4. 盘中 + trigger 枚举（决议 3）───────────────────────────────────
test('盘中报告：urgent 四类枚举锁死 / 回撤距离披露 / 越界 throw', () => {
  const r = generateIntraday(mkInput(), { generatedAt: GEN_AT, trigger: 'event:circuit_breaker' });
  mustPass(r, 'intraday');
  assert.equal(r.urgent, true);
  assert.equal(r.payload.nav_realtime, null, '归档轨无合成源诚实置 null');
  assert.equal(r.payload.drawdown_vs_threshold.dd_now, DT.summary.trackA.maxDd);
  assert.deepEqual(r.payload.drawdown_vs_threshold.tier_edges, DD_TIER_EDGES);
  assert.ok(r.payload.drawdown_vs_threshold.distance_pp > 0);
  assert.throws(() => generateIntraday(mkInput(), { trigger: 'event:xxx' }), /非法 trigger/);
  assert.throws(() => generateIntraday(mkInput(), { trigger: 'event:grid_hit' }), /决议 3/, '剧本之外的事件类型不在四类白名单');
});

// ── 5. 周报：胜率口径（决议 4）+ 复利 + 切换计数 ───────────────────────
test('周报：win_rate 剧本口径缺席为 null / week_return 复利 / 周内切换 2 次', () => {
  const r = generateWeekly(mkInput(), { generatedAt: GEN_AT, weekStart: '2026-09-28' });
  mustPass(r, 'weekly');
  const expect = (1 - 0.01049) * (1 + 0.000503) * (1 + 0.00017) - 1;
  assert.ok(Math.abs(r.payload.week_return - expect) < 1e-12, '复利口径');
  assert.ok(Math.abs(r.payload.max_drawdown_week - 0.01049) < 1e-9, '周内单边回撤 = 最大日跌幅');
  assert.equal(r.payload.trend_switch_hits, 2);
  assert.equal(r.payload.win_rate, null, '剧本绑定缺席 → null 不降级');
  assert.match(r.payload.win_rate_note, /剧本命中次数/);
  assert.ok(Math.abs(r.payload.profit_trade_ratio - 2 / 3) < 1e-12, '辅助指标 = 日线盈利占比 2/3');
  assert.match(r.payload.trend_switch_effect.shadow_note, /trackC/);
  assert.equal(r.payload.param_suggestions[0].topic, 'posGap 阈值');
});

// ── 6. 即时轨（决议 1：一等公民）──────────────────────────────────────
test('即时轨：账本覆盖 pnl_daily/cost_ratio/slippage 实测，来源标 live', () => {
  const input = mkInput({ paperAccount: ACCT });
  assert.equal(input.live, true);
  assert.equal(input.sources.paper_account, 'live');
  const r = generatePostMarket(input, { generatedAt: GEN_AT, generatedBy: 'browser' });
  mustPass(r, 'post_market(live)');
  assert.equal(r.generated_by, 'browser');
  assert.ok(Math.abs(r.payload.pnl_daily - 0.00017) < 1e-9, 'nav 两日 equity 变化率');
  assert.ok(Math.abs(r.payload.cost_ratio - 5 / 5001) < 1e-9, 'fee/gross 当日成交口径');
  assert.equal(r.payload.fee_total, 5);
  assert.equal(r.payload.net_pnl, 17);
  assert.equal(r.payload.slippage_source, 'measured');
  assert.ok(Math.abs(r.payload.slippage_avg - 0.0002) < 1e-9, 'estPrice 10 → px 10.002 = 万二实测');
  assert.deepEqual(r.data_completeness.pnl_daily, { source: 'live', confidence: 'measured' });
  assert.equal(r.payload.circuit_breaker.dd_tier, 0, '回撤 0 → 0 档');
  assert.equal(r.payload.nav_realtime, 100017, '即时轨 nav_realtime = accountStats.total');
});

// ── 7. 双轨合并（决议 1：generated_at 去重 + null 回填）────────────────
test('mergeReports：新者为基座 / null 回填标来源 / 同刻 browser 优先', () => {
  const archived = generatePostMarket(mkInput(), { generatedAt: '2026-09-30T10:35:00.000Z' }); // ci
  const live = generatePostMarket(mkInput({ paperAccount: ACCT }), { generatedAt: '2026-09-30T10:36:00.000Z', generatedBy: 'browser' });
  const m = mergeReports(live, archived);
  mustPass(m, 'merged');
  assert.equal(m.generated_by, 'browser', '较新者基座');
  assert.ok(m.merged_from.includes('ci'));
  assert.deepEqual(m.backfilled_fields, ['max_drawdown_daily', 'slippage_total', 'counter_trend_loss_ratio'].filter((k) => archived.payload[k] != null && live.payload[k] == null));
  // 归档轨 payload 里非 null 而即时轨 null 的字段被回填（如 market_context 双轨同值则不回填）
  // 反向：旧=新（同 generated_at）→ browser 优先
  const a2 = generatePostMarket(mkInput(), { generatedAt: '2026-09-30T10:35:00.000Z' });
  const l2 = generatePostMarket(mkInput({ paperAccount: ACCT }), { generatedAt: '2026-09-30T10:35:00.000Z', generatedBy: 'browser' });
  assert.equal(mergeReports(a2, l2).generated_by, 'browser');
  // null 互不覆盖：即时轨基座 null（max_drawdown_daily 双轨均 null）保持 null
  assert.equal(m.payload.max_drawdown_daily, null);
  assert.equal(mergeReports(null, archived).generated_by, 'ci');
  assert.equal(mergeReports(live, null).generated_by, 'browser');
});

// ── 8. 真实档冒烟（读仓库 data/，不写死数字——CI 数据更新不红）──────────
test('真实档冒烟：四源真实 JSON → 盘后报告契约通过 + 搬运断言', { skip: !existsSync(new URL('../data/paper/dual_track_latest.json', import.meta.url)) }, () => {
  const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
  const input = buildInput({
    dualTrack: read('paper/dual_track_latest.json'),
    dualTrackDays: read('paper/dual_track.json').days,
    signals: read('signals-latest.json'),
    global: read('global.json'),
    backtest: read('backtest.json'),
    opsAlerts: read('ops-alerts-latest.json'),
  });
  const r = generatePostMarket(input, { generatedAt: GEN_AT });
  mustPass(r, 'real-data post_market');
  // 搬运断言：报告值 === 源档值（唯一事实源纪律，不写死具体数字）
  assert.equal(r.payload.pnl_daily, input.dualTrack.day.dayReturns.A);
  assert.equal(r.payload.pnl_cumulative, input.dualTrack.summary.trackA.total);
  assert.equal(r.payload.close_drawdown, input.dualTrack.summary.trackA.maxDd);
  assert.equal(typeof r.date, 'string');
  const weekly = generateWeekly(input, { generatedAt: GEN_AT, weekStart: input.tradeDate });
  mustPass(weekly, 'real-data weekly(单日)');
  assert.equal(weekly.payload.nav_series.length, 1);
});
