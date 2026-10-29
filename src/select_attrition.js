// 选股胜率复盘 · 纯函数归因（2026-10-30 主线）
// ─────────────────────────────────────────────────────────────────────────────
// 输入：逐笔交易 trades[]，每条字段：
//   { code, sector, entryDate, exitDate, holdingDays, ret(小数, 已实现盈亏/买入名义额),
//     win(bool), weakToStrong, streak, hotMoney, emotionScore, emotionBand }
// 输出：整体 + 多维切片（情绪档 / 弱转强 / 连板数 / 游资 / 板块）的
//   胜率、平均收益、平均盈、平均亏、盈亏比(profitFactor)、单笔期望收益。
//
// 纯函数、零依赖、可单测；presentation 在 scripts/paper_replay.mjs 的 reportAttrition。
// 用途：回答"为什么理想策略都亏"——把亏损拆到因子切片，找出期望为负的伪信号
//       与期望为正的真有效因子，作为后续 Step2/Step3 的输入（先修地基，再谈权重/策略）。
// ─────────────────────────────────────────────────────────────────────────────

// 情绪分 → 情绪档（与 position_policy 阈值口径一致：<40 冰点 / 40-65 中性 / >=65 发酵）
export function bandOf(emotionScore) {
  if (emotionScore == null || Number.isNaN(emotionScore)) return '未知';
  if (emotionScore < 40) return '冰点(<40)';
  if (emotionScore < 65) return '中性(40-65)';
  return '发酵(>=65)';
}

export function holdDays(entryDate, exitDate) {
  const a = Date.parse(entryDate), b = Date.parse(exitDate);
  if (!(a > 0) || !(b > 0)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function stats(arr) {
  if (!arr || !arr.length) return null;
  const wins = arr.filter((t) => t.win);
  const losses = arr.filter((t) => !t.win);
  const sumRet = arr.reduce((s, t) => s + t.ret, 0);
  const avgRet = sumRet / arr.length;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.ret, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.ret, 0) / losses.length : 0;
  const sumWin = wins.reduce((s, t) => s + t.ret, 0);
  const sumLoss = Math.abs(losses.reduce((s, t) => s + t.ret, 0));
  const profitFactor = sumLoss > 0 ? sumWin / sumLoss : (sumWin > 0 ? Infinity : 0);
  return {
    n: arr.length,
    winRate: (wins.length / arr.length) * 100,
    avgRet: avgRet * 100,
    avgWin: avgWin * 100,
    avgLoss: avgLoss * 100,
    profitFactor,
    expectancy: avgRet * 100,   // 单笔期望收益(%) = 各笔平均收益
  };
}

export function attributeTrades(trades) {
  const groupBy = (keyFn) => {
    const m = new Map();
    for (const t of (trades || [])) {
      const k = keyFn(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return [...m.entries()].map(([key, arr]) => ({ key, ...stats(arr) })).sort((a, b) => b.n - a.n);
  };
  return {
    overall: stats(trades || []),
    byEmotionBand: groupBy((t) => t.emotionBand || '未知'),
    byWeakToStrong: groupBy((t) => (t.weakToStrong ? '弱转强' : (t.weakToStrong === false ? '非弱转强' : '未知(回放无涨停池)'))),
    byStreak: groupBy((t) => (t.streak >= 4 ? '4连板+' : t.streak >= 2 ? '2-3连板' : '首板(1)')),
    byHotMoney: groupBy((t) => (t.hotMoney ? '游资净买' : '非游资')),
    bySector: groupBy((t) => t.sector || '未知板块'),
    // —— 第 1 步诊断维度 ——
    byExitReason: groupBy((t) => t.exitReason || '未知'),          // 区分 隔日强制了结(连板)/止损/移动止盈/亏损不过三
    byRecovered: groupBy((t) => (t.recovered == null ? '未知(无出场后数据)' : (t.recovered ? '假摔(已回补)' : '真跌(未回补)'))),  // 硬止损后 N 日是否回补
    byEntryMonth: groupBy((t) => String(t.entryDate || '').slice(0, 7) || '未知'),  // 区间聚类：亏损是否集中在某段
  };
}

export const _stats = stats;   // 仅供单测
