// 数据新鲜度 CLI（离线，不联网）——用来回答「数据到底滞没滞后」，而不是只看 meta.stale 这个旧标记。
//
//   node scripts/freshness.mjs                 查看判定（只读，不改文件）
//   node scripts/freshness.mjs --write         把判定字段写回存档（只动 meta，绝不碰数据）
//   node scripts/freshness.mjs --require-fresh 判定为 behind（真滞后）时以退出码 1 结束，供 CI 当门禁
//   node scripts/freshness.mjs --archive <p>   指定存档路径（默认 data/archive.json）
//
// 为什么需要它：管道在「跳过 / 非交易日」路径上不产生新数据，旧口径只在那时保留 meta 不动，
// 于是 stale 会粘着不动（页面长期误报）。这个脚本可按同一套日历口径重算并刷新。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../src/config.js';
import { assessFreshness, applyFreshnessMeta, applyPhaseMeta, marketPhase, PHASE_NOTE,
  freshnessKey, bjDate, bjTime, staleReasonText } from '../src/freshness.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const REQUIRE_FRESH = argv.includes('--require-fresh');
const ai = argv.indexOf('--archive');
const P = resolve(ai >= 0 ? argv[ai + 1] : join(ROOT, 'data', 'archive.json'));

const nowArg = argv.indexOf('--at'); // 测试用：按指定时刻评估
const now = nowArg >= 0 ? new Date(argv[nowArg + 1]) : new Date();

if (!existsSync(P)) {
  console.error('[freshness] 未找到存档:', P);
  process.exit(2);
}
const a = JSON.parse(readFileSync(P, 'utf8'));
const meta = a.meta || {};
const tradeDate = meta.tradeDate
  || a.signals?.tradeDate
  || (a.all_days || []).slice(-1)[0]?.trade_date
  || null;

const f = assessFreshness({ tradeDate }, now, config.manualHolidays);
const ph = marketPhase(now, config.manualHolidays);
const STATE_TEXT = {
  fresh: '数据为最新已收盘会话',
  pending: '落后 1 个交易日，但预期更新时刻未到（正常等待 18:30 首抓 / 21:00 补抓）',
  behind: '已过预期更新时刻仍然落后（真滞后，需处置）',
  unknown: '存档无交易日信息',
};
const PHASE_TEXT = {
  pre: '开盘前（今日行情尚未产生）',
  live: '盘中（行情实时可得，但情绪分/分位/因子仍为上一收盘日口径）',
  closed: '收盘后 / 非交易日（当日已定盘）',
};

console.log('[freshness] 存档', P);
console.log('  评估时刻（北京）  ', bjDate(now), bjTime(now));
console.log('  市场相位 phase    ', ph.phase, '→', PHASE_TEXT[ph.phase] || '', ph.isTradingDay ? '(交易日)' : '(非交易日)');
console.log('  相位口径说明      ', PHASE_NOTE[ph.phase] || '');
console.log('  存档交易日        ', tradeDate ?? '(无)');
console.log('  最近已收盘交易日  ', f.latestClosed ?? '(无)');
console.log('  落后交易日数      ', f.behindSessions);
console.log('  预期更新时刻      ', f.publishDeadline
  ? `${f.publishDeadline}（北京 ${bjDate(new Date(f.publishDeadline))} ${bjTime(new Date(f.publishDeadline))}）`
  : '(无)');
console.log('  判定              ', f.state, '→', STATE_TEXT[f.state] || '');
console.log('  旧字段 meta.stale ', meta.stale === true ? 'true（在旧口径下写入，可能已过时）' : String(meta.stale));
if (meta.fallbackReason) console.log('  上次回退原因      ', meta.fallbackReason);
if (meta.lastAttempt) console.log('  最近一次尝试      ', `${meta.lastAttempt.outcome} @ ${meta.lastAttempt.at}${meta.lastAttempt.reason ? ' | ' + meta.lastAttempt.reason : ''}`);
if (meta.note) console.log('  数据说明(note)    ', meta.note);
console.log('  判定依据          ', `交易日历含 ${config.manualHolidays.length} 个手动休市日；收盘 15:00；预期更新 19:30`);

if (WRITE) {
  const before = freshnessKey(meta);
  const nf = applyFreshnessMeta(meta, tradeDate, now, config.manualHolidays, {
    outcome: 'freshness-cli',
    reason: 'scripts/freshness.mjs --write 重算判定',
  });
  applyPhaseMeta(meta, now, config.manualHolidays);
  if (freshnessKey(meta) === before) {
    console.log('[freshness] 判定字段无实质变化，未写入');
  } else {
    writeFileSync(P, JSON.stringify(a, null, 2), 'utf8');
    console.log('[freshness] 已写回判定字段 →', nf.state, '| phase =', meta.phase, '| stale =', nf.stale,
      staleReasonText(nf) ? '| ' + staleReasonText(nf) : '');
  }
}

if (REQUIRE_FRESH && f.state === 'behind') {
  console.error(`[freshness] 门禁失败：数据滞后 —— ${staleReasonText(f)}`);
  process.exit(1);
}
