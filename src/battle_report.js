// ── 实盘战绩报表（周度盈利战报 + 月度大复盘）· 纯函数、只读 ─────────────────
//
// 定位：把模拟账户（data/paper/account.json）的一段时期战绩，算成可直接推送的
//   极简文本。**只读账户数据，绝不写回、绝不干预引擎交易**（用户铁律）。
//   · 周报（周五）：本周净值变动 / 胜率 / 盈亏比 / 总仓位 / 最大盈亏单笔 + AI 纪律点评。
//   · 月报（月末）：本月总收益 / 最大回撤 / 交易笔数 / 胜率 / 净值曲线简述 + AI 宏观复盘。
//
// 口径唯一出处（复用，不重写）：
//   · accountStats（src/paper.js）——总资产/市值/回撤/仓位；
//   · reviewTrades（src/paper_review.js）——FIFO 配对平仓盈亏，保证跨期持仓正确归因。
// 期内平仓的取法：先用**全量**成交做 FIFO 配对（否则「期前买入、期内卖出」会被当成
//   孤儿卖单跳过，少算盈亏），再按成交日（fillDate）落窗到本 period，重算胜率/盈亏比/极值。
import { accountStats } from './paper.js';
import { reviewTrades } from './paper_review.js';

const finite = (v) => v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(+v);
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const pct = (v, d = 2) => (finite(v) ? `${(+v * 100).toFixed(d)}%` : '—');
const spct = (v, d = 2) => (finite(v) ? `${+v > 0 ? '+' : ''}${(+v * 100).toFixed(d)}%` : '—');
const yuan = (v) => (finite(v) ? Math.round(+v).toLocaleString('en-US') : '—');
const syuan = (v) => (finite(v) ? `${+v >= 0 ? '+' : '−'}${yuan(Math.abs(v))}` : '—');

/** 期间（含首尾、按 date 升序）的净值序列 [{date, equity}]。 */
function navSlice(nav, startDate, endDate) {
  return (Array.isArray(nav) ? nav : [])
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) && r.date >= startDate && r.date <= endDate && Number.isFinite(+r.equity))
    .map((r) => ({ date: r.date, equity: +r.equity }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
/** 期初净值 = startDate 之前最后一笔净值；无历史则用 initCash。 */
function navBefore(nav, startDate, initCash) {
  const prior = (Array.isArray(nav) ? nav : [])
    .filter((r) => r && String(r.date || '') < startDate && Number.isFinite(+r.equity))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return prior.length ? +prior[prior.length - 1].equity : (finite(initCash) ? +initCash : 0);
}

/**
 * 计算一段时期 [startDate, endDate]（含首尾）的战绩指标（只读 account）。
 * @returns {object} 净值变动/回撤/胜率/盈亏比/仓位/最大盈亏单笔/净值曲线关键点
 */
export function computePeriodStats(account, { startDate, endDate }) {
  const acct = account || {};
  const stats = accountStats(acct);
  const initCash = finite(acct.initCash) ? +acct.initCash : 0;
  const nav = navSlice(acct.nav, startDate, endDate);
  const navStart = navBefore(acct.nav, startDate, initCash);
  const navEnd = nav.length ? nav[nav.length - 1].equity : navStart;
  const navDelta = navEnd - navStart;
  const navDeltaPct = navStart > 0 ? navDelta / navStart : null;
  // 期内最大回撤（滚动峰值，从 max(期初, 期内首点) 起算）；峰值/低谷供净值曲线简述
  let peak = Math.max(navStart, nav.length ? nav[0].equity : navStart);
  let maxDd = 0;
  let navPeak = peak;
  let navTrough = nav.length ? nav[0].equity : navStart;
  for (const r of nav) {
    peak = Math.max(peak, r.equity);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - r.equity) / peak : 0);
    navPeak = Math.max(navPeak, r.equity);
    navTrough = Math.min(navTrough, r.equity);
  }
  // 期内平仓：全量 FIFO 配对 → 按成交日落窗 → 重算统计
  const full = reviewTrades(acct.trades, { initCash });
  const periodClosed = full.closed.filter((c) => c.date >= startDate && c.date <= endDate);
  const wins = periodClosed.filter((c) => c.pnl > 0);
  const losses = periodClosed.filter((c) => c.pnl < 0);
  const judged = wins.length + losses.length;
  const sumWin = wins.reduce((a, c) => a + c.pnl, 0);
  const sumLoss = losses.reduce((a, c) => a + c.pnl, 0);
  const avgWin = wins.length ? sumWin / wins.length : null;
  const avgLoss = losses.length ? sumLoss / losses.length : null;
  const plRatio = (avgWin != null && avgLoss != null && avgLoss < 0) ? avgWin / Math.abs(avgLoss) : null;
  const sorted = periodClosed.slice().sort((a, b) => b.pnl - a.pnl);
  return {
    startDate, endDate,
    navStart: r2(navStart), navEnd: r2(navEnd), navPeak: r2(navPeak), navTrough: r2(navTrough),
    navDelta: r2(navDelta), navDeltaPct,
    maxDd,
    closedCount: periodClosed.length, wins: wins.length, losses: losses.length, judged,
    winRate: judged > 0 ? wins.length / judged : null,
    plRatio: plRatio != null ? r2(plRatio) : null,
    best: sorted[0] || null, worst: sorted[sorted.length - 1] || null,
    curTotal: r2(stats.total),
    curPosPct: stats.total > 0 ? stats.marketValue / stats.total : null,
    posCount: Object.keys(acct.positions || {}).filter((c) => acct.positions[c] && acct.positions[c].qty > 0).length,
    drawdownNow: stats.drawdown,
    started: (Object.keys(acct.positions || {}).length > 0) || periodClosed.length > 0,
  };
}

const mkReport = (report_type, date, text) => ({  report_type,
  date,
  trigger: 'schedule',
  status: 'ok',
  generated_at: new Date().toISOString(),
  payload: { text },
});

/** 周度盈利战报（report_type='weekly_performance'）。discipline 为 AI 纪律点评（≤50 字，调用方传入）。 */
export function buildWeeklyPerformanceReport({ date, range, s, discipline }) {
  const lines = [
    `📊 【本周模拟盘战绩汇报】${range.startDate}~${range.endDate}`,
    `净值变动：${spct(s.navDeltaPct)}（${syuan(s.navDelta)} 元）→ 现 ${yuan(s.curTotal)}`,
    `胜率：${s.winRate == null ? '—（平仓样本不足）' : pct(s.winRate, 0)}（${s.wins}盈/${s.losses}亏，平仓 ${s.closedCount} 笔）`,
    `盈亏比：${s.plRatio == null ? '—' : s.plRatio}`,
    `目前总仓位：${pct(s.curPosPct, 0)}（${s.posCount} 只）`,
    `最大盈利/亏损单笔：${s.best ? `${s.best.name} ${syuan(s.best.pnl)}` : '—'} / ${s.worst ? `${s.worst.name} ${syuan(s.worst.pnl)}` : '—'}`,
    `💬 ${discipline || '本周无平仓，维持空仓观察。'}`,
  ];
  return mkReport('weekly_performance', date, lines.join('\n'));
}

/** 月度大复盘（report_type='monthly_review'）。macroReview 为 AI 宏观复盘（调用方传入）。 */
export function buildMonthlyReviewReport({ date, month, range, s, macroReview }) {
  const lines = [
    `🏆 【本月模拟盘终极汇报】${month}`,
    `本月总收益：${spct(s.navDeltaPct)}（${syuan(s.navDelta)} 元）｜期末净值 ${yuan(s.curTotal)}`,
    `⚠ 本月最大回撤：${pct(s.maxDd)}（当前回撤 ${pct(s.drawdownNow)}）`,
    `交易：${s.closedCount} 笔｜胜率 ${s.winRate == null ? '—' : pct(s.winRate, 0)}｜盈亏比 ${s.plRatio == null ? '—' : s.plRatio}`,
    `净值曲线：期初 ${yuan(s.navStart)} → 峰值 ${yuan(s.navPeak)} → 低谷 ${yuan(s.navTrough)} → 期末 ${yuan(s.navEnd)}`,
    `🤖 AI 宏观复盘：${macroReview || '本月数据不足，暂无法给出宏观复盘。'}`,
    '只读复盘 · 不构成投资建议',
  ];
  return mkReport('monthly_review', date, lines.join('\n'));
}

/**
 * EOD 推送优先级路由（纯函数，供编排与单测共用）。
 * 优先级：月报 > 周报(+周盈利战报) > 盘后基础复盘 > AI 盘后情报。
 *   · 月末：仅【月报】+【盘后基础复盘数据】；周报与 AI 盘后情报静默（avoid 同质化轰炸）。
 *   · 周五（非月末）：【周报】+【周盈利战绩】+【盘后基础复盘数据】；AI 盘后情报静默。
 *   · 普通交易日：【盘后基础复盘数据】+【AI 盘后情报】。
 * order 为消息发送顺序（供错峰调度依次发）；extras 标记需要额外构建的战报。
 */
export function composeEodPlan({ isMonthEnd, isWeekEnd }) {
  if (isMonthEnd) {
    return { suppressAiBrief: true, weekly: false, weeklyPerf: false, monthly: true, order: ['monthly_review', 'post_market_base'] };
  }
  if (isWeekEnd) {
    return { suppressAiBrief: true, weekly: true, weeklyPerf: true, monthly: false, order: ['weekly', 'weekly_performance', 'post_market_base'] };
  }
  return { suppressAiBrief: false, weekly: false, weeklyPerf: false, monthly: false, order: ['post_market_base', 'ai_brief'] };
}
