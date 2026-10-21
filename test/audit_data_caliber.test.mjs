// P1-2（2026-10-10）：跨档口径审计脚本行为锁定。
//   10-08 事故的隐蔽形态——档案 tradeDate 不滞后但 pain 停在 9-30——
//   必须被本脚本抓红（behind + staleReason 双报）。
//
// ⚠ 2026-10-12 重构：原用例直接跑真实 data/，并断言「signals=10-08 且 pain=9-30」
//   这一**特定事故态**。10-09 补齐后数据转健康，断供形态在真实档里再也重现不出来，
//   用例随之失效——它红得没有道理，绿了也不再证明什么（真实数据健康时它照样绿）。
//   改为用 --data-dir 自建夹具目录，与真实数据状态彻底解耦：断供 / 对齐两种形态
//   都能稳定演练，且不随交易日推进而反复红。
//   真实档另留一条冒烟，只验「跑得通、六档齐」，不断言各档状态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// ── 夹具：自建最小 data/ 目录 ────────────────────────────────────────────
//   形态对齐脚本的取数路径（scripts/audit_data_caliber.mjs 的 pickers）：
//   signals=meta.tradeDate / pain=curDate / global=meta.aShareTradeDate /
//   board_rank=对象里的日期键取最大 / breadth=meta.tradeDate /
//   ztpool=末元素 date（无横杠形态，脚本内规范化）。
const ANCHOR_DAY = '2026-10-09';
const STALE_DAY = '2026-09-30';
const SIX_KEYS = ['board_rank', 'breadth', 'global', 'pain', 'signals', 'ztpool'];

const makeDataDir = (overrides = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'caliber-'));
  const files = {
    'archive-index.json': { latestDate: ANCHOR_DAY },
    'signals-latest.json': { meta: { tradeDate: ANCHOR_DAY } },
    'pain-latest.json': { curDate: ANCHOR_DAY },
    'global.json': { meta: { aShareTradeDate: ANCHOR_DAY } },
    'board_rank.json': { [ANCHOR_DAY]: { rows: [] } },
    'breadth-latest.json': { meta: { tradeDate: ANCHOR_DAY } },
    'ztpool_history.json': [{ date: '20261009' }],
    ...overrides,
  };
  for (const [name, val] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), JSON.stringify(val), 'utf8');
  }
  return dir;
};

test('audit_data_caliber：断供形态抓红——pain behind + staleReason，behind/missing → exit 1', () => {
  // pain 停在 9-30、其余档对齐 10-09 → 断供只应抓到 pain 一项
  const dir = makeDataDir({ 'pain-latest.json': { curDate: STALE_DAY } });
  try {
    const { code, out } = run(['--json', '--data-dir', dir]);
    const j = JSON.parse(out);
    assert.equal(j.anchor, ANCHOR_DAY, '锚取自 archive-index.latestDate');
    assert.equal(j.ok, false, '存在违例 → ok=false（宁红不假）');
    assert.equal(code, 1, 'behind/missing 必须非零退出（CI 可接）');
    const byKey = Object.fromEntries(j.rows.map((r) => [r.key, r]));
    assert.deepEqual(j.rows.map((r) => r.key).sort(), SIX_KEYS, '审计覆盖六档');
    assert.equal(byKey.signals.state, 'equal', 'signals 与锚一致');
    assert.equal(byKey.pain.state, 'behind', '断供档判 behind');
    assert.match(byKey.pain.staleReason, /curDate=2026-09-30 ≠ 档案锚/, '陈旧闸语义同源（P0-2 唯一判据）');
    // 其余档对齐 → 不误伤
    assert.equal(byKey.global.state, 'equal');
    assert.equal(byKey.board_rank.state, 'equal');
    assert.equal(byKey.ztpool.state, 'equal');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit_data_caliber：对齐日 pain 转绿——equal 判定不误伤', () => {
  const dir = makeDataDir(); // 六档全部对齐锚日
  try {
    const { code, out } = run(['--json', '--data-dir', dir]);
    const j = JSON.parse(out);
    const pain = j.rows.find((r) => r.key === 'pain');
    assert.equal(pain.state, 'equal', '锚对齐 pain 口径日 → equal（不误伤正常态）');
    assert.equal(pain.staleReason, null, '对齐即无陈旧原因');
    assert.equal(code, 0, '全部对齐 → 退出 0（CI 不该红）');
    assert.equal(j.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit_data_caliber：真实档可跑通（六档齐查 + 锚可用；不断言各档状态）', () => {
  // 真实档只做「跑得通」冒烟：各档 equal/behind 取决于当日数据实况——健康与断供
  // 都合法，断言具体状态会让用例随数据推进反复红（那是测试脆弱，不是数据问题）。
  const { out } = run(['--json']);
  const j = JSON.parse(out);
  assert.match(j.anchor, /^\d{4}-\d{2}-\d{2}$/, '锚必须是可用日期');
  assert.deepEqual(j.rows.map((r) => r.key).sort(), SIX_KEYS, '审计覆盖六档');
  for (const r of j.rows) {
    assert.ok(['equal', 'ahead', 'behind', 'missing'].includes(r.state), `${r.key} state=${r.state} 非法`);
  }
});
