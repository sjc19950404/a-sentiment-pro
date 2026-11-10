#!/usr/bin/env node
/**
 * 首板晋级观察档（2026-11-11 用户拍板 A+B1：推送观察段 + 观察档，不接闸）。
 * 每日 EOD：
 *   1) advanceStats 全档基率（ztpool_history）；
 *   2) 今日首板筛晋级候选（早板+封单≥3%+零炸板，cap 3）；
 *   3) 昨日候选对账回填 advanced；
 *   4) 落 data/first_board_watch.json（按日期数组，同日幂等覆盖）。
 * 观察档只记账：不生成委托、不推送买入、决策链不读取本档（B2 接闸须拍板）。
 * fail-open：失败不阻断主链。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { advanceStats, pickAdvanceCandidates } from '../src/first_board.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/first_board_watch.json');

try {
  const zt = JSON.parse(readFileSync(join(ROOT, 'data/ztpool_history.json'), 'utf8'));
  const days = (Array.isArray(zt) ? zt : []).filter((d) => d && Array.isArray(d.pool));
  if (!days.length) { console.error('[first-board] 涨停池档为空——不落档'); process.exit(2); }
  const last = days[days.length - 1];
  const stats = advanceStats(days);
  const candidates = pickAdvanceCandidates(last.pool, stats);
  // 昨日候选对账（前一记录的 candidates → 今日池）
  const hist = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
  const list = Array.isArray(hist) ? hist : [];
  const prev = list.length ? list[list.length - 1] : null;
  if (prev && prev.date !== last.date && Array.isArray(prev.candidates) && prev.candidates.length && !prev.settled) {
    prev.settled = { date: last.date, results: settle(prev.candidates, last.pool) };
  }
  function settle(cands, pool) {
    const map = new Map(pool.map((p) => [p.c, p]));
    return cands.map((c) => {
      const n = map.get(String(c.code));
      return { code: String(c.code), name: c.name || c.code, advanced: !!(n && n.lbc >= 2) };
    });
  }
  const rec = {
    date: last.date,
    generatedAt: new Date().toISOString(),
    stats: { total: stats.total, byFbt: stats.byFbt, byFund: stats.byFund, windowDays: stats.windowDays },
    candidates,
    note: '观察档：基率非预测，只记账不下单；接闸须拍板（2026-11-11）',
  };
  const idx = list.findIndex((d) => d.date === rec.date);
  if (idx >= 0) list[idx] = rec; else list.push(rec);
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeFileSync(OUT, JSON.stringify(list, null, 1) + '\n');
  const hit = prev && prev.settled ? `${prev.settled.results.filter((r) => r.advanced).length}/${prev.settled.results.length}` : '—';
  console.log(`[first-board] ${rec.date} 基率 ${stats.total ? stats.total.rate + '%（' + stats.total.n + '样本/' + stats.windowDays + '日）' : '无'} | 今日候选 ${candidates.length} 只 | 昨日候选对账 ${hit}`);
} catch (e) {
  console.error('[first-board] 异常（fail-open）:', e && e.message);
  process.exit(1);
}
