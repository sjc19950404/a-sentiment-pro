// ════════════════════════════════════════════════════════════════════════════════
// ui_server.mjs —— 本地「参数控制台 + 实时沙盒推演」服务端（2026-10-28 新增）
//
// 职责（用户需求）：
//   1) 静态托管终端 SPA（取代旧 scripts/_serve.cjs 的静态能力并扩展出 API 端点；_serve.cjs 已退役）。
//   2) GET  /api/config          → 返回当前 config.json（无密钥；绝不读 .env）。
//   3) POST /api/update-config   → 严格范围校验（防呆）→ 备份 config.json.bak → 覆写 config.json。
//                                  铁律：只写 config.json，绝不触碰 .env（代码中无任何 .env 引用）。
//   4) POST /api/dry-run         → 用「最新参数 + 当天最新真实盘面」在内存中跑一次选股+风控，
//                                  返回新旧结果差异。绝不生成真实委托、绝不写盘、绝不污染归档。
//
// 设计要点：所有业务逻辑抽成纯函数（validateConfigPatch / applyConfigPatch / computeDryRun 等）导出，
//   便于脱离 HTTP 直接单元测试；HTTP 层只做路由与 IO。
//
// 启动：node scripts/ui_server.mjs [--port 8791] [--host 127.0.0.1]
// ⚠ 仅用于本地（Pi / 开发机）运行参数控制台；GitHub Pages 静态部署无此后端，
//   前端在 API 不可达时优雅降级（提示「请本地启动服务端」）。
// ════════════════════════════════════════════════════════════════════════════════
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeArchive } from '../src/lhb_codec.js';
import { recommendPicks } from '../src/picks.js';
import {
  detectClusteringBubble, computeRedIndustryRatio, buildMainLineInput, selectMainLine, penaltyApplies,
} from '../src/mainline_guard.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');                 // 项目根
const CONFIG_PATH = join(ROOT, 'config.json');          // 唯一可写配置文件
const CONFIG_BAK = join(ROOT, 'config.json.bak');

// CORS（2026-10-28）：允许 github.io 等前端跨域访问 /api/*（隧道暴露的家庭后端）。
//   默认 *；可用环境变量 UI_CORS_ORIGIN 收窄到具体源（如 https://sjc19950404.github.io）。
//   ⚠ 隧道会暴露 /api/update-config 写接口，强烈建议叠加 Cloudflare Access 零信任保护。
const CORS_ORIGIN = process.env.UI_CORS_ORIGIN || '*';

// ─────────────────────── 参数范围（防呆，与控制台滑块一致） ───────────────────────
// 任何越界或类型错误都被拒绝，且不产生任何写入/备份。
const RANGES = {
  maxPos: { min: 0.01, max: 1, label: '单笔最大仓位' },
  stopLoss: { min: -0.20, max: 0, label: '止损线（不得 > 0，最深 -20%）' },
  sentimentPenalty: { min: 0, max: 50, label: '极寒分化扣分' },
  clusterRiseMax: { min: 50, max: 5000, label: '上涨家数阈值' },
  openGapFilterPct: { min: 0, max: 100, label: '高开/急拉过滤比例' },
  trailingStopPct: { min: 0, max: 0.1, label: '移动止盈回撤比例（0~10%）' },
};
const STOP_KEYS = Object.keys(RANGES);

/**
 * 严格校验前端提交的参数补丁（只接受 STOP_KEYS 子集）。
 * @param {any} patch 形如 { stops: { maxPos, stopLoss, ... } }，stops 可只给部分键。
 * @returns {{ok:boolean, errors:string[], stops?:Record<string,number>}}
 */
export function validateConfigPatch(patch) {
  const errors = [];
  const stops = {};
  if (!patch || typeof patch !== 'object') {
    return { ok: false, errors: ['请求体必须是 JSON 对象'] };
  }
  const src = (patch.stops && typeof patch.stops === 'object') ? patch.stops : patch; // 兼容两种提交形态
  for (const k of STOP_KEYS) {
    if (!(k in src) || src[k] === undefined || src[k] === null || src[k] === '') continue; // 未提供则不改
    const v = Number(src[k]);
    const r = RANGES[k];
    if (!Number.isFinite(v)) { errors.push(`${r.label}(${k}) 必须是数字`); continue; }
    if (v < r.min || v > r.max) { errors.push(`${r.label}(${k}) 越界：需在 [${r.min}, ${r.max}]`); continue; }
    stops[k] = v;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], stops };
}

/**
 * 将校验过的 stops 合并进 config.json 对象（纯函数，不写盘）。
 *   同步写入三处口径：params.live.stops / params.train.stops / 顶层 backtest 镜像。
 * @param {object} cfg 已解析的 config.json 对象
 * @param {Record<string,number>} stops 校验过的子集
 * @returns {object} 新的 config.json 对象（原对象不被修改）
 */
export function applyConfigPatch(cfg, stops) {
  const next = JSON.parse(JSON.stringify(cfg)); // 深拷贝，绝不污染传入对象
  for (const k of Object.keys(stops)) {
    if (next.params?.live?.stops) next.params.live.stops[k] = stops[k];
    if (next.params?.train?.stops) next.params.train.stops[k] = stops[k];
    if (next.backtest) next.backtest[k] = stops[k]; // 顶层镜像
  }
  return next;
}

export function readConfigJson() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * 覆写 config.json，写前先备份为 config.json.bak（仅保留上一版快照）。
 * 铁律：目标文件固定为 config.json，代码中无任何 .env 读/写——天然隔离密钥。
 * @param {object} newCfg 已合并的新 config 对象
 */
export function writeConfigJsonWithBackup(newCfg) {
  // 防御：即便被误用也只允许写 config.json（绝不动 .env）
  if (resolve(CONFIG_PATH) !== CONFIG_PATH && !CONFIG_PATH.endsWith('config.json')) {
    throw new Error('安全拦截：只允许写 config.json');
  }
  if (existsSync(CONFIG_PATH)) copyFileSync(CONFIG_PATH, CONFIG_BAK); // 备份上一版
  writeFileSync(CONFIG_PATH, JSON.stringify(newCfg, null, 2) + '\n', 'utf8');
}

/** 加载最新真实盘面（末交易日 day + signals-latest 的 regime/emotion + 可选 ztpool）。 */
function loadLatestMarketData() {
  const a = decodeArchive(JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8')));
  const days = (a.all_days || []).filter((d) => d && d.trade_date);
  const day = days[days.length - 1];
  let regimeKey = null, emotionScore = null, ztpool = null;
  try {
    const s = JSON.parse(readFileSync(join(ROOT, 'data/signals-latest.json'), 'utf8'));
    regimeKey = s.dailyReport?.tag?.key || null;
    emotionScore = Number.isFinite(+(s.emotion && s.emotion.value)) ? +(s.emotion.value)
      : (Number.isFinite(+(s.dailyReport?.emotion?.value)) ? +(s.dailyReport.emotion.value) : null);
  } catch { /* signals 缺失则 regime/emotion 退化为 null，沙盒仍可跑 */ }
  try {
    const zp = join(ROOT, 'data/ztpool_history', `${day.trade_date}.json`);
    if (existsSync(zp)) { const z = JSON.parse(readFileSync(zp, 'utf8')); ztpool = Array.isArray(z.pool) ? z.pool : null; }
  } catch { /* 无 ztpool → 可交易性过滤 no-op */ }
  if (emotionScore == null && day.emotion && Number.isFinite(+day.emotion.value)) emotionScore = +day.emotion.value;
  return { day, ztpool, regimeKey, emotionScore };
}

/** 用一组 stops 跑一次选股+风控，返回结果快照（供新旧对比）。纯函数、无副作用。 */
function runOneScenario(day, ztpool, regimeKey, emotionScore, stops, topN = 10) {
  const upCount = Number.isFinite(day?.summary?.up_count) ? day.summary.up_count : null;
  const redIndustryRatio = computeRedIndustryRatio(day?.industry);
  // 沙盒推演：用本组 stops 的 clusterRiseMax / sentimentPenalty 覆盖（不影响线上常量、不写盘）
  const { isClusteringBubble, penalty } = detectClusteringBubble({
    upCount, redIndustryRatio, riseCountMax: stops.clusterRiseMax, penaltyOverride: stops.sentimentPenalty,
  });
  const applyPenalty = penaltyApplies(isClusteringBubble, regimeKey);
  const effEmotionScore = emotionScore != null ? emotionScore - (applyPenalty ? penalty : 0) : emotionScore;
  const mainLineInput = buildMainLineInput(day, day?.summary?.main_theme);
  const mainLine = selectMainLine(mainLineInput ? [mainLineInput] : []);
  const res = recommendPicks(day, {
    topN, emotionScore: effEmotionScore, ztpool, isClusteringBubble, mainLine, openGapFilterPct: stops.openGapFilterPct,
  });
  const codes = (res.picks || []).map((p) => String(p.code)).sort();
  return {
    isClusteringBubble, emotionScore: effEmotionScore, count: codes.length, codes, rejected: res.rejected || [],
  };
}

/**
 * 沙盒推演：用「新参数」对比「当前线上参数」在最新真实盘面上的选股差异。
 * 纯内存计算，绝不生成委托、绝不写盘、绝不污染归档。
 * @param {{stops?:object}} patch 前端提交的新参数（子集）
 * @returns 差异对象（旧/新结果 + 新增/剔除代码 + 说明）
 */
export function computeDryRun(patch, topN = 10) {
  const cfg = readConfigJson();
  const live = cfg.params?.live?.stops || {};
  const backtest = cfg.backtest || {};
  const oldStops = {
    maxPos: backtest.maxPos, stopLoss: backtest.stopLoss,
    sentimentPenalty: live.sentimentPenalty, clusterRiseMax: live.clusterRiseMax, openGapFilterPct: live.openGapFilterPct,
  };
  const v = validateConfigPatch(patch);
  if (!v.ok) { const e = new Error('参数校验失败：' + v.errors.join('；')); e.status = 400; e.errors = v.errors; throw e; }
  const newStops = { ...oldStops, ...v.stops };
  const data = loadLatestMarketData();
  const oldR = runOneScenario(data.day, data.ztpool, data.regimeKey, data.emotionScore, oldStops, topN);
  const newR = runOneScenario(data.day, data.ztpool, data.regimeKey, data.emotionScore, newStops, topN);
  const oldSet = new Set(oldR.codes), newSet = new Set(newR.codes);
  const added = newR.codes.filter((c) => !oldSet.has(c));
  const removed = oldR.codes.filter((c) => !newSet.has(c));
  return {
    old: oldR, new: newR, added, removed,
    note: '纯内存沙盒推演，未生成任何委托、未写盘、未污染归档',
  };
}

// ─────────────────────────── HTTP 层 ───────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error('JSON 解析失败')); } });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  // 仅允许项目根内的文件，杜绝路径穿越
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = resolve(ROOT, '.' + sep + normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(ROOT) || !existsSync(full) || statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const ext = extname(full).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(full));
}

export function startServer(port = 8791, host = '127.0.0.1') {
  const server = http.createServer(async (req, res) => {
    try {
      // CORS：github.io 等前端跨域访问 /api/* 必须通过；同源（Pi 本地 / 隧道直连）也不受影响。
      res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); } // 预检
      const url = new URL(req.url, `http://${host}:${port}`);
      const p = url.pathname;
      if (req.method === 'GET' && p === '/api/config') {
        return sendJson(res, 200, readConfigJson());
      }
      if (req.method === 'POST' && p === '/api/update-config') {
        const body = await readBody(req);
        const v = validateConfigPatch(body);
        if (!v.ok) return sendJson(res, 400, { ok: false, errors: v.errors });
        const cur = readConfigJson();
        const next = applyConfigPatch(cur, v.stops);
        writeConfigJsonWithBackup(next);
        return sendJson(res, 200, { ok: true, written: Object.keys(v.stops), config: next });
      }
      if (req.method === 'POST' && p === '/api/dry-run') {
        const body = await readBody(req);
        try {
          const diff = computeDryRun(body);
          return sendJson(res, 200, { ok: true, ...diff });
        } catch (e) {
          return sendJson(res, e.status || 500, { ok: false, error: e.message, errors: e.errors || null });
        }
      }
      if (req.method === 'GET') return serveStatic(req, res, p);
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('405 Method Not Allowed');
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e.message || e) });
    }
  });
  server.listen(port, host, () => {
    console.log(`[ui-server] 启动：http://${host}:${port}  (静态托管 + /api/config|/api/update-config|/api/dry-run)`);
  });
  return server;
}

// 直接运行时启动（node scripts/ui_server.mjs）
const argv = process.argv.slice(2);
const portIdx = argv.indexOf('--port');
const hostIdx = argv.indexOf('--host');
const PORT = portIdx >= 0 ? Number(argv[portIdx + 1]) || 8791 : 8791;
const HOST = hostIdx >= 0 ? argv[hostIdx + 1] : '127.0.0.1';
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer(PORT, HOST);
}
