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
  REPORT_TITLE, REPORT_ORG, STANDALONE_CSS,
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
<div class="bf-sec" id="bfsec1">
  <div class="bf-h">① 情绪定位（核心因子·25%）</div>
  <div class="bf-body">
    <div class="bf-li">情绪 <b>68.6</b>（历史分位 <b>68.8%</b>），较昨日 <b>-8.1</b>，落于<b>中性区</b>。</div>
    <div class="bf-li"><span class="bf-warn">⚠ 因子缺失：北向，今日分可信度降权</span></div>
  </div>
</div>
<div class="bf-sec" id="bfsec2">
  <div class="bf-h">② 资金面（龙虎榜）</div>
  <div class="bf-body">
    <div class="bf-li">近5日当日龙虎净买（亿）: <span class="bf-up">+6.0</span> → <span class="bf-dn">-1.8</span></div>
    <div class="bf-h bf-h2">明日观测（引擎动态生成）</div>
    <div class="bf-li">· 能否守住正轴</div>
  </div>
</div>
<div class="bf-foot">口径备注：涨跌家数为沪深两市（不含北交所）；本报告由规则引擎自动生成，非投资建议。</div>`;
  return dom(`<div id="briefBody">${html}</div>`).getElementById('briefBody');
}

/**
 * 与 fixture() 等价的**纯数据**版本：不依赖 DOM，供输出形态用例使用。
 * 刻意手写（而非从 DOM 解析），这样即使没有 jsdom，输出契约也照样被守住。
 */
const REP_DATA = {
  meta: '数据日期 2026-09-30 · 抓取状态 最新 · 样本 33 个交易日',
  sections: [
    {
      id: 'bfsec1', title: '① 情绪定位（核心因子·25%）',
      lines: [
        { kind: 'li', text: '情绪 **68.6**（历史分位 **68.8%**），较昨日 **-8.1**，落于**中性区**。' },
        { kind: 'li', text: '⚠ 因子缺失：北向，今日分可信度降权' },
      ],
    },
    {
      id: 'bfsec2', title: '② 资金面（龙虎榜）',
      lines: [
        { kind: 'li', text: '近5日当日龙虎净买（亿）: 【涨】+6.0 → 【跌】-1.8' },
        { kind: 'sub', text: '明日观测（引擎动态生成）' },
        { kind: 'li', text: '· 能否守住正轴' },
      ],
    },
  ],
  foot: '口径备注：涨跌家数为沪深两市（不含北交所）；本报告由规则引擎自动生成，非投资建议。',
};

test('report: 解析出段落/标题/行/落款/口径附注', { skip: needDom }, () => {
  const rep = parseReport(fixture());
  assert.equal(rep.sections.length, 2);
  assert.equal(rep.sections[0].lines.length, 2);
  assert.ok(rep.sections[0].title.includes('情绪定位'));
  assert.ok(rep.meta.includes('数据日期 2026-09-30'));
  assert.ok(rep.meta.includes('抓取状态 最新'));
  assert.ok(rep.foot.includes('口径备注'));
});

test('report: 段内小标题（.bf-h2）识别为 sub 而非 li', { skip: needDom }, () => {
  const rep = parseReport(fixture());
  const kinds = rep.sections[1].lines.map((l) => l.kind);
  assert.deepEqual(kinds, ['li', 'sub', 'li']);
  assert.equal(rep.sections[1].lines[1].text, '明日观测（引擎动态生成）');
});

test('report: 空输入不抛异常（报告未渲染时调用）', () => {
  const rep = parseReport(null);
  assert.deepEqual(rep, { meta: null, sections: [], foot: null });
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
  assert.ok(/^### 明日观测/m.test(md), '段内小标题应为 ###');
  assert.ok(/^- 情绪/m.test(md), '正文行应为无序列表');
  assert.ok(md.includes('> '), '应有引用块（数据落款/免责）');
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

