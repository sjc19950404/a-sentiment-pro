// config.json 单一事实源守卫（抽离骨架阶段）。
//
// 守护目标：配置曾散落多处（src/config.js 对象字面量、前端 app.js/paper_ui.js 手抄副本、
// 审计脚本正则），任何一处单独改动都会造成「报告说 A、算的是 B」。抽离后 config.json 是
// 唯一事实源，本测试锁定三条不变量：
//   1. JSON 自身合法性（权重和、阈值序、必需键）——薄壳 config.js 在加载时也会拦；
//   2. 薄壳导出 === JSON 内容（防止有人往 config.js 里塞回内联数据字段）；
//   3. 前端手抄副本与 JSON 一致（app.js TH_DEFAULT、paper_ui.js HOLIDAYS——它们是
//      旧浏览器降级路径，允许存在但不允许漂移；漂移即测试红，提醒同步或删除）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import config from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

test('config: JSON 可解析且带 schemaVersion（配置文件演化时版本必须显式递增）', () => {
  const raw = JSON.parse(read('config.json'));
  assert.equal(typeof raw.schemaVersion, 'number');
  assert.ok(raw.schemaVersion >= 1);
});

test('config: 薄壳导出与 config.json 内容深度一致（单一事实源——不得往 config.js 回填内联数据）', () => {
  const raw = JSON.parse(read('config.json'));
  assert.deepEqual(config, raw);
});

test('config: 七因子权重齐全且和为 1', () => {
  const keys = ['s_net20', 's_pos10', 's_brd20', 's_hot10', 's_zdt15', 's_zbl10', 's_amt15'];
  for (const k of keys) assert.equal(typeof config.weights[k], 'number', `缺权重 ${k}`);
  const sum = Object.values(config.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `权重和 ${sum} ≠ 1`);
  // factorKeyMap 键集与 weights 一致（键漂移会让因子静默错位）
  assert.deepEqual(Object.keys(config.weights).sort(), Object.keys(config.factorKeyMap).sort());
});

test('config: 四档阈值升序且与 backtest 引擎口径同源', () => {
  const t = config.backtest.thresholds;
  assert.ok(t.panic < t.hi && t.hi < t.lo && t.lo < t.overheat, JSON.stringify(t));
});

test('config: 薄壳损坏时快速失败（权重和≠1 直接 throw，不带病运行）', async () => {
  // 用临时目录复刻一份坏 config.json + 薄壳加载器验证 throw 语义（不碰真实文件）。
  // 注意 Windows：动态 import 绝对路径必须转 file:// URL，否则 ERR_UNSUPPORTED_ESM_URL_SCHEME。
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'asent-cfg-'));
  try {
    const bad = JSON.parse(read('config.json'));
    bad.weights.s_net20 = 0.5; // 破坏权重和
    writeFileSync(join(dir, 'config.json'), JSON.stringify(bad));
    const shim = read('src/config.js')
      .replace(/join\(__dirname, '\.\.', 'config\.json'\)/, `join(${JSON.stringify(dir)}, 'config.json')`);
    writeFileSync(join(dir, 'shim.mjs'), shim);
    await assert.rejects(import(pathToFileURL(join(dir, 'shim.mjs')).href), /权重和/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: 前端手抄副本与 JSON 一致（降级路径允许存在，但不允许漂移）', () => {
  // app.js TH_DEFAULT —— getThresholds 的最后兜底
  const appSrc = read('app.js');
  const m = appSrc.match(/const TH_DEFAULT = \{([^}]+)\}/);
  assert.ok(m, 'app.js 缺 TH_DEFAULT（若已删除请同步更新本测试）');
  const th = config.backtest.thresholds;
  const pairs = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.equal(pairs.length, 4, `TH_DEFAULT 应含四档, 实际: ${m[1]}`);
  for (const p of pairs) {
    const [k, v] = p.split(':').map((x) => x.trim());
    assert.equal(+v, th[k], `TH_DEFAULT.${k}=${v} 与 config.json thresholds.${k}=${th[k]} 漂移`);
  }
  // paper_ui.js HOLIDAYS —— 假日兜底副本
  const puSrc = read('paper_ui.js');
  const hm = puSrc.match(/const HOLIDAYS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(hm, 'paper_ui.js 缺 HOLIDAYS（若已删除请同步更新本测试）');
  const hset = new Set(hm[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean));
  assert.deepEqual([...hset].sort(), [...config.manualHolidays].sort(), 'paper_ui.js HOLIDAYS 与 config.manualHolidays 漂移');
});
