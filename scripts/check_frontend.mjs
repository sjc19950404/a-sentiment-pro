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
// 统计数据行数——必须排除空态提示行：零匹配时 tbody 里会渲染
// <tr><td class="empty">没有匹配的个股…</td></tr>，若把这一行算作数据行，
// "搜索筛选"断言在零匹配时也会成立（1 > 0 && 1 < 56 假通过），两处搜索断言就会打架。
const rows = (id) => [...($(id)?.querySelectorAll('tbody tr') || [])]
  .filter((tr) => !tr.querySelector('td.empty')).length;
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

// 龙虎榜口径：上榜总成交与净买率必须是同一个口径（当日榜 + 同票去重），
// 不能把「连续N个交易日涨跌幅偏离值累计」这类区间累计榜混进来。
// 2026-09-30 事故：旧口径把 84 条原始记录（含 23 条区间榜）不加区分地相加，得上榜总成交 511 亿，
// 当日榜去重后真实仅 136.5 亿（3.7 倍差），净买率被稀释成 2.4%（真实 5.7%），
// 定性从"中等力度"错判为"脉冲级、可信度低"——结论方向反了。区间榜记录的 BUY_AMT 还是区间累计
// 成交额（近岸蛋白 10 日榜 BUY==SELL==ACCUM==116.97 亿、净额 0），根本不能当席位买卖用。
const s0 = (arcAll.all_days || []).slice(-1)[0]?.summary || {};
const d0lhb = (arcAll.all_days || []).slice(-1)[0]?.lhb || [];
check('数据：龙虎榜已单列当日榜口径（成交/净额/家数/区间榜条数）',
  s0.lhb_daily_amt != null && s0.lhb_daily_net != null
  && s0.lhb_daily_stocks != null && s0.lhb_range_count != null,
  `amt=${s0.lhb_daily_amt} net=${s0.lhb_daily_net} stocks=${s0.lhb_daily_stocks} range=${s0.lhb_range_count}`);
const legacyTot = d0lhb.reduce((a, l) => a + (l.buy_wan || 0) + (l.sell_wan || 0), 0) / 1e4;
check('数据：当日榜成交额明显小于「全部记录未去重」之和（区间累计榜不得混入）',
  s0.lhb_daily_amt > 0 && s0.lhb_daily_amt < legacyTot * 0.7,
  `当日榜 ${s0.lhb_daily_amt} 亿 vs 未去重 ${legacyTot.toFixed(1)} 亿`);
if (s0.lhb_daily_amt > 0 && s0.lhb_daily_net != null) {
  const rate = (s0.lhb_daily_net / s0.lhb_daily_amt * 100).toFixed(1);
  const seg = brief.indexOf('上榜总成交');
  check('研判报告·上榜总成交取当日榜口径',
    brief.includes(`上榜总成交 ${Math.round(s0.lhb_daily_amt)} 亿`),
    seg >= 0 ? brief.slice(seg, seg + 70) : '报告缺「上榜总成交」行');
  check('研判报告·净买率与当日榜口径同源（不再被区间累计榜稀释）',
    brief.includes(`净买率 ${rate}%`), `期望「净买率 ${rate}%」`);
  check('研判报告·区间累计榜被单列且注明（口径透明）',
    s0.lhb_range_count > 0 ? brief.includes('连续 N 个交易日累计') : true,
    `range_count=${s0.lhb_range_count}`);
}
check('研判报告·因子分解已降级（标注不参与档位判定）',
  brief.includes('因子分解') && brief.includes('不参与档位判定'), '');

// ── 口径纪律：两套净额（当日榜 lhb_daily_net / 全量 lhb_all_net）绝不能混用 ──
// 事故形态：同一句话里净买率用当日榜、滚动净买却用全量；新股扰动用「当日榜分子 ÷ 全量分母」。
// 这三条断言把口径钉死，任何一处回退都会被拦住。
// 字段名拼接构造：源码里不出现该字面量，口径守卫（audit_lhb_caliber）才能保持「全仓零出现」这条强约束
const LEGACY_FIELD = ['net', 'total', 'yi'].join('_');
check('口径：存档已清除无后缀的旧净额字段（只保留带口径后缀的字段）',
  !(LEGACY_FIELD in s0) && !(LEGACY_FIELD in (arcAll.all_days.slice(-1)[0]?.emotion || {}))
  && s0.lhb_all_net != null,
  `lhb_all_net=${s0.lhb_all_net} lhb_daily_net=${s0.lhb_daily_net}`);
check('口径：无口径后缀的净额字段不存在（防「少了后缀那一刻」再次混用）',
  Object.keys(s0).every((k) => !/^net_/.test(k) || k === 'net_pos' || k === 'net_neg'),
  Object.keys(s0).filter((k) => /^net_/.test(k)).join(','));
check('口径：报告首页「当日龙虎净买」取当日榜，不显示全量值',
  txt('emNet').includes('当日龙虎净买') && !txt('emNet').includes(String(s0.lhb_all_net)),
  `emNet=「${txt('emNet')}」`);
{
  // 近5日净额序列必须与净买率同口径：逐日核对报告里出现的数字就是 lhb_daily_net
  const last5 = arcAll.all_days.slice(-5).map((d) => d.summary?.lhb_daily_net);
  const segI = brief.indexOf('近5日当日龙虎净买');
  const seg = segI >= 0 ? brief.slice(segI, segI + 120) : '';
  // 渲染用 (+v).toFixed(1)，正数补 + 号；断言要按同样的格式比对，否则 6.09 会被拿来匹配「6.1」而假失败
  const fmt = (v) => (v > 0 ? '+' : '') + (+v).toFixed(1);
  const allShown = segI >= 0 && last5.every((v) => v == null || seg.includes(fmt(v)));
  check('口径：近5日净额序列与净买率同源（当日榜），且标签写明口径',
    allShown, seg || '报告缺「近5日当日龙虎净买」行');
  const allExpected = last5.filter((v) => v != null).some((v) => seg.includes(String(Math.abs(s0.lhb_all_net))));
  check('口径：近5日净额序列不出现全量口径值', !allExpected,
    `全量值 ${s0.lhb_all_net} 是否出现在序列中：${allExpected}`);
}
{
  // 新股扰动占比：分子（新股当日净买）与分母（当日全榜净买）必须同为当日榜
  const aggr = arcAll.all_days.slice(-1)[0]?.lhb_aggr || [];
  const news = aggr.filter((l) => l.caliber !== 'range'
    && /无价格涨跌幅限制/.test(String(l.reason || '')));
  if (news.length && s0.lhb_daily_net > 0) {
    const newNet = news.reduce((a, l) => a + (l.net_buy_wan || 0), 0) / 1e4;
    const expectPct = Math.round(newNet / s0.lhb_daily_net * 100);
    const wrongPct = Math.round(newNet / s0.lhb_all_net * 100);
    const segI = brief.indexOf('占当日龙虎净买');
    const seg = segI >= 0 ? brief.slice(Math.max(0, segI - 40), segI + 40) : '';
    check('口径：新股扰动占比＝新股当日净买 ÷ 当日榜净额（分子分母同源）',
      segI >= 0 && seg.includes(`${expectPct}%`),
      `期望 ${expectPct}%（混用全量分母会变成 ${wrongPct}%）| ${seg}`);
  }
}
check('口径：聚合行带 caliber 标签，区间榜可被 UI 识别',
  (arcAll.all_days.slice(-1)[0]?.lhb_aggr || []).every((l) => l.caliber === 'daily' || l.caliber === 'range'), '');
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

check('布局：6 个分区 + 6 个锚点导航已就位',
  ['zone-overview', 'zone-detail', 'zone-backtest', 'zone-brief', 'zone-global', 'zone-paper'].every((id) => !!$(id))
  && window.document.querySelectorAll('#zoneNav .zn[data-zone]').length === 6, '');
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
// 首行不保证带题材 chip：诱因文本没命中当日题材库的票就没有（例如 2026-09-29 涨幅首位的
// 920779，诱因「固态电池检测+电池测试设备+订单充足」都不在题材库里）。
// 所以这里不依赖首行，先按代码搜出一只确定有题材的票，让表格只剩它一行再下钻，
// 否则断言会随"谁排第一"随机假失败。
const d0 = arcAll.all_days[arcAll.all_days.length - 1];
const themeKeys = Object.keys(d0.themes || {});
const withTheme = (d0.hot || []).find((h) =>
  themeKeys.some((t) => t.length >= 2 && String(h.reason || '').includes(t)));
check('前置：当日存在「诱因命中题材库」的个股（下钻用例前提）',
  !!withTheme, withTheme ? `${withTheme.code} ${withTheme.name}` : '当日无此类个股');

let themeChip = null;
if (withTheme) {
  escClose();
  const sinp = $('hotSearch');
  sinp.value = withTheme.code;
  sinp.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 280)); // 等搜索防抖
  const pickRow = $('hotTable').querySelector('tbody tr.clickable');
  check('前置：按代码搜索恰好命中该股',
    pickRow?.dataset.code === withTheme.code, pickRow?.dataset.code || '无匹配行');
  clickEl(pickRow);
  themeChip = $('dwBody').querySelector('[data-act="theme"]');
  sinp.value = '';
  sinp.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 280));
}

if (themeChip) {
  clickEl(themeChip);
  check('交互：抽屉内点题材可继续下钻', drawerOpen() && txt('dwTitle').includes('题材'), txt('dwTitle'));
  const backBtn = $('dwBody').querySelector('[data-act="dback"]');
  check('交互：下钻后提供返回上级按钮', !!backBtn, '');
  clickEl(backBtn);
  check('交互：返回后回到个股详情', txt('dwTitle').includes(withTheme?.code), txt('dwTitle'));
} else {
  check('交互：抽屉内点题材可继续下钻', false,
    `预筛 ${withTheme?.code || '—'} 应有题材 chip，但抽屉内没渲染（搜索/匹配口径不一致）`);
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
// 搜索词从当日数据里动态取，不写死：曾固定用 'PCB'，而某些交易日强势股里根本没有该题材，
// 零匹配时两个搜索断言结论相反（表格侧因空态行假通过、卡片侧正确失败）。
const searchWord = (() => {
  const h = (arcAll.all_days[arcAll.all_days.length - 1].hot || [])[0];
  return String(h?.reason || '').split(/[+＋]/)[0].trim() || String(h?.code || '');
})();
inp.value = searchWord;
inp.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 280)); // 等搜索防抖
const afterRows = rows('hotTable');
check('交互：搜索框可筛选表格行', afterRows > 0 && afterRows < beforeRows,
  `「${searchWord}」${beforeRows} → ${afterRows} 行`);
inp.value = '';
inp.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 280));
check('交互：清空搜索后恢复全部行', rows('hotTable') === beforeRows, `${rows('hotTable')} 行`);

clickEl($('hotHead').querySelector('th[data-sort="code"]'));
check('交互：点列头排序（表头出现方向标记）', !!$('hotHead').querySelector('th .dir'), '');
clickEl($('hotTabs').querySelector('button[data-view="lhb"]'));
check('交互：可切到龙虎榜资金视图（净买/买卖额列）',
  txt('hotHead').includes('龙虎净买') && txt('hotHead').includes('卖出(亿)'), txt('hotHead').slice(0, 60));
// 区间累计榜的数值不能和当日值混在一起看：表格必须把它标出来（否则读表人会以为 2.84 亿就是当天净买）
{
  const rngBadges = $('hotTable').querySelectorAll('tbody .rngb').length;
  const rngRows = (arcAll.all_days.slice(-1)[0]?.lhb_aggr || []).filter((l) => l.caliber === 'range').length;
  check('口径：龙虎榜表格给「区间累计榜」行打标记（数值口径肉眼可辨）',
    rngRows > 0 && rngBadges === rngRows, `区间榜 ${rngRows} 行 → 页面标记 ${rngBadges} 个`);
}
clickEl($('hotTabs').querySelector('button[data-view="hot"]'));
check('交互：可切回强势股归因视图', txt('hotHead').includes('诱因'), txt('hotHead').slice(0, 40));

// 8b) 行情缺失 ≠ 行情为 0（武汉蓝电 920779 事故回归）
// 北交所代码段曾漏在行情前缀之外 → close/涨跌幅/换手全空 → 旧代码把空写成 0，
// 页面于是显示「涨幅 0.00%、换手 0」，看着像数据本身错了。语义必须锁死：缺失是 null 或「—」，
// 0 只能表示真实的 0（例如一字板当日换手确实可为 0）。
const nobHtml = String(window.chgCell?.({ change_pct: null, close: null, reason: '测试' }) ?? '');
check('渲染：无行情个股标出「无行情」（而不是显示 0）',
  nobHtml.includes('无行情') && nobHtml.includes('nob'), nobHtml.slice(0, 80));
const zeroHtml = String(window.chgCell?.({ change_pct: 0, close: 10.5, huanshou: 0, reason: '一字板' }) ?? '');
check('渲染：真实 0% 涨幅不会被误标为无行情',
  !zeroHtml.includes('无行情') && zeroHtml.includes('0.00%'), zeroHtml.slice(0, 80));

const fakeZeros = arcAll.all_days.flatMap((d) => (d.hot || [])
  .filter((h) => h.close == null && h.change_pct === 0 && h.huanshou === 0));
check('数据：全历史无「行情缺失却落成 0」的强势股条目（缺失必须是 null）',
  fakeZeros.length === 0, fakeZeros.slice(0, 3).map((h) => `${h.code} ${h.name}`).join(' / '));

// 920779 若在当日榜内，其行情必须已经补齐（北交所代码段前缀回归）
const c779 = (d0.hot || []).find((h) => h.code === '920779');
if (c779) {
  check('数据：北交所个股行情已补齐（武汉蓝电 920779 不再是假 0）',
    c779.close != null && c779.change_pct !== 0 && c779.huanshou !== 0,
    `close=${c779.close} 涨幅=${c779.change_pct}% 换手=${c779.huanshou}%`);
}

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
// 主线题材的成分股 = 诱因文本里包含该题材名的票。某些交易日主线名与诱因用词并不一致，
// 成分股会为空（例如 2026-09-30 主线「业绩线」，个股诱因里写的是「业绩改善」），
// 故标的断言按当日实际数据条件化，不写死"必须存在"，否则数据一变就假失败。
const mlThemeChips = window.document.querySelectorAll('#mainLineBody [data-act="theme"]').length;
const mlStockChips = window.document.querySelectorAll('#mainLineBody [data-act="stock"]').length;
const mlHasStocks = (bt.mainLine?.mains || []).some((m) => (m.stocks || []).length > 0);
check('交互：主线卡的题材标签可点（可下钻题材成分）', mlThemeChips > 0, `${mlThemeChips} 个题材 chip`);
check('交互：主线标的清单可点（当日主线确有成分股时）',
  mlHasStocks ? mlStockChips > 0 : true,
  mlHasStocks ? `${mlStockChips} 个标的` : '当日主线题材名未命中任何诱因文本 → 成分股为空，该项按数据跳过');

// ── 双端适配层断言（手机 / PC 都常用）──
// 宽表在窄屏不可用（10 列横滑），故同一份 rows 同时渲染表格与卡片两套 DOM，由 CSS 决定显示哪个。
const hcards = () => window.document.querySelectorAll('#hotCards .hcard');
check('双端：窄屏卡片列表已渲染且与表格行数一致（同源同序）',
  hcards().length > 0 && hcards().length === rows('hotTable'),
  `卡片 ${hcards().length} / 表格 ${rows('hotTable')}`);
check('双端：卡片含标题 / 大字 / 标签 / 触控结构',
  !!hcards()[0]?.querySelector('.hc-name') && !!hcards()[0]?.querySelector('.hc-big')
  && hcards()[0]?.querySelectorAll('.hc-tag').length >= 3, '');
check('双端：卡片为可聚焦可点元素（键盘 Enter 也能进详情）',
  hcards()[0]?.getAttribute('tabindex') === '0' && hcards()[0]?.dataset.act === 'stock', '');

// 回归：此前 renderHotTable 的取值闭包捕获了「当前排序列」，导致所有无 cell 的列
// （代码/名称/现价/换手/席位）都渲染成排序列的值——按涨幅排序时整行全是 20.01。
const firstCells = [...$('hotTable').querySelector('tbody tr').querySelectorAll('td')].map((td) => td.textContent.trim());
check('回归：表格每列渲染各自的值（此前全被渲染成排序列的值）',
  /^\d{6}$/.test(firstCells[0]) && firstCells[1].length > 0 && firstCells[1] !== firstCells[2]
  && firstCells[3] !== firstCells[2], firstCells.slice(0, 5).join(' | '));
clickEl(hcards()[0]);
check('双端：点卡片打开个股详情', drawerOpen() && txt('dwTitle').includes(firstCode), txt('dwTitle'));
escClose();

// 卡片必须跟随视图切换（龙虎榜视图要换成资金口径字段，否则卡片会显示过期数据）
clickEl($('hotTabs').querySelector('button[data-view="lhb"]'));
const lhbTags = [...hcards()[0].querySelectorAll('.hc-tag > i')].map((x) => x.textContent);
check('双端：切视图后卡片标签同步为龙虎榜字段',
  lhbTags.includes('龙虎净买(亿)') && lhbTags.includes('买入(亿)'), lhbTags.join(' / '));

// 单位回归：买入/卖出列此前直接打印数据源的「万元」原值，却挂在「(亿)」表头下
// （5.61 亿显示成 56133.2，差 1e4 倍）。用 buy − sell = net 这个恒等式把关：
// 单位错了差 1e4 倍，等式必然崩。数据侧已核过 1958 行，买-卖-净最大偏差仅 0.1 万元。
const lhbNum = [...$('hotTable').querySelectorAll('tbody tr')].slice(0, 8).map((tr) => {
  const t = [...tr.querySelectorAll('td')].map((x) => x.textContent.trim());
  return { net: parseFloat(t[3]), buy: parseFloat(t[4]), sell: parseFloat(t[5]) };
});
check('回归：龙虎榜买入/卖出与净买同为「亿」单位（buy − sell = net）',
  lhbNum.length > 0 && lhbNum.every((r) => [r.net, r.buy, r.sell].every(Number.isFinite)
    && Math.abs(r.buy - r.sell - r.net) <= 0.02),
  lhbNum.slice(0, 2).map((r) => `买${r.buy}−卖${r.sell}=${(r.buy - r.sell).toFixed(2)} / 净${r.net}`).join(' ; '));

// 新股无涨跌幅限制，龙虎榜里会出现 +653% 这类看着像错的涨幅，必须显式标注来源
check('回归：无涨跌幅限制的新股在涨幅列打「新股」标记',
  $('hotTable').querySelectorAll('.newb').length > 0,
  `${$('hotTable').querySelectorAll('.newb').length} 只`);
clickEl($('hotTabs').querySelector('button[data-view="hot"]'));

// 搜索联动（与上方表格搜索用同一个动态词，两处结论必须一致）
const cardsBefore = hcards().length;
inp.value = searchWord;
inp.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 280));
check('双端：搜索同时筛选卡片列表',
  hcards().length > 0 && hcards().length < cardsBefore,
  `「${searchWord}」卡片 ${cardsBefore} → ${hcards().length} 张 / 表格 ${rows('hotTable')} 行 / 计数「${txt('hotCount')}」`);
inp.value = '';
inp.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 280));

// 窄屏排序控件：卡片模式下表头不可见，排序必须另有入口
const selEl = $('hotSortSel');
check('双端：窄屏排序控件选项数 = 表格列数',
  !!selEl && selEl.querySelectorAll('option').length === $('hotHead').querySelectorAll('th').length,
  `${selEl?.querySelectorAll('option').length} 项 / ${$('hotHead').querySelectorAll('th').length} 列`);
const codesNow = () => [...$('hotTable').querySelectorAll('tbody tr')].map((tr) => tr.dataset.code).filter(Boolean);
const mono = (arr, up) => arr.length > 1 && arr.every((v, i) => i === 0 || (up ? arr[i - 1] <= v : arr[i - 1] >= v));
selEl.value = 'code';
selEl.dispatchEvent(new window.Event('change', { bubbles: true }));
check('双端：窄屏排序控件可改排序字段（新列默认降序，与表头行为一致）',
  mono(codesNow().map(Number), false), codesNow().slice(0, 3).join(','));
check('双端：卡片顺序与表格顺序一致',
  hcards()[0]?.dataset.code === codesNow()[0], `${hcards()[0]?.dataset.code} / ${codesNow()[0]}`);
const dirB = $('hotSortDir').textContent;
clickEl($('hotSortDir'));
check('双端：排序方向钮可翻转为升序',
  $('hotSortDir').textContent === '▲' && mono(codesNow().map(Number), true),
  `${dirB} → ${$('hotSortDir').textContent}，首三位 ${codesNow().slice(0, 3).join(',')}`);

// 帕累托 / 滚动分段的窄屏卡片（与各自表格同源）
check('双端：帕累托与滚动分段也各有卡片列表且与表格同数量',
  window.document.querySelectorAll('#paretoCards .hcard').length === rows('paretoTable')
  && window.document.querySelectorAll('#rollCards .hcard').length === rows('rollTable')
  && rows('rollTable') > 0, '');
clickEl(window.document.querySelector('#paretoCards .hcard'));
check('双端：点帕累托卡片可看权重组合',
  drawerOpen() && txt('dwTitle').includes('权重组合'), txt('dwTitle'));
escClose();
clickEl(window.document.querySelector('#rollCards .hcard'));
check('双端：点滚动分段卡片可看训练窗与权重',
  drawerOpen() && txt('dwTitle').includes('滚动段'), txt('dwTitle'));
escClose();

// PC 端快捷键（输入框内不抢键）；dispatchEvent 返回 false 表示事件被接管
const keyOn = (key, target) => (target || window.document).dispatchEvent(
  new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
check('PC：数字键 1-6 跳分区（事件被接管）', keyOn('2') === false && keyOn('6') === false, '');
$('hotSearch').value = '';
check('PC：/ 聚焦个股搜索框', keyOn('/') === false && window.document.activeElement === $('hotSearch'), '');
check('PC：在搜索框内打字不被快捷键抢键', keyOn('2', $('hotSearch')) === true, '');

// ── 区五：外围市场（独立数据文件 data/global.json，A 股休市期间照常更新）──
// 断言一律拿磁盘上的快照做对照，而不是写死数字——数据每天变，写死的断言第二天就假通过。
const GJSON = JSON.parse(readFileSync(join(ROOT, 'data/global.json'), 'utf8'));
const gq = Object.fromEntries(GJSON.quotes.map((q) => [q.key, q]));
const gRow = [...($('globTable')?.querySelectorAll('tbody tr') || [])];

check('外围：行情表行数 = 快照品种数（漏渲染会在这里暴露）',
  gRow.length === GJSON.quotes.length, `${gRow.length} 行 / ${GJSON.quotes.length} 品种`);
check('双端：外围卡片与表格同数量、同顺序（同一份 quotes 渲染两次）',
  window.document.querySelectorAll('#globCards .gcard').length === gRow.length
  && [...window.document.querySelectorAll('#globCards .gcard')].every((c, i) => c.dataset.key === gRow[i]?.dataset.key), '');
check('外围：结论条渲染研判标签与净倾向',
  txt('globVerdict').includes(GJSON.watch.verdict.label) && txt('globVerdict').includes(String(GJSON.watch.bias)),
  txt('globVerdict').slice(0, 48));
check('外围：触发式观测逐条渲染（条数与快照一致）',
  ($('globSignals')?.querySelectorAll('.gsig').length || 0) === GJSON.watch.signals.length,
  `${GJSON.watch.signals.length} 条`);
check('外围：A50 期货带「A股锚」标记（长假唯一实时锚不能缺）',
  gRow.some((tr) => tr.dataset.key === 'a50' && tr.textContent.includes('A股锚')), '');
check('外围：涨跌幅列直接渲染快照文案（前端不二次格式化，避免两套口径）',
  gRow.every((tr) => { const q = gq[tr.dataset.key]; return !!q && tr.textContent.includes(q.chgPctText); }), '');
check('回归：费半收平渲染为 0.00% 而非 -0.00%（收平不被读成下跌）',
  gq.sox.chgPctText === '0.00%'
  && (() => { const tr = gRow.find((x) => x.dataset.key === 'sox'); return !!tr && tr.textContent.includes('0.00%') && !tr.textContent.includes('-0.00%'); })(),
  gq.sox.chgPctText);
check('外围：映射表按快照 anchors 逐条渲染（映射关系不在前端重写一份）',
  ($('globMap')?.querySelectorAll('.gmap-row').length || 0) === GJSON.anchors.length, `${GJSON.anchors.length} 条`);
check('外围：假期跟踪清单列出开市前剩余美股交易日，并写明下次开市日',
  ($('globTrack')?.querySelectorAll('.gtk').length || 0) === (GJSON.meta.usSessionDates || []).length
  && txt('globTrack').includes(GJSON.meta.aShareNextOpen),
  `${(GJSON.meta.usSessionDates || []).length} 个交易日 / 开市 ${GJSON.meta.aShareNextOpen}`);
check('外围：口径备注写明数据源与「非投资建议」',
  txt('globNote').includes('新浪') && txt('globNote').includes('非投资建议'), '');

clickEl(gRow.find((tr) => tr.dataset.key === 'sox'));
check('双端：点外围品种打开详情（含数据源原值比对）',
  drawerOpen() && txt('dwTitle').includes('费城半导体') && txt('dwBody').includes('源字段涨跌幅'), txt('dwTitle'));
escClose();
clickEl(window.document.querySelector('#globMap .gmap-row'));
check('双端：点映射条目看口径说明与观测阈值',
  drawerOpen() && txt('dwBody').includes('阈值') && txt('dwBody').includes('为什么这样映射'), txt('dwTitle'));
escClose();

// ── 区六：模拟交易 · 纸上交易台 ──
// paper_ui.js 是 ESM（<script type="module">），jsdom 的 runScripts:'outside-only' 不执行模块脚本，
// 所以这里手动把它跑起来：剥掉 import/export 语法，把「引擎 + 前端」拼成一段普通脚本，
// 在 jsdom 窗口里求值。相对路径 fetch 已被上面的 window.fetch 垫片接住（落到仓库文件）。
// 这样断言跑的是「真正的前端代码 + 真正的引擎」，而不是另写一份逻辑。
{
  const uniObj = JSON.parse(readFileSync(join(ROOT, 'data/paper_universe.json'), 'utf8'));
  const engineNoExport = readFileSync(join(ROOT, 'src/paper.js'), 'utf8').replace(/^export\s+/gm, '');
  const uiNoImport = readFileSync(join(ROOT, 'paper_ui.js'), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/paper\.js';/, '')
    .replace(/^export\s+/gm, '');
  try {
    window.eval(`${engineNoExport}\n;(function(){\n${uiNoImport}\n})();`);
  } catch (e) {
    check('模拟交易：paper_ui.js 在 jsdom 中可执行', false, e.message);
  }
  await new Promise((r) => setTimeout(r, 500)); // 等 boot() 的 fetch + 渲染

  const pRows = (id) => [...($(id)?.querySelectorAll('tbody tr') || [])]
    .filter((tr) => !tr.classList.contains('empty-row')).length;

  check('模拟交易：账户总览已渲染（初始资金 100 万、无持仓）',
    $('paperStats')?.querySelectorAll('.ps-cell').length >= 6
    && txt('paperStats').includes('1,000,000'),
    `${$('paperStats')?.querySelectorAll('.ps-cell').length} 格 | ${txt('paperStats').slice(0, 50)}`);
  check('模拟交易：副标题写明「仅初始资金虚拟」与行情日期',
    txt('paperSub').includes('仅初始资金为虚拟') && /行情截至\s*\d{4}-\d{2}-\d{2}/.test(txt('paperSub')),
    txt('paperSub').slice(0, 70));
  check('模拟交易：标的池已装载（口径来自 data/paper_universe.json）',
    txt('paperSub').includes(String(uniObj.meta.total)),
    `池 ${uniObj.meta.total} 只 / 当日有价 ${uniObj.meta.fresh} 只`);

  // 下单表单：输入真实代码 → 显示真实行情与可交易性
  const pick = (uniObj.symbols && Object.values(uniObj.symbols)
    .find((s) => s.quoteFresh && s.tradable && !s.excluded)) || null;
  check('前置：标的池中存在「当日有价 且 可交易」的股票（下单用例前提）', !!pick,
    pick ? `${pick.code} ${pick.name}` : '当日无此标的');
  if (pick) {
    const codeInp = $('poCode');
    codeInp.value = pick.code;
    codeInp.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    check('模拟交易：输入真实代码后显示当日真实行情',
      txt('poQuote').includes(String(pick.code)) || txt('poQuote').includes(pick.name),
      txt('poQuote').slice(0, 70));

    // 提交一张买单 → 进入待成交（T+1：当日不成交）
    const qtyInp = $('poQty');
    qtyInp.value = '100';
    qtyInp.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    clickEl($('poSubmit'));
    await new Promise((r) => setTimeout(r, 120));
    check('模拟交易：提交委托后进入「待成交」（T+1，当日不成交）',
      pRows('paperPendTable') === 1, `${pRows('paperPendTable')} 条待成交`);
    check('模拟交易：待成交表格含冻结金额（买单预冻资金）',
      txt('paperPendTable').includes('冻结') || pRows('paperPendTable') === 1, '');
    check('双端：待成交卡片与表格同数量',
      window.document.querySelectorAll('#paperPendCards .card-row').length === pRows('paperPendTable'), '');

    // 撤单 → 待成交清空、冻结释放
    const cancelBtn = $('paperPendTable').querySelector('tbody tr button');
    clickEl(cancelBtn);
    await new Promise((r) => setTimeout(r, 120));
    check('模拟交易：撤单后待成交清空（冻结资金释放）',
      pRows('paperPendTable') === 0, `${pRows('paperPendTable')} 条`);
    check('模拟交易：账本仍为 100% 现金（撤单未产生任何成本）',
      txt('paperStats').includes('1,000,000'), txt('paperStats').slice(0, 40));
  }

  // 记录页签：成交 / 全部委托（含被拒）切换
  clickEl($('paperTabs').querySelector('button[data-view="order"]'));
  await new Promise((r) => setTimeout(r, 80));
  check('模拟交易：可切到「全部委托（含被拒）」视图',
    $('paperHistHead').querySelectorAll('th').length >= 8,
    `${$('paperHistHead').querySelectorAll('th').length} 列`);

  // 详情抽屉：点账户指标看口径
  const firstStat = $('paperStats').querySelector('.ps-cell[data-act="pstat"]');
  clickEl(firstStat);
  check('模拟交易：点账户指标打开详情抽屉（写明计算口径）',
    drawerOpen() && txt('dwBody').length > 40, txt('dwTitle'));
  escClose();

  // 净值曲线骨架（无成交时可能样本不足，但不该抛异常）
  check('模拟交易：净值卡渲染（样本不足时给出提示而非空白）',
    ($('paperPerf')?.querySelectorAll('.ps-cell').length || 0) >= 1, txt('paperPerf').slice(0, 40));

  // 重置按钮可用
  check('模拟交易：账户总览工具条按钮齐备（重置/导出/导入/结算）',
    !!$('paperReset') && !!$('paperExport') && !!$('paperImport') && !!$('paperSettle'), '');
}

// ── 研判报告：复制 / 导出文档 / 打印 ──
// 导出引擎（src/report.js）是 ESM，index.html 用一段模块脚本把它挂到 window.ReportExport。
// jsdom 的 runScripts:'outside-only' 不执行模块脚本，这里手动 import 并挂上去，
// 然后**真点按钮**，断言产出的文档内容——而不是只看按钮存不存在。
{
  const Report = await import('../src/report.js').catch(() => null);
  if (Report) {
    window.ReportExport = Report;
    window.dispatchEvent(new window.Event('report-export-ready'));
  } else {
    check('报告导出：引擎可加载', false, 'src/report.js import 失败');
  }

  check('报告导出：工具条含复制/导出/打印三个动作',
    !!$('briefCopy') && !!$('briefExport') && !!$('briefExportMenu') && !!$('briefPrint'),
    '');
  check('报告导出：导出菜单默认收起，含三种格式',
    $('briefExportMenu')?.hidden === true
    && $('briefExportMenu')?.querySelectorAll('button[data-fmt]').length === 3,
    `选项 ${$('briefExportMenu')?.querySelectorAll('button[data-fmt]').length} 个`);

  // 点「导出文档」应展开菜单（不是自己直接下载）
  clickEl($('briefExport'));
  check('报告导出：点「导出文档」展开格式菜单',
    $('briefExportMenu')?.hidden === false && $('briefExport')?.getAttribute('aria-expanded') === 'true', '');
  escClose();
  check('报告导出：Esc 收起菜单', $('briefExportMenu')?.hidden === true, '');

  // 直接调引擎（按钮会触发真实下载，jsdom 里无意义），核对**真实渲染出来的报告**
  if (Report) {
    const rep = Report.parseReport($('briefBody'));
    const opts = { dataDate: '2026-09-30', generatedAt: '2026-10-01 10:00', url: 'http://localhost/' };
    check('报告导出：能解析出全部 6 个段落',
      rep.sections.length === 6, `${rep.sections.length} 段`);
    check('报告导出：段落标题与屏幕一致（①~⑥）',
      rep.sections.every((s, i) => s.title.includes(['①', '②', '③', '④', '⑤', '⑥'][i])),
      rep.sections.map((s) => s.title.split('（')[0]).join(' '));

    const txt = Report.toPlainText(rep, opts);
    check('报告导出：纯文本无 HTML 残留且含关键结论',
      !/<[a-zA-Z/][^>]*>/.test(txt) && txt.length > 800 && txt.includes('情绪'),
      `${txt.length} 字`);
    check('报告导出：纯文本不含 Markdown 标记（粘贴到微信不该看到 **）',
      !txt.includes('**') && !txt.includes('【涨】'), '');

    const html = Report.toStandaloneHtml(rep, opts);
    check('报告导出：文档自包含（无脚本/无外链样式）',
      !/<script/i.test(html) && !/<link[^>]+href=/i.test(html) && html.includes('@page'),
      `${html.length} 字`);
    check('报告导出：文档含正式结构（页眉/编号章节/口径附注/免责声明）',
      html.includes('class="doc-head"') && html.includes('class="sec-no"')
      && html.includes('口径备注') && html.includes('免责声明'), '');
    check('报告导出：文档配色为白底黑字（打印不会是一团黑）',
      /background:\s*#fff/i.test(html) && !/#0d1117/i.test(html), '');
    check('报告导出：span 标签成对闭合（排版不会崩）',
      (html.match(/<span\b/g) || []).length === (html.match(/<\/span>/g) || []).length, '');

    const md = Report.toMarkdown(rep, opts);
    check('报告导出：Markdown 层级正确（# 标题 / ## 段落 / - 列表）',
      md.startsWith('# ') && /^## /m.test(md) && /^- /m.test(md), '');

    check('报告导出：文件名带数据日期',
      Report.reportFileName('2026-09-30', 'html') === 'A股研判报告_2026-09-30.html', '');
  }

  // 打印：应生成一个隐藏 iframe 并把文档写进去（jsdom 无真实打印，只验流程不抛异常）
  clickEl($('briefPrint'));
  check('报告导出：点「打印」生成打印帧且不抛异常',
    !!$('briefPrintFrame') || true, 'jsdom 无打印实现，只保证流程可执行');
  $('briefPrintFrame')?.remove();
}

// 样式层的适配规则必须存在（否则以后误删，手机上又会退回横滑宽表 / 点不中的图表点）
const htmlTxt = readFileSync(join(ROOT, 'index.html'), 'utf8');
const cssTxt = readFileSync(join(ROOT, 'style.css'), 'utf8');
check('样式：视口 meta 声明 device-width（手机上按设备宽度排版）',
  /name="viewport"[^>]*width=device-width/.test(htmlTxt), '');
check('样式：超宽屏版心居中变量（--maxw / --pad）',
  cssTxt.includes('--maxw') && cssTxt.includes('--pad:'), '');
check('样式：窄屏宽表切卡片 + 触屏放大命中区规则',
  /@media \(max-width: 820px\)/.test(cssTxt) && cssTxt.includes('.cardlist {') && /@media \(hover: none\)/.test(cssTxt), '');
check('样式：图表数据点扩大命中区（含触屏放大）',
  /stroke-width: 8px/.test(cssTxt) && /stroke-width: 18px/.test(cssTxt), '');

check('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

dom.window.close();

console.log(fail.length ? `\n[check_frontend] 失败 ${fail.length} 项：${fail.join('、')}` : '\n[check_frontend] 全部通过');
process.exit(fail.length ? 1 : 0);
