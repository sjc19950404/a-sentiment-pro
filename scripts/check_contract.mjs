#!/usr/bin/env node
// ── 前后端接口契约门禁（V5.3 同步机制 · 2026-10-05）────────────────────────
//
// 用途：校验磁盘数据档 vs schemas/*.json 契约（单一数据源）。
//   后端漏产/改名/裁字段 → required 红；类型漂移 → type 红；
//   前端加消费字段 → 契约先改 → 后端没跟上 → 同样红。
// 两端谁脱轨都会在这里现形——这就是「字段名不一致静默渲染空白」类 bug
// （missingNote→missingReason，commit 57a12b7）的常驻拦截器。
//
// 用法：
//   node scripts/check_contract.mjs            # 校验全部档（默认）
//   node scripts/check_contract.mjs backtest   # 只校验某个档（名称匹配）
//
// 接线：
//   · daily.yml build 段（写盘后立即校验——坏档不进提交）
//   · test/contract.test.mjs（node --test 门禁自动带上）
//
// 缺档处理：档不存在 = 红而非跳过（与 check_frontend 的 --require-jsdom 同理：
//   门禁静默降级 = 假绿）。唯一例外：intraday.json 盘中才有，非交易时段允许缺
//   ——但只在「非 live 相位」下放行（读 archive-index.meta.phase 判断），并显式打印跳过原因。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract, formatContractErrors } from '../src/contract.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 档名 → 契约文件（数据档与契约同名映射，新增档必须补契约，否则下面的完整性
// 守卫会红——「新档没契约」本身就是同步缺口）。
const CONTRACTED = [
  'signals-latest',
  'backtest',
  'version-regression',
  'archive-index',
  'global',
  'intraday',
];

// ── 入口 ─────────────────────────────────────────────────────────────────
const filter = process.argv[2] || '';
const failures = [];
let checked = 0;
let skipped = 0;

for (const name of CONTRACTED) {
  if (filter && !name.includes(filter)) continue;
  const dataPath = join(ROOT, 'data', `${name}.json`);
  const schemaPath = join(ROOT, 'schemas', `${name}.schema.json`);

  if (!existsSync(schemaPath)) {
    failures.push(`[contract] 契约缺失：schemas/${name}.schema.json 不存在（CONTRACTED 清单里有它）`);
    continue;
  }
  // intraday：仅 live 相位必须存在（盘后档不产是设计，不是缺口）
  if (!existsSync(dataPath)) {
    if (name === 'intraday') {
      let phase = '(未知)';
      try {
        const idx = JSON.parse(readFileSync(join(ROOT, 'data', 'archive-index.json'), 'utf8'));
        phase = (idx.meta && idx.meta.phase) || '(无)';
      } catch { /* 读不到相位就按未知处理 */ }
      if (phase !== 'live') {
        skipped++;
        console.log(`[contract] ${name}.json 缺席（相位 ${phase} ≠ live，盘中档不产属设计）——跳过`);
        continue;
      }
    }
    failures.push(`[contract] 数据档缺失：data/${name}.json 不存在（契约要求它在；intraday 仅 live 相位例外）`);
    continue;
  }

  let data, schema;
  try { data = JSON.parse(readFileSync(dataPath, 'utf8')); } catch (e) {
    failures.push(`[contract] ${name}.json JSON 解析失败：${e.message}`);
    continue;
  }
  try { schema = JSON.parse(readFileSync(schemaPath, 'utf8')); } catch (e) {
    failures.push(`[contract] schemas/${name}.schema.json JSON 解析失败：${e.message}`);
    continue;
  }

  checked++;
  const errs = validateContract(data, schema);
  if (errs.length) {
    failures.push(formatContractErrors(`data/${name}.json`, errs));
  } else {
    console.log(`[contract] data/${name}.json ✓ 契约通过`);
  }
}

// ── 完整性守卫：schemas/ 目录里的契约必须在 CONTRACTED 清单（防孤儿契约：
//   档已下线但契约还挂着，误导后来人）──────────────────────────────────
import { readdirSync } from 'node:fs';
for (const f of readdirSync(join(ROOT, 'schemas'))) {
  if (!f.endsWith('.schema.json')) continue;
  const name = f.replace('.schema.json', '');
  if (!CONTRACTED.includes(name)) {
    failures.push(`[contract] 孤儿契约：schemas/${f} 不在 check_contract.mjs 的 CONTRACTED 清单里（档下线/改名须同步清单）`);
  }
}

if (filter && checked + skipped === 0) {
  console.error(`[contract] 过滤词「${filter}」未命中任何档（可选：${CONTRACTED.join(', ')}）`);
  process.exit(2);
}
if (failures.length) {
  console.error(`\n${failures.join('\n')}`);
  console.error(`\n[contract] ✗ 未通过：${failures.length} 个档违例（${checked} 校验 / ${skipped} 跳过）。`);
  console.error('[contract] 修复顺序：先改 schemas/ 契约（若有意变更）→ 同步两端代码 → 重跑本脚本与相关产出脚本。');
  console.error('[contract] 变更流程详见 schemas/signals-latest.schema.json 头注与 README「接口契约」章节。');
  process.exit(1);
}
console.log(`\n[contract] 全部通过：${checked} 个档（${skipped} 跳过）。前后端接口与 schemas/ 契约一致。`);
