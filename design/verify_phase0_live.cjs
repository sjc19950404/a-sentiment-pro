/**
 * verify_phase0_live.cjs — A 方案「阶段 0」线上落地核验（只读，不改线上任何文件）
 *
 * 核验目标：
 *  1. 四个新增资源是否全部 200、index.html 挂载是否正确；
 *  2. 新增 CSS 对旧研报视图是否真的零影响（CSSOM 规则命中面 + 摘除 link 前后 computedStyle 逐元素比对）；
 *  3. window.S 上到底挂了什么：S.runSelfTest() / S.collectCls() 是否可调用；
 *  4. 阶段 0 下 S.runSelfTest() 的真实结果（预期 pass=false，因为 .s-scope / sDrawer 尚未挂载）；
 *  5. 控制台错误、资源失败、整页高度 / 横向溢出、工作台深链冒烟。
 *
 * 用法：node design/verify_phase0_live.cjs
 * 输出：design/assets/阶段0线上核验.json + design/assets/阶段0首屏.png
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = 'D:/app 1/2026-11-14-21-47-50';
const BASE = 'https://sjc19950404.github.io/a-sentiment-pro/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.CDP_PORT || 10031);
const PROFILE = path.join(OUT, '_cdp_phase0');
const PROXY = process.env.https_proxy || process.env.HTTPS_PROXY || 'http://127.0.0.1:52694';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  `--proxy-server=${PROXY}`, '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const R = { url: BASE, stamp: new Date().toISOString(), checks: {}, errors: [], failedRequests: [] };

async function main() {
  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(400);
  }
  if (!ver) throw new Error('CDP 未启动');
  R.browser = ver.Browser;

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => {
    let s = ev.data;
    if (typeof s !== 'string') s = s && typeof s.text === 'function' ? s.text() : String(s);
    let m; try { m = JSON.parse(s); } catch (e) { return; }
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      R.errors.push('exception: ' + ((m.params.exceptionDetails || {}).text || '') + ' ' + (((m.params.exceptionDetails || {}).exception || {}).description || '').slice(0, 200));
    }
    if (m.method === 'Log.entryAdded') {
      const e = m.params.entry || {};
      if (e.level === 'error' || e.level === 'warning') R.errors.push(e.level + ': ' + String(e.text || '').slice(0, 200));
    }
    if (m.method === 'Network.loadingFailed') {
      R.failedRequests.push(String((m.params.errorText || '')).slice(0, 120));
    }
  };
  const cmd = (method, params = {}) => new Promise((res, rej) => {
    const i = ++seq; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 90000);
  });
  const js = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __evalError: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result && r.result.value;
  };

  await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Log.enable');
  await cmd('Network.setBypassServiceWorker', { bypass: true });
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: BASE });
  await sleep(19000);

  // ---- 1. 挂载 / 资源 / 全局对象 ----
  R.checks.mount = await js(`JSON.stringify((function(){
    var S = window.S;
    return {
      htmlFlag: document.documentElement.getAttribute('data-s-bridge'),
      injected: Array.prototype.map.call(document.querySelectorAll('link[href^="s-"],script[src^="s-"]'), function(x){return x.getAttribute('href')||x.getAttribute('src');}),
      styleCssBeforeNew: (function(){var a=[...document.querySelectorAll('link[rel=stylesheet]')].map(function(x){return x.getAttribute('href')||'';});return a.indexOf('style.css') < a.findIndex(function(x){return /^s-/.test(x);});})(),
      sScopeCount: document.querySelectorAll('.s-scope').length,
      tScopeCount: document.querySelectorAll('.t-scope').length,
      SType: typeof S,
      SKeys: S ? Object.keys(S) : [],
      runSelfTest: S ? typeof S.runSelfTest : 'no S',
      collectCls: S ? typeof S.collectCls : 'no S',
      docHeight: document.documentElement.scrollHeight,
      horizontalOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      preMainPanels: !!document.getElementById('preMainPanels'),
      reportPanel: !!document.getElementById('reportPanel'),
      hasKpi384: (document.body.innerText||'').indexOf('38.4') >= 0
    };
  })())`);

  // ---- 2. 新增 CSS 命中面（CSSOM 规则是否碰到旧 DOM） ----
  R.checks.cssHitSurface = await js(`JSON.stringify((function(){
    function walk(rules, bucket){
      Array.prototype.forEach.call(rules, function(r){
        if (r.cssRules) { walk(r.cssRules, bucket); return; }
        if (!r.selectorText) return;
        r.selectorText.split(',').forEach(function(sel){
          bucket.total++;
          try {
            var n = document.querySelectorAll(sel.trim()).length;
            if (n > 0) { bucket.matched++; if (bucket.samples.length < 12) bucket.samples.push({sel: sel.trim().slice(0,90), n: n}); }
          } catch(e) {}
        });
      });
    }
    var out = [];
    Array.prototype.forEach.call(document.styleSheets, function(ss){
      var href = ss.href || '';
      if (!/s-(tokens|components|bridge)\\.css/.test(href)) return;
      var b = {file: href.split('/').pop(), total: 0, matched: 0, samples: []};
      try { walk(ss.cssRules, b); } catch(e) { b.error = String(e); }
      out.push(b);
    });
    return out;
  })())`);

  // ---- 3. computedStyle 采样：摘除三个新 <link> 前后逐元素比对 ----
  const SAMPLER = `(function(){
    var els = [], seen = new Set();
    var ids = document.querySelectorAll('[id]');
    var all = document.querySelectorAll('body *');
    for (var i=0;i<ids.length && els.length<260;i++){ if(!seen.has(ids[i])){seen.add(ids[i]);els.push(ids[i]);} }
    for (var j=0;j<all.length && els.length<520;j++){ if(!seen.has(all[j])){seen.add(all[j]);els.push(all[j]);} }
    var props=['display','position','background-color','color','font-size','font-family','margin-top','margin-left','padding-top','border-top-width','width','height','overflow-x','overflow-y','opacity','z-index','line-height','transform'];
    return els.map(function(e){
      var cs=getComputedStyle(e), o={t:e.tagName, i:e.id, c:(typeof e.className==='string'?e.className:'').slice(0,50)};
      props.forEach(function(p){o[p]=cs.getPropertyValue(p);});
      var r=e.getBoundingClientRect(); o.r=[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];
      return o;
    });
  })()`;
  const before = await js(`window.__cssBefore = ${SAMPLER}; window.__cssBefore.length;`);
  const removed = await js(`(function(){
    var n=0; Array.prototype.forEach.call(document.querySelectorAll('link[href^="s-"]'),function(x){x.disabled=true;n++;});
    return n;
  })()`);
  await sleep(600);
  const after = await js(`window.__cssAfter = ${SAMPLER}; window.__cssAfter.length;`);
  R.checks.cssZeroImpact = await js(`JSON.stringify((function(){
    var a=window.__cssBefore||[], b=window.__cssAfter||[], diffs=[];
    for (var i=0;i<Math.min(a.length,b.length);i++){
      var ka=JSON.stringify(a[i]), kb=JSON.stringify(b[i]);
      if (ka!==kb && diffs.length<8) diffs.push({idx:i, el:a[i].t+'#'+a[i].i, sampleKeys:Object.keys(a[i]).filter(function(k){return a[i][k]!==b[i][k];})});
    }
    return {sampled: Math.min(a.length,b.length), disabledLinks: ${removed}, diffCount: (function(){var n=0;for(var i=0;i<Math.min(a.length,b.length);i++){if(JSON.stringify(a[i])!==JSON.stringify(b[i]))n++;}return n;})(), diffs: diffs};
  })())`);
  // 恢复
  await js(`(function(){Array.prototype.forEach.call(document.querySelectorAll('link[href^="s-"]'),function(x){x.disabled=false;});return 1})()`);

  // ---- 4. S 接口实调 ----
  R.checks.collectClsCall = await js(`(function(){
    try { var p = window.S.collectCls(); return {ok:true, type: typeof p, then: typeof (p&&p.then)}; }
    catch(e){ return {ok:false, error: String(e && e.message || e)}; }
  })()`);
  R.checks.runSelfTest = await js(`(function(){
    try { return window.S.runSelfTest(); } catch(e){ return {__throw: String(e && e.message || e)}; }
  })()`);

  // ---- 5. 首屏截图 ----
  const shot = await cmd('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(OUT, 'design/assets/阶段0首屏.png'), Buffer.from(shot.data, 'base64'));

  // ---- 6. 工作台深链冒烟 ----
  await cmd('Page.navigate', { url: BASE + '?view=terminal' });
  await sleep(16000);
  R.checks.terminalSmoke = await js(`JSON.stringify((function(){
    return {
      tRoot: !!document.getElementById('tRoot'),
      navButtons: document.querySelectorAll('.t-nav button').length,
      tScope: document.querySelectorAll('.t-scope').length,
      sScope: document.querySelectorAll('.s-scope').length,
      fixedEntry: (function(){var b=[...document.querySelectorAll('button')].find(function(x){return /图表终端/.test(x.innerText||'')});return b?{text:b.innerText,id:b.id||'',fixed:getComputedStyle(b).position}:null;})(),
      docHeight: document.documentElement.scrollHeight,
      bodyTextHead: (document.body.innerText||'').replace(/\s+/g,' ').slice(0,160)
    };
  })())`);

  R.errors = R.errors.slice(0, 25);
  R.failedRequests = R.failedRequests.slice(0, 25);
  fs.writeFileSync(path.join(OUT, 'design/assets/阶段0线上核验.json'), JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 2));
  ws.close();
}

main().catch(e => { console.error('FATAL', e); process.exitCode = 1; })
  .finally(() => { try { child.kill(); } catch (e) {} });
