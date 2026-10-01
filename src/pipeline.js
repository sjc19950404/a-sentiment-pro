// 管道：抓取(或离线回放) -> 题材去噪 -> 情绪 -> 校验 -> 写出 archive.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import config from './config.js';
import { ThemeDenoiser, computeMomentum } from './themes.js';
import { computeSentiment } from './sentiment.js';
import { validateArchive } from './validate.js';
import { fetchLive, recalcRanks, LhbNotPublishedError, applyLhb, fetchLhb, fetchSeats } from './sources.js';
import { caliberFromDay, dailyRowsOf } from './lhb.js';
import { todayBeijing, isTradingDay } from './util.js';
import { applyFreshnessMeta, freshnessKey } from './freshness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

// 从页面 HTML 抽取内嵌 JSON（平衡花括号）
export function extractArchive(html) {
  const start = html.indexOf('{"meta"');
  if (start < 0) throw new Error('未找到内嵌 JSON');
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"' && !inStr) inStr = true;
    else if (ch === '"' && inStr) inStr = false;
    else if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
  }
  return JSON.parse(html.slice(start, end));
}

// 用题材去噪 + 动量 增强每一日（离线可重跑：历史重算脚本复用同一实现，避免口径二次实现）
export function enrich(allDays) {
  const dn = new ThemeDenoiser({ minGlobalStocks: config.minThemeStocksGlobal }).fit(allDays);
  const byDay = dn.themesAllDays(allDays);
  const mom = computeMomentum(byDay, config.momentumRecent, config.momentumPrev, config.minThemeStocksWindow);
  const momObj = {
    fresh: mom.fresh.map((t) => ({ theme: t, stocks: [...byDay[byDay.length - 1][t] || []].length || countInWindow(byDay, t, config.momentumRecent) })),
    continuing: mom.continuing,
    fading: mom.fading,
  };
  const out = allDays.map((d, i) => {
    const o = { ...d, themes: Object.fromEntries(Object.entries(byDay[i]).map(([k, v]) => [k, v.size])) };
    // ⑨ 主线题材龙虎资金占比：主线题材（当日成分股最多）个股龙虎净买 ÷ 全榜单龙虎净买
    // 分子分母都必须取「当日榜」口径（口径守卫会核对本字段与 summary.lhb_daily_net 同源）；
    // 早先误用含区间累计榜的全量数组，同一只票会出现 3 天累计额当日度额，占比随披露节奏跳动。
    if (o.summary) {
      const rows = dailyRowsOf(o);
      const entries = Object.entries(byDay[i]);
      if (rows.length && entries.length) {
        const [name, codes] = entries.sort((a, b) => b[1].size - a[1].size)[0];
        let main = 0, tot = 0;
        for (const l of rows) { tot += l.net_buy_wan || 0; if (codes.has(l.code)) main += l.net_buy_wan || 0; }
        o.summary.main_theme = {
          name,
          main_yi: Math.round(main / 1e4 * 100) / 100,
          tot_yi: Math.round(tot / 1e4 * 100) / 100,
          pct: tot !== 0 ? Math.round(main / tot * 1000) / 10 : null,
          caliber: 'daily',
        };
      }
    }
    return o;
  });
  return { out, momObj, byDay };
}

function countInWindow(byDay, theme, n) {
  const slice = byDay.slice(-n);
  const s = new Set();
  for (const m of slice) if (m[theme]) for (const c of m[theme]) s.add(c);
  return s.size;
}

// 离线回放：从已有页面快照重建
export function runOffline(snapshotPath) {
  const html = readFileSync(snapshotPath, 'utf8');
  const arc = extractArchive(html);
  const allDays = arc.all_days || [];
  const { out, momObj } = enrich(allDays);
  recalcAll(out); // 统一公式重算（无原始数据的种子天自动 legacy 保留）
  const latest = out[out.length - 1];
  const archive = {
    meta: {
      generatedAt: new Date().toISOString(),
      formulaVersion: config.formulaVersion,
      source: 'offline-replay',
      note: '离线回放：情绪分沿用快照，题材已去噪。生产环境请跑 live 模式。',
    },
    all_days: out,
    signals: {
      version: config.formulaVersion,
      momentum: momObj,
      latestEmotion: latest.emotion,
      imputedRatioLatest: latest.emotion?.imputedRatio ?? 0,
      tradeDate: latest.trade_date,
    },
  };
  return archive;
}

// 全档情绪重算：统一公式（computeSentiment）重跑所有交易日，再重算分位。
// 历史天缺原始数据的因子走 proxy（posRatio/行业涨比），完全无原始数据的种子天标记 _legacy 保留原值。
export function recalcAll(days) {
  const amts = days.map((d) => (d.summary && d.summary.amount_yi != null) ? d.summary.amount_yi : null);
  days.forEach((d, i) => {
    const s = d.summary || {};
    const hasRaw = (s.ind_count > 0 || s.lhb_daily_net != null || s.lhb_all_net != null);
    if (!hasRaw) { if (d.emotion) d.emotion._legacy = true; return; }
    // 双口径统一从原始记录现算（每票一笔，取 |净额| 最大者），杜绝各自相加时把区间累计榜混进当日口径。
    // 权威口径 lhb_daily_net 喂日度因子；lhb_all_net 只作诊断留痕，两者不共用任何中间量。
    const c = caliberFromDay(d);
    if (c.total_records) {
      s.lhb_count = c.total_records;
      s.lhb_stocks = c.all_stocks;
      s.lhb_all_net = c.all_net_yi;
      s.net_pos = c.all_pos;
      s.net_neg = c.all_neg;
      s.lhb_daily_stocks = c.daily_stocks;
      s.lhb_daily_net = c.daily_net_yi;
      s.lhb_daily_amt = c.daily_amt_yi;
      s.lhb_range_count = c.range_records;
      if (d.emotion) d.emotion.lhb_daily_net = c.daily_net_yi;
    }
    const netBuy = s.lhb_daily_net ?? null;
    // amount MA20：取当日之前最近 20 个有值交易日
    const hist = [];
    for (let j = i - 1; j >= 0 && hist.length < 20; j--) if (amts[j] != null) hist.unshift(amts[j]);
    const ma = hist.length >= 10 ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
    const posRatio = (s.net_pos != null && s.net_neg != null && (s.net_pos + s.net_neg) > 0)
      ? s.net_pos / (s.net_pos + s.net_neg) : null;
    const sent = computeSentiment({
      netBuy,
      upCount: s.up_count ?? null,
      downCount: s.down_count ?? null,
      posRatio,
      industryUp: s.ind_up ?? null,
      industryTotal: s.ind_count ?? null,
      limitUp: s.zt_count ?? null,
      limitDown: s.dt_count ?? null,
      brokenCount: s.zb_count ?? null,
      amount: s.amount_yi ?? null,
      amountMA20: ma,
    }, config.weights);
    const FKEY = { s_net20: 's_net', s_pos10: 's_pos', s_brd20: 's_brd', s_hot10: 's_hot', s_zdt15: 's_zdt', s_zbl10: 's_zbl', s_amt15: 's_amt' };
    const facPlain = {};
    for (const [wk, pk] of Object.entries(FKEY)) facPlain[pk] = sent.factors[wk];
    d.emotion = {
      ...d.emotion,
      value: sent.score,
      ...facPlain,
      factors: facPlain,
      imputedRatio: sent.imputedRatio,
      missing: sent.missing,
    };
  });
  recalcRanks(days);
}

/**
 * 把新抓交易日合并进历史（就地更新 history）：
 *  - 同日已存在 → 替换；席位明细取覆盖率更高的一份（防新抓批次倒退）
 *  - 新天涨跌家数缺失而旧档有值 → 用旧档回填，防重跑降级
 * 返回 {replaced, appended, breadthFilled}，便于测试与日志。
 *
 * 注：此函数曾被 8853a17 引入的 `old is not defined` 打挂（引用未声明变量），
 * 导致 runLive 每次重跑当日数据都抛 ReferenceError → 整体回退 → meta.stale 恒为 true。
 * 抽为纯函数以便回归测试守护。
 */
export function mergeNewDays(history, newDays) {
  let replaced = 0, appended = 0, breadthFilled = 0;
  for (const nd of newDays) {
    const i = history.findIndex((d) => d.trade_date === nd.trade_date);
    if (i >= 0) {
      const old = history[i];
      const oldSeats = old.summary?.seats, newSeats = nd.summary?.seats;
      const oldBetter = oldSeats && newSeats && oldSeats.detail && !newSeats.detail && oldSeats.cover > newSeats.cover;
      if (oldSeats && oldBetter) {
        nd.summary = nd.summary || {};
        nd.summary.seats = oldSeats;
      }
      // 涨跌家数偶发抓取失败：新天缺失而旧档有值则回填，防重跑降级
      if (old.summary?.up_count != null && nd.summary?.up_count == null) {
        nd.summary = nd.summary || {};
        for (const k of ['up_count', 'down_count', 'flat_count']) nd.summary[k] = old.summary[k];
        breadthFilled++;
        console.log('[merge-breadth]', nd.trade_date, '回填涨跌家数', old.summary.up_count, '/', old.summary.down_count);
      }
      history[i] = nd;
      replaced++;
    } else {
      history.push(nd);
      appended++;
    }
  }
  return { replaced, appended, breadthFilled };
}

// 线上模式：抓取真实数据，合并进已存档历史 → 全档重算分位
// fetchLive 返回 { newDays:[day], tradeDate }，day 结构与快照一致
export async function runLive() {
  const { newDays, tradeDate } = await fetchLive();
  // 载入历史（冷启动用快照种子）
  let history = [];
  const dataPath = path.join(DATA_DIR, 'archive.json');
  if (existsSync(dataPath)) {
    try { history = JSON.parse(readFileSync(dataPath, 'utf8')).all_days || []; } catch { history = []; }
  }
  if (!history.length) {
    history = runOffline(path.join(ROOT, 'snapshot.html')).all_days || [];
  }
  const merged = mergeNewDays(history, newDays);
  console.log('[merge] 替换', merged.replaced, '| 新增', merged.appended,
    '| 涨跌家数回填', merged.breadthFilled);
  history.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));

  // 龙虎榜晚间分批披露：重抓上一交易日 lhb 刷原始数据（行业/涨跌停池收盘即定死，无需补抓）
  const prevDays = history.filter((d) => d.trade_date < tradeDate).slice(-1);
  for (const day of prevDays) {
    try {
      const lhbRaw = await fetchLhb(day.trade_date);
      applyLhb(day, lhbRaw);
      console.log('[refresh-lhb]', day.trade_date, '补抓成功, 榜单', lhbRaw.length, '条');
    } catch (e) {
      if (e instanceof LhbNotPublishedError) console.log('[refresh-lhb]', day.trade_date, '未公布，跳过');
      else console.error('[refresh-lhb]', day.trade_date, '失败:', e.message);
    }
    // 席位明细同样晚间分批发布：上一交易日覆盖率不满、缺逐票明细（锁仓口径原料），
    // 或明细仍是**旧格式（仅买方，无卖侧）**则补抓（取优）。第三项是本次买卖双侧升级后的关键：
    // 旧档 detail 是买方数组（真值判断为真），若不加这条，历史天数永远不会补上卖方明细。
    if (Array.isArray(day.lhb_aggr) && day.lhb_aggr.length) {
      const oldCover = day.summary?.seats?.cover ?? 0;
      const oldDetail = day.summary?.seats?.detail;
      const noSellSide = oldDetail && Object.values(oldDetail).some((v) => Array.isArray(v));
      if (oldCover < 100 || !oldDetail || noSellSide) {
        try {
          const seats = await fetchSeats(day.trade_date, day.lhb_aggr.map((l) => ({ code: l.code, name: l.name, net_buy_wan: l.net_buy_wan })));
          const newHasSell = seats.detail && Object.values(seats.detail).some((v) => v && !Array.isArray(v) && (v.s || []).length);
          if (seats.cover > oldCover || !oldDetail || newHasSell) {
            day.summary = day.summary || {};
            day.summary.seats = seats;
            console.log('[refresh-seats]', day.trade_date, '补抓席位 cover', oldCover, '→', seats.cover + '%');
          }
        } catch (e) { console.error('[refresh-seats]', day.trade_date, '失败:', e.message); }
      }
    }
  }

  recalcAll(history);
  const { out, momObj } = enrich(history);
  const latest = out[out.length - 1];
  const archive = {
    meta: {
      generatedAt: new Date().toISOString(),
      formulaVersion: config.formulaVersion,
      source: 'live',
      tradeDate,
    },
    all_days: out,
    signals: {
      version: config.formulaVersion,
      momentum: momObj,
      latestEmotion: latest.emotion,
      imputedRatioLatest: latest.emotion?.imputedRatio ?? 0,
      tradeDate: latest.trade_date,
    },
  };
  return archive;
}

export function writeArchive(archive, filePath) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const p = filePath || path.join(DATA_DIR, 'archive.json');
  const { ok, errors } = validateArchive(archive);
  if (!ok) {
    throw new Error('校验失败: ' + errors.join('; '));
  }
  writeFileSync(p, JSON.stringify(archive, null, 2), 'utf8');
  return { path: p, ok: true };
}

// 主入口
export async function main() {
  const mode = process.env.MODE || 'offline';
  const dataPath = path.join(DATA_DIR, 'archive.json');
  const now = new Date();

  // 非交易日：live 模式不抓数据，但仍刷新 meta 的新鲜度判定（自愈可能粘着的旧标记）
  const today = todayBeijing();
  if (mode === 'live' && !isTradingDay(today, config.manualHolidays)) {
    console.log('[skip]', today, '非交易日，保留上次数据');
    refreshMetaOnly(dataPath, now, { outcome: 'non-trading-day', reason: `${today} 非交易日` });
    return null;
  }

  let archive;
  let attempt;
  if (mode === 'live') {
    try {
      archive = await runLive();
      attempt = { outcome: 'ok', reason: null };
    } catch (e) {
      if (e instanceof LhbNotPublishedError) {
        console.log('[skip]', e.message, '· 等待龙虎榜公布，保留上次数据');
        console.log('::warning::本次未抓取：' + e.message + '（保留上次数据；18:30 首抓 / 21:00 补抓）');
        refreshMetaOnly(dataPath, now, { outcome: 'skipped', reason: e.message });
        return null;
      }
      console.error('[live] 抓取失败，回退:', e.message);
      console.log('::warning::live 抓取失败，本次写入回退档（meta.lastAttempt.outcome=failed）：' + e.message);
      archive = fallbackArchive(dataPath, e.message);
      attempt = { outcome: 'failed', reason: e.message };
    }
  } else {
    archive = runOffline(process.env.SNAPSHOT || path.join(ROOT, 'snapshot.html'));
    attempt = { outcome: 'offline-replay', reason: null };
  }
  applyFreshness(archive, now, attempt);
  const res = writeArchive(archive, dataPath);
  console.log('写入', res.path, '| 交易日', archive.signals.tradeDate,
    '| 新晋', archive.signals.momentum.fresh.length,
    '| 退潮', archive.signals.momentum.fading.length,
    '| 补位比', archive.signals.imputedRatioLatest,
    '| 情绪分', archive.signals.latestEmotion?.value ?? archive.signals.latestEmotion?.score);
  console.log('[freshness]', archive.meta.freshness.state, '| stale =', archive.meta.stale,
    archive.meta.staleReason ? '| ' + archive.meta.staleReason : '| 数据为最新已收盘会话');
  return archive;
}

// 把新鲜度判定写进 meta（成功/回退/跳过三条路径统一口径）。
// stale 不再表示「上次尝试失败」，而是「存档交易日落后于最近已收盘交易日且已过预期更新时刻」，
// 由 assessFreshness 按交易日历算；抓取是否成功另记于 meta.lastAttempt。
function applyFreshness(archive, now, attempt) {
  archive.meta = archive.meta || {};
  const tradeDate = archive.meta.tradeDate
    || archive.signals?.tradeDate
    || (archive.all_days || []).slice(-1)[0]?.trade_date
    || null;
  applyFreshnessMeta(archive.meta, tradeDate, now, config.manualHolidays, attempt);
  return archive;
}

// 只刷新存档 meta 的判定字段（不碰数据）。用于「跳过 / 非交易日」：
// 这些路径没有新数据，但新鲜度判定必须跟着时间走，否则旧标记会一直粘着页面。
function refreshMetaOnly(dataPath, now, attempt) {
  if (!existsSync(dataPath)) return null;
  let a;
  try { a = JSON.parse(readFileSync(dataPath, 'utf8')); } catch { return null; }
  const before = freshnessKey(a.meta);
  const f = applyFreshness(a, now, attempt).meta.freshness;
  if (freshnessKey(a.meta) === before) {
    console.log('[freshness] meta 未变化 |', f.state);
    return a;
  }
  writeFileSync(dataPath, JSON.stringify(a, null, 2), 'utf8');
  console.log('[freshness] meta 已刷新 |', f.state, '| stale =', a.meta.stale,
    a.meta.staleReason ? '| ' + a.meta.staleReason : '');
  return a;
}

// 回退：优先用已提交的真实 archive.json（记录原因），否则用快照演示数据。
// 注：这里的 stale=true 只是保守默认值，随后 applyFreshness 会按日历重算——
// 若回退档的数据本就是最新已收盘会话，不该继续误报滞后。
function fallbackArchive(dataPath, reason) {
  const mark = (a) => {
    a.meta = a.meta || {};
    a.meta.stale = true;
    if (reason) a.meta.fallbackReason = reason;
    return a;
  };
  if (existsSync(dataPath)) {
    return mark(JSON.parse(readFileSync(dataPath, 'utf8')));
  }
  return mark(runOffline(process.env.SNAPSHOT || path.join(ROOT, 'snapshot.html')));
}

// 直接运行时执行（用 pathToFileURL 比较：Windows 下 argv[1] 是 C:\… 而 import.meta.url 是 file:///C:/…，
// 直接拼 'file://' + argv[1] 恒不相等 → 本地直跑会静默什么都不做）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
