#!/usr/bin/env node
/**
 * 跌停池采集（2026-11-11 用户拍板 B：跌停反包监控的数据底座）。
 * 东财 getTopicDTPool（与涨停池同族接口）→ data/dtpool_history.json（{date,pool}按日幂等）。
 * 历史深度有限（同涨停池 ~1 个月量级，实测 11-06 可查、更早待测）→ 每日 EOD 一枪逐日攒。
 * 挂 pi_build EOD（fail-open）。反包监控（dt_rebound_alert.mjs）读本档的"昨日跌停池"。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/dtpool_history.json');

function bjDate() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }

// --date=YYYYMMDD 回填历史档（接口历史深度有限，开档初日把最近可查日补齐——2026-11-11 体检加）
const argDate = (process.argv.find((a) => a.startsWith('--date=')) || '').split('=')[1] || null;

try {
  const dateStr = argDate || bjDate().replace(/-/g, '');
  const url = 'https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fund%3Aasc&date=' + dateStr;
  const j = await (await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com/' } })).json();
  const pool = (j.data && j.data.pool) || [];
  const items = pool.map((p) => ({
    c: String(p.c), n: p.n || p.c, m: p.m || null,
    fbt: p.fbt || null, fund: Number.isFinite(+p.fund) ? +p.fund : null,
    lbc: Number.isFinite(+p.lbc) ? +p.lbc : null, zbc: p.zbc || 0,
    hybk: p.hybk || null,
  }));
  const hist = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
  const list = Array.isArray(hist) ? hist : [];
  const rec = { date: dateStr.slice(0,4)+"-"+dateStr.slice(4,6)+"-"+dateStr.slice(6,8), generatedAt: new Date().toISOString(), pool: items };
  const idx = list.findIndex((d) => d.date === rec.date);
  if (idx >= 0) list[idx] = rec; else list.push(rec);
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeFileSync(OUT, JSON.stringify(list, null, 1) + '\n');
  console.log(`[dtpool] ${rec.date} 跌停 ${items.length} 只落档（档天数 ${list.length}）`);
} catch (e) {
  console.error('[dtpool] 异常（fail-open）:', e && e.message);
  process.exit(1);
}
