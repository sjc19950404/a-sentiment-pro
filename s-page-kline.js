/* ══════════════════════════════════════════════════════════════════════════
 * s-page-kline.js — 工作台「K线」页
 * 收编路线（同板块/选股）：直接调终端视图现成 viewKline()（terminal.js 只读导出）。
 * 终端 render 自带代码输入、周期切换、日K聚合（周/月/季/半年/年）与点行联动 LINK；
 * 本文件只负责挂载/等待/空态/回退，零新增计算、零改动数据层。
 * 数据真相：ui/kline/{code}.json 仅日K；无分钟数据源，不做分时/30/60分。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  let timer = null;
  let panelRef = null;

  function enabled() { return S.getFlag('klineV2', true) !== false; }

  function mount() {
    if (!panelRef || !enabled()) return;
    const host = $('#sKlHost', panelRef);
    if (!host) return;
    const tv = window.__TERMINAL_VIEWS__ || {};
    if (typeof tv.kline !== 'function') {
      host.innerHTML = '<div class="s-empty"><div class="s-empty__title">K线组件未就绪</div>'
        + '<div class="s-empty__hint">终端 render 未导出，请刷新重试。</div></div>';
      return;
    }
    try {
      const node = tv.kline();          // 终端视图现成 render（输入/周期/联动全在节点内）
      if (!(node instanceof Node)) throw new Error('render 未返回节点');
      host.innerHTML = '';
      host.appendChild(node);
      host.setAttribute('aria-busy', 'false');
    } catch (e) {
      console.error('[kline] 复用终端 render 失败', e);
      host.innerHTML = '<div class="s-empty"><div class="s-empty__title">K线渲染失败</div>'
        + '<div class="s-empty__hint">终端 render 异常，数据未被修改。</div></div>';
    }
  }

  function waitAndMount() {
    let tries = 0;
    const check = () => {
      if (!panelRef || !enabled()) return;
      if ((window.__TERMINAL_VIEWS__ && typeof window.__TERMINAL_VIEWS__.kline === 'function') || ++tries > 24) {
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
      panel.innerHTML = '<h2 class="s-ph-title">工作台 · K线</h2>'
        + '<p class="s-ph-desc">K线视图已回退（flag klineV2=false），研报/终端原节点未改动。</p>';
      return;
    }
    panelRef = panel;
    panel.innerHTML = ''
      + '<div class="s-page-kline">'
      + '<div class="s-section"><div class="s-section__head">'
      + '<h2 class="s-section__title">个股 K 线</h2>'
      + '<p class="s-section__note">复用终端 render · 仅日K源 · 周/月/季为展示层标准聚合</p>'
      + '</div><div id="sKlHost" aria-busy="true"></div></div>'
      + '<div class="s-section"><div class="s-alert s-alert--muted">'
      + '<div class="s-alert__title">口径</div>'
      + '<div>数据源 ui/kline/{code}.json 仅含日K（无分钟级数据，故不做分时/30分/60分）；'
      + '可从选股/模拟盘点标的行带代码跳转。价格与成交量均为交易所公开日线口径。</div></div></div>'
      + '</div>';
    waitAndMount();
  }

  S.registerPageKline = () => {
    if (typeof S.registerPage === 'function') S.registerPage('K线', render, teardown);
  };
  S.registerPageKline();
  S.teardownKline = teardown;
})(window.S = window.S || {});
