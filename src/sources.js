// sources.js — 多源实时抓取（移植自 sjc19950404/a-sentiment fetch-daily.js 已验证接口）
// 数据源:
//   1. 同花顺强势股 zx.10jqka.com.cn/event/api/getharden（兼交易日探测: data[0].date）
//   2. 同花顺强势股行情补全 qt.gtimg.cn（getharden 2026-09-28 起不再返回 close/zhangfu/huanshou）
//   3. 东财龙虎榜 datacenter-web.eastmoney.com RPT_DAILYBILLBOARD_DETAILSNEW
//   4. 同花顺行业 881xxx 日K（thshy 列表 + d.10jqka.com.cn/v6/line/48_CODE）
//   5. 腾讯指数 qt.gtimg.cn（三大指数涨跌幅）
//   6. 东财涨跌停/炸板池 push2ex.eastmoney.com getTopic{ZT,ZB,DT}Pool
//   7. 同花顺大盘日K zs_1A0001/zs_399001（两市成交额）
//   8. 东财全市场涨跌家数 push2.eastmoney.com ulist.np f104/f105/f106
// 情绪公式统一走 sentiment.js computeSentiment（唯一实现，勿在别处手搓公式）
// 输出 day 对象结构与快照一致: {trade_date,lhb,hot,topics,industry,indexes,summary,emotion,lhb_aggr}

import config from './config.js';
import { computeSentiment } from './sentiment.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

// 龙虎榜未公布 → 优雅跳过（不报错、不回退）
class LhbNotPublishedError extends Error {
  constructor(date) { super('龙虎榜未公布: ' + date); this.name = 'LhbNotPublishedError'; this.date = date; }
}

async function fetchText(url, opts = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url.slice(0, 80));
  return r;
}
async function fetchGBK(url, opts) {
  const buf = await (await fetchText(url, opts)).arrayBuffer();
  return new TextDecoder('gbk').decode(buf);
}
async function fetchJSON(url, opts) {
  return (await fetchText(url, opts)).json();
}

// 源1: 同花顺强势股（兼交易日探测）
async function fetchHot() {
  let lastErr;
  for (let att = 0; att < 3; att++) {
    try {
      const j = await fetchJSON('https://zx.10jqka.com.cn/event/api/getharden', {
        headers: { Referer: 'https://zx.10jqka.com.cn/' },
      });
      if (j.errocode === 0 && Array.isArray(j.data) && j.data.length) return j.data;
      lastErr = new Error('getharden 返回异常 errocode=' + j.errocode);
    } catch (e) { lastErr = e; }
    await sleep(800);
  }
  throw new Error('getharden 强势股接口连续失败: ' + lastErr.message);
}

// 源2辅助: 腾讯批量行情（60只/批）补全强势股 close/涨跌幅/换手
async function fetchHotQuotes(codes) {
  const out = {};
  const sym = (c) => (/^6/.test(c) ? 'sh' + c : /^[03]/.test(c) ? 'sz' + c : null);
  for (let i = 0; i < codes.length; i += 60) {
    const batch = codes.slice(i, i + 60).map(sym).filter(Boolean);
    if (!batch.length) continue;
    try {
      const txt = await fetchGBK('https://qt.gtimg.cn/q=' + batch.join(','));
      for (const m of txt.matchAll(/v_(?:sh|sz|bj)(\d{6})="([^"]*)"/g)) {
        const f = m[2].split('~');
        const close = parseFloat(f[3]), pre = parseFloat(f[4]), chg = parseFloat(f[32]), hs = parseFloat(f[38]);
        if (isNaN(close) || close <= 0) continue;
        out[m[1]] = {
          close,
          change_pct: !isNaN(chg) ? chg : (pre > 0 ? r2((close / pre - 1) * 100) : 0),
          huanshou: isNaN(hs) ? 0 : hs,
        };
      }
    } catch (e) { /* 单批失败容错 */ }
    await sleep(300);
  }
  return out;
}
async function enrichHotQuotes(hotRaw) {
  const codes = [...new Set(hotRaw.map((x) => x.code).filter(Boolean))];
  let qm = {};
  try { qm = await fetchHotQuotes(codes); } catch (e) { return hotRaw; }
  hotRaw.forEach((x) => {
    const q = qm[x.code];
    if (q) { x.close = q.close; x.zhangfu = q.change_pct; x.huanshou = q.huanshou; }
  });
  return hotRaw;
}

// 源3: 东财龙虎榜（分页全量；第1页无 result = 当日未公布）
async function fetchLhb(date) {
  const out = []; let page = 1;
  while (page <= 5) {
    const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?pageSize=200&pageNumber=' + page +
      '&reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL&filter=(TRADE_DATE%3D%27' + date + '%27)';
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' } });
    const j = await r.json();
    if (!j.success || !j.result) {
      if (page === 1 && !j.result) throw new LhbNotPublishedError(date);
      throw new Error('龙虎榜接口失败: ' + (j.message || 'empty'));
    }
    out.push(...j.result.data);
    if (out.length >= j.result.count) break;
    page++; await sleep(300);
  }
  return out;
}

// 源4: 881xxx 行业日K
async function fetchBoards(date) {
  const html = await fetchGBK('https://q.10jqka.com.cn/thshy/', { headers: {} });
  const re = /thshy\/detail\/code\/(88\d{4})\/" target="_blank">([^<]+)</g;
  let m; const boards = []; const seen = new Set();
  while ((m = re.exec(html))) if (!seen.has(m[1])) { seen.add(m[1]); boards.push({ code: m[1], name: m[2].trim() }); }
  if (boards.length < 50) throw new Error('板块列表异常: ' + boards.length);
  const ymdNum = date.replace(/-/g, '');
  const year = date.slice(0, 4);
  const rows = []; let fail = 0;
  // 4 路并发（worker 内限速），90 个行业 30s → ~10s
  const WORKERS = 4;
  let cursor = 0;
  async function boardWorker() {
    while (cursor < boards.length) {
      const { code, name } = boards[cursor++];
      let got = null;
      for (let att = 0; att < 2 && !got; att++) {
        try {
          const t = await (await fetch('http://d.10jqka.com.cn/v6/line/48_' + code + '/01/' + year + '.js',
            { headers: { 'User-Agent': UA, Referer: 'https://q.10jqka.com.cn/' } })).text();
          const s = t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'));
          const obj = JSON.parse(s);
          const ks = (obj.data || '').split(';').filter(Boolean).map((l) => l.split(','));
          const idx = ks.findIndex((k) => k[0] === ymdNum);
          if (idx > 0) got = { close: +ks[idx][4], pre: +ks[idx - 1][4] };
        } catch (e) { await sleep(500); }
      }
      if (got && got.close && got.pre) rows.push({ name, change_pct: r2((got.close / got.pre - 1) * 100) });
      else fail++;
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, () => boardWorker()));
  if (rows.length < 50) throw new Error('行业日K 成功过少: ' + rows.length + '/' + boards.length);
  return rows.sort((a, b) => b.change_pct - a.change_pct);
}

// 源5: 腾讯三大指数
async function fetchIndexes(date) {
  for (let att = 0; att < 3; att++) {
    try {
      const txt = await fetchGBK('https://qt.gtimg.cn/q=sh000001,sz399001,sz399006');
      const idx = {}; let ok = false;
      for (const m of txt.matchAll(/v_(sh|sz)\d+="([^"]*)"/g)) {
        const f = m[2].split('~');
        const name = f[1];
        const ymdNum = (f[30] || '').replace(/\D/g, '');
        const ymd = ymdNum.length >= 8 ? ymdNum.slice(0, 4) + '-' + ymdNum.slice(4, 6) + '-' + ymdNum.slice(6, 8) : '';
        if (!ymd || ymd !== date) continue;
        const chg = parseFloat(f[32]);
        if (!isNaN(chg)) { idx[name] = r2(chg); ok = true; }
      }
      if (ok) return idx;
    } catch (e) { /* 重试 */ }
    await sleep(600);
  }
  return null;
}

// 源6: 东财涨跌停/炸板池
async function fetchPools(date) {
  const ymd = date.replace(/-/g, '');
  const base = 'ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=500';
  const apis = [
    ['getTopicZTPool', 'zt', 'fbt%3Aasc'],
    ['getTopicZBPool', 'zb', 'fbt%3Aasc'],
    ['getTopicDTPool', 'dt', 'fund%3Aasc'],
  ];
  const out = { zt: null, zb: null, dt: null, max_lb: null, lb2: null, zt_codes: null, zt_lb: null, dt_detail: null, zb_detail: null };
  let any = false;
  for (const [api, key, sort] of apis) {
    for (let att = 0; att < 3; att++) {
      try {
        const j = await fetchJSON('https://push2ex.eastmoney.com/' + api + '?' + base + '&sort=' + sort + '&date=' + ymd,
          { headers: { Referer: 'https://quote.eastmoney.com/' } });
        const pool = j && j.data && Array.isArray(j.data.pool) ? j.data.pool : null;
        if (pool && pool.length) { out[key] = pool.length; any = true; }
        else out[key] = (pool ? 0 : null);
        if (api === 'getTopicZTPool' && pool && pool.length) {
          out.max_lb = Math.max(...pool.map((p) => p.lbc || 1));
          out.lb2 = pool.filter((p) => (p.lbc || 1) >= 2).length;
          out.zt_codes = pool.map((p) => p.c);
          out.zt_lb = {}; pool.forEach((p) => { out.zt_lb[p.c] = p.lbc || 1; });
        }
        if (api === 'getTopicDTPool' && pool) {
          out.dt_detail = pool.map((p) => ({ c: p.c, fba: p.fba || 0, amount: p.amount || 0, days: p.days || 0 }));
        }
        if (api === 'getTopicZBPool' && pool) {
          out.zb_detail = pool.map((p) => ({ c: p.c, amount: p.amount || 0 }));
        }
        break; // 成功即跳出重试
      } catch (e) { if (att === 2) console.error('[pools]', api, '连续失败:', e.message); }
      await sleep(600);
    }
  }
  return any ? out : null;
}

// 源8: 东财全市场涨跌家数（沪深合计；f104=涨 f105=跌 f106=平）
async function fetchBreadth() {
  for (let att = 0; att < 3; att++) {
    try {
      const j = await fetchJSON('https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001&fields=f104,f105,f106&ut=fa5fd1943c7b386f172d6893dbfba10b',
        { headers: { Referer: 'https://quote.eastmoney.com/' } });
      const diff = j && j.data && Array.isArray(j.data.diff) ? j.data.diff : null;
      if (!diff || !diff.length) throw new Error('breadth empty');
      let up = 0, down = 0, flat = 0, ok = false;
      for (const d of diff) {
        if (d.f104 != null && d.f105 != null) { up += d.f104; down += d.f105; flat += d.f106 || 0; ok = true; }
      }
      if (ok) return { up, down, flat };
      throw new Error('breadth fields missing');
    } catch (e) { if (att === 2) console.error('[breadth] 连续失败:', e.message); }
    await sleep(600);
  }
  return null;
}

// 源7: 同花顺大盘日K → 两市成交额 Map（YYYYMMDD → 亿）
async function fetchAmountMap() {
  const map = {};
  const years = [2025, 2026];
  for (const code of ['zs_1A0001', 'zs_399001']) {
    for (const year of years) {
      try {
        const t = await (await fetch('https://d.10jqka.com.cn/v6/line/' + code + '/01/' + year + '.js',
          { headers: { 'User-Agent': UA, Referer: 'https://q.10jqka.com.cn/' } })).text();
        const obj = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
        (obj.data || '').split(';').filter(Boolean).forEach((l) => {
          const c = l.split(',');
          if (c.length >= 7 && +c[6] > 0) map[c[0]] = (map[c[0]] || 0) + (+c[6]) / 1e8;
        });
      } catch (e) { /* 单年失败容错 */ }
      await sleep(300);
    }
  }
  return Object.keys(map).length ? map : null;
}

// day 组装（七因子 + 题材原始计数）
// lhb 原始数据 → 聚合结构（buildDay 与 applyLhb 补抓共用）
function buildLhbPart(lhbRaw) {
  const lhb = lhbRaw.map((x) => ({
    code: x.SECURITY_CODE, name: x.SECURITY_NAME_ABBR, reason: x.EXPLANATION || '—',
    close: x.CLOSE_PRICE, change_pct: r2(x.CHANGE_RATE || 0),
    net_buy_wan: r1((x.BILLBOARD_NET_AMT || 0) / 1e4),
    buy_wan: r1((x.BILLBOARD_BUY_AMT || 0) / 1e4),
    sell_wan: r1((x.BILLBOARD_SELL_AMT || 0) / 1e4),
    turnover_pct: r2(x.TURNOVERRATE || 0),
  })).sort((a, b) => b.net_buy_wan - a.net_buy_wan);

  const byCode = new Map();
  for (const l of lhb) {
    if (!byCode.has(l.code)) byCode.set(l.code, { ...l, reasons: [l.reason] });
    else {
      const acc = byCode.get(l.code);
      if (!acc.reasons.includes(l.reason)) acc.reasons.push(l.reason);
      if (Math.abs(l.net_buy_wan || 0) > Math.abs(acc.net_buy_wan || 0)) {
        acc.net_buy_wan = l.net_buy_wan; acc.buy_wan = l.buy_wan; acc.sell_wan = l.sell_wan;
      }
    }
  }
  const lhb_aggr = [...byCode.values()];
  // 净额口径：按去重个股加总（每票一笔，取绝对值最大榜），避免同票多榜重复计入
  const net_total_yi = r2(lhb_aggr.reduce((a, l) => a + l.net_buy_wan, 0) / 1e4);
  const net_pos = lhb_aggr.filter((l) => l.net_buy_wan > 0).length;
  const net_neg = lhb_aggr.filter((l) => l.net_buy_wan < 0).length;
  return { lhb, lhb_aggr, net_total_yi, net_pos, net_neg };
}

// 龙虎榜晚间分批披露：把重抓的 lhb 刷进已有 day（仅原始数据层，emotion 由 recalcAll 统一重算）
export function applyLhb(day, lhbRaw) {
  const p = buildLhbPart(lhbRaw);
  day.lhb = p.lhb;
  day.lhb_aggr = p.lhb_aggr;
  const s = day.summary = day.summary || {};
  s.lhb_count = p.lhb.length;
  s.lhb_stocks = p.lhb_aggr.length;
  s.net_total_yi = p.net_total_yi;
  s.net_pos = p.net_pos;
  s.net_neg = p.net_neg;
  if (day.emotion) day.emotion.net_total_yi = p.net_total_yi;
  return day;
}

function buildDay(date, lhbRaw, hotRaw, industry, indexes, pools, amountYi, amountMap, breadth) {
  const { lhb, lhb_aggr, net_total_yi, net_pos, net_neg } = buildLhbPart(lhbRaw);

  const hot = hotRaw.map((x) => ({
    code: x.code, name: x.name, reason: x.reason || '',
    close: x.close, change_pct: r2(x.zhangfu || 0), huanshou: r2(x.huanshou || 0),
  }));
  const freq = {};
  hot.forEach((h) => (h.reason || '').split(/[+＋]/).forEach((w) => { w = w.trim(); if (w) freq[w] = (freq[w] || 0) + 1; }));
  const topics = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([tag, count]) => ({ tag, count }));

  const ind_up = industry.filter((i) => i.change_pct > 0).length;
  const ind_down = industry.filter((i) => i.change_pct < 0).length;

  const missing = [];
  const zt = pools ? pools.zt : null, dt = pools ? pools.dt : null, zb = pools ? pools.zb : null;
  if (zt == null || dt == null || zb == null) missing.push('pools');
  const zbl_pct = (zt != null && zb != null && (zb + zt) > 0) ? r1((zb / (zb + zt)) * 100) : null;
  const ymdNum = date.replace(/-/g, '');
  const amount_yi = amountYi != null ? r1(amountYi) : null;
  if (amount_yi == null) missing.push('amount');
  const histAmts = amountMap ? Object.keys(amountMap).filter((k) => k < ymdNum && amountMap[k] > 0).sort().slice(-20) : [];
  const amt_ma = histAmts.length >= 10 ? histAmts.reduce((a, k) => a + amountMap[k], 0) / histAmts.length : null;

  // 七因子：统一走 sentiment.js computeSentiment（唯一公式实现）
  const pos_ratio_v = (net_pos + net_neg) > 0 ? net_pos / (net_pos + net_neg) : null;
  const sent = computeSentiment({
    netBuy: net_total_yi,
    upCount: breadth ? breadth.up : null,
    downCount: breadth ? breadth.down : null,
    posRatio: pos_ratio_v,
    industryUp: ind_up,
    industryTotal: industry.length,
    limitUp: zt, limitDown: dt, brokenCount: zb,
    amount: amount_yi, amountMA20: amt_ma,
  }, config.weights);
  const FKEY = { s_net20: 's_net', s_pos10: 's_pos', s_brd20: 's_brd', s_hot10: 's_hot', s_zdt15: 's_zdt', s_zbl10: 's_zbl', s_amt15: 's_amt' };
  const facPlain = {};
  for (const [wk, pk] of Object.entries(FKEY)) facPlain[pk] = sent.factors[wk];
  const value = sent.score;
  const imputedRatio = sent.imputedRatio;
  const factorMissing = sent.missing;

  const summary = {
    lhb_count: lhb.length, lhb_stocks: lhb_aggr.length, net_total_yi, net_pos, net_neg,
    up_count: breadth ? breadth.up : null, down_count: breadth ? breadth.down : null, flat_count: breadth ? breadth.flat : null,
    breadth_scope: '沪深两市A股（不含北交所/ST口径与各平台统计或有出入）',
    hot_count: hot.length, topic_kinds: Object.keys(freq).length,
    ind_count: industry.length, ind_up, ind_down,
    top_industry: industry[0] ? industry[0].name : null,
    bottom_industry: industry[industry.length - 1] ? industry[industry.length - 1].name : null,
    zt_count: zt, dt_count: dt, zb_count: zb, zbl_pct,
    max_lb: pools ? pools.max_lb : null, lb2_count: pools ? pools.lb2 : null,
    zt_codes: pools ? (pools.zt_codes || null) : null,
    zt_lb: pools ? (pools.zt_lb || null) : null,
    amount_yi,
  };
  if (missing.length) summary._missing = missing;

  const emotion = {
    value, ...facPlain,
    factors: facPlain,
    net_total_yi, pos_ratio: pos_ratio_v != null ? r1(pos_ratio_v * 100) : null,
    up_ratio: industry.length ? r1((ind_up / industry.length) * 100) : null,
    hot_count: hot.length,
    topic_conc: r1(topics.length ? (topics[0].count / (hot.length || 1)) * 100 : 0),
    top_topic: topics.length ? topics[0].tag : '—',
    pct_rank: null, net_pct_rank: null, industryCount: industry.length,
    imputedRatio, missing: factorMissing,
  };
  return { trade_date: date, lhb, hot, topics, industry, summary, indexes, emotion, lhb_aggr };
}

// 全档分位重算（pct_rank = rank/(n-1)*100）
export function recalcRanks(days) {
  const rank = (vals, i) => {
    const s = [...vals].sort((a, b) => a - b);
    return (s.indexOf(vals[i]) / Math.max(s.length - 1, 1)) * 100;
  };
  const vs = days.map((d) => d.emotion.value), ns = days.map((d) => d.emotion.net_total_yi);
  days.forEach((d, i) => {
    d.emotion.pct_rank = r1(rank(vs, i));
    d.emotion.net_pct_rank = r1(rank(ns, i));
  });
}

// 实时抓取：返回最新交易日 day（与快照同结构）
export async function fetchLive() {
  const hotRaw = await fetchHot();
  const date = hotRaw[0].date;
  const lhbRaw = await fetchLhb(date);
  const hotEnriched = await enrichHotQuotes(hotRaw);
  const [industry, indexes, pools, amountMap, breadth] = await Promise.all([
    fetchBoards(date),
    fetchIndexes(date),
    fetchPools(date),
    fetchAmountMap(),
    fetchBreadth(),
  ]);
  const amountYi = amountMap ? (amountMap[date.replace(/-/g, '')] || null) : null;
  const day = buildDay(date, lhbRaw, hotEnriched, industry, indexes, pools, amountYi, amountMap, breadth);
  return { newDays: [day], tradeDate: date };
}

export { LhbNotPublishedError, fetchLhb };
