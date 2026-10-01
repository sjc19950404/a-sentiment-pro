// 管道：抓取(或离线回放) -> 题材去噪 -> 情绪 -> 校验 -> 写出 archive.json
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import config from './config.js';
import { ThemeDenoiser, computeMomentum } from './themes.js';
import { computeSentiment } from './sentiment.js';
import { validateArchive } from './validate.js';
import { fetchLive, recalcRanks, LhbNotPublishedError, applyLhb, fetchLhb, fetchSeats } from './sources.js';
import { caliberFromDay, dailyRowsOf, aggregateByCode } from './lhb.js';
import { todayBeijing, isTradingDay } from './util.js';
import { resolveHolidays } from './calendar.js';
import { applyFreshnessMeta, applyPhaseMeta, freshnessKey, assessFreshness } from './freshness.js';
import { buildIndex, buildShards, shardName, buildRecent, buildSignals, RECENT_DAYS, RECENT_FILE, SIGNALS_FILE } from './archive_split.js';
import { buildReasonCodes, encodeArchive, decodeArchive } from './lhb_codec.js';
import { marketAlerts } from './alerts.js';
import { computeRelative } from './relative.js';
import { healthReport } from './health.js';
import { buildSeatSeries, seatSeriesSummary, seatVerdict } from './seats_daily.js';
import { buildBreadthSeries, breadthSeriesSummary } from './breadth.js';
import { validateDay, sanitizeForFactors, dirtyArgsOf } from './dirty.js';
import { BACKFILL_FLAG } from './backfill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

// 从页面 HTML 抽取内嵌 JSON（平衡花括号）
export function extractArchive(html) {
  const start = html.indexOf('{"meta"');
  if (start < 0) throw new Error('未找到内嵌 JSON');
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"' && !inStr) inStr = true;
    else if (ch === '"' && inStr) inStr = false;
    else if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
  }
  return JSON.parse(html.slice(start, end));
}

// 用题材去噪 + 动量 增强每一日（离线可重跑：历史重算脚本复用同一实现，避免口径二次实现）
export function enrich(allDays) {
  const dn = new ThemeDenoiser({ minGlobalStocks: config.minThemeStocksGlobal }).fit(allDays);
  const byDay = dn.themesAllDays(allDays);
  const mom = computeMomentum(byDay, config.momentumRecent, config.momentumPrev, config.minThemeStocksWindow);
  // 昨日新晋名单：把「上一交易日按同一 momentum 口径算出的 fresh」也落盘。
  // 为什么必须由引擎算并留痕：报告要回答「昨日新晋题材今日还活着吗」，这需要**昨日视角**的
  // fresh 名单（用截止昨日的数据重算 momentum）。如果报告端拿「今日 fresh」去比「昨日 themes」，
  // 语义会变成「今日新晋在昨日是否已存在」——而新晋的定义本就是昨日不存在，逻辑自相矛盾，
  // 得数恒为一个不小的小数（2026-09-30 实测算出 53%，真实存活率是另一回事）。
  // 引擎侧用同一份 byDay/同一套参数重算昨日视角，是唯一不会口径漂移的做法。
  const prevMom = byDay.length > 1
    ? computeMomentum(byDay.slice(0, -1), config.momentumRecent, config.momentumPrev, config.minThemeStocksWindow)
    : { fresh: [], continuing: [], fading: [] };
  const momObj = {
    fresh: mom.fresh.map((t) => ({ theme: t, stocks: [...byDay[byDay.length - 1][t] || []].length || countInWindow(byDay, t, config.momentumRecent) })),
    continuing: mom.continuing,
    fading: mom.fading,
    // 昨日视角的新晋/延续/退潮（用于「昨日新晋今日存活」的分子分母同源比对）
    prev_fresh: prevMom.fresh,
    prev_continuing: prevMom.continuing,
    prev_fading: prevMom.fading,
  };
  const out = allDays.map((d, i) => {
    const o = { ...d, themes: Object.fromEntries(Object.entries(byDay[i]).map(([k, v]) => [k, v.size])) };
    // ⑨ 主线题材龙虎资金占比：主线题材（当日成分股最多）个股龙虎净买 ÷ 全榜单龙虎净买
    // 分子分母都必须取「当日榜」口径（口径守卫会核对本字段与 summary.lhb_daily_net 同源）；
    // 早先误用含区间累计榜的全量数组，同一只票会出现 3 天累计额当日度额，占比随披露节奏跳动。
    if (o.summary) {
      const rows = dailyRowsOf(o);
      const entries = Object.entries(byDay[i]);
      if (rows.length && entries.length) {
        const [name, codes] = entries.sort((a, b) => b[1].size - a[1].size)[0];
        let main = 0, tot = 0;
        for (const l of rows) { tot += l.net_buy_wan || 0; if (codes.has(l.code)) main += l.net_buy_wan || 0; }
        o.summary.main_theme = {
          name,
          main_yi: Math.round(main / 1e4 * 100) / 100,
          tot_yi: Math.round(tot / 1e4 * 100) / 100,
          pct: tot !== 0 ? Math.round(main / tot * 1000) / 10 : null,
          caliber: 'daily',
        };
      }
    }
    return o;
  });
  return { out, momObj, byDay };
}

function countInWindow(byDay, theme, n) {
  const slice = byDay.slice(-n);
  const s = new Set();
  for (const m of slice) if (m[theme]) for (const c of m[theme]) s.add(c);
  return s.size;
}

// 离线回放：从已有页面快照重建
export function runOffline(snapshotPath) {
  const html = readFileSync(snapshotPath, 'utf8');
  const arc = extractArchive(html);
  const allDays = arc.all_days || [];
  const { out, momObj } = enrich(allDays);
  recalcAll(out); // 统一公式重算（无原始数据的种子天自动 legacy 保留）
  const latest = out[out.length - 1];
  const archive = {
    meta: {
      generatedAt: new Date().toISOString(),
      formulaVersion: config.formulaVersion,
      source: 'offline-replay',
      note: '离线回放：情绪分沿用快照，题材已去噪。生产环境请跑 live 模式。',
    },
    all_days: out,
    signals: {
      version: config.formulaVersion,
      momentum: momObj,
      latestEmotion: latest.emotion,
      imputedRatioLatest: latest.emotion?.imputedRatio ?? 0,
      tradeDate: latest.trade_date,
    },
  };
  return archive;
}

// ── 供 recalcAll 使用的小工具（模块级，不在 forEach 里重复创建）────────────
const r1s = (v) => (v == null || !Number.isFinite(+v) ? null : Math.round(v * 10) / 10);

/** 与 src/dirty.js 的 num() 同款加固：拒 null/''/布尔/数组/对象（+[]===0 陷阱）。
 *  用于读取**存档里已有的值**做一致性比对——若不过这道闸，空数组会被当成 0，
 *  从而把"字段缺失"误判成"值不一致"，凭空造出一条待复核记录。 */
const numOf = (v) => {
  if (v == null || v === '') return null;
  const t = typeof v;
  if (t !== 'number' && t !== 'string') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
};

/**
 * 这一天是不是「只有回填数据」的形态？
 *
 * 判据与 src/backfill.js::buildBackfillDay 写下的形态一一对应：
 *   · buildBackfillDay 不采集行业（ind_count: 0）与涨跌家数（无 up_count），
 *     故回填天的特征就是"没有行业明细、也没有涨跌家数"。
 *   · 用 `ind_count` 判 0/缺失而不是"数组为空"：档里 industry 是裁剪形态，
 *     历史天可能连字段都没有；用 count 与 hasRaw 判据同源，不另立一套。
 *
 * ⚠ 判据必须**保守**：只要这天有行业或涨跌家数，就不标回填——宁可漏标（那天被
 *   当作真情绪分参与回测，是可复核的偏差），也不能误标（真数据被前端过滤掉，
 *   用户看不到，且**没有任何提示**）。这是"缺失显式化"在相反方向的同一条纪律。
 */
function isBackfillShaped(s) {
  if (!s) return false;
  const indCount = s.ind_count;
  const hasIndustry = indCount != null && Number.isFinite(+indCount) && +indCount > 0;
  const hasBreadth = s.up_count != null && s.down_count != null;
  if (hasIndustry || hasBreadth) return false;
  // 还没抓到龙虎榜原料的天也不是"回填天"——它是"空天"，两者语义不同
  // （空天连 s_net 都没有，回填天至少有 s_net）。不把它标成回填，避免混淆。
  return s.lhb_daily_net != null || s.lhb_all_net != null;
}

// 全档情绪重算：统一公式（computeSentiment）重跑所有交易日，再重算分位。
// 历史天缺原始数据的因子走 proxy（posRatio/行业涨比），完全无原始数据的种子天标记 _legacy 保留原值。
export function recalcAll(days) {
  const amts = days.map((d) => (d.summary && d.summary.amount_yi != null) ? d.summary.amount_yi : null);
  days.forEach((d, i) => {
    const s = d.summary || {};
    const hasRaw = (s.ind_count > 0 || s.lhb_daily_net != null || s.lhb_all_net != null);
    if (!hasRaw) { if (d.emotion) d.emotion._legacy = true; return; }

    // ── #3 脏数据标脏 ─────────────────────────────────────────────────────
    //   纪律：脏字段的**原始值保留在档里**（可追溯/可人工复核），只是不喂给
    //   computeSentiment —— 让因子走它既有的 missing/proxy 通道（那是一条已测试的
    //   "缺失显式化"路径），而不是被脏值污染后算出一个"看起来正常"的分数。
    //
    // ⚠ 时序纪律（本层最易踩的坑）：标脏必须发生在 caliberFromDay **之后**。
    //   caliberFromDay 会从原始记录**重写** s.lhb_daily_net / s.lhb_new_net 等字段。
    //   若在它之前校验，看到的是上一轮的旧值 → 漏标本轮新出现的脏值。
    //   故校验点统一放在"档内字段已定稿"之后（见下方 vres）。
    // 双口径统一从原始记录现算（每票一笔，取 |净额| 最大者），杜绝各自相加时把区间累计榜混进当日口径。
    // 权威口径 lhb_daily_net 喂日度因子；lhb_all_net 只作诊断留痕，两者不共用任何中间量。
    const c = caliberFromDay(d);
    if (c.total_records) {
      s.lhb_count = c.total_records;
      // 重复披露留痕：raw_records 为东财原始条数，merged_away 为被合并掉的同票同值重复条数。
      // 存量老数据还没这两个字段 → 只在现算能给出时写入，避免把历史天伪造出 0。
      if (c.raw_records != null) s.lhb_raw_count = c.raw_records;
      if (c.merged_away != null) s.lhb_merged_away = c.merged_away;
      s.lhb_stocks = c.all_stocks;
      s.lhb_all_net = c.all_net_yi;
      s.net_pos = c.all_pos;
      s.net_neg = c.all_neg;
      s.lhb_daily_stocks = c.daily_stocks;
      s.lhb_daily_net = c.daily_net_yi;
      s.lhb_daily_amt = c.daily_amt_yi;
      s.lhb_range_count = c.range_records;
      // 新股口径：由 src/lhb.js 唯一产出（当日榜去重行 → 分离新股净买）。
      // 这三个字段是「s_net 已自动剔新股」的证据链，报告与回测都读它们，不再各自现算。
      s.lhb_daily_ex_new_net = c.daily_ex_new_net_yi;
      s.lhb_new_net = c.daily_new_net_yi;
      s.lhb_new_ratio = c.daily_new_ratio;
      s.lhb_new_count = c.daily_new_count;
      s.lhb_new_stocks = c.daily_new_stocks;
      if (d.emotion) d.emotion.lhb_daily_net = c.daily_net_yi;
    }
    // 字段定稿后校验 + 把脏字段从因子入参里摘掉
    const vres = validateDay(d);
    const { cleaned, dropped } = sanitizeForFactors(d, vres);

    const netBuy = cleaned.netBuy ?? null;
    // 新股净买：优先用上面刚算出的当日榜分离结果；明细缺失的天回退为 0（不阻断，但不虚构数值）
    const newStockNet = cleaned.newStockNet ?? 0;
    // amount MA20：取当日之前最近 20 个有值交易日
    const hist = [];
    for (let j = i - 1; j >= 0 && hist.length < 20; j--) if (amts[j] != null) hist.unshift(amts[j]);
    const ma = hist.length >= 10 ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
    const sent = computeSentiment({
      netBuy,
      newStockNet,
      newStockRatio: cleaned.newStockRatio ?? null,
      upCount: cleaned.upCount ?? null,
      downCount: cleaned.downCount ?? null,
      posRatio: cleaned.posRatio ?? null,
      industryUp: cleaned.industryUp ?? null,
      industryTotal: cleaned.industryTotal ?? null,
      limitUp: cleaned.limitUp ?? null,
      limitDown: cleaned.limitDown ?? null,
      brokenCount: cleaned.brokenCount ?? null,
      amount: cleaned.amount ?? null,
      amountMA20: ma,
    }, config.weights);
    const FKEY = { s_net20: 's_net', s_pos10: 's_pos', s_brd20: 's_brd', s_hot10: 's_hot', s_zdt15: 's_zdt', s_zbl10: 's_zbl', s_amt15: 's_amt' };
    const facPlain = {};
    for (const [wk, pk] of Object.entries(FKEY)) facPlain[pk] = sent.factors[wk];
    // ⚠ 诊断字段的**凭据**必须在覆写 emotion 之前抓取。
    //   下方 `d.emotion = { ...d.emotion, ... }` 会用一份新对象替换旧对象；
    //   而 hot_count / industryCount 这两个"是否曾经采集过"的凭据就存在旧对象里，
    //   覆写之后再读只会读到 undefined（实测踩过：hot_count 被自己的凭据判据挡掉，
    //   导致最新日的 hot_count/topic_conc/top_topic 整组蒸发）。
    //   教训与 #3 标脏的"时序纪律"同源：**先取证、再改写**。
    //   取证用 `!= null`（`0` 是合法凭据——"真抓到 0 只强势股"是可能且必须保留的事实），
    //   但拒 undefined/''/null（那才是"从没采集过"）。
    const priorHotCount = (d.emotion && d.emotion.hot_count != null && d.emotion.hot_count !== '') ? d.emotion.hot_count : null;
    const priorIndustryCount = (d.emotion && d.emotion.industryCount != null && d.emotion.industryCount !== '') ? d.emotion.industryCount : null;
    d.emotion = {
      ...d.emotion,
      value: sent.score,
      ...facPlain,
      factors: facPlain,
      imputedRatio: sent.imputedRatio,
      missing: sent.missing,
      newStock: sent.newStock,
      // ── 回填标记（BACKFILL_FLAG）由**本重算路径统一裁定** ──────────────────
      //   ⚠ 这是一处真实的漂移源，实测抓出来的（scripts/need_rebuild.mjs --verify 报 241/241 天变）：
      //     旧档里有 208 天带 `emotion._backfill = true`（历史龙虎榜回填天），而本函数
      //     只重建**数值因子**、从不写这个标记；一旦经 recalcAll 重算，标记即被静默抹掉。
      //     后果不是"少个字段"，而是**判定翻转**：回测/前端都靠它排除"只有 s_net、
      //     其余六因子未采集"的假情绪分天。标记丢了 → 208 天的假分混进回测样本，
      //     每个指标一起失真，而且没有任何报错。
      //   故在此按**原料可得性**重新裁定，与 src/backfill.js 的 buildBackfillDay 同判据：
      //     回填天 = 无行业明细（ind_count 缺失/为 0）且无涨跌家数（up_count 缺失）。
      //     这正是 buildBackfillDay 写下的形态（ind_count: 0，无 up_count）。
      //   注意判据用 `hasRaw` 而非"字段存在与否"：hasRaw 已经区分了"有原始数据"与
      //   "有壳无内容"，两者是同一件事的两个说法，不应各写一遍。
      ...(isBackfillShaped(s) ? { [BACKFILL_FLAG]: true } : {}),
      // #3 标脏留痕：本日被剔除的因子入参 + 校验状态。
      //   只写"有情况"的天（干净天不写字段），避免给 241 天全加上噪声字段。
      //   形态：{ status, dropped: ['netBuy', ...], issues: [{field,rule,severity,reason}] }
      //   报告与前端据此说"今天哪个因子被跳过了"，而不是让用户猜。
      ...(vres.status === 'ok' ? {} : {
        dirty: {
          status: vres.status,
          dropped: dropped.slice(),
          fields: [...vres.dirtyFields],
          issues: vres.issues.map((x) => ({ field: x.field, rule: x.rule, severity: x.severity, reason: x.reason })),
        },
      }),
    };
    // ── 诊断字段由重算路径刷新（防"算过就不管"的静默陈旧）──────────────────
    //   实测抓出的第二处漂移：`emotion.pos_ratio / up_ratio / hot_count / topic_conc /
    //   top_topic` 只在**实时抓取**（src/sources.js buildDay）时写入，
    //   recalcAll 不碰它们。于是经重算路径回写后，最新一天这五个字段整组消失——
    //   它们是留痕/证据链（守卫按 pos_ratio 反算校验 s_pos 用的就是 pos_ratio），
    //   丢了之后守卫虽不报错、但**证据链断了一环**。
    //
    //   ⚠ 但"补字段"有一个**不可逆的伪造风险**，故必须与真实抓取严格区分：
    //     历史天（回填/早期）的档里 `hot` 是**裁剪后的空壳**（buildBackfillDay 直接写
    //     `hot: []`），hot_count 则从未写入过。若按"用档里现成数据重建"去补，
    //     就会用空壳算出 `hot_count = 0` 并落盘 —— 那是**把"未采集"伪造成"今天有 0 只
    //     强势股"**，恰恰违反本项目铁律（缺失显式化：unknown ≠ 0）。
    //     实测验证过这个陷阱：第一版补字段把首日补成 hot_count=0，而真实值是"未采集"。
    //   故补字段必须带**证据门槛**：只有当原料在档里是**真值**时才补，否则**保持缺失**。
    //     · pos_ratio：net_pos/net_neg 是正式链路的真值（回填天也有）→ 可补
    //     · hot_count / topic_conc / top_topic：**只有**当日真实抓过 hot 才有意义 →
    //       以 `emotion.hot_count` 曾存在或 `summary.hot_count` 存在为凭据，否则跳过
    //     · up_ratio：需 industry 明细 + ind_up，两者齐备才补
    //
    //   ⚠⚠ 第三处发现（**不是漂移，是既有数据不可复现**）——
    //     实测枚举了四种可能口径，**没有任何一种能从存档数据反推出 pos_ratio**：
    //       全部记录笔数比 1/33、每股一笔(|额|最大) 5/33、金额比 5/33、去重行数比 1/33。
    //     即：存档里的 `emotion.pos_ratio` 与当天存档的 `summary.net_pos/net_neg`
    //     **不自洽**（例：2026-08-14 存 52.7，而 net_pos=33/net_neg=34 → 49.25）。
    //     它大概是某次已废弃口径的遗留产物，但**原始输入已不可考**。
    //     处置（关键，别改成"顺手覆盖"）：
    //       · 若直接把重算值写进去 → 30 个历史日的 `pos_ratio` 会被静默改写，
    //         而这 30 天正是回填期数据，**没人能判断哪个才是对的**。那是拿一次
    //         "修复"去掩盖一次"数据完整性问题"，且不可逆（原值没了）。
    //       · 故：**现存的存疑值原样保留**，只在重算值与之不一致时打留痕
    //         `pos_ratio_inconsistent`，交给报告/人工复核。这是"缺失显式化"的延伸：
    //         **不一致也要显式化**，不能靠覆盖来消灭症状。
    //       · 只在原本没有该字段时**补**（补的是可复现值，有据可依）。
    if (s.net_pos != null && s.net_neg != null && (s.net_pos + s.net_neg) > 0) {
      const recomputed = r1s((s.net_pos / (s.net_pos + s.net_neg)) * 100);
      const stored = (d.emotion && d.emotion.pos_ratio != null) ? numOf(d.emotion.pos_ratio) : null;
      if (stored == null) {
        d.emotion.pos_ratio = recomputed;
      } else if (recomputed != null && Math.abs(stored - recomputed) > 0.05) {
        // 保留原值 + 留痕。留痕里同时给出"存档值"与"由存档输入重算的值"，
        // 复核者不必自己去翻 net_pos/net_neg 就能判断。
        d.emotion.pos_ratio_stale = {
          stored,
          recomputed,
          inputs: { net_pos: s.net_pos, net_neg: s.net_neg },
          note: '存档 pos_ratio 与由 summary.net_pos/net_neg 重算的值不一致，且原口径不可复现；'
            + '原值已保留未改写，此处仅留痕待人工复核。',
        };
      }
    }
    if (Array.isArray(d.industry) && d.industry.length && s.ind_up != null) {
      d.emotion.up_ratio = r1s((s.ind_up / d.industry.length) * 100);
    }
    // 强势股相关三字段：凭据 = 这一天**确实抓过**热榜（priorHotCount 非 null）。
    //   这是唯一能区分"真 0 只"与"未采集"的信息；绝不看 d.hot.length 反推
    //   （回填天的 d.hot 是空壳，反推会得出"今天有 0 只强势股"的伪造结论）。
    if (priorHotCount != null && Array.isArray(d.hot)) {
      d.emotion.hot_count = d.hot.length;
      const top = Array.isArray(d.topics) && d.topics.length ? d.topics[0] : null;
      if (top && top.count != null) {
        d.emotion.topic_conc = r1s((top.count / (d.hot.length || 1)) * 100);
      }
      if (top && top.tag != null) d.emotion.top_topic = top.tag;
    }
    // ── 重算路径必须与在线抓取**同字段集**：industryCount 是 buildDay 写的诊断字段，
    //   重算路径漏写会让它整组消失（实测：最新日 industryCount 丢失）。
    //   ⚠ 只在**真抓到行业明细**时写（ind_count > 0）。回填天 buildDay 从未运行过，
    //     给它补一个 industryCount: 0 等于**把"未采集"伪造成"采集到 0 个行业"**——
    //     正是本项目反复禁止的那件事。判据取 ind_count > 0，不用"字段是否存在"，
    //     但一旦这天曾经有过真值（priorIndustryCount），本轮的 0 就是"真的掉到 0"，
    //     此时**保留真值 0** 而不是删字段（否则会把一次真实退化伪装成"未采集"）。
    if (priorIndustryCount != null && !(s.ind_count > 0)) {
      d.emotion.industryCount = 0;
    } else if (s.ind_count != null && Number.isFinite(+s.ind_count) && +s.ind_count > 0) {
      d.emotion.industryCount = +s.ind_count;
    } else {
      delete d.emotion.industryCount;
    }
  });
  // 板块相对强弱：与情绪分一样属于**派生指标**，必须在每次写档时重算——
  // 否则新增口径（如换基准、改 topN）对存量天永不生效，只能靠手工回填。
  // 口径唯一实现在 src/relative.js；此处只负责调用与挂载。
  // 无行业明细的历史天（208/241）返回 null → 不写字段，报告/前端显示「未计算」。
  days.forEach((d) => {
    if (!d.summary) return;
    const rel = computeRelative(d);
    if (rel) d.summary.industry_relative = rel;
    else delete d.summary.industry_relative;
  });
  recalcRanks(days);
}

/**
 * 把新抓交易日合并进历史（就地更新 history）：
 *  - 同日已存在 → 替换；席位明细取覆盖率更高的一份（防新抓批次倒退）
 *  - 新天涨跌家数缺失而旧档有值 → 用旧档回填，防重跑降级
 * 返回 {replaced, appended, breadthFilled}，便于测试与日志。
 *
 * 注：此函数曾被 8853a17 引入的 `old is not defined` 打挂（引用未声明变量），
 * 导致 runLive 每次重跑当日数据都抛 ReferenceError → 整体回退 → meta.stale 恒为 true。
 * 抽为纯函数以便回归测试守护。
 */
export function mergeNewDays(history, newDays) {
  let replaced = 0, appended = 0, breadthFilled = 0;
  for (const nd of newDays) {
    const i = history.findIndex((d) => d.trade_date === nd.trade_date);
    if (i >= 0) {
      const old = history[i];
      const oldSeats = old.summary?.seats, newSeats = nd.summary?.seats;
      const oldBetter = oldSeats && newSeats && oldSeats.detail && !newSeats.detail && oldSeats.cover > newSeats.cover;
      if (oldSeats && oldBetter) {
        nd.summary = nd.summary || {};
        nd.summary.seats = oldSeats;
      }
      // 涨跌家数偶发抓取失败：新天缺失而旧档有值则回填，防重跑降级
      if (old.summary?.up_count != null && nd.summary?.up_count == null) {
        nd.summary = nd.summary || {};
        for (const k of ['up_count', 'down_count', 'flat_count']) nd.summary[k] = old.summary[k];
        breadthFilled++;
        console.log('[merge-breadth]', nd.trade_date, '回填涨跌家数', old.summary.up_count, '/', old.summary.down_count);
      }
      history[i] = nd;
      replaced++;
    } else {
      history.push(nd);
      appended++;
    }
  }
  return { replaced, appended, breadthFilled };
}

// 线上模式：抓取真实数据，合并进已存档历史 → 全档重算分位
// fetchLive 返回 { newDays:[day], tradeDate }，day 结构与快照一致
export async function runLive() {
  const { newDays, tradeDate } = await fetchLive();
  // 载入历史（冷启动用快照种子）
  let history = [];
  const dataPath = path.join(DATA_DIR, 'archive.json');
  if (existsSync(dataPath)) {
    // 读回来必须 decode：主档是码表压缩态，reasons 被换成了下标数组。
    // 直接喂给 caliberFromDay 会让 isRangeBoard 拿不到中文原文而静默失配——
    // 表现就是「区间榜被当成当日榜」，区间累计值混进日度因子。
    try { history = decodeArchive(JSON.parse(readFileSync(dataPath, 'utf8'))).all_days || []; } catch { history = []; }
  }
  if (!history.length) {
    history = runOffline(path.join(ROOT, 'snapshot.html')).all_days || [];
  }
  const merged = mergeNewDays(history, newDays);
  console.log('[merge] 替换', merged.replaced, '| 新增', merged.appended,
    '| 涨跌家数回填', merged.breadthFilled);
  history.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));

  // 龙虎榜晚间分批披露：重抓上一交易日 lhb 刷原始数据（行业/涨跌停池收盘即定死，无需补抓）
  const prevDays = history.filter((d) => d.trade_date < tradeDate).slice(-1);
  for (const day of prevDays) {
    try {
      const lhbRaw = await fetchLhb(day.trade_date);
      applyLhb(day, lhbRaw);
      console.log('[refresh-lhb]', day.trade_date, '补抓成功, 榜单', lhbRaw.length, '条');
    } catch (e) {
      if (e instanceof LhbNotPublishedError) console.log('[refresh-lhb]', day.trade_date, '未公布，跳过');
      else console.error('[refresh-lhb]', day.trade_date, '失败:', e.message);
    }
    // 席位明细同样晚间分批发布：上一交易日覆盖率不满、缺逐票明细（锁仓口径原料），
    // 或明细仍是**旧格式（仅买方，无卖侧）**则补抓（取优）。第三项是本次买卖双侧升级后的关键：
    // 旧档 detail 是买方数组（真值判断为真），若不加这条，历史天数永远不会补上卖方明细。
    if (Array.isArray(day.lhb_aggr) && day.lhb_aggr.length) {
      const oldCover = day.summary?.seats?.cover ?? 0;
      const oldDetail = day.summary?.seats?.detail;
      const noSellSide = oldDetail && Object.values(oldDetail).some((v) => Array.isArray(v));
      if (oldCover < 100 || !oldDetail || noSellSide) {
        try {
          const seats = await fetchSeats(day.trade_date, day.lhb_aggr.map((l) => ({ code: l.code, name: l.name, net_buy_wan: l.net_buy_wan })));
          const newHasSell = seats.detail && Object.values(seats.detail).some((v) => v && !Array.isArray(v) && (v.s || []).length);
          if (seats.cover > oldCover || !oldDetail || newHasSell) {
            day.summary = day.summary || {};
            day.summary.seats = seats;
            console.log('[refresh-seats]', day.trade_date, '补抓席位 cover', oldCover, '→', seats.cover + '%');
          }
        } catch (e) { console.error('[refresh-seats]', day.trade_date, '失败:', e.message); }
      }
    }
  }

  recalcAll(history);
  const { out, momObj } = enrich(history);
  const latest = out[out.length - 1];
  const archive = {
    meta: {
      generatedAt: new Date().toISOString(),
      formulaVersion: config.formulaVersion,
      source: 'live',
      tradeDate,
    },
    all_days: out,
    signals: {
      version: config.formulaVersion,
      momentum: momObj,
      latestEmotion: latest.emotion,
      imputedRatioLatest: latest.emotion?.imputedRatio ?? 0,
      tradeDate: latest.trade_date,
    },
  };
  return archive;
}

export function writeArchive(archive, filePath) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const p = filePath || path.join(DATA_DIR, 'archive.json');
  const { ok, errors } = validateArchive(archive);
  if (!ok) {
    throw new Error('校验失败: ' + errors.join('; '));
  }
  // 码表压缩 + 提子：只在**落盘时**生效（内存里始终是中文原文，口径正则才不会失配）。
  // 主档与切片都写压缩态——它们都是读盘产物，读回来统一走 decodeArchive 还原。
  //
  // ⚠ 提子（deflate）必须开启，且与 src/lhb_codec.js 的 writeArchiveSafely 一致。
  //   历史坑：本函数曾漏传 `{ deflate: true }`，于是 pipeline 写出的主档是
  //   `day.lhb` 内联，而 writeArchiveSafely / 存量档是 `day._sub.lhb`——
  //   同一份存档有了两种形态，审计断言（"主档写盘态 lhb 已提子"）在
  //   pipeline 自己写完之后反而变红。两条写盘路径必须产出同一种形态。
  //   本次由 backfill_relative.mjs 走 writeArchive 回写存量档时暴露。
  const codes = buildReasonCodes(archive.all_days);
  const packed = encodeArchive(archive, codes, { deflate: true });
  // 紧凑写盘：`rc` 是数字下标数组，加 2 空格缩进会被 JSON 展开成一行一个数字，
  // 缩进开销足以吃掉码表 92% 的收益（实测 4.99MB → 9.44MB，比压缩前还大）。
  writeFileSync(p, JSON.stringify(packed), 'utf8');
  // 切片与主档**同源生成**：每次写主档都重建切片，杜绝"两个文件各自演化"。
  // 只在写默认主档时生成——--out 到别处（测试/临时）不该污染 data/ 下的切片。
  let shards = null;
  if (!filePath) {
    try {
      shards = writeShards(packed);
    } catch (e) {
      // 切片失败不得让主档写入回滚（主档是权威源，切片是派生视图）
      console.error('[split] 切片生成失败（主档已写入，前端将回退全量档）:', e.message);
    }
  }
  return { path: p, ok: true, shards, reasonCodes: codes.length };
}

// 生成「索引 + 按年分片 + 近 N 日滚动窗」。与 scripts/split_archive.mjs 共用
// src/archive_split.js，保证两条路径产出的切片结构完全一致（不存在两套拆法）。
export function writeShards(archive, dir = DATA_DIR) {
  const index = buildIndex(archive);
  const shards = buildShards(archive);
  const years = Object.keys(shards).sort();
  writeFileSync(path.join(dir, 'archive-index.json'), JSON.stringify(index), 'utf8');
  for (const y of years) {
    writeFileSync(path.join(dir, shardName(y)), JSON.stringify(shards[y]), 'utf8');
  }
  // 滚动窗：走势图/抽屉只需最近 30 个交易日，不该为它拉整年分片（2026 年分片仍 >4MB）
  // 注入 aggregateByCode：主档不再持久化 lhb_aggr（体积纪律，见 recalc_lhb_daily.mjs），
  //   而滚动窗「最新日」是展示层唯一入口，需带 lhb_aggr 一屏。这里现从当日 lhb 聚合，
  //   只算 1 天，代价 O(条数)。本模块保持零业务依赖（与 marketAlertsFn 同款注入）。
  const recent = buildRecent(archive, RECENT_DAYS, { aggregateFn: aggregateByCode });
  writeFileSync(path.join(dir, RECENT_FILE), JSON.stringify(recent), 'utf8');
  // 最轻档：只含最新日 + 动量 + 大盘告警 + 数据健康（~14KB）。给"不跑前端只看今日结论"的读者。
  // marketAlerts / healthReport 都是**纯函数**，注入进来而不是让本模块 import 业务依赖 —— 保持 archive_split 无业务依赖。
  // 健康报告注入 assessFreshness + meta：新鲜度那一项需要日历与"当前时刻"，
  //   两者都只有管线这边有（前端没有日历文件），故必须在这里算好随文件下发。
  const signals = buildSignals(archive, {
    assumedTotal: 100000,
    marketAlertsFn: marketAlerts,
    healthFn: (ds, o) => healthReport(ds, {
      ...o,
      assessFn: assessFreshness,
      holidays: resolveHolidays(),
    }),
    // 席位属性（#1）：纯函数，只读 summary.seats，无网络依赖 → 每次写档都刷新，
    //   历史随有数据的天数自然增长（接口只保留最近数日，见 src/seats_daily.js 头注）。
    seatSeriesFn: (ds) => {
      const series = buildSeatSeries(ds);
      return { series, summary: seatSeriesSummary(series, { totalDays: ds.length }), verdict: seatVerdict(series) };
    },
    // 亏钱效应（#2）：需要**全市场真实行情**，本函数是同步的、不能 await，
    //   故这里只读已落盘的 pains 缓存（由 scripts/fetch_pain.mjs 在收盘后写入）。
    //   读不到就是 null —— 绝不在此现造，否则会把失败伪装成"今天很平静"。
    painFn: () => {
      try {
        const p = path.join(dir, 'pain-latest.json');
        if (!existsSync(p)) return null;
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch { return null; }
    },
    // 市场宽度（#3）：读已落盘的 breadth-latest.json / breadth-daily.json
    //   （由 scripts/fetch_breadth.mjs 在收盘后分片抓全市场 K 线后汇总）。
    //   同样**只读不现算**：宽度要扫全市场 K 线，不可能在同步写盘路径里做；
    //   读不到就是 null，绝不伪造一个"宽度正常"。
    breadthFn: () => {
      try {
        const p = path.join(dir, 'breadth-latest.json');
        if (!existsSync(p)) return null;
        const snapshot = JSON.parse(readFileSync(p, 'utf8'));
        // 逐日序列（可选）：有了才下发，没有就只给快照。
        let series = [];
        let summary = null;
        const dp = path.join(dir, 'breadth-daily.json');
        if (existsSync(dp)) {
          const daily = JSON.parse(readFileSync(dp, 'utf8'));
          series = buildBreadthSeries(daily.rows || []);
          // 覆盖率分母用**档案里的交易日数**（不是宽度序列长度）——否则滤空行后恒为 100%，
          // 会虚报覆盖（seats_daily 踩过同一个坑）。
          summary = breadthSeriesSummary(series, { totalDays: (archive.all_days || []).length });
        }
        return { snapshot, series, summary, verdict: snapshot.verdict || null };
      } catch { return null; }
    },
    // 跨源一致性互证（#2）：读已落盘的 crosscheck-latest.json
    //   （由 scripts/fetch_crosscheck.mjs 联网取第二行业源后写入）。
    //   本函数同步、不能 await，故**只读不现抓**——读不到就是 null，
    //   前端显示"未互证"，**绝不把"没做互证"渲染成"两源一致"**（本项目铁律：没检查 ≠ 没问题）。
    crosscheckFn: () => {
      try {
        const p = path.join(dir, 'crosscheck-latest.json');
        if (!existsSync(p)) return null;
        const raw = JSON.parse(readFileSync(p, 'utf8'));
        // 体积纪律：signals 是最轻档（<50KB 预算），而 crosscheck 的逐行业明细（72+ 行）
        //   在**首屏面板上并不需要**——面板只展示 KPI + flagged（越界项）。
        //   rows 仍留在 crosscheck-latest.json 里（供审计/人工复核按需拉取），
        //   此处只裁剪下发给首屏的那一份，避免"为了一个面板把轻量档吹大"。
        const { rows, ...brief } = raw;
        return { ...brief, rowCount: Array.isArray(rows) ? rows.length : 0 };
      } catch { return null; }
    },
  });
  if (signals) writeFileSync(path.join(dir, SIGNALS_FILE), JSON.stringify(signals), 'utf8');
  // 清理被淘汰的年份分片（年份集合会变），避免前端拉到过期数据
  try {
    const keep = new Set([...years.map((y) => shardName(y)), RECENT_FILE, SIGNALS_FILE]);
    for (const f of readdirSync(dir)) {
      if (/^archive-\d{4}\.json$/.test(f) && !keep.has(f)) {
        unlinkSync(path.join(dir, f));
        console.log('[split] 删除过期分片', f);
      }
    }
  } catch { /* 目录读取失败不致命 */ }
  return {
    index: 'archive-index.json',
    recent: RECENT_FILE,
    signals: SIGNALS_FILE,
    years,
    totalDays: (archive.all_days || []).length,
    recentDays: recent.days.length + (recent.latest ? 1 : 0),
  };
}

// 主入口
export async function main() {
  const mode = process.env.MODE || 'offline';
  const dataPath = path.join(DATA_DIR, 'archive.json');
  const now = new Date();

  // 非交易日：live 模式不抓数据，但仍刷新 meta 的新鲜度判定（自愈可能粘着的旧标记）
  const today = todayBeijing();
  if (mode === 'live' && !isTradingDay(today, resolveHolidays())) {
    console.log('[skip]', today, '非交易日，保留上次数据');
    refreshMetaOnly(dataPath, now, { outcome: 'non-trading-day', reason: `${today} 非交易日` });
    // 标的池是**日期敏感**的派生物：active（近 30 交易日）与 quoteFresh（== 最新交易日）
    // 都会随时间推移而变化。非交易日不重建，长假 7 天后池子仍宣称「当日有价 66 只」——
    // 用户按它下单会拿到 9 天前的陈旧价，而界面上的日期徽章是对的、只有池子标签在说谎。
    // 重建本身零成本（纯读主档 + 纯函数推导，不发网络请求），故这里无条件刷新。
    refreshUniverseOnly(today);
    return null;
  }

  let archive;
  let attempt;
  if (mode === 'live') {
    try {
      archive = await runLive();
      attempt = { outcome: 'ok', reason: null };
    } catch (e) {
      if (e instanceof LhbNotPublishedError) {
        console.log('[skip]', e.message, '· 等待龙虎榜公布，保留上次数据');
        console.log('::warning::本次未抓取：' + e.message + '（保留上次数据；18:30 首抓 / 21:00 补抓）');
        refreshMetaOnly(dataPath, now, { outcome: 'skipped', reason: e.message });
        return null;
      }
      console.error('[live] 抓取失败，回退:', e.message);
      console.log('::warning::live 抓取失败，本次写入回退档（meta.lastAttempt.outcome=failed）：' + e.message);
      archive = fallbackArchive(dataPath, e.message);
      attempt = { outcome: 'failed', reason: e.message };
    }
  } else {
    archive = runOffline(process.env.SNAPSHOT || path.join(ROOT, 'snapshot.html'));
    attempt = { outcome: 'offline-replay', reason: null };
  }
  applyFreshness(archive, now, attempt);
  const res = writeArchive(archive, dataPath);
  console.log('写入', res.path, '| 交易日', archive.signals.tradeDate,
    '| 新晋', archive.signals.momentum.fresh.length,
    '| 退潮', archive.signals.momentum.fading.length,
    '| 补位比', archive.signals.imputedRatioLatest,
    '| 情绪分', archive.signals.latestEmotion?.value ?? archive.signals.latestEmotion?.score);
  console.log('[freshness]', archive.meta.freshness.state, '| stale =', archive.meta.stale,
    archive.meta.staleReason ? '| ' + archive.meta.staleReason : '| 数据为最新已收盘会话');
  return archive;
}

// 把新鲜度判定写进 meta（成功/回退/跳过三条路径统一口径）。
// stale 不再表示「上次尝试失败」，而是「存档交易日落后于最近已收盘交易日且已过预期更新时刻」，
// 由 assessFreshness 按交易日历算；抓取是否成功另记于 meta.lastAttempt。
//
// 相位（phase）与新鲜度（state）正交，必须一起写：前者说「现在市场在什么阶段」，
// 后者说「存档是不是最新已收盘会话」。盘中跑快照时 phase=live 而 state 仍指上一收盘日——
// 两者同时出现才是准确的，缺一个读者就会误读「实时数据 vs 收盘分位」。
function applyFreshness(archive, now, attempt) {
  archive.meta = archive.meta || {};
  const tradeDate = archive.meta.tradeDate
    || archive.signals?.tradeDate
    || (archive.all_days || []).slice(-1)[0]?.trade_date
    || null;
  applyFreshnessMeta(archive.meta, tradeDate, now, resolveHolidays(), attempt);
  applyPhaseMeta(archive.meta, now, resolveHolidays());
  return archive;
}

// 只刷新存档 meta 的判定字段（不碰数据）。用于「跳过 / 非交易日」：
// 这些路径没有新数据，但新鲜度判定必须跟着时间走，否则旧标记会一直粘着页面。
function refreshMetaOnly(dataPath, now, attempt) {
  if (!existsSync(dataPath)) return null;
  let a;
  try { a = decodeArchive(JSON.parse(readFileSync(dataPath, 'utf8'))); } catch { return null; }
  const before = freshnessKey(a.meta);
  const f = applyFreshness(a, now, attempt).meta.freshness;
  if (freshnessKey(a.meta) === before) {
    console.log('[freshness] meta 未变化 |', f.state);
    return a;
  }
  // 刷新 meta 也必须走压缩写盘，否则会把刚压好的主档「解压」回中文原文（体积翻数倍）。
  // 这里重新编码是幂等的：entries 已带 rc 时 encodeDay 原样返回。
  writeFileSync(dataPath, JSON.stringify(encodeArchive(a, buildReasonCodes(a.all_days))), 'utf8');
  // 切片必须跟着刷新：首屏读的是 archive-index.json 的 meta（相位/新鲜度），
  // 只更新主档会让页面顶部的相位标签与 STALE 标记停在旧值上——而这两者恰恰是
  // 「数据是否可信」的唯一提示，过期比没有更危险。
  if (path.basename(dataPath) === 'archive.json') {
    try { writeShards(a); } catch (e) { console.error('[split] 切片刷新失败:', e.message); }
  }
  console.log('[freshness] meta 已刷新 |', f.state, '| stale =', a.meta.stale,
    a.meta.staleReason ? '| ' + a.meta.staleReason : '');
  return a;
}

/**
 * 非交易日也重建标的池。
 *
 * 为什么必须做：池子里有两个**随时间漂移**的字段——
 *   · active     = 最近 30 个交易日内出现过（窗口在滑）
 *   · quoteFresh = asOf === 主档最新交易日
 * 平时这两个字段由管道每交易日重建，看不出问题；但**长假期间管道整段跳过**，
 * 于是 7 天国庆后池子仍写着「当日有价 66 只 · 活跃 N 只」，而实际上所有价都已陈旧。
 * 界面上的行情徽章取的是实时价（真话），池子标签却是 9 天前算的（假话）——两者矛盾时用户会信错的。
 *
 * 为什么不干脆不在非交易日 tag 上「今日」：报价新鲜度是**数据属性**，不是渲染属性。
 * 让 UI 去减日期差就是第二套口径；正确做法是让数据本身跟着日历走。
 *
 * 实现：读主档 → 纯函数重算 → 写盘（紧凑）。零网络请求，失败只告警不影响主档。
 */
function refreshUniverseOnly(today) {
  const script = path.join(ROOT, 'scripts', 'fetch_universe.mjs');
  if (!existsSync(script)) return null;
  try {
    // 用子进程跑，保证与 CI / 本地手动执行**同一条代码路径**（绝不在此重写一份池子构建逻辑）。
    const r = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      console.log('::warning::非交易日标的池重建失败：' + (r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' '));
      return null;
    }
    const tail = (r.stdout || '').trim().split('\n').slice(-1)[0];
    console.log('[universe] 非交易日已按日历重建标的池 |', today, '|', tail);
    return tail;
  } catch (e) {
    console.log('::warning::非交易日标的池重建异常：' + e.message);
    return null;
  }
}

// 回退：优先用已提交的真实 archive.json（记录原因），否则用快照演示数据。
// 注：这里的 stale=true 只是保守默认值，随后 applyFreshness 会按日历重算——
// 若回退档的数据本就是最新已收盘会话，不该继续误报滞后。
function fallbackArchive(dataPath, reason) {
  const mark = (a) => {
    a.meta = a.meta || {};
    a.meta.stale = true;
    if (reason) a.meta.fallbackReason = reason;
    return a;
  };
  if (existsSync(dataPath)) {
    return mark(decodeArchive(JSON.parse(readFileSync(dataPath, 'utf8'))));
  }
  return mark(runOffline(process.env.SNAPSHOT || path.join(ROOT, 'snapshot.html')));
}

// 直接运行时执行（用 pathToFileURL 比较：Windows 下 argv[1] 是 C:\… 而 import.meta.url 是 file:///C:/…，
// 直接拼 'file://' + argv[1] 恒不相等 → 本地直跑会静默什么都不做）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
