#!/usr/bin/env node
/**
 * 纸面交易「最后一公里」（V5.3 P2）
 * ───────────────────────────────────────────────────────────────────────────
 * 每日收盘后（选股结果产出后）自动：
 *   ① 结算当日账户：盯市 + T+1 解冻 + 扫描 -8% 硬止损（settleDay 默认开启 scanStopLoss）
 *   ② 连板断板自动清仓：昨涨停、今未涨停且收跌的持仓，清掉可卖部分
 *   ③ 自动建仓：仅当「情绪档位允许新建」且「regime 非风控盖帽（shift/ebb/ice）」时，
 *      取 recommendPicks 前 N 只（默认 3，每只按总资产 10%）经 batchSubmit 建仓
 *      （batchSubmit 自带龙虎榜前置过滤 + 单票/总仓上限等风控闸，被拦会记 blocked）
 *   ④ 落盘 data/paper/account.json，并写 data/paper/review-latest.json（1/3/5 日胜率等）
 *
 * 设计纪律：缺档/失败均容错，绝不阻塞 EOD 主流程（pi_build 中本步骤即 step || true）。
 *   账户若尚未建立（data/paper/account.json 不存在）则初始化 100 万空账户。
 *
 * 环境变量（可选覆盖）：PAPER_AUTO_TOPN（默认 3）、PAPER_AUTO_PCT（默认 0.10）、
 *   PAPER_AUTO_RESPECT_REGIME（默认 1：受 regime 盖帽约束；置 0 仅看情绪档位）。
 *
 * 命令行参数：
 *   --force-trade  忽略情绪档位 / regime 双闸，强行按 topN @ pct 建仓。
 *     仅用于「过热顶部强行追高」的反向压力测试（Stress Test），非真实交易信号；
 *     被强制的建仓会在持仓上打 stress 标，复盘段可区分。正常 EOD 请勿带此参数。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';

// 当日涨停池（可交易性过滤数据源）：ztpool_history 按日匹配 day.trade_date。
// fail-open：文件缺失/无当日条目 → 返回 null（recommendPicks 内过滤自动 no-op，零回归）。
function loadZtpoolForDay(dateStr) {
  try {
    const hist = JSON.parse(readFileSync('data/ztpool_history.json', 'utf8'));
    const key = String(dateStr == null ? '' : dateStr).replace(/\D/g, '');
    const hit = (Array.isArray(hist) ? hist : []).find((e) => e && String(e.date).replace(/\D/g, '') === key);
    return hit && Array.isArray(hit.pool) ? hit.pool : null;
  } catch { return null; }
}
import { decodeArchive } from '../src/lhb_codec.js';
import {
  emptyAccount, importAccount, exportAccount, settleDay, batchSubmit, batchSell,
  accountStats, quotesFromDay, isLimitHit, normalizeExec,
} from '../src/paper.js';
import { recommendPicks, marketTier } from '../src/picks.js';
import { reviewAccount } from '../src/paper_review.js';
import { glmBuyGuard } from '../src/glm_guard.js';
import { pushReports, buildSignalSyncReports } from '../src/ai_report_push.js';

const ACCOUNT_FILE = new URL('../data/paper/account.json', import.meta.url);
const REVIEW_FILE = new URL('../data/paper/review-latest.json', import.meta.url);
const TOP_N = Math.max(1, Math.floor(Number(process.env.PAPER_AUTO_TOPN) || 3));
const PER_POS_PCT = Number(process.env.PAPER_AUTO_PCT) || 0.10;
const RESPECT_REGIME = (process.env.PAPER_AUTO_RESPECT_REGIME ?? '1') !== '0';
const RESTRICTIVE_REGIME = new Set(['shift', 'ebb', 'ice']);
const FORCE_TRADE = process.argv.includes('--force-trade');
const r2 = (x) => (Number.isFinite(+x) ? Math.round(+x * 100) / 100 : null);
const ts = () => new Date().toTimeString().slice(0, 8);
const step = (m) => console.log(`── ${ts()} ${m} ──`);

// 实盘跟单推送（Signal Sync）：把系统算出的买卖信号，单独成条、极简推企微（复用 OPS_WEBHOOK 通道）。
//   默认开（PAPER_SIGNAL_SYNC=0 关闭）；不改动交易核心，仅在编排层收集信号后独立推送。
const SIGNAL_SYNC = process.env.PAPER_SIGNAL_SYNC !== '0';
const signalBuys = [];   // 本日系统计算的买入信号（步骤5收集）
const signalSells = [];  // 本日系统触发的卖出信号（步骤3/4收集）
const fetchWithTimeout = (ms) => (url, opts = {}) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
};

// Step 1/4 执行层现实开关（默认 ideal / 关闭，不改变线上账户既有行为）：
//   PAPER_EXEC=strict          → 启用悲观滑点(±1%) + 涨停打板概率成交（打板 30% 撤单率 + 容量门）
//   PAPER_SECTOR_LIMIT=0.3     → 启用板块暴露限制（单板块占净值 ≤30%，超出强拒买入）
//   也可一次性用 JSON：PAPER_EXEC='{"mode":"strict","sectorLimitRatio":0.3}'
const EXEC_ENV = process.env.PAPER_EXEC || '';
let EXEC_CFG = {};
try { EXEC_CFG = EXEC_ENV.trim().startsWith('{') ? JSON.parse(EXEC_ENV) : (EXEC_ENV ? { mode: EXEC_ENV } : {}); } catch { EXEC_CFG = {}; }
if (process.env.PAPER_SECTOR_LIMIT) EXEC_CFG.sectorLimitRatio = Number(process.env.PAPER_SECTOR_LIMIT) || 0;
const exec = normalizeExec(EXEC_CFG);
// 实盘跟单「建议买入价」的含滑点缓冲：strict 模式用其悲观滑点，否则用固定万五（万5）作保守挂单参考
const BUY_SLIP = exec.mode === 'strict' ? exec.slipNonLimit : 0.0005;
// 出场纪律 v1 开关（默认关闭；PAPER_EXIT=strict_v1 启用「隔日强制了结(连板)+移动止盈+硬止损-5%+亏损不过三」）
const EXIT_MODE = process.env.PAPER_EXIT || '';
if (exec.mode === 'strict' || exec.sectorLimitRatio > 0) {
  console.log(`[paper-daily] 执行层现实假设：mode=${exec.mode} 滑点±${(exec.slipNonLimit * 100).toFixed(0)}% 打板撤单${(exec.limitCancelRate * 100).toFixed(0)}% 板块暴露上限${(exec.sectorLimitRatio * 100).toFixed(0)}%`);
}

// ── 1. 读档案最新交易日 ──
let arch;
try { arch = decodeArchive(JSON.parse(readFileSync('data/archive.json', 'utf8'))); }
catch (e) { console.error(`[paper-daily] 档案读取失败：${e.message}`); process.exit(1); }
const days = (arch.all_days || []).filter((d) => d && d.trade_date);
if (!days.length) { console.error('[paper-daily] 档案无交易日'); process.exit(1); }
const day = days[days.length - 1];
const date = day.trade_date;
const emotionScore = day.emotion?.value ?? null;
console.log(`[paper-daily] 交易日 ${date}｜情绪分 ${emotionScore ?? '缺失'}`);

// ── 2. 载入 / 初始化账户 ──
let acct;
if (existsSync(fileURLToPath(ACCOUNT_FILE))) {
  try {
    const imp = importAccount(readFileSync(fileURLToPath(ACCOUNT_FILE), 'utf8'));
    if (!imp.ok) throw new Error(imp.error || '账户校验失败');
    acct = imp.account;
  }
  catch (e) { console.error(`[paper-daily] 账户读档失败，重建空账户：${e.message}`); acct = emptyAccount(1000000, date); }
} else {
  acct = emptyAccount(1000000, date);
  console.log('[paper-daily] 新建纸面账户（初始本金 100 万）');
}

// ── 3. 每日结算：盯市 + T+1 解冻 + 扫描 -8% 硬止损 ──
step(`结算 ${date}`);
const quotes = quotesFromDay(day);
const sd = settleDay(acct, date, quotes, { exec, ...(EXIT_MODE ? { exitMode: EXIT_MODE } : {}) });
acct = sd.account;
{ // 实盘跟单：收集本日系统触发的卖出信号（v1 出场纪律 + 跌停逃生 + 断板清仓）
  const escapeCodes = new Set();
  for (const f of (sd.fills || [])) {
    if (f.side === 'sell' && f.reason && /逃生/.test(f.reason)) {
      signalSells.push({ code: String(f.code), name: f.name || f.code, reason: '跌停逃生(排队成交)', urgent: true });
      escapeCodes.add(String(f.code));
    }
  }
  // 出场委托（v1 隔日了结/移动止盈/硬止损/亏损不过三 stage='exit'；legacy -8% 止损 stage='stop'）落在账户持久 logs
  for (const l of (sd.account?.logs || [])) {
    if (l.date === date && (l.stage === 'exit' || l.stage === 'stop') && l.side === 'sell'
      && l.result === 'submitted' && !escapeCodes.has(String(l.code))) {
      signalSells.push({ code: String(l.code), name: l.name || l.code, reason: l.reason || '系统触发卖出', urgent: false });
    }
  }
}
{
  const s = accountStats(acct);
  console.log(`  净值 ${r2(s.total)} 元（现金 ${r2(s.cash)}，市值 ${r2(s.marketValue)}），持仓 ${Object.keys(acct.positions || {}).length} 只`);
}

// ── 4. 连板断板自动清仓：昨涨停 + 今未涨停且收跌 → 清可卖部分 ──
step('断板清仓扫描');
const prev = days[days.length - 2];
const prevLimitUp = prev
  ? new Set((prev.hot || []).filter((h) => isLimitHit(h.change_pct, h.code, h.name)).map((h) => String(h.code)))
  : new Set();
const broken = [];
for (const [code, p] of Object.entries(acct.positions || {})) {
  if (!p || p.qty <= 0) continue;
  if (!prevLimitUp.has(String(code))) continue;
  const q = quotes[String(code)];
  if (!q || q.changePct == null) continue; // 今日无行情（不在热点/龙虎榜）→ 无法判定断板，跳过
  const stillLimit = isLimitHit(q.changePct, String(code), p.name);
  if (!stillLimit && q.changePct < 0) broken.push({ code: String(code), name: p.name || code, changePct: q.changePct });
}
if (broken.length) {
  const res = batchSell(acct, broken.map((b) => ({ code: b.code, pct: 1, reason: `连板断板自动清仓（昨涨停今收跌 ${b.changePct}%）` })), day, { date });
  acct = res.next;
  for (const o of (res.submitted || [])) signalSells.push({ code: String(o.code), name: o.name || o.code, reason: '连板断板自动清仓', urgent: false });
  console.log(`  断板清仓 ${res.submitted.length} 笔：${broken.map((b) => b.code).join(',') || '无'}`);
} else {
  console.log('  无断板持仓');
}

// ── 5. 自动建仓：情绪档位允许新建 且 未触发 regime 盖帽（--force-trade 可绕过双闸）──
step(`自动建仓（主线选股 top${TOP_N} @ ${Math.round(PER_POS_PCT * 100)}%）${FORCE_TRADE ? '  [强制测试模式]' : ''}`);
let regimeKey = null;
try { regimeKey = JSON.parse(readFileSync('data/signals-latest.json', 'utf8'))?.dailyReport?.tag?.key || null; }
catch { console.warn('  [paper-daily] 读 signals 失败，仅按情绪档位判断'); }
const tier = marketTier(emotionScore);
const regimeBlocked = RESPECT_REGIME && regimeKey && RESTRICTIVE_REGIME.has(regimeKey);
if (!tier) {
  console.log('  情绪分缺失 → 跳过自动建仓');
} else if ((!tier.allowNew || regimeBlocked) && !FORCE_TRADE) {
  if (!tier.allowNew) console.log(`  情绪档位不允新建（${tier.label}）→ 跳过自动建仓`);
  else console.log(`  regime=${regimeKey} 风控盖帽（假繁荣/退潮）→ 跳过自动建仓（与系统纪律一致）`);
} else {
  const bypassed = FORCE_TRADE && (!tier.allowNew || regimeBlocked);
  if (bypassed) {
    console.log(`  ⚠ 强制测试模式（--force-trade）：忽略熔断（情绪档=${tier.label}/regime=${regimeKey || '无'}），强行建仓——仅反向压力测试，非真实信号`);
  }
  const ztpool = loadZtpoolForDay(day.trade_date);
  console.log(`  可交易性过滤数据源：当日涨停池 ${ztpool ? ztpool.length + ' 只' : '缺失（no-op）'}`);
  const picks = (recommendPicks(day, { topN: TOP_N, emotionScore, ztpool }).picks || [])
    .filter((p) => p && p.code && quotes[String(p.code)]); // 仅选有当日行情者（否则 batchSubmit 会 NO_QUOTE 拦截）
  const items = picks.slice(0, TOP_N).map((p) => ({
    code: String(p.code), pct: PER_POS_PCT, hybk: p.hybk || null,
    sector: p.hybk || p.theme || null,
    tag: (p.isZt || (p.streak || 0) >= 2) ? 'zt' : null,   // 连板/打板标签 → 出场纪律 v1 据此隔日强制了结
    reason: (bypassed ? '【压力测试·熔断绕过】' : '') + `自动建仓（主线选股候选 ${p.name || p.code}）`,
  }));
  // 场景三 GLM 附加过滤守卫（买前三合一闸门）：方向 A 排雷黑名单 + 方向 C 妖股逻辑 + 方向 B 板块情绪。
  //   三档均为独立落盘的 side-car（军规#1：绝不改 emotion/regime），此处由代码采纳——命中即拒买。
  //   全部 fail-open：档缺失/空/degraded/asOfDate 不符 → 不拦（绝不误伤正常候选）；
  //   即便 --force-trade 压力测试也不绕过（与 regime 熔断是两回事，属真实风险过滤）。
  const blocked = [];
  const safeItems = [];
  for (const it of items) {
    const g = glmBuyGuard(it.code, { hybk: it.hybk, asOfDate: date });
    if (!g.pass) blocked.push({ code: it.code, reasons: g.reasons });
    else safeItems.push(it);
  }
  if (blocked.length) {
    console.log(`  ⛔ GLM 附加过滤拦截 ${blocked.length} 只（不建仓）：${blocked.map((b) => `${b.code}(${b.reasons.join('/')})`).join('、')}`);
  }
  if (!safeItems.length) {
    console.log('  无合格选股（候选均缺行情/不推荐或命中排雷黑名单）');
  } else {
    const res = batchSubmit(acct, safeItems, day, { date, exec });
    acct = res.next;
    if (bypassed) {
      for (const s of res.submitted) { const pos = acct.positions && acct.positions[String(s.code)]; if (pos) pos.stress = true; }
    }
    console.log(`  提交 ${res.submitted.length} 笔 / 拦截 ${res.blocked.length} 笔：${res.submitted.map((x) => x.code).join(',') || '无'}${bypassed ? '（含压力测试仓）' : ''}`);
    res.blocked.forEach((b) => console.log(`    拦截 ${b.code}：${b.reason}`));
    // 实盘跟单：收集本日买入信号（压力测试仓 stress 非真实信号，不推送）
    if (!bypassed) {
      const buyPct = new Map(safeItems.map((it) => [String(it.code), it.pct]));
      for (const o of res.submitted) {
        if (o.side !== 'buy') continue;
        signalBuys.push({ code: String(o.code), name: o.name || o.code, price: r2((o.submitPrice || 0) * (1 + BUY_SLIP)), pct: buyPct.get(String(o.code)) || PER_POS_PCT });
      }
    }
  }
}

// ── 6. 落盘账户 + 复盘 ──
atomicWriteJSON(fileURLToPath(ACCOUNT_FILE), exportAccount(acct));
const stats = accountStats(acct);
step('复盘');
const review = reviewAccount(acct, stats, { asOf: date });
const tr = review.tradeReview || {};
const out = {
  asOf: date,
  nav: r2(stats.total), cash: r2(stats.cash), marketValue: r2(stats.marketValue),
  positionCount: Object.keys(acct.positions || {}).length,
  tradeReview: {
    closedCount: tr.closedCount ?? null,
    winRate: tr.winRate ?? null,
    byHold: tr.byHold ?? null,            // 1/3/5 日持仓胜率
    plRatio: tr.plRatio ?? null,
    profitFactor: tr.profitFactor ?? null,
    maxLossStreak: tr.maxLossStreak ?? null,
  },
};
atomicWriteJSON(fileURLToPath(REVIEW_FILE), JSON.stringify(out, null, 1));
console.log(`  净值 ${out.nav} 元｜持仓 ${out.positionCount} 只｜平仓 ${out.tradeReview.closedCount} 笔`
  + `｜总胜率 ${out.tradeReview.winRate == null ? '—' : (out.tradeReview.winRate * 100).toFixed(1) + '%'}`
  + `｜1/3/5日胜率 ${fmtByHold(out.tradeReview.byHold)}`);
console.log(`  review 已写 ${fileURLToPath(REVIEW_FILE)}`);

// ── 7. 实盘跟单推送（Signal Sync）：把系统算出的买卖信号单独成条推企微 ──
//   独立于常规日报；极简每条 <100 字；复用 OPS_WEBHOOK 通道 + 内容指纹去重（同日重跑不刷屏）。
//   fail-open：未配置 webhook / 推送失败均只记日志，绝不阻断 EOD 主流程。
if (SIGNAL_SYNC && !FORCE_TRADE && (signalBuys.length || signalSells.length)) {
  step('实盘跟单推送');
  // 卖出按 code 去重（断板清仓与 v1 出场可能同票；逃生的 urgent 优先保留）
  const sellByCode = new Map();
  for (const s of signalSells) {
    const prev = sellByCode.get(s.code);
    if (!prev || (s.urgent && !prev.urgent)) sellByCode.set(s.code, s);
  }
  const sells = [...sellByCode.values()];
  const reports = buildSignalSyncReports({ date, buys: signalBuys, sells, stopLabel: EXIT_MODE === 'strict_v1' ? '-5%' : '-8%' });
  console.log(`  指令 ${reports.length} 条（买入 ${signalBuys.length} / 卖出 ${sells.length}）`);
  try {
    const stateFile = fileURLToPath(new URL('../data/paper/signal-sync-push-state.json', import.meta.url));
    const r = await Promise.race([
      pushReports(reports, { stateFile, fetchImpl: fetchWithTimeout(8000) }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('推送超时')), 9000)),
    ]);
    console.log(`  推送成功 ${r.pushed} 条 / 跳过 ${r.skipped} 条（去重命中或未配置则跳过）`);
  } catch (e) { console.error(`  [signal-sync] 推送异常（不阻断主流程）: ${e?.message || e}`); }
}

function fmtByHold(bh) {
  if (!bh) return '—';
  const f = (b) => (b && b.winRate != null ? `${(b.winRate * 100).toFixed(0)}%(${b.n})` : '—');
  return `${f(bh.d1)}/${f(bh.d3)}/${f(bh.d5)}`;
}
