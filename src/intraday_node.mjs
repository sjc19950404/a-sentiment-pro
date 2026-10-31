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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 东财 qt 接口前置机：push2 主域及其镜像（1./2./7./82./84.）在本机网络偶发 TLS 断连/抽风
// （实测多数时刻 200 OK，少数时刻 fetch failed → 属瞬时波动，非主机被墙，见 .probe2 全 200）。
// 故用镜像群 + 每主机 2 次重试吸收抖动；push2ex 仅提供 getTopic 池子接口，不提供
// /api/qt/clist|ulist，故不列入。
const EM_HOSTS = ['push2.eastmoney.com', '1.push2.eastmoney.com', '2.push2.eastmoney.com', '7.push2.eastmoney.com', '82.push2.eastmoney.com', '84.push2.eastmoney.com', 'push2delay.eastmoney.com', 'hqdigi2.eastmoney.com'];
const EM_PATH = '/api/qt/clist/get';
const FIELDS = 'f2,f3,f8,f9,f10,f12,f14,f23,f62,f100,f115';
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
  const errs = [];
  for (const host of EM_HOSTS) {
    for (let att = 0; att < 2; att++) {
      try {
        const url = `https://${host}${EM_PATH}?pn=1&pz=${top}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=${FIELDS}`;
        const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const diff = j && j.data && Array.isArray(j.data.diff) ? j.data.diff : null;
        if (!diff) throw new Error('clist 返回异常（无 diff）：' + JSON.stringify(j).slice(0, 120));
        return diff;
      } catch (e) { errs.push(host + '#' + att + ': ' + e.message); if (att === 0) await sleep(300); }
    }
  }
  throw new Error('universe 全主机失败: ' + errs.join(' | '));
}

// ── 腾讯 gtimg 兜底源（qt.gtimg.cn，物理独立于东财，免费免密钥）──────────────────
// 仅用于「东财 clist 全市场快照（hot/quotes）」失败时，提供一份新鲜报价兜底。
// 注意：gtimg 只给逐只报价，不给 涨跌停池/涨跌家数/主力净流入 —— 那些仍靠东财 + TTL 缓存兜底。
// gtimg 字段索引随版本漂移，故只取稳定可靠的：现价(p3)/昨收(p4)→涨跌幅(自算)/名称(p1)/代码(p2)；
// 换手率/量比/PE/PB 等不猜，缺失保持 null（绝不落成 0，遵循系统「宁缺毋假」纪律）。
const GBK = new TextDecoder('gbk');

// 纯解析（无网络）：把 qt.gtimg.cn/q= 的 GBK 文本解析成股票数组
export function parseGtimgBatch(text) {
  const stocks = [];
  for (const line of String(text).split(';')) {
    const m = line.match(/v_(\w+)="([^"]*)"/);
    if (!m) continue;
    const p = m[2].split('~');
    if (p.length < 35 || !p[1] || p[1] === '') continue; // 无效/缺席过滤（gtimg 对无效代码直接缺席响应）
    const code = p[2], name = p[1];
    if (!/^\d{6}$/.test(code)) continue;
    const prevClose = num(p[4]);
    const close = num(p[3]);
    const change_pct = (close != null && prevClose && prevClose !== 0)
      ? Math.round(((close - prevClose) / prevClose) * 10000) / 100
      : null;
    stocks.push({ code, name, close, change_pct, open: num(p[5]), huanshou: null, liangbi: null, pe_ttm: null, pb: null, avg_price: null });
  }
  return stocks;
}

// A 股代码全集（沪深主板/创业板/科创板；不含北交——gtimg 对北交支持弱），作为无 prev 时的兜底宇宙。
// 仅在「东财挂 且 无上次成功快照」的极端边缘才会枚举全市场（≈6000 只 / 60 每批 ≈ 100 请求，谨慎）。
function gtimgUniverseFallback() {
  const out = [];
  for (let i = 600000; i <= 605999; i++) out.push('sh' + i);
  for (let i = 688000; i <= 689999; i++) out.push('sh' + i);
  for (let i = 1; i <= 3999; i++) out.push('sz' + String(i).padStart(6, '0'));
  for (let i = 300000; i <= 301999; i++) out.push('sz' + i);
  return out;
}

// 实际拉取：分批 qt.gtimg.cn，GBK 解码，2 次重试；全批次失败才抛错（交上层回落 TTL 缓存）
async function fetchGtimgRaw(codes) {
  if (!Array.isArray(codes) || !codes.length) return [];
  const out = [];
  const errs = [];
  const BATCH = 60;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    for (let att = 0; att < 2; att++) {
      try {
        const url = `https://qt.gtimg.cn/q=${batch.join(',')}`;
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        out.push(...parseGtimgBatch(GBK.decode(await res.arrayBuffer())));
        break;
      } catch (e) {
        errs.push('gtimg#' + i + ' att' + att + ': ' + e.message);
        if (att === 0) await sleep(300);
      }
    }
  }
  if (!out.length && errs.length) throw new Error('gtimg 全批次失败: ' + errs.slice(0, 3).join(' | '));
  return out;
}

/**
 * 盘中六源（Node 直连东财版）——契约对齐旧 market_data.py::intraday_raw。
 * @returns {Promise<object>} { hot, pools, breadth, quotes, mainNet, screener, breadthCross, ztDerived, meta }
 */
// 纯函数：把「东财 diff 行 或 gtimg 股票」统一成 hot 行（字段对齐，缺失保持 null）
export function buildHotFromRows(rows, sourceLabel, date) {
  return rows.length ? rows
    .map((r) => ({
      code: String(r.code ?? r.f12 ?? ''),
      name: r.name ?? r.f14 ?? null,
      reason: '全市场快照涨幅榜（' + sourceLabel + '）',
      close: num(r.close ?? r.f2),
      zhangfu: num(r.change_pct ?? r.f3),
      huanshou: num(r.huanshou ?? r.f8),
      avg_price: null, // 已暂停：旧映射 f9 实为市盈率(PE)，非分时均价；待 VWAP 公式确认后重建（见 schemas/intraday.schema.json 标记 deprecated）
      date,
    }))
    .filter((x) => x.code)
    .sort((a, b) => (b.zhangfu ?? -1e9) - (a.zhangfu ?? -1e9))
    : null;
}

// 纯函数：把同一批行统一成 quotes 字典（字段对齐东财源格式）
export function buildQuotesFromRows(rows) {
  const quotes = {};
  for (const r of rows) {
    const c = String(r.code ?? r.f12 ?? '');
    if (!c) continue;
    quotes[c] = {
      close: num(r.close ?? r.f2),
      change_pct: num(r.change_pct ?? r.f3),
      huanshou: num(r.huanshou ?? r.f8),
      avg_price: null, // 已暂停：旧映射 f9 实为市盈率(PE)，非分时均价；待 VWAP 公式确认后重建（见 schemas/intraday.schema.json 标记 deprecated）
      pe_ttm: num(r.pe_ttm ?? r.f115),
      pb: num(r.pb ?? r.f23),
      liangbi: num(r.liangbi ?? r.f10),
    };
  }
  return quotes;
}

export async function fetchIntradayRaw(prevHotCodes = []) {
  const errors = [];
  const degradations = [];
  const date = bjDate(new Date()); // YYYY-MM-DD（北京当日）
  const ymd = date.replace(/-/g, '');

  // ① 全市场快照（涨幅榜前 200）→ hot + quotes（东财主源；失败则腾讯 gtimg 兜底）
  let snapRows = [];
  let hotSource = 'node-eastmoney';
  try { snapRows = await fetchUniverse(200); }
  catch (e) {
    errors.push('universe(hot/quotes)[em]: ' + e.message);
    // 东财主源降级 → 标记腾讯 gtimg 兜底（成败都标记，便于探针区分主/备健康度）
    hotSource = 'node-gtimg-backup';
    // 腾讯 gtimg 兜底（物理独立于东财，免费免密钥）：用上次成功快照的 hot 代码拉新鲜报价；
    // 无 prev 时用 A 股代码全集。gtimg 只给报价，不给池/广度/主力净流入——那些仍靠东财 + TTL 缓存。
    const universe = (Array.isArray(prevHotCodes) && prevHotCodes.length) ? prevHotCodes : gtimgUniverseFallback();
    try {
      const g = await fetchGtimgRaw(universe);
      if (g.length) { snapRows = g; degradations.push({ chain: 'universe: node-eastmoney → node-gtimg-backup（腾讯兜底）' }); }
      else errors.push('universe(hot/quotes)[gtimg]: 返回空');
    } catch (e2) { errors.push('universe(hot/quotes)[gtimg]: ' + e2.message); }
  }

  const hot = buildHotFromRows(snapRows, hotSource === 'node-gtimg-backup' ? '腾讯gtimg直连兜底' : 'Node 直连东财派生', date);
  // 候选池行情（与 hot 同源，零新增请求）
  const quotes = buildQuotesFromRows(snapRows);

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
      snapshotSource: hotSource,
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
