// 全局配置：权重、阈值、数据源、公式版本
export default {
  formulaVersion: 'v5.2-pro',

  // 七因子权重（和为 1）
  weights: {
    s_net20: 0.20, // 龙虎榜净额
    s_pos10: 0.10, // 涨跌家数
    s_brd20: 0.20, // 板块/行业涨比
    s_hot10: 0.10, // 涨停强度
    s_zdt15: 0.15, // 涨跌停对比
    s_zbl10: 0.10, // 封板质量
    s_amt15: 0.15, // 量能
  },

  // 权重键（含档位后缀，便于人读权重数值）→ 存档/前端使用的因子键（无后缀）
  factorKeyMap: {
    s_net20: 's_net', s_pos10: 's_pos', s_brd20: 's_brd', s_hot10: 's_hot',
    s_zdt15: 's_zdt', s_zbl10: 's_zbl', s_amt15: 's_amt',
  },

  // ── 回测（V5.2）：阈值与风控/成本默认值，服务端 scripts/backtest.mjs 与前端展示共用 ──
  backtest: {
    // 四档阈值（收盘打分、T+1 生效）：≥80 过热只减仓不新建 / ≥65 满仓 / 24~65 半仓 / ≤24 清仓。
    // 注意 hi=44 目前是保留参数：src/backtest.js 的 positions() 并未用它判档（实际 24~65 同属
    // 半仓），仅用于历史口径展示；若确需独立"减仓档"，须同时改 positions() 并更新全部回归夹具。
    thresholds: { panic: 24, hi: 44, lo: 65, overheat: 80 },
    // 标的池：三大指数日涨跌幅（各自独立回测 → 日收益等权合成组合）
    assets: ['上证指数', '深证成指', '创业板指'],
    // V5.2 增强口径：交易成本（A股实际：佣金万3双边 / 印花税万5卖出 / 滑点万2）
    costs: { comm: 0.0003, stamp: 0.0005, slip: 0.0002 },
    // 风控：最大仓位 / 单笔止损 / 回撤动态降仓 / 单日仓位变动上限（0 = 关闭）
    maxPos: 1.0, stopLoss: -0.08, ddTrigger: -0.15, maxPosChg: 0.2,
    // 权重网格扰动倍数（以 config.weights 为锚，归一化后扫描）
    // 5 档 → 78,125 组（Node 侧约 1.2s）。步长粗时大量权重落在同一阈值档位平台、
    // 目标值重复，前沿会被平台淹没，故取 5 档换取足够分辨力。
    gridSteps: [0.6, 0.8, 1.0, 1.2, 1.4],
    // 滚动样本外窗口（交易日）；样本不足时自动少切段并在页面标注
    rolling: { trainWindow: 20, testWindow: 6 },
  },

  // 缺失数据处理策略：'proxy' = 用代理指标推算；推算不出则中性50并显式标记
  missingPolicy: 'proxy',

  // 题材去噪参数
  minThemeStocksGlobal: 2, // 全存档只覆盖1只个股的标签 → 视为噪声丢弃
  minThemeStocksWindow: 2, // 某题材在窗口内需覆盖>=2只个股才算"存在"

  // 动量窗口（交易日）
  momentumRecent: 5,
  momentumPrev: 5,

  // 数据健康：当日补位因子占比超过此值则告警
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

  // 手动节假日（YYYY-MM-DD，休市日），跳过管道；周末由 isTradingDay 按星期判断。
  // 来源：沪深北交易所《2026 年中秋节、国庆节休市安排》（2026-09-17 公告，证监办发〔2025〕130 号）：
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
