#!/usr/bin/env node
/* threshold_recalibration.mjs —— s_net 复活后的绝对分阈值重校准（2026-11-24 用户拍板：优先级高于换手规则）
 *
 * 【问题】TIER_THRESHOLDS={overheat:80,full:65,half:24} 是七因子情绪分的绝对分档。
 * v5.2 裸档 lhb 明细被 codec 打包 → s_net（20% 权重）归零，实际是六因子按 80% 分母
 * 跑出来的分数，其余因子被隐式放大 1.25 倍。v5.3 decode 让 s_net 复活 → 分数分布
 * 整体移动 → 绝对档位可能系统性偏一档（T+1 仓位档），这是最大的操作风险。
 *
 * 【方法】同一公式版本（v5.2-pro）、同一批交易日，分别用裸档 / decode 档跑
 * computeAllVersions 重算分数——唯一变量是 lhb 明细有无（s_net 是否活着）。
 * 输出：80/65/24 在 v5.3 分布中的分位、中位偏移、档位迁移矩阵；中位偏移 >5 分
 * → 按用户判据建议绝对档改分位档（不自动改，交拍板）。
 *
 * 运行：node tools/backtest/threshold_recalibration.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { decodeArchive } = await import(resolve(ROOT, 'src/lhb_codec.js'));
const { computeAllVersions } = await import(resolve(ROOT, 'src/formula_versions.js'));
const { TIER_THRESHOLDS } = await import(resolve(ROOT, 'src/picks.js'));

const RAW = JSON.parse(readFileSync(resolve(ROOT, 'data/archive.json'), 'utf8'));
const DEC = decodeArchive(RAW);
const daysOf = (a) => (a.all_days || []).filter((d) => d && d.trade_date);
const rawDays = daysOf(RAW), decDays = daysOf(DEC);

const raw = computeAllVersions(rawDays, ['v5.2-pro']);
const dec = computeAllVersions(decDays, ['v5.2-pro']);
const score = (r) => r && Number.isFinite(+r.score) ? +r.score : null;
const rs = raw['v5.2-pro'].map(score), ds = dec['v5.2-pro'].map(score);
const pairs = rs.map((v, i) => ({ date: rawDays[i].trade_date, old: v, now: ds[i] }))
  .filter((x) => x.old != null && x.now != null);
console.log(`[recal] 有效配对 ${pairs.length} 日（v5.2-pro 同公式，唯一变量=lhb 明细/s_net）`);

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const mo = median(pairs.map((x) => x.old)), mn = median(pairs.map((x) => x.now));
console.log(`\n中位数：v5.2 裸档(s_net死) ${mo?.toFixed(2)} → v5.3 decode(s_net活) ${mn?.toFixed(2)} | 偏移 ${(mn - mo)?.toFixed(2)} 分${Math.abs(mn - mo) > 5 ? ' ⚠ >5 分（按判据须改分位档）' : '（≤5 分，绝对档可暂留）'}`);

// 绝对阈值在新分布中的分位：有多少 decode 分数落在阈值下方
const newScores = pairs.map((x) => x.now);
const quantileOf = (v) => newScores.filter((x) => x < v).length / newScores.length;
console.log('\n绝对阈值在 v5.3（s_net 复活）分布中的分位：');
for (const [name, th] of Object.entries(TIER_THRESHOLDS)) {
  console.log(`  ${name}=${th} → 分位 ${(quantileOf(th) * 100).toFixed(1)}%（旧分布中该阈值分位 ${(pairs.filter((x) => x.old < th).length / pairs.length * 100).toFixed(1)}%）`);
}

// 档位迁移矩阵（用户关心的"T+1 仓位偏一档"）
const tierOf = (v) => v >= TIER_THRESHOLDS.overheat ? '过热' : v >= TIER_THRESHOLDS.full ? '满仓' : v > TIER_THRESHOLDS.half ? '半仓' : '清仓';
const mtx = new Map();
for (const p of pairs) {
  const k = tierOf(p.old) + '→' + tierOf(p.now);
  mtx.set(k, (mtx.get(k) || 0) + 1);
}
console.log('\n档位迁移矩阵（旧档→新档，天数）：');
for (const [k, v] of [...mtx].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
const changed = pairs.filter((p) => tierOf(p.old) !== tierOf(p.now)).length;
console.log(`迁移占比 ${(changed / pairs.length * 100).toFixed(1)}%——>20% 则绝对阈值对仓位档的影响是系统性的。`);

console.log('\n【判据】中位偏移 >5 分 → 绝对阈值 80/65/24 改分位档（例如过热=P90 / 满仓=P75 / 清仓=P10），');
console.log('否则保留绝对档但需在新口径下重跑双轨账本（旧账本标"s_net 归零 + 席位身份缺失"双缺口径）。');
