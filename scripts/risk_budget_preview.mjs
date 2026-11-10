#!/usr/bin/env node
/**
 * 风险预算只读预演 sidecar（2026-11-10，六方向 #5）。
 * 输入：data/paper/account.json 最近决策信号 + config.paper.budgetSlots（默认主线选股 100%）。
 * 输出：data/risk_budget_preview.json——**仅供人工对照，任何决策链不读取此档**。
 * 预演期 ≥N 天且预算表经拍板后，才将 allocateBudget 接进 riskGuard（单一闸口）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { allocateBudget, BUDGET_GATES } from '../src/risk_budget.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function bjDate() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }

try {
  const acc = JSON.parse(readFileSync(join(ROOT, 'data/paper/account.json'), 'utf8'));
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
  const slots = (cfg.paper && cfg.paper.budgetSlots) || [{ id: 'mainline', pct: 1.0, priority: 10 }];
  // 今日信号：取最近一次批量委托决策的 buys（未成交口径）——预演层只对照不做事实
  const today = bjDate();
  const signals = [];
  for (const o of (acc.orders || []).slice(-20)) {
    const d = String(o.ts || o.date || '').slice(0, 10);
    if (d !== today || o.side !== 'buy' || (o.status && o.status !== 'pending')) continue;
    signals.push({ slotId: 'mainline', code: String(o.code), targetPct: BUDGET_GATES.DEFAULT_SINGLE_PCT });
  }
  const r = allocateBudget({ totalEquity: acc.equity || acc.total || 0, usedTodayPct: 0, slots, signals });
  const rec = {
    date: today, generatedAt: new Date().toISOString(),
    note: '预演档：仅供人工对照，决策链不读取本档；预算表见 config.paper.budgetSlots',
    equity: acc.equity || acc.total || 0, slots, signalsIn: signals.length,
    ...r,
  };
  const hist = existsSync(join(ROOT, 'data/risk_budget_preview.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'data/risk_budget_preview.json'), 'utf8')) : [];
  const list = Array.isArray(hist) ? hist : [];
  const idx = list.findIndex((x) => x.date === rec.date);
  if (idx >= 0) list[idx] = rec; else list.push(rec);
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeFileSync(join(ROOT, 'data/risk_budget_preview.json'), JSON.stringify(list, null, 1) + '\n');
  console.log(`[budget-preview] ${today} 信号 ${signals.length} 条 → 批准 ${r.allocations.length} / 闸拦 ${r.gated.length} / 冲突 ${r.conflicts.length}；占用 ${r.usedPct} 槽内剩余 ${r.remainingPct}`);
} catch (e) {
  console.error('[budget-preview] 异常（fail-open）:', e && e.message);
  process.exit(1);
}
