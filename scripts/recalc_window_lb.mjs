// 窗口连板/地天板字段的存量重算（2026-10-23，一次性 transitional 脚本）
//
// 背景：4c0952ad/c1253ef5 上线窗口连板口径（N天M板）与地天板检测后，**已归档的
// 交易日**（含 10-23）summary 里没有 lbw2_count/zt_lbw/zt_dtd 字段（当日 eod 用旧
// 代码跑完的）。本脚本把最新一个归档日的这三个字段按新口径补齐，让看板当晚即可见
// 校准后读数，不必等下一个交易日。
//
// 数据来源（全部可重现，无新增抓取依赖——除地天板需实时行情外）：
//   · 窗口连板：archive 自身各交易日 summary.zt_codes（档案口径精确名单），
//     逐票数「最近 5 个交易日（含当日）在池天数」——与 src/ztpool_window.js 同算法；
//   · 地天板：腾讯实时行情（qt.gtimg.cn）取 low/prevClose/close，判定走
//     src/zt_rebuild.isDiTianBan（唯一出处）；行情取不到 → 字段缺席，不猜。
//
// 纪律（与 recalc_lhb_daily.mjs 同宗）：幂等（重跑结果一致）、只补新字段不动既有
// 数值、--dry 可预览、写盘后由调用方重跑 split_archive 刷新切片。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeWindowBoards } from '../src/ztpool_window.js';
import { isDiTianBan } from '../src/zt_rebuild.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const ARCH = path.join(ROOT, 'data', 'archive.json');

const archive = JSON.parse(readFileSync(ARCH, 'utf8'));
const days = archive.all_days || [];
const last = days[days.length - 1];
if (!last || !last.summary) { console.error('✗ 档案为空或末日无 summary'); process.exit(1); }
const ymd = String(last.trade_date).replace(/-/g, '');
const s = last.summary;

// ① 窗口连板：档案自身 zt_codes 即各日精确名单（含当日）
const recent = { spine: [], codesByDate: {} };
for (const d of days) {
  const codes = Array.isArray(d.summary?.zt_codes) && d.summary.zt_codes.length
    ? d.summary.zt_codes
    : (d.summary?.zt_lb ? Object.keys(d.summary.zt_lb) : null);
  if (!codes) continue;
  const y = String(d.trade_date).replace(/-/g, '');
  recent.spine.push(y);
  recent.codesByDate[y] = codes;
}
recent.spine.sort();
const todayCodes = recent.codesByDate[ymd] || [];
const win = computeWindowBoards([], todayCodes, ymd, { recent });
console.log(`[recalc] ${last.trade_date}：窗口 ${win.windowDates.length} 日 = ${win.windowDates.join(',')}`);
console.log(`[recalc] 窗口口径 lbw2=${win.lbw2} max_lbw=${win.maxLbw}（连续口径 lb2_count=${s.lb2_count} max_lb=${s.max_lb}）`);

// ② 地天板：腾讯实时行情（收盘后返回当日定盘价 + 全日最低价）
let dtd = null;
try {
  const sym = (c) => (/^(6|9)/.test(c) ? 'sh' : /^(4|8)/.test(c) ? 'bj' : 'sz') + c;
  const qm = {};
  for (let i = 0; i < todayCodes.length; i += 60) {
    const batch = todayCodes.slice(i, i + 60).map(sym);
    const res = await fetch('https://qt.gtimg.cn/q=' + batch.join(','), { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    const buf = await res.arrayBuffer();
    const txt = new TextDecoder('gbk').decode(buf);
    for (const m of txt.matchAll(/v_(?:sh|sz|bj)(\d{6})="([^"]*)"/g)) {
      const f = m[2].split('~');
      const close = parseFloat(f[3]), low = parseFloat(f[34]), prev = parseFloat(f[4]);
      if (Number.isFinite(close) && close > 0 && Number.isFinite(low) && Number.isFinite(prev)) {
        qm[m[1]] = { close, low, prevClose: prev, name: f[1] || '' };
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (Object.keys(qm).length) {
    dtd = {};
    for (const [code, q] of Object.entries(qm)) {
      if (isDiTianBan(q, sym(code), q.name)) dtd[code] = true;
    }
    console.log(`[recalc] 地天板 ${Object.keys(dtd).length} 只：${Object.keys(dtd).join(', ') || '（无）'}`);
  } else {
    console.log('[recalc] 行情未取到，地天板字段缺席（不猜）');
  }
} catch (e) {
  console.log(`[recalc] 行情抓取失败（${e.message}），地天板字段缺席（不猜）`);
}

if (DRY) { console.log('[recalc] --dry 预览结束，未写盘'); process.exit(0); }

// ③ 补写（只加新字段，既有数值一律不动）
s.lbw2_count = win.lbw2;
s.max_lbw = win.maxLbw;
s.zt_lbw = win.ztLbw;
if (dtd) { s.zt_dtd = Object.keys(dtd).length ? dtd : null; s.dtd_count = Object.keys(dtd).length; }
writeFileSync(ARCH, JSON.stringify(archive)); // 与原档一致的单行紧凑格式（缩进重写会产生 55 万行格式 churn）
console.log(`[recalc] ✓ 已补写 ${last.trade_date} summary（lbw2_count/max_lbw/zt_lbw${dtd ? '/zt_dtd/dtd_count' : ''}）`);
