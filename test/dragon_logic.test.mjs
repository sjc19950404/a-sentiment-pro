import test from 'node:test';
import assert from 'node:assert/strict';
import { dragonLogicBlock } from '../src/dragon_logic.js';

// 实盘权限过滤（2026-10-29·老板无创业板300/301、科创板688权限）：
// 妖股透视保留全市场连板（含 300/688）用于参考市场情绪，但无权限标的在名称前打 [无权限] 标签，不剔除。
test('dragonLogicBlock：300/301/688 妖股打 [无权限] 标签（保留全量、不剔除）', () => {
  const report = {
    asOfDate: '2026-10-29',
    tradeDate: '2026-10-29',
    generatedAt: '2026-10-29T15:00:00.000Z',
    dragons: [
      { code: '300111', name: '创业妖', lb: 4, hybk: '机器人', logic_type: 'pure_sentiment', reason: 'r', confidence: 0.7, is_pure_sentiment: true },
      { code: '601222', name: '沪主妖', lb: 3, hybk: '机器人', logic_type: 'pure_sentiment', reason: 'r', confidence: 0.8, is_pure_sentiment: true },
      { code: '688333', name: '科创妖', lb: 5, hybk: '芯片', logic_type: 'main_line', reason: 'r', confidence: 0.6, is_pure_sentiment: false },
    ],
  };
  const { dragons, pureSentiment } = dragonLogicBlock(report, { tradeDate: '2026-10-29' });

  const d300 = dragons.find((d) => d.code === '300111');
  const d601 = dragons.find((d) => d.code === '601222');
  const d688 = dragons.find((d) => d.code === '688333');

  // 标签：300/301/688 打 [无权限]，主板不打
  assert.ok(d300.name.startsWith('[无权限]'), '300 妖股名称应前缀 [无权限]');
  assert.equal(d300.noPermission, true);
  assert.ok(!d601.name.startsWith('[无权限]'), '601 主板妖股不应打标签');
  assert.equal(d601.noPermission, undefined);
  assert.ok(d688.name.startsWith('[无权限]'), '688 妖股名称应前缀 [无权限]');
  assert.equal(d688.noPermission, true);

  // 保留全量（不剔除），仅打标签用于情绪参考
  assert.equal(dragons.length, 3, '妖股仍保留全量（含 300/688），仅打标签不剔除');

  // pureSentiment（纯情绪炒作分支）同样带标签
  const p300 = pureSentiment.find((p) => p.code === '300111');
  assert.ok(p300.name.startsWith('[无权限]'), 'pureSentiment 中 300 也应打标签');
  assert.equal(p300.noPermission, true);
});

test('dragonLogicBlock：空/畸形/缺 asOfDate 输入安全返回 null（防伪守卫），不抛错', () => {
  assert.equal(dragonLogicBlock(null), null);
  assert.equal(dragonLogicBlock({}), null);
  // 有 dragons 但缺 asOfDate → 新鲜度守卫返回 null
  assert.equal(dragonLogicBlock({ dragons: [{ code: '600001', name: 'X', is_pure_sentiment: true }] }), null);
  // 有 asOfDate 但 tradeDate 不匹配 → null
  assert.equal(dragonLogicBlock({ asOfDate: '2026-10-29', dragons: [] }, { tradeDate: '2026-10-30' }), null);
});
