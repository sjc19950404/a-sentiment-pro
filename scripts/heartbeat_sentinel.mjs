#!/usr/bin/env node
// 心跳哨兵（2026-10-16 盘后重构）：每日 08:00 检查关键数据档是否覆盖最近交易日，
// 未覆盖 → 企微"系统停更告警"。设计为 GitHub Actions 定时 job 调用（cron 北京 08:00）。
//
// 判定不依赖"今日时间戳"，而依赖"是否覆盖最近已收盘交易日"——这样在 08:00 检查时，
// 昨日跑出的档（覆盖昨日的 lastClosedSession）不会误报，而真正停更的档（如收盘档停在
// 10-12）会被精确捕捉。这正是要根治的"CI 停更无告警"顽疾。
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessFreshness } from '../src/freshness.js';
import { resolveHolidays } from '../src/calendar.js'; // 交易日历唯一出处（含调休补班三态 + 2026 种子兜底）

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEBHOOK = process.env.OPS_WEBHOOK;
// 节假日感知：此前硬编码 [] 是盲区——会把法定假日当交易日，导致节后首日误报 ①②③。
// 改走 calendar.js 唯一出处（种子 + data/calendar.json + config.manualHolidays 兜底）。
// loadCalendar 在文件缺失时自动回退 manualHolidays，故常态安全；极端崩坏时退回 [] 保哨兵不红死。
const holidays = (() => {
  try { return resolveHolidays(); } catch (e) {
    console.error('[sentinel] 日历解析失败，回退 []（节假日盲区）:', e?.message ?? e);
    return [];
  }
})();

function readJsonSafe(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
function bjDayOf(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
}

const alerts = [];

// ① 收盘档（signals-latest）：数据底座是否停更——用真实现在重算（不读档内陈旧 freshness）
const sig = readJsonSafe(join(ROOT, 'data', 'signals-latest.json'));
if (!sig) {
  alerts.push('① 收盘档缺失：data/signals-latest.json 不存在');
} else {
  const td = sig.meta?.tradeDate || sig.tradeDate || null;
  if (!td) {
    alerts.push('① 收盘档缺 tradeDate 字段');
  } else {
    const f = assessFreshness({ tradeDate: td }, new Date(), holidays);
    if (f.state === 'behind') {
      alerts.push(`① 收盘档停更：tradeDate=${td}，落后 ${f.behindSessions} 个交易日（最近已收盘 ${f.latestClosed}）`);
    }
  }
}

// ② 冒烟档（smoke-latest）：最近交易日是否成功跑过冒烟
const smoke = readJsonSafe(join(ROOT, 'data', 'smoke-latest.json'));
if (!smoke) {
  alerts.push('② 冒烟档缺失：data/smoke-latest.json 不存在（冒烟 job 未跑或路径错）');
} else {
  // 2026-10-19 修复：改用 tradeDateAnchored（getharden 探测的"最近一个有数据的交易日"，
  // 周末/节假日自动回退到上一交易日）——它恒等于"最近已收盘交易日"，与上面节假日感知的
  // latestClosed 天然对齐；用运行日(generatedAt)反而会在节假日把假日当天误判为已收盘。
  const tsDay = bjDayOf(smoke.tradeDateAnchored || smoke.updatedAt || smoke.generatedAt || smoke.meta?.generatedAt);
  const latestClosed = assessFreshness({}, new Date(), holidays).latestClosed;
  const todayBJ = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  if (!tsDay) {
    alerts.push('② 冒烟档缺时间戳，无法判定新鲜度');
  } else if (tsDay !== latestClosed && tsDay !== todayBJ) {
    alerts.push(`② 冒烟档陈旧：tradeDateAnchored=${tsDay}，最近已收盘=${latestClosed} → 冒烟未按预期更新`);
  }
}

// ③ 双轨账本（dualTrack）：asOf 是否覆盖最近交易日——build job 被平台取消源(#200/#201)干掉时，
//   backtest.json 不重算 → paper_dual_track.mjs 不跑 → 双轨随收盘档一起悄停。用 asOf 作代理：
//   若 asOf 落后最近已收盘交易日，说明双轨未刷新。优先读 signals-latest.dualTrack.asOf，
//   缺失则回退 data/paper/dual_track_latest.json 的 day.date。
const dtAsOf = (sig && sig.dualTrack && sig.dualTrack.asOf) || null;
if (!dtAsOf) {
  const dtFile = readJsonSafe(join(ROOT, 'data', 'paper', 'dual_track_latest.json'));
  const dtFallback = ((dtFile && dtFile.day && dtFile.day.date) || (dtFile && dtFile.asOf)) || null;
  if (!dtFallback) {
    alerts.push('③ 双轨账本缺失：signals-latest.json.dualTrack.asOf 与 data/paper/dual_track_latest.json 均无可读日期');
  } else {
    const latestClosed3 = assessFreshness({}, new Date(), holidays).latestClosed;
    if (dtFallback < latestClosed3) {
      alerts.push(`③ 双轨账本停更：asOf=${dtFallback}，落后最近已收盘 ${latestClosed3}（build job 可能未跑）`);
    }
  }
} else {
  const latestClosed3 = assessFreshness({}, new Date(), holidays).latestClosed;
  if (dtAsOf < latestClosed3) {
    alerts.push(`③ 双轨账本停更：asOf=${dtAsOf}，落后最近已收盘 ${latestClosed3}（build job 可能未跑）`);
  }
}

if (alerts.length) {
  const content = [
    '# ⚠ 系统停更告警（心跳哨兵 08:00）',
    '',
    '> 以下数据档未按预期覆盖最近交易日，请排查 CI 跑批链路（尤其是 build / smoke job 是否被取消源干掉）：',
    '',
    ...alerts.map((a, i) => `${i + 1}. ${a}`),
    '',
    `检测时刻：${new Date().toISOString()}`,
  ].join('\n');
  console.error('[sentinel] 检测到停更：\n' + alerts.join('\n'));
  if (WEBHOOK) {
    try {
      const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }) });
      console.error('[sentinel] 企微告警 HTTP', r.status, await r.text());
    } catch (e) {
      console.error('[sentinel] 企微告警失败（不拖红）:', e?.message ?? e);
    }
  }
  process.exit(1); // 哨兵本身可红，让 CI 知道"哨兵跑过且发现停更"
} else {
  console.log('[sentinel] 全部数据档覆盖最近交易日，心跳正常。');
  process.exit(0);
}
