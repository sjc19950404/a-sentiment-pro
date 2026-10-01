// 模拟交易引擎（Node ESM + 浏览器共用，纯函数、零依赖）
//
// 设计原则（与 src/lhb.js、src/global.js 同一套纪律）：
//   1. 只有「钱」是假的（初始虚拟资金），其余全部按真实来——
//      价格来自真实行情存档、交易日历来自真实休市安排、交易规则逐条对齐 A 股现行制度。
//   2. 所有规则常量集中在本文件，并在文件内注明依据；不散落到 UI。
//   3. 账本用「分」为单位的整数做累计，避免浮点误差累积（A股最小价格变动 0.01 元）。
//   4. 拒绝下单必须给出可读原因码，UI 只负责翻译——不要把判断写在界面里。
//
// A 股交易规则依据（本文件实现范围）：
//   · T+1：当日买入的股份次一交易日起才可卖出（本文件按「交易日」推进，不做分钟级 T+0）
//   · 申报单位：买入必须为 100 股整数倍；卖出可为零股（余额不足 100 股须一次性全部卖出）
//   · 价格笼子：主板 ±10%、创业板/科创板 ±20%、北交所 ±30%、ST/*ST ±5%、新股上市首日另有规则
//   · 费用：佣金（双边、按成交额，最低 5 元）、过户费（双边 0.001%）、印花税（仅卖出 0.05%）
//   · 资金：买入可用资金须 ≥ 成交额 + 费用；卖出所得当日可用于买入（T+1 只约束股份，不约束资金）
//
// 已知简化（在页面与详情抽屉里显式标注，不藏）：
//   · 不支持融资融券 / 融券做空 / 打新 / 可转债 / 盘后固定价交易
//   · 不做盘中撮合：委托在「下一交易日」按该日真实收盘价成交，因此不模拟集合竞价、盘中撤单。
//     之所以采取 T+1 撮合而非当日成交，是因为本系统的数据是「收盘后生成」的日频存档——
//     用当日收盘价成交等于让人在收盘后以已知价格下单，是可笑的「后视镜作弊」。
//     T+1 撮合消除了这个前视偏差：下单时你只知道今天的价，成交价是明天真实的价。
//   · 涨跌停按「板块默认幅度」判定，不逐票读取当日真实涨跌停价（存档无该字段）；
//     若要精确到分，需数据源提供涨跌停价——这是下一步可增强项
//   · ST 涨跌停幅度只在标的池 build 时按名称判定一次（存档无历史 ST 变更记录）

export const PAPER_VERSION = 'paper-v1';

// ────────────────────────── 一、真实交易制度常量 ──────────────────────────

export const LOT = 100;                    // 买入申报单位（股）
export const MIN_COMMISSION = 5;           // 单笔佣金最低收费（元）
export const COMMISSION_RATE = 0.0003;     // 佣金费率（万三，双边）
export const TRANSFER_FEE_RATE = 0.00001;  // 过户费（万0.1，双边；2022-04-29 起沪深统一）
export const STAMP_TAX_RATE = 0.0005;      // 印花税（万五，仅卖出）
export const DEFAULT_SLIP = 0.0002;        // 滑点（万二，买入抬价/卖出压价，模拟冲击成本）

// 涨跌停幅度（按板块 / 风险警示状态）
export const LIMIT_PCT = {
  main: 0.10,   // 沪深主板 ±10%
  gem: 0.20,    // 创业板 300xxx ±20%
  star: 0.20,   // 科创板 688xxx ±20%
  bj: 0.30,     // 北交所 8xxxxx/4xxxxx/92xxxx ±30%
  st: 0.05,     // ST / *ST ±5%
};

/**
 * 板段判定：只依据代码前缀，与 src/sources.js 的行情抓取前缀函数同一套口径。
 * 返回 { board, label, limitPct, tradable }。
 * 不纳入交易的范围（明确标注，而不是笼统归为「未知」）：
 *   · 可转债 11xxxx(沪)/12xxxx(深) —— T+0、无涨跌停、有强赎/回售，规则与股票完全不同
 *   · B 股 900xxx(沪)/200xxx(深) —— 以外币计价结算
 *   · 基金/ETF 15xxxx/16xxxx/51xxxx/58xxxx —— 无印花税、最小变动不同
 */
export function boardOf(code) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return { board: 'unknown', label: '未知', limitPct: null, tradable: false };
  // 可转债 / 可交换债
  if (/^(11|12)/.test(c)) return { board: 'cb', label: '可转债（暂不支持）', limitPct: null, tradable: false };
  // 基金 / ETF
  if (/^(15|16|50|51|52|56|58)/.test(c)) return { board: 'fund', label: '基金/ETF（暂不支持）', limitPct: null, tradable: false };
  // 北交所：8xxxxx（82/83/87/88 等）、4xxxxx（新三板转板前）、92xxxx
  if (/^(92|4[0-9]|8[0-9])/.test(c)) return { board: 'bj', label: '北交所', limitPct: LIMIT_PCT.bj, tradable: true };
  // 科创板 688 / 689
  if (/^68[89]/.test(c)) return { board: 'star', label: '科创板', limitPct: LIMIT_PCT.star, tradable: true };
  // 创业板 300 / 301
  if (/^30[01]/.test(c)) return { board: 'gem', label: '创业板', limitPct: LIMIT_PCT.gem, tradable: true };
  // 沪市主板 600/601/603/605；深市主板 000/001/002/003
  if (/^(60[0135])/.test(c)) return { board: 'shb', label: '沪市主板', limitPct: LIMIT_PCT.main, tradable: true };
  if (/^(00[0123])/.test(c)) return { board: 'szb', label: '深市主板', limitPct: LIMIT_PCT.main, tradable: true };
  // B 股：沪 900xxx / 深 200xxx —— 计价与结算规则不同（外币），模拟器不纳入
  if (/^(900|200)/.test(c)) return { board: 'b', label: 'B股（暂不支持）', limitPct: null, tradable: false };
  return { board: 'unknown', label: '未知板段（暂不支持）', limitPct: null, tradable: false };
}

/**
 * 名称是否风险警示（ST / *ST / SST / S*ST），决定 ±5% 幅度。
 * 注意不能加 i 标志：加了之后 "STAR科技" 这类正常公司名会被误判成 ST，
 * 幅度从 ±10% 错成 ±5%，涨跌停判定全错。故只用大写的 ST/SST，
 * 且要求 ST 后面紧跟非字母（中文/空格/数字）或结束。
 */
export const isStName = (name) => /^(\*ST|S\*?ST|ST)(?![A-Za-z])/.test(String(name || '').trim());

/** 当日涨跌停幅度：先看 ST（优先级最高），再看板段 */
export function limitPctOf(code, name) {
  if (isStName(name)) return LIMIT_PCT.st;
  const b = boardOf(code);
  return b.limitPct;
}

/**
 * 上涨/下跌停板？以「当日涨跌幅」近似判定。
 * 存档只有 change_pct（无涨跌停价），故按 |change_pct| ≥ 幅度 - 容差 视为触板。
 * 容差 0.5pp：真实涨停价按分位四舍五入，涨幅常为 9.97%~10.03% 而非精确 10。
 */
export function isLimitHit(changePct, code, name, tol = 0.5) {
  const lim = limitPctOf(code, name);
  if (lim == null || changePct == null || !Number.isFinite(+changePct)) return null;
  const p = Math.abs(+changePct);
  if (p >= lim * 100 - tol) return +changePct > 0 ? 'up' : 'down';
  return null;
}

// ────────────────────────── 二、费用（真实计价） ──────────────────────────

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * 单笔费用明细。买入：佣金+过户费；卖出：佣金+过户费+印花税。
 * 佣金按「不足 5 元按 5 元」收取——小额交易的实际成本率因此远高于万三，这是真实制度。
 */
export function fees(gross, side) {
  const comm = Math.max(MIN_COMMISSION, round2(gross * COMMISSION_RATE));
  const transfer = round2(gross * TRANSFER_FEE_RATE);
  const stamp = side === 'sell' ? round2(gross * STAMP_TAX_RATE) : 0;
  return { comm, transfer, stamp, total: round2(comm + transfer + stamp) };
}

/**
 * 含滑点的成交价（买方抬价 / 卖方压价），按分取整到最小价格变动。
 *
 * 关键：滑点必须「方向不丢」。低价股（如 2.76 元）万二滑点只有 0.00055 元，
 * 四舍五入到分就归零了——那等于低价股免滑点，与真实体验相反（低价股冲击成本占比更高）。
 * 因此：四舍五入后如果方向没有被体现，就按最小变动 0.01 元朝不利方向走一格。
 * 这是「宁可高估成本也不低估」的保守取法。
 */
export function fillPrice(price, side, slip = DEFAULT_SLIP) {
  const p = +price;
  if (!Number.isFinite(p) || p <= 0) return 0;
  const adj = side === 'buy' ? p * (1 + slip) : p * (1 - slip);
  let out = round2(adj);
  if (side === 'buy' && out <= p) out = round2(p + 0.01);
  if (side === 'sell' && out >= p) out = round2(p - 0.01);
  return Math.max(0.01, out);   // 卖出不能压到 0 以下
}

// ────────────────────────── 三、账本（以「分」累计，避免浮点漂移） ──────────────────────────

const toCents = (yuan) => Math.round(yuan * 100);
const toYuan = (cents) => cents / 100;

/**
 * 建仓记账（加权平均成本法，A股实务口径）。
 * 成本里含费用——否则「卖出价 = 买入价」会被读成不亏，与真实体验不符。
 */
export function applyBuy(pos, { qty, price, fee }) {
  const grossCents = toCents(price) * qty;
  const feeCents = toCents(fee);
  const totalCents = grossCents + feeCents;
  const newQty = pos.qty + qty;
  const newCostCents = toCents(pos.cost) + totalCents;
  return {
    qty: newQty,
    cost: toYuan(newCostCents),                       // 累计买入总成本（含费）
    avgCost: newQty > 0 ? toYuan(newCostCents / newQty) : 0,
    grossBuyCents: toCents(pos.grossBuy || 0) + grossCents,
    feeCents: toCents(pos.fee || 0) + feeCents,
    // 可卖数量属于「时点状态」，由 settleFreeze() 按持仓日推进，不在这里改
  };
}

/**
 * 卖出记账：按加权平均成本结转已实现盈亏。
 * 已实现盈亏 = 卖出净收入 − 卖出股份对应的成本（含买入时摊到的费用）。
 */
export function applySell(pos, { qty, price, fee }) {
  const avgCost = pos.avgCost || 0;
  const grossCents = toCents(price) * qty;
  const feeCents = toCents(fee);
  const netCents = grossCents - feeCents;
  // 成本结转必须按「持仓总成本 × 卖出比例」，不能写成 round(avgCost*100)*qty——
  // avgCost 是含费用的均价，天然带分摊不尽的零头（如 10.0053），一取整到分就会
  // 每 1000 股凭空多算/少算几元，且清仓时 cost 余额与已实现盈亏对不上。
  // 按比例切分保证：部分卖出后剩余成本 + 本次结转成本 = 原总成本（无零头丢失）。
  const costCents = toCents(pos.cost || 0);
  const costOutCents = pos.qty > 0
    ? (qty === pos.qty ? costCents : Math.round(costCents * qty / pos.qty))
    : 0;
  const realized = toYuan(netCents - costOutCents);
  const newQty = pos.qty - qty;
  const newCostCents = Math.max(0, costCents - costOutCents);
  return {
    qty: newQty,
    cost: newQty > 0 ? toYuan(newCostCents) : 0,
    avgCost: newQty > 0 ? toYuan(newCostCents / newQty) : 0,
    realized,
    feeCents: toCents(pos.fee || 0) + feeCents,
  };
}

// ────────────────────────── 四、账户 ──────────────────────────

export function emptyAccount(cash = 1000000, startDate = null) {
  return {
    version: PAPER_VERSION,
    initCash: cash,          // 虚拟本金（唯一「假」的东西）
    cash,                    // 可用资金
    freeze: 0,               // 冻结资金（买入挂单待成交时冻结，成交/失效后释放）
    positions: {},           // code → { code, name, qty, avail, avgCost, cost, last, openDate, days }
    orders: [],              // 全部委托（含被拒、含待成交）
    trades: [],              // 全部成交
    pending: [],             // 待成交委托（T+1 撮合队列）
    realized: 0,             // 累计已实现盈亏
    totalFee: 0,             // 累计费用
    startDate,
    lastSettle: null,        // 最近一次结算的交易日
    nav: [],                 // [{date, equity, cash, marketValue}] 每日净值（绩效与曲线用）
    note: '初始资金为虚拟资金；价格、交易日历、交易规则均取自真实数据与 A 股现行制度。',
  };
}

/** 账户静态快照（不依赖行情）：现金、已实现、总费用 */
export function accountStats(acct) {
  const positions = Object.values(acct.positions || {});
  const marketValue = positions.reduce((a, p) => a + (p.last != null ? p.last * p.qty : p.avgCost * p.qty), 0);
  const costValue = positions.reduce((a, p) => a + (p.cost || 0), 0);
  const total = acct.cash + (acct.freeze || 0) + marketValue;
  return {
    cash: acct.cash,
    freeze: acct.freeze || 0,
    marketValue,
    costValue,
    floatPnl: marketValue - costValue,
    floatPnlPct: costValue > 0 ? (marketValue - costValue) / costValue : 0,
    realized: acct.realized || 0,
    totalFee: acct.totalFee || 0,
    total,
    initCash: acct.initCash,
    ret: acct.initCash > 0 ? (total - acct.initCash) / acct.initCash : 0,
    retPct: acct.initCash > 0 ? ((total - acct.initCash) / acct.initCash) * 100 : 0,
    posCount: positions.length,
  };
}

// ────────────────────────── 五、下单校验（唯一判据来源） ──────────────────────────

export const REJECT = {
  BAD_CODE: '代码非法',
  NOT_TRADABLE: '该代码不在模拟器可交易范围（B股/未知板段）',
  NO_QUOTE: '当日无真实行情，无法预估资金占用',
  BAD_QTY: '数量非法',
  LOT: `买入数量须为 ${LOT} 股整数倍`,
  ODD_SELL: '卖出零股时须一次性卖出全部持仓',
  NO_POSITION: '无该股持仓',
  OVER_AVAIL: '超过可卖数量（T+1：当日买入次一交易日才可卖）',
  NO_CASH: '可用资金不足（按今收价 + 费用预冻结）',
  PENDING_SAME: '该股已有待成交委托，请先撤单',
};

/**
 * 校验一笔委托。返回 { ok, reason, detail, price, gross, fee, need }。
 *
 * 资金/股份按「下单日收盘价」预冻结——真实券商就是这样：委托提交时冻结，成交时按实际价结算。
 * 次日实际成交价可能更高，届时资金不足则委托被撤（见 settleDay）。
 */
export function validateOrder(acct, order, quote) {
  const { code, side, qty } = order;
  const b = boardOf(code);
  if (!/^\d{6}$/.test(String(code || ''))) return reject(REJECT.BAD_CODE, `代码 ${code}`);
  if (!b.tradable) return reject(REJECT.NOT_TRADABLE, b.label);
  if (!Number.isInteger(qty) || qty <= 0) return reject(REJECT.BAD_QTY, `数量 ${qty}`);
  if (!quote || quote.price == null || !Number.isFinite(+quote.price) || +quote.price <= 0) {
    return reject(REJECT.NO_QUOTE, quote?.reason || '存档无该股收盘价');
  }
  const dup = (acct.pending || []).find((p) => p.code === code);
  if (dup) return reject(REJECT.PENDING_SAME, `已有 ${dup.side === 'buy' ? '买入' : '卖出'} ${dup.qty} 股待成交`);

  if (side === 'buy') {
    if (qty % LOT !== 0) return reject(REJECT.LOT, `${qty} 股`);
    const px = fillPrice(+quote.price, 'buy', order.slip ?? DEFAULT_SLIP);
    const gross = round2(px * qty);
    const fee = fees(gross, 'buy').total;
    const need = round2(gross + fee);
    if (acct.cash + 1e-9 < need) {
      return reject(REJECT.NO_CASH, `需冻结 ${need.toFixed(2)} 元，可用 ${acct.cash.toFixed(2)} 元`);
    }
    return { ok: true, price: px, gross, fee, need };
  }

  // 卖出
  const pos = acct.positions[code];
  if (!pos || pos.qty <= 0) return reject(REJECT.NO_POSITION, code);
  const frozen = (acct.pending || []).filter((p) => p.code === code && p.side === 'sell').reduce((a, p) => a + p.qty, 0);
  const freeAvail = Math.max(0, (pos.avail || 0) - frozen);
  if (qty > freeAvail) {
    return reject(REJECT.OVER_AVAIL, `可卖 ${freeAvail} 股 / 持仓 ${pos.qty} 股（当日买入 ${pos.qty - (pos.avail || 0)} 股）`);
  }
  if (qty % LOT !== 0 && qty !== pos.qty) return reject(REJECT.ODD_SELL, `零股卖出仅限一次性清仓（${pos.qty} 股）`);
  if (qty > pos.qty) return reject(REJECT.BAD_QTY, `卖出 ${qty} > 持仓 ${pos.qty}`);
  const px = fillPrice(+quote.price, 'sell', order.slip ?? DEFAULT_SLIP);
  const gross = round2(px * qty);
  const fee = fees(gross, 'sell').total;
  return { ok: true, price: px, gross, fee, need: 0 };
}

function reject(reason, detail) {
  return { ok: false, reason, detail: detail || '' };
}

// ────────────────────────── 六、委托挂单（T+1 撮合，消除前视偏差） ──────────────────────────

/**
 * 提交委托 → 进入待成交队列（不立即成交）。
 * 买入预冻结资金（按今收价 + 费用）、卖出预冻结股份（券商的真实行为）。
 * 返回 { next, order }；被拒单直接写入 orders（status='rejected'），不占用冻结。
 */
export function submitOrder(acct, order, quote, ctx = {}) {
  const date = ctx.date || acct.lastSettle || null;
  const v = validateOrder(acct, order, quote);
  const id = (acct.orders?.length || 0) + 1;
  const base = {
    id, submitDate: date, code: order.code, name: quote?.name || '',
    side: order.side, qty: order.qty, reason: order.reason || '手动下单',
    submitPrice: quote?.price != null ? +quote.price : null,
  };
  if (!v.ok) {
    const rec = { ...base, status: 'rejected', reject: v.reason, detail: v.detail };
    return { next: { ...acct, orders: [...acct.orders, rec] }, order: rec };
  }
  const rec = {
    ...base, status: 'pending',
    estPrice: v.price, estFee: v.fee, estGross: v.gross, need: v.need,
    slip: order.slip ?? DEFAULT_SLIP,
  };
  return {
    next: {
      ...acct,
      freeze: toYuan(toCents(acct.freeze || 0) + toCents(v.need)),
      cash: order.side === 'buy' ? toYuan(toCents(acct.cash) - toCents(v.need)) : acct.cash,
      pending: [...(acct.pending || []), rec],
      orders: [...acct.orders, rec],
    },
    order: rec,
  };
}

/** 撤单：释放冻结资金，委托状态改为 cancelled（保留在 orders 里可追溯） */
export function cancelOrder(acct, id) {
  const p = (acct.pending || []).find((x) => x.id === id);
  if (!p) return { next: acct, ok: false, error: '该委托不在待成交队列' };
  const rec = { ...p, status: 'cancelled', cancelDate: acct.lastSettle || null };
  return {
    ok: true,
    next: {
      ...acct,
      cash: toYuan(toCents(acct.cash) + toCents(p.need || 0)),
      freeze: toYuan(Math.max(0, toCents(acct.freeze || 0) - toCents(p.need || 0))),
      pending: acct.pending.filter((x) => x.id !== id),
      orders: acct.orders.map((o) => (o.id === id ? rec : o)),
    },
  };
}

// ────────────────────────── 七、逐日结算（撮合 + T+1 解冻 + 净值） ──────────────────────────

/**
 * 用「某交易日的真实行情」推进一天，按顺序做四件事：
 *   1. 撮合待成交委托：按该日真实收盘价成交（涨停买不进 / 跌停卖不掉 / 资金不足则委托失效）
 *   2. T+1 解冻：把 avail 补到 qty
 *   3. 逐票更新最新价（浮动盈亏）——取不到行情的票沿用上一价并标注 pxStale
 *   4. 记录当日净值（现金 + 市值），供绩效与曲线使用
 *
 * 关键：第 1 步用的是「今天」的真实成交价，而委托是「昨天」下的——这是本模拟器唯一的
 * 防作弊机制。用户永远无法用一个已经知道的价格下单。
 */
export function settleDay(acct, date, quotes = {}, opts = {}) {
  const log = [];
  let cur = acct;
  // 已处理的委托 id：撮合是「一次性」的——今天成交/失效的单必须从 pending 里摘掉，
  // 否则它会在后续每个交易日重复成交（同一张委托撮合出无数笔成交，账本彻底失真）。
  const settledIds = new Set();
  // 每条分支都会 push 进这里，函数末尾统一从 pending 中剔除
  const markDone = (id) => settledIds.add(id);

  for (const p of cur.pending || []) {
    const q = quotes[p.code];
    if (!q || q.price == null || !Number.isFinite(+q.price)) {
      log.push({ id: p.id, code: p.code, name: p.name, side: p.side, qty: p.qty, status: 'expired', reason: REJECT.NO_QUOTE, detail: `${date} 无该股真实行情，委托失效并释放冻结` });
      cur = { ...cur, cash: toYuan(toCents(cur.cash) + toCents(p.need || 0)), freeze: toYuan(Math.max(0, toCents(cur.freeze || 0) - toCents(p.need || 0))), orders: cur.orders.map((o) => (o.id === p.id ? { ...o, status: 'expired', settleDate: date, reject: REJECT.NO_QUOTE, detail: '该交易日无真实行情' } : o)) };
      markDone(p.id);
      continue;
    }
    const name = q.name || p.name || '';
    const hit = isLimitHit(q.changePct, p.code, name);

    // 跌停卖不掉 / 涨停买不进——按「该日」的实际情况判定，而非下单日
    if (p.side === 'buy' && hit === 'up') {
      log.push({ ...pick(p), status: 'expired', reason: '涨停价无法买入', detail: `${date} ${q.changePct}% 一字/触板涨停，无卖盘，委托失效` });
      cur = releaseFreeze(cur, p, { status: 'expired', settleDate: date, reject: '涨停价无法买入', detail: `${date} 触及涨停，无卖盘` });
      markDone(p.id);
      continue;
    }
    if (p.side === 'sell' && hit === 'down') {
      log.push({ ...pick(p), status: 'expired', reason: '跌停价无法卖出', detail: `${date} ${q.changePct}% 触及跌停，无买盘，委托失效` });
      cur = { ...cur, orders: cur.orders.map((o) => (o.id === p.id ? { ...o, status: 'expired', settleDate: date, reject: '跌停价无法卖出', detail: `${date} 触及跌停，无买盘` } : o)) };
      markDone(p.id);
      continue;
    }

    const px = fillPrice(+q.price, p.side, p.slip ?? DEFAULT_SLIP);
    const gross = round2(px * p.qty);
    const fee = fees(gross, p.side).total;
    const need = p.side === 'buy' ? round2(gross + fee) : 0;

    if (p.side === 'buy') {
      // 释放本单冻结后，按实际成交价重算：真实价可能比预估价高，届时资金不足 → 委托失效
      const cashBack = toCents(cur.cash) + toCents(p.need || 0);
      const freezeAfter = Math.max(0, toCents(cur.freeze || 0) - toCents(p.need || 0));
      if (cashBack + 1e-9 < toCents(need)) {
        log.push({ ...pick(p), status: 'expired', reason: REJECT.NO_CASH, detail: `${date} 实际成交价 ${px} 元需 ${need.toFixed(2)} 元，冻结 ${(p.need || 0).toFixed(2)} 元不足` });
        cur = { ...cur, cash: toYuan(cashBack), freeze: toYuan(freezeAfter), orders: cur.orders.map((o) => (o.id === p.id ? { ...o, status: 'expired', settleDate: date, reject: REJECT.NO_CASH, detail: `实际成交价 ${px} 元，资金不足` } : o)) };
        markDone(p.id);
        continue;
      }
      const pos = cur.positions[p.code] || { code: p.code, name, qty: 0, avail: 0, avgCost: 0, cost: 0, grossBuy: 0, fee: 0, openDate: date, days: 0, lastBuyDate: null };
      const applied = applyBuy(pos, { qty: p.qty, price: px, fee });
      const newPos = { ...pos, ...applied, name, avail: pos.avail || 0, openDate: pos.openDate || date, lastBuyDate: date, last: +q.price, lastDate: date, pxStale: false };
      cur = {
        ...cur,
        cash: toYuan(cashBack - toCents(need)),
        freeze: toYuan(freezeAfter),
        positions: { ...cur.positions, [p.code]: newPos },
        totalFee: toYuan(toCents(cur.totalFee || 0) + toCents(fee)),
        orders: cur.orders.map((o) => (o.id === p.id ? fillRec(o, { date, px, gross, fee }) : o)),
        trades: [...cur.trades, tradeRec(p, { date, px, gross, fee, name })],
      };
      log.push({ ...pick(p), status: 'filled', price: px, gross, fee });
      markDone(p.id);
    } else {
      const pos = cur.positions[p.code];
      if (!pos) {
        log.push({ ...pick(p), status: 'expired', reason: REJECT.NO_POSITION, detail: `${date} 已无持仓` });
        cur = { ...cur, orders: cur.orders.map((o) => (o.id === p.id ? { ...o, status: 'expired', settleDate: date, reject: REJECT.NO_POSITION } : o)) };
        markDone(p.id);
        continue;
      }
      const applied = applySell(pos, { qty: p.qty, price: px, fee });
      const positions = { ...cur.positions };
      if (applied.qty === 0) delete positions[p.code];
      else positions[p.code] = { ...pos, ...applied, avail: Math.max(0, (pos.avail || 0) - p.qty), last: +q.price, lastDate: date, pxStale: false };
      cur = {
        ...cur,
        cash: toYuan(toCents(cur.cash) + toCents(gross) - toCents(fee)),
        realized: toYuan(toCents(cur.realized || 0) + toCents(applied.realized)),
        totalFee: toYuan(toCents(cur.totalFee || 0) + toCents(fee)),
        positions,
        orders: cur.orders.map((o) => (o.id === p.id ? fillRec(o, { date, px, gross, fee }) : o)),
        trades: [...cur.trades, tradeRec(p, { date, px, gross, fee, name })],
      };
      log.push({ ...pick(p), status: 'filled', price: px, gross, fee, realized: applied.realized });
      markDone(p.id);
    }
  }

  // 从待成交队列剔除本轮已处理的委托（成交 / 失效 / 资金不足），并同步回 cur
  cur = { ...cur, pending: (cur.pending || []).filter((x) => !settledIds.has(x.id)) };

  // ② T+1 解冻 + ③ 更新最新价（对撮合后的持仓统一做一遍，避免新买入的票漏掉）
  //
  // T+1 的判据必须是「明确的成交日」，不能用 lastDate（那是「最近一次有行情的日」——
  // 一个票连着几天都有行情时 lastDate 会天天等于当天，导致永远不解冻）。
  // 所以持仓上单独记 lastBuyDate：只有 lastBuyDate !== 今天 的票，才把 avail 解冻为 qty。
  const positions = {};
  const missing = [];
  for (const [code, p] of Object.entries(cur.positions || {})) {
    const q = quotes[code];
    const px = q && q.price != null && Number.isFinite(+q.price) ? +q.price : null;
    if (px == null) missing.push(code);
    const boughtToday = p.lastBuyDate === date;       // 今天买入 → 今天不可卖
    positions[code] = {
      ...p,
      last: px != null ? px : p.last,
      lastDate: px != null ? date : p.lastDate,
      pxStale: px == null,
      avail: boughtToday ? (p.avail || 0) : p.qty,
      days: (p.days || 0) + 1,
    };
  }

  const next0 = { ...cur, positions, lastSettle: date };
  const stats = accountStats(next0);
  const navRow = { date, equity: round2(stats.total), cash: round2(stats.cash + stats.freeze), marketValue: round2(stats.marketValue) };
  const nav = [...(acct.nav || [])];
  if (!nav.some((r) => r.date === date)) nav.push(navRow);

  return {
    account: { ...next0, nav },
    fills: log.filter((x) => x.status === 'filled'),
    expired: log.filter((x) => x.status !== 'filled'),
    missing,
    ...navRow,
  };
}

function pick(p) {
  return { id: p.id, code: p.code, name: p.name, side: p.side, qty: p.qty };
}
function releaseFreeze(acct, p, patch) {
  return {
    ...acct,
    cash: toYuan(toCents(acct.cash) + toCents(p.need || 0)),
    freeze: toYuan(Math.max(0, toCents(acct.freeze || 0) - toCents(p.need || 0))),
    orders: acct.orders.map((o) => (o.id === p.id ? { ...o, ...patch } : o)),
  };
}
function fillRec(o, { date, px, gross, fee }) {
  return { ...o, status: 'filled', settleDate: date, fillPrice: px, gross, fee, amount: o.side === 'buy' ? round2(gross + fee) : round2(gross - fee) };
}
function tradeRec(p, { date, px, gross, fee, name }) {
  return {
    id: p.id, code: p.code, name, side: p.side, qty: p.qty,
    submitDate: p.submitDate, fillDate: date, submitPrice: p.submitPrice, price: px,
    gross, fee, net: p.side === 'buy' ? round2(gross + fee) : round2(gross - fee),
    reason: p.reason || '手动下单',
    // 委托价 → 成交价的漂移：T+1 撮合的必然结果，如实展示（真实交易也是这个体验）
    driftPct: p.submitPrice ? +(((px - p.submitPrice) / p.submitPrice) * 100).toFixed(2) : null,
  };
}

// ────────────────────────── 八、绩效（对齐 src/backtest.js 口径） ──────────────────────────

export const ANN = 252;

/**
 * 由「每日净值序列」算绩效，指标定义与 src/backtest.js 的 metrics() 完全一致，
 * 这样模拟账户的夏普/回撤与策略回测可以放在同一张表里比较。
 */
export function paperMetrics(nav) {
  const n = nav.length;
  if (!n) return null;
  const rets = [];
  for (let i = 1; i < n; i++) rets.push(nav[i] / nav[i - 1] - 1);
  const total = nav[n - 1] / nav[0] - 1;
  const annual = n > 1 ? (1 + total) ** (ANN / (n - 1)) - 1 : 0;
  let peak = nav[0], maxDd = 0;
  for (const v of nav) { peak = Math.max(peak, v); maxDd = Math.max(maxDd, 1 - v / peak); }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) : 0;
  const sharpe = sd > 1e-12 ? (mean / sd) * Math.sqrt(ANN) : 0;
  const winDays = rets.filter((r) => r > 0).length;
  return {
    days: n, total, annual, maxDd, sharpe,
    winRate: rets.length ? winDays / rets.length : 0,
    ddPct: maxDd * 100,
  };
}

// ────────────────────────── 九、导出 / 导入（可核验的存档） ──────────────────────────

export function exportAccount(acct) {
  return JSON.stringify({
    version: PAPER_VERSION,
    exportedAt: new Date().toISOString(),
    initCash: acct.initCash,
    cash: acct.cash,
    freeze: acct.freeze || 0,
    realized: acct.realized,
    totalFee: acct.totalFee,
    positions: acct.positions,
    pending: acct.pending || [],
    orders: acct.orders,
    trades: acct.trades,
    nav: acct.nav || [],
    startDate: acct.startDate,
    lastSettle: acct.lastSettle,
  }, null, 2);
}

/** 导入时严格校验：宁可拒绝，也不要把来路不明的账本灌进界面 */
export function importAccount(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return { ok: false, error: '不是合法 JSON：' + e.message }; }
  if (!d || typeof d !== 'object') return { ok: false, error: '顶层不是对象' };
  if (d.version !== PAPER_VERSION) return { ok: false, error: `版本不匹配（文件 ${d.version || '无'} / 当前 ${PAPER_VERSION}）` };
  if (!Number.isFinite(+d.cash) || +d.cash < 0) return { ok: false, error: 'cash 非法' };
  if (!Number.isFinite(+d.initCash) || +d.initCash <= 0) return { ok: false, error: 'initCash 非法' };
  const positions = d.positions && typeof d.positions === 'object' ? d.positions : {};
  for (const [code, p] of Object.entries(positions)) {
    if (!Number.isInteger(p.qty) || p.qty <= 0) return { ok: false, error: `持仓 ${code} 数量非法` };
    if (!Number.isFinite(+p.avgCost) || +p.avgCost < 0) return { ok: false, error: `持仓 ${code} 成本非法` };
    if (!Number.isInteger(p.avail) || p.avail < 0 || p.avail > p.qty) return { ok: false, error: `持仓 ${code} 可卖数量非法` };
  }
  const pending = Array.isArray(d.pending) ? d.pending : [];
  for (const p of pending) {
    if (!Number.isInteger(p.qty) || p.qty <= 0) return { ok: false, error: `待成交委托 ${p.id} 数量非法` };
    if (p.side !== 'buy' && p.side !== 'sell') return { ok: false, error: `待成交委托 ${p.id} 方向非法` };
  }
  const nav = Array.isArray(d.nav) ? d.nav.filter((r) => r && typeof r.date === 'string' && Number.isFinite(+r.equity)) : [];
  return {
    ok: true,
    account: {
      ...emptyAccount(+d.initCash, d.startDate || null),
      cash: +d.cash,
      freeze: +d.freeze || 0,
      realized: +d.realized || 0,
      totalFee: +d.totalFee || 0,
      positions,
      pending,
      orders: Array.isArray(d.orders) ? d.orders : [],
      trades: Array.isArray(d.trades) ? d.trades : [],
      nav,
      lastSettle: d.lastSettle || null,
    },
  };
}

// ────────────────────────── 十、行情适配 ──────────────────────────

/**
 * 把存档一天的数据转成「可成交行情表」：code → { price, name, changePct, src }。
 * 只使用真实收盘价（hot.close / lhb.close），缺价一律不进表——缺失就是缺失，
 * 绝不填 0（0 在行情里是真实价格，会把「没数据」伪装成「跌到 0」）。
 * 同一票同时出现在热点榜与龙虎榜时，用龙虎榜的（其 close 更权威：交易所口径）。
 */
export function quotesFromDay(day) {
  const out = {};
  for (const h of day?.hot || []) {
    if (h?.code && h.close != null && Number.isFinite(+h.close)) {
      out[h.code] = { code: h.code, name: h.name || '', price: +h.close, changePct: h.change_pct ?? null, huanshou: h.huanshou ?? null, src: 'hot' };
    }
  }
  for (const l of day?.lhb || []) {
    if (l?.code && l.close != null && Number.isFinite(+l.close)) {
      out[l.code] = { code: l.code, name: l.name || '', price: +l.close, changePct: l.change_pct ?? null, reason: l.reason || '', src: 'lhb' };
    }
  }
  return out;
}
