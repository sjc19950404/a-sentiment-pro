// 窗口连板口径（N天M板）单测——2026-10-23 用户校准新增
//
// 锁四件事：
// ① 口径语义：窗口板数 = 最近 N 个交易日（含当日）的涨停天数，非连续连板也计数
//    （东财 lbc 只数连续板的少计问题，见 src/ztpool_window.js 头注）；
// ② 数据源优先级：当日实时池 > archive-recent 档案名单 > ztpool_history 兜底，
//    档案口径覆盖兜底（防旧档断更数据反客为主）；
// ③ 降级纪律：窗口脊缺失 → degraded=true 且只数当日，不猜、不崩；
// ④ 边界：空池/空历史/字符串码/null opts 均不抛错。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindowBoards, WINDOW_DAYS } from '../src/ztpool_window.js';

test('窗口口径：非连续连板也计数（5天3板 → 窗口3，连续口径只有1）', () => {
  // 股A：10-20/10-22/10-23 涨停（10-21 断档）→ 东财 lbc=1（只认连续），窗口口径 3
  const recent = {
    spine: ['20261019', '20261020', '20261021', '20261022', '20261023'],
    codesByDate: {
      '20261019': ['600002'],
      '20261020': ['600001'],
      '20261021': ['600002'],
      '20261022': ['600001'],
    },
  };
  const r = computeWindowBoards([], [{ c: '600001' }], '20261023', { recent });
  assert.equal(r.ztLbw['600001'], 3, '5天3板 → 窗口板数 3');
  assert.equal(r.lbw2, 1, '窗口≥2 只数 1（连续口径会记 0）');
  assert.equal(r.degraded, false);
  assert.deepEqual(r.windowDates, recent.spine);
});

test('数据源优先级：档案名单覆盖 ztpool_history 兜底（旧档不断更数据反客为主）', () => {
  const history = [{ date: '20261021', pool: [{ c: '600001' }] }]; // 兜底说 10-21 在池
  const recent = { spine: ['20261021', '20261022', '20261023'], codesByDate: { '20261021': ['600002'] } };
  const r = computeWindowBoards(history, [{ c: '600001' }, { c: '600002' }], '20261023', { recent });
  assert.equal(r.ztLbw['600001'], 1, '档案说 10-21 不在池 → 只数当日');
  assert.equal(r.ztLbw['600002'], 2, '档案说 10-21 在池 → 当日+10-21');
});

test('当日池覆盖历史同日档（重跑幂等）', () => {
  const history = [{ date: '20261023', pool: [{ c: '600001' }, { c: '600009' }] }];
  const r = computeWindowBoards(history, [{ c: '600001' }], '20261023', {
    recent: { spine: ['20261022', '20261023'], codesByDate: { '20261022': ['600001'] } },
  });
  assert.equal(r.ztLbw['600001'], 2);
  assert.equal(r.ztLbw['600009'], undefined, '当日已不在实时池的旧档个股不计入');
});

test('降级：窗口脊缺失 → degraded 且只数当日，不猜不崩', () => {
  const r = computeWindowBoards([], [{ c: '600001' }], '20261023', {});
  assert.equal(r.degraded, true);
  assert.deepEqual(r.windowDates, ['20261023']);
  assert.equal(r.ztLbw['600001'], 1);
  assert.equal(r.lbw2, 0);
});

test('边界：空池/空历史/字符串码/null opts 均不抛错', () => {
  assert.deepEqual(computeWindowBoards([], [], '', {}).ztLbw, {});
  const r = computeWindowBoards(null, null, null, null);
  assert.equal(r.maxLbw, null);
  const r2 = computeWindowBoards([{ date: '20261022', pool: ['600001', '600002'] }], ['600001'], '20261023', {
    recent: { spine: ['20261022', '20261023'], codesByDate: { '20261022': ['600001'] } },
  });
  assert.equal(r2.ztLbw['600001'], 2, '字符串码与 {c} 两种形态都认');
});

test('窗口天数可配置（默认 5）', () => {
  assert.equal(WINDOW_DAYS, 5);
  const recent = { spine: ['20261019', '20261020', '20261021', '20261022', '20261023'], codesByDate: { '20261022': ['A'] } };
  const r3 = computeWindowBoards([], [{ c: 'A' }], '20261023', { recent, windowDays: 3 });
  assert.equal(r3.ztLbw['A'], 2, '3 日窗 = 10-22/10-23 → A 出现 2 天');
  const r5 = computeWindowBoards([], [{ c: 'A' }], '20261023', { recent });
  assert.equal(r5.ztLbw['A'], 2, '5 日窗 = 10-19~10-23 → A 仍 2 天');
});
