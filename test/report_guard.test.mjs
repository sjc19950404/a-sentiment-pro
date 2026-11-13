// 产出闸门回归测试（2026-11-13）：断掉「改代码时测试全过 → 盘后产出脏档 → 次日体检才发现」的循环。
// 覆盖两道闸：①渲染出口不变量 ②落盘前契约校验。重点是「反例能被造出来」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDailyReport } from '../src/daily_report.js';
import { assertDailyReport, assertSignalsContract, GUARD_CODE, POINT_KINDS } from '../src/report_guard.mjs';

const ROOT = join(new URL('..', import.meta.url).pathname);
const diskSignals = () => JSON.parse(readFileSync(join(ROOT, 'data/signals-latest.json'), 'utf8'));
// 构造一份「结构合法」的报告：只用真实档里已过契约的 sections，避免把
// 磁盘档回灌渲染器造成的输入形态差异误判成渲染器缺陷（真实输入是 archive 拆出的素材）。
const validReport = () => ({ sections: JSON.parse(JSON.stringify(diskSignals().dailyReport.sections)) });

test('闸门①：渲染器真实输出每个 point 都有合法 kind → 通过', () => {
  const rep = buildDailyReport(diskSignals());   // 出口自检已内置；漏 kind 会当场抛
  assertDailyReport(rep);
  for (const s of rep.sections) {
    if (s.missing === true) continue;
    for (const p of s.points || []) {
      assert.equal(typeof p.text, 'string');
      assert.ok(POINT_KINDS.includes(p.kind), `section ${s.id} 的 point kind=${p.kind}`);
    }
  }
});

test('闸门①：故意删掉一个 point 的 kind → 立刻抛错并带原因码（本次事故的反例）', () => {
  const rep = validReport();
  const sec = rep.sections.find((s) => s.missing !== true && Array.isArray(s.points) && s.points.length);
  delete sec.points[0].kind;
  assert.throws(() => assertDailyReport(rep), (e) => {
    assert.match(e.message, new RegExp(GUARD_CODE.POINT_KIND));
    assert.match(e.message, /\/sections\/\d+\/points\/0/);   // 精确到出问题的 point
    return true;
  });
});

test('闸门①：kind 值非法（不在 schema 枚举）→ 也拦住', () => {
  const rep = validReport();
  const sec = rep.sections.find((s) => s.missing !== true && Array.isArray(s.points) && s.points.length);
  sec.points[0].kind = 'typo';
  assert.throws(() => assertDailyReport(rep), new RegExp(GUARD_CODE.POINT_KIND));
});

test('闸门①：missing=true 的节走 missingReason 分支，points 不受约束（字符串数组合法）', () => {
  const rep = { sections: [{ id: 'x', title: 'x', level: 'unknown', missing: true, missingReason: '缺数据', points: ['指引文案一', '指引文案二'] }] };
  assert.doesNotThrow(() => assertDailyReport(rep));
});

test('闸门①：渲染器既有的 ok/quote/warn 三种 kind 必须在枚举内（schema 曾漏列）', () => {
  for (const k of ['ok', 'quote', 'warn']) {
    assert.ok(POINT_KINDS.includes(k), `${k} 应被允许`);
    assertDailyReport({ sections: [{ id: 'x', missing: false, points: [{ text: 't', kind: k }] }] });
  }
});

test('闸门②：干净 signals 通过落盘校验', () => {
  assert.ok(assertSignalsContract(diskSignals()));
});

test('闸门②：脏档（point 缺 kind）→ 拒绝落盘、带原因码', () => {
  const bad = diskSignals();
  const sec = bad.dailyReport.sections.find((s) => s.missing !== true && Array.isArray(s.points) && s.points.length);
  delete sec.points[0].kind;
  assert.throws(() => assertSignalsContract(bad), (e) => {
    assert.match(e.message, new RegExp(GUARD_CODE.CONTRACT));
    assert.match(e.message, /拒绝落盘/);
    return true;
  });
  // 校验器不写盘：磁盘上的好档保持不变（不覆盖上一份）
  const onDisk = diskSignals();
  assert.ok(POINT_KINDS.includes(onDisk.dailyReport.sections[5].points[0].kind));
});

test('闸门②：JSON 往返对齐——undefined 字段不造成假阳性', () => {
  const s = diskSignals();
  s.dailyReport.transient = undefined;
  assert.ok(assertSignalsContract(s));
  assert.equal(s.dailyReport.transient, undefined);
});

// 契约漂移约束（2026-11-13 根因之一）：渲染器用了 ok/quote/warn，schema 枚举只列 5 种，
//   潜伏到条件分支命中才炸。三处枚举必须同源，加新 kind 漏改任一处 → 改代码时当场红。
test('契约同源：schema 枚举 === report_guard.POINT_KINDS === 渲染器实际用到的 kind', () => {
  const schema = JSON.parse(readFileSync(join(ROOT, 'schemas/signals-latest.schema.json'), 'utf8'));
  const daily = schema.properties.dailyReport.anyOf.find((b) => b.type === 'object');
  const enumFromSchema = daily.properties.sections.items.anyOf[0].properties.points.items.properties.kind.enum;
  assert.deepEqual([...POINT_KINDS].sort(), [...enumFromSchema].sort(), 'POINT_KINDS 与 schema enum 不一致');

  const src = readFileSync(join(ROOT, 'src/daily_report.js'), 'utf8');
  const used = [...new Set([...src.matchAll(/kind:\s*'([a-z]+)'/g)].map((m) => m[1]))].sort();
  for (const k of used) {
    assert.ok(POINT_KINDS.includes(k), `渲染器用了 schema 未声明的 kind=${k}（契约落后于实现）`);
  }
});
