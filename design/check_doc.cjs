/* 校验主文档：所有视觉稿是否真加载、章节是否齐全、有无横向溢出 */
const { spawn } = require('child_process');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DOC = 'file:///D:/app%201/2026-11-14-21-47-50/design/UI%E8%AE%BE%E8%AE%A1%E6%96%B9%E6%A1%88.html';
const PORT = 10125;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--no-proxy-server',
  '--allow-file-access-from-files','--hide-scrollbars',`--remote-debugging-port=${PORT}`,
  '--user-data-dir=D:/app 1/2026-11-14-21-47-50/design/_check_profile','--window-size=1440,1100','about:blank'],
  { stdio:'ignore', windowsHide:true });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function main(){
  let ok=false;
  for(let i=0;i<50;i++){ try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/version`); if(r.ok){ok=true;break;} }catch(e){} await sleep(300); }
  if(!ok) throw new Error('CDP 未启动');
  const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pend=new Map();
  ws.onmessage=ev=>{ let s=ev.data; if(typeof s!=='string') s=Buffer.from(s).toString('utf8'); let m; try{m=JSON.parse(s);}catch(e){return;}
    if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);} };
  const cmd=(method,params={})=>new Promise((res,rej)=>{const i=++seq;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}));setTimeout(()=>{if(pend.has(i)){pend.delete(i);rej(new Error('timeout'));}},40000);});
  await cmd('Page.enable'); await cmd('Runtime.enable');
  await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await cmd('Page.navigate',{url:DOC}); await sleep(3500);
  const r=await cmd('Runtime.evaluate',{expression:`JSON.stringify({
    imgs:[...document.querySelectorAll('.shot img')].map(i=>({src:decodeURIComponent(i.getAttribute('src')),ok:i.complete&&i.naturalWidth>0,w:i.naturalWidth})),
    sections:document.querySelectorAll('section[id]').length,
    svgs:document.querySelectorAll('svg').length,
    tables:document.querySelectorAll('table').length,
    overflow:[...document.querySelectorAll('main *')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.right>window.innerWidth+2;}).slice(0,8).map(e=>e.tagName+'.'+(typeof e.className==='string'?e.className:'')),
    pageH:document.documentElement.scrollHeight
  })`,returnByValue:true});
  const j=JSON.parse(r.result.value);
  const bad=j.imgs.filter(x=>!x.ok);
  console.log('视觉稿',j.imgs.length,'张｜加载失败',bad.length,bad.map(x=>x.src).join(', '));
  console.log('章节',j.sections,'｜SVG',j.svgs,'｜表格',j.tables,'｜疑似溢出',JSON.stringify(j.overflow),'｜页高',j.pageH);
  await cmd('Runtime.evaluate',{expression:`document.documentElement.style.scrollBehavior='auto';window.scrollTo({top:document.getElementById('s7').offsetTop-20,behavior:'instant'});`});
  await sleep(900);
  const sy=await cmd('Runtime.evaluate',{expression:`String(window.scrollY)`,returnByValue:true});
  console.log('scrollY',sy.result.value);
  const shot=await cmd('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('D:/app 1/2026-11-14-21-47-50/design/assets/_doc_gallery.png',Buffer.from(shot.data,'base64'));
  console.log('gallery screenshot saved');
  ws.close(); child.kill();
}
main().catch(e=>{console.error(e);child.kill();process.exit(1);});
