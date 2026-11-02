// 仓位区间策略层（V5.3，2026-10-05 拍板）
//
// ── 职责边界（关键纪律）────────────────────────────────────────────────────
//   regime.js 的标签是**描述**（"现在什么状态"），不是建议——那是它刻在头注释里的
//   设计纪律。仓位区间是**建议**，两者必须分家：本模块是唯一的
//   "regime 档位 → 仓位区间"翻译层，regime 保持纯分类不动。
//
//   输出语义：区间是**风控参考上限**，不是买卖信号；原有情绪打分（scoreWith /
//   positions 四档阈值）继续作为信号主路径，本层只给"帽子上限"。
//   （V5.3 需求：系统输出仓位不再是固定值，由市场状态识别结果自动输出仓位区间，
//    原有情绪打分作为辅助校验——即信号归信号、帽子归帽子。）
//
// ── 区间表依据（V5.3 需求文档第三节）───────────────────────────────────────
//   · 情绪退潮/冰点        → 0~20%，优先空仓
//   · 复苏/酝酿期          → 30~50%（中性震荡，基准情景）
//   · 主升行情             → 60~100%
//   · 高潮分歧/状态切换期   → 强制降仓 ≤30%，限制新开进攻仓
//   映射到本项目 regime 七档（ice/recover/climax/ebb/neutral/shift/unknown）：
//   · ice（冰点）      → 0~20%      （需求"退潮/冰点"档）
//   · ebb（退潮）      → 0~20%      （高位下行，需求同归"退潮"档）
//   · recover（回暖）  → 30~50%     （需求"复苏/酝酿"档）
//   · neutral（中性）  → 30~50%     （需求注明"当前基准情景"即中性震荡）
//   · climax（高潮）   → 60~100%    （情绪高位+方向上/平=主升；注意：出现矛盾证据时
//                                    regime 已覆盖为 shift，见 regime.js 矛盾覆盖段）
//   · shift（切换期）  → 0~30% 强制 （高潮分歧/状态切换：降仓+限制新开进攻仓）
//   · unknown          → 不给区间   （缺失显式化：判不出状态就没有仓位意见，
//                                    消费方按保守档 0~20% 处理——与 idempotence
//                                    "unknown 按需要重算处理"同一保守方向纪律）
//
// ── 纪律 ──────────────────────────────────────────────────────────────────
//   • 区间数字**唯一出处**在 POSITION_BANDS，下游（日报/前端/回测接线）不得写死。
//   • 不构成投资建议：disclaimer 固定输出；区间是"该状态下的历史风控口径"。
//   • 纯函数 + 无 IO：输入 regime key（字符串），输出区间对象。

// 唯一出处。数值 = 小数仓位（0.2 = 20%）；对外的百分比文案由 formatBand 生成。
export const POSITION_BANDS = {
  ice: {
    key: 'ice', minPos: 0.0, maxPos: 0.2,
    label: '冰点', advice: '优先空仓，仅极端错杀才值得试探',
    tone: 'defend',
  },
  ebb: {
    key: 'ebb', minPos: 0.0, maxPos: 0.2,
    label: '退潮', advice: '高位下行，防补跌优先，只减不加',
    tone: 'defend',
  },
  recover: {
    key: 'recover', minPos: 0.3, maxPos: 0.5,
    label: '复苏/酝酿期', advice: '中性震荡试仓，跟随确认再加',
    tone: 'balanced',
  },
  neutral: {
    key: 'neutral', minPos: 0.3, maxPos: 0.5,
    label: '中性震荡', advice: '基准情景：半仓上下，结构机会为主',
    tone: 'balanced',
  },
  climax: {
    key: 'climax', minPos: 0.6, maxPos: 1.0,
    label: '主升行情', advice: '顺势持有为主，追高需留给止损纪律',
    tone: 'attack',
  },
  shift: {
    key: 'shift', minPos: 0.0, maxPos: 0.3,
    label: '高潮分歧/状态切换期', advice: '强制降仓：限制新开进攻仓，只留核心仓',
    tone: 'defend', force: true, // force = 需求语义"强制降仓"，前端显著标识
  },
};

// unknown 的保守回退档（显式独立于 POSITION_BANDS：unknown 不是"状态"，
// 是"没有状态"，绝不给正式区间；消费方拿 conservativeBand 自行降级处理）。
export const CONSERVATIVE_BAND = {
  key: 'unknown', minPos: 0.0, maxPos: 0.2,
  label: '数据不足（保守回退）',
  advice: '状态判据不足，按最低档 0~20% 保守处理',
  tone: 'defend', fallback: true,
};

/** regime key → 仓位区间；未知 key / unknown / null → null（缺失显式化，不猜）。 */
export function bandFor(key) {
  if (key == null) return null;
  const b = POSITION_BANDS[String(key)];
  return b ? { ...b } : null;
}

/** 区间的人类可读文案："0%~20%" / "30%~50%"（显示层唯一出处）。 */
export function formatBand(band) {
  if (!band || typeof band.minPos !== 'number' || typeof band.maxPos !== 'number') return null;
  return `${Math.round(band.minPos * 100)}%~${Math.round(band.maxPos * 100)}%`;
}

/**
 * 日报/简报用的一句话：状态 → 仓位区间 + 动作口径。
 *  unknown / 无 band → null（调用方走缺失显式化分支，绝不输出"建议仓位 0%"）。
 *  返回 { text, band, force } —— force 供前端加"强制"标识（切换期语义）。
 */
export function positionLine(key) {
  const band = bandFor(key);
  if (!band) return null;
  const range = formatBand(band);
  return {
    band,
    range,
    force: band.force === true,
    text: band.force
      ? `推荐仓位区间 ${range}（强制降仓，限制新开进攻仓）`
      : `推荐仓位区间 ${range}（${band.advice}）`,
  };
}

export const DISCLAIMER = '仓位区间由市场状态（regime 档位）映射得出，是风控参考上限而非买卖信号；'
  + '情绪打分与阈值信号仍是交易主路径，本层只做仓位帽子。不构成投资建议。';

// ── 展示层合并（2026-10-24 加；消除"研判简报喊进攻 / 日报叫降仓"的认知冲突）──
//   根因：两份报告此前从**不同 regime 源**取值——研判简报读 dual_track.day.regime，
//   日报用 regime.js 实时 classifyRegime——同一天可能判出 climax(60~100) 与 shift(0~30)，
//   读者看到的就是"精神分裂"。合并后统一以**日报权威 regime**（signals.dailyReport.tag.key）
//   为风控帽，并把"情绪基础仓位（由情绪分翻译）"显式摆出来，最终执行以帽为准。
//
//   注意：本段只做"展示合成"，不引入任何新风控规则。基础仓位阈值与 POSITION_BANDS
//   档位对齐（情绪极高位↔进攻档），纯翻译，便于"情绪喊冲 vs 风控盖帽"一眼对照。

/** 情绪绝对水位 → 与 POSITION_BANDS 同尺度的"基础仓位"（仅作 regime 帽的对照基准）。 */
export function scoreToBand(score) {
  if (score == null) return null;
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s >= 80) return { key: 'base_attack', minPos: 0.6, maxPos: 1.0, label: '进攻（情绪极高位）' };
  if (s >= 65) return { key: 'base_bull', minPos: 0.3, maxPos: 0.6, label: '偏多' };
  if (s >= 50) return { key: 'base_neutral', minPos: 0.3, maxPos: 0.5, label: '中性' };
  return { key: 'base_defend', minPos: 0.0, maxPos: 0.3, label: '防守' };
}

/**
 * 合成"基础仓位 × 风控帽"——展示层合并核心纯函数。
 * @returns {null|object} null = 任一口径缺失（显式化，不猜）；否则含 base/cap/force/conflict/finalRange。
 *   conflict = 情绪基础仓位上限 > 风控帽上限（情绪喊冲、风控叫停）；finalRange 恒等于 capRange。
 */
export function reconcilePosition({ score, regimeKey }) {
  const base = scoreToBand(score);
  const cap = bandFor(regimeKey);
  if (!base || !cap) return null;
  return {
    score: score == null ? null : Math.round(Number(score) * 10) / 10,
    base, baseRange: formatBand(base),
    cap, capRange: formatBand(cap),
    force: cap.force === true,
    // 冲突 = 情绪喊冲（进攻/偏多，建议 ≥30%）却遇风控盖帽（帽 ≤30% 或强制降仓）。
    //   专指"精神分裂"场景；低分(防守)遇 risk-off 帽不算冲突（两者都叫防守）。
    conflict: (base.key === 'base_attack' || base.key === 'base_bull') && (cap.maxPos <= 0.3),
    finalRange: formatBand(cap),
  };
}

/**
 * 合成叙述（纯文本，headline / 研报要点 / 企微文案复用同一句，避免口径漂移）。
 * @param {object} rec reconcilePosition 返回值（null → 返回 null）
 * @param {{ regLabel?:string, divergence?:boolean }} ctx regime 中文标签、是否宽度背离
 */
export function positionNarrative(rec, { regLabel = null, divergence = false } = {}) {
  if (!rec) return null;
  const state = regLabel || rec.cap.label;
  const warn = rec.force || divergence;
  if (rec.conflict) {
    return `市场状态：${state}${warn ? '（假繁荣预警）' : ''}｜最终执行仓位：${rec.finalRange}。`
      + `当前情绪分 ${rec.score}（历史极高位），基础模型建议 ${rec.baseRange}，但触发 regime=${rec.cap.key} 风控帽，系统强制降仓。`
      + `交易纪律：只减仓不新建。`;
  }
  return `市场状态：${state}｜最终执行仓位：${rec.finalRange}（情绪分 ${rec.score} 与风控帽同向，无需降仓）。`;
}
