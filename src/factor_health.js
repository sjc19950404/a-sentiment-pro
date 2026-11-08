// 因子健康度仪表——判定引擎纯函数（2026-11-09，外部拍板规格）
// 与 scripts/factor_health.mjs 分离：本模块零 IO 零副作用，测试直接引用。
// 三态阈值（外部拍板，改动须人工评审——系统禁止自动修改规则）：
//   ❌ 告警：连续 ≥2 周负超额 OR 8 周超额胜率 <48% OR 4 周均值alpha 低于全史
//      30 分位且为负（拐头向下）
//   ⚠️ 观察：胜率 48%~52% OR 单周超额转负 OR 4 周均值低于全史 30 分位
//   ✅ 健康：最新周超额 ≥0 且 胜率 ≥52% 且 无连续负超额
//   历史 <8 周 → warming（积累期，只报数据不判定）

const ALARM_WIN = 0.48;   // 胜率告警线
const HEALTHY_WIN = 0.52; // 胜率健康线
const MA4_PCT = 0.30;     // 4 周均值 alpha 的全史分位阈值
const MIN_WEEKS = 8;      // 判定门槛

export function weekKey(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z'); // 正午避免时区跨日
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10); // 该周一日期即周 key
}

export function judge(weeksAll) {
  const last = weeksAll[weeksAll.length - 1];
  if (!last || weeksAll.length < MIN_WEEKS) {
    return {
      status: 'warming',
      headline: `积累中：仅 ${weeksAll.length} 周（<${MIN_WEEKS}），未达判定门槛——只报数据不判健康也不告警`,
      alphaWinRate8: null, negStreak: 0, ma4Pct: null,
    };
  }
  const W8 = weeksAll.slice(-8);
  const alphaWinRate8 = W8.filter((w) => w.alpha > 0).length / W8.length;
  let negStreak = 0;
  for (let i = weeksAll.length - 1; i >= 0 && weeksAll[i].alpha < 0; i--) negStreak++;
  const ma4 = weeksAll.slice(-4).reduce((s, w) => s + w.alpha, 0) / 4;
  let ma4Pct = null; // 历史分位动态阈值：当前 4 周均值在全史 4 周均值分布中的分位
  if (weeksAll.length >= 12) {
    const hist = [];
    for (let i = 3; i < weeksAll.length; i++) hist.push(weeksAll.slice(i - 3, i + 1).reduce((s, w) => s + w.alpha, 0) / 4);
    ma4Pct = hist.filter((v) => v <= ma4).length / hist.length;
  }
  const pctTxt = ma4Pct == null ? '—' : (ma4Pct * 100).toFixed(0) + '%';

  const reasons = [];
  if (negStreak >= 2) reasons.push(`连续 ${negStreak} 周负超额`);
  if (alphaWinRate8 < ALARM_WIN) reasons.push(`8 周超额胜率 ${(alphaWinRate8 * 100).toFixed(0)}% < 48%`);
  if (ma4Pct != null && ma4Pct < MA4_PCT && ma4 < 0) reasons.push(`4 周均值alpha ${(ma4 * 100).toFixed(2)}% 低于全史 30 分位（${pctTxt}）且为负——曲线拐头向下`);
  if (reasons.length) return { status: 'alarm', headline: '❌ 告警：' + reasons.join('；'), alphaWinRate8, negStreak, ma4Pct };

  const warns = [];
  if (alphaWinRate8 < HEALTHY_WIN) warns.push(`8 周超额胜率 ${(alphaWinRate8 * 100).toFixed(0)}% 落入 48%~52% 观察带`);
  if (last.alpha < 0) warns.push('单周超额转负');
  if (ma4Pct != null && ma4Pct < MA4_PCT) warns.push(`4 周均值alpha 低于全史 30 分位（${pctTxt}）——曲线走平/转弱`);
  if (warns.length) return { status: 'watch', headline: '⚠️ 观察：' + warns.join('；'), alphaWinRate8, negStreak, ma4Pct };

  if (last.alpha >= 0 && alphaWinRate8 >= HEALTHY_WIN && negStreak === 0) {
    return { status: 'healthy', headline: `✅ 健康：超额正向、胜率 ${(alphaWinRate8 * 100).toFixed(0)}% ≥52%、无连续负超额`, alphaWinRate8, negStreak, ma4Pct };
  }
  return { status: 'watch', headline: `⚠️ 观察：未达健康标准（最新周超额 ${last.alpha >= 0 ? '正' : '负'}、胜率 ${(alphaWinRate8 * 100).toFixed(0)}%、连续负 ${negStreak} 周）`, alphaWinRate8, negStreak, ma4Pct };
}

export function regimeBreakdown(weeksAll, labelOf) {
  const g = {};
  for (const w of weeksAll) (g[w.regime] ||= []).push(w.alpha);
  return Object.entries(g).sort((x, y) => y[1].length - x[1].length).map(([k, arr]) => ({
    regime: k,
    label: labelOf ? labelOf(k) : k,
    weeks: arr.length,
    avgAlpha: +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(6),
    winRate: +(arr.filter((v) => v > 0).length / arr.length).toFixed(3),
  }));
}
