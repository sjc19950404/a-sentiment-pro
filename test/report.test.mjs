// 报告导出引擎单测：解析、三种输出形态、文件命名。
//
// jsdom 是**可选**依赖（CI 只跑 `node --test`，不装 jsdom），所以：
//   · 依赖 DOM 解析的用例在缺 jsdom 时自动跳过，不让 CI 变红
//   · 输出形态（纯文本/Markdown/HTML/命名/样式）全部基于**纯数据结构**，无需 DOM，
//     这些用例任何环境下都必须真跑——它们是这个模块的主契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  parseReport, toPlainText, toMarkdown, toStandaloneHtml, reportFileName,
  REPORT_TITLE, REPORT_ORG, STANDALONE_CSS, CALIBER_SUMMARY, MARKERS,
} from '../src/report.js';

// 可选依赖：解析不出来就跳过解析类用例
let JSDOM = null;
try { JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch (e) { JSDOM = null; }
const needDom = JSDOM ? false : 'jsdom 未安装（可选依赖），跳过 DOM 解析用例';
const dom = (html) => new JSDOM(html).window.document;

/** 造一个与 buildBrief 输出同构的 #briefBody */
function fixture() {
  const html = `
<div class="bf-meta">数据日期 <b>2026-09-30</b> · 抓取状态 <b>最新</b> · 样本 33 个交易日</div>
<div class="bf-abstract"><span class="bf-ab-tag">极简摘要</span><span class="bf-ab-text">中性震荡，控制仓位做结构｜半仓</span></div>
<div class="bf-sec" id="bfsec1">
  <div class="bf-h">① 情绪定位（核心因子·25%）</div>
  <div class="bf-body">
    <div class="bf-li">情绪 <b>68.6</b>（历史分位 <b>68.8%</b>），较昨日 <b>-8.1</b>，落于<b>中性区</b>。</div>
    <div class="bf-li"><span class="bf-warn">⚠ 因子缺失：北向，今日分可信度降权</span></div>
    <table class="bf-table" data-caption="连板天梯（当日涨停股连板数映射 zt_lb，逐只可核）">
      <thead><tr><th>板数</th><th>只数</th><th>个股</th></tr></thead>
      <tbody><tr><td>7 板</td><td>1 只</td><td>某某股份(600001)</td></tr>
      <tr><td>2 板</td><td>4 只</td><td>甲(600002)、乙(600003)</td></tr></tbody>
    </table>
  </div>
  <details class="bf-caliber"><summary>🔍 点击展开查看口径</summary><div class="bf-cal-body">情绪分为七因子加权合成（龙虎净额20%／涨跌家数10%）；历史分位＝该分在样本窗口内的百分位排名。</div></details>
</div>
<div class="bf-sec" id="bfsec2">
  <div class="bf-h">② 资金面（龙虎榜）</div>
  <div class="bf-body">
    <div class="bf-li">近5日当日龙虎净买（亿）: <span class="bf-up">+6.0</span> → <span class="bf-dn">-1.8</span></div>
    <div class="bf-h bf-h2">明日跟踪项（引擎动态生成）</div>
    <div class="bf-todo">能否守住正轴（0 亿上方）</div>
    <div class="bf-todo">新晋题材明日存活率（≥50% = 聚焦）</div>
  </div>
  <details class="bf-caliber"><summary>🔍 点击展开查看口径</summary><div class="bf-cal-body">席位分项之和与「当日榜净买」不必相等，二者不可相互校验。</div></details>
</div>
<details class="bf-caliber bf-appendix" open><summary>📚 口径附录（全报告统一口径汇总）</summary><div class="bf-cal-body">口径备注：涨跌家数为沪深两市（不含北交所）；本报告由规则引擎自动生成，非投资建议。</div></details>
<div class="bf-foot">口径备注：涨跌家数为沪深两市（不含北交所）；本报告由规则引擎自动生成，非投资建议。</div>`;
  return dom(`<div id="briefBody">${html}</div>`).getElementById('briefBody');
}

/**
 * 与 fixture() 等价的**纯数据**版本：不依赖 DOM，供输出形态用例使用。
 * 刻意手写（而非从 DOM 解析），这样即使没有 jsdom，输出契约也照样被守住。
 */
const REP_DATA = {
  meta: '数据日期 2026-09-30 · 抓取状态 最新 · 样本 33 个交易日',
  abstract: '中性震荡，控制仓位做结构｜半仓（建议仓位 40%~60%）｜情绪 68.6 落于中性区｜🔴 短板在广度量能',
  sections: [
    {
      id: 'bfsec1', title: '① 情绪定位（核心因子·25%）',
      lines: [
        { kind: 'li', text: '情绪 **68.6**（历史分位 **68.8%**），较昨日 **-8.1**，落于**中性区**。' },
        { kind: 'li', text: '⚠ 因子缺失：北向，今日分可信度降权' },
      ],
      caliber: '情绪分为七因子加权合成（龙虎净额20%／涨跌家数10%）；历史分位＝该分在样本窗口内的百分位排名。',
    },
    {
      id: 'bfsec2', title: '② 资金面（龙虎榜）',
      lines: [
        { kind: 'li', text: '近5日当日龙虎净买（亿）: 【涨】+6.0 → 【跌】-1.8' },
        { kind: 'sub', text: '明日跟踪项（引擎动态生成）' },
        { kind: 'todo', text: '能否守住正轴（0 亿上方）' },
        { kind: 'todo', text: '新晋题材明日存活率（≥50% = 聚焦）' },
      ],
      caliber: '席位分项之和与「当日榜净买」不必相等，二者不可相互校验。',
    },
    {
      id: 'bfsec3', title: '③ 盈亏效应（核心因子·25%）',
      lines: [
        { kind: 'li', text: '封板率 **81.3%**' },
        {
          kind: 'table',
          caption: '连板天梯（当日涨停股连板数映射 zt_lb，逐只可核）',
          head: ['板数', '只数', '个股'],
          rows: [['7 板', '1 只', '某某股份(600001)'], ['2 板', '4 只', '甲(600002)、乙(600003)']],
        },
      ],
      caliber: '封板率＝收盘涨停 ÷ 盘中触板个股（＝涨停+炸板）。',
    },
  ],
  appendix: { title: '📚 口径附录（全报告统一口径汇总）', body: '口径备注：涨跌家数为沪深两市（不含北交所）；本报告由规则引擎自动生成，非投资建议。' },
  foot: null,
};

test('report: 解析出段落/标题/行/落款/口径附注', { skip: needDom }, () => {
  const rep = parseReport(fixture());
  assert.equal(rep.sections.length, 2);
  // 第①段正文 = 2 条 li + 1 张连板天梯表（表格也是"一行"，但不混进 li）
  assert.equal(rep.sections[0].lines.length, 3);
  assert.equal(rep.sections[0].lines.filter((l) => l.kind === 'li').length, 2);
  assert.ok(rep.sections[0].title.includes('情绪定位'));
  assert.ok(rep.meta.includes('数据日期 2026-09-30'));
  assert.ok(rep.meta.includes('抓取状态 最新'));
  assert.ok(rep.foot.includes('口径备注'));
});

test('report: 极简摘要被解析为 abstract（模板①）', { skip: needDom }, () => {
  const rep = parseReport(fixture());
  assert.equal(rep.abstract, '中性震荡，控制仓位做结构｜半仓');
});

test('report: 口径折叠件从段落里摘出解析为 caliber（模板③，且不混进正文行）', { skip: needDom }, () => {
  const rep = parseReport(fixture());
  assert.ok(rep.sections[0].caliber.includes('七因子加权合成'), '段落口径未解析出');
  assert.equal(rep.sections[0].lines.some((l) => /七因子/.test(l.text)), false,
    '口径内容泄漏进了正文行——读者会在正文里看到本该收起的内容');
});

test('report: 文末独立折叠附录被解析为 appendix（模板③）', { skip: needDom }, () => {
  const rep = parseReport(fixture());
  assert.ok(rep.appendix, '未解析出独立附录');
  assert.ok(rep.appendix.title.includes('口径附录'));
  assert.ok(rep.appendix.body.includes('涨跌家数为沪深两市'));
});

test('report: 连板天梯解析为表格结构（模板②，不摊平成一行文字）', { skip: needDom }, () => {
  const rep = parseReport(fixture());
  const tbl = rep.sections[0].lines.find((l) => l.kind === 'table');
  assert.ok(tbl, '未解析出表格节点');
  assert.deepEqual(tbl.head, ['板数', '只数', '个股']);
  assert.equal(tbl.rows.length, 2);
  assert.equal(tbl.rows[0][0], '7 板');
  assert.ok(tbl.caption.includes('连板天梯'));
});

test('report: 明日跟踪项解析为 todo（模板④，与普通 li 区分）', { skip: needDom }, () => {
  const rep = parseReport(fixture());
  const kinds = rep.sections[1].lines.map((l) => l.kind);
  assert.deepEqual(kinds, ['li', 'sub', 'todo', 'todo']);
  assert.ok(rep.sections[1].lines[2].text.includes('守住正轴'));
});

test('report: 段内小标题（.bf-h2）识别为 sub 而非 li', { skip: needDom }, () => {
  const rep = parseReport(fixture());
  const kinds = rep.sections[1].lines.map((l) => l.kind);
  assert.equal(kinds[1], 'sub');
  assert.equal(rep.sections[1].lines[1].text, '明日跟踪项（引擎动态生成）');
});

test('report: 空输入不抛异常（报告未渲染时调用）', () => {
  const rep = parseReport(null);
  assert.deepEqual(rep, { meta: null, abstract: null, sections: [], appendix: null, foot: null });
  assert.equal(toPlainText(rep).includes(REPORT_TITLE), true); // 仍能输出一个空壳文档
});

test('report: 纯文本不含任何 HTML 标签', () => {
  const txt = toPlainText(REP_DATA, { dataDate: '2026-09-30', generatedAt: '2026-10-01 10:00' });
  assert.equal(/<[a-zA-Z/][^>]*>/.test(txt), false, '出现 HTML 残留：' + txt.match(/<[^>]*>/)?.[0]);
  assert.ok(txt.includes('情绪定位'));
  assert.ok(txt.includes('68.6'));
  assert.ok(txt.includes('2026-09-30'));
});

test('report: 纯文本保留涨跌可读性（数字在，标记不残留）', () => {
  const txt = toPlainText(REP_DATA);
  assert.ok(txt.includes('+6.0') && txt.includes('-1.8'));
  assert.equal(txt.includes('【涨】'), false, '纯文本不该带标记词');
  assert.equal(txt.includes('**'), false, '纯文本不该带 Markdown 粗体');
});

test('report: 警告标记规范化为单个 ⚠（连续/贴边都不会重复堆叠）', { skip: needDom }, () => {
  const doc = dom(`<div id="b"><div class="bf-sec"><div class="bf-h">段</div><div class="bf-body">
    <div class="bf-li"><span class="bf-warn">⚠ 甲</span></div>
    <div class="bf-li"><span class="bf-warn">⚠ ⚠ 乙</span></div>
    <div class="bf-li">+5.04亿<span class="bf-warn">⚠</span> （独立新股）</div>
  </div></div></div>`).getElementById('b');
  const rep = parseReport(doc);
  for (const l of rep.sections[0].lines) {
    const n = (l.text.match(/⚠/g) || []).length;
    assert.equal(n, 1, `「${l.text}」里 ⚠ 出现了 ${n} 次`);
  }
});

test('report: Markdown 结构合法（标题层级 + 列表）', () => {
  const md = toMarkdown(REP_DATA, { dataDate: '2026-09-30' });
  assert.ok(md.startsWith(`# ${REPORT_TITLE}`));
  assert.ok(md.includes('**数据日期**：2026-09-30'));
  assert.ok(/^## ① 情绪定位/m.test(md), '一级段标题应为 ##');
  assert.ok(/^### 明日跟踪项/m.test(md), '段内小标题应为 ###');
  assert.ok(/^- 情绪/m.test(md), '正文行应为无序列表');
  assert.ok(md.includes('> '), '应有引用块（摘要/数据落款/免责）');
  assert.ok(md.includes('非投资建议'));
});

test('report: 独立 HTML 自包含——无脚本、无外部依赖', () => {
  const html = toStandaloneHtml(REP_DATA, { dataDate: '2026-09-30', generatedAt: '2026-10-01 10:00' });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.equal(/<script/i.test(html), false, '导出文档不该带脚本');
  assert.equal(/<link[^>]+href=/i.test(html), false, '不该引用外部样式表');
  assert.equal(/(src|href)=["']https?:/i.test(html), false, '不该引用任何外部资源');
  assert.ok(html.includes('<style>'), '样式必须内联');
  assert.ok(html.includes('@page'), '必须有打印页面设置');
  assert.ok(html.includes('lang="zh-CN"'));
});

test('report: 独立 HTML 是正式文档结构（页眉/编号章节/附注/免责）', () => {
  const html = toStandaloneHtml(REP_DATA, { dataDate: '2026-09-30' });
  assert.ok(html.includes('class="doc-head"'), '缺页眉');
  assert.ok(html.includes('<h1>'), '缺主标题');
  assert.ok(html.includes(REPORT_ORG));
  assert.ok(html.includes('数据日期'));
  assert.ok(html.includes('class="sec-no"'), '章节应带编号');
  assert.ok(html.includes('口径备注'), '应含口径附注');
  assert.ok(html.includes('免责声明'), '应含免责声明');
});

test('report: HTML 转义——报告文本里的尖括号不会变成标签（防注入）', { skip: needDom }, () => {
  const doc = dom(`<div id="b"><div class="bf-sec"><div class="bf-h">段</div><div class="bf-body">
    <div class="bf-li">某票 &lt;script&gt;alert(1)&lt;/script&gt; 与 a &amp; b</div>
  </div></div></div>`).getElementById('b');
  const html = toStandaloneHtml(parseReport(doc), { dataDate: '2026-09-30' });
  assert.equal(/<script>alert/.test(html), false, '未转义导致注入');
  assert.ok(html.includes('&lt;script&gt;'), '应保留转义后的原文');
  assert.ok(html.includes('a &amp; b'));
});

test('report: 涨跌/警示在 HTML 里用语义标签且**成对闭合**', () => {
  const html = toStandaloneHtml(REP_DATA, { dataDate: '2026-09-30' });
  assert.ok(html.includes('class="chg"'), '涨应带 .chg');
  assert.ok(html.includes('class="chg chg-dn"'), '跌应带 .chg-dn');
  assert.ok(html.includes('class="warn"'), '警示应带 .warn');
  // 标签配对：任何 <span 必须有等量 </span>
  const open = (html.match(/<span\b/g) || []).length;
  const close = (html.match(/<\/span>/g) || []).length;
  assert.equal(open, close, `span 未配对：开 ${open} 闭 ${close}`);
});

test('report: 涨跌着色只覆盖数字，不吃掉后文', () => {
  const html = toStandaloneHtml(REP_DATA, {});
  // 【涨】+6.0 → 着色 span 必须恰好在 +6.0 后闭合，紧随其后的「 → 」不能被裹进去
  assert.ok(/<span class="chg"><i>▲<\/i> \+6\.0<\/span>/.test(html),
    '着色范围不对：' + (html.match(/<span class="chg">[\s\S]{0,60}/) || [''])[0]);
});

test('report: 粗体正确映射为 <b>，且不残留 ** 标记', () => {
  const html = toStandaloneHtml(REP_DATA, {});
  assert.ok(html.includes('<b>68.6</b>'));
  assert.equal(html.includes('**'), false, 'HTML 里不该残留 Markdown 标记');
});

test('report: 文件名按日期命名（便于排序），非法日期有兜底', () => {
  assert.equal(reportFileName('2026-09-30', 'html'), 'A股研判报告_2026-09-30.html');
  assert.equal(reportFileName('2026-09-30', 'md'), 'A股研判报告_2026-09-30.md');
  assert.equal(reportFileName('', 'txt'), 'A股研判报告_unknown.txt');
  assert.equal(reportFileName(null, 'txt'), 'A股研判报告_unknown.txt');
});

test('report: 样式表是白底黑字（导出/打印的文档不能是深色底）', () => {
  assert.ok(/body\s*\{[^}]*background:\s*#fff/i.test(STANDALONE_CSS), 'body 应为白底');
  assert.ok(/color:\s*#1a1a1a/i.test(STANDALONE_CSS), '正文应为近黑色字');
  assert.equal(/#0d1117|#161b22/i.test(STANDALONE_CSS), false, '不该出现站点深色主题色');
  assert.ok(/@media print/.test(STANDALONE_CSS));
  // 涨红跌绿（中文惯例）在导出文档里同样成立
  assert.ok(/\.chg\s*\{[^}]*#c0392b/i.test(STANDALONE_CSS));
  assert.ok(/\.chg-dn\s*\{[^}]*#1e7e34/i.test(STANDALONE_CSS));
});

// ────────────────────────────────────────────────────────────────────────────
// 模板契约（用户给定的「A 股研判报告输出模板」五条）。
// 这一组用例的意义：模板是**排版层**的硬约束，不是"最好做到"的建议。
// 一旦有人重构导出引擎时把摘要/折叠/表格/复选框弄丢，这里会立刻变红。
// 同时它们守住另一条更重要的纪律——**导出只翻译屏幕 DOM，不重算任何指标**
// （见文件头的说明；report.js 里不应出现 tanh/加权/阈值之类的计算）。
// ────────────────────────────────────────────────────────────────────────────

test('模板①：报告开头有【极简摘要】，且排在首个章节之前', () => {
  const md = toMarkdown(REP_DATA, { dataDate: '2026-09-30' });
  assert.ok(md.includes('【极简摘要】'), 'Markdown 缺极简摘要');
  assert.ok(md.indexOf('【极简摘要】') < md.indexOf('## ① 情绪定位'), '摘要没有排在报告开头');
  const html = toStandaloneHtml(REP_DATA, { dataDate: '2026-09-30' });
  assert.ok(html.includes('class="doc-abstract"'), 'HTML 缺摘要块');
  assert.ok(html.indexOf('doc-abstract') < html.indexOf('class="sec"'), '摘要没有排在首个章节前');
});

test('模板②：固定 7 大章节时输出 7 个 ##，连板天梯是 Markdown 表格而非一行文字', () => {
  const md = toMarkdown(REP_DATA, {});
  // 三条章节目录前缀 ① ② ③ 必须都在（其余章节由 app.js 保证 ④~⑦）
  assert.ok(/^## ①/m.test(md) && /^## ②/m.test(md) && /^## ③/m.test(md));
  // 天梯表格：表头 + 分隔行 + 数据行，三者缺一不可
  assert.ok(/\|\s*板数\s*\|\s*只数\s*\|\s*个股\s*\|/.test(md), '天梯表头缺失');
  assert.ok(/\|\s*---\s*\|\s*---\s*\|\s*---\s*\|/.test(md), '表格缺分隔行（Markdown 不会渲染成表）');
  assert.ok(/\|\s*7 板\s*\|/.test(md), '天梯数据行缺失');
});

test('模板③：每个章节口径收进 <details>，文末有独立折叠附录', () => {
  const md = toMarkdown(REP_DATA, {});
  const open = (md.match(/<details>/g) || []).length;
  const close = (md.match(/<\/details>/g) || []).length;
  assert.equal(open, close, `<details> 未配对：开 ${open} 闭 ${close}`);
  // 三个章节各一个折叠件 + 1 个文末附录
  assert.ok(open >= 4, `折叠件数量不足：${open}`);
  assert.ok(md.includes(`<summary>${CALIBER_SUMMARY}</summary>`), '章节折叠件标题必须与约定一致');
  assert.ok(md.includes('口径附录'), '缺文末独立口径附录');
  // 默认收起 = 每处口径都必须落在 <details>…</details> 之间，而不是裸露在正文里
  for (const cal of REP_DATA.sections.map((s) => s.caliber).filter(Boolean)) {
    const i = md.indexOf(cal);
    assert.ok(i > 0, `口径内容整段丢失：${cal.slice(0, 12)}…`);
    const before = md.slice(0, i);
    const lastOpen = before.lastIndexOf('<details>');
    const lastClose = before.lastIndexOf('</details>');
    assert.ok(lastOpen > lastClose, `口径未包在 <details> 内（等于默认展开）：${cal.slice(0, 12)}…`);
  }
});

test('模板④：关键数值加粗 / 风险带 ⚠ / 跟踪项为 GFM 复选框 / 三档配色标记齐备', () => {
  const md = toMarkdown(REP_DATA, {});
  assert.ok(md.includes('**68.6**'), '关键数值未加粗');
  assert.ok(md.includes('⚠'), '风险提示未带 ⚠');
  assert.ok(/^- \[ \] 能否守住正轴/m.test(md), '跟踪项未输出 GFM 复选框语法');
  // 三档配色标记：risk/pos/neutral 各对应一个 emoji，且常量与实现一致
  assert.equal(MARKERS.risk, '🔴'); assert.equal(MARKERS.pos, '🟢'); assert.equal(MARKERS.neutral, '⚫');
  const withMark = { ...REP_DATA, abstract: '[[risk:短板在广度量能]]｜[[pos:资金进场]]｜[[neutral:中性震荡]]' };
  const md2 = toMarkdown(withMark, {});
  assert.ok(md2.includes('🔴短板在广度量能'), 'risk 标记未落地');
  assert.ok(md2.includes('🟢资金进场'), 'pos 标记未落地');
  assert.ok(md2.includes('⚫中性震荡'), 'neutral 标记未落地');
  assert.equal(md2.includes('[['), false, '标记语法泄漏到了成品');
  const html2 = toStandaloneHtml(withMark, {});
  assert.ok(html2.includes('class="ico ico-risk"') && html2.includes('class="ico ico-pos"')
    && html2.includes('class="ico ico-neutral"'), 'HTML 未渲染三档配色类');
  assert.equal(/\[\[/.test(html2), false, 'HTML 里标记语法泄漏');
  const txt2 = toPlainText(withMark, {});
  assert.ok(txt2.includes('🔴短板在广度量能'), '纯文本丢了配色标记（emoji 是唯一能跨形态保留的载体）');
});

test('模板⑤：结尾附免责声明与导出时间', () => {
  const md = toMarkdown(REP_DATA, { generatedAt: '2026-10-01 10:00' });
  assert.ok(md.trimEnd().endsWith('> 导出时间：2026-10-01 10:00'), 'Markdown 结尾不是导出时间');
  assert.ok(md.includes('非投资建议'));
  const html = toStandaloneHtml(REP_DATA, { generatedAt: '2026-10-01 10:00' });
  assert.ok(html.includes('免责声明') && html.includes('2026-10-01 10:00'));
  const txt = toPlainText(REP_DATA, { generatedAt: '2026-10-01 10:00' });
  assert.ok(txt.includes('非投资建议') && txt.includes('导出时间：2026-10-01 10:00'));
});

test('模板·降级：纯文本渲染不了折叠，口径一律平铺并带 [口径] 前缀（不丢信息）', () => {
  const txt = toPlainText(REP_DATA, {});
  assert.equal(/<details|<summary/.test(txt), false, '纯文本不该出现折叠标签');
  assert.ok(txt.includes('[口径] 情绪分为七因子加权合成'), '章节口径未被平铺保留');
  assert.ok(txt.includes('[口径] 口径备注：涨跌家数为沪深两市'), '附录口径未被平铺保留');
  assert.ok(txt.includes('[ ] 能否守住正轴'), '复选框在纯文本里应降级为 [ ]');
});

test('模板·HTML：<details> 折叠件无需脚本即可用（导出文档仍然无 JS）', () => {
  const html = toStandaloneHtml(REP_DATA, {});
  assert.ok(html.includes('<details class="caliber"'), 'HTML 缺折叠件');
  assert.ok(html.includes(`<summary>${CALIBER_SUMMARY}</summary>`), '折叠件标题必须与约定一致');
  assert.ok(html.includes('details.caliber'), '样式表缺折叠件样式');
  assert.equal(/<script/i.test(html), false, '折叠件是原生 HTML，不该为此引入脚本');
  // 打印时折叠件必须强制展开（收起着打出来会缺口径）
  assert.ok(/details\.caliber\s*>\s*p[^}]*display:\s*block\s*!important/.test(STANDALONE_CSS),
    '打印样式未强制展开口径件');
});

test('模板·HTML：表格与复选框清单渲染为语义标签', () => {
  const html = toStandaloneHtml(REP_DATA, {});
  assert.ok(/<table class="rep-tbl">/.test(html), '缺表格');
  assert.ok(/<thead><tr><th>板数<\/th>/.test(html), '表头未渲染为 th（打印时不会重复表头）');
  assert.ok(html.includes('<ul class="todo">'), '复选框清单未渲染为独立列表');
  assert.ok(html.includes('class="cb"'), '缺复选框占位符 ☐');
  assert.equal(/<input[^>]*type=["']checkbox/i.test(html), false,
    '导出文档里不该用 <input>（静态稿里不可交互，部分渲染器还会丢掉）');
});

test('模板·纪律：导出层不重算指标（不出现 tanh/加权/阈值推导）', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/report.js', import.meta.url), 'utf8'));
  // 去掉注释后，统计代码里不该出现"重新算一个指标"的痕迹
  const code = src.split('\n').filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');
  for (const bad of [/Math\.tanh/, /scoreEmotion|scorePnl|scoreTheme|scoreBreadth/, /weights?\s*\./, /clamp100/]) {
    assert.equal(bad.test(code), false, `report.js 里出现了指标计算痕迹：${bad}`);
  }
});

