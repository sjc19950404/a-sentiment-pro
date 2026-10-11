// 策略回测结果 → Markdown 摘要（供 CI job summary 直读，跑完不必再去开前端）。
//
// ⚠ 纯展示：所有数字（收益/超额/回撤/夏普/胜率）全部来自 data/backtest-strategies.json，
//   本脚本**不重算任何指标**——重算就等于在 CI 里再写一套口径，那正是本项目一直在
//   消灭的东西（与前端 renderBtStrategies 同一条纪律）。
//
// 用法：
//   node scripts/bt_summary.mjs [档路径]        # 默认 data/backtest-strategies.json
//   node scripts/bt_summary.mjs >> "$GITHUB_STEP_SUMMARY"   # CI 里写进 Actions 摘要页
import { readFileSync, existsSync } from 'node:fs';

const FILE = process.argv[2] || 'data/backtest-strategies.json';
if (!existsSync(FILE)) {
  console.error(`[bt-summary] 缺 ${FILE}——先跑 node scripts/backtest_strategies.mjs`);
  process.exit(1);
}

const b = JSON.parse(readFileSync(FILE, 'utf8').replace(/^﻿/, ''));
const pct = (v, d = 2) => (v == null || !Number.isFinite(+v)) ? '—' : (+v * 100).toFixed(d) + '%';
const smp = (b.meta && b.meta.sample) || {};
const bench = b.benchmark || {};

const L = [];
L.push('### 策略回测结果');
L.push('');
L.push(`- 基准：**${bench.label || '沪深300 买入持有'}** · 总收益 ${pct(bench.total)} · 回撤 ${pct(bench.maxDd)} · 夏普 ${bench.sharpe ?? '—'}`);
L.push(`- 样本：${smp.realDays ?? '—'} 个交易日（${(smp.range || []).join(' ~ ') || '区间未知'}）`);
L.push('');
// 超额 = 策略 − 基准。基准自身可能为负（本样本即 -6%），故"亏得比基准少"也是跑赢。
L.push('| 策略 | 持有 | 触发 | 成交 | 总收益 | 超额 | 回撤 | 夏普 | 胜率 |');
L.push('|---|---|---|---|---|---|---|---|---|');
for (const s of (b.strategies || [])) {
  const ex = Number.isFinite(s && s.total) && Number.isFinite(bench.total) ? s.total - bench.total : null;
  L.push(`| ${s.label || s.id} | ${s.holdN ?? '—'} | ${s.triggered ?? 0} | ${s.trades ?? 0}`
    + ` | ${pct(s.total)} | ${pct(ex)} | ${pct(s.maxDd)} | ${s.sharpe ?? '—'}`
    + ` | ${s.winRate == null ? '—' : pct(s.winRate, 0)} |`);
}
L.push('');
if (b.meta && b.meta.disclaimer) L.push(`> ${b.meta.disclaimer}`);
console.log(L.join('\n'));
