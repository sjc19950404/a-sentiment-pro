// 龙虎榜口径守卫 —— 把「两套净额不得混用」变成机器可检的不变量。
//
// 背景：存档里合法地并存两个净额，用途完全不同：
//   · summary.lhb_daily_net（当日榜，权威）→ 日度因子 s_net / 净买率 / 新股扰动 / 近5日序列 / 主线资金占比
//   · summary.lhb_all_net  （全量，含区间累计榜）→ 仅诊断展示，禁止参与任何计算
// 人工阅读或批量重算时把两者混用，会造成因子偏移（2026-09-30：511 亿事件 + s_net 被区间累计值顶替）。
// 本脚本在 CI 里拦住三类回归：
//   A. 源码重新引入歧义字段名 / 在前端或脚本里另写一份区间榜判别式
//   B. 存档字段缺失、自相矛盾，或与原始记录对不上（说明被手改或口径漂移）
//   C. 因子 s_net 与当日榜净额脱钩（口径再次被换掉）
//
// 用法：node scripts/audit_lhb_caliber.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caliberFromDay, isRangeBoard } from '../src/lhb.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = path.join(ROOT, 'data', 'archive.json');
const fails = [];
const warns = [];
const check = (name, ok, detail = '') => {
  if (ok) console.log(`✓ ${name}${detail ? ' | ' + detail : ''}`);
  else { console.log(`✗ ${name}${detail ? ' | ' + detail : ''}`); fails.push(name); }
};

// ── A. 源码卫生：歧义字段名与重复实现 ─────────────────────────────────────────
const SRC_DIRS = ['src', 'scripts', 'tools'];
const walk = (dir, acc = []) => {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return acc;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel, acc); }
    else if (/\.(js|mjs|py|html)$/.test(e.name)) acc.push(rel);
  }
  return acc;
};
const files = [...SRC_DIRS.flatMap((d) => walk(d)), 'app.js', 'index.html']
  .filter((f) => f !== path.join('scripts', 'audit_lhb_caliber.mjs')); // 本文件自带判别式探针，跳过自检
// 唯一允许提到歧义字段名的文件：它是负责把该字段从存量里清除掉的「清扫器」（只 delete，不读写）
const PURGER = path.join('scripts', 'recalc_lhb_daily.mjs');
const hits = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const raw = readFileSync(abs, 'utf8');
  // 允许「删除」歧义字段（重算脚本负责把它从存量里清掉），但禁止任何读取/写入该字段
  const txt = raw.split('\n').filter((ln) => !/^\s*delete\s+[\w.$]*net_total_yi/.test(ln)).join('\n');
  if (/net_total_yi/.test(txt) && rel !== PURGER) hits.push(`${rel} 出现歧义字段 net_total_yi`);
  // 区间榜判别式只允许出现在唯一来源模块里，别处必须 import
  if (/连续\s*\[0-9/.test(txt) && rel !== path.join('src', 'lhb.js')) {
    hits.push(`${rel} 自行实现了区间榜判别式（应 import src/lhb.js）`);
  }
}
check('源码无歧义字段 net_total_yi、无重复的区间榜判别式', hits.length === 0, hits.join(' ; '));

// ── A2. 文案与权重一致性：资金面到底参不参与打分（易被写错的口径锁）────────────
// 背景：V5.0 五模块分解分（情绪/盈亏/广度/题材/主线）**不含**资金面；V5.2 主分数是**七因子**情绪分，
//       其中龙虎净额 s_net 占 20%。历史上因沿用 V5.0 旧文案，报告里出现过「资金面不参与打分」
//       这类**与权重直接矛盾**的整体否定，甚至同一句里既写「龙虎净额20%」又写「不参与打分」。
// 本守卫把两件事锁死：① 权重确实 > 0（资金面参与打分）；② 源码里不得出现整体否定措辞。
const cfg = (await import('../src/config.js')).default;
const netW = cfg?.weights?.s_net20;
check('权重事实：资金面（龙虎净额 s_net20）权重 > 0 —— 资金面参与主分数', Number(netW) > 0,
  `config.weights.s_net20 = ${netW}`);
// 整体否定措辞黑名单：出现即视为与权重冲突。
// 设计要点（踩过两次坑）：
//   ① 词距可跨逗号（真实回归文案就是「资金面为辅助观测，不参与打分」），但不得跨句号/分号；
//   ② 先剥离「被引用的措辞」——「不可据此说『资金面不参与打分』」「不是"…"」里的引号内容是在
//      警告读者别这么写，本身正确。直接删掉引号内文本再匹配，比用 lookbehind 更可靠
//      （lookbehind 在跨子句匹配时位置会错，实测漏判）。
const BAN_PHRASES = [
  /资金面[^。；]{0,24}不参与打分/,
  /资金面[^。；]{0,24}移出打分/,
  /资金面[^。；]{0,24}降为辅助模块[^。；]{0,8}不参与/,
];
const blameHits = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) continue;
  // 只看代码/模板文本，跳过注释行（注释里可能正是在说明「不能说资金面不参与打分」）
  const raw = readFileSync(abs, 'utf8');
  const codeOnly = raw.split('\n')
    .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))
    .join('\n')
    // 剥离反引号/中英文引号包裹的引用片段（纠正性引用，非断言）
    .replace(/[「『“‘][^」』”’]{0,40}[」』”’]/g, '〔引用〕')
    .replace(/[`][^`]{0,40}[`]/g, '〔引用〕');
  for (const re of BAN_PHRASES) {
    const g = new RegExp(re.source, 'g');
    for (const m of codeOnly.matchAll(g)) blameHits.push(`${rel} 命中「${m[0]}」`);
  }
}
check('文案守卫：源码不得出现「资金面不参与打分」类整体否定（与 s_net20 权重矛盾）',
  blameHits.length === 0, blameHits.join(' ; '));

// ── A3. 新股剔除的重复实现守卫 ──────────────────────────────────────────────
// 背景：s_net = tanh(净买/5)*50+50 在 5 亿量级近饱和，**一笔新股大额净买即可把因子推到近满分**
//       （2026-09-30：力勤资源 +5.04 亿 → 含新股 s_net 95.7 / 剔后 74.6，情绪分虚高 4.20 分，
//        并把结论从「满仓」推过 65 分档位线）。剔除必须只有一个出处：src/lhb.js 的 splitNewStockNet。
// 本守卫拦住两种回归：
//   ① 别处自顾自写一份「无价格涨跌幅限制」过滤（口径会漂移，且历史明细缺失时算错）；
//   ② summary 里有新股净买、却没把它喂给因子（即「只告警不修正」——本次修复前的状态）。
const NEW_RE_HITS = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) continue;
  if (rel === path.join('src', 'lhb.js')) continue;   // 唯一出处
  const raw = readFileSync(abs, 'utf8');
  // 允许注释里提到该诱因原文（说明性文字），只拦「正则/字符串字面量里真的在判它」
  const codeOnly = raw.split('\n')
    .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))
    .filter((ln) => !/NEW_STOCK_RE|isNewStock|无价格涨跌幅限制/.test(ln) || !/^\s*(\/\/)/.test(ln))
    .join('\n');
  if (/无价格涨跌幅限制/.test(codeOnly) && rel !== path.join('app.js')) {
    // app.js 例外：isNewStock 在那里只用于给「涨幅」列打「新股」徽标（展示），不参与打分
    NEW_RE_HITS.push(`${rel} 自行判定新股（应 import src/lhb.js 的 isNewStock/splitNewStockNet）`);
  }
}
check('新股判定无重复实现（唯一出处 src/lhb.js；app.js 仅限展示用徽标）',
  NEW_RE_HITS.length === 0, NEW_RE_HITS.join(' ; '));

// ── B. 存档逐日不变量 ────────────────────────────────────────────────────────
const arch = JSON.parse(readFileSync(ARCHIVE, 'utf8'));
const days = (arch.all_days || []).filter((d) => d && (d.lhb || []).length);
const bad = { missing: [], amt: [], stocks: [], range: [], replay: [], caliber: [], factor: [], sync: [], newstock: [] };
const near = (a, b, tol = 0.011) => a != null && b != null && Math.abs(a - b) <= tol;

for (const d of days) {
  const s = d.summary || {};
  const need = ['lhb_daily_net', 'lhb_daily_amt', 'lhb_daily_stocks', 'lhb_range_count', 'lhb_all_net'];
  const miss = need.filter((k) => s[k] == null);
  if (miss.length) bad.missing.push(`${d.trade_date}:${miss.join(',')}`);
  if (s.lhb_daily_amt != null && s.lhb_daily_net != null
    && s.lhb_daily_amt + 1e-6 < Math.abs(s.lhb_daily_net)) {
    bad.amt.push(`${d.trade_date} amt=${s.lhb_daily_amt} < |net|=${s.lhb_daily_net}`);
  }
  if (s.lhb_daily_stocks != null && s.lhb_daily_stocks < 1) bad.stocks.push(d.trade_date);
  const recDaily = (d.lhb || []).filter((l) => !isRangeBoard(l.reason)).length;
  if (s.lhb_range_count != null && s.lhb_count != null
    && s.lhb_range_count !== s.lhb_count - recDaily) {
    bad.range.push(`${d.trade_date} range=${s.lhb_range_count} 记录=${s.lhb_count} 当日记录=${recDaily}`);
  }
  // 可重现：现算必须与存档一致（否则说明被手改或口径漂移）
  const c = caliberFromDay(d);
  if (!near(c.daily_net_yi, s.lhb_daily_net) || !near(c.daily_amt_yi, s.lhb_daily_amt)
    || !near(c.all_net_yi, s.lhb_all_net)) {
    bad.replay.push(`${d.trade_date} 存档(${s.lhb_daily_net}/${s.lhb_daily_amt}/${s.lhb_all_net})`
      + ` vs 现算(${c.daily_net_yi}/${c.daily_amt_yi}/${c.all_net_yi})`);
  }
  // 聚合行必须带口径标签，且与 reason 自洽
  const dirty = (d.lhb_aggr || []).filter((l) => l.caliber !== 'daily' && l.caliber !== 'range');
  if (dirty.length) bad.caliber.push(`${d.trade_date}:${dirty.length} 行缺 caliber`);
  const mismatch = (d.lhb_aggr || []).filter((l) => l.caliber !== (isRangeBoard(l.reason) ? 'range' : 'daily'));
  if (mismatch.length) bad.caliber.push(`${d.trade_date}:${mismatch.length} 行 caliber 与 reason 不一致`);
  // 因子必须喂「当日榜 + 剔除新股」净额（这是整条链的口径锁）
  //   ① s_net 必须等于 tanh(剔新股净买/5)*50+50 —— 不是含新股的 lhb_daily_net；
  //   ② 若该日有新股净买，summary 必须留下证据链（否则就是「只告警不修正」回归）。
  const e = d.emotion || {};
  const ns = e.newStock || {};
  if (ns.adjusted && ns.netExNew != null && e.factors && e.factors.s_net != null) {
    const exp = Math.max(0, Math.min(100, Math.tanh(ns.netExNew / 5) * 50 + 50));
    if (Math.abs(exp - e.factors.s_net) > 0.05) {
      bad.factor.push(`${d.trade_date} s_net=${e.factors.s_net} 但剔新股净买=${ns.netExNew} 应为 ${exp.toFixed(1)}`);
    }
    // 证据链自洽：netRaw − newStockNet == netExNew
    if (ns.netRaw != null && ns.newStockNet != null
      && Math.abs(ns.netRaw - ns.newStockNet - ns.netExNew) > 0.011) {
      bad.newstock.push(`${d.trade_date} netRaw(${ns.netRaw}) − new(${ns.newStockNet}) ≠ netExNew(${ns.netExNew})`);
    }
    // summary 必须与 emotion 同源
    if (!near(s.lhb_new_net, ns.newStockNet)) {
      bad.newstock.push(`${d.trade_date} summary.lhb_new_net=${s.lhb_new_net} vs emotion=${ns.newStockNet}`);
    }
    if (!near(s.lhb_daily_ex_new_net, ns.netExNew)) {
      bad.newstock.push(`${d.trade_date} summary.ex_new=${s.lhb_daily_ex_new_net} vs emotion=${ns.netExNew}`);
    }
  }
  // 无新股的日子：s_net 应等于含新股净额算出的值（不被无谓改动）
  if (!ns.adjusted && e.lhb_daily_net != null && e.factors && e.factors.s_net != null) {
    const exp = Math.max(0, Math.min(100, Math.tanh(e.lhb_daily_net / 5) * 50 + 50));
    if (Math.abs(exp - e.factors.s_net) > 0.05) {
      bad.factor.push(`${d.trade_date} 无新股却 s_net=${e.factors.s_net} ≠ ${exp.toFixed(1)}`);
    }
  }
  // 只告警不修正的回归：有新股净买却完全没写证据链
  if (Math.abs(s.lhb_new_net || 0) > 0.001 && !ns.adjusted) {
    bad.newstock.push(`${d.trade_date} 有新股净买 ${s.lhb_new_net} 亿却没修正 s_net（只告警不修正回归）`);
  }
  if (!near(e.lhb_daily_net, s.lhb_daily_net)) bad.sync.push(`${d.trade_date} emotion=${e.lhb_daily_net} summary=${s.lhb_daily_net}`);
}

const summarize = (label, arr) => check(label, arr.length === 0, arr.slice(0, 3).join(' ; '));
check('样本天数（含龙虎榜原始记录）', days.length > 0, `${days.length} 天`);
summarize('双口径字段齐全', bad.missing);
summarize('成交额 ≥ |净额|（买+卖 ≥ |买−卖|）', bad.amt);
summarize('当日榜至少 1 只', bad.stocks);
summarize('区间榜条数 = 全部记录 − 当日榜记录', bad.range);
summarize('双口径可重现（现算 == 存档）', bad.replay);
summarize('聚合行 caliber 标签齐备且与 reason 自洽', bad.caliber);
summarize('因子 s_net 锁「当日榜 + 剔除新股」净额', bad.factor);
summarize('emotion 与 summary 的当日榜净额一致', bad.sync);
summarize('新股剔除证据链自洽（netRaw − new == netExNew；有新股必留痕，禁止只告警不修正）', bad.newstock);

// ── B2. 封板率口径守卫 ─────────────────────────────────────────────────────
// 历史 bug：字段名 zbl_pct 与存储值语义相反（存的是封板率 zt/(zt+zb)，报告按炸板率渲染并取补），
// 导致 2026-09-30 把 81.3% 的封板率显示成「炸板率 18.8%」。这里锁死三件事：
//   ① seal_pct 必须 = zt/(zt+zb)×100（市场通用封板率口径，分母为触板个股）
//   ② seal_pct + zb_pct 必须 = 100（互补，同一分母）
//   ③ 报告端不得再把该值当炸板率渲染（源码守卫）
const badSeal = [];
for (const d of days) {
  const s = d.summary || {};
  const { zt_count: zt, zb_count: zb, seal_pct: seal, zb_pct: zbp, seal_den: den } = s;
  if (zt == null || zb == null) continue;
  if (den != null && den !== zt + zb) badSeal.push(`${d.trade_date} seal_den=${den} ≠ zt+zb=${zt + zb}`);
  if (seal != null) {
    const expect = Math.round((zt / (zt + zb)) * 1000) / 10;
    if (!near(seal, expect)) badSeal.push(`${d.trade_date} seal_pct=${seal} ≠ zt/(zt+zb)=${expect}`);
  }
  if (seal != null && zbp != null && !near(seal + zbp, 100)) badSeal.push(`${d.trade_date} seal_pct+zb_pct=${seal + zbp} ≠ 100`);
}
summarize('封板率口径 = 收盘涨停 ÷ 盘中触板（zt/(zt+zb)），且与炸板率互补为 100', badSeal);

// 源码守卫：报告端不得再出现「炸板率 ${…zbl…}%（…封板率 100−…）」这种把封板率当炸板率的渲染式
{
  const appRaw = readFileSync('app.js', 'utf8');
  const inverted = /炸板率\s*\$\{[^}]*zbl[^}]*\}[\s\S]{0,120}?100\s*-\s*zbl/.test(appRaw);
  check('报告端不再把封板率当炸板率渲染（禁止「炸板率 X%（…100−X）」式）', !inverted,
    'app.js 仍存在把 zbl_pct 当炸板率并取补的渲染');
  // 源码守卫：连板天梯数字必须来自 zt_lb（不得硬编码）
  const hardcoded = /最高\s*7\s*板|2\s*板以上\s*12\s*只/.test(appRaw);
  check('连板天梯数字不硬编码（一律取自 summary.zt_lb）', !hardcoded, 'app.js 出现硬编码连板数');
}

// ── C. 结论 ────────────────────────────────────────────────────────────────
if (warns.length) for (const w of warns) console.log(`⚠ ${w}`);
if (fails.length) {
  console.error(`\n[audit-lhb-caliber] 失败 ${fails.length} 项：${fails.join('、')}`);
  console.error('提示：若为存档问题，用 node scripts/recalc_lhb_daily.mjs 全档重算；若为源码问题，禁止自行相加，走 src/lhb.js。');
  process.exit(1);
}
console.log(`\n[audit-lhb-caliber] 通过：${days.length} 个交易日、双口径可重现、因子锁定当日榜口径。`);
