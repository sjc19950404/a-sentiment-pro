/**
 * verify_phase0_css2.cjs — 阶段 0 CSS 作用域精确核验（只读）
 * 补 verify_phase0_live.cjs 的 CSSOM 统计，专查三件事：
 *   a) 三个新样式表实际规则数 / 全部选择器；
 *   b) s-bridge.css 的 .t-scope 规则是否命中旧视图并改变 isolation；
 *   c) 05 册自检脚本的多选择器列表缺少 .s-scope 前缀，导致旧 DOM 被误计入。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const OUT = 'D:/app 1/2026-11-14-21-47-50';
const BASE = 'https://sjc19950404.github.io/a-sentiment-pro/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.CDP_PORT || 10032);
const PROXY = process.env.https_proxy || process.env.HTTPS_PROXY || 'http://127.0.0.1:52694';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, '_cdp_phase0b')}`,
  `--proxy-server=${PROXY}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });

const R = {};
async function main() {
  let ver = null;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ver = await r.json(); break; } } catch (e) {} await sleep(400); }
  if (!ver) throw new Error('CDP 未启动');
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => {
    let s = ev.data; if (typeof s !== 'string') s = String(s);
    let m; try { m = JSON.parse(s); } catch (e) { return; }
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const cmd = (method, params = {}) => new Promise((res, rej) => {
    const i = ++seq; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 60000);
  });
  const js = async e => { const r = await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.value; };

  await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable');
  await cmd('Network.setBypassServiceWorker', { bypass: true });
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: BASE });
  await sleep(14000);

  R.stylesheets = await js(`JSON.stringify(Array.prototype.map.call(document.styleSheets, function(ss){
    var n; try { n = ss.cssRules.length; } catch(e) { n = 'SecurityError'; }
    return {href: (ss.href||'inline').split('/').pop(), rules: n, disabled: !!ss.disabled};
  }))`);

  R.bridgeRules = await js(`JSON.stringify((function(){
    var out=[];
    Array.prototype.forEach.call(document.styleSheets, function(ss){
      if(!/s-bridge/.test(ss.href||'')) return;
      try { Array.prototype.forEach.call(ss.cssRules, function(r){
        if(r.selectorText) out.push({sel:r.selectorText, decl:r.style&&r.style.cssText});
      }); } catch(e) { out.push({err:String(e)}); }
    });
    return out;
  })())`);

  R.tScopeImpact = await js(`JSON.stringify((function(){
    var t=document.querySelector('.t-scope');
    if(!t) return {present:false};
    var cs=getComputedStyle(t);
    var btn=Array.prototype.filter.call(document.querySelectorAll('button'),function(x){return /图表终端/.test(x.innerText||'');})[0];
    return {
      present:true, tag:t.tagName, id:t.id,
      isolation: cs.getPropertyValue('isolation'), contain: cs.getPropertyValue('contain'),
      fixedEntryInsideTScope: btn ? !!btn.closest('.t-scope') : null,
      fixedEntryParent: btn ? btn.parentElement.tagName+'#'+btn.parentElement.id : null
    };
  })())`);

  // 摘除 s-bridge.css 单文件，观察 .t-scope 的 isolation 是否回落
  R.bridgeOff = await js(`(function(){
    var l=Array.prototype.filter.call(document.querySelectorAll('link'),function(x){return /s-bridge/.test(x.getAttribute('href')||'');})[0];
    if(l){l.disabled=true;}
    var t=document.querySelector('.t-scope');
    return JSON.stringify({disabled:!!l, isolationAfter:t?getComputedStyle(t).getPropertyValue('isolation'):null});
  })()`);

  R.selectorListBug = await js(`JSON.stringify((function(){
    var sel = "button, a[href], input, select, textarea, summary, [role='tab'], [role='button'], [tabindex='0']";
    var scopedAll = ".s-scope " + sel;
    var properlyScoped = sel.split(', ').map(function(s){return '.s-scope '+s;}).join(', ');
    return {
      sScopeCount: document.querySelectorAll('.s-scope').length,
      asWrittenHits: document.querySelectorAll(scopedAll).length,
      properlyScopedHits: document.querySelectorAll(properlyScoped).length,
      note: '05 册 checkTouchTargets/checkContrast 的逗号列表只有第一项带 .s-scope 前缀'
    };
  })())`);

  fs.writeFileSync(path.join(OUT, 'design/assets/阶段0CSS核验.json'), JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 2));
  ws.close();
}
main().catch(e => { console.error('FATAL', e); process.exitCode = 1; })
  .finally(() => { try { child.kill(); } catch (e) {} });
