// 前端：读取 data/archive.json 并渲染（纯 vanilla，无构建步骤）
const $ = (id) => document.getElementById(id);

// ── 通用工具 ──
// 所有拼接进 innerHTML 的动态文本一律转义：题材名里含 “ ” 等全角引号、诱因里含 + & 等字符，
// 不转义会破属性或注入。
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yiOf = (wan, d = 2) => (wan == null || !Number.isFinite(+wan)) ? '—' : (Math.round(wan / 1e4 * 10 ** d) / 10 ** d).toFixed(d);
const sgnOf = (v, d = 2) => (v == null || !Number.isFinite(+v)) ? '—' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}`;
const pctOf2 = (v, d = 2) => (v == null || !Number.isFinite(+v)) ? '—' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`;
const trendCls = (v) => (v == null || !Number.isFinite(+v)) ? 'muted' : (v > 0 ? 'hl' : v < 0 ? 'hl-dn' : 'muted');
const nf = (v) => (v == null || v === '') ? '—' : (Number.isFinite(+v) ? String(v) : String(v));

// 全局状态：最新存档 / 回测档 / 个股明细表的视图与排序（搜索与排序纯前端，不改数据）
let ARC = null;
let HOT_STATE = { view: 'hot', q: '', key: null, dir: -1 };

function scoreClass(v) {
  if (v < 40) return 'low';
  if (v < 60) return 'mid';
  return 'high';
}

function renderAlerts(meta) {
  const box = $('alerts');
  box.innerHTML = '';
  // 绝对时刻 → 北京 MM-DD HH:MM（meta.freshness.publishDeadline 带 +08:00 偏移，比较与时区无关）
  const tz = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const b = new Date(d.getTime() + 8 * 3600e3).toISOString();
    return `${b.slice(5, 10)} ${b.slice(11, 16)}`;
  };
  const f = meta.freshness || {};
  const td = meta.tradeDate || f.tradeDate || '--';
  const attempt = meta.lastAttempt || {};
  const msgs = [];

  // ① 真滞后：服务端按交易日历判定「已过预期更新时刻仍落后于最近已收盘交易日」
  if (meta.stale) {
    let t = `数据滞后：${meta.staleReason || '存档交易日落后于最近已收盘交易日'}。当前展示 ${td} 收盘数据。`;
    if (attempt.reason) t += ` 最近一次抓取：${attempt.reason}。`;
    else if (meta.fallbackReason) t += ` 回退原因：${meta.fallbackReason}。`;
    msgs.push({ cls: 'alert', icon: '⚠', text: t });
  } else if (f.publishDeadline && Date.now() > Date.parse(f.publishDeadline)) {
    // ② 服务端判定「生成时未滞后」，但客户端此刻已过预期更新时刻 → 说明此后一直没更新成功
    msgs.push({ cls: 'alert', icon: '⚠', text:
      `数据尚未更新至最新交易日：当前展示 ${td} 收盘数据，预期 ${tz(f.publishDeadline)} 前更新（18:30 首抓 / 21:00 补抓）。` });
  }

  // ③ 抓取动作本身的结果——与「数据是否滞后」解耦，避免把正常等待说成抓取失败
  if (attempt.outcome === 'failed') {
    msgs.push({ cls: 'alert', icon: '⚠', text:
      `最近一次抓取失败（${attempt.reason || '未给出原因'}），已保留 ${td} 收盘数据。` });
  } else if (attempt.outcome === 'skipped') {
    msgs.push({ cls: 'alert info', icon: 'ℹ', text:
      `本次未抓取新数据：${attempt.reason || '数据源尚未发布'}；保留 ${td} 收盘数据。` });
  } else if (attempt.outcome === 'non-trading-day') {
    msgs.push({ cls: 'alert info', icon: 'ℹ', text: `${attempt.reason || '非交易日'}，保留 ${td} 收盘数据。` });
  }

  // ④ 字段级修补说明（与新鲜度正交，可同时出现）
  if (meta.note) msgs.push({ cls: 'alert info', icon: 'ℹ', text: `数据说明：${meta.note}。` });

  if (meta.source === 'offline-replay') {
    msgs.push({ cls: 'alert', icon: '⚠', text: '当前为离线演示数据，非实时行情。' });
  }
  for (const m of msgs) {
    const d = document.createElement('div');
    d.className = m.cls;
    d.textContent = `${m.icon} ${m.text}`;
    box.appendChild(d);
  }
}

function renderEmotion(latest) {
  const e = latest.emotion || {};
  const sc = e.value ?? e.score ?? null;
  if (sc == null) return;
  const el = $('emScore');
  el.textContent = sc.toFixed(1);
  el.className = 'score ' + scoreClass(sc);
  $('emPct').textContent = (e.pct_rank ?? '--');
  // 口径：当日榜（权威）。全量口径含「连续N个交易日」区间累计榜，数值是区间累计值，
  // 与日度因子/净买率不同源，故这里不取，避免首页数字与报告口径打架。
  $('emNet').textContent = e.lhb_daily_net != null ? `当日龙虎净买 ${e.lhb_daily_net} 亿` : '';
  // 仓位档位与报告 §6 / 回测引擎同源，首页一眼可见（口径见 getThresholds/posTier）
  const tier = posTier(sc, getThresholds());
  const te = $('emTier');
  if (te) te.innerHTML = tier ? `档位 <b>${esc(tier.label)}</b>` : '';

  const fac = e.factors || e; // 七因子可能直接挂在 emotion 根上
  const names = { s_net: '龙虎榜', s_pos: '涨跌家', s_brd: '行业涨', s_hot: '涨停', s_zdt: '涨跌停', s_zbl: '封板', s_amt: '量能' };
  const hints = {
    s_net: '龙虎榜净额强度', s_pos: '涨跌家数对比', s_brd: '板块红盘占比', s_hot: '涨停强度',
    s_zdt: '涨停与跌停对比', s_zbl: '封板质量（反炸板）', s_amt: '两市量能',
  };
  const wrap = $('factors');
  wrap.innerHTML = '';
  for (const [k, label] of Object.entries(names)) {
    const v = fac[k];
    if (v == null) continue;
    const row = document.createElement('div');
    row.className = 'factor';
    row.title = `${label}（${hints[k] || ''}）：原始因子分 ${v}／100，越高越强`;
    row.innerHTML = `<span class="label">${label}</span><span class="bar"><i style="width:${v}%"></i></span><span class="val">${v}</span>`;
    wrap.appendChild(row);
  }
}

function chips(list, attr) {
  const wrap = $(attr);
  wrap.innerHTML = '';
  const arr = (list || []).map((t) => (typeof t === 'string' ? t : (t.theme || t.name || ''))).filter(Boolean);
  if (!arr.length) { wrap.innerHTML = '<span class="empty">无</span>'; return; }
  for (const label of arr) {
    const c = document.createElement('span');
    c.className = 'chip click';
    c.textContent = label;
    c.dataset.act = 'theme';
    c.dataset.theme = label;
    c.tabIndex = 0;
    c.title = `查看题材「${label}」的成分股与强度`;
    wrap.appendChild(c);
  }
}

function renderMomentum(mom) {
  $('freshN').textContent = (mom.fresh || []).length;
  $('fadeN').textContent = (mom.fading || []).length;
  $('contN').textContent = (mom.continuing || []).length;
  chips(mom.fresh, 'freshList');
  chips(mom.fading, 'fadeList');
  chips(mom.continuing, 'contList');
}

function renderTrend(days) {
  const svg = $('trendSvg');
  // 保留原始索引 i，供「点数据点 → 当日盘面详情」定位到 all_days
  const pts = days.map((d, i) => ({ i, v: d.emotion?.value ?? d.emotion?.score ?? null, date: d.trade_date }));
  const win = pts.slice(-15).filter((x) => x.v != null);
  const tip = $('trendTip');
  if (!win.length) { svg.innerHTML = ''; if (tip) tip.textContent = '情绪序列不足，暂无法绘制'; return; }
  const W = 300, H = 90, pad = 10;
  const vals = win.map((x) => x.v);
  const min = Math.max(0, Math.min(...vals) - 8), max = Math.min(100, Math.max(...vals) + 8);
  const x = (i) => pad + (i * (W - 2 * pad)) / (win.length - 1 || 1);
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const line = win.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  // 参考线：引擎阈值（过热/满仓/半仓/清仓），让走势与档位有对照
  const th = getThresholds();
  const guides = [th.overheat, th.lo, th.panic].map((g) => {
    const yy = y(g).toFixed(1);
    return `<line x1="0" y1="${yy}" x2="${W}" y2="${yy}" style="stroke-dasharray:3 3;opacity:.5"></line>`;
  }).join('');
  const dots = win.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6" `
    + `data-act="day" data-i="${p.i}" tabindex="0" style="cursor:pointer" `
    + `aria-label="${esc(p.date)} 情绪分 ${p.v}"><title>${esc(p.date)} 情绪 ${p.v}</title></circle>`).join('');
  svg.innerHTML = guides + `<polyline points="${line}"></polyline>` + dots;
  const lastP = win[win.length - 1];
  if (tip) {
    tip.innerHTML = `共 ${win.length} 个交易日 · 区间 ${vals.length ? Math.min(...vals).toFixed(1) : '—'}~${Math.max(...vals).toFixed(1)}`
      + ` · 参考线为引擎档位 ${th.overheat}/${th.lo}/${th.panic}（过热/满仓/半仓）`
      + ` · 最新 ${esc(lastP.date)} ${lastP.v}`;
  }
}

function renderThemes(latest) {
  const wrap = $('themeBars');
  wrap.innerHTML = '';
  const themes = latest.themes || {};
  const entries = Object.entries(themes).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const max = entries.length ? entries[0][1] : 1;
  const total = Object.values(themes).reduce((a, b) => a + b, 0) || 1;
  if (!entries.length) { wrap.innerHTML = '<div class="empty">当日无题材数据</div>'; return; }
  for (const [name, cnt] of entries) {
    const row = document.createElement('div');
    row.className = 'tb click';
    row.dataset.act = 'theme';
    row.dataset.theme = name;
    row.tabIndex = 0;
    row.title = `点击查看「${name}」成分股（当日涨停 ${cnt} 只，占全题材涨停 ${(cnt / total * 100).toFixed(1)}%）`;
    row.innerHTML = `<span class="name">${esc(name)}</span><span class="bar"><i style="width:${(cnt / max) * 100}%"></i></span><span class="cnt">${cnt}</span>`;
    wrap.appendChild(row);
  }
}

// ── 个股明细表：双视图（强势股归因 / 龙虎榜资金）+ 搜索 + 点列头排序 + 行点击详情 ──
// 涨幅单元格：数值 + 新股标记 + 无行情标记。
// 「无行情」与「0」必须区分开：0 是真实行情（如一字板当日换手可为 0），
// 无行情是数据源没覆盖到这条代码，两者含义完全不同，混在一起会让人以为数据出错。
function chgCell(r) {
  return `<span class="${trendCls(r.change_pct)}">${pctOf2(r.change_pct)}</span>`
    + (isNewStock(r) ? '<span class="newb" title="无价格涨跌幅限制（新股/次新），涨幅与普通个股不可比">新股</span>' : '')
    + (r.close == null ? '<span class="newb nob" title="该代码段暂无行情源覆盖，现价 / 涨跌幅 / 换手为空值（不是 0）">无行情</span>' : '');
}

// 列定义：raw 供排序（数值），cell 供显示（缺省用原值），hint 是表头说明。
const HOT_COLS = {
  hot: [
    { key: 'code', t: '代码' },
    { key: 'name', t: '名称' },
    { key: 'change_pct', t: '涨幅', num: true, hint: '当日涨跌幅（新股无涨跌幅限制，涨幅不具可比性）',
      cell: chgCell,
      raw: (r) => r.change_pct },
    { key: 'close', t: '现价', num: true, hint: '收盘价（元）', raw: (r) => r.close },
    { key: 'huanshou', t: '换手%', num: true, hint: '当日换手率', raw: (r) => r.huanshou },
    { key: 'lb', t: '连板', num: true, hint: '连续涨停板数（来自当日涨停梯队）', cell: (r) => (r.lb == null ? '—' : `${r.lb}板`), raw: (r) => r.lb ?? 0 },
    { key: 'seat', t: '席位', num: true, hint: '东财买卖榜买方席位明细条数', raw: (r) => r.seat ?? 0 },
    { key: 'reason', t: '诱因（点击行看详情）', wide: true, hint: '东财榜单给出的上涨诱因' },
  ],
  lhb: [
    { key: 'code', t: '代码' },
    { key: 'name', t: '名称' },
    { key: 'change_pct', t: '涨幅', num: true, hint: '当日涨跌幅（新股无涨跌幅限制，涨幅不具可比性）',
      cell: chgCell,
      raw: (r) => r.change_pct },
    // 「区间」标记：该笔来自「连续N个交易日」区间累计榜，数值是区间累计值而非当日，
    // 与同列的当日值不可直接比较（把两类混读正是 511 亿事件的起点），故在此显式区分。
    { key: 'net_buy_wan', t: '龙虎净买(亿)', num: true,
      hint: '当日龙虎净买入额（买−卖）；带「区间」标记的来自连续N个交易日累计榜，是区间累计值，不可与当日值直接比较',
      cell: (r) => `<span class="${trendCls(r.net_buy_wan)}">${yiOf(r.net_buy_wan)}</span>${r.caliber === 'range' ? '<span class="rngb" title="来自「连续N个交易日」区间累计榜：数值为区间累计值（非当日），不可与当日值直接比较，也不计入当日榜净买率">区间</span>' : ''}`,
      raw: (r) => r.net_buy_wan },
    // 数据源字段单位是「万元」（sources.js: BILLBOARD_*_AMT / 1e4），表头写的是「亿」，
    // 必须过 yiOf 换算；否则 5.61 亿的买入额会被显示成 56133.2（差 1e4 倍）。
    { key: 'buy_wan', t: '买入(亿)', num: true, hint: '龙虎榜买方合计', cell: (r) => yiOf(r.buy_wan), raw: (r) => r.buy_wan },
    { key: 'sell_wan', t: '卖出(亿)', num: true, hint: '龙虎榜卖方合计', cell: (r) => yiOf(r.sell_wan), raw: (r) => r.sell_wan },
    { key: 'turnover_pct', t: '换手%', num: true, raw: (r) => r.turnover_pct },
    { key: 'lb', t: '连板', num: true, cell: (r) => (r.lb == null ? '—' : `${r.lb}板`), raw: (r) => r.lb ?? 0 },
    { key: 'seat', t: '席位', num: true, raw: (r) => r.seat ?? 0 },
    { key: 'reason', t: '诱因（点击行看详情）', wide: true },
  ],
};

// 卡片视图（窄屏用）：与表格共用同一份 rows / cols，字段顺序即卡片结构 ——
// 前两列（代码/名称）作标题行，第 3 列（涨幅）作右侧大字，末列（wide · 诱因）作说明行，其余列作标签行。
// 这样切换视图（强势股/龙虎榜）、搜索、排序都不必另写一套逻辑，卡片自动跟随。
function hotCardHTML(r, cols) {
  const [c0, c1] = cols;
  const big = cols[2];
  const tags = cols.slice(3, cols.length - 1);
  const last = cols[cols.length - 1];
  const cellOf = (c) => (c ? (c.cell ? c.cell(r) : esc(nf(c.raw ? c.raw(r) : r[c.key]))) : '');
  const name = r[c1?.key] ?? r.code;
  const reason = last ? String(r[last.key] ?? '').trim() : '';
  return `<div class="hcard" data-act="stock" data-code="${esc(r.code)}" tabindex="0" role="button"`
    + ` aria-label="查看 ${esc(name)} 的席位与资金详情" title="点击查看 ${esc(name)} 的席位与资金详情">`
    + `<div class="hc-head"><span class="hc-name">${esc(name)}</span>`
    + `<span class="hc-code muted">${esc(r[c0?.key] ?? r.code)}</span>`
    + `<span class="hc-big ${big ? trendCls(big.raw ? big.raw(r) : r[big.key]) : 'muted'}">${cellOf(big)}</span></div>`
    + `<div class="hc-tags">${tags.map((c) => `<span class="hc-tag"><i>${esc(c.t)}</i>${cellOf(c)}</span>`).join('')}</div>`
    + (reason ? `<div class="hc-reason">${esc(reason)}</div>` : '')
    + '</div>';
}

function hotRows() {
  const days = ARC?.all_days || [];
  const last = days[days.length - 1] || {};
  const ztLb = last.summary?.zt_lb || {};
  const detail = last.summary?.seats?.detail || {};
  const base = HOT_STATE.view === 'lhb' ? (last.lhb_aggr || last.lhb || []) : (last.hot || []);
  return base.map((r) => ({
    ...r,
    lb: ztLb[r.code] ?? null,
    seat: detail[r.code]?.length ?? null,
    net_buy_wan: r.net_buy_wan ?? null,
  }));
}

function renderHotTable() {
  const cols = HOT_COLS[HOT_STATE.view] || HOT_COLS.hot;
  const all = hotRows();
  const q = HOT_STATE.q.trim().toLowerCase();
  let rows = q
    ? all.filter((r) => [r.code, r.name, r.reason, r.close].some((x) => String(x ?? '').toLowerCase().includes(q)))
    : all;

  // 排序：显式点列头优先；未点过时用视图默认（强势股按涨幅、资金榜按净买额降序）
  const key = HOT_STATE.key || (HOT_STATE.view === 'lhb' ? 'net_buy_wan' : 'change_pct');
  const col = cols.find((c) => c.key === key);
  // 取值必须「按列」进行：此前这里闭包捕获了当前排序列 col，导致所有无 cell 的列
  // 都渲染成排序列的值（截图核对时发现：按涨幅排序时，代码/现价/换手列全是 20.01）。
  const rawOf = (c, r) => (c && c.raw ? c.raw(r) : c ? r[c.key] : r[key]);
  rows = rows.slice().sort((a, b) => {
    const x = rawOf(col, a), y = rawOf(col, b);
    const xs = (x == null || !Number.isFinite(+x)) ? -Infinity : +x;
    const ys = (y == null || !Number.isFinite(+y)) ? -Infinity : +y;
    if (xs === ys) return 0;
    return (xs < ys ? 1 : -1) * (HOT_STATE.dir < 0 ? 1 : -1);
  });

  $('hotHead').innerHTML = cols.map((c) => {
    const on = key === c.key;
    return `<th class="sortable${c.num ? ' num' : ''}" data-sort="${c.key}" title="${esc(c.hint || '点击按此列排序')}">`
      + `${esc(c.t)}${on ? `<span class="dir">${HOT_STATE.dir < 0 ? '▼' : '▲'}</span>` : ''}</th>`;
  }).join('');

  // 窄屏排序控件与表头同步（同一 HOT_STATE，两处都可改）。
  // 只在「列集合」变化时重建选项，避免每次渲染重置元素、打断用户正在操作的下拉框。
  const sel = $('hotSortSel');
  if (sel) {
    const wantKeys = cols.map((c) => c.key).join(',');
    if (sel.dataset.keys !== wantKeys) {
      sel.innerHTML = cols.map((c) => `<option value="${esc(c.key)}">`
        + `按${esc(String(c.t).replace(/（[^）]*）/g, ''))}排序</option>`).join('');
      sel.dataset.keys = wantKeys;
    }
    sel.value = key;
  }
  const dirBtn = $('hotSortDir');
  if (dirBtn) {
    const arrow = HOT_STATE.dir < 0 ? '▼' : '▲';
    if (dirBtn.textContent !== arrow) dirBtn.textContent = arrow;
    dirBtn.title = HOT_STATE.dir < 0 ? '当前降序，点击改升序' : '当前升序，点击改降序';
  }

  const tb = $('hotTable').querySelector('tbody');
  tb.innerHTML = '';
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="${cols.length}" class="empty">没有匹配的个股，试试清空搜索框</td></tr>`;
  }
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.dataset.act = 'stock';
    tr.dataset.code = r.code;
    tr.tabIndex = 0;
    tr.title = `点击查看 ${r.name || r.code} 的席位与资金详情`;
    tr.innerHTML = cols.map((c) => {
      const cls = `${c.num ? 'num' : ''}${c.wide ? ' muted' : ''}`.trim();
      const v = c.cell ? c.cell(r) : esc(nf(rawOf(c, r)));
      return `<td class="${cls}">${v}</td>`;
    }).join('');
    tb.appendChild(tr);
  }
  const cnt = $('hotCount');
  if (cnt) cnt.textContent = `显示 ${rows.length}/${all.length} 只${q ? '（已筛选）' : ''} · 点行或卡片看详情`;

  // 窄屏卡片列表：与上表同源同序（CSS 决定何时显示哪一个，无需监听 resize）
  const cardBox = $('hotCards');
  if (cardBox) {
    cardBox.innerHTML = rows.length
      ? rows.map((r) => hotCardHTML(r, cols)).join('')
      : '<div class="empty">没有匹配的个股，试试清空搜索框</div>';
  }
}

function setHotView(v) {
  if (!HOT_COLS[v]) return;
  HOT_STATE = { ...HOT_STATE, view: v, key: null, dir: -1 };
  const tabs = $('hotTabs');
  if (tabs) {
    for (const b of tabs.querySelectorAll('button')) {
      const on = b.dataset.view === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }
  renderHotTable();
}

// ── V5.2 报告口径：阈值单一真相源 ──
// 报告结论不再用自算的五模块分套阈值，改为引擎口径的七因子情绪分（= archive.emotion.value，
// 与「策略回测」「主线自动选股」卡、scripts/backtest.mjs 同源）——否则同一交易日会出现
// 两个相反结论（实测：主体报告 83.8 →「过热」，引擎 76.8 →「满仓持有」）。
let BT = null;      // data/backtest.json 缓存，loadBacktest 成功后赋值
let lastArc = null; // 最近一次 archive.json：BT 就绪后用它重刷报告，让阈值/主线切到引擎口径
const TH_DEFAULT = { panic: 24, hi: 44, lo: 65, overheat: 80 };
function getThresholds() {
  const t = BT && BT.params && BT.params.thresholds;
  return (t && Number.isFinite(+t.overheat)) ? t : TH_DEFAULT;
}
// 仓位档位：严格对齐 src/backtest.js positions() 的**实际行为**（注意 hi 在引擎里是保留但
// 未参与判档的参数，24~65 同属半仓）：
//   score >= overheat → 过热（已持有保留上限仓位，空仓不新建）
//   score >= lo       → 满仓（受回撤动态降仓 cap 限制）
//   score >  panic    → 半仓
//   else              → 清仓
function posTier(score, t) {
  if (score == null || !Number.isFinite(+score)) return null;
  if (score >= t.overheat) return { key: 'overheat', label: '过热 · 只减仓不新建', pos: '不新建（已持有者保留）', note: '高位过热，兑现压力大于进攻价值，勿在新高追涨' };
  if (score >= t.lo) return { key: 'hold', label: '满仓持有', pos: '满仓（上限 100%）', note: '行情强势，主线清晰，适合做主线' };
  if (score > t.panic) return { key: 'half', label: '半仓', pos: '半仓（50%）', note: '震荡分歧，结构性行情，控仓操作' };
  return { key: 'clear', label: '清仓', pos: '清仓（0%）', note: '亏钱效应扩散或情绪冰点，空仓防御' };
}

// ── 研判报告：规则引擎，全部由当档数据推导，无手写文案 ──
// 新股/独立标的：上市首5日无涨跌幅限制（东财榜单诱因原话）
const isNewStock = (l) => (l.reasons || [l.reason || '']).some((r) => String(r).includes('无价格涨跌幅限制'));

// 锁仓/新进资金口径（规格阈值：新进占比 >70% 短线脉冲 / 50~70% 中等 / <50% 锁仓偏好强）
// 当日买方席位与近2日同票买方席位比对，未重复出现=新进；样本=有席位明细的连续上榜股
function calcLockNew(days) {
  const cur = days[days.length - 1]?.summary?.seats?.detail;
  const prevs = days.slice(-3, -1).map((d) => d.summary?.seats?.detail).filter(Boolean);
  if (!cur || !prevs.length) return null;
  const hist = {};
  for (const pd of prevs) for (const [c, lst] of Object.entries(pd)) {
    if (!hist[c]) hist[c] = new Set();
    for (const [nm] of lst) hist[c].add(nm);
  }
  let nb = 0, tb = 0, used = 0;
  for (const [c, lst] of Object.entries(cur)) {
    if (!hist[c] || !hist[c].size) continue; // 无历史样本的票不计入
    used++;
    for (const [nm, buy] of lst) { tb += buy; if (!hist[c].has(nm)) nb += buy; }
  }
  if (!tb || !used) return null;
  return { n: used, pct: Math.round(nb / tb * 1000) / 10, lockYi: Math.round((tb - nb) / 1e4 * 100) / 100, win: prevs.length };
}

// ── V5 综合评分（规格：情绪25%/盈亏25%/广度20%/题材20%/主线板块内部结构10%，0~100，分数越高市场越热越强；资金面移出打分，降为辅助模块B）──
const clamp100 = (x) => Math.max(0, Math.min(100, Math.round(x)));
// 因子1 情绪定位：分值即热度（80~100高潮/60~79偏强/40~59中性/20~39偏弱/0~19冰点），历史分位极端在文字区提示，不改动分数
function scoreEmotion(v) { return v == null ? null : clamp100(Math.round(v)); }
// 盈亏效应：涨停多跌停少定基线，炸板率/高标空间/梯队饱满度微调
function scorePnl(zt, dt, zbl, mlb, lb2n) {
  if (zt == null || dt == null) return null;
  let s = (zt >= 50 && dt <= 10) ? 88 : (zt >= 30 && dt <= 20) ? 72 : 50;
  if (zbl != null) s += zbl < 10 ? 6 : zbl <= 20 ? 0 : -8;
  if (mlb != null) s += mlb >= 6 ? 5 : mlb >= 3 ? 2 : -5;
  if (lb2n != null) s += lb2n >= 15 ? 4 : lb2n >= 8 ? 0 : -5;
  return clamp100(s);
}
// 广度量能：红盘占比定基线，行业扩散/成交额环比微调
function scoreBreadth(redPct, indPct, amtChg) {
  if (redPct == null) return null;
  let s = redPct >= 65 ? 85 : redPct >= 55 ? 72 : redPct >= 45 ? 60 : 45;
  if (indPct != null) s += indPct >= 70 ? 5 : indPct >= 50 ? 0 : -6;
  if (amtChg != null) s += amtChg >= 10 ? 5 : amtChg >= -10 ? 0 : -6;
  return clamp100(s);
}
// 题材结构：聚焦vs发散定基线，主线强度/存活率微调
function scoreTheme(contN, freshN, mainZt, surv) {
  if (!contN && !freshN) return null;
  let s = 70;
  if (contN > freshN * 1.5) s += 10; else if (freshN > contN) s -= 10;
  if (mainZt != null) s += mainZt >= 6 ? 8 : mainZt >= 3 ? 0 : -8;
  if (surv) s += surv.pct >= 50 ? 5 : surv.pct >= 30 ? 0 : -8;
  return clamp100(s);
}
// 因子5 主线板块内部结构：主线涨停梯队定基线，内部红盘率/龙头强度微调，涨幅离散度大=跟风分化扣分
// （规格采集指标中"板块成交额占比/板块内涨跌家数"暂无独立数据源，用热点榜主线成分票代理，口径见备注）
function scoreMainStructure(mainTheme, hot, mainZt) {
  if (!mainTheme || !Array.isArray(hot)) return null;
  const ms = hot.filter((h) => String(h.reason || '').includes(mainTheme));
  if (!ms.length) return null;
  const n = ms.length;
  const chgs = ms.map((h) => h.change_pct || 0);
  const red = chgs.filter((c) => c > 0).length / n;
  const top = Math.max(...chgs);
  const avg = chgs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(chgs.reduce((a, c) => a + (c - avg) * (c - avg), 0) / n);
  let s = mainZt >= 6 ? 80 : mainZt >= 3 ? 62 : 45;
  if (red >= 0.7) s += 8; else if (red < 0.5) s -= 8;
  if (top >= 9.9) s += 5; else if (top >= 5) s += 2; else s -= 5;
  if (sd > 6) s -= 4; else s += 2;
  return clamp100(s);
}

function buildBrief(days, arc) {
  const d = days[days.length - 1] || {};
  const p = days[days.length - 2] || {};
  const s = d.summary || {}, ps = p.summary || {};
  const e = d.emotion || {}, pe = p.emotion || {};
  const f = e.factors || e;
  const mom = arc.signals?.momentum || {};
  const last5 = days.slice(-5);
  const seg = (h, b, sid) => `<div class="bf-sec" id="${sid}"><div class="bf-h">${h}</div><div class="bf-body">${b}</div></div>`;
  const li = (t) => `<div class="bf-li">${t}</div>`;
  const num = (v, fix = 1) => (v == null || !Number.isFinite(+v)) ? '—' : (+v).toFixed(fix);
  const arrow = (cur, pre) => (cur == null || pre == null) ? '' :
    (cur > pre ? `<span class="bf-up">↑${num(cur - pre)}</span>` : cur < pre ? `<span class="bf-dn">↓${num(pre - cur)}</span>` : '持平');

  // 数据落款（V5.2）：报告"每日随档生成"，必须说清是哪一档、数据新不新，
  // 状态口径与 src/freshness.js 三态一致（fresh / pending / behind）。
  const meta = arc.meta || {};
  const fresh = meta.freshness || {};
  const freshLabel = { fresh: '最新', pending: '待更新（未到发布时刻）', behind: '滞后' }[fresh.state]
    || (meta.stale ? '滞后' : '未判定');
  const dataDate = meta.tradeDate || d.trade_date || '—';
  const att = meta.lastAttempt || {};
  const stamp = `<div class="bf-meta">数据日期 <b>${dataDate}</b> · 抓取状态 <b>${freshLabel}</b>`
    + (fresh.behindSessions ? `（落后 ${fresh.behindSessions} 个交易日）` : '')
    + (att.outcome === 'skipped' ? ' · 本次尝试跳过（当日数据未发布，属正常等待）' : '')
    + (att.outcome === 'failed' ? ` · 本次抓取失败：${att.reason || '原因未记录'}` : '')
    + ` · 样本 ${days.length} 个交易日 · 打分模型 ${(BT && BT.meta && BT.meta.formulaVersion) || meta.formulaVersion || '—'}</div>`;

  // 1. 情绪定位
  const v = e.value, pct = e.pct_rank;
  const delta = (v != null && pe.value != null) ? (v - pe.value) : null;
  const zone = v == null ? '' :
    v < 40 ? '冰点区' : v < 55 ? '偏冷区' : v < 70 ? '中性区' : v < 85 ? '偏热区' : '狂热区';
  let zoneNote = '';
  if (v != null && pct != null) {
    if (pct <= 10) zoneNote = '历史极端低位，统计上常见修复脉冲，但缩量阴跌需防钝化';
    else if (pct <= 30) zoneNote = '历史低位区，赔率占优、胜率一般，右侧确认前不抢跑';
    else if (pct >= 90) zoneNote = '历史极端高位，兑现压力大于进攻价值';
    else if (pct >= 70) zoneNote = '历史高位区，持仓友好但追高性价比下降';
    else zoneNote = '中位震荡区，结构机会为主';
  }
  const emo5 = last5.map((x) => x.emotion?.value).filter((x) => x != null);
  let dirTxt = '';
  if (emo5.length >= 3) {
    const last3 = emo5.slice(-3);
    const upN = last3.slice(1).filter((x, i) => x > last3[i]).length;
    const rebound = delta != null && delta > 0 && emo5.length >= 3 && last3[0] > last3[1];
    dirTxt = upN === 2 ? '近3日连升' : upN === 0 ? '近3日连降' + (rebound ? '后今日强力反弹' : '') : '近3日方向反复';
  }
  const sec1 = [
    li(`情绪 <b>${num(v)}</b>（历史分位 <b>${pct == null ? '—' : pct + '%'}</b>）${delta != null ? `，较昨日 <b>${delta >= 0 ? '+' : ''}${num(delta)}</b>` : ''}，落于<b>${zone}</b>。${dirTxt}`),
    zoneNote ? li(zoneNote) : '',
    e.missing && e.missing.length ? li(`<span class="bf-warn">⚠ 因子缺失：${e.missing.join('、')}，今日分可信度降权</span>`) : '',
  ].join('');

  // 2. 资金（龙虎榜）
  // 近5日净买序列：必须与净买率同口径（当日榜）。此处原取全量口径，
  // 导致同一句话里「净买率 5.7%」是当日榜、而紧挨着的「近3日滚动净买」是全量，读者会当成同一口径。
  const nets = last5.map((x) => x.summary?.lhb_daily_net).filter((x) => x != null);
  const netTxt = nets.length ? nets.map((x) => (x > 0 ? `<span class="bf-up">+${num(x)}</span>` : `<span class="bf-dn">${num(x)}</span>`)).join(' → ') : '—';
  let netVerdict = '';
  if (nets.length >= 2) {
    const cur = nets[nets.length - 1], pre = nets[nets.length - 2];
    if (cur > 0 && pre <= 0) netVerdict = '净买 5 日来首次转正，游资回补信号';
    else if (cur < 0 && pre >= 0) netVerdict = '净买转负，短线资金撤退';
    else if (cur > 0) netVerdict = '净买连续为正，进攻意愿延续';
    else netVerdict = '净买连续为负，观望/出货氛围';
  }
  const topBuy = (d.lhb_aggr || []).filter((l) => l.net_buy_wan > 0).slice(0, 3)
    .map((l) => `${l.name} +${num(l.net_buy_wan / 1e4, 2)}亿${isNewStock(l) ? '<span class="bf-warn">（独立新股，非主线）</span>' : ''}`);
  // 体量/净买率：分子分母必须同源。东财龙虎榜原始记录混装两类榜单——当日榜（席位买卖即当日口径）
  // 与"连续N个交易日区间累计榜"（字段是区间累计值，且 BUY_AMT 被填成区间累计成交额）。
  // 两者不加区分地相加，曾把 2026-09-30 的上榜总成交算成 511 亿（当日榜去重后真实仅 136.5 亿），
  // 净买率被稀释成 2.4%，定性从"中等力度"错判成"脉冲级、可信度低"。故统一取当日榜口径。
  const curNet = nets[nets.length - 1];
  const dAmt = s.lhb_daily_amt, dNet = s.lhb_daily_net;
  const nbRate = (dAmt > 0 && dNet != null) ? dNet / dAmt * 100 : null;
  let rateTxt = '';
  if (nbRate != null) {
    const ab = Math.abs(nbRate);
    rateTxt = ab >= 8 ? '强进攻' : ab >= 4 ? '中等力度' : '脉冲级，可信度低';
  }
  // 3日滚动净额（与5日并行，抓资金转向拐点）
  const roll3Sum = nets.slice(-3).reduce((a, b) => a + b, 0);
  // 新股/独立标的识别与扰动过滤（诱因=无价格涨跌幅限制，上市5日内）
  // 口径纪律：分子（新股净买）与分母（全榜净买）必须同源，一律当日榜。
  // 原实现分子取当日榜个股、分母取含区间累计榜的全量数组（9-30：5.04 ÷ 12.11 = 42%），属口径混用；
  // 同源后为 5.04 ÷ 7.74 = 65%，「剔除新股后的主线净买」也从 7.07 亿修正为 2.70 亿。
  const aggr = d.lhb_aggr || [];
  const newStocks = aggr.filter((l) => isNewStock(l) && l.caliber !== 'range');
  const totNetDaily = s.lhb_daily_net ?? null;   // 当日榜净买（权威口径）
  const newNet = newStocks.reduce((a, l) => a + (l.net_buy_wan || 0), 0) / 1e4;
  const mainNet = totNetDaily != null ? totNetDaily - newNet : null;
  const disturb = totNetDaily != null && totNetDaily > 0 && (newNet / totNetDaily) * 100 > 25;
  // 资金-行情背离校验（有背离才写）
  const divs = [];
  if (curNet > 0 && s.amount_yi != null && ps.amount_yi != null && s.amount_yi < ps.amount_yi * 0.92) divs.push('两市缩量下净流入——资金集中抱团，扩散不足');
  if (curNet > 0 && s.up_count != null && s.down_count != null && s.up_count < s.down_count) divs.push('净流入但红盘家数占少数——指数层面承接偏弱');
  if (curNet > 0 && s.ind_up != null && s.ind_count && s.ind_up / s.ind_count < 0.4) divs.push('净流入但行业红盘不足四成——个股分化明显');
  // 席位级拆分（东财席位明细）：资金属性/买方集中度/对手盘结构
  const seats = s.seats;
  let seatLines = '';
  if (seats && seats.cover) {
    const dirTxt2 = (v) => v > 0 ? '净买 +' + num(v, 2) : v < 0 ? '净卖 ' + num(v, 2) : '持平';
    const instN = seats.inst_buy - seats.inst_sell, northN = seats.north_buy - seats.north_sell, hotN = seats.hot_buy - seats.hot_sell;
    // 市场级买方头部3席位集中度（规格：>50% 高度集中 / 30~50% 中等 / <30% 分散）
    const b3 = seats.buy_top3_pct;
    const b3Txt = b3 != null ? `；买方头部3席位集中度 <b>${b3}%</b>（${b3 > 50 ? '高度集中——爆发力强，一日游风险高' : b3 >= 30 ? '中等' : '分散——持续性更好'}）` : '';
    const conc = (seats.conc_top || []).length ? `；个股买方前三集中度TOP: ${seats.conc_top.map((c) => `${c[0]} ${c[1]}%`).join('、')}` : '';
    const totSell = seats.hot_sell + seats.inst_sell + seats.north_sell;
    let opp = '';
    if (totSell > 0) {
      const parts = [['游资', seats.hot_sell], ['机构', seats.inst_sell], ['北向', seats.north_sell]].sort((a, b) => b[1] - a[1]);
      opp = `；对手盘: 卖方以${parts[0][0]}为主（游资 ${num(seats.hot_sell, 1)} / 机构 ${num(seats.inst_sell, 1)} / 北向 ${num(seats.north_sell, 1)} 亿）`;
      // 抛压预警（规格：机构+北向合计净卖出 >5亿 = 高抛压预警）
      const instNorthNet = instN + northN;
      if (instNorthNet < -5) opp += ` <span class="bf-warn">⚠ 机构+北向合计净卖 ${num(-instNorthNet, 2)} 亿，高抛压预警</span>`;
      else opp += `；对手盘分歧中等，无大规模机构砸盘`;
    }
    seatLines = li(`席位拆分: 机构${dirTxt2(instN)} / 北向${dirTxt2(northN)} / 游资${dirTxt2(hotN)} 亿（席位覆盖 ${seats.cover}%）${b3Txt}${conc}${opp}`);
  }
  // 锁仓/新进资金占比 + 主线题材龙虎资金占比（规格阈值）
  const lock = calcLockNew(days);
  const lockLine = lock ? li(`锁仓与资金留存（近${lock.win + 1}日连续上榜样本 ${lock.n} 只）: 锁仓金额 ${num(lock.lockYi, 2)} 亿，新进资金占当日买入 <b>${lock.pct}%</b>——${lock.pct > 70 ? '短线脉冲，兑现风险高' : lock.pct >= 50 ? '中等' : '锁仓偏好强，持续性更好'}`) : '';
  const mt = s.main_theme;
  const mtLine = (mt && mt.tot_yi > 0 && mt.pct != null) ? li(`资金-题材联动: 主线题材（${mt.name}）龙虎净买 ${mt.main_yi >= 0 ? '+' : ''}${num(mt.main_yi, 2)} 亿，占全部龙虎净买 <b>${mt.pct}%</b>——${mt.pct >= 60 ? '资金聚焦主线' : mt.pct >= 40 ? '资金分化' : '资金散乱，主线弱化'}`) : '';
  const sec2 = [
    li(`近5日当日龙虎净买（亿）: ${netTxt}`),
    dAmt > 0 ? li(`上榜总成交 ${num(dAmt, 0)} 亿（当日榜 ${nf(s.lhb_daily_stocks)} 只，净买 ${nf(s.lhb_daily_net)} 亿；分子分母同源），净买率 <b>${num(nbRate, 1)}%</b>（${rateTxt}）；近3日滚动净买 ${roll3Sum >= 0 ? '+' : ''}${num(roll3Sum)} 亿`) : '',
    s.lhb_range_count > 0 ? li(`<span class="muted">口径说明：另有 ${s.lhb_range_count} 条「连续 N 个交易日累计」榜记录，其买卖额与净额都是区间累计值（非当日），已单列——不计入上方总成交与净买率，也不计入情绪因子 s_net、近5日净额序列与新股扰动占比（全站日度口径只有「当日榜」一个来源）。</span>`) : '',
    netVerdict ? li(netVerdict + `（结构 ${s.net_pos ?? '—'} 买 / ${s.net_neg ?? '—'} 卖）`) : '',
    (newStocks.length && totNetDaily != null && totNetDaily > 0) ? li(`新股/独立标的（${newStocks.map((l) => l.name).join('、')}）净买 +${num(newNet, 2)} 亿，占当日龙虎净买 <b>${(newNet / totNetDaily * 100).toFixed(0)}%</b>${disturb ? '，<span class="bf-warn">超 25% 扰动线——主线资金强度需剔除观察</span>' : ''}；剔除后主线净买 ${mainNet >= 0 ? '+' : ''}${num(mainNet, 2)} 亿`) : '',
    newStocks.length ? li(`<span class="bf-warn">⚠ 备注：当日龙虎净买含新股${newStocks.map((l) => l.name).join('、')}，主线资金需剔除该标的单独评估，规避净额虚高误判</span>`) : '',
    topBuy.length ? li('净买头部: ' + topBuy.join('、')) : '',
    seatLines,
    lockLine,
    mtLine,
    divs.length ? li(`<span class="bf-warn">背离校验：${divs.join('；')}</span>`) : '',
  ].join('');

  // 3. 盈亏效应（涨跌停结构）——规格阈值：涨停≥50&跌停≤10强/30~49&11~20中等/<30或>20偏弱；炸板率<10优秀/10~20中等/>20弱；高标≥6板空间打开/3~5中等/≤2压制；2板以上≥15饱满/8~14一般/<8断层
  const zt = s.zt_count, dt = s.dt_count, zbl = s.zbl_pct, mlb = s.max_lb, lb2n = s.lb2_count;
  let pnl = '';
  if (zt != null && dt != null) {
    if (zt >= 50 && dt <= 10) pnl = `涨停 ${zt} / 跌停 ${dt}，赚钱效应强`;
    else if (zt >= 30 && dt <= 20) pnl = `涨停 ${zt} / 跌停 ${dt}，赚钱效应中等`;
    else pnl = `涨停 ${zt} / 跌停 ${dt}，赚钱效应偏弱`;
  }
  const sec3 = [
    pnl ? li(pnl + `（昨日 ${ps.zt_count ?? '—'}/${ps.dt_count ?? '—'}）`) : '',
    zbl != null ? li(`炸板率 ${zbl}%（炸板 ${s.zb_count ?? '—'}，封板率 ${Math.round(100 - zbl)}%），${zbl < 10 ? '封板质量优秀' : zbl <= 20 ? '封板质量中等' : '封板弱，接力意愿差'}`) : '',
    mlb != null ? li(`连板高标 ${mlb} 板${mlb >= 6 ? '，空间打开' : mlb >= 3 ? '，空间中等' : '，空间压制，情绪偏弱'}；2板以上 ${lb2n ?? '—'} 只${lb2n != null ? (lb2n >= 15 ? '，梯队饱满' : lb2n >= 8 ? '，梯队一般' : '，梯队断层') : ''}`) : '',
  ].join('');

  // 4. 广度与量能——规格阈值：红盘占比≥65普涨/55~65结构性/45~55震荡分化/<45普跌；行业红盘≥70扩散好/50~70结构性/<50抱团；环比±10%放量/平稳/缩量；量能因子≥40高/20~40中/<20低
  const up = s.up_count, dn = s.down_count, amt = s.amount_yi, pamt = ps.amount_yi;
  const redPct = (up != null && dn != null && up + dn > 0) ? up / (up + dn) * 100 : null;
  const indPct = (s.ind_count && s.ind_up != null) ? s.ind_up / s.ind_count * 100 : null;
  const amtChg = (amt != null && pamt != null && pamt > 0) ? (amt - pamt) / pamt * 100 : null;
  const sec4 = [
    redPct != null ? li(`涨跌家数 ${up} / ${dn}（沪深口径），红盘占比 ${redPct.toFixed(0)}%——${redPct >= 65 ? '普涨' : redPct >= 55 ? '结构性行情' : redPct >= 45 ? '震荡分化' : '普跌'}`) : '',
    indPct != null ? li(`行业红盘 ${s.ind_up ?? '—'}/${s.ind_count}（${indPct.toFixed(0)}%）——${indPct >= 70 ? '板块扩散良好' : indPct >= 50 ? '结构性扩散' : '抱团行情，扩散不足'}；最强 ${s.top_industry || '—'} / 最弱 ${s.bottom_industry || '—'}`) : '',
    amtChg != null ? li(`两市成交额 ${num(amt, 0)} 亿，环比 ${amtChg >= 0 ? '+' : ''}${amtChg.toFixed(1)}%${amt === pamt ? '' : `（${amt >= pamt ? '放量' : '缩量'} ${num(Math.abs(amt - pamt), 0)} 亿）`}——${amtChg >= 10 ? '放量' : amtChg <= -10 ? '缩量' : '量能平稳'}；量能因子 ${f.s_amt ?? '—'}（${f.s_amt >= 40 ? '高量能' : f.s_amt >= 20 ? '中等量能' : '低量能'}）`) : '',
  ].join('');

  // 5. 题材结构——规格阈值：主线涨停≥6强/3~5中等/<3弱化；昨日新晋存活率≥50%延续性强/30~50中等/<30一日游
  const freshN = (mom.fresh || []).length, contN = (mom.continuing || []).length, fadeN = (mom.fading || []).length;
  const th = d.themes || {};
  const topTheme = Object.entries(th).sort((a, b) => b[1] - a[1])[0];
  const mainZt = topTheme ? topTheme[1] : null;
  // 主线强度分/密集度：与引擎 selectMainLine 同式（强度分 = 涨停家数 × 密集度），
  // 让报告 §5 与「主线自动选股」卡说同一件事，而不是各报一个数。
  const themeTotal = Object.values(th).reduce((a, b) => a + b, 0) || 1;
  const mainDensity = topTheme ? topTheme[1] / themeTotal : null;
  const mainScore = topTheme ? Math.round(topTheme[1] * mainDensity * 100) / 100 : null;
  let focus = '';
  if (contN && freshN) focus = contN > freshN * 1.5 ? '延续远多于新晋——资金聚焦而非轮动，主线成色足' :
    freshN > contN ? '新晋多于延续——题材轮动发散，追首板胜率低' : '新晋延续均衡——题材消化中';
  // 昨日新晋题材存活率（题材口径）
  const surv = (() => {
    if (!p.themes) return null;
    const fr = (mom.fresh || []).map((t) => (typeof t === 'string' ? t : t.theme)).filter(Boolean);
    if (!fr.length) return null;
    const alive = fr.filter((t) => (p.themes[t] || 0) > 0);
    return { n: fr.length, alive: alive.length, pct: Math.round(alive.length / fr.length * 100) };
  })();
  const sec5 = [
    li(`新晋 ${freshN} / 延续 ${contN} / 退潮 ${fadeN}。${focus}`),
    topTheme ? li(`今日最强题材: ${topTheme[0]}（${mainZt} 只涨停）——${mainZt >= 6 ? '主线强势' : mainZt >= 3 ? '主线强度中等' : '主线弱化'}`) : '',
    (topTheme && mainDensity != null) ? li(`主线强度分 <b>${mainScore}</b>（涨停 ${mainZt} × 密集度 ${(mainDensity * 100).toFixed(1)}%，与引擎 selectMainLine 同式）——标的清单见「主线自动选股」卡`) : '',
    surv ? li(`昨日新晋题材存活 ${surv.alive}/${surv.n}（${surv.pct}%）——${surv.pct >= 50 ? '题材延续性强' : surv.pct >= 30 ? '延续性中等' : '题材一日游风险高'}`) : '',
  ].join('');

  // 6. 综合研判（规则表决）
  const ev = [];
  if (v != null && pct != null) {
    if (v >= 70 && pct >= 70) ev.push('情绪与分位双高');
    else if (v <= 35 && pct <= 30) ev.push('情绪分位双冰');
    else if (delta != null) ev.push(delta >= 0 ? '情绪修复' : '情绪走弱');
  }
  const netsC = nets;
  if (netsC.length >= 2) ev.push(netsC[netsC.length - 1] > 0 ? '龙虎榜资金进场' : '龙虎榜资金离场');
  if (zt != null && dt != null) ev.push(dt > zt ? '亏钱效应' : '赚钱效应');
  if (fadeN > freshN * 1.5) ev.push('题材退潮主导');
  else if (contN > freshN * 1.5 && freshN > 0) ev.push('主线聚焦');
  let verdict = '中性震荡，控制仓位做结构。';
  if (ev.includes('情绪与分位双高') && ev.includes('龙虎榜资金进场')) verdict = '情绪与分位双高 + 资金进场共振，但分位已处高位，追高性价比下降，持仓者让利润奔跑、空仓者等分歧低吸。';
  else if (ev.includes('情绪与分位双高')) verdict = '情绪与分位双高，兑现压力大于进攻价值，勿在新高追涨。';
  else if (ev.includes('情绪分位双冰')) verdict = ev.includes('龙虎榜资金进场') ? '冰点 + 资金试探进场，修复脉冲概率上升，轻仓试错、止损要快。' : '冰点区无资金承接，空仓等右侧，接飞刀是找死。';
  else if (ev.includes('情绪修复') && ev.includes('龙虎榜资金进场') && ev.includes('赚钱效应')) verdict = '修复三要素齐（情绪回升+资金进场+赚钱效应），可逐步转进攻，主线优先。';
  else if (ev.includes('情绪走弱') && ev.includes('龙虎榜资金离场')) verdict = '情绪资金双弱，退潮期防守为主，新题材一律当反弹看。';

  // 明日观测（规格六：九条触发规则，触发才输出，非固定列表）
  const watch = [];
  if (v != null && v >= 70) watch.push('跌停若回升超 40 则退潮未尽'); // 1.情绪偏热/狂热触发
  if (disturb) watch.push(`主线剔除新股后的净买（今日 ${mainNet >= 0 ? '+' : ''}${num(mainNet, 2)} 亿）能否守住正轴（0 亿上方）`); // 2.新股扰动触发
  if (mlb != null && mlb >= 6) watch.push(`${mlb} 板高标能否晋级（断板无替补 = 空间坍塌）`); // 3.6板及以上高标触发
  if (surv && surv.pct < 50) watch.push(`今日 ${freshN} 个新晋题材明日存活率（≥50% = 聚焦，<30% = 一日游）`); // 4.昨日存活率<50%触发
  if (nbRate != null && nbRate >= 4 && nbRate < 8) watch.push(`龙虎榜净买率是否维持在 4% 以上（今日 ${num(nbRate, 1)}%），买方集中度是否出现极端抬升`); // 5.净买率4~8%中等区间触发
  if (seats && seats.cover && (seats.inst_sell > 0 || seats.north_sell > 0)) watch.push('卖方是否出现机构/北向集中大额砸盘（合计净卖 >5 亿为预警线）'); // 6.机构/北向有卖出触发
  if (divs.some((x) => x.includes('缩量'))) watch.push('缩量背离是否修复：主线板块成交额能否扩容'); // 7.抱团缩量背离触发
  if (lock && lock.pct > 50) watch.push(`头部标的资金留存: 新进资金（今日占比 ${lock.pct}%）是否大规模兑现`); // 8.新进占比>50%触发
  if (mt && mt.pct != null && mt.pct >= 60) watch.push(`主线题材龙虎资金占比是否维持在 60% 以上（今日 ${mt.pct}%）`); // 9.主线占比≥60%触发

  // 综合风险评分（V5：五因子加权，分数越高市场越热越强；资金面降为辅助模块不参与打分）
  const scE = scoreEmotion(v);
  const scP = scorePnl(zt, dt, zbl, mlb, s.lb2_count);
  const scB = scoreBreadth(redPct, indPct, amtChg);
  const scT = scoreTheme(contN, freshN, mainZt, surv);
  const scM = scoreMainStructure(topTheme ? topTheme[0] : null, d.hot || [], mainZt);
  const mods = [['情绪定位', 25, scE], ['盈亏效应', 25, scP], ['广度量能', 20, scB], ['题材结构', 20, scT], ['主线结构', 10, scM]].filter((m) => m[2] != null);
  const wSum = mods.reduce((a, m) => a + m[1], 0);
  const total = wSum ? Math.round(mods.reduce((a, m) => a + m[1] * m[2], 0) / wSum * 10) / 10 : null;
  // V5.2：不再用 V5.0 的「极低风险/极高风险」五档措辞——它既与引擎语义相悖
  // （≥80 引擎是"过热只减不新建"，说成"极低风险"会被读成可加仓），分界值也与
  // 引擎阈值不一致（45/25 vs 44/24）。改由下方 posTier 按引擎阈值输出仓位档位。
  const weak = mods.filter((m) => m[2] < 60).map((m) => m[0]);
  const auxWarn = (disturb || divs.length) ? '；辅助资金面存在' + [disturb ? '新股扰动' : '', divs.length ? '量价背离' : ''].filter(Boolean).join('与') + '信号，热度分未计入' : '';
  const riskHint = (weak.length ? `短板在${weak.join('与')}，注意对应风险` : '五模块均衡，无明显短板') + auxWarn;
  // 主结论走引擎口径：七因子情绪分（= 页面情绪分，与回测引擎同源）套 V5.2 阈值 → 可执行的仓位档位；
  // V5.0 五模块分降级为"因子分解"，只解释分位构成，不再作为结论依据（两套分套同一阈值会给出相反结论）。
  const thr = getThresholds();
  const mainScoreV = (e.value != null && Number.isFinite(+e.value)) ? +e.value : total;
  const tier = posTier(mainScoreV, thr);
  const v52p = (BT && BT.params && BT.params.v52) || {};
  const pctOf = (x, d) => (x == null || !Number.isFinite(+x)) ? '—' : (Math.abs(+x) * 100).toFixed(d) + '%';
  const bpOf = (x, dflt) => Math.round((x == null ? dflt : +x) * 1e4 * 10) / 10; // 小数 → ‱（万分之一），抹掉浮点尾差
  const tierLine = tier ? li(`<b>仓位档位（V5.2 引擎口径）</b>：七因子情绪分 <b>${num(mainScoreV)}</b>（与页面情绪分、回测引擎同源）→ <b>${tier.label}</b>，建议仓位 <b>${tier.pos}</b>。${tier.note}。<br><span class="muted">档位阈值：≥${num(thr.overheat, 0)} 过热只减仓不新建 / ≥${num(thr.lo, 0)} 满仓 / ${num(thr.panic, 0)}~${num(thr.lo, 0)} 半仓 / ≤${num(thr.panic, 0)} 清仓（收盘打分、T+1 生效）</span>`) : '';
  const decompLine = total != null ? li(`因子分解（V5.0 五模块，仅供结构解释，不参与档位判定）: 情绪定位 ${scE} · 盈亏效应 ${scP} · 广度量能 ${scB} · 题材结构 ${scT} · 主线结构 ${scM} → 复合 ${total}。<span class="bf-warn">${riskHint}</span>`) : '';
  const riskLine = li(`V5.2 实盘约束：单笔止损 <b>-${pctOf(v52p.stopLoss ?? -0.08, 0)}</b>（优先于信号）｜回撤 ≥<b>${pctOf(v52p.ddTrigger ?? -0.15, 0)}</b> 动态降仓至 40%（0.6 倍阈值处降至 70%）｜单日仓位变动 ≤<b>${num(v52p.maxPosChg ?? 0.2, 2)}</b>｜换仓成本 佣金 ${bpOf(v52p.comm, 0.0003)}‱（双边）+ 印花税 ${bpOf(v52p.stamp, 0.0005)}‱（卖出）+ 滑点 ${bpOf(v52p.slip, 0.0002)}‱，按仓位变动幅度计提`);
  const sec6 = li(`<b>${verdict}</b>`) + tierLine + decompLine + riskLine +
    (watch.length ? `<div class="bf-h bf-h2">明日观测（引擎动态生成）</div>` + watch.map((w) => li('· ' + w)).join('') : '');

  const foot = `<div class="bf-foot">口径备注：涨跌家数为沪深两市（不含北交所）；上榜总成交、净买率、日度因子 s_net、近5日净额序列、新股扰动占比、主线题材资金占比全部只取「当日榜」口径（剔除"连续N个交易日累计"类区间榜——其买卖额与净额都是区间累计值，混入会把总成交放大数倍、净买率稀释至失真，并让日度因子把三天累计当成一天），分子分母一律同源；全量口径（含区间累计榜）仅在「完整参数」中单列作诊断，禁止与当日值混用；新股/独立标的=上市首5日无涨跌幅限制个股，其净买单独列示不计入主线；买方头部3席位集中度=全市场前3席位买入÷全部买方买入；锁仓统计=当日买方席位与近2日同票买方席位比对，未重复出现计为新进，样本为有席位明细的连续上榜股；主线题材龙虎资金占比=主线题材个股当日榜净买÷当日榜全榜净买；主线强度分=涨停家数×密集度（该题材涨停数÷当日全题材涨停数），与引擎 selectMainLine 同式；仓位档位采用 V5.2 引擎口径——主分数为七因子加权情绪分（龙虎净额20%／涨跌家数10%／板块涨比20%／涨停强度10%／涨跌停对比15%／封板质量10%／量能15%，与页面情绪分、回测引擎同源），阈值 过热80／满仓65／半仓24~65／清仓24，收盘打分、T+1 生效，并叠加止损-8%、回撤≥15%动态降仓、单日仓位变动≤20%、佣金万3+印花税万5+滑点万2 的实盘约束；因子分解中的 V5.0 五模块分仅用于结构解释，不参与档位判定；资金面（龙虎榜）为辅助观测，不参与打分；席位数据来自东财买卖榜明细（榜上席位口径），覆盖不足100%时拆分为部分样本。本报告由规则引擎根据当档数据自动生成，非投资建议。</div>`;

  return stamp + seg('① 情绪定位（核心因子·25%）', sec1, 'bfsec1') + seg('② 资金面（龙虎榜）· 辅助B 北向+机构行为（不参与打分）', sec2, 'bfsec2') +
    seg('③ 盈亏效应（核心因子·25%）', sec3, 'bfsec3') + seg('④ 广度与量能（核心因子·20%）', sec4, 'bfsec4') +
    seg('⑤ 题材结构（核心因子·20%）', sec5, 'bfsec5') + seg('⑥ 综合研判（含 V5.2 仓位档位）', sec6, 'bfsec6') + foot;
}

function renderBrief(days, arc) {
  $('briefBody').innerHTML = buildBrief(days, arc);
  renderBriefNav(); // 段落标题由 DOM 读出，不硬编码，避免与 buildBrief 的段落数漂移
}

// 报告目录：从渲染后的 .bf-sec 读标题生成跳转 chip（点击 → 滚到该段 + 展开）
function renderBriefNav() {
  const nav = $('briefNav');
  if (!nav) return;
  const secs = [...document.querySelectorAll('#briefBody .bf-sec')];
  nav.innerHTML = '';
  for (const s of secs) {
    const h = s.querySelector('.bf-h');
    if (!h) continue;
    const full = h.textContent.trim();
    // 段落标题本身也是折叠开关：加 tabindex/role，键盘 Enter 走同一套 data-act 委托
    h.tabIndex = 0;
    h.setAttribute('role', 'button');
    h.setAttribute('aria-expanded', 'true');
    h.dataset.act = 'bftoggle';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = full.split('（')[0] || full;
    b.dataset.act = 'brsec';
    b.dataset.t = s.id;
    b.title = `跳转到 ${full}`;
    nav.appendChild(b);
  }
  const tg = $('briefToggle');
  if (tg) tg.textContent = '全部折叠';
}

// 「全部折叠/展开」按钮文案跟随实际段落状态，避免按钮说反话
function syncBriefToggleLabel() {
  const secs = [...document.querySelectorAll('#briefBody .bf-sec')];
  const tg = $('briefToggle');
  if (tg) tg.textContent = (secs.length && secs.every((s) => s.classList.contains('collapsed'))) ? '全部展开' : '全部折叠';
}

// ── V5.2 策略回测面板：读 data/backtest.json（由 node scripts/backtest.mjs 预生成）──
// 数据文件缺失时只在卡片内提示，不影响其余区块渲染。
const pctS = (v, d = 2) => (v == null || !Number.isFinite(+v)) ? '—' : (+v * 100).toFixed(d) + '%';
const numS = (v, d = 2) => (v == null || !Number.isFinite(+v)) ? '—' : (+v).toFixed(d);

function drawNav(svg, series, dates = []) {
  const W = 300, H = 100, pad = 8;
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (!all.length) { svg.innerHTML = ''; return; }
  const min = Math.min(...all), max = Math.max(...all);
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i) => pad + (i * (W - 2 * pad)) / (n - 1 || 1);
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  let out = `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"></line>`;
  for (const s of series) {
    if (!s.values.length) continue;
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    out += `<polyline points="${pts}" style="stroke:${s.color}${s.dash ? ';stroke-dasharray:4 3' : ''}"></polyline>`;
  }
  // 数据点：默认透明（CSS 控制 opacity），hover 显示该点日期与净值，避免只能看曲线猜数值。
  // 同时可点开当日盘面（backtest.series.dates 与 archive.all_days 逐项一致，按日期匹配即可）。
  let dots = '';
  for (const s of series) {
    if (!s.values.length) continue;
    dots += s.values.map((v, i) => (v == null || !Number.isFinite(v)) ? '' :
      `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.2" style="fill:${s.color}" `
      + `data-act="btpt" data-d="${esc(dates[i] || '')}" tabindex="0" aria-label="${esc(s.name)} ${esc(dates[i] || '')} 净值 ${(+v).toFixed(4)}">`
      + `<title>${esc(s.name)}｜${esc(dates[i] || `第 ${i + 1} 日`)}｜净值 ${(+v).toFixed(4)}（点击看当日盘面）</title></circle>`).join('');
  }
  svg.innerHTML = out + dots;
}

function renderBacktest(bt) {
  const m = bt.meta || {}, P = bt.params || {}, v52 = P.v52 || {};
  const cmp = [
    ['年化收益', bt.base.annual, bt.v52.annual],
    ['最大回撤', bt.base.maxDd, bt.v52.maxDd],
    ['夏普比率', bt.base.sharpe, bt.v52.sharpe],
    ['Calmar', bt.base.calmar, bt.v52.calmar],
    ['持仓日胜率', bt.base.winRate, bt.v52.winRate],
    ['空仓占比', bt.base.emptyRatio, bt.v52.emptyRatio],
  ];
  const fmt = (v, i) => (i === 2 || i === 3) ? numS(v) : pctS(v, 1);
  $('btMetrics').innerHTML = '<table><thead><tr><th>指标</th><th>V5 基准口径</th><th>V5.2 增强口径</th></tr></thead><tbody>'
    + cmp.map((r, i) => `<tr><td class="muted">${r[0]}</td><td>${fmt(r[1], i)}</td><td>${fmt(r[2], i)}</td></tr>`).join('')
    + '</tbody></table>';

  const s = bt.series || {};
  const series = [
    { name: 'V5 基准（无成本/无风控）', values: s.navBase || [], color: 'var(--muted)', dash: true },
    { name: 'V5.2 增强（成本+平滑+风控）', values: s.navV52 || [], color: 'var(--acc)' },
    { name: '等权指数买入持有', values: s.navHold || [], color: 'var(--warn)', dash: true },
  ];
  drawNav($('btNavSvg'), series, s.dates || []);
  $('btLegend').innerHTML = series.map((x) => `<span><i style="background:${x.color}"></i>${x.name}</span>`).join('')
    + `<span>样本 ${m.days || 0} 个交易日（${(s.dates || [])[0] || '—'} ~ ${(s.dates || []).slice(-1)[0] || '—'}）</span>`;

  // 卡内只留最影响读数的两行（阈值 / 风控）；样本、标的、成本、口径备注收进「完整参数」抽屉
  $('btParams').innerHTML = [
    `阈值：过热 ${numS(P.thresholds?.overheat, 0)} / 满仓 ${numS(P.thresholds?.lo, 0)} / 半仓 ${numS(P.thresholds?.panic, 0)}~${numS(P.thresholds?.lo, 0)} / 清仓 ${numS(P.thresholds?.panic, 0)}（收盘打分，T+1 生效；hi=${numS(P.thresholds?.hi, 0)} 为保留参数，引擎判档未使用）`,
    `风控：最大仓位 ${numS(v52.maxPos, 2)}｜单笔止损 ${pctS(v52.stopLoss, 0) || '—'}｜回撤降仓触发 ${pctS(v52.ddTrigger, 0) || '—'}｜单日仓位变动 ≤ ${numS(v52.maxPosChg, 2)}`,
  ].join('<br>');
  $('btNote').textContent = `口径备注：${m.caveat || ''}`;

  const p = bt.pareto || {};
  $('paretoSummary').textContent = `扫描 ${p.scanned || 0} 组权重 · 去重后 ${p.uniqueCount || 0} 个不同结果 · 非支配解 ${p.count ?? '—'} 个。${p.note || ''}`;
  const ptb = $('paretoTable').querySelector('tbody');
  ptb.innerHTML = '';
  (p.rows || []).forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.dataset.act = 'wrow';
    tr.dataset.i = String(i);
    tr.tabIndex = 0;
    tr.title = `点击查看第 ${i + 1} 行权重组合的 7 因子权重与完整绩效`;
    tr.innerHTML = `<td>${numS(r.sharpe)}</td><td>${pctS(r.maxDd, 2)}</td><td>${numS(r.calmar)}</td>`
      + `<td>${pctS(r.annual, 2)}</td><td class="${r.np ? 'np-yes' : 'muted'}">${r.np ? '✓ 前沿' : '—'}</td>`;
    ptb.appendChild(tr);
  });
  if (!ptb.children.length) ptb.innerHTML = '<tr><td colspan="5" class="empty">网格结果为空</td></tr>';
  // 窄屏卡片：同一份 p.rows，同样可点开权重组合
  const pcb = $('paretoCards');
  if (pcb) {
    pcb.innerHTML = (p.rows || []).length ? (p.rows || []).map((r, i) =>
      `<div class="hcard" data-act="wrow" data-i="${i}" tabindex="0" role="button"`
      + ` title="点击查看第 ${i + 1} 行权重组合的 7 因子权重与完整绩效">`
      + `<div class="hc-head"><span class="hc-name">第 ${i + 1} 组权重</span>`
      + `<span class="hc-code muted">夏普</span><span class="hc-big">${numS(r.sharpe)}</span></div>`
      + '<div class="hc-tags">'
      + `<span class="hc-tag"><i>最大回撤</i>${pctS(r.maxDd, 2)}</span>`
      + `<span class="hc-tag"><i>Calmar</i>${numS(r.calmar)}</span>`
      + `<span class="hc-tag"><i>年化</i>${pctS(r.annual, 2)}</span>`
      + `<span class="hc-tag"><i>非支配</i><span class="${r.np ? 'np-yes' : 'muted'}">${r.np ? '✓ 前沿' : '—'}</span></span>`
      + '</div></div>').join('')
      : '<div class="empty">网格结果为空</div>';
  }

  const R = bt.rolling || {};
  const line = (label, x) => `${label}：夏普均值 ${numS(x?.sharpeMean)}｜最差段回撤 ${pctS(x?.ddWorst, 2)}｜正收益段 ${pctS(x?.winSegPct, 0)}`;
  $('rollSummary').innerHTML = `${line('固定权重', R.base)}<br>${line('逐窗重寻优', R.refit)}`
    + (R.refitChangedSegments != null ? `<br>重寻优实际换权重的段：${R.refitChangedSegments}/${(R.refit?.segments || []).length}` : '');
  // 分段行统一收集后同时喂给表格与窄屏卡片（两者 DOM 都在，由 CSS 决定显示哪个）
  const segs = [];
  [['固定', R.base, 'base'], ['重寻优', R.refit, 'refit']].forEach(([label, x, kind]) => {
    (x?.segments || []).forEach((sg, i) => segs.push({ label, sg, kind, i }));
  });
  const rtb = $('rollTable').querySelector('tbody');
  rtb.innerHTML = segs.length ? segs.map(({ label, sg, kind, i }) =>
    `<tr class="clickable" data-act="seg" data-kind="${kind}" data-i="${i}" tabindex="0"`
    + ` title="点击查看该段的训练窗、权重与绩效（${label}口径）">`
    + `<td class="muted">${label}</td><td>${esc(sg.testStart)} ~ ${esc(sg.testEnd)}</td>`
    + `<td class="${trendCls(sg.total)}">${pctS(sg.total, 2)}</td><td>${numS(sg.sharpe)}</td><td>${pctS(sg.maxDd, 2)}</td></tr>`
  ).join('') : '<tr><td colspan="5" class="muted">样本不足，未切出滚动段</td></tr>';
  const rcb = $('rollCards');
  if (rcb) {
    rcb.innerHTML = segs.length ? segs.map(({ label, sg, kind, i }) =>
      `<div class="hcard" data-act="seg" data-kind="${kind}" data-i="${i}" tabindex="0" role="button"`
      + ` title="点击查看该段的训练窗、权重与绩效（${label}口径）">`
      + `<div class="hc-head"><span class="hc-name">${label}口径</span>`
      + `<span class="hc-big ${trendCls(sg.total)}">${pctS(sg.total, 2)}</span></div>`
      + '<div class="hc-tags">'
      + `<span class="hc-tag"><i>夏普</i>${numS(sg.sharpe)}</span>`
      + `<span class="hc-tag"><i>回撤</i>${pctS(sg.maxDd, 2)}</span>`
      + '</div>'
      + `<div class="hc-reason">测试区间 ${esc(sg.testStart)} ~ ${esc(sg.testEnd)}</div>`
      + '</div>').join('')
      : '<div class="empty">样本不足，未切出滚动段</div>';
  }

  const ml = bt.mainLine || {};
  const box = $('mainLineBody');
  box.innerHTML = '';
  (ml.mains || []).forEach((mn) => {
    const head = document.createElement('div');
    head.className = 'ml-head';
    head.innerHTML = `<span class="tag2 click" data-act="theme" data-theme="${esc(mn.theme)}" tabindex="0" title="查看该题材的成分股与强度">主线题材 ${esc(mn.theme)}</span>`
      + `<span>涨停 <b>${mn.themeCount}</b> 只</span>`
      + `<span>密集度 ${(mn.density * 100).toFixed(1)}%</span>`
      + `<span>强度分 <span class="ml-score">${mn.mainScore}</span></span>`
      + `<span class="muted">自动选出标的 ${mn.stockCount} 只</span>`;
    box.appendChild(head);
    if (mn.stocks?.length) {
      const wrap = document.createElement('div');
      wrap.className = 'chips';
      wrap.style.marginBottom = '10px';
      mn.stocks.forEach((st) => {
        const c = document.createElement('span');
        c.className = 'chip click';
        c.dataset.act = 'stock';
        c.dataset.code = st.code;
        c.tabIndex = 0;
        c.title = `点击查看 ${st.name} 的席位与资金详情`;
        c.innerHTML = `${esc(st.name)} <span class="${trendCls(st.changePct)}">${numS(st.changePct, 2)}%</span>`;
        wrap.appendChild(c);
      });
      box.appendChild(wrap);
    }
  });
  const ind = document.createElement('div');
  ind.className = 'ml-head';
  ind.innerHTML = '<span class="muted">领涨行业：</span>'
    + (ml.topIndustries || []).map((x) => `<span class="tag2">${x.name} <span class="bf-up">+${numS(x.change_pct, 2)}%</span></span>`).join('');
  box.appendChild(ind);
  const note = document.createElement('div');
  note.className = 'bf-foot';
  note.textContent = `口径：主线题材按当日题材榜涨停家数取前 N；标的清单取热点榜中诱因含该题材的强势股，按当日涨幅降序。`
    + `强度分 = 主线涨停家数 × 密集度（该题材涨停数 ÷ 当日全题材涨停数），与离线 Python 版 find_main_line 的「涨停家数 × 涨停密度」同形，但数据源不同，绝对量级不可直接比较。数据截至 ${ml.tradeDate || '—'}。`;
  box.appendChild(note);
}

async function loadBacktest() {
  try {
    const res = await fetch('./data/backtest.json?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    BT = await res.json();
    renderBacktest(BT);
    // 阈值/主线就绪后按引擎口径重刷：报告（§6 档位）、趋势参考线、个股表的连板/席位列。
    // 首次渲染时 BT 尚为 null，用的是与引擎同值的默认阈值（24/44/65/80），缺失时页面仍可读、不空白。
    if (lastArc) {
      const d = lastArc.all_days || [];
      renderBrief(d, lastArc);
      renderTrend(d);
      renderHotTable();
    }
  } catch (e) {
    const n = $('btNote');
    if (n) n.textContent = `回测数据未生成或加载失败（生成命令：node scripts/backtest.mjs）：${e.message}`;
  }
}

let lastFp = '';

function fingerprint(arc) {
  return [(arc.meta && arc.meta.generatedAt) || '', (arc.signals && arc.signals.tradeDate) || '',
    (arc.all_days || []).length, (arc.all_days || []).slice(-1)[0]?.emotion?.value ?? ''].join('|');
}

// ── 区五：外围市场 · 隔夜与节后预案 ──
// 数据是独立文件 data/global.json（scripts/fetch_global.mjs 预生成）：外围在 A 股休市期间
// 照常更新，与 archive.json 节奏不同——合成一个文件会让「A股没更新」与「外围没更新」
// 互相掩盖。加载失败只影响本区，不影响其它卡片。
let GLOB = null;

function loadGlobal() {
  return fetch('./data/global.json?_=' + Date.now(), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((g) => renderGlobal(g))
    .catch((e) => {
      const box = $('globVerdict');
      if (box) box.innerHTML = `<div class="gv neu"><div class="gv-hint">外围数据未就绪（${esc(e.message)}）——先运行 <b>node scripts/fetch_global.mjs</b> 生成 data/global.json。</div></div>`;
    });
}

/** 会话/时间列：美股给「会话日 + 收盘时刻」，盘中品种给当日时间 */
function globWhen(q) {
  const t = String(q.quoteTime || '');
  const clock = t.length > 12 ? t.slice(11, 16) : (t.length >= 5 ? t.slice(0, 5) : t);
  if (q.sessionDate && clock) return q.sessionDate + ' ' + clock;
  return q.sessionDate || clock || '—';
}

function renderGlobal(g) {
  GLOB = g;
  const meta = g.meta || {};
  const w = g.watch || {};
  const sub = $('globSub');
  if (sub) {
    sub.textContent = `隔夜美股 ${meta.usSessionDate || '--'} 收盘`
      + (meta.aShareNextOpen
        ? ` · A股下次开市 ${meta.aShareNextOpen}（开市前还有 ${meta.usSessionsBeforeOpen} 个美股交易日）`
        : '');
  }

  // 结论条
  const v = w.verdict || {};
  const vbox = $('globVerdict');
  if (vbox) {
    const cls = v.key === 'positive' ? 'ok' : v.key === 'negative' ? 'bad' : 'neu';
    vbox.innerHTML = `<div class="gv ${cls}">
        <div class="gv-main">外围研判 <b>${esc(v.label || '—')}</b>
          <span class="muted">· 净倾向 ${(w.bias > 0 ? '+' : '') + w.bias}（门槛 ±${w.biasGate}）</span></div>
        <div class="gv-hint">${esc(v.hint || '')}</div>
        ${meta.aShareHoliday ? '<div class="gv-note">A 股休市中：本卡片每个工作日随隔夜外围刷新，用途就是节后开盘预案。</div>' : ''}
      </div>`;
  }

  // 触发式观测：越过阈值才输出（与研判报告的「明日观测」同一思路，不做固定清单）
  const sbox = $('globSignals');
  if (sbox) {
    const sig = w.signals || [];
    sbox.innerHTML = sig.length
      ? '<div class="bf-h bf-h2">触发式观测（越过阈值才输出）</div>'
        + sig.map((s) => `<div class="gsig ${esc(s.level)}">${esc(s.text)}</div>`).join('')
      : '<div class="muted">无触发项</div>';
  }

  // 行情表（宽屏）
  const rows = g.quotes || [];
  const tb = $('globTable')?.querySelector('tbody');
  if (tb) {
    tb.innerHTML = rows.map((q) => {
      const cls = trendCls(q.chgPct);
      const marks = (q.role === 'a_share_proxy' ? '<span class="gtag a">A股锚</span>' : '')
        + (q.ok ? '' : '<span class="gtag n">无行情</span>');
      return `<tr data-act="glob" data-key="${esc(q.key)}" tabindex="0">
        <td>${esc(q.name)}${marks}</td>
        <td class="num ${cls}">${esc(q.lastText)}</td>
        <td class="num ${cls}">${esc(q.chgPctText)}</td>
        <td class="muted gwhen">${esc(globWhen(q))}</td>
      </tr>`;
    }).join('');
  }

  // 行情卡片（窄屏）：与表格同一份数据、同一顺序
  const cl = $('globCards');
  if (cl) {
    cl.innerHTML = rows.map((q) => {
      const cls = trendCls(q.chgPct);
      const marks = q.role === 'a_share_proxy' ? '<span class="gtag a">A股锚</span>' : '';
      return `<div class="gcard" data-act="glob" data-key="${esc(q.key)}" tabindex="0">
        <div class="gc-top"><span>${esc(q.name)}${marks}</span>
          <span class="${cls}">${esc(q.chgPctText)}</span></div>
        <div class="gc-bot muted"><span>${esc(q.lastText)}</span><span>${esc(globWhen(q))}</span></div>
      </div>`;
    }).join('');
  }

  // 映射表：外围品种 → A 股板块（映射关系来自构建期下发的 anchors，前端不重写一份）
  const mbox = $('globMap');
  if (mbox) {
    mbox.innerHTML = '<div class="gmap">' + (g.anchors || []).map((a) => {
      const q = rows.find((x) => x.key === a.from);
      const cls = q ? trendCls(q.chgPct) : 'muted';
      const dir = a.sign > 0 ? '同向' : a.sign < 0 ? '反向' : '结构';
      return `<div class="gmap-row" data-act="gmap" data-from="${esc(a.from)}" tabindex="0">
        <div class="gm-l"><span>${esc(q ? q.name : a.from)}</span>
          <span class="${cls}">${esc(q ? q.chgPctText : '—')}</span></div>
        <div class="gm-mid"><span class="gtag ${a.sign > 0 ? 'u' : a.sign < 0 ? 'd' : ''}">${dir}</span></div>
        <div class="gm-r">${esc((a.aSectors || []).join(' · '))}</div>
      </div>`;
    }).join('') + '</div>';
  }

  // 假期跟踪清单
  const tbox = $('globTrack');
  if (tbox) {
    const dates = meta.usSessionDates || [];
    const wd = (d) => ['日', '一', '二', '三', '四', '五', '六'][new Date(d + 'T00:00:00Z').getUTCDay()];
    const last = meta.usSessionDate;
    tbox.innerHTML = '<div class="bf-h">假期跟踪清单</div>'
      + (dates.length
        ? `<div class="gtrk-note muted">A 股 ${esc(meta.aShareNextOpen)}（周${wd(meta.aShareNextOpen)}）开市，之前还有 ${dates.length} 个美股交易日，每场收盘后本页自动刷新：</div>
           <div class="gtrk">${dates.map((d) => `<span class="gtk${last && d <= last ? ' done' : ''}">${d.slice(5)} 周${wd(d)}</span>`).join('')}</div>
           <div class="gtrk-note muted">最近已收盘 ${esc(last || '—')}。长假期间 A50 期货全程在交易，是最贴近 A 股开盘方向的实时参考；道指金融/消费权重高，只作广度参考。</div>`
        : '<div class="muted">A 股当前非假期状态：按交易日正常跟踪。</div>');
  }

  // 口径备注
  const nbox = $('globNote');
  if (nbox) {
    const failed = meta.failed || [];
    nbox.innerHTML = '口径备注：' + esc(meta.note || '')
      + (failed.length ? ` <span class="bf-warn">本次未取到：${esc(failed.join('、'))}（保持缺失，不写 0）。</span>` : '')
      + ` 数据源 ${esc(meta.source || '')} · 最近一次尝试 ${esc(String((meta.lastAttempt || {}).outcome || ''))}。`;
  }
}

/** 外围品种详情（点行情表/卡片打开） */
function globalDetail(key) {
  if (!GLOB) return null;
  const q = (GLOB.quotes || []).find((x) => x.key === key);
  if (!q) return null;
  const numOr = (x) => (x == null ? '—' : String(x));
  const lines = [
    dwSection('行情', dwKv([
      ['最新', `<b>${esc(q.lastText)}</b>`],
      ['涨跌幅', `<span class="${trendCls(q.chgPct)}">${esc(q.chgPctText)}</span>`],
      ['昨收', numOr(q.prevClose)],
      ['涨跌额', q.chg == null ? '—' : `${q.chg > 0 ? '+' : ''}${q.chg}`],
      ['开 / 高 / 低', `${numOr(q.open)} / ${numOr(q.high)} / ${numOr(q.low)}`],
      ['52周高 / 低', q.hi52 == null && q.lo52 == null ? '该品种源不提供' : `${numOr(q.hi52)} / ${numOr(q.lo52)}`],
    ])),
    dwSection('时间与来源', dwKv([
      ['会话日', esc(q.sessionDate || '—')],
      ['行情时间', esc(String(q.quoteTime || '—'))],
      ['源字段涨跌幅', q.chgPctReported == null ? '源未提供' : `${q.chgPctReported}%（本页用 昨收 现算，两者不一致即为口径漂移）`],
      ['数据源代码', esc(q.code)],
    ])),
  ];
  const anchors = (GLOB.anchors || []).filter((a) => a.from === key);
  if (anchors.length) {
    lines.push(dwSection('映射到的 A 股方向', anchors.map((a) => `<div class="dw-note"><b>${esc((a.aSectors || []).join(' · '))}</b>（${a.sign > 0 ? '同向' : a.sign < 0 ? '反向' : '结构参考'}）<br>${esc(a.why)}</div>`).join('')));
  }
  if (q.note) lines.push(dwSection('口径说明', `<div class="dw-note">${esc(q.note)}</div>`));
  if (!q.ok) lines.push('<div class="dw-note">⚠ 本次未取到该品种行情（保持缺失，不写 0）——缺失与「0 波动」是两件事。</div>');
  return { title: q.name, sub: `外围品种 · ${esc(q.key)} · 会话 ${esc(q.sessionDate || '—')}`, body: lines.join('') };
}

/** 映射条目详情（点映射表打开） */
function globalMapDetail(from) {
  if (!GLOB) return null;
  const a = (GLOB.anchors || []).find((x) => x.from === from);
  if (!a) return null;
  const q = (GLOB.quotes || []).find((x) => x.key === from);
  const t = GLOB.thresholds || {};
  return {
    title: `${q ? q.name : from} → A 股`,
    sub: `映射方向 · ${a.sign > 0 ? '同向' : a.sign < 0 ? '反向' : '结构参考'}`,
    body: dwSection('对应 A 股板块', `<div class="dw-chips">${(a.aSectors || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>`)
      + dwSection('为什么这样映射', `<div class="dw-note">${esc(a.why)}</div>`)
      + dwSection('当前值', dwKv([
        ['最新', q ? esc(q.lastText) : '—'],
        ['涨跌幅', q ? `<span class="${trendCls(q.chgPct)}">${esc(q.chgPctText)}</span>` : '—'],
      ]))
      + dwSection('观测阈值', `<div class="dw-note">承压/支撑阈值定义在 src/global.js 的 WATCH_THRESHOLDS，构建期随 data/global.json 下发；本页触发式观测完全按该阈值判定。</div>`)
      + `<div class="dw-note">阈值口径：A50 期货 ±${t.a50Up}% · 费半 -${Math.abs(t.soxDown)}%/+${t.soxUp}% · 纳指 ±${t.ixicUp}% · 中国金龙 -${Math.abs(t.hxcDown)}%/+${t.hxcUp}% · 美元指数 ±${t.dxyUp}% · 离岸人民币 ±${t.rmbDep}%。</div>`,
  };
}

function renderAll(arc) {
  lastArc = arc; // 供 loadBacktest 完成后按引擎口径重刷报告
  ARC = arc;     // 供个股明细表与详情抽屉使用
  const days = arc.all_days || [];
  const latest = days[days.length - 1] || {};
  const meta = arc.meta || {};

  $('tradeDate').textContent = arc.signals?.tradeDate || latest.trade_date || '--';
  const tag = $('sourceTag');
  // 小标签按新口径：live 且未滞后 → LIVE；滞后 → STALE；离线回放 → DEMO
  const tagText = meta.source === 'offline-replay' ? 'DEMO' : (meta.stale ? 'STALE' : 'LIVE');
  tag.textContent = tagText;
  tag.className = 'tag ' + (tagText === 'LIVE' ? 'live' : tagText === 'STALE' ? 'stale' : '');
  $('genTime').textContent = meta.generatedAt ? '更新 ' + meta.generatedAt.replace('T', ' ').slice(0, 16) : '';

  renderAlerts(meta);
  renderEmotion(latest);
  renderMomentum(arc.signals?.momentum || {});
  renderTrend(days);
  renderThemes(latest);
  renderHotTable();
  renderBrief(days, arc);
  loadGlobal();  // 外围市场（独立数据文件，缺失不影响上述渲染）
  loadBacktest(); // 回测/帕累托/滚动/主线选股四区块（独立数据文件，缺失不影响上述渲染）
}

async function checkUpdate(manual) {
  const btn = $('refreshBtn'), st = $('refreshState');
  if (manual && btn) { btn.classList.add('busy'); btn.textContent = '↻ 拉取中…'; }
  try {
    const res = await fetch('./data/archive.json?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arc = await res.json();
    const fp = fingerprint(arc);
    const changed = lastFp !== '' && fp !== lastFp;
    const first = lastFp === '';
    renderAll(arc); // 先渲染，成功才更新指纹——渲染失败下次轮询自动重试
    lastFp = fp;
    const hhmm = new Date().toTimeString().slice(0, 5);
    if (st) {
      if (changed) { st.textContent = hhmm + ' 数据已更新'; st.className = 'ok'; }
      else if (manual && !first) { st.textContent = hhmm + ' 已是最新'; st.className = 'ok'; }
      else { st.textContent = ''; st.className = ''; }
    }
  } catch (e) {
    if (lastFp === '') {
      $('alerts').innerHTML = `<div class="alert">⚠ 加载失败：${e.message}。请确认 data/archive.json 已生成并部署。</div>`;
    }
    if (st && manual) { st.textContent = '刷新失败: ' + e.message; st.className = 'err'; }
  } finally {
    if (btn) { btn.classList.remove('busy'); btn.textContent = '↻ 刷新'; }
  }
}

const POLL_MS = 5 * 60 * 1000; // 每 5 分钟自动检查一次云端档是否更新
checkUpdate(false);
setInterval(() => checkUpdate(false), POLL_MS);
$('refreshBtn').addEventListener('click', () => checkUpdate(true));

// ════════════════════════════════════════════════════════════════════
// 交互层：详情抽屉 + 五类详情（个股 / 题材 / 权重组合 / 滚动分段 / 交易日）
// 设计取舍：详情一律走同一个右侧抽屉（不用 alert、不新开页面、不加载额外依赖），
// 抽屉内可继续下钻（题材 → 个股），用栈记录来路并提供返回。
// ════════════════════════════════════════════════════════════════════
const drawerEl = () => $('drawer');
let dwStack = [];
let lastFocus = null;

function dwSection(h, body) {
  return `<div class="dw-sec"><div class="dw-h">${esc(h)}</div>${body}</div>`;
}
function dwKv(pairs) {
  return `<div class="dw-kv">${pairs.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${v}</div>`).join('')}</div>`;
}
function dwBars(rows, unit = '') {
  const max = Math.max(1, ...rows.map((r) => +r[1] || 0));
  return `<div class="dw-bars">${rows.map(([label, v]) => `
    <div>${esc(label)}</div><div class="bar"><i style="width:${((+v || 0) / max * 100).toFixed(1)}%"></i></div>
    <div class="n">${v}${unit}</div>`).join('')}</div>`;
}

function renderDrawer(v) {
  const dw = drawerEl();
  if (!dw) return;
  $('dwTitle').textContent = v.title || '';
  $('dwSub').innerHTML = v.sub || '';
  const back = dwStack.length
    ? '<button class="mini" type="button" data-act="dback" style="margin-bottom:10px">← 返回上级</button>' : '';
  $('dwBody').innerHTML = back + (v.body || '');
  $('dwBody').scrollTop = 0;
}

function openDrawer(v, push = true) {
  const dw = drawerEl();
  if (!dw) return;
  if (push && dw.classList.contains('open')) {
    dwStack.push({ title: $('dwTitle').textContent, sub: $('dwSub').innerHTML, body: $('dwBody').innerHTML.replace(/^<button[^>]*data-act="dback"[^>]*>.*?<\/button>/, '') });
  }
  if (!dw.classList.contains('open')) lastFocus = document.activeElement;
  renderDrawer(v);
  dw.classList.add('open');
  dw.setAttribute('aria-hidden', 'false');
  $('drawerMask')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  $('dwClose')?.focus?.();
}

function closeDrawer() {
  const dw = drawerEl();
  if (!dw || !dw.classList.contains('open')) return;
  dw.classList.remove('open');
  dw.setAttribute('aria-hidden', 'true');
  $('drawerMask')?.classList.remove('open');
  document.body.style.overflow = '';
  dwStack = [];
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
}

// ── ① 个股详情 ──
function stockDetail(code) {
  const days = ARC?.all_days || [];
  const last = days[days.length - 1] || {};
  const hot = (last.hot || []).find((h) => h.code === code) || null;
  const lhb = (last.lhb_aggr || last.lhb || []).find((l) => l.code === code) || null;
  const s = last.summary || {};
  const detail = (s.seats?.detail || {})[code] || null;
  const name = hot?.name || lhb?.name || code;
  const chg = hot?.change_pct ?? lhb?.change_pct ?? null;
  const reason = hot?.reason || lhb?.reason || '';
  const lb = (s.zt_lb || {})[code] ?? null;
  const isZt = (s.zt_codes || []).includes(code);
  const isNew = /无价格涨跌幅限制/.test(reason);

  const quote = [
    ['代码', `<b>${esc(code)}</b>`],
    ['名称', `<b>${esc(name)}</b>`],
    ['现价', (hot?.close ?? lhb?.close) != null ? `${hot?.close ?? lhb?.close} 元` : '—'],
    ['当日涨跌幅', `<span class="${trendCls(chg)}">${pctOf2(chg)}</span>`],
    ['换手率', (hot?.huanshou ?? lhb?.turnover_pct) != null ? `${hot?.huanshou ?? lhb?.turnover_pct}%` : '—'],
    ['涨停/连板', isZt ? `涨停${lb ? `（${lb} 连板）` : ''}` : (lb ? `${lb} 板` : '未涨停')],
    ['数据日期', esc(last.trade_date || '—')],
  ];

  const lhbSec = lhb ? dwKv([
    ['龙虎净买', `<span class="${trendCls(lhb.net_buy_wan)}">${yiOf(lhb.net_buy_wan)} 亿</span>`],
    ['买入额', `${yiOf(lhb.buy_wan)} 亿`],
    ['卖出额', `${yiOf(lhb.sell_wan)} 亿`],
    ['买卖总额', `${yiOf((lhb.buy_wan || 0) + (lhb.sell_wan || 0))} 亿`],
    // 口径透明：区间累计榜的数值是区间累计值，读者必须知道自己在看哪一个数
    ['榜单口径', lhb.caliber === 'range'
      ? '<span class="bf-warn">区间累计榜</span>（连续 N 个交易日累计值，非当日；不计入当日净买率）'
      : '当日榜（当日席位买卖，权威口径）'],
    ['上榜席位', detail ? `${detail.length} 条买方明细` : '无明细'],
  ]) : '<div class="dw-empty">该股当日未上龙虎榜（无资金明细）</div>';

  let seatSec = '';
  if (detail?.length) {
    const rows = detail.slice().sort((a, b) => (+b[1] || 0) - (+a[1] || 0));
    const sum = rows.reduce((a, x) => a + (+x[1] || 0), 0);
    const top3 = rows.slice(0, 3).reduce((a, x) => a + (+x[1] || 0), 0);
    seatSec = dwSection('买方席位明细（东财买卖榜口径）',
      `<table class="dw-tb"><thead><tr><th>买方席位</th><th class="num">买入(万)</th><th class="num">占买方</th></tr></thead><tbody>`
      + rows.slice(0, 8).map(([nm, v]) => `<tr><td>${esc(nm)}</td><td class="num">${(+v || 0).toFixed(0)}</td>`
        + `<td class="num">${sum ? ((+v || 0) / sum * 100).toFixed(1) : '—'}%</td></tr>`).join('')
      + `</tbody></table>`
      + `<div class="dw-note">买方席位合计 ${sum.toFixed(0)} 万，前 3 席位占 ${sum ? (top3 / sum * 100).toFixed(1) : '—'}%`
      + `（明细为榜单口径，仅含买方席位；席位覆盖 ${s.seats?.cover ?? '—'}%）。</div>`);
  }

  const themes = Object.keys(last.themes || {}).filter((t) => reason.includes(t) && t.length >= 2);
  const themeSec = themes.length
    ? dwSection('所属题材（按诱因文本匹配）',
      `<div class="dw-chips">${themes.map((t) => `<span class="chip click" data-act="theme" data-theme="${esc(t)}" tabindex="0">${esc(t)}</span>`).join('')}</div>`)
    : '';

  const hist = days.slice(-5).map((d) => {
    const h = (d.hot || []).find((x) => x.code === code) || null;
    const l = (d.lhb_aggr || d.lhb || []).find((x) => x.code === code) || null;
    return { date: d.trade_date, chg: h?.change_pct ?? l?.change_pct ?? null, net: l?.net_buy_wan ?? null, inLhb: !!l };
  });
  const histSec = dwSection('近 5 个交易日记录',
    `<table class="dw-tb"><thead><tr><th>交易日</th><th class="num">涨跌幅</th><th class="num">龙虎净买(亿)</th><th>上榜</th></tr></thead><tbody>`
    + hist.map((x) => `<tr><td>${esc(x.date)}</td><td class="num ${trendCls(x.chg)}">${pctOf2(x.chg)}</td>`
      + `<td class="num ${trendCls(x.net)}">${x.net == null ? '—' : yiOf(x.net)}</td>`
      + `<td class="muted">${x.inLhb ? '龙虎榜' : '未上榜'}</td></tr>`).join('')
    + '</tbody></table>');

  const ml = BT?.mainLine || {};
  const inMain = (ml.mains || []).find((m) => (m.stocks || []).some((x) => x.code === code));

  const body = dwSection('行情与状态', dwKv(quote))
    + dwSection('龙虎榜资金', lhbSec)
    + seatSec
    + themeSec
    + histSec
    + (inMain ? dwSection('主线归属', `<div class="dw-kv"><div class="k">主线题材</div><div class="v"><span class="chip click" data-act="theme" data-theme="${esc(inMain.theme)}" tabindex="0">${esc(inMain.theme)}</span>（强度分 ${inMain.mainScore}，当日涨停 ${inMain.themeCount} 只）</div></div>`) : '')
    + `<div class="dw-note">诱因：${esc(reason || '—')}${isNew ? '（<b>独立新股</b>：上市首 5 日无涨跌幅限制，其资金不宜直接计入主线强度）' : ''}</div>`;

  return {
    title: `${name}　${code}`,
    sub: `当日 ${pctOf2(chg)} · 龙虎净买 ${lhb ? yiOf(lhb.net_buy_wan) + ' 亿' : '—'} · 数据 ${last.trade_date || '—'}`,
    body,
  };
}

// ── ② 题材详情 ──
function themeDetail(theme) {
  const days = ARC?.all_days || [];
  const last = days[days.length - 1] || {};
  const th = last.themes || {};
  const cnt = th[theme] ?? null;
  const total = Object.values(th).reduce((a, b) => a + b, 0) || 1;
  const density = cnt == null ? null : cnt / total;
  const mainScore = cnt == null ? null : Math.round(cnt * density * 100) / 100;
  const hotStocks = (last.hot || []).filter((h) => String(h.reason || '').includes(theme));
  const ztLb = last.summary?.zt_lb || {};
  const ml = (BT?.mainLine?.mains || []).find((m) => m.theme === theme) || null;

  const head = dwKv([
    ['题材', `<b>${esc(theme)}</b>`],
    ['当日涨停', cnt == null ? '—' : `${cnt} 只`],
    ['密集度', density == null ? '—' : `${(density * 100).toFixed(2)}%（该题材涨停 ÷ 当日全题材涨停）`],
    ['主线强度分', mainScore == null ? '—' : `<b>${mainScore}</b>（涨停家数 × 密集度，与引擎 selectMainLine 同式）`],
    ['是否当日主线', ml ? `是（引擎自动选出标的 ${ml.stockCount} 只）` : '否（未进入引擎主线名单）'],
    ['数据日期', esc(last.trade_date || '—')],
  ]);

  const stockSec = dwSection(`成分股（热点榜诱因含「${theme}」，按涨幅降序）`,
    hotStocks.length
      ? `<table class="dw-tb"><thead><tr><th>代码</th><th>名称</th><th class="num">涨幅</th><th class="num">连板</th></tr></thead><tbody>`
        + hotStocks.slice().sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0))
          .map((h) => `<tr class="clickable" data-act="stock" data-code="${esc(h.code)}" tabindex="0">`
            + `<td>${esc(h.code)}</td><td>${esc(h.name)}</td>`
            + `<td class="num ${trendCls(h.change_pct)}">${pctOf2(h.change_pct)}</td>`
            + `<td class="num">${ztLb[h.code] ? ztLb[h.code] + '板' : '—'}</td></tr>`).join('')
        + '</tbody></table>'
      : '<div class="dw-empty">当日热点榜中没有诱因含该题材的个股（可能只贡献涨停数、未进热点榜）</div>');

  const hist5 = days.slice(-5).map((d) => [d.trade_date.slice(5), (d.themes || {})[theme] ?? 0]);
  const histSec = dwSection('近 5 个交易日涨停家数', dwBars(hist5, ' 只'));

  return {
    title: `题材　${theme}`,
    sub: cnt == null ? '当日无该题材记录' : `当日涨停 ${cnt} 只 · 密集度 ${(density * 100).toFixed(1)}% · 强度分 ${mainScore}`,
    body: dwSection('题材概况', head) + stockSec + histSec
      + '<div class="dw-note">口径：题材归属来自东财榜单诱因文本；密集度＝该题材涨停数 ÷ 当日全题材涨停数；成分股为热点榜中诱因含该题材的个股，与「主线自动选股」卡同源。</div>',
  };
}

// ── 回测完整参数与口径（策略回测卡的「查看完整参数与口径」）──
const FACTOR_LAB = { s_net: '龙虎榜净额', s_pos: '涨跌家数', s_brd: '板块涨比', s_hot: '涨停强度', s_zdt: '涨跌停对比', s_zbl: '封板质量', s_amt: '量能' };

function btDetail() {
  const m = BT?.meta || {}, P = BT?.params || {}, v52 = P.v52 || {}, th = P.thresholds || TH_DEFAULT;
  const s = BT?.series || {};
  const dates = s.dates || [];
  const base = BT?.base || {}, cur = BT?.v52 || {};
  const d = (a, b, isPct, invert) => {
    if (a == null || b == null || !Number.isFinite(+a) || !Number.isFinite(+b)) return '—';
    const diff = +b - +a;
    const good = invert ? diff < 0 : diff > 0;
    const txt = isPct ? `${(diff * 100).toFixed(2)}pp` : diff.toFixed(2);
    // 颜色按中文语境：改善用红（hl），恶化用绿（hl-dn）——与涨跌配色一致
    return `<span class="${diff === 0 ? 'muted' : good ? 'hl' : 'hl-dn'}">${diff > 0 ? '+' : ''}${txt}</span>`;
  };
  return {
    title: '策略回测 · 完整参数与口径',
    sub: `${m.days || 0} 个交易日（${dates[0] || '—'} ~ ${dates.slice(-1)[0] || '—'}）· 标的 ${(m.assets || []).join(' / ')} · 版本 ${m.formulaVersion || '—'}`,
    body: dwSection('样本与标的', dwKv([
      ['样本区间', esc(`${dates[0] || '—'} ~ ${dates.slice(-1)[0] || '—'}`)],
      ['交易日数', `${m.days || 0} 个（本样本量下年化/夏普统计意义有限）`],
      ['标的', esc((m.assets || []).join(' / '))],
      ['组合方式', '各标的独立按同规则回测 → 日收益等权合成'],
    ]))
      + dwSection('信号口径', `<div class="dw-kv"><div class="k">信号</div><div class="v">${esc(m.signal || '—')}</div></div>`
        + `<div class="dw-note">七因子权重：${Object.entries(FACTOR_LAB).map(([k, v]) => `${v}`).join(' / ')}（取值见 src/config.js）。</div>`)
      + dwSection('交易成本（按仓位变动幅度计提）', dwKv([
        ['佣金', `${(v52.comm != null ? (v52.comm * 1e4).toFixed(2) : '—')}‱（双边）`],
        ['印花税', `${(v52.stamp != null ? (v52.stamp * 1e4).toFixed(2) : '—')}‱（仅卖出）`],
        ['滑点', `${(v52.slip != null ? (v52.slip * 1e4).toFixed(2) : '—')}‱（单边）`],
        ['原始口径', esc(m.costNote || '—')],
      ]))
      + dwSection('风控与仓位约束', dwKv([
        ['最大仓位', numS(v52.maxPos, 2)],
        ['单笔止损', pctS(v52.stopLoss, 0) || '—'],
        ['动态降仓', `回撤 ≥${pctS(v52.ddTrigger, 0) || '—'} 压至 40%（0.6 倍阈值处降至 70%）`],
        ['单日仓位变动', `≤ ${numS(v52.maxPosChg, 2)}`],
      ]))
      + dwSection('阈值（收盘打分、T+1 生效）', dwKv([
        ['过热（只减不新建）', `≥ ${numS(th.overheat, 0)}`],
        ['满仓', `≥ ${numS(th.lo, 0)}`],
        ['半仓', `${numS(th.panic, 0)} ~ ${numS(th.lo, 0)}`],
        ['清仓', `≤ ${numS(th.panic, 0)}`],
        ['hi 参数', `${numS(th.hi, 0)}（保留参数，引擎 positions() 判档未使用）`],
      ]))
      + dwSection('V5.2 相对 V5 基准的变化', dwKv([
        ['年化收益', `${pctS(base.annual, 2)} → ${pctS(cur.annual, 2)}（${d(base.annual, cur.annual, true, false)}）`],
        ['最大回撤', `${pctS(base.maxDd, 2)} → ${pctS(cur.maxDd, 2)}（${d(base.maxDd, cur.maxDd, true, true)}，红=回撤变小）`],
        ['夏普', `${numS(base.sharpe)} → ${numS(cur.sharpe)}（${d(base.sharpe, cur.sharpe, false, false)}）`],
        ['空仓占比', `${pctS(base.emptyRatio, 1)} → ${pctS(cur.emptyRatio, 1)}`],
      ]))
      + dwSection('口径自检', dwKv([
        ['情绪分口径偏差', `${m.weightDrift ?? '—'}（页面权重重算 vs 存档总分，来自四舍五入）`],
        ['口径备注', esc(m.caveat || '—')],
      ]))
      + `<div class="dw-note">本面板用于管线自检与参数对比，<b>不构成投资建议</b>；样本仅 ${m.days || 0} 个交易日，年化/夏普不具统计意义。</div>`,
  };
}

// ── ③ 权重组合详情（帕累托表行）──
function weightDetail(i) {
  const rows = BT?.pareto?.rows || [];
  const r = rows[i];
  if (!r) return null;
  const bt = BT?.params?.v52 || {};
  const base = BT?.rolling?.base?.segments?.[0]?.w || null;   // 固定权重口径即基准权重
  const best = BT?.best || null;
  const isBest = !!(best && r.sharpe === best.sharpe && r.maxDd === best.maxDd);

  const wRows = Object.entries(r.w || {}).map(([k, v]) => {
    const b = base?.[k];
    const gap = (b == null) ? '' : `<span class="${v > b ? 'hl' : v < b ? 'hl-dn' : 'muted'}">${v > b ? '+' : ''}${((v - b) * 100).toFixed(2)}pp</span>`;
    return `<tr><td>${esc(FACTOR_LAB[k] || k)}</td><td class="num">${(v * 100).toFixed(2)}%</td><td class="num">${b == null ? '—' : (b * 100).toFixed(2) + '%'}</td><td class="num">${gap || '—'}</td></tr>`;
  }).join('');

  const perf = [
    ['夏普比率', numS(r.sharpe), r.sharpe >= 1 ? '好（>1）' : r.sharpe > 0 ? '一般（0~1）' : '为负——该组合在本样本不赚钱'],
    ['最大回撤', pctS(r.maxDd, 2), '越小越好'],
    ['Calmar', numS(r.calmar), '年化 ÷ 最大回撤'],
    ['年化收益', pctS(r.annual, 2), '按 242 交易日年化'],
    ['区间总收益', pctS(r.total, 2), '样本区间累计'],
    ['持仓日胜率', pctS(r.winRate, 1), '有仓位日里上涨占比'],
    ['空仓占比', pctS(r.emptyRatio, 1), '被阈值判为清仓的天数占比'],
  ].map(([k, v, note]) => `<div class="k">${esc(k)}</div><div class="v"><b>${esc(v)}</b> <span class="muted">${esc(note)}</span></div>`).join('');

  return {
    title: `权重组合 #${i + 1}`,
    sub: `夏普 ${numS(r.sharpe)} · 最大回撤 ${pctS(r.maxDd, 2)} · ${r.np ? '位于帕累托前沿（非支配）' : '被支配（有组合在夏普与回撤上均不差）'}`
      + (isBest ? ' · 同时是最优解' : ''),
    body: dwSection('7 因子权重（与基准权重对比）',
      `<table class="dw-tb"><thead><tr><th>因子</th><th class="num">本组合</th><th class="num">基准</th><th class="num">差异</th></tr></thead><tbody>${wRows}</tbody></table>`
      + `<div class="dw-note">权重均为归一化后的占比；基准＝固定权重口径（= src/config.js 权重）。</div>`)
      + dwSection('绩效明细', `<div class="dw-kv">${perf}</div>`)
      + dwSection('该组合的实盘约束（全部网格共用）', dwKv([
        ['止损', pctS(bt.stopLoss, 0) || '—'],
        ['回撤降仓', `≥${pctS(bt.ddTrigger, 0) || '—'} 压至 40%`],
        ['单日仓位变动', `≤ ${numS(bt.maxPosChg, 2)}`],
      ]))
      + '<div class="dw-note">样本仅 32 个交易日，年化/夏普的统计意义有限，仅用于管线自检与参数对比，不构成投资建议。</div>',
  };
}

// ── ④ 滚动分段详情 ──
function segDetail(kind, i) {
  const R = BT?.rolling || {};
  const seg = (R[kind]?.segments || [])[i];
  if (!seg) return null;
  const other = (R[kind === 'base' ? 'refit' : 'base']?.segments || [])[i] || null;
  const wRows = Object.entries(seg.w || {}).map(([k, v]) => {
    const o = other?.w?.[k];
    const gap = o == null ? '' : `<span class="${v > o ? 'hl' : v < o ? 'hl-dn' : 'muted'}">${v > o ? '+' : ''}${((v - o) * 100).toFixed(2)}pp</span>`;
    return `<tr><td>${esc(FACTOR_LAB[k] || k)}</td><td class="num">${(v * 100).toFixed(2)}%</td><td class="num">${o == null ? '—' : (o * 100).toFixed(2) + '%'}</td><td class="num">${gap || '—'}</td></tr>`;
  }).join('');

  return {
    title: `滚动段 ${seg.testStart} ~ ${seg.testEnd}`,
    sub: `${kind === 'base' ? '固定权重' : '逐窗重寻优'}口径 · 训练窗 ${seg.trainDays} 日 / 测试窗 ${seg.testDays} 日 · 总收益 ${pctS(seg.total, 2)}`,
    body: dwSection('该段绩效', dwKv([
      ['测试区间', esc(`${seg.testStart} ~ ${seg.testEnd}`)],
      ['训练窗 / 测试窗', `${seg.trainDays} / ${seg.testDays} 日`],
      ['区间总收益', `<span class="${trendCls(seg.total)}">${pctS(seg.total, 2)}</span>`],
      ['夏普（段内）', numS(seg.sharpe)],
      ['最大回撤（段内）', pctS(seg.maxDd, 2)],
    ]))
      + dwSection('该段权重（与另一口径对比）',
        `<table class="dw-tb"><thead><tr><th>因子</th><th class="num">${kind === 'base' ? '固定' : '重寻优'}</th><th class="num">${kind === 'base' ? '重寻优' : '固定'}</th><th class="num">差异</th></tr></thead><tbody>${wRows}</tbody></table>`
        + `<div class="dw-note">「重寻优」用该段训练窗重新做网格寻优后再评测试窗；固定口径全程用基准权重。两者若一致，说明该段重寻优没有换权重。</div>`)
      + '<div class="dw-note">段内夏普波动极大（2 段样本），单段结果不具统计意义，仅供观察管线行为。</div>',
  };
}

// ── ⑤ 交易日详情（趋势图数据点）──
function dayDetail(i) {
  const days = ARC?.all_days || [];
  const d = days[i];
  if (!d) return null;
  const s = d.summary || {};
  const e = d.emotion || {};
  const up = s.up_count, dn = s.down_count;
  const redPct = (up != null && dn != null && up + dn > 0) ? (up / (up + dn) * 100) : null;
  const idx = d.indexes || {};
  const th = d.themes || {};
  const top = Object.entries(th).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const tier = posTier(e.value, getThresholds());
  // 历史档的 summary 并非每天都完整（如 9-08 无涨跌家数/领涨行业）——如实说明，避免用户把「—」读成「当日为零」
  const miss = [];
  if (up == null || dn == null) miss.push('涨跌家数');
  if (s.amount_yi == null) miss.push('两市成交额');
  if (!s.top_industry) miss.push('领涨行业');

  return {
    title: `${d.trade_date} 盘面`,
    sub: `情绪分 ${nf(e.value)}（分位 ${nf(e.pct_rank)}%）${tier ? ` · 档位 ${tier.label}` : ''} · 当日龙虎净买 ${nf(s.lhb_daily_net)} 亿`,
    body: dwSection('情绪与档位', dwKv([
      ['情绪分', `<b>${nf(e.value)}</b>${e.pct_rank != null ? `（历史分位 ${e.pct_rank}%）` : ''}`],
      ['仓位档位', tier ? `<b>${esc(tier.label)}</b> → ${esc(tier.pos)}` : '—'],
      ['因子缺失', (e.missing || []).length ? `<span class="bf-warn">${esc(e.missing.join('、'))}</span>` : '无'],
    ]))
      + dwSection('涨跌与量能', dwKv([
        ['涨停 / 跌停', `${nf(s.zt_count)} / ${nf(s.dt_count)}`],
        ['炸板率', s.zbl_pct != null ? `${s.zbl_pct}%` : '—'],
        ['连板高标', s.max_lb != null ? `${s.max_lb} 板（2 板以上 ${nf(s.lb2_count)} 只）` : '—'],
        ['涨跌家数', up != null ? `${up} / ${dn}（红盘 ${redPct != null ? redPct.toFixed(0) + '%' : '—'}）` : '—'],
        ['两市成交额', s.amount_yi != null ? `${s.amount_yi} 亿` : '—'],
        // 两套口径都列出并标明用途：只显示一个数就是「读者无从判断口径」，混用往往就是这么发生的
        ['龙虎榜·当日榜', `上榜 ${nf(s.lhb_daily_stocks)} 只 · 净买 ${nf(s.lhb_daily_net)} 亿 · 成交 ${nf(s.lhb_daily_amt)} 亿（日度因子/净买率/新股扰动用此口径）`],
        ['龙虎榜·全量', `上榜 ${nf(s.lhb_stocks ?? s.lhb_count)} 只 · 净买 ${nf(s.lhb_all_net)} 亿（含 ${nf(s.lhb_range_count)} 条区间累计榜，仅诊断，勿与当日值混用）`],
        ['领涨行业', esc(s.top_industry || '—')],
      ]))
      + dwSection('指数表现', dwKv(Object.entries(idx).map(([k, v]) => [k, `<span class="${trendCls(v)}">${pctOf2(v)}</span>`])))
      + dwSection('当日题材（前 6）', top.length
        ? `<div class="dw-chips">${top.map(([t, c]) => `<span class="chip click" data-act="theme" data-theme="${esc(t)}" tabindex="0">${esc(t)} ${c}</span>`).join('')}</div>`
        : '<div class="dw-empty">无题材数据</div>')
      + (miss.length ? `<div class="dw-note">⚠ 该日存档缺 ${esc(miss.join('、'))}（历史档未回填），上方对应项显示为 —，不代表当日为零。</div>` : '')
      + '<div class="dw-note">该日数据来自存档 all_days；情绪分与档位口径同页面与回测引擎。</div>',
  };
}

// ── 事件委托：一处处理全部点击/键盘，避免逐元素绑定 ──
function fireAct(el) {
  const act = el.dataset.act;
  if (act === 'stock') openDrawer(stockDetail(el.dataset.code));
  else if (act === 'theme') openDrawer(themeDetail(el.dataset.theme));
  else if (act === 'wrow') { const v = weightDetail(+el.dataset.i); if (v) openDrawer(v); }
  else if (act === 'seg') { const v = segDetail(el.dataset.kind, +el.dataset.i); if (v) openDrawer(v); }
  else if (act === 'day') { const v = dayDetail(+el.dataset.i); if (v) openDrawer(v); }
  else if (act === 'btmore') { const v = btDetail(); if (v) openDrawer(v); }
  else if (act === 'glob') { const v = globalDetail(el.dataset.key); if (v) openDrawer(v); }
  else if (act === 'gmap') { const v = globalMapDetail(el.dataset.from); if (v) openDrawer(v); }
  else if (act === 'btpt') {
    const dt = el.dataset.d;
    const days = ARC?.all_days || [];
    const i = days.findIndex((x) => x.trade_date === dt);
    const v = i >= 0 ? dayDetail(i) : null;
    if (v) openDrawer({ ...v, sub: `净值曲线数据点 · ${v.sub}` });
    else openDrawer({
      title: dt || '未知日期',
      sub: '净值曲线数据点',
      body: '<div class="dw-empty">该日期不在当前存档 all_days 中（回测档与存档可能不同步，重跑 <b>node scripts/backtest.mjs</b> 即可对齐）。</div>',
    });
  }
  else if (act === 'brsec') {
    const sec = document.getElementById(el.dataset.t);
    if (sec) {
      sec.classList.remove('collapsed');
      if (typeof sec.scrollIntoView === 'function') sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  } else if (act === 'dback') {
    const prev = dwStack.pop();
    if (prev) renderDrawer(prev);
  } else if (act === 'bftoggle') {
    const sec = el.parentElement;
    if (sec && sec.classList.contains('bf-sec')) {
      sec.classList.toggle('collapsed');
      el.setAttribute('aria-expanded', sec.classList.contains('collapsed') ? 'false' : 'true');
    }
    syncBriefToggleLabel();
  }
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;

  const viewBtn = t.closest('#hotTabs button');
  if (viewBtn) { setHotView(viewBtn.dataset.view); return; }

  const th = t.closest('th[data-sort]');
  if (th) {
    const k = th.dataset.sort;
    HOT_STATE = { ...HOT_STATE, key: k, dir: HOT_STATE.key === k ? -HOT_STATE.dir : -1 };
    renderHotTable();
    return;
  }

  const zn = t.closest('.zn[data-zone]');
  if (zn) {
    const z = document.getElementById(zn.dataset.zone);
    if (z && typeof z.scrollIntoView === 'function') z.scrollIntoView({ block: 'start', behavior: 'smooth' });
    e.preventDefault();
    return;
  }

  const actEl = t.closest('[data-act]');
  if (actEl) fireAct(actEl);
});

// 抽屉自身：关闭按钮 / 遮罩
$('dwClose')?.addEventListener('click', closeDrawer);
$('drawerMask')?.addEventListener('click', closeDrawer);

// 键盘：Esc 关抽屉；Enter/Space 触发带 tabindex 的可点元素（表格行、卡片、chip、数据点）；
// PC 端另有快捷键：1-6 跳分区、/ 聚焦个股搜索（在输入框内不抢键，不影响正常打字）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeDrawer(); closeExportMenu(); return; }
  const t = e.target;
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const zones = [...document.querySelectorAll('#zoneNav .zn[data-zone]')];
    // 数字键与分区一一对应（顺序即导航顺序），不写死上界——加分区时快捷键自动跟上
    const n = e.key >= '1' && e.key <= '9' ? Number(e.key) - 1 : -1;
    if (n >= 0 && zones[n]) { e.preventDefault(); zones[n].click(); return; }
    if (e.key === '/') {
      const inp = $('hotSearch');
      if (inp) {
        e.preventDefault();
        const z = document.getElementById('zone-detail');
        if (z && typeof z.scrollIntoView === 'function') z.scrollIntoView({ block: 'start', behavior: 'smooth' });
        inp.focus();
        return;
      }
    }
  }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (!t || typeof t.closest !== 'function') return;
  const el = t.closest('[data-act]');
  if (el && typeof el.click === 'function') { e.preventDefault(); el.click(); }
});

// 个股表搜索（本地筛选，防抖 150ms；不请求网络）
let searchTimer = null;
$('hotSearch')?.addEventListener('input', (e) => {
  const v = e.target.value || '';
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { HOT_STATE = { ...HOT_STATE, q: v }; renderHotTable(); }, 150);
});

// 窄屏排序控件（卡片模式没有表头可点，改由此处的下拉 + 方向钮排序，与表头共用 HOT_STATE）
$('hotSortSel')?.addEventListener('change', (e) => {
  HOT_STATE = { ...HOT_STATE, key: e.target.value, dir: -1 };
  renderHotTable();
});
$('hotSortDir')?.addEventListener('click', () => {
  HOT_STATE = { ...HOT_STATE, dir: -HOT_STATE.dir };
  renderHotTable();
});

// 报告：一键折叠/展开（逐段折叠由 document 委托的 bftoggle 处理，两处不重复绑定）
$('briefToggle')?.addEventListener('click', () => {
  const secs = [...document.querySelectorAll('#briefBody .bf-sec')];
  const anyOpen = secs.some((s) => !s.classList.contains('collapsed'));
  for (const s of secs) {
    s.classList.toggle('collapsed', anyOpen);
    const h = s.querySelector('.bf-h');
    if (h) h.setAttribute('aria-expanded', anyOpen ? 'false' : 'true');
  }
  syncBriefToggleLabel();
});

// ── 报告：复制全文 / 导出文档 / 打印 ──
// 三者都消费同一份东西——**屏幕上已经渲染出来的报告 DOM**（#briefBody）。
// 刻意不重新计算任何指标：若导出另写一套字符串拼接，数字与口径迟早和屏幕漂移，
// 用户就会发现"看到的"和"导出的"对不上。这里只做格式转换（引擎见 src/report.js）。

/** 导出引擎由 index.html 的模块脚本挂到 window（app.js 是经典脚本，不能 import） */
const RPT = () => window.ReportExport || null;

/** 引擎尚未挂载时提示，而不是静默失败 */
function needRpt() {
  const r = RPT();
  if (!r) { alert('导出引擎尚未就绪（页面可能被离线打开）。请刷新后重试。'); return null; }
  return r;
}

function currentReport() {
  const r = RPT();
  if (!r) return null;
  return r.parseReport($('briefBody'));
}

/** 导出的落款信息统一在这里取，三处输出保持一致 */
function reportOpts() {
  const d = (ARC && ARC.all_days && ARC.all_days[ARC.all_days.length - 1]) || {};
  const dataDate = (ARC && ARC.meta && ARC.meta.tradeDate) || d.trade_date || '';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return { dataDate, generatedAt, url: location.origin + location.pathname };
}

/** 下载一个文本文件（与 paper_ui.js 的账本导出同一套做法） */
function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** 按钮反馈：短暂把按钮文案换成结果提示（比 alert 轻，不打断阅读） */
function flashBtn(btn, text, ms = 1600) {
  if (!btn) return;
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = btn.dataset.label; btn.disabled = false; }, ms);
}

/** 复制全文：优先 Clipboard API；不可用（非 https / 旧浏览器）回退 execCommand */
async function doCopyBrief(btn) {
  const R = needRpt();
  if (!R) return;
  const rep = currentReport();
  if (!rep || !rep.sections.length) { flashBtn(btn, '报告未就绪'); return; }
  const text = R.toPlainText(rep, reportOpts());
  const ok = await copyToClipboard(text);
  flashBtn(btn, ok ? '已复制 ✓' : '复制失败');
}

/** 剪贴板：navigator.clipboard 在 http/localhost 之外不可用，必须有兜底 */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 落到下面的兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

/** 导出文档：html（正式可打印）/ md（知识库）/ txt（邮件记事本） */
function doExportBrief(fmt, btn) {
  const R = needRpt();
  if (!R) return;
  const rep = currentReport();
  if (!rep || !rep.sections.length) { flashBtn(btn, '报告未就绪'); return; }
  const o = reportOpts();
  if (fmt === 'md') {
    downloadText(R.toMarkdown(rep, o), R.reportFileName(o.dataDate, 'md'), 'text/markdown');
    flashBtn(btn, '已导出 MD ✓');
  } else if (fmt === 'txt') {
    downloadText(R.toPlainText(rep, o), R.reportFileName(o.dataDate, 'txt'), 'text/plain');
    flashBtn(btn, '已导出 TXT ✓');
  } else {
    downloadText(R.toStandaloneHtml(rep, o), R.reportFileName(o.dataDate, 'html'), 'text/html');
    flashBtn(btn, '已导出文档 ✓');
  }
}

/**
 * 打印：走独立打印窗口而不是给当前页加 @media print。
 * 原因：本页是深色看板、且报告只是六个分区之一——直接打印整页要么打印出一堆用不上的卡片，
 * 要么得写一大段 print 样式去逐块隐藏。而导出引擎已经能产出**自包含的正式文档 HTML**，
 * 把它塞进隐藏 iframe 打印，版式就是「导出文档」那一版，与用户下载到的完全一致。
 */
function doPrintBrief(btn) {
  const R = needRpt();
  if (!R) return;
  const rep = currentReport();
  if (!rep || !rep.sections.length) { flashBtn(btn, '报告未就绪'); return; }
  const html = R.toStandaloneHtml(rep, reportOpts());

  const old = $('briefPrintFrame');
  if (old) old.remove();
  const frame = document.createElement('iframe');
  frame.id = 'briefPrintFrame';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);

  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) { flashBtn(btn, '打印不可用'); frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();

  // 等 iframe 里的文档解析完再打印；打印结束后清理（onload 在 write 后可能不触发，故双保险）
  const go = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (e) {
      flashBtn(btn, '打印被拦截');
    }
    // 打印对话框是阻塞的，这里通常在用户关闭后才执行到
    setTimeout(() => frame.remove(), 60000);
  };
  if (doc.readyState === 'complete') setTimeout(go, 60);
  else frame.addEventListener('load', () => setTimeout(go, 60), { once: true });
}

/** 导出菜单开合：点按钮切换、点菜单项执行并收起、点外面也收起 */
function closeExportMenu() {
  const m = $('briefExportMenu'), b = $('briefExport');
  if (m) m.hidden = true;
  if (b) b.setAttribute('aria-expanded', 'false');
}

$('briefCopy')?.addEventListener('click', (e) => doCopyBrief(e.currentTarget));
$('briefPrint')?.addEventListener('click', (e) => doPrintBrief(e.currentTarget));

$('briefExport')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const m = $('briefExportMenu');
  if (!m) return;
  m.hidden = !m.hidden;
  e.currentTarget.setAttribute('aria-expanded', m.hidden ? 'false' : 'true');
});
$('briefExportMenu')?.addEventListener('click', (e) => {
  const item = e.target.closest('button[data-fmt]');
  if (!item) return;
  e.stopPropagation();
  closeExportMenu();
  doExportBrief(item.dataset.fmt, $('briefExport'));
});
// 点页面其他地方收起导出菜单（Esc 由主键盘处理器统一处理，见下方 closeDrawer 之前）
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.bf-exp')) closeExportMenu();
});

// 分区导航高亮 + 回到顶部（滚动节流：只在帧间计算一次）
let rafPending = false;
function onScroll() {
  if (rafPending) return;
  rafPending = true;
  const run = () => {
    rafPending = false;
    const y = window.scrollY || window.pageYOffset || 0;
    $('toTop')?.classList.toggle('show', y > 420);
    const zones = [...document.querySelectorAll('.zone')];
    let cur = zones[0]?.id || '';
    for (const z of zones) {
      if (z.getBoundingClientRect) {
        const top = z.getBoundingClientRect().top || 0;
        if (top <= 70) cur = z.id;
      }
    }
    for (const a of document.querySelectorAll('#zoneNav .zn[data-zone]')) {
      a.classList.toggle('on', a.dataset.zone === cur);
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}
window.addEventListener('scroll', onScroll, { passive: true });
$('toTop')?.addEventListener('click', () => {
  if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
});
