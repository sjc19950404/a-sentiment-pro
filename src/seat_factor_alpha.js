// 席位因子独立 Alpha——对照变体回算（2026-11-09，外部拍板规格·仪表第 4 针）
// ─────────────────────────────────────────────────────────────────────────────
// 口径（诚实标注）：
// - 候选：当日涨停名单（summary.zt_codes）∩ 席位明细 keys——有席位数据才有对照意义；
//   生产准入（paper 回放）作用于 picks 候选（同源自 zt_codes），此处与生产同构。
// - 组 G（生产）：filterOne 默认（准入①-b/③④全开）→ main 桶 = 通过席位准入。
// - 组 B（对照）：filterOne + skipSeatRules（跳过 ③单票吸金>25% + ④游资独买且集中度
//   >80%；主板限制 ①-b 保留——只隔离席位因子贡献）。
// - 表现度量：T+1 续板率（次日仍在涨停名单）——**单票行情不可得的代理口径**：
//   度量的是席位因子的「信息含量」（通过准入的票次日续板概率是否更高），
//   非真实收益 alpha。单票 kline 数据可得后可升级为 T+1 收益差。
// - 席位增量 seatAlpha = 续板率(含席位) - 续板率(无席位)，周级池聚合（非日均差）。
// - 样本门槛：日候选 ≥ minCandidates 才计入（避免小样本日稀释）。
// 纪律：纯函数零 IO；生产链路不得使用 skipSeatRules（见 lhbfilter.js JSDoc 警告）。

export function seatFactorWeeks(days, { filterOne, weekKey, minCandidates = 3 }) {
  const ztOf = new Map(days.map((d) => [d.trade_date, new Set((d.summary?.zt_codes || []).map(String))]));
  const acc = new Map(); // weekKey → { end, nDays, passSeat, contSeat, passBase, contBase }
  for (let i = 0; i < days.length - 1; i++) {
    const d = days[i];
    const next = days[i + 1];
    if (!next.trade_date || next.trade_date === d.trade_date) continue;
    const ztNext = ztOf.get(next.trade_date);
    const seat = d.summary?.seats?.detail;
    if (!ztNext || !seat) continue;
    const seatKeys = new Set(Object.keys(seat).map(String));
    const cands = (d.summary?.zt_codes || []).map(String).filter((c) => seatKeys.has(c));
    if (cands.length < minCandidates) continue;

    let passSeat = 0, contSeat = 0, passBase = 0, contBase = 0;
    for (const c of cands) {
      const fG = filterOne(c, d, {});
      if (fG.bucket === 'main') { passSeat++; if (ztNext.has(c)) contSeat++; }
      const fB = filterOne(c, d, { skipSeatRules: true });
      if (fB.bucket === 'main') { passBase++; if (ztNext.has(c)) contBase++; }
    }
    if (passBase + passSeat === 0) continue;
    const wk = weekKey(d.trade_date);
    const w = acc.get(wk) || { week: wk, end: d.trade_date, nDays: 0, passSeat: 0, contSeat: 0, passBase: 0, contBase: 0 };
    w.end = d.trade_date;
    w.nDays++;
    w.passSeat += passSeat; w.contSeat += contSeat;
    w.passBase += passBase; w.contBase += contBase;
    acc.set(wk, w);
  }
  return [...acc.values()].sort((x, y) => (x.week < y.week ? -1 : 1)).map((w) => {
    const rateSeat = w.passSeat ? w.contSeat / w.passSeat : null;
    const rateBase = w.passBase ? w.contBase / w.passBase : null;
    return {
      ...w,
      rateSeat: rateSeat == null ? null : +rateSeat.toFixed(4),
      rateBase: rateBase == null ? null : +rateBase.toFixed(4),
      seatAlpha: rateSeat != null && rateBase != null ? +(rateSeat - rateBase).toFixed(4) : null,
    };
  });
}
