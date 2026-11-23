#!/usr/bin/env node
/* hotmoney_incremental.mjs —— 游资挂件单因子增量检验（2026-11-24 用户拍板：A 的前置条件）
 *
 * v5.3 让挂件复活（decode 席位名 + 标准化匹配 + 固定 +5 上限）。本脚本回答唯一问题：
 * **挂件复活后的增量是正还是负**——IC、命中组次日收益、去挂件前后 kept 集合变化。
 * 判据（拍板原文）：增量为负或不可解释 → 不该留在主线打分里（报告结论，不自动下线）。
 *
 * 运行：node tools/backtest/hotmoney_incremental.mjs [天数，默认 120]
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { decodeArchive } = await import(resolve(ROOT, 'src/lhb_codec.js'));
const { recommendPicks } = await import(resolve(ROOT, 'src/picks.js'));
const DAYS = +(process.argv[2] || 120);

const arch = decodeArchive(JSON.parse(readFileSync(resolve(ROOT, 'data/archive.json'), 'utf8')));
const days = (arch.all_days || []).filter((d) => d && d.trade_date).slice(-DAYS);

// 次日收益：breadth K 线缓存（close 序列）
const kline = {};
for (let i = 0; i < 20; i++) {
  const f = resolve(ROOT, 'data/.breadth_kline', `shard-${String(i).padStart(2, '0')}.json`);
  if (!existsSync(f)) break;
  Object.assign(kline, JSON.parse(readFileSync(f, 'utf8')));
}
const nextRet = (code, date) => {
  const rows = kline[String(code)];
  if (!Array.isArray(rows)) return null;
  const d8 = String(date).replace(/\D/g, '');
  const i = rows.findIndex((r) => r && String(r.d || '').replace(/\D/g, '') === d8);
  if (i < 0 || i + 1 >= rows.length) return null;
  const c0 = Number(rows[i] && rows[i].c), c1 = Number(rows[i + 1] && rows[i + 1].c);
  return Number.isFinite(c0) && Number.isFinite(c1) && c0 > 0 ? c1 / c0 - 1 : null;
};

let hotN = 0, keptWith = 0, keptWithout = 0, changed = 0, bothHit = 0, onlyHit = 0, onlyNoHit = 0;
let retHit = [], retNoHit = [];
const dateDiffs = [];
for (const day of days) {
  const seatsDetail = (day.summary && day.summary.seats && day.summary.seats.detail) || null;
  const base = { emotionScore: (day.emotion || {}).value ?? null, topN: 6, fullBelow: true };
  const off = recommendPicks(day, base);
  const on = recommendPicks(day, { ...base, seatsDetail });
  const offCodes = new Set((off.picks || []).map((p) => String(p.code)));
  const onCodes = new Set((on.picks || []).map((p) => String(p.code)));
  keptWith += onCodes.size; keptWithout += offCodes.size;
  for (const c of onCodes) if (!offCodes.has(c)) changed++;
  const hits = new Set();
  for (const p of (on.picks || []).concat(on.belowThreshold || [])) if (p.hotMoney) { hits.add(String(p.code)); hotN++; }
  for (const c of hits) { if (offCodes.has(c)) bothHit++; else onlyHit++; }
  for (const c of offCodes) if (!hits.has(c)) onlyNoHit++;
  if (onCodes.size !== offCodes.size) dateDiffs.push({ date: day.trade_date, off: offCodes.size, on: onCodes.size });
  // 次日收益分层（只对当日候选样本——去挂件前后行为比较）
  for (const p of (on.picks || []).concat((on.belowThreshold || []).slice(0, 20))) {
    const r = nextRet(p.code, day.trade_date);
    if (r == null) continue;
    (p.hotMoney ? retHit : retNoHit).push(r);
  }
}

const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const pct = (v) => v == null ? '—' : (v * 100).toFixed(2) + '%';
// 简化 IC：hotMoney 布尔 vs 次日收益的点二列相关
const all = retHit.map((r) => [1, r]).concat(retNoHit.map((r) => [0, r]));
let ic = null;
if (all.length > 10) {
  const mx = all.reduce((a, x) => a + x[0], 0) / all.length;
  const my = all.reduce((a, x) => a + x[1], 0) / all.length;
  const cov = all.reduce((a, x) => a + (x[0] - mx) * (x[1] - my), 0);
  const vx = all.reduce((a, x) => a + (x[0] - mx) ** 2, 0);
  const vy = all.reduce((a, x) => a + (x[1] - my) ** 2, 0);
  ic = vx && vy ? cov / Math.sqrt(vx * vy) : null;
}
const verdict = (retHit.length < 100 || retNoHit.length < 100 || ic == null) ? '样本不足，不能判定'
  : (ic <= 0 ? '增量为负/零——建议下线（不自动执行，交拍板）'
    : (changed / Math.max(1, keptWith) > 0.3 ? 'kept 变化 >30%——增量过大，挂件仍偏主导，需再降权'
      : '增量为正且 kept 变化可控——可保留在打分中（固定 +5 上限）'));

console.log(`\n═══ 游资挂件单因子增量检验（${days.length} 个交易日，v5.3）═══`);
console.log(`hotMoney 命中样本: ${hotN} | 有挂件 kept 合计 ${keptWith} / 无挂件 ${keptWithout} | kept 集合新增 ${changed}（${(changed / Math.max(1, keptWith) * 100).toFixed(1)}%）`);
console.log(`命中组次日收益 n=${retHit.length} 均值 ${pct(avg(retHit))} | 未命中组 n=${retNoHit.length} 均值 ${pct(avg(retNoHit))} | 差 ${pct(avg(retHit) != null && avg(retNoHit) != null ? avg(retHit) - avg(retNoHit) : null)}`);
console.log(`IC（hotMoney 布尔 vs 次日收益）: ${ic == null ? '—' : ic.toFixed(4)}`);
console.log(`判定: ${verdict}`);
console.log('注：v5.2 及之前全部冻结为"缺挂件口径"——本结果只适用于 v5.3，不得与历史分位数混比。');
