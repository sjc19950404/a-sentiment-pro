#!/usr/bin/env node
/**
 * 盘中首日体检·一次性（2026-11-11 用户拍板：没空盯开盘首 10 分钟日志，休市后自动查，有问题推企微）。
 * 检查今天新增运行时的实际运转证据（不靠日志静默推断，靠档位实据）：
 *   ① 首板状态机今日真跑过（state.date=今日 且 stocks 非空=行情真进了状态机）
 *   ② 竞价采集首枪落档（auction_history 今日档）
 *   ③ 竞价打分落档（auction_score 今日档）
 *   ④ live 快照是今天的（30 分钟档在跑）
 *   ⑤ pi_push 试点有无失败记录（push.log 今日）
 *   ⑥ run.log 今日两盯盘脚本的异常行（fail-open 留痕）
 * 全绿 → 推一条简短确认（让用户知道检查发生过）；异常 → 逐条推详情。
 * 跑完自删 crontab 行（标记 ONE-SHOT-DAYCHECK）。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bj = () => new Date(Date.now() + 8 * 3600000);
const today = bj().toISOString().slice(0, 10);
const todayC = today.replace(/-/g, '');
// 北京时间 HH:MM（getUTC 系；绝不用 toTimeString——本机=北京时区时会双重 +8，2026-11-11 实测抓回）
const bjHm = () => { const d = bj(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const read = (f) => { try { return JSON.parse(readFileSync(join(ROOT, f), 'utf8')); } catch { return null; } };

const problems = [];
const notes = [];
const ok = (name, extra) => notes.push(`✅ ${name}${extra ? '（' + extra + '）' : ''}`);
const bad = (name, detail) => problems.push(`❌ ${name}：${detail}`);

// ① 首板状态机
const fbState = read('data/first_board_alert_state.json');
if (!fbState || fbState.date !== today) bad('首板状态机今日未运行', 'state 档缺今日记录（cron 未触发/脚本报错）');
else if (!fbState.stocks || !Object.keys(fbState.stocks).length) bad('首板状态机今日运行但零持仓记录', '盘中行情未进状态机（f124 门禁全拦/行情接口失败）');
else {
  const n = Object.keys(fbState.stocks).length;
  const evts = fbState.notified || 0;
  ok(`首板状态机（${n} 只在册，事件推送 ${evts} 条）`);
}

// ② 竞价采集
const ah = read('data/auction_history.json');
const ahToday = Array.isArray(ah) ? ah.find((d) => (d.trade_date || d.date || '').replace(/-/g, '') === todayC) : null;
if (!ahToday || !ahToday.items || !ahToday.items.length) bad('竞价采集今日未落档', '9:26 首枪失败或档位结构异常');
else ok('竞价采集首枪', `${ahToday.items.length} 只（窗口 ${ahToday.window || '—'}）`);

// ③ 竞价打分
const as = read('data/auction_score.json');
const asToday = Array.isArray(as) ? as.find((d) => (d.trade_date || '').replace(/-/g, '') === todayC) : null;
if (!asToday) bad('竞价打分今日未落档', '9:27 未运行或读不到采集档');
else ok('竞价打分', `强势${asToday.signals.strong}/走弱${asToday.signals.weak}/中性${asToday.signals.neutral}`);

// ④ live 快照
const live = read('data/first_board_live.json');
if (!live || !String(live.at || '').startsWith(today)) bad('live 快照不是今天的', '30 分钟档未运行');
else ok('live 盯盘快照', `${live.bj || '—'} 时点 · 池 ${live.pool} 只（已晋级${live.counts.sealed}/炸板${live.counts.broken}/逼近${live.counts.approaching}）`);

// ⑤ pi_push 试点失败记录
const pushLog = '/var/log/aquant/push.log';
if (existsSync(pushLog)) {
  const todayLines = readFileSync(pushLog, 'utf8').split('\n').filter((l) => l.includes(today) && /失败|⛔|原因/.test(l));
  if (todayLines.length) problems.push(`⚠ pi_push 今日失败 ${todayLines.length} 次（pi_push 自己会推企微通知，此为汇总）：\n   ${todayLines.slice(0, 3).join('\n   ')}`);
  else ok('pi_push 试点今日无失败');
} else notes.push('ℹ push.log 尚未创建（试点今日可能还无推送动作）');

// ⑥ run.log 两盯盘异常
const runLog = '/var/log/aquant/run.log';
if (existsSync(runLog)) {
  const dayStr = bj().toISOString().slice(11, 13); // 时段仅近一小时精确，粗查今日关键词
  const lines = readFileSync(runLog, 'utf8').split('\n').filter((l) => /(\[fb-alert\]|\[dt-alert\])/.test(l) && /异常|失败|ERROR/i.test(l));
  if (lines.length) problems.push(`⚠ 盯盘脚本异常留痕 ${lines.length} 条：\n   ${lines.slice(0, 5).join('\n   ')}`);
  else ok('盯盘脚本日志无异常留痕');
}

// ⑦ 反包监控说明（今日昨日跌停 0 只 → 静默是预期）
const dtp = read('data/dtpool_history.json');
const dtpPrev = Array.isArray(dtp) ? dtp.filter((d) => d.date < today).pop() : null;
notes.push(`ℹ 反包监控：昨日（${dtpPrev ? dtpPrev.date : '无档'}）跌停 ${dtpPrev ? dtpPrev.pool.length : '—'} 只 → ${dtpPrev && dtpPrev.pool.length ? '反包状态机今日应已运行' : '无票可盯，静默为预期'}`);

// ── 汇总推送 ──
const hook = process.env.OPS_WEBHOOK;
const offHours = !/^(15:0[0-9]|15:1[0-9])/.test(bjHm());
const offTag = offHours ? '〔非体检时点（' + bjHm() + '）——以下仅链路验证，不作为盘后结论〕\n' : '';
const head = (offTag || '') + (problems.length
  ? `🔔【盘中首日体检】${today} ${bjHm()} —— 发现 ${problems.length} 项问题：\n${problems.join('\n')}\n${notes.join('\n')}`
  : `✅【盘中首日体检】${today} ${bjHm()} —— 全部通过：\n${notes.join('\n')}`);
if (hook) {
  try {
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: head } }) });
    console.log(`[daycheck] 已推企微（${problems.length ? problems.length + ' 项问题' : '全绿'}）`);
  } catch (e) { console.error('[daycheck] 企微推送失败（体检结果见日志）:', e && e.message); }
} else console.log(head);
console.log(head.replace(/\n/g, '\n  '));

// 自删 crontab 行（ONE-SHOT-DAYCHECK 标记）
try {
  const cur = execSync('crontab -l', { encoding: 'utf8' });
  const kept = cur.split('\n').filter((l) => !l.includes('ONE-SHOT-DAYCHECK')).join('\n') + '\n';
  execSync('crontab -', { input: kept });
  console.log('[daycheck] 一次性 cron 行已自删');
} catch (e) { console.error('[daycheck] crontab 自删失败（手动清理）:', e && e.message); }
