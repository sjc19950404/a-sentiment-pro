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
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { decodeArchive } from '../src/lhb_codec.js';
import {
  emptyAccount, importAccount, exportAccount, settleDay, batchSubmit, batchSell,
  accountStats, quotesFromDay, isLimitHit,
} from '../src/paper.js';
import { recommendPicks, marketTier } from '../src/picks.js';
import { reviewAccount } from '../src/paper_review.js';

const ACCOUNT_FILE = new URL('../data/paper/account.json', import.meta.url);
const REVIEW_FILE = new URL('../data/paper/review-latest.json', import.meta.url);
const TOP_N = Math.max(1, Math.floor(Number(process.env.PAPER_AUTO_TOPN) || 3));
const PER_POS_PCT = Number(process.env.PAPER_AUTO_PCT) || 0.10;
const RESPECT_REGIME = (process.env.PAPER_AUTO_RESPECT_REGIME ?? '1') !== '0';
const RESTRICTIVE_REGIME = new Set(['shift', 'ebb', 'ice']);
const r2 = (x) => (Number.isFinite(+x) ? Math.round(+x * 100) / 100 : null);
const ts = () => new Date().toTimeString().slice(0, 8);
const step = (m) => console.log(`── ${ts()} ${m} ──`);

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
  try { acct = importAccount(readFileSync(fileURLToPath(ACCOUNT_FILE), 'utf8')); }
  catch (e) { console.error(`[paper-daily] 账户读档失败，重建空账户：${e.message}`); acct = emptyAccount(1000000, date); }
} else {
  acct = emptyAccount(1000000, date);
  console.log('[paper-daily] 新建纸面账户（初始本金 100 万）');
}

// ── 3. 每日结算：盯市 + T+1 解冻 + 扫描 -8% 硬止损 ──
step(`结算 ${date}`);
const quotes = quotesFromDay(day);
acct = settleDay(acct, date, quotes);
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
  console.log(`  断板清仓 ${res.submitted.length} 笔：${broken.map((b) => b.code).join(',') || '无'}`);
} else {
  console.log('  无断板持仓');
}

// ── 5. 自动建仓：情绪档位允许新建 且 未触发 regime 盖帽 ──
step(`自动建仓（主线选股 top${TOP_N} @ ${Math.round(PER_POS_PCT * 100)}%）`);
let regimeKey = null;
try { regimeKey = JSON.parse(readFileSync('data/signals-latest.json', 'utf8'))?.dailyReport?.tag?.key || null; }
catch { console.warn('  [paper-daily] 读 signals 失败，仅按情绪档位判断'); }
const tier = marketTier(emotionScore);
const regimeBlocked = RESPECT_REGIME && regimeKey && RESTRICTIVE_REGIME.has(regimeKey);
if (!tier || !tier.allowNew) {
  console.log(`  情绪档位不允新建（${tier ? tier.label : '情绪分缺失'}）→ 跳过自动建仓`);
} else if (regimeBlocked) {
  console.log(`  regime=${regimeKey} 风控盖帽（假繁荣/退潮）→ 跳过自动建仓（与系统纪律一致）`);
} else {
  const picks = (recommendPicks(day, { topN: TOP_N, emotionScore }).picks || [])
    .filter((p) => p && p.code && quotes[String(p.code)]); // 仅选有当日行情者（否则 batchSubmit 会 NO_QUOTE 拦截）
  const items = picks.slice(0, TOP_N).map((p) => ({
    code: String(p.code), pct: PER_POS_PCT,
    reason: `自动建仓（主线选股候选 ${p.name || p.code}）`,
  }));
  if (!items.length) {
    console.log('  无合格选股（候选均缺行情或被判不推荐）');
  } else {
    const res = batchSubmit(acct, items, day, { date });
    acct = res.next;
    console.log(`  提交 ${res.submitted.length} 笔 / 拦截 ${res.blocked.length} 笔：${res.submitted.map((x) => x.code).join(',') || '无'}`);
    res.blocked.forEach((b) => console.log(`    拦截 ${b.code}：${b.reason}`));
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

function fmtByHold(bh) {
  if (!bh) return '—';
  const f = (b) => (b && b.winRate != null ? `${(b.winRate * 100).toFixed(0)}%(${b.n})` : '—');
  return `${f(bh.d1)}/${f(bh.d3)}/${f(bh.d5)}`;
}
