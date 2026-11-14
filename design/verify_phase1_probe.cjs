/* =============================================================
 * 阶段 1 补充探针（只读线上，零改动）
 * 目的：
 *   1. 定位 R2 门禁里 fatal:true / overflow:6 的真实来源（是真缺陷还是探针误判）
 *   2. 确认 ?view=workbench 下研报 <main> 是否真的被隐藏
 *   3. 记录 #sRoot 骨架、#tRoot、#preMainPanels 的渲染态
 * 用法：node design/verify_phase1_probe.cjs
 * 产物：design/assets/阶段1补充探针.json
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const ROOT = path.dirname(DIR);
const ASSETS = path.join(DIR, 'assets');
const OUT = path.join(ASSETS, '阶段1补充探针.json');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://sjc19950404.github.io/a-sentiment-pro/';
const PORT = 10233;
const PROFILE = path.join(ROOT, '_probe_p1_' + PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROBE = `(() => {
  const vis = e => !!e && !e.hasAttribute('hidden') &&
    getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' &&
    e.getClientRects().length > 0;
  const main = document.querySelector('main');
  const sRoot = document.getElementById('sRoot');
  const tRoot = document.getElementById('tRoot');
  const fatal = [...document.querySelectorAll('[data-fatal], #fatalHolder')].map(e => ({
    tag: e.tagName, id: e.id, hidden: e.hasAttribute('hidden'),
    display: getComputedStyle(e).display,
    text: (e.textContent || '').trim().slice(0, 90)
  }));
  const ov = [...document.querySelectorAll('body *')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.right > innerWidth + 2 &&
      getComputedStyle(e).position !== 'fixed' && e.scrollWidth <= e.clientWidth + 2;
  }).map(e => {
    const r = e.getBoundingClientRect();
    return { tag: e.tagName, id: e.id,
      cls: (e.className && e.className.toString().slice(0, 70)) || '',
      right: Math.round(r.right), width: Math.round(r.width),
      parentId: (e.parentElement && e.parentElement.id) || '',
      pos: getComputedStyle(e).position,
      overflowX: getComputedStyle(e).overflowX };
  });
  const pre = document.getElementById('preMainPanels');
  return {
    href: location.href,
    bodyView: document.body.dataset.view || '',
    main: main ? { ariaHidden: main.getAttribute('aria-hidden'),
      display: getComputedStyle(main).display, visible: vis(main),
      offsetHeight: main.offsetHeight, rects: main.getClientRects().length } : null,
    sRoot: sRoot ? { hidden: sRoot.hasAttribute('hidden'), visible: vis(sRoot),
      children: sRoot.children.length, textLen: (sRoot.textContent || '').length,
      offsetHeight: sRoot.offsetHeight, cls: sRoot.className } : null,
    tRoot: tRoot ? { hidden: tRoot.hasAttribute('hidden'), visible: vis(tRoot),
      children: tRoot.children.length } : null,
    preMainPanels: pre ? { visible: vis(pre), offsetHeight: pre.offsetHeight } : null,
    fatal, overflowCount: ov.length, overflow: ov.slice(0, 15),
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: innerWidth, bodyScrollHeight: document.body.scrollHeight
  };
})()`;

(async () => {
  const report = { time: new Date().toISOString(), base: BASE, cases: [] };
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
      if (m.id && pend.has(m.id)) {
        const p = pend.get(m.id); pend.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
    const cmd = (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq; pend.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error(method + ' 超时')); } }, 20000);
    });
    await cmd('Page.enable'); await cmd('Runtime.enable');

    const cases = [
      { url: '', label: '默认 /' },
      { url: '?view=terminal', label: '?view=terminal' },
      { url: '?view=workbench', label: '?view=workbench' },
      { url: '#workbench', label: '#workbench' },
    ];
    for (const c of cases) {
      await cmd('Page.navigate', { url: BASE + c.url });
      await sleep(2800);
      const r = await cmd('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      const s = r.result && r.result.value;
      report.cases.push({ label: c.label, url: BASE + c.url, state: s || null });
      console.log('\n--- ' + c.label + ' ---');
      console.log(JSON.stringify(s, null, 2));
    }
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
  console.log('\n报告：' + OUT);
})();
