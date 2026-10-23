// 窗口连板口径（N天M板）单测——2026-10-23 用户校准新增
//
// 锁三件事：
// ① 口径语义：窗口板数 = 最近 N 个交易日（含当日）的涨停天数，非连续连板也计数
//    （东财 lbc 只数连续板的少计问题，见 src/ztpool_window.js 头注）；
// ② 数据源优先级：当日实时池 > ztpool_history 真实池 > K 线补档；真实池不覆盖；
// ③ 降级纪律：窗口脊缺失（archive-recent 不在）→ degraded=true 且只数当日，
//    不猜、不崩；空池/空历史不抛错。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindowBoards, WINDOW_DAYS } from '../src/ztpool_window.js';

const ymd = (d) => d;

test('窗口口径：非连续连板也计数（5天3板 → 窗口3，连续口径只有1）', () => {
  // 股A：10-20/10-22/10-23 涨停（10-21 断档）→ 东财 lbc=1（只认连续），窗口口径 3
  const history = [
    { date: '20261020', pool: [{ c: '600001' }, { c: '600002' }] },
    { date: '20261022', pool: [{ c: '600001' }] },
  ];
  const today = [{ c: '600001' }]; // 今日又涨停，lbc 回归 1
  const spine = ['20261019', '20261020', '20261021', '20261022', '20261023'];
  const r = computeWindowBoards(history, today, ymd('20261023'), { spine });
  assert.equal(r.ztLbw['600001'], 3, '5天3板 → 窗口板数 3');
  assert.equal(r.lbw2, 1, '窗口≥2 只数 1（连续口径会记 0）');
  assert.equal(r.degraded, false);
  assert.deepEqual(r.windowDates, spine);
});

test('数据源优先级：真实池不被 K 线补档覆盖；补档只填真实池缺席的日期', () => {
  const history = [{ date: '20261022', pool: [{ c: '600001' }] }];
  const kline = { '20261022': { '600001': 9, '600002': 5 }, '20261021': { '600001': 4 } };
  const r = computeWindowBoards(history, [{ c: '600001' }], ymd('20261023'), {
    spine: ['20261021', '20261022', '20261023'], kline,
  });
  // 600001：10-21(补档4次但只算1天) + 10-22(真实池) + 10-23(当日) = 3 天
  assert.equal(r.ztLbw['600001'], 3);
  // 600002 只在补档的 10-22 出现，但当日不在池 → 不进 ztLbw（只数当日池个股）
  assert.equal(r.ztLbw['600002'], undefined);
});

test('当日池覆盖历史同日档（重跑幂等）', () => {
  const history = [{ date: '20261023', pool: [{ c: '600001' }, { c: '600009' }] }];
  const r = computeWindowBoards(history, [{ c: '600001' }], ymd('20261023'), {
    spine: ['20261022', '20261023'],
  });
  assert.equal(r.ztLbw['600001'], 1);
  assert.equal(r.ztLbw['600009'], undefined, '当日已不在实时池的旧档个股不计入');
});

test('降级：窗口脊缺失 → degraded 且只数当日，不猜不崩', () => {
  const r = computeWindowBoards([], [{ c: '600001' }], ymd('20261023'), {});
  assert.equal(r.degraded, true);
  assert.deepEqual(r.windowDates, ['20261023']);
  assert.equal(r.ztLbw['600001'], 1);
  assert.equal(r.lbw2, 0);
});

test('边界：空池/空历史/字符串码/缺日期均不抛错', () => {
  assert.deepEqual(computeWindowBoards([], [], '', {}).ztLbw, {});
  const r = computeWindowBoards(null, null, null, null);
  assert.equal(r.maxLbw, null);
  const r2 = computeWindowBoards([{ date: '20261020', pool: ['600001', '600002'] }], ['600001'], '20261020', {
    spine: ['20261020'],
  });
  assert.equal(r2.ztLbw['600001'], 1, '字符串码与 {c} 两种形态都认');
});

test('窗口天数可配置（默认 5）', () => {
  assert.equal(WINDOW_DAYS, 5);
  const history = [
    { date: '20261016', pool: [{ c: 'A' }] },
    { date: '20261022', pool: [{ c: 'A' }] },
  ];
  const spine = ['20261019', '20261020', '20261021', '20261022', '20261023'];
  const r3 = computeWindowBoards(history, [{ c: 'A' }], '20261023', { spine, windowDays: 3 });
  assert.equal(r3.ztLbw['A'], 2, '3 日窗 = 10-22/10-23 → A 出现 2 天');
  const r5 = computeWindowBoards(history, [{ c: 'A' }], '20261023', { spine });
  assert.equal(r5.ztLbw['A'], 2, '5 日窗 = 10-19~10-23 → A 仍 2 天（10-16 不在窗内）');
});
