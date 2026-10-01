// archive 切片：把完整档案拆成「索引 + 按年分片 + 近 N 日滚动窗」
//
// ── 为什么拆 ────────────────────────────────────────────────────────────────
// archive.json 已到 7.6MB（241 天），其中 lhb 明细占 80%。前端每次首屏全量拉，
// 半年后就是十几 MB，首屏必然卡。而首屏真正需要的只有**最新一天**。
//
// 实际分层（用户要求的三档：最新日 → 近 30 天 → 全档）：
//   · archive-index.json   —— 元信息 + 年份列表 + 最新日摘要（**10.5KB**），首屏必拉
//   · archive-recent.json  —— 近 30 日：29 个"曲线点" + 最新日完整明细（**~40KB**），
//                             开走势图/渲染表格时才拉
//   · archive-YYYY.json    —— 该年完整数据（几百 KB ~ MB），详情抽屉要回看时才拉
//   · archive.json         —— 完整档（脚本/审计/回测用），前端**不再**拉
//
// ⚠ 这是**纯函数模块**：不读盘不写盘。落盘由调用方（src/pipeline.js writeArchive、
//   scripts/split_archive.mjs）负责，便于单测与守卫。
//
// ⚠ 分片必须与主档**同源**：切片永远由 writeArchive 从刚写好的 archive 对象生成，
//   绝不允许"单独跑一次切片脚本"成为常规路径——那会让两个文件各自演化、
//   页面与脚本看到不同的数据（最坏情况是分位与因子对不上，且没人发现）。
//
// ⚠ 入参 archive 是**已序列化态**（lhb 已码表压缩、惰性字段已在 `_sub`）：
//   本模块只做"搬运/裁剪"，不碰 reason 也不解 `_sub`。语义见 src/lhb_codec.js。

/** 每年分片的年键（按 trade_date 的年份）。跨年档案天然落到不同文件。 */
export function yearOf(tradeDate) {
  return String(tradeDate || '').slice(0, 4);
}

/**
 * 每年摘要：让首屏在只拉 index 的情况下就能画年份导航、甚至粗略走势。
 * 只放**聚合值**，不放任何明细——明细是分片的职责。
 */
export function yearSummary(days) {
  const list = Array.isArray(days) ? days : [];
  if (!list.length) return null;
  const values = list.map((d) => d.emotion?.value ?? d.emotion?.score ?? null).filter((v) => typeof v === 'number');
  const bias = list.map((d) => d.emotion?.breadth_bias ?? null).filter((v) => typeof v === 'number');
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  return {
    days: list.length,
    fullDays: list.filter((d) => !(d.emotion && d.emotion._backfill)).length,
    backfillDays: list.filter((d) => d.emotion && d.emotion._backfill).length,
    from: list[0].trade_date,
    to: list[list.length - 1].trade_date,
    valueMin: values.length ? Math.min(...values) : null,
    valueMax: values.length ? Math.max(...values) : null,
    valueAvg: avg(values),
    biasBiasMin: bias.length ? Math.min(...bias) : null,
    biasMax: bias.length ? Math.max(...bias) : null,
  };
}

/**
 * 生成索引文件：轻到可以随首屏无条件拉取。
 *
 * 刻意**不含**任何 all_days 明细：索引一旦变肥，拆分的意义就没了。
 * 体积守卫（scripts/audit_lhb_caliber.mjs B9）会断言 < 32KB。
 */
export function buildIndex(archive) {
  const days = (archive && archive.all_days) || [];
  const years = [...new Set(days.map((d) => yearOf(d.trade_date)))].filter(Boolean).sort();
  const yearMeta = {};
  for (const y of years) {
    yearMeta[y] = yearSummary(days.filter((d) => yearOf(d.trade_date) === y));
  }
  const latest = days[days.length - 1] || null;
  return {
    kind: 'archive-index',
    version: 1,
    meta: archive?.meta || {},
    signals: archive?.signals || {},
    totalDays: days.length,
    years,
    yearMeta,
    // 最新一天的**摘要级**信息：让首屏不必等分片就能渲染关键指标。
    // 明细（lhb/hot/industry）一律不放——那是分片的内容。
    latestDate: latest ? latest.trade_date : null,
    latest: latest ? latestBrief(latest) : null,
    // 惰性字段体积提示：前端据此在 UI 上显示"席位明细需另拉"，而不是把它当成"没有席位"。
    lazy: lazyBrief(latest),
  };
}

/**
 * 最新日**未随首屏传输**的惰性字段清单（字节数）。
 *
 * 存在的意义不只是省流量：席位明细被提走后，`summary.seats` 会是 null，
 * 前端若直接渲染就会把「有 66 只有席位明细」显示成「无数据」——这是**假阴性**，
 * 比缺数据更糟。故必须让前端有办法知道「不是没有，是还没拉」。
 */
export function lazyBrief(d) {
  if (!d || !d._sub) return null;
  const out = {};
  for (const k of Object.keys(d._sub)) {
    out[k] = Buffer.byteLength(JSON.stringify(d._sub[k] ?? null), 'utf8');
  }
  return Object.keys(out).length ? out : null;
}

/** 单日摘要：首屏渲染所需的最小集合（不含任何明细数组）。 */
export function latestBrief(d) {
  if (!d) return null;
  const e = d.emotion || {};
  const s = d.summary || {};
  return {
    trade_date: d.trade_date,
    value: e.value ?? e.score ?? null,
    pct_rank: e.pct_rank ?? null,
    net_daily_pct_rank: e.net_daily_pct_rank ?? null,
    factors: e.factors || null,
    missing: e.missing || null,
    imputedRatio: e.imputedRatio ?? null,
    backfill: !!(e._backfill),
    lhb_daily_net: s.lhb_daily_net ?? null,
    lhb_stocks: s.lhb_stocks ?? null,
    lhb_daily_stocks: s.lhb_daily_stocks ?? null,
    zt_count: s.zt_count ?? null,
    dt_count: s.dt_count ?? null,
    zb_count: s.zb_count ?? null,
    up_count: s.up_count ?? null,
    down_count: s.down_count ?? null,
    amount_yi: s.amount_yi ?? null,
    ind_count: s.ind_count ?? null,
    // 板块相对强弱：与 index 档同源同字段名（前端一轮渲染可同时读两档）。
    // null 表示该日无行业明细 → 渲染成「未计算」，不得当成 0。
    industry_relative: s.industry_relative ?? null,
    main_theme: s.main_theme ?? null,
  };
}

/**
 * 生成按年分片对象。
 * 入参 diary 是完整 archive，返回 { year -> 分片对象 }。
 *
 * 分片里保留 meta/signals 的**同一份**：任何分片单独打开都能被前端当小档案用，
 * 不必回头再拉 index（减少一次往返，也让"只加载某一年"成为干净路径）。
 */
export function buildShards(archive) {
  const days = (archive && archive.all_days) || [];
  const out = {};
  for (const d of days) {
    const y = yearOf(d.trade_date);
    if (!y) continue;
    if (!out[y]) {
      out[y] = {
        kind: 'archive-shard',
        version: 1,
        year: y,
        meta: archive?.meta || {},
        signals: archive?.signals || {},
        all_days: [],
      };
    }
    out[y].all_days.push(d);
  }
  for (const y of Object.keys(out)) {
    out[y].totalDays = out[y].all_days.length;
    out[y].index = yearSummary(out[y].all_days);
  }
  return out;
}

/** 分片文件名（唯一出处，避免各处硬编码字符串拼错）。 */
export function shardName(year) {
  return `archive-${year}.json`;
}

// 滚动窗默认天数：覆盖走势图（15 日窗口）+ 详情抽屉回看 + 动量对比所需。
// 取 30 而非「近一年」——年分片仍可能 >6MB，滚动窗的意义就是让首屏与交互都不碰它。
export const RECENT_DAYS = 30;
export const RECENT_FILE = 'archive-recent.json';

/**
 * 近 N 个交易日的滚动窗 —— **两级分层**，这是体积能压到 10KB 级的关键。
 *
 * ── 为什么分层 ────────────────────────────────────────────────────────────
 * 走势图 / 抽屉回看需要 30 天，但 30 天里 29 天只需要「情绪曲线 + 因子」，
 * 逐日的 hot/lhb/industry 明细根本用不到；而最新一天需要全套明细（表格要渲染）。
 * 若把 30 天都按完整明细存，实测 1.5MB——比索引大了 150 倍，够开一次走势图，
 * 却让"只看最新日"也付了这份钱。
 *
 * 故：
 *   · all_days 只留**画走势所需的最小字段**（情绪 + 因子 + 几个计数），不含明细
 *   · 最新一天单独提到顶层 `latest`，带完整明细（但**不带 `_sub`** —— 席位/lhb
 *     仍是惰性的，需要时用 pickDay 从 `lazy` 提示的字段拉）
 *
 * 两级都保留 meta/signals，使前端只加载本文件就能完成首屏 + 走势渲染。
 */
export function buildRecent(archive, n = RECENT_DAYS) {
  const days = (archive && archive.all_days) || [];
  const slice = days.slice(-n);
  const last = slice[slice.length - 1] || null;
  const head = slice.slice(0, -1);
  return {
    kind: 'archive-recent',
    version: 2,
    window: n,
    totalDays: slice.length,
    meta: archive?.meta || {},
    signals: archive?.signals || {},
    index: yearSummary(slice),
    // 近 N-1 日：只保画曲线所需字段（见 trendPoint）
    days: head.map(trendPoint),
    // 最新日：完整明细，但惰性字段仍在 _sub（前端按需 pickDay）
    latest: last || null,
  };
}

/**
 * 走势点：画曲线与分位对照所需的最小字段集合。
 *
 * ⚠ 例外：`summary.seats` 不是"曲线字段"，但**必须带上**（只带有/无标记，不带明细）。
 *   原因：研判报告的「锁仓统计」要比对 `days.slice(-3,-1)` 的买方席位与最新日——
 *   即它需要**前 2 天也持有 seats**。若这里把 seats 裁掉，报告那段会静默消失，
 *   表现为"报告少了结论"（本次实测：窗口内只剩最新 1 天有 seats，锁仓统计整段不见了）。
 *   代价很小：只有当天确实有 seats 时才多一个对象，且各只有几个数字字段。
 */
export function trendPoint(d) {
  if (!d) return null;
  const e = d.emotion || {};
  const s = d.summary || {};
  const seatKeys = SEAT_SUMMARY_KEYS.filter((k) => s.seats && s.seats[k] != null);
  return {
    trade_date: d.trade_date,
    value: e.value ?? e.score ?? null,
    breadth_bias: e.breadth_bias ?? null,
    pct_rank: e.pct_rank ?? null,
    factors: e.factors || null,
    backfill: !!(e._backfill),
    zt_count: s.zt_count ?? null,
    dt_count: s.dt_count ?? null,
    zb_count: s.zb_count ?? null,
    seal_pct: s.seal_pct ?? null,
    zbl_pct: s.zbl_pct ?? null,
    up_count: s.up_count ?? null,
    down_count: s.down_count ?? null,
    max_lb: s.max_lb ?? null,
    amount_yi: s.amount_yi ?? null,
    lhb_daily_net: s.lhb_daily_net ?? null,
    // 板块相对强弱：走势点也带上——否则「回看更早交易日」时超额榜会整块消失
    // （同 seats 的教训：该带的字段裁掉，报告那段就静默不见了）。
    // 代价很小：有数据时约 2KB/日；无数据的日子就是 null，约 20 字节。
    industry_relative: s.industry_relative ?? null,
    // 席位摘要（不含 detail —— 那是唯一的大块，留给需要时的完整档）
    ...(seatKeys.length ? { summary: { seats: pickKeys(s.seats, seatKeys) } } : {}),
  };
}

/**
 * seat 摘要里要为历史日保留的键（唯一出处）。
 * 选取标准：**calcLockNew / 报告席位段在"非最新日"上真正读到的字段**。
 * detail 刻意不含——它单日 51KB，而锁仓统计只用 detail 比对最新日（由 latest 提供）。
 */
const SEAT_SUMMARY_KEYS = ['cover', 'detail'];

/** 只取指定键（浅拷贝，值不动）。 */
function pickKeys(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// signals-latest.json —— 三档里最轻的一档（实测 ~11KB）
//
// ── 为什么还要一个文件 ─────────────────────────────────────────────────────
// index 已经只有 10.6KB，为什么不直接把它当"最新日档"？
// 因为两者的**更新节奏与读者**不同：index 是给走势图/年份导航用的，读的人是浏览器；
// signals-latest 是给"盯盘/巡检"用的——包括不跑前端、只在终端看今日结论的自动化任务，
// 以及只看一条结论的移动端。把告警与动量从 index 拆出来，能让这类读者在
// **不解析逐年摘要、不下载任何明细**的前提下拿到今日结论。
//
// ── 为什么告警是「大盘层」而非全量 ─────────────────────────────────────────
// 全量告警要持仓数据（positions），而持仓是**浏览器本地账本**（localStorage），
// 服务端生成时根本看不到。硬要在服务端算，就得把账户上传——那是另一个量级的隐私变更。
// 故本文件只放 marketAlerts()：输入只有情绪分与总资产，服务端可算，且与前端同源
// （同一个 marketAlerts 函数，不存在"服务端口径 vs 前端口径"两套）。
// 持仓层告警仍由前端用本地账户算，见 paper_ui.js currentAlerts()。
// ════════════════════════════════════════════════════════════════════════════

export const SIGNALS_FILE = 'signals-latest.json';

/**
 * @param {object} archive 序列化态档案
 * @param {object} opts
 * @param {number} [opts.assumedTotal] 服务端无法知道真实账户，故按"满仓额度"给建议。
 *        默认 10 万（与 paper.js emptyAccount 默认一致），仅供"假如满仓"的口径演示；
 *        前端必须用本地真实 total/marketValue 重算，不得直接展示本字段的仓位结论。
 * @param {Function} [opts.marketAlertsFn] 注入 marketAlerts（保持本模块纯函数、可单测）
 * @param {Function} [opts.healthFn] 注入 health.healthReport（同上，纯函数注入）
 *        签名：healthFn(days, { meta }) → health 报告对象
 */
export function buildSignals(archive, opts = {}) {
  const days = (archive && archive.all_days) || [];
  const last = days[days.length - 1] || null;
  if (!last) return null;
  const assumedTotal = Number.isFinite(+opts.assumedTotal) ? +opts.assumedTotal : 100000;
  const fn = typeof opts.marketAlertsFn === 'function' ? opts.marketAlertsFn : null;
  const hFn = typeof opts.healthFn === 'function' ? opts.healthFn : null;
  // 席位属性序列（#1）与亏钱效应（#2）——同样走注入，保持本模块"不读盘"的纯函数性质。
  const sFn = typeof opts.seatSeriesFn === 'function' ? opts.seatSeriesFn : null;
  const pFn = typeof opts.painFn === 'function' ? opts.painFn : null;
  // 多维市场宽度（#3）——同上走注入（它的原始 K 线不在档案里，须外部提供）。
  const bFn = typeof opts.breadthFn === 'function' ? opts.breadthFn : null;
  const score = last.emotion?.value ?? last.emotion?.score ?? null;
  const market = fn ? fn({ emotionScore: score, total: assumedTotal, marketValue: 0 }) : null;
  // 数据健康报告（#115）：随轻量档一起下发，让"盯盘/巡检"的读者不必拉完整档
  //   也能知道今天的数据能不能用。注意它看的是**近窗口**，不是单日。
  //   注入失败不影响本文件生成——健康报告是附加信息，不能成为管线单点。
  let health = null;
  if (hFn) {
    try { health = hFn(days, { meta: archive?.meta || {} }); } catch { health = null; }
  }
  // 席位属性（#1）：三类资金逐日净买 + 最新一日的主导方。
  //   刻意**不**放进分片：席位明细只最近数日有效，序列本身很短（当前 3 行），
  //   放此处正好让前端一次拿到，不必回看分片。
  let seats = null;
  if (sFn) {
    try { seats = sFn(days); } catch { seats = null; }
  }
  // 亏钱效应（#2）：昨涨停今日表现 / 连板晋级失败 / 大面股。需外部行情，由注入方提供。
  let pain = null;
  if (pFn) {
    try { pain = pFn(days); } catch { pain = null; }
  }
  // 多维市场宽度（#3）：站上均线占比 / 创新高新低 / 破净率 / 涨跌家数 + 逐日序列。
  //   与席位同理刻意不放分片：宽度快照本身很小（~1KB），序列也只有几行。
  let breadth = null;
  if (bFn) {
    try { breadth = bFn(days); } catch { breadth = null; }
  }
  return {
    kind: 'signals-latest',
    version: 1,
    meta: archive?.meta || {},
    signals: archive?.signals || {},
    latest: latestBrief(last),
    // 板块相对强弱（若管线已算出）。没有就是 null，前端显示"未计算"而非 0——
    // 0 与"没算"在相对强弱语境下含义完全相反（0 = 与大盘同步，没算 = 未知）。
    relative: last.summary?.industry_relative || null,
    // 数据健康（#115）。未注入时为 null，前端显示"未评估"而非"正常"。
    health,
    healthNote: hFn
      ? '健康面板只看数据能不能用（新鲜度/补位率/字段覆盖），不参与打分；缺失一律显示"未知"而非 0。'
      : '未生成（调用方未注入 healthReport）',
    // 席位/资金属性（#1）：{ series, summary, verdict }。series 每行一个交易日，
    //   含机构/北向/游资三类净买。无数据的天 net 为 null（不是 0）。
    seats,
    seatsNote: sFn
      ? '席位明细接口仅保留最近若干交易日，故序列从有数据之日起逐日累积；缺失日为 null，不填 0。'
      : '未生成（调用方未注入 seatSeries）',
    // 亏钱效应（#2）：昨涨停今日表现须用**全市场真实行情**算，不可用 hot 列表
    //   （hot 只含上涨股，会静默丢弃下跌的那一半，得出恒为 +10% 的假繁荣）。
    pain,
    painNote: pFn
      ? '昨涨停今日表现基于全市场真实行情（含下跌股），非 hot 涨幅榜口径；样本不足时结论降级为"未知"。'
      : '未生成（调用方未注入 painReport，需实时行情）',
    // 市场宽度（#3）：{ snapshot, series, summary, verdict }。snapshot 为最新一日的
    //   站上均线占比/创新高新低/破净率/涨跌家数；series 为逐日累积（同样"历史自然生长"）。
    breadth,
    breadthNote: bFn
      ? '宽度由全市场真实前复权日K计算（非榜单样本）。破净率依赖 PB 源，不可用时为 null（显示"未计算"）而非 0；'
        + '样本不足时比例同样为 null。占比分母是已扫描样本数，不是全市场总数。'
      : '未生成（调用方未注入 breadthFn，需全市场 K 线）',
    marketAlerts: market,
    marketAlertsNote: fn
      ? `仅大盘层告警，按假设总资产 ${assumedTotal} 元、空仓计算；持仓层告警需本地账户，见 paper_ui.js`
      : '未生成（调用方未注入 marketAlerts）',
  };
}
