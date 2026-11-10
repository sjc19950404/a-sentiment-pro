#!/usr/bin/env node
/**
 * 竞价打分阈值敏感性对照（2026-11-10 拍板配套：阈值参数项留对照回测入口）。
 * 扫 chgThreshold × yiziRatioMax 网格，对 auction_history 全档重算，输出各信号的
 *   标记数量矩阵——用于判断阈值选择是否稳健（样本不足时如实提示「等样本」）。
 * 只读原档、不落库、不改任何生产参数。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { scoreAuctionDay } from '../src/auction_score.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AH = join(ROOT, 'data/auction_history.json');

if (!existsSync(AH)) { console.log('[auction-sens] auction_history 尚无档（11-11 首跑后可用）'); process.exit(0); }
const hist = JSON.parse(readFileSync(AH, 'utf8'));
const days = Array.isArray(hist) ? hist.filter((d) => d && Array.isArray(d.items) && d.items.length) : [];
if (!days.length) { console.log('[auction-sens] 无有效日记录'); process.exit(0); }

// 昨日成交额映射（仅末条池可用；跨日精确对齐留给样本积累后完善——如实标注局限）
const prevMap = new Map();
try {
  const zt = JSON.parse(readFileSync(join(ROOT, 'data/ztpool_history.json'), 'utf8'));
  const zlast = zt[zt.length - 1];
  for (const s of (zlast && zlast.pool) || []) if (s && Number.isFinite(+s.amount)) prevMap.set(String(s.c), +s.amount);
} catch { /* 缺席 → 占比全 null */ }

const CHG = [0.02, 0.03, 0.04, 0.05];
const YIZI = [0.01, 0.02, 0.03];
console.log(`══ 竞价打分阈值敏感性（样本 ${days.length} 天 · ${days[0].trade_date}~${days[days.length - 1].trade_date}）══`);
console.log('占比映射：仅用 ztpool 末条昨日额近似（跨日精确对齐待样本积累）\n');
console.log('chg阈值  一字占比阈值   强势  走弱  中性  一字缩量  一字放量  占比缺失');
for (const c of CHG) {
  for (const y of YIZI) {
    const agg = { strong: 0, weak: 0, neutral: 0, yiziShrink: 0, yiziHeavy: 0, amtRatioMissing: 0 };
    for (const d of days) {
      const r = scoreAuctionDay(d, { chgThreshold: c, yiziRatioMax: y, prevTurnoverByCode: prevMap });
      if (!r) continue;
      for (const k of Object.keys(agg)) agg[k] += r.signals[k] || 0;
    }
    console.log(
      `±${(c * 100).toFixed(0)}%     <${(y * 100).toFixed(0)}%          ` +
      `${String(agg.strong).padStart(4)} ${String(agg.weak).padStart(5)} ${String(agg.neutral).padStart(5)}  ` +
      `${String(agg.yiziShrink).padStart(7)}  ${String(agg.yiziHeavy).padStart(7)}  ${String(agg.amtRatioMissing).padStart(7)}`
    );
  }
}
if (days.length < 5) console.log('\n⚠ 样本 < 5 天，矩阵仅供参考——满 5 天后重跑本工具再定阈值。');
