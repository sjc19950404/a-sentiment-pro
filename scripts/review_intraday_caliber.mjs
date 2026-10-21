#!/usr/bin/env node
// ── 收盘口径复核（2026-10-10 用户指令：入库前再做一次收盘口径复核）──────────────
//
// 用法：node scripts/review_intraday_caliber.mjs [--date YYYY-MM-DD]
//   缺省复核当日（北京）盘中报告档案；--date 回看历史日（测试/复盘）。
//
// 挂载：daily.yml build job（18:30/21:00）——盘后报告生成之后、数据提交之前。
//   复核对象 = data/reports/intraday_D.json（⚠ 单文件覆盖机制：档案为当日最后一期，
//   前两期已被覆盖——既有行为，台账如实披露不冒充全量）。
//   数据底座 = data/ztpool_history.json 当日行（收盘涨停池，16:00 本地任务产物——
//   CI 读的是**已入库版本**；当日行缺席（本地任务未跑/未提交）→ 如实跳过，21:00 班
//   补上，台账幂等覆盖）。
//
// 复核项（收盘口径，纯台账不拦截）：
//   ① 池标的收盘结局（推送时点的趋势/连板标的，收盘是否涨停、几连板）；
//   ② 推送时实时情绪 vs 收盘情绪（ztpool 现算——emotion_history 不入库故不依赖它）；
//   ③ 连板矛盾（盘中宣称 N 连板 vs 收盘 lbc 差 >1——数据错误信号）。
//   台账写回档案顶层 caliber_review 字段 → 随既有 `git add data/reports` 清单入库
//   （提交规则零改动；16:00 本地入库任务的触发/文件范围/git 规则零触碰）。
//
// 纪律：观测不拦管线——任何异常恒 exit 0（daily.yml continue-on-error 双保险）；
//   绝不修改 payload 任何决策字段（复核是审计，不是改写历史）。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { closeoutReview } from '../src/pool_verify.js';
import { bjDate, bjTime } from '../src/freshness.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const di = argv.indexOf('--date');
const DATE = di >= 0 && argv[di + 1] ? argv[di + 1] : bjDate(new Date());
const file = join(ROOT, 'data', 'reports', `intraday_${DATE}.json`);

const log = (...a) => console.log('[caliber-review]', ...a);

if (!existsSync(file)) {
  log(`${DATE} 无盘中报告档案（非交易日或未生成）→ 跳过。`);
  process.exit(0);
}
let report = null;
try { report = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
  log(`档案损坏，跳过: ${e?.message || e}`);
  process.exit(0);
}
let ztpoolDays = null;
try { ztpoolDays = JSON.parse(readFileSync(join(ROOT, 'data', 'ztpool_history.json'), 'utf8')); } catch { ztpoolDays = null; }

const review = closeoutReview(report, Array.isArray(ztpoolDays) ? ztpoolDays : [], {
  nowBJ: `${bjDate(new Date())} ${bjTime(new Date())}`,
});
report.caliber_review = review;
try {
  atomicWriteJSON(file, JSON.stringify(report, null, 1) + '\n');
} catch (e) {
  log(`台账写回失败（不拦管线）: ${e?.message || e}`);
  process.exit(0);
}

// 摘要（一眼对账：收盘情绪 / 池结局 / 矛盾数 / 跳过原因）
if (review.note) { log(review.note); process.exit(0); }
const ce = review.close_emotion;
const le = review.emotion_at_push;
const po = review.pool_outcome || {};
const cnt = (arr) => (Array.isArray(arr) ? arr.filter((x) => x.close_limit_up).length : 0);
log(`${review.ztpoolDate} 收盘情绪 ${ce ? `${ce.emotion} ${ce.score ?? '—'}分` : '—'}`
  + `（推送时 ${le ? `${le.emotion} ${le.score ?? '—'}分` : '—'}）`
  + ` · 池结局：趋势 ${(po.trend || []).length} 只收盘涨停 ${cnt(po.trend)} / 连板 ${(po.streak || []).length} 只收盘涨停 ${cnt(po.streak)}`
  + (review.conflicts.length ? ` · ⚠ 连板矛盾 ${review.conflicts.length} 处` : ' · 无连板矛盾')
  + ' → 已写回 ' + `data/reports/intraday_${DATE}.json::caliber_review`);
