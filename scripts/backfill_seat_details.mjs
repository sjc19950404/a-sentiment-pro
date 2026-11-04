#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 历史席位明细回填（backfill seat details）
//
// 补什么：data/archive.json 历史交易日的 summary.seats.detail（逐票买卖双侧席位明细），
//   即 filterOne 主候选准入③（买方前三集中度≤75%）④（机构/北向净买>0）的原料。
//   全档案 258 个交易日中 238 天无此明细（覆盖率 6.7%），导致③④恒为 unmet、
//   模拟盘长期 0 成交（2026-11-05 闸门体检定位，见 docs/gate_checkup.md）。
//
// 为什么能补： seats 采集自东财 RPT_BILLBOARD_DAILYDETAILSBUY/SELL。
//   src/seats_daily.js 头注曾写「实测只对最近 2 个交易日有效」——2026-11-05 实测推翻：
//   该接口对 2025-10-09 ~ 2026-11-04 全部历史日期均返回完整买卖前五席位。
//   故本脚本对存量缺口做一次性回填。
//
// ⚠ 风险清单（务必先读）：
//   1. 东财接口策略随时可能变动：今天能回查历史，未来可能变回只保留近几日。
//      本脚本只解决当下存量缺口，不是永久保障；日常席位仍靠 pipeline 逐日累积。
//   2. 格式漂移：早年少数日期返回字段可能与新版不同。脚本内做容错判断，
//      异常条目记为 skipped 日志，不直接炸流程。
//   3. 树莓派/长时运行：请求量大（238 天 × 每日约 80 只 × 买卖 2 请求 ≈ 3.8 万次），
//      务必放晚间闲时执行，勿在盘中与日常采集抢请求配额。
//
// ── 用法 ─────────────────────────────────────────────────────────────────────
//   node scripts/backfill_seat_details.mjs --dry --since 2026-01-01 --until 2026-09-27
//        # DRY-RUN：只统计请求量、抽样校验返回结构，不写盘（先摸底）
//   node scripts/backfill_seat_details.mjs --since 2025-10-09 --until 2025-11-30
//        # 分片回填第一段（每片约 30 交易日，便于控速与断点）
//   node scripts/backfill_seat_details.mjs            # 默认回填全部缺口
//   node scripts/backfill_seat_details.mjs --delay 200 # 加大节流间隔（默认 120ms）
//
// ── 幂等 / 断点续跑 ──────────────────────────────────────────────────────────
//   · 已有 v2 双侧 detail（含卖侧）的交易日 → 直接跳过，不重复请求；
//   · 中断后重跑：已补齐的天被跳过，自动从仍缺的天继续；
//   · 写盘前全量备份 archive.json → data/archive.seatbf-<时间戳>.bak，失败即终止。
//
// ── 口径说明 ─────────────────────────────────────────────────────────────────
//   fetchSeats 的 universe 本为「全部上榜个股（含区间累计榜）」，但主档为省体积
//   已 strip 掉 lhb_aggr。回填改用 day.lhb（合并后当日榜个股）作为候选清单——
//   它恰好覆盖 filterOne 评估的全部龙虎榜候选；seats.cover 分母因此是当日榜数，
//   与线上含区间榜的口径略有差异，故回填天 universe 标记为 'daily_lhb_backfill'。
//   filterOne 只读 detail（逐票席位），不读 cover，此差异对准入判定无影响。
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, copyFileSync, existsSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchSeats } from '../src/sources.js';
import { decodeArchive, writeArchiveSafely } from '../src/lhb_codec.js';
import { sleep } from '../src/util.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ARCHIVE = resolve(ROOT, 'data/archive.json');

function parseArgs(argv) {
  const out = { since: null, until: null, dry: false, delay: 120, maxRetries: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') out.since = argv[++i];
    else if (a === '--until') out.until = argv[++i];
    else if (a === '--dry') out.dry = true;
    else if (a === '--delay') out.delay = Number(argv[++i]);
    else if (a === '--max-retries') out.maxRetries = Number(argv[++i]);
  }
  return out;
}

// 该天是否已有可用的 v2 双侧 detail（含卖侧）。v1（仅买方数组）视为缺失需重抓。
function hasUsableSeats(day) {
  const det = day?.summary?.seats?.detail;
  if (!det || typeof det !== 'object' || !Object.keys(det).length) return false;
  return Object.values(det).some((v) => v && !Array.isArray(v) && Array.isArray(v.s));
}

// 判断 seats 结果是否结构有效（格式漂移容错）：至少一只票有买或卖侧明细。
function seatsValid(seats) {
  const det = seats?.detail;
  if (!det || typeof det !== 'object') return false;
  return Object.values(det).some((v) => v && !Array.isArray(v)
    && ((Array.isArray(v.b) && v.b.length) || (Array.isArray(v.s) && v.s.length)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(ARCHIVE)) { console.error('[seat-bf] 找不到 ' + ARCHIVE); process.exit(1); }
  const arc = decodeArchive(JSON.parse(readFileSync(ARCHIVE, 'utf8')));
  const days = (arc.all_days || []).filter((d) => d && d.trade_date);
  if (!days.length) { console.error('[seat-bf] 档案无交易日'); process.exit(1); }

  // 范围筛选：缺 v2 detail 的交易日才需要回填
  const inRange = days.filter((d) =>
    (!args.since || d.trade_date >= args.since) && (!args.until || d.trade_date <= args.until));
  const need = inRange.filter((d) => !hasUsableSeats(d) && (d.lhb || []).length > 0);
  const alreadyOk = inRange.filter((d) => hasUsableSeats(d));

  console.log(`[seat-bf] 档案 ${days.length} 天｜范围 ${args.since || days[0].trade_date} ~ ${args.until || days[days.length - 1].trade_date}`);
  console.log(`[seat-bf] 范围内 ${inRange.length} 天：已有 v2 席位 ${alreadyOk.length} 天（跳过）｜待回填 ${need.length} 天`);
  console.log(`[seat-bf] 模式 ${args.dry ? 'DRY-RUN（不写盘）' : '写盘'}｜节流 ${args.delay}ms｜失败重试 ≤${args.maxRetries} 次`);

  // 预估请求量（每只上榜股买+卖各 1 请求）
  const totalStocks = need.reduce((n, d) => n + (d.lhb || []).length, 0);
  console.log(`[seat-bf] 预估请求量 ≈ ${totalStocks * 2} 次（${totalStocks} 只股 × 买卖 2 侧），`
    + `按 ${args.delay}ms 节流约需 ${Math.round(totalStocks * 2 * (args.delay + 300) / 60000)} 分钟`);

  if (args.dry) {
    // 抽样校验返回结构：取首个待回填日的头一只票，真实请求一次，确认字段没漂移
    const sample = need[0];
    if (sample) {
      const c = sample.lhb[0];
      console.log(`[seat-bf] DRY 抽样校验：${sample.trade_date} ${c.code} ${c.name}`);
      try {
        const s = await fetchSeats(sample.trade_date, [{ code: c.code, name: c.name, net_buy_wan: c.net_buy_wan }]);
        const det = s.detail?.[String(c.code)];
        console.log(`[seat-bf] 抽样返回：买 ${det?.b?.length ?? 0} 条 / 卖 ${det?.s?.length ?? 0} 条｜`
          + `机构买 ${s.inst_buy} 亿 · 北向买 ${s.north_buy} 亿｜结构 ${seatsValid(s) ? '✓ v2 双侧有效' : '✗ 异常'}`);
      } catch (e) { console.log(`[seat-bf] 抽样请求失败：${e.message}`); }
    }
    console.log('[seat-bf] DRY-RUN 结束，未写盘。确认请求量与返回结构无误后去掉 --dry 正式回填。');
    return;
  }

  if (!need.length) { console.log('[seat-bf] 无缺口，未改盘。'); return; }

  // ── 前置强制备份：失败即终止 ──
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bak = resolve(ROOT, 'data', `archive.seatbf-${ts}.bak`);
  try {
    copyFileSync(ARCHIVE, bak);
    if (!existsSync(bak)) throw new Error('备份文件未生成');
    console.log(`[seat-bf] 已备份主档 → data/archive.seatbf-${ts}.bak`);
  } catch (e) {
    console.error(`[seat-bf] ✗ 备份失败，终止（不写盘）：${e.message}`);
    process.exit(1);
  }

  // ── 逐天回填（断点续跑：已有 v2 的天已在 need 里被排除）──
  const done = [], failed = [], skippedErr = [];
  for (let i = 0; i < need.length; i++) {
    const day = need[i];
    const tag = `[${String(i + 1).padStart(3)}/${need.length}] ${day.trade_date}`;
    // fetchSeats 入参：当日榜个股（合并后 lhb 明细，含 code/name/net_buy_wan）
    const aggr = (day.lhb || []).map((l) => ({ code: l.code, name: l.name, net_buy_wan: l.net_buy_wan }));
    let ok = false, lastErr = null;
    for (let att = 0; att < args.maxRetries && !ok; att++) {
      try {
        const seats = await fetchSeats(day.trade_date, aggr);
        if (!seatsValid(seats)) throw new Error('返回结构无效（买卖双侧均空，疑似格式漂移）');
        seats.universe = 'daily_lhb_backfill'; // 口径留痕：候选清单是当日榜，非含区间榜的全部上榜
        day.summary = day.summary || {};
        day.summary.seats = seats;
        const nCodes = Object.keys(seats.detail || {}).length;
        console.log(`${tag} ✓ 席位 ${nCodes}/${aggr.length} 票 · cover ${seats.cover}% · 机构净买 ${((seats.inst_buy ?? 0) - (seats.inst_sell ?? 0)).toFixed(2)} 亿`);
        done.push(day.trade_date); // 放在打印之后：日志抛错不会误计数
        ok = true;
      } catch (e) {
        lastErr = e;
        // 429/限流/网络错：拉长等待后重试
        const wait = args.delay * 20 * (att + 1);
        console.log(`${tag} 第 ${att + 1} 次失败：${e.message}，${wait}ms 后重试`);
        await sleep(wait);
      }
    }
    if (!ok) {
      failed.push({ date: day.trade_date, msg: lastErr?.message || 'unknown' });
      skippedErr.push(day.trade_date);
      console.log(`${tag} ✗ 重试 ${args.maxRetries} 次仍失败，记 skipped（不炸流程，可重跑补齐）`);
    }
  }

  console.log('');
  console.log(`[seat-bf] 汇总：回填 ${done.length} 天 / 跳过已有 ${alreadyOk.length} 天 / 失败 ${failed.length} 天`);
  if (failed.length) {
    console.log('[seat-bf] 失败明细（重跑即从这些日期继续）：');
    for (const f of failed) console.log(`  · ${f.date} ${f.msg}`);
  }
  if (!done.length) { console.log('[seat-bf] 无成功回填，未写盘。'); return; }

  // 写盘：writeArchiveSafely 内部完成 编码+提子+strip lhb_aggr+往返自检
  const out = {
    ...arc,
    meta: {
      ...arc.meta,
      backfillSeats: {
        version: 1,
        ranAt: new Date().toISOString(),
        range: [args.since || days[0].trade_date, args.until || days[days.length - 1].trade_date],
        filledDays: done.length,
        failedDays: failed.length,
        universe: 'daily_lhb_backfill',
        note: '历史席位明细回填：东财 RPT_BILLBOARD_DAILYDETAILSBUY/SELL 实测支持全历史回查（2026-11-05 验证，推翻 seats_daily.js 旧注释）。候选清单为当日榜 day.lhb（lhb_aggr 已被 strip）。',
      },
    },
    all_days: days,
  };
  const before = readFileSync(ARCHIVE, 'utf8');
  const info = writeArchiveSafely(ARCHIVE, out, { writeFileSync, renameSync, unlinkSync });
  const after = readFileSync(ARCHIVE, 'utf8');
  const mb = (s) => (Buffer.byteLength(s, 'utf8') / 1024 / 1024).toFixed(2);
  console.log(`[seat-bf] 已写盘：${mb(before)}MB → ${mb(after)}MB（码表 ${info.codes} 条 · 往返自检通过）`);
  console.log(`[seat-bf] 备份保留于 ${bak}（校验无误后可手动删除）`);
  console.log('[seat-bf] 下一步：跑 npm run gate-check（或 npm run checkup）查看③④覆盖率抬升后的真实分布');
}

main().catch((e) => { console.error('[seat-bf] 致命错误：', e); process.exit(1); });
