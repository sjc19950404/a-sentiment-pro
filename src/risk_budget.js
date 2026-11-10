/**
 * 子策略风险预算分发（2026-11-10，六方向 #5，只读预演版——**不接 riskGuard**）。
 *
 * 纪律（用户拍板）：先只读预演 N 天（预算计算落档对照），确认预算表正确后才接线
 *   riskGuard 单一闸口。本模块是纯函数，scripts/risk_budget_preview.mjs 负责 IO；
 *   预演期输出档 data/risk_budget_preview.json 仅供人工对照，不被任何决策读取。
 *
 * 预算规则（v1 默认，预演期可改）：
 *   1. 槽位预算 = 净值 × slot.pct（slots 在 config.paper.budgetSlots，默认只有
 *      「主线选股」100%——当前只有一个策略在产信号，其余槽位空转，如实输出）；
 *   2. 槽内信号按顺序分配，累计超槽位预算 → cappedBy='slot'；
 *   3. 跨槽位同票冲突 → priority 高者得，低者 blocked（同票归谁拍板可改）；
 *   4. 全局闸：单日仓位变动 ≤ DAILY_CHANGE(20%)、单票 ≤ singlePct(10%)——与
 *      riskGuard 现行两闸**同口径**（预演的意义就是证明预算分配后仍不撞闸）。
 */

/** 全局闸常量（与 src/paper.js riskGuard 现行值对齐——预演口径必须与实盘一致）。 */
export const BUDGET_GATES = { DAILY_CHANGE: 0.2, DEFAULT_SINGLE_PCT: 0.1 };

/**
 * @param {object} p
 * @param {number} p.totalEquity 当前净值（元）
 * @param {number} [p.usedTodayPct] 今日已占用仓位变动比例（默认 0）
 * @param {Array}  p.slots  [{id, pct, priority}] 预算槽位
 * @param {Array}  p.signals [{slotId, code, targetPct}] 当日子策略信号（targetPct=占净值比例）
 * @returns {{allocations: Array, conflicts: Array, usedPct: number, remainingPct: number}}
 */
export function allocateBudget({ totalEquity, usedTodayPct = 0, slots, signals }) {
  const gated = [];
  const conflicts = [];
  const slotBudget = new Map(); // slotId -> {budget, used}
  for (const s of Array.isArray(slots) ? slots : []) {
    if (s && s.id != null) slotBudget.set(s.id, { budget: s.pct, used: 0, priority: s.priority ?? 0 });
  }
  // 跨槽位同票：priority 高者保留
  const byCode = new Map();
  for (const sig of Array.isArray(signals) ? signals : []) {
    if (!sig || !sig.slotId || !sig.code) continue;
    const prev = byCode.get(sig.code);
    const curP = slotBudget.get(sig.slotId)?.priority ?? 0;
    if (prev && (slotBudget.get(prev.slotId)?.priority ?? 0) >= curP) {
      conflicts.push({ code: sig.code, winner: prev.slotId, loser: sig.slotId, rule: 'priority' });
      continue;
    }
    if (prev) conflicts.push({ code: sig.code, winner: sig.slotId, loser: prev.slotId, rule: 'priority' });
    byCode.set(sig.code, sig);
  }
  // 分配（全局累计 = usedTodayPct 起点）
  let globalUsed = usedTodayPct;
  const allocations = [];
  for (const sig of byCode.values()) {
    const slot = slotBudget.get(sig.slotId);
    if (!slot) { gated.push({ ...sig, approvedPct: 0, cappedBy: 'no-slot' }); continue; }
    let pct = Number.isFinite(+sig.targetPct) ? +sig.targetPct : 0;
    let cappedBy = null;
    // 单票上限
    if (pct > BUDGET_GATES.DEFAULT_SINGLE_PCT) { pct = BUDGET_GATES.DEFAULT_SINGLE_PCT; cappedBy = 'single'; }
    // 全局单日闸
    if (globalUsed + pct > BUDGET_GATES.DAILY_CHANGE) {
      const room = Math.max(0, BUDGET_GATES.DAILY_CHANGE - globalUsed);
      if (room <= 0) { gated.push({ ...sig, approvedPct: 0, cappedBy: 'daily' }); continue; }
      pct = room; cappedBy = 'daily';
    }
    // 槽位预算
    if (slot.used + pct > slot.budget) {
      const room = Math.max(0, slot.budget - slot.used);
      if (room <= 0) { gated.push({ ...sig, approvedPct: 0, cappedBy: 'slot' }); continue; }
      pct = Math.min(pct, room); cappedBy = cappedBy || 'slot';
    }
    slot.used += pct;
    globalUsed += pct;
    allocations.push({ slotId: sig.slotId, code: sig.code, approvedPct: +pct.toFixed(4), cappedBy, estAmt: +(totalEquity * pct).toFixed(0) });
  }
  return {
    allocations,
    conflicts,
    gated,
    usedPct: +globalUsed.toFixed(4),
    remainingPct: +(BUDGET_GATES.DAILY_CHANGE - globalUsed).toFixed(4),
  };
}
