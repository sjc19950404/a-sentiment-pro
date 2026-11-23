/* tier_policy.js —— T+1 仓位档分位策略（2026-11-24 用户拍板）
 *
 * 【背景】v5.3 s_net 复活后情绪分中位 +6.10 分，绝对档 80/65/24 出现 34.7% 的
 * 档位迁移——系统性偏一档。用户拍板：
 *  · 上线 P98/P60/P1 作为**尺度修正基线**（单变量实验，复现旧行为），不作长期参数
 *  · P90/P75/P10 走**影子轨**，只出对比表，不切
 *  · **禁止全史分位**（前视偏差）——trailing 250 日滚动，回测同口径
 *  · warmup（历史 <250 日）显式用绝对分兜底并标 warmup_absolute_fallback
 *  · 报告文案与引擎判档同源（不得出现"页面说过热、引擎判满仓"）
 *
 * 阈值口径：overheat=高分 P98 / full=中分 P60 / half=低分 P1。
 * 判档与旧版一致：s >= overheat → 过热；s >= full → 满仓；s > half → 半仓；否则清仓。
 */
export const ABSOLUTE_FALLBACK = Object.freeze({ overheat: 80, full: 65, half: 24 });

export const BASELINE_TIER_POLICY = Object.freeze({
  id: 'scale-baseline', window: 250,
  quantiles: Object.freeze({ overheat: 0.98, full: 0.60, half: 0.01 }),
  note: 'P98/P60/P1 trailing250——尺度修正基线，单变量实验，不作长期参数',
});

export const SHADOW_TIER_POLICY = Object.freeze({
  id: 'shadow-p90', window: 250,
  quantiles: Object.freeze({ overheat: 0.90, full: 0.75, half: 0.10 }),
  note: 'P90/P75/P10 trailing250——影子轨，只出对比表不切',
});

/** 从"只含已见历史"的分数序列算 trailing 分位阈值。
 * @param {number[]} history 按时间升序的历史情绪分（**不得含当日**，调用方保证）
 * @param {object} policy BASELINE_TIER_POLICY / SHADOW_TIER_POLICY
 * @returns {{thresholds:{overheat,full,half}, warmup:boolean, source:string, n:number}}
 */
export function tierThresholds(history, policy = BASELINE_TIER_POLICY) {
  const arr = (Array.isArray(history) ? history : [])
    .map((x) => (Number.isFinite(+x) ? +x : null)).filter((x) => x != null);
  const win = Math.max(1, Number(policy.window) || 250);
  if (arr.length < win) {
    return { thresholds: { ...ABSOLUTE_FALLBACK }, warmup: true,
      source: 'warmup_absolute_fallback', n: arr.length };
  }
  const tail = arr.slice(-win).sort((a, b) => a - b);
  const q = (p) => {
    const i = Math.min(tail.length - 1, Math.max(0, Math.ceil(p * tail.length) - 1));
    return tail[i];
  };
  const qq = policy.quantiles || BASELINE_TIER_POLICY.quantiles;
  return {
    thresholds: { overheat: q(qq.overheat), full: q(qq.full), half: q(qq.half) },
    warmup: false, source: `trailing${win}_p${[qq.overheat, qq.full, qq.half].map((x) => Math.round(x * 100)).join('_')}`, n: tail.length,
  };
}

/** 与旧 marketTier 完全相同的判档逻辑，只是阈值来自分位（或 warmup 兜底）。
 * 与 src/picks.js POSITION_TIERS 同源（不复制档位语义，只返回 key）。 */
export function tierKey(score, thresholds) {
  if (score == null || !Number.isFinite(+score)) return null;
  const s = +score, t = thresholds || ABSOLUTE_FALLBACK;
  if (s >= t.overheat) return 'overheat';
  if (s >= t.full) return 'full';
  if (s > t.half) return 'half';
  return 'clear';
}
