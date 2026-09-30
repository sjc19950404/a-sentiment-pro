// 龙虎榜口径唯一来源 —— 东财一次披露里混装两类榜单，任何地方都不得绕过本模块自行相加。
//
// ① 当日榜（reason 不含「连续N个交易日…」「严重异常期间…」）
//    席位买卖即当日口径，官方 BILLBOARD_DEAL_AMT 等于 买 + 卖。
//    → 这是「当日龙虎净买额」的唯一权威口径：日度情绪因子、净买率、新股扰动一律用它。
// ② 区间累计榜（reason 含「连续3/10个交易日涨跌幅偏离值累计达X%」「严重异常期间…」）
//    统计的是整个区间的累计值，且 BILLBOARD_BUY_AMT 被填成区间累计成交额
//    （实测 2026-09-30 近岸蛋白 688137 十日榜：BUY == SELL == ACCUM_AMOUNT == 116.97 亿、净额 0）。
//    → 只做单列诊断，禁止混入当日口径。
//
// 混用的后果（2026-09-30 实测）：
//   · 量级错：全部 84 条未去重合计 511.1 亿，当日榜去重仅 136.5 亿（3.7 倍），净买率被稀释成 2.4%（真实 5.7%）
//   · 更隐蔽的因子偏移：同票去重规则取 |净额| 最大者，区间累计值会顶替当日值（当日 9 只、净额差 3.12 亿），
//     使「日度」因子把三天累计当成一天。实测 2026-09-08 当日榜净买仅 -0.11 亿，全量口径却是 +13.42 亿，
//     s_net 因子因此从 48.9 被抬到 99.5（tanh 饱和），33 天里 13 天被顶到 100，几乎失去分辨力。

// 区间累计榜的判别式（两处以上使用，必须共用同一个正则，避免各写一份而口径漂移）
export const RANGE_BOARD_RE = /连续\s*[0-9一二三四五六七八九十]+\s*个交易日|严重异常期间/;

export function isRangeBoard(reason) {
  return RANGE_BOARD_RE.test(String(reason || ''));
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// 规范化一条原始记录（东财字段 → 内部字段）。is_range / caliber 在此定死，下游不再自行判断。
export function normalizeRecord(x) {
  const reason = x.EXPLANATION || '—';
  return {
    code: x.SECURITY_CODE,
    name: x.SECURITY_NAME_ABBR,
    reason,
    close: x.CLOSE_PRICE,
    change_pct: r2(x.CHANGE_RATE || 0),
    net_buy_wan: r1((x.BILLBOARD_NET_AMT || 0) / 1e4),
    buy_wan: r1((x.BILLBOARD_BUY_AMT || 0) / 1e4),
    sell_wan: r1((x.BILLBOARD_SELL_AMT || 0) / 1e4),
    // 东财官方「龙虎榜成交额」：当日榜等于 买+卖；区间榜里与被污染的 BUY_AMT 不同源，故单独取用
    deal_wan: r1((x.BILLBOARD_DEAL_AMT || 0) / 1e4),
    turnover_pct: r2(x.TURNOVERRATE || 0),
    is_range: isRangeBoard(reason),
  };
}

// 同票多榜（同一只票因不同上榜原因出现多条）→ 每股一笔，取 |净额| 最大的那条为代表。
// 同时记录该笔来自哪类榜单（caliber），供 UI 标注「区间」，避免把区间累计值当日度值读。
export function aggregateByCode(rows) {
  const byCode = new Map();
  for (const l of rows) {
    const prev = byCode.get(l.code);
    if (!prev) {
      byCode.set(l.code, { ...l, reasons: [l.reason], caliber: l.is_range ? 'range' : 'daily' });
      continue;
    }
    if (!prev.reasons.includes(l.reason)) prev.reasons.push(l.reason);
    if (Math.abs(l.net_buy_wan || 0) > Math.abs(prev.net_buy_wan || 0)) {
      // 换代表：reason / 买卖额 / 净额 / 榜单类型一起替换，保证「显示的诱因」与「显示的数值」同源。
      // 早先只换了数值没换 reason，会出现「诱因写着日涨幅偏离7%，数值却是连续3日累计」的错配。
      prev.reason = l.reason;
      prev.net_buy_wan = l.net_buy_wan;
      prev.buy_wan = l.buy_wan;
      prev.sell_wan = l.sell_wan;
      prev.deal_wan = l.deal_wan;
      prev.caliber = l.is_range ? 'range' : 'daily';
      prev.is_range = l.is_range;
    }
  }
  return [...byCode.values()];
}

const sumOf = (rows, f) => rows.reduce((a, l) => a + (f(l) || 0), 0);

// 成交额取值：优先东财官方 BILLBOARD_DEAL_AMT；存量老记录没这个字段，
// 而当日榜记录的 DEAL 恒等于 买+卖（已对源核验），故回退用买+卖。
// 注意：区间榜的 买+卖 是被污染的区间累计值，所以下面的 daily 汇总只喂当日榜记录，回退是安全的。
const dealOf = (l) => (l.deal_wan != null ? l.deal_wan : (l.buy_wan || 0) + (l.sell_wan || 0));

// 双口径汇总（唯一实现）。返回的字段一律带口径后缀，调用方无法含糊其辞。
//   daily.* —— 当日榜：权威口径，用于日度因子 / 净买率 / 新股扰动
//   all.*   —— 全量（含区间累计榜）：只做单列诊断与「上榜个股数」这类外部可核对的家数统计
export function summarizeCalibers(records) {
  const daily = records.filter((l) => !l.is_range);
  const allAggr = aggregateByCode(records);
  const dailyAggr = aggregateByCode(daily);
  return {
    // 当日榜
    daily_stocks: dailyAggr.length,
    daily_net_yi: r2(sumOf(dailyAggr, (l) => l.net_buy_wan) / 1e4),
    daily_amt_yi: r2(sumOf(dailyAggr, dealOf) / 1e4),
    daily_aggr: dailyAggr,
    // 全量（诊断）
    all_stocks: allAggr.length,
    all_net_yi: r2(sumOf(allAggr, (l) => l.net_buy_wan) / 1e4),
    all_pos: allAggr.filter((l) => l.net_buy_wan > 0).length,
    all_neg: allAggr.filter((l) => l.net_buy_wan < 0).length,
    all_aggr: allAggr,
    // 口径元信息
    total_records: records.length,
    range_records: records.length - daily.length,
  };
}

// 从已落盘的 day 对象重算双口径（历史批量重算专用，与实时抓取走同一套实现）。
// 存量记录可能没有 is_range / deal_wan：前者用 reason 现判，后者按当日榜等式回退。
export function caliberFromDay(day) {
  const rows = Array.isArray(day?.lhb) ? day.lhb : [];
  if (rows.length) {
    const norm = rows.map((l) => ({
      ...l,
      is_range: l.is_range != null ? l.is_range : isRangeBoard(l.reason),
    }));
    return summarizeCalibers(norm);
  }
  // 无原始记录（极早期种子天）：退化为用已聚合数组，但仍按 reason 判口径，绝不混算
  const aggr = Array.isArray(day?.lhb_aggr) ? day.lhb_aggr : [];
  const norm = aggr.map((l) => ({
    ...l,
    is_range: l.is_range != null ? l.is_range : isRangeBoard(l.reason),
  }));
  return summarizeCalibers(norm);
}

// 取某日的「当日榜」去重行（报告与主线占比共用，避免各自重新过滤时漏掉口径判断）
export function dailyRowsOf(day) {
  return caliberFromDay(day).daily_aggr;
}
