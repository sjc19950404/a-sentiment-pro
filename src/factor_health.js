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

// extra（2026-11-09 仪表升级 5 针，可选）：
//   seatWeeks: 席位对照周序列（src/seat_factor_alpha.js）——告警【席位因子失效预警】：
//     连续 ≥2 周 seatAlpha ≤ SEAT_ALARM（-5pp，provisional 初值——全史平均 +1.1pp，
//     -5pp 已显著劣于均值；跑足更多样本后人工复标）。
//   divergWeeks: 分歧尺周序列（退化规则，见 scripts/factor_health.mjs）——
//     【博弈生态异动预警】：周分歧率 ≥ P95 或 ≥3×前4周中位（且 ≥P90）；
//     观察：≥ P90。分位数从 divergWeeks 自身历史算（历史分位动态阈值）。
//   sharpe8: 最近 8 周策略年化夏普（仅展示，不参与判定）。
const SEAT_ALARM = -0.05; // provisional：席位增量显著转负阈值（pp 小数），人工复标后更新
export function judge(weeksAll, extra = {}) {
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
  // 第 4 针：席位因子增量 Alpha（对照变体，src/seat_factor_alpha.js）
  let seatAlarm = false, seatNote = null;
  if (extra.seatWeeks && extra.seatWeeks.length) {
    const sw = extra.seatWeeks.slice(-2);
    const bothNeg = sw.length === 2 && sw.every((w) => w.seatAlpha != null && w.seatAlpha <= SEAT_ALARM);
    if (bothNeg) {
      seatAlarm = true;
      seatNote = `【席位因子失效预警】席位增量Alpha连续 ${sw.length} 周 ≤ ${(SEAT_ALARM * 100).toFixed(0)}pp（${sw.map((w) => (w.seatAlpha * 100).toFixed(1) + 'pp').join('、')}）——席位过滤的价值消失（provisional 阈值 ${(SEAT_ALARM * 100).toFixed(0)}pp，人工复标后更新）`;
      reasons.push(seatNote);
    }
  }
  // 第 5 针：分歧频率（生态哨兵，单独阈值）
  let divAlarm = false, divNote = null;
  if (extra.divergWeeks && extra.divergWeeks.length >= 12) {
    const rates = extra.divergWeeks.map((w) => w.rate);
    const sorted = [...rates].sort((x, y) => x - y);
    const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
    const cur = extra.divergWeeks[extra.divergWeeks.length - 1];
    const prev = extra.divergWeeks.slice(-5, -1);
    const med = prev.length ? [...prev.map((x) => x.rate)].sort((x, y) => x - y)[Math.floor(prev.length / 2)] : null;
    if (cur.rate >= q(0.95) || (med != null && med > 0 && cur.rate >= 3 * med && cur.rate >= q(0.9))) {
      divAlarm = true;
      divNote = `【博弈生态异动预警】本周分歧频率 ${(cur.rate * 100).toFixed(0)}%（P95=${(q(0.95) * 100).toFixed(0)}%${med != null ? `，前4周中位 ${(med * 100).toFixed(0)}%` : ''}）——结构尺与情绪尺分歧密集，警惕生态突变/制度冲击`;
      reasons.push(divNote);
    }
  }
  if (reasons.length) return { status: 'alarm', headline: '❌ 告警：' + reasons.join('；'), alphaWinRate8, negStreak, ma4Pct, seatAlarm, divAlarm, seatNote, divNote };

  const warns = [];
  if (alphaWinRate8 < HEALTHY_WIN) warns.push(`8 周超额胜率 ${(alphaWinRate8 * 100).toFixed(0)}% 落入 48%~52% 观察带`);
  if (last.alpha < 0) warns.push('单周超额转负');
  if (ma4Pct != null && ma4Pct < MA4_PCT) warns.push(`4 周均值alpha 低于全史 30 分位（${pctTxt}）——曲线走平/转弱`);
  // 分歧观察带（不达告警但 ≥P90）
  let divWatch = false;
  if (extra.divergWeeks && extra.divergWeeks.length >= 12) {
    const rates = extra.divergWeeks.map((w) => w.rate);
    const sorted = [...rates].sort((x, y) => x - y);
    const q90 = sorted[Math.floor(0.9 * (sorted.length - 1))];
    const cur = extra.divergWeeks[extra.divergWeeks.length - 1];
    if (cur.rate >= q90 && !divAlarm) { divWatch = true; warns.push(`本周分歧频率 ${(cur.rate * 100).toFixed(0)}% ≥ P90（${(q90 * 100).toFixed(0)}%）——生态观察`); }
  }
  if (warns.length) return { status: 'watch', headline: '⚠️ 观察：' + warns.join('；'), alphaWinRate8, negStreak, ma4Pct, seatAlarm, divAlarm, seatNote, divNote };

  if (last.alpha >= 0 && alphaWinRate8 >= HEALTHY_WIN && negStreak === 0) {
    return { status: 'healthy', headline: `✅ 健康：超额正向、胜率 ${(alphaWinRate8 * 100).toFixed(0)}% ≥52%、无连续负超额`, alphaWinRate8, negStreak, ma4Pct, seatAlarm, divAlarm, seatNote, divNote };
  }
  return { status: 'watch', headline: `⚠️ 观察：未达健康标准（最新周超额 ${last.alpha >= 0 ? '正' : '负'}、胜率 ${(alphaWinRate8 * 100).toFixed(0)}%、连续负 ${negStreak} 周）`, alphaWinRate8, negStreak, ma4Pct, seatAlarm, divAlarm, seatNote, divNote };
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
