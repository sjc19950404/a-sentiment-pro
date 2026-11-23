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

  let recoTimer = null;
  /* 【s-* 原生重写】研判推荐：读 paper_ui.js 的只读取数 __picks()（与研报同源），
   * 用工作台 s-card/s-table/s-badge/s-btn 渲染——不搬旧 DOM、不换皮、不复制取数逻辑。 */
  function mountReco() {
    if (recoTimer) { clearInterval(recoTimer); recoTimer = null; }
    let tries = 0;
    const draw = () => {
      const host = $('#sPkRecoHost', panelRef);
      if (!host) return;
      const getPicks = window.__picks;
      if (typeof getPicks !== 'function' || !getPicks()) {
        if (++tries <= 30) return;              // 等 paper_ui.js 异步加载（最多 15s）
        clearInterval(recoTimer); recoTimer = null;
        t1Empty(host, '研判推荐未就绪', '取数引擎未返回当日口径，不填充估算标的。');
        return;
      }
      if (recoTimer) { clearInterval(recoTimer); recoTimer = null; }
      const r = getPicks();
      const picks = r.picks || [];
      const pred = r.pred || {};
      const tier = r.tier || {};
      const num = (v, d = 2) => v == null ? '—' : (+v).toFixed(d);
      const sign = (v, suffix = '') => v == null ? '—' : (v > 0 ? '+' : '') + v + suffix;
      const cls = (v) => v == null ? '' : v > 0 ? 's-num--up' : v < 0 ? 's-num--down' : '';

      /* 【P0-2 风控帽显式化 2026-11-19】引擎 suggestWeight 走 V5.2 绝对分档（半仓档→
       * 单票均分），与风控帽（POSITION_BANDS by regime）不互通——真冰点日曾给 3 只
       * 连板票合计 50% 敞口。帽子语义＝风控上限优先（position_policy 头注纪律）：
       * 超帽时显式告警并给出按帽折算的单票上限。不改引擎数值（信号归信号、帽子归帽子，
       * 引擎层闸门变更需重拍板）。 */
      const bandArr = (() => { const rk = ((window.__signals || {}).regime || {}).latest && window.__signals.regime.latest.key; const B = window.__POSITION_BANDS__ || {}; return (rk && B[rk]) || null; })();
      const openSum = picks.reduce((a, p) => a + (+p.suggestWeight || 0), 0) * 100;
      /* 【2026-11-24 拍板二】旧条件 openSum>帽上限在"全观察档"（suggestWeight 全 0）时
       * 永不触发——狂热日（只减仓不新建）卡上列 3 只观察档却零告警，读者会误读为可买。
       * 补分支：禁新建档（帽上限 ≤20%）有票即警，与数值超帽同级别提示。 */
      const capOver = bandArr && openSum > bandArr[1];
      const capNoNew = bandArr && !(openSum > bandArr[1]) && picks.length > 0 && bandArr[1] <= 20;
      const capAlert = (capOver || capNoNew)
        ? '<div class="s-alert s-alert--warn" style="margin-bottom:var(--s-space-3)">'
          + '<div class="s-alert__title">⚠ 风控帽约束（分位优先口径）</div>'
          + (capOver
            ? '<div>当前 regime 风控帽 ' + bandArr[0] + '%~' + bandArr[1] + '%，下方引擎口径建议合计 '
              + openSum.toFixed(1) + '%（已超帽）。帽子按设计优先生效：实际执行请按帽削减（单票 ≤'
              + (bandArr[1] / Math.max(1, picks.length)).toFixed(1) + '%）或放弃新开仓。</div>'
            : '<div>当前 regime 风控帽 ' + bandArr[0] + '%~' + bandArr[1] + '%（只减仓不新建档）——'
              + '下方 ' + picks.length + ' 只均为<b>观察档·未达买入门槛</b>（引擎建议合计 0%），非买入信号；'
              + '新建仓在当前档位下违背风控帽，本卡仅作盘面结构观察用。</div>')
          + '</div>'
        : '';
      const meta = '<div class="s-verdict" style="margin-bottom:var(--s-space-3)">'
        + '<span class="s-verdict__sub">数据日 ' + esc(r.asOf || '—')
        + ' · 情绪分 <b class="s-num">' + num(r.score, 1) + '</b>'
        + ' · 档位 <span class="s-badge s-badge--muted">' + esc(tier.label || '—') + '</span>'
        + ' · 候选池 <b class="s-num">' + (r.pool || 0) + '</b> 只'
        + ' → 推荐 <b class="s-num s-num--up">' + picks.length + '</b> 只'
        + ' · 剔除 <b class="s-num s-num--down">' + (pred.rejected == null ? '—' : pred.rejected) + '</b> 只'
        + ' · 未达门槛 ' + (pred.below == null ? '—' : pred.below) + ' 只</span></div>';

      const warn = (r.climaxWarnings || []).length
        ? '<div class="s-alert s-alert--warn" style="margin-bottom:var(--s-space-3)">'
        + '<div class="s-alert__title">情绪高潮预警</div>'
        + '<div>⚠ ' + esc(r.climaxWarnings.map((w) => w.sector).join('、'))
        + ' 板块次日谨防分歧——已禁推前排高标，仅留低位首板补涨。</div></div>'
        : '';

      const rows = picks.map((p, i) => {
        const prob = p.prob || {}, band = prob.band || {};
        const tags = (p.gateTags || []).map((t) =>
          '<span class="s-badge s-badge--muted">' + esc(t) + '</span>').join('');
        const reasons = (p.reasons || []).map((x) => esc(x.text)).join(' · ');
        return '<tr data-pick-code="' + esc(p.code) + '" tabindex="0" role="button" title="点看个股详情">'
          + '<td>' + (p.suggestWeight > 0
            ? '<span class="s-badge s-badge--up">推荐档</span>'
            : '<span class="s-badge s-badge--warn">观察档·未达买入门槛</span>')
          + (p.streakTop ? ' <span class="s-badge s-badge--up">连板</span>' : '') + '</td>'
          + '<td><b>' + esc(p.name || p.code) + '</b> <span class="s-num s-text-3">' + esc(p.code) + '</span></td>'
          + '<td class="s-num ' + cls(p.changePct) + '">' + sign(p.changePct, '%') + '</td>'
          + '<td class="s-num">' + (prob.score == null ? '—' : String(Math.round(+prob.score))) + '</td>'
          + '<td>' + (p.suggestWeight > 0 ? num(p.suggestWeight * 100, 1) + '%' : '观察档') + '</td>'
          + '<td>' + tags + (reasons ? '<div class="s-text-3" style="font-size:var(--s-font-xs);margin-top:2px">'
            + esc(reasons.slice(0, 60)) + '</div>' : '') + '</td>'
          + '<td><button type="button" class="s-btn s-btn--ghost s-btn--xs" data-fill-code="'
          + esc(p.code) + '">填入下单</button></td></tr>';
      }).join('');

      const table = picks.length
        ? '<div class="s-table-wrap"><div class="s-table__viewport"><table class="s-table s-table--compact">'
        + '<thead><tr><th>性质</th><th>名称 / 代码</th><th>涨跌幅</th><th>相对强度（校准见注）</th>'
        + '<th title="引擎 V5.2 绝对分档口径——与风控帽（分位优先）是两把尺子，超帽时见上方告警条">建议仓位（引擎口径）</th><th>核心逻辑</th><th>操作</th></tr></thead><tbody>'
        + rows + '</tbody></table></div></div>'
        : '<div class="s-empty"><div class="s-empty__title">今日无推荐标的</div>'
        + '<div class="s-empty__hint">' + esc((r.note && r.note.text) || '按当日口径无达标标的，不填充估算值。') + '</div></div>';

      const rj = r.rejected || [];
      const blocked = r.climaxBlocked || [], trimmed = r.sectorTrimmed || [];
      const rejDetail = rj.map((p) => '<div class="s-rej-row">'
        + '<b>' + esc(p.name || p.code) + '</b> <span class="s-text-3 s-num">' + esc(p.code) + '</span>'
        + ' <span class="s-badge s-badge--down">' + esc(p.reason || '大概率亏') + '</span></div>').join('')
        + [...blocked, ...trimmed].map((x) => '<div class="s-rej-row">'
          + '<b>' + esc(x.name) + '</b> <span class="s-badge s-badge--warn">'
          + esc(x.reason || '情绪闸门拦截') + '</span></div>').join('');
      const rejected = (rj.length || blocked.length || trimmed.length)
        ? '<details class="s-rej"><summary>已剔除 ' + (rj.length + blocked.length + trimmed.length)
        + ' 只「大概率亏 / 闸门拦截」（点开看原因）</summary><div class="s-rej-body">'
        + rejDetail + '</div></details>'
        : '';

      host.innerHTML = '<div class="s-card"><div class="s-card__body">'
        + capAlert + meta + warn + table + rejected + '</div></div>';

      /* 交互：行点击下钻（复用 paper_ui 的 pickDetail 若导出，否则用 S.openDrawer 展示真值） */
      host.querySelectorAll('tr[data-pick-code]').forEach((tr) => {
        const open = () => {
          const p = picks.find((x) => x.code === tr.dataset.pickCode);
          if (!p || typeof S.openDrawer !== 'function') return;
          S.openDrawer({
            size: 'sm', title: p.name || p.code, sub: p.code + ' · 研判推荐当日快照',
            render(body) {
              body.innerHTML = '<div class="s-grid s-grid--kpi">'
                + [['涨跌幅', sign(p.changePct, '%')], ['相对强度', prob(p)],
                   ['建议仓位', p.suggestWeight > 0 ? num(p.suggestWeight * 100, 1) + '%' : '观察档'],
                   ['止损', p.stop ? num(p.stop.stopLossPct * 100, 0) + '%' : '—']]
                .map(([n, v]) => '<div><div class="s-kpi__label">' + n
                  + '</div><div class="s-kpi__value" style="font-size:var(--s-font-lg)">' + esc(v) + '</div></div>').join('')
                + '</div>'
                + (p.risks && p.risks.length ? '<p class="s-kpi__note">风险：' + esc(p.risks.join('；')) + '</p>' : '');
            },
          });
        };
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
      /* 填入下单：复用 paper_ui 的 fillPickToOrder 若导出，否则跳模拟盘页 */
      host.querySelectorAll('[data-fill-code]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.__paperFill === 'function') window.__paperFill(b.dataset.fillCode);
        else if (typeof S.showPage === 'function') S.showPage('模拟盘');
      }));
    };
    draw();
    if (!$('#sPkRecoHost', panelRef)?.innerHTML.trim()) {
      recoTimer = setInterval(draw, 500);
    }
  }
  /* 【2026-11-24 校准回测后改名】prob.score 经 270 交易日分层校准：60–65 档实际次日
   * 上涨率 47.1%（<48% 负价值线）且单调性破坏——"上涨概率"标签不成立，改"相对强度"
   * 并取整去小数点（小数位是伪精度）。校准脚本 tools/backtest/prob_calibration.mjs。 */
  function prob(p) { return p && p.prob && p.prob.score != null ? String(Math.round(+p.prob.score)) : '—'; }

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
      + '</div><div id="sPkRecoHost"></div></div>'
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
