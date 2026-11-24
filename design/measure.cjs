/* 量测 KPI 卡与骨架卡的真实高度差，用于验证「替换零位移」 */
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'file:///D:/app%201/2026-11-14-21-47-50/design/prototype/index.html';
const PORT = 10124;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--no-proxy-server',
  '--allow-file-access-from-files','--hide-scrollbars',`--remote-debugging-port=${PORT}`,
  '--user-data-dir=D:/app 1/2026-11-14-21-47-50/design/_measure_profile','--window-size=1440,1000','about:blank'],
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
  const cmd=(method,params={})=>new Promise((res,rej)=>{const i=++seq;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}));setTimeout(()=>{if(pend.has(i)){pend.delete(i);rej(new Error('timeout'));}},30000);});
  await cmd('Page.enable'); await cmd('Runtime.enable');
  for(const q of ['', '?demo=skeleton']){
    await cmd('Page.navigate',{url:BASE+q}); await sleep(1200);
    const r=await cmd('Runtime.evaluate',{expression:`JSON.stringify({
      pageH:document.documentElement.scrollHeight,
      kpiH:[...document.querySelectorAll('#kpiGrid > .s-card')].map(e=>+e.getBoundingClientRect().height.toFixed(1)),
      gridTop:+document.getElementById('kpiGrid').getBoundingClientRect().top.toFixed(1),
      verdictBottom:+document.getElementById('verdict').getBoundingClientRect().bottom.toFixed(1)
    })`,returnByValue:true});
    console.log(q||'(真实态)',JSON.stringify(JSON.parse(r.result.value)));
  }
  ws.close(); child.kill();
}
main().catch(e=>{console.error(e);child.kill();process.exit(1);});
