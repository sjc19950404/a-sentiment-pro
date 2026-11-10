import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAuctionDay, AUCTION_DEFAULTS } from '../src/auction_score.js';

const rec = (items) => ({ trade_date: '2026-11-11', window: '0926', items });

test('auction_score: ① 涨跌幅标记——严格 >3% 强势 / <-3% 走弱 / 边界 3.00 中性', () => {
  const r = scoreAuctionDay(rec([
    { c: '600001', n: '甲', jjPct: 3.01, jjAmt: 1e6 },
    { c: '600002', n: '乙', jjPct: -3.01, jjAmt: 1e6 },
    { c: '600003', n: '丙', jjPct: 3.00, jjAmt: 1e6 },
    { c: '600004', n: '丁', jjPct: 0, jjAmt: 1e6 },
    { c: '600005', n: '戊', jjPct: null, jjAmt: 1e6 },
  ]));
  const by = Object.fromEntries(r.items.map((i) => [i.c, i.chgLevel]));
  assert.equal(by['600001'], 'strong');
  assert.equal(by['600002'], 'weak');
  assert.equal(by['600003'], 'neutral', '边界 3.00 不算强势（严格大于）');
  assert.equal(by['600004'], 'neutral');
  assert.equal(by['600005'], 'neutral', '缺失不猜');
  assert.deepEqual([r.signals.strong, r.signals.weak, r.signals.neutral], [1, 1, 3]);
});

test('auction_score: ② 竞价额占比——jjAmt/昨日额；昨日额缺失 → null 如实标注', () => {
  const prev = new Map([['600001', 1e8]]);
  const r = scoreAuctionDay(rec([
    { c: '600001', n: '甲', jjPct: 1, jjAmt: 2e6 },
    { c: '600002', n: '乙', jjPct: 1, jjAmt: 2e6 },
  ]), { prevTurnoverByCode: prev });
  const by = Object.fromEntries(r.items.map((i) => [i.c, i]));
  assert.equal(by['600001'].amtRatio, 0.02);
  assert.equal(by['600002'].amtRatio, null);
  assert.equal(r.signals.amtRatioMissing, 1);
});

test('auction_score: ③ 一字缩量——涨停幅开盘 + 占比<阈值 → shrink；占比足 → heavy；量缺 → shrink:null', () => {
  const prev = new Map([['600001', 1e8], ['600002', 1e8], ['600003', 1e8]]);
  const r = scoreAuctionDay(rec([
    { c: '600001', n: '甲', jjPct: 10.0, jjAmt: 1e6 },  // 主板一字，占比 1% < 2%
    { c: '600002', n: '乙', jjPct: 10.0, jjAmt: 5e6 },  // 占比 5% → heavy
    { c: '600003', n: '丙', jjPct: 5.0, jjAmt: 1e6 },   // 非涨停 → 无 yizi（即便占比低）
  ]), { prevTurnoverByCode: prev });
  const by = Object.fromEntries(r.items.map((i) => [i.c, i.yizi]));
  assert.deepEqual(by['600001'], { is: true, shrink: true });
  assert.deepEqual(by['600002'], { is: true, shrink: false });
  assert.equal(by['600003'], null, '非一字不判缩量');
  assert.equal(r.signals.yiziShrink, 1);
  assert.equal(r.signals.yiziHeavy, 1);
  // 占比缺失的一字票：shrink=null（不猜），不计入 shrink/heavy
  const r2 = scoreAuctionDay(rec([{ c: '600001', n: '甲', jjPct: 10.0, jjAmt: 1e6 }]));
  assert.deepEqual(r2.items[0].yizi, { is: true, shrink: null });
  assert.equal(r2.signals.yiziShrink, 0);
});

test('auction_score: 创业板 20cm 一字——走 limit_caliber 分板块阈值（10% 不算涨停）', () => {
  const r = scoreAuctionDay(rec([
    { c: '300001', n: '创甲', jjPct: 10.0, jjAmt: 1e6 },  // 创业板 10% 未及 20cm 涨停
    { c: '300002', n: '创乙', jjPct: 20.0, jjAmt: 1e6 },  // 20cm 涨停
  ]), { prevTurnoverByCode: new Map([['300001', 1e8], ['300002', 1e8]]) });
  assert.equal(r.items[0].yizi, null, '创业板 10% 不是涨停');
  assert.ok(r.items[1].yizi && r.items[1].yizi.is, '创业板 20% 是一字');
});

test('auction_score: 阈值参数化——chgThreshold 0.05 时 3.5% 变中性；不合成总分字段', () => {
  const r = scoreAuctionDay(rec([{ c: '600001', n: '甲', jjPct: 3.5, jjAmt: 1e6 }]), { chgThreshold: 0.05 });
  assert.equal(r.items[0].chgLevel, 'neutral');
  assert.equal(r.params.chgThreshold, 0.05);
  // 拍板：v1 不合成单一竞价分数——输出不得含 score/total 字段
  assert.ok(!('score' in r) && !('total' in r) && !('score' in r.items[0]));
  assert.equal(AUCTION_DEFAULTS.chgThreshold, 0.03);
  assert.equal(AUCTION_DEFAULTS.yiziRatioMax, 0.02);
});

test('auction_score: 空记录 → null（调用方不落空档）', () => {
  assert.equal(scoreAuctionDay(null), null);
  assert.equal(scoreAuctionDay({ trade_date: 'x', items: [] }), null);
});
