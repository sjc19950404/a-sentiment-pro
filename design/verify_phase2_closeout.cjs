/* =============================================================
 * 阶段 2 收口复验（只读线上，零改动）—— 针对 11 册 §7 的 7.2 / 7.3
 *
 * 7.3 争议仲裁：CodeBuddy 认为「缺 s-skeleton.js」是误诊（探针自包含），
 *   并猜测 skeletonH:0 来自 contain:layout + visibility:hidden。
 *   本探针在真实页面里逐行复现 s-selftest.js:231-266 的 checkSkeletonSwap()，
 *   记录每一步 anchor.top / 元素 isConnected / rect.height / computedStyle，
 *   再做「先测后删 + 原子 replaceChild」修正版对照，判定真正根因。
 *
 * 7.2 回退开关：S.setFlag('overview', false) 后
 *   ① sync 是否短路（改 #emScore 不跟随） ② 切 tab 往返「总览」是否回落占位
 *   ③ 重新 enable 能否恢复 ④ flag 是否持久化（纯内存 or localStorage/URL）
 *
 * 用法：node design/verify_phase2_closeout.cjs
 * 产物：design/assets/阶段2收口复验.json
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const ROOT = path.dirname(DIR);
const ASSETS = path.join(DIR, 'assets');
const OUT = path.join(ASSETS, '阶段2收口复验.json');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://sjc19950404.github.io/a-sentiment-pro/';
const PORT = 10238;
const PROFILE = path.join(ROOT, '_probe_p2c_' + PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 7.3：逐行复现 checkSkeletonSwap + 修正版对照 ---------- */
const SKELETON_DIAG = `(() => {
  const mk = () => {
    const wrap = document.createElement('div');
    wrap.style.cssText = "position:fixed;top:0;left:0;width:600px;contain:layout;visibility:hidden;pointer-events:none;z-index:-1";
    const host = document.createElement('div'); host.className = 's-card__body';
    const anchor = document.createElement('div'); anchor.textContent = 'ANCHOR';
    const skel = document.createElement('span');
    skel.className = 's-skeleton s-skeleton--kpi'; skel.setAttribute('data-skeleton', '');
    const real = document.createElement('div'); real.className = 's-kpi'; real.textContent = '38.4';
    host.appendChild(skel); wrap.appendChild(host); wrap.appendChild(anchor);
    document.body.appendChild(wrap);
    return { wrap, host, anchor, skel, real };
  };
  const R = n => Math.round(n * 100) / 100;

  /* A. 照抄 s-selftest.js:231-266 顺序 */
  const a = mk();
  const csSkel = getComputedStyle(a.skel);
  const cssFacts = {
    skelComputedHeight: csSkel.height,
    skelComputedDisplay: csSkel.display,
    skelComputedMinHeight: csSkel.minHeight,
    skelVar: csSkel.getPropertyValue('--s-skel-kpi-h').trim(),
    realComputedMinHeight: getComputedStyle(a.real).minHeight,
    rootVar: getComputedStyle(document.documentElement).getPropertyValue('--s-skel-kpi-h').trim(),
    wrapContain: getComputedStyle(a.wrap).contain,
    wrapVisibility: getComputedStyle(a.wrap).visibility
  };
  const t0 = a.anchor.getBoundingClientRect().top;
  const skelH_inDom = a.skel.getBoundingClientRect().height;   // 对照：removeChild 之前
  a.host.insertBefore(a.real, a.skel);                          // 先插 real（此时 skel 仍在）
  const t1 = a.anchor.getBoundingClientRect().top;
  a.host.removeChild(a.skel);                                  // L252：先删
  const t2 = a.anchor.getBoundingClientRect().top;
  const asWritten = Object.assign({}, cssFacts, {
    t0: R(t0), t1: R(t1), t2: R(t2),
    d1: R(Math.abs(t1 - t0)), d2: R(Math.abs(t2 - t0)),
    skelH_inDom: R(skelH_inDom),
    skelH_asWritten: R(a.skel.getBoundingClientRect().height), // L254：已脱离 DOM 才测
    skelConnectedAtMeasure: a.skel.isConnected,
    realH: R(a.real.getBoundingClientRect().height)
  });
  asWritten.maxShift = R(Math.max(asWritten.d1, asWritten.d2));
  asWritten.pass = asWritten.maxShift < 1 && Math.abs(asWritten.skelH_asWritten - asWritten.realH) < 1;
  document.body.removeChild(a.wrap);

  /* B. 修正版：元素在 DOM 内测高度 + 原子替换（真实骨架替换语义） */
  const b = mk();
  const b0 = b.anchor.getBoundingClientRect().top;
  const bSkelH = b.skel.getBoundingClientRect().height;
  b.host.replaceChild(b.real, b.skel);
  const b1 = b.anchor.getBoundingClientRect().top;
  const bRealH = b.real.getBoundingClientRect().height;
  const fixed = {
    t0: R(b0), t1: R(b1), shift: R(Math.abs(b1 - b0)),
    skelH: R(bSkelH), realH: R(bRealH),
    skelConnectedAtMeasure: b.skel.isConnected
  };
  fixed.pass = fixed.shift < 1 && Math.abs(fixed.skelH - fixed.realH) < 1;
  document.body.removeChild(b.wrap);

  return { asWritten, fixed };
})()`;

/* ---------- 7.2：总览页状态快照 ---------- */
const STEP = `(() => {
  const q = s => document.querySelector(s);
  const t = s => { const n = q(s); return n ? n.textContent.trim() : null; };
  const panel = q('#sRoot .s-ph-panel');
  return {
    flagOverview: (window.S && window.S.getFlag) ? window.S.getFlag('overview', true) : 'NO_GETFLAG',
    sKeys: window.S ? Object.keys(window.S) : [],
    hasOverviewHost: !!q('.s-page-overview'),
    sKpiScore: t('#sKpiScore'), sKpiRegime: t('#sKpiRegime'),
    sKpiBreadth: t('#sKpiBreadth'),
    oldEmScore: t('#emScore'),
    panelTitle: t('.s-ph-title'),
    panelText: panel ? panel.textContent.trim().replace(/\\s+/g, ' ').slice(0, 140) : null,
    panelChildren: panel ? panel.children.length : 0,
    activeTab: (q('#sRoot .s-ph-tab[aria-selected="true"]') || {}).textContent || null,
    storageFlagKeys: Object.keys(localStorage).filter(k => /flag|overview|sflag/i.test(k)),
    urlHasFlag: /sflag|overview/i.test(location.search + location.hash)
  };
})()`;

(async () => {
  const report = {
    time: new Date().toISOString(), base: BASE,
    skeleton: null, selftest: null, flagSteps: [], verdict: {}, errors: []
  };
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
      setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error(method + ' 超时')); } }, 30000);
    });
    const evaluate = async expr => {
      const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r && r.result && r.result.value;
    };
    const evaluateAsync = async expr => {
      const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
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

    // 预热导航（绕开 SW 旧外壳；cacheKeyOf 剥 query，需一次 controllerchange reload）
    await cmd('Page.navigate', { url: BASE + '?_warmup=' + Date.now() });
    report.warmupReadyMs = await waitFor("!!(window.S && document.getElementById('sRoot'))", 30000);
    await sleep(1500);

    // 正式导航：?view=workbench，等数据到齐再取样
    await cmd('Page.navigate', { url: BASE + '?view=workbench&_closeout=' + Date.now() });
    report.readyMs = await waitFor("!!(window.S && document.querySelector('.s-page-overview') && document.getElementById('sKpiScore'))", 30000);
    report.dataMs = await waitFor("!!window.__lastArc", 30000);
    report.signalsMs = await waitFor("!!(window.__signals && window.__signals.regime && window.__signals.regime.latest)", 30000);
    await sleep(800);

    /* ===== 7.3 骨架探针仲裁 ===== */
    report.skeleton = await evaluate(SKELETON_DIAG);
    console.log('\n===== 7.3 骨架诊断 =====\n' + JSON.stringify(report.skeleton, null, 2));
    try {
      report.selftest = await evaluateAsync(`(async () => {
        const r = await window.S.runSelfTest();
        return { pass: r.pass, skeletonSwap: r.skeletonSwap, drawerFocusTrap: r.drawerFocusTrap,
          horizontalOverflow: r.horizontalOverflow, cls: r.cls };
      })()`);
      console.log('\n===== 线上 runSelfTest 实值 =====\n' + JSON.stringify(report.selftest, null, 2));
    } catch (e) { report.errors.push('runSelfTest: ' + e.message); }

    /* ===== 7.2 回退开关交互序列 ===== */
    const step = async (label, before) => {
      if (before) await evaluate(before);
      await sleep(450);
      const s = await evaluate(STEP);
      report.flagSteps.push({ label, state: s || null });
      console.log('\n--- 7.2 ' + label + ' ---\n' + JSON.stringify(s, null, 2));
      return s;
    };
    const s0 = await step('① 初始（总览 KPI 已渲染）');
    const s1 = await step('② setFlag(overview,false)', `window.S.setFlag('overview', false)`);
    const s2 = await step('③ 改 #emScore=SENTINEL-99（测 sync 短路）',
      `(()=>{const n=document.getElementById('emScore');if(n)n.textContent='SENTINEL-99';return 1;})()`);
    const s3 = await step('④ showPage(资金)', `window.S.showPage('资金')`);
    const s4 = await step('⑤ showPage(总览)（关键：是否回落「总览」占位）', `window.S.showPage('总览')`);
    // 先还原旧节点再 enable，避免 SENTINEL-99 残留让「恢复」判定假红
    const s5 = await step('⑥ 还原旧节点 + setFlag(overview,true) + showPage(总览)',
      `(()=>{const n=document.getElementById('emScore');if(n)n.textContent='${(s0 && s0.oldEmScore) || ''}';window.S.setFlag('overview', true);window.S.showPage('总览');return 1;})()`);
    const s6 = null;

    /* ===== 判定 ===== */
    const A = report.skeleton && report.skeleton.asWritten || {};
    const F = report.skeleton && report.skeleton.fixed || {};
    const st = report.selftest || {};
    report.verdict = {
      // 7.3：真正根因
      skeleton_asWritten_pass: !!A.pass,
      skeleton_asWritten_skelH: A.skelH_asWritten,
      skeleton_skelH_when_in_dom: A.skelH_inDom,
      skeleton_skel_disconnected_at_measure: A.skelConnectedAtMeasure === false,
      skeleton_root_var_defined: !!A.rootVar && parseFloat(A.rootVar) === 134,
      skeleton_css_heights_equal_in_dom: Math.abs((A.skelH_inDom || 0) - (A.realH || 0)) < 1,
      skeleton_wrap_contain_is_layout: /layout/.test(A.wrapContain || ''),
      skeleton_wrap_visibility_hidden: A.wrapVisibility === 'hidden',
      skeleton_probe_d1_from_double_insert: A.d1 > 1,
      skeleton_fixed_pass: !!F.pass,
      skeleton_fixed_shift: F.shift,
      skeleton_live_selftest_pass: st.skeletonSwap ? !!st.skeletonSwap.pass : null,
      // 7.2
      flag_initial_kpi_present: !!(s0 && s0.hasOverviewHost && s0.sKpiScore && !/加载中|^—$|^--$/.test(s0.sKpiScore)),
      flag_sync_shortcircuited: !!(s2 && s2.sKpiScore === s1.sKpiScore && s2.oldEmScore === 'SENTINEL-99'),
      // flag 关闭时总览不应有 KPI（正确）；但必须回落「总览」自己的占位，不能残留上一 tab 标题
      flag_tab_roundtrip_no_kpi: !!(s4 && !s4.hasOverviewHost),
      flag_falls_back_to_overview_placeholder: !!(s4 && /总览/.test(s4.panelTitle || '')),
      flag_tab_roundtrip_stale_title: !!(s4 && /资金/.test(s4.panelTitle || '')),
      flag_recovers_on_re_enable: !!(s5 && s5.hasOverviewHost && s5.sKpiScore === s0.sKpiScore),
      flag_persisted_to_storage: !!(s1 && s1.storageFlagKeys.length > 0),
      flag_url_entry_available: !!(s1 && s1.urlHasFlag),
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
