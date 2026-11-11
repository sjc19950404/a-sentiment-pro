/**
 * 范式驱动动态阈值 v1（2026-11-11 拍板两步方案第一步，用户约定四条）：
 *   ① 全局开关 ENABLE_REGIME_THRESHOLD（env/.env）默认 false——false 时调用方走 shadow
 *      模式：计算照跑、日志照打、**阈值用基准**（上线先静默观察）；
 *   ② 审计完整：adjustThreshold 返回 {key, base, regime, multiplier, final, adjusted}，
 *      调用方原样落 state.threshold_adjust（可审计可回放）；
 *   ③ 数据缺失/状态异常 → 直接返回基准值（multiplier=1），绝不报错不猜；
 *   ④ v1 只接两个核心阈值：approachPct（逼近线）/ sectorMinChg（板块强门槛）；
 *      竞价/封单/一字占比第二步（11-17 敏感性矩阵后）评估，本模块 key 可扩展。
 *
 * 乘数语义：范式状态 × 基准阈值 = 生效值。基准仍由人工拍板（唯一出处纪律不变），
 *   范式只提供保守乘数（限幅 [0.7, 1.3]）；hot=收紧（热的时候冲板票多，防刷屏/保过滤力），
 *   cold=放宽（冷的时候防漏报）。乘数表可经 config.paper.regimeThreshold 覆盖（参数化纪律）。
 */

export const REGIME_THRESHOLD_DEFAULTS = {
  clamp: [0.7, 1.3],
  hotStates: ['高潮', '主升'],
  coldStates: ['冰点', '退潮'],
  neutralStates: ['复苏', '震荡'],
  multipliers: {
    hot: { approachPct: 1.15, sectorMinChg: 1.25 },
    cold: { approachPct: 0.85, sectorMinChg: 0.75 },
  },
};

/**
 * 范式标签 → 档位。未知/缺失/no_data → null（调用方回基准）。
 */
export function regimeTier(stateLabel, opts = {}) {
  const th = { ...REGIME_THRESHOLD_DEFAULTS, ...opts };
  if (!stateLabel || typeof stateLabel !== 'string') return null;
  if (th.hotStates.includes(stateLabel)) return 'hot';
  if (th.coldStates.includes(stateLabel)) return 'cold';
  if (th.neutralStates.includes(stateLabel)) return 'neutral';
  return null;
}

/**
 * 单阈值调整（纯函数，无 IO）。
 * @returns {{key, base, regime, tier, multiplier, final, adjusted}}
 *   regime 缺失/未知/中性 → multiplier=1、final=base、adjusted=false。
 */
export function adjustThreshold(key, base, stateLabel, opts = {}) {
  const th = { ...REGIME_THRESHOLD_DEFAULTS, ...opts };
  const audit = { key, base, regime: stateLabel || null, tier: null, multiplier: 1, final: base, adjusted: false };
  if (!Number.isFinite(+base) || +base <= 0) return audit;   // 基准非法 → 原样返回不猜
  const tier = regimeTier(stateLabel, opts);
  audit.tier = tier;
  if (!tier || tier === 'neutral') return audit;             // 约定③：缺失/中性 → 基准
  const mult = th.multipliers[tier] && th.multipliers[tier][key];
  if (!Number.isFinite(+mult)) return audit;                 // 该 key 未接乘数 → 基准
  const clamped = Math.max(th.clamp[0], Math.min(th.clamp[1], +mult));
  audit.multiplier = +clamped.toFixed(4);
  audit.final = +(base * clamped).toFixed(4);
  audit.adjusted = audit.final !== base;
  return audit;
}
