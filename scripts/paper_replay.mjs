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

function runReplay(mode) {
  const exec = buildExec(mode);
  const arch = decodeArchive(JSON.parse(readFileSync('data/archive.json', 'utf8')));
  const days = (arch.all_days || []).filter((d) => d && d.trade_date);
  if (!days.length) throw new Error('档案无交易日');

  const first = days[0].trade_date;
  let acct = emptyAccount(1000000, first);
  const navSeries = [];
  let fills = 0, soldTrades = 0, winTrades = 0;
  let peak = 1000000, maxDd = 0;

  for (const day of days) {
    const date = day.trade_date;
    // ① 结算当日：盯市 + T+1 解冻 + 硬止损（与 paper_daily 同）
    const qDay = richQuotes(day);
    const r = settleDay(acct, date, qDay, { exec });
    acct = r.account;
    fills += r.fills.length;
    for (const t of r.fills) if (t.side === 'sell') { soldTrades++; if (t.realized > 0) winTrades++; }

    const s = accountStats(acct);
    navSeries.push({ date, equity: s.total });
    peak = Math.max(peak, s.total);
    maxDd = Math.max(maxDd, (peak - s.total) / peak);

    // ② 自动建仓（与 paper_daily 同源选股 + 风控）
    const emotionScore = day.emotion?.value ?? null;
    const picks = (recommendPicks(day, { topN: TOP_N, emotionScore }).picks || [])
      .filter((p) => p && p.code && qDay[String(p.code)]);
    const items = picks.slice(0, TOP_N).map((p) => ({
      code: String(p.code), pct: PER_POS_PCT, hybk: p.hybk || null, sector: p.hybk || p.theme || null,
      reason: `回放自动建仓（${p.name || p.code}）`,
    }));
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
  return { mode, days: days.length, dateRange: `${first}~${last.date}`, finalEquity: last.equity, totalRet, maxDd: maxDd * 100, fills, soldTrades, winRate };
}

function print(r) {
  console.log(`  [${r.mode}] ${r.dateRange} 共 ${r.days} 交易日`);
  console.log(`     期末净值 ${r.finalEquity.toFixed(0)} 元｜总收益 ${r.totalRet.toFixed(2)}%｜最大回撤 ${r.maxDd.toFixed(2)}%`);
  console.log(`     成交 ${r.fills} 笔｜平仓 ${r.soldTrades} 笔｜平仓胜率 ${r.winRate == null ? '—' : r.winRate.toFixed(1) + '%'}`);
}

const mode = args.get('mode');
if (args.get('compare')) {
  const a = runReplay('ideal'); print(a);
  const b = runReplay('strict'); print(b);
  console.log('\n  差异（strict − ideal）：');
  console.log(`     总收益 ${ (b.totalRet - a.totalRet).toFixed(2) } pp｜最大回撤 ${ (b.maxDd - a.maxDd).toFixed(2) } pp｜平仓胜率 ${ b.winRate!=null&&a.winRate!=null ? (b.winRate - a.winRate).toFixed(1)+' pp' : '—' }`);
  console.log(`     若 strict 下总收益仍为正 → 策略在悲观执行下仍存活，可实盘；若转负 → 需调整。`);
} else {
  print(runReplay(mode || 'ideal'));
}
