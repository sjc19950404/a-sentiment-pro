#!/usr/bin/env node
/**
 * 每日全系统自检（2026-11-11 用户拍板：不想每次出问题后手动查 bug/漏洞——
 *   每交易日 18:00 自动跑（EOD 18:30 之前，问题在盘后数据链启动前暴露），
 *   发现问题 → 推企微汇总；没问题 → 静默只落日志（不刷屏）。
 *
 * 与 15:10 one-shot daycheck 的区别：那个只验开盘首日新设施；本脚本常驻，
 *   覆盖面更宽（盘中链产出 / 推送通道 / git 同步 / 系统资源 / 日志异常 / cron 完整性 / EOD 档新鲜度）。
 *
 * 自检自身的失败也算问题（catch 兜底推企微）——自检挂了比静默更糟。
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bj = () => new Date(Date.now() + 8 * 3600000);
const bjHm = () => { const d = bj(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const today = bj().toISOString().slice(0, 10);            // YYYY-MM-DD
const todayC = today.replace(/-/g, '');                    // YYYYMMDD
const read = (f) => { try { return JSON.parse(readFileSync(join(ROOT, f), 'utf8')); } catch { return null; } };

// ── 交易日判定（calendar.json days 只存休市日；交易日=非周末且不在 closed 表）──
function isTradingDay(dateStr) {
  try {
    const cal = read('data/calendar.json');
    const closed = (cal && cal.closed) || [];
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    return dow >= 1 && dow <= 5 && !closed.includes(dateStr);
  } catch { return true; }  // 日历缺席不阻塞（宁可多查）
}
function prevTradingDay() {
  for (let i = 1; i <= 10; i++) {
    const d = new Date(Date.now() + 8 * 3600000 - i * 86400000).toISOString().slice(0, 10);
    if (isTradingDay(d)) return d;
  }
  return null;
}

if (!isTradingDay(today)) { console.log(`[selfcheck] ${today} 非交易日，跳过`); process.exit(0); }

const problems = [];
const notes = [];
const ok = (name, extra) => notes.push(`✅ ${name}${extra ? '（' + extra + '）' : ''}`);
const bad = (name, detail) => problems.push(`❌ ${name}：${detail}`);
const offHours = !/^18:/.test(bjHm());
const offTag = offHours ? `〔非体检时点（${bjHm()}）——以下仅链路验证，不作为盘后结论〕\n` : '';

// ── 1. 盘中链产出（今日应有）──
try {
  const fb = read('data/first_board_alert_state.json');
  if (!fb || fb.date !== today) bad('首板状态机今日未运行', 'state 档无今日记录（cron 未触发/脚本报错/非交易日误跑）');
  else if (!fb.stocks || !Object.keys(fb.stocks).length) bad('首板状态机今日运行但零持仓记录', '盘中行情未进状态机（f124 门禁全拦/行情接口失败）');
  else ok(`首板盯盘状态机`, `${Object.keys(fb.stocks).length} 只在册，事件推送 ${fb.notified || 0} 条`);

  const ah = read('data/auction_history.json');
  const ahToday = Array.isArray(ah) ? ah.find((d) => (d.trade_date || d.date || '').replace(/-/g, '') === todayC) : null;
  if (!ahToday || !ahToday.items || !ahToday.items.length) bad('竞价采集今日未落档', '9:26 首枪失败或档位结构异常');
  else ok('竞价采集', `${ahToday.items.length} 只`);

  const as = read('data/auction_score.json');
  const asToday = Array.isArray(as) ? as.find((d) => (d.trade_date || '').replace(/-/g, '') === todayC) : null;
  if (!asToday) bad('竞价打分今日未落档', '9:27 未运行或读不到采集档');
  else ok('竞价打分', `强势${asToday.signals.strong}/走弱${asToday.signals.weak}/中性${asToday.signals.neutral}`);

  const live = read('data/first_board_live.json');
  if (!live || !String(live.at || '').startsWith(today)) bad('live 快照不是今天的', '30 分钟盯盘档未运行');
  else ok('live 盯盘快照', `${live.bj || '—'} 时点 · 池 ${live.pool} 只（晋级${live.counts.sealed}/炸板${live.counts.broken}/逼近${live.counts.approaching}）`);

  const sg = read('data/signals-latest.json');
  const sgDate = sg && sg.latest && sg.latest.trade_date;
  if (!sgDate) bad('signals-latest 缺 latest.trade_date', '档位结构异常');
  else if (sgDate !== today) bad('signals 未更新到今日', `末次 ${sgDate}（15:30 tick 未跑或失败）`);
  else ok('signals 情绪主档', `今日 ${sgDate}`);
} catch (e) { bad('盘中链检查自身异常', e && e.message); }

// ── 2. 反包监控（昨日跌停池有票时才要求 state 有今日记录）──
try {
  const dtp = read('data/dtpool_history.json');
  const prev = prevTradingDay();
  const prevRec = Array.isArray(dtp) ? dtp.find((d) => d.date === prev) : null;
  if (prevRec && prevRec.pool.length) {
    const st = read('data/dt_rebound_state.json');
    if (!st || st.date !== today) bad('反包状态机今日未运行', `昨日（${prev}）跌停 ${prevRec.pool.length} 只，本应有盯盘记录`);
    else ok('反包状态机', `昨日跌停 ${prevRec.pool.length} 只在盯`);
  } else notes.push(`ℹ 反包监控：昨日（${prev || '—'}）跌停 ${prevRec ? prevRec.pool.length : '无档'} 只 → 无票可盯为预期`);
} catch (e) { bad('反包检查自身异常', e && e.message); }

// ── 3. 推送通道与 git 同步 ──
try {
  const pushLog = '/var/log/aquant/push.log';
  if (existsSync(pushLog)) {
    const fails = readFileSync(pushLog, 'utf8').split('\n').filter((l) => l.includes(today) && /失败|⛔|原因/.test(l));
    if (fails.length) problems.push(`⚠ pi_push 今日失败 ${fails.length} 次（失败时它自己会推企微，此为汇总）：\n   ${fails.slice(0, 3).join('\n   ')}`);
    else ok('pi_push 今日无失败');
  }
  const sync = execSync('git rev-list --left-right --count main...origin/main', { cwd: ROOT, encoding: 'utf8' }).trim();
  const [ahead] = sync.split('\t');
  if (+ahead > 0) bad('git 本地领先远端', `${ahead} 个提交未推送（push 失败积累，检查网络/凭据）`);
  else ok('git 同步', '本地与远端一致');
} catch (e) { bad('推送/git 检查自身异常', e && e.message); }

// ── 4. 系统资源（树莓派）──
try {
  const df = execSync("df / | tail -1 | awk '{print $5}'", { encoding: 'utf8' }).trim();
  if (parseInt(df) >= 85) bad('磁盘使用率过高', `${df}（≥85%，Pi 数据档会持续增长）`);
  else ok('磁盘', df);
  // NR==2 取内存行（第一行是表头；标签随 locale 变中文/英文，按行号取才稳）
  const memKb = parseInt(execSync("free -k | awk 'NR==2{print $NF}'", { encoding: 'utf8' }).trim());
  if (!Number.isFinite(memKb)) bad('内存读数失败', 'free 输出无法解析');
  else if (memKb < 150000) bad('可用内存偏低', `${Math.round(memKb / 1024)}MB（<150MB）`);
  else ok('内存', `${Math.round(memKb / 1024)}MB 可用`);
} catch (e) { bad('资源检查自身异常', e && e.message); }

// ── 5. run.log 今日异常行 ──
try {
  const runLog = '/var/log/aquant/run.log';
  if (existsSync(runLog)) {
    const lines = readFileSync(runLog, 'utf8').split('\n')
      .filter((l) => l.includes(today) && /ERROR|Error:|异常|⛔/i.test(l) && !/fail-open|无变化/.test(l));
    if (lines.length) problems.push(`⚠ run.log 今日异常留痕 ${lines.length} 条：\n   ${lines.slice(0, 5).map((l) => l.slice(0, 120)).join('\n   ')}`);
    else ok('run.log 今日无异常留痕');
  }
} catch (e) { bad('日志检查自身异常', e && e.message); }

// ── 6. cron 完整性（关键调度行防误删）──
try {
  const ct = execSync('crontab -l', { encoding: 'utf8' });
  const must = ['first_board_alert', 'dt_rebound_alert', 'fetch_auction', 'auction_score', 'first_board_live', 'pi_run.sh eod', 'pi_run.sh supplement'];
  const missing = must.filter((m) => !ct.includes(m));
  if (missing.length) bad('crontab 缺关键调度行', missing.join(' / '));
  else ok('crontab 完整', `${must.length} 条关键调度在位`);
} catch (e) { bad('cron 检查自身异常', e && e.message); }

// ── 7. EOD 档新鲜度（18:00 时今日 EOD 未跑，末条应为上一交易日）──
try {
  const prev = prevTradingDay();
  const prevC = prev ? prev.replace(/-/g, '') : null;
  const z = read('data/ztpool_history.json');
  const zLast = Array.isArray(z) && z.length ? z[z.length - 1].date : null;
  if (zLast !== prevC) bad('涨停池档落后', `末条 ${zLast}，应为 ${prevC}`);
  else ok('涨停池档', `末条 ${zLast}`);
  const em = read('data/emotion_history.json');
  const eDays = (em && em.history) || [];
  const eLast = eDays.length ? eDays[eDays.length - 1].date : null;
  if (eLast !== prevC) bad('情绪历史档落后', `末条 ${eLast}，应为 ${prevC}`);
  else ok('情绪历史档', `末条 ${eLast}`);
} catch (e) { bad('EOD 档检查自身异常', e && e.message); }

// ── 汇总：有问题推企微，没问题静默留痕 ──
const head = (offTag || '') + (problems.length
  ? `🔔【每日系统自检】${today} ${bjHm()} —— 发现 ${problems.length} 项问题：\n${problems.join('\n')}\n${notes.join('\n')}`
  : `✅【每日系统自检】${today} ${bjHm()} —— 全部通过：\n${notes.join('\n')}`);
if (problems.length) console.log(head.replace(/\n/g, '\n  '));
else console.log(`[selfcheck] ${bjHm()} 全绿（${notes.length} 项通过）——不推送`);

const hook = process.env.OPS_WEBHOOK;
// 只在正式体检时点（18:00-18:59）才推企微——非时点（手动试跑/调试）只落日志，
//   防止调试污染推送通道（2026-11-11 试跑两次误推的教训）。
if (hook && problems.length && !offHours) {
  try {
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: head } }) });
    console.log(`[selfcheck] 已推企微（${problems.length} 项问题）`);
  } catch (e) { console.error('[selfcheck] 企微推送失败（问题明细见上方日志）:', e && e.message); }
} else if (!hook && problems.length && !offHours) {
  console.error('[selfcheck] 有问题但未配置 OPS_WEBHOOK——仅落日志');
}
