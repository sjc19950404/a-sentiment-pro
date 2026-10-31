// 数据源健康度看板（2026-10-11）· 滚动统计 + 连续失败告警
//
// 为什么要有它：本项目的告警都是"数据已经不对了"才响（口径审计、缺天检测、对账），
// 而对"**某个源正在慢慢烂掉**"（今天降级一次、明天降级一次、后天彻底挂）没有可见性——
// 2026-08-14~09-03 那 14 天 EM 池整体失败，事前没有任何信号。
// 本脚本把每天每个源的状态累积成滚动台账：成功率、连续失败次数、最近成功时间。
//
// 语义：**观察者 + 记账**。看板恒输出；连续失败 ≥ STREAK_ALARM 才告警（企微 + issue）。
// 不拦 build（与对账同一纪律）。
//
// 用法：node scripts/source_health.mjs [--json] [--no-write]
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIssuePayload, createGuardIssue } from '../src/guard_notify.js';
import { pushOpsAlerts } from '../src/opsalerts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const NO_WRITE = argv.includes('--no-write');
const IN = join(ROOT, 'data', 'intraday.json');
const OUT = join(ROOT, 'data', 'source-health.json');

const STREAK_ALARM = 3;   // 连续失败几次才告警（1~2 次多半是网络抖动，第 3 次才像真故障）

/** 源清单：id 与 market_data.py 的降级链/log_degrade 文案对齐。 */
// 2026-10-15 重构：盘中快照数据层迁回 Node.js 直连东财（src/intraday_node.mjs）。
// 原三源（QuantDash universe / AkShare spot_em / AkShare fund_flow）连续失败已废弃——
// 见 src/intraday_node.mjs 文件头说明。下面探针改为检查 Node 直连产出。
const SOURCES = [
  // 全市场快照：替代 QuantDash universe 主路 + AkShare spot_em 兜底（二者合并为同一 Node 源）
  { id: 'node-universe', label: '全市场快照·Node东财直连(替代QuantDash主路)', probe: (d) => d.dataHealth?.snapshotSource === 'node-eastmoney' && Array.isArray(d.hot?.rows) && d.hot.rows.length > 0 },
  { id: 'node-spot', label: '实时行情·Node东财直连(替代AkShare兜底)', probe: (d) => d.dataHealth?.snapshotSource === 'node-eastmoney' && Array.isArray(d.hot?.rows) && d.hot.rows.length > 0 },
  // 主力净流入榜：替代 AkShare fund_flow_rank（东财 clist 按 f62 降序，复用 sources.fetchScreenerTopMainNet）
  { id: 'node-main-net', label: '主力净流入榜·Node东财直连(替代AkShare fund_flow)', probe: (d) => d.screener != null },
  // 涨跌停池：原 ztpool 探针沿用，Node 直连 push2ex（复用 sources.fetchPools）
  { id: 'node-pools', label: '涨跌停池·Node东财直连(push2ex)', probe: (d) => d.pools != null },
  // 腾讯 gtimg 兜底（物理独立备用）：主源东财降级时接管全市场快照报价；常态与 node-* 同绿，
  // 仅当「东财挂 且 gtimg 也挂」才转红——避免常态 idle 误报警（gtimg 仅在被启用时做真实连通性校验）。
  { id: 'node-gtimg-backup', label: '全市场快照·腾讯gtimg直连兜底(物理独立备用)', probe: (d) => { const s = d.dataHealth?.snapshotSource; if (s === 'node-gtimg-backup') return Array.isArray(d.hot?.rows) && d.hot.rows.length > 0; return true; } },
];

const log = (...a) => { if (!AS_JSON) console.log(...a); };

if (!existsSync(IN)) {
  log('[source-health] 无盘中档——跳过（未抓数，不做无源之谈）');
  if (AS_JSON) console.log(JSON.stringify({ ok: true, skipped: 'no-intraday' }));
  process.exit(0);
}

let d = null;
try { d = JSON.parse(readFileSync(IN, 'utf8')); } catch { d = null; }
if (!d) { log('[source-health] 盘中档不可读——跳过'); process.exit(0); }

const bjToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const ymd = String(d.tradeDate ?? '').replace(/-/g, '');
if (ymd && ymd !== bjToday.replace(/-/g, '')) {
  log(`[source-health] 盘中档为 ${d.tradeDate}，非北京当日 ${bjToday}——跳过（隔夜档不进台账，否则连续失败会误累加）`);
  if (AS_JSON) console.log(JSON.stringify({ ok: true, skipped: 'stale-intraday', tradeDate: d.tradeDate }));
  process.exit(0);
}

// ── 当日各源状态：probe 命中 = ok；未命中 = fail（含"根本没走到"，如降级跳过）──
const assessed = SOURCES.map((s) => {
  let ok = false;
  try { ok = !!s.probe(d); } catch { ok = false; }
  return { id: s.id, label: s.label, state: ok ? 'ok' : 'fail' };
});

// ── 滚动台账 ──────────────────────────────────────────────────────────────
let hist = {};
if (existsSync(OUT)) {
  try { hist = JSON.parse(readFileSync(OUT, 'utf8')).sources || {}; } catch { hist = {}; }
}
const day = bjToday;
const rows = assessed.map((s) => {
  const h = hist[s.id] || { ok: 0, fail: 0, streak: 0, lastOk: null, lastFail: null, lastDay: null };
  // 同一天多次跑（tick 网格 / 三时点）只记一次：lastDay === 今天则覆盖当日结论，不重复计数。
  const sameDay = h.lastDay === day;
  if (s.state === 'ok') {
    h.ok = (h.ok || 0) + (sameDay ? 0 : 1);
    h.streak = 0;
    h.lastOk = day;
  } else {
    h.fail = (h.fail || 0) + (sameDay ? 0 : 1);
    h.streak = sameDay ? (h.streak || 0) : (h.streak || 0) + 1;
    h.lastFail = day;
  }
  h.lastDay = day;
  const total = (h.ok || 0) + (h.fail || 0);
  hist[s.id] = h;
  return {
    id: s.id, label: s.label, state: s.state,
    okRate: total ? +((h.ok || 0) / total * 100).toFixed(1) : null,
    streak: h.streak || 0, lastOk: h.lastOk ?? null, lastFail: h.lastFail ?? null,
  };
});

if (!NO_WRITE) {
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, JSON.stringify({ kind: 'source-health', version: 1, updatedAt: new Date().toISOString(), sources: hist }, null, 2));
  renameSync(tmp, OUT);
}

log(`[source-health] ${day} 源健康度（滚动台账 ${OUT}）`);
for (const r of rows) {
  const mark = r.state === 'ok' ? '✓' : (r.streak >= STREAK_ALARM ? '✗✗' : '✗');
  log(`  ${mark} ${r.label.padEnd(22, '　')} ${r.state === 'ok' ? '正常' : `失败（连续 ${r.streak} 次）`}`
    + `${r.okRate != null ? `  成功率 ${r.okRate}%` : ''}${r.lastOk ? `  最近成功 ${r.lastOk}` : ''}`);
}

const alarm = rows.filter((r) => r.streak >= STREAK_ALARM);
if (AS_JSON) console.log(JSON.stringify({ ok: alarm.length === 0, day, rows, alarm }, null, 2));

// Actions Job summary（不依赖前端也能看）
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    const lines = ['## 数据源健康度', '', '| 源 | 当日 | 连续失败 | 成功率 | 最近成功 |', '|---|---|---|---|---|'];
    for (const r of rows) {
      lines.push(`| ${r.label} | ${r.state === 'ok' ? '✓' : '✗'} | ${r.streak} | ${r.okRate ?? '—'}% | ${r.lastOk ?? '—'} |`);
    }
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
  } catch { /* summary 写失败不影响主流程 */ }
}

if (alarm.length === 0) process.exit(0);

// 连续失败告警：企微 + issue
const event = {
  at: new Date().toISOString(), severity: 'error', kind: 'source-health', source: 'health',
  detail: `数据源连续失败 ≥ ${STREAK_ALARM} 次：\n${alarm.map((r) => `· ${r.label}（连续 ${r.streak} 次，成功率 ${r.okRate ?? '—'}%，最近成功 ${r.lastOk ?? '从未'}）`).join('\n')}`,
};
try {
  const r = await pushOpsAlerts([event]);
  log(r.pushed > 0 ? '[source-health] 企微已推送' : `[source-health] 企微未推送：${r.error ?? '未配置'}`);
} catch (e) { console.error('[source-health] 企微异常（不拖红 CI）：', e?.message ?? e); }

const repo = process.env.GITHUB_REPOSITORY || null;
const [owner, repoName] = repo ? repo.split('/') : [null, null];
try {
  const payload = buildIssuePayload({ status: 'ERROR', reason: event.detail.split('\n')[0], event }, {
    repo, runId: process.env.GITHUB_RUN_ID || null, runUrl: null,
    titlePrefix: '数据源连续失败', labels: ['guard', 'source-health'],
  });
  const r = await createGuardIssue(payload, { token: process.env.GITHUB_TOKEN || null, owner, repoName });
  if (r.created) log(`[source-health] issue 已建 #${r.number}`);
} catch (e) { console.error('[source-health] issue 异常（不拖红 CI）：', e?.message ?? e); }

process.exit(0); // 恒 0：观察者不是门禁
