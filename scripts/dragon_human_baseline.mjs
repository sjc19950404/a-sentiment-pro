#!/usr/bin/env node
/**
 * dragon_human_baseline.mjs — ⑧c 人机对照基线（2026-11-09 建，同日因 reset 陷阱改版）
 *
 * 目的：⑧c 妖股验证账本只验证 GLM 标记的次日区分度；本侧车同结构攒第二份样本——
 *   人的盘感判断。同一批标记、同一批改口径，双份命中率对照，可回答：
 *   「人的主观判断是否比 GLM 标记更准」以及「人的校准度如何」。
 *
 * ⚠ 设计变更（2026-11-09 审计发现）：本账本 data/human_baseline.json 是 git 跟踪文件，
 *   而 pi_run 每个 tick 开头 reset --hard origin/main——**就地编辑跟踪文件会被下个 tick 清掉**。
 *   因此人工判断改为写在 **未跟踪文件 data/human_guesses.local.json**（gitignore，
 *   reset 不受影响），本脚本每次运行把它合并进账本（账本内 guess 字段随 git 留存）。
 *
 * 人工动作（每天一次，约 30 秒）：
 *   编辑 data/human_guesses.local.json，按 "日期:代码" 为键填 "cont" 或 "break"：
 *     { "20261106:601599": "cont", "20261106:002578": "break" }
 *     "cont"  = 判断明天续板（连板）
 *     "break" = 判断明天断板/炸板
 *     不填的标的自动跳过，不进统计。填完保存即可，其余全自动（合并/批改/统计）。
 *
 * 批改口径（与 scripts/dragon_purity_validation.mjs 完全一致，保证两组样本可比）：
 *   T+1 涨停池中该股 lbc === 前日 lbc+1 且未炸板(zbc=0) → 'continue'，否则 'blast'。
 *   涨停池历史为滚动保留（当前约 16 日），批改须在约 2 周内完成——EOD 自动跑无此风险。
 *
 * 纪律：fail-open；幂等同日覆盖；只读 ztpool_history / dragon_marks_history / 猜测文件，
 *   写 data/human_baseline.json（跟踪，随 data/ 自动提交）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MARKS = path.join(ROOT, 'data', 'dragon_marks_history.json');
const POOL = path.join(ROOT, 'data', 'ztpool_history.json');
const GUESS = path.join(ROOT, 'data', 'human_guesses.local.json'); // 未跟踪，人工编辑入口
const OUT = path.join(ROOT, 'data', 'human_baseline.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readJsonSafe = (p, dflt) => { try { return readJson(p); } catch { return dflt; } };

try {
  const hist = readJson(MARKS);
  const poolHist = readJson(POOL); // [{date:"20261106", pool:[{c,lbc,zbc,...}]}]
  const poolByDate = new Map(poolHist.map((d) => [d.date, d.pool || []]));
  const datesAsc = poolHist.map((d) => d.date);
  const guesses = readJsonSafe(GUESS, {});

  // 现有账本（保留已合并的 guess 与批改结果）
  const cur = readJsonSafe(OUT, { kind: 'dragon-human-baseline', version: 1, updatedAt: null, rows: [], meta: {} });
  const rows = Array.isArray(cur.rows) ? cur.rows : [];
  const keyOf = (r) => `${r.date}:${r.code}`;
  const seen = new Set(rows.map(keyOf));

  // ① 快照：把妖股标记账本中尚缺的标记日行补入
  for (const day of hist.days || []) {
    for (const m of day.marks || []) {
      const k = `${day.date}:${m.code}`;
      if (seen.has(k)) continue;
      rows.push({
        date: day.date,
        code: m.code,
        name: m.name ?? '',
        is_pure: !!m.is_pure,
        reason: m.reason ?? '',
        guess: null,      // 由未跟踪猜测文件合并
        actual: null,     // 机器批改
        gradedAt: null,
      });
      seen.add(k);
    }
  }

  // ② 合并人工猜测（猜测文件为准；只认 cont/break 两个值）
  let merged = 0;
  for (const r of rows) {
    const g = guesses[keyOf(r)];
    if ((g === 'cont' || g === 'break') && r.guess !== g) { r.guess = g; merged++; }
  }

  // ③ 批改：guess 已填且未批改、且 T+1 池数据可用的行
  const nextPoolDate = (d8) => {
    const i = datesAsc.indexOf(d8);
    if (i < 0 || i + 1 >= datesAsc.length) return null;
    return datesAsc[i + 1]; // 池历史按日升序；相邻即下一交易日
  };
  for (const r of rows) {
    if (!r.guess || r.actual) continue;
    const prev = (poolByDate.get(r.date) || []).find((p) => p.c === r.code);
    const nd = nextPoolDate(r.date);
    if (!prev || !nd) continue; // 锚定缺失或 T+1 池未到，留待下次
    const row2 = (poolByDate.get(nd) || []).find((p) => p.c === r.code);
    r.actual = row2 && row2.lbc === prev.lbc + 1 && !row2.zbc ? 'continue' : 'blast';
    r.gradedAt = new Date().toISOString().slice(0, 10);
  }

  // ④ 统计（小样本期仅参考，门槛同 ⑧c：30 个标记日）
  const graded = rows.filter((r) => r.actual);
  const acc = (arr) => arr.length ? arr.filter((r) => r.guess === r.actual).length / arr.length : null;
  const statAll = acc(graded);
  const statHumanCont = acc(graded.filter((r) => r.guess === 'cont'));
  const GLM_ENOUGH = 30;
  cur.updatedAt = new Date().toISOString().slice(0, 10);
  cur.rows = rows;
  cur.meta = {
    批改口径: 'T+1 连板口径（同 dragon_purity_validation.mjs）：lbc+1 且未炸板=continue，否则 blast',
    玩法: '编辑 data/human_guesses.local.json（未入 git，reset 不会还原）：{"日期:代码":"cont|break"}；'
      + '每日 EOD 自动合并进本账本并批改。漏填自动跳过。',
    门槛: `样本 ≥${GLM_ENOUGH} 个标记日前，命中率数字仅供参考`,
  };

  fs.writeFileSync(OUT, JSON.stringify(cur, null, 1));

  const today = (hist.days || [])[((hist.days || []).length) - 1];
  const todayPending = today ? rows.filter((r) => r.date === today.date && !r.guess).length : 0;
  const pct1 = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
  console.log(
    `人机基线：累计 ${rows.length} 行｜本次合并猜测 ${merged} 条｜待人工 ${todayPending} 个今日标的` +
    `（填 ${GUESS.replace(ROOT + '/', '')}）｜已批改 ${graded.length}｜人的命中率 ${pct1(statAll)}（cont 组 ${pct1(statHumanCont)}）`
  );
} catch (e) {
  console.error('[dragon_human_baseline] 失败（best-effort，不影响 EOD）:', e.message);
  process.exit(1);
}
