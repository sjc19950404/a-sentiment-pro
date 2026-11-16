/* =============================================================
 * 门槛② 四档 CLS 采样验收工具（WorkBuddy 侧产出）
 * 契约：05册L722 / 07册§7.4 / 08册L238 / 06册L186
 *   - 四档视口：XS<640 / SM640-1023 / MD1024-1439 / LG>=1440（03册2.1）
 *   - 每档 >=3 次采样（同视口、独立导航），取中位数
 *   - 达标判据：中位数 <=0.10 且 最差值 <=0.10（单次达标不作数）
 *   - 观测窗口 5000ms（buffered:true），复用线上 S.collectCls() 保证与自检同口径
 *   - 单次抖动记录方差；layout-shift unsupported 记「未测」不当通过
 * 用法：node design/verify_cls_four_tiers.cjs [--runs=N]
 * 产物：design/assets/四档CLS采样.json
 * 边界：只读线上；不翻默认路由、不碰研报代码；仅产出观测期基线证据
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.dirname(__dirname);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://sjc19950404.github.io/a-sentiment-pro/';
const PORT = 10270;
const PROFILE = path.join(ROOT, '_cls4_profile_' + PORT + '_' + Date.now());
const OUT = path.join(__dirname, 'assets', '四档CLS采样.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const argRuns = process.argv.find(a => a.startsWith('--runs='));
const RUNS = argRuns ? Math.max(3, parseInt(argRuns.split('=')[1], 10) || 3) : 3;

// 四档视口基准（03册2.1）：XS 390x844 / SM 800x900 / MD 1280x800 / LG 1440x900
const TIERS = [
  { id: 'XS', label: 'XS <640', width: 390, height: 844 },
  { id: 'SM', label: 'SM 640-1023', width: 800, height: 900 },
  { id: 'MD', label: 'MD 1024-1439', width: 1280, height: 800 },
  { id: 'LG', label: 'LG >=1440', width: 1440, height: 900 },
];
const TARGET = 0.10;
const BASELINE = 0.174;

// 调用线上 S.collectCls()——与 s-selftest.js 同实现：5000ms 窗口 / buffered / 双档字段
// 同时用独立 observer 采集 sources 归因（不干扰 S.collectCls，各自独立实例）
const PROBE = `(() => {
  return new Promise(resolve => {
    if (!window.S || typeof S.collectCls !== 'function') {
      return resolve({ unavailable: true });
    }
    const sources = {}, seen = {};
    let srcObs = null;
    try {
      srcObs = new PerformanceObserver(list => list.getEntries().forEach(e => {
        if (e.hadRecentInput) return;
        const key = e.startTime + ':' + ((e.sources||[]).length);
        if (seen[key]) return; seen[key]=1;
        (e.sources||[]).slice(0,4).forEach(x => {
          const el = x.node; if (!el) return;
          const id = el.id ? '#'+el.id : '';
          const cls = (el.className && typeof el.className==='string')
            ? '.'+el.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
          const k = (el.tagName||'?').toLowerCase()+id+cls;
          sources[k] = Number(((sources[k]||0) + e.value).toFixed(4));
        });
      }));
      srcObs.observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
    S.collectCls().then(r => {
      if (srcObs) { try { srcObs.disconnect(); } catch(e){} }
      const top = Object.keys(sources).map(k=>({src:k,value:sources[k]}))
                    .sort((a,b)=>b.value-a.value).slice(0,5);
      resolve({
        value: r.value, sessions: r.sessions, target: r.target, baseline: r.baseline,
        pass: r.pass, degraded: r.degraded, note: r.note || null, topSources: top
      });
    });
  });
})()`;

function median(vals) {
  const s = vals.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

(async () => {
  const report = {
    stamp: new Date().toISOString(),
    contract: {
      source: '05册L722 / 07册§7.4 / 08册L238 / 06册L186',
      tiers: '03册2.1 四档断点',
      runsPerTier: RUNS,
      windowMs: 5000,
      collectFn: 'S.collectCls()（线上 s-selftest.js 同口径）',
      passRule: '每档 中位数<=0.10 且 最差值<=0.10；layout-shift unsupported 记未测',
      target: TARGET, baseline: BASELINE
    },
    tiers: [], verdict: null
  };
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--no-proxy-server', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  try {
    let ver = null;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
      await sleep(300);
    }
    if (!ver) throw new Error('CDP 未启动');
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pend = new Map();
    ws.onmessage = ev => {
      let s = ev.data; if (typeof s !== 'string') s = Buffer.from(s).toString('utf8');
      const m = JSON.parse(s);
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    };
    const cmd = (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq; pend.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error(method + ' 超时')); } }, 45000);
    });
    const evaluate = async expr => {
      const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + (r.exceptionDetails.exception ? ': ' + (r.exceptionDetails.exception.description || '') : ''));
      return r.result.value;
    };
    await cmd('Network.enable');
    await cmd('Network.setCacheDisabled', { cacheDisabled: true });
    await cmd('Page.enable');

    // 预热：清 SW 干扰后首载一次
    await cmd('Page.navigate', { url: BASE + '?_warm=' + Date.now() });
    await sleep(2500);

    for (const tier of TIERS) {
      await cmd('Emulation.setDeviceMetricsOverride', {
        width: tier.width, height: tier.height, deviceScaleFactor: 1, mobile: false
      });
      const t = { id: tier.id, label: tier.label, viewport: tier.width + 'x' + tier.height, runs: [], median: null, worst: null, best: null, variance: null, verdict: null, measured: 0 };
      for (let i = 0; i < RUNS; i++) {
        await cmd('Page.navigate', { url: BASE + '?_cls4=' + tier.id + '_' + i + '_' + Date.now() });
        // 等 S.collectCls 就绪（最多 8s）
        let ready = false;
        for (let k = 0; k < 40; k++) {
          try { if (await evaluate(`!!(window.S && typeof S.collectCls === 'function')`)) { ready = true; break; } } catch (e) {}
          await sleep(200);
        }
        if (!ready) { t.runs.push({ i: i + 1, error: 'S.collectCls 未就绪' }); continue; }
        // 页面加载后稍等，让异步面板插入稳定，再开 5s 观测
        await sleep(1500);
        let r;
        try { r = await evaluate(PROBE); }
        catch (e) { t.runs.push({ i: i + 1, error: String(e.message || e) }); continue; }
        if (r && r.unavailable) { t.runs.push({ i: i + 1, note: '未测：collectCls 不可用' }); continue; }
        t.runs.push({
          i: i + 1, value: r.value, sessions: r.sessions, pass: r.pass, degraded: r.degraded,
          note: r.note || null,
          topSources: r.topSources
        });
        console.log(tier.id, 'run', i + 1, 'value=', r.value, 'pass=', r.pass, 'degraded=', r.degraded);
      }
      const vals = t.runs.map(x => x.value).filter(v => typeof v === 'number');
      t.measured = vals.length;
      if (vals.length) {
        const med = median(vals);
        t.median = Number(med.toFixed(4));
        t.worst = Math.max.apply(null, vals);
        t.best = Math.min.apply(null, vals);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        t.variance = Number((vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length).toFixed(6));
        // 判据：样本数达标 + 中位数<=target + 最差值<=target；unsupported 未测不计通过
        t.verdict = (vals.length >= 3 && t.median <= TARGET && t.worst <= TARGET) ? 'PASS' : 'FAIL';
      } else {
        t.verdict = 'UNMEASURED';
      }
      report.tiers.push(t);
    }
    const allPass = report.tiers.length === TIERS.length && report.tiers.every(t => t.verdict === 'PASS');
    const anyUnmeasured = report.tiers.some(t => t.verdict === 'UNMEASURED');
    report.verdict = allPass ? 'PASS' : (anyUnmeasured ? 'INCOMPLETE' : 'FAIL');
    report.summary = {
      tiersPassed: report.tiers.filter(t => t.verdict === 'PASS').length,
      tiersTotal: TIERS.length,
      medians: report.tiers.map(t => t.id + ':' + t.median),
      worsts: report.tiers.map(t => t.id + ':' + t.worst)
    };
  } catch (e) {
    report.verdict = 'ERROR'; report.error = String(e && e.message || e);
  } finally {
    try { child.kill(); } catch (e) {}
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log('\n=== verdict =', report.verdict, '===');
    if (report.summary) console.log(JSON.stringify(report.summary));
    if (report.error) console.error('ERROR:', report.error);
    console.log('产物:', OUT);
  }
})();
