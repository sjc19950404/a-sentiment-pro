// R2 同步链路守卫（2026-11-14，Lighthouse 实测反向定位）
//
// 改道全面生效后反而更差：性能 65→46、关键路径 29.2→34.4s、最佳做法 100→96。
// 两个根因都在同步脚本里：
//   ① 3 个档（paper_universe / paper_universe-lite / paper/dual_track_latest）漏在
//      SRC_FILES 之外 → R2 返回 404 的 text/html 错误页 → 控制台 3 条错误 + 前端缺数据。
//      而脚本注释却写着「全部同步进 R2 可保证 durl() 改道后零 404」——声明存在 ≠ 执行时刻校验。
//   ② github.io 自动 gzip、R2 不会，同档体积 5.7~10.8 倍；改道后总网络负载 916→1470 KiB。
//
// 本测试把「改道引用 ⊆ 同步清单」与「gzip 上传链路完整」变成产出时刻断言。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

// 浏览器可达、且会调用 durl/dget/jget 改道的源码（index.html 内联终端块是 terminal.js 的生成物，
// 与 terminal.js 同源，只扫源文件即可）。
const BROWSER_FILES = ['app.js', 'paper_ui.js', 'terminal.js', 'src/intraday_sampler.js'];
const syncSrc = read('scripts/sync_to_r2.mjs');

const stripLineComments = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

/** 解析 SRC_FILES 清单（只取 'data/…' / 'ui/…' 字符串字面量） */
function syncList() {
  return new Set([...syncSrc.matchAll(/'((?:data|ui)\/[^']+\.(?:json|js|css|html|txt|csv))'/g)].map((m) => m[1]));
}

/** 收集所有走 durl/dget/jget 的 data/* 路径（含 UNI_*_FILE 这类常量拼接） */
function reroutedRefs() {
  const consts = {};
  for (const f of BROWSER_FILES) {
    const t = read(f);
    for (const m of t.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"`](\.?\/?data\/[^'"`]+)['"`]/g)) {
      consts[m[1]] = m[2];
    }
  }
  const found = new Map();
  for (const f of BROWSER_FILES) {
    const code = stripLineComments(read(f));
    for (const m of code.matchAll(/\b(?:dget|durl|jget)\(\s*(?:['"`]([^'"`]+)['"`]|([A-Z_][A-Z0-9_]*))/g)) {
      const raw = m[1] || consts[m[2]] || '';
      const p = raw.replace(/^\.\//, '').replace(/^\//, '').split('?')[0];
      if (!/^data\//.test(p)) continue;
      if (!found.has(p)) found.set(p, new Set());
      found.get(p).add(f);
    }
  }
  return found;
}

test('r2: 所有走改道的 data/* 引用都必须在同步清单内（防 404）', () => {
  const list = syncList();
  const refs = reroutedRefs();
  assert.ok(refs.size >= 20, `应能解析出 ≥20 个改道引用（解析器静默失效防线），实得 ${refs.size}`);
  const missing = [...refs.keys()].filter((p) => !list.has(p)).sort();
  assert.deepEqual(missing, [],
    `以下档会被 durl() 改道到 R2，但不在 sync_to_r2.mjs 的 SRC_FILES → 线上必然 404：\n  ${missing.join('\n  ')}`);
  // 回归锁：这三个正是 2026-11-14 实测 404 的档
  for (const p of ['data/paper_universe.json', 'data/paper_universe-lite.json', 'data/paper/dual_track_latest.json']) {
    assert.ok(list.has(p), `${p} 必须在同步清单内`);
  }
});

test('r2: 上传必须 gzip 预压缩 + ContentEncoding（R2 不自动压缩）', () => {
  assert.match(syncSrc, /import \{ gzipSync \} from 'node:zlib'/, '必须引入 gzipSync');
  assert.match(syncSrc, /ContentEncoding: 'gzip'/, 'encodeBody 必须产出 ContentEncoding');
  assert.match(syncSrc, /\.\.\.\(ContentEncoding \? \{ ContentEncoding \} : \{\}\)/,
    'PutObjectCommand 必须透传 ContentEncoding（只算不传等于没压）');
  assert.match(syncSrc, /const GZIP_MIN_BYTES = 1024/, '小文件应跳过压缩，避免 gzip 头开销负收益');
  assert.match(syncSrc, /gz\.length >= buf\.length/, '高熵数据压缩反而变大时应回退原样');
});

test('r2: manifest 带编码版本，存量未压缩对象必须被强制重传', () => {
  assert.match(syncSrc, /const ENC_VERSION = 'gzip-1'/, '必须有编码版本常量');
  assert.match(syncSrc, /prev\.enc === ENC_VERSION/,
    '增量判断必须比对 enc —— 否则存量对象 size+mtime 未变会被跳过，R2 上永远留着未压缩大档');
  assert.match(syncSrc, /\{ size: item\.size, mtimeMs: item\.mtimeMs, enc: ENC_VERSION \}/,
    '上传成功后 manifest 必须记录编码版本');
});

test('r2: 压缩仅作用于文本档，二进制不得写 CE 头', () => {
  assert.match(syncSrc, /Object\.hasOwn\(CT, extname\(p\)\.toLowerCase\(\)\)/,
    'shouldGzip 应基于 CT 文本扩展名白名单，避免把二进制/已压缩格式写成 gzip');
});
