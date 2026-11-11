#!/usr/bin/env node
/**
 * 首板晋级盯盘·行动版（2026-11-11 用户拍板「现在就要动手」）。
 * 每分钟跑（cron 9-15 点）：昨日首板池实时报价 → 状态机事件检测（src/first_board_alert.js）
 *   → 有事件推企微（OPS_WEBHOOK，一条合并报文）；无事件静默退出（零成本）。
 * 状态持久化 data/first_board_alert_state.json（每日重置）；频控 seal2/break3/touch1/approach1、日 cap60。
 * 纪律：只推事件提醒，不下单、不改仓位；非交易时段/节假日直接退出。
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { detectEvents, buildAlertText, strongSectors, ALERT_DEFAULTS } from '../src/first_board_alert.js';
import { adjustThreshold } from '../src/regime_threshold.js';
import { computeEmotion } from '../src/emotion_cycle.js';
import { isMainBoardCode } from '../src/first_board.js';
import { loadCalendar, isTradingDay } from '../src/calendar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'data/first_board_alert_state.json');

function bjNow() { return new Date(Date.now() + 8 * 3600000); }
const today = () => bjNow().toISOString().slice(0, 10);
const bjHm = () => { const d = bjNow(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const secid = (c) => (/^(6|9)/.test(c) ? '1.' : '0.') + c;

// 交易时段硬门禁（9:25-11:35 / 12:55-15:05 + 交易日）：盘外跑是纯浪费还可能拿旧价
// FB_ALERT_DRY=1 干跑：跳过门禁+不推企微，打印事件明细——开盘前自检盘中全链用（2026-11-11 体检加）
const DRY = process.env.FB_ALERT_DRY === '1';
const d0 = bjNow(); const tmin = d0.getUTCHours() * 60 + d0.getUTCMinutes();
const inSession = (tmin >= 565 && tmin <= 695) || (tmin >= 775 && tmin <= 905);
const isTrading = (() => {
  try { return isTradingDay(today(), loadCalendar()); } catch { return d0.getUTCDay() >= 1 && d0.getUTCDay() <= 5; }
})();
if (!DRY && (!inSession || !isTrading)) process.exit(0);

let prevState = { date: today(), notified: 0, stocks: {} };
try {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  if (s.date === today()) prevState = s;   // 跨日自动重置
} catch { /* 首日 */ }

try {
  const zt = JSON.parse(readFileSync(join(ROOT, 'data/ztpool_history.json'), 'utf8'));
  const days = (Array.isArray(zt) ? zt : []).filter((x) => x && Array.isArray(x.pool));
  const prev = days[days.length - 1];
  const firsts = (prev.pool || []).filter((p) => p && p.lbc === 1 && p.c)
    .filter((p) => isMainBoardCode(p.c));   // 2026-11-11 拍板：科创创业不进盯盘/推送
  if (!firsts.length) process.exit(0);

  // 实时报价（f124 校验行情日期=今日，昨日价绝不进状态机）
  const quotes = new Map();
  const codes = firsts.map((p) => String(p.c));
  for (let i = 0; i < codes.length; i += 100) {
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=' +
      codes.slice(i, i + 100).map(secid).join(',') +
      '&fields=f2,f3,f12,f14,f15,f16,f18,f124&ut=fa5fd1943c7b386f172d6893dbfba10b';
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
    // 地天识别（2026-11-11 拍板 A）：跌停幅与涨停幅同构（±10/±20/±5/±30），本地算跌停价；
    //   今日最低曾触及跌停价 + 现涨幅 ≥5% = 地天形态（豁免板块白名单）
    const downPrice = Math.round(+q.f18 * (1 - pct / 100) * 100) / 100;
    const didTouchDown = Number.isFinite(+q.f16) && +q.f16 <= downPrice + 0.005;
    const dtRebound = didTouchDown && Number.isFinite(+q.f3) && +q.f3 >= 5;
    snaps.push({
      code: String(p.c), name: q.f14 || p.n || String(p.c),
      sector: p.hybk || null, dtRebound,
      quote: { last: +q.f2, high: Number.isFinite(+q.f15) ? +q.f15 : null, chg: Number.isFinite(+q.f3) ? +q.f3 : null },
      limitPrice: Math.round(+q.f18 * (1 + pct / 100) * 100) / 100,
    });
  }
  // ── 范式驱动动态阈值 v1（2026-11-11 拍板两步方案第一步）──
  //   约定①：全局开关 ENABLE_REGIME_THRESHOLD 默认 false → shadow 模式（计算照跑/日志照打/阈值用基准）；
  //   约定③：当日池拉取失败/状态缺失/中性 → 全回基准，绝不报错；
  //   约定④：v1 仅 approachPct（逼近线）/ sectorMinChg（板块强门槛）两个核心阈值。
  let thresholdAdjust = { enabled: false, state: null, items: [] };
  let dynApproach = null, dynSectorChg = null;
  try {
    const ENABLE = process.env.ENABLE_REGIME_THRESHOLD === '1';
    const cfg = (JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')).paper || {}).regimeThreshold || {};
    let stateLabel = null;
    try {
      // 5 分钟缓存（2026-11-11 风控降频）：范式对时效要求 5 分钟级，池请求降为 1/5
      const regCache = join(ROOT, 'data/em_regime_cache.json');
      const regFresh = (() => { try { const st = statSync(regCache); if (Date.now() - st.mtimeMs < 300000) return JSON.parse(readFileSync(regCache, 'utf8')); } catch { } return null; })();
      let pool = [];
      if (regFresh && regFresh.state) { stateLabel = regFresh.state; }
      else {
      const ztUrl = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${today().replace(/-/g, '')}&_=${Date.now()}`;
      const zt = await (await fetch(ztUrl, { headers: { Referer: 'https://quote.eastmoney.com/' } })).json();
      pool = (zt.data && zt.data.pool) || [];
      if (pool.length) {
        let prevMetrics = null;
        try { const eh = JSON.parse(readFileSync(join(ROOT, 'data/emotion_history.json'), 'utf8')); const h = (eh && eh.history) || []; prevMetrics = h.length ? h[h.length - 1].metrics : null; } catch { /* 缺席不阻塞 */ }
        stateLabel = computeEmotion(pool, prevMetrics, today().replace(/-/g, '')).emotion;
        if (stateLabel) { try { writeFileSync(regCache, JSON.stringify({ ts: Date.now(), state: stateLabel })); } catch { } }
      }
      }
    } catch { /* 池失败 → stateLabel null → 基准 */ }
    const a1 = adjustThreshold('approachPct', ALERT_DEFAULTS.approachPct, stateLabel, cfg);
    const a2 = adjustThreshold('sectorMinChg', 2, stateLabel, cfg);   // 2 = SECTOR_DEFAULTS.minChg 基准
    thresholdAdjust = { enabled: ENABLE, state: stateLabel, items: [a1, a2] };
    if (ENABLE && a1.adjusted) dynApproach = a1.final;
    if (ENABLE && a2.adjusted) dynSectorChg = a2.final;
    if (a1.adjusted || a2.adjusted) {
      console.log(`[fb-alert][${ENABLE ? 'REGIME' : 'shadow'}] ${bjHm()} 范式=${stateLabel} 逼近线${a1.final}%（×${a1.multiplier}）板块门槛${a2.final}%（×${a2.multiplier}）${ENABLE ? '' : '——shadow 不生效'}`);
    }
  } catch { /* 动态阈值自身异常 → 全基准（约定③） */ }

  // 实时强板块（2026-11-11 拍板：A 涨幅≥2% + 普涨度>70%）∪ 昨日主线板块 = 推送白名单
  let allowSectors = new Set();
  try {
    // 5 分钟缓存（2026-11-11 风控降频）：pz=520 是最大请求，白名单变化慢 → 降为 1/5
    const secCache = join(ROOT, 'data/sector_rank_cache.json');
    const secFresh = (() => { try { const st = statSync(secCache); if (Date.now() - st.mtimeMs < 300000) return JSON.parse(readFileSync(secCache, 'utf8')); } catch { } return null; })();
    let rows = secFresh && Array.isArray(secFresh.rows) ? secFresh.rows : null;
    if (!rows) {
      const bUrl = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=520&po=1&np=1&fltt=2&fid=f3&fs=m:90+t:2&fields=f3,f12,f14,f104,f105&ut=fa5fd1943c7b386f172d6893dbfba10b';
      const bj = await (await fetch(bUrl, { headers: { Referer: 'https://quote.eastmoney.com/' } })).json();
      rows = ((bj.data && bj.data.diff) || []).map((b) => ({ sector: b.f14, chg: +b.f3, up: +b.f104, down: +b.f105 }));
      try { writeFileSync(secCache, JSON.stringify({ ts: Date.now(), rows })); } catch { }
    }
    allowSectors = strongSectors(rows, dynSectorChg != null ? { minChg: dynSectorChg } : {});
  } catch { /* 板块排行失败 → 白名单退化为仅昨日主线（fail-open） */ }
  try {
    const mt = JSON.parse(readFileSync(join(ROOT, 'data/main_theme_history.json'), 'utf8'));
    const lastMt = Array.isArray(mt.days) && mt.days.length ? mt.days[mt.days.length - 1] : null;
    for (const t of (lastMt && lastMt.main_themes) || []) if (t && t.name) allowSectors.add(t.name);
  } catch { /* 主线档缺席不阻塞 */ }
  const { events, state } = detectEvents(prevState, snaps, {
    pushFilter: (sector) => !!sector && allowSectors.has(sector),
    ...(dynApproach != null ? { approachPct: dynApproach } : {}),   // 条件展开：undefined 会覆盖默认值
  });
  state.threshold_adjust = thresholdAdjust;   // 约定②：审计字段完整落档（key/base/regime/multiplier/final）
  // 基率参考（读取观察档的分层统计，缺失不阻塞）
  let baseRate = null;
  try {
    const w = JSON.parse(readFileSync(join(ROOT, 'data/first_board_watch.json'), 'utf8'));
    const st = Array.isArray(w) && w.length ? w[w.length - 1].stats : null;
    const early = st && st.byFbt && st.byFbt['早板(9:25-10:00)'];
    baseRate = early && Number.isFinite(early.rate) ? early.rate : (st && st.total && st.total.rate) || null;
  } catch { /* 缺席不阻塞 */ }
  const msg = buildAlertText(events, { bj: bjHm(), baseRate });
  // 报文标注（约定②配套）：仅开关开启且阈值真的变了时加一行，读者知道当时的判定线不是默认值
  if (msg && thresholdAdjust.enabled) {
    const adj = thresholdAdjust.items.filter((a) => a.adjusted);
    if (adj.length) msg.text += `\n〔阈值随范式（${thresholdAdjust.state}）调整：${adj.map((a) => a.key + '=' + a.final + '（×' + a.multiplier + '）').join('、')}〕`;
  }
  if (DRY) {
    console.log(`[fb-alert][DRY] snaps=${snaps.length} dtRebound=${snaps.filter((s) => s.dtRebound).length} 事件=${events.length}`);
    if (events.length) console.log('[fb-alert][DRY] 报文预览:\n' + (msg ? msg.text : '(null)'));
    else console.log('[fb-alert][DRY] 无事件——全链 IO（行情/板块/主线/状态机）正常');
    process.exit(0);   // 干跑不落 state
  }
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
  // 白名单可观测性：被板块过滤掉的 tick 留痕（弱板块池外事件不推是设计行为，但要能从日志看出）
  const suppressed = snaps.length && state.stocks && Object.values(state.stocks).length;
  if (events.length === 0 && suppressed && process.env.FB_ALERT_DEBUG === '1') {
    console.log(`[fb-alert] ${bjHm()} 白名单 ${allowSectors.size} 板块（实时强∪昨日主线）——本 tick 无白名单事件`);
  }
} catch (e) {
  console.error('[fb-alert] 异常（fail-open）:', e && e.message);
  process.exit(1);
}
