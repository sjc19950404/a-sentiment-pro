// ── 主线守卫 / 极寒分化惩罚（V5.3 核心引擎调优，2026-10-28）────────────────────
//
// 定位：纯函数集合，浏览器 / Node 双端共用、零 IO、零副作用、不改任何输入对象。
//   依赖只在本文件内闭环（不 import fs / 不 import backtest / 不 import paper），以同时满足：
//   ① 浏览器侧 ai_report.js 可安全 import（不污染 S3 包体，也不会把 Node 专用模块拉进前端）；
//   ② 选股引擎 picks.js 经由 recommendPicks 的 ctx 消费结论，无需反向依赖本文件以外的重模块。
//
// 铁律（用户硬性约束，与 src/ai_report.js 的「只搬运不重算 / 缺失即 null」纪律同源）：
//   1. 所有标记 / 分数 / 状态改写只作用于「本次实时计算结果」的克隆体；
//   2. 原始归档（archive.json）、历史 K 线、原始题材列表一律只读；
//   3. 仅约束当日仓位建议与候选池推送，绝不改动历史回测底层原始数据。

// ═══════════════════════════════ 配置常量（抽顶层，方便后续回测调参） ═══════════════════════════════
// 扣分阈值统一出处，避免散落魔数导致多处口径不同步（口径守卫的同源原则）。
// 2026-10-28 起改读 config.json（params.live.stops），带 fallback 常量——既支持控制台热更新，
//   又保证 config 缺失/解析失败时引擎仍可降级运行（绝不带病）。
import config from './config.js';
const _liveStops = (config && config.params && config.params.live && config.params.live.stops) || {};
export const SENTIMENT_PENALTY = Number.isFinite(+_liveStops.sentimentPenalty) ? +_liveStops.sentimentPenalty : 10; // 极寒分化触发时从情绪分扣除的基础分
export const CLUSTER_RISE_COUNT_MAX = Number.isFinite(+_liveStops.clusterRiseMax) ? +_liveStops.clusterRiseMax : 1500; // 上涨家数硬阈值：低于此值视为「极少数票在涨」
export const CLUSTER_RED_INDUSTRY_RATIO_MAX = 0.10;   // 红盘行业占比硬阈值：低于此值视为「绝大多数行业下跌」（未入控制台，固定）

// ═══════════════════════════════ 补丁一：极寒分化惩罚（防妖股抱团假回暖） ═══════════════════════════════
/**
 * 极寒分化惩罚：判断当日是否处于「少数妖股抱团、绝大多数板块与个股下跌」的虚假回暖结构。
 * 该结构下即便涨停家数好看，也不属于真实情绪回暖（抱团分化，取消回暖/高潮判定）。
 *
 * 触发条件（两条件同时成立）：
 *   · 上涨家数 < CLUSTER_RISE_COUNT_MAX（1500）
 *   · 红盘行业占比 < CLUSTER_RED_INDUSTRY_RATIO_MAX（0.10）
 *
 * ⚠ 数据不可变：本函数只读入参数值，返回一个新对象 { isClusteringBubble, penalty }，
 *   绝不修改调用方的 day / signals / 任何原始归档对象。任一输入缺失（null）→ 保守判定为
 *   false（未知即不降级），避免无源时误伤正常回暖。
 *
 * @param {{upCount?:number, redIndustryRatio?:number, riseCountMax?:number, penaltyOverride?:number}} m
 *   上涨家数、红盘行业占比；可选覆盖 riseCountMax / penaltyOverride（供沙盒推演用新参数而不写盘）。
 * @returns {{isClusteringBubble:boolean, penalty:number}}
 */
export function detectClusteringBubble({ upCount, redIndustryRatio, riseCountMax, penaltyOverride } = {}) {
  const rise = Number.isFinite(upCount) ? upCount : null;
  const red = Number.isFinite(redIndustryRatio) ? redIndustryRatio : null;
  // 可选覆盖（沙盒推演）：未传则用 config 同步的常量；保证默认行为与线上一致。
  const riseMax = Number.isFinite(+riseCountMax) ? +riseCountMax : CLUSTER_RISE_COUNT_MAX;
  const penalty = Number.isFinite(+penaltyOverride) ? +penaltyOverride : SENTIMENT_PENALTY;
  // 两条件同时成立才判定为抱团分化泡沫；任一缺失（null）→ 保守为 false
  const isClusteringBubble = rise != null && red != null
    && rise < riseMax
    && red < CLUSTER_RED_INDUSTRY_RATIO_MAX;
  return {
    isClusteringBubble,
    // 仅当触发时返回扣分（正数），调用方从情绪分里减去；未触发返回 0（无扣分）
    penalty: isClusteringBubble ? penalty : 0,
  };
}

/**
 * 补丁一「降级 / 扣分」是否真正生效（用户收紧调参·2026-10-28·第二种方案）：
 *   仅在「原 regime 已被判定为 recover(回暖) 或 climax(高潮)」且「触发极寒分化」时，才执行强制降级与扣分；
 *   若为 neutral / ebb / ice 等本就保守的周期，不额外降级（本来就不允许重仓），避免无差别攻击、变成缩头乌龟。
 * 纯函数，不修改任何对象。
 *
 * @param {boolean} isClusteringBubble 极寒分化检测结果
 * @param {string} [regimeKey] 当日情绪周期 key
 * @returns {boolean}
 */
export function penaltyApplies(isClusteringBubble, regimeKey) {
  return isClusteringBubble && (regimeKey === 'recover' || regimeKey === 'climax');
}

/**
 * 红盘行业占比：day.industry（[{name, change_pct}, ...]）中涨跌幅 > 0 的行业占比。
 * 无行业明细（null / 空数组）→ 返回 null（不可判即不判，调用方据此保守处理，不冒充 0）。
 * 纯函数、只读入参，不修改任何对象。
 *
 * @param {Array<{change_pct?:number}>} [industry]
 * @returns {number|null}
 */
export function computeRedIndustryRatio(industry) {
  if (!Array.isArray(industry) || !industry.length) return null;
  const red = industry.filter((x) => x && Number.isFinite(x.change_pct) && x.change_pct > 0).length;
  return red / industry.length;
}

// ═══════════════════════════════ 补丁二：主线降权过滤（防资金出逃假主线） ═══════════════════════════════
/**
 * 主线降权过滤（深拷贝，不污染原始题材列表）。
 *
 * ⚠ 硬性约束：不原地修改 themeList 内任一原始对象——用 structuredClone 深拷贝后再打标记，
 *   原始题材列表（可能派生自 archive.json 的 day.summary.main_theme / day.themes）始终保持原样，
 *   绝不污染历史数据。
 *
 * 逻辑：取候选主线 rawMain = themeList[0]，克隆生成 candidateMain；若其龙虎榜净额
 *   candidateMain.longHuNet < 0（板块龙虎榜净流出 = 资金出逃的空心题材）→ 标记
 *   isValidMain = false，并将强度 strength 减半（备选方案）；否则标记 isValidMain = true。
 *
 * 业务含义：涨停数量好看，但板块龙虎榜净额为负，属于资金出逃空心题材，不适合隔日接力。
 *
 * @param {Array<object>} themeList 主线候选数组（每项须带 longHuNet；可选 strength）
 * @returns {object|null} 克隆后的主线对象（带 isValidMain 标记）；空列表 / 首项非对象 → null
 */
export function selectMainLine(themeList) {
  if (!Array.isArray(themeList) || !themeList.length) return null;
  const rawMain = themeList[0];
  if (!rawMain || typeof rawMain !== 'object') return null;
  // 深拷贝——原始归档题材对象绝不被改动（数据不可变铁律）
  const candidateMain = structuredClone(rawMain);
  if (Number.isFinite(candidateMain.longHuNet) && candidateMain.longHuNet < 0) {
    candidateMain.isValidMain = false;
    // 备选方案：强度减半（与标记无效并存，进一步压低该空心题材的权重）；非有限值则跳过
    if (Number.isFinite(candidateMain.strength)) candidateMain.strength *= 0.5;
  } else {
    candidateMain.isValidMain = true;
  }
  return candidateMain;
}

/**
 * 题材龙虎榜净额（板块净买入，单位万元）：该题材成分股的龙虎榜净买额之和，作为补丁二的 longHuNet 回退源。
 * 口径与 src/picks.js 的候选构建同源——取当日热点股（day.hot，reason 命中主题名，与 backtest.selectMainLine
 *   的 stocks 过滤同口径 reason.includes(name)），再按其 code 取龙虎榜（day.lhb）的 net_buy_wan 累加。
 * 无龙虎榜数据 / 无命中 → 返回 0（资金面证据缺失，按中性处理，不冒充负值）。
 * 纯函数、只读 day，不修改。
 *
 * 优先使用方：引擎已在 day.summary.main_theme.main_yi（亿元）给出主线净额，调用方应先取
 *   main_yi × 10000；本函数作为「主线名已知、但 main_yi 缺失」时的回退计算。
 *
 * @param {object} day archive 完整日（含 hot / lhb）
 * @param {string} themeName 题材名
 * @returns {number} 板块龙虎榜净买额（万元），缺失 → 0
 */
export function themeLongHuNet(day, themeName) {
  if (!day || !themeName) return 0;
  const name = String(themeName);
  // 龙虎榜净买额按 code 建索引（net_buy_wan 权威来自 lhb 行）
  const lhbByCode = new Map();
  if (Array.isArray(day.lhb)) {
    for (const r of day.lhb) if (r && r.code != null) lhbByCode.set(String(r.code), r);
  }
  const hot = Array.isArray(day.hot) ? day.hot : [];
  let sum = 0;
  for (const h of hot) {
    if (!h) continue;
    // 题材归属口径同 picks/backtest：热点诱因 reason 含主线名（精确命中）
    const reason = h.reason || '';
    if (typeof reason === 'string' && reason.includes(name)) {
      const l = lhbByCode.get(String(h.code));
      const net = l && Number.isFinite(l.net_buy_wan) ? +l.net_buy_wan
        : (Number.isFinite(h.net_buy_wan) ? +h.net_buy_wan : null);
      if (net != null) sum += net;
    }
  }
  return sum;
}

/**
 * 从归档日的权威主线（day.summary.main_theme）构造补丁二所需的「主题候选列表」首项所需的
 * longHuNet（万元）与 strength。优先用引擎现算的 main_yi（亿元）→ ×10000 转万元；缺失则回退 themeLongHuNet。
 * 纯函数、只读 day / mainTheme，不修改。
 *
 * @param {object} day archive 完整日
 * @param {object} [mainTheme] day.summary.main_theme（{name, main_yi, score?, ...}）
 * @returns {{theme:string, longHuNet:number, strength:number|null}|null}
 */
export function buildMainLineInput(day, mainTheme) {
  if (!mainTheme || !mainTheme.name) return null;
  const name = String(mainTheme.name);
  const longHuNet = Number.isFinite(mainTheme.main_yi)
    ? +mainTheme.main_yi * 10000 // 亿元 → 万元
    : themeLongHuNet(day, name);
  const strength = Number.isFinite(mainTheme.score) ? +mainTheme.score : null;
  return { theme: name, longHuNet, strength };
}
