// ★ 首屏 trendPoint 字段白名单 ↔ 报告/工作台 summary 读取 对账守卫（P2-10，2026-11-19）
// ── 背景与教训 ──────────────────────────────────────────────────────────────
// 首屏 30 天滚动窗（buildRecent.days）走 trendPoint **白名单裁字段**；报告（app.js
// buildBrief）与工作台读 `d.summary / s.xxx / ps.xxx`。白名单漏带字段时**不报错、
// 只静默显示缺值**——已踩坑三次：
//   ① seats（席位）→ 席位段静默消失（test/seats_parity 同源教训）
//   ② industry_relative（板块相对强弱）→ 「回看更早交易日」超额榜整块消失
//   ③ main_theme（主线题材占比）→ 规则 9b「主线占比断崖」在首屏静默失效（2026-11-19）
// 每次都是"该带的字段裁掉，报告那段就静默不见了"。本守卫把「报告层读取的
// summary 字段 ⊆ trendPoint 输出字段」变成断言，第四次踩坑时 CI 直接红灯。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── ① 运行时生成 recent，拿 trendPoint 真实输出键集 ──────────────────────────
const raw = JSON.parse(readFileSync(path.join(ROOT, 'data/archive.json'), 'utf8'));
const { decodeArchive, encodeArchive } = await import(
  path.join(ROOT, 'src/lhb_codec.js')
);
const { buildRecent } = await import(path.join(ROOT, 'src/archive_split.js'));
const arc = decodeArchive(raw);
const packed = encodeArchive(arc, raw.meta.reasonCodes, { deflate: true, seats: false });
const rec = buildRecent(packed, 30, { aggregateFn: () => [] });
const tpKeys = new Set(Object.keys(rec.days[rec.days.length - 2] || {}));
const tpSummaryKeys = new Set([
  ...Object.keys(rec.days[rec.days.length - 2]?.summary || {}),
  ...Object.keys(rec.latest?.summary || {}),
]);

test('trendPoint 输出必须包含报告层已踩坑的三键（seats/industry_relative/main_theme）', () => {
  // seats 走 summary 包装（trendPoint 的 summary 键），另两键为顶层
  assert.ok(tpKeys.has('industry_relative'), 'trendPoint 缺 industry_relative（② 教训复发）');
  assert.ok(tpKeys.has('main_theme'), 'trendPoint 缺 main_theme（③ 教训复发，规则 9b 会静默失效）');
  assert.ok(
    tpKeys.has('summary') && (tpSummaryKeys.has('seats') || tpKeys.has('seats')),
    'trendPoint 缺 seats（① 教训复发，席位段会静默消失）'
  );
});

test('trendPoint 输出必须覆盖报告层高频读取键（情绪/宽度/涨跌停/量能/龙虎）', () => {
  for (const k of ['trade_date', 'value', 'pct_rank', 'zt_count', 'dt_count', 'zb_count',
    'up_count', 'down_count', 'amount_yi', 'lhb_daily_net', 'factors']) {
    assert.ok(tpKeys.has(k), `trendPoint 缺报告高频键 ${k}——若 app.js 新增读取此键，首屏会静默缺值`);
  }
});

// ── ② 静态扫描报告/工作台的 summary 字段读取，逐键对账 ─────────────────────────
// 只扫三个**低噪音**模式（首轮试过宽松 `(?:s|sm|ps)\.(\w+)`，被 DOM 变量 s.*
// 命名空间淹没出 60+ 误报——守卫疲劳失效，弃用）：
//   a) 显式 `.summary.xxx` 访问（d.summary / p.summary / latest.summary…）
//   b) s-page-overview.js 的 `sm.xxx`（sm = day.summary 唯一命名空间）
//   c) app.js 的 `ps.xxx`（buildBrief 闭包内 const ps = p.summary）
const summaryReads = new Map(); // key → [file:line]
for (const f of ['app.js', 's-page-overview.js', 's-page-overview-evidence.js', 's-report.js']) {
  const src = readFileSync(path.join(ROOT, f), 'utf8');
  // app.js 的 `sm` 是 seats/breadth 侧车档 summary（独立数据源，L2850/L2981），非 archive
  // day summary——sm 模式仅对 s-page-overview.js（sm=day.summary L54）启用。
  const regexes = [/\.summary\??\.([a-z_][a-z_0-9]*)/gi, /\bps\.([a-z_][a-z_0-9]*)/g];
  if (f === 's-page-overview.js') regexes.push(/\bsm\.([a-z_][a-z_0-9]*)/g);
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;               // 跳过注释行
    for (const re of regexes) {
      for (const m of line.matchAll(re)) {
        const key = m[1].toLowerCase();
        if (!summaryReads.has(key)) summaryReads.set(key, []);
        summaryReads.get(key).push(`${f}:${i + 1}`);
      }
    }
  });
}

test('报告层读取的 summary 字段必须在 trendPoint / latest.summary 中存在', () => {
  // 已知合法豁免：非「archive summary」语义的 summary 命名空间（情绪状态机 day.summary
  // 属 emotion_history 结构、人工复核档 manual_review 等运行时独立源）。新豁免须留原因。
  const EXEMPT = new Set([]);
  const missing = [];
  for (const [key, locs] of summaryReads) {
    if (tpKeys.has(key) || tpSummaryKeys.has(key) || EXEMPT.has(key)) continue;
    missing.push(`${key} ← ${locs.slice(0, 3).join(', ')}`);
  }
  // 关键闸门：新踩坑会在这里红灯。清单漂移时先补 trendPoint 或 EXEMPT 并留痕。
  assert.deepEqual(missing, [], `以下 summary 字段读取在首屏 trendPoint 白名单中不存在（会静默缺值）：\n  ${missing.join('\n  ')}`);
});
