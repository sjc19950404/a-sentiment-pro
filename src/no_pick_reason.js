// ── 复盘模块：自动记录"为什么今天选不出票"（2026-10-12 用户指令）──────────────
//
// 背景：盘中双池（trend / streak）经 verifyIntradayPools 校验后可能全清 → 0 入选。
//   用户要的是"系统自动记一笔根因"，为次日开盘做准备。根因分两层：
//     · 微观：逐只剔除理由分布（掉底座 / 字段缺失 / 炸板 / 量比不足 / 主力转负…）
//       —— 来自报告顶层 push_verification（verifyIntradayPools 已算好，这里只聚合）；
//     · 宏观：市场层失稳信号，解释微观为何失稳：
//         - 炸板率 = 涨停收盘池中"盘中开板"占比（ztpool_history.fbt > 092500）。
//           极高 → 封板意愿弱、追板风险大；
//         - 板块轮动 = 行业 top5 日换手数（archive.industry 日涨跌幅排名）。
//           极高 → 无持续主线、动量无法沉淀。
//   两层结合给出结论 + 次日建议（suggestionForTomorrow）。
//
// 纯函数、零 Node 依赖（与 pool_verify / ai_report_push 同构），可单测、可 CI 复用。
// 阈值（TH）可调：炸板率 ≥40% 视为过高；top5 换手 ≥4/5 视为轮动过快。
import { isDateStr } from './module_freshness.js';

const pad6 = (v) => (v == null ? '' : String(v).padStart(6, '0'));

/** 炸板率：涨停收盘池中"盘中开板（非一字集合竞价封死）"占比。null = 无池。 */
export function zhabanRateOf(ztpoolDay) {
  const pool = ztpoolDay && Array.isArray(ztpoolDay.pool) ? ztpoolDay.pool : [];
  if (!pool.length) return null;
  const broke = pool.filter((p) => {
    const f = pad6(p.fbt);
    return f && f > '092500'; // 开盘后开板（一字板 fbt=092500 不计入）
  }).length;
  return broke / pool.length;
}

/** 板块轮动：行业 topN 日换手数（当日 top5 与昨日 top5 交集外的数量）。null = 缺数据。 */
export function sectorTurnover(archiveDay, prevDay, topN = 5) {
  const top = (d) => (d && Array.isArray(d.industry) ? d.industry : [])
    .slice().sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0))
    .slice(0, topN).map((i) => i.name);
  const cur = top(archiveDay);
  if (!cur.length) return null;
  const prev = new Set(top(prevDay));
  return cur.filter((n) => !prev.has(n)).length;
}

/** 聚合 verifyIntradayPools 的逐只剔除理由 → {reason: count}。 */
export function aggregateRemovalReasons(report) {
  const v = report && report.push_verification;
  const all = [
    ...((v && v.trend && v.trend.removed) || []),
    ...((v && v.streak && v.streak.removed) || []),
  ];
  const c = {};
  for (const r of all) c[r.reason || '未知'] = (c[r.reason || '未知'] || 0) + 1;
  return c;
}

/**
 * 计算"选不出票"复盘台账。
 * @param {object} o
 *   tradeDate, intradayReport（盘中报告档案，含 payload.simulation_stock + push_verification）,
 *   archiveDay（当日档案日，含 industry/emotion.topic_conc）, prevArchiveDay（上一交易日）,
 *   ztpoolDay（ztpool_history 当日收盘档，含 pool[].fbt）,
 *   thresholds? {zhaban, turnover}
 * @returns 结构化台账（见 computeNoPickReview 返回）
 */
export function computeNoPickReview({
  tradeDate, intradayReport, archiveDay, prevArchiveDay, ztpoolDay, thresholds = {},
} = {}) {
  const TH = {
    zhaban: thresholds.zhaban ?? 0.4,
    turnover: thresholds.turnover ?? 4,
  };
  const sim = intradayReport && intradayReport.payload && intradayReport.payload.simulation_stock;
  const candRaw = sim && Array.isArray(sim.candidate_pool) ? sim.candidate_pool.length : 0;
  const streakRaw = sim && Array.isArray(sim.streak_pool) ? sim.streak_pool.length : 0;
  const v = intradayReport && intradayReport.push_verification;
  const removedTrend = (v && v.trend && v.trend.removed) || [];
  const removedStreak = (v && v.streak && v.streak.removed) || [];
  const removedCount = removedTrend.length + removedStreak.length;
  const survived = candRaw + streakRaw - removedCount;
  const isEmpty = survived <= 0;

  const zr = zhabanRateOf(ztpoolDay);
  const turnover = sectorTurnover(archiveDay, prevArchiveDay);
  const topicConc = archiveDay && archiveDay.emotion ? archiveDay.emotion.topic_conc : null;

  // 宏观根因
  const macro = [];
  if (zr != null && zr >= TH.zhaban) {
    macro.push({ key: 'zhaban', label: `炸板率过高（${(zr * 100).toFixed(0)}%，封板意愿弱、追板风险大）`, value: Math.round(zr * 1000) / 1000 });
  }
  if (turnover != null && turnover >= TH.turnover) {
    macro.push({ key: 'rotation', label: `板块轮动过快（top5 行业日换手 ${turnover}/5，无持续主线）`, value: turnover / 5 });
  }

  const micro = aggregateRemovalReasons(intradayReport);

  let conclusion;
  if (!isEmpty) conclusion = `有票入选（存活 ${survived} 只），无需归因`;
  else if (macro.length) conclusion = `选不出票（候选 ${candRaw + streakRaw} 只校验后全清），根因：${macro.map((m) => m.label).join('；')}`;
  else conclusion = `选不出票（候选 ${candRaw + streakRaw} 只校验后全清），微观原因：${Object.keys(micro).join('、') || '无'}；市场层无极端信号，属规则严格+行情平淡`;

  const suggestion = [];
  if (macro.some((m) => m.key === 'zhaban')) suggestion.push('炸板率高→明日不追板，只做回封确认（开盘后观察是否真封死再定）');
  if (macro.some((m) => m.key === 'rotation')) suggestion.push('板块轮动快→等主线沉淀（连续 2 日同主线再出手），不做一日游题材');
  if (!macro.length) suggestion.push('规则严格+平淡→维持现有双池四条件，等待量比/主力共振的个股息');
  if (isEmpty) suggestion.push('今日 0 入选已记入台账，明日开盘前复盘本结论');

  return {
    tradeDate,
    generatedAt: new Date().toISOString(),
    selectedCount: survived,
    isEmpty,
    candidateRaw: candRaw + streakRaw,
    removedCount,
    metrics: {
      zhabanRate: zr == null ? null : Math.round(zr * 1000) / 1000,
      ztpoolCloseCount: (ztpoolDay && ztpoolDay.pool || []).length,
      sectorTurnover5: turnover,
      topicConc,
    },
    macroReasons: macro,
    microRemovalReasons: micro,
    conclusion,
    suggestionForTomorrow: suggestion,
  };
}
