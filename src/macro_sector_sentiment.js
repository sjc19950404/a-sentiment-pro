// 场景二：宏观/行业新闻 → 板块情绪因子（消费端转换 + 板块归一 + 新鲜度守卫）。
//
// 数据流（照 llm_sentiment.js 三段式）：
//   scripts/fetch_macro_sector_sentiment.mjs（盘后/周末跑，抓新浪滚动新闻 + GLM 分类聚合）
//   → data/macro-sector-sentiment-latest.json（证据留痕，asOfDate 锚档案最近交易日）
//   → 本模块（纯函数、零依赖、不读盘）→ src/engine/write.js sectorSentimentFn 注入 signals.sectorSentiment。
//
// 纪律：asOfDate 必须等于档案最新交易日（防伪：周末新闻是为下一交易日蓄势，但锚点仍是最近交易日）；
//   缺档 / 陈旧 / 降级 → null 或 degraded 块（前端显示「未生成」，绝不把「没跑」渲染成「中性」）。

/**
 * 把落盘报告转成 signals 板块情绪块。
 * @param {object|null} report 落盘的 macro-sector-sentiment-latest.json（null=未生成）
 * @param {object} ctx { tradeDate: 档案最新交易日 }
 * @returns {object|null} null = 无有效证据；否则板块情绪块
 */
export function macroSectorSentimentBlock(report, { tradeDate } = {}) {
  if (!report || typeof report !== 'object') return null;
  // 新鲜度守卫（crosscheck/pain 先例）：落盘 asOfDate 必须等于目标交易日——
  // 板块情绪是「某一天」的快照，旧结论不得冒充今天的证据。
  if (!report.asOfDate || report.asOfDate !== tradeDate) return null;

  if (report.degraded) {
    return {
      asOfDate: report.asOfDate,
      generatedAt: report.generatedAt || null,
      model: report.model || null,
      degraded: true,
      effective: false,
      effectNote: (report.macro && report.macro.reason) || '板块情绪获取失败，默认中性',
      macro: { sentiment: 0, score100:50, label: '中性', confidence: 0, reason: '获取失败兜底' },
      sectors: [],
      events: [],
    };
  }

  const macro = (report.macro && typeof report.macro === 'object')
    ? report.macro
    : { sentiment: 0, score100: 50, label: '中性', confidence: 0, reason: '' };
  const sectors = Array.isArray(report.sectors) ? report.sectors : [];

  // 下游便捷：前 N 大多头 / 空头板块
  const topBullish = sectors.filter((s) => s.score > 0.2).slice(0, 8)
    .map((s) => ({ sector: s.sector, score: s.score, newsCount: s.newsCount }));
  const topBearish = sectors.filter((s) => s.score < -0.2).slice(0, 8)
    .map((s) => ({ sector: s.sector, score: s.score, newsCount: s.newsCount }));

  // 仅透传「有板块影响」的事件，控制 signals 体积
  const events = (Array.isArray(report.events) ? report.events : [])
    .filter((e) => Array.isArray(e.sectors) && e.sectors.length && e.direction && e.direction !== 'neutral')
    .slice(0, 30)
    .map((e) => ({ headline: e.headline, date: e.date, sectors: e.sectors, direction: e.direction, intensity: e.intensity, reason: e.reason }));

  return {
    asOfDate: report.asOfDate,
    generatedAt: report.generatedAt || null,
    model: report.model || null,
    degraded: false,
    macro,
    sectors: sectors.slice(0, 30),
    topBullish,
    topBearish,
    events,
    blackTalk: report.blackTalk || null,
    source: report.source || null,
    scanned: (report.scanned != null) ? report.scanned : null,
    note: '板块情绪因子（场景二）：新闻→GLM 映射板块/方向/强度→聚合；score∈[-1,1]，仅作参考，不独立生成买卖信号。',
  };
}
