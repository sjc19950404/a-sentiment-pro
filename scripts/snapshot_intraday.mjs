// 盘中轻量快照 —— 每 30 分钟跑一次，只更新「当前快照」，**绝不重算分位与因子**。
//
// 为什么需要它（以及为什么它必须是"轻量"的）：
//   盘后管道（18:30 首抓 / 21:00 补抓）跑的是完整链路：龙虎榜 + 席位明细 + 行业日K +
//   全市场标的池 + 情绪因子 + 分位重算，耗时数分钟且有严格的口径约束（分位必须基于
//   **同一个收盘口径的样本**才有统计意义）。盘中把它跑一遍会：
//     ① 把盘中未定盘的涨跌家数写进因子输入 → 情绪分在盘中反复跳变，分位失去意义；
//     ② 龙虎榜盘中根本没发布，必然抛 LhbNotPublishedError；
//     ③ 反复写盘产生大量无意义提交。
//
//   所以本脚本只做一件事：**抓三个盘中真实可得、且不参与打分的量**，写进独立的
//   data/intraday.json，并在 meta 里明确标注这是盘中快照而非收盘口径。
//
// 抓什么 / 不抓什么（判据是"盘中是否真实可得"+"是否会被误当成收盘值"）：
//   抓：hot（全市场快照派生涨幅榜，兼交易日探测）、pools（AkShare 涨跌停/炸板池，盘中实时）、
//       breadth（快照内涨跌家数统计，盘中实时）。三者都是**当下时点的快照**，语义天然与时间绑定。
//   数据层（2026-10-10 迁移）：全市场快照 QuantDash 主/AkShare 兜底 + QuantDash symbols
//   分批第三兜底；主力净流入 AkShare 批量榜。旧直连源（同花顺 getharden/腾讯 qt.gtimg/
//   东财 push2·push2his/eastmoney-probe）全部退役。
//   不抓：lhb / seats / industry / indexes / amount 日序列 —— 盘中或未发布、或不是当日值，
//         抓回来只会制造"看起来是当日收盘值"的假数据。
//
// 三态校验（缺一不可，宁可什么都不写也不写错）：
//   ① 相位必须是 live（非交易日 / 开盘前 / 收盘后，本脚本直接跳过，交给盘后管道）；
//   ② 强势股接口返回的 date 必须等于北京当日（跨日 / 陈旧数据 → 跳过）；
//   ③ 三个源至少要有一个成功（全失败 → 只更新 lastAttempt，不覆盖上一次成功的快照，
//      否则一次网络抖动会把页面上已有的盘中止盈/涨停数据抹成空白）。
//
// 用法：
//   node scripts/snapshot_intraday.mjs            抓取并写盘（相位非 live 时自动跳过）
//   node scripts/snapshot_intraday.mjs --dry      只抓不写
//   node scripts/snapshot_intraday.mjs --force    忽略相位判定（测试用）
//   node scripts/snapshot_intraday.mjs --at <iso> 按指定时刻判定相位（测试用）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { atomicWriteJSON } from '../src/fsutil.js';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
import config from '../src/config.js';
import { resolveHolidays } from '../src/calendar.js';
import { fetchIntradayRaw } from '../src/intraday_node.mjs';
import { marketPhase, bjDate, bjTime } from '../src/freshness.js';
import { buildIntradayPool, minutesToCloseBJ } from '../src/ai_report.js';
import { computeEmotion } from '../src/emotion_cycle.js';
import { applySnapshotFallback } from '../src/snapshot_fallback.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'intraday.json');
// IPv4 优先（与 smoke/probe/backfill 同款）：默认 verbatim 在部分网络下对东财 push2
// 域间歇 UND_ERR_SOCKET，会把「DNS 路由问题」误判成「源不可用」。CI 无害，本机/同款
// 网络下恢复 breadth 与主力净流入两源。
dns.setDefaultResultOrder('ipv4first');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const FORCE = argv.includes('--force');
const ai = argv.indexOf('--at');
const now = ai >= 0 ? new Date(argv[ai + 1]) : new Date();

// 快照版本：字段增删时递增，便于下游判断能读到什么（老快照缺新字段时不冒充完整）
//   v2（2026-10-09 任务二拆分）：hot.rows 增 pe_ttm/pb/liangbi（腾讯行情同 payload）
//   与 main_net（东财 push2 主力净流入，元）——盘中候选池筛选条件的唯一数据底座。
//   v3（2026-10-10 双池拆分+滚动生成）：① pools.zt_lb（code→连板数）入库——fetchPools
//   一直在算，此前落盘丢弃；连板池判定唯一权威源（reason 标签猜连板 = 造数）。
//   ② pools.zt_detail（每股 lbc/zbc/hybk，情绪六指标原料）+ 顶层 rolling 段（tick 每拍
//   生成滚动双池 + 实时六状态情绪 + 收盘倒计时降级标记）——推送时点/入库流程零改动。
//   v4（2026-10-10 P0 双池物理拆分）：zt_detail 增 fbt/fund（一字判定/封单质量）；
//   pools.prev_zt_codes（昨日涨停黑名单，只读 ztpool_history——16:00 入库零改动）。
export const SNAPSHOT_VERSION = 4;

const log = (...a) => console.log('[intraday]', ...a);

// ── ① 相位闸门 ────────────────────────────────────────────────────────────────
const ph = marketPhase(now, resolveHolidays());
if (ph.phase !== 'live' && !FORCE) {
  log(`相位 ${ph.phase}（北京 ${ph.bjDate} ${ph.bjTime}，${ph.isTradingDay ? '交易日' : '非交易日'}）→ 非盘中，跳过。`);
  log('盘后数据由 18:30 / 21:00 的完整管道负责，本脚本不重复做。');
  process.exit(0);
}
log(`相位 ${FORCE && ph.phase !== 'live' ? ph.phase + '（--force 强制）' : ph.phase}，北京 ${ph.bjDate} ${ph.bjTime}`);

// ── ② 抓取盘中源（2026-10-10 数据层迁移：一次 python 进程拉齐六源——全市场快照
//     QuantDash 主/AkShare 兜底、涨跌停池 AkShare、主力净流入榜 AkShare，全部批量；
//     旧源（同花顺 getharden/腾讯 qt.gtimg/东财 push2 直连/eastmoney-probe）退役）──
// ── ②b 读取上次成功快照（兜底源 + TTL 判定用，提前到抓取前——gtimg 兜底需要 prev.hot 代码作宇宙）──
const prev = (() => {
  try { return existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null; } catch { return null; }
})();
const prevHotCodes = (prev?.hot?.rows && Array.isArray(prev.hot.rows)) ? prev.hot.rows.map((r) => r.code).filter(Boolean) : [];

let raw = null;
const fetchOnce = async () => {
  try { return await fetchIntradayRaw(prevHotCodes); } catch (e) { log('数据层失败 →', String(e?.message || e)); return null; }
};
raw = await fetchOnce();
if (!raw) { // 进程级瞬时失败（python 子进程偶发退出 / 套接字抖动）→ 重试一次
  log('数据层首次失败 → 1.5s 后重试一次');
  await new Promise((r) => setTimeout(r, 1500));
  raw = await fetchOnce();
}

const hot = raw?.hot ?? null;
const pools = raw?.pools ?? null;
const breadth = raw?.breadth ?? null;

const errs = raw?.meta?.errors?.length ? [...raw.meta.errors] : [];
if (!raw) errs.push('market_data: 数据层进程失败（六源全部缺席，保留上次快照）');
else if (raw.meta?.degradations?.length) log('数据层降级链 →', raw.meta.degradations.map((d) => `${d.chain}`).join(' ⇄ '));
for (const e of errs) log('源失败 →', e);

// （prev 已提前至抓取前读取，见上方 ②b）

// ── ③ 交易日核验：强势股返回的 date 必须等于北京当日 ──────────────────────────
// 为什么必须核：该接口在非交易日 / 数据源未切换时会**返回上一交易日的数据**（不报错）。
// 若不核验就落盘，会把昨天的强势股当成今天的盘中快照——这是比"抓失败"更危险的静默错。
let hotDate = null;
if (hot && hot.length) hotDate = hot[0].date || null;
if (hotDate && hotDate !== ph.bjDate) {
  log(`强势股返回交易日 ${hotDate} ≠ 北京当日 ${ph.bjDate} → 数据源尚未切换到当日，跳过落盘。`);
  process.exit(0);
}

// anyOk 在「兜底源应用后」统一判定（见下方 ③c 之后），此处不提前判定。

// ── ③b 盘中候选池数据源（2026-10-10 数据层迁移）───────────────────────────────
//   量比/PE-TTM/PB 与主力净流入：新数据层在 intraday-raw 进程内已派生（零新增请求）。
//   缺席 = null（不造数）；报告层按「筛选条件核验不了 = 不入选」处理。
const quoteX = raw?.quotes || {};
const mainNet = raw?.mainNet || {};
// 全市场筛选榜（主力净流入降序前 100）。失败/缺席 = screener:null → 报告层回落
//   hot 榜口径并如实报因（宁缺毋假）。
const screener = raw?.screener ?? null;
if (screener === null) log('全市场筛选榜缺席 → 候选池回落 hot 榜口径（本次无全市场底座）');

// ── ④ 组装快照（只放「当下时点」语义明确的量，并逐项标注探测时点）──────────
const snapshot = {
  version: SNAPSHOT_VERSION,
  kind: 'intraday',                        // 与 archive.json 的收盘口径明确区分
  tradeDate: ph.bjDate,
  capturedAt: now.toISOString(),
  capturedAtBJ: `${ph.bjDate} ${ph.bjTime}`,
  phase: ph.phase,
  // 口径纪律：本文件里的任何数值都**不得**喂给情绪因子或分位。
  //   下方 breadth/pools 是盘中实时值，而分位是按收盘值算的——两者不同尺度。
  caliberNote: '盘中快照：数值为抓取时刻的实时值，未定盘；禁止用于情绪因子/分位/回测（那些一律用收盘口径的 archive.json）。',
  hot: hot ? {
    count: hot.length,
    srcDate: hotDate,
    // 只留报告要用的字段，控制文件体积（<200KB）
    rows: hot.slice(0, 200).map((x) => {
      const q = quoteX[x.code] || {};
      return {
        code: x.code, name: x.name, reason: x.reason || '',
        close: x.close != null ? +x.close : (q.close ?? null),
        change_pct: x.zhangfu != null ? +x.zhangfu : (q.change_pct ?? null),
        huanshou: x.huanshou != null ? +x.huanshou : (q.huanshou ?? null),
        pe_ttm: q.pe_ttm ?? null,
        pb: q.pb ?? null,
        liangbi: q.liangbi ?? null,
        avg_price: q.avg_price ?? null, // 分时均价线（东财 f9，盘中均价，2026-10-16 作战指令盘中场景补）
        main_net: mainNet[x.code] ?? null, // 主力净流入（元，东财 push2 f62）
      };
    }),
  } : null,
  pools: pools ? {
    zt: pools.zt, zb: pools.zb, dt: pools.dt,
    max_lb: pools.max_lb, lb2: pools.lb2,
    zt_codes: pools.zt_codes || null,
    // v3（2026-10-10 双池拆分）：code→连板数映射。连板池判定唯一依据——
    //   缺席（旧快照）= null，报告层连板池报因不猜测，绝不拿 reason 标签冒充。
    zt_lb: pools.zt_lb || null,
    // 窗口连板口径（N天M板，2026-10-23 用户校准新增）：lbc 只数连续板，「5天3板」这类
    //   非连续连板会被记首板。按最近 5 个交易日（档案脊）的涨停天数重算，与公开连板
    //   天梯同口径；连续口径 zt_lb 原样保留，两口径并列。旧快照缺席 = null，
    //   前端回退连续口径，不猜测。
    zt_lbw: pools.zt_lbw || null,
    lbw2: pools.lbw2 ?? null,
    max_lbw: pools.max_lbw ?? null,
    // 地天板（2026-10-23 用户校准新增）：盘中触及跌停、收盘封回涨停的稀疏映射 + 只数。
    //   高标分歧极大的信号，连板天梯需可见；行情缺失整批时 null，不猜。
    zt_dtd: pools.zt_dtd || null,
    dtd_count: pools.dtd_count ?? null,
    // v3（2026-10-10 滚动情绪）：涨停池每股明细 {c,lbc,zbc,hybk,fbt,fund}——
    //   emotion_cycle 六指标（判据唯一出处）的盘中原料，与收盘口径 ztpool_history
    //   同源同构；v4 增 fbt（首次封板 HHMMSS，一字判定）/fund（封单资金，元）。
    zt_detail: pools.zt_detail || null,
    // v4（2026-10-10 P0 双池物理拆分）：prev_zt_codes = 前一交易日收盘涨停名单
    //   （趋势池「昨日涨停」黑名单唯一源——断板股当日混进 3-7% 带即污染趋势池，
    //   10-09 事故实测）。**只读** ztpool_history（16:00 入库流程零改动）：
    //   取 date < 当日的最近档的池代码集；历史缺席（首轮/文件未建）= null，
    //   报告层报因不冒充已过滤。
    prev_zt_codes: (() => {
      try {
        const p = join(ROOT, 'data', 'ztpool_history.json');
        if (!existsSync(p)) return null;
        const days = JSON.parse(readFileSync(p, 'utf8'));
        if (!Array.isArray(days) || !days.length) return null;
        const ymd = ph.bjDate.replace(/-/g, '');
        const prevDay = [...days].reverse().find((d) => d && String(d.date) < ymd && Array.isArray(d.pool) && d.pool.length);
        return prevDay ? prevDay.pool.map((x) => String(x.c)) : null;
      } catch { return null; }
    })(),
    // 盘中封板率：分母同样是"触板个股"（涨停 + 炸板），与收盘口径同一算法
    seal_pct: (pools.zt != null && pools.zb != null && (pools.zt + pools.zb) > 0)
      ? Math.round((pools.zt / (pools.zt + pools.zb)) * 1000) / 10 : null,
  } : null,
  // 全市场筛选榜（任务二主数据源）：主力净流入降序前 100，自带候选池全字段。
  //   只在 live 相位有值；失败/缺席 = null（报告层回落 hot 榜口径并报因）。
  screener: screener ? { count: screener.length, rows: screener } : null,
  breadth: breadth ? { up: breadth.up, down: breadth.down, flat: breadth.flat } : null,
  // ── 对账源（2026-10-11）：两者都**不进主链路**，只落盘供 scripts/ztpool_crosscheck.mjs 消费。
  //   放在这里（而非让对账脚本再抓一遍）是为了**零新增网络请求**——全市场快照已经抓过了。
  //   ① breadthCross：AkShare 乐咕全 A 口径涨跌家数（与 breadth 沪深 A 口径不同：仅比对，不互换）；
  //   ② ztDerived：自有快照 + 涨跌幅公式**自建**涨停池。主源(东财 push2ex)与"第一备源"
  //      (AkShare zt_pool) 请求同一个 URL，实为单点，故这是唯一能与主源互相证伪的独立观测。
  breadthCross: raw?.breadthCross ?? null,
  ztDerived: raw?.ztDerived ?? null,
  // ── 源健康度留痕（2026-10-11）：把数据层的**降级链/实际源名/错误**原样落盘，供
  //   scripts/source_health.mjs 做滚动统计。这些信息以前只打在 stdout 里，跑完即丢——
  //   于是"哪个源最近总在降级"从来没有可见性，只能等它彻底挂了才发现。
  dataHealth: {
    snapshotSource: raw?.meta?.snapshotSource ?? null,
    snapshotRows: raw?.meta?.snapshotRows ?? 0,
    errors: raw?.meta?.errors ?? [],
    degradations: raw?.meta?.degradations ?? [],
  },
  sourcesFailed: errs.length ? errs : [],
};

// ── ③c 兜底源（2026-10-29 加固）：本次任一源（hot/screener/pools/breadth）缺席即回落
//   「同交易日 + ≤60 分钟」的上次成功快照，避免单源抖动把候选池/盘面整体抹成空白。
//   宁缺毋假仍成立——兜底源本身也是真实抓取值（只是稍旧），且仅在 TTL 内接受；超出则继续判空。
//   兜底后保留 prev 的真实 capturedAtBJ（数据真实年龄，不冒充实时），并在 dataHealth.fallbackUsed 留痕。
const fbRes = applySnapshotFallback(snapshot, prev, { tradeDate: ph.bjDate, nowMs: now.getTime(), ttlMin: 60 });
if (fbRes.fallbackUsed.length) {
  log('兜底源启用（同交易日+TTL 内）：' + fbRes.fallbackUsed.join('/') + ' ← ' + (prev?.capturedAtBJ || '?'));
}

// 兜底后再判定：任一源（含兜底）在场即写盘；全缺（含兜底也不可用）→ 保留上次成功快照
const anyOk = !!(snapshot.hot || snapshot.screener || snapshot.pools || snapshot.breadth);

// ── ⑤ 写盘（保留上一次成功的快照供对比，但只保留最近一次，不做历史堆积）────
//   prev 已在上方统一读取（含兜底源判定）。

if (!anyOk) {
  // 全失败：只更新 failed 留痕，不覆盖成功的快照内容
  if (prev) {
    prev.lastFailedAt = now.toISOString();
    prev.sourcesFailed = errs;
    if (!DRY) atomicWriteJSON(OUT, JSON.stringify(prev, null, 2));
    log('已仅追加失败留痕，保留上次成功快照（' + (prev.capturedAtBJ || '?') + '）。');
  } else {
    log('无历史快照且本次全失败 → 不生成文件。');
  }
  process.exit(0);
}

// 与上一次成功快照的差异（供页面显示"距上次快照涨跌停数变化"这类盘中动量的朴素证据）
snapshot.prevCapturedAtBJ = prev && prev.pools ? (prev.capturedAtBJ || null) : null;
snapshot.prevPools = prev && prev.pools ? { zt: prev.pools.zt, zb: prev.pools.zb, seal_pct: prev.pools.seal_pct } : null;

// ── ④b 滚动候选池（2026-10-10 用户指令：tick 每拍生成，推送时点/入库流程不动）──
//   每 :00/:30 tick 就地重算双池（复用报告层同一纯函数 buildIntradayPool——页面
//   与推送天然同构）+ 实时六状态情绪（zt_detail 现算，prev 取收盘口径
//   emotion_history 末行——同日行排除，16:00 入库后盘中不再误用当日作 prev）。
//   距收盘不足 30 分钟 → trend_pool_mode='tomorrow_watch'（明日观察池）。
//   提交走既有 git add data/intraday.json——零新增调度、零新增入库路径。
{
  let prevEmotionMetrics = null;
  try {
    const eh = JSON.parse(readFileSync(join(ROOT, 'data', 'emotion_history.json'), 'utf8'));
    const today = ph.bjDate.replace(/-/g, '');
    const rows = Array.isArray(eh?.history) ? eh.history : [];
    const prevRow = [...rows].reverse().find((r) => r && r.date && r.date !== today);
    prevEmotionMetrics = prevRow?.metrics ?? null;
  } catch { prevEmotionMetrics = null; }
  const built = buildIntradayPool(snapshot, { tradeDate: ph.bjDate, nowBJ: ph.bjTime });
  const emotion = Array.isArray(pools?.zt_detail) && pools.zt_detail.length
    ? computeEmotion(pools.zt_detail, prevEmotionMetrics, ph.bjDate.replace(/-/g, '')) : null;
  snapshot.rolling = {
    generatedAtBJ: `${ph.bjDate} ${ph.bjTime}`,
    minutes_to_close: minutesToCloseBJ(ph.bjTime),
    trend_pool_mode: built.trend_pool_mode,
    streak_pool: built.streak_pool,
    trend_pool: built.pool,
    basis: built.basis,
    streak_basis: built.streak_basis,
    // no_data 不落 null 占位（宁缺毋假）；emotion_cycle 六状态：冰点/退潮/高潮/主升/复苏/震荡
    emotion: emotion && emotion.emotion !== 'no_data' ? emotion : null,
  };
  log(`滚动池：连板 ${built.streak_pool.length} · 趋势 ${built.pool.length}（${built.trend_pool_mode === 'tomorrow_watch' ? '明日观察池·距收盘' + built.minutes_to_close + '分' : 'trend'}）`
    + ` · 实时情绪 ${snapshot.rolling.emotion ? `${snapshot.rolling.emotion.emotion} ${snapshot.rolling.emotion.score ?? '—'}分` : 'no_data（明细缺席）'}`);
}

log(`抓取完成：强势股 ${snapshot.hot ? snapshot.hot.count : '—'} 只 · 涨停 ${pools?.zt ?? '—'} / 炸板 ${pools?.zb ?? '—'}`
  + ` / 跌停 ${pools?.dt ?? '—'} · 涨跌家数 ${breadth ? `${breadth.up}/${breadth.down}` : '—'}`);
if (snapshot.pools?.seal_pct != null) log(`盘中封板率 ${snapshot.pools.seal_pct}%（分母=触板个股 ${pools.zt + pools.zb}）`);

if (DRY) { log('（--dry：仅预览，未写盘）'); process.exit(0); }
mkdirSync(dirname(OUT), { recursive: true });
atomicWriteJSON(OUT, JSON.stringify(snapshot, null, 2));
log('已写回', OUT, `（${(JSON.stringify(snapshot).length / 1024).toFixed(1)} KB）`);
