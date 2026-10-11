// 涨停池入库提交器（2026-10-11 排雷配套）
//
// 背景：Windows 计划任务 \ASentiment-dailyfetch-1600 只跑 ingest（scripts/daily_fetch.mjs），
//   不提交 git。该任务以 SYSTEM 身份运行、无 GitHub 凭据，故提交必须由有凭据的会话完成。
//   本脚本是"入库"的最后一步：本地 ingest 成功后，由人工或本机 Agent 跑一次即可，
//   严格遵循 docs/cron.md §6 纪律（仅 ztpool_history.json、先核后入库、标准 message）。
//
// 用法：
//   node scripts/daily_commit_ztpool.mjs
//
// 安全闸：
//   · 今日涨停池未真正入库（ztpool_history 末条 ≠ 北京当日）→ 拒绝提交，exit 1。
//     （防把"没跑/跑失败"的空档或陈旧数据推上去，掩盖丢失。）
//   · 文件无变更 → 直接 exit 0（幂等，可重复跑）。
//   · 只 `git add data/ztpool_history.json` 一个文件，绝不裹挟其它脏文件。
//   · push 前 `git pull --rebase origin staging`，避免 non-fast-forward 被拒。

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZT_PATH = path.join(ROOT, 'data', 'ztpool_history.json');
const normDate = (d) => String(d ?? '').replace(/-/g, '');

const run = (args, { allowFail = false } = {}) => {
  const r = spawnSync('git', args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' });
  if (r.error) { console.error(`[commit-zt] git 启动失败：${r.error.message}`); process.exit(1); }
  if (r.status !== 0 && !allowFail) {
    console.error(`[commit-zt] git ${args.join(' ')} 失败（exit ${r.status}）`);
    process.exit(r.status ?? 1);
  }
  return r;
};

const bjToday = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

// 1) 今日涨停池确已入库？
if (!existsSync(ZT_PATH)) { console.error('[commit-zt] ✗ ztpool_history.json 不存在'); process.exit(1); }
let hist;
try { hist = JSON.parse(readFileSync(ZT_PATH, 'utf8')); } catch (e) { console.error('[commit-zt] ✗ ztpool_history.json 解析失败：', e.message); process.exit(1); }
if (!Array.isArray(hist) || !hist.length) { console.error('[commit-zt] ✗ ztpool_history.json 为空/非数组'); process.exit(1); }
const last = normDate(hist[hist.length - 1]?.date);
if (last !== normDate(bjToday)) {
  console.error(`[commit-zt] ✗ 拒绝提交：今日（${bjToday}）涨停池未入库——末条为 ${last || '（无）'}`);
  console.error('[commit-zt]   处置：先确认 16:00 任务跑成功（daily_fetch.log），必要时当天补跑 daily_fetch.mjs 后再提交。');
  process.exit(1);
}

// 2) 有无变更？
const status = spawnSync('git', ['status', '--porcelain', 'data/ztpool_history.json'], { cwd: ROOT, encoding: 'utf8' });
if (!status.stdout.trim()) { console.log(`[commit-zt] 无需提交：${bjToday} 涨停池已入库且工作区干净`); process.exit(0); }

// 3) 仅暂存本文件（绝不 add 其它）
run(['add', 'data/ztpool_history.json']);

// 4) 提交（标准 message，沿用 §6 / 94dc7f7 先例）
const msg = `data: 涨停池历史入库 ${bjToday}（不可补采，幂等追加）`;
run(['commit', '-m', msg]);

// 5) 先 rebase 再 push，避免 non-fast-forward
run(['pull', '--rebase', 'origin', 'staging'], { allowFail: true });
run(['push', 'origin', 'staging']);

console.log(`[commit-zt] ✓ 已提交并推送 ${bjToday} 涨停池入库`);
