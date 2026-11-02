// 冰点试错仓反核预警测试：锁死「哪些标的被监控 / 何时触发 / 去重不重复推送」的每一条纪律。
// 这些用例的价值不在「跑通」，而在「别人改阈值或监控口径时不会悄悄破坏反核预警」——
// 例如把翻红判据错改成「不跌就行」、或漏掉 ice-trial 持仓、或同一票一天推 N 次。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iceTrialCodes, detectAntiNuke, runAntiNukeMonitor, ANTINUKE_DROP_PCT } from '../src/intraday_antinuke.js';

const ACC = (poses) => ({ positions: poses });
const POS = (over = {}) => ({ code: 'x', name: 'x', qty: 100, avail: 100, avgCost: 10, last: 10, ...over });

// ───────── 监控标的筛选：仅 ice-trial / antiNuke 持仓 ─────────
test('iceTrialCodes：仅挑出 iceTrial 或 antiNuke 持仓，普通持仓忽略', () => {
  const acc = ACC({
    '600001': POS({ iceTrial: true, antiNuke: true }),
    '600002': POS({ antiNuke: true }),
    '600003': POS({}),                       // 普通持仓，不监控
    '600004': POS({ iceTrial: false }),       // 显式 false，不监控
  });
  const codes = iceTrialCodes(acc).sort();
  assert.deepEqual(codes, ['600001', '600002']);
  assert.equal(iceTrialCodes(ACC({})).length, 0, '无持仓 → 空');
  assert.equal(iceTrialCodes(null).length, 0, '账户缺失 → 零回归空');
});

// ───────── 反核特征判定：深跌谷 + 收盘翻红 ─────────
test('detectAntiNuke：地天板特征 = 日内曾跌超阈值 且 收盘翻红', () => {
  // 跌停附近(-8%)后翻红至 +2% → 触发
  assert.deepEqual(detectAntiNuke({ low: 9.2, prevClose: 10, close: 10.2 }), { triggered: true, lowChgPct: -8, closeChgPct: 2 });
  // 深跌但收盘仍绿(-3%) → 未翻红，不触发
  assert.equal(detectAntiNuke({ low: 9.2, prevClose: 10, close: 9.7 }).triggered, false, '深跌但未翻红不应触发');
  // 全天红(+3%)但几乎没跌(low -2%) → 普通好日子，不触发
  assert.equal(detectAntiNuke({ low: 9.8, prevClose: 10, close: 10.3 }).triggered, false, '未深跌不应触发');
  // 边界：low 恰为 -5%（阈值含等号）→ 触发
  assert.equal(detectAntiNuke({ low: 9.5, prevClose: 10, close: 10.1 }).triggered, true, 'low 恰 -5% 应触发（阈值含等号）');
  // 边界：low -4.9% → 不触发
  assert.equal(detectAntiNuke({ low: 9.51, prevClose: 10, close: 10.1 }).triggered, false, 'low -4.9% 不应触发');
  // 缺字段 → 不触发（fail-open）
  assert.equal(detectAntiNuke({ low: 9.2, prevClose: 10 }).triggered, false, '缺 close 不触发');
  assert.equal(detectAntiNuke(null).triggered, false, 'null 输入零回归');
  assert.equal(detectAntiNuke({ low: 9.2, prevClose: 0, close: 10.2 }).triggered, false, 'prevClose 为 0 防除零');
});

// ───────── 主流程：发独立企微预警 + 当日去重 ─────────
test('runAntiNukeMonitor：ice-trial 持仓命中地天板 → 发预警；同日重跑不去重推送', () => {
  const acc = ACC({ '600001': POS({ iceTrial: true, name: '试错A' }) });
  const quotes = [{ code: '600001', name: '试错A', low: 9.2, prevClose: 10, close: 10.2, date: '2026-10-30' }];
  const r1 = runAntiNukeMonitor({ account: acc, quotes, state: {}, date: '2026-10-30' });
  assert.equal(r1.alerts.length, 1, '应发 1 条预警');
  assert.match(r1.alerts[0].detail, /🚨 \[反核预警\] 持仓票 试错A\(600001\)/, '预警文案应含标的与反核标记');
  assert.match(r1.alerts[0].detail, /日内最低 -8% 后翻红至 \+2%/, '预警应带深跌谷与翻红幅度');
  assert.match(r1.alerts[0].detail, /请人工核验盘口是否介入反核或减仓离场/, '预警应引导人工核验而非自动下单');
  assert.equal(r1.alerts[0].severity, 'warn', '预警严重度应为 warn');
  // 同日重跑：state 已记 key → 不再推送
  const r2 = runAntiNukeMonitor({ account: acc, quotes, state: r1.state, date: '2026-10-30' });
  assert.equal(r2.alerts.length, 0, '同日已告警应去重，不再推送');
  // 次日（不同 date）→ 重新可触发
  const r3 = runAntiNukeMonitor({ account: acc, quotes, state: r1.state, date: '2026-10-31' });
  assert.equal(r3.alerts.length, 1, '次日应可再次触发');
});

test('runAntiNukeMonitor：普通持仓 / 无快照 → 不告警（fail-open）', () => {
  // 普通持仓即使出现地天板也不监控
  const acc = ACC({ '600003': POS({}) });
  const quotes = [{ code: '600003', low: 9.2, prevClose: 10, close: 10.2, date: '2026-10-30' }];
  assert.equal(runAntiNukeMonitor({ account: acc, quotes, state: {}, date: '2026-10-30' }).alerts.length, 0, '普通持仓不监控');
  // ice-trial 持仓但缺快照 → 跳过
  const acc2 = ACC({ '600001': POS({ iceTrial: true }) });
  assert.equal(runAntiNukeMonitor({ account: acc2, quotes: [], state: {}, date: '2026-10-30' }).alerts.length, 0, '缺快照不告警');
  // ice-trial 持仓但只是普通红盘（未深跌）→ 不告警
  const acc3 = ACC({ '600001': POS({ iceTrial: true }) });
  const q = [{ code: '600001', low: 9.8, prevClose: 10, close: 10.3, date: '2026-10-30' }];
  assert.equal(runAntiNukeMonitor({ account: acc3, quotes: q, state: {}, date: '2026-10-30' }).alerts.length, 0, '普通红盘不告警');
});

test('ANTINUKE_DROP_PCT 默认值合理', () => {
  assert.equal(ANTINUKE_DROP_PCT, -5, '默认深跌阈值为 -5%');
});
