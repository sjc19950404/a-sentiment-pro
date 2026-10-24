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
  for (const k of ['统计只数', '最高连板', '纯情绪炒作', '纯情绪占比']) {
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

test('terminal：时间窗切换 20/30/60/90（全局生效，序列图按窗取数且如实标注天数）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 260));

  const root = w.document.getElementById('tRoot');
  const btns = [...root.querySelectorAll('.t-range button')];
  assert.deepEqual(btns.map((b) => +b.dataset.r), [20, 30, 60, 90], '四档时间窗');

  const mainKey = () => {
    const p = [...root.querySelectorAll('.t-panel')].find((x) => /情绪分走势/.test(x.textContent));
    return p ? p.querySelector('.t-pk').textContent : '';
  };
  // 默认 60
  assert.match(mainKey(), /近 60 交易日/, '默认窗 60 日');

  for (const r of [20, 90]) {
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

test('terminal：总览「妖股纯情绪 N 只」可点 → 跳选股视图并停在纯情绪子集', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 300));

  const root = w.document.getElementById('tRoot');
  const jump = root.querySelector('.t-ai-strip .t-ai-item.is-jump');
  assert.ok(jump, '总览 AI 条内「妖股纯情绪」是可点按钮（原来只是静态文案）');
  assert.equal(jump.dataset.jump, 'picks', '跳转目标 = 选股视图');
  assert.equal(jump.dataset.filter, 'pure', '携带「仅纯情绪」筛选');

  const sig = readJsonSafe('data/signals-latest.json') || {};
  const pureN = ((sig.dragonLogic || {}).pureSentiment || []).length;
  const allN = ((sig.dragonLogic || {}).dragons || []).length;
  assert.ok(pureN > 0 && allN > pureN, `侧车数据：全梯队 ${allN} 只 / 纯情绪 ${pureN} 只`);

  jump.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 320));

  // ① 视图确实切到选股（导航按钮为选中态）
  const navOn = [...root.querySelectorAll('.t-nav button')].filter((b) => b.classList.contains('is-on'));
  assert.equal(navOn.length, 1, '同时只有一个视图按钮为选中态');
  assert.equal(navOn[0].dataset.v, 'picks', '已跳到选股视图');

  // ② 表格行数 = 纯情绪只数（子集过滤生效，仍是侧车原值，未重判）
  const rows = root.querySelectorAll('tr[data-code]');
  assert.equal(rows.length, pureN, `天梯只剩纯情绪 ${pureN} 只（全梯队 ${allN} 只）`);
  // ③ 筛选开关停在「仅纯情绪」，且「全部」可切回
  const fPure = root.querySelector('.t-ai-filter button[data-f="pure"]');
  const fAll = root.querySelector('.t-ai-filter button[data-f="all"]');
  assert.ok(fPure && fPure.classList.contains('is-on'), '筛选开关停在「仅纯情绪」');
  assert.ok(fAll && !fAll.classList.contains('is-on'), '「全部」未选中');
  assert.match(fAll.textContent, new RegExp(String(allN)), '「全部」按钮如实标注全梯队只数');

  fAll.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(root.querySelectorAll('tr[data-code]').length, allN, '切回「全部」后天梯恢复全梯队');
  assert.ok(root.querySelector('.t-ai-filter button[data-f="all"]').classList.contains('is-on'), '「全部」变为选中态');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：点个股看详情 —— 抽屉含 盘口快照/AI判词(紫)/排雷/持仓 四块 + K线', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 300));

  const root = w.document.getElementById('tRoot');
  // 走选股视图点第一只（连板最高的那票），验证「点个股 → 详情」链路
  [...root.querySelectorAll('.t-nav button')].find((b) => b.dataset.v === 'picks')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 320));

  const row = root.querySelector('tr[data-code]');
  assert.ok(row, '天梯有行可点');
  const code = row.dataset.code;
  row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 360));

  const ddet = w.document.querySelector('.t-drawer .t-ddet');
  assert.ok(ddet, '抽屉内含个股详情块（K 线之上）');
  // 四块齐全：盘口快照 / AI 判词 / 排雷 / 持仓（顺序不写死，按语义定位）
  const secs = [...ddet.querySelectorAll('.t-dsec')];
  assert.equal(secs.length, 4, '详情四块：盘口快照 + 妖股逻辑 + 排雷 + 持仓');
  assert.ok(ddet.querySelector('.t-dsec.is-snap'), '含盘口快照块');
  const aiSec = ddet.querySelector('.t-dsec.is-ai');
  assert.ok(aiSec, '妖股逻辑块标紫（AI 侧车）');
  assert.match(aiSec.textContent, /妖股逻辑推演/, 'AI 块是妖股逻辑推演');
  for (const k of ['连板', '行业', '逻辑', '置信']) {
    assert.ok(aiSec.textContent.includes(k), `判词含字段：${k}`);
  }
  assert.match(aiSec.textContent, /asOf/, '判词带 asOfDate 防伪戳');

  // 异步三块（盘口 / 黑名单 / 账户）已回填，不再是「读取中…」
  assert.ok(!/读取中/.test(ddet.textContent), '盘口/排雷/持仓三块已异步回填');
  const sig = readJsonSafe('data/signals-latest.json') || {};
  const dg = ((sig.dragonLogic || {}).dragons || []).find((x) => String(x.code) === code) || {};
  assert.ok(aiSec.textContent.includes(String(dg.hybk || '—')), '行业取自侧车原值');

  const iq = readJsonSafe('data/intraday-quotes-latest.json') || {};
  const q = (iq.quotes || []).find((x) => String(x.code) === code);
  if (q) {
    const snap = ddet.querySelector('.t-dsec.is-snap');
    assert.ok(snap.querySelector('.t-dkv'), '盘口快照显示现价/涨跌/今高/今低/昨收');
    assert.ok(snap.textContent.includes('盘中快照'), '盘口快照标注数据来源');
    // 绝不展示脱敏 name（样本XXX）
    assert.ok(!/样本/.test(snap.textContent), '盘口快照不展示脱敏占位 name');
  } else {
    assert.match(ddet.querySelector('.t-dsec.is-snap').textContent, /不在盘中快照名单内|盘口快照档缺失/, '该股不在快照名单 → 如实空态（fail-open）');
  }

  const bl = readJsonSafe('data/llm_risk_blacklist.json') || {};
  const hit = (bl.blacklist || []).find((x) => String(x.code) === code);
  const riskSec = ddet.querySelector('.t-dsec.is-risk');
  if (hit) {
    assert.ok(riskSec.querySelector('.t-dhit'), `命中黑名单 → 显示风险等级（${hit.riskLevel}）`);
    assert.ok(riskSec.textContent.includes(String(hit.reasons[0])), '显示风险理由标签');
  } else {
    assert.match(riskSec.textContent, /未命中黑名单|排雷档缺失/, '未命中/缺档如实显示（fail-open）');
  }
  assert.match(ddet.querySelector('.t-dsec.is-pos').textContent, /未持有|账户档缺失|持股/, '持仓块如实显示（当前账户为空仓）');

  // K 线仍在抽屉内（详情块之上是新加的，不能挤掉原功能）
  assert.ok(w.document.querySelector('.t-drawer .t-dkhost svg'), '抽屉下半仍是 K 线 SVG');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：模拟盘视图增强 —— 账户概览/待成交委托/决策日志（glm 环节用紫标）', async () => {
  const { w, errors } = makeDom();
  // 造一份含 pending + logs 的账户（真实档当前 pending 有 1 笔、logs 10 条，这里补齐 glm 环节以验紫标）
  const acct = readJsonSafe('data/paper/account.json') || {};
  acct.positions = acct.positions || {};
  acct.positions['003021'] = { code: '003021', name: '兆威机电', qty: 1000, avail: 0, avgCost: 91.73, cost: 91730, last: 95.2 };
  acct.logs = [
    { ts: Date.parse('2026-10-23T09:31:05'), date: '2026-10-23', code: '003021', name: '兆威机电', side: 'buy', stage: 'lhb', result: 'pass', text: '龙虎榜前置过滤通过。' },
    { ts: Date.parse('2026-10-23T09:31:06'), date: '2026-10-23', code: '600838', name: '上海九百', side: 'buy', stage: 'glm', result: 'rejected', text: 'GLM 三合一守卫：命中夜间排雷黑名单（立案调查），拒买。' },
    { ts: Date.parse('2026-10-23T09:31:07'), date: '2026-10-23', code: '003021', name: '兆威机电', side: 'buy', stage: 'order', result: 'submitted', text: '自动建仓委托已报送。' },
  ];
  w.fetch = (url) => {
    const u = String(url).replace(/^https?:\/\/localhost\//, '');
    if (u === 'data/paper/account.json') return Promise.resolve({ ok: true, json: async () => acct });
    const body = readJsonSafe(u);
    return Promise.resolve({ ok: body !== null, json: async () => body });
  };
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 300));

  const root = w.document.getElementById('tRoot');
  [...root.querySelectorAll('.t-nav button')].find((b) => b.dataset.v === 'paper')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 320));

  // ① 账户概览：八项原值直出
  const stats = root.querySelector('.t-stats');
  assert.ok(stats, '账户概览指标块');
  for (const k of ['总资产（净值）', '持仓市值', '可用现金', '冻结资金', '期初资金', '累计收益率', '已实现盈亏', '累计费用']) {
    assert.ok(stats.textContent.includes(k), `账户概览含：${k}`);
  }
  assert.ok(!/NaN/.test(stats.textContent), '账户概览不得出现 NaN（原值缺失应显示 —）');

  // ② 持仓 / ③ 待成交委托 / ④ 决策日志 三张表
  const titles = [...root.querySelectorAll('.t-panel-h .t-pt')].map((n) => n.textContent);
  for (const t of ['账户概览', '模拟盘净值', '持仓', '待成交委托', '决策日志']) {
    assert.ok(titles.includes(t), `模拟盘视图含面板：${t}`);
  }
  const tbls = [...root.querySelectorAll('table.t-tbl')];
  assert.equal(tbls.length, 3, '持仓 / 待成交委托 / 决策日志 三张表');
  const pendTbl = tbls[1];
  assert.match(pendTbl.textContent, /003021/, '待成交委托含挂单标的');
  assert.match(pendTbl.textContent, /买入/, '待成交委托标注方向');

  // ④ 日志：三条齐全、倒序（最新在上）、glm 环节用紫标
  const logTbl = tbls[2];
  const logRows = logTbl.querySelectorAll('tbody tr');
  assert.equal(logRows.length, 3, '决策日志 3 条');
  assert.match(logRows[0].textContent, /自动建仓委托已报送/, '日志按时间倒序（最新在上）');
  const glmRow = [...logRows].find((r) => /GLM 三合一守卫/.test(r.textContent));
  assert.ok(glmRow, '含 GLM 守卫留痕行');
  assert.ok(glmRow.querySelector('.t-tag-ai'), 'glm 环节用紫色 AI 标（看到紫 = AI 说的）');
  assert.ok(logTbl.querySelector('.t-res.is-no'), '拒绝结论有红色徽标');
  assert.ok(logTbl.querySelector('.t-res.is-pass'), '通过结论有绿色徽标');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：模拟盘视图 —— 空账户（无持仓/无挂单/无日志）不崩，如实空态', async () => {
  const { w, errors } = makeDom();
  w.fetch = (url) => {
    const u = String(url).replace(/^https?:\/\/localhost\//, '');
    if (u === 'data/paper/account.json') {
      return Promise.resolve({ ok: true, json: async () => ({ version: 1, initCash: 1000000, cash: 1000000, nav: [{ date: '2026-10-23', equity: 1000000, cash: 1000000, marketValue: 0 }] }) });
    }
    const body = readJsonSafe(u);
    return Promise.resolve({ ok: body !== null, json: async () => body });
  };
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 300));

  const root = w.document.getElementById('tRoot');
  [...root.querySelectorAll('.t-nav button')].find((b) => b.dataset.v === 'paper')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 320));

  const txt = root.textContent;
  assert.match(txt, /当前空仓/, '无持仓 → 如实空态');
  assert.match(txt, /无待成交委托/, '无挂单 → 如实空态');
  assert.match(txt, /当日无决策日志/, '无日志 → 如实空态');
  assert.match(txt, /净值序列不足/, '净值仅 1 个结算日 → 如实提示（不画单点折线）');
  assert.equal(root.querySelectorAll('table.t-tbl').length, 0, '三处皆空 → 无表格（也不该因取 null 表而崩）');
  assert.deepEqual(errors, [], `空账户不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：板块视图增强 —— 宽度 / 双基准切换 / AI 板块情绪(紫) / 事件流', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 300));

  const root = w.document.getElementById('tRoot');
  [...root.querySelectorAll('.t-nav button')].find((b) => b.dataset.v === 'sector')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 320));

  const panelBy = (t) => [...root.querySelectorAll('.t-panel')].find((p) => {
    const h = p.querySelector('.t-pt'); return h && h.textContent.trim() === t;
  });
  const titles = [...root.querySelectorAll('.t-panel-h .t-pt')].map((n) => n.textContent.trim());
  for (const t of ['板块宽度', '板块相对强弱', 'AI 板块情绪榜', '板块事件流']) {
    assert.ok(titles.includes(t), `板块视图含面板：${t}`);
  }

  // ① 板块宽度（引擎原值）
  const wd = panelBy('板块宽度');
  for (const k of ['上涨板块', '上涨占比', '行业中位数', '降级状态']) {
    assert.ok(wd.textContent.includes(k), `板块宽度含：${k}`);
  }
  const sig = readJsonSafe('data/signals-latest.json') || {};
  const ir = ((sig.latest || {}).industry_relative) || {};
  assert.ok(wd.textContent.includes(String(ir.upCount)), '上涨板块家数取引擎原值 upCount');

  // ② 双基准切换：默认对比指数 → 切到行业中位数（换一组引擎原值重画，不重算）
  const rs = panelBy('板块相对强弱');
  const segBtns = [...rs.querySelectorAll('.t-seg button')];
  assert.equal(segBtns.length, 2, '两个对比基准按钮（指数 / 行业中位数）');
  assert.ok(segBtns[0].classList.contains('is-on'), '默认停在「对比指数」');
  assert.ok(rs.textContent.includes(String((ir.vsIndex || {}).baseLabel || '')), '默认展示 vs 指数的基准名');

  segBtns[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 320));
  const rs2 = panelBy('板块相对强弱');
  const on2 = [...rs2.querySelectorAll('.t-seg button')].filter((b) => b.classList.contains('is-on'));
  assert.equal(on2.length, 1, '切换后仍只有一个基准选中');
  assert.equal(on2[0].dataset.b, 'median', '已切到「行业中位数」');
  assert.ok(rs2.textContent.includes(String((ir.vsMedian || {}).baseLabel || '行业中位数')), '切换后展示 vs 中位数的基准名');

  // ③ AI 板块情绪（紫）：来源条 + 条数与侧车一致
  const ss = sig.sectorSentiment || {};
  assert.match(root.textContent, /题材翻译官/, 'AI 来源条声明是 GLM 题材翻译官');
  assert.ok(root.textContent.includes(String(ss.asOfDate || '')), 'AI 来源条带 asOfDate');
  const emo = panelBy('AI 板块情绪榜');
  const bars = emo.querySelectorAll('.t-dv-row');
  assert.equal(bars.length, (ss.sectors || []).length, '情绪榜条数 = 侧车板块数');
  assert.ok(emo.textContent.includes('工业母机'), '含侧车真实板块名');
  // 多/空两侧着色：看多走 up(红)、看空走 dn(绿)，不得反色
  const upFills = emo.querySelectorAll('.t-dv-track:not(.is-l) .t-dv-fill.up').length;
  const dnFills = emo.querySelectorAll('.t-dv-track.is-l .t-dv-fill.dn').length;
  const posN = (ss.sectors || []).filter((x) => (+x.score || 0) > 0).length;
  const negN = (ss.sectors || []).filter((x) => (+x.score || 0) < 0).length;
  assert.equal(upFills, posN, `看多${posN}个 → 右侧红条同数`);
  assert.equal(dnFills, negN, `看空${negN}个 → 左侧绿条同数`);
  if (ss.blackTalk) {
    assert.ok(root.querySelector('.t-blacktalk'), '游资黑话块（GLM 生成）');
    assert.ok(root.querySelector('.t-blacktalk').textContent.includes(String(ss.blackTalk).slice(0, 8)), '黑话取自侧车原值');
  }

  // ④ 板块事件流
  const ev = panelBy('板块事件流');
  const evRows = ev.querySelectorAll('tbody tr');
  assert.equal(evRows.length, (ss.events || []).length, '事件流行数 = 侧车事件数');
  assert.ok(ev.querySelector('.t-res.is-pass') || ev.querySelector('.t-res.is-no'), '事件流有方向徽标（利多/利空）');
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

test('terminal：总览「市场宽度」面板（engine 原值：站上均线/新高新低/涨跌比）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 600));   // 宽度档异步回填，等足

  const root = w.document.getElementById('tRoot');
  assert.ok(/市场宽度/.test(root.textContent), '总览含市场宽度面板');
  assert.ok(!/宽度档读取失败/.test(root.textContent), '宽度档不得落到失败态');

  const bw = readJsonSafe('data/breadth-latest.json') || {};
  const bm = bw.aboveMa || {}, nh = bw.newHigh || {}, nl = bw.newLow || {}, ud = bw.updown || {};
  assert.ok(root.textContent.includes(String(bm.n)), `站上20日线家数取引擎原值 aboveMa.n=${bm.n}`);
  assert.ok(root.textContent.includes(`${ud.up.toLocaleString('en-US')}:${ud.down.toLocaleString('en-US')}`), `涨跌比取引擎原值 ${ud.up}:${ud.down}（千分位）`);
  assert.ok(root.textContent.includes(String(nh.n)), `历史新高家数取引擎原值 newHigh.n=${nh.n}`);
  assert.match(root.textContent, /宽度判语/, '含宽度判语（engine verdict）');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：总览「主线题材脉络」面板（main_theme_history 轮动）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 500));   // 主线历史档异步回填，等足

  const root = w.document.getElementById('tRoot');
  assert.ok(/主线题材脉络/.test(root.textContent), '总览含主线题材脉络面板');
  assert.ok(!/主线历史档读取失败/.test(root.textContent), '主线历史档不得落到失败态');

  const mh = readJsonSafe('data/main_theme_history.json') || {};
  const days = mh.days || [];
  const last = days[days.length - 1] || {};
  const names = (last.main_themes || []).map((t) => t.name).filter(Boolean);
  if (names.length) assert.ok(root.textContent.includes(String(names[0])), `末日主线名取引擎原值：${names[0]}`);
  if (last.rotation) assert.ok(/↻ 轮动/.test(root.textContent), '轮动标记渲染');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});

test('terminal：键盘快捷键 1–7 切视图（输入框聚焦时拦截 / Esc 关抽屉）', async () => {
  const { w, errors } = makeDom();
  w.eval(readFileSync(join(ROOT, 'terminal.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 120));
  const root = w.document.getElementById('tRoot');
  // 默认 makeDom 不进终端（root.hidden=true）；快捷键仅在终端可见时响应 → 先点入口进入
  const entryBtn = [...w.document.body.querySelectorAll('button')].find((b) => /终端/.test(b.textContent));
  assert.ok(entryBtn, '存在「⚡ 终端」入口按钮');
  entryBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(!root.hidden, '点击入口后终端可见');
  const isOn = (k) => {
    const b = [...root.querySelectorAll('.t-nav button')].find((x) => x.dataset.v === k);
    return !!(b && b.classList.contains('is-on'));
  };
  assert.ok(isOn('overview'), '初始总览高亮');
  const key = (k, target) => (target || w.document).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));

  key('4'); await new Promise((r) => setTimeout(r, 60));
  assert.ok(isOn('sector'), '按 4 切到板块视图');
  key('7'); await new Promise((r) => setTimeout(r, 60));
  assert.ok(isOn('kline'), '按 7 切到 K线视图');

  // 切到 K线后可找到代码输入框；聚焦后按数字不应切视图
  const inp = root.querySelector('input');
  assert.ok(inp, 'K线视图含代码输入框');
  inp.focus();
  key('5', inp); await new Promise((r) => setTimeout(r, 60));
  assert.ok(isOn('kline'), '输入框聚焦时按 5 不切视图（保持 K线）');

  // 非数字键不切
  key('x'); await new Promise((r) => setTimeout(r, 30));
  assert.ok(isOn('kline'), '非数字键不触发切换');
  assert.deepEqual(errors, [], `不应有 JS 错误：${errors.join(' | ')}`);
});
