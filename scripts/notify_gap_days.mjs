// 档案缺交易日告警（企微 + GitHub issue 兜底）——不新建 secret、不裸 curl。
//
// 为什么单独成脚本：缺天是**非常具体**的信息（缺哪几天、档案末档是哪天、
// 日历覆盖到哪天），复用 guard_notify 只能得到「步骤失败，明细见 run 日志」——
// 读者得自己点进 run 翻日志才知道缺了什么。直书明细，一眼可判。
//
// 纪律（与 notify_caliber_fail.mjs 完全一致）：
//   · 恒 exit 0——告警通道自身故障绝不把 CI 拖红（红只属于检测本身）；
//   · 档不存在 / ok≠false / 非数组明细 → 静默跳过（本 step 可能由别的 step 触发）；
//   · secret 未配 → pushOpsAlerts/createGuardIssue 内部跳过，仅落日志。
//
// 用法：node scripts/notify_gap_days.mjs --file data/gap-days-latest.json \
//          [--run-id <id>] [--run-url <url>]
import { readFileSync, existsSync } from 'node:fs';
import { pushOpsAlerts } from '../src/opsalerts.js';
import { buildIssuePayload, createGuardIssue } from '../src/guard_notify.js';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const FILE = arg('--file') || 'data/gap-days-latest.json';

if (!existsSync(FILE)) {
  console.log(`[gap-notify] 检测档不存在（${FILE}）——非缺天失败，跳过告警`);
  process.exit(0);
}
let rep = null;
// strip BOM：Windows 系工具落盘可能带 UTF-8 BOM，JSON.parse 不接受（双保险）。
try { rep = JSON.parse(readFileSync(FILE, 'utf8').replace(/^﻿/, '')); } catch (e) {
  console.log('[gap-notify] 检测档不可解析——跳过告警:', e?.message ?? e);
  process.exit(0);
}
const missing = Array.isArray(rep && rep.recentMissing) ? rep.recentMissing : [];
if (!rep || rep.ok !== false || !missing.length) {
  console.log(`[gap-notify] 无缺失（ok=${rep?.ok}, 缺 ${missing.length} 天）——静默`);
  process.exit(0);
}

const at = new Date().toISOString();
const runId = process.env.GITHUB_RUN_ID || arg('--run-id') || null;
// 明细：缺哪几天 + 档案末档/日历覆盖——这三样决定了"缺的是不是真缺口"。
const detail = `· 缺失交易日：${missing.join(' ')}`
  + `\n· 档案末档 ${rep.archiveLast ?? '无'} · 日历覆盖至 ${rep.coveredTo ?? '未知'}`
  + `\n· 窗口：最近 ${(rep.window || []).length} 个交易日`
  + (rep.missing && rep.missing.length > missing.length
    ? `\n· 窗口外另有 ${rep.missing.length - missing.length} 天历史缺失（--all 查看）` : '');

const reason = `档案缺 ${missing.length} 个交易日（末档 ${rep.archiveLast ?? '无'}）`;
const event = {
  at,
  severity: 'error',
  kind: 'gap',
  source: 'audit',
  // 说清"不会自动补"——避免读者以为等一等就好：daily.yml 无 backfill 调度，
  // 缺的天不会自己回来（2026-10-09 即此：10-10 run cancelled，永久缺失）。
  detail: `${reason}\n${detail}\n——缺天不会自动补回（CI 无 backfill 调度）：报告按宁缺毋假显示“缺席”。`
    + `如需补数须手动跑补数路径。${runId ? ` · run ${runId}` : ''}`,
};
console.log(`[gap-notify] ⚠ ${event.detail}`);

// 通道 1：企微
try {
  const r = await pushOpsAlerts([event]);
  if (r.pushed > 0) console.log('[gap-notify] 企微通知已推送');
  else console.log('[gap-notify] 企微未推送：', r.error ?? (r.skipped ? 'OPS_WEBHOOK 未配置（仅落日志）' : '无事件'));
} catch (e) {
  console.error('[gap-notify] 企微通知异常（不拖红 CI）:', e?.message ?? e);
}

// 通道 2：GitHub issue 兜底（labels guard + gap-days）
const repo = process.env.GITHUB_REPOSITORY || arg('repo') || null;
const [owner, repoName] = repo ? repo.split('/') : [null, null];
try {
  const payload = buildIssuePayload(
    { status: 'GAP_DAYS', reason, event },
    {
      repo, runId, runUrl: arg('--run-url'),
      titlePrefix: '档案缺交易日', labels: ['guard', 'gap-days'],
    },
  );
  const r = await createGuardIssue(payload, { token: process.env.GITHUB_TOKEN || arg('token'), owner, repoName });
  if (r.created) console.log(`[gap-notify] issue 兜底已建 #${r.number} ${r.url ?? ''}`);
  else console.log('[gap-notify] issue 未建：', r.error ?? (r.skipped ? 'GITHUB_TOKEN / repo 未配置（仅 CI 内创建）' : '未知原因'));
} catch (e) {
  console.error('[gap-notify] issue fallback 异常（不拖红 CI）:', e?.message ?? e);
}
process.exit(0);
