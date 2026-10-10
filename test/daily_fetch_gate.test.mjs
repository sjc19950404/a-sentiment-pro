// daily_fetch 交易日闸门 + 涨停池收尾断言（2026-10-10）
//
// 两条纪律在这里钉死，防止被后续改动悄悄拆掉：
//   ① 非交易日必须 [skip] 退出 0，且在 spawn 任何子进程之前就退出（零 API、零 git）；
//   ② 脚本内必须存在"涨停池入库"收尾断言——否则接口空返回时脚本 exit 0，
//      当日涨停池会静默丢失（不可回补，老龙头 ≥10 交易日冷却链断裂，见 docs/cron.md §6）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTradingDay, resolveHolidays } from '../src/calendar.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'daily_fetch.mjs');
const bjToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

test('交易日闸门：非交易日打印 [skip] 并退出 0，且不启动任何子进程', (t) => {
  const today = bjToday();
  if (isTradingDay(today, resolveHolidays())) {
    t.skip(`今天 ${today} 是交易日，跳过本条——避免真跑网络采集与数据写入`);
    return;
  }
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.error ?? null, null, `启动失败：${r.error?.message ?? ''}`);
  assert.equal(r.status, 0, `期望 exit 0，实际 ${r.status}\nstderr: ${r.stderr ?? ''}`);
  assert.match(r.stdout, /\[skip\] \d{4}-\d{2}-\d{2} 非交易日，跳过涨停池入库/);
  // 闸门在任何子进程之前退出 → 不应出现任何步骤启动标记
  assert.doesNotMatch(r.stdout, /\[daily_fetch\] ▶/);
});

test('收尾断言常在：脚本内保留涨停池入库校验（防静默丢失）', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /function assertZtpoolIngested/, '缺少 assertZtpoolIngested——接口空返回会静默丢一天');
  assert.match(src, /收尾断言失败/, '缺少断言失败分支文案');
  assert.match(src, /ztpool_history\.json/, '断言应校验 ztpool_history.json 末条日期');
});
