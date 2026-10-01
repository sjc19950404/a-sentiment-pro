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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { caliberFromDay, isRangeBoard, duplicateKeys } from '../src/lhb.js';
import { decodeArchive } from '../src/lhb_codec.js';
import config from '../src/config.js';
import { SEED_CLOSED } from '../src/calendar.js';

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
const arch = decodeArchive(JSON.parse(readFileSync(ARCHIVE, 'utf8')));
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

// ── B8. 历史回填天不得进入「综合分」消费路径（回测/报告/走势）───────────────
// 回填天只有 lhb 与 s_net，emotion.value 是 **s_net 单因子占位值、不是综合分**。
// 分位需要它（样本基线），但任何把 value 当信号的地方都不需要——用了就是凭空捏造结论。
{
  const btRaw = readFileSync(path.join(ROOT, 'scripts', 'backtest.mjs'), 'utf8');
  check('回填：回测脚本显式排除 emotion._backfill 天（否则 208 天假情绪分会污染每个指标）',
    /_backfill/.test(btRaw) && /filter\(\(d\) => d && d\.trade_date && !\(d\.emotion && d\.emotion\._backfill\)\)/.test(btRaw), '');
  // 交叉核对产物：backtest.json 的 sampleNote 必须与档案实际构成对得上账
  const btPath = path.join(ROOT, 'data', 'backtest.json');
  if (existsSync(btPath)) {
    const bt = JSON.parse(readFileSync(btPath, 'utf8'));
    const sn = bt.meta && bt.meta.sampleNote;
    const bfCount = days.filter((d) => d.emotion && d.emotion._backfill).length;
    check('回填：档案里确有回填天（否则这条守卫是空转）', bfCount > 0, String(bfCount));
    if (sn) {
      check('回填：回测样本数 = 档案天数 − 回填天数（三者必须对得上账）',
        sn.archiveDays === days.length && sn.excludedBackfillDays === bfCount
        && sn.backtestDays === days.length - bfCount,
        );
      check('回填：回测样本里不含任何回填天',
        (bt.series && bt.series.dates ? bt.series.dates.length : -1) === sn.backtestDays, '');
    } else {
      check('回填：backtest.json 必须带 meta.sampleNote（否则口径无法对账）', false, 'missing');
    }
  }
}

// ── B9. 分层切片一致性 + 码表压缩往返无损（性能改动不得悄悄改口径）─────────────
// 为什么必须有这一块：
//   切片是**同一份数据的第二种落盘形态**。一旦切片与主档脱钩（少一天、字段改动、
//   码表不同步），线上页面读的是切片、审计读的是主档，两边会各自"正确"地给出不同结论。
//   所以：① 每档的日集合必须是主档日集合的**子集**且可对账；② 码表往返必须逐字节无损；
//   ③ 惰性字段的提子/还原必须守恒（丢一天 lhb 就是丢一天审计依据）；
//   ④ 前端不得在首屏无条件拉主档（否则切片白做，性能回到起点）。
{
  const splitter = path.join(ROOT, 'scripts', 'split_archive.mjs');
  check('切片：存在唯一出处 scripts/split_archive.mjs（切片不得手写）', existsSync(splitter), 'missing');

  const mainDates = new Set((arch.all_days || []).map((d) => d.trade_date));
  const idxPath = path.join(ROOT, 'data', 'archive-index.json');
  const rcPath = path.join(ROOT, 'data', 'archive-recent.json');
  const sigPath = path.join(ROOT, 'data', 'signals-latest.json');
  // 滚动窗在后文（码表段落）也要用；此处提前读一次，避免重复 IO 与作用域嵌套
  const rcCached = existsSync(rcPath) ? JSON.parse(readFileSync(rcPath, 'utf8')) : null;

  if (existsSync(idxPath)) {
    const raw = readFileSync(idxPath, 'utf8');
    const idx = JSON.parse(raw);
    const kb = Buffer.byteLength(raw) / 1024;
    // 索引是首屏必拉文件，体积必须锁死——它一大，"按需加载"就名存实亡
    check('切片：archive-index.json 首屏体积 < 32KB', kb < 32, `${kb.toFixed(1)}KB`);
    check('切片：索引 totalDays = 主档天数（否则前端"共 N 天"是假的）',
      idx.totalDays === mainDates.size, `${idx.totalDays} vs ${mainDates.size}`);
    check('切片：索引 latestDate 是主档最后一个交易日',
      idx.latestDate === (arch.all_days || [])[arch.all_days.length - 1]?.trade_date,
      String(idx.latestDate));
    // 年分片的日期区间必须与索引自报的一致，否则"按年取片段"会取错区间
    const years = idx.years || [];
    check('切片：索引声明了年份清单', years.length > 0, JSON.stringify(years));
    // 摘要字段不得混入明细（索引里出现 all_days / summary.seats 就说明切片退化成了全量）
    check('切片：索引不含 all_days 全量明细', !('all_days' in idx), Object.keys(idx).join(','));
    check('切片：索引不得携带 lhb 原始明细',
      !JSON.stringify(idx.latest || {}).includes('"seat"'), '');
    // 惰性字段必须在索引里被显式声明，前端才能知道"还差什么"
    check('切片：索引声明 lazy 字段清单（前端据此决定要不要补拉）',
      idx.lazy !== undefined && typeof idx.lazy === 'object', JSON.stringify(idx.lazy || null));

    let yearTotal = 0;
    const bad = [];
    for (const y of years) {
      const p = path.join(ROOT, 'data', `archive-${y}.json`);
      if (!existsSync(p)) { bad.push(`archive-${y}.json 缺失`); continue; }
      const shard = JSON.parse(readFileSync(p, 'utf8'));
      const ds = (shard.all_days || []).map((d) => d.trade_date);
      yearTotal += ds.length;
      const outside = ds.filter((dt) => !mainDates.has(dt));
      if (outside.length) bad.push(`${y}: ${outside.length} 天不在主档（${outside.slice(0, 2).join(',')}）`);
      const wrongYear = ds.filter((dt) => String(dt).slice(0, 4) !== String(y));
      if (wrongYear.length) bad.push(`${y}: ${wrongYear.length} 天不是本年度（${wrongYear.slice(0, 2).join(',')}）`);
    }
    check('切片：年分片日期均为本年度且全部属于主档', bad.length === 0, bad.slice(0, 3).join(' ; '));

    // 滚动窗是"最近 N 天"的缓存，不是分片的子集——与年分片合并后必须能覆盖主档所有天
    if (rcCached) {
      const rc = rcCached;
      const rcDates = [...(rc.days || []).map((d) => d.trade_date), rc.latest && rc.latest.trade_date].filter(Boolean);
      const union = new Set([...rcDates, ...years.flatMap((y) => {
        const p = path.join(ROOT, 'data', `archive-${y}.json`);
        return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')).all_days || []).map((d) => d.trade_date) : [];
      })]);
      check('切片：滚动窗 + 年分片 并集 = 主档全量（不得漏天）',
        union.size === mainDates.size && [...mainDates].every((dt) => union.has(dt)),
        `并集 ${union.size} vs 主档 ${mainDates.size}`);
      check('切片：滚动窗按日期升序（前端取 [-1] 当最新日）',
        rcDates.every((dt, i) => i === 0 || rcDates[i - 1] < dt), rcDates.slice(-3).join(','));
      check('切片：滚动窗末位 = 主档最新日',
        rcDates[rcDates.length - 1] === (arch.all_days || [])[arch.all_days.length - 1]?.trade_date,
        String(rcDates[rcDates.length - 1]));
      const rckb = Buffer.byteLength(readFileSync(rcPath, 'utf8')) / 1024;
      check('切片：滚动窗体积 < 512KB（首屏第二个请求，需可接受）', rckb < 512, `${rckb.toFixed(1)}KB`);
      // 最新日必须是"完整明细"，否则首屏的当日盘面/报告会缺字段
      const lt = rc.latest || {};
      check('切片：滚动窗最新日带 hot（首屏当日盘面必用）', Array.isArray(lt.hot) && lt.hot.length > 0, String((lt.hot || []).length));
      check('切片：滚动窗最新日带 lhb_aggr（展示层唯一入口）',
        Array.isArray(lt.lhb_aggr) && lt.lhb_aggr.length > 0, `${(lt.lhb_aggr || []).length} 条`);
      // 锁仓口径 calcLockNew 读前 2 天 seats.detail —— 裁掉就是报告静默少一段
      const seatDays = (rc.days || []).filter((d) => d.summary && d.summary.seats).length;
      const mainSeatDays = (arch.all_days || []).filter((d) => d.summary && d.summary.seats).length;
      check('切片：滚动窗保留历史日 summary.seats（锁仓统计读前 2 天，裁掉会静默少一段）',
        mainSeatDays === 0 || seatDays > 0, `窗内 ${seatDays} 天 / 主档 ${mainSeatDays} 天`);
    } else {
      check('切片：存在 archive-recent.json', false, 'missing');
    }
  } else {
    check('切片：存在 archive-index.json', false, 'missing');
  }

  // 码表压缩：往返无损 + 内存侧必须还原成中文原文（否则 isRangeBoard 会静默失配）
  const codec = await import('../src/lhb_codec.js');
  const roundtrip = codec.decodeArchive(codec.encodeArchive(
    { meta: {}, signals: {}, all_days: arch.all_days }, codec.buildReasonCodes(arch.all_days)));
  const norm = (x) => JSON.stringify(x, Object.keys(x || {}).sort());
  const rtDiff = [];
  const origDays = arch.all_days || [];
  for (let i = 0; i < origDays.length; i++) {
    const a = origDays[i]; const b = roundtrip.all_days[i];
    if (!b || a.trade_date !== b.trade_date) { rtDiff.push(`#${i} 日期错位`); continue; }
    // 只比"编码涉及 + 提子涉及"的字段：reason/reasons/lhb —— 其余字段本就该原样
    if (JSON.stringify(a.lhb || []) !== JSON.stringify(b.lhb || [])) rtDiff.push(`${a.trade_date} lhb 往返不一致`);
    const ar = (a.lhb || []).map((r) => r.reason).join('|');
    const br = (b.lhb || []).map((r) => r.reason).join('|');
    if (ar !== br) rtDiff.push(`${a.trade_date} reason 往返不一致`);
    const ars = (a.lhb || []).map((r) => (r.reasons || []).join('+')).join('|');
    const brs = (b.lhb || []).map((r) => (r.reasons || []).join('+')).join('|');
    if (ars !== brs) rtDiff.push(`${a.trade_date} reasons 往返不一致`);
  }
  check('切片：码表压缩往返逐日无损（reason / reasons / lhb 三项）',
    rtDiff.length === 0, rtDiff.slice(0, 3).join(' ; '));
  check('切片：解码后 reason 必须是中文原文（正则口径依赖它，退回下标会静默失配）',
    origDays.some((d) => (d.lhb || []).some((r) => /[\u4e00-\u9fa5]/.test(String(r.reason || ''))))
    && origDays.every((d) => (d.lhb || []).every((r) => !Array.isArray(r.reason))),
    '');
  // 主档写盘态的**真实**不变量：码表生效 + 惰性字段已提子。
  // ⚠ 这里必须读**磁盘原始 JSON**，不能读 `arch`（它已被 decodeArchive 还原成明文+内联），
  //   否则守卫会反过来断言"压缩没生效"——一个把正确状态判成错的假警报。
  // ⚠ 上一版曾写成 `lhbInline === 0 || lhbInMain === lhbInline`，两边都取自已解码视图，
  //   恒真通过（顶层 241 / 应有 241），是在验证一个不存在的状态。此处改为读原始盘。
  const rawDisk = JSON.parse(readFileSync(ARCHIVE, 'utf8'));
  const diskRecs = rawDisk.all_days.flatMap((d) => [...(d.lhb || []), ...((d._sub && d._sub.lhb) || [])]);
  const encRec = diskRecs.filter((r) => Array.isArray(r.rc)).length;
  const plainRec = diskRecs.filter((r) => r.reasons !== undefined || r.reason !== undefined).length;
  check('切片：主档 lhb 记录已走码表（rc 下标），无明文残留',
    encRec > 0 && plainRec === 0, `rc ${encRec} / 明文 ${plainRec}`);
  check('切片：主档写盘态 lhb 已提子到 _sub（顶层不得残留 lhb）',
    rawDisk.all_days.filter((d) => d.lhb != null).length === 0,
    `${rawDisk.all_days.filter((d) => d.lhb != null).length} 天顶层带 lhb`);
  // ⚠ 修正常见误读：提子对**主档体积零收益**（只是改名 lhb → _sub.lhb，多 7 字节/天）。
  //   真正省体积的是码表这一级。此处锁住"提子不得让体积回涨"，防止将来把它当省钱手段。
  const rawMb = Buffer.byteLength(readFileSync(ARCHIVE, 'utf8')) / 1048576;
  check('切片：主档体积 < 6MB（码表是唯一有效手段；提子只是改名，不省体积）',
    rawMb < 6, `${rawMb.toFixed(2)}MB`);
  check('切片：主档 meta.reasonCodes 与记录引用一致（码表缺失会让解码整体回退成 undefined）',
    Array.isArray(arch.meta?.reasonCodes) && arch.meta.reasonEncoding === 'rc-v1'
    && origDays.every((d) => (d.lhb || []).every((r) => (r.rc || []).every((i) => i >= 0 && i < arch.meta.reasonCodes.length))),
    `${arch.meta?.reasonCodes?.length ?? 0} 条`);
  // 提子只在切片里用（主档保留 lhb 内联以便审计），故检查滚动窗历史日确实不带 lhb
  const winHistory = (rcCached?.days || []);
  check('切片：滚动窗历史日不带 lhb 原始榜（首屏体积的主要来源，必须裁掉）',
    winHistory.length === 0 || winHistory.every((d) => d.lhb == null && !(d._sub && d._sub.lhb)),
    `${winHistory.filter((d) => d.lhb != null).length} 天带 lhb`);

  // signals：最新日 + 动量 + 大盘告警；必须小、且不含明细
  if (existsSync(sigPath)) {
    const sraw = readFileSync(sigPath, 'utf8');
    const sg = JSON.parse(sraw);
    const skb = Buffer.byteLength(sraw) / 1024;
    check('切片：signals-latest.json < 32KB（只放"看一眼"的量）', skb < 32, `${skb.toFixed(1)}KB`);
    check('切片：signals 的交易日 = 主档最新日',
      sg.latest && sg.latest.trade_date === (arch.all_days || [])[arch.all_days.length - 1]?.trade_date,
      String(sg.latest && sg.latest.trade_date));
    check('切片：signals 含动量（盘前一眼看题材）', sg.signals && sg.signals.momentum != null, '');
    check('切片：signals 不得夹带 lhb_aggr 明细（那是滚动窗的活）',
      !(sg.latest && sg.latest.lhb_aggr), '');
    // 「轻」的定义性约束：本档只放**结论**，不放任何"逐日明细数组"。
    //   加一句"顺手把 all_days 也带上"就会让它从 16KB 涨到 MB 级，
    //   而因为它有个 <32KB 的体积守卫，涨上去会先触发体积断言——但那时已经不知道为什么涨了。
    //   这条断言把"为什么"钉死：明细数组根本不该出现在这里。
    const heavyKeys = [];
    for (const [k, v] of Object.entries(sg)) {
      if (k === 'meta' || k === 'signals') continue;
      if (Array.isArray(v) && v.length > 12) heavyKeys.push(`${k}(${v.length})`);
    }
    check('切片：signals 不含逐日明细数组（"轻"的定义性约束）',
      heavyKeys.length === 0, heavyKeys.join(',') || '');
    check('切片：signals 顶层不得出现 all_days（完整档的职责）',
      !sg.all_days, sg.all_days ? `带了 ${sg.all_days.length} 天` : '');
    // 三个"看一眼"的结论段都必须在（缺一个说明某条生成路径没接上）
    check('切片：signals 带 latest / relative / health / marketAlerts 四段结论',
      !!sg.latest && 'relative' in sg && 'health' in sg && 'marketAlerts' in sg,
      `latest=${!!sg.latest} relative=${'relative' in sg} health=${'health' in sg} marketAlerts=${'marketAlerts' in sg}`);
    check('切片：signals 里 relative/health 缺失时为 null（不得用 0 顶替）',
      sg.relative !== 0 && sg.health !== 0 && sg.healthNote != null,
      `healthNote=${sg.healthNote ? '有' : '无'}`);
  } else {
    check('切片：存在 signals-latest.json', false, 'missing');
  }

  // 前端不得在首屏无条件拉主档——这条是本块存在的**唯一目的**
  const appRaw = readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  check('切片：前端首屏走索引 + 滚动窗，不得直接 fetch 主档 archive.json',
    !/fetch\(\s*['"`]\.\/data\/archive\.json/.test(appRaw), 'app.js 仍在首屏拉主档');
  check('切片：前端存在按需加载完整档的入口（loadFull / archive-<年>.json）',
    /archive-\$\{|archive-' \+ y|archive-" \+ y/.test(appRaw), 'app.js 缺少分片加载');
}

// ── B10. 回写主档的脚本必须走「解码 → 改 → 重编码」往返 ──────────────────────
// 这是本项目**最危险的一类改动**：主档是压缩态（reason→rc 码表 + lhb 提子），
// 任何"读进来 → 改一点 → 直接 JSON.stringify 写回"的脚本都会产出坏档：
//   ① 缩进：紧凑 4.99MB → 9.22MB，压缩收益全丢
//   ② 致命：档里记录仍是 rc 下标，但重编码被跳过 → 解码回退成 reasons:[undefined]，
//      表现是 reason 全变 '—'、RANGE_BOARD_RE 静默失配（**区间累计榜被当成当日榜**，
//      区间值混进日度因子）。本项目已发生过一次同类事故（二次迁移丢了 2 天 seats）。
// 判据：源码里同时出现"写 data/archive.json"与 `JSON.stringify(<变量>, null, N)`
// 就是漏了重编码（正确写法是 writeArchiveSafely）。
{
  const WRITERS = [
    'backfill_lhb_history.mjs', 'backfill_prev_momentum.mjs', 'backfill_seal_pct.mjs',
    'freshness.mjs', 'recalc_lhb_daily.mjs', 'refetch_seats_clean.mjs',
    'repair_hot_quotes.mjs', 'repair_seats_aggregate_rows.mjs', 'pipeline.js',
  ];
  const bad = [];
  const missingDecode = [];
  const missingSafe = [];
  for (const rel of WRITERS) {
    const p = path.join(ROOT, rel.startsWith('pipeline') ? 'src' : 'scripts', rel);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, 'utf8');
    if (!/archive\.json|writeArchive\b|ARCHIVE|dataPath/.test(src)) continue;
    // ① 不得有「缩进写盘」——那一定同时意味着跳过了重编码
    for (const m of src.matchAll(/JSON\.stringify\([^)]*,\s*null,\s*\d+\s*\)/g)) {
      // 允许：写的是**别的**文件（如 backtest.json / paper_universe.json / 缓存）
      const line = src.slice(Math.max(0, m.index - 200), m.index + 40);
      const targetsArchive = /writeFileSync\(\s*(ARCHIVE|FILE|P|dataPath)\b/.test(line)
        || /archive\.json/.test(line);
      const isArchiveVar = /\b(JSON\.stringify\((?:a|arc|archive|packed|out)\b)/.test(m[0]);
      if (targetsArchive && isArchiveVar) bad.push(`${rel}: ${m[0].slice(0, 40)}`);
    }
    // ② 读主档的地方必须 decodeArchive
    if (/readFileSync\([^)]*archive\.json/.test(src) && !/decodeArchive/.test(src)) missingDecode.push(rel);
    // ③ 写主档的地方必须"重编码"：或走 writeArchiveSafely（改存量档的脚本），
    //    或至少显式调 encodeArchive（pipeline.js 是从零构造整档的生产端，本就持有对象）
    const writesArchive = /writeFileSync\(\s*(ARCHIVE|FILE|P|dataPath)\b/.test(src)
      || /archive\.json[^)]*\).*writeFileSync/s.test(src);
    if (writesArchive && !/writeArchiveSafely|encodeArchive/.test(src)) missingSafe.push(rel);
  }
  check('回写：不得有「缩进写盘」主档的脚本（缩进＝跳过了重编码，且体积翻倍）',
    bad.length === 0, bad.slice(0, 3).join(' ; '));
  check('回写：读主档的脚本必须 decodeArchive（否则拿到的是 rc 下标，reason 会全变占位符）',
    missingDecode.length === 0, missingDecode.join(', '));
  check('回写：写主档的脚本必须重编码（writeArchiveSafely 或 encodeArchive），不得裸写',
    missingSafe.length === 0, missingSafe.join(', '));
  // 4. 助手本身必须存在且真的做自检
  const codecSrc = readFileSync(path.join(ROOT, 'src', 'lhb_codec.js'), 'utf8');
  check('回写：writeArchiveSafely 存在且带往返自检（不一致时拒绝写盘）',
    /export function writeArchiveSafely/.test(codecSrc) && /ROUNDTRIP_MISMATCH/.test(codecSrc), '');
  check('回写：writeArchiveSafely 紧凑写盘（不得带缩进参数）',
    /writeFileSync\(filePath,\s*text/.test(codecSrc), '');
}

// ── B11. 标的池分档：精简池与完整池必须同源生成，且 CI 必须把两份都提交 ────────
// 分档能省 920KB，但它引入了一个新的**静默失败面**：
//   · 精简池忘了生成 → 前端回退拉完整池（1059KB）→ 首屏变慢，但**页面看起来完全正常**；
//   · 精简池生成后没被 git add → 推到线上的仍是旧池 → 新股没有名字，**页面也看起来正常**；
//   · 两份池用不同的输入生成 → 同一只票在两个池里名称/代码不一致，**页面依旧正常**。
// 三者都不会报错，只会悄悄变慢或悄悄缺字段。故用 CI 守卫兜住。
{
  const uniSrc = readFileSync(path.join(ROOT, 'scripts', 'fetch_universe.mjs'), 'utf8');
  const wfSrc = readFileSync(path.join(ROOT, '.github', 'workflows', 'daily.yml'), 'utf8');
  // ① 两份池必须由**同一个脚本同一次运行**产出（同一份 list 派生，不存在两套构建逻辑）
  check('标的池：精简池与完整池由同一脚本同一次运行产出（杜绝两套构建逻辑）',
    /OUT_LITE/.test(uniSrc) && /paper_universe-lite/.test(uniSrc)
    && (uniSrc.match(/const list = \[\.\.\.uni\.values\(\)\]/g) || []).length === 1,
    '');
  // ② 精简池必须只写 code+name —— 结构断言在 test/universe_lazy.test.mjs，
  //    这里守的是**源码层**：JSON.stringify 前不得把整行对象直接塞进去
  check('标的池：精简池显式只取 code+name（不得整行塞入，否则规则副本会跟着漂移）',
    /map\(\(x\) => \(\{ code: x\.code, name: x\.name \}\)\)/.test(uniSrc), '');
  // ③ CI 必须把精简池一起提交（漏了就是"本地有、线上没有"）
  check('标的池：CI 提交清单含 paper_universe-lite.json（漏了＝线上永远拿不到精简池）',
    /paper_universe-lite\.json/.test(wfSrc), '');
  // ④ CI 必须把切片一起提交（同理：本地生成、线上没有会让前端 404 后回退拉主档 5MB）
  check('标的池：CI 提交清单含 archive-index / archive-recent / signals-latest 切片',
    /archive-index\.json/.test(wfSrc) && /archive-recent\.json/.test(wfSrc)
    && /signals-latest\.json/.test(wfSrc), '');
  // ⑤ 前端必须优先用精简池，且**必须**有回退路径（精简池缺失时不至于整页挂掉）
  const paperSrc = readFileSync(path.join(ROOT, 'paper_ui.js'), 'utf8');
  check('标的池：前端有精简池缺失时的回退路径（否则一次漏生成就整页不可用）',
    /if \(lite && lite\.symbols\)/.test(paperSrc) && /else \{/.test(paperSrc)
    && /精简池缺失/.test(paperSrc), '');
  // ⑥ 非交易日也要重建池：active/quoteFresh 是日期敏感字段，长假不重建会显示过期的"当日有价"
  const pipeSrc = readFileSync(path.join(ROOT, 'src', 'pipeline.js'), 'utf8');
  check('标的池：非交易日管道也重建标的池（否则长假 7 天后仍显示"当日有价"）',
    /function refreshUniverseOnly/.test(pipeSrc)
    && /refreshUniverseOnly\(today\)/.test(pipeSrc), '');
  // ⑦ 重建必须跑**同一个脚本**，不得在管道里重写一份构建逻辑
  check('标的池：非交易日重建走 scripts/fetch_universe.mjs（不重写第二份构建逻辑）',
    /fetch_universe\.mjs/.test(pipeSrc) && /spawnSync/.test(pipeSrc), '');
}

// ── 源码扫描工具（共用）────────────────────────────────────────────────────
//
// 为什么必须剥注释再扫：本项目的源码注释里**大量引用**函数名与代码形态（那是文档价值所在），
// 直接扫原文会把"注释里在说明"误判成"代码里在实现"，报出假阳性——
// 实测踩过：注释里一句 `factor(..., fallback)` 就让"不得实现第二套因子"的守卫变红。
const stripCommentsAud = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── B12. 公式版本治理：版本差异必须只体现在「净买原料 × 归一方式」，不得出现第二套因子实现 ────
// 版本可插拔最大的诱惑是「顺手在新版本里把某个因子也改改」——一旦如此，
//   · 多版对比就不再能归因（分不清差异来自净买口径、归一方式，还是来自因子改动）；
//   · 报告/回测/推荐会各自绑定不同版本的因子语义，口径彻底失控。
// 本块把「版本差异只在净买原料与归一层」这条从**注释里的约定**升级为**机器可验的约束**。

// 辅助：确认 normalizer 只出现在候选版本条目上（基线必须留空以走历史默认）。
// 不能用"数出现次数"糊弄——那无法区分"候选声明了"与"基线声明了"，而后者才是危险信号：
//   基线一旦显式声明归一器，历史分数就会随该声明变动，可比性断档。
function versionHasNormalizerOnlyOnCandidate(code) {
  // 按版本条目切块：以 key: 'vX.Y' 为分隔，看每块里是否有 normalizer: 与 candidate: true
  const entries = code.split(/key:\s*'v[^']+'/).slice(1);
  let hit = 0;
  for (const e of entries) {
    const hasNorm = /normalizer:\s*\w+/.test(e);
    const isCand = /candidate:\s*true/.test(e);
    const isBase = /baseline:\s*true/.test(e);
    if (hasNorm && isBase) return false; // 基线声明归一器 = 违规
    if (hasNorm && isCand) hit++;
    if (hasNorm && !isCand) return false; // 非候选、非基线却声明归一器 = 违规
  }
  return hit === 1;
}

{
  const fvPath = path.join(ROOT, 'src', 'formula_versions.js');
  const fvExists = existsSync(fvPath);
  const fv = fvExists ? readFileSync(fvPath, 'utf8') : '';
  check('公式版本：src/formula_versions.js 存在（版本唯一出处）', fvExists, '');

  // ① 必须复用 computeSentiment，不得自带因子计算
  //
  // ⚠ 源码扫描必须先剥注释：本文件里到处在**解释**这些函数名（"见 sentiment.js 的 factor(..., fallback)"），
  //   直接扫原文会把注释里的说明当成实现，报假阳性。实测踩过：注释里一句引用就让本项变红，
  //   而真正的意图（"不得实现第二套因子"）反而没被判到。
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行注释（不误伤 https:// 里的 //）
  const fvCode = stripComments(fv);
  // 断言放宽到"从 sentiment.js 具名导入 computeSentiment"，不含 '}' 紧跟 ' from' 的硬形状——
  //   原因：v5.3 起还要导入两个归一器（NET_NORMALIZER_*），解构列表不再只有一个名字。
  //   但**不放宽其实质**：computeSentiment 必须来自 sentiment.js，且本文件不得出现
  //   Math.tanh 或 factor( —— 那才意味着"因子被重写了一遍"。
  check('公式版本：复用 src/sentiment.js 的 computeSentiment（不得实现第二套七因子）',
    /import\s*\{[^}]*\bcomputeSentiment\b[^}]*\}\s*from\s*'\.\/sentiment\.js'/.test(fvCode)
    && !/Math\.tanh/.test(fvCode) && !/\bfactor\(/.test(fvCode),
    '若在版本文件里出现 tanh / factor(，说明因子被重写了一遍');

  // ② 差异必须收敛到「净买原料 × 归一方式」两个接缝
  //
  // 语义升级：原断言是"三版各有一个提取器"。v5.3 的净买原料与 v5.2 **完全相同**
  //   （它改的是归一方式），故"提取器个数 == 版本数"不再是正确的不变量。
  //   真正该守的不变量有三条：
  //     · 三个历史提取器都还在（不得为了加版本而删掉旧版——历史可比性靠它们）
  //     · 每个版本都声明了 extractNetBuy（函数引用），且**只允许是两个已知提取器之一**
  //     · 有版本声明 normalizer 时，它必须来自 sentiment.js 导出的归一器白名单
  const extractRefs = [...fvCode.matchAll(/extractNetBuy:\s*(\w+)/g)].map((m) => m[1]);
  const knownExtractors = new Set(['netBuyV45', 'netBuyV50', 'netBuyV52']);
  check('公式版本：三个历史净买提取器齐备（不得为加版本而删旧版）',
    /export function netBuyV45/.test(fv) && /export function netBuyV50/.test(fv)
    && /export function netBuyV52/.test(fv),
    '旧版提取器缺失会让历史可比性断档');
  check('公式版本：每个版本都声明已知提取器（差异收敛到单一接缝）',
    extractRefs.length === 4 && extractRefs.every((r) => knownExtractors.has(r)),
    `提取器引用 ${extractRefs.join(',')}（应为 4 个且都属 ${[...knownExtractors].join('/')}）`);
  // 归一器白名单：必须是 sentiment.js 具名导出，防止某个版本偷偷内联一套换算
  const normRefs = [...fvCode.matchAll(/normalizer:\s*(\w+)/g)].map((m) => m[1]);
  check('公式版本：归一器只能取自 sentiment.js 的白名单（不得内联换算）',
    normRefs.every((r) => r === 'NET_NORMALIZER_TANH5' || r === 'NET_NORMALIZER_PCTL'),
    `归一器引用 ${normRefs.join(',') || '(无)'}`);
  check('公式版本：仅候选版本声明 normalizer，基线不声明（基线走历史默认）',
    normRefs.length === 1 && versionHasNormalizerOnlyOnCandidate(fvCode),
    `normalizer 声明 ${normRefs.length} 处`);

  // ③ 基线版本号必须与 config.formulaVersion 同步（两处不一致＝报告说 A、算的是 B）
  const cfg = readFileSync(path.join(ROOT, 'src', 'config.js'), 'utf8');
  const cfgVer = (cfg.match(/formulaVersion:\s*'([^']+)'/) || [])[1];
  const baseVer = (fv.match(/export const BASELINE_VERSION = '([^']+)'/) || [])[1];
  check('公式版本：BASELINE_VERSION 与 config.formulaVersion 一致（否则报告与实算两套口径）',
    !!cfgVer && cfgVer === baseVer, `config=${cfgVer} baseline=${baseVer}`);

  // ④ 权重键映射必须与 config.factorKeyMap 同义（两处漂移会让因子静默错位）
  const fvMap = fv.match(/WEIGHT_TO_FACTOR = \{([\s\S]*?)\};/);
  const cfgMap = cfg.match(/factorKeyMap: \{([\s\S]*?)\},/);
  const pairsOf = (src) => {
    const out = [];
    const re = /(s_[a-z]+)\d*:\s*'(s_[a-z]+)'/g;
    let m;
    while ((m = re.exec(src || ''))) out.push(m[1] + '→' + m[2]);
    return out.sort().join(',');
  };
  check('公式版本：WEIGHT_TO_FACTOR 与 config.factorKeyMap 逐键一致',
    !!fvMap && !!cfgMap && pairsOf(fvMap[1]) === pairsOf(cfgMap[1]) && pairsOf(fvMap[1]) !== '',
    `fv=[${pairsOf(fvMap && fvMap[1])}] cfg=[${pairsOf(cfgMap && cfgMap[1])}]`);

  // ⑤ 权重键传错必须硬失败（NaN 曾静默传播，把整张相关性表变成 NaN）
  check('公式版本：分数非有限时硬失败（NaN 不得静默传播）',
    /Number\.isFinite\(sent\.score\)/.test(fv) && /throw new Error/.test(fv), '');

  // ⑥ 因子键必须从权重键归一成无后缀形式（否则下游 factors.s_net 全是 undefined）
  check('公式版本：因子键归一为无后缀形式（与存档一致）',
    /WEIGHT_TO_FACTOR/.test(fv) && /factorsRaw/.test(fv), '');

  // ⑦ 次日收益必须按真实交易日相邻取，且记录跳空（长假陷阱）
  check('公式版本：次日收益按真实交易日相邻取并记录跳空天数',
    /export function nextRetOf/.test(fv) && /gap/.test(fv) && /function tradingDayGap/.test(fv), '');

  // ⑧ 可算性必须分级且披露代理天数（否则 33 天样本会被当成 241 天样本读）
  check('公式版本：可算性分级并披露 breadth 代理天数',
    /COMPUTE_TIERS/.test(fv) && /hasBreadth/.test(fv) && /breadthProxyDays/.test(readFileSync(path.join(ROOT, 'scripts', 'version_regression.mjs'), 'utf8')), '');

  // ⑨ 回归产物必须自带「样本量不足」的提示，禁止被读成版本优劣结论
  check('公式版本：回归脚本强制写入样本量不足的提示',
    /cautions\.push/.test(readFileSync(path.join(ROOT, 'scripts', 'version_regression.mjs'), 'utf8'))
    && /不足以判定版本优劣|不.*判定/.test(readFileSync(path.join(ROOT, 'scripts', 'version_regression.mjs'), 'utf8')), '');

  // ⑩ 统计口径（pearson/spearman/方向准确率）必须只有一份实现，脚本与单测共用
  const helper = path.join(ROOT, 'test', '_helpers_regression.mjs');
  const helperSrc = existsSync(helper) ? readFileSync(helper, 'utf8') : '';
  const vrSrc = readFileSync(path.join(ROOT, 'scripts', 'version_regression.mjs'), 'utf8');
  check('公式版本：统计工具只有一份实现（脚本 import，不得内联重写）',
    existsSync(helper) && /export function pearson/.test(helperSrc)
    && /from '\.\.\/test\/_helpers_regression\.mjs'/.test(vrSrc)
    && !/export function pearson/.test(vrSrc), '');

  // ⑪ 归一层：s_net 的换算必须真在 sentiment.js 里可插拔，且 tanh5 逐位等于历史公式
  //
  // ⚠ 本项用**真调用**而不是扫源码字面量。上一轮 B14 的教训：
  //   扫源码只能证明"某句话在"，不能证明"行为对"——把返回体改掉、条件行原样保留，
  //   字面量断言会完全逃过。故这里直接 import 归一器并跑数字。
  {
    const sentSrc = readFileSync(path.join(ROOT, 'src', 'sentiment.js'), 'utf8');
    check('归一层：sentiment.js 导出两个具名归一器（tanh5 基线 + 分位映射）',
      /export const NET_NORMALIZER_TANH5/.test(sentSrc) && /export const NET_NORMALIZER_PCTL/.test(sentSrc),
      '');
    check('归一层：s_net 走可插拔归一器，而非硬编码 tanh',
      /netNormalizer\(netExNew/.test(sentSrc) && !/Math\.tanh\(netExNew\s*\/\s*5\)/.test(stripCommentsAud(sentSrc)),
      '若出现 Math.tanh(netExNew/5) 说明归一器被绕过，v5.3 会失效');
    // 真调用：tanh5 必须逐位等于历史公式（改它就是改历史分数）
    const sMod = await import(pathToFileURL(path.join(ROOT, 'src', 'sentiment.js')).href);
    const t5 = sMod.NET_NORMALIZER_TANH5;
    let tanhOk = true;
    const tanhProbe = [-80, -12.14, -4.73, 0, 4.73, 11.65, 20.09, 31.33, 78.16];
    for (const x of tanhProbe) {
      if (Math.abs(t5(x) - (Math.tanh(x / 5) * 50 + 50)) > 1e-12) tanhOk = false;
    }
    check('归一层：tanh5 逐位等于历史公式 tanh(x/5)*50+50（改它＝改历史分数）',
      tanhOk && t5(null) === null && t5(NaN) === null, `probe ${tanhProbe.join(',')}`);
    // 真调用：分位映射必须解饱和——用真实档案量级探针（p50=11.65 / p75=20.09 / max=78.16）
    const pctl = sMod.NET_NORMALIZER_PCTL;
    const hist = Array.from({ length: 60 }, (_, i) => (i + 1) * 0.5); // 0.5~30 亿
    const p20 = pctl(20.09, { netHistory: hist });  // 档案 p75 量级
    const p78 = pctl(78.16, { netHistory: hist });  // 档案 max 量级
    check('归一层：分位映射在档案 p75→max 量级区间仍有分辨力（tanh5 此时已顶格）',
      p20 < 99 && (p78 - p20) > 5 && t5(20.09) > 99.9,
      `分位 ${p20.toFixed(1)}→${p78.toFixed(1)}（差 ${(p78 - p20).toFixed(1)}）| tanh5(20.09)=${t5(20.09).toFixed(4)}`);
    // 真调用：历史不足必须返回 null（不得硬算，也不得静默填 50）
    check('归一层：历史不足时返回 null（不得编造分位）',
      pctl(10, { netHistory: [] }) === null && pctl(10, { netHistory: [1, 2, 3] }) === null
      && typeof pctl(10, { netHistory: hist }) === 'number',
      '');
    // 真调用：符号镜像（流入/流出强度对称、方向相反）
    const inF = pctl(25, { netHistory: hist });
    const outF = pctl(-25, { netHistory: hist });
    check('归一层：分位映射对符号做镜像（对称且方向相反）',
      inF > 50 && outF < 50 && Math.abs((inF - 50) + (outF - 50)) < 1e-9,
      `流入 ${inF.toFixed(2)} / 流出 ${outF.toFixed(2)}`);
  }

  // ⑫ 回归产物必须携带归一层留痕与饱和阈值（否则前端两版分数无法解释差异）
  {
    const regSrc = readFileSync(path.join(ROOT, 'scripts', 'version_regression.mjs'), 'utf8');
    check('公式版本：回归产物带饱和阈值常量（前端不得自行硬编码 99.9）',
      /const SAT_THRESHOLD\s*=\s*99\.9/.test(regSrc) && /satThreshold:\s*SAT_THRESHOLD/.test(regSrc),
      '');
    check('公式版本：回归产物带归一层留痕（normalizer 字段）',
      /normalizer:/.test(regSrc) && /netCaliber/.test(regSrc),
      '两版净买相同、只有归一不同，不留痕则差异无法解释');
  }
}

// ── B13. 交易日历：判定必须来自日历，不得再散落"手写手册"式的日期判断 ────────────
// 日历取代 manualHolidays 的全部价值在于**唯一出处**。若某处仍自行写
//   `dow !== 0 && dow !== 6 && !manualHolidays.includes(d)`
// 就会形成第二套判定：日历修了、它没修，两边在长假/调休上给出不同答案，
// 而差异只体现在"某天没抓数据"上——几乎无法归因。故用源码守卫封死。
{
  const calPath = path.join(ROOT, 'src', 'calendar.js');
  const calExists = existsSync(calPath);
  const calSrc = calExists ? readFileSync(calPath, 'utf8') : '';
  const utilSrc = readFileSync(path.join(ROOT, 'src', 'util.js'), 'utf8');

  check('交易日历：src/calendar.js 存在（判定唯一出处）', calExists, '');

  // ① util.isTradingDay 必须委托给日历，不得保留自己的实现
  //
  // ⚠ 守卫不能只匹配某一种写法。实测：最初写成
  //     /getDay\(\)\s*===\s*0\s*\|\|\s*\w+\.getDay\(\)\s*===\s*6/
  //   要求等号两侧都是 `xxx.getDay()`；而注入 `const dow = new Date(d).getDay();
  //   if (dow === 0 || dow === 6) return false;` 时**完全逃过**（左侧是裸 `dow`）。
  //   故改为「出现 getDay() 本身 + 出现与 0/6 的比较」两个条件同时成立即视为在自建周末判断。
  //   这是有意的宽松：util.js 里除了这一处转接，本来就不该有任何 getDay()。
  const utilCode = stripCommentsAud(utilSrc);
  const hasGetDay = /\.getDay\s*\(/.test(utilCode);
  const comparesWeekend = /(===\s*0\s*\|\|\s*[\w.]+\s*===\s*6)|(===\s*6\s*\|\|\s*[\w.]+\s*===\s*0)|(includes\s*\(\s*6\s*\))/.test(utilCode);
  check('交易日历：util.isTradingDay 委托 calendar.js（不得保留第二套判定）',
    /from '\.\/calendar\.js'/.test(utilSrc) && /calIsTradingDay\(dateStr/.test(utilSrc)
    && !(hasGetDay && comparesWeekend),
    `util.js 里出现自建周末判断（getDay=${hasGetDay} weekendCmp=${comparesWeekend}）`);

  // ② 三态判定必须存在（否则无法表达调休补班）
  check('交易日历：三态判定（trading/closed/unknown）齐备',
    /DAY_KIND\s*=\s*\{/.test(calSrc) && /trading:/.test(calSrc)
    && /closed:/.test(calSrc) && /unknown:/.test(calSrc), '');

  // ③ 文件缺失/损坏必须降级且留痕，不得静默变"全年无休"
  check('交易日历：文件缺失/损坏时降级并标记 degraded（不得静默）',
    /cal\.meta\.degraded = true/.test(calSrc) && /degradedReason/.test(calSrc)
    && /SEED_CLOSED/.test(calSrc), '');

  // ④ 覆盖范围必须写出（否则读者以为覆盖了未来，跨年后静默用旧日历）
  const calJsonPath = path.join(ROOT, 'data', 'calendar.json');
  const calJson = existsSync(calJsonPath) ? JSON.parse(readFileSync(calJsonPath, 'utf8')) : null;
  check('交易日历：data/calendar.json 已生成且写出覆盖范围',
    !!calJson && 'coveredTo' in calJson && !!calJson.source, '');

  // ⑤ 「未来不得写进日历」——写 coveredTo 之后的日期会永久污染文件
  //
  // ⚠ 这里有个必须说清的区分，否则守卫会误伤：
  //   · coveredTo 是「日K证据的最后一天」，**不等于**「已知日历的最后一天」。
  //   · 已由交易所公告确定的未来休市日（如 10-01~10-07 国庆）是**已知事实**，
  //     写在 coveredTo 之后完全正确 —— 它们不是"猜未来"，而是"照公告登记"。
  //   · 真正要禁的是「无依据地推断未来休市」：把 coveredTo 之后的**工作日**当休市写进去，
  //     而那一天既不在公告里、也没有日K证据。那种条目会让下一年真的开市时不认。
  //   故判据是：coveredTo 之后的 closer 必须能在「已知公告来源」里找到出处 ——
  //   实现上就是必须在 config.manualHolidays 或 SEED_CLOSED 中。没有出处的即非法。
  if (calJson) {
    const covTo = calJson.coveredTo;
    const declared = new Set([...(config.manualHolidays || [])]);
    for (const arr of Object.values(SEED_CLOSED)) for (const d of arr) declared.add(d);
    const beyond = (calJson.closed || [])
      .filter((d) => covTo && d > covTo)
      .filter((d) => !declared.has(d));
    check('交易日历：coveredTo 之后的休市日必须有公告/种子出处（不得凭空推断未来）',
      beyond.length === 0, beyond.slice(0, 5).join(','));
  } else {
    check('交易日历：coveredTo 之后的休市日必须有公告/种子出处（不得凭空推断未来）', false, '缺日历文件，无法判定');
  }

  // ⑥ config.manualHolidays 必须已降级为「兜底」并在注释里写明，不得仍自称主口径
  const cfgSrc = readFileSync(path.join(ROOT, 'src', 'config.js'), 'utf8');
  check('交易日历：config.manualHolidays 已标注为兜底（不得仍自称主口径）',
    /降级为兜底|已降级为兜底|兜底/.test(cfgSrc) && /calendar\.js/.test(cfgSrc), '');

  // ⑦ 所有调用点必须走 resolveHolidays()，不得再直接引用 config.manualHolidays
  const callers = ['src/pipeline.js', 'scripts/fetch_global.mjs', 'scripts/freshness.mjs', 'scripts/snapshot_intraday.mjs'];
  const directRefs = [];
  for (const f of callers) {
    const s = readFileSync(path.join(ROOT, f), 'utf8');
    const code = stripCommentsAud(s);
    if (/config\.manualHolidays/.test(code)) directRefs.push(f);
    if (!/resolveHolidays\(\)/.test(code)) directRefs.push(f + '(未接日历)');
  }
  check('交易日历：调用点全部走 resolveHolidays()，无直接引用 config.manualHolidays',
    directRefs.length === 0, directRefs.join(','));

  // ⑧ CI 必须在管道**之前**同步日历（否则管道用旧日历判交易日）
  //
  // ⚠ 不能用 indexOf('fetch_calendar.mjs') —— 本审计脚本自身的文字里也提到该文件名，
  //   而 daily.yml 的 run 步骤里也会在**注释**里提到它。必须按「`run:` 之后的可执行行」
  //   定位，取第一个真正执行它的步骤位置，否则会拿到注释/文档里的假位置。
  const wf = readFileSync(path.join(ROOT, '.github', 'workflows', 'daily.yml'), 'utf8');
  // ⚠ 必须按 /\r?\n/ 切：本项目 CI 文件是 CRLF。用 split('\n') 时行尾会残留 '\r'，
  //   而 `/^\s*run:\s*(\S.*)$/` 的 `$` 在无 m 标志下锚定「字符串末尾」，
  //   残留的 \r 使整行无法匹配 → 命中数 0 → 守卫恒报"找不到"，看起来像 CI 没配。
  //   实测踩过这个坑（命中 0 而 grep 明明能找到 run: 行）。
  const wfLines = wf.split(/\r?\n/);
  const firstRunLine = (re) => {
    for (let i = 0; i < wfLines.length; i++) {
      const m = wfLines[i].match(/^\s*run:\s*(\S.*)$/);
      if (m && re.test(m[1])) return i;
    }
    return -1;
  };
  const iCal = firstRunLine(/fetch_calendar\.mjs/);
  const iPipe = firstRunLine(/node src\/pipeline\.js/);
  check('交易日历：CI 在管道之前同步日历（否则用旧日历判交易日）',
    iCal >= 0 && iPipe >= 0 && iCal < iPipe, `cal@${iCal} pipe@${iPipe}`);

  // ⑨ CI 必须提交日历（本地生成、线上没有 → 线上永远用旧日历）
  check('交易日历：CI 提交清单含 data/calendar.json', /data\/calendar\.json/.test(wf), '');

  // ⑩ 日历必须有自检（写盘前拒绝自相矛盾的日历）
  const fcSrc = readFileSync(path.join(ROOT, 'scripts', 'fetch_calendar.mjs'), 'utf8');
  check('交易日历：抓取脚本写盘前自检（拒绝自相矛盾的日历）',
    /validateCalendar\(payload\)/.test(fcSrc) && /拒绝写盘/.test(fcSrc), '');
}

// ── B14. 板块相对强弱：口径唯一出处 + 缺数据不得渲染成 0 ──────────────────────
// 这条守卫盯的是本类指标最典型的两个翻车方式：
//   ① UI/报告层自己再算一遍超额（"顺手减一下"）→ 改口径时两处必然不同步；
//   ② 无数据时渲染 0 → 0 的语义是"与基准完全同步"，是**确定结论**；
//      缺数据的语义是"不知道"。把后者画成前者，就是在编造数据。
// 历史 208 天没有行业明细，②几乎必然被踩。
{
  const relPath = path.join(ROOT, 'src', 'relative.js');
  const relExists = existsSync(relPath);
  const rel = relExists ? readFileSync(relPath, 'utf8') : '';
  const relCode = stripCommentsAud(rel);
  check('板块相对强弱：src/relative.js 存在（口径唯一出处）', relExists, '');

  // ① 必须自带中位数（不得用均值——均值会被单行业异动拽偏）
  check('板块相对强弱：中位数基准实现在唯一出处内',
    /export function median/.test(relCode) && /\.sort\(\(x, y\) => x - y\)/.test(relCode),
    '中位数必须在本模块内实现且真排序取中');

  // ② 缺数据必须返回 null，不得返回 0/空榜
  //
  // ⚠ 这条**必须真调用来验，不能只扫源码文本**。最初写成扫
  //   `if (valid.length < 30) return null` 字面量，结果负向注入
  //   （把返回改成 0 榜）**完全逃过**——因为改的是条件体，字面量仍在。
  //   扫描源码只能证明"某句话在"，不能证明"行为对"。此处改为 import 后真跑。
  const { computeRelative: probeRel, median: probeMedian } = await import(
    pathToFileURL(relPath).href
  );
  // ① 无行业明细 → null
  const rEmpty = probeRel({ trade_date: 'x', industry: [], indexes: { 上证指数: 0.5 } });
  check('板块相对强弱：无行业明细时返回 null（不得返回 0 或空榜）',
    rEmpty === null, `实得 ${JSON.stringify(rEmpty)?.slice(0, 60)}`);
  // ② 行业数不足 30（残缺列表）→ null
  const rFew = probeRel({
    trade_date: 'x',
    industry: Array.from({ length: 29 }, (_, i) => ({ name: 'I' + i, change_pct: i / 10 })),
    indexes: { 上证指数: 0.5 },
  });
  check('板块相对强弱：行业数不足 30 返回 null（残缺列表不凑榜）',
    rFew === null, `实得 ${JSON.stringify(rFew)?.slice(0, 60)}`);
  // ③ 正常输入 → 双基准且 basePct 正确（行为面确认模块真在算）
  const rOk = probeRel({
    trade_date: 'x',
    industry: Array.from({ length: 40 }, (_, i) => ({ name: 'I' + i, change_pct: (i - 20) / 5 })),
    indexes: { 上证指数: 0.31 },
  });
  check('板块相对强弱：正常输入产出双基准且基准值正确（行为验证）',
    !!rOk && rOk.vsIndex?.basePct === 0.31 && rOk.vsMedian?.baseLabel === '行业中位数'
    && rOk.vsIndex.attack.length === 5,
    rOk ? `vsIndex.basePct=${rOk.vsIndex?.basePct} attack=${rOk.vsIndex?.attack?.length}` : 'null');
  // ④ 中位数验证（偶数取两数均值；必须真排序，不是取中间那个位置的原始值）
  check('板块相对强弱：中位数真排序取中（偶数取两数均值）',
    probeMedian === probeMedian && probeMedian([4, 1, 3, 2]) === 2.5 && probeMedian([3, 1, 2]) === 2,
    `[4,1,3,2]→${probeMedian([4, 1, 3, 2])}`);

  // ③ 双基准必须并存（缺一个就答不了另一半问题）
  check('板块相对强弱：vsIndex 与 vsMedian 双基准并存',
    /REL_BASE = \{[\s\S]*?INDEX[\s\S]*?MEDIAN/.test(relCode)
    && /vsIndex/.test(relCode) && /vsMedian/.test(relCode),
    '只留单基准会让"跑赢大盘"与"板块内排序"其中一个问题无法回答');

  // ④ 排序键必须是 excess，不得按 change_pct 排
  check('板块相对强弱：排序键是超额而非绝对涨幅',
    /\.sort\(\(a, b\) => b\.excess - a\.excess\)/.test(relCode),
    '按绝对涨幅排会让普跌日的进攻榜全是负数、含义混乱');

  // ⑤ UI / 报告层不得自带超额计算（只许读 summary.industry_relative）
  const appSrc = readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const appCode = stripCommentsAud(appSrc);
  check('板块相对强弱：前端只读 summary.industry_relative，不自行相减',
    /summary\?\.industry_relative|summary\.industry_relative/.test(appCode)
    && !/change_pct\s*-\s*(day|d)\.indexes/.test(appCode),
    '前端出现 change_pct − indexes 说明它自己算了一遍超额');
  check('板块相对强弱：报告/前端把「未计算」与 0 严格区分',
    /未计算/.test(appSrc),
    '无数据时必须渲染"未计算"而非 0');

  // ⑥ 管线必须重算（否则新增/改口径对存量天永不生效）
  const pipeSrc = readFileSync(path.join(ROOT, 'src', 'pipeline.js'), 'utf8');
  check('板块相对强弱：管线在写档时重算（派生指标不得只写一次）',
    /computeRelative\(d\)/.test(pipeSrc) && /industry_relative/.test(pipeSrc),
    '只在新抓当天算、不回算存量天 → 改口径后历史天永久停旧值');

  // ⑦ 落盘态字段必须能往返（存档/切片都要带）
  const splitSrc = readFileSync(path.join(ROOT, 'src', 'archive_split.js'), 'utf8');
  check('板块相对强弱：index/recent/signals 三档都带该字段',
    (splitSrc.match(/industry_relative/g) || []).length >= 3,
    '只带一档会让另一档的 UI 显示"未计算"（其实是没传）');

  // ⑧ 存档里该字段必须与 industry 明细同生共死（有明细才有值）
  const arcRel = (() => {
    try {
      const a = decodeArchive(JSON.parse(readFileSync(path.join(ROOT, 'data', 'archive.json'), 'utf8')));
      return a.all_days || [];
    } catch { return null; }
  })();
  if (arcRel) {
    const withInd = arcRel.filter((d) => Array.isArray(d.industry) && d.industry.length >= 30);
    const withRel = arcRel.filter((d) => d.summary && d.summary.industry_relative);
    const fake = arcRel.filter((d) => (!Array.isArray(d.industry) || d.industry.length < 30)
      && d.summary && d.summary.industry_relative);
    check('板块相对强弱：存档中有行业明细的天数 == 有超额榜的天数',
      withInd.length === withRel.length, `industry ${withInd.length} / relative ${withRel.length}`);
    check('板块相对强弱：无行业明细的天绝不允许有超额榜（防凭空生成）',
      fake.length === 0, fake.length ? `越界 ${fake.length} 天：${fake.slice(0, 3).map((d) => d.trade_date).join(',')}` : '');
    // ⑨ 抽验算法：榜首超额必须等于「榜首涨幅 − 基准」，且攻防两端不交叉
    const probe = withRel[withRel.length - 1];
    if (probe) {
      const r = probe.summary.industry_relative;
      const b = r.vsIndex || r.vsMedian;
      const a0 = b && b.attack[0];
      const d0 = b && b.defense[0];
      check('板块相对强弱：榜首超额 == 涨幅 − 基准（可外部复算）',
        !!a0 && Math.abs(a0.excess - Math.round((a0.change_pct - b.basePct) * 100) / 100) < 0.011,
        a0 ? `${a0.name}: ${a0.excess} vs ${a0.change_pct}−${b.basePct}` : '无攻榜');
      check('板块相对强弱：攻榜首项超额 > 防榜首项超额（两榜不交叉）',
        !!a0 && !!d0 && a0.excess > d0.excess,
        a0 && d0 ? `${a0.excess} vs ${d0.excess}` : '缺榜');
    }
  }
}

// ── B15. 数据健康面板：口径唯一出处 + "未知"不得退化成"正常" ────────────────────
//
// 本块存在的理由（这是本项目**反复**踩的一类坑）：
//   "没检查"与"检查过且没问题"在数据上都是"没有异常"，极易被写成同一个值。
//   健康面板若把 unknown 渲染成 ok，读者会以为"已经查过了"——比不显示更糟。
//   故这里既守**语义**（真调用 healthReport 验等级判定），也守**渲染契约**。
{
  const hPath = path.join(ROOT, 'src', 'health.js');
  const hExists = existsSync(hPath);
  const hSrc = hExists ? readFileSync(hPath, 'utf8') : '';
  const hCode = stripCommentsAud(hSrc);
  check('数据健康：src/health.js 存在（健康口径唯一出处）', hExists, '');

  // ① 必须有 unknown 等级，且不得被合并进 ok
  check('数据健康：定义 unknown 等级（"查不出来"必须可表达）',
    /unknown:\s*'unknown'/.test(hCode), '缺 unknown 会让"未评估"被迫渲染成 ok');

  // ② 阈值必须集中在 health.js，且 warn < fail（否则 warn 档不可达）
  const tWarn = (hCode.match(/imputedWarn:\s*([\d.]+)/) || [])[1];
  const tFail = (hCode.match(/imputedFail:\s*([\d.]+)/) || [])[1];
  check('数据健康：阈值集中在 health.js 且 warn < fail',
    tWarn != null && tFail != null && +tWarn < +tFail,
    `warn=${tWarn} fail=${tFail}`);

  // ③ 真调用验证：这是本块的核心——扫源码只能证明"某句话在"，不能证明"行为对"。
  //    （B14 的教训：把返回体改掉、条件行原样保留，字面量断言会完全逃过。）
  const hMod = await import(pathToFileURL(hPath).href);
  const { healthReport, checkFreshness, checkImputed, checkFields, HEALTH_LEVEL } = hMod;

  // ③-a 空输入必须是 unknown，不得是 ok
  const emptyRep = healthReport([], {});
  check('数据健康：空输入整档为 unknown（不得判成 ok）',
    emptyRep.level === HEALTH_LEVEL.unknown,
    `实际 ${emptyRep.level}`);

  // ③-b 未注入新鲜度评估函数 → unknown（不得佯装 fresh）
  const noFn = checkFreshness({}, {});
  check('数据健康：未注入新鲜度评估函数时返回 unknown（不得伪造成正常）',
    noFn.level === HEALTH_LEVEL.unknown && noFn.state === null,
    `level=${noFn.level} state=${noFn.state}`);

  // ③-c 补位率判级看**最差一天**而非均值（一天烂不能被平均掉）
  const mkD = (i, ratio) => ({
    trade_date: `2099-01-${String(i).padStart(2, '0')}`,
    summary: { ind_up: 1, up_count: 1, amount_yi: 1, zt_count: 1, zb_count: 1, lhb_daily_net: 1 },
    emotion: { imputedRatio: ratio, missing: [] },
  });
  const mostlyGood = Array.from({ length: 20 }, (_, i) => mkD(i + 1, i === 7 ? 1.0 : 0));
  const imp = checkImputed(mostlyGood, { recentWindow: 20 });
  check('数据健康：补位率判级取最差一天（19 天好 + 1 天全缺必须报出来）',
    imp.level !== HEALTH_LEVEL.ok && imp.meanRatio != null && imp.meanRatio < 0.1,
    `level=${imp.level} mean=${imp.meanRatio} worst=${imp.worstDay && imp.worstDay.ratio}`);

  // ③-d 字段可用率：空样本的覆盖率必须是 null 而非 0
  const fEmpty = checkFields([], { recentWindow: 20 });
  const allNull = fEmpty.rows.every((r) => r.ratioRecent === null && r.ratioAll === null);
  check('数据健康：无样本时覆盖率为 null（0 会被误读成"覆盖率为零"）', allNull, '');

  // ③-e 字段可用率判级只看近窗口（历史缺口是既成事实，不该持续报 warn）
  const oldBad = Array.from({ length: 30 }, (_, i) => ({
    trade_date: `2099-02-${String(i + 1).padStart(2, '0')}`,
    summary: { ind_up: 1, up_count: null, amount_yi: 1, zt_count: 1, zb_count: 1, lhb_daily_net: 1 },
    emotion: { imputedRatio: 0, missing: [] },
  }));
  const newGood = Array.from({ length: 20 }, (_, i) => mkD(i + 1, 0));
  const fMixed = checkFields([...oldBad, ...newGood], { recentWindow: 20 });
  const upRow = fMixed.rows.find((r) => r.key === 'up_count');
  check('数据健康：字段判级只看近窗口（历史缺口已修复则不再报 warn）',
    upRow && upRow.ratioAll < 0.5 && upRow.ratioRecent === 1 && upRow.level === HEALTH_LEVEL.ok,
    `全档 ${upRow && upRow.ratioAll} 近窗 ${upRow && upRow.ratioRecent} level=${upRow && upRow.level}`);

  // ③-f 整档取最差项（问题项不得被平均值稀释）
  const warnRep = healthReport(
    Array.from({ length: 20 }, (_, i) => mkD(i + 1, 0)).map((d) => ({ ...d, summary: { ...d.summary, ind_up: null } })),
    { assessFn: () => ({ state: 'fresh' }), recentWindow: 20 },
  );
  check('数据健康：整档取最差项（一项 warn 即整档 warn，不被稀释）',
    warnRep.level === HEALTH_LEVEL.warn,
    `实际 ${warnRep.level}`);

  // ③-g 必带口径说明（不参与打分 + 缺失显示未知）
  check('数据健康：报告自带口径说明（不参与打分、缺失显示未知）',
    /不参与打分/.test(emptyRep.note || '') && /未知/.test(emptyRep.note || ''), '');

  // ④ signals-latest.json 必须带 health 段（前端据此渲染，不得让前端自己算）
  const sigPath = path.join(ROOT, 'data', 'signals-latest.json');
  if (existsSync(sigPath)) {
    const sig = JSON.parse(readFileSync(sigPath, 'utf8'));
    check('数据健康：signals-latest.json 带 health 段（前端不自行判定）',
      !!sig.health && typeof sig.health.level === 'string',
      `health.level=${sig.health && sig.health.level}`);
    check('数据健康：signals-latest 的 health 三项齐备',
      Array.isArray(sig.health.items) && sig.health.items.length === 3,
      `items=${sig.health.items && sig.health.items.map((x) => x.item).join(',')}`);
  }

  // ⑤ 前端不得重写健康阈值（第二套口径）
  const appSrcH = readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const appCodeH = stripCommentsAud(appSrcH);
  check('数据健康：前端未自行实现 healthReport 或阈值常量',
    !/function\s+healthReport\b/.test(appCodeH) && !/imputedWarn|fieldWarnRatio/.test(appCodeH), '');

  // ⑥ 两条写盘路径都必须注入 healthFn（否则主档写完的 signals 与切片脚本产出的不一致）
  const pipeSrcH = readFileSync(path.join(ROOT, 'src', 'pipeline.js'), 'utf8');
  const splitSrcH = readFileSync(path.join(ROOT, 'scripts', 'split_archive.mjs'), 'utf8');
  check('数据健康：pipeline 与 split_archive 两条路径都注入 healthFn（形态一致）',
    /healthFn:/.test(pipeSrcH) && /healthFn:/.test(splitSrcH), '');
}

// ── B16. 席位属性（#1）与亏钱效应（#2）：口径唯一出处 + 缺数据不得变成 0 ──────────
//
// 本块守两件事，都是"错了也看不出"的类型：
//   ① **亏钱效应绝不可用 hot 反查**。hot 是涨幅榜（实测 2026-09-30 的 56 只里最小 +9.87、
//      低于 0 的 0 只），用它算"昨涨停今日表现"会静默丢弃下跌的一半，恒得 +10% 的假繁荣。
//      故必须断言：pain.js 的输入是"行情 Map"，而非从 hot 抽 change_pct。
//   ② **缺数据不得退化成 0**。本块用真调用验证：空行情 → 翻绿比例 null（不是 0）；
//      null 的 changePct 不得被算成平盘（`+null===0` 是本项目反复踩的陷阱）。
{
  const painPath = path.join(ROOT, 'src', 'pain.js');
  const sdPath = path.join(ROOT, 'src', 'seats_daily.js');
  check('资金属性/亏钱效应：src/pain.js 与 src/seats_daily.js 存在（口径唯一出处）',
    existsSync(painPath) && existsSync(sdPath), '');

  const painMod = await import(pathToFileURL(painPath).href);
  const sdMod = await import(pathToFileURL(sdPath).href);

  // ① 真调用：空行情 → 翻绿比例必须是 null（不是 0）
  const emptyPerf = painMod.prevZtPerformance({}, ['600000', '000001']);
  check('亏钱效应：无行情时翻绿比例为 null（"不知道"≠"全部上涨"）',
    emptyPerf.lossRatio === null && emptyPerf.avg === null,
    `lossRatio=${emptyPerf.lossRatio}`);

  // ② 真调用：+null 陷阱 —— changePct 为 null 不得被当成 0
  const nullQ = { A: { changePct: null }, B: { changePct: 10 }, C: { changePct: -10 } };
  const nullPerf = painMod.prevZtPerformance(nullQ, ['A', 'B', 'C']);
  check('亏钱效应：changePct 为 null 不得被当成 0（+null===0 陷阱）',
    nullPerf.n === 2 && nullPerf.lossRatio === 0.5,
    `n=${nullPerf.n} lossRatio=${nullPerf.lossRatio}（分母被 null 污染会让翻绿比例失真）`);

  // ③ 分级中性带：49% 翻绿不得判成"接力顺畅"
  const mid = painMod.painVerdict({ lossRatio: 0.49, reliable: true }, { failRate: 0.4, reliable: true });
  check('亏钱效应：49% 翻绿判"多空拉锯"而非"接力顺畅"（中性带起效）',
    mid.level === 'normal', `level=${mid.level}`);

  // ④ 静态度量不变量：pain.js 不得从 hot 抽涨跌幅（源码级硬约束）
  const painSrc = readFileSync(painPath, 'utf8');
  const painCode = stripCommentsAud(painSrc);
  check('亏钱效应：pain.js 未从 hot 列表抽 change_pct（会造成假繁荣）',
    !/hot[\s\S]{0,40}?change_pct/.test(painCode), '');

  // ⑤ 真调用：席位缺卖侧 → 净额 null（不得只减一半）
  const halfRow = sdMod.seatRowOf({ trade_date: 'x', summary: { seats: { inst_buy: 10, north_buy: 5, hot_buy: 3, cover: 50 } } });
  check('资金属性：缺卖侧时净额为 null（不得得出假净额）',
    halfRow.instNet === null && halfRow.hasSell === false,
    `instNet=${halfRow.instNet}`);

  // ⑥ 真调用：null 净额不得被算成 0
  const nullRow = sdMod.seatRowOf({ trade_date: 'x', summary: { seats: { inst_buy: null, inst_sell: null, north_buy: null, north_sell: null, hot_buy: null, hot_sell: null, cover: 100 } } });
  check('资金属性：null 买入额不得被算成 0 净额（+null===0 陷阱）',
    nullRow.instNet === null, `instNet=${nullRow.instNet}`);

  // ⑦ 真调用：无 seats 的天整行 null（不得填 0）
  const noSeat = sdMod.seatRowOf({ trade_date: 'y', summary: {} });
  check('资金属性：无席位数据的天净额为 null（"多空抵消"≠"没数据"）',
    noSeat.ok === false && noSeat.instNet === null && noSeat.hotNet === null, '');

  // ⑧ 序列默认滤空行（体积 + 可读性）；覆盖率分母须由 totalDays 给出
  const ser = sdMod.buildSeatSeries([{ trade_date: 'a', summary: {} }, { trade_date: 'b', summary: { seats: { inst_buy: 1, inst_sell: 0, north_buy: 0, north_sell: 0, hot_buy: 0, hot_sell: 0, cover: 100 } } }]);
  check('资金属性：序列默认滤掉无数据的天（避免空行撑爆轻量档）',
    ser.length === 1 && ser[0].date === 'b', `len=${ser.length}`);
  const smNoTotal = sdMod.seatSeriesSummary(ser);
  const smWith = sdMod.seatSeriesSummary(ser, { totalDays: 100 });
  check('资金属性：无 totalDays 时覆盖率为 null（不得虚报 100%）',
    smNoTotal.coverage === null && smWith.coverage === 0.01,
    `null→${smNoTotal.coverage} withTotal→${smWith.coverage}`);

  // ⑨ signals-latest.json 必须带 seats / pain 段（前端据此渲染）
  const sigPath2 = path.join(ROOT, 'data', 'signals-latest.json');
  if (existsSync(sigPath2)) {
    const sig2 = JSON.parse(readFileSync(sigPath2, 'utf8'));
    check('资金属性/亏钱效应：signals-latest 带 seats 段',
      !!sig2.seats && Array.isArray(sig2.seats.series) && !!sig2.seats.verdict,
      `seats=${sig2.seats ? 'ok' : '缺'}`);
    // pain 依赖收盘后跑脚本，可能为 null——但只要是非 null 就必须结构完整
    const painOk = sig2.pain == null || (!!sig2.pain.perf && !!sig2.pain.verdict);
    check('资金属性/亏钱效应：signals-latest 的 pain 段结构完整（或为 null）',
      painOk,
      sig2.pain == null ? '' : 'pain 段缺 perf/verdict');
  }

  // ⑩ 前端不得重算（第二套口径）
  const appSrcP = readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const appCodeP = stripCommentsAud(appSrcP);
  check('资金属性/亏钱效应：前端未自行实现 painReport / 席位聚合',
    !/function\s+painReport\b/.test(appCodeP) && !/inst_buy\s*-\s*inst_sell/.test(appCodeP), '');

  // ⑪ 两条写盘路径都必须注入 seatSeriesFn（同源同形态）
  const pipeSrcS = readFileSync(path.join(ROOT, 'src', 'pipeline.js'), 'utf8');
  const splitSrcS = readFileSync(path.join(ROOT, 'scripts', 'split_archive.mjs'), 'utf8');
  check('资金属性：pipeline 与 split_archive 两条路径都注入 seatSeriesFn（形态一致）',
    /seatSeriesFn:/.test(pipeSrcS) && /seatSeriesFn:/.test(splitSrcS), '');

  // ⑫ ★ 全仓回归守卫：禁止对**数据字段**裸用 `Number.isFinite(+v)`。
  //    本块新增这个守卫的直接原因：本轮在 pain.js 与 seats_daily.js **各踩一次**
  //    （null → 0），而 src/alerts.js / alert_log.js 早已记录该陷阱。
  //
  //    精度说明：只查"对可空**数据**取值后判有限"这一形状。内部受控参数
  //    （如 opts.window / opts.totalDays，调用方不会传 null 语义）不算——把它们
  //    一起禁掉会逼出无意义的写法，守卫反而会被绕过。故：变量名以 opts. 开头、
  //    或本身就来自本模块内部常量/已判过的量，一律放行。
  const risky = [];
  for (const f of ['pain.js', 'seats_daily.js', 'health.js']) {
    const p = path.join(ROOT, 'src', f);
    if (!existsSync(p)) continue;
    const raw = stripCommentsAud(readFileSync(p, 'utf8'));
    raw.split(/\r?\n/).forEach((ln, i) => {
      if (!/Number\.isFinite\(\s*\+/.test(ln)) return;
      if (/==\s*null|!=\s*null|typeof/.test(ln)) return;        // 已有空值前置 → 安全
      if (/Number\.isFinite\(\s*\+\s*opts\./.test(ln)) return;  // 受控参数 → 放行
      if (/Number\.isFinite\(\s*\+\s*[a-zA-Z_$]+\.\w+/.test(ln) === false
        && /Number\.isFinite\(\s*\+\s*v\b/.test(ln)) return;    // 已由 num() 包过的 v
      risky.push(`${f}:${i + 1} ${ln.trim().slice(0, 60)}`);
    });
  }
  check('数值纪律：数据字段判定不得裸用 Number.isFinite(+v)（null 会被算成 0）',
    risky.length === 0, risky.length ? `疑似裸用：\n      ${risky.join('\n      ')}` : '');
  // ⑬ CI 必须把亏钱效应快照一起提交（漏了就是"本地算了、线上看不见"）。
  //    与 archive 切片同理：脚本产出物不进提交清单，线上就永远停留在初始状态，
  //    而页面上只会表现为"这块一直没数据"，不会报错 —— 正是最难归因的一类故障。
  const wfSrcP = readFileSync(path.join(ROOT, '.github', 'workflows', 'daily.yml'), 'utf8');
  check('亏钱效应：CI 提交清单含 data/pain-latest.json（漏了＝线上永远没有该面板）',
    /data\/pain-latest\.json/.test(wfSrcP), '');
  // ⑭ CI 必须跑抓取步（否则 signals 里 pain 恒为 null）
  check('亏钱效应：CI 含 fetch_pain 抓取步（否则 signals 里 pain 恒为 null）',
    /scripts\/fetch_pain\.mjs/.test(wfSrcP), '');
}

// ── C. 结论 ────────────────────────────────────────────────────────────────
if (warns.length) for (const w of warns) console.log(`⚠ ${w}`);
if (fails.length) {
  console.error(`\n[audit-lhb-caliber] 失败 ${fails.length} 项：${fails.join('、')}`);
  console.error('提示：若为存档问题，用 node scripts/recalc_lhb_daily.mjs 全档重算；若为源码问题，禁止自行相加，走 src/lhb.js。');
  process.exit(1);
}
console.log(`\n[audit-lhb-caliber] 通过：${days.length} 个交易日、双口径可重现、因子锁定当日榜口径。`);
