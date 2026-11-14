// 构建期把 config.json 同步内联进 index.html 的 <head>（消除「引导悖论」）
//
// 背景（2026-11-14 Lighthouse 实测）：dataOrigin 存在 config.json 里，但 durl() 需要
// dataOrigin 才能把 data/* 改道 R2——而 config.json 桥是异步 module，app.js 是同步经典
// 脚本、首屏立即发 dget()，等 14~16 秒 config.json 从 github.io 慢链回来时首屏请求
// 早已发出且全部落在慢链上。R2 改道因此对首屏几乎完全失效（报告里只有 1 个 late
// 请求走了 r2.dev）。
//
// 解法：部署时把 config.json 内容**同步内联**到 <head>，使 window.ASENT_CONFIG 在任何
// 脚本执行前就绪。这样：① durl() 首屏即改道 R2；② bundle 里 config.js 走 fromWindow
// 分支不再 fetch；③ config 桩走 window 不再 fetch；④ index.html 独立桥降为 fallback。
// 3 次慢链 config.json 请求归零。
//
// 单一事实源：仓库里的 config.json 文本不动，本脚本只在**产物** site/index.html 里注入。
// 源文件保留哨兵（值为 null），本地 Pi / localhost 打开时走原有异步桥 + 相对路径，零回归。
//
// 用法：node scripts/inject_config.mjs [目标 index.html 路径]
//   默认目标 index.html；部署时传 site/index.html。

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = path.join(ROOT, 'config.json');
const outPath = path.resolve(process.argv[2] || path.join(ROOT, 'index.html'));

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const html = readFileSync(outPath, 'utf8');

// 防漂移：config.json 必须带 dataOrigin，否则注入后 durl() 依旧不改道（静默失败）。
if (!cfg.dataOrigin || typeof cfg.dataOrigin !== 'string') {
  throw new Error('config.json 缺 dataOrigin —— 注入无意义，已中止');
}

// 内联 JS 字面量：转义 </script>（防 HTML 截断）、U+2028/2029（老式行终止符）。
const literal = JSON.stringify(cfg)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

// 幂等：整段替换 <script id="asent-config">…</script>，重复运行结果一致。
const RE = /<script id="asent-config">[\s\S]*?<\/script>/;
const found = html.match(RE);
if (!found) {
  throw new Error(`${outPath} 缺 <script id="asent-config"> 哨兵 —— 结构变了，已中止`);
}
const replacement = `<script id="asent-config">window.ASENT_CONFIG = ${literal};</script>`;
const patched = html.replace(RE, replacement);
// 幂等：重复注入时 found[0] 已是注入态，patched === html 属正常，不报错。
// 仅「哨兵仍为 null 却没产生变化」才是替换逻辑坏了，必须 fail-fast。
const wasNull = /window\.ASENT_CONFIG\s*=\s*null/.test(found[0]);
if (wasNull && patched === html) {
  throw new Error('首次注入未产生变化 —— 检查哨兵与替换逻辑');
}
if (patched.includes('window.ASENT_CONFIG = null;')) {
  throw new Error('注入后仍存在 null 哨兵 —— 产物可疑，已中止');
}
writeFileSync(outPath, patched);

console.log(`已注入 config.json → ${path.relative(ROOT, outPath)}（${(literal.length / 1024).toFixed(1)} KiB，dataOrigin=${cfg.dataOrigin}）`);
