// 跨档口径审计违例告警（企微 + GitHub issue 兜底）——不新建 secret、不裸 curl。
//
// 为什么单独成脚本、不复用 guard_notify：
//   guard_notify 的判词是 **冒烟（smoke）语义**——「冒烟档不可读（脚本未走到
//   落盘即崩）」是拿 smoke-latest.json 判的。本 workflow（Daily Data Health）
//   压根不跑冒烟，之前为了复用告警通道，--file 故意指向一个不存在的档
//   （no-smoke-report-for-this-job.json）去触发 ERROR 分支——结果是 2026-10-11
//   08:41 那次告警：审计脚本**没崩**，它诚实红的是「pain 停 9-30 ≠ 档案锚 10-08」
//   （断供未修），读者却收到「守卫脚本自身异常/崩了」——文不对题，误导排查方向。
//   本脚本按 cross_check.mjs 的既有通道模式发**口径审计自己的文案**。
//
// 纪律：
//   · 恒 exit 0——告警通道自身故障绝不把 CI 拖红（红只属于审计违例本身）；
//   · 档不存在或 ok=true → 静默跳过（本 step 可能由其他 step 失败而触发）；
//   · secret 未配 → pushOpsAlerts/createGuardIssue 内部跳过，仅落日志。
//
// 用法：node scripts/notify_caliber_fail.mjs --file data/caliber-latest.json \
//          [--run-id <id>] [--run-url <url>]
import { readFileSync, existsSync } from 'node:fs';
import { pushOpsAlerts } from '../src/opsalerts.js';
import { buildIssuePayload, createGuardIssue } from '../src/guard_notify.js';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const FILE = arg('--file') || 'data/caliber-latest.json';

if (!existsSync(FILE)) {
  console.log(`[caliber-notify] 审计档不存在（${FILE}）——非审计失败，跳过告警`);
  process.exit(0);
}
let rep = null;
// strip BOM：Windows 系工具落盘可能带 UTF-8 BOM，JSON.parse 不接受——
//   双保险（主链已由 audit 脚本自写 utf8 无 BOM，但别让环境差异再次制造"解析失败"）。
try { rep = JSON.parse(readFileSync(FILE, 'utf8').replace(/^﻿/, '')); } catch (e) {
  console.log('[caliber-notify] 审计档不可解析——跳过告警:', e?.message ?? e);
  process.exit(0);
}
if (!rep || rep.ok !== false) {
  console.log(`[caliber-notify] 审计通过（ok=${rep?.ok}）——无违例，静默`);
  process.exit(0);
}

const anchor = rep.anchor ?? '未知';
const bad = Array.isArray(rep.rows) ? rep.rows.filter((r) => r && (r.state === 'behind' || r.state === 'missing')) : [];
// 违例明细：每项一行「档名 日期 状态｜理由」——读者一眼看到是哪档、哪天、为什么。
const detail = bad.length
  ? bad.map((r) => `· ${r.label ?? r.key}: ${r.date ?? '—'} ${r.state === 'missing' ? '缺档' : '落后于档案锚'}`
      + (r.staleReason ? `｜${r.staleReason}` : (r.note ? `｜${r.note}` : ''))).join('\n')
  : '· 明细见 run 日志';

const at = new Date().toISOString();
const runId = process.env.GITHUB_RUN_ID || arg('--run-id') || null;
const reason = `跨档口径审计违例 ${bad.length} 项 @ 档案锚 ${anchor}`;
const event = {
  at,
  severity: 'error',
  kind: 'caliber',
  source: 'audit',
  detail: `${reason}\n${detail}\n——宁红不假：相关模块已按 P0-2 拒收旧值（报告显示"缺席"而非旧口径），`
    + `修复断供后本档自动转绿。${runId ? ` · run ${runId}` : ''}`,
};
console.log(`[caliber-notify] ⚠ ${event.detail}`);

// 通道 1：企微
try {
  const r = await pushOpsAlerts([event]);
  if (r.pushed > 0) console.log('[caliber-notify] 企微通知已推送');
  else console.log('[caliber-notify] 企微未推送：', r.error ?? (r.skipped ? 'OPS_WEBHOOK 未配置（仅落日志）' : '无事件'));
} catch (e) {
  console.error('[caliber-notify] 企微通知异常（不拖红 CI）:', e?.message ?? e);
}

// 通道 2：GitHub issue 兜底（labels guard + caliber，可按标签筛出口径异常台账）
const repo = process.env.GITHUB_REPOSITORY || arg('repo') || null;
const [owner, repoName] = repo ? repo.split('/') : [null, null];
try {
  const payload = buildIssuePayload(
    { status: 'CALIBER_FAIL', reason, event },
    {
      repo, runId, runUrl: arg('--run-url'),
      titlePrefix: '跨档口径审计', labels: ['guard', 'caliber'],
    },
  );
  const r = await createGuardIssue(payload, { token: process.env.GITHUB_TOKEN || arg('token'), owner, repoName });
  if (r.created) console.log(`[caliber-notify] issue 兜底已建 #${r.number} ${r.url ?? ''}`);
  else console.log('[caliber-notify] issue 未建：', r.error ?? (r.skipped ? 'GITHUB_TOKEN / repo 未配置（仅 CI 内创建）' : '未知原因'));
} catch (e) {
  console.error('[caliber-notify] issue fallback 异常（不拖红 CI）:', e?.message ?? e);
}
process.exit(0);
