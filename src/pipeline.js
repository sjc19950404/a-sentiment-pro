// 管道：抓取(或离线回放) -> 题材去噪 -> 情绪 -> 校验 -> 写出 archive.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import config from './config.js';
import { ThemeDenoiser, computeMomentum } from './themes.js';
import { validateArchive } from './validate.js';
import { fetchLive, recalcRanks, LhbNotPublishedError } from './sources.js';
import { todayBeijing, isTradingDay } from './util.js';

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

// 用题材去噪 + 动量 增强每一日
function enrich(allDays) {
  const dn = new ThemeDenoiser({ minGlobalStocks: config.minThemeStocksGlobal }).fit(allDays);
  const byDay = dn.themesAllDays(allDays);
  const mom = computeMomentum(byDay, config.momentumRecent, config.momentumPrev, config.minThemeStocksWindow);
  const momObj = {
    fresh: mom.fresh.map((t) => ({ theme: t, stocks: [...byDay[byDay.length - 1][t] || []].length || countInWindow(byDay, t, config.momentumRecent) })),
    continuing: mom.continuing,
    fading: mom.fading,
  };
  const out = allDays.map((d, i) => ({
    ...d,
    themes: Object.fromEntries(Object.entries(byDay[i]).map(([k, v]) => [k, v.size])),
  }));
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
    board_rank: arc.board_rank || [],
    briefs: arc.briefs || [],
  };
  return archive;
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
  // 合并新交易日（已存在则替换）
  for (const nd of newDays) {
    const i = history.findIndex((d) => d.trade_date === nd.trade_date);
    if (i >= 0) history[i] = nd; else history.push(nd);
  }
  history.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
  recalcRanks(history);
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
    board_rank: out.map((d) => [d.trade_date, (d.industry || []).slice(0, 5).map((i) => [i.name, i.change_pct])]),
    briefs: [],
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

  // 非交易日：live 模式直接跳过，保留上一交易日数据
  const today = todayBeijing();
  if (mode === 'live' && !isTradingDay(today, config.manualHolidays)) {
    console.log('[skip]', today, '非交易日，保留上次数据');
    return null;
  }

  let archive;
  if (mode === 'live') {
    try {
      archive = await runLive();
    } catch (e) {
      if (e instanceof LhbNotPublishedError) {
        console.log('[skip]', e.message, '· 等待龙虎榜公布，保留上次数据');
        return null;
      }
      console.error('[live] 抓取失败，回退:', e.message);
      archive = fallbackArchive(dataPath);
    }
  } else {
    archive = runOffline(process.env.SNAPSHOT || path.join(ROOT, 'snapshot.html'));
  }
  const res = writeArchive(archive, dataPath);
  console.log('写入', res.path, '| 交易日', archive.signals.tradeDate,
    '| 新晋', archive.signals.momentum.fresh.length,
    '| 退潮', archive.signals.momentum.fading.length,
    '| 补位比', archive.signals.imputedRatioLatest,
    '| 情绪分', archive.signals.latestEmotion?.value ?? archive.signals.latestEmotion?.score);
  return archive;
}

// 回退：优先用已提交的真实 archive.json（标记 stale），否则用快照演示数据
function fallbackArchive(dataPath) {
  if (existsSync(dataPath)) {
    const a = JSON.parse(readFileSync(dataPath, 'utf8'));
    a.meta = a.meta || {};
    a.meta.stale = true;
    return a;
  }
  const a = runOffline(process.env.SNAPSHOT || path.join(ROOT, 'snapshot.html'));
  a.meta.stale = true;
  return a;
}

// 直接运行时执行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
