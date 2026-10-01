// 研判报告导出引擎（唯一来源）
//
// 为什么放在 src/ 而不是写在 app.js 里：
//   报告的「屏幕渲染」与「导出文档」必须是同一份内容——如果导出另写一套字符串拼接，
//   两边的数字/口径迟早漂移。所以这里不重新计算任何指标，只做一件事：
//   把**屏幕上真实渲染出来的那份 DOM**（#briefBody 的 .bf-sec 结构）翻译成
//   纯文本 / Markdown / 独立 HTML 三种形态。用户看到的即导出的。
//
// 纯函数为主（除 parseReport 需要 DOM 之外，其余都收结构化数据），Node 与浏览器共用，
// 便于单元测试直接在 Node 里跑断言。

export const REPORT_VERSION = 'report-v1';

/** 报告文档的标题与署名（正式文档需要，屏幕上被页面标题代替） */
export const REPORT_TITLE = 'A 股市场情绪研判报告';
export const REPORT_ORG = 'A股情绪系统 · PRO';

// ────────────────────────── 解析 DOM → 结构化 ──────────────────────────

/**
 * 把 #briefBody 的 DOM 解析成结构化报告。
 * 只认三类节点（与 buildBrief 的输出严格对应）：
 *   .bf-meta  数据落款条
 *   .bf-sec   段落（.bf-h 标题 + .bf-body 正文）
 *   .bf-foot  口径备注
 * 段落正文里：.bf-li 是一行，.bf-h.bf-h2 是段内小标题。
 * 保留加粗（<b>）与色调（.bf-up/.bf-dn/.bf-warn/.muted），其余标签一律丢弃——
 * 导出文档只该有「正文 + 强调」，不该带页面上的交互性包裹。
 */
export function parseReport(rootEl) {
  if (!rootEl) return { meta: null, sections: [], foot: null };

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // 原文里「⚠」出现的位置很不整齐：有的连续两个（页面用两个容器强调）、
  // 有的紧贴在数字/单位后面（「+5.04亿⚠ （独立新股）」）。
  // 导出给外人看的文档不能带这种排版噪音，统一规范成「句首一个 ⚠ + 空格」。
  const tidyWarn = (s) => s
    // 连续多个 ⚠（含中间空白）合并成一个——页面里常见「⚠ ⚠」叠着的写法
    .replace(/(?:⚠\s*){2,}/g, '⚠ ')
    // 紧贴前后文字的 ⚠（「+5.04亿⚠ （独立新股）」）两侧补空格，避免和数字/单位粘在一起
    .replace(/([^\s（【「『])⚠/g, '$1 ⚠')
    .replace(/⚠([^\s，。；：、）】」』！？])/g, '⚠ $1')
    .replace(/([（【「『])\s+/g, '$1')         // 开括号后的空格是排版噪音
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 递归把节点转成「带标记的纯文本」，保留 b/strong（粗）、i/em（斜体）与语义色，
  // 其余标签只取文字（br 转空格避免粘字）。
  const inline = (node) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { out += ' '; continue; }
      const inner = inline(n);
      const cls = n.className || '';
      if (tag === 'b' || tag === 'strong') out += `**${clean(inner)}**`;
      else if (/\bbf-up\b/.test(cls)) out += `【涨】${clean(inner)}`;
      else if (/\bbf-dn\b/.test(cls)) out += `【跌】${clean(inner)}`;
      else if (/\bbf-warn\b/.test(cls)) out += `⚠ ${clean(inner)}`;
      else if (/\bmuted\b/.test(cls)) out += clean(inner);
      else out += inner;
    }
    return out;
  };

  const metaEl = rootEl.querySelector('.bf-meta');
  const meta = metaEl ? clean(inline(metaEl).replace(/\*\*/g, '')) : null;

  const sections = [];
  for (const sec of rootEl.querySelectorAll('.bf-sec')) {
    const h = sec.querySelector('.bf-h');
    const title = h ? clean(h.textContent) : '';
    const bodyEl = sec.querySelector('.bf-body');
    const lines = [];
    if (bodyEl) {
      // 只遍历 body 的直接子节点，保持「行」的粒度；段内小标题（.bf-h2）单独标记
      for (const child of bodyEl.children) {
        const cls = child.className || '';
        if (/\bbf-li\b/.test(cls)) {
          lines.push({ kind: 'li', text: tidyWarn(clean(inline(child))) });
        } else if (/\bbf-h\b/.test(cls)) {
          lines.push({ kind: 'sub', text: clean(child.textContent) });
        }
      }
    }
    sections.push({ id: sec.id || '', title, lines });
  }

  const footEl = rootEl.querySelector('.bf-foot');
  const foot = footEl ? clean(inline(footEl).replace(/\*\*/g, '')) : null;

  return { meta, sections, foot };
}

// ────────────────────────── 三种输出形态 ──────────────────────────

/**
 * 纯文本 / Markdown 用的「去标记」：把文本里的标记词还原成人类可读的形态。
 *   **粗体** → 粗体（Markdown 保留 **，纯文本去掉）
 *   【涨】+1.2 → ↑+1.2 ；【跌】-1.8 → ↓-1.8（箭头比中文标记词更短、更直观）
 *   ⚠ 原样保留（是内容的一部分，不是排版标记）
 * 这两个标记词只用于「屏幕 DOM → 结构化数据」的中间表示，不该泄漏到最终产物里。
 */
const stripMark = (s, keepBold = false) => String(s || '')
  .replace(/【涨】\s*/g, '↑')
  .replace(/【跌】\s*/g, '↓')
  .replace(/\*\*([^*]+)\*\*/g, keepBold ? '**$1**' : '$1');

/** 纯文本：复制到微信/邮件/记事本可直接读，不含任何标记 */
export function toPlainText(rep, opts = {}) {
  const { dataDate = '', generatedAt = '' } = opts;
  const L = [];
  L.push(REPORT_TITLE);
  if (dataDate) L.push(`数据日期：${dataDate}`);
  L.push('');
  if (rep.meta) { L.push(rep.meta); L.push(''); }
  for (const sec of rep.sections) {
    L.push(sec.title);
    for (const ln of sec.lines) {
      if (ln.kind === 'sub') L.push(`  ${ln.text}`);
      else L.push(`  · ${stripMark(ln.text)}`);
    }
    L.push('');
  }
  if (rep.foot) { L.push('口径备注'); L.push(stripMark(rep.foot)); L.push(''); }
  L.push(`本报告由 ${REPORT_ORG} 规则引擎自动生成，数据来源于公开行情接口，仅供研究参考，非投资建议。`);
  if (generatedAt) L.push(`导出时间：${generatedAt}`);
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Markdown：可直接粘进文档系统/知识库，结构与屏幕一致 */
export function toMarkdown(rep, opts = {}) {
  const { dataDate = '', generatedAt = '' } = opts;
  const L = [];
  L.push(`# ${REPORT_TITLE}`);
  L.push('');
  if (dataDate) L.push(`**数据日期**：${dataDate}　　**生成方式**：规则引擎自动生成`);
  L.push('');
  if (rep.meta) { L.push(`> ${rep.meta.replace(/\|/g, '\\|')}`); L.push(''); }
  for (const sec of rep.sections) {
    L.push(`## ${sec.title}`);
    L.push('');
    for (const ln of sec.lines) {
      if (ln.kind === 'sub') { L.push(`### ${ln.text}`); L.push(''); }
      else L.push(`- ${ln.text}`);
    }
    L.push('');
  }
  if (rep.foot) { L.push('---'); L.push(''); L.push('### 口径备注'); L.push(''); L.push(rep.foot); L.push(''); }
  L.push('---');
  L.push('');
  L.push(`> 本报告由 ${REPORT_ORG} 规则引擎自动生成，数据来源于公开行情接口，仅供研究参考，**非投资建议**。`);
  if (generatedAt) L.push(`> 导出时间：${generatedAt}`);
  L.push('');
  return L.join('\n');
}

const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * 行内标记 → HTML。
 * 顺序很关键：**先转义**（报告文本里的 < > 不能变成真标签，防注入），**再**把标记词换成标签。
 *
 * 三种标记各自需要一个明确的收尾边界，不能开一个 span 就撒手：
 *   · **文字** → 显式成对，直接闭合
 *   · 【涨】+1.2 / 【跌】-1.8 → 颜色只该覆盖这个数字，故用「数字串」做闭合边界
 *     （涨跌值形如 +6.0 / -1.8 / 0.00，可能带正负号与小数点）
 *   · ⚠（可能是连续的「⚠ ⚠」）→ 挂在后随那句话上，闭合到标点或行尾
 */
function inlineToHtml(raw) {
  let s = escHtml(raw);
  // 1) 粗体：成对闭合
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // 2) 涨跌：数字串整体着色。【涨】/【跌】前面可能什么都没有，后面必须紧跟数字
  s = s.replace(/【涨】\s*([+-]?[\d,.]+%?)/g, '<span class="chg"><i>▲</i> $1</span>');
  s = s.replace(/【跌】\s*([+-]?[\d,.]+%?)/g, '<span class="chg chg-dn"><i>▼</i> $1</span>');
  // 3) 警示：连续多个 ⚠ 合并成一个，闭合到该句结束（标点 / 行尾）
  s = s.replace(/(?:⚠\s*)+([^。；;]*)(?=[。；;]|$)/g, '<span class="warn">⚠ $1</span>');
  return s;
}

/**
 * 独立完整的 HTML 文档：**自包含**（内联样式、无外部依赖、无脚本），
 * 符合正式报告排版（标题页眉 / 数据落款 / 编号章节 / 口径附注 / 免责声明），
 * A4 打印就绪（@page 边距、避免段落内断页、表头重复）。
 */
export function toStandaloneHtml(rep, opts = {}) {
  const { dataDate = '', generatedAt = '', url = '' } = opts;
  const css = STANDALONE_CSS;
  const body = [];
  body.push(`<header class="doc-head">`);
  body.push(`<div class="doc-org">${escHtml(REPORT_ORG)}</div>`);
  body.push(`<h1>${escHtml(REPORT_TITLE)}</h1>`);
  body.push(`<div class="doc-sub">规则引擎自动生成 · 口径与回测引擎同源</div>`);
  body.push(`<dl class="doc-facts">`);
  body.push(`<div><dt>数据日期</dt><dd>${escHtml(dataDate || '—')}</dd></div>`);
  body.push(`<div><dt>生成方式</dt><dd>规则引擎（每日随档生成）</dd></div>`);
  if (generatedAt) body.push(`<div><dt>导出时间</dt><dd>${escHtml(generatedAt)}</dd></div>`);
  body.push(`</dl>`);
  body.push(`</header>`);

  if (rep.meta) body.push(`<p class="doc-meta">${escHtml(rep.meta)}</p>`);

  body.push(`<main class="doc-body">`);
  rep.sections.forEach((sec, i) => {
    body.push(`<section class="sec">`);
    body.push(`<h2><span class="sec-no">${i + 1}</span>${escHtml(sec.title.replace(/^[①②③④⑤⑥⑦⑧⑨]\s*/, ''))}</h2>`);
    const bullets = [];
    const flush = () => { if (bullets.length) { body.push(`<ul>${bullets.join('')}</ul>`); bullets.length = 0; } };
    for (const ln of sec.lines) {
      if (ln.kind === 'sub') { flush(); body.push(`<h3>${escHtml(ln.text)}</h3>`); }
      else bullets.push(`<li>${inlineToHtml(ln.text)}</li>`);
    }
    flush();
    body.push(`</section>`);
  });
  body.push(`</main>`);

  if (rep.foot) {
    body.push(`<section class="sec sec-note">`);
    body.push(`<h2><span class="sec-no">附</span>口径备注</h2>`);
    body.push(`<p class="note">${escHtml(rep.foot)}</p>`);
    body.push(`</section>`);
  }

  body.push(`<footer class="doc-foot">`);
  body.push(`<p class="disclaimer"><b>免责声明</b>：本报告由 ${escHtml(REPORT_ORG)} 规则引擎根据公开行情数据自动生成，仅供研究参考，<b>不构成任何投资建议</b>。数据可能存在延迟或误差，据此操作风险自担。</p>`);
  if (url) body.push(`<p class="src">数据来源：${escHtml(url)}</p>`);
  body.push(`</footer>`);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(REPORT_TITLE)}${dataDate ? ' · ' + escHtml(dataDate) : ''}</title>
<style>${css}</style>
</head>
<body>
<article class="doc">
${body.join('\n')}
</article>
</body>
</html>
`;
}

// 正式文档排版：白底黑字、衬线标题、A4 友好。刻意**不**跟随站点深色主题——
// 导出/打印的文档是要发给别人、拿去打印的，深色底打印会变成一片黑。
export const STANDALONE_CSS = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { color: #1a1a1a; font: 15px/1.75 "Songti SC", "SimSun", Georgia, "Microsoft YaHei", serif; }
.doc { max-width: 820px; margin: 0 auto; padding: 28px 32px 48px; }

/* ── 页眉 ── */
.doc-head { border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 18px; }
.doc-org { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 12px; letter-spacing: 2px; color: #666; }
.doc-head h1 { font-size: 26px; margin: 6px 0 4px; letter-spacing: 1px; font-weight: 700; }
.doc-sub { font-size: 13px; color: #555; }
.doc-facts { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 12px 0 0; padding: 0; }
.doc-facts > div { display: flex; gap: 8px; font-size: 13px; }
.doc-facts dt { color: #888; }
.doc-facts dd { margin: 0; font-weight: 600; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }

/* ── 数据落款 ── */
.doc-meta { font-size: 12.5px; color: #555; background: #f6f6f6; border-left: 3px solid #999;
  padding: 8px 12px; margin: 0 0 22px; line-height: 1.7; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }

/* ── 章节 ── */
.sec { margin-bottom: 22px; break-inside: avoid-page; }
.sec h2 { font-size: 17px; margin: 0 0 10px; padding-bottom: 5px; border-bottom: 1px solid #ddd;
  display: flex; align-items: baseline; gap: 8px; font-weight: 700; }
.sec-no { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px;
  background: #1a1a1a; color: #fff; font-size: 12px; border-radius: 50%; font-family: "PingFang SC", sans-serif;
  padding: 0 5px; flex: none; }
.sec h3 { font-size: 14px; margin: 12px 0 6px; color: #333; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
.sec ul { margin: 0; padding-left: 0; list-style: none; }
.sec li { position: relative; padding-left: 16px; margin-bottom: 6px; break-inside: avoid; }
.sec li::before { content: ""; position: absolute; left: 5px; top: .68em; width: 5px; height: 5px;
  background: #999; border-radius: 50%; }
.sec-note .note { font-size: 12px; color: #666; line-height: 1.8; text-align: justify; }

/* ── 语义强调（注意：本文件是打印文档，涨红跌绿沿用中文惯例） ── */
b, strong { font-weight: 700; color: #000; }
.chg { color: #c0392b; white-space: nowrap; }
.chg-dn { color: #1e7e34; }
.chg i { font-style: normal; font-size: .8em; }
.warn { color: #9a6b00; font-weight: 600; }

/* ── 页脚 ── */
.doc-foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid #ddd; }
.disclaimer { font-size: 12px; color: #666; line-height: 1.8;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0 0 6px; }
.src { font-size: 11px; color: #999; margin: 0; font-family: "PingFang SC", sans-serif; }

/* ── 打印微调 ── */
@media print {
  .doc { max-width: none; padding: 0; }
  a { color: inherit; text-decoration: none; }
  .sec { break-inside: auto; }
  .sec h2, .sec h3 { break-after: avoid; }
  .doc-foot { break-inside: avoid; }
}
`;

/** 文件名：`研判报告_2026-09-30.html` —— 日期在前便于按时间排序 */
export function reportFileName(dataDate, ext) {
  const d = String(dataDate || '').replace(/[^\d-]/g, '') || 'unknown';
  return `A股研判报告_${d}.${ext}`;
}
