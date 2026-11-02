// 方向 C：妖股逻辑推演（消费端转换 + 新鲜度守卫）。
//
// 数据流（照 llm_sentiment 三段式）：
//   scripts/fetch_dragon_logic.mjs（盘后跑，取连板梯队 + 复用场景二板块情绪做 grounding → GLM 推演）
//   → data/llm-dragon-logic-latest.json（证据留痕，asOfDate 锚档案最近交易日）
//   → 本模块（纯函数、零依赖、不读盘）→ src/engine/write.js dragonLogicFn → signals.dragonLogic。
//
// 纪律：asOfDate 必须等于档案最新交易日（防伪）；缺档 / 陈旧 / 降级 → null 或 degraded 块。
//   本因子**纯参考**，绝不修改 regime/emotion 原始分数（军规#1：GLM 只提供附加过滤条件，
//   由下游代码决定采不采纳）。

/**
 * 把落盘报告转成 signals 妖股逻辑块。
 * @param {object|null} report 落盘的 llm-dragon-logic-latest.json（null=未生成）
 * @param {object} ctx { tradeDate: 档案最新交易日 }
 * @returns {object|null} null = 无有效证据；否则妖股逻辑块
 */
export function dragonLogicBlock(report, { tradeDate } = {}) {
  if (!report || typeof report !== 'object') return null;
  // 新鲜度守卫（crosscheck/pain 先例）：落盘 asOfDate 必须等于目标交易日。
  if (!report.asOfDate || report.asOfDate !== tradeDate) return null;

  if (report.degraded) {
    return {
      asOfDate: report.asOfDate,
      generatedAt: report.generatedAt || null,
      model: report.model || null,
      degraded: true,
      effective: false,
      effectNote: '妖股逻辑推演获取失败，默认空（不冒充结论）',
      dragons: [],
      pureSentiment: [],
      byType: {},
    };
  }

  // 实盘权限过滤（2026-10-29·老板无创业板300/301、科创板688权限）：妖股透视仍保留全市场连板（含 300/688）
  //   用于参考市场情绪；原「名称前缀 [无权限]」文本标签已弃用——板块徽章（创业/科创）已能标识板块，
  //   且北交所本就无该文本标签，继续保留只会造成冗余。tradability 改用 noPermission 数据属性承载
  //   （前端不渲染文字标签，仅在数据层保留「不可交易」语义，供未来按需展示）。
  const NO_PERM = /^(300|301|688)/;
  const tagDragon = (d) => (NO_PERM.test(String(d.code || ''))
    ? { ...d, noPermission: true }
    : d);
  const dragons = (Array.isArray(report.dragons) ? report.dragons : []).map(tagDragon);
  const pureSentiment = dragons
    .filter((d) => d.is_pure_sentiment)
    .map((d) => ({ code: d.code, name: d.name, lb: d.lb, hybk: d.hybk, logic_type: d.logic_type, reason: d.reason, confidence: d.confidence, noPermission: d.noPermission }));
  const byType = {};
  dragons.forEach((d) => { byType[d.logic_type] = (byType[d.logic_type] || 0) + 1; });

  return {
    asOfDate: report.asOfDate,
    generatedAt: report.generatedAt || null,
    model: report.model || null,
    degraded: false,
    scanned: report.scanned != null ? report.scanned : null,
    dragons,
    pureSentiment,
    byType,
    note: '妖股逻辑推演（方向C）：连板股涨停逻辑/纯情绪炒作判定，纯参考，不修改 regime/emotion 分数；由下游（paper.js 等）决定采不采纳。',
  };
}
