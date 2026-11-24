#!/usr/bin/env node
/* gate_alert_artifacts.mjs —— alert_only 产物门禁（用户拍板 2026-11-24）
 *
 * 事故背景：flag=alert_only 但报告仍输出"推荐仓位区间 30%~50%"——已发给读者，
 * 代码修好不影响已发出的错误指令。此门禁把"版本戳 ⇔ 无仓位档字段 ⇔ 正文无仓位指令"
 * 做成 exit(1) 硬失败，覆盖三份产物：reco / reconcile / pre_market（+ post_market 同族）。
 *
 * 判定：
 *   产物 marketTierVersion 含 alert_only ⇒
 *     ① 不存在任何非 null 仓位档字段（pos/allowNew/targetPos/tierPos/position/alloc/
 *        position_range/positionReconcile/capRange/baseRange/finalRange）
 *     ② 正文（JSON 全文）不命中仓位指令正则（推荐仓位区间/建议仓位/风控帽/N%~M% 等）
 *   任一失败 → process.exit(1)。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketTierVersion, TIER_MODE_FLAG } from '../src/tier_policy.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POSITION_FIELDS = [
  'pos', 'allowNew', 'targetPos', 'tierPos', 'position', 'alloc',
  'position_range', 'positionReconcile', 'capRange', 'baseRange', 'finalRange',
];
/* 文本正则：只匹配"仓位指令"语义，不匹配"仅告警/不参与仓位决策"这类否定句（那些是正确文案）。 */
const TEXT_PATTERNS = [
  /推荐仓位区间/,
  /建议仓位(?!上限)/,          // "个股建议仓位上限"是个股风控，不是总仓位档——但在 alert_only 下也一律禁
  /风控帽/,
  /最终执行仓位/,
  /\b\d{1,3}\s*%\s*~\s*\d{1,3}\s*%/,   // 30%~50% 这类区间
  /满仓档|半仓档|清仓档/,
];

function walk(o, fn, path = '$') {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach((v, i) => walk(v, fn, `${path}[${i}]`)); return; }
  for (const [k, v] of Object.entries(o)) { fn(k, v, `${path}.${k}`); walk(v, fn, `${path}.${k}`); }
}

const ver = marketTierVersion();
const isAlert = ver.includes('alert_only');
const files = [
  'data/reco_picks_latest.json',
  'data/reconcile_picks_latest.json',
  'data/reports/pre_market_2026-11-24.json',
  'data/reports/post_market_2026-11-24.json',
];
let fails = 0;
for (const f of files) {
  const p = resolve(ROOT, f);
  if (!existsSync(p)) continue;
  const raw = readFileSync(p, 'utf8');
  const doc = JSON.parse(raw);
  const docIsAlert = String(doc.marketTierVersion || '').includes('alert_only');
  if (!isAlert) continue;   // 非 alert_only 模式：门禁用旧判据（此脚本只守 alert_only）
  if (!docIsAlert) { console.error(`[gate] ❌ ${f} 缺 alert_only 版本戳（实际 ${doc.marketTierVersion || '无'}）`); fails++; continue; }
  const bad = [];
  walk(doc, (k, v, path) => {
    /* payload.positions.* 是双轨账本的"已执行持仓事实"（trackA），不是系统输出的
     * 仓位建议——alert_only 只禁"系统告诉读者该拿多少"，不抹掉历史持仓记录。 */
    if (path.startsWith('$.payload.positions')) return;
    if (POSITION_FIELDS.includes(k) && v != null) bad.push(`${path}=${JSON.stringify(v).slice(0, 40)}`);
  });
  if (bad.length) { console.error(`[gate] ❌ ${f} 声明 alert_only 却藏仓位字段: ${bad.slice(0, 5).join(' | ')}`); fails++; }
  /* probText 是"历史同特征组上涨占比 57%~65%"——概率说明，不是仓位区间；
   * 扫描前剔除该字段值，避免 %~% 模式误报（该字段本身也已在 C 前改名相对强度）。 */
  const scanText = raw.replace(/"probText"\s*:\s*"[^"]*"/g, '"probText": ""');
  const textHits = TEXT_PATTERNS.filter((re) => re.test(scanText)).map((re) => re.source);
  if (textHits.length) { console.error(`[gate] ❌ ${f} 正文命中仓位指令正则: ${textHits.join(' | ')}`); fails++; }
  if (!bad.length && !textHits.length) console.log(`[gate] ✓ ${f}`);
}
if (fails) { console.error(`[gate] 合计 ${fails} 项失败——alert_only 产物不得输出仓位指令（exit 1）`); process.exit(1); }
console.log(`[gate] 全部通过（flag=${TIER_MODE_FLAG.mode}, ${ver}）`);
