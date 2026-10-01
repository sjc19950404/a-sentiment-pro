// 生成 archive 切片：archive-index.json + archive-YYYY.json
//
// 常规路径下**不需要单独跑本脚本**——src/pipeline.js 的 writeArchive 每次写主档时
// 会顺带生成切片（保证同源）。本脚本用于：① 存量主档首次拆分；② 切片丢失后重建；
// ③ CI 守卫校验切片与主档一致。
//
// 用法：
//   node scripts/split_archive.mjs            # 由 data/archive.json 生成切片
//   node scripts/split_archive.mjs --check    # 只校验一致性，不写盘（CI 用）
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { buildIndex, buildShards, shardName, buildRecent, buildSignals, RECENT_DAYS, RECENT_FILE, SIGNALS_FILE } from '../src/archive_split.js';
import { buildReasonCodes, encodeArchive, decodeArchive } from '../src/lhb_codec.js';
import { marketAlerts } from '../src/alerts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DATA = join(ROOT, 'data');
const MAIN = join(DATA, 'archive.json');
const INDEX = join(DATA, 'archive-index.json');

const check = process.argv.includes('--check');

if (!existsSync(MAIN)) {
  console.error(`[split] 找不到 ${MAIN}`);
  process.exit(1);
}
// 主档是码表压缩态 → 必须先 decode 才能重建切片（否则切片里也是下标，
// 前端拿到就没法渲染 reason 文本）。切片重新编码时用**同一份**码表，保证前后一致。
const raw = JSON.parse(readFileSync(MAIN, 'utf8'));
const arc = decodeArchive(raw);
const codes = Array.isArray(raw?.meta?.reasonCodes) && raw.meta.reasonCodes.length
  ? raw.meta.reasonCodes
  : buildReasonCodes(arc.all_days);
// ⚠ 必须传 { deflate: true }，与主档落盘态（pipeline.writeArchive / writeArchiveSafely）
//   保持同一种形态。历史坑：此处曾漏传，于是 decodeArchive 把 _sub.lhb 还原成顶层 lhb 后
//   直接进了滚动窗，`latest.lhb` 变成内联——首屏体积白涨，且 --check 会报
//   "滚动窗 latest.lhb 未提子"。三种写盘路径（主档 / 本脚本 / writeArchiveSafely）
//   必须产出完全一致的形态，否则同源切片就成了"两种口径"。
const packed = encodeArchive(arc, codes, { deflate: true });
const index = buildIndex(packed);
const shards = buildShards(packed);
const recent = buildRecent(packed, RECENT_DAYS);
const signals = buildSignals(packed, { assumedTotal: 100000, marketAlertsFn: marketAlerts });
const years = Object.keys(shards).sort();

const kb = (o) => (Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(1);
console.log(`[split] 主档 ${arc.all_days.length} 天 · ${years.length} 个年份分片 · 码表 ${codes.length} 条`);
// 主档里有多少天带席位明细：用于校验切片"没有把 seats 优化掉"（见下 --check）
const hasSeatsInMain = arc.all_days.some((d) => d.summary?.seats);

if (check) {
  // 一致性校验：切片必须能还原出与主档逐日一致的 all_days
  const problems = [];
  if (!existsSync(INDEX)) problems.push('缺少 archive-index.json');
  else {
    const idx = JSON.parse(readFileSync(INDEX, 'utf8'));
    if (idx.totalDays !== arc.all_days.length) {
      problems.push(`index.totalDays=${idx.totalDays} 与主档 ${arc.all_days.length} 不符`);
    }
    if (idx.latestDate !== (arc.all_days[arc.all_days.length - 1] || {}).trade_date) {
      problems.push('index.latestDate 与主档最新日不符');
    }
  }
  let shardDays = 0;
  for (const y of years) {
    const p = join(DATA, shardName(y));
    if (!existsSync(p)) { problems.push(`缺少分片 ${shardName(y)}`); continue; }
    const sh = JSON.parse(readFileSync(p, 'utf8'));
    if (sh.year !== y) problems.push(`${shardName(y)} 的 year 字段=${sh.year}`);
    shardDays += sh.all_days.length;
  }
  if (shardDays !== arc.all_days.length) {
    problems.push(`分片合计 ${shardDays} 天 ≠ 主档 ${arc.all_days.length} 天`);
  }
  // 滚动窗：v2 起为**两级分层**——`days` 是画曲线的最小字段，`latest` 是最新日完整明细。
  // 校验必须按新结构查：日期序列 = days 的日期 + latest 的日期。
  const rp = join(DATA, RECENT_FILE);
  if (!existsSync(rp)) problems.push(`缺少滚动窗 ${RECENT_FILE}`);
  else {
    const rc = JSON.parse(readFileSync(rp, 'utf8'));
    const expect = arc.all_days.slice(-RECENT_DAYS).map((d) => d.trade_date);
    const got = [...(rc.days || []).map((d) => d.trade_date),
      ...(rc.latest ? [rc.latest.trade_date] : [])];
    if (JSON.stringify(expect) !== JSON.stringify(got)) {
      problems.push(`滚动窗日期与主档尾部不符（期望 ${expect.length} 天，实得 ${got.length} 天）`);
    }
    // latest 必须是完整明细（含 hot/lhb_aggr），否则前端渲染表格会空
    if (!rc.latest?.hot?.length && !rc.latest?.lhb_aggr?.length) {
      problems.push('滚动窗 latest 缺 hot/lhb_aggr 明细（前端表格会空）');
    }
    // 惰性字段（目前只有 lhb）不得内联到 latest 顶层——一旦内联，首屏体积会白涨。
    if (rc.latest && rc.latest.lhb != null) {
      problems.push('滚动窗 latest.lhb 未提子（应留在 _sub）');
    }
    // seats **必须**内联：研判报告的「席位分项 / 锁仓统计」在首屏就要用，
    // 提走会让那两段静默消失（见 src/lhb_codec.js）。这条是防"又把它优化掉"。
    if (rc.latest && !rc.latest.summary?.seats && hasSeatsInMain) {
      problems.push('滚动窗 latest 丢了 summary.seats（首屏研判报告要用，不得作为惰性字段剥离）');
    }
  }
  // 最轻档：必须存在、必须只含一天、体积必须 < 32KB（否则"最轻"名不副实）
  const sp = join(DATA, SIGNALS_FILE);
  if (!existsSync(sp)) problems.push(`缺少最轻档 ${SIGNALS_FILE}`);
  else {
    const sb = Buffer.byteLength(readFileSync(sp, 'utf8'), 'utf8');
    if (sb > 32 * 1024) problems.push(`${SIGNALS_FILE} 体积 ${(sb / 1024).toFixed(1)}KB 超过 32KB 上限`);
    const sg = JSON.parse(readFileSync(sp, 'utf8'));
    if (sg.kind !== 'signals-latest') problems.push(`${SIGNALS_FILE}.kind=${sg.kind}`);
    if (sg.latest && sg.latest.trade_date !== arc.all_days[arc.all_days.length - 1].trade_date) {
      problems.push(`${SIGNALS_FILE}.latest 不是最新交易日`);
    }
    // 最轻档绝不允许夹带明细——一旦夹带，它和 recent 就没区别了
    for (const k of ['all_days', 'days', 'hot', 'lhb', 'lhb_aggr']) {
      if (sg[k] !== undefined) problems.push(`${SIGNALS_FILE} 夹带了明细字段 ${k}`);
    }
  }
  if (problems.length) {
    console.error(`[split] ✗ 切片与主档不一致：\n  · ${problems.join('\n  · ')}`);
    process.exit(1);
  }
  console.log(`[split] ✓ 一致：index + ${years.length} 分片 + 滚动窗，共 ${shardDays} 天与主档吻合`);
  console.log(`[split]   index ${kb(index)}KB · recent ${kb(recent)}KB · ${years.map((y) => y + ':' + kb(shards[y]) + 'KB').join(' / ')}`);
  console.log(`[split]   首屏成本 index ${kb(index)}KB · 开走势图 +${kb(recent)}KB · 最轻档 ${kb(signals)}KB`);
  process.exit(0);
}

// 清理旧分片：年份集合可能变化（如新增年份、或删掉某年），残留文件会被前端误读
const existing = readdirSync(DATA).filter((f) => /^archive-\d{4}\.json$/.test(f));
for (const f of existing) {
  const y = f.slice('archive-'.length, -'.json'.length);
  if (!shards[y]) {
    unlinkSync(join(DATA, f));
    console.log(`[split] 删除过期分片 ${f}（该年已不在档案中）`);
  }
}

writeFileSync(INDEX, JSON.stringify(index), 'utf8');
console.log(`[split] 写出 archive-index.json ${kb(index)}KB`);
for (const y of years) {
  writeFileSync(join(DATA, shardName(y)), JSON.stringify(shards[y]), 'utf8');
  console.log(`[split] 写出 ${shardName(y)} ${kb(shards[y])}KB · ${shards[y].all_days.length} 天`);
}
writeFileSync(join(DATA, RECENT_FILE), JSON.stringify(recent), 'utf8');
console.log(`[split] 写出 ${RECENT_FILE} ${kb(recent)}KB · 曲线 ${recent.days.length} 点 + 最新日 ${recent.latest ? recent.latest.trade_date : '—'}`);
if (signals) {
  writeFileSync(join(DATA, SIGNALS_FILE), JSON.stringify(signals), 'utf8');
  console.log(`[split] 写出 ${SIGNALS_FILE} ${kb(signals)}KB · 最新日 + 动量 + 大盘告警 ${signals.marketAlerts ? signals.marketAlerts.length : 0} 条`);
}
const total = [index, recent, signals, ...years.map((y) => shards[y])]
  .filter(Boolean).reduce((a, o) => a + Buffer.byteLength(JSON.stringify(o), 'utf8'), 0);
console.log(`[split] 切片合计约 ${(total / 1024).toFixed(1)}KB（主档 ${(Buffer.byteLength(readFileSync(MAIN)) / 1024).toFixed(1)}KB）`);
