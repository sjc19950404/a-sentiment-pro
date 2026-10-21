// UI 设计 token 一致性守护（B+B2 · 2026-10-12）
// 单一事实源 = ui/tokens.css。云端 style.css 是它的内联副本；本地 ui/template.html
// 由 build_ui 注入同源 token。本测试在 CI（npm test）中守护三者不漂移：
//   1) style.css 顶部 :root 与 tokens.css 的变量名集合 + 取值完全一致
//   2) 本地 template.html 消费侧不得残留旧变量名（--dim/--accent/--gold/--panel2）
// 新增语义色或改取值，只改 ui/tokens.css 一处即可，本测试会抓住漏同步的副本。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseVars(css) {
  const m = css.match(/:root\s*\{([^}]*)\}/); // 取首个 :root（顶层 token 集；响应式覆盖块不计入）
  if (!m) return null;
  const vars = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let mm;
  while ((mm = re.exec(m[1]))) vars[mm[1]] = mm[2].trim();
  return vars;
}

test('UI token 单一事实源一致性（云端内联版 ↔ tokens.css）', () => {
  const tokens = parseVars(readFileSync(path.join(ROOT, 'ui', 'tokens.css'), 'utf8'));
  const cloud = parseVars(readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
  assert.ok(tokens, 'tokens.css 应有 :root');
  assert.ok(cloud, 'style.css 应有 :root（顶层 token 集）');
  const tk = Object.keys(tokens).sort();
  const ck = Object.keys(cloud).sort();
  assert.deepEqual(ck, tk, `云端 style.css 与 tokens.css 变量名集合必须一致（差异见 diff）`);
  for (const k of tk) {
    assert.equal(cloud[k], tokens[k], `变量 ${k} 取值在云端与单一源必须一致（云=${cloud[k]} 源=${tokens[k]}）`);
  }
});

test('本地模板消费侧无旧变量名残留', () => {
  const tpl = readFileSync(path.join(ROOT, 'ui', 'template.html'), 'utf8');
  for (const old of ['--dim', '--accent', '--gold', '--panel2']) {
    assert.ok(!tpl.includes(`var(${old})`), `本地模板不得残留旧变量 var(${old})（应重命名为统一 token）`);
    // 防御：连定义都不该有（:root 已不含这些名）
    assert.ok(!new RegExp(`--${old.replace('--', '')}\\s*:`).test(tpl), `本地模板 :root 不得定义旧变量 ${old}`);
  }
});

test('build_ui 注入后 dist 使用统一 token（双端同源）', () => {
  // 该用例依赖 dist/index.html 已构建（daily.yml 的 build_ui 步骤 / 本地 npm run build:ui）。
  // 若 dist 未生成则跳过（不阻塞纯单测环境），由 CI 构建后覆盖。
  const distPath = path.join(ROOT, 'dist', 'index.html');
  let dist;
  try { dist = readFileSync(distPath, 'utf8'); } catch { return; }
  const injected = parseVars(dist);
  const tokens = parseVars(readFileSync(path.join(ROOT, 'ui', 'tokens.css'), 'utf8'));
  assert.ok(injected, 'dist 应含 :root');
  for (const k of Object.keys(tokens)) {
    assert.equal(injected[k], tokens[k], `dist 变量 ${k} 必须等于单一源（双端同源）`);
  }
});
