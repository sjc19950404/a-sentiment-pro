// ① smoke 终态失败 → 企微告警（daily.yml smoke job 末尾的 if: failure() step）。
//
// 为什么必须单独一个 step 挂 if: failure()：
//   冒烟主 step 失败（两次重试后仍败）= build 被拦 = 宽度/主线/账本三模块当日全部停摆
//   且零告警（旧口径值继续顶替当日值，下游毫不知情）。CI 邮件只发一次且常被淹没，
//   企微才是「人真的会看到」的通道。挂 failure() 而非 always()：重试成功 = job 绿 =
//   不发——历史告警绝不补发，防刷屏。
//
// 纪律（与 src/opsalerts.js 同族）：
//   · 事件构造走 smokeFailEvent 纯函数（kind: 'smoke-fail'），推送走 pushOpsAlerts——
//     本脚本只做 IO 编排，零判定逻辑；
//   · 告警自身失败（webhook 未配/网络挂）**绝不拖红 CI**：恒 exit 0，错误只落日志；
//   · 读档读的是**本 run 刚落盘**的 data/smoke-latest.json（冒烟 step 的落盘在
//     if: always() 下先行完成，同 job 文件系统无跨 run 覆盖竞态）。
//
// 用法：node scripts/alert_smoke_fail.mjs --run-id <id> --run-url <url>
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushOpsAlerts, smokeFailEvent } from '../src/opsalerts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};

const smokePath = join(ROOT, 'data', 'smoke-latest.json');
let smoke = null;
if (existsSync(smokePath)) {
  try { smoke = JSON.parse(readFileSync(smokePath, 'utf8')); } catch { smoke = null; }
}

const event = smokeFailEvent(smoke, { runId: arg('run-id'), runUrl: arg('run-url') });
console.log('[smoke-alert] 事件正文：\n' + event.detail);

const r = await pushOpsAlerts([event]);
if (r.pushed > 0) console.log('[smoke-alert] 已推送企微告警');
else console.log('[smoke-alert] 未推送：', r.error ?? (r.skipped ? 'OPS_WEBHOOK 未配置（仅落日志，CI 不受影响）' : '无事件'));
process.exit(0); // 告警通道永远不是新的单点：失败只留日志，不拖红 CI
