// 浏览器 ESM 模块统一打包（消除 github.io 模块瀑布）
//
// 背景：index.html 原先用 10 段 <script type="module"> 各自 import 一个 src/*.js；这些 src 又
// 拉起整棵依赖树（paper_ui → paper.js → 40+ src），在 github.io 慢链上逐个请求 → 首屏 37s。
// 本脚本用 esbuild 把 10 个入口 + 整棵依赖树打包成单个 bundle.js（一次请求拉完）。
//
// 三个打包期插件（源码一行不改，只在产物里生效；Node 侧与旧「不打包」部署形态零影响）：
//   ① node 内置桩——浏览器图已用脚本遍历确认无 node 专属模块，但保险起见把 node: 内置桩掉；
//     即便被误打包，浏览器永不触达 isNode 分支，桩不会被执行（bundle 是浏览器专用产物）。
//   ② config-json-live：拦截 import('./config.json')（paper_ui.js）——打包后相对路径会变，
//     改成按 document.baseURI（index.html 所在）取线上最新 config.json。
//   ③ config-fetch-url：config.js 浏览器分支走的是 fetch(new URL('../config.json', import.meta.url))，
//     不是 import 语句，②拦不到。源码里 config.js 在 src/ 下、'../config.json' 正确；但 bundle.js
//     落在站点根，'../config.json' 会解析到 github.io 域根 → 404 → cfg={} → config.js 结构校验
//     throw → 整个 bundle 求值失败、window 挂载全废。故打包时把该 fetch URL 也改成按文档根取。
//     注意：求值期 window.ASENT_CONFIG 多半尚未就绪（独立桥是异步动态 import），这个 else 分支
//     几乎必走，不是概率问题。

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const NODE_BUILTINS = [
  'node:fs', 'node:path', 'node:url', 'node:os', 'node:process', 'node:crypto',
  'node:util', 'node:stream', 'node:http', 'node:https', 'node:zlib',
];

const nodeStub = {
  name: 'node-stub',
  setup(b) {
    b.onResolve(
      { filter: new RegExp('^(' + NODE_BUILTINS.map((s) => s.replace(/:/g, '\\:')).join('|') + ')$') },
      (a) => ({ path: a.path, namespace: 'node-stub' }),
    );
    b.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
      contents: [
        'export default {};',
        "export const readFileSync = () => { throw new Error('node-only'); };",
        'export const existsSync = () => false;',
        'export const mkdirSync = () => {};',
        'export const writeFileSync = () => {};',
        "export const join = (...a) => a.join('/');",
        "export const dirname = (p) => String(p).split('/').slice(0, -1).join('/');",
        "export const fileURLToPath = (p) => String(p).replace('file://', '');",
      ].join('\n'),
      loader: 'js',
    }));
  },
};

const configJsonLive = {
  name: 'config-json-live',
  setup(b) {
    b.onResolve({ filter: /(^|\/)config\.json$/ }, (a) => ({ path: a.path, namespace: 'config-json' }));
    b.onLoad({ filter: /.*/, namespace: 'config-json' }, () => ({
      // 按文档根（index.html 所在）取线上最新 config.json，与 bundle 文件位置无关
      contents: "export default (await fetch(new URL('config.json', document.baseURI)).then(r => r.json()));",
      loader: 'js',
    }));
  },
};

// ③ 打包期改写 config.js 的浏览器 fetch URL（仅命中该模式才改，未命中交回默认 loader）。
//    源码保持 '../config.json' 不动——它在 src/ 下是对的，只有打包进站点根 bundle.js 才越界。
const configFetchUrl = {
  name: 'config-fetch-url',
  setup(b) {
    b.onLoad({ filter: /config\.js$/ }, (a) => {
      const src = readFileSync(a.path, 'utf8');
      const patched = src.replace(
        /new URL\(['"]\.\.\/config\.json['"],\s*import\.meta\.url\)/g,
        "new URL('config.json', document.baseURI)",
      );
      if (patched === src) return null;
      return { contents: patched, loader: 'js', resolveDir: path.dirname(a.path) };
    });
  },
};

await build({
  entryPoints: ['src/_browser_bundle_entry.js'],
  bundle: true,
  outfile: 'bundle.js',
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: false,
  logLevel: 'info',
  plugins: [nodeStub, configJsonLive, configFetchUrl],
}).catch(() => process.exit(1));
