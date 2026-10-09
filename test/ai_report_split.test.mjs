// ── 任务一/任务二拆分（2026-10-09 用户指令）单元测试 ──────────────────────
//   任务一 buildWatchlist：昨收口径连板梯队（观察清单语义，不含操作建议字段）。
//   任务二 buildIntradayPool：实时口径筛选（3-7% / 量比>2 / 未涨停 / 主力净流入
//   为正）+ 综合得分 + 每轮重算；快照缺席/陈旧 → 空池报因，绝不回落昨收口径
//   （与任务一数据源物理隔离——这是本拆分的核心纪律）。
// 数据面全部用手写夹具（纯函数测试，零网络）。
// ──────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWatchlist, buildIntradayPool, INTRADAY_POOL_FILTERS, minutesToCloseBJ,
} from '../src/ai_report.js';

// ── 任务一：盘前观察清单 ────────────────────────────────────────────────
test('buildWatchlist：连板梯队按连板数降序 Top 10，名称/上榜次数经 nameMap 注入，缺则 null', () => {
  const detail = [
    { code: '600825', lb: 6, chg: 9.99, kept: true },
    { code: '603949', lb: 4, chg: -9.98, kept: false },
    { code: '000000', lb: 9, chg: 10.0, kept: true }, // 未映射名称
  ];
  const w = buildWatchlist({ signals: { pain: { advance: { detail, maxLb: 9 } }, latest: { zt_count: 40, zb_count: 10 } } },
    { nameMap: { 600825: { name: '新华传媒', appearances: 8 }, 603949: { name: '雪龙集团' } } });
  assert.equal(w.ladder[0].code, '000000', '9 连板排最前（lb 降序）');
  assert.equal(w.ladder[0].name, null, 'nameMap 缺席 → null（不造数）');
  assert.equal(w.ladder[1].code, '600825');
  assert.equal(w.ladder[1].appearances, 8);
  assert.equal(w.ladder[2].appearances, null, 'appearances 缺 → null');
  assert.equal(w.max_lb, 9);
  assert.equal(w.broken_limit_ratio, 0.2, '炸板率 = zb/(zt+zb)');
  assert.equal(w.overnight_sectors, null, '无隔夜资讯源 → 恒 null（missing_notes 披露）');
  assert.ok(w.basis.includes('不含操作建议'), 'basis 声明观察语义');
  assert.ok(!('position_suggestion' in w), '观察清单无仓位建议字段（任务一核心纪律）');
});

test('buildWatchlist：空梯队/缺档 → ladder 空数组（不炸不造数）', () => {
  assert.deepEqual(buildWatchlist({}, {}).ladder, []);
  assert.deepEqual(buildWatchlist({ signals: {} }, {}).ladder, []);
});

// ── 任务二：盘中候选池筛选（2026-10-10 双池拆分：趋势池四条件 + 连板池独立口径）──
const snap = (rows, pools = {}) => ({
  tradeDate: '2026-10-09',
  hot: { rows },
  pools: {
    zt_codes: pools.zt_codes ?? [],
    ...(pools.zt_lb ? { zt_lb: pools.zt_lb } : {}),
    ...(pools.prev_zt_codes ? { prev_zt_codes: pools.prev_zt_codes } : {}),
    ...(pools.zt_detail ? { zt_detail: pools.zt_detail } : {}),
  },
});
const row = (o) => ({ code: '600001', name: '样本股', reason: '半导体+国产替代', change_pct: 5, liangbi: 3, main_net: 5e7, pe_ttm: 22, pb: 1.4, ...o });

test('buildIntradayPool：四条件筛选——带外/量比不足/已涨停/净流出各剔其类', () => {
  const rows = [
    row({ code: '600100' }),                                     // ✓ 全过
    row({ code: '600101', change_pct: 2.9 }),                    // 带外（低于 3）
    row({ code: '600102', change_pct: 7.1 }),                     // 带外（高于 7）
    row({ code: '600103', liangbi: 2.0 }),                        // 量比 ≤2.0（边界剔除）
    row({ code: '600104', change_pct: 9.99 }),                     // 已涨停（涨幅兜底）
    row({ code: '600105' }),                                      // 涨停名单命中
    row({ code: '600106', main_net: -1e6 }),                       // 主力净流出
    row({ code: '600107', main_net: null }),                       // 主力无源（核验不了）
    row({ code: '600108', liangbi: null }),                       // 量比无源
  ];
  const { pool, basis } = buildIntradayPool(snap(rows, { zt_codes: ['600105'] }), {});
  assert.deepEqual(pool.map((p) => p.code), ['600100'], '仅全条件可核验且达标的入选');
  assert.ok(basis.includes('带外 2'), '带外 2 只（2.9% / 7.1%）');
  assert.ok(basis.includes('量比不足 1'), '量比 ≤2.0 剔 1 只（边界含等号）');
  assert.ok(basis.includes('已涨停 2'), '已涨停 2 只（名单命中 + 涨幅兜底）');
  assert.ok(basis.includes('净流出或无源 1'), '净流出剔 1 只');
  assert.ok(basis.includes('字段缺失 2'), '无源字段走 unverifiable 计数（宁缺毋假，不冒充 0）');
});

test('buildIntradayPool：得分口径——中枢 5% 贴近者高于带边，权重缺席重归一，Top 10 截断', () => {
  const rows = [
    row({ code: '600201', change_pct: 5 }),   // 贴中枢
    row({ code: '600202', change_pct: 3.1 }), // 带边
    ...Array.from({ length: 12 }, (_, i) => row({ code: `6009${String(i).padStart(2, '0')}`, change_pct: 4 + (i % 3) * 0.5 })),
  ];
  const { pool } = buildIntradayPool(snap(rows), {});
  assert.ok(pool.length === 10, 'Top 10 截断');
  const byScore = pool.map((p) => p.score);
  assert.ok(new Set(byScore).size <= 14);
  // 5% 中枢股应排最前（涨幅位置分量 1.0）
  assert.equal(pool[0].code, '600201');
  assert.ok(pool[0].score > 0 && pool[0].score <= 1, '得分 0-1 区间');
  // 题材热度：reason 同标签「半导体」在榜 14 家 → 全体该分量接近 1，不炸即可（口径见 basis）
});

test('buildIntradayPool：字段装配——themes 真实标签/估值 PE 优先/主力净流入旁注', () => {
  const [p] = buildIntradayPool(snap([row({ code: '600300', pe_ttm: 22, pb: null })]), {}).pool;
  assert.deepEqual(p.themes, ['半导体', '国产替代'], '题材来自 hot 榜 reason 拆分（真实，非 null 占位）');
  assert.equal(p.fundamentals.pe, 22);
  assert.equal(p.fundamentals.pb, null);
  assert.ok(p.fund_flow_note.includes('+5000 万'), '主力净流入万元旁注（5e7 元 = 5000 万）');
  assert.equal(p.intraday_chg, 5);
  assert.ok(p.risks.length >= 1, '盘中口径风险提示在场');
});

test('buildIntradayPool：物理隔离——快照缺席/陈旧 → 空池报因，不回落昨收口径', () => {
  const empty1 = buildIntradayPool(null, {});
  assert.deepEqual(empty1.pool, []);
  const stale = buildIntradayPool(snap([row({})]), { tradeDate: '2026-10-10' });
  assert.deepEqual(stale.pool, []);
  assert.ok(stale.basis.includes('物理隔离'), '陈旧快照如实报因');
  assert.ok(stale.basis.includes('2026-10-09'), '报出快照实际日期');
});

test('INTRADAY_POOL_FILTERS：指令口径常量（3-7% / 量比 2.0 / Top 10）', () => {
  assert.equal(INTRADAY_POOL_FILTERS.chg_min, 3);
  assert.equal(INTRADAY_POOL_FILTERS.chg_max, 7);
  assert.equal(INTRADAY_POOL_FILTERS.liangbi_min, 2.0);
  assert.equal(INTRADAY_POOL_FILTERS.top, 10);
});

// ── is_valid 硬闸 + 0 只显式话术（2026-10-09 用户指令）─────────────────
test('buildIntradayPool：is_valid 硬闸——空串/null 核验字段被拦（不冒充 0），name 空串 → null', () => {
  const rows = [
    row({ code: '600401', change_pct: '' }),   // 空串涨幅 → unverifiable（'' 是 +''===0 陷阱）
    row({ code: '600402', liangbi: undefined }), // undefined 量比 → unverifiable
    row({ code: '600403', main_net: NaN }),       // NaN 主力净流入 → unverifiable
    row({ code: '600404', name: '   ', pe_ttm: '', pb: '' }), // 入选但展示字段缺失
  ];
  const { pool, basis } = buildIntradayPool(snap(rows), {});
  assert.deepEqual(pool.map((p) => p.code), ['600404'], '核验字段不过闸的三只全剔（宁缺毋假）');
  const [p] = pool;
  assert.equal(p.name, null, 'name 空白串 → null（渲染 —），不脑补');
  assert.equal(p.fundamentals.pe, null, 'pe 空串 → null（不冒充 0，负 PE 才是真实值保留）');
  assert.equal(p.fundamentals.pb, null, 'pb 空串 → null');
  assert.ok(basis.includes('字段缺失 3'), 'unverifiable 计数如实（3 只）');
});

test('buildIntradayPool：筛后 0 只 → basis 首句显式报「今日无符合条件标的」，不凑数', () => {
  // 全宇宙带外（2.9% < 3）——扫过但无一入选
  const rows = [row({ code: '600410', change_pct: 2.9 }), row({ code: '600411', change_pct: 7.1 })];
  const { pool, basis } = buildIntradayPool(snap(rows), {});
  assert.deepEqual(pool, [], '0 只就是 0 只，绝不往里塞垃圾凑数');
  assert.ok(basis.startsWith('今日无符合条件标的'), 'basis 首句显式话术');
  assert.ok(basis.includes('带外 2'), '剔除明细如实披露');
});

test('buildIntradayPool：数据完整度标记——题材/估值/资金三要素清点，缺啥标啥', () => {
  const rows = [
    row({ code: '600501' }),                                       // 三要素齐全 → full
    row({ code: '600502', pe_ttm: null, pb: null }),               // 估值双缺 → partial
    row({ code: '600503', reason: '', pe_ttm: null, pb: null }),   // 无题材 + 估值双缺 → partial 两项
  ];
  const { pool } = buildIntradayPool(snap(rows), {});
  const by = Object.fromEntries(pool.map((p) => [p.code, p]));
  assert.deepEqual(by['600501'].data_completeness, { level: 'full', missing: [] }, '题材/估值/资金全 → full');
  assert.deepEqual(by['600502'].data_completeness, { level: 'partial', missing: ['估值'] }, 'PE/PB 双缺 → partial 缺估值');
  assert.deepEqual(by['600503'].data_completeness, { level: 'partial', missing: ['题材', '估值'] }, 'reason 空 → 无题材；双缺如实清点（不冒充完整画像）');
});

// ── 双池拆分（2026-10-10 用户指令）──────────────────────────────────────
//   连板池不套「涨幅 3-7% / 未涨停」；趋势池四条件不变；两池互不掺和。
test('buildIntradayPool 双池：连板股（zt_lb≥2）进连板池、不进趋势池——涨幅 10% 不再被误剔', () => {
  const rows = [
    row({ code: '600601', change_pct: 10.02 }),  // 3 连板：涨停 + 涨幅带外——旧口径会被「已涨停」误剔
    row({ code: '600602', change_pct: 9.97 }),   // 2 连板
    row({ code: '600603' }),                      // 首板趋势股（5%）——趋势池语义
  ];
  const zt_lb = { 600601: 3, 600602: 2, 600603: 1 }; // 600603 首板（lbc=1）不属连板池
  const { pool, streak_pool, basis, streak_basis } = buildIntradayPool(snap(rows, { zt_lb }), {});
  assert.deepEqual(pool.map((p) => p.code), ['600603'], '趋势池只剩首板趋势股（连板股已分流）');
  assert.deepEqual(streak_pool.map((p) => p.code), ['600601', '600602'], '连板池按连板数降序');
  assert.equal(streak_pool[0].selection_reason, '3 连板', '入选理由 = 连板高度');
  assert.equal(streak_pool[0].score, null, '连板池不套综合得分（涨幅位置分量对连板股无意义）');
  assert.equal(streak_pool[0].intraday_chg, 10.02, 'chg 是展示字段，如实呈现');
  // 标题口径一致（streak_basis 是推送标题的唯一出处）：绝不出现趋势池的涨幅带/未涨停
  assert.ok(streak_basis.includes('连板≥2'), '连板池口径含连板门槛');
  assert.ok(streak_basis.includes('不套涨幅带、不剔已涨停'), '口径明示不套趋势池两条');
  assert.ok(!streak_basis.includes('涨幅 3-7'), '连板池口径绝不冒充涨幅带');
  assert.ok(basis.includes('已涨停 0'), '连板股分流后，趋势池「已涨停」台账归零（首板涨停才计）');
});

test('buildIntradayPool 双池：连板股 chg 缺失仍入连板池（展示字段非核验），量比/主力净流入照旧把关', () => {
  const rows = [
    row({ code: '600611', change_pct: null }),            // 2 连板 + 涨幅无源 → 仍入连板池（chg 渲染 —）
    row({ code: '600612', liangbi: 1.5 }),                 // 2 连板 + 量比不足 → 剔
    row({ code: '600613', main_net: -1e6 }),               // 2 连板 + 净流出 → 剔
    row({ code: '600614', liangbi: null }),                // 2 连板 + 量比无源 → unverifiable
  ];
  const zt_lb = { 600611: 2, 600612: 2, 600613: 2, 600614: 2 };
  const { streak_pool, streak_basis } = buildIntradayPool(snap(rows, { zt_lb }), {});
  assert.deepEqual(streak_pool.map((p) => p.code), ['600611'], '量比/主力为核验字段，缺失/不足如实剔');
  assert.equal(streak_pool[0].intraday_chg, null, 'chg 缺失 → null 渲染 —（连板池不作核验）');
  assert.ok(streak_basis.includes('量比不足 1'), '连板池剔除台账如实');
  assert.ok(streak_basis.includes('净流出或无源 1'), '净流出剔 1');
  assert.ok(streak_basis.includes('字段缺失 1'), '量比无源走 unverifiable（宁缺毋假）');
  assert.ok(streak_basis.includes('zt_lb 连板≥2 共 4 只'), 'zt_lb 总数披露（含宇宙外/被剔的全量口径）');
});

test('buildIntradayPool 双池：旧快照无 zt_lb → 连板池 0 只报因不猜测，趋势池行为不变', () => {
  const rows = [row({ code: '600621', change_pct: 10.05 })]; // 涨停但无连板数字段
  const { pool, streak_pool, streak_basis } = buildIntradayPool(snap(rows), {}); // 无 zt_lb（v2 旧快照）
  assert.deepEqual(pool, [], '趋势池：涨停股照旧被剔（四条件不变）');
  assert.deepEqual(streak_pool, [], '连板池 0 只');
  assert.ok(streak_basis.includes('缺连板数字段'), '报因：快照缺 zt_lb（不猜测、不降级）');
});

test('buildIntradayPool 双池：首板涨停（zt_lb lbc=1）属趋势池语义——被「未涨停」正常剔除，不进连板池', () => {
  const rows = [row({ code: '600631', change_pct: 10.0 })];
  const { pool, streak_pool, basis } = buildIntradayPool(snap(rows, { zt_codes: ['600631'], zt_lb: { 600631: 1 } }), {});
  assert.deepEqual(pool, [], '首板涨停不进趋势池');
  assert.deepEqual(streak_pool, [], 'lbc=1 < 2 不进连板池（连板池门槛 STREAK_POOL_MIN_LB）');
  assert.ok(basis.includes('已涨停 1'), '首板涨停进趋势池「已涨停」台账');
});

// ── 收盘倒计时降级（2026-10-10 用户指令：距收盘不足 30 分钟 → 趋势池自动降级明日观察池）──
test('minutesToCloseBJ：边界刻度——14:29=31 分 / 14:30=30 分（不触发）/ 14:31=29 分（触发）/ 非法 → null', () => {
  assert.equal(minutesToCloseBJ('14:29'), 31);
  assert.equal(minutesToCloseBJ('14:30'), 30, '整 30 分钟不满足「不足 30 分钟」');
  assert.equal(minutesToCloseBJ('14:31'), 29);
  assert.equal(minutesToCloseBJ('14:30:01'), 29, '有秒即进位：14:30:01 已不足 30 分');
  assert.equal(minutesToCloseBJ('15:00'), 0, '收盘时刻 = 0（不在盘中，不触发）');
  assert.equal(minutesToCloseBJ('09:35'), 325);
  assert.equal(minutesToCloseBJ('bad'), null, '非法输入 → null（不造数）');
  assert.equal(minutesToCloseBJ(null), null);
});

test('buildIntradayPool 降级：nowBJ/capturedAtBJ 距收盘<30分钟 → trend_pool_mode=tomorrow_watch + basis 报降级', () => {
  const rows = [row({ code: '600701' })];
  // ① opts.nowBJ 显式注入（纯函数可测）：14:35 → 25 分 < 30 → 降级
  const dg = buildIntradayPool(snap(rows), { nowBJ: '14:35' });
  assert.equal(dg.trend_pool_mode, 'tomorrow_watch', '14:35 距收盘 25 分 → 明日观察池');
  assert.equal(dg.minutes_to_close, 25);
  assert.ok(dg.basis.includes('距收盘 25 分钟（<30）→ 趋势池自动降级为「明日观察池」'), 'basis 明示降级原因');
  assert.deepEqual(dg.pool.map((p) => p.code), ['600701'], '降级只换语义标签，标的仍是四条件筛出者');
  // ② 快照 capturedAtBJ 数据时点兜底（不传 nowBJ）：14:53 → 7 分 → 降级
  const snapAt = { ...snap(rows), capturedAtBJ: '2026-10-10 14:53' };
  const dg2 = buildIntradayPool(snapAt, {});
  assert.equal(dg2.trend_pool_mode, 'tomorrow_watch', '缺省跟快照数据时点走（14:53 拍 → 降级）');
  // ③ 边界外：14:29 → 31 分 → 不降级；连板池结构不受降级影响
  const ok = buildIntradayPool(snap(rows, { zt_lb: { 600702: 2 } }), { nowBJ: '14:29' });
  assert.equal(ok.trend_pool_mode, 'trend', '14:29 距收盘 31 分 → 正常趋势池');
  const okStreak = buildIntradayPool(snap([row({ code: '600702', change_pct: 10.05 })], { zt_lb: { 600702: 2 } }), { nowBJ: '14:50' });
  assert.equal(okStreak.trend_pool_mode, 'tomorrow_watch', '趋势池降级');
  assert.equal(okStreak.streak_pool.length, 1, '连板池不受降级影响（当日已封板，无买入窗口问题）');
  // ④ 无时间信息（旧快照无 capturedAtBJ 且未注入 nowBJ）→ 不降级不造数
  const noT = buildIntradayPool(snap(rows), {});
  assert.equal(noT.trend_pool_mode, 'trend', '时间不可知 → 按趋势池渲染（不猜测降级）');
  assert.equal(noT.minutes_to_close, null);
});

// ── P0 双池物理拆分（2026-10-10 实盘事故）：黑名单/白名单/独立评分 ──────────────
test('P0 buildIntradayPool：昨日涨停断板股混进 3-7% 带 → prev_zt_codes 黑名单剔除', () => {
  // 10-09 事故形态：雪龙 4 连板今日 -9.98% 是带外；更隐蔽的是断板后回落到 +5% 的股——
  // 四条件全过但本质是连板余温，不属普通趋势股。黑名单 = ztpool_history 昨日收盘涨停。
  const rows = [
    row({ code: '603949', change_pct: 5 }),   // 昨日涨停今日 +5% 带内 → 黑名单剔
    row({ code: '600100', change_pct: 5.5 }), // 普通趋势股 → 留
  ];
  const { pool, basis } = buildIntradayPool(snap(rows, { prev_zt_codes: ['603949'] }), {});
  assert.deepEqual(pool.map((p) => p.code), ['600100'], '断板股被黑名单拦截，普通趋势股保留');
  assert.ok(basis.includes('昨日涨停 1'), '剔除台账计 prev_zt');
  assert.ok(basis.includes('已滤昨日涨停 1 只黑名单'), 'basis 披露黑名单规模');
});

test('P0 buildIntradayPool：昨日涨停黑名单缺席（旧快照）→ 不剔不冒充，basis 报因', () => {
  const rows = [row({ code: '603949', change_pct: 5 })];
  const { pool, basis } = buildIntradayPool(snap(rows), {}); // v3 旧快照无 prev_zt_codes
  assert.equal(pool.length, 1, '不可核验即不剔（宁缺毋假不等于乱剔）');
  assert.ok(basis.includes('昨日涨停黑名单缺席'), 'basis 如实披露防线缺席');
});

test('P0 buildIntradayPool：连板池白名单——今日一字（fbt<=092500）剔除；梯队分/封单装配', () => {
  const rows = [
    row({ code: '600601', change_pct: 10.02, main_net: 6e7 }), // 3 连板 盘中封板 → 留
    row({ code: '600602', change_pct: 9.98, main_net: 3e7 }),  // 2 连板 一字 → 剔
  ];
  const zt_lb = { 600601: 3, 600602: 2 };
  const zt_detail = [
    { c: '600601', lbc: 3, fbt: '101530', fund: 5e7 },
    { c: '600602', lbc: 2, fbt: '092500', fund: 9e7 },
  ];
  const { streak_pool, streak_basis } = buildIntradayPool(snap(rows, { zt_lb, zt_detail }), {});
  assert.deepEqual(streak_pool.map((p) => p.code), ['600601'], '一字无买入窗口剔除（白名单：今日非一字）');
  assert.ok(streak_basis.includes('一字 1'), '一字剔除台账');
  // 梯队分 = 0.6×(lbc/maxLbc) + 0.4×(mn/maxMn)：单只留存 → 0.6×1 + 0.4×1 = 1
  assert.equal(streak_pool[0].streak_score, 1, '梯队分（连板高度0.6+主力0.4，缺席重归一）');
  assert.equal(streak_pool[0].seal_amount, 5e7, '封单额（东财 fund 原值）透传');
  assert.equal(streak_pool[0].score, null, '趋势池综合分不套连板池');
});

test('P0 buildIntradayPool：梯队分独立于趋势池综合分——连板高度优先', () => {
  const rows = [
    row({ code: '600601', change_pct: 10.02, main_net: 4e7 }), // 4 连板
    row({ code: '600602', change_pct: 10.02, main_net: 8e7 }), // 2 连板（主力更强）
  ];
  const zt_lb = { 600601: 4, 600602: 2 };
  const zt_detail = [{ c: '600601', lbc: 4, fbt: '100000', fund: 1e8 }, { c: '600602', lbc: 2, fbt: '100000', fund: 2e8 }];
  const { streak_pool } = buildIntradayPool(snap(rows, { zt_lb, zt_detail }), {});
  assert.deepEqual(streak_pool.map((p) => p.code), ['600601', '600602'], '梯队分排序（高度 0.6 权重主导）');
  assert.ok(streak_pool[0].streak_score > streak_pool[1].streak_score, '4 连板梯队分 > 2 连板');
});
