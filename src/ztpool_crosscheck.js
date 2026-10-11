// 情绪类数据跨源对账 · 纯函数层（2026-10-11）· 可单测、fetch 无关
//
// 为什么要有这一层：本项目的"多源降级"在涨停池上是**假的**——主源（东财 push2ex）
// 与"第一备源"（AkShare zt_pool）请求同一个 URL（akshare/stock_feature/stock_ztb_em.py:33），
// 实为单点；2026-08-14~09-03 那 14 天"主源与备源均失败"即此。真正的第二只眼睛是
// `market_data.derive_zt_from_snapshot()`（自有快照 + 涨跌幅公式自建，上游与东财无关）。
//
// 本文件只做**判定**，不做采集、不发通知、不写盘——IO 与告警由调用方（scripts/ 层）编排。
// 语义与 cross_check_volume.js 一致：纯观测，**不拦 build**（观察者不是门禁，红只属于守卫）。
//
// ⚠ 两条纪律（详见 docs/data_discipline.md）：
//   ① 对账源 ≠ 备源：自建池字段不全（无 fbt/fund/zb/lbc），只能比对，不能顶替；
//   ② 口径不同不可直接比：东财池覆盖全 A（含北交所），自建池只覆盖自有快照 universe
//      （沪深 A）——故只在**两边交集**内比对，避免"快照没有北交所"被算成差异。

/** 代码归一：去市场前缀与非数字（'sh600000' / '600000.SH' → '600000'）。 */
export const normCode = (c) => String(c ?? '').replace(/\D/g, '');

const setOf = (arr) => new Set((Array.isArray(arr) ? arr : []).map(normCode).filter(Boolean));

export const ZT_RULES = {
  COUNT_DIFF: 3,        // 家数绝对差阈值（只）
  LIST_DIVERGE: 0.05,   // 名单对称差率阈值（对称差 / 并集）
  MIN_UNIVERSE: 500,    // 对账源样本下限——快照样本太少则不比（避免拿残快照下结论）
};

export const BREADTH_RULES = {
  RATIO_DIFF: 8,        // 上涨占比差阈值（百分点）；⚠ 待真实交易日标定（见下）
};

/**
 * 涨停池跨源对账（主源 东财池 vs 对账源 自建池）。
 *
 * @param {object} o
 * @param {object|null} o.primary  主源 { zt_count?:number, zt_codes?:string[] }
 * @param {object|null} o.derived  自建 { zt_count?:number, zt_codes?:string[], universe?:number }
 * @param {object} [o.rules] ZT_RULES
 * @returns {{ok:boolean, verdict:'PASS'|'WARN'|'UNAVAILABLE', reason:string|null,
 *   primaryCount:number|null, derivedCount:number|null, countDiff:number|null,
 *   divergeRate:number|null, onlyPrimary:string[], onlyDerived:string[], comparable:number}}
 */
export function ztPoolCrosscheck({ primary = null, derived = null, rules = ZT_RULES } = {}) {
  const base = { ok: false, verdict: 'UNAVAILABLE', reason: null, primaryCount: null,
    derivedCount: null, countDiff: null, divergeRate: null, onlyPrimary: [], onlyDerived: [], comparable: 0 };

  const pCodes = setOf(primary?.zt_codes);
  const pCount = Number.isFinite(primary?.zt_count) ? primary.zt_count : (pCodes.size || null);
  if (pCount == null) return { ...base, reason: '主源涨停池不可用（东财池缺失）——无法对账' };

  if (!derived || !Number.isFinite(derived.zt_count)) {
    return { ...base, primaryCount: pCount, reason: '对账源不可用（自有快照未产出自建池）——无法对账' };
  }
  const universe = Number(derived.universe ?? 0);
  if (universe < rules.MIN_UNIVERSE) {
    return { ...base, primaryCount: pCount, derivedCount: derived.zt_count,
      reason: `对账源样本不足（快照 ${universe} 只 < ${rules.MIN_UNIVERSE}）——残快照不比对，避免假告警` };
  }

  const dCodes = setOf(derived.zt_codes);
  // 北交所票（8/4/920 段）不在自有快照 universe 内：东财池含它们，自建池不可能有。
  // 不剔除就会被算进"仅主源有" → 名单差异率虚高 → **假告警**（纪律②：口径不同不可直接比）。
  // 剔除后单独报告 excludedBj，保证剔除行为透明（不静默改数）。
  const isBj = (c) => /^(8|4|920)/.test(c);
  const pEff = new Set([...pCodes].filter((c) => !isBj(c)));
  const excludedBj = pCodes.size - pEff.size;
  const unionSet = new Set([...pEff, ...dCodes]);
  let inter = 0;
  for (const c of unionSet) if (pEff.has(c) && dCodes.has(c)) inter += 1;
  const symDiff = pEff.size + dCodes.size - inter * 2;
  const divergeRate = unionSet.size > 0 ? symDiff / unionSet.size : 0;
  const countDiff = Math.abs(pEff.size - derived.zt_count);
  const onlyPrimary = [...pEff].filter((c) => !dCodes.has(c));
  const onlyDerived = [...dCodes].filter((c) => !pEff.has(c));

  const bad = countDiff > rules.COUNT_DIFF || divergeRate > rules.LIST_DIVERGE;
  const out = {
    ok: !bad, verdict: bad ? 'WARN' : 'PASS', reason: null,
    primaryCount: pEff.size, primaryCountRaw: pCount, excludedBj,
    derivedCount: derived.zt_count,
    countDiff, divergeRate: +divergeRate.toFixed(4),
    onlyPrimary, onlyDerived, comparable: inter,
  };
  if (bad) {
    out.reason = `涨停池跨源不一致：家数差 ${countDiff} 只（主 ${pEff.size} vs 自建 ${derived.zt_count}`
      + `${excludedBj ? `，主源含北交所 ${excludedBj} 只已剔除` : ''}），`
      + `名单差异率 ${(divergeRate * 100).toFixed(1)}%（阈值 家数 ${rules.COUNT_DIFF} / 差异率 ${rules.LIST_DIVERGE * 100}%）；`
      + `仅主源有 ${onlyPrimary.length} 只，仅自建有 ${onlyDerived.length} 只`;
  }
  return out;
}

/**
 * 涨跌家数跨口径对账（快照派生 沪深A vs legu 全A）。
 *
 * ⚠ 口径不同：快照只数沪深 A（约 3558），legu 统计全 A（约 5224，含北交所）。
 *   **不能直接比绝对值**——那是把两个不同的东西硬比（纪律②）。可比的是：
 *     ① 涨跌方向（up vs down 谁多）→ 方向相反必有一侧错；
 *     ② 上涨占比（up / (up+down+flat)）→ 整体分布应大致接近。
 *
 * @param {object} o { snap?:{up,down,flat}, legu?:{up,down,flat}, rules? }
 * @returns {{ok, verdict, reason, snapUpRatio, leguUpRatio, ratioDiffPct, directionFlip}}
 */
export function breadthCrosscheck({ snap = null, legu = null, rules = BREADTH_RULES } = {}) {
  const base = { ok: false, verdict: 'UNAVAILABLE', reason: null,
    snapUpRatio: null, leguUpRatio: null, ratioDiffPct: null, directionFlip: false };

  const ratio = (b) => {
    const u = Number(b?.up), d = Number(b?.down), f = Number(b?.flat ?? 0);
    const tot = (Number.isFinite(u) ? u : 0) + (Number.isFinite(d) ? d : 0) + (Number.isFinite(f) ? f : 0);
    if (!Number.isFinite(u) || !Number.isFinite(d) || tot <= 0) return null;
    return { r: u / tot * 100, flip: null, dir: u > d ? 'up' : (u < d ? 'down' : 'flat') };
  };
  const s = ratio(snap), l = ratio(legu);
  if (!s || !l) {
    return { ...base, reason: '涨跌家数对账源不可用（快照派生或 legu 缺失）——无法对账' };
  }
  const directionFlip = (s.dir === 'up' && l.dir === 'down') || (s.dir === 'down' && l.dir === 'up');
  const ratioDiffPct = Math.abs(s.r - l.r);
  const bad = directionFlip || ratioDiffPct > rules.RATIO_DIFF;
  const out = {
    ok: !bad, verdict: bad ? 'WARN' : 'PASS', reason: null,
    snapUpRatio: +s.r.toFixed(2), leguUpRatio: +l.r.toFixed(2),
    ratioDiffPct: +ratioDiffPct.toFixed(2), directionFlip,
  };
  if (bad) {
    out.reason = directionFlip
      ? `涨跌方向相反（快照 沪深A：${s.dir === 'up' ? '涨多' : '跌多'} vs legu 全A：${l.dir === 'up' ? '涨多' : '跌多'}）——必有一侧采集错误`
      : `上涨占比差 ${out.ratioDiffPct} 个百分点（快照 ${out.snapUpRatio}% vs legu ${out.leguUpRatio}%，阈值 ${rules.RATIO_DIFF}）`;
  }
  return out;
}

/** 对账结果 → 企微事件（opsalerts 通道；PASS 静默不发）。 */
export function ztCrosscheckEvent(result, kind = 'ztpool', { at = new Date().toISOString() } = {}) {
  const label = kind === 'breadth' ? '涨跌家数' : '涨停池';
  const lines = [`${label}跨源对账异常：${result.reason}`];
  if (kind === 'breadth') {
    lines.push(`快照(沪深A)涨占比｜${result.snapUpRatio}%`);
    lines.push(`legu(全A)涨占比｜${result.leguUpRatio}%`);
  } else {
    lines.push(`主源(东财)｜${result.primaryCount} 只`);
    lines.push(`自建(快照)｜${result.derivedCount} 只`);
    if (result.onlyPrimary?.length) lines.push(`仅主源｜${result.onlyPrimary.slice(0, 5).join(',')}${result.onlyPrimary.length > 5 ? '…' : ''}`);
    if (result.onlyDerived?.length) lines.push(`仅自建｜${result.onlyDerived.slice(0, 5).join(',')}${result.onlyDerived.length > 5 ? '…' : ''}`);
  }
  return { at, severity: 'error', kind: 'cross-check', source: kind, detail: lines.join('\n') };
}
