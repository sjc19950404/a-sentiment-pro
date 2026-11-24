/* 原型视觉稿渲染 + 响应式自检
 * 用法：node design/shots.cjs
 * 产物：design/assets/*.png、design/assets/自检报告.json
 * 说明：全部走本地 file://，不依赖网络与代理。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/app 1/2026-11-14-21-47-50';
const DIR = path.join(ROOT, 'design');
const ASSETS = path.join(DIR, 'assets');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 10123;
const PROFILE = path.join(DIR, '_shots_profile');
const BASE = 'file:///D:/app%201/2026-11-14-21-47-50/design/prototype/index.html';

const SHOTS = [
  { name: '01_桌面_总览首屏', w: 1440, h: 1000, q: '' },
  { name: '02_桌面_总览全页', w: 1440, h: 1000, full: true, q: '' },
  { name: '03_桌面_回测明细抽屉', w: 1440, h: 1000, q: '?demo=drawer' },
  { name: '04_桌面_回测视图', w: 1440, h: 1000, q: '?view=backtest' },
  { name: '05_桌面_浅色主题', w: 1440, h: 1000, q: '?theme=light' },
  { name: '06_桌面_骨架态', w: 1440, h: 1000, q: '?demo=skeleton' },
  { name: '07_移动_总览首屏', w: 390, h: 844, mobile: true, q: '' },
  { name: '08_移动_总览全页', w: 390, h: 844, mobile: true, full: true, q: '' },
  { name: '09_移动_明细抽屉全屏', w: 390, h: 844, mobile: true, q: '?demo=drawer' },
  { name: '10_移动_更多抽屉', w: 390, h: 844, mobile: true, q: '?demo=drawer-more' },
  { name: '11_平板_总览', w: 834, h: 1112, q: '' },
  { name: '12_桌面_个股详情抽屉', w: 1440, h: 1000, q: '?demo=drawer-small' },
];

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--no-proxy-server', '--allow-file-access-from-files',
  '--disable-background-networking', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, `--window-size=1440,1000`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let ver = null;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(300);
  }
  if (!ver) throw new Error('CDP 未启动');
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pend = new Map();
  ws.onmessage = async ev => {
    let s = ev.data;
    if (typeof s !== 'string') { if (s && typeof s.text === 'function') s = await s.text(); else s = Buffer.from(s).toString('utf8'); }
    let m; try { m = JSON.parse(s); } catch (e) { return; }
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const cmd = (method, params = {}) => new Promise((res, rej) => {
    const i = ++seq; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 60000);
  });

  await cmd('Page.enable');
  await cmd('Runtime.enable');

  const report = [];
  for (const s of SHOTS) {
    const H = s.full ? s.h : s.h;
    await cmd('Emulation.setDeviceMetricsOverride', {
      width: s.w, height: H, deviceScaleFactor: 1, mobile: !!s.mobile
    });
    await cmd('Page.navigate', { url: BASE + s.q });
    await sleep(1400);

    const st = await cmd('Runtime.evaluate', {
      expression: `JSON.stringify({
        height: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        title: document.title,
        cards: document.querySelectorAll('.s-card').length,
        svgPaths: document.querySelectorAll('svg path').length,
        drawerOpen: !document.getElementById('drawer').hidden,
        theme: document.getElementById('scope').getAttribute('data-theme'),
        overflowEls: [...document.querySelectorAll('.s-scope *')].filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed';
        }).slice(0, 6).map(e => e.className || e.tagName),
        innerScrollers: [...document.querySelectorAll('.s-scope *')].filter(e => {
          const o = getComputedStyle(e);
          return (o.overflowY === 'auto' || o.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 8;
        }).length,
        errors: window.__errs || []
      })`, returnByValue: true
    });
    const info = JSON.parse(st.result.value);

    // 全页：把视口撑到真实内容高度再截，避免 captureBeyondViewport 的兼容差异
    let shotH = H;
    if (s.full) {
      shotH = Math.min(Math.max(info.height, H), 9000);
      await cmd('Emulation.setDeviceMetricsOverride', {
        width: s.w, height: shotH, deviceScaleFactor: 1, mobile: !!s.mobile
      });
      await sleep(400);
    }
    const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const out = path.join(ASSETS, s.name + '.png');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    const bytes = fs.statSync(out).size;
    report.push({ name: s.name, width: s.w, height: shotH, bytes, ...info });
    console.log(`${s.name} → ${s.w}×${shotH} / 页高 ${info.height} / 横向溢出 ${info.overflowEls.length} / 盒内滚动 ${info.innerScrollers} / 抽屉 ${info.drawerOpen} / ${bytes}B`);
  }
  fs.writeFileSync(path.join(ASSETS, '自检报告.json'), JSON.stringify(report, null, 2));
  console.log('DONE', report.length, 'shots');
  ws.close(); child.kill();
}
main().catch(e => { console.error('FAIL', e); child.kill(); process.exit(1); });
