// 档案「缺交易日」检测（2026-10-11 加）
//
// 为什么要这个：2026-10-09 那天**整档缺失**，是我翻数据时偶然发现的——
//   archive 末档停在 10-08，而日历覆盖到 10-09。起因是 10-10 那次 run cancelled，
//   而 daily.yml 里没有任何 backfill 调度，于是这一天**永久缺失且无人知晓**。
//   同理还有历史遗留的 30 天字段缺口（2026-08-14~09-03 整池、09-04~09-24 涨跌家数）。
//   这些"静默缺失"的共同点：数据不对，但没人知道。本脚本把它变成**红出来**。
//
// 判据（宁缺毋假，但也**不误报**——误报会让人习惯性忽略告警，等于没有）：
//   交易日 = 覆盖区间内的**工作日** − 休市日（calendar.json 的 closed 集合）
//   ⚠ calendar.json 的 trading 数组是空的、days 对象只记 "closed" ——
//     所以交易日必须自己算，不能读现成列表（这是本脚本唯一的非显然处）。
//   缺失 = 交易日 ∉ archive 的 trade_date
//   ① **不含今天**：今天的数据可能尚未采集（管道未跑 / 盘中未收），不算缺失；
//   ② **只看最近 N 个交易日**（默认 30，--days N 调整，--all 看全部）：
//      更老的是已知历史遗留，由 backfill_gaps.mjs 管，混进来会淹没新缺口。
//
// 用法：
//   node scripts/audit_archive_gaps.mjs            # 人类可读；有缺失 exit 1
//   node scripts/audit_archive_gaps.mjs --json     # 机读（供告警脚本消费）
//   node scripts/audit_archive_gaps.mjs --days 60 / --all
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodeArchive } from '../src/lhb_codec.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const flag = (n) => args.includes(`--${n}`);

const ALL = flag('all');
const LOOKBACK = ALL ? 0 : Number(arg('days') || 30);
const WANT_JSON = flag('json');
// --out 自落盘（UTF-8 恒定）：不依赖 shell 重定向——重定向编码随宿主而变
//   （PowerShell 默认 UTF-16、部分环境 UTF-8 BOM，都会让下游 JSON.parse 失败，
//   caliber 那条已实测踩过一次，不再重蹈）。
const OUT = arg('out');

/** 北京今天（YYYY-MM-DD）。8 小时偏移直接取 UTC 日期串，避免时区库依赖。 */
export function bjToday(at = Date.now()) {
  return new Date(at + 8 * 3600e3).toISOString().slice(0, 10);
}

function eachDate(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out;
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/** [from, to] 内的交易日：工作日（周一~周五）且不在休市日集合里。 */
export function tradingDaysInRange({ from, to, closed }) {
  const c = new Set(Array.isArray(closed) ? closed : []);
  return eachDate(from, to).filter((d) => {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    return wd >= 1 && wd <= 5 && !c.has(d);
  });
}

/**
 * 纯函数：算缺失交易日（可单测，不碰文件系统）。
 * @param {{coveredFrom:string, coveredTo:string, closed:string[]}} calendar
 * @param {string[]} archiveDates 档案里已有的 trade_date
 * @param {string} today 北京今天（注入，便于测"今天不算缺失"）
 * @param {number} lookback 只报最近 N 个交易日窗口内的缺失；0 = 全部
 */
export function findMissingTradeDays({ calendar, archiveDates, today = bjToday(), lookback = 30 }) {
  const from = calendar && calendar.coveredFrom;
  const to = calendar && calendar.coveredTo;
  // ① 上界取「昨天」：今天尚未采集不算缺失
  const yd = new Date(`${today}T00:00:00Z`);
  yd.setUTCDate(yd.getUTCDate() - 1);
  const yesterday = yd.toISOString().slice(0, 10);
  if (!from || !to) return { window: [], missing: [], recentMissing: [], traded: 0 };
  const upper = to < yesterday ? to : yesterday;
  if (upper < from) return { window: [], missing: [], recentMissing: [], traded: 0 };

  const traded = tradingDaysInRange({ from, to: upper, closed: calendar.closed });
  const have = new Set(archiveDates || []);
  const missing = traded.filter((d) => !have.has(d));
  // ② 只看最近 lookback 个交易日的窗口
  const window = lookback > 0 ? traded.slice(-lookback) : traded;
  const wset = new Set(window);
  return {
    traded: traded.length,
    window,
    missing,
    recentMissing: missing.filter((d) => wset.has(d)),
    coveredTo: to,
    archiveLast: (archiveDates || []).slice().sort().slice(-1)[0] || null,
  };
}

// ── CLI ──（仅直接运行时执行。单测要 import 上面的纯函数，若此处无条件跑，
//   读档 + process.exit 会让测试进程直接死掉——这是必须加的守卫。）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const CAL = path.join(ROOT, 'data', 'calendar.json');
  const MAIN = path.join(ROOT, 'data', 'archive.json');
  if (!existsSync(CAL) || !existsSync(MAIN)) {
    console.error('[gap-days] 缺 data/calendar.json 或 data/archive.json');
    process.exit(1);
  }
  const cal = JSON.parse(readFileSync(CAL, 'utf8').replace(/^﻿/, ''));
  const arch = decodeArchive(JSON.parse(readFileSync(MAIN, 'utf8').replace(/^﻿/, '')));
  const dates = (arch.all_days || []).map((d) => d && d.trade_date).filter(Boolean);
  const r = findMissingTradeDays({ calendar: cal, archiveDates: dates, lookback: LOOKBACK });

  if (WANT_JSON) {
    const payload = JSON.stringify({ ok: r.recentMissing.length === 0, ...r, generatedAt: new Date().toISOString() }, null, 2);
    console.log(payload);
    if (OUT) writeFileSync(OUT, payload, 'utf8');
  } else if (r.recentMissing.length) {
    console.error(`[gap-days] ✗ 档案缺 ${r.recentMissing.length} 个交易日（窗口内共 ${r.window.length} 个交易日）`);
    console.error(`  缺失日期：${r.recentMissing.join(' ')}`);
    console.error(`  档案末档 ${r.archiveLast ?? '无'} · 日历覆盖至 ${r.coveredTo}`);
    console.error(`  窗口外另有 ${r.missing.length - r.recentMissing.length} 天缺失（历史遗留，--all 查看全部）`);
  } else {
    console.log(`[gap-days] ✓ 窗口内 ${r.window.length} 个交易日无缺失（档案末档 ${r.archiveLast ?? '无'}）`);
    if (r.missing.length) console.log(`  （窗口外仍有 ${r.missing.length} 天历史缺失，--all 查看）`);
  }
  process.exit(r.recentMissing.length ? 1 : 0); // 宁红不假
}
