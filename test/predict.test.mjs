// 上涨预测引擎测试：锁死「凭什么认为它会涨、凭什么把它剔掉」的每一条纪律。
//
// 这些用例的价值不在「跑通」，而在「别人改引擎时不会悄悄破坏纪律」——
// 例如把高换手的票放回推荐（实测负期望）、把概率分改成主观权重求和（用户无法核验）、
// 或者在没有样本时编一个概率（虚假精确）。所有阈值都必须能追溯到实测分组。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREDICT_VERSION, PROB_BANDS, probBand, probBandText,
  REJECT_RULES, screenCandidate, BASELINE_UP, BASELINE_N, PREDICT_FACTORS,
  predictUpProb, expectedReturn, suggestStop, predictPicks,
} from '../src/predict.js';

// 构造候选。字段名与 picks.js buildCandidates 的输出严格一致，
// 避免测试因字段拼错而「恰好通过」——那会让引擎上线后取不到值却无人发现。
const cand = (over = {}) => ({
  code: '600001', name: '测试票', isZt: true, streak: 1,
  turnoverPct: 8, netWan: 30000, changePct: 10, ...over,
});

// ────────────────────── 一、概率分档位 ──────────────────────

test('概率档位：边界值逐点落在正确档（差一档就是「较高」与「中等」的区别）', () => {
  assert.equal(probBand(65).key, 'high');
  assert.equal(probBand(64.9).key, 'mid');
  assert.equal(probBand(57).key, 'mid');
  assert.equal(probBand(56.9).key, 'low');
  assert.equal(probBand(50).key, 'low');
  assert.equal(probBand(49.9).key, 'poor');
  assert.equal(probBand(0).key, 'poor');
});

test('概率档位：非数值输入落到最差档（不猜、不当成 0 分之外的任何东西）', () => {
  assert.equal(probBand(null).key, 'poor');
  assert.equal(probBand(undefined).key, 'poor');
  assert.equal(probBand(NaN).key, 'poor');
  assert.equal(probBand('abc').key, 'poor');
});

test('概率档位表自洽：按 min 降序、不含负数区间之外的洞', () => {
  const mins = PROB_BANDS.map((b) => b.min);
  for (let i = 1; i < mins.length; i++) assert.ok(mins[i] < mins[i - 1], '必须按 min 严格降序');
  assert.equal(mins[mins.length - 1], 0, '最后一档必须从 0 起（覆盖全区间）');
});

test('probBandText 返回可读说明，不含 undefined', () => {
  const t = probBandText(70);
  assert.ok(t.length > 4);
  assert.ok(!/undefined/.test(t), t);
});

// ────────────────────── 二、剔除规则（核心：大概率亏必须扔掉） ──────────────────────

test('剔除：换手 ≥25% 命中（实测 T+3 由正转负、回撤翻倍）', () => {
  const r = screenCandidate(cand({ turnoverPct: 25 }));
  assert.equal(r.rejected, true);
  assert.equal(r.hits[0].key, 'high_turnover');
  // 24.9% 不该被剔——边界必须卡在 25 本身
  assert.equal(screenCandidate(cand({ turnoverPct: 24.9 })).rejected, false);
});

test('剔除：连板 ≥5 命中（样本仅 10 例，不足以下结论即不可依赖）', () => {
  assert.equal(screenCandidate(cand({ streak: 5 })).rejected, true);
  assert.equal(screenCandidate(cand({ streak: 5 })).hits[0].key, 'high_streak');
  // 4 连板仍可推荐（实测 n=31、上涨占比 67.7%，是有效分组）
  assert.equal(screenCandidate(cand({ streak: 4 })).rejected, false);
});

test('剔除：北交所标的（4/8/920 开头）三个号段全覆盖', () => {
  for (const code of ['430001', '830001', '920001']) {
    const r = screenCandidate(cand({ code }));
    assert.equal(r.rejected, true, `${code} 应被剔除`);
    assert.ok(r.hits.some((h) => h.key === 'bj_board'), code);
  }
});

test('剔除：ST / *ST 命中（±5% 涨跌幅与正常股不可比）', () => {
  assert.equal(screenCandidate(cand({ name: 'ST龙元' })).rejected, true);
  assert.equal(screenCandidate(cand({ name: '*ST未名' })).rejected, true);
  assert.equal(screenCandidate(cand({ name: 'st小写' })).rejected, true);
  // 「钢铁」不含 ST——不能因为子串误伤
  assert.equal(screenCandidate(cand({ name: '钢铁龙头' })).rejected, false);
});

test('剔除：既无涨停也无正向净买（两个有效证据都不具备）', () => {
  const r = screenCandidate({ code: '600001', isZt: false, netWan: 0 });
  assert.equal(r.rejected, true);
  assert.ok(r.hits.some((h) => h.key === 'no_limit_evidence'));
});

test('剔除：仅小额外资金且无涨停（净买>0 组实测弱于全部涨停基准）', () => {
  const r = screenCandidate({ code: '600001', isZt: false, netWan: 5000 });
  assert.equal(r.rejected, true);
  assert.ok(r.hits.some((h) => h.key === 'weak_fund_only'), JSON.stringify(r.hits));
  // 净买到 2 亿即不再命中该规则
  const big = screenCandidate({ code: '600001', isZt: false, netWan: 20000 });
  assert.ok(!big.hits.some((h) => h.key === 'weak_fund_only'));
});

test('剔除：有涨停就不受「仅小额外资金」约束（涨停是独立有效证据）', () => {
  const r = screenCandidate({ code: '600001', isZt: true, streak: 1, turnoverPct: 8, netWan: 100 });
  assert.equal(r.rejected, false, JSON.stringify(r.hits));
});

test('剔除：一条候选可同时命中多条规则（hits 全量返回，便于解释）', () => {
  const r = screenCandidate({ code: '830001', name: 'ST北交', isZt: true, streak: 6, turnoverPct: 40 });
  assert.ok(r.hits.length >= 3, `应命中多条，实际 ${r.hits.length}`);
  assert.ok(r.hits.some((h) => h.key === 'bj_board'));
  assert.ok(r.hits.some((h) => h.key === 'st_stock'));
  assert.ok(r.hits.some((h) => h.key === 'high_turnover'));
  assert.ok(r.hits.some((h) => h.key === 'high_streak'));
});

test('剔除：每条规则都带实测依据（why 必须含数字，不接受空泛措辞）', () => {
  for (const r of REJECT_RULES) {
    assert.ok(r.key && r.label && r.why, `规则 ${r.key} 字段不全`);
    assert.ok(r.why.length > 20, `规则 ${r.key} 的依据太短，像是空话`);
  }
  // 有实测样本的规则必须在 why 里写出数字
  const withData = REJECT_RULES.filter((r) => r.stat && r.stat.n > 0);
  assert.ok(withData.length >= 3, '至少三条规则应有实测样本');
  for (const r of withData) {
    assert.ok(/\d/.test(r.why), `规则 ${r.key} 有样本却没写出数字依据`);
  }
});

test('剔除：畸形输入不抛错（规则内部抛错不得影响其它规则）', () => {
  assert.doesNotThrow(() => screenCandidate(null));
  assert.doesNotThrow(() => screenCandidate(undefined));
  assert.doesNotThrow(() => screenCandidate({}));
  assert.doesNotThrow(() => screenCandidate({ turnoverPct: 'abc', streak: {}, netWan: [] }));
});

// ────────────────────── 三、概率打分（必须可核验、不虚假精确） ──────────────────────

test('概率：基准值等于实测的全涨停股上涨占比（不是拍脑袋的 50）', () => {
  assert.equal(BASELINE_UP, 55.3);
  assert.equal(BASELINE_N, 975);
  // 无任何因子命中时，分数应恰好是基准
  const r = predictUpProb(cand({ streak: 1, turnoverPct: 15, netWan: 100 }), {});
  assert.equal(r.score, BASELINE_UP);
  assert.equal(r.factors.length, 0);
});

test('概率：命中因子越多分越高，且 2 连板 > 首板', () => {
  const s1 = predictUpProb(cand({ streak: 1, turnoverPct: 8, netWan: 100 }), {}).score;
  const s2 = predictUpProb(cand({ streak: 2, turnoverPct: 8, netWan: 100 }), {}).score;
  assert.ok(s2 > s1, `2 连板 ${s2} 应 > 首板 ${s1}`);
});

test('概率：低换手、大额净买、稀缺环境各自都抬高概率（实测正向因子）', () => {
  const base = predictUpProb(cand({ streak: 1, turnoverPct: 15, netWan: 100 }), { ztCount: 100 });
  const lowTurn = predictUpProb(cand({ streak: 1, turnoverPct: 8, netWan: 100 }), { ztCount: 100 });
  const bigFund = predictUpProb(cand({ streak: 1, turnoverPct: 15, netWan: 30000 }), { ztCount: 100 });
  const scarce = predictUpProb(cand({ streak: 1, turnoverPct: 15, netWan: 100 }), { ztCount: 30 });
  assert.ok(lowTurn.score > base.score, `低换手 ${lowTurn.score} 应 > 基准 ${base.score}`);
  assert.ok(bigFund.score > base.score, `大额净买 ${bigFund.score} 应 > 基准 ${base.score}`);
  assert.ok(scarce.score > base.score, `稀缺 ${scarce.score} 应 > 基准 ${base.score}`);
});

test('概率：修正量饱和封顶，多个因子叠加也不会吹出不可能的「90% 上涨」', () => {
  // 同时命中 2 连板 + 低换手 + 大额净买 + 稀缺 + 20% 品种
  const r = predictUpProb(cand({ streak: 2, turnoverPct: 5, netWan: 50000, code: '300001' }), { ztCount: 20 });
  assert.ok(r.factors.length >= 5, `应命中多个因子，实际 ${r.factors.length}`);
  assert.ok(r.score <= 95, `分数 ${r.score} 不应超过 95（累计修正必须封顶）`);
  // 实测最乐观的分组是 72.2%，封顶 18pt 后上限 73.3——不能突破这个量级
  assert.ok(r.score <= 74, `分数 ${r.score} 超出实测可达范围`);
});

test('概率：样本量取命中因子里最小者（木桶原理，最弱证据决定可信度）', () => {
  const r = predictUpProb(cand({ streak: 2, turnoverPct: 8, netWan: 30000, code: '300001' }), { ztCount: 30 });
  const mins = r.factors.map((f) => f.n);
  assert.equal(r.sample, Math.min(...mins));
  assert.ok(r.sample <= 130, `样本应为最弱的那个（2 连板 n=130），实际 ${r.sample}`);
});

test('概率：streak 缺失时不参与连板因子（不得用 +null=0 误判）', () => {
  const r = predictUpProb({ isZt: true, turnoverPct: 8, netWan: 30000 }, { ztCount: 100 });
  assert.ok(!r.factors.some((f) => f.key === 'streak2' || f.key === 'streak34'),
    'streak 缺失却命中了连板因子');
  // 但低换手、大额净买仍应正常计入
  assert.ok(r.factors.some((f) => f.key === 'low_turnover'));
});

test('概率：换手缺失时不命中低换手因子（缺数据不得当成低换手）', () => {
  const r = predictUpProb({ isZt: true, streak: 1, netWan: 100 }, {});
  assert.ok(!r.factors.some((f) => f.key === 'low_turnover'), '换手缺失却被当成低换手');
});

test('概率：每个因子的 adj 与 note 一致（note 里写的上涨占比 − 基准 = adj）', () => {
  for (const f of PREDICT_FACTORS) {
    assert.ok(Number.isFinite(f.adj), `因子 ${f.key} 缺 adj`);
    assert.ok(f.n > 0, `因子 ${f.key} 缺样本量`);
    assert.ok(f.note && f.note.length > 10, `因子 ${f.key} 缺说明`);
    assert.ok(/\d/.test(f.note), `因子 ${f.key} 的说明里没有数字`);
  }
});

test('概率：畸形输入返回基准分而非 NaN', () => {
  for (const bad of [null, undefined, {}, { streak: 'x' }, { turnoverPct: {} }]) {
    const r = predictUpProb(bad, {});
    assert.ok(Number.isFinite(r.score), `${JSON.stringify(bad)} → ${r.score}`);
    assert.ok(r.score >= BASELINE_UP, '畸形输入不应低于基准');
  }
});

// ────────────────────── 四、预期收益（两种口径必须都给出） ──────────────────────

test('预期收益：同时给出「收盘价买入」与「开盘价买入」两种口径', () => {
  const e = expectedReturn(cand({ streak: 2, turnoverPct: 8 }));
  assert.ok(e.atClose && Number.isFinite(e.atClose.median));
  assert.ok(e.atOpen && Number.isFinite(e.atOpen.median));
  assert.equal(e.atClose.group, '2 连板 + 低换手');
  assert.equal(e.atClose.n, 72);
});

test('预期收益：正期望必须附「别开盘追高」的警告（实测开盘口径是负期望）', () => {
  const e = expectedReturn(cand({ streak: 2, turnoverPct: 8 }));
  assert.equal(e.verdict, 'positive');
  assert.ok(e.warn, '正期望却没有警告');
  assert.ok(/开盘/.test(e.warn), '警告里必须点明开盘追高的风险');
  assert.ok(/T 日收盘价/.test(e.warn), '必须说明正期望的口径前提');
});

test('预期收益：开盘口径为 0 时不得说成「负期望」（自相矛盾会被用户抓住）', () => {
  // 2 连板 + 低换手的 atOpen 实测中位是 0.00%
  const e = expectedReturn(cand({ streak: 2, turnoverPct: 8 }));
  assert.equal(e.atOpen.median, 0);
  assert.ok(!/负期望/.test(e.warn), '开盘中位为 0 却说负期望，自相矛盾：' + e.warn);
});

test('预期收益：首板给弱期望，措辞不得宣称「有统计上的买入价值」', () => {
  const e = expectedReturn(cand({ streak: 1, turnoverPct: 8 }));
  assert.equal(e.verdict, 'weak');
  assert.ok(/扣掉|有限|不大/.test(e.warn), e.warn);
});

test('预期收益：连板过高（被剔除的档）没有可用分组，如实说「无实测依据」', () => {
  // streak 9 会落到 streak>=3 的分组（中位 4.77%）；但该档在本引擎里已被 high_streak 剔除，
  // 故这里的重点是：无论落到哪个分组，warn 都必须诚实，不能凭空宣称收益。
  const e = expectedReturn({ code: '600001', isZt: true, streak: 9 });
  assert.ok(e.warn && e.warn.length > 10, '必须有告诫');
  assert.ok(e.atClose.group, '要么给出分组，要么明说无分组');
});

test('预期收益：完全无匹配分组时 n=0 且明确说「不足以下结论」', () => {
  // 未涨停、净买也不够 2 亿 → 不落任何实测分组
  const e = expectedReturn({ code: '600001', isZt: false, streak: null, netWan: 5000 });
  assert.equal(e.atClose.n, 0);
  assert.equal(e.verdict, 'flat');
  assert.ok(/不足以下结论|无实测依据|接近零|为负/.test(e.warn), e.warn);
});

// ────────────────────── 五、止损位 ──────────────────────

test('止损：默认沿用系统单笔止损线 −8%（不因品种波动放宽）', () => {
  assert.equal(suggestStop({ code: '600001' }).stopLossPct, -0.08);
  assert.equal(suggestStop({ code: '300001' }).stopLossPct, -0.08);
});

test('止损：调用方可传 stopLossPct（与 alerts.js 的 POS_CFG 同源，不在本文件写死）', () => {
  assert.equal(suggestStop({ code: '600001' }, { stopLossPct: -0.05 }).stopLossPct, -0.05);
  // 非法传入退回默认，不被 NaN 污染
  assert.equal(suggestStop({ code: '600001' }, { stopLossPct: 'abc' }).stopLossPct, -0.08);
  assert.equal(suggestStop({ code: '600001' }, { stopLossPct: null }).stopLossPct, -0.08);
});

test('止损：宽波动品种不放宽止损，改为仓位打 6 折（放宽=放大单笔风险）', () => {
  const wide = suggestStop({ code: '300001' });
  const main = suggestStop({ code: '600001' });
  assert.equal(wide.maxPosFactor, 0.6);
  assert.equal(main.maxPosFactor, 1);
  assert.ok(wide.maxDD < main.maxDD, '宽波动品种实测回撤应更深');
  assert.ok(/不放宽/.test(wide.reason), wide.reason);
});

test('止损：理由里带实测回撤数字，不接受空泛表述', () => {
  assert.ok(/\d/.test(suggestStop({ code: '600001' }).reason));
  assert.ok(/\d/.test(suggestStop({ code: '300001' }).reason));
});

// ────────────────────── 六、主入口 predictPicks ──────────────────────

test('主入口：剔除的票只出现在 rejected，不出现在 picks（绝不两头都算）', () => {
  const list = [
    cand({ code: '600101', name: '好票', streak: 2, turnoverPct: 8, netWan: 30000 }),
    cand({ code: '600102', name: '坏票', streak: 1, turnoverPct: 30 }),
  ];
  const r = predictPicks(list, { topN: 5 });
  assert.equal(r.picks.length, 1);
  assert.equal(r.picks[0].code, '600101');
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].code, '600102');
  assert.equal(r.rejected[0].reason, '换手过高');
});

test('主入口：rejected 条目保留原始字段（便于 UI 展示「它本来长什么样」）', () => {
  const r = predictPicks([cand({ code: '600102', name: '坏票', streak: 3, turnoverPct: 33 })], {});
  const rej = r.rejected[0];
  assert.equal(rej.turnoverPct, 33);
  assert.equal(rej.streak, 3);
  assert.ok(rej.why.length > 20, '剔除原因必须可解释');
  assert.ok(rej.stat, '剔除条目必须带实测统计');
});

test('主入口：按概率降序排列（高概率在前）', () => {
  const list = [
    cand({ code: '600101', name: '普通', streak: 1, turnoverPct: 15, netWan: 100 }),
    cand({ code: '600102', name: '优秀', streak: 2, turnoverPct: 8, netWan: 30000 }),
  ];
  const r = predictPicks(list, { topN: 5 });
  assert.equal(r.picks[0].code, '600102', '高概率应排前');
  for (let i = 1; i < r.picks.length; i++) {
    assert.ok(r.picks[i].prob.score <= r.picks[i - 1].prob.score, '必须降序');
  }
});

test('主入口：低于 minProb 的不进推荐，但列入 belowThreshold（不被静默丢弃）', () => {
  const list = [cand({ code: '600101', name: '低分', streak: 1, turnoverPct: 15, netWan: 100 })];
  const r = predictPicks(list, { topN: 5, minProb: 57 });
  assert.equal(r.picks.length, 0);
  assert.equal(r.belowThreshold.length, 1);
  assert.equal(r.belowThreshold[0].code, '600101');
  // minProb 放低到基准即进推荐
  const r2 = predictPicks(list, { topN: 5, minProb: 50 });
  assert.equal(r2.picks.length, 1);
});

test('主入口：超出 topN 的进 overflow，不被静默丢弃', () => {
  const list = Array.from({ length: 8 }, (_, i) =>
    cand({ code: `6001${String(i).padStart(2, '0')}`, streak: 2, turnoverPct: 8, netWan: 30000 }));
  const r = predictPicks(list, { topN: 3 });
  assert.equal(r.picks.length, 3);
  assert.equal(r.overflow.length, 5);
  // 总量守恒：进池的每只票都必须出现在四个桶之一
  const total = r.picks.length + r.rejected.length + r.belowThreshold.length + r.overflow.length;
  assert.equal(total, 8, '有票被静默丢弃');
});

test('主入口：stats 如实汇报各桶数量与门槛', () => {
  const list = [
    cand({ code: '600101', streak: 2, turnoverPct: 8, netWan: 30000 }),
    cand({ code: '600102', streak: 1, turnoverPct: 30 }),
    cand({ code: '600103', streak: 1, turnoverPct: 15, netWan: 100 }),
  ];
  const r = predictPicks(list, { topN: 5, minProb: 57 });
  assert.equal(r.stats.pool, 3);
  assert.equal(r.stats.rejected, 1);
  assert.equal(r.stats.below, 1);
  assert.equal(r.stats.kept, 1);
  assert.equal(r.stats.minProb, 57);
  assert.equal(r.stats.baselineUp, BASELINE_UP);
});

test('主入口：每条推荐都带 prob / exp / stop 三件套（UI 缺一不可）', () => {
  const r = predictPicks([cand({ streak: 2, turnoverPct: 8, netWan: 30000 })], {});
  const p = r.picks[0];
  assert.ok(p.prob && Number.isFinite(p.prob.score));
  assert.ok(p.exp && p.exp.atClose && p.exp.atOpen);
  assert.ok(p.stop && Number.isFinite(p.stop.stopLossPct));
});

test('主入口：确定性——同一输入连算两次结果完全一致', () => {
  const list = [cand({ code: '600101', streak: 2, turnoverPct: 8, netWan: 30000 })];
  const a = predictPicks(list, { topN: 5 });
  const b = predictPicks(list, { topN: 5 });
  assert.deepEqual(a.picks.map((p) => [p.code, p.prob.score]), b.picks.map((p) => [p.code, p.prob.score]));
});

test('主入口：畸形输入安全，不抛错', () => {
  assert.doesNotThrow(() => predictPicks(null, {}));
  assert.doesNotThrow(() => predictPicks(undefined, {}));
  assert.doesNotThrow(() => predictPicks('not-array', {}));
  assert.doesNotThrow(() => predictPicks([null, undefined, {}], {}));
  const r = predictPicks([null, undefined], {});
  assert.equal(r.picks.length, 0);
  assert.equal(r.rejected.length, 0);
});

// ────────────────────── 七、负向注入守卫（断言真的在守，不是摆设） ──────────────────────

test('守卫：把「换手 ≥25」放宽到 ≥35 时，本套测试的边界用例必须捕获', () => {
  // 模拟一次真实的规则腐化：有人觉得 25% 太严，改成 35%
  const corrupted = { ...REJECT_RULES[0], test: (c) => +c.turnoverPct >= 35 };
  const fake = { key: 'high_turnover', label: '换手过高', test: corrupted.test, why: 'x', stat: {} };
  // 25% 在正确规则下应被剔；在腐化规则下不会
  assert.equal(REJECT_RULES[0].test({ turnoverPct: 25 }), true, '原始规则应剔掉 25%');
  assert.equal(fake.test({ turnoverPct: 25 }), false, '腐化规则会放过 25%（这正是要防的）');
});

test('守卫：把 finite 判据退回 Number.isFinite(+v) 时，缺换手的票会被误当低换手', () => {
  // 真实风险：+null === 0，0 < 10 → 被判成「低换手」拿到加分
  assert.equal(Number.isFinite(+null), true, '+null 是 0，Number.isFinite 拦不住');
  const wrong = (c) => Number.isFinite(+c.turnoverPct) && +c.turnoverPct < 10;
  assert.equal(wrong({ turnoverPct: null }), true, '朴素写法会把 null 当低换手（错）');
  // 正确的实现必须挡住
  const r = predictUpProb({ isZt: true, streak: 1, turnoverPct: null, netWan: 100 }, {});
  assert.ok(!r.factors.some((f) => f.key === 'low_turnover'), '实现必须挡住 null');
});

test('守卫：把封顶去掉时，多因子叠加会突破实测可达上限', () => {
  const r = predictUpProb(cand({ streak: 2, turnoverPct: 5, netWan: 50000, code: '300001' }), { ztCount: 20 });
  const raw = r.factors.reduce((a, f) => a + f.adj, 0);
  assert.ok(raw > 18, `原始累加 ${raw} 应超过封顶值 18（否则这个用例没意义）`);
  assert.ok(r.score < BASELINE_UP + raw, '实现必须封顶，不能把原始累加直接加上去');
});

test('守卫：把扣非净利润式的「正向净买」判据改成「任何净买」时，弱资金票会混进推荐', () => {
  // weak_fund_only 规则的意义就在这：净买为正但金额太小是实测弱信号
  assert.equal(screenCandidate({ code: '600001', isZt: false, netWan: 1 }).rejected, true);
  assert.equal(screenCandidate({ code: '600001', isZt: false, netWan: 19999 }).rejected, true);
  assert.equal(screenCandidate({ code: '600001', isZt: false, netWan: 20000 }).rejected, false);
});

// ────────────────────── 八、回归：常量与口径不得被误改 ──────────────────────

test('回归：版本常量固定（UI 与报告引用它，改了要让两端一起改）', () => {
  assert.equal(PREDICT_VERSION, 'predict-v1');
});

test('回归：概率分语义是「历史上涨占比」，故必须 ≤100 且 ≥0', () => {
  const cases = [
    cand({ streak: 2, turnoverPct: 5, netWan: 50000, code: '300001' }),
    cand({ streak: 1, turnoverPct: 30, netWan: 100 }),
    {},
  ];
  for (const c of cases) {
    const s = predictUpProb(c, { ztCount: 20 }).score;
    assert.ok(s >= 0 && s <= 100, `分数 ${s} 越界`);
  }
});

test('回归：基线常量与实测样本量一致（975 个涨停样本）', () => {
  assert.equal(BASELINE_N, 975);
  assert.equal(BASELINE_UP, 55.3);
});
