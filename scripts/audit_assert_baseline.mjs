// 断言基线审计（2026-11-13 豆包第五轮：同源动态期望=循环论证，需打标）
// 用法：node scripts/audit_assert_baseline.mjs [--fix-list]
// 输出：test/*.mjs 全部断言按期望值来源分类——
//   HARD  独立基准（字面量/独立常量）→ 可信
//   DYN   同源动态（期望值来自被测同档数据的变量）→ 循环论证，逐条复核：
//         要么补一条独立基准断言，要么显式降级为冒烟测试（标题标注 [smoke]）
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'test';
const files = readdirSync(dir).filter((f) => /\.mjs$/.test(f));
let hardN = 0, dynN = 0;
const dynList = [];
for (const f of files) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n');
  // 启发式：测试体内 readJsonSafe/import 读的档数 ≥2 → 同源动态断言多为「对照」（跨源一致性），
  // 单源 → 多为「自证」（A 显示成 A 的循环论证）。人工复核以此清单为起点，不做最终裁决。
  const srcs = new Set(
    [...lines.join('\n').matchAll(/readJsonSafe\('([^']+)'\)|readFileSync\(join\([^,]+,\s*'([^']+)'\)/g)]
      .map((m) => m[1] || m[2]),
  );
  const kind = srcs.size >= 2 ? '对照候选[cross-check?]' : '自证嫌疑[真循环论证?]';
  lines.forEach((l, i) => {
    const m = l.match(/assert\.(ok|equal|deepEqual|match)\(/);
    if (!m) return;
    const rest = l.slice(l.indexOf('('));
    const isDyn = /\b(bw|bm|nh|nl|ud|d|a|s|c|w|h)\.\w/.test(rest) || rest.includes('${');
    if (isDyn) { dynN++; dynList.push(`${f}:${i + 1} ${kind}  ${l.trim().slice(0, 100)}`); }
    else hardN++;
  });
}
console.log(`断言总数: ${hardN + dynN} | HARD(独立基准): ${hardN} | DYN(需分类): ${dynN}`);
if (process.argv.includes('--fix-list')) console.log(dynList.join('\n'));
