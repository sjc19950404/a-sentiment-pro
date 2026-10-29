// 纸面交易「历史回放」——把 archive.json 当历史，逐日重演 paper_daily 的
// 结算 → 自动建仓 → 次日真实价撮合，用于「加悲观滑点后策略还赚不赚」的压力测试。
//
// 复用项目真实选股函数 recommendPicks（与 paper_daily 同源），不另造策略，
// 因此对比的是「同一套选股 + 不同执行假设」的差异，隔离变量。
//
// 用法：
//   node scripts/paper_replay.mjs                 # 默认 理想(ideal) 单跑
//   node scripts/paper_replay.mjs --mode strict   # 悲观执行（±1% 滑点 + 打板 30% 撤单率）
//   node scripts/paper_replay.mjs --compare       # ideal / strict 同跑并对比
//   node scripts/paper_replay.mjs --sector-limit 0.3   # 叠加板块暴露限制
//   node scripts/paper_replay.mjs --topn 3 --pct 0.10 --no-glm
//
// 说明：封单量（limitVol）在存档里无干净字段，故回放时涨停打板只走「撤单率」
// （容量门在实时行情带 limitVol 时才生效）；这与 paper_daily 线上路径一致。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeArchive } from '../src/lhb_codec.js';
import {
  emptyAccount, settleDay, batchSubmit, accountStats, quotesFromDay, normalizeExec,
} from '../src/paper.js';
import { recommendPicks } from '../src/picks.js';
import { glmBuyGuard } from '../src/glm_guard.js';
import { attributeTrades, bandOf, holdDays } from '../src/select_attrition.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--compare') args.set('compare', '1');
  else if (a === '--no-glm') args.set('noGlm', '1');
  else if (a === '--no-lhb') args.set('noLhb', '1');
  else if (a.startsWith('--mode')) args.set('mode', process.argv[++i]);
  else if (a.startsWith('--sector-limit')) args.set('sectorLimit', Number(process.argv[++i]) || 0);
  else if (a.startsWith('--topn')) args.set('topn', Number(process.argv[++i]) || 3);
  else if (a.startsWith('--pct')) args.set('pct', Number(process.argv[++i]) || 0.10);
  else if (a === '--attrition') { args.set('attrition', '1'); args.set('noGlm', '1'); args.set('noLhb', '1'); } // 归因只测「选股信号本身」，隔离 GLM/LHB 侧车门
}

const TOP_N = Math.max(1, args.get('topn') || 3);
const PER_POS_PCT = args.get('pct') || 0.10;
const RESTRICTIVE_REGIME = new Set(['shift', 'ebb', 'ice']);
const USE_GLM = !args.get('noGlm');

// 回放侧行情增强：quotesFromDay 只收 hot/lhb，但 recommendPicks 候选多来自连板池(ztpool)，
// 直接回放会被行情过滤器几乎全剔掉（成交极少，无法衡量滑点影响）。这里把 ztpool 也并入
// 行情（仅回放用，不改动引擎/线上路径），让候选能按真实收盘价定价成交。
function richQuotes(day) {
  const q = quotesFromDay(day);
  for (const z of (day.ztpool || [])) {
    if (z && z.code && z.close != null && q[z.code] == null) {
      q[z.code] = { code: z.code, name: z.name || '', price: +z.close, changePct: z.change_pct ?? null, prevClose: z.prevClose ?? null, src: 'ztpool' };
    }
  }
  return q;
}

function buildExec(mode) {
  const cfg = { mode: mode || 'ideal' };
if (args.get('sectorLimit')) cfg.sectorLimitRatio = args.get('sectorLimit');
  return normalizeExec(cfg);
}

function runReplay(mode, { collectTrades = false } = {}) {
  const exec = buildExec(mode);
  const arch = decodeArchive(JSON.parse(readFileSync('data/archive.json', 'utf8')));
  const days = (arch.all_days || []).filter((d) => d && d.trade_date);
  if (!days.length) throw new Error('档案无交易日');

  const first = days[0].trade_date;
  let acct = emptyAccount(1000000, first);
  const navSeries = [];
  let fills = 0, soldTrades = 0, winTrades = 0;
  let peak = 1000000, maxDd = 0;

  // —— 逐笔归因采集容器（仅 --attrition 时启用，不影响原有回放逻辑）——
  const trades = [];
  const openTrades = {};       // code -> { entryPrice, entryDate, sector, weakToStrong, streak, hotMoney, emotionBand, emotionScore }
  const pendingFeatures = {};   // code -> 决策日选股特征（买入成交时归因用）

  for (const day of days) {
    const date = day.trade_date;
    // ① 结算当日：盯市 + T+1 解冻 + 硬止损（与 paper_daily 同）
    const qDay = richQuotes(day);
    const r = settleDay(acct, date, qDay, { exec });
    acct = r.account;
    fills += r.fills.length;

    // 成交单 → 逐笔交易配对（买开仓 / 卖平仓）。注：单笔配对近似，不计加仓/减仓精确 FIFO。
    for (const t of r.fills) {
      if (t.side === 'buy' && t.status === 'filled') {
        const f = pendingFeatures[String(t.code)];
        if (f) openTrades[String(t.code)] = { entryPrice: t.price, ...f };
      } else if (t.side === 'sell' && t.status === 'filled') {
        const o = openTrades[String(t.code)];
        if (o && t.qty > 0) {
          const ret = t.realized / (o.entryPrice * t.qty);   // 已实现盈亏 / 买入名义额
          const win = t.realized > 0;
          trades.push({ code: String(t.code), sector: o.sector || null, entryDate: o.entryDate, exitDate: date, holdingDays: holdDays(o.entryDate, date), ret, win, weakToStrong: o.weakToStrong, streak: o.streak, hotMoney: o.hotMoney, emotionScore: o.emotionScore, emotionBand: o.emotionBand });
          soldTrades++; if (win) winTrades++;
        }
      }
    }
    if (!collectTrades) {
      for (const t of r.fills) if (t.side === 'sell') { soldTrades++; if (t.realized > 0) winTrades++; }
    }

    const s = accountStats(acct);
    navSeries.push({ date, equity: s.total });
    peak = Math.max(peak, s.total);
    maxDd = Math.max(maxDd, (peak - s.total) / peak);

    // ② 自动建仓（与 paper_daily 同源选股 + 风控）
    const emotionScore = day.emotion?.value ?? null;
    // 注：回放环境无预测模型，predictPicks 的默认 minProb(57) 会把候选全滤掉 → 0 交易。
    // 作为诊断工具，这里用 minProb:0 绕过概率门，专门衡量「选股信号本身」的质量（与 picks.test.mjs 一致）。
    const picks = (recommendPicks(day, { topN: TOP_N, emotionScore, minProb: 0 }).picks || [])
      .filter((p) => p && p.code && qDay[String(p.code)]);
    const items = picks.slice(0, TOP_N).map((p) => ({
      code: String(p.code), pct: PER_POS_PCT, hybk: p.hybk || null, sector: p.hybk || p.theme || null,
      reason: `回放自动建仓（${p.name || p.code}）`,
    }));
    // 采集决策日选股特征（买入成交时归因用）。注：回放未注入席位数据 → hotMoney 恒 false（仅供参考）
    if (collectTrades) {
      for (const p of picks.slice(0, TOP_N)) {
        // 注：回放候选由 recommendPicks 产出，字段为 streak/themes，weakToStrong 需 ztpool 涨停池才算（存档无→标记未知），hybk 实为 themes 数组。
        const sector = p.hybk || (Array.isArray(p.themes) ? p.themes[0] : null) || p.theme || null;
        pendingFeatures[String(p.code)] = {
          entryDate: date, sector,
          weakToStrong: (p.weakToStrong === true ? true : (p.weakToStrong === false ? false : null)),
          streak: p.streak || 0, hotMoney: !!p.hotMoney,
          emotionScore, emotionBand: bandOf(emotionScore),
        };
      }
    }
    const safe = [];
    for (const it of items) {
      if (USE_GLM && !glmBuyGuard(it.code, { hybk: it.hybk, asOfDate: date }).pass) continue;
      safe.push(it);
    }
    if (safe.length) acct = batchSubmit(acct, safe, day, { date, exec, applyLhbFilter: !args.get('noLhb') }).next;
  }

  const last = navSeries[navSeries.length - 1];
  const totalRet = (last.equity / 1000000 - 1) * 100;
  const winRate = soldTrades ? (winTrades / soldTrades * 100) : null;
  const res = { mode, days: days.length, dateRange: `${first}~${last.date}`, finalEquity: last.equity, totalRet, maxDd: maxDd * 100, fills, soldTrades, winRate };
  if (collectTrades) res.trades = trades;
  return res;
}

function print(r) {
  console.log(`  [${r.mode}] ${r.dateRange} 共 ${r.days} 交易日`);
  console.log(`     期末净值 ${r.finalEquity.toFixed(0)} 元｜总收益 ${r.totalRet.toFixed(2)}%｜最大回撤 ${r.maxDd.toFixed(2)}%`);
  console.log(`     成交 ${r.fills} 笔｜平仓 ${r.soldTrades} 笔｜平仓胜率 ${r.winRate == null ? '—' : r.winRate.toFixed(1) + '%'}`);
}

// 选股胜率复盘 · 逐笔归因报告（2026-10-30 主线）：把亏损拆到因子切片，找出期望为负的伪信号。
const fmtPct = (x) => (x == null ? '—' : x.toFixed(1) + '%');
const fmtPF = (x) => (x == null ? '—' : x === Infinity ? '∞' : x.toFixed(2));
function printSlice(title, arr, topN) {
  console.log(`\n  ${title}`);
  const rows = topN ? arr.slice(0, topN) : arr;
  for (const g of rows) {
    if (!g || g.n == null) continue;
    const name = String(g.key).padEnd(16);
    console.log(`    ${name} n=${String(g.n).padStart(4)}  胜率 ${fmtPct(g.winRate).padStart(6)}  均收益 ${fmtPct(g.avgRet).padStart(7)}  盈亏比 ${fmtPF(g.profitFactor).padStart(6)}  期望 ${fmtPct(g.expectancy).padStart(7)}`);
  }
}
function reportAttrition(trades) {
  const a = attributeTrades(trades);
  const o = a.overall;
  console.log(`\n=== 选股胜率复盘 · 逐笔归因（共 ${trades.length} 笔平仓）===`);
  if (o) console.log(`  整体：胜率 ${fmtPct(o.winRate)}  均收益 ${fmtPct(o.avgRet)}  均盈 ${fmtPct(o.avgWin)}  均亏 ${fmtPct(o.avgLoss)}  盈亏比 ${fmtPF(o.profitFactor)}  单笔期望 ${fmtPct(o.expectancy)}`);
  printSlice('按情绪档：', a.byEmotionBand);
  printSlice('按弱转强：', a.byWeakToStrong);
  printSlice('按连板数：', a.byStreak);
  printSlice('按游资净买（回放未注入席位→仅供参考）：', a.byHotMoney);
  printSlice('按板块（Top12）：', a.bySector, 12);
  console.log('\n  诊断：盈亏比<1 的切片 = 期望为负的伪信号；盈亏比>1 且 n 足够 = 真有效因子。');
}

const mode = args.get('mode');
if (args.get('attrition')) {
  const r = runReplay(mode || 'ideal', { collectTrades: true });
  print(r);
  reportAttrition(r.trades);
} else if (args.get('compare')) {
  const a = runReplay('ideal'); print(a);
  const b = runReplay('strict'); print(b);
  console.log('\n  差异（strict − ideal）：');
  console.log(`     总收益 ${ (b.totalRet - a.totalRet).toFixed(2) } pp｜最大回撤 ${ (b.maxDd - a.maxDd).toFixed(2) } pp｜平仓胜率 ${ b.winRate!=null&&a.winRate!=null ? (b.winRate - a.winRate).toFixed(1)+' pp' : '—' }`);
  console.log(`     若 strict 下总收益仍为正 → 策略在悲观执行下仍存活，可实盘；若转负 → 需调整。`);
} else {
  print(runReplay(mode || 'ideal'));
}
