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
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recommendPicks } from '../src/picks.js';
// V5.3 核心引擎调优（2026-10-28）：极寒分化惩罚 + 主线降权过滤的共享纯函数（只读报告侧消费结论）。
import {
  detectClusteringBubble, computeRedIndustryRatio, buildMainLineInput, selectMainLine,
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
  const days = (arch.all_days || []).filter((d) => d && d.trade_date);
  return days.length ? days[days.length - 1] : null;
}

function main() {
  const day = latestDay();
  if (!day) { console.error('[reco-picks] 读取 archive.json 失败或无可交易日 → 跳过'); process.exit(0); }
  const date = day.trade_date || null;
  const emotionScore = Number.isFinite(+(day.emotion && day.emotion.value)) ? +(day.emotion.value) : (Number.isFinite(+day.score) ? +day.score : null);
  const ztpool = loadZtpoolForDay(date);

  // 补丁一（V5.3·2026-10-28）：极寒分化惩罚——读取完整日的上涨家数与红盘行业占比。
  //   仅作用于本次只读报告的推演结论（不写归档）。
  const _upCount = Number.isFinite(day?.summary?.up_count) ? day.summary.up_count : null;
  const _redIndustryRatio = computeRedIndustryRatio(day?.industry);
  const { isClusteringBubble, penalty } = detectClusteringBubble({ upCount: _upCount, redIndustryRatio: _redIndustryRatio });
  // 补丁三依赖：权威主线（day.summary.main_theme）构造主线对象 + 克隆打标。
  const _mainLineInput = buildMainLineInput(day, day?.summary?.main_theme);
  const mainLine = selectMainLine(_mainLineInput ? [_mainLineInput] : []);
  // 情绪分扣分（仅本次推演；原始 day 不动）
  const effEmotionScore = emotionScore != null ? emotionScore - penalty : emotionScore;

  const res = recommendPicks(day, { topN: TOP_N, emotionScore: effEmotionScore, ztpool, isClusteringBubble, mainLine });

  const picks = (res.picks || []).map((p) => ({
    code: String(p.code),
    name: p.name || null,
    buyPoint: p.buyPoint || null,
    weakToStrong: !!p.weakToStrong,
    probText: p.probText || null,
    streakText: p.streakText || null,
    gateTags: p.gateTags || null,
    suggestWeight: p.suggestWeight != null ? p.suggestWeight : null,
  }));

  const out = {
    date,
    generated_at: new Date().toISOString(),
    emotionScore,
    ztpoolLoaded: !!ztpool,
    picks,
    rejected: (res.rejected || []).map((r) => ({
      code: r.code != null ? String(r.code) : null,
      name: r.name || null,
      reasons: [r.reason, r.why].filter(Boolean),
    })),
    note: res.note || null,
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  const untradable = (res.rejected || []).filter((r) => (r.reasons || []).some((x) => /买不进/.test(x))).length;
  console.log(`[reco-picks] date=${date} 涨停池=${ztpool ? ztpool.length + '只' : '缺失(no-op)'} ` +
    `推荐=${picks.length} 只（弱转强 ${picks.filter((p) => p.weakToStrong).length} 只） ` +
    `剔除=${res.rejected.length} 只（其中买不进 ${untradable} 只）`);
}

main();
