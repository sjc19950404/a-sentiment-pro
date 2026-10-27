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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DUAL = resolve(ROOT, 'data/paper/dual_track_latest.json');
const ZTPOOL = resolve(ROOT, 'data/ztpool_history.json');
const OUT = resolve(ROOT, 'data/reco_picks_latest.json');
const TOP_N = 6;

// 当日涨停池：ztpool_history 按日匹配 day.date（归一化去非数字）
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

function main() {
  const dual = readJsonSafe(DUAL);
  if (!dual) { console.error('[reco-picks] 读取 dual_track_latest.json 失败 → 跳过'); process.exit(0); }
  const day = dual.day || dual;
  const date = day.date || (dual.day && dual.day.date) || null;
  const emotionScore = Number.isFinite(+day.score) ? +day.score : null;
  const ztpool = loadZtpoolForDay(date);

  const res = recommendPicks(day, { topN: TOP_N, emotionScore, ztpool });

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
      reasons: r.reasons || [],
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
