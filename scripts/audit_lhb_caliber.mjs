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
import { caliberFromDay, isRangeBoard, duplicateKeys } from '../src/lhb.js';

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

// ── A4. 同票多榜去重的唯一出处守卫 ──────────────────────────────────────────
// 背景：东财同一次披露里，同票多榜且**数值常完全相同**（2026-08-14 蓝盾光电 300862：两条净额都是
//       37382.3 万，只有上榜原因不同）。lhb 原始数组是 picks / paper / lhbfilter / fetch_universe
//       的共同入口，任何按 code 求和都会双算。去重判据必须只有一个出处：
//       src/lhb.js::mergeDuplicateRecords（五元组 code+is_range+净额+买+卖）。
// 本守卫拦三件事：
//   ① 装配层（sources.js）漏了合并 —— "改了 normalizeRecord 却忘了在 buildLhbPart 里合并" 是头号回归；
//   ② 别处另写一份「去重 / 相同记录合并」判别式（口径会漂移，五元组字段少一个就漏合并）；
//   ③ mergeDuplicateRecords 被删或被改名（下游 import 会静默变成 undefined 而不报错）。
{
  const lhbSrc = readFileSync(path.join('src', 'lhb.js'), 'utf8');
  check('同票去重唯一出处：src/lhb.js 导出 mergeDuplicateRecords 与 duplicateKeys',
    /export function mergeDuplicateRecords\s*\(/.test(lhbSrc) && /export function duplicateKeys\s*\(/.test(lhbSrc),
    '');
  // 判据必须是五元组（少一个字段就会把"数值不同的同票"错误合并，等于在两种口径间凭空二选一）
  check('同票去重判据为五元组（code + is_range + 净额 + 买 + 卖），不是只按 code',
    /MERGE_KEY_FIELDS\s*=\s*\[\s*'is_range'\s*,\s*'net_buy_wan'\s*,\s*'buy_wan'\s*,\s*'sell_wan'\s*\]/.test(lhbSrc),
    '未找到 MERGE_KEY_FIELDS 五元组定义');

  const srcSrc = readFileSync(path.join('src', 'sources.js'), 'utf8');
  const importsMerge = /import\s*\{[^}]*mergeDuplicateRecords[^}]*\}\s*from\s*'\.\/lhb\.js'/.test(srcSrc);
  // 判据按「buildLhbPart 函数体内确实调用了 mergeDuplicateRecords」而非固定字符串形态——
  // 固定形态（如 `mergeDuplicateRecords(lhbRaw.map(normalizeRecord))`）会被正常重构打断，
  // 让守卫变成"必须保持某种写法"，与它想保护的口径纪律无关。
  //
  // ⚠ src/sources.js 是 CRLF。先归一化行尾，再按顶层 `}` 收口函数体——
  //   早先用「下一个 \nfunction 」定位函数尾，但 buildLhbPart 与 applyLhb 之间夹着大段注释与
  //   const 声明，位置会漂到很远（实测 span 6674 字符），把邻函数的调用也收进来 → 断言恒真。
  //   改为：从函数起点往后找第一个「行首 `}`」作为结束。
  const srcSrcNorm = srcSrc.replace(/\r\n/g, '\n');
  const bpStart = srcSrcNorm.indexOf('function buildLhbPart(');
  const bpTail = bpStart < 0 ? '' : srcSrcNorm.slice(bpStart);
  const bpClose = bpTail.search(/\n\}/);
  const bpBody = bpStart < 0 ? '' : (bpClose < 0 ? bpTail : bpTail.slice(0, bpClose + 2));
  // 判据用「引用了 normalizeRecord / mergeDuplicateRecords」而非「调用形态」：
  //   `lhbRaw.map(normalizeRecord)` 是**作为回调传入**（没有紧跟的 `(`），
  //   用 `normalizeRecord\s*\(` 会漏判成未使用（本守卫第一版就栽在这里）。
  const callsMerge = /\bmergeDuplicateRecords\b/.test(bpBody);
  const callsNormalize = /\bnormalizeRecord\b/.test(bpBody);
  check('装配层已合并：src/sources.js::buildLhbPart 走 normalizeRecord → mergeDuplicateRecords',
    importsMerge && callsMerge && callsNormalize,
    `import=${importsMerge} normalize=${callsNormalize} merge=${callsMerge}`);

  // 别处不得自行比较「两条记录是否相同」来实现去重（合法做法一律 import src/lhb.js）
  const dupImpl = [];
  for (const rel of files) {
    if (rel === path.join('src', 'lhb.js')) continue;
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const code = readFileSync(abs, 'utf8').split('\n')
      .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');
    // 特征：同一段代码里既比较 net_buy_wan 又比较 buy_wan（= 在实现"同值合并"）
    if (/net_buy_wan\s*===\s*\w+\.net_buy_wan/.test(code) && /buy_wan\s*===\s*\w+\.buy_wan/.test(code)
      && !/mergeDuplicateRecords|duplicateKeys/.test(code)) {
      dupImpl.push(`${rel} 自行实现了同票同值去重（应 import src/lhb.js）`);
    }
  }
  check('同票同值去重不在唯一出处之外重复实现', dupImpl.length === 0, dupImpl.join(' ; '));

  // 下游恒等式守卫：range_count 必须 = lhb_count − 当日榜记录数（两者都取合并后）
  const calSrc = lhbSrc.slice(lhbSrc.indexOf('export function caliberFromDay'));
  check('caliberFromDay 不再依赖原始 lhb 行数（改为由 lhb_daily_aggr + lhb_aggr 现算）',
    !/total_records:\s*Array\.isArray\(day\?\.lhb\)\s*\?\s*day\.lhb\.length/.test(calSrc),
    'caliberFromDay 仍用 day.lhb.length 当 total_records');
}

// ── B. 存档逐日不变量 ────────────────────────────────────────────────────────
const arch = JSON.parse(readFileSync(ARCHIVE, 'utf8'));
const days = (arch.all_days || []).filter((d) => d && (d.lhb || []).length);
const bad = { missing: [], amt: [], stocks: [], range: [], replay: [], caliber: [], factor: [], sync: [], newstock: [], merge: [] };
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
  // 区间条数恒等式：以**合并后**的记录数为基准。
  //   历史坑：早先这里用 `d.lhb.filter(!isRangeBoard).length` 数原始数组，而 lhb_count 已经过
  //   mergeDuplicateRecords 合并，同票多榜的天（2026-08-14 蓝盾光电 300862 出现两次）两边不相等，
  //   审计会误报「区间条数 ≠ 全部 − 当日」。现在两个数都取自同一份**合并后**数据：
  //     当日榜记录数 = 存档 lhb（已合并）里 is_range=false 的条数
  //   为什么不用 lhb_daily_aggr：它是**内存态**字段，落盘时被丢弃（见 pipeline 输出结构），
  //   审计读不到它；而合并后的 lhb 数组与 lhb_daily_aggr 在「当日榜条数」上是同源的
  //   （lhb_daily_aggr 正是 aggregateByCode(merged.filter(!is_range))，只少了同票合并那一步，
  //    而合并后的 lhb 里同票当日榜仍可能多条但值不同 → 故此处用 lhb_daily_aggr 条数不等的天数更少）。
  const recDailyMerged = (d.lhb || []).filter((l) => !(l.is_range != null ? l.is_range : isRangeBoard(l.reason))).length;
  if (s.lhb_range_count != null && s.lhb_count != null
    && s.lhb_range_count !== s.lhb_count - recDailyMerged) {
    bad.range.push(`${d.trade_date} range=${s.lhb_range_count} 记录=${s.lhb_count} 当日记录=${recDailyMerged}`);
  }
  // 重复披露留痕自洽：lhb_count + merged_away 必须等于东财原始条数 lhb_raw_count
  //   （存量老数据没有 raw_count 字段 → 跳过，不构成失败）
  if (s.lhb_raw_count != null && s.lhb_merged_away != null
    && s.lhb_raw_count - s.lhb_merged_away !== s.lhb_count) {
    bad.merge.push(`${d.trade_date} raw=${s.lhb_raw_count} − 合并=${s.lhb_merged_away} ≠ count=${s.lhb_count}`);
  }
  // 原始 lhb 数组内部不得再有「五元组完全相同」的重复（mergeDuplicateRecords 失效即在此暴露）
  const dupKeys = duplicateKeys(d.lhb || []);
  if (dupKeys.length) bad.merge.push(`${d.trade_date} lhb 仍在重复：${dupKeys.slice(0, 3).join(' | ')}`);
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
summarize('区间榜条数 = 全部记录 − 当日榜记录（均以合并后条数为准）', bad.range);
summarize('同票多榜重复披露已合并（lhb 五元组唯一；raw − 合并 ≠ count 即回归）', bad.merge);
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
      .filter((ln) => !/口径备注|muted|const foot|const footBody|口径：|cal\(|bf-cal-body/.test(ln))
      .join('\n');
    // 判据实现的特征：**同一段代码窗口内**把汇总行名称用于过滤/集合成员判断。
    // 收敛过程（两次实测）：
    //   · 「两词全文共现」→ 被无关的 .filter(Boolean) + 文案里的「中小投资者」误触发
    //     （改报告排版都能把它打红，守卫成了噪音）；
    //   · 「两词同一行」→ 漏判「名单放数组常量、下一行才 filter」这种真实复现（实测未拦下）。
    // 故取 ±6 行窗口：名单字面量与成员判断邻近即视为重复实现。
    const AGG_LITERAL = /['"`][^'"`]*中小投资者/;
    const MEMBERSHIP = /(\.filter\s*\(|\.some\s*\(|\.has\s*\(|new\s+Set\s*\(|\.includes\s*\()/;
    const lines = code.split('\n');
    let dupAt = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!AGG_LITERAL.test(lines[i])) continue;
      const win = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
      if (MEMBERSHIP.test(win)) { dupAt = i; break; }
    }
    if (dupAt >= 0) {
      dup.push(`${rel} 自行实现了汇总行判别式（应 import src/seats.js）：${lines[dupAt].trim().slice(0, 70)}`);
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
  // 取口径备注那一整段作为检查域，避免正文里偶然提到某个词就算通过。
  // 注意：模板③改造后口径从「<div class="bf-foot">…</div>」搬进了
  // 「文末独立折叠附录 <details class="bf-appendix">…<div class="bf-cal-body">…</div>」，
  // **文字内容一字未改**；故这里用兼容两种形态的提取，而不是把守卫删掉。
  const footM = appRaw.match(/const footBody = `([\s\S]*?)`;/)
    || appRaw.match(/const foot = `<div class="bf-foot">([\s\S]*?)<\/div>`;/);
  const foot = footM ? footM[1] : '';
  check('报告存在口径备注段落（口径附录正文）', foot.length > 500, `长度 ${foot.length}`);
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

  // ── A5. 降级规则（龙虎榜净买入 ≤ 0）的处置守卫 ───────────────────────────────
  // 用户裁定：**不禁止委托** / 扣固定分 / 打告警标签 / 人工复核后才允许下单。
  // 这四条里最容易被后续改动破坏的是第①条——因为「净买 ≤ 0」历史上就在
  // REJECT_LHB 的强制剔除清单里，任何人「顺手清理」都可能把它 push 回 rejectedBy，
  // 于是规则悄悄从「降级」退回「禁止」，而测试若不覆盖就无人察觉。故单列守卫。
  {
    // ① 不得把「净买 ≤ 0」写回强制剔除（rejectedBy / REJECT_LHB 里不得有它）
    const rejectBlock = (filterSrc.match(/export const REJECT_LHB\s*=\s*\{[\s\S]*?\n\};/) || [''])[0];
    check('降级：净买≤0 不得写回 REJECT_LHB 强制剔除清单',
      rejectBlock.length > 0 && !/净买\s*[≤<]|net_buy.*non_positive|NET_BUY_NON_POSITIVE/i.test(rejectBlock),
      'REJECT_LHB 中出现了净买≤0 的描述');
    // ② 该判据在 filterOne 里必须走 flag 而非 push（push 进 rejectedBy 即等于禁止委托）
    const noPush = /const\s+netOutflow\s*=/.test(filterSrc)
      && !/push\(\s*['"]NET_BUY_NON_POSITIVE/.test(filterSrc);
    check('降级：净买≤0 走 flag 不走 push(rejectedBy)（push 即等于禁止委托）', noPush,
      `flag=${/const\s+netOutflow\s*=/.test(filterSrc)} push=${/push\(\s*['"]NET_BUY_NON_POSITIVE/.test(filterSrc)}`);
    // ③ 桶判定必须保持「!passed 优先于 netOutflow」——否则降级会给其他强制剔除开后门。
    //
    //    判据必须基于**代码结构**而不是 indexOf：把 netOutflow 分支提到前面时，
    //    字符串里 `if (!passed)` 的位置其实没变（我第一版就是这么写的，负向验证没拦住）。
    //    正确做法：抽出桶判定那一段（从 `let bucket, text;` 到 `return {` 之前），
    //    扫描各个 if/else-if 条件，比较「判 !passed」与「判 netOutflow」的先后序号。
    //    注意不能截到第一个 `}` —— 那会在第一个分支体结束时就截断，漏掉后面的分支。
    const bStart = filterSrc.indexOf('let bucket, text;');
    const bEnd = filterSrc.indexOf('return {', bStart);
    const bucketBlock = (bStart > -1 && bEnd > bStart) ? filterSrc.slice(bStart, bEnd) : '';
    const conds = [...bucketBlock.matchAll(/(?:if|else\s+if)\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
    const iP = conds.findIndex((c) => /!\s*passed\b/.test(c));
    const iN = conds.findIndex((c) => /\bnetOutflow\b/.test(c));
    const orderOk = bucketBlock !== '' && iP > -1 && iN > -1 && iP < iN;
    check('降级：桶判定中 !passed 优先于 netOutflow（降级不得豁免其他强制剔除）', orderOk,
      `分支序=${JSON.stringify(conds)}`);
    // ④ 扣分值必须只有一个出处，且下游不得重写字面量
    const ownerOk = /export const LHB_NET_OUTFLOW_PENALTY\s*=\s*\{[\s\S]*?SCORE:\s*10[\s\S]*?PROB:\s*8[\s\S]*?\};/.test(filterSrc)
      && /export const FLAG_LHB\s*=\s*\{[\s\S]*?NET_OUTFLOW:\s*'⚠龙虎当日资金净流出，谨慎开仓'/.test(filterSrc);
    check('降级：扣分值(10/8)与告警标签在 src/lhbfilter.js 唯一定义', ownerOk, `ownerOk=${ownerOk}`);
    // 下游（picks/predict/alerts/UI）必须 import，不得自行写 10 或 8 当扣分
    const downstream = ['src/picks.js', 'src/predict.js', 'src/alerts.js', 'paper_ui.js'];
    const hardcode = [];
    for (const rel of downstream) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      // 判据：出现「降级/净流出」语义词的行里，同时出现裸字面量 10 或 8 作为扣减量
      const bad = src.split('\n').filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))
        .filter((ln) => /(PENALTY|净流出|netOutflow|降级)/.test(ln))
        .filter((ln) => /[:=]\s*(10|8)\s*[,;)]|\*\s*(10|8)\b/.test(ln));
      if (bad.length) hardcode.push(`${rel}: ${bad[0].trim().slice(0, 70)}`);
    }
    check('降级：下游（picks/predict/alerts/UI）不得手抄 10/8 扣分值，必须引用常量',
      hardcode.length === 0, hardcode.slice(0, 2).join(' ; '));
    // ⑤ UI 不得手抄告警标签文案
    const uiSrc = readFileSync('paper_ui.js', 'utf8');
    const tagCopies = uiSrc.split('\n').filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))
      .filter((ln) => /['"`]⚠?龙虎当日资金净流出/.test(ln));
    check('降级：UI 不得手抄告警标签文案（模板占位符/注释不计）', tagCopies.length === 0,
      tagCopies.slice(0, 2).join(' ; '));
    // ⑥ 人工复核门槛必须拦在真正下单之前（提示文案不能当门槛）
    //
    //    这个断言写了三版才站得住，三版都栽在「拿错参照物」上，记录下来免得后人重踩：
    //      ① 用 `s.search(/reviewPassed\(/)` 找门槛 → 命中的是**函数定义**
    //         （`function reviewPassed(code)` 在文件中段），与 submitOrder 比较恒为真；
    //      ② 用「submit() 起点 ~ 其后第一个 submitOrder」当门槛区段 → 门槛被移动到
    //         submitOrder **之后**时，区间端点跟着一起后移，区间内依然含门槛，仍恒为真。
    //    站得住的判据：在 submit() 函数体内，取**门槛调用点**与 **submitOrder 调用点**
    //    两个绝对位置直接比大小，不构造任何依赖被测对象的区间。
    const uiSrc2 = readFileSync('paper_ui.js', 'utf8');
    const submitStart = uiSrc2.indexOf('async function submit()');
    // submit() 的结束位置：下一个顶层 `function ` / `async function ` 声明
    const nextDecl = uiSrc2.slice(submitStart + 10).search(/\n(?:async )?function /);
    const submitEnd = nextDecl > -1 ? submitStart + 10 + nextDecl : uiSrc2.length;
    const body = uiSrc2.slice(submitStart, submitEnd);
    // 门槛调用点：形如 `!reviewPassed(<expr>)`，且**排除** `function reviewPassed` 定义行
    const gateCall = body.search(/(?<!function\s)\breviewPassed\s*\(/);
    const orderCall = body.indexOf('submitOrder(ACCT,');
    const gateInSubmit = submitStart > -1 && gateCall > -1 && orderCall > -1 && gateCall < orderCall;
    check('降级：人工复核门槛拦在 submit() 内、submitOrder 调用之前（提示文案不能当门槛）',
      gateInSubmit, `函数区段=${submitEnd - submitStart} 门槛@${gateCall} 下单@${orderCall}`);
    // 卖出侧不得设槛：净流出是「谨慎开仓」的理由，不是「不许离场」的理由
    check('降级：复核门槛只拦买入（ORDER.side === \'buy\'），卖出不设槛',
      /ORDER\.side\s*===\s*'buy'/.test(body.slice(0, Math.max(gateCall, 0))), '');
  }
}

// ── B6. 报告模板契约守卫（用户给定模板，仅排版层，不得动数据） ──────────────
// 模板五条是排版硬约束，但更关键的是一条**纪律**：报告只翻译屏幕 DOM，不重算指标。
// 一旦有人在导出层重算指标（口径漂移的头号来源），数字就会和屏幕对不上。
//   ① 导出层 src/report.js 不得出现指标计算痕迹（tanh / 打分函数 / 权重表 / clamp）；
//   ② 模板要求的四类结构必须真实存在于生成代码里（摘要/表格/折叠件/复选框）；
//   ③ 各章节口径与文末附录必须由同一份文本来源（禁止把脚注复制成两份）。
{
  const reportSrc = readFileSync(path.join('src', 'report.js'), 'utf8');
  // 去掉注释行后检查代码本体
  const rcode = reportSrc.split('\n').filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');
  const RECOMPUTE = [/Math\.tanh/, /scoreEmotion|scorePnl|scoreTheme|scoreBreadth/, /clamp100/, /weights\s*\./];
  const recomputeHits = RECOMPUTE.filter((re) => re.test(rcode)).map((re) => re.source);
  check('导出纪律：src/report.js 不重算任何指标（只翻译 DOM；无 tanh/打分函数/权重表）',
    recomputeHits.length === 0, recomputeHits.join(' ; '));

  // 模板结构必须落地（缺失即视为模板被推翻）
  const STRUCT = [
    ['模板①摘要栏', /bf-abstract|doc-abstract/],
    ['模板②连板天梯表格', /bf-table|rep-tbl/],
    ['模板③口径折叠件', /CALIBER_SUMMARY|<details/],
    ['模板④复选框清单', /bf-todo|todo/],
    ['模板⑤导出时间', /导出时间/],
  ];
  for (const [label, re] of STRUCT) {
    check(`模板契约：${label} 在导出层落地`, re.test(reportSrc), re.test(reportSrc) ? '' : '导出层缺该结构');
  }

  // 屏幕层同样必须落地（屏幕与导出共用同一份 DOM，缺一边版式就不一致）
  const appRaw2 = readFileSync('app.js', 'utf8');
  const SCREEN_STRUCT = [
    ['摘要', /class="bf-abstract"/],
    ['天梯表格', /class="bf-table"/],
    ['口径折叠件', /class="bf-caliber"/],
    ['复选框清单', /class="bf-todo"/],
    ['独立附录', /class="bf-caliber bf-appendix"/],
  ];
  for (const [label, re] of SCREEN_STRUCT) {
    check(`模板契约：${label} 在屏幕层落地`, re.test(appRaw2), re.test(appRaw2) ? '' : 'app.js 缺该结构');
  }

  // 折叠件标题只能有一份约定（app.js 常量 + report.js 常量；两处值必须相等，防漂移）
  {
    const appTitle = appRaw2.match(/const CAL_SUMMARY = '([^']+)'/);
    const rptTitle = reportSrc.match(/CALIBER_SUMMARY = '([^']+)'/);
    check('模板契约：折叠件标题在屏幕层与导出层取值一致（防止两处文案漂移）',
      !!appTitle && !!rptTitle && appTitle[1] === rptTitle[1],
      appTitle && rptTitle ? `app「${appTitle[1]}」/ report「${rptTitle[1]}」` : '未找到常量');
  }
}

// ── B6b. 公文体例守卫（用户给定「A股市场研究分析简报 · 报告标准格式」）─────────
// 与 B6 的分工：B6 守「模板要求的四类结构别丢」，B6b 守「公文格式别走样」。
// 公文体例的每一条（页边距/字号阶梯/序号体系/日期形态/六角括号/页码单双页）
// 都是**规范**，不是审美偏好——所以逐条有守卫，且每条都做过负向注入验证。
//
// 这一块查的是 **DOC_SPEC 常量与声明的版式助手**，而不是在 CSS 里
// 逐个 grep 字面量：常量是唯一出处，CSS 由它插值生成（见 STANDALONE_CSS）。
// 一旦有人在 CSS 里手抄一个 15pt，B6b 的「CSS 不含手写字号」那条会立刻拦下。
{
  const reportSrc = readFileSync(path.join('src', 'report.js'), 'utf8');
  const css = reportSrc.slice(reportSrc.indexOf('export const STANDALONE_CSS'));

  // ① A4 与页边距（上37 下35 左28 右26）——四边数值缺一不可，顺序也不能错
  const pageSpec = reportSrc.match(/page:\s*\{([^}]*)\}/);
  const want = { top: '37mm', bottom: '35mm', left: '28mm', right: '26mm' };
  const pageOk = !!pageSpec && Object.entries(want).every(([k, v]) => new RegExp(`${k}:\\s*'${v}'`).test(pageSpec[1]));
  check('公文：A4 版心页边距上37/下35/左28/右26（缺一边就不是公文版心）',
    pageOk && /size:\s*'A4'/.test(pageSpec[1]),
    pageSpec ? pageSpec[1].trim().slice(0, 90) : '未找到 DOC_SPEC.page');
  // @page 简写顺序是 上 右 下 左 —— 写错顺序＝左右边距互换，肉眼几乎看不出，必须机检
  check('公文：@page margin 按「上 右 下 左」顺序由常量插值（顺序错＝左右互换）',
    /@page\s*\{\s*size:\s*\$\{DOC_SPEC\.page\.size\};\s*margin:\s*\$\{DOC_SPEC\.page\.top\}\s+\$\{DOC_SPEC\.page\.right\}\s+\$\{DOC_SPEC\.page\.bottom\}\s+\$\{DOC_SPEC\.page\.left\}/.test(css),
    '未按 上右左下 顺序插值');

  // ② 字号阶梯：2 号＝22pt、3 号＝16pt、4 号＝14pt，全部来自 DOC_SPEC
  const fontSpec = reportSrc.match(/font:\s*\{([^}]*)\}/);
  const fontOk = !!fontSpec
    && /h1:\s*'22pt'/.test(fontSpec[1]) && /abstract:\s*'16pt'/.test(fontSpec[1])
    && /body:\s*'16pt'/.test(fontSpec[1]) && /table:\s*'16pt'/.test(fontSpec[1])
    && /page:\s*'14pt'/.test(fontSpec[1]);
  check('公文：字号阶梯 2号22pt / 3号16pt / 4号14pt（全部取自 DOC_SPEC.font）',
    fontOk, fontSpec ? fontSpec[1].trim().slice(0, 110) : '未找到 DOC_SPEC.font');
  // CSS 不得出现裸字号字面量（手抄＝第二套口径，常量改了这边不会跟着改）。
  // ⚠ 必须同时卡 pt 与 px：只卡 pt 会漏掉「手写成 16px」这种更常见的走样
  //   （负向注入时实测到的洞——当时只写了 \d+pt，把 16px 放行了）。
  const barePt = (css.match(/font-size:\s*\d+(?:\.\d+)?(?:pt|px)\b/g) || []);
  check('公文：CSS 里的字号全部由 DOC_SPEC 插值，无手抄的 pt/px 字面量',
    barePt.length === 0, barePt.slice(0, 3).join(' ; '));

  // ③ 字体族：小标宋 / 黑体 / 楷体 / 仿宋 四族齐备，且各自有跨平台兜底
  // ⚠ 每条族的值本身是**逗号分隔的候选列表**（`"方正小标宋简体", "STZhongsong", …`），
  //   所以不能用 `[^,]*` 卡到第一个逗号就收手（小标宋的第一项是中文名，命中不到 STZhongsong）。
  //   用 `[^']*` 取到该条**引号值的边界**，跨行用 [\s\S] 兜住。
  const famSpec = reportSrc.match(/family:\s*\{([\s\S]*?)\n\s*\}/);
  const famBody = famSpec ? famSpec[1] : '';
  const famChecks = [
    ['小标宋', /\bxbs:\s*'[^']*STZhongsong/, '缺小标宋（或没有跨平台兜底 STZhongsong）'],
    ['黑体', /\bhei:\s*'[^']*SimHei/, '缺黑体 SimHei'],
    ['楷体', /\bkai:\s*'[^']*KaiTi/, '缺楷体 KaiTi'],
    ['仿宋', /\bfs:\s*'[^']*FangSong/, '缺仿宋 FangSong'],
  ];
  const famBad = famChecks.filter(([, re]) => !re.test(famBody)).map(([, , m]) => m);
  check('公文：字体族小标宋/黑体/楷体/仿宋齐备，且各有兜底字体（缺字体时不至于是宋体一刀切）',
    famBody && famBad.length === 0, famBad.join('；') || (famSpec ? '' : '未找到 DOC_SPEC.family'));

  // ④ 序号体系：一、（黑体）→（一）（楷体）→ 1.→（1），层级顺序不得插队、不得混用
  check('公文：四层序号助手齐备（一、/（一）/1./（1））',
    /export function sectionNo\(/.test(reportSrc)
    && /h1Mark|h2Mark|h3Mark|h4Mark/.test(reportSrc)
    && /numbering:\s*\{[^}]*level1:\s*'cn'[^}]*level2:\s*'cnPar'[^}]*level3:\s*'arabic'[^}]*level4:\s*'arabicPar'/s.test(reportSrc),
    '序号体系常量或助手缺失');
  // 一级标题必须是黑体、二级必须是楷体 —— 这是「序号字体跟着层级走」的公文规定。
  // ⚠ 判据是「引用了对应的 DOC_SPEC.family 条目」而不是「文中出现了 SimHei」：
  //   CSS 由常量插值生成，字面量本来就不该出现在 CSS 里（下一条正是查这个）。
  //   一开始写成了 grepping 字面量 SimHei，结果把**正确实现**判成了失败——
  //   「守卫断言用了错误的参照物」是本项目反复踩的坑，这里记一笔。
  check('公文：序号字体跟着层级走（一级取 family.hei / 二级取 family.kai）',
    /\.sec h2\.h1\s*\{[^}]*font-family:\s*\$\{DOC_SPEC\.family\.hei\}/s.test(css)
    && /\.sec h3\.h2\s*\{[^}]*font-family:\s*\$\{DOC_SPEC\.family\.kai\}/s.test(css),
    '一级/二级标题的字体族未按层级取 DOC_SPEC.family');
  // CSS 不得出现裸字体名（手抄＝第二套口径，常量改了这边不会跟着改）
  const bareFam = (css.match(/font-family:\s*(?!\$\{)[^;]*/g) || [])
    .filter((s) => /Sim|Kai|Fang|Song|YaHei|PingFang/.test(s));
  check('公文：CSS 里的字体族全部由 DOC_SPEC.family 插值，无手抄字体名',
    bareFam.length === 0, bareFam.slice(0, 2).join(' ; '));
  // 导出层不得再输出历史圆形序号（①②③）当章节号
  check('公文：导出层不再用圆形序号①②③当章节号（已统一为一、）',
    !/sec-no">\$\{i \+ 1\}/.test(reportSrc) && !/<span class="sec-no">/.test(reportSrc),
    '仍存在 ①②③ 圆形序号徽标');

  // ⑤ 六角括号（U+3014/U+3015）——公文规定年份编号用〔〕，不是 [ ]
  check('公文：年份编号用六角括号〔〕（U+3014/U+3015），且未误用方括号',
    /bracket:\s*\['\\u3014'|bracket:\s*\['〔',\s*'〕'\]/.test(reportSrc)
    && /cnBracket/.test(reportSrc)
    && !/\[\s*\$\{y\}\s*\]/.test(reportSrc),
    '六角括号常量或 cnBracket 缺失');

  // ⑥ 生成日期：阿拉伯数字全年月日、不编虚位（补零）、右空四字
  check('公文：生成日期走 docDate()（阿拉伯数字 YYYY-MM-DD 补零，不用汉字数字）',
    /export function docDate\(/.test(reportSrc)
    && /padStart\(2,\s*'0'\)/.test(reportSrc.slice(reportSrc.indexOf('export function docDate'))),
    'docDate 缺失或缺补零');
  check('公文：落款日期右空四字（padding-right: 4em，取自 DOC_SPEC.dateRightChars）',
    /\.sign-date\s*\{[^}]*padding-right:\s*\$\{DOC_SPEC\.dateRightChars\}em/s.test(css),
    '未按 dateRightChars 生成');

  // ⑦ 页码：4 号半角阿拉伯数字、版心之外、单页右放 / 双页左放
  check('公文：页码单页右放 @page :right @bottom-right（4 号半角）',
    /@page :right\s*\{\s*@bottom-right\s*\{\s*content:\s*counter\(page\);\s*font-family:\s*\$\{DOC_SPEC\.family\.fs\};\s*font-size:\s*\$\{DOC_SPEC\.font\.page\}/.test(css),
    '单页页码规则缺失或未由常量插值');
  check('公文：页码双页左放 @page :left @bottom-left（与单页镜像）',
    /@page :left\s*\{\s*@bottom-left\s*\{\s*content:\s*counter\(page\)/.test(css),
    '双页页码规则缺失');

  // ⑧ 正文缩进：左空 2 字符靠 text-indent（回行顶格是它的天然结果，不能用 padding 代替）
  check('公文：正文「左空 2 字符」用 text-indent: 2em（padding 会让回行不顶格）',
    /\.sec li\s*\{[^}]*text-indent:\s*2em/s.test(css)
    && !/\.sec li\s*\{[^}]*padding-left/s.test(css),
    '正文缩进实现方式不对');

  // ⑨ 附表：标题在表格上方居中
  check('公文：附表标题在表格上方且居中（.tbl-cap 用 text-align:center）',
    /\.tbl-cap\s*\{[^}]*text-align:\s*center/s.test(css),
    '表格标题未居中');

  // ⑩ 屏幕层也要有对应的报头/序号结构（屏幕与导出同体例，不能只有导出是公文）
  const appRaw3 = readFileSync('app.js', 'utf8');
  check('公文：屏幕层同样产出报头/主标题/段序号结构',
    /class="bf-head"/.test(appRaw3) && /class="bf-masthead"/.test(appRaw3)
    && /class="bf-sec-no"/.test(appRaw3) && /bf-title/.test(appRaw3),
    'app.js 缺公文报头或序号结构');
  // 屏幕层序号必须来自「版式层」，不能又在标题字符串里手写序号
  check('公文：屏幕层段序号由数组现算（不在标题字符串里手抄「①」）',
    !/seg\('① |seg\('② /.test(appRaw3),
    'app.js 仍在标题字符串里手写圆形序号');
  const styleSrc = readFileSync('style.css', 'utf8');
  check('公文：屏幕样式层有报头/标题/序号样式',
    /\.bf-head\s*\{/.test(styleSrc) && /\.bf-masthead\s*\{/.test(styleSrc)
    && /\.bf-sec-no\s*\{/.test(styleSrc),
    'style.css 缺公文报头/序号样式');
}

// ── B7. 报告出厂质检闸门的守卫（用户要求「自动化审计后再出现」）───────────────
// 闸门本身也必须被守卫，否则它可能被"优化"掉——
//   · 引擎文件必须存在且是**纯函数**（不得重算指标）；
//   · 闸门必须真的在 renderBrief 里（而不是只写了个函数没人调）；
//   · 不通过时必须**不渲染报告**（清空 #briefBody 而不是照样写进去）；
//   · 下游导出/复制/打印必须共享同一把锁（guardAudited），漏一个就是漏一个口子；
//   · 期望章节数必须是**人工声明的常量**（从 DOM 数就永远发现不了缺段）。
{
  const auditPath = path.join('src', 'report_audit.js');
  if (!existsSync(path.join(ROOT, auditPath))) {
    check('质检闸门：引擎 src/report_audit.js 存在', false, '文件缺失');
  } else {
    const asrc = readFileSync(path.join(ROOT, auditPath), 'utf8');
    const acode = asrc.split('\n').filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');
    check('质检闸门：引擎存在且导出 auditReport',
      /export function auditReport/.test(asrc), '');
    // 与导出层同一条纪律：质检只校验结构，绝不重算指标
    const RECOMPUTE2 = [/Math\.tanh/, /scoreEmotion|scorePnl|scoreTheme|scoreBreadth/, /clamp100/, /weights\s*\./];
    const rh = RECOMPUTE2.filter((re) => re.test(acode)).map((re) => re.source);
    check('质检闸门：引擎不重算任何指标（只校验结构）', rh.length === 0, rh.join(' ; '));
    check('质检闸门：期望章节数是人工声明的常量（从 DOM 数就发现不了缺段）',
      /export const EXPECTED_SECTIONS = \d+;/.test(asrc), '');

    const appRaw = readFileSync('app.js', 'utf8');
    // 闸门必须真的接在渲染链路上：renderBrief 函数体内要有 auditReport 调用。
    // 判据取「函数起点到下一个顶层 function 之间」而不是固定字符窗口——
    // 固定窗口会被函数里的长注释撑爆（本项目就踩过：注释一多，1600 字符不够）。
    const rfStart = appRaw.indexOf('function renderBrief(');
    const rfEnd = rfStart < 0 ? -1 : appRaw.indexOf('\nfunction ', rfStart + 10);
    const rfBody = rfStart < 0 ? '' : appRaw.slice(rfStart, rfEnd < 0 ? rfStart + 6000 : rfEnd);
    check('质检闸门：真的接在 renderBrief 里（不是写了个没人调的引擎）',
      /\.auditReport\(/.test(rfBody),
      rfStart < 0 ? '找不到 renderBrief' : (rfBody ? '' : 'renderBrief 函数体为空'));
    // 不通过必须不渲染：**在 renderBrief 函数体内**清空 #briefBody 并挂失败面板。
    // 判据取「归一化行尾后三句相邻」——直接写 \s*\n\s* 会被贪婪的 \s* 吃掉换行导致匹配失败
    // （本项目踩过：文件是 CRLF，正则里 \s* 与 \n 打架，正反向都判为通过）。
    // 另外必须限定在 renderBrief 内且三句相邻：renderBrief 里另有一个正常分支
    // （数据未就绪）也写 body.innerHTML = ''，松判据在闸门被拆掉后依然为真。
    const rfNorm = rfBody.replace(/\r\n/g, '\n');
    check('质检闸门：不通过时不渲染报告（三件事相邻且在同一段代码里）',
      /body\.innerHTML = '';\n\s*body\.classList\.add\('audit-blocked'\);\n\s*body\.appendChild\(renderAuditPanel\(result\)\);/.test(rfNorm),
      'renderBrief 内未找到「清空 → 标记 audit-blocked → 挂失败面板」相邻三句');
    // 下游三入口必须共享同一把锁——漏一个就等于没拦
    const guards = (appRaw.match(/if \(!guardAudited\(btn\)\) return;/g) || []).length;
    check('质检闸门：复制/导出/打印三入口共享同一把锁（漏一个就是漏一个口子）',
      guards === 3, `实际 ${guards} 处 guardAudited`);
    // 引擎未挂载与数据未就绪必须与"不合格"区分开（否则会把正常中间态报成质检失败）
    check('质检闸门：区分「引擎未就绪 / 数据未就绪 / 报告不合格」三种状态',
      /audit-engine-unavailable/.test(appRaw) && /data-not-ready/.test(appRaw), '');
  }
}

// ── C. 结论 ────────────────────────────────────────────────────────────────
if (warns.length) for (const w of warns) console.log(`⚠ ${w}`);
if (fails.length) {
  console.error(`\n[audit-lhb-caliber] 失败 ${fails.length} 项：${fails.join('、')}`);
  console.error('提示：若为存档问题，用 node scripts/recalc_lhb_daily.mjs 全档重算；若为源码问题，禁止自行相加，走 src/lhb.js。');
  process.exit(1);
}
console.log(`\n[audit-lhb-caliber] 通过：${days.length} 个交易日、双口径可重现、因子锁定当日榜口径。`);
