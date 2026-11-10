#!/usr/bin/env node
/**
 * 题材共现图谱 sidecar（2026-11-10，六方向 #3）。
 * 读 archive.json 逐日 topics → src/theme_graph.js → 落独立档 data/theme_graph.json。
 * EOD 挂载 fail-open；主线结论不在本模块判定（唯一出处 main_theme_history）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { buildThemeGraph } from '../src/theme_graph.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/theme_graph.json');

try {
  const arc = JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8'));
  const g = buildThemeGraph(arc.all_days || arc.days || []);
  if (!g) { console.error('[theme-graph] 无 topics 数据——不落档'); process.exit(2); }
  writeFileSync(OUT, JSON.stringify(g, null, 1) + '\n');
  const topEdges = g.edges.slice(0, 5).map((e) => `${e.a}↔${e.b}(${e.jaccard})`).join(' | ');
  console.log(`[theme-graph] 窗口 ${g.windowDays} 天 | 活跃题材 ${g.themes.length} | 边 ${g.edges.length}\n  top边: ${topEdges}`);
} catch (e) {
  console.error('[theme-graph] 异常（fail-open，不影响主链）:', e && e.message);
  process.exit(1);
}
