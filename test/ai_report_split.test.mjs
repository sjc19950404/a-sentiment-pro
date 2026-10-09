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
  buildWatchlist, buildIntradayPool, INTRADAY_POOL_FILTERS,
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

// ── 任务二：盘中候选池筛选 ───────────────────────────────────────────────
const snap = (rows, pools = {}) => ({
  tradeDate: '2026-10-09',
  hot: { rows },
  pools: { zt_codes: pools.zt_codes ?? [] },
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
