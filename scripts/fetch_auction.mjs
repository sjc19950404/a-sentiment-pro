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
import { safeJson } from '../src/safe_json.mjs';
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
        const j = await safeJson(await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' } }));
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
  /* 【2026-11-19 根治「11 个交易日仅 2 次成功」】真根因不是竞价时段抖动，而是本环境到
   * push2.*.eastmoney.com 域名族的 TLS 长期被断（10-08 实录、11-19 node fetch 全挂验证）
   * ——6 台镜像同域名族全军覆没是必然。补新浪镜像兜底（实测持续可达；9:25~9:30 竞价期
   * 现价=竞价匹配价、量/额=竞价累计，昨收齐全），与东财输出字段完全对齐。 */
  const missing = codes.filter((c) => !out[c]);
  if (missing.length) {
    try {
      const list = missing.map((c) => (String(c)[0] === '6' ? 'sh' + c : 'sz' + c)).join(',');
      const r = await fetch('https://hq.sinajs.cn/list=' + list, {
        headers: { Referer: 'https://finance.sina.com.cn' },
        signal: AbortSignal.timeout(12000),
      });
      const buf = new Uint8Array(await r.arrayBuffer());
      let text;
      try { text = new TextDecoder('gbk').decode(buf); }
      catch { text = new TextDecoder('utf-8').decode(buf); }
      const num = (v) => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);
      let got2 = 0;
      for (const line of text.split('\n')) {
        const m = line.match(/hq_str_(?:sh|sz)(\d{6})="([^"]*)"/);
        if (!m) continue;
        const f = m[2].split(',');
        // 新浪格式：0名称 1今开 2昨收 3现价 8量(股) 9额(元)
        if (!f[2] || +f[2] <= 0) continue;                 // 无昨收=停牌/无效，跳过
        out[m[1]] = {
          n: f[0] || null,
          jjPrice: num(f[3]),
          jjVol: num(f[8]) != null ? Math.round(+f[8] / 100) : null,  // 股→手，对齐东财口径
          jjAmt: num(f[9]),
          open: num(f[1]) || null,
          prevClose: +f[2],
        };
        got2++;
      }
      if (got2) console.error(`[auction] 东财 push2 全挂 → 新浪镜像兜底 ${got2}/${missing.length} 只`);
    } catch { /* 新浪也失败 → 维持 out 现状，主循环重试机制接管 */ }
  }
  return out;
}

async function main() {
  const force = process.argv.includes('--force');
  const now = new Date();
  const hhmm = bjHHMM(now);
  const date = bjDate(now);
  /* 上界收紧到 0929：9:30 开盘后 f5/f6 即叠加盘中量，0930~0931 启动采到的已是污染数据 */
  const inWindow = hhmm >= '0925' && hhmm <= '0929';
  if (!inWindow && !force) {
    console.error(`[auction] 当前北京时刻 ${hhmm} 不在 9:25~9:31 竞价窗口内——拒绝落库（防盘中量冒充竞价量）。--force 仅限形态验证。`);
    process.exit(2);
  }
  const { targets, ztDate } = collectTargets();
  if (!targets.length) {
    console.error('[auction] 无采集对象（涨停池空/缺席）——不落空档，退出');
    process.exit(2);
  }
  /* 【2026-11-19 根治「批量快照全部主机失败」】东财镜像在集合竞价时段存在分钟级
   * 抖动/限流（11-12~11-19 多天单次尝试即全灭，11 个交易日仅 2 次成功）。单次=赌运气，
   * 改为窗口内持续重试（30s 间隔）。竞价数据纯净窗口为 9:25(落定)~9:30(开盘)——
   * 9:30 后 f5/f6 开始叠加盘中量即污染，重试硬上界 09:29:55，宁可缺档不落脏数据。
   * --force（形态验证）保持单次不重试。 */
  let items = [];
  let attempt = 0;
  while (true) {
    attempt++;
    const snap = await fetchQuoteSnapshot(targets.map((t) => t.c));
    items = targets
      .filter((t) => snap[t.c] && snap[t.c].prevClose > 0)
      .map((t) => {
        const q = snap[t.c];
        const jjPct = q.jjPrice != null && q.prevClose > 0 ? +(((q.jjPrice / q.prevClose) - 1) * 100).toFixed(2) : null;
        return { ...t, ...q, jjPct };
      });
    if (items.length) break;
    if (force) {
      /* --force（形态验证）保持单次，不进重试循环 */
      console.error('[auction] --force 快照全缺席（全部镜像失败/停牌）——不落空档');
      process.exit(2);
    }
    const n2 = new Date();
    const h2 = bjHHMM(n2);
    const windowClosed = !force && (h2 > '0929' || (h2 === '0929' && n2.getSeconds() >= 55));
    if (windowClosed) {
      console.error(`[auction] ${attempt} 次尝试快照全缺席（重试窗口至 09:29:55 已关闭，9:30 后量被盘中污染不采）——不落空档`);
      process.exit(2);
    }
    console.error(`[auction] 第 ${attempt} 次快照全缺席（全部镜像失败/停牌）——30s 后重试，窗口余量至 09:29:55`);
    await sleep(30000);
  }
  /* 落档窗口硬校验：抓取成功≠数据可用。非竞价窗口时刻（即使 --force 形态验证成功）
   * 新浪/东财现价是盘中或收盘价、量是全天量——写档=假竞价数据。宁可缺档不落脏数据。 */
  const capH = bjHHMM(new Date());
  if (!(capH >= '0925' && capH <= '0929')) {
    console.error(`[auction] 落档校验拒绝：当前时刻 ${capH} 不在 9:25~9:29 竞价窗口——此时刻的现价/量是盘中或收盘值，不是竞价数据（宁缺毋假）`);
    process.exit(2);
  }
  /* window 用真实抓取时刻标注（重试成功可能晚于 0926，不冒充） */
  const rec = { trade_date: date, window: capH, capturedAt: new Date().toISOString(), ztDate, n: items.length, items };
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
