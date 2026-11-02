// 晚间公告排雷黑名单读取器（V5.3 P2 扩展）：paper.js 建仓守卫的接入点。
//
// 正向封禁语义：黑名单里的是「命中重大利空」的票；空表 = 不封禁（fail-open）。
// 因此「扫描没跑 / 文件缺失 / JSON 坏」一律返回空集合——绝不误伤正常交易，
// 也绝不把「没扫」冒充「已清白」。
//
// 用法（后续接入 paper.js 建仓路径）：
//   import { isRiskBlacklisted, loadRiskBlacklist } from './risk_blacklist.js';
//   if (isRiskBlacklisted(code)) { 拒绝买入; 记 reason; }

import { readFileSync, existsSync } from 'node:fs';

export const RISK_BLACKLIST_PATH = 'data/llm_risk_blacklist.json';

/**
 * 读取黑名单，返回 { set, data }。
 * set = 被封禁的 code 集合；data = 完整 payload（含 blacklist/reasons，供日志）。
 * 任何异常（缺失/坏 JSON/缺字段）→ 空集合 + data=null。
 */
export function loadRiskBlacklist(path = RISK_BLACKLIST_PATH) {
  if (!existsSync(path)) return { set: new Set(), data: null };
  try {
    const d = JSON.parse(readFileSync(path, 'utf8'));
    const list = Array.isArray(d.blacklist) ? d.blacklist : [];
    const set = new Set(list.map((b) => String(b.code)));
    return { set, data: d };
  } catch {
    return { set: new Set(), data: null };
  }
}

/** 某 code 是否在排雷黑名单中（命中即应拒绝买入）。 */
export function isRiskBlacklisted(code, path = RISK_BLACKLIST_PATH) {
  if (code == null) return false;
  return loadRiskBlacklist(path).set.has(String(code));
}

/** 返回某 code 的封禁原因（用于日志/审计），未命中返回 null。 */
export function riskBlacklistReason(code, path = RISK_BLACKLIST_PATH) {
  if (code == null) return null;
  const { data } = loadRiskBlacklist(path);
  if (!data) return null;
  const hit = (data.blacklist || []).find((b) => String(b.code) === String(code));
  return hit ? `${hit.riskLevel}：${(hit.reasons || []).join('、')}` : null;
}
