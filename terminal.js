/* ══════════════════════════════════════════════════════════════════════════
   terminal.js — 量化研究工作台（终端型 · 磨砂黑）
   ──────────────────────────────────────────────────────────────────────────
   定位：根 index.html（PRO 页，nginx + Cloudflare Tunnel 伺服）的「终端」视图，
        以**全屏覆盖层**挂载，与既有研报视图（app.js / #briefBody / 审计闸门）零耦合：
          · 不读取、不修改 app.js 任何全局；
          · 不改 #briefBody 及其子孙任何一个节点；
          · 自身任何异常都被 try/catch 吞掉并降级，绝不影响研报视图渲染。

   数据来源（全部只读，零新增计算、零阈值重写）：
          data/signals-latest.json —— 引擎已算好的全部结论：
              latest.factors（七因子）/ regime.seriesCompact（90 日 [日期,分,分位,regime]）
              regime.counts（状态分布）/ dailyReport.positionReconcile（仓位结论+风控帽）
              industry_relative（板块攻防）/ main_theme（主线）/ AI 三侧车
          data/archive-recent.json —— 近 30 日涨跌停（后台拉，不阻塞首屏）
          data/paper/account.json  —— 模拟盘净值/持仓
          ui/kline/{code}.json     —— 个股日K（按需 fetch，绝不预载 5554 个）

   设计纪律：chrome 柔、数据锐；辉光只三处；动画只 opacity/transform；
             AI 信息一律紫色（视觉上区分「AI 说的」与「引擎算的」）。
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── 0. 安全闸：任何异常都不许影响原页面 ────────────────────────────────
  const SAFE = (fn, label) => { try { return fn(); } catch (e) { console.error('[terminal]', label, e); return null; } };

  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const fmt = (v, d = 1) => (v == null || !Number.isFinite(+v)) ? '—' : (+v).toFixed(d);
  const fmtInt = (v) => (v == null || !Number.isFinite(+v)) ? '—' : Math.round(+v).toLocaleString('en-US');
  const pct = (v, d = 1) => (v == null || !Number.isFinite(+v)) ? '—' : `${(+v).toFixed(d)}%`;
  const sgn = (v, d = 1) => (v == null || !Number.isFinite(+v)) ? '—' : `${+v > 0 ? '+' : ''}${(+v).toFixed(d)}%`;
  const wan = (v) => (v == null || !Number.isFinite(+v)) ? '—' : `${(+v).toFixed(2)} 万`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── 1. LINK 总线（选中态 + 订阅）────────────────────────────────────────
  const LINK = {
    sel: { code: null, name: null, sector: null, range: 90 },
    subs: [],
    set(patch) { Object.assign(this.sel, patch); this.subs.forEach((f) => SAFE(() => f(this.sel), 'link-sub')); },
    on(fn) { this.subs.push(fn); },
  };

  // ── 2. 常量与数据加载 ──────────────────────────────────────────────────
  const jget = async (url) => { try { const r = await fetch(url, { cache: 'force-cache' }); return r.ok ? await r.json() : null; } catch { return null; } };

  // ── 涨跌停历史：emotion_history.json（83KB，250 天）按需后台拉 + 结果缓存 ──
  //   ⚠ 档案键是 **.history**（不是 .days）。首期误用 archive-recent.json 的 .days
  //     （该档根本没有 days 键，只有 signals{momentum…}）→ 总览「涨跌停分布」恒落到
  //     「无涨跌停历史」空态。此函数即为修正，并供总览/涨跌停两视图共用。
  //   字段一律取引擎已落盘的原始值，**不反推、不重算**（如炸板数不由炸板率推导）。
  let _histP = null;
  function loadHist(n = 30) {
    if (!_histP) _histP = jget('data/emotion_history.json').catch(() => null);
    return _histP.then((raw) => {
      const arr = (raw && raw.history) || [];
      return arr.slice(-n).map((x) => {
        const m = x.metrics || {};
        return {
          date: String(x.date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3').slice(5),
          zt: m.limit_up_count,        // 涨停家数
          lb: m.continuous_count,      // 连板家数
          maxb: m.max_board,           // 最高板
          broken: m.broken_rate,       // 炸板率
          hard: m.hard_board_rate,     // 硬板率（封板质量）
        };
      }).filter((r) => r.date);
    });
  }

  const FACTOR_META = [
    { k: 's_net', n: '龙虎净额', w: '20%' },
    { k: 's_brd', n: '板块涨比', w: '20%' },
    { k: 's_zdt', n: '涨跌停比', w: '15%' },
    { k: 's_amt', n: '量能', w: '15%' },
    { k: 's_pos', n: '涨跌家数', w: '10%' },
    { k: 's_hot', n: '涨停强度', w: '10%' },
    { k: 's_zbl', n: '封板质量', w: '10%' },
  ];
  // regime → 色带（低不透明度，仅作背景语义；与警报红不冲突）
  const REGIME_BAND = {
    ice: '#4d5b68', recover: '#22c88a', neutral: '#2a3644',
    climax: '#ff2b2b', ebb: '#f5a623', shift: '#a78bfa', unknown: 'transparent',
  };
  const REGIME_CLS = { ice: 'is-ice', ebb: 'is-ebb', shift: 'is-shift', unknown: 'is-ice' };

  // ── 3. SVG 图表助手（自绘，零依赖）─────────────────────────────────────

  /** 折线图 + regime 色带 + 四档参考线 + 当前值微光点 */
  function lineChart(rows, opt = {}) {
    const W = opt.w || 760, H = opt.h || 230, P = { l: 34, r: 12, t: 12, b: 26 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const n = rows.length;
    if (n < 2) return '<div class="t-empty">序列不足，无法绘图</div>';
    const X = (i) => P.l + (i / (n - 1)) * iw;
    const Y = (v) => P.t + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
    let s = `<svg class="t-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="情绪分走势">`;
    s += `<defs><linearGradient id="tGradAcc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#22d3ee" stop-opacity=".26"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>`;
    // 四档参考线（与 config 同源的展示线）
    [[24, '清仓'], [65, '满仓'], [80, '过热']].forEach(([v, lb]) => {
      s += `<line class="t-gridln" x1="${P.l}" y1="${Y(v)}" x2="${W - P.r}" y2="${Y(v)}"/>`;
      s += `<text class="t-tick" x="${P.l - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
      if (lb) s += `<text class="t-tick" x="${W - P.r}" y="${Y(v) - 3}" text-anchor="end">${lb}</text>`;
    });
    // regime 色带（每格一天的底部细带）
    if (rows.some((r) => r.reg)) {
      const bw = iw / n;
      rows.forEach((r, i) => {
        const c = REGIME_BAND[r.reg];
        if (c && c !== 'transparent') s += `<rect class="t-band" x="${(P.l + i * bw).toFixed(2)}" y="${H - P.b + 1}" width="${Math.max(1, bw).toFixed(2)}" height="4" fill="${c}"/>`;
      });
      s += `<text class="t-tick" x="${P.l}" y="${H - P.b + 15}">色带=当日 regime</text>`;
    }
    s += `<line class="t-axis" x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}"/>`;
    s += `<line class="t-axis" x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}"/>`;
    // 面积 + 折线
    let d = '', a = `M ${X(0)} ${H - P.b} `;
    rows.forEach((r, i) => { d += `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(r.v).toFixed(1)} `; a += `L ${X(i).toFixed(1)} ${Y(r.v).toFixed(1)} `; });
    a += `L ${X(n - 1)} ${H - P.b} Z`;
    s += `<path class="t-area" d="${a}"/>`;
    s += `<path class="t-line" d="${d}"/>`;
    // 分位虚线
    if (rows.some((r) => r.pct != null)) {
      let d2 = '';
      rows.forEach((r, i) => { if (r.pct != null) d2 += `${d2 ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(r.pct).toFixed(1)} `; });
      if (d2) s += `<path class="t-line-2" d="${d2}"/>`;
    }
    // 当前值微光点（辉光允许处③）
    const last = rows[n - 1];
    s += `<line class="t-nowline" x1="${X(n - 1)}" y1="${P.t}" x2="${X(n - 1)}" y2="${H - P.b}"/>`;
    s += `<circle class="t-nowdot" cx="${X(n - 1)}" cy="${Y(last.v)}" r="3.2"/>`;
    s += `<text class="t-tick-r" x="${X(n - 1) - 5}" y="${Y(last.v) - 7}" text-anchor="end">${fmt(last.v)}</text>`;
    [0, Math.floor((n - 1) / 2), n - 1].forEach((i) => {
      s += `<text class="t-tick" x="${X(i)}" y="${H - P.b + 15}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${rows[i].date}</text>`;
    });
    return s + '</svg>';
  }

  /** 分组柱状图（涨跌停） */
  function barChart(rows, opt = {}) {
    const W = opt.w || 560, H = opt.h || 180, P = { l: 30, r: 10, t: 14, b: 18 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    if (!rows.length) return '<div class="t-empty">无数据</div>';
    const max = Math.max(1, ...rows.map((r) => Math.max(r.a || 0, r.b || 0)));
    const Y = (v) => P.t + ih - (v / max) * ih;
    const slot = iw / rows.length, bw = Math.max(1.6, slot * 0.34);
    let s = `<svg class="t-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="涨跌停分布">`;
    [0, 0.5, 1].forEach((f) => {
      const v = max * f, y = Y(v);
      s += `<line class="t-gridln" x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}"/>`;
      s += `<text class="t-tick" x="${P.l - 4}" y="${y + 3}" text-anchor="end">${Math.round(v)}</text>`;
    });
    s += `<line class="t-axis" x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}"/>`;
    rows.forEach((r, i) => {
      const cx = P.l + i * slot + slot / 2;
      if (r.a != null) s += `<rect class="t-bar is-up" x="${(cx - bw - 1).toFixed(1)}" y="${Y(r.a).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - P.b - Y(r.a)).toFixed(1)}" rx="1"/>`;
      if (r.b != null) s += `<rect class="t-bar is-dn" x="${(cx + 1).toFixed(1)}" y="${Y(r.b).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - P.b - Y(r.b)).toFixed(1)}" rx="1"/>`;
    });
    [0, rows.length - 1].forEach((i) => {
      s += `<text class="t-tick" x="${P.l + i * slot + slot / 2}" y="${H - P.b + 12}" text-anchor="middle">${rows[i].date}</text>`;
    });
    // 图例可配（默认 涨停/跌停）：同一图表复用给「涨停/连板」等其它对儿时不至于说谎
    const [lgA, lgB] = opt.legend || ['涨停', '跌停'];
    if (lgA) s += `<rect class="t-bar is-up" x="${W - P.r - 92}" y="${3}" width="7" height="7" rx="1.5"/><text class="t-tick" x="${W - P.r - 82}" y="${10}">${esc(lgA)}</text>`;
    if (lgB) s += `<rect class="t-bar is-dn" x="${W - P.r - 48}" y="${3}" width="7" height="7" rx="1.5"/><text class="t-tick" x="${W - P.r - 38}" y="${10}">${esc(lgB)}</text>`;
    return s + '</svg>';
  }

  /** 圆弧仪表盘（外环=当日值） */
  function gauge(v, opt = {}) {
    const S = 84, cx = S / 2, cy = S / 2 + 4, R = 30;
    const A0 = -210, A1 = 30;
    const pol = (ang, r) => { const a = (ang * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const arc = (r, f) => { const a = A0 + (A1 - A0) * Math.max(0, Math.min(1, f)); const [x0, y0] = pol(A0, r), [x1, y1] = pol(a, r); const large = (A1 - A0) * f > 180 ? 1 : 0; return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
    const f1 = v == null ? 0 : v / 100;
    const col = v >= 80 ? '#ff2b2b' : v >= 40 ? '#22d3ee' : '#4d5b68';
    let s = `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${esc(opt.n || '')} ${fmt(v)}">`;
    s += `<path class="t-g-track" d="${arc(R, 1)}"/>`;
    s += `<path class="t-g-arc" d="${arc(R, f1)}" stroke="${col}"/>`;
    s += `<text class="t-g-num" x="${cx}" y="${cy - 1}" text-anchor="middle">${v == null ? '—' : Math.round(v)}</text>`;
    s += `<text class="t-g-lbl" x="${cx}" y="${cy + 11}" text-anchor="middle">${esc(opt.n || '')}</text>`;
    return s + '</svg>';
  }

  /** K线 + 成交量副图 */
  function candles(bars, opt = {}) {
    const W = opt.w || 620, H = opt.h || 330, PV = 64, P = { l: 8, r: 54, t: 10, b: 18 };
    if (!bars || bars.length < 2) return '<div class="t-empty">K线数据不足</div>';
    const iw = W - P.l - P.r, ih = H - PV - P.t - P.b;
    const lo = Math.min(...bars.map((b) => b[3])), hi = Math.max(...bars.map((b) => b[2]));
    const span = (hi - lo) || 1;
    const Y = (p) => P.t + ih - ((p - lo) / span) * ih;
    const n = bars.length, cw = iw / n, bw = Math.max(1.2, cw * 0.62);
    const vmax = Math.max(1, ...bars.map((b) => b[5]));
    const YV = (v) => H - P.b - (v / vmax) * (PV - 8);
    let s = `<svg class="t-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="日K线">`;
    [0, .5, 1].forEach((f) => {
      const p = lo + span * f, y = Y(p);
      s += `<line class="t-gridln" x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}"/>`;
      s += `<text class="t-tick" x="${W - P.r + 5}" y="${y + 3}">${p.toFixed(2)}</text>`;
    });
    bars.forEach((b, i) => {
      const [, o, c, h, l, v] = b;
      const up = c >= o, cls = up ? 't-cdl-up' : 't-cdl-dn';
      const x = P.l + i * cw + cw / 2;
      const top = Y(Math.max(o, c)), bot = Y(Math.min(o, c));
      s += `<line class="${cls}" x1="${x.toFixed(1)}" y1="${Y(h).toFixed(1)}" x2="${x.toFixed(1)}" y2="${Y(l).toFixed(1)}" stroke-width="1"/>`;
      s += `<rect class="${cls}" x="${(x - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bot - top).toFixed(1)}"/>`;
      s += `<rect class="${up ? 't-vol-up' : 't-vol-dn'}" x="${(x - bw / 2).toFixed(1)}" y="${YV(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - P.b - YV(v)).toFixed(1)}"/>`;
    });
    s += `<line class="t-axis" x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}"/>`;
    s += `<line class="t-axis" x1="${P.l}" y1="${H - PV + 6}" x2="${W - P.r}" y2="${H - PV + 6}" opacity=".45"/>`;
    [0, n - 1].forEach((i) => { s += `<text class="t-tick" x="${P.l + i * cw + cw / 2}" y="${H - P.b + 12}" text-anchor="${i ? 'end' : 'start'}">${bars[i][0]}</text>`; });
    const lastC = bars[n - 1][2], prevC = bars[n - 2][2];
    const chg = prevC ? ((lastC - prevC) / prevC) * 100 : null;
    s += `<text class="t-tick-r" x="${W - P.r + 5}" y="${P.t + 9}" fill="${chg >= 0 ? '#b0413e' : '#22c88a'}">${lastC.toFixed(2)}</text>`;
    s += `<text class="t-tick" x="${W - P.r + 5}" y="${P.t + 21}" fill="${chg >= 0 ? '#b0413e' : '#22c88a'}">${sgn(chg, 2)}</text>`;
    return s + '</svg>';
  }

  const sparkline = (vals, w = 52, h = 14) => {
    if (!vals || vals.length < 2) return '';
    const lo = Math.min(...vals), hi = Math.max(...vals), sp = (hi - lo) || 1;
    const d = vals.map((v, i) => `${i ? 'L' : 'M'} ${((i / (vals.length - 1)) * (w - 2) + 1).toFixed(1)} ${(h - 1 - ((v - lo) / sp) * (h - 2)).toFixed(1)}`).join(' ');
    const up = vals[vals.length - 1] >= vals[0];
    return `<svg class="t-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${up ? '#b0413e' : '#22c88a'}" stroke-width="1.1"/></svg>`;
  };

  // ── 4. 面板构造 ────────────────────────────────────────────────────────
  const panel = (title, key, bodyHtml, span) => el('section', `t-panel ${span || 't-c6'}`,
    `<div class="t-panel-h"><span class="t-pt">${esc(title)}</span><span class="t-pk">${esc(key || '')}</span></div>${bodyHtml}`);
  const stat = (k, v, sub, cls) => `<div class="t-stat"><div class="t-k">${esc(k)}</div><div class="t-v ${cls || ''}">${v}</div><div class="t-s">${sub || ''}</div></div>`;
  const alertBanner = (text, sub, crit) => `<div class="t-alert is-breath ${crit ? 'is-crit' : ''}"><span class="t-ico">${crit ? '⛔' : '⚠'}</span><div>${esc(text)}${sub ? `<div class="t-sub">${sub}</div>` : ''}</div></div>`;

  // ── 5. 视图：总览 ──────────────────────────────────────────────────────
  function viewOverview(S) {
    const L = S.latest || {};
    const fac = L.factors || {};
    const reg = (S.regime && S.regime.latest) || {};
    const pr = (S.dailyReport && S.dailyReport.positionReconcile) || {};
    const meta = S.meta || {};
    const g = el('div', 't-grid');

    // ── 警报三级 ──
    const alerts = [];
    if (pr.force === true) {
      alerts.push(alertBanner('强制降仓：基础建议被 regime 风控帽压下，只减仓不新建',
        `情绪分 ${fmt(pr.score)}｜基础 ${esc(pr.baseRange || '—')} → 风控帽 ${esc(pr.capRange || '—')} → 执行 <b>${esc(pr.finalRange || '—')}</b>（${esc((pr.cap && pr.cap.label) || '')}）`, true));
    } else if (reg.key === 'climax' && (L.pct_rank != null && L.pct_rank >= 90)) {
      alerts.push(alertBanner('情绪高潮且历史分位 ≥90%，追高性价比下降',
        `regime ${esc(reg.label || '—')}｜分位 ${pct(L.pct_rank, 0)}｜执行仓位 ${esc(pr.finalRange || '—')}`, true));
    }
    if (meta.stale === true) alerts.push(alertBanner(`数据滞后：${meta.staleReason || '存档交易日落后于最近已收盘交易日'}`, `当前展示 ${esc(meta.tradeDate || L.trade_date || '—')} 收盘数据`, false));
    if (alerts.length) g.appendChild(el('div', 't-c12', alerts.join('')));

    // ── AI 信息条（紫色）──
    const aiBits = [];
    const dl = S.dragonLogic;
    if (dl && Array.isArray(dl.pureSentiment) && dl.pureSentiment.length) aiBits.push(`<span class="t-ai-item">🕵 妖股纯情绪 <b>${dl.pureSentiment.length}</b> 只</span>`);
    if (S.llm && S.llm.sentimentRaw != null) aiBits.push(`<span class="t-ai-item">📰 舆情读数 <b>${fmt(S.llm.sentimentRaw, 2)}</b>${S.llm.confidence != null ? `（置信 ${fmt(S.llm.confidence * 100, 0)}%）` : ''}</span>`);
    const ss = S.sectorSentiment;
    if (ss && !ss.degraded) { const sc = ss.score != null ? ss.score : (ss.macro && ss.macro.score); if (sc != null) aiBits.push(`<span class="t-ai-item">🧭 板块情绪 <b>${fmt(sc, 2)}</b></span>`); }
    if ((S.health && S.health.level) === 'ok') aiBits.push('<span class="t-ai-item">💚 数据健康 <b>ok</b></span>');
    if (aiBits.length) g.appendChild(el('div', 't-c12', `<div class="t-ai-strip"><span class="t-ai-tag">AI Side-car</span>${aiBits.join('')}</div>`));

    // ── 核心指标 ──
    const stats = el('div', 't-stats');
    stats.innerHTML =
      stat('情绪分', fmt(L.value), `历史分位 <b>${pct(L.pct_rank, 0)}</b>`, 'is-acc') +
      stat('市场状态', `<span class="t-regime ${REGIME_CLS[reg.key] || ''}">${esc(reg.label || '—')}</span>`, `方向 ${({ up: '↑', down: '↓', flat: '→' })[reg.dir] || '—'}｜置信 ${esc(reg.confidence || '—')}`) +
      stat('执行仓位', esc(pr.finalRange || '—'), `${pr.force ? '<b style="color:var(--t-alert)">风控帽强制降仓</b>' : `基础 ${esc(pr.baseRange || '—')}`}`, pr.force ? 'is-alert' : '') +
      stat('涨停 / 跌停', `<span class="is-up">${fmtInt(L.zt_count)}</span> <span style="color:var(--t-ink-3)">/</span> <span class="is-dn">${fmtInt(L.dt_count)}</span>`, `炸板 ${fmtInt(L.zb_count)}｜封板率 ${pct(L.seal_pct, 0)}`) +
      stat('涨 / 跌家数', `<span class="is-up">${fmtInt(L.up_count)}</span> <span style="color:var(--t-ink-3)">/</span> <span class="is-dn">${fmtInt(L.down_count)}</span>`, '沪深两市口径') +
      stat('龙虎净买', wan(L.lhb_daily_net), `上榜 ${fmtInt(L.lhb_daily_stocks || L.lhb_stocks)} 只`);
    g.appendChild(panel('核心指标', L.trade_date, stats.outerHTML, 't-c12'));

    // ── 主图：情绪分折线（seriesCompact，零额外请求）──
    const series = (S.regime && S.regime.seriesCompact) || [];
    const rows = series.map((r) => ({ date: String(r[0]).slice(5), v: +r[1], pct: r[2] == null ? null : +r[2], reg: r[3] }));
    const mainBody = rows.length > 1
      ? lineChart(rows, { w: 760, h: 230 })
      : '<div class="t-empty">情绪分序列不足</div>';
    g.appendChild(panel('情绪分走势', `近 ${rows.length} 交易日 · 实线=情绪分 · 虚线=历史分位 · 底部色带=当日 regime`, mainBody, 't-c8'));

    // ── 七因子仪表盘 ──
    const gp = el('div', 't-gauges');
    FACTOR_META.forEach((m) => {
      const v = fac[m.k] == null ? null : +fac[m.k];
      const d = el('div', 't-gauge', gauge(v, { n: m.w }) + `<div class="t-g-lbl-below">${esc(m.n)}</div>`);
      d.title = `${m.n}：权重 ${m.w}｜当日 ${v == null ? '—' : fmt(v)}`;
      gp.appendChild(d);
    });
    g.appendChild(panel('七因子仪表', '权重见 tooltip', gp.outerHTML, 't-c4'));

    // ── regime 分布 ──
    const counts = (S.regime && S.regime.counts) || {};
    const ck = Object.keys(counts);
    const cmax = Math.max(1, ...ck.map((k) => counts[k]));
    const dist = ck.length
      ? `<div>${ck.map((k) => `<div class="t-dv-row" style="grid-template-columns:56px 1fr 34px">
          <span class="t-dv-name">${esc(k)}</span>
          <span class="t-dv-track"><span class="t-dv-fill ${REGIME_BAND[k] && k !== 'unknown' ? '' : ''}" style="width:${(counts[k] / cmax * 100).toFixed(1)}%;background:${REGIME_BAND[k] || '#2a3644'}"></span></span>
          <span class="t-dv-val">${counts[k]}</span></div>`).join('')}</div>`
      : '<div class="t-empty">无分布数据</div>';
    g.appendChild(panel('regime 分布', `共 ${(S.regime && S.regime.totalDays) || '—'} 日`, dist, 't-c4'));

    // ── 主线题材 ──
    const mt = L.main_theme;
    g.appendChild(panel('主线题材', '当日',
      mt ? `<div class="t-stats" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
        ${stat('主线', esc(mt.name || '—'), `占龙虎净买 <b>${pct(mt.pct, 0)}</b>`, 'is-acc')}
        ${stat('主线净买', wan(mt.main_yi != null ? mt.main_yi * 10000 : null), `全榜 ${wan(mt.tot_yi != null ? mt.tot_yi * 10000 : null)}`)}
      </div>` : '<div class="t-empty">当日无主线</div>', 't-c8'));

    // ── 涨跌停柱状（后台拉 emotion_history，不阻塞首屏）──
    //    2026-10-25 修正：原取 archive-recent.json 的 .days（该档无此键）→ 恒为空态；
    //    且原图例写死「涨停/跌停」而跌停历史并不落盘，改用「涨停/连板」如实标注。
    const barPanel = panel('涨跌停分布', '近 30 交易日 · 涨停 vs 连板', '<div class="t-loading">加载…</div>', 't-c12');
    g.appendChild(barPanel);
    loadHist(30).then((hist) => {
      const data = hist.filter((r) => r.zt != null).map((r) => ({ date: r.date, a: r.zt, b: r.lb }));
      const host = barPanel.lastElementChild;
      if (host) host.outerHTML = data.length ? barChart(data, { w: 900, h: 170, legend: ['涨停', '连板'] }) : '<div class="t-empty">无涨跌停历史</div>';
    });

    return g;
  }

  // ── 6. 视图：板块 ──────────────────────────────────────────────────────
  function viewSector(S) {
    const ir = (S.latest && S.latest.industry_relative) || {};
    const vs = ir.vsIndex || {};
    const atk = vs.attack || [], def = vs.defense || [];
    const g = el('div', 't-grid');
    const maxAbs = Math.max(1, ...atk.map((x) => Math.abs(x.excess || 0)), ...def.map((x) => Math.abs(x.excess || 0)));
    const rows = [];
    for (let i = 0; i < Math.max(atk.length, def.length); i++) {
      const a = atk[i], d = def[i];
      rows.push(`<div class="t-dv-row">
        <span class="t-dv-name" title="${esc((d && d.name) || '')}">${esc((d && d.name) || '')}</span>
        <span class="t-dv-track is-l">${d ? `<span class="t-dv-fill dn" style="width:${(Math.abs(d.excess) / maxAbs * 100).toFixed(1)}%"></span>` : ''}</span>
        <span class="t-dv-track">${a ? `<span class="t-dv-fill up" style="width:${(Math.abs(a.excess) / maxAbs * 100).toFixed(1)}%"></span>` : ''}</span>
        <span class="t-dv-val"><span class="${a ? 'up' : ''}">${a ? sgn(a.change_pct, 2) : ''}</span> <span class="${d ? 'dn' : ''}" style="opacity:.75">${d ? sgn(d.change_pct, 2) : ''}</span></span>
      </div>`);
    }
    g.appendChild(panel('板块相对强弱', `基准 ${esc(vs.baseLabel || '—')} ${sgn(vs.basePct, 2)} · 左=防御 · 右=进攻（超额）`,
      rows.length ? `<div>${rows.join('')}</div>` : '<div class="t-empty">无板块数据</div>', 't-c12'));
    return g;
  }

  // ── 6b. 视图：涨跌停 ────────────────────────────────────────────────────
  function viewZt(S) {
    const L = S.latest || {};
    const g = el('div', 't-grid');

    // 今日快照：全部取 latest 里引擎已算好的值，**不反推、不重算**
    g.appendChild(panel('今日涨跌结构', `交易日 ${esc(L.trade_date || '—')}`,
      `<div class="t-stats">
        ${stat('涨停家数', fmtInt(L.zt_count), 'zt_count', 'up')}
        ${stat('跌停家数', fmtInt(L.dt_count), 'dt_count', 'dn')}
        ${stat('炸板家数', fmtInt(L.zb_count), 'zb_count', 'dn')}
        ${stat('封板率', pct(L.seal_pct), 'seal_pct')}
        ${stat('上涨家数', fmtInt(L.up_count), 'up_count', 'up')}
        ${stat('下跌家数', fmtInt(L.down_count), 'down_count', 'dn')}
      </div>`, 't-c12'));

    // 涨停 vs 连板（30 日）
    const hPanel = panel('涨停家数 vs 连板家数', '近 30 交易日 · 引擎原值', '<div class="t-loading">加载…</div>', 't-c12');
    g.appendChild(hPanel);
    loadHist(30).then((hist) => {
      const data = hist.filter((r) => r.zt != null).map((r) => ({ date: r.date, a: r.zt, b: r.lb }));
      const host = hPanel.lastElementChild;
      if (host) host.outerHTML = data.length ? barChart(data, { w: 900, h: 200, legend: ['涨停', '连板'] }) : '<div class="t-empty">无涨跌停历史</div>';
    });

    // 最高连板高度（30 日）
    const bPanel = panel('最高连板高度', '近 30 交易日 · max_board', '<div class="t-loading">加载…</div>', 't-c12');
    g.appendChild(bPanel);
    loadHist(30).then((hist) => {
      const data = hist.filter((r) => r.maxb != null).map((r) => ({ date: r.date, a: r.maxb }));
      const host = bPanel.lastElementChild;
      if (host) host.outerHTML = data.length ? barChart(data, { w: 900, h: 170, legend: ['最高板', ''] }) : '<div class="t-empty">无历史</div>';
    });

    // 近 5 日封板质量明细表
    const tPanel = panel('近 5 日封板质量', '硬板率 / 炸板率 · 引擎原值，不反推', '<div class="t-loading">加载…</div>', 't-c12');
    g.appendChild(tPanel);
    loadHist(5).then((hist) => {
      const rows = hist.slice().reverse().map((r) => `<tr>
        <td>${esc(r.date)}</td>
        <td class="up">${fmtInt(r.zt)}</td>
        <td>${fmtInt(r.lb)}</td>
        <td>${fmtInt(r.maxb)}</td>
        <td>${pct(r.hard != null ? r.hard * 100 : null)}</td>
        <td class="dn">${pct(r.broken != null ? r.broken * 100 : null)}</td>
      </tr>`).join('');
      const host = tPanel.lastElementChild;
      if (host) {
        host.outerHTML = rows
          ? `<table class="t-tbl"><thead><tr><th>日期</th><th>涨停</th><th>连板</th><th>最高板</th><th>硬板率</th><th>炸板率</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<div class="t-empty">无历史</div>';
      }
    });
    return g;
  }

  // ── 6c. 视图：资金 ──────────────────────────────────────────────────────
  function viewFund(S) {
    const L = S.latest || {};
    const mt = L.main_theme || S.main_theme || {};
    const g = el('div', 't-grid');

    g.appendChild(panel('龙虎资金快照', `交易日 ${esc(L.trade_date || '—')}`,
      `<div class="t-stats">
        ${stat('龙虎净额', `${fmt(L.lhb_daily_net, 2)} 亿`, 'lhb_daily_net', +L.lhb_daily_net > 0 ? 'up' : 'dn')}
        ${stat('上榜个股', fmtInt(L.lhb_stocks), 'lhb_stocks')}
        ${stat('当日成交榜', fmtInt(L.lhb_daily_stocks), 'lhb_daily_stocks')}
        ${stat('两市成交额', `${fmtInt(L.amount_yi)} 亿`, 'amount_yi')}
      </div>`, 't-c12'));

    // 主线资金集中度：pct 优先取引擎已算好的值，缺失才由两个原始额现算（同一口径，非重算阈值）
    const tot = mt.tot_yi, main = mt.main_yi;
    const p = mt.pct != null ? mt.pct : ((tot != null && main != null && tot !== 0) ? (main / tot) * 100 : null);
    const w = Math.max(0, Math.min(100, p || 0));
    g.appendChild(panel('主线资金集中度', `主线「${esc(mt.name || '—')}」· 口径 ${esc(mt.caliber || 'daily')}`,
      `<div class="t-dv-row">
        <span class="t-dv-name">${esc(mt.name || '—')}</span>
        <span class="t-dv-track"><span class="t-dv-fill up" style="width:${w.toFixed(1)}%"></span></span>
        <span class="t-dv-val">${pct(p)}</span>
      </div>
      <div class="t-sub">主线净额 ${fmt(main, 2)} 亿 / 龙虎总额 ${fmt(tot, 2)} 亿${mt.pct != null ? '' : ' · 占比由原始额现算'}</div>`, 't-c12'));

    return g;
  }

  // ── 7. 视图：模拟盘 ────────────────────────────────────────────────────
  async function viewPaper() {
    const g = el('div', 't-grid');
    const navPanel = panel('模拟盘净值', 'account.nav 序列', '<div class="t-loading">加载…</div>', 't-c8');
    const posPanel = panel('持仓', '点击行看日K', '<div class="t-loading">加载…</div>', 't-c4');
    g.appendChild(navPanel); g.appendChild(posPanel);
    const a = await jget('data/paper/account.json');
    const nav = (a && a.nav) || [];
    const h1 = navPanel.lastElementChild;
    if (h1) h1.outerHTML = nav.length > 1 ? lineChart(nav.map((r) => ({ date: String(r.date).slice(5), v: r.equity })), { w: 640, h: 210 }) : '<div class="t-empty">净值序列不足</div>';
    const pos = Object.values((a && a.positions) || {}).filter((p) => p && p.qty > 0);
    const h2 = posPanel.lastElementChild;
    if (h2) {
      if (!pos.length) h2.outerHTML = '<div class="t-empty">当前空仓</div>';
      else {
        const st = a.initCash || 0;
        h2.outerHTML = `<div class="t-tbl-wrap"><table class="t-tbl"><thead><tr><th>标的</th><th>持仓</th><th>成本</th><th>浮亏</th><th>占比</th></tr></thead><tbody>${
          pos.map((p) => {
            const pnl = p.last != null && p.avgCost ? ((p.last - p.avgCost) / p.avgCost) * 100 : null;
            return `<tr data-code="${esc(p.code)}" data-name="${esc(p.name || p.code)}">
              <td>${esc(p.name || p.code)}<div class="t-code">${esc(p.code)}</div></td>
              <td>${fmtInt(p.qty)}</td><td>${fmt(p.avgCost, 2)}</td>
              <td class="${pnl == null ? 'mut' : pnl >= 0 ? 'up' : 'dn'}">${pnl == null ? '—' : sgn(pnl, 2)}</td>
              <td>${st && p.cost ? pct(p.cost / st, 1) : '—'}</td></tr>`;
          }).join('')}</tbody></table></div>`;
        $('.t-tbl', posPanel).addEventListener('click', (e) => {
          const tr = e.target.closest('tr[data-code]'); if (tr) LINK.set({ code: tr.dataset.code, name: tr.dataset.name });
        });
      }
    }
    return g;
  }

  // ── 8. K线抽屉（全站唯一真磨砂玻璃件）─────────────────────────────────
  let drawerRefs = null;
  function openDrawer(code, name) {
    if (!code) return;
    let refs = drawerRefs;
    if (!refs) {
      const mask = el('div', 't-drawer-mask');
      const dw = el('aside', 't-drawer');
      dw.innerHTML = `<div class="t-drawer-h"><span class="t-dn-name"></span><span class="t-dn-code"></span><button class="t-close" aria-label="关闭">✕</button></div><div class="t-drawer-b"></div>`;
      document.body.appendChild(mask); document.body.appendChild(dw);
      refs = { mask, dw, name: $('.t-dn-name', dw), code: $('.t-dn-code', dw), body: $('.t-drawer-b', dw) };
      const close = () => { mask.classList.remove('is-open'); dw.classList.remove('is-open'); LINK.set({ code: null }); };
      $('.t-close', dw).addEventListener('click', close);
      mask.addEventListener('click', close);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      drawerRefs = refs;
    }
    refs.name.textContent = name || code;
    refs.code.textContent = code;
    refs.body.innerHTML = '<div class="t-loading">加载日K…</div>';
    refs.mask.classList.add('is-open');
    refs.dw.classList.add('is-open');
    const cc = String(code).replace(/^(sh|sz|bj)/, '');
    const prefix = /^(6|9)/.test(cc) ? 'sh' : /^(4|8)/.test(cc) ? 'bj' : 'sz';
    jget(`ui/kline/${prefix}${cc}.json`).then((k) => {
      const bars = (k && k.bars) || [];
      refs.body.innerHTML = bars.length > 1
        ? `<div style="margin-bottom:12px;font-size:12px;color:var(--t-ink-2)">${bars.length} 根日K · 最新 ${bars[bars.length - 1][0]} · 收盘 <b style="color:var(--t-ink)">${bars[bars.length - 1][2]}</b></div>`
          + candles(bars.slice(-90), { w: 600, h: 330 })
        : '<div class="t-empty">该标的暂无 K 线分片（kline 分片仅覆盖历史上榜股）</div>';
    });
  }

  // ── 9. 挂载与视图切换 ─────────────────────────────────────────────────
  const VIEWS = [
    { k: 'overview', n: '总览' },
    { k: 'zt', n: '涨跌停' },
    { k: 'fund', n: '资金' },
    { k: 'sector', n: '板块' },
    { k: 'paper', n: '模拟盘' },
    { k: 'soon', n: '选股 · K线 · 研报', soon: true },
  ];

  function mount() {
    const root = $('#tRoot');
    if (!root) return;
    root.className = 't-scope';
    root.hidden = true;

    const top = el('header', 't-topbar');
    const nav = el('nav', 't-nav');
    const body = el('div', 't-main');
    const tick = el('footer', 't-ticker');

    // 数据：signals-latest 是同步可得的（页面已缓存）；异步入栈以保证健壮
    const S = window.__SIGNALS__ || {};
    const L = S.latest || {};
    const meta = S.meta || {};

    top.innerHTML = `<span class="t-brand">A股情绪 · 研究工作台</span>
      <span class="t-dot ${meta.stale ? 'is-off' : ''}"></span>
      <span>${meta.stale ? '数据滞后' : '已收盘'}</span><span class="t-sep">│</span>
      <span>数据 <b>${esc(meta.tradeDate || L.trade_date || '—')}</b></span><span class="t-sep">│</span>
      <span>regime 序列 <b>${((S.regime && S.regime.seriesCompact) || []).length}</b> 日</span>
      <span class="t-viewswitch">
        <button data-v="terminal" class="is-on">⚡ 终端</button>
        <button data-v="report">📄 研报</button>
      </span>`;

    let cur = 'overview';
    const render = async (k) => {
      cur = k;
      [...nav.children].forEach((b) => b.classList.toggle('is-on', b.dataset.v === k));
      body.innerHTML = '<div class="t-loading">加载…</div>';
      let node = null;
      try {
        if (k === 'overview') node = viewOverview(S);
        else if (k === 'zt') node = viewZt(S);
        else if (k === 'fund') node = viewFund(S);
        else if (k === 'sector') node = viewSector(S);
        else if (k === 'paper') node = await viewPaper();   // 异步视图必须 await，否则拿到 Promise 而非 Node
      } catch (e) { console.error('[terminal] render', k, e); node = null; }
      if (!node || !(node instanceof Node)) {
        node = el('div', 't-panel t-c12', `<div class="t-empty">「${esc(k)}」视图数据已就绪，下期接入。<br>终端外壳 / 设计令牌 / 图表助手（折线·柱状·仪表·K线）/ 联动总线均已就绪——加面板即可。</div>`);
      }
      body.innerHTML = '';
      body.appendChild(node);
      const reg = (S.regime && S.regime.latest) || {};
      tick.innerHTML = `<span class="t-tk-lbl">›</span><span class="t-tk-body">情绪分 <b>${fmt(L.value)}</b>（分位 ${pct(L.pct_rank, 0)}）· regime <b>${esc(reg.label || '—')}</b> · 涨停 <b>${fmtInt(L.zt_count)}</b> / 跌停 <b>${fmtInt(L.dt_count)}</b> · 点持仓行可下钻日K</span>`;
    };

    VIEWS.forEach((v) => {
      const b = el('button', v.soon ? 't-nav-soon' : '', esc(v.n) + (v.soon ? ' ·' : ''));
      b.dataset.v = v.k;
      b.addEventListener('click', () => render(v.k));
      nav.appendChild(b);
    });

    const switchTo = (v) => {
      const term = v === 'terminal';
      root.hidden = !term;
      document.body.style.overflow = term ? 'hidden' : '';
      if (term) render(cur);
    };
    top.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      [...$('.t-viewswitch', top).children].forEach((x) => x.classList.toggle('is-on', x === b));
      switchTo(b.dataset.v);
    });

    root.appendChild(top); root.appendChild(nav); root.appendChild(body); root.appendChild(tick);

    // 入口按钮（挂在研报页）
    const entry = el('button', '', '⚡ 终端');
    entry.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9998;font:inherit;font-size:12px;'
      + 'padding:8px 13px;border-radius:8px;cursor:pointer;color:#22d3ee;background:rgba(11,15,22,.9);'
      + 'border:1px solid rgba(34,211,238,.45);box-shadow:0 0 14px rgba(34,211,238,.22)';
    entry.addEventListener('click', () => switchTo('terminal'));
    document.body.appendChild(entry);

    LINK.on((sel) => { if (sel.code) SAFE(() => openDrawer(sel.code, sel.name), 'drawer'); });

    // 深链：?view=terminal 或 #terminal → 直接进入终端视图（可收藏直达）
    const wantTerminal = (() => {
      try {
        return location.hash === '#terminal'
          || new URLSearchParams(location.search).get('view') === 'terminal';
      } catch { return false; }
    })();
    if (wantTerminal) {
      root.hidden = false;
      document.body.style.overflow = 'hidden';
      [...$('.t-viewswitch', top).children].forEach((x) => x.classList.toggle('is-on', x.dataset.v === 'terminal'));
    }

    render('overview');
    console.log('[terminal] 研究工作台已就绪（覆盖层挂载，不影响研报视图）');
  }

  // signals-latest 载入后再挂载（读一次，缓存）；失败也挂载（空态降级）
  jget('data/signals-latest.json').then((S) => { window.__SIGNALS__ = S || {}; SAFE(mount, 'mount'); })
    .catch(() => { window.__SIGNALS__ = {}; SAFE(mount, 'mount'); });
})();
