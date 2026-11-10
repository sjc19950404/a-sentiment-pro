import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThemeGraph } from '../src/theme_graph.js';

const mkDay = (date, topics) => ({ trade_date: date, topics });

test('theme_graph: 共现计数与Jaccard——同日共现的题材对成边', () => {
  const days = [
    mkDay('2026-11-01', [{ tag: '机器人', count: 5 }, { tag: '商业航天', count: 3 }, { tag: '孤点', count: 1 }]),
    mkDay('2026-11-02', [{ tag: '机器人', count: 4 }, { tag: '商业航天', count: 2 }]),
    mkDay('2026-11-03', [{ tag: '机器人', count: 6 }]),
  ];
  const g = buildThemeGraph(days);
  assert.equal(g.windowDays, 3);
  const jt = g.themes.find((t) => t.tag === '机器人');
  assert.equal(jt.days, 3);
  assert.equal(jt.latest, 6);
  // 孤点只在 1 天出现且 minCount=2 → 被过滤，孤点边不留
  assert.ok(!g.themes.some((t) => t.tag === '孤点'));
  const edge = g.edges.find((e) => (e.a === '机器人' && e.b === '商业航天') || (e.a === '商业航天' && e.b === '机器人'));
  assert.ok(edge);
  assert.equal(edge.co, 2);
  assert.equal(edge.jaccard, +(2 / (3 + 2 - 2)).toFixed(3)); // 2/3
});

test('theme_graph: topN 截断——每日只取前 N 个题材进图谱', () => {
  const topics = Array.from({ length: 10 }, (_, i) => ({ tag: 'T' + i, count: 10 - i }));
  const g = buildThemeGraph([mkDay('2026-11-01', topics)], { topN: 5, minCount: 1 });
  assert.equal(g.themes.length, 5);
  assert.ok(g.themes.every((t) => t.tag < 'T5'));
});

test('theme_graph: 无 topics 数据 → null（调用方不落空档）', () => {
  assert.equal(buildThemeGraph([{ trade_date: '2026-11-01' }]), null);
  assert.equal(buildThemeGraph([]), null);
});
