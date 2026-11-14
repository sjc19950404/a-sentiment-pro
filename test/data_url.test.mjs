// 数据档改道守卫（2026-11-14，Lighthouse 实测反向定位）
//
// 上轮只把 app.js 的 fetch('./data/…') 与 terminal.js 的 jget 接上 durl，却漏了
// paper_ui.js（7 处）与 src/intraday_sampler.js（1 处）——它们是 ESM、已被打进 bundle.js，
// 首屏最重的几档（paper_universe 147KB / ztpool_history 95KB / archive-recent 45KB）
// 因此仍落 github.io 慢链，正是关键路径 29s 的头部。本测试把「所有浏览器可达的
// data/* 取数必须经 durl()」变成产出时刻的守卫，防止新增模块再次绕过。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

// 浏览器可达、且可能直接取 data/* 的源码/产物（app.js 经典脚本、terminal.js 内联生成物、
// paper_ui.js 与 intraday_sampler.js 已被打进 bundle.js）。
const BROWSER_FILES = ['app.js', 'terminal.js', 'index.html', 'paper_ui.js',
  'src/intraday_sampler.js', 'src/data_url.js', 'bundle.js'];
// 裸取数：fetch('./data/…') / fetch("./data/…") / fetch(`./data/…`) / fetch(UNI_*_FILE)。
const BARE = /fetch\(\s*(?:['"`]\.{0,2}\/?data\/|UNI_(?:LITE|FULL)_FILE)/;

test('data_url: 浏览器可达模块不得出现裸 data/* 取数（必须经 durl）', () => {
  for (const f of BROWSER_FILES) {
    const src = read(f);
    src.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').trim(); // 去掉行注释，避免注释里的示例误判
      assert.ok(!BARE.test(code), `${f}:${i + 1} 出现裸 data/* 取数，应改用 dget()/durl()：${code.slice(0, 100)}`);
    });
  }
});

test('data_url: ESM 侧已接入共享改道模块，且 bundle 产物内联了它', () => {
  assert.match(read('paper_ui.js'), /import \{ dget \} from '\.\/src\/data_url\.js'/,
    'paper_ui.js 必须 import 共享 dget');
  assert.match(read('src/intraday_sampler.js'), /import \{ dget \} from '\.\/data_url\.js'/,
    'intraday_sampler.js 必须 import 共享 dget');
  const bundle = read('bundle.js');
  assert.match(bundle, /durl = \(p\)/, 'bundle.js 应内联 data_url.js 的 durl');
  assert.match(bundle, /dget = \(p/, 'bundle.js 应内联 data_url.js 的 dget');
});

test('data_url: 部署链路覆盖新模块（cp -r src/. + paths src/**）', () => {
  const yml = read('.github/workflows/deploy-pages.yml');
  assert.match(yml, /cp -r src\/\. site\/src\//, 'src/ 应整目录部署');
  assert.match(yml, /- 'src\/\*\*'/, 'paths 白名单应含 src/** 通配');
});

test('data_url: durl 纯函数行为（云端改道 / 本地零回归 / 末尾斜杠归一）', async () => {
  const { durl } = await import('../src/data_url.js');
  const savedWindow = globalThis.window;
  const savedLocation = globalThis.location;
  try {
    // Node 侧无 window → 原路径（Pi 本机 / 服务端同源）
    assert.equal(durl('./data/global.json'), './data/global.json');

    globalThis.window = { ASENT_CONFIG: { dataOrigin: 'https://pub-example.r2.dev/' } };

    // 非 github.io 域名 → 原路径（localhost / 自定义域零回归）
    globalThis.location = { hostname: 'localhost' };
    assert.equal(durl('./data/global.json'), './data/global.json');

    // github.io 域名 → 改道 R2，且去掉 dataOrigin 末尾斜杠、去掉路径前导 ./
    globalThis.location = { hostname: 'sjc19950404.github.io' };
    assert.equal(durl('./data/global.json'), 'https://pub-example.r2.dev/data/global.json');
    assert.equal(durl('data/paper/account.json?_=1'), 'https://pub-example.r2.dev/data/paper/account.json?_=1');

    // dataOrigin 缺失 → 原路径（不开车、静默降级由上层兜底）
    globalThis.window = { ASENT_CONFIG: {} };
    assert.equal(durl('./data/global.json'), './data/global.json');
  } finally {
    if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
  }
});
