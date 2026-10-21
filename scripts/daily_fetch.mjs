// 每日收盘后自动采集入口（2026-10-08）：定时任务唯一入口，顺序执行——
//   ① scripts/emotion_history.mjs --fetch-latest  拉取今日涨停池（幂等入库）+ 全量情绪计算
//   ② scripts/scan_old_dragon.mjs                  老龙头候选逐日扫描
//   ③ scripts/main_theme_history.mjs                主线题材历史（聚类/持续性/轮动）
// 任一步失败即中止并退出非零（cron 可据此告警）；全部成功打印 "daily fetch done"。
// 另有一条**收尾断言**（见下方 assertZtpoolIngested）：涨停池必须真的进了库才算成功——
//   它是不可回补数据（东财只给最近交易日），静默丢失 = 永久断链，不能靠"脚本没报错"背书。
//
// 用法（手动验证同此命令）：
//   node scripts/daily_fetch.mjs
// 定时部署见 docs/cron.md / crontab.example（15:30 抓收盘后快照，日志 logs/daily_fetch.log）。
//
// 交易日闸门（2026-10-10 用户指令）：非交易日（周末/法定休市，按交易日历判定）
//   打印 [skip] 后直接退出——不调 API、不做任何 git 操作。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { isTradingDay, resolveHolidays } from '../src/calendar.js';
import { pushOpsAlerts } from '../src/opsalerts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 交易日闸门（所有 API 调用与 git 操作之前）───────────────────────────────
//   判定走 src/calendar.js（交易日判定唯一出处，读 data/calendar.json 交易日历，
//   CI 每班在管道前续期）。语义与用户规格一致：
//   · 命中休市清单 / 周末 → 非交易日（closed 清单按设计不含周末，周末由判定层兜住，
//     直接查清单会漏周六——calendar.js validateCalendar 明文拒收含周末的清单）；
//   · 调休补班（日历 trading 覆盖的周末开市日）→ 照常执行；
//   · 日历未覆盖的未来日期 → 回退「非周末即交易日」：宁可白跑一次，
//     不可把开市日误判成休市（ztpool 不可回补，方向性取舍见 docs/cron.md §4）。
const bjToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }); // 北京当日，不依赖系统时区
const today = bjToday();
if (!isTradingDay(today, resolveHolidays())) {
  console.log(`[skip] ${today} 非交易日，跳过涨停池入库`);
  process.exit(0);
}

// ── 收尾断言：今日涨停池到底入库了没有（2026-10-10 用户指令）─────────────────
//   为什么必须有这一步：东财 getTopicZTPool 只返回最近交易日。接口空 / 被墙 / 服务端
//   给了旧日期时，emotion_history.mjs 打印「接口今日无数据…跳过」后仍然 **exit 0**
//   ——定时任务据此判定成功，当日涨停池就**静默丢失**了。而它不可回补：错过一天，
//   老龙头判定所需的 ≥10 交易日冷却链直接断裂（docs/cron.md §6）。
//   判据刻意做成**端到端**：不依赖接口返回语义，只问"ztpool_history.json 末条日期
//   是不是今天"——空返回、网络挂、写入失败、服务端回退旧日期，四种成因一网打尽。
const ZT_PATH = path.join(ROOT, 'data', 'ztpool_history.json');
const normDate = (d) => String(d ?? '').replace(/-/g, '');

async function assertZtpoolIngested() {
  let hist = null;
  try {
    hist = existsSync(ZT_PATH) ? JSON.parse(readFileSync(ZT_PATH, 'utf8')) : null;
  } catch { hist = null; }
  const last = Array.isArray(hist) && hist.length ? normDate(hist[hist.length - 1]?.date) : '';
  if (last !== normDate(today)) {
    console.error(`[daily_fetch] ✗ 收尾断言失败：今日（${today}）涨停池未入库——ztpool_history 末条为 ${last || '（空/不可读）'}`);
    await fail(1,
      `[daily_fetch] ✗ 收尾断言失败：今日（${today}）涨停池未入库——ztpool_history 末条为 ${last || '（空/不可读）'}`,
      '[daily_fetch]   该日涨停池不可回补，错过即永久丢失（老龙头 ≥10 交易日冷却链断裂）',
      '[daily_fetch]   处置：交易日当天人工补跑本脚本；纪律见 docs/cron.md §6',
    );
  }
  console.log(`[daily_fetch] ✓ 收尾断言：${today} 涨停池已入库（ztpool_history 共 ${hist.length} 天）`);
}

// ── 失败出口：日志 + 企微告警 + 非零退出（2026-10-10 用户指令）───────────────
//   本机 cron 此前唯一的信号是"退出码"，而退出码不会主动找人——静默丢一天正是这么发生的。
//   这里复用 CI 同一条企微通道（src/opsalerts.js + OPS_WEBHOOK），本机配了该环境变量即生效；
//   **未配置时 pushOpsAlerts 内部静默跳过**，不会把任务拖成另一种失败（本地零打扰）。
async function fail(exitCode, ...lines) {
  for (const l of lines) console.error(l);
  try {
    const r = await pushOpsAlerts([{
      at: new Date().toISOString(),
      severity: 'error',
      kind: 'cron-fail',
      source: 'daily_fetch',
      detail: [`[daily_fetch] 失败（exit ${exitCode}）@ ${today}（北京交易日）`, ...lines].join('\n'),
    }]);
    console.log(r.pushed
      ? '[daily_fetch] 企微告警已推送'
      : `[daily_fetch] 企微未推送：${r.error ?? 'OPS_WEBHOOK 未配置（仅落日志）'}`);
  } catch (e) {
    console.error('[daily_fetch] 企微告警异常（不影响退出码）：', e?.message ?? e);
  }
  process.exit(exitCode);
}

const STEPS = [
  { script: 'scripts/emotion_history.mjs', args: ['--fetch-latest'], desc: '拉取今日涨停池 + 计算情绪', post: assertZtpoolIngested },
  { script: 'scripts/scan_old_dragon.mjs', args: [], desc: '扫描老龙头候选' },
  { script: 'scripts/main_theme_history.mjs', args: [], desc: '主线题材历史' },
];

for (const step of STEPS) {
  console.log(`\n[daily_fetch] ▶ ${step.desc}（${step.script}）`);
  const r = spawnSync(process.execPath, [path.join(ROOT, step.script), ...step.args], { stdio: 'inherit' });
  if (r.error) {
    await fail(1, `[daily_fetch] ✗ ${step.script} 启动失败：${r.error.message}`);
  }
  if (r.status !== 0) {
    await fail(r.status ?? 1, `[daily_fetch] ✗ ${step.script} 失败（exit ${r.status}），后续步骤中止`);
  }
  // 断言紧跟产出它的那一步：池没进库就别让后面的扫描跑在陈旧数据上（失败要快、要响）
  if (step.post) await step.post();
}
console.log('\ndaily fetch done');

// ── 主任务成功后：源对照（只读诊断，2026-10-10）─────────────────────────────
//   目的：为"东财主源 → AkShare 备源"降级链积累决策数据（两源到底一不一致）。
//   定位：**只读、不入库**；跑完看数据再决定留/删，脚本以 tmp_ 前缀明示临时身份。
//   ⚠ 关键：**失败不影响本脚本退出码**——主任务已成功，不该因诊断脚本的网络抖动
//     而误告警（那会把"入库成功"报成失败，反而淹没真告警）。
const XCHECK = path.join(ROOT, 'scripts', 'tmp_ztpool_crosscheck.mjs');
if (existsSync(XCHECK)) {
  console.log('\n[daily_fetch] ▶ 源对照（只读诊断，成败不计入主流程）');
  const x = spawnSync(process.execPath, [XCHECK], { stdio: 'inherit' });
  if (x.status !== 0) {
    console.warn(`[daily_fetch] ⚠ 源对照未成功（exit ${x.status ?? '?'}）——本次入库结论不受影响`);
  }
} else {
  console.log('\n[daily_fetch] （源对照脚本已移除，跳过）');
}
