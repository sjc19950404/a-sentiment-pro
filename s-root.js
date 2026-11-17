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
    /* 【用户拍板 2026-11-17】默认视图切工作台（原 false=默认研报）。
     * 回退：?sflag-defaultWorkbench=0 或 ?view=research。 */
    defaultWorkbench: readFlag('defaultWorkbench', true)
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
      panel.innerHTML = `<h2 class="s-ph-title">${name}</h2>`
        + `<p class="s-ph-desc">该视图正在建设中，敬请期待。</p>`;
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
  /* 【用户拍板 2026-11-17】跳过观测期直接翻默认视图：
   * - 无参数（默认）→ 读 defaultWorkbench flag（现默认 true = 工作台）
   * - ?view=research / #research → 明确回原研报（工作台「研报」tab 也跳这里）
   * - ?view=workbench / #workbench → 工作台
   * - ?view=terminal / #terminal → 原终端视图语义不变（老收藏链接不破）
   * 回退开关：?sflag-defaultWorkbench=0 恢复默认研报（21 册 flag 契约） */
  function parseView() {
    try {
      const h = location.hash || '';
      const v = new URLSearchParams(location.search).get('view');
      const pick = (x) => (x === 'workbench' || x === 'terminal' || x === 'research') ? x : null;
      const got = pick(v) || pick(h.replace('#', ''));
      if (got) return got;
    } catch (_) { /* file:// 或非标准 URL */ }
    return null;
  }

  let shellBuilt = false;
  function buildShell() {
    const root = $('sRoot');
    if (!root || shellBuilt) return;
    shellBuilt = true;

    /* 【25B/原型对齐】外壳改用原型语义类名（.s-topbar/.s-nav/.s-main/.s-page），
     * 样式库 components.css 里本就完整存在——此前自造 s-ph-* 壳是"结构对、观感不对"的根因。
     * 删除了尾部悬空 sparkline 装饰假图（s-ph-sparkwrap，25B 点名移除）。
     * 主导航独立成行（原型 L59-69），不再挤在顶栏里。 */

    // 主导航：独立一行，8 tab（06 册阶段 1 裁定；原型 9 含「系统设置」待阶段 5+）
    const nav = TABS.map((n, i) =>
      '<a class="s-nav__link' + (i === 0 ? ' is-active' : '') + '" href="#workbench" data-page="' + i + '"'
      + (i === 0 ? ' aria-current="page"' : '') + '>' + n + '</a>'
    ).join('');

    const top = el('header', 's-topbar',
      /* brand：◆ 图标 + 完整品牌名 + PRO 徽章（原型 L31-35） */
      '<div class="s-topbar__brand">'
      +   '<span style="color:var(--s-accent);font-size:18px;line-height:1">◆</span>'
      +   '<span>A股情绪 · 研究工作台</span>'
      +   '<span class="s-proto-flag hide-sm">PRO / v1</span>'
      + '</div>'
      /* meta 排（原型 L36-42）：数值由 s-page-overview-evidence.js fillTopbar 运行时填充 */
      + '<div class="s-topbar__meta hide-sm">'
      +   '<span class="s-badge s-badge--muted" id="sPhSession">—</span>'
      +   '<span>数据日 <b class="s-num" id="sPhTradeDate" style="color:var(--s-text-2)">—</b></span>'
      +   '<span>源健康 <b class="s-num" id="sPhHealth" style="color:var(--s-down)">—</b></span>'
      +   '<span>regime 序列 90 日</span>'
      +   '<span id="sPhFresh" aria-live="polite">—</span>'
      + '</div>'
      /* actions（原型 L43-55）：时间窗 chips + 刷新/导出；骨架态/浅色是原型演示开关，产品不带 */
      + '<div class="s-topbar__actions">'
      +   '<div class="s-tagrow hide-sm" role="group" aria-label="时间窗">'
      +     [20, 30, 60, 90].map((n) => '<button type="button" class="s-chip" data-ev-range="' + n + '" aria-pressed="' + (n === 60) + '">' + n + '</button>').join('')
      +   '</div>'
      +   '<button type="button" class="s-btn s-btn--ghost" id="sPhRefresh">刷新</button>'
      +   '<button type="button" class="s-btn s-btn--ghost hide-sm" id="sPhExport">导出</button>'
      + '</div>');

    const navEl = el('nav', 's-nav', nav);
    navEl.setAttribute('aria-label', '主视图导航');

    const body = el('main', 's-main');
    /* panel 同时挂 .s-page（原型页面容器：max-width + padding，替代自造的 s-ph-main 24/32 padding） */
    const panel = el('div', 's-page s-ph-panel');
    panel.appendChild(el('div', 's-ph-placeholder',
      '<h2 class="s-ph-title">视图加载中</h2>'
      + '<p class="s-ph-desc">该视图内容将在数据到达后渲染。深链 <code>?view=workbench</code> / <code>#workbench</code> 可幂等直达；默认仍为研报视图。</p>'));
    body.appendChild(panel);

    root.appendChild(top);
    root.appendChild(navEl);
    root.appendChild(body);
    /* 【25 册 P2-6】页脚：数据口径声明 + 免责（类名同时带 s-ph-foot 兼容 25B 验收断言） */
    root.appendChild(el('footer', 's-ph-footer s-ph-foot',
      '<span>数据口径：收盘后研判 · 情绪分 / 宽度 / 席位为当日快照</span>'
      + '<span>数据仅供参考，非投资建议</span>'));

    /* 顶栏操作按钮：刷新 / 导出（导出接阶段 4b 的 report.html 导出页） */
    const btnRefresh = top.querySelector('#sPhRefresh');
    const btnExport = top.querySelector('#sPhExport');
    if (btnRefresh) btnRefresh.addEventListener('click', () => location.reload());
    if (btnExport) btnExport.addEventListener('click', () => window.open('report.html', '_blank'));

    // 8 tab 路由：切换 s-nav__link 高亮 + 切换 panel（注册页优先渲染，否则占位）
    // 「研报」tab 特殊：跳回原研报视图（?view=research），保留完整研报能力
    const links = navEl.querySelectorAll('.s-nav__link');
    links.forEach((a) => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (TABS[+a.dataset.page] === '研报') {
          location.href = location.pathname + '?view=research';
          return;
        }
        links.forEach((b) => { b.classList.remove('is-active'); b.removeAttribute('aria-current'); });
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
        showPage(TABS[+a.dataset.page], panel);
      });
    });
  }

  let hidTRoot = false;
  function route(view) {
    const sRoot = $('sRoot');
    const tRoot = $('tRoot');
    const main = document.querySelector('main');
    const pre = $('preMainPanels');
    /* 【用户拍板 2026-11-17】默认视图由 defaultWorkbench flag 决定（现默认 true=工作台）。
     * ?view=research 明确回研报；?view=terminal 语义不变；?sflag-defaultWorkbench=0 一键回退。 */
    const wantBench = view === 'workbench'
      || (view == null && S.getFlag('defaultWorkbench', false));

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
    route(v); // 任何值都路由：null→读 defaultWorkbench flag；research→研报；terminal→终端语义
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // 深链变化（hash 或 history 回退前进）幂等重路由：透传 parseView 结果，
  // null 时由 route() 按 defaultWorkbench flag 决定（与 init 语义一致）
  window.addEventListener('hashchange', () => { route(parseView()); });
  window.addEventListener('popstate', () => { route(parseView()); });

  S.routeWorkbench = route;
})(window.S = window.S || {});
