// 全局配置：参数双套（live 冻结 / train 实验）+ 数据源端点 + 公式版本
//
// ── 过拟合防线（2026-10-02 拍板，#134/#141 配套）────────────────────────────
//   · params.live：生产口径，**冻结**（递归 Object.freeze）。打分管道 / 研判 /
//     前端展示全部读它。任何改动只能走 scripts/promote_params.mjs --apply
//     （须过「样本外 20%」门禁 + params_changelog.json 自动留痕 who/when/why/验证结果）。
//     直接手改 LIVE_PARAMS 块而不追加 changelog，test/params_governance.test.mjs
//     会红——「偷偷改 live 让回测好看」就是过拟合本身。
//   · params.train：实验区。调参 / 网格 / walk-forward 只许改这里；
//     scripts/backtest.mjs 的寻优锚点已切到 train。
//   · 兼容层：config.weights / config.backtest.* 等旧路径是 live 的**同一引用**
//     （非拷贝），守卫测试断言 === ——不存在第二份口径。
//   · costModel（实盘摩擦预埋）：交易成本独立配置块，回测引擎（src/backtest.js 的
//     turnoverCost 与 src/strategy_bt.js 的 ROUND_COST）已接真实值；priceLimit
//     为涨跌停约束占位（enabled:false），启用须先回填限价口径，避免届时返工。
//   · lookback：分位/动量/滚动窗口集中块。rankWindow/rankMin 与 src/sources.js 的
//     RANK_WINDOW/RANK_MIN 同源（防前视分位窗口，#134）；rolling 与 walk-forward 同源。
//
// ⚠ 浏览器约束：本文件会被 scripts/check_frontend.mjs 剥掉 export 后平铺进 jsdom
//   求值（export default → var backtestCfg = <表达式>），因此 default 导出必须是
//   **纯表达式 IIFE**：不许 import fs、不许运行时读 JSON。参数的「单一事实」由
//   params_changelog.json 的 liveAfter 快照 + 守卫测试逐位比对保证，而非运行时读盘。
export default (function () {
  // ── [PROMOTE-MANAGED:BEGIN] ──────────────────────────────────────────────
  // 本块由 scripts/promote_params.mjs --apply 机器重写：值必须与 params_changelog.json
  // 最后一条 entry.liveAfter 逐位相等（守卫测试锁定）。手工编辑 = 违规。
  const LIVE_PARAMS = {
    "weights": { "s_net20": 0.2, "s_pos10": 0.1, "s_brd20": 0.2, "s_hot10": 0.1, "s_zdt15": 0.15, "s_zbl10": 0.1, "s_amt15": 0.15 },
    "thresholds": { "panic": 24, "hi": 44, "lo": 65, "overheat": 80 },
    "stops": { "maxPos": 1, "stopLoss": -0.08, "ddTrigger": -0.15, "maxPosChg": 0.2 },
    "lookback": { "rolling": { "trainWindow": 20, "testWindow": 6 }, "momentumRecent": 5, "momentumPrev": 5, "rankWindow": 60, "rankMin": 20 },
    "costModel": { "comm": 0.0003, "stamp": 0.0005, "slip": 0.0002, "priceLimit": { "enabled": false } }
  };
  // ── [PROMOTE-MANAGED:END] ────────────────────────────────────────────────

  // 实验区（手改这里 + 跑 node scripts/promote_params.mjs）：初始 = live 基线快照。
  // 守卫测试只锁「键集合与 live 一致」，不锁值——值漂移正是实验的本意；
  // 但晋升（写回 live）必须过样本外 20% 门禁。
  const TRAIN_PARAMS = {
    // 七因子权重（和为 1）
    weights: { s_net20: 0.20, s_pos10: 0.10, s_brd20: 0.20, s_hot10: 0.10, s_zdt15: 0.15, s_zbl10: 0.10, s_amt15: 0.15 },
    // 四档阈值（收盘打分、T+1 生效）：≥80 过热只减仓不新建 / ≥65 满仓 / 24~65 半仓 / ≤24 清仓。
    // 注意 hi=44 目前是保留参数：src/backtest.js 的 positions() 并未用它判档（实际 24~65 同属
    // 半仓），仅用于历史口径展示；若确需独立"减仓档"，须同时改 positions() 并更新全部回归夹具。
    thresholds: { panic: 24, hi: 44, lo: 65, overheat: 80 },
    // 风控：最大仓位 / 单笔止损 / 回撤动态降仓 / 单日仓位变动上限（0 = 关闭）
    stops: { maxPos: 1.0, stopLoss: -0.08, ddTrigger: -0.15, maxPosChg: 0.2 },
    // 窗口（交易日）：rolling=walk-forward 滚动样本外；momentum*=题材动量双窗口；
    // rankWindow/rankMin=分位防前视窗口（#134，与 sources.js RANK_* 同源）
    lookback: {
      rolling: { trainWindow: 20, testWindow: 6 },
      momentumRecent: 5, momentumPrev: 5,
      rankWindow: 60, rankMin: 20,
    },
    // 实盘摩擦（降维预埋）：成本已接真实值（佣金万3双边/印花万5卖出/滑点万2）；
    // priceLimit.enabled=false 为涨跌停约束占位——回测引擎实现限价口径时置 true 即接上。
    costModel: { comm: 0.0003, stamp: 0.0005, slip: 0.0002, priceLimit: { enabled: false } },
  };

  const __clone = (o) => JSON.parse(JSON.stringify(o));
  const __freeze = (o) => {
    for (const v of Object.values(o)) if (v && typeof v === 'object') __freeze(v);
    return Object.freeze(o);
  };

  const LIVE = __freeze(__clone(LIVE_PARAMS)); // 生产口径（冻结：改它只能走 promote）
  const TRAIN = __clone(TRAIN_PARAMS);         // 实验区（可改，晋升须过门禁）

  return {
    formulaVersion: 'v5.2-pro',

    params: {
      live: LIVE,
      train: TRAIN,
      governance: 'live 冻结；改动唯一通道 = scripts/promote_params.mjs（样本外20%门禁 + params_changelog.json 留痕）。train 为实验区，寻优锚点已切至 train。',
    },

    // ── 兼容层：旧路径 = live 的同一引用（守卫测试断言 ===，杜绝第二份口径）──
    weights: LIVE.weights,
    lookback: LIVE.lookback,

    // 权重键（含档位后缀，便于人读权重数值）→ 存档/前端使用的因子键（无后缀）
    factorKeyMap: {
      s_net20: 's_net', s_pos10: 's_pos', s_brd20: 's_brd', s_hot10: 's_hot',
      s_zdt15: 's_zdt', s_zbl10: 's_zbl', s_amt15: 's_amt',
    },

    backtest: {
      thresholds: LIVE.thresholds,
      // 标的池：三大指数日涨跌幅（各自独立回测 → 日收益等权合成组合）
      assets: ['上证指数', '深证成指', '创业板指'],
      // 交易成本（= params.live.costModel 同一引用；实盘摩擦预埋块）
      costs: LIVE.costModel,
      maxPos: LIVE.stops.maxPos, stopLoss: LIVE.stops.stopLoss,
      ddTrigger: LIVE.stops.ddTrigger, maxPosChg: LIVE.stops.maxPosChg,
      // 权重网格扰动倍数（以 config.params.train.weights 为锚，归一化后扫描）
      // 5 档 → 78,125 组（Node 侧约 1.2s）。步长粗时大量权重落在同一阈值档位平台、
      // 目标值重复，前沿会被平台淹没，故取 5 档换取足够分辨力。
      gridSteps: [0.6, 0.8, 1.0, 1.2, 1.4],
      rolling: LIVE.lookback.rolling,
    },

    // 缺失数据处理策略：'proxy' = 用代理指标推算；推算不出则中性50并显式标记
    missingPolicy: 'proxy',

    // 题材去噪参数
    minThemeStocksGlobal: 2, // 全存档只覆盖1只个股的标签 → 视为噪声丢弃
    minThemeStocksWindow: 2, // 某题材在窗口内需覆盖>=2只个股才算"存在"

    // 动量窗口（交易日；= live.lookback 同值，守卫测试锁定）
    momentumRecent: LIVE.lookback.momentumRecent,
    momentumPrev: LIVE.lookback.momentumPrev,

    // 数据健康：当日补位因子占比超过此值则告警（运维告警 opsalerts 的判定线之一）
    healthWarnImputedRatio: 0.34,

    // 多源容灾：主源失败重试次数与退避(ms)
    retry: { times: 3, backoff: 1500 },

    // 数据源端点（在 sources.js 中使用）
    sources: {
      eastmoney: {
        lhb: 'https://datacenter.eastmoney.com/securities/api/data/v1/get',
        pool: 'https://push2.eastmoney.com/api/qt/clist/get',
      },
      tencent: {
        index: 'https://qt.gtimg.cn/q=',
      },
      ths: {
        industry: 'https://q.10jqka.com.cn/thshy/',
      },
    },

    // 手动节假日（YYYY-MM-DD，休市日）—— **已降级为兜底**，不再是主口径。
    //
    // 现状：交易日判定改由 src/calendar.js + data/calendar.json 承担
    //   （由 scripts/fetch_calendar.mjs 从**上证指数日K**反推，见该脚本头部说明）。
    //   日历文件覆盖范围内（实测 2025-01 ~ 当前）判定以日K为准，精确且无需人工维护；
    //   本数组只在「日历文件缺失 / 覆盖范围之外」时参与兜底。
    //
    // 为什么还要留着：
    //   · 本地首次 clone 时 data/calendar.json 可能尚未生成，兜底避免退化成"全年非周末都是交易日"；
    //   · 日历覆盖到 coveredTo 之后的新日期，兜底提供最后一道缓冲。
    //   注：日历的休市清单是**并集**（种子 ∪ 日K反推 ∪ 本数组），三者互为冗余而非互斥。
    //
    // 来源：沪深北交易所《2026 年中秋节、国庆节休市安排》（证监办发〔2025〕130 号）：
    //   中秋 9-25（五）~9-27（日）休市，9-28（一）起照常开市；
    //   国庆 10-1（四）~10-7（三）休市，10-8（四）起照常开市；
    //   9-20（日）、10-10（六）为周末休市（无周末补交易）。
    // 漏登记会把休市日误判为交易日 → 抓不到数据 → 反复回退/误报滞后，故须随新公告更新。
    manualHolidays: [
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
      '2026-10-05', '2026-10-06', '2026-10-07',
    ],
  };
})();
