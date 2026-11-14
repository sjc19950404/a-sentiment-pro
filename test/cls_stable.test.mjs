// CLS 布局稳定性守卫（2026-11-14，Lighthouse 三轮实测）
//
// 轮次与实测分数（同一口径：模拟桌面 + 自定义节流）：
//   ① 初始 hidden（display:none），异步数据到达后撑开 → CLS 0.836
//   ② 骨架 + min-height:18rem → CLS 0.802（btStrategyPanel 0.751 + main 0.499 + main 0.052）
//   ③ 固定 height:26rem + 容器内滚动 → CLS **0.890**（btStrategyPanel 独占 0.890）
//      固定高度消除了 main 的偏移，但元素变高，被 <main> 之前 12 个 hidden→异步显示
//      面板依次撑开往下推时 impact fraction 更大，净效果为负 → 已撤销，回到 ②。
//
// 故本测试**不再锁死某一种尺寸方案**（那会把已证伪的形态固化成约束），只锁不变量：
// 首屏必须有骨架占位、渲染分支不得破坏它、CSS 必须有占位规则。根治 12 个面板的
// 布局预留属于产品决策，须先实测再动。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

const css = read('style.css');
const html = read('index.html');
const app = read('app.js');

const rule = (css.match(/^\.btstrat-panel\s*\{([^}]*)\}/m) || [])[1] || '';

test('CLS: .btstrat-panel 必须有首屏占位规则（骨架不能是 0 高度）', () => {
  assert.ok(rule, 'style.css 必须有 .btstrat-panel 主规则');
  assert.match(rule, /(?:min-)?height:\s*\d+(?:\.\d+)?rem/,
    '必须有 min-height 或 height 占位 —— 否则骨架仍是 0 高度，异步数据到达即从无到有撑开');
  // 已证伪形态的回归锁：固定 height:26rem 实测 CLS 0.890 > 基线 0.802
  assert.doesNotMatch(rule, /height:\s*26rem/, '固定 26rem 已实测使 CLS 变差，不得回退采用');
});

test('CLS: 首屏即占位（不带 hidden、带骨架），渲染分支不破坏容器尺寸', () => {
  const tag = html.match(/<div id="btStrategyPanel"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(tag, 'index.html 必须有 #btStrategyPanel');
  // 只匹配独立的 hidden 属性；不要误伤骨架 <div> 的 aria-hidden="true"
  assert.doesNotMatch(tag[0], /\shidden(?=[\s>=])/, '首屏不能 hidden（display:none → 数据到达撑开 = CLS）');
  assert.match(tag[0], /bs-skeleton/, '首屏必须有骨架占位');

  const fn = app.slice(app.indexOf('function renderBtStrategies'), app.indexOf('function renderHealth'));
  assert.ok(fn.length > 100, '必须能定位到 renderBtStrategies');
  assert.doesNotMatch(fn, /style\.(height|minHeight|maxHeight)/,
    '渲染分支不得写 inline 高度（会覆盖 CSS 占位尺寸）');
  assert.doesNotMatch(fn, /hidden\s*=\s*true/, '渲染分支不得把面板重新藏起来');
  assert.match(fn, /innerHTML\s*=/, '渲染应只替换盒内内容');
});

test('CLS: 骨架与空态有样式（不靠内容高度决定容器）', () => {
  assert.match(css, /\.bs-skeleton\s*\{/, '骨架需有样式（撑满/居中占位）');
  assert.match(css, /\.btstrat-panel\.bs-unknown\s*\{/, '「未生成」空态需有样式');
});
