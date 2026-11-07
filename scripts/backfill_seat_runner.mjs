#!/usr/bin/env node
process.env.ASPRO_AUTO_PUSH = '1'; // pre-push 门禁豁免（自动回填链，同 pi_push.sh）
// ─────────────────────────────────────────────────────────────────────────────
// 席位明细回填「批次驱动器」
//
// 干什么：把 backfill_seat_details.mjs 按交易日切成若干批，逐批串行执行；
//   每批成功后立即 git commit + push archive.json（防 pi_run.sh 的
//   `git reset --hard origin/main` 把未推送的回填成果冲掉）；任一批失败
//   （子进程退出码非 0 / 有天级失败）即停止并落状态，等人工排查后再续跑。
//
// 为什么分批 + 每批推送：
//   · 全量 238 天约 3.8 万次请求、数小时，一口气跑完出错成本高；
//   · EOD 管道每次运行都 reset --hard origin/main，未推送的本地改动会被回滚。
//     每批推送后，已完成的批次落到 origin/main，reset 也冲不掉。
//
// 断点续跑：backfill_seat_details.mjs 本身幂等（已补齐的天跳过），本驱动器
//   每轮重新计算缺口清单——已补齐的天自动不再出现在批次里，故重跑即续跑。
//
// 用法：
//   node scripts/backfill_seat_runner.mjs            # 自动逐批跑全部缺口（每批 30 交易日）
//   node scripts/backfill_seat_runner.mjs --batch 20 # 自定义每批交易日数
//
// 运行状态：data/backfill_seat_runner_state.json（running/done/failed + 批次明细）。
// 建议放晚间闲时跑（请求量大，勿盘中与日常采集抢配额）。
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeArchive } from '../src/lhb_codec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ARCHIVE = resolve(ROOT, 'data/archive.json');
const STATE = resolve(ROOT, 'data/backfill_seat_runner_state.json');
const SCRIPT = resolve(HERE, 'backfill_seat_details.mjs');

const argv = process.argv.slice(2);
const batchArg = (() => { const i = argv.indexOf('--batch'); return i >= 0 ? Math.max(1, +argv[i + 1] || 30) : 30; })();

const nowIso = () => new Date().toISOString();
const log = (s) => { const line = `[seat-runner ${nowIso()}] ${s}`; console.log(line); };

function writeState(patch) {
  let cur = {};
  try { if (existsSync(STATE)) cur = JSON.parse(readFileSync(STATE, 'utf8')); } catch { cur = {}; }
  const next = { ...cur, ...patch, updatedAt: nowIso() };
  writeFileSync(STATE, JSON.stringify(next, null, 1));
  return next;
}

// 该天是否已有可用 v2 双侧 detail
function hasSeats(d) {
  const det = d?.summary?.seats?.detail;
  return !!(det && typeof det === 'object' && Object.keys(det).length
    && Object.values(det).some((v) => v && !Array.isArray(v) && Array.isArray(v.s)));
}

// 当前缺口交易日（升序）
function gapDays() {
  const arc = decodeArchive(JSON.parse(readFileSync(ARCHIVE, 'utf8')));
  return (arc.all_days || [])
    .filter((d) => d && d.trade_date && !hasSeats(d) && (d.lhb || []).length > 0)
    .map((d) => d.trade_date)
    .sort();
}

// git 提交 + 推送（重试）；返回 true=成功
function commitAndPush(msg) {
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  run('git', ['add', 'data/archive.json']);
  const c = run('git', ['commit', '-m', `data: 席位明细回填批次（${new Date().toISOString().slice(0, 10)}）`]);
  if (c.status !== 0 && !/nothing to commit/.test((c.stdout || '') + (c.stderr || ''))) {
    log(`git commit 异常：${(c.stderr || c.stdout || '').trim()}`);
    // 不视为致命：可能是无变化
  }
  for (let att = 0; att < 3; att++) {
    const p = run('git', ['push', 'origin', 'main']);
    if (p.status === 0) return true;
    log(`git push 第 ${att + 1} 次失败：${(p.stderr || '').trim().slice(0, 120)}`);
  }
  return false;
}

async function main() {
  const gaps = gapDays();
  if (!gaps.length) {
    log('无缺口，全部交易日已有 v2 席位明细。');
    writeState({ status: 'done', totalBatches: 0, batches: [], finishedAt: nowIso() });
    return;
  }
  const batches = [];
  for (let i = 0; i < gaps.length; i += batchArg) batches.push(gaps.slice(i, i + batchArg));
  log(`缺口 ${gaps.length} 个交易日，按每批 ${batchArg} 天切为 ${batches.length} 批`);
  writeState({ status: 'running', startedAt: nowIso(), totalBatches: batches.length, batches: [] });

  const stateBatches = [];
  for (let bi = 0; bi < batches.length; bi++) {
    const b = batches[bi];
    const since = b[0], until = b[b.length - 1];
    const rec = { idx: bi + 1, since, until, days: b.length, startedAt: nowIso() };
    log(`批次 ${bi + 1}/${batches.length}：${since} ~ ${until}（${b.length} 个交易日）开始`);
    writeState({ status: 'running', currentBatch: bi + 1, totalBatches: batches.length, batches: stateBatches });

    const r = spawnSync(process.execPath, [SCRIPT, '--since', since, '--until', until], { cwd: ROOT, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const m = out.match(/回填 (\d+) 天 \/ 跳过已有 (\d+) 天 \/ 失败 (\d+) 天/);
    const failN = m ? +m[3] : null;
    const fillN = m ? +m[1] : null;
    rec.filled = fillN; rec.failed = failN; rec.finishedAt = nowIso();

    if (r.status !== 0 || failN === null || failN > 0) {
      rec.result = 'failed';
      rec.tail = out.trim().split('\n').slice(-6).join(' | ');
      stateBatches.push(rec);
      writeState({ status: 'failed', currentBatch: bi + 1, totalBatches: batches.length, batches: stateBatches, error: rec.tail });
      log(`✗ 批次 ${bi + 1} 失败（退出码 ${r.status}，失败天 ${failN}），已停止。回填本身幂等，排查后重跑本驱动器即从此批续跑。`);
      log(`输出尾部：${rec.tail}`);
      process.exit(1);
    }

    // 成功：立即提交 + 推送，防 EOD reset 冲掉
    if (!commitAndPush()) {
      rec.result = 'push_failed';
      stateBatches.push(rec);
      writeState({ status: 'failed', currentBatch: bi + 1, totalBatches: batches.length, batches: stateBatches, error: 'git push 连续失败（网络/远端问题）' });
      log(`✗ 批次 ${bi + 1} 数据已写盘但 push 失败，已停止（防 reset 冲掉）。恢复网络后重跑。`);
      process.exit(1);
    }
    rec.result = 'ok';
    stateBatches.push(rec);
    writeState({ status: 'running', currentBatch: bi + 1, totalBatches: batches.length, batches: stateBatches });
    log(`✓ 批次 ${bi + 1} 完成（回填 ${fillN} 天）并已推送`);
  }

  writeState({ status: 'done', totalBatches: batches.length, batches: stateBatches, finishedAt: nowIso() });
  log(`全部 ${batches.length} 批完成。跑 npm run gate-check 查看③④覆盖率抬升后的真实分布。`);
}

main().catch((e) => {
  writeState({ status: 'failed', error: String(e && e.message || e) });
  console.error('[seat-runner] 致命错误：', e);
  process.exit(1);
});
