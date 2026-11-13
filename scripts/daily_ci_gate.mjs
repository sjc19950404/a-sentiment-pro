// 每日 CI 体检（2026-11-13 豆包第十二轮复审后重写）
// 【定性】静止期告警（dead man's switch），不是「结构性兜底」：能力上限 = 把静默失效变成
//   一条企微消息，不含自动恢复（60 天被禁用需仓库 activity 或 gh workflow enable；本机无 GH token）。
//   Keep Repo Alive 每月 1/26 推 staging 产生 activity，但它自身也依赖 schedule，是递归，不视为已解决。
//
// 【与 heartbeat-sentinel 的分工（2026-11-13 核实，此前未查就下过结论）】
//   仓库已有 .github/workflows/heartbeat-sentinel.yml（active）+ scripts/heartbeat_sentinel.mjs：
//     · 它监控「数据档是否覆盖最近交易日」（signals-latest / smoke-latest / 双轨账本），
//       不看 workflow state、不看 schedule 是否被 60 天禁用；其 workflow 注释写明
//       「自动调度已迁树莓派(pi_run.sh)，保留手动兜底」→ GitHub 侧只剩 workflow_dispatch 手动触发。
//     · 本机心跳 data/ci_gate_last_run.json 监控的是「本告警器自身是否还活着」，
//       由每日 18:00 的 daily_selfcheck.mjs 读取，超 3 个交易日无更新即报停摆。
//   两者监控对象不同 → 互补，不是重复；但「GitHub 侧没有兜底机制」这个前提当时未经核实，
//   现更正：有一个 GitHub 侧哨兵存在，只是不覆盖调度停用且自动调度已迁出。
//
// 【判定主依据】workflow 的 state 枚举（强证据），一次 GET /actions/workflows?per_page=100 取全量，
//   不猜枚举名。白名单 DISABLED_BY_DESIGN 排除「有意停用」：实测 15 个 workflow 里
//   push-1009-verify = disabled_manually（一次性验证已完成使命），扫全量而不排除它会天天误报。
//   「多久没 run」只做缺席提示，按交易日触发点计数（排除周末/长假），绝不当停用判据——
//   周五 16:10→周一 16:25 = 72.25h 是正常周末间隔，日历天数阈值必误报。
//
// 【API 四路径（豆包第十二轮：匿名 API 60 次/小时，实测会撞限流）】
//   ok                → 正常判定
//   api_unavailable   → HTTP 403/429 + X-RateLimit-Remaining: 0：既非正常也非故障，是「未知」。
//                       不判 PASS/FAIL、不更新状态快照、推一条 info（每日最多一次），日志打印配额。
//   api_error         → 其他 4xx/5xx：真故障，告警
//   network_error     → fetch 抛错：真故障，告警
//   每次执行只发 2 次调用（1 次全量 workflows + 1 次 test-gate runs），不逐 workflow 扫 15 次。
//   心跳 HEARTBEAT 在限流时照写但带 apiUnavailable 标记：心跳语义是「脚本执行过」不是
//   「验证成功」；不写会让日报链在连续限流时误报「告警器停摆」，那是把限流画成停摆。
//
// 【静态已知项（不进每日短报，避免告警疲劳）】
//   --no-verify 漏口：绕过 pre-commit 的提交仍会进仓库，常规拦截只剩 CI 失败邮件；
//   若邮件漏发则无人知晓，直至每工作日 16:25 体检扫到近 24h 失败记录。
//
// 【验收】机器化断言，见 src/ci_verify.mjs：PASS/FAIL + 原因码 + FAIL exit 非 0，
//   验收日 2026-11-16（11-14 周六、工作日 cron 不触发），验收人 = 脚本，无需人工确认。
//
// 触发：工作日 16:25。用法：node scripts/daily_ci_gate.mjs
//   CI_GATE_DRY=1 只打印不推送/不写文件；CI_GATE_NOW_MS 注入时钟用于机器化验证。
import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { verifySchedule } from '../src/ci_verify.mjs';
import { classifyWorkflows, classifyApiResponse } from '../src/ci_workflow_state.mjs';
import { checkRuntime, RUNTIME_CODE } from '../src/runtime_preflight.mjs';

// ── 0. 运行时环境自检（2026-11-13：cron 曾无 PATH 跑系统 node20，jsdom 加载失败
//     → 47 个 DOM 测试静默 skip，短报却显示「0 fail」全绿）。声明 engines 必须被执行时刻验证。
//    不匹配时下面 npm test 的 0 fail 不能算绿：把 skip 当成 pass 就是这个循环的另一种形态。
const runtime = checkRuntime();

const ROOT = '/opt/a-sentiment-pro';
// 以下 3 个注入点仅用于机器化验证（本地 mock 限流/去重，不碰真实 API、不推真实企微）；生产不设。
const API = process.env.CI_GATE_API_BASE || 'https://api.github.com/repos/sjc19950404/a-sentiment-pro';
const DATA_DIR = process.env.CI_GATE_DATA_DIR || `${ROOT}/data`;
const WEBHOOK_OVERRIDE = process.env.CI_GATE_WEBHOOK || null;
const WF_ID = 416252650;                       // test-gate
const VERIFY_FROM = Date.parse('2026-11-16T08:10:00Z');   // 北京周一 16:10
const ACCEPT_DAY = '2026-11-16';
const LOG = '/var/log/aquant/ci_gate.log';
const STATE_FILE = `${DATA_DIR}/ci_gate_state.json`;      // 状态快照（限流时不更新）
const HEARTBEAT = `${DATA_DIR}/ci_gate_last_run.json`;    // 告警器自证
const NOTICE_FILE = `${DATA_DIR}/ci_gate_api_notice.json`; // info 每日最多一次
const DRY = process.env.CI_GATE_DRY === '1';
const NOW = process.env.CI_GATE_NOW_MS ? Number(process.env.CI_GATE_NOW_MS) : Date.now();
const bj = () => new Date(NOW + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const todayBj = () => bj().slice(0, 10);

function tradingDaysBetween(fromDay, toDay) {
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

// 状态快照要在本机测试前读：skip 判据用「相对上次的变化」，不用硬编码绝对阈值
//   （绝对阈值会在合法新增一个 skip 时天天误报，与此前被否掉的时钟阈值同类）。
let prev = {};
try { prev = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { }

// ── 1. 本机全量测试（静止期无 push 时的唯一完整检测）──
const t = spawnSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
const tap = (t.stdout || '') + (t.stderr || '');
const pass = +(tap.match(/^# pass (\d+)/m)?.[1] || 0);
const fail = +(tap.match(/^# fail (\d+)/m)?.[1] || 0);
const skipped = +(tap.match(/^# skipped (\d+)/m)?.[1] || 0);
// 环境不匹配时，测试结果的 0 fail 无意义（依赖没加载 → 批量 skip）→ 不算绿、不算验收通过。
// 只在「相对上次快照显著增加」时报：首次运行无基线不报，合法新增 1 个 skip 也不会天天报。
const prevSkipped = typeof prev.skipped === 'number' ? prev.skipped : null;
const skipSurge = prevSkipped !== null && skipped > prevSkipped + 1;
const localOk = t.status === 0 && fail === 0 && runtime.ok && !skipSurge;

// ── 2. GitHub API：全量 state 一次取 + test-gate runs 一次取（共 2 次调用）──
let ci = {
  state: '未知', wfTotal: 0, unexpected: [], byDesign: [],
  runs24h: '未知', failed24h: '未知', schedule: '未知', head: '未知',
  verify: null, apiCode: 'ok', apiError: null, quota: [],
};

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'a-sentiment-ci-gate' } });
  const h = {
    limit: res.headers.get('x-ratelimit-limit'),
    remaining: res.headers.get('x-ratelimit-remaining'),
    used: res.headers.get('x-ratelimit-used'),
  };
  ci.quota.push({ endpoint: url.split('/actions/')[1] || url, status: res.status, ...h });
  const cls = classifyApiResponse(res.status, { 'x-ratelimit-remaining': h.remaining });
  return cls.code === 'ok' ? { code: 'ok', data: await res.json() } : { code: cls.code, data: null };
}

try {
  // ① 全量 workflows：一次拿 15 个 state（不是逐 workflow 15 次）
  const a = await getJson(`${API}/actions/workflows?per_page=100`);
  if (a.code !== 'ok') {
    ci.apiCode = a.code;
  } else {
    const wf = a.data.workflows || [];
    const cls = classifyWorkflows(wf);
    ci.wfTotal = cls.total;
    ci.unexpected = cls.unexpected;
    ci.byDesign = cls.byDesign;
    ci.state = (wf.find((w) => w.id === WF_ID) || {}).state || '未知';
  }
  // ② 仅在 API 正常时查 runs（避免限流下把空 runs 当成「没有 schedule run」误判 FAIL）
  if (ci.apiCode === 'ok') {
    const b = await getJson(`${API}/actions/workflows/${WF_ID}/runs?per_page=30`);
    if (b.code !== 'ok') {
      ci.apiCode = b.code;
    } else {
      const runs = b.data.workflow_runs || [];
      const recent = runs.filter((x) => NOW - Date.parse(x.created_at) < 86400000);
      ci.runs24h = recent.length;
      ci.failed24h = recent.filter((x) => x.conclusion === 'failure').length;
      const headRun = runs[0];
      ci.head = headRun ? `${headRun.head_sha.slice(0, 7)} ${headRun.conclusion || headRun.status}` : '未知';
      const sch = runs.find((x) => x.event === 'schedule');
      if (sch) {
        const schDay = new Date(Date.parse(sch.created_at) + 8 * 3600000).toISOString().slice(0, 10);
        ci.schedule = `${schDay} ${(sch.conclusion || sch.status)}`;
        const missed = tradingDaysBetween(schDay, todayBj());
        ci.absence = missed >= 2 ? `缺席 ${missed} 个预期触发点（best-effort 可能丢弃，非故障）` : null;
      } else {
        ci.schedule = '暂无 schedule 记录（等待首次触发）';
      }
      ci.verify = verifySchedule(runs, { nowMs: NOW, fromMs: VERIFY_FROM, acceptDay: ACCEPT_DAY });
    }
  }
} catch (e) {
  ci.apiError = e.message;
  ci.apiCode = 'network_error';
}
// 四路径：限流/故障一律不判 PASS/FAIL（UNKNOWN），只有真 FAIL 才让 exit 非 0
if (ci.apiCode !== 'ok') ci.verify = { result: 'UNKNOWN', code: ci.apiCode };

// ── 3. 状态变化检测（每日短报只放变化，不放永久静态项）──
// prev 已在第 1 节前读入（skip 基线需要它）
const changes = [];
// 全量 state：非 active 且不在白名单 → 带 name + 实际 state 报警
for (const u of ci.unexpected) changes.push(`⛔ workflow ${u.name} state=${u.state}（非 active、非白名单）→ 定时检查可能已停用`);
if (ci.state !== 'active' && ci.state !== '未知' && !ci.unexpected.some((u) => u.name === 'test-gate')) {
  // test-gate 单独兜底（若全量接口字段异常）
  changes.push(`⛔ test-gate state=${ci.state}（非 active）`);
}
if (prev.state && prev.state !== ci.state) changes.push(`test-gate state 变化：${prev.state} → ${ci.state}`);
if (typeof ci.failed24h === 'number' && typeof prev.failed24h === 'number' && ci.failed24h > prev.failed24h) changes.push(`近 24h 新增失败 ${ci.failed24h - prev.failed24h} 次`);
if (!localOk) changes.push(`✗ 本机 npm test 红：${fail} fail（runtime=${runtime.code}, skipped=${skipped}）`);
if (!runtime.ok) changes.push(`⛔ 运行时不匹配 ${RUNTIME_CODE.MISMATCH}：${runtime.reason} → 本机测试结论不可用`);
if (skipSurge) changes.push(`⛔ skip 数 ${skipped} 较上次 ${prevSkipped} 激增（原因码 ${RUNTIME_CODE.MISMATCH}）：依赖可能未加载，0 fail 不代表通过`);
if (ci.verify?.result === 'PASS' && prev.verifyCode !== 'ok') changes.push(`✅ 验收 PASS（原因码 ok）`);
if (ci.verify?.result === 'FAIL') changes.push(`❌ 验收 FAIL：原因码 ${ci.verify.code}`);
if (ci.absence) changes.push(`ℹ ${ci.absence}`);
// api_error / network_error = 真故障，进变化项；api_unavailable 走下方 info 通道（每日最多一次）
if (ci.apiCode === 'api_error' || ci.apiCode === 'network_error') changes.push(`⚠ API ${ci.apiCode}：${ci.apiError || '非限流类故障，判定未完成'}`);

// 措辞避坑：daily_selfcheck 的 run.log 异常留痕匹配式含「异常」二字，
//   写「异常 0」会让一条正常短报被当成异常留痕（2026-11-13 18:00 体检实证误报）。改用中性计数词。
const headLine = `🔎【CI 体检】${bj()}｜本机 ${pass} pass/${fail} fail/${skipped} skip｜workflows ${ci.wfTotal} 个（非白名单停用 ${ci.unexpected.length}）｜test-gate state=${ci.state}｜最新 run: ${ci.head}`;
const lines = [headLine];
if (changes.length) lines.push(...changes.map((c) => '  · ' + c));
else lines.push('  · 无状态变化（本机测试与 CI 状态均稳定）');
lines.push(`  API: ${ci.apiCode}｜验收: ${ci.verify?.result || '未知'}（${ci.verify?.code || '未知'}）`);
// 配额账：每次调用的 status / remaining / limit 都落日志
for (const q of ci.quota) lines.push(`  配额: ${q.endpoint} → HTTP ${q.status}, remaining=${q.remaining}/${q.limit}, used=${q.used}`);
if (ci.byDesign.length) lines.push(`  白名单留痕: ${ci.byDesign.map((d) => `${d.name}(${d.state})`).join(', ')}`);
const msg = lines.join('\n');
console.log(msg);
try { appendFileSync(LOG, `[${new Date().toISOString()}] ${msg.replace(/\n/g, ' | ')}\n`); } catch { }

// ── 4. 心跳 / 快照 / 推送 ──
let lastNotice = '';
try { lastNotice = JSON.parse(readFileSync(NOTICE_FILE, 'utf8')).day || ''; } catch { }
const infoDue = ci.apiCode === 'api_unavailable' && lastNotice !== todayBj();

if (!DRY) {
  // 心跳：语义是「脚本执行过」，限流也写（带 apiUnavailable 标记），否则日报链会把限流误报成停摆
  try { writeFileSync(HEARTBEAT, JSON.stringify({ ts: Date.now(), day: todayBj(), state: ci.state, apiUnavailable: ci.apiCode === 'api_unavailable' })); } catch { }
  // 状态快照：只在 API 正常时更新（限流时不能把「未知」写成下次比较的基线）
  if (ci.apiCode === 'ok') {
    try { writeFileSync(STATE_FILE, JSON.stringify({ state: ci.state, failed24h: ci.failed24h, verifyCode: ci.verify?.code, skipped, runtime: runtime.code })); } catch { }
  }
  const infoLine = infoDue ? `\nℹ api_unavailable：GitHub 匿名 API 配额耗尽（403 + remaining 0），本次未做 CI 判定、未更新状态快照；非故障，配额重置后自动恢复。每日仅提示一次。` : '';
  if (changes.length || infoDue) {
    const env = WEBHOOK_OVERRIDE || (() => { try { const m = readFileSync(`${ROOT}/.env`, 'utf8').match(/OPS_WEBHOOK=([^\r\n]+)/); return m ? m[1].trim() : null; } catch { return null; } })();
    if (env) {
      try { await fetch(env, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: msg + infoLine } }) }); } catch { }
    }
  }
  if (infoDue) {
    try { writeFileSync(NOTICE_FILE, JSON.stringify({ day: todayBj(), apiCode: 'api_unavailable' })); } catch { }
  }
}

// 验收失败 → exit 非 0；api_unavailable / UNKNOWN 不误报红
// 运行时不匹配也算硬失败：否则「0 fail + 48 skip」会以一个绿勾蒙混过去。
if (ci.verify?.result === 'FAIL' || !runtime.ok || skipSurge || fail > 0) process.exitCode = 1;
