#!/usr/bin/env node
// 生成终端视图的自包含预览页（单文件 HTML，内联 CSS + JS + 真实数据 + fetch mock）。
// 用途：本地/Windows 直接双击打开即可看到「磨砂黑研究工作台」的真实渲染效果，
//       无需起服务、无需树莓派。仅预览用，不影响线上页面。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'dist', 'terminal-preview.html');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : 'null');
const rdJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch { return null; } };

const css = rd(join(ROOT, 'terminal.css'));
const js = rd(join(ROOT, 'terminal.js'));
const DATA = {
  'data/signals-latest.json': rdJson(join(ROOT, 'data/signals-latest.json')),
  'data/archive-recent.json': rdJson(join(ROOT, 'data/archive-recent.json')),
  'data/paper/account.json': rdJson(join(ROOT, 'data/paper/account.json')),
  'ui/kline/sh600000.json': rdJson(join(ROOT, 'ui/kline/sh600000.json')),
  'ui/kline/sz000001.json': rdJson(join(ROOT, 'ui/kline/sz000001.json')),
};

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>A股情绪 · 研究工作台（预览）</title>
<style>${css}</style></head><body>
<div id="tRoot" hidden></div>
<script>
// 预览专用：把真实数据内联进来，mock fetch（其余路径返回 null → 该面板显示空态）
var __DATA__ = ${JSON.stringify(DATA)};
window.fetch = function (url) {
  var u = String(url).replace(/^\\.\\//, '').replace(/^https?:\\/\\/[^/]+\\//, '');
  var hit = __DATA__[u] || (/\\.json$/.test(u) ? null : null);
  return Promise.resolve({ ok: hit !== null && hit !== undefined, json: function () { return Promise.resolve(hit); } });
};
</script>
<script>${js}</script>
</body></html>
`;

writeFileSync(OUT, html);
console.log(`预览页已生成：${OUT}（${(html.length / 1024).toFixed(1)} KB，双击即可打开）`);
