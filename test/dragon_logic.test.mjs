import test from 'node:test';
import assert from 'node:assert/strict';
import { dragonLogicBlock } from '../src/dragon_logic.js';

// 实盘权限过滤（2026-10-29·老板无创业板300/301、科创板688权限）：
// 妖股透视保留全市场连板（含 300/688）用于参考市场情绪；名称前 [无权限] 文本标签已弃用（板块徽章已标识板块），
// tradability 改用 noPermission 数据属性承载（前端不渲染文字）。
test('dragonLogicBlock：300/301/688 妖股保留 noPermission 属性、名称不再加 [无权限] 前缀（保留全量、不剔除）', () => {
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

  // 名称不再加 [无权限] 前缀（板块徽章已标识板块）
  assert.equal(d300.name, '创业妖', '300 妖股名称不应前缀 [无权限]');
  assert.equal(d300.noPermission, true);
  assert.equal(d601.name, '沪主妖', '601 主板妖股名称不变');
  assert.equal(d601.noPermission, undefined);
  assert.equal(d688.name, '科创妖', '688 妖股名称不应前缀 [无权限]');
  assert.equal(d688.noPermission, true);

  // 保留全量（不剔除），仅标记 noPermission 用于情绪参考
  assert.equal(dragons.length, 3, '妖股仍保留全量（含 300/688），不剔除');

  // pureSentiment（纯情绪炒作分支）同样带 noPermission、名称无前缀
  const p300 = pureSentiment.find((p) => p.code === '300111');
  assert.equal(p300.name, '创业妖', 'pureSentiment 中 300 名称无前缀');
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
