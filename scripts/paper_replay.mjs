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
  pickSlip, setExecContext,
} from '../src/paper.js';
import { recommendPicks } from '../src/picks.js';
import { glmBuyGuard } from '../src/glm_guard.js';
import { attributeTrades, bandOf, holdDays } from '../src/select_attrition.js';
import { readFileSync, writeFileSync } from 'node:fs';
import config from '../src/config.js';
import SHARED from '../src/backtest_params.js';
import { getKline } from '../src/kline.js';
import { recommendPicksV2, buildKlineCache, buildIndexCache, klineQuoteOn, maAt } from '../src/picks_v2.js';

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
  else if (a === '--slip-model') args.set('slipModel', process.argv[++i] || 'flat');
  else if (a.startsWith('--slip-model=')) args.set('slipModel', a.split('=')[1] || 'flat');
  else if (a === '--tranche') args.set('tranche', Math.max(1, Number(process.argv[++i]) || 1));
  else if (a === '--tranche-cap-limit') args.set('trancheCapLimit', process.argv[++i]);   // 分批建仓持仓数上限（tranche>1 时约束总持仓数量，消除拆单后持仓数膨胀的副作用）
  else if (a.startsWith('--tranche=')) args.set('tranche', Math.max(1, Number(a.split('=')[1]) || 1));
  else if (a === '--regime-cap') args.set('regimeCap', '1');   // 默认关闭；开启后按 day.emotion 推导的 regime 档位压仓位（执行层挂件，开关对比基线）
  else if (a === '--regime-warm') args.set('regimeWarm', process.argv[++i]);   // regime 帽扫描：覆盖 warm(回暖) 档仓位帽（配合 --regime-cap 使用）
  else if (a === '--regime-scale') args.set('regimeScale', process.argv[++i]);   // 全局缩放 ice/ebb/warm/high 四档仓位帽（连续平滑整体风险暴露；须配合 --regime-cap 生效，双模式并存）
  else if (a === '--limit-fill-prob') args.set('limitFillProb', '1');   // 涨跌停排队概率模型（默认关；开启后涨停买入按前排比例概率成交、跌停卖出按概率成交否则排队）
  else if (a === '--tranche-cap-limit') args.set('trancheCapLimit', Math.max(1, Number(process.argv[++i]) || 1));   // 分批建仓模式限制总持仓标的数（保持总敞口与整单模式一致）
}

// 分级止损对照开关：streak-tier=开启连板分级止损；legacy=强制关闭（与旧规则一致，作对照组）。
// 默认（未指定）按生产口径（config.streaks.streakTier=false → 全局 -8%），保持历史回放不变。
function resolveStops() {
  const s = config.params.live.stops || {};
  const ov = args.get('stopOverride');
  if (ov === 'streak-tier') return { ...s, streakTier: true };
  if (ov === 'legacy') return { ...s, streakTier: false };
  // v2 趋势跟随专属出场：宽硬止损(-15%)仅作灾难兜底；趋势破位(跌破MA60)由 scanStopLoss 用 p.trendMa60 判定，v1 不注入→零污染
  if (args.get('base') === 'v2') return { ...s, baseHardStopPct: -0.15, streakTier: false };
  return { ...s, streakTier: false };
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
  // 滑点剖面插件：--slip-model profile 启用差异化滑点（flat=基线，不改历史回测数字）
  if (args.get('slipModel') === 'profile') cfg.slipModel = 'profile';
  // 分批建仓：--tranche N 把单票 pct 拆成 N 日等额建仓（1=不拆）
  const tr = Number(args.get('tranche')) || 1;
  if (tr > 1) cfg.tranche = tr;
  // 涨跌停排队概率模型：--limit-fill-prob 开启（默认关，保基线）
  if (args.get('limitFillProb')) cfg.limitFillProb = true;
  return normalizeExec(cfg);
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 执行层·regime 情绪风控挂件：存档无 day.regime 字段，从 day.emotion.value(0-100) 推导四档仓位帽。
// 冰点/退潮 压仓（防守），回暖 放大，高潮 反手压（防追高）。阈值/帽值均可配置，调参不改选股/出场。
//
// ┌─ 一句话备注（执行层实验终点）──────────────────────────────────────────────┐
// │ regimeCap 是风险敞口调节器，仅控制你愿意承受多少暴露；它不能修复选股信号本身负期望。  │
// │ 小样本下单档位扫描结果噪声极强，不可外推。                                      │
// └──────────────────────────────────────────────────────────────────────────┘
//
// 【执行层对照实验归档结论（2026-10-30 收尾，后续不再扫描参数网格）】
//   1) --regime-warm 单维度扫描完成，无可靠、可复现的收益拐点。输出剧烈跳变本质是平仓样本
//      （4–6 笔）太少，结果由少数标的随机盈亏主导，不是阈值本身具备稳定规律。
//   2) regimeCap 唯一稳定作用：控制总敞口、压低最大回撤；它不改变单笔平仓期望，不能创造
//      正向 alpha，与「选股层负期望」底层结论完全自洽。
//        · 保守档参考：warm=0.3 → 回撤 4.66%（本组最低）、收益 +6.63%、交易频次大幅收缩，
//          适合极度保守风控偏好。
//        · 高敞口档参考：warm=0.7/0.8 → 收益 +17.64%，但仅 5 笔平仓、属窗口运气，
//          严禁当作优选参数用于实盘。
//        · warm=0.6（默认）本组表现最差，属样本噪声，不代表该阈值天然有害。
//   3) 两个旋钮区分（务必分清）：
//        · --regime-warm：单独调整回暖档上限，精细化档位调参，输出噪声高（本次已扫，结论见上）。
//        · --regime-scale：全局系数同步缩放四档仓位帽，才是平滑调整整体风险暴露的旋钮；
//          已接线：须配合 --regime-cap 生效，对四档统一乘系数（连续缩放，消除离散档跳变）。
//   4) 约束重申：选股层持续封盘；所有 V1/V2 底层选股、出场逻辑冻结。本回测框架定位固定为
//      「执行摩擦 + 情绪风控模拟器」，只评估给定信号的资金与流动性代价，不再寻找能稳定盈利的选股参数。
//
// 【后续使用模式】
//   · 基线回归：默认 flat（不挂任何执行层插件），用于校验改动是否污染原有策略逻辑。
//   · 写实评估：固定带上 --slip-model profile（基础价差+成交量冲击滑点，量上限拒超量），按需叠加：
//     --regime-cap（+--regime-scale 连续缩放 / --regime-warm 单档精调）=情绪压仓；
//     --limit-fill-prob=涨跌停排队概率（涨停买入按前排比例成交/跌停卖出按概率成交否则排队）；
//     --tranche N（+--tranche-cap-limit 约束持仓数）=分批建仓。
//   · 注：成交量冲击滑点依赖个股当日成交额，存档仅龙虎榜股具备(deal_wan)，热点股无绝对额→
//     走 proxy 参考额(refAmountSmall/Trend, 按换手率微调)，小仓位(10%)冲击极小属真实；大单/小盘需补数据才显著。
//   · 不继续遍历参数网格寻优。
//
// 【V1 · profile 滑点 + regime 帽 · warm 档扫描结果留存表（255 交易日，本金 100 万）】
//   warm 帽   净值      收益    回撤    成交/平仓(胜率)  滑点损耗
//   profile-only(无regime) 1,086,744 +8.67%  8.84%  47/15(6.7%)   7,202
//   regime默认(0.6)       976,110  -2.39% 14.28%  17/6(16.7%)    5,217
//   0.30               1,066,328  +6.63%  4.66%  11/4(25.0%)    2,227
//   0.40               1,044,026  +4.40%  7.66%  14/6(16.7%)    4,264
//   0.50               1,045,789  +4.58%  9.50%  12/4(25.0%)    2,262
//   0.60               976,110   -2.39% 14.28%  17/6(16.7%)    5,217
//   0.70               1,176,413 +17.64%  9.95%  15/5(20.0%)    3,924
//   0.80               1,176,379 +17.64%  9.95%  16/5(20.0%)    3,924
//   （注：每档仅 4–6 笔平仓，跳变由小样本噪声主导，不可外推；详见结论 1/2。）
// ═══════════════════════════════════════════════════════════════════════════════════
const REGIME_CAP = { ice: 0.20, ebb: 0.35, warm: 0.60, high: 0.45 };
let QUEUE_UNFILLED = 0;   // 涨跌停排队未成交委托计数（TCA 机会损耗代理，仅计数+意图名义额，不虚构 P&L）
function regimeOfEmotion(v) {
  if (v == null || !Number.isFinite(+v)) return 'warm';
  const x = +v;
  if (x < 25) return 'ice';    // 冰点
  if (x < 45) return 'ebb';    // 退潮
  if (x <= 65) return 'warm';  // 回暖
  return 'high';               // 高潮
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
  QUEUE_UNFILLED = 0;
  let peak = 1000000, maxDd = 0;

  // —— 逐笔归因采集容器（仅 --attrition 时启用，不影响原有回放逻辑）——
  const trades = [];
  const openTrades = {};       // code -> { entryPrice, entrySlip, entryGross, ...选股特征 }
  const pendingFeatures = {};   // code -> 决策日选股特征（买入成交时归因用）
  const planned = {};          // code -> 分批建仓剩余待部署占比（exec.tranche>1 时生效）

  for (const day of daysToRun) {
    const date = day.trade_date;
    setExecContext(exec);   // 注入模块级执行上下文，供 submitOrder 在 profile 模式统一解析滑点
    // regime 帽：默认 null=基线（不压）。开启后按 day.emotion 推导档位压仓位；
    //   --regime-warm 覆盖 warm 档（离散精调）；--regime-scale 全局线性缩放四档（连续平滑整体敞口）；
    //   双模式并存：--regime-cap 打开离散档位，--regime-scale 在其上乘系数。
    let regimeCap = null;
    const regimeScale = (args.get('regimeScale') != null && Number.isFinite(+args.get('regimeScale'))) ? +args.get('regimeScale') : null;
    if (args.get('regimeCap')) {
      const rg = regimeOfEmotion(day.emotion?.value);
      let c = (rg === 'warm' && args.get('regimeWarm') != null) ? +args.get('regimeWarm') : REGIME_CAP[rg];
      if (regimeScale != null) c *= regimeScale;   // 连续缩放整体风险暴露，消除离散档跳变
      regimeCap = c;
    }
    // ① 结算当日：盯市 + T+1 解冻 + 硬止损（与 paper_daily 同）
    const qDay = richQuotes(day);
    // v2 趋势跟随：按日把持仓票的 MA60 注入持仓（供 scanStopLoss 跌破MA60 破位出场）；v1 不注入→零污染
    if (base === 'v2' && klineCache) {
      for (const code of Object.keys(acct.positions || {})) {
        const kl = klineCache.get(code);
        const ma = kl ? maAt(kl, date, 60) : null;
        if (ma != null) acct.positions[code] = { ...acct.positions[code], trendMa60: ma };
      }
    }
    const r = settleDay(acct, date, qDay, { exec, stops: resolveStops() });
    acct = r.account;
    fills += r.fills.length;
    // 只计 limitFillProb 模型产生的真实排队事件（涨停排队未排到/跌停卖出未成交/排队）；
    // 排除 ideal 模式旧近似的「涨停价无法买入」（非真实排队，会污染基线）。
    for (const lg of (r.expired || [])) { if (lg && lg.reason && /涨停排队未排到|跌停卖出未成交|排队/.test(lg.reason || '')) QUEUE_UNFILLED++; }

    // 成交单 → 逐笔交易配对（买开仓 / 卖平仓）。注：单笔配对近似，不计加仓/减仓精确 FIFO。
    for (const t of r.fills) {
      if (t.side === 'buy' && t.status === 'filled') {
        const f = pendingFeatures[String(t.code)];
        if (f) openTrades[String(t.code)] = { entryPrice: t.price, entrySlip: t.slip, entrySlipBase: t.slipBase, entrySlipImpact: t.slipImpact, entryGross: t.gross, ...f };
      } else if (t.side === 'sell' && t.status === 'filled') {
        const o = openTrades[String(t.code)];
        if (o && t.qty > 0) {
          const ret = t.realized / (o.entryPrice * t.qty);   // 已实现盈亏 / 买入名义额
          const win = t.realized > 0;
          const slipBaseCost = (o.entrySlipBase || 0) * (o.entryGross || 0) + (t.slipBase || 0) * t.gross;   // 基础买卖价差损耗（元）
          const slipImpactCost = (o.entrySlipImpact || 0) * (o.entryGross || 0) + (t.slipImpact || 0) * t.gross; // 大单冲击损耗（元）
          const slipCost = slipBaseCost + slipImpactCost;  // 滑点损耗合计（元）
          trades.push({
            code: String(t.code), sector: o.sector || null, entryDate: o.entryDate, exitDate: date, exitPrice: t.price,
            holdingDays: holdDays(o.entryDate, date), ret, win, exitReason: t.reason || null,
            weakToStrong: o.weakToStrong, streak: o.streak, hotMoney: o.hotMoney, emotionScore: o.emotionScore, emotionBand: o.emotionBand,
            base: o.base || base, regimeEntry: o.regimeEntry || null,   // 选股来源 + 入场日市场 regime
            signal: { weakToStrong: o.weakToStrong, streak: o.streak, hotMoney: o.hotMoney, emotionBand: o.emotionBand, base: o.base, score: o.score, maBull: o.maBull, slope20: o.slope20, slope60: o.slope60, rs10: o.rs10, rs20: o.rs20 },  // 触发信号
            slipCost, slipBaseCost, slipImpactCost,   // 滑点损耗（元）· 拆成 基础价差 / 大单冲击
          });
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
      const need = new Set([...Object.keys(acct.positions || {}), ...picks.map((p) => p.code)]);
      for (const code of need) {
        const qv = klineQuoteOn(klineCache.get(code), date);
        if (qv) qDay[code] = { code, ...qv };
      }
      items = picks.slice(0, TOP_N).map((p) => ({
        code: String(p.code), pct: PER_POS_PCT, hybk: null, sector: null, streak: 0,
        slipProfile: 'trend',   // 趋势中大票滑点剖面（滑点由 submitOrder 在 profile 模式统一算：基础+冲击）
        reason: `回放自动建仓(v2趋势)（${p.code}）`,
      }));
      if (collectTrades) {
        for (const p of picks.slice(0, TOP_N)) {
          pendingFeatures[String(p.code)] = {
            entryDate: date, sector: null, weakToStrong: null, streak: 0, hotMoney: null,
            emotionScore, emotionBand: bandOf(emotionScore), base: 'v2', regimeEntry: regimeOfEmotion(emotionScore),
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
        slipProfile: 'small',    // 连板小票滑点剖面（滑点由 submitOrder 在 profile 模式统一算：基础+冲击）
        reason: `回放自动建仓（${p.name || p.code}）`,
      }));
      if (collectTrades) {
        for (const p of picks.slice(0, TOP_N)) {
          const sector = p.hybk || (Array.isArray(p.themes) ? p.themes[0] : null) || p.theme || null;
          pendingFeatures[String(p.code)] = {
            entryDate: date, sector,
            weakToStrong: (p.weakToStrong === true ? true : (p.weakToStrong === false ? false : null)),
            streak: p.streak || 0, hotMoney: !!p.hotMoney,
            emotionScore, emotionBand: bandOf(emotionScore), regimeEntry: regimeOfEmotion(emotionScore),
          };
        }
      }
    }
    const safe = [];
    const tr = exec.tranche || 1;
    const trancheCapLimit = (args.get('trancheCapLimit') != null && Number.isFinite(+args.get('trancheCapLimit'))) ? +args.get('trancheCapLimit') : null;
    for (const it of items) {
      if (USE_GLM && base !== 'v2' && !glmBuyGuard(it.code, { hybk: it.hybk, asOfDate: date }).pass) continue;
      // 分批建仓持仓数约束：达上限后不再开新仓（已持仓/已 planned 的继续），保证总敞口与整单模式一致。
      // 注意：只按「实际持仓数 + 本批新开」计上限，planned(含信号掉出后停滞的僵尸计划)不计入，否则僵尸计划永久占坑挡掉新仓。
      const c0 = String(it.code);
      if (trancheCapLimit != null && !acct.positions[c0] && planned[c0] == null) {
        const openN = Object.keys(acct.positions || {}).length;
        if (openN + safe.length >= trancheCapLimit) continue;
      }
      let pct = PER_POS_PCT;
      if (tr > 1) {
        // 分批建仓：新选 → 首份建仓并挂剩余计划；已在进行 → 再投一份。信号弱化掉出榜单则计划停滞（贴近真实）。
        if (planned[it.code] != null) {
          pct = Math.min(planned[it.code], PER_POS_PCT / tr);
          planned[it.code] = Math.max(0, planned[it.code] - pct);
          if (planned[it.code] <= 1e-9) delete planned[it.code];
        } else {
          pct = PER_POS_PCT / tr;
          planned[it.code] = PER_POS_PCT - pct;
        }
      }
      safe.push({ ...it, pct });
    }
    if (safe.length) acct = batchSubmit(acct, safe, day, { date, exec, applyLhbFilter: applyLhbFilterEff, regimeCap, singleStockCap: SHARED.SINGLE_STOCK_CAP }).next;
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
  }
  return res;
}

function print(r) {
  console.log(`  [${r.mode}] ${r.dateRange} 共 ${r.days} 交易日`);
  console.log(`     期末净值 ${r.finalEquity.toFixed(0)} 元｜总收益 ${r.totalRet.toFixed(2)}%｜最大回撤 ${r.maxDd.toFixed(2)}%`);
  console.log(`     成交 ${r.fills} 笔｜平仓 ${r.soldTrades} 笔｜平仓胜率 ${r.winRate == null ? '—' : r.winRate.toFixed(1) + '%'}`);
  const flags = [];
  if (args.get('slipModel') === 'profile') flags.push('滑点剖面=profile');
  if ((args.get('tranche') || 1) > 1) flags.push(`分批建仓=${args.get('tranche')}`);
  if (args.get('regimeCap')) flags.push('regime帽=on' + (args.get('regimeScale') != null ? '×' + args.get('regimeScale') : ''));
  if (args.get('limitFillProb')) flags.push('涨跌停排队=on');
  if (args.get('trancheCapLimit') != null) flags.push('tranche持仓上限=' + args.get('trancheCapLimit'));
  if (flags.length) console.log(`     执行挂件：${flags.join('，')}`);
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
function aggSlice(trades, keyFn) {
  const groups = {};
  for (const t of trades) { const k = keyFn(t); (groups[k] ||= []).push(t); }
  return Object.entries(groups).map(([key, arr]) => {
    const n = arr.length;
    const wins = arr.filter((t) => t.win).length;
    const winRate = n ? wins / n * 100 : null;
    const avgRet = n ? arr.reduce((s, t) => s + t.ret, 0) / n * 100 : null;
    const sumWin = arr.filter((t) => t.win).reduce((s, t) => s + t.ret, 0);
    const sumLoss = arr.filter((t) => !t.win).reduce((s, t) => s + t.ret, 0);
    const profitFactor = sumLoss < 0 ? (sumWin / -sumLoss) : (sumWin > 0 ? Infinity : null);
    const expectancy = n ? arr.reduce((s, t) => s + t.ret, 0) / n * 100 : null;
    return { key, n, winRate, avgRet, profitFactor, expectancy };
  }).sort((x, y) => y.n - x.n);
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
  printSlice('按选股来源(base)：', aggSlice(trades, (t) => t.base || 'legacy'));
  printSlice('按入场regime：', aggSlice(trades, (t) => t.regimeEntry || 'n/a'));
  const totalSlip = trades.reduce((s, t) => s + (t.slipCost || 0), 0);
  const totalBase = trades.reduce((s, t) => s + (t.slipBaseCost || 0), 0);
  const totalImpact = trades.reduce((s, t) => s + (t.slipImpactCost || 0), 0);
  console.log(`\n  滑点损耗合计：${totalSlip.toFixed(0)} 元（${trades.length} 笔平仓，含买卖双边）`);
  console.log(`    └ TCA 执行成本拆分：基础买卖价差 ${totalBase.toFixed(0)} 元 ｜ 大单冲击 ${totalImpact.toFixed(0)} 元 ｜ 涨跌停排队未成交 ${QUEUE_UNFILLED} 笔（机会损耗，未虚构 P&L）`);
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
