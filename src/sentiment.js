// 七因子情绪模型 v5（透明、可审计、缺失走代理而非静默填50）
import { clamp } from './util.js';

// 单个因子：能算则算；算不出尝试 proxy；再不行中性50但标记
function factor(value, proxyFn) {
  if (value != null && !Number.isNaN(value)) return { v: clamp(value), missing: false };
  if (proxyFn) {
    const p = proxyFn();
    if (p != null && !Number.isNaN(p)) return { v: clamp(p), missing: false, proxied: true };
  }
  return { v: 50, missing: true };
}

export function computeSentiment(raw = {}, weights) {
  const w = weights || {
    s_net20: 0.20, s_pos10: 0.10, s_brd20: 0.20, s_hot10: 0.10,
    s_zdt15: 0.15, s_zbl10: 0.10, s_amt15: 0.15,
  };

  const {
    netBuy, upCount, downCount, industryUp, industryTotal,
    limitUp, limitDown, brokenCount, amount, amountMA20, posRatio,
    // 新股/无涨跌幅限制标的的净买（亿）——由 src/lhb.js 的 splitNewStockNet 唯一产出。
    // 传入即自动从 s_net 里剔除；不传则视为 0（行为与旧版完全一致，历史种子天不受影响）。
    newStockNet = 0, newStockRatio = null,
  } = raw;

  const upRatio = (upCount != null && downCount != null && upCount + downCount > 0)
    ? upCount / (upCount + downCount) : null;
  const indRatio = (industryUp != null && industryTotal)
    ? industryUp / industryTotal : null;
  const ldDen = (limitUp != null && limitDown != null) ? limitUp + limitDown : 0;

  // s_net20: 龙虎榜净额（亿），tanh 归一
  //
  // ⚠ 唯一口径纪律：**必须用剔除新股后的净买**。
  //   新股（上市首 5 日无涨跌幅限制）首日换手极高、筹码未沉淀，其大额净买衡量的是
  //   「打新资金出货由谁承接」，不是二级市场存量资金的进攻意愿；且 tanh(x/5) 在 5 亿量级
  //   已近饱和，一笔新股就能把因子从「转弱」推到「接近满分」。
  //   实测 2026-09-30：含新股 7.74 亿 → s_net 95.7；剔新股 2.70 亿 → s_net 74.6（虚高 21.1，
  //   情绪分虚高 4.20 分，且把结论从「满仓」推过了 65 分档位线）。
  //   全档统计：33 天里 10 天受影响，累计虚增 15.12 分。
  const netExNew = netBuy != null ? netBuy - (Number.isFinite(+newStockNet) ? +newStockNet : 0) : null;
  const f_net = factor(
    netExNew != null ? Math.tanh(netExNew / 5) * 50 + 50 : null
  );
  // s_pos10: 涨跌家数（缺则用龙虎榜正负占比 posRatio 代理）
  const f_pos = factor(
    upRatio != null ? upRatio * 100 : null,
    () => (posRatio != null ? posRatio * 100 : null)
  );
  // s_brd20: 行业涨比（缺则用品宽代理）
  const f_brd = factor(
    indRatio != null ? indRatio * 100 : null,
    () => (upRatio != null ? upRatio * 100 : null)
  );
  // s_hot10: 涨停强度
  const f_hot = factor(
    ldDen > 0 ? (limitUp / ldDen) * 100 : null,
    () => (upRatio != null ? upRatio * 100 : null)
  );
  // s_zdt15: 涨跌停对比
  const f_zdt = factor(
    ldDen > 0 ? ((limitUp - limitDown) / ldDen) * 50 + 50 : null
  );
  // s_zbl10: 封板质量 = 涨停/(涨停+炸板)
  const zblDen = (limitUp != null && brokenCount != null) ? limitUp + brokenCount : 0;
  const f_zbl = factor(
    zblDen > 0 ? (limitUp / zblDen) * 100 : null,
    () => (ldDen > 0 ? (limitUp / ldDen) * 100 : null)
  );
  // s_amt15: 量能 vs 20日均（tanh 平滑：平量50，1.2倍≈67，1.5倍≈86，2倍≈97 不硬封顶；缩量对称压低）
  const f_amt = factor(
    (amount != null && amountMA20) ? Math.tanh((amount / amountMA20 - 1) * 1.8) * 50 + 50 : null
  );

  const factors = { s_net20: f_net, s_pos10: f_pos, s_brd20: f_brd, s_hot10: f_hot, s_zdt15: f_zdt, s_zbl10: f_zbl, s_amt15: f_amt };
  let score = 0, missingCount = 0;
  for (const [k, f] of Object.entries(factors)) {
    score += w[k] * f.v;
    if (f.missing) missingCount++;
  }
  const missing = Object.keys(factors).filter((k) => factors[k].missing);
  return {
    score: Math.round(score * 10) / 10,
    factors: Object.fromEntries(Object.entries(factors).map(([k, f]) => [k, Math.round(f.v * 10) / 10])),
    missing,
    imputedRatio: Math.round((missingCount / 7) * 100) / 100,
    // 新股扰动元信息：供报告逐日核对「s_net 是否被修正过、修正了多少」
    //   netRaw         —— 含新股的原始净买（未修正口径，仅留痕）
    //   netExNew       —— 实际喂给 s_net 的净买
    //   newStockNet    —— 被剔除的新股净买
    //   newStockRatio  —— 新股占当日榜净买比例（分母 ≤0 时为 null）
    //   adjusted       —— 本日 s_net 是否真的被修正（有新股净买且非 0）
    //   disturbed      —— 是否越过 25% 扰动线（报告须显式标注）
    newStock: {
      netRaw: netBuy != null ? Math.round(netBuy * 100) / 100 : null,
      netExNew: netExNew != null ? Math.round(netExNew * 100) / 100 : null,
      newStockNet: Math.round((Number.isFinite(+newStockNet) ? +newStockNet : 0) * 100) / 100,
      newStockRatio: newStockRatio != null ? Math.round(newStockRatio * 100) / 100 : null,
      adjusted: netBuy != null && Number.isFinite(+newStockNet) && +newStockNet !== 0,
      disturbed: newStockRatio != null && newStockRatio > 0.25,
    },
  };
}
