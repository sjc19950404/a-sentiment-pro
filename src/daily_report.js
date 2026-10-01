// 每日盘后日报生成器（#4）
//
// ── 职责边界（关键）────────────────────────────────────────────────────────
//   本模块是**纯渲染器**：输入是已经算好的素材（signals-latest.json 的各个区块），
//   输出是一份**结构化的日报数据**（分节 + 要点 + 出处）。
//   它**不重算任何指标**——情绪分来自 computeSentiment、宽度来自 breadth.js、
//   亏钱效应来自 pain.js、席位来自 seats_daily.js、标签来自 regime.js。
//   这里是唯一的"翻译层"：把数字翻译成人话，且**只翻译屏幕上已有的东西**。
//
// ── 为什么不做成 HTML 字符串 ────────────────────────────────────────────────
//   因为前端要能逐节折叠、导出、打印、被审计。返回结构化数据让前端自由渲染，
//   也便于测试（断言"第 3 节讲了什么"而不是"HTML 里有没有某个字符串"）。
//
// ── 纪律 ──────────────────────────────────────────────────────────────────
//   • **缺失显式化**：拿不到的项写 `missing: true` + 原因，**绝不编造**，
//     也不输出"0"或"平稳"这类伪装成正常的措辞。
//   • **只引用不改写**：所有读数来自入参，本模块不做任何四舍五入以外的加工
//     （round 只在显示层做，且必须标注单位）。
//   • **不构成投资建议**：措辞只描述状态与风险，不给买卖动作。

import { classifyRegime, detectDivergence, num } from './regime.js';

// 显示层舍入（唯一出处；不改动源数据）
export const DISPLAY = { pct1: 1, score1: 1 };

const f1 = (v) => { const n = num(v); return n === null ? null : Math.round(n * 10) / 10; };
const f2 = (v) => { const n = num(v); return n === null ? null : Math.round(n * 100) / 100; };
const yen = (v) => { const n = num(v); return n === null ? null : `${Math.round(n).toLocaleString('zh-CN')} 元`; };

// ── 主入口 ────────────────────────────────────────────────────────────────
//
// signals —— signals-latest.json 的内容（或其子集）
// 返回 { date, headline, tag, divergence, sections: [...], caveats: [...], sources: {...} }
//
// sections 每项：{ id, title, level: 'info'|'warn'|'ok'|'unknown', points: [...], missing: bool, missingReason }
export function buildDailyReport(signals = {}) {
  const S = signals || {};
  const latest = S.latest || {};
  const date = latest.trade_date || (S.meta && S.meta.tradeDate) || null;

  // ── ① 状态标签（regime）─────────────────────────────────────────────────
  //   封板率可能放在 latest.seal_pct 或 summary.seal_pct，两种都试（缺失即 null，不猜）。
  const sealPct = num(latest.seal_pct ?? (S.summary && S.summary.seal_pct));
  const regFull = classifyRegime({
    score: latest.value,
    pctRank: latest.pct_rank,
    history: (S.regimeSeries || []).map((x) => (x && (x.value ?? x.score))),
    breadthVerdict: S.breadth && S.breadth.verdict,
    painVerdict: S.pain && S.pain.verdict,
    seatsVerdict: S.seats && S.seats.verdict,
    sealPct,
  });

  // ── ② 背离（综合分 vs 宽度）────────────────────────────────────────────
  //   ⚠ 优先用调用方传入的 divergence 段（signals-latest 的独立段落，唯一出处
  //     src/regime.js::buildDivergenceBlock）；未传时才退回本地 detectDivergence。
  //     为什么优先用它：同一份数据在"宽度背离面板"与"日报"里必须是同一条结论，
  //     若两处各自调一次，将来改判据就会漏改一处 → 面板说背离、日报说同向。
  const div = (S.divergence && typeof S.divergence === 'object')
    ? S.divergence
    : detectDivergence({
      score: latest.value,
      pctRank: latest.pct_rank,
      breadthVerdict: S.breadth && S.breadth.verdict,
    });

  const sections = [];
  const caveats = [];

  // ── 节 1：市场状态 ──────────────────────────────────────────────────────
  sections.push(buildRegimeSection(regFull, div));

  // ── 节 2：情绪与分位 ────────────────────────────────────────────────────
  sections.push(buildSentimentSection(latest, regFull));

  // ── 节 3：涨跌与连板结构 ────────────────────────────────────────────────
  sections.push(buildBreadthSection(latest, S.breadth));

  // ── 节 4：亏钱效应 / 接力 ───────────────────────────────────────────────
  sections.push(buildPainSection(S.pain));

  // ── 节 5：资金与席位属性 ────────────────────────────────────────────────
  sections.push(buildSeatsSection(S.seats));

  // ── 节 6：题材与相对强弱 ────────────────────────────────────────────────
  sections.push(buildThemeSection(latest, S.relative));

  // ── 节 7：数据质量与告警 ────────────────────────────────────────────────
  sections.push(buildQualitySection(S));

  // 汇总 caveats（从各节与 regime 收集，集中给用户看）
  if (regFull.caution) caveats.push(regFull.caution);
  if (div.diverged) caveats.push(`${div.label}：${div.reason}`);
  // ⚠ 只把**真正的判据缺口**（拿不到数据 / 维度缺失）计入 caveats。
  //   水位双尺子读数是**已解释的建模取舍**（分位为主、绝对刻度仅交叉验证），
  //   它已经在"情绪与分位"节里如实披露，不应混进"缺口"清单——
  //   否则用户会误以为数据有问题，而实际是**尺度差异**。缺口的定义要严：
  //   "缺"指拿不到，不指"与另一把尺子读数不同"。
  (regFull.unknownReasons || [])
    .filter((r) => !/不一致.*以分位为准|退化为绝对水位/.test(r))
    .forEach((r) => caveats.push(`判据缺口：${r}`));

  const missingCount = sections.filter((s) => s.missing).length;

  return {
    date,
    // 一句话结论（供首屏大字）
    headline: buildHeadline(regFull, div, date, missingCount),
    tag: { key: regFull.key, label: regFull.label, level: regFull.level, dir: regFull.dir, confidence: regFull.confidence },
    divergence: div,
    sections,
    caveats,
    // 出处：报告里的每个数字从哪来（可追溯，配合 #40 数据血缘）
    sources: {
      regime: 'src/regime.js（本模块判据）',
      sentiment: 'src/formula_versions.js + src/sentiment.js',
      breadth: 'src/breadth.js',
      pain: 'src/pain.js',
      seats: 'src/seats_daily.js',
      relative: 'src/relative.js',
      dirty: 'src/dirty.js',
      health: 'src/health.js',
    },
    // 免责与口径声明（报告尾部固定输出）
    disclaimer: '本日报只描述市场状态与风险特征，不构成投资建议；所有读数来自当日已归档数据，缺失项一律标注"未采集/未计算"而非补 0。',
  };
}

// ── 节构造器 ──────────────────────────────────────────────────────────────

function buildRegimeSection(reg, div) {
  const pts = [];
  if (reg.key === 'unknown') {
    return {
      id: 'regime', title: '一、市场状态', level: 'unknown', missing: true,
      missingReason: (reg.unknownReasons || []).join('；') || '判据不足',
      points: ['状态标签需"水位 × 方向"两个维度，当前判据不足，不给结论（不猜）。'],
    };
  }
  pts.push({ text: reg.detail, kind: 'main' });
  (reg.evidence || []).forEach((e) => pts.push({ text: `${e.metric}：${e.reading}`, kind: 'evidence' }));
  if (reg.caution) pts.push({ text: `⚠ ${reg.caution}`, kind: 'caution' });
  return {
    id: 'regime', title: '一、市场状态',
    level: reg.caution ? 'warn' : 'info',
    missing: false, points: pts,
    tag: reg.label, confidence: reg.confidence,
    levelCheck: reg.levelCheck || null,
  };
}

function buildSentimentSection(latest, reg) {
  const v = f1(latest.value);
  const pct = f1(latest.pct_rank);
  const npct = f1(latest.net_daily_pct_rank);
  const pts = [];
  if (v === null) {
    return { id: 'sentiment', title: '二、情绪与分位', level: 'unknown', missing: true, missingReason: '情绪分未计算', points: [] };
  }
  pts.push({ text: `情绪分 ${v}${pct !== null ? `，历史分位 ${pct}%` : '（分位未计算）'}`, kind: 'main' });
  if (npct !== null) pts.push({ text: `龙虎榜净买分位 ${npct}%`, kind: 'evidence' });
  // 因子明细（有则列，缺失的显式跳过，不填 0）
  const fac = latest.factors || {};
  const facTxt = Object.entries(fac)
    .filter(([, x]) => num(x) !== null)
    .map(([k, x]) => `${k} ${f1(x)}`)
    .join(' · ');
  if (facTxt) pts.push({ text: `因子：${facTxt}`, kind: 'evidence' });
  if (latest.imputedRatio != null && num(latest.imputedRatio) > 0) {
    pts.push({ text: `代理补位比例 ${f1(latest.imputedRatio * 100)}%（该比例越高，分数越依赖代理值）`, kind: 'caution' });
  }
  if (Array.isArray(latest.missing) && latest.missing.length) {
    pts.push({ text: `缺失因子：${latest.missing.join('、')}（已走缺失通道，未填 0）`, kind: 'caution' });
  }
  if (reg.levelCheck && reg.levelCheck.agree === false) {
    pts.push({ text: `⚠ 水位判据分歧：${reg.levelCheck.note}`, kind: 'caution' });
  }
  return { id: 'sentiment', title: '二、情绪与分位', level: 'info', missing: false, points: pts };
}

function buildBreadthSection(latest, breadth) {
  const up = num(latest.up_count), down = num(latest.down_count);
  const zt = num(latest.zt_count), dt = num(latest.dt_count), zb = num(latest.zb_count);
  const seal = num(latest.seal_pct);
  const pts = [];
  const missingBits = [];
  if (up !== null && down !== null) pts.push({ text: `涨 ${up} / 跌 ${down}${up + down ? `（合计 ${up + down}）` : ''}`, kind: 'main' });
  else missingBits.push('涨跌家数');
  if (zt !== null || dt !== null) {
    pts.push({ text: `涨停 ${zt ?? '未采集'} / 跌停 ${dt ?? '未采集'}${zb !== null ? ` / 炸板 ${zb}` : ''}`, kind: 'evidence' });
  } else missingBits.push('涨停跌停');
  if (seal !== null) pts.push({ text: `封板率 ${f1(seal)}%`, kind: 'evidence' });
  const bv = breadth && breadth.verdict;
  if (bv && bv.label) pts.push({ text: `市场宽度：${bv.label}${bv.detail ? `（${bv.detail}）` : ''}`, kind: 'main' });
  else missingBits.push('市场宽度');
  // 宽度序列（近几日的趋势）
  const bs = breadth && breadth.summary;
  if (bs && bs.latest && bs.latest.maRatio != null) {
    pts.push({ text: `站上 20 日线占比 ${f1(num(bs.latest.maRatio) * 100)}%`, kind: 'evidence' });
  }
  if (!pts.length) {
    return { id: 'breadth', title: '三、涨跌与连板结构', level: 'unknown', missing: true, missingReason: '当日无涨跌/连板数据', points: [] };
  }
  return {
    id: 'breadth', title: '三、涨跌与连板结构',
    level: missingBits.length ? 'warn' : 'info',
    missing: false,
    points: pts.concat(missingBits.length ? [{ text: `未采集：${missingBits.join('、')}`, kind: 'caution' }] : []),
  };
}

function buildPainSection(pain) {
  if (!pain || !pain.verdict) {
    return { id: 'pain', title: '四、亏钱效应 / 接力', level: 'unknown', missing: true, missingReason: '需外部真实行情，未注入', points: [] };
  }
  const pts = [];
  const p = pain.perf || {}, a = pain.advance || {};
  if (pain.verdict.label) pts.push({ text: `${pain.verdict.label}：${pain.verdict.reason || ''}`, kind: 'main' });
  if (p.n) {
    pts.push({ text: `昨涨停今日均涨 ${f1(p.avg)}%、中位 ${f1(p.median)}%、翻绿比例 ${f1(num(p.lossRatio) * 100)}%`, kind: 'evidence' });
    if (p.limitUpAgain != null) pts.push({ text: `其中再涨停 ${p.limitUpAgain} 只、跌停 ${p.limitDown ?? 0} 只`, kind: 'evidence' });
  }
  if (a.n) pts.push({ text: `连板晋级：${a.kept}/${a.n} 成功（失败率 ${f1(num(a.failRate) * 100)}%）`, kind: 'evidence' });
  if (pain.bigLoss && pain.bigLoss.n) {
    const names = (pain.bigLoss.list || []).slice(0, 4).map((x) => `${x.name || x.code} ${f1(x.chg)}%`).join('、');
    pts.push({ text: `大面 ${pain.bigLoss.n} 只：${names}`, kind: 'caution' });
  }
  if (p.reliable === false) pts.push({ text: '⚠ 该项样本不足，可靠性低', kind: 'caution' });
  return { id: 'pain', title: '四、亏钱效应 / 接力', level: (pain.verdict.level === 'warn' || pain.verdict.level === 'danger') ? 'warn' : 'info', missing: false, points: pts };
}

function buildSeatsSection(seats) {
  if (!seats || !seats.verdict) {
    return { id: 'seats', title: '五、资金与席位属性', level: 'unknown', missing: true, missingReason: '席位明细仅保留最近数日，未累积到当日', points: [] };
  }
  const pts = [];
  const sm = seats.summary || {};
  if (seats.verdict.label) pts.push({ text: `${seats.verdict.label}`, kind: 'main' });
  if (seats.verdict.reason) pts.push({ text: seats.verdict.reason, kind: 'evidence' });
  const parts = [];
  if (sm.instNet && sm.instNet.last != null) parts.push(`机构 ${f1(sm.instNet.last)} 亿`);
  if (sm.northNet && sm.northNet.last != null) parts.push(`北向 ${f1(sm.northNet.last)} 亿`);
  if (sm.hotNet && sm.hotNet.last != null) parts.push(`游资 ${f1(sm.hotNet.last)} 亿`);
  if (parts.length) pts.push({ text: `当日净买：${parts.join(' / ')}`, kind: 'evidence' });
  if (sm.totalRows != null) pts.push({ text: `席位序列累计 ${sm.totalRows} 个交易日（覆盖 ${f1(num(sm.coverage || 0) * 100)}%）`, kind: 'evidence' });
  return { id: 'seats', title: '五、资金与席位属性', level: 'info', missing: false, points: pts };
}

function buildThemeSection(latest, relative) {
  const pts = [];
  const mt = latest.main_theme;
  if (mt && mt.name) {
    pts.push({ text: `主力题材「${mt.name}」净买 ${f2(mt.main_yi)} 亿，占当日龙虎榜净买 ${f1(mt.pct)}%`, kind: 'main' });
  }
  const rel = latest.industry_relative || relative;
  if (rel) {
    const vs = rel.vsIndex || rel.vsMedian;
    if (vs && vs.attack && vs.attack.length) {
      const top = vs.attack.slice(0, 4).map((x) => `${x.name} ${f1(x.change_pct)}%（超额 ${f1(x.excess)}）`).join('、');
      pts.push({ text: `进攻方向（相对${vs.baseLabel || '基准'}）：${top}`, kind: 'evidence' });
    }
    if (vs && vs.defense && vs.defense.length) {
      const bot = vs.defense.slice(0, 4).map((x) => `${x.name} ${f1(x.change_pct)}%`).join('、');
      pts.push({ text: `承压方向：${bot}`, kind: 'evidence' });
    }
    if (rel.degraded) pts.push({ text: `⚠ 相对强弱已降级：${rel.degradedReason || '行业明细不足'}`, kind: 'caution' });
  }
  if (!pts.length) {
    return { id: 'theme', title: '六、题材与相对强弱', level: 'unknown', missing: true, missingReason: '无行业明细，相对强弱未计算', points: [] };
  }
  return { id: 'theme', title: '六、题材与相对强弱', level: 'info', missing: false, points: pts };
}

function buildQualitySection(S) {
  const pts = [];
  let level = 'ok';
  const d = S.dirty;
  if (d) {
    if (d.dirtyDays > 0) { pts.push({ text: `⚠ 全档有 ${d.dirtyDays} 天存在必剔级脏数据（已从因子入参剔除，原值保留可追溯）`, kind: 'caution' }); level = 'warn'; }
    else if (d.warnDays > 0) { pts.push({ text: `全档 ${d.warnDays} 天存在需人工复核的告警项（只标记、不剔除）`, kind: 'caution' }); level = 'warn'; }
    else { pts.push({ text: `全档 ${d.totalDays} 天校验通过，无脏数据`, kind: 'ok' }); }
    if (d.recent && d.recent.length) {
      const r0 = d.recent[d.recent.length - 1];
      if (r0.issues && r0.issues.length) pts.push({ text: `最近留痕 ${r0.date}：${r0.issues.map((i) => i.reason).join('；')}`, kind: 'evidence' });
    }
  } else {
    pts.push({ text: '数据质量未评估', kind: 'unknown' });
    level = 'unknown';
  }
  if (S.health && S.health.summary) {
    // health.summary 自身可能已带「数据健康：」前缀 → 去重，避免"数据健康：数据健康：…"
    const hs = String(S.health.summary).replace(/^数据健康[：:]\s*/, '');
    pts.push({ text: `数据健康：${hs}`, kind: 'evidence' });
  }
  const xc = S.crosscheck;
  if (xc && xc.verdict) {
    pts.push({ text: `跨源互证：${xc.verdict.label || xc.verdict.level}`, kind: 'evidence' });
  } else {
    pts.push({ text: '跨源互证：未进行（缺失不等于一致）', kind: 'unknown' });
    if (level === 'ok') level = 'unknown';
  }
  const meta = S.meta || {};
  if (meta.stale) { pts.push({ text: `⚠ 数据过期：${meta.staleReason || '未说明'}`, kind: 'caution' }); level = 'warn'; }
  if (meta.freshness && meta.freshness.state && meta.freshness.state !== 'fresh') {
    pts.push({ text: `新鲜度状态：${meta.freshness.state}`, kind: 'caution' });
  }
  return { id: 'quality', title: '七、数据质量与告警', level, missing: false, points: pts };
}

// ── 首屏一句话结论 ────────────────────────────────────────────────────────
function buildHeadline(reg, div, date, missingCount) {
  const d = date ? `${date} ` : '';
  if (reg.key === 'unknown') return `${d}数据不足，无法给出市场状态判断。`;
  let s = `${d}市场状态：${reg.label}`;
  if (reg.confidence === 'low') s += '（判据不全，仅供参考）';
  if (div.diverged) s += `；${div.label}`;
  if (missingCount > 0) s += `（${missingCount} 个区块缺数据）`;
  return s;
}
