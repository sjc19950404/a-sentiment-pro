// ═══ 战绩报表（src/battle_report.js）+ 月末闸门（gateMonthly）══════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePeriodStats, buildWeeklyPerformanceReport, buildMonthlyReviewReport, composeEodPlan } from '../src/battle_report.js';
import { gateMonthly, gateWeekly } from '../src/ai_report_push.js';

// 夹具：一周（10-19 周一 ~ 10-24 周五）的账户，含 2 笔平仓（1 盈 1 亏）+ 一个未平持仓
const mkAccount = () => ({
  version: 1, initCash: 1000000, cash: 189000, freeze: 0, realized: -31, totalFee: 31,
  positions: { '600000': { code: '600000', name: '浦发银行', qty: 1000, avail: 1000, avgCost: 11, cost: 11000, last: 11 } },
  trades: [
    { side: 'buy', code: '600000', name: '浦发银行', qty: 1000, price: 10, gross: 10000, fee: 5, fillDate: '2026-10-20' },
    { side: 'sell', code: '600000', name: '浦发银行', qty: 1000, price: 12, gross: 12000, fee: 10, fillDate: '2026-10-22', reason: '隔日强制了结(连板)' },
    { side: 'buy', code: '000001', name: '平安银行', qty: 2000, price: 10, gross: 20000, fee: 8, fillDate: '2026-10-23' },
    { side: 'sell', code: '000001', name: '平安银行', qty: 2000, price: 9, gross: 18000, fee: 8, fillDate: '2026-10-24', reason: '硬止损 -5%' },
  ],
  nav: [
    { date: '2026-10-16', equity: 1000000 },   // 上周五（期前）
    { date: '2026-10-19', equity: 1000000 },   // 周一
    { date: '2026-10-21', equity: 1030000 },   // 周中峰值 +3万
    { date: '2026-10-24', equity: 1010000 },   // 周五收 +1万
  ],
  lastSettle: '2026-10-24',
});

test('computePeriodStats：净值变动/期内最大回撤/胜率/盈亏比/最大盈亏单笔/仓位', () => {
  const s = computePeriodStats(mkAccount(), { startDate: '2026-10-19', endDate: '2026-10-24' });
  assert.equal(s.navStart, 1000000, '期初净值取期前最后一笔');
  assert.equal(s.navEnd, 1010000, '期末净值 = 期内最后一日');
  assert.equal(s.navDelta, 10000, '净值变动金额');
  assert.ok(Math.abs(s.navDeltaPct - 0.01) < 1e-9, '净值变动 %');
  assert.ok(Math.abs(s.maxDd - 20000 / 1030000) < 1e-6, `期内最大回撤（峰值103万→101万），实际 ${s.maxDd}`);
  assert.equal(s.navPeak, 1030000, '期内峰值');
  assert.equal(s.closedCount, 2, '期内平仓 2 笔');
  assert.equal(s.wins, 1); assert.equal(s.losses, 1);
  assert.equal(s.winRate, 0.5, '胜率 50%');
  assert.ok(s.plRatio > 0.9 && s.plRatio < 1.0, `盈亏比 ≈0.985，实际 ${s.plRatio}`);
  assert.equal(s.best.code, '600000', '最大盈利单');
  assert.equal(s.best.pnl, 1985);
  assert.equal(s.worst.code, '000001', '最大亏损单');
  assert.equal(s.worst.pnl, -2016);
  assert.equal(s.posCount, 1, '当前持仓 1 只');
  assert.ok(s.curPosPct > 0 && s.curPosPct < 0.2, `仓位占比 ${s.curPosPct}`);
});

test('computePeriodStats：期前买入、期内卖出 → 正确归因（不被当孤儿单跳过）', () => {
  const a = mkAccount();
  // 追加一笔：10-15 买入、10-23 卖出（跨入本周）——全量 FIFO 才能配对
  a.trades.push({ side: 'buy', code: '300750', name: '宁德时代', qty: 100, price: 200, gross: 20000, fee: 6, fillDate: '2026-10-15' });
  a.trades.push({ side: 'sell', code: '300750', name: '宁德时代', qty: 100, price: 210, gross: 21000, fee: 8, fillDate: '2026-10-23' });
  const s = computePeriodStats(a, { startDate: '2026-10-19', endDate: '2026-10-24' });
  assert.equal(s.closedCount, 3, '跨期买入也应计入本期内平仓');
  assert.equal(s.wins, 2, '宁德时代也是盈利单');
});

test('buildWeeklyPerformanceReport：七要素齐全（净值/胜率/盈亏比/仓位/最大盈亏单/纪律点评）', () => {
  const s = computePeriodStats(mkAccount(), { startDate: '2026-10-19', endDate: '2026-10-24' });
  const r = buildWeeklyPerformanceReport({ date: '2026-10-24', range: { startDate: '2026-10-19', endDate: '2026-10-24' }, s, discipline: '本周触发纪律2次，回撤控制良好。' });
  assert.equal(r.report_type, 'weekly_performance');
  const t = r.payload.text;
  assert.ok(t.includes('📊 【本周模拟盘战绩汇报】'));
  assert.ok(t.includes('净值变动：+1.00%'), t);
  assert.ok(t.includes('胜率：50%'));
  assert.ok(t.includes('盈亏比：'));
  assert.ok(t.includes('目前总仓位：'));
  assert.ok(t.includes('最大盈利/亏损单笔：浦发银行'));
  assert.ok(t.includes('💬 本周触发纪律2次'));
});

test('buildMonthlyReviewReport：总收益/最大回撤/笔数/胜率/净值曲线/AI 复盘齐全', () => {
  const s = computePeriodStats(mkAccount(), { startDate: '2026-10-01', endDate: '2026-10-24' });
  const r = buildMonthlyReviewReport({ date: '2026-10-30', month: '2026-10', range: { startDate: '2026-10-01', endDate: '2026-10-30' }, s, macroReview: '本月连板情绪活跃，策略适应，下月严止损。' });
  assert.equal(r.report_type, 'monthly_review');
  const t = r.payload.text;
  assert.ok(t.includes('🏆 【本月模拟盘终极汇报】2026-10'));
  assert.ok(t.includes('本月总收益：'));
  assert.ok(t.includes('⚠ 本月最大回撤：'), '最大回撤极其关键，必须显式');
  assert.ok(t.includes('净值曲线：期初'));
  assert.ok(t.includes('🤖 AI 宏观复盘：本月连板情绪活跃'));
  assert.ok(t.includes('不构成投资建议'));
});

test('gateMonthly：月末放行 / 周中拦截 / 月末逢周五也放行（配合周报做优先级）', () => {
  assert.equal(gateMonthly('2026-10-30', []).ok, true, '10-30 周五 = 10 月最后交易日');
  assert.equal(gateMonthly('2026-11-30', []).ok, true, '11-30 周一 = 11 月最后交易日');
  assert.equal(gateMonthly('2026-10-15', []).ok, false, '周中 → 等月末');
  assert.match(gateMonthly('2026-10-15', []).reason, /2026-10-16/, '拦截理由给出下一交易日');
  assert.equal(gateMonthly('国庆', []).ok, false, '非法日期 → 拦');
  assert.equal(gateMonthly('2026-09-29', []).ok, false, '9-29 后 9-30(周三)仍开市 → 非月末');
  assert.equal(gateMonthly('2026-09-29', ['2026-09-30']).ok, true, '9-30 休市 → 9-29 即本月最后交易日（closedDays 只影响 tradeDate 之后的同月日）');
  // 月末逢周五：月报与周报闸门同时为真 → 编排层按月报优先（此处仅证明两闸门可同时成立）
  assert.equal(gateMonthly('2026-10-30', []).ok && gateWeekly('2026-10-30', []).ok, true, '10-30 同时是月末与周末');
});

test('composeEodPlan：月末/周五/普通 三态优先级路由 + AI 情报抑制', () => {
  // 月末：月报 + 基础复盘；周报与 AI 情报静默
  const m = composeEodPlan({ isMonthEnd: true, isWeekEnd: true });
  assert.deepEqual(m.order, ['monthly_review', 'post_market_base'], '月末：月报优先，仅 + 基础复盘');
  assert.equal(m.suppressAiBrief, true, '月末静默 AI 情报');
  assert.equal(m.weekly, false); assert.equal(m.weeklyPerf, false); assert.equal(m.monthly, true);

  // 周五（非月末）：周报 + 周盈利战报 + 基础复盘；AI 情报静默
  const w = composeEodPlan({ isMonthEnd: false, isWeekEnd: true });
  assert.deepEqual(w.order, ['weekly', 'weekly_performance', 'post_market_base'], '周五：周报+周盈利+基础复盘');
  assert.equal(w.suppressAiBrief, true, '周五静默 AI 情报');
  assert.equal(w.weekly, true); assert.equal(w.weeklyPerf, true); assert.equal(w.monthly, false);

  // 普通交易日：基础复盘 + AI 情报（不抑制）
  const n = composeEodPlan({ isMonthEnd: false, isWeekEnd: false });
  assert.deepEqual(n.order, ['post_market_base', 'ai_brief'], '普通日：基础复盘 + AI 情报');
  assert.equal(n.suppressAiBrief, false, '普通日照常推 AI 情报');
});
