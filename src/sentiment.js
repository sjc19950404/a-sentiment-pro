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
    limitUp, limitDown, brokenCount, amount, amountMA20,
  } = raw;

  const upRatio = (upCount != null && downCount != null && upCount + downCount > 0)
    ? upCount / (upCount + downCount) : null;
  const indRatio = (industryUp != null && industryTotal)
    ? industryUp / industryTotal : null;
  const ldDen = (limitUp != null && limitDown != null) ? limitUp + limitDown : 0;

  // s_net20: 龙虎榜净额（亿），tanh 归一
  const f_net = factor(
    netBuy != null ? Math.tanh(netBuy / 5) * 50 + 50 : null
  );
  // s_pos10: 涨跌家数
  const f_pos = factor(upRatio != null ? upRatio * 100 : null);
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
  // s_amt15: 量能 vs 20日均
  const f_amt = factor(
    (amount != null && amountMA20) ? clamp(50 + (amount / amountMA20 - 1) * 70) : null
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
  };
}
