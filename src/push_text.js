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
  if (!pool.length) return [`${o.poolLabel ?? '候选池'} 0 只 · 今日无符合条件标的（宁缺毋假）`];
  const top = pool.slice(0, 10); // 正文展示 Top 10（指令口径）
  const label = o.poolLabel ?? '候选池';
  const sortLabel = o.sortLabel ?? '按连板数排序';
  // 紧凑模式（任务二盘中候选池）：口径进标题行、个股行只留代码/名称/得分/题材/
  //   入选要点/估值/盘中——10 只 CJK 展开后字符闸挡不住字节超限，行内瘦身必要。
  const compact = !!o.compact;
  const criteria = o.criteria ? ` · ${o.criteria}` : '';
  const lines = [`${label} ${pool.length} 只（${sortLabel}，Top ${top.length}${criteria}）：`];
  top.forEach((c, i) => {
    const theme = Array.isArray(c?.themes) ? c.themes.filter(Boolean).join('/') : (c?.themes || null);
    const intr = c?.intraday_chg != null && Number.isFinite(+c.intraday_chg)
      ? ` · 盘中 ${pctRaw(c.intraday_chg)}` : '';
    const score = c?.score != null ? c.score : '—';
    // 数据完整度标记（2026-10-09 用户指令）：题材/估值/资金三要素清点，行尾直标——
    //   ✅ 齐全 / ⚠️ 缺X（缺啥标啥）。仅盘中候选池（任务二）携带该字段。
    const comp = c?.data_completeness;
    const mark = !comp ? '' : comp.level === 'full' ? ' · ✅' : ` · ⚠️ 缺${(comp.missing || []).join('/')}`;
    if (compact) {
      lines.push(` ${i + 1}. ${txt(c?.code)} ${txt(c?.name)} · 得分 ${score} · `
        + `${theme ? `题材：${theme} · ` : ''}${c?.selection_reason || '入选理由 —'} · ${valoOf(c)}${intr}${mark}`);
    } else {
      lines.push(` ${i + 1}. ${txt(c?.code)} ${txt(c?.name)} · 得分 ${score} · `
        + `${theme ? `题材：${theme} · ` : ''}${c?.selection_reason ? `入选：${c.selection_reason}` : '入选理由 —'}`
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
  const label = o.poolLabel ?? '候选池';
  return [`情绪周期: ${phase}(${sc.regime_raw ?? '—'}) · 建议仓位: ${sim.position_suggestion ?? '—'} · ${label} ${sim.candidate_pool?.length ?? 0} 只`,
    ...poolBlock(sim, o)];
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
      { lines.push(...simBlock(p, { poolLabel: '盘中候选池', sortLabel: '按综合得分排序', compact: true, criteria: '涨幅3-7% · 量比>2 · 未涨停 · 主力净流入为正' })); }
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
  if (Buffer.byteLength(text, 'utf8') > BYTE_CAP) {
    const suffix = '\n…（超长截断）';
    const parts = text.split('\n');
    const kept = [];
    for (const ln of parts) {
      if (Buffer.byteLength([...kept, ln].join('\n') + suffix, 'utf8') > BYTE_CAP) break;
      kept.push(ln);
    }
    text = (kept.length ? kept.join('\n') : parts[0].slice(0, 600)) + suffix;
  } else if (text.length > PUSH_CONSTS.MSG_CAP) {
    text = `${text.slice(0, PUSH_CONSTS.MSG_CAP - 20)}\n…（超长截断）`;
  }
  return text;
}
