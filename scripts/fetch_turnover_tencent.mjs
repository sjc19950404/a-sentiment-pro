#!/usr/bin/env node
/* fetch_turnover_tencent.mjs —— 换手率增量采集（腾讯当日快照现成字段，2026-11-24）
 *
 * 【为什么是这条路】用户拍板：绝不自行算换手率（现股本除历史成交量=前视偏差），
 * 只取接口现成字段。东财 push2his 历史端 TCP 级封禁持续；腾讯 web.ifzq.gtimg.cn
 * 历史日K只有 6 字段（无换手率）——但 **qt.gtimg.cn 当日快照第 38 位 = 换手率**
 * （000636/20261123 实测 7.32，与东财 f61、ztpool hs 逐位一致）。
 * 故改为**每日增量落档**：每天收盘后拉当日涨停票快照，存现成换手率；不回溯历史、
 * 单次请求 100 只（腾讯分批），不触发限流。历史部分等解封后用东财 f61 补（同一对账锚）。
 *
 * 【输出】data/.kline_turnover/daily/YYYY-MM-DD.json + manifest（版本化增量，可复跑）
 * 【对账硬门禁】000636/20261123 必须 == 7.32%（>0.01pp 停，不进回测）
 * 【幸存者偏差纪律】1/2 板对照组不得从 ≥3 板历史域取样——本采集只存当日客观
 * 涨停 + 连板高度（ztpool），事件域与引擎候选解耦（用户拍板）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data', '.kline_turnover', 'daily');
const ANCHOR = { date: '2026-11-23', code: '000636', expect: 7.32 };

function anchorCheck() {
  const f = resolve(OUT, ANCHOR.date + '.json');
  if (!existsSync(f)) return { ok: null, msg: '锚点档不存在（先采 11-23）' };
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const q = (d.quotes || []).find((x) => x.code === ANCHOR.code);
  if (!q || q.turnover == null) return { ok: false, msg: '锚点票缺失/换手率为空' };
  const diff = Math.abs(q.turnover - ANCHOR.expect);
  return { ok: diff <= 0.01, msg: `${ANCHOR.code}/${ANCHOR.date} 换手率 ${q.turnover}% vs 锚 ${ANCHOR.expect}% 差 ${diff.toFixed(3)}pp` };
}

async function fetchTencent(codes) {
  // 腾讯批量：v_sz000636="..."；海/深前缀按代码首位（6=sh，0/3=sz）
  const syms = codes.map((c) => (/^6/.test(c) ? 'sh' : 'sz') + c).join(',');
  const r = await fetch('https://qt.gtimg.cn/q=' + syms, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com' }, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = new TextDecoder('gbk').decode(await r.arrayBuffer());   // Node 内置 ICU 支持 GBK（Buffer.toString('gbk') 不支持）
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/v_(?:sh|sz)(\d{6})="([^"]*)"/);
    if (!m) continue;
    const f = m[2].split('~');
    if (f.length < 39) continue;
    // 字段位实测：f[30]=行情时间(YYYYMMDDHHMMSS)、f[32]=涨跌幅%、f[38]=换手率%（现成，交易所流通股本口径）
    const tv = Number(f[38]);
    out[m[1]] = {
      code: m[1], name: f[1], price: Number(f[3]), changePct: Number(f[32]),
      turnover: Number.isFinite(tv) ? tv : null, quoteTime: f[30] || null,
    };
  }
  return out;
}

async function main() {
  const dateArg = process.argv[2];
  if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error('用法: node scripts/fetch_turnover_tencent.mjs YYYY-MM-DD');
    process.exit(2);
  }
  const d8 = dateArg.replace(/\D/g, '');
  // 事件域：当日客观涨停（ztpool_history）+ 全史 ≥3 板域（仅用于圈定关注票，1/2 板另域）
  const ztH = JSON.parse(readFileSync(resolve(ROOT, 'data', 'ztpool_history.json'), 'utf8'));
  const day = ztH.find((x) => String(x.date).replace(/\D/g, '') === d8);
  if (!day) { console.error(`[kt-tx] ztpool_history 无 ${dateArg}——事件域缺失，不采（不编造）`); process.exit(3); }
  const codes = [...new Set((day.pool || []).map((x) => String(x.c)).filter((c) => /^\d{6}$/.test(c)))];
  console.log(`[kt-tx] ${dateArg} 客观涨停池 ${codes.length} 只（ztpool 事件域）`);
  mkdirSync(OUT, { recursive: true });

  const quotes = {};
  for (let i = 0; i < codes.length; i += 80) {
    const batch = codes.slice(i, i + 80);
    try { Object.assign(quotes, await fetchTencent(batch)); }
    catch (e) { console.error(`[kt-tx] 批次 ${i / 80 + 1} 失败: ${e.message.slice(0, 60)}（跳过并留痕）`); }
    await new Promise((r) => setTimeout(r, 600));
  }
  const out = {
    schemaVersion: 1, source: 'tencent-qt-gtimg-snapshot', date: dateArg,
    generatedAt: new Date().toISOString(),
    field: 'f[38]=turnover_rate（现成字段，交易所流通股本口径；不自行计算）',
    note: '事件域=当日客观涨停（ztpool），与引擎候选解耦；1/2板对照组禁用≥3板历史域取样（后验偏差）',
    universe: 'ztpool_objective_zt', quoteCount: Object.keys(quotes).length,
    ztPool: (day.pool || []).map((x) => ({ code: String(x.c), lbc: +x.lbc || 1 })),
    quotes: Object.values(quotes),
  };
  const f = resolve(OUT, dateArg + '.json');
  writeFileSync(f, JSON.stringify(out, null, 2));
  console.log(`[kt-tx] 落档 ${f} | 有换手率 ${out.quotes.filter((q) => q.turnover != null).length}/${out.quotes.length}`);

  const a = anchorCheck();
  console.log(`[kt-tx] 对账锚: ${a.msg}`);
  if (a.ok === false) { console.error('[kt-tx] ❌ HARD FAIL：换手率口径与锚点不一致——不进回测'); process.exit(4); }
}
main().catch((e) => { console.error('[kt-tx] 失败:', e.message); process.exit(1); });
