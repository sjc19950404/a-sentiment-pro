/**
 * 滑点模型（2026-11-10，六方向 #4 v1，两步走：旧口径封存、新口径并行）。
 *
 * 三层事实（2026-11-10 盘中核算，作为 v1 边界的依据）：
 *   1. 回测层（backtest.js）是「情绪分→两资产池仓位」的日度净值模拟，**没有逐票成交额**——
 *      依赖成交额的「动态容量项」在回测层无米下锅。诚实做法：v1 回测只做**滑点敏感性
 *      对照**（V52_PARAMS.slip 本就是参数，零改动），动态公式落在有真实数据的层。
 *   2. 容量冲击核算：模拟盘单笔 ~10 万 vs 池票成交额 1 亿+ → r≈0.1%，
 *      impact≈0.00014 < 基础滑点 0.0002——**当前规模下容量校验不构成约束**（v2 竞价
 *      档（fetch_auction）跑起来后有真实竞价额，再回填精确口径）。
 *   3. 打板类策略的真实滑点大头是**排板成交率**（涨停价挂单买不到/炸板）——固定万2
 *      严重低估。回测层以档位近似（SLIP_PRESETS），对照表展示结论对滑点的稳健性。
 *
 * 旧口径封存：backtest.js 本轮**零改动**（V52_PARAMS.slip=0.0002 语义不变），
 *   对照脚本只扫参数——与 C12「新旧两套口径分开命名、不覆盖既有结论」同款纪律。
 */

/** 回测滑点敏感性档位：low=V52 现行（低吸/趋势类）· mid=打板基准 · high=悲观（炸板常态化）。 */
export const SLIP_PRESETS = {
  low: 0.0002,   // V52_PARAMS 现行值（万2）——旧口径锚点，对照基线
  mid: 0.001,    // 打板策略常见假设（千1）
  high: 0.003,   // 悲观档（千3：排板买不到、追高成交价劣化）
};

/**
 * 动态滑点（paper/实盘层用；回测层 v1 不接——无成交额数据）。
 *   slip = clamp(base + capacityImpact, cap) × sealMul × reopenMul
 *   · base            万2（V52 锚点）
 *   · capacityImpact  容量冲击 = 0.001 × √(r / 0.05)，r=买入金额/当日成交额
 *                     （r=5% → +0.001；r=0.1% → ≈+0.00014，当前规模可忽略）
 *   · sealWeak        封单薄弱（封单额/流通市值 低于阈值）→ ×1.5
 *   · reopen          当日曾有炸板（zbc>0）→ ×1.2
 *   · cap             0.005（千5 封顶，防极端输入）
 * 任何输入缺失（null/undefined）→ 该项按中性处理，绝不造数。
 * @returns {number|null} slip；成交额/买入金额缺失且无乘数依据时返回 null（调用方回落固定档）
 */
export function dynamicSlip({ buyAmt, turnover, sealWeak = false, reopen = false } = {}) {
  const base = 0.0002;
  let hasCapacity = false;
  let slip = base;
  if (Number.isFinite(+buyAmt) && +buyAmt > 0 && Number.isFinite(+turnover) && +turnover > 0) {
    const r = +buyAmt / +turnover;
    if (r > 0) { slip += 0.001 * Math.sqrt(r / 0.05); hasCapacity = true; }
  }
  if (sealWeak) slip *= 1.5;
  if (reopen) slip *= 1.2;
  if (!hasCapacity && !sealWeak && !reopen) return null; // 无任何动态依据 → 不造数
  return Math.min(slip, 0.005);
}
