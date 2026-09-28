// 多源数据抓取（云端 Actions 有外网时生效；本地沙箱禁网，走 fallback）
// 设计：每个源独立 try/catch，单源失败不影响其余；缺失因子由 sentiment 走代理/标记
import { fetchWithRetry } from './util.js';
import config from './config.js';

// 东财龙虎榜净额（近一日）
async function emLhb(date) {
  const url = `${config.sources.eastmoney.lhb}?reportName=RPT_DAILYBILLBOARD_DETAILS&columns=ALL&filter=(TRADE_DATE%3D%27${date}%27)&pageSize=1000&sortColumns=NET_BUY&sortTypes=-1`;
  const r = await fetchWithRetry(url, { headers: { Referer: 'https://data.eastmoney.com/' }, timeout: 12000 }, config.retry.times, config.retry.backoff);
  const j = await r.json();
  const rows = (j?.result?.data || []).filter((x) => x.CLOSE_DAYS !== undefined);
  let net = 0;
  for (const x of rows) net += (x.NET_BUY || 0) / 1e4; // 元->亿
  return { netBuy: Math.round(net * 100) / 100 };
}

// 东财涨跌停池（涨停/跌停/炸板数）
async function emPool() {
  const url = `${config.sources.eastmoney.pool}?pn=1&pz=5000&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f3`;
  const r = await fetchWithRetry(url, { headers: { Referer: 'https://quote.eastmoney.com/' }, timeout: 12000 }, config.retry.times, config.retry.backoff);
  const text = await r.text();
  const m = text.match(/\{.*\}/s);
  const j = m ? JSON.parse(m[0]) : null;
  const list = (j?.data?.diff || []).map((d) => ({
    code: d.f12, name: d.f14, pct: parseFloat(d.f3) || 0,
  }));
  const up = list.filter((x) => x.pct >= 9.9).length;
  const down = list.filter((x) => x.pct <= -9.9).length;
  const broken = list.filter((x) => x.pct > 0 && x.pct < 9.9 && x.pct >= 5).length; // 近似炸板代理
  return { limitUp: up, limitDown: down, brokenCount: broken, total: list.length };
}

// 腾讯指数（沪指/深成指涨跌幅 -> 粗略涨跌家数代理见 sentiment）
async function txIndex() {
  const url = `${config.sources.tencent.index}sh000001,sz399001,sz399006`;
  const r = await fetchWithRetry(url, { timeout: 12000 }, config.retry.times, config.retry.backoff);
  const t = await r.text();
  const vals = [...t.matchAll(/~([^~]*)~(\d+\.\d+)~/g)].map((m) => parseFloat(m[2]));
  return { indices: vals };
}

// 同花顺题材归因（强势股 + 诱因，用于题材去噪）
async function thsThemes(date) {
  // 同花顺题材页为 HTML，需解析；此处返回空并交由离线/兜底补全
  // 云端验证通过后可在此解析 table 得到 {code,name,reason}
  return [];
}

// 主入口：尽力抓取，缺啥由 sentiment 标记
export async function fetchLive() {
  const date = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const results = await Promise.allSettled([
    emLhb(date).catch(() => ({})), emPool().catch(() => ({})),
    txIndex().catch(() => ({})), thsThemes(date).catch(() => []),
  ]);
  const [lhb, pool, tx, themes] = results.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason || {})));
  const raw = {
    netBuy: lhb.netBuy ?? null,
    limitUp: pool.limitUp ?? null,
    limitDown: pool.limitDown ?? null,
    brokenCount: pool.brokenCount ?? null,
    upCount: null, downCount: null, industryUp: null, industryTotal: null,
    amount: null, amountMA20: null,
  };
  return {
    allDays: [{
      trade_date: date,
      raw,
      hot: Array.isArray(themes) ? themes : [],
    }],
    board_rank: [],
    briefs: [],
  };
}
