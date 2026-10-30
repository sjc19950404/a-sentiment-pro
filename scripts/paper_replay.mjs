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
import { fileURLToPath } from 'node:url';
import { decodeArchive } from '../src/lhb_codec.js';
import {
  emptyAccount, settleDay, batchSubmit, accountStats, quotesFromDay, normalizeExec,
} from '../src/paper.js';
import { recommendPicks } from '../src/picks.js';
import { glmBuyGuard } from '../src/glm_guard.js';
import { attributeTrades, bandOf, holdDays } from '../src/select_attrition.js';
import { readFileSync, writeFileSync } from 'node:fs';
import config from '../src/config.js';
import SHARED from '../src/backtest_params.js';
import { getKline } from '../src/kline.js';
import { recommendPicksV2, buildKlineCache, buildIndexCache, klineQuoteOn } from '../src/picks_v2.js';

function loadSeatsHistory() {
  try { return JSON.parse(readFileSync('data/seats_history.json','utf8')); } catch { return {}; }
}

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
  else if (a.startsWith('--stop-override')) { const v = a.split('=')[1]; args.set('stopOverride', v || 'legacy'); }
  else if (a.startsWith('--pool-mix')) { const v = a.split('=')[1]; args.set('poolMix', v || 'legacy'); }
  else if (a.startsWith('--fb-boost')) { const v = a.split('=')[1]; args.set('fbBoost', v || '1'); }
  else if (a.startsWith('--dump-trade-picks')) args.set('dumpTradePicks', '1');
  else if (a === '--base') args.set('base', process.argv[++i] || 'legacy');
  else if (a.startsWith('--base=')) args.set('base', a.split('=')[1] || 'legacy');
  else if (a === '--limit-days') args.set('limitDays', Number(process.argv[++i]) || 0);
  else if (a.startsWith('--limit-days=')) args.set('limitDays', Number(a.split('=')[1]) || 0);
}

// 分级止损对照开关：streak-tier=开启连板分级止损；legacy=强制关闭（与旧规则一致，作对照组）。
// 默认（未指定）按生产口径（config.streaks.streakTier=false → 全局 -8%），保持历史回放不变。
function resolveStops() {
  const base = config.params.live.stops || {};
  const ov = args.get('stopOverride');
  if (ov === 'streak-tier') return { ...base, streakTier: true };
  if (ov === 'legacy') return { ...base, streakTier: false };
  return { ...base, streakTier: false };
}

// 方向2对照开关：firstboard[:N]=topN 内预留 N 个首板名额（N 默认 1）；legacy=不干预（作对照组）。
function resolvePoolMix() {
  const v = args.get('poolMix') || 'legacy';
  if (v === 'legacy') return 0;
  const m = v.match(/^firstboard(?::(\d+))?$/);
  if (m) return m[1] ? Math.max(0, +m[1]) : 1;
  return 0;
}

// 方向2·首板提权系数（质量竞争式）：>1 时对首板概率分乘系数，让其凭质量跨过最弱连板；默认 1（不提权）。
function resolveFbBoost() {
  const v = args.get('fbBoost');
  const n = v != null ? +v : 1;
  return Number.isFinite(n) && n > 1 ? n : 1;
}

const TOP_N = Math.max(1, args.get('topn') ?? SHARED.TOP_N);
const PER_POS_PCT = args.get('pct') ?? SHARED.PER_POS_PCT;
const RECOVERY_WINDOW = SHARED.RECOVERY_WINDOW;   // 假摔判定窗口：硬止损出场后 N 个交易日是否回补至出场价上方
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

// v2(趋势跟随) 行情预加载：仅回放 --base v2 时调用
async function loadKlineCache() {
  const uni = JSON.parse(readFileSync('data/paper_universe.json', 'utf8'));
  const active = (uni.symbols ? Object.values(uni.symbols) : []).filter((x) => x.active && x.tradable && !x.st);
  const { cache, ok, skip } = await buildKlineCache(active.map((x) => x.code));
  for (const x of active) if (cache.has(x.code)) cache.get(x.code).name = x.name;
  console.error('[kline preload] active=' + active.length + ' ok=' + ok + ' skip=' + skip);
  return cache;
}
async function loadHs300() {
  try { const kl = await buildIndexCache('sh000300'); console.error('[kline preload] hs300 ok'); return kl; }
  catch (e) { console.error('hs300 fail', e.message); return null; }
}

function buildExec(mode) {
  const cfg = { mode: mode || 'ideal' };
if (args.get('sectorLimit')) cfg.sectorLimitRatio = args.get('sectorLimit');
  return normalizeExec(cfg);
}

async function runReplay(mode, { collectTrades = false } = {}) {
  const exec = buildExec(mode);
  const arch = decodeArchive(JSON.parse(readFileSync('data/archive.json', 'utf8')));
  const days = (arch.all_days || []).filter((d) => d && d.trade_date);
  if (!days.length) throw new Error('档案无交易日');

  const base = args.get('base') || 'legacy';
  const limitDays = args.get('limitDays') ? Math.max(0, Math.min(+args.get('limitDays'), days.length)) : days.length;
  const daysToRun = limitDays < days.length ? days.slice(0, limitDays) : days;
  let klineCache = null, hsSeries = null;
  if (base === 'v2') { klineCache = await loadKlineCache(); hsSeries = await loadHs300(); }

  const first = days[0].trade_date;
  const seatsHistory = loadSeatsHistory();
  let acct = emptyAccount(1000000, first);
  const navSeries = [];
  let fills = 0, soldTrades = 0, winTrades = 0;
  let peak = 1000000, maxDd = 0;

  // —— 逐笔归因采集容器（仅 --attrition 时启用，不影响原有回放逻辑）——
  const trades = [];
  const openTrades = {};       // code -> { entryPrice, entryDate, sector, weakToStrong, streak, hotMoney, emotionBand, emotionScore }
  const pendingFeatures = {};   // code -> 决策日选股特征（买入成交时归因用）

  for (const day of daysToRun) {
    const date = day.trade_date;
    // ① 结算当日：盯市 + T+1 解冻 + 硬止损（与 paper_daily 同）
    const qDay = richQuotes(day);
    const r = settleDay(acct, date, qDay, { exec, stops: resolveStops() });
    acct = r.account;
    fills += r.fills.length;
    if (!global.__bf) global.__bf = 0;
    for (const t of r.fills) if (t.side === 'buy' && t.status === 'filled') global.__bf++;

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
          trades.push({ code: String(t.code), sector: o.sector || null, entryDate: o.entryDate, exitDate: date, exitPrice: t.price, holdingDays: holdDays(o.entryDate, date), ret, win, exitReason: t.reason || null, weakToStrong: o.weakToStrong, streak: o.streak, hotMoney: o.hotMoney, emotionScore: o.emotionScore, emotionBand: o.emotionBand });
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
    let picks;
    let items;
    let applyLhbFilterEff = !args.get('noLhb');
    if (base === 'v2') {
      applyLhbFilterEff = false;
      picks = recommendPicksV2(day, { tradeDate: date, klineCache, hs300: hsSeries, topN: TOP_N });
      // 为持仓中 + 本日选中票补行情（T 日 close 撮合，与 v1 口径一致）
      const need = new Set([...Object.keys(acct.openTrades || {}), ...picks.map((p) => p.code)]);
      for (const code of need) {
        const qv = klineQuoteOn(klineCache.get(code), date);
        if (qv) qDay[code] = { code, ...qv };
      }
      items = picks.slice(0, TOP_N).map((p) => ({
        code: String(p.code), pct: PER_POS_PCT, hybk: null, sector: null, streak: 0,
        reason: `回放自动建仓(v2趋势)（${p.code}）`,
      }));
      if (collectTrades) {
        for (const p of picks.slice(0, TOP_N)) {
          pendingFeatures[String(p.code)] = {
            entryDate: date, sector: null, weakToStrong: null, streak: 0, hotMoney: null,
            emotionScore, emotionBand: bandOf(emotionScore), base: 'v2',
            score: p.score, maBull: p.maBull, slope20: p.slope20, slope60: p.slope60, rs10: p.rs10, rs20: p.rs20,
          };
        }
      }
    } else {
      picks = (recommendPicks(day, { topN: TOP_N, emotionScore, minProb: 0, firstBoardReserve: resolvePoolMix(), firstBoardBoost: resolveFbBoost() }).picks || [])
        .filter((p) => p && p.code && qDay[String(p.code)]);
      for (const p of picks) { const sh = seatsHistory[date] && seatsHistory[date][String(p.code)]; if (sh) p.hotMoney = !!sh.hotMoney; }
      items = picks.slice(0, TOP_N).map((p) => ({
        code: String(p.code), pct: PER_POS_PCT, hybk: p.hybk || null, sector: p.hybk || p.theme || null,
        streak: p.streak || 0,   // 传入入场连板数，供 scanStopLoss 分级止损匹配（主线第1步）
        reason: `回放自动建仓（${p.name || p.code}）`,
      }));
      if (collectTrades) {
        for (const p of picks.slice(0, TOP_N)) {
          const sector = p.hybk || (Array.isArray(p.themes) ? p.themes[0] : null) || p.theme || null;
          pendingFeatures[String(p.code)] = {
            entryDate: date, sector,
            weakToStrong: (p.weakToStrong === true ? true : (p.weakToStrong === false ? false : null)),
            streak: p.streak || 0, hotMoney: !!p.hotMoney,
            emotionScore, emotionBand: bandOf(emotionScore),
          };
        }
      }
    }
    const safe = [];
    for (const it of items) {
      if (USE_GLM && base !== 'v2' && !glmBuyGuard(it.code, { hybk: it.hybk, asOfDate: date }).pass) continue;
      safe.push(it);
    }
    if (safe.length) acct = batchSubmit(acct, safe, day, { date, exec, applyLhbFilter: applyLhbFilterEff }).next;
  }

  // —— 第 1 步诊断·假摔判定：硬止损出场后 N 日内是否回补（close ≥ 出场价）。
  //   数据源：存档每日 hot/lhb 的 close（非 ztpool 分钟级，故仅日频代理；缺出场后数据→recovered=null）。
  //   ⚠ 覆盖局限：出场后该股若不再进 hot/lhb，则无法判假摔，按"无数据"计，报告时如实披露覆盖率。
  const closeSeries = {};   // code -> [{date, close}]
  for (const d of daysToRun) {
    for (const arr of [d.hot, d.lhb]) {
      if (!Array.isArray(arr)) continue;
      for (const x of arr) {
        if (x && x.code != null && Number.isFinite(+x.close)) {
          const k = String(x.code);
          (closeSeries[k] ||= []).push({ date: d.trade_date, close: +x.close });
        }
      }
    }
  }
  for (const tr of trades) {
    const series = closeSeries[String(tr.code)] || [];
    const later = series.filter((p) => p.date > tr.exitDate).slice(0, RECOVERY_WINDOW);
    tr.recovered = later.length ? later.some((p) => p.close >= (tr.exitPrice ?? 0)) : null;
  }

  const last = navSeries[navSeries.length - 1];
  const totalRet = (last.equity / 1000000 - 1) * 100;
  const winRate = soldTrades ? (winTrades / soldTrades * 100) : null;
  const res = { mode, days: days.length, dateRange: `${first}~${last.date}`, finalEquity: last.equity, totalRet, maxDd: maxDd * 100, fills, soldTrades, winRate };
  if (collectTrades) res.trades = trades;
  if (args.get('dumpTradePicks')) {
    const seen = new Set(); const out = [];
    for (const t of trades) { const k = t.entryDate + ':' + t.code; if (seen.has(k)) continue; seen.add(k); out.push({ date: t.entryDate, code: t.code }); }
    writeFileSync('data/_trade_picks.json', JSON.stringify(out));
    console.error('[dump-trade-picks]', out.length, 'written');
  }  console.error('DEBUG buyFills=', global.__bf, 'totalFills=', fills);
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
  printSlice('按连板数（追高代理）：', a.byStreak);
  printSlice('按游资净买（真实席位·回放注入）：', a.byHotMoney);
  printSlice('按板块（Top12）：', a.bySector, 12);
  console.log('\n  ── 第 1 步诊断：连板票全亏的三类假设 ──');
  printSlice('按出场原因：', a.byExitReason);
  printSlice('按止损后回补(假摔)：', a.byRecovered);
  printSlice('按入场月份(区间聚类)：', a.byEntryMonth);
  // 假摔专项：仅看"硬止损"出场且出场后有数据的交易，统计回补率
  const stopTrades = trades.filter((t) => t.exitReason && t.exitReason.includes('止损') && t.recovered != null);
  if (stopTrades.length) {
    const rec = stopTrades.filter((t) => t.recovered).length;
    console.log(`\n  假摔判定：硬止损出场且有出场后数据的 ${stopTrades.length} 笔中，${rec} 笔在 ${RECOVERY_WINDOW} 日内回补至出场价上方（即被洗）→ 假摔率 ${(rec / stopTrades.length * 100).toFixed(1)}%`);
  } else {
    console.log('\n  假摔判定：无「硬止损」出场或出场后无行情数据，无法判定（连板票多为隔日强制了结而非硬止损）。');
  }
  console.log('\n  诊断：盈亏比<1 的切片 = 期望为负的伪信号；盈亏比>1 且 n 足够 = 真有效因子。');
}

const mode = args.get('mode');
if (args.get('attrition')) {
  const r = await runReplay(mode || 'ideal', { collectTrades: true });
  print(r);
  reportAttrition(r.trades);
} else if (args.get('compare')) {
  const a = await runReplay('ideal'); print(a);
  const b = await runReplay('strict'); print(b);
  console.log('\n  差异（strict − ideal）：');
  console.log(`     总收益 ${ (b.totalRet - a.totalRet).toFixed(2) } pp｜最大回撤 ${ (b.maxDd - a.maxDd).toFixed(2) } pp｜平仓胜率 ${ b.winRate!=null&&a.winRate!=null ? (b.winRate - a.winRate).toFixed(1)+' pp' : '—' }`);
  console.log(`     若 strict 下总收益仍为正 → 策略在悲观执行下仍存活，可实盘；若转负 → 需调整。`);
} else {
  print(await runReplay(mode || 'ideal'));
}
