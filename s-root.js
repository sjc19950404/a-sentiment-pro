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
  /* 【原型字面 2026-11-18】9 tab 严格按视觉稿原型：总览/涨跌停/资金/板块/选股/
   * 回测/模拟盘/研报/系统设置——无 K线 tab。此前我擅自加了 K线变 10 tab，用户未授权。
   * K线页代码保留（选股/模拟盘点行下钻进入），但导航不单列。
   * 研报仍最后一项（点击跳回原研报视图 ?view=research）。 */
  const TABS = ['总览', '涨跌停', '资金', '板块', '选股', '回测', '模拟盘', '研报', '系统设置'];
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
    /* 【P1-5 切换反馈 2026-11-19】render 同步注入壳（含「加载中…」占位），但异步数据
     * 要 6~8s 才到——期间无任何视觉反馈，像「点了没反应」。加顶部 2px 流动进度条：
     * 内容（.s-card/.s-section）挂载后由 observer 自动移除；9s 兜底移除防残留。 */
    try {
      const bar = el('div', 's-tabload');
      bar.style.position = 'sticky';
      panel.prepend(bar);
      const mo = new MutationObserver(() => {
        if (panel.querySelector('.s-card, .s-table, .s-kpi')) { mo.disconnect(); bar.remove(); }
      });
      mo.observe(panel, { childList: true, subtree: true });
      setTimeout(() => { try { mo.disconnect(); bar.remove(); } catch (_) {} }, 9000);
    } catch (_) {}
    const rec = pages[name];
    if (rec && typeof rec.render === 'function') {
      try { rec.render(panel); } catch (e) { try { console.error('[s-root] 页面渲染失败', name, e); } catch (_) {} }
    } else {
      /* 【原型 L345-355 generic 对齐】未实现 tab 显示结构契约说明（原型原样），
       * 不放假图表（不造假原则——原型的示例 svg 是设计示意，生产不伪造数据面板）。 */
      panel.innerHTML =
        `<section class="s-section">`
        + `<div class="s-section__head"><h2 class="s-section__title">${name}</h2>`
        + `<p class="s-section__note">沿用同一顶栏 / 栅格 / 卡片 / 抽屉契约</p></div>`
        + `<div class="s-demo"><b>建设中：</b>该视图的数据面板尚未接入。已实现视图：总览 / 涨跌停 / 回测 / 模拟盘；「研报」点击跳回完整研报。数据层零改动，接入后自动复用同一组件契约。</div>`
        + `<div class="s-struct" style="margin-top:var(--s-space-3)">`
        + `<div class="s-struct__cell"><b>结论指标条</b><span>4–6 个 KPI，单行进入首屏折叠线</span></div>`
        + `<div class="s-struct__cell"><b>主图区</b><span>12 列栅格 8/4，aspect-ratio 锁尺寸</span></div>`
        + `<div class="s-struct__cell"><b>明细表</b><span>data-priority 列分级，窄屏零溢出</span></div>`
        + `<div class="s-struct__cell"><b>下钻门</b><span>点行开抽屉，重内容不占主页面</span></div>`
        + `</div>`
        + `<div class="s-alert s-alert--muted" style="margin-top:var(--s-space-3)"><div class="s-alert__title">数据源正常</div>`
        + `<div>该视图数据未产出时不伪造，展示克制空状态。</div></div>`
        + `</section>`;
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
  /* 【方案 2.2/2.3 深链映射】
   * ?view=terminal / #terminal → 幂等落主视图（标记埋点，不改 UI，不回环）
   * ?view=report  / #report   → 研报长文专用页（优先级高于 terminal）
   * ?view=research            → 强制回原研报（A→B 回滚开关，保留）
   * ?view=workbench           → 主视图
   * 同时带 ?view=report 与 #terminal → report 优先（避免两视图争抢）。 */
  function parseView() {
    try {
      const h = location.hash || '';
      const q = new URLSearchParams(location.search);
      const v = q.get('view');
      const hv = h.replace(/^#/, '');
      const pick = (x) => (x === 'workbench' || x === 'terminal' || x === 'research' || x === 'report') ? x : null;
      const got = pick(v) || pick(hv);
      if (got) {
        /* 埋点标记：只在首次由 legacy terminal 深链进入时打，不改 UI */
        if (got === 'terminal' && !sessionStorage.getItem('sLegacyTerminal')) {
          try { sessionStorage.setItem('sLegacyTerminal', '1'); } catch (_) {}
          document.documentElement.dataset.viewSource = 'legacy-terminal';
          document.body.dataset.viewSource = 'legacy-terminal';
        }
        /* 归一化：terminal → workbench（replaceState 不 pushState，防回环；原参数保留不报错）
         * research/report 保留原参数（回退与专用页需要读） */
        if (got === 'terminal' && location.search) {
          const nq = new URLSearchParams(location.search);
          nq.set('view', 'workbench');
          const url = location.pathname + '?' + nq.toString() + location.hash;
          history.replaceState(history.state, '', url);
        }
        if (got === 'terminal') return 'workbench';
        return got;
      }
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
    /* 【方案 03 册 §1.2】1024–1439 末端「⋯」溢出菜单：后 3 项收进菜单（≤6 常驻）。
     * 链接带 data-overflow="1"，CSS 在该档隐藏；⋯ 菜单复用同一 TABS 索引绑定。 */
    const nav = TABS.map((n, i) =>
      '<a class="s-nav__link' + (i === 0 ? ' is-active' : '') + '" href="#workbench" data-page="' + i + '"'
      + (i >= 6 ? ' data-overflow="1"' : '')
      + (i === 0 ? ' aria-current="page"' : '') + '>' + n + '</a>'
    ).join('')
      + '<button type="button" class="s-nav__more" id="sNavMore" role="menu" aria-haspopup="true" aria-expanded="false" aria-label="更多视图">⋯</button>'
      + '<div class="s-nav__overflow" id="sNavOverflow" role="menu" aria-hidden="true">'
      + TABS.map((n, i) => (i >= 6
        ? '<a class="s-nav__link" role="menuitem" href="#workbench" data-page="' + i + '">' + n + '</a>' : '')).join('')
      + '</div>';

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
      /* actions（原型 L43-55）：时间窗 + 骨架态/浅色/刷新/导出/更多，逐字对齐原型。
       * 【2026-11-18 修正】此前注释「骨架态/浅色是演示开关产品不带」是我擅自裁定，
       * 用户未授权——现按原型一字不差补齐四个按钮及其交互。 */
      + '<div class="s-topbar__actions">'
      +   '<div class="s-tagrow hide-sm" role="group" aria-label="时间窗">'
      +     [20, 30, 60, 90].map((n) => '<button type="button" class="s-chip" data-ev-range="' + n + '" title="regime 序列回看 ' + n + ' 个交易日" aria-pressed="' + (n === 60) + '">' + n + '</button>').join('')
      +   '</div>'
      +   '<button type="button" class="s-btn s-btn--ghost hide-sm" id="sPhSkeleton">骨架态</button>'
      +   '<button type="button" class="s-btn s-btn--ghost hide-sm" id="sPhTheme">浅色</button>'
      +   '<button type="button" class="s-btn s-btn--ghost" id="sPhRefresh">刷新</button>'
      +   '<button type="button" class="s-btn s-btn--ghost hide-sm" id="sPhExport">导出</button>'
      +   '<button type="button" class="s-btn s-btn--primary only-sm" id="sPhMore">更多</button>'
      /* 【原型 / 聚焦搜索】工作台搜索入口（不在原型静态 DOM，但原型脚本 L570 明确引用 #hotSearch） */
      +   '<input id="sPhSearch" class="s-input hide-sm" type="search" placeholder="搜索代码 / 名称 / 诱因…" aria-label="搜索个股" style="width:180px">'
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
      + '<span>数据仅供参考，非投资建议</span>'
      /* 【原型 L372】页脚提示逐字补齐：此前偷懒未做 */
      + '<span class="hide-sm">点表格行可下钻 · 按 / 聚焦搜索 · 1-9 切视图</span>'));
    /* 【原型 L371-378】移动端底栏：◆总览/▥涨跌停/◎选股/▤回测/⋯更多（CSS 已在 components.css） */
    const mbar = el('nav', 's-mobilebar');
    mbar.setAttribute('aria-label', '移动端主导航');
    mbar.innerHTML = [
      ['◆', '总览', 'overview'], ['▥', '涨跌停', 'zt'],
      ['◎', '选股', 'picks'], ['▤', '回测', 'backtest'],
    ].map(([icon, label, tab], i) =>
      '<button type="button" class="s-mobilebar__item" data-tab="' + tab + '"'
      + (i === 0 ? ' aria-current="page"' : '') + '><span class="s-mobilebar__icon">' + icon + '</span>' + label + '</button>'
    ).join('') + '<button type="button" class="s-mobilebar__item" id="sPhMoreMobile"><span class="s-mobilebar__icon">⋯</span>更多</button>';
    root.appendChild(mbar);
    /* 【2026-11-25 修复】底栏按钮的 data-tab 是英文标识（overview/zt/picks/backtest），
     * 旧转发却拿它跟 TABS[+a.dataset.page]（中文名 '总览'/'涨跌停'…）比较——两边恒不
     * 相等、link 恒 null，底栏四个 tab 从来点不动。补显式中英映射；同时点击后同步底栏
     * 高亮（旧逻辑只更新顶部 nav 的 is-active，底栏永远停在"总览"）。 */
    const MOBILE_TAB_TO_NAME = Object.freeze({
      overview: '总览', zt: '涨跌停', picks: '选股', backtest: '回测',
    });
    /* 挂 window 供回归测试读取（源码守卫 test/s_root_mobilebar.test.mjs）。 */
    try { window.__sRootMobileTabMap__ = MOBILE_TAB_TO_NAME; } catch (e) { /* 非浏览器环境静默 */ }
    mbar.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      const targetName = MOBILE_TAB_TO_NAME[b.dataset.tab];
      if (!targetName) return;
      const link = [...navEl.querySelectorAll('.s-nav__link')].find((a) => a.dataset.page != null
        && TABS[+a.dataset.page] === targetName);
      mbar.querySelectorAll('[data-tab]').forEach((x) => x.removeAttribute('aria-current'));
      b.setAttribute('aria-current', 'page');
      if (link) link.click();
    }));
    mbar.querySelector('#sPhMoreMobile').addEventListener('click', () => {
      if (typeof S.openMoreDrawer === 'function') S.openMoreDrawer();
    });

    /* 顶栏操作按钮：刷新 / 导出（导出接阶段 4b 的 report.html 导出页） */
    const btnRefresh = top.querySelector('#sPhRefresh');
    const btnExport = top.querySelector('#sPhExport');
    if (btnRefresh) btnRefresh.addEventListener('click', () => {
      /* 原型 L578：点击→刷新状态变「刚刚 · 已是最新」+ 按钮「已刷新」；生产动作更实（真 reload） */
      const fresh = top.querySelector('#sPhFresh');
      if (fresh) fresh.textContent = '刚刚 · 已是最新';
      btnRefresh.textContent = '已刷新';
      setTimeout(() => { btnRefresh.textContent = '刷新'; location.reload(); }, 600);
    });
    if (btnExport) btnExport.addEventListener('click', () => {
      btnExport.textContent = '导出 12 项';
      setTimeout(() => { btnExport.textContent = '导出'; }, 1600);
      window.open('./?view=report', '_blank');   // C终态：report.html 是 11-13 静态示意页，真实长文在 ?view=report
    });
    /* 【原型 L576】骨架态：KPI 行临时换 6 张骨架卡 1.8s */
    const btnSkel = top.querySelector('#sPhSkeleton');
    if (btnSkel) btnSkel.addEventListener('click', () => {
      const grid = document.getElementById('sKpiRow');
      if (!grid || grid.dataset.skel === '1') return;
      const real = grid.innerHTML;
      grid.dataset.skel = '1';
      grid.innerHTML = Array.from({ length: 6 }, () =>
        '<div class="s-card"><div class="s-card__body">'
        + '<div class="s-skeleton s-skeleton--line" style="height:12px;width:45%"></div>'
        + '<div class="s-skeleton s-skeleton--kpi" style="height:40px;margin-top:10px"></div>'
        + '<div class="s-skeleton s-skeleton--line-sm" style="height:10px;width:65%;margin-top:10px"></div>'
        + '</div></div>').join('');
      setTimeout(() => { grid.innerHTML = real; delete grid.dataset.skel; }, 1800);
    });
    /* 【原型 L575】浅色：#sRoot data-theme 切换 + 按钮文案「浅色/深色」 */
    const btnTheme = top.querySelector('#sPhTheme');
    if (btnTheme) btnTheme.addEventListener('click', () => {
      const root = document.getElementById('sRoot');
      if (!root) return;
      const light = root.getAttribute('data-theme') === 'light';
      root.setAttribute('data-theme', light ? 'dark' : 'light');
      btnTheme.textContent = light ? '浅色' : '深色';
    });
    /* 【原型 L566/L582】更多：顶部与移动端都打开「更多」抽屉 */
    const btnMore = top.querySelector('#sPhMore');
    if (btnMore) btnMore.addEventListener('click', () => openMoreDrawer());
    function openMoreDrawer() {
      if (typeof S.openDrawer !== 'function') return;
      S.openDrawer({
        size: 'lg', title: '更多', sub: '导出 / 打印 / 视图出口',
        render(body) {
          body.innerHTML = '<div class="s-tagrow">'
            /* 【2026-11-25 修复】旧入口指 report.html——那是 103 行静态原型，数据日
             * 2026-11-13 写死、十章数字全是编造示意值（用户实测"内容滞后且与实际
             * 研判报告不一样"）。改指 ?view=report：s-report.js 搬运 app.js 生成的
             * 正式 #briefBody（10 章真实数据 + 复制/打印/12 项导出），单一数据源。 */
            + '<a class="s-btn s-btn--ghost" href="./?view=report" target="_blank">研报长文</a>'
            + '<button type="button" class="s-btn s-btn--ghost" id="sMoreExport">导出 12 项</button>'
            + '<button type="button" class="s-btn s-btn--ghost" data-ev-tab="回测">策略回测明细</button>'
            + '<button type="button" class="s-btn s-btn--ghost" data-ev-tab="模拟盘">模拟盘交易台</button>'
            /* 【重构前功能补回】K线是旧终端完整能力（输入代码→664根日K/周期切换），
             * 视觉稿 9 tab 不含 K线故导航不列，但入口必须保留——放这里，不占导航位。 */
            + '<button type="button" class="s-btn s-btn--ghost" data-ev-tab="K线">K线查询</button>'
            + '<button type="button" class="s-btn s-btn--ghost" data-ev-tab="系统设置">系统设置</button>'
            + '</div><div id="sMoreExpPanel" hidden></div>'
            + '<p class="s-kpi__note">12 项导出菜单与研报同源；K线/系统设置见旧终端能力收编。</p>';
          const ex = body.querySelector('#sMoreExport');
          const panel = body.querySelector('#sMoreExpPanel');
          if (ex && panel) ex.addEventListener('click', () => {
            if (!panel.hidden) { panel.hidden = false; return; }
            const src = document.getElementById('expMenu');
            if (src && typeof window.renderExportMenu === 'function') {
              window.renderExportMenu();          // 真调原研报导出引擎渲染 12 项（含行数/空态标注）
              panel.innerHTML = src.innerHTML;
              panel.hidden = false;
              /* 点击委托：复用 doExportDataset（真导出，非摆设） */
              panel.addEventListener('click', (e) => {
                const it = e.target.closest('button[data-ds]');
                if (!it || it.disabled) return;
                e.stopPropagation();
                window.doExportDataset(it.dataset.ds, ex);
              });
            } else {
              panel.innerHTML = '<p class="s-kpi__note">导出引擎未就绪。</p>';
              panel.hidden = false;
            }
          });
        },
      });
    }
    S.openMoreDrawer = openMoreDrawer;

    // 8 tab 路由：切换 s-nav__link 高亮 + 切换 panel（注册页优先渲染，否则占位）
    // 「研报」tab 特殊：跳回原研报视图（?view=research），保留完整研报能力
    /* 【方案 §1.1】溢出菜单：⋯ 点击展开、Esc 关闭并 return focus、外部点击关闭 */
    const moreBtn = navEl.querySelector('#sNavMore');
    const overflow = navEl.querySelector('#sNavOverflow');
    if (moreBtn && overflow) {
      moreBtn.addEventListener('click', () => {
        const opening = overflow.getAttribute('aria-hidden') === 'true';
        overflow.setAttribute('aria-hidden', String(!opening));
        moreBtn.setAttribute('aria-expanded', String(opening));
        if (opening) overflow.querySelector('a')?.focus();
      });
      document.addEventListener('click', (ev) => {
        if (overflow.getAttribute('aria-hidden') === 'false' && !navEl.contains(ev.target)) {
          overflow.setAttribute('aria-hidden', 'true');
          moreBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }
    const links = navEl.querySelectorAll('.s-nav__link');
    links.forEach((a) => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (TABS[+a.dataset.page] === '研报') {
          /* 【方案 §2.2】研报 tab → ?view=report 长文专用页（10章目录吸顶+面包屑返回），
           * 不再是跳回原研报长页（后者 #briefBody 被 560px 盒锁，压缩到无法阅读）。 */
          try { sessionStorage.setItem('sReportFromTab', TABS[+a.dataset.page]); } catch (_) {}
          location.href = location.pathname + '?view=report';
          return;
        }
        links.forEach((b) => { b.classList.remove('is-active'); b.removeAttribute('aria-current'); });
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
        /* 溢出菜单选中后收起 + 焦点回 ⋯（方案 §1.1 Esc/关闭 return focus） */
        if (overflow && overflow.contains(a)) {
          overflow.setAttribute('aria-hidden', 'true');
          if (moreBtn) { moreBtn.setAttribute('aria-expanded', 'false'); moreBtn.focus(); }
        }
        showPage(TABS[+a.dataset.page], panel);
      });
    });
  }

  /* 【方案 2.2】&tab=...&focus=... 定位：tab 名走 9 项白名单，非法落 #总览不报错；
   * focus 锚点在工作台面板内 scrollIntoView（找不到则忽略，绝不抛错）。 */
  function deepLinkTab() {
    try {
      const t = new URLSearchParams(location.search).get('tab');
      return TABS.includes(t) ? t : null;
    } catch (_) { return null; }
  }
  function applyDeepFocus() {
    try {
      const f = new URLSearchParams(location.search).get('focus');
      if (!f || !/^[A-Za-z][\w-]*$/.test(f)) return; // 防注入
      const node = document.getElementById(f) || document.querySelector('#sRoot [data-anchor="' + f + '"]');
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (_) { /* 锚点不存在 = 静默忽略 */ }
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
      if (sRoot) {
        buildShell(); sRoot.hidden = false;
        /* 【方案 2.2】深链 tab 白名单命中时同步导航高亮（此前只渲染面板，高亮落在总览） */
        const dt = deepLinkTab();
        if (dt) {
          document.querySelectorAll('nav.s-nav .is-active').forEach((a) => {
            a.classList.remove('is-active'); a.removeAttribute('aria-current');
          });
          const link = Array.from(document.querySelectorAll('nav.s-nav .s-nav__link'))
            .find((a) => TABS[+a.dataset.page] === dt);
          if (link) { link.classList.add('is-active'); link.setAttribute('aria-current', 'page'); }
        }
        showPage(dt || TABS[0]);
        /* focus 锚点：面板 DOM 由各页异步渲染，延时两轮 + MutationObserver 等待，
         * 8s 上限（方案风险 #3），失败静默不报错。 */
        let tries = 0;
        const focusTimer = setInterval(() => {
          if (++tries > 16) { clearInterval(focusTimer); return; }
          const f = new URLSearchParams(location.search).get('focus');
          if (f && (document.getElementById(f) || document.querySelector('#sRoot [data-anchor="' + f + '"]'))) {
            clearInterval(focusTimer); applyDeepFocus();
          }
        }, 500);
      }
      if (tRoot && !tRoot.hidden) { tRoot.hidden = true; hidTRoot = true; }
      if (main) main.hidden = true;            // 不用 aria-hidden（fatal 兜底信号，会被 app.js 清空）
      if (pre) pre.hidden = true;              // <main> 之外的告警浮层一并收起
      // 隐藏规则由 style.css 的 body[data-view="workbench"] > main / > #preMainPanels 双保险
    } else {
      teardownCurrent(); // 【14 册门禁⑧】离开工作台 → 清理当前页 chart/tooltip，避免隐藏后残留
      delete document.body.dataset.view;
      if (sRoot) sRoot.hidden = true;
      /* 【方案 §2.2】?view=report 长文专用页：原研报 main 隐藏（app.js 仍在后台渲染
       * #briefBody/#briefNav，s-report.js 把这两节点搬进专用外壳）——避免原 8726px 长页
       * 与专用页叠在一起、视口顶部仍是原研报顶栏（研报被"压缩到没办法看"的另一半原因）。 */
      const isReport = view === 'report';
      if (isReport) document.body.dataset.view = 'report';  // 供 CSS 隐藏原研报失效控件
      if (main) main.hidden = !!isReport;
      if (pre) pre.hidden = !!isReport;
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
  /* 【原型 L568-571】快捷键：Escape 关抽屉；/ 聚焦搜索（输入框内不劫持）；
   * 1-9 切 9 个视图（BRIEF 3.6 语义，方案 2.4 明确保留，<1024 亦然）。 */
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'workbench') return;
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
    if (e.key === 'Escape') {
      if (typeof S.closeDrawer === 'function') S.closeDrawer();
      const sf = $('#sPhSearch'); if (sf) sf.blur();
      return;
    }
    if (typing) return;
    if (e.key === '/') {
      const sf = $('#sPhSearch');
      if (sf) { e.preventDefault(); sf.focus(); }
      return;
    }
    /* 【重构前快捷键补回】0 平滑回顶（原研报 A-JS:5409）；- 完整档/精简档切换
     * （原研报 A-JS:5411，转发到隐藏 main 里的 #loadScope 切换按钮，复用原逻辑）。 */
    if (e.key === '0') {
      e.preventDefault();
      if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (e.key === '-') {
      const sw = document.querySelector('#loadScope [data-act="loadfull"], #loadScope [data-act="loadpartial"]');
      if (sw) { e.preventDefault(); sw.click(); }
      return;
    }
    /* K线页 ←/→ 切周期（旧终端 B-JS:1828，收编时漏绑）：转发到当前 K线面板的周期选择器 */
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && document.querySelector('.s-page-kline')) {
      const sel = document.querySelector('#sKlHost select, #sKlHost [data-period]');
      if (sel && sel.options) {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const ni = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + dir));
        if (ni !== sel.selectedIndex) {
          e.preventDefault();
          sel.selectedIndex = ni;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const i = +e.key - 1;
      const link = document.querySelectorAll('nav.s-nav .s-nav__link')[i];
      if (link) { e.preventDefault(); link.click(); }
    }
  });

  /* 【原型 hotSearch 同语义 + 2026-11-20 去鸡肋改造】工作台搜索框此前只在总览页筛
   * 个股明细表——全局入口、局部作用，其它 tab 输入毫无反应（用户反馈「鸡肋」）。
   * 改造后三层能力：
   *  ① 总览页：保留原表格筛选（同语义不破坏）；
   *  ② 任意 tab：三池检索（当日热点/龙虎榜/涨停池，app.js __stockSearch 引擎原值）
   *     → 输入即出候选下拉；
   *  ③ 回车/点选候选 → 打开既有个股详情抽屉（__stockOpen→stockDetail→openDrawer
   *     全复用，不造第二个详情渲染）。检索纯本地，不请求网络。 */
  (function bindWorkbenchSearch() {
    let timer = null;
    let drop = null;
    const closeDrop = () => { if (drop) { drop.remove(); drop = null; } };
    const openStock = (code) => {
      closeDrop();
      const sf = document.getElementById('sPhSearch');
      if (sf) sf.blur();
      if (typeof window.__stockOpen === 'function') window.__stockOpen(code);
    };
    const renderDrop = (sf, items) => {
      closeDrop();
      if (!items.length) return;
      const r = sf.getBoundingClientRect();
      drop = document.createElement('div');
      drop.id = 'sSearchDrop';
      drop.style.cssText = 'position:fixed;z-index:1200;top:' + (r.bottom + 4) + 'px;left:' + r.left
        + 'px;min-width:' + Math.max(240, r.width) + 'px;background:var(--s-surface,#fff);'
        + 'border:1px solid var(--s-border,#ddd);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);overflow:hidden;';
      drop.innerHTML = items.map((p) =>
        '<button type="button" data-code="' + p.code + '" style="display:flex;gap:10px;width:100%;text-align:left;'
        + 'padding:9px 12px;border:0;background:none;cursor:pointer;font:inherit;">'
        + '<span style="font-weight:600">' + p.code + '</span>'
        + '<span style="flex:1">' + (p.name || '—') + '</span>'
        + '<span style="opacity:.55;font-size:12px">' + p.src + '</span></button>').join('');
      document.body.appendChild(drop);
      drop.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-code]');
        if (b) openStock(b.dataset.code);
      });
    };
    document.addEventListener('input', (e) => {
      if (!e.target || e.target.id !== 'sPhSearch') return;
      const sf = e.target;
      const q = (sf.value || '').trim().toLowerCase();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        /* ① 总览页个股明细表筛选（原有语义保留） */
        const body = document.getElementById('sEvHotBody');
        if (body) {
          let shown = 0, total = 0;
          Array.from(body.querySelectorAll('tr')).forEach((tr) => {
            total++;
            const hit = !q || (tr.textContent || '').toLowerCase().includes(q);
            tr.hidden = !hit;
            if (hit) shown++;
          });
          const table = document.getElementById('sEvHotTable');
          let tip = document.getElementById('sEvSearchTip');
          if (q && table && table.parentElement) {
            if (!tip) {
              tip = document.createElement('div');
              tip.id = 'sEvSearchTip';
              tip.className = 's-kpi__note';
              tip.style.cssText = 'padding:8px 4px;';
              table.parentElement.appendChild(tip);
            }
            tip.textContent = shown ? `匹配 ${shown} / ${total} 行` : '无匹配个股（本地筛选，不请求网络）';
            tip.hidden = false;
          } else if (tip) { tip.hidden = true; }
        }
        /* ② 任意 tab：三池候选下拉（引擎当日原值；无候选不显示空面板） */
        if (typeof window.__stockSearch === 'function' && q) {
          try { renderDrop(sf, window.__stockSearch(q)); } catch (_) { closeDrop(); }
        } else closeDrop();
      }, 150);
    });
    /* ③ 回车：唯一/首个候选直接打开详情抽屉 */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target || e.target.id !== 'sPhSearch') return;
      const q = (e.target.value || '').trim();
      if (!q || typeof window.__stockSearch !== 'function') return;
      const items = window.__stockSearch(q);
      if (items.length) { e.preventDefault(); openStock(items[0].code); }
    });
    document.addEventListener('click', (e) => {
      if (drop && !drop.contains(e.target) && e.target.id !== 'sPhSearch') closeDrop();
    });
  })();

  S.routeWorkbench = route;
})(window.S = window.S || {});
