import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateBudget, BUDGET_GATES } from '../src/risk_budget.js';

const SLOTS = [
  { id: 'mainline', pct: 0.6, priority: 10 },
  { id: 'auction', pct: 0.3, priority: 5 },
];

test('risk_budget: 槽位内正常分配；estAmt=净值×比例', () => {
  const r = allocateBudget({
    totalEquity: 1e6, slots: SLOTS,
    signals: [{ slotId: 'mainline', code: '600001', targetPct: 0.1 }, { slotId: 'auction', code: '600002', targetPct: 0.08 }],
  });
  assert.equal(r.allocations.length, 2);
  assert.equal(r.allocations[0].estAmt, 100000);
  assert.equal(r.allocations[0].cappedBy, null);
  assert.ok(Math.abs(r.usedPct - 0.18) < 1e-9);
});

test('risk_budget: 单票上限 10%——targetPct 超限被 cap（cappedBy=single）', () => {
  const r = allocateBudget({ totalEquity: 1e6, slots: SLOTS, signals: [{ slotId: 'mainline', code: '600001', targetPct: 0.5 }] });
  assert.equal(r.allocations[0].approvedPct, 0.1);
  assert.equal(r.allocations[0].cappedBy, 'single');
});

test('risk_budget: 全局单日 20% 闸——第三笔被 daily 拦截/剩余额度压缩', () => {
  const sigs = ['600001', '600002', '600003'].map((code) => ({ slotId: 'mainline', code, targetPct: 0.1 }));
  const r = allocateBudget({ totalEquity: 1e6, slots: [{ id: 'mainline', pct: 1.0, priority: 10 }], signals: sigs });
  assert.equal(r.allocations.length, 2);
  assert.equal(r.gated.length, 1);
  assert.equal(r.gated[0].cappedBy, 'daily');
  assert.equal(r.usedPct, 0.2);
  assert.equal(r.remainingPct, 0);
});

test('risk_budget: 槽位预算——超槽位预算被 slot cap', () => {
  const sigs = ['600001', '600002'].map((code) => ({ slotId: 'mainline', code, targetPct: 0.1 }));
  // mainline 槽位只有 15%：第二笔只批 5%
  const r = allocateBudget({ totalEquity: 1e6, slots: [{ id: 'mainline', pct: 0.15, priority: 10 }], signals: sigs });
  assert.equal(r.allocations.length, 2);
  assert.ok(Math.abs(r.allocations[1].approvedPct - 0.05) < 1e-9);
  assert.equal(r.allocations[1].cappedBy, 'slot');
});

test('risk_budget: 跨槽位同票冲突——priority 高者得，低者进 conflicts', () => {
  const r = allocateBudget({
    totalEquity: 1e6, slots: SLOTS,
    signals: [{ slotId: 'auction', code: '600001', targetPct: 0.1 }, { slotId: 'mainline', code: '600001', targetPct: 0.1 }],
  });
  assert.equal(r.allocations.length, 1);
  assert.equal(r.allocations[0].slotId, 'mainline', 'priority 10 > 5，主线得票');
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].rule, 'priority');
});

test('risk_budget: usedTodayPct 起点计入——已用 15% 时只批 5%', () => {
  const r = allocateBudget({
    totalEquity: 1e6, usedTodayPct: 0.15, slots: [{ id: 'mainline', pct: 1.0, priority: 10 }],
    signals: [{ slotId: 'mainline', code: '600001', targetPct: 0.1 }],
  });
  assert.ok(Math.abs(r.allocations[0].approvedPct - 0.05) < 1e-9);
  assert.equal(r.allocations[0].cappedBy, 'daily');
});

test('risk_budget: 闸常量与 riskGuard 现行值对齐（预演口径=实盘口径）', () => {
  assert.equal(BUDGET_GATES.DAILY_CHANGE, 0.2);
  assert.equal(BUDGET_GATES.DEFAULT_SINGLE_PCT, 0.1);
});
