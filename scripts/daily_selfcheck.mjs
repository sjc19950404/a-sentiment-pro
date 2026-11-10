#!/usr/bin/env node
/**
 * 每日全系统体检（2026-11-11 用户拍板 v2：全面覆盖 + 新功能自动纳入 + 时点误报自动排除）。
 *
 * 三层架构：
 *   A. 通用自动层（零注册）：data/ 全部 JSON 可解析、档位非空、index.html 内联标记、账本自洽——
 *      新功能只要落了档就自动被扫到（写坏/空档检测），无需注册；
 *   B. 注册层（新功能上线 checklist 第③步）：每个功能注册 {档位, 今日应更新时刻 updateTime,
 *      cronKey}——**时点误报自动排除的通用机制**：期望日期 = updateTime ≤ 当前时刻 ? 今日 : 上一
 *      交易日。18:00 体检时 EOD(18:30) 档自动按"上一交易日"判（不算落后）；若将来体检挪到 21:30，
 *      同一段代码自动升级为查今日——机制自适应，无需改检查逻辑。前置条件不满足的项自动跳过
 *      （如昨日跌停 0 只 → 反包无记录是预期）；
 *   C. 系统层：磁盘/内存/git 同步/日志异常/cron 完整性（从注册表 cronKey 自动推导）/Pages 可达。
 *
 * 推送纪律：有问题 → 推企微汇总（仅正式时点）；没问题 → 静默只落日志；非交易日跳过；
 *   外部依赖抖动（Pages/东财）归 warnings 只留痕不推（本机网络抖动不该打扰）；自检自身异常兜底推送。
 *
 * ══ 新功能落地 checklist（每次迭代必做）══
 *   ① 挂 crontab（+ 同步 crontab.example）
 *   ② pi_build 挂 step（若属 EOD 链）
 *   ③ 在本文件 REGISTRY 注册一行（档位 + updateTime + cronKey）——自动纳入每日体检
 * ═══════════════════════════════════════════
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bj = () => new Date(Date.now() + 8 * 3600000);
const bjHm = () => { const d = bj(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const today = bj().toISOString().slice(0, 10);
const todayC = today.replace(/-/g, '');
const read = (f) => { try { return JSON.parse(readFileSync(join(ROOT, f), 'utf8')); } catch { return null; } };
const mtimeDate = (f) => { try { return new Date(statSync(join(ROOT, f)).mtimeMs + 8 * 3600000).toISOString().slice(0, 10); } catch { return null; } };

function isTradingDay(dateStr) {
  try {
    const cal = read('data/calendar.json');
    const closed = (cal && cal.closed) || [];
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    return dow >= 1 && dow <= 5 && !closed.includes(dateStr);
  } catch { return true; }
}
function prevTradingDay() {
  for (let i = 1; i <= 10; i++) {
    const d = new Date(Date.now() + 8 * 3600000 - i * 86400000).toISOString().slice(0, 10);
    if (isTradingDay(d)) return d;
  }
  return null;
}
if (!isTradingDay(today)) { console.log(`[selfcheck] ${today} 非交易日，跳过`); process.exit(0); }
const PREV = prevTradingDay();
const PREVC = PREV ? PREV.replace(/-/g, '') : '';
const nowMin = parseInt(bjHm().replace(':', ''), 10);
const offHours = !/^18:/.test(bjHm());

const problems = []; const warnings = []; const notes = [];
const ok = (n, e) => notes.push(`✅ ${n}${e ? '（' + e + '）' : ''}`);
const bad = (n, d) => problems.push(`❌ ${n}：${d}`);
const warn = (n, d) => warnings.push(`⚠ ${n}：${d}`);

// ═══ B. 档位注册表（新功能在此加一行）═══
// dateGet: 返回 YYYY-MM-DD 或 YYYYMMDD（缺省用 mtime）；cronKey: 自动纳入 cron 完整性检查
const REGISTRY = [
  { name: '首板盯盘状态机', file: 'data/first_board_alert_state.json', updateTime: '15:05', cronKey: 'first_board_alert', dateGet: (d) => d && d.date, deep: (d) => (!d.stocks || !Object.keys(d.stocks).length) ? '运行了但零持仓记录（行情未进状态机）' : null },
  { name: '跌停反包状态机', file: 'data/dt_rebound_state.json', updateTime: '15:05', cronKey: 'dt_rebound_alert', dateGet: (d) => d && d.date, condition: () => { const t = read('data/dtpool_history.json'); const r = Array.isArray(t) && t.find((x) => x.date === PREVC); return r && r.pool.length ? null : `昨日（${PREV}）跌停 0 只/无档 → 无票可盯为预期`; } },
  { name: '竞价采集', file: 'data/auction_history.json', updateTime: '09:31', cronKey: 'fetch_auction', dateGet: (d) => Array.isArray(d) && d.length ? (d[d.length - 1].trade_date || d[d.length - 1].date) : null, deep: (d) => { const t = Array.isArray(d) && d.find((x) => (x.trade_date || '').replace(/-/g, '') === todayC); return t && (!t.items || !t.items.length) ? '今日档存在但 0 只（采集空跑）' : null; } },
  { name: '竞价打分', file: 'data/auction_score.json', updateTime: '09:32', cronKey: 'auction_score', dateGet: (d) => Array.isArray(d) && d.length ? d[d.length - 1].trade_date : null },
  { name: 'live 盯盘快照', file: 'data/first_board_live.json', updateTime: '15:30', cronKey: 'first_board_live', dateGet: (d) => d && d.at ? d.at.slice(0, 10) : null },
  { name: 'signals 情绪主档', file: 'data/signals-latest.json', updateTime: '15:30', dateGet: (d) => d && d.latest && d.latest.trade_date },
  { name: '涨停池档', file: 'data/ztpool_history.json', updateTime: '18:30', cronKey: 'pi_run.sh eod', dateGet: (d) => Array.isArray(d) && d.length ? d[d.length - 1].date : null },
  { name: '情绪历史档', file: 'data/emotion_history.json', updateTime: '18:30', dateGet: (d) => d && Array.isArray(d.history) && d.history.length ? d.history[d.history.length - 1].date : null },
  { name: '主线题材档', file: 'data/main_theme_history.json', updateTime: '18:30', dateGet: (d) => d && Array.isArray(d.days) && d.days.length ? (d.days[d.days.length - 1].trade_date || d.days[d.days.length - 1].date) : null },
  { name: '题材图谱档', file: 'data/theme_graph.json', updateTime: '18:30', dateGet: (d) => d && d.generatedAt ? d.generatedAt.slice(0, 10) : null },
  { name: '公告避雷扫描', file: 'data/ann_risk_scan.json', updateTime: '18:30', dateGet: (d) => d && (d.generatedAt || d.date) ? String(d.generatedAt || d.date).slice(0, 10) : null },
  { name: '预算预演档', file: 'data/risk_budget_preview.json', updateTime: '18:30', dateGet: (d) => d && (d.date || d.generatedAt) ? String(d.date || d.generatedAt).slice(0, 10) : null },
  { name: '首板观察档', file: 'data/first_board_watch.json', updateTime: '18:30', dateGet: (d) => Array.isArray(d) && d.length ? d[d.length - 1].date : null },
  { name: '跌停池档', file: 'data/dtpool_history.json', updateTime: '18:30', dateGet: (d) => Array.isArray(d) && d.length ? d[d.length - 1].date : null },
  { name: '模拟账本', file: 'data/paper/account.json', updateTime: '18:30', dateGet: (d) => d && d.lastSettle, deep: (d) => { const nav = Array.isArray(d.nav) && d.nav.length ? d.nav[d.nav.length - 1] : null; if (!nav) return 'nav 序列空'; if (d.cash == null || d.cash < 0 || (d.freeze || 0) < 0) return `cash/freeze 非法（cash=${d.cash} freeze=${d.freeze}）`; if (Math.abs((nav.cash || 0) + (nav.marketValue || 0) - (nav.equity || 0)) > 1) return `账本不自洽：nav 末条 cash(${nav.cash})+市值(${nav.marketValue}) ≠ equity(${nav.equity})`; return null; } },
  { name: '配置档', file: 'config.json', updateTime: null, dateGet: () => null },
  { name: '交易日历', file: 'data/calendar.json', updateTime: null, dateGet: () => null },
];

// ── B. 注册层执行 ──
const cronKeys = new Set(['pi_run.sh eod', 'pi_run.sh supplement', 'pi_run.sh smoke', 'pi_run.sh intraday', 'pi_run.sh us_close', 'pi_run.sh a50', 'pi_run.sh pre_open', 'pi_run.sh candidates', 'milestone_reminder', 'daily_selfcheck', 'seat_cluster', 'pi_push.sh']);
for (const r of REGISTRY) {
  try {
    if (r.cronKey) cronKeys.add(r.cronKey);
    // 时点误报自动排除①：前置条件不满足 → 跳过（记 notes，不算问题）
    if (r.condition) { const skip = r.condition(); if (skip) { notes.push(`ℹ ${r.name}：${skip}`); continue; } }
    // 常备档（updateTime=null）：只要求存在+可解析（通用层已扫），无日期期望
    if (!r.updateTime) { ok(r.name, '常备档在场可解析'); continue; }
    // 时点误报自动排除②：今日计划更新时刻未到 → 期望日期自动降为上一交易日
    const expect = r.updateTime && parseInt(r.updateTime.replace(':', ''), 10) > nowMin ? PREVC : todayC;
    const expectD = expect === todayC ? today : PREV;
    const d = read(r.file);
    if (!d) {
      // 常备档（无时点）缺失=问题；带时点档缺失按时点判
      if (!r.updateTime || parseInt(r.updateTime.replace(':', ''), 10) <= nowMin) bad(`${r.name}档缺失/损坏`, r.file);
      else notes.push(`ℹ ${r.name}：档缺失但更新时点（${r.updateTime}）未过，不算问题`);
      continue;
    }
    const got = (r.dateGet && r.dateGet(d)) || mtimeDate(r.file);   // 日期字段缺席 → mtime 兜底（档被动过就是证据）
    const gotC = got ? got.replace(/-/g, '') : null;
    if (!gotC) { warn(`${r.name}日期不可读`, r.file); continue; }
    if (gotC < expect) { bad(`${r.name}档落后`, `末次 ${got}，期望 ≥ ${expectD}${r.updateTime ? `（更新时点 ${r.updateTime}）` : ''}`); continue; }
    const deepMsg = r.deep ? r.deep(d) : null;
    if (deepMsg) bad(`${r.name}深检查失败`, deepMsg);
    else ok(r.name, `末次 ${got}`);
  } catch (e) { bad(`${r.name}检查自身异常`, e && e.message); }
}

// ── A. 通用自动层（零注册：data/ 全部 JSON 可解析 + 非空 + 内联标记）──
try {
  const scan = (dir, acc) => { for (const f of readdirSync(dir, { withFileTypes: true })) { if (f.name.startsWith('.') || f.name === 'node_modules') continue; const p = join(dir, f.name); if (f.isDirectory()) scan(p, acc); else if (extname(f.name) === '.json') acc.push(p); } return acc; };
  const files = scan(join(ROOT, 'data'), []);
  let broken = [];
  for (const f of files) {
    try { const j = JSON.parse(readFileSync(f, 'utf8')); if (j == null || (typeof j === 'object' && !Object.keys(j).length && !Array.isArray(j))) broken.push(f.replace(ROOT + '/', '') + '（空对象）'); }
    catch (e) { broken.push(f.replace(ROOT + '/', '') + `（解析失败: ${(e && e.message || '').slice(0, 40)}）`); }
  }
  if (broken.length) bad(`data/ 存在损坏/空档 ${broken.length} 个`, broken.slice(0, 5).join('、'));
  else ok(`data/ 全档扫描`, `${files.length} 个 JSON 全部可解析非空`);
  const html = existsSync(join(ROOT, 'index.html')) ? readFileSync(join(ROOT, 'index.html'), 'utf8') : '';
  const marks = ['首板晋级', '题材关联'];
  const missing = marks.filter((m) => !html.includes(m));
  if (missing.length) bad('index.html 内联副本缺关键标记', missing.join('、') + '（改源忘重生成？）');
  else ok('终端内联一致性');
} catch (e) { bad('通用扫描自身异常', e && e.message); }

// ── C. 系统层 ──
try {
  const df = parseInt(execSync("df / | tail -1 | awk '{print $5}'", { encoding: 'utf8' }).trim());
  if (df >= 85) bad('磁盘使用率过高', `${df}%`);
  else ok('磁盘', `${df}%`);
  const memKb = parseInt(execSync("free -k | awk 'NR==2{print $NF}'", { encoding: 'utf8' }).trim());
  if (!Number.isFinite(memKb)) bad('内存读数失败', 'free 解析失败');
  else if (memKb < 150000) bad('可用内存偏低', `${Math.round(memKb / 1024)}MB`);
  else ok('内存', `${Math.round(memKb / 1024)}MB 可用`);
  const sync = execSync('git rev-list --left-right --count main...origin/main', { cwd: ROOT, encoding: 'utf8' }).trim();
  const ahead = +sync.split('\t')[0];
  if (ahead > 0) bad('git 本地领先远端', `${ahead} 个提交未推送`);
  else ok('git 同步');
  const runLog = '/var/log/aquant/run.log';
  if (existsSync(runLog)) {
    const lines = readFileSync(runLog, 'utf8').split('\n').filter((l) => l.includes(today) && /ERROR|Error:|异常|⛔/i.test(l) && !/fail-open|无变化/.test(l));
    if (lines.length) problems.push(`⚠ run.log 今日异常留痕 ${lines.length} 条：\n   ${lines.slice(0, 5).map((l) => l.slice(0, 120)).join('\n   ')}`);
    else ok('run.log 今日无异常');
  }
  const ct = execSync('crontab -l', { encoding: 'utf8' });
  const missingCron = [...cronKeys].filter((k) => !ct.includes(k));
  if (missingCron.length) bad('crontab 缺关键调度行', missingCron.join(' / '));
  else ok('crontab 完整', `${cronKeys.size} 条关键调度在位（注册表自动推导）`);
  // 外部依赖（warnings：本机网络抖动不算系统问题）
  try {
    const code = execSync(`curl -s -o /dev/null -w '%{http_code}' -m 10 'https://sjc19950404.github.io/a-sentiment-pro/index.html?t=${Date.now()}'`, { encoding: 'utf8' }).trim();
    if (code !== '200') warnings.push(`Pages 返回 ${code}（部署链路或本机网络）`);
  } catch { warnings.push('Pages 探测超时（本机网络？）'); }
  try {
    const r = await fetch('https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001&fields=f12&ut=fa5fd1943c7b386f172d6893dbfba10b', { headers: { Referer: 'https://quote.eastmoney.com/' } });
    if (!r.ok) warnings.push(`东财接口 HTTP ${r.status}`);
  } catch { warnings.push('东财接口探测失败（本机网络？）'); }
} catch (e) { bad('系统层检查自身异常', e && e.message); }

// ── 汇总 ──
const head = (problems.length
  ? `🔔【每日系统体检】${today} ${bjHm()} —— ${problems.length} 项问题${warnings.length ? `（另有 ${warnings.length} 项 warning 不推送，见日志）` : ''}：\n${problems.join('\n')}`
  : '') + (offHours && (problems.length || warnings.length) ? `\n〔非体检时点（${bjHm()}）手动试跑——仅落日志不推送〕` : '');
if (problems.length) console.log(head.replace(/\n/g, '\n  ') + (warnings.length ? '\n  ' + warnings.join('\n  ') : ''));
else console.log(`[selfcheck] ${bjHm()} 全绿（${notes.length} 项通过${warnings.length ? `，${warnings.length} 项 warning 留痕` : ''}）——不推送`);
if (warnings.length && !problems.length) console.log('  ' + warnings.join('\n  '));
if (process.env.SELFCHECK_VERBOSE === '1') console.log(notes.join('\n'));

const hook = process.env.OPS_WEBHOOK;
if (hook && problems.length && !offHours) {
  try {
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: head } }) });
    console.log(`[selfcheck] 已推企微（${problems.length} 项问题）`);
  } catch (e) { console.error('[selfcheck] 企微推送失败:', e && e.message); }
}
