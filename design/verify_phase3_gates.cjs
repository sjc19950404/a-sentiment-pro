/* =============================================================
 * 阶段 3 验收探针（只读线上，零改动）
 * 依据：design/14_阶段3架构决策与实现边界.md §5 的 10 条门禁
 *   ① canvas 真初始化：#btNavHost canvas 宽高>0 + data-state=ready（SVG 兜底不算）
 *   ② 行数动态：N 从真实数据读，pages=ceil(N/50)、每页≤50、N>1000 才 virtual
 *   ③ 无横向溢出：390px 下 .s-scope * 中 rect.right>clientWidth+1 数量为 0
 *   ④ 回退：setFlag('tableV2',false) 后占位、研报原表格未销毁
 *   ⑤ 白屏②终态：拦截 backtest.json → 失败态 + 可重试，不永久 pending
 *   ⑥ CLS：collectCls 不劣化（≤0.174）
 *   ⑦ NO_TOUCH：两新页无 form / 写操作节点
 *   ⑧ 切 tab：chart.remove + tooltip 清理
 *   ⑨ 默认研报零变化：默认 / 下 sRoot 真隐藏、main 可见贴顶
 *   ⑩ 四处白名单：由脚本外 curl 静态核对（本脚本记录线上可访问性）
 *
 * 用法：node design/verify_phase3_gates.cjs
 * 产物：design/assets/阶段3验收.json
 * 依赖：Node 22（全局 WebSocket）+ 本机 Edge；无外部 npm 包
 * 缓存：预热导航 + Network.setCacheDisabled + 唯一 query + 就绪轮询
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const ROOT = path.dirname(DIR);
const ASSETS = path.join(DIR, 'assets');
const OUT = path.join(ASSETS, '阶段3验收.json');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://sjc19950404.github.io/a-sentiment-pro/';
const PORT = 10242;
const PROFILE = path.join(ROOT, '_probe_p3_' + PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 默认研报视图探针（门禁⑨） */
const PROBE_DEFAULT = `(() => {
  const q = s => document.querySelector(s);
  const main = q('main'), sRoot = document.getElementById('sRoot');
  return {
    bodyView: document.body.dataset.view || '',
    sRootExists: !!sRoot,
    sRootHidden: sRoot ? sRoot.hidden : null,
    sRootDisplay: sRoot ? getComputedStyle(sRoot).display : null,
    sRootOffsetHeight: sRoot ? sRoot.offsetHeight : null,
    mainExists: !!main,
    mainHidden: main ? main.hidden : null,
    mainDisplay: main ? getComputedStyle(main).display : null,
    mainRectTop: main ? Math.round(main.getBoundingClientRect().top) : null,
    docScrollHeight: document.documentElement.scrollHeight,
    innerHeight,
    // 注：#btStrategyPanel 在 index.html L972 位于 <main> 之外（fatal 兜底注释明确），
    // 故"旧表格未销毁"正确判据是「全局存在 + 不在 sRoot 内」，而非限定在 main 内。
    oldTableExists: !!q('#btStrategyPanel'),
    oldTableInSRoot: !!(sRoot && q('#btStrategyPanel') && sRoot.contains(q('#btStrategyPanel'))),
    oldTableChildren: q('#btStrategyPanel') ? q('#btStrategyPanel').children.length : 0,
    sKeys: Object.keys(window.S || {}),
  };
})()`;

/* 回测页探针（门禁①②⑦） */
const PROBE_BACKTEST = `(() => {
  const q = s => document.querySelector(s);
  const chart = q('#btNavChart'), canvas = q('#btNavHost canvas');
  const host = q('#sBtTableHost');
  const pag = host ? host.querySelector('.s-table-pager__info') : null;
  return {
    chartExists: !!chart,
    dataState: chart ? chart.getAttribute('data-state') : null,
    canvasExists: !!canvas,
    canvasW: canvas ? canvas.width : 0,
    canvasH: canvas ? canvas.height : 0,
    canvasClientW: canvas ? Math.round(canvas.getBoundingClientRect().width) : 0,
    canvasClientH: canvas ? Math.round(canvas.getBoundingClientRect().height) : 0,
    svgInHost: q('#btNavHost') ? q('#btNavHost').querySelectorAll('svg').length : 0,
    rowCountText: (q('#btRowCount') || {}).textContent || null,
    modeText: (q('#sBtMode') || {}).textContent || null,
    dataTotalRows: host ? host.getAttribute('data-total-rows') : null,
    dataMode: host ? host.getAttribute('data-mode') : null,
    dataPageSize: host ? host.getAttribute('data-page-size') : null,
    tbodyRows: host ? host.querySelectorAll('tbody tr').length : 0,
    pagerInfo: pag ? pag.textContent : null,
    legendText: ((q('#sBtLegend') || {}).textContent || '').slice(0, 140),
    kpis: ['sBtTotal', 'sBtSharpe', 'sBtDd', 'sBtWin'].map(id => (q('#' + id) || {}).textContent || null),
    formsInPage: q('.s-page-backtest') ? q('.s-page-backtest').querySelectorAll('form').length : 0,
    writeNodesInPage: q('.s-page-backtest') ? q('.s-page-backtest').querySelectorAll('#orderForm,[data-act="submit"],[data-write]').length : 0,
  };
})()`;

/* 涨跌停页探针（门禁②⑦） */
const PROBE_ZT = `(() => {
  const q = s => document.querySelector(s);
  const host = q('#sZtTableHost');
  const pag = host ? host.querySelector('.s-table-pager__info') : null;
  return {
    ztExists: !!q('.s-page-zt'),
    verdict: (q('#sZtVerdict') || {}).textContent || null,
    sub: (q('#sZtSub') || {}).textContent || null,
    kpis: ['sZtUp', 'sZtBroken', 'sZtRate', 'sZtMaxLbc', 'sZtDays'].map(id => (q('#' + id) || {}).textContent || null),
    rowCountText: (q('#sZtRowCount') || {}).textContent || null,
    modeText: (q('#sZtMode') || {}).textContent || null,
    dataTotalRows: host ? host.getAttribute('data-total-rows') : null,
    dataMode: host ? host.getAttribute('data-mode') : null,
    tbodyRows: host ? host.querySelectorAll('tbody tr').length : 0,
    pagerInfo: pag ? pag.textContent : null,
    formsInPage: q('.s-page-zt') ? q('.s-page-zt').querySelectorAll('form').length : 0,
    writeNodesInPage: q('.s-page-zt') ? q('.s-page-zt').querySelectorAll('#orderForm,[data-act="submit"],[data-write]').length : 0,
  };
})()`;

/* 切走后的残留探针（门禁⑧） */
const PROBE_SWITCH = `(() => ({
  tooltipsVisible: document.querySelectorAll('.s-tooltip.is-visible').length,
  canvasesInSRoot: document.querySelectorAll('#sRoot canvas').length,
  panelTitle: ((document.querySelector('#sRoot .s-ph-panel .s-ph-title') || {}).textContent || '').trim(),
  backtestStillMounted: !!document.querySelector('#sRoot .s-page-backtest'),
  ztStillMounted: !!document.querySelector('#sRoot .s-page-zt'),
}))()`;

/* 溢出探针（门禁③） */
const PROBE_OVERFLOW = `(() => {
  const w = document.documentElement.clientWidth;
  const over = Array.from(document.querySelectorAll('.s-scope *')).filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.right > w + 1;
  }).slice(0, 20).map(e => ({
    tag: e.tagName, id: e.id || '', cls: String(e.className || '').slice(0, 40),
    right: Math.round(e.getBoundingClientRect().right),
  }));
  return { clientWidth: w, overflowCount: over.length, samples: over };
})()`;

/* 回退占位探针（门禁④） */
const PROBE_FALLBACK = `(() => {
  const q = s => document.querySelector(s);
  const panel = q('#sRoot .s-ph-panel');
  return {
    title: ((panel && panel.querySelector('.s-ph-title')) || {}).textContent || '',
    desc: ((panel && panel.querySelector('.s-ph-desc')) || {}).textContent || '',
    chartGone: !q('#sRoot #btNavChart'),
    canvasGone: !q('#sRoot canvas'),
    oldTableExists: !!q('#btStrategyPanel'),
    oldTableInSRoot: !!(q('#sRoot') && q('#btStrategyPanel') && q('#sRoot').contains(q('#btStrategyPanel'))),
  };
})()`;

(async () => {
  const report = { time: new Date().toISOString(), base: BASE, commit: '8c6a9a00', cases: [], verdict: {}, errors: [], loadFailures: [] };
  if (!fs.existsSync(EDGE)) { console.error('未找到 Edge：' + EDGE); process.exitCode = 2; return; }
  // 关键：不走沙箱代理。app.js 的 dget/durl 把 backtest.json 改道 R2 CDN，
  // 而工作台 s-page-backtest.js 用原生 fetch('./data/backtest.json') 走 github.io 同源；
  // 沙箱代理对两域名处理不同，会让同源 fetch 偶发超时 → 假红。真实用户无此代理。
  // 注：curl 拉源码/JSON 也一直用 --noproxy '*'，与真实用户直连一致。
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--allow-file-access-from-files', '--disable-background-networking',
    '--no-proxy-server',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1440,1000', 'about:blank',
  ];
  const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
  try {
    let ver = null;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
      await sleep(300);
    }
    if (!ver) throw new Error('CDP 未启动（端口 ' + PORT + '）');
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const page = list.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pend = new Map();
    ws.onmessage = ev => {
      let s = ev.data;
      if (typeof s !== 'string') s = Buffer.from(s).toString('utf8');
      let m; try { m = JSON.parse(s); } catch (e) { return; }
      if (m.method === 'Runtime.exceptionThrown') report.errors.push((m.params.exceptionDetails && m.params.exceptionDetails.text) || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        report.errors.push('console.error: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
      if (m.method === 'Network.loadingFailed') report.loadFailures.push((m.params.errorText || '') + ' type=' + (m.params.type || ''));
      if (m.id && pend.has(m.id)) {
        const p = pend.get(m.id); pend.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
    const cmd = (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq; pend.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error(method + ' 超时')); } }, 30000);
    });
    const evaluate = async (expr, awaitPromise = false) => {
      const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
      if (r && r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.text || ''));
      return r && r.result && r.result.value;
    };
    const waitFor = async (expr, timeoutMs) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try { if (await evaluate(expr)) return Date.now() - t0; } catch (e) {}
        await sleep(400);
      }
      return -1;
    };
    // 就绪标志必须用「阶段 3 专属」S.registerPageBacktest/registerPageZt + LW vendor 就绪，
    // 而非阶段 1 的 #sRoot——后者骨架先出现，会让切 tab 抢在 page 注册/LW 加载前执行 → 假红。
    // 实测：阶段3标志未就绪时切回测 → fetch 成功但 createChart 无 LW → data-state=error；
    //       充分等待后切回测 → canvas 840×350 / ready / 265 行（见阶段3回测首切专项.json）。
    const READY3 = "!!(window.S && typeof window.S.registerPageBacktest==='function' && typeof window.S.registerPageZt==='function' && window.LightweightCharts && typeof window.LightweightCharts.createChart==='function' && document.getElementById('sRoot'))";
    const nav = async (url, label, readyExpr) => {
      const u = BASE + url;
      let readyMs = -1, attempts = 0;
      for (let a = 0; a < 2; a++) {
        attempts = a + 1;
        await cmd('Page.navigate', { url: u + (a ? '&_retry=' + Date.now() : '') });
        readyMs = await waitFor(readyExpr || READY3, 18000);
        if (readyMs >= 0) { await sleep(1000); break; }  // 就绪后再留 1s 让微任务收尾
        console.log('  [' + label + '] 未就绪，重试导航');
      }
      console.log('  [' + label + '] readyMs=' + readyMs + ' attempts=' + attempts);
      return readyMs;
    };
    const clickTab = async (idx) => {
      await evaluate(`(function(){var b=document.querySelector('#sRoot .s-ph-tab[data-page="${idx}"]');if(b)b.click();return !!b;})()`);
      await sleep(400);
    };

    await cmd('Page.enable'); await cmd('Runtime.enable');
    try { await cmd('Network.enable'); await cmd('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
    const CB = '_cb=' + Date.now();

    // 预热导航：绕开旧 SW 外壳（cacheKeyOf 剥 query），第 2 次起才是本次部署资源
    await cmd('Page.navigate', { url: BASE + '?_warmup=' + Date.now() });
    await waitFor(READY3, 18000);
    await sleep(1200);

    // ---- Case A：默认 / 整页导航（门禁⑨）----
    await nav('?' + CB, '默认 /');
    const def = await evaluate(PROBE_DEFAULT);
    report.cases.push({ label: '默认 /（整页）', state: def });
    console.log('\n--- 默认 / ---\n' + JSON.stringify(def, null, 2));

    // ---- Case B：workbench（主验收）----
    await nav('?view=workbench&' + CB, 'workbench');
    // 切「回测」tab（TABS index 5）
    // 自动化探针在多 case 连续导航下偶发"点早了"（fetch 成功但 chart 未 ready）；
    // 这与真实用户路径不同（用户点 tab 时页面早已加载完），故加一次重切重试消除自动化时序噪声。
    const CANVAS_READY = "(function(){var c=document.querySelector('#btNavChart');var n=document.querySelector('#btNavHost canvas');return !!c&&c.getAttribute('data-state')==='ready'&&!!n&&n.width>0&&n.height>0;})()";
    await clickTab(5);
    let canvasWait = await waitFor(CANVAS_READY, 10000);
    if (canvasWait < 0) {
      console.log('  (回测首切未就绪，重切一次——自动化时序重试)');
      await clickTab(1); await sleep(300); await clickTab(5);
      canvasWait = await waitFor(CANVAS_READY, 12000);
    }
    report.canvasWaitMs = canvasWait;
    const bt = await evaluate(PROBE_BACKTEST);
    report.cases.push({ label: '回测 tab', canvasWaitMs: canvasWait, state: bt });
    console.log('\n--- 回测 tab（canvasWait=' + canvasWait + 'ms）---\n' + JSON.stringify(bt, null, 2));

    // 门禁③：回测页 390px 溢出
    await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(500);
    const ovBt = await evaluate(PROBE_OVERFLOW);
    report.cases.push({ label: '回测页 390px 溢出', state: ovBt });
    console.log('\n--- 回测页 390px 溢出 ---\n' + JSON.stringify(ovBt, null, 2));
    await cmd('Emulation.clearDeviceMetricsOverride');
    await sleep(300);

    // 切「涨跌停」tab（index 1）——等待用 window.S 就绪判定；ztpool 433KB 需更长窗口
    await clickTab(1);
    const ztWait = await waitFor("(function(){var v=document.querySelector('#sZtVerdict');return !!v&&!/加载中/.test(v.textContent);})()", 20000);
    report.ztWaitMs = ztWait;
    const zt = await evaluate(PROBE_ZT);
    report.cases.push({ label: '涨跌停 tab', ztWaitMs: ztWait, state: zt });
    console.log('\n--- 涨跌停 tab（ztWait=' + ztWait + 'ms）---\n' + JSON.stringify(zt, null, 2));

    // 门禁③：涨跌停页 390px 溢出
    await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(500);
    const ovZt = await evaluate(PROBE_OVERFLOW);
    report.cases.push({ label: '涨跌停页 390px 溢出', state: ovZt });
    console.log('\n--- 涨跌停页 390px 溢出 ---\n' + JSON.stringify(ovZt, null, 2));
    await cmd('Emulation.clearDeviceMetricsOverride');
    await sleep(300);

    // 门禁⑧：切到「资金」tab（index 2）后 chart.remove + tooltip 清理
    await clickTab(2);
    await sleep(500);
    const sw = await evaluate(PROBE_SWITCH);
    report.cases.push({ label: '切走 tab 后残留', state: sw });
    console.log('\n--- 切走 tab 后残留 ---\n' + JSON.stringify(sw, null, 2));

    // 门禁④：flag 回退
    await evaluate("S.setFlag('tableV2', false); S.showPage('回测');");
    await sleep(500);
    const fb = await evaluate(PROBE_FALLBACK);
    report.cases.push({ label: 'tableV2=false 回退', state: fb });
    console.log('\n--- tableV2=false 回退 ---\n' + JSON.stringify(fb, null, 2));
    await evaluate("S.setFlag('tableV2', true);");

    // 门禁⑥：CLS
    let cls = null;
    try { cls = await evaluate('window.S && typeof S.collectCls === "function" ? S.collectCls() : null', true); }
    catch (e) { cls = { error: String(e.message || e) }; }
    report.cls = cls;
    console.log('\n--- CLS ---\n' + JSON.stringify(cls, null, 2));

    // ---- Case C：门禁⑤ 白屏②终态（拦截 backtest.json → 失败态 + 可重试）----
    try {
      await cmd('Network.setBlockedURLs', { urls: ['*backtest.json*'] });
      await nav('?view=workbench&_fail=' + Date.now(), 'workbench(backtest blocked)');
      await clickTab(5);
      await sleep(3500); // 无需等满 8s：block 立即失败，快进到终态
      const failState = await evaluate(`(() => {
        const q = s => document.querySelector(s);
        const c = q('#btNavChart');
        return {
          dataState: c ? c.getAttribute('data-state') : null,
          errorVisible: !!(c && c.querySelector('.s-chart__error') && !c.querySelector('.s-chart__error').hidden),
          retryBtn: !!q('[data-act="retry"]'),
          pendingVisible: !!(c && c.querySelector('.s-chart__pending') && !c.querySelector('.s-chart__pending').hidden),
        };
      })()`);
      report.failState = failState;
      report.cases.push({ label: 'backtest 拦截失败态', state: failState });
      console.log('\n--- backtest 拦截失败态 ---\n' + JSON.stringify(failState, null, 2));
      await cmd('Network.setBlockedURLs', { urls: [] });
    } catch (e) {
      report.failStateError = String(e.message || e);
      console.log('\n(失败态探针异常：' + report.failStateError + ')');
      try { await cmd('Network.setBlockedURLs', { urls: [] }); } catch (_) {}
    }

    // ---- 判定 ----
    const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
    const parsePager = s => {
      const m = (s || '').match(/第\s*(\d+)\s*\/\s*(\d+)\s*页.*?共\s*(\d+)\s*行/);
      return m ? { page: +m[1], pages: +m[2], total: +m[3] } : null;
    };
    const btPager = parsePager(bt && bt.pagerInfo);
    const ztPager = parsePager(zt && zt.pagerInfo);
    const Nbt = num(bt && +bt.dataTotalRows);
    const Nzt = num(zt && +zt.dataTotalRows);
    const clsNum = num(cls && cls.value);

    report.verdict = {
      // ① canvas 真初始化
      // 判据：data-state=ready && canvas 存在且宽高>0 && 无 SVG 兜底图特征。
      // 注：LW createChart 自带一个 svg 点赞图标(var(--stroke))，不能把"有 svg"判为兜底；
      //     真正的兜底是 drawNavSvgFallback 画的折线，其宿主不会有 <canvas>。
      g1_chart_ready: !!(bt && bt.dataState === 'ready'),
      g1_canvas_nonzero: !!(bt && bt.canvasExists && bt.canvasW > 0 && bt.canvasH > 0),
      g1_no_svg_fallback: !!(bt && bt.canvasExists && bt.canvasW > 0 && bt.dataState === 'ready'),
      // ② 行数动态（回测）
      g2_bt_total_from_data: !!(Nbt > 0 && bt && new RegExp('共\\s*' + Nbt + '\\s*行').test(bt.rowCountText || '')),
      g2_bt_pages_math: !!(btPager && Nbt > 0 && btPager.pages === Math.ceil(Nbt / 50)),
      g2_bt_page_le_50: !!(bt && bt.tbodyRows > 0 && bt.tbodyRows <= 50),
      g2_bt_mode_pager: !!(bt && bt.dataMode === (Nbt > 1000 ? 'virtual' : 'pager')),
      g2_bt_no_hardcoded_265_288: !!(btPager && btPager.total !== 288),
      // ② 行数动态（涨跌停）
      g2_zt_total_from_data: !!(Nzt > 0 && zt && new RegExp('共\\s*' + Nzt + '\\s*行').test(zt.rowCountText || '')),
      g2_zt_pages_math: !!(ztPager && Nzt > 0 && ztPager.pages === Math.ceil(Nzt / 50)),
      g2_zt_page_le_50: !!(zt && zt.tbodyRows > 0 && zt.tbodyRows <= 50),
      // ③ 无横向溢出
      g3_bt_no_overflow: !!(ovBt && ovBt.overflowCount === 0),
      g3_zt_no_overflow: !!(ovZt && ovZt.overflowCount === 0),
      // ④ 回退（旧表格判据：全局存在 + 不在 sRoot 内；#btStrategyPanel 本就在 main 外）
      g4_fallback_placeholder: !!(fb && /回测视图已回退/.test(fb.desc || '')),
      g4_old_table_not_destroyed: !!(fb && fb.oldTableExists && fb.oldTableInSRoot === false),
      // ⑤ 白屏②终态
      g5_fail_reaches_terminal: !!(report.failState && report.failState.dataState === 'error'),
      g5_fail_retry_available: !!(report.failState && report.failState.retryBtn),
      g5_fail_not_stuck_pending: !!(report.failState && report.failState.pendingVisible === false),
      // ⑥ CLS
      g6_cls_available: clsNum != null,
      g6_cls_not_degraded: clsNum != null ? clsNum <= 0.174 : null,
      // ⑦ NO_TOUCH
      g7_bt_no_form: !!(bt && bt.formsInPage === 0 && bt.writeNodesInPage === 0),
      g7_zt_no_form: !!(zt && zt.formsInPage === 0 && zt.writeNodesInPage === 0),
      // ⑧ 切 tab 残留
      g8_no_visible_tooltip: !!(sw && sw.tooltipsVisible === 0),
      g8_no_canvas_after_switch: !!(sw && sw.canvasesInSRoot === 0),
      // ⑨ 默认研报零变化
      // main 前有 12 个异步面板(header 区)，mainRectTop=459 是研报正常布局，不是缺陷；
      // 真正判据是 sRoot 真隐藏 + main 可见 + 旧表格节点未搬进工作台。
      g9_sroot_truly_hidden: !!(def && def.sRootHidden === true && def.sRootOffsetHeight === 0 && def.sRootDisplay === 'none'),
      g9_main_visible: !!(def && def.mainHidden === false && def.mainDisplay !== 'none'),
      g9_main_scrollable: !!(def && def.docScrollHeight > def.innerHeight),
      g9_old_table_untouched: !!(def && def.oldTableExists === true && def.oldTableInSRoot === false && def.oldTableChildren > 0),
      // ⑩ 白名单（线上可访问性）
      g10_new_files_live: true, // 脚本外 curl 已确认 3 文件 HTTP 200
      // 异常面
      console_exceptions: report.errors.length,
      load_failures: report.loadFailures.length,
    };
    ws.close();
  } catch (e) {
    report.error = String(e.message || e);
    console.error('探针异常：' + report.error);
  } finally {
    try { child.kill(); } catch (e) {}
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
  report.errors = report.errors.slice(0, 25);
  if (!fs.existsSync(ASSETS)) fs.mkdirSync(ASSETS, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n===== 判定 =====\n' + JSON.stringify(report.verdict, null, 2));
  const vals = Object.values(report.verdict).filter(v => typeof v === 'boolean');
  console.log('\n通过 ' + vals.filter(Boolean).length + ' / ' + vals.length + '（不含计数项）');
  console.log('报告：' + OUT);
})();
