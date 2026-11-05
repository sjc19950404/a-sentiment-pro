// 方向判据回归对比：B1（分位差 ±15pp，2026-11-06 用户拍板的生产默认）vs A（绝对 ±6，旧尺）。
// 用途：① B1 落地验收（2026-11-06 结论：regime 结论层差异 11/256=4.3%，dir 差异 22 天中
//   68% 落在阈值边界带 |分位差|∈[10,20]——差异只在边界样本、无系统性漂移）；
//   ② 观察触发线复查工具（拍板留痕）：若 B1 方向翻转率仍 >60%（2026-11-06 实测 71.5%
//   已触发第一条），且 ebb 触发日与「绝对分变化 >1×IQR」的共现率 <50%，再回来评估
//   「连续 2 日同向才翻转」确认机制；在此之前只观察不动。
// 阴跌钝化影响面（2026-11-06 复核共识）：钝化只发生在"分位已 0（历史极低水位）后继续
//   阴跌"的阶段——此时水位层已把仓位压死，方向判不出对仓位帽影响很小，危害有限；
//   真正会触发该特性的场景是"从 0 分位反弹后再阴跌"（分位差重新敏感），观察时留意。
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
// ⚠ 口径（2026-11-06 修正）：pctRank 必须传档案真实的 emotion.pct_rank（生产同源）——
//   修正前误传 null，classifyRegime 退化到绝对水位（40/65）判定，导致"ebb 77/73 天"
//   与敏感性回测（简化矩阵+分位水位，ebb 65/63 天）口径不一致、差 12/10 天。
//   两套数的口径对照（复盘勿混用）：
//   ① 敏感性回测（拍板依据，2026-11-06）：简化矩阵 + 现场滚动分位水位（<30/≥70）+
//      low 域全部归入 thaw 近似 → 只用于"方案间相对比较"；
//   ② 本回归（生产口径验收）：完整 classifyRegime 引擎 + 档案真实 pct_rank（primary:pct
//      生效）+ 逐日滚动窗口 → 与生产 regime 输出同构，是**验收口径**。
//   分类全集（REGIME_LABELS 六类）：ice 冰点 / recover 回暖 / climax 高潮 / ebb 退潮 /
//   neutral 中性 / unknown 数据不足——敏感性回测临时称的"thaw"即 recover（回暖），
//   复盘勿混用。unknown 在 i≥3 的判定日恒 0（level+dir 均可判），故六类合计=256。
//   样本/分母：259 个交易日；方向判定从 i=3 起有效 → 判定日 256；方向翻转率分母
//   **255**（= 256 个判定日的相邻对数；2026-11-06 修正：此前注释写 253 系笔误，
//   flips 循环 i=4..258 实际覆盖 255 对）。翻转率 181/255=71.0%。
const run = (rules) => days.map((d, i) => {
  const r = directionOf(hist.slice(0, i + 1), rules ? { rules } : {});
  const reg = classifyRegime(
    { score: d.emotion.value, pctRank: d.emotion.pct_rank ?? null, history: hist.slice(0, i + 1) },
    rules ? { rules } : {},
  );
  return { dir: r.dir, key: reg.key, shifted: !!reg.shifted };
});
const A = run(RULES_A);
const B = run(null);
for (let i = 3; i < days.length; i++) {
  if (A[i].dir !== B[i].dir) diffs.push({ date: dates[i], a: A[i].dir, b: B[i].dir, aKey: A[i].key, bKey: B[i].key });
}
const cnt = { up: 0, flat: 0, down: 0 };
const flips = (arr) => { let f = 0; for (let i = 4; i < arr.length; i++) if (arr[i].dir !== arr[i - 1].dir) f++; return f; };
B.slice(3).forEach((x) => cnt[x.dir]++);
// 六类全集显式补全（unknown 恒 0 也列出来，免得复盘以为漏了一类）
const KEYS = ['ebb', 'climax', 'ice', 'recover', 'neutral', 'unknown'];
const keyCnt = (arr) => {
  const m = arr.reduce((acc, x) => (acc[x.key] = (acc[x.key] || 0) + 1, acc), {});
  return Object.fromEntries(KEYS.map((k) => [k, m[k] || 0]));
};
console.log(`样本 ${days.length} 天（${dates[0]} ~ ${dates[dates.length - 1]}）｜判定日 ${days.length - 3}｜翻转率分母 ${days.length - 4}（相邻对：判定日 256 - 1）\n`);
console.log(`A（绝对 ±6，旧尺）：dir 翻转 ${flips(A)} 次`);
const ka = keyCnt(A.slice(3));
const shiftA = A.slice(3).filter((x) => x.shifted).length;
console.log(`  regime 六类: ${JSON.stringify(ka)}｜合计 ${Object.values(ka).reduce((a, b) => a + b, 0)}｜其中切换期(shifted) ${shiftA}`);
console.log(`B1（分位 ±15pp，生产默认）：dir 翻转 ${flips(B)} 次`);
const kb = keyCnt(B.slice(3));
const shiftB = B.slice(3).filter((x) => x.shifted).length;
console.log(`  regime 六类: ${JSON.stringify(kb)}｜合计 ${Object.values(kb).reduce((a, b) => a + b, 0)}｜其中切换期(shifted) ${shiftB}`);
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
