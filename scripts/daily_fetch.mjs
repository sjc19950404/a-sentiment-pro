// 每日收盘后自动采集入口（2026-10-08）：定时任务唯一入口，顺序执行——
//   ① scripts/emotion_history.mjs --fetch-latest  拉取今日涨停池（幂等入库）+ 全量情绪计算
//   ② scripts/scan_old_dragon.mjs                  老龙头候选逐日扫描
//   ③ scripts/main_theme_history.mjs                主线题材历史（聚类/持续性/轮动）
// 任一步失败即中止并退出非零（cron 可据此告警）；全部成功打印 "daily fetch done"。
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
import { isTradingDay, resolveHolidays } from '../src/calendar.js';

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

const STEPS = [
  { script: 'scripts/emotion_history.mjs', args: ['--fetch-latest'], desc: '拉取今日涨停池 + 计算情绪' },
  { script: 'scripts/scan_old_dragon.mjs', args: [], desc: '扫描老龙头候选' },
  { script: 'scripts/main_theme_history.mjs', args: [], desc: '主线题材历史' },
];

for (const step of STEPS) {
  console.log(`\n[daily_fetch] ▶ ${step.desc}（${step.script}）`);
  const r = spawnSync(process.execPath, [path.join(ROOT, step.script), ...step.args], { stdio: 'inherit' });
  if (r.error) {
    console.error(`[daily_fetch] ✗ ${step.script} 启动失败：${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`[daily_fetch] ✗ ${step.script} 失败（exit ${r.status}），后续步骤中止`);
    process.exit(r.status ?? 1);
  }
}
console.log('\ndaily fetch done');
