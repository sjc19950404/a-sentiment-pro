// config.json 同步注入链路守卫（2026-11-14，Lighthouse 实测反向定位）
//
// 背景：dataOrigin 存在 config.json 里，但 durl() 需要它才能把 data/* 改道 R2。原实现靠
// index.html 的异步 module 桥 import('./config.json') 挂 window.ASENT_CONFIG，而 app.js
// 是同步经典脚本、首屏立即发 dget() —— 等 config.json 从 github.io 慢链（14~16s）回来时
// 首屏请求早已发出，R2 改道对关键路径几乎完全失效（报告网络树：data/*.json 仍在 github.io，
// 只有 1 个 late 请求走了 r2.dev）。
//
// 解法：构建期把 config.json 同步内联进 <head>（scripts/inject_config.mjs），使
// window.ASENT_CONFIG 在任何脚本执行前就绪。本文件把这条链路的**产出时刻约束**变成断言：
// 哨兵存在且为 null、位于 CSP meta 之后、部署会注入、注入产物与 config.json 逐位一致。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

const html = read('index.html');
const yml = read('.github/workflows/deploy-pages.yml');
const cfg = JSON.parse(read('config.json'));
const SENTINEL_RE = /<script id="asent-config">([\s\S]*?)<\/script>/;

test('config: 哨兵存在、源文件为 null（本地零回归），且位于 CSP meta 之后', () => {
  const m = html.match(SENTINEL_RE);
  assert.ok(m, 'index.html 必须有 <script id="asent-config"> 哨兵');
  assert.match(m[1], /window\.ASENT_CONFIG\s*=\s*null/, '源文件哨兵值应为 null（部署才注入）');

  // 顺序约束：CSP meta 必须先于内联脚本，否则浏览器解析到 <script> 就执行、CSP 尚未生效。
  const cspAt = html.indexOf('http-equiv="Content-Security-Policy"');
  const sentinelAt = html.indexOf('<script id="asent-config">');
  assert.ok(cspAt >= 0, 'index.html 必须有 CSP meta');
  assert.ok(cspAt < sentinelAt, '哨兵必须在 CSP meta 之后（否则 CSP 未生效就执行内联脚本）');

  // 哨兵必须早于 app.js（经典同步脚本），否则首屏 dget() 依旧拿不到 dataOrigin。
  const appAt = html.indexOf('<script src="./app.js">');
  assert.ok(appAt >= 0 && sentinelAt < appAt, '哨兵必须在 app.js 之前');
});

test('config: 异步桥已降为 fallback（不会在云端重复拉 config.json）', () => {
  assert.match(html, /if\s*\(!window\.ASENT_CONFIG\)\s*\{/,
    '独立桥应仅当 ASENT_CONFIG 为空时才 import，避免云端多余慢链请求');
  // 桩与 config.js 都改为优先读 window：检查 bundle 产物
  const bundle = read('bundle.js');
  assert.match(bundle, /window\.ASENT_CONFIG \|\| await fetch/,
    'config 桩应优先读同步注入的 ASENT_CONFIG');
});

test('config: 部署链路完整（paths 白名单 + cp 之后注入 + config.json 带 dataOrigin）', () => {
  assert.match(yml, /node scripts\/inject_config\.mjs site\/index\.html/,
    'deploy-pages.yml 必须在组装时执行注入');
  assert.match(yml, /- 'scripts\/inject_config\.mjs'/, '注入脚本须在 paths 白名单（改它要触发部署）');

  const cpAt = yml.indexOf('cp index.html app.js');
  const injectAt = yml.indexOf('node scripts/inject_config.mjs');
  assert.ok(cpAt >= 0 && injectAt > cpAt, '注入必须在 cp 之后（改产物而非源文件）');

  assert.ok(typeof cfg.dataOrigin === 'string' && cfg.dataOrigin.startsWith('https://'),
    'config.json 必须有 dataOrigin，否则注入后 durl() 静默不改道');
});

test('config: 注入产物合法且与 config.json 逐位一致（含 </script> 转义 + 幂等）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'asent-inject-'));
  try {
    const target = path.join(dir, 'index.html');
    const script = path.join(ROOT, 'scripts', 'inject_config.mjs');
    writeFileSync(target, html);

    execFileSync(process.execPath, [script, target], { cwd: ROOT, stdio: 'pipe' });
    const once = readFileSync(target, 'utf8');

    // 幂等：再注入一次结果不变
    execFileSync(process.execPath, [script, target], { cwd: ROOT, stdio: 'pipe' });
    assert.equal(readFileSync(target, 'utf8'), once, '注入不幂等（重复部署会累积/损坏）');

    const injected = once.match(SENTINEL_RE);
    assert.ok(injected, '注入后哨兵仍在');
    assert.doesNotMatch(injected[1], /=\s*null/, '注入后不应还是 null');
    assert.doesNotMatch(injected[1], /<\/script>/i, '内联 JS 不得含未转义的 </script>（会截断 HTML）');

    // 用真实 JS 引擎执行内联脚本，读回 window.ASENT_CONFIG 并与 config.json 逐位比对
    const sandbox = { window: {} };
    vm.runInNewContext(injected[1].trim(), sandbox);
    // vm 是独立 realm，对象原型与主 realm 不同；先 JSON 往返归一化再逐位比对。
    const actual = JSON.parse(JSON.stringify(sandbox.window.ASENT_CONFIG));
    assert.deepEqual(actual, cfg,
      '注入的 ASENT_CONFIG 必须与 config.json 逐位一致（单一事实源）');
    assert.equal(actual.dataOrigin, cfg.dataOrigin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: 注入失败时应 fail-fast（哨兵缺失 / dataOrigin 缺失）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'asent-inject-bad-'));
  try {
    const bad = path.join(dir, 'index.html');
    const script = path.join(ROOT, 'scripts', 'inject_config.mjs');
    writeFileSync(bad, '<!DOCTYPE html><html><head></head><body></body></html>');
    assert.throws(
      () => execFileSync(process.execPath, [script, bad], { cwd: ROOT, stdio: 'pipe' }),
      '哨兵缺失时必须抛错，不能静默产出未注入的页面',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
