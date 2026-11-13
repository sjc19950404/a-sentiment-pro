// 报告产出闸门（2026-11-13：把契约校验从「事后扫档」前移到「生成时 / 落盘前」）
//
// 起因：一次 pts.push 漏 kind → 脏档 21:13 落盘 → 18:30 契约检查拦下盘后管道 →
//   18:00 体检/用户贴告警才发现。而 npm test 在改代码时全过（磁盘档当时还是干净的）——
//   **校验有效但时刻错位**。本模块提供两道闸，令这类违例不可能流到下游：
//     ① assertDailyReport：渲染函数出口自检，改代码后跑测试当场红（不依赖磁盘档）
//     ② assertSignalsContract：写盘前用 schemas/ 的完整契约校验，违例拒绝落盘（保留上一份好档）
//   两道闸失败都抛错并带原因码，不做静默降级——「同色不同因」的纪律同样适用于产出链路。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract, formatContractErrors } from './contract.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 与 schemas/signals-latest.schema.json 的 points.kind 枚举保持一致。
// 与 schemas/signals-latest.schema.json /dailyReport/sections/*/points/*/kind 枚举一致。
//   ok/quote/warn 为渲染器既有合法语义（校验通过 / 游资黑话 / 兜底告警），2026-11-13 补齐——
//   此前 schema 只列 5 种，条件分支命中就会产出契约违例档（潜伏缺陷，非本次事故主因）。
export const POINT_KINDS = Object.freeze(['main', 'evidence', 'caution', 'unknown', 'info', 'ok', 'quote', 'warn']);
const KIND_SET = new Set(POINT_KINDS);

export const GUARD_CODE = Object.freeze({
  POINT_KIND: 'report_point_kind_missing',
  CONTRACT: 'signals_contract_violation',
});

/** ① 渲染出口不变量：每个 section 的每个 point 必须有 text + 合法 kind。 */
export function assertDailyReport(report) {
  const bad = [];
  const sections = Array.isArray(report?.sections) ? report.sections : [];
  for (let si = 0; si < sections.length; si++) {
    // missing=true 的节走 schema 的 missingReason 分支，points 不受约束（可为字符串数组）→ 跳过。
    if (sections[si]?.missing === true) continue;
    const pts = sections[si]?.points;
    if (!Array.isArray(pts)) continue;
    for (let pi = 0; pi < pts.length; pi++) {
      const p = pts[pi];
      if (!p || typeof p.text !== 'string' || !KIND_SET.has(p.kind)) {
        bad.push(`/sections/${si}/points/${pi} kind=${p?.kind ?? '(缺)'}`);
      }
    }
  }
  if (bad.length) {
    throw new Error(`[report-guard] code=${GUARD_CODE.POINT_KIND} 共 ${bad.length} 处 point 缺/非法 kind（schema required [text, kind]）：${bad.slice(0, 4).join('；')}`);
  }
  return report;
}

let _schema = null;
/** ② 落盘前完整契约校验。用 JSON 往返对齐「实际写入的字符串」，避免 undefined 等形态假阳性。 */
export function assertSignalsContract(signals, label = 'signals-latest.json') {
  if (!_schema) {
    _schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'signals-latest.schema.json'), 'utf8'));
  }
  const onDiskForm = JSON.parse(JSON.stringify(signals));
  const errs = validateContract(onDiskForm, _schema);
  if (errs.length) {
    throw new Error(`[report-guard] code=${GUARD_CODE.CONTRACT} 拒绝落盘 ${label}（保留上一份好档）：\n${formatContractErrors(label, errs)}`);
  }
  return onDiskForm;
}
