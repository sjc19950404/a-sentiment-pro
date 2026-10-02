// 全局配置加载器——数据唯一事实源：仓库根 config.json（schemaVersion 2 起，
// 参数唯一住所 = config.json 的 params.live / params.train，顶层不再保留参数键）。
//
// ── 演进史（两个约束的合流，2026-10-02）─────────────────────────────────────
//   · #142 抽 JSON：同一批数值曾散落多处（本文件对象字面量、前端手抄兜底、审计
//     脚本正则），任何一处单独改动都会造成「报告说 A、算的是 B」。JSON 化后 Node /
//     前端 / 守卫脚本全部只读 config.json 一份文本。
//   · 过拟合防线：params.live 生产口径**递归冻结**，改动唯一通道 =
//     scripts/promote_params.mjs（样本外 20% 门禁 + params_changelog.json 留痕
//     who/when/why/验证结果）；params.train 实验区，寻优锚点（scripts/backtest.mjs）
//     已切至 train。手改 params.live 不留痕 → test/params_governance.test.mjs 红。
//   · 兼容层：config.weights / config.backtest.* 等旧路径是 live 的**同一引用**
//     （非拷贝），守卫测试断言 === ——不存在第二份口径。JSON 里参数只存 params.*
//     一份文本；旧路径在加载时由本文件组装（引用同一），前端桥（paper_ui.js 挂
//     window.ASENT_CONFIG）同理直接读 params.live。
//
// manualHolidays 已降级为兜底，不再是主口径——交易日判定由 src/calendar.js +
// data/calendar.json 承担（上证指数日K反推）；本数组只在日历文件缺失/覆盖范围
// 之外时参与兜底。漏登记会把休市日误判为交易日 → 反复回退/误报滞后，须随新公告
// 更新 config.json（来源与完整说明见该文件 _about/_paramsNote）。
//
// 校验原则：配置错误必须**快速失败**（启动即 throw），绝不带病运行——权重和≠1、
// 阈值乱序、缺必需键都在这里拦截，而不是等到算出错误分数后由下游守卫兜出来。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf8'));

// ── 结构校验（错误宁可启动炸，不许带病算分）─────────────────────────────────
if (!(cfg.formulaVersion && typeof cfg.formulaVersion === 'string')) {
  throw new Error('[config] formulaVersion 缺失或非字符串');
}
if (!cfg.params || !cfg.params.live || !cfg.params.train) {
  throw new Error('[config] params.live / params.train 缺失（参数唯一住所，不得省略）');
}
const BLOCKS = ['weights', 'thresholds', 'stops', 'lookback', 'costModel'];
for (const side of ['live', 'train']) {
  for (const b of BLOCKS) {
    if (!cfg.params[side][b] || typeof cfg.params[side][b] !== 'object') {
      throw new Error(`[config] params.${side}.${b} 缺失`);
    }
  }
  // 键集合一致（实验区只许改值不许改结构；结构漂移会让晋升快照失真）
  for (const b of BLOCKS) {
    const kl = Object.keys(cfg.params.live[b]).sort();
    const kt = Object.keys(cfg.params.train[b]).sort();
    if (JSON.stringify(kl) !== JSON.stringify(kt)) {
      throw new Error(`[config] params.${b} 键集合 live 与 train 不一致: ${kl} vs ${kt}`);
    }
  }
  const wsum = Object.values(cfg.params[side].weights).reduce((a, b) => a + (+b || 0), 0);
  if (Math.abs(wsum - 1) > 1e-9) {
    throw new Error(`[config] params.${side}.weights 权重和必须为 1, 实际 ${wsum}`);
  }
  const th = ['panic', 'hi', 'lo', 'overheat'].map((k) => +cfg.params[side].thresholds[k]);
  if (th.some((v) => !Number.isFinite(v)) || !(th[0] < th[1] && th[1] < th[2] && th[2] < th[3])) {
    throw new Error(`[config] params.${side}.thresholds 必须为升序四档 panic < hi < lo < overheat`);
  }
}
if (typeof cfg.params.live.costModel.priceLimit?.enabled !== 'boolean') {
  throw new Error('[config] params.live.costModel.priceLimit.enabled 必须为布尔（涨跌停约束占位）');
}
if (!Array.isArray(cfg.manualHolidays) || cfg.manualHolidays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
  throw new Error('[config] manualHolidays 必须为 YYYY-MM-DD 数组');
}

// ── 冻结与组装 ──────────────────────────────────────────────────────────────
const __freeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') __freeze(v);
  return Object.freeze(o);
};
const LIVE = __freeze(cfg.params.live); // 生产口径（递归冻结：改它只能走 promote 门禁）
const TRAIN = cfg.params.train;         // 实验区（可改；晋升须过样本外 20% 门禁）

export default {
  formulaVersion: cfg.formulaVersion,

  params: {
    live: LIVE,
    train: TRAIN,
    governance: 'live 冻结；改动唯一通道 = scripts/promote_params.mjs（样本外20%门禁 + params_changelog.json 留痕）。train 为实验区，寻优锚点已切至 train。',
  },

  // ── 兼容层：旧路径 = live 的同一引用（守卫测试断言 ===，杜绝第二份口径）──
  weights: LIVE.weights,
  lookback: LIVE.lookback,

  // 权重键（含档位后缀，便于人读权重数值）→ 存档/前端使用的因子键（无后缀）
  factorKeyMap: cfg.factorKeyMap,

  backtest: {
    thresholds: LIVE.thresholds,
    // 标的池：三大指数日涨跌幅（各自独立回测 → 日收益等权合成组合）
    assets: cfg.backtest.assets,
    // 交易成本（= params.live.costModel 同一引用；实盘摩擦预埋块）
    costs: LIVE.costModel,
    maxPos: LIVE.stops.maxPos, stopLoss: LIVE.stops.stopLoss,
    ddTrigger: LIVE.stops.ddTrigger, maxPosChg: LIVE.stops.maxPosChg,
    // 权重网格扰动倍数（以 config.params.train.weights 为锚，归一化后扫描）
    // 5 档 → 78,125 组（Node 侧约 1.2s）。步长粗时大量权重落在同一阈值档位平台、
    // 目标值重复，前沿会被平台淹没，故取 5 档换取足够分辨力。
    gridSteps: cfg.backtest.gridSteps,
    rolling: LIVE.lookback.rolling,
  },

  // 缺失数据处理策略：'proxy' = 用代理指标推算；推算不出则中性50并显式标记
  missingPolicy: cfg.missingPolicy,

  // 题材去噪参数
  minThemeStocksGlobal: cfg.minThemeStocksGlobal,
  minThemeStocksWindow: cfg.minThemeStocksWindow,

  // 动量窗口（交易日；= live.lookback 同值，守卫测试锁定）
  momentumRecent: LIVE.lookback.momentumRecent,
  momentumPrev: LIVE.lookback.momentumPrev,

  // 数据健康：当日补位因子占比超过此值则告警（运维告警 opsalerts 的判定线之一）
  healthWarnImputedRatio: cfg.healthWarnImputedRatio,

  // 多源容灾：主源失败重试次数与退避(ms)
  retry: cfg.retry,

  // 数据源端点（在 sources.js 中使用）
  sources: cfg.sources,

  // 手动节假日（YYYY-MM-DD，休市日）——**已降级为兜底**，主口径见文件头说明。
  manualHolidays: cfg.manualHolidays,
};
