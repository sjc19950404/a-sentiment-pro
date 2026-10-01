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
  LIMIT_PCT, isLimitHit,
} from './src/paper.js';

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
const INIT_CASH = 1000000;
const SLIP = DEFAULT_SLIP;

let ACCT = null;          // 当前账户
let UNI = null;           // 标的池
let UNI_META = {};
let QMAP = {};            // 当日可成交行情 code → quote
let LAST_DATE = null;     // 存档最新交易日
let ORDER = { side: 'buy', code: '', qty: 0 };
let HIST = { view: 'trade' };

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

function msg(text, kind) {
  const el = $('paperMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = kind === 'err' ? 'hl-dn' : kind === 'ok' ? 'hl' : 'muted';
  if (text) setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'muted'; } }, 6000);
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
    const last = days[days.length - 1] || {};
    LAST_DATE = last.trade_date || null;
    QMAP = quotesFromDay(last);

    // 账户：优先本地账本；没有则新建（起始日 = 存档最新交易日）
    ACCT = load() || emptyAccount(INIT_CASH, LAST_DATE);
    // 若本地账户落后于存档（比如隔了一天），自动补结算到最后可用的存档日
    autoCatchUp(days);

    if (sub) {
      sub.textContent = `仅初始资金为虚拟（${INIT_CASH.toLocaleString()} 元）· 行情截至 ${LAST_DATE || '--'}`
        + ` · 标的池 ${UNI_META.total || 0} 只（当日有价 ${UNI_META.fresh || 0} 只）· 规则对齐 A 股现行制度`;
    }
    renderAllPaper();
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

/** 综合标的池与当日行情，给出一只票的完整可交易状态 */
function lookup(code) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return null;
  const b = boardOf(c);
  const u = UNI?.[c] || null;
  const q = QMAP[c] || null;
  const name = q?.name || u?.name || '';
  return {
    code: c,
    name,
    board: b,
    st: isStName(name),
    limitPct: limitPctOf(c, name),
    // 当日真实收盘价（可撮合）；没有就是没有，绝不用历史价冒充当日价
    price: q?.price ?? null,
    changePct: q?.changePct ?? null,
    quoteDate: q ? LAST_DATE : (u?.asOf || null),
    fresh: !!q,
    history: u,
    inUniverse: !!u,
  };
}

// ────────────────────────── 渲染：账户 ──────────────────────────

function renderAllPaper() {
  renderStats();
  renderPositions();
  renderPending();
  renderHist();
  renderPerf();
  renderOrderForm();
  renderQuick();
}

function renderStats() {
  const box = $('paperStats');
  if (!box) return;
  const st = accountStats(ACCT);
  const rows = [
    ['总资产', num(st.total), '', `现金 + 冻结 + 持仓市值`, 'stat-total'],
    ['可用资金', num(st.cash), '', '可用于新开仓', ''],
    ['冻结资金', num(st.freeze), '', '买入挂单占用，撤单/成交后释放', ''],
    ['持仓市值', num(st.marketValue), '', '按最新真实收盘价计', ''],
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
    const stale = rows.filter((x) => x.p.pxStale).map((x) => x.p.code);
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
      qbox.textContent = '输入代码后显示当日真实行情与可交易性';
    } else if (!info || !info.board.tradable) {
      qbox.className = 'po-quote bad';
      qbox.textContent = info ? `${ORDER.code}：${info.board.label} —— 模拟器不纳入此类品种` : `${ORDER.code}：代码格式非法（需 6 位数字）`;
    } else {
      const hit = isLimitHit(info.changePct, info.code, info.name);
      qbox.className = 'po-quote';
      qbox.innerHTML = `<b>${esc(info.name || '（名称未知）')}</b> <span class="muted">${esc(info.code)}</span>`
        + `<span class="gtag">${esc(info.board.label)}</span>${info.st ? '<span class="gtag n">ST</span>' : ''}`
        + `<span class="gtag">±${(info.limitPct * 100).toFixed(0)}%</span>`
        + (info.fresh
          ? `<div class="pq-line">当日收盘 <b>${num(info.price)}</b> 元 <span class="${cls(info.changePct)}">${pct(info.changePct)}</span>`
            + (hit === 'up' ? ' <span class="gtag d">涨停</span>' : hit === 'down' ? ' <span class="gtag u">跌停</span>' : '')
            + `<span class="muted"> · ${esc(info.quoteDate)}</span></div>`
          : `<div class="pq-line bf-warn">${esc(info.quoteDate || '—')} 之后无真实行情，不可下单（持仓仍可卖出）</div>`);
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
          <tr><td>预估成交价</td><td class="num">${num(px)} 元 <span class="muted">（今收 ${num(info.price)} ${ORDER.side === 'buy' ? '+' : '−'} 滑点 ${SLIP * 1e4}‱）</span></td></tr>
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
      + ` · 买入须 ${LOT} 股整数倍 · 可用 ${num(ACCT.cash)} 元`;
  }
}

/** 下一可撮合日：存档最新日之后的下一个交易日（用 config 的节假日口径在 UI 侧复算） */
function nextSessionLabel() {
  if (!LAST_DATE) return '—';
  const d = new Date(LAST_DATE + 'T00:00:00Z');
  for (let i = 0; i < 30; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w === 0 || w === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (HOLIDAYS.has(iso)) continue;
    return iso + '（存档尚未包含该日，届时自动结算）';
  }
  return '—';
}
// 与 src/config.js manualHolidays 同源（该文件的默认导出在浏览器里不易直接 import，故并列一份）
const HOLIDAYS = new Set([
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
]);

function renderQuick() {
  const box = $('poQuick');
  if (!box) return;
  const info = ORDER.code ? lookup(ORDER.code) : null;
  const canSize = info && info.board.tradable && info.fresh && info.price;
  if (ORDER.side === 'sell') {
    const pos = ACCT.positions?.[ORDER.code];
    if (!pos) { box.innerHTML = '<span class="muted">该股无持仓</span>'; return; }
    const frozen = (ACCT.pending || []).filter((x) => x.code === ORDER.code && x.side === 'sell').reduce((a, x) => a + x.qty, 0);
    const free = Math.max(0, (pos.avail || 0) - frozen);
    box.innerHTML = `<span class="muted">可卖 ${free} 股：</span>`
      + [['1/4', Math.floor(free / 4 / LOT) * LOT], ['1/2', Math.floor(free / 2 / LOT) * LOT], ['全部', free]]
        .filter(([, v]) => v > 0)
        .map(([lab, v]) => `<button class="mini" type="button" data-act="pqty" data-qty="${v}">${lab}（${v}）</button>`).join('');
    return;
  }
  if (!canSize) { box.innerHTML = '<span class="muted">填入有效代码后可按金额快速估算数量</span>'; return; }
  const px = fillPrice(info.price, 'buy', SLIP);
  box.innerHTML = ['1 万', '5 万', '10 万', '全仓'].map((lab) => {
    const amt = lab === '全仓' ? ACCT.cash : parseFloat(lab) * 1e4;
    const lots = Math.floor(amt / (px * LOT));
    return { lab, qty: Math.max(0, lots) * LOT };
  }).filter((x) => x.qty > 0)
    .map(({ lab, qty }) => `<button class="mini" type="button" data-act="pqty" data-qty="${qty}">${lab}</button>`).join('');
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
      ['提交时价', `${num(p.submitPrice)} 元（存档 ${esc(LAST_DATE)} 收盘）`],
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

function submit() {
  const info = ORDER.code ? lookup(ORDER.code) : null;
  if (!info) { msg('请先输入 6 位股票代码', 'err'); return; }
  if (!ORDER.qty) { msg('请填写委托数量', 'err'); return; }
  if (!info.fresh) { msg(`${info.code} 在 ${LAST_DATE} 无真实行情（最新报价 ${info.quoteDate || '—'}），无法下单`, 'err'); return; }
  const q = { code: info.code, name: info.name, price: info.price, changePct: info.changePct };
  const r = submitOrder(ACCT, { code: info.code, side: ORDER.side, qty: ORDER.qty, slip: SLIP }, q, { date: LAST_DATE });
  ACCT = r.next;
  save();
  renderAllPaper();
  syncOrderInputs();
  if (r.order.status === 'rejected') {
    msg(`委托被拒：${r.order.reject}${r.order.detail ? '（' + r.order.detail + '）' : ''}`, 'err');
  } else {
    msg(`${ORDER.side === 'buy' ? '买入' : '卖出'} ${info.name || info.code} ${ORDER.qty} 股已挂单，将于下一交易日按真实收盘价撮合`, 'ok');
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

function settleNow() {
  fetch('./data/archive.json?_=' + Date.now(), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((arc) => {
      const days = arc.all_days || [];
      const todo = days.filter((d) => d.trade_date > (ACCT.lastSettle || ''));
      if (!todo.length) { msg('已是最新，无需结算', 'ok'); return; }
      let cur = ACCT, filled = 0, expired = 0;
      for (const d of todo) { const r = settleDay(cur, d.trade_date, quotesFromDay(d)); cur = r.account; filled += r.fills.length; expired += r.expired.length; }
      ACCT = cur;
      QMAP = { ...QMAP, ...quotesFromDay(days[days.length - 1]) };
      LAST_DATE = days[days.length - 1].trade_date;
      save();
      renderAllPaper();
      msg(`结算完成：成交 ${filled} 笔、失效 ${expired} 笔`, 'ok');
    })
    .catch((e) => msg('结算失败：' + e.message, 'err'));
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
});

$('poCode')?.addEventListener('input', (e) => {
  const v = String(e.target.value || '').replace(/\D/g, '').slice(0, 6);
  e.target.value = v;
  ORDER = { ...ORDER, code: v, qty: 0 };
  renderOrderForm();
  renderQuick();
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
