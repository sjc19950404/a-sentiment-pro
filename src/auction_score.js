/**
 * 竞价打分 v1（2026-11-10 用户拍板定稿，口径定死不再扩字段）。
 *
 * 三个**独立**信号（不合成单一分数——等样本积累、看懂各自失效场景后再议合成）：
 *   ① 竞价涨跌幅标记：> +chgThreshold → strong（竞价强势）；< -chgThreshold → weak（竞价走弱）；
 *      区间内（含边界）→ neutral。默认阈值 3%（参数项，可单独调）。
 *   ② 竞价额占比 = 9:25 竞价成交金额 ÷ 昨日全天成交额（昨日额取 ztpool 池记录 amount，
 *      缺失 → null 如实标注，绝不造数）。
 *   ③ 一字缩量检测：一字板前提（竞价涨幅达涨停幅，走 limit_caliber 新口径分板块阈值）下，
 *      竞价占比 < yiziRatioMax（默认 2%，参数项）→ yizi_shrink（缩量强封）；
 *      反之 → yizi_heavy（一字放量，潜在分歧/开板风险）。
 *
 * 约束（拍板原话）：
 *   · 只吃 9:25 定格快照——9:15~9:20 可撤单段一概不进任何计算（采集侧窗口 0925-0931 已拦）；
 *   · 只产标记/统计值/原始读数，sidecar 证据档；**不注入主情绪引擎、不影响仓位打分**；
 *   · 阈值全部参数化（config.paper.auctionScore），留敏感性对照入口（scripts/auction_sensitivity.mjs）。
 */

import { isLimitUp as isLimitUpOf } from './limit_caliber.js';

/** v1 拍板默认值（参数项，可经 config.paper.auctionScore 覆盖）。 */
export const AUCTION_DEFAULTS = {
  chgThreshold: 0.03,   // ① ±3%
  yiziRatioMax: 0.02,   // ③ 一字缩量：竞价占比 < 2%
};

/**
 * @param {object} rec auction_history 单日记录 {trade_date, window, items:[{c,n,jjAmt,jjPct,...}]}
 * @param {object} [opts] { chgThreshold, yiziRatioMax, prevTurnoverByCode: Map<code, 昨日成交额(元)> }
 * @returns {null | {trade_date, window, params, signals:{strong,weak,neutral,yiziShrink,yiziHeavy,amtRatioMissing}, items}}
 */
export function scoreAuctionDay(rec, opts = {}) {
  if (!rec || !Array.isArray(rec.items) || !rec.items.length) return null;
  const chgThreshold = Number.isFinite(+opts.chgThreshold) ? +opts.chgThreshold : AUCTION_DEFAULTS.chgThreshold;
  const yiziRatioMax = Number.isFinite(+opts.yiziRatioMax) ? +opts.yiziRatioMax : AUCTION_DEFAULTS.yiziRatioMax;
  const prevMap = opts.prevTurnoverByCode instanceof Map ? opts.prevTurnoverByCode : null;
  const signals = { strong: 0, weak: 0, neutral: 0, yiziShrink: 0, yiziHeavy: 0, amtRatioMissing: 0 };
  const items = rec.items.map((it) => {
    const jjPct = Number.isFinite(+it.jjPct) ? +it.jjPct : null;
    // ① 涨跌幅标记（严格大于/小于，边界 3.00 属中性）
    let chgLevel = 'neutral';
    const pctFrac = jjPct == null ? null : jjPct / 100;
    if (pctFrac != null && pctFrac > chgThreshold) chgLevel = 'strong';
    else if (pctFrac != null && pctFrac < -chgThreshold) chgLevel = 'weak';
    signals[chgLevel]++;
    // ② 竞价额占比
    const prevAmt = prevMap ? prevMap.get(String(it.c)) : null;
    const amtRatio = (Number.isFinite(+it.jjAmt) && +it.jjAmt > 0 && Number.isFinite(+prevAmt) && +prevAmt > 0)
      ? +((+it.jjAmt / +prevAmt).toFixed(4)) : null;
    if (amtRatio == null) signals.amtRatioMissing++;
    // ③ 一字缩量（一字判据走 limit_caliber 新口径；量占比缺失 → 不判，如实 null）
    let yizi = null;
    if (jjPct != null && isLimitUpOf(jjPct, { code: it.c, name: it.n })) {
      if (amtRatio == null) yizi = { is: true, shrink: null };
      else if (amtRatio < yiziRatioMax) { yizi = { is: true, shrink: true }; signals.yiziShrink++; }
      else { yizi = { is: true, shrink: false }; signals.yiziHeavy++; }
    }
    return { ...it, chgLevel, amtRatio, yizi };
  });
  return {
    trade_date: rec.trade_date,
    window: rec.window || null,
    params: { chgThreshold, yiziRatioMax },
    signals,
    items,
  };
}
