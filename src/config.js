// 全局配置：权重、阈值、数据源、公式版本
export default {
  formulaVersion: 'v5.0-pro',

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

  // 手动节假日（YYYY-MM-DD），跳过管道；其余靠星期判断
  manualHolidays: ['2026-09-25', '2026-09-27'],
};
