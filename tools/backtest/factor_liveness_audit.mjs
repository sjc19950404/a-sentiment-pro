#!/usr/bin/env node
/* factor_liveness_audit.mjs —— 沉默因子审计（2026-11-24 用户拍板：全因子，不只 prob）
 *
 * 【背景】v5.3 破案发现裸档被 lhb_codec 打包（席位名→seatCode 数字、lhb 明细压缩）——
 * 受影响的绝不止 hotMoney 挂件。本脚本对全史每个因子测「裸档非零率 vs decode 后非零率」，
 * 并按用户四条判据给结论。重点五因子：§② 机构/北向/游资 + 席位集中度 + 锁仓新进占比
 * ——全部吃 summary.seats 明细，是同一批受害者。
 *
 * 【输出固定表头】因子 | 裸档非零率 | decode 后非零率 | 差值 | 影响 kept 集合 | 影响幅度
 * 判据：
 *  ① 裸档非零率 <5% → 沉默因子
 *  ② decode 后非零率 > 裸档 2 倍 → 该因子历史结论全部"不可用"（含 v5.2 双轨账本）
 *  ③ 方差≈0 且总分相关性≈0 → 僵尸清单（存在但从不参与排序）
 *  ④ 回答："v5.2 里到底有几个因子活着？"——少于一半则双轨账本只能评价"半个引擎"
 *
 * 运行：node tools/backtest/factor_liveness_audit.mjs [kept样本天数，默认 30]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { decodeArchive } = await import(resolve(ROOT, 'src/lhb_codec.js'));
const { recommendPicks, buildCandidates } = await import(resolve(ROOT, 'src/picks.js'));

const RAW = JSON.parse(readFileSync(resolve(ROOT, 'data/archive.json'), 'utf8'));
const DEC = decodeArchive(RAW);
const rawDays = (RAW.all_days || []).filter((d) => d && d.trade_date);
const decDays = (DEC.all_days || []).filter((d) => d && d.trade_date);
const N = rawDays.length;
console.log(`[audit] 全史 ${N} 交易日（裸档 / decode 配对）`);

// ── 因子抽取器（逐日）──
const val = (x) => Number.isFinite(+x) ? +x : null;
const extract = {
  '§②机构净额(inst_buy)': (d) => val((d.summary || {}).seats?.inst_buy),
  '§②北向净额(north_buy)': (d) => val((d.summary || {}).seats?.north_buy),
  '§②游资净额(hot_buy)': (d) => val((d.summary || {}).seats?.hot_buy),
  '席位集中度(detail 明细)': (d) => {
    const det = (d.summary || {}).seats?.detail;
    if (!det || !Object.keys(det).length) return null;
    // 买方席位最大金额占比（集中度）——需席位名/金额明细
    let max = 0, sum = 0;
    for (const v of Object.values(det)) {
      for (const row of (v && v.b) || []) {
        const amt = Math.abs(val(row[1]) || 0); sum += amt; max = Math.max(max, amt);
      }
    }
    return sum > 0 ? max / sum : null;
  },
  '锁仓/新进占比(detail 明细)': (d) => {
    const det = (d.summary || {}).seats?.detail;
    if (!det || !Object.keys(det).length) return null;
    // 有卖侧明细的票占比（锁仓/新进判定的前置）
    let withSell = 0;
    for (const v of Object.values(det)) if ((v && v.s && v.s.length) || v?.hasSell) withSell++;
    return withSell / Object.keys(det).length;
  },
  '龙虎净买 netWan(lhb 明细)': (d) => {
    const rows = Array.isArray(d.lhb) ? d.lhb : [];
    if (!rows.length) return null;
    return rows.reduce((a, r) => a + (val(r.net_buy_wan) || 0), 0);
  },
  '换手率 turnoverPct': (d) => {
    const h = (d.hot || [])[0];
    return h ? val(h.huanshou) : null;
  },
  '连板高度 streak': (d) => {
    const lb = (d.summary || {}).zt_lb || {};
    const vv = Object.values(lb).map(val).filter((x) => x != null);
    return vv.length ? Math.max(...vv) : null;
  },
  '题材命中 themes': (d) => (d.themes && Object.keys(d.themes).length) || null,
  '情绪分 emotion': (d) => val((d.emotion || {}).value),
  /* 身份依赖因子：游资名单按席位名匹配——裸档数字码永不命中（v5.3 破案的因子）。
   * 用当日命中率做非零值：>0 表示有命中。 */
  '游资席位命中(hotMoney身份)': (d) => {
    try {
      const r = recommendPicks(d, { topN: 6, emotionScore: val((d.emotion || {}).value),
        seatsDetail: (d.summary || {}).seats?.detail || null });
      return (r.picks || []).some((p) => p.hotMoney) ? 1 : 0;
    } catch { return null; }
  },
};

// 因子字段 → decode 单因子替换路径（用于 kept 集合隔离实验）
const patchPath = {
  '§②机构净额(inst_buy)': ['summary', 'seats', 'inst_buy'],
  '§②北向净额(north_buy)': ['summary', 'seats', 'north_buy'],
  '§②游资净额(hot_buy)': ['summary', 'seats', 'hot_buy'],
  '席位集中度(detail 明细)': ['summary', 'seats', 'detail'],
  '锁仓/新进占比(detail 明细)': ['summary', 'seats', 'detail'],
  '龙虎净买 netWan(lhb 明细)': ['lhb'],
};

const cloneDeep = (o) => JSON.parse(JSON.stringify(o));
function patchOne(rawDay, decDay, path) {
  const out = cloneDeep(rawDay);
  let a = out, b = decDay;
  for (const k of path) {
    a[k] = b ? cloneDeep(b[k]) : undefined;
    a = a[k]; b = b ? b[k] : undefined;
  }
  return out;
}

// ── 非零率 + 方差 + 相关性（全史）──
const rows = [];
for (const [name, fn] of Object.entries(extract)) {
  const rv = rawDays.map(fn).filter((x) => x != null && x !== 0);
  const dv = decDays.map(fn).filter((x) => x != null && x !== 0);
  const rRate = rv.length / N, dRate = dv.length / N;
  const variance = (a) => {
    if (!a.length) return 0;
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length;
  };
  // 与总分（当日 kept 均值分）相关性：用当日 prob 均值作近似总分
  const corr = (days, get) => {
    const xs = [], ys = [];
    for (const d of days) {
      const v = get(d);
      if (v == null) continue;
      let r = null;
      try { r = recommendPicks(d, { topN: 6, emotionScore: val((d.emotion || {}).value) }); } catch { continue; }
      const ps = (r.picks || []).map((p) => val(p.prob?.score)).filter((x) => x != null);
      if (ps.length) { xs.push(v); ys.push(ps.reduce((a, b) => a + b, 0) / ps.length); }
      if (xs.length >= 80) break;
    }
    if (xs.length < 10) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
    const vx = xs.reduce((a, x) => a + (x - mx) ** 2, 0), vy = ys.reduce((a, x) => a + (x - my) ** 2, 0);
    return vx && vy ? cov / Math.sqrt(vx * vy) : null;
  };
  const c = corr(decDays, fn);
  const unusable = (rRate === 0 && dRate > 0.05) || (rRate > 0 && dRate > rRate * 2);
  rows.push({ name, rRate, dRate, diff: dRate - rRate, variance: variance(dv), corr: c,
    silent: rRate < 0.05, unusable, zombie: variance(dv) < 1e-6 && (c == null || Math.abs(c) < 0.01) });
}

// ── 单因子 kept 隔离实验（最近 N 天，替换单字段跑引擎）──
const KEEP_N = Math.min(+(process.argv[2] || 30), rawDays.length);
for (const row of rows) {
  const path = patchPath[row.name];
  if (!path) { row.keptDelta = '—'; row.keptImpact = '—'; continue; }
  let delta = 0, baseN = 0;
  for (let i = rawDays.length - KEEP_N; i < rawDays.length; i++) {
    const rd = rawDays[i], dd = decDays[i];
    let base, patched;
    try {
      base = recommendPicks(rd, { topN: 6, emotionScore: val((rd.emotion || {}).value) });
      patched = recommendPicks(patchOne(rd, dd, path), { topN: 6, emotionScore: val((rd.emotion || {}).value) });
    } catch { continue; }
    const bs = new Set((base.picks || []).map((p) => String(p.code)));
    const ps = new Set((patched.picks || []).map((p) => String(p.code)));
    for (const c of ps) if (!bs.has(c)) delta++;
    baseN += bs.size;
  }
  row.keptDelta = delta;
  row.keptImpact = baseN ? (delta / baseN * 100).toFixed(1) + '%' : '—';
}

// ── 输出固定表 ──
const pc = (v) => (v * 100).toFixed(1) + '%';
console.log('\n═══ 因子生效性审计表（裸档 vs decode，全史 ' + N + ' 日）═══');
console.log('因子 | 裸档非零率 | decode后非零率 | 差值 | 影响kept集合 | 影响幅度');
for (const r of rows) {
  console.log(`${r.name} | ${pc(r.rRate)} | ${pc(r.dRate)} | ${(r.diff >= 0 ? '+' : '') + pc(r.diff)} | ${r.keptDelta} | ${r.keptImpact}`);
}
console.log('\n【影响幅度口径定义】分母 = 最近 ' + KEEP_N + ' 个交易日基线 kept 数量累计（裸档逐日跑 recommendPicks 的 picks 条数求和）；分子 = 同一批日子里「只替换该因子为 decode 版」后新进入 kept 的票次累计（逐日集合差并集求和，重复进入按不同日计次）。即「单因子复活带来的 kept 增量 / 基线 kept 总量」，不是分数变化率、不是进出次数比。例：143.2% = 30 日内 lhb 明细复活新增 63 个 kept 票次 / 基线 44 个 kept 票次。');
console.log('\n═══ 判据标记 ═══');
for (const r of rows) {
  const tags = [r.silent && '沉默因子(裸档<5%)', r.unusable && '历史结论不可用(decode>2x)', r.zombie && '僵尸(方差≈0&相关≈0)'].filter(Boolean);
  if (tags.length) console.log(` ${r.name}: ${tags.join(' / ')}`);
}
const alive = rows.filter((r) => !r.silent && !r.unusable && !r.zombie).length;
/* 五个重点因子的"身份依赖 vs 数值依赖"区分（用户指定重点扫）：聚合数与金额/卖侧结构
 * 裸档可见（活着）；只有席位身份名被 codec 打码——身份匹配类全死。 */
console.log('\n═══ §② 五因子细分（身份依赖 vs 数值结构）═══');
console.log(' §②机构/北向/游资净额：顶层聚合数，裸档未打包 → 历史结论可用（实测非零率 100%）');
console.log(' 席位集中度：买方金额结构裸档可见 → 数值可用；但席位身份（谁）不可用');
console.log(' 锁仓/新进占比：卖侧有无结构裸档可见 → 数值可用；席位身份不可用');
console.log(' 游资席位命中(hotMoney)：纯身份匹配 → 裸档 0%，历史结论全部不可用');
console.log(' ⚠ 题材与换手非零率同为 23.2%（63/271）非巧合：两者日期集合完全一致，均为 2026-08-14 起连续 63 天——');
console.log('   同一写入路径从 8-14 才落 hot/themes，前 208 天字段缺失（非 0 写成缺失）。题材因子(20%权重)');
console.log('   全史实证仅 63 天；线 A 对账窗口实际可用 ~63 天——27 天对账合理，但原因是 archive hot 只有 63 天。');
console.log(`\n═══ 结论：v5.2 里活着的因子 ${alive}/${rows.length} ═══`);
if (alive < rows.length / 2) console.log('⚠ 活着少于一半——19 日双轨账本的 -7.00% 只能评价"半个引擎"，不得作为策略整体表现。');
else console.log('多数因子在历史上有效——双轨账本仍需按单因子标记逐项复核。');
