/* =============================================================
 * 阶段 2 数据迟到时序探针（只读线上，零改动）
 * 目的：验证 data/*.json 分批到达时，工作台 6 KPI 是否会自动同步。
 *   s-page-overview.js 的 MutationObserver 只监听 #zone-overview；
 *   window.__signals（signals-latest.json，app.js:2573）与 #breadthPanel
 *   （在 #preMainPanels，不在 #zone-overview）的到达是否触发 sync，需实测。
 * 全程**不制造任何 DOM mutation**（区别于 verify_phase2_gates.cjs 的幂等测试）。
 * 用法：node design/verify_phase2_timing.cjs
 * 产物：design/assets/阶段2数据迟到时序.json
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const ROOT = path.dirname(DIR);
const ASSETS = path.join(DIR, 'assets');
const OUT = path.join(ASSETS, '阶段2数据迟到时序.json');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://sjc19950404.github.io/a-sentiment-pro/';
const PORT = 10237;
const PROFILE = path.join(ROOT, '_probe_p2t_' + PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SNAP = `(() => {
  const t = s => { const n = document.querySelector(s); return n ? n.textContent.trim() : null; };
  const bw = [...document.querySelectorAll('#breadthPanel .bw-kpi')]
    .map(e => (e.textContent || '').trim()).filter(x => /沪深上涨|沪深下跌/.test(x));
  return {
    tMs: Math.round(performance.now()),
    ready: document.readyState,
    arc: !!window.__lastArc,
    signals: !!window.__signals,
    regimeKey: (window.__signals && window.__signals.regime && window.__signals.regime.latest || {}).key || null,
    overview: !!document.querySelector('.s-page-overview'),
    kpi: {
      score: t('#sKpiScore'), regime: t('#sKpiRegime'), pos: t('#sKpiPos'),
      limit: t('#sKpiLimit'), breadth: t('#sKpiBreadth'), lhb: t('#sKpiLhb')
    },
    old: { emScore: t('#emScore'), emPct: t('#emPct'), emTier: t('#emTier'), emNet: t('#emNet') },
    breadthDom: bw,
    bodyView: document.body.dataset.view || ''
  };
})()`;

(async () => {
  const report = { time: new Date().toISOString(), base: BASE, samples: [], verdict: {}, errors: [] };
  if (!fs.existsSync(EDGE)) { console.error('未找到 Edge：' + EDGE); process.exitCode = 2; return; }
  const proxy = process.env.https_proxy || '';
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--allow-file-access-from-files', '--disable-background-networking',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1440,1000', 'about:blank'
  ];
  if (proxy) args.push('--proxy-server=' + proxy);
  const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
  try {
    let ver = null;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
      await sleep(300);
    }
    if (!ver) throw new Error('CDP 未启动（端口 ' + PORT + '）');
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pend = new Map();
    ws.onmessage = ev => {
      let s = ev.data;
      if (typeof s !== 'string') s = Buffer.from(s).toString('utf8');
      let m; try { m = JSON.parse(s); } catch (e) { return; }
      if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails && m.params.exceptionDetails.text);
      if (m.id && pend.has(m.id)) {
        const p = pend.get(m.id); pend.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
    const cmd = (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq; pend.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error(method + ' 超时')); } }, 25000);
    });
    const evaluate = async expr => {
      const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r && r.result && r.result.value;
    };
    await cmd('Page.enable'); await cmd('Runtime.enable');
    try { await cmd('Network.enable'); await cmd('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
    const waitFor = async (expr, timeoutMs) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try { if (await evaluate(expr)) return Date.now() - t0; } catch (e) {}
        await sleep(350);
      }
      return -1;
    };
    // 预热（丢弃）：绕开 SW 旧外壳，并等它真正就绪（全量回源可能 12s+）
    await cmd('Page.navigate', { url: BASE + '?_warmup=' + Date.now() });
    report.warmupReadyMs = await waitFor("!!(window.S && document.getElementById('sRoot'))", 30000);
    await sleep(1500);

    // 正式导航：先等 __lastArc 到达，再从那一刻起密集采样（关键窗口 = arc 已到、signals 未到）
    // 全程**不写任何 DOM**，因此 KPI 若变化只能来自 s-page-overview 自己的同步机制。
    await cmd('Page.navigate', { url: BASE + '?view=workbench&_timing=' + Date.now() });
    report.arcArrivalMs = await waitFor("!!window.__lastArc", 30000);
    const marks = [0, 300, 800, 1500, 2500, 4000, 6000, 9000, 13000, 18000];
    let prev = 0;
    for (const ms of marks) {
      await sleep(ms - prev); prev = ms;
      let s = null;
      try { s = await evaluate(SNAP); } catch (e) { report.errors.push('evaluate@' + ms + ': ' + e.message); }
      report.samples.push({ markMs: ms, state: s || null });
      console.log('\n--- arc+' + ms + 'ms ---\n' + JSON.stringify(s, null, 2));
    }

    const last = report.samples[report.samples.length - 1].state || {};
    const firstWithOverview = (report.samples.find(x => x.state && x.state.overview) || {}).state || {};
    const signalsArrived = report.samples.some(x => x.state && x.state.signals);
    const breadthDomArrived = report.samples.some(x => x.state && x.state.breadthDom && x.state.breadthDom.length >= 2);
    const firstSignals = report.samples.find(x => x.state && x.state.signals);
    report.verdict = {
      // 数据源是否都在观察窗口内到达
      warmup_ready_ms: report.warmupReadyMs,
      arc_arrival_ms: report.arcArrivalMs,
      signals_arrived: signalsArrived,
      signals_arrived_at_arc_plus_ms: firstSignals ? firstSignals.markMs : null,
      breadth_dom_arrived: breadthDomArrived,
      regime_at_arc_arrival: firstWithOverview.kpi && firstWithOverview.kpi.regime,
      // 关键：signals 到了之后，#sKpiRegime 是否自动从「未生成」变成真实状态
      regime_initial: firstWithOverview.kpi && firstWithOverview.kpi.regime,
      regime_final: last.kpi && last.kpi.regime,
      regime_auto_corrected: !!(firstWithOverview.kpi && firstWithOverview.kpi.regime === '未生成' &&
        last.kpi && last.kpi.regime !== '未生成'),
      regime_stuck_unknown: !!(signalsArrived && last.kpi && last.kpi.regime === '未生成'),
      // 涨/跌家数口径是否在加载过程中跳变（数据兜底 → DOM 实际值）
      breadth_initial: firstWithOverview.kpi && firstWithOverview.kpi.breadth,
      breadth_final: last.kpi && last.kpi.breadth,
      breadth_changed: !!(firstWithOverview.kpi && last.kpi &&
        firstWithOverview.kpi.breadth !== last.kpi.breadth),
      // V2-1 与旧视图始终一致（本探针无 mutation）
      score_matches_old_all_samples: report.samples.every(x => !x.state || !x.state.overview ||
        (x.state.kpi.score === x.state.old.emScore)),
      console_exceptions: report.errors.length
    };
    ws.close();
  } catch (e) {
    report.error = String(e.message || e);
    console.error('探针异常：' + report.error);
  } finally {
    try { child.kill(); } catch (e) {}
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
  if (!fs.existsSync(ASSETS)) fs.mkdirSync(ASSETS, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n===== 判定 =====\n' + JSON.stringify(report.verdict, null, 2));
  console.log('报告：' + OUT);
})();
