#!/usr/bin/env node
/**
 * 跌停反包盯盘·行动版（2026-11-11 用户拍板 B）。
 * 每分钟跑：昨日跌停池（data/dtpool_history.json）→ 实时报价 → 反包状态机
 *   （src/dt_rebound.js：脱离跌停/翻红/反包封板地天/地天炸板）→ 企微推送。
 * 无板块过滤（反包=逆板块独立行情，拍板原意即抓此）；频控 lift1/red1/seal1/dtBreak2、日 cap40。
 * 依赖：dtpool_history.json（fetch_dtpool.mjs EOD 采集，11-11 起逐日攒）；首日无昨日档自动跳过。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { detectEvents, buildAlertText } from '../src/dt_rebound.js';
import { limitUpPct } from '../src/limit_caliber.js';
import { loadCalendar, isTradingDay } from '../src/calendar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'data/dt_rebound_state.json');

function bjNow() { return new Date(Date.now() + 8 * 3600000); }
const today = () => bjNow().toISOString().slice(0, 10);
const bjHm = () => { const d = bjNow(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const secid = (c) => (/^(6|9)/.test(c) ? '1.' : '0.') + c;

const d0 = bjNow(); const tmin = d0.getUTCHours() * 60 + d0.getUTCMinutes();
const inSession = (tmin >= 565 && tmin <= 695) || (tmin >= 775 && tmin <= 905);
const isTrading = (() => {
  try { return isTradingDay(today(), loadCalendar()); } catch { return d0.getUTCDay() >= 1 && d0.getUTCDay() <= 5; }
})();
if (!inSession || !isTrading) process.exit(0);

let prevState = { date: today(), notified: 0, stocks: {} };
try {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  if (s.date === today()) prevState = s;
} catch { /* 首日 */ }

try {
  const dtHist = JSON.parse(readFileSync(join(ROOT, 'data/dtpool_history.json'), 'utf8'));
  const days = (Array.isArray(dtHist) ? dtHist : []).filter((x) => x && Array.isArray(x.pool));
  // 昨日跌停池 = 今日之前最近一条（今日跌停池要等 EOD）
  const prevDays = days.filter((x) => x.date < today());
  const prev = prevDays.length ? prevDays[prevDays.length - 1] : null;
  const dts = prev ? (prev.pool || []).filter((p) => p && p.c) : [];
  if (!dts.length) process.exit(0);   // 昨日无跌停票 / 档未开（11-11 首采）——静默

  const quotes = new Map();
  const codes = dts.map((p) => String(p.c));
  for (let i = 0; i < codes.length; i += 100) {
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=' +
      codes.slice(i, i + 100).map(secid).join(',') +
      '&fields=f2,f3,f12,f14,f15,f18,f124&ut=fa5fd1943c7b386f172d6893dbfba10b';
    const j = await (await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com/' } })).json();
    for (const q of (j.data && j.data.diff) || []) quotes.set(String(q.f12), q);
  }
  const snaps = [];
  for (const p of dts) {
    const q = quotes.get(String(p.c));
    if (!q || !Number.isFinite(+q.f124) || new Date(+q.f124 * 1000 + 8 * 3600000).toISOString().slice(0, 10) !== today()) continue;
    if (!Number.isFinite(+q.f2) || !Number.isFinite(+q.f18)) continue;
    const pct = limitUpPct({ code: String(p.c), name: p.n || '' });
    snaps.push({
      code: String(p.c), name: q.f14 || p.n || String(p.c),
      quote: { last: +q.f2, chg: Number.isFinite(+q.f3) ? +q.f3 : null },
      dtPrice: Math.round(+q.f18 * (1 - pct / 100) * 100) / 100,
      limitPrice: Math.round(+q.f18 * (1 + pct / 100) * 100) / 100,
    });
  }
  const { events, state } = detectEvents(prevState, snaps);
  const msg = buildAlertText(events, { bj: bjHm() });
  if (msg && process.env.OPS_WEBHOOK) {
    const res = await fetch(process.env.OPS_WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: msg.text } }),
    });
    if (res.ok) {
      state.date = today();
      writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
      console.log(`[dt-alert] ${bjHm()} 推送 ${events.length} 事件：${events.map((e) => e.name + e.kind).join(',')}`);
    } else {
      console.error(`[dt-alert] 推送失败 HTTP ${res.status}——事件丢弃`);
    }
  } else {
    if (events.length) console.error('[dt-alert] 有事件但未配置 OPS_WEBHOOK——仅落 state');
    state.date = today();
    writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
  }
} catch (e) {
  console.error('[dt-alert] 异常（fail-open）:', e && e.message);
  process.exit(1);
}
