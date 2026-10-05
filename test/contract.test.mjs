// ── 前后端接口契约守卫（V5.3 同步机制 · 2026-10-05）────────────────────────
//
// 三层守卫：
//   ① 磁盘档 vs 契约全绿锚定（门禁本体——接口漂移即红）
//   ② 校验器语义单元（required/类型/枚举/anyOf/$ref/additionalProperties/边界）
//   ③ 负向破坏演练：把 missingNote→missingReason 那次真实事故重演一遍，
//      确认校验器会拦（不会因为「字段存在但名字不对」而漏报）——守卫的守卫。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract, formatContractErrors } from '../src/contract.js';

const ROOT = join(dirname(fileURLToPath(import.meta.meta ? fileURLToPath(import.meta.url) : import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// ── ① 磁盘档全绿锚定：与 scripts/check_contract.mjs 同一套契约 ─────────────
const CONTRACTED = ['signals-latest', 'backtest', 'version-regression', 'archive-index', 'global', 'intraday'];
for (const name of CONTRACTED) {
  test(`契约锚定：data/${name}.json 符合 schemas/${name}.schema.json`, () => {
    assert.ok(existsSync(join(ROOT, `data/${name}.json`)), `data/${name}.json 应存在（intraday 在 CI 本地已生成）`);
    const errs = validateContract(load(`data/${name}.json`), load(`schemas/${name}.schema.json`));
    assert.deepEqual(errs, [], errs.length ? formatContractErrors(name, errs) : '');
  });
}

// ── ② 校验器语义单元 ──────────────────────────────────────────────────────
test('校验器：required 缺失报错且带 JSON Pointer 路径', () => {
  const errs = validateContract({}, { type: 'object', required: ['level'] });
  assert.equal(errs.length, 1);
  assert.equal(errs[0].path, '/level');
  assert.match(errs[0].hint, /前后端不同步/);
});

test('校验器：类型不符（含数组形态任一命中）', () => {
  assert.equal(validateContract('x', { type: 'number' }).length, 1);
  assert.equal(validateContract(null, { type: ['number', 'null'] }).length, 0);
  assert.equal(validateContract(3, { type: ['number', 'null'] }).length, 0);
});

test('校验器：枚举与常量（哨兵）', () => {
  assert.equal(validateContract('maybe', { type: 'string', enum: ['ok', 'warn'] }).length, 1);
  assert.equal(validateContract('signals-latest', { type: 'string', const: 'signals-latest' }).length, 0);
  assert.equal(validateContract('other', { type: 'string', const: 'signals-latest' }).length, 1);
});

test('校验器：数值边界与数组 items/minItems', () => {
  assert.equal(validateContract(101, { type: 'number', maximum: 100 }).length, 1);
  assert.equal(validateContract(-1, { type: 'number', minimum: 0 }).length, 1);
  assert.equal(validateContract([1], { type: 'array', items: { type: 'number' }, minItems: 2 }).length, 1);
  assert.equal(validateContract(['x'], { type: 'array', items: { type: 'number' } }).length, 1);
});

test('校验器：anyOf 三态（null 或对象）与失败诊断', () => {
  const schema = {
    anyOf: [
      { type: 'null' },
      { type: 'object', required: ['level'], properties: { level: { type: 'string' } } },
    ],
  };
  assert.equal(validateContract(null, schema).length, 0);
  assert.equal(validateContract({ level: 'ok' }, schema).length, 0);
  const errs = validateContract({ level: 42 }, schema);
  assert.equal(errs.length, 1);
  assert.match(errs[0].hint, /分支#2/); // 诊断必须指明哪个分支差在哪
});

test('校验器：$ref 本文件内解析与非法引用拦截', () => {
  const schema = {
    type: 'object', required: ['p'],
    properties: { p: { $ref: '#/$defs/perf' } },
    $defs: { perf: { type: 'object', required: ['annual'], properties: { annual: { type: 'number' } } } },
  };
  assert.equal(validateContract({ p: { annual: 1 } }, schema).length, 0);
  assert.equal(validateContract({ p: {} }, schema).length, 1);
  // 跨文件引用刻意不支持
  const bad = validateContract({ p: {} }, { type: 'object', properties: { p: { $ref: 'other.schema.json#/x' } } });
  assert.match(bad[0].hint, /不支持/);
});

test('校验器：additionalProperties 动态键值结构（version-regression.stats 模式）', () => {
  const schema = {
    type: 'object',
    additionalProperties: { type: 'object', required: ['scoreMean'], properties: { scoreMean: { type: 'number' } } },
  };
  assert.equal(validateContract({ v5: { scoreMean: 1 } }, schema).length, 0);
  assert.equal(validateContract({ v5: { scoreMean: 'x' } }, schema).length, 1);
  assert.equal(validateContract({ v5: {} }, schema).length, 1);
});

test('格式化输出：路径/期望/实际/指引四要素齐全（可执行错误提示）', () => {
  const out = formatContractErrors('data/x.json', validateContract({}, { type: 'object', required: ['level'] }));
  assert.match(out, /data\/x\.json\/level/);
  assert.match(out, /期望：/);
  assert.match(out, /实际：/);
  assert.match(out, /指引：/);
});

// ── ③ 负向破坏演练：重演 missingNote→missingReason 真实事故 ────────────────
//   用**真实契约**（schemas/signals-latest.schema.json 的 sections 双形态）演练，
//   而非手写严格 schema——守卫的守卫：确认线上那份契约本身能拦住那次事故。
test('负向演练：字段改名（missingReason→missingNote）必须被真实契约拦截', () => {
  const schema = load('schemas/signals-latest.schema.json');
  const sectionsPath = ['properties', 'dailyReport', 'anyOf', 1, 'properties', 'sections'];
  const sectionsSchema = sectionsPath.reduce((acc, k) => acc[k], schema);
  assert.ok(sectionsSchema, '契约结构漂移：dailyReport.sections 路径取不到（改契约须同步本测试）');

  // 后端改了名：missingNote 存在、missingReason 缺失（57a12b7 事故形态）
  //   注：sectionsSchema 的根就是数组本身（从契约深处取出，不含外层包装）
  const renamed = [{ id: 'llm', title: '八、舆情参考', missing: true, missingNote: '未生成' }];
  const errs = validateContract(renamed, sectionsSchema);
  assert.equal(errs.length, 1, '改名必须被拦：missing=true 形态要求 missingReason 必在');
  assert.equal(errs[0].path, '/0', '违例定位到具体节（items 索引路径）');
  assert.match(errs[0].hint, /分支#/);

  // 正常双形态都放行（防误伤）
  assert.equal(validateContract([{ id: 'a', title: '一', level: 'info', missing: false, points: [{ text: 'x', kind: 'main' }] }], sectionsSchema).length, 0);
  assert.equal(validateContract([{ id: 'b', title: '二', level: 'unknown', missing: true, missingReason: '未生成' }], sectionsSchema).length, 0);

  // 非 missing 节漏 points（整节渲染空白）同样必须拦
  const noPoints = [{ id: 'a', title: '一', level: 'info', missing: false }];
  assert.equal(validateContract(noPoints, sectionsSchema).length, 1);
});

test('负向演练：类型漂移（verdict.level 从枚举值变自定义串）被枚举拦截', () => {
  const schema = { type: 'string', enum: ['inst', 'north', 'hot', 'unknown'] };
  assert.equal(validateContract('vip', schema).length, 1);
});

test('负向演练：前端新消费字段（triggeredDays）漏产被 required 拦截', () => {
  const schema = {
    type: 'object', required: ['annual', 'triggeredDays'],
    properties: { annual: { type: 'number' }, triggeredDays: { type: 'number' } },
  };
  const errs = validateContract({ annual: -0.06 }, schema); // 后端旧版没产 triggeredDays
  assert.equal(errs.length, 1);
  assert.equal(errs[0].path, '/triggeredDays');
});
