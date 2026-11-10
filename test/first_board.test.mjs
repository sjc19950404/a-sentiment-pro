import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceStats, pickAdvanceCandidates, settleCandidates, FB_DEFAULTS } from '../src/first_board.js';

const mkP = (c, n, lbc, fbt, fund, ltsz, zbc = 0) => ({ c, n, lbc, fbt, fund, ltsz, zbc });
const days = [
  { date: '2026-11-01', pool: [mkP('600001', '甲', 1, 93500, 4e7, 1e9), mkP('600002', '乙', 1, 143000, 5e6, 1e9, 1), mkP('600003', '丙', 2, 93000, 9e7, 1e9)] },
  { date: '2026-11-02', pool: [mkP('600001', '甲', 2, 92500, 3e7, 1e9), mkP('600004', '丁', 1, 95000, 2e7, 1e9)] },
  { date: '2026-11-03', pool: [mkP('600005', '戊', 1, 94000, 2.5e7, 1e9)] },
];

test('first_board: advanceStats 分层基率——T日首板→T+1同票lbc≥2判晋级', () => {
  const s = advanceStats(days);
  assert.equal(s.total.n, 3, '首板样本=甲乙丁（丙是2板不计）');
  assert.equal(s.total.adv, 1, '只有甲晋级');
  assert.equal(s.total.rate, 33.3);
  assert.equal(s.byFbt['早板(9:25-10:00)'].n, 2);
  assert.equal(s.byFbt['早板(9:25-10:00)'].rate, null, '分层样本2<5不出率（不造数）——样本门槛是设计行为');
  assert.equal(s.byFbt['尾板(14:00-15:00)'].n, 1);
  assert.equal(s.byFbt['尾板(14:00-15:00)'].rate, null, '样本<5不出率（不造数）');
  assert.equal(s.byFund['>=3%'].n, 1);
  assert.equal(s.byFund['>=3%'].rate, null, '样本1<5');
  assert.equal(s.byZbc['零炸板'].n, 2);
  assert.equal(s.windowDays, 2, '有首板的日数');
});

test('first_board: pickAdvanceCandidates——早板+封单≥3%+零炸板；缺数据/尾板/炸板不进', () => {
  const stats = advanceStats(days);
  const pool = [
    mkP('700001', 'A', 1, 93500, 4e7, 1e9),          // 4% 早板零炸 → 进
    mkP('700002', 'B', 1, 143000, 9e7, 1e9),          // 尾板 → 不进
    mkP('700003', 'C', 1, 93500, 4e7, 1e9, 2),        // 炸板2次 → 不进
    mkP('700004', 'D', 1, 93500, null, 1e9),          // fund缺 → 不进
    mkP('700005', 'E', 2, 93500, 4e7, 1e9),           // 2板非首板 → 不进
    mkP('700006', 'F', 1, 93500, 2e7, 1e9),           // 2%<3% → 主层不进
  ];
  const cs = pickAdvanceCandidates(pool, stats);
  assert.deepEqual(cs.map((c) => c.code), ['700001']);
  assert.equal(cs[0].baseRate, null, '该层历史样本1<5 → null 如实');
  // 主层空 → 降档回退（1%~3% 层），标注 fallback+该层基率
  const cs2 = pickAdvanceCandidates([mkP('700006', 'F', 1, 93500, 2e7, 1e9), mkP('700007', 'G', 1, 144500, 2.5e7, 1e9, 1)], stats);
  assert.deepEqual(cs2.map((c) => c.code), ['700006'], '降档也要求早板+零炸板（G尾板+炸板不进）');
  assert.equal(cs2[0].fallback, true);
  assert.equal(cs2[0].baseRate, null);
});

test('first_board: cap=3 截断 + 参数可覆盖', () => {
  const pool = [1, 2, 3, 4].map((i) => mkP(`70000${i}`, 'X' + i, 1, 93000, 5e7, 1e9));
  assert.equal(pickAdvanceCandidates(pool, null).length, 3);
  assert.equal(pickAdvanceCandidates(pool, null, { cap: 2 }).length, 2);
  assert.equal(FB_DEFAULTS.fundPctMin, 0.03);
});

test('first_board: settleCandidates 对账——次日同票lbc≥2=true，否则false', () => {
  const r = settleCandidates(
    [{ code: '600001', name: '甲' }, { code: '600009', name: '无' }],
    [mkP('600001', '甲', 2, 92500, 1e7, 1e9)],
  );
  assert.equal(r[0].advanced, true);
  assert.equal(r[1].advanced, false, '次日未进池=未晋级');
  assert.deepEqual(settleCandidates([], []), []);
});

// ── 推送段（C16 同款：fixture 注入，与生产磁盘解耦）──
import { buildFirstBoardBrief } from '../src/ai_report_push.js';

const WATCH_FIXTURE = [{
  date: '2026-11-11',
  stats: { total: { n: 708, adv: 90, rate: 12.7 }, windowDays: 14 },
  candidates: [
    { code: '600001', name: '甲', fbt: 94700, fundPct: 0.032, zbc: 0, baseRate: null },
    { code: '600002', name: '乙', fbt: 93100, fundPct: 0.025, zbc: 0, baseRate: 14.6, fallback: true },
  ],
}];

test('first_board_push: 观察段报文——含封板时间/层基率/降档标/基率非预测声明', () => {
  const m = buildFirstBoardBrief({ date: '2026-11-11', trigger: 'eod', status: 'ok' }, new Date(), WATCH_FIXTURE);
  assert.ok(m, '有候选 → 报文在场');
  assert.ok(m.text.includes('09:47封'), '封板时间格式化');
  assert.ok(m.text.includes('层基率样本不足'), 'null 如实');
  assert.ok(m.text.includes('[降档]'), '降档标注');
  assert.ok(m.text.includes('基率非预测'), '纪律声明必在');
  assert.equal(m.synthetic.report_type, 'post_market_first_board');
});

test('first_board_push: 无候选/缺档 → null 不推（fail-open）', () => {
  assert.equal(buildFirstBoardBrief({ date: 'x' }, new Date(), [{ date: 'x', candidates: [] }]), null);
  assert.equal(buildFirstBoardBrief({ date: 'x' }, new Date(), []), null);
});
