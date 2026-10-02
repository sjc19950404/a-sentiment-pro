// 全局配置——薄壳加载层（数据唯一事实源：仓库根 config.json）。
//
// 为什么抽 JSON：同一批数值曾散落多处（Node 侧本文件、前端 app.js/paper_ui.js 兜底、
// 审计脚本正则），任何一处改动都可能造成「报告说 A、算的是 B」的口径漂移。JSON 化后：
//   · Node 侧（src/*.js、scripts/*.mjs）：照旧 `import config from './config.js'`，零改动；
//   · 前端（paper_ui.js）：动态 import config.json → window.ASENT_CONFIG（失败静默降级，
//     app.js 兜底值仍可用）；
//   · 审计/守卫脚本：直接 JSON.parse 读值，不再对源码做正则提取。
//
// manualHolidays 已降级为兜底，不再是主口径——交易日判定由 src/calendar.js + data/calendar.json
// 承担（上证指数日K反推）；本数组只在日历文件缺失/覆盖范围之外时参与兜底。来源：
// 沪深北交易所《2026 年中秋节、国庆节休市安排》（证监办发〔2025〕130 号），漏登记会把
// 休市日误判为交易日 → 反复回退/误报滞后，须随新公告更新 config.json。
//
// 校验原则：配置错误必须**快速失败**（启动即 throw），绝不带病运行——权重和≠1、阈值
// 乱序、缺必需键都在这里拦截，而不是等到算出错误分数后由下游守卫兜出来。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf8'));

// ── 结构校验（骨架阶段最小集；随配置消费面扩大逐步加强）──
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

export default cfg;
