// 运行时环境自检回归（2026-11-13）：crontab 无 PATH → 系统 node20 → jsdom 加载失败 →
//   47 个 DOM 测试静默 skip，短报却显示 0 fail。本测试锁住「声明必须被执行时刻验证」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRuntime, majorOf, minMajorOf, RUNTIME_CODE } from '../src/runtime_preflight.mjs';

test('解析版本与 engines 范围', () => {
  assert.equal(majorOf('v22.23.3'), 22);
  assert.equal(majorOf('20.19.2'), 20);
  assert.equal(majorOf('garbage'), null);
  assert.equal(minMajorOf('>=22'), 22);
  assert.equal(minMajorOf('^22.22.2 || ^24.15.0 || >=26'), 22);
});

test('本机实际运行环境 → runtime_ok', () => {
  const r = checkRuntime();
  assert.equal(r.ok, true, `本机 ${r.node} 低于声明：${r.reason}`);
  assert.equal(r.code, RUNTIME_CODE.OK);
});

test('模拟 cron 曾用的 node v20 → runtime_mismatch，带原因', () => {
  const r = checkRuntime({ version: 'v20.19.2', enginesRange: '>=22' });
  assert.equal(r.ok, false);
  assert.equal(r.code, RUNTIME_CODE.MISMATCH);
  assert.match(r.reason, /低于 package.json engines/);
});

test('engines 声明缺失/无法解析 → 不匹配（不静默放行）', () => {
  assert.equal(checkRuntime({ version: 'v22.0.0', enginesRange: '' }).ok, false);
  assert.equal(checkRuntime({ version: 'nonsense', enginesRange: '>=22' }).ok, false);
});

test('更高版本 → 通过（不把升级当故障）', () => {
  assert.equal(checkRuntime({ version: 'v24.15.0', enginesRange: '>=22' }).ok, true);
});
