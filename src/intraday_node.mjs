// intraday_node.mjs — 盘中快照数据层（Node.js 直连东财，替代 market_data.py 的 Python 源）
//
// 2026-10-15 重构（方案 B+A 混合双打）：
//   原三源连续失败（source-health 连败告警）：
//     · QuantDash universe  —— PermissionError: 免费 key 不支持 universe（付费墙）
//     · AkShare spot_em     —— ConnectionError: 东财对 AkShare 封装的全市场大查询主动重置
//     · AkShare fund_flow   —— 同上（底层同为东财，被反爬重置）
//   诊断已证实：Node.js fetch 直连东财 push2 轻量请求可达（HTTP 200），问题在 AkShare/QuantDash
//   封装层，而非东财接口本身。故弃 Python 爬虫库，回归 Node 直连，复用 sources.js 已验证函数。
//
// 复用（src/sources.js，同款 UA+Referer，生产中）：
//   fetchScreenerTopMainNet —— 东财 clist 按 f62（主力净流入）降序前 100  → screener + mainNet
//   fetchPools              —— 东财 push2ex 涨跌停/炸板池                  → pools
//   fetchBreadth            —— 东财 push2 全市场涨跌家数                  → breadth
// 新增（本文件）：
//   fetchUniverse           —— 东财 clist 按 f3（涨幅）降序前 200          → hot + quotes
//
// 输出契约与旧 market_data.py::intraday_raw 逐字段对齐，供 snapshot_intraday.mjs 零改消费。
import { fetchScreenerTopMainNet, fetchPools, fetchBreadth } from './sources.js';
import { bjDate } from './freshness.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36';
const EM = 'https://push2.eastmoney.com/api/qt/clist/get';
const FIELDS = 'f2,f3,f8,f10,f12,f14,f23,f62,f100,f115';
const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'; // 沪深 A（主板/创业板/科创板）

// 缺失保持 null，绝不落成 0（0 是合法行情值）
const num = (v) => {
  if (v == null || v === '-' || v === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
};

// 全市场快照（替代 QuantDash universe / AkShare spot_em）：东财 clist 按涨幅降序取前 N。
// 一次请求拿全市场涨幅榜——hot/quotes 同源复用，零新增请求。
async function fetchUniverse(top = 200) {
  const url = `${EM}?pn=1&pz=${top}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=${FIELDS}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const diff = j && j.data && Array.isArray(j.data.diff) ? j.data.diff : null;
  if (!diff) throw new Error('clist 返回异常（无 diff）：' + JSON.stringify(j).slice(0, 120));
  return diff;
}

/**
 * 盘中六源（Node 直连东财版）——契约对齐旧 market_data.py::intraday_raw。
 * @returns {Promise<object>} { hot, pools, breadth, quotes, mainNet, screener, breadthCross, ztDerived, meta }
 */
export async function fetchIntradayRaw() {
  const errors = [];
  const degradations = [];
  const date = bjDate(new Date()); // YYYY-MM-DD（北京当日）
  const ymd = date.replace(/-/g, '');

  // ① 全市场快照（涨幅榜前 200）→ hot + quotes
  let snapRows = [];
  try { snapRows = await fetchUniverse(200); }
  catch (e) { errors.push('universe(hot/quotes): ' + e.message); }

  const hot = snapRows.length ? snapRows
    .map((r) => ({
      code: String(r.f12 ?? ''),
      name: r.f14 ?? null,
      reason: '全市场快照涨幅榜（Node 直连东财派生）',
      close: num(r.f2),
      zhangfu: num(r.f3),
      huanshou: num(r.f8),
      date,
    }))
    .filter((x) => x.code)
    .sort((a, b) => (b.zhangfu ?? -1e9) - (a.zhangfu ?? -1e9))
    : null;

  // 候选池行情（与 hot 同源，零新增请求）
  const quotes = {};
  for (const r of snapRows) {
    const c = String(r.f12 ?? '');
    if (!c) continue;
    quotes[c] = {
      close: num(r.f2),
      change_pct: num(r.f3),
      huanshou: num(r.f8),
      pe_ttm: num(r.f115),
      pb: num(r.f23),
      liangbi: num(r.f10),
    };
  }

  // ② 涨跌停/炸板池（复用 sources.js fetchPools，东财 push2ex 直连）
  let pools = null;
  try { pools = await fetchPools(ymd); }
  catch (e) { errors.push('pools: ' + e.message); }

  // ③ 涨跌家数（复用 sources.js fetchBreadth，东财 push2 直连）
  let breadth = null;
  try { breadth = await fetchBreadth(); }
  catch (e) { errors.push('breadth: ' + e.message); }

  // ④ 主力净流入榜 + mainNet map（复用 sources.js fetchScreenerTopMainNet，东财 clist 直连）
  let screener = null;
  const mainNet = {};
  try {
    const scr = await fetchScreenerTopMainNet();
    if (Array.isArray(scr) && scr.length) {
      screener = scr;
      for (const s of scr) if (s && s.code) mainNet[s.code] = s.main_net ?? null;
    }
  } catch (e) { errors.push('screener/main-net: ' + e.message); }

  return {
    hot, pools, breadth,
    quotes, mainNet, screener,
    // 对账源（breadthCross=乐咕 / ztDerived=自有快照自建）本次未接入 Node 直连层：
    // 二者原属 market_data.py 的 Python 对账源，非主链路；回归 Node 直连后暂不暴露，
    // 待后续单独接 Node 版（纯计算的 ztDerived 易接，乐咕需再探网络）。不影响三主源健康度。
    breadthCross: null, ztDerived: null,
    meta: {
      generatedAt: new Date().toISOString(),
      snapshotSource: 'node-eastmoney',
      snapshotRows: snapRows.length,
      errors,
      degradations,
      caliberNotes: [
        '2026-10-15 盘中快照数据层迁回 Node.js 直连东财：'
        + '弃用 QuantDash universe（付费墙）/ AkShare spot_em（反爬重置）/ AkShare fund_flow_rank（同被重置）。',
      ],
    },
  };
}
