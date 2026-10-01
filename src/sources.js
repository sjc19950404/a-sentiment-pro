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
import { normalizeRecord, summarizeCalibers, mergeDuplicateRecords } from './lhb.js';
import { isAggregateSeatRow } from './seats.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
// 缺失保持 null，绝不落成 0：0 是合法行情值（一字板换手可真为 0），
// 一旦把"没取到"写成 0，前端既看不出数据缺失，下游的 ?? 兜底也会失效（0 不是 null）。
const num2 = (v) => (v == null || !Number.isFinite(+v) ? null : r2(+v));

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

// 腾讯行情代码前缀。历史上只判 sh/sz，把北交所（9/8/4 段）整段丢掉 —— 榜单里一旦出现北交所标的，
// 它就拿不到任何行情字段（close/涨跌幅/换手），前端只能显示成 0。
// 各段位均已实测：沪市 6xxxxx(A)/900xxx(B) → sh；深市 0xxxxx・3xxxxx(A)/200xxx(B) → sz；
// 北交所 92xxxx・4xxxxx・8xxxxx → bj（错误前缀如 bj900939/bj200011 会返回 v_pv_none_match）。
export function quoteSymbol(code) {
  const c = String(code ?? '').trim();
  if (!/^\d{6}$/.test(c)) return null;
  if (c[0] === '6' || c.startsWith('900')) return 'sh' + c;
  if (c[0] === '0' || c[0] === '3' || c[0] === '2') return 'sz' + c;
  if (c[0] === '4' || c[0] === '8' || c.startsWith('92')) return 'bj' + c;
  return null;
}

// 源2辅助: 腾讯批量行情（60只/批）补全强势股 close/涨跌幅/换手
async function fetchHotQuotes(codes) {
  const out = {};
  const sym = quoteSymbol;
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
  // 分指数抓取，合并时要求两市同日都有值——防单市缺数据被当全市（2026-09-29 事故：深证延迟只出上证 6617 亿）
  const byCode = {};
  const years = [2025, 2026];
  for (const code of ['zs_1A0001', 'zs_399001']) {
    const m = {};
    for (const year of years) {
      try {
        const t = await (await fetch('https://d.10jqka.com.cn/v6/line/' + code + '/01/' + year + '.js',
          { headers: { 'User-Agent': UA, Referer: 'https://q.10jqka.com.cn/' } })).text();
        const obj = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
        (obj.data || '').split(';').filter(Boolean).forEach((l) => {
          const c = l.split(',');
          if (c.length >= 7 && +c[6] > 0) m[c[0]] = (+c[6]) / 1e8;
        });
      } catch (e) { /* 单年失败容错 */ }
      await sleep(300);
    }
    byCode[code] = m;
  }
  const map = {};
  const dates = new Set([...Object.keys(byCode.zs_1A0001), ...Object.keys(byCode.zs_399001)]);
  for (const dt of dates) {
    const a = byCode.zs_1A0001[dt], b = byCode.zs_399001[dt];
    if (a > 0 && b > 0) map[dt] = a + b; // 单市缺 → 该日不收，交由兜底/missing 处理
  }
  return Object.keys(map).length ? map : null;
}

// 源7b(备): 腾讯指数实时成交额（万元→亿），同花顺日K当日延迟时兜底
async function fetchAmountTencentFallback(ymd) {
  for (let att = 0; att < 3; att++) {
    try {
      const t = await (await fetch('https://qt.gtimg.cn/q=sh000001,sz399001&r=' + Date.now(),
        { headers: { 'User-Agent': UA } })).text();
      let sum = 0, any = false;
      for (const p of t.split(';')) {
        if (!p.includes('~')) continue;
        const amt = +p.split('~')[37]; // f[37]=成交额(万元)；f[38] 盘后为 0，勿用
        if (Number.isFinite(amt) && amt > 0) { sum += amt / 1e4; any = true; }
      }
      if (any && sum > 3000 && sum < 90000) return { [ymd]: r1(sum) }; // 两市额合理区间护栏
    } catch (e) { /* 重试 */ }
    await sleep(500);
  }
  return null;
}

// day 组装（七因子 + 题材原始计数）
//
// 东财龙虎榜同一次披露里混装两类榜单，字段语义并不相同：
//   ① 当日榜（"日涨幅偏离值达7%"、"日换手率达20%"、"日振幅达15%"、"无价格涨跌幅限制"等）
//      —— 席位买卖与净额都是"当日"口径，BILLBOARD_DEAL_AMT == BUY_AMT + SELL_AMT；
//   ② 区间累计榜（"连续3/10个交易日涨跌幅偏离值累计达X%"、"非S证券连续三个交易日…"）
//      —— 统计的是整个区间的累计值，且 BILLBOARD_BUY_AMT 被填成区间累计成交额
//      （实测 2026-09-30 近岸蛋白 688137 的 10 日榜：BUY == SELL == ACCUM_AMOUNT == 116.97 亿、净额 0）。
// 两类不加区分地相加会得出量级错误的"上榜总成交"——2026-09-30 实测：全部 84 条未去重合计 511.1 亿，
// 而当日榜去重后仅 136.5 亿（3.7 倍差），净买率因此被稀释成 2.4%（真实 5~6%）。
// 故此处把两类分开：存全量供追溯，另出"当日榜去重"口径供报告使用。
// lhb 原始数据 → 聚合结构（buildDay 与 applyLhb 补抓共用）
// 口径判别、同票去重、双口径汇总全部收敛在 src/lhb.js —— 此处只做装配，不再自行相加，
// 避免「少了带口径后缀的那一刻」把区间累计榜混进当日口径（2026-09-30 曾因此把 136.5 亿算成 511.1 亿）。
//
// 装配顺序（不可颠倒）：normalizeRecord → mergeDuplicateRecords → summarizeCalibers
//   · mergeDuplicateRecords 消灭「同票同口径逐字段完全相同」的重复披露（2026-08-14 蓝盾光电实测：
//     两条净额都是 37382.3 万，只有上榜原因不同）。放在装配层而不是只在汇总层，是因为
//     **lhb 原始数组本身就是下游入口**：picks / paper / lhbfilter / fetch_universe / 连板回测
//     都直接遍历它，任何 `reduce(净买)` 都会把同一只票算两遍。
//   · summarizeCalibers 自己也会再合并一次（幂等），作为"调用方忘了合并"的兜底。
function buildLhbPart(lhbRaw) {
  const normalized = lhbRaw.map(normalizeRecord);
  const lhb = mergeDuplicateRecords(normalized).sort((a, b) => b.net_buy_wan - a.net_buy_wan);
  const c = summarizeCalibers(lhb);
  // 合并留痕的「原始条数」必须取**合并前**的 normalized.length。
  //   注意：summarizeCalibers(lhb) 收到的已是合并后数组，它的 raw_records 只能看到合并后条数，
  //   拿它当"东财原始披露条数"会把 merged_away 恒算成 0（守卫 `raw − 合并 = count` 也就恒成立，
  //   变成一条永远通过的废断言）。故此处显式用 normalized.length 覆盖。
  const rawCount = normalized.length;
  const mergedAway = rawCount - lhb.length;
  return {
    lhb,
    lhb_aggr: c.all_aggr,
    lhb_daily_aggr: c.daily_aggr,
    // 全量口径（含区间累计榜）：仅诊断用，禁止喂给日度因子或净买率
    all_net_yi: c.all_net_yi, net_pos: c.all_pos, net_neg: c.all_neg,
    // 当日榜口径（权威）：日度因子 / 净买率 / 新股扰动一律用它
    daily_net_yi: c.daily_net_yi, daily_amt_yi: c.daily_amt_yi,
    // 当日榜 · 剔除新股（喂 s_net 的唯一口径）：新股首日无涨跌幅限制、换手极高，
    // 其净买衡量的是打新出货承接，不是存量资金的进攻意愿（2026-09-30 实测虚增情绪分 4.20 分）
    daily_ex_new_net_yi: c.daily_ex_new_net_yi, daily_new_net_yi: c.daily_new_net_yi,
    daily_new_ratio: c.daily_new_ratio, daily_new_stocks: c.daily_new_stocks,
    daily_new_count: c.daily_new_count,
    range_count: c.range_records,
    // 合并留痕：raw 条数 vs 合并后条数，供审计核对「同票多榜重复披露」的规模
    raw_count: rawCount, merged_away: mergedAway,
  };
}

// 龙虎榜晚间分批披露：把重抓的 lhb 刷进已有 day（仅原始数据层，emotion 由 recalcAll 统一重算）
export function applyLhb(day, lhbRaw) {
  const p = buildLhbPart(lhbRaw);
  day.lhb = p.lhb;
  day.lhb_aggr = p.lhb_aggr;
  day.lhb_daily_aggr = p.lhb_daily_aggr;
  const s = day.summary = day.summary || {};
  s.lhb_count = p.lhb.length;        // 合并后的记录条数（不是东财原始披露条数）
  s.lhb_raw_count = p.raw_count;     // 东财原始披露条数（同票多榜会 > lhb_count）
  s.lhb_merged_away = p.merged_away; // 被合并掉的重复条数
  s.lhb_stocks = p.lhb_aggr.length;
  s.lhb_all_net = p.all_net_yi;      // 全量口径（含区间累计榜）——仅诊断
  s.net_pos = p.net_pos;
  s.net_neg = p.net_neg;
  s.lhb_daily_stocks = p.lhb_daily_aggr.length;
  s.lhb_daily_net = p.daily_net_yi;  // 当日榜口径（权威）
  s.lhb_daily_amt = p.daily_amt_yi;
  s.lhb_range_count = p.range_count;
  // 新股口径（s_net 已自动剔除）：补抓后同样刷新，避免明细更新而剔除结果留在旧值
  s.lhb_daily_ex_new_net = p.daily_ex_new_net_yi;
  s.lhb_new_net = p.daily_new_net_yi;
  s.lhb_new_ratio = p.daily_new_ratio;
  s.lhb_new_count = p.daily_new_count;
  s.lhb_new_stocks = p.daily_new_stocks;
  if (day.emotion) day.emotion.lhb_daily_net = p.daily_net_yi;
  return day;
}

// 源9: 东财席位明细（RPT_BILLBOARD_DAILYDETAILSBUY/SELL）→ 资金属性拆分/买方集中度
// 分类: 机构专用=inst; 沪股通/深股通=north; 其余营业部=hot(游资)
export function classifySeat(name) {
  const s = String(name || '');
  if (s.includes('机构专用')) return 'inst';
  if (s.includes('沪股通') || s.includes('深股通')) return 'north';
  return 'hot';
}

// 席位明细接口在部分票（尤其区间累计榜）里会混入「自然人/中小投资者/机构/其他自然人」
// 这类**投资者结构汇总行**——它们不是席位，金额与整票成交额同阶，计入会把游资买入虚增、
// 并把买方集中度的分母放大（2026-09-30 实测：游资买入虚增 192.77 亿、集中度 44.5%→18.7%）。
// 判据与净化集中在 src/seats.js::isAggregateSeatRow，此处只做调用，不再另写一份判别式。


async function fetchSeatRows(reportName, date, code, sortCol) {
  for (let att = 0; att < 2; att++) {
    try {
      const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=' + reportName +
        '&columns=ALL&filter=(TRADE_DATE%3D%27' + date + '%27)(SECURITY_CODE%3D%22' + code + '%22)' +
        '&pageSize=50&pageNumber=1&sortColumns=' + sortCol + '&sortTypes=-1&source=WEB&client=WEB';
      const j = await (await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' } })).json();
      return (j.result && j.result.data) || [];
    } catch (e) { await sleep(400); }
  }
  return null; // 请求级失败（区别于"未发布"空数组）
}

// 抓全部榜单股的席位明细并聚合。cover=成功覆盖率（%）；席位明细分批发布，未发布视作无数据
// 附加: buy_top3_pct=全市场买方头部3席位集中度（前3席位买入÷全部买方买入）;
//       detail=逐票**买卖双侧**席位明细，供锁仓/新进资金跨日比对与"席位身份"下钻。
//
// detail 结构（v2，买卖双侧）：
//   { code: { b: [[席位名, 金额万元], ...], s: [[席位名, 金额万元], ...] } }
// 旧结构（v1，仅买方）是 { code: [[席位名, 金额万元], ...] }。
// 前端必须两种都能读——存量存档不会因为这次改动而重算，历史天数仍是 v1 形态。
// 之所以补上卖侧：龙虎榜本来就是"买卖各前 5 席位"，只存买方等于把对手盘结构整块丢掉，
// 用户点开个股只能看到"谁在买"，看不到"谁在卖"，而砸盘方往往才是判断接力的关键。
export async function fetchSeats(date, aggr) {
  const agg = { inst_buy: 0, inst_sell: 0, north_buy: 0, north_sell: 0, hot_buy: 0, hot_sell: 0, cover: 0, conc_top: [], buy_top3_pct: null, detail: {} };
  const concAll = [];
  const seatBuy = {}; // 席位名 -> 买入合计（元），全市场跨票聚合
  let buyAll = 0;
  let got = 0;
  for (const a of aggr) {
    const [buyRows, sellRows] = await Promise.all([
      fetchSeatRows('RPT_BILLBOARD_DAILYDETAILSBUY', date, a.code, 'BUY'),
      fetchSeatRows('RPT_BILLBOARD_DAILYDETAILSSELL', date, a.code, 'SELL'),
    ]);
    if (buyRows == null && sellRows == null) continue;
    // 净化：剔除「自然人/中小投资者/机构/其他自然人」类投资者结构汇总行（非席位）。
    // 不剔除会让游资买入虚增、并稀释全市场买方集中度（详见 isAggregateSeatRow 注释）。
    const cleanBuy = (buyRows || []).filter((r) => !isAggregateSeatRow(r.OPERATEDEPT_NAME));
    const cleanSell = (sellRows || []).filter((r) => !isAggregateSeatRow(r.OPERATEDEPT_NAME));
    got++;
    for (const r of cleanBuy) {
      agg[classifySeat(r.OPERATEDEPT_NAME) + '_buy'] += (r.BUY || 0) / 1e8;
      const nm = String(r.OPERATEDEPT_NAME || ''), buy = r.BUY || 0;
      seatBuy[nm] = (seatBuy[nm] || 0) + buy;
      buyAll += buy;
    }
    for (const r of cleanSell) agg[classifySeat(r.OPERATEDEPT_NAME) + '_sell'] += (r.SELL || 0) / 1e8;
    // 买方集中度：前三席位买入占该票榜上买入的比重
    if (cleanBuy.length >= 3) {
      const buys = cleanBuy.map((r) => r.BUY || 0).sort((x, y) => y - x);
      const tot = buys.reduce((x, y) => x + y, 0);
      if (tot > 0) concAll.push([a.name, r1(buys.slice(0, 3).reduce((x, y) => x + y, 0) / tot * 100)]);
    }
    // 逐票买卖双侧席位明细（[席位名, 金额万元]，各侧均按金额降序）
    const toPairs = (rows, col) => (rows || [])
      .map((r) => [String(r.OPERATEDEPT_NAME || ''), Math.round((r[col] || 0) / 1e4)])
      .filter(([nm, v]) => nm && v > 0)
      .sort((x, y) => y[1] - x[1]);
    const b = toPairs(cleanBuy, 'BUY'), s2 = toPairs(cleanSell, 'SELL');
    if (b.length || s2.length) agg.detail[a.code] = { b, s: s2 };
    await sleep(120);
  }
  agg.cover = aggr.length ? r2((got / aggr.length) * 100) : 0;
  agg.conc_top = concAll.sort((x, y) => y[1] - x[1]).slice(0, 5);
  if (buyAll > 0) {
    const tops = Object.entries(seatBuy).sort((x, y) => y[1] - x[1]).slice(0, 3);
    agg.buy_top3_pct = r1(tops.reduce((s, [, v]) => s + v, 0) / buyAll * 100);
  }
  for (const k of ['inst_buy', 'inst_sell', 'north_buy', 'north_sell', 'hot_buy', 'hot_sell']) agg[k] = r2(agg[k]);
  // 样本口径留痕：aggr 传进来的是「全部上榜个股」（含区间累计榜个股），故分项之和 ≠ 当日榜净买。
  // 报告端必须把这两个数摆明白，否则读者会拿分项之和去对当日榜净买，误判为数据错误。
  agg.universe = 'all_listed';       // 口径标记：全部上榜个股（含区间累计榜）
  agg.universe_n = got;              // 实际取到明细的个股数
  agg.universe_total = aggr.length;  // 请求的个股数
  return agg;
}

function buildDay(date, lhbRaw, hotRaw, industry, indexes, pools, amountYi, amountMap, breadth, seats) {
  const {
    lhb, lhb_aggr, lhb_daily_aggr, all_net_yi, net_pos, net_neg,
    daily_net_yi, daily_amt_yi, range_count,
    daily_ex_new_net_yi, daily_new_net_yi, daily_new_ratio, daily_new_stocks, daily_new_count,
    raw_count, merged_away,
  } = buildLhbPart(lhbRaw);

  const hot = hotRaw.map((x) => ({
    code: x.code, name: x.name, reason: x.reason || '',
    close: x.close > 0 ? r2(+x.close) : null,
    change_pct: num2(x.zhangfu),
    huanshou: num2(x.huanshou),
  }));
  // 行情兜底：腾讯行情没覆盖到的票（代码段未收录 / 该批请求失败），若同日龙虎榜明细里有它的行情就借过来，
  // 并标注来源。同一天同一只票的收盘价/涨跌幅两个源应当一致，故可安全互备。
  const lhbByCode = new Map((lhb_aggr || []).map((r) => [r.code, r]));
  hot.forEach((h) => {
    if (h.close != null) return;
    const l = lhbByCode.get(h.code);
    if (!l || l.close == null) return;
    h.close = l.close;
    h.change_pct = l.change_pct ?? null;
    h.huanshou = l.turnover_pct ?? null;
    h.quote_src = 'lhb';
  });
  const freq = {};
  hot.forEach((h) => (h.reason || '').split(/[+＋]/).forEach((w) => { w = w.trim(); if (w) freq[w] = (freq[w] || 0) + 1; }));
  const topics = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([tag, count]) => ({ tag, count }));

  const ind_up = industry.filter((i) => i.change_pct > 0).length;
  const ind_down = industry.filter((i) => i.change_pct < 0).length;

  const missing = [];
  // 强势股行情补全缺口：数据源未覆盖该代码段 → 该票 close/涨跌幅/换手留空（前端显「—」而非 0）
  const hot_quote_missing = hot.filter((h) => h.close == null).length;
  if (hot_quote_missing) missing.push(`hot_quotes(${hot_quote_missing})`);
  const zt = pools ? pools.zt : null, dt = pools ? pools.dt : null, zb = pools ? pools.zb : null;
  if (zt == null || dt == null || zb == null) missing.push('pools');
  // 封板率（市场通用口径）= 收盘涨停 ÷ 盘中触及过涨停（涨停 + 炸板）。
  // 分母是「触板个股」，不是「收盘涨停个股」；这是各行情软件「封板率」的通用算法。
  // ⚠ 历史坑：本字段旧名 zbl_pct、旧式 zb/(zb+zt)，但存储值一直是 zt/(zt+zb)。
  //   即**数值算对了（封板率），字段名却是炸板率**，导致报告把 81.3% 渲染成「炸板率 18.8%」。
  //   见 scripts/audit_lhb_caliber.mjs 的口径守卫；此处同时保留 zbl_pct 旧名做兼容。
  const seal_pct = (zt != null && zb != null && (zb + zt) > 0) ? r1((zt / (zb + zt)) * 100) : null;
  // 炸板率 = 100 − 封板率（同一分母，二者互补，不再各自现算以免漂移）
  const zb_pct = seal_pct != null ? r1(100 - seal_pct) : null;
  const zbl_pct = zb_pct; // 兼容旧字段名（语义=炸板率，与旧报告渲染一致）
  const ymdNum = date.replace(/-/g, '');
  const amount_yi = amountYi != null ? r1(amountYi) : null;
  if (amount_yi == null) missing.push('amount');
  const histAmts = amountMap ? Object.keys(amountMap).filter((k) => k < ymdNum && amountMap[k] > 0).sort().slice(-20) : [];
  const amt_ma = histAmts.length >= 10 ? histAmts.reduce((a, k) => a + amountMap[k], 0) / histAmts.length : null;

  // 七因子：统一走 sentiment.js computeSentiment（唯一公式实现）
  // 净额入参必须是「当日榜」口径：区间累计榜是区间累计值，混进来会让日度因子把三天累计当成一天
  // （实测 2026-09-08 当日榜 -0.11 亿 vs 全量 +13.42 亿 → s_net 从 48.9 被抬到 99.5 并 tanh 饱和）。
  // 并必须剔除新股/无涨跌幅限制标的：s_net=tanh(x/5)*50+50 在 5 亿量级近饱和，
  // 一笔新股净买即可把因子从「转弱」推到「接近满分」（2026-09-30：力勤资源 +5.04 亿，
  // 含新股 s_net 95.7 vs 剔除后 74.6，情绪分虚高 4.20 分并跨过 65 分满仓档位线）。
  const pos_ratio_v = (net_pos + net_neg) > 0 ? net_pos / (net_pos + net_neg) : null;
  const sent = computeSentiment({
    netBuy: daily_net_yi,
    newStockNet: daily_new_net_yi || 0,
    newStockRatio: daily_new_ratio ?? null,
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
    // lhb_count 是**合并后**的记录条数（下游恒等式 `区间条数 = lhb_count − 当日榜记录数` 依赖它）
    lhb_count: lhb.length, lhb_stocks: lhb_aggr.length,
    // 东财原始披露条数与被合并掉的重复条数（同票多榜会重复披露，留痕供审计核对）
    lhb_raw_count: raw_count, lhb_merged_away: merged_away,
    // 全量口径（含「连续N个交易日」区间累计榜）：仅诊断，以及「上榜个股数」这类外部可核对的家数
    lhb_all_net: all_net_yi, net_pos, net_neg,
    // 当日榜口径（权威）：报告展示、日度因子、净买率、新股扰动全部同源
    lhb_daily_stocks: lhb_daily_aggr.length, lhb_daily_net: daily_net_yi,
    lhb_daily_amt: daily_amt_yi, lhb_range_count: range_count,
    // 新股口径：s_net 已自动剔除，这三个字段是证据链（报告不再自行现算）
    lhb_daily_ex_new_net: daily_ex_new_net_yi, lhb_new_net: daily_new_net_yi,
    lhb_new_ratio: daily_new_ratio, lhb_new_count: daily_new_count,
    lhb_new_stocks: daily_new_stocks,
    up_count: breadth ? breadth.up : null, down_count: breadth ? breadth.down : null, flat_count: breadth ? breadth.flat : null,
    breadth_scope: '沪深两市A股（不含北交所/ST口径与各平台统计或有出入）',
    hot_count: hot.length, topic_kinds: Object.keys(freq).length,
    hot_quote_missing,
    ind_count: industry.length, ind_up, ind_down,
    top_industry: industry[0] ? industry[0].name : null,
    bottom_industry: industry[industry.length - 1] ? industry[industry.length - 1].name : null,
    // 封板率/炸板率：分母同为「盘中触板个股数」= 收盘涨停 + 炸板，二者互补
    zt_count: zt, dt_count: dt, zb_count: zb,
    seal_pct,                 // 封板率 = zt/(zt+zb) ×100，市场通用口径
    zb_pct,                   // 炸板率 = 100 − seal_pct
    seal_den: (zt != null && zb != null) ? zt + zb : null, // 分母（触板个股），供报告如实披露口径
    zbl_pct,                  // [兼容] 旧字段名；语义=炸板率
    max_lb: pools ? pools.max_lb : null, lb2_count: pools ? pools.lb2 : null,
    zt_codes: pools ? (pools.zt_codes || null) : null,
    zt_lb: pools ? (pools.zt_lb || null) : null,
    amount_yi,
  };
  if (seats) summary.seats = seats;
  if (missing.length) summary._missing = missing;

  const emotion = {
    value, ...facPlain,
    factors: facPlain,
    // 因子入参同源留痕：这里存的是喂给 s_net20 的**剔新股后**当日榜净额
    // （口径守卫会按它反算校验 s_net，并核对 netRaw − newStockNet == netExNew）
    lhb_daily_net: daily_net_yi, pos_ratio: pos_ratio_v != null ? r1(pos_ratio_v * 100) : null,
    newStock: sent.newStock,
    up_ratio: industry.length ? r1((ind_up / industry.length) * 100) : null,
    hot_count: hot.length,
    topic_conc: r1(topics.length ? (topics[0].count / (hot.length || 1)) * 100 : 0),
    top_topic: topics.length ? topics[0].tag : '—',
    pct_rank: null, net_daily_pct_rank: null, industryCount: industry.length,
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
  // 分位口径与因子入参一致：净额分位按「当日榜」净额排（用全量口径排会让区间累计值参与分位）
  const vs = days.map((d) => d.emotion.value), ns = days.map((d) => d.emotion.lhb_daily_net);
  days.forEach((d, i) => {
    d.emotion.pct_rank = r1(rank(vs, i));
    d.emotion.net_daily_pct_rank = r1(rank(ns, i));
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
  let amountYi = amountMap ? (amountMap[date.replace(/-/g, '')] || null) : null;
  if (amountYi == null) {
    const fb = await fetchAmountTencentFallback(date.replace(/-/g, ''));
    if (fb && amountMap) { Object.assign(amountMap, fb); amountYi = fb[date.replace(/-/g, '')] || null; }
    else if (fb) amountYi = fb[date.replace(/-/g, '')] || null;
  }
  const day = buildDay(date, lhbRaw, hotEnriched, industry, indexes, pools, amountYi, amountMap, breadth,
    await fetchSeats(date, buildLhbPart(lhbRaw).lhb_aggr.map((l) => ({ code: l.code, name: l.name, net_buy_wan: l.net_buy_wan }))));
  return { newDays: [day], tradeDate: date };
}

export { LhbNotPublishedError, fetchLhb };
// 盘中轻量快照（scripts/snapshot_intraday.mjs）需要的三个「实时可得」源：
//   强势股（同花顺，兼交易日探测）/ 涨跌停池（东财 push2ex，盘中实时）/ 涨跌家数（东财 push2，盘中实时）。
// 只导出这三个——日K、席位明细、行业板块等在盘中意义不大或代价过高，快照不抓。
export { fetchHot, fetchPools, fetchBreadth };
