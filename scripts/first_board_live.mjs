#!/usr/bin/env node
/**
 * 首板晋级盯盘（2026-11-11 用户指正后落地）：**昨日首板池 → 今日盘中谁可能晋级**。
 *
 * 与 first_board_watch.mjs 的分工（两者互补，不重复）：
 *   · first_board_watch（EOD）：今日首板 → 明日晋级预期（盘后静态观察档 + 次日对账）；
 *   · 本脚本（盘中）：**昨日首板池** → 今日实时进程（已封板晋级 / 触板炸板 / 逼近 / 未启动），
 *     回答的是「还没晋级的、今天可能晋级的首板是哪些」。
 *
 * 判定（涨停价本地算，走 limit_caliber 分板块阈值；不信任接口涨跌停字段）：
 *   · sealed    已晋级：现价 ≥ 涨停价 - 0.005
 *   · broken    触板炸板：今日最高 ≥ 涨停价 但现价 < 涨停价（曾摸板未封住——晋级失败风险最高的一档）
 *   · approaching 逼近：涨幅 ≥ approachPct（默认 5%）且未触板
 *   · idle      未启动：其余
 * 输出 data/first_board_live.json（单档覆盖，带 at/session）；非交易时段标注 offhours。
 * fail-open：任何异常只记日志，不落半档。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { isMainBoardCode } from '../src/first_board.js';
import { limitUpPct } from '../src/limit_caliber.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/first_board_live.json');
const APPROACH_PCT = 5;   // 逼近阈值（涨幅%，参数项）

function bjNow() { return new Date(Date.now() + 8 * 3600000); }
const bjDate = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const hhmm = () => { const d = bjNow(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
function sessionOf() {
  const d = bjNow(); const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return 'weekend';
  const t = d.getUTCHours() * 100 + d.getUTCMinutes();
  if (t >= 925 && t < 930) return 'auction';
  if ((t >= 930 && t <= 1130) || (t >= 1300 && t <= 1500)) return 'trading';
  return 'offhours';
}

const secid = (c) => (/^(6|9)/.test(c) ? '1.' : '0.') + c;

try {
  const zt = JSON.parse(readFileSync(join(ROOT, 'data/ztpool_history.json'), 'utf8'));
  const days = (Array.isArray(zt) ? zt : []).filter((d) => d && Array.isArray(d.pool));
  if (!days.length) { console.error('[fb-live] 涨停池档为空'); process.exit(2); }
  const prev = days[days.length - 1];            // 末条 = 昨日（今日池要等 EOD 才落）
  const firsts = (prev.pool || []).filter((p) => p && p.lbc === 1 && p.c)
    .filter((p) => isMainBoardCode(p.c));   // 2026-11-11 拍板：科创创业不进盯盘卡
  if (!firsts.length) { console.error('[fb-live] 昨日无首板'); process.exit(0); }

  const codes = firsts.map((p) => String(p.c));
  const quotes = new Map();
  for (let i = 0; i < codes.length; i += 100) {
    const batch = codes.slice(i, i + 100);
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=' +
      batch.map(secid).join(',') + '&fields=f2,f3,f12,f14,f15,f16,f17,f18,f124&ut=fa5fd1943c7b386f172d6893dbfba10b';
    const res = await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com/' } });
    const j = await res.json();
    for (const d of (j.data && j.data.diff) || []) quotes.set(String(d.f12), d);
  }
  if (!quotes.size) { console.error('[fb-live] 报价为空（接口失败）——不落档'); process.exit(2); }

  const rows = [];
  let stale = 0;
  const today = bjDate(Date.now());
  for (const p of firsts) {
    const q = quotes.get(String(p.c));
    if (!q || !Number.isFinite(+q.f2) || !Number.isFinite(+q.f18)) continue;
    const code = String(p.c);
    // 行情日期（f124 秒级时间戳，北京时区）：早于今日 = 今日尚未开盘/未成交，
    //   昨天首板「今天还没晋级」——状态置 pending，绝不用昨日收盘冒充今日进程。
    const qDate = Number.isFinite(+q.f124) && +q.f124 > 0 ? bjDate(+q.f124 * 1000) : null;
    if (qDate !== today) stale++;
    const pct = limitUpPct({ code, name: p.n || '' });                 // 9.9/19.9/4.9/29.9 口径
    const limitPrice = Math.round(+q.f18 * (1 + pct / 100) * 100) / 100;
    const last = +q.f2, high = Number.isFinite(+q.f15) ? +q.f15 : last;
    const chg = Number.isFinite(+q.f3) ? +q.f3 : null;
    let status = 'idle';
    if (qDate !== today) status = 'pending';
    else if (last >= limitPrice - 0.005) status = 'sealed';
    else if (high >= limitPrice - 0.005) status = 'broken';
    else if (chg != null && chg >= APPROACH_PCT) status = 'approaching';
    rows.push({ code, name: q.f14 || p.n || code, chg, last, high, limitPrice, status, qDate });
  }
  const order = { broken: 0, approaching: 1, pending: 2, sealed: 3, idle: 4 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || ((b.chg ?? -99) - (a.chg ?? -99)));
  const cnt = { sealed: 0, broken: 0, approaching: 0, idle: 0, pending: 0 };
  rows.forEach((r) => cnt[r.status]++);
  const rec = {
    at: new Date().toISOString(),
    bj: hhmm(),
    session: sessionOf(),
    dataDate: rows.length && rows[0].qDate ? rows[0].qDate : null,
    prevDate: prev.date,
    pool: firsts.length,
    counts: cnt,
    approachPct: APPROACH_PCT,
    rows,
    note: stale === rows.length
      ? '今日尚未开盘（行情日期非今日）——昨日首板今日进程待开盘后更新'
      : '昨日首板池今日进程：sealed=已晋级 broken=触板炸板 approaching=逼近（未晋级但可能）',
  };
  writeFileSync(OUT, JSON.stringify(rec, null, 1) + '\n');
  console.log(`[fb-live] ${rec.bj} ${rec.session} | 昨日首板 ${rec.pool} 只 → 已晋级 ${cnt.sealed} / 触板炸板 ${cnt.broken} / 逼近 ${cnt.approaching} / 未启动 ${cnt.idle}`);
} catch (e) {
  console.error('[fb-live] 异常（fail-open）:', e && e.message);
  process.exit(1);
}
