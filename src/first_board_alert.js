/**
 * 首板晋级盯盘·事件状态机（2026-11-11 用户拍板「行动用」：1 分钟轮询 + 事件驱动企微推送）。
 *
 * 快照态（pos，按行情本地算涨停价，走 limit_caliber 分板块阈值）：
 *   sealed       现价 ≥ 涨停价-0.005（已晋级 2 板）
 *   touched      未封但今日最高 ≥ 涨停价（摸过板）
 *   approaching  未触板但涨幅 ≥ approachPct（默认 7%，逼近区）
 *   none         其余
 *
 * 事件（prev→cur 转移，含当日频控 per-code）：
 *   seal     封板（*→sealed；当日已发生过 break → 语义为「回封」）
 *   break    炸板（sealed→touched/none/approaching，打板客最重要的风险信号）
 *   touch    触板未封（*→touched 首次）
 *   approach 首次进入逼近区（none→approaching，≥7%）
 * 频控（防刷屏，拍板默认）：seal ≤2 / break ≤3 / touch ≤1 / approach ≤1 每票每日；总条数 cap 60/日。
 * 纪律：只推事件，不下单、不改仓位——观察档纪律延伸到行动提醒层。
 */

export const ALERT_DEFAULTS = {
  approachPct: 7,
  caps: { seal: 2, break: 3, touch: 1, approach: 1 },
  totalCap: 60,
};

/**
 * 实时强板块判定（2026-11-11 拍板：A 涨幅≥2% + 普涨度>70%，过滤个股拉板的假强信号）。
 * @param {Array<{sector:string,chg:number,up:number,down:number}>} boardRows 实时板块排行
 * @returns {Map<string,{chg:number,breadth:number}>} 板块名 → 强度明细
 */
export const SECTOR_DEFAULTS = { minChg: 2, minBreadth: 0.7 };
export function strongSectors(boardRows, opts = {}) {
  const th = { ...SECTOR_DEFAULTS, ...opts };
  const out = new Map();
  for (const b of boardRows || []) {
    if (!b || !b.sector) continue;
    const chg = Number.isFinite(+b.chg) ? +b.chg : null;
    const up = Number.isFinite(+b.up) ? +b.up : null;
    const down = Number.isFinite(+b.down) ? +b.down : null;
    if (chg == null || up == null || down == null || up + down <= 0) continue;
    const breadth = up / (up + down);
    if (chg >= th.minChg && breadth > th.minBreadth) out.set(b.sector, { chg, breadth: +breadth.toFixed(2) });
  }
  return out;
}

/** 单票快照态。quote: {last, high, chg}（缺失字段从严：缺 high 视为不可判 touched）。 */
export function posOf(quote, limitPrice, approachPct = ALERT_DEFAULTS.approachPct) {
  const { last, high, chg } = quote;
  if (last == null || !Number.isFinite(+last) || !Number.isFinite(+limitPrice)) return null;
  if (+last >= +limitPrice - 0.005) return 'sealed';
  if (Number.isFinite(+high) && +high >= +limitPrice - 0.005) return 'touched';
  if (Number.isFinite(+chg) && +chg >= approachPct) return 'approaching';
  return 'none';
}

/**
 * 全池事件检测（纯函数）。
 * @param {object|null} prevState 上次状态 {stocks:{code:{pos,counts:{seal,break,touch,approach},brokeToday}}}
 * @param {Array<{code,name,quote:{last,high,chg},limitPrice}>} snaps 今日快照（只含行情日期=今日的票）
 * @param {object} [opts] {approachPct, caps, totalCap, notified}
 * @returns {{events:Array, state:object}} events: {code,name,kind,label}
 */
export function detectEvents(prevState, snaps, opts = {}) {
  const th = { ...ALERT_DEFAULTS, ...opts };
  const caps = { ...ALERT_DEFAULTS.caps, ...(th.caps || {}) };
  // 板块推送过滤（2026-11-11 拍板：实时强板块∪昨日主线才推企微）：
  //   状态机全池跑、pos 照常推进（不丢状态）；被过滤的事件不计数——板块后来变强，
  //   同票的**下一次转移**仍可推（挂起的旧事件不补推，实时语义）。
  const shouldPush = typeof th.pushFilter === 'function' ? th.pushFilter : () => true;
  const stocks = (prevState && prevState.stocks) || {};
  const events = [];
  const next = { stocks: {} };
  let total = (prevState && prevState.notified) || 0;
  for (const s of snaps) {
    const cur = posOf(s.quote, s.limitPrice, th.approachPct);
    if (cur == null) continue;
    const code = String(s.code);
    const prev = stocks[code] || { pos: null, counts: {}, brokeToday: 0 };
    const counts = { seal: 0, break: 0, touch: 0, approach: 0, ...(prev.counts || {}) };
    const emit = (kind, label) => {
      // 地天豁免（2026-11-11 拍板）：曾触跌停+强势修复的票是**逆板块独立行情**——
      //   板块白名单恰恰会拦掉它（板块在跌→不满足强板块口径），故豁免板块过滤。
      if (!shouldPush(s.sector) && !s.dtRebound) return;
      if (counts[kind] >= caps[kind]) return;            // per-code 频控
      if (total >= th.totalCap) return;                  // 日总额控
      counts[kind]++;
      total++;
      const dtTag = s.dtRebound ? '〔地天形态·曾触跌停逆板块修复〕' : '';
      events.push({ code, name: s.name || code, kind, label: label + dtTag, chg: s.quote.chg, sector: s.sector || null, dtRebound: !!s.dtRebound });
    };
    if (cur === 'sealed') {
      if (prev.pos !== 'sealed') {
        const isReseal = (prev.brokeToday || 0) > 0;
        emit('seal', isReseal ? `回封（第${prev.brokeToday + 1}次封板）` : '封板晋级 2 板');
      }
    } else if (prev.pos === 'sealed') {
      // sealed → 非sealed：炸板（现价已离板）
      prev.brokeToday = (prev.brokeToday || 0) + 1;
      emit('break', `炸板！昨封今摸板后回落，现涨幅 ${fmtChg(s.quote.chg)}`);
    } else if (cur === 'touched' && prev.pos !== 'touched') {
      emit('touch', `触板未封（最高摸涨停，现 ${fmtChg(s.quote.chg)}）`);
    } else if (cur === 'approaching' && (prev.pos == null || prev.pos === 'none')) {
      emit('approach', `逼近涨停（现 ${fmtChg(s.quote.chg)}，未触板）`);
    }
    next.stocks[code] = { pos: cur, counts, brokeToday: prev.brokeToday || 0 };
  }
  next.notified = total;
  return { events, state: next };
}

const fmtChg = (c) => (Number.isFinite(+c) ? (c > 0 ? '+' : '') + (+c).toFixed(1) + '%' : '—');

/** 事件合并为一条企微 text（分级别排序：break > seal > touch > approach；不超长）。 */
export function buildAlertText(events, meta = {}) {
  if (!events || !events.length) return null;
  const order = { break: 0, seal: 1, touch: 2, approach: 3 };
  const icon = { break: '💥', seal: '🔒', touch: '👆', approach: '👁' };
  const sorted = [...events].sort((a, b) => order[a.kind] - order[b.kind]);
  const lines = [`🚨【首板晋级盯盘】${meta.bj || ''}`.trim()];
  let used = lines[0].length;
  for (const e of sorted) {
    const one = `${icon[e.kind]} ${e.label.startsWith('炸板') ? '' : ''}${e.name}：${e.label}；`;
    if (used + one.length > 900) { lines.push('…（其余事件见页面）'); break; }
    lines.push(one); used += one.length;
  }
  if (meta.baseRate != null) lines.push(`基率参考：早板晋级率 ${meta.baseRate}%（基率非预测）`);
  return { text: lines.join('\n') };
}
