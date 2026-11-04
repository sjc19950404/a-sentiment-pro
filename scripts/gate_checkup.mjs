#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 自动建仓全链路「闸门体检」（Gate Checkup）
//
// ⚠ 边界（务必先读）：
//   · 本脚本【只读回放】，不修改任何交易决策、不下单、不写账户/配置/选股结果。
//     唯一落盘是体检日志（data/reports/gate_checkup_*.json），不改任何生产数据。
//   · 用途：区分【数据覆盖率瓶颈】vs【策略闸门过严】——把「字段 null 导致条件
//     不满足」与「有值但不达标」分开统计。二者混淆会把数据缺失误判成策略失效。
//   · 敏感度表 A/B/C/D 是【模拟】，只改内存中的放行判定，不触碰 src/lhbfilter.js。
//     方案 C 尚未落地；本表是落地前/后的对照基线。
//
// 为什么需要常态化：2026-11-05 排查「模拟盘长期 0 成交」时，逐层拆了 openGap、
// 涨停池一字过滤、GLM 买前闸、主线强度口径，每拆一层才冒出下一层，效率极低。
// 一次性输出全链路漏斗后才发现总闸是 filterOne 的 bucket==='main'，而 93.3% 的
// 候选根本没有席位明细（准入③④因此恒为 unmet）。以后每次迭代闸门 / 换数据源，
// 重跑本脚本即可直接看到「通过率掉在哪一层、是缺数据还是真过严」。
//
// 用法：
//   npm run checkup                    # 全档案回放 + 写归档日志
//   node scripts/gate_checkup.mjs --no-log   # 只打印，不落盘（只读中的只读）
//   node scripts/gate_checkup.mjs --recent 20  # 只看最近 20 个交易日（快速体检）
//
// 与 paper_daily 的一致性（口径守卫，改动生产 ctx 时须同步本脚本）：
//   · 必须用 decodeArchive：裸 archive.json 的 day.lhb 是压缩编码在 _sub 里的，
//     直接读会得到 lhb=undefined，导致 featuresOf 拿不到净买额、准入结论全错。
//   · 选股 ctx 复现 step5：极寒分化扣分 / 主线对象 / openGapFilterPct / seatsDetail /
//     hotmoney 同源；GLM 守卫按当日 asOfDate 校验（侧车档是当日档，历史日 fail-open）。
//   · 漏斗末层以 batchSubmit 的 `bucket !== 'main' → 拒单` 为唯一放行判据。
//
// 已知边界（不是 bug，别据此改策略）：
//   · 侧车档（排雷黑名单/妖股逻辑/板块情绪）只有最新交易日的 asOfDate，历史日
//     按设计 fail-open 不拦，故漏斗里 GLM 通过率恒为 100%，不能解读成「GLM 无用」。
//   · 席位明细（summary.seats.detail）全档案仅 20/258 个交易日有，且集中在
//     2026-09-28 之后。这是数据源短板，不是策略参数问题。见 docs/gate_checkup.md。
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeArchive } from '../src/lhb_codec.js';
import { filterOne } from '../src/lhbfilter.js';
import { recommendPicks, marketTier, isAdmissible } from '../src/picks.js';
import { glmBuyGuard } from '../src/glm_guard.js';
import {
  detectClusteringBubble, computeRedIndustryRatio, buildMainLineInput,
  selectMainLine, penaltyApplies,
} from '../src/mainline_guard.js';
import { quotesFromDay } from '../src/paper.js';
import config from '../src/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = resolve(ROOT, 'data/archive.json');
const ZTPOOL = resolve(ROOT, 'data/ztpool_history.json');
const SIGNALS = resolve(ROOT, 'data/signals-latest.json');
const REPORT_DIR = resolve(ROOT, 'data/reports');

const argv = process.argv.slice(2);
const NO_LOG = argv.includes('--no-log');
const recentArg = (() => { const i = argv.indexOf('--recent'); return i >= 0 ? Math.max(1, +argv[i + 1] || 20) : null; })();

const readJson = (p, fallback = null) => {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback; }
  catch { return fallback; }
};
const normDate = (s) => String(s || '').replace(/\D/g, '');
const pct = (n, d) => (d ? `${(n / d * 100).toFixed(1)}%` : '—');
const pad = (s, n) => String(s).padEnd(n);

// ── 输入 ──
const arch = decodeArchive(readJson(ARCHIVE, {}));
const allDays = (arch.all_days || []).filter((d) => d && d.trade_date);
const days = recentArg ? allDays.slice(-recentArg) : allDays;
if (!days.length) { console.error('[gate_checkup] ✗ archive.json 无交易日，退出'); process.exit(1); }
const ztHist = readJson(ZTPOOL, []);
const ztOf = (d) => (Array.isArray(ztHist) ? ztHist : []).find((x) => normDate(x.date) === normDate(d.trade_date))?.pool || null;
let regimeKey = null;
try { regimeKey = readJson(SIGNALS, {})?.dailyReport?.tag?.key || null; } catch { /* 缺档按无 regime 处理 */ }
const RESTRICTIVE_REGIME = new Set(['shift', 'ebb', 'ice']);
const TOP_N = Math.max(1, Math.floor(Number(process.env.PAPER_AUTO_TOPN) || 3));

// ── 累计器 ──
const funnel = {
  days: allDays.length, scopeDays: days.length, tierAllow: 0, regimeBlocked: 0,
  candidates: 0, admissible: 0, picks: 0, quoteOk: 0, glmPass: 0,
  lhbMain: 0, mainFromPicks: 0, pickInMain: 0,
  rejectBy: {}, unmetBy: {}, skippedBy: {}, netOutflow: 0, watchByUnmet: 0,
};
const admit3 = {
  netBuyRate: { null: 0, fail: 0, pass: 0 },
  top3Conc: { null: 0, fail: 0, pass: 0 },
  instOrNorth: { null: 0, fail: 0, pass: 0 },
};
const coverage = { hasSeats: 0, noSeats: 0, daysWithMainTheme: 0, daysWithoutMainTheme: 0 };
const sensitivity = {
  A: { days: 0, orders: 0 },  // 现状：必须 bucket=main
  B: { days: 0, orders: 0 },  // 旁路整道 filterOne（拆掉龙虎资金风控，仅作对照）
  C: { days: 0, orders: 0 },  // 口径修正：保留强制剔除+降级，准入「字段 null」不计入 unmet
  D: { days: 0, orders: 0 },  // 仅放开 netOutflow 降级（准入仍全满足）
};
const perDay = [];

// ── 单次遍历：全档案逐日逐候选 ──
for (const day of days) {
  const emo = day.emotion?.value ?? null;
  const tier = emo != null ? marketTier(emo) : null;
  if (tier?.allowNew) funnel.tierAllow++;
  if (regimeKey && RESTRICTIVE_REGIME.has(regimeKey)) funnel.regimeBlocked++;
  if (day.summary?.main_theme?.name) coverage.daysWithMainTheme++;
  else coverage.daysWithoutMainTheme++;

  // 选股 ctx：与 paper_daily step5 同源
  const { isClusteringBubble, penalty } = detectClusteringBubble({
    upCount: Number.isFinite(day?.summary?.up_count) ? day.summary.up_count : null,
    redIndustryRatio: computeRedIndustryRatio(day?.industry),
  });
  const effEmotionScore = emo != null ? emo - (penaltyApplies(isClusteringBubble, regimeKey) ? penalty : 0) : null;
  const mainLineInput = buildMainLineInput(day, day?.summary?.main_theme);
  const mainLine = selectMainLine(mainLineInput ? [mainLineInput] : []);
  const reco = recommendPicks(day, {
    topN: TOP_N, emotionScore: effEmotionScore, ztpool: ztOf(day),
    isClusteringBubble, mainLine,
    openGapFilterPct: config.backtest?.openGapFilterPct,
    seatsDetail: day.summary?.seats?.detail,
    hotmoney: config.params?.live?.hotmoney,
  });
  const picks = reco.picks || [];
  const quotes = quotesFromDay(day);
  const marketNetWan = day.summary?.lhb_daily_net != null ? +day.summary.lhb_daily_net * 1e4 : null;

  funnel.picks += picks.length;
  const allCodes = [...new Set([...(day.hot || []), ...(day.lhb || [])]
    .map((x) => String(x?.code || x?.stock_code || '')).filter(Boolean))];
  funnel.candidates += allCodes.length;

  const mains = new Set();
  for (const code of allCodes) {
    if (isAdmissible(code, '', undefined)) funnel.admissible++;
    const f = filterOne(code, day, { marketNetWan });
    const ft = f.features || {};
    for (const x of (f.rejectedBy || [])) funnel.rejectBy[x.code] = (funnel.rejectBy[x.code] || 0) + 1;
    for (const x of (f.skipped || [])) funnel.skippedBy[x.key] = (funnel.skippedBy[x.key] || 0) + 1;
    for (const x of (f.admit?.unmet || [])) funnel.unmetBy[x.key] = (funnel.unmetBy[x.key] || 0) + 1;
    if (f.netOutflow) funnel.netOutflow++;
    if (f.bucket === 'watch' && !f.netOutflow) funnel.watchByUnmet++;
    if (f.bucket === 'main') { funnel.lhbMain++; mains.add(code); }

    // 准入 4 条的三分统计（真实字段，非 filterOne 的合并判定）
    if (ft.hasSellDetail) coverage.hasSeats++; else coverage.noSeats++;
    if (ft.netBuyRate == null) admit3.netBuyRate.null++;
    else if (ft.netBuyRate >= 0.04) admit3.netBuyRate.pass++;
    else admit3.netBuyRate.fail++;
    if (ft.buyTop3Pct == null) admit3.top3Conc.null++;
    else if (ft.buyTop3Pct <= 75) admit3.top3Conc.pass++;
    else admit3.top3Conc.fail++;
    if (ft.instNetWan == null && ft.northNetWan == null) admit3.instOrNorth.null++;
    else if (ft.instNetWan > 0 || ft.northNetWan > 0) admit3.instOrNorth.pass++;
    else admit3.instOrNorth.fail++;
  }

  // picks 走 GLM + 行情 + filterOne，并算 A/B/C/D 四组模拟放行
  const cnt = { A: 0, B: 0, C: 0, D: 0 };
  for (const p of picks) {
    const code = String(p.code);
    if (Number.isFinite(+quotes[code]?.price)) funnel.quoteOk++;
    const g = glmBuyGuard(code, { hybk: p.hybk, asOfDate: day.trade_date });
    if (!g.pass) continue;
    funnel.glmPass++;
    if (!Number.isFinite(+quotes[code]?.price)) continue;
    const f = filterOne(code, day, { marketNetWan });
    const ft = f.features || {};
    if (f.bucket === 'main') { cnt.A++; funnel.mainFromPicks++; }
    if (mains.has(code)) funnel.pickInMain++;
    cnt.B++;  // 旁路整道 filterOne
    // 方案 C（严格对齐待落地语义）：保留强制剔除 + netOutflow 降级；三条准入各自
    //   「字段 null → skipped 不计入 unmet」「有值但不达标 → unmet 正常否决」。
    //   ④ 必须两个字段【都】为 null 才算数据缺失；只要有一个有值，就仍要求
    //   inst>0 或 north>0（否则等于给「有席位但机构在卖」开票，是放宽风控不是修口径）。
    if (!(f.rejectedBy || []).length && !f.netOutflow) {
      const rateOk = ft.netBuyRate == null || ft.netBuyRate >= 0.04;
      const concOk = ft.buyTop3Pct == null || ft.buyTop3Pct <= 75;
      const instOk = (ft.instNetWan == null && ft.northNetWan == null)
        || (ft.instNetWan > 0 || ft.northNetWan > 0);
      if (rateOk && concOk && instOk) cnt.C++;
    }
    // 方案 D：仅放开降级，准入仍须全满足
    if (!(f.rejectedBy || []).length && f.admit?.all) cnt.D++;
  }
  for (const k of ['A', 'B', 'C', 'D']) {
    sensitivity[k].orders += cnt[k];
    if (cnt[k] > 0) sensitivity[k].days++;
  }
  perDay.push({
    date: day.trade_date, emo, tier: tier?.label || null,
    candidates: allCodes.length, picks: picks.length, main: mains.size,
    seats: Object.keys(day.summary?.seats?.detail || {}).length,
    ztpool: ztOf(day)?.length ?? 0,
    A: cnt.A, B: cnt.B, C: cnt.C, D: cnt.D,
  });
}

// ── 固定输出：三张表 ──
const out = [];
const emit = (s = '') => { out.push(s); console.log(s); };
const asOf = days[days.length - 1].trade_date;
emit('══════════ 自动建仓全链路闸门体检 ══════════');
emit(`档案交易日 ${funnel.days} 天｜本次范围 ${funnel.scopeDays} 天（截至 ${asOf}）｜TOP_N=${TOP_N}`);
emit(`当前 regime=${regimeKey || '无'}（restrictive=${RESTRICTIVE_REGIME.has(regimeKey || '')}）｜数据源：decodeArchive + ztpool_history + signals-latest`);
emit('');
emit('【表 1】完整漏斗层级通过率（分母见括号，票次链与交易日链分开）');
emit(`  ${pad('层级', 42)}${pad('票次/天数', 12)}${pad('通过率', 9)}${pad('分母', 12)}`);
emit(`  ${pad('— 交易日链 —', 42)}`);
emit(`  ${pad('情绪档 allowNew', 42)}${pad(funnel.tierAllow, 12)}${pad(pct(funnel.tierAllow, funnel.scopeDays), 9)}${pad('本次交易日', 12)}`);
emit(`  ${pad('regime 盖帽（当前档，非逐日重放）', 42)}${pad(funnel.regimeBlocked, 12)}${pad(pct(funnel.regimeBlocked, funnel.scopeDays), 9)}${pad('本次交易日', 12)}`);
emit(`  ${pad('— 票次链 —', 42)}`);
const funnelRows = [
  ['全候选票次', funnel.candidates, null, '—'],
  ['过 isAdmissible（仅主板/非ST）', funnel.admissible, funnel.candidates, '全候选'],
  ['recommendPicks 产出 picks', funnel.picks, funnel.candidates, '全候选'],
  ['picks 有当日行情', funnel.quoteOk, funnel.picks, 'picks'],
  ['过 GLM 买前闸（A排雷/B板块利空）', funnel.glmPass, funnel.picks, 'picks'],
  ['filterOne bucket=main（全候选口径）', funnel.lhbMain, funnel.candidates, '全候选'],
  ['picks 中 bucket=main（真实可提交）', funnel.mainFromPicks, funnel.picks, 'picks'],
  ['选股端 picks ∩ 买端 main', funnel.pickInMain, funnel.picks, 'picks'],
];
for (const [label, n, base, baseLabel] of funnelRows) emit(`  ${pad(label, 42)}${pad(n, 12)}${pad(pct(n, base), 9)}${pad(baseLabel, 12)}`);
emit('');
emit('【表 2】准入条件三分统计：null 数据缺失 / 有值不达标 / 达标（分母=全候选票次）');
emit(`  ${pad('准入条件', 26)}${pad('null 缺失', 14)}${pad('有值不达标', 14)}${pad('达标', 12)}${pad('席位明细覆盖', 14)}`);
const admitLabels = { netBuyRate: '①龙虎净买率≥4%', top3Conc: '③买方前三集中度≤75%', instOrNorth: '④机构/北向净买>0' };
emit(`  ${pad('—', 26)}${pad('—', 14)}${pad('—', 14)}${pad('—', 12)}${pad(`${pct(coverage.hasSeats, funnel.candidates)}`, 14)}`);
for (const [k, o] of Object.entries(admit3)) {
  emit(`  ${pad(admitLabels[k], 26)}${pad(`${o.null} (${pct(o.null, funnel.candidates)})`, 14)}`
    + `${pad(`${o.fail} (${pct(o.fail, funnel.candidates)})`, 14)}${pad(`${o.pass} (${pct(o.pass, funnel.candidates)})`, 12)}`);
}
emit(`  席位明细：有 ${coverage.hasSeats} / 无 ${coverage.noSeats}｜有 main_theme 的交易日 ${coverage.daysWithMainTheme} / 无 ${coverage.daysWithoutMainTheme}`);
emit(`  强制剔除命中：${Object.entries(funnel.rejectBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ') || '无'}`);
emit(`  数据不足留痕跳过：${Object.entries(funnel.skippedBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ') || '无'}`);
emit(`  watch 归因：netOutflow 降级 ${funnel.netOutflow}｜准入不足 ${funnel.watchByUnmet}`);
emit('');
emit('【表 3】敏感度对照：各方案「可下单交易日数 / 可提交票次」（本次范围 ' + funnel.scopeDays + ' 天）');
emit(`  ${pad('方案', 40)}${pad('可下单天数', 14)}${pad('占比', 9)}${pad('票次', 8)}`);
const sensLabels = {
  A: 'A 现状（必须 bucket=main）',
  B: 'B 旁路整道 filterOne（拆风控，仅对照）',
  C: 'C 口径修正（null 不计入 unmet，保留降级）',
  D: 'D 仅放开 netOutflow 降级（准入仍全满足）',
};
for (const k of ['A', 'B', 'C', 'D']) {
  const s = sensitivity[k];
  emit(`  ${pad(sensLabels[k], 40)}${pad(s.days, 14)}${pad(pct(s.days, funnel.scopeDays), 9)}${pad(s.orders, 8)}`);
}
emit('');
emit('说明：以上均为只读模拟，未修改任何交易决策。方案 C 尚未落地，本表是落地前/后的对照基线。');
emit('      解读原则：先看表 2 的 null 缺失占比——高缺失说明是【数据覆盖率瓶颈】，不是【策略闸门过严】。');

// ── 日志归档（唯一落盘，且是可重建产物；不写账户/配置/选股结果）──
if (!NO_LOG) {
  const report = {
    schema_version: '1.0',
    generatedAt: new Date().toISOString(),
    asOf, scopeDays: funnel.scopeDays, archiveDays: funnel.days,
    regimeKey, topN: TOP_N,
    note: '只读回放体检；用于区分【数据覆盖率瓶颈】vs【策略闸门过严】。不修改任何交易决策。',
    funnel, admit3, coverage, sensitivity, perDay,
    text: out.join('\n'),
  };
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  const latest = resolve(REPORT_DIR, 'gate_checkup_latest.json');
  const dated = resolve(REPORT_DIR, `gate_checkup_${asOf}.json`);
  const text = JSON.stringify(report, null, 1);
  writeFileSync(latest, text, 'utf8');
  writeFileSync(dated, text, 'utf8');
  console.log(`[gate_checkup] 日志已归档 → data/reports/gate_checkup_latest.json`);
  console.log(`[gate_checkup] 按交易日存档 → data/reports/gate_checkup_${asOf}.json`);
} else {
  console.log('[gate_checkup] --no-log：未写任何文件');
}
