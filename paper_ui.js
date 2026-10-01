// 模拟交易台前端（ESM，浏览器直接加载，无构建步骤）
//
// 与 app.js 的分工：
//   · app.js 继续负责「只读展示」（情绪/回测/报告/外围），不碰账户状态
//   · 本文件负责「有状态交互」（账户、下单、结算），并把交易规则判断全部委托给 src/paper.js
// 这样做的原因：交易规则一旦在 UI 里再写一遍，就会和引擎漂移——模拟器的价值恰恰是
// 「规则和真实一致」，所以规则只能有一个出处。
//
// 持久化：localStorage（单机、无后端）。key 带版本号，升级引擎时旧账本不会被误读。

import {
  emptyAccount, submitOrder, cancelOrder, settleDay, accountStats, paperMetrics,
  exportAccount, importAccount, fees, fillPrice, boardOf, limitPctOf, isStName,
  validateOrder, quotesFromDay, PAPER_VERSION, LOT, MIN_COMMISSION,
  COMMISSION_RATE, STAMP_TAX_RATE, TRANSFER_FEE_RATE, DEFAULT_SLIP, REJECT,
  LIMIT_PCT, isLimitHit, POS_TIERS, CUT_TIERS, qtyByAssetPct, qtyByHoldPct,
} from './src/paper.js';
// 实时行情（腾讯 qt.gtimg.cn，CORS 为 * → 浏览器可直连）。
// 为什么必须引入：存档是「收盘后生成的日频数据」，只含当日上榜/热点约 100 只票，
// 池子里其余 1200+ 只票取不到价，界面只能提示「无真实行情，不可下单」。
// 要按实时真实价格买卖，就必须有一个能查全市场任意 A 股当前价的来源。
import { fetchQuotes, priceKind, inTradingSession, normalizeCodes } from './src/quote.js';
// 研判推荐引擎（把市场研判结论落到具体个股）。
// 规则同样只有一个出处：src/picks.js。本文件只负责渲染、以及把用户点击转成下单区输入。
import { recommendPicks, PICK_TOP_N, SCORE_WEIGHTS } from './src/picks.js';
// 双层预警引擎（大盘层档位偏离 + 持仓层止损/集中度/T+1）。
// 与 picks.js 同纪律：规则只有一个出处（src/alerts.js），UI 只渲染 + 把动作转成下单区输入。
import { buildAlerts, MARKET_CFG, POS_CFG, LEVELS } from './src/alerts.js';
// 预警台账与收益归因——回答「预警到底有没有帮我少亏、多赚」。
// 同样只有一个出处（src/alert_log.js）：UI 只负责把当前预警喂进台账、把归因结果画出来。
import { appendSignals, summarizeLog, summarizeText, LOG_CAP } from './src/alert_log.js';
// 模拟交易复盘引擎——回答「这笔交易为什么赚、为什么亏」。
// 研判报告（app.js）里新增的「⑦ 模拟交易复盘」段落读的就是它。此处只在每次账户变化后
// 把「账户 + 台账 + 实时价快照 + 情绪分」挂到 window.__paperSnapshot，报告端据此生成段落。
// 为什么用 window 桥接而不是让 app.js import：app.js 是经典脚本（不能用 import），
// paper_ui.js 是 module，两者没有共享状态。挂一个带版本号的快照是最小的耦合面。
import { REVIEW_VERSION } from './src/paper_review.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 2) => (v == null || !Number.isFinite(+v)) ? '—'
  : (+v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
const yi = (v) => (v == null || !Number.isFinite(+v)) ? '—' : (v / 1e4).toFixed(2);
const pct = (v, d = 2) => (v == null || !Number.isFinite(+v)) ? '—' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`;
// 涨跌配色沿用中文语境：涨=红、跌=绿
const cls = (v) => (v == null || !Number.isFinite(+v)) ? 'muted' : (v > 0 ? 'hl' : v < 0 ? 'hl-dn' : 'muted');

const LS_KEY = 'paper-acct-' + PAPER_VERSION;
// 预警台账 key **不带** PAPER_VERSION：台账记的是「当时预警说了什么、后来价格怎么走」，
// 这是历史事实，不随交易引擎版本升级而失效。带版本号会导致升级后战绩被清空，
// 而那恰恰是最该保留的东西（用户要拿它判断「这套预警值不值得继续听」）。
const AL_KEY = 'paper-alerts-log';
const INIT_CASH = 1000000;
const SLIP = DEFAULT_SLIP;

let ACCT = null;          // 当前账户
let UNI = null;           // 标的池（仅作「参考/快速选择」，不再是可下单的白名单）
let UNI_META = {};
let QMAP = {};            // 存档当日行情 code → quote（降级用）
let LIVEQ = {};           // 实时行情 code → quote（腾讯源，优先）
let LIVE_AT = null;       // 最近一次实时抓取时刻
let LIVE_FAIL = [];       // 最近一次抓取失败的代码
let LIVE_BUSY = false;    // 抓取中（防重复请求）
let LAST_DATE = null;     // 存档最新交易日
let ARC_DAYS = [];        // 存档全部交易日（研判推荐用：取最后一天算推荐，取序列算情绪分）
let ORDER = { side: 'buy', code: '', qty: 0 };
let HIST = { view: 'trade' };
// 预警台账（持久化，跨会话累积）。不放进 ACCT —— 它不是账户状态，导出账本时也不该混进去。
let ALOG = [];

// ────────────────────────── 持久化 ──────────────────────────

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ACCT));
  } catch (e) {
    msg('保存失败：' + e.message + '（浏览器存储不可用或已满）', 'err');
  }
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const r = importAccount(raw);
    if (!r.ok) {
      msg('本地账本无法读取（' + r.error + '），已重新开始', 'err');
      return null;
    }
    return r.account;
  } catch (e) {
    return null;
  }
}

/** 导入后必须写入 localStorage 的格式与导出格式不同（导出是带元信息的可读文件） */
function persistRaw(acct) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...acct, version: PAPER_VERSION })); } catch (e) { /* 静默 */ }
}

// ── 预警台账持久化 ──
//
// 为什么不放在 ACCT 里：① 台账不是「账户状态」，导出账本时混进去会让导入方多一份无关数据；
// ② 账户可以随时重置（一键清空），但**预警战绩不该跟着清零**——它衡量的正是规则本身。
// 读取时逐条做形状校验：任何一条不合规就整条丢弃（不是整份丢弃）——台账是累积记录，
// 一条脏数据不应该毁掉其余全部历史。

/** 台账条目形状校验（与 src/alert_log.js 的落账字段一一对应） */
function validLogEntry(e) {
  return !!e && typeof e === 'object'
    && typeof e.key === 'string' && e.key
    && (e.layer === 'market' || e.layer === 'position')
    && typeof e.type === 'string' && e.type
    && typeof e.action === 'string' && e.action
    && (e.layer === 'market' || Number.isFinite(+e.px));
}

function loadAlertLog() {
  try {
    const raw = localStorage.getItem(AL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(validLogEntry).slice(-LOG_CAP);
  } catch (e) {
    return [];
  }
}

function saveAlertLog() {
  try {
    localStorage.setItem(AL_KEY, JSON.stringify(ALOG));
  } catch (e) {
    // 存储不可用/已满：台账只是战绩记录，写不进去不该打断交易流程，但要说清后果
    msg('预警台账保存失败（' + e.message + '）：本会话的战绩不会被记住', 'warn');
  }
}

function msg(text, kind) {
  const el = $('paperMsg');
  if (!el) return;
  el.textContent = text || '';
  // warn 用于「部分成功」——既不是全成功也不是全失败，用警示色避免被当成成功略过
  el.className = kind === 'err' ? 'hl-dn' : kind === 'ok' ? 'hl' : kind === 'warn' ? 'bf-warn' : 'muted';
  const ms = kind === 'warn' || kind === 'err' ? 12000 : 6000;
  if (text) setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'muted'; } }, ms);
}

// ────────────────────────── 实时行情 ──────────────────────────

/**
 * 抓一批代码的实时行情并并进 LIVEQ。
 * 为什么是「合并」而不是「替换」：用户每输入一个代码就抓一次，若整表替换，
 * 之前查过的票会立刻失去实时价（持仓列表、待成交列表都会闪回存档价）。
 * 合并保留已取到的价，配合 LIVE_AT 标注抓取时刻。
 * @returns {Promise<{ok:number, failed:string[]}>}
 */
async function refreshLive(codes) {
  const list = normalizeCodes(codes);
  if (!list.length) return { ok: 0, failed: [] };
  LIVE_BUSY = true;
  try {
    const r = await fetchQuotes(list);
    const got = Object.keys(r.quotes).length;
    if (got) {
      LIVEQ = { ...LIVEQ, ...r.quotes };
      LIVE_AT = new Date();
    }
    LIVE_FAIL = r.failed || [];
    return { ok: got, failed: LIVE_FAIL };
  } catch (e) {
    // 网络/跨域失败：不炸界面，降级回存档价，并在下单区如实提示
    LIVE_FAIL = list;
    return { ok: 0, failed: list };
  } finally {
    LIVE_BUSY = false;
  }
}

/** 抓当前屏幕上所有需要现价的代码（下单标的 + 持仓 + 待成交），一次批量拉齐 */
async function refreshAllLive() {
  const codes = [
    ORDER.code,
    ...Object.keys(ACCT?.positions || {}),
    ...(ACCT?.pending || []).map((p) => p.code),
  ];
  const uniq = normalizeCodes(codes);
  if (!uniq.length) return { ok: 0, failed: [] };
  const r = await refreshLive(uniq);
  // 用实时价刷新持仓浮盈（持仓的 last 字段是显示用，成本/数量不动）
  syncPositionsLive();
  return r;
}

/** 用最新实时价更新持仓的现价字段（只动 last/lastDate，不碰成本与数量） */
function syncPositionsLive() {
  if (!ACCT?.positions) return;
  let changed = false;
  const positions = { ...ACCT.positions };
  for (const code of Object.keys(positions)) {
    const q = LIVEQ[code];
    if (!q || !Number.isFinite(+q.price)) continue;
    if (positions[code].last !== q.price || positions[code].lastDate !== q.tickDate) {
      positions[code] = { ...positions[code], last: q.price, lastDate: q.tickDate || LAST_DATE, pxStale: false };
      changed = true;
    }
  }
  if (changed) { ACCT = { ...ACCT, positions }; save(); }
}

// ────────────────────────── 数据装载 ──────────────────────────

async function boot() {
  const sub = $('paperSub');
  try {
    const [uniRes, arcRes] = await Promise.all([
      fetch('./data/paper_universe.json?_=' + Date.now(), { cache: 'no-store' }),
      fetch('./data/archive.json?_=' + Date.now(), { cache: 'no-store' }),
    ]);
    if (!uniRes.ok) throw new Error('标的池 HTTP ' + uniRes.status);
    if (!arcRes.ok) throw new Error('存档 HTTP ' + arcRes.status);
    const uni = await uniRes.json();
    const arc = await arcRes.json();

    UNI = uni.symbols || {};
    UNI_META = uni.meta || {};
    const days = arc.all_days || [];
    ARC_DAYS = days;
    const last = days[days.length - 1] || {};
    LAST_DATE = last.trade_date || null;
    QMAP = quotesFromDay(last);

    // 账户：优先本地账本；没有则新建（起始日 = 存档最新交易日）
    ACCT = load() || emptyAccount(INIT_CASH, LAST_DATE);
    // 预警台账：与账户相互独立（重置账户不清空战绩——它衡量的是规则本身，不是某一笔交易）
    ALOG = loadAlertLog();
    // 若本地账户落后于存档（比如隔了一天），自动补结算到最后可用的存档日
    autoCatchUp(days);

    if (sub) {
      sub.textContent = `仅初始资金为虚拟（${INIT_CASH.toLocaleString()} 元）· 行情来源：腾讯实时行情`
        + ` · 规则对齐 A 股现行制度（T+1、整手、涨跌停、真实费用）`;
    }
    renderAllPaper();

    // 实时行情放在首屏渲染之后：先把界面画出来，再异步补价，避免网络慢时白屏。
    // 首次抓「持仓 + 待成交」，让账户列表立刻有实时价；用户输入代码时再按需补抓。
    refreshAllLive().then(() => renderAllPaper());
  } catch (e) {
    const box = $('paperSub');
    if (box) box.textContent = `模拟器数据未就绪（${e.message}）——先运行 node scripts/fetch_universe.mjs 生成 data/paper_universe.json`;
    msg('加载失败：' + e.message, 'err');
  }
}

/**
 * 用存档里「晚于账户最后结算日」的交易日补齐结算。
 * 只补存档真实存在的交易日——周末/休市不会凭空产生净值点。
 */
function autoCatchUp(days) {
  if (!ACCT.lastSettle) {
    ACCT = { ...ACCT, lastSettle: LAST_DATE };
    return;
  }
  const todo = days.filter((d) => d.trade_date > ACCT.lastSettle);
  if (!todo.length) {
    // 至少给首日记一个净值点，否则净值曲线一直空着
    if (!(ACCT.nav || []).length && LAST_DATE) {
      const st = accountStats(ACCT);
      ACCT = { ...ACCT, nav: [{ date: LAST_DATE, equity: Math.round(st.total * 100) / 100, cash: Math.round((st.cash + st.freeze) * 100) / 100, marketValue: Math.round(st.marketValue * 100) / 100 }] };
    }
    return;
  }
  let cur = ACCT;
  let filled = 0, expired = 0;
  for (const d of todo) {
    const r = settleDay(cur, d.trade_date, quotesFromDay(d));
    cur = r.account;
    filled += r.fills.length;
    expired += r.expired.length;
  }
  ACCT = cur;
  save();
  if (filled || expired) {
    msg(`已按存档补齐结算（${todo[0].trade_date} ~ ${todo[todo.length - 1].trade_date}）：成交 ${filled} 笔、失效 ${expired} 笔`, 'ok');
  }
}

// ────────────────────────── 行情查询 ──────────────────────────

/**
 * 综合实时行情 / 存档行情 / 标的池，给出一只票的完整可交易状态。
 *
 * 取价优先级（这是本次改造的核心）：
 *   1) 实时行情 LIVEQ（腾讯源）—— 全市场任意 A 股，盘中是实时价、盘后是最近真实收盘价
 *   2) 存档当日行情 QMAP —— 实时源拿不到时的降级（仍是真实收盘价，但要标注来源与日期）
 * 两者都没有 → fresh=false，界面如实说明「取不到价」，而不是谎称不可交易。
 *
 * 关键修复：旧版把「在不在标的池里」当成可下单的前提，池子里只有上榜股（约 100 只），
 * 于是 1200+ 只正常股票都被判「无真实行情，不可下单」。现在**标的池只作参考**，
 * 是否能下单取决于「有没有取到真实价格」。
 */
function lookup(code) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return null;
  const b = boardOf(c);
  const u = UNI?.[c] || null;
  const live = LIVEQ[c] || null;
  const arch = QMAP[c] || null;
  // 实时优先；实时没有才用存档收盘价
  const q = live || arch;
  const name = q?.name || u?.name || '';
  const kind = live ? priceKind(live) : null;
  return {
    code: c,
    name,
    board: b,
    st: isStName(name),
    limitPct: limitPctOf(c, name),
    price: q?.price ?? null,
    changePct: q?.changePct ?? null,
    turnover: q?.turnover ?? u?.huanshou ?? null,
    prevClose: q?.prevClose ?? null,
    // 价格来源与时间：界面据此如实标注是「实时价」还是「最近收盘价」
    src: live ? 'live' : (arch ? 'archive' : null),
    srcLabel: live ? (kind?.kind === 'live' ? '实时价' : '最近收盘价') : (arch ? '存档收盘价' : null),
    tickTime: live?.tickTime || null,
    quoteDate: live ? (live.tickDate || LAST_DATE) : (arch ? LAST_DATE : (u?.asOf || null)),
    fresh: !!q,
    history: u,
    inUniverse: !!u,
  };
}

// ────────────────────────── 渲染：账户 ──────────────────────────

function renderAllPaper() {
  renderStats();
  renderAlerts();
  renderPicks();
  renderPositions();
  renderPending();
  renderHist();
  renderPerf();
  renderOrderForm();
  renderQuick();
  publishSnapshot();
}

/**
 * 把「账户 + 预警台账 + 实时价 + 当日情绪分」挂到 window.__paperSnapshot，
 * 供经典脚本 app.js 生成研判报告的「⑦ 模拟交易复盘」段落。
 *
 * 为什么在 renderAllPaper 末尾调用：renderAllPaper 是**所有账户变更的唯一收口**
 * （下单、撤单、结算、重置、导入、补结算后都会走这里），挂在这里就不会漏更新。
 *
 * 快照是**只读拷贝**（结构化克隆），不是引用——报告端绝不能拿到能反向改账户的对象。
 * 价格用 lookup() 的当前值（实时 > 存档 > 标的池），与台账记账、下单区同一口径，
 * 保证「报告里说的浮盈」和「界面上看到的浮盈」是同一个数。
 */
function publishSnapshot() {
  if (!ACCT) { delete window.__paperSnapshot; return; }
  const day = ARC_DAYS[ARC_DAYS.length - 1] || {};
  const priceMap = {};
  for (const code of Object.keys(ACCT.positions || {})) {
    const q = lookup(code);
    if (q && q.price != null && Number.isFinite(+q.price)) priceMap[code] = +q.price;
  }
  window.__paperSnapshot = {
    version: REVIEW_VERSION,
    updatedAt: new Date().toISOString(),
    asOf: day.trade_date || LAST_DATE || null,
    emotionScore: (day.emotion && day.emotion.value != null) ? +day.emotion.value : null,
    account: JSON.parse(JSON.stringify({ ...ACCT, orders: undefined, pending: undefined })),
    log: JSON.parse(JSON.stringify(ALOG)),
    priceMap,
    meta: {
      liveAt: LIVE_AT,
      liveCount: Object.keys(LIVEQ).length,
      lastDate: LAST_DATE,
    },
  };
  // 通知报告端刷新第⑦段（app.js 监听此事件）。用事件而不是让 app.js 轮询：
  // 账户变化是低频动作（下单/结算/导入），轮询只会白白增加耦合。
  try { window.dispatchEvent(new Event('paper-snapshot')); } catch (e) { /* 静默 */ }
}

function renderStats() {
  const box = $('paperStats');
  if (!box) return;
  const st = accountStats(ACCT);
  const rows = [
    ['总资产', num(st.total), '', `现金 + 冻结 + 持仓市值`, 'stat-total'],
    ['可用资金', num(st.cash), '', '可用于新开仓', ''],
    ['冻结资金', num(st.freeze), '', '买入挂单占用，撤单/成交后释放', ''],
    ['持仓市值', num(st.marketValue), '', '按最新真实行情价计', ''],
    ['浮动盈亏', num(st.floatPnl), cls(st.floatPnl), `成本 ${num(st.costValue)} · ${pct(st.floatPnlPct * 100)}`, ''],
    ['已实现盈亏', num(st.realized), cls(st.realized), '清仓结转，含买入成本分摊', ''],
    ['累计费用', num(st.totalFee), '', '佣金 + 过户费 + 印花税', ''],
    ['账户收益率', pct(st.retPct), cls(st.retPct), `初始 ${st.initCash.toLocaleString()} 元`, ''],
  ];
  box.innerHTML = rows.map(([k, v, c, note, extra]) => `<div class="ps-cell ${extra}" data-act="pstat" data-k="${esc(k)}" tabindex="0" role="button">
      <div class="ps-k">${esc(k)}</div>
      <div class="ps-v ${c}">${esc(v)}</div>
      <div class="ps-n muted">${esc(note)}</div>
    </div>`).join('');
}

function renderPositions() {
  const tb = $('paperPosTable')?.querySelector('tbody');
  const cards = $('paperPosCards');
  const note = $('paperPosNote');
  const rows = Object.values(ACCT.positions || {}).sort((a, b) => (b.last * b.qty) - (a.last * a.qty));
  const html = rows.map((p) => {
    const mv = (p.last ?? p.avgCost) * p.qty;
    const pnl = mv - (p.cost || 0);
    const pnlPct = p.cost ? (pnl / p.cost) * 100 : 0;
    const frozen = (ACCT.pending || []).filter((x) => x.code === p.code && x.side === 'sell').reduce((a, x) => a + x.qty, 0);
    return { p, mv, pnl, pnlPct, frozen };
  });
  if (tb) {
    tb.innerHTML = rows.length
      ? html.map(({ p, mv, pnl, pnlPct, frozen }) => `<tr class="clickable" data-act="ppos" data-code="${esc(p.code)}" tabindex="0">
          <td>${esc(p.code)}</td><td>${esc(p.name || (UNI?.[p.code]?.name) || '')}</td>
          <td class="num">${p.qty}</td>
          <td class="num">${Math.max(0, (p.avail || 0) - frozen)}${frozen ? `<span class="tag-mini">冻${frozen}</span>` : ''}</td>
          <td class="num">${num(p.avgCost, 3)}</td>
          <td class="num">${num(p.last)}${p.pxStale ? '<span class="tag-mini warn">旧价</span>' : ''}</td>
          <td class="num ${cls(pnl)}">${num(pnl)}<span class="psub">${pct(pnlPct)}</span></td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="7" class="muted">暂无持仓——在上方「下单」提交委托，次日按真实收盘价成交</td></tr>';
  }
  if (cards) {
    cards.innerHTML = rows.length
      ? html.map(({ p, pnl, pnlPct, frozen }) => `<div class="card-row" data-act="ppos" data-code="${esc(p.code)}" tabindex="0" role="button">
          <div class="cr-top"><b>${esc(p.name || p.code)}</b><span class="${cls(pnl)}">${num(pnl)} (${pct(pnlPct)})</span></div>
          <div class="cr-bot muted">${esc(p.code)} · ${p.qty} 股 · 可卖 ${Math.max(0, (p.avail || 0) - frozen)} · 成本 ${num(p.avgCost, 3)} · 现价 ${num(p.last)}</div>
        </div>`).join('')
      : '<div class="dw-empty">暂无持仓</div>';
  }
  if (note) {
    // rows 里装的是「原始持仓对象」（{p,...} 包装只存在于 html 数组），故直接读 x.pxStale
    const stale = rows.filter((x) => x.pxStale).map((x) => x.code);
    note.innerHTML = `成本含买入费用（加权平均）· 「可卖」已扣除待成交卖单的冻结 · `
      + `T+1：当日买入次一交易日才可卖`
      + (stale.length ? ` · <span class="bf-warn">${esc(stale.join('、'))} 最近一档无行情，沿用上一价（已标「旧价」）</span>` : '');
  }
}

function renderPending() {
  const tb = $('paperPendTable')?.querySelector('tbody');
  const cards = $('paperPendCards');
  const note = $('paperPendNote');
  const list = ACCT.pending || [];
  if (tb) {
    tb.innerHTML = list.length
      ? list.map((p) => `<tr class="clickable" data-act="ppend" data-id="${p.id}" tabindex="0">
          <td>${esc(p.submitDate || '—')}</td><td>${esc(p.code)}</td><td>${esc(p.name || '')}</td>
          <td class="${p.side === 'buy' ? 'hl' : 'hl-dn'}">${p.side === 'buy' ? '买入' : '卖出'}</td>
          <td class="num">${p.qty}</td><td class="num">${num(p.estPrice)}</td>
          <td class="num">${num(p.need)}</td>
          <td><button class="mini" type="button" data-act="pcancel" data-id="${p.id}">撤单</button></td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="8" class="muted">无待成交委托</td></tr>';
  }
  if (cards) {
    cards.innerHTML = list.length
      ? list.map((p) => `<div class="card-row" data-act="ppend" data-id="${p.id}" tabindex="0" role="button">
          <div class="cr-top"><b>${esc(p.name || p.code)}</b><span class="${p.side === 'buy' ? 'hl' : 'hl-dn'}">${p.side === 'buy' ? '买入' : '卖出'} ${p.qty}</span></div>
          <div class="cr-bot muted">${esc(p.code)} · 预估 ${num(p.estPrice)} · 冻结 ${num(p.need)} · 点此撤单</div>
        </div>`).join('')
      : '<div class="dw-empty">无待成交委托</div>';
  }
  if (note) {
    note.innerHTML = `委托在<b>次一交易日</b>按该日真实收盘价撮合（防前视偏差）· 买入预冻结资金、卖出预冻结股份`
      + ` · 涨停买不进 / 跌停卖不掉 / 资金不足 会在结算时自动失效并释放冻结`;
  }
}

const HIST_COLS = {
  trade: [
    ['fillDate', '成交日'], ['code', '代码'], ['name', '名称'], ['side', '方向'],
    ['qty', '数量'], ['price', '成交价'], ['drift', '委托价差'], ['gross', '成交额'], ['fee', '费用'],
  ],
  order: [
    ['submitDate', '提交日'], ['code', '代码'], ['name', '名称'], ['side', '方向'],
    ['qty', '数量'], ['estPrice', '预估/成交价'], ['status', '状态'], ['detail', '说明'],
  ],
};

function renderHist() {
  const view = HIST.view;
  const cols = HIST_COLS[view];
  const head = $('paperHistHead');
  const tb = $('paperHistTable')?.querySelector('tbody');
  const cards = $('paperHistCards');
  const list = view === 'trade' ? [...(ACCT.trades || [])].reverse() : [...(ACCT.orders || [])].reverse();
  if (head) head.innerHTML = cols.map(([, label]) => `<th>${esc(label)}</th>`).join('');
  const cnt = $('paperHistCount');
  if (cnt) {
    cnt.textContent = view === 'trade'
      ? `共 ${(ACCT.trades || []).length} 笔成交`
      : `共 ${(ACCT.orders || []).length} 张委托（被拒 ${(ACCT.orders || []).filter((o) => o.status === 'rejected').length} 张）`;
  }
  const emptyTxt = view === 'trade' ? '暂无成交——委托在次一交易日撮合' : '暂无委托记录';

  const cell = (t, c) => {
    switch (c) {
      case 'side': return `<td class="${t.side === 'buy' ? 'hl' : 'hl-dn'}">${t.side === 'buy' ? '买入' : '卖出'}</td>`;
      case 'price': return `<td class="num">${num(t.price)}</td>`;
      case 'drift': return `<td class="num ${cls(t.driftPct)}">${t.driftPct == null ? '—' : pct(t.driftPct)}</td>`;
      case 'gross': return `<td class="num">${num(t.gross)}</td>`;
      case 'fee': return `<td class="num">${num(t.fee)}</td>`;
      case 'estPrice': return `<td class="num">${num(t.fillPrice ?? t.estPrice)}</td>`;
      case 'status': return `<td>${statusTag(t)}</td>`;
      case 'detail': return `<td class="muted">${esc(t.detail || t.reject || '—')}</td>`;
      default: return `<td class="num">${esc(t[c] ?? '—')}</td>`;
    }
  };
  if (tb) {
    tb.innerHTML = list.length
      ? list.map((t, i) => `<tr class="clickable" data-act="phist" data-view="${view}" data-i="${list.length - 1 - i}" tabindex="0">`
        + cols.map(([, c]) => cell(t, c)).join('') + '</tr>').join('')
      : `<tr class="empty-row"><td colspan="${cols.length}" class="muted">${emptyTxt}</td></tr>`;
  }
  if (cards) {
    cards.innerHTML = list.length
      ? list.map((t, i) => `<div class="card-row" data-act="phist" data-view="${view}" data-i="${list.length - 1 - i}" tabindex="0" role="button">
          <div class="cr-top"><b>${esc(t.name || t.code)}</b><span class="${t.side === 'buy' ? 'hl' : 'hl-dn'}">${t.side === 'buy' ? '买入' : '卖出'} ${t.qty}</span></div>
          <div class="cr-bot muted">${esc(view === 'trade' ? t.fillDate : t.submitDate)} · ${esc(t.code)}
            · ${view === 'trade' ? `成交 ${num(t.price)}（委托 ${num(t.submitPrice)}）` : statusText(t)}</div>
        </div>`).join('')
      : `<div class="dw-empty">${emptyTxt}</div>`;
  }
}

const STATUS_LABEL = {
  filled: '已成', pending: '待成交', rejected: '已拒绝', cancelled: '已撤单', expired: '已失效',
};
function statusText(t) { return STATUS_LABEL[t.status] || t.status || '—'; }
function statusTag(t) {
  const clsMap = { filled: 'ok', pending: 'wait', rejected: 'bad', cancelled: 'mut', expired: 'warn' };
  return `<span class="stag ${clsMap[t.status] || 'mut'}">${esc(statusText(t))}</span>`;
}

function renderPerf() {
  const box = $('paperPerf');
  const note = $('paperPerfNote');
  const nav = (ACCT.nav || []).map((r) => r.equity);
  const m = nav.length >= 2 ? paperMetrics(nav) : null;
  if (box) {
    if (!m) {
      box.innerHTML = `<div class="ps-cell wide"><div class="ps-k">净值样本不足</div>
        <div class="ps-v">—</div>
        <div class="ps-n muted">按存档交易日逐日累积；至少需要 2 个交易日才能算收益与回撤</div></div>`;
    } else {
      const rows = [
        ['区间收益', pct(m.total * 100), cls(m.total), `${m.days} 个交易日`],
        ['年化收益', pct(m.annual * 100), cls(m.annual), `按 252 交易日年化（样本短，参考意义有限）`],
        ['最大回撤', pct(-m.ddPct), m.ddPct > 0 ? 'hl-dn' : 'muted', '峰值到谷底的最大跌幅'],
        ['夏普比率', num(m.sharpe), m.sharpe >= 1 ? 'hl' : m.sharpe > 0 ? '' : 'hl-dn', '与策略回测同口径'],
        ['日胜率', pct(m.winRate * 100), cls(m.winRate - 0.5), '上涨交易日占比'],
      ];
      box.innerHTML = rows.map(([k, v, c, n]) => `<div class="ps-cell" data-act="pperf" data-k="${esc(k)}" tabindex="0" role="button">
        <div class="ps-k">${esc(k)}</div><div class="ps-v ${c}">${esc(v)}</div>
        <div class="ps-n muted">${esc(n)}</div></div>`).join('');
    }
  }
  drawNavChart($('paperNavSvg'), ACCT.nav || []);
  if (note) {
    note.innerHTML = `净值 = 现金 + 冻结 + 持仓市值（按每日真实收盘价）· 指标定义与 <b>src/backtest.js</b> 的 metrics() 完全一致，`
      + `因此可与上方「策略回测」的夏普/回撤直接对比`;
  }
}

/** 净值曲线：与 app.js drawNav 同一画法，但数据源是账户净值 */
function drawNavChart(svg, rows) {
  if (!svg) return;
  const W = 300, H = 90, P = 6;
  // 空态提示用 HTML 渲染而非 SVG text：本图 preserveAspectRatio="none"（非等比拉伸铺满宽度），
  // SVG 里的文字会被横向放大到失真（300 视口 → 千级像素宽，字被拉大 3 倍以上）
  let tip = svg.nextElementSibling;
  if (!tip || !tip.classList.contains('nav-empty')) {
    tip = document.createElement('div');
    tip.className = 'nav-empty empty';
    tip.textContent = '净值曲线需要至少 2 个交易日';
    svg.after(tip);
  }
  if (!rows || rows.length < 2) {
    svg.innerHTML = '';
    svg.style.display = 'none';
    tip.style.display = '';
    return;
  }
  svg.style.display = '';
  tip.style.display = 'none';
  const vals = rows.map((r) => r.equity);
  const base = ACCT.initCash || vals[0];
  const lo = Math.min(...vals, base), hi = Math.max(...vals, base);
  const span = (hi - lo) || 1;
  const x = (i) => P + (i / (rows.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - lo) / span) * (H - 2 * P);
  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${P},${H - P} ${line} ${(W - P).toFixed(1)},${H - P}`;
  const up = vals[vals.length - 1] >= base;
  const color = up ? '#f0616d' : '#3fb950';   // 中文语境：赚=红、亏=绿
  const baseY = y(base).toFixed(1);
  svg.innerHTML = `
    <polygon points="${area}" fill="${color}" opacity="0.12"></polygon>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6"></polyline>
    <line x1="${P}" y1="${baseY}" x2="${W - P}" y2="${baseY}" stroke="#8b949e" stroke-width="0.7" stroke-dasharray="3 3"></line>
    ${rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.equity).toFixed(1)}" r="2.4" fill="${color}"
        class="pnav-pt" data-date="${esc(r.date)}" data-eq="${esc(r.equity)}" tabindex="0" role="button"><title>${esc(r.date)} 净值 ${esc(r.equity)}</title></circle>`).join('')}
    <text x="${P}" y="9" fill="#8b949e" font-size="8">${esc(rows[0].date)}</text>
    <text x="${W - P}" y="9" text-anchor="end" fill="#8b949e" font-size="8">${esc(rows[rows.length - 1].date)}</text>
    <text x="${P}" y="${H - 1}" fill="#8b949e" font-size="8">基准 ${base}</text>`;
}

// ────────────────────────── 渲染：下单表单 ──────────────────────────

function renderOrderForm() {
  const info = ORDER.code ? lookup(ORDER.code) : null;
  const qbox = $('poQuote');
  if (qbox) {
    if (!ORDER.code) {
      qbox.className = 'po-quote muted';
      // 全市场任意 A 股都能查实时价：文案必须说清楚，否则用户不知道入口变宽了
      qbox.textContent = '输入 6 位代码查询实时行情（全市场 A 股，沪/深/北交所均可）';
    } else if (!info || !info.board.tradable) {
      qbox.className = 'po-quote bad';
      qbox.textContent = info ? `${ORDER.code}：${info.board.label} —— 模拟器不纳入此类品种` : `${ORDER.code}：代码格式非法（需 6 位数字）`;
    } else {
      const hit = isLimitHit(info.changePct, info.code, info.name);
      qbox.className = 'po-quote';
      // 价格来源标注：实时价 / 最近收盘价 / 存档收盘价，三态必须让用户看得见
      const badge = info.src === 'live'
        ? (info.srcLabel === '实时价'
          ? '<span class="gtag live">实时价</span>'
          : '<span class="gtag close">最近收盘价</span>')
        : (info.src === 'archive' ? '<span class="gtag close">存档收盘价</span>' : '');
      qbox.innerHTML = `<b>${esc(info.name || '（名称未知）')}</b> <span class="muted">${esc(info.code)}</span>`
        + `<span class="gtag">${esc(info.board.label)}</span>${info.st ? '<span class="gtag n">ST</span>' : ''}`
        + `<span class="gtag">±${(info.limitPct * 100).toFixed(0)}%</span>${badge}`
        + (info.fresh
          ? `<div class="pq-line">${info.srcLabel === '实时价' ? '最新' : '收盘'} <b>${num(info.price)}</b> 元`
            + ` <span class="${cls(info.changePct)}">${pct(info.changePct)}</span>`
            + (hit === 'up' ? ' <span class="gtag d">涨停</span>' : hit === 'down' ? ' <span class="gtag u">跌停</span>' : '')
            + (info.turnover != null ? `<span class="muted"> · 换手 ${num(info.turnover)}%</span>` : '')
            + `<span class="muted"> · ${esc(info.tickTime || info.quoteDate || '—')}</span></div>`
          : `<div class="pq-line bf-warn">取不到 ${esc(ORDER.code)} 的行情（实时源与存档都没有该代码的价格）`
            + `——请核对代码是否存在/是否已停牌；已有持仓仍可正常卖出。</div>`);
    }
  }

  // 数量快捷项
  const qty = ORDER.qty;
  const prev = $('poPreview');
  if (prev) {
    if (!info || !info.board.tradable || !info.fresh || !qty) {
      prev.innerHTML = '<div class="muted">填写代码与数量后显示预估费用与冻结金额</div>';
    } else {
      const px = fillPrice(info.price, ORDER.side, SLIP);
      const gross = Math.round(px * qty * 100) / 100;
      const f = fees(gross, ORDER.side);
      const v = validateOrder(ACCT, { code: info.code, side: ORDER.side, qty, slip: SLIP }, { code: info.code, price: info.price, name: info.name, changePct: info.changePct });
      prev.innerHTML = `<table class="po-tb"><tbody>
          <tr><td>预估成交价</td><td class="num">${num(px)} 元 <span class="muted">（${info.srcLabel === '实时价' ? '最新' : '收盘'} ${num(info.price)} ${ORDER.side === 'buy' ? '+' : '−'} 滑点 ${SLIP * 1e4}‱）</span></td></tr>
          <tr><td>成交金额</td><td class="num">${num(gross)} 元</td></tr>
          <tr><td>佣金</td><td class="num">${num(f.comm)} 元 <span class="muted">（万三，最低 ${MIN_COMMISSION} 元）</span></td></tr>
          <tr><td>过户费</td><td class="num">${num(f.transfer)} 元 <span class="muted">（万0.1，双边）</span></td></tr>
          ${ORDER.side === 'sell' ? `<tr><td>印花税</td><td class="num">${num(f.stamp)} 元 <span class="muted">（万五，仅卖出）</span></td></tr>` : ''}
          <tr class="po-sum"><td>${ORDER.side === 'buy' ? '需冻结' : '预计到账'}</td><td class="num"><b>${num(ORDER.side === 'buy' ? gross + f.total : gross - f.total)} 元</b></td></tr>
          ${v.ok ? '' : `<tr><td colspan="2" class="bf-warn">✗ ${esc(v.reason)}${v.detail ? '：' + esc(v.detail) : ''}</td></tr>`}
        </tbody></table>`;
    }
  }
  const hint = $('poHint');
  if (hint) {
    hint.innerHTML = `下一可撮合日：<b>${esc(nextSessionLabel())}</b>（按该日真实收盘价成交）`
      + ` · 买入须 ${LOT} 股整数倍 · 可用 ${num(ACCT.cash)} 元`
      + (LIVE_AT ? ` · <span class="muted">行情 ${esc(fmtClock(LIVE_AT))} 抓取</span>` : '');
  }
}

/** 下一可撮合日：**今天（北京时间）之后**的下一个 A 股交易日。
 *  不再锚定存档日——实时结算下，如果今天就是交易日且盘后，次日即可撮合。 */
function nextSessionLabel() {
  // 若今天已是交易日且已过结算时点，从明天起算；否则今天本身可能是可撮合日
  const d = new Date(bjToday() + 'T00:00:00Z');
  for (let i = 0; i < 30; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w === 0 || w === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (HOLIDAYS.has(iso)) continue;
    return iso;
  }
  return '—';
}
// 与 src/config.js manualHolidays 同源（该文件的默认导出在浏览器里不易直接 import，故并列一份）
const HOLIDAYS = new Set([
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
]);

/**
 * 数量快捷区（按方向给出不同语义的档位）。
 *
 * 买入：轻仓/半仓/重仓/满仓（分母 = 账户总资产，见 src/paper.js qtyByAssetPct）
 * 卖出：减 1/4、减 1/2、减 3/4、清仓（分母 = 该票可卖数量，清仓=全部可卖）
 *
 * 为什么买卖两套分母不同：建仓说的是「占我整个账户多少」，减仓说的是「这只票卖掉多少」。
 * 混用一套比例会在「账户里已有多只票」时给出明显不合理的手数。
 */
function renderQuick() {
  const box = $('poQuick');
  if (!box) return;
  const info = ORDER.code ? lookup(ORDER.code) : null;
  // 档位按钮：qty=0 且带 sub 说明时渲染为禁用态（而非隐藏）——高价股上「轻仓够不着一手」
  // 是真实约束，静默隐藏会让用户以为功能缺失；禁用+原因才说得清。
  const btns = (items) => items
    .filter((x) => x && (x.qty > 0 || x.disabled))
    .map((x) => {
      const dis = x.qty > 0 ? '' : ' disabled';
      return `<button class="mini${x.primary ? ' primary-ghost' : ''}" type="button" data-act="pqty" data-qty="${x.qty}"${dis}${x.note ? ` title="${esc(x.note)}"` : ''}>${esc(x.label)}${x.sub ? `<span class="pq-sub">${esc(x.sub)}</span>` : ''}</button>`;
    })
    .join('');

  if (ORDER.side === 'sell') {
    const pos = ACCT.positions?.[ORDER.code];
    if (!pos) { box.innerHTML = '<span class="muted">该股无持仓，暂无可卖数量</span>'; return; }
    const frozen = (ACCT.pending || []).filter((x) => x.code === ORDER.code && x.side === 'sell').reduce((a, x) => a + x.qty, 0);
    const free = Math.max(0, (pos.avail || 0) - frozen);
    if (!free) {
      box.innerHTML = `<span class="muted">当前无可卖数量（持仓 ${pos.qty} 股${frozen ? `，其中 ${frozen} 股已挂卖单` : ''}${pos.avail === 0 ? '，当日买入需次日才可卖' : ''}）</span>`;
      return;
    }
    const cut = CUT_TIERS.map((t) => ({ label: t.label, qty: qtyByHoldPct(free, t.pct) }));
    box.innerHTML = `<span class="muted">可卖 ${free} 股：</span>`
      + btns(cut) + btns([{ label: '清仓', qty: free, primary: true, note: '卖出该票全部可卖数量' }]);
    return;
  }

  const canSize = info && info.board.tradable && info.fresh && info.price;
  if (!canSize) { box.innerHTML = '<span class="muted">填入有效代码后可按仓位档位快速估量</span>'; return; }
  if (!ACCT) { box.innerHTML = ''; return; }
  const st = accountStats(ACCT);
  const px = fillPrice(info.price, 'buy', SLIP);
  const lotCost = px * LOT + MIN_COMMISSION;      // 一手的含费成本（含最低佣金）
  const tiers = POS_TIERS.map((t) => {
    const r = qtyByAssetPct(st.total, t.pct, px, { cash: ACCT.cash });
    if (r.qty <= 0) {
      return { label: t.label, qty: 0, disabled: true, sub: '不足一手',
        note: `${t.note} → 预算 ${num(st.total * t.pct)} 元，不足一手（约 ${num(lotCost)} 元）` };
    }
    return { label: t.label, qty: r.qty, sub: r.capped ? '受可用资金限' : t.note, note: `${t.note}：${num(r.need)} 元（含费用）` };
  });
  const head = `<span class="muted">按仓位（总资产 ${num(st.total)} 元，一手约 ${num(lotCost)} 元）：</span>`;
  const any = tiers.some((t) => t.qty > 0);
  const html = btns(tiers);
  box.innerHTML = head + (any ? html
    : `<span class="muted">总资产 ${num(st.total)} 元买不起 ${esc(info.name || info.code)} 一手（约 ${num(lotCost)} 元），四档均不可建仓</span>`);
}

function syncOrderInputs() {
  const c = $('poCode'), q = $('poQty');
  if (c) c.value = ORDER.code;
  if (q) q.value = ORDER.qty || '';
  document.querySelectorAll('#poSide button').forEach((b) => {
    const on = b.dataset.side === ORDER.side;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

// ────────────────────────── 交易预警（大盘 + 持仓双层） ──────────────────────────

/**
 * 当前预警结果。与 currentPicks 同思路：**不缓存**——预警要反映「此刻的仓位与浮盈」，
 * 而账户和实时行情随时在变（下单、结算、抓价都会改），缓存一天前的结论是危险的。
 * 引擎是纯函数且规模很小（持仓数量级），每次重算的代价可以忽略。
 */
function currentAlerts() {
  if (!ACCT) return null;
  const day = ARC_DAYS[ARC_DAYS.length - 1] || {};
  const score = (day.emotion && day.emotion.value != null) ? day.emotion.value : null;
  const st = accountStats(ACCT);
  // 推荐池用于「持仓是否在今日推荐内」的信息提示；取不到就传空（引擎按「无结论」处理，不误报）
  const picks = currentPicks();
  const pickCodes = picks && picks.picks ? picks.picks.map((p) => p.code) : [];
  return buildAlerts({
    emotionScore: score,
    account: ACCT,
    stats: st,
    pickCodes,
    asOf: day.trade_date || LAST_DATE || null,
  });
}

/** 严重度 → 徽标文案。顺序与 src/alerts.js 的 LEVELS 一致（risk > opp > tip）。 */
const AL_LABEL = { risk: '风险', opp: '机会', tip: '提示' };

/**
 * 把当前这批预警落进台账（幂等，重复调用不产生重复条目）。
 *
 * 取价用 lookup() —— 与下单区同一口径（实时 > 存档 > 标的池），
 * 保证「台账里的价格基准」和「用户当时在界面上看到的价格」是同一个数。
 * 大盘层没有标的价格，传 null 即可（它按仓位金额记账）。
 *
 * @returns {number} 本次新增条数（0 表示全是重复或不可归因）
 */
function recordAlerts(r) {
  if (!r || !r.alerts || !r.alerts.length) return 0;
  const st = accountStats(ACCT);
  const tier = r.tier || null;
  const res = appendSignals(ALOG, r.alerts, {
    asOf: r.asOf,
    // 大盘层的「当前/目标仓位」必须由 UI 提供——引擎的 quote 是给人看的字符串，
    // 反解字符串算金额是极易出错的做法（且改文案就会静默算错）。
    curPos: st.total > 0 ? st.marketValue / st.total : 0,
    targetPos: tier ? tier.pos : null,
    total: st.total,
    now: new Date().toISOString(),
    priceOf: (code) => {
      const q = lookup(code);
      const px = q && q.price != null && Number.isFinite(+q.price) ? +q.price : null;
      return px;
    },
  });
  if (res.added > 0) {
    ALOG = res.log;
    saveAlertLog();
  }
  return res.added;
}

/** 今日真实价（code → 价），供归因结算用。与 recordAlerts 同一取价口径。 */
function priceMapForLog() {
  const m = {};
  for (const e of ALOG) {
    if (e.layer !== 'position' || !e.code) continue;
    const q = lookup(e.code);
    if (q && q.price != null && Number.isFinite(+q.price)) m[e.code] = +q.price;
  }
  return m;
}

/** 当前台账的归因汇总（不缓存：价格一变结论就得跟着变） */
function currentAttribution() {
  return summarizeLog(ALOG, null, { priceOf: (code) => {
    const q = lookup(code);
    return q && q.price != null && Number.isFinite(+q.price) ? +q.price : null;
  } });
}

function renderAlerts() {
  const meta = $('alertsMeta');
  const box = $('alertsList');
  const note = $('alertsNote');
  if (!box) return;

  const r = currentAlerts();
  if (!r) {
    if (meta) meta.innerHTML = '<span class="muted">数据未就绪</span>';
    box.innerHTML = '<div class="alerts-empty muted">等待账户与行情存档加载…</div>';
    if (note) note.textContent = '';
    return;
  }

  // 先落账再接渲染：这样「归因条」里的条数与下方卡片是同一次计算的产物，不会出现
  // 「卡片显示 7 条、战绩说 6 条」这种自相矛盾的画面。
  recordAlerts(r);

  if (meta) {
    const tierTxt = r.tier
      ? `<span class="pk-tier ${r.tier.allowNew ? '' : 'warn'}">${esc(r.tier.label)}</span>`
      : '<span class="pk-tier warn">档位未知</span>';
    meta.innerHTML = `数据日期 <b>${esc(r.asOf || '—')}</b> · 情绪分 <b>${r.score == null ? '—' : r.score.toFixed(1)}</b>`
      + ` → ${tierTxt} · 共 <b>${r.total}</b> 条`
      + `${r.truncated ? `（按严重度显示前 ${r.alerts.length} 条）` : ''}`
      + ` · <span class="hl">风险 ${r.counts.risk || 0}</span>`
      + ` / <span class="hl-dn">机会 ${r.counts.opp || 0}</span>`
      + ` / <span class="muted">提示 ${r.counts.tip || 0}</span>`;
  }

  renderAttribution();

  if (!r.alerts.length) {
    box.innerHTML = '<div class="alerts-empty muted">当前无预警：仓位贴合市场档位，持仓未触及止损线或集中度上限。</div>';
  } else {
    box.innerHTML = r.alerts.map((a, i) => {
      // 一键动作：只有能转成「下单区输入」的建议才给按钮（绝不自动提交）
      const canFill = a.action === 'sell' || a.action === 'reduce';
      const fillQty = a.qty > 0 ? ` data-qty="${a.qty}"` : '';
      return `<div class="alert-row ${esc(a.level)}" data-act="alert" data-i="${i}" tabindex="0" role="button"
          title="点击查看该条预警的触发依据">
        <span class="al-badge ${esc(a.level)}">${esc(AL_LABEL[a.level] || a.level)}</span>
        <div class="al-main">
          <div class="al-head">
            <span class="al-act">${esc(ACTIONS_CN[a.action] || a.action)}</span>
            ${a.code ? `<b class="al-code">${esc(a.name || a.code)} ${esc(a.code)}</b>` : '<b class="al-code">大盘</b>'}
          </div>
          <div class="al-text">${esc(a.text)}</div>
        </div>
        ${canFill ? `<div class="al-actions"><button class="mini al-fill" type="button"
            data-act="alert-fill" data-i="${i}"${fillQty}
            title="把该股与建议数量填入下单区（不自动提交）">填入卖出</button></div>` : ''}
      </div>`;
    }).join('');
  }

  if (note) {
    // 阈值一律从引擎常量取，避免 UI 文案与引擎悄悄漂移
    note.innerHTML = `<span class="muted">`
      + `大盘层：档位偏离容忍带 ${(MARKET_CFG.band * 100).toFixed(0)}%、`
      + `最小可执行差额 ${(MARKET_CFG.minActionPos * 100).toFixed(0)}% · `
      + `持仓层：止损线 ${(POS_CFG.stopLoss * 100).toFixed(0)}%、`
      + `单票上限 ${(POS_CFG.concMax * 100).toFixed(0)}%、`
      + `回撤降仓线 ${(POS_CFG.ddTrigger * 100).toFixed(0)}%`
      + `</span>`
      + ` 阈值与 V5.2 回测引擎同源；预警由规则引擎按当档数据与账户实况生成，`
      + `<b>不构成投资建议</b>，按键只把参数填入下单区，是否下单由你决定。`;
  }
}

/** 动作中文名（与 src/alerts.js 的 ACTIONS 一致；UI 侧留一份只为渲染，不参与判断） */
const ACTIONS_CN = {
  buy: '买入', sell: '卖出', add: '加仓', reduce: '减仓',
  clear: '空仓', exit: '清仓', hold: '持有', wait: '等待', watch: '观望',
};

// ────────────────────────── 预警战绩（收益归因） ──────────────────────────
//
// 为什么要有这块：预警的价值不在「说了什么」，而在「说了之后价格怎么走」。
// 把每条预警触发时的价格冻结进台账，用今天的真实价结算，就能回答用户最关心的问题——
// **这套预警到底帮我少亏了多少、多赚了多少、准不准**。
//
// 三个数字的符号约定（与 src/alert_log.js 一致，UI 不得另立一套）：
//   · 已规避亏损：卖出/减仓类预警在下跌中避免的损失（越大越好）
//   · 错杀/错过：卖出后反弹（卖飞）、或加仓后下跌（看错）造成的负贡献
//   · 净贡献 = 规避 − 错杀；**命中率分母只含已有结论的条目**（待验证的不算分母）

/** 归因汇总的判定类目 → 配色类名。规避亏损用蓝（不是红/绿——它既不是涨也不是跌） */
const ATTR_CLS = { pos: 'al-blue', neg: 'hl-dn', flat: 'muted' };

function renderAttribution() {
  const box = $('alertsAttr');
  if (!box) return;

  const s = currentAttribution();
  if (!s || !s.n) {
    box.innerHTML = `<div class="al-attr-empty muted">`
      + `尚无预警战绩——每触发一条预警就会按当刻真实价记账，后续用真实行情结算，`
      + `用来回答「这套预警到底帮我少亏了多少、多赚了多少」。</div>`;
    return;
  }

  const judged = s.hit + s.miss;
  const netCls = s.net > 0 ? 'al-blue' : s.net < 0 ? 'hl-dn' : 'muted';
  const cells = [
    { k: '已规避亏损', v: s.avoidedLoss > 0 ? `+${num(s.avoidedLoss, 0)}` : '0', c: 'al-blue',
      note: '卖出/减仓后在下跌中避免的损失', act: 'attr-detail', extra: 'pos' },
    { k: '错杀 / 错过', v: s.missedGain > 0 ? `−${num(s.missedGain, 0)}` : '0', c: 'hl-dn',
      note: '卖飞（反弹）或加仓后下跌', act: 'attr-detail', extra: 'neg' },
    { k: '净贡献', v: `${s.net >= 0 ? '+' : '−'}${num(Math.abs(s.net), 0)}`, c: netCls,
      note: `规避 − 错杀，按真实行情结算`, act: 'attr-detail', extra: 'net' },
    { k: '命中率', v: s.hitRate == null ? '待积累' : `${(s.hitRate * 100).toFixed(0)}%`,
      c: s.hitRate == null ? 'muted' : (s.hitRate >= 0.5 ? 'al-blue' : 'hl-dn'),
      note: judged ? `${s.hit} 对 / ${s.miss} 错，另有 ${s.flat + s.pending + s.tracked} 条未定` : '暂无已结算条目',
      act: 'attr-detail', extra: 'rate' },
  ];

  box.innerHTML = `<div class="al-attr">
      <div class="al-attr-hd">
        <b>预警战绩</b>
        <span class="muted">共记账 ${s.n} 条 · 点数字看逐条明细</span>
      </div>
      <div class="al-attr-cells">${cells.map((c) => `<div class="al-cell" data-act="${c.act}" data-k="${esc(c.k)}" tabindex="0" role="button">
          <div class="al-k">${esc(c.k)}</div>
          <div class="al-v ${c.c}">${esc(c.v)}</div>
          <div class="al-n muted">${esc(c.note)}</div>
        </div>`).join('')}</div>
      <div class="al-attr-txt">${esc(summarizeText(s))}</div>
    </div>`;
}

/** 归因明细表：按规则拆解，每条给出「触发价 → 今日价 → 差额」，全部可核验 */
function attrDetail() {
  const s = currentAttribution();
  if (!s || !s.n) return null;

  const rows = s.byType.map((t) => {
    const rate = (t.hit + t.miss) > 0 ? `${((t.hit / (t.hit + t.miss)) * 100).toFixed(0)}%` : '—';
    const netCls = t.net > 0 ? 'al-blue' : t.net < 0 ? 'hl-dn' : 'muted';
    return `<tr>
      <td>${esc(t.type)}</td>
      <td>${esc(ACTIONS_CN[t.action] || t.action)}</td>
      <td class="num">${t.count}</td>
      <td class="num ${netCls}">${t.net >= 0 ? '+' : '−'}${num(Math.abs(t.net), 0)}</td>
      <td class="num">${esc(rate)}</td>
      <td class="num muted">${t.pending || 0}</td>
    </tr>`;
  }).join('');

  // 逐条明细：只列已结算的，未结算的单独计数（避免把「还不知道」混进战绩里）
  const settled = s.details.filter((d) => d.result && d.result.pnl != null);
  const list = settled.map((d) => {
    const r = d.result;
    const cls2 = r.pnl > 0 ? 'al-blue' : r.pnl < 0 ? 'hl-dn' : 'muted';
    return `<div class="al-line">
      <span class="al-line-d">${esc(d.asOf || '—')}</span>
      <span class="al-line-c">${esc(d.code ? `${d.name || d.code} ${d.code}` : '大盘')}</span>
      <span class="al-line-t">${esc(d.type)}</span>
      <span class="al-line-p">${num(r.px)} → ${num(r.finalPx)}（${pct(r.pct)}）</span>
      <span class="al-line-v ${cls2}">${r.pnl >= 0 ? '+' : '−'}${num(Math.abs(r.pnl), 0)} 元</span>
      <span class="al-line-b muted">${r.verdict === 'hit' ? '方向对' : r.verdict === 'miss' ? '方向错' : '几乎没动'}</span>
    </div>`;
  }).join('') || '<div class="muted">暂无已结算条目（预警需要后续真实价格才能验证）。</div>';

  const body = dwSection('战绩总览',
    `<div class="dw-note">${esc(summarizeText(s))}</div>`
    + dwKv([
      ['已规避亏损', `${num(s.avoidedLoss, 0)} 元`],
      ['错杀 / 错过', `${num(s.missedGain, 0)} 元`],
      ['净贡献', `${s.net >= 0 ? '+' : '−'}${num(Math.abs(s.net), 0)} 元`],
      ['命中率', s.hitRate == null ? '待积累' : `${(s.hitRate * 100).toFixed(0)}%（${s.hit} 对 / ${s.miss} 错）`],
      ['记账条数', `${s.n} 条（已结算 ${s.hit + s.miss + s.flat} · 待验证 ${s.pending + s.tracked}）`],
    ]))
    + dwSection('按规则拆解', `<table class="dw-tb"><thead><tr>
        <th>规则</th><th>动作</th><th class="num">条数</th><th class="num">净贡献(元)</th><th class="num">命中率</th><th class="num">待验证</th>
      </tr></thead><tbody>${rows}</tbody></table>`)
    + dwSection('逐条明细', `<div class="al-lines">${list}</div>`)
    + dwSection('计分口径',
      `<div class="dw-note">归因只做「照做 vs 不动」的差额，按<b>股数 × 价差</b>计算，`
      + `不含费用（费用在两边都发生，做差会抵消）。触发价在记账时冻结、永不被后续行情改写；`
      + `不足 100 股（一手）的建议不计分——A 股执行不了。`
      + `大盘层没有单一标的价格，只记「应调整多少金额」，<b>不编造收益数字</b>。</div>`);

  return {
    title: '预警战绩明细',
    sub: `记账 ${s.n} 条 · 净贡献 ${s.net >= 0 ? '+' : '−'}${num(Math.abs(s.net), 0)} 元`,
    body,
  };
}

/**
 * 把预警的建议转成下单区输入（**只填不提交**——与「研判推荐」的填入同纪律）。
 * 卖出方向要把数量也带上，否则用户还得自己算「减多少股」。
 */
function fillAlertToOrder(i) {
  const r = currentAlerts();
  const a = r && r.alerts[i];
  if (!a) return;
  if (a.action === 'clear' || a.action === 'exit') {
    // 空仓/清仓是「一键空仓」那种批量动作，不在这里做——引导用户用账户栏那颗按钮更安全
    msg('「空仓」涉及全部持仓，请用账户总览的「一键空仓」，避免只卖一只造成误解', 'ok');
    return;
  }
  if (!a.code) return;
  ORDER = { ...ORDER, code: a.code, side: 'sell', qty: a.qty > 0 ? a.qty : 0 };
  syncOrderInputs();
  renderOrderForm();
  renderQuick();
  const nm = LIVEQ[a.code]?.name || a.name || '';
  if (!LIVEQ[a.code] && !LIVE_BUSY) {
    refreshLive([a.code]).then((res) => {
      renderOrderForm();
      renderQuick();
      msg(res.ok ? `已填入 ${a.code} ${LIVEQ[a.code]?.name || nm} 卖出，请核对数量后提交` : `${a.code} 取不到行情，请核对代码`, res.ok ? 'ok' : 'err');
    });
  } else {
    msg(`已填入 ${a.code} ${nm} 卖出${a.qty > 0 ? ` ${a.qty} 股` : ''}，请核对后提交`, 'ok');
  }
  $('poQty')?.focus?.();
}

/** 预警条目详情抽屉：把引擎给出的触发依据原样展示，便于核对 */
function alertDetail(i) {
  const r = currentAlerts();
  const a = r && r.alerts[i];
  if (!a) return null;
  const title = a.code ? `${a.name || a.code} ${a.code}` : '大盘仓位';
  // 复用抽屉的 dwSection / dwKv（函数声明会提升，放在后面定义也能用）——
  // 手写一份 HTML 结构等于多一套需要同步维护的版式。
  const body = dwSection('建议动作',
    `<div class="dw-note"><b>${esc(ACTIONS_CN[a.action] || a.action)}</b>`
    + `${a.qty > 0 ? ` · 数量 ${a.qty} 股` : ''}`
    + ` · 严重度 ${esc(AL_LABEL[a.level] || a.level)}`
    + ` · 规则出处 ${esc(a.layer === 'market' ? 'src/alerts.js marketAlerts()' : 'src/alerts.js positionAlerts()')}</div>`)
    + dwSection('触发依据', `<div class="dw-note">${esc(a.why || '—')}</div>`)
    + dwSection('当时的字段取值', dwKv(Object.entries(a.quote || {}).map(([k, v]) => [k, esc(v)])))
    + alertTrackRecord(a, r);
  return {
    title: `${esc(title)}`,
    sub: `${AL_LABEL[a.level] || a.level} · ${ACTIONS_CN[a.action] || a.action} · 数据日 ${esc(r.asOf || '—')}`,
    body,
  };
}

/**
 * 这条规则的历史战绩：同类预警过去触发过几次、方向对了几次、累计贡献多少。
 *
 * 为什么按 type 聚合而不是只看这一条：单条预警当天还没结算（价格没走出来），
 * 此时「这一条赚没赚」是无意义的；有意义的是**这条规则历史上准不准**——
 * 那才是用户决定「要不要照做」的依据。
 */
function alertTrackRecord(a, r) {
  const s = currentAttribution();
  const t = s && s.byType ? s.byType.find((x) => x.type === a.type) : null;
  if (!t) {
    return dwSection('这条规则的历史战绩',
      `<div class="dw-note muted">本条规则尚无往期记账——本次触发已写入战绩台账，`
      + `后续用真实行情结算后，这里会显示「照做 vs 不动」的累计差额。</div>`);
  }
  const judged = t.hit + t.miss;
  const netCls = t.net > 0 ? 'al-blue' : t.net < 0 ? 'hl-dn' : 'muted';
  return dwSection('这条规则的历史战绩',
    `<div class="dw-note">按规则 <code>${esc(t.type)}</code> 累计，`
    + `不含本次未结算的部分。</div>`
    + dwKv([
      ['累计触发', `${t.count} 次`],
      ['累计贡献', `${t.net >= 0 ? '+' : '−'}${num(Math.abs(t.net), 0)} 元`],
      ['方向对/错', judged ? `${t.hit} 对 / ${t.miss} 错` : '—'],
      ['待验证', `${t.pending || 0} 次`],
    ])
    + `<div class="dw-note ${netCls}">${esc(
      t.net > 0 ? '历史看，按这条规则操作整体是「省下/赚到」的。'
        : t.net < 0 ? '历史看，这条规则有过「卖飞」或「看错」，请结合当前依据自行判断。'
          : '历史看，累计贡献接近零。')}</div>`);
}

// ────────────────────────── 研判推荐（小模块） ──────────────────────────

/**
 * 当前推荐结果（缓存，供抽屉与渲染共用，避免两处各算一遍导致数字不一致）。
 * 每天都重算——推荐是「当日」的，不是「永久」的。
 */
let PICKS = null;

function currentPicks() {
  const day = ARC_DAYS[ARC_DAYS.length - 1];
  if (!day) return null;
  // 情绪分取当档（与研判报告、回测引擎同源），不是页面当前实时值——推荐必须可复现
  const score = (day.emotion && day.emotion.value != null) ? day.emotion.value : null;
  if (!PICKS || PICKS.asOf !== (day.trade_date || null)) {
    PICKS = recommendPicks(day, { emotionScore: score, topN: PICK_TOP_N });
  }
  return PICKS;
}

const TONE_CLS = { up: 'hl', warn: 'bf-warn', muted: 'muted' };

function renderPicks() {
  const meta = $('picksMeta');
  const box = $('picksList');
  const note = $('picksNote');
  if (!box) return;

  const r = currentPicks();
  if (!r) {
    // 存档没就绪：如实说明，不给假数据
    if (meta) meta.innerHTML = '<span class="muted">数据未就绪</span>';
    box.innerHTML = '<div class="picks-empty muted">等待行情存档加载…</div>';
    if (note) note.textContent = '';
    return;
  }

  if (meta) {
    const tierTxt = r.tier
      ? `<span class="pk-tier ${r.tier.allowNew ? '' : 'warn'}">${esc(r.tier.label)}</span>`
      : '<span class="pk-tier warn">档位未知</span>';
    meta.innerHTML = `数据日期 <b>${esc(r.asOf || '—')}</b> · 情绪分 <b>${r.score == null ? '—' : r.score.toFixed(1)}</b>`
      + ` → 市场档位 ${tierTxt} · 候选池 <b>${r.pool}</b> 只（当日榜净买为正 / 涨停）`;
  }

  if (!r.picks.length) {
    box.innerHTML = `<div class="picks-empty muted">${esc(r.note.text)}</div>`;
  } else {
    box.innerHTML = r.picks.map((p, i) => {
      const chg = p.changePct == null ? null : +p.changePct;
      const chgCls = chg == null ? 'muted' : (chg > 0 ? 'hl' : chg < 0 ? 'hl-dn' : 'muted');
      return `<div class="pk-row" data-act="pick" data-code="${esc(p.code)}" tabindex="0" role="button"
          title="点击查看 ${esc(p.name || p.code)} 的详情">
        <span class="pk-rank${i === 0 ? ' top' : ''}">${i + 1}</span>
        <div class="pk-main">
          <div class="pk-line1">
            <b class="pk-name">${esc(p.name || p.code)}</b>
            <span class="pk-code muted">${esc(p.code)}</span>
            ${chg == null ? '' : `<span class="pk-chg ${chgCls}">${pct(chg)}</span>`}
            <span class="pk-score" title="评分：资金 40% / 连板 25% / 题材 20% / 流动性 15%">${p.score.toFixed(1)}</span>
          </div>
          <div class="pk-reasons">${p.reasons.map((x) => `<span class="pk-tag ${TONE_CLS[x.tone] || 'muted'}">${esc(x.text)}</span>`).join('')}</div>
          ${p.risks.length ? `<div class="pk-risks muted">风险：${esc(p.risks.join('；'))}</div>` : ''}
        </div>
        <div class="pk-actions">
          <span class="pk-w" title="建议仓位（占总资产）">${p.suggestWeight > 0 ? (p.suggestWeight * 100).toFixed(1) + '%' : '观察'}</span>
          <button class="mini pk-buy" type="button" data-act="pick-fill" data-code="${esc(p.code)}"
            title="把该股代码填入下方下单区">填入下单</button>
        </div>
      </div>`;
    }).join('');
  }

  if (note) {
    const n = r.note;
    note.innerHTML = `<span class="${n.level === 'blocked' ? 'bf-warn' : 'muted'}">${esc(n.text)}</span>`
      // 权重一律从引擎常量取，避免 UI 文案与引擎权重悄悄漂移
      + ` 评分维度：龙虎榜当日净买 ${Math.round(SCORE_WEIGHTS.fund * 100)}% · 连板高度 ${Math.round(SCORE_WEIGHTS.streak * 100)}% ·`
      + ` 主线题材 ${Math.round(SCORE_WEIGHTS.theme * 100)}% · 流动性 ${Math.round(SCORE_WEIGHTS.liquidity * 100)}%；`
      + `数据取自当日榜（区间累计榜与新股已剔除）。推荐由规则引擎按当档数据生成，<b>不构成投资建议</b>，`
      + `仅供模拟盘练习参考；买卖由你自行判断。`;
  }
}

/** 把推荐股填入下单区（不自动提交——绝不替用户下单） */
function fillPickToOrder(code) {
  const c = String(code || '');
  if (!c) return;
  ORDER = { ...ORDER, code: c, qty: 0, side: 'buy' };
  syncOrderInputs();
  renderOrderForm();
  renderQuick();
  // 输入框的实时抓价逻辑挂在 input 事件上；这里用程序赋值不会触发，故显式抓一次
  if (!LIVEQ[c] && !LIVE_BUSY) {
    msg(`正在获取 ${c} 实时行情…`, 'ok');
    refreshLive([c]).then((r) => {
      renderOrderForm();
      renderQuick();
      msg(r.ok ? `已填入 ${c} ${LIVEQ[c]?.name || ''}，请选择仓位档位或填数量后提交` : `${c} 取不到行情，请核对代码`, r.ok ? 'ok' : 'err');
    });
  } else {
    msg(`已填入 ${c} ${LIVEQ[c]?.name || ''}，请选择仓位档位或填数量后提交`, 'ok');
  }
  // 滚到下单区并聚焦数量，减少一次滚动操作
  $('poQty')?.focus?.();
}

/** 推荐个股的详情抽屉（含入选理由与风险，便于「点击查看个股信息」） */
function pickDetail(code) {
  const r = currentPicks();
  const p = r && r.picks.find((x) => x.code === code);
  if (!p) return null;
  const info = lookup(code);
  const netTxt = (p.netWan == null || !Number.isFinite(+p.netWan))
    ? '<span class="muted">无当日龙虎榜净买记录</span>'
    : `<span class="${p.netWan > 0 ? 'hl' : 'hl-dn'}">${(p.netWan / 1e4).toFixed(2)} 亿</span>`;
  const parts = p.scoreParts || {};
  // 注意：dwKv 收的是 [键, 值] 二元组数组（内部对键做 esc、对值按 HTML 处理）；
  // 早先误把拼好的 HTML 字符串当二元组传进去，字符串被逐字符解构 → 渲染成 "<d<d<d"。
  const bar = (label, w, v) => [
    `${label}（权重 ${Math.round(w * 100)}%）`,
    `${(v * 100).toFixed(0)} 分 <span class="muted">→ 贡献 ${(w * v * 100).toFixed(1)}</span>`,
  ];
  return {
    title: `${esc(p.name || code)}　${esc(code)}`,
    sub: `研判推荐第 ${r.picks.indexOf(p) + 1} 位 · 综合评分 ${p.score.toFixed(1)} · 数据日期 ${esc(r.asOf || '—')}`,
    body: dwSection('为什么入选', dwKv([
      ['龙虎榜当日净买', netTxt],
      ['涨停 / 连板', p.isZt ? (p.streak > 1 ? `涨停（${p.streak} 连板）` : '涨停') : '<span class="muted">未涨停</span>'],
      ['主线题材', p.mainThemeMatch === 'exact' ? '属当日主线题材'
        : p.mainThemeMatch === 'stem' ? '<span class="bf-warn">与主线题材同源（词根匹配，非精确命中）</span>'
          : '<span class="muted">不在当日主线内</span>'],
      ['所属题材', p.themes && p.themes.length ? esc(p.themes.join('、')) : '<span class="muted">—</span>'],
      ['换手率', p.turnoverPct == null ? '—' : `${p.turnoverPct}%`],
      ['现价（当档收盘）', p.close == null ? '—' : `${p.close} 元`],
    ]))
      + dwSection('评分构成（可核验）', dwKv([
        bar('资金面 · 龙虎榜净买', SCORE_WEIGHTS.fund, parts.fund || 0),
        bar('连板高度', SCORE_WEIGHTS.streak, parts.streak || 0),
        bar('主线题材', SCORE_WEIGHTS.theme, parts.theme || 0),
        bar('流动性 · 占全榜比重', SCORE_WEIGHTS.liquidity, parts.liquidity || 0),
      ]) + '<div class="dw-note">每一维都对应一个可核验的原始字段（净买额 / 连板数 / 题材归属 / 成交额占比）；'
      + '权重和为 1，故评分可跨日比较。</div>')
      + dwSection('风险提示', p.risks.length
        ? `<div class="dw-note">${p.risks.map((x) => '· ' + esc(x)).join('<br>')}</div>`
        : '<div class="dw-empty">按当前规则未命中风险特征（不代表无风险）</div>')
      + dwSection('仓位建议', dwKv([
        ['市场档位', r.tier ? `${esc(r.tier.label)}（建议总仓位 ${Math.round(r.tier.pos * 100)}%）` : '—'],
        ['本股建议', p.suggestWeight > 0
          ? `${(p.suggestWeight * 100).toFixed(1)}% 总资产（${num(p.suggestWeight * accountStats(ACCT).total)} 元）`
          : '<span class="bf-warn">当前档位不建议新建仓，仅供观察</span>'],
      ]) + '<div class="dw-note">个股仓位由「市场档位 ÷ 推荐数」均分得出，单只上限 20%——'
      + '系统不假装能给出个股间的差异化权重。</div>')
      + dwSection('实时行情', info
        ? dwKv([['最新价', `${num(info.price)} 元`], ['涨跌幅', `<span class="${(info.changePct || 0) >= 0 ? 'hl' : 'hl-dn'}">${pct(info.changePct)}</span>`], ['价格来源', esc(info.srcLabel || '—')]])
        : '<div class="dw-empty">取不到实时行情</div>')
      + `<div class="dw-note">本推荐由规则引擎按当档数据自动生成，<b>不构成投资建议</b>。是否买卖、买多少，由你自行判断。</div>`,
  };
}

// ────────────────────────── 详情抽屉（复用 app.js 的 #drawer） ──────────────────────────

function drawerEl() { return document.getElementById('drawer'); }
let PAPER_STACK = [];

function dwSection(h, body) { return `<div class="dw-sec"><div class="dw-h">${esc(h)}</div>${body}</div>`; }
function dwKv(pairs) {
  return `<div class="dw-kv">${pairs.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${v}</div>`).join('')}</div>`;
}

function openPaperDrawer(v) {
  const d = drawerEl();
  if (!d || !v) return;
  document.getElementById('dwTitle').innerHTML = v.title || '';
  document.getElementById('dwSub').innerHTML = v.sub || '';
  document.getElementById('dwBody').innerHTML = v.body || '';
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  document.getElementById('drawerMask')?.classList.add('open');
}

// 各个详情

function statDetail(k) {
  const st = accountStats(ACCT);
  const common = [['初始资金', `${st.initCash.toLocaleString()} 元（虚拟）`], ['当前总资产', `${num(st.total)} 元`]];
  const M = {
    总资产: {
      pairs: [...common, ['构成', `可用 ${num(st.cash)} + 冻结 ${num(st.freeze)} + 市值 ${num(st.marketValue)}`],
        ['恒等式', `总资产 − 初始 = 已实现 ${num(st.realized)} + 浮动 ${num(st.floatPnl)}`]],
      note: '市值按最新真实收盘价计；冻结来自未成交的买入委托。',
    },
    可用资金: { pairs: [...common, ['可用', `${num(st.cash)} 元`], ['冻结中', `${num(st.freeze)} 元`]], note: '买入挂单会预冻结资金（今收价 + 费用），撤单或成交后释放。' },
    冻结资金: { pairs: [...common, ['冻结', `${num(st.freeze)} 元`], ['来源', `${(ACCT.pending || []).filter((p) => p.side === 'buy').length} 张待成交买单`]], note: '真实券商的同一行为：委托提交即冻结，成交时按实际价结算。' },
    持仓市值: { pairs: [...common, ['市值', `${num(st.marketValue)} 元`], ['持仓成本', `${num(st.costValue)} 元`], ['持仓数', `${st.posCount} 只`]], note: '取不到最新行情的票沿用上一价并标「旧价」，不会归零。' },
    浮动盈亏: { pairs: [...common, ['浮动盈亏', `${num(st.floatPnl)} 元`], ['幅度', pct(st.floatPnlPct * 100)]], note: '＝最新市值 − 持仓成本；成本含买入时的佣金与过户费，所以「平价卖出」也是亏的。' },
    已实现盈亏: { pairs: [...common, ['已实现', `${num(st.realized)} 元`]], note: '清仓或部分卖出时结转：卖出净收入（扣佣金/过户费/印花税）− 对应股份的持仓成本。' },
    累计费用: {
      pairs: [...common, ['累计', `${num(st.totalFee)} 元`], ['占初始资金', pct(st.totalFee / st.initCash * 100)],
        ['佣金费率', `万三（单笔最低 ${MIN_COMMISSION} 元）`], ['过户费', '万0.1（双边）'], ['印花税', '万五（仅卖出）'], ['滑点', `万${SLIP * 1e4}（买入抬价 / 卖出压价）`]],
      note: '滑点是模拟的冲击成本，不进入「累计费用」（它不是付给券商的费用，而是成交价的让价）。',
    },
    账户收益率: { pairs: [...common, ['收益率', pct(st.retPct)], ['绝对收益', `${num(st.total - st.initCash)} 元`]], note: '＝（总资产 − 初始资金）÷ 初始资金。' },
  };
  const d = M[k];
  if (!d) return null;
  return { title: `账户指标 · ${k}`, sub: `数据日 ${LAST_DATE || '—'} · 全部按真实行情与 A 股现行制度计算`, body: dwSection('口径', dwKv(d.pairs)) + `<div class="dw-note">${d.note}</div>` };
}

function posDetail(code) {
  const p = ACCT.positions?.[code];
  if (!p) return null;
  const info = lookup(code);
  const mv = (p.last ?? p.avgCost) * p.qty;
  const pnl = mv - (p.cost || 0);
  const frozen = (ACCT.pending || []).filter((x) => x.code === code && x.side === 'sell').reduce((a, x) => a + x.qty, 0);
  const trades = (ACCT.trades || []).filter((t) => t.code === code);
  const buyGross = trades.filter((t) => t.side === 'buy').reduce((a, t) => a + t.gross, 0);
  const buyFee = trades.filter((t) => t.side === 'buy').reduce((a, t) => a + t.fee, 0);
  return {
    title: `${esc(p.name || code)}　${esc(code)}`,
    sub: `持仓 ${p.qty} 股 · 成本 ${num(p.avgCost, 3)} · 现价 ${num(p.last)} · 浮动 ${num(pnl)}`,
    body: dwSection('持仓明细', dwKv([
      ['代码 / 名称', `${esc(code)} ${esc(p.name || '')}`],
      ['板段 / 涨跌停', `${esc(info?.board?.label || '—')} ±${info?.limitPct != null ? (info.limitPct * 100).toFixed(0) : '—'}%${info?.st ? '（ST）' : ''}`],
      ['持仓数量', `${p.qty} 股`],
      ['可卖数量', `${Math.max(0, (p.avail || 0) - frozen)} 股${frozen ? `（另有 ${frozen} 股被卖单冻结）` : ''}`],
      ['T+1 说明', (p.avail || 0) < p.qty
        ? `<span class="bf-warn">${p.qty - (p.avail || 0)} 股为当日买入，次一交易日可卖</span>`
        : '全部可卖'],
      ['加权平均成本', `${num(p.avgCost, 4)} 元（含买入费用）`],
      ['持仓总成本', `${num(p.cost)} 元`],
      ['最新价', `${num(p.last)} 元${p.pxStale ? ' <span class="bf-warn">（最近一档无行情，沿用上一价）</span>' : ''}`],
      ['市值', `${num(mv)} 元`],
      ['浮动盈亏', `<span class="${cls(pnl)}">${num(pnl)} 元（${pct(p.cost ? pnl / p.cost * 100 : 0)}）</span>`],
      ['建仓日 / 持有', `${esc(p.openDate || '—')} · ${p.days || 0} 个交易日`],
    ]))
      + dwSection('买入成本构成', dwKv([
        ['累计买入金额', `${num(buyGross)} 元`],
        ['累计买入费用', `${num(buyFee)} 元`],
        ['费用占比', buyGross ? pct(buyFee / buyGross * 100, 3) : '—'],
      ]) + `<div class="dw-note">成本 = 买入金额 + 买入费用；因此把持仓按成本价卖出仍是亏的（还要再扣一遍卖出费用与印花税）。</div>`)
      + (trades.length ? dwSection('该股成交记录',
        `<table class="dw-tb"><thead><tr><th>成交日</th><th>方向</th><th class="num">数量</th><th class="num">价格</th><th class="num">费用</th></tr></thead><tbody>`
        + trades.map((t) => `<tr><td>${esc(t.fillDate)}</td><td class="${t.side === 'buy' ? 'hl' : 'hl-dn'}">${t.side === 'buy' ? '买入' : '卖出'}</td>`
          + `<td class="num">${t.qty}</td><td class="num">${num(t.price)}</td><td class="num">${num(t.fee)}</td></tr>`).join('')
        + '</tbody></table>') : '')
      + `<div class="dw-note">模拟器不提供自动交易：买卖一律由你决定，引擎只负责按真实制度撮合与记账。</div>`,
  };
}

function pendingDetail(id) {
  const p = (ACCT.pending || []).find((x) => x.id === id);
  if (!p) return null;
  const info = lookup(p.code);
  return {
    title: `待成交委托 #${p.id}`,
    sub: `${p.side === 'buy' ? '买入' : '卖出'} ${esc(p.name || p.code)} ${p.qty} 股 · 提交于 ${p.submitDate}`,
    body: dwSection('委托详情', dwKv([
      ['代码 / 名称', `${esc(p.code)} ${esc(p.name || '')}`],
      ['方向 / 数量', `${p.side === 'buy' ? '买入' : '卖出'} ${p.qty} 股`],
      ['提交日', esc(p.submitDate || '—')],
      ['提交时价', `${num(p.submitPrice)} 元<span class="muted">（下单瞬间的真实行情）</span>`],
      ['预估成交价', `${num(p.estPrice)} 元（含滑点）`],
      ['冻结金额', `${num(p.need)} 元`],
      ['撮合规则', '次一交易日按该日<b>真实收盘价</b>成交'],
    ]))
      + dwSection('可能失效的情形', `<div class="dw-note">
        · 次日<b>涨停</b>（买单）或<b>跌停</b>（卖单）→ 无对手盘，委托失效并释放冻结<br>
        · 次日价格跳空导致<b>资金不足</b> → 委托失效（不会透支）<br>
        · 次日该股<b>无真实行情</b> → 委托失效并释放冻结<br>
        以上都是真实交易里会遇到的情况，不是系统故障。</div>`)
      + `<div class="dw-note">点抽屉底部「撤销委托」或列表里的撤单按钮可立即释放冻结。</div>`,
  };
}

function histDetail(view, i) {
  const t = (view === 'trade' ? ACCT.trades : ACCT.orders)?.[i];
  if (!t) return null;
  const isTrade = view === 'trade';
  const px = isTrade ? t.price : (t.fillPrice ?? t.estPrice);
  const gross = isTrade ? t.gross : (t.gross ?? (px ? Math.round(px * t.qty * 100) / 100 : null));
  const f = gross ? fees(gross, t.side) : null;
  return {
    title: isTrade ? `成交详情 · ${esc(t.name || t.code)}` : `委托 #${t.id} · ${statusText(t)}`,
    sub: `${t.side === 'buy' ? '买入' : '卖出'} ${t.qty} 股 · ${esc(t.code)} · ${esc(isTrade ? t.fillDate : t.submitDate)}`,
    body: (t.status && t.status !== 'filled' && !isTrade
      ? dwSection('结果', dwKv([['状态', statusTag(t)], ['原因', esc(t.reject || '—')], ['说明', esc(t.detail || '—')]]))
      : '')
      + dwSection('价格与金额', dwKv([
        ['委托价（提交日收盘）', `${num(t.submitPrice)} 元`],
        ['成交价', `${num(px)} 元`],
        ['价格漂移', t.driftPct != null
          ? `<span class="${cls(t.driftPct)}">${pct(t.driftPct)}</span>（T+1 撮合的必然结果：下单时只能看到今收）`
          : '—'],
        ['成交金额', gross ? `${num(gross)} 元` : '—'],
        ['滑点', `万${SLIP * 1e4}（买入抬价 / 卖出压价）`],
      ]))
      + (f ? dwSection('费用明细（按真实费率重算，可与账本核对）', dwKv([
        ['佣金', `${num(f.comm)} 元（万三，最低 ${MIN_COMMISSION} 元）`],
        ['过户费', `${num(f.transfer)} 元（万0.1）`],
        ['印花税', `${num(f.stamp)} 元${t.side === 'buy' ? '（买入不收）' : '（万五，仅卖出）'}`],
        ['费用合计', `<b>${num(f.total)} 元</b>`],
        ['账本记账费用', t.fee != null ? `${num(t.fee)} 元 ${Math.abs(t.fee - f.total) < 0.02 ? '✓ 一致' : '<span class="bf-warn">✗ 与重算不一致</span>'}` : '—'],
      ])) : '')
      + `<div class="dw-note">说明：${esc(t.reason || '手动下单')}。成交由引擎按 T+1 规则撮合，费用按 A 股现行费率逐笔计价。</div>`,
  };
}

function perfDetail(k) {
  const nav = (ACCT.nav || []).map((r) => r.equity);
  if (nav.length < 2) return null;
  const m = paperMetrics(nav);
  return {
    title: `账户绩效 · ${k}`,
    sub: `${m.days} 个交易日 · 区间收益 ${pct(m.total * 100)} · 最大回撤 ${pct(-m.ddPct)}`,
    body: dwSection('全部指标', dwKv([
      ['样本交易日', `${m.days} 日（${esc(ACCT.nav[0].date)} ~ ${esc(ACCT.nav[ACCT.nav.length - 1].date)}）`],
      ['区间总收益', `<span class="${cls(m.total)}">${pct(m.total * 100)}</span>`],
      ['年化收益', pct(m.annual * 100)],
      ['最大回撤', pct(-m.ddPct)],
      ['夏普比率', num(m.sharpe)],
      ['日胜率', pct(m.winRate * 100)],
      ['最新净值', `${num(nav[nav.length - 1])} 元`],
    ]))
      + dwSection('净值序列', `<table class="dw-tb"><thead><tr><th>交易日</th><th class="num">净值</th><th class="num">现金</th><th class="num">市值</th><th class="num">日变动</th></tr></thead><tbody>`
        + ACCT.nav.slice(-20).reverse().map((r, idx, arr) => {
          const prev = ACCT.nav[ACCT.nav.length - 1 - idx - 1];
          const chg = prev ? (r.equity / prev.equity - 1) * 100 : null;
          return `<tr><td>${esc(r.date)}</td><td class="num">${num(r.equity)}</td><td class="num">${num(r.cash)}</td>`
            + `<td class="num">${num(r.marketValue)}</td><td class="num ${cls(chg)}">${chg == null ? '—' : pct(chg)}</td></tr>`;
        }).join('')
        + '</tbody></table>')
      + `<div class="dw-note">指标定义与 <b>src/backtest.js</b> metrics() 一致（年化 252、回撤按峰值、夏普按日收益标准差）。`
      + `样本仅 ${m.days} 个交易日，年化/夏普的统计意义有限。</div>`,
  };
}

// ────────────────────────── 事件 ──────────────────────────

async function submit() {
  const info = ORDER.code ? lookup(ORDER.code) : null;
  if (!info) { msg('请先输入 6 位股票代码', 'err'); return; }
  if (!ORDER.qty) { msg('请填写委托数量', 'err'); return; }
  // 下单前实时校验一次价格：用户可能是几分钟前输入的代码，价格已经变了。
  // 这是「按实时真实价格买卖」的必要动作——用陈旧价算出来的冻结金额会不准。
  if (!LIVEQ[info.code]) {
    msg(`正在获取 ${info.code} 最新行情…`, 'ok');
    await refreshLive([info.code]);
    const fresh = lookup(ORDER.code);
    if (!fresh || !fresh.fresh) {
      msg(`${info.code} 取不到行情（实时源无此代码或已停牌），无法下单；已有持仓仍可卖出`, 'err');
      renderOrderForm();
      return;
    }
    Object.assign(info, fresh);
    renderOrderForm();
  }
  const q = { code: info.code, name: info.name, price: info.price, changePct: info.changePct };
  const r = submitOrder(ACCT, { code: info.code, side: ORDER.side, qty: ORDER.qty, slip: SLIP }, q, { date: LAST_DATE });
  ACCT = r.next;
  save();
  renderAllPaper();
  syncOrderInputs();
  if (r.order.status === 'rejected') {
    msg(`委托被拒：${r.order.reject}${r.order.detail ? '（' + r.order.detail + '）' : ''}`, 'err');
  } else {
    const pxSrc = info.src === 'live' ? `按${info.srcLabel} ${num(info.price)} 元` : `按${info.srcLabel || '行情'} ${num(info.price)} 元`;
    msg(`${ORDER.side === 'buy' ? '买入' : '卖出'} ${info.name || info.code} ${ORDER.qty} 股已挂单（${pxSrc}预估冻结），将于下一交易日按真实收盘价撮合`, 'ok');
  }
}

function cancel(id) {
  const r = cancelOrder(ACCT, id);
  if (!r.ok) { msg(r.error, 'err'); return; }
  ACCT = r.next;
  save();
  renderAllPaper();
  msg(`委托 #${id} 已撤销，冻结资金已释放`, 'ok');
}

/**
 * 一键空仓：把全部持仓按各自「可卖数量」逐票挂卖单。
 *
 * 诚实边界：T+1 下当日买入的股份不可卖，必然有票卖不掉。这里**不伪造、不排队等解冻**，
 * 而是把不能卖的部分明确跳过，并在结果里逐条列出原因——用户需要知道"哪些没卖掉、为什么"，
 * 否则会误以为已经空仓了。
 *
 * 卖价一律取**实时价**（与单票下单同一口径）；取不到价的标的跳过并说明。
 */
async function closeAll() {
  const positions = Object.values(ACCT?.positions || {});
  if (!positions.length) { msg('当前无持仓，无需空仓', 'ok'); return; }
  const frozenOf = (code) => (ACCT.pending || [])
    .filter((x) => x.code === code && x.side === 'sell').reduce((a, x) => a + x.qty, 0);

  // 先把所有要卖的代码抓一次实时价（与单票下单同源，避免用陈旧价挂单）
  await refreshLive(positions.map((p) => p.code));

  const sold = [];      // 成功挂单
  const skipped = [];   // 未挂单（附原因）
  for (const p of positions) {
    const free = Math.max(0, (p.avail || 0) - frozenOf(p.code));
    if (free <= 0) {
      const why = (p.qty > 0 && (p.avail || 0) === 0) ? '当日买入，T+1 未解冻' : (frozenOf(p.code) > 0 ? '已全部挂卖单' : '可卖数量为 0');
      skipped.push(`${p.name || p.code}：${why}`);
      continue;
    }
    const info = lookup(p.code);
    if (!info || !info.fresh || !Number.isFinite(+info.price) || +info.price <= 0) {
      skipped.push(`${p.name || p.code}：取不到实时行情，无法挂单`);
      continue;
    }
    const q = { code: info.code, name: info.name, price: info.price, changePct: info.changePct };
    const r = submitOrder(ACCT, { code: p.code, side: 'sell', qty: free, slip: SLIP }, q, { date: LAST_DATE });
    if (r.order.status === 'rejected') {
      skipped.push(`${p.name || p.code}：${r.order.reject}${r.order.detail ? '（' + r.order.detail + '）' : ''}`);
      continue;
    }
    ACCT = r.next;
    sold.push(`${p.name || p.code} ${free} 股`);
  }
  save();
  renderAllPaper();
  syncPositionsLive();

  if (sold.length && !skipped.length) {
    msg(`已按实时价挂出卖单：${sold.join('、')}（下一交易日按真实收盘价撮合）`, 'ok');
  } else if (sold.length && skipped.length) {
    msg(`已挂卖 ${sold.length} 只：${sold.join('、')}；未挂 ${skipped.length} 只 —— ${skipped.join('；')}`, 'warn');
  } else {
    msg(`未能挂出任何卖单 —— ${skipped.join('；')}`, 'err');
  }
}

function reset() {
  if (!window.confirm('重置账户将清空全部持仓、成交与委托记录，且不可恢复。确定继续？')) return;
  ACCT = emptyAccount(INIT_CASH, LAST_DATE);
  if (LAST_DATE) {
    ACCT = { ...ACCT, nav: [{ date: LAST_DATE, equity: INIT_CASH, cash: INIT_CASH, marketValue: 0 }] };
  }
  save();
  renderAllPaper();
  msg('账户已重置为 ' + INIT_CASH.toLocaleString() + ' 元虚拟资金', 'ok');
}

function doExport() {
  const text = exportAccount(ACCT);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `paper-account-${LAST_DATE || 'unknown'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  msg('账本已导出（可用于离线核验或迁移到另一台设备）', 'ok');
}

function doImport() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const r = importAccount(String(rd.result || ''));
      if (!r.ok) { msg('导入被拒绝：' + r.error, 'err'); return; }
      ACCT = r.account;
      persistRaw(ACCT);
      renderAllPaper();
      msg('账本已导入', 'ok');
    };
    rd.readAsText(f);
  };
  inp.click();
}

/**
 * 用**实时行情**结算当日挂单（T+1 撮合的「次日」到了）。
 *
 * 与旧的「按存档日补齐」的区别：
 *   · 存档日只在收盘后（当晚 ~18:30）才生成，若用户当天盘中/收盘后想结算，存档里还没有今天 ——
 *     旧逻辑会提示「已是最新，无需结算」，委托卡在那里动不了。
 *   · 实时源随时能拿到「今天」的真实价，所以「今天」也可以作为结算日。
 *
 * 结算价仍取**真实价格**（盘中=最新价，收盘后=当日收盘价），不是模拟价。
 * @param {string} [date] 结算日（默认：今天，北京时间）
 * @returns {Promise<{ok:boolean, date?:string, filled?:number, expired?:number, reason?:string}>}
 */
async function settleByLive(date) {
  const pending = ACCT?.pending || [];
  if (!pending.length) return { ok: false, reason: '当前没有待成交委托' };
  const today = date || bjToday();
  if (ACCT.lastSettle && today <= ACCT.lastSettle) {
    return { ok: false, reason: `今日（${today}）已结算过，下一交易日再结算` };
  }
  // 只抓「待成交委托」涉及的代码——不为了结算去抓全市场
  const codes = normalizeCodes(pending.map((p) => p.code));
  const r = await refreshLive(codes);
  if (!r.ok) return { ok: false, reason: '取不到实时行情，无法结算（请稍后重试）' };

  const quotes = {};
  for (const c of codes) {
    const q = LIVEQ[c];
    if (q && Number.isFinite(+q.price)) quotes[c] = { code: c, name: q.name, price: +q.price, changePct: q.changePct ?? null, src: 'live' };
  }
  const res = settleDay(ACCT, today, quotes);
  ACCT = res.account;
  save();
  renderAllPaper();
  return { ok: true, date: today, filled: res.fills.length, expired: res.expired.length };
}

/** 北京时间「今天」的 YYYY-MM-DD（结算日/行情日期一律用北京时间，与行情源一致） */
function bjToday() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return d.toISOString().slice(0, 10);
}

/** 行情抓取时刻的简短展示（HH:MM:SS，24 小时制本地时间） */
function fmtClock(d) {
  const t = new Date(d);
  if (isNaN(t)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

function settleNow() {
  // 先试「按今天实时价结算」；没有待成交委托或今天已结算，则回退到「按存档日补齐」
  settleByLive().then((r) => {
    if (r.ok) {
      msg(`结算完成（${r.date} 实时价）：成交 ${r.filled} 笔、失效 ${r.expired} 笔`, 'ok');
      return;
    }
    fetch('./data/archive.json?_=' + Date.now(), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
      .then((arc) => {
        const days = arc.all_days || [];
        const todo = days.filter((d) => d.trade_date > (ACCT.lastSettle || ''));
        if (!todo.length) { msg(r.reason || '已是最新，无需结算', 'ok'); return; }
        let cur = ACCT, filled = 0, expired = 0;
        for (const d of todo) { const rr = settleDay(cur, d.trade_date, quotesFromDay(d)); cur = rr.account; filled += rr.fills.length; expired += rr.expired.length; }
        ACCT = cur;
        QMAP = { ...QMAP, ...quotesFromDay(days[days.length - 1]) };
        LAST_DATE = days[days.length - 1].trade_date;
        save();
        renderAllPaper();
        msg(`结算完成（存档日）：成交 ${filled} 笔、失效 ${expired} 笔`, 'ok');
      })
      .catch((e) => msg('结算失败：' + e.message, 'err'));
  });
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;

  const sideBtn = t.closest('#poSide button');
  if (sideBtn) { ORDER = { ...ORDER, side: sideBtn.dataset.side, qty: 0 }; syncOrderInputs(); renderOrderForm(); renderQuick(); return; }

  const tab = t.closest('#paperTabs button');
  if (tab) {
    HIST = { view: tab.dataset.view };
    document.querySelectorAll('#paperTabs button').forEach((b) => {
      const on = b.dataset.view === HIST.view;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderHist();
    return;
  }

  const el = t.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'pqty') {
    ORDER = { ...ORDER, qty: +el.dataset.qty || 0 };
    syncOrderInputs();
    renderOrderForm();
    return;
  }
  if (act === 'pcancel') { e.stopPropagation(); cancel(+el.dataset.id); return; }
  if (act === 'pstat') { openPaperDrawer(statDetail(el.dataset.k)); return; }
  if (act === 'ppos') { openPaperDrawer(posDetail(el.dataset.code)); return; }
  if (act === 'ppend') { openPaperDrawer(pendingDetail(+el.dataset.id)); return; }
  if (act === 'phist') { openPaperDrawer(histDetail(el.dataset.view, +el.dataset.i)); return; }
  if (act === 'pperf') { openPaperDrawer(perfDetail(el.dataset.k)); return; }
  // 研判推荐：点「填入下单」只填不提交（绝不替用户下单）；点整行看详情
  if (act === 'pick-fill') { e.stopPropagation(); fillPickToOrder(el.dataset.code); return; }
  if (act === 'pick') { openPaperDrawer(pickDetail(el.dataset.code)); return; }
  // 交易预警：同上——「填入卖出」只填代码与建议数量，点整行看触发依据
  if (act === 'alert-fill') { e.stopPropagation(); fillAlertToOrder(+el.dataset.i); return; }
  if (act === 'alert') { openPaperDrawer(alertDetail(+el.dataset.i)); return; }
  // 战绩格子：点开逐条归因明细（含「触发价 → 今日价 → 差额」的完整链路）
  if (act === 'attr-detail') { openPaperDrawer(attrDetail()); return; }
});

// 输入满 6 位就抓实时行情（防抖 250ms，避免边打字边发请求）。
// 这是「全市场任意 A 股都能下单」得以成立的入口：不再要求代码先出现在标的池里。
let codeTimer = null;
$('poCode')?.addEventListener('input', (e) => {
  const v = String(e.target.value || '').replace(/\D/g, '').slice(0, 6);
  e.target.value = v;
  ORDER = { ...ORDER, code: v, qty: 0 };
  renderOrderForm();
  renderQuick();
  if (codeTimer) clearTimeout(codeTimer);
  if (v.length === 6) {
    codeTimer = setTimeout(async () => {
      // 已有同代码实时价则不必重复请求；抓取期间先给个提示，避免用户以为卡住
      if (!LIVEQ[v] && !LIVE_BUSY) {
        msg(`正在获取 ${v} 实时行情…`, 'ok');
        const r = await refreshLive([v]);
        renderOrderForm();
        renderQuick();
        if (r.ok) {
          const q = LIVEQ[v];
          msg(`已获取 ${v} ${q?.name || ''} 实时行情`, 'ok');
        } else {
          msg(`${v} 取不到行情（请核对代码是否正确 / 是否停牌）`, 'err');
        }
      } else if (LIVEQ[v]) {
        renderOrderForm();
        renderQuick();
      }
    }, 250);
  }
});
$('poQty')?.addEventListener('input', (e) => {
  ORDER = { ...ORDER, qty: Math.max(0, Math.floor(+e.target.value || 0)) };
  renderOrderForm();
});
$('poSubmit')?.addEventListener('click', submit);
$('paperReset')?.addEventListener('click', reset);
$('paperExport')?.addEventListener('click', doExport);
$('paperImport')?.addEventListener('click', doImport);
$('paperSettle')?.addEventListener('click', settleNow);
// 一键空仓：先确认（会一次性挂出多笔卖单，误点代价大）
$('paperCloseAll')?.addEventListener('click', () => {
  const n = Object.keys(ACCT?.positions || {}).length;
  if (!n) { msg('当前无持仓，无需空仓', 'ok'); return; }
  if (!window.confirm(`将对 ${n} 只持仓全部挂出卖单（按各自可卖数量、按实时价）。\nT+1 下当日买入的股份卖不掉，会如实告知。\n\n确定继续？`)) return;
  closeAll();
});

// 键盘快捷键 6 跳转到模拟交易（与 app.js 的 1-5 互补；app.js 只认 1-5，故不冲突）
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '6') {
    const z = document.getElementById('zone-paper');
    if (z) { e.preventDefault(); z.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
});

boot();
