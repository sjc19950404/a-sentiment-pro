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
  /* 【2026-11-24 拍板二落地：前端只渲染不自算】此前 mountReco 读 __picks()（浏览器里
   * 用 recent.latest 数据实时重跑 recommendPicks）——与 Pi 落档 reco_picks_latest.json
   * 是同一引擎两套结论（11-23 实测：页面 kept=65/59/59、Pi 落档 kept=0；根因是
   * summary.seats.detail 双序列化形态——archive 存席位编号、latest 存席位名，游资
   * 席位挂件按名匹配只在 latest 生效。待拍板统一）。拍板：计算收敛到落档一处，
   * 本页改为读 reco_picks_latest.json 渲染（推荐档 picks + 观察档 observe），不再自算。
   * 【禁静默回退（拍板三条验收线之三）】落档缺失 / 落档数据日滞后于页面数据日 →
   * 显式"数据未就绪"提示，绝不回落浏览器自算——回退一次等于把口径漂移装回去。
   * （11-20 recent 停更实例已证明静默回退的害处。） */
  function mountReco() {
    if (recoTimer) { clearInterval(recoTimer); recoTimer = null; }
    let tries = 0;
    const notReady = (host, why, hint) => {
      t1Empty(host, '选股落档未就绪',
        why + '（' + hint + '）——按「前端只渲染不自算」纪律，本卡不回落浏览器估算，不填充标的。');
    };
    const draw = async () => {
      const host = $('#sPkRecoHost', panelRef);
      if (!host) return;
      /* 页面数据日取 paper_ui 已加载的当日（asOf），用于落档滞后判定 */
      const getPicks = window.__picks;
      const pageAsOf = (typeof getPicks === 'function' && getPicks() && getPicks().asOf) || null;
      let arc = null;
      try {
        const res = await fetch(S.durl ? S.durl('./data/reco_picks_latest.json') : './data/reco_picks_latest.json', { cache: 'no-store' });
        if (res.ok) arc = await res.json();
      } catch { /* 落档缺失走未就绪 */ }
      if (recoTimer) { clearInterval(recoTimer); recoTimer = null; }
      if (!arc || !arc.date) {
        notReady(host, 'reco_picks_latest.json 缺失或为空', 'Pi 落档管道未产出当日档');
        return;
      }
      if (pageAsOf && arc.date !== pageAsOf) {
        notReady(host, '落档数据日 ' + arc.date + ' 落后于页面数据日 ' + pageAsOf,
          'Pi 落档管道滞后——等当日 EOD 落档后刷新');
        return;
      }
      renderFromArchive(host, arc);
    };
    draw().catch((e) => {
      const host = $('#sPkRecoHost', panelRef);
      if (host) notReady(host, '落档加载异常 ' + String(e && e.message || e).slice(0, 40), 'fail-visible，不回退自算');
    });
  }

  /* 落档渲染：reco_picks_latest.json 的 picks/observe/stats/rejected → 工作台卡 */
  function renderFromArchive(host, arc) {
      const picks = arc.picks || [];
      const observe = arc.observe || [];
      const stats = arc.stats || {};
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
        + '<span class="s-verdict__sub">数据日 ' + esc(arc.date || '—') + '（Pi 落档·前端不自算）'
        + ' · 情绪分 <b class="s-num">' + num(arc.emotionScore, 1) + '</b>'
        + ' · 候选池 <b class="s-num">' + (stats.universe == null ? '—' : stats.universe) + '</b> 只'
        + ' → 推荐 <b class="s-num s-num--up">' + picks.length + '</b> 只'
        + ' · 剔除 <b class="s-num s-num--down">' + (stats.removed == null ? '—' : stats.removed) + '</b> 只'
        + ' · 未达门槛 ' + (stats.below == null ? '—' : stats.below) + ' 只'
        + (stats.observeCount != null ? ' · 观察档 ' + stats.observeCount + ' 只' : '') + '</span></div>';

      /* 行渲染（推荐档 + 观察档共用）：落档字段 probScore/gateTags/streakTop/changePct。
       * 性质 badge：推荐档=引擎给出建议仓位；观察档=同引擎同数据、只换门槛后仍未达标——
       * 观察档·非买入信号（2026-11-24 拍板二，去序号防操作暗示）。 */
      const pickRow = (p, tier) => {
        const tags = (p.gateTags || []).map((t) =>
          '<span class="s-badge s-badge--muted">' + esc(t) + '</span>').join('');
        const badge = tier === 'pick'
          ? '<span class="s-badge s-badge--up">推荐档</span>'
          : '<span class="s-badge s-badge--warn">' + esc(tier === 'below_zt' ? '观察档·涨停未过门槛'
            : tier === 'kept_no_weight' ? '观察档·未获仓位' : '观察档·未达买入门槛') + '</span>';
        return '<tr data-pick-code="' + esc(p.code) + '" tabindex="0" role="button" title="点看个股详情">'
          + '<td>' + badge + (p.streakTop ? ' <span class="s-badge s-badge--up">连板</span>' : '') + '</td>'
          + '<td><b>' + esc(p.name || p.code) + '</b> <span class="s-num s-text-3">' + esc(p.code) + '</span></td>'
          + '<td class="s-num ' + cls(p.changePct) + '">' + sign(p.changePct, '%') + '</td>'
          + '<td class="s-num">' + (p.probScore == null ? '—' : String(p.probScore)) + '</td>'
          + '<td>' + (p.suggestWeight > 0 ? num(p.suggestWeight * 100, 1) + '%' : '观察档') + '</td>'
          + '<td>' + tags + '</td>'
          + '<td><button type="button" class="s-btn s-btn--ghost s-btn--xs" data-fill-code="'
          + esc(p.code) + '">填入下单</button></td></tr>';
      };
      const rows = picks.map((p) => pickRow(p, 'pick')).join('');
      const obsRows = observe.map((p) => pickRow(p, p.observeTier || 'below_threshold')).join('');

      const table = (picks.length || obsRows.length)
        ? '<div class="s-table-wrap"><div class="s-table__viewport"><table class="s-table s-table--compact">'
        + '<thead><tr><th>性质</th><th>名称 / 代码</th><th>涨跌幅</th><th>相对强度（校准见注）</th>'
        + '<th title="C 终态：情绪分仅告警不参与仓位——此列为满仓 beta 等权 1/n（受单票 20% 上限约束）；旧 V5.2 档位/风控帽口径已停用">建议仓位（等权）</th><th>核心逻辑</th><th>操作</th></tr></thead><tbody>'
        + rows + obsRows + '</tbody></table></div></div>'
        : '<div class="s-empty"><div class="s-empty__title">今日无推荐与观察标的</div>'
        + '<div class="s-empty__hint">' + esc(String(arc.note || '').slice(0, 120) || '按当日口径无达标标的，不填充估算值。') + '</div></div>';

      /* 已剔除：落档 rejected（规则剔除，reasons 数组） */
      const rj = arc.rejected || [];
      const rejDetail = rj.map((p) => '<div class="s-rej-row">'
        + '<b>' + esc(p.name || p.code) + '</b> <span class="s-text-3 s-num">' + esc(p.code || '') + '</span>'
        + ' <span class="s-badge s-badge--down">' + esc((p.reasons || []).join('；') || '大概率亏') + '</span></div>').join('');
      const rejected = rj.length
        ? '<details class="s-rej"><summary>已剔除 ' + rj.length + ' 只「大概率亏 / 闸门拦截」（点开看原因）</summary>'
        + '<div class="s-rej-body">' + rejDetail + '</div></details>'
        : '';

      host.innerHTML = '<div class="s-card"><div class="s-card__body">'
        + capAlert + meta + table + rejected + '</div></div>';

      /* 交互：行下钻抽屉（落档字段裁剪版） */
      const allRows = picks.concat(observe);
      host.querySelectorAll('tr[data-pick-code]').forEach((tr) => {
        const open = () => {
          const p = allRows.find((x) => x.code === tr.dataset.pickCode);
          if (!p || typeof S.openDrawer !== 'function') return;
          S.openDrawer({
            size: 'sm', title: p.name || p.code, sub: p.code + ' · 选股落档当日快照',
            render(body) {
              body.innerHTML = '<div class="s-grid s-grid--kpi">'
                + [['涨跌幅', sign(p.changePct, '%')], ['相对强度', p.probScore == null ? '—' : String(p.probScore)],
                   ['建议仓位', p.suggestWeight > 0 ? num(p.suggestWeight * 100, 1) + '%' : '观察档'],
                   ['来源档', p.observeTier ? '观察档(' + p.observeTier + ')' : '推荐档']]
                .map(([n, v]) => '<div><div class="s-kpi__label">' + n
                  + '</div><div class="s-kpi__value" style="font-size:var(--s-font-lg)">' + esc(v) + '</div></div>').join('')
                + '</div>'
                + (p.buyPoint ? '<p class="s-kpi__note">买点：' + esc(p.buyPoint) + '</p>' : '');
            },
          });
        };
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
      host.querySelectorAll('[data-fill-code]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.__paperFill === 'function') window.__paperFill(b.dataset.fillCode);
        else if (typeof S.showPage === 'function') S.showPage('模拟盘');
      }));
  }
  /* 【2026-11-24 校准回测后改名——理由修正（用户拍板）】270 交易日分层校准
   * （tools/backtest/prob_calibration.mjs）显示该刻度单调性破坏（55–60 档命中率 64.5%
   * 反高于 60–65 档 47.1%，后者单档置信区间 ±14pp 不足以单独证伪）——刻度没有单调性
   * 就不配叫概率，与单档负价值与否无关。改"相对强度"并取整去小数点（小数位是伪精度）。
   * 下一步方向（待拍板）：0–100 伪刻度换当日候选池内分位（rank/percentile，天然单调）。 */
  function prob(p) {
    if (p && p.probScore != null) return String(p.probScore);
    if (p && p.prob && p.prob.score != null) return String(Math.round(+p.prob.score));
    return '—';
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
