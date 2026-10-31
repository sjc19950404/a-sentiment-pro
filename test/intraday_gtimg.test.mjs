import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGtimgBatch, buildHotFromRows, buildQuotesFromRows } from '../src/intraday_node.mjs';

// 一段 mock 的 qt.gtimg.cn/q= 响应（GBK 文本，~ 分隔）：含 2 只有效 + 2 只应被过滤
const SAMPLE = [
  'v_sh600000="1~浦发银行~600000~11.48~11.50~11.55~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0";',
  'v_sz300750="1~宁德时代~300750~250.00~248.00~252.00~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0";',
  'v_sh000001="1~~000001~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0";', // 空名 → 过滤
  'v_xyz="1~foo~123~0~0~0";', // 代码非 6 位 → 过滤
].join('\n');

test('parseGtimgBatch：解析有效股票，过滤无效/缺席', () => {
  const stocks = parseGtimgBatch(SAMPLE);
  assert.equal(stocks.length, 2, '应只保留 2 只有效股票');
  const map = Object.fromEntries(stocks.map((s) => [s.code, s]));
  assert.equal(map['600000'].name, '浦发银行');
  assert.equal(map['600000'].close, 11.48);
  assert.equal(map['600000'].change_pct, -0.17); // (11.48-11.50)/11.50 = -0.1739% → -0.17
  assert.equal(map['600000'].open, 11.55);
  assert.equal(map['300750'].change_pct, 0.81); // (250-248)/248 = 0.806% → 0.81
  // 缺失字段保持 null（不落成 0，遵循「宁缺毋假」纪律）
  assert.equal(map['600000'].huanshou, null);
  assert.equal(map['600000'].liangbi, null);
  assert.equal(map['600000'].pe_ttm, null);
});

test('parseGtimgBatch：缺字段/乱码文本不抛错', () => {
  assert.deepEqual(parseGtimgBatch(''), []);
  assert.deepEqual(parseGtimgBatch('not a gtimg response'), []);
  assert.deepEqual(parseGtimgBatch('v_sh600000="1~短~600000";'), []); // 字段不足 35 → 过滤
});

// gtimg 股票（code/name/close/change_pct）→ hot 行字段对齐东财源格式
test('buildHotFromRows：gtimg 形状行 → hot 字段对齐（含 reason/close/zhangfu/date，按涨幅降序）', () => {
  const rows = [
    { code: '600000', name: '浦发银行', close: 11.48, change_pct: -0.17 },
    { code: '300750', name: '宁德时代', close: 250.0, change_pct: 0.81 },
  ];
  const hot = buildHotFromRows(rows, '腾讯gtimg直连兜底', '2026-10-31');
  assert.ok(Array.isArray(hot), 'hot 应为数组');
  assert.equal(hot.length, 2);
  assert.equal(hot[0].code, '300750'); // 按 zhangfu 降序：0.81 在前
  assert.equal(hot[1].code, '600000');
  assert.equal(hot[0].close, 250.0);
  assert.equal(hot[0].zhangfu, 0.81);
  assert.ok(hot[0].reason.includes('gtimg'), 'reason 应标注 gtimg 兜底');
  assert.equal(hot[0].date, '2026-10-31');
  assert.equal(hot[0].huanshou, null); // 缺失保持 null
  assert.equal(hot[0].avg_price, null);
});

// 东财 diff 行（f12/f14/f2/f3/f8/f115/f23/f10）→ 同一 buildHotFromRows 产出同构 hot（证明两源格式一致）
test('buildHotFromRows：东财形状行 → 同构 hot（两源字段对齐）', () => {
  const rows = [
    { f12: '600000', f14: '浦发银行', f2: 11.48, f3: -0.17, f8: 0.5, f115: 5.1, f23: 0.7, f10: 1.2 },
    { f12: '300750', f14: '宁德时代', f2: 250.0, f3: 0.81, f8: 1.1, f115: 18.0, f23: 4.2, f10: 1.5 },
  ];
  const hot = buildHotFromRows(rows, 'Node 直连东财派生', '2026-10-31');
  assert.equal(hot.length, 2);
  const a = hot.find((r) => r.code === '600000');
  const b = hot.find((r) => r.code === '300750');
  // hot 项仅含 close/zhangfu/huanshou/avg_price/date（pe_tbm/pb/liangbi 在 quotes 里，见下个测试）
  assert.equal(a.close, 11.48);
  assert.equal(a.zhangfu, -0.17);
  assert.equal(a.huanshou, 0.5);
  assert.equal(a.avg_price, null);
  assert.equal(b.close, 250.0);
  assert.equal(b.zhangfu, 0.81);
});

test('buildQuotesFromRows：gtimg + 东财两形状均产出同构 quotes', () => {
  const gtimg = [{ code: '600000', name: '浦发银行', close: 11.48, change_pct: -0.17 }];
  const em = [{ f12: '600000', f14: '浦发银行', f2:11.48, f3:-0.17, f115:5.1, f23:0.7, f10:1.2 }];
  const qg = buildQuotesFromRows(gtimg);
  const qe = buildQuotesFromRows(em);
  assert.equal(qg['600000'].close, 11.48);
  assert.equal(qg['600000'].change_pct, -0.17);
  assert.equal(qg['600000'].pe_ttm, null); // gtimg 不提供 → null
  assert.equal(qe['600000'].pe_ttm, 5.1); // 东财提供
  assert.equal(qe['600000'].pb, 0.7);
  assert.equal(qe['600000'].liangbi, 1.2);
});

test('buildHotFromRows：空行 → null', () => {
  assert.equal(buildHotFromRows([], 'x', '2026-10-31'), null);
});
