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
              dragonLogic.dragons（40 只连板梯队：code/name/lb 连板数/hybk 行业/
                logic_type/is_pure_sentiment/confidence/reason）
          data/emotion_history.json —— 涨跌停历史（.history，250 天；后台拉 + 缓存）
              metrics.limit_up_count 涨停家数 / continuous_count 连板家数 /
              max_board 最高板 / broken_rate 炸板率 / hard_board_rate 硬板率
              ⚠ 不含跌停历史，故全站无跌停序列图（图例如实标注，不冒充）
          data/paper/account.json  —— 模拟盘净值/持仓
          ui/kline/{code}.json     —— 个股日K 649 根（按需 fetch，绝不预载 5554 个）
              [date, open, close, high, low, volume]；**仅日K**，无多周期字段。
              周/月/季/半年/年K 由日K 在展示层聚合（标准 OHLCV 口径），
              分时/30分/60分 **无分钟数据源，不做**。
          data/llm_risk_blacklist.json —— GLM 夜间排雷黑名单（个股详情抽屉 红色区）
          data/paper/account.json      —— 模拟盘持仓（个股详情抽屉 持仓区）

   下钻链路（2026-10-25 三期）：
          总览 AI 条「🕵 妖股纯情绪 N 只」可点 → 跳选股视图并停在纯情绪子集
            （is_pure_sentiment=true，只是**子集过滤**，不是重新判定）；
          点任一个股（连板天梯 / 持仓行）→ 抽屉上半「个股详情」：
            妖股逻辑推演（紫，侧车 C）/ 夜间排雷（红，侧车 A）/ 模拟盘持仓，
            下半为多周期 K 线。三块全部 fail-open：档缺失 → 如实显示「无记录」。

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
  // 时间窗（全局，作用于所有按日序列图：情绪分折线、涨停/连板柱、最高板柱等）。
  //   由顶栏按钮切换 → 走 LINK 总线 → 当前视图重绘。只影响**取多少天来画**，
  //   不重算任何指标、不改判阈值。
  const RANGES = [20, 30, 60, 90];

  const LINK = {
    sel: { code: null, name: null, sector: null, range: 60 },
    subs: [],
    set(patch) { Object.assign(this.sel, patch); this.subs.forEach((f) => SAFE(() => f(this.sel), 'link-sub')); },
    on(fn) { this.subs.push(fn); },
  };

  // ── 1b. 跨视图跳转 / 筛选态（会话级，仅影响展示，不回写引擎）──────────────
  //   goView：视图内的元素（如总览 AI 条的「妖股纯情绪 N 只」）要切到别的视图时用它。
  //     真正的 render 由 mount() 注入，视图函数因此不必持有一堆节点引用（解耦）。
  //   pickFilter：选股视图的筛选态。null=全梯队；'pure'=仅 is_pure_sentiment 子集。
  //     ⚠ 只是**同一批引擎/侧车原值的子集切换**（过滤），不做任何打分或重排序。
  let goView = () => {};
  let pickFilter = null;
  let sectorBase = 'index';   // 板块视图的对比基准：'index'=对比指数 | 'median'=对比行业中位数

  // ── 2. 常量与数据加载 ──────────────────────────────────────────────────
  const jget = async (url) => { try { const r = await fetch(url, { cache: 'force-cache' }); return r.ok ? await r.json() : null; } catch { return null; } };

  // ── 数据起源（2026-10-27 · 方案B：jsDelivr + 独立数据仓，绕开 Cloudflare）──────────
  //   背景：个股K线（ui/kline，163MB/5554 分片）与聚合侧车档（emotion_history /
  //   main_theme_history / announcements / paper-account / llm_risk_blacklist）属
  //   本地重/私数据，刻意不入主仓 git（避免撑爆仓库 + churn），故 GitHub Pages 上相对
  //   路径 404 → 终端这些图空白。这里给它们一个可配置的外部数据起源：
  //     · 仅在 github.io 域名下、且配置了起源时，才把这些 fetch 改道起源地址；
  //     · Pi 本地/隧道同源仍走相对路径（零改动、向后兼容）；
  //     · 未配置（空）= 关闭，Pages 上保持原空态，绝不报错（jget 本就 fail-open）。
  //   起源来源：优先读 config.json 顶层 dataOrigin（默认已指向 jsDelivr 数据仓
  //   sjc19950404/a-sentiment-kline@main），否则用下方 DATA_ORIGIN 常量兜底。
  //   配套：Pi 侧 EOD 后跑 scripts/push_data_repo.sh 把这些档推送到数据仓（见脚本头注释）。
  const DATA_ORIGIN = ''; // 兜底；正常用 config.json 的 dataOrigin（jsDelivr 地址）
  const durl = (p) => {
    const origin = (typeof window !== 'undefined' && window.ASENT_CONFIG && window.ASENT_CONFIG.dataOrigin) || DATA_ORIGIN;
    if (!origin || !/(^|\.)github\.io$/.test(location.hostname)) return p;
    return origin.replace(/\/+$/, '') + '/' + String(p).replace(/^\.?\//, '');
  };

  // ── 涨跌停历史：emotion_history.json（83KB，250 天）按需后台拉 + 结果缓存 ──
  //   ⚠ 档案键是 **.history**（不是 .days）。首期误用 archive-recent.json 的 .days
  //     （该档根本没有 days 键，只有 signals{momentum…}）→ 总览「涨跌停分布」恒落到
  //     「无涨跌停历史」空态。此函数即为修正，并供总览/涨跌停两视图共用。
  //   字段一律取引擎已落盘的原始值，**不反推、不重算**（如炸板数不由炸板率推导）。
  let _histP = null;
  function loadHist(n = 30) {
    if (!_histP) _histP = jget(durl('data/emotion_history.json')).catch(() => null);
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
  // regime → 顶栏徽章配色（半透明底 + 高光边框；inline style 由 render 注入）
  const REGIME_BADGE = {
    climax:  { c: '#ff5a4d', bg: 'rgba(255, 90, 77, .20)', bd: 'rgba(255, 90, 77, .65)' },
    ebb:     { c: '#f5a623', bg: 'rgba(245, 166, 35, .16)', bd: 'rgba(245, 166, 35, .55)' },
    recover: { c: '#22c88a', bg: 'rgba(34, 200, 138, .16)', bd: 'rgba(34, 200, 138, .5)' },
    neutral: { c: '#9fb2c0', bg: 'rgba(159, 178, 192, .14)', bd: 'rgba(159, 178, 192, .4)' },
    ice:     { c: '#7fb0d6', bg: 'rgba(127, 176, 214, .14)', bd: 'rgba(127, 176, 214, .45)' },
    shift:   { c: '#a78bfa', bg: 'rgba(167, 139, 250, .16)', bd: 'rgba(167, 139, 250, .5)' },
    unknown: { c: '#9fb2c0', bg: 'rgba(159, 178, 192, .12)', bd: 'rgba(159, 178, 192, .35)' },
  };

  // ── 3. SVG 图表助手（自绘，零依赖）─────────────────────────────────────

  /** 折线图 + regime 色带 + 四档参考线 + 当前值微光点 */
  function lineChart(rows, opt = {}) {
    const gid = 'tGrad' + (lineChart._g = (lineChart._g || 0) + 1);   // 每实例唯一渐变 id，避免多图同 id 冲突
    const W = opt.w || 760, H = opt.h || 230, P = { l: 34, r: 12, t: 12, b: 26 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const n = rows.length;
    if (n < 2) return '<div class="t-empty">序列不足，无法绘图</div>';
    const X = (i) => P.l + (i / (n - 1)) * iw;
    const usePct = opt.vMin == null;                      // 情绪分/分位 → 0–100（含参考线/regime 带）；其它序列传 vMin/vMax 走真实域
    const vMin = usePct ? 0 : opt.vMin, vMax = usePct ? 100 : opt.vMax;
    const Y = (v) => P.t + ih - ((v - vMin) / ((vMax - vMin) || 1)) * ih;
    let s = `<svg class="t-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(opt.n || '情绪分走势')}">`;
    s += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#22d3ee" stop-opacity=".26"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>`;
    // 四档参考线 + regime 色带：仅情绪分（usePct）模式有意义，真实域序列（净值等）跳过
    if (usePct) {
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
    }
    s += `<line class="t-axis" x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}"/>`;
    s += `<line class="t-axis" x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}"/>`;
    // 真实域序列（如净值）：补画 Y 轴刻度（量级清晰，如「100.0万」）+ X 轴日期（抽稀防重叠）
    if (!usePct) {
      const fmtTick = (v) => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + '万' : (Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2)));
      const yt = 4;
      for (let i = 0; i <= yt; i++) {
        const v = vMin + (vMax - vMin) * i / yt, y = Y(v);
        s += `<line class="t-gridln" x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}" opacity="${i === 0 || i === yt ? .9 : .35}"/>`;
        s += `<text class="t-tick" x="${P.l - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtTick(v)}</text>`;
      }
      const xStep = Math.max(1, Math.floor(n / 6));
      rows.forEach((r, i) => { if (i % xStep === 0 || i === n - 1) { const x = X(i); s += `<text class="t-tick" x="${x.toFixed(1)}" y="${H - P.b + 13}" text-anchor="middle">${esc(r.date || '')}</text>`; } });
    }
    // 面积 + 折线
    let d = '', a = `M ${X(0)} ${H - P.b} `;
    rows.forEach((r, i) => { d += `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(r.v).toFixed(1)} `; a += `L ${X(i).toFixed(1)} ${Y(r.v).toFixed(1)} `; });
    a += `L ${X(n - 1)} ${H - P.b} Z`;
    if (!opt.noArea) s += `<path class="t-area" d="${a}" fill="url(#${gid})"/>`;
    s += `<path class="t-line" d="${d}"${opt.lineColor ? ` stroke="${opt.lineColor}"` : ''}/>`;
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
    // 交互命中区（透明竖条覆盖整列：hover/触摸/点击 → tooltip 出该点数值）
    const hitW = Math.max(iw / Math.max(1, n - 1), 14);
    rows.forEach((r, i) => {
      const tip = [r.date, `值 ${fmt(r.v)}`, (r.pct != null ? `分位 ${pct(r.pct)}` : '')].filter(Boolean).join('|');
      s += `<rect class="t-hit" x="${(X(i) - hitW / 2).toFixed(1)}" y="${P.t}" width="${hitW.toFixed(1)}" height="${ih}" fill="transparent" data-tip="${esc(tip)}"/>`;
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
    let s = `<svg class="t-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(opt.k || '涨跌停分布')}">`;
    [0, 0.5, 1].forEach((f) => {
      const v = max * f, y = Y(v);
      s += `<line class="t-gridln" x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}"/>`;
      s += `<text class="t-tick" x="${P.l - 4}" y="${y + 3}" text-anchor="end">${Math.round(v)}</text>`;
    });
    s += `<line class="t-axis" x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}"/>`;
    const [lgA, lgB] = opt.legend || ['涨停', '跌停'];
    rows.forEach((r, i) => {
      const cx = P.l + i * slot + slot / 2;
      if (r.a != null) s += `<rect class="t-bar is-up" x="${(cx - bw - 1).toFixed(1)}" y="${Y(r.a).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - P.b - Y(r.a)).toFixed(1)}" rx="1"/>`;
      if (r.b != null) s += `<rect class="t-bar is-dn" x="${(cx + 1).toFixed(1)}" y="${Y(r.b).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - P.b - Y(r.b)).toFixed(1)}" rx="1"/>`;
      const tip = [r.date, (r.a != null ? `${lgA} ${fmt(r.a)}` : ''), (r.b != null ? `${lgB} ${fmt(r.b)}` : '')].filter(Boolean).join('|');
      s += `<rect class="t-hit" x="${(P.l + i * slot).toFixed(1)}" y="${P.t}" width="${slot.toFixed(1)}" height="${ih}" fill="transparent" data-tip="${esc(tip)}"/>`;
    });
    (opt.xLabels === 'all' ? rows.map((_, i) => i) : [0, rows.length - 1]).forEach((i) => {
      s += `<text class="t-tick" x="${P.l + i * slot + slot / 2}" y="${H - P.b + 12}" text-anchor="middle">${rows[i].date}</text>`;
    });
    // 图例可配（默认 涨停/跌停）：同一图表复用给「涨停/连板」等其它对儿时不至于说谎
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
    const col = opt.color || (v >= 80 ? '#ff2b2b' : v >= 40 ? '#22d3ee' : '#4d5b68');
    let s = `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${esc(opt.n || '')} ${fmt(v)}" data-tip="${esc(opt.tip || ((opt.n || '值') + ' ' + (v == null ? '—' : fmt(v))))}">`;
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
    // bar 格式（见下方解构 const [, o, c, h, l, v]）：b[3]=最高价、b[4]=最低价。
    // Y 轴「稳健自适应」：用末 RECENT 根（默认 60）定标，避免 6 个月前的历史极值把近期蜡烛
    // 整片压扁（用户反馈的「被历史极值拉偏」）。全部蜡烛仍照画，超出近期区间的古老极值坐标
    // 夹紧到绘图区上下缘（不溢出、不改写任何历史价）。
    const RECENT = Math.min(60, bars.length);
    const win = bars.slice(-RECENT);
    const lo0 = Math.min(...win.map((b) => b[4])), hi0 = Math.max(...win.map((b) => b[3]));
    const span0 = (hi0 - lo0) || 1;
    const pad = span0 * 0.06;
    const lo = lo0 - pad, hi = hi0 + pad, span = hi - lo;
    const Yraw = (p) => P.t + ih - ((p - lo) / span) * ih;
    const Y = (p) => Math.max(P.t, Math.min(P.t + ih, Yraw(p)));   // 夹紧：古老极值不溢出绘图区
    const n = bars.length, cw = iw / n, bw = Math.max(1.2, cw * 0.62);
    const maA = {};   // 预存 MA 值（纯展示，用已聚合收盘价，不重算引擎指标），供 tooltip 显示
    [5, 10, 20].forEach((N) => { const a = []; for (let i = 0; i < n; i++) { if (i >= N - 1) { let sum = 0; for (let j = i - N + 1; j <= i; j++) sum += bars[j][2]; a.push(sum / N); } else a.push(null); } maA[N] = a; });
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
      const ma = [5, 10, 20].map((N) => maA[N][i] != null ? `MA${N} ${fmt(maA[N][i], 2)}` : '').filter(Boolean);
      const tip = [b[0], `开 ${fmt(o, 2)}`, `高 ${fmt(h, 2)}`, `低 ${fmt(l, 2)}`, `收 ${fmt(c, 2)}`, `量 ${fmt(v)}`].concat(ma).join('|');
      s += `<rect class="t-hit" x="${(P.l + i * cw).toFixed(1)}" y="${P.t}" width="${cw.toFixed(1)}" height="${(H - P.t - P.b).toFixed(1)}" fill="transparent" data-tip="${esc(tip)}"/>`;
    });
    // MA5 / MA10 / MA20（对收盘价 b[2] 的移动平均；纯展示叠加，不重算引擎指标）
    [{ n: 5, c: '#e6f0f5' }, { n: 10, c: '#f5a623' }, { n: 20, c: '#a78bfa' }].forEach((m) => {
      const pts = [];
      for (let i = m.n - 1; i < n; i++) {
        let sum = 0; for (let j = i - m.n + 1; j <= i; j++) sum += bars[j][2];
        pts.push(`${(P.l + i * cw + cw / 2).toFixed(1)},${Y(sum / m.n).toFixed(1)}`);
      }
      if (pts.length > 1) s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${m.c}" stroke-width="1.2" opacity=".85"/>`;
    });
    s += `<line class="t-axis" x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}"/>`;
    s += `<line class="t-axis" x1="${P.l}" y1="${H - PV + 6}" x2="${W - P.r}" y2="${H - PV + 6}" opacity=".45"/>`;
    [0, n - 1].forEach((i) => { s += `<text class="t-tick" x="${P.l + i * cw + cw / 2}" y="${H - P.b + 12}" text-anchor="${i ? 'end' : 'start'}">${bars[i][0]}</text>`; });
    const lastC = bars[n - 1][2], prevC = bars[n - 2][2];
    const chg = prevC ? ((lastC - prevC) / prevC) * 100 : null;
    s += `<text class="t-tick-r" x="${W - P.r + 5}" y="${P.t + 9}" fill="${chg >= 0 ? '#ff4d4f' : '#00e676'}">${lastC.toFixed(2)}</text>`;
    s += `<text class="t-tick" x="${W - P.r + 5}" y="${P.t + 21}" fill="${chg >= 0 ? '#ff4d4f' : '#00e676'}">${sgn(chg, 2)}</text>`;
    return s + '</svg>';
  }

  // ── 3c. 图表交互：统一 tooltip 浮窗 + 事件委托（hover / 点击锁定 / 移动端触摸）──
  let _tipEl = null, _tipLocked = null, _tipTouch = false;
  function tipEl() {
    if (!_tipEl) {
      _tipEl = document.createElement('div');
      _tipEl.id = 'tTip'; _tipEl.className = 't-tip'; _tipEl.style.display = 'none';
      (document.body || document.documentElement).appendChild(_tipEl);
    }
    return _tipEl;
  }
  function tipText(raw) {
    return String(raw || '').split('|').map((l, i) => i === 0 ? `<b>${esc(l)}</b>` : `<span>${esc(l)}</span>`).join('<br>');
  }
  function tipShow(raw, x, y) {
    const el = tipEl(); el.innerHTML = tipText(raw); el.style.display = 'block';
    const r = el.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    const W = window.innerWidth || 800, H = window.innerHeight || 600;
    if (left + r.width > W - 8) left = x - r.width - 14;
    if (top + r.height > H - 8) top = y - r.height - 14;
    el.style.left = Math.max(8, left) + 'px'; el.style.top = Math.max(8, top) + 'px';
  }
  function tipHide() { if (_tipEl) _tipEl.style.display = 'none'; }
  function bindTip(root) {
    if (root.__tipBound) return; root.__tipBound = true;
    const hit = (e) => (e.target && e.target.closest) ? e.target.closest('[data-tip]') : null;
    root.addEventListener('mouseover', (e) => { const el = hit(e); if (el) { tipShow(el.getAttribute('data-tip'), e.clientX, e.clientY); el.classList.add('is-hot'); } });
    root.addEventListener('mouseout', (e) => { const el = hit(e); if (el && el !== _tipLocked) { tipHide(); el.classList.remove('is-hot'); } });
    root.addEventListener('mousemove', (e) => { if (_tipLocked) return; const el = hit(e); if (el) tipShow(el.getAttribute('data-tip'), e.clientX, e.clientY); });
    root.addEventListener('click', (e) => {
      if (_tipTouch) { _tipTouch = false; return; }   // 移动端 touch 已处理，避免合成 click 二次 toggle
      const el = hit(e);
      if (el) {
        if (_tipLocked === el) { _tipLocked = null; el.classList.remove('is-hot'); tipHide(); }
        else { if (_tipLocked) _tipLocked.classList.remove('is-hot'); _tipLocked = el; el.classList.add('is-hot'); tipShow(el.getAttribute('data-tip'), e.clientX, e.clientY); }
      } else if (_tipLocked) { _tipLocked.classList.remove('is-hot'); _tipLocked = null; tipHide(); }
    });
    // 移动端：touchstart 临时显示 / touchmove 滑动探图 / touchend 判定 tap(锁定)或滑动(清除)
    let tsX = 0, tsY = 0, tsEl = null;
    root.addEventListener('touchstart', (e) => { const t = e.touches && e.touches[0]; if (!t) return; tsX = t.clientX; tsY = t.clientY; tsEl = hit(e); if (tsEl) { tipShow(tsEl.getAttribute('data-tip'), t.clientX, t.clientY); tsEl.classList.add('is-hot'); } }, { passive: true });
    root.addEventListener('touchmove', (e) => { const t = e.touches && e.touches[0]; if (!t) return; const el = document.elementFromPoint(t.clientX, t.clientY); const he = el && el.closest ? el.closest('[data-tip]') : null; if (he && he !== tsEl) { if (tsEl) tsEl.classList.remove('is-hot'); tsEl = he; he.classList.add('is-hot'); tipShow(he.getAttribute('data-tip'), t.clientX, t.clientY); } }, { passive: true });
    root.addEventListener('touchend', (e) => { const t = e.changedTouches && e.changedTouches[0]; if (!t) return; _tipTouch = true; const moved = Math.hypot(t.clientX - tsX, t.clientY - tsY) > 10; if (moved) { if (tsEl && tsEl !== _tipLocked) { tsEl.classList.remove('is-hot'); tsEl = null; tipHide(); } } else { if (tsEl) { if (_tipLocked === tsEl) { _tipLocked = null; tsEl.classList.remove('is-hot'); tipHide(); } else { if (_tipLocked) _tipLocked.classList.remove('is-hot'); _tipLocked = tsEl; tsEl.classList.add('is-hot'); tipShow(tsEl.getAttribute('data-tip'), t.clientX, t.clientY); } tsEl = null;       } else if (_tipLocked) { _tipLocked.classList.remove('is-hot'); _tipLocked = null; tipHide(); } } }, { passive: true });
  tipEl();   // 立即创建隐藏浮窗，保证 #tTip 常驻 DOM（不依赖首次 hover）
  }

  // ── 3b. K线周期：日 → 周/月/季/半年/年（展示层聚合）───────────────────────
  //   ⚠ 纪律：这是**展示层周期转换**（同炒股软件切周期），聚合规则为业界标准 OHLCV：
  //     开 = 区间首根开盘 / 高 = 区间最高 / 低 = 区间最低 / 收 = 区间末根收盘 / 量 = 区间求和。
  //     **不是重算指标、不改判任何阈值**，也不做平滑、插值、复权。
  //   数据源只有日K（ui/kline 无多周期字段），故只有这 6 档；
  //   分时 / 30分 / 60分 **系统无分钟数据源，不做**（不伪造、不冒充）。
  const PERIODS = [
    { k: 'day', n: '日K' }, { k: 'week', n: '周K' }, { k: 'month', n: '月K' },
    { k: 'quarter', n: '季K' }, { k: 'half', n: '半年K' }, { k: 'year', n: '年K' },
  ];
  function periodKey(ds, p) {
    const y = +ds.slice(0, 4), m = +ds.slice(5, 7), d = +ds.slice(8, 10);
    if (p === 'week') {                                  // ISO 周：以该周周一为分组键
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));   // 周一 = 0
      return dt.toISOString().slice(0, 10);
    }
    if (p === 'month') return `${y}-${String(m).padStart(2, '0')}`;
    if (p === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    if (p === 'half') return `${y}-H${Math.floor((m - 1) / 6) + 1}`;
    if (p === 'year') return String(y);
    return ds;                                           // day：逐日，不聚合
  }
  function aggregateBars(bars, period) {
    if (!period || period === 'day') return bars;
    const groups = new Map();
    for (const b of bars) {
      const k = periodKey(String(b[0]), period);
      const g = groups.get(k);
      if (!g) groups.set(k, { date: String(b[0]), o: b[1], c: b[2], h: b[3], l: b[4], v: b[5] });
      else {
        g.c = b[2];                                      // 收 = 区间末根收盘
        if (b[3] > g.h) g.h = b[3];                      // 高 = 区间最高
        if (b[4] < g.l) g.l = b[4];                      // 低 = 区间最低
        g.v += b[5];                                     // 量 = 区间求和
        g.date = String(b[0]);                           // 标签取区间末日
      }
    }
    return [...groups.values()]
      .sort((a, b2) => (a.date < b2.date ? -1 : a.date > b2.date ? 1 : 0))
      .map((g) => [g.date, g.o, g.c, g.h, g.l, g.v]);
  }

  /** 通用 K线渲染（抽屉与 K线视图共用）：周期下拉 + 蜡烛 + 成交量副图 */
  function renderKline(host, code, state) {
    const cc = String(code).replace(/^(sh|sz|bj)/, '');
    const prefix = /^(6|9)/.test(cc) ? 'sh' : /^(4|8)/.test(cc) ? 'bj' : 'sz';
    const period = state.period || 'day';
    const opts = PERIODS.map((p) => `<option value="${p.k}"${p.k === period ? ' selected' : ''}>${p.n}</option>`).join('');
    host.innerHTML = `<div class="t-kbar"><label>周期
      <select class="t-kperiod" aria-label="K线周期">${opts}</select></label></div>
      <div class="t-kbody"><div class="t-loading">加载日K…</div></div>`;
    const body = $('.t-kbody', host);
    const sel = $('.t-kperiod', host);

    const draw = (k) => {
      const raw = (k && k.bars) || [];
      if (raw.length < 2) {
        body.innerHTML = '<div class="t-empty">该标的暂无 K 线分片（kline 分片仅覆盖历史上榜股）</div>';
        return;
      }
      // ⚠ period 必须在 draw **内部**取：切周期时只改 state.period 并重绘，
      //   若在闭包外捕获一次，切换后仍用旧值（曾导致下拉选周/月/年都还是日K）。
      const period = state.period || 'day';
      const bars = aggregateBars(raw, period);
      const unit = (PERIODS.find((p) => p.k === period) || {}).n || period;
      const tail = bars.slice(-120);
      const last = tail[tail.length - 1], prev = tail.length > 1 ? tail[tail.length - 2][2] : null;
      const chg = prev ? ((last[2] - prev) / prev) * 100 : null;
      // 样本过少时如实提示（源数据仅 649 根日K ≈ 2.6 年，年K 只有约 3 根）
      const warn = bars.length < 3 ? ' · <span class="t-warn-inline">⚠ 样本过少（源数据仅 649 根日K ≈ 2.6 年）</span>' : '';
      body.innerHTML = `<div class="t-kmeta">${esc(unit)} <b>${bars.length}</b> 根 · 源 ${raw.length} 根日K · 最新 ${esc(last[0])} · 收 <b>${fmt(last[2], 2)}</b> <span class="${chg == null ? '' : chg >= 0 ? 'up' : 'dn'}">${sgn(chg, 2)}</span>${warn}</div>`
        + `<div class="t-kcap">日 K 线（截至上一交易日收盘）</div>`
        + candles(tail, { w: 660, h: 380 });
    };
    sel.addEventListener('change', () => { state.period = sel.value; draw(state.k); });
    state.redraw = () => draw(state.k);   // 供键盘 ←/→ 切周期复用（与下拉同语义：只重绘不重抓）
    jget(durl(`ui/kline/${prefix}${cc}.json`)).then((k) => { state.k = k; draw(k); });
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
    // 「妖股纯情绪」可点：跳到选股视图并自动切到纯情绪子集（is_pure_sentiment=true），
    //   省得用户在 40 只梯队里肉眼找那 N 只。跳转只切视图 + 过滤，不重算任何结论。
    if (dl && Array.isArray(dl.pureSentiment) && dl.pureSentiment.length) {
      aiBits.push(`<button type="button" class="t-ai-item is-jump" data-jump="picks" data-filter="pure"`
        + ` title="查看这 ${dl.pureSentiment.length} 只纯情绪炒作个股">🕵 妖股纯情绪 <b>${dl.pureSentiment.length}</b> 只<span class="t-jump-txt">查看</span></button>`);
    }
    if (S.llm && S.llm.sentimentRaw != null) aiBits.push(`<span class="t-ai-item">📰 舆情读数 <b>${fmt(S.llm.sentimentRaw, 2)}</b>${S.llm.confidence != null ? `（置信 ${fmt(S.llm.confidence * 100, 0)}%）` : ''}</span>`);
    const ss = S.sectorSentiment;
    if (ss && !ss.degraded) { const sc = ss.score != null ? ss.score : (ss.macro && ss.macro.score); if (sc != null) aiBits.push(`<span class="t-ai-item">🧭 板块情绪 <b>${fmt(sc, 2)}</b></span>`); }
    if ((S.health && S.health.level) === 'ok') aiBits.push('<span class="t-ai-item">💚 数据健康 <b>ok</b></span>');
    if (aiBits.length) {
      const strip = el('div', 't-c12', `<div class="t-ai-strip"><span class="t-ai-tag">AI Side-car</span>${aiBits.join('')}</div>`);
      strip.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-jump]');
        if (!b) return;
        pickFilter = b.dataset.filter === 'pure' ? 'pure' : null;
        SAFE(() => goView(b.dataset.jump), 'jump');
      });
      g.appendChild(strip);
    }

    // ── 核心指标 ──
    const stats = el('div', 't-stats');
    stats.innerHTML =
      stat('情绪分', fmt(L.value), `历史分位 <b>${pct(L.pct_rank, 0)}</b>`, L.value >= 80 ? 'is-crit-glow' : L.value >= 65 ? 'is-warn-glow' : 'is-mut-glow') +
      stat('市场状态', `<span class="t-regime ${REGIME_CLS[reg.key] || ''}">${esc(reg.label || '—')}</span>`, `方向 ${({ up: '↑', down: '↓', flat: '→' })[reg.dir] || '—'}｜置信 ${esc(reg.confidence || '—')}`) +
      stat('执行仓位', esc(pr.finalRange || '—'), `${pr.force ? '<b style="color:var(--t-alert)">风控帽强制降仓</b>' : `基础 ${esc(pr.baseRange || '—')}`}`, pr.force ? 'is-alert' : '') +
      stat('涨停 / 跌停', `<span class="is-up">${fmtInt(L.zt_count)}</span> <span style="color:var(--t-ink-3)">/</span> <span class="is-dn">${fmtInt(L.dt_count)}</span>`, `炸板 ${fmtInt(L.zb_count)}｜封板率 ${pct(L.seal_pct, 0)}`) +
      stat('涨 / 跌家数', `<span class="is-up">${fmtInt(L.up_count)}</span> <span style="color:var(--t-ink-3)">/</span> <span class="is-dn">${fmtInt(L.down_count)}</span>`, '沪深两市口径') +
      stat('龙虎净买', wan(L.lhb_daily_net), `上榜 ${fmtInt(L.lhb_daily_stocks || L.lhb_stocks)} 只`, (L.lhb_daily_net || 0) >= 0 ? 'up' : 'dn');
    g.appendChild(panel('核心指标', L.trade_date, stats.outerHTML, 't-c12'));

    // ── 主图：情绪分折线（seriesCompact，零额外请求）──
    //   按全局时间窗取尾部 N 天；仅影响画多少天，不重算任何指标
    const rng = LINK.sel.range || 60;
    const seriesAll = (S.regime && S.regime.seriesCompact) || [];
    const series = seriesAll.slice(-rng);
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
        ${stat('主线净买', wan(mt.main_yi != null ? mt.main_yi * 10000 : null), `全榜 ${wan(mt.tot_yi != null ? mt.tot_yi * 10000 : null)}`, (mt.main_yi != null ? mt.main_yi : 0) >= 0 ? 'up' : 'dn')}
      </div>` : '<div class="t-empty">当日无主线</div>', 't-c8'));

    // 近 N 日「涨停 vs 连板」柱状图归属「涨跌停」专题视图（viewZt），
    // 总览不再重复陈列，避免与涨跌停视图图面重合/冗余。



    // ── 市场宽度（全市场健康度核心）：站上均线占比 / 新高新低 / 涨跌比 ──
    //   全取 engine 原值（data/breadth-latest.json），**不重算**；后台拉，不阻塞首屏。
    const bwPanel = panel('市场宽度', '站上均线 / 新高新低 / 涨跌比 · engine 原值', '<div class="t-loading">加载…</div>', 't-c12');
    g.appendChild(bwPanel);
    jget('data/breadth-latest.json').then((bw) => {
      if (!bwPanel.isConnected) return;
      const host = bwPanel.lastElementChild;
      if (!host) return;
      if (!bw) { host.outerHTML = '<div class="t-empty">宽度档缺失 → 不显示（fail-open）</div>'; return; }
      const bm = bw.aboveMa || {}, nh = bw.newHigh || {}, nl = bw.newLow || {}, ud = bw.updown || {};
      const udTotal = (ud.up || 0) + (ud.down || 0) + (ud.flat || 0);
      // ⚠ breadth.verdict 是对象 {level,label,detail}（src/breadth.js::breadthVerdict），而 aboveMa.verdict 是字符串；
      //   这里统一兼容两种形态取 level/label，避免整段 verdict 被当字符串渲染成「[object Object]」、且着色判据失效。
      const bv = bw.verdict;
      const bvLevel = (bv && typeof bv === 'object') ? (bv.level || '') : (bv || '');
      const bvLabel = (bv && typeof bv === 'object') ? (bv.label || bv.level || '—') : (bv || '—');
      const vcls = bvLevel === 'broad' ? 'is-ok' : bvLevel === 'diverged' ? 'is-alert' : '';
      host.outerHTML = `<div class="t-stats">
          ${stat('站上20日线', pct(bm.ratio != null ? bm.ratio * 100 : null, 1), `(${fmtInt(bm.n)}/${fmtInt(bm.den)}) · ${esc(bm.verdict || '—')}`)}
          ${stat('历史新高', fmtInt(nh.n), `250日窗口 · 分母 ${fmtInt(nh.den)}`)}
          ${stat('历史新低', fmtInt(nl.n), `250日窗口 · 分母 ${fmtInt(nl.den)}`)}
          ${stat('涨跌比', `${fmtInt(ud.up)}:${fmtInt(ud.down)}`, `${fmtInt(ud.flat)} 平 · 全市场口径`)}
        </div>
        ${barChart([{ date: '涨', a: ud.up || 0 }, { date: '跌', a: ud.down || 0 }, { date: '平', a: ud.flat || 0 }], { w: 900, h: 110, legend: ['家数', ''] })}
        <div class="t-dnote ${vcls}">宽度判语：<b>${esc(bvLabel)}</b>${bw.divergence ? ` · 背离：${esc(bw.divergence)}` : ''} · asOf ${esc(bw.date || '—')}</div>`;
    }).catch(() => {
      const host = bwPanel.lastElementChild;
      if (host) host.outerHTML = '<div class="t-empty">宽度档读取失败（fail-open）</div>';
    });

    // ── 主线题材脉络（近几日轮动：main_theme_history.days）──
    //   ⚠ 每天主线是数组（多主线并存），且每天主线名不同 → 不做单一时间序列折线，
    //     改成「按天时间轴」逐日列出主线 chip（强度着色 / 续日标「续」）+ 轮动标记。全取引擎原值。
    const thPanel = panel('主线题材脉络', '近 N 日主线轮动 · main_theme_history', '<div class="t-loading">加载…</div>', 't-c12');
    g.appendChild(thPanel);
    jget(durl('data/main_theme_history.json')).then((mh) => {
      if (!thPanel.isConnected) return;
      const host = thPanel.lastElementChild;
      if (!host) return;
      if (!mh || !Array.isArray(mh.days) || !mh.days.length) { host.outerHTML = '<div class="t-empty">主线历史档缺失 / 空（fail-open）</div>'; return; }
      host.outerHTML = `<div class="t-thlist">
        ${mh.days.map((d) => `<div class="t-throw">
            <span class="t-thdate">${esc(String(d.date || '').slice(4) || '—')}</span>
            <span class="t-thbody">
              ${(Array.isArray(d.main_themes) && d.main_themes.length)
            ? d.main_themes.map((t) => `<span class="t-thchip ${t.strength === '强主线' ? 'is-strong' : 'is-weak'}">${esc(t.name || '—')} <b>${fmtInt(t.zt_count)}</b>${t.is_continuous ? ' <span class="t-thcon">续</span>' : ''}</span>`).join('')
            : '<span class="t-thempty">空窗</span>'}
              ${d.rotation ? '<span class="t-throt">↻ 轮动</span>' : ''}
            </span>
          </div>`).join('')}
      </div>`;
    }).catch(() => {
      const host = thPanel.lastElementChild;
      if (host) host.outerHTML = '<div class="t-empty">主线历史档读取失败（fail-open）</div>';
    });

    // ── 辅助面板（可选，默认折叠）：公告流 + 外围/汇率 ──
    //   均为引擎原值，fail-open；用原生 <details> 折叠 → 无需 JS、移动端友好，天然「可选查看」。
    const aux = el('details', 't-aux t-c12');
    const auxSum = el('summary', 't-aux-sum');
    auxSum.innerHTML = '辅助信息 · 公告流 / 外围汇率<span class="t-aux-hint">（可选，点击展开 / 收起）</span>';
    const auxGrid = el('div', 't-grid');
    const annPanel = panel('公告流', '连板股最新公告 · announcements-latest', '<div class="t-loading">加载…</div>', 't-c6');
    const gloPanel = panel('外围 / 汇率', 'global.json · 外围锚 + 离岸/在岸美元', '<div class="t-loading">加载…</div>', 't-c6');
    auxGrid.appendChild(annPanel); auxGrid.appendChild(gloPanel);
    aux.appendChild(auxSum); aux.appendChild(auxGrid);
    g.appendChild(aux);

    // 公告流回填（连板股异常波动/风险提示/财报，含原文链接）
    jget(durl('data/announcements-latest.json')).then((a) => {
      if (!annPanel.isConnected) return;
      const host = annPanel.lastElementChild;
      if (!host) return;
      const ds = (a && Array.isArray(a.details)) ? a.details : [];
      if (!ds.length) { host.outerHTML = '<div class="t-empty">无公告数据（fail-open）</div>'; return; }
      host.outerHTML = `<div class="t-anlist">${ds.slice(0, 14).map((d) => `
        <div class="t-anrow">
          <span class="t-anc">${esc(d.code || '—')}</span>
          <span class="t-ann">${esc(d.name || '—')}</span>
          <span class="t-ant">${(Array.isArray(d.announcements) ? d.announcements : []).map((x) => `<a class="t-antitle" href="${esc(x.url || '#')}" target="_blank" rel="noopener">${esc(x.title || '—')}</a>${x.date ? `<span class="t-and">${esc(x.date)}</span>` : ''}`).join('')}</span>
        </div>`).join('')}</div>`;
    }).catch(() => {
      const host = annPanel.lastElementChild;
      if (host) host.outerHTML = '<div class="t-empty">公告档读取失败（fail-open）</div>';
    });

    // 外围 / 汇率回填（A50/费半/纳指/金龙/WTI 等外围锚 + 离岸/在岸美元 + 外围判语）
    jget('data/global.json').then((gl) => {
      if (!gloPanel.isConnected) return;
      const host = gloPanel.lastElementChild;
      if (!host) return;
      if (!gl) { host.outerHTML = '<div class="t-empty">外围档缺失（fail-open）</div>'; return; }
      const rmb = gl.rmb || {};
      const qs = Array.isArray(gl.quotes) ? gl.quotes : [];
      const wv = (gl.watch && gl.watch.verdict) || {};
      host.outerHTML = `<div class="t-glob">
        <div class="t-stats">
          ${stat('美元离岸', rmb.usdcnh_last != null ? fmt(rmb.usdcnh_last, 4) : '—', 'USDCNH')}
          ${stat('美元在岸', rmb.usdcny_last != null ? fmt(rmb.usdcny_last, 4) : '—', 'USDCNY')}
        </div>
        <div class="t-gqlist">${qs.map((q) => {
          const chg = q.chg_pct != null ? +q.chg_pct : null;
          const cls = chg == null ? '' : (chg >= 0 ? 'up' : 'dn');
          return `<div class="t-gqrow${q.ok === false ? ' is-miss' : ''}">
            <span class="t-gqname">${esc(q.name || q.key || '—')}</span>
            <span class="t-gqval ${cls}">${q.last != null ? fmt(q.last, 2) : '—'}<span class="t-gqchg ${cls}">${chg == null ? '' : sgn(chg, 2)}</span></span>
            <span class="t-gqst">${esc(q.stateText || '')}</span>
          </div>`;
        }).join('')}</div>
        ${wv.label ? `<div class="t-dnote ${wv.key === 'bull' ? 'is-ok' : wv.key === 'bear' ? 'is-alert' : ''}">外围判语：<b>${esc(wv.label)}</b>${wv.hint ? ` · ${esc(wv.hint)}` : ''}</div>` : ''}
      </div>`;
    }).catch(() => {
      const host = gloPanel.lastElementChild;
      if (host) host.outerHTML = '<div class="t-empty">外围档读取失败（fail-open）</div>';
    });

    return g;
  }

  // ── 6. 视图：板块 ──────────────────────────────────────────────────────
  function viewSector(S) {
    const L = S.latest || {};
    const ir = L.industry_relative || {};
    const ss = S.sectorSentiment || {};
    const g = el('div', 't-grid');

    // ── ① 板块宽度（引擎原值；仅「上涨占比」为展示层现算，已标注口径）──
    g.appendChild(panel('板块宽度', `交易日 ${esc(L.trade_date || '—')} · industry_relative`,
      `<div class="t-stats">
        ${stat('上涨板块', `${fmtInt(ir.upCount)} <span style="color:var(--t-ink-3)">/</span> ${fmtInt(ir.total)}`, 'engine：upCount / total')}
        ${stat('上涨占比', (ir.upCount != null && ir.total) ? pct((ir.upCount / ir.total) * 100, 1) : '—', '展示层现算 upCount/total')}
        ${stat('行业中位数', sgn(ir.medianPct, 2), 'medianPct：全行业涨跌中位数')}
        ${stat('攻防取样', fmtInt(ir.topN), 'topN：攻防各取前 N 个行业')}
        ${stat('降级状态', ir.degraded ? '已降级' : '正常', ir.degraded ? esc(ir.degradedReason || '—') : 'industry_relative 未降级')}
      </div>`, 't-c12'));

    // ── ② 板块相对强弱：两套基准（引擎都给了，切换只是换一组原值来画）──
    //   vsIndex = 对比指数（如沪深300），vsMedian = 对比行业中位数；两者都是**引擎已算好的超额**，
    //   这里不做任何减法，只切换取哪一组。视觉语言沿用：左=落后基准（绿）· 右=跑赢基准（红）。
    const bases = [
      { k: 'index', d: ir.vsIndex || {} },
      { k: 'median', d: ir.vsMedian || {} },
    ];
    const cur = bases.find((b) => b.k === sectorBase) || bases[0];
    const vs = cur.d;
    const atk = vs.attack || [], def = vs.defense || [];
    // ⚠ 柱宽必须与右侧显示的数值（change_pct，涨跌幅）同口径等比例，否则「数值接近、柱长差很大」的视觉欺骗。
    //   绝不混用 excess（相对基准超额，语义不同）。
    const maxAbs = Math.max(1, ...atk.map((x) => Math.abs(x.change_pct || 0)), ...def.map((x) => Math.abs(x.change_pct || 0)));
    const rows = [];
    // ⚠ attack（跑赢基准·红）与 defense（落后基准·绿）是**两个独立榜单**，按名次对齐展示；
    //   每行左右各成一个**完整单元**（各自带板块名 + 数值），绝不共用一行的 name → 杜绝张冠李戴。
    for (let i = 0; i < Math.max(atk.length, def.length); i++) {
      const a = atk[i], d = def[i];
      rows.push(`<div class="t-dv-row t-dv-row--dual">
        <div class="t-dv-side is-dn">
          <span class="t-dv-name" title="${esc((d && d.name) || '')}">${esc((d && d.name) || '—')}</span>
          <span class="t-dv-track is-l">${d ? `<span class="t-dv-fill dn" style="width:${(Math.abs(d.change_pct) / maxAbs * 100).toFixed(1)}%"></span>` : ''}</span>
          <span class="t-dv-val"><span class="${d ? 'dn' : ''}">${d ? sgn(d.change_pct, 2) : ''}</span></span>
        </div>
        <div class="t-dv-side is-up">
          <span class="t-dv-val"><span class="${a ? 'up' : ''}">${a ? sgn(a.change_pct, 2) : ''}</span></span>
          <span class="t-dv-track">${a ? `<span class="t-dv-fill up" style="width:${(Math.abs(a.change_pct) / maxAbs * 100).toFixed(1)}%"></span>` : ''}</span>
          <span class="t-dv-name" title="${esc((a && a.name) || '')}">${esc((a && a.name) || '—')}</span>
        </div>
      </div>`);
    }
    // ⚠ 分段控件必须放 **body**（panel() 的 key 参数会走 esc()，塞 HTML 进去会被转义成文本，
    //   既显示不出按钮，也 querySelector 不到 → 下面那句 addEventListener 直接抛 null）。
    const seg = `<div class="t-seg-row"><span class="t-seg-lbl">对比基准</span><span class="t-seg" role="group" aria-label="对比基准">
      ${bases.map((b) => `<button type="button" data-b="${b.k}"${b.k === cur.k ? ' class="is-on"' : ''}>${esc(b.d.baseLabel || (b.k === 'index' ? '指数' : '中位数'))}</button>`).join('')}
    </span></div>`;
    const rsPanel = panel('板块相对强弱', `左=落后基准 · 右=跑赢基准 · 基准涨跌 ${sgn(vs.basePct, 2)}`,
      seg + (rows.length ? `<div>${rows.join('')}</div>` : '<div class="t-empty">无板块数据</div>'), 't-c12');
    g.appendChild(rsPanel);
    $('.t-seg', rsPanel).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-b]');
      if (!b || b.dataset.b === sectorBase) return;
      sectorBase = b.dataset.b;
      SAFE(() => goView('sector'), 'sector-base');   // 换一组引擎原值重画，不重算
    });

    // ── ③ AI 板块情绪（GLM 场景二「题材翻译官」）—— 全紫，看到紫 = AI 说的 ──
    const secs = (ss.sectors || []).slice().sort((a, b2) => (+b2.score || 0) - (+a.score || 0));
    const pos = secs.filter((x) => (+x.score || 0) > 0).length;
    const neg = secs.filter((x) => (+x.score || 0) < 0).length;
    const mc = ss.macro || {};
    g.appendChild(el('div', 't-c12', `<div class="t-ai-strip">
      <span class="t-ai-tag">AI Side-car</span>
      <span class="t-ai-item">GLM 板块情绪（方向 B · 题材翻译官）</span>
      <span class="t-ai-item">asOf ${esc(ss.asOfDate || '—')} · 扫描 ${fmtInt(ss.scanned || 0)} 个板块</span>
      <span class="t-ai-item">宏观读数 <b>${esc(mc.label || '—')}</b>（${fmt(mc.score100, 0)} · 置信 ${pct(mc.confidence != null ? mc.confidence * 100 : null, 0)}）</span>
      <span class="t-ai-item">仅参考，不修改引擎情绪分 / regime 判定</span>
      ${ss.degraded ? '<span class="t-ai-item">⚠ 侧车降级，结论可能不完整</span>' : ''}
    </div>`));

    if (!secs.length) {
      g.appendChild(panel('AI 板块情绪', '侧车未产出', '<div class="t-empty">当日无板块情绪侧车数据（非交易日或 GLM 未产出）</div>', 't-c12'));
    } else {
      // 双向条：左侧=看空（绿），右侧=看多（红），宽度按 |score| 相对最大值
      const mAbs = Math.max(0.01, ...secs.map((x) => Math.abs(+x.score || 0)));
      const bars = secs.map((x) => {
        const sc = +x.score || 0;
        const hl = (x.headlines || [])[0] || '';
        const rs = (x.headlines || []).slice(1).join(' / ');
        return `<div class="t-dv-row" style="grid-template-columns:86px 1fr 1fr 116px">
          <span class="t-dv-name" title="${esc(x.sector || '')}">${esc(x.sector || '—')}</span>
          <span class="t-dv-track is-l">${sc < 0 ? `<span class="t-dv-fill dn" style="width:${(Math.abs(sc) / mAbs * 100).toFixed(1)}%"></span>` : ''}</span>
          <span class="t-dv-track">${sc > 0 ? `<span class="t-dv-fill up" style="width:${(Math.abs(sc) / mAbs * 100).toFixed(1)}%"></span>` : ''}</span>
          <span class="t-dv-val"><span class="${sc >= 0 ? 'up' : 'dn'}">${sc >= 0 ? '+' : ''}${fmt(sc, 2)}</span>
            <span class="t-sv-mut" title="${esc(rs)}">${fmtInt(x.newsCount)}条·多${fmtInt(x.bullish)}/空${fmtInt(x.bearish)}</span></span>
        </div>
        <div class="t-sec-hl" title="${esc(rs)}">${esc(hl || '—')}</div>`;
      }).join('');
      g.appendChild(panel('AI 板块情绪榜', `${secs.length} 个板块 · 多 ${pos} / 空 ${neg} · 左=看空 · 右=看多`,
        `<div>${bars}</div>
        ${mc.reason ? `<div class="t-dnote" style="margin-top:10px">${esc(String(mc.reason))}</div>` : ''}`, 't-c12'));
    }

    // 游资黑话（GLM 生成，锚定当日快照；缺则不显示，不套模板冒充）
    if (ss.blackTalk) {
      g.appendChild(el('div', 't-c12', `<div class="t-blacktalk">
        <span class="t-bt-tag">游资黑话</span><span class="t-bt-body">${esc(String(ss.blackTalk))}</span>
      </div>`));
    }

    // ── ④ 板块事件流（GLM 从滚动新闻映射出的「哪条新闻影响了哪个板块」）──
    const evs = ss.events || [];
    const evPanel = panel('板块事件流', `GLM 新闻→板块 映射 · ${evs.length} 条`,
      !evs.length ? '<div class="t-empty">当日无事件映射</div>'
        : `<div class="t-tbl-wrap"><table class="t-tbl"><thead><tr>
            <th>日期</th><th>方向</th><th>强度</th><th>影响板块</th><th>事件</th><th>判词</th>
          </tr></thead><tbody>${
        evs.map((e) => {
          const dir = String(e.direction || '').toLowerCase();
          const cls = dir === 'positive' ? 'is-pass' : dir === 'negative' ? 'is-no' : 'is-info';
          const lb = dir === 'positive' ? '利多' : dir === 'negative' ? '利空' : '中性';
          const rs = String(e.reason || '—');
          return `<tr>
            <td class="mut">${esc(String(e.date || '—').slice(5))}</td>
            <td><span class="t-res ${cls}">${lb}</span></td>
            <td>${pct(e.intensity != null ? e.intensity * 100 : null, 0)}</td>
            <td>${(e.sectors || []).map((s2) => esc(s2)).join('、') || '—'}</td>
            <td title="${esc(e.headline || '')}">${esc(String(e.headline || '—').slice(0, 30))}</td>
            <td title="${esc(rs)}">${esc(rs.length > 26 ? `${rs.slice(0, 26)}…` : rs)}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`, 't-c12');
    g.appendChild(evPanel);

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

    const rng = LINK.sel.range || 60;
    // 涨停 vs 连板（按全局时间窗取尾部 N 日）
    const hPanel = panel('涨停家数 vs 连板家数', `近 ${rng} 交易日 · 引擎原值`, '<div class="t-loading">加载…</div>', 't-c12');
    g.appendChild(hPanel);
    loadHist(rng).then((hist) => {
      const data = hist.filter((r) => r.zt != null).map((r) => ({ date: r.date, a: r.zt, b: r.lb }));
      const host = hPanel.lastElementChild;
      if (host) host.outerHTML = data.length ? barChart(data, { w: 900, h: 200, legend: ['涨停', '连板'] }) : '<div class="t-empty">无涨跌停历史</div>';
    });

    // 最高连板高度（同时间窗）
    const bPanel = panel('最高连板高度', `近 ${rng} 交易日 · max_board`, '<div class="t-loading">加载…</div>', 't-c12');
    g.appendChild(bPanel);
    loadHist(rng).then((hist) => {
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
    // 展示升级：细长红条 → 环形仪表盘（gauge 助手，纯展示），旁边保留主/总净额对照；
    //   ⚠ 龙虎榜 TOP5 / 游资机构北向三方 **系统尚未产出对应档** → 不伪造，扎实展示已有值。
    g.appendChild(panel('主线资金集中度', `主线「${esc(mt.name || '—')}」· 口径 ${esc(mt.caliber || 'daily')}`,
      `<div class="t-gauge-row">
        <div class="t-gauge">${gauge(p, { n: '集中度', color: p != null && p >= 50 ? '#ff5a4d' : '#22d3ee', tip: `主线资金集中度|集中度 ${p == null ? '—' : fmt(p, 1) + '%'}|主线净额 ${main != null ? fmt(main, 2) : '—'} 亿|龙虎总额 ${tot != null ? fmt(tot, 2) : '—'} 亿` })}</div>
        <div class="t-gauge-side">
          ${stat('主线净额', `${fmt(main, 2)} 亿`, 'main_yi', +main > 0 ? 'up' : 'dn')}
          ${stat('龙虎总额', `${fmt(tot, 2)} 亿`, 'tot_yi')}
        </div>
      </div>
      <div class="t-sub">集中度 = 主线净额 / 龙虎总额${mt.pct != null ? '' : '（占比由原始额现算）'} · 龙虎 TOP5 / 三方数据未产出 → 不伪造</div>`, 't-c12'));

    return g;
  }

  // ── 6d. 视图：选股（数据来自 GLM 侧车 dragonLogic.dragons，非引擎选股）──
  //   ⚠ 纪律：本视图 100% 是 AI 侧车输出 → 一律紫色标注（看到紫 = AI 说的），
  //     并明示「不修改引擎情绪分与 regime 判定」。这里**不做任何筛选/打分**，
  //     只做「按连板数降序 + 聚合统计」两类纯展示操作，不重算任何指标。
  function viewPicks(S) {
    const dg = S.dragonLogic || {};
    const arr = Array.isArray(dg.dragons) ? dg.dragons.slice() : [];
    const g = el('div', 't-grid');

    // AI 来源条（紫）——先声明数据来源，再谈内容
    //   右侧「全部 / 仅纯情绪」是**子集过滤开关**（会话级，写在 pickFilter）：
    //   从总览「🕵 妖股纯情绪 N 只」点进来时会自动停在「仅纯情绪」。
    const onlyPure = pickFilter === 'pure';
    const pureCount = arr.filter((x) => x.is_pure_sentiment === true).length;
    const stripEl = el('div', 't-c12', `<div class="t-ai-strip">
      <span class="t-ai-tag">AI Side-car</span>
      <span class="t-ai-item">GLM 妖股逻辑推演（方向 C）</span>
      <span class="t-ai-item">asOf ${esc(dg.asOfDate || '—')}</span>
      <span class="t-ai-item">仅参考，不修改引擎情绪分 / regime 判定</span>
      ${dg.degraded ? '<span class="t-ai-item">⚠ 侧车降级，结论可能不完整</span>' : ''}
      <span class="t-ai-filter" role="group" aria-label="梯队筛选">筛选
        <button type="button" data-f="all"${onlyPure ? '' : ' class="is-on"'}>全部 ${arr.length}</button>
        <button type="button" data-f="pure"${onlyPure ? ' class="is-on"' : ''}>仅纯情绪 ${pureCount}</button>
      </span>
    </div>`);
    stripEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      const f = b.dataset.f === 'pure' ? 'pure' : null;
      if (f === pickFilter) return;
      pickFilter = f;
      SAFE(() => goView('picks'), 'pick-filter');   // 重绘本视图（不重算，只换展示子集）
    });
    g.appendChild(stripEl);

    if (!arr.length) {
      g.appendChild(panel('连板梯队', '当日无数据', '<div class="t-empty">当日无连板梯队数据（非交易日或侧车未产出）</div>', 't-c12'));
      return g;
    }

    // 排序：连板数降序 → 代码升序（纯展示排序，非打分）
    const all = arr.slice().sort((a, b) => (+b.lb || 0) - (+a.lb || 0) || String(a.code).localeCompare(String(b.code)));
    // 子集过滤：onlyPure 时只留 is_pure_sentiment=true（**侧车原值**，不是我们重判的）
    const sorted = onlyPure ? all.filter((x) => x.is_pure_sentiment === true) : all;
    if (!sorted.length) {
      g.appendChild(panel('连板梯队', '当前筛选无命中',
        `<div class="t-empty">当前筛选（仅纯情绪）无命中——全梯队 ${all.length} 只里没有 is_pure_sentiment=true 的记录。<br>
        点上方「全部 ${all.length}」切回全梯队。</div>`, 't-c12'));
      return g;
    }
    const maxLb = sorted.reduce((m, x) => Math.max(m, +x.lb || 0), 0);
    const pure = sorted.filter((x) => x.is_pure_sentiment === true).length;
    const subKey = onlyPure ? ` · 仅纯情绪子集（全梯队 ${all.length} 只）` : '';

    g.appendChild(panel('梯队概览', `共 ${sorted.length} 只 · 最高 ${maxLb} 板${subKey}`,
      `<div class="t-stats">
        ${stat('统计只数', fmtInt(sorted.length), onlyPure ? '纯情绪子集' : 'dragons')}
        ${stat('最高连板', fmtInt(maxLb), 'max(lb)')}
        ${stat('纯情绪炒作', fmtInt(pure), 'is_pure_sentiment')}
        ${stat('纯情绪占比', pct((pure / sorted.length) * 100), `${pure}/${sorted.length}`)}
      </div>`, 't-c12'));

    // 连板高度分布（阶梯柱；按连板数聚合计数，引擎原值）
    const byLb = {};
    for (const x of sorted) { const k = +x.lb || 0; byLb[k] = (byLb[k] || 0) + 1; }
    // ⚠ X 轴必须**固定枚举** 1–6 板（极端行情延展到更高板），缺失补 0；
    //   绝不能按「当前有的数据」直接映射——否则缺 4 板时 5 板会被挤到 4 板位置（张冠李戴）。
    const maxLbAxis = Math.max(6, ...Object.keys(byLb).map(Number));
    const dist = [];
    for (let k = 1; k <= maxLbAxis; k++) dist.push({ date: `${k}板`, a: byLb[k] || 0 });
    g.appendChild(panel('连板高度分布', `按连板数聚合计数 · 引擎原值${subKey}`,
      barChart(dist, { w: 900, h: 180, legend: ['只数', ''], k: '连板高度分布', xLabels: 'all' }), 't-c12'));

    // 连板天梯表 —— 点任一票 → LINK 总线 → 打开个股详情抽屉（K 线 + AI 判词 + 排雷）
    const rows = sorted.map((x) => {
      const rs = String(x.reason || '—');
      const conf = x.confidence != null ? x.confidence * 100 : null;
      // 风险等级配色（展示性分档，不重算）：≥80% 血红 · ≥60% 暗黄 · 其余默认
      const confCls = conf == null ? '' : conf >= 80 ? 'is-crit' : conf >= 60 ? 'is-warn' : '';
      return `<tr data-code="${esc(x.code)}" data-name="${esc(x.name || '')}">
        <td>${esc(x.code)}</td>
        <td>${esc(x.name || '—')}</td>
        <td class="up">${fmtInt(x.lb)}</td>
        <td>${esc(x.hybk || '—')}</td>
        <td>${x.is_pure_sentiment ? '<span class="t-tag-ai">纯情绪</span> ' : ''}${esc(x.logic_type || '—')}</td>
        <td class="${confCls}">${pct(conf, 0)}</td>
        <td class="${confCls}" title="${esc(rs)}">${esc(rs.length > 22 ? `${rs.slice(0, 22)}…` : rs)}</td>
      </tr>`;
    }).join('');

    const tblPanel = panel('连板天梯', '按连板数降序 · 点任一票看个股详情',
      `<div class="t-tbl-wrap"><table class="t-tbl"><thead><tr>
        <th>代码</th><th>名称</th><th>连板</th><th>行业</th><th>逻辑</th><th>置信</th><th>理由</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`, 't-c12');
    g.appendChild(tblPanel);
    // 在 tblPanel 内查（与 viewPaper 同款修正：勿用 outerHTML 替换后的节点查 parentElement）
    $('.t-tbl', tblPanel).addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-code]');
      if (tr) LINK.set({ code: tr.dataset.code, name: tr.dataset.name });
    });

    return g;
  }

  // ── 6e. 视图：K线（独立视图；与抽屉共用 renderKline，周期规则同一套）────
  function viewKline() {
    const g = el('div', 't-grid');
    const cur = (LINK.sel && LINK.sel.code) ? String(LINK.sel.code) : '';
    const curName = (LINK.sel && LINK.sel.name) ? String(LINK.sel.name) : '';

    const p1 = panel('个股 K 线', '输入 6 位代码，或从「选股 / 模拟盘」点任一票跳转',
      `<div class="t-kbar">
        <label>代码 <input class="t-kcode" type="text" inputmode="numeric" maxlength="6"
          placeholder="如 600000" value="${esc(cur)}" aria-label="股票代码"></label>
        <button class="t-kgo" type="button">查询</button>
        <span class="t-khint">${esc(curName)}</span>
      </div>
      <div class="t-khost"><div class="t-empty">${cur ? '加载中…' : '请输入代码，或从「选股 / 模拟盘」点任一票跳转过来'}</div></div>`,
      't-c12');
    g.appendChild(p1);

    const host = $('.t-khost', p1);
    viewKHost = host;
    const input = $('.t-kcode', p1);
    const load = () => {
      const code = String(input.value || '').trim();
      if (!/^\d{6}$/.test(code)) {
        host.innerHTML = '<div class="t-empty">请输入 6 位数字代码（如 600000）</div>';
        return;
      }
      viewKState.k = null;
      renderKline(host, code, viewKState);
    };
    $('.t-kgo', p1).addEventListener('click', load);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
    if (/^\d{6}$/.test(cur)) renderKline(host, cur, viewKState);

    return g;
  }

  // ── 7. 视图：模拟盘 ────────────────────────────────────────────────────
  //   数据：data/paper/account.json（引擎与 paper_daily 落盘，终端只读）。
  //   纪律：**一律展示已落盘原值**，零新增计算——
  //     · 总资产/持仓市值取 nav 末条的 equity/marketValue（引擎算好的口径），
  //       绝不自己拼「现金 + 市值 + 冻结」合并式（口径归属引擎，展示层不抢）；
  //     · 唯一例外是「累计收益率」这类**占比现算**，已在副标题标注口径来源。
  //   徽标语义与 src/paper.js 的 STAGE / RESULT 同义（防漂移，改那边要同步这里）。
  const LOG_STAGE = { lhb: '龙虎过滤', risk: '风控', order: '委托', settle: '结算', stop: '止损', glm: 'AI预检' };
  const LOG_RESULT = { pass: '通过', rejected: '拒绝', submitted: '已报送', info: '提示' };
  const RES_CLS = { pass: 'is-pass', rejected: 'is-no', submitted: 'is-sub', info: 'is-info' };

  async function viewPaper() {
    const g = el('div', 't-grid');
    const a = (await jget(durl('data/paper/account.json'))) || {};

    // ── ① 账户概览（原值直出）──
    const nav = a.nav || [];
    const last = nav[nav.length - 1] || {};
    const wan0 = (v) => (v == null || !Number.isFinite(+v)) ? '—' : `${(+v / 10000).toFixed(2)} 万`;
    const cum = (last.equity != null && a.initCash) ? ((last.equity - a.initCash) / a.initCash) * 100 : null;
    g.appendChild(panel('账户概览', `结算日 ${esc(a.lastSettle || '—')} · 起始 ${esc(a.startDate || '—')}`,
      `<div class="t-stats">
        ${stat('总资产（净值）', wan0(last.equity), `account.nav[].equity · ${esc(last.date || '—')}`, 'is-acc')}
        ${stat('持仓市值', wan0(last.marketValue), 'nav[].marketValue')}
        ${stat('可用现金', wan0(a.cash), 'account.cash')}
        ${stat('冻结资金', wan0(a.freeze), '待成交占用 · account.freeze')}
        ${stat('期初资金', wan0(a.initCash), 'account.initCash')}
        ${stat('累计收益率', cum == null ? '—' : sgn(cum, 2), cum == null ? '—' : '（净值−期初）/期初 · 展示层现算')}
        ${stat('已实现盈亏', wan0(a.realized), 'account.realized')}
        ${stat('累计费用', wan0(a.totalFee), 'account.totalFee（佣金+印花+过户）')}
      </div>`, 't-c12'));

    // ── ② 净值曲线 + 持仓 ──
    const initCash = a.initCash != null ? a.initCash : 1000000;
    let navBody;
    if (nav.length > 1) {
      // 用 equity 真实域（lineChart 默认 0–100 是情绪分专用，净值百万级必须传 vMin/vMax）
      const eqs = nav.map((r) => r.equity);
      const vMin = Math.min(...eqs), vMax = Math.max(...eqs);
      const pad = (vMax - vMin) * 0.12 || 1;
      navBody = lineChart(nav.map((r) => ({ date: String(r.date).slice(5), v: r.equity })), { w: 640, h: 210, vMin: vMin - pad, vMax: vMax + pad, n: '净值曲线' });
    } else {
      // 空态：画一条 100 万平坦红线 + 标注，看着像交易终端而非「报错」
      navBody = lineChart([{ date: '—', v: initCash }, { date: '初始化', v: initCash }, { date: '等待结算', v: initCash }],
        { w: 640, h: 210, vMin: initCash - 1, vMax: initCash + 1, lineColor: '#ff5a4d', noArea: true, n: '净值曲线' })
        + `<div class="t-dnote is-ok">初始化等待首个交易日结算 · 基准 ${wan(initCash)}（红线）</div>`;
    }
    const navPanel = panel('模拟盘净值', `account.nav 序列 · ${nav.length} 个交易日`, navBody, 't-c8');
    const pos = Object.values(a.positions || {}).filter((p) => p && p.qty > 0);
    const posPanel = panel('持仓', '点行看个股详情', !pos.length ? '<div class="t-empty">当前空仓</div>'
      : `<div class="t-tbl-wrap"><table class="t-tbl"><thead><tr><th>标的</th><th>持仓</th><th>成本</th><th>浮亏</th><th>占比</th></tr></thead><tbody>${
        pos.map((p) => {
          const pnl = p.last != null && p.avgCost ? ((p.last - p.avgCost) / p.avgCost) * 100 : null;
          return `<tr data-code="${esc(p.code)}" data-name="${esc(p.name || p.code)}">
            <td>${esc(p.name || p.code)}<div class="t-code">${esc(p.code)}</div></td>
            <td>${fmtInt(p.qty)}</td><td>${fmt(p.avgCost, 2)}</td>
            <td class="${pnl == null ? 'mut' : pnl >= 0 ? 'up' : 'dn'}">${pnl == null ? '—' : sgn(pnl, 2)}</td>
            <td>${a.initCash && p.cost ? pct(p.cost / a.initCash, 1) : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>`, 't-c4');
    g.appendChild(navPanel); g.appendChild(posPanel);
    if (pos.length) {
      $('.t-tbl', posPanel).addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-code]'); if (tr) LINK.set({ code: tr.dataset.code, name: tr.dataset.name });
      });
    }

    // ── ③ 待成交委托（pending：已下单未结算，资金被冻结中）──
    const pend = a.pending || [];
    const pendPanel = panel('待成交委托', `${pend.length} 笔 · 资金冻结 ${wan0(a.freeze)}`,
      !pend.length ? '<div class="t-empty">无待成交委托</div>'
        : `<div class="t-tbl-wrap"><table class="t-tbl"><thead><tr>
            <th>标的</th><th>方向</th><th>数量</th><th>报单价</th><th>预估成交</th><th>预估费用</th><th>需款</th><th>滑点</th><th>原因</th>
          </tr></thead><tbody>${
        pend.map((o) => `<tr data-code="${esc(o.code)}" data-name="${esc(o.name || o.code)}">
            <td>${esc(o.name || o.code)}<div class="t-code">${esc(o.code)}</div></td>
            <td class="${o.side === 'sell' ? 'dn' : 'up'}">${o.side === 'sell' ? '卖出' : '买入'}</td>
            <td>${fmtInt(o.qty)}</td><td>${fmt(o.submitPrice, 2)}</td>
            <td>${fmt(o.estPrice, 2)}</td><td>${fmt(o.estFee, 2)}</td>
            <td>${fmt(o.need, 2)}</td><td>${pct(o.slip != null ? o.slip * 100 : null, 2)}</td>
            <td title="${esc(o.reason || '')}">${esc(String(o.reason || '—').slice(0, 18))}</td>
          </tr>`).join('')}</tbody></table></div>`, 't-c12');
    g.appendChild(pendPanel);
    if (pend.length) {
      $('.t-tbl', pendPanel).addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-code]'); if (tr) LINK.set({ code: tr.dataset.code, name: tr.dataset.name });
      });
    }

    // ── ④ 决策日志（下单链路留痕：龙虎过滤 → 风控 → AI预检 → 委托）──
    //   ⚠ stage=glm 即 GLM 三合一守卫的执行留痕 → 与全站约定一致，**紫色**标注。
    const logs = (a.logs || []).slice().sort((x, y) => (+y.ts || 0) - (+x.ts || 0));
    const logPanel = panel('决策日志', `最近 ${logs.length} 条 · ${esc(a.lastSettle || '')} 当日全链路留痕`,
      !logs.length ? '<div class="t-empty">当日无决策日志</div>'
        : `<div class="t-tbl-wrap"><table class="t-tbl"><thead><tr>
            <th>时间</th><th>标的</th><th>环节</th><th>结论</th><th>判词 / 原因</th>
          </tr></thead><tbody>${
        logs.map((r) => {
          const tm = r.ts ? new Date(+r.ts).toTimeString().slice(0, 8) : '—';
          const txt = String(r.text || r.reason || '—');
          return `<tr data-code="${esc(r.code || '')}" data-name="${esc(r.name || '')}">
            <td class="mut">${esc(tm)}</td>
            <td>${esc(r.name || '—')}<div class="t-code">${esc(r.code || '—')}</div></td>
            <td>${r.stage === 'glm' ? '<span class="t-tag-ai">AI预检</span>' : `<span class="t-log-tag">${esc(LOG_STAGE[r.stage] || r.stage || '—')}</span>`}</td>
            <td><span class="t-res ${RES_CLS[r.result] || 'is-info'}">${esc(LOG_RESULT[r.result] || r.result || '—')}</span></td>
            <td title="${esc(txt)}">${esc(txt.length > 46 ? `${txt.slice(0, 46)}…` : txt)}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`, 't-c12');
    g.appendChild(logPanel);
    // ⚠ 空日志时面板里没有 .t-tbl（是空态 div），直接取会拿到 null → addEventListener 抛 TypeError。
    //   必须判空后再挂，否则「当日无决策日志」这种正常状态会把整个视图带崩。
    if (logs.length) {
      $('.t-tbl', logPanel).addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-code]');
        if (tr && tr.dataset.code) LINK.set({ code: tr.dataset.code, name: tr.dataset.name });
      });
    }

    return g;
  }

  // ── 8. K线抽屉（全站唯一真磨砂玻璃件）─────────────────────────────────
  let drawerRefs = null;
  const drawerKState = { period: 'day', k: null };   // 抽屉的周期选择（跨开关保持）
  // 视图 K线的周期选择（跨视图切换保持，与抽屉同款语义）；redraw 由 renderKline 注入
  const viewKState = { period: 'day', k: null };
  let viewKHost = null;

  // 代码归一：'600000' / 'sh600000' / '600000.SH' 都收敛到 6 位纯数字，
  //   用于三份档之间的关联匹配（侧车 / 黑名单 / 账户持仓）——只做**匹配**，不改任何值。
  const normCode = (c) => String(c == null ? '' : c).replace(/\D/g, '').slice(-6);

  // ── 8b. 个股详情块（抽屉内，K 线之上）───────────────────────────────────
  //   纪律：全部取自**已落盘的引擎/侧车产物**，零新增计算、零反推：
  //     · 妖股逻辑（紫）← signals.dragonLogic.dragons（GLM 侧车方向 C）
  //     · 夜间排雷（红）← data/llm_risk_blacklist.json（GLM 侧车方向 A）
  //     · 模拟盘持仓     ← data/paper/account.json
  //   fail-open：任一档缺失/解析失败 → 该块如实显示「无记录」，绝不报错、绝不占位。
  function renderDetail(host, rawCode) {
    const code = normCode(rawCode);
    const S = window.__SIGNALS__ || {};
    const dl = S.dragonLogic || {};
    const dg = (Array.isArray(dl.dragons) ? dl.dragons : []).find((x) => normCode(x.code) === code);

    // ① 日终快照（EOD 定稿）：取自该股 K线分片最后一根（与下方 K线 100% 同源），
    //   ⚠ 不再依赖盘中快照档；收盘价 严格等于 K线 最后一根收盘价，绝不编造。
    //   仅含活跃标的，不在名单内 → 如实「无盘口」，不占位。

    // ① 妖股逻辑（同步可得：signals 已在内存）
    const dragonBody = dg
      ? `<div class="t-dkv">
          <div><span class="t-dk">连板</span><span class="t-dv"><b>${fmtInt(dg.lb)}</b> 板</span></div>
          <div><span class="t-dk">行业</span><span class="t-dv">${esc(dg.hybk || '—')}</span></div>
          <div><span class="t-dk">逻辑</span><span class="t-dv">${dg.is_pure_sentiment ? '<span class="t-tag-ai">纯情绪</span> ' : ''}${esc(dg.logic_type || '—')}</span></div>
          <div><span class="t-dk">置信</span><span class="t-dv">${pct(dg.confidence != null ? +dg.confidence * 100 : null, 0)}</span></div>
        </div>
        <div class="t-dnote">${esc(String(dg.reason || '—'))}</div>`
      : `<div class="t-dnone">不在当日连板梯队名单内（侧车当日扫描 ${fmtInt(dl.scanned || 0)} 只）→ 无 GLM 涨停逻辑判词</div>`;
    const srcLine = `<div class="t-dsrc">来源 GLM ${esc(dl.model || '—')} · asOf ${esc(dl.asOfDate || '—')} · 仅参考，不改引擎情绪分 / regime</div>`;

    host.innerHTML = `<section class="t-dsec is-snap" data-sec="snap">
        <div class="t-dsec-h">📈 盘口快照</div>
        <div class="t-dsec-b"><span class="t-mut">读取中…</span></div>
      </section>
      <section class="t-dsec is-ai">
        <div class="t-dsec-h">🕵 妖股逻辑推演<span class="t-dsec-tag">AI Side-car</span></div>
        <div class="t-dsec-b">${dragonBody}${srcLine}</div>
      </section>
      <section class="t-dsec is-risk" data-sec="risk">
        <div class="t-dsec-h">☠ GLM 夜间排雷</div>
        <div class="t-dsec-b"><span class="t-mut">读取中…</span></div>
      </section>
      <section class="t-dsec is-pos" data-sec="pos">
        <div class="t-dsec-h">💼 模拟盘持仓</div>
        <div class="t-dsec-b"><span class="t-mut">读取中…</span></div>
      </section>`;

    // ②③④ 异步三档（盘口 / 黑名单 / 账户），失败各自降级；抽屉已切票则丢弃结果（防串台）
    // 盘口快照：日终静态定稿，直接取自该股 K线分片最后一根 —— 与下方 K线 100% 同源对齐，绝不复用任何假样本。
    const _cc = String(code).replace(/^(sh|sz|bj)/, '');
    const _prefix = /^(6|9)/.test(_cc) ? 'sh' : /^(4|8)/.test(_cc) ? 'bj' : 'sz';
    jget(durl(`ui/kline/${_prefix}${_cc}.json`)).then((k) => {
      if (!host.isConnected) return;
      const secS = $('[data-sec="snap"] .t-dsec-b', host);
      if (!secS) return;
      const bars = (k && Array.isArray(k.bars)) ? k.bars : [];
      if (!bars.length) {
        secS.innerHTML = '<div class="t-dnone">暂无该股日终快照（K线分片仅覆盖历史上榜股）</div>';
        return;
      }
      const last = bars[bars.length - 1];
      const prev = bars.length > 1 ? bars[bars.length - 2] : null;
      const [, o, c, h, l] = last;
      const prevClose = prev ? prev[2] : o;                       // 昨收 = 上一交易日收盘（日K 连续）
      const chgPct = (prevClose && prevClose !== 0) ? ((c - prevClose) / prevClose) * 100 : null;
      const up = (chgPct == null) ? (c >= o) : chgPct >= 0;
      const dstr = String(last[0]);
      // 收盘价 c 即 K线 最后一根收盘价 → 下方蜡烛收价 100% 相等（同源，无编造）
      secS.innerHTML = `<div class="t-dbase">数据基准：${esc(dstr)}（已定稿收盘价）</div>`
        + `<div class="t-dkv">
            <div><span class="t-dk">收盘价</span><span class="t-dv">${fmt(c, 2)}</span></div>
            <div><span class="t-dk">涨跌</span><span class="t-dv ${up ? 'up' : 'dn'}">${chgPct == null ? '—' : sgn(chgPct, 2)}</span></div>
            <div><span class="t-dk">最高</span><span class="t-dv">${fmt(h, 2)}</span></div>
            <div><span class="t-dk">最低</span><span class="t-dv">${fmt(l, 2)}</span></div>
            <div><span class="t-dk">昨收</span><span class="t-dv">${fmt(prevClose, 2)}</span></div>
          </div>
          <div class="t-dsrc">日终静态定稿 · 取自 K线分片最后一根（与下方 K线 100% 同源，收盘价完全一致）</div>`;
    }).catch(() => {
      const secS = $('[data-sec="snap"] .t-dsec-b', host);
      if (secS) secS.innerHTML = '<div class="t-dnone">K线分片读取失败 → 不显示日终快照（fail-open）</div>';
    });

    Promise.all([jget(durl('data/llm_risk_blacklist.json')), jget(durl('data/paper/account.json'))])
      .then(([bl, acct]) => {
        if (!host.isConnected) return;
        const secR = $('[data-sec="risk"] .t-dsec-b', host);
        const secP = $('[data-sec="pos"] .t-dsec-b', host);

        // ② 排雷黑名单
        const hit = (bl && Array.isArray(bl.blacklist) ? bl.blacklist : []).find((x) => normCode(x.code) === code);
        if (secR) {
          if (hit) {
            const lv = String(hit.riskLevel || '').toLowerCase();
            const rss = Array.isArray(hit.reasons) ? hit.reasons : [];
            secR.innerHTML = `<div class="t-dhit is-${esc(lv || 'medium')}">
                <span class="t-dlv">${lv === 'high' ? '高风险' : lv === 'low' ? '低风险' : '中风险'}</span>
                ${rss.length ? `<span class="t-dtags">${rss.map((r) => `<span class="t-dtag">${esc(r)}</span>`).join('')}</span>` : ''}
              </div>
              <div class="t-dnote">${esc(String(hit.evidence || '—'))}</div>
              <div class="t-dsrc">asOf ${esc(bl.asOfDate || '—')} · 扫描 ${fmtInt(bl.scanned || 0)} 只 · 已接入自动建仓前拦截（paper_daily 第 5 步）</div>`;
          } else if (!bl) {
            secR.innerHTML = '<div class="t-dnone">排雷档缺失（未生成或读取失败）→ 不打标、不拦截（fail-open）</div>';
          } else {
            secR.innerHTML = `<div class="t-dnone is-ok">未命中黑名单（已扫描 ${fmtInt(bl.scanned || 0)} 只 · asOf ${esc(bl.asOfDate || '—')}）</div>`;
          }
        }

        // ③ 模拟盘持仓
        const pos = (acct && acct.positions) || {};
        const p = Object.values(pos).find((x) => x && normCode(x.code) === code);
        if (secP) {
          if (!acct) secP.innerHTML = '<div class="t-dnone">账户档缺失（读取失败）→ 不显示持仓</div>';
          else if (!p || !(p.qty > 0)) secP.innerHTML = '<div class="t-dnone">当前未持有该标的</div>';
          else {
            const pnl = p.last != null && p.avgCost ? ((p.last - p.avgCost) / p.avgCost) * 100 : null;
            secP.innerHTML = `<div class="t-dkv">
                <div><span class="t-dk">持股</span><span class="t-dv"><b>${fmtInt(p.qty)}</b> 股</span></div>
                <div><span class="t-dk">成本</span><span class="t-dv">${fmt(p.avgCost, 3)}</span></div>
                <div><span class="t-dk">现价</span><span class="t-dv">${fmt(p.last, 2)}</span></div>
                <div><span class="t-dk">浮盈亏</span><span class="t-dv ${pnl == null ? '' : pnl >= 0 ? 'up' : 'dn'}">${pnl == null ? '—' : sgn(pnl, 2)}</span></div>
            </div>`;
          }
        }
      })
      .catch(() => {
        const secR = $('[data-sec="risk"] .t-dsec-b', host);
        const secP = $('[data-sec="pos"] .t-dsec-b', host);
        if (secR) secR.innerHTML = '<div class="t-dnone">读取失败 → 不打标、不拦截（fail-open）</div>';
        if (secP) secP.innerHTML = '<div class="t-dnone">读取失败 → 不显示持仓</div>';
      });
  }

  function openDrawer(code, name) {
    if (!code) return;
    let refs = drawerRefs;
    if (!refs) {
      const mask = el('div', 't-drawer-mask');
      const dw = el('aside', 't-drawer');
      dw.innerHTML = `<div class="t-drawer-h"><span class="t-dn-name"></span><span class="t-dn-code"></span><button class="t-close" aria-label="关闭">✕</button></div><div class="t-drawer-b"></div>`;
      document.body.appendChild(mask); document.body.appendChild(dw);
      refs = { mask, dw, name: $('.t-dn-name', dw), code: $('.t-dn-code', dw), body: $('.t-drawer-b', dw) };
      const close = () => { mask.classList.remove('is-open'); dw.classList.remove('is-open'); LINK.set({ code: null }); document.body.style.overflow = ''; };
      $('.t-close', dw).addEventListener('click', close);
      mask.addEventListener('click', close);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      drawerRefs = refs;
    }
    refs.name.textContent = name || code;
    refs.code.textContent = code;
    // 上半：个股详情（AI 判词 / 排雷 / 持仓）；下半：K 线（与 K线视图共用渲染器）
    refs.body.innerHTML = '<div class="t-ddet"></div><div class="t-dkhost"></div>';
    refs.mask.classList.add('is-open');
    refs.dw.classList.add('is-open');
    document.body.style.overflow = 'hidden';   // 抽屉打开：锁背景滚动，关闭时解锁
    SAFE(() => renderDetail($('.t-ddet', refs.body), code), 'drawer-detail');
    renderKline($('.t-dkhost', refs.body), code, drawerKState);
  }

  // ── 9. 挂载与视图切换 ─────────────────────────────────────────────────
  // 「研报」不列为终端内视图：① 方向已定「不想要报告型」；② 终端为整屏覆盖层，
  //   顶栏「📄 研报」按钮（switchTo('report') 把 #tRoot 重新 hidden）即可退回原研报
  //   视图（含复制全文/导出文档/打印PDF/导出CSV），在终端里再塞一份研报属重复。
  //   故终端内共 7 个视图，无占位；顶栏右上角不再保留无意义的「⚡终端」自切换钮。
  const VIEWS = [
    { k: 'overview', n: '总览' },
    { k: 'zt', n: '涨跌停' },
    { k: 'fund', n: '资金' },
    { k: 'sector', n: '板块' },
    { k: 'picks', n: '选股' },
    { k: 'paper', n: '模拟盘' },
    { k: 'kline', n: 'K线' },
  ];

  function mount() {
    const root = $('#tRoot');
    if (!root) return;
    root.className = 't-scope';
    root.hidden = true;
    bindTip(root);   // 图表交互：统一 tooltip 浮窗 + 事件委托（hover/点击锁定/移动端触摸）

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
      <span>regime 序列 <b>${((S.regime && S.regime.seriesCompact) || []).length}</b> 日</span><span class="t-sep">│</span>
      <span class="t-range" role="group" aria-label="时间窗">窗
        ${RANGES.map((r) => `<button type="button" data-r="${r}"${r === LINK.sel.range ? ' class="is-on"' : ''}>${r}</button>`).join('')}
      </span>
      <span class="t-regime-badge" id="tRegime">regime —</span>
      <span class="t-viewswitch">
        <button data-v="report" class="is-on">📄 研报</button>
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
        else if (k === 'picks') node = viewPicks(S);
        else if (k === 'kline') node = viewKline();
        else if (k === 'paper') node = await viewPaper();   // 异步视图必须 await，否则拿到 Promise 而非 Node
      } catch (e) { console.error('[terminal] render', k, e); node = null; }
      if (!node || !(node instanceof Node)) {
        node = el('div', 't-panel t-c12', `<div class="t-empty">「${esc(k)}」视图数据已就绪，下期接入。<br>终端外壳 / 设计令牌 / 图表助手（折线·柱状·仪表·K线）/ 联动总线均已就绪——加面板即可。</div>`);
      }
      body.innerHTML = '';
      // 视图标题条：滚动时钉在 sticky 顶栏正下方，始终显示当前视图名（总览/涨跌停/…）
      const vhMeta = VIEWS.find((v) => v.k === k);
      const viewHead = el('div', 't-viewhead', `<span class="t-vh-name">${esc(vhMeta ? vhMeta.n : k)}</span>`);
      viewHead.style.top = (top.offsetHeight || 44) + 'px';
      body.appendChild(viewHead);
      body.appendChild(node);
      const reg = (S.regime && S.regime.latest) || {};
      // ⚠ t-tk-lbl 原用字符 '›'（U+203A），在 Windows 字体下渲染得极像逗号/顿号，
      //   用户反馈「情绪分左边多了个逗号」。改为**空的 CSS 实心竖条**（见 terminal.css），
      //   不再是字符，绝不会被误认成任何标点。
      tick.innerHTML = `<span class="t-tk-lbl" aria-hidden="true"></span><span class="t-tk-body">情绪分 <b>${fmt(L.value)}</b>（分位 ${pct(L.pct_rank, 0)}）· regime <b>${esc(reg.label || '—')}</b> · 涨停 <b>${fmtInt(L.zt_count)}</b> / 跌停 <b>${fmtInt(L.dt_count)}</b> · 点持仓行可下钻日K</span>`;
      // 顶栏 regime 徽章（带高光边框 + 半透明底，按 regime 着色；render 每次刷新）
      const rb = top.querySelector('#tRegime');
      if (rb) {
        const b = REGIME_BADGE[reg.key] || REGIME_BADGE.unknown;
        rb.textContent = `regime ${reg.label || '—'}`;
        rb.style.color = b.c; rb.style.background = b.bg; rb.style.borderColor = b.bd;
      }
    };

    // 视图函数里的跨视图跳转（总览「妖股纯情绪」→ 选股；选股筛选切换）走这里
    goView = render;

    VIEWS.forEach((v) => {
      const b = el('button', v.soon ? 't-nav-soon' : '', esc(v.n) + (v.soon ? ' ·' : ''));
      b.dataset.v = v.k;
      b.addEventListener('click', () => render(v.k));
      nav.appendChild(b);
    });
    nav.appendChild(el('span', 't-nav-hint', '快捷键 1–7 切视图 · Esc 关抽屉'));

    const switchTo = (v) => {
      const term = v === 'terminal';
      root.hidden = !term;
      // 终端视图允许整体竖向滚动（矮屏/窄屏内容多时可见底部），不再锁 body 滚动
      document.body.style.overflow = '';
      if (term) render(cur);
    };
    top.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      [...$('.t-viewswitch', top).children].forEach((x) => x.classList.toggle('is-on', x === b));
      switchTo(b.dataset.v);
    });

    // 时间窗切换：只改「取多少天来画」，随后重绘当前视图
    //   （不重算指标、不改判阈值；订阅 LINK 的其它部件也会一并收到通知）
    $('.t-range', top).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      const r = +b.dataset.r;
      if (!Number.isFinite(r) || r === LINK.sel.range) return;
      [...$('.t-range', top).children].forEach((x) => x.classList.toggle('is-on', +x.dataset.r === r));
      LINK.set({ range: r });
      SAFE(() => render(cur), 'render-range');
    });

    // ── 键盘快捷键（桌面端）──
    //   1–7：切到对应视图（与左侧导航顺序一致）；Esc：关抽屉（抽屉自身已绑 Esc，这里交还不重复）。
    //   ⚠ 焦点在输入框/文本域/可编辑区，或带 meta/ctrl/alt 修饰时**绝不拦截**——否则与 K线代码输入、
    //     浏览器快捷键冲突。切视图前若抽屉浮层开着，先关抽屉（移除 is-open + LINK.set code:null），
    //      避免浮层压在切换后的视图之上。
    document.addEventListener('keydown', (e) => {
      if (root.hidden) return;                              // 仅终端可见时响应（研报视图下不误触发）
      const t = e.target;
      // 焦点在输入框/文本域/下拉/可编辑区时不拦截（不抢 K线代码输入、下拉原生 ←/→、浏览器快捷键）
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') return;                       // 抽屉已独立处理 Esc
      const n = parseInt(e.key, 10);
      if (!(n >= 1 && n <= VIEWS.length)) {
        // 非数字键：处理 K线周期 ←/→ 切换（仅 K线视图或抽屉 K线可见时）
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const useDrawer = drawerRefs && drawerRefs.dw.classList.contains('is-open');
          const st = useDrawer ? drawerKState : viewKState;
          if (!st || !st.redraw) return;
          const i = PERIODS.findIndex((p) => p.k === st.period);
          const ni = e.key === 'ArrowRight' ? Math.min(PERIODS.length - 1, i + 1) : Math.max(0, i - 1);
          if (ni === i) return;
          st.period = PERIODS[ni].k;
          st.redraw();
        }
        return;
      }
      const v = VIEWS[n - 1];
      if (drawerRefs && drawerRefs.dw.classList.contains('is-open')) {
        drawerRefs.mask.classList.remove('is-open');
        drawerRefs.dw.classList.remove('is-open');
        LINK.set({ code: null });
      }
      SAFE(() => render(v.k), 'render-key');
    });

    root.appendChild(top); root.appendChild(nav); root.appendChild(body); root.appendChild(tick);

    // 入口按钮（挂在研报页顶部，点击 → 整屏覆盖层切到终端；关闭由终端顶栏「📄 研报」负责）
    const entry = el('button', '', '⚡ 图表终端');
    entry.style.cssText = 'position:fixed;top:8px;right:12px;z-index:9998;font:inherit;font-size:12px;'
      + 'padding:8px 13px;border-radius:8px;cursor:pointer;color:#22d3ee;background:rgba(11,15,22,.92);'
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
    }

    render('overview');
    console.log('[terminal] 研究工作台已就绪（覆盖层挂载，不影响研报视图）');
  }

  // signals-latest 载入后再挂载（读一次，缓存）；失败也挂载（空态降级）
  jget('data/signals-latest.json').then((S) => { window.__SIGNALS__ = S || {}; SAFE(mount, 'mount'); })
    .catch(() => { window.__SIGNALS__ = {}; SAFE(mount, 'mount'); });
})();
