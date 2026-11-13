#!/usr/bin/env node
/**
 * market_context_history.mjs — 回场研究采集管道（2026-11-09 建）
 *
 * 用途：回场研究包（挂账）需要的三项市场背景指标，按日留存，触发日研究直接有完整历史可用。
 *   ① 市场成交额 250 日分位：上证综指(1.000001) + 深证综指(0.399106) 当日成交额之和的分位
 *   ② 指数 20 日已实现波动 250 日分位：上证综指 20 日日收益标准差的滚动分位
 *   ③ 指数位置 250 日分位：上证综指收盘价在 250 日收盘区间内的相对位置
 *
 * 口径留痕（审计纪律）：
 *   - 数据源：东方财富 push2his 日 K（fqt=1，klt=101），成交额字段 f57 单位为元
 *   - 北交所成交额不计入（口径为沪深两市，历史一致即可比，绝对值不作他用）
 *   - 分位 = 当日值在含当日的滚动 250 日窗口内的百分位排名（0~100）
 *   - 每次运行从东财全量重建（确定性、幂等、可自愈），不依赖本地增量状态
 *   - 本侧车只读只留存，不产生任何信号，不触发任何交易（回场触发判定仍是人工/事件信号）
 *
 * 纪律：fail-open，失败不影响 EOD 主流程；同日重跑覆盖（幂等）。
 */
import { safeJson } from '../src/safe_json.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'data', 'market_context_history.json');
const LMT = 320; // 拉取日数：覆盖 250 日窗口 + 计算缓冲
const WINDOW = 250;
const VOL_N = 20;

const SECIDS = [
  { secid: '1.000001', key: 'sh', name: '上证综指' },
  { secid: '0.399106', key: 'sz', name: '深证综指' },
];

async function fetchKline(secid) {
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53,f57&klt=101&fqt=1&beg=0&end=20500101&lmt=${LMT}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`EM ${secid} HTTP ${res.status}`);
  const j = await safeJson(res);
  const kl = j?.data?.klines;
  if (!Array.isArray(kl) || kl.length < WINDOW + VOL_N) {
    throw new Error(`EM ${secid} 数据不足：${kl?.length ?? 0} 根（需 ≥${WINDOW + VOL_N}）`);
  }
  // f51=date, f53=close, f57=amount(元)
  return kl.map((s) => {
    const [date, close, amount] = s.split(',');
    return { date, close: +close, amount: +amount };
  });
}

const pctRank = (x, arr) => {
  if (arr.length < 60) return null; // 历史不足时分位不给出（诚实缺失）
  let le = 0;
  for (const v of arr) if (v <= x) le++;
  return +((le / arr.length) * 100).toFixed(1);
};

const round2 = (x) => (x == null ? null : +x.toFixed(2));

try {
  const series = {};
  for (const s of SECIDS) series[s.key] = await fetchKline(s.secid);

  const szByDate = new Map(series.sz.map((r) => [r.date, r]));
  const rows = [];
  const dates = series.sh.map((r) => r.date).filter((d) => szByDate.has(d));
  const shByDate = new Map(series.sh.map((r) => [r.date, r]));
  const datesArr = [...dates];

  // 预计算上证逐日收益（vol20 用）
  for (let i = 0; i < datesArr.length; i++) {
    const d = datesArr[i];
    const sh = shByDate.get(d);
    const sz = szByDate.get(d);
    const totalAmount = sh.amount + sz.amount;
    const row = { date: d, shAmount: sh.amount, szAmount: sz.amount, totalAmount };

    // ① 成交额 250 日分位
    const amtWin = datesArr.slice(Math.max(0, i - WINDOW + 1), i + 1)
      .map((dd) => shByDate.get(dd).amount + szByDate.get(dd).amount);
    row.amountPct = pctRank(totalAmount, amtWin);

    // ② 20 日已实现波动（%）及其 250 日分位
    if (i >= VOL_N) {
      const rets = [];
      for (let k = i - VOL_N + 1; k <= i; k++) {
        rets.push(shByDate.get(datesArr[k]).close / shByDate.get(datesArr[k - 1]).close - 1);
      }
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const vol20 = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) * 100;
      row.vol20 = round2(vol20);
      // 滚动 vol 序列（从第 VOL_N 个可算点起）
      const volWin = [];
      for (let j = VOL_N; j <= i; j++) {
        const rs = [];
        for (let k = j - VOL_N + 1; k <= j; k++) {
          rs.push(shByDate.get(datesArr[k]).close / shByDate.get(datesArr[k - 1]).close - 1);
        }
        const m = rs.reduce((a, b) => a + b, 0) / rs.length;
        volWin.push(Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1)) * 100);
      }
      row.vol20Pct = pctRank(vol20, volWin.slice(-WINDOW));
    }

    // ③ 指数位置 250 日分位（收盘在 250 日收盘区间内的相对位置）
    const closeWin = datesArr.slice(Math.max(0, i - WINDOW + 1), i + 1).map((dd) => shByDate.get(dd).close);
    if (closeWin.length >= 60) {
      const lo = Math.min(...closeWin);
      const hi = Math.max(...closeWin);
      row.rangePosPct = hi > lo ? round2(((sh.close - lo) / (hi - lo)) * 100) : null;
    }

    rows.push(row);
  }

  const out = {
    kind: 'market-context-history',
    version: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    meta: {
      source: 'eastmoney push2his klt=101 fqt=1',
      window: WINDOW,
      volN: VOL_N,
      口径: [
        '成交额=上证综指+深证综指当日成交额之和（元），北交所不计入',
        '分位=当日值在含当日的滚动250日窗口内的百分位（0~100）',
        'vol20=上证综指20日日收益标准差(%)；rangePosPct=收盘在250日收盘区间内的相对位置(%)',
        '只读留存，不产生信号，不触发交易；回场触发判定仍为人工/事件信号',
      ],
    },
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const last = rows[rows.length - 1];
  console.log(
    `市场背景采集完成：${rows.length} 行（截至 ${last.date}）成交额分位 ${last.amountPct ?? '—'}｜` +
    `vol20 ${last.vol20 ?? '—'}%(分位 ${last.vol20Pct ?? '—'})｜指数位置 ${last.rangePosPct ?? '—'}%`
  );
} catch (e) {
  console.error('[market_context_history] 失败（best-effort，不影响 EOD）:', e.message);
  process.exit(1);
}
