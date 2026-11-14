// CLS 布局稳定性守卫（2026-11-14，Lighthouse 四轮 + 本地 A/B 29 组实证）
//
// 轮次与实测分数：
//   ① 初始 hidden（display:none），异步数据到达后撑开 → CLS 0.836
//   ② 骨架 + min-height:18rem → 0.802（btStrategyPanel 0.751 + main 0.499）
//   ③ 单独把 btStrategyPanel 固定 height:26rem → **0.890**（净效果为负，已撤销）
//   ④ 树莓派本地 Lighthouse 可比基线（CLI standard preset）：桌面 1.281 / 移动 1.391
//      经 29 组注入式 A/B 定位，做三层稳定化后：桌面 **0.174** / 移动 **0.238**。
//
// A/B 证伪的假设（留档，避免以后再绕回去）：
//   · 给 12 个面板逐个 min-height → CLS 1.281 逐位不变（hidden 时 display:none）
//   · 关 scroll-behavior:smooth / overflow-anchor / main 加 contain → 全部不变
//   · 只固定 main 高度 → 1.187；只固定首屏卡片 → 1.113
// 有效的三层（缺一层都会明显退步）：
//   ① #preMainPanels 把 13 个面板 + #alerts 包成尺寸恒定的容器（盒内滚动）
//   ② 容器内每个面板各自固定高度、header.topbar 固定 64px、#alerts 固定 3rem
//   ③ 首屏 .grid > .card 固定高度 + 盒内滚动
//
// 本测试锁这三层结构的**存在性**，防止以后改版把稳定容器删掉又静默回归。

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

const ruleOf = (sel) => {
  const re = new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  return (css.match(re) || [])[1] || '';
};

test('CLS①: #preMainPanels 稳定容器必须存在且尺寸恒定（盒内滚动）', () => {
  assert.match(html, /<div id="preMainPanels" class="pre-main-panels">/,
    'index.html 必须有 #preMainPanels 容器');
  // 容器必须包住 #alerts 与 12 个面板，且闭合在 <main> 之前
  const start = html.indexOf('<div id="preMainPanels"');
  const close = html.indexOf('</div><!-- /#preMainPanels -->');
  assert.ok(start > 0 && close > start, '容器必须有显式闭合标记且在 <main> 之前');
  assert.ok(html.indexOf('\n  <main>') > close, '<main> 必须在容器闭合之后（用行首精确匹配，避开注释里的 <main> 字样）');
  for (const id of ['alerts', 'btStrategyPanel', 'dualTrackPanel', 'fatalHolder']) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > start && at < close, `#${id} 必须在稳定容器内`);
  }
  const r = ruleOf('.pre-main-panels');
  assert.match(r, /height:\s*\d+rem/, '容器必须有固定 height');
  assert.match(r, /max-height:\s*\d+rem/, '容器必须锁死 max-height（否则内容仍会撑开）');
  assert.match(r, /overflow-y:\s*auto/, '容器必须盒内滚动，内容不能裁剪丢失');
});

test('CLS②: 容器内每个面板与 topbar / alerts 都有稳定高度', () => {
  const r = ruleOf('.pre-main-panels > div:not(#btStrategyPanel)');
  assert.ok(r, '必须有「容器内面板逐个固定高度」规则');
  assert.match(r, /height:\s*\d+rem/, '逐个面板须固定 height');
  assert.match(r, /max-height:\s*\d+rem/, '逐个面板须锁死 max-height');
  assert.match(css, /\.pre-main-panels > div\[hidden\] \{ display: none !important; \}/,
    'hidden 面板必须仍 display:none（否则未生成时也占位）');
  const topbar = ruleOf('header.topbar');
  assert.match(topbar, /height:\s*\d+px/, 'header.topbar 必须固定高度（meta 异步填充实测撑高 ~15px）');
  // #alerts 有两条规则（原 padding + 新增稳定高度），取所有 #alerts 规则合并检查
  const alertsRules = [...css.matchAll(/^#alerts\s*\{([^}]*)\}/gm)].map((m) => m[1]).join(' ');
  assert.match(alertsRules, /height:\s*\d+rem/, '#alerts 必须固定高度（renderAlerts 实测撑高 ~135px）');
  const bt = ruleOf('.btstrat-panel');
  assert.match(bt, /overflow-y:\s*auto/, 'btStrategyPanel 盒内滚动（不裁切大表格）');
  assert.doesNotMatch(bt, /height:\s*26rem/, '固定 26rem 已实测使 CLS 变差，不得回退采用');
  // btStrategyPanel 不再单独固定 18rem：稳定性改由上层 #preMainPanels 容器（尺寸恒定）
  // 承载，它撑满容器、由容器统一滚动，消除「框中框」双重滚动。故这里只锁「不得回退成
  // 26rem」与「盒内滚动」，不再锁具体高度。
});

test('CLS③: 首屏 .grid > .card 固定高度（异步填充/图表 canvas 不撑开外部）', () => {
  const r = ruleOf('#zone-overview .grid > .card');
  assert.ok(r, '必须有首屏卡片固定高度规则');
  assert.match(r, /height:\s*\d+rem/, '卡片须固定 height');
  assert.match(r, /max-height:\s*\d+rem/, '卡片须锁死 max-height');
  assert.match(r, /overflow-y:\s*auto/, '卡片须盒内滚动（内容不裁剪）');
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*?\.pre-main-panels \{ height: 26rem/,
    '窄屏单列需要单独的更高尺寸');
});

test('CLS: 首屏骨架与渲染分支不破坏稳定尺寸', () => {
  const tag = html.match(/<div id="btStrategyPanel"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(tag, 'index.html 必须有 #btStrategyPanel');
  // 只匹配独立的 hidden 属性；不要误伤骨架 <div> 的 aria-hidden="true"
  assert.doesNotMatch(tag[0], /\shidden(?=[\s>=])/, '首屏不能 hidden');
  assert.match(tag[0], /bs-skeleton/, '首屏必须有骨架占位');

  const fn = app.slice(app.indexOf('function renderBtStrategies'), app.indexOf('function renderHealth'));
  assert.ok(fn.length > 100, '必须能定位到 renderBtStrategies');
  assert.doesNotMatch(fn, /style\.(height|minHeight|maxHeight)/, '渲染分支不得写 inline 高度');
  assert.doesNotMatch(fn, /hidden\s*=\s*true/, '渲染分支不得把面板重新藏起来');
  assert.match(fn, /innerHTML\s*=/, '渲染应只替换盒内内容');
  assert.match(css, /\.bs-skeleton\s*\{/, '骨架需有样式');
  assert.match(css, /\.btstrat-panel\.bs-unknown\s*\{/, '空态需有样式');
});
