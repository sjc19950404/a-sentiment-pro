// ─────────────────────────────────────────────────────────────────────────────
// 外围市场观测（隔夜外围 / 节后预案）
//
// 定位：给「A 股下一次开盘怎么走」提供一个**可核验的外部底座**。A 股休市期间本模块
//       照常更新，所以长假预案不需要靠手抄新闻——品种、与 A 股的映射方向、触发阈值
//       都在这里定义一次，抓取脚本与前端渲染都从这里派生。
//
// 为什么必须只看「同源锚」而不是「道指」：
//   A 股 9-30 收的是一个「大盘分化、成长杀跌」的盘（上证 +0.31%，但科创50 -2.51%、
//   半导体与元件领跌、超 2800 只个股下跌）。在这种结构里，用道指（金融/消费权重高）
//   去推 A 股，方向经常是反的。真正同源的是：
//     · 富时中国 A50 期货 —— 直接定价 A 股权重，且 A 股休市期间仍在交易（长假唯一实时锚）
//     · 费城半导体指数 SOX —— 与 PCB/元件/半导体同一批终端需求与客户
//     · 纳斯达克 —— 与创业板/科创的成长风格同向
//     · 金龙指数 / 富时中国 ETF —— 外资对中国资产的定价
//     · 美元指数 / 离岸人民币 —— 分母端与外资流向
//
// 设计原则（与 src/lhb.js 同源）：
//   1) 口径写进**字段名与常量**，不靠注释：涨跌幅一律用 last/prevClose 现算并同时保留
//      数据源原值（reported），两者不一致即说明口径漂移，能被守卫脚本抓到。
//   2) 取不到就是 null，**绝不 `|| 0`**——0 是真实行情值（费半 9-30 收平于 -0.00%），
//      把「没抓到」写成 0 会让缺失被读成「没波动」。
//   3) 与 A 股的映射写成**数据**（GLOBAL_ANCHORS），不埋在 if 分支里——映射要改就改数据。
//   4) 汇率的符号单独处理：USDCNH 上涨 = 人民币**贬值** = 对 A 股偏空。这个反号写进
//      `rmbUpPct` 字段名，读的人不必再心算一次。
// ─────────────────────────────────────────────────────────────────────────────

/** 数值解析：空串 / '-' / '--' 一律 null（不等于 0） */
function num(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/,/g, '');
  if (t === '' || t === '-' || t === '--') return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

/** 抹掉 -0（否则 -0.00 会渲染成 "−0.00"，把「收平」显示成「下跌」） */
const nz = (v) => (v === 0 ? 0 : v);

// ── 品种清单 ────────────────────────────────────────────────────────────────
// kind 决定用哪个字段布局解析（新浪同一 host 下四套格式，见下方 NORMALIZERS）
export const GLOBAL_SYMBOLS = [
  // ① A 股外盘代理（权重最高）：长假期间唯一还在交易、且直接定价 A 股权重的品种
  { key: 'a50', code: 'hf_CHA50CFD', name: '富时中国A50期货', kind: 'hf', role: 'a_share_proxy',
    note: '新加坡交易所，A 股休市期间照常交易；长假里唯一能实时反映外资对 A 股定价的品种' },
  // ② 美股宽基
  { key: 'dji', code: 'gb_$dji', name: '道琼斯', kind: 'us', role: 'us_index',
    note: '金融/消费权重高，与 A 股成长主线关联最弱——只作广度参考，不作方向锚' },
  { key: 'spx', code: 'gb_$inx', name: '标普500', kind: 'us', role: 'us_index' },
  { key: 'ixic', code: 'gb_$ixic', name: '纳斯达克', kind: 'us', role: 'us_index',
    note: '与创业板/科创的成长风格同向' },
  { key: 'ndx', code: 'gb_$ndx', name: '纳斯达克100', kind: 'us', role: 'us_index' },
  // ③ 美股行业 / 中国资产
  { key: 'sox', code: 'gb_sox', name: '费城半导体指数', kind: 'us', role: 'us_sector',
    note: '与 A 股 PCB/元件/半导体同源度最高（同一批终端需求与客户）' },
  { key: 'hxc', code: 'gb_$hxc', name: '纳斯达克中国金龙指数', kind: 'us', role: 'china_adr' },
  { key: 'fxi', code: 'gb_fxi', name: '富时中国ETF（FXI）', kind: 'us', role: 'china_adr',
    note: '美股上市的中国大盘股 ETF，外资对中国权重的定价' },
  // ④ 中国香港（与 A 股共用假期，节前/节后对照用）
  { key: 'hsi', code: 'rt_hkHSI', name: '恒生指数', kind: 'hk', role: 'hk_index' },
  { key: 'hstech', code: 'rt_hkHSTECH', name: '恒生科技', kind: 'hk', role: 'hk_index' },
  // ⑤ 汇率（分母端 / 外资流向）
  { key: 'dxy', code: 'DINIW', name: '美元指数', kind: 'dxy', role: 'fx',
    note: '新浪口径，与 ICE 官方或有个位小数差异' },
  { key: 'cnh', code: 'fx_susdcnh', name: '美元/离岸人民币', kind: 'fx', role: 'fx' },
  { key: 'cny', code: 'fx_susdcny', name: '美元/在岸人民币', kind: 'fx', role: 'fx' },
  // ⑥ 商品
  { key: 'gold', code: 'hf_GC', name: 'COMEX黄金', kind: 'hf', role: 'commodity' },
  { key: 'wti', code: 'hf_CL', name: 'WTI原油', kind: 'hf', role: 'commodity' },
  { key: 'brent', code: 'hf_OIL', name: '布伦特原油', kind: 'hf', role: 'commodity',
    note: '新浪报的是**活跃合约**；媒体常引用即将到期合约（两者可差数美元，见 2026-09-30 实例）' },
];

export const SINA_CODES = GLOBAL_SYMBOLS.map((s) => s.code).join(',');
export const SINA_URL = 'https://hq.sinajs.cn/list=';

// 展示小数位（按品种量级定，写在这里而不是前端——前端只渲染文本，不再自己格式化一遍）
// 指数 2 位；A50 期货 1 位；美元指数 3 位；人民币 4 位；商品 2 位。
export const GLOBAL_DP = {
  a50: 1,
  dji: 2, spx: 2, ixic: 2, ndx: 2, sox: 2, hxc: 2, fxi: 2,
  hsi: 2, hstech: 2,
  dxy: 3, cnh: 4, cny: 4,
  gold: 2, wti: 2, brent: 2,
};

// ── 与 A 股的映射：写成数据，不写进 if ──────────────────────────────────────
// sign：该品种**上涨**对 A 股该方向的风险偏好是 +1 利好 / -1 利空 / 0 中性（仅结构参考）
export const GLOBAL_ANCHORS = [
  { from: 'a50', sign: 1, aSectors: ['上证指数', '沪深300', '券商', '银行', '白酒'],
    why: 'A50 成分即 A 股核心权重；休市期间它是唯一实时定价，节后开盘方向的第一参考' },
  { from: 'sox', sign: 1, aSectors: ['元件', '半导体', '消费电子', '光学光电子', 'PCB'],
    why: '费半与 A 股电子链共用同一批终端需求与客户，直接同源' },
  { from: 'ixic', sign: 1, aSectors: ['创业板指', '科创50', '软件开发', 'IT服务', '通信设备'],
    why: '纳指与 A 股成长风格同向' },
  { from: 'hxc', sign: 1, aSectors: ['互联网电商', '文化传媒', '教育', '医疗服务'],
    why: '金龙指数成分多为中概互联/教育/医疗，映射 A 股对应板块情绪' },
  { from: 'hsi', sign: 1, aSectors: ['银行', '保险', '房地产', '贵金属'],
    why: '港股与 A 股金融地产权重股重合度高（AH 联动）' },
  { from: 'dxy', sign: -1, aSectors: ['全市场流动性'],
    why: '美元走强 → 人民币承压 → 外资流入放缓、分母端偏紧' },
  { from: 'cnh', sign: -1, aSectors: ['全市场流动性', '航空', '造纸'],
    why: 'USDCNH 上涨即人民币贬值，对全市场风险偏好偏空（外币负债行业成本上升）' },
  { from: 'gold', sign: 0, aSectors: ['贵金属', '小金属'],
    why: '金价上行直接利好 A 股贵金属板块，但同时是避险信号，对整体风险偏好中性偏空' },
  { from: 'wti', sign: 0, aSectors: ['油气开采及服务', '石油加工贸易', '化学原料'],
    why: '油价上行利好上游、抬高中下游成本；单日大涨常对应输入型通胀预期' },
];

// ── 触发阈值（承压/支撑）─────────────────────────────────────────────────────
// 说明：阈值不是拍出来的——它是「该品种的日波动分布里，多少算异常」的口径选择。
// A50 期货日内波动显著小于 A 股现货，故阈值取 1.0%；SOX 与纳指取 2.0/1.5%。
export const WATCH_THRESHOLDS = {
  a50Down: -1.0, a50Up: 1.0,
  soxDown: -2.0, soxUp: 1.5,
  ixicDown: -1.5, ixicUp: 1.5,
  hxcDown: -3.0, hxcUp: 2.0,
  dxyUp: 0.8, dxyDown: -0.8,
  rmbDep: 0.5, rmbApp: 0.5, // 人民币贬值/升值 0.5%
  goldUp: 2.0, brentUp: 3.0,
  hsiDown: -2.0, hsiUp: 2.0,
};

// 承压/支撑的总分门限：|bias| 超过该值才给方向性结论，否则算震荡
export const WATCH_BIAS_GATE = 2;

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** "Sep 30 04:48PM EDT" + 年份 → "2026-09-30" */
export function parseETDate(et, year) {
  const m = /^([A-Za-z]{3})\s+(\d{1,2})/.exec(String(et || '').trim());
  if (!m || !MONTHS[m[1]]) return null;
  return `${year}-${String(MONTHS[m[1]]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
}

// ── 解析：新浪四套字段布局（索引已用真实响应逐位核对，勿凭印象改）──────────
// us   gb_*   [0]名称 [1]最新 [2]涨跌幅% [3]北京行情时间 [4]涨跌额 [5]开盘 [6]最高
//             [7]最低 [8]52周高 [9]52周低 [25]收盘时间(ET) [26]昨收 [29]年
// hk   rt_hk* [0]代码 [1]名称 [2]今开 [3]昨收 [4]最高 [5]最低 [6]最新 [7]涨跌额
//             [8]涨跌幅% [11]成交额 [12]成交量 [15]52周高 [16]52周低 [17]日期 [18]时间
// dxy  DINIW  [0]时间 [1]最新 [2]买价 [3]昨收 [5]开盘 [6]最高 [7]最低 [9]名称 [10]日期
// fx   fx_*   [0]时间 [1]最新 [2]买价 [3]昨收 [5]开盘 [6]最高 [7]最低 [9]名称
//             [14]52周高 [15]52周低 [17]日期
// hf   hf_*   [0]最新 [2]买价 [3]卖价 [4]最高 [5]最低 [6]时间 [7]昨收 [8]开盘
//             [12]日期 [13]名称
const NORMALIZERS = {
  us: (f) => ({
    name: f[0], last: num(f[1]), chgPctReported: num(f[2]), quoteTime: f[3], chgReported: num(f[4]),
    open: num(f[5]), high: num(f[6]), low: num(f[7]), hi52: num(f[8]), lo52: num(f[9]),
    prevClose: num(f[26]),
    sessionDate: parseETDate(f[25], num(f[29]) || '') || null,
  }),
  hk: (f) => ({
    name: f[1], last: num(f[6]), chgPctReported: num(f[8]), quoteTime: f[18], chgReported: num(f[7]),
    open: num(f[2]), high: num(f[4]), low: num(f[5]), hi52: num(f[15]), lo52: num(f[16]),
    prevClose: num(f[3]),
    sessionDate: (f[17] || '').replace(/\//g, '-') || null,
  }),
  dxy: (f) => ({
    name: f[9], last: num(f[1]), quoteTime: f[0], open: num(f[5]), high: num(f[6]), low: num(f[7]),
    prevClose: num(f[3]), hi52: null, lo52: null, sessionDate: f[10] || null,
  }),
  fx: (f) => ({
    name: f[9], last: num(f[1]), quoteTime: f[0], open: num(f[5]), high: num(f[6]), low: num(f[7]),
    prevClose: num(f[3]), hi52: num(f[14]), lo52: num(f[15]), sessionDate: f[17] || null,
  }),
  hf: (f) => ({
    name: f[13], last: num(f[0]), quoteTime: f[6], open: num(f[8]), high: num(f[4]), low: num(f[5]),
    prevClose: num(f[7]), hi52: null, lo52: null, sessionDate: f[12] || null,
  }),
};

/**
 * 解析新浪行情文本 → { '<code>': fields[] }。
 * 空响应（`=""`）返回空数组，交由上层判 ok=false —— 不在这里编造 0。
 */
export function parseSinaVars(text) {
  const out = {};
  const re = /var\s+hq_str_([A-Za-z0-9_$]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    out[m[1]] = m[2] === '' ? [] : m[2].split(',');
  }
  return out;
}

/**
 * 归一化单条行情。
 * 涨跌幅优先用 last/prevClose 现算（口径统一、不受数据源该字段是否缺省影响），
 * 同时保留数据源原值 chgPctReported，两者不一致即说明口径漂移。
 */
export function normalizeQuote(sym, fields) {
  const dp = GLOBAL_DP[sym.key] != null ? GLOBAL_DP[sym.key] : 2;
  const base = { key: sym.key, code: sym.code, name: sym.name, kind: sym.kind, role: sym.role,
    note: sym.note || null, ok: false, last: null, prevClose: null, chg: null, chgPct: null,
    chgPctReported: null, hi52: null, lo52: null, quoteTime: null, sessionDate: null,
    dp, lastText: '—', chgPctText: '—' };
  if (!fields || !fields.length) return base;
  const q = NORMALIZERS[sym.kind](fields);
  if (!q || q.last == null) return { ...base, ...(q || {}), ok: false };
  let chg = null;
  let chgPct = null;
  if (q.prevClose) {
    chg = nz(+(q.last - q.prevClose).toFixed(6));
    chgPct = nz(+(chg / q.prevClose * 100).toFixed(4));
  } else if (q.chgPctReported != null) {
    chgPct = nz(q.chgPctReported);
  }
  return { ...base, ...q, name: sym.name || q.name, ok: true, chg, chgPct,
    chgPctReported: q.chgPctReported ?? null,
    lastText: fmtNum(q.last, dp), chgPctText: fmtPct(chgPct, 2) };
}

/** 数值文案（缺失一律 '—'，不写 0） */
export function fmtNum(v, d = 2) {
  if (v == null || !Number.isFinite(+v)) return '—';
  return (+v).toFixed(d);
}

/** 涨跌幅文案（统一符号，用于信号文本与前端渲染，构建期生成 → 前端不再格式化一遍） */
export function fmtPct(v, d = 2) {
  if (v == null || !Number.isFinite(+v)) return '—';
  const r = +(+v).toFixed(d);
  // 抹掉 "-0.00%"：费半 9-30 收平于 -0.0043%，带上负号会把「收平」读成「下跌」
  if (r === 0) return `${(0).toFixed(d)}%`;
  return `${r > 0 ? '+' : ''}${r.toFixed(d)}%`;
}

/**
 * 组装快照。纯函数：给定原始文本 + 时刻 → 完整快照，便于离线测试。
 * @param {{raw: string, generatedAt?: string, aShareTradeDate?: string|null, holidays?: string[]}} o
 */
export function buildGlobalSnapshot(o = {}) {
  const vars = typeof o.raw === 'string' ? parseSinaVars(o.raw) : (o.raw || {});
  const quotes = GLOBAL_SYMBOLS.map((s) => normalizeQuote(s, vars[s.code]));

  // 人民币：USDCNH 上涨 = 人民币贬值。反号在**字段名**里说明，读的人不必心算。
  const cnh = quotes.find((q) => q.key === 'cnh');
  const cny = quotes.find((q) => q.key === 'cny');
  const rmb = {
    usdcnh_last: cnh && cnh.ok ? cnh.last : null,
    usdcnh_chg_pct: cnh && cnh.ok ? cnh.chgPct : null,
    rmb_up_pct: cnh && cnh.ok && cnh.chgPct != null ? nz(-cnh.chgPct) : null, // 正=人民币升值
    usdcny_last: cny && cny.ok ? cny.last : null,
  };

  // 美股会话日：取美股宽基里最大的 sessionDate（同一次收盘，各票应一致）
  const usDates = quotes.filter((q) => q.role === 'us_index').map((q) => q.sessionDate).filter(Boolean).sort();
  const usSessionDate = usDates.length ? usDates[usDates.length - 1] : null;

  const failed = quotes.filter((q) => !q.ok).map((q) => q.key);
  const snap = {
    meta: {
      generatedAt: o.generatedAt || new Date().toISOString(),
      source: 'sina',
      sourceUrl: SINA_URL,
      usSessionDate,
      aShareTradeDate: o.aShareTradeDate || null,
      quoteCount: quotes.length,
      okCount: quotes.length - failed.length,
      failed,
      note: '外围行情来自新浪（hq.sinajs.cn），美股为最近已收盘会话；涨跌幅由 last/prevClose 现算并保留数据源原值供比对；取不到的品种一律 null（不写 0）。本模块A股休市期间照常更新，唯一目的是给节后开盘提供可核验的外部底座。非投资建议。',
    },
    quotes,
    rmb,
    anchors: GLOBAL_ANCHORS,
    thresholds: WATCH_THRESHOLDS,
  };
  snap.watch = evaluateGlobalWatch(snap);
  return snap;
}

/**
 * 触发式观测：只有越过阈值才输出信号（与 app.js「明日观测」同一思路——不做固定清单）。
 *
 * 输出策略分两档，避免刷屏又保证主锚不缺位：
 *   主锚（A50 期货 / 费半 / 中国金龙）——**必报**，未触发时也给出读数与「无明确方向」；
 *   次锚（纳指 / FXI / 美元指数 / 人民币 / 黄金 / 油价 / 港股）——**触发才报**，静默即正常。
 *
 * bias > 0 偏多 / < 0 偏空；|bias| ≤ WATCH_BIAS_GATE 视为震荡，不给方向性结论。
 */
export function evaluateGlobalWatch(snap) {
  const q = Object.fromEntries((snap.quotes || []).map((x) => [x.key, x]));
  const get = (k) => (q[k] && q[k].ok ? q[k] : null);
  const pct = (k) => (get(k) ? get(k).chgPct : null);
  const T = WATCH_THRESHOLDS;
  const signals = [];
  let bias = 0;
  const push = (level, key, text, w) => { signals.push({ level, key, text }); bias += w; };
  // 「无明确方向」分支的微幅权重：0.05% 以内视为真的没动（否则 0.004% 也会带上方向）
  const nudge = (v) => (Math.abs(v) < 0.05 ? 0 : (v > 0 ? 0.5 : -0.5));

  // ① A50 期货——长假期间唯一实时锚，权重最高
  const a50 = pct('a50');
  if (a50 != null) {
    if (a50 <= T.a50Down) push('warn', 'a50', `A50 期货 ${fmtPct(a50)}（≤${T.a50Down}%）→ 外资对 A 股权重给出下修定价，节后低开压力`, -3);
    else if (a50 >= T.a50Up) push('ok', 'a50', `A50 期货 ${fmtPct(a50)}（≥+${T.a50Up}%）→ 外资对 A 股权重给出上修定价，节后偏强`, 3);
    else push('info', 'a50', `A50 期货 ${fmtPct(a50)} → 假期定价基本持平，无明确方向`, nudge(a50));
  }

  // ② 电子链（费半）——PCB/元件/半导体的同源锚
  const sox = pct('sox');
  if (sox != null) {
    if (sox <= T.soxDown) push('warn', 'sox', `费半 ${fmtPct(sox)}（≤${T.soxDown}%）→ 电子链（元件/PCB/半导体）情绪承压`, -2);
    else if (sox >= T.soxUp) push('ok', 'sox', `费半 ${fmtPct(sox)}（≥+${T.soxUp}%）→ 电子链情绪有支撑`, 2);
    else push('info', 'sox', `费半 ${fmtPct(sox)}，在 ±${Math.abs(T.soxDown)}% 以内 → 电子链无明确方向`, nudge(sox));
  }

  // ③ 成长风格（纳指）
  const ixic = pct('ixic');
  if (ixic != null) {
    if (ixic <= T.ixicDown) push('warn', 'ixic', `纳指 ${fmtPct(ixic)} → 成长风格（创业板/科创）承压`, -1);
    else if (ixic >= T.ixicUp) push('ok', 'ixic', `纳指 ${fmtPct(ixic)} → 成长风格有支撑`, 1);
  }

  // ④ 中国资产（金龙 / FXI）
  const hxc = pct('hxc');
  if (hxc != null) {
    if (hxc <= T.hxcDown) push('warn', 'hxc', `中国金龙指数 ${fmtPct(hxc)}（≤${T.hxcDown}%）→ 外资对中国资产风险偏好下降`, -2);
    else if (hxc >= T.hxcUp) push('ok', 'hxc', `中国金龙指数 ${fmtPct(hxc)}（≥+${T.hxcUp}%）→ 外资对中国资产risk-on`, 2);
    else push('info', 'hxc', `中国金龙指数 ${fmtPct(hxc)} → 外资对中国资产无异动`, 0);
  }
  const fxi = pct('fxi');
  if (fxi != null && Math.abs(fxi) >= T.hxcUp) {
    const lv = fxi > 0 ? 'ok' : 'warn';
    push(lv, 'fxi', `富时中国ETF（FXI） ${fmtPct(fxi)} → 与中国金龙同向印证`, fxi > 0 ? 1 : -1);
  }

  // ⑤ 汇率（分母端 / 外资流向）
  const dxy = pct('dxy');
  if (dxy != null) {
    if (dxy >= T.dxyUp) push('warn', 'dxy', `美元指数 ${fmtPct(dxy)}（≥+${T.dxyUp}%）→ 人民币与外资流入承压（分母端偏紧）`, -1.5);
    else if (dxy <= T.dxyDown) push('ok', 'dxy', `美元指数 ${fmtPct(dxy)}（≤${T.dxyDown}%）→ 分母端压力缓解`, 1.5);
  }
  const rmb = snap.rmb || {};
  if (rmb.rmb_up_pct != null) {
    if (rmb.rmb_up_pct <= -T.rmbDep) push('warn', 'cnh', `离岸人民币 ${fmtPct(rmb.rmb_up_pct)}（贬值 ${Math.abs(rmb.rmb_up_pct).toFixed(2)}%）→ 外资流出压力`, -1.5);
    else if (rmb.rmb_up_pct >= T.rmbApp) push('ok', 'cnh', `离岸人民币 ${fmtPct(rmb.rmb_up_pct)}（升值 ${rmb.rmb_up_pct.toFixed(2)}%）→ 外资流入有支撑`, 1.5);
  }

  // ⑥ 商品（避险 / 输入型通胀）
  const gold = pct('gold');
  if (gold != null && gold >= T.goldUp) push('warn', 'gold', `COMEX 黄金 ${fmtPct(gold)}（≥+${T.goldUp}%）→ 避险情绪升温，但直接利好 A 股贵金属`, -1);
  const wti = pct('wti');
  if (wti != null && wti >= T.brentUp) push('warn', 'wti', `WTI ${fmtPct(wti)}（≥+${T.brentUp}%）→ 输入型通胀/成本压力，利好上游`, -1);

  // ⑦ 港股（与 A 股共用假期，节前最后一日对照）
  const hsi = pct('hsi');
  if (hsi != null) {
    if (hsi <= T.hsiDown) push('warn', 'hsi', `恒生指数 ${fmtPct(hsi)}（≤${T.hsiDown}%）→ 港股先行走弱`, -1);
    else if (hsi >= T.hsiUp) push('ok', 'hsi', `恒生指数 ${fmtPct(hsi)}（≥+${T.hsiUp}%）→ 港股先行走强`, 1);
  }

  const isHoliday = !!(snap.meta && snap.meta.aShareHoliday);
  let verdict;
  if (bias >= WATCH_BIAS_GATE) verdict = { key: 'positive', label: '外围偏多', hint: '外围未构成压制，A 股可按原计划观察自身主线能否重新集结' };
  else if (bias <= -WATCH_BIAS_GATE) verdict = { key: 'negative', label: '外围偏空', hint: '外围构成压制，开盘先执行预案里的「继续观望」，等 A 股自身承接信号再谈进攻' };
  else verdict = { key: 'neutral', label: '外围中性', hint: '外围未给方向，A 股开盘方向主要由自身资金决定，重点看主线反核与量能' };

  return { verdict, bias: Math.round(bias * 10) / 10, signals, biasGate: WATCH_BIAS_GATE, holiday: isHoliday };
}
