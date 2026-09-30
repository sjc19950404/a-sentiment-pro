// 前端：读取 data/archive.json 并渲染（纯 vanilla，无构建步骤）
const $ = (id) => document.getElementById(id);

function scoreClass(v) {
  if (v < 40) return 'low';
  if (v < 60) return 'mid';
  return 'high';
}

function renderAlerts(meta) {
  const box = $('alerts');
  box.innerHTML = '';
  const msgs = [];
  // 整体滞后：pipeline 走了回退档（数据非最新成功抓取）。原因优先用机器写入的 fallbackReason。
  if (meta.stale) {
    let t = '数据滞后：当前展示的是上次成功抓取的数据，非最新交易日结果。';
    if (meta.fallbackReason) t += ` 回退原因：${meta.fallbackReason}。`;
    else if (meta.note) t += ` ${meta.note}。`;
    msgs.push({ cls: 'alert', icon: '⚠', text: t });
  } else if (meta.note) {
    // 数据本身是最新的，只是个别字段有人工/离线修补 → 提示而非告警
    msgs.push({ cls: 'alert info', icon: 'ℹ', text: `数据说明：${meta.note}。` });
  }
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
  $('emNet').textContent = e.net_total_yi != null ? `龙虎榜净买 ${e.net_total_yi} 亿` : '';

  const fac = e.factors || e; // 七因子可能直接挂在 emotion 根上
  const names = { s_net: '龙虎榜', s_pos: '涨跌家', s_brd: '行业涨', s_hot: '涨停', s_zdt: '涨跌停', s_zbl: '封板', s_amt: '量能' };
  const wrap = $('factors');
  wrap.innerHTML = '';
  for (const [k, label] of Object.entries(names)) {
    const v = fac[k];
    if (v == null) continue;
    const row = document.createElement('div');
    row.className = 'factor';
    row.innerHTML = `<span class="label">${label}</span><span class="bar"><i style="width:${v}%"></i></span><span class="val">${v}</span>`;
    wrap.appendChild(row);
  }
}

function chips(list, attr) {
  const wrap = $(attr);
  wrap.innerHTML = '';
  (list || []).forEach((t) => {
    const label = typeof t === 'string' ? t : (t.theme || t.name || '');
    if (!label) return;
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = label;
    wrap.appendChild(c);
  });
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
  const vals = days.map((d) => d.emotion?.value ?? d.emotion?.score ?? 50).slice(-15);
  const W = 300, H = 90, pad = 6;
  const min = Math.min(...vals, 0), max = Math.max(...vals, 100);
  const x = (i) => pad + (i * (W - 2 * pad)) / (vals.length - 1 || 1);
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  let pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  svg.innerHTML = `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"></line><polyline points="${pts}"></polyline>`;
}

function renderThemes(latest) {
  const wrap = $('themeBars');
  wrap.innerHTML = '';
  const themes = latest.themes || {};
  const entries = Object.entries(themes).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const max = entries.length ? entries[0][1] : 1;
  for (const [name, cnt] of entries) {
    const row = document.createElement('div');
    row.className = 'tb';
    row.innerHTML = `<span class="name">${name}</span><span class="bar"><i style="width:${(cnt / max) * 100}%"></i></span><span class="cnt">${cnt}</span>`;
    wrap.appendChild(row);
  }
}

function renderHot(latest) {
  const tb = $('hotTable').querySelector('tbody');
  tb.innerHTML = '';
  (latest.hot || []).slice(0, 60).forEach((h) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${h.code}</td><td>${h.name || ''}</td><td class="muted">${h.reason || ''}</td>`;
    tb.appendChild(tr);
  });
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
  const seg = (h, b) => `<div class="bf-sec"><div class="bf-h">${h}</div>${b}</div>`;
  const li = (t) => `<div class="bf-li">${t}</div>`;
  const num = (v, fix = 1) => (v == null || !Number.isFinite(+v)) ? '—' : (+v).toFixed(fix);
  const arrow = (cur, pre) => (cur == null || pre == null) ? '' :
    (cur > pre ? `<span class="bf-up">↑${num(cur - pre)}</span>` : cur < pre ? `<span class="bf-dn">↓${num(pre - cur)}</span>` : '持平');

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
  const nets = last5.map((x) => x.summary?.net_total_yi).filter((x) => x != null);
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
  // 体量/净买率：净额必须对照上榜成交额看强度
  const lhbRows = d.lhb || [];
  const totAmt = lhbRows.reduce((a, l) => a + (l.buy_wan || 0) + (l.sell_wan || 0), 0) / 1e4;
  const curNet = nets[nets.length - 1];
  const nbRate = (totAmt > 0 && curNet != null) ? curNet / totAmt * 100 : null;
  let rateTxt = '';
  if (nbRate != null) {
    const ab = Math.abs(nbRate);
    rateTxt = ab >= 8 ? '强进攻' : ab >= 4 ? '中等力度' : '脉冲级，可信度低';
  }
  // 3日滚动净额（与5日并行，抓资金转向拐点）
  const roll3Sum = nets.slice(-3).reduce((a, b) => a + b, 0);
  // 新股/独立标的识别与扰动过滤（诱因=无价格涨跌幅限制，上市5日内）
  const aggr = d.lhb_aggr || [];
  const newStocks = aggr.filter(isNewStock);
  const totNetAggr = aggr.reduce((a, l) => a + (l.net_buy_wan || 0), 0) / 1e4;
  const newNet = newStocks.reduce((a, l) => a + (l.net_buy_wan || 0), 0) / 1e4;
  const mainNet = totNetAggr - newNet;
  const disturb = curNet != null && curNet > 0 && totNetAggr > 0 && (newNet / totNetAggr) * 100 > 25;
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
    li(`近5日净买（亿）: ${netTxt}`),
    totAmt > 0 ? li(`上榜总成交 ${num(totAmt, 0)} 亿，净买率 <b>${num(nbRate, 1)}%</b>（${rateTxt}）；近3日滚动净买 ${roll3Sum >= 0 ? '+' : ''}${num(roll3Sum)} 亿`) : '',
    netVerdict ? li(netVerdict + `（结构 ${s.net_pos ?? '—'} 买 / ${s.net_neg ?? '—'} 卖）`) : '',
    (newStocks.length && totNetAggr > 0) ? li(`新股/独立标的（${newStocks.map((l) => l.name).join('、')}）净买 +${num(newNet, 2)} 亿，占当日净买 ${(newNet / totNetAggr * 100).toFixed(0)}%${disturb ? '，<span class="bf-warn">超 25% 扰动线——主线资金强度需剔除观察</span>' : ''}；剔除后主线净买 ${mainNet >= 0 ? '+' : ''}${num(mainNet, 2)} 亿`) : '',
    newStocks.length ? li(`<span class="bf-warn">⚠ 备注：总龙虎榜净额含新股${newStocks.map((l) => l.name).join('、')}，主线资金需剔除该标的单独评估，规避净额虚高误判</span>`) : '',
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
  if (ev.includes('情绪与分位双高') && ev.includes('龙虎榜资金进场')) verdict = '情绪高潮 + 资金进场共振，但高位区追高性价比低，持仓者让利润奔跑、空仓者等分歧低吸。';
  else if (ev.includes('情绪与分位双高')) verdict = '情绪过热区，兑现压力大于进攻价值，勿在新高追涨。';
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
  // V5 风险五档：高分=强市（80+ 反而要防过热见顶）
  const riskTxt = total == null ? '' :
    total >= 80 ? '极低风险（情绪过热）——高潮抱团，高位加速，警惕见顶' :
    total >= 65 ? '低风险——行情强势，主线清晰，适合做主线' :
    total >= 45 ? '中等风险——震荡分歧，结构性行情，控仓操作' :
    total >= 25 ? '高风险——亏钱效应扩散，主线弱化，降低仓位' :
    '极高风险——情绪冰点，大面积杀跌，空仓/轻仓防御';
  const weak = mods.filter((m) => m[2] < 60).map((m) => m[0]);
  const auxWarn = (disturb || divs.length) ? '；辅助资金面存在' + [disturb ? '新股扰动' : '', divs.length ? '量价背离' : ''].filter(Boolean).join('与') + '信号，热度分未计入' : '';
  const riskHint = (weak.length ? `短板在${weak.join('与')}，注意对应风险` : '五大因子均衡，无明显短板') + auxWarn;
  const scoreLine = total != null ? li(`综合风险评分（V5）: 情绪定位 ${scE} · 盈亏效应 ${scP} · 广度量能 ${scB} · 题材结构 ${scT} · 主线结构 ${scM} → 总分 <b>${total}</b>，${riskTxt}。<span class="bf-warn">${riskHint}</span>`) : '';
  const sec6 = li(`<b>${verdict}</b>`) + scoreLine +
    (watch.length ? `<div class="bf-h bf-h2">明日观测（引擎动态生成）</div>` + watch.map((w) => li('· ' + w)).join('') : '');

  const foot = `<div class="bf-foot">口径备注：涨跌家数为沪深两市（不含北交所）；净买为龙虎榜去重个股级口径；新股/独立标的=上市首5日无涨跌幅限制个股，其净买单独列示不计入主线；买方头部3席位集中度=全市场前3席位买入÷全部买方买入；锁仓统计=当日买方席位与近2日同票买方席位比对，未重复出现计为新进，样本为有席位明细的连续上榜股；主线题材龙虎资金占比=主线题材个股龙虎净买÷全榜单龙虎净买；综合风险评分采用 V5 加权模型：情绪定位25%、盈亏效应25%、广度量能20%、题材结构20%、主线板块内部结构10%（主线结构用热点榜主线成分票的涨停梯队/龙头强度/内部红盘率/分化度代理，板块成交额占比暂无数据源），0~100分，分数越高市场越热越强，80+警惕过热见顶；资金面（龙虎榜）为辅助观测，不参与打分；席位数据来自东财买卖榜明细（榜上席位口径），覆盖不足100%时拆分为部分样本。本报告由规则引擎根据当档数据自动生成，非投资建议。</div>`;

  return seg('① 情绪定位（核心因子·25%）', sec1) + seg('② 资金面（龙虎榜）· 辅助B 北向+机构行为（不参与打分）', sec2) +
    seg('③ 盈亏效应（核心因子·25%）', sec3) + seg('④ 广度与量能（核心因子·20%）', sec4) +
    seg('⑤ 题材结构（核心因子·20%）', sec5) + seg('⑥ 综合研判', sec6) + foot;
}

function renderBrief(days, arc) {
  $('briefBody').innerHTML = buildBrief(days, arc);
}

// ── V5.2 策略回测面板：读 data/backtest.json（由 node scripts/backtest.mjs 预生成）──
// 数据文件缺失时只在卡片内提示，不影响其余区块渲染。
const pctS = (v, d = 2) => (v == null || !Number.isFinite(+v)) ? '—' : (+v * 100).toFixed(d) + '%';
const numS = (v, d = 2) => (v == null || !Number.isFinite(+v)) ? '—' : (+v).toFixed(d);

function drawNav(svg, series) {
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
  svg.innerHTML = out;
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
  drawNav($('btNavSvg'), series);
  $('btLegend').innerHTML = series.map((x) => `<span><i style="background:${x.color}"></i>${x.name}</span>`).join('')
    + `<span>样本 ${m.days || 0} 个交易日（${(s.dates || [])[0] || '—'} ~ ${(s.dates || []).slice(-1)[0] || '—'}）</span>`;

  $('btParams').innerHTML = [
    `信号：${m.signal || '—'}`,
    `标的：${(m.assets || []).join(' / ')}（各自独立按同规则回测 → 日收益等权合成组合）`,
    `成本：${m.costNote || '—'}`,
    `风控：最大仓位 ${numS(v52.maxPos, 2)}｜单笔止损 ${pctS(v52.stopLoss, 0) || '—'}｜回撤降仓触发 ${pctS(v52.ddTrigger, 0) || '—'}｜单日仓位变动 ≤ ${numS(v52.maxPosChg, 2)}`,
    `阈值：过热 ${numS(P.thresholds?.overheat, 0)} / 开仓 ${numS(P.thresholds?.lo, 0)} / 减仓 ${numS(P.thresholds?.hi, 0)} / 清仓 ${numS(P.thresholds?.panic, 0)}（收盘打分，T+1 生效）`,
  ].join('<br>');
  $('btNote').textContent = `口径备注：${m.caveat || ''}（情绪分口径自检偏差 ${m.weightDrift ?? '—'}，来自存档因子/总分的四舍五入）`;

  const p = bt.pareto || {};
  $('paretoSummary').textContent = `扫描 ${p.scanned || 0} 组权重 · 去重后 ${p.uniqueCount || 0} 个不同结果 · 非支配解 ${p.count ?? '—'} 个。${p.note || ''}`;
  const ptb = $('paretoTable').querySelector('tbody');
  ptb.innerHTML = '';
  (p.rows || []).forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${numS(r.sharpe)}</td><td>${pctS(r.maxDd, 2)}</td><td>${numS(r.calmar)}</td>`
      + `<td>${pctS(r.annual, 2)}</td><td class="${r.np ? 'np-yes' : 'muted'}">${r.np ? '✓ 前沿' : '—'}</td>`;
    ptb.appendChild(tr);
  });

  const R = bt.rolling || {};
  const line = (label, x) => `${label}：夏普均值 ${numS(x?.sharpeMean)}｜最差段回撤 ${pctS(x?.ddWorst, 2)}｜正收益段 ${pctS(x?.winSegPct, 0)}`;
  $('rollSummary').innerHTML = `${line('固定权重', R.base)}<br>${line('逐窗重寻优', R.refit)}`
    + (R.refitChangedSegments != null ? `<br>重寻优实际换权重的段：${R.refitChangedSegments}/${(R.refit?.segments || []).length}` : '');
  const rtb = $('rollTable').querySelector('tbody');
  rtb.innerHTML = '';
  [['固定', R.base], ['重寻优', R.refit]].forEach(([label, x]) => {
    (x?.segments || []).forEach((sg) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="muted">${label}</td><td>${sg.testStart} ~ ${sg.testEnd}</td>`
        + `<td>${pctS(sg.total, 2)}</td><td>${numS(sg.sharpe)}</td><td>${pctS(sg.maxDd, 2)}</td>`;
      rtb.appendChild(tr);
    });
  });
  if (!rtb.children.length) rtb.innerHTML = '<tr><td colspan="5" class="muted">样本不足，未切出滚动段</td></tr>';

  const ml = bt.mainLine || {};
  const box = $('mainLineBody');
  box.innerHTML = '';
  (ml.mains || []).forEach((mn) => {
    const head = document.createElement('div');
    head.className = 'ml-head';
    head.innerHTML = `<span class="tag2">主线题材 ${mn.theme}</span>`
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
        c.className = 'chip';
        c.innerHTML = `${st.name} <span class="${(st.changePct || 0) >= 0 ? 'bf-up' : 'bf-dn'}">${numS(st.changePct, 2)}%</span>`;
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
    renderBacktest(await res.json());
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

function renderAll(arc) {
  const days = arc.all_days || [];
  const latest = days[days.length - 1] || {};
  const meta = arc.meta || {};

  $('tradeDate').textContent = arc.signals?.tradeDate || latest.trade_date || '--';
  const tag = $('sourceTag');
  tag.textContent = meta.source === 'live' ? 'LIVE' : (meta.stale ? 'STALE' : 'DEMO');
  tag.className = 'tag ' + (meta.source === 'live' ? 'live' : meta.stale ? 'stale' : '');
  $('genTime').textContent = meta.generatedAt ? '更新 ' + meta.generatedAt.replace('T', ' ').slice(0, 16) : '';

  renderAlerts(meta);
  renderEmotion(latest);
  renderMomentum(arc.signals?.momentum || {});
  renderTrend(days);
  renderThemes(latest);
  renderHot(latest);
  renderBrief(days, arc);
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
