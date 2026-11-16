/* ══════════════════════════════════════════════════════════════════════════
 * s-page-overview.js — A 方案阶段 2：工作台「总览」页（结论层迁入）
 * ──────────────────────────────────────────────────────────────────────────
 * 契约（06 册「阶段 2 前置契约」，源自 10 册 §7）：
 *   ① clone + MutationObserver 同步——**旧节点原位不动**，绝不把 `<main>` 里的
 *      `#emScore` 等搬走（否则默认研报视图缺 KPI）。本文件读取旧视图**渲染出的值**
 *      或 `window.__signals` 数据，写进新建的 `.s-*` KPI 卡；回默认不清理，天然幂等。
 *   ② 自建 `.s-page-overview` 容器 + `#sKpiScore` 等锚点（骨架只有 `s-ph-*` 占位）。
 *   ③ CLS：阶段 2 按「不劣于基线 0.174」判，≤0.10 留阶段 5。
 *   ④ 触发源显式：工作台激活时本文件主动 `sync()` 一次（`<main>` 是 display:none，
 *      旧 render 仍由 data 到达驱动）；并以 MutationObserver 监听 `#zone-overview`
 *      的 `innerHTML` 覆盖，重复 render 后**幂等重搬**（白屏①）。
 *   ⑤ 不碰 LW canvas（`#trendSvg` / `app.js:684` 趋势图）——canvas re-init 留阶段 3。
 *
 * 关键门禁（阶段 2 上线条件，06 册 L125 / V2-1）：
 *   - `#sKpiScore` 数值与旧 `#emScore` 逐字一致（V2-1）；
 *   - 默认研报视图 6 个 KPI 逐字不变（本文件只读旧节点，不改旧节点）；
 *   - 重复 render 后适配层幂等重搬，第二帧不回旧布局（白屏①）。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  const txt = (sel) => { const n = $(sel); return n ? n.textContent.trim() : null; };
  const num = (v, d = 1) => (v == null || isNaN(+v) ? null : (+v).toFixed(d));

  /* ---------- 市场状态标签（镜像 app.js regime key → 中文标签） ---------- */
  const REGIME_LABEL = { ice: '冰点', recover: '回暖', neutral: '中性', climax: '高潮', ebb: '退潮', shift: '切换期', unknown: '未生成' };
  const REGIME_DOWN = { ice: 1, ebb: 1, shift: 1 }; // 偏冷/偏弱 → s-kpi__value--down

  /* ---------- 数据源：与 app.js renderEmotion 逐字同源 ----------
   * window.__lastArc（app.js:4357 挂载）= 完整 ARC；
   *   latest = displayDays(arc) 末日（过滤 _backfill，app.js:4316）；
   *   latest.emotion → 情绪分/分位/lhb_daily_net；latest.summary → zt/dt/涨跌家数。
   * window.__signals = signals-latest.json（顶层含 regime / breadth，app.js:2573）。
   * 取值一律「旧渲染节点文本优先、数据兜底」，保证与研报视图逐字一致（契约①）。 */
  function lastDay() {
    const arc = window.__lastArc;
    const all = (arc && arc.all_days) || [];
    const days = all.filter((d) => !(d.emotion && d.emotion._backfill));
    return days[days.length - 1] || null;
  }

  /* ---------- 6 KPI 取值（旧渲染节点优先，数据兜底） ---------- */
  function readKpis() {
    const day = lastDay() || {};
    const em = day.emotion || {};
    const sm = day.summary || {};
    const sig = window.__signals || {};
    const reg = (sig.regime && sig.regime.latest) || {};
    const regLabel = REGIME_LABEL[reg.key] || (reg.key || '未生成');

    // 涨/跌家数：优先读旧 #breadthPanel 渲染值（沪深两市口径），数据兜底用 latest.summary
    let breadth = null;
    const bwUp = Array.from(document.querySelectorAll('#breadthPanel .bw-kpi'))
      .find((el) => /沪深上涨/.test(el.textContent || ''));
    const bwDn = Array.from(document.querySelectorAll('#breadthPanel .bw-kpi'))
      .find((el) => /沪深下跌/.test(el.textContent || ''));
    if (bwUp && bwDn) {
      const u = $('.bw-v', bwUp), d = $('.bw-v', bwDn);
      if (u && d) breadth = `${u.textContent.trim()} / ${d.textContent.trim()}`;
    }
    if (!breadth && sm.up_count != null && sm.down_count != null) {
      breadth = `${sm.up_count} / ${sm.down_count}`;
    }

    return {
      score:   txt('#emScore') ?? num(em.value ?? em.score),                 // 情绪分
      pct:     txt('#emPct') ?? (em.pct_rank != null ? String(em.pct_rank) : null), // 历史分位 %
      regime:  regLabel,                                                     // 市场状态
      regimeKey: reg.key,
      pos:     (txt('#emTier') || '').replace(/^档位\s*/, '') || null,        // 执行仓位（V5.2 档位）
      limit:   (sm.zt_count != null && sm.dt_count != null) ? `${sm.zt_count} / ${sm.dt_count}` : null, // 涨停/跌停
      breadth,                                                               // 涨/跌家数
      lhb:     txt('#emNet') ?? (em.lhb_daily_net != null ? `当日龙虎净买 ${em.lhb_daily_net} 亿` : null), // 龙虎净买
    };
  }

  /* ---------- 构建 / 同步 ---------- */
  let built = false, observer = null;

  function kpiCard(label, id, value, delta, down) {
    return `<div class="s-kpi${down ? ' s-kpi--danger' : ''}">`
      + `<span class="s-kpi__label">${label}</span>`
      + `<span class="s-kpi__value${down ? ' s-kpi__value--down' : ''}" id="${id}">${value ?? '—'}</span>`
      + (delta ? `<span class="s-kpi__delta">${delta}</span>` : '')
      + `</div>`;
  }

  function render(panel) {
    if (!panel) return;
    let host = panel.querySelector('.s-page-overview');
    if (!host) {
      host = document.createElement('div');
      host.className = 's-page-overview';
      host.innerHTML =
        `<div class="s-verdict"><span class="s-verdict__sub" id="sVerdictSub">—</span></div>`
        + `<div class="s-section"><h2 class="s-section__title">核心指标</h2>`
        + `<div class="s-grid s-grid--kpi" id="sKpiRow">`
        + kpiCard('情绪分', 'sKpiScore', null, '历史分位 —')
        + kpiCard('市场状态', 'sKpiRegime', null, 'regime 序列')
        + kpiCard('执行仓位', 'sKpiPos', null, '分位优先 · 风控帽')
        + kpiCard('涨停 / 跌停', 'sKpiLimit', null, '封板率')
        + kpiCard('涨 / 跌家数', 'sKpiBreadth', null, '沪深两市口径')
        + kpiCard('龙虎净买', 'sKpiLhb', null, '当日榜口径')
        + `</div></div>`;
      panel.innerHTML = '';
      panel.appendChild(host);
      built = true;
    }
    sync();
    armObserver();
  }

  function setVal(id, v, down) {
    const n = document.getElementById(id);
    if (!n) return;
    const nv = v ?? '—';
    if (n.textContent !== nv) n.textContent = nv;
    if (down != null) n.classList.toggle('s-kpi__value--down', !!down);
  }

  function sync() {
    const k = readKpis();
    setVal('sKpiScore', k.score);
    setVal('sKpiRegime', k.regime, !!REGIME_DOWN[k.regimeKey]);
    setVal('sKpiPos', k.pos, /冰点|清仓|0~20/.test(k.pos || ''));
    setVal('sKpiLimit', k.limit);
    setVal('sKpiBreadth', k.breadth);
    setVal('sKpiLhb', (k.lhb || '').replace(/^当日龙虎净买\s*/, '').replace(/\s*亿$/, ' 亿') || k.lhb, /^-/.test(k.lhb || '') || /-\d/.test(k.lhb || ''));
    // delta：历史分位挂到情绪分卡
    const dScore = document.querySelector('#sKpiScore')?.closest('.s-kpi')?.querySelector('.s-kpi__delta');
    if (dScore && k.pct != null) dScore.textContent = `历史分位 ${k.pct}%`;
    const vsub = document.getElementById('sVerdictSub');
    if (vsub) vsub.textContent =
      `情绪分 ${k.score ?? '—'}，历史分位 ${k.pct ?? '—'}%，市场状态 ${k.regime}` + (k.pos ? `，执行仓位 ${k.pos}` : '');
  }

  /* ④ 幂等重搬：监听旧 #zone-overview 的 innerHTML 覆盖，重复 render 后重新同步 */
  function armObserver() {
    if (observer) return;
    const src = document.getElementById('zone-overview');
    if (!src || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(() => {
      // 仅在工作台激活态同步；旧视图照旧渲染（本文件不改旧节点）
      if (document.body.dataset.view === 'workbench' && built) sync();
    });
    observer.observe(src, { childList: true, subtree: true, characterData: true });
  }

  /* ---------- 注册到 s-root.js 的页路由（总览 = 第 0 tab） ---------- */
  S.registerPageOverview = () => {
    if (typeof S.registerPage === 'function') S.registerPage('总览', render);
  };
  S.registerPageOverview();

  // 显式触发源：工作台激活且当前停在总览 tab 时主动渲染一次（④）
  const boot = () => {
    if (document.body.dataset.view === 'workbench' && typeof S.showPage === 'function') S.showPage('总览');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.S = window.S || {});
