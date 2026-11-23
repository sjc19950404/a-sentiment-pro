// 实战化「可交易性」只读报告（2026-10-27 用户指令）
//   复用 src/picks.js 的 recommendPicks（已内置 applyTradabilityFilters：剔除买不进的票 +
//   买点预期标注 + 烂板弱转强偏好），把「今日系统选股建议 + 买点预期 + 剔除的买不进票」落盘为
//   data/reco_picks_latest.json，供终端(terminal.html)展示给主理人。
//
//   ⚠ 铁律：本脚本只读 dual_track_latest.json + ztpool_history.json，绝不调用 paper.js 任何
//   买卖接口、绝不修改模拟盘账户——它只是把 recommendPicks 的结论"翻译"成前端可读的 JSON。
//
//   与 scripts/report_etf_hedge.mjs 同构（只读计算 + 写 JSON，零交易）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { decodeArchive } from '../src/lhb_codec.js';
import { marketTierVersion } from '../src/tier_policy.js';   // 产物档位口径版本戳   // v5.3：席位码→席位名（seatCode 校验、seatName 匹配）
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recommendPicks } from '../src/picks.js';
// V5.3 核心引擎调优（2026-10-28）：极寒分化惩罚 + 主线降权过滤的共享纯函数（只读报告侧消费结论）。
import {
  detectClusteringBubble, computeRedIndustryRatio, buildMainLineInput, selectMainLine, penaltyApplies,
} from '../src/mainline_guard.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 与 scripts/paper_daily.mjs 同源：读 data/archive.json（完整档案，day 含 hot/lhb/summary.zt_codes 候选），
// 而非 dual_track_latest.json（仅 track 精简快照，无候选）。这是生产 recommendPicks 真正使用的数据。
const ARCHIVE = resolve(ROOT, 'data/archive.json');
const ZTPOOL = resolve(ROOT, 'data/ztpool_history.json');
const OUT = resolve(ROOT, 'data/reco_picks_latest.json');
const TOP_N = 6;

// 当日涨停池：ztpool_history 按日匹配 day.trade_date（归一化去非数字）
function loadZtpoolForDay(dateStr) {
  try {
    const hist = JSON.parse(readFileSync(ZTPOOL, 'utf8'));
    const key = String(dateStr == null ? '' : dateStr).replace(/\D/g, '');
    const hit = (Array.isArray(hist) ? hist : []).find((e) => e && String(e.date).replace(/\D/g, '') === key);
    return hit && Array.isArray(hit.pool) ? hit.pool : null;
  } catch { return null; }
}

function readJsonSafe(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// 取档案最新交易日（与 paper_daily.mjs 一致：days = all_days 过滤 trade_date，取末日）
function latestDay() {
  const arch = readJsonSafe(ARCHIVE);
  if (!arch) return null;
  /* 【2026-11-24 v5.3】档案落盘时 lhb_codec 把席位名压成 meta.seatCodes 下标（数字）。
   * 游资挂件按名称匹配——数字码永不命中（因子从上线起在 Pi 侧从未生效）。读档侧
   * decodeArchive 还原 seatName；seatCode 只在 codec 内做校验/去重，不参与匹配。 */
  const decoded = decodeArchive(arch);
  const days = (decoded.all_days || []).filter((d) => d && d.trade_date);
  return days.length ? days[days.length - 1] : null;
}

function main() {
  const day = latestDay();
  if (!day) { console.error('[reco-picks] 读取 archive.json 失败或无可交易日 → 跳过'); process.exit(0); }
  const date = day.trade_date || null;
  const emotionScore = Number.isFinite(+(day.emotion && day.emotion.value)) ? +(day.emotion.value) : (Number.isFinite(+day.score) ? +day.score : null);
  const ztpool = loadZtpoolForDay(date);

  // 补丁一（V5.3·2026-10-28 收紧调参·第二种方案）：极寒分化惩罚——读取完整日的上涨家数与红盘行业占比。
  //   仅作用于本次只读报告的推演结论（不写归档）。收紧：仅当「原 regime 已是 recover/climax」且触发极寒分化才扣分降级。
  const _upCount = Number.isFinite(day?.summary?.up_count) ? day.summary.up_count : null;
  const _redIndustryRatio = computeRedIndustryRatio(day?.industry);
  const { isClusteringBubble, penalty } = detectClusteringBubble({ upCount: _upCount, redIndustryRatio: _redIndustryRatio });
  // 当日 regime（与 paper_daily 同口径，取自 signals-latest；缺失 → null → 保守不扣分）
  let regimeKey = null;
  try { regimeKey = JSON.parse(readFileSync('data/signals-latest.json', 'utf8'))?.dailyReport?.tag?.key || null; }
  catch { regimeKey = null; }
  const _applyPenalty = penaltyApplies(isClusteringBubble, regimeKey);
  // 补丁三依赖：权威主线（day.summary.main_theme）构造主线对象 + 克隆打标。
  const _mainLineInput = buildMainLineInput(day, day?.summary?.main_theme);
  const mainLine = selectMainLine(_mainLineInput ? [_mainLineInput] : []);
  // 情绪分扣分（仅本次推演；原始 day 不动）：仅 applyPenalty 时扣分
  const effEmotionScore = emotionScore != null ? emotionScore - (_applyPenalty ? penalty : 0) : emotionScore;

  /* v5.3：挂件复活——显式传标准化前的席位明细（picks.js 内部 seat_norm 标准化后匹配），
   * 加分固定 +5 上限（旧版 ×2 是主导因子，九阳 47→65 的失控来源之一）。 */
  const seatsDetail = (day.summary && day.summary.seats && day.summary.seats.detail) || null;
  const res = recommendPicks(day, { topN: TOP_N, emotionScore: effEmotionScore, ztpool, isClusteringBubble, mainLine, fullBelow: true, seatsDetail });

  const picks = (res.picks || []).map((p) => ({
    code: String(p.code),
    name: p.name || null,
    buyPoint: p.buyPoint || null,
    weakToStrong: !!p.weakToStrong,
    probText: p.probText || null,
    probScore: (p.prob && Number.isFinite(+p.prob.score)) ? Math.round(+p.prob.score) : null,
    changePct: Number.isFinite(+p.changePct) ? +p.changePct : null,
    streakText: p.streakText || null,
    streakTop: !!p.streakTop,
    gateTags: p.gateTags || null,
    suggestWeight: p.suggestWeight != null ? p.suggestWeight : null,
  }));

  /* 【2026-11-24 拍板二：前端只渲染不自算】此前前端 mountReco 用 archive-recent.json
   * 自己重跑 recommendPicks（参数不同：无 isClusteringBubble/mainLine/情绪扣分）——
   * 同日两套结论（实测 11-23：前端 118/14/推荐3 vs 本档 117/13/推荐0），口径漂移源头。
   * 本档新增 observe（观察档=kept 里 suggestWeight=0 或未过买入门槛的票）与 stats
   * （候选池/剔除/未达门槛计数），前端改为直读本档渲染，不再自算。 */
  /* 观察档 = kept 里未获仓位（suggestWeight=0，如狂热/冰点帽）+ belowThreshold（未过
   * 买入门槛 57 的次品格）——同参数同数据源，只换门槛（拍板原文）。
   * 【2026-11-24 observe 选取规则扩充（B3 验收线）】below 全量 ~104 只只取前 8 时，
   * "当日涨停但引擎不推"的次品格（最有盘面信息量的观察对象，如 11-23 九阳/风华/通化，
   * 分数 47/51 排 #89/#9/#11）会被高分非涨停票挤出——切档后三票从卡上消失=用户明令
   * 的失败形态。改为：kept 无仓位 + below 里「当日涨停」的全部（上限 12，按分降序）
   * + below 非涨停的前 4——涨停观察票优先展示。 */
  const toObserve = (p, tier) => ({
    code: String(p.code),
    name: p.name || null,
    changePct: Number.isFinite(+p.changePct) ? +p.changePct : null,
    probScore: (p.prob && Number.isFinite(+p.prob.score)) ? Math.round(+p.prob.score) : null,
    streakText: p.streakText || null,
    gateTags: p.gateTags || null,
    isZt: !!p.isZt,
    suggestWeight: p.suggestWeight != null ? p.suggestWeight : 0,
    observeTier: tier,
  });
  const keptNoWeight = (res.picks || []).filter((p) => !(p.suggestWeight > 0)).map((p) => toObserve(p, 'kept_no_weight'));
  const belowAll = (res.belowAll || res.belowThreshold || []);
  const belowZt = belowAll.filter((p) => p && p.isZt).slice(0, 12).map((p) => toObserve(p, 'below_zt'));
  const belowOther = belowAll.filter((p) => p && !p.isZt).slice(0, 4).map((p) => toObserve(p, 'below_threshold'));
  const observe = keptNoWeight.concat(belowZt, belowOther);

  const out = {
    date,
    marketTierVersion: marketTierVersion(),
    generated_at: new Date().toISOString(),
    emotionScore,
    ztpoolLoaded: !!ztpool,
    picks,
    observe,
    stats: {
      universe: Number.isFinite(+res.pool) ? +res.pool : null,
      removed: (res.rejected || []).length,
      kept: (res.pred && Number.isFinite(+res.pred.kept)) ? +res.pred.kept : (res.picks || []).length,
      below: (res.pred && Number.isFinite(+res.pred.below)) ? +res.pred.below : null,
      minProb: (res.pred && Number.isFinite(+res.pred.minProb)) ? +res.pred.minProb : null,
      observeCount: null,  // 落档后回填
    },
    rejected: (res.rejected || []).map((r) => ({
      code: r.code != null ? String(r.code) : null,
      name: r.name || null,
      reasons: [r.reason, r.why].filter(Boolean),
    })),
    note: res.note || null,
  };
  out.stats.observeCount = out.observe.length;

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  const untradable = (res.rejected || []).filter((r) => (r.reasons || []).some((x) => /买不进/.test(x))).length;
  console.log(`[reco-picks] date=${date} 涨停池=${ztpool ? ztpool.length + '只' : '缺失(no-op)'} ` +
    `推荐=${picks.length} 只（弱转强 ${picks.filter((p) => p.weakToStrong).length} 只） ` +
    `剔除=${res.rejected.length} 只（其中买不进 ${untradable} 只）`);
}

main();
