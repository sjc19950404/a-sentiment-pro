/* =============================================================
 * 阶段 1 收口回归探针（只读线上，零改动）
 * 目的：验收 3bc3e805 的 P0-1 修复，并检查是否引入连带缺陷
 *   1. #sRoot 带 .s-app{display:flex} 后，[hidden] 属性是否还管得住
 *   2. 默认 / 与 ?view=terminal 下是否多出一屏空白根
 *   3. popstate 恢复分支、8 tab 交互、workbench 全屏根高度
 * 用法：node design/verify_phase1_regression.cjs
 * 产物：design/assets/阶段1收口回归.json
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const ROOT = path.dirname(DIR);
const ASSETS = path.join(DIR, 'assets');
const OUT = path.join(ASSETS, '阶段1收口回归.json');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://sjc19950404.github.io/a-sentiment-pro/';
const PORT = 10235;
const PROFILE = path.join(ROOT, '_probe_p1r_' + PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROBE = `(() => {
  const sRoot = document.getElementById('sRoot');
  const main = document.querySelector('main');
  const pre = document.getElementById('preMainPanels');
  const cs = e => e ? {
    display: getComputedStyle(e).display,
    minHeight: getComputedStyle(e).minHeight,
    visibility: getComputedStyle(e).visibility
  } : null;
  // 量化 #sRoot 对页面高度的贡献：临时强制 display:none 再测
  let contribution = null;
  if (sRoot) {
    const h0 = document.body.scrollHeight;
    const bak = sRoot.getAttribute('style') || '';
    sRoot.style.setProperty('display', 'none', 'important');
    const h1 = document.body.scrollHeight;
    if (bak) sRoot.setAttribute('style', bak); else sRoot.removeAttribute('style');
    contribution = { before: h0, afterForceHidden: h1, delta: h0 - h1 };
  }
  return {
    href: location.href,
    bodyView: document.body.dataset.view || '',
    innerWidth, innerHeight,
    sRoot: sRoot ? {
      cls: sRoot.className, hidden: sRoot.hasAttribute('hidden'),
      children: sRoot.children.length, offsetHeight: sRoot.offsetHeight,
      computed: cs(sRoot), rectTop: Math.round(sRoot.getBoundingClientRect().top)
    } : null,
    main: main ? { hidden: main.hasAttribute('hidden'),
      ariaHidden: main.getAttribute('aria-hidden'),
      offsetHeight: main.offsetHeight, computed: cs(main) } : null,
    pre: pre ? { hidden: pre.hasAttribute('hidden'), offsetHeight: pre.offsetHeight } : null,
    bodyScrollHeight: document.body.scrollHeight,
    contribution,
    tabs: sRoot ? [...sRoot.querySelectorAll('.s-ph-tab')].map(b => ({
      text: (b.textContent || '').trim(), active: b.classList.contains('is-active'),
      disabled: b.disabled })) : [],
    panelTitle: sRoot ? ((sRoot.querySelector('.s-ph-title') || {}).textContent || '') : '',
    // 定位工作台视图顶部 180px 空白来自哪些 body 直接子元素
    bodyChildren: [...document.body.children].map(e => ({
      tag: e.tagName, id: e.id, cls: (e.className || '').toString().slice(0, 36),
      display: getComputedStyle(e).display, h: e.offsetHeight,
      top: Math.round(e.getBoundingClientRect().top),
      hidden: e.hasAttribute('hidden')
    })).filter(x => x.h > 0)
  };
})()`;

(async () => {
  const report = { time: new Date().toISOString(), base: BASE, cases: [], verdict: {} };
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
    let seq = 0; const pend = new Map(); const errors = [];
    ws.onmessage = ev => {
      let s = ev.data;
      if (typeof s !== 'string') s = Buffer.from(s).toString('utf8');
      let m; try { m = JSON.parse(s); } catch (e) { return; }
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push((m.params.exceptionDetails && m.params.exceptionDetails.text) || 'exception');
      }
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
    const evaluate = async expr => {
      const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r.result && r.result.value;
    };
    await cmd('Page.enable'); await cmd('Runtime.enable');
    // 与门禁脚本同口径：禁用 HTTP 缓存 + 每个用例唯一 query，避免 SW/HTTP 缓存
    // 让首次导航拿到部署前的外壳，造成假绿或假红。
    try { await cmd('Network.enable'); await cmd('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
    const CB = '_cb=' + Date.now();
    // 与门禁同口径预热：丢弃首次导航（旧外壳），保证 5 个取样用例都在本次部署资源上跑。
    await cmd('Page.navigate', { url: BASE + '?_warmup=' + Date.now() });
    await sleep(2600);

    const nav = async (url, label, extra) => {
      const full = url ? (url.indexOf('?') >= 0 ? url + '&' + CB : url + '?' + CB) : '?' + CB;
      await cmd('Page.navigate', { url: BASE + full });
      await sleep(2800);
      if (extra) await evaluate(extra);
      const s = await evaluate(PROBE);
      report.cases.push({ label, url: BASE + full, state: s || null });
      console.log('\n--- ' + label + ' ---');
      console.log(JSON.stringify(s, null, 2));
      return s;
    };

    // 1) 工作台（先访问，确保拿到新版资源）
    const wb = await nav('?view=workbench', '?view=workbench');

    // 2) 同页 popstate 回默认：测 route() 恢复分支，不走整页导航
    await evaluate(`history.pushState({}, '', '${BASE}'); window.dispatchEvent(new PopStateEvent('popstate'));`);
    await sleep(600);
    const pop = await evaluate(PROBE);
    report.cases.push({ label: '同页 popstate 回默认', url: BASE, state: pop || null });
    console.log('\n--- 同页 popstate 回默认 ---');
    console.log(JSON.stringify(pop, null, 2));

    // 3) 整页导航回默认 /
    const def = await nav('', '默认 /（整页）');

    // 4) 终端视图
    const term = await nav('?view=terminal', '?view=terminal');

    // 5) 回到工作台点第 3 个 tab，验证 8 tab 路由真的可交互
    const tab = await nav('?view=workbench', '?view=workbench + 点第3个tab',
      `(() => { const b = document.querySelectorAll('#sRoot .s-ph-tab')[2]; if (b) b.click(); return true; })()`);

    // 判定
    report.verdict = {
      workbench_mainHidden: !!(wb && wb.main && wb.main.hidden === true && wb.main.offsetHeight === 0),
      workbench_preHidden: !!(wb && wb.pre && wb.pre.hidden === true && wb.pre.offsetHeight === 0),
      workbench_noOldPageStack: !!(wb && wb.bodyScrollHeight < (wb.innerHeight || 1000) + 200),
      workbench_fullHeightRoot: !!(wb && wb.sRoot && wb.sRoot.offsetHeight >= (wb.innerHeight || 1000) - 40),
      // P0-B：工作台根必须贴顶，且 body 直接子级里不再有可见的旧 UI 浮层
      workbench_rootAtTop: !!(wb && wb.sRoot && wb.sRoot.rectTop === 0),
      workbench_noOldUi: !!(wb && wb.bodyChildren && !wb.bodyChildren.some(x =>
        /top-sticky|\bfoot\b|ls-switch|totop|drawer/i.test(((x.cls || '') + ' ' + (x.id || ''))))),
      hidden_attr_effective_in_default: !!(def && def.sRoot && def.sRoot.hidden === true && def.sRoot.offsetHeight === 0),
      hidden_attr_effective_in_terminal: !!(term && term.sRoot && term.sRoot.hidden === true && term.sRoot.offsetHeight === 0),
      sRoot_contribution_default: def && def.contribution ? def.contribution.delta : null,
      sRoot_contribution_terminal: term && term.contribution ? term.contribution.delta : null,
      popstate_restores_main: !!(pop && pop.main && pop.main.hidden === false),
      popstate_hides_sRoot: !!(pop && pop.sRoot && pop.sRoot.hidden === true && pop.sRoot.offsetHeight === 0),
      tabs_count: wb && wb.sRoot ? wb.tabs.length : 0,
      tabs_all_enabled: !!(tab && tab.tabs && tab.tabs.length === 8 && tab.tabs.every(t => !t.disabled)),
      tab_click_changes_panel: !!(tab && tab.panelTitle && tab.panelTitle.indexOf('资金') >= 0),
      console_exceptions: errors.length
    };
    report.errors = errors.slice(0, 20);
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
  console.log('\n判定：' + JSON.stringify(report.verdict, null, 2));
  console.log('报告：' + OUT);
})();
