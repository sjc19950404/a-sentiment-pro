// ── AI 报告生成核心（S1 · 2026-10-06 六决议拍板版）────────────────────────
//
// 定位：DataSnapshot → 四类报告对象（盘前/盘中/盘后/周报）的**纯函数层**。
//   Node/浏览器双端共用（沿用 src/paper.js 模式）；只接收输入对象、只返回
//   新对象——不 import 页面层、不写文件、不发请求、不触碰任何现有模块状态。
//
// 铁律（docs/ai_report_module_design.md）：
//   1. 只搬运不重算：执行轨数字唯一出处 data/paper/dual_track_latest.json
//      （本模块不重算任何双轨口径，与 src/dual_track.js 同纪律）。
//   2. 缺失一律 null + missing_notes，绝不补 0、绝不猜（grid_triggers 等四类
//      系统性无源字段见 STRUCTURAL_NULL）。
//   3. 双轨（决议 1）：即时轨（浏览器 localStorage 账本）一等公民，归档轨
//      （CI data/*.json）兜底；mergeReports 按 generated_at 去重合并。
//   4. urgent 触发条件限定四类（决议 3）：熔断 / regime 切换 / 单日回撤超阈值
//      / 剧本命中——trigger 枚举锁死，越界即 throw。
//
// 接线：scripts/build_ai_report.mjs（CI 归档轨）与页面 S3（即时轨）调用同一
//   组生成函数；本模块自身零 IO，测试用内联夹具 + 真实档冒烟双轨覆盖。
import { accountStats, DEFAULT_SLIP } from './paper.js';

export const SCHEMA_VERSION = '1.0';
export const REPORT_TYPES = ['pre_market', 'intraday', 'post_market', 'weekly'];
export const TRIGGER_ENUM = ['schedule', 'event:circuit_breaker', 'event:trend_switch', 'event:drawdown_near', 'event:script_hit'];

export const AI_REPORT_DISCLAIMER = '本报告只描述系统状态与风险特征，不构成投资建议；缺失项标注未知而非补 0。';

// 回撤档位口径出处 src/paper.js::DD_TIERS（≥9%→仓位帽 70%、≥15%→40%）。
// 此处只读档位边界做"距离"披露，不做任何仓位决策（非目标铁律）。
export const DD_TIER_EDGES = [0.09, 0.15];

// 结构性缺失字段（双轨都无数据源）：恒 null，不参与 status 降级判定
// （其缺失已由 BASE_MISSING_NOTES 常驻披露，再降级等于双重惩罚）。
const STRUCTURAL_NULL = new Set([
  'grid_triggers', 'grid_trigger_detail', 'counter_trend_losses', 'counter_trend_loss_ratio',
  'key_levels', 'events_today', 'atr', 'suggested_step',
]);

// ── 常驻缺失披露（missing_notes 的固定底座）─────────────────────────────
const BASE_MISSING_NOTES = [
  { field: 'grid_triggers / grid_trigger_detail', reason: '系统无网格交易引擎（grid_parallel 是参数寻优并行器，非交易网格）', ref: 'src/grid_parallel.js' },
  { field: 'counter_trend_losses / counter_trend_loss_ratio', reason: '无逆势加仓/亏损记账；参考 divergence.posGap（保费敞口）', ref: 'data/paper/dual_track_latest.json' },
];
const LIVE_ONLY_NOTE = { field: 'max_drawdown_daily / fee_total / net_pnl / cost_ratio / slippage 实测', reason: '个人账本成交与日内 equity 仅存在于浏览器 localStorage（即时轨一等公民，决议 1）', ref: 'paper_ui.js __paperSnapshot' };
const PRE_MARKET_MISSING_NOTE = { field: 'key_levels / events_today / atr / suggested_step', reason: '指标服务未提供 ATR 与关键价位；事件日历无数据源', ref: 'docs/ai_report_module_design.md#2.3' };
const WEEKLY_WIN_RATE_NOTE = '口径 = 剧本命中次数 / 总剧本执行次数（决议 4，2026-10-06 拍板）；剧本绑定记录（airpt_sim_bindings_v1）缺席 → null，不降级为日收益口径';

const CONCEPTS = {
  trend_switch: 'regime 状态机（src/regime.js）',
  circuit_breaker: 'DD_TIERS + HARD_STOP_LOSS + ops-alerts（src/paper.js / src/opsalerts.js）',
};

const SOURCE_REFS = {
  date: 'data/paper/dual_track_latest.json::day.date',
  pnl_daily: 'data/paper/dual_track_latest.json::day.dayReturns.A（即时轨覆盖为账本 nav 当日变化）',
  pnl_cumulative: 'data/paper/dual_track_latest.json::summary.trackA.total（即时轨覆盖为 accountStats.ret）',
  close_drawdown: 'data/paper/dual_track_latest.json::summary.trackA.maxDd',
  max_drawdown_daily: '即时轨 nav 当日 equity 序列峰谷（日内采样 S3 注入前恒 null）',
  trend_switch_hits: 'data/signals-latest.json::regime.turns',
  overseas: 'data/global.json::quotes（A50 + 费半；美股仅美东 16:30 后可信）',
  backtest_deviation: 'data/backtest.json::v52 vs dual_track summary.trackA',
  market_context: 'data/signals-latest.json::latest / breadth / pain / seats',
  circuit_breaker: 'data/ops-alerts-latest.json::events + src/paper.js::DD_TIERS',
  regime: 'data/paper/dual_track_latest.json::day.regime + signals.dailyReport（仓位区间）',
  slippage_avg: 'src/paper.js::DEFAULT_SLIP（归档轨假设常量）/ orders×trades 逐笔实测（即时轨）',
  cost_ratio: '即时轨当日 trades 费用合计 / 成交额合计；归档轨无成交明细 → null',
  win_rate: WEEKLY_WIN_RATE_NOTE,
};

// ── 工具 ───────────────────────────────────────────────────────────────
const num = (v) => (Number.isFinite(v) ? v : null);
const pick = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

function sourceHealth(v, dateField, expectDate) {
  if (v == null || typeof v !== 'object') return 'missing';
  if (expectDate && dateField) {
    const d = pick(v, dateField);
    if (typeof d === 'string' && d !== expectDate) return 'stale';
  }
  return 'fresh';
}

/**
 * 六源规范化：读档对象 → DataSnapshot（附 sources 健康标记与统一 tradeDate）。
 * 纯函数：只做存在性/新鲜度判定，不做任何数值计算。
 * @param {object} s { dualTrack, dualTrackDays, signals, global, backtest, opsAlerts, intraday, paperAccount }
 */
export function buildInput(s = {}) {
  const tradeDate = pick(s, 'dualTrack.day.date') ?? pick(s, 'signals.meta.tradeDate') ?? null;
  const sources = {
    dual_track: sourceHealth(s.dualTrack, 'day.date', tradeDate),
    signals: sourceHealth(s.signals, 'meta.tradeDate', tradeDate),
    global: sourceHealth(s.global, 'meta.aShareTradeDate', tradeDate),
    backtest: sourceHealth(s.backtest, 'meta.tradeDate', tradeDate),
    ops_alerts: sourceHealth(s.opsAlerts, null, null),
    intraday: sourceHealth(s.intraday, 'tradeDate', tradeDate),
    paper_account: s.paperAccount && typeof s.paperAccount === 'object' ? 'live' : 'missing',
  };
  return { ...s, tradeDate, sources, live: sources.paper_account === 'live' };
}

function deriveStatus(input, payload) {
  if (input.sources.dual_track === 'missing') return 'missing';
  const variablyNull = Object.entries(payload)
    .filter(([k, v]) => v == null && !STRUCTURAL_NULL.has(k))
    .map(([k]) => k);
  return variablyNull.length ? 'degraded' : 'ok';
}

// 恒 null 字段 → 统一进 payload（缺失语义唯一出处，杜绝各生成器各自手写）
function structuralNulls() {
  return {
    grid_triggers: null,
    counter_trend_losses: null,
  };
}

function buildOverseas(global) {
  if (!global || !Array.isArray(global.quotes)) return null;
  const mk = (key) => {
    const q = global.quotes.find((x) => x && x.key === key);
    if (!q) return null;
    return {
      key: q.key, name: q.name,
      chgPct: q.ok && Number.isFinite(q.chgPct) ? q.chgPct : null,
      state: q.state || (q.ok ? 'ok' : 'unknown'),
    };
  };
  const out = [mk('a50'), mk('sox')].filter(Boolean); // A50=夜盘代理；费半=与 A 股科技链同源度最高
  return out.length ? out : null;
}

function buildRegime(input) {
  const day = pick(input, 'dualTrack.day');
  if (!day) return null;
  const range = (pick(input, 'signals.dailyReport.sections') || [])
    .find((x) => x && x.id === 'regime' && x.position && x.position.range);
  return {
    key: day.regime?.key ?? null,
    label: day.regime?.label ?? null,
    cap: Number.isFinite(day.regime?.cap) ? day.regime.cap : null,
    position_range: range ? range.position.range : null,
  };
}

function turnsIn(input, from, to) {
  const turns = pick(input, 'signals.regime.turns');
  if (!Array.isArray(turns)) return [];
  return turns.filter((t) => t && typeof t.date === 'string' && t.date >= from && t.date <= to);
}

function buildCircuitBreaker(input, opts = {}) {
  const events = Array.isArray(pick(input, 'opsAlerts.events')) ? input.opsAlerts.events : null;
  const riskEvents = events ? events.length : null;
  if (!input.live) {
    return {
      dd_tier: null,
      hard_stop_triggered: null,
      risk_events: riskEvents,
      note: '归档轨无账户日内回撤与止损记录，档位未知；ops-alerts 事件计数如上',
    };
  }
  const stats = opts.stats;
  const ddNow = Math.abs(Number.isFinite(stats?.drawdown) ? stats.drawdown : 0);
  const ddTier = ddNow >= DD_TIER_EDGES[1] ? 2 : ddNow >= DD_TIER_EDGES[0] ? 1 : 0;
  const logs = Array.isArray(input.paperAccount?.logs) ? input.paperAccount.logs : [];
  const stopHit = logs.some((l) => l && l.date === input.tradeDate && (l.stage === 'stop' || l.stage === 'risk') && l.result === 'rejected');
  return {
    dd_tier: ddTier,
    hard_stop_triggered: stopHit,
    risk_events: riskEvents,
    note: `即时轨：运行回撤 ${(ddNow * 100).toFixed(2)}%，距档位边界见 drawdown_vs_threshold；单笔止损/风控拦截当日 ${stopHit ? '有' : '无'}`,
  };
}

function buildMarketContext(signals) {
  const latest = pick(signals, 'latest');
  if (!latest) return null;
  const verdict = (p, k) => pick(signals, `${p}.verdict.${k}`) ?? null;
  const breadthDetail = pick(signals, 'breadth.snapshot.verdict.detail') ?? pick(signals, 'breadth.snapshot.verdict.label');
  return {
    emotion: num(pick(signals, 'signals.latestEmotion.value')),
    pct_rank: num(latest.pct_rank),
    indexes: latest.indexes && typeof latest.indexes === 'object' ? latest.indexes : null,
    up_down: Number.isFinite(latest.up_count) ? `${latest.up_count}/${latest.down_count}/${latest.flat_count}` : null,
    amount_yi: num(latest.amount_yi),
    zt_dt: Number.isFinite(latest.zt_count) ? `${latest.zt_count}/${latest.dt_count}` : null,
    breadth: breadthDetail ?? null,
    pain: verdict('pain', 'label') ?? verdict('pain', 'reason'),
    seats: verdict('seats', 'label'),
  };
}

// ── data_completeness（决议 5）：字段级来源与可信度 ─────────────────────
const FIELD_SOURCE_DEFAULTS = {
  date: 'derived', status: 'derived',
  pnl_daily: 'archived', pnl_cumulative: 'archived',
  max_drawdown_daily: 'live',
  grid_triggers: 'missing', counter_trend_losses: 'missing',
  trend_switch_hits: 'archived',
  cost_ratio: 'live',
  slippage_avg: 'assumed', slippage_source: 'derived',
  regime: 'archived', circuit_breaker: 'archived', overseas: 'archived',
  prev_nav: 'derived', positions: 'archived', overnight_exposure: 'archived',
  key_levels: 'missing', events_today: 'missing', atr: 'missing', suggested_step: 'missing',
  nav_realtime: 'live', approx: 'derived', drawdown_vs_threshold: 'derived',
  fee_total: 'live', slippage_total: 'live', net_pnl: 'live',
  grid_trigger_detail: 'missing', counter_trend_loss_ratio: 'missing',
  max_drawdown_intraday: 'live', close_drawdown: 'archived',
  backtest_deviation: 'derived', market_context: 'archived',
  week_return: 'derived', nav_series: 'archived', max_drawdown_week: 'derived',
  win_rate: 'live', win_rate_note: 'derived', profit_trade_ratio: 'live', cost_ratio_week: 'live',
  trend_switch_effect: 'archived', param_suggestions: 'archived',
};

const CONFIDENCE_BY_SOURCE = { assumed: 'assumed', missing: 'missing' };

/**
 * payload → 逐字段 {source, confidence}。
 * @param {object} payload 报告 payload
 * @param {object} [overrides] 生成器传入的轨道覆盖（如即时轨 pnl_daily:'live'）
 */
export function buildDataCompleteness(payload, overrides = {}) {
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v == null) { out[k] = { source: 'missing', confidence: 'missing' }; continue; }
    const source = overrides[k] ?? FIELD_SOURCE_DEFAULTS[k] ?? 'derived';
    out[k] = { source, confidence: CONFIDENCE_BY_SOURCE[source] ?? 'measured' };
  }
  return out;
}

// ── 信封 ───────────────────────────────────────────────────────────────
function envelope({ type, trigger, date, generatedAt, generatedBy, payload, input, extraNotes = [], sourceOverrides = {} }) {
  if (!REPORT_TYPES.includes(type)) throw new Error(`非法 report_type: ${type}`);
  if (!TRIGGER_ENUM.includes(trigger)) throw new Error(`非法 trigger: ${trigger}（urgent 触发条件限定四类，决议 3）`);
  const status = deriveStatus(input, payload);
  const base = BASE_MISSING_NOTES;
  const notes = [...base, ...extraNotes];
  if (!input.live) notes.push(LIVE_ONLY_NOTE);
  return {
    schema_version: SCHEMA_VERSION,
    report_type: type,
    trigger,
    urgent: trigger !== 'schedule',
    date,
    generated_at: generatedAt,
    generated_by: generatedBy === 'browser' ? 'browser' : 'ci',
    status,
    track: 'A',
    data_health: { sources: input.sources },
    data_completeness: buildDataCompleteness(payload, sourceOverrides),
    payload: { ...payload, status },
    missing_notes: notes,
    concepts: CONCEPTS,
    sources: SOURCE_REFS,
    disclaimer: AI_REPORT_DISCLAIMER,
  };
}

// ── base payload（四类共用骨架）────────────────────────────────────────
function buildBase(input, opts = {}) {
  const day = pick(input, 'dualTrack.day');
  const summary = pick(input, 'dualTrack.summary');
  const payload = {
    date: input.tradeDate,
    ...structuralNulls(),
    pnl_daily: num(pick(day, 'dayReturns.A')),
    pnl_cumulative: num(pick(summary, 'trackA.total')),
    max_drawdown_daily: null, // 日内 equity 采样未接入（S3 UI 层注入前恒 null，不造数）
    trend_switch_hits: input.tradeDate ? turnsIn(input, input.tradeDate, input.tradeDate).length : null,
    cost_ratio: null,
    slippage_avg: DEFAULT_SLIP, // 归档轨假设常量（口径唯一出处 src/paper.js）
    slippage_source: 'assumed_constant',
    regime: buildRegime(input),
    circuit_breaker: null,
    overseas: buildOverseas(input.global),
  };
  const overrides = {};
  if (input.live) {
    const acct = input.paperAccount;
    const stats = accountStats(acct);
    opts.stats = stats;
    const nav = Array.isArray(acct.nav) ? acct.nav.filter((n) => n && Number.isFinite(n.equity)) : [];
    const last = nav[nav.length - 1];
    if (nav.length >= 2 && last && last.date === input.tradeDate) {
      const prev = nav[nav.length - 2];
      payload.pnl_daily = (last.equity - prev.equity) / prev.equity;
      overrides.pnl_daily = 'live';
      payload.pnl_cumulative = Number.isFinite(stats.ret) ? stats.ret : payload.pnl_cumulative;
      overrides.pnl_cumulative = 'live';
      const tradesToday = (Array.isArray(acct.trades) ? acct.trades : []).filter((t) => t && t.date === input.tradeDate);
      const fee = tradesToday.reduce((a, t) => a + (Number.isFinite(t.fee) ? t.fee : 0), 0);
      const gross = tradesToday.reduce((a, t) => a + Math.abs(Number.isFinite(t.gross) ? t.gross : 0), 0);
      if (tradesToday.length) {
        payload.cost_ratio = gross > 0 ? fee / gross : null;
        overrides.cost_ratio = 'live';
        payload.fee_total = fee;
        overrides.fee_total = 'live';
        payload.net_pnl = last.equity - prev.equity;
        overrides.net_pnl = 'live';
      }
      // 滑点实测：orders(estPrice) × trades(px) 逐笔配对（配不上 = 未测，不冒充）
      const filled = (Array.isArray(acct.orders) ? acct.orders : [])
        .filter((o) => o && o.status === 'filled' && o.settleDate === input.tradeDate && Number.isFinite(o.estPrice));
      const byCode = new Map(tradesToday.filter((t) => t.code).map((t) => [t.code, t]));
      const slips = filled
        .map((o) => { const t = byCode.get(o.code); return t && Number.isFinite(t.px) ? Math.abs(t.px - o.estPrice) / o.estPrice : null; })
        .filter((v) => v != null);
      if (slips.length) {
        payload.slippage_avg = slips.reduce((a, b) => a + b, 0) / slips.length;
        payload.slippage_source = 'measured';
        overrides.slippage_avg = 'live';
      }
    }
    payload.nav_realtime = Number.isFinite(stats.total) ? stats.total : null;
    overrides.nav_realtime = 'live';
  }
  payload.circuit_breaker = buildCircuitBreaker(input, { stats: opts.stats });
  return { payload, overrides };
}

// ── 四类生成器 ─────────────────────────────────────────────────────────

/** 盘前报告（交易日 09:15）：前日净值、持仓结构、隔夜敞口、剧本位（结构性 null）。 */
export function generatePreMarket(input, opts = {}) {
  const { payload, overrides } = buildBase(input);
  const day = pick(input, 'dualTrack.day');
  const summary = pick(input, 'dualTrack.summary');
  const ret = num(pick(day, 'dayReturns.A'));
  const cum = num(pick(summary, 'trackA.total'));
  payload.prev_nav = ret != null && cum != null ? (1 + cum) / (1 + ret) : null;
  payload.positions = day?.trackA ? { targetPos: day.trackA.targetPos ?? null, poolPos: num(day.trackA.poolPos), executed: day.trackA.executed ?? null } : null;
  payload.overnight_exposure = {
    a50_chgPct: num((payload.overseas || []).find((q) => q.key === 'a50')?.chgPct),
    posGap: num(pick(day, 'divergence.posGap')),
  };
  payload.key_levels = null;
  payload.events_today = null;
  payload.atr = null;
  payload.suggested_step = null;
  return envelope({
    type: 'pre_market',
    trigger: opts.trigger || 'schedule',
    date: input.tradeDate,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    generatedBy: opts.generatedBy,
    payload,
    input,
    extraNotes: [PRE_MARKET_MISSING_NOTE],
    sourceOverrides: overrides,
  });
}

/** 盘中报告（每 30 分钟 / 四类 urgent 事件即时）。 */
export function generateIntraday(input, opts = {}) {
  const { payload, overrides } = buildBase(input);
  if (!input.live) payload.nav_realtime = null; // 归档轨无指数点位合成源（intraday.json 无指数），S1 诚实置 null
  payload.approx = false;
  const stats = opts.stats ?? (input.live ? accountStats(input.paperAccount) : null);
  const ddNow = input.live && Number.isFinite(stats?.drawdown)
    ? Math.abs(stats.drawdown)
    : num(pick(input, 'dualTrack.summary.trackA.maxDd'));
  const nearest = DD_TIER_EDGES.find((e) => e >= (ddNow ?? 0)) ?? DD_TIER_EDGES[DD_TIER_EDGES.length - 1];
  payload.drawdown_vs_threshold = {
    dd_now: ddNow,
    tier_edges: DD_TIER_EDGES,
    distance_pp: ddNow != null ? Math.round(((nearest - ddNow) * 100 + Number.EPSILON) * 100) / 100 : null,
    basis: input.live ? '即时轨 accountStats.drawdown（运行回撤）' : '归档轨 trackA.maxDd（运行回撤，非当日）',
  };
  return envelope({
    type: 'intraday',
    trigger: opts.trigger || 'schedule',
    date: input.tradeDate,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    generatedBy: opts.generatedBy,
    payload,
    input,
    sourceOverrides: overrides,
  });
}

/** 盘后报告（15:05 即时轨 / 18:35 归档轨）。 */
export function generatePostMarket(input, opts = {}) {
  const { payload, overrides } = buildBase(input);
  const summary = pick(input, 'dualTrack.summary');
  payload.close_drawdown = num(pick(summary, 'trackA.maxDd'));
  payload.max_drawdown_intraday = null; // 同 max_drawdown_daily：日内 equity 采样未接入
  payload.grid_trigger_detail = null;
  payload.counter_trend_loss_ratio = null;
  const cum = num(pick(summary, 'trackA.total'));
  const bt = num(pick(input, 'backtest.v52.total'));
  payload.backtest_deviation = cum != null && bt != null
    ? { live_cum: cum, backtest_v52: bt, delta: Math.round((cum - bt) * 1e6) / 1e6, note: '执行轨 vs 回测 v52 锚点（零偏差为设计约束）' }
    : null;
  payload.market_context = buildMarketContext(input.signals);
  if (!input.live) { payload.fee_total = null; payload.slippage_total = null; payload.net_pnl = null; }
  else { payload.slippage_total = null; } // 金额口径需 order.qty 配对（S3 录入 qty 后开放），不造数
  return envelope({
    type: 'post_market',
    trigger: opts.trigger || 'schedule',
    date: input.tradeDate,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    generatedBy: opts.generatedBy,
    payload,
    input,
    extraNotes: [{ field: 'counter_trend_loss_ratio', reason: '旁注：当日分歧 posGap（保费敞口）见 overnight/pre 段', ref: 'data/paper/dual_track_latest.json' }],
    sourceOverrides: overrides,
  });
}

/** 周报（本周最后交易日）：周净值、回撤、剧本口径胜率（决议 4）、参数建议。 */
export function generateWeekly(input, opts = {}) {
  const tradeDate = input.tradeDate;
  const days = (Array.isArray(input.dualTrackDays) ? input.dualTrackDays : [])
    .filter((d) => d && d.date >= (opts.weekStart || '0000') && d.date <= (tradeDate || '9999'));
  const { payload, overrides } = buildBase(input);
  let cum = 1;
  let missingDays = 0;
  const navSeries = days.map((d) => {
    const r = num(pick(d, 'dayReturns.A'));
    if (r == null) missingDays += 1;
    else cum *= 1 + r;
    return { date: d.date, day_return: r, score: num(d.score), regime: pick(d, 'regime.key') ?? null };
  });
  payload.nav_series = navSeries;
  payload.week_return = days.length ? cum - 1 : null;
  let peak = 1; let maxDd = 0;
  let v = 1;
  for (const d of days) {
    const r = num(pick(d, 'dayReturns.A')) ?? 0;
    v *= 1 + r;
    peak = Math.max(peak, v);
    maxDd = Math.max(maxDd, (peak - v) / peak);
  }
  payload.max_drawdown_week = days.length ? maxDd : null;
  payload.win_rate = null; // 决议 4：剧本口径；绑定记录缺席 → null
  payload.win_rate_note = WEEKLY_WIN_RATE_NOTE;
  const ups = navSeries.filter((d) => (d.day_return ?? 0) > 0).length;
  payload.profit_trade_ratio = navSeries.length ? ups / navSeries.length : null; // 辅助指标（日线口径；回合配对 S3）
  payload.cost_ratio_week = null;
  payload.trend_switch_hits = days.length && tradeDate ? turnsIn(input, days[0].date, tradeDate).length : null;
  const turns = tradeDate && days.length ? turnsIn(input, days[0].date, tradeDate) : [];
  const tc05 = num(input.dualTrack?.summary?.trackC?.['0.5']?.total); // key '0.5' 含点，不能用 pick 路径（split('.') 会断）
  const cumA = num(pick(input, 'dualTrack.summary.trackA.total'));
  const episodes = num(input.dualTrack?.summary?.trackC?.['0.5']?.episodes);
  payload.trend_switch_effect = {
    turns,
    shadow_note: tc05 != null && cumA != null
      ? `trackC 影子线（0.5 档）累计 ${tc05} vs 执行轨 ${cumA}；episodes ${episodes ?? '[未知]'}（晋升门禁 ≥10，仍须走 promote_params）`
      : null,
  };
  const div = pick(input, 'dualTrack.summary.divergence');
  payload.param_suggestions = div && Number.isFinite(div.daysGt02)
    ? [{ topic: 'posGap 阈值', fact: `分歧 >0.02 达 ${div.daysGt02}/${pick(input, 'dualTrack.sample.days') ?? '?'} 天，0.02/0.03 告警阈值仍是 [待确认] 状态`, action: '提议进入确认流程，非本模块职责' }]
    : [];
  const extra = [];
  if (missingDays) extra.push({ field: 'week_return / max_drawdown_week', reason: `本周 ${missingDays} 个交易日 dayReturns.A 缺失，按 0 跳过（缺失不补 0，但复利口径如实披露跳过日数）`, ref: 'data/paper/dual_track.json::days' });
  return envelope({
    type: 'weekly',
    trigger: opts.trigger || 'schedule',
    date: tradeDate,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    generatedBy: opts.generatedBy,
    payload,
    input,
    extraNotes: extra,
    sourceOverrides: overrides,
  });
}

// ── 双轨合并（决议 1：generated_at 去重，即时轨一等公民，null 回填）──────
/**
 * 同 report_type+date 的两轨报告合并：
 *   · 基座 = generated_at 较新者；同刻即时轨（browser）优先；
 *   · 基座 null 字段从较旧轨回填（data_completeness 标注回填来源）；
 *   · missing_notes 按 field 去重合并；data_health.sources 就宽合并。
 * 纯函数：不改输入对象。
 */
export function mergeReports(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const newer = (x, y) => {
    if (x.generated_at !== y.generated_at) return x.generated_at > y.generated_at ? x : y;
    return x.generated_by === 'browser' ? x : y; // 同刻即时轨优先（一等公民）
  };
  const base = newer(a, b);
  const older = base === a ? b : a;
  const mergedPayload = { ...older.payload };
  const backfilled = [];
  for (const [k, v] of Object.entries(base.payload)) {
    if (v == null && older.payload && older.payload[k] != null) {
      mergedPayload[k] = older.payload[k];
      backfilled.push(k);
    } else mergedPayload[k] = v;
  }
  const noteFields = new Set((base.missing_notes || []).map((n) => n.field));
  const missingNotes = [...(base.missing_notes || []), ...(older.missing_notes || []).filter((n) => !noteFields.has(n.field))];
  const sources = { ...(older.data_health?.sources || {}), ...(base.data_health?.sources || {}) };
  const overrides = {};
  for (const k of backfilled) overrides[k] = older.generated_by === 'browser' ? 'live' : 'archived';
  return {
    ...base,
    data_health: { sources },
    data_completeness: buildDataCompleteness(mergedPayload, overrides),
    payload: mergedPayload,
    missing_notes: missingNotes,
    merged_from: [base.generated_by, older.generated_by],
    backfilled_fields: backfilled,
  };
}
