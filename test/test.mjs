import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSentiment } from '../src/sentiment.js';
import { validateArchive } from '../src/validate.js';
import { ThemeDenoiser, computeMomentum } from '../src/themes.js';

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
