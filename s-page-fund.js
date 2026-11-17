/* ══════════════════════════════════════════════════════════════════════════
 * s-page-fund.js — 工作台「资金」页（01 册 8 tab 规划表 #3 + 03 册 T3 空状态规格）
 * ──────────────────────────────────────────────────────────────────────────
 * 规格（01 册 L222）：三方数据未产出 → 不伪造：结构化空状态 T3 + 口径说明 +
 *   可用代理指标（龙虎净买）+ 刷新出口。补全稀疏 tab，但不填充估算值。
 * T3 规格（03 册 §8.1/8.2）：卡高 120px(<640 108px)；图形 40×40 单色线性，
 *   accent 20% 透明度；文案三段式「发生了什么+为什么+下一步」；动作=查看口径说明/刷新。
 * 硬边界：只新增文件；工作台自行 fetch 只读静态 JSON，不碰研报节点。
 * 代理指标数据源：data/signals-latest.json → signals.latestEmotion.lhb_daily_net（亿）
 *   与 lhb_stocks / lhb_daily_stocks（交易所公开龙虎榜口径，非三方估算）。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  let currentPanel = null;
  let SIG = null; // { latestEmotion:{lhb_daily_net,lhb_stocks,lhb_daily_stocks}, meta }

  function enabled() { return S.getFlag('fundV2', true) !== false; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function yi(v) { return (v == null || isNaN(+v)) ? '—' : ((+v) >= 0 ? '+' : '') + (+v).toFixed(2) + ' 亿'; }

  function shell() {
    const host = document.createElement('div');
    host.className = 's-page-fund';
    host.innerHTML =
      `<div class="s-section"><div class="s-section__head">`
      + `<h2 class="s-section__title">资金 · 三方口径</h2>`
      + `<p class="s-section__note">三方数据未产出 → 不伪造 · 结构化空状态 T3</p></div>`
      /* T3 空状态卡：120px 高、三段文案、两个动作（03 册 §8.1/8.2） */
      + `<div class="s-grid"><div class="s-col-8"><div class="s-card">`
      + `<div class="s-card__body"><div class="s-fund-t3" style="display:flex;align-items:center;gap:12px;min-height:120px;padding:20px">`
      + `<div style="width:40px;height:40px;flex:none;color:var(--s-accent);opacity:.2;font-size:34px;line-height:40px;text-align:center" aria-hidden="true">◇</div>`
      + `<div style="min-width:0">`
      + `<div style="font-weight:600;color:var(--s-text-1)">三方资金数据未产出</div>`
      + `<div style="color:var(--s-text-3);font-size:var(--s-font-sm);margin-top:8px">数据源未返回当日口径，本页不填充估算值。</div>`
      + `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">`
      + `<button type="button" class="s-btn s-btn--ghost" id="sFdGate">查看口径说明</button>`
      + `<button type="button" class="s-btn s-btn--ghost" id="sFdRefresh">刷新</button>`
      + `</div></div></div></div></div></div>`
      /* 可用代理指标卡：交易所公开龙虎榜口径（01 册 #3「可用代理指标」） */
      + `<div class="s-col-4"><div class="s-card"><div class="s-card__head"><h3 class="s-card__title">可用代理指标</h3><span class="s-badge s-badge--muted">交易所公开口径</span></div>`
      + `<div class="s-card__body">`
      + `<div class="s-kpi"><div class="s-kpi__label">龙虎净买（当日）</div>`
      + `<div class="s-kpi__value s-num" id="sFdLhb">—</div>`
      + `<div class="s-kpi__delta" id="sFdLhbDate">—</div></div>`
      + `<div class="s-kpi" style="margin-top:var(--s-space-2)"><div class="s-kpi__label">龙虎榜上榜</div>`
      + `<div class="s-kpi__value" id="sFdLhbCount">—</div>`
      + `<div class="s-kpi__delta">个股 / 沪深两市口径</div></div>`
      + `<p class="s-kpi__note" style="margin-top:var(--s-space-2)">龙虎榜为交易所公开披露口径，作为资金面代理指标；不含主力净流入等三方估算。</p>`
      + `</div></div></div>`
      + `</div></div>`
      /* 委托代理说明区：为什么只有代理（诚实交代数据管线现状） */
      + `<div class="s-section"><div class="s-alert s-alert--muted"><div class="s-alert__title">为什么本页是空状态</div>`
      + `<div>当前数据管线（34 个 data/*.json）不含三方资金流（主力净流入/大单口径）数据源；`
      + `按项目「不伪造三方资金数据」约束（01 册 N3），本页保持 T3 空状态而不填估算值。`
      + `龙虎榜代理指标见右侧卡片，数据随每日收盘批处理更新。</div></div></div>`;
    return host;
  }

  /* 口径说明抽屉：三段式（发生了什么/为什么/下一步） */
  function openGateDrawer() {
    if (typeof S.openDrawer !== 'function') return;
    const le = SIG && (SIG.latestEmotion || SIG.latest) || {};
    S.openDrawer({
      size: 'sm',
      title: '资金页口径说明',
      sub: 'T3 数据未产出 · 代理指标口径',
      render(body) {
        body.innerHTML =
          `<div class="s-alert s-alert--muted"><div class="s-alert__title">发生了什么</div>`
          + `<div>三方资金数据（主力净流入、大单/超大单口径）当日未产出。</div></div>`
          + `<div class="s-alert s-alert--muted" style="margin-top:var(--s-space-2)"><div class="s-alert__title">为什么</div>`
          + `<div>数据管线未接入三方资金流数据源；按「不伪造三方资金数据」约束，本页不填充估算值。</div></div>`
          + `<div class="s-alert s-alert--muted" style="margin-top:var(--s-space-2)"><div class="s-alert__title">下一步</div>`
          + `<div>可用代理指标：龙虎净买 ${le.lhb_daily_net != null ? yi(le.lhb_daily_net) : '—'}`
          + `（${le.lhb_daily_stocks != null ? le.lhb_daily_stocks + ' 只个股' : '—'}，交易所公开披露口径）。`
          + `数据源接入后本页自动切换为完整面板。</div></div>`;
      },
    });
  }

  function applyData(panel, sig) {
    if (!currentPanel) return;
    const le = (sig && (sig.latestEmotion || sig.latest)) || {};
    const set = (id, v, cls) => {
      const n = $('#' + id, currentPanel);
      if (!n) return;
      n.textContent = v;
      if (cls != null) n.className = cls;
    };
    /* 龙虎净买语义色：正=up 红(买入强) 负=down 绿 —— 站点口径红涨绿跌 */
    const v = le.lhb_daily_net;
    set('sFdLhb', yi(v), 's-kpi__value s-num' + (v == null ? '' : v >= 0 ? ' s-kpi__value--up' : ' s-kpi__value--down'));
    set('sFdLhbDate', (sig && sig.meta && sig.meta.tradeDate) ? '数据日 ' + sig.meta.tradeDate : '当日榜口径');
    set('sFdLhbCount', le.lhb_stocks != null ? String(le.lhb_stocks) : '—');
  }

  function setNote(t) {
    if (!currentPanel) return;
    const host = $('.s-page-fund', currentPanel);
    if (host) host.innerHTML = `<p class="s-ph-desc">${esc(t)}</p>`;
  }

  function load(panel) {
    currentPanel = panel;
    fetch('./data/signals-latest.json?_=' + Date.now(), { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((sig) => { if (enabled()) applyData(panel, sig); SIG = sig; })
      .catch(() => { if (enabled()) setNote('资金页代理指标加载失败，请刷新重试'); });
  }

  function teardown() { currentPanel = null; SIG = null; }

  function render(panel) {
    if (!panel) return;
    teardown();
    if (!enabled()) {
      panel.innerHTML = '<h2 class="s-ph-title">工作台 · 资金</h2>'
        + '<p class="s-ph-desc">资金视图已回退（flag fundV2=false），研报原节点未改动。</p>';
      return;
    }
    let host = panel.querySelector('.s-page-fund');
    if (!host) { host = shell(); panel.innerHTML = ''; panel.appendChild(host); }
    const gate = $('#sFdGate', panel);
    if (gate) gate.addEventListener('click', openGateDrawer);
    const rf = $('#sFdRefresh', panel);
    if (rf) rf.addEventListener('click', () => location.reload());
    load(panel);
  }

  S.registerPageFund = () => {
    if (typeof S.registerPage === 'function') S.registerPage('资金', render, teardown);
  };
  S.registerPageFund();
  S.teardownFund = teardown;
})(window.S = window.S || {});
