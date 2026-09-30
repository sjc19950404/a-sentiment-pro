// 前端渲染校验（开发用）：在 jsdom 里真跑 index.html + app.js，读取磁盘上的 data/*.json，
// 断言 V5.2 四个新卡片确实被渲染、且原有卡片未被破坏。
// 依赖 jsdom（非仓库依赖，CI 不跑本脚本）：
//   npm i -g jsdom 或在任意 node_modules 下有 jsdom；缺失时脚本自动跳过并以 0 退出。
// 用法：node scripts/check_frontend.mjs [--root .]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const rootArg = process.argv.indexOf('--root');
const ROOT = resolve(rootArg >= 0 ? process.argv[rootArg + 1] : '.');

// 依赖解析：先 ESM import，再 CJS require（require 才认 NODE_PATH，便于指向任意 node_modules）
let jsdom;
try {
  jsdom = await import('jsdom');
} catch {
  try {
    jsdom = createRequire(import.meta.url)('jsdom');
  } catch {
    console.log('[check_frontend] 未安装 jsdom，跳过（安装：npm i jsdom，或用 NODE_PATH 指向已装目录）');
    process.exit(0);
  }
}
const { JSDOM, VirtualConsole } = jsdom;

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

const dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  virtualConsole: vc,
});
const { window } = dom;

// 用本地文件系统实现 fetch（相对路径 → 仓库文件），避免依赖静态服务器
window.fetch = async (url) => {
  const rel = String(url).replace(/^\.\//, '').split('?')[0];
  try {
    const txt = readFileSync(join(ROOT, rel), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
  } catch (e) {
    return { ok: false, status: 404, json: async () => { throw e; }, text: async () => '' };
  }
};

const fail = [];
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fail.push(name);
};

try {
  window.eval(readFileSync(join(ROOT, 'app.js'), 'utf8'));
} catch (e) {
  check('app.js 执行不抛异常', false, e.message);
}
await new Promise((r) => setTimeout(r, 400)); // 等异步 fetch/渲染落地

const $ = (id) => window.document.getElementById(id);
const rows = (id) => $(id)?.querySelectorAll('tbody tr').length ?? 0;
const txt = (id) => ($(id)?.textContent || '').trim();

check('原有区块未受影响：情绪分已渲染', txt('emScore') !== '' && txt('emScore') !== '--', `emScore=${txt('emScore')}`);
check('原有区块未受影响：研判报告已生成', txt('briefBody').length > 300, `${txt('briefBody').length} 字`);
check('原有区块未受影响：热点表已填充', rows('hotTable') > 0, `${rows('hotTable')} 行`);
check('新增·策略回测：指标对比表 6 行', rows('btMetrics') === 6, `${rows('btMetrics')} 行`);
check('新增·策略回测：净值曲线 3 条序列', $('btNavSvg')?.querySelectorAll('polyline').length === 3,
  `${$('btNavSvg')?.querySelectorAll('polyline').length} 条`);
check('新增·策略回测：卡内参数行已渲染（阈值/风控，完整参数收进抽屉）',
  txt('btParams').includes('阈值') && txt('btParams').includes('风控') && !!$('btMore'), txt('btParams').slice(0, 40));
check('新增·策略回测：数据加载成功（非降级提示）',
  !txt('btNote').includes('加载失败') && !txt('btNote').includes('未生成'), txt('btNote').slice(0, 40));
check('新增·帕累托：结果表已填充', rows('paretoTable') > 0, `${rows('paretoTable')} 行`);
check('新增·帕累托：摘要含扫描组数', /扫描\s*\d+\s*组/.test(txt('paretoSummary')), txt('paretoSummary').slice(0, 50));
check('新增·滚动样本外：分段表已填充', rows('rollTable') > 0, `${rows('rollTable')} 行`);
check('新增·主线选股：主线题材已渲染', txt('mainLineBody').includes('主线题材'), txt('mainLineBody').slice(0, 40));
check('新增·主线选股：口径备注已渲染', txt('mainLineBody').includes('强度分'), '');

// 研判报告与引擎同源（V5.2）：报告结论必须用引擎口径（七因子情绪分 = archive.emotion.value）
// 套引擎阈值，不能再用自算的五模块分当结论——实测过两套分套同一阈值会给出相反结论
// （83.8 →「过热」 vs 76.8 →「满仓持有」）。
const bt = JSON.parse(readFileSync(join(ROOT, 'data/backtest.json'), 'utf8'));
const arcAll = JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8'));
const lastEmo = (arcAll.all_days || []).slice(-1)[0]?.emotion?.value;
const th = bt.params?.thresholds || { panic: 24, hi: 44, lo: 65, overheat: 80 };
const expectTier = lastEmo == null ? null
  : lastEmo >= th.overheat ? '过热 · 只减仓不新建'
    : lastEmo >= th.lo ? '满仓持有'
      : lastEmo > th.panic ? '半仓' : '清仓';
const brief = txt('briefBody');
const tierSeg = (() => {
  const i = brief.indexOf('仓位档位（V5.2 引擎口径）');
  const j = brief.indexOf('因子分解');
  return (i >= 0 && j > i) ? brief.slice(i, j) : '';
})();
check('研判报告·数据日期与抓取状态落款', brief.includes('数据日期') && brief.includes('抓取状态'), '');
check(`研判报告·仓位档位与引擎一致（情绪分 ${lastEmo} → ${expectTier}）`,
  expectTier != null && tierSeg.includes(expectTier), tierSeg.slice(0, 80) || '缺「仓位档位」段');
check('研判报告·档位阈值与引擎阈值同源',
  tierSeg.includes(`≥${th.overheat}`) && tierSeg.includes(`≥${th.lo}`) && tierSeg.includes(`≤${th.panic}`), '');
check('研判报告·因子分解已降级（标注不参与档位判定）',
  brief.includes('因子分解') && brief.includes('不参与档位判定'), '');
check('研判报告·含 V5.2 实盘约束（止损/降仓/成本）',
  brief.includes('实盘约束') && brief.includes('止损') && brief.includes('印花税'), '');
check('研判报告·含主线强度分（与引擎 selectMainLine 同式）', /主线强度分\s*[\d.\u2014-]+/.test(brief), '');
check('研判报告·不含与引擎冲突的 V5.0「极低/极高风险」措辞',
  !brief.includes('极低风险') && !brief.includes('极高风险'), '');
check(`研判报告·落款版本与回测档一致（${bt.meta?.formulaVersion}）`,
  brief.includes(bt.meta?.formulaVersion || 'v5.2-pro'), '');

// 告警口径：stale（或客户端已过预期更新时刻）才允许出现「告警」级别的条；
// 仅「字段级修补 note / 跳过 / 非交易日」只能是 info，不能把正常等待说成抓取失败。
const meta = JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8')).meta || {};
const warns = window.document.querySelectorAll('#alerts .alert:not(.info)').length;
const infos = window.document.querySelectorAll('#alerts .alert.info').length;
const pastDeadline = !!(meta.freshness?.publishDeadline && Date.now() > Date.parse(meta.freshness.publishDeadline));
const expectWarn = !!meta.stale || pastDeadline;
check(`告警口径：stale=${!!meta.stale} / 已过预期更新时刻=${pastDeadline} → 告警条 ${warns} 条`,
  expectWarn ? warns >= 1 : warns === 0, `告警 ${warns} 条、info ${infos} 条`);
if (meta.note) check('告警口径：字段级修补 note 以 info 展示', infos >= 1, `${infos} 条 info`);

// ── 布局与交互层断言（UI 改造）──
// 用真实事件模拟点击/键盘，验证「详情能打开、能下钻、能返回、能关闭」，而不是只看 DOM 有没有元素。
const clickEl = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
const keyEl = (key) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const drawerOpen = () => !!$('drawer') && $('drawer').classList.contains('open');
const escClose = () => keyEl('Escape');

check('布局：4 个分区 + 4 个锚点导航已就位',
  ['zone-overview', 'zone-detail', 'zone-backtest', 'zone-brief'].every((id) => !!$(id))
  && window.document.querySelectorAll('#zoneNav .zn[data-zone]').length === 4, '');
check('布局：详情抽屉与遮罩骨架存在（初始关闭）',
  !!$('drawer') && !!$('drawerMask') && !!$('dwTitle') && !!$('dwBody') && !drawerOpen(), '');
check('布局：个股表已升级为整行卡片且含工具条（视图切换/搜索/计数）',
  !!$('hotTabs') && !!$('hotSearch') && !!$('hotCount') && !!$('hotHead'), '');
check('布局：报告卡含目录与折叠控制', !!$('briefNav') && !!$('briefToggle'), '');

// 1) 表格行 → 个股详情
const firstRow = $('hotTable').querySelector('tbody tr.clickable');
const firstCode = firstRow?.dataset.code || '';
clickEl(firstRow);
check('交互：点表格行打开详情抽屉', drawerOpen() && txt('dwTitle').includes(firstCode), txt('dwTitle'));
check('交互：个股详情含行情/龙虎资金/近5日记录段',
  txt('dwBody').includes('行情与状态') && txt('dwBody').includes('近 5 个交易日记录'), txt('dwBody').slice(0, 50));

// 2) 抽屉内下钻（个股 → 题材）再返回
const themeChip = $('dwBody').querySelector('[data-act="theme"]');
if (themeChip) {
  clickEl(themeChip);
  check('交互：抽屉内点题材可继续下钻', drawerOpen() && txt('dwTitle').includes('题材'), txt('dwTitle'));
  const backBtn = $('dwBody').querySelector('[data-act="dback"]');
  check('交互：下钻后提供返回上级按钮', !!backBtn, '');
  clickEl(backBtn);
  check('交互：返回后回到个股详情', txt('dwTitle').includes(firstCode), txt('dwTitle'));
} else {
  check('交互：抽屉内点题材可继续下钻', false, '该股无匹配题材');
  check('交互：下钻后提供返回上级按钮', false, '');
  check('交互：返回后回到个股详情', false, '');
}

// 3) Esc 关闭
escClose();
check('交互：Esc 可关闭抽屉', !drawerOpen(), '');

// 4) 帕累托权重组合行 + 回测完整参数抽屉
clickEl($('paretoTable').querySelector('tbody tr.clickable'));
check('交互：点帕累托行看权重组合（含 7 因子权重与基准对比）',
  drawerOpen() && txt('dwTitle').includes('权重组合') && txt('dwBody').includes('龙虎榜净额') && txt('dwBody').includes('基准'), txt('dwTitle'));
escClose();

clickEl($('btMore'));
check('交互：回测卡可打开「完整参数与口径」（含成本/风控/自检）',
  drawerOpen() && txt('dwTitle').includes('完整参数')
  && txt('dwBody').includes('交易成本') && txt('dwBody').includes('风控与仓位约束') && txt('dwBody').includes('口径自检'),
  txt('dwTitle'));
escClose();

// 5) 滚动分段行
clickEl($('rollTable').querySelector('tbody tr.clickable'));
check('交互：点滚动分段行看训练窗与权重',
  drawerOpen() && txt('dwTitle').includes('滚动段') && txt('dwBody').includes('训练窗'), txt('dwTitle'));
escClose();

// 5.5) 净值曲线数据点（与趋势图一致：图上的点也可点开当日盘面）
check('布局：净值曲线已渲染可点数据点',
  $('btNavSvg').querySelectorAll('circle[data-act="btpt"]').length > 0,
  `${$('btNavSvg').querySelectorAll('circle').length} 点`);
clickEl($('btNavSvg').querySelector('circle[data-act="btpt"]'));
check('交互：点净值曲线数据点看当日盘面',
  drawerOpen() && txt('dwTitle').includes('盘面') && txt('dwSub').includes('净值曲线数据点'), txt('dwTitle'));
escClose();

// 6) 趋势图数据点
check('布局：趋势图已渲染可点数据点', $('trendSvg').querySelectorAll('circle[data-act="day"]').length > 0,
  `${$('trendSvg').querySelectorAll('circle').length} 点`);
clickEl($('trendSvg').querySelector('circle[data-act="day"]'));
check('交互：点趋势图数据点看当日盘面（含指数与档位）',
  drawerOpen() && txt('dwTitle').includes('盘面') && txt('dwBody').includes('指数表现'), txt('dwTitle'));
escClose();

// 7) 题材动量标签
clickEl($('freshList').querySelector('[data-act="theme"]'));
check('交互：点题材动量标签看题材详情（含强度分与成分股）',
  drawerOpen() && txt('dwTitle').includes('题材') && txt('dwBody').includes('主线强度分'), txt('dwTitle'));
escClose();

// 8) 表格搜索 / 排序 / 视图切换
const beforeRows = rows('hotTable');
const inp = $('hotSearch');
inp.value = 'PCB';
inp.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 280)); // 等搜索防抖
const afterRows = rows('hotTable');
check('交互：搜索框可筛选表格行', afterRows > 0 && afterRows < beforeRows, `${beforeRows} → ${afterRows} 行`);
inp.value = '';
inp.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 280));
check('交互：清空搜索后恢复全部行', rows('hotTable') === beforeRows, `${rows('hotTable')} 行`);

clickEl($('hotHead').querySelector('th[data-sort="code"]'));
check('交互：点列头排序（表头出现方向标记）', !!$('hotHead').querySelector('th .dir'), '');
clickEl($('hotTabs').querySelector('button[data-view="lhb"]'));
check('交互：可切到龙虎榜资金视图（净买/买卖额列）',
  txt('hotHead').includes('龙虎净买') && txt('hotHead').includes('卖出(亿)'), txt('hotHead').slice(0, 60));
clickEl($('hotTabs').querySelector('button[data-view="hot"]'));
check('交互：可切回强势股归因视图', txt('hotHead').includes('诱因'), txt('hotHead').slice(0, 40));

// 9) 报告目录跳转与一键折叠
check('布局：报告目录 chip 数 = 段落数（6）',
  $('briefNav').querySelectorAll('button[data-act="brsec"]').length === 6,
  `${$('briefNav').querySelectorAll('button').length} 个`);
clickEl($('briefToggle'));
check('交互：一键折叠报告全部 6 段',
  window.document.querySelectorAll('#briefBody .bf-sec.collapsed').length === 6, '');
clickEl($('briefToggle'));
check('交互：一键展开报告全部段落',
  window.document.querySelectorAll('#briefBody .bf-sec.collapsed').length === 0, '');

// 单段折叠：鼠标点击与键盘 Enter 都要能用
const keyOnEl = (el, key) => { if (el) el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return !!el; };
const sec1 = window.document.getElementById('bfsec1');
const sec1H = sec1.querySelector('.bf-h');
keyOnEl(sec1H, 'Enter');
check('交互：段落标题键盘 Enter 可折叠单段',
  sec1.classList.contains('collapsed') && sec1H.getAttribute('aria-expanded') === 'false', '');
keyOnEl(sec1H, 'Enter');
check('交互：再次 Enter 展开该段',
  !sec1.classList.contains('collapsed') && sec1H.getAttribute('aria-expanded') === 'true', '');

// 目录跳转：折叠态下点目录应展开该段（jsdom 无 scrollIntoView，代码已做存在性守卫）
clickEl($('briefToggle')); // 先全部折叠
clickEl($('briefNav').querySelector('button[data-act="brsec"]'));
check('交互：点报告目录跳转并展开该段', !sec1.classList.contains('collapsed'), '');

// 10) 主线卡的题材与标的均可点
check('交互：主线卡的题材标签与标的清单可点',
  window.document.querySelectorAll('#mainLineBody [data-act="theme"]').length > 0
  && window.document.querySelectorAll('#mainLineBody [data-act="stock"]').length > 0, '');

check('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

dom.window.close();

console.log(fail.length ? `\n[check_frontend] 失败 ${fail.length} 项：${fail.join('、')}` : '\n[check_frontend] 全部通过');
process.exit(fail.length ? 1 : 0);
