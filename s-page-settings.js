/* ══════════════════════════════════════════════════════════════════════════
 * s-page-settings.js — 工作台「系统设置」页
 * 收编路线：直接调终端视图现成 viewSettings()（terminal.js 只读导出）。
 * 终端 render 自带参数控制台 / 沙盒推演 / 写盘入口；静态部署（github.io）API 不可达时
 * 它自身按注释「优雅降级为只读展示」——本页不伪造写盘能力，明确标注部署口径。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  let timer = null;
  let panelRef = null;

  function enabled() { return S.getFlag('settingsV2', true) !== false; }

  function mount() {
    if (!panelRef || !enabled()) return;
    const host = $('#sSetHost', panelRef);
    if (!host) return;
    const tv = window.__TERMINAL_VIEWS__ || {};
    if (typeof tv.settings !== 'function') {
      host.innerHTML = '<div class="s-empty"><div class="s-empty__title">设置组件未就绪</div>'
        + '<div class="s-empty__hint">终端 render 未导出，请刷新重试。</div></div>';
      return;
    }
    try {
      const node = tv.settings();        // 终端视图现成 render（只读降级逻辑在节点内）
      if (!(node instanceof Node)) throw new Error('render 未返回节点');
      host.innerHTML = '';
      host.appendChild(node);
      host.setAttribute('aria-busy', 'false');
    } catch (e) {
      console.error('[settings] 复用终端 render 失败', e);
      host.innerHTML = '<div class="s-empty"><div class="s-empty__title">设置渲染失败</div>'
        + '<div class="s-empty__hint">终端 render 异常，参数未被修改。</div></div>';
    }
  }

  function waitAndMount() {
    let tries = 0;
    const check = () => {
      if (!panelRef || !enabled()) return;
      if ((window.__TERMINAL_VIEWS__ && typeof window.__TERMINAL_VIEWS__.settings === 'function') || ++tries > 24) {
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
      panel.innerHTML = '<h2 class="s-ph-title">工作台 · 系统设置</h2>'
        + '<p class="s-ph-desc">设置视图已回退（flag settingsV2=false），研报/终端原节点未改动。</p>';
      return;
    }
    panelRef = panel;
    panel.innerHTML = ''
      + '<div class="s-page-settings">'
      + '<div class="s-section"><div class="s-section__head">'
      + '<h2 class="s-section__title">系统设置 · 参数控制台</h2>'
      + '<p class="s-section__note">复用终端 render · 静态部署为只读展示</p>'
      + '</div><div id="sSetHost" aria-busy="true"></div></div>'
      + '<div class="s-section"><div class="s-alert s-alert--muted">'
      + '<div class="s-alert__title">部署口径</div>'
      + '<div>GitHub Pages 静态部署无 /api 写盘服务，参数面板按终端视图自身逻辑降级为只读；'
      + '「保存并写盘 / 沙盒推演」仅在本地服务或配置了 API 隧道时可用。本页不会伪造写盘成功。</div></div></div>'
      + '</div>';
    waitAndMount();
  }

  S.registerPageSettings = () => {
    if (typeof S.registerPage === 'function') S.registerPage('系统设置', render, teardown);
  };
  S.registerPageSettings();
  S.teardownSettings = teardown;
})(window.S = window.S || {});
