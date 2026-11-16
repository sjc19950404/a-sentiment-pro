/* ══════════════════════════════════════════════════════════════════════════
 * s-page-backtest.js — A 方案阶段 3：工作台「回测」页（净值曲线 + 策略明细）
 * ──────────────────────────────────────────────────────────────────────────
 * 权威边界（14 册）：只新增文件，不改 app.js / 研报结构 / 研报样式；
 *   工作台**自行 fetch** ./data/backtest.json（同 app.js:2432 的 URL 与 cache 方式），
 *   绝不引用模块私有的 BT / _navChart；用**自己的** LW chart 实例在 #btNavHost 真画曲线。
 *
 * 门禁（14 册 §5）：
 *   ① canvas 真初始化：#btNavHost 内 <canvas> 存在且宽高>0 + data-state=ready（SVG 兜底不算）
 *   ② 行数动态：N=series.dates.length 动态读（禁写死 265/288），S.Table.plan 算 pages/每页≤50
 *   ④ 回退：S.setFlag('tableV2', false) 时不渲染、回落占位
 *   ⑤ 白屏②：8 秒超时回退可重试态，不永久 pending
 *   ⑦ NO_TOUCH：不碰任何写操作节点；本页只读 fetch + 只读展示
 *   ⑧ 切 tab：chart.remove() + tooltip 清理
 *
 * 数据口径：name/color/dash 是 UI 展示元数据；所有数值来自 JSON、不重算（照 app.js:2286-2292）。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  const LOAD_TIMEOUT = 8000;

  let chart = null;       // 工作台自己的 chart 实例（绝不引用 app.js 的 _navChart）
  let tableApi = null;
  let loadTimer = null;
  let currentPanel = null;

  function enabled() { return S.getFlag('tableV2', true) !== false; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function pct(v, d = 2) { return (v == null || isNaN(+v)) ? '—' : ((+v) * 100).toFixed(d) + '%'; }
  function num(v, d = 2) { return (v == null || isNaN(+v)) ? '—' : (+v).toFixed(d); }

  /* ---------- 结构（04 册蓝图 L474-540）：4 KPI + 净值 host + 明细表 ---------- */
  function shell() {
    const host = document.createElement('div');
    host.className = 's-page-backtest';
    host.innerHTML =
      `<div class="s-verdict"><span class="s-verdict__sub">回测口径：引擎预生成，本页只读展示、不重算</span></div>`
      + `<div class="s-section"><h2 class="s-section__title">区间表现</h2>`
      + `<div class="s-grid s-grid--kpi" id="sBtMetrics">`
      + `<div class="s-kpi"><span class="s-kpi__label">区间总收益</span><span class="s-kpi__value" id="sBtTotal">加载中…</span><span class="s-kpi__delta">基线口径</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">夏普</span><span class="s-kpi__value" id="sBtSharpe">加载中…</span><span class="s-kpi__delta">年化</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">最大回撤</span><span class="s-kpi__value s-kpi__value--down" id="sBtDd">加载中…</span><span class="s-kpi__delta">阈值内</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">胜率</span><span class="s-kpi__value" id="sBtWin">加载中…</span><span class="s-kpi__delta">逐日</span></div>`
      + `</div></div>`
      + `<div class="s-section"><h2 class="s-section__title">策略净值曲线</h2>`
      + `<div class="s-chart s-chart--wide" id="btNavChart" data-state="pending" data-chart="bt-nav" role="img" aria-label="策略净值曲线">`
      + `<div class="s-chart__pending" aria-hidden="true"></div>`
      + `<div class="s-chart__host" id="btNavHost"></div>`
      + `<div class="s-chart__error" hidden>净值曲线加载失败 <button type="button" class="s-chip" data-act="retry">重试</button></div>`
      + `</div><div class="bt-legend" id="sBtLegend"></div>`
      + `</div>`
      + `<div class="s-section"><h2 class="s-section__title">策略明细（逐日）</h2>`
      + `<div class="s-card__tools"><span class="s-badge s-badge--muted" id="btRowCount">加载中…</span>`
      + `<span class="s-badge s-badge--muted" id="sBtMode">分页</span></div>`
      + `<div id="sBtTableHost" aria-busy="false"></div>`
      + `</div>`;
    return host;
  }

  /* ---------- 净值 series 展示元数据（照 app.js:2286-2292，数值来自 JSON） ---------- */
  function buildSeries(s) {
    const out = [
      { name: 'V5 基准（无成本/无风控）', values: s.navBase || [], color: 'var(--muted)', dash: true },
      { name: 'V5.2 增强（成本+平滑+风控）', values: s.navV52 || [], color: 'var(--acc)' },
    ];
    if (s.navV53 && s.navV53.length) out.push({ name: 'V5.3 动态仓位', values: s.navV53, color: 'var(--ok)' });
    out.push({ name: '等权指数买入持有', values: s.navHold || [], color: 'var(--warn)', dash: true });
    return out.filter((x) => x.values && x.values.length);
  }

  function cssColor(varName) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v || '#58a6ff';
  }

  /* ---------- 独立 chart：真 createChart，绝不触碰 _navChart ---------- */
  function drawChart(hostEl, series, dates) {
    const LW = window.LightweightCharts;
    if (!LW || typeof LW.createChart !== 'function') return false; // 不画 SVG 兜底，交给调用方记 error
    if (chart) { try { chart.remove(); } catch (_) {} chart = null; }
    hostEl.innerHTML = '';
    // 【14 册门禁①】显式尺寸兜底：autoSize 依赖 ResizeObserver，面板未完全布局时 canvas 可能 0×0。
    // 优先用容器实测尺寸，回退到固定值，确保 <canvas> 宽高>0（SVG 兜底不算）。
    const w = Math.max(320, hostEl.clientWidth || 0);
    const h = Math.max(150, hostEl.clientHeight || 0);
    try {
      chart = LW.createChart(hostEl, {
        width: w, height: h, autoSize: true,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: cssColor('--muted'), fontSize: 11, fontFamily: 'inherit' },
        grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(139,148,158,.10)' } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.12 } },
        timeScale: { borderVisible: false, rightOffset: 2 },
        crosshair: { mode: LW.CrosshairMode.Normal },
        handleScroll: { vertTouchDrag: false },
        localization: { priceFormatter: (p) => (Number.isFinite(p) ? p.toFixed(3) : '') },
      });
      for (const s of series) {
        const line = chart.addLineSeries({
          color: cssColor(s.color),
          lineStyle: s.dash ? LW.LineStyle.Dashed : LW.LineStyle.Solid,
          lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true,
        });
        line.setData(s.values.map((v, i) => {
          if (v == null || !Number.isFinite(v) || !dates[i]) return { time: dates[i] };
          return { time: dates[i], value: +v };
        }).filter((d) => d.time));
      }
      chart.timeScale().fitContent();
      return true;
    } catch (_) {
      if (chart) { try { chart.remove(); } catch (_) {} chart = null; }
      return false;
    }
  }

  function setState(state) {
    const c = currentPanel && $('#btNavChart', currentPanel);
    if (!c) return;
    c.setAttribute('data-state', state);
    const pend = $('.s-chart__pending', c), err = $('.s-chart__error', c);
    if (pend) pend.hidden = state !== 'pending';
    if (err) err.hidden = state !== 'error';
  }

  /* ---------- 明细表：真实 N = series.dates.length，动态分页 ---------- */
  function renderTable(host, s) {
    const dates = s.dates || [];
    const rows = dates.map((d, i) => ({
      date: d,
      nav: s.navV53 && s.navV53[i] != null ? s.navV53[i] : (s.navV52 && s.navV52[i]),
      base: s.navBase && s.navBase[i],
      hold: s.navHold && s.navHold[i],
      i,
    }));
    const N = rows.length; // 真实行数，禁止写死
    const columns = [
      { key: 'date', label: '日期', priority: 1, width: '22%' },
      { key: 'nav', label: '净值 V5.3', priority: 1, width: '20%' },
      { key: 'base', label: '净值 基准', priority: 2, width: '20%' },
      { key: 'hold', label: '净值 持有', priority: 3, width: '20%' },
      { key: 'ret', label: '日收益', priority: 1, width: '18%' },
    ];
    const renderRow = (r) => {
      const prev = r.i > 0 ? rows[r.i - 1].nav : null;
      const chg = (r.nav != null && prev != null && prev !== 0) ? ((r.nav / prev - 1) * 100).toFixed(2) + '%' : '—';
      return `<tr><td>${esc(r.date)}</td><td>${num(r.nav, 4)}</td><td>${num(r.base, 4)}</td>`
        + `<td>${num(r.hold, 4)}</td><td class="${chg.startsWith('-') ? 's-num--down' : 's-num--up'}">${esc(chg)}</td></tr>`;
    };
    tableApi = (S.Table && S.Table.mount) ? S.Table.mount(host, { rows, columns, renderRow, label: '策略逐日明细' }) : null;
    const plan = (S.Table && S.Table.plan) ? S.Table.plan(N) : { total: N, pages: Math.ceil(N / 50), mode: N > 1000 ? 'virtual' : 'pager' };
    const rc = currentPanel && $('#btRowCount', currentPanel);
    if (rc) rc.textContent = `共 ${N} 行`;
    const md = currentPanel && $('#sBtMode', currentPanel);
    if (md) md.textContent = plan.mode === 'virtual' ? '虚拟列表' : '分页';
    host.setAttribute('aria-busy', 'false');
  }

  /* ---------- 加载（8 秒上限 + 失败可重试） ---------- */
  function load(panel) {
    currentPanel = panel;
    setState('pending');
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      setState('error');
    }, LOAD_TIMEOUT);
    loadTimer = timeout;

    fetch('./data/backtest.json?_=' + Date.now(), { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout); loadTimer = null;
        if (!enabled()) return;
        applyData(panel, data);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout); loadTimer = null;
        setState('error');
      });
  }

  function applyData(panel, data) {
    const seriesSrc = data && data.series;
    if (!seriesSrc || !Array.isArray(seriesSrc.dates) || !seriesSrc.dates.length) { setState('error'); return; }

    // 4 KPI（取 v53 主展示版本，回退 v52/best）——只读，来自 JSON
    const v = (data.v53 || data.v52 || data.best || {});
    const setKpi = (id, val, down) => {
      const n = currentPanel && $('#' + id, currentPanel);
      if (!n) return;
      n.textContent = val;
      if (down != null) n.classList.toggle('s-kpi__value--down', !!down);
    };
    setKpi('sBtTotal', pct(v.total), v.total != null && +v.total < 0);
    setKpi('sBtSharpe', num(v.sharpe));
    setKpi('sBtDd', pct(v.maxDd), true);
    setKpi('sBtWin', pct(v.winRate, 0));

    const series = buildSeries(seriesSrc);
    const hostEl = currentPanel && $('#btNavHost', currentPanel);
    const ok = hostEl ? drawChart(hostEl, series, seriesSrc.dates) : false;
    setState(ok ? 'ready' : 'error');

    const legend = currentPanel && $('#sBtLegend', currentPanel);
    if (legend) legend.innerHTML = series.map((x) =>
      `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`
    ).join('') + `<span>样本 ${seriesSrc.dates.length} 个交易日</span>`;

    const tableHost = currentPanel && $('#sBtTableHost', currentPanel);
    if (tableHost) renderTable(tableHost, seriesSrc);
  }

  /* ---------- 生命周期：切 tab / 回退时清理 chart + 定时器 ---------- */
  function teardown() {
    if (chart) { try { chart.remove(); } catch (_) {} chart = null; }
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    if (tableApi && typeof tableApi.destroy === 'function') { tableApi.destroy(); tableApi = null; }
    // tooltip 单例清理（若存在）
    try { document.querySelectorAll('.s-tooltip.is-visible').forEach((t) => t.classList.remove('is-visible')); } catch (_) {}
    currentPanel = null;
  }

  function render(panel) {
    if (!panel) return;
    if (!enabled()) {
      panel.innerHTML = '<h2 class="s-ph-title">工作台 · 回测</h2>'
        + '<p class="s-ph-desc">回测视图已回退（flag tableV2=false）。</p>';
      teardown();
      return;
    }
    teardown();
    let host = panel.querySelector('.s-page-backtest');
    if (!host) { host = shell(); panel.innerHTML = ''; panel.appendChild(host); }
    currentPanel = panel;
    // 重试按钮（事件委托在 host 上，幂等由 shell 重建保证）
    host.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-act="retry"]') : null;
      if (b) load(panel);
    });
    load(panel);
  }

  /* ---------- 注册到 s-root.js「回测」tab ---------- */
  S.registerPageBacktest = () => {
    if (typeof S.registerPage === 'function') S.registerPage('回测', render, teardown);
  };
  S.registerPageBacktest();
  S.teardownBacktest = teardown; // 兼容：外部可手动清理
})(window.S = window.S || {});
