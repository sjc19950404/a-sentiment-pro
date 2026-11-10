/**
 * 首板晋级分析（2026-11-11 用户拍板：企微推送加观察段 + 观察档，不接闸）。
 *
 * 三个纯函数，全部只读输入、不落任何档：
 *   · advanceStats(days)      —— 分层晋级率基率（T 日首板 → T+1 同票 lbc≥2 判晋级）
 *   · pickAdvanceCandidates() —— 今日首板按高晋级特征筛候选（早板+强封单+零炸板）
 *   · settleCandidates()      —— 昨日候选对账（回填 advanced）
 *
 * 纪律（拍板边界固化）：
 *   · 晋级率是**基础比率（base rate）**，输出一律附「基率非预测」语义，禁止表述为个股预测；
 *   · 观察档只记账不下单：不生成委托、不冻结资金、不进自动建仓（B2 接闸须再拍板）；
 *   · 数据缺失不造数：fbt/fund/ltsz 缺失的票不进候选（宁缺毋滥），分层样本 <5 不出率。
 */

/** 封板时段分层（fbt 东财 HHMMSS：92500=9:25:00）。 */
export const FB_TIER = {
  early: { label: '早板(9:25-10:00)', max: 100000 },
  am: { label: '上午(10:00-11:30)', max: 113000 },
  pm: { label: '下午(13:00-14:00)', max: 140000 },
  tail: { label: '尾板(14:00-15:00)', max: 240000 },
};
/** 封单强度分层（fund/ltsz）。 */
export const FUND_TIER = {
  weak: { label: '<1%', max: 0.01 },
  mid: { label: '1%~3%', max: 0.03 },
  strong: { label: '>=3%', max: Infinity },
};
const MIN_SAMPLE = 5;   // 分层样本 <5 不出率（不造数）
const rate = (n, adv) => (n >= MIN_SAMPLE ? +(adv / n * 100).toFixed(1) : null);

const tierOf = (t, table, key) => {
  for (const [k, v] of Object.entries(table)) if (t < v.max) return key ? k : v.label;
  return null;
};

/**
 * 分层晋级率基率。
 * @param {Array<{date:string,pool:Array}>} days ztpool_history（日期升序）
 * @returns {{total:{n,adv,rate}|null, byFbt:Object, byFund:Object, byZbc:Object, windowDays:number}}
 */
export function advanceStats(days) {
  const acc = { byFbt: {}, byFund: {}, byZbc: { 零炸板: [0, 0], 有炸板: [0, 0] } };
  for (const k of Object.keys(FB_TIER)) acc.byFbt[FB_TIER[k].label] = [0, 0];
  for (const k of Object.keys(FUND_TIER)) acc.byFund[FUND_TIER[k].label] = [0, 0];
  let tot = 0, adv = 0, win = 0;
  for (let i = 0; i < days.length - 1; i++) {
    const cur = days[i], nxt = days[i + 1];
    const firsts = (cur.pool || []).filter((p) => p && p.lbc === 1);
    if (!firsts.length) continue;
    win++;
    const nxtMap = new Map((nxt.pool || []).map((p) => [p.c, p]));
    for (const p of firsts) {
      const n = nxtMap.get(p.c);
      const ok = !!(n && n.lbc >= 2);
      tot++; if (ok) adv++;
      const fbtT = Number.isFinite(+p.fbt) && +p.fbt > 0 ? +p.fbt : null;
      if (fbtT != null) {
        const fk = tierOf(fbtT, FB_TIER, true);
        if (fk) { acc.byFbt[FB_TIER[fk].label][0]++; if (ok) acc.byFbt[FB_TIER[fk].label][1]++; }
      }
      if (Number.isFinite(+p.fund) && +p.fund > 0 && Number.isFinite(+p.ltsz) && +p.ltsz > 0) {
        const rk = tierOf(+p.fund / +p.ltsz, FUND_TIER, true);
        acc.byFund[FUND_TIER[rk].label][0]++; if (ok) acc.byFund[FUND_TIER[rk].label][1]++;
      }
      const zk = (p.zbc || 0) === 0 ? '零炸板' : '有炸板';
      acc.byZbc[zk][0]++; if (ok) acc.byZbc[zk][1]++;
    }
  }
  const pack = (m) => Object.fromEntries(Object.entries(m).map(([k, [n, a]]) => [k, { n, adv: a, rate: rate(n, a) }]));
  return {
    total: tot ? { n: tot, adv, rate: +(adv / tot * 100).toFixed(1) } : null,
    byFbt: pack(acc.byFbt),
    byFund: pack(acc.byFund),
    byZbc: pack(acc.byZbc),
    windowDays: win,
  };
}

/** 候选筛选阈值（2026-11-11 拍板 v1：早板+封单≥3%+零炸板；可经 opts 覆盖）。 */
export const FB_DEFAULTS = { fbtMin: 93000, fbtMax: 100000, fundPctMin: 0.03, zbcMax: 0, cap: 3 };

/**
 * 主板口径（2026-11-11 用户拍板：晋级首板/地天反包**排除科创创业**——
 *   688/689 科创、300/301 创业不进盯盘池/候选/推送；北证与主板保留）。
 * 基率统计（advanceStats）保持全池口径（"全池基率"语义不变，仅运行层排除）。
 */
export function isMainBoardCode(code) {
  const c = String(code || '');
  if (!/^\d{6}$/.test(c)) return false;   // 空/非法码从严：宁可不盯
  return !/^(688|689|300|301)/.test(c);
}

/**
 * 今日首板晋级候选（观察用，禁止表述为买入建议）。
 * 2026-11-11 用户追问补两条排除：①**一字/开盘秒板**（fbt<fbtMin，默认 93000：9:25 竞价
 *   即封死的票买不进，无参与价值）；②科创创业（isMainBoardCode）。
 * @param {Array} pool 今日涨停池
 * @param {object} stats advanceStats 输出（取候选所属分层的基率）
 * @param {object} [opts] { fbtMin, fbtMax, fundPctMin, zbcMax, cap }
 */
export function pickAdvanceCandidates(pool, stats, opts = {}) {
  const th = { ...FB_DEFAULTS, ...opts };
  if (!Array.isArray(pool)) return [];
  const rows = [];
  for (const p of pool) {
    if (!p || p.lbc !== 1) continue;
    if (!isMainBoardCode(p.c)) continue;                                              // 科创创业不进
    if (!Number.isFinite(+p.fbt) || +p.fbt <= 0 || +p.fbt < th.fbtMin) continue;      // 一字/秒板买不进，不进
    if (!Number.isFinite(+p.fbt) || +p.fbt >= th.fbtMax) continue;                    // 非早板不进
    if (!Number.isFinite(+p.fund) || +p.fund <= 0 || !Number.isFinite(+p.ltsz) || +p.ltsz <= 0) continue;
    const fundPct = +p.fund / +p.ltsz;
    if (fundPct < th.fundPctMin) continue;
    if (Number.isFinite(+p.zbc) ? +p.zbc > th.zbcMax : true) continue;              // 炸板数缺失不进
    const tier = tierOf(fundPct, FUND_TIER, true);
    const t = stats && stats.byFund && stats.byFund[FUND_TIER[tier].label];
    rows.push({
      code: String(p.c), name: p.n || p.c,
      fbt: p.fbt, fundPct: +fundPct.toFixed(4), zbc: p.zbc || 0,
      baseRate: t && Number.isFinite(t.rate) ? t.rate : null,   // 该层基率；样本不足 → null 如实
    });
  }
  rows.sort((a, b) => b.fundPct - a.fundPct);
  const main = rows.slice(0, th.cap);
  if (main.length) return main;
  // 降档回退（2026-11-11 实测：≥3% 层全档仅 4% 样本，多数日子主层空）——
  //   取 1%~3% 层最强 ≤2 只，baseRate 如实标该层基率（14.6%），读者可分层对照；
  //   同样要求早板+零炸板，不放水。
  const fallback = [];
  for (const p of pool) {
    if (!p || p.lbc !== 1) continue;
    if (!isMainBoardCode(p.c)) continue;                                              // 科创创业不进
    if (!Number.isFinite(+p.fbt) || +p.fbt <= 0 || +p.fbt < th.fbtMin) continue;      // 一字/秒板不进
    if (!Number.isFinite(+p.fbt) || +p.fbt >= th.fbtMax) continue;
    if (!Number.isFinite(+p.fund) || +p.fund <= 0 || !Number.isFinite(+p.ltsz) || +p.ltsz <= 0) continue;
    const fundPct = +p.fund / +p.ltsz;
    if (fundPct < 0.01 || fundPct >= th.fundPctMin) continue;
    if (Number.isFinite(+p.zbc) ? +p.zbc > th.zbcMax : true) continue;
    const t = stats && stats.byFund && stats.byFund[FUND_TIER.mid.label];
    fallback.push({
      code: String(p.c), name: p.n || p.c,
      fbt: p.fbt, fundPct: +fundPct.toFixed(4), zbc: p.zbc || 0,
      baseRate: t && Number.isFinite(t.rate) ? t.rate : null,
      tier: 'mid',
    });
  }
  fallback.sort((a, b) => b.fundPct - a.fundPct);
  return fallback.slice(0, 2).map((r) => ({ ...r, fallback: true }));
}

/**
 * 候选对账：prev 日候选在 next 日池中是否晋级（同 code 且 lbc≥2）。
 * @returns {Array<{code:string,name:string,advanced:boolean}>}
 */
export function settleCandidates(candidates, nextPool) {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  const nxtMap = new Map((Array.isArray(nextPool) ? nextPool : []).map((p) => [p.c, p]));
  return candidates.map((c) => {
    const n = nxtMap.get(String(c.code));
    return { code: String(c.code), name: c.name || c.code, advanced: !!(n && n.lbc >= 2) };
  });
}
