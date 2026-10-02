import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSentiment } from '../src/sentiment.js';
import { validateArchive } from '../src/validate.js';
import { ThemeDenoiser, computeMomentum } from '../src/themes.js';
import { classifySeat } from '../src/sources.js';
import { recalcAll } from '../src/pipeline.js';
import { applyLhb } from '../src/sources.js';
import { isRangeBoard, aggregateByCode, summarizeCalibers, mergeDuplicateRecords, duplicateKeys, normalizeRecord } from '../src/lhb.js';

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
  // #134 窗口分位: 单样本 < RANK_MIN(20) → null（缺失显式化, 不给假分位）。
  // 断言曾为 typeof 'number'——那是全档分位时代的旧语义, 窗口制落地后过时。
  assert.equal(day.emotion.pct_rank, null);
  assert.equal(day.emotion.net_daily_pct_rank, null);
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

test('lhb 合并：同票同口径逐字段相同的重复必须合并，reasons 数组化（实测 300862 形态）', () => {
  // 2026-08-14 蓝盾光电真实形态：同一次披露里因两个上榜标准各出一条，数值逐字段相同
  const raw = [
    { SECURITY_CODE: '300862', SECURITY_NAME_ABBR: '蓝盾光电', EXPLANATION: '日换手率达到30%的前5只证券',
      CLOSE_PRICE: 20.1, CHANGE_RATE: 20.0, BILLBOARD_NET_AMT: 373823000, BILLBOARD_BUY_AMT: 692549000,
      BILLBOARD_SELL_AMT: 318726000, BILLBOARD_DEAL_AMT: 1011275000, TURNOVERRATE: 35.2 },
    { SECURITY_CODE: '300862', SECURITY_NAME_ABBR: '蓝盾光电', EXPLANATION: '日涨幅达到15%的前5只证券',
      CLOSE_PRICE: 20.1, CHANGE_RATE: 20.0, BILLBOARD_NET_AMT: 373823000, BILLBOARD_BUY_AMT: 692549000,
      BILLBOARD_SELL_AMT: 318726000, BILLBOARD_DEAL_AMT: 1011275000, TURNOVERRATE: 35.2 },
  ];
  const m = mergeDuplicateRecords(raw.map(normalizeRecord));
  assert.equal(m.length, 1, '同票同值两条必须合成一条');
  assert.equal(m[0].net_buy_wan, 37382.3);
  assert.equal(m[0].reasons.length, 2, '两条上榜原因都要留痕');
  assert.deepEqual(m[0].reasons, ['日换手率达到30%的前5只证券', '日涨幅达到15%的前5只证券']);
  assert.equal(m[0].reason, '日换手率达到30%的前5只证券', 'reason 保留首条（与 is_range 判定同源）');
  // 合并的意义：按 code 求净买不再双算
  assert.equal(m.reduce((a, l) => a + l.net_buy_wan, 0), 37382.3);
  assert.equal(m.reduce((a, l) => a + l.net_buy_wan, 0) * 2 - 37382.3, 37382.3); // 反证：不合并会得 74764.6
});

test('lhb 合并：跨口径（区间榜 vs 当日榜）数值不同则各留一条，不合并数值', () => {
  // 2026-08-14 中际联合 603118 真实形态：区间累计榜与当日榜数值本就不同
  const raw = [
    { SECURITY_CODE: '603118', SECURITY_NAME_ABBR: '中际联合', EXPLANATION: '非S证券连续三个交易日内收盘价格涨幅偏离值累计达到20%的证券',
      CLOSE_PRICE: 30, CHANGE_RATE: 10, BILLBOARD_NET_AMT: 228506000, BILLBOARD_BUY_AMT: 465882000,
      BILLBOARD_SELL_AMT: 237375000, BILLBOARD_DEAL_AMT: 703257000, TURNOVERRATE: 12 },
    { SECURITY_CODE: '603118', SECURITY_NAME_ABBR: '中际联合', EXPLANATION: '有价格涨跌幅限制的日收盘价格涨幅偏离值达到7%的前五只证券',
      CLOSE_PRICE: 30, CHANGE_RATE: 10, BILLBOARD_NET_AMT: 78944000, BILLBOARD_BUY_AMT: 256327000,
      BILLBOARD_SELL_AMT: 177383000, BILLBOARD_DEAL_AMT: 433710000, TURNOVERRATE: 12 },
  ];
  const m = mergeDuplicateRecords(raw.map(normalizeRecord));
  assert.equal(m.length, 2, '跨口径数值不同，禁止合并（合并等于在两种口径间凭空二选一）');
  assert.equal(m[0].net_buy_wan, 22850.6);
  assert.equal(m[0].is_range, true);
  assert.equal(m[1].net_buy_wan, 7894.4);
  assert.equal(m[1].is_range, false);
});

test('lhb 合并：同口径但数值不同不合并（把口径决策留给 aggregateByCode 取代表）', () => {
  const rows = [
    { code: 'X', name: 'X', reason: '日涨幅偏离值达到7%', reasons: ['日涨幅偏离值达到7%'], net_buy_wan: 100, buy_wan: 200, sell_wan: 100, is_range: false },
    { code: 'X', name: 'X', reason: '日换手率达到20%', reasons: ['日换手率达到20%'], net_buy_wan: 500, buy_wan: 900, sell_wan: 400, is_range: false },
  ];
  assert.equal(mergeDuplicateRecords(rows).length, 2, '数值不同不合并');
  const a = aggregateByCode(rows);
  assert.equal(a.length, 1);
  assert.equal(a[0].net_buy_wan, 500, '由 aggregateByCode 取 |净额| 最大者');
  assert.equal(a[0].reasons.length, 2);
});

test('lhb 合并：duplicateKeys 能检出未合并的重复（守卫用）', () => {
  const rec = { code: 'A', net_buy_wan: 1, buy_wan: 2, sell_wan: 1, is_range: false, reason: 'r', reasons: ['r'] };
  assert.equal(duplicateKeys([rec, { ...rec, reason: 'r2', reasons: ['r2'] }]).length, 1);
  assert.equal(duplicateKeys([rec]).length, 0);
  // is_range 不同 → 不算重复
  assert.equal(duplicateKeys([rec, { ...rec, is_range: true }]).length, 0);
});

test('lhb 合并：summarizeCalibers 幂等（已合并的再合并是恒等变换）+ 条数留痕', () => {
  const raw = [
    { code: 'A', name: 'a', reason: '日涨幅偏离值达到7%', net_buy_wan: 100, buy_wan: 200, sell_wan: 100, deal_wan: 300, is_range: false },
    { code: 'A', name: 'a', reason: '日换手率达到20%', net_buy_wan: 100, buy_wan: 200, sell_wan: 100, deal_wan: 300, is_range: false },
    { code: 'B', name: 'b', reason: '连续三个交易日内，涨幅偏离值累计达到20%', net_buy_wan: 700, buy_wan: 900, sell_wan: 200, deal_wan: 1100, is_range: true },
  ];
  const c1 = summarizeCalibers(raw);
  assert.equal(c1.total_records, 2);        // A 的两条合并 → A + B
  assert.equal(c1.raw_records, 3);
  assert.equal(c1.merged_away, 1);
  assert.equal(c1.range_records, 1);
  assert.equal(c1.daily_net_yi, 0.01);      // 100 万 = 0.01 亿（不合并会是 0.02 亿）
  // 幂等：把产出再喂一遍，结果一致
  const c2 = summarizeCalibers(c1.all_aggr);
  assert.equal(c2.daily_net_yi, c1.daily_net_yi);
  assert.equal(c2.merged_away, 0);
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
    // 当日榜：同票两榜，两笔**数值不同** → 不合并（口径决策留给 aggregateByCode 取 |净额| 最大一笔 5e7 = 0.5 亿）
    { SECURITY_CODE: '600000', SECURITY_NAME_ABBR: '浦发银行', EXPLANATION: '日涨幅偏离值达到7%的前5只证券', CLOSE_PRICE: 10, CHANGE_RATE: 7.1, BILLBOARD_NET_AMT: 5e7, BILLBOARD_BUY_AMT: 8e7, BILLBOARD_SELL_AMT: 3e7, BILLBOARD_DEAL_AMT: 1.1e8, TURNOVERRATE: 3.2 },
    { SECURITY_CODE: '600000', SECURITY_NAME_ABBR: '浦发银行', EXPLANATION: '日换手率达到20%的前5只证券', CLOSE_PRICE: 10, CHANGE_RATE: 7.1, BILLBOARD_NET_AMT: 3e7, BILLBOARD_BUY_AMT: 5e7, BILLBOARD_SELL_AMT: 2e7, BILLBOARD_DEAL_AMT: 7e7, TURNOVERRATE: 3.2 },
    // 同日榜：同票**同值**重复披露（东财因两个上榜标准各出一条）→ 必须合并成一条
    { SECURITY_CODE: '600519', SECURITY_NAME_ABBR: '贵州茅台', EXPLANATION: '日振幅值达到15%的前5只证券', CLOSE_PRICE: 1800, CHANGE_RATE: 4.0, BILLBOARD_NET_AMT: 2e7, BILLBOARD_BUY_AMT: 4e7, BILLBOARD_SELL_AMT: 2e7, BILLBOARD_DEAL_AMT: 6e7, TURNOVERRATE: 1.1 },
    { SECURITY_CODE: '600519', SECURITY_NAME_ABBR: '贵州茅台', EXPLANATION: '日涨幅偏离值达到7%的前5只证券', CLOSE_PRICE: 1800, CHANGE_RATE: 4.0, BILLBOARD_NET_AMT: 2e7, BILLBOARD_BUY_AMT: 4e7, BILLBOARD_SELL_AMT: 2e7, BILLBOARD_DEAL_AMT: 6e7, TURNOVERRATE: 1.1 },
    // 区间累计榜：BUY 被填成区间累计成交额（实测形态），绝不能进当日口径
    { SECURITY_CODE: '688137', SECURITY_NAME_ABBR: '近岸蛋白', EXPLANATION: '有价格涨跌幅限制的连续3个交易日内收盘价格涨幅偏离值累计达到30%的证券', CLOSE_PRICE: 50, CHANGE_RATE: 12.3, BILLBOARD_NET_AMT: 4e8, BILLBOARD_BUY_AMT: 1.1e10, BILLBOARD_SELL_AMT: 1.1e10, BILLBOARD_DEAL_AMT: 2.2e10, TURNOVERRATE: 20 },
  ];
  applyLhb(day, lhbRaw);
  assert.equal(day.lhb.length, 4);                 // 5 条原始 → 茅台同值两条合并 → 4 条
  assert.equal(day.lhb_aggr.length, 3);            // 全量口径：3 只（600000 / 600519 / 688137）
  assert.equal(day.summary.lhb_count, 4);          // 合并后记录数：600000×2（值不同不合并）+ 600519×1 + 688137×1
  assert.equal(day.summary.lhb_raw_count, 5);      // 东财原始披露 5 条
  assert.equal(day.summary.lhb_merged_away, 1);    // 合并掉 1 条（茅台）
  assert.equal(day.summary.lhb_stocks, 3);
  assert.equal(day.summary.lhb_all_net, 4.7);      // 全量净额（含区间榜）＝0.5 + 0.2 + 4.0 —— 仅诊断
  assert.equal(day.summary.net_pos, 3);
  assert.equal(day.summary.lhb_daily_net, 0.7);    // 当日榜净额（权威）＝0.5 + 0.2，茅台只算一次
  assert.equal(day.summary.lhb_daily_stocks, 2);
  assert.equal(day.summary.lhb_daily_amt, 1.7);    // 1.1 + 0.6
  assert.equal(day.summary.lhb_range_count, 1);
  assert.equal(day.emotion.lhb_daily_net, 0.7);    // 因子入参＝当日榜，不能是 4.7
  const byCode = Object.fromEntries(day.lhb_aggr.map((l) => [l.code, l]));
  assert.equal(byCode['688137'].caliber, 'range');
  assert.equal(byCode['600000'].caliber, 'daily');
  assert.equal(byCode['600000'].reason, '日涨幅偏离值达到7%的前5只证券');
  assert.equal(byCode['600519'].reasons.length, 2, '茅台两条上榜原因都要留痕');
});

test('seats: 席位分类', () => {
  assert.equal(classifySeat('机构专用'), 'inst');
  assert.equal(classifySeat('深股通专用'), 'north');
  assert.equal(classifySeat('沪股通专用'), 'north');
  assert.equal(classifySeat('国盛证券股份有限公司宁波桑田路证券营业部'), 'hot');
  assert.equal(classifySeat(null), 'hot');
});
