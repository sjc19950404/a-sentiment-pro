// 方向判据回归对比：B1（分位差 ±15pp，2026-11-06 用户拍板的生产默认）vs A（绝对 ±6，旧尺）。
// 用途：① B1 落地验收（2026-11-06 结论：regime 结论层差异 11/256=4.3%，dir 差异 22 天中
//   68% 落在阈值边界带 |分位差|∈[10,20]——差异只在边界样本、无系统性漂移）；
//   ② 观察触发线复查工具（拍板留痕）：若 B1 方向翻转率仍 >60%（2026-11-06 实测 71.5%
//   已触发第一条），且 ebb 触发日与「绝对分变化 >1×IQR」的共现率 <50%，再回来评估
//   「连续 2 日同向才翻转」确认机制；在此之前只观察不动。
// 只读脚本，node scripts/dir_regime_regression.mjs
import { directionOf, classifyRegime } from '../src/regime.js';
import { decodeArchive } from '../src/lhb_codec.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arch = decodeArchive(JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8')));
const days = (arch.all_days || []).filter((d) => d && d.trade_date && d.emotion?.value != null && !d.emotion?._backfill);
const hist = days.map((d) => d.emotion.value);
const dates = days.map((d) => d.trade_date);
const nets = days.map((d) => (d.summary?.lhb_daily_net != null ? Number(d.summary.lhb_daily_net) : null));

const RULES_A = { DIR_MODE: 'abs', DIR_UP: 6, DIR_DOWN: -6 };
let diffs = [];
const run = (rules) => days.map((_, i) => {
  const r = directionOf(hist.slice(0, i + 1), rules ? { rules } : {});
  const reg = classifyRegime({ score: hist[i], pctRank: null, history: hist.slice(0, i + 1), ...(rules ? { } : {}) }, rules ? { rules } : {});
  return { dir: r.dir, key: reg.key };
});
const A = run(RULES_A);
const B = run(null);
for (let i = 3; i < days.length; i++) {
  if (A[i].dir !== B[i].dir) diffs.push({ date: dates[i], a: A[i].dir, b: B[i].dir, aKey: A[i].key, bKey: B[i].key });
}
const cnt = { up: 0, flat: 0, down: 0 };
const flips = (arr) => { let f = 0; for (let i = 4; i < arr.length; i++) if (arr[i].dir !== arr[i - 1].dir) f++; return f; };
B.slice(3).forEach((x) => cnt[x.dir]++);
const keyCnt = (arr) => arr.reduce((m, x) => (m[x.key] = (m[x.key] || 0) + 1, m), {});
console.log(`样本 ${days.length} 天（${dates[0]} ~ ${dates[dates.length - 1]}）\n`);
console.log(`A（绝对 ±6）：dir 翻转 ${flips(A)} 次｜regime: ${JSON.stringify(keyCnt(A.slice(3)))}`);
console.log(`B1（分位 ±15pp）：dir 翻转 ${flips(B)} 次｜regime: ${JSON.stringify(keyCnt(B.slice(3)))}`);
console.log(`\ndir 不同的天数: ${diffs.length}/${days.length - 3}（${(diffs.length / (days.length - 3) * 100).toFixed(1)}%）`);
// regime key 不同的天数（最终结论层差异）
let keyDiffs = 0, keyDiffList = [];
for (let i = 3; i < days.length; i++) if (A[i].key !== B[i].key) { keyDiffs++; keyDiffList.push(`${dates[i]}:${A[i].key}→${B[i].key}`); }
console.log(`regime 结论不同的天数: ${keyDiffs}（${(keyDiffs / (days.length - 3) * 100).toFixed(1)}%）`);
if (keyDiffList.length) console.log('  样例(前12):', keyDiffList.slice(0, 12).join('  '));
// 差异日的 delta 分布（是否边界样本：|分位差| 接近阈值 15）
const r1 = (x) => Math.round(x * 10) / 10;
const pcts = hist.map((v, i) => { const w = hist.slice(0, i + 1); return (w.filter((x) => x < v).length / w.length) * 100; });
const nearEdge = diffs.filter((x) => { const i = dates.indexOf(x.date); const d = r1(pcts[i] - pcts[Math.max(0, i - 3)]); return Math.abs(d) >= 10 && Math.abs(d) <= 20; }).length;
console.log(`\ndir 差异日中 |分位差|∈[10,20]（阈值 15 附近边界带）: ${nearEdge}/${diffs.length}`);
const last10 = diffs.slice(-10).map((x) => `${x.date}:${x.a}→${x.b}`).join('  ');
console.log('最近差异:', last10);
