// ── 推送前校验 + 收盘口径复核（2026-10-10 用户指令）──────────────────────────
// 纯函数三件套（src/pool_verify.js）的规则核验：判据与 buildIntradayPool 同源、
// 剔除/降级幂等、skipped 不冒充、closeout 台账结构。
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyIntradayPools, applyVerification, closeoutReview } from '../src/pool_verify.js';

// ── fixture ────────────────────────────────────────────────────────────────
const mkReport = (sim) => ({
  report_type: 'intraday',
  date: '2026-10-12',
  payload: { simulation_stock: sim },
});
const mkSim = ({ trend = [], streak = [], mode = 'trend', snapAt = '2026-10-12 10:00' } = {}) => ({
  candidate_pool: trend,
  streak_pool: streak,
  trend_pool_mode: mode,
  snapshotAtBJ: snapAt,
  sentiment_cycle: { phase: 'fermentation', regime_raw: 'recover' },
});
const trendItem = (code, over = {}) => ({ code, name: `股${code}`, score: 0.6, selection_reason: '量比 3.0', ...over });
const streakItem = (code, over = {}) => ({ code, name: `股${code}`, score: null, selection_reason: '3 连板', ...over });

const mkSnap = (rows, { zt = [], ztlb = {}, at = '2026-10-12 10:00', prevZt = null, ztDetail = null } = {}) => ({
  tradeDate: '2026-10-12',
  capturedAtBJ: at,
  hot: { rows },
  screener: null,
  pools: { zt_codes: zt, zt_lb: ztlb, prev_zt_codes: prevZt, zt_detail: ztDetail },
});
const row = (code, over = {}) => ({ code, name: `股${code}`, change_pct: 5, liangbi: 3, main_net: 1e7, ...over });

// ── verifyIntradayPools：趋势池四条件 ───────────────────────────────────────
test('verify：四条件全过 → 零剔除，patched 同池（幂等基线）', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600001'), trendItem('600002')] }));
  const { summary, patched } = verifyIntradayPools(r, mkSnap([row('600001'), row('600002')]));
  assert.equal(summary.applied, false, 'verify 阶段未应用');
  assert.deepEqual(summary.trend.removed, []);
  assert.deepEqual(patched.candidate_pool.map((x) => x.code), ['600001', '600002']);
});

test('verify：已涨停（zt_codes 名单）→ 结构违背恒剔除并留 reason（带内涨幅也剔——名单权威）', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600001')] }));
  const { summary, patched } = verifyIntradayPools(r, mkSnap([row('600001', { change_pct: 6 })], { zt: ['600001'] }));
  assert.deepEqual(patched.candidate_pool, []);
  assert.equal(summary.trend.removed[0].reason, '已涨停（最新快照现 6%）——结构违背恒剔除');
  assert.equal(summary.trend.removed[0].kind, 'structural', 'kind=structural（P0：恒剔不受同拍守卫）');
});

test('verify：四条件各剔一种——涨幅出带/量比不足/主力转负/掉出底座', () => {
  const r = mkReport(mkSim({ trend: [trendItem('A1'), trendItem('A2'), trendItem('A3'), trendItem('A4')] }));
  const { summary, patched } = verifyIntradayPools(r, mkSnap([
    row('A1', { change_pct: 8 }),          // 出带上沿
    row('A2', { change_pct: 2 }),          // 出带下沿
    row('A3', { liangbi: 2 }),            // 量比 == 2 不满足 >2
    row('A4', { main_net: -5 }),          // 转负
    // A4 之外无 A5 行 → 掉底座
  ]), {});
  assert.deepEqual(patched.candidate_pool, []);
  const reasons = summary.trend.removed.map((x) => x.reason);
  assert.ok(reasons[0].startsWith('涨幅出带（现 8%'));
  assert.ok(reasons[1].startsWith('涨幅出带（现 2%'));
  assert.equal(reasons[2], '量比不足（现 2）');
  assert.equal(reasons[3], '主力净流入转负');
});

test('verify：掉出数据底座（最新快照已无此股）→ 剔除不冒充', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600009')] }));
  const { summary, patched } = verifyIntradayPools(r, mkSnap([row('600001')]));
  assert.deepEqual(patched.candidate_pool, []);
  assert.equal(summary.trend.removed[0].reason, '掉出数据底座（最新快照已无此股）');
});

// ── verifyIntradayPools：连板池 ─────────────────────────────────────────────
test('verify：连板身份消失（zt_lb 无此股——疑似炸板）→ streak 剔除；量比/主力照核', () => {
  const r = mkReport(mkSim({
    streak: [streakItem('600101'), streakItem('600102'), streakItem('600103')],
  }));
  const { summary, patched } = verifyIntradayPools(r, mkSnap(
    [row('600101'), row('600102', { liangbi: 1.5 }), row('600103')],
    { ztlb: { 600101: 3, 600102: 4 } }, // 600103 无 → 身份消失
  ));
  assert.deepEqual(patched.streak_pool.map((x) => x.code), ['600101']);
  assert.equal(summary.streak.removed[0].reason, '量比不足（现 1.5）');
  assert.equal(summary.streak.removed[1].reason, '连板身份消失（最新快照涨停池无此股——疑似炸板）');
});

test('verify：zt_lb 缺席（旧快照 v2）但档案有 streak → 全部不可核验剔除（宁缺毋假）', () => {
  const r = mkReport(mkSim({ streak: [streakItem('600201')] }));
  const { summary, patched } = verifyIntradayPools(r, mkSnap([row('600201')], { ztlb: null }));
  assert.deepEqual(patched.streak_pool, []);
  assert.ok(summary.streak.removed[0].reason.startsWith('连板身份消失'));
});

// ── 降级窗复核 ──────────────────────────────────────────────────────────────
test('verify：推送时刻进降级窗（快照 14:53）→ trend 升 tomorrow_watch + mode_degraded', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600001')], snapAt: '2026-10-12 14:53' }));
  const { summary, patched } = verifyIntradayPools(r, mkSnap([row('600001')], { at: '2026-10-12 14:53' }));
  assert.equal(patched.trend_pool_mode, 'tomorrow_watch');
  assert.equal(summary.mode_degraded, true);
  assert.equal(summary.minutes_to_close, 7);
});

test('verify：opts.nowBJ 显式优先（10:00 快照 + 14:35 推送）→ 按推送时刻降级', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600001')] }));
  const { summary } = verifyIntradayPools(r, mkSnap([row('600001')], { at: '2026-10-12 10:00' }), { nowBJ: '14:35' });
  assert.equal(summary.trend_pool_mode, 'tomorrow_watch', '推送时刻（非快照时刻）进窗 → 降级');
  assert.equal(summary.minutes_to_close, 25);
});

test('verify：报告已 tomorrow_watch → 不回退（时点语义不可逆）；普通时点不降级', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600001')], mode: 'tomorrow_watch' }));
  const { summary, patched } = verifyIntradayPools(r, mkSnap([row('600001')], { at: '2026-10-12 10:00' }), { nowBJ: '10:05' });
  assert.equal(patched.trend_pool_mode, 'tomorrow_watch');
  assert.equal(summary.mode_degraded, false, '已降级的不算「本轮降级」');
});

// ── skipped：快照缺席/非当日 → 不冒充 ─────────────────────────────────────────
test('verify：快照非当日/缺席 → patched=null + note 报因（不拿旧快照冒充复核）', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600001')] }));
  const stale = verifyIntradayPools(r, mkSnap([row('600001')], { at: '2026-10-11 15:00' }));
  // mkSnap tradeDate 固定 2026-10-12，构造非当日：直接改
  const snap2 = { ...mkSnap([row('600001')]), tradeDate: '2026-10-11' };
  const off = verifyIntradayPools(r, snap2);
  assert.equal(off.patched, null);
  assert.ok(off.summary.note.includes('≠ 2026-10-12'));
  const none = verifyIntradayPools(r, null);
  assert.equal(none.patched, null);
  assert.ok(none.summary.note.includes('缺席/非当日'));
  assert.ok(stale.summary.snapshotAtBJ, '快照时点照记（审计事实）');
});

test('verify：非 intraday 报告（post_market）→ 跳过（推送前校验只覆盖盘中口径）', () => {
  const r = { ...mkReport(mkSim()), report_type: 'post_market' };
  const { summary, patched } = verifyIntradayPools(r, mkSnap([row('600001')]));
  assert.equal(patched, null);
  assert.ok(summary.note.includes('非盘中口径'));
});

// ── 同拍守卫（周六本地冒烟实录：跨拍误剔 10/10 → 修复）──────────────────────
test('verify：跨拍（快照拍 ≠ 档案构建拍）→ 时点判据不剔除不记台账；结构违背跨拍仍恒剔除（P0）', () => {
  // 档案构建于 10:00 拍（标的在池），复核快照已是 14:53 拍（标的已掉出底座）
  const r = mkReport(mkSim({ trend: [trendItem('600001')], snapAt: '2026-10-12 10:00' }));
  const { summary, patched } = verifyIntradayPools(r, mkSnap([row('600999')], { at: '2026-10-12 14:53' }));
  assert.equal(patched, null, '跨拍纯时点差 → patched=null（时点剔除会改写历史档案）');
  assert.ok(summary.note.includes('时点判据不剔除'), 'note 披露跨拍语义（P0 收窄后）');
  assert.equal(summary.trend.removed.length, 0, '跨拍掉底座不进 removed（时点差不是违规）');
});

test('verify：旧档案（无 snapshotAtBJ 字段）→ 同样只审计不剔除（保护历史）', () => {
  const sim = mkSim({ trend: [trendItem('600001')] });
  delete sim.snapshotAtBJ;
  const r = mkReport(sim);
  const { summary, patched } = verifyIntradayPools(r, mkSnap([row('600001')]));
  assert.equal(patched, null);
  assert.ok(summary.note.includes('未记录（旧档）'));
  assert.equal(summary.trend.removed.length, 0, '同拍数据的标的核验照跑（观察）');
});

// ── applyVerification：应用 + 幂等 ───────────────────────────────────────────
test('apply：池替换 + push_verification.applied=true；再 verify 幂等（无二次剔除、mode 稳定）', () => {
  const snap = mkSnap([
    row('600001'), row('600002', { change_pct: 9 }), row('600101'),
  ], { zt: [], ztlb: { 600101: 3 }, at: '2026-10-12 14:50' });
  const r = mkReport(mkSim({ trend: [trendItem('600001'), trendItem('600002')], streak: [streakItem('600101')], snapAt: '2026-10-12 14:50' }));
  const v1 = verifyIntradayPools(r, snap);
  applyVerification(r, v1);
  assert.equal(r.payload.simulation_stock.candidate_pool.map((x) => x.code).join(), '600001');
  assert.equal(r.payload.simulation_stock.trend_pool_mode, 'tomorrow_watch');
  assert.equal(r.push_verification.applied, true);
  assert.equal(r.push_verification.trend.removed.length, 1);
  // 幂等：同快照再校验 → 零剔除、mode 不回退
  const v2 = verifyIntradayPools(r, snap);
  applyVerification(r, v2);
  assert.equal(r.payload.simulation_stock.candidate_pool.map((x) => x.code).join(), '600001');
  assert.deepEqual(v2.summary.trend.removed, []);
  assert.equal(v2.summary.trend_pool_mode, 'tomorrow_watch');
  assert.equal(v2.summary.mode_degraded, false, '已降级档案不再标记「本轮降级」');
});

test('apply：skipped（patched=null）→ 池不动，台账 applied=false + note（审计完整）', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600001')] }));
  const v = verifyIntradayPools(r, null);
  applyVerification(r, v);
  assert.equal(r.payload.simulation_stock.candidate_pool.length, 1, 'skipped 不动池');
  assert.equal(r.push_verification.applied, false);
  assert.ok(r.push_verification.note);
});

// ── closeoutReview：收盘口径复核 ────────────────────────────────────────────
const ztpoolDays = [
  { date: '20261009', pool: [{ c: '000001', lbc: 2, zbc: 0, hybk: '电池' }] },
  { date: '20261012', pool: [
    { c: '600001', lbc: 1, zbc: 0, hybk: '电池' },
    { c: '600101', lbc: 5, zbc: 0, hybk: '半导体' },
  ] },
];
test('closeout：池标的收盘结局（涨停/未涨停/几连板）+ 收盘情绪现算', () => {
  const r = mkReport(mkSim({
    trend: [trendItem('600001'), trendItem('600002')],
    streak: [streakItem('600101')],
  }));
  r.payload.simulation_stock.live_emotion = { date: '20261012', emotion: '主升', score: 70 };
  const rv = closeoutReview(r, ztpoolDays, { nowBJ: '2026-10-12 18:35' });
  assert.equal(rv.ztpoolDate, '20261012');
  assert.equal(rv.emotion_at_push.emotion, '主升');
  assert.ok(rv.close_emotion && typeof rv.close_emotion.emotion === 'string', '收盘情绪从 ztpool 现算（不依赖 emotion_history）');
  assert.deepEqual(rv.pool_outcome.trend.map((x) => [x.code, x.close_limit_up]), [['600001', true], ['600002', false]]);
  assert.equal(rv.pool_outcome.streak[0].close_lbc, 5);
  assert.equal(rv.conflicts.length, 1, '盘中宣称 3 连板 vs 收盘 5 连板（差 2 >1）→ 进矛盾台账');
  assert.equal(rv.conflicts[0].code, '600101');
});

test('closeout：连板矛盾（盘中宣称 3 连板 vs 收盘 lbc 5，差>1）→ conflicts 台账', () => {
  const r = mkReport(mkSim({ streak: [{ code: '600101', name: '股600101', score: null, selection_reason: '3 连板' }] }));
  const rv = closeoutReview(r, ztpoolDays, {});
  assert.equal(rv.conflicts.length, 1);
  assert.equal(rv.conflicts[0].close_lbc, 5);
  assert.equal(rv.conflicts[0].intraday_claim, '3 连板');
});

test('closeout：晋级/断板（±1 连板）不进 conflicts——那是行情不是数据错误', () => {
  const days = [{ date: '20261012', pool: [{ c: '600101', lbc: 4, zbc: 0, hybk: 'x' }] }, { date: '20261011', pool: [{ c: '600101', lbc: 3, zbc: 0, hybk: 'x' }] }];
  const r = mkReport(mkSim({ streak: [{ code: '600101', score: null, selection_reason: '3 连板' }] }));
  const rv = closeoutReview(r, days, {});
  assert.deepEqual(rv.conflicts, [], '3→4 连板（晋级）是正常行情变化');
});

test('closeout：ztpool 无当日行（16:00 本地任务未入库）→ note 报因跳过，不误伤', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600001')] }));
  const rv = closeoutReview(r, [{ date: '20261009', pool: [{ c: '600001', lbc: 1, zbc: 0, hybk: 'x' }] }], {});
  assert.equal(rv.ztpoolDate, null);
  assert.equal(rv.pool_outcome, null);
  assert.ok(rv.note.includes('16:00 本地任务未跑或未入库'));
});

test('closeout：无 simulation_stock（模拟选股关闭日）→ note 跳过', () => {
  const rv = closeoutReview({ report_type: 'intraday', date: '2026-10-12', payload: {} }, ztpoolDays, {});
  assert.ok(rv.note.includes('无 simulation_stock'));
});

// ── P0 双池物理拆分（2026-10-10 实盘事故）：结构违背恒剔除，不受同拍守卫 ──────────
test('P0 结构预筛：旧档连板股混入趋势池（reason 自称连板）→ 快照缺席仍恒剔除并应用', () => {
  // 10-09 事故原样：旧档 candidate_pool 全是连板股（新华传媒 6 连板 9.99% / 雪龙 4 连板 -9.98% 跌停），
  // 快照已换日——档案自证字段（selection_reason/intraday_chg）是唯一防线。
  const sim = mkSim({
    trend: [
      trendItem('600825', { selection_reason: '6 连板（当日 9.99%，晋级成功，近期上榜 8 次）', intraday_chg: 9.99 }),
      trendItem('603949', { selection_reason: '4 连板（当日 -9.98%，晋级失败，近期上榜 7 次）', intraday_chg: -9.98 }),
      trendItem('600100', { selection_reason: '量比 3.0', intraday_chg: 5.2 }), // 干净标的
    ],
    snapAt: null, // 旧档无 snapshotAtBJ
  });
  const r = mkReport(sim);
  const { summary, patched } = verifyIntradayPools(r, null);
  assert.equal(summary.trend.removed.length, 2, '连板股 + 跌停股双双结构剔除');
  assert.ok(summary.trend.removed.every((x) => x.kind === 'structural'), 'kind=structural');
  assert.match(summary.trend.removed[0].reason, /连板股混入趋势池（档案自称 6 连板）/);
  // 雪龙型（4 连板 -9.98% 跌停）：连板声称判据先行命中——「连板混入」即本质报因
  assert.match(summary.trend.removed[1].reason, /连板股混入趋势池（档案自称 4 连板）/);
  assert.deepEqual(patched.candidate_pool.map((x) => x.code), ['600100'], '干净标的保留——剔除错误数据不是清空档案');
  assert.ok(summary.note.includes('结构预筛照常执行'), 'note 披露快照缺席但结构预筛生效');
});

test('P0 跨拍：快照在场非构建拍，连板身份股（zt_lb）仍恒剔除；时点掉底座保留', () => {
  const sim = mkSim({
    trend: [
      trendItem('600001'),                                // 掉出底座（时点差）→ 跨拍保留
      trendItem('600003', { selection_reason: '量比 3' }), // 在底座但 zt_lb 连板身份 → 结构剔除
    ],
    snapAt: '2026-10-12 10:00',
  });
  const r = mkReport(sim);
  const snap = mkSnap([row('600003', { change_pct: 6 })], { at: '2026-10-12 14:53', ztlb: { 600003: 3 } });
  const { summary, patched } = verifyIntradayPools(r, snap);
  assert.deepEqual(patched.candidate_pool.map((x) => x.code), ['600001'], '结构剔除跨拍应用；时点掉底座保留');
  assert.equal(summary.trend.removed.filter((x) => x.kind === 'structural').length, 1);
  assert.ok(summary.trend.removed[0].reason.includes('连板身份'), '连板身份结构剔除');
});

test('P0 昨日涨停黑名单：prev_zt_codes 断板股混入趋势池 → 结构恒剔除', () => {
  const r = mkReport(mkSim({ trend: [trendItem('600001')] }));
  const snap = mkSnap([row('600001', { change_pct: 5 })], { prevZt: ['600001'] });
  const { summary, patched } = verifyIntradayPools(r, snap);
  assert.deepEqual(patched.candidate_pool, [], '断板股（昨日涨停今日回落）结构剔除——10-09 雪龙型污染');
  assert.match(summary.trend.removed[0].reason, /昨日涨停断板股（黑名单）——结构违背恒剔除/);
});

test('P0 连板池一字板：zt_detail fbt<=092500 → 结构恒剔除（今日非一字白名单）', () => {
  const r = mkReport(mkSim({ streak: [streakItem('600005'), streakItem('600006')] }));
  const snap = mkSnap([row('600005'), row('600006')], {
    zt: ['600005', '600006'],
    ztlb: { 600005: 3, 600006: 2 },
    ztDetail: [
      { c: '600005', lbc: 3, fbt: '092500', fund: 5e7 },  // 一字（集合竞价封死）→ 剔
      { c: '600006', lbc: 2, fbt: '101530', fund: 3e7 },  // 盘中封板 → 留
    ],
  });
  const { summary, patched } = verifyIntradayPools(r, snap);
  assert.deepEqual(patched.streak_pool.map((x) => x.code), ['600006'], '一字无买入窗口结构剔除');
  assert.match(summary.streak.removed[0].reason, /今日一字（fbt 092500/);
});

test('P0 修复回归（2026-10-10）：fbt 数字形态（一字 92500）推送前校验同样剔除', () => {
  // 与 ai_report_split 同款防线：历史档/东财原始 fbt 是数字（前导零丢失），
  // 修复前 String(92500)="92500">"092500" → CI 同拍校验漏放（10-09 实录：核 9 剔 0，
  // 新华传媒一字未剔）。修复后 padStart 规范化，两形态同判。
  const r = mkReport(mkSim({ streak: [streakItem('600005'), streakItem('600006')] }));
  const snap = mkSnap([row('600005'), row('600006')], {
    zt: ['600005', '600006'],
    ztlb: { 600005: 3, 600006: 2 },
    ztDetail: [
      { c: '600005', lbc: 3, fbt: 92500, fund: 5e7 },   // 数字 一字 → 剔（修复前漏放）
      { c: '600006', lbc: 2, fbt: 101530, fund: 3e7 },  // 数字 盘中封板 → 留
    ],
  });
  const { summary, patched } = verifyIntradayPools(r, snap);
  assert.deepEqual(patched.streak_pool.map((x) => x.code), ['600006'], '数字 fbt 一字板结构剔除');
  assert.match(summary.streak.removed[0].reason, /今日一字（fbt 092500/, 'reason 报规范化后的 HHMMSS');
});
