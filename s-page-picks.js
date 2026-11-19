/* ══════════════════════════════════════════════════════════════════════════
 * s-page-picks.js — 工作台「选股」页
 * 01 册 8 tab 规划表 #5：主线标的结论（picks 空态走 T1）+ 选股天梯 + 行下钻抽屉；
 * A 方案路线「复用现有 render 输出、数据层零改动」——直接调终端视图现成
 * viewPicks(S)（terminal.js 末尾只读导出），连板梯队/GLM 逻辑/纯情绪过滤/
 * 行下钻链路原样复用；本文件只负责挂载/等待/T1 空态/回退。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  let timer = null;
  let panelRef = null;

  function enabled() { return S.getFlag('picksV2', true) !== false; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function t1Empty(host, title, hint) {
    if (!host) return;
    host.innerHTML = '<div class="s-empty">'
      + '<div style="font-size:40px;color:var(--s-accent);opacity:.2" aria-hidden="true">◇</div>'
      + '<div class="s-empty__title">' + esc(title) + '</div>'
      + '<div class="s-empty__hint">' + esc(hint) + '</div></div>';
  }

  function mountReco() {
    if (!panelRef) return;
    const host = $('#sPkRecoHost', panelRef);
    if (!host) return;
    let src = document.querySelector('main .paper-picks');
    if (!src) src = document.querySelector('.paper-picks');   // 可能已被搬走
    if (!src) return;
    if (!host.contains(src)) {
      /* 搬原节点（含 #picksMeta/#picksList/#picksRejected + 元素直绑事件），
       * app.js 后续刷新按 id 找节点仍有效（同一节点，只是换了父容器）。 */
      host.appendChild(src);
    }
    /* 数据异步：app.js 可能晚于 mount 才填 picksList，按 id 找节点仍写同一个（已搬入的）
     * 节点，故无需 observer。此处仅防御性检查节点真在工作台 DOM 树里。 */
  }

  function mount() {
    if (!panelRef || !enabled()) return;
    const host = $('#sPkHost', panelRef);
    if (!host) return;
    mountReco();
    const tv = window.__TERMINAL_VIEWS__ || {};
    const sig = window.__SIGNALS__;
    if (typeof tv.picks !== 'function' || !sig || !Object.keys(sig).length) {
      t1Empty(host, '选股数据未就绪', '数据源未返回当日口径，本页不填充估算值。');
      return;
    }
    const dragons = sig.dragonLogic && sig.dragonLogic.dragons;
    if (!Array.isArray(dragons) || !dragons.length) {
      /* 01 册 #5：picks 空态走 T1（不编造主线标的） */
      t1Empty(host, '当日主线标的未产出', 'dragonLogic.dragons 为空，按 T1 克制空状态处理；不填充估算标的。');
      return;
    }
    try {
      const node = tv.picks(sig);      // 终端视图现成 render：天梯/GLM/过滤/下钻原样复用
      if (!(node instanceof Node)) throw new Error('render 未返回节点');
      host.innerHTML = '';
      host.appendChild(node);
      host.setAttribute('aria-busy', 'false');
    } catch (e) {
      console.error('[picks] 复用终端 render 失败', e);
      t1Empty(host, '选股渲染失败', '终端 render 异常，数据未被修改。');
    }
  }

  function waitAndMount() {
    let tries = 0;
    const check = () => {
      if (!panelRef || !enabled()) return;
      const ok = window.__TERMINAL_VIEWS__ && typeof window.__TERMINAL_VIEWS__.picks === 'function'
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
      panel.innerHTML = '<h2 class="s-ph-title">工作台 · 选股</h2>'
        + '<p class="s-ph-desc">选股视图已回退（flag picksV2=false），研报/终端原节点未改动。</p>';
      return;
    }
    panelRef = panel;
    panel.innerHTML = ''
      + '<div class="s-page-picks">'
      /* 【重构前功能补回】研判推荐（原研报 .paper-picks：大概率连板置顶/剔除大概率亏/
       * 买点预期/点个股看详情）。搬原节点（app.js/paper_ui.js 元素直绑，事件跟节点走）。 */
      + '<div class="s-section"><div class="s-section__head">'
      + '<h2 class="s-section__title">研判推荐</h2>'
      + '<p class="s-section__note">大概率连板置顶 · 剔除大概率亏 · 点个股看详情</p>'
      + '</div><div id="sPkRecoHost" class="s-reskin"></div></div>'
      + '<div class="s-section"><div class="s-section__head">'
      + '<h2 class="s-section__title">选股 · 主线天梯</h2>'
      + '<p class="s-section__note">复用终端 render · 引擎原值 · AI 侧车仅参考不改分</p>'
      + '</div><div id="sPkHost" aria-busy="true"></div></div>'
      + '<div class="s-section"><div class="s-alert s-alert--muted">'
      + '<div class="s-alert__title">口径与下钻</div>'
      + '<div>连板梯队为引擎产出，GLM 逻辑推演为 AI 侧车（方向 C，仅参考）；'
      + '点标的行打开抽屉看盘口 / 逻辑 / 命中率 / 持仓 / 日K，下钻链路与终端视图一致。</div></div></div>'
      + '</div>';
    waitAndMount();
  }

  S.registerPagePicks = () => {
    if (typeof S.registerPage === 'function') S.registerPage('选股', render, teardown);
  };
  S.registerPagePicks();
  S.teardownPicks = teardown;
})(window.S = window.S || {});
