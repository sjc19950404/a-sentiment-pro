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
/* 【2026-11-20 红盘自检（拍板）】新闻面与盘面背离判据——冰点普跌日唯一当日可达的
 * 硬判据：利好 TOP5（score>0.2 前 5）中当日红盘只数 <40% 且宏观 score ≥ +0.1 →
 * 背离告警（本节读数降权，不参与任何参考修正）。
 * 板块名→行业涨跌匹配：精确同名优先、子串互含次之；匹配不到的概念板块（CPO/6G
 * 这类交易所无对应行业）**不计入分母**（无法核对≠红盘）；可核对板块 <2 不判定
 * （判据无法成立时不误报）。
 * 纯函数：sectors/macro 来自 sectorSentiment 注入档，industryRows=当日 day.industry
 * （[{name,change_pct}]）。app.js/daily_report 两端渲染只读 deviation 字段。 */
export function deviationCheck(sectors, macroSentiment, industryRows) {
  const rows = Array.isArray(industryRows) ? industryRows : [];
  const byName = new Map(rows.map((r) => [String(r.name || ''), Number(r.change_pct)]));
  const bulls = (Array.isArray(sectors) ? sectors : [])
    .filter((s) => (s.score || 0) > 0.2)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5);
  const checked = [];   // {sector, changePct|null, red}
  for (const s of bulls) {
    const name = String(s.sector || '');
    let pct = byName.has(name) ? byName.get(name) : undefined;
    if (pct === undefined) {   // 子串互含（板块名 ⊂ 行业名 或反之）
      for (const [n, v] of byName) {
        if (n && (n.includes(name) || name.includes(n))) { pct = v; break; }
      }
    }
    if (pct === undefined) continue;              // 概念板块无对应行业 → 不计入
    checked.push({ sector: name, changePct: pct, red: pct > 0 });
  }
  const redCount = checked.filter((x) => x.red).length;
  const flagged = checked.length >= 2
    && redCount / checked.length < 0.4
    && (Number(macroSentiment) || 0) >= 0.1;
  /* 【2026-11-20 A5 权重归零（豆包评审，实战暴露）】11-20 利好 TOP5 全是概念板块
   * （CPO/PCB/数据中心/服务器/商业航天），行业匹配 0 命中——此前 checked=0 时本函数
   * 静默（>0 才提示），"没数据被渲染成了没问题"。改为三态：flagged（背离）/ unverifiable
   * （0~1 个可核对，读数不可验证）/ pass（可核对且未背离）。unverifiable 时消费端必须
   * 降权提示，且利好榜不得被当作"有盘面支撑"。 */
  /* unverifiable 不设宏观方向条件——0 命中本身就是"读数无法与盘面对账"，中性日同样
   * 误导（11-20 实证：宏观 0.04 中性，若等 ≥0.1 则三态静默，利好榜仍会被当盘面支撑读）。 */
  /* unverifiable 不设宏观方向条件——0 命中本身就是"读数无法与盘面对账"，中性日同样
   * 误导（11-20 实证：宏观 0.04 中性，若等 ≥0.1 则三态静默，利好榜仍会被当盘面支撑读）。 */
  const unverifiable = checked.length < 2 && bulls.length > 0;
  return {
    checkedCount: checked.length,
    redCount,
    detail: checked,
    flagged,
    unverifiable,
    note: flagged
      ? `新闻面与盘面背离（利好板块当日红盘 ${redCount}/${checked.length}）——本节读数不参与任何参考修正，仅作舆情留痕`
      : unverifiable
        ? `利好板块均为概念板块（仅 ${checked.length} 个可与行业涨跌核对），无法与当日盘面核对——本节读数不可验证，不参与任何参考修正`
        : null,
  };
}

export function macroSectorSentimentBlock(report, { tradeDate, industryRows } = {}) {
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
    /* 红盘自检（2026-11-20 拍板）：利好 TOP5 当日红盘率 <40% 且宏观偏多 → flagged，
     * 消费端（daily_report §九 / app.js §九）读此字段标注背离并降权。 */
    deviation: deviationCheck(sectors, macro && macro.sentiment, industryRows),
    note: '板块情绪因子（场景二）：新闻→GLM 映射板块/方向/强度→聚合；score∈[-1,1]，仅作参考，不独立生成买卖信号。',
  };
}
