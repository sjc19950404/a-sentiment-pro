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

export const REPORT_VERSION = 'report-v2';

/** 报告文档的标题与署名（正式文档需要，屏幕上被页面标题代替） */
export const REPORT_TITLE = 'A 股市场情绪研判报告';
export const REPORT_ORG = 'A股情绪系统 · PRO';

/** 章节口径折叠件的统一标题（模板规定，屏幕与导出必须一致） */
export const CALIBER_SUMMARY = '🔍 点击展开查看口径';

/**
 * 三档"配色标记"（模板预留）：
 *   风险 🔴 / 积极 🟢 / 中性 ⚫
 * 语义由**数据驱动**——由 buildBrief 在生成文本时决定挂哪一档，导出层只负责把
 * `[[risk:文字]]` 这类标记翻成对应形态（屏幕已有 .ico-* 类时不重复处理）。
 */
export const MARKERS = { risk: '🔴', pos: '🟢', neutral: '⚫' };

// ────────────────────────── 解析 DOM → 结构化 ──────────────────────────

/**
 * 把 #briefBody 的 DOM 解析成结构化报告。
 * 只认这几类节点（与 buildBrief 的输出严格对应）：
 *   .bf-meta      数据落款条
 *   .bf-abstract  极简摘要（一句话核心结论）
 *   .bf-sec       段落（.bf-h 标题 + .bf-body 正文；段内可含 .bf-caliber 口径折叠件）
 *   .bf-appendix  文末独立折叠附录（汇总全部口径）
 *   .bf-foot      其他非折叠口径备注（历史形态，保留兼容）
 * 段落正文里：.bf-li 是一行，.bf-h.bf-h2 是段内小标题，
 *             .bf-todo 是待办清单项（复选框），.bf-table 是表格（连板天梯）。
 * 保留加粗（<b>）与色调（.bf-up/.bf-dn/.bf-warn/.muted），其余标签一律丢弃——
 * 导出文档只该有「正文 + 强调」，不该带页面上的交互性包裹。
 */
export function parseReport(rootEl) {
  if (!rootEl) return { meta: null, abstract: null, sections: [], appendix: null, foot: null };

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

  // 极简摘要（模板①）：报告开头的「一句话核心」。取内层 .bf-ab-text 的文本，
  // 无内层时退化为整块文本——两种写法都能解析，避免屏幕侧改结构就解析不出来。
  const absEl = rootEl.querySelector('.bf-abstract');
  const abstract = absEl
    ? clean(inline(absEl.querySelector('.bf-ab-text') || absEl).replace(/\*\*/g, ''))
    : null;

  /**
   * 从任意容器抽「行」：.bf-li 是正文行、.bf-h 是段内小标题、.bf-todo 是待办项、
   * .bf-table 是表格。**只遍历直接子节点**，保持行的粒度（口语：一行是一行）。
   * 表格单独作为 { kind:'table', head, rows } 返回，导出层负责渲染成真表格，
   * 不做「表格摊平成一行文字」那种丢结构的降级。
   */
  const extractLines = (bodyEl) => {
    const lines = [];
    if (!bodyEl) return lines;
    for (const child of bodyEl.children) {
      const cls = child.className || '';
      if (/\bbf-table\b/.test(cls)) {
        const head = [...child.querySelectorAll('thead th, thead td')].map((th) => clean(th.textContent));
        const rows = [...child.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.children].map((td) => tidyWarn(clean(inline(td)))));
        lines.push({ kind: 'table', head, rows, caption: clean(child.getAttribute('data-caption') || '') });
      } else if (/\bbf-todo\b/.test(cls)) {
        lines.push({ kind: 'todo', text: tidyWarn(clean(inline(child))) });
      } else if (/\bbf-li\b/.test(cls)) {
        lines.push({ kind: 'li', text: tidyWarn(clean(inline(child))) });
      } else if (/\bbf-h\b/.test(cls)) {
        lines.push({ kind: 'sub', text: clean(child.textContent) });
      }
    }
    return lines;
  };

  const sections = [];
  for (const sec of rootEl.querySelectorAll('.bf-sec')) {
    const h = sec.querySelector('.bf-h');
    const title = h ? clean(h.textContent) : '';
    // 口径折叠件（模板③）：默认收起，导出时同样渲染为 <details>（纯文本形态平铺 + [口径] 前缀）。
    // 必须从 body 里"摘"出来，否则 extractLines 会把它当成一个不可识别的 div 丢掉。
    const calEl = sec.querySelector('.bf-caliber');
    const calBody = calEl ? calEl.querySelector('.bf-cal-body') : null;
    const caliber = calBody ? tidyWarn(clean(inline(calBody))) : null;
    if (calEl) calEl.remove();

    const lines = extractLines(sec.querySelector('.bf-body'));
    sections.push({ id: sec.id || '', title, lines, caliber });
  }

  // 文末独立折叠附录（模板③）：汇总全部口径。与段落口径一样，导出时是 <details>。
  const appxEl = rootEl.querySelector('.bf-appendix');
  const appxBody = appxEl ? appxEl.querySelector('.bf-cal-body') : null;
  const appendix = appxEl
    ? { title: clean(appxEl.querySelector('summary')?.textContent || '口径附录'),
        body: appxBody ? clean(inline(appxBody)) : clean(inline(appxEl)) }
    : null;

  // 兼容历史形态：若没有独立附录，仍认 .bf-foot（旧报告的写法）
  const footEl = rootEl.querySelector('.bf-foot:not(.bf-appendix)');
  const foot = footEl ? clean(inline(footEl).replace(/\*\*/g, '')) : null;

  return { meta, abstract, sections, appendix, foot };
}

// ────────────────────────── 三种输出形态 ──────────────────────────

/**
 * 纯文本 / Markdown 用的「去标记」：把文本里的标记词还原成人类可读的形态。
 *   **粗体** → 粗体（Markdown 保留 **，纯文本去掉）
 *   【涨】+1.2 → ↑+1.2 ；【跌】-1.8 → ↓-1.8（箭头比中文标记词更短、更直观）
 *   ⚠ 原样保留（是内容的一部分，不是排版标记）
 *   [[risk:文字]] / [[pos:文字]] / [[neutral:文字]] → 配色标记（Markdown 保留，纯文本保留 emoji）
 * 这些标记词只用于「屏幕 DOM → 结构化数据」的中间表示，不该泄漏到最终产物里。
 */
const stripMark = (s, keepBold = false) => String(s || '')
  .replace(/【涨】\s*/g, '↑')
  .replace(/【跌】\s*/g, '↓')
  // 配色标记：[[risk:文字]] → 🔴文字（三档统一在此落地，屏幕不用 emoji 时也能导出）
  .replace(/\[\[(risk|pos|neutral):([^\]]*)\]\]/g, (_, k, t) => MARKERS[k] + t)
  .replace(/\*\*([^*]+)\*\*/g, keepBold ? '**$1**' : '$1');

/**
 * 纯文本：复制到微信/邮件/记事本可直接读，不含任何标记。
 *
 * 降级说明：纯文本**渲染不了** <details> 折叠（没有可点开的东西），
 * 所以口径在这里一律**平铺**输出并加 `[口径]` 前缀——宁可多几行，也不丢信息。
 * 这与「默认收起、只展示指标」的屏幕体验不一致，是形态限制下的取舍，属预期。
 */
export function toPlainText(rep, opts = {}) {
  const { dataDate = '', generatedAt = '' } = opts;
  const L = [];
  L.push(REPORT_TITLE);
  if (dataDate) L.push(`数据日期：${dataDate}`);
  L.push('');
  if (rep.abstract) { L.push(`【极简摘要】${stripMark(rep.abstract)}`); L.push(''); }
  if (rep.meta) { L.push(rep.meta); L.push(''); }
  for (const sec of rep.sections) {
    L.push(sec.title);
    for (const ln of sec.lines) {
      if (ln.kind === 'sub') L.push(`  ${ln.text}`);
      else if (ln.kind === 'todo') L.push(`  [ ] ${stripMark(ln.text)}`);
      else if (ln.kind === 'table') {
        // 表格在纯文本里用「｜」分隔的对齐列，保留结构与逐只可核性
        if (ln.caption) L.push(`  ${ln.caption}`);
        if (ln.head.length) L.push('  ' + ln.head.join(' ｜ '));
        for (const r of ln.rows) L.push('  ' + r.map((c) => stripMark(c)).join(' ｜ '));
      } else L.push(`  · ${stripMark(ln.text)}`);
    }
    if (sec.caliber) L.push(`  [口径] ${stripMark(sec.caliber)}`);
    L.push('');
  }
  // 文末独立附录：纯文本里同样平铺（无折叠可用），保留 [口径] 前缀以便检索
  if (rep.appendix) {
    L.push(`【${stripMark(rep.appendix.title)}】`);
    L.push(`[口径] ${stripMark(rep.appendix.body)}`);
    L.push('');
  }
  if (rep.foot) { L.push('口径备注'); L.push(stripMark(rep.foot)); L.push(''); }
  L.push(`本报告由 ${REPORT_ORG} 规则引擎自动生成，数据来源于公开行情接口，仅供研究参考，非投资建议。`);
  if (generatedAt) L.push(`导出时间：${generatedAt}`);
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Markdown 里的表格单元格：竖线与换行必须转义，否则列会串位 */
const mdCell = (s) => stripMark(s, true).replace(/\|/g, '\\|').replace(/\n+/g, ' ');

/**
 * Markdown：可直接粘进文档系统/知识库，结构与屏幕一致。
 *
 * 模板要求「输出 Markdown，支持网页渲染折叠标签」——Markdown 本身允许内嵌 HTML，
 * 而 `<details>` 是**HTML 原生**折叠件（无需脚本），GitHub / 语雀 / Notion / 飞书等
 * 主流渲染器都支持，所以这里直接用 `<details>` 承载口径，而不是把口径藏起来或全平铺。
 * 明日观测用 GFM 任务列表语法 `- [ ]`，在支持的编辑器里可直接勾选。
 */
export function toMarkdown(rep, opts = {}) {
  const { dataDate = '', generatedAt = '' } = opts;
  const L = [];
  L.push(`# ${REPORT_TITLE}`);
  L.push('');
  if (dataDate) L.push(`**数据日期**：${dataDate}　　**生成方式**：规则引擎自动生成`);
  L.push('');
  // ① 极简摘要（一句话核心）
  if (rep.abstract) {
    L.push(`> **【极简摘要】** ${stripMark(rep.abstract, true)}`);
    L.push('');
  }
  if (rep.meta) { L.push(`> ${rep.meta.replace(/\|/g, '\\|')}`); L.push(''); }

  // ② 固定章节：正文只放指标，口径一律收进 <details>
  for (const sec of rep.sections) {
    L.push(`## ${sec.title}`);
    L.push('');
    for (const ln of sec.lines) {
      if (ln.kind === 'sub') { L.push(`### ${ln.text}`); L.push(''); }
      else if (ln.kind === 'todo') { L.push(`- [ ] ${stripMark(ln.text, true)}`); }
      else if (ln.kind === 'table') {
        if (ln.caption) { L.push(`**${mdCell(ln.caption)}**`); L.push(''); }
        if (ln.head.length) {
          L.push(`| ${ln.head.map(mdCell).join(' | ')} |`);
          L.push(`| ${ln.head.map(() => '---').join(' | ')} |`);
        }
        for (const r of ln.rows) L.push(`| ${r.map(mdCell).join(' | ')} |`);
        L.push('');
      } else L.push(`- ${stripMark(ln.text, true)}`);
    }
    // ③ 每章节口径折叠件（默认收起，仅展示指标）
    if (sec.caliber) {
      L.push('');
      L.push(`<details>`);
      L.push(`<summary>${CALIBER_SUMMARY}</summary>`);
      L.push('');
      L.push(stripMark(sec.caliber, true));
      L.push('');
      L.push(`</details>`);
    }
    L.push('');
  }

  // ③ 文末独立折叠附录：汇总全部口径
  if (rep.appendix) {
    L.push('---');
    L.push('');
    L.push('<details>');
    L.push(`<summary>${stripMark(rep.appendix.title, true)}</summary>`);
    L.push('');
    L.push(stripMark(rep.appendix.body, true));
    L.push('');
    L.push('</details>');
    L.push('');
  }
  // 兼容历史形态的口径备注
  if (rep.foot) {
    L.push('---'); L.push('');
    L.push('<details>');
    L.push('<summary>🔍 点击展开查看口径（备注）</summary>');
    L.push('');
    L.push(rep.foot);
    L.push('');
    L.push('</details>');
    L.push('');
  }
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
  // 2) 配色标记（模板④预留）：[[risk:文字]] → 带 🔴 的语义 span。
  //    注意顺序：必须在粗体之后（标记内可能含 **），且在三类标记之后（标记内可能含涨跌数字）。
  s = s.replace(/\[\[(risk|pos|neutral):([^\]]*)\]\]/g,
    (_, k, t) => `<span class="ico ico-${k}">${MARKERS[k]} ${t}</span>`);
  // 3) 涨跌：数字串整体着色。【涨】/【跌】前面可能什么都没有，后面必须紧跟数字
  s = s.replace(/【涨】\s*([+-]?[\d,.]+%?)/g, '<span class="chg"><i>▲</i> $1</span>');
  s = s.replace(/【跌】\s*([+-]?[\d,.]+%?)/g, '<span class="chg chg-dn"><i>▼</i> $1</span>');
  // 4) 警示：连续多个 ⚠ 合并成一个，闭合到该句结束（标点 / 行尾）
  s = s.replace(/(?:⚠\s*)+([^。；;]*)(?=[。；;]|$)/g, '<span class="warn">⚠ $1</span>');
  return s;
}

/**
 * 独立完整的 HTML 文档：**自包含**（内联样式、无外部依赖、无脚本），
 * 符合正式报告排版（标题页眉 / 数据落款 / 极简摘要 / 编号章节 / 口径折叠附录 / 免责声明），
 * A4 打印就绪（@page 边距、避免段落内断页、表头重复）。
 *
 * 关于「无脚本」：这不是为了省事，而是导出文档要能被邮件客户端、旧浏览器、PDF 打印器、
 * 甚至纯文本查看器安全打开。`<details>` 恰好是唯一**无需脚本**的原生折叠元素，
 * 故模板要求的折叠件在这里用 `<details>` 实现，而不是引入 JS。
 * 打印时用 CSS 强制展开全部 `<details>`（折叠着打出来会缺内容）。
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

  // ① 极简摘要（一句话核心）：独立成块，置于落款之前，读者一眼就能拿到结论
  if (rep.abstract) {
    body.push(`<p class="doc-abstract"><b>【极简摘要】</b>${inlineToHtml(rep.abstract)}</p>`);
  }
  if (rep.meta) body.push(`<p class="doc-meta">${escHtml(rep.meta)}</p>`);

  body.push(`<main class="doc-body">`);
  rep.sections.forEach((sec, i) => {
    body.push(`<section class="sec">`);
    body.push(`<h2><span class="sec-no">${i + 1}</span>${escHtml(sec.title.replace(/^[①②③④⑤⑥⑦⑧⑨]\s*/, ''))}</h2>`);
    const bullets = [];
    const todos = [];
    const flush = () => {
      if (bullets.length) { body.push(`<ul>${bullets.join('')}</ul>`); bullets.length = 0; }
      if (todos.length) { body.push(`<ul class="todo">${todos.join('')}</ul>`); todos.length = 0; }
    };
    for (const ln of sec.lines) {
      if (ln.kind === 'sub') { flush(); body.push(`<h3>${escHtml(ln.text)}</h3>`); }
      else if (ln.kind === 'todo') {
        // 复选框清单：导出文档是静态的，用 ☐ 字符而非 <input>——<input> 在打印稿里
        // 既不可交互也会被部分渲染器丢掉，反倒看不出这是"待办"。
        if (bullets.length) { body.push(`<ul>${bullets.join('')}</ul>`); bullets.length = 0; }
        todos.push(`<li><span class="cb">☐</span>${inlineToHtml(ln.text)}</li>`);
      } else if (ln.kind === 'table') {
        flush();
        if (ln.caption) body.push(`<p class="tbl-cap">${escHtml(ln.caption)}</p>`);
        const th = ln.head.map((c) => `<th>${escHtml(c)}</th>`).join('');
        const trs = ln.rows.map((r) =>
          `<tr>${r.map((c) => `<td>${inlineToHtml(c)}</td>`).join('')}</tr>`).join('');
        body.push(`<table class="rep-tbl">${th ? `<thead><tr>${th}</tr></thead>` : ''}<tbody>${trs}</tbody></table>`);
      } else bullets.push(`<li>${inlineToHtml(ln.text)}</li>`);
    }
    flush();
    // ③ 章节口径折叠件（默认收起，仅展示指标）——打印时由 CSS 强制展开
    if (sec.caliber) {
      body.push(`<details class="caliber"><summary>${escHtml(CALIBER_SUMMARY)}</summary>`);
      body.push(`<p>${inlineToHtml(sec.caliber)}</p>`);
      body.push(`</details>`);
    }
    body.push(`</section>`);
  });
  body.push(`</main>`);

  // ③ 文末独立折叠附录：汇总全部口径
  if (rep.appendix) {
    body.push(`<details class="caliber appendix" open><summary>${escHtml(rep.appendix.title)}</summary>`);
    body.push(`<p>${escHtml(rep.appendix.body)}</p>`);
    body.push(`</details>`);
  }
  // 兼容历史形态的口径备注
  if (rep.foot) {
    body.push(`<details class="caliber appendix"><summary>🔍 点击展开查看口径（备注）</summary>`);
    body.push(`<p>${escHtml(rep.foot)}</p>`);
    body.push(`</details>`);
  }

  body.push(`<footer class="doc-foot">`);
  body.push(`<p class="disclaimer"><b>免责声明</b>：本报告由 ${escHtml(REPORT_ORG)} 规则引擎根据公开行情数据自动生成，仅供研究参考，<b>不构成任何投资建议</b>。数据可能存在延迟或误差，据此操作风险自担。</p>`);
  if (url) body.push(`<p class="src">数据来源：${escHtml(url)}</p>`);
  if (generatedAt) body.push(`<p class="src">导出时间：${escHtml(generatedAt)}</p>`);
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

/* ── 极简摘要（模板①：报告开头的一句话核心） ── */
.doc-abstract { font-size: 14.5px; line-height: 1.8; background: #fbf7ec; border: 1px solid #e8dcc0;
  border-left: 4px solid #9a6b00; padding: 10px 14px; margin: 0 0 12px; border-radius: 2px;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif; text-align: justify; }

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

/* ── 连板天梯表格（模板②：连板天梯用表格） ── */
.tbl-cap { font-size: 13px; color: #333; margin: 10px 0 5px; font-weight: 600;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
.rep-tbl { width: 100%; border-collapse: collapse; margin: 0 0 10px; font-size: 13px;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif; break-inside: avoid; }
.rep-tbl th, .rep-tbl td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; vertical-align: top; }
.rep-tbl thead th { background: #f2f2f2; font-weight: 700; color: #222; white-space: nowrap; }
.rep-tbl tbody tr:nth-child(even) { background: #fafafa; }
.rep-tbl td:first-child { white-space: nowrap; font-weight: 600; }

/* ── 明日跟踪项：复选框清单（模板④） ── */
.sec ul.todo li { padding-left: 22px; }
.sec ul.todo li::before { content: none; }
.sec ul.todo .cb { position: absolute; left: 0; top: 0; color: #666; font-size: 14px; line-height: 1.75; }

/* ── 口径折叠件（模板③：<details> 原生折叠，无需脚本；📌 打印时强制展开） ── */
details.caliber { margin: 8px 0 0; border: 1px solid #e2e2e2; border-radius: 3px; background: #fcfcfc;
  break-inside: avoid; }
details.caliber > summary { cursor: pointer; padding: 6px 10px; font-size: 12.5px; color: #555;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif; user-select: none; }
details.caliber > summary:hover { color: #000; }
details.caliber > p { margin: 0; padding: 2px 12px 10px; font-size: 12px; color: #666;
  line-height: 1.8; text-align: justify; }
details.caliber.appendix { margin-top: 24px; background: #fafafa; }

/* ── 语义强调（注意：本文件是打印文档，涨红跌绿沿用中文惯例） ── */
b, strong { font-weight: 700; color: #000; }
.chg { color: #c0392b; white-space: nowrap; }
.chg-dn { color: #1e7e34; }
.chg i { font-style: normal; font-size: .8em; }
.warn { color: #9a6b00; font-weight: 600; }
/* 三档配色标记：白底打印文档里 emoji 会转黑白，故同时给文字色做区分 */
.ico { white-space: nowrap; }
.ico-risk { color: #c0392b; font-weight: 600; }
.ico-pos { color: #1e7e34; font-weight: 600; }
.ico-neutral { color: #555; }

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
  /* 折叠着打印会缺内容：口径件一律强制展开，并隐藏可点击的提示文案 */
  details.caliber > summary { list-style: none; }
  details.caliber > p, details.caliber > ul { display: block !important; }
  .rep-tbl { break-inside: avoid; }
  .rep-tbl thead { display: table-header-group; }
}
`;

/** 文件名：`研判报告_2026-09-30.html` —— 日期在前便于按时间排序 */
export function reportFileName(dataDate, ext) {
  const d = String(dataDate || '').replace(/[^\d-]/g, '') || 'unknown';
  return `A股研判报告_${d}.${ext}`;
}
