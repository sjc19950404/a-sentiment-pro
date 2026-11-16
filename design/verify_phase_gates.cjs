/* =============================================================
 * 阶段发布门禁 · 可运行验收脚本（06_落地任务单.md 配套）
 *
 * 用法：
 *   node design/verify_phase_gates.cjs tokens
 *   node design/verify_phase_gates.cjs pager --rows=265
 *   node design/verify_phase_gates.cjs links --url=https://.../ --stage=1
 *   node design/verify_phase_gates.cjs all          # 只跑本地可跑项（tokens + pager）
 *
 * 为什么存在：
 *   任务单初稿的「curl 三条深链 200」与「node -e '/* 断言 *\/'」都是恒真占位。
 *   静态 Pages 任何 query 都返回 200，fragment 根本不发给服务器，
 *   所以阶段 1 / 阶段 5 的门禁必须检查渲染态 DOM，不是 HTTP 状态码。
 *
 * 产物：design/assets/门禁自检.json
 * 依赖：Node 22（全局 WebSocket）；links 模式另需本机 Edge，无外部 npm 包。
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const ASSETS = path.join(DIR, 'assets');
const ROOT = path.dirname(DIR);
const MODE = (process.argv[2] || 'all').toLowerCase();
const argv = Object.fromEntries(process.argv.slice(3)
  .filter(a => a.startsWith('--') && a.includes('='))
  .map(a => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ok(name, pass, detail) {
  const row = { name, pass: !!pass, detail };
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
  return row;
}

/* ---------- 阶段 0：令牌与组件层守卫 ---------- */
function checkTokens() {
  console.log('\n[阶段 0] 令牌与组件层守卫');
  const tok = fs.readFileSync(path.join(DIR, 'prototype/tokens.css'), 'utf8');
  const comp = fs.readFileSync(path.join(DIR, 'prototype/components.css'), 'utf8');
  const varDef = s => [...s.matchAll(/(--s-[a-z0-9-]+)\s*:/gi)].map(m => m[1]);
  const tokDef = new Set(varDef(tok));
  const allDef = new Set([...tokDef, ...varDef(comp)]);
  const used = [...new Set([...comp.matchAll(/var\(\s*(--s-[a-z0-9-]+)/gi)].map(m => m[1]))];
  const missing = used.filter(x => !allDef.has(x));
  const balance = (tok + comp).split('{').length - (tok + comp).split('}').length;
  const rows = [
    ok('tokens.css 变量数 ≥ 100', tokDef.size >= 100, { defined: tokDef.size }),
    ok('组件 var(--s-*) 引用零缺失', missing.length === 0, { used: used.length, missing }),
    ok('CSS 花括号平衡', balance === 0, { balance }),
    ok(':root 深色主题存在', /:root\s*\{/.test(tok)),
    ok('[data-theme="light"] 覆盖存在', /\[data-theme="light"\]\s*\{/.test(tok)),
    ok('prefers-reduced-motion 降级存在', /prefers-reduced-motion/.test(tok)),
    ok('组件层不写死颜色（透明叠层除外）', !/(?:color|background|border-color)\s*:\s*#[0-9a-f]{3,8}\s*[;}]/i.test(comp)),
    ok('未使用 backdrop-filter', !/backdrop-filter/i.test(comp)),
  ];
  return { mode: 'tokens', defined: tokDef.size, allDefined: allDef.size, used: used.length, missing, rows };
}

/* ---------- 阶段 3：动态行数分页断言 ----------
 * 265 / 288 都曾被误当成回测明细行数：265 是「265 日完整档」天数，
 * 288 是整页 28 张表的总行数。真实行数 N 必须在运行时读取后按 N 断言。 */
function checkPager(rowsArg) {
  console.log('\n[阶段 3] 动态行数分页断言');
  const N = Number(rowsArg || 265);
  const PAGE = 50;
  const expectedPages = Math.ceil(N / PAGE);
  const rows = [
    ok('行数 N 为正整数', Number.isInteger(N) && N > 0, { N }),
    ok('分页数 = ceil(N / 50)', Number.isInteger(expectedPages), { expectedPages, formula: 'Math.ceil(N/50)' }),
    ok('末页余数正确', (N % PAGE) === (N - (expectedPages - 1) * PAGE), { lastPageRows: N - (expectedPages - 1) * PAGE }),
    ok('模式判定边界', (N < 200 ? 'render-all' : N <= 1000 ? 'pager' : 'virtual') === (N > 1000 ? 'virtual' : N < 200 ? 'render-all' : 'pager'),
      { mode: N < 200 ? 'render-all（全量）' : N <= 1000 ? 'pager（每页 50）' : 'virtual（虚拟滚动）' }),
  ];
  return { mode: 'pager', N, pageSize: PAGE, expectedPages, rows,
    note: '上线时 --rows 取 #btRowCount / tbody tr 的真实数量，禁止写死 265' };
}

/* ---------- 阶段 1 / 5：深链渲染态 DOM 断言 ---------- */
const PROBE = `(() => {
  const vis = e => !!e && !e.hasAttribute('hidden') &&
    getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' &&
    e.getClientRects().length > 0;
  const main = document.querySelector('main');
  const tRoot = document.getElementById('tRoot');
  const sRoot = document.getElementById('sRoot');
  const entry = [...document.querySelectorAll('body > button')]
    .find(b => (b.textContent || '').indexOf('图表终端') >= 0);
  const activeRoots = [['terminal', tRoot], ['workbench', sRoot]].filter(([, e]) => vis(e)).map(([n]) => n);
  return {
    href: location.href,
    mainVisible: vis(main),
    mainAriaHidden: !!main && main.getAttribute('aria-hidden') === 'true',
    tRootVisible: vis(tRoot),
    sRootVisible: vis(sRoot),
    sRootChildren: sRoot ? sRoot.children.length : 0,
    activeRoots,
    fixedEntry: entry ? {
      id: entry.id || '', cls: entry.className || '',
      display: getComputedStyle(entry).display,
      zIndex: getComputedStyle(entry).zIndex
    } : null,
    // #fatalHolder 是 index.html 静态 [hidden] + display:none 的空占位，恒存在；
    // 只看「是否显示且有内容」，否则 fatal 恒 true，4 个用例无条件假红。
    fatal: [...document.querySelectorAll('[data-fatal], #fatalHolder')].some(e =>
      !e.hasAttribute('hidden') && getComputedStyle(e).display !== 'none' &&
      (e.textContent || '').trim().length > 0),
    // 关闭态抽屉 #drawer[aria-hidden="true"] 是 translateX 离屏定位，其内部
    // dw-head / dwTitle / dwBody 等 right 超出视口属正常，不计入页面横向溢出。
    overflow: [...document.querySelectorAll('body *')].filter(e => {
      if (e.closest('#drawer[aria-hidden="true"], [hidden]')) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.right > window.innerWidth + 2 &&
        getComputedStyle(e).position !== 'fixed' && e.scrollWidth <= e.clientWidth + 2;
    }).length,
    docScrollWidth: document.documentElement.scrollWidth,
    // 影子根「真隐藏」：hidden 属性可能被作者样式 .s-app{display:flex} 覆盖，
    // 只看属性会假绿。必须查 computedStyle 与实际占位高度。
    sRootComputedDisplay: sRoot ? getComputedStyle(sRoot).display : null,
    sRootOffsetHeight: sRoot ? sRoot.offsetHeight : 0,
    sRootRectTop: sRoot ? Math.round(sRoot.getBoundingClientRect().top) : 0,
    bodyScrollHeight: document.body.scrollHeight,
    innerHeight: window.innerHeight
  };
})()`;

async function checkLinks(base, stage) {
  console.log('\n[阶段 ' + stage + '] 深链渲染态 DOM 断言（CDP，不用 curl）');
  const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (!fs.existsSync(EDGE)) return { mode: 'links', skipped: true, reason: '本机未找到 Edge：' + EDGE };
  const PORT = 10230 + (Number(stage) || 0);
  const PROFILE = path.join(ROOT, '_gate_profile_' + PORT);
  const proxy = process.env.https_proxy || '';
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--allow-file-access-from-files', '--disable-background-networking',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1440,1000', 'about:blank'
  ];
  if (proxy) args.push('--proxy-server=' + proxy);
  const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
  const rows = [], samples = [];
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
      { url: '', label: '默认 /', expect: 'report' },
      { url: '?view=terminal', label: '?view=terminal', expect: stage >= 5 ? 'workbench' : 'terminal' },
      { url: '?view=workbench', label: '?view=workbench', expect: 'workbench' },
      { url: '#workbench', label: '#workbench', expect: 'workbench' },
    ];
    for (const c of cases) {
      await cmd('Page.navigate', { url: base + c.url });
      await sleep(2600);
      const r = await cmd('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      const s = r.result && r.result.value;
      samples.push({ label: c.label, state: s });
      if (!s) { rows.push(ok(c.label + ' 探针返回', false, '无结果')); continue; }
      const got = s.sRootVisible ? 'workbench' : s.tRootVisible ? 'terminal' : s.mainVisible ? 'report' : 'none';
      rows.push(ok(c.label + ' 主视图 = ' + c.expect, got === c.expect, { got, activeRoots: s.activeRoots }));
      rows.push(ok(c.label + ' 活跃主根唯一', s.activeRoots.length <= 1, { activeRoots: s.activeRoots }));
      rows.push(ok(c.label + ' 无致命兜底 / 横向溢出', !s.fatal && s.overflow === 0, { fatal: s.fatal, overflow: s.overflow }));
      if (c.expect !== 'workbench') {
        // 非工作台视图下影子根必须真隐藏（不占布局高度），否则默认研报页被撑长一屏。
        rows.push(ok(c.label + ' 影子根真隐藏（不占布局）', s.sRootOffsetHeight === 0,
          { sRootOffsetHeight: s.sRootOffsetHeight, sRootDisplay: s.sRootComputedDisplay,
            bodyScrollHeight: s.bodyScrollHeight }));
      }
      if (c.expect === 'workbench') {
        // R2 补漏：activeRoots 只统计 tRoot/sRoot，研报 <main> 漏检。
        // 工作台视图必须同时让研报主根不可见，否则只是「研报页 + 底部一块面板」。
        rows.push(ok(c.label + ' 研报主根已隐藏', s.mainVisible === false,
          { mainVisible: s.mainVisible, docScrollWidth: s.docScrollWidth }));
        // 工作台根必须贴顶、且不残留旧 UI 占位（top-sticky / footer 等）
        rows.push(ok(c.label + ' 工作台贴顶且无旧 UI 占位',
          s.sRootRectTop === 0 && s.bodyScrollHeight <= s.innerHeight + 2,
          { sRootRectTop: s.sRootRectTop, bodyScrollHeight: s.bodyScrollHeight,
            innerHeight: s.innerHeight }));
      }
      if (c.expect === 'workbench' && s.fixedEntry) {
        rows.push(ok(c.label + ' 入口按钮已隐藏', s.fixedEntry.display === 'none', s.fixedEntry));
      }
      if (c.expect === 'workbench' && !s.fixedEntry) {
        rows.push(ok(c.label + ' 入口按钮存在可检测锚点', false, 'body>button 中未找到，需补 id'));
      }
    }
    // 幂等：退回默认再进工作台，活跃主根数不得叠加
    await cmd('Page.navigate', { url: base + '' }); await sleep(1800);
    await cmd('Page.navigate', { url: base + '?view=workbench' }); await sleep(2600);
    const r2 = await cmd('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    const s2 = r2.result && r2.result.value;
    rows.push(ok('二次进入幂等（无叠加 / 无残留）', !!s2 && s2.activeRoots.length <= 1 && !s2.mainAriaHidden,
      s2 ? { activeRoots: s2.activeRoots, mainAriaHidden: s2.mainAriaHidden } : '无结果'));
    ws.close();
  } catch (e) {
    rows.push(ok('CDP 会话', false, String(e.message || e)));
  } finally {
    try { child.kill(); } catch (e) {}
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
  return { mode: 'links', stage, base, rows, samples };
}

(async () => {
  const report = { time: new Date().toISOString(), mode: MODE, results: [] };
  if (MODE === 'tokens' || MODE === 'all') report.results.push(checkTokens());
  if (MODE === 'pager' || MODE === 'all') report.results.push(checkPager(argv.rows));
  if (MODE === 'links') {
    if (!argv.url) { console.log('\nlinks 模式需要 --url=站点根地址'); process.exitCode = 2; return; }
    report.results.push(await checkLinks(argv.url, Number(argv.stage || 1)));
  }
  if (!['tokens', 'pager', 'all', 'links'].includes(MODE)) {
    console.log('未知模式：' + MODE); process.exitCode = 2; return;
  }
  const all = report.results.flatMap(r => r.rows || []);
  const failed = all.filter(r => !r.pass);
  report.summary = { total: all.length, passed: all.length - failed.length, failed: failed.length, pass: failed.length === 0 };
  if (!fs.existsSync(ASSETS)) fs.mkdirSync(ASSETS, { recursive: true });
  fs.writeFileSync(path.join(ASSETS, '门禁自检.json'), JSON.stringify(report, null, 2));
  console.log('\n汇总：' + report.summary.passed + '/' + report.summary.total + ' 通过' +
    (failed.length ? '，失败项：' + failed.map(f => f.name).join(' / ') : '，全部通过'));
  console.log('报告：design/assets/门禁自检.json');
  if (failed.length) process.exitCode = 1;
})();
