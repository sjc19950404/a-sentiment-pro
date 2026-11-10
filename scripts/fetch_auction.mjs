#!/usr/bin/env node
/**
 * 竞价特征采集（2026-11-10，六方向 #1 之一，用户拍板「一步步落实」）。
 *
 * 定位：sidecar 独立档——只读现有数据（ztpool_history / account），只写自己的档
 *   （data/auction_history.json），无调度入口时不自动运行；任何异常 fail-open
 *   （console.error + 非零退出码仅作信号），绝不触碰 EOD 主链。
 *
 * 原理：集合竞价 9:25 落定、9:30 开盘——**9:25~9:30 时段窗口内**的行情快照
 *   （ulist.np）中：f2=竞价价、f5=竞价量（手）、f6=竞价金额（元）、f17=今开、
 *   f18=昨收。9:30 后成交量即开始叠加全天量 → **只能在窗口内抓**，历史不可回查
 *   （2026-11-10 实测：异动接口 getAllStockChanges 当日 data 空、池接口无竞价字段）。
 *
 * 时点防护：非 9:25~9:31 运行 → 拒绝落库（防把盘中量当竞价量污染档案）；
 *   --force 豁免（仅用于形态验证，落档 window 用真实时刻标注，不冒充 0926）。
 *
 * 采集对象（去重）：昨日涨停池（含连板数）+ 当前持仓（空仓期=仅涨停池）。
 * 后续打分（竞价幅度/一字/爆量等）按拍板制单独做——本脚本只存原始读数，宁缺毋假。
 *
 * 用法：node scripts/fetch_auction.mjs [--force]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/auction_history.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const HOSTS = ['push2.eastmoney.com', '1.push2.eastmoney.com', '2.push2.eastmoney.com', '7.push2.eastmoney.com', '82.push2.eastmoney.com', '84.push2.eastmoney.com'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 北京时间 HHMM（用 UTC+8 计算，不依赖本机时区）。 */
function bjHHMM(now = new Date()) {
  const ms = now.getTime() + 8 * 3600000;
  const d = new Date(ms);
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
}
/** 北京交易日 YYYY-MM-DD。 */
function bjDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

/** 采集对象：昨日涨停池（c/n/lbc）+ 持仓，去重。 */
function collectTargets() {
  const map = new Map();
  const zt = JSON.parse(readFileSync(join(ROOT, 'data/ztpool_history.json'), 'utf8'));
  const last = Array.isArray(zt) ? zt[zt.length - 1] : null;
  if (last && Array.isArray(last.pool)) {
    for (const s of last.pool) {
      if (s && s.c && /^\d{6}$/.test(String(s.c))) {
        map.set(String(s.c), { c: String(s.c), n: s.n || null, lb: Number.isFinite(+s.lbc) ? Math.trunc(+s.lbc) : 1 });
      }
    }
  }
  try {
    const acc = JSON.parse(readFileSync(join(ROOT, 'data/paper/account.json'), 'utf8'));
    for (const c of Object.keys(acc.positions || {})) {
      if (/^\d{6}$/.test(c) && !map.has(c)) map.set(c, { c, n: null, lb: null });
    }
  } catch { /* 账本缺席不拦采集 */ }
  return { targets: [...map.values()], ztDate: last ? (last.date || last.trade_date || null) : null };
}

/** ulist 批量行情快照（复用 sources.js fetchMainNet 同款镜像回退骨架）。 */
async function fetchQuoteSnapshot(codes) {
  const secids = codes.map((c) => (String(c)[0] === '6' ? '1.' + c : '0.' + c));
  const out = {};
  for (let i = 0; i < secids.length; i += 100) {
    const chunk = secids.slice(i, i + 100).join(',');
    let got = false;
    for (const host of HOSTS) {
      try {
        const url = `https://${host}/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f5,f6,f17,f18&secids=` + chunk;
        const j = await (await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' } })).json();
        const diff = j && j.data && Array.isArray(j.data.diff) ? j.data.diff : null;
        if (!diff) continue;
        for (const d of diff) {
          if (!d || !d.f12) continue;
          const num = (v) => (Number.isFinite(+v) ? +v : null);
          out[String(d.f12)] = {
            n: d.f14 || null,
            jjPrice: num(d.f2),     // 窗口内=竞价价
            jjVol: num(d.f5),       // 窗口内=竞价量（手）
            jjAmt: num(d.f6),       // 窗口内=竞价金额（元）
            open: num(d.f17),
            prevClose: num(d.f18),
          };
        }
        got = true;
        break;
      } catch { /* 镜像失败 → 下一台 */ }
    }
    if (!got) console.error(`[auction] 批量快照全部主机失败（secids ${i} 起）——该批缺席=宁缺毋假`);
    await sleep(300);
  }
  return out;
}

async function main() {
  const force = process.argv.includes('--force');
  const now = new Date();
  const hhmm = bjHHMM(now);
  const date = bjDate(now);
  const inWindow = hhmm >= '0925' && hhmm <= '0931';
  if (!inWindow && !force) {
    console.error(`[auction] 当前北京时刻 ${hhmm} 不在 9:25~9:31 竞价窗口内——拒绝落库（防盘中量冒充竞价量）。--force 仅限形态验证。`);
    process.exit(2);
  }
  const { targets, ztDate } = collectTargets();
  if (!targets.length) {
    console.error('[auction] 无采集对象（涨停池空/缺席）——不落空档，退出');
    process.exit(2);
  }
  const snap = await fetchQuoteSnapshot(targets.map((t) => t.c));
  const items = targets
    .filter((t) => snap[t.c] && snap[t.c].prevClose > 0)
    .map((t) => {
      const q = snap[t.c];
      const jjPct = q.jjPrice != null && q.prevClose > 0 ? +(((q.jjPrice / q.prevClose) - 1) * 100).toFixed(2) : null;
      return { ...t, ...q, jjPct };
    });
  if (!items.length) {
    console.error('[auction] 快照全缺席（全部镜像失败/停牌）——不落空档');
    process.exit(2);
  }
  const rec = { trade_date: date, window: force ? hhmm : '0926', capturedAt: new Date().toISOString(), ztDate, n: items.length, items };
  // 幂等同日覆盖（照 factor_health / ztpool_history 先例）
  const hist = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
  const list = Array.isArray(hist) ? hist : [];
  const idx = list.findIndex((d) => d.trade_date === date);
  if (idx >= 0) list[idx] = rec; else list.push(rec);
  list.sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
  writeFileSync(OUT, JSON.stringify(list, null, 1) + '\n');
  console.log(`[auction] ${date} ${rec.window} 落档：${items.length}/${targets.length} 只（zt基准日 ${ztDate}）。竞价涨幅样例：` +
    items.slice(0, 5).map((x) => `${x.c} ${x.n || ''} ${x.jjPct != null ? x.jjPct + '%' : '—'}`).join(' | '));
}

main().catch((e) => { console.error('[auction] 异常（fail-open，不影响任何主链）:', e && e.message); process.exit(1); });
