// ═══ P0 双池硬过滤 + 推送全中文（2026-10-10 用户指令 · 合 main 前置门禁）═══
//
// 两条断言，CI 必跑（node --test 自动发现；门禁① 显式 test/*.test.mjs）：
//   ① 趋势池入口硬过滤：isLianban（连板白名单分流）/ isLimitUp / isLimitDown
//      直接剔除——10-09 事故（连板/跌停股混进「涨幅3-7%·未涨停」趋势池）回归锁。
//   ② 推送文案全中文：英文枚举/字段名一律在渲染层翻中文，≥2 连串 ASCII 字母
//      只许 AI / ETF（中文财经通用缩写）——neutral/recover/trackA.maxDd/Top/PE/pp
//      等系统词汇绝不进群。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntradayPool } from '../src/ai_report.js';
import { renderPushText } from '../src/push_text.js';

// ── 夹具：v4 盘中快照（10-09 实况骨架——梯/max_lb 口径与真实收盘一致）──────
const snap1009 = {
  tradeDate: '2026-10-09', capturedAtBJ: '2026-10-09 10:30', phase: 'live',
  hot: {
    count: 4, srcDate: '2026-10-09',
    rows: [
      { code: '600825', name: '新华传媒', change_pct: 9.99, liangbi: 5.1, main_net: 1.2e8 },  // 9 连板 → 白名单分流连板池
      { code: '000002', name: '涨停股', change_pct: 9.99, liangbi: 3.0, main_net: 1e8 },      // 今日涨停（无连板身份）→ 硬剔
      { code: '603949', name: '雪龙集团', change_pct: -9.98, liangbi: 4.2, main_net: -3e7 },  // 跌停 → 硬剔
      { code: '600617', name: '干净趋势股', change_pct: 4.5, liangbi: 3.0, main_net: 5e7 },  // 四条件全过 → 趋势池
    ],
  },
  pools: {
    zt_codes: ['600825', '000002'],
    prev_zt_codes: ['600825', '603949'],
    zt_lb: { 600825: 9 },
    zt_detail: [{ c: '600825', fbt: '142030', fund: 1421000000 }],
  },
};

test('① 趋势池硬过滤：连板/涨停/跌停入口直接剔除，绝不混入「3-7%·未涨停」池', () => {
  const built = buildIntradayPool(snap1009, { tradeDate: '2026-10-09', nowBJ: '10:30' });
  // 趋势池：只剩干净趋势股——连板/涨停/跌停一只都进不来
  assert.deepEqual(built.pool.map((s) => s.code), ['600617'], '趋势池只含四条件全过标的');
  assert.ok(!built.pool.some((s) => s.intraday_chg >= 9.9 || s.intraday_chg <= -9.9), '池内绝无涨跌停');
  // 连板池：连板股走白名单分流（独立评分，不套涨幅带）
  assert.deepEqual(built.streak_pool.map((s) => s.code), ['600825'], '连板股进连板池而非趋势池');
  assert.equal(built.streak_pool[0].selection_reason, '9 连板');
  assert.equal(built.streak_pool[0].seal_amount, 1421000000, '封单真实额（东财 fund）');
  assert.ok(built.streak_pool[0].streak_score != null, '连板池独立梯队分在场');
  // 跌停/涨停台账显式归类（不再混在「带外」桶——雪龙式断板跌停归因清晰）
  assert.match(built.basis, /已涨停 1 \/ 跌停 1 /, '硬剔台账：涨停/跌停逐项计数');
  assert.match(built.streak_basis, /连板池实时现算/, '连板池口径独立成文（标题=筛选面）');
});

test('② 推送文案全中文：四类报告渲染零英文（白名单仅 AI/ETF）', () => {
  const mkIntra = (over = {}) => ({
    report_type: 'intraday', date: '2026-10-09', trigger: 'test_push',
    generated_at: new Date().toISOString(), status: 'ok',
    payload: {
      drawdown_vs_threshold: { dd_now: 0.1416, distance_pp: 0.84, basis: '归档轨·运行回撤（非当日）' },
      pnl_daily: -0.005, pnl_cumulative: -0.0199, overseas: [{ key: 'a50', chgPct: -0.0028 }],
      simulation_stock: {
        sentiment_cycle: { phase: 'fermentation', phase_label: '发酵期', regime_raw: 'recover' },
        position_suggestion: 'neutral', trend_pool_mode: 'trend',
        candidate_pool: [{ code: '600617', name: '干净趋势股', score: 0.8, themes: ['电池'], selection_reason: '量比 3', intraday_chg: 4.5, fundamentals: { pe: 12.3, pb: null }, data_completeness: { level: 'full', missing: [] }, fund_flow_note: '主力净流入 +5000 万' }],
        streak_pool: [{ code: '600825', name: '新华传媒', score: null, streak_score: 0.9, seal_amount: 1.421e9, themes: ['文化传媒'], selection_reason: '9 连板', intraday_chg: 9.99, fundamentals: { pe: null, pb: null }, data_completeness: { level: 'partial', missing: ['估值'] } }],
      },
      ma20_degraded: true,
    },
    missing_notes: [],
    ...over,
  });
  const intra = renderPushText(mkIntra());
  // 关键翻译逐项锁定
  assert.ok(intra.includes('建议仓位: 中性'), 'neutral → 中性');
  assert.ok(intra.includes('情绪周期: 发酵期') && !intra.includes('recover'), 'recover 等英文枚举不进文案');
  assert.ok(intra.includes('市盈率 12.3') && !intra.includes('PE '), 'PE → 市盈率');
  assert.ok(intra.includes('距回撤档位 0.84 个百分点') && !intra.includes('pp') && !intra.includes('DD '), 'DD 档位 → 回撤档位；pp → 个百分点');
  assert.ok(intra.includes(' · 测试推送') && !intra.includes('test_push'), 'trigger 枚举翻中文');
  assert.ok(intra.includes('前 1 名') && !intra.includes('Top'), 'Top → 前 N 名');
  assert.ok(intra.includes('20日均线降级版') && !intra.includes('MA20'), 'MA20 → 20日均线');

  // 四类报告全量扫：≥2 连串 ASCII 字母只许 AI / ETF（中文财经通用缩写）
  const reports = [
    intra,
    renderPushText(mkIntra({
      report_type: 'pre_market',
      payload: { date: '2026-10-09', pnl_daily: -0.005, pnl_cumulative: -0.0199, prev_nav: 0.98, overseas: [{ key: 'a50', chgPct: -0.0028 }, { key: 'sox', chgPct: 0.01 }], overnight_exposure: { posGap: 4, us_close: { dji: 0.0049, spx: 0.0058, ixic: 0.0045 }, cn_overnight: { hxc: 0.0031, fxi: -0.0024 }, cnh_chgPct: null }, simulation_stock: { sentiment_cycle: { highest_chain: 9, broken_limit_ratio: 0.2088 } }, watchlist: { ladder: [{ code: '600825', name: '新华传媒', lb: 9, kept: true, chg: 9.99, appearances: 8 }] } },
    })),
    renderPushText(mkIntra({
      report_type: 'post_market',
      payload: { pnl_daily: 0.01, pnl_cumulative: -0.02, close_drawdown: 0.1, market_context: { up_down: '3200/1900', zt_dt: '72/10', pain: '晋级失败 40%' }, backtest_deviation: { delta: 0.003 }, simulation_stock: { sentiment_cycle: { phase: 'fermentation', phase_label: '发酵期', regime_raw: 'recover' }, position_suggestion: 'neutral', candidate_pool: [{ code: '600825', name: '新华传媒', intraday_chg: null }] } },
    })),
    renderPushText(mkIntra({
      report_type: 'weekly',
      payload: { week_return: 0.02, max_drawdown_week: 0.03, profit_trade_ratio: 0.6, trend_switch_hits: 2, win_rate: null, trend_switch_effect: null },
    })),
  ];
  for (const [i, text] of reports.entries()) {
    const anglicisms = (text.match(/[A-Za-z]{2,}/g) || []).filter((w) => w !== 'AI' && w !== 'ETF');
    assert.deepEqual(anglicisms, [], `第 ${i + 1} 类推送必须全中文，残留英文词汇：${anglicisms.join(', ')}`);
  }
});
