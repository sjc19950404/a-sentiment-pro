// 浏览器 ESM 模块统一打包（消除 github.io 模块瀑布）
//
// 背景：index.html 原先用 10 段 <script type="module"> 各自 import 一个 src/*.js；这些 src 又
// 拉起整棵依赖树（paper_ui → paper.js → 40+ src），在 github.io 慢链上逐个请求 → 首屏 37s。
// 本脚本用 esbuild 把 10 个入口 + 整棵依赖树打包成单个 bundle.js（一次请求拉完）。
//
// 两个防御性插件：
//   ① node 内置桩——浏览器图已用脚本遍历确认无 node 专属模块，但保险起见把 node: 内置桩掉；
//     即便被误打包，浏览器永不触达 isNode 分支，桩不会被执行（bundle 是浏览器专用产物）。
//   ② config.json 按文档根 fetch——原模块用 import('./config.json') / new URL('../config.json',
//     import.meta.url) 取配置，打包后相对路径会变。统一改成按 document.baseURI（index.html 所在）
//     fetch，与 bundle 文件位置无关，保证拿到的是线上最新 config.json。

import { build } from 'esbuild';

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

await build({
  entryPoints: ['src/_browser_bundle_entry.js'],
  bundle: true,
  outfile: 'bundle.js',
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: false,
  logLevel: 'info',
  plugins: [nodeStub, configJsonLive],
}).catch(() => process.exit(1));
