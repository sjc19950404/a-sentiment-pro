// 情绪类数据跨源对账 · 单测（2026-10-11）
//
// 背景：主源（东财 push2ex）与"备源"（AkShare zt_pool）是同一个 URL——四项 100% 一致
// 是自证循环，不是冗余。真正的独立对账源是自有快照自建池（market_data.derive_zt_from_snapshot）。
// 本单测锁死：① 真不一致要红出来；② 口径差异（北交所）**不许**被当成不一致（防假告警）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ztPoolCrosscheck, breadthCrosscheck, normCode, ZT_RULES, BREADTH_RULES } from '../src/ztpool_crosscheck.js';

const primaryOf = (n, prefix = '60') => ({
  zt_count: n,
  zt_codes: Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`),
});

test('normCode：去市场前缀与非数字', () => {
  assert.equal(normCode('sh600000'), '600000');
  assert.equal(normCode('600000.SH'), '600000');
  assert.equal(normCode(null), '');
});

test('两侧完全一致 → PASS（对账通过是常态，不告警）', () => {
  const p = primaryOf(30);
  const r = ztPoolCrosscheck({ primary: p, derived: { zt_count: 30, zt_codes: p.zt_codes, universe: 3500 } });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
  assert.equal(r.countDiff, 0);
});

test('家数差超阈 → WARN（池整体缺失/多算会被抓住）', () => {
  const p = primaryOf(30);
  const d = { zt_count: 20, zt_codes: p.zt_codes.slice(0, 20), universe: 3500 };
  const r = ztPoolCrosscheck({ primary: p, derived: d });
  assert.equal(r.verdict, 'WARN');
  assert.equal(r.countDiff, 10);
  assert.equal(r.onlyPrimary.length, 10);
  assert.match(r.reason, /家数差/);
});

test('名单不一致但家数相同 → WARN（换了一批票，家数看不出来）', () => {
  const p = { zt_count: 3, zt_codes: ['600001', '600002', '600003'] };
  const d = { zt_count: 3, zt_codes: ['600001', '600002', '600009'], universe: 3500 };
  const r = ztPoolCrosscheck({ primary: p, derived: d });
  // 家数差 |3-3|=0 不超阈，但名单差异率 (1+1)/4=0.5 远超 5% → 必须告警
  assert.equal(r.verdict, 'WARN');
  assert.ok(r.divergeRate > ZT_RULES.LIST_DIVERGE);
  assert.deepEqual(r.onlyDerived, ['600009']);
});

test('⚠ 北交所票不计入差异——东财池含北交所，自建池只有沪深A，误算即假告警', () => {
  // 东财 5 只：3 只沪深 + 2 只北交所（8/920 段）；自建 3 只沪深，完全一致
  const p = { zt_count: 5, zt_codes: ['600001', '600002', '600003', '830799', '920001'] };
  const d = { zt_count: 3, zt_codes: ['600001', '600002', '600003'], universe: 3500 };
  const r = ztPoolCrosscheck({ primary: p, derived: d });
  assert.equal(r.verdict, 'PASS', '北交所票不是"两侧不一致"，剔除后应完全一致');
  assert.equal(r.excludedBj, 2, '剔除数量要报告（不静默改数）');
  assert.equal(r.primaryCountRaw, 5, '原始主源家数保留');
  assert.equal(r.primaryCount, 3);
});

test('主源缺失 → UNAVAILABLE（无法对账，不是对账失败）', () => {
  const r = ztPoolCrosscheck({ primary: null, derived: { zt_count: 5, zt_codes: [], universe: 3500 } });
  assert.equal(r.verdict, 'UNAVAILABLE');
  assert.match(r.reason, /主源涨停池不可用/);
});

test('对账源不可用 / 样本不足 → UNAVAILABLE（残快照不比对，避免假告警）', () => {
  const r1 = ztPoolCrosscheck({ primary: primaryOf(30), derived: null });
  assert.equal(r1.verdict, 'UNAVAILABLE');
  assert.match(r1.reason, /对账源不可用/);
  const r2 = ztPoolCrosscheck({ primary: primaryOf(30), derived: { zt_count: 30, zt_codes: [], universe: 100 } });
  assert.equal(r2.verdict, 'UNAVAILABLE');
  assert.match(r2.reason, /样本不足/);
});

test('涨跌家数：方向相反 → WARN（口径不同也不同向，必有一侧错）', () => {
  const r = breadthCrosscheck({ snap: { up: 2000, down: 1500, flat: 58 }, legu: { up: 1500, down: 3500, flat: 200 } });
  assert.equal(r.verdict, 'WARN');
  assert.equal(r.directionFlip, true);
  assert.match(r.reason, /方向相反/);
});

test('涨跌家数：方向一致且占比接近 → PASS（跨口径可比的是方向与占比，不是绝对值）', () => {
  const r = breadthCrosscheck({ snap: { up: 2000, down: 1500, flat: 58 }, legu: { up: 2900, down: 2100, flat: 224 } });
  assert.equal(r.verdict, 'PASS', 'up 占比约 56% vs 55%，跨口径差异属正常');
});

test('涨跌家数：占比差超阈 → WARN', () => {
  const r = breadthCrosscheck({ snap: { up: 3000, down: 500, flat: 58 }, legu: { up: 1500, down: 3500, flat: 224 } });
  assert.equal(r.verdict, 'WARN');
  assert.ok(r.ratioDiffPct > BREADTH_RULES.RATIO_DIFF);
});

test('涨跌家数：任一侧缺失 → UNAVAILABLE', () => {
  assert.equal(breadthCrosscheck({ snap: null, legu: { up: 1, down: 1 } }).verdict, 'UNAVAILABLE');
  assert.equal(breadthCrosscheck({ snap: { up: 1, down: 1 }, legu: null }).verdict, 'UNAVAILABLE');
});
