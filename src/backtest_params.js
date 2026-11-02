// 选股回放共享参数门面（v1 涨停接力 / v2 趋势跟随 统一口径）。
//
// 单一真实来源 = src/config.js（params.live.stops / costModel / backtest.maxPos）。
// 本模块仅做类型化门面 + 锁定 paper_replay 的 CLI 默认值，杜绝 v1/v2 各写字面量造成口径漂移。
//
// ⚠ 两个已核实的关键事实（直接决定 v2 设计，勿凭直觉改）：
//   1) v1 是【单仓位】策略：config.params.live.stops.maxPos = 1，且单票占比默认 10%。
//      → v2 必须同样单仓位（排序取前 N、并发受 maxPos=1 限制），否则 A/B 混入"仓位数量"变量。
//   2) v1 没有"N 日固定离场"：出场由共享 settleDay 引擎规则驱动（见下方 EXIT_*），
//      v2 复用同一引擎即可保证离场逐位一致，无需（也不该）单独设 N 日固定。
import config from './config.js';

const LIVE = config.params.live;
const STOPS = LIVE.stops;

export const SHARED = {
  // —— 选股层（仅决定"选哪些"，不影响成交/出场）——
  TOP_N: 3,          // 每日排序取前 N 候选（实际并发受 MAX_POS 限制）
  PER_POS_PCT: 0.10, // 单票资金占比（默认 --pct；A/B 用默认，与 v1 一致）

  // —— 资金/仓位（v1/v2 必须一致）——
  MAX_POS: config.backtest.maxPos, // 1：v1 实测单仓位
  SINGLE_STOCK_CAP: 0.20,          // paper.js 单票硬上限（maxPos=1 时冗余但保留）

  // —— 成本（与 config.backtest.costs 逐位相等）——
  COSTS: {
    comm: LIVE.costModel.comm,   // 0.0003 双边
    stamp: LIVE.costModel.stamp, // 0.0005 卖出
    slip: LIVE.costModel.slip,   // 0.0002 双向滑点
  },
  ROUND_COST: LIVE.costModel.comm * 2 + LIVE.costModel.stamp + LIVE.costModel.slip * 2,

  // —— 出场纪律（v1/v2 共用同一套 settleDay 出场引擎；v2 不设独立 N 日固定）——
  EXIT_HARD_STOP: STOPS.stopLoss,            // -0.08 硬止损（baseHardStopPct 同）
  EXIT_TRAIL_TRIGGER: STOPS.trailingTriggerPct, // +0.06 激活追踪
  EXIT_TRAIL_STOP: STOPS.trailingStopPct,       // -0.025 追踪回撤
  EXIT_LOSS_MAX_DAYS: 3,                        // 亏损不过三（浮亏到第 3 日强制平仓）
  EXIT_DD_TRIGGER: STOPS.ddTrigger,             // -0.15 回撤减仓触发
  // 注：exitMode==='strict_v1' 的"隔日强制了结(连板)"仅对 连板/打板 仓生效（v2 趋势票不触发）；
  //     "硬止损-5%"属 strict_v1 模式，paper_replay 默认 legacy(-0.08)，本 A/B 用 legacy。

  // —— 归因（非交易）——
  RECOVERY_WINDOW: 5, // 假摔判定窗口
};

export default SHARED;
