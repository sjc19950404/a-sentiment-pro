// ── 推送文本渲染 · 纯函数层（零 Node 依赖，2026-10-07 抽取）────────────────
//
// 从 src/ai_report_push.js 抽出：PUSH_CONSTS + renderPushText + 行内格式助手。
//   动机：Cloudflare Worker 推送代理（决议 2 的「复制 → 云端推送」）与页面
//   即时轨都要渲染推送文案，而 ai_report_push.js import 了 node:fs/crypto/path
//   ——静态依赖会整棵进 bundle。本模块**零 import**，Node/Worker/浏览器三端
//   通用；Node 侧由 ai_report_push.js re-export，既有 import 路径零改动。
//
// 渲染纪律：缺失用 — 而非 0（与报告 null 纪律一致）；四类各一版 + 通用尾注。
export const PUSH_CONSTS = {
  STATE_TTL_MS: 30 * 86400 * 1000, // 指纹记忆 30 天（对齐 scripts/alert_channel.mjs SEEN_TTL）
  STATE_CAP: 400,                  // 状态文件条目上限（防无限增长）
  MSG_CAP: 2000,                   // 企微 text ~2048 字节，留余量
  FRESH_WINDOW_MS: 15 * 60 * 1000, // --latest 新鲜度窗口：只推"本次运行刚生成"的报告
  WEBHOOK_ENV: 'OPS_WEBHOOK',      // 复用现有运维通道 secret
  // 盘前"数据截至"附注阈值（自然日）：gap>3 才附"假期无更新"。周末 gap=3 不附——
  // 每周一都带"假期"字样是周性噪音，且"数据截至 X 收盘"基础行已消歧（2026-10-07
  // 用户提议 >1 天附注，按噪音权衡定 3，一行可改；调 1 即恢复用户原提议）。
  STALE_NOTE_GAP_DAYS: 3,
};

/**
 * OPS_WEBHOOK secret 值清洗（2026-10-10 线上真实踩坑根治）。
 * 背景：secret 经管道写入时混入两个 U+FEFF（BOM），Worker fetch 报
 *   Invalid URL → 502，GitHub Actions 判校验失败。消费端（Worker
 *   push_proxy / CI ai_report_push）读 secret 一律过本函数——无论写入
 *   路径怎么污染，读到的都是干净 URL（写入侧另有 scripts/set_ops_webhook.mjs
 *   固化码位验证，双层防御）。
 * 规则：剥零宽家族（BOM/零宽空格/方向覆盖/软连字符）→ 剥首尾控制与空白；
 *   内部仍残留控制字符 = 重度污染，拒绝（静默修复会掩盖问题）；
 *   须以 https:// 开头（企微 webhook 纪律），否则 null。
 * 消费端契约：raw 为空 → 走「未配置」静默分支；raw 非空但清洗后 null →
 *   明确报「值非法」，**不得**降级为静默跳过（那是静默丢推送）。
 */
export function sanitizeWebhookUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let s = raw.replace(/[\uFEFF\u200B-\u200F\u202A-\u202E\u2060\u00AD]/g, '');
  s = s.replace(/^[\u0000-\u0020\u007F]+|[\u0000-\u0020\u007F]+$/g, '');
  if (/[\u0000-\u001F\u007F]/.test(s)) return null;
  return /^https:\/\//.test(s) ? s : null;
}

const pct = (v, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`);
const txt = (v) => (v == null ? '—' : String(v));
const overseas = (p, key) => pct((p.overseas || []).find((q) => q && q.key === key)?.chgPct);
// 估值展示：PE 优先、PB 回退、双缺 → —（fundamentals 键常驻 null 占位，
// 数据源接入后自动展示——决议 8「键常驻，不改 schema」口径）。
const valoOf = (c) => {
  const f = c?.fundamentals || {};
  if (f.pe != null) return `PE ${f.pe}x`;
  if (f.pb != null) return `PB ${f.pb}x`;
  return '—';
};
// 百分数值口径（9.99 = +9.99%）直拼——不过 pct()（那是分数口径 ×100）。
const pctRaw = (v) => v != null && Number.isFinite(+v) ? `${+v >= 0 ? '+' : ''}${+v}%` : '—';
// 候选池清单展开（2026-10-09 用户指令）：纯数字摘要升级为逐股清单，正文 Top 10。
//   字段口径：代码/名称/入选理由/盘中涨幅是 buildCandidatePool 真实字段；
//   综合得分（c.score）数据层暂无——按「缺失用 —，不造数」纪律占位，
//   接入后自动展示。排序沿用数据层既定口径（buildCandidatePool 按连板数
//   降序），渲染层不重排。
const poolBlock = (sim, o = {}) => {
  const pool = Array.isArray(sim?.candidate_pool) ? sim.candidate_pool : [];
  // 0 只显式报（2026-10-09 用户指令）：绝不静默省略候选池段、绝不凑数塞垃圾。
  //   emptyNote（2026-10-10 双池拆分）：连板池与趋势池各自的缺席话术。
  if (!pool.length) return [`${o.poolLabel ?? '候选池'} 0 只 · ${o.emptyNote ?? '今日无符合条件标的（宁缺毋假）'}`];
  const top = pool.slice(0, o.topN ?? 10); // 正文展示 Top N（默认 10；双池后盘中各 5——防 2000 字节闸截断丢整池）
  const label = o.poolLabel ?? '候选池';
  const sortLabel = o.sortLabel ?? '按连板数排序';
  // 紧凑模式（任务二盘中候选池）：口径进标题行、个股行只留代码/名称/得分/题材/
  //   入选要点/估值/盘中——10 只 CJK 展开后字符闸挡不住字节超限，行内瘦身必要。
  const compact = !!o.compact;
  // ⚠ 标题与标的必须一致（2026-10-10 用户指令）：criteria 必须逐字等于该池的实际
  //   筛选条件——连板池标题绝不出现「涨幅3-7%/未涨停」（连板池不套这两条），
  //   趋势池标题含全四条。标题冒充口径 = 推送造假。
  const criteria = o.criteria ? ` · ${o.criteria}` : '';
  const lines = [`${label} ${pool.length} 只（${sortLabel}，Top ${top.length}${criteria}）：`];
  // 封单额格式化（连板池专用，P0）：东财 fund 原值（元）→ 亿/万可读；缺席 → 段落省略
  //   （宁缺毋假，不造数）；负值原样（异常信号如实展示）。
  const fmtSeal = (v) => v == null ? null
    : v >= 1e8 ? `封单 ${(v / 1e8).toFixed(2)} 亿`
      : v >= 1e4 ? `封单 ${Math.round(v / 1e4)} 万`
        : `封单 ${Math.round(v)} 元`;
  top.forEach((c, i) => {
    const theme = Array.isArray(c?.themes) ? c.themes.filter(Boolean).join('/') : (c?.themes || null);
    const intr = c?.intraday_chg != null && Number.isFinite(+c.intraday_chg)
      ? ` · 盘中 ${pctRaw(c.intraday_chg)}` : '';
    const score = c?.score != null ? c.score : '—';
    // 连板池独立展示（P0 双池物理拆分）：梯队分（连板高度0.6+主力0.4，与趋势池量价
    //   评分物理独立）+ 封单质量（东财 fund 真实额）——趋势池条目两字段缺席自然省略。
    const streakBits = [
      c?.streak_score != null ? `梯队分 ${c.streak_score}` : null,
      fmtSeal(Number.isFinite(+c?.seal_amount) ? +c.seal_amount : null),
    ].filter(Boolean).join(' · ');
    // 数据完整度标记（2026-10-09 用户指令）：题材/估值/资金三要素清点，行尾直标——
    //   ✅ 齐全 / ⚠️ 缺X（缺啥标啥）。仅盘中候选池（任务二）携带该字段。
    const comp = c?.data_completeness;
    const mark = !comp ? '' : comp.level === 'full' ? ' · ✅' : ` · ⚠️ 缺${(comp.missing || []).join('/')}`;
    if (compact) {
      // 连板池行（streakMode）：梯队分 + 封单（与趋势池综合得分物理独立，绝不混渲染）；
      //   趋势池行：综合得分（量价/资金流口径）。
      const scoreBit = o.streakMode
        ? (c?.streak_score != null ? `梯队分 ${c.streak_score}` : '梯队分 —')
        : `得分 ${score}`;
      const sealBit = o.streakMode && Number.isFinite(+c?.seal_amount) ? ` · ${fmtSeal(+c.seal_amount)}` : '';
      lines.push(` ${i + 1}. ${txt(c?.code)} ${txt(c?.name)} · ${scoreBit} · `
        + `${theme ? `题材：${theme} · ` : ''}${c?.selection_reason || '入选理由 —'}${sealBit} · ${valoOf(c)}${intr}${mark}`);
    } else {
      lines.push(` ${i + 1}. ${txt(c?.code)} ${txt(c?.name)} · ${c?.streak_score != null ? `梯队分 ${c.streak_score}` : `得分 ${score}`} · `
        + `${theme ? `题材：${theme} · ` : ''}${c?.selection_reason ? `入选：${c.selection_reason}` : '入选理由 —'}`
        + `${c?.seal_amount != null ? ` · ${fmtSeal(+c.seal_amount)}` : ''}`
        + ` · 估值 ${valoOf(c)}${intr}`);
    }
  });
  return lines;
};
const simBlock = (p, o = {}) => {
  const sim = p.simulation_stock;
  if (!sim?.sentiment_cycle) return [];
  const sc = sim.sentiment_cycle;
  const phase = sc.phase_label ?? sc.phase;
  // 实时情绪（2026-10-10 用户指令「情绪标签不能只输出 recover/发酵期」）：盘中报告
  //   优先渲染 rolling.emotion 六状态（当日涨停池明细现算）；缺席回落昨收口径五期标签
  //   ——两行互斥不并存，读者不会把昨收标签误当今日状态。
  const le = sim.live_emotion && sim.live_emotion.emotion ? sim.live_emotion : null;
  const phaseLine = le
    ? `情绪周期(盘中实时): ${le.emotion} · 强度 ${le.score != null ? le.score : '—'}`
    : `情绪周期: ${phase}(${sc.regime_raw ?? '—'})`;
  // 收盘倒计时降级（2026-10-10 用户指令）：距收盘<30分钟 → 趋势池标签换「明日观察池」，
  //   口径行同步换降级说明——标题=语义（明日观察，不作当日买入依据），不冒充当日趋势口径。
  const degraded = sim.trend_pool_mode === 'tomorrow_watch';
  const label = degraded ? '明日观察池' : (o.poolLabel ?? '候选池');
  // 双池（2026-10-10 拆分）：盘中实时报告带连板池（streak_pool 是数组才渲染——
  //   盘后 pain 连板口径报告无此字段，行为不变）。连板池在前（情绪核心），
  //   趋势池在后；两块标题各自携带自己的筛选口径（标题与标的必须一致）。
  const streak = Array.isArray(sim.streak_pool) ? sim.streak_pool : null;
  const counts = streak
    ? `连板池 ${streak.length} · ${label} ${sim.candidate_pool?.length ?? 0} 只`
    : `${label} ${sim.candidate_pool?.length ?? 0} 只`;
  // 置信度显式标签（2026-10-10 用户指令）：三态，与 push_verification 台账同源——
  //   不发明新数据，只把已有审计结论显式化。opts.confidence 由调用方派生（intraday
  //   分支从 report.push_verification 算），缺席（盘后/旧档）则不渲染，行为不变。
  const confTag = o.confidence ? ` · 置信度 ${o.confidence}` : '';
  return [`${phaseLine} · 建议仓位: ${sim.position_suggestion ?? '—'} · ${counts}${confTag}`,
    ...(streak ? poolBlock({ candidate_pool: streak }, {
      poolLabel: '连板池', sortLabel: '按梯队分排序', compact: !!o.compact, topN: o.topN, streakMode: true,
      // 连板池口径（P0 双池物理拆分，标题=实际筛选逐字一致）：白名单 = 昨日涨停
      //   （lbc≥2 蕴含）且今日非一字（fbt>09:25）。「涨幅3-7%/未涨停」绝不出现——
      //   连板本就意味着当日涨停（10-09 实盘事故：趋势池文案套连板股，严重自相矛盾）。
      criteria: '连板≥2 · 今日非一字 · 量比>2 · 主力净流入为正',
      emptyNote: '今日无符合条件连板标的（宁缺毋假）',
    }) : []),
    ...poolBlock(sim, degraded ? {
      ...o,
      poolLabel: '明日观察池',
      criteria: '原四条件筛选·距收盘不足30分钟自动降级（明日观察，不作当日买入依据）',
    } : o)];
};
// 任务一（2026-10-09 拆分）：盘前观察清单——昨收口径只呈现事实，不含操作建议。
//   数据源物理隔离：只读昨收档（pain 连板梯队），与任务二（盘中实时候选池）互不掺和。
const watchlistBlock = (p) => {
  const w = p.watchlist;
  if (!w) return [];
  const lines = [];
  if (Array.isArray(w.ladder) && w.ladder.length) {
    lines.push(`今日观察清单（昨收口径 · ${w.ladder.length} 只，不含操作建议）：`);
    w.ladder.forEach((s, i) => {
      lines.push(` ${i + 1}. ${txt(s.code)} ${txt(s.name)} · ${s.lb != null ? `${s.lb} 连板` : '—'}`
        + ` · ${s.kept == null ? '晋级 —' : s.kept ? '晋级成功' : '晋级失败'} · 当日 ${pctRaw(s.chg)}`
        + `${s.appearances != null ? ` · 上榜 ${s.appearances} 次` : ''}`);
    });
  } else {
    lines.push('今日观察清单：昨收连板梯队缺席（数据源未就绪，不造数）');
  }
  // 最高连板/炸板率不在此渲染——case 体已有带 sim→watchlist 回退的同一行，避免重复。
  return lines;
};

/**
 * 报告 → 企微 text 消息（简版；完整 JSON/页面视图不进推送）。
 * 四类各自的行集 + 候选池清单 + 通用免责尾注（工程健康告警不进决策正文）。
 */
export function renderPushText(report) {
  const p = report?.payload || {};
  const lines = [];
  switch (report?.report_type) {
    case 'pre_market':
      lines.push(`【AI 盘前 · 今日观察清单】${report.date}`);
      { // 数据截至标注（2026-10-07 拍板）：盘前报告恒为**前一交易日收盘口径**，
        // 头部日期即数据日期，但读者易误读为"生成当日"。恒加一行点破；间隔超
        // 3 个自然日（节后首日/小长假）再附"假期无更新"——A 股休市期间情绪面
        // 数据本来就不产生，不是漏抓。间隔按自然日近似（UTC 日界，仅作标注用）。
        const dataDay = Date.parse(`${report.date}T00:00:00Z`);
        const genDay = Date.parse(report.generated_at);
        const gap = Number.isFinite(dataDay) && Number.isFinite(genDay)
          ? Math.floor((genDay - dataDay) / 86400000) : null;
        lines.push(`数据截至 ${txt(report.date)} 收盘${gap != null && gap > PUSH_CONSTS.STALE_NOTE_GAP_DAYS ? `（距生成 ${gap} 天，假期无更新）` : ''}`);
      }
      { lines.push(...watchlistBlock(p)); }
      lines.push(`前日盈亏 ${pct(p.pnl_daily)} · 累计 ${pct(p.pnl_cumulative)} · 前日净值 ${p.prev_nav != null ? p.prev_nav.toFixed(4) : '—'}`);
      lines.push(`隔夜: A50 ${overseas(p, 'a50')} · 费半 ${overseas(p, 'sox')} · 净敞口分歧 ${txt(p.overnight_exposure?.posGap)}`);
      { // S3-5 外围收盘全景（overnight_exposure 扩展段，聚合一行不逐条罗列）：
        // 任一在场才推（数据源挂/老档无此段 → 整行省略，不留一排 — 的噪音行）。
        const oe = p.overnight_exposure || {};
        const us = oe.us_close || {}, cn = oe.cn_overnight || {};
        if ([us.dji, us.spx, us.ixic, cn.hxc, cn.fxi, oe.cnh_chgPct].some((v) => v != null)) {
          lines.push(`外围收盘: 道 ${pct(us.dji)} · 标普 ${pct(us.spx)} · 纳指 ${pct(us.ixic)}`
            + ` · 金龙 ${pct(cn.hxc)} · FXI ${pct(cn.fxi)} · 离岸人民币 ${pct(oe.cnh_chgPct)}`);
        }
      }
      lines.push(`最高连板 ${txt(p.simulation_stock?.sentiment_cycle?.highest_chain ?? p.watchlist?.max_lb)} · 炸板率 ${pct(p.simulation_stock?.sentiment_cycle?.broken_limit_ratio ?? p.watchlist?.broken_limit_ratio)}`);
      break;
    case 'intraday':
      lines.push(`【AI 盘中 · 候选池】${report.date}${report.trigger !== 'schedule' ? ` · ${report.trigger}` : ''}`);
      { // 双池推送（P0 双池物理拆分）：连板池白名单（昨日涨停+今日非一字）独立评分
        //   独立模板；趋势池黑名单（滤昨日涨停/今日涨停/一字板）保留四条件描述——
        //   标题=标的一票一致，标题冒充口径 = 推送造假（10-09 实盘事故教训）。
        //   topN=5 ×2 池（2000 字节闸整行回退会砍池尾行，各收 5 防假象）。
        // 置信度（P0 收紧）：结构剔除恒发生（快照无关）——applied 且剔除发生 →
        //   「⛔结构违背剔除 N 只」；applied 零剔除 → 高；有台账未应用（时点核验
        //   跳过且无结构问题）→ 低；无台账（未经校验链）→ 不渲染（不冒充已校验）。
        const pvConf = report.push_verification;
        const rmAll = pvConf ? [...(pvConf.trend?.removed || []), ...(pvConf.streak?.removed || [])] : [];
        const confidence = pvConf?.applied
          ? (rmAll.length ? `高（⛔结构/时点校验剔除 ${rmAll.length} 只后通过）` : '高（逐只核验通过）')
          : pvConf ? '低（时点核验缺席，结构预筛已过）' : null;
        lines.push(...simBlock(p, { poolLabel: '趋势池', sortLabel: '按综合得分排序', compact: true, topN: 5, criteria: '涨幅3-7% · 量比>2 · 未涨停未一字 · 主力净流入为正（已滤昨日涨停）', confidence }));
      }
      { // 推送前校验台账（P0）：结构违背（⛔）与时点漂移（⚠）分标；有剔除或降级才渲染。
        //   applied 不再是渲染闸——跨拍结构剔除同样 applied=true 但必须可见。
        const pv = report.push_verification;
        if (pv) {
          const rm = [...(pv.trend?.removed || []), ...(pv.streak?.removed || [])];
          const bits = [];
          if (rm.length) {
            const structN = rm.filter((x) => x?.kind === 'structural').length;
            const head = structN ? `⛔ 结构违背剔除 ${structN} 只` + (rm.length > structN ? `（另时点剔除 ${rm.length - structN} 只）` : '') : `⚠ 时点剔除 ${rm.length} 只`;
            bits.push(`${head}（${rm.slice(0, 3).map((x) => `${x.code ?? '?'} ${x.reason}`).join(' · ')}${rm.length > 3 ? ' 等' : ''}）`);
          }
          if (pv.mode_degraded) bits.push(`趋势池→明日观察池（距收盘 ${pv.minutes_to_close ?? '—'} 分钟）`);
          if (bits.length) lines.push(`推送前校验（快照 ${pv.snapshotAtBJ ?? '—'}）：${bits.join('；')}`);
        }
      }
      lines.push(`运行回撤 ${pct(p.drawdown_vs_threshold?.dd_now)} · 距 DD 档位 ${p.drawdown_vs_threshold?.distance_pp != null ? `${p.drawdown_vs_threshold.distance_pp}pp` : '—'}（${p.drawdown_vs_threshold?.basis ?? '—'}）`);
      lines.push(`昨收口径: 当日 ${pct(p.pnl_daily)} · 累计 ${pct(p.pnl_cumulative)} · A50 ${overseas(p, 'a50')}`);
      break;
    case 'post_market':
      lines.push(`【AI 报告 · 盘后】${report.date}`);
      lines.push(`当日盈亏 ${pct(p.pnl_daily)} · 累计 ${pct(p.pnl_cumulative)} · 收盘回撤 ${pct(p.close_drawdown)}`);
      if (p.market_context) lines.push(`市场: 涨跌 ${txt(p.market_context.up_down)} · 涨停/跌停 ${txt(p.market_context.zt_dt)} · 亏钱效应 ${txt(p.market_context.pain)}`);
      if (p.backtest_deviation) lines.push(`vs 回测 v52: delta ${pct(p.backtest_deviation.delta)}`);
      { lines.push(...simBlock(p)); }
      break;
    case 'weekly':
      lines.push(`【AI 报告 · 周报】截至 ${report.date}`);
      lines.push(`周收益 ${pct(p.week_return)} · 周最大回撤 ${pct(p.max_drawdown_week)} · 盈利日占比 ${pct(p.profit_trade_ratio)}`);
      lines.push(`趋势切换 ${txt(p.trend_switch_hits)} 次 · 胜率 ${p.win_rate != null ? pct(p.win_rate) : '—（剧本口径，绑定缺席则 null）'}`);
      if (p.trend_switch_effect?.shadow_note) lines.push(p.trend_switch_effect.shadow_note);
      break;
    default:
      lines.push(`【AI 报告 · ${txt(report?.report_type)}】${txt(report?.date)}`);
  }
  // MA20 降级红警（2026-10-08 推送前校验 ①）：量能因子走中性 50 → 推送里显式
  //   标红，一眼识别「降级版」（当日成交额缺或量能历史不足；判据唯一出处
  //   ai_report.js envelope 的 ma20_degraded）。企微 text 消息不支持
  //   markdown <font color>，用 🔴 emoji 替代；文案短促不挤占 MSG_CAP。
  if (p.ma20_degraded) lines.push('🔴 MA20 降级版：量能因子按中性 50 计（当日成交额缺或量能历史不足）');
  // 工程健康告警（缺失披露数/数据状态）已移出决策正文（2026-10-09 用户指令：
  // 运行监控归工程通道，不进面向决策的推送文案）；免责声明尾行保留。
  lines.push('完整版见页面 · 不构成投资建议');
  let text = lines.join('\n');
  // 双闸截断（2026-10-09 候选池展开后实测可超）：企微 text 实测上限 2048 字节（utf-8，
  //   服务端超限截断会丢尾部免责声明）。字符闸（MSG_CAP）保底；字节闸按**整行**回退
  //   ——从尾部删整行直到含标注 ≤ 2000 字节，绝不半行腰斩、绝不丢免责尾行语义。
  const BYTE_CAP = 2000;
  // 跨端字节长度：TextEncoder 是 Web 标准（Node ≥11 / Workers / 浏览器全局原生），
  //   原 Buffer.byteLength 仅 Node 可用——本模块承诺零 Node 依赖三端同构，
  //   2026-10-09 Workers 线上首跑即 ReferenceError 实测踩坑。
  const utf8Len = (s) => new TextEncoder().encode(s).length;
  if (utf8Len(text) > BYTE_CAP) {
    const suffix = '\n…（超长截断）';
    const parts = text.split('\n');
    const kept = [];
    for (const ln of parts) {
      if (utf8Len([...kept, ln].join('\n') + suffix) > BYTE_CAP) break;
      kept.push(ln);
    }
    text = (kept.length ? kept.join('\n') : parts[0].slice(0, 600)) + suffix;
  } else if (text.length > PUSH_CONSTS.MSG_CAP) {
    text = `${text.slice(0, PUSH_CONSTS.MSG_CAP - 20)}\n…（超长截断）`;
  }
  return text;
}
