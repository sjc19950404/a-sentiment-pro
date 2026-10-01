// 公式版本注册表的口径守卫：三版必须共用同一套因子实现，差异只在净买原料。
//
// 本文件锁的是**结构性契约**，不是数值快照——数值会随数据更新而变，
// 但"三版因子键一致 / 权重键映射与 config 一致 / v4.5 含新股而 v5.2 剔除"这些不变量永远成立。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import config from '../src/config.js';
import { decodeArchive } from '../src/lhb_codec.js';
import {
  BASELINE_VERSION, FORMULA_VERSIONS, WEIGHT_TO_FACTOR,
  versionKeys, versionOf, recomputeDay, computableDays, computeAllVersions,
  netBuyV45, netBuyV50, netBuyV52, nextRetOf, COMPUTE_TIERS,
} from '../src/formula_versions.js';
import { pearson, spearman, ranks, directionAccuracy } from './_helpers_regression.mjs';
import { caliberFromDay } from '../src/lhb.js';

// ────────────────────────── 一、版本表结构 ──────────────────────────

test('公式版本：基线版本与 config.formulaVersion 一致', () => {
  assert.equal(config.formulaVersion, BASELINE_VERSION,
    'config.formulaVersion 与 formula_versions 的基线不一致 —— 改版本号必须两处同步');
});

test('公式版本：恰好三版，且只有一个是基线', () => {
  assert.deepEqual(versionKeys(), ['v4.5', 'v5.0', 'v5.2-pro']);
  assert.equal(FORMULA_VERSIONS.filter((v) => v.baseline).length, 1);
  assert.equal(versionOf(BASELINE_VERSION).baseline, true);
});

test('公式版本：每版都有 extractNetBuy 与描述', () => {
  for (const v of FORMULA_VERSIONS) {
    assert.equal(typeof v.extractNetBuy, 'function', `${v.key} 缺 extractNetBuy`);
    assert.ok(v.desc && v.desc.length > 8, `${v.key} 缺描述`);
    assert.ok(v.name === v.key || v.name.startsWith('v'), `${v.key} 名称异常`);
  }
});

test('公式版本：未知版本抛错，不静默返回默认', () => {
  assert.throws(() => recomputeDay({ trade_date: '2026-01-01', summary: {} }, 'v9.9'), /未知公式版本/);
  assert.equal(versionOf('v9.9'), null);
});

test('公式版本：权重键映射与 config.factorKeyMap 完全一致（两份不得漂移）', () => {
  assert.deepEqual(WEIGHT_TO_FACTOR, config.factorKeyMap,
    'formula_versions.WEIGHT_TO_FACTOR 与 config.factorKeyMap 不一致');
});

// ────────────────────────── 二、三版口径差异（核心不变量）──────────────────────────
//
// 用一个**构造的**某日数据把三版差异钉死：全量净买 ≠ 当日净买 ≠ 剔新股净买。
// 不依赖真实档案，因此数据更新也不会让这些断言失效。
//
// ⚠ 关键约束：caliberFromDay 是「从原始记录现算」的实现（这是它的设计目的——唯一口径来源），
//   它**只读记录数组，不读 summary 里已算好的汇总字段**。所以夹具必须给真实的记录数组，
//   光填 summary.lhb_daily_net 是不行的（实测踩过：caliberFromDay 走 `rows.length===0` 分支
//   直接返回全 0，三版分数一模一样、断言全红）。
//
// 构造（单位：万元，1 亿 = 1e4 万）：
//   当日榜 3 只：A +8 亿 / B +5 亿 / C −1 亿        → 当日净买 = 12 亿
//   区间累计榜 2 只：D +10 亿 / E +8 亿             → 全量净买 = 12 + 18 = 30 亿
//   其中 A 是「无价格涨跌幅限制的证券」（新股）      → 剔新股后 = 12 − 8 = 4 亿
const W = 1e4; // 1 亿元 = 10000 万元
const rec = (code, netYi, range, reasons) => ({
  code,
  name: code,
  reason: reasons ? reasons[0] : '日涨幅偏离值达7%的证券',
  reasons: reasons || ['日涨幅偏离值达7%的证券'],
  net_buy_wan: netYi * W,
  buy_wan: Math.abs(netYi) * W * 0.6,
  sell_wan: Math.abs(netYi) * W * 0.4,
  close: 10,
  change_pct: 10,
  is_range: !!range,
});

const SYNTH_DAY = {
  trade_date: '2099-01-05',
  summary: {
    // s_pos / s_brd / s_hot / s_zdt / s_zbl / s_amt 的原料（这些不参与版本差异，只求可算）
    net_pos: 22, net_neg: 18,
    ind_up: 45, ind_count: 90,
    amount_yi: 21000,
    up_count: 2600, down_count: 2200,
    zt_count: 50, dt_count: 10, zb_count: 12,
  },
  // 当日榜去重行（新数据都有这个字段，走 caliberFromDay 的①号分支）
  lhb_daily_aggr: [
    rec('000001', 8, false, ['无价格涨跌幅限制的证券']),  // 新股，A
    rec('000002', 5, false),                              // B
    rec('000003', -1, false),                             // C
  ],
  lhb_aggr: [
    rec('000001', 8, false, ['无价格涨跌幅限制的证券']),
    rec('000002', 5, false),
    rec('000003', -1, false),
    rec('600001', 10, true),  // 区间累计榜，D
    rec('600002', 8, true),   // 区间累计榜，E
  ],
};

test('夹具自检：当日榜净买 12 亿 / 全量 30 亿 / 剔新股 4 亿', () => {
  const c = caliberFromDay(SYNTH_DAY);
  assert.equal(c.daily_net_yi, 12, '当日榜净买应为 12 亿');
  assert.equal(c.all_net_yi, 30, '全量净买应为 30 亿（12 + 18 区间）');
  assert.equal(c.daily_new_net_yi, 8, '新股净买应为 8 亿（A 票）');
  assert.equal(c.daily_ex_new_net_yi, 4, '剔新股后应为 4 亿（12 − 8）');
});

test('口径：v4.5 用全量净买（含区间榜、含新股）', () => {
  const r = netBuyV45(SYNTH_DAY);
  assert.equal(r.netBuy, 30.0);
  assert.equal(r.newStockNet, 0, 'v4.5 不剔新股');
});

test('口径：v5.0 用当日榜净买（滤区间榜），但仍含新股', () => {
  const r = netBuyV50(SYNTH_DAY);
  assert.equal(r.netBuy, 12.0);
  assert.equal(r.newStockNet, 0, 'v5.0 仍不剔新股');
});

test('口径：v5.2 用当日榜净买且剔除新股', () => {
  const r = netBuyV52(SYNTH_DAY);
  assert.equal(r.netBuy, 12.0);
  assert.equal(r.newStockNet, 8.0, 'v5.2 必须把新股净买交给 computeSentiment 扣除');
});

test('口径：三版净买单调收敛（全量 ≥ 当日 ≥ 剔新股）', () => {
  const n45 = netBuyV45(SYNTH_DAY).netBuy;
  const n50 = netBuyV50(SYNTH_DAY).netBuy;
  const n52 = netBuyV52(SYNTH_DAY).netBuy - netBuyV52(SYNTH_DAY).newStockNet;
  assert.ok(n45 > n50, `全量(${n45}) 应大于当日(${n50})——区间累计值会放大`);
  assert.ok(n50 > n52, `含新股(${n50}) 应大于剔新股(${n52})——新股只能抬高净买`);
});

test('口径：三版分数严格递减（净买越小，s_net 越低）', () => {
  const s45 = recomputeDay(SYNTH_DAY, 'v4.5', { weights: config.weights }).score;
  const s50 = recomputeDay(SYNTH_DAY, 'v5.0', { weights: config.weights }).score;
  const s52 = recomputeDay(SYNTH_DAY, BASELINE_VERSION, { weights: config.weights }).score;
  assert.ok(s45 > s50, `v4.5(${s45}) 应高于 v5.0(${s50})`);
  assert.ok(s50 > s52, `v5.0(${s50}) 应高于 v5.2(${s52})`);
});

test('口径：三版只在 s_net 上有差异，其余六因子逐字段相同', () => {
  const w = config.weights;
  const a = recomputeDay(SYNTH_DAY, 'v4.5', { weights: w }).factors;
  const b = recomputeDay(SYNTH_DAY, 'v5.0', { weights: w }).factors;
  const c = recomputeDay(SYNTH_DAY, BASELINE_VERSION, { weights: w }).factors;
  for (const k of Object.keys(a)) {
    if (k === 's_net') {
      assert.ok(a[k] >= b[k] && b[k] >= c[k], `s_net 应单调：${a[k]} / ${b[k]} / ${c[k]}`);
    } else {
      assert.equal(a[k], b[k], `${k} 在 v4.5 与 v5.0 之间不得有差异`);
      assert.equal(b[k], c[k], `${k} 在 v5.0 与 v5.2 之间不得有差异`);
    }
  }
  assert.deepEqual(Object.keys(a), Object.keys(c), '三版因子键集合必须完全一致');
});

test('口径：因子键为无后缀形式（与存档一致），不是 computeSentiment 的权重键', () => {
  const f = recomputeDay(SYNTH_DAY, BASELINE_VERSION, { weights: config.weights }).factors;
  assert.deepEqual(Object.keys(f).sort(),
    ['s_amt', 's_brd', 's_hot', 's_net', 's_pos', 's_zbl', 's_zdt']);
  assert.equal(f.s_net20, undefined, '不得漏出带档位后缀的权重键');
});

test('口径：权重键传错必须硬失败（不得静默 NaN）', () => {
  const plain = {};
  for (const [wk, pk] of Object.entries(config.factorKeyMap)) plain[pk] = config.weights[wk];
  assert.throws(
    () => recomputeDay(SYNTH_DAY, BASELINE_VERSION, { weights: plain }),
    /非有限分数/,
    '传无后缀权重键必须抛错——NaN 静默传播过（相关性/均分全变 NaN）',
  );
});

test('口径：newStockRatio 只在有 ratio 证据时传入（v4.5/v5.0 不虚构 ratio）', () => {
  const r52 = netBuyV52(SYNTH_DAY);
  assert.equal(r52.newStockNet, 8.0, '新股记录存在即应剔除');
  assert.ok(r52.evidence.newRatio != null, 'v5.2 应带出 ratio 证据');
  const r45 = netBuyV45(SYNTH_DAY);
  assert.equal(r45.newStockNet, 0);
  assert.equal(r45.evidence.newRatio, undefined, 'v4.5 不应虚构 ratio');
});

// ────────────────────────── 三、可算性分级 ──────────────────────────

test('分级：缺 industry/amount/indexes → partial，不进主样本', () => {
  const partialDay = { trade_date: '2026-01-05', summary: { lhb_daily_net: 1.0 }, lhb_aggr: [{ code: 'x', net_buy_wan: 1 }] };
  const { ok, partial } = computableDays([partialDay]);
  assert.equal(ok.length, 0);
  assert.equal(partial.length, 1);
});

test('分级：连龙虎榜原料都没有 → none', () => {
  const emptyDay = { trade_date: '2026-01-05', summary: {} };
  const { ok, partial, none } = computableDays([emptyDay]);
  assert.equal(ok.length, 0);
  assert.equal(partial.length, 0);
  assert.equal(none.length, 1);
});

test('分级：齐全天 → full', () => {
  const fullDay = {
    trade_date: '2026-01-05',
    summary: { lhb_daily_net: 1.0, lhb_all_net: 1.2, ind_up: 40, ind_count: 90, amount_yi: 20000 },
    indexes: { 上证指数: 0.5 },
    lhb_aggr: [{ code: 'x', net_buy_wan: 1 }],
  };
  const { ok, meta } = computableDays([fullDay]);
  assert.equal(ok.length, 1);
  assert.equal(meta[0].tier, COMPUTE_TIERS.full);
});

test('分级：up_count 缺失不判为不可算（s_pos 走代理是既有设计），但如实标注 hasBreadth=false', () => {
  const d = {
    trade_date: '2026-01-05',
    summary: { lhb_daily_net: 1.0, lhb_all_net: 1.2, ind_up: 40, ind_count: 90, amount_yi: 20000, net_pos: 5, net_neg: 5 },
    indexes: { 上证指数: 0.5 },
    lhb_aggr: [{ code: 'x', net_buy_wan: 1 }],
  };
  const { ok, meta } = computableDays([d]);
  assert.equal(ok.length, 1, '有无 up_count 都应可算');
  assert.equal(meta[0].hasBreadth, false);
});

// ────────────────────────── 四、次日收益对齐（长假陷阱）──────────────────────────

test('次日收益：必须按真实交易日相邻取，长假后不得按数组相邻', () => {
  const days = [
    { trade_date: '2026-09-24', indexes: { 上证指数: -1.0 } },
    { trade_date: '2026-09-28', indexes: { 上证指数: 0.5 } },  // 09-25~09-27 中秋休市
  ];
  const nx = nextRetOf(days[0], days);
  assert.equal(nx.date, '2026-09-28');
  assert.equal(nx.ret, 0.5);
  assert.equal(nx.gap, 4, '应记录跳空 4 天，供报告披露');
});

test('次日收益：跳过没有 indexes 的天', () => {
  const days = [
    { trade_date: '2026-01-05', indexes: { 上证指数: 1 } },
    { trade_date: '2026-01-06' },                                  // 无 indexes
    { trade_date: '2026-01-07', indexes: { 上证指数: 2 } },
  ];
  const nx = nextRetOf(days[0], days);
  assert.equal(nx.date, '2026-01-07', '应跳过无 indexes 的天，取下一个有值日');
  assert.equal(nx.ret, 2);
});

test('次日收益：最后一天返回 null，不越界不回绕', () => {
  const days = [{ trade_date: '2026-01-05', indexes: { 上证指数: 1 } }];
  assert.equal(nextRetOf(days[0], days), null);
});

// ────────────────────────── 五、统计工具正确性 ──────────────────────────

test('统计：pearson 对完全线性关系返回 1 / -1', () => {
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9);
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-9);
});

test('统计：pearson 常数序列返回 null（不返回 NaN）', () => {
  assert.equal(pearson([1, 1, 1, 1], [1, 2, 3, 4]), null);
  assert.equal(pearson([1, 1, 1, 1], [2, 2, 2, 2]), null);
});

test('统计：pearson 样本不足返回 null', () => {
  assert.equal(pearson([1, 2], [1, 2]), null);
});

test('统计：ranks 对并列取平均秩', () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test('统计：spearman 对单调非线性关系仍为 1', () => {
  // y = x^3 单调但非线性 —— pearson 明显小于 1，spearman 应为 1
  const x = [1, 2, 3, 4, 5, 6];
  const y = x.map((v) => v ** 3);
  assert.ok(spearman(x, y) > 0.999);
  assert.ok(pearson(x, y) < 0.95, 'pearson 应被非线性压低，说明两个指标确实不同');
});

test('统计：directionAccuracy 按中位数分档，并列中位数不参与', () => {
  // 中位数=3；scores[1] 与中位数并列 → 排除，总数应为 3
  const r = directionAccuracy([1, 3, 3, 4, 5], [1, 2, -1, 1, -2]);
  assert.equal(r.total, 3, '并列中位数的那天应被排除');
});

test('统计：directionAccuracy 全对时为 1', () => {
  const r = directionAccuracy([10, 20, 30, 40], [-1, -2, 1, 2]);
  assert.equal(r.acc, 1);
});

// ────────────────────────── 六、端到端（依赖真实档案，缺则跳过）──────────────────────────

const ARCHIVE = 'data/archive.json';
const REGRESSION = 'data/version-regression.json';
const haveArchive = existsSync(ARCHIVE);
const haveRegression = existsSync(REGRESSION);

test('端到端：真实档案三版重算不产生 NaN，且 v5.2 与档案现存分数一致',
  { skip: !haveArchive && '缺 data/archive.json' }, () => {
    
    const arch = decodeArchive(JSON.parse(readFileSync(ARCHIVE, 'utf8')));
    const days = (arch.all_days || []).filter((d) => d && d.trade_date);
    const { ok } = computableDays(days);
    assert.ok(ok.length > 0, '应至少有一天可算');
    const res = computeAllVersions(ok, versionKeys(), config.weights);
    for (const k of versionKeys()) {
      for (const r of res[k]) {
        assert.ok(Number.isFinite(r.score), `${k} ${r.trade_date} 分数非有限`);
        assert.ok(r.score >= 0 && r.score <= 100, `${k} ${r.trade_date} 分数越界 ${r.score}`);
      }
    }
    // 基线必须能复现档案里现存的口径：逐日比对 score（允许 0.1 的四舍五入差）
    let compared = 0;
    for (let i = 0; i < ok.length; i++) {
      const archived = ok[i].emotion?.value;
      if (archived == null) continue;
      assert.ok(Math.abs(res[BASELINE_VERSION][i].score - archived) <= 0.15,
        `${ok[i].trade_date} 基线重算 ${res[BASELINE_VERSION][i].score} 与档案 ${archived} 不一致`);
      compared++;
    }
    assert.ok(compared > 0, '应至少有一天可与档案比对');
  });

test('端到端：v4.5 的 s_net 饱和天数严格多于 v5.2（这正是 v5.0 存在的理由）',
  { skip: !haveArchive && '缺 data/archive.json' }, () => {
    
    const arch = decodeArchive(JSON.parse(readFileSync(ARCHIVE, 'utf8')));
    const days = (arch.all_days || []).filter((d) => d && d.trade_date);
    const { ok } = computableDays(days);
    const res = computeAllVersions(ok, versionKeys(), config.weights);
    const sat = (k) => res[k].filter((r) => r.factors.s_net >= 99.5).length;
    assert.ok(sat('v4.5') >= sat(BASELINE_VERSION),
      `v4.5 饱和 ${sat('v4.5')} 天 应 ≥ v5.2 饱和 ${sat(BASELINE_VERSION)} 天`
      + `——若反了说明口径实现有问题（区间累计值不可能让因子更不饱和）`);
  });

test('端到端：回归产物结构完整、统计量在合法区间', { skip: !haveRegression && '缺 data/version-regression.json' }, () => {
  const r = JSON.parse(readFileSync(REGRESSION, 'utf8'));
  assert.equal(r.kind, 'version-regression');
  assert.equal(r.baseline, BASELINE_VERSION);
  assert.ok(Array.isArray(r.cautions) && r.cautions.length >= 2, '必须带样本量/代理披露');
  assert.deepEqual(r.versions.map((v) => v.key), versionKeys());
  assert.equal(r.daily.length, r.sample.mainDays);
  for (const k of versionKeys()) {
    const s = r.stats[k];
    assert.ok(s, `缺 ${k} 统计`);
    assert.ok(s.n >= 5, `${k} 有效样本不足`);
    if (s.pearson != null) assert.ok(Math.abs(s.pearson) <= 1, `${k} pearson 越界`);
    if (s.spearman != null) assert.ok(Math.abs(s.spearman) <= 1, `${k} spearman 越界`);
    if (s.direction) assert.ok(s.direction.acc >= 0 && s.direction.acc <= 1, `${k} 准确率越界`);
  }
  // 每条 daily 必须带三版分数与次日收益
  for (const row of r.daily) {
    for (const k of versionKeys()) assert.ok(Number.isFinite(row.scores[k]), `${row.trade_date} 缺 ${k} 分数`);
  }
});

test('端到端：回归产物必须披露样本量不足（不得让人误读为版本优劣结论）',
  { skip: !haveRegression && '缺 data/version-regression.json' }, () => {
    const r = JSON.parse(readFileSync(REGRESSION, 'utf8'));
    const joined = r.cautions.join(' ');
    assert.ok(/样本|自由度/.test(joined), '必须披露样本量限制');
    assert.ok(/不足|极低|不.*判定/.test(joined), '必须明确说明不足以判定优劣');
  });
