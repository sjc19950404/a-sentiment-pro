/**
 * limit_caliber.js — 涨停口径模块（2026-11-09 用户拍板 C12「两步走」）
 *
 * 背景：picks.js 旧实现一处写死 zdp>=9.5、一处 >=9.9（主板口径套全市场），
 *   创业板/科创板（20cm）未涨停被当涨停、ST（5%）真涨停被漏判，污染缩量板/封单锁死/
 *   炸板/情绪全套打分。
 *
 * 两步走（用户指令，务必遵守）：
 *   · v5.2-pro-old-limit —— 旧口径（9.5/9.9 主板硬阈值），仅用于**存量历史回测、
 *     已产出报告、历史情绪分**的解读，代码中不再产生新判定；
 *   · v5.2-pro-fix-limit —— 新口径（分板块阈值），**新信号/新日报**一律走这里。
 *   两套口径分开命名、对照并存，禁止互相覆盖。
 *
 * 分板块阈值（fix）：
 *   主板 ±10%｜创业板(300/301)/科创板(688/689) ±20%｜ST ±5%｜北交所(4/8/920) ±30%
 *   判定容差 0.5pp（10cm → 9.5 起算，与旧主板语义对齐；20cm → 19.5；5cm → 4.5；30cm → 29.5）。
 *   涨跌幅数据源缺失/非法 → 不判定为涨停（宁缺毋假）。
 */

export const LIMIT_CALIBER = Object.freeze({
  OLD: 'v5.2-pro-old-limit',
  FIX: 'v5.2-pro-fix-limit',
});

/** 按代码/名称推断该股涨停幅度（%）。无法识别板块 → 按主板 10% 保守处理。 */
export function limitUpPct({ code = '', name = '' } = {}) {
  const c = String(code ?? '').replace(/\D/g, '').padStart(6, '0');
  const n = String(name ?? '');
  if (/^(4|8|920)/.test(c)) return 30;          // 北交所（含 920 新代码段）
  if (/ST/i.test(n)) return 5;                  // ST/*ST（含北交所 ST 由上面 30 先命中）
  if (/^(688|689)/.test(c)) return 20;          // 科创板
  if (/^(300|301)/.test(c)) return 20;          // 创业板
  return 10;                                    // 主板
}

/** 新口径涨停判定：|chgPct| ≥ 阈值 − 容差。chgPct 非有限数 → false（不造数）。 */
export function isLimitUp(chgPct, stock = {}, tolerance = 0.5) {
  const x = +chgPct;
  if (!Number.isFinite(x)) return false;
  return x >= limitUpPct(stock) - tolerance;
}

/** 旧口径判定（封存参照，仅用于对照工具/历史解读；新代码禁止调用做信号）。 */
export function isLimitUpOld(chgPct, threshold = 9.5) {
  const x = +chgPct;
  return Number.isFinite(x) && x >= threshold;
}
