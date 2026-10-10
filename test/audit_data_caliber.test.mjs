// P1-2（2026-10-10）：跨档口径审计脚本行为锁定。
//   10-08 事故的隐蔽形态——档案 tradeDate 不滞后但 pain 停在 9-30——
//   必须被本脚本抓红（behind + staleReason 双报）。用真实 data/ 档冒烟
//  （先例：ai_report.test.mjs §14 真实档冒烟），锚用 --anchor 显式给定
//   免受工作区当日状态影响。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', 'scripts', 'audit_data_caliber.mjs');

const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') };
  }
};

test('audit_data_caliber：断供形态抓红——pain behind + staleReason，behind/missing → exit 1', () => {
  // 锚取 2026-10-08（当前 data/ 实况：signals=global=board_rank=10-08 对齐，
  // pain 停 9-30 → 必红；周六跑出诚实红即脚本的存在意义）。
  const { code, out } = run(['--json', '--anchor', '2026-10-08']);
  const j = JSON.parse(out);
  assert.equal(j.anchor, '2026-10-08', '锚显式给定');
  assert.equal(j.ok, false, '存在违例 → ok=false（宁红不假）');
  assert.equal(code, 1, 'behind/missing 必须非零退出（CI 可接）');
  const byKey = Object.fromEntries(j.rows.map((r) => [r.key, r]));
  // 六档齐查（档案锚 vs signals/pain/global/board_rank/breadth/ztpool）
  assert.deepEqual(j.rows.map((r) => r.key).sort(),
    ['board_rank', 'breadth', 'global', 'pain', 'signals', 'ztpool'], '审计覆盖六档');
  assert.equal(byKey.signals.state, 'equal', 'signals 与锚一致');
  assert.equal(byKey.pain.state, 'behind', '断供档判 behind');
  assert.match(byKey.pain.staleReason, /curDate=2026-09-30 ≠ 档案锚 2026-10-08/, '陈旧闸语义同源（P0-2 唯一判据）');
  // 旁路/夜盘产物先于档案属正常时序 → ahead 不红
  assert.equal(byKey.breadth.state, 'ahead');
  assert.equal(byKey.ztpool.state, 'ahead');
});

test('audit_data_caliber：对齐日 pain 转绿——equal 判定不误伤', () => {
  const { out } = run(['--json', '--anchor', '2026-09-30']);
  const j = JSON.parse(out);
  const pain = j.rows.find((r) => r.key === 'pain');
  assert.equal(pain.state, 'equal', '锚对齐 pain 口径日 → equal（不误伤正常态）');
  assert.equal(pain.staleReason, null, '对齐即无陈旧原因');
});
