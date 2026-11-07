// ⑧c 妖股标记历史留存（2026-11-07，TSP 借鉴「追高风险收益对照」前置账本）。
//
// 背景：妖股引擎（scripts/fetch_dragon_logic.mjs，GLM）每天覆盖输出
// llm-dragon-logic-latest.json——纯情绪标记（is_pure_sentiment）没有历史留存，
// 「🕵 纯情绪炒作」的判断无法事后用次日真实表现验证（TSP 的对照思路：
// 判断必须能被回测检验，否则只是嘴上功夫）。
//
// 本脚本在 EOD 追加当日标记摘要到 data/dragon_marks_history.json（幂等，同日覆盖）。
// 验证脚本见 scripts/dragon_purity_validation.mjs（T+1 续板率对照，ztpool_history 池状态）。
//
// 口径：候选池 = 连续连板口径（东财 zt_lb），见 fetch_dragon_logic.mjs 头注释；
// 与日报天梯的 zt_lbw 不同源——本账本存的正是引擎当日实际输出，验证口径自洽。
//
// 只读输入：data/llm-dragon-logic-latest.json；写：data/dragon_marks_history.json。
// 缺输入文件 → 退出 0（fail-open，EOD 链不因本账本中断）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data', 'llm-dragon-logic-latest.json');
const OUT = join(ROOT, 'data', 'dragon_marks_history.json');

if (!existsSync(SRC)) {
  console.log('[dragon_marks] 无 llm-dragon-logic-latest.json（引擎未跑），跳过');
  process.exit(0);
}

let src;
try {
  src = JSON.parse(readFileSync(SRC, 'utf8'));
} catch (e) {
  console.error('[dragon_marks] 引擎输出解析失败：', e.message);
  process.exit(0); // fail-open
}

const asOf = (src.asOfDate || '').replaceAll('-', '');
if (!/^\d{8}$/.test(asOf)) {
  console.error('[dragon_marks] asOfDate 缺失或格式异常：', src.asOfDate);
  process.exit(0);
}

const marks = (src.dragons || []).map((d) => ({
  code: d.code, name: d.name, lb: d.lb ?? null,
  is_pure: !!d.is_pure_sentiment,
  reason: (d.reason || '').slice(0, 60),
}));

let hist;
try { hist = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) { hist = null; }
if (!hist || !Array.isArray(hist.days)) {
  hist = {
    meta: {
      created: new Date().toISOString(),
      note: '妖股纯情绪标记历史（每日 EOD 留存，同日覆盖幂等）；'
        + '验证脚本 scripts/dragon_purity_validation.mjs（T+1 续板率对照）',
      source: 'llm-dragon-logic-latest.json::dragons（连续连板口径 zt_lb）',
    },
    days: [],
  };
}

const day = { date: asOf, marks, savedAt: new Date().toISOString() };
const idx = hist.days.findIndex((d) => d.date === asOf);
if (idx >= 0) hist.days[idx] = day; else hist.days.push(day);
hist.days.sort((a, b) => a.date.localeCompare(b.date));
hist.meta.updated = new Date().toISOString();
hist.meta.days = hist.days.length;

writeFileSync(OUT, JSON.stringify(hist, null, 2));
const pure = marks.filter((m) => m.is_pure).length;
console.log(`[dragon_marks] ${asOf}：标记 ${marks.length} 只（纯情绪 ${pure}）→ 账本 ${hist.days.length} 天`);
