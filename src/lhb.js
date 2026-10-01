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

// ── 新股/无涨跌幅限制标的判定（唯一出处）────────────────────────────────
//
// 东财榜单给出的上榜诱因里，新股/次新走的是「无价格涨跌幅限制的证券」这一条
// （上市首 5 日不设涨跌幅，与普通个股 ±10%/±20% 的板段不可比）。
//
// 为什么必须从 s_net 里剔除（2026-09-30 实测，这是本规则唯一的存在理由）：
//   · 当日榜净买 +7.74 亿里，力勤资源(001246) 一只贡献 +5.04 亿，占 65%；
//   · s_net 因子 = tanh(净买/5)*50+50，7.74 亿已推高到 95.7（接近满分）；
//   · 剔掉这一只后剩 −0.91 亿，因子应为 41.0（由强转弱）——分值虚高 54.7，情绪分虚高 8.58 分；
//   · 新股首日换手极高、筹码未沉淀，其大额净买衡量的是「打新资金出货承接」，
//     不是二级市场存量资金的进攻意愿，混入即把「新股放量」误读成「游资进攻」。
//
// 判定必须看 reasons 全部上榜原因（同票可因多个原因上榜），不能只看代表那条。
export const NEW_STOCK_RE = /无价格涨跌幅限制/;

// 一条（通常为已聚合、带 reasons 数组的）记录是否属于新股/无涨跌幅限制
export function isNewStock(l) {
  if (!l) return false;
  const list = Array.isArray(l.reasons) && l.reasons.length ? l.reasons : [l.reason || ''];
  return list.some((r) => NEW_STOCK_RE.test(String(r)));
}

// 从「当日榜去重行」里分离新股与存量个股的净买额（单位：亿）。
// 口径纪律：分子分母都用同一份 rows（必须是当日榜 daily_aggr），不得一处用明细、一处用汇总。
//   剔新股净买 = 全部当日榜净买 − 新股净买
//   ratio      = 新股净买 / 全部当日榜净买（分母 ≤0 时无意义，返回 null）
// 注意「新股净买为负」的情形：此时剔新股后净买反而更高，不做人为截断，如实返回。
export function splitNewStockNet(dailyRows) {
  const rows = Array.isArray(dailyRows) ? dailyRows : [];
  const delisted = [], kept = [];
  for (const l of rows) (isNewStock(l) ? delisted : kept).push(l);
  const totalYi = r2(sumOf(rows, (l) => l.net_buy_wan) / 1e4);
  const newYi = r2(sumOf(delisted, (l) => l.net_buy_wan) / 1e4);
  const exNewYi = r2(totalYi - newYi);
  return {
    total_yi: totalYi,                                   // 含新股的当日榜净买（未修正口径）
    new_yi: newYi,                                       // 新股贡献的净买
    ex_new_yi: exNewYi,                                  // ← 喂 s_net 的唯一口径
    new_stocks: delisted.map((l) => ({ code: l.code, name: l.name, net_yi: r2((l.net_buy_wan || 0) / 1e4) })),
    total_stocks: rows.length,
    new_count: delisted.length,
    ratio: totalYi > 0 ? r2(newYi / totalYi) : null,     // 占当日榜净买比例
  };
}

// 新股扰动熔断线：占比 > 25% 视为显著扰动，报告必须显式标注「因子已自动剔除」。
// 该阈值沿用 app.js 报告端既有的 25% 告警线，不再另立新阈值。
export const NEW_STOCK_DISTURB_RATIO = 0.25;

// 判定某日是否触发新股扰动熔断（ratio 缺省视为未触发）
export function isNewStockDisturbed(ratio) {
  return ratio != null && ratio > NEW_STOCK_DISTURB_RATIO;
}

// 从某个 day 对象取「当日榜去重行」并完成新股分离。
// 直接复用 caliberFromDay —— 它已收敛了「明细优先 / 原始记录次之 / 聚合兜底」三级回退，
// 本函数不再自行拼接数组：早先版本对未去重的 lhb_aggr 再跑一次 aggregateByCode，
// 会因「同票取 |净额| 最大者」把区间累计榜顶替当日榜（33 天里 30 天数值偏离），
// 与 511 亿事件是同一个坑。
export function newStockSplitOfDay(day) {
  const c = caliberFromDay(day);
  return splitNewStockNet(c.daily_aggr);
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
  const seg = splitNewStockNet(dailyAggr);
  return {
    // 当日榜
    daily_stocks: dailyAggr.length,
    daily_net_yi: r2(sumOf(dailyAggr, (l) => l.net_buy_wan) / 1e4),
    daily_amt_yi: r2(sumOf(dailyAggr, dealOf) / 1e4),
    daily_aggr: dailyAggr,
    // 当日榜 · 剔除新股/无涨跌幅限制标的（喂 s_net 的唯一口径）
    //   为什么必须在汇总层就分开：s_net = tanh(净买/5)*50+50 在 5 亿量级近饱和，
    //   一笔新股大额净买就能把因子从「转弱」推到「接近满分」（2026-09-30 实测虚高 54.7 分）。
    daily_ex_new_net_yi: seg.ex_new_yi,
    daily_new_net_yi: seg.new_yi,
    daily_new_ratio: seg.ratio,
    daily_new_stocks: seg.new_stocks,
    daily_new_count: seg.new_count,
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
  // ① 明细优先：lhb_daily_aggr 已是「当日榜 + 去重」的行（新数据都有）。
  //    直接喂 splitNewStockNet，不再二次 aggregateByCode —— 它是聚合产物，不是原始记录。
  if (Array.isArray(day?.lhb_daily_aggr) && day.lhb_daily_aggr.length) {
    const rows = day.lhb_daily_aggr;
    const seg = splitNewStockNet(rows);
    const dailyNet = r2(sumOf(rows, (l) => l.net_buy_wan) / 1e4);
    return {
      daily_stocks: rows.length,
      daily_net_yi: dailyNet,
      daily_amt_yi: r2(sumOf(rows, dealOf) / 1e4),
      daily_aggr: rows,
      daily_ex_new_net_yi: seg.ex_new_yi,
      daily_new_net_yi: seg.new_yi,
      daily_ratio_or_null: seg.ratio,
      daily_new_ratio: seg.ratio,
      daily_new_stocks: seg.new_stocks,
      daily_new_count: seg.new_count,
      all_stocks: Array.isArray(day?.lhb_aggr) ? day.lhb_aggr.length : rows.length,
      all_net_yi: ((day?.summary || {}).lhb_all_net != null) ? day.summary.lhb_all_net
        : r2(sumOf(Array.isArray(day?.lhb_aggr) ? day.lhb_aggr : rows, (l) => l.net_buy_wan) / 1e4),
      all_pos: ((day?.summary || {}).net_pos != null) ? day.summary.net_pos : null,
      all_neg: ((day?.summary || {}).net_neg != null) ? day.summary.net_neg : null,
      all_aggr: Array.isArray(day?.lhb_aggr) ? day.lhb_aggr : rows,
      total_records: Array.isArray(day?.lhb) ? day.lhb.length : rows.length,
      range_records: Array.isArray(day?.summary) ? 0 : 0,
    };
  }
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
