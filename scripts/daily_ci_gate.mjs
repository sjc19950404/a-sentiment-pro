// 每日 CI 体检（2026-11-13 豆包第十一轮复审后重写）
// 【定性】这是「静止期告警」（dead man's switch），不是「结构性兜底」：
//   · 能力上限 = 把静默失效变成一条企微消息；不含自动恢复（60 天被禁用后需仓库 activity
//     或 gh workflow enable；本机无 GH token，两者都做不到）。仓库另有 Keep Repo Alive
//     workflow 每月 1/26 号往 staging 推提交产生 activity，但它自身也依赖 schedule，不视为已解决。
//   · 告警器自身无兜底 → 本报告每次写 data/ci_gate_last_run.json，由每日 18:00 的
//     daily_selfcheck.mjs 读它，超过 3 个交易日无更新即报「CI 体检本身已停摆」。
//
// 【判定主依据】workflow 的 state 枚举（GitHub 自己给出的强证据）：
//   state !== 'active'（active / disabled_inactivity / disabled_manually / disabled_fork 等）→ 硬告警。
//   「多久没 run」只做缺席提示，且按工作日触发点计数（排除周末/长假），绝不当停用判据——
//   周五 16:10→周一 16:25 = 72.25h 是正常周末间隔，日历天数阈值必误报。
//
// 【静态已知项（不进每日短报，避免告警疲劳）】
//   --no-verify 漏口：技术不可禁 → 绕过 pre-commit 的提交仍会进仓库，常规拦截只剩 CI 失败邮件；
//   若邮件漏发则该次提交无人知晓，直至每工作日 16:25 的体检扫到近 24h 失败记录。
//   此条只在收口结论/本报告头注释出现，不每天重复推。
//
// 【验收】机器化断言，见 src/ci_verify.mjs：
//   判定 = 存在 run(event=schedule && conclusion=success && created_at >= 2026-11-16T08:10:00Z)
//   结果 = PASS / FAIL（原因码 no_schedule_run / run_failed / gate_error），FAIL 时 exit 非 0。
//   验收日 2026-11-16（周一；11-14 周六、工作日 cron 不触发），验收人 = 脚本断言，无需人工确认。
//
// 触发：工作日 16:25（本机 16:00 主 fetch + GitHub 16:10 schedule 之后）
// 用法：node scripts/daily_ci_gate.mjs（CI_GATE_DRY=1 只打印不推送、不写心跳）
import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { verifySchedule } from '../src/ci_verify.mjs';

const ROOT = '/opt/a-sentiment-pro';
const WF_ID = 416252650;                       // test-gate（2026-11-13 查得）
const VERIFY_FROM = Date.parse('2026-11-16T08:10:00Z');   // 北京周一 16:10
const ACCEPT_DAY = '2026-11-16';
const LOG = '/var/log/aquant/ci_gate.log';
const STATE_FILE = `${ROOT}/data/ci_gate_state.json`;      // 上次快照（状态变化检测）
const HEARTBEAT = `${ROOT}/data/ci_gate_last_run.json`;    // 告警器自证
const DRY = process.env.CI_GATE_DRY === '1';
// 可注入时钟（仅用于机器化验证验收 PASS/FAIL 与 exit 码；生产默认 Date.now()）
const NOW = process.env.CI_GATE_NOW_MS ? Number(process.env.CI_GATE_NOW_MS) : Date.now();
const bj = () => new Date(NOW + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const todayBj = () => bj().slice(0, 10);

function tradingDaysBetween(fromDay, toDay) {
  // 数 (fromDay, toDay] 之间的交易日（排除周末与 calendar.closed 长假）
  let closed = [];
  try { const c = JSON.parse(readFileSync(`${ROOT}/data/calendar.json`, 'utf8')); closed = c.closed || []; } catch { }
  let n = 0;
  for (let d = Date.parse(fromDay + 'T12:00:00Z') + 86400000; d <= Date.parse(toDay + 'T12:00:00Z'); d += 86400000) {
    const s = new Date(d).toISOString().slice(0, 10);
    const dow = new Date(d).getUTCDay();
    if (dow >= 1 && dow <= 5 && !closed.includes(s)) n++;
  }
  return n;
}

// ── 1. 本机全量测试（静止期无 push 时的唯一完整 1963 检测）──
const t = spawnSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
const tap = (t.stdout || '') + (t.stderr || '');
const pass = +(tap.match(/^# pass (\d+)/m)?.[1] || 0);
const fail = +(tap.match(/^# fail (\d+)/m)?.[1] || 0);
const skipped = +(tap.match(/^# skipped (\d+)/m)?.[1] || 0);
const localOk = t.status === 0 && fail === 0;

// ── 2. GitHub API：state 枚举为主判据 ──
let ci = { state: '未知', runs24h: '未知', failed24h: '未知', schedule: '未知', head: '未知', verify: null, apiError: null };
try {
  const w = await (await fetch(`https://api.github.com/repos/sjc19950404/a-sentiment-pro/actions/workflows/${WF_ID}`)).json();
  ci.state = w.state || '未知';
  const r = await (await fetch(`https://api.github.com/repos/sjc19950404/a-sentiment-pro/actions/workflows/${WF_ID}/runs?per_page=30`)).json();
  const runs = r.workflow_runs || [];
  const recent = runs.filter((x) => NOW - Date.parse(x.created_at) < 86400000);
  ci.runs24h = recent.length;
  ci.failed24h = recent.filter((x) => x.conclusion === 'failure').length;
  const headRun = runs[0];
  ci.head = headRun ? `${headRun.head_sha.slice(0, 7)} ${headRun.conclusion || headRun.status}` : '未知';
  const sch = runs.find((x) => x.event === 'schedule');
  if (sch) {
    const schDay = new Date(Date.parse(sch.created_at) + 8 * 3600000).toISOString().slice(0, 10);
    ci.schedule = `${schDay} ${(sch.conclusion || sch.status)}`;
    const missed = tradingDaysBetween(schDay, todayBj());   // 应触发但没出现的工作日数
    ci.absence = missed >= 2 ? `缺席 ${missed} 个预期触发点（best-effort 可能丢弃，非故障）` : null;
  } else {
    ci.schedule = '暂无 schedule 记录（等待首次触发）';
    ci.absence = null;
  }
  // 机器化验收断言（独立，不受缺席提示影响）
  ci.verify = verifySchedule(runs, { nowMs: NOW, fromMs: VERIFY_FROM, acceptDay: ACCEPT_DAY });
} catch (e) {
  ci.apiError = e.message;
  ci.verify = { result: 'FAIL', code: 'gate_error' };    // API 读不到 = 无法验收，显式失败
}

// ── 3. 状态变化检测（每日短报只放变化，不放永久静态项）──
let prev = {};
try { prev = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { }
const changes = [];
if (ci.state !== 'active' && ci.state !== '未知') changes.push(`⛔ workflow state=${ci.state}（非 active）→ 定时检查已停用，需仓库 activity 或 gh workflow enable 恢复`);
if (prev.state && prev.state !== ci.state) changes.push(`state 变化：${prev.state} → ${ci.state}`);
if (typeof ci.failed24h === 'number' && typeof prev.failed24h === 'number' && ci.failed24h > prev.failed24h) changes.push(`近 24h 新增失败 ${ci.failed24h - prev.failed24h} 次`);
if (!localOk) changes.push(`✗ 本机 npm test 红：${fail} fail`);
// 验收结论：PASS 是一次性事件，只在首次/code 变化时进变化项；FAIL 是持续故障，每天进
//   （且下方 exit 非 0）——静默不能吃掉真红。
if (ci.verify?.result === 'PASS' && prev.verifyCode !== 'ok') changes.push(`✅ 验收 PASS（schedule 首次触发成功，原因码 ok）`);
if (ci.verify?.result === 'FAIL') changes.push(`❌ 验收 FAIL：原因码 ${ci.verify.code}`);
if (ci.absence) changes.push(`ℹ ${ci.absence}`);
if (ci.apiError) changes.push(`⚠ GitHub API 读取失败（fail-open，不误报 state）：${ci.apiError}`);

const headLine = `🔎【CI 体检】${bj()}｜本机 ${pass} pass/${fail} fail/${skipped} skip｜state=${ci.state}｜最新 run: ${ci.head}`;
const lines = [headLine];
if (changes.length) lines.push(...changes.map((c) => '  · ' + c));
else lines.push('  · 无状态变化（本机测试与 CI 状态均稳定）');
lines.push(`  验收: ${ci.verify?.result || '未知'}${ci.verify?.code ? '（' + ci.verify.code + '）' : ''}`);
const msg = lines.join('\n');
console.log(msg);
try { appendFileSync(LOG, `[${new Date().toISOString()}] ${msg.replace(/\n/g, ' | ')}\n`); } catch { }

if (!DRY) {
  // 告警器自证：每日日报链读此文件，超过 3 个交易日无更新即报停摆
  try { writeFileSync(HEARTBEAT, JSON.stringify({ ts: Date.now(), day: todayBj(), state: ci.state })); } catch { }
  try { writeFileSync(STATE_FILE, JSON.stringify({ state: ci.state, failed24h: ci.failed24h, verifyCode: ci.verify?.code })); } catch { }
  // 每日企微只推「状态变化」；无变化静默（仍落日志 + 写心跳 + 写快照）。
  // 「告警器还活着」由 18:00 日报链读心跳保证，不靠每天重复一条固定短报（质疑③）。
  if (changes.length) {
    const env = (() => { try { const m = readFileSync(`${ROOT}/.env`, 'utf8').match(/OPS_WEBHOOK=([^\r\n]+)/); return m ? m[1].trim() : null; } catch { return null; } })();
    if (env) {
      try { await fetch(env, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: msg } }) }); } catch { }
    }
  }
}

// 验收失败 → exit 非 0（机器化断言的显式信号）
if (ci.verify?.result === 'FAIL') process.exitCode = 1;
