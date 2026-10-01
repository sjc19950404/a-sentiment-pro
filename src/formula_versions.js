// ── 公式版本注册表（唯一出处）──────────────────────────────────────────────────
//
// 为什么需要这个文件：
//   公式每次迭代（v4.5 → v5.0 → v5.2）改的都是**喂给 s_net 的原料口径**，不是加权公式本身。
//   七因子权重与 sigmoid/tanh 归一在所有版本里完全一致，差异只在「净买额取哪一份」。
//   如果每个版本各写一份 computeSentiment，就会变成三套并行的口径实现——改一处忘两处，
//   回归报告直接失真。故本文件**只描述原料口径**，因子计算一律仍走 src/sentiment.js
//   的 computeSentiment（同一个函数、同一份权重）。
//
// 三版的实际语义（按 git 历史与既有注释复原，不是新发明的口径）：
//
//   v4.5  净买 = 当日榜 + 区间累计榜混算的**全量聚合**（含新股）
//         · 历史事实：建库初期直接用 lhb 原始数组 reduce(净额)，既没滤区间榜、也没滤新股。
//         · 后果：区间累计值顶替当日值 → s_net 长期被抬到 tanh 饱和区，几乎失去分辨力
//           （实测 33 天里 13 天被顶到 100）。
//
//   v5.0  净买 = **当日榜**（已滤区间榜），但仍**含新股**
//         · 历史事实：修掉了区间榜混算（"511 亿事件"），这是 v5.0 唯一改动。
//         · 后果：单只新股的大额净买仍能把因子从「转弱」推到「接近满分」
//           （2026-09-30 实测：s_net 因子虚高 54.7 分、情绪分虚高 8.58 分，并越过了 65 分档位线）。
//
//   v5.2  净买 = 当日榜 **剔除新股/无涨跌幅限制标的**（当前基线）
//         · 即 src/lhb.js 的 splitNewStockNet 产出的 ex_new_yi。
//
// 版本号与档位阈值的关系：三版共用同一组阈值（24/65/80），差异全部体现在分子上——
// 这正是"同一段历史、三版并行重算"能做出有意义对比的前提。

import { computeSentiment } from './sentiment.js';
import {
  caliberFromDay, mergeDuplicateRecords, aggregateByCode, isNewStock,
} from './lhb.js';

// 当前基线版本（config.formulaVersion 必须与之一致，由守卫锁定）
export const BASELINE_VERSION = 'v5.2-pro';

// 权重键（带档位后缀，computeSentiment 的入／出键）→ 因子键（存档/报告/前端用）
// 与 src/config.js 的 factorKeyMap 同义，但后者是「权重键 → 因子键」的配置映射，
// 这里再声明一次是为了让本模块**不依赖 config**（纯逻辑模块，便于单测与前端复用）。
// 两份必须一致，由 test/formula_version.test.mjs 守卫锁定。
export const WEIGHT_TO_FACTOR = {
  s_net20: 's_net', s_pos10: 's_pos', s_brd20: 's_brd', s_hot10: 's_hot',
  s_zdt15: 's_zdt', s_zbl10: 's_zbl', s_amt15: 's_amt',
};

const r2 = (v) => Math.round(v * 100) / 100;

// ────────────────────────── 各版本的「净买原料」提取器 ──────────────────────────
//
// 契约：入参是**已落盘的 day 对象**，返回 { netBuy, newStockNet, label, evidence }。
//   netBuy        —— 喂给 computeSentiment 的净买（亿），**含**新股（剔除由 newStockNet 承担）
//   newStockNet   —— 要从此 netBuy 里扣掉的金额（亿）；v4.5/v5.0 传 0 = 不扣
//   label         —— 人读口径名，进报告
//   evidence      —— 该日可供人工复核的中间量（不参与计算，只作证据链）
//
// 三版共用 caliberFromDay（当日榜/全量双口径的唯一现算实现），只是选取的字段不同。
// 这一点很关键：如果 v4.5 自己再写一遍"不过滤 is_range"，就会出现第二套口径判断逻辑。

// v4.5：全量聚合（含区间累计榜、含新股）
export function netBuyV45(day) {
  const c = caliberFromDay(day);
  const netBuy = c.all_net_yi;
  return {
    netBuy,
    newStockNet: 0, // 含新股
    label: 'v4.5 · 全量净买（含区间累计榜 + 含新股）',
    evidence: {
      allStocks: c.all_stocks,
      dailyStocks: c.daily_stocks,
      rangeRecords: c.range_records,
    },
  };
}

// v5.0：当日榜（已滤区间榜），但含新股
export function netBuyV50(day) {
  const c = caliberFromDay(day);
  const netBuy = c.daily_net_yi;
  return {
    netBuy,
    newStockNet: 0, // 含新股
    label: 'v5.0 · 当日榜净买（已滤区间累计榜，含新股）',
    evidence: {
      allStocks: c.all_stocks,
      dailyStocks: c.daily_stocks,
      rangeRecords: c.range_records,
    },
  };
}

// v5.2：当日榜剔除新股（当前基线）
export function netBuyV52(day) {
  const c = caliberFromDay(day);
  const netBuy = c.daily_net_yi;
  const newStockNet = c.daily_new_net_yi ?? 0;
  return {
    netBuy,
    newStockNet,
    label: 'v5.2 · 当日榜净买（已滤区间累计榜，剔除新股/无涨跌幅限制）',
    evidence: {
      allStocks: c.all_stocks,
      dailyStocks: c.daily_stocks,
      rangeRecords: c.range_records,
      newCount: c.daily_new_count,
      newNet: newStockNet,
      newRatio: c.daily_new_ratio,
    },
  };
}

// ────────────────────────── 版本表（唯一注册点）──────────────────────────────────
//
// 加新版本 = 在这里加一行 + 在 test/formula_version.test.mjs 里加一条口径断言。
// 顺序即报告里的展示顺序（由旧到新）。
export const FORMULA_VERSIONS = [
  {
    key: 'v4.5',
    name: 'v4.5',
    desc: '七个因子加权，净买取全量聚合（未滤区间累计榜、未剔新股）',
    extractNetBuy: netBuyV45,
  },
  {
    key: 'v5.0',
    name: 'v5.0',
    desc: '七个因子加权，净买取当日榜（滤掉区间累计榜），仍含新股',
    extractNetBuy: netBuyV50,
  },
  {
    key: 'v5.2-pro',
    name: 'v5.2-pro',
    desc: '七个因子加权，净买取当日榜并剔除新股/无涨跌幅限制标的（当前基线）',
    extractNetBuy: netBuyV52,
    baseline: true,
  },
];

export function versionKeys() {
  return FORMULA_VERSIONS.map((v) => v.key);
}

export function versionOf(key) {
  return FORMULA_VERSIONS.find((v) => v.key === key) || null;
}

// ────────────────────────── 单日单版本重算 ──────────────────────────
//
// 口径纪律：本函数**只负责凑原料**，因子与分数一律交给 computeSentiment。
//   其余六个因子（s_pos / s_brd / s_hot / s_zdt / s_zbl / s_amt）在三个版本里
//   **完全相同**——它们本来就没被历次迭代改动过。差异只在 s_net。
//
// amountMA20 的算法必须与 pipeline.recalcAll 逐字一致（取当日之前最近 20 个有值交易日的均值，
// 且不足 10 个值时置 null → 走代理）。这是唯一一处跨文件重复，用守卫锁定一致性。
export function recomputeDay(day, versionKey, ctx = {}) {
  const v = versionOf(versionKey);
  if (!v) throw new Error('未知公式版本：' + versionKey);
  const s = day?.summary || {};
  const { netBuy, newStockNet, label, evidence } = v.extractNetBuy(day);
  const sent = computeSentiment({
    netBuy,
    newStockNet,
    newStockRatio: evidence?.newRatio ?? null,
    upCount: s.up_count ?? null,
    downCount: s.down_count ?? null,
    posRatio: (s.net_pos != null && s.net_neg != null && (s.net_pos + s.net_neg) > 0)
      ? s.net_pos / (s.net_pos + s.net_neg) : null,
    industryUp: s.ind_up ?? null,
    industryTotal: s.ind_count ?? null,
    limitUp: s.zt_count ?? null,
    limitDown: s.dt_count ?? null,
    brokenCount: s.zb_count ?? null,
    amount: s.amount_yi ?? null,
    amountMA20: ctx.amountMA20 ?? null,
  }, ctx.weights);
  // 硬失败而非静默 NaN：computeSentiment 按**带档位后缀的权重键**取 w[k]（s_net20 / s_pos10 …），
  // 若调用方传了无后缀的因子键（s_net / s_pos …），w[k] 全是 undefined → score = NaN，
  // 且 NaN 会一路静默传播（相关性、均分、准确率集体变 NaN，看起来像"算出来了但没数据"）。
  // 实测踩过这个坑，故在此处直接抛错，把问题挡在第一现场。
  if (!Number.isFinite(sent.score)) {
    const wk = Object.keys(ctx.weights || {});
    throw new Error(`重算 ${versionKey} ${day?.trade_date} 得到非有限分数（${sent.score}）`
      + `——检查传入的权重键是否为带档位后缀形式（当前：${wk.join(',') || '未传'}）`);
  }
  // 因子键归一：computeSentiment 返回的是**带档位后缀**的键（s_net20 / s_pos10 …，因为它按权重键聚合），
  // 而存档、报告、前端一律用无后缀的因子键（s_net / s_pos …）。这两个形状混在同一份数据里，
  // 下游任何 `row.factors.s_net` 都会静默取到 undefined。故在此**唯一出口**做一次归一，
  // 让本模块的输出形状与存档一致（下游不必知道 computeSentiment 的内部键名）。
  const fac = {};
  for (const [wk, pk] of Object.entries(WEIGHT_TO_FACTOR)) {
    if (sent.factors[wk] != null) fac[pk] = sent.factors[wk];
  }
  return {
    version: versionKey,
    score: sent.score,
    factors: fac,
    factorsRaw: sent.factors, // 原样保留一份，供与 pipeline 的装配结果逐字段比对
    imputedRatio: sent.imputedRatio,
    missing: sent.missing,
    netBuy: netBuy != null ? r2(netBuy) : null,
    newStockNet: r2(newStockNet || 0),
    label,
    evidence,
  };
}

// ────────────────────────── 可算性分级（决定回归样本量）──────────────────────────
//
// 为什么必须分级而不是"能算就算、不能算就丢"：
//   三个版本的差异**只在 s_net 一项**，其余六因子三版完全相同。因此要看出版本差异，
//   样本天必须满足两个条件：
//     ① 有**足够的原始量**让 s_net 与其余因子都在「真值区」——否则一堆因子落在代理值 50，
//        版本差异被代理稀释掉，相关性表看起来"三版几乎一样"，那是数据缺失造成的假象；
//     ② 有**次日大盘涨跌幅**（indexes 的下一交易日）——否则无法计算预测力。
//
// 实测当前档案的真实分布（241 天）：
//   · lhb_daily_net / lhb_all_net / lhb_daily_ex_new_net / lhb_new_net / lhb_range_count
//     —— 241/241 全覆盖（这三版共用的原料全都有）
//   · ind_up 33/241、amount_yi 33/241、indexes 33/241 —— 只有最近 33 天（2026-08-14 起）
//   · up_count/down_count 仅 3/241 —— s_pos 的「真原料」极稀缺，其余天走 posRatio 代理
//
// 因此定义三级：
//   full      —— 有 indexes 且 ind_up/amount_yi 齐全（33 天）：七因子里 5 个在真值区，
//                且能算次日收益 → **回归主样本**
//   partial   —— 有龙虎榜原料但缺行业/量能（可算 s_net 三版差异，但无次日收益）
//               → 只作"版本差异幅度"的旁证，不进相关性统计
//   none      —— 连龙虎榜原料都没有 → 完全排除
export const COMPUTE_TIERS = {
  full: 'full',
  partial: 'partial',
  none: 'none',
};

export function classifyDay(d) {
  const s = d?.summary || {};
  const c = caliberFromDay(d);
  const hasLhb = c.total_records > 0
    || s.lhb_daily_net != null || s.lhb_all_net != null;
  if (!hasLhb) return COMPUTE_TIERS.none;
  const hasIndustry = s.ind_up != null && s.ind_count != null;
  const hasAmount = s.amount_yi != null;
  const hasNextRet = d?.indexes && d.indexes['上证指数'] != null;
  // 注意：up_count 缺失不算「不可算」——computeSentiment 的 s_pos 会回退到 posRatio 代理，
  // 这是既有设计（见 src/sentiment.js 的 factor(..., fallback)）。但它会削弱区分度，
  // 故额外记录 hasBreadth 供报告披露「本样本有 N 天 s_pos 走代理」。
  const hasBreadth = s.up_count != null && s.down_count != null;
  return (hasIndustry && hasAmount && hasNextRet) ? COMPUTE_TIERS.full : COMPUTE_TIERS.partial;
}

export function computableDays(days) {
  const list = Array.isArray(days) ? days : [];
  const full = [], partial = [], none = [];
  const meta = [];
  for (const d of list) {
    const tier = classifyDay(d);
    const s = d?.summary || {};
    meta.push({
      trade_date: d?.trade_date,
      tier,
      hasBreadth: s.up_count != null && s.down_count != null,
      hasIndustry: s.ind_up != null,
      hasAmount: s.amount_yi != null,
      hasNextRet: !!(d?.indexes && d.indexes['上证指数'] != null),
    });
    if (tier === COMPUTE_TIERS.full) full.push(d);
    else if (tier === COMPUTE_TIERS.partial) partial.push(d);
    else none.push(d);
  }
  return { ok: full, partial, none, meta };
}

// 与 computableDays 同口径，但把「有 indexes 的连续段」原样保留索引 —— 供次日收益对齐用。
// 回归必须按**真实交易日相邻**取次日，不能按数组相邻：档案里 2026-09-24 的下一行是 09-28
// （09-25 中秋休市），按数组相邻会把 4 天累计涨跌当成次日涨跌。
export function nextRetOf(day, allDays) {
  if (!Array.isArray(allDays) || !day?.indexes) return null;
  const i = allDays.findIndex((x) => x.trade_date === day.trade_date);
  if (i < 0) return null;
  for (let j = i + 1; j < allDays.length; j++) {
    const nx = allDays[j];
    if (nx?.indexes && nx.indexes['上证指数'] != null) {
      const gap = tradingDayGap(day.trade_date, nx.trade_date);
      return { date: nx.trade_date, ret: nx.indexes['上证指数'], gap };
    }
  }
  return null;
}

// 两个日期之间的「自然日跨度」——用于披露隔了几天的跳空（长假后首日的次日收益含跳空）。
function tradingDayGap(a, b) {
  const ta = Date.parse(a + 'T00:00:00Z');
  const tb = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

export function computeAllVersions(days, versions = versionKeys(), weights) {
  const out = {};
  for (const k of versions) out[k] = [];
  if (!Array.isArray(days) || !days.length) return out;
  const amts = days.map((d) => (d?.summary && d.summary.amount_yi != null) ? d.summary.amount_yi : null);
  days.forEach((d, i) => {
    const hist = [];
    for (let j = i - 1; j >= 0 && hist.length < 20; j--) if (amts[j] != null) hist.unshift(amts[j]);
    const amountMA20 = hist.length >= 10 ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
    for (const k of versions) {
      const r = recomputeDay(d, k, { amountMA20, weights });
      out[k].push({ trade_date: d.trade_date, ...r });
    }
  });
  return out;
}

// 供守卫：确认所有版本的因子键集合与顺序完全一致（只应有数值差异）
export function factorKeysOf(result) {
  return Object.keys(result?.factors || {});
}

// 复用导出，避免下游为取一个合并函数而再次 import lhb.js
export { mergeDuplicateRecords, aggregateByCode, isNewStock };
