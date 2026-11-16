/* ══════════════════════════════════════════════════════════════════════════
 * s-print.js — A 方案阶段 4b：研报长文页（report.html）交互层
 * ──────────────────────────────────────────────────────────────────────────
 * 权威：04 册 1.5 节 L586-657（report.html 节点）、05 册阶段 4（新增文件清单、
 *   12 项导出菜单文案与行数标注不变）、16 册 §6（独立路由、四处白名单）。
 *
 * 职责（只做三件事，不碰取数逻辑——app.js:5553 纪律）：
 *   ① 三按钮：复制全文 / 打印 / 导出菜单开合
 *   ② 导出菜单 12 项：优先复用 window.DatasetExport.exportManifest()（与屏幕同源），
 *      未就绪时用 src/dataset.js 的 DATASETS label 静态兜底（只展示文案、不取数）
 *   ③ reportV2 flag：false 时禁用本页交互（report.html 删除即彻底回滚）
 *
 * @media print 隐藏规则已在 s-components.css L1060-1144 全部实现（topbar/ticker/
 *   nav/btn/drawer 等 display:none + thead table-header-group + @page margin 12mm），
 *   本文件不重复写打印 CSS。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});
  // 【18 册 P0】report.html 独立页不引 s-root.js，S.getFlag 可能不存在；本地兜底，语义与 s-root.js L31 一致。
  // 4a 的 s-drawer.js 跑在 index.html（有 s-root.js）故无此问题，本页宿主不同不可照搬假设。
  if (typeof S.getFlag !== 'function') {
    var __printFlags = Object.create(null);
    S.getFlag = function (name, dflt) { return name in __printFlags ? __printFlags[name] : dflt; };
  }
  if (typeof S.setFlag !== 'function') {
    S.setFlag = function (name, v) { /* 独立页无需切换，保留接口 */ };
  }
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function enabled() { return S.getFlag('reportV2', true) !== false; }

  /* ---------- DATASETS 静态 label 兜底（src/dataset.js:460-462 的 10 项 + 2 合并项） ----------
   * 仅用于导出引擎未就绪时展示 12 项文案，不含任何取数逻辑。行数标注此时为「加载中…」，
   * DatasetExport 就绪后由 exportManifest() 用真实 count 覆盖（12 项与行数标注最终与屏幕同源）。 */
  const FALLBACK = [
    ['daily', '情绪分·逐日'], ['hot', '个股明细'], ['lhb', '龙虎榜资金'],
    ['themes', '题材分布'], ['industry', '行业涨跌幅'], ['breadth', '市场宽度·逐日'],
    ['crosscheck', '跨源互证·偏离行业'], ['dirty', '数据质量留痕'],
    ['seats', '资金属性·逐日净买'], ['global', '外围行情·隔夜'],
    ['__csv', '全部导出（CSV 单表）'], ['__xls', '全部导出（Excel 多表页）'],
  ];

  /* ---------- 导出菜单渲染 ---------- */
  function menuItems(list) {
    return list.map((it) =>
      `<button type="button" role="menuitem" data-ds="${esc(it.id)}"${it.empty ? ' disabled' : ''}>`
      + `<span class="exp-lab">${esc(it.label)}</span>`
      + `<span class="exp-num muted">${it.empty ? '暂无数据' : esc(it.count || '加载中…')}</span></button>`
    ).join('');
  }

  function renderMenu() {
    const menu = $('#sExportMenu');
    if (!menu) return;
    const M = window.DatasetExport;
    if (M && typeof M.exportManifest === 'function') {
      // 与屏幕同源：复用导出引擎的 manifest（10 数据集 + 2 合并项 = 12），带真实行数
      let list;
      try {
        const ctx = window.__exportCtx || {}; // 由 bundle/app 侧提供的上下文；独立页可能没有
        list = M.exportManifest(ctx);
      } catch (_) { list = null; }
      if (Array.isArray(list) && list.length) {
        menu.innerHTML = menuItems(list.map((x) => ({
          id: x.id, label: x.label, count: x.count != null ? (x.count + ' 行') : '', empty: !!x.empty,
        })));
        return;
      }
    }
    // 兜底：静态 12 项文案（行数「加载中…」，不取数）—— 保证 V4-3 的 12 项结构恒在
    menu.innerHTML = menuItems(FALLBACK.map(([id, label]) => ({ id, label, count: '加载中…' })));
  }

  function toggleMenu(btn) {
    const menu = $('#sExportMenu');
    if (!menu) return;
    const willOpen = menu.hidden;
    if (willOpen) renderMenu();
    menu.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
    // #expMenu 兼容位同步（V4-3 另一种查法）
    const alias = $('#expMenu');
    if (alias) alias.hidden = !willOpen;
  }
  function closeMenu() {
    const menu = $('#sExportMenu'), btn = $('#rptExport');
    if (menu) menu.hidden = true;
    const alias = $('#expMenu');
    if (alias) alias.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  /* ---------- 菜单项点击：独立页如实告知「预览页不支持下载」（18 册 §5.1） ----------
   * 本页没有 window.__exportCtx（由 app.js 侧提供），exportManifest({}) 拿空 ctx，
   * 不会真下载 CSV。绝不 flash「导出请求已提交」这类误导文案——完整导出在研报视图的
   * #expMenu（app.js 的 renderExportMenu / 导出处理器），符合「前端不写取数逻辑」纪律。 */
  function onMenuClick(e) {
    const item = e.target && e.target.closest ? e.target.closest('[data-ds]') : null;
    if (!item || item.disabled) return;
    flash(item, '请到研报视图导出');
    closeMenu();
  }
  function flash(btn, text) {
    const old = btn.dataset.label || (btn.querySelector('.exp-lab') || {}).textContent;
    const lab = btn.querySelector('.exp-lab');
    if (!lab) return;
    if (!btn.dataset.label) btn.dataset.label = old;
    lab.textContent = text;
    setTimeout(() => { lab.textContent = btn.dataset.label; }, 1600);
  }

  /* ---------- 复制全文 ---------- */
  function copyAll(btn) {
    const body = $('#briefBody');
    if (!body) return;
    const text = body.innerText || body.textContent || '';
    const done = () => flashBtn(btn, '已复制');
    const fail = () => flashBtn(btn, '复制失败');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? done() : fail(); } catch (_) { fail(); }
      document.body.removeChild(ta);
    }
  }
  function flashBtn(btn, text) {
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old; btn.textContent = text; btn.disabled = true;
    setTimeout(() => { btn.textContent = btn.dataset.label; btn.disabled = false; }, 1400);
  }

  /* ---------- 启动 ---------- */
  function init() {
    if (!enabled()) {
      // reportV2=false：三按钮禁用（report.html 删除即彻底回滚）
      ['#rptCopy', '#rptExport', '#rptPrint'].forEach((sel) => { const b = $(sel); if (b) b.disabled = true; });
      return;
    }
    const copy = $('#rptCopy'), exp = $('#rptExport'), print = $('#rptPrint'), menu = $('#sExportMenu');
    if (copy) copy.addEventListener('click', () => copyAll(copy));
    if (exp) exp.addEventListener('click', () => toggleMenu(exp));
    if (print) print.addEventListener('click', () => window.print());
    if (menu) menu.addEventListener('click', onMenuClick);
    document.addEventListener('click', (e) => {
      if (exp && menu && !exp.contains(e.target) && !menu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    // 打印前收起菜单，避免打印出弹出层
    window.addEventListener('beforeprint', closeMenu);
    // bundle.js(module) 异步就绪后重渲染一次菜单，用真实 count 覆盖「加载中…」
    let retries = 0;
    const t = setInterval(() => {
      if ((window.DatasetExport && typeof window.DatasetExport.exportManifest === 'function') || ++retries > 60) {
        clearInterval(t);
        renderMenu();
      }
    }, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  S.initPrint = init;
  S.renderPrintExportMenu = renderMenu;
})(window.S = window.S || {});
