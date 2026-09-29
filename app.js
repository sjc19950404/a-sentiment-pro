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
  if (meta.stale) msgs.push('数据滞后（最近一次云端抓取失败，当前展示上次成功数据）。');
  if (meta.source === 'offline-replay') msgs.push('当前为离线演示数据，非实时行情。');
  for (const m of msgs) {
    const d = document.createElement('div');
    d.className = 'alert';
    d.textContent = '⚠ ' + m;
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
    v < 35 ? '冰点区' : v < 50 ? '弱势区' : v < 65 ? '中性区' : v < 80 ? '偏热区' : '高热区';
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
  const sec2 = [
    li(`近5日净买（亿）: ${netTxt}`),
    totAmt > 0 ? li(`上榜总成交 ${num(totAmt, 0)} 亿，净买率 <b>${num(nbRate, 1)}%</b>（${rateTxt}）；近3日滚动净买 ${roll3Sum >= 0 ? '+' : ''}${num(roll3Sum)} 亿`) : '',
    netVerdict ? li(netVerdict + `（结构 ${s.net_pos ?? '—'} 买 / ${s.net_neg ?? '—'} 卖）`) : '',
    (newStocks.length && totNetAggr > 0) ? li(`新股/独立标的（${newStocks.map((l) => l.name).join('、')}）净买 +${num(newNet, 2)} 亿，占当日净买 ${(newNet / totNetAggr * 100).toFixed(0)}%${disturb ? '，<span class="bf-warn">超 25% 扰动线——主线资金强度需剔除观察</span>' : ''}；剔除后主线净买 ${mainNet >= 0 ? '+' : ''}${num(mainNet, 2)} 亿`) : '',
    topBuy.length ? li('净买头部: ' + topBuy.join('、')) : '',
    divs.length ? li(`<span class="bf-warn">背离校验：${divs.join('；')}</span>`) : '',
  ].join('');

  // 3. 盈亏效应（涨跌停结构）
  const zt = s.zt_count, dt = s.dt_count, zbl = s.zbl_pct, mlb = s.max_lb;
  let pnl = '';
  if (zt != null && dt != null) {
    if (dt > zt) pnl = `跌停（${dt}）反超涨停（${zt}），亏钱效应主导`;
    else if (dt >= zt * 0.6) pnl = `跌停 ${dt} 逼近涨停 ${zt}，分歧加剧`;
    else pnl = `涨停 ${zt} / 跌停 ${dt}，赚钱效应${zt > 60 ? '活跃' : '温和'}`;
  }
  const sec3 = [
    pnl ? li(pnl + `（昨日 ${ps.zt_count ?? '—'}/${ps.dt_count ?? '—'}）`) : '',
    zbl != null ? li(`炸板率 ${zbl}%（炸板 ${s.zb_count ?? '—'}，封板率 ${Math.round(100 - zbl)}%），${zbl <= 25 ? '封板质量高，接力意愿强' : zbl <= 40 ? '分歧加大，接力需挑核心' : '炸板潮，接飞刀危险'}`) : '',
    mlb != null ? li(`连板高标 ${mlb} 板，2板以上 ${s.lb2_count ?? '—'} 只${mlb >= 5 ? '——空间标杆仍活，题材未崩' : ''}`) : '',
  ].join('');

  // 4. 广度与量能
  const up = s.up_count, dn = s.down_count, amt = s.amount_yi, pamt = ps.amount_yi;
  const sec4 = [
    (up != null && dn != null) ? li(`涨跌家数 ${up} / ${dn}（沪深口径），红盘占比 ${(up / (up + dn) * 100).toFixed(0)}%`) : '',
    s.ind_count ? li(`行业红盘 ${s.ind_up ?? '—'}/${s.ind_count}，最强 ${s.top_industry || '—'} / 最弱 ${s.bottom_industry || '—'}`) : '',
    (amt != null && pamt != null && pamt > 0) ? li(`两市成交额 ${num(amt, 0)} 亿，较前一日${amt >= pamt ? '放量' : '缩量'} ${num(Math.abs(amt - pamt), 0)} 亿，量能因子 ${f.s_amt ?? '—'}：${f.s_amt >= 60 ? '放量' : f.s_amt >= 45 ? '平量' : '缩量'}`) : '',
  ].join('');

  // 5. 题材结构
  const freshN = (mom.fresh || []).length, contN = (mom.continuing || []).length, fadeN = (mom.fading || []).length;
  const th = d.themes || {};
  const topTheme = Object.entries(th).sort((a, b) => b[1] - a[1])[0];
  let focus = '';
  if (contN && freshN) focus = contN > freshN * 1.5 ? '延续远多于新晋——资金聚焦而非轮动，主线成色足' :
    freshN > contN ? '新晋多于延续——一日游轮动快，追首板胜率低' : '新晋延续均衡——题材消化中';
  const overlap = (() => {
    if (!p.themes) return '';
    const fr = (mom.fresh || []).map((t) => (typeof t === 'string' ? t : t.theme)).filter(Boolean);
    const alive = fr.filter((t) => (p.themes[t] || 0) > 0);
    return fr.length ? `昨日新晋题材存活 ${alive.length}/${fr.length}` : '';
  })();
  const sec5 = [
    li(`新晋 ${freshN} / 延续 ${contN} / 退潮 ${fadeN}。${focus}`),
    topTheme ? li(`今日最强题材: ${topTheme[0]}（${topTheme[1]} 只涨停）`) : '',
    overlap ? li(overlap + '，' + (fadeN > freshN ? '退潮面大于新生面' : '新生面尚可')) : '',
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

  // 明日观测信号（动态）
  const watch = [];
  if (dt != null) watch.push(dt >= 40 ? `跌停能否从 ${dt} 压回 30 以内（亏钱效应是否出清）` : `跌停若回升超 ${Math.max(40, Math.round(dt * 1.5))} 则退潮未尽`);
  if (netsC.length) watch.push(`净买能否守住${netsC[netsC.length - 1] > 0 ? '正' : '零'}轴（0 亿上方）`);
  if (mlb != null) watch.push(`${mlb} 板高标能否晋级（断板无替补 = 空间坍塌）`);
  if (freshN) watch.push(`今日 ${freshN} 个新晋题材明日存活率（≥50% = 聚焦，<30% = 一日游）`);
  if (Number.isFinite(mainNet)) watch.push(`剔除新股后的主线净买（今日 ${mainNet >= 0 ? '+' : ''}${num(mainNet, 2)} 亿）能否维持正值`);
  const mainTop = aggr.filter((l) => l.net_buy_wan > 0 && !isNewStock(l)).slice(0, 2).map((l) => l.name);
  if (mainTop.length) watch.push(`头部主线标的（${mainTop.join('、')}）是否出现大额兑现`);
  const sec6 = li(`<b>${verdict}</b>`) + (watch.length ? `<div class="bf-h bf-h2">明日观测</div>` + watch.map((w) => li('· ' + w)).join('') : '');

  const foot = `<div class="bf-foot">口径备注：涨跌家数为沪深两市（不含北交所）；净买为龙虎榜去重个股级口径；新股/独立标的=上市首5日无涨跌幅限制个股，其净买单独列示不计入主线；净买率=净买/上榜总成交。本报告由规则引擎根据当档数据自动生成，非投资建议。</div>`;

  return seg('① 情绪定位', sec1) + seg('② 资金面（龙虎榜）', sec2) +
    seg('③ 盈亏效应', sec3) + seg('④ 广度与量能', sec4) +
    seg('⑤ 题材结构', sec5) + seg('⑥ 综合研判', sec6) + foot;
}

function renderBrief(days, arc) {
  $('briefBody').innerHTML = buildBrief(days, arc);
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
