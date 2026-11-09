#!/usr/bin/env node
/**
 * limit_caliber_compare.mjs — C12 对照回测（2026-11-09 用户拍板「两步走」配套）
 *
 * 目的：旧口径 v5.2-pro-old-limit（zdp>=9.5 主板硬阈值）与新口径 v5.2-pro-fix-limit
 *   （分板块：主板10/创业科创20/ST5/北证30）在存量涨停池历史上的判定差异量化。
 *   只读 ztpool_history（滚动约 16 日），不写任何主数据；输出 data/limit_caliber_compare.json
 *   + 控制台报表。违规痕迹：本工具是"对照"不是"覆盖"——历史结论仍按旧口径解读。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLimitUp, isLimitUpOld, limitUpPct } from '../src/limit_caliber.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const POOL = path.join(ROOT, 'data', 'ztpool_history.json');
const OUT = path.join(ROOT, 'data', 'limit_caliber_compare.json');

const pool = JSON.parse(fs.readFileSync(POOL, 'utf8'));
const boardOf = (code) => {
  const c = String(code ?? '').replace(/\D/g, '').padStart(6, '0');
  if (/^(4|8|920)/.test(c)) return '北证';
  if (/^(688|689)/.test(c)) return '科创';
  if (/^(300|301)/.test(c)) return '创业';
  return '主板';
};

const stat = {
  days: pool.length,
  stocks: 0,
  oldZt: 0, newZt: 0,
  oldOnly: [],   // 旧口径判涨停、新口径判不算（主板阈值误判 20cm 等）
  newOnly: [],   // 新口径判涨停、旧口径漏判（ST 5% 等）
  rule: { shrinkBoard: { old: 0, fix: 0 }, lockedSeal: { old: 0, fix: 0 } },
  byBoard: {},
};

for (const day of pool) {
  for (const s of day.pool || []) {
    const code = String(s.c ?? '');
    if (!code) continue;
    const name = s.n ?? s.name ?? '';
    const zdp = Number(s.zdp);
    if (!Number.isFinite(zdp)) continue;
    stat.stocks++;
    const b = boardOf(code);
    stat.byBoard[b] = (stat.byBoard[b] || 0) + 1;
    const o = isLimitUpOld(zdp, 9.5);
    const n = isLimitUp(zdp, { code, name });
    if (o) stat.oldZt++;
    if (n) stat.newZt++;
    if (o && !n) stat.oldOnly.push({ date: day.date, code, name, zdp, lim: limitUpPct({ code, name }), board: b });
    if (!o && n) stat.newOnly.push({ date: day.date, code, name, zdp, lim: limitUpPct({ code, name }), board: b });
    // 规则命中对照（缩量板：换手<5；封单锁死：封单/流通>5%）
    const hs = Number(s.hs), fund = Number(s.fund), ltsz = Number(s.ltsz);
    if (o && Number.isFinite(hs) && hs < 5) stat.rule.shrinkBoard.old++;
    if (n && Number.isFinite(hs) && hs < 5) stat.rule.shrinkBoard.fix++;
    const ratio = ltsz > 0 && fund > 0 ? fund / ltsz : 0;
    if (o && ratio > 0.05) stat.rule.lockedSeal.old++;
    if (n && ratio > 0.05) stat.rule.lockedSeal.fix++;
  }
}

const out = {
  kind: 'limit-caliber-compare',
  generatedAt: new Date().toISOString().slice(0, 10),
  calibers: { old: 'v5.2-pro-old-limit(9.5)', fix: 'v5.2-pro-fix-limit(分板块)' },
  summary: {
    days: stat.days, stocks: stat.stocks,
    oldZtCount: stat.oldZt, newZtCount: stat.newZt,
    oldOnly: stat.oldOnly.length, newOnly: stat.newOnly.length,
    rule: stat.rule, byBoard: stat.byBoard,
  },
  samples: { oldOnly: stat.oldOnly.slice(0, 20), newOnly: stat.newOnly.slice(0, 20) },
  note: '对照工具输出：历史结论仍按旧口径解读；新信号/新日报按 fix 口径。ST 判定依赖池内名称可用性。',
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const s = out.summary;
console.log(`[口径对照] ${s.days} 个交易日 · ${s.stocks} 只池股`);
console.log(`旧口径判涨停 ${s.oldZtCount} 只（>9.5 一律算）｜新口径 ${s.newZtCount} 只（分板块）`);
console.log(`旧独有(误判为涨停) ${s.oldOnly} 只｜新独有(旧漏判) ${s.newOnly} 只`);
console.log(`缩量板命中 old ${s.rule.shrinkBoard.old} → fix ${s.rule.shrinkBoard.fix}｜封单锁死 old ${s.rule.lockedSeal.old} → fix ${s.rule.lockedSeal.fix}`);
console.log(`分板块池股分布：${Object.entries(s.byBoard).map(([k, v]) => k + ' ' + v).join(' · ')}`);
if (s.oldOnly) console.log('误判示例：', out.samples.oldOnly.slice(0, 5).map((x) => `${x.date} ${x.code}${x.name ? '(' + x.name + ')' : ''} +${x.zdp.toFixed(1)}% 实为${x.lim}cm`).join('；'));
if (s.newOnly) console.log('漏判示例：', out.samples.newOnly.slice(0, 5).map((x) => `${x.date} ${x.code}${x.name ? '(' + x.name + ')' : ''} +${x.zdp.toFixed(1)}% 实为${x.lim}cm`).join('；'));
