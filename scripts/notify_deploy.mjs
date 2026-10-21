// 部署失败告警（deploy-pages.yml 末尾 if: failure() step 调用）。
//
// 复用 src/opsalerts.js 的 pushOpsAlerts（企微 text bot，schema 与 guard_notify 同源）：
//   · 未配 OPS_WEBHOOK → 静默跳过（本地零打扰，CI 配 secret 才推）；
//   · push 失败绝不抛出（告警通道自身故障不能把 CI 拖红）；
//   · 恒 exit 0——通知通道永远不是新的单点。
//
// 载荷字段（一眼能定位问题）：
//   · latest.trade_date：从 data/archive-recent.json 读，即「当前线上最近一次成功部署到的数据日期」。
//     部署失败时 main 未变，它 = 上次成功部署态，用于快速判断「线上停留在哪天」；
//   · commit sha / run url / job 名：定位失败现场（点 run url 看具体失败 step）。
//
// 用法（CI 注入 env，本地可 mock）：
//   OPS_WEBHOOK=<url> DEPLOY_SHA=<sha> DEPLOY_RUN_URL=<url> DEPLOY_JOB=<job> node scripts/notify_deploy.mjs
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushOpsAlerts } from '../src/opsalerts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function latestTradeDate() {
  try {
    const r = JSON.parse(readFileSync(join(ROOT, 'data', 'archive-recent.json'), 'utf8'));
    return r?.latest?.trade_date || r?.meta?.tradeDate || '未知';
  } catch {
    return '未知（archive-recent.json 不可读）';
  }
}

const sha = process.env.DEPLOY_SHA || '未知';
const runUrl = process.env.DEPLOY_RUN_URL || '未知';
const job = process.env.DEPLOY_JOB || 'deploy';
const workflow = process.env.DEPLOY_WORKFLOW || 'deploy-pages';
const tradeDate = latestTradeDate();

const event = {
  at: new Date().toISOString(),
  severity: 'error',
  kind: 'deploy-fail',
  source: 'deploy-pages',
  detail:
    `${workflow} 部署失败 @ job=${job} · commit=${sha}\n` +
    `当前线上数据日期（最近成功部署）= ${tradeDate}\n` +
    `排查: ${runUrl}`,
};

console.log(`[notify-deploy] 部署失败事件：${event.detail}`);
try {
  const r = await pushOpsAlerts([event]);
  if (r.pushed > 0) console.log('[notify-deploy] 企微通知已推送');
  else console.log('[notify-deploy] 企微未推送：', r.error ?? (r.skipped ? 'OPS_WEBHOOK 未配置（仅落日志）' : '无事件'));
} catch (e) {
  console.error('[notify-deploy] 企微通知异常（不拖红 CI）:', e?.message ?? e);
}
process.exit(0); // 通知通道自身故障绝不把 CI 拖红
