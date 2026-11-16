/* ══════════════════════════════════════════════════════════════════════════
 * s-drawer.js — A 方案阶段 4a：三档抽屉体系（420/640/960 + xs 全屏 sheet）
 * ──────────────────────────────────────────────────────────────────────────
 * 权威：04 册 L170-188（完整节点集，id/class/aria 一字不改）+ L1145-1325（实现伪代码）；
 *   16 册裁定（JS 注入到 body、不包 .s-scope、不塞 #sRoot、补定向 [hidden] CSS）。
 *
 * 裁定四条硬前置：
 *   ① 注入 04 册完整 9 节点（sDrawerMask/sDrawer/sDrawerGrab/sDrawerTitle/sDrawerSub/
 *      sDrawerClose/sDrawerBody/sDrawerDone/sTooltip）到 document.body；
 *   ② 依赖 s-components.css 的 .s-drawer[hidden],.s-drawer__mask[hidden]{display:none!important}
 *      （同文件中已加，裸 body 注入时 .s-drawer{display:flex} 会盖过 UA [hidden]）；
 *   ③ 不包 .s-scope、不塞 #sRoot（前者铺满不透明背景盖研报，后者默认视图 hidden 焦点进不去）；
 *   ④ 本脚本在 s-components.css 之后、s-root.js 之后加载（index.html defer 顺序）。
 *
 * drawer.ok 真门禁（16 册 §2，纠正过的口径）：
 *   - 必须实现 S.openDrawer 动态路径（不能走自检 L188 的 static fallback 假绿）；
 *   - ESC 监听挂 document（自检在 document 上 dispatch）；
 *   - ESC 后 280ms 内 drawer.hidden=true 且焦点 === 打开前元素。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const state = { lastFocus: null, size: 'md', open: false };
  const q = (id) => document.getElementById(id);

  function enabled() { return S.getFlag('drawerV2', true) !== false; }

  /* ---------- 注入完整节点集（04 册 L170-188，一字不改） ---------- */
  function inject() {
    if (q('sDrawer')) return; // 幂等
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="s-drawer__mask" id="sDrawerMask" hidden></div>'
      + '<aside class="s-drawer s-drawer--md" id="sDrawer" role="dialog" aria-modal="true" '
      + 'aria-labelledby="sDrawerTitle" aria-describedby="sDrawerSub" aria-hidden="true" hidden>'
      + '<div class="s-drawer__grab" id="sDrawerGrab" aria-hidden="true"></div>'
      + '<header class="s-drawer__head"><div>'
      + '<h2 class="s-drawer__title" id="sDrawerTitle">详情</h2>'
      + '<p class="s-drawer__sub" id="sDrawerSub">数据日 2026-11-13</p>'
      + '</div><button class="s-btn s-btn--ghost" type="button" id="sDrawerClose" aria-label="关闭详情">关闭</button>'
      + '</header>'
      + '<div class="s-drawer__body" id="sDrawerBody" tabindex="-1">'
      + '<div class="s-empty"><span class="s-empty__title">选择一行查看详情</span></div>'
      + '</div>'
      + '<footer class="s-drawer__foot"><button class="s-btn s-btn--primary" type="button" id="sDrawerDone">完成</button></footer>'
      + '</aside>'
      + '<div class="s-tooltip" id="sTooltip" role="tooltip" aria-hidden="true"></div>';
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), (el) =>
      el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);
  }

  /* ---------- 打开（04 册 §5.3 L1183-1218） ---------- */
  S.openDrawer = function openDrawer(config) {
    const drawer = q('sDrawer'), mask = q('sDrawerMask');
    if (!drawer || !mask) return;
    const cfg = config || {};
    state.lastFocus = document.activeElement;
    state.size = cfg.size || 'md';
    state.open = true;

    drawer.className = 's-drawer s-drawer--' + state.size;
    q('sDrawerTitle').textContent = cfg.title || '详情';
    q('sDrawerSub').textContent = cfg.sub || '数据日 2026-11-13';
    const body = q('sDrawerBody');
    if (typeof cfg.render === 'function') {
      body.innerHTML = '';
      cfg.render(body);
    }
    drawer.hidden = false;
    mask.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');

    // 整页滚动归属：打开时锁 body，抽屉内部仍可滚（04 册 L1205-1207）
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    // 两帧过渡后再加 is-open，保证 transform 生效（04 册 L1209-1217）
    requestAnimationFrame(() => requestAnimationFrame(() => {
      mask.classList.add('is-open');
      drawer.classList.add('is-open');
      body.scrollTop = 0;
      q('sDrawerClose').focus();
    }));
  };

  /* ---------- 关闭（04 册 §5.3 L1220-1245） ---------- */
  S.closeDrawer = function closeDrawer() {
    const drawer = q('sDrawer'), mask = q('sDrawerMask');
    if (!drawer || !state.open) return;
    state.open = false;
    drawer.classList.remove('is-open');
    mask.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');

    const finish = () => {
      drawer.hidden = true;
      mask.hidden = true;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      if (state.lastFocus && typeof state.lastFocus.focus === 'function') state.lastFocus.focus();
    };
    // 16 册 §2：自检 ESC 后只等 280ms，动画 200ms 留 80ms 余量；
    // reduced-motion 同步分支（04 册 L1240）保留，Windows headless 常命中此分支更稳。
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else window.setTimeout(finish, 200);
  };

  S.setDrawerSize = function setDrawerSize(size) {
    const drawer = q('sDrawer');
    if (!drawer) return;
    drawer.classList.remove('s-drawer--sm', 's-drawer--md', 's-drawer--lg');
    drawer.classList.add('s-drawer--' + (size || 'md'));
  };

  /* ---------- 切 tab 统一关闭 + 清 tooltip（04 册 L1308-1316） ---------- */
  S.onTabChange = function onTabChange() {
    S.closeDrawer();
    const tip = q('sTooltip');
    if (tip) { tip.classList.remove('is-visible'); tip.setAttribute('aria-hidden', 'true'); tip.textContent = ''; }
  };

  /* ---------- 绑定：四种关闭路径 + ESC(document) + 焦点陷阱 + sheet 手势 ---------- */
  function bind() {
    const drawer = q('sDrawer'), mask = q('sDrawerMask'), grab = q('sDrawerGrab');
    if (!drawer || drawer.dataset.bound === '1') return; // 幂等
    drawer.dataset.bound = '1';

    q('sDrawerClose').addEventListener('click', S.closeDrawer);
    q('sDrawerDone').addEventListener('click', S.closeDrawer);
    mask.addEventListener('click', S.closeDrawer);

    document.addEventListener('keydown', (e) => {
      if (!state.open) return;
      if (e.key === 'Escape') { e.preventDefault(); S.closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables(drawer);
      if (list.length === 0) { e.preventDefault(); q('sDrawerBody').focus(); return; }
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // 移动端 sheet 手势（04 册 L1281-1304）
    let startY = 0, startT = 0, dy = 0;
    grab.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY; startT = Date.now(); dy = 0;
      drawer.style.transition = 'none';
    }, { passive: true });
    grab.addEventListener('touchmove', (e) => {
      dy = e.touches[0].clientY - startY;
      if (dy > 0) drawer.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    grab.addEventListener('touchend', () => {
      drawer.style.transition = '';
      drawer.style.transform = '';
      const velocity = dy / Math.max(Date.now() - startT, 1);
      if (dy > 96 || velocity > 0.5) S.closeDrawer();
    });
  }

  /* ---------- 启动：注入 + 绑定 ---------- */
  function init() {
    if (!enabled()) return; // drawerV2=false 回退原 520px 抽屉（研报 #drawer 未动）
    inject();
    bind();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  S.initDrawer = init; // 供外部 flag 翻回 true 时手动初始化
})(window.S = window.S || {});
