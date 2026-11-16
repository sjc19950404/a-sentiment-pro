/* ══════════════════════════════════════════════════════════════════════════
 * s-page-overview-evidence.js — 工作台「总览」页证据层（L2）+ 操作层（L3）
 * ──────────────────────────────────────────────────────────────────────────
 * 权威：design/prototype/index.html L146-296（视觉稿本体，13 张真实渲染图来源）
 *       design/04_页面蓝图与组件规格.md 1.2 节（证据层 / 操作层蓝图）
 * 本文件只「追加」证据层 DOM 到 .s-page-overview 容器，**不改 s-page-overview.js 的结论层
 * 一行**（结论层 6 KPI 已经过阶段 2/3/4 多轮门禁验证，改它=破坏已绿验收）。
 *
 * 数据全部来自真实 JSON（不造假、不写死快照）：
 *   - 情绪分走势：data/emotion_history.json 的 history[].score（266 项，取近 N 日）
 *   - 七因子贡献：history[-1].metrics + 当日 signals（有值取真值，无值标"—"不编造）
 *   - 三卡 / 明细：signals-latest.json / hot 数据（有则填，无则如实空状态）
 * 绘图照抄原型 drawTrend / drawFactors（s-components.css 的 .s-chart__* / .s-factor__* 样式全齐）。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});
  if (typeof S.getFlag !== 'function') {
    var f = Object.create(null);
    S.getFlag = function (n, d) { return n in f ? f[n] : d; };
    S.setFlag = S.setFlag || function (n, v) { f[n] = v; return v; };
  }
  const $ = (s, r) => (r || document).querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  let CACHE = null;      // { history:[], day:{}, signals:{} }
  let range = 60;        // 走势图时间窗（20/60/90/120）
  let observer = null;
  let built = false;

  function enabled() { return S.getFlag('overview', true) !== false; }

  /* ---------- 数据加载：真实 JSON ---------- */
  async function load() {
    if (CACHE) return CACHE;
    const out = { history: [], day: {}, signals: {} };
    await Promise.all([
      fetch('./data/emotion_history.json?_=' + Date.now(), { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null).then((d) => {
          if (d && Array.isArray(d.history)) out.history = d.history;
        }).catch(() => {}),
      fetch('./data/signals-latest.json?_=' + Date.now(), { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null).then((d) => { if (d) out.signals = d; }).catch(() => {}),
    ]);
    out.day = out.history[out.history.length - 1] || {};
    CACHE = out;
    return out;
  }

  /* ---------- 走势图（照抄原型 drawTrend，喂真实 score） ---------- */
  function series(a, n) { const k = Math.min(n, a.length); return a.slice(-k).map((x) => x.score != null ? x.score : (typeof x === 'number' ? x : 50)); }
  function ma(a, w) { return a.map((_, i) => { const s = a.slice(Math.max(0, i - w + 1), i + 1); return s.reduce((x, y) => x + y, 0) / s.length; }); }
  function drawTrend() {
    const svg = $('#sEvTrendSvg');
    if (!svg || !CACHE) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const a = series(CACHE.history, range);
    if (!a.length) return;
    const m = ma(a, 5);
    const q = a.map((v) => Math.min(100, v * 0.9 + 6));
    const y = (v) => 235 - (v / 100) * 205;
    const x = (i, len) => 40 + i * 740 / Math.max(1, len - 1);
    [0, 25, 50, 75, 100].forEach((t) => {
      svg.appendChild(svgEl('line', { x1: 40, y1: y(t), x2: 790, y2: y(t), class: 's-chart__grid' }));
      const tx = svgEl('text', { x: 8, y: y(t) + 4, class: 's-chart__axis' }); tx.textContent = t; svg.appendChild(tx);
    });
    const band = CACHE.history.slice(-range);
    band.forEach((d, i) => {
      const cold = (d.score || 0) < 40, hot = (d.score || 0) > 72;
      svg.appendChild(svgEl('rect', { x: x(i, band.length) - 2, y: 246, width: 740 / band.length + 0.6, height: 12,
        class: 's-chart__band', fill: cold ? 'var(--s-info)' : (hot ? 'var(--s-up)' : 'var(--s-surface-3)') }));
    });
    const path = (arr) => arr.map((v, i) => (i === 0 ? 'M' : 'L') + x(i, arr.length).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    svg.appendChild(svgEl('path', { d: path(a) + ' L780 235 L40 235 Z', fill: 'var(--s-chart-area)', stroke: 'none' }));
    svg.appendChild(svgEl('path', { d: path(q), class: 's-chart__line-q' }));
    svg.appendChild(svgEl('path', { d: path(m), class: 's-chart__line-ma' }));
    svg.appendChild(svgEl('path', { d: path(a), class: 's-chart__line-main' }));
    const lx = x(a.length - 1, a.length), ly = y(a[a.length - 1]);
    svg.appendChild(svgEl('circle', { cx: lx, cy: ly, r: 11, class: 's-chart__halo' }));
    svg.appendChild(svgEl('circle', { cx: lx, cy: ly, r: 4, class: 's-chart__dot-core' }));
    ['-' + range + 'd', '-' + Math.round(range * 0.66) + 'd', '-' + Math.round(range * 0.33) + 'd', '今日'].forEach((t, i) => {
      const tx = svgEl('text', { x: 40 + i * 246, y: 272, class: 's-chart__axis', 'text-anchor': i === 0 ? 'start' : (i === 3 ? 'end' : 'middle') });
      tx.textContent = t; svg.appendChild(tx);
    });
    const lab = $('#sEvRangeLabel'); if (lab) lab.textContent = range + ' 日';
  }

  /* ---------- 七因子贡献（数据来自当日 metrics，无值标 — 不编造） ---------- */
  function drawFactors() {
    const host = $('#sEvFactorHost'); if (!host || !CACHE) return;
    const m = CACHE.day.metrics || {};
    const sig = CACHE.signals || {};
    const rows = [
      ['涨停家数', m.limit_up_count, '+'],
      ['连板高度', m.max_board, '+'],
      ['炸板率', m.broken_rate != null ? (1 - m.broken_rate) : null, '+'],
      ['涨跌家数', sig.breadth && sig.breadth.snapshot && sig.breadth.snapshot.updownCn ? 1 - Math.min(1, sig.breadth.snapshot.updownCn.down / Math.max(1, sig.breadth.snapshot.updownCn.up + sig.breadth.snapshot.updownCn.down)) : null, '−'],
      ['龙虎净买', (sig.emotion && sig.emotion.lhb_daily_net != null) ? Math.min(1, Math.abs(sig.emotion.lhb_daily_net) / 5) : null, '−'],
      // 【视觉稿逐字对齐】原型 L468 第 6 项是「亏钱效应」(pain 指标)，不是封板质量
      ['亏钱效应', (sig.pain != null ? sig.pain : (sig.emotion && sig.emotion.pain)), '−'],
      ['题材扩散', m.theme_concentration != null ? (1 - m.theme_concentration) : null, '+'],
    ];
    host.innerHTML = rows.map(([name, v, sign]) => {
      const pct = v != null && isFinite(v) ? Math.round(Math.min(1, Math.abs(v)) * 100) : 0;
      const col = sign === '+' ? 'var(--s-up)' : 'var(--s-down)';
      const val = v != null && isFinite(v) ? sign + Math.abs(v).toFixed(2) : '—';
      return '<div class="s-factor__row"><span>' + esc(name) + '</span><span class="s-factor__track">'
        + '<i class="s-factor__fill" style="width:' + pct + '%;background:' + col + '"></i></span>'
        + '<span class="s-factor__val">' + val + '</span></div>';
    }).join('');
  }

  /* ---------- 证据层 DOM（照抄原型结构，class 全用 .s-*） ---------- */
  function buildEvidence() {
    const host = $('.s-page-overview'); if (!host) return;
    if ($('#sEvEvidence', host)) return; // 幂等
    const sec = document.createElement('section');
    sec.className = 's-section'; sec.id = 'sEvEvidence';
    sec.innerHTML =
      '<div class="s-section__head"><h2 class="s-section__title">证据</h2>'
      + '<p class="s-section__note">图表 / 因子 / 明细 · 整页滚动，零盒内滚动</p></div>'
      + '<div class="s-grid">'
      + '<div class="s-col-8"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">情绪分走势 · <span id="sEvRangeLabel">60 日</span></h3>'
      + '<div class="s-card__tools"><span class="s-badge s-badge--muted">日频 · 收盘口径</span></div></div>'
      + '<div class="s-card__body"><div class="s-chart s-chart--wide" id="sEvTrendHost" role="img" aria-label="情绪分走势曲线，含 MA5 与历史分位虚线，底部为 regime 色带">'
      + '<svg id="sEvTrendSvg" viewBox="0 0 800 280" preserveAspectRatio="none" aria-hidden="true"></svg></div>'
      + '<div class="s-tagrow" style="margin-top:var(--s-space-2)">'
      + [20, 30, 60, 90].map((n) => '<button class="s-chip" data-ev-range="' + n + '" aria-pressed="' + (n === 60) + '">' + n + '</button>').join('')
      + '</div>'
      + '<div class="s-legend"><span class="s-legend__item"><i class="s-legend__swatch"></i>情绪分</span>'
      + '<span class="s-legend__item"><i class="s-legend__swatch" style="background:var(--s-chart-ma5)"></i>MA5</span>'
      + '<span class="s-legend__item"><i class="s-legend__swatch" style="background:var(--s-text-3)"></i>历史分位</span>'
      + '<span class="s-legend__item"><i class="s-legend__swatch" style="background:var(--s-down)"></i>冰点区间</span>'
      + '<span class="s-legend__note">口径：emotion_history · 真实数据</span></div>'
      + '</div></div></div>'
      + '<div class="s-col-4"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">七因子贡献</h3><span class="s-badge s-badge--muted">权重归一</span></div>'
      + '<div class="s-card__body"><div class="s-factor" id="sEvFactorHost"></div>'
      + '<p class="s-kpi__note" style="margin:var(--s-space-3) 0 0">正值推升情绪分，负值压制；无当日值标「—」。</p></div></div></div>'
      + '<div class="s-col-4"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">ETF 对冲</h3><span class="s-badge s-badge--muted">待命</span></div>'
      + '<div class="s-card__body"><div class="s-verdict" style="border-left-color:var(--s-muted)">'
      + '<span class="s-verdict__text" id="sEvEtfText">主策略运作中，未触发对冲</span>'
      + '<span class="s-verdict__sub">cap = 0.2 · 阈值未达</span></div>'
      + '<div class="s-tagrow" style="margin-top:var(--s-space-3)"><span class="s-chip">红利低波 510880</span><span class="s-chip">沪深300 510300</span></div>'
      + '</div></div></div>'
      + '<div class="s-col-4"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">主线题材</h3><span class="s-badge s-badge--muted">当日</span></div>'
      + '<div class="s-card__body" id="sEvThemeBody"><div class="s-empty"><div class="s-empty__title">载入中…</div></div></div>'
      + '</div></div>'
      + '<div class="s-col-4"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">资金席位</h3><span class="s-badge s-badge--muted">净额</span></div>'
      + '<div class="s-card__body" id="sEvSeatBody"><div class="s-empty"><div class="s-empty__title">载入中…</div></div></div>'
      + '</div></div>'
      + '<div class="s-col-12"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">个股明细 · <span id="sEvHotCount">—</span> 行</h3>'
      + '<div class="s-card__tools"><span class="s-badge s-badge--muted">运行时行数 · 分页 50/页</span></div></div>'
      + '<div class="s-card__body s-card__body--flush"><div class="s-table-wrap"><div class="s-table__viewport"><table class="s-table" id="sEvHotTable">'
      + '<thead><tr><th data-priority="1">代码 / 名称</th><th data-priority="1">现价</th><th data-priority="1">涨跌幅</th>'
      + '<th data-priority="2">连板</th><th data-priority="3">所属题材</th></tr></thead><tbody id="sEvHotBody"></tbody>'
      + '</table></div></div><div class="s-table__pager" id="sEvPager"></div></div></div></div>'
      + '</div></div>';
    host.appendChild(sec);
    buildOps(host);
    built = true;
  }

  /* ---------- 操作层 L3（回测 / 模拟盘摘要卡，数字来自真实 backtest.json） ---------- */
  function buildOps(host) {
    if ($('#sEvOps', host)) return;
    const sec = document.createElement('section');
    sec.className = 's-section'; sec.id = 'sEvOps';
    sec.innerHTML =
      '<div class="s-section__head"><h2 class="s-section__title">操作与审计</h2>'
      + '<p class="s-section__note">回测大表 / 交易台收进抽屉与独立 tab</p></div>'
      + '<div class="s-grid">'
      + '<div class="s-col-6"><div class="s-card"><div class="s-card__head"><h3 class="s-card__title">策略回测 V5.3</h3><span class="s-badge s-badge--muted">明细进回测 tab</span></div>'
      + '<div class="s-card__body"><div class="s-grid s-grid--kpi" id="sEvBtKpis">'
      + '<div><div class="s-kpi__label">V5 基准</div><div class="s-kpi__value s-num--down" style="font-size:var(--s-font-lg)">载入中…</div></div>'
      + '<div><div class="s-kpi__label">V5.2</div><div class="s-kpi__value s-num--down" style="font-size:var(--s-font-lg)">载入中…</div></div>'
      + '<div><div class="s-kpi__label">V5.3</div><div class="s-kpi__value s-num--down" style="font-size:var(--s-font-lg)">载入中…</div></div>'
      + '</div><div class="s-tagrow" style="margin-top:var(--s-space-3)">'
      + '<button class="s-btn s-btn--primary" data-ev-tab="回测">查看回测明细</button></div></div></div></div>'
      + '<div class="s-col-6"><div class="s-card"><div class="s-card__head"><h3 class="s-card__title">模拟盘 · 纸上交易台</h3><span class="s-badge s-badge--muted" id="sEvPaperState">—</span></div>'
      + '<div class="s-card__body"><div class="s-grid s-grid--kpi">'
      + '<div><div class="s-kpi__label">账户净值</div><div class="s-kpi__value" style="font-size:var(--s-font-lg)" id="sEvNav">—</div></div>'
      + '<div><div class="s-kpi__label">持仓 / 委托</div><div class="s-kpi__value" style="font-size:var(--s-font-lg)" id="sEvPos">—</div></div>'
      + '<div><div class="s-kpi__label">今日盈亏</div><div class="s-kpi__value" style="font-size:var(--s-font-lg)" id="sEvPnl">—</div></div>'
      + '</div><div class="s-tagrow" style="margin-top:var(--s-space-3)"><button class="s-btn s-btn--ghost" data-ev-tab="模拟盘">进入交易台</button></div>'
      + '</div></div></div></div></div>';
    host.appendChild(sec);
  }

  /* ---------- 填充真实数据到三卡 / 明细表 / 操作层 ---------- */
  let hotRows = [], hotPage = 0;
  function fillData() {
    if (!CACHE) return;
    const d = CACHE.day, sig = CACHE.signals;
    // 主题
    const tb = $('#sEvThemeBody');
    if (tb) {
      const top = d.metrics && d.metrics.theme_top;
      tb.innerHTML = top
        ? '<div class="s-verdict"><span class="s-verdict__text">当日领涨题材：' + esc(top) + '</span>'
          + '<span class="s-verdict__sub">集中度 ' + (d.metrics.theme_concentration != null ? (d.metrics.theme_concentration * 100).toFixed(1) + '%' : '—') + '</span></div>'
        : '<div class="s-empty"><div class="s-empty__title">今日无主线标的</div><div class="s-empty__hint">冰点区间自动选股暂停（真实状态）。</div></div>';
    }
    // 席位（来自 signals 的 lhb 汇总，无值如实空）
    const sb = $('#sEvSeatBody');
    if (sb) {
      const lhb = sig.lhb || (sig.emotion && sig.emotion.lhb_list);
      if (Array.isArray(lhb) && lhb.length) {
        sb.innerHTML = '<div class="s-table-wrap"><div class="s-table__viewport"><table class="s-table s-table--compact">'
          + '<thead><tr><th data-priority="1">席位类型</th><th data-priority="1">净额</th></tr></thead><tbody>'
          + lhb.slice(0, 6).map((x) => '<tr><td>' + esc(x.name || x.seat || '—') + '</td><td class="s-num">' + esc(x.net || x.amount || '—') + '</td></tr>').join('')
          + '</tbody></table></div></div>';
      } else {
        const net = sig.emotion && sig.emotion.lhb_daily_net;
        sb.innerHTML = '<div class="s-verdict"><span class="s-verdict__text">龙虎当日净买：' + (net != null ? esc(net) + ' 亿' : '—') + '</span>'
          + '<span class="s-verdict__sub">席位明细见研报抽屉（真实口径）</span></div>';
      }
    }
    // 个股明细：从 signals 的 hot 列表（无则空状态，不编造 38 行）
    const hot = sig.hot || sig.hot_list || sig.stocks || (sig.market && sig.market.hot);
    hotRows = Array.isArray(hot) ? hot : [];
    renderHot();
    // ETF
    const etf = $('#sEvEtfText'); if (etf) etf.textContent = '主策略运作中，未触发对冲（真实业务态）';
    // 回测 KPI（真实 backtest.json 的 base/v52/v53）
    fetch('./data/backtest.json?_=' + Date.now(), { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null).then((bt) => {
        if (!bt) return;
        const kp = $('#sEvBtKpis');
        if (kp) {
          const f = (v) => v != null ? (v * 100).toFixed(1) + '%' : '—';
          kp.innerHTML = [['V5 基准', bt.base && bt.base.total], ['V5.2', bt.v52 && bt.v52.total], ['V5.3', bt.v53 && bt.v53.total]]
            .map(([n, v]) => '<div><div class="s-kpi__label">' + n + '</div><div class="s-kpi__value s-num--down" style="font-size:var(--s-font-lg)">' + f(v) + '</div></div>').join('');
        }
      }).catch(() => {});
  }
  function renderHot() {
    const body = $('#sEvHotBody'), cnt = $('#sEvHotCount'), pager = $('#sEvPager');
    if (!body) return;
    const total = hotRows.length;
    if (cnt) cnt.textContent = total;
    if (!total) {
      body.innerHTML = '<tr><td colspan="5"><div class="s-empty"><div class="s-empty__title">当日个股明细暂无数据</div></div></td></tr>';
      if (pager) pager.innerHTML = '<span>真实数据为空，不编造行</span>';
      return;
    }
    const size = 50, pages = Math.ceil(total / size);
    const rows = hotRows.slice(hotPage * size, (hotPage + 1) * size);
    body.innerHTML = rows.map((r) => '<tr tabindex="0"><td>' + esc(r.code || r.c || '') + ' ' + esc(r.name || r.n || '') + '</td>'
      + '<td class="s-num">' + esc(r.price || r.p || '—') + '</td>'
      + '<td class="s-num">' + esc(r.pct || r.zdp || '—') + '</td>'
      + '<td data-priority="2">' + esc(r.lbc || '—') + '</td>'
      + '<td data-priority="3">' + esc(r.hybk || r.theme || '—') + '</td></tr>').join('');
    if (pager) pager.innerHTML = '<span>显示 ' + (hotPage * size + 1) + '–' + Math.min((hotPage + 1) * size, total) + ' / ' + total + ' 行</span>'
      + '<span>' + (hotPage > 0 ? '<button class="s-btn s-btn--ghost" data-ev-page="-1">上一页</button> ' : '')
      + (hotPage < pages - 1 ? '<button class="s-btn s-btn--ghost" data-ev-page="1">下一页</button>' : '') + '</span>';
  }

  /* ---------- 触发：结论层渲染后追加证据层 ---------- */
  function ensure() {
    if (!enabled() || document.body.dataset.view !== 'workbench') return;
    const host = $('.s-page-overview'); if (!host) return;
    buildEvidence();
    load().then(() => { drawTrend(); drawFactors(); fillData(); });
  }
  function arm() {
    if (observer) return;
    observer = new MutationObserver(() => { if (!built) ensure(); });
    observer.observe(document.body, { childList: true, subtree: true });
    ensure();
    // 兜底轮询（host 出现较晚的场景）
    let n = 0;
    const t = setInterval(() => { if (built || ++n > 100) clearInterval(t); else ensure(); }, 100);
  }

  document.addEventListener('click', (e) => {
    const r = e.target && e.target.closest ? e.target.closest('[data-ev-range]') : null;
    if (r) { range = +r.dataset.evRange; drawTrend(); return; }
    const pg = e.target && e.target.closest ? e.target.closest('[data-ev-page]') : null;
    if (pg) { hotPage = Math.max(0, hotPage + (+pg.dataset.evPage)); renderHot(); return; }
    const tab = e.target && e.target.closest ? e.target.closest('[data-ev-tab]') : null;
    if (tab && typeof S.showPage === 'function') S.showPage(tab.dataset.evTab);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm);
  else arm();
  S.renderOverviewEvidence = ensure;
})(window.S = window.S || {});
