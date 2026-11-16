/* ══════════════════════════════════════════════════════════════════════════
 * s-root.js — A 方案阶段 1：工作台根（#sRoot.s-scope.s-app）与深链路由
 * ──────────────────────────────────────────────────────────────────────────
 * 对应 05 册 L95/L96 的 s-mount.js + s-adapter.js + s-flags.js 三件套的落地合并
 * （文件名合并为一，逻辑等价；阶段 2 的「幂等重搬」在 s-page-overview.js，
 * 阶段 3 的 canvas re-init 在 s-table.js / s-page-backtest.js，本文件只做骨架）。
 *
 * 职责（零 DOM 搬迁，纯视图路由）：
 *   1. 创建 #sRoot.s-scope.s-app（默认 hidden，真隐藏 [hidden]，非 display）。
 *   2. 深链路由：?view=workbench / #workbench → 激活工作台；其余归研报视图。
 *   3. S.setFlag / S.getFlag：阶段 1+ 回退开关（如 defaultWorkbench）。
 *   4. 工作台激活时：body[data-view="workbench"]（隐藏 #t-entry）+ 显示 #sRoot
 *      + 隐藏研报 <main> 与 #preMainPanels（专用视图 CSS 双保险，**不碰 aria-hidden**，
 *      因 aria-hidden 是本站 fatal 兜底信号，会被 app.js 清空）+ 隐藏 #tRoot。
 *
 * 白屏守护：#sRoot 在 WORKBENCH 激活前保持 hidden；激活时 buildShell() 注入
 *   真实最小骨架（8 tab 路由 + 空 panel + 内联 SVG sparkline），sRootChildren>0，
 *   绝不空屏。内容重搬由阶段 2 s-page-overview.js 接管。
 *
 * 幂等：route() 可重复调用；buildShell() 仅首次构建；hashchange / popstate 重路由。
 * 零副作用：默认（无 workbench 深链）下本文件不改动任何既有视图可见性。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';

  S = S || (window.S = window.S || {});

  /* ---------- 阶段 1+ 回退开关（21 册 §2.2 兼容性升级） ----------
   * 保留线上 S.getFlag(name,dflt) 签名与各调用点默认语义（overview/tableV2/drawerV2/reportV2
   * 默认 true，defaultWorkbench 默认 false=默认研报铁律），只叠加 URL/localStorage 解析层。
   * 严禁照搬 05 册字面契约（全 flag 默认 false + 无 getFlag 方法）——那会让阶段 2/3/4 崩。
   * URL 入口 ?sflag-overview=0 / ?sflag-defaultWorkbench=0 对齐 05 册 L60 回滚示例。
   * 不改变默认视图：route() 的 wantBench=view==='workbench' 不读 flag，阶段 5 才改默认路由。 */
  let params;
  try { params = new URLSearchParams(location.search); }
  catch (e) { params = new URLSearchParams(); }
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('sFlags') || '{}') || {}; }
  catch (e) { stored = {}; }
  function readFlag(name, dflt) {
    const key = 'sflag-' + name;
    if (params.has(key)) return params.get(key) === '1';
    if (Object.prototype.hasOwnProperty.call(stored, name)) return Boolean(stored[name]);
    return dflt; // 关键：保留调用方默认，overview 仍默认 true
  }
  S.flags = {
    mount: readFlag('mount', false),
    overview: readFlag('overview', true),
    tableV2: readFlag('tableV2', true),
    drawerV2: readFlag('drawerV2', true),
    reportV2: readFlag('reportV2', true),
    defaultWorkbench: readFlag('defaultWorkbench', false)
  };
  const flags = Object.create(null);
  S.setFlag = function (name, val) {
    flags[name] = Boolean(val);
    S.flags[name] = Boolean(val);
    try {
      const merged = Object.assign({}, stored, S.flags);
      localStorage.setItem('sFlags', JSON.stringify(merged));
    } catch (e) { /* storage disabled: flag applies to this page load only */ }
    return val;
  };
  S.getFlag = function (name, dflt) {
    if (name in flags) return flags[name];                              // 运行时 setFlag 优先
    if (Object.prototype.hasOwnProperty.call(S.flags, name)) return S.flags[name]; // URL/storage 覆盖
    return dflt;                                                        // 兜底调用方默认
  };

  /* ---------- 页路由（阶段 2+ 逐页接入；注册页优先，否则占位） ---------- */
  const TABS = ['总览', '涨跌停', '资金', '板块', '选股', '回测', '模拟盘', '研报'];
  const pages = Object.create(null);       // name → { render, teardown }
  let currentPage = null;
  S.registerPage = (name, fn, teardown) => { pages[name] = { render: fn, teardown: teardown || null }; };
  function teardownCurrent() {
    if (!currentPage) return;
    const rec = pages[currentPage];
    if (rec && typeof rec.teardown === 'function') {
      try { rec.teardown(); } catch (e) { try { console.error('[s-root] 页面清理失败', currentPage, e); } catch (_) {} }
    }
    currentPage = null;
  }
  function showPage(name, panel) {
    panel = panel || document.querySelector('#sRoot .s-ph-panel');
    if (!panel) return;
    if (currentPage !== name) {
      teardownCurrent(); // 【14 册门禁⑧】离开旧页先清理 chart/tooltip
      if (typeof S.onTabChange === 'function') { try { S.onTabChange(); } catch (_) {} } // 【16 册门禁⑤】切 tab 关抽屉
    }
    currentPage = name;
    const rec = pages[name];
    if (rec && typeof rec.render === 'function') {
      try { rec.render(panel); } catch (e) { try { console.error('[s-root] 页面渲染失败', name, e); } catch (_) {} }
    } else {
      panel.innerHTML = `<h2 class="s-ph-title">工作台 · ${name}</h2>`
        + `<p class="s-ph-desc"><code>${name}</code> 视图：阶段 2+ 逐页接入（幂等重搬旧 render 产出节点）。</p>`;
    }
  }
  S.showPage = (name) => showPage(name);

  /* ---------- DOM 助手 ---------- */
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------- 视图判断 ---------- */
  function parseView() {
    try {
      const h = location.hash || '';
      if (h === '#workbench' || h === '#terminal') return h.slice(1);
      const v = new URLSearchParams(location.search).get('view');
      if (v === 'workbench' || v === 'terminal') return v;
    } catch (_) { /* file:// 或非标准 URL */ }
    return null;
  }

  let shellBuilt = false;
  function buildShell() {
    const root = $('sRoot');
    if (!root || shellBuilt) return;
    shellBuilt = true;

    const nav = TABS.map((n, i) =>
      `<button type="button" data-page="${i}" class="s-ph-tab${i === 0 ? ' is-active' : ''}">${n}</button>`
    ).join('');

    const top = el('header', 's-ph-topbar',
      '<span class="s-ph-brand">A股情绪 · 工作台</span>'
      + '<span class="s-ph-dot" aria-hidden="true"></span>'
      + '<span class="s-ph-sub">A 方案 · 阶段 1 骨架（深链路由 + 空 panel）</span>'
      + `<span class="s-ph-nav" role="group" aria-label="视图">${nav}</span>`);

    const body = el('div', 's-ph-main');
    body.appendChild(el('div', 's-ph-panel',
      '<h2 class="s-ph-title">工作台骨架已就位</h2>'
      + '<p class="s-ph-desc">这是 A 方案阶段 1 的工作台根（<code>#sRoot.s-scope.s-app</code>）。'
      + '当前为深链路由骨架：8 个可路由 tab + 空 panel。真正的视图内容按 05 册 L123 在'
      + '阶段 2（<code>s-page-overview.js</code> 幂等重搬旧 render 产出节点）接入。</p>'
      + '<p class="s-ph-hint">深链 <code>?view=workbench</code> / <code>#workbench</code> 可幂等直达；'
      + '默认仍为研报视图。门禁自检 <code>S.runSelfTest()</code> 在新根下可运行。</p>'));

    const spark = '<svg class="s-ph-spark" viewBox="0 0 320 80" preserveAspectRatio="none" role="img" aria-label="示例走势">'
      + '<polyline points="0,64 32,52 64,58 96,38 128,44 160,26 192,32 224,18 256,24 288,12 320,18" '
      + 'fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    body.appendChild(el('div', 's-ph-sparkwrap', spark));

    root.appendChild(top);
    root.appendChild(body);

    // 8 tab 路由：切换高亮 + 切换 panel（注册页优先渲染，否则占位）
    const tabs = top.querySelectorAll('.s-ph-tab');
    const panel = body.querySelector('.s-ph-panel');
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabs.forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        showPage(TABS[+btn.dataset.page], panel);
      });
    });
  }

  let hidTRoot = false;
  function route(view) {
    const sRoot = $('sRoot');
    const tRoot = $('tRoot');
    const main = document.querySelector('main');
    const pre = $('preMainPanels');
    const wantBench = view === 'workbench';

    if (wantBench) {
      document.body.dataset.view = 'workbench';
      if (sRoot) { buildShell(); sRoot.hidden = false; showPage(TABS[0]); }
      if (tRoot && !tRoot.hidden) { tRoot.hidden = true; hidTRoot = true; }
      if (main) main.hidden = true;            // 不用 aria-hidden（fatal 兜底信号，会被 app.js 清空）
      if (pre) pre.hidden = true;              // <main> 之外的告警浮层一并收起
      // 隐藏规则由 style.css 的 body[data-view="workbench"] > main / > #preMainPanels 双保险
    } else {
      teardownCurrent(); // 【14 册门禁⑧】离开工作台 → 清理当前页 chart/tooltip，避免隐藏后残留
      delete document.body.dataset.view;
      if (sRoot) sRoot.hidden = true;
      if (main) main.hidden = false;
      if (pre) pre.hidden = false;
      // 只恢复「本次由我隐藏」的 tRoot，避免误放终端覆盖层
      if (hidTRoot && tRoot) { tRoot.hidden = false; hidTRoot = false; }
    }
  }

  /* ---------- 启动 ---------- */
  function init() {
    if (!$('sRoot')) {
      const r = el('div', 's-scope s-app');   // s-app：全屏根（min-height:100dvh / flex 列）
      r.id = 'sRoot';
      r.hidden = true;
      document.body.appendChild(r);
    }
    const v = parseView();
    if (v === 'workbench') route('workbench');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // 深链变化（hash 或 history 回退前进）幂等重路由
  window.addEventListener('hashchange', () => {
    route(parseView() === 'workbench' ? 'workbench' : 'report');
  });
  window.addEventListener('popstate', () => {
    route(parseView() === 'workbench' ? 'workbench' : 'report');
  });

  S.routeWorkbench = route;
})(window.S = window.S || {});
