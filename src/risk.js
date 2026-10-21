const RISK = {
  stopLoss: 0.08,      // 止损线 8%（与 alerts.js 里的 -0.08 对应）
  takeProfit: 0.15,    // 止盈线 15%
  maxDrawdown: 0.20,   // 最大回撤限制 20%
};

export default RISK;
