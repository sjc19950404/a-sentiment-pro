#!/usr/bin/env node
/* fetch_kline_turnover.mjs —— 换手率采集链（2026-11-24 用户拍板：不用成交量×流通股本自算）
 *
 * 【为什么不用自算】成交量 × 流通股本 公式里只有"今天的"股本——用当前股本除 251 天前的
 * 成交量 = 拿未来股本算历史换手率（解禁/增发/回购注销/限售转流通的票全错）。这正是
 * 回测最忌讳的前视偏差，且藏得深：算出的数字"像"换手率，实为"按当前股本归一化的成交量"。
 *
 * 【数据源】东财 push2his kline，每根 11 字段，第 11 位（f61）= 换手率（交易所流通股本
 * 口径，point-in-time 正确）。2026-11-24 已验证：000636 末根 f11=7.32 与档内口径一致。
 * 字段序：date,open,close,high,low,volume,amount,amplitude,pct,chg,turnover
 * ——落盘只存 7 字段：[date, open, close, high, low, pct, turnover]
 *   （一字板判定要 OHLC；涨停维持要 pct；5日累计换手要 turnover）
 *
 * 【子集】archive.json 全史涨停股去重（≈3679）∩ 沪深（6/0/3 开头，排除 B 股 9 开头）
 * ≈3655 只 × 251 根，串行 ~5 req/s ≈ 12-15 分钟。
 *
 * 【缓存版本化】data/.kline_turnover/manifest.json（source/beg/end/fetchedAt/codes/
 * errors）+ shard-XX.json（每 500 票一片）。增量：manifest 已有且 --end 匹配的票跳过；
 * --refresh 强制重拉。以后每天增量追加，回测不再重拉。
 *
 * 运行：
 *   node scripts/fetch_kline_turnover.mjs            # 增量采集全部
 *   node scripts/fetch_kline_turnover.mjs --limit 100   # 小批量验证
 *   node scripts/fetch_kline_turnover.mjs --refresh 002242  # 强刷指定票
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'data', '.kline_turnover');
const BEG = process.env.KT_BEG || '20251110';
const END = process.env.KT_END || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? +process.argv[i + 1] : 0; })();
const REFRESH = (() => { const i = process.argv.indexOf('--refresh'); return i > 0 ? process.argv.slice(i + 1).map(String) : []; })();
/* 【2026-11-24 限流实测】180ms 间隔连续请求 ~600 次后东财开始整批拒绝（HTTP 200 但
 * data=null / 连接重置）——串行改「多域名轮换 + 800ms 间隔 + 失败指数退避」。 */
const DELAY_MS = Number(process.env.KT_DELAY) || 800;   // 解封后建议 KT_DELAY=2000 慢速拉全量
const HOSTS = ['push2his.eastmoney.com', '92.push2his.eastmoney.com', '45.push2his.eastmoney.com'];
let hostIdx = 0;
const SHARD_SIZE = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 子集：全史涨停股 ──
const archive = JSON.parse(readFileSync(resolve(ROOT, 'data', 'archive.json'), 'utf8'));
const allCodes = new Set();
for (const d of (archive.all_days || [])) {
  for (const c of ((d.summary || {}).zt_codes || [])) allCodes.add(String(c));
}
const universe = [...allCodes].filter((c) => /^[603]/.test(c)).sort();
console.log(`[kt] 全史涨停股 ${allCodes.size} → 沪深子集 ${universe.length}（B股/其他已排除）`);

// ── manifest（版本化） ──
mkdirSync(OUT_DIR, { recursive: true });
const MANIFEST = resolve(OUT_DIR, 'manifest.json');
let man = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
  : { source: 'eastmoney push2his kline f61（换手率，交易所流通股本口径）', fields: ['date', 'open', 'close', 'high', 'low', 'pct', 'turnover'], beg: BEG, end: END, fetchedAt: null, shards: {}, errors: [], codes: [] };
// beg/end 变化 → 视为新一轮回测窗口，全部重拉（旧分片保留不删，manifest 重开）
if (man.beg !== BEG || man.end !== END) {
  console.log(`[kt] 窗口变化 ${man.beg}~${man.end} → ${BEG}~${END}，重建 manifest（旧分片保留）`);
  man = { ...man, beg: BEG, end: END, fetchedAt: null, shards: {}, errors: [], codes: [] };
}
const done = new Set(man.codes || []);
const refreshSet = new Set(REFRESH);
const todo = universe.filter((c) => refreshSet.has(c) || !done.has(c));
if (LIMIT > 0) todo.length = Math.min(todo.length, LIMIT);
console.log(`[kt] 已有 ${done.size} / 待采 ${todo.length}${LIMIT ? '（--limit 截断）' : ''}`);

// ── 抓取 ──
const secid = (c) => (c[0] === '6' ? '1.' : '0.') + c;
let ok = 0, skip = 0, empty = 0;
const errs = [];
const results = {}; // code -> rows（本批）

for (let i = 0; i < todo.length; i++) {
  const code = todo[i];
  const path = `/api/qt/stock/kline/get?secid=${secid(code)}`
    + `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`
    + `&klt=101&fqt=1&beg=${BEG}&end=${END}`;
  let rows = null;
  for (let attempt = 0; attempt < 3 && rows === null; attempt++) {
    try {
      const host = HOSTS[hostIdx % HOSTS.length];
      hostIdx++;
      const url = 'https://' + host + path;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const kl = (j.data && j.data.klines) || [];
      if (!kl.length && attempt < 2) { await sleep(3000 + attempt * 4000); continue; }  // 疑似限流：退避后换域重试
      rows = kl.map((line) => {
        const f = line.split(',');
        // 只留 7 字段：date open close high low pct turnover
        return [f[0], +f[1], +f[2], +f[3], +f[4], +f[8], +f[10]];
      });
      if (!rows.length) { empty++; rows = []; }
    } catch (e) {
      if (attempt === 2) { errs.push({ code, err: String(e.message || e).slice(0, 80) }); rows = null; }
      else await sleep(4000 + attempt * 5000);  // 指数退避
    }
  }
  if (rows) { results[code] = rows; ok++; }
  if ((i + 1) % 100 === 0) console.log(`[kt] 进度 ${i + 1}/${todo.length}（ok=${ok} empty=${empty} err=${errs.length}）`);
  await sleep(DELAY_MS);
}

// ── 落盘：合并进分片 ──
const shardFiles = () => Object.keys(man.shards || {}).sort();
const loadShard = (name) => JSON.parse(readFileSync(resolve(OUT_DIR, name), 'utf8'));
const saveShard = (name, data) => writeFileSync(resolve(OUT_DIR, name), JSON.stringify(data));

let shards = shardFiles().map((n) => ({ name: n, data: loadShard(n) }));
if (!shards.length) shards = [{ name: 'shard-00.json', data: {} }];

for (const [code, rows] of Object.entries(results)) {
  // 找未满片，没有就新开
  let target = shards.find((s) => Object.keys(s.data).length < SHARD_SIZE);
  if (!target) { target = { name: `shard-${String(shards.length).padStart(2, '0')}.json`, data: {} }; shards.push(target); }
  target.data[code] = rows;
}
for (const s of shards) {
  if (s.data && (results && Object.keys(results).length || s.name === shards[0].name)) saveShard(s.name, s.data);
}

// ── manifest 更新 ──
const newCodes = [...(man.codes || []), ...Object.keys(results).filter((c) => !(man.codes || []).includes(c))];
man.codes = newCodes;
man.fetchedAt = new Date().toISOString();
man.errors = errs;
man.shardCount = shards.length;
man.codeCount = newCodes.length;
writeFileSync(MANIFEST, JSON.stringify(man, null, 2));

console.log(`[kt] 完成：新增 ${Object.keys(results).length}（ok=${ok} empty=${empty} err=${errs.length}）| 库存 ${newCodes.length} 票 / ${shards.length} 分片 | ${BEG}~${END}`);
if (errs.length) console.log('[kt] 失败清单（已记 manifest.errors，重跑自动补）:', errs.slice(0, 5).map((e) => e.code).join(' '), errs.length > 5 ? `…共 ${errs.length}` : '');
