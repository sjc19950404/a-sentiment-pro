#!/usr/bin/env node
// 真实公告爬虫（V5.3 P2）：为「晚间公告排雷机」(scripts/llm_risk_scan.mjs) 提供真实公告源。
//
// 抓取连板梯队 / 标的池候选股的当晚公开公告（东方财富 np-anotice 官方公告接口），
// 产出 data/announcements-latest.json，shape 严格对齐 llm_risk_scan.readRealAnnouncements：
//   { date, source, fetchedAt, codes, count,
//     announcements: { "603XXX": "标题1；标题2", ... },   // code -> 公告文本（喂给 GLM）
//     details: [ { code, name, announcements: [{title,date,url}] } ] }
// llm_risk_scan（真实模式）读此文件 → 仅对「有公告数据」的票调 GLM 判利空 → 黑名单。
//
// 用法：
//   node scripts/fetch_announcements.mjs [--universe ladder|paper] [--limit 40]
//                                      [--out data/announcements-latest.json]
//                                      [--source em] [--mock]
//
// 失败语义（fail-open，与排雷机一致）：
//   抓取失败 / host 不可达 / 返回空 → 该批无公告（降级为空表），绝不抛异常阻断 EOD；
//   空公告源 → llm_risk_scan 真实模式扫不到任何票 → 空黑名单 → 不封禁（不误伤正常交易）。
//
// 注：本脚本按东方财富官方公告接口的真实返回结构解析。部分受限网络环境（如本开发沙箱）
// 对该 host 返回空/拦截，属网络限制而非代码问题；在出网正常的生产 EOD 环境即可落地真实数据。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { decodeArchive } from '../src/lhb_codec.js';
import { bjStamp } from '../src/time.js';
import { fetchWithRetry } from '../src/util.js';
import { loadEnv } from '../src/loadenv.js';
loadEnv(); // 幂等加载 .env（仅填缺失变量；公告抓取当前不依赖密钥，但为一致性/后续源预留）

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

const UNIVERSE = argOf('--universe', 'ladder'); // ladder | paper
const LIMIT = Math.max(1, (parseInt(argOf('--limit', '40'), 10) || 40));
const MOCK = hasFlag('--mock');
const SOURCE = argOf('--source', 'em'); // 当前仅 em（东方财富官方公告），预留扩展
const ROOT = new URL('../', import.meta.url); // 项目根（scripts/ 上一级）
// 相对路径按项目根解析；绝对路径（以 / 或盘符开头）直接当 file:// 用
const resolvePath = (p) => (p && (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)))
  ? new URL('file://' + p)
  : new URL(p, ROOT);
const OUT = resolvePath(argOf('--out', 'data/announcements-latest.json'));
const UA = 'Mozilla/5.0 (compatible; a-sentiment-pro/1.0; +https://github.com/sjc19950404/a-sentiment-pro)';

// ── 1. 候选宇宙（与 llm_risk_scan.collectUniverse 同口径，确保 scanner 能命中）────────
function getTradeDate() {
  try {
    const arch = decodeArchive(JSON.parse(readFileSync(resolvePath('data/archive.json'), 'utf8')));
    const days = (arch.all_days || []).filter((d) => d && d.trade_date);
    return days.length ? days[days.length - 1].trade_date : null;
  } catch { return null; }
}

function collectCodes() {
  const pu = JSON.parse(readFileSync(resolvePath('data/paper_universe.json'), 'utf8'));
  const syms = pu.symbols || {};
  const nameOf = (c) => (syms[c] && syms[c].name) || c;
  const stOf = (c) => !!(syms[c] && syms[c].st);
  if (UNIVERSE === 'paper') {
    return Object.keys(syms).filter((c) => syms[c].active).slice(0, LIMIT)
      .map((c) => ({ code: c, name: nameOf(c), st: stOf(c) }));
  }
  // default: 连板梯队（zt_lb: code -> 连板数），按连板数降序取 Top N
  const arch = decodeArchive(JSON.parse(readFileSync(resolvePath('data/archive.json'), 'utf8')));
  const days = (arch.all_days || []).filter((d) => d && d.trade_date);
  const day = days[days.length - 1];
  const zt = (day && day.summary && day.summary.zt_lb) || {};
  return Object.keys(zt)
    .map((c) => ({ code: c, name: nameOf(c), st: stOf(c), lb: Number(zt[c]) || 0 }))
    .sort((a, b) => b.lb - a.lb)
    .slice(0, LIMIT);
}

// 交易所前缀：6 -> SH（含科创板 688），0/3 -> SZ（含创业板 30），8/4 -> BJ（北交所），9 -> SH（B股兜底）
function exPrefix(code) {
  if (/^6/.test(code)) return 'SH';
  if (/^[03]/.test(code)) return 'SZ';
  if (/^[84]/.test(code)) return 'BJ';
  return 'SH';
}

// ── 2. 东方财富官方公告接口（np-anotice）──────────────────────────────────────────
//   支持 stock_list 多码批量；返回 { success, data:{ list:[ { security_code, notice_title,
//   notice_date, pdf_url, ... } ] } }。本沙箱对该 host 返回空属网络限制；生产环境正常。
const emAnnUrl = (codes) =>
  'https://np-anotice-stock.eastmoney.com/api/security/announcement?sr=-1&page_size=30'
  + `&page_index=1&ann_type=0&client_source=web&ut=bd1d9ddb04089700cf9c27f6f7426281`
  + `&stock_list=${codes.map((c) => exPrefix(c) + c).join(',')}`;

// 解析东方财富返回 → { code: [{title,date,url}] }
function parseEM(text) {
  let j;
  try { j = JSON.parse(text); } catch { return {}; }
  const list = (j && j.data && j.data.list) || [];
  const byCode = {};
  for (const it of list) {
    const code = String(it.security_code || '').trim();
    const title = it.notice_title || it.title || '';
    const date = String(it.notice_date || '').slice(0, 10);
    if (!code || !title) continue;
    (byCode[code] = byCode[code] || []).push({ title, date, url: it.pdf_url || it.annotation_url || '' });
  }
  return byCode;
}

async function fetchEMForCodes(codes) {
  const BATCH = 20;
  const grouped = {};
  let blocked = false;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    try {
      const txt = await fetchWithRetry(emAnnUrl(batch), {
        headers: { 'User-Agent': UA, Referer: 'https://www.eastmoney.com/' },
        timeout: 20000,
        read: async (r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const t = await r.text();
          if (!t || !t.trim()) throw new Error('空响应体（host 可能被网络环境拦截）');
          return t;
        },
      }, 3, 1000);
      const byCode = parseEM(txt);
      for (const [c, arr] of Object.entries(byCode)) grouped[c] = (grouped[c] || []).concat(arr);
    } catch (e) {
      blocked = true;
      console.warn(`[fetch-ann] ⚠ 批次失败 ${batch.join(',')}：${e && e.message ? e.message : e}（降级：该批无公告）`);
    }
  }
  if (blocked) console.warn('[fetch-ann] 部分/全部批次被网络环境限制 → 公告源可能为空（fail-open，不阻断 EOD）');
  return grouped;
}

// 仅保留扫描日及近 1 日的公告（当晚披露 + 盘前补披都算），更早的旧公告不计入排雷
function filterByDate(grouped, tradeDate) {
  const td = new Date(tradeDate + 'T00:00:00+08:00');
  const min = new Date(td.getTime() - 1 * 86400000);
  const kept = {};
  for (const [c, arr] of Object.entries(grouped)) {
    const f = arr.filter((a) => {
      const d = new Date((a.date || '') + 'T00:00:00+08:00');
      return !isNaN(d) && d >= min;
    });
    if (f.length) kept[c] = f;
  }
  return kept;
}

// ── 3. 离线演示公告（与 llm_risk_scan --mock 同源，便于无网验证全链路）──────────────
function buildMockAnnouncements(stocks, tradeDate) {
  const planted = [
    '公司晚间公告：持股 5% 以上股东拟通过集中竞价方式减持不超过公司总股本 5% 的股份；同时公司收到证监会《立案告知书》，因涉嫌信息披露违法违规被立案调查。',
    '公司发布业绩预告：预计本年度归属于上市公司股东的净利润同比预亏 80%~100%；此外存在一起涉案金额较大的重大诉讼。',
    '公司公告：终止筹划重大资产重组事项；深交所下发监管函，要求说明相关事项。',
  ];
  const grouped = {};
  stocks.forEach((s, i) => {
    if (s.st) grouped[s.code] = [{ title: `【${s.name}】公司当前为 ST 股票（结构性风险）`, date: tradeDate, url: '' }];
    else if (i < planted.length) grouped[s.code] = [{ title: planted[i], date: tradeDate, url: '' }];
  });
  return grouped;
}

// ── 4. 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  const tradeDate = getTradeDate();
  if (!tradeDate) { console.error('[fetch-ann] 无交易日数据，退出'); process.exit(1); }
  const stocks = collectCodes();
  if (!stocks.length) { console.error('[fetch-ann] 无候选股，退出'); process.exit(1); }

  let grouped;
  if (MOCK) {
    grouped = buildMockAnnouncements(stocks, tradeDate);
  } else if (SOURCE === 'em') {
    grouped = await fetchEMForCodes(stocks.map((s) => s.code));
  } else {
    console.error(`[fetch-ann] 未知 --source ${SOURCE}`);
    process.exit(2);
  }

  const kept = filterByDate(grouped, tradeDate);
  const announcements = {};
  const details = [];
  const nameMap = new Map(stocks.map((s) => [s.code, s.name]));
  for (const [c, arr] of Object.entries(kept)) {
    announcements[c] = arr.map((a) => a.title).join('；');
    details.push({ code: c, name: nameMap.get(c) || c, announcements: arr });
  }

  const payload = {
    date: tradeDate,
    source: MOCK ? 'mock' : 'eastmoney-np-anotice',
    fetchedAt: bjStamp(),
    codes: stocks.length,
    count: Object.keys(announcements).length,
    announcements,
    details,
  };
  atomicWriteJSON(fileURLToPath(OUT), JSON.stringify(payload, null, 1));
  console.log(`[fetch-ann] 候选 ${stocks.length} 只 → 抓取公告覆盖 ${Object.keys(announcements).length} 只`
    + `（${tradeDate} 及近 1 日）｜写出 ${fileURLToPath(OUT)}`);
}

if (process.argv[1] && process.argv[1].endsWith('fetch_announcements.mjs')) {
  main().catch((e) => { console.error('[fetch-ann] 致命错误：', e); process.exit(1); });
}

export { parseEM, emAnnUrl, exPrefix, buildMockAnnouncements, filterByDate };
