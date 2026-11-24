import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 's-root.js'), 'utf8').replace(/\r\n/g, '\n');

/* 【2026-11-25 移动端底栏回归守卫】
 * 事故：底栏（总览/涨跌停/选股/回测/更多）在窄屏点击全部无反应——
 * 转发逻辑拿 data-tab（英文 overview/zt/picks/backtest）与 TABS[+page]（中文
 * '总览'/'涨跌停'…）比较，恒不相等、link 恒 null。该功能从未生效过，因无任何
 * 测试覆盖而潜伏至今。此文件从源码层面守卫三件事：
 *   ① 显式中英映射存在（不得删）
 *   ② 转发使用映射（旧 bug 写法不得回潮）
 *   ③ 底栏点击同步 aria-current（旧逻辑底栏高亮永不更新） */

test('移动端底栏：显式中英映射存在且挂 window（供测试/审计读取）', () => {
  assert.match(src, /const MOBILE_TAB_TO_NAME = Object\.freeze\(\{/);
  assert.match(src, /window\.__sRootMobileTabMap__ = MOBILE_TAB_TO_NAME/);
  for (const key of ['overview', 'zt', 'picks', 'backtest']) {
    assert.match(src, new RegExp(key + ": '"), `映射缺少 key: ${key}`);
  }
  // 映射的值必须是 TABS 数组里真实存在的名字（防 TABS 改名后映射悬空）
  const tabsDef = src.match(/const TABS = \[([^\]]+)\]/);
  assert.ok(tabsDef, 's-root.js 必须定义 const TABS');
  for (const name of ['总览', '涨跌停', '选股', '回测']) {
    assert.ok(tabsDef[1].includes(`'${name}'`), `TABS 缺少 '${name}'——映射将悬空`);
  }
});

test('移动端底栏：转发使用映射，旧 bug 写法（英文===中文）不得回潮', () => {
  assert.match(src, /MOBILE_TAB_TO_NAME\[b\.dataset\.tab\]/,
    '底栏转发必须经过中英映射');
  assert.doesNotMatch(src, /TABS\[\+a\.dataset\.page\]\s*===\s*b\.dataset\.tab/,
    '检测到旧 bug 写法回潮：data-tab（英文）与 TABS 值（中文）直接比较，底栏将永远点不动');
});

test('移动端底栏：点击后同步 aria-current 高亮', () => {
  assert.match(src, /x\.removeAttribute\('aria-current'\)/);
  assert.match(src, /b\.setAttribute\('aria-current', 'page'\)/);
});

test('移动端底栏：「更多」按钮走 openMoreDrawer 且函数真实存在', () => {
  assert.match(src, /S\.openMoreDrawer = openMoreDrawer/,
    'openMoreDrawer 必须挂到 S——底栏「更多」回调运行时检查 typeof S.openMoreDrawer');
});
