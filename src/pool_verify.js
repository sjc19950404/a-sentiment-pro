// ── 推送前校验 + 入库前收盘口径复核（2026-10-10 用户指令）─────────────────────
//
// 三个纯函数（零 Node 依赖，Node/CI/浏览器同构可测）：
//   verifyIntradayPools —— 盘中报告推送前逐只重验双池规则。判据与
//     buildIntradayPool **同源**：INTRADAY_POOL_FILTERS / STREAK_POOL_FILTERS /
//     minutesToCloseBJ 一律 import 复用，绝不复制魔法数——判据漂移 = 校验器失真；
//   applyVerification —— 把校验结果（剔除/降级）原地应用到报告：推送的就是校验后的，
//     台账写 report.push_verification（fingerprintOf 稳定域不含此顶层字段，
//     payload 的真实变化才驱动指纹——校验确定性 → 同快照同剔除同指纹，防风暴语义不变）；
//   closeoutReview —— 收盘口径复核（纯台账不拦截）：当日盘中档案 vs ztpool_history
//     收盘档——池标的收盘结局 / 推送时情绪 vs 收盘情绪漂移 / 连板矛盾。
//
// 纪律（与全库一致）：
//   · 宁缺毋假——复核快照缺席/非当日 → 跳过并报因，绝不拿旧快照冒充复核；
//   · 剔除语义——核验字段缺失/标的掉出数据底座同样剔（推送时点它已不可证明满足规则），
//     台账逐只留 reason；
//   · 降级只升不降——trend → tomorrow_watch 随推送时点进入降级窗单向发生，
//     不因重跑回退（时点语义不可逆，与 buildIntradayPool 同律）。
import {
  INTRADAY_POOL_FILTERS, STREAK_POOL_FILTERS, minutesToCloseBJ,
} from './ai_report.js';
import { computeEmotion, computeEmotionMetrics } from './emotion_cycle.js';

// 与 ai_report.js 内部 is_valid 硬闸同源（未导出，复制判据并锚定注释——两处必须同步改）
const isValidNum = (v) => v != null && v !== '' && Number.isFinite(+v);

/**
 * 盘中报告推送前校验：对 simulation_stock 双池逐只重验规则（数据底座 = 最新快照）。
 * @param {object} report 盘中报告（信封完整结构）
 * @param {object|null} intraday data/intraday.json 最新快照
 * @param {{nowBJ?:string}} opts 推送时刻 'HH:mm[:ss]'（降级窗复核；缺省取快照数据时点）
 * @returns {{summary:object, patched:{candidate_pool:Array,streak_pool:Array,
 *   trend_pool_mode:string}|null}} summary 可序列化台账；patched = 校验后的池
 *   （skipped 时 null——调用方不应用，不冒充校验过）。
 */
export function verifyIntradayPools(report, intraday, opts = {}) {
  const sim = report?.payload?.simulation_stock ?? null;
  const summary = {
    checkedAtBJ: opts.nowBJ ?? null,
    snapshotAtBJ: intraday?.capturedAtBJ ?? null,
    tradeDate: intraday?.tradeDate ?? null,
    trend_pool_mode: sim?.trend_pool_mode ?? 'trend',
    minutes_to_close: null,
    mode_degraded: false,
    trend: { checked: 0, removed: [] },
    streak: { checked: 0, removed: [] },
    applied: false,
    note: null,
  };
  if (report?.report_type !== 'intraday') {
    summary.note = `报告类型 ${report?.report_type ?? '无'} 非盘中口径，推送前校验仅覆盖 intraday`;
    return { summary, patched: null };
  }
  if (!sim || !Array.isArray(sim.candidate_pool)) {
    summary.note = '档案无 simulation_stock.candidate_pool（模拟选股关闭或缺席）';
    return { summary, patched: null };
  }
  // ── 结构性违背 vs 时点性漂移（2026-10-10 P0 用户指令「严重违背筛选条件禁止上屏」）──
  //   结构性违背（连板股混入趋势池 / 涨跌停股在「未涨停 3-7%」池 / 断板股漏过昨日涨停
  //   黑名单 / 一字混入连板池）与快照时点**无关**——旧档、跨拍、快照缺席同样错误，
  //   恒剔除，不受同拍守卫保护（同拍守卫只保护「掉出底座/量比转弱」这类时点漂移——
  //   那是行情变化不是数据错误）。档案自证字段（selection_reason 连板声称 / 档案
  //   intraday_chg 涨跌停）**不依赖快照**——10-09 旧档推送时快照已换日，靠这两条
  //   才能拦住「6 连板 9.99%」混在趋势池标题下的实盘事故。
  const S = STREAK_POOL_FILTERS; // 连板池独立判据（边界写死）——与构建端同一常量，预筛/核验共用
  const structuralRemoved = { trend: 0, streak: 0 };
  const claimedLbOf = (item) => {
    const m = /^(\d+)\s*连板/.exec(String(item?.selection_reason || ''));
    return m ? +m[1] : null;
  };
  const structuralPreScreen = (item, poolKind) => {
    // 返回 reason（结构违背）或 null（档案自证未发现）
    const claimed = claimedLbOf(item);
    const chg = isValidNum(item?.intraday_chg) ? +item.intraday_chg : null;
    if (poolKind === 'trend') {
      if (claimed != null && claimed >= S.min_lb) return `连板股混入趋势池（档案自称 ${claimed} 连板）——结构违背恒剔除`;
      if (chg != null && chg >= 9.9) return `涨停股混入趋势池（档案记录 ${chg}%）——结构违背恒剔除`;
      if (chg != null && chg <= -9.9) return `跌停股混入趋势池（档案记录 ${chg}%）——结构违背恒剔除`;
    } else {
      if (claimed != null && claimed < S.min_lb) return `连板身份不足（档案自称 ${claimed} 连板 <${S.min_lb}）——结构违背恒剔除`;
      if (chg != null && chg <= -9.9) return `跌停股混入连板池（档案记录 ${chg}%）——结构违背恒剔除`;
    }
    return null;
  };
  // 结构预筛（快照无关）恒执行——快照缺席/非当日时这是唯一防线（旧档补推场景）
  const preScreenedTrend = [];
  summary.trend.checked = sim.candidate_pool.length;
  for (const item of sim.candidate_pool) {
    const reason = structuralPreScreen(item, 'trend');
    if (reason) {
      summary.trend.removed.push({ code: item?.code != null ? String(item.code) : null, name: item?.name ?? null, reason, kind: 'structural' });
      structuralRemoved.trend++;
    } else preScreenedTrend.push(item);
  }
  const preScreenedStreak = [];
  const streakItems0 = Array.isArray(sim.streak_pool) ? sim.streak_pool : [];
  summary.streak.checked = streakItems0.length;
  for (const item of streakItems0) {
    const reason = structuralPreScreen(item, 'streak');
    if (reason) {
      summary.streak.removed.push({ code: item?.code != null ? String(item.code) : null, name: item?.name ?? null, reason, kind: 'structural' });
      structuralRemoved.streak++;
    } else preScreenedStreak.push(item);
  }
  if (!intraday || !intraday.pools || intraday.tradeDate !== report.date) {
    // 快照缺席/非当日：结构预筛的剔除**仍应用**（结构违背与快照无关）；
    //   时点核验（量比/主力/掉底座/连板身份现值）跳过——note 如实披露。
    summary.note = `复核快照缺席/非当日（tradeDate ${intraday?.tradeDate ?? '无'} ≠ ${report.date}）→ 时点核验跳过；结构预筛照常执行（结构违背与快照时点无关）`;
    return {
      summary,
      patched: (structuralRemoved.trend || structuralRemoved.streak)
        ? { candidate_pool: preScreenedTrend, streak_pool: preScreenedStreak, trend_pool_mode: summary.trend_pool_mode }
        : null,
    };
  }
  // 同拍守卫（P0 收窄后语义）：**时点判据**（掉底座/量比/主力/软出带/连板身份现值）
  //   只对构建拍快照应用——跨拍（补推旧档案/dispatch 延迟重跑）时底座已换血，「掉出
  //   底座」是时点差不是违规，时点剔除会改写历史档案。正常 CI 链路恒同拍
  //   （snapshot→build→push 同 run 串行）。
  //   **结构判据不受此守卫**（2026-10-10 P0 用户指令）：涨跌停/连板身份/昨日涨停
  //   黑名单/一字与快照时点无关——跨拍、旧档（无 snapshotAtBJ）同样恒剔除并应用。
  const sameTick = sim.snapshotAtBJ != null && sim.snapshotAtBJ === intraday.capturedAtBJ;
  if (!sameTick) {
    summary.note = `快照非报告构建拍（构建 ${sim.snapshotAtBJ ?? '未记录（旧档）'} / 复核 ${intraday.capturedAtBJ ?? '无'}）→ 时点判据不剔除（防底座换血误伤档案）；结构判据照常恒剔除`;
  }
  // 数据底座（与 buildIntradayPool 同一宇宙）：screener 优先、hot 补——复核取并集最宽
  //   （行字段同构：change_pct/liangbi/main_net），任一在场即可核验。
  const rows = new Map();
  for (const r of (Array.isArray(intraday?.hot?.rows) ? intraday.hot.rows : [])) {
    if (r?.code) rows.set(String(r.code), r);
  }
  for (const r of (Array.isArray(intraday?.screener?.rows) ? intraday.screener.rows : [])) {
    if (r?.code) rows.set(String(r.code), r);
  }
  if (!rows.size) {
    summary.note = '快照 hot/screener 均缺席，时点核验无底座跳过；结构预筛照常执行（结构违背与快照无关）';
    return {
      summary,
      patched: (structuralRemoved.trend || structuralRemoved.streak)
        ? { candidate_pool: preScreenedTrend, streak_pool: preScreenedStreak, trend_pool_mode: summary.trend_pool_mode }
        : null,
    };
  }
  const ztCodes = new Set((Array.isArray(intraday.pools.zt_codes) ? intraday.pools.zt_codes : []).map(String));
  const ztLb = intraday.pools.zt_lb && typeof intraday.pools.zt_lb === 'object' ? intraday.pools.zt_lb : null;
  const prevZtCodes = Array.isArray(intraday.pools.prev_zt_codes)
    ? new Set(intraday.pools.prev_zt_codes.map(String)) : null;
  const ztDetailMap = Array.isArray(intraday.pools.zt_detail)
    ? new Map(intraday.pools.zt_detail.map((d) => [String(d?.c), d])) : null;
  const F = INTRADAY_POOL_FILTERS; // （S 已上移至预筛段——预筛/核验共用同一出处）
  // ── 趋势池（含降级后的明日观察池——标的规则同为四条件+黑名单）逐只复核 ────────
  //   结构判据（恒剔）→ 时点判据（仅同拍剔——同拍守卫只保护时点漂移）。
  const keptTrend = [];
  for (const item of preScreenedTrend) {
    const code = item?.code != null ? String(item.code) : null;
    // rem 统一入口：kind=structural 同步递增 structuralRemoved——跨拍 patched 应用
    //   条件依赖该计数（预筛段剔除同理已计入），漏计 = 跨拍结构剔除静默丢失。
    const rem = (reason, kind = 'tick') => {
      summary.trend.removed.push({ code, name: item?.name ?? null, reason, kind });
      if (kind === 'structural') structuralRemoved.trend++;
    };
    if (!code) { rem('标的无代码，不可核验', 'structural'); continue; }
    const r = rows.get(code);
    if (!r) {
      if (sameTick) rem('掉出数据底座（最新快照已无此股）');
      else keptTrend.push(item); // 跨拍掉底座 = 时点差不是违规（同拍守卫保护）
      continue;
    }
    const chg = isValidNum(r.change_pct) ? +r.change_pct : null;
    const lb = isValidNum(r.liangbi) ? +r.liangbi : null;
    const mn = isValidNum(r.main_net) ? +r.main_net : null;
    if (chg == null || lb == null || mn == null) { rem('核验字段缺失（涨幅/量比/主力净流入）'); continue; }
    // 结构判据（恒剔——涨跌停/连板身份/昨日涨停黑名单与快照时点无关）
    if (ztCodes.has(code) || chg >= 9.9) { rem(`已涨停（最新快照现 ${chg}%）——结构违背恒剔除`, 'structural'); continue; }
    if (chg <= -9.9) { rem(`跌停（最新快照现 ${chg}%）——结构违背恒剔除`, 'structural'); continue; }
    if (prevZtCodes && prevZtCodes.has(code)) { rem('昨日涨停断板股（黑名单）——结构违背恒剔除', 'structural'); continue; }
    const lbcNow = ztLb && isValidNum(ztLb[code]) ? Math.trunc(+ztLb[code]) : null;
    if (lbcNow != null && lbcNow >= S.min_lb) { rem(`最新快照涨停池连板身份（${lbcNow} 连板）——结构违背恒剔除`, 'structural'); continue; }
    if (!sameTick) { keptTrend.push(item); continue; } // 时点判据跨拍不剔（防底座换血误伤档案）
    // 时点判据（仅同拍）：盘中行情波动是正常漂移，剔除只对构建拍快照应用
    if (chg < F.chg_min || chg > F.chg_max) { rem(`涨幅出带（现 ${chg}%，带 ${F.chg_min}-${F.chg_max}%）`); continue; }
    if (lb <= F.liangbi_min) { rem(`量比不足（现 ${lb}）`); continue; }
    if (mn <= 0) { rem('主力净流入转负'); continue; }
    keptTrend.push(item);
  }
  // ── 连板池逐只复核（结构恒剔 + 时点仅同拍）──────────────────────────────────
  const keptStreak = [];
  for (const item of preScreenedStreak) {
    const code = item?.code != null ? String(item.code) : null;
    const rem = (reason, kind = 'tick') => {
      summary.streak.removed.push({ code, name: item?.name ?? null, reason, kind });
      if (kind === 'structural') structuralRemoved.streak++;
    };
    if (!code) { rem('标的无代码，不可核验', 'structural'); continue; }
    const r = rows.get(code);
    if (!r) {
      if (sameTick) rem('掉出数据底座（最新快照已无此股）');
      else keptStreak.push(item);
      continue;
    }
    // 结构判据（恒剔）
    const ztd = ztDetailMap ? ztDetailMap.get(code) : null;
    // fbt 规范化（2026-10-10 P0 修复）：历史档 fbt 数字形态（一字 092500→92500）会让
    //   字符串判据失效——padStart 统一 6 位 HHMMSS，与 ai_report.js 同款防线。
    const fbt = ztd?.fbt != null ? String(ztd.fbt).padStart(6, '0') : null;
    if (fbt && fbt <= '092500') { rem(`今日一字（fbt ${fbt} 集合竞价封死，无买入窗口）——结构违背恒剔除`, 'structural'); continue; }
    const chgNow = isValidNum(r.change_pct) ? +r.change_pct : null;
    if (chgNow != null && chgNow <= -9.9) { rem(`跌停（最新快照现 ${chgNow}%）——结构违背恒剔除`, 'structural'); continue; }
    if (!sameTick) { keptStreak.push(item); continue; }
    // 时点判据（仅同拍）
    const lbc = ztLb && isValidNum(ztLb[code]) ? Math.trunc(+ztLb[code]) : null;
    if (lbc == null || lbc < S.min_lb) { rem('连板身份消失（最新快照涨停池无此股——疑似炸板）'); continue; }
    const lb = isValidNum(r.liangbi) ? +r.liangbi : null;
    const mn = isValidNum(r.main_net) ? +r.main_net : null;
    if (lb == null || mn == null) { rem('核验字段缺失（量比/主力净流入）'); continue; }
    if (lb <= S.liangbi_min) { rem(`量比不足（现 ${lb}）`); continue; }
    if (mn <= S.main_net_min) { rem('主力净流入转负'); continue; }
    keptStreak.push(item);
  }
  // ── 降级窗复核（推送时点进窗 → trend 升 tomorrow_watch；只升不降）───────────
  const nowBJ = typeof opts.nowBJ === 'string' && opts.nowBJ
    ? opts.nowBJ
    : (typeof intraday.capturedAtBJ === 'string' ? (intraday.capturedAtBJ.split(' ')[1] ?? null) : null);
  summary.minutes_to_close = minutesToCloseBJ(nowBJ);
  if (summary.minutes_to_close != null && summary.minutes_to_close > 0 && summary.minutes_to_close < 30
    && summary.trend_pool_mode === 'trend') {
    summary.trend_pool_mode = 'tomorrow_watch';
    summary.mode_degraded = true;
  }
  return {
    summary,
    // 应用条件（P0 双层）：同拍 → 时点+结构剔除全应用（幂等，零变动时 patched 也返回，
    //   调用方按 removed 判定是否落台账）；跨拍 → 仅当结构剔除发生才应用 patched（结构
    //   违背与快照时点无关，恒应用）；纯时点剔除跨拍绝不应用（防底座换血误伤历史档案）。
    patched: (sameTick || structuralRemoved.trend || structuralRemoved.streak) ? {
      candidate_pool: keptTrend,
      streak_pool: keptStreak,
      trend_pool_mode: summary.trend_pool_mode,
    } : null,
  };
}

/**
 * 应用校验结果到报告（原地改）：池替换为校验后存活者、mode 升级、台账落档。
 * skipped（patched=null）同样落台账（applied=false + note 报因）——审计完整：
 * 「为什么这轮没校验」和「校验剔了谁」同等重要。旧档无此字段 → 渲染层自然缺席。
 * @returns {object} report（同引用，便于链式）
 */
export function applyVerification(report, result) {
  if (!report || !result?.summary) return report;
  const sim = report?.payload?.simulation_stock;
  if (sim && result.patched) {
    sim.candidate_pool = result.patched.candidate_pool;
    sim.streak_pool = result.patched.streak_pool;
    sim.trend_pool_mode = result.patched.trend_pool_mode;
    result.summary.applied = true;
  }
  report.push_verification = { ...result.summary };
  return report;
}

/**
 * 收盘口径复核（纯台账，不 throw 不拦截）：当日盘中档案 vs ztpool_history 收盘档。
 * @param {object} report 当日盘中报告档案（含 push_verification 后的池）
 * @param {Array|null} ztpoolDays ztpool_history 数组 [{date:'YYYYMMDD', pool:[{c,lbc,zbc,hybk,...}]}]
 * @param {{nowBJ?:string}} opts 复核时刻标注
 * @returns {object} caliber_review 台账（可序列化，写回档案顶层）
 */
export function closeoutReview(report, ztpoolDays, opts = {}) {
  const sim = report?.payload?.simulation_stock;
  const out = {
    reviewedAtBJ: opts.nowBJ ?? null,
    tradeDate: report?.date ?? null,
    ztpoolDate: null,
    close_emotion: null,
    emotion_at_push: sim?.live_emotion ?? null,
    pool_outcome: null,
    conflicts: [],
    note: null,
  };
  if (!sim) { out.note = '档案无 simulation_stock，无池可复核'; return out; }
  const days = Array.isArray(ztpoolDays) ? ztpoolDays : [];
  const ymd = String(report?.date ?? '').replace(/-/g, '');
  const today = days.find((d) => d && String(d.date) === ymd) ?? null;
  if (!today || !Array.isArray(today.pool) || !today.pool.length) {
    out.note = 'ztpool_history 无当日收盘档（16:00 本地任务未跑或未入库）→ 本轮跳过，下一班次补（幂等覆盖）';
    return out;
  }
  out.ztpoolDate = String(today.date);
  // 收盘情绪现算（emotion_history 可重建不入库——CI 不依赖它，与 emotion_history.mjs
  //   同一派生：ztpool 当日池 + 前一交易日池算 prev metrics）
  const prevRow = [...days].reverse().find((d) => d && String(d.date) !== ymd);
  const prevMetrics = prevRow && Array.isArray(prevRow.pool) && prevRow.pool.length
    ? computeEmotionMetrics(prevRow.pool) : null;
  const closeEmo = computeEmotion(today.pool, prevMetrics, ymd);
  if (closeEmo && closeEmo.emotion !== 'no_data') {
    out.close_emotion = { date: ymd, emotion: closeEmo.emotion, score: closeEmo.score ?? null };
  }
  // 池标的收盘结局（收盘涨停与否、几连板）——盘中口径的天然未定盘属性，结局记录非违规判定
  const byCode = new Map(today.pool.map((p) => [String(p.c), p]));
  const outcome = (items) => (Array.isArray(items) ? items.map((it) => {
    const p = byCode.get(String(it?.code ?? ''));
    return {
      code: it?.code ?? null,
      name: it?.name ?? null,
      close_limit_up: Boolean(p),
      close_lbc: p ? Math.trunc(+p.lbc || 1) : 0,
    };
  }) : []);
  out.pool_outcome = { trend: outcome(sim.candidate_pool), streak: outcome(sim.streak_pool) };
  // 连板矛盾（数据错误信号，非行情变化）：盘中宣称 N 连板 vs 收盘 lbc 差 >1——
  //   盘中→收盘正常波动是 ±1 连板（晋级/断板），差 2 以上=某一侧口径错了。
  if (Array.isArray(sim.streak_pool)) {
    for (const it of sim.streak_pool) {
      const claimed = /^(\d+)\s*连板/.exec(String(it?.selection_reason || ''));
      const p = byCode.get(String(it?.code ?? ''));
      if (claimed && p) {
        const closeLbc = Math.trunc(+p.lbc || 1);
        if (Math.abs(closeLbc - +claimed[1]) > 1) {
          out.conflicts.push({ code: it.code, name: it?.name ?? null, intraday_claim: `${claimed[1]} 连板`, close_lbc: closeLbc });
        }
      }
    }
  }
  return out;
}
