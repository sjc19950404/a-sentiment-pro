// ⑧c 妖股纯情绪标记的次日真实表现验证（2026-11-07，TSP「追高风险收益对照」借鉴）。
//
// 问题：GLM 每天给妖股打「🕵 纯情绪炒作」标记（is_pure_sentiment），但这个判断
// 从未被事后数据检验过——读者无从知道“纯情绪”标记的股次日是更容易一字闷杀还是
// 照样连板。本脚本用两本账对答案：
//   账本 A：data/dragon_marks_history.json（每日标记留存，dragon_marks_history.mjs 写）
//   账本 B：data/ztpool_history.json（涨停池历史：lbc 连板数 / zbc 炸板次数 / zdp 涨跌幅）
// T+1 状态三分类（妖股语义：续板比涨跌幅更有信息量）：
//   续板   = D+1 在池且 lbc = D.lbc + 1
//   炸板   = D+1 在池但未续板（lbc ≤ D.lbc 或 zbc > 0）
//   未续板 = D+1 不在池（含跌停/平盘——池外行情未采集，保守合并，口径如实披露）
// 输出：纯情绪组 vs 其余组的续板率对照 + 样本量。样本 <30 个标记日时明示“积累中”。
//
// 只读脚本：node scripts/dragon_purity_validation.mjs [--json]
// 数据不足时 exit 0（报告如实说样本不够，不硬凑结论）。

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKS = join(ROOT, 'data', 'dragon_marks_history.json');
const POOL = join(ROOT, 'data', 'ztpool_history.json');
const JSON_OUT = process.argv.includes('--json');

if (!existsSync(MARKS) || !existsSync(POOL)) {
  console.log('[dragon_purity] 标记账本或涨停池历史缺失，无可验证样本（脚本/账本刚上线属正常）');
  process.exit(0);
}

const hist = JSON.parse(readFileSync(MARKS, 'utf8'));
const pool = JSON.parse(readFileSync(POOL, 'utf8'));
const poolByDate = new Map(pool.map((d) => [d.date, d.pool || []]));

const nextDate = (d8) => {
  const dates = pool.map((d) => d.date).filter((x) => x > d8).sort();
  return dates[0] || null;
};

// T+1 状态：'continue' | 'blast' | 'none'
function nextDayState(mark, d8) {
  const nx = nextDate(d8);
  if (!nx) return null;
  const row = poolByDate.get(nx).find((p) => p.c === mark.code);
  if (!row) return 'none';
  const prev = (poolByDate.get(d8) || []).find((p) => p.c === mark.code);
  const prevLbc = prev ? prev.lbc : null;
  if (prevLbc != null && row.lbc === prevLbc + 1 && !row.zbc) return 'continue';
  return 'blast';
}

const groups = { pure: [], other: [] };
let markDays = 0;
for (const day of hist.days) {
  const d8 = day.date;
  if (!poolByDate.has(d8)) continue; // 当日无池数据，无法锚定连板数
  let used = false;
  for (const m of day.marks || []) {
    const st = nextDayState(m, d8);
    if (!st) continue;
    (m.is_pure ? groups.pure : groups.other).push(st);
    used = true;
  }
  if (used) markDays++;
}

const stat = (arr) => {
  const n = arr.length;
  if (!n) return null;
  const cont = arr.filter((x) => x === 'continue').length;
  const blast = arr.filter((x) => x === 'blast').length;
  return { n, continueRate: cont / n, blastRate: blast / n, noneRate: (n - cont - blast) / n };
};
const sp = stat(groups.pure);
const so = stat(groups.other);
const ENOUGH = 30; // 标记日样本门槛（30 个交易日 ≈ 一个半月的观察）

const pct1 = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
const line = (label, s) => (s
  ? `${label}：样本 ${s.n} 只次｜T+1 续板率 ${pct1(s.continueRate)}｜炸板率 ${pct1(s.blastRate)}｜未续板 ${pct1(s.noneRate)}`
  : `${label}：样本 0`);

if (JSON_OUT) {
  console.log(JSON.stringify({ markDays, enough: markDays >= ENOUGH, pure: sp, other: so }, null, 2));
} else {
  console.log(`妖股纯情绪标记 · T+1 真实表现对照（连续连板口径；样本 ${markDays} 个标记日${markDays < ENOUGH ? `，门槛 ${ENOUGH}——积累中，以下数字仅供参考不构成规律` : ''}）`);
  console.log('  ' + line('🕵 纯情绪组', sp));
  console.log('  ' + line('其余标记 ', so));
  if (sp && so && markDays >= ENOUGH) {
    const d = sp.continueRate - so.continueRate;
    const verdict = Math.abs(d) < 0.05
      ? '两组续板率相近——「纯情绪」标记暂未体现次日区分度（口径与阈值需持续观察）'
      : d < 0
        ? '纯情绪组续板率显著更低——标记与次日走弱相关，🕵 提示有实际信息量'
        : '纯情绪组续板率反而更高——标记方向与直觉相反，需检查口径';
    console.log('  → ' + verdict);
  }
}
