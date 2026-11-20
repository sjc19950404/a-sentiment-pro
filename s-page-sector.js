/* ══════════════════════════════════════════════════════════════════════════
 * s-page-sector.js — 工作台「板块」页
 * 01 册 8 tab 规划表 #4：板块涨跌 / 资金代理 / 题材归属 + D1 下钻；
 * A 方案路线「复用现有 render 输出、数据层零改动」（不是重写第二套规则）。
 * 直接调用终端视图现成 viewSector(S)（terminal.js 末尾只读导出），节点与
 * .t-* 样式、data-* 下钻链路原样复用；本文件只负责挂载/等待/T1 空态/回退。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  let timer = null;
  let panelRef = null;

  function enabled() { return S.getFlag('sectorV2', true) !== false; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function t1Empty(host, title, hint) {
    if (!host) return;
    host.innerHTML = '<div class="s-empty">'
      + '<div style="font-size:40px;color:var(--s-accent);opacity:.2" aria-hidden="true">◫</div>'
      + '<div class="s-empty__title">' + esc(title) + '</div>'
      + '<div class="s-empty__hint">' + esc(hint) + '</div></div>';
  }

  function mount() {
    if (!panelRef || !enabled()) return;
    const host = $('#sScHost', panelRef);
    if (!host) return;
    const tv = window.__TERMINAL_VIEWS__ || {};
    const sig = window.__SIGNALS__;
    if (typeof tv.sector !== 'function' || !sig || !Object.keys(sig).length) {
      t1Empty(host, '板块数据未就绪', '数据源未返回当日口径，本页不填充估算值。');
      return;
    }
    try {
      const node = tv.sector(sig);      // 终端视图现成 render：引擎原值，零新增计算
      if (!(node instanceof Node)) throw new Error('render 未返回节点');
      host.innerHTML = '';
      host.appendChild(node);
      /* 【2026-11-20 基准切换修复】终端 render 里的「对比基准」分段按钮点击回调调
       * goView('sector')（终端自己的重渲染），在工作台容器里不生效——按钮点了没反应。
       * 接管方式：克隆替换 .t-seg（去掉终端绑定的监听），写回 terminal 的模块级
       * sectorBase（__TERMINAL_VIEWS__.setSectorBase），再由本文件 mount() 重渲染
       * host——同一份引擎原值换基准重画，不新增计算。 */
      const seg = host.querySelector('.t-seg');
      if (seg && typeof tv.setSectorBase === 'function') {
        const fresh = seg.cloneNode(true);            // 克隆=不带终端的 goView 监听
        seg.replaceWith(fresh);
        fresh.addEventListener('click', (e) => {
          const b = e.target && e.target.closest('button[data-b]');
          if (!b || b.dataset.b === (typeof tv.getSectorBase === 'function' ? tv.getSectorBase() : null)) return;
          tv.setSectorBase(b.dataset.b);
          mount();                                    // 换一组引擎原值重画（重挂接管）
        });
      }
      host.setAttribute('aria-busy', 'false');
    } catch (e) {
      console.error('[sector] 复用终端 render 失败', e);
      t1Empty(host, '板块渲染失败', '终端 render 异常，数据未被修改。');
    }
  }

  function waitAndMount() {
    let tries = 0;
    const check = () => {
      if (!panelRef || !enabled()) return;
      const ok = window.__TERMINAL_VIEWS__ && typeof window.__TERMINAL_VIEWS__.sector === 'function'
        && window.__SIGNALS__ && Object.keys(window.__SIGNALS__).length;
      if (ok || ++tries > 24) {
        if (timer) { clearInterval(timer); timer = null; }
        mount();
      }
    };
    if (timer) clearInterval(timer);
    timer = setInterval(check, 500);
    check();
  }

  function teardown() {
    if (timer) { clearInterval(timer); timer = null; }
    panelRef = null;
  }

  function render(panel) {
    if (!panel) return;
    teardown();
    if (!enabled()) {
      panel.innerHTML = '<h2 class="s-ph-title">工作台 · 板块</h2>'
        + '<p class="s-ph-desc">板块视图已回退（flag sectorV2=false），研报/终端原节点未改动。</p>';
      return;
    }
    panelRef = panel;
    panel.innerHTML = ''
      + '<div class="s-page-sector">'
      + '<div class="s-section"><div class="s-section__head">'
      + '<h2 class="s-section__title">板块 · 攻防与题材归属</h2>'
      + '<p class="s-section__note">复用终端 render · 引擎原值（上涨占比为展示层现算并已标注口径）</p>'
      + '</div><div id="sScHost" aria-busy="true"></div></div>'
      + '<div class="s-section"><div class="s-alert s-alert--muted">'
      + '<div class="s-alert__title">口径与下钻</div>'
      + '<div>板块宽度 / 相对强弱 / 资金代理 / 题材归属均为引擎产出，面板内点行可下钻详情；'
      + '本页不新增阈值、不改研报数据，AI 侧车仅参考。</div></div></div>'
      + '</div>';
    waitAndMount();
  }

  S.registerPageSector = () => {
    if (typeof S.registerPage === 'function') S.registerPage('板块', render, teardown);
  };
  S.registerPageSector();
  S.teardownSector = teardown;
})(window.S = window.S || {});
