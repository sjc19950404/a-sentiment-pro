// 浏览器 ESM 链静态 node: import 守卫（2026-11-07）。
//
// 背景：同构模块（src/*.js 同时跑 Node 管线与浏览器页面）若顶层静态 `import 'node:...'`，
// 会让整条浏览器链加载失败——node: scheme 被浏览器拦截（CORS/unsupported scheme），
// 且失败发生在模块解析阶段、先于任何守卫逻辑。2026-11-05~07 实证连续漏网三例
// （config/calendar → sources/ztpool_window → zt_rebuild），用户控制台反复出现
// node:url/node:path/node:fs CORS。动态 `import('node:...')` + isNode 守卫是唯一
// 正确形态（本测试允许）。
//
// 规则：从「浏览器入口模块」出发 BFS 传递依赖（静态 import/export from），
// 可达集合内任何文件不得出现 `from 'node:'` 或 `import 'node:'`（静态形式）。
// 动态 import('node:') 不拦——那必须配 isNode 守卫，由人工评审保证。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 浏览器入口：index.html 中引用/内联 import 的 src 模块（新增入口时同步登记）
const ENTRIES = [
  'src/report.js',
  'src/report_audit.js',
  'src/seats.js',
  'src/paper_review.js',
  'src/intraday_sampler.js',
  'src/report_card_live.js',
  'src/quote.js',
  'src/paper.js',
  'src/lhbfilter.js',
  'src/lhb.js',
  'src/dataset.js',
];

// 静态 import 语句抽取：export ... from 'x' / import ... from 'x' / import 'x'
const STATIC_RE = /(?:from\s+|import\s*\(?\s*)['"](\.[^'"]+)['"]/g;

function depsOf(file) {
  const src = readFileSync(file, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(STATIC_RE)) {
    const spec = m[1];
    const resolved = resolve(dirname(file), spec);
    // 只跟仓库内 src/ 的模块（相对路径即可达）
    if (resolved.startsWith(join(ROOT, 'src')) && existsSync(resolved)) out.add(resolved);
  }
  return out;
}

test('浏览器 ESM 链可达模块禁止静态 import node:（打地鼠守卫）', () => {
  const violations = [];
  const seen = new Set();
  const queue = [];

  for (const e of ENTRIES) {
    const p = join(ROOT, e);
    if (!existsSync(p)) continue; // 入口可缺（模块演进），存在则必查
    queue.push(p);
  }

  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    // 逐行剥离行注释后再匹配——注释里的示例文本（如 config.js 的守卫说明）不算数
    const code = readFileSync(f, 'utf8')
      .split('\n')
      .map((l) => l.replace(/(^|[^:'"])\/\/.*$/, '$1'))
      .join('\n');
    // 静态 node: import（from 'node:x' / import 'node:x'）——顶层即失败，禁止
    for (const m of code.matchAll(/from\s+['"]node:[^'"]+['"]|^import\s+['"]node:[^'"]+['"]/gm)) {
      violations.push(`${f.replace(ROOT + '/', '')} → ${m[0]}`);
    }
    for (const d of depsOf(f)) queue.push(d);
  }

  assert.equal(
    violations.length,
    0,
    `浏览器可达模块存在静态 node: import（会整链加载失败）：\n${violations.join('\n')}\n`
    + `→ 同构化：isNode 守卫（含 typeof window === 'undefined'）+ 动态 import('node:...')，\n`
    + `  参考 src/config.js / src/sources.js 的现成写法`,
  );
});
