/* ══════════════════════════════════════════════════════════════════════════
 * s-page-zt.js — A 方案阶段 3：工作台「涨跌停」页（今日盘面 KPI + 涨停池明细表）
 * ──────────────────────────────────────────────────────────────────────────
 * 硬边界（14 册 §3.3）：只新增文件，不改 app.js / 研报结构 / 研报样式。
 *   工作台自行 fetch ./data/ztpool_history.json（只读静态数据），不碰研报任何节点。
 * 门禁（14 册 §5）：
 *   ② 行数动态：N=当日 pool.length 动态读，S.Table 分页每页≤50（涨停池通常<100）
 *   ③ 无横向溢出：表格列按 data-priority 响应式收起
 *   ④ 回退：flag tableV2=false 时占位、原研报节点不动
 *   ⑦ NO_TOUCH：只读，不碰写操作节点
 * 数据字段（同花顺涨停池）：c 代码 / n 名称 / p 现价(分) / zdp 涨跌幅 / lbc 连板数 /
 *   fbt 首封时间(HHMMSS) / zbc 炸板次数 / hybk 行业 / hs 换手 / amount 成交额(元)。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  let tableApi = null;
  let loadTimer = null;
  let currentPanel = null;

  function enabled() { return S.getFlag('tableV2', true) !== false; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(v) {
    const s = String(v == null ? '' : v).padStart(6, '0');
    return /^\d{6}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4)}` : '—';
  }
  function yi(v) { return (v == null || isNaN(+v)) ? '—' : ((+v) / 1e8).toFixed(2) + ' 亿'; }

  function shell() {
    const host = document.createElement('div');
    host.className = 's-page-zt';
    host.innerHTML =
      `<div class="s-section"><div class="s-section__head">`
      + `<h2 class="s-section__title">涨跌停 · 今日盘面</h2>`
      + `<p class="s-section__note">数据日取涨停池最新交易日 · 点行看明细（抽屉阶段 4 接入）</p></div>`
      + `<div class="s-verdict"><span class="s-verdict__text" id="sZtVerdict">加载中…</span>`
      + `<span class="s-verdict__sub" id="sZtSub">涨停池历史 · 只读展示</span></div></div>`
      + `<div class="s-section"><div class="s-grid s-grid--kpi" id="sZtMetrics">`
      + `<div class="s-kpi"><span class="s-kpi__label">涨停</span><span class="s-kpi__value s-kpi__value--up" id="sZtUp">—</span><span class="s-kpi__delta">封板家数</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">炸板</span><span class="s-kpi__value" id="sZtBroken">—</span><span class="s-kpi__delta" id="sZtRate">封板率 —</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">最高连板</span><span class="s-kpi__value" id="sZtMaxLbc">—</span><span class="s-kpi__delta">连板梯队</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">样本交易日</span><span class="s-kpi__value" id="sZtDays">—</span><span class="s-kpi__delta">历史回溯</span></div>`
      + `</div></div>`
      + `<div class="s-section"><h2 class="s-section__title">涨停池明细</h2>`
      + `<div class="s-card__tools"><span class="s-badge s-badge--muted" id="sZtRowCount">加载中…</span>`
      + `<span class="s-badge s-badge--muted" id="sZtMode">分页</span></div>`
      + `<div id="sZtTableHost" aria-busy="false"></div></div>`;
    return host;
  }

  function renderTable(host, pool) {
    const N = pool.length; // 真实行数
    const columns = [
      { key: 'c', label: '代码', priority: 1, width: '14%' },
      { key: 'n', label: '名称', priority: 1, width: '18%' },
      { key: 'p', label: '现价', priority: 1, width: '12%' },
      { key: 'zdp', label: '涨跌幅', priority: 1, width: '12%' },
      { key: 'lbc', label: '连板', priority: 2, width: '10%' },
      { key: 'fbt', label: '首封', priority: 3, width: '14%' },
      { key: 'zbc', label: '炸板', priority: 4, width: '10%' },
      { key: 'hybk', label: '行业', priority: 4, width: '10%' },
    ];
    const renderRow = (r) =>
      `<tr><td>${esc(r.c)}</td><td>${esc(r.n)}</td><td>${num(r.p)}</td>`
      + `<td class="s-num s-num--up">${esc(r.zdp != null ? (+r.zdp).toFixed(2) + '%' : '—')}</td>`
      + `<td>${r.lbc || 1}</td><td data-priority="3">${fmtTime(r.fbt)}</td>`
      + `<td data-priority="4">${r.zbc || 0}</td><td data-priority="4">${esc(r.hybk || '—')}</td></tr>`;
    tableApi = (S.Table && S.Table.mount) ? S.Table.mount(host, { rows: pool, columns, renderRow, label: '涨停池明细' }) : null;
    const plan = (S.Table && S.Table.plan) ? S.Table.plan(N) : { pages: Math.ceil(N / 50), mode: N > 1000 ? 'virtual' : 'pager' };
    const rc = currentPanel && $('#sZtRowCount', currentPanel);
    if (rc) rc.textContent = `共 ${N} 行`;
    const md = currentPanel && $('#sZtMode', currentPanel);
    if (md) md.textContent = plan.mode === 'virtual' ? '虚拟列表' : '分页';
    host.setAttribute('aria-busy', 'false');
  }
  function num(v) { return (v == null || isNaN(+v)) ? '—' : ((+v) / 100).toFixed(2); }

  function applyData(panel, data) {
    if (!Array.isArray(data) || !data.length) { setNote('暂无涨停池数据'); return; }
    const latest = data[data.length - 1]; // 最新交易日
    const pool = Array.isArray(latest.pool) ? latest.pool : [];
    const zbc = pool.reduce((a, x) => a + (+x.zbc || 0), 0);   // 炸板次数累计（池口径：某股可多次炸板）
    const sealed = pool.length;
    const maxLbc = pool.reduce((m, x) => Math.max(m, +x.lbc || 1), 0);
    const setTxt = (id, v) => { const n = currentPanel && $('#' + id, currentPanel); if (n) n.textContent = v; };
    setTxt('sZtUp', String(sealed));
    /* 【P0-3 口径统一 2026-11-19】封板率主口径=signals.latest（zt/(zt+zb)＝触板只数口径：
     * 收盘封住 23 / 触板 47 = 48.9%，引擎报告与 summary.zbl_pct 反推同源）。此前
     * sealed/(sealed+Σzbc) 把「炸板次数累计」当「炸板只数」——量纲错（次数 38 > 只数 24，
     * 同日 37.7% vs 48.9% 与总览/报告三处打架）。池内 zbc 累计降级为次数披露。 */
    const sigL = (typeof window !== 'undefined' && window.__signals && window.__signals.latest) || {};
    const ztN = +sigL.zt_count || sealed, zbN = (sigL.zb_count != null) ? +sigL.zb_count : null;
    const rateTxt = (zbN != null && ztN + zbN > 0)
      ? (ztN / (ztN + zbN) * 100).toFixed(1) + '% · 触板口径'
      : '—（口径待 signals 就绪）';
    setTxt('sZtBroken', zbN != null ? String(zbN) : String(zbc) + ' 次');
    setTxt('sZtRate', `封板率 ${rateTxt}`);
    setTxt('sZtMaxLbc', maxLbc ? maxLbc + ' 板' : '—');
    setTxt('sZtDays', String(data.length));
    setTxt('sZtVerdict', `涨停 ${sealed} / 炸板 ${zbN != null ? zbN + ' 只' : zbc + ' 次'}`);
    setTxt('sZtSub', `最新数据日 ${esc(String(latest.date || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))} · 封板率 ${rateTxt}（触板 ${zbN != null ? ztN + zbN : '—'} 只：封住 ${ztN} / 炸板 ${zbN != null ? zbN : '—'}）· 池内炸板次数累计 ${zbc} 次`);
    const host = currentPanel && $('#sZtTableHost', currentPanel);
    if (host) renderTable(host, pool);
  }
  function setNote(t) {
    const v = currentPanel && $('#sZtVerdict', currentPanel);
    if (v) v.textContent = t;
    const host = currentPanel && $('#sZtTableHost', currentPanel);
    if (host) { host.innerHTML = `<p class="s-ph-desc">${esc(t)}</p>`; host.setAttribute('aria-busy', 'false'); }
  }

  function load(panel) {
    currentPanel = panel;
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    let settled = false;
    const timeout = setTimeout(() => { if (!settled) { settled = true; setNote('涨停池数据加载超时，请重试'); } }, 8000);
    loadTimer = timeout;
    fetch('./data/ztpool_history.json?_=' + Date.now(), { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); loadTimer = null;
        if (!enabled()) return;
        applyData(panel, d);
      })
      .catch(() => { if (settled) return; settled = true; clearTimeout(timeout); loadTimer = null; setNote('涨停池数据加载失败'); });
  }

  function teardown() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    if (tableApi && typeof tableApi.destroy === 'function') { tableApi.destroy(); tableApi = null; }
    try { document.querySelectorAll('.s-tooltip.is-visible').forEach((t) => t.classList.remove('is-visible')); } catch (_) {}
    currentPanel = null;
  }

  function render(panel) {
    if (!panel) return;
    teardown();
    if (!enabled()) {
      panel.innerHTML = '<h2 class="s-ph-title">工作台 · 涨跌停</h2>'
        + '<p class="s-ph-desc">涨跌停视图已回退（flag tableV2=false），研报原节点未改动。</p>';
      return;
    }
    let host = panel.querySelector('.s-page-zt');
    if (!host) { host = shell(); panel.innerHTML = ''; panel.appendChild(host); }
    load(panel);
  }

  S.registerPageZt = () => {
    if (typeof S.registerPage === 'function') S.registerPage('涨跌停', render, teardown);
  };
  S.registerPageZt();
  S.teardownZt = teardown;
})(window.S = window.S || {});
