// A 策略（冰点反转）信号阈值 + 滚动分位——回测与影子账本的**单一来源**。
//
// 为什么抽出来（2026-10-11）：影子账本要拿自己的样本跟回测比，两边必须同口径。
//   常量若在两处各定义一份，"改一处忘另一处"只是时间问题——历史上 pain 的假期
//   旧对（10-07 跑出 9-29→9-30 顶替 9-30→10-08）正是"多入口各自判断今天"造成的
//   分叉。故只留一份实现，两边 import，分叉在结构上就不可能了。
export const EMO_WIN = 120;      // 滚动窗口（交易日）
export const EMO_LO_Q = 0.15;    // 冰点：低于历史 15 分位
export const EMO_HI_Q = 0.85;    // 过热避险：高于历史 85 分位
export const EMO_WARMUP = 60;    // 攒够 60 天历史才出信号

/**
 * 滚动分位阈值（纯函数）。
 *
 * ⚠ 无前视纪律：调用方必须**先算阈值、再把 T 日值入 hist**——
 *   若先把 T 日值塞进 hist 再算阈值，阈值就包含了 T 日自己（前视偏差），
 *   回测会系统性偏乐观。两个调用方（回测 / 影子账本）都遵守同一顺序。
 *
 * @param {number[]} hist 截至 T-1 日的历史情绪值（不得含 T 日）
 * @returns {{lo:number|null, hi:number|null}} warmup 不足时返回 null——
 *   不出信号、不硬凑（宁缺毋假）。
 */
export function thresholdsAt(hist) {
  if (!Array.isArray(hist) || hist.length < EMO_WARMUP) return { lo: null, hi: null };
  // 只取窗口内最近 EMO_WIN 天：分布会漂移，更老的数据不该影响今天的阈值
  const w = hist.slice(-EMO_WIN).sort((a, b) => a - b);
  return {
    lo: w[Math.floor((w.length - 1) * EMO_LO_Q)],
    hi: w[Math.floor((w.length - 1) * EMO_HI_Q)],
  };
}
