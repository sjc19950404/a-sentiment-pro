#!/usr/bin/env node
/**
 * 里程碑提醒（2026-11-10 用户拍板：「其他的我怕忘了，做个定时任务到时间自动落实」）。
 *
 * 边界（拍板制）：
 *   · 本任务**只做提醒**——到点/数据就绪时经企微推送一条提醒，提醒人回来拍板实施；
 *   · **不自动改代码/不自动接决策链**——竞价打分口径、预算表、riskGuard 接闸都属于
 *     「会改变输出口径」类，按仓库纪律必须人工拍板后实施（自动落实=违反纪律）。
 *
 * 提醒判据 = 日期到点 **且** 数据条件满足（如竞价满 5 日）——两个条件都满足才推，
 *   避免数据没攒够时空喊。同一里程碑每天最多提醒 1 次、累计最多 3 次（防刷屏）。
 * 状态档：data/milestones_state.json（done 列表 + 各 id 已提醒次数）。
 * 调度：crontab 每工作日 08:50（开盘前，看到后当天可安排）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'data/milestones_state.json');
const MAX_NOTIFY = 3;

function bjNow() { return new Date(Date.now() + 8 * 3600000); }
const today = () => bjNow().toISOString().slice(0, 10);

const daysOf = (rel) => {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
    return Array.isArray(j) ? j.length : 0;
  } catch { return 0; }
};

/**
 * 里程碑表（用户拍板时间表的固化）——到点且数据就绪才提醒。
 * due 用北京日期；数据条件是判据不是门槛（不够就不提醒，等下次）。
 */
const MILESTONES = [
  {
    id: 'auction-caliber',
    due: '2026-11-17',
    title: '竞价数据满 5 日 → 拍板竞价打分口径（建议 v1 三判据：竞价涨幅榜 / 竞价额占昨日成交比 / 一字缩量）并接竞价 UI 卡',
    ready: () => daysOf('data/auction_history.json') >= 5,
    readyText: () => `auction_history 已 ${daysOf('data/auction_history.json')} 天`,
  },
  {
    id: 'slippage-v2',
    due: '2026-11-17',
    title: '竞价额数据回填 → paper 层动态滑点 v2 口径（容量项用真实竞价额，dynamicSlip 已就绪待接线）',
    ready: () => daysOf('data/auction_history.json') >= 5,
    readyText: () => `auction_history 已 ${daysOf('data/auction_history.json')} 天`,
  },
  {
    id: 'budget-gate',
    due: '2026-11-19',
    title: '预算预演满 5 日 → 对账 risk_budget_preview.json → 拍板预算表 → 接 riskGuard 单一闸口（然后 UI 显示预算占用）',
    ready: () => daysOf('data/risk_budget_preview.json') >= 5,
    readyText: () => `预算预演已 ${daysOf('data/risk_budget_preview.json')} 天`,
  },
  {
    id: 'pi-push-trial',
    due: '2026-11-13',
    title: 'pi_push */5 试点回看（11-11 起）：盘中是否真在刷页面？Pages 部署有无排队延迟？→ 保持 */5 或退 */10（回看人自己定，无数据判据）',
    ready: () => true,   // 回看型提醒：无数据判据，到点即提
    readyText: () => '试点已满 2 个交易日',
  },
];

function loadState() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return { done: [], notified: {} }; }
}
function saveState(s) { writeFileSync(STATE, JSON.stringify(s, null, 1) + '\n'); }

async function notify(text) {
  const hook = process.env.OPS_WEBHOOK;
  if (!hook) { console.error('[milestone] 未配置 OPS_WEBHOOK——仅落日志不推送'); return false; }
  try {
    const res = await fetch(hook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
    });
    return res.ok;
  } catch (e) {
    console.error('[milestone] 推送失败（fail-open）:', e && e.message);
    return false;
  }
}

const st = loadState();
const due = MILESTONES.filter((m) => m.id && !st.done.includes(m.id) && today() >= m.due);
if (!due.length) { console.log(`[milestone] ${today()} 无到点里程碑（done=${st.done.length}）`); process.exit(0); }

const ready = [];
for (const m of due) {
  const n = (st.notified[m.id] || 0);
  if (n >= MAX_NOTIFY) continue;
  let ok = false;
  try { ok = m.ready(); } catch { ok = false; }
  if (!ok) { console.log(`[milestone] ${m.id} 到点但数据未就绪（${m.readyText()}）——等数据`); continue; }
  ready.push({ m, n });
}

if (!ready.length) process.exit(0);

const lines = ready.map(({ m }) => `· ${m.title}\n  （判据：${m.readyText()}）`).join('\n');
const text = `⏰【里程碑提醒】${today()}\n以下事项到点且数据已就绪，请回来拍板/安排实施：\n${lines}\n\n纪律：口径类改动需拍板后实施，提醒任务不自动改代码。`;
const ok = await notify(text);
for (const { m, n } of ready) st.notified[m.id] = n + 1;
saveState(st);
console.log(`[milestone] 已提醒 ${ready.length} 项（推送${ok ? '成功' : '未成功/仅日志'}）：${ready.map(({ m }) => m.id).join(',')}`);
