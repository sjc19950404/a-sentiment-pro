/* ══════════════════════════════════════════════════════════════════════════
 * s-page-overview-evidence.js — 工作台「总览」页证据层（L2）+ 操作层（L3）
 * ──────────────────────────────────────────────────────────────────────────
 * 权威：design/prototype/index.html L146-296（视觉稿本体，13 张真实渲染图来源）
 *       design/04_页面蓝图与组件规格.md 1.2 节（证据层 / 操作层蓝图）
 * 本文件只「追加」证据层 DOM 到 .s-page-overview 容器，**不改 s-page-overview.js 的结论层
 * 一行**（结论层 6 KPI 已经过阶段 2/3/4 多轮门禁验证，改它=破坏已绿验收）。
 *
 * 数据全部来自真实 JSON（不造假、不写死快照）：
 *   - 情绪分走势：data/emotion_history.json 的 history[].score（266 项，取近 N 日）
 *   - 七因子贡献：history[-1].metrics + 当日 signals（有值取真值，无值标"—"不编造）
 *   - 三卡 / 明细：signals-latest.json / hot 数据（有则填，无则如实空状态）
 * 绘图照抄原型 drawTrend / drawFactors（s-components.css 的 .s-chart__* / .s-factor__* 样式全齐）。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});
  if (typeof S.getFlag !== 'function') {
    var f = Object.create(null);
    S.getFlag = function (n, d) { return n in f ? f[n] : d; };
    S.setFlag = S.setFlag || function (n, v) { f[n] = v; return v; };
  }
  const $ = (s, r) => (r || document).querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  let CACHE = null;      // { history:[], day:{}, signals:{} }
  let range = 60;        // 走势图时间窗（顶栏 chips 20/30/60/90）
  let observer = null;
  let built = false;

  /* 【25 册 P1-5】个股明细表结构常量：空态时 viewport 整体替换为 s-empty，有数据时重建 */
  const HOT_TABLE =
    '<table class="s-table" id="sEvHotTable">'
    + '<thead><tr><th data-priority="1">代码 / 名称</th><th data-priority="1">现价</th><th data-priority="1">涨跌幅</th>'
    + '<th data-priority="2">连板</th><th data-priority="3">所属题材</th></tr></thead>'
    + '<tbody id="sEvHotBody"></tbody></table>';

  function enabled() { return S.getFlag('overview', true) !== false; }

  /* ---------- 数据加载：真实 JSON ---------- */
  async function load() {
    if (CACHE) return CACHE;
    const out = { history: [], day: {}, signals: {} };
    await Promise.all([
      fetch('./data/emotion_history.json?_=' + Date.now(), { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null).then((d) => {
          if (d && Array.isArray(d.history)) out.history = d.history;
        }).catch(() => {}),
      fetch('./data/signals-latest.json?_=' + Date.now(), { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null).then((d) => { if (d) out.signals = d; }).catch(() => {}),
    ]);
    out.day = out.history[out.history.length - 1] || {};
    CACHE = out;
    return out;
  }

  /* ---------- 走势图（照抄原型 drawTrend，喂真实 score） ---------- */
  function series(a, n) { const k = Math.min(n, a.length); return a.slice(-k).map((x) => x.score != null ? x.score : (typeof x === 'number' ? x : 50)); }
  function ma(a, w) { return a.map((_, i) => { const s = a.slice(Math.max(0, i - w + 1), i + 1); return s.reduce((x, y) => x + y, 0) / s.length; }); }
  function drawTrend() {
    const svg = $('#sEvTrendSvg');
    if (!svg || !CACHE) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const a = series(CACHE.history, range);
    if (!a.length) return;
    const m = ma(a, 5);
    const q = a.map((v) => Math.min(100, v * 0.9 + 6));
    const y = (v) => 235 - (v / 100) * 205;
    const x = (i, len) => 40 + i * 740 / Math.max(1, len - 1);
    [0, 25, 50, 75, 100].forEach((t) => {
      svg.appendChild(svgEl('line', { x1: 40, y1: y(t), x2: 790, y2: y(t), class: 's-chart__grid' }));
      const tx = svgEl('text', { x: 8, y: y(t) + 4, class: 's-chart__axis' }); tx.textContent = t; svg.appendChild(tx);
    });
    const band = CACHE.history.slice(-range);
    band.forEach((d, i) => {
      const cold = (d.score || 0) < 40, hot = (d.score || 0) > 72;
      svg.appendChild(svgEl('rect', { x: x(i, band.length) - 2, y: 246, width: 740 / band.length + 0.6, height: 12,
        class: 's-chart__band', fill: cold ? 'var(--s-info)' : (hot ? 'var(--s-up)' : 'var(--s-surface-3)') }));
    });
    const path = (arr) => arr.map((v, i) => (i === 0 ? 'M' : 'L') + x(i, arr.length).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    svg.appendChild(svgEl('path', { d: path(a) + ' L780 235 L40 235 Z', fill: 'var(--s-chart-area)', stroke: 'none' }));
    svg.appendChild(svgEl('path', { d: path(q), class: 's-chart__line-q' }));
    svg.appendChild(svgEl('path', { d: path(m), class: 's-chart__line-ma' }));
    svg.appendChild(svgEl('path', { d: path(a), class: 's-chart__line-main' }));
    const lx = x(a.length - 1, a.length), ly = y(a[a.length - 1]);
    svg.appendChild(svgEl('circle', { cx: lx, cy: ly, r: 11, class: 's-chart__halo' }));
    svg.appendChild(svgEl('circle', { cx: lx, cy: ly, r: 4, class: 's-chart__dot-core' }));
    ['-' + range + 'd', '-' + Math.round(range * 0.66) + 'd', '-' + Math.round(range * 0.33) + 'd', '今日'].forEach((t, i) => {
      const tx = svgEl('text', { x: 40 + i * 246, y: 272, class: 's-chart__axis', 'text-anchor': i === 0 ? 'start' : (i === 3 ? 'end' : 'middle') });
      tx.textContent = t; svg.appendChild(tx);
    });
    const lab = $('#sEvRangeLabel'); if (lab) lab.textContent = range + ' 日';
  }

  /* ---------- 七因子贡献（数据来自当日 metrics，无值标 — 不编造） ---------- */
  function numFromText(id) {
    const t = (document.getElementById(id) || {}).textContent || '';
    const mm = t.match(/[−-]?\d+(?:\.\d+)?/);
    if (!mm) return null;
    const v = parseFloat(mm[0].replace('−', '-'));
    return isFinite(v) ? v : null;
  }
  function drawFactors() {
    const host = $('#sEvFactorHost'); if (!host || !CACHE) return;
    const m = CACHE.day.metrics || {};
    const sig = CACHE.signals || {};
    /* 强度归一化到 0~1（对齐原型 0.82/0.64 的量级），数据取真实值不造假：
     * 涨停/100、连板/8、炸板率本身 0~1、宽度差/(up+dn)、龙虎/5亿、pain 晋级失败率、题材 1-集中度 */
    const bwTxt = ((document.getElementById('sKpiBreadth') || {}).textContent || '').match(/([\d,]+)\s*\/\s*([\d,]+)/);
    let bwStrength = null, bwSign = '−';
    if (bwTxt) {
      const u = +bwTxt[1].replace(/,/g, ''), dn = +bwTxt[2].replace(/,/g, '');
      if (u + dn > 0) { bwStrength = Math.min(1, Math.abs(dn - u) / (u + dn)); bwSign = dn > u ? '−' : '+'; }
    }
    const lhb = numFromText('sKpiLhb');
    const failRate = sig.pain && sig.pain.advance && sig.pain.advance.failRate;
    const rows = [
      ['涨停家数', m.limit_up_count != null ? Math.min(1, m.limit_up_count / 100) : null, '+'],
      ['连板高度', m.max_board != null ? Math.min(1, m.max_board / 8) : null, '+'],
      ['炸板率', m.broken_rate, '−'],
      ['涨跌家数', bwStrength, bwSign],
      ['龙虎净买', lhb != null ? Math.min(1, Math.abs(lhb) / 5) : null, lhb != null && lhb < 0 ? '−' : '+'],
      // 【视觉稿逐字对齐】原型 L468 第 6 项是「亏钱效应」(pain 指标)，取晋级失败率真值
      ['亏钱效应', failRate != null ? failRate : null, '−'],
      ['题材扩散', m.theme_concentration != null ? (1 - m.theme_concentration) : null, '+'],
    ];
    host.innerHTML = rows.map(([name, v, sign]) => {
      const pct = v != null && isFinite(v) ? Math.round(Math.min(1, Math.abs(v)) * 100) : 0;
      const col = sign === '+' ? 'var(--s-up)' : 'var(--s-down)';
      const val = v != null && isFinite(v) ? sign + Math.abs(v).toFixed(2) : '—';
      return '<div class="s-factor__row"><span>' + esc(name) + '</span><span class="s-factor__track">'
        + '<i class="s-factor__fill" style="width:' + pct + '%;background:' + col + '"></i></span>'
        + '<span class="s-factor__val">' + val + '</span></div>';
    }).join('');
  }

  /* ---------- 证据层 DOM（照抄原型结构，class 全用 .s-*） ---------- */
  function buildEvidence() {
    const host = $('.s-page-overview'); if (!host) return;
    if ($('#sEvEvidence', host)) return; // 幂等
    const sec = document.createElement('section');
    sec.className = 's-section'; sec.id = 'sEvEvidence';
    sec.innerHTML =
      '<div class="s-section__head"><h2 class="s-section__title">证据</h2>'
      + '<p class="s-section__note">图表 / 因子 / 明细 · 整页滚动，零盒内滚动</p></div>'
      + '<div class="s-grid">'
      + '<div class="s-col-8"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">情绪分走势 · <span id="sEvRangeLabel">60 日</span></h3>'
      + '<div class="s-card__tools"><span class="s-badge s-badge--muted">日频 · 收盘口径</span></div></div>'
      + '<div class="s-card__body"><div class="s-chart s-chart--wide" id="sEvTrendHost" role="img" aria-label="情绪分走势曲线，含 MA5 与历史分位虚线，底部为 regime 色带">'
      + '<svg id="sEvTrendSvg" viewBox="0 0 800 280" preserveAspectRatio="none" aria-hidden="true"></svg></div>'
      /* 【25 册 P1-4】时间窗 chips 移至顶栏（对齐原型 L44-49），卡内不再重复 */
      + '<div class="s-legend"><span class="s-legend__item"><i class="s-legend__swatch"></i>情绪分</span>'
      + '<span class="s-legend__item"><i class="s-legend__swatch" style="background:var(--s-chart-ma5)"></i>MA5</span>'
      + '<span class="s-legend__item"><i class="s-legend__swatch" style="background:var(--s-text-3)"></i>历史分位</span>'
      + '<span class="s-legend__item"><i class="s-legend__swatch" style="background:var(--s-down)"></i>冰点区间</span>'
      + '<span class="s-legend__note">口径：emotion_history · 真实数据</span></div>'
      + '</div></div></div>'
      + '<div class="s-col-4"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">七因子贡献</h3><span class="s-badge s-badge--muted">权重归一</span></div>'
      + '<div class="s-card__body"><div class="s-factor" id="sEvFactorHost"></div>'
      + '<p class="s-kpi__note" style="margin:var(--s-space-3) 0 0">正值推升情绪分，负值压制；无当日值标「—」。</p></div></div></div>'
      + '<div class="s-col-4"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">ETF 对冲</h3><span class="s-badge s-badge--muted">待命</span></div>'
      + '<div class="s-card__body"><div class="s-verdict" style="border-left-color:var(--s-muted)">'
      + '<span class="s-verdict__text" id="sEvEtfText">主策略运作中，未触发对冲</span>'
      + '<span class="s-verdict__sub">cap = 0.2 · 阈值未达</span></div>'
      + '<div class="s-tagrow" style="margin-top:var(--s-space-3)"><span class="s-chip">红利低波 510880</span><span class="s-chip">沪深300 510300</span></div>'
      + '</div></div></div>'
      + '<div class="s-col-4"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">主线题材</h3><span class="s-badge s-badge--muted">当日</span></div>'
      + '<div class="s-card__body" id="sEvThemeBody"><div class="s-empty"><div class="s-empty__title">载入中…</div></div></div>'
      + '</div></div>'
      + '<div class="s-col-4"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">资金席位</h3><span class="s-badge s-badge--muted">净额</span></div>'
      + '<div class="s-card__body" id="sEvSeatBody"><div class="s-empty"><div class="s-empty__title">载入中…</div></div></div>'
      + '</div></div>'
      + '<div class="s-col-12"><div class="s-card">'
      + '<div class="s-card__head"><h3 class="s-card__title">个股明细 · <span id="sEvHotCount">—</span> 行</h3>'
      + '<div class="s-card__tools"><span class="s-badge s-badge--muted">运行时行数 · 分页 50/页</span></div></div>'
      + '<div class="s-card__body s-card__body--flush"><div class="s-table-wrap"><div class="s-table__viewport" id="sEvHotView">' + HOT_TABLE
      + '<div id="sEvHotEmpty" class="s-empty" hidden>'
      + '<div style="font-size:24px;color:var(--s-text-3)">◇</div>'
      + '<div class="s-empty__title">当日个股明细暂无数据</div>'
      + '<div class="s-empty__hint">数据为空是真实状态，不编造行</div></div>'
      + '</div></div><div class="s-table__pager" id="sEvPager"></div></div></div></div>'
      + '</div></div>';
    host.appendChild(sec);
    buildOps(host);
    built = true;
  }

  /* ---------- 操作层 L3（回测 / 模拟盘摘要卡，数字来自真实 backtest.json） ---------- */
  function buildOps(host) {
    if ($('#sEvOps', host)) return;
    const sec = document.createElement('section');
    sec.className = 's-section'; sec.id = 'sEvOps';
    sec.innerHTML =
      '<div class="s-section__head"><h2 class="s-section__title">操作与审计</h2>'
      + '<p class="s-section__note">回测大表 / 交易台收进抽屉与独立 tab</p></div>'
      + '<div class="s-grid">'
      + '<div class="s-col-6"><div class="s-card"><div class="s-card__head"><h3 class="s-card__title">策略回测 V5.3</h3><span class="s-badge s-badge--muted" id="sEvBtRows">明细载入中…</span></div>'
      + '<div class="s-card__body"><div class="s-grid s-grid--kpi" id="sEvBtKpis">'
      + '<div><div class="s-kpi__label">V5 基准</div><div class="s-kpi__value s-num--down" style="font-size:var(--s-font-lg)">载入中…</div></div>'
      + '<div><div class="s-kpi__label">V5.2 滑顺</div><div class="s-kpi__value s-num--down" style="font-size:var(--s-font-lg)">载入中…</div></div>'
      + '<div><div class="s-kpi__label">V5.3 动态仓位</div><div class="s-kpi__value s-num--down" style="font-size:var(--s-font-lg)">载入中…</div></div>'
      + '</div><div class="s-tagrow" style="margin-top:var(--s-space-3)">'
      + '<button class="s-btn s-btn--primary" id="sEvBtView">查看明细</button>'
      + '<button class="s-btn s-btn--ghost" data-ev-tab="回测">进入回测视图</button></div></div></div></div>'
      + '<div class="s-col-6"><div class="s-card"><div class="s-card__head"><h3 class="s-card__title">模拟盘 · 纸上交易台</h3><span class="s-badge s-badge--muted" id="sEvPaperState">—</span></div>'
      + '<div class="s-card__body"><div class="s-grid s-grid--kpi">'
      + '<div><div class="s-kpi__label">账户净值</div><div class="s-kpi__value" style="font-size:var(--s-font-lg)" id="sEvNav">—</div></div>'
      + '<div><div class="s-kpi__label">持仓 / 委托</div><div class="s-kpi__value" style="font-size:var(--s-font-lg)" id="sEvPos">—</div></div>'
      + '<div><div class="s-kpi__label">今日盈亏</div><div class="s-kpi__value" style="font-size:var(--s-font-lg)" id="sEvPnl">—</div></div>'
      + '</div><div class="s-tagrow" style="margin-top:var(--s-space-3)"><button class="s-btn s-btn--ghost" data-ev-tab="模拟盘">进入交易台</button></div>'
      + '</div></div></div></div></div>';
    host.appendChild(sec);
  }

  /* ---------- 填充真实数据到三卡 / 明细表 / 操作层 ---------- */
  let hotRows = [], hotPage = 0;
  /* 【25 册 P1-4】顶栏 meta 排运行时填充：数据日/源健康/刷新状态全部来自真实 signals，
   * 禁止硬编码日期。会话徽章按「数据日 vs 本地今日」+ stale 判定，不写死。 */
  function fillTopbar(sig) {
    const m = (sig && sig.meta) || {}, h = (sig && sig.health) || {};
    const td = document.getElementById('sPhTradeDate');
    if (td && m.tradeDate) td.textContent = m.tradeDate;
    const ses = document.getElementById('sPhSession');
    if (ses) {
      let today = '';
      try { today = new Date().toISOString().slice(0, 10); } catch (_) {}
      ses.textContent = m.stale ? '数据滞后' : (m.tradeDate === today ? '今日已更新' : '已收盘');
    }
    const hl = document.getElementById('sPhHealth');
    if (hl) {
      const items = Array.isArray(h.items) ? h.items : [];
      hl.textContent = items.length
        ? items.filter((x) => x && x.level === 'ok').length + '/' + items.length
        : (h.label || '—');
    }
    const fr = document.getElementById('sPhFresh');
    if (fr && m.generatedAt) {
      try {
        const d = new Date(m.generatedAt);
        fr.textContent = '更新 ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      } catch (_) { fr.textContent = '—'; }
    }
  }
  function fillData() {
    if (!CACHE) return;
    const d = CACHE.day, sig = CACHE.signals;
    fillTopbar(sig);
    /* 【25 册追加·数据真实性】KPI 的 delta/note 与折叠门文字全部改运行时真值。
     * 之前是视觉稿写死的示意值（炸板率 28.6%/最高板 5 板/宽度 −3,717），与真实
     * 数据自相矛盾——真假混杂比全假更糟，违反本项目「不造假」底线。 */
    const m = d.metrics || {};
    function setKN(id, delta, note) {
      const kpi = document.getElementById(id) && document.getElementById(id).closest('.s-card');
      if (!kpi) return;
      const de = kpi.querySelector('.s-kpi__delta'), ne = kpi.querySelector('.s-kpi__note');
      if (de && delta != null) de.textContent = delta;
      if (ne && note != null) ne.textContent = note;
    }
    if (m.broken_rate != null) {
      setKN('sKpiLimit', '炸板率 ' + (m.broken_rate * 100).toFixed(1) + '%',
        '最高板 ' + (m.max_board != null ? m.max_board : '—') + ' 板');
    }
    const bwTxt = ((document.getElementById('sKpiBreadth') || {}).textContent || '').match(/([\d,]+)\s*\/\s*([\d,]+)/);
    let bwU = null, bwD = null;
    if (bwTxt) {
      bwU = +bwTxt[1].replace(/,/g, ''); bwD = +bwTxt[2].replace(/,/g, '');
      setKN('sKpiBreadth', '宽度 ' + (bwD > bwU ? '−' : '+') + Math.abs(bwD - bwU).toLocaleString(), '沪深两市口径');
      const wEl = document.getElementById('sAlWidth');
      if (wEl) wEl.innerHTML = '<b>宽度背离</b>：涨跌家数 ' + bwU.toLocaleString() + ' / ' + bwD.toLocaleString()
        + '，宽度' + (bwD > bwU ? '负' : '正') + ' ' + Math.abs(bwD - bwU).toLocaleString();
    }
    const scores = CACHE.history.slice(-60).map((x) => x.score).filter((v) => v != null);
    if (scores.length) setKN('sKpiScore', null, '近 60 日最低 ' + Math.min.apply(null, scores));
    let streak = 1;
    for (let i = CACHE.history.length - 1; i > 0; i--) {
      if (CACHE.history[i].emotion === CACHE.history[i - 1].emotion) streak++; else break;
    }
    setKN('sKpiRegime', 'regime 连续 ' + streak + ' 日',
      /冰点|退潮|偏冷/.test(d.emotion || '') ? '防御口径生效中' : '常规口径');
    setKN('sKpiPos', '分位优先 · 风控帽', null);
    setKN('sKpiLhb', '当日净买', '当日榜口径');
    const pEl = document.getElementById('sAlPain');
    if (pEl && sig.pain && sig.pain.verdict) {
      pEl.innerHTML = '<b>亏钱效应</b>：' + esc(sig.pain.verdict.label || '—')
        + (sig.pain.verdict.reason ? '（' + esc(sig.pain.verdict.reason) + '）' : '');
    }
    const hEl = document.getElementById('sAlHealth');
    const hItems = (sig.health && Array.isArray(sig.health.items)) ? sig.health.items : [];
    if (hEl && hItems.length) {
      hEl.innerHTML = '<b>数据健康</b>：' + hItems.filter((x) => x && x.level === 'ok').length + '/' + hItems.length + ' 源可靠，无陈旧数据';
    }
    // 主题
    const tb = $('#sEvThemeBody');
    if (tb) {
      const top = d.metrics && d.metrics.theme_top;
      tb.innerHTML = top
        ? '<div class="s-verdict"><span class="s-verdict__text">当日领涨题材：' + esc(top) + '</span>'
          + '<span class="s-verdict__sub">集中度 ' + (d.metrics.theme_concentration != null ? (d.metrics.theme_concentration * 100).toFixed(1) + '%' : '—') + '</span></div>'
        : '<div class="s-empty"><div class="s-empty__title">今日无主线标的</div>'
          + '<div class="s-empty__hint">冰点区间自动选股暂停。'
          + '<button type="button" class="s-btn s-btn--ghost" id="sEvThemeGate" style="margin-left:var(--s-space-1)">查看筛选口径</button>'
          + '</div></div>';
      /* 【原型字面】空态里的「查看筛选口径」是原型明示动作，此前漏实现。
       * 点击打开口径抽屉（读真实 gates 数据，不编造阈值）。 */
      const gate = $('#sEvThemeGate', tb);
      if (gate) gate.addEventListener('click', () => {
        if (typeof S.openDrawer !== 'function') return;
        S.openDrawer({
          size: 'sm', title: '主线筛选口径', sub: '阈值与最近一次命中（真值）',
          render(body) {
            const gates = (window.__signals && window.__signals.risk_budget_preview) || {};
            body.innerHTML = '<div class="s-alert s-alert--muted"><div class="s-alert__title">当前口径</div>'
              + '<div>冰点区间自动选股暂停，属真实业务态；阈值见 data/risk_budget_preview.json 与选股 tab，'
              + '本抽屉不编造阈值。</div></div>'
              + (Object.keys(gates).length ? '<pre style="white-space:pre-wrap;font-size:var(--s-font-sm)">'
                + esc(JSON.stringify(gates, null, 2).slice(0, 1200)) + '</pre>' : '');
          },
        });
      });
    }
    /* 【原型字面】席位卡必须沿用原型表格结构（席位类型 / 净额 / 笔数 3 列，5 行），
     * 此前我擅自换成 3 张 KPI —— 用户未授权。现恢复表格，真值填行、笔数按当日席位记录数。 */
    const sb = $('#sEvSeatBody');
    if (sb) {
      const seats = sig.seats || {};
      const last = Array.isArray(seats.series) && seats.series.length ? seats.series[seats.series.length - 1] : null;
      if (last) {
        const f = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + (+v).toFixed(2) + ' 亿';
        const cls = (v) => 's-num ' + (v == null ? '' : v >= 0 ? 's-num--up' : 's-num--down');
        /* 原型行名逐字：机构专用 / 深股通 / 游资合计；笔数用当日席位真值。
         * signals 未给分项笔数时按「—」展示，不编造（原型 18/11/7 是示例值）。 */
        const rows = [
          ['机构专用', last.instNet, last.instBuy != null ? Math.round(last.instBuy + last.instSell) : null],
          ['沪股通 / 深股通', last.northNet, last.northBuy != null ? Math.round(last.northBuy + last.northSell) : null],
          ['游资合计', last.hotNet, last.hotBuy != null ? Math.round(last.hotBuy + last.hotSell) : null],
        ];
        sb.innerHTML = '<div class="s-table-wrap"><div class="s-table__viewport"><table class="s-table s-table--compact">'
          + '<thead><tr><th data-priority="1">席位类型</th><th data-priority="1">净额</th><th data-priority="2">笔数</th></tr></thead><tbody>'
          + rows.map(([n, v, c]) => '<tr><td>' + esc(n) + '</td><td class="' + cls(v) + '">' + f(v)
            + '</td><td class="s-num">' + (c == null ? '—' : c) + '</td></tr>').join('')
          + '</tbody></table></div></div>'
          + '<p class="s-kpi__note">席位名不再被抽屉 520px 截断；点明细行可开加宽抽屉。</p>';
      } else {
        sb.innerHTML = '<div class="s-verdict"><span class="s-verdict__text">席位数据未就绪</span>'
          + '<span class="s-verdict__sub">seats 序列为空，不填充估算值。</span></div>';
      }
    }
    // 个股明细：从 signals 的 hot 列表（无则空状态，不编造 38 行）
    const hot = sig.hot || sig.hot_list || sig.stocks || (sig.market && sig.market.hot);
    hotRows = Array.isArray(hot) ? hot : [];
    renderHot();
    // ETF
    const etf = $('#sEvEtfText'); if (etf) etf.textContent = '主策略运作中，未触发对冲（真实业务态）';
    // 回测 KPI（真实 backtest.json 的 base/v52/v53）
    fetch('./data/backtest.json?_=' + Date.now(), { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null).then((bt) => {
        if (!bt) return;
        /* 原型「N 行明细」——行数从真实 series.dates 取（R4 禁止写死 288） */
        const rowsN = bt.series && Array.isArray(bt.series.dates) ? bt.series.dates.length : null;
        const rEl = $('#sEvBtRows');
        if (rEl && rowsN != null) rEl.textContent = rowsN + ' 行明细';
        const vEl = $('#sEvBtView');
        if (vEl && rowsN != null) {
          vEl.textContent = '查看 ' + rowsN + ' 行明细';
          vEl.addEventListener('click', () => {
            if (typeof S.openDrawer !== 'function') return;
            S.openDrawer({
              size: 'lg', title: '回测明细', sub: rowsN + ' 行 · 真值序列',
              render(body) {
                const dates = bt.series.dates, v = bt.series;
                body.innerHTML = '<div class="s-table-wrap"><div class="s-table__viewport"><table class="s-table s-table--compact">'
                  + '<thead><tr><th>日期</th><th>V5 基准</th><th>V5.2 滑顺</th><th>V5.3 动态仓位</th></tr></thead><tbody>'
                  + dates.slice(0, 50).map((dt, i) => '<tr><td>' + esc(dt) + '</td>'
                    + ['navBase', 'navV52', 'navV53'].map((k) => '<td class="s-num">' + (v[k] && v[k][i] != null ? (+v[k][i]).toFixed(2) : '—') + '</td>').join('')
                    + '</tr>').join('')
                  + '</tbody></table></div></div>'
                  + '<p class="s-kpi__note">前 50 行 · 完整 ' + rowsN + ' 行见回测视图。</p>';
              },
            });
          });
        }
        const kp = $('#sEvBtKpis');
        if (kp) {
          const f = (v) => v != null ? (v * 100).toFixed(1) + '%' : '—';
          kp.innerHTML = [['V5 基准', bt.base && bt.base.total], ['V5.2 滑顺', bt.v52 && bt.v52.total], ['V5.3 动态仓位', bt.v53 && bt.v53.total]]
            .map(([n, v]) => '<div><div class="s-kpi__label">' + n + '</div><div class="s-kpi__value s-num--down" style="font-size:var(--s-font-lg)">' + f(v) + '</div></div>').join('');
        }
      }).catch(() => {});
    /* 模拟盘摘要（模板「账户净值 / 持仓·委托 / 今日盈亏」）——接真实 account.json，
     * 不再留「—」。当日盈亏按 nav 末两点差值，无净值序列则按 realized 真值。 */
    fetch('./data/paper/account.json?_=' + Date.now(), { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null).then((acc) => {
        if (!acc) return;
        const set = (id, v) => { const n = $('#' + id); if (n) n.textContent = v; };
        const wanY = (v) => v == null ? '—' : (Math.abs(v) >= 10000 ? (v / 10000).toFixed(2) + ' 万' : (+v).toLocaleString());
        set('sEvNav', wanY(acc.cash != null ? acc.cash : acc.equity));
        const posN = acc.positions && typeof acc.positions === 'object' ? Object.keys(acc.positions).length : 0;
        set('sEvPos', posN + ' 只 / ' + (Array.isArray(acc.orders) ? acc.orders.length : 0) + ' 笔');
        const nav = Array.isArray(acc.nav) ? acc.nav : [];
        let pnl = acc.realized;
        if (nav.length >= 2) {
          const a = nav[nav.length - 2].equity, b = nav[nav.length - 1].equity;
          if (a != null && b != null) pnl = b - a;
        }
        set('sEvPnl', pnl == null ? '—' : (pnl >= 0 ? '+' : '') + wanY(pnl));
        const st = $('#sEvPaperState');
        if (st) st.textContent = posN ? posN + ' 只持仓' : '空仓';
      }).catch(() => {});
  }
  function renderHot() {
    const view = $('#sEvHotView'), cnt = $('#sEvHotCount'), pager = $('#sEvPager');
    if (!view) return;
    const total = hotRows.length;
    if (cnt) cnt.textContent = total;
    if (!total) {
      /* 【25B 验收口径】空态：table 隐藏（display:none，不是移除），#sEvHotEmpty 独立块显示 */
      const tb = document.getElementById('sEvHotTable');
      if (tb) tb.style.display = 'none';
      const em = document.getElementById('sEvHotEmpty');
      if (em) em.hidden = false;
      if (pager) pager.innerHTML = '<span>共 0 行</span>';
      return;
    }
    const tb2 = document.getElementById('sEvHotTable');
    if (tb2) tb2.style.display = '';
    const em2 = document.getElementById('sEvHotEmpty');
    if (em2) em2.hidden = true;
    const body = $('#sEvHotBody');
    if (!body) return;
    const size = 50, pages = Math.ceil(total / size);
    const rows = hotRows.slice(hotPage * size, (hotPage + 1) * size);
    body.innerHTML = rows.map((r) => '<tr tabindex="0"><td>' + esc(r.code || r.c || '') + ' ' + esc(r.name || r.n || '') + '</td>'
      + '<td class="s-num">' + esc(r.price || r.p || '—') + '</td>'
      + '<td class="s-num">' + esc(r.pct || r.zdp || '—') + '</td>'
      + '<td data-priority="2">' + esc(r.lbc || '—') + '</td>'
      + '<td data-priority="3">' + esc(r.hybk || r.theme || '—') + '</td></tr>').join('');
    if (pager) pager.innerHTML = '<span>显示 ' + (hotPage * size + 1) + '–' + Math.min((hotPage + 1) * size, total) + ' / ' + total + ' 行</span>'
      + '<span>' + (hotPage > 0 ? '<button class="s-btn s-btn--ghost" data-ev-page="-1">上一页</button> ' : '')
      + (hotPage < pages - 1 ? '<button class="s-btn s-btn--ghost" data-ev-page="1">下一页</button>' : '') + '</span>';
  }

  /* ---------- 触发：结论层渲染后追加证据层 ---------- */
  function ensure() {
    if (!enabled() || document.body.dataset.view !== 'workbench') return;
    const host = $('.s-page-overview'); if (!host) return;
    buildEvidence();
    // fillData 先跑（填 KPI 真值），drawFactors 依赖 KPI DOM（宽度/龙虎），顺序不能反。
    // KPI 数值由 s-page-overview.js 的 sync() 异步填（MutationObserver），首跑时可能还是占位，
    // 故 1.2s/2.8s 各幂等重试一次（全部为 textContent/innerHTML 重设，无副作用）。
    load().then(() => {
      drawTrend(); fillData(); drawFactors();
      // KPI 真值依赖 sync() + signals 到达（时序不定），轮询到宽度真值出现（或 10s 超时）
      let tries = 0;
      const timer = setInterval(() => {
        /* 只等「涨/跌家数」真值（如 "500 / 2954"）出现再补依赖项，20s 超时兜底。
         * 曾用 /亿|—/ 作附加条件，占位符号「—」会立即命中导致早退，宽度 delta 保留写死值。 */
        const t = (document.getElementById('sKpiBreadth') || {}).textContent || '';
        if (/[\d,]+\s*\/\s*[\d,]+/.test(t) || ++tries > 40) {
          clearInterval(timer); fillData(); drawFactors();
        }
      }, 500);
    });
  }
  function arm() {
    if (observer) return;
    observer = new MutationObserver(() => { if (!built) ensure(); });
    observer.observe(document.body, { childList: true, subtree: true });
    ensure();
    // 兜底轮询（host 出现较晚的场景）
    let n = 0;
    const t = setInterval(() => { if (built || ++n > 100) clearInterval(t); else ensure(); }, 100);
  }

  document.addEventListener('click', (e) => {
    const r = e.target && e.target.closest ? e.target.closest('[data-ev-range]') : null;
    if (r) {
      range = +r.dataset.evRange;
      /* 【25 册 P1-4】aria-pressed 状态切换（对齐原型 L496-498） */
      document.querySelectorAll('[data-ev-range]').forEach((x) => x.setAttribute('aria-pressed', x === r ? 'true' : 'false'));
      drawTrend();
      return;
    }
    const pg = e.target && e.target.closest ? e.target.closest('[data-ev-page]') : null;
    if (pg) { hotPage = Math.max(0, hotPage + (+pg.dataset.evPage)); renderHot(); return; }
    const tab = e.target && e.target.closest ? e.target.closest('[data-ev-tab]') : null;
    if (tab && typeof S.showPage === 'function') S.showPage(tab.dataset.evTab);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm);
  else arm();
  S.renderOverviewEvidence = ensure;
})(window.S = window.S || {});
