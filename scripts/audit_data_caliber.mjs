#!/usr/bin/env node
// 跨档口径一致性审计（P1-2，2026-10-10）—— 长期数据质量监控。
//
// 与 MODULE_PROBES（单模块新鲜度门禁，管「今天刷新了没」）互补：本脚本管
// **同一交易日各档口径互证**——档案锚 vs signals / pain / 涨停池 / 外围 /
// 板块排行 / 宽度，逐档回答「这份档描述的是哪一天」。10-08 事故的隐蔽形态
// 恰是本脚本靶子：档案 tradeDate=10-08 不滞后（整档新鲜度绿），但 pain 停在
// 9-30（模块口径落后整周）——单看任一档都发现不了，必须**跨档对照**。
//
// 判定语义（锚 = archive-index.latestDate，全仓最权威的「档案描述日」）：
//   · equal    档口径日 == 锚（理想态）
//   · ahead    档口径日 > 锚——外围（美股夜盘）/ 涨停池（本地 16:00 抢先 CI 入库）/
//              宽度（旁路管道）天然可先于档案，属正常时序 → INFO 不红
//   · behind   档口径日 < 锚——该档没跟上档案 → 红（exit 1）
//   · missing  档缺失或口径日字段缺失 → 红（exit 1）
//
// 用法：node scripts/audit_data_caliber.mjs [--json] [--anchor YYYY-MM-DD]
//   --json    机读输出（CI / 巡检机器人消费）
//   --anchor  覆盖锚日（测试用；默认取 archive-index.latestDate）
// 退出码：0 = 全部 equal/ahead；1 = 存在 behind/missing（诚实红）。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stalePainReason } from '../src/pain.js';
import { isDateStr, boardRankTradeDate } from '../src/module_freshness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', 'data');
const args = process.argv.slice(2);
const WANT_JSON = args.includes('--json');
const ANCHOR_ARG = args.includes('--anchor') ? args[args.indexOf('--anchor') + 1] : null;

const readJson = (p) => {
  if (!existsSync(p)) return { __missing: true };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return { __broken: e.message }; }
};

// 档口径日提取：null 表示字段缺失（区别于档缺失）。
const norm = (d) => (isDateStr(d) ? d : null);
const pickers = {
  signals: (j) => norm(j?.meta?.tradeDate),
  pain: (j) => norm(j?.curDate),
  global: (j) => norm(j?.meta?.aShareTradeDate),
  board_rank: (j) => boardRankTradeDate(j),
  breadth: (j) => norm(j?.meta?.tradeDate),
  ztpool: (j) => {
    if (!Array.isArray(j) || !j.length) return null;
    const raw = String(j[j.length - 1]?.date ?? '');
    // 涨停池历史档日期为无横杠形态（20261009）——消费前规范化（fbt 同款纪律）
    const iso = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    return isDateStr(iso) ? iso : null;
  },
};

// 各档的时序语义：ahead 是否属正常（默认不正常——与档案同拍的产物不该超前）
const AHEAD_OK = new Set(['global', 'ztpool', 'breadth']);
const LABELS = {
  signals: '信号档', pain: '亏钱效应', global: '外围快照',
  board_rank: '板块排行', breadth: '市场宽度', ztpool: '涨停池历史',
};

// ── 锚：archive-index.latestDate（轻量索引，不读 6.5MB 主档）─────────────
const idx = readJson(path.join(DATA, 'archive-index.json'));
const anchor = ANCHOR_ARG ?? norm(idx?.latestDate);
if (!anchor) {
  console.error('[CRITICAL] 档案锚缺失：archive-index.json 无 latestDate（管道未跑过？）——无法审计，诚实红。');
  process.exit(1);
}

const rows = [];
const FILES = { signals: 'signals-latest.json', pain: 'pain-latest.json', global: 'global.json', board_rank: 'board_rank.json', breadth: 'breadth-latest.json', ztpool: 'ztpool_history.json' };
for (const [key, pick] of Object.entries(pickers)) {
  const file = FILES[key];
  const j = readJson(path.join(DATA, file));
  const missingFile = !!j.__missing;
  const broken = !!j.__broken;
  const date = missingFile || broken ? null : pick(j);
  let state, note;
  if (missingFile) { state = 'missing'; note = `档缺失（${file}）`; }
  else if (broken) { state = 'missing'; note = `档损坏（JSON 解析失败）`; }
  else if (!date) { state = 'missing'; note = `口径日字段缺失（${file}）`; }
  else if (date === anchor) { state = 'equal'; note = '与档案锚一致'; }
  else if (date > anchor) {
    state = 'ahead';
    note = AHEAD_OK.has(key) ? '先于档案属正常时序（旁路/夜盘产物）' : '先于档案——异常（非旁路产物不应超前）';
  } else { state = 'behind'; note = `落后于档案锚（口径停在 ${date}）`; }
  // pain 附加陈旧闸语义（与 signals 注入层同一判据，P0-2）
  let stale = null;
  if (key === 'pain' && !missingFile && !broken) {
    stale = stalePainReason(j, anchor);
  }
  rows.push({ key, label: LABELS[key], file, date, anchor, state, note, staleReason: stale });
}

const bad = rows.filter((r) => r.state === 'behind' || r.state === 'missing'
  || (r.state === 'ahead' && !AHEAD_OK.has(r.key)));
const warn = rows.filter((r) => r.state === 'ahead' && AHEAD_OK.has(r.key));

if (WANT_JSON) {
  console.log(JSON.stringify({ anchor, generatedAt: new Date().toISOString(), ok: bad.length === 0, rows }, null, 2));
  if (bad.length) process.exit(1); // 机读模式同样诚实红（CI 消费退出码）
} else {
  console.log(`── 跨档口径审计（档案锚 ${anchor}）──`);
  const sym = { equal: '✓', ahead: 'ℹ', behind: '✖', missing: '✖' };
  for (const r of rows) {
    console.log(`${sym[r.state]} ${r.label.padEnd(6, '　')} ${r.date ?? '—'}  ${r.note}${r.staleReason ? `｜${r.staleReason}` : ''}`);
  }
  if (warn.length) console.log(`ℹ 先行档（正常时序）：${warn.map((r) => r.key).join('、')}`);
  if (bad.length) {
    console.log(`\n[FAIL] ${bad.length} 项口径违例（behind/missing/异常 ahead）——数据断供或字段缺失，宁红不假。`);
    process.exit(1);
  }
  console.log(`\n[PASS] 全部档口径一致（${rows.filter((r) => r.state === 'equal').length} equal / ${warn.length} 正常先行）。`);
}
