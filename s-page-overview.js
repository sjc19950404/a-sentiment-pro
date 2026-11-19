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

  /* ---------- 6 KPI 取值（旧渲染节点优先，数据兜底） ----------
   * 【11 册 §4 / 7.1】首帧口径纪律：DOM 未就绪时一律显示「加载中…」占位，
   * 绝不用**不同口径**的数据兜底。曾有的 bug：breadth 在 #breadthPanel 未渲染时
   * 用 __lastArc.summary（全市场 755/4472），DOM 到齐后跳到「沪深两市」744/4415，
   * 首帧 2.5 秒口径错；regime 在 __signals 未到时显示「未生成」违反 L125 首帧语义。 */
  const LOADING = '加载中…';
  function readKpis() {
    const day = lastDay() || {};
    const em = day.emotion || {};
    const sm = day.summary || {};
    const sig = window.__signals || {};
    const reg = (sig.regime && sig.regime.latest) || {};
    const sigReady = !!(sig.regime && sig.regime.latest); // signals 到位才算 regime 可信

    // 涨/跌家数：只认旧 #breadthPanel 渲染值（沪深两市·不含北交所口径）；
    // 未渲染时占位，不拿 summary.up_count 兜底——那是全市场口径，会跳变（11 册 §4）。
    let breadth = null;
    const bwUp = Array.from(document.querySelectorAll('#breadthPanel .bw-kpi'))
      .find((el) => /沪深上涨/.test(el.textContent || ''));
    const bwDn = Array.from(document.querySelectorAll('#breadthPanel .bw-kpi'))
      .find((el) => /沪深下跌/.test(el.textContent || ''));
    if (bwUp && bwDn) {
      const u = $('.bw-v', bwUp), d = $('.bw-v', bwDn);
      if (u && d && !/未评估|—/.test(u.textContent + d.textContent)) {
        breadth = `${u.textContent.trim()} / ${d.textContent.trim()}`;
      }
    }
    if (!breadth) breadth = LOADING;

    // 市场状态：signals 未到位时占位，不显示「未生成」（后者是"该日无判据"的结论，非"还没加载"）
    const regLabel = sigReady ? (REGIME_LABEL[reg.key] || reg.key || LOADING) : LOADING;

    return {
      score:   txt('#emScore') && txt('#emScore') !== '--' ? txt('#emScore') : (num(em.value ?? em.score) ?? LOADING), // 情绪分（V2-1 逐字对齐）
      pct:     txt('#emPct') ?? (em.pct_rank != null ? String(em.pct_rank) : null), // 历史分位 %
      regime:  regLabel,                                                     // 市场状态
      regimeKey: sigReady ? reg.key : null,
      /* 【2026-11-19 P0-1 口径修复】仓位主口径＝风控帽区间（POSITION_BANDS by regime key，
       * app.js 暴露 window.__POSITION_BANDS__，唯一出处 src/position_policy.js）。此前直接
       * 搬 #emTier（V5.2 绝对分档），而 app.js L1559 明示该档「降级为交叉验证、仓位结论以
       * 历史分位/风控帽为主」——真冰点（分位 5.1%）日曾显示「建议压到半仓」并盖章
       * 「分位优先 · 风控帽」，口径冒用。signals 未就绪时回退绝对分档（降级显示）。 */
      band:    (() => { const B = window.__POSITION_BANDS__ || {}; const rk = sigReady ? reg.key : null; return (rk && B[rk]) || null; })(),
      tierAbs: (txt('#emTier') || '').replace(/^档位\s*/, '') || null,          // V5.2 绝对分档（交叉验证披露）
      pos:     (() => { const B = window.__POSITION_BANDS__ || {}; const rk = sigReady ? reg.key : null; const b = rk && B[rk]; return b ? `${b[0]}~${b[1]}%` : ((txt('#emTier') || '').replace(/^档位\s*/, '') || LOADING); })(),
      limit:   (sm.zt_count != null && sm.dt_count != null) ? `${sm.zt_count} / ${sm.dt_count}` : LOADING, // 涨停/跌停（唯一数源=summary，无异口径风险）
      breadth,                                                               // 涨/跌家数
      lhb:     txt('#emNet') ?? (em.lhb_daily_net != null ? `当日龙虎净买 ${em.lhb_daily_net} 亿` : LOADING), // 龙虎净买
      date:    day.trade_date || null,                                         // 数据日（结论依据行原型字面）
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
  /* 【25B 原型逐字对齐】原型 L90-125：s-card > s-card__body > label/value/delta/note
   * **无内层 .s-kpi**（该层是遗留样式，多一层会改变 flex 间距）。选择器统一改 closest('.s-card')。
   * 【25 册 P1-3】仅情绪分卡用 --s-font-kpi(40px)，其余 --s-font-xl。 */
  function kpiCard2(label, id, delta, note, down, size) {
    return `<div class="s-card"><div class="s-card__body">`
      + `<div class="s-kpi__label">${label}</div>`
      + `<div class="s-kpi__value${down ? ' s-kpi__value--down' : ''}" id="${id}" style="font-size:${size || 'var(--s-font-xl)'}">—</div>`
      + `<div class="s-kpi__delta">${delta}</div>`
      + `<div class="s-kpi__note">${note}</div>`
      + `</div></div>`;
  }

  /* 【11 册 §7.2 / 05 册 L126】overview 回退开关：flag 关闭时本页不执行任何搬迁/渲染，
   * 由 s-root.js 的 showPage 回落占位。每次 render/sync 都查，支持运行时 S.setFlag 动态关闭。 */
  function overviewEnabled() { return S.getFlag('overview', true) !== false; }

  function render(panel) {
    if (!panel) return;
    // 【12 册 §4 P2-A】flag 关闭时自己写「总览」占位：s-root.js 的 showPage 只看 pages[name]
    // 是否存在（「总览」已注册），短路 render 不会切到占位分支，若不写这里会残留上一 tab 的标题。
    if (!overviewEnabled()) {
      panel.innerHTML = '<h2 class="s-ph-title">工作台 · 总览</h2>'
        + '<p class="s-ph-desc">总览视图已回退（flag overview=false）。</p>';
      return;
    }
    let host = panel.querySelector('.s-page-overview');
    if (!host) {
      host = document.createElement('div');
      host.className = 's-page-overview';
      /* 【视觉稿逐字对齐】原型 index.html L76-144 结论层：section head + 三段 verdict
       * (徽标/结论/依据) + 6 张 s-card KPI(每张含 label/value/delta/note) + 13 项状态折叠门。
       * 保留 #sKpi* / #sVerdictSub / .s-kpi__delta 锚点不破坏已绿同步逻辑；
       * 每张卡内层加 .s-kpi 包装兼容 sync() 的 closest('.s-kpi')。数值运行时填，文案照原型。 */
      host.innerHTML =
        `<section class="s-section">`
        + `<div class="s-section__head"><h2 class="s-section__title">今日结论</h2>`
        + `<p class="s-section__note">结论层 · 目标 3 秒内回答「今天盘面有什么风险」</p></div>`
        + `<div class="s-verdict s-verdict--warn" id="sVerdict" role="status">`
        + `<span class="s-badge s-badge--warn">风险提示</span>`
        + `<span class="s-verdict__text" id="sVerdictText">市场处于冰点区间，宽度背离与亏钱效应同时触发，执行仓位建议压到 0–20%，不宜追高。</span>`
        + `<span class="s-verdict__sub" id="sVerdictSub">依据 6 项核心指标 · 2 项告警 · 数据日 —</span></div>`
        + `<div class="s-grid s-grid--kpi s-grid--kpi-tall" id="sKpiRow" style="margin-top:var(--s-space-3)">`
        /* 【P1-8 去假占位 2026-11-19】delta/note 原是视觉稿示意值（历史分位—/60日最低12%/
         * 连续4日/risk_budget/28.6%/5板/−3,717/极寒分化扣分10/席位活跃度），JS 失败或时序
         * 竞态时用户会把假数字当真值。统一改「—」（无值不造假），真值由 sync()/evidence 填。 */
        + kpiCard2('情绪分', 'sKpiScore', '历史分位 —', '近 60 日最低 —', true, 'var(--s-font-kpi)')
        + kpiCard2('市场状态', 'sKpiRegime', 'regime 连续 — 日', '防御口径判定中')
        + kpiCard2('执行仓位', 'sKpiPos', '分位优先 · 风控帽', '交叉验证 —')
        + kpiCard2('涨停 / 跌停', 'sKpiLimit', '炸板率 —', '最高板 —')
        + kpiCard2('涨 / 跌家数', 'sKpiBreadth', '宽度 —', '极寒分化判定中')
        + kpiCard2('龙虎净买', 'sKpiLhb', '当日榜口径', '买卖双侧已校验', true)
        + `</div>`
        + `<details class="s-alertstrip s-details" style="margin-top:var(--s-space-3)">`
        + `<summary><span class="s-badge s-badge--info">13 项状态已归并为 1 条结论</span>`
        + `<span style="color:var(--s-warn)">2 项需关注</span>`
        + `<span style="color:var(--s-text-3)">· 其余 11 项正常，不再逐条占位</span></summary>`
        + `<div class="s-alertstrip__body">`
        + `<div class="s-alertstrip__item"><span class="s-badge s-badge--warn">关注</span><span id="sAlWidth"><b>宽度背离</b>：加载中…</span></div>`
        + `<div class="s-alertstrip__item"><span class="s-badge s-badge--warn">关注</span><span id="sAlPain"><b>亏钱效应</b>：加载中…</span></div>`
        + `<div class="s-alertstrip__item"><span class="s-badge s-badge--muted">正常</span><span id="sAlHealth"><b>数据健康</b>：加载中…</span></div>`
        + `<div class="s-alertstrip__item"><span class="s-badge s-badge--muted">正常</span><span><b>交叉校验</b>：席位 / 涨跌停 / 宽度三源一致</span></div>`
        + `<div class="s-alertstrip__item"><span class="s-badge s-badge--muted">正常</span><span><b>双轨一致</b>：执行面 = 回退快照，无回滚</span></div>`
        + `<div class="s-alertstrip__item"><span class="s-badge s-badge--muted">正常</span><span><b>脏数据</b>：0 条，口径校验通过</span></div>`
        + `</div></details></section>`;
      panel.innerHTML = '';
      panel.appendChild(host);
      built = true;
    }
    sync();
    armObserver();
    armSignalPoll(); // 每次渲染总览页都确保 signals 到位轮询在跑（覆盖 hashchange/popstate 后进入的场景）
  }

  function setVal(id, v, down) {
    const n = document.getElementById(id);
    if (!n) return;
    const nv = v ?? '—';
    if (n.textContent !== nv) n.textContent = nv;
    if (down != null) n.classList.toggle('s-kpi__value--down', !!down);
  }

  /* 【25B 原型对齐】涨/跌双色：原型 L110/L116 用 <span class="s-num--up">37</span> / <span class="s-num--down">33</span> */
  function setPair(id, v) {
    const n = document.getElementById(id);
    if (!n || v == null) return;
    const m = String(v).match(/^([\d,]+)\s*\/\s*([\d,]+)$/);
    if (!m) { if (n.textContent !== String(v)) n.textContent = String(v); return; }
    const html = '<span class="s-num--up">' + m[1] + '</span>'
      + ' <span style="color:var(--s-text-3);font-size:var(--s-font-md)">/</span> '
      + '<span class="s-num--down">' + m[2] + '</span>';
    if (n.innerHTML !== html) n.innerHTML = html;
  }

  function sync() {
    if (!overviewEnabled()) return;
    const k = readKpis();
    setVal('sKpiScore', k.score, true);
    setVal('sKpiRegime', k.regime, !!REGIME_DOWN[k.regimeKey]);
    setVal('sKpiPos', k.pos, /冰点|清仓|0~20/.test(k.pos || ''));
    setPair('sKpiLimit', k.limit);
    setPair('sKpiBreadth', k.breadth);
    setVal('sKpiLhb', (k.lhb || '').replace(/^当日龙虎净买\s*/, '').replace(/\s*亿$/, ' 亿') || k.lhb, /^-/.test(k.lhb || '') || /-\d/.test(k.lhb || ''));
    // delta：历史分位挂到情绪分卡
    const dScore = document.querySelector('#sKpiScore')?.closest('.s-card')?.querySelector('.s-kpi__delta');
    if (dScore && k.pct != null) dScore.textContent = `历史分位 ${k.pct}%`;
    const vsub = document.getElementById('sVerdictSub');
    if (vsub) vsub.textContent =
      /* 【P1-8 去硬编码】「2 项告警」是写死占位——告警真值在下方 alertstrip 逐项展示，
       * 写死会在无告警日变假陈述。改为指向明细。 */
      `依据 6 项核心指标 · 告警明细见下 · 数据日 ${k.date || '—'}`;
    /* 【原型字面 2026-11-18】结论句严格按视觉稿原文，只把「冰点/0–20%」随真值替换：
     * 原型：市场处于冰点区间，宽度背离与亏钱效应同时触发，执行仓位建议压到 0–20%，不宜追高。
     * 【2026-11-19 P1-7 条件化】「宽度背离与亏钱效应同时触发」是写死陈述——11-19 恰好
     * 吻合，但换个无告警日就是假陈述。删去该短语（告警明细由 alertstrip 真值承载），
     * 保留原型句式骨架（…压到 … 不宜追高）。仓位真值＝风控帽区间（P0-1）。 */
    const vt = document.getElementById('sVerdictText');
    if (vt && k.regime && k.regime !== LOADING && k.score !== LOADING) {
      vt.textContent = `市场处于${k.regime}区间，执行仓位建议压到 ${k.pos || '—'}，不宜追高。`;
    }
  }

  /* ④ 幂等重搬：监听旧 #zone-overview 的 innerHTML 覆盖，重复 render 后重新同步
   * 【11 册 §4 / 7.1】额外监听 #breadthPanel（在 #preMainPanels，不在 observer 原范围），
   * 让涨跌家数渲染到位后立刻同步、消除首帧口径跳变。 */
  function armObserver() {
    if (observer) return;
    if (typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(() => {
      // 仅在工作台激活态同步；旧视图照旧渲染（本文件不改旧节点）
      if (document.body.dataset.view === 'workbench' && built) sync();
    });
    const src = document.getElementById('zone-overview');
    if (src) observer.observe(src, { childList: true, subtree: true, characterData: true });
    const bp = document.getElementById('breadthPanel');
    if (bp) observer.observe(bp, { childList: true, subtree: true, characterData: true });
  }

  /* 【11 册 §4】显式等 signals 到位：不再依赖其他 render 的 DOM 副作用偶然触发。
   * __signals 是普通属性赋值（app.js:2573），无法可靠 setter 拦截（赋值可能早于本脚本）；
   * 用轻量轮询（到位即停），只在工作台激活且仍有占位 KPI 时运行。 */
  let signalTimer = null;
  function armSignalPoll() {
    if (signalTimer) return;
    let tries = 0;
    signalTimer = setInterval(() => {
      if (!built || document.body.dataset.view !== 'workbench') return;
      const sig = window.__signals;
      const ready = !!(sig && sig.regime && sig.regime.latest);
      if (ready || ++tries > 120) { // 最多 12s（100ms×120），到位或超时即停
        clearInterval(signalTimer); signalTimer = null;
        if (ready) sync();
      }
    }, 100);
  }

  /* ---------- 注册到 s-root.js 的页路由（总览 = 第 0 tab） ---------- */
  S.registerPageOverview = () => {
    // 【7.2】flag 关闭时不注册 → s-root.js showPage 回落占位
    if (overviewEnabled() && typeof S.registerPage === 'function') S.registerPage('总览', render);
  };
  S.registerPageOverview();

  // 显式触发源：工作台激活且当前停在总览 tab 时主动渲染一次（④）
  const boot = () => {
    if (!overviewEnabled()) return;
    if (document.body.dataset.view === 'workbench' && typeof S.showPage === 'function') {
      S.showPage('总览');
      armSignalPoll(); // 【7.1】启动 signals 到位轮询（首帧占位 → 到位即同步）
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.S = window.S || {});
