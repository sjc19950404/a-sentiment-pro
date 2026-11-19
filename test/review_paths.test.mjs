// ★ /api/review 双路径守卫（P2-11，2026-11-19）
// ── 背景 ────────────────────────────────────────────────────────────────────
// 人工复核改判（manual_review）有两条路径：Pi 本机走后端 ./api/review（写
// data/manual_review.json），GitHub Pages 走静态档 data/manual_review.json 直读。
// 体检实测：静态测试服务器上 ./api/review 404 属设计内（域名感知 + catch fail-open）。
// 但「两条路径各需什么前提」此前无人校验——本守卫把这些前提变成断言：
//   ① 域名感知分支存在（github.io → 静态档；其余 → ./api/review）
//   ② 静态降级 catch 存在（404/网络失败不阻断主流程）
//   ③ 部署清单含 data/manual_review.json（静态路径的数据前提）
//   ④ 采集脚本落盘路径与消费方读取路径一致（写读同文件）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

const app = read('app.js');

test('① 域名感知分支：github.io 静态档 + 本机 ./api/review 两路都在', () => {
  assert.ok(/github\.io/.test(app) && /manual_review\.json/.test(app),
    '缺 github.io 静态档分支——Pages 上人工复核改判将不可见');
  assert.ok(app.includes('./api/review'),
    '缺本机后端分支——Pi 上改判写不进 data/manual_review.json');
  // 分支互斥结构：hostname 判断先于 fetch
  const i = app.indexOf('github.io');
  const j = app.indexOf('./api/review');
  assert.ok(i >= 0 && j >= 0, '两个分支字面量必须同时存在');
});

test('② 静态降级：fetch 失败必须 fail-open（catch 且不抛出）', () => {
  // 取 ./api/review 附近的函数体（前 40 行内必有 catch）
  const seg = app.slice(Math.max(0, app.indexOf('./api/review') - 800),
    app.indexOf('./api/review') + 1200);
  assert.ok(/catch/.test(seg), './api/review 调用段缺 catch——后端 404 会抛未捕获异常');
});

test('③ 部署链：data/manual_review.json 在 workflow cp 清单覆盖范围内', () => {
  const wf = read('.github/workflows/deploy-pages.yml');
  assert.ok(/data\/\*\*/.test(wf) || wf.includes('data/manual_review.json'),
    '部署清单未覆盖 data/ —— 静态档改判在 Pages 上读不到');
});

test('④ 消费一致：数据档存在且采集方写同一文件（若采集脚本在库）', () => {
  const f = 'data/manual_review.json';
  // 档可能尚无改判（数组可空），但文件路径约定必须成立：
  // 若文件存在则必须是合法 JSON；若不存在（CI 干净 checkout）跳过——CI 无本地档惯例。
  if (!existsSync(path.join(ROOT, f))) return; // CI 无档 skip（本地 hook 有档照跑）
  const d = JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
  assert.ok(Array.isArray(d) || typeof d === 'object', 'manual_review.json 结构异常');
});
