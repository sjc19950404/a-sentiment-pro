// 全局配置——薄壳加载层（数据唯一事实源：仓库根 config.json）。
//
// 为什么抽 JSON：同一批数值曾散落多处（Node 侧本文件、前端 app.js/paper_ui.js 兜底、
// 审计脚本正则），任何一处改动都可能造成「报告说 A、算的是 B」的口径漂移。JSON 化后：
//   · Node 侧（src/*.js、scripts/*.mjs）：照旧 `import config from './config.js'`，零改动；
//   · 前端（paper_ui.js）：动态 import config.json → window.ASENT_CONFIG（失败静默降级，
//     app.js 兜底值仍可用）；
//   · 审计/守卫脚本：直接 JSON.parse 读值，不再对源码做正则提取。
//
// ── 参数双套（live 冻结 / train 实验，数据同样在 config.json 的 params 块）──────────
//   · params.live：生产口径，本薄壳加载后**递归 Object.freeze**。打分管道 / 研判 /
//     前端展示全部读它。任何改动只能走 scripts/promote_params.mjs --apply
//     （须过「样本外 20%」门禁 + params_changelog.json 自动留痕 who/when/why/验证结果）。
//     直接手改 config.json 的 params.live 而不追加 changelog，
//     test/params_governance.test.mjs 会红——「偷偷改 live 让回测好看」就是过拟合本身。
//   · params.train：实验区。调参 / 网格 / walk-forward 只许改这里；
//     scripts/backtest.mjs 的寻优锚点已切到 train。
//   · 兼容层：config.weights / config.backtest.* 等旧路径是 live 的**同一引用**
//     （非拷贝），守卫测试断言 === ——不存在第二份口径。
//   · costModel（实盘摩擦预埋）：交易成本独立配置块，回测引擎（src/backtest.js 的
//     turnoverCost 与 src/strategy_bt.js 的 ROUND_COST）已接真实值；priceLimit
//     为涨跌停约束占位（enabled:false），启用须先回填限价口径，避免届时返工。
//   · lookback：分位/动量/滚动窗口集中块。rankWindow/rankMin 与 src/sources.js 的
//     RANK_WINDOW/RANK_MIN 同源（防前视分位窗口，#134）；rolling 与 walk-forward 同源。
//   · 双写镜像：config.json 顶层扁平字段（weights / backtest.thresholds / costs /
//     rolling / momentum* …）与 params.live 逐位相等（governance 守卫锁定）——前端
//     直接读 JSON 扁平层，Node 侧读同一引用，两边不漂移。
//
// manualHolidays 已降级为兜底，不再是主口径——交易日判定由 src/calendar.js + data/calendar.json
// 承担（上证指数日K反推）；本数组只在日历文件缺失/覆盖范围之外时参与兜底。来源：
// 沪深北交易所《2026 年中秋节、国庆节休市安排》（证监办发〔2025〕130 号），漏登记会把
// 休市日误判为交易日 → 反复回退/误报滞后，须随新公告更新 config.json。
//
// 校验原则：配置错误必须**快速失败**（启动即 throw），绝不带病运行——权重和≠1、阈值
// 乱序、缺必需键、params 双套结构残缺都在这里拦截，而不是等到算出错误分数后由下游守卫
// 兜出来。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf8'));

// ── 结构校验（快速失败，不带病运行）─────────────────────────────────────────
const W = cfg.weights || {};
const wsum = Object.values(W).reduce((a, b) => a + (+b || 0), 0);
if (!(cfg.formulaVersion && typeof cfg.formulaVersion === 'string')) {
  throw new Error('[config] formulaVersion 缺失或非字符串');
}
if (Math.abs(wsum - 1) > 1e-9) {
  throw new Error(`[config] weights 权重和必须为 1, 实际 ${wsum}`);
}
const THR = (cfg.backtest && cfg.backtest.thresholds) || {};
const th = ['panic', 'hi', 'lo', 'overheat'].map((k) => +THR[k]);
if (th.some((v) => !Number.isFinite(v)) || !(th[0] < th[1] && th[1] < th[2] && th[2] < th[3])) {
  throw new Error('[config] backtest.thresholds 必须为升序四档 panic < hi < lo < overheat');
}
if (!Array.isArray(cfg.manualHolidays) || cfg.manualHolidays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
  throw new Error('[config] manualHolidays 必须为 YYYY-MM-DD 数组');
}

// ── 参数双套（live 冻结 / train 实验区）──────────────────────────────────────
const PARAM_BLOCKS = ['weights', 'thresholds', 'stops', 'lookback', 'costModel'];
const P = cfg.params || {};
for (const side of ['live', 'train']) {
  for (const b of PARAM_BLOCKS) {
    if (!P[side] || !P[side][b] || typeof P[side][b] !== 'object') {
      throw new Error(`[config] params.${side}.${b} 缺失或非对象（promote_params 双套结构残缺）`);
    }
  }
}
const trainKeysOk = PARAM_BLOCKS.every((b) =>
  Object.keys(P.train[b]).sort().join(',') === Object.keys(P.live[b]).sort().join(','));
if (!trainKeysOk) {
  throw new Error('[config] params.train 键集合与 live 不一致（实验区只许改值，不许改结构）');
}

const __clone = (o) => JSON.parse(JSON.stringify(o));
const __freeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') __freeze(v);
  return Object.freeze(o);
};

const LIVE = __freeze(__clone(P.live)); // 生产口径（冻结：改它只能走 promote）
const TRAIN = __clone(P.train);         // 实验区（可改，晋升须过门禁）

// ── 导出：JSON 全量 + 冻结双套 + 兼容层同引用 ─────────────────────────────────
// 注意：兼容层覆盖的引用与 JSON 扁平层逐位同值（governance 守卫锁定双写镜像不漂移），
// 因此「薄壳导出 === config.json 内容」的守卫（test/config.test.mjs deepEqual）依然成立。
const out = { ...cfg };
out.params = { live: LIVE, train: TRAIN, governance: P.governance };
out.weights = LIVE.weights;
out.lookback = LIVE.lookback;
out.backtest = {
  ...cfg.backtest,
  thresholds: LIVE.thresholds,
  costs: LIVE.costModel,
  rolling: LIVE.lookback.rolling,
  maxPos: LIVE.stops.maxPos, stopLoss: LIVE.stops.stopLoss,
  ddTrigger: LIVE.stops.ddTrigger, maxPosChg: LIVE.stops.maxPosChg,
};
out.momentumRecent = LIVE.lookback.momentumRecent;
out.momentumPrev = LIVE.lookback.momentumPrev;

export default out;
