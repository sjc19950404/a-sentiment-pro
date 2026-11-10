#!/usr/bin/env node
/**
 * 首板晋级盯盘·行动版（2026-11-11 用户拍板「现在就要动手」）。
 * 每分钟跑（cron 9-15 点）：昨日首板池实时报价 → 状态机事件检测（src/first_board_alert.js）
 *   → 有事件推企微（OPS_WEBHOOK，一条合并报文）；无事件静默退出（零成本）。
 * 状态持久化 data/first_board_alert_state.json（每日重置）；频控 seal2/break3/touch1/approach1、日 cap60。
 * 纪律：只推事件提醒，不下单、不改仓位；非交易时段/节假日直接退出。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { detectEvents, buildAlertText, ALERT_DEFAULTS } from '../src/first_board_alert.js';
import { loadCalendar, isTradingDay } from '../src/calendar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'data/first_board_alert_state.json');

function bjNow() { return new Date(Date.now() + 8 * 3600000); }
const today = () => bjNow().toISOString().slice(0, 10);
const bjHm = () => { const d = bjNow(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const secid = (c) => (/^(6|9)/.test(c) ? '1.' : '0.') + c;

// 交易时段硬门禁（9:25-11:35 / 12:55-15:05 + 交易日）：盘外跑是纯浪费还可能拿旧价
const d0 = bjNow(); const tmin = d0.getUTCHours() * 60 + d0.getUTCMinutes();
const inSession = (tmin >= 565 && tmin <= 695) || (tmin >= 775 && tmin <= 905);
const isTrading = (() => {
  try { return isTradingDay(today(), loadCalendar()); } catch { return d0.getUTCDay() >= 1 && d0.getUTCDay() <= 5; }
})();
if (!inSession || !isTrading) process.exit(0);

let prevState = { date: today(), notified: 0, stocks: {} };
try {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  if (s.date === today()) prevState = s;   // 跨日自动重置
} catch { /* 首日 */ }

try {
  const zt = JSON.parse(readFileSync(join(ROOT, 'data/ztpool_history.json'), 'utf8'));
  const days = (Array.isArray(zt) ? zt : []).filter((x) => x && Array.isArray(x.pool));
  const prev = days[days.length - 1];
  const firsts = (prev.pool || []).filter((p) => p && p.lbc === 1 && p.c);
  if (!firsts.length) process.exit(0);

  // 实时报价（f124 校验行情日期=今日，昨日价绝不进状态机）
  const quotes = new Map();
  const codes = firsts.map((p) => String(p.c));
  for (let i = 0; i < codes.length; i += 100) {
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=' +
      codes.slice(i, i + 100).map(secid).join(',') +
      '&fields=f2,f3,f12,f14,f15,f18,f124&ut=fa5fd1943c7b386f172d6893dbfba10b';
    const j = await (await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com/' } })).json();
    for (const q of (j.data && j.data.diff) || []) quotes.set(String(q.f12), q);
  }
  const { limitUpPct } = await import('../src/limit_caliber.js');
  const snaps = [];
  for (const p of firsts) {
    const q = quotes.get(String(p.c));
    if (!q || !Number.isFinite(+q.f124) || new Date(+q.f124 * 1000 + 8 * 3600000).toISOString().slice(0, 10) !== today()) continue;
    if (!Number.isFinite(+q.f2) || !Number.isFinite(+q.f18)) continue;
    const pct = limitUpPct({ code: String(p.c), name: p.n || '' });
    snaps.push({
      code: String(p.c), name: q.f14 || p.n || String(p.c),
      quote: { last: +q.f2, high: Number.isFinite(+q.f15) ? +q.f15 : null, chg: Number.isFinite(+q.f3) ? +q.f3 : null },
      limitPrice: Math.round(+q.f18 * (1 + pct / 100) * 100) / 100,
    });
  }
  const { events, state } = detectEvents(prevState, snaps);
  // 基率参考（读取观察档的分层统计，缺失不阻塞）
  let baseRate = null;
  try {
    const w = JSON.parse(readFileSync(join(ROOT, 'data/first_board_watch.json'), 'utf8'));
    const st = Array.isArray(w) && w.length ? w[w.length - 1].stats : null;
    const early = st && st.byFbt && st.byFbt['早板(9:25-10:00)'];
    baseRate = early && Number.isFinite(early.rate) ? early.rate : (st && st.total && st.total.rate) || null;
  } catch { /* 缺席不阻塞 */ }
  const msg = buildAlertText(events, { bj: bjHm(), baseRate });
  if (msg && process.env.OPS_WEBHOOK) {
    const res = await fetch(process.env.OPS_WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: msg.text } }),
    });
    if (res.ok) {
      state.date = today();
      writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
      console.log(`[fb-alert] ${bjHm()} 推送 ${events.length} 事件：${events.map((e) => e.name + e.kind).join(',')}`);
    } else {
      console.error(`[fb-alert] 企微推送失败 HTTP ${res.status}——事件丢弃（state 不前进，下轮重试同事件会被频控拦）`);
    }
  } else {
    // 无事件/未配 webhook：state 仍要前进（记录最新 pos），但 notified 语义=已推送数
    if (events.length) console.error('[fb-alert] 有事件但未配置 OPS_WEBHOOK——仅落 state 不推');
    state.date = today();
    writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
  }
} catch (e) {
  console.error('[fb-alert] 异常（fail-open）:', e && e.message);
  process.exit(1);
}
