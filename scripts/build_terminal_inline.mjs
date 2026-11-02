// 把 terminal.css / terminal.js 内联进 index.html（可重复执行，幂等）。
//
// 为什么内联而不是 <link>/<script src>：
//   ① 不新增 ./ 引用 → 部署守卫（test/deploy_manifest.test.mjs）、sw.js SHELL_ASSETS、
//      src/offline.js 内联副本、deploy-pages.yml 的 paths/cp 清单**全部零改动**；
//   ② 当前 PAT 无 `workflow` 权限，改动 .github/workflows/** 会被 GitHub 整单拒绝——
//      内联方案从根上绕开这个阻塞，且零 src/ 改动（遵守「严禁改引擎」铁律）；
//   ③ 纯黑底终端无跨页复用需求，内联不损失缓存价值（index.html 本就被 SW 缓存）。
//
// 何时该拆回独立文件：PAT 补上 workflow 权限后，执行 scripts/split_terminal.mjs（或手动
// 把 <style>/<script> 两块换回 <link>/<script src>，并同步三处清单），可获得单独缓存。
//
// 用法：node scripts/build_terminal_inline.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IDX = join(ROOT, 'index.html');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

let html = read('index.html');
const css = read('terminal.css');
const js = read('terminal.js');

// 防呆：内联内容不得含闭合标签（否则提前截断 HTML 解析）
for (const [name, body] of [['terminal.css', css], ['terminal.js', js]]) {
  if (/<\/script>|<\/style>/i.test(body)) throw new Error(`${name} 含闭合标签，不能内联`);
}

// 幂等：先剥掉上一次生成的内联块（按固定注释头定位），避免反复执行导致嵌套
const stripBlock = (marker) => {
  const i = html.indexOf(marker);
  if (i < 0) return;
  const open = html.lastIndexOf('<!--', i);
  // 判别式必须按标记文字本身（· CSS ══ / · JS ══）判断，不能按 "terminal.css" 字面量——
  // 标记串里并没有文件名。原写法对 CSS 标记误取 '</script>' 作终止符，导致一刀切到
  // JS 块末尾，连 </head> 都被吞掉（仅在第二次运行、存在旧块时才暴露）。
  const tag = /· JS ══/.test(marker) ? '</script>' : '</style>';
  const close = html.indexOf(tag, i);
  if (open >= 0 && close > i) html = html.slice(0, open) + html.slice(close + tag.length);
};
stripBlock('══ 终端视图内联块（生成物，勿手改）· CSS ══');
stripBlock('══ 终端视图内联块（生成物，勿手改）· JS ══');

// 安全闸：剥离是字符串切片，一旦判别式出错就可能切掉正文（曾误吞 </head>）。
// 这里在写盘前校验文档骨架仍完整，宁可中止也不写出坏文件。
if (!html.includes('</head>') || !html.includes('</body>') || !html.includes('<!DOCTYPE html>')) {
  throw new Error('剥离内联块后 index.html 结构受损（缺 </head>/</body>/DOCTYPE）——已中止，未写盘。请检查 stripBlock 的终止符判别式。');
}

const cssBlock = '<!-- ══ 终端视图内联块（生成物，勿手改）· CSS ══\n'
  + '     源：terminal.css · 由 scripts/build_terminal_inline.mjs 生成 -->\n'
  + '  <style>\n' + css + '  </style>';
const jsBlock = '<!-- ══ 终端视图内联块（生成物，勿手改）· JS ══\n'
  + '     源：terminal.js · 由 scripts/build_terminal_inline.mjs 生成 -->\n'
  + '  <script>\n' + js + '  </script>';

// 插入点：CSS 在 </head> 前，JS 在 #tRoot 之后。
// 两处都先**吃掉既有空行**再插入——否则「剥离残留的换行 + 本次插入的换行」会逐次
// 累积，每次运行凭空多 2 字节（反复执行会把文件撑大）。
if (!html.includes('</head>')) throw new Error('index.html 无 </head>');
const tRootTag = '<div id="tRoot" hidden></div>';
if (!html.includes(tRootTag)) throw new Error('index.html 无 #tRoot 容器');
// ⚠ 两处都必须用**函数式替换**（() => …），绝不能用字符串替换：
//   替换串里的 $1/$2/$3 会被 String.replace 当作捕获组引用！terminal.js 源码中
//   含 '$1-$2-$3'（loadHist 的日期正则 replace），若用字符串替换会被替换成
//   <div id="tRoot" hidden></div>，内联进去的 loadHist 直接是坏的。
//   函数返回值不做 $ 解析，可原样内联。
html = html.replace(/\n*<\/head>/, () => '\n' + cssBlock + '\n</head>');
html = html.replace(/(<div id="tRoot" hidden><\/div>)\n*/, () => `${tRootTag}\n${jsBlock}\n`);

writeFileSync(IDX, html);
console.log(`已内联：index.html ${(read('index.html').length / 1024).toFixed(1)} KB（源：terminal.css + terminal.js）`);
