// config.js —— 默认导出，结构与 src/sources.js 的读取方式严格对齐
// sources.js 只用到: config.weights / config.lookback.rankWindow / config.lookback.rankMin
const config = {
  // 七因子权重，总和为 1（对应 sentiment.js 的 s_net/s_pos/s_brd/s_hot/s_zdt/s_zbl/s_amt）
  weights: {
    s_net: 0.20,
    s_pos: 0.15,
    s_brd: 0.15,
    s_hot: 0.10,
    s_zdt: 0.15,
    s_zbl: 0.10,
    s_amt: 0.15,
  },
  // lookback 集中块：分位窗口参数
  lookback: {
    rankWindow: 60,
    rankMin: 20,
  },
};

export default config;
