import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSentiment } from '../src/sentiment.js';
import { validateArchive } from '../src/validate.js';
import { ThemeDenoiser, computeMomentum } from '../src/themes.js';
import { classifySeat } from '../src/sources.js';
import { recalcAll } from '../src/pipeline.js';
import { applyLhb } from '../src/sources.js';
import { isRangeBoard, aggregateByCode, summarizeCalibers } from '../src/lhb.js';

test('sentiment: 全因子正常 -> 0-100', () => {
  const r = computeSentiment({
    netBuy: 3, upCount: 3000, downCount: 2000, industryUp: 60, industryTotal: 90,
    limitUp: 80, limitDown: 20, brokenCount: 15, amount: 1.8e4, amountMA20: 1.5e4,
  });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.equal(r.missing.length, 0);
  assert.equal(r.imputedRatio, 0);
});

test('sentiment: 缺失部分因子 -> 标记且不崩', () => {
  const r = computeSentiment({ netBuy: null, limitUp: 30, limitDown: 50, brokenCount: 10 });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.missing.length > 0);
  assert.ok(r.imputedRatio > 0);
});

test('validate: 正常 archive 通过', () => {
  const arc = {
    meta: {}, all_days: [{ trade_date: '2026-09-28', emotion: { score: 34.8 }, hot: [] }],
    signals: [],
  };
  assert.equal(validateArchive(arc).ok, true);
});

test('validate: 越界分 / 非法日期 报错', () => {
  const bad = {
    meta: {}, all_days: [{ trade_date: '2026/09/28', emotion: { score: 150 }, hot: [] }],
    signals: [],
  };
  const r = validateArchive(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2);
});

test('themes: 去噪合并同概念 + 个股去重', () => {
  const days = [{
    hot: [
      { code: 'A', reason: '上海国资+半导体' },
      { code: 'B', reason: '广州国资入主+PCB' },
      { code: 'C', reason: '国资+并购重组' },
      { code: 'D', reason: '拟收购界面财联社' }, // 黑名单
      { code: 'E', reason: '上海国资+半导体' }, // 个股去重
      { code: 'A', reason: '上海国资+半导体' }, // 同日同票重复
    ],
  }];
  const dn = new ThemeDenoiser().fit(days);
  const byDay = dn.themesAllDays(days);
  // 国企改革 覆盖 A,B,C,E = 4 股（上海国资/广州国资入主/国资 均归一）；半导体 覆盖 A,E = 2；并购重组 仅C=1 -> 全局孤点剔除
  assert.equal(byDay[0]['国企改革'].size, 4);
  assert.equal(byDay[0]['半导体'].size, 2);
  assert.ok(!('并购重组' in byDay[0])); // 仅1股 -> 剔除
  assert.ok(!('拟收购界面财联社' in byDay[0])); // 黑名单
});

test('themes: 动量区分新晋/退潮', () => {
  const mk = (themes) => Object.fromEntries(themes.map((t) => [t, new Set(['x' + Math.random()])]));
  const byDay = [mk(['AI算力']), mk(['AI算力']), mk(['机器人']), mk(['机器人']), mk(['机器人']),
    mk(['AI算力']), mk(['AI算力']), mk(['AI算力']), mk(['机器人']), mk(['机器人']), mk(['新能源'])]; // 最后5日: AI算力+机器人; 前5日: AI算力+机器人; 新能源仅最后1日
  const m = computeMomentum(byDay, 5, 5, 1);
  assert.ok(m.fresh.includes('新能源'));
  assert.ok(!m.fading.includes('AI算力')); // AI算力两窗都在 -> 延续
});

test('recalcAll: 有原始数据的天用统一公式重算, 输出 factors', () => {
  const day = {
    trade_date: '2026-09-28',
    summary: { net_total_yi: 3, net_pos: 30, net_neg: 10, ind_up: 60, ind_count: 90, zt_count: 80, dt_count: 20, zb_count: 15, amount_yi: 1.8e4 },
    emotion: { value: 99 },
    hot: [],
  };
  recalcAll([day]);
  assert.ok(day.emotion.value >= 0 && day.emotion.value <= 100);
  assert.ok(day.emotion.factors && typeof day.emotion.factors.s_net === 'number');
  assert.equal(typeof day.emotion.pct_rank, 'number');
});

test('recalcAll: 无原始数据的种子天标记 legacy 保留原值', () => {
  const day = {
    trade_date: '2026-08-01',
    summary: {},
    emotion: { value: 55.5 },
    hot: [],
  };
  recalcAll([day]);
  assert.equal(day.emotion.value, 55.5);
  assert.equal(day.emotion._legacy, true);
});

test('lhb: 区间累计榜判定（含「严重异常期间」，早先正则漏判）', () => {
  assert.equal(isRangeBoard('连续三个交易日内，涨幅偏离值累计达到20%的证券'), true);
  assert.equal(isRangeBoard('有价格涨跌幅限制的连续3个交易日内收盘价格涨幅偏离值累计达到30%的证券'), true);
  assert.equal(isRangeBoard('严重异常期间日收盘价格涨幅偏离值累计达到100%的证券'), true);
  assert.equal(isRangeBoard('日涨幅偏离值达到7%的前5只证券'), false);
  assert.equal(isRangeBoard('无价格涨跌幅限制的证券'), false);
  assert.equal(isRangeBoard(undefined), false);
});

test('lhb: 同票多榜取 |净额| 最大一笔，且 reason 跟着一起换（诱因与数值必须同源）', () => {
  const rows = [
    { code: 'A', name: 'x', reason: '日涨幅偏离值达到7%', net_buy_wan: 100, buy_wan: 200, sell_wan: 100, deal_wan: 300, is_range: false },
    { code: 'A', name: 'x', reason: '连续三个交易日内，涨幅偏离值累计达到20%', net_buy_wan: 500, buy_wan: 900, sell_wan: 400, deal_wan: 1300, is_range: true },
  ];
  const a = aggregateByCode(rows);
  assert.equal(a.length, 1);
  assert.equal(a[0].net_buy_wan, 500);
  assert.equal(a[0].reason, '连续三个交易日内，涨幅偏离值累计达到20%'); // 换了代表就必须换诱因
  assert.equal(a[0].caliber, 'range');
  assert.equal(a[0].reasons.length, 2);                                  // 两条上榜原因都留痕
});

test('lhb: 双口径各自汇总（区间累计值绝不进入当日口径）', () => {
  const recs = [
    { code: 'D1', name: 'd1', reason: '日涨幅偏离值达到7%的前5只证券', net_buy_wan: 5000, buy_wan: 8000, sell_wan: 3000, deal_wan: 11000, is_range: false },
    { code: 'D2', name: 'd2', reason: '日换手率达到20%的前5只证券', net_buy_wan: -2000, buy_wan: 3000, sell_wan: 5000, deal_wan: 8000, is_range: false },
    { code: 'R1', name: 'r1', reason: '连续三个交易日内，涨幅偏离值累计达到30%的证券', net_buy_wan: 40000, buy_wan: 1.1e6, sell_wan: 1.1e6, deal_wan: 2.2e6, is_range: true },
  ];
  const c = summarizeCalibers(recs);
  assert.equal(c.total_records, 3);
  assert.equal(c.range_records, 1);
  assert.equal(c.daily_stocks, 2);
  assert.equal(c.daily_net_yi, 0.3);    // (5000 - 2000)/1e4
  assert.equal(c.daily_amt_yi, 1.9);    // (11000 + 8000)/1e4
  assert.equal(c.all_stocks, 3);
  assert.equal(c.all_net_yi, 4.3);      // 含区间榜的 40000 → 45000-2000 = 43000 万 = 4.3 亿
  // 关键：区间榜的巨额基数只出现在全量口径里，当日口径的成交额与净额都不受污染
  assert.ok(c.daily_amt_yi < c.all_net_yi, `当日成交 ${c.daily_amt_yi} 应远小于被污染的全量净额 ${c.all_net_yi}`);
});

test('applyLhb: 重抓数据刷进 day 原始层（双口径各自落位）', () => {
  const day = {
    trade_date: '2026-09-25',
    lhb: [], lhb_aggr: [],
    summary: { net_pos: 0, net_neg: 0 },
    emotion: {},
    hot: [],
  };
  const lhbRaw = [
    // 当日榜：同票两榜，取 |净额| 最大一笔 5e7 = 0.5 亿
    { SECURITY_CODE: '600000', SECURITY_NAME_ABBR: '浦发银行', EXPLANATION: '日涨幅偏离值达到7%的前5只证券', CLOSE_PRICE: 10, CHANGE_RATE: 7.1, BILLBOARD_NET_AMT: 5e7, BILLBOARD_BUY_AMT: 8e7, BILLBOARD_SELL_AMT: 3e7, BILLBOARD_DEAL_AMT: 1.1e8, TURNOVERRATE: 3.2 },
    { SECURITY_CODE: '600000', SECURITY_NAME_ABBR: '浦发银行', EXPLANATION: '日换手率达到20%的前5只证券', CLOSE_PRICE: 10, CHANGE_RATE: 7.1, BILLBOARD_NET_AMT: 3e7, BILLBOARD_BUY_AMT: 5e7, BILLBOARD_SELL_AMT: 2e7, BILLBOARD_DEAL_AMT: 7e7, TURNOVERRATE: 3.2 },
    // 区间累计榜：BUY 被填成区间累计成交额（实测形态），绝不能进当日口径
    { SECURITY_CODE: '688137', SECURITY_NAME_ABBR: '近岸蛋白', EXPLANATION: '有价格涨跌幅限制的连续3个交易日内收盘价格涨幅偏离值累计达到30%的证券', CLOSE_PRICE: 50, CHANGE_RATE: 12.3, BILLBOARD_NET_AMT: 4e8, BILLBOARD_BUY_AMT: 1.1e10, BILLBOARD_SELL_AMT: 1.1e10, BILLBOARD_DEAL_AMT: 2.2e10, TURNOVERRATE: 20 },
  ];
  applyLhb(day, lhbRaw);
  assert.equal(day.lhb_aggr.length, 2);            // 全量口径：2 只
  assert.equal(day.summary.lhb_count, 3);          // 3 条记录
  assert.equal(day.summary.lhb_stocks, 2);
  assert.equal(day.summary.lhb_all_net, 4.5);      // 全量净额（含区间榜）——仅诊断
  assert.equal(day.summary.net_pos, 2);
  assert.equal(day.summary.lhb_daily_net, 0.5);    // 当日榜净额——权威
  assert.equal(day.summary.lhb_daily_stocks, 1);
  assert.equal(day.summary.lhb_daily_amt, 1.1);
  assert.equal(day.summary.lhb_range_count, 1);
  assert.equal(day.emotion.lhb_daily_net, 0.5);    // 因子入参＝当日榜，不能是 4.5
  const byCode = Object.fromEntries(day.lhb_aggr.map((l) => [l.code, l]));
  assert.equal(byCode['688137'].caliber, 'range');
  assert.equal(byCode['600000'].caliber, 'daily');
  assert.equal(byCode['600000'].reason, '日涨幅偏离值达到7%的前5只证券');
});

test('seats: 席位分类', () => {
  assert.equal(classifySeat('机构专用'), 'inst');
  assert.equal(classifySeat('深股通专用'), 'north');
  assert.equal(classifySeat('沪股通专用'), 'north');
  assert.equal(classifySeat('国盛证券股份有限公司宁波桑田路证券营业部'), 'hot');
  assert.equal(classifySeat(null), 'hot');
});
