// 每日 CI 体检（2026-11-13 豆包第十轮）：静止期兜底挂在本机必跑的日报链上，
// 不依赖 GitHub schedule —— 官方文档：公开仓库 60 天无活动会自动禁用 scheduled workflows。
// 触发：工作日 16:25（本机 16:00 主 fetch + GitHub 16:10 schedule 之后）。
// 验收窗口：2026-11-16（周一，11-14 是周六、工作日 cron 不触发）16:25；
//   验收标准：test-gate 出现 event=schedule 且当日 conclusion=success 的 run；
//   验收人：本脚本自动推企微 + 用户确认。
// 用法：node scripts/daily_ci_gate.mjs（CI_GATE_DRY=1 只打印不推送）
import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

const ROOT = '/opt/a-sentiment-pro';
const WF_ID = 416252650;                       // test-gate（2026-11-13 查得）
const SCHEDULE_SINCE = Date.parse('2026-11-13T00:00:00Z');
const LOG = '/var/log/aquant/ci_gate.log';
const DRY = process.env.CI_GATE_DRY === '1';
const bj = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');

const t = spawnSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
const tap = (t.stdout || '') + (t.stderr || '');
const pass = +(tap.match(/^# pass (\d+)/m)?.[1] || 0);
const fail = +(tap.match(/^# fail (\d+)/m)?.[1] || 0);
const skipped = +(tap.match(/^# skipped (\d+)/m)?.[1] || 0);
const localOk = t.status === 0 && fail === 0;

let ci = { state: '未知', runs24h: '未知', failed24h: '未知', schedule: '未知', stale: false, verify: '未到验收日' };
try {
  const w = await (await fetch(`https://api.github.com/repos/sjc19950404/a-sentiment-pro/actions/workflows/${WF_ID}`)).json();
  ci.state = w.state || '未知';
  const r = await (await fetch(`https://api.github.com/repos/sjc19950404/a-sentiment-pro/actions/workflows/${WF_ID}/runs?per_page=20`)).json();
  const runs = r.workflow_runs || [];
  const recent = runs.filter((x) => Date.now() - Date.parse(x.created_at) < 86400000);
  ci.runs24h = recent.length;
  ci.failed24h = recent.filter((x) => x.conclusion === 'failure').length;
  const headRun = runs[0];
  ci.head = headRun ? `${headRun.head_sha.slice(0, 7)} ${headRun.conclusion || headRun.status}` : '未知';
  const sch = runs.find((x) => x.event === 'schedule');
  const today = bj().slice(0, 10);
  if (sch) {
    const schDay = new Date(Date.parse(sch.created_at) + 8 * 3600000).toISOString().slice(0, 10);
    ci.schedule = `${schDay} ${(sch.conclusion || sch.status)}`;
    ci.stale = Date.now() - Date.parse(sch.created_at) > 3 * 86400000;
    ci.verify = schDay === today ? `✅ 首次 schedule 实证：${sch.conclusion || sch.status}` : `今日尚未触发（最近 ${schDay}）`;
  } else {
    const waiting = Date.now() - SCHEDULE_SINCE <= 4 * 86400000;
    ci.schedule = waiting ? '等待首次触发（工作日 16:10）' : '⚠ 无任何 schedule 记录';
    ci.stale = !waiting;
    ci.verify = waiting ? '待 2026-11-16 16:25 验收' : '⚠ 疑似停用';
  }
  if (ci.state !== 'active' && ci.state !== '未知') ci.stale = true;
} catch (e) { ci.error = e.message; }

const lines = [
  `🔎【CI 每日体检】${bj()}`,
  `本机 npm test: ${pass} pass / ${fail} fail / ${skipped} skipped → ${localOk ? '✓' : '✗ 红'}`,
  `CI 近 24h: ${ci.runs24h} 次运行 / ${ci.failed24h} 次失败（含调试期历史红）| 最新 run: ${ci.head || '未知'} | workflow state: ${ci.state}`,
  `schedule: ${ci.schedule}${ci.stale ? ' ⚠ 疑似停用（60 天无活动自动禁用或从未触发）' : ''}`,
  `验收: ${ci.verify}`,
  ...(ci.error ? [`GitHub API 读取失败（fail-open，不误报）: ${ci.error}`] : []),
  `--no-verify 漏口：本机常规路径由 pre-commit/pre-push 拦，绕过时唯一拦截点是 CI 失败邮件；本体检每天扫一次近 24h 失败记录。`,
];
const msg = lines.join('\n');
console.log(msg);
try { appendFileSync(LOG, `[${new Date().toISOString()}] ${msg.replace(/\n/g, ' | ')}\n`); } catch { }

if (!DRY) {
  const env = (() => { try { const m = readFileSync(`${ROOT}/.env`, 'utf8').match(/OPS_WEBHOOK=([^\r\n]+)/); return m ? m[1].trim() : null; } catch { return null; } })();
  if (env) {
    // 正常态每天一条短报（绑在日报时段顺带看），异常态同样推送；推送失败不阻断。
    try { await fetch(env, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: msg } }) }); } catch { }
  }
}
