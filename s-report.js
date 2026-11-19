/* ══════════════════════════════════════════════════════════════════════════
 * s-report.js — 研报长文专用页（方案 01 册 §2.2 / 04 册）
 * ──────────────────────────────────────────────────────────────────────────
 * 权威：design/UI设计方案.html §2.2「?view=report / #report 研报长文专用页
 *       （长文阅读 / 打印 / 导出）——独立路由，10 章目录吸顶；面包屑『主视图 / 研报』
 *       + 浏览器后退；保留 4/5 抽屉入口与导出菜单 12 项」。
 *
 * 为什么不重写：app.js 的 renderBrief / renderBriefNav 已把 10 章 + 目录渲染到
 *   #briefBody / #briefNav（审计闸门通过的正式内容）。本文件只做「搬运 + 外壳」：
 *   节点原位不动由 app.js 继续维护（MutationObserver 跟随），只是阅读时把它们挂进
 *   专用外壳；.s-report 作用域解除 style.css 的 .brief-body{max-height:560px;overflow:auto}
 *   盒内滚动 —— 这是研报被「压缩到没办法看」的真因（10 章挤在 560px 小框）。
 * 硬边界：app.js / style.css / #briefBody 内容零改动。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});
  if (typeof S.getFlag !== 'function') {
    var f = Object.create(null);
    S.getFlag = function (n, d) { return n in f ? f[n] : d; };
  }

  const REPORT_VIEW = 'report';
  let obs = null, active = false;

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function isReport() {
    try {
      const v = new URLSearchParams(location.search).get('view');
      return v === REPORT_VIEW || location.hash === '#report';
    } catch (_) { return false; }
  }

  /* 返回工作台：沿用深链 workbench（不改 app.js），保留来源 tab（从 URL tab 参数读）。
   * 同时支持浏览器后退（popstate → s-root.js 重路由，无需本文件干预）。 */
  function backToWorkbench() {
    const q = new URLSearchParams(location.search);
    q.set('view', 'workbench');
    q.delete('tab');
    /* 回工作台总览（方案 §1.4「主视图」回来源 tab；从研报 tab 进入时来源即研报本身，
     * 回总览是最自然的落点，避免 &tab=研报 在 showPage 走占位分支）。
     * 来源 tab 留档在 sessionStorage 供埋点/后续扩展，不注入 URL。 */
    const url = location.pathname + '?' + q.toString();
    /* SPA 优先：先归还节点/拆外壳，再用 route 切视图（与浏览器后退同效果，不整页重载，
     * 避免 report shell 残留遮挡工作台）。无 route API 时回退 location.href 整页重载。 */
    deactivate();
    history.pushState(history.state, '', url);
    if (S.routeWorkbench) S.routeWorkbench('workbench');
    else location.href = url;
  }

  function buildShell() {
    if (document.getElementById('sReportRoot')) return document.getElementById('sReportRoot');
    const root = el('div', 's-scope s-report');
    root.id = 'sReportRoot';

    /* 面包屑：主视图 / 研报（方案 §1.4：最后一级 aria-current=page，链接 ≥44px） */
    const crumb = el('nav', 's-report__crumb');
    crumb.setAttribute('aria-label', '面包屑');
    crumb.innerHTML = '<button type="button" class="s-report__back" id="sReportBack">'
      + '<span aria-hidden="true">◀</span> 主视图</button>'
      + '<span class="s-report__sep" aria-hidden="true">/</span>'
      + '<span class="s-report__cur" aria-current="page">研报</span>'
      + '<span class="s-report__spacer"></span>'
      + '<button type="button" class="s-report__print" id="sReportPrint">打印 / 导出</button>';
    root.appendChild(crumb);

    /* 10 章目录吸顶（搬 #briefNav 进来，原位占位符留在原处，app.js 重建时 observer 跟随） */
    const toc = el('div', 's-report__toc');
    toc.id = 'sReportToc';
    root.appendChild(toc);

    /* 正文（搬 #briefBody 进来） */
    const body = el('main', 's-report__body');
    body.id = 'sReportBodyHost';
    root.appendChild(body);

    document.body.appendChild(root);
    crumb.querySelector('#sReportBack').addEventListener('click', backToWorkbench);
    crumb.querySelector('#sReportPrint').addEventListener('click', () => window.print());
    return root;
  }

  /* app.js 的 renderBrief 会 innerHTML 重建 #briefBody，renderBriefNav 重建 #briefNav。
   * 用 MutationObserver 监听两个源节点，一旦有内容就搬到专用外壳（幂等：已是子节点则跳过）。 */
  function mountNodes() {
    const root = document.getElementById('sReportRoot');
    const sourceNav = document.getElementById('briefNav');
    const sourceBody = document.getElementById('briefBody');
    if (!root || !sourceNav || !sourceBody) return;

    const toc = document.getElementById('sReportToc');
    const host = document.getElementById('sReportBodyHost');
    if (sourceNav.parentNode !== toc && sourceNav.children.length) toc.appendChild(sourceNav);
    if (sourceBody.parentNode !== host && sourceBody.children.length) host.appendChild(sourceBody);
  }

  function activate() {
    if (active) return;
    active = true;
    buildShell();
    mountNodes();
    /* 记住来源 tab（工作台点「研报」tab 时 s-root.js 会跳 ?view=research/report） */
    try {
      const q = new URLSearchParams(location.search);
      const t = q.get('tab');
      if (t) sessionStorage.setItem('sReportFromTab', t);
    } catch (_) {}

    if (typeof MutationObserver === 'function') {
      obs = new MutationObserver(() => mountNodes());
      ['briefNav', 'briefBody'].forEach((id) => {
        const n = document.getElementById(id);
        if (n) obs.observe(n, { childList: true, subtree: false });
      });
    }
    document.addEventListener('visibilitychange', onVis);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    if (obs) { obs.disconnect(); obs = null; }
    document.removeEventListener('visibilitychange', onVis);
    const root = document.getElementById('sReportRoot');
    if (!root) return;
    /* 把 brief 节点还回原研报容器（保持 app.js 的 DOM 归属），再移除专用外壳。
     * 只 hidden 不移除会让残留 shell 在返回工作台后仍占位、遮挡。 */
    const source = document.querySelector('.card.brief') || document.querySelector('main');
    const b = document.getElementById('briefBody'), n = document.getElementById('briefNav');
    if (source) {
      if (n && n.parentNode !== source) source.insertBefore(n, b && b.parentNode === source ? b : null);
      if (b && b.parentNode !== source) source.appendChild(b);
    }
    root.remove();
  }

  function onVis() {
    const root = document.getElementById('sReportRoot');
    if (root) root.hidden = !isReport();
  }

  function init() {
    if (!isReport()) return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', activate);
    else activate();
  }
  init();

  window.addEventListener('hashchange', () => { if (isReport()) activate(); else deactivate(); });
  window.addEventListener('popstate', () => { if (isReport()) activate(); else deactivate(); });

  S.reportPage = { activate, deactivate, isReport, backToWorkbench };
})(window.S = window.S || {});
