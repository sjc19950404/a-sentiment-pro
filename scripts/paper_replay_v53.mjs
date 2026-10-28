// V5.3 回测校验：对比「无补丁（v5.2）」与「有补丁（V5.3 极寒分化惩罚 + 主线降权过滤）」
//   在过去 N 个交易日里，系统会被多少次「假回暖 / 假主线」骗进去接盘亏损，以及补丁能让净值曲线少回撤几点。
//
// 方法：在同一循环里并行维护两套纸面账户（基线 / 补丁），共用同一套选股 recommendPicks（与 paper_daily 同源）、
//   同一执行假设（normalizeExec）、同一 GLM 守卫——唯一变量是 V5.3 补丁是否开启，隔离干净。
//   基线调用 recommendPicks 不带 isClusteringBubble（等同线上未接补丁）；补丁版带上
//   isClusteringBubble + mainLine + 扣分情绪分（effEmotionScore），仅对「极寒分化日」生效，其余交易日两套完全一致。
//
// 用法：
//   node scripts/paper_replay_v53.mjs                 # 默认末 250 日 · ideal 执行 · 开 GLM
//   node scripts/paper_replay_v53.mjs --days 250 --mode strict
//   node scripts/paper_replay_v53.mjs --no-glm --no-lhb --topn 3 --pct 0.10
//
// 口径说明（与 src/mainline_guard.js 同源，不重造）：
//   · 极寒分化（假回暖）= 上涨家数 < 1500 且 红盘行业占比 < 0.10（day.summary.up_count + day.industry）
//   · 主线净额 longHuNet = day.summary.main_theme.main_yi（亿）×10000（万）；缺则回退重算
//   · 补丁三：极寒分化日仅保留「属主线 且 isValidMain 且 longHuNet>0」的标的，其余剔除
import { readFileSync } from 'node:fs';
import { decodeArchive } from '../src/lhb_codec.js';
import {
  emptyAccount, settleDay, batchSubmit, accountStats, quotesFromDay, normalizeExec,
} from '../src/paper.js';
import { recommendPicks } from '../src/picks.js';
import { glmBuyGuard } from '../src/glm_guard.js';
import {
  detectClusteringBubble, computeRedIndustryRatio, buildMainLineInput, selectMainLine, penaltyApplies,
} from '../src/mainline_guard.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--no-glm') args.set('noGlm', '1');
  else if (a === '--no-lhb') args.set('noLhb', '1');
  else if (a.startsWith('--mode')) args.set('mode', process.argv[++i]);
  else if (a.startsWith('--days')) args.set('days', Number(process.argv[++i]) || 250);
  else if (a.startsWith('--topn')) args.set('topn', Number(process.argv[++i]) || 3);
  else if (a.startsWith('--pct')) args.set('pct', Number(process.argv[++i]) || 0.10);
}
const TOP_N = Math.max(1, args.get('topn') || 3);
const PER_POS_PCT = args.get('pct') || 0.10;
const USE_GLM = !args.get('noGlm');
const N_DAYS = Math.max(1, Math.min(args.get('days') || 250, 2000));

// 回放侧行情增强：把 ztpool 并入行情，让候选能按真实收盘价定价成交（仅回放用，不改动引擎/线上路径）。
function richQuotes(day) {
  const q = quotesFromDay(day);
  for (const z of (day.ztpool || [])) {
    if (z && z.code && z.close != null && q[z.code] == null) {
      q[z.code] = { code: z.code, name: z.name || '', price: +z.close, changePct: z.change_pct ?? null, prevClose: z.prevClose ?? null, src: 'ztpool' };
    }
  }
  return q;
}

// 当日极寒分化判定 + 主线对象 + 扣分情绪分（V5.3 补丁的计算入口，与 paper_daily.mjs 同源）。
//   收紧调参·2026-10-28：仅当「原 regime 已是 recover/climax」且触发极寒分化才扣分（penaltyApplies 闸门）。
//   注：archive 历史日不存 regime.key（仅当日 signals-latest 有），故历史回放里 regimeKey 为 null → 不触发扣分；
//       闸门逻辑仍接线一致，仅温和补丁三（保留非主线且净买为正的强势票）在此产生差异。
function v53Context(day) {
  const upCount = Number.isFinite(day?.summary?.up_count) ? day.summary.up_count : null;
  const redIndustryRatio = computeRedIndustryRatio(day?.industry);
  const { isClusteringBubble, penalty } = detectClusteringBubble({ upCount, redIndustryRatio });
  const mainLineInput = buildMainLineInput(day, day?.summary?.main_theme);
  const mainLine = selectMainLine(mainLineInput ? [mainLineInput] : []);
  const emotionScore = day.emotion?.value ?? null;
  const regimeKey = day?.regime?.key ?? null;
  const applyPenalty = penaltyApplies(isClusteringBubble, regimeKey);
  const effEmotionScore = emotionScore != null ? emotionScore - (applyPenalty ? penalty : 0) : emotionScore;
  return { isClusteringBubble, penalty, mainLine, emotionScore, effEmotionScore, applyPenalty };
}

function buildExec(mode) {
  return normalizeExec({ mode: mode || 'ideal' });
}

// 跑两套账户（基线 / 补丁）并行回放，返回对比结果。
function runCompare(mode) {
  const exec = buildExec(mode);
  const arch = decodeArchive(JSON.parse(readFileSync('data/archive.json', 'utf8')));
  let days = (arch.all_days || []).filter((d) => d && d.trade_date);
  days = days.slice(-N_DAYS);
  if (!days.length) throw new Error('档案无交易日');

  const first = days[0].trade_date;
  let acctBase = emptyAccount(1000000, first);
  let acctPatch = emptyAccount(1000000, first);

  const navBase = [], navPatch = [];
  let peakB = 1000000, peakP = 1000000, maxDdB = 0, maxDdP = 0;
  let fillsB = 0, soldB = 0, winB = 0, fillsP = 0, soldP = 0, winP = 0;

  // 气泡日接盘亏损追踪：记录每个 code 的建仓日是否处于极寒分化；结算卖出亏损时若建仓日属气泡 → 计入被骗亏损。
  const openBubbleBase = new Map(); // code -> {date}
  const openBubblePatch = new Map();
  let bubbleDays = 0;
  const bubbleStat = {
    baseOpenDays: 0, baseLossDays: 0, baseLossTrades: 0, baseLossAmount: 0,
    patchOpenDays: 0, patchLossDays: 0, patchLossTrades: 0, patchLossAmount: 0,
  };
  // 每个气泡日开盘后，记录该日基线/补丁是否开了仓、以及当日基线开仓涉及的 code（用于后续亏损归因）
  // GLM 守卫：与 paper_daily 线上路径同源；按当日 date 校验，剔除黑名单/板块利空等。
  //   两套账户（基线/补丁）用同一守卫，保证 GLM 不是对比变量，只隔离 V5.3 补丁效果。
  const glmFilterWithDate = (picks, date) => {
    const items = picks.slice(0, TOP_N).map((p) => ({
      code: String(p.code), pct: PER_POS_PCT, hybk: p.hybk || null, sector: p.hybk || p.theme || null,
      reason: `回放自动建仓（${p.name || p.code}）`,
    }));
    const safe = [];
    for (const it of items) {
      if (USE_GLM && !glmBuyGuard(it.code, { hybk: it.hybk, asOfDate: date }).pass) continue;
      safe.push(it);
    }
    return safe;
  };

  for (const day of days) {
    const date = day.trade_date;
    const qDay = richQuotes(day);
    const ctx = v53Context(day);
    if (ctx.isClusteringBubble) bubbleDays++;

    // ① 结算当日（T+1 撮合），两套同时
    const rsB = settleDay(acctBase, date, qDay, { exec });
    acctBase = rsB.account;
    const rsP = settleDay(acctPatch, date, qDay, { exec });
    acctPatch = rsP.account;

    // 结算卖出亏损归因（气泡日建仓 → 被骗亏损）
    for (const f of rsB.fills) {
      if (f.side === 'sell' && Number.isFinite(f.realized) && f.realized < 0) {
        const meta = openBubbleBase.get(f.code);
        if (meta) {
          bubbleStat.baseLossTrades++;
          bubbleStat.baseLossAmount += -f.realized;
          if (!meta.counted) { meta.counted = true; bubbleStat.baseLossDays++; }
        }
      }
    }
    for (const f of rsP.fills) {
      if (f.side === 'sell' && Number.isFinite(f.realized) && f.realized < 0) {
        const meta = openBubblePatch.get(f.code);
        if (meta) {
          bubbleStat.patchLossTrades++;
          bubbleStat.patchLossAmount += -f.realized;
          if (!meta.counted) { meta.counted = true; bubbleStat.patchLossDays++; }
        }
      }
    }
    fillsB += rsB.fills.length; fillsP += rsP.fills.length;
    for (const t of rsB.fills) if (t.side === 'sell') { soldB++; if (t.realized > 0) winB++; }
    for (const t of rsP.fills) if (t.side === 'sell') { soldP++; if (t.realized > 0) winP++; }

    const sB = accountStats(acctBase), sP = accountStats(acctPatch);
    navBase.push({ date, equity: sB.total });
    navPatch.push({ date, equity: sP.total });
    peakB = Math.max(peakB, sB.total); peakP = Math.max(peakP, sP.total);
    maxDdB = Math.max(maxDdB, (peakB - sB.total) / peakB);
    maxDdP = Math.max(maxDdP, (peakP - sP.total) / peakP);

    // ② 自动建仓：基线（无补丁）vs 补丁版（V5.3）
    const basePicks = (recommendPicks(day, { topN: TOP_N, emotionScore: ctx.emotionScore }).picks || [])
      .filter((p) => p && p.code && qDay[String(p.code)]);
    const patchPicks = (recommendPicks(day, { topN: TOP_N, emotionScore: ctx.effEmotionScore, isClusteringBubble: ctx.isClusteringBubble, mainLine: ctx.mainLine }).picks || [])
      .filter((p) => p && p.code && qDay[String(p.code)]);

    const baseSafe = glmFilterWithDate(basePicks, date);
    const patchSafe = glmFilterWithDate(patchPicks, date);

    if (ctx.isClusteringBubble) {
      if (baseSafe.length) bubbleStat.baseOpenDays++;
      if (patchSafe.length) bubbleStat.patchOpenDays++;
    }

    if (baseSafe.length) {
      acctBase = batchSubmit(acctBase, baseSafe, day, { date, exec, applyLhbFilter: !args.get('noLhb') }).next;
      if (ctx.isClusteringBubble) for (const code of baseSafe.map((x) => x.code)) if (!openBubbleBase.has(code)) openBubbleBase.set(code, { date });
    }
    if (patchSafe.length) {
      acctPatch = batchSubmit(acctPatch, patchSafe, day, { date, exec, applyLhbFilter: !args.get('noLhb') }).next;
      if (ctx.isClusteringBubble) for (const code of patchSafe.map((x) => x.code)) if (!openBubblePatch.has(code)) openBubblePatch.set(code, { date });
    }
  }

  const lastB = navBase[navBase.length - 1], lastP = navPatch[navPatch.length - 1];
  const retB = (lastB.equity / 1000000 - 1) * 100, retP = (lastP.equity / 1000000 - 1) * 100;
  const winRateB = soldB ? (winB / soldB * 100) : null, winRateP = soldP ? (winP / soldP * 100) : null;
  return {
    mode, days: days.length, dateRange: `${first}~${lastB.date}`,
    bubbleDays, bubbleStat,
    base: { finalEquity: lastB.equity, totalRet: retB, maxDd: maxDdB * 100, fills: fillsB, soldTrades: soldB, winRate: winRateB },
    patch: { finalEquity: lastP.equity, totalRet: retP, maxDd: maxDdP * 100, fills: fillsP, soldTrades: soldP, winRate: winRateP },
  };
}

function pct(x) { return x == null ? '—' : `${x.toFixed(2)}%`; }
function money(x) { return x == null ? '—' : `${x.toFixed(0)} 元`; }

const mode = args.get('mode') || 'ideal';
const r = runCompare(mode);
console.log(`\n===== V5.3 回测校验（末 ${r.days} 交易日 · 执行假设 ${r.mode} · GLM=${USE_GLM ? '开' : '关'} · TOP_N=${TOP_N} · 仓位${PER_POS_PCT}）=====`);
console.log(`区间：${r.dateRange}`);
console.log(`\n— 极寒分化（假回暖）识别 —`);
console.log(`  区间内极寒分化日：${r.bubbleDays} 天`);
console.log(`  「无补丁」基线：在这 ${r.bubbleDays} 天里开了仓的有 ${r.bubbleStat.baseOpenDays} 天；其中接盘后亏损的有 ${r.bubbleStat.baseLossDays} 天（${r.bubbleStat.baseLossTrades} 笔亏损单）`);
console.log(`    基线因假回暖被骗接盘的累计亏损：${money(r.bubbleStat.baseLossAmount)}`);
console.log(`  「有补丁」V5.3：在这 ${r.bubbleDays} 天里开了仓的仅 ${r.bubbleStat.patchOpenDays} 天；接盘后亏损 ${r.bubbleStat.patchLossDays} 天（${r.bubbleStat.patchLossTrades} 笔）`);
console.log(`    V5.3 因假回暖被骗接盘的累计亏损：${money(r.bubbleStat.patchLossAmount)}`);
const avoidedLoss = r.bubbleStat.baseLossAmount - r.bubbleStat.patchLossAmount;
console.log(`  ⇒ 补丁帮系统避免的假回暖接盘亏损：${money(avoidedLoss)}（少被骗 ${Math.max(0, r.bubbleStat.baseLossDays - r.bubbleStat.patchLossDays)} 天）`);

console.log(`\n— 净值 / 回撤对比 —`);
console.log(`  [无补丁 基线] 期末净值 ${money(r.base.finalEquity)}｜总收益 ${pct(r.base.totalRet)}｜最大回撤 ${pct(r.base.maxDd)}｜平仓胜率 ${pct(r.base.winRate)}`);
console.log(`  [V5.3  补丁] 期末净值 ${money(r.patch.finalEquity)}｜总收益 ${pct(r.patch.totalRet)}｜最大回撤 ${pct(r.patch.maxDd)}｜平仓胜率 ${pct(r.patch.winRate)}`);
console.log(`\n  ⇒ 最大回撤减少：${pct(r.base.maxDd - r.patch.maxDd)} pp（绝对值 ${money(r.base.finalEquity - r.patch.finalEquity)} 净值差异）`);
console.log(`  ⇒ 总收益差异：${pct(r.patch.totalRet - r.base.totalRet)} pp`);
console.log(`  ⇒ 平仓胜率差异：${r.patch.winRate != null && r.base.winRate != null ? (r.patch.winRate - r.base.winRate).toFixed(2) + ' pp' : '—'}`);
console.log('\n说明：仅极寒分化日两套账户策略分叉，其余交易日完全一致；回测口径与 paper_replay.mjs 同源（真实选股 + 悲观/理想执行），不另造策略。');
