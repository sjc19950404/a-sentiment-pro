#!/usr/bin/env node
/**
 * 东财 API 封禁恢复探测（2026-11-11 体检发现 IP 被风控后加，一次性自删）。
 * 每 30 分钟轻探一次 push2 行情接口；恢复 → 推企微「已恢复」并自删 cron 行（EM-PROBE 标记）。
 * 探测请求 1 个/30 分钟，不会加重风控。
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bj = () => new Date(Date.now() + 8 * 3600000);

let ok = false;
try {
  const r = await fetch('https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001&fields=f12&ut=fa5fd1943c7b386f172d6893dbfba10b', { headers: { Referer: 'https://quote.eastmoney.com/' } });
  const t = await r.text();
  ok = r.ok && t.includes('"rc"') || r.ok && t.length > 20;   // 正常返回 JSON
} catch { ok = false; }
console.log(`[em-probe] ${bj().toTimeString ? new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 19) : ''} 东财 API ${ok ? '可达 ✓' : '仍被封/不可达'}`);

if (ok) {
  const env = (() => { try { const s = readFileSync(join(ROOT, '.env'), 'utf8'); const m = s.match(/OPS_WEBHOOK=([^\r\n]+)/); return m ? m[1].trim() : null; } catch { return null; } })();
  const msg = `🟢【东财接口恢复】${new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 19)} 探测通过——盘中链路（盯盘/竞价/池采集）明天可正常运行。已自动停止探测。`;
  console.log(msg);
  if (env) {
    try { await fetch(env, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: msg } }) }); } catch {}
  }
  // 自删 cron 行（EM-PROBE 标记）
  try {
    const cur = execSync('crontab -l', { encoding: 'utf8' });
    const kept = cur.split('\n').filter((l) => !l.includes('EM-PROBE')).join('\n') + '\n';
    execSync('crontab -', { input: kept });
    console.log('[em-probe] 探测 cron 已自删');
  } catch (e) { console.error('[em-probe] 自删失败（手动清理）:', e && e.message); }
}
