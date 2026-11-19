/* ══════════════════════════════════════════════════════════════════════════
 * s-page-paper.js — 工作台「模拟盘」页（原型 index.html L326-337 结构逐字对齐）
 * ──────────────────────────────────────────────────────────────────────────
 * 硬边界：只新增文件，不改 app.js / 研报结构 / 研报样式；工作台自行 fetch 只读
 *   ./data/paper/account.json（模拟盘引擎导出，version paper-v1）等静态 JSON。
 * 原型结构：8/4 栅格 = 持仓卡（空仓 s-empty + 查看建仓条件按钮→小抽屉）
 *   + 快捷下单卡（代码/方向/数量/预览委托 + 门槛校验 note）。
 *   生产延伸：账户概要 KPI（真值）+ 委托记录表（真实 orders，S.Table 分页）——
 *   原型两卡是因为设计稿无数据，生产有真实账户数据必须如实展示。
 * 不造假：positions 为空就是「当前空仓」；委托状态 expired/rejected 原样展示。
 * 下单通道：模拟盘引擎为每日收盘批处理（scripts 侧 settle），网页端不做实时委托，
 *   「预览委托」给出真实校验（现金/门槛/regime），不伪造提交成功。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  let tableApi = null;
  let loadTimer = null;
  let currentPanel = null;
  let ACCOUNT = null;   // { ...account.json }
  let REGIME = null;    // { emotion, score, date }

  function enabled() { return S.getFlag('paperV2', true) !== false; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function wan(v) { return (v == null || isNaN(+v)) ? '—' : (+v).toLocaleString(); }
  /* 资金类统一万元口径（6 列 KPI 下 1,000,000 会折行；视觉稿同口径） */
  function wanY(v) {
    if (v == null || isNaN(+v)) return '—';
    const n = +v;
    return Math.abs(n) >= 10000 ? ((+ (n/10000).toFixed(2)) % 1 === 0 ? (n/10000).toFixed(0) : (n/10000).toFixed(2)) + ' 万' : n.toLocaleString();
  }
  const STATUS_LABEL = {
    filled: { t: '已成交', c: 's-num--up' },
    expired: { t: '已过期', c: '' },
    rejected: { t: '已拒绝', c: 's-num--down' },
    pending: { t: '待结算', c: '' },
    cancelled: { t: '已撤单', c: '' },
  };

  function shell() {
    const host = document.createElement('div');
    host.className = 's-page-paper';
    host.innerHTML =
      /* ---- 原型 L327-336 逐字：section head + 8/4 栅格两卡 ---- */
      `<div class="s-section"><div class="s-section__head">`
      + `<h2 class="s-section__title">模拟盘 · 纸上交易台</h2>`
      + `<p class="s-section__note">操作层 · 空仓是真实状态，空状态也有设计</p></div>`
      + `<div class="s-grid">`
      + `<div class="s-col-8"><div class="s-card"><div class="s-card__head"><h3 class="s-card__title">持仓</h3><span class="s-badge s-badge--muted" id="sPpPosCount">—</span></div>`
      + `<div class="s-card__body" id="sPpPosBody"><div class="s-empty"><div style="font-size:24px;color:var(--s-text-3)">◇</div>`
      + `<div class="s-empty__title">当前空仓</div>`
      + `<div class="s-empty__hint" id="sPpEmptyHint">加载中…</div>`
      + `<button class="s-btn s-btn--ghost" style="margin-top:var(--s-space-2)" id="sPpGateBtn">查看建仓条件</button></div></div></div></div>`
      + `<div class="s-col-4"><div class="s-card"><div class="s-card__head"><h3 class="s-card__title">快捷下单</h3></div>`
      + `<div class="s-card__body">`
      + `<label class="s-field"><span class="s-field__label">代码</span><input class="s-input" id="sPpCode" value="600000" inputmode="numeric" maxlength="6"></label>`
      + `<label class="s-field" style="margin-top:var(--s-space-2)"><span class="s-field__label">方向</span><select class="s-select" id="sPpSide"><option>买入</option><option>卖出</option></select></label>`
      + `<label class="s-field" style="margin-top:var(--s-space-2)"><span class="s-field__label">数量（股）</span><input class="s-input" id="sPpQty" value="1000" inputmode="numeric"></label>`
      + `<button class="s-btn s-btn--primary" style="margin-top:var(--s-space-3);width:100%" id="sPpPreview">预览委托</button>`
      + `<p class="s-kpi__note" id="sPpGateNote" style="margin-top:var(--s-space-2)">门槛校验：加载中…</p>`
      + `<p class="s-kpi__note" id="sPpPreviewOut" style="margin-top:var(--s-space-1)"></p>`
      + `</div></div></div>`
      + `</div></div>`
      /* ---- 生产延伸：账户概要（真值） ---- */
      + `<div class="s-section"><h2 class="s-section__title">账户概要</h2>`
      + `<div class="s-grid s-grid--kpi">`
      + `<div class="s-kpi"><span class="s-kpi__label">初始资金</span><span class="s-kpi__value" id="sPpInit" style="font-size:var(--s-font-lg)">—</span><span class="s-kpi__delta">模拟账户</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">可用现金</span><span class="s-kpi__value" id="sPpCash" style="font-size:var(--s-font-lg)">—</span><span class="s-kpi__delta" id="sPpCashDelta">实时口径</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">已实现盈亏</span><span class="s-kpi__value" id="sPpRealized" style="font-size:var(--s-font-lg)">—</span><span class="s-kpi__delta">含费用前</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">总费用</span><span class="s-kpi__value" id="sPpFee" style="font-size:var(--s-font-lg)">—</span><span class="s-kpi__delta">佣金+滑点</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">最近净值</span><span class="s-kpi__value" id="sPpEquity" style="font-size:var(--s-font-lg)">—</span><span class="s-kpi__delta" id="sPpEquityDate">—</span></div>`
      + `<div class="s-kpi"><span class="s-kpi__label">运行天数</span><span class="s-kpi__value" id="sPpDays">—</span><span class="s-kpi__delta" id="sPpSettle">—</span></div>`
      + `</div></div>`
      /* ---- 生产延伸：委托记录（真实 orders） ---- */
      + `<div class="s-section"><h2 class="s-section__title">委托记录</h2>`
      + `<div class="s-card__tools"><span class="s-badge s-badge--muted" id="sPpOrderCount">加载中…</span>`
      + `<span class="s-badge s-badge--muted" id="sPpMode">分页</span></div>`
      + `<div id="sPpOrderHost" aria-busy="true"></div>`
      + `<p class="s-kpi__note" style="margin-top:var(--s-space-2)">委托由模拟盘引擎每日收盘批处理结算；网页端为只读展示，不做实时下单。</p>`
      + `</div>`;
    return host;
  }

  /* ---------- 持仓卡：真实空仓 / 真实持仓 ---------- */
  function renderPositions() {
    const cnt = $('#sPpPosCount', currentPanel);
    const body = $('#sPpPosBody', currentPanel);
    if (!cnt || !body || !ACCOUNT) return;
    const pos = ACCOUNT.positions && typeof ACCOUNT.positions === 'object'
      ? Object.values(ACCOUNT.positions) : [];
    cnt.textContent = pos.length + ' 只';
    if (!pos.length) {
      const em = REGIME ? REGIME.emotion : null;
      const hint = $('#sPpEmptyHint', currentPanel);
      if (hint) {
        hint.textContent = em
          ? `regime ${em}（情绪分 ${REGIME.score ?? '—'}）未触发建仓条件。可先在下表单做沙盒推演，不影响真实账户。`
          : '未触发建仓条件。可先在下表单做沙盒推演，不影响真实账户。';
      }
      return;
    }
    /* 有持仓：真实表格（当前账户为空仓，此分支为真实状态变化后自动生效） */
    const rows = pos.map((p) =>
      `<tr><td>${esc(p.code || '')}</td><td>${esc(p.name || '')}</td>`
      + `<td class="s-num">${wan(p.qty)}</td><td class="s-num">${p.cost != null ? (+p.cost).toFixed(2) : '—'}</td>`
      + `<td class="s-num">${p.price != null ? (+p.price).toFixed(2) : '—'}</td></tr>`);
    body.innerHTML = `<div class="s-table-wrap"><div class="s-table__viewport"><table class="s-table">`
      + `<thead><tr><th>代码</th><th>名称</th><th>数量</th><th>成本</th><th>现价</th></tr></thead>`
      + `<tbody>${rows.join('')}</tbody></table></div></div>`;
  }

  /* ---------- 建仓条件抽屉（真实数据） ---------- */
  function openGateDrawer() {
    if (typeof S.openDrawer !== 'function') return;
    const budget = (window.__sPpBudget || null);
    const slotTxt = budget && Array.isArray(budget.slots) && budget.slots.length
      ? budget.slots.map((s) => `${esc(s.id)} ${s.pct}`).join(' / ') : '—';
    S.openDrawer({
      size: 'sm',
      title: '建仓条件',
      sub: '数据来自 risk_budget_preview / emotion_history / paper 账户',
      render(body) {
        body.innerHTML =
          `<div class="s-alert s-alert--muted"><div class="s-alert__title">当前 regime</div>`
          + `<div>${REGIME ? esc(REGIME.emotion) + '（情绪分 ' + (REGIME.score ?? '—') + '，' + esc(REGIME.date || '') + '）' : '加载中…'}</div></div>`
          + `<div class="s-alert s-alert--muted" style="margin-top:var(--s-space-2)"><div class="s-alert__title">预算槽（最新预演档）</div>`
          + `<div>槽位：${slotTxt}；剩余额度 ${(budget && budget.remainingPct != null ? budget.remainingPct : '—')}</div>`
          + `<div style="margin-top:4px">${esc((budget && budget.note) || '')}</div></div>`
          + `<div class="s-alert s-alert--muted" style="margin-top:var(--s-space-2)"><div class="s-alert__title">账户状态</div>`
          + `<div>可用现金 ${ACCOUNT ? wan(ACCOUNT.cash) : '—'}；冻结 ${ACCOUNT ? wan(ACCOUNT.freeze) : '—'}</div></div>`
          + `<p class="s-kpi__note" style="margin-top:var(--s-space-2)">冰点/退潮 regime 下提高建仓门槛、单笔预算收紧；条件由模拟盘引擎每日收盘批处理判定。</p>`;
      },
    });
  }

  /* ---------- 预览委托：真实校验（现金/数量/regime），不伪造提交 ---------- */
  function previewOrder() {
    const out = $('#sPpPreviewOut', currentPanel);
    if (!out || !ACCOUNT) return;
    const code = ($('#sPpCode', currentPanel) || {}).value || '';
    const qty = parseInt(($('#sPpQty', currentPanel) || {}).value || '0', 10);
    if (!/^\d{6}$/.test(code)) { out.textContent = '代码须为 6 位数字。'; return; }
    if (!qty || qty <= 0 || qty % 100 !== 0) { out.textContent = '数量须为 100 的整数倍。'; return; }
    const em = REGIME ? REGIME.emotion : null;
    const cold = em ? /冰点|退潮|偏冷/.test(em) : false;
    /* 真实规则：冰点/退潮 regime 提高门槛（原型 note「regime 冰点 → 单笔上限 1.00」口径）。
     * 预算槽单笔上限：常规 20% 现金、冷市 10%（对应 remainingPct 0.2 口径），无行情源不估价格。 */
    const capPct = cold ? 0.10 : 0.20;
    const cap = ACCOUNT.cash * capPct;
    out.textContent = `沙盒预览：${cold ? 'regime ' + em + ' → ' : ''}单笔预算上限 ${wan(Math.round(cap))}（现金 ${capPct * 100}%）。`
      + `委托提交走每日收盘批处理，网页端不实时成交。`;
  }

  /* ---------- 账户概要 + 委托表（真值） ---------- */
  function renderAccount() {
    if (!ACCOUNT || !currentPanel) return;
    const set = (id, v) => { const n = $('#' + id, currentPanel); if (n) n.textContent = v; };
    set('sPpInit', wanY(ACCOUNT.initCash));
    set('sPpCash', wanY(ACCOUNT.cash));
    const rz = $('#sPpRealized', currentPanel);
    if (rz) {
      const v = ACCOUNT.realized;
      rz.textContent = v == null ? '—' : (v >= 0 ? '+' : '') + wanY(v);
      rz.classList.toggle('s-kpi__value--down', !!v && v < 0);
    }
    set('sPpFee', wanY(ACCOUNT.totalFee));
    const nav = Array.isArray(ACCOUNT.nav) ? ACCOUNT.nav : [];
    if (nav.length) {
      const last = nav[nav.length - 1];
      set('sPpEquity', wanY(last.equity));
      set('sPpEquityDate', last.date || '—');
      set('sPpDays', String(nav.length));
    }
    set('sPpSettle', ACCOUNT.lastSettle ? '结算至 ' + ACCOUNT.lastSettle : '—');
    /* 委托表：真实 orders */
    const orders = Array.isArray(ACCOUNT.orders) ? ACCOUNT.orders : [];
    const oc = $('#sPpOrderCount', currentPanel);
    if (oc) oc.textContent = '共 ' + orders.length + ' 笔';
    const host = $('#sPpOrderHost', currentPanel);
    if (!host) return;
    const columns = [
      { key: 'submitDate', label: '日期', priority: 1, width: '14%' },
      { key: 'code', label: '代码', priority: 1, width: '12%' },
      { key: 'name', label: '名称', priority: 1, width: '16%' },
      { key: 'side', label: '方向', priority: 2, width: '10%' },
      { key: 'qty', label: '数量', priority: 2, width: '12%' },
      { key: 'submitPrice', label: '委托价', priority: 2, width: '12%' },
      { key: 'status', label: '状态', priority: 1, width: '12%' },
      { key: 'reason', label: '理由', priority: 3, width: '12%' },
    ];
    const renderRow = (o) => {
      const st = STATUS_LABEL[o.status] || { t: o.status || '—', c: '' };
      const side = o.side === 'buy' ? '买入' : '卖出';
      const sideCls = o.side === 'buy' ? 's-num--up' : 's-num--down';
      return `<tr><td>${esc(o.submitDate || '—')}</td><td>${esc(o.code || '—')}</td><td>${esc(o.name || '—')}</td>`
        + `<td class="s-num ${sideCls}">${side}</td><td class="s-num">${wan(o.qty)}</td>`
        + `<td class="s-num">${o.submitPrice != null ? (+o.submitPrice).toFixed(2) : '—'}</td>`
        + `<td class="s-num ${st.c}">${st.t}</td><td data-priority="3" title="${esc(o.reason || '')}">${esc((o.reason || '').slice(0, 18))}</td></tr>`;
    };
    if (S.Table && S.Table.mount) {
      if (tableApi && typeof tableApi.destroy === 'function') tableApi.destroy();
      tableApi = S.Table.mount(host, { rows: orders, columns, renderRow, label: '模拟盘委托记录' });
    } else {
      host.innerHTML = `<div class="s-table-wrap"><div class="s-table__viewport"><table class="s-table">`
        + `<thead><tr><th>日期</th><th>代码</th><th>名称</th><th>方向</th><th>数量</th><th>委托价</th><th>状态</th></tr></thead>`
        + `<tbody>${orders.map(renderRow).join('')}</tbody></table></div></div>`;
    }
    host.setAttribute('aria-busy', 'false');
  }

  function setNote(t) {
    const body = $('#sPpPosBody', currentPanel);
    if (body) body.innerHTML = `<p class="s-ph-desc">${esc(t)}</p>`;
    const host = $('#sPpOrderHost', currentPanel);
    if (host) { host.innerHTML = `<p class="s-ph-desc">${esc(t)}</p>`; host.setAttribute('aria-busy', 'false'); }
  }

  function fetchJSON(url) {
    return fetch(url + '?_=' + Date.now(), { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function load(panel) {
    currentPanel = panel;
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    let settled = false;
    const timeout = setTimeout(() => { if (!settled) { settled = true; setNote('模拟盘数据加载超时，请重试'); } }, 9000);
    loadTimer = timeout;
    Promise.all([
      fetchJSON('./data/paper/account.json'),
      fetchJSON('./data/emotion_history.json'),
      fetchJSON('./data/risk_budget_preview.json'),
    ]).then(([acc, eh, rb]) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); loadTimer = null;
      if (!enabled()) return;
      ACCOUNT = acc;
      const h = eh && Array.isArray(eh.history) && eh.history.length ? eh.history[eh.history.length - 1] : null;
      REGIME = h ? { emotion: h.emotion, score: h.score, date: h.date } : null;
      window.__sPpBudget = Array.isArray(rb) ? rb[rb.length - 1] : null;
      /* 门槛 note：真实 regime 口径 */
      const gn = $('#sPpGateNote', currentPanel);
      if (gn) {
        const em = REGIME ? REGIME.emotion : null;
        const cold = em ? /冰点|退潮|偏冷/.test(em) : false;
        gn.textContent = `门槛校验：regime ${em || '—'} → 单笔上限 ${cold ? '10%' : '20%'}；未通过时给出原因而非静默禁用。`;
      }
      renderPositions();
      renderAccount();
    }).catch(() => {
      if (settled) return;
      settled = true; clearTimeout(timeout); loadTimer = null;
      setNote('模拟盘数据加载失败');
    });
  }

  function teardown() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    if (tableApi && typeof tableApi.destroy === 'function') { tableApi.destroy(); tableApi = null; }
    ACCOUNT = null; REGIME = null; window.__sPpBudget = null;
    currentPanel = null;
  }

  function render(panel) {
    if (!panel) return;
    teardown();
    if (!enabled()) {
      panel.innerHTML = '<h2 class="s-ph-title">工作台 · 模拟盘</h2>'
        + '<p class="s-ph-desc">模拟盘视图已回退（flag paperV2=false），研报原节点未改动。</p>';
      return;
    }
    let host = panel.querySelector('.s-page-paper');
    if (!host) { host = shell(); panel.innerHTML = ''; panel.appendChild(host); }
    const gate = $('#sPpGateBtn', panel);
    if (gate) gate.addEventListener('click', openGateDrawer);
    const prev = $('#sPpPreview', panel);
    if (prev) prev.addEventListener('click', previewOrder);
    load(panel);
  }

  S.registerPagePaper = () => {
    if (typeof S.registerPage === 'function') S.registerPage('模拟盘', render, teardown);
  };
  S.registerPagePaper();
  S.teardownPaper = teardown;
})(window.S = window.S || {});
