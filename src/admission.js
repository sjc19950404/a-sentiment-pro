// 实盘准入（物理拉黑，绝不进候选池）——2026-10-29·老板实盘权限。
// 唯一事实源：选股引擎(recommendPicks)、推送候选池(buildSimulationStock)、模拟盘买闸(lhbfilter.filterOne)共用同一套口径。
// 本模块零依赖（不引入任何其它模块），避免与 picks.js ↔ lhbfilter.js 形成循环依赖。
//
// 强制过滤条件（覆盖创业板/科创板/北交所/ST/次新）：
//   1) 只保留主板：代码前缀 00（深市主板，含 002 中小板）/ 60（沪市主板）；
//   2) 剔除 ST / *ST / 退（风险警示 + 退市）；
//   3) 剔除次新股：K 线数据少于 5 天（上市未满 5 个交易日）；candidate.klineDays 存在且 <5 即剔除。
//   （北交所 8/4/920、创业板 300/301、科创板 688 均被 allowlist 一并排除）

const MAIN_BOARD_PREFIX = /^(00|60)/; // 深市主板(00，含 002 中小板) + 沪市主板(60)
// ST / *ST / 退（风险警示 + 退市）。负向预查 (?![A-Za-z]) 防止把 "STAGE" 等含 ST 的英文词误判为 ST 股。
const RISK_NAME_RE = /(^|\s)\*?ST(?![A-Za-z])|退/;

// ETF 特例（2026-10-29·老板允许模拟盘未来的 ETF 自动轮动模块买入，不被主板 allowlist 误伤）
export const ETF_ALLOWLIST = ['510880', '511010'];

export function isRiskName(name) {
  return RISK_NAME_RE.test(String(name || ''));
}

/**
 * 标的实盘准入判定（选股引擎 / 推送候选池 / 模拟盘买闸 共用唯一口径）。
 * @param {string|number} code 股票代码
 * @param {string} [name] 股票名称（用于 ST / 退 判定；缺失时不判 ST，仅看板块）
 * @param {number} [klineDays] K 线数据天数（用于次新判定；缺失时不判次新）
 * @param {{allowEtfs?:boolean}} [opts] allowEtfs=true 时放行 ETF_ALLOWLIST（仅模拟盘买闸用于未来 ETF 模块）
 * @returns {boolean} true=可交易（主板且非风险警示且非次新；或 ETF 特例）
 */
export function isAdmissible(code, name, klineDays, opts = {}) {
  const c = String(code || '');
  if (opts.allowEtfs && ETF_ALLOWLIST.includes(c)) return true;   // ETF 特例：510880/511010 放行
  if (!MAIN_BOARD_PREFIX.test(c)) return false;                   // 非主板（30x/68x/8/4/920…）一律剔除
  if (isRiskName(name)) return false;                             // ST / *ST / 退
  if (Number.isFinite(klineDays) && klineDays < 5) return false;  // 次新（K线<5天）
  return true;
}

export function filterAdmissible(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => isAdmissible(x && x.code, x && x.name, x && x.klineDays));
}
