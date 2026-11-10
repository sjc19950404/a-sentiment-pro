/**
 * 跌停反包监控·状态机（2026-11-11 用户拍板 B：昨日跌停池 → 今日反包进程）。
 *
 * 与首板晋级盯盘（first_board_alert）的分工：那边盯「昨日涨停谁再晋级」，这边盯
 *   「昨日跌停谁反包」——地天板的中段与后段（脱离跌停→翻红→封板）。
 *
 * 快照态（本地算跌停价/涨停价，幅度与 limit_caliber 同构对称：主板±10/创科±20/ST±5/北证±30）：
 *   dt          现价 ≤ 跌停价+0.005（还封死在跌停）
 *   sealed      现价 ≥ 涨停价-0.005（反包完成 = 地天板）
 *   red         翻红（涨幅 > 0）
 *   lifted      脱离跌停但未翻红（跌停 < 现价 < 昨收）
 *
 * 事件（prev→cur，频控各 1 次/票/日、dtBreak 2 次；**无板块过滤**——反包本就是逆板块独立
 *   行情信号，用户拍板 B 的目的就是抓它，板块白名单在这里没有意义）：
 *   lift      首次脱离跌停（dt→其他）
 *   red       首次翻红（→red）
 *   seal      反包封板 = 地天板达成（→sealed，从跌停到涨停全链）
 *   dtBreak   地天炸板（sealed→非sealed，重要风险信号）
 */

export const DT_DEFAULTS = {
  caps: { lift: 1, red: 1, seal: 1, dtBreak: 2 },
  totalCap: 40,
};

/** 单票快照态（quote:{last,chg}，dtPrice/limitPrice 由调用方本地算好传入）。 */
export function posOf(quote, dtPrice, limitPrice) {
  const { last } = quote;
  if (last == null || !Number.isFinite(+last) || !Number.isFinite(+dtPrice) || !Number.isFinite(+limitPrice)) return null;
  if (+last <= +dtPrice + 0.005) return 'dt';
  if (+last >= +limitPrice - 0.005) return 'sealed';
  return Number.isFinite(+quote.chg) && +quote.chg > 0 ? 'red' : 'lifted';
}

/**
 * 全池事件检测（纯函数；prev 形态 {stocks:{code:{pos,counts}}}）。
 * @param {Array<{code,name,quote,dtPrice,limitPrice}>} snaps
 * @returns {{events, state}}
 */
export function detectEvents(prevState, snaps, opts = {}) {
  const th = { ...DT_DEFAULTS, ...opts };
  const caps = { ...DT_DEFAULTS.caps, ...(th.caps || {}) };
  const stocks = (prevState && prevState.stocks) || {};
  const events = [];
  const next = { stocks: {} };
  let total = (prevState && prevState.notified) || 0;
  for (const s of snaps) {
    const cur = posOf(s.quote, s.dtPrice, s.limitPrice);
    if (cur == null) continue;
    const code = String(s.code);
    const prev = stocks[code] || { pos: null, counts: {} };
    const counts = { lift: 0, red: 0, seal: 0, dtBreak: 0, ...(prev.counts || {}) };
    const emit = (kind, label) => {
      if (counts[kind] >= caps[kind]) return;
      if (total >= th.totalCap) return;
      counts[kind]++;
      total++;
      events.push({ code, name: s.name || code, kind, label, chg: s.quote.chg });
    };
    if (prev.pos === 'dt' && cur !== 'dt') emit('lift', '脱离跌停（昨日跌停今日拉起）');
    if (cur === 'red' && prev.pos !== 'red' && prev.pos !== 'sealed') emit('red', '翻红（现价越过昨收）');
    if (cur === 'sealed' && prev.pos !== 'sealed') emit('seal', '反包封板——地天板达成（跌停→涨停全链）');
    if (prev.pos === 'sealed' && cur !== 'sealed') emit('dtBreak', `地天炸板！现 ${fmtChg(s.quote.chg)}`);
    next.stocks[code] = { pos: cur, counts };
  }
  next.notified = total;
  return { events, state: next };
}

const fmtChg = (c) => (Number.isFinite(+c) ? (c > 0 ? '+' : '') + (+c).toFixed(1) + '%' : '—');

/** 事件合并报文（seal/dtBreak 排最前）。 */
export function buildAlertText(events, meta = {}) {
  if (!events || !events.length) return null;
  const order = { seal: 0, dtBreak: 1, lift: 2, red: 3 };
  const icon = { seal: '🌅', dtBreak: '💥', lift: '🛗', red: '📈' };
  const sorted = [...events].sort((a, b) => order[a.kind] - order[b.kind]);
  const lines = [`💪【跌停反包盯盘】${meta.bj || ''}`.trim()];
  let used = lines[0].length;
  for (const e of sorted) {
    const one = `${icon[e.kind]} ${e.name}：${e.label}；`;
    if (used + one.length > 900) { lines.push('…（其余见日志）'); break; }
    lines.push(one); used += one.length;
  }
  return { text: lines.join('\n') };
}
