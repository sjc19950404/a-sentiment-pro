/**
 * 动态题材图谱·轻量共现版（2026-11-10，六方向 #3，用户拍板「一步步落实」）。
 *
 * 定位：纯函数 + EOD sidecar。数据源 = archive 逐日 topics（[{tag,count}]，词面已由
 *   涨停 hot 聚合），做**题材共现统计**：同日同时活跃的题材对 → 共现天数 + Jaccard。
 *   现有 main_theme.js（主线三条件/轮动）与 themes.js（词典去噪）已覆盖主线判定与
 *   归一——本模块**不重复**做这两件事，只补「题材间关联」这一缺失维度。
 * 主线/杂毛标记：main_theme_history.latest 即当日主线结论（唯一出处），本模块仅在
 *   输出里透传引用，不另行判定（披露不判定纪律）。
 * 窗口如实披露：topics 覆盖天数有限（2026-11-10 实测 53/261），输出 windowDays 注明。
 */

/**
 * @param {Array} days archive.all_days（含 topics）
 * @param {object} [opts] { topN: 每日纳入图谱的题材数（默认 8）, minCount: 单题材最低活跃天数（默认 2） }
 * @returns {null | { windowDays, themes, edges, generatedNote }}
 */
export function buildThemeGraph(days, opts = {}) {
  const list = Array.isArray(days) ? days : [];
  const topN = opts.topN || 8;
  const minCount = opts.minCount || 2;
  const co = new Map();      // "a|b" -> 共现天数
  const themeDays = new Map(); // tag -> { days:Set, latest:count, latestDate }
  let windowDays = 0;
  for (const d of list) {
    const topics = d && Array.isArray(d.topics) ? d.topics : null;
    if (!topics || !topics.length) continue;
    windowDays++;
    const date = d.trade_date || d.date;
    const tags = topics.slice(0, topN).map((t) => String(t.tag || '')).filter(Boolean);
    tags.forEach((t) => {
      if (!themeDays.has(t)) themeDays.set(t, { days: new Set(), latest: 0, latestDate: date });
      const e = themeDays.get(t);
      e.days.add(date);
      if (date >= e.latestDate) { e.latest = topics.find((x) => x.tag === t)?.count ?? e.latest; e.latestDate = date; }
    });
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join('|');
        co.set(key, (co.get(key) || 0) + 1);
      }
    }
  }
  if (!windowDays) return null;
  const themes = [...themeDays.entries()]
    .filter(([, e]) => e.days.size >= minCount)
    .map(([tag, e]) => ({ tag, days: e.days.size, latest: e.latest, latestDate: e.latestDate }))
    .sort((a, b) => b.days - a.days);
  const idx = new Map(themes.map((t) => [t.tag, t.days]));
  const edges = [];
  for (const [key, c] of co) {
    const [a, b] = key.split('|');
    const da = idx.get(a), db = idx.get(b);
    if (da == null || db == null) continue; // 只留活跃题材间的边
    const uni = da + db - c;
    edges.push({ a, b, co: c, jaccard: uni > 0 ? +(c / uni).toFixed(3) : 0 });
  }
  edges.sort((x, y) => y.jaccard - x.jaccard || y.co - x.co);
  return {
    windowDays,
    themes,
    edges: edges.slice(0, 60), // 体积纪律：只留 top 关联边
    generatedNote: `共现窗口 ${windowDays} 天（topics 档覆盖范围内）；每日取前 ${topN} 题材`,
  };
}
