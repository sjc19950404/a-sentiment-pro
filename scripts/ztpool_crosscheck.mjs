// 情绪类数据跨源对账 · IO 编排入口（挂 daily-data-health；纯观测）
//
// 为什么独立成脚本：涨停池的"多源降级"是**假的**——主源（东财 push2ex）与"第一备源"
// （AkShare zt_pool）请求同一个 URL，实为单点，push2ex 故障则两层一起失效。能与主源
// 互相证伪的只有 `market_data.derive_zt_from_snapshot()`（自有快照自建，上游与东财无关）。
//
// 语义与 cross_check.mjs 完全一致：**纯观测，不拦 build**（观察者不是门禁，CI 红只属于
// 守卫）。PASS 静默；WARN/UNAVAILABLE → 企微 + issue 双通道。恒 exit 0。
//
// 用法：node scripts/ztpool_crosscheck.mjs [--run-id <id>] [--run-url <url>] [--python <bin>]
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ztPoolCrosscheck, breadthCrosscheck, ztCrosscheckEvent } from '../src/ztpool_crosscheck.js';
import { buildIssuePayload, createGuardIssue } from '../src/guard_notify.js';
import { pushOpsAlerts } from '../src/opsalerts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};


/**
 * 读当日盘中档（含主源池、自建池、breadth 与 legu 对账源）。
 *
 * **刻意不重新抓数**：snapshot_intraday.mjs 抓全市场快照时已顺产 ztDerived / breadthCross
 * 并落盘，这里只读档 = 零新增网络请求（全市场快照是最贵的一次请求，不该为对账抓第二遍）。
 *
 * 档非北京当日 → 返回 null：拿隔夜档对账是**假对账**（与 cross_check_volume 的
 * "交易日错位不采信"同一纪律）。
 */
function loadIntraday() {
  try {
    const d = JSON.parse(readFileSync(join(ROOT, 'data', 'intraday.json'), 'utf8'));
    const bjToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
    const ymd = String(d.tradeDate ?? '').replace(/-/g, '');
    if (ymd && ymd !== bjToday) {
      console.log(`[zt-crosscheck] 盘中档为 ${d.tradeDate}，非北京当日——跳过（隔夜档对账是假对账）`);
      return null;
    }
    return d;
  } catch (e) {
    console.error('[zt-crosscheck] 盘中档不可读：', e?.message ?? e);
    return null;
  }
}

const raw = loadIntraday();
const events = [];

if (raw) {
  // ① 涨停池：主源 东财池 vs 对账源 自建池
  const primary = raw.pools
    ? { zt_count: raw.pools.zt ?? null, zt_codes: raw.pools.zt_codes ?? [] }
    : null;
  const zt = ztPoolCrosscheck({ primary, derived: raw.ztDerived ?? null });
  console.log(`[zt-crosscheck] 涨停池：${zt.verdict} ${zt.reason ?? `主 ${zt.primaryCount} vs 自建 ${zt.derivedCount}（差 ${zt.countDiff}，差异率 ${(zt.divergeRate * 100).toFixed(1)}%）`}`);
  if (!zt.ok) events.push(ztCrosscheckEvent(zt, 'ztpool'));

  // ② 涨跌家数：快照派生（沪深A） vs legu（全A）——口径不同，只比方向与占比
  const bd = breadthCrosscheck({ snap: raw.breadth ?? null, legu: raw.breadthCross ?? null });
  console.log(`[zt-crosscheck] 涨跌家数：${bd.verdict} ${bd.reason ?? `涨占比 快照 ${bd.snapUpRatio}% vs legu ${bd.leguUpRatio}%`}`);
  if (!bd.ok) events.push(ztCrosscheckEvent(bd, 'breadth'));

  // ── 留痕（2026-10-12）：阈值标定必须有样本，而自建池依赖**当日全市场快照**——
  //   历史快照从来没存过盘，所以历史一天也补不回来。只能从今天起逐日积累，攒够
  //   3~5 个交易日再看分布定阈值（见 docs/data_discipline.md「当前待标定项」）。
  //   **PASS 也要留**——标定需要的是"正常时差多少"的分布，只留异常等于没有基准。
  try {
    const HIST = join(ROOT, 'data', 'crosscheck-history.json');
    let h = { kind: 'crosscheck-history', version: 1, days: [] };
    if (existsSync(HIST)) { try { h = JSON.parse(readFileSync(HIST, 'utf8')); } catch { /* 档损坏则重建 */ } }
    if (!Array.isArray(h.days)) h.days = [];
    const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    h.days = h.days.filter((x) => x && x.date !== day);   // 同日覆盖（三时点跑多次只留末次）
    h.days.push({
      date: day,
      zt: { verdict: zt.verdict, primary: zt.primaryCount ?? null, derived: zt.derivedCount ?? null,
        countDiff: zt.countDiff ?? null, divergeRate: zt.divergeRate ?? null },
      breadth: { verdict: bd.verdict, snapUpRatio: bd.snapUpRatio ?? null,
        leguUpRatio: bd.leguUpRatio ?? null, ratioDiffPct: bd.ratioDiffPct ?? null },
    });
    h.days = h.days.slice(-60);
    const tmp = `${HIST}.tmp`;
    writeFileSync(tmp, JSON.stringify(h, null, 2));
    renameSync(tmp, HIST);
    console.log(`[zt-crosscheck] 已留痕 ${day}（累计 ${h.days.length} 天 → data/crosscheck-history.json，供阈值标定）`);
  } catch (e) {
    console.error('[zt-crosscheck] 留痕失败（不影响对账结论）：', e?.message ?? e);
  }
} else {
  console.log('[zt-crosscheck] 未取到盘中数据——跳过（主链路故障由守卫告警，对账不重复打扰）');
}

if (events.length === 0) process.exit(0);

// 通道 1：企微
try {
  const r = await pushOpsAlerts(events);
  console.log(r.pushed > 0 ? '[zt-crosscheck] 企微已推送' : `[zt-crosscheck] 企微未推送：${r.error ?? '未配置/无事件'}`);
} catch (e) {
  console.error('[zt-crosscheck] 企微通知异常（不拖红 CI）：', e?.message ?? e);
}

// 通道 2：GitHub issue 兜底
const repo = process.env.GITHUB_REPOSITORY || arg('repo') || null;
const [owner, repoName] = repo ? repo.split('/') : [null, null];
for (const event of events) {
  try {
    const payload = buildIssuePayload(
      { status: 'WARN', reason: event.detail.split('\n')[0], event },
      {
        repo, runId: process.env.GITHUB_RUN_ID || arg('run-id'), runUrl: arg('run-url'),
        titlePrefix: '情绪数据对账', labels: ['guard', 'cross-check'],
      },
    );
    const r = await createGuardIssue(payload, { token: process.env.GITHUB_TOKEN || arg('token'), owner, repoName });
    if (r.created) console.log(`[zt-crosscheck] issue 已建 #${r.number}`);
    else console.log(`[zt-crosscheck] issue 未建：${r.error ?? (r.skipped ? 'GITHUB_TOKEN/repo 未配置' : '未知')}`);
  } catch (e) {
    console.error('[zt-crosscheck] issue fallback 异常（不拖红 CI）：', e?.message ?? e);
  }
}

process.exit(0); // 恒 0：观察者不是门禁
