// 主线识别动态阈值单测（2026-10-07）：computeDynamicThreshold 纯函数 + selectMainLine
// 阈值过滤行为。覆盖六个规格场景：充足/不足样本、全零历史、零标准差、单日突增、
// 连续无主线（阈值自适应下调），另锁配置读取与降级口径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDynamicThreshold, selectMainLine } from '../src/backtest.js';
import config from '../src/config.js';

const CFG = config.mainLine;
const FIXED = CFG.fixedFallback;

/** 造 n 条历史样本：up_count 基线 base，density 基线 dBase（各加微抖动防退化为零 std 时误判） */
const mk = (n, base = 8, dBase = 0.2) => Array.from({ length: n }, (_, i) => ({
  date: `2026-07-${String(i + 1).padStart(2, '0')}`,
  theme_up_count: base,
  theme_density: dBase,
}));

test('配置：mainLine 块存在且形态正确（config.json 是唯一事实源，不硬编码）', () => {
  assert.ok(CFG && typeof CFG === 'object');
  assert.equal(CFG.lookback_days, 60);
  assert.equal(CFG.sigma_multiplier, 1.0);
  assert.equal(CFG.min_sample_days, 20);
  assert.ok(Number.isFinite(FIXED.up_count_threshold) && Number.isFinite(FIXED.density_threshold));
});

test('① 数据充足（≥60 条）→ 正常计算动态阈值（均值 + 1σ）', () => {
  // 60 条 theme_up_count 全为 8、theme_density 全为 0.2：std=0 → 阈值=均值
  const t = computeDynamicThreshold(mk(60), CFG);
  assert.equal(t.mode, 'dynamic');
  assert.equal(t.samples, 60);
  assert.equal(t.up_count_threshold, 8);
  assert.ok(Math.abs(t.density_threshold - 0.2) < 1e-12);
  assert.equal(t.window.up_mean, 8);
  assert.equal(t.window.up_std, 0);
});

test('② 数据不足（<20 条）→ 降级固定阈值，mode=fallback 如实标注', () => {
  const t = computeDynamicThreshold(mk(19, 50, 0.9), CFG);
  assert.equal(t.mode, 'fallback');
  assert.equal(t.samples, 19);
  assert.equal(t.up_count_threshold, FIXED.up_count_threshold);
  assert.equal(t.density_threshold, FIXED.density_threshold);
});

test('③ 历史数据全为零 → 阈值不为负（clamp ≥0）', () => {
  const t = computeDynamicThreshold(mk(30, 0, 0), CFG);
  assert.equal(t.mode, 'dynamic');
  assert.equal(t.up_count_threshold, 0);
  assert.equal(t.density_threshold, 0);
});

test('④ 标准差为零 → 阈值等于均值', () => {
  // 全部样本同值：std=0，阈值 = 均值 + 1×0 = 均值
  const t = computeDynamicThreshold(mk(25, 12, 0.3), CFG);
  assert.equal(t.up_count_threshold, 12);
  assert.ok(Math.abs(t.density_threshold - 0.3) < 1e-12);
});

test('④b 单日数据突增 → 次日阈值上调（突增样本进窗口抬升均值与 σ）', () => {
  const calm = mk(59, 8, 0.2);
  const before = computeDynamicThreshold(calm, CFG);
  const after = computeDynamicThreshold([...calm, { date: 'x', theme_up_count: 30, theme_density: 0.6 }], CFG);
  assert.ok(after.up_count_threshold > before.up_count_threshold,
    `阈值应上调：${before.up_count_threshold} → ${after.up_count_threshold}`);
  assert.ok(after.density_threshold > before.density_threshold);
});

test('⑤ 连续多日无主线（数据持续走低）→ 阈值逐步下调', () => {
  // 强市窗口（up 20）→ 换窗期（20 强 + 40 弱）→ 弱市窗口（up 5）：
  // 阈值随分布整体下移而逐级下修，弱市主线可被重新识别。
  // （注意换窗期不能用 50/50 两簇：mean+std 数学上恰等于高簇值，测不出下调）
  const hot = mk(60, 20, 0.5);
  const t1 = computeDynamicThreshold(hot, CFG);
  const cooling = [...hot.slice(0, 20), ...mk(40, 5, 0.1)];
  const t2 = computeDynamicThreshold(cooling, CFG);
  const cold = mk(60, 5, 0.1);
  const t3 = computeDynamicThreshold(cold, CFG);
  assert.ok(t2.up_count_threshold < t1.up_count_threshold,
    `换窗期阈值应下移：${t1.up_count_threshold} → ${t2.up_count_threshold}`);
  assert.ok(t3.up_count_threshold < t2.up_count_threshold,
    `冷市阈值应继续下调：${t2.up_count_threshold} → ${t3.up_count_threshold}`);
  assert.ok(t3.density_threshold < t2.density_threshold && t2.density_threshold < t1.density_threshold,
    `密集度阈值同向下调：${t1.density_threshold} → ${t2.density_threshold} → ${t3.density_threshold}`);
});

test('selectMainLine：无阈值参数 → 保持历史行为（排序取 topN，不滤）', () => {
  const day = { trade_date: '2026-10-08', themes: { 弱题材: 1, 强题材: 9 }, hot: [], industry: [] };
  const r = selectMainLine(day, 2);
  assert.equal(r.mains.length, 2);
  assert.equal(r.mains[0].theme, '强题材');
  assert.equal(r.threshold, undefined);
});

test('selectMainLine：阈值过滤——达标入选、不达标剔除、全不达标 → 空主线（不冒充）', () => {
  const day = { trade_date: '2026-10-08', themes: { A: 10, B: 3, C: 2 }, hot: [], industry: [] };
  // total=15：A density=0.667、B=0.2、C=0.133。阈值 { up: 5, density: 0.15 } → 只剩 A
  const th = { up_count_threshold: 5, density_threshold: 0.15 };
  const r = selectMainLine(day, 2, th);
  assert.deepEqual(r.mains.map((m) => m.theme), ['A']);
  assert.deepEqual(r.threshold, th);
  // 阈值抬到无人可达 → mains 空（今日无主线）
  const none = selectMainLine(day, 2, { up_count_threshold: 99, density_threshold: 0.99 });
  assert.equal(none.mains.length, 0);
});

test('接入形态：computeDynamicThreshold 产物可直接喂 selectMainLine（字段闭环）', () => {
  const th = computeDynamicThreshold(mk(60, 8, 0.2), CFG);
  const day = { trade_date: '2026-10-08', themes: { 强题材: 9, 弱题材: 3 }, hot: [], industry: [] };
  const r = selectMainLine(day, 2, th);
  assert.equal(r.mains.map((m) => m.theme).join(), '强题材'); // 9 ≥ 8 且 density 0.75 ≥ 0.2
});
