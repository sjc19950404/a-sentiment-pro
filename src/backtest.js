// V5.2 回测引擎（Node ESM，纯函数、零依赖）
// 语义与 tools/backtest/sentiment_backtest.py 严格对齐，并由 test/backtest.test.mjs 的
// 跨语言一致性用例守护（夹具 test/fixtures/parity_v52.json 由 Python 侧生成）。
// 关键规格：T+1 生效 / 四档阈值 / 过热只减仓不新建 / 止损优先于仓位平滑 /
//           回撤动态降仓 / 交易成本按仓位变动幅度计提。
// 本文件供 scripts/backtest.mjs（服务端预生成 data/backtest.json）与单测使用；
// 浏览器端只渲染预生成结果，因此前端无需打包构建。

export const ANN = 252; // 年化系数

// 默认阈值：与 src/config.js 五档风险分界一致（≥80 过热 / ≥65 持有 / 44~65 减仓 / ≤24 清仓）
export const DEFAULT_TH = { panic: 24, hi: 44, lo: 65, overheat: 80 };

// 基准参数：V5 原始口径（满仓、无风控、无成本、不平滑）
export const BASE_PARAMS = {
  panic: DEFAULT_TH.panic, hi: DEFAULT_TH.hi, lo: DEFAULT_TH.lo, overheat: DEFAULT_TH.overheat,
  maxPos: 1.0, stopLoss: 0, ddTrigger: 0, maxPosChg: 0,
  comm: 0, stamp: 0, slip: 0,
};

// V5.2 增强参数：交易成本 + 仓位平滑 + 单笔止损 + 回撤动态降仓（A股实际口径）
export const V52_PARAMS = {
  ...BASE_PARAMS,
  maxPos: 1.0, stopLoss: -0.08, ddTrigger: -0.15, maxPosChg: 0.2,
  comm: 0.0003, stamp: 0.0005, slip: 0.0002,
};

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// ────────────────────────── 仓位（收盘打分 → 次日仓位） ──────────────────────────
// V5.3 新增三个可选参数（默认关闭，confirmDays=0 / maxPosByDay=null / takeProfit=null
// 时与旧版逐位一致，Python parity 夹具锁的是默认行为；新语义由夹具的 v53 参数组锁定）：
//   · confirmDays（右侧二次确认）：从空仓进入**半仓档**（panic<v<lo 的左侧回升区）
//     需要连续 confirmDays+1 日信号成立——第一日只记账不开仓，杜绝"接飞刀"。
//     只作用于半仓档开仓：v≥lo 是趋势强信号（右侧本身），止损/过热/清仓路径不受影响。
//   · maxPosByDay（regime 逐日仓位帽子）：市场状态（src/position_policy.js 的区间
//     上限）逐日压制 cap——与回撤降仓取更紧者（min）；情绪打分仍是信号主路径，
//     帽子只做仓位上限（"信号归信号、帽子归帽子"）。
//   · takeProfit（止盈，V5.3 P1）：两种模式可切换——
//     partial（分批止盈）：持仓腿累计涨幅 legCum≥ladder[k][0] → cap 压至
//       ladder[k][1]×maxPos（档位只升不降；[1.08,0.5] 即 +8% 减半、[1.15,0] 再清仓）。
//     trailing（移动止盈）：legCum 自峰值回撤 ≥trail 且峰值已到 activate（浮盈激活线，
//       浮亏阶段是止损的职责、不越权）→ 次日清仓，不受仓位平滑约束（风控优先）。
//     腿状态（legCum/legPeak/tpTier）在 prevTarget===0 的空仓日重置——止盈清仓后
//     信号仍满足则按普通开仓规则重进（止盈不锁死再入场），重进是新腿从 1 计。
export function positions(scores, rets, p = BASE_PARAMS) {
  const {
    hi = DEFAULT_TH.hi, lo = DEFAULT_TH.lo,
    panic = DEFAULT_TH.panic, overheat = DEFAULT_TH.overheat,
    maxPos = 1.0, stopLoss = 0, ddTrigger = 0, maxPosChg = 0,
    confirmDays = 0, maxPosByDay = null, takeProfit = null,
  } = p;
  const tpLadder = takeProfit && takeProfit.mode === 'partial' && Array.isArray(takeProfit.ladder)
    ? takeProfit.ladder : null;
  const tpTrail = takeProfit && takeProfit.mode === 'trailing'
    ? { trail: takeProfit.trail ?? 0.3, activate: takeProfit.activate ?? 1.05 } : null;
  const tpOn = !!(tpLadder || tpTrail); // mode 非法/none → 全部新逻辑旁路（零行为差异）
  const n = scores.length;
  const raw = new Array(n).fill(0);
  let held = false;
  let eq = 1, peak = 1, prevTarget = 0;
  let pending = 0; // 空仓期连续满足 v>panic 的天数（右侧二次确认的计数器）
  let legCum = 1; // 持仓腿累计价格路径（开仓生效日起 ∏(1+r)）
  let legPeak = 1; // 持仓期峰值（移动止盈基准）
  let tpTier = 0; // 分批止盈已触发档数（只升不降；0=未触发）
  for (let i = 0; i < n; i++) {
    const v = scores[i];
    if (rets) { // 当日收盘：先结算昨日目标仓位在当日的盈亏（无前视）
      eq *= 1 + prevTarget * rets[i];
      peak = Math.max(peak, eq);
    }
    // 空仓日（昨日决定空仓）→ 持仓腿结束，腿状态重置：
    // 重置必须在止盈判定/cap 压制**之前**——否则旧腿档位会压制当日的新开仓决定
    if (tpOn && prevTarget === 0) { legCum = 1; legPeak = 1; tpTier = 0; }
    // 持仓腿价格路径累积（今日是持仓日才计——T+1 口径与 eq 结算一致）
    if (tpOn && rets && prevTarget > 0) {
      legCum *= 1 + rets[i];
      legPeak = Math.max(legPeak, legCum);
    }
    let cap = maxPos;
    if (ddTrigger < 0 && rets) { // 回撤动态降仓（类凯利）
      const curDd = 1 - eq / peak;
      if (curDd >= -ddTrigger) cap = 0.4 * maxPos;
      else if (curDd >= 0.6 * -ddTrigger) cap = 0.7 * maxPos;
    }
    // regime 逐日帽子：与回撤降仓取更紧者（缺失日不压制——缺失显式化在调用方，
    // 引擎层拿不到帽子数据时不假装有帽子）。⚠ null 必须先判再转数值：
    // +null === 0 会把"缺帽子"静默当"帽子 0"（dirty.js::num 同款陷阱，实测踩过）。
    if (maxPosByDay != null && i < maxPosByDay.length
        && maxPosByDay[i] != null && Number.isFinite(+maxPosByDay[i])) {
      cap = Math.min(cap, Math.max(0, +maxPosByDay[i]));
    }
    // 分批止盈档位升级（只升不降，while 防单日跳档：涨逾两档阈值时连升）
    if (tpLadder && held) {
      while (tpTier < tpLadder.length && legCum >= tpLadder[tpTier][0]) tpTier++;
    }
    // 分批止盈档位压制：已触发档的系数×maxPos 与各帽子取更紧（dd/regime 同 min 语义）
    if (tpLadder && tpTier > 0) cap = Math.min(cap, tpLadder[tpTier - 1][1] * maxPos);
    // 移动止盈：浮盈激活后才跟踪回撤（浮亏阶段归止损管，不越权）
    let trailHit = false;
    if (tpTrail && held && legPeak >= tpTrail.activate) {
      if (1 - legCum / legPeak >= tpTrail.trail) trailHit = true;
    }
    const stopHit = stopLoss < 0 && held && rets && rets[i] <= stopLoss;
    // 右侧二次确认计数：空仓期 v>panic 连续天数（含强信号日，但强信号日不走半仓档
    // 不消费计数）；一旦 v<=panic 归零重数（反转中断则重新确认）
    if (v > panic && !held) pending++;
    else pending = 0;
    let target;
    if (stopHit || trailHit) target = 0;          // 止损/移动止盈：风控优先于信号
    else if (v >= overheat) target = held ? cap : 0; // 过热只减仓不新建
    else if (v >= lo) target = cap;
    // ⚠ 确认只拦"空仓进场"（held 或已连续确认才给半仓）：持仓中的半仓减仓**不受**确认
    //   约束。第一版漏了 held 条件——持仓中 pending 恒 0，把"半仓持有"误清仓，
    //   confirmDays=0 时也触发（base/v52 全序列漂移）。跨语言夹具两侧同错测不出
    //   （夹具由同版 Python 生成），此类"默认行为不变"约束必须配行为锚单测。
    else if (v > panic) target = (held || pending > confirmDays) ? 0.5 * cap : 0;
    else target = 0;
    if (maxPosChg > 0 && !stopHit && !trailHit) { // 仓位平滑：止损/移动止盈不受约束
      target = clamp(target, prevTarget - maxPosChg, prevTarget + maxPosChg);
    }
    held = target > 0;
    raw[i] = target;
    prevTarget = target;
  }
  return raw.map((_, i) => (i === 0 ? 0 : raw[i - 1])); // T+1 生效
}

// ────────────────────────── 交易成本 ──────────────────────────
export function turnoverCost(pos, p = BASE_PARAMS) {
  const { comm = 0, stamp = 0, slip = 0 } = p;
  const n = pos.length;
  const cost = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const chg = i === 0 ? pos[0] : pos[i] - pos[i - 1];
    if (chg > 0) cost[i] = chg * (comm + slip);                    // 买入：佣金+滑点
    else if (chg < 0) cost[i] = -chg * (comm + stamp + slip);      // 卖出：佣金+印花税+滑点
  }
  return cost;
}

// ────────────────────────── 绩效指标 ──────────────────────────
export function metrics(strat, pos, opens, rf = 0) {
  const n = strat.length;
  const nav = [];
  let acc = 1;
  for (const s of strat) { acc *= 1 + s; nav.push(acc); }
  const total = nav[n - 1] - 1;
  const annual = n > 0 && total > -1 ? (1 + total) ** (ANN / n) - 1 : -1;
  let runPeak = -Infinity, maxDd = 0;
  for (const v of nav) { runPeak = Math.max(runPeak, v); maxDd = Math.max(maxDd, 1 - v / runPeak); }
  const mean = strat.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(strat.reduce((a, b) => a + (b - mean) ** 2, 0) / n); // ddof=0
  const excessMean = mean - rf / ANN;                                        // 夏普计入无风险利率
  const sharpe = sd > 1e-12 ? (excessMean / sd) * Math.sqrt(ANN) : 0;
  let heldN = 0, heldWin = 0, gain = 0, loss = 0, negN = 0, negSq = 0;
  for (let i = 0; i < n; i++) {
    const s = strat[i];
    if (pos[i] > 0) { heldN++; if (s > 0) heldWin++; }
    if (s > 0) gain += s; else if (s < 0) { loss += -s; negN++; }
  }
  const negMean = negN ? -loss / negN : 0;
  for (const s of strat) if (s < 0) negSq += (s - negMean) ** 2;
  const negSd = negN ? Math.sqrt(negSq / negN) : 0;
  const winRate = heldN ? heldWin / heldN : 0;
  const profitRatio = loss > 1e-12 ? gain / loss : Infinity;
  const calmar = maxDd > 1e-9 ? annual / maxDd : 999;
  const sortino = negN > 1 && negSd > 1e-12 ? (excessMean / negSd) * Math.sqrt(ANN) : 999;
  let mcl = 0, run = 0; // 最大连续亏损天数（游程计数）
  for (const s of strat) { run = s < 0 ? run + 1 : 0; mcl = Math.max(mcl, run); }
  const emptyRatio = pos.filter((x) => x === 0).length / n;
  return {
    total, annual, maxDd, sharpe, winRate,
    profitRatio: Number.isFinite(profitRatio) ? profitRatio : 999,
    heldDays: heldN, emptyRatio, opens, calmar, sortino, maxConsecLoss: mcl, nav,
  };
}

// 优化优先级：回撤最小 → 夏普最高 → 年化最高（与 Python rank_key 一致）
export const rankKey = (m) => [m.maxDd, -m.sharpe, -m.annual];

export function sortByRank(rows) {
  return [...rows].sort((a, b) => {
    const ka = rankKey(a), kb = rankKey(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
}

// ────────────────────────── 单标的 / 多标的回测 ──────────────────────────
export function runBacktest(scores, rets, p = BASE_PARAMS, rf = 0) {
  const pos = positions(scores, rets, p);
  const cost = turnoverCost(pos, p);
  const strat = rets.map((r, i) => r * pos[i] - cost[i]);
  let opens = 0;
  for (let i = 0; i < pos.length; i++) if (pos[i] > 0 && (i === 0 || pos[i - 1] === 0)) opens++;
  return { pos, strat, perf: metrics(strat, pos, opens, rf) };
}

// 多标的等权轮动：逐标的按同规则回测 → 日收益等权合成（对齐 Python pool_strat）
export function poolBacktest(scores, retsByAsset, p = BASE_PARAMS, rf = 0) {
  const assets = Object.keys(retsByAsset);
  const n = scores.length;
  const strat = new Array(n).fill(0);
  const pos = new Array(n).fill(0);
  let opens = 0;
  for (const a of assets) {
    const r = runBacktest(scores, retsByAsset[a], p, rf);
    for (let i = 0; i < n; i++) { strat[i] += r.strat[i] / assets.length; pos[i] += r.pos[i] / assets.length; }
    opens += r.perf.opens;
  }
  return { strat, pos, perf: metrics(strat, pos, opens, rf) };
}

// ────────────────────────── 网格寻优 + 帕累托双目标 ──────────────────────────
// 权重网格：以基准权重为锚做倍数扰动后归一化（七因子权重和为 1）
export function weightGrid(baseWeights, steps = [0.8, 1.0, 1.2]) {
  const keys = Object.keys(baseWeights);
  let acc = [{}];
  for (const k of keys) {
    const next = [];
    for (const combo of acc) for (const s of steps) next.push({ ...combo, [k]: baseWeights[k] * s });
    acc = next;
  }
  return acc.map((c) => {
    const sum = Object.values(c).reduce((a, b) => a + b, 0);
    const out = {};
    for (const k of keys) out[k] = c[k] / sum;
    return out;
  });
}

// 七因子加权打分（与 pipeline 的 emotion.value 同口径：factor 已是 0~100，权重和为 1）
// 权重键必须能命中因子键——config.weights 带档位后缀（s_net20），存档因子键无后缀（s_net），
// 调用方需先经 config.factorKeyMap 转换；一个都命中则直接报错，避免静默全 0 分。
export function scoreWith(factorsByDay, w) {
  const wKeys = Object.keys(w);
  const fKeys = factorsByDay[0] ? Object.keys(factorsByDay[0]) : [];
  const hit = wKeys.filter((k) => fKeys.includes(k));
  if (fKeys.length && !hit.length) {
    throw new Error(`scoreWith: 权重键与因子键不匹配（权重键 ${wKeys.join(',')} / 因子键 ${fKeys.join(',')}）`);
  }
  const use = hit.length ? hit : wKeys;
  return factorsByDay.map((f) => {
    let s = 0;
    for (const k of use) s += (f[k] ?? 0) * w[k];
    return s;
  });
}

export function gridSearch(factorsByDay, retsByAsset, baseWeights, p = BASE_PARAMS, steps) {
  const rows = [];
  for (const w of weightGrid(baseWeights, steps)) {
    const scores = scoreWith(factorsByDay, w);
    const { perf } = poolBacktest(scores, retsByAsset, p);
    rows.push({ w, ...perf, nav: undefined });
  }
  return sortByRank(rows);
}

// 双目标帕累托非支配解集：最大化夏普、最小化最大回撤（严格支配判定）
export function paretoFrontier(rows, obj1 = 'sharpe', obj2 = 'maxDd') {
  const d = rows.map((r, i) => ({ i, v1: r[obj1], v2: r[obj2], r }));
  d.sort((a, b) => (a.v2 - b.v2) || (b.v1 - a.v1));
  const eff = new Set();
  let runMax1 = -Infinity, i = 0;
  while (i < d.length) {
    let j = i, groupMax1 = -Infinity;
    while (j < d.length && d[j].v2 === d[i].v2) { // 同一 obj2 组内互不支配
      if (d[j].v1 > runMax1) eff.add(d[j].i);
      groupMax1 = Math.max(groupMax1, d[j].v1);
      j++;
    }
    runMax1 = Math.max(runMax1, groupMax1);
    i = j;
  }
  return rows.filter((_, idx) => eff.has(idx)).sort((a, b) => b.calmar - a.calmar);
}

// ────────────────────────── 滚动样本外（walk-forward） ──────────────────────────
// refit=false：固定权重按 test 窗切段评估；refit=true：每段用训练窗重寻优权重再评估测试窗
export function rollingTest(factorsByDay, retsByAsset, baseWeights, p = BASE_PARAMS,
                            { trainWindow = 20, testWindow = 6, refit = false, steps } = {}) {
  const n = factorsByDay.length;
  const segs = [];
  for (let start = 0; start + trainWindow + testWindow <= n; start += testWindow) {
    const trEnd = start + trainWindow, teEnd = trEnd + testWindow;
    const fTr = factorsByDay.slice(start, trEnd), fTe = factorsByDay.slice(trEnd, teEnd);
    const rTr = {}, rTe = {};
    for (const a of Object.keys(retsByAsset)) {
      rTr[a] = retsByAsset[a].slice(start, trEnd);
      rTe[a] = retsByAsset[a].slice(trEnd, teEnd);
    }
    let w = baseWeights;
    if (refit) {
      const best = sortByRank(weightGrid(baseWeights, steps).map((cand) => {
        const { perf } = poolBacktest(scoreWith(fTr, cand), rTr, p);
        return { w: cand, ...perf, nav: undefined };
      }))[0];
      w = best.w;
    }
    const { perf } = poolBacktest(scoreWith(fTe, w), rTe, p);
    segs.push({ trainStart: start, testStart: trEnd, testEnd: teEnd, w, ...perf });
  }
  const withFinite = segs.filter((s) => Number.isFinite(s.sharpe));
  const sharpeMean = withFinite.length
    ? withFinite.reduce((a, s) => a + s.sharpe, 0) / withFinite.length : 0;
  const ddWorst = segs.length ? Math.max(...segs.map((s) => s.maxDd)) : 0;
  const winSegPct = segs.length ? segs.filter((s) => s.total > 0).length / segs.length : 0;
  return { segments: segs, sharpeMean, ddWorst, winSegPct };
}

// ────────────────────────── 主线自动选股（当日） ──────────────────────────
// 口径：题材榜按涨停家数取主线 → 用热点榜该题材成分股作标的清单（与页面 scoreMainStructure 同源）；
// 强度分 = 主线涨停家数 × 题材密集度（该题材涨停数 ÷ 全题材涨停数），形态对齐 Python find_main_line
// （涨停家数 × 涨停密度），数据源不同故绝对量级不可直接比较。
export function selectMainLine(day, topN = 1) {
  const themes = day.themes || {};
  const hot = day.hot || [];
  const industry = day.industry || [];
  const total = Object.values(themes).reduce((a, b) => a + b, 0) || 1;
  const ranked = Object.entries(themes).sort((a, b) => b[1] - a[1]).slice(0, Math.max(topN, 1));
  const mains = ranked.map(([name, cnt]) => {
    const stocks = hot
      .filter((h) => String(h.reason || '').includes(name))
      .map((h) => ({ code: h.code, name: h.name, changePct: h.change_pct, reason: h.reason }))
      .sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
    const density = cnt / total;
    return {
      theme: name, themeCount: cnt, density: Math.round(density * 1e4) / 1e4,
      mainScore: Math.round(cnt * density * 100) / 100,
      stocks: stocks.slice(0, 10), stockCount: stocks.length,
    };
  });
  const topIndustries = [...industry].sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0)).slice(0, 5);
  return { tradeDate: day.trade_date, mains, topIndustries };
}
