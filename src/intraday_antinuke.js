// 冰点试错仓「反核」预警（2026-10-30·挂件三配套预警模式，最小落地路径）
// ─────────────────────────────────────────────────────────────────────────────
// 设计纪律（与老板拍板一致）：
//   · 不碰回测引擎：paper.js 日频逻辑保持不变，-10% 硬止损兜底仍作日线级兜底。
//   · 仅做「预警」：检测地天板特征后发独立企微预警，交人工核验，绝不在盘中点自动下单。
//   · 复用现有快照基础设施：scripts/fetch_intraday_quotes.mjs 实际取 K线分片当日 bar 的
//     {open,high,low,close,prevClose}（盘中实时抓取已废弃）。故以 low 作「日内深跌谷」、
//     close 作「翻红」判据——等价于「跌幅>5% 后翻红」的地天板特征，且无需新增网络调用。
//   · fail-open：缺快照/缺字段/无 ice-trial 持仓 → 静默跳过，绝不阻塞下游管道。
//
// ⚠ 数据源局限：当前快照是日终 K线（非盘中实时），故预警在 K线更新后（收盘附近）触发，
//   而非严格盘中秒级。若要真·盘中告警，需另启「仅针对 ice-trial 持仓的轻量实时行情轮询」
//   （已与老板确认：高频数据源不支持，本版先用日终 OHLC 兜底，逻辑与阈值完全一致）。
// ─────────────────────────────────────────────────────────────────────────────

export const ANTINUKE_DROP_PCT = -5;   // 日内曾跌超 5%（接近跌停/深跌）才计入反核候选

/**
 * 取账户中需要监控反核的持仓代码：冰点试错仓(iceTrial) 或 已开反核(antiNuke) 的标的。
 * @param {object} account 纸账户（data/paper/account.json），含 positions
 * @returns {string[]} 代码数组（去重、转字符串）
 */
export function iceTrialCodes(account) {
  const pos = (account && account.positions && typeof account.positions === 'object') ? account.positions : {};
  const out = [];
  for (const [code, p] of Object.entries(pos)) {
    if (!p) continue;
    if (p.iceTrial === true || p.antiNuke === true) out.push(String(code));
  }
  return out;
}

/**
 * 检测单票是否构成「反核」特征：日内曾跌超阈值(深跌谷 low) 且 收盘翻红(close > prevClose)。
 * @param {{low?:number,close?:number,prevClose?:number}} q 含 OHLC 的快照
 * @param {{dropPct?:number}} [opts] dropPct 默认 -5
 * @returns {{triggered:boolean, lowChgPct:number|null, closeChgPct:number|null}}
 */
export function detectAntiNuke(q, { dropPct = ANTINUKE_DROP_PCT } = {}) {
  if (!q || q.low == null || q.prevClose == null || q.close == null) {
    return { triggered: false, lowChgPct: null, closeChgPct: null };
  }
  const pc = q.prevClose;
  if (!(pc > 0)) return { triggered: false, lowChgPct: null, closeChgPct: null };
  const lowChgPct = (q.low - pc) / pc * 100;
  const closeChgPct = (q.close - pc) / pc * 100;
  // 地天板特征：盘中曾跌超阈值(深跌谷) + 收盘翻红(>0)
  const triggered = lowChgPct <= dropPct && closeChgPct > 0;
  return { triggered, lowChgPct: Math.round(lowChgPct * 100) / 100, closeChgPct: Math.round(closeChgPct * 100) / 100 };
}

/**
 * 反核监控主流程（纯函数，便于单测；IO 由调用方负责）。
 * @param {object} args
 * @param {object} args.account 纸账户
 * @param {Array<{code,name?,low?,close?,prevClose?}>} args.quotes 快照列表（含 OHLC）
 * @param {object} [args.state] 已告警去重态 { 'code@date': true }
 * @param {string} args.date 交易日期(YYYY-MM-DD)
 * @returns {{alerts:Array<object>, state:object}} alerts=待推送企微事件; state=更新后去重态
 */
export function runAntiNukeMonitor({ account, quotes, state = {}, date }) {
  const codes = new Set(iceTrialCodes(account));
  const byCode = {};
  for (const q of (Array.isArray(quotes) ? quotes : [])) {
    if (q && q.code != null) byCode[String(q.code)] = q;
  }
  const nextState = { ...state };
  const alerts = [];
  for (const code of codes) {
    const q = byCode[code];
    if (!q) continue;                         // 缺快照 → 跳过(fail-open)
    const r = detectAntiNuke(q);
    if (!r.triggered) continue;
    const key = `${code}@${date}`;
    if (nextState[key]) continue;             // 当日已告警 → 去重，避免重复推送
    nextState[key] = true;
    const name = q.name || code;
    alerts.push({
      severity: 'warn',
      kind: 'antinuke-reversal',
      source: 'intraday',
      detail: `🚨 [反核预警] 持仓票 ${name}(${code}) 日内最低 ${r.lowChgPct}% 后翻红至 +${r.closeChgPct}%，疑似跌停撬板翻红，请人工核验盘口是否介入反核或减仓离场！`,
    });
  }
  return { alerts, state: nextState };
}
