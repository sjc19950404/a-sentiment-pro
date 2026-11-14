// CLS 布局稳定性守卫（2026-11-14，Lighthouse 两轮实测反向定位）
//
// 第一轮：btStrategyPanel 初始 hidden（display:none），异步数据到达后 hidden=false
// → 从 0 高度撑开，推挤下方 <main>。改为「骨架 + min-height: 18rem」。
// 第二轮复测：偏移分数 **仍是 0.751**，且新增 main 0.499 —— min-height 只是下限，
// 真实内容（details open + 5 行表格 + 5 条 note ≈ 360~450px）仍把 288px 撑高。
//
// 故最终修法：容器**固定 height + overflow-y:auto**，尺寸恒定，骨架与真实内容只是
// 同一盒子里的替换，外部布局零位移；内容超高在盒内滚动，不裁剪不丢失。
// 本测试把这个「产出时刻约束」变成断言，防止以后被改回 min-height（静默回归）。

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

// 抽出 .btstrat-panel 的主规则（不含 [hidden] / .bs-unknown 等复合选择器）
const rule = (css.match(/^\.btstrat-panel\s*\{([^}]*)\}/m) || [])[1] || '';

test('CLS: .btstrat-panel 必须固定 height（不能只有 min-height）', () => {
  assert.ok(rule, 'style.css 必须有 .btstrat-panel 主规则');
  assert.match(rule, /(?:^|;)\s*height:\s*\d+(?:\.\d+)?rem/,
    '必须有固定 height —— min-height 只是下限，真实内容仍会撑高并推挤 <main>（第二轮实测 0.751 未改善）');
  assert.doesNotMatch(rule, /min-height/,
    '不得保留 min-height 作为唯一尺寸约束（会与固定 height 混淆，且暗示「可撑高」）');
  assert.match(rule, /overflow-y:\s*(auto|scroll)/,
    '固定高度必须配容器内滚动，否则真实内容会被裁剪');
  assert.match(rule, /box-sizing:\s*border-box/, '固定高度应含 padding，避免实际占位超出预期');
});

test('CLS: 首屏即占位（不带 hidden、带骨架），且渲染分支不破坏容器尺寸', () => {
  const tag = html.match(/<div id="btStrategyPanel"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(tag, 'index.html 必须有 #btStrategyPanel');
  // 只匹配独立的 hidden 属性；不要误伤骨架 <div> 的 aria-hidden="true"
  assert.doesNotMatch(tag[0], /\shidden(?=[\s>=])/, '首屏不能 hidden（display:none → 数据到达撑开 = CLS）');
  assert.match(tag[0], /bs-skeleton/, '首屏必须有骨架占位');

  // renderBtStrategies 的两个分支：只能 hidden=false / 改 className / 换 innerHTML，
  // 不得设置 inline height、min-height 或 hidden=true（否则固定高度失效）。
  const fn = app.slice(app.indexOf('function renderBtStrategies'), app.indexOf('function renderHealth'));
  assert.ok(fn.length > 100, '必须能定位到 renderBtStrategies');
  assert.doesNotMatch(fn, /style\.(height|minHeight|maxHeight)/,
    '渲染分支不得写 inline 高度（会覆盖 CSS 固定尺寸）');
  assert.doesNotMatch(fn, /hidden\s*=\s*true/, '渲染分支不得把面板重新藏起来');
  assert.match(fn, /innerHTML\s*=/, '渲染应只替换盒内内容');
});

test('CLS: 骨架与空态在同一固定盒内居中（无额外撑高）', () => {
  assert.match(css, /\.bs-skeleton\s*\{[^}]*height:\s*100%/,
    '骨架应撑满固定盒，而非用内容高度决定容器高度');
  assert.match(css, /\.btstrat-panel\.bs-unknown\s*\{[^}]*align-items:\s*center/,
    '「未生成」空态应在固定盒内居中，保持同一高度');
});
