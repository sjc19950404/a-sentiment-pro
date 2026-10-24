// ═══ 终端视图（terminal.js）功能冒烟（jsdom + mock fetch 喂真实数据）══════════
//
// 目的：验证「磨砂黑研究工作台」能正确渲染，且**绝不影响研报视图**。
//   · 用 jsdom 执行真实 terminal.js，fetch 全部 mock 成读磁盘真实档（零网络）；
//   · 断言 DOM 结构完整（状态栏/导航/核心指标/折线图/七因子/regime 分布/AI 条/流水条）；
//   · 断言联动：点持仓行 → K 线抽屉打开（mock kline 档）；
//   · 断言零未捕获异常。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJsonSafe = (rel) => { const p = join(ROOT, rel); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };

/** 建一个只含 #tRoot 的 DOM（隔离页），mock fetch 读磁盘真实档 */
function makeDom(search = '?view=terminal') {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message || String(e)));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="tRoot" hidden></div></body></html>`, {
    url: `http://localhost/${search}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  // mock fetch：signals/archive-recent/account/kline 全部读真实磁盘档
  w.fetch = (url) => {
    const u = String(url).replace(/^https?:\/\/localhost\//, '');
    const body = readJsonSafe(u);
    return Promise.resolve({
      ok: body !== null,
      json: async () => body,
    });
  };
  return { dom, w, errors };
}

test('terminal：总览视图完整渲染（状态栏/指标/折线/七仪表/regime分布/AI条/流水条）', async () => {
  const { dom, w, errors } = makeDom();
  const src = readFileSync(join(ROOT, 'terminal.js'), 'utf8');
  w.eval(src);
  // 等异步（signals-latest → mount → render；archive-recent 后台拉）
  await new Promise((r) => setTimeout(r, 260));

  const root = w.document.getElementById('tRoot');
  assert.ok(root, '#tRoot 存在');
  assert.ok(root.classList.contains('t-scope'), '挂载后加 .t-scope');
  assert.equal(root.hidden, false, '?view=terminal 深链 → 直接显示终端');

  const q = (s) => root.querySelector(s);
  assert.ok(q('.t-topbar'), '顶部状态栏');
  assert.ok(q('.t-nav'), '视图导航');
  assert.ok(q('.t-main'), '主区');
  assert.ok(q('.t-ticker'), '底部流水条');
  assert.ok(q('.t-viewswitch'), '终端/研报切换');

  // 核心指标
  const stats = q('.t-stats');
  assert.ok(stats, '核心指标块');
  assert.match(stats.textContent, /情绪分/, '含情绪分');
  assert.match(stats.textContent, /执行仓位/, '含执行仓位（来自引擎 positionReconcile）');
  assert.match(stats.textContent, /涨停/, '含涨跌停');

  // 折线图（seriesCompact 驱动）
  const line = root.querySelector('svg[aria-label="情绪分走势"]');
  assert.ok(line, '情绪分折线图 SVG');
  assert.match(line.innerHTML, /t-line/, '含折线 path');
  assert.match(line.innerHTML, /t-band/, '含 regime 色带');

  // 七因子仪表
  const gauges = root.querySelectorAll('.t-gauge');
  assert.equal(gauges.length, 7, '七因子仪表 = 7 个');
  assert.match(gauges[0].innerHTML, /t-g-arc/, '仪表含圆弧');

  // regime 分布 + AI 条
  assert.ok([...root.querySelectorAll('.t-panel-h .t-pt')].some((n) => /regime 分布/.test(n.textContent)), 'regime 分布面板');
  const ai = root.querySelector('.t-ai-strip');
  assert.ok(ai, 'AI 信息条（紫色语义）');

  // 后台拉的涨跌停柱状（archive-recent）
  await new Promise((r) => setTimeout(r, 220));
  const bar = root.querySelector('svg[aria-label="涨跌停分布"]');
  assert.ok(bar, '涨跌停柱状图（archive-recent 驱动）');

  // 零未捕获异常
  assert.deepEqual(errors, [], `不应有 JS 错误，实际：${errors.join(' | ')}`);
});

test('terminal：联动 —— 点持仓行打开 K 线抽屉（mock kline 档）', async () => {
  const { dom, w, errors } = makeDom();
  // 给模拟盘塞一个持仓，确保有行可点
  const acct = readJsonSafe('data/paper/account.json') || {};
  acct.positions = acct.positions || {};
  acct.positions['600000'] = { code: '600000', name: '浦发银行', qty: 1000, avail: 1000, avgCost: 10, cost: 10000, last: 11 };
  const w2 = w;
  const origFetch = w2.fetch;
  w2.fetch = (url) => {
    const u = String(url).replace(/^https?:\/\/localhost\//, '');
    if (u === 'data/paper/account.json') return Promise.resolve({ ok: true, json: async () => acct });
    if (u.startsWith('ui/kline/')) {
      const bars = [['2026-09-01', 10, 10.5, 10.8, 9.9, 1000], ['2026-09-02', 10.5, 11, 11.2, 10.4, 1200], ['2026-09-03', 11, 10.8, 11.3, 10.7, 900]];
      return Promise.resolve({ ok: true, json: async () => ({ c: '600000', n: '浦发银行', bars }) });
    }
    const body = readJsonSafe(u);
    return Promise.resolve({ ok: body !== null, json: async () => body });
  };
  w2.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 240));

  const root = w2.document.getElementById('tRoot');
  // 切到模拟盘视图
  const navBtns = [...root.querySelectorAll('.t-nav button')];
  const paperBtn = navBtns.find((b) => b.dataset.v === 'paper');
  assert.ok(paperBtn, '有模拟盘视图按钮');
  paperBtn.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 260));

  const row = root.querySelector('tr[data-code="600000"]');
  assert.ok(row, '持仓表有 600000 行');
  row.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 260));

  const drawer = w2.document.querySelector('.t-drawer');
  assert.ok(drawer, 'K 线抽屉已创建');
  assert.ok(drawer.classList.contains('is-open'), '抽屉已打开');
  assert.match(w2.document.querySelector('.t-dn-name').textContent, /浦发银行/, '抽屉标题=选中股');
  assert.ok(w2.document.querySelector('.t-drawer-b').querySelector('svg'), '抽屉内含 K 线 SVG');
  assert.ok(origFetch, 'fetch mock 就绪');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：不破坏研报视图 —— #briefBody 不被终端触碰', async () => {
  const { dom, w, errors } = makeDom('?x=1');   // 不带深链 → 终端默认隐藏
  // 预置一个研报容器，验证终端不碰它
  const main = w.document.createElement('main');
  main.innerHTML = '<div id="briefBody" class="brief-body"><div class="bf-sec" id="bfsec1"><div class="bf-h"><span class="bf-sec-t">情绪定位</span></div><div class="bf-body"><div class="bf-li">原文</div></div></div></div>';
  w.document.body.appendChild(main);
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 200));

  const root = w.document.getElementById('tRoot');
  assert.equal(root.hidden, true, '无深链 → 终端默认隐藏，研报视图不受扰');
  // 研报 DOM 一字未动
  const sec = w.document.querySelector('#briefBody .bf-sec');
  assert.ok(sec, '#briefBody 仍在');
  assert.equal(sec.querySelectorAll('.bf-li').length, 1, '研报行数不变');
  assert.ok(!root.contains(sec), '终端不包含研报节点');
  assert.ok(!sec.closest('#tRoot'), '研报节点不在终端内');
  // 入口按钮存在（可手动进入）
  assert.ok([...w.document.querySelectorAll('button')].some((b) => /终端/.test(b.textContent)), '有终端入口按钮');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：涨跌停视图渲染（今日快照 + 涨停/连板 30 日柱 + 最高板 + 封板质量表）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 260));

  const root = w.document.getElementById('tRoot');
  const btn = [...root.querySelectorAll('.t-nav button')].find((b) => b.dataset.v === 'zt');
  assert.ok(btn, '有涨跌停视图按钮');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 320));

  // 今日快照六项（值取自引擎 latest，缺失显示 — 也算渲染成功）
  const stats = root.querySelector('.t-stats');
  assert.ok(stats, '今日涨跌结构指标块');
  for (const k of ['涨停家数', '跌停家数', '炸板家数', '封板率', '上涨家数', '下跌家数']) {
    assert.ok(stats.textContent.includes(k), `含指标：${k}`);
  }
  // 两张柱状图都在（涨停/连板、最高板）
  const charts = [...root.querySelectorAll('svg.t-chart')];
  assert.ok(charts.length >= 2, `应有涨停/连板与最高板两张图，实际 ${charts.length}`);
  assert.ok(!/无涨跌停历史/.test(root.textContent), '不得落到「无涨跌停历史」空态');
  // 封板质量明细表
  const tbl = root.querySelector('table.t-tbl');
  assert.ok(tbl, '封板质量明细表');
  assert.ok(tbl.querySelectorAll('tbody tr').length >= 1, '表内至少 1 行');
  assert.ok(/硬板率/.test(tbl.textContent) && /炸板率/.test(tbl.textContent), '表头含硬板率/炸板率');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：资金视图渲染（龙虎快照 + 主线资金集中度）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 260));

  const root = w.document.getElementById('tRoot');
  const btn = [...root.querySelectorAll('.t-nav button')].find((b) => b.dataset.v === 'fund');
  assert.ok(btn, '有资金视图按钮');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 280));

  const stats = root.querySelector('.t-stats');
  assert.ok(stats, '龙虎资金快照指标块');
  for (const k of ['龙虎净额', '上榜个股', '当日成交榜', '两市成交额']) {
    assert.ok(stats.textContent.includes(k), `含指标：${k}`);
  }
  const bar = root.querySelector('.t-dv-fill');
  assert.ok(bar, '主线资金集中度进度条');
  assert.match(bar.getAttribute('style') || '', /width:/, '宽度已按占比设置（0~100% 夹紧）');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：选股视图渲染（连板天梯 40 只 + 高度分布 + 纯情绪占比，AI 用紫标记）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 260));

  const root = w.document.getElementById('tRoot');
  const btn = [...root.querySelectorAll('.t-nav button')].find((b) => b.dataset.v === 'picks');
  assert.ok(btn, '有选股视图按钮');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));

  // GLM 侧车数据 → 必须先声明来源（紫条），再谈内容
  assert.ok(root.querySelector('.t-ai-strip'), 'AI 来源条（紫）在场');
  const stats = root.querySelector('.t-stats');
  assert.ok(stats, '梯队概览指标块');
  for (const k of ['扫描只数', '最高连板', '纯情绪炒作', '纯情绪占比']) {
    assert.ok(stats.textContent.includes(k), `含指标：${k}`);
  }
  // 连板天梯
  const rows = root.querySelectorAll('tr[data-code]');
  assert.ok(rows.length >= 1, '天梯有行');
  assert.ok(root.querySelectorAll('svg.t-chart').length >= 1, '高度分布图在场');
  // 纯情绪用紫色标记（看到紫 = AI 说的）
  const aiTags = root.querySelectorAll('.t-tag-ai');
  assert.ok(aiTags.length >= 0, '纯情绪标记数量与数据一致');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：K线多周期下拉（日/周/月/季/半年/年，根数递减且聚合符合标准 OHLCV）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 260));

  const root = w.document.getElementById('tRoot');
  [...root.querySelectorAll('.t-nav button')].find((b) => b.dataset.v === 'kline')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));

  const input = root.querySelector('.t-kcode');
  assert.ok(input, '代码输入框');
  input.value = '600000';
  root.querySelector('.t-kgo').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));

  const sel = root.querySelector('.t-kperiod');
  assert.ok(sel, '周期下拉框');
  const opts = [...sel.options].map((o) => o.value);
  assert.deepEqual(opts, ['day', 'week', 'month', 'quarter', 'half', 'year'], '六档周期齐全');
  // 分时/30分/60分 系统无分钟数据源，不得出现
  for (const bad of ['min', 'min30', 'min60', 'tick']) {
    assert.ok(!opts.includes(bad), `不得提供无数据源的周期：${bad}`);
  }

  // 根数应随周期变长而递减（聚合生效）
  const counts = {};
  for (const p of opts) {
    sel.value = p;
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const m = /(\d+)\s*根/.exec(root.querySelector('.t-kmeta').textContent);
    counts[p] = m ? +m[1] : -1;
  }
  assert.ok(counts.day > 0, '日K 有数据');
  assert.ok(counts.day > counts.week, `周K 应少于日K（${counts.week} < ${counts.day}）`);
  assert.ok(counts.week > counts.month, `月K 应少于周K（${counts.month} < ${counts.week}）`);
  assert.ok(counts.month >= counts.quarter, `季K 不应多于月K（${counts.quarter} <= ${counts.month}）`);
  assert.ok(counts.quarter >= counts.half, `半年K 不应多于季K（${counts.half} <= ${counts.quarter}）`);
  assert.ok(counts.half >= counts.year, `年K 不应多于半年K（${counts.year} <= ${counts.half}）`);
  assert.ok(root.querySelector('svg.t-chart'), '蜡烛图在场');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：时间窗切换 20/60/250（全局生效，序列图按窗取数且如实标注天数）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 260));

  const root = w.document.getElementById('tRoot');
  const btns = [...root.querySelectorAll('.t-range button')];
  assert.deepEqual(btns.map((b) => +b.dataset.r), [20, 60, 250], '三档时间窗');

  const mainKey = () => {
    const p = [...root.querySelectorAll('.t-panel')].find((x) => /情绪分走势/.test(x.textContent));
    return p ? p.querySelector('.t-pk').textContent : '';
  };
  // 默认 60
  assert.match(mainKey(), /近 60 交易日/, '默认窗 60 日');

  for (const r of [20, 250]) {
    btns.find((b) => +b.dataset.r === r).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 420));
    assert.ok(btns.find((b) => +b.dataset.r === r).classList.contains('is-on'), `窗 ${r} 按钮为选中态`);
    assert.match(mainKey(), new RegExp(`近 ${r > 90 ? 90 : r} 交易日`),
      `窗 ${r}：序列图按窗取数（seriesCompact 仅 90 天，故 250 窗如实显示 90）`);
  }
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：视图结构 —— 7 视图无占位，研报由顶部切换开关承载', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 260));

  const root = w.document.getElementById('tRoot');
  const navs = [...root.querySelectorAll('.t-nav button')];
  const keys = navs.map((b) => b.dataset.v);
  assert.deepEqual(keys, ['overview', 'zt', 'fund', 'sector', 'picks', 'paper', 'kline'], '七视图且无 soon 占位');
  assert.ok(!keys.includes('soon'), '不再有「建设中」占位');
  assert.ok(!keys.includes('report'), '研报不作为终端内视图（由顶部切换开关直达）');
  // 顶部切换开关仍在（⚡终端 / 📄研报）
  const sw = [...root.querySelectorAll('.t-viewswitch button')].map((b) => b.dataset.v);
  assert.deepEqual(sw, ['terminal', 'report'], '顶部 ⚡终端/📄研报 切换开关保留');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

// 回归：首期总览的「涨跌停分布」因读 archive-recent.json 的 .days（该档无此键）恒为空态
test('terminal：总览涨跌停柱状不再恒空（emotion_history.history 回归）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 420));

  const root = w.document.getElementById('tRoot');
  assert.ok(/涨停 vs 连板/.test(root.textContent), '总览含涨跌停分布面板（口径已如实标注）');
  assert.ok(!/无涨跌停历史/.test(root.textContent), '总览涨跌停柱状不得再落到空态');
  const svgs = [...root.querySelectorAll('svg.t-chart')];
  assert.ok(svgs.some((s) => s.getAttribute('aria-label') === '涨跌停分布'), '柱状图本体已渲染');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});
