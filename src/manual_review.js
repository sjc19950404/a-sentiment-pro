// 人工审核「改判台账」纯函数层 —— 与 src/outlier_review.js 同纪律：零 fs、零业务依赖，
// 可被管线（Node）、前端（只读展示 / 本机写入）共用。
//
// ── 与 industry_outlier_review.json（销案台账）的区别 ────────────────────────
// 销案台账只认 confirmed-real / data-error，且强制带「复核方式 + 证据」（无证据不得销案）。
// 人工审核是**另一种动作**：人工把某条在「需复核(warn) ↔ 已剔除(dirty)」之间改判，
// 原因可以是「口径调整 / 历史数据修正 / 其他手填」这类**主观判定**，不该被销案台账的
// 证据纪律绑架。故独立成文件，互不改变彼此的守卫语义。
//
// ── 主键 ────────────────────────────────────────────────────────────────────
//   · 行业类告警（OUTLIER_INDUSTRY / COUNTER_INDEX）：按 (日期, 行业) 主键，
//     复用 outlier_review.js 的 reviewKey —— 与 dirty.js 的销案抑制走同一把钥匙。
//   · 其它字段类告警：按 (日期, 字段路径) 主键。
//   两处（写入方/消费方）必须用同一实现，否则覆盖静默失效。
import { reviewKey } from './outlier_review.js';

export const MANUAL_STATUSES = { DIRTY: 'dirty', WARN: 'warn' };

/** 人工改判的默认「调整原因」清单（选「其他」则手填 customReason）。 */
export const DEFAULT_REASONS = [
  '跨源核验为真实行情',
  '确认异常应剔除',
  '口径调整',
  '历史数据修正',
  '其他',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 从 issue.reason 抽行业名（行业类告警 reason 形如 `行业「油气开采及服务」...`）。 */
export function industryFromReason(reason) {
  if (!reason || typeof reason !== 'string') return null;
  const m = reason.match(/行业[「『](.+?)[」』]/);
  return m ? m[1].trim() : null;
}

/** 覆盖主键：(日期, 行业) 走 reviewKey；(日期, 字段) 走 `date|field`。 */
export function overrideKey(tradeDate, issue) {
  const ind = industryFromReason(issue && issue.reason);
  if (ind) return reviewKey(tradeDate, ind);
  const field = issue && issue.field;
  if (!field) return null;
  return `${String(tradeDate == null ? '' : tradeDate).trim()}|${String(field)}`;
}

/** 结构守卫：返回 { ok, errors[] }。落盘前后都应过一遍（结构坏 → 拒绝使用）。 */
export function validateManualReview(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object') return { ok: false, errors: ['台账不是对象'] };
  if (ledger.kind !== 'manual-review') errors.push(`kind 非法: ${ledger.kind}`);
  if (!Array.isArray(ledger.entries)) {
    errors.push('entries 必须为数组');
    return { ok: false, errors };
  }
  const seen = new Set();
  ledger.entries.forEach((e, i) => {
    const tag = `entries[${i}]`;
    if (!e || typeof e !== 'object') { errors.push(`${tag} 不是对象`); return; }
    if (!DATE_RE.test(e.date || '')) errors.push(`${tag}.date 非法: ${e.date}`);
    if (![MANUAL_STATUSES.DIRTY, MANUAL_STATUSES.WARN].includes(e.newStatus)) errors.push(`${tag}.newStatus 非法: ${e.newStatus}`);
    if (!e.field && !e.industry) errors.push(`${tag} 缺 field 与 industry（至少其一）`);
    if (!e.reason || typeof e.reason !== 'string') errors.push(`${tag} 缺 reason`);
    else if (!DEFAULT_REASONS.includes(e.reason)) errors.push(`${tag}.reason 不在默认清单: ${e.reason}（应走「其他」+ customReason）`);
    if (e.reason === '其他' && (!e.customReason || !String(e.customReason).trim())) errors.push(`${tag} reason=其他 但缺 customReason`);
    const k = e.industry ? reviewKey(e.date, e.industry) : `${e.date}|${e.field}`;
    if (seen.has(k)) errors.push(`${tag} 主键重复: ${k}`);
    seen.add(k);
  });
  return { ok: errors.length === 0, errors };
}

/** 台账 → Map<key, entry>（重复主键取后者，validateManualReview 已保证不重复）。 */
export function buildManualMap(ledger) {
  const map = new Map();
  const entries = ledger && Array.isArray(ledger.entries) ? ledger.entries : [];
  for (const e of entries) {
    const k = e.industry ? reviewKey(e.date, e.industry) : (e.date && e.field ? `${e.date}|${e.field}` : null);
    if (k) map.set(k, e);
  }
  return map;
}

/**
 * 查某条 issue 的人工改判结论。
 * @returns {'dirty'|'warn'|null} null＝无覆盖（照自动判定）
 */
export function overrideForIssue(ledger, tradeDate, issue) {
  const key = overrideKey(tradeDate, issue);
  if (!key) return null;
  const e = buildManualMap(ledger).get(key);
  return e ? e.newStatus : null;
}

/**
 * 把台账合并进现有台账（幂等，同键以新条目为准）。返回新台账（不就地改）。
 * 仅当新条目结构合法才合并，避免脏写破坏整份台账。
 */
export function mergeManualEntries(ledger, newEntries) {
  const base = ledger && typeof ledger === 'object' ? ledger : { kind: 'manual-review', version: 1, entries: [] };
  const map = buildManualMap(base);
  for (const e of newEntries || []) {
    if (e && e.date && (e.field || e.industry)) map.set(e.industry ? reviewKey(e.date, e.industry) : `${e.date}|${e.field}`, e);
  }
  const entries = [...map.values()].sort((a, b) => (
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.industry || '').localeCompare(b.industry || '')
  ));
  return { ...base, entries };
}
