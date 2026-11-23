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

/* 【2026-11-24 用户拍板 B：锚点=旧口径档位天数占比，不是旧分位值】
 * 旧绝对档 80 分在**旧分布（s_net 死）**是 P98.2，但在**新分布（s_net 活）**只对应
 * P81.5——同一个绝对分在两个口径下差 17pp。拿 P98 当锚=锚在一张已作废的分布图上。
 * 正确锚是旧档位天数占比，反解到新分布的构造分位：
 *   过热 旧占比 18.15% → 100-18.15 = P81.85 ≈ P82（高分尾）
 *   满仓 旧占比 32.50% → 18.15+32.50 = P50.65；按"≥full"口径反解 P49（经回放校准）
 *   半仓 旧占比 47.60% → P2（高分尾 2% 以下判清仓，旧清仓占比 1.5%）
 *   清仓 旧占比 1.50% → 阈值 P2 下方，构造性对齐
 * ⚠ 下次任何因子/权重口径变动：重新按"旧占比 → 新分布反解分位"推导，
 *   不得再照抄 P98/P60/P1（那是作废分布的产物）。 */
export const BASELINE_TIER_POLICY = Object.freeze({
  id: 'scale-baseline', window: 250,
  quantiles: Object.freeze({ overheat: 0.82, full: 0.49, half: 0.02 }),
  note: 'P82/P49/P2 expanding250——锚点=旧档位天数占比（非旧分位值），尺度修正基线，单变量实验',
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


/* ── 【2026-11-24 纯 instrumentation：feature flag + 版本戳 + 单一入口】 ──
 * 行为零改动：当前 mode='absolute'，marketTier() 判档与旧版逐位相同。
 * 参数签名后只改这一行 mode → 'p82_confirm3_band3'，7 处调用点无需改动。
 * 每个产物落 marketTierVersion 字段，事后可核对"这一天的档是哪套口径判的"。
 */
/* 【2026-11-24 拍板 C：不签参数、归档择时，立即止损】
 * mode='alert_only'：marketTier 只输出告警标签（过热/冰点提示），**不输出仓位档**——
 * 仓位消费者（suggestWeight）回满仓 beta；-8% 单笔止损 / ≥15% 回撤动态降仓两条
 * 纯风控保持不变（实测基准 maxDD 28.33% vs 策略择时 13~19%，有效的是风控不是择时）。
 * 第三值 alert_only 仍可一键回滚到 absolute；p82_confirm3_band3 已归档不启用。 */
export const TIER_MODE_FLAG = Object.freeze({
  mode: 'alert_only',   // 唯一开关：'alert_only' | 'absolute' | 'p82_confirm3_band3'(归档禁用)
  switchedAt: '2026-11-24',
  archived: Object.freeze({ mode: 'p82_confirm3_band3', reason: '前段第61-130天超额 -0.42%（符号负）——三段判据不通过，停止调参' }),
});

export function marketTierVersion(flag = TIER_MODE_FLAG) {
  return 'marketTier/' + (flag.mode === 'absolute'
    ? 'v5.2-absolute-80_65_24'
    : 'v5.3-' + flag.mode);
}

/** C 形态：判档标签 → 告警文案（无仓位字段）。供报告/paper/复盘共用。 */
export function tierAlert(tier) {
  if (!tier) return null;
  return { key: tier.key, label: tier.label, alertOnly: true,
    text: tier.key === 'overheat' ? '情绪过热提示（不干预仓位）'
      : tier.key === 'clear' ? '情绪冰点提示（不干预仓位）' : '情绪档位提示（不干预仓位）' };
}
