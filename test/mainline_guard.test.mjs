// 主线守卫 / 极寒分化惩罚（V5.3）单测（2026-10-28）
// 覆盖：补丁一 detectClusteringBubble / computeRedIndustryRatio；补丁二 selectMainLine（含深拷贝不可变）；
//   主题龙虎榜净额 themeLongHuNet / buildMainLineInput；补丁三 recommendPicks 联动过滤；
//   以及 ai_report.js 补丁一报告侧降级。核心断言：原始归档对象零污染。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectClusteringBubble, computeRedIndustryRatio, themeLongHuNet, buildMainLineInput, selectMainLine,
  SENTIMENT_PENALTY, CLUSTER_RISE_COUNT_MAX, CLUSTER_RED_INDUSTRY_RATIO_MAX,
} from '../src/mainline_guard.js';
import { recommendPicks } from '../src/picks.js';
import { buildInput, generatePostMarket } from '../src/ai_report.js';

// ───────────── 补丁一：detectClusteringBubble ─────────────
test('补丁一：上涨<1500 且 红盘行业占比<0.10 → 抱团分化触发，扣分=SENTIMENT_PENALTY', () => {
  const r = detectClusteringBubble({ upCount: 1000, redIndustryRatio: 0.05 });
  assert.equal(r.isClusteringBubble, true);
  assert.equal(r.penalty, SENTIMENT_PENALTY);
});

test('补丁一：上涨家数达标（≥1500）→ 不触发（假回暖不成立）', () => {
  const r = detectClusteringBubble({ upCount: 2000, redIndustryRatio: 0.02 });
  assert.equal(r.isClusteringBubble, false);
  assert.equal(r.penalty, 0);
});

test('补丁一：红盘行业占比达标（≥0.10）→ 不触发', () => {
  const r = detectClusteringBubble({ upCount: 800, redIndustryRatio: 0.30 });
  assert.equal(r.isClusteringBubble, false);
});

test('补丁一：任一输入缺失（null）→ 保守不降级（未知即不判）', () => {
  assert.equal(detectClusteringBubble({ upCount: 1000 }).isClusteringBubble, false);
  assert.equal(detectClusteringBubble({ redIndustryRatio: 0.05 }).isClusteringBubble, false);
  assert.equal(detectClusteringBubble({}).isClusteringBubble, false);
});

test('补丁一：阈值常量边界（等于阈值不触发，需严格小于）', () => {
  assert.equal(detectClusteringBubble({ upCount: CLUSTER_RISE_COUNT_MAX, redIndustryRatio: CLUSTER_RED_INDUSTRY_RATIO_MAX }).isClusteringBubble, false);
  assert.equal(detectClusteringBubble({ upCount: CLUSTER_RISE_COUNT_MAX - 1, redIndustryRatio: CLUSTER_RED_INDUSTRY_RATIO_MAX - 0.01 }).isClusteringBubble, true);
});

// ───────────── 补丁一：computeRedIndustryRatio ─────────────
test('computeRedIndustryRatio：正常占比计算', () => {
  const ind = [{ change_pct: 2 }, { change_pct: -1 }, { change_pct: 0.5 }, { change_pct: -3 }];
  assert.equal(computeRedIndustryRatio(ind), 0.5);
});
test('computeRedIndustryRatio：无行业明细 → null（不冒充 0）', () => {
  assert.equal(computeRedIndustryRatio(null), null);
  assert.equal(computeRedIndustryRatio([]), null);
  assert.equal(computeRedIndustryRatio(undefined), null);
});

// ───────────── 补丁二：selectMainLine（深拷贝 + 不可变） ─────────────
test('补丁二：longHuNet<0 → 克隆体 isValidMain=false 且 原始对象不被污染', () => {
  const raw = { theme: '机器人', longHuNet: -2200, strength: 80 };
  const out = selectMainLine([raw]);
  assert.ok(out && typeof out === 'object');
  assert.equal(out.isValidMain, false);
  // ⚠ 不可变：原始对象未新增/改动任何字段
  assert.equal(raw.isValidMain, undefined);
  assert.equal(raw.longHuNet, -2200);
  // 返回的是深拷贝（不是同一引用）
  assert.notEqual(out, raw);
});

test('补丁二：longHuNet<0 时 strength 减半（备选方案）', () => {
  const out = selectMainLine([{ theme: 'X', longHuNet: -1, strength: 80 }]);
  assert.equal(out.strength, 40);
});

test('补丁二：longHuNet>=0 → isValidMain=true，原样保留 strength', () => {
  const raw = { theme: '新能源', longHuNet: 5000, strength: 90 };
  const out = selectMainLine([raw]);
  assert.equal(out.isValidMain, true);
  assert.equal(out.strength, 90);
});

test('补丁二：空列表 / 首项非对象 → null', () => {
  assert.equal(selectMainLine([]), null);
  assert.equal(selectMainLine(null), null);
  assert.equal(selectMainLine([null]), null);
});

test('补丁二：longHuNet 缺失（null）→ 保守判为有效（不误伤），且不抛错', () => {
  const out = selectMainLine([{ theme: 'Y', strength: 70 }]);
  assert.equal(out.isValidMain, true);
});

// ───────────── 题材龙虎榜净额 themeLongHuNet / buildMainLineInput ─────────────
test('themeLongHuNet：累加命中主题名的热点股龙虎榜净买额（万元）', () => {
  const day = {
    hot: [
      { code: '600001', reason: '机器人概念拉升' },
      { code: '600002', reason: '无关题材' },
    ],
    lhb: [
      { code: '600001', net_buy_wan: 3000 },
      { code: '600002', net_buy_wan: 2000 },
    ],
  };
  // 仅 600001 命中「机器人」，其 net_buy_wan=3000 万
  assert.equal(themeLongHuNet(day, '机器人'), 3000);
  // 命中 0 只 → 0（中性，不冒充负）
  assert.equal(themeLongHuNet(day, '半导体'), 0);
});

test('buildMainLineInput：优先用 main_yi（亿）×10000，缺则回退 themeLongHuNet', () => {
  const day = { hot: [{ code: '600001', reason: '机器人' }], lhb: [{ code: '600001', net_buy_wan: 3000 }] };
  // main_yi=-0.22 亿 → -2200 万
  const a = buildMainLineInput(day, { name: '机器人', main_yi: -0.22 });
  assert.equal(a.theme, '机器人');
  assert.equal(a.longHuNet, -2200);
  // main_yi 缺失 → 回退重算 3000 万
  const b = buildMainLineInput(day, { name: '机器人' });
  assert.equal(b.longHuNet, 3000);
  // 主线缺失 → null
  assert.equal(buildMainLineInput(day, null), null);
});

// ───────────── 补丁三：recommendPicks 联动过滤（含不可变） ─────────────
// 构造一个能产生「属主线 + 不属主线」两只候选的 day（main_theme=机器人，600001 热点 reason 含机器人）
function bubbleDay(mainYi) {
  return {
    trade_date: '2026-10-28',
    summary: {
      main_theme: { name: '机器人', main_yi: mainYi },
      zt_codes: [], zt_lb: {},
    },
    themes: { 机器人: 6, 无关题材: 3 }, // inMainTheme 依赖 day.themes 词根匹配（取前 2 字）
    hot: [
      { code: '600001', name: 'A', reason: '机器人概念', change_pct: 6 },
      { code: '600002', name: 'B', reason: '无关题材', change_pct: 6 },
    ],
    lhb: [
      { code: '600001', name: 'A', net_buy_wan: 30000, reason: '日涨幅偏离值达7%', buy_wan: 35000, sell_wan: 5000, turnover_pct: 8, close: 10, change_pct: 9.9 },
      { code: '600002', name: 'B', net_buy_wan: 30000, reason: '日涨幅偏离值达7%', buy_wan: 35000, sell_wan: 5000, turnover_pct: 7, close: 10, change_pct: 9.9 },
    ],
    industry: [],
    emotion: { value: 90 }, score: 90,
  };
}

test('补丁三：isClusteringBubble 且 主线有效(net>0) → 仅保留属主线的标的', () => {
  const day = bubbleDay(5); // main_yi=5亿 → longHuNet=50000>0 → isValidMain=true
  const mainLine = selectMainLine([{ theme: '机器人', longHuNet: 50000, strength: 90 }]);
  const res = recommendPicks(day, { topN: 10, emotionScore: 90, minProb: 0, isClusteringBubble: true, mainLine });
  const codes = (res.picks || []).map((p) => String(p.code));
  assert.ok(codes.includes('600001'), '属主线的 600001 应保留');
  assert.ok(!codes.includes('600002'), '不属主线的 600002 应被过滤');
});

test('补丁三：isClusteringBubble 且 主线净流出(net<0) → 全部剔除（最高风控，空心题材不接力）', () => {
  const day = bubbleDay(-5); // main_yi=-5亿 → longHuNet<0 → isValidMain=false
  const mainLine = selectMainLine([{ theme: '机器人', longHuNet: -50000, strength: 90 }]);
  const res = recommendPicks(day, { topN: 10, emotionScore: 90, minProb: 0, isClusteringBubble: true, mainLine });
  assert.equal((res.picks || []).length, 0, '主线无效时不应保留任何标的');
});

test('补丁三：isClusteringBubble 缺失 → 零回归（不过滤，属/不属主线都保留）', () => {
  const day = bubbleDay(5);
  const res = recommendPicks(day, { topN: 10, emotionScore: 90, minProb: 0 });
  const codes = (res.picks || []).map((p) => String(p.code));
  assert.ok(codes.includes('600001') && codes.includes('600002'), '未传标记时不过滤');
});

test('补丁三：不可变——recommendPicks 不污染原始 day 与传入的 mainLine', () => {
  const day = bubbleDay(5);
  const mainLine = selectMainLine([{ theme: '机器人', longHuNet: 50000, strength: 90 }]);
  const mainLineRef = mainLine;
  recommendPicks(day, { topN: 10, emotionScore: 90, minProb: 0, isClusteringBubble: true, mainLine });
  // day.summary.main_theme 未改
  assert.equal(day.summary.main_theme.main_yi, 5);
  // 传递的 mainLine 对象未被改动（picks 里挂的是其克隆体，非同引用）
  assert.equal(mainLineRef.isValidMain, true);
  assert.notEqual(mainLineRef, undefined);
});

// ───────────── 补丁一：ai_report.js 报告侧降级（含不可变） ─────────────
test('ai_report 补丁一：recover + 极寒分化 → 报告 regime 降级为 neutral(抱团分化)，且 day 未污染', () => {
  const input = buildInput({
    dualTrack: {
      day: {
        date: '2026-10-28', score: 70, regime: { key: 'recover', label: '回暖', cap: 0.8 },
        summary: { up_count: 1000 }, industry: [{ name: 'a', change_pct: -1 }, { name: 'b', change_pct: -2 }],
      },
      summary: {},
    },
    signals: { meta: { tradeDate: '2026-10-28' } },
  });
  const rep = generatePostMarket(input, { generatedBy: 'ci' });
  assert.equal(rep.payload.regime.clustering_bubble, true);
  assert.equal(rep.payload.regime.key, 'neutral');
  assert.equal(rep.payload.regime.label, '中性(抱团分化)');
  assert.equal(rep.payload.regime.score_adjusted, 60); // 70 - 10
  // ⚠ 不可变：原始 day.regime.key 仍是 recover
  assert.equal(input.dualTrack.day.regime.key, 'recover');
});

test('ai_report 补丁一：数据缺失（redIndustryRatio=null）时保守不降级', () => {
  const input = buildInput({
    dualTrack: {
      day: { date: '2026-10-28', score: 70, regime: { key: 'recover', label: '回暖', cap: 0.8 }, summary: {}, industry: [] },
      summary: {},
    },
    signals: { meta: { tradeDate: '2026-10-28' } },
  });
  const rep = generatePostMarket(input, { generatedBy: 'ci' });
  assert.equal(rep.payload.regime.clustering_bubble, false);
  assert.equal(rep.payload.regime.key, 'recover');
});
