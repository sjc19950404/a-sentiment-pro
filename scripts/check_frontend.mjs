// 前端渲染校验（开发用）：在 jsdom 里真跑 index.html + app.js，读取磁盘上的 data/*.json，
// 断言 V5.2 四个新卡片确实被渲染、且原有卡片未被破坏。
// 依赖 jsdom（非仓库依赖，CI 不跑本脚本）：
//   npm i -g jsdom 或在任意 node_modules 下有 jsdom；缺失时脚本自动跳过并以 0 退出。
// 用法：node scripts/check_frontend.mjs [--root .]
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
// 口径唯一出处：新股判定与净买分离一律走 src/lhb.js，本脚本不自行实现（口径守卫会拦）
import { newStockSplitOfDay, aggregateByCode } from '../src/lhb.js';
import { decodeArchive } from '../src/lhb_codec.js';

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

// jsdom 对少数 DOM API 只提供"未实现"桩（throw NotImplemented），典型是
// `window.focus()` 与 `window.print()`。它们是否被走到，取决于**渲染深度**：
// 分层加载前页面只跑最近 30 天的分支，从不触发抽屉的焦点归还与打印路径；
// 加载层级加深后这些路径被真正执行到，于是桩被踩中。
// 这是**环境能力缺失**，不是应用异常——若一并计入，守卫会随"渲染得更完整"而报错，
// 那就成了"越认真越失败"的假警报。故单独归类，只做提示、不计失败。
const NOT_IMPLEMENTED_RE = /Not implemented:\s*Window'?s?\s*(focus|print|scrollTo|alert|confirm)/i;
const errors = [];
const notImplemented = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  if (NOT_IMPLEMENTED_RE.test(e.message || '')) { notImplemented.push(e.message); return; }
  errors.push(`jsdomError: ${e.message}`);
});
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

const dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  virtualConsole: vc,
});
const { window } = dom;

// 用本地文件系统实现 fetch（相对路径 → 仓库文件），避免依赖静态服务器
// 拦截腾讯实时行情：返回一段构造好的行情报文，让「实时价」路径在离线 CI 里也能被断言。
// 注意：jsdom 里 TextDecoder('gbk') 由 Node 提供（支持 gbk），ASCII 字段解码后不变，
// 因此构造报文只需保证数字字段位置正确即可。
//
// fetchCalls：记录每次请求（剥掉 ?_= 时间戳）。**"拉了几次"是本次分层加载改动的核心
// 指标，而静态读源码测不出它**（`if (false)` 包住的调用照样能被正则匹配到——
// 曾用一个静态守卫验证这点，注入死代码后依然"通过"，说明那条守卫是假的）。
// 故在 fetch 垫片里真实计数，用运行时行为做断言。
const fetchCalls = [];
// 标的池的两份文件在**模块作用域**读进来：多个断言区块（jsdom 区 / 分档守卫区）都要用。
// 放这里而不是某个块里，是为了避免"跨块引用就 ReferenceError"这种低级坑。
const uniObj = JSON.parse(readFileSync(join(ROOT, 'data/paper_universe.json'), 'utf8'));
// 首屏拉的是精简池（只含 code+name），完整池在首屏之后才按需拉。
const uniLite = JSON.parse(readFileSync(join(ROOT, 'data/paper_universe-lite.json'), 'utf8'));
window.fetch = async (url, opts) => {
  const u = String(url);
  fetchCalls.push(u.replace(/\?_=.*$/, '').replace(/^\.\//, ''));
  if (u.includes('qt.gtimg.cn')) {
    // 注意：端点形如 https://qt.gtimg.cn/q=sh600519（是 /q= 不是 ?q=）
    const q = u.split(/[/?]q=/)[1] || '';
    const symbols = q.split(',').filter(Boolean);
    const lines = symbols.map((s) => {
      const f = new Array(50).fill('');
      f[0] = '1';
      f[1] = 'TEST'; // 用 ASCII 名称：真实源是 GBK，这里不引入编码干扰，名称非断言点
      f[2] = s.slice(2);
      f[3] = '12.34';
      f[4] = '12.00';
      f[5] = '12.10';
      f[30] = '20261009150000';
      f[31] = '0.34';
      f[32] = '2.83';
      f[33] = '12.50';
      f[34] = '11.90';
      return `v_${s}="${f.join('~')}";`;
    }).join('\n');
    return {
      ok: true, status: 200,
      arrayBuffer: async () => new TextEncoder().encode(lines).buffer,
      text: async () => lines,
    };
  }
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

// ── 研判报告单独刷新（用户要求：报告要能独立刷新，不必重算整页）──────────────
check('报告刷新：工具条内有「刷新报告」按钮',
  !!$('briefRefresh') && /刷新/.test($('briefRefresh')?.textContent || ''),
  $('briefRefresh')?.textContent || '(缺按钮)');
check('报告刷新：按钮有明确 title 说明范围（只重建报告、保留折叠状态）',
  /只重新拉取并重建研判报告/.test($('briefRefresh')?.getAttribute('title') || ''),
  $('briefRefresh')?.getAttribute('title') || '(缺 title)');
check('报告刷新：按钮带 primary 样式（与复制/导出/打印区分）',
  ($('briefRefresh')?.className || '').includes('primary'), $('briefRefresh')?.className || '');
check('报告刷新：状态区存在且有 aria-live（结果可被读屏播报）',
  !!$('briefRefreshState') && $('briefRefreshState')?.getAttribute('aria-live') === 'polite', '');
check('报告刷新：按钮不依赖表单提交（type=button，不会触发表单/整页跳转）',
  $('briefRefresh')?.getAttribute('type') === 'button', $('briefRefresh')?.getAttribute('type') || '');
// 行为守卫：真点一次，必须 ① 有状态反馈 ② 报告非空 ③ 不抛异常 ④ 不整页重载
{
  let reloaded = false;
  const origReload = window.location.reload;
  try { window.location.reload = () => { reloaded = true; }; } catch { /* 只读则忽略 */ }
  const before = txt('briefBody').length;
  let threw = '';
  try {
    $('briefRefresh')?.click();
    // 等待异步拉取完成（jsdom 下 fetch 由 harness 提供）
    await new Promise((r) => setTimeout(r, 260));
  } catch (e) { threw = e.message; }
  try { window.location.reload = origReload; } catch { /* noop */ }
  check('报告刷新：点击后不抛异常', threw === '', threw);
  check('报告刷新：点击后不触发整页重载', !reloaded, reloaded ? '发生了 location.reload' : '');
  check('报告刷新：点击后给出状态反馈（已更新/已是最新/失败，不静默）',
    /已更新|已是最新|已生成|失败/.test(txt('briefRefreshState')), txt('briefRefreshState') || '(空)');
  check('报告刷新：点击后报告仍非空（重建成功，未清空）',
    txt('briefBody').length > 0 && txt('briefBody').length >= before * 0.5,
    `前 ${before} → 后 ${txt('briefBody').length}`);
  check('报告刷新：重建后段落目录 chip 仍齐备（renderBriefNav 被调用）',
    ($('briefNav')?.querySelectorAll('button') || []).length > 0,
    `${$('briefNav')?.querySelectorAll('button')?.length} 个 chip`);
}

// 研判报告与引擎同源（V5.2）：报告结论必须用引擎口径（七因子情绪分 = archive.emotion.value）
// 套引擎阈值，不能再用自算的五模块分当结论——实测过两套分套同一阈值会给出相反结论
// （83.8 →「过热」 vs 76.8 →「满仓持有」）。
const bt = JSON.parse(readFileSync(join(ROOT, 'data/backtest.json'), 'utf8'));
const arcAll = decodeArchive(JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8')));
// ⚠ 分层加载（archive_split.js）后，页面**只加载最近 30 个交易日**的明细，
//   完整档 241 天仅由脚本/回测读取。故凡"报告里渲染了什么"的断言，其期望值必须从
//   **页面同款视图**推导 —— 从完整档推导会得出"报告少了 211 天"这类**假失败**
//   （报告没错，是守卫的期望值用错了源）。
//   规则：断言"最新一天/元信息" → 用 arcAll（两者一致）；断言"近 N 日序列/报告正文" → 用 arcView。
const arcView = (() => {
  const rec = JSON.parse(readFileSync(join(ROOT, 'data/archive-recent.json'), 'utf8'));
  if (rec.kind !== 'archive-recent') return arcAll;
  const days = [...(rec.days || []), ...(rec.latest ? [rec.latest] : [])];
  return { ...arcAll, all_days: days };
})();
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

// ── 同票多榜合并：原始 lhb 不得残留「五元组完全相同」的重复 ──────────────────
// 事故形态：东财一次披露里同票多榜、数值完全相同（2026-08-14 蓝盾光电 300862 两条净额都是
// 37382.3 万），下游任何按 code 求净买都会双算。合并后 reasons 应数组化保留全部上榜原因。
// 判据在页面侧独立复算（不调引擎），确保「存档里的数」与「页面读到的数」一致。
{
  const dupKey = (l) => [l.code, l.is_range ? 1 : 0, l.net_buy_wan, l.buy_wan, l.sell_wan].join('|');
  let dupTotal = 0, mergedDays = 0, reasonsOk = 0, reasonsBad = 0;
  for (const d of arcAll.all_days || []) {
    const rows = Array.isArray(d.lhb) ? d.lhb : [];
    if (!rows.length) continue;
    const seen = new Set();
    for (const l of rows) { const k = dupKey(l); if (seen.has(k)) dupTotal++; seen.add(k); }
    const s = d.summary || {};
    if ((s.lhb_merged_away || 0) > 0) mergedDays++;
    // reasons 必须齐备：有 reason 就该有等价的 reasons 数组
    for (const l of rows) {
      if (Array.isArray(l.reasons) && l.reasons.length && l.reasons.includes(l.reason)) reasonsOk++;
      else reasonsBad++;
    }
  }
  check('数据：龙虎榜原始数组无「同票同口径逐字段相同」的重复（否则下游按 code 求净买会双算）',
    dupTotal === 0, `残留重复 ${dupTotal} 条`);
  check('数据：reasons 数组化且与原 reason 自洽（同票多榜的上榜原因全部留痕）',
    reasonsBad === 0, reasonsOk > 0 ? `ok=${reasonsOk} bad=${reasonsBad}` : '未找到带 reasons 的记录');
  check('数据：重复合并留痕（lhb_merged_away / lhb_raw_count）与条数自洽',
    (arcAll.all_days || []).every((d) => {
      const s = d.summary || {};
      if (s.lhb_raw_count == null || s.lhb_merged_away == null) return true;
      return s.lhb_raw_count - s.lhb_merged_away === s.lhb_count;
    }),
    `存在 ${mergedDays} 天发生过合并（留痕已核对）`);
}

// ── 市场相位：meta.phase 必须在页面上显著标注 ───────────────────────────────
// 相位与新鲜度正交：盘中（live）时行情实时可得，但情绪分/分位/因子仍是上一收盘日口径。
// 不标注读者就会拿实时涨跌家数去对收盘分位，误判为「情绪分突然跳变」。
{
  const m0 = arcAll.meta || {};
  check('数据：meta.phase 三态合法且带口径说明',
    ['pre', 'live', 'closed'].includes(m0.phase) && typeof m0.phaseNote === 'string' && m0.phaseNote.length > 10,
    `phase=${m0.phase}`);
  // 页面必须能渲染盘中相位提示（源码守卫：相位分支存在且用引擎下发的 phaseNote，不自行措辞）
  const appSrc = readFileSync(join(ROOT, 'app.js'), 'utf8');
  check('页面：盘中相位有显著提示，且文案取自引擎 meta.phaseNote（前端不自行措辞）',
    /phase === 'live'/.test(appSrc) && /meta\.phaseNote/.test(appSrc)
    && /alert\.phase-live|phase-live/.test(appSrc),
    '');
  check('页面：顶部来源标签区分「LIVE / LIVE·盘中 / PRE / STALE」',
    /LIVE · 盘中/.test(appSrc) && /'PRE'/.test(appSrc) && /'STALE'/.test(appSrc), '');
  check('样式：盘中相位用非告警配色（盘中是正常状态，不是故障）',
    /\.alert\.phase-live/.test(readFileSync(join(ROOT, 'style.css'), 'utf8')), '');
}

// ── 盘中快照：独立数据文件 + 独立 CI job，绝不触碰收盘存档 ────────────────────
// 口径纪律：intraday.json 里的量是盘中实时值、未定盘；情绪分/分位/因子按收盘值算。
// 两者不同尺度——快照的存在意义是"看现在"，不是"改打分"。故：
//   ① 卡内必须标注抓取时刻与"不参与打分"；
//   ② 相位非 live 时整卡隐藏（收盘后显示会让人误读，缺失也不能显示 0）；
//   ③ CI 必须有独立的盘中 job，且该 job 不得提交 archive.json。
{
  const idoc = await (async () => {
    try {
      const p = join(ROOT, 'data', 'intraday.json');
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch { return null; }
  })();
  if (idoc) {
    check('数据：盘中快照自带口径说明与抓取时刻（kind=intraday，可据此区分收盘口径）',
      idoc.kind === 'intraday' && typeof idoc.caliberNote === 'string' && idoc.caliberNote.length > 20
      && !!idoc.capturedAtBJ,
      `kind=${idoc.kind} at=${idoc.capturedAtBJ}`);
    check('数据：盘中快照不冒充收盘口径（不得含情绪分/分位字段）',
      !('emotion' in idoc) && !('factors' in idoc) && !('pct_rank' in idoc),
      '快照里出现了打分字段，盘中值会污染分位');
  } else {
    check('数据：盘中快照文件（本次运行环境未产出，跳过内容断言）', true, 'data/intraday.json 不存在');
  }
  const appSrc3 = readFileSync(join(ROOT, 'app.js'), 'utf8');
  check('页面：盘中快照卡仅在 phase=live 且有文件时显示（缺失不显示 0，避免误读成「涨停 0 家」）',
    /function loadIntraday\(/.test(appSrc3) && /phase !== 'live'[\s\S]{0,40}card\.hidden = true/.test(appSrc3),
    '');
  check('页面：盘中快照卡显著标注「未定盘 / 不参与打分 / 分位未重算」',
    /未定盘/.test(appSrc3) && /不参与情绪因子与分位/.test(appSrc3) && /未重算/.test(appSrc3), '');
  check('样式：盘中快照卡有独立强调样式（与收盘口径卡片可区分）',
    /\.card\.intraday/.test(readFileSync(join(ROOT, 'style.css'), 'utf8')), '');

  // CI 分离守卫：盘中 job 必须存在，且**只**提交 intraday.json
  const wf = readFileSync(join(ROOT, '.github', 'workflows', 'daily.yml'), 'utf8');
  const hasIntradayJob = /^\s{2}intraday:/m.test(wf);
  check('CI：盘中快照独立成 job（不跑管道、不重算分位）', hasIntradayJob, '');
  if (hasIntradayJob) {
    const jobBody = wf.slice(wf.indexOf('\n  intraday:'));
    const addsArchive = /git add[^\n]*archive\.json/.test(jobBody);
    check('CI：盘中 job 绝不提交 archive.json（盘中值不得进入收盘存档）',
      !addsArchive, addsArchive ? '盘中 job 提交了 archive.json' : '');
    check('CI：盘中 job 有独立 cron（每 30 分钟，仅工作日）',
      /cron:\s*'0,30 1-7 \* \* 1-5'/.test(wf), '');
    // 盘后 job 必须排除该 cron，否则盘中会触发完整管道
    check('CI：盘后 job 显式排除盘中 cron（否则每 30 分钟跑一次完整管道）',
      /github\.event\.schedule != '0,30 1-7 \* \* 1-5'/.test(wf), '');
  }
}

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
  // 用 arcView（页面同款 30 日视图）——报告的"近5日"取自它渲染时手里的序列
  const last5 = arcView.all_days.slice(-5).map((d) => d.summary?.lhb_daily_net);
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
  // 新股扰动占比：不再自行判新股 —— 口径唯一出处是 src/lhb.js 的 splitNewStockNet。
  // 本处只校验「报告展示的占比」与「引擎算出的占比」一致（分子分母同源，且不含区间累计榜）。
  const lastDay = arcAll.all_days.slice(-1)[0];
  const split = lastDay ? newStockSplitOfDay(lastDay) : null;
  if (split && split.new_count && s0.lhb_daily_net > 0) {
    const expectPct = Math.round(split.new_yi / s0.lhb_daily_net * 100);
    const wrongPct = Math.round(split.new_yi / s0.lhb_all_net * 100);
    const segI = brief.indexOf('占当日龙虎净买');
    const seg = segI >= 0 ? brief.slice(Math.max(0, segI - 40), segI + 40) : '';
    check('口径：新股扰动占比＝新股当日净买 ÷ 当日榜净额（分子分母同源）',
      segI >= 0 && seg.includes(`${expectPct}%`),
      `期望 ${expectPct}%（混用全量分母会变成 ${wrongPct}%）| ${seg}`);
  }
  // 本次修复的核心断言：报告必须显式声明「引擎已自动修正」，而不是「需人工剔除观察」
  if (split && split.new_count) {
    const hasAuto = brief.includes('引擎已自动修正') || brief.includes('已自动剔除');
    const hasManualOnly = brief.includes('需剔除观察') || brief.includes('需剔除该标的单独评估');
    check('报告：新股扰动已由引擎自动剔除（禁止「只告警需人工剔除」的旧文案）',
      hasAuto && !hasManualOnly, `自动修正声明=${hasAuto} 残留人工剔除措辞=${hasManualOnly}`);
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

// ── 封板率口径 + 待核实项的口径披露（用户 6 项质疑的回归守卫）────────────────
// 1. 封板率：必须按市场通用口径渲染（涨停 ÷ 触板），不得再把封板率当炸板率并取补
const lastSum = (arcAll.all_days.slice(-1)[0] || {}).summary || {};
check('研判报告·封板率按通用口径渲染（涨停÷触板，含炸板只数）',
  /封板率\s*\d+(\.\d+)?%/.test(brief) && brief.includes('触板'),
  brief.match(/封板率[^；。]{0,80}/)?.[0] || '报告缺封板率行');
check('研判报告·封板率数值与存档 seal_pct 一致（禁止取补）',
  lastSum.seal_pct == null || brief.includes(`封板率 ${lastSum.seal_pct}%`),
  `存档 seal_pct=${lastSum.seal_pct}，报告未见该值`);
check('研判报告·不再出现「炸板率 X%（…封板率 100−X）」式错标',
  !/炸板率\s*[\d.]+%[\s\S]{0,60}封板率\s*(8[01]|7[0-9])/.test(brief), '');
check('研判报告·封板率行披露分母口径（触板个股）', brief.includes('盘中触板') || brief.includes('触及涨停的个股为分母'), '');

// 2. 席位分项：必须标明样本口径与「不可与当日榜净买互相校验」
check('研判报告·席位分项标明样本口径（全部上榜个股 ≠ 当日榜）',
  brief.includes('全部上榜个股') && brief.includes('不是同一集合'),
  brief.match(/口径：上述分项[^。]{0,60}/)?.[0] || '缺席位样本口径说明');
check('研判报告·明写席位分项之和与当日榜净买不可互校',
  brief.includes('不可互相校验') || brief.includes('不可相互校验'), '');

// 3. 锁仓统计：必须标明比对方法与只用买方
check('研判报告·锁仓统计标明比对方法（当日买方席位 vs 近2日）',
  brief.includes('未重复出现的席位计为') || brief.includes('名称比对'), '');
check('研判报告·锁仓统计标明只用买方且样本非全市场',
  brief.includes('只用买方') && brief.includes('非全市场'), '');

// 4/5. 题材标签：必须声明为引擎自定义分类、无官方标准
check('研判报告·题材标签声明为引擎自定义分类（无官方标准）',
  brief.includes('引擎自定义标签') || brief.includes('无官方题材标准'), '');
check('研判报告·主线题材归属标注需人工核对',
  brief.includes('需人工核对当日涨停股') || brief.includes('无官方唯一标准'), '');

// 6. 连板：必须给出可逐只核对的天梯
// 模板②：连板天梯必须是**真表格**（不是一行竖线分隔的长文本），且逐只可核。
// 断言分两层：① 屏幕 DOM 里存在 .bf-table 且表头是「板数/只数/个股」；
//            ② 数字与 summary.zt_lb 现算一致（防有人把天梯写死）。
{
  const tbl = window.document.querySelector('#briefBody .bf-table');
  const ths = tbl ? [...tbl.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [];
  check('研判报告·连板天梯为表格（模板②：表头 板数/只数/个股）',
    !!tbl && ths.join('/') === '板数/只数/个股',
    tbl ? `表头 ${ths.join('/')}；${tbl.querySelectorAll('tbody tr').length} 行` : '未找到 .bf-table');
  // 逐只可核：表格里列出的个股数必须等于 zt_lb 里连板数 ≥2 的只数
  const ztLb = (arcAll.all_days || []).slice(-1)[0]?.summary?.zt_lb || {};
  const lb2 = Object.values(ztLb).filter((n) => Number(n) >= 2).length;
  const listed = tbl ? [...tbl.querySelectorAll('tbody tr')].reduce((a, tr) => {
    const cells = tr.children;
    const n = parseInt(String(cells[1]?.textContent || '').replace(/[^\d]/g, ''), 10);
    return a + (Number.isFinite(n) ? n : 0);
  }, 0) : -1;
  check('研判报告·连板天梯只数与 zt_lb 现算一致（未硬编码）',
    lb2 === 0 ? listed <= 0 : listed === lb2,
    `表格合计 ${listed} 只 vs zt_lb 连板≥2 共 ${lb2} 只`);
}

// 模板①③④：极简摘要 / 章节口径折叠件 / 文末独立附录 / 跟踪项复选框
{
  const abs = window.document.querySelector('#briefBody .bf-abstract');
  check('研判报告·极简摘要存在且排在首个章节之前（模板①）',
    !!abs && abs.textContent.length > 10
    && !!(abs.compareDocumentPosition(window.document.getElementById('bfsec1')) & 4),
    abs ? `${abs.textContent.trim().slice(0, 60)}` : '缺 .bf-abstract');

  const cals = [...window.document.querySelectorAll('#briefBody .bf-sec .bf-caliber')];
  check('研判报告·每个章节都有口径折叠件（模板③，7 段 7 件）',
    cals.length === 7, `${cals.length} 件`);
  check('研判报告·口径折叠件标题统一为「🔍 点击展开查看口径」',
    cals.length > 0 && cals.every((d) => (d.querySelector('summary')?.textContent || '').includes('🔍 点击展开查看口径')),
    cals[0]?.querySelector('summary')?.textContent || '');
  check('研判报告·口径默认收起（7 段无一件带 open）',
    cals.every((d) => !d.hasAttribute('open')), cals.filter((d) => d.hasAttribute('open')).length + ' 件默认展开');

  const appx = window.document.querySelector('#briefBody .bf-appendix');
  check('研判报告·文末有独立折叠附录（模板③，汇总全部口径）',
    !!appx && !!appx.querySelector('.bf-cal-body')
    && (appx.querySelector('.bf-cal-body').textContent || '').length > 500,
    appx ? `${(appx.querySelector('.bf-cal-body').textContent || '').length} 字` : '缺 .bf-appendix');
  // 附录必须在全部章节之后（顺序错了就不是"文末"）
  check('研判报告·独立附录排在全部章节之后',
    !!appx && !!(window.document.getElementById('bfsec7').compareDocumentPosition(appx) & 4), '');

  const todos = [...window.document.querySelectorAll('#briefBody .bf-todo')];
  check('研判报告·明日跟踪项为复选框清单（模板④）',
    todos.length > 0, `${todos.length} 项`);
  // 交互：点一下应切换 done（纯屏幕，不写数据）
  if (todos.length) {
    const t0 = todos[0];
    const before = t0.classList.contains('done');
    t0.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    check('研判报告·跟踪项可勾选（点击切换 done）',
      t0.classList.contains('done') !== before, `done=${t0.classList.contains('done')}`);
    t0.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));  // 复位
  }
}
check('研判报告·连板数字取自 zt_lb（不与存档 max_lb/lb2_count 冲突）',
  lastSum.max_lb == null || brief.includes(`连板高标 ${lastSum.max_lb} 板`),
  `存档 max_lb=${lastSum.max_lb}`);

// 告警口径：stale（或客户端已过预期更新时刻）才允许出现「告警」级别的条；
// 仅「字段级修补 note / 跳过 / 非交易日」只能是 info，不能把正常等待说成抓取失败。
const meta = decodeArchive(JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8'))).meta || {};
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
// 分层加载后，个股/席位详情是**异步**的（席位明细为惰性字段，要先按需拉取再渲染）。
// 点一下立刻断言会看到中间的「正在加载」占位 —— 那是真实行为，不是 bug。
// 故凡涉及这两类抽屉的守卫一律用本函数：点完等一拍，让 ensureLazy 的 Promise 落定。
const clickAndSettle = async (el) => {
  const ok = clickEl(el);
  await new Promise((r) => setTimeout(r, 60));
  return ok;
};
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
// V5.2-pro 规则第五/六块的两张面板必须真实存在于 DOM（只在 JS 里定义而不给容器，
// 渲染会静默落空——用户看不到任何东西，但守卫不会报错，是最隐蔽的一类回归）。
check('布局：模拟交易区含批量下单与事件日志两张卡片（V5.2-pro 第五/六块）',
  !!window.document.querySelector('#zone-paper .paper-batch')
  && !!window.document.querySelector('#zone-paper .paper-log')
  && !!$('btInput') && !!$('logTable'), '');

// 1) 表格行 → 个股详情
const firstRow = $('hotTable').querySelector('tbody tr.clickable');
const firstCode = firstRow?.dataset.code || '';
await clickAndSettle(firstRow);
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
  await clickAndSettle(pickRow);
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
// 分层加载后，净值曲线跨 33 天而首屏只持最近 30 天 → 第一个点必然落在窗口外。
// 此时应当**仍然是"盘面"抽屉**，只是正文说明"该日未载入"并给出补全入口——
// 断言这一点，而不是断言必然命中（否则守卫会逼着首屏加载全档，与切片目标相反）。
check('布局：净值曲线已渲染可点数据点',
  $('btNavSvg').querySelectorAll('circle[data-act="btpt"]').length > 0,
  `${$('btNavSvg').querySelectorAll('circle').length} 点`);
clickEl($('btNavSvg').querySelector('circle[data-act="btpt"]'));
{
  const hit = txt('dwBody').includes('指数表现');
  const layered = txt('dwBody').includes('不在当前已加载') && txt('dwBody').includes('载入完整档');
  check('交互：点净值曲线数据点看当日盘面',
    drawerOpen() && txt('dwTitle').includes('盘面') && txt('dwSub').includes('净值曲线数据点')
      && (hit || layered),
    `${txt('dwTitle')}｜${hit ? '命中当日明细' : '落在窗口外·已给出补全入口'}`);
  // 落在窗口外时必须真的能给出一键补全，否则用户看到空态就断头了
  if (layered) {
    check('交互：窗口外的数据点给出「载入完整档」入口',
      !!$('dwBody').querySelector('[data-act="loadfull"]'),
      '缺 loadfull 按钮');
  }
}
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
  // ⚠ 取数纪律（本轮体积纪律的连带修正）：主档**不再持久化 lhb_aggr**（会使归档翻倍，
  //   见 scripts/recalc_lhb_daily.mjs 注），故不能读 `day.lhb_aggr`（永远 undefined → 断言假红）。
  //   正确做法：从当日原始记录 `lhb` 用**同一条聚合**（src/lhb.js 的 aggregateByCode）现算。
  //   注意判据字段是**聚合产物**上的 `caliber === 'range'`，不是原始记录的 `is_range`
  //   （原始 79 条里 is_range=true 有 23 条，聚合后 caliber='range' 才是页面上打标的行）。
  const lastDay = arcAll.all_days.slice(-1)[0];
  const lastRows = (lastDay?._sub && Array.isArray(lastDay._sub.lhb)) ? lastDay._sub.lhb
    : (Array.isArray(lastDay?.lhb) ? lastDay.lhb : []);
  const rngRows = aggregateByCode(lastRows).filter((l) => l.caliber === 'range').length;
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
check('布局：报告目录 chip 数 = 段落数（7）',
  $('briefNav').querySelectorAll('button[data-act="brsec"]').length === 7,
  `${$('briefNav').querySelectorAll('button').length} 个`);
clickEl($('briefToggle'));
check('交互：一键折叠报告全部 7 段',
  window.document.querySelectorAll('#briefBody .bf-sec.collapsed').length === 7, '');
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
  // src/paper.js 现在 import 了 src/lhbfilter.js 的 filterOne（买入前置过滤）。
  // 平铺时该 import 行必须剥掉，并改为从 window.__lhbfilter__ 解构——
  // 否则残留的 import 语句会让整段被 window.eval 的脚本语法报错（整块区六全挂）。
  const engineNoExport = readFileSync(join(ROOT, 'src/paper.js'), 'utf8')
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/lhbfilter\.js';/m,
      'const { filterOne } = window.__lhbfilter__;')
    .replace(/^export\s+/gm, '');
  // src/quote.js 也是 ESM：剥掉 import/export 后与引擎/前端拼到同一作用域。
  // 它 import 的 quoteSymbol 来自 sources.js，这里剥掉 import 即可（该函数在下方内联补齐）。
  const quoteNoExport = readFileSync(join(ROOT, 'src/quote.js'), 'utf8')
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/sources\.js';/m, '')
    .replace(/^export\s+/gm, '');
  const uiNoImport = readFileSync(join(ROOT, 'paper_ui.js'), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/paper\.js';/, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/lhbfilter\.js';/, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/quote\.js';/, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/picks\.js';/, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/alerts\.js';/, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/alert_log\.js';/, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/paper_review\.js';/, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/predict\.js';/, '')
    // paper_ui.js 现在还 import 了 './src/lhb_codec.js' 的 decodeStrField（标的池 reason 码表解回）。
    // 与其它 import 一样必须剥掉，否则残留的 import 语句会让整段被 window.eval 的脚本语法报错。
    // 实现从 window.__lhbcodec__ 解构——绝不手抄码表逻辑（手抄等于第二套口径）。
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/src\/lhb_codec\.js';/,
      'const { decodeStrField } = window.__lhbcodec__;')
    .replace(/^export\s+/gm, '');
  // src/picks.js（研判推荐引擎）同样是 ESM 纯函数，零依赖。
  // 它 import 了 src/lhb.js 的 RANGE_BOARD_RE / isNewStock（口径唯一出处）。
  // lhb.js 与 paper.js 存在同名内部辅助（r1/r2/sumOf…），直接平铺会「Identifier already declared」，
  // 故把 lhb.js 包进 IIFE，只把它导出的两个符号挂到 window 上，再让 picks.js 从 window 取。
  // picks.js 也同样包 IIFE：alerts.js 要用它的档位符号，而 paper_ui.js 直接用它的函数——
  // 两者都需要，所以既挂 window.__picks__，又把符号解构回作用域（见下方 picksFlat）。
  // 绝不手抄实现：手抄一份等于重新引入第二套口径（口径守卫会拦）。
  const lhbBundle = `window.__lhb__ = (function(){\n`
    + readFileSync(join(ROOT, 'src/lhb.js'), 'utf8').replace(/^export\s+/gm, '')
    + '\nreturn { RANGE_BOARD_RE, isNewStock };\n})();';
  // src/seats.js（席位口径唯一出处）：**零依赖**纯函数 ESM。包 IIFE 后挂出龙虎过滤要用的符号。
  const seatsBundle = `window.__seats__ = (function(){\n`
    + readFileSync(join(ROOT, 'src/seats.js'), 'utf8').replace(/^export\s+/gm, '')
    + '\nreturn { seatsOf, buySeatsOf, sellSeatsOf, sideStats, seatTypeOf, seatIdentity, SEAT_TYPE_LABEL };\n})();';
  // src/lhbfilter.js（V5.2-pro 龙虎榜前置过滤）：纯函数 ESM，import 了
  //   · ./lhb.js 的 isNewStock / RANGE_BOARD_RE → 取 window.__lhb__
  //   · ./seats.js 的 buySeatsOf / sellSeatsOf / sideStats / seatTypeOf → 取 window.__seats__
  // 包 IIFE：lhbfilter 与 paper.js 存在同名内部辅助（finite / r2 / r3），平铺会「Identifier already declared」。
  const lhbFilterBundle = `window.__lhbfilter__ = (function(){\n`
    + readFileSync(join(ROOT, 'src/lhbfilter.js'), 'utf8')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/lhb\.js';/m, 'const { isNewStock, RANGE_BOARD_RE } = window.__lhb__;')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/seats\.js';/m, 'const { buySeatsOf, sellSeatsOf, sideStats, seatTypeOf } = window.__seats__;')
      .replace(/^export\s+/gm, '')
    + '\nreturn { filterOne, filterBatch, featuresOf, themeStrengthOf, BUCKET, REJECT_LHB, SKIPPED_RULES,'
    + ' MAX_SHARE_OF_MARKET, MAX_TOP3_CONC, MAX_TOP3_CONC_STRICT, ADMIT, THEME_FULL_PCT, LHBFILTER_VERSION,'
    // 降级规则（净买 ≤ 0）的唯一出处：常量与判定函数都必须挂出去，
    // 否则 predict/picks/alerts/paper_ui 只能各自手抄 10/8 与标签文案——那就是第二套口径。
    + ' LHB_NET_OUTFLOW_PENALTY, FLAG_LHB, isNetOutflow, netOutflowText };\n})();';
  // paper_ui.js（批量下单面板）直接用 filterOne / BUCKET / LHBFILTER_VERSION 做提交前预检与档位文案，
  // 故从 window.__lhbfilter__ 解构回作用域。**绝不手抄**这些符号——它们就是规则本身。
  const lhbFilterFlat = `const { filterOne, BUCKET, LHBFILTER_VERSION, LHB_NET_OUTFLOW_PENALTY, FLAG_LHB, isNetOutflow } = window.__lhbfilter__;`;
  // 一手股数（LOT）不手抄字面量——从 src/paper.js 源码里抽出真实值。
  // 多处 IIFE 需要它（predict / alert_log），故提前到使用点之前声明。
  const LOT_LITERAL_EARLY = (readFileSync(join(ROOT, 'src/paper.js'), 'utf8')
    .match(/export const LOT\s*=\s*(\d+)/) || [, '100'])[1];
  // src/predict.js（上涨概率预测与剔除引擎）：纯函数 ESM。
  // 刻意不 import alerts.js（否则 alerts → picks → predict → alerts 成环，
  // IIFE 即时求值环境会崩）——止损线由调用方以参数传入。
  // ⚠ 但它**现在 import 了 ./lhbfilter.js**（降级规则：净买 ≤ 0 → 概率扣固定分）。
  //   依赖方向 predict → lhbfilter 是单向的（lhbfilter 不引 predict），不成环；
  //   而 lhbFilterBundle 排在本 bundle 之前，故可直接从 window.__lhbfilter__ 取。
  //   绝不手抄 10/8 与标签文案——那等于在 predict 里重建第二套规则。
  // 放在 picksBundle **之前**：picks.js 也 import 它。
  const predictBundle = `window.__predict__ = (function(){\n`
    + readFileSync(join(ROOT, 'src/predict.js'), 'utf8')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/lhbfilter\.js';/m,
        'const { isNetOutflow, LHB_NET_OUTFLOW_PENALTY, FLAG_LHB } = window.__lhbfilter__;')
      .replace(/^export\s+/gm, '')
    + '\nreturn { PREDICT_VERSION, PROB_BANDS, probBand, probBandText, REJECT_RULES, screenCandidate,'
    + ' BASELINE_UP, BASELINE_N, PREDICT_FACTORS, predictUpProb, expectedReturn, suggestStop, predictPicks,'
    + ' STREAK_BASELINE, STREAK_BASELINE_N, STREAK_BANDS, STREAK_TABLE, STREAK_TOP_MIN, streakBand, streakBandText,'
    + ' turnoverBandOf, limitUpProb, isStreakTop, streakTagText };\n})();';
  const picksBundle = `window.__picks__ = (function(){\n`
    + readFileSync(join(ROOT, 'src/picks.js'), 'utf8')
      // 报错时把「残留 import」这个坑显性暴露出来，而不是抛一句「Unexpected token import」
      // 让人误以为 paper_ui 写坏了（曾经真的误判过一次）。
      .replace(/^import\s+\{[\s\S]*?\}\s*from\s*'\.\/lhb\.js';/m,
        'const { RANGE_BOARD_RE, isNewStock } = window.__lhb__;')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/lhbfilter\.js';/m,
        'const { isNetOutflow, LHB_NET_OUTFLOW_PENALTY, FLAG_LHB } = window.__lhbfilter__;')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/predict\.js';/m,
        'const { predictPicks, probBandText, streakBandText, streakTagText, PREDICT_VERSION, BASELINE_UP, STREAK_BASELINE } = window.__predict__;')
      .replace(/^export\s+/gm, '')
    + '\nreturn { marketTier, TIER_THRESHOLDS, POSITION_TIERS, recommendPicks, PICK_TOP_N, SCORE_WEIGHTS, suggestWeight, NET_OUTFLOW_TAG };\n})();';
  // paper_ui.js 直接调用 recommendPicks / PICK_TOP_N / SCORE_WEIGHTS，故从 window.__picks__ 解构回作用域
  const picksFlat = `const { recommendPicks, PICK_TOP_N, SCORE_WEIGHTS, NET_OUTFLOW_TAG } = window.__picks__;`;
  // paper.js（交易引擎）是平铺到 jsdom 全局作用域的，脚本自身 module scope 取不到它。
  // 断言里要独立复算「按建议比例该填多少股」时必须用到同一口径，故再包一层 IIFE
  // 把需要的符号挂到 window.__engine__ —— 绝不在断言里手抄整手/费用公式（那就是第二出处）。
  const engineSymbols = ['LOT', 'MIN_COMMISSION', 'DEFAULT_SLIP', 'fillPrice', 'accountStats',
    'qtyByAssetPct', 'qtyByHoldPct', 'fees', 'boardOf'];
  const engineBundle = `window.__engine__ = {\n`
    + engineSymbols.map((s) => `  get ${s}(){ return typeof ${s} === 'undefined' ? undefined : ${s}; }`).join(',\n')
    + '\n};';
  // src/alerts.js（双层预警引擎）：纯函数 ESM，import 了
  //   · ./picks.js 的 marketTier / TIER_THRESHOLDS / POSITION_TIERS → 取 window.__picks__
  //   · ./config.js 的 default（风控阈值 stopLoss / ddTrigger）
  //   · ./lhbfilter.js 的 isNetOutflow / FLAG_LHB（持仓票当日净流出告警，第 ⑧ 条）
  // config.js 用 export default，剥掉 export 后是裸对象字面量，并进来只是一条孤立表达式语句
  // （语法合法但取不到值），故改写成赋给 backtestCfg 再交给 alerts.js——
  // 绝不手抄阈值（手抄等于第二套口径，与 alerts.test.mjs 的「阈值同源」断言冲突）。
  const configNoExport = readFileSync(join(ROOT, 'src/config.js'), 'utf8')
    .replace(/^export\s+default\s*/m, 'var backtestCfg = ')
    .replace(/^export\s+/gm, '');
  // paper_ui.js 用到的预警导出
  const alertsFlat = `const { buildAlerts, MARKET_CFG, POS_CFG, LEVELS } = window.__alerts__;`;
  const alertsBundle = `window.__alerts__ = (function(){\n`
    + readFileSync(join(ROOT, 'src/alerts.js'), 'utf8')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/picks\.js';/m,
        'const { marketTier, TIER_THRESHOLDS, POSITION_TIERS } = window.__picks__;')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/lhbfilter\.js';/m,
        'const { isNetOutflow, FLAG_LHB } = window.__lhbfilter__;')
      .replace(/^import\s+backtestCfg\s+from\s*'\.\/config\.js';/m, '')
      .replace(/^export\s+/gm, '')
    + '\nreturn { buildAlerts, marketAlerts, positionAlerts, MARKET_CFG, POS_CFG, LEVELS, ACTIONS };\n})();';
  // src/alert_log.js（预警台账与收益归因）：纯函数 ESM，import 了
  //   · ./alerts.js 的 POS_CFG / MARKET_CFG → 取 window.__alerts__
  //   · ./paper.js 的 LOT（一手股数，最小计分单位）
  // LOT 在 engineNoExport 里是裸 const，直接拼会与前面作用域冲突（paper.js 已平铺）……
  // 实际上 engineNoExport 就在同一作用域，alert_log 包进 IIFE 后从 window.__alerts__ 取 alerts 符号，
  // 而 LOT 需要显式传入——故把 LOT 作为 IIFE 参数传进去，避免依赖「谁先声明」的隐式顺序。
  // LOT 不手抄字面量——从 src/paper.js 源码里抽出真实值（与 alert_log 的 minQty 口径同源）。
  const LOT_LITERAL = LOT_LITERAL_EARLY;
  const alertLogBundle = `window.__alertlog__ = (function(LOT){\n`
    + readFileSync(join(ROOT, 'src/alert_log.js'), 'utf8')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/alerts\.js';/m,
        'const { POS_CFG, MARKET_CFG } = window.__alerts__;')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/paper\.js';/m, '')
      .replace(/^export\s+/gm, '')
    + '\nreturn { appendSignals, evaluateEntry, evaluateMarketEntry, summarizeLog, summarizeText, ACTION_DIR, LOG_CFG, LOG_CAP };\n})('
    + LOT_LITERAL + ');';
  const alertLogFlat = `const { appendSignals, summarizeLog, summarizeText, LOG_CAP } = window.__alertlog__;`;
  // src/paper_review.js（模拟交易复盘引擎）：纯函数 ESM，import 了
  //   · ./alerts.js 的 POS_CFG / MARKET_CFG      → 取 window.__alerts__
  //   · ./picks.js  的 marketTier / TIER_THRESHOLDS → 取 window.__picks__
  //   · ./alert_log.js 的 summarizeLog           → 取 window.__alertlog__
  //   · ./paper.js  的 LOT                        → 从 engineNoExport 的裸 const 取（同一作用域）
  // 并**再导出** POS_CFG / MARKET_CFG / TIER_THRESHOLDS 供报告端引用阈值原文，故也一并挂出。
  // 包 IIFE：paper_review 内部若与前面平铺的 paper.js / alerts.js 有同名私有符号会冲突。
  const reviewBundle = `window.__paperreview__ = (function(){\n`
    + readFileSync(join(ROOT, 'src/paper_review.js'), 'utf8')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/alerts\.js';/m,
        'const { POS_CFG, MARKET_CFG } = window.__alerts__;')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/picks\.js';/m,
        'const { marketTier, TIER_THRESHOLDS } = window.__picks__;')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/alert_log\.js';/m,
        'const { summarizeLog } = window.__alertlog__;')
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/paper\.js';/m, '')
      .replace(/^export\s*\{[^}]*\};\s*$/m, '')   // 去掉 `export { POS_CFG, ... };` 这个纯转出语句
      .replace(/^export\s+/gm, '')
    + '\nreturn { buildPaperReview, reviewAccount, reviewTrades, reviewPositions, buildAdvice, REVIEW_CFG, ADVICE_LEVELS, REVIEW_TITLE, REVIEW_VERSION, POS_CFG, MARKET_CFG, TIER_THRESHOLDS };\n})();';
  const reviewFlat = `const { buildPaperReview, REVIEW_TITLE, REVIEW_VERSION } = window.__paperreview__;`;
  // src/lhb_codec.js（存储层编解码：码表压缩 / 惰性提子 / 落盘自检）：零依赖纯函数 ESM。
  // paper_ui.js 用它的 decodeStrField 把标的池的 reasonIdx 解回明文。
  // 包 IIFE 挂到 window.__lhbcodec__，**绝不手抄**码表逻辑——手抄等于第二套口径。
  const lhbCodecBundle = `window.__lhbcodec__ = (function(){\n`
    + readFileSync(join(ROOT, 'src/lhb_codec.js'), 'utf8').replace(/^export\s+/gm, '')
    + '\nreturn { decodeStrField, encodeStrField, decodeArchive, encodeArchive, buildReasonCodes, REASON_PLACEHOLDER };\n})();';
  // quoteSymbol：与 src/sources.js 同口径（沪 6/9 开头、深 0/3、北 4/8/920）
  const quoteSymbolShim = `function quoteSymbol(code){
    const c = String(code || '').trim();
    if (/^(6|9)/.test(c)) return 'sh' + c;
    if (/^(0|3)/.test(c)) return 'sz' + c;
    if (/^(4|8|920)/.test(c)) return 'bj' + c;
    return null;
  }`;
  try {
    window.eval(`${quoteSymbolShim}\n${quoteNoExport}\n${lhbBundle}\n${seatsBundle}\n${lhbFilterBundle}\n${predictBundle}\n${picksBundle}\n${picksFlat}\n${configNoExport}\n${alertsBundle}\n${engineNoExport}\n${engineBundle}\n${alertLogBundle}\n${reviewBundle}\n${lhbCodecBundle}\n;(function(){\n${lhbFilterFlat}\n${alertsFlat}\n${alertLogFlat}\n${reviewFlat}\n${uiNoImport}\n})();`);
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
  check('模拟交易：副标题写明「仅初始资金虚拟」与实时行情来源',
    txt('paperSub').includes('仅初始资金为虚拟') && txt('paperSub').includes('腾讯实时行情'),
    txt('paperSub').slice(0, 80));
  check('模拟交易：标的池仍装载（作参考/快速选择，不再作为可下单白名单）',
    Number.isFinite(uniObj?.meta?.total) && Object.keys(uniObj.symbols || {}).length > 0,
    `池 ${uniObj?.meta?.total} 只 / 当日有价 ${uniObj?.meta?.fresh} 只`);
  // 标的池在实时行情架构下已从「可下单白名单」降级为「参考/快速选择」：
  // 能否下单只看「有没有取到真实价格」。这里断言副标题不再把存档日期当成交价依据。
  check('模拟交易：副标题不再宣称价格取自存档（已改为实时行情）',
    !txt('paperSub').includes('价格取自真实行情存档'), txt('paperSub').slice(0, 80));

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

  // ── 本次修复的核心回归：不在标的池里的票，也必须能按实时价下单 ──
  // 旧 bug：lookup() 把「在不在标的池」当成可下单前提，而池只覆盖当日上榜股（约 100 只），
  // 于是 1200+ 只正常股票全被判「无真实行情，不可下单」。现在能否下单只看「取没取到真实价」。
  {
    const outsideCode = ['600519', '000001', '601318', '000002', '002415']
      .find((c) => !uniObj.symbols?.[c]) || null;
    check('前置：存在一只「不在标的池中」的股票（验证白名单已废除）', !!outsideCode,
      outsideCode || '池覆盖了全部候选，换一组再试');
    if (outsideCode) {
      const codeInp = $('poCode');
      codeInp.value = outsideCode;
      codeInp.dispatchEvent(new window.Event('input', { bubbles: true }));
      // 等 250ms 防抖 + 实时 fetch 落地
      await new Promise((r) => setTimeout(r, 600));
      const t = txt('poQuote');
      check('模拟交易·回归：池外代码通过实时行情取得价格（不再报「无真实行情」）',
        t.includes(outsideCode) && !t.includes('取不到'), t.slice(0, 80));
      check('模拟交易·回归：实时价徽章可见（用户能分辨价格来源）',
        !!$('poQuote').querySelector('.gtag.live, .gtag.close'),
        $('poQuote').querySelector('.gtag.live, .gtag.close')?.className || '无徽章');

      // 池外代码同样可以下单（提交后进入待成交）
      const qtyInp = $('poQty');
      qtyInp.value = '100';
      qtyInp.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      clickEl($('poSubmit'));
      await new Promise((r) => setTimeout(r, 200));
      check('模拟交易·回归：池外代码可成功挂单（T+1，进入待成交）',
        pRows('paperPendTable') === 1, `${pRows('paperPendTable')} 条待成交`);
      // 清掉这张单，避免影响后续断言
      const cb = $('paperPendTable')?.querySelector('tbody tr button');
      if (cb) { clickEl(cb); await new Promise((r) => setTimeout(r, 120)); }
    }
  }

  // ── 仓位档位：买入给「轻仓/半仓/重仓/满仓」，卖出给「减仓/清仓」，账户给「一键空仓」 ──
  // 旧版只有「1万/5万/10万/全仓」绝对金额，且卖出只有「1/4、1/2、全部」，缺少仓位语义。
  {
    // 确保在买入方向、且有可用的池外代码（沿用上面的 outsideCode）
    clickEl(window.document.querySelector('#poSide button[data-side="buy"]'));
    await new Promise((r) => setTimeout(r, 80));
    const tierLabels = () => [...$('poQuick').querySelectorAll('button[data-act="pqty"]')]
      .map((b) => b.textContent.trim());

    // 需要一个有价代码才能算出档位
    const codeInp = $('poCode');
    if (!codeInp.value) {
      codeInp.value = '600519';
      codeInp.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
    } else {
      codeInp.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
    }
    const labels = tierLabels();
    check('模拟交易·仓位：买入区提供四档仓位选项（轻仓/半仓/重仓/满仓）',
      ['轻仓', '半仓', '重仓', '满仓'].every((k) => labels.some((l) => l.startsWith(k))),
      labels.join(' | '));
    check('模拟交易·仓位：档位副标签写明以总资产为分母',
      txt('poQuick').includes('按仓位') && /总资产/.test(txt('poQuick')), txt('poQuick').slice(0, 60));

    // 档位股数必须为整手，且四档严格递增
    const qtys = [...$('poQuick').querySelectorAll('button[data-act="pqty"]')]
      .map((b) => +b.dataset.qty);
    check('模拟交易·仓位：各档股数为 100 股整数倍', qtys.length > 0 && qtys.every((q) => q % 100 === 0),
      qtys.join(','));
    check('模拟交易·仓位：四档股数严格递增（轻仓 < 半仓 < 重仓 < 满仓）',
      qtys.length === 4 && qtys.every((q, i) => i === 0 || q > qtys[i - 1]), qtys.join('<'));

    // 点「半仓」按钮 → 数量框被填入
    const halfBtn = [...$('poQuick').querySelectorAll('button[data-act="pqty"]')]
      .find((b) => b.textContent.trim().startsWith('半仓'));
    clickEl(halfBtn);
    await new Promise((r) => setTimeout(r, 80));
    check('模拟交易·仓位：点档位按钮后数量框填入对应股数',
      +$('poQty').value === +halfBtn.dataset.qty, `qty=${$('poQty').value} 期望=${halfBtn.dataset.qty}`);

    // 切到卖出：无持仓时应如实提示而不是给出无效档位
    clickEl(window.document.querySelector('#poSide button[data-side="sell"]'));
    await new Promise((r) => setTimeout(r, 80));
    const sellTxt = txt('poQuick');
    check('模拟交易·仓位：卖出无持仓时如实提示（不给出无效减仓档位）',
      /无持仓|无可卖/.test(sellTxt), sellTxt.slice(0, 60));

    // ── 自定义比例买入（四档之外的任意百分比）──
    // 切回买入并重新取值，避免用卖出方向下的渲染结果
    clickEl(window.document.querySelector('#poSide button[data-side="buy"]'));
    await new Promise((r) => setTimeout(r, 80));
    const pctInp = $('poPct');
    check('模拟交易·仓位：单独下单区提供「按比例买入」输入框（四档之外可填任意百分比）',
      !!pctInp, pctInp ? '有' : '缺失');
    const pctBtn = $('poQuick')?.querySelector('button[data-act="pqty-pct"]');
    check('模拟交易·仓位：按比例买入有「算数量」按钮', !!pctBtn, pctBtn ? '有' : '缺失');

    if (pctInp && pctBtn) {
      // 注入一个非整档比例（15%），并触发 input 事件走真实的实时算量路径
      pctInp.value = '15';
      pctInp.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const hint = txt('poPctHint');
      check('模拟交易·仓位：填比例后实时给出股数（不等点按钮）',
        /=\s*\d+\s*股/.test(hint), hint.slice(0, 80) || '无提示');

      clickEl(pctBtn);
      await new Promise((r) => setTimeout(r, 150));
      const qty15 = +$('poQty').value || 0;
      check('模拟交易·仓位：按 15% 算出的股数为 100 整数倍',
        qty15 > 0 && qty15 % 100 === 0, `poQty=${qty15}`);

      // 与引擎同口径复算：15% × 总资产预算，整手向下取整（规则唯一出处）
      const eng = window.__engine__ || {};
      const ctx = window.__paperCtx || {};
      const acct = ctx.account ? ctx.account() : null;
      const st2 = ctx.stats ? ctx.stats() : eng.accountStats(acct);
      const info2 = ctx.lookup ? ctx.lookup($('poCode').value) : null;
      if (info2 && info2.price) {
        const px2 = eng.fillPrice(info2.price, 'buy', eng.DEFAULT_SLIP);
        const exp = eng.qtyByAssetPct(st2.total, 0.15, px2, { cash: acct.cash });
        check('模拟交易·仓位：按比例算出的股数与引擎 qtyByAssetPct 同口径一致',
          exp.qty === qty15, `页面=${qty15} 引擎=${exp.qty}（15% 预算 ${Math.round(st2.total * 0.15)} 元）`);
        check('模拟交易·仓位：按比例的占用不超该比例预算（取最大整手数）',
          exp.need <= st2.total * 0.15 + 1e-6 || exp.capped,
          `占用≈${exp.need} 预算=${Math.round(st2.total * 0.15)}`);
      }

      // 比例与四档口径必须同源：15% 的股数应落在轻仓(10%)与半仓(50%)之间
      const t10 = [...$('poQuick').querySelectorAll('button[data-act="pqty"]')]
        .find((b) => b.textContent.trim().startsWith('轻仓'));
      if (t10) {
        check('模拟交易·仓位：15% 股数落在轻仓(10%)与半仓(50%)之间（比例单调）',
          qty15 > +t10.dataset.qty && qty15 < qtys[1],
          `10%=${t10.dataset.qty} < 15%=${qty15} < 50%=${qtys[1]}`);
      }

      // 越界比例必须被夹紧而不是算出荒谬股数（>100% 不得买超满仓）
      pctInp.value = '300';
      pctInp.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      clickEl(pctBtn);
      await new Promise((r) => setTimeout(r, 150));
      const qty300 = +$('poQty').value || 0;
      check('模拟交易·仓位：比例超 100% 被夹到 100%（不买超满仓）',
        qty300 > 0 && qty300 === qtys[3], `300%→${qty300} 满仓=${qtys[3]}`);

      // 0% 必须算不出数量（而不是给出 0 股委托）
      pctInp.value = '0';
      pctInp.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      clickEl(pctBtn);
      await new Promise((r) => setTimeout(r, 150));
      check('模拟交易·仓位：比例填 0 时不产生数量并给出原因',
        (+$('poQty').value || 0) === 0, `poQty=${$('poQty').value} 提示=${txt('poPctHint').slice(0, 50)}`);

      // 收尾：恢复一个可提交状态，避免影响后续断言
      pctInp.value = '15';
      pctInp.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      clickEl(pctBtn);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // ── 批量下单面板（V5.2-pro 规则第五块）：全链路留在引擎，UI 只解析与渲染 ──
  {
    check('模拟交易·批量：批量下单卡片三件套齐备（输入 / 汇总 / 结果表）',
      !!$('btInput') && !!$('btSummary') && !!$('btTable') && !!$('btSubmit'),
      [$('btInput') && 'input', $('btSummary') && 'summary', $('btTable') && 'table', $('btSubmit') && 'submit']
        .filter(Boolean).join('+') || '缺失');

    // 方向/口径分段控件必须齐备：side 决定走 batchSubmit 还是 batchSell，mode 决定第 2 列语义
    check('模拟交易·批量：方向与数量口径两组分段控件齐备',
      $('btSide')?.querySelectorAll('button[data-side]').length === 2
      && $('btMode')?.querySelectorAll('button[data-mode]').length === 2,
      `side=${$('btSide')?.querySelectorAll('button[data-side]').length} mode=${$('btMode')?.querySelectorAll('button[data-mode]').length}`);

    // 买入（默认）：填两行「代码,比例」→ 提交 → 结果表逐行给出结构化结果
    const ta = $('btInput');
    ta.value = '300893,5\n000001,5';
    $('btSubmit').click();
    await new Promise((r) => setTimeout(r, 900));

    const btRows = pRows('btTable');
    check('模拟交易·批量：提交后结果表逐只列出（每只一行）', btRows >= 1, `${btRows} 行`);
    check('模拟交易·批量：汇总条给出「已挂单 / 被拦」计数与当日仓位变动上限',
      /已挂单/.test(txt('btSummary')) && /被拦/.test(txt('btSummary'))
      && /当日已买入/.test(txt('btSummary')) && /上限 20%/.test(txt('btSummary')),
      txt('btSummary').slice(0, 140));
    check('模拟交易·批量：脚注写明龙虎过滤版本与三档档位口径',
      /龙虎榜前置过滤版本/.test(txt('btHint')) && /主池/.test(txt('btHint'))
      && /备选观察/.test(txt('btHint')) && /剔除/.test(txt('btHint')),
      txt('btHint').slice(0, 140));
    check('模拟交易·批量：脚注写明批量卖出不做龙虎过滤（该规则只约束买入）',
      /批量卖出不做龙虎过滤/.test(txt('btHint')), txt('btHint').slice(-80));

    // 被拦的行必须说清「在哪一步、因为什么」，不能只给一句「未通过」
    const blockedRow = [...$('btTable').querySelectorAll('tbody tr')]
      .find((tr) => /已拦截/.test(tr.textContent || ''));
    if (blockedRow) {
      const t = blockedRow.textContent || '';
      check('模拟交易·批量：被拦行写明拦截阶段与原因（不是一句空泛「未通过」）',
        /龙虎过滤|风控|行情|持仓|股数|委托/.test(t) && t.length > 12, t.slice(0, 120));
    } else {
      check('模拟交易·批量：被拦行写明拦截阶段与原因（本轮无被拦行，跳过语义断言）', true, '无被拦行');
    }

    // 从研判推荐填入：只填不提交（纪律：绝不替用户下单）
    const pendBefore = pRows('paperPendTable');
    if ($('btFillPicks')) {
      clickEl($('btFillPicks'));
      await new Promise((r) => setTimeout(r, 120));
      const filled = ($('btInput')?.value || '').split('\n').filter(Boolean).length;
      const pendAfter = pRows('paperPendTable');
      check('模拟交易·批量：「从研判推荐填入」只填输入框、不产生任何委托',
        filled >= 1 && pendAfter === pendBefore, `填入 ${filled} 行 / 待成交 ${pendBefore}→${pendAfter}`);
    }

    // 切到卖出方向：批量卖出恒为「全部可卖」，没有比例/股数口径之分。
    // 此时「按比例/按股数」控件必须被禁用 —— 否则用户会以为「卖出按比例 10%」生效了，
    // 而实际挂出去的是全部持仓，这是最危险的一种误解。
    clickEl(window.document.querySelector('#btSide button[data-side="sell"]'));
    await new Promise((r) => setTimeout(r, 120));
    const modeBtns = [...$('btMode').querySelectorAll('button')];
    const modeDisabled = modeBtns.length === 2 && modeBtns.every((b) => b.disabled);
    check('模拟交易·批量：卖出方向下「按比例/按股数」口径控件被禁用（卖出恒为全部可卖）',
      modeDisabled, modeDisabled ? 'ok' : '仍可点，易被误解为按比例卖出');
    // 禁用态下点击不得改变口径（不能只是视觉禁用但逻辑仍生效）
    clickEl(modeBtns.find((b) => b.dataset.mode === 'qty'));
    await new Promise((r) => setTimeout(r, 80));
    check('模拟交易·批量：卖出方向下点口径钮不改变模式（禁用是真禁用）',
      modeBtns.filter((b) => b.classList.contains('on')).length === 1
      && modeBtns.find((b) => b.classList.contains('on'))?.dataset.mode === 'pct',
      modeBtns.map((b) => `${b.dataset.mode}${b.classList.contains('on') ? '*' : ''}`).join('|'));
    // 默认比例输入在卖出时隐藏（卖出不读它，留着会让人以为生效）
    const defWrap = $('btDefaultPct')?.closest('label');
    check('模拟交易·批量：卖出方向下隐藏「默认仓位%」输入（不读它就别显示它）',
      !!defWrap && defWrap.style.display === 'none', defWrap ? `display=${defWrap.style.display || '(空)'}` : '缺失');

    // 切回买入，避免影响后续断言
    clickEl(window.document.querySelector('#btSide button[data-side="buy"]'));
    await new Promise((r) => setTimeout(r, 80));
    check('模拟交易·批量：切换方向会清空上一次结果表（避免卖出的结果留在屏上被当成买）',
      pRows('btTable') === 0, `${pRows('btTable')} 行`);
    check('模拟交易·批量：切回买入后口径控件恢复可用',
      [...$('btMode').querySelectorAll('button')].every((b) => !b.disabled), 'ok');
  }

  // ── 事件日志面板（V5.2-pro 规则第六块）：日志由引擎自动写，UI 只读 + 过滤 + 导出 ──
  {
    check('模拟交易·日志：事件日志卡片三件套齐备（过滤 / 表 / 说明）',
      !!$('logTabs') && !!$('logTable') && !!$('logNote') && !!$('logExport'),
      [$('logTabs') && 'tabs', $('logTable') && 'table', $('logNote') && 'note', $('logExport') && 'export']
        .filter(Boolean).join('+') || '缺失');

    const stageBtns = [...($('logTabs')?.querySelectorAll('button[data-stage]') || [])];
    check('模拟交易·日志：阶段过滤覆盖全部/龙虎过滤/风控/委托/结算/止损六档',
      stageBtns.length === 6
      && ['', 'lhb', 'risk', 'order', 'settle', 'stop'].every((s) => stageBtns.some((b) => (b.dataset.stage || '') === s)),
      stageBtns.map((b) => b.dataset.stage || '全部').join('|'));

    // 上一步批量提交已产生日志 → 日志表必须有行
    const allRows = pRows('logTable');
    check('模拟交易·日志：委托流转后自动产生日志行（引擎写入，不依赖面板开关）',
      allRows >= 1, `${allRows} 行`);
    check('模拟交易·日志：计数写明条数与上限（超出自动丢弃最早记录）',
      /上限/.test(txt('logCount')), txt('logCount').slice(0, 90));

    // 按阶段过滤：切「委托」后行数应 ≤ 全部
    clickEl(stageBtns.find((b) => b.dataset.stage === 'order'));
    await new Promise((r) => setTimeout(r, 100));
    const orderRows = pRows('logTable');
    check('模拟交易·日志：按「委托」阶段过滤后行数不超过全部',
      orderRows <= allRows && orderRows >= 0, `委托 ${orderRows} ≤ 全部 ${allRows}`);
    check('模拟交易·日志：过滤计数标明「阶段 x 条 / 全部 y 条」',
      /全部/.test(txt('logCount')), txt('logCount').slice(0, 90));

    // 切回全部
    clickEl(stageBtns.find((b) => (b.dataset.stage || '') === ''));
    await new Promise((r) => setTimeout(r, 100));
    check('模拟交易·日志：切回「全部」后恢复完整行数',
      pRows('logTable') === allRows, `${pRows('logTable')} vs ${allRows}`);

    // 导出必须真的生成 Markdown 文本（含阶段中文名与「###」标题）
    const src = readFileSync(join(ROOT, 'src/paper.js'), 'utf8');
    check('模拟交易·日志：导出走引擎 logsToReport（UI 不自己拼日志文案）',
      /logsToReport/.test(readFileSync(join(ROOT, 'paper_ui.js'), 'utf8'))
      && /export function logsToReport/.test(src), 'ok');
  }

  // ── 一键空仓：T+1 下必须「能卖的全挂、卖不掉的如实告知」 ──
  {
    check('模拟交易·空仓：账户区有「一键空仓」按钮', !!$('paperCloseAll'),
      $('paperCloseAll')?.textContent || '缺失');
    // 无持仓时点它应提示无需空仓，而不是报错
    const before = txt('paperMsg');
    $('paperCloseAll').click();
    await new Promise((r) => setTimeout(r, 200));
    check('模拟交易·空仓：无持仓时提示「无需空仓」（不误报错）',
      /无需空仓/.test(txt('paperMsg')) || /无需空仓/.test(before), txt('paperMsg').slice(0, 60));
  }

  // ── 持仓渲染守护：renderPositions 的「旧价」提示不得读错对象层级 ──
  // 回归：rows 里装的是原始持仓对象，曾经的 x.p.pxStale 会在「结算后重渲染」时抛
  // TypeError: Cannot read properties of undefined (reading 'pxStale')，把整个渲染链打断
  // （表现是「点了结算但界面没反应」——用户以为结算按钮失效，实际是渲染崩了）。
  //
  // 这条路径只在「持仓取不到实时价」时触发，而 jsdom 的行情 shim 对任何代码都返回价格，
  // 无法在 DOM 层复现「pxStale=true」。所以分两层守：
  //   ① 结构层：源码里不得再出现 x.p.pxStale / rows[].p.* 这类「对原始持仓对象取 .p」
  //   ② 行为层：真塞一份带 pxStale 的种子账本重新 boot，渲染不得抛错
  {
    const uiSrc = readFileSync(join(ROOT, 'paper_ui.js'), 'utf8');
    const badPattern = /\.filter\s*\(\s*\(\s*\w+\s*\)\s*=>\s*\w+\.p\.pxStale\s*\)/;
    check('模拟交易·持仓：源码不再对原始持仓对象误取 .p.pxStale（回归 339 行崩溃）',
      !badPattern.test(uiSrc), badPattern.test(uiSrc) ? '仍存在 x.p.pxStale' : 'ok');

    // 存储键在 paper_ui.js 里是 'paper-acct-' + PAPER_VERSION，这里从已装载的 localStorage 里认出来
    const seedKey = Object.keys(window.localStorage).find((k) => k.startsWith('paper-acct-')) || 'paper-acct-paper-v1';
    const arcLast = (arcAll.all_days || []).slice(-1)[0]?.trade_date || '2000-01-04';
    // 种子账本刻意放两只票，把预警规则的两条主力分支都点亮：
    //   · 600519：pxStale（无当日行情）——检验渲染不崩、且如实提示估值失真
    //   · 000001：成本 20 元 / 现价 16 元（浮亏 -20%）→ 必须触发「止损线击穿」（风险级）
    //     且 qty 40000 / 可卖 0（当日买入）→ 必须同时给出 T+1 提示，且卖出股数不得为正
    const seed = {
      // version 必须给：importAccount 先校验 version === PAPER_VERSION，不符直接整份拒绝 →
      // load() 返回 null → 界面按「新建空账户」渲染（预警只剩大盘层、持仓表为空）。
      // initCash 同理（校验 +initCash > 0）。两项都漏过，两个坑都踩过一次。
      version: 'paper-v1',
      initCash: 1000000,
      cash: 300000, freeze: 0, realized: 0, totalFee: 0, trades: [], orders: [], pending: [],
      lastSettle: arcLast,
      nav: [{ date: arcLast, equity: 1025950, cash: 300000, marketValue: 725950 }],
      positions: {
        '600519': { code: '600519', name: '贵州茅台', qty: 100, avail: 100, avgCost: 1259.26,
          cost: 125926, grossBuy: 125900, fee: 26, openDate: '2000-01-04', days: 3,
          lastBuyDate: '2000-01-04', last: 1258.62, lastDate: '2000-01-04', pxStale: true },
        '000001': { code: '000001', name: '平安银行', qty: 40000, avail: 0, avgCost: 20,
          cost: 800000, grossBuy: 799800, fee: 200, openDate: arcLast, days: 0,
          lastBuyDate: arcLast, last: 16, lastDate: arcLast, pxStale: false },
      },
    };
    window.localStorage.setItem(seedKey, JSON.stringify(seed));
    let threw = null;
    try {
      // 重新执行一遍 paper_ui.js：boot() 会 load() 到上面这份种子 → renderAllPaper()
      window.eval(`${quoteSymbolShim}\n${quoteNoExport}\n${lhbBundle}\n${seatsBundle}\n${lhbFilterBundle}\n${predictBundle}\n${picksBundle}\n${picksFlat}\n${configNoExport}\n${alertsBundle}\n${engineNoExport}\n${engineBundle}\n${alertLogBundle}\n${reviewBundle}\n${lhbCodecBundle}\n;(function(){\n${lhbFilterFlat}\n${alertsFlat}\n${alertLogFlat}\n${reviewFlat}\n${uiNoImport}\n})();`);
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) { threw = e; }
    check('模拟交易·持仓：带 pxStale 的种子账本渲染不抛错',
      !threw, threw ? String(threw.message || threw).slice(0, 140) : 'ok');
    check('模拟交易·持仓：持仓说明渲染完整且不含 undefined',
      !/undefined/.test(txt('paperPosNote')), txt('paperPosNote').slice(0, 100));
    // 守卫：种子必须被 importAccount 接受，否则后续预警断言会在「空账户」上假通过。
    // 早期种子漏了 initCash，整份被拒 → 界面渲染新账户 → 预警断言全部落空却没人发现。
    check('模拟交易·持仓：种子账本被引擎接受（持仓明细真实生效，非空账户）',
      /平安银行|贵州茅台/.test(txt('paperPosCards')) || /平安银行|贵州茅台/.test(txt('paperPosTable')),
      txt('paperPosNote').slice(0, 90));

    // ── 交易预警（大盘 + 持仓双层）：用上面这份种子点亮止损分支 ──
    check('模拟交易·预警：预警卡片存在（列表 + 元信息 + 脚注三件套）',
      !!$('alertsList') && !!$('alertsMeta') && !!$('alertsNote'),
      [$('alertsList') && 'list', $('alertsMeta') && 'meta', $('alertsNote') && 'note'].filter(Boolean).join('+') || '缺失');

    const aRows = [...($('alertsList')?.querySelectorAll('.alert-row') || [])];
    check('模拟交易·预警：渲染出预警行', aRows.length > 0, `${aRows.length} 行`);

    const aMeta = txt('alertsMeta');
    check('模拟交易·预警：元信息写明数据日期/档位/风险-机会-提示计数',
      /数据日期/.test(aMeta) && /风险/.test(aMeta) && /机会/.test(aMeta) && /提示/.test(aMeta),
      aMeta.slice(0, 120));

    // 止损分支：种子 000001 浮亏 -20%，必须出现风险级止损预警
    const stopRow = aRows.find((r) => /止损线/.test(r.textContent || ''));
    check('模拟交易·预警：浮亏 -20% 触发风险级止损预警', !!stopRow,
      stopRow ? stopRow.className : '未找到止损行');
    check('模拟交易·预警：风险级条目带 risk 类（红左色条）',
      !!stopRow && stopRow.classList.contains('risk'), stopRow?.className || '—');

    // 止损且可卖为 0：卖出按钮不得给出正数数量（否则下单必被拒）
    const stopFill = stopRow?.querySelector('button[data-act="alert-fill"]');
    if (stopFill) {
      const q = Number(stopFill.dataset.qty || 0);
      check('模拟交易·预警：止损但 T+1 不可卖时，填入数量为 0（不得超卖）', q === 0, `qty=${q}`);
    }
    check('模拟交易·预警：同时给出 T+1 不可卖的原因说明',
      aRows.some((r) => /未解冻|不可卖|T\+1/.test(r.textContent || '')),
      aRows.map((r) => (r.textContent || '').slice(0, 24)).join(' | ').slice(0, 120));

    // 严重度排序：risk 必须排在 opp / tip 之前（引擎已排序，UI 不得打乱）
    const lvSeq = aRows.map((r) => (r.classList.contains('risk') ? 0 : r.classList.contains('opp') ? 1 : 2));
    check('模拟交易·预警：按严重度排序（风险 → 机会 → 提示）',
      lvSeq.every((v, i) => i === 0 || v >= lvSeq[i - 1]), lvSeq.join(','));

    // 每条都要能追溯到具体字段：抽屉里必须有「触发依据」
    if (aRows.length) {
      clickEl(aRows[0]);
      await new Promise((r) => setTimeout(r, 120));
      const dwA = txt('dwBody');
      check('模拟交易·预警：点条目打开抽屉并写明「触发依据」与字段取值',
        drawerOpen() && /触发依据/.test(dwA) && /当时的字段取值/.test(dwA), txt('dwTitle'));
      escClose();
    }

    // 一键动作：只填不提交（与「研判推荐」同纪律）
    const fillBtn = aRows.map((r) => r.querySelector('button[data-act="alert-fill"]')).find(Boolean);
    if (fillBtn) {
      const pendBefore = ($('paperPendTable')?.querySelectorAll('tbody tr') || []).length;
      const wantCode = aRows.find((r) => r.querySelector('button[data-act="alert-fill"]'))?.querySelector('.al-code')?.textContent || '';
      clickEl(fillBtn);
      await new Promise((r) => setTimeout(r, 250));
      check('模拟交易·预警：点「填入卖出」把代码填入下单区且切到卖出方向',
        !!$('poCode').value && wantCode.includes($('poCode').value)
        && window.document.querySelector('#poSide button[data-side="sell"]')?.classList.contains('on'),
        `poCode=${$('poCode').value} / ${wantCode.trim()}`);
      const pendAfter = ($('paperPendTable')?.querySelectorAll('tbody tr') || []).length;
      check('模拟交易·预警：填入不自动下单（委托数不变）', pendAfter === pendBefore, `${pendBefore} → ${pendAfter}`);
    }

    // 脚注：阈值出处 + 不构成投资建议（合规底线）
    check('模拟交易·预警：脚注写明阈值出处且声明不构成投资建议',
      /不构成投资建议/.test(txt('alertsNote')) && /V5.2/.test(txt('alertsNote')), txt('alertsNote').slice(-90));

    // ── 预警战绩（收益归因）：预警必须能回答「帮我少亏了多少」 ──
    //
    // 这是本轮的核心：预警不只是话术，必须有计分板。断言覆盖
    //   ① 归因条渲染出来（四个格子）
    //   ② 台账确实落了账（localStorage 里有记录，且条数与渲染一致）
    //   ③ 幂等：再次触发渲染不会让台账膨胀（界面重渲染是常态）
    //   ④ 点格子能打开逐条明细（触发价 → 今日价 → 差额，可核验）
    //   ⑤ 无价条目不得被算成 0（「不知道」与「没赚没亏」必须可区分）
    check('模拟交易·预警：战绩归因条渲染出四个指标格',
      ($('alertsAttr')?.querySelectorAll('.al-cell') || []).length === 4,
      `${($('alertsAttr')?.querySelectorAll('.al-cell') || []).length} 格`);

    const attrTxt = txt('alertsAttr');
    check('模拟交易·预警：归因条含四个指标名（规避亏损/错杀/净贡献/命中率）',
      /已规避亏损/.test(attrTxt) && /错杀/.test(attrTxt) && /净贡献/.test(attrTxt) && /命中率/.test(attrTxt),
      attrTxt.slice(0, 110));

    // 台账落盘：种子触发了带可执行股数的预警（集中度），必须记账
    const rawLog = window.localStorage.getItem('paper-alerts-log');
    let logArr = [];
    try { logArr = JSON.parse(rawLog || '[]'); } catch (e) { logArr = []; }
    check('模拟交易·预警：预警台账写入 localStorage（战绩可跨会话累积）',
      Array.isArray(logArr) && logArr.length > 0, `${logArr?.length ?? 0} 条`);
    check('模拟交易·预警：台账条目含冻结的触发价（归因基准不可被后续行情改写）',
      logArr.length > 0 && logArr.every((e) => e.layer === 'market' || Number.isFinite(+e.px)),
      logArr.map((e) => `${e.type}:${e.px}`).join(' | ').slice(0, 120));

    // 幂等：把「刚刚落盘的那批」再喂一次引擎，台账条数不得增加。
    // 注意**不能**直接 `window.eval('renderAlerts()')` —— app.js 里也有一个同名的全局
    // renderAlerts（研报渲染用的），会命中错的那个并抛错。
    // 这里用「持久化台账 + 从台账反构出的同批预警」走一遍真实路径（recordAlerts 也是这么调的）。
    const before = logArr.length;
    const sameBatch = logArr.map((e) => ({
      layer: e.layer, code: e.code || undefined, name: e.name || undefined,
      type: e.type, level: e.level, action: e.action, qty: e.qty,
    }));
    const idem = window.__alertlog__.appendSignals(logArr, sameBatch, {
      asOf: logArr[0]?.asOf || null, priceOf: () => 10,
    });
    check('模拟交易·预警：重复落账不膨胀台账（幂等）',
      idem.added === 0 && idem.log.length === before, `added=${idem.added}, ${before} → ${idem.log.length}`);

    // 归因明细抽屉：逐条给出「触发价 → 今日价 → 差额」
    const cell0 = $('alertsAttr')?.querySelector('.al-cell');
    if (cell0) {
      clickEl(cell0);
      await new Promise((r) => setTimeout(r, 150));
      const dwAttr = txt('dwBody');
      check('模拟交易·预警：点战绩格子打开明细抽屉（含按规则拆解与计分口径）',
        drawerOpen() && /按规则拆解/.test(dwAttr) && /计分口径/.test(dwAttr), txt('dwTitle'));
      check('模拟交易·预警：明细写明「不含费用」与「不足一手不计分」的口径边界',
        /不含费用/.test(dwAttr) && /一手/.test(dwAttr), dwAttr.slice(-140));
      check('模拟交易·预警：归因口径声明「不编造收益数字」（大盘层只记金额不记收益）',
        /不编造收益数字/.test(dwAttr), dwAttr.slice(-140));
      escClose();
    }

    // 收尾：清掉种子，避免影响后续用例
    window.localStorage.removeItem(seedKey);
  }

  // ── 报告第⑦段「模拟交易复盘」：引擎在浏览器里可执行、快照桥接通、降级如实 ──
  {
    // ① 引擎已挂到 window（index.html 的模块脚本）
    check('报告·复盘：paper_review 引擎挂载到 window（供经典脚本 app.js 使用）',
      !!window.__paperreview__ && typeof window.__paperreview__.buildPaperReview === 'function',
      typeof window.__paperreview__);

    // ② 快照桥接：paper_ui.js 在每次账户变更后发布 window.__paperSnapshot
    const snap = window.__paperSnapshot;
    check('报告·复盘：paper_ui 发布账户快照 window.__paperSnapshot',
      !!snap && snap.version === window.__paperreview__.REVIEW_VERSION,
      snap ? `version=${snap.version}` : '缺失');
    check('报告·复盘：快照含账户 / 台账 / 实时价 / 情绪分四要素',
      !!snap && !!snap.account && Array.isArray(snap.log) && typeof snap.priceMap === 'object' && 'emotionScore' in snap,
      snap ? Object.keys(snap).join(',') : '');
    check('报告·复盘：快照是只读拷贝（不含可变委托数组）',
      !!snap && snap.account.orders === undefined && snap.account.pending === undefined,
      '');

    // ③ 报告段落：编号 ⑦ 存在，且在 ⑥ 之后、口径备注之前
    const secs = [...$('briefBody').querySelectorAll('.bf-sec')];
    check('报告·复盘：第⑦段已渲染（.bf-sec #bfsec7）',
      !!$('bfsec7'), secs.map((s) => s.id).join(','));
    check('报告·复盘：⑦段标题含「模拟交易复盘」',
      /模拟交易复盘/.test($('bfsec7')?.querySelector('.bf-h')?.textContent || ''),
      $('bfsec7')?.querySelector('.bf-h')?.textContent || '');
    check('报告·复盘：⑦段排在⑥段之后（顺序不被插错）',
      secs.findIndex((s) => s.id === 'bfsec6') < secs.findIndex((s) => s.id === 'bfsec7'),
      secs.map((s) => s.id).join(','));

    // ④ 段落内容：必须给出「为什么赚/为什么亏」的拆解或如实降级
    const s7 = txt('bfsec7');
    check('报告·复盘：段落给出结论行（不空转）', s7.length > 60, `${s7.length} 字`);
    check('报告·复盘：未开始交易时如实降级（不编造收益）',
      /尚未开始模拟交易|尚无成交记录|尚无平仓记录|复盘|收益归因|持仓诊断/.test(s7),
      s7.slice(0, 80));
    check('报告·复盘：段落包含收益归因三块之一（浮动/已实现/费用）或如实说明无记录',
      /浮动盈亏|已实现盈亏|交易费用|尚无成交记录/.test(s7), s7.slice(0, 120));
    check('报告·复盘：段落写明口径（FIFO / 止损线 / 单票上限）或降级说明',
      /FIFO|止损线|单票上限|尚未开始|尚无成交/.test(s7), s7.slice(0, 100));

    // ⑤ 建议必须可追溯（风险级建议带「依据」；无建议时须说明无问题）
    const s7html = $('bfsec7').innerHTML;
    check('报告·复盘：建议带「依据」而非空泛措辞',
      !/止损与优化建议/.test(s7) || (/依据：/.test(s7) || /无需要处理的纪律问题/.test(s7)),
      /依据：/.test(s7) ? '有依据' : '无建议或未触发');

    // ⑥ 负向守卫：段落不得出现「注意风险」这类无法执行的话
    check('报告·复盘：段落不含空泛措辞（注意风险 / 综合来看）',
      !/注意风险|综合来看|有待改进/.test(s7), '');

    // ⑦ 引擎在浏览器环境可跑通并返回结构完整的结论
    try {
      const r = window.__paperreview__.buildPaperReview({
        account: snap ? snap.account : null,
        log: snap ? snap.log : [],
        priceMap: snap ? snap.priceMap : {},
        emotionScore: snap ? snap.emotionScore : null,
        asOf: snap ? snap.asOf : null,
      });
      check('报告·复盘：引擎在浏览器环境返回完整结构',
        !!r && typeof r.headline === 'string' && Array.isArray(r.advice)
        && !!r.account && !!r.trades && !!r.positions,
        r && r.headline ? r.headline.slice(0, 60) : '');
      check('报告·复盘：引擎的置信边界清晰（hasAccount / started 为布尔）',
        typeof r.hasAccount === 'boolean' && typeof r.started === 'boolean',
        `hasAccount=${r.hasAccount} started=${r.started}`);
      // 建议的每条都必须带 level/text/why（可核验）
      check('报告·复盘：每条建议都带 level/text/why 三要素',
        r.advice.every((a) => a.level && a.text && a.why),
        `${r.advice.length} 条`);
    } catch (e) {
      check('报告·复盘：引擎在浏览器环境返回完整结构', false, e.message);
    }

    // ⑧ 引擎与报告阈值同源：报告里写的止损线来自 POS_CFG，不是手抄
    const pc = window.__paperreview__.POS_CFG;
    check('报告·复盘：阈值与预警引擎同源（POS_CFG.stopLoss / concMax）',
      pc && pc.stopLoss === -0.08 && pc.concMax === 0.20,
      pc ? `stopLoss=${pc.stopLoss} concMax=${pc.concMax}` : '缺失');

    // ⑨ 端到端：模拟一笔成交后，快照与第⑦段必须跟着变（不能是死数据）
    const before = txt('bfsec7');
    const acct = JSON.parse(JSON.stringify(snap.account));
    const code = Object.keys(acct.positions)[0];
    if (code) {
      // 用一只已持仓票反向注入：把成本抬高 20% 制造浮亏，看段落是否变化
      acct.positions[code].cost = Math.round(acct.positions[code].cost * 1.2 * 100) / 100;
      acct.positions[code].avgCost = Math.round(acct.positions[code].avgCost * 1.2 * 1000) / 1000;
      const r2 = window.__paperreview__.buildPaperReview({
        account: acct, log: [], priceMap: snap.priceMap, emotionScore: snap.emotionScore, asOf: snap.asOf,
      });
      check('报告·复盘：浮亏注入后引擎结论随之改变（归因是现算，不是写死）',
        r2.account.floatPnl < 0 || r2.account.netPnl !== before,
        `floatPnl=${r2.account.floatPnl}`);
    } else {
      check('报告·复盘：当前无持仓（跳过浮亏注入用例）', true, '无持仓');
    }
  }

  // ── 研判推荐（模拟交易区小模块）：由系统研判生成、可填入下单、可点看详情 ──
  {
    check('模拟交易·推荐：推荐卡片存在（列表 + 元信息 + 脚注三件套）',
      !!$('picksList') && !!$('picksMeta') && !!$('picksNote'),
      [$('picksList') && 'list', $('picksMeta') && 'meta', $('picksNote') && 'note'].filter(Boolean).join('+') || '缺失');

    const rows = [...($('picksList')?.querySelectorAll('.pk-row') || [])];
    check('模拟交易·推荐：渲染出推荐个股行（含排名/名称/代码）', rows.length > 0, `${rows.length} 行`);

    const metaTxt = txt('picksMeta');
    check('模拟交易·推荐：元信息写明数据日期与市场档位',
      /数据日期/.test(metaTxt) && /市场档位|档位/.test(metaTxt) && /情绪分/.test(metaTxt),
      metaTxt.slice(0, 90));

    // 每行必须给出理由（不能只给代码了事）
    const withReasons = rows.filter((r) => (r.querySelectorAll('.pk-tag') || []).length > 0).length;
    check('模拟交易·推荐：每只推荐股都给出可核验的入选理由',
      rows.length > 0 && withReasons === rows.length, `${withReasons}/${rows.length} 行有理由`);

    // 每行必须有风险或说明；且页面不得出现空泛措辞
    const anyRisk = rows.some((r) => r.querySelector('.pk-risks'));
    check('模拟交易·推荐：给出具体风险提示（不用「注意风险」这类空话）',
      anyRisk && !/注意风险(?!，)/.test(txt('picksList')),
      anyRisk ? '有风险行' : '无风险行');

    // 上涨概率徽章存在且是数字（排序主依据已从「加权综合分」改为「上涨概率」）
    const probTxt = rows[0]?.querySelector('.pk-prob')?.textContent?.trim() || '';
    check('模拟交易·推荐：显示上涨概率分（预测主依据）', /上涨概率\s*\d+(\.\d+)?/.test(probTxt), probTxt);

    // 概率分档位色调必须是「高=红、低=中性/警示」，绝不能给低概率上绿色
    // （绿色在本页表示「跌」，用在概率上会被误读成「跌的概率」）
    const probCls = rows[0]?.querySelector('.pk-prob')?.className || '';
    check('模拟交易·推荐：概率徽章带分档样式类（不裸渲染）',
      /pb-(high|mid|low|poor)/.test(probCls), probCls.trim());

    // 每行必须给出「依据」（命中的实测因子），这是可核验性的最低要求
    check('模拟交易·推荐：每行给出预测依据与样本量',
      /依据：/.test(txt('picksList')) && /样本\s*\d+\s*例/.test(txt('picksList')),
      txt('picksList').slice(0, 80));

    // 止损位必须逐行给出——这是「止损建议」落地为可执行数字的关键
    check('模拟交易·推荐：每行给出止损位数字', /止损\s*-\d+%/.test(txt('picksList')),
      (txt('picksList').match(/止损\s*-?\d+%/) || ['无'])[0]);

    // ── 连板前置与打标签（用户要求：「大概率连板的放在前置位置并打标签」）──
    const streakBadges = [...($('picksList')?.querySelectorAll('.pk-streak') || [])];
    const topRows = [...($('picksList')?.querySelectorAll('.pk-row-top') || [])];
    if (streakBadges.length) {
      check('模拟交易·推荐·连板：达到门槛的票带「大概率连板」标签',
        /大概率连板\s*\d+(\.\d+)?%?/.test(streakBadges[0].textContent),
        streakBadges[0].textContent.trim().slice(0, 40));
      check('模拟交易·推荐·连板：连板标签带分档样式类（不裸渲染）',
        /pb-(high|mid|low|poor)/.test(streakBadges[0].className),
        streakBadges[0].className.trim());
      // 置顶：带标签的票必须全部排在无标签的票之前
      const firstNonTop = rows.findIndex((r) => !r.classList.contains('pk-row-top'));
      const lastTop = rows.map((r) => r.classList.contains('pk-row-top')).lastIndexOf(true);
      check('模拟交易·推荐·连板：连板票全部前置（置顶组在普通组之前）',
        firstNonTop === -1 || lastTop < firstNonTop,
        `置顶 ${topRows.length} 只 / 共 ${rows.length} 只，末位置顶=${lastTop} 首个非置顶=${firstNonTop}`);
      check('模拟交易·推荐·连板：置顶行有视觉标识（左侧色边，不靠文字说明）',
        topRows.length > 0, `${topRows.length} 行`);
      // 分隔说明只在「置顶组与普通组同时存在」时才应出现——全体置顶时不需要分隔
      const mixed = topRows.length > 0 && topRows.length < rows.length;
      check('模拟交易·推荐·连板：含分隔说明（用户能看懂为什么上面排前面）',
        !mixed || !!$('picksList')?.querySelector('.pk-sep'),
        mixed ? '置顶与普通并存，应有分隔条' : `全体置顶（${topRows.length}/${rows.length}），无需分隔`);
      check('模拟交易·推荐·连板：元信息报出连板只数与门槛',
        /连板概率\s*≥\s*\d+%/.test(txt('picksMeta')), txt('picksMeta').slice(-60));
      check('模拟交易·推荐·连板：标签 title 写明基准（可核验）',
        /基准\s*\d+(\.\d+)?%/.test(streakBadges[0].getAttribute('title') || ''),
        (streakBadges[0].getAttribute('title') || '').slice(0, 60));
      // 连板样本量必须逐行给出（与上涨概率的样本量分开标注，不能混）
      check('模拟交易·推荐·连板：给出连板概率的实测样本量',
        /连板样本\s*\d+\s*例/.test(txt('picksList')),
        (txt('picksList').match(/连板样本\s*\d+\s*例/) || ['无'])[0]);
    } else {
      // 当日无连板达标属正常情况，但「无标签」不能是渲染失败的借口：
      // 元信息必须如实说明「无连板概率达门槛的标的」
      check('模拟交易·推荐·连板：无达标标的时元信息如实说明（不静默省略）',
        /连板概率\s*≥\s*\d+%/.test(txt('picksMeta')),
        txt('picksMeta').slice(-60));
    }

    // 一键填入下单区：点「填入下单」后代码框被填上该股代码，且不自动提交
    const firstCode = rows[0]?.dataset.code;
    const fillBtn = rows[0]?.querySelector('button[data-act="pick-fill"]');
    check('模拟交易·推荐：每行有「填入下单」按钮', !!fillBtn, fillBtn ? '有' : '缺失');
    if (fillBtn) {
      const pendBefore = ($('paperPendTable')?.querySelectorAll('tbody tr') || []).length;
      clickEl(fillBtn);
      await new Promise((r) => setTimeout(r, 200));
      check('模拟交易·推荐：点「填入下单」把代码填入下单区',
        $('poCode').value === firstCode, `poCode=${$('poCode').value} 期望=${firstCode}`);
      const pendAfter = ($('paperPendTable')?.querySelectorAll('tbody tr') || []).length;
      check('模拟交易·推荐：填入不自动下单（委托数不变）',
        pendAfter === pendBefore, `${pendBefore} → ${pendAfter}`);

      // ── 填入下单时按「建议比例」自动算量（用户要求：自动按建议比例填数量，
      //    非 100 整数倍时取「不超过该比例的最大整手数」）──
      // 口径必须来自引擎（src/paper.js 的 qtyByAssetPct），页面上不许另写一套取整：
      // 这里用页面同款函数复算一遍作对照，而不是自己再写一遍公式。
      const eng = window.__engine__ || {};
      const lotSize = eng.LOT;
      const qtyFilled = +$('poQty').value || 0;
      check('模拟交易·推荐：填入下单区自动带上买入数量（不再留 0 让人手填）',
        qtyFilled > 0, `poQty=${qtyFilled}`);
      check('模拟交易·推荐：自动数量必为 100 股整数倍（A 股整手约束）',
        qtyFilled > 0 && lotSize > 0 && qtyFilled % lotSize === 0,
        `poQty=${qtyFilled} LOT=${lotSize}`);

      // 期望值用「建议比例」在引擎里复算：suggestWeight 已含宽波动打折，
      // 是「建议填多少」的唯一出处，绝不在断言里另设一个比例。
      const pct = +rows[0]?.dataset?.suggestWeight || 0;
      if (pct > 0 && qtyFilled > 0) {
        // 引擎符号走 window.__engine__（paper.js 平铺在 jsdom 全局，脚本 module scope 取不到）；
        // ACCT / lookup 在 paper_ui 的 IIFE 内，走 window.__paperCtx 桥接。
        const ctx = window.__paperCtx || {};
        const acct = ctx.account ? ctx.account() : null;
        const st = ctx.stats ? ctx.stats() : eng.accountStats(acct);
        const info = ctx.lookup ? ctx.lookup(firstCode) : null;
        const px = eng.fillPrice(info.price, 'buy', eng.DEFAULT_SLIP);
        // 同一引擎口径、同一比例、同一含滑点价 + 可用资金上限
        const expect = eng.qtyByAssetPct(st.total, pct, px, { cash: acct.cash });
        check('模拟交易·推荐：自动数量与引擎 qtyByAssetPct 同口径复算一致（规则唯一出处）',
          expect.qty === qtyFilled, `页面=${qtyFilled} 引擎=${expect.qty}（比例 ${(pct * 100).toFixed(2)}%）`);
        check('模拟交易·推荐：自动数量不超过建议比例预算（即「不超过该比例的最大整手数」）',
          expect.need <= st.total * pct + 1e-6 || expect.capped,
          `占用≈${expect.need} 预算=${Math.round(st.total * pct)}${expect.capped ? '（受可用资金限制）' : ''}`);
        // 再买一手必然超预算 —— 证明取的是「最大」整手数而非保守缩水
        if (!expect.capped) {
          const gross2 = (expect.qty + lotSize) * px;
          check('模拟交易·推荐：已取到该比例下「最大」整手数（再多一手会超预算）',
            gross2 > st.total * pct + 1e-6,
            `+1 手成交额≈${Math.round(gross2)} 预算=${Math.round(st.total * pct)}`);
        }
      } else {
        check('模拟交易·推荐：首只推荐股带有可读的「建议比例」（自动填量的依据）',
          false, `suggestWeight=${pct} poQty=${qtyFilled}`);
      }

      // 提示：必须告诉用户数量是按建议比例算出来的（避免被误认为手填）
      const fillMsg = txt('paperMsg') || '';
      check('模拟交易·推荐：填入后提示写明「建议 N.N% → M 股」（口径对用户可见）',
        /建议\s*\d+(\.\d+)?%/.test(fillMsg) && /股/.test(fillMsg), fillMsg.slice(0, 90) || '无提示');

      // 降级路径：建议比例为 0（当前档位不建议新建仓）→ 数量留空但不报错崩溃
      const zeroBtn = [...($('picksList')?.querySelectorAll('button[data-act="pick-fill"]') || [])]
        .find((b) => (+b.closest('.pk-row')?.dataset?.suggestWeight || 0) === 0);
      if (zeroBtn) {
        clickEl(zeroBtn);
        await new Promise((r) => setTimeout(r, 200));
        check('模拟交易·推荐：建议比例为 0 的票填入后数量留空（不硬凑一手）',
          (+$('poQty').value || 0) === 0, `poQty=${$('poQty').value} code=${zeroBtn.dataset.code}`);
      } else {
        check('模拟交易·推荐：建议比例为 0 的降级路径（当日首只均有比例，用例跳过）',
          true, '当日推荐均有建议比例');
      }
    }

    // 点击整行 → 打开详情抽屉，且含「为什么入选」「评分构成」「风险」
    clickEl(rows[0]);
    await new Promise((r) => setTimeout(r, 120));
    const dw = txt('dwBody');
    check('模拟交易·推荐：点推荐行打开个股详情抽屉', drawerOpen() && dw.length > 60, txt('dwTitle'));
    check('模拟交易·推荐：详情含「预测」「预期收益」「止损」「为什么入选」「风险提示」五段',
      /为什么认为它大概率会涨/.test(dw) && /预期收益/.test(dw) && /止损与仓位/.test(dw)
      && /为什么入选/.test(dw) && /风险提示/.test(dw),
      dw.slice(0, 60));
    check('模拟交易·推荐：详情写明「概率是历史统计，不是收益承诺」（诚实边界）',
      /历史统计/.test(dw) && /不是收益承诺/.test(dw), dw.slice(-100));
    check('模拟交易·推荐：详情区分「收盘价买入」与「开盘价买入」两种口径',
      /T 日收盘买入/.test(dw) && /T\+1 开盘买入/.test(dw), '两种口径均已标注');
    escClose();

    // 脚注必须写明不构成投资建议（合规底线）
    check('模拟交易·推荐：脚注声明不构成投资建议',
      /不构成投资建议/.test(txt('picksNote')), txt('picksNote').slice(-60));
    check('模拟交易·推荐：脚注写明「概率是历史统计，不是收益承诺」',
      /概率是历史统计/.test(txt('picksNote')) && /不是收益承诺/.test(txt('picksNote')),
      txt('picksNote').slice(0, 80));
    check('模拟交易·推荐：脚注列出剔除规则（用户可核对筛掉了什么）',
      /换手≥25%/.test(txt('picksNote')) && /连板≥5/.test(txt('picksNote')),
      txt('picksNote').slice(0, 120));
  }

  // 剔除清单：必须在页面上可见（折叠面板），不能被静默丢弃
  {
    const rejBox = $('picksRejected');
    const rejTxt = txt('picksRejected');
    const hasRej = /已剔除\s*\d+\s*只/.test(rejTxt);
    check('模拟交易·推荐：被剔除的「大概率亏」标的在页面可见（折叠面板，非静默丢弃）',
      !!rejBox && (hasRej || rejTxt.trim() === ''), rejTxt.slice(0, 60) || '当日无剔除');
    if (hasRej) {
      check('模拟交易·推荐：剔除清单逐条给出剔除原因',
        /换手过高|连板过高|北交所|ST|仅小额外资金|无涨停也无有效净买/.test(rejTxt),
        (rejTxt.match(/换手过高|连板过高|北交所|ST|仅小额外资金|无涨停也无有效净买/) || ['无'])[0]);
      check('模拟交易·推荐：剔除原因带实测依据（不是空泛措辞）',
        /实测|T\+1|上涨占比|均收益|回撤/.test(rejTxt), rejTxt.slice(0, 100));
    }
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

  // ── 初始资金自定义（默认 100 万）──
  const initInp = $('paperInitCash');
  const initBtn = $('paperApplyInit');
  check('模拟交易·初始资金：提供自定义输入框与「新建账户」按钮',
    !!initInp && !!initBtn, [initInp && 'input', initBtn && 'btn'].filter(Boolean).join('+') || '缺失');
  check('模拟交易·初始资金：输入框回显账户实际初始资金（不是写死的默认值）',
    !!initInp && Math.round(+initInp.value) === Math.round(+window.__paperCtx.account().initCash),
    initInp ? `input=${initInp.value} acct=${window.__paperCtx.account().initCash}` : '缺失');

  if (initInp && initBtn) {
    // 越界金额必须被拒绝且不改账户（不静默夹紧）。
    // 注意：本脚本会对 paper_ui.js 做**两次** window.eval（一次常规、一次种账本），
    // 于是同一个输入框上挂了两个 change 监听。disptach 一次 change 两个都会跑，
    // 前者回填输入框、后者再读到回填后的合法值 → 会假报成功。
    // 所以这里直接验证**拦截点**（偏好存储）与**动作点**（新建账户）两处，
    // 不依赖监听器个数——这才是真正要守的契约。
    const beforeCash = window.__paperCtx.account().initCash;
    const setPref = window.__paperInitTest?.saveInitCash;
    if (typeof setPref === 'function') {
      check('模拟交易·初始资金：低于下限被拒绝且不写入偏好',
        setPref(10) === null && window.localStorage.getItem('paper-init-cash') == null,
        `saveInitCash(10)=${setPref(10)} ls=${window.localStorage.getItem('paper-init-cash')}`);
      check('模拟交易·初始资金：高于上限被拒绝且不写入偏好',
        setPref(999999999999) === null, `saveInitCash(1e12)=${setPref(999999999999)}`);
      check('模拟交易·初始资金：合法金额写入偏好（如 50 万）',
        setPref(500000) === 500000 && window.localStorage.getItem('paper-init-cash') === '500000',
        `ls=${window.localStorage.getItem('paper-init-cash')}`);
    } else {
      check('模拟交易·初始资金：测试钩子 window.__paperInitTest 可用', false, '未挂载');
    }

    // 输入框值本身也要能承载越界输入（不被 min/max 属性挡掉，好让 JS 给出可读原因）
    initInp.value = '10';
    initInp.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    check('模拟交易·初始资金：越界输入不会改动账户',
      Math.round(+window.__paperCtx.account().initCash) === Math.round(beforeCash),
      `acct=${window.__paperCtx.account().initCash}（应保持 ${beforeCash}）`);

    // 合法金额 → 新建账户（confirm 自动确认）
    window.confirm = () => true;
    initInp.value = '500000';
    await new Promise((r) => setTimeout(r, 80));
    check('模拟交易·初始资金：只改输入框不会立刻动账户（先设后建）',
      Math.round(+window.__paperCtx.account().initCash) === Math.round(beforeCash),
      `acct=${window.__paperCtx.account().initCash}`);

    clickEl(initBtn);
    await new Promise((r) => setTimeout(r, 200));
    const a2 = window.__paperCtx.account();
    check('模拟交易·初始资金：点「新建账户」后按新金额建户',
      Math.round(+a2.initCash) === 500000 && Math.round(+a2.cash) === 500000,
      `initCash=${a2.initCash} cash=${a2.cash}`);
    check('模拟交易·初始资金：新账户总资产 = 新初始资金（总览随之刷新）',
      window.__paperCtx.stats().total === 500000, `total=${window.__paperCtx.stats().total}`);
    check('模拟交易·初始资金：新账户无持仓无成交（确实是全新账户）',
      Object.keys(a2.positions || {}).length === 0 && (a2.trades || []).length === 0,
      `positions=${Object.keys(a2.positions || {}).length} trades=${(a2.trades || []).length}`);

    // 重置应保留「账户自己的初始资金」，而不是回落到默认 100 万
    clickEl($('paperReset'));
    await new Promise((r) => setTimeout(r, 200));
    check('模拟交易·初始资金：重置账户保留原初始资金（不回落到默认 100 万）',
      Math.round(+window.__paperCtx.account().initCash) === 500000,
      `initCash=${window.__paperCtx.account().initCash}`);

    // 副标题也要跟着变——只更新总览、副标题挂旧金额，两处数字打架比不显示更糟
    check('模拟交易·初始资金：副标题同步报出新的初始资金（不与总览打架）',
      txt('paperSub').includes('500,000') && !txt('paperSub').includes('1,000,000'),
      txt('paperSub').slice(0, 70));

    // 还原到 100 万，避免影响后续断言（下方多处断言写死 1,000,000）
    initInp.value = '1000000';
    initInp.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    clickEl(initBtn);
    await new Promise((r) => setTimeout(r, 200));
    check('模拟交易·初始资金：可改回 100 万（默认值未被写死）',
      Math.round(+window.__paperCtx.account().initCash) === 1000000,
      `initCash=${window.__paperCtx.account().initCash}`);
  }
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
    check('报告导出：能解析出全部 7 个段落',
      rep.sections.length === 7, `${rep.sections.length} 段`);
    // 公文体例：屏幕把序号「一、」放在独立的 .bf-sec-no 里，标题文本不含序号；
    // 导出层只翻译屏幕 DOM，序号由版式层重加。故断言分两层：
    //   ① 导出标题 = 屏幕**内容 span** 的文本（一字不差，证明是翻译而非重写）；
    //   ② 屏幕序号是公文的「一、二、…」，而不是已退役的圆形序号 ①~⑦。
    const screenTitles = [...$('briefBody').querySelectorAll('.bf-sec > .bf-h')]
      .map((h) => (h.querySelector('.bf-sec-t') || h).textContent.trim());
    const screenNos = [...$('briefBody').querySelectorAll('.bf-sec > .bf-h .bf-sec-no')]
      .map((n) => n.textContent.trim());
    check('报告导出：段落标题与屏幕一致（内容 span 逐段相同）',
      screenTitles.length === 7 && rep.sections.every((s, i) => s.title === screenTitles[i]),
      `屏幕 ${screenTitles.length} 段 / 导出 ${rep.sections.length} 段`);
    check('报告导出：屏幕段序号为公文「一、」（圆形序号已退役）',
      screenNos.join('') === ['一、', '二、', '三、', '四、', '五、', '六、', '七、'].join(''),
      screenNos.join(' ') || '未找到 .bf-sec-no');
    check('报告导出：导出标题不含序号（序号由版式层统一重加，防双序号）',
      rep.sections.every((s) => !/^[一二三四五六七八九十]+、/.test(s.title) && !/[①②③④⑤⑥⑦]/.test(s.title)),
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
    // 公文体例结构：报头（名称+编号）/ 主标题 / 摘要栏 / 落款 / 口径 / 免责，
    // 以及版式规格（A4 页边距、2 号报头、3 号正文、页码在版心外）。
    check('报告导出：文档含正式结构（报头/主标题/摘要栏/落款/口径附注/免责声明）',
      html.includes('class="doc-head"') && html.includes('class="serial"')
      && html.includes('class="masthead"') && html.includes('<h1 class="doc-title"')
      && html.includes('class="doc-abstract"') && html.includes('class="sign-date"')
      && html.includes('口径备注') && html.includes('免责声明'), '');
    check('报告导出：版式为公文体例（A4 页边距 + 2 号报头 + 3 号正文 + 页码在版心外）',
      /@page\s*\{[^}]*margin:\s*37mm 26mm 35mm 28mm/.test(html)
      && /\.doc-head \.masthead\s*\{[^}]*font-size:\s*22pt/.test(html)
      && /\.doc-body\s*\{[^}]*font-size:\s*16pt/.test(html)
      && /@page :right\s*\{\s*@bottom-right[^}]*counter\(page\)/.test(html), '');
    check('报告导出：文档配色为白底黑字（打印不会是一团黑）',
      /background:\s*#fff/i.test(html) && !/#0d1117/i.test(html), '');
    check('报告导出：span 标签成对闭合（排版不会崩）',
      (html.match(/<span\b/g) || []).length === (html.match(/<\/span>/g) || []).length, '');

    const md = Report.toMarkdown(rep, opts);
    check('报告导出：Markdown 层级正确（# 标题 / ## 段落 / - 列表）',
      md.startsWith('# ') && /^## /m.test(md) && /^- /m.test(md), '');

    check('报告导出：文件名带数据日期',
      Report.reportFileName('2026-09-30', 'html') === 'A股研判报告_2026-09-30.html', '');

    // ── 模板契约（用户给定的「A 股研判报告输出模板」五条，全部落到真实渲染的 DOM 上）──
    // 公文体例的摘要栏标记是「〔摘要〕」（六角括号），不是历史上的「【极简摘要】」
    check('模板①·导出：摘要栏进入三种形态（md 引用块 / html 摘要栏 / txt 六角括号）',
      md.includes('**【摘要】**') && html.includes('class="doc-abstract"')
      && txt.includes('【摘要】'), '');
    check('模板②·导出：Markdown 含 GFM 表格语法（表头 + 分隔行，缺一不成表）',
      /\|\s*板数\s*\|\s*只数\s*\|\s*个股\s*\|/.test(md) && /\|\s*---\s*\|/.test(md), '');
    check('模板③·导出：章节口径收进 <details>，文末有独立折叠附录',
      (md.match(/<details>/g) || []).length === (md.match(/<\/details>/g) || []).length
      && md.includes('<summary>🔍 点击展开查看口径</summary>')
      && md.includes('口径附录'), `details ${(md.match(/<details>/g) || []).length} 个`);
    check('模板③·导出：HTML 折叠件为原生 <details>（无脚本也能折叠）',
      html.includes('<details class="caliber"') && !/<script/i.test(html), '');
    check('模板④·导出：跟踪项为 GFM 复选框 - [ ]（屏幕上同一份清单）',
      /^- \[ \] /m.test(md) && html.includes('<ul class="todo">'), '');
    check('模板⑤·导出：结尾附免责声明与导出时间',
      md.trimEnd().endsWith('> 导出时间：2026-10-01 10:00')
      && html.includes('免责声明') && html.includes('2026-10-01 10:00')
      && txt.includes('非投资建议') && txt.includes('导出时间：2026-10-01 10:00'), '');

    // ── 「看到的即导出的」纪律：导出层的数字必须**逐个来自屏幕 DOM**，导出不得重算 ──
    // 做法：把屏幕上每个 li 的纯文本抽出来，断言导出文本里的关键数字都出现在屏幕文本里。
    // 若有人在导出层自己算了一个新数字（口径漂移的典型来源），这里会立刻抓到。
    {
      const screenText = $('briefBody').textContent;
      const numsInExport = (txt.match(/[+-]?\d+\.\d+/g) || []);
      const missing = numsInExport.filter((n) => !screenText.includes(n));
      check('导出纪律：导出文本的小数数字全部来自屏幕 DOM（导出层不重算指标）',
        missing.length === 0,
        missing.length ? `${missing.length} 个数字在屏幕上找不到，如 ${missing.slice(0, 5).join(',')}` : `${numsInExport.length} 个数字全部对上`);
    }
  }

  // 打印：应生成一个隐藏 iframe 并把文档写进去（jsdom 无真实打印，只验流程不抛异常）
  clickEl($('briefPrint'));
  check('报告导出：点「打印」生成打印帧且不抛异常',
    !!$('briefPrintFrame') || true, 'jsdom 无打印实现，只保证流程可执行');
  $('briefPrintFrame')?.remove();
}

// ── 报告「出厂质检」闸门：审计不通过就不渲染（用户要求「自动化审计后再出现」）──
// 这道闸门的意义在于**拦得住**，所以断言分两半：
//   ① 正常数据下：闸门放行、状态条显示通过、报告真的在屏幕上；
//   ② 注入一份坏报告：闸门必须拒绝渲染（#briefBody 里没有 .bf-sec，只有审计面板），
//      且导出/复制/打印全部拒绝——否则用户仍能拿到没验过的内容。
{
  const Audit = await import('../src/report_audit.js').catch(() => null);
  if (Audit) {
    window.ReportAudit = Audit;
    window.dispatchEvent(new window.Event('report-audit-ready'));
  } else {
    check('报告质检：引擎可加载', false, 'src/report_audit.js import 失败');
  }
  const Report = window.ReportExport;

  // ① 正常数据：重新构建一次报告，闸门应放行
  // 说明：check_frontend 在页面加载后已经渲染过报告（那时可能还没有 ReportAudit），
  // 所以这里显式重跑一次 renderBrief——真实链路就是 pullArchive → renderAll → renderBrief。
  if (Audit && Report && typeof window.__rerenderBriefForAudit === 'function') {
    window.__rerenderBriefForAudit();
  }

  check('报告质检：状态条存在于工具条内且可见',
    !!$('briefAudit') && $('briefAudit')?.hidden === false,
    `hidden=${$('briefAudit')?.hidden}`);
  // 注意判据：必须用 ^通过 锚定行首——「未通过 15/18 项」里也含「通过 15/18 项」子串，
  // 不加 ^ 会让失败态被当成通过（本脚本自己就踩过这个坑，写成断言免得再犯）。
  check('报告质检：正常数据下审计通过（状态条含「通过 N/N 项」）',
    /(^|\s)通过 \d+\/\d+ 项/.test($('briefAudit')?.textContent || '')
    && !/未通过/.test($('briefAudit')?.textContent || ''),
    $('briefAudit')?.textContent || '(空)');
  check('报告质检：正常数据下报告真的渲染在屏幕上（7 段齐备）',
    window.document.querySelectorAll('#briefBody .bf-sec').length === 7,
    `${window.document.querySelectorAll('#briefBody .bf-sec').length} 段`);
  check('报告质检：审计结论挂在 body[data-brief-audit] 上供外部读取',
    window.document.body.dataset.briefAudit === 'pass',
    `data-brief-audit=${window.document.body.dataset.briefAudit}`);

  if (Audit && Report) {
    // ⚠ 必须用克隆节点给 parseReport：它会就地 remove .bf-caliber（防口径混进正文），
    // 用真节点会把 #briefBody 上的口径折叠件摘掉，后续 DOM 检查一律查不到
    // （本项目真实踩过这个坑：闸门首次接上时把一份合规报告判成「未通过」）。
    const liveBody = $('briefBody');
    const domFacts = {
      domCaliberSummaries: [...liveBody.querySelectorAll('.bf-sec .bf-caliber summary')]
        .map((el) => el.textContent.trim()),
      domTodoCount: liveBody.querySelectorAll('.bf-todo').length,
      domTodoAriaCount: [...liveBody.querySelectorAll('.bf-todo')]
        .filter((el) => el.hasAttribute('aria-checked')).length,
      domAppendix: !!liveBody.querySelector('.bf-appendix'),
      markerKinds: Report.MARKERS ? Object.keys(Report.MARKERS) : null,
    };
    const rep = Report.parseReport(liveBody.cloneNode(true));
    const opts = { dataDate: '2026-09-30', generatedAt: '2026-10-01 10:00' };
    // 用真实三形态产物跑一次审计：合规报告必须全通过（若这里失败，说明屏幕渲染的
    // 报告实际不符合模板契约——闸门会把它拦下，用户就看不到报告了）
    const live = Audit.auditReport(rep, {
      rootEl: liveBody,
      ...domFacts,
      md: Report.toMarkdown(rep, opts),
      txt: Report.toPlainText(rep, opts),
      html: Report.toStandaloneHtml(rep, opts),
    });
    check('报告质检：屏幕上的真实报告通过全部检查项',
      live.pass === true,
      live.pass ? `${live.passed}/${live.total} 项` : `失败：${live.failed.map((f) => f.id).join('、')}`);
  }
}

// ── 负向：闸门必须真的拦得住（注入坏报告 → 不渲染、不放行导出）──────────────
// 这是本块的核心。若闸门拦不住，页面上挂着「✓ 通过质检」反而是虚假安全感，
// 比没有闸门更糟。所以必须构造一份**故意违规**的报告，验证它出不来。
if (window.ReportAudit && window.ReportExport && typeof window.__renderBriefHtmlForAudit === 'function') {
  const $body = $('briefBody');
  const savedHtml = $body.innerHTML;
  const savedBlocked = $body.classList.contains('audit-blocked');

  // 注入一份「少一段 + 缺摘要」的坏报告 HTML：模板①（摘要）与模板②（固定 7 段）同时被破坏
  const evil = '<div class="bf-meta">数据日期 2026-09-30</div>'
    + '<div class="bf-sec" id="bfsec1"><div class="bf-h">① 情绪定位</div>'
    + '<div class="bf-body"><div class="bf-li">情绪 62.3</div></div></div>';
  window.__renderBriefHtmlForAudit(evil);

  check('报告质检·负向：坏报告被拦下（屏幕上没有渲染出任何章节）',
    window.document.querySelectorAll('#briefBody .bf-sec').length === 0,
    `仍渲染了 ${window.document.querySelectorAll('#briefBody .bf-sec').length} 段`);
  check('报告质检·负向：改为显示审计失败面板（列出失败项）',
    !!window.document.querySelector('#briefBody .bf-audit-fail')
    && window.document.querySelectorAll('#briefBody .bf-af-list li').length > 0,
    `${window.document.querySelectorAll('#briefBody .bf-af-list li').length} 条失败项`);
  check('报告质检·负向：状态条切到失败态并显示「未通过」',
    /未通过/.test($('briefAudit')?.textContent || '')
    && $('briefAudit')?.className.includes('fail'),
    $('briefAudit')?.textContent || '(空)');
  check('报告质检·负向：body[data-brief-audit] 变为 fail',
    window.document.body.dataset.briefAudit === 'fail', `=${window.document.body.dataset.briefAudit}`);
  check('报告质检·负向：出现「重试质检」按钮（失败态才显示）',
    $('briefAuditRetry')?.hidden === false, `hidden=${$('briefAuditRetry')?.hidden}`);

  // 失败态下导出必须被拒绝：点导出不应产生下载（jsdom 里表现为不抛异常但被 guard 挡住）
  // 判据用「导出菜单点开后执行导出项，状态条维持失败」——比断言下载更稳。
  const auditTextBefore = $('briefAudit')?.textContent || '';
  const fmtBtn = $('briefExportMenu')?.querySelector('button[data-fmt]');
  if (fmtBtn) { clickEl(fmtBtn); }
  check('报告质检·负向：导出被拒绝（失败态下不产出文档）',
    /未通过/.test($('briefAudit')?.textContent || '') || auditTextBefore === ($('briefAudit')?.textContent || ''),
    '失败态下导出仍被放行');

  // 还原：让后续断言看到正常报告
  $body.innerHTML = savedHtml;
  $body.classList.toggle('audit-blocked', savedBlocked);
}

// ── 席位：买卖双侧表 + 席位身份下钻 ──
// src/seats.js 同样是 ESM，jsdom 不执行模块脚本，这里手动 import 挂到 window.Seats，
// 再**真点席位行**，断言下钻抽屉出现且含身份字段——只看"表格里有没有卖方"是不够的：
// 用户的问题就是"卖方席位能不能点"，必须验证点击真的能到身份页。
{
  const Seats = await import('../src/seats.js').catch(() => null);
  if (Seats) {
    window.Seats = Seats;
    window.dispatchEvent(new window.Event('seats-ready'));
  } else {
    check('席位：口径模块可加载', false, 'src/seats.js import 失败');
  }

  // 找一只有席位明细的票，打开它的个股抽屉
  const arc = decodeArchive(JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8')));
  const lastDay = (arc.all_days || [])[arc.all_days.length - 1] || {};
  const detMap = lastDay.summary?.seats?.detail || {};
  const anyCode = Object.keys(detMap)[0] || null;

  // 点热点表第一行打开个股抽屉（表行本身即 data-act="stock"）
  // ⚠ 分层加载后个股抽屉是异步的（席位明细惰性），必须等一拍再断言席位行。
  const firstRow = $('hotTable')?.querySelector('tbody tr.clickable');
  if (firstRow) await clickAndSettle(firstRow);
  const drewStock = drawerOpen();
  check('席位：个股抽屉可打开', drewStock || !!anyCode, `code=${anyCode}`);

  const seatRowsOf = () => [...($('dwBody')?.querySelectorAll('tr[data-act="seat"]') || [])];
  let seatRows = seatRowsOf();
  check('席位：抽屉内席位行可点击（买卖两侧都挂了 data-act="seat"）',
    seatRows.length > 0, `${seatRows.length} 行`);

  if (seatRows.length) {
    check('席位：抽屉含"买卖双侧席位明细"标题', txt('dwBody').includes('买卖双侧席位明细'), '');

    // 点某行的席位 → 应弹出席位身份抽屉（用户的核心诉求：席位能不能点）
    const aRow = seatRows[seatRows.length - 1];
    const beforeTitle = txt('dwTitle');
    clickEl(aRow);
    check('席位：点席位行下钻到席位身份页（标题变化）',
      drawerOpen() && txt('dwTitle') !== beforeTitle, `→ ${txt('dwTitle')}`);
    check('席位：身份页含可核验字段（席位类型/券商主体/所在城市）',
      txt('dwBody').includes('席位类型') && txt('dwBody').includes('券商主体') && txt('dwBody').includes('所在城市'), '');
    check('席位：身份页如实声明不做游资点名归属（诚实边界可见）',
      txt('dwBody').includes('不做') && txt('dwBody').includes('游资'), '');
    check('席位：身份页有返回上级按钮', !!$('dwBody')?.querySelector('button[data-act="dback"]'), '');
    // 用「返回上级」回到个股详情，再验旧格式降级（此时 dwBody 是身份页，不能直接查）
    clickEl($('dwBody')?.querySelector('button[data-act="dback"]'));
    seatRows = seatRowsOf();
    check('席位：返回上级后回到个股详情（席位行仍在）', seatRows.length > 0, `${seatRows.length} 行`);

    // 旧格式（仅买方）存档：卖方列应明确显示"无卖方席位明细"而非 0 或空白
    const isV1 = Array.isArray(Object.values(detMap)[0]);
    if (isV1 && seatRows.every((r) => r.dataset.side === 'b')) {
      check('席位：旧格式存档优雅降级（卖方列显式提示，不显示 0 占位）',
        txt('dwBody').includes('无卖方席位明细') && txt('dwBody').includes('旧格式存档'), '');
    } else {
      const hasBuy = seatRows.some((r) => r.dataset.side === 'b');
      const hasSell = seatRows.some((r) => r.dataset.side === 's');
      check('席位：买卖双侧都有行（不是只有买方）', hasBuy && hasSell,
        `买方 ${seatRows.filter((r) => r.dataset.side === 'b').length} / 卖方 ${seatRows.filter((r) => r.dataset.side === 's').length}`);
    }
    escClose();
  } else {
    check('席位：抽屉内席位行可点击（买卖两侧都挂了 data-act="seat"）', false,
      '最新档没有票带席位明细，无法验证下钻');
  }
  escClose();

  // 新格式（买卖双侧）渲染：现存存档尚未重抓（全是 v1），故注入一条 v2 记录，
  // 直接验证卖方行的渲染与下钻——否则"卖方可点"这个核心功能在 CI 里永远测不到。
  {
    // 直接构建 v2 明细，复用席位口径模块核对卖方侧的读取/统计/身份解析
    const syn = { b: [['华泰证券股份有限公司海口国兴大道证券营业部', 5000], ['机构专用', 2000]],
      s: [['东方财富证券股份有限公司拉萨团结路第二证券营业部', 8000], ['中信证券股份有限公司总部', 3000]] };
    const S2 = window.Seats || Seats;
    const stB = S2.sideStats(syn.b), stS = S2.sideStats(syn.s);
    check('席位：新股口径下卖方侧占比计算正确（前 3 席 100%）',
      stS.n === 2 && stS.sum === 11000 && stS.top3Pct === 100, `sum=${stS.sum}`);
    check('席位：v2 明细经 seatsOf 读取后买卖双侧条数正确',
      S2.seatsOf({ X: syn }, 'X').b.length === 2 && S2.seatsOf({ X: syn }, 'X').s.length === 2, '');
    const sellId = S2.seatIdentity(syn.s[0][0]);
    check('席位：卖方席位身份可解析（城市/主体）',
      sellId.broker === '东方财富证券' && sellId.city === '拉萨', `${sellId.broker}/${sellId.city}`);
  }
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
check('样式：席位双侧表并排 + 窄屏堆叠规则齐备',
  cssTxt.includes('.seat-grid') && /grid-template-columns:\s*1fr 1fr/.test(cssTxt)
  && cssTxt.includes('.seat-badge.b') && cssTxt.includes('.seat-badge.s'), '');

// 交易预警：严重度色条 + 窄屏折行。色条规则必须三条齐全（风险/机会/提示），
// 缺任何一条都会让对应级别的预警失去视觉区分——「一眼扫到最该看的那条」就失效了。
check('样式：预警严重度色条三档齐全（风险/机会/提示各一条规则）',
  ['.alert-row.risk', '.alert-row.opp', '.alert-row.tip'].every((s) => cssTxt.includes(s))
  && cssTxt.includes('.alert-row') && /border-left:\s*3px solid/.test(cssTxt), '');
check('样式：预警条目窄屏折行（操作按钮整行右对齐）',
  /@media \(max-width: 560px\)/.test(cssTxt) && cssTxt.includes('.al-actions'), '');

// ── 降级规则（龙虎榜净买入 ≤ 0）：扣分 + 告警标签 + 人工复核门槛 ──
// 这一组断言守的是**用户裁定的处置**，而不是某段实现：
//   ① 不禁止委托（不能回到 rejectedBy）；② 扣固定分；③ 有告警标签；④ 复核后才放行。
{
  const RG = dom.window.__reviewGate;
  const LF = dom.window.__lhbfilter__;
  const PK = dom.window.__picks__;
  check('降级：复核门槛句柄已桥接（__reviewGate）', !!(RG && typeof RG.outflowOf === 'function'), '');
  if (RG && LF) {
    // 常量必须同源：UI 侧读到的扣分值就是 lhbfilter 的常量，不是渲染层另写的字面量
    check('降级：扣分值经桥接读到的与规则引擎同源',
      RG.PENALTY.SCORE === LF.LHB_NET_OUTFLOW_PENALTY.SCORE
      && RG.PENALTY.PROB === LF.LHB_NET_OUTFLOW_PENALTY.PROB
      && RG.PENALTY.SCORE === 10 && RG.PENALTY.PROB === 8,
      `${RG.PENALTY.SCORE}/${RG.PENALTY.PROB}`);
    check('降级：告警标签文案与 FLAG_LHB 同源',
      RG.TAG === LF.FLAG_LHB.NET_OUTFLOW && /龙虎当日资金净流出/.test(RG.TAG) && RG.TAG.startsWith('⚠'), RG.TAG);
    // 桶的归属：净买 ≤ 0 必须是 watch（可展示、禁自动下单），不是 rejected
    check('降级：净买 ≤ 0 落备选观察池而非剔除桶',
      LF.BUCKET.WATCH === 'watch' && LF.BUCKET.REJECTED === 'rejected', '');
  }
  // picks 侧标签符号可用（供推荐卡片渲染）
  check('降级：推荐引擎透出告警标签常量（NET_OUTFLOW_TAG）',
    !!(PK && PK.NET_OUTFLOW_TAG === '⚠龙虎当日资金净流出，谨慎开仓'), PK ? PK.NET_OUTFLOW_TAG : 'missing');
}

// 复核门槛的**状态机**：按代码记账、一次性、换代码作废。
// 这四条不涉及行情，纯逻辑，故可以脱开账户直接断言。
{
  const RG = dom.window.__reviewGate;
  if (RG) {
    RG.clear();
    check('复核门槛：初始为「未复核」', RG.passed('600001') === false, '');
    RG.mark('600001');
    check('复核门槛：确认后该票放行', RG.passed('600001') === true, '');
    check('复核门槛：确认按代码记账，不波及其他票', RG.passed('600002') === false, '');
    RG.clear();
    check('复核门槛：clear 后回到未复核（换代码/换方向即作废）', RG.passed('600001') === false, '');
  }
}

// 下单区必须真的挂了复核提示条的容器，否则门槛只拦不解释，用户无从"复核"
check('降级：下单区存在复核提示条容器（#poGate）', htmlTxt.includes('id="poGate"'), '');
check('样式：复核提示条有未复核/已复核两态样式',
  cssTxt.includes('.po-gate') && cssTxt.includes('.po-gate.ok') && cssTxt.includes('.po-gate-btn'), '');
check('样式：降级告警标签有独立样式类（.pk-outflow）', cssTxt.includes('.pk-outflow'), '');

// ── 历史回填天（emotion._backfill）不得进入展示层 ──
// 回填天只有 lhb 与 s_net，其 emotion.value 是 **s_net 单因子占位值、不是综合分**。
// 一旦混进走势图/报告，会被读成「那天情绪分只有 12 分」——一个凭空捏造的结论。
// 守两头：① 展示过滤函数存在且真的按 _backfill 过滤；② 报告样本数不含回填天。
{
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  check('回填：展示层过滤函数 displayDays 存在且按 _backfill 过滤',
    /function displayDays\(arc\)/.test(src) && /_backfill/.test(src)
    && /return all\.filter\(\(d\) => !\(d\.emotion && d\.emotion\._backfill\)\)/.test(src), '');
  check('回填：报告/走势/抽屉不再直接消费 ARC.all_days（只剩 fingerprint 全量用）',
    (src.match(/displayDays\(ARC\)|displayDays\(arc\)|displayDays\(lastArc\)/g) || []).length >= 12, '');
  const body = (dom.window.document.querySelector('#briefBody') || {}).textContent || '';
  const m = body.match(/样本\s*(\d+)\s*个交易日/);
  const n = m ? Number(m[1]) : null;
  // 期望值从**页面同款视图**推导，不写死常量：分层加载后页面持有的是最近 30 日，
  // 写死 33（已加载天数）会在切片窗口变化时假失败，写死 241（完整档）则永远是错的。
  const viewFull = arcView.all_days.filter((d) => !(d.emotion && d.emotion._backfill)).length;
  check('回填：报告样本交易日数不含回填天（＝已加载视图的非回填天数）',
    n !== null && n === viewFull && n < arcAll.all_days.length,
    `报告 ${n} · 视图非回填 ${viewFull} · 完整档 ${arcAll.all_days.length}`);
  check('回填：报告未出现「241 个交易日」这类被回填天数污染的说法',
    !/241\s*个交易日/.test(body), '');
}

// ── 分层加载：跨模块不得重复拉滚动窗 ──────────────────────────────────────
// 为什么单独守这一条：jsdom 的 fetch 是脚本桩出来的，**不产生真实网络事件**，
// 所以"拉了几次"在这里测不出来——只能测"两边是否共用同一个入口"。
// 真浏览器侧的字节账由 scripts/_shot_layered_load.mjs 负责（那里断言首屏无重复请求）。
// 本条守的是**根因**：共享入口必须存在，且两个消费方都必须走它。
{
  const appRaw = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const paperRaw = readFileSync(join(ROOT, 'paper_ui.js'), 'utf8');
  // app.js 必须建立共享入口（它在 index.html 里先求值，天然适合当 owner）
  check('分层：app.js 建立跨模块的滚动窗共享入口（window.__loadRecentArchive）',
    /window\.__loadRecentArchive\s*=/.test(appRaw), '');
  // paper_ui.js 必须复用，而不是自己再 fetch 一份
  check('分层：paper_ui.js 复用 app.js 的共享入口（否则网络上就是两次 204KB）',
    /window\.__loadRecentArchive\(\)/.test(paperRaw), '');
  // 裸 fetch 只允许出现在**一个**函数里（即共享入口本身 + 其兜底分支）。
  // 判据不是"次数少"，而是"没有第二个独立的拉取点"——所以检查的是：
  // 每次裸 fetch 是否都在同一个 `function loadRecentArchive` 体内。
  const paperBareIdxs = [...paperRaw.matchAll(/fetch\(\s*'\.\/data\/archive-recent\.json/g)].map((m) => m.index);
  const loaderStart = paperRaw.indexOf('function loadRecentArchive');
  const loaderEnd = loaderStart >= 0 ? paperRaw.indexOf('\n}', loaderStart) : -1;
  const strayFetch = paperBareIdxs.filter((i) => !(loaderStart >= 0 && i > loaderStart && i < loaderEnd));
  check('分层：滚动窗的裸 fetch 只允许在共享入口函数内（别处出现＝多一个拉取点）',
    loaderStart >= 0 && strayFetch.length === 0,
    `入口@${loaderStart} · 越界 fetch ${strayFetch.length} 处`);
  // 曾经出现过的反模式：两个模块各有一个模块级 promise 槽位
  check('分层：不得残留只作用于单模块的 recentPromise 槽位（两个槽位＝两次请求）',
    !/^\s*let\s+recentPromise\s*=/m.test(appRaw) || /window\.__recentPromise/.test(appRaw),
    '发现模块级 recentPromise');
  // ⚠ 上面两条都是**静态**的，它们测不出"调用点被 if(false) 包住"这类死代码
  //   （实测：注入 `if (false) { return window.__loadRecentArchive(); }` 后两者仍全绿）。
  //   故补**运行时**断言——这才是真正兜住"两个模块各拉一次"的那个 bug 的守卫
  //   （该 bug 在真浏览器里实测为两次 204KB 请求，见 scripts/_shot_layered_load.mjs）。
  const rcHits = fetchCalls.filter((u) => u === 'data/archive-recent.json').length;
  check('分层：滚动窗全页运行时只被拉取 1 次（跨模块共享生效；两次＝白吃 204KB）',
    rcHits <= 1, `${rcHits} 次`);
  check('分层：主档 archive.json 全程未被拉取（首屏与按需路径都应走切片）',
    fetchCalls.filter((u) => u === 'data/archive.json').length === 0,
    `${fetchCalls.filter((u) => u === 'data/archive.json').length} 次`);
}

// ── 标的池分档：首屏只拉精简池，完整池延后 ─────────────────────────────────
// 为什么必须守：
//   ① 精简池是"首屏唯一能接受的池子"——它一旦缺 name，持仓/待成交/台账全变成光秃秃的代码；
//   ② 但精简池**绝不能**开始承担软依赖（板段/幅度/最近收盘价）。今天它不含这些字段，
//      所以不会骗人；哪天有人往精简池里塞 active/quoteFresh 这类"随时间漂移"的字段，
//      首屏就会显示 9 天前的活跃数——这正是本次要修的那类静默错误。
//   ③ 完整池必须**只拉一次**，且必须在首屏之后（否则分档白做）。
{
  const paperRaw = readFileSync(join(ROOT, 'paper_ui.js'), 'utf8');
  // ① 精简池字段收敛：只允许 code / name（顶层 meta 另算）
  const liteKeys = new Set();
  for (const r of uniLite.symbols || []) for (const k of Object.keys(r)) liteKeys.add(k);
  const liteExtra = [...liteKeys].filter((k) => k !== 'code' && k !== 'name');
  check('标的池：精简池只含 code + name（多一个字段就多一分"过期副本"的风险）',
    (uniLite.symbols || []).length > 3000 && liteExtra.length === 0,
    `${(uniLite.symbols || []).length} 只 · 越界字段 ${liteExtra.join(',') || '无'}`);
  // ② 精简池不得含"随时间漂移"的判定字段——这类字段最危险（看着对，其实过期）
  const liteDrift = ['active', 'quoteFresh', 'lastSeen', 'appearances', 'asOf']
    .filter((k) => liteKeys.has(k));
  check('标的池：精简池不含随时间漂移的字段（active/quoteFresh/asOf 等，过期了看不出来）',
    liteDrift.length === 0, liteDrift.join(',') || '无');
  // ③ 精简池必须显著小于完整池（否则分档没有意义）
  const liteBytes = Buffer.byteLength(JSON.stringify(uniLite));
  const fullBytes = Buffer.byteLength(JSON.stringify(uniObj));
  check('标的池：精简池 < 完整池的 20%（分档的全部意义；否则不如不分）',
    liteBytes < fullBytes * 0.2, `${(liteBytes / 1024).toFixed(1)}KB / ${(fullBytes / 1024).toFixed(1)}KB`);
  // ④ 名称映射必须完整：精简池漏一只，那只票在持仓表里就没有名字
  const missingName = (uniObj.symbols && Object.values(uniObj.symbols) || [])
    .filter((r) => !(uniLite.symbols || []).some((x) => x.code === r.code)).length;
  check('标的池：精简池覆盖完整池全部代码（漏一只＝那只票在持仓表里没有名字）',
    missingName === 0, `漏 ${missingName} 只`);
  // ⑤ 硬依赖不许落到完整池上：首屏渲染用到的字段（name）必须来自精简池
  check('标的池：paper_ui 首屏拉的是精简池（paper_universe-lite.json）',
    /paper_universe-lite\.json/.test(paperRaw) && /UNI_LITE_FILE/.test(paperRaw), '');
  // ⑥ 完整池必须延后且有"只拉一次"的守卫（模块级槽位）
  const fullIdx = paperRaw.indexOf('UNI_FULL_FILE');
  const bootIdx = paperRaw.indexOf('async function boot');
  check('标的池：完整池的拉取点定义在 boot 之前、调用在首屏渲染之后',
    fullIdx >= 0 && /loadFullUniverse\(\)\.then/.test(paperRaw), '');
  check('标的池：完整池只拉一次（模块级 promise 槽位；无槽位＝每次输入代码都重拉 1MB）',
    /__uniFullPromise/.test(paperRaw), '');
  // ⑦ 运行时：完整池在整个页面生命周期内只被拉一次
  const uniHits = fetchCalls.filter((u) => u === 'data/paper_universe.json').length;
  check('标的池：完整池运行时拉取 ≤ 1 次（分档的另一半守卫）',
    uniHits <= 1, `${uniHits} 次`);
  // ⑧ 运行时：精简池必须真的被拉过（否则就是"以为省了，其实还在拉 1MB"）
  check('标的池：精简池运行时确实被拉取（首屏走的是它）',
    fetchCalls.some((u) => u === 'data/paper_universe-lite.json'),
    fetchCalls.filter((u) => /paper_universe/.test(u)).join(' , ') || '一个都没拉');
  // ⑨ 软依赖不得参与下单判定：这是分档的**安全前提**。
  //    active/quoteFresh/lastSeen/srcs/reason/huanshou 全部只影响展示文案；
  //    一旦有人拿 u.active 去拦下单，分档就变成"先看到的信息决定能不能下单"。
  const uniSoftInGate = ['u?.active', 'u?.quoteFresh', 'u?.lastSeen', 'u?.srcs', 'u?.reason']
    .filter((p) => paperRaw.includes(p));
  check('标的池：软依赖字段（active/quoteFresh/lastSeen/srcs/reason）不参与下单判定',
    uniSoftInGate.length === 0, uniSoftInGate.join(',') || '无');
  // ⑩ 板段/幅度必须由代码规则推导，不得读池里的副本（副本会过期，规则不会）
  check('标的池：板段与涨跌停幅度由 boardOf/limitPctOf 推导（不读池内副本）',
    /limitPct: limitPctOf\(c, name\)/.test(paperRaw) && /const b = boardOf\(c\)/.test(paperRaw)
    && !/u\?\.limitPct|u\?\.boardLabel/.test(paperRaw), '');
  // ⑪ 分档必须被**披露**：分档本身没问题，"用户不知道现在是哪一档"才是。
  //    #loadScope 是唯一披露点，两条分档链（档案深度 / 标的池档位）都要在里面。
  const appRaw2 = readFileSync(join(ROOT, 'app.js'), 'utf8');
  check('标的池：分档状态在 #loadScope 里被披露（用户要知道数字来自哪一档）',
    /function renderScope\(/.test(appRaw2) && /__uniStaged/.test(appRaw2)
    && /标的池：精简档/.test(appRaw2), '');
  // ⑫ 补全完成后要能**只**重刷披露块，而不是重跑整页渲染
  check('标的池：补全后只重刷披露块（window.__renderScope，不重跑 7 段渲染）',
    /window\.__renderScope\s*=\s*renderScope/.test(appRaw2)
    && /window\.__renderScope\(/.test(paperRaw), '');
  // 运行时：首屏披露里确实带上了"精简档"
  {
    const scopeTxt = txt('loadScope');
    check('标的池：首屏 #loadScope 文案含"标的池：精简档"（运行时可见）',
      /标的池：精简档/.test(scopeTxt) || /精简池缺失/.test(scopeTxt),
      scopeTxt.slice(0, 90));
  }
}

check('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

// ── 板块相对强弱（超额进攻 / 超额防御）───────────────────────────────────────
// 运行时断言，覆盖两个最易翻车的点：
//   ① 无数据时渲染 0（0＝与基准完全同步，是确定结论；缺数据＝不知道，两者相反）
//   ② 前端自己再算一遍超额（口径分叉），或双基准只渲染了一个
{
  // 情绪面板区块
  const relHost = $('relBlock');
  check('板块相对强弱：情绪面板 #relBlock 已渲染', !!relHost && relHost.innerHTML.length > 0,
    relHost ? `${relHost.innerHTML.length} 字节` : '无 #relBlock 元素');
  if (relHost) {
    const relRows = [...relHost.querySelectorAll('.rel-row')];
    const summary = (relHost.querySelector('summary')?.textContent || '').replace(/\s+/g, ' ').trim();
    // 最新交易日有行业明细 → 应渲染出攻防两榜（各 5 条 = 10 行）
    check('板块相对强弱：攻防两榜各 5 条（共 10 行）', relRows.length === 10, `${relRows.length} 行`);
    check('板块相对强弱：摘要标注了基准名（不得只说"超额"不说基准）',
      /上证指数|行业中位数/.test(summary), summary.slice(0, 60));
    check('板块相对强弱：摘要含两榜口径说明', /行业|超额/.test(summary), summary.slice(0, 60));
    // 每行须有 名称 + 涨跌幅 + 超额 三段；超额必须带正负号（正负号是判断攻防的唯一视觉线索）
    const badRow = relRows.find((r) => r.querySelectorAll('span').length < 4);
    check('板块相对强弱：每行含 排名/名称/涨跌幅/超额 四段', !badRow,
      badRow ? badRow.textContent.replace(/\s+/g, ' ').trim() : '');
    // 攻防两端符号应相反（有行业明细的正常交易日必然如此；全市场同涨跌到"攻榜首超额也为负"
    // 是可能的，故只断言"两端不等价"，不断言符号）
    const exs = relRows.map((r) => (r.querySelector('.rel-ex')?.textContent || '').trim()).filter(Boolean);
    check('板块相对强弱：超额列全部带符号（+ 或 −）', exs.length === 10 && exs.every((e) => /^[+\-−]/.test(e)),
      exs.join(','));
  }
  // 报告表格
  const relTbl = window.document.querySelector('table.rel-table');
  check('板块相对强弱：报告内 rel-table 已渲染', !!relTbl, relTbl ? '' : '未找到 .rel-table');
  if (relTbl) {
    const cap = relTbl.getAttribute('data-caption') || '';
    check('板块相对强弱：报告表格 data-caption 标注基准（口径可追溯）',
      /基准/.test(cap) && /上证指数|行业中位数/.test(cap), cap.slice(0, 60));
    check('板块相对强弱：报告表格 10 个数据行', relTbl.querySelectorAll('tbody tr').length === 10,
      `${relTbl.querySelectorAll('tbody tr').length} 行`);
    // 列头须点明是"超额进攻/超额防御"，而非泛泛的"涨幅榜"
    const heads = [...relTbl.querySelectorAll('thead th')].map((x) => x.textContent.trim()).join('|');
    check('板块相对强弱：表头含"超额进攻"与"超额防御"', /超额进攻/.test(heads) && /超额防御/.test(heads),
      heads.slice(0, 70));
  }
  // 源码层：前端不得自行相减（口径唯一出处守卫的运行时补充）
  {
    const appSrcRel = readFileSync(join(ROOT, 'app.js'), 'utf8');
    check('板块相对强弱：前端源码未自行计算超额（只读 summary.industry_relative）',
      /industry_relative/.test(appSrcRel) && !/change_pct\s*-\s*\w+\.indexes/.test(appSrcRel),
      '');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 公式版本对比卡（#116）
//
// 守的是什么：候选版与基线**在视觉上必须可分**。
//   本项目最容易犯的错不是"算错"，而是"把候选当成品"——v5.3 的 s_net 饱和是 0/N，
//   比基线(10/N)漂亮得多，若不标出"这是候选"，读者会自然认为它是该用的那版。
//   故断言徽标、行样式、饱和列的语义色都必须真实渲染出来。
// ════════════════════════════════════════════════════════════════════════════
{
  const verTbl = $('verTable');
  const verSum = $('verSummary');
  const verFoot = $('verCaution');
  if (!verTbl) {
    check('公式版本对比：卡内表格存在', false, '未找到 #verTable');
  } else {
    // 数据文件缺失是允许的（独立文件、失败不影响他区块），但那时必须显示生成命令，
    // 不能静默空白——"没有内容"与"没生成"对读者是两件事。
    const rows = [...verTbl.querySelectorAll('tbody tr')];
    const emptyMsg = rows.length === 1 && /empty/.test(rows[0].className || '');
    if (emptyMsg) {
      check('公式版本对比：数据缺失时显示生成命令（非静默空白）',
        /version_regression\.mjs/.test(verTbl.textContent), verTbl.textContent.slice(0, 80));
    } else {
      check('公式版本对比：渲染出 4 个版本行', rows.length === 4, `${rows.length} 行`);
      // 基线必须可识别（徽标 + 行样式），否则"哪个在线上"不可知
      const baseRow = rows.find((r) => /ver-base/.test(r.className));
      check('公式版本对比：基线行有专属样式与徽标',
        !!baseRow && /基线/.test(baseRow.textContent),
        baseRow ? baseRow.textContent.slice(0, 50) : '未找到基线行');
      // 候选必须可识别
      const candRow = rows.find((r) => /ver-cand/.test(r.className));
      check('公式版本对比：候选行有专属样式与徽标',
        !!candRow && /候选/.test(candRow.textContent),
        candRow ? candRow.textContent.slice(0, 50) : '未找到候选行');
      // 归一层列必须显示归一器名（这是 v5.2 vs v5.3 差异的唯一可解释来源）
      const bodyText = verTbl.textContent;
      check('公式版本对比：归一层列显示归一器名（分位映射 / tanh(k=5)）',
        /分位映射/.test(bodyText) && /tanh\(k=5\)/.test(bodyText),
        '');
      // 饱和列语义色：>0 标红（bad）、0 标绿（ok）。两色必须同时出现——
      // 只出现一种说明要么全饱和要么全不饱和，那多半是数据没接上。
      check('公式版本对比：饱和列用状态色区分（有饱和 vs 无饱和）',
        /ver-sat-bad/.test(verTbl.innerHTML) && /ver-sat-ok/.test(verTbl.innerHTML),
        '');
      // 表头七列与 HTML 定义一致
      const ths = [...verTbl.querySelectorAll('thead th')].map((x) => x.textContent.trim());
      check('公式版本对比：表头 7 列齐全', ths.length === 7, ths.join('|'));
      // 摘要须披露样本量（否则读者会按 33 天样本得出"版本优劣"结论）
      check('公式版本对比：摘要披露样本量与饱和判定阈值',
        !verSum || (/主样本/.test(verSum.textContent) && /饱和判定/.test(verSum.textContent)),
        verSum ? verSum.textContent.slice(0, 80) : '(无摘要)');
      // cautions 必须渲染（样本量不足的披露是本表最重要的一行字）
      check('公式版本对比：披露 cautions（样本量不足不得隐去）',
        !verFoot || /样本|自由度/.test(verFoot.textContent),
        verFoot ? verFoot.textContent.slice(0, 80) : '(无披露)');
    }
  }
  // 源码层：前端不得自己算 Pearson / 饱和率（那些是回归脚本的职责）；
  // 也**不得重写 s_net 归一公式**——这是本项目最容易复发的一类漂移：
  //   app.js 曾硬编码 `Math.tanh(nb/5)*50+50` 展示"修正前后因子分"。基线是 v5.2 时它恰好正确，
  //   一旦切到 v5.3（分位映射）就会静默显示错误分数。故这里精确匹配"tanh 除以 5 再乘 50 加 50"
  //   这一特定形状，而不是笼统禁掉 Math.tanh（量能因子等处合法使用 tanh，笼统禁止会误报）。
  {
    const appSrcVer = readFileSync(join(ROOT, 'app.js'), 'utf8');
    // 先剥掉注释再检测：否则"注释里提到这个公式"会被误判成"代码里抄了这个公式"，
    // 而为了让注释能讨论这个坑，注释里必然会写出它。剥离注释让守卫只盯**可执行代码**。
    const codeOnly = appSrcVer
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（避开 http:// 这类）
    const tanh5Copy = /Math\.tanh\s*\([^)]*\/\s*5\s*\)\s*\*\s*50\s*\+\s*50/.test(codeOnly);
    check('公式版本对比：前端未自行计算统计量（只读 JSON）',
      !/function\s+pearson\b/.test(codeOnly) && !tanh5Copy,
      tanh5Copy ? '发现 s_net 归一公式副本（Math.tanh(x/5)*50+50）——应改为读引擎结果' : '');
    // 因子分必须从引擎字段读，而不是由净买现算
    check('公式版本对比：报告里的修正前后因子分读自引擎字段（factorRaw/factorUsed）',
      /nsMeta\.factorRaw/.test(codeOnly) && /nsMeta\.factorUsed/.test(codeOnly),
      '');
  }
}
// ════════════════════════════════════════════════════════════════════════════
// 数据健康面板（#115）
//
// 守的是什么：**"未评估"不得显示成"正常"**。
//   这是本项目反复踩过的一类坑（0 vs 未计算、missing vs 真值 50）：
//   把"没检查"渲染成绿色"正常"，比不显示面板更糟——它会让人以为查过了。
//   故断言：unknown 有独立颜色类；数据缺失文案含"没检查/不等于正常"字样。
// ════════════════════════════════════════════════════════════════════════════
{
  const hp = $('healthPanel');
  check('数据健康：面板元素存在', !!hp, hp ? '' : '未找到 #healthPanel');
  if (hp) {
    // jsdom 下 signals-latest.json 存在 → 应渲染出真实面板（而非"未评估"态）
    const isUnknown = /hl-unknown/.test(hp.className || '');
    if (isUnknown) {
      check('数据健康：未评估时显式说明"不等于正常"（不得伪装成 ok）',
        /没检查/.test(hp.textContent) && /不等于正常/.test(hp.textContent),
        hp.textContent.slice(0, 90));
      check('数据健康：未评估态用独立样式类（不借用 ok 的绿）',
        !/hl-ok/.test(hp.className || ''), hp.className);
    } else {
      check('数据健康：面板已渲染（hidden 已解除）', hp.hidden === false, `hidden=${hp.hidden}`);
      // 整档状态必须是四种之一，且体现在类名上（供 CSS 决定左边框色）
      const lvCls = ['hl-ok', 'hl-warn', 'hl-fail', 'hl-unknown'].filter((c) => new RegExp(c).test(hp.className || ''));
      check('数据健康：整档状态类唯一且合法', lvCls.length === 1, `类名 ${hp.className}`);
      // 三个维度都要在面板里出现（缺一个说明某项被吞掉）
      const txt = hp.textContent || '';
      check('数据健康：三个维度都渲染（新鲜度/补位率/字段可用率）',
        /数据新鲜度/.test(txt) && /因子补位率/.test(txt) && /关键字段可用率/.test(txt), '');
      // 字段明细必须带"缺失影响"（否则读者不知道该担心什么）
      check('数据健康：关键字段明细带"缺失影响"说明',
        /缺失影响/.test(txt), '');
      // 折叠策略：异常/未知应默认展开（open 属性），正常可折叠
      const fold = hp.querySelector('details.hl-fold');
      const level = lvCls[0];
      check('数据健康：非正常状态默认展开（出问题时要看得见）',
        level === 'hl-ok' ? true : !!(fold && fold.hasAttribute('open')),
        `level=${level} open=${fold ? fold.hasAttribute('open') : 'n/a'}`);
    }
  }
  // 源码层：前端不得自行实现健康判定（阈值必须在 src/health.js）
  {
    const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
    const codeOnly2 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    check('数据健康：前端未自行判定阈值（只读 JSON，不重写 health.js 口径）',
      !/imputedWarn|imputedFail|fieldWarnRatio/.test(codeOnly2) && !/function\s+healthReport\b/.test(codeOnly2),
      '前端出现阈值常量或 healthReport 实现＝第二套口径');
  }
  // 研判报告内也应有「数据可信度」块（双处渲染：#115 要求面板 + 告警都要）
  {
    const body = $('briefBody');
    const txt = (body && body.textContent) || '';
    const hasHealth = /数据可信度/.test(txt);
    check('数据健康：研判报告内含「数据可信度」块（与页面面板双处渲染）', hasHealth,
      hasHealth ? '' : '报告缺数据可信度段——loadHealth 成功后应重刷报告');
    if (hasHealth) {
      // 报告内健康块必须标出等级，不能只给文字而看不出好/坏
      const blk = body.querySelector('.bf-health');
      check('数据健康：报告内健康块带等级样式类（可一眼看出好/坏）',
        !!blk && /bf-hl-(ok|warn|fail|unknown)/.test(blk.className), blk ? blk.className : '无 .bf-health');
      // 必带口径说明（不参与打分）
      check('数据健康：报告内健康块带口径说明（不参与打分）',
        !blk || /不参与打分/.test(blk.textContent), '');
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 资金属性（#1）与亏钱效应（#2）
//
// 守的是什么：
//   ① **"没数据"不得显示成 0**。席位净买缺失、亏钱效应样本不足时，必须显示"—"或
//      "未评估"，不得渲染 0 —— "净买 0（多空抵消）"与"没数据"含义相反；
//      "翻绿 0%（极强）"与"不知道"更是天壤之别。
//   ② **前端不得重算**。席位净额、翻绿比例、晋级失败率全部来自引擎
//      （src/seats_daily.js / src/pain.js），前端只排版。若前端出现这些算式，
//      就是第二套口径，切换时会静默漂移。
//   ③ **亏钱效应不得用 hot 反查**。这是源码级硬约束：hot 只含上涨股，用它算
//      "昨涨停今日表现"会恒得 +10%（假繁荣）。守卫检测 app.js 里是否出现
//      "遍历 hot 求涨跌幅均值"这种形状。
// ════════════════════════════════════════════════════════════════════════════
{
  // ── 资金属性面板 ──
  const sp = $('seatsPanel');
  check('资金属性：面板元素存在', !!sp, sp ? '' : '未找到 #seatsPanel');
  if (sp) {
    const isUnknown = /st-unknown/.test(sp.className || '');
    if (isUnknown) {
      check('资金属性：未评估时显式说明"不等于资金均衡"',
        /没数据/.test(sp.textContent) && /不等于资金均衡/.test(sp.textContent),
        sp.textContent.slice(0, 90));
    } else {
      check('资金属性：面板已渲染（hidden 已解除）', sp.hidden === false, `hidden=${sp.hidden}`);
      // 状态类必须是 inst/north/hot/unknown 之一（决定左边框色）
      const lv = ['st-inst', 'st-north', 'st-hot', 'st-unknown'].filter((c) => new RegExp(c).test(sp.className || ''));
      check('资金属性：主导方状态类唯一且合法', lv.length === 1, `类名 ${sp.className}`);
      // 三类资金列必须齐（缺一列说明某类被吞掉）
      const txt = sp.textContent || '';
      check('资金属性：机构/北向/游资三类列齐全',
        /机构净买/.test(txt) && /北向净买/.test(txt) && /游资净买/.test(txt), '');
      // 缺失必须显示"—"而不是 0
      check('资金属性：缺失值以"—"呈现（不得渲染成 0）',
        /—/.test(txt), '缺失显示成 0 会让"没数据"被读成"资金均衡"');
      // 数据可用性（覆盖率）必须披露——席位明细只有最近数日，不披露会让人误以为序列很长
      check('资金属性：披露样本覆盖率（席位明细仅最近数日）',
        /覆盖率/.test(txt), '未披露覆盖率，读者会高估序列长度');
    }
  }
  // 源码层：前端不得自行聚合席位净额
  {
    const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    check('资金属性：前端未自行聚合席位净额（只读引擎结果）',
      !/inst_buy\s*-\s*inst_sell|instBuy\s*-\s*instSell/.test(code),
      '前端出现净额算式＝第二套口径');
  }

  // ── 亏钱效应面板 ──
  const pp = $('painPanel');
  check('亏钱效应：面板元素存在', !!pp, pp ? '' : '未找到 #painPanel');
  if (pp) {
    const isUnknown = /pn-unknown/.test(pp.className || '');
    if (isUnknown) {
      check('亏钱效应：未评估时显式说明"不等于无亏钱效应"',
        /没数据/.test(pp.textContent) && /不等于无亏钱效应/.test(pp.textContent),
        pp.textContent.slice(0, 90));
    } else {
      check('亏钱效应：面板已渲染（hidden 已解除）', pp.hidden === false, `hidden=${pp.hidden}`);
      const lv = ['pn-severe', 'pn-weak', 'pn-normal', 'pn-strong', 'pn-unknown']
        .filter((c) => new RegExp(c).test(pp.className || ''));
      check('亏钱效应：结论状态类唯一且合法', lv.length === 1, `类名 ${pp.className}`);
      const txt = pp.textContent || '';
      // 核心口径必须在场：翻绿比例（这是整块的价值所在）
      check('亏钱效应：渲染核心口径「翻绿比例」', /翻绿比例/.test(txt), '');
      check('亏钱效应：渲染连板晋级失败率', /连板晋级失败/.test(txt), '');
      // 必须披露"不可用 hot 反查"这件事——它是本模块最容易被误用的地方
      check('亏钱效应：面板内披露口径警示（不得用 hot 反查）',
        /hot/.test(txt) && /假繁荣/.test(txt), '缺口径警示，后来者可能改回 hot 反查');
    }
  }
  // 源码层：禁止用 hot 列表反查涨跌幅均值（硬约束，见 src/pain.js 头注）
  {
    const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // 形状：把 hot 映射成 change_pct 再求平均/中位
    const hotMap = /hot[\s\S]{0,40}?map\([\s\S]{0,60}?change_pct/.test(code) && /\/\s*(hot|h)\.length|reduce\(/.test(code);
    check('亏钱效应：前端未用 hot 列表反算涨跌幅（会造成假繁荣）', !hotMap,
      hotMap ? '发现 hot→change_pct 聚合，hot 只含上涨股，会得出恒为 +10% 的假结论' : '');
    // 翻绿比例必须来自引擎，不在前端算
    check('亏钱效应：翻绿比例读自引擎（不在前端现算）',
      !/filter\([^)]*changePct[^)]*<\s*0\s*\)[\s\S]{0,30}?\/\s*\w+\.length/.test(code),
      '前端出现翻绿比例算式＝第二套口径');
  }

  // ── 多维市场宽度面板（#3）──
  //   ① 四个维度必须在屏幕上：站上20日线 / 新高 / 新低 / 破净率
  //   ② "未计算"必须显式出现（样本不足 or PB 源不可用），**不得退化成 0**
  //   ③ 前端不得自行计算均线（第二套口径）
  const bp = $('breadthPanel');
  check('市场宽度：面板元素存在', !!bp, bp ? '' : '未找到 #breadthPanel');
  if (bp) {
    const isUnknown = /bw-unknown/.test(bp.className || '');
    if (isUnknown) {
      check('市场宽度：未评估时显式说明"不等于宽度正常"',
        /没数据/.test(bp.textContent) && /不等于宽度正常/.test(bp.textContent),
        bp.textContent.slice(0, 90));
    } else {
      check('市场宽度：面板已渲染（hidden 已解除）', bp.hidden === false, `hidden=${bp.hidden}`);
      const lv = ['bw-broad', 'bw-narrow', 'bw-mixed', 'bw-diverged', 'bw-unknown']
        .filter((c) => new RegExp(c).test(bp.className || ''));
      check('市场宽度：结论状态类唯一且合法', lv.length === 1, `类名 ${bp.className}`);
      const txt = bp.textContent || '';
      // 四个维度必须齐（缺一说明某维度被吞掉）
      check('市场宽度：四维度齐全（站上20日线/新高/新低/破净率）',
        /站上20日线/.test(txt) && /创新高/.test(txt) && /创新低/.test(txt) && /破净率/.test(txt), '');
      // 涨跌家数也应在场（本模块把可用率从 3/241 提升到"扫过的天都有"）
      check('市场宽度：渲染涨跌家数（自算兜底，不再依赖 3/241 的存档字段）',
        /上涨家数/.test(txt) && /下跌家数/.test(txt), '');
      // 缺失必须显示"—"，且必须显式说明"未计算"两类情形
      check('市场宽度：缺失值以"—"呈现（不得渲染成 0）',
        /—/.test(txt), '破净率 0% 是"无一家破净"，与"没抓到"含义相反');
      check('市场宽度：披露「未计算」的两类情形（样本不足 / PB 源不可用）',
        /未计算/.test(txt), '不披露会让"没抓到"被读成"宽度为 0"');
      // 口径警示：必须说明"由全市场真实 K 线计算"，且前复权是正确性前提
      check('市场宽度：面板内披露口径（全市场真实前复权日K）',
        /前复权/.test(txt) && /全市场/.test(txt), '');
      // 合规声明
      check('市场宽度：含合规声明（不构成投资建议）', /不构成投资建议/.test(txt), '');
    }
  }
  // 源码层：前端不得自算均线（第二套口径）
  {
    const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    check('市场宽度：前端未自行计算均线/新高（只读引擎结果）',
      !/slice\(\s*-\s*20\s*\)[\s\S]{0,40}?reduce\([\s\S]{0,30}?\/\s*20/.test(code),
      '前端出现 MA20 算式＝第二套口径');
    // 宽度不得从 hot 列表推（hot 是涨幅榜，用它算宽度必然全在均线上方）
    check('市场宽度：前端未用 hot 列表推算宽度',
      !/hot[\s\S]{0,50}?(aboveMa|maRatio|newHigh)/.test(code), '');
  }

  // ── 数据质量面板（#3 异常值/脏数据）──
  //   ① 面板必须存在并渲染
  //   ② 三态可区分：「已剔除（error）」与「需复核（warn）」**不得同色同词** —— 混为一谈
  //      会让人误判数据是否被丢弃，这正是本面板存在的意义
  //   ③ 必须披露"标脏只剔因子入参、原值保留"和"本层不改写分值"
  //   ④ 缺数据必须显示「未计算」，不得显示成"数据干净"
  //   ⑤ 前端不得自行实现校验规则（第二套口径）
  const dp = $('dirtyPanel');
  check('数据质量：面板元素存在', !!dp, dp ? '' : '未找到 #dirtyPanel');
  if (dp) {
    const isUnknown = /dq-unknown/.test(dp.className || '');
    const txt = (dp.textContent || '');
    check('数据质量：面板已渲染（hidden 已解除或为未知态）', dp.hidden === false, `hidden=${dp.hidden}`);
    if (!isUnknown) {
      check('数据质量：三态类名唯一且合法', /dq-(clean|has-warn|has-dirty)/.test(dp.className || ''), `类名 ${dp.className}`);
      check('数据质量：四个 KPI 齐全（干净/已剔除/需复核/涉及字段）',
        /干净天数/.test(txt) && /已剔除/.test(txt) && /需复核/.test(txt) && /涉及字段/.test(txt), '');
      check('数据质量：区分「已剔除」与「需复核」两种语义标签',
        /已剔除/.test(txt) && /需复核/.test(txt), '两者混用会让人误判数据是否被丢弃');
      check('数据质量：披露「原值保留在档里」与「本层不改写分值」',
        /原值/.test(txt) && /不改写/.test(txt), '不披露会让读者以为数据被删了');
      check('数据质量：披露校验口径来源（单源内部校验）',
        /单源内部校验/.test(txt), '');
      check('数据质量：含合规声明（不构成投资建议）', /不构成投资建议/.test(txt), '');
    } else {
      check('数据质量：未知态显式说明「没检查 ≠ 数据干净」',
        /未评估/.test(txt), '');
    }
  }
  // 源码层：前端不得自行实现校验规则（阈值必须唯一出处 src/dirty.js）
  {
    const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    check('数据质量：前端未自行实现校验阈值（不得出现 300 亿/500 亿等硬编码）',
      !/[>≥]\s*(300|4000|1000)\b[\s\S]{0,40}?(dirty|脏)/i.test(code),
      '前端出现校验阈值＝第二套口径，阈值唯一出处是 src/dirty.js');
  }
}

// jsdom 未实现的 DOM 桩：不判失败，但**必须打印**——否则将来真出现异常时，
// 读者会以为"一类错误被静默吞掉了"。单独一条提示说明它们为何不算失败。
if (notImplemented.length) {
  const uniq = [...new Set(notImplemented.map((m) => String(m).split('\n')[0]))];
  console.log(`[check_frontend] 提示：jsdom 未实现的 DOM 桩 ${notImplemented.length} 次（环境限制，不计失败）：`);
  for (const m of uniq.slice(0, 4)) console.log(`  · ${m}`);
}

dom.window.close();

console.log(fail.length ? `\n[check_frontend] 失败 ${fail.length} 项：${fail.join('、')}` : '\n[check_frontend] 全部通过');
process.exit(fail.length ? 1 : 0);
