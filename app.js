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

  const fac = e.factors || {};
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
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = t;
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

async function main() {
  try {
    const res = await fetch('./data/archive.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arc = await res.json();
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
  } catch (e) {
    $('alerts').innerHTML = `<div class="alert">⚠ 加载失败：${e.message}。请确认 data/archive.json 已生成并部署。</div>`;
  }
}

main();
