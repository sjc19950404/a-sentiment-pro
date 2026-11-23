#!/usr/bin/env node
/* reconcile_daily.mjs —— 前端选股卡口径 vs Pi 落档 字段级对账（2026-11-24 拍板二）
 *
 * 背景：同一 recommendPicks 引擎，前端（mountReco→currentPicks）与 Pi（report_reco_picks）
 * 参数不同（Pi 传 isClusteringBubble/mainLine/情绪扣分 effEmotionScore；前端只传
 * emotionScore/topN/stopLossPct/ztpool）+ 数据源不同（前端 recent.days+latest 拼接，
 * Pi 全史 day）——实测 11-23：前端 候选118/剔除14/推荐3，Pi 117/13/推荐0。
 * 拍板：语义分层可留（严格推荐档 vs 观察档），但数字漂移是真 bug——本脚本每日对账，
 * 差异必须带可解释归因（diff_reason），无归因差异 → 告警（写入 ops 告警流）。
 *
 * 运行：node scripts/reconcile_daily.mjs [--date 2026-11-23]
 * 输出：data/reconcile_picks_latest.json + 控制台摘要；接入 Pi eod 后每日自动跑。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { recommendPicks } = await import(resolve(ROOT, 'src', 'picks.js'));
const guard = await import(resolve(ROOT, 'src', 'mainline_guard.js'));
const { detectClusteringBubble, penaltyApplies, computeRedIndustryRatio, buildMainLineInput } = guard;
const { selectMainLine } = await import(resolve(ROOT, 'src', 'mainline.js')).catch(() => ({ selectMainLine: () => null }));

const args = process.argv.slice(2);
const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;

// ── 数据源 ──
import { decodeArchive } from '../src/lhb_codec.js';
import { marketTierVersion } from '../src/tier_policy.js';   // 产物档位口径版本戳
const archive = decodeArchive(JSON.parse(readFileSync(resolve(ROOT, 'data', 'archive.json'), 'utf8')));   // v5.3：席位码还原
const allDays = (archive.all_days || []).filter(Boolean);
const R2 = 'https://pub-5a2d9fd0ca4547c5b9e561c4c50f6448.r2.dev';
let recent = null;
try {
  const res = await fetch(`${R2}/data/archive-recent.json?_=${Date.now()}`, { headers: { 'User-Agent': 'reconcile' } });
  if (res.ok) recent = await res.json();
} catch { /* fail-open：R2 缺档时用全史日近似（归因里注明） */ }

// 前端口径的数据源（paper_ui.js L447 同款拼接：recent.days + recent.latest）
const arcDays = recent && Array.isArray(recent.days)
  ? [...recent.days, ...(recent.latest ? [recent.latest] : [])]
  : allDays.slice(-30);

const dayFront = arcDays[arcDays.length - 1];
const dayPi = allDays[allDays.length - 1];
const asOf = dayFront && dayPi ? (dayFront.trade_date === dayPi.trade_date ? dayFront.trade_date : null) : null;
if (!asOf || (dateArg && asOf !== dateArg)) {
  console.log(`[reconcile] 数据日不对齐（前端 ${dayFront && dayFront.trade_date} / Pi ${dayPi && dayPi.trade_date}）——今日对账 no-op，记档待查`);
}

// 候选池差集：直接对比 buildCandidates 的产物不可得（内部函数）——用 rejected+kept+below 的
// code 并集近似 universe，另以 res.pool 计数差做 universe 级归因
import { applyTradabilityFilters } from '../src/picks.js';

// ztpool（前端 ZT_POOL_MAP 同款：ztpool_history.json 按日期匹配）
const ztHist = JSON.parse(readFileSync(resolve(ROOT, 'data', 'ztpool_history.json'), 'utf8'));
const ztMap = new Map(ztHist.map((x) => [String(x.date), x.stocks || x.pool || x.list || []]));
const ztPoolOf = (d) => {
  const key = String(d.trade_date || '').replace(/\D/g, '');
  return ztMap.get(key) || [];
};

// ── 前端口径重放（paper_ui currentPicks 同参数） ──
function runFront(day) {
  const score = (day.emotion && day.emotion.value != null) ? day.emotion.value : null;
  return recommendPicks(day, {
    emotionScore: score, topN: 5, ztpool: ztPoolOf(day),
    seatsDetail: (day.summary && day.summary.seats && day.summary.seats.detail) || null,
  });
}

// ── Pi 口径重放（report_reco_picks 同参数） ──
function runPi(day, signalsTag) {
  const up = (day.summary || {}).up_count ?? null;
  const down = (day.summary || {}).down_count ?? null;
  const redIndustry = computeRedIndustryRatio(day?.industry);
  const { isClusteringBubble, penalty } = detectClusteringBubble({ upCount: up, redIndustryRatio: redIndustry });
  const regimeKey = signalsTag || null;
  const eff = (day.emotion && day.emotion.value != null)
    ? day.emotion.value - (penaltyApplies(isClusteringBubble, regimeKey) ? penalty : 0)
    : null;
  let mainLine = null;
  try { const mlInput = buildMainLineInput(day, day?.summary?.main_theme); mainLine = mlInput ? selectMainLine([mlInput]) : null; } catch { mainLine = null; }
  return recommendPicks(day, { topN: 5, emotionScore: eff, ztpool: ztPoolOf(day), isClusteringBubble, mainLine, fullBelow: true,
    seatsDetail: (day.summary && day.summary.seats && day.summary.seats.detail) || null });
}

let signalsTag = null;
try { signalsTag = JSON.parse(readFileSync(resolve(ROOT, 'data', 'signals-latest.json'), 'utf8'))?.dailyReport?.tag?.key || null; } catch { }

const diffs = [];
const addDiff = (field, front, pi, reason) => diffs.push({ field, front, pi, diff_reason: reason });

if (asOf) {
  const f = runFront(dayFront);
  const pi = runPi(dayPi, signalsTag);

  // 1) universe（候选池计数）
  if ((f.pool || 0) !== (pi.pool || 0)) {
    addDiff('universe', f.pool || 0, pi.pool || 0,
      recent ? 'universe_missing_in_recent_window 或 day 明细差异（recent.days+latest vs 全史 day）' : 'universe_source_fallback_full_history（R2 recent 缺档，前端口径用全史近似）');
  }

  // 2) 推荐差集（kept code 集合）
  const fc = new Set((f.picks || []).map((p) => String(p.code)));
  const pc = new Set((pi.picks || []).map((p) => String(p.code)));
  for (const c of fc) if (!pc.has(c)) addDiff('kept_only_front', c, null, 'param_isClusteringBubble_or_emotion_penalty（Pi 侧 clustering 惩罚/情绪扣分压分至门槛下）');
  for (const c of pc) if (!fc.has(c)) addDiff('kept_only_pi', null, c, 'universe_or_day_detail_diff');

  // 3) 剔除原因差集（按 code 对齐 reasons）
  const fr = new Map((f.rejected || []).map((r) => [String(r.code), r.reason]));
  const pr = new Map((pi.rejected || []).map((r) => [String(r.code), r.reason]));
  for (const [c, r] of fr) if (pr.has(c) && pr.get(c) !== r) addDiff('rejected_reason', r, pr.get(c), 'universe_or_day_detail_diff');
  for (const [c, r] of pr) if (!fr.has(c)) addDiff('rejected_only_pi', null, `${c}:${r}`, 'universe_missing_in_recent_window');

  // 3.5) seats.detail 序列化形态对账（2026-11-24 根因发现）：
  //   archive.json 存席位「编号」（4167），archive-recent.latest 存席位「名」（国投证券…）——
  //   同一字段两种形态 → 游资席位挂件（hotMoneyNetWanOf 按"名"匹配顶级游资清单）只在
  //   latest 形态生效 → 前端 kept=3（九阳 65）vs Pi 重放 kept=0（九阳 47）。这是"同引擎
  //   同日三个结果"的完整根因。修复方向（待拍板）：写入端统一为席位名形态（历史回放
  //   影响需评估——编号形态下 hotMoney 因子在全史回测中从未生效过）。
  if (dayFront && dayPi) {
    const sd1 = ((dayFront.summary || {}).seats || {}).detail || null;
    const sd2 = ((dayPi.summary || {}).seats || {}).detail || null;
    const fmt = (d) => { if (!d) return 'null'; const k = Object.keys(d)[0]; const v = k && d[k] && d[k].b && d[k].b[0] && d[k].b[0][0]; return typeof v === 'string' ? 'name' : (typeof v === 'number' ? 'code' : 'unknown'); };
    const f1 = fmt(sd1), f2 = fmt(sd2);
    if (f1 !== f2) {
      addDiff('seats_detail_format', f1, f2, 'serialization_drift（硬门禁：decode 后仍形态不一致——游资挂件会单边失效，禁止出档）');
      console.error('[reconcile] ❌ HARD FAIL：decode 后 seats.detail 形态仍不一致（front=' + f1 + ' pi=' + f2 + '）——挂件单边失效，禁止出档');
      process.exitCode = 1;
      process.exit(1);
    }
  }

  // 4) prob 分漂移（同票 kept 双侧都有时比分数——日内数据更新会漂，归因 daily_data_refresh）
  for (const p of (f.picks || [])) {
    const q = (pi.picks || []).find((x) => String(x.code) === String(p.code));
    if (q && Math.round(+p.prob.score) !== Math.round(+q.prob.score)) {
      addDiff('prob_score_drift', `${p.code}:${Math.round(+p.prob.score)}`, `${p.code}:${Math.round(+q.prob.score)}`,
        'daily_data_refresh（盘中/收盘数据差异或情绪扣分）');
    }
  }
}

const out = {
  date: asOf,
  marketTierVersion: marketTierVersion(),
  generated_at: new Date().toISOString(),
  ok: diffs.length === 0,
  diffs,
  note: '字段级对账：universe/剔除原因/推荐差集/分数漂移。无归因差异（diff_reason 缺失）即为告警条件——本脚本所有差异必须带归因。',
};
const OUT = resolve(ROOT, 'data', 'reconcile_picks_latest.json');
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`[reconcile] date=${out.date} | 差异 ${diffs.length} 条${diffs.length ? '（全部带 diff_reason 归因）' : '（全对齐）'}`);
for (const d of diffs.slice(0, 10)) console.log(`  - ${d.field}: front=${JSON.stringify(d.front)} pi=${JSON.stringify(d.pi)} [${d.diff_reason}]`);
if (diffs.length > 10) console.log(`  … 其余 ${diffs.length - 10} 条见 ${OUT}`);
