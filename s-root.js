/* ══════════════════════════════════════════════════════════════════════════
 * s-root.js — A 方案阶段 1：工作台根（#sRoot.s-scope）与深链路由
 * ──────────────────────────────────────────────────────────────────────────
 * 职责（本文件只做「地基」，不做「重搬」）：
 *   1. 创建 #sRoot.s-scope（默认 hidden，真隐藏 [hidden]，非 display）。
 *   2. 深链路由：?view=workbench / #workbench → 激活工作台；
 *      ?view=terminal / #terminal 与默认交由 terminal.js / app.js 各自处理。
 *   3. S.setFlag / S.getFlag：阶段 1+ 的回退开关（如 defaultWorkbench）。
 *   4. 工作台激活时：body[data-view="workbench"]（隐藏 #t-entry）+ 显示 #sRoot
 *      + 隐藏 #tRoot（避免 activeRoots 叠加）+ 把研报视图 aria-hidden（占位，
 *      真正搬节点由 s-adapter.js 负责）。
 *
 * 白屏守护：#sRoot 在 WORKBENCH 激活前保持 hidden；激活时 buildShell() 注入
 *   真实最小骨架（header + nav + 欢迎面板 + 内联 SVG sparkline），sRootChildren>0，
 *   绝不让 #sRoot 空屏。真正的研报视图重搬 + LW canvas re-init 在 s-adapter.js。
 *
 * 幂等：route() 可重复调用；buildShell() 仅首次构建。hashchange / popstate 重路由。
 * 零副作用：默认（无 workbench 深链）下本文件不改动任何既有视图可见性。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';

  S = S || (window.S = window.S || {});

  /* ---------- 阶段 1+ 回退开关 ---------- */
  const flags = Object.create(null);
  S.setFlag = (name, val) => { flags[name] = val; return val; };
  S.getFlag = (name, dflt) => (name in flags ? flags[name] : dflt);

  /* ---------- DOM 助手（与 terminal.js 同款，避免引入依赖） ---------- */
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
    } catch (_) { /* 忽略：file:// 或非标准 URL */ }
    return null;
  }

  let shellBuilt = false;
  function buildShell() {
    const root = $('sRoot');
    if (!root || shellBuilt) return;
    shellBuilt = true;

    const top = el('header', 's-topbar',
      '<span class="s-brand">A股情绪 · 工作台</span>'
      + '<span class="s-dot" aria-hidden="true"></span>'
      + '<span class="s-sub">A 方案 · 阶段 1 骨架（重搬占位）</span>'
      + '<span class="s-nav" role="group" aria-label="视图">'
      + ['总览', '涨跌停', '资金', '板块', '选股', '回测', '模拟盘', '研报', '设置']
          .map((n) => `<button type="button" disabled>${n}</button>`).join('')
      + '</span>');

    const body = el('div', 's-main');
    body.appendChild(el('div', 's-welcome',
      '<h2>工作台骨架已就位</h2>'
      + '<p>这是 A 方案阶段 1 的工作台根（<code>#sRoot.s-scope</code>）。当前为路由与双根隔离的验证骨架；'
      + '真正的内容重搬（研报视图 DOM 迁移 + Lightweight Charts canvas re-init）由 <code>s-adapter.js</code> 接管。</p>'
      + '<p class="s-hint">深链 <code>?view=workbench</code> / <code>#workbench</code> 可幂等直达；'
      + '默认仍为研报视图。门禁自检 <code>S.runSelfTest()</code> 在新根下可运行。</p>'));

    // 内联 SVG sparkline：证明骨架真的渲染（非白屏），且无横向溢出
    const spark = '<svg class="s-spark" viewBox="0 0 320 80" preserveAspectRatio="none" role="img" aria-label="示例走势">'
      + '<polyline points="0,64 32,52 64,58 96,38 128,44 160,26 192,32 224,18 256,24 288,12 320,18" '
      + 'fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    body.appendChild(el('div', 's-sparkwrap', spark));

    root.appendChild(top);
    root.appendChild(body);
  }

  function route(view) {
    const sRoot = $('sRoot');
    const tRoot = $('tRoot');
    const main = document.querySelector('main') || $('app');
    const wantBench = view === 'workbench';

    if (wantBench) {
      document.body.dataset.view = 'workbench';
      if (sRoot) { buildShell(); sRoot.hidden = false; }
      if (tRoot) tRoot.hidden = true;            // 防止 activeRoots 叠加（R2 互斥）
      if (main) main.setAttribute('aria-hidden', 'true');
    } else {
      delete document.body.dataset.view;
      if (sRoot) sRoot.hidden = true;
      if (main) main.removeAttribute('aria-hidden');
    }
  }

  /* ---------- 启动 ---------- */
  function init() {
    // 建立 #sRoot（默认 hidden）
    if (!$('sRoot')) {
      const r = el('div', 's-scope');
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
  // 深链变化（用户手改 hash / 前进后退）幂等重路由
  window.addEventListener('hashchange', () => {
    const v = parseView();
    route(v === 'workbench' ? 'workbench' : 'report');
  });

  S.routeWorkbench = route;
})(window.S = window.S || {});
