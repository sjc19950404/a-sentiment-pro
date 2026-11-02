// 收盘后抓取「亏钱效应」所需的真实行情，产出 data/pain-latest.json。
//
// 为什么单独成脚本、且必须走真实行情：
//   昨涨停今日表现**不能**用 archive.hot 算——hot 是涨幅榜，实测 2026-09-30 的 56 只
//   hot 里涨跌幅最小 9.87、低于 0 的有 0 只。用它会静默丢弃"昨涨停里今天下跌的那一半"，
//   结果**每天都是 +10%**（实测 17 天全在 +9.98~+11.44，"假繁荣"恒成立）。
//   只有拉全市场真实行情，才能看见翻绿的那 49%。
//
// 用法：
//   node scripts/fetch_pain.mjs                # 用档案最后一天作"昨日"，抓今日行情
//   node scripts/fetch_pain.mjs --prev 2026-09-29 --date 2026-09-30
//   node scripts/fetch_pain.mjs --dry          # 只打印不写盘
//
// ⚠ 必须在**收盘后**运行（含 ca盘后固定价格成交），否则拿到的是盘中快照，
//   翻绿比例会随分时波动。脚本会校验行情 tickDate 与目标日一致，不一致则拒绝写盘。
// ⚠ P0-1（2026-10-10）：校验失败一律 [CRITICAL] + exit 1（诚实红）——原 exit 2
//   被 daily.yml continue-on-error 吞掉后零可见性，断供整周才被 10-08 报告事故
//   暴露（候选池连板数全取自 9-29 口径）。收尾 freshness 探针（--require-fresh）
//   会把「pain 今日未刷新」红出来，双保险。
import { readFileSync, writeFileSync } from 'node:fs';
import { atomicWriteJSON } from '../src/fsutil.js';
import { painReport } from '../src/pain.js';
import { fetchQuotes } from '../src/quote.js';
import { decodeArchive } from '../src/lhb_codec.js';
import { resolveHolidays, isTradingDay } from '../src/calendar.js';

const FILE = 'data/archive.json';
const OUT = 'data/pain-latest.json';
const DRY = process.argv.includes('--dry');
const argOf = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };

const a = decodeArchive(JSON.parse(readFileSync(FILE, 'utf8')));
const days = a.all_days.filter((d) => d && d.trade_date);
if (!days.length) { console.error('[pain] 档案为空'); process.exit(1); }

const wantDate = argOf('--date');
const prevArg = argOf('--prev');

// 昨日 = 显式指定，或"倒数第二个交易日"（最后一天是今日，需其行情）
let curIdx = wantDate ? days.findIndex((d) => d.trade_date === wantDate) : days.length - 1;
if (curIdx < 0) { console.error('[pain] 未找到日期', wantDate); process.exit(1); }
const curDay = days[curIdx];
const prevDay = prevArg
  ? days.find((d) => d.trade_date === prevArg)
  : days[curIdx - 1];

if (!prevDay || !prevDay.summary) {
  console.error('[pain] 找不到"昨日"存档（无可比对对象）');
  process.exit(1);
}

const prevZt = Array.isArray(prevDay.summary.zt_codes) ? prevDay.summary.zt_codes.map(String) : [];
const lbCodes = Object.keys(prevDay.summary.zt_lb || {});
// 需要行情的票：昨日涨停全部 + 昨日高位板（并集，去重）。只抓这些，不拉全市场。
const need = [...new Set([...prevZt, ...lbCodes])];
console.log(`[pain] 昨日 ${prevDay.trade_date}（涨停 ${prevZt.length} 只、连板票 ${lbCodes.length} 只）`
  + ` → 今日 ${curDay.trade_date}，需抓 ${need.length} 只行情`);

if (!need.length) {
  console.error('[pain] 昨日无涨停/连板名单，无法计算');
  process.exit(1);
}

// ④ 非交易日运行防线（2026-10-08 假期旧对事故，2026-10-11 加）：
//   10-07（国庆假期中）运行 → archive 末档 9-30 被当「今日」、9-29 被当「昨日」，
//   于是写出「9-29 涨停 → 9-30 表现」这个**旧对**，顶替了 10-08 真正该有的
//   「9-30 涨停 → 10-08 表现」（节后首日恰恰最有信号价值）。防线③拦不住：假期里
//   curDay 与行情自证的最新成交日**都是 9-30**，两者相等即放行——它看不见"后面
//   还有个 10-08 要来"。唯一能识别"现在是假期"的信号是运行日本身。
//   ⇒ 运行日（北京）不在交易日序列 → 拒绝落盘，宁缺毋假。
//   · CI 不受影响：build job 只由北京 18:30 / 21:00 两条 cron（均限 * * 1-5）
//     触发，运行日必是交易日当日；次日 04:30 美股档 cron 已被 build 的 if 排除；
//   · --date 显式补算豁免：事后补历史档，运行日非交易日属正常；
//   · 放在 fetchQuotes 之前——假期运行当场拒绝，不白抓行情、不写脏档。
if (!wantDate) {
  const bjToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  // ⚠ 用真实交易日历判定运行日（含调休补班），不再依赖档案自身交易日列表——
  // 否则盘前 eod 在档案尚未归档"今天"时，会把真交易日误判为非交易日而拒写盘，
  // 连带 pain 定格在旧日 → 新鲜度守卫判陈旧 → 面板恒 null（2026-10-22 即此形态）。
  if (!isTradingDay(bjToday, resolveHolidays())) {
    console.error(`[CRITICAL] fetch_pain 拒绝写盘：运行日 ${bjToday}（北京）非交易日（周末/假期）——`
      + `会以 archive 末档 ${curDay.trade_date} 当「今日」、${prevDay.trade_date}`
      + ` 当「昨日」，写出旧对冒充当日（2026-10-07 即此形态：9-29→9-30 顶替 9-30→10-08）。`
      + '请在交易日收盘后运行，或用 --date <交易日> 显式补算；断供期报告按 P0-2 显示'
      + '「缺席」而非旧口径。');
    process.exit(1);
  }
}

const { quotes, failed } = await fetchQuotes(need);
console.log(`[pain] 行情取到 ${Object.keys(quotes).length}/${need.length}${failed.length ? `，失败 ${failed.length}` : ''}`);

// P0-1 取数校验（2026-10-10 用户指令「失败要诚实地红，不要静默地绿」）：
//   ① 行情全空 → [CRITICAL] exit 1（原无此分支：空行情会让 painReport 全样本缺失，
//     却可能静默写出一个"看似平静"的档）；
//   ② tickDate 与目标日不符 → [CRITICAL] exit 1（原 exit 2，且被 daily.yml
//     continue-on-error 吞掉后无任何日志可见性——10-08 断供事故根因）。
//     现打印 tickDate 分布诊断，收尾 freshness 探针（--require-fresh）会接住红。
const dates = new Set(Object.values(quotes).map((q) => q.tickDate).filter(Boolean));
const latestTraded = [...dates].sort().pop() ?? null;
if (!Object.keys(quotes).length) {
  console.error('[CRITICAL] fetch_pain 失败：行情全部取不到（requested ' + need.length + ' 只）'
    + '——拒绝写盘，pain-latest 维持原值；离线模块门禁将红（诚实红，不静默）');
  process.exit(1);
}
if (!dates.has(curDay.trade_date)) {
  console.error(`[CRITICAL] fetch_pain 失败：行情最新成交日 ${latestTraded ?? '无'} ≠ 目标日 ${curDay.trade_date}`
    + `（tickDate 分布：${[...dates].join('/')}；失败 ${failed.length} 只）——拒绝写盘`
    + '（请在收盘后运行；archive 当日档若未就绪属上游滞后，收尾门禁会一并红）');
  process.exit(1);
}
// ③ 档案滞后防线：默认模式（未显式 --date 补算）下，archive 末档必须就是行情自证的
//   「最近已收盘交易日」（腾讯快照 max(tickDate)），否则会用旧对（prev→cur 双旧）
//   生成看似新鲜的 pain——10-07 假期运行即此形态（9-29→9-30 顶替了 9-30→10-08）。
if (!wantDate && latestTraded && curDay.trade_date !== latestTraded) {
  console.error(`[CRITICAL] fetch_pain 失败：archive 末档 ${curDay.trade_date} 落后于最近已收盘交易日 ${latestTraded}`
    + '——当日档未入档案，拒绝用旧对生成 pain（宁缺毋假）；请先跑完管道再补 fetch_pain');
  process.exit(1);
}

const report = painReport(prevDay, quotes, {});
report.generatedAt = new Date().toISOString();
report.curDate = curDay.trade_date;

console.log('\n=== 亏钱效应 ===');
console.log(`昨涨停今日表现: 均 ${report.perf.avg}% / 中位 ${report.perf.median}% / 翻绿 ${(report.perf.lossRatio * 100).toFixed(0)}%`
  + ` / 再涨停 ${report.perf.limitUpAgain} / 跌停 ${report.perf.limitDown} / 大面 ${report.perf.bigLoss}`);
console.log(`连板晋级: 失败率 ${(report.advance.failRate * 100).toFixed(0)}% 最高板 ${report.advance.maxLb}`
  + ` | 分层 ${JSON.stringify(report.advance.byTier)}`);
console.log(`大面股 ${report.bigLoss.n} 只 / 天地板 ${report.skyFloor.n} 只`);
console.log(`★ ${report.verdict.label} — ${report.verdict.reason}`);

if (DRY) { console.log('\n[pain] --dry，未写盘'); } else {
  atomicWriteJSON(OUT, JSON.stringify(report, null, 1));
  console.log(`\n[pain] 已写出 ${OUT}`);
}
