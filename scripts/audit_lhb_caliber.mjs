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

// ── B3. 席位明细「类别汇总行」污染守卫 ────────────────────────────────────────
// 历史 bug（2026-09-30 实测，真 bug）：东财席位明细接口对部分票（尤其区间累计榜）会返回
// 「自然人/中小投资者/机构/其他自然人」这类**投资者结构汇总行**——它们不是席位，金额与整票
// 成交额同阶。被 classifySeat 归成 hot（游资）后：
//   · 游资买入被虚增 192.77 亿（77.56 → 270.33）；
//   · 全市场买方合计从 139.67 亿抬到 332.44 亿，买方头部3席位集中度 44.5% → 18.7%（错一个量级档）；
//   · 个股层面 近岸蛋白 集中度虚高至 80.1% 并挤进 TOP5（真值 79.3% 的联泰环保才该上榜）。
// 这里锁死三件事：
//   ① 存档 seats.detail 里不得再出现这些类别汇总行（净化后落盘）；
//   ② 净化的唯一出处是 src/seats.js::isAggregateSeatRow，别处不得另写判别式；
//   ③ cons_top / buy_top3_pct 必须能由（净化后的）detail 逐笔复算出来（防手工改数）。
const AGG_NAMES = ['自然人', '机构', '中小投资者', '其他自然人', '其他机构', '专业机构', '个人投资者'];
const badAgg = [];
for (const d of days) {
  const det = d.summary?.seats?.detail;
  if (!det) continue;
  for (const [code, raw] of Object.entries(det)) {
    const rows = Array.isArray(raw) ? raw : [...(raw.b || []), ...(raw.s || [])];
    const hit = rows.filter(([nm]) => AGG_NAMES.includes(String(nm || '').trim()));
    if (hit.length) badAgg.push(`${d.trade_date} ${code} 含汇总行 ${hit.map(([n]) => n).join('/')}`);
  }
}
summarize('席位明细已净化（不含「自然人/中小投资者/机构」类投资者结构汇总行）', badAgg);

// 源码守卫：净化判据只在 src/seats.js 出现一次，别处必须 import。
// 注意：① 只查**代码**，文案/口径备注里提到这些词是合理的（报告要解释剔了什么）；
//       ② 跳过临时探针脚本（_ 前缀）与本审计自身——它们本来就是来复现/检查这件事的。
{
  const GLOBAL = files.filter((f) => !/seats\.js$/.test(f)
    && !/audit_lhb_caliber\.mjs$/.test(f)
    && !/(^|\/)_/.test(f));
  const dup = [];
  for (const rel of GLOBAL) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;
    // 去掉注释行与「口径备注/文案」类字符串行，避免把解释性文字误判为实现
    const code = readFileSync(abs, 'utf8').split('\n')
      .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))
      .filter((ln) => !/口径备注|muted|const foot|口径：/.test(ln))
      .join('\n');
    // 判据实现的特征：出现这些词 **且** 用在过滤/集合成员判断里
    if (/中小投资者/.test(code) && /(filter|has\(|Set\(|includes)/.test(code)) {
      dup.push(`${rel} 自行实现了汇总行判别式（应 import src/seats.js）`);
    }
  }
  check('席位汇总行判据唯一出处（src/seats.js::isAggregateSeatRow，别处不得重复实现）', dup.length === 0, dup.join(' ; '));
}

// ── B4. 题材「昨日新晋存活率」口径守卫 ───────────────────────────────────────
// 历史 bug：报告用「今日 fresh 名单」比「昨日 themes 存在性」——语义变成「今日新晋在昨日是否已存在」，
// 而新晋的定义就是昨日不存在，逻辑自相矛盾、得数无意义（2026-09-30 实测 9/17=53% 看似合理）。
// 正确口径：昨日视角新晋名单（引擎重算的 signals.momentum.prev_fresh）→ 今日 themes 是否仍存在。
// 这里锁两件事：① 存档 momentum 必须带 prev_fresh（引擎留痕，报告不得自行现算昨日名单）；
//              ② 报告的存活率必须读 prev_fresh（源码守卫）。
const badMom = [];
const momSig = arch.signals?.momentum;
if (!momSig) badMom.push('signals.momentum 缺失');
else {
  if (!Array.isArray(momSig.prev_fresh)) badMom.push('momentum.prev_fresh 缺失（昨日新晋名单无留痕）');
  if (!Array.isArray(momSig.prev_continuing)) badMom.push('momentum.prev_continuing 缺失');
  if (!Array.isArray(momSig.prev_fading)) badMom.push('momentum.prev_fading 缺失');
}
const latestThemes = days[days.length - 1]?.themes || {};
if (Array.isArray(momSig?.prev_fresh) && momSig.prev_fresh.length) {
  // 存活率必须落在 [0,100]，且可按「今日 themes 是否含该题材」复算
  const alive = momSig.prev_fresh.filter((t) => (latestThemes[t] || 0) > 0);
  const pct = Math.round(alive.length / momSig.prev_fresh.length * 100);
  if (!(pct >= 0 && pct <= 100)) badMom.push(`存活率越界 ${pct}%`);
  console.log(`  · 昨日新晋 ${momSig.prev_fresh.length} → 今日存活 ${alive.length}（${pct}%）`);
}
summarize('题材动量留痕：momentum.prev_fresh 存在，存活率可同源复算', badMom);

// 源码守卫：报告的存活率必须取 prev_fresh，不得用今日 fresh 比昨日 themes
{
  const appRaw = readFileSync('app.js', 'utf8');
  const wrongAlgo = /mom\.fresh[\s\S]{0,200}?p\.themes\[/.test(appRaw);
  check('报告存活率取「昨日视角新晋名单」(prev_fresh)，非用今日 fresh 比昨日 themes', !wrongAlgo,
    'app.js 仍存在「今日 fresh 比昨日 themes」的错误存活率算法');
}

// ── B4b. 口径披露完整性守卫（题材 / 锁仓 / 集中度） ──────────────────────────
// 这三类指标都**不是交易所官方口径**，全部由本系统自定义（题材标签）或按特定样本推算
// （锁仓样本、集中度分母）。若报告只给数字不给口径，读者会把它当成可与行情软件直接对表的
// 官方统计——那是最容易被误用的一类输出。故锁死：报告脚注必须逐条写到「怎么算的」。
// 判据用「关键词共现」，不锁具体措辞（措辞可以改，口径说明不能删）。
{
  const appRaw = readFileSync('app.js', 'utf8');
  // 取口径备注那一整段（bf-foot）作为检查域，避免正文里偶然提到某个词就算通过
  const footM = appRaw.match(/const foot = `<div class="bf-foot">([\s\S]*?)<\/div>`;/);
  const foot = footM ? footM[1] : '';
  check('报告存在口径备注段落（bf-foot）', foot.length > 500, `长度 ${foot.length}`);
  const need = [
    ['题材口径披露', /题材/.test(foot) && /(无官方|自定义|平台间|不同平台)/.test(foot)],
    ['锁仓口径披露', /锁仓/.test(foot) && /(买方席位|近2日|连续上榜)/.test(foot)],
    ['集中度口径披露', /集中度/.test(foot) && /(前3席位|头部3|剔除.*汇总行|汇总行)/.test(foot)],
    ['席位样本 vs 当日榜 不可互验', /(不可相互校验|不可互相校验)/.test(foot) && /当日榜/.test(foot)],
  ];
  for (const [label, ok] of need) check(`口径披露：${label}`, ok, ok ? '' : '报告脚注缺失该项口径说明');
}

// ── B4c. 席位样本 ≠ 当日榜样本（两个口径物理上不可互验） ─────────────────────
// 席位明细与锁仓统计覆盖「当日有席位明细的全部上榜个股」（含区间累计榜个股——它们当日无独立
// 日榜，但明细仍在披露名单内），只数必然 ≥ 当日榜家数（实测 2026-09-30：席位样本 66 只 /
// 当日榜 56 只）。若某天席位样本 < 当日榜家数，说明采集把区间榜明细丢了，会让「席位净买 vs
// 当日榜净买」被误当成可对的账。故锁死：席位样本 ≥ 当日榜家数。
//
// 字段名以存档实际为准（曾按 stock_count / seats.count 猜错，两者都不存在）：
//   · 当日榜家数 → summary.lhb_daily_stocks
//   · 席位样本数 → summary.seats.universe_n（并应与 seats.detail 的键数一致）
{
  const badCov = [];
  const badDetail = [];
  let eqDays = 0;
  for (const d of days) {
    const s = d.summary || {};
    const daily = s.lhb_daily_stocks ?? null;
    const seatN = s.seats?.universe_n ?? null;
    const detN = s.seats?.detail ? Object.keys(s.seats.detail).length : null;
    if (daily == null || seatN == null) continue;
    if (seatN < daily) badCov.push(`${d.trade_date} 席位样本 ${seatN} < 当日榜 ${daily}（区间榜明细可能被丢弃）`);
    if (seatN === daily) eqDays++;
    // universe_n 必须等于明细实际只数——不等说明统计口径与落盘明细脱节
    if (detN != null && detN !== seatN) badDetail.push(`${d.trade_date} seats.universe_n=${seatN} ≠ detail 只数=${detN}`);
  }
  summarize('席位样本 ≥ 当日榜家数（区间榜明细未丢失；二者不可互验）', badCov);
  summarize('席位样本数 = 明细实际只数（universe_n 与落盘明细一致）', badDetail);

  // 报告必须显式声明二者不可互验——否则读者会拿「席位分项之和」去除「当日榜净买」对账
  const appRaw = readFileSync('app.js', 'utf8');
  const declared = /不可相互校验|不可互相校验/.test(appRaw);
  check('报告显式声明「席位分项之和 vs 当日榜净买」不可互验（含样本相等的情形）',
    declared, declared ? `样本相等的天数 ${eqDays}` : 'app.js 未声明不可互验');
}

// ── B4d. 锁仓口径守卫：字段必须来自「跨日席位比对」，不得凭空出现 ────────────
// 锁仓/新进资金占比由「当日买方席位 vs 近2日同票买方席位」比对得出（见 app.js lockLine）。
// src/lhbfilter.js 里那条「锁仓资金占当日买入 ≥30%」因**存档无锁仓字段**而留痕跳过——
// 这是用户确认的口径决策。若哪天存档凭空冒出 summary.lock 字段、而席位明细并未支持跨日比对，
// 说明有人在用单日数据伪造「锁仓」概念（会得出虚高的持续性结论）。
// 这里锁死：锁仓统计必须以 seats.detail 为原料，且 lhbfilter 的跳过留痕必须保留。
{
  const appRaw = readFileSync('app.js', 'utf8');
  // ① 锁仓统计必须从席位明细推导（出现 lock 计算且引用了 seats/detail/买方席位）
  const lockCalcOk = /lock\s*=/.test(appRaw) && /(seats|detail|买方|buySeats)/.test(appRaw);
  check('锁仓统计以席位明细为原料（跨日买方席位比对，非单日杜撰）', lockCalcOk,
    lockCalcOk ? '' : 'app.js 未见锁仓统计的席位来源');

  // ② lhbfilter 的「锁仓资金占比」必须仍在 skipped 留痕里（数据不足不得静默当成通过）
  const filterSrc = readFileSync('src/lhbfilter.js', 'utf8');
  const lockSkipped = /LOCKUP_RATIO/.test(filterSrc) && /SKIPPED_RULES/.test(filterSrc) && /skipped\.push/.test(filterSrc);
  check('lockup 规则留痕跳过（存档无锁仓字段 → 不得静默参与拦截）', lockSkipped,
    lockSkipped ? '' : 'src/lhbfilter.js 缺 LOCKUP_RATIO 留痕');

  // ③ 若存档真有 lock 字段，必须带「怎么算的」的说明，不允许裸数字
  const nakedLock = days.filter((d) => {
    const lk = d.summary?.lock;
    return lk != null && typeof lk === 'object' && lk.pct != null && lk.n == null && lk.win == null;
  }).map((d) => d.trade_date);
  check('存档锁仓字段（若有）必须带样本量与窗口（不允许裸占比）', nakedLock.length === 0,
    nakedLock.length ? `${nakedLock.length} 天存在无法核验的裸锁仓占比` : '存档无 lock 字段（留痕跳过，符合预期）');
}

// ── B4e. 因子分解随题材指标联动（scoreTheme 必须消费 surv） ──────────────────
// 因子分解里的「题材结构」分（scoreTheme）以昨日新晋存活率 surv 为输入之一。若有人把它从
// 签名里去掉、或另接一个不同口径的存活率，「题材结构分」就会与 §⑤ 展示的存活率脱节——
// 页面显示存活率骤降为 20%，因子分解却毫无反应，读者会以为题材风险未传导到情绪分。
// 这里锁两件事：① scoreTheme 签名保留 surv 形参；② 调用点把 surv（由 prev_fresh 算出）传进去。
{
  const appRaw = readFileSync('app.js', 'utf8');
  const sigOk = /function\s+scoreTheme\s*\([^)]*\bsurv\b[^)]*\)/.test(appRaw);
  const usesSurv = /if\s*\(\s*surv\s*\)\s*s\s*\+=/.test(appRaw);
  const callM = appRaw.match(/const\s+scT\s*=\s*scoreTheme\(([^)]*)\)/);
  const callArgs = callM ? callM[1] : '';
  const callOk = /\bsurv\b/.test(callArgs);
  // surv 必须由 prev_fresh 算出（不得改用今日 fresh 或其它源）
  const survFromPrev = /const\s+surv\s*=\s*\(\(\)\s*=>\s*\{[\s\S]{0,400}?mom\.prev_fresh/.test(appRaw);
  check('因子分解随题材指标联动：scoreTheme 以 surv（prev_fresh 口径）为输入',
    sigOk && usesSurv && callOk && survFromPrev,
    `sig=${sigOk} use=${usesSurv} call=${callOk}(${callArgs.trim()}) fromPrev=${survFromPrev}`);
}

// ── B5. V5.2-pro 交易规则唯一出处守卫 ────────────────────────────────────────
// 规则（用户给定）一旦在别处被重新实现，就会出现「页面按 A 阈值过滤、引擎按 B 阈值下单」的分裂——
// 那会让模拟结果彻底失去可核验性。这里锁三件事：
//   ① 龙虎过滤阈值（25% / 75% / 80% / 4%）只出现在 src/lhbfilter.js；
//   ② 风控阈值（20% 单日变动 / 9%·15% 回撤档位 / −8% 止损）只出现在 src/paper.js；
//   ③ 买入委托必须以龙虎过滤为前置（paper.js 确实 import 并调用了 filterOne）。
{
  // 判据：只有「阈值数字 + 规则语义词」同时出现才算重复实现。
  // 单纯出现 0.25 / 0.20 / -0.08 不算——它们在别处有完全无关的用途（回撤曲线、权重、涨跌幅等），
  // 盲扫数字必然误报（实测 app.js 因图表阈值被误判）。故要求同一条代码行上出现规则语义词。
  //
  // 第二道判据（**引用 ≠ 重复实现**）：即便语义词命中，也要区分该行是「读取引擎常量」还是
  // 「在本地重新定义这个阈值」。UI 层正确做法恰恰是 import 引擎常量再 * 100 显示，
  // 若把这种读取也判为违规，守卫就变成了「逼 UI 手抄数字」——与它想保护的纪律完全相反。
  // 因此：定义形态（`NAME = 0.20` / `NAME: 0.20` / `const NAME = 0.2`）才算重复实现；
  // 读取形态（`NAME * 100`、`${NAME}`、`NAME`、`Math.abs(NAME)`）一律放行。
  const RULES = [
    { label: '龙虎净买占比上限 25%', owner: 'src/lhbfilter.js',
      re: /(SHARE_TOO_HIGH|share_of_market|占当日全市场|占全市场龙虎|MARKET_SHARE)/ },
    { label: '买方前三集中度 75%', owner: 'src/lhbfilter.js',
      re: /MAX_TOP3_CONC|top3Conc|buy_top3_pct\s*[<>]=?\s*7[05]/ },
    { label: '单日仓位变动 20%', owner: 'src/paper.js',
      re: /MAX_DAILY_POSITION_CHANGE|dailyPositionChange|单日账户仓位变动|单日仓位变动/ },
    { label: '回撤降仓档位 9%/15%', owner: 'src/paper.js',
      re: /DD_TIERS|ddTier|ddTriggerCap|回撤\s*[≥>]=?\s*(9|15)/ },
    { label: '止损线 −8%', owner: 'src/paper.js',
      re: /HARD_STOP_LOSS|scanStopLoss\s*\(|硬性止损/ },
  ];
  // 是否为「本地重定义」（= 重复实现）：常量/字段名后紧跟赋值，且右侧是字面量数字。
  // 反例（应放行）：`MAX_DAILY_POSITION_CHANGE * 100`、`MAX_DAILY_POSITION_CHANGE,`（import 解构）、
  //                 `${HARD_STOP_LOSS}`、`const TODAY = todayBuy`（非字面量）。
  const isRedefinition = (ln) => {
    const NAME = '(?:SHARE_TOO_HIGH|MAX_TOP3_CONC|MAX_TOP3_CONC_STRICT|MAX_DAILY_POSITION_CHANGE|DD_TIERS|HARD_STOP_LOSS|dailyPositionChange|ddTriggerCap)';
    // ① NAME = <数字> / NAME: <数字> / const NAME = <数字>
    const literal = new RegExp(`(?:const|let|var)?\\s*${NAME}\\s*[:=]\\s*-?\\d`);
    // ② 内联阈值写法：top3 集中度直接写 70/75、回撤直接写 9/15
    const inline = /(?:top3Conc|buy_top3_pct|回撤|dd)\s*[<>]=?\s*0?\.?\d/;
    return literal.test(ln) || inline.test(ln);
  };
  // 扫描 UI 层与其它 src 文件，确认这些语义标识没有在「唯一出处」之外被重写
  const scanFiles = ['paper_ui.js', 'app.js', ...readdirSync('src').filter((f) => f.endsWith('.js')).map((f) => `src/${f}`)];
  const dupRules = [];
  for (const rel of scanFiles) {
    if (rel === 'src/lhbfilter.js' || rel === 'src/paper.js') continue;   // 这两个是唯一出处
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;
    // 只保留非注释代码行；且要求该行确实在「赋值/比较/常量定义」语境里
    const lines = readFileSync(abs, 'utf8').split('\n')
      .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))
      // 排除「回测参数展示」行：app.js 渲染的是 backtest.json 里记录的回测参数（v52p/BT.params），
      // 与模拟盘的规则是两套东西（回测用历史参数复现，模拟盘用当前规则）。展示它们不算重复实现。
      .filter((ln) => !/BT\.params|v52p|v52\s*=|回测参数/.test(ln))
      // 排除纯文案行（含「口径备注」等解释性文字）
      .filter((ln) => !/口径备注|口径：/.test(ln))
      .filter((ln) => /(=|===|==|>=|<=|>|<|:|const|let|var)/.test(ln));
    for (const r of RULES) {
      const hit = lines.find((ln) => r.re.test(ln) && isRedefinition(ln));
      if (hit) dupRules.push(`${rel} 疑似重复实现「${r.label}」：${hit.trim().slice(0, 60)}`);
    }
  }
  check('V5.2-pro 规则阈值不在唯一出处之外被重复实现', dupRules.length === 0, dupRules.slice(0, 3).join(' ; '));

  // paper.js 必须把龙虎过滤作为买入前置（import + 在批量买入里调用）
  const engineSrc = readFileSync('src/paper.js', 'utf8');
  const importsFilter = /import\s*\{[\s\S]*?filterOne[\s\S]*?\}\s*from\s*'\.\/lhbfilter\.js'/.test(engineSrc);
  const callsFilter = /filterOne\s*\(/.test(engineSrc) && /bucket\s*!==\s*'main'|bucket\s*===\s*'main'/.test(engineSrc);
  check('买入委托以龙虎榜前置过滤为闸门（paper.js import 并在批量买入中调用 filterOne）',
    importsFilter && callsFilter,
    `import=${importsFilter} call=${callsFilter}`);

  // 因数据不足而跳过的规则必须留痕（不得静默忽略）
  const filterSrc = readFileSync('src/lhbfilter.js', 'utf8');
  const hasSkip = /SKIPPED_RULES/.test(filterSrc) && /skipped\.push/.test(filterSrc);
  check('数据不足的规则必须留痕（skipped 数组），不得静默忽略', hasSkip, `hasSkip=${hasSkip}`);
}

// ── C. 结论 ────────────────────────────────────────────────────────────────
if (warns.length) for (const w of warns) console.log(`⚠ ${w}`);
if (fails.length) {
  console.error(`\n[audit-lhb-caliber] 失败 ${fails.length} 项：${fails.join('、')}`);
  console.error('提示：若为存档问题，用 node scripts/recalc_lhb_daily.mjs 全档重算；若为源码问题，禁止自行相加，走 src/lhb.js。');
  process.exit(1);
}
console.log(`\n[audit-lhb-caliber] 通过：${days.length} 个交易日、双口径可重现、因子锁定当日榜口径。`);
