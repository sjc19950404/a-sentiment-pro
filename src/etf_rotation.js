// ── 红包ETF轮动策略（纯逻辑，零实盘 / 零网络 / 零文件 IO）──────────────────────
//
// 标的：红利低波ETF(510880) + 沪深300ETF(510300) 双轮动。
//
// 规则（用户 2026-10-27 拍板）：
//   · 每周五收盘跑一次动量评估：谁近 20 天涨得好（区间收益高），就持有谁。
//   · 当 V5.2 情绪系统判定「强制空仓」（仓位上限 = 0 / 硬止损触发）时，主策略不交易，
//     闲置资金自动买入这俩 ETF 避险——即按动量择优，把空仓期现金变成低波/宽基敞口。
//   · 非强制空仓时，本策略完全不参与（不挤占主策略的股票仓位）——它只负责「空仓避险仓」的构建。
//
// 设计纪律：本模块全为纯函数，输入价序列与系统决策，输出目标配置；不读文件、不发请求、
//   不落单。接入实盘（下单/调度）由上层脚本负责，且必须只在用户显式授权后——本文件
//   永不触达交易 API。测试见 test/etf_rotation.test.mjs（合成数据，无外部依赖）。

export const ETF_OPTIONS = { '510880': '红利低波ETF', '510300': '沪深300ETF' };
export const ETF_CODES = Object.keys(ETF_OPTIONS);
export const DEFAULT_LOOKBACK = 20;   // 动量回看交易日数
export const ROTATION_WEEKDAY = 5;    // 5 = 周五（Date.getDay 约定；Node/浏览器一致）

// 纯展示助手：小数 → 百分比字符串（与 push_text.js::pct 同款；本模块零 import 自包含）
const pct = (v) => (v == null || !Number.isFinite(v)) ? '—' : `${(v * 100).toFixed(2)}%`;

// ── ① 动量收益：近 lookback 个交易日的区间收益（首→尾），价序列为升序收盘价数组 ──
export function momentumReturn(prices, lookback = DEFAULT_LOOKBACK) {
  if (!Array.isArray(prices) || prices.length === 0) return null;
  const n = Math.min(lookback, prices.length);
  const start = prices[prices.length - n];
  const end = prices[prices.length - 1];
  if (start == null || end == null || start === 0) return null;
  return (end - start) / start;
}

// ── ② 双 ETF 动量择优：返回各标的收益与赢家（收益高者；并列取 510880；缺数据则另一只好）──
export function pickEtfByMomentum(pricesMap, lookback = DEFAULT_LOOKBACK) {
  const returns = {};
  for (const code of ETF_CODES) {
    returns[code] = momentumReturn(pricesMap && pricesMap[code], lookback);
  }
  const a = returns['510880'];
  const b = returns['510300'];
  let winner = null;
  if (a != null && b != null) winner = a >= b ? '510880' : '510300';
  else if (a != null) winner = '510880';
  else if (b != null) winner = '510300';
  return { returns, winner };
}

// ── ③ 是否「强制空仓」：V5.2 情绪系统判定无股票仓位时触发（仓位上限 ≤ 0 或硬止损）──
//   positionCap：系统给出的单票/总仓位上限（0~1），0 = 强制空仓；
//   hardStop：熔断/硬止损标志（一旦触发，无论仓位如何都按空仓避险）。
export function isForcedClose({ positionCap = null, hardStop = false } = {}) {
  if (hardStop) return true;
  return positionCap != null && positionCap <= 0;
}

// ── ④ 是否为轮动评估日（周五收盘）——纯日期判断，注入 now 便于测试 ──
//   now 可为 Date / 时间戳 / 日期串 / 含 getDay() 的伪对象（测试注入），全部兼容。
export function isEvaluationDay(now = new Date()) {
  const day = (now && typeof now.getDay === 'function') ? now.getDay() : new Date(now).getDay();
  return day === ROTATION_WEEKDAY;
}

// ── ⑤ 核心：给定系统决策 + 双 ETF 价序列 + 日期，产出避险仓目标配置（绝不落单）──
//   @param {{forcedClose:boolean, pricesMap?:Record<string,number[]>, lookback?:number, now?:Date|string}} arg
//   @returns {{active:boolean, hedge:'510880'|'510300'|'both'|null, reason:string, momentum:object|null}}
//
//   语义：
//     · 非强制空仓 → 避险仓不参与（active:false，主策略在交易）。
//     · 强制空仓 → 用动量择优持有赢家 ETF；动量数据不足（两标的都缺）则等权持双 ETF 兜底避险。
//     · evalToday 仅用于文案（周五=动量再平衡日，其余日=沿用动量结论），不影响"是否避险"判定。
export function decideEtfHedge({ forcedClose, pricesMap, lookback = DEFAULT_LOOKBACK, now = new Date() } = {}) {
  const evalToday = isEvaluationDay(now);
  if (!forcedClose) {
    return { active: false, hedge: null, reason: '主策略在交易，避险仓不参与（不挤占股票仓位）', momentum: null };
  }
  const { returns, winner } = pickEtfByMomentum(pricesMap, lookback);
  if (!winner) {
    return {
      active: true, hedge: 'both',
      reason: `强制空仓；双 ETF 动量数据均不足，等权持双 ETF（${ETF_OPTIONS['510880']}+${ETF_OPTIONS['510300']}）兜底避险`,
      momentum: { returns, winner },
    };
  }
  return {
    active: true, hedge: winner,
    reason: `强制空仓；${evalToday ? '周五动量再平衡' : '沿用动量结论'}，择优持有${ETF_OPTIONS[winner]}（近${lookback}日收益 ${pct(returns[winner])}）`,
    momentum: { returns, winner },
  };
}

// ── ⑥ 报告文本（只读、供推送/页面展示，不含任何交易指令）────────────────────────
export function formatHedgeReport(decision) {
  if (!decision || !decision.active) return decision ? decision.reason : '—';
  const name = decision.hedge === 'both' ? `${ETF_OPTIONS['510880']}+${ETF_OPTIONS['510300']}`
    : ETF_OPTIONS[decision.hedge];
  return `${decision.reason} → 避险标的：${name}`;
}
