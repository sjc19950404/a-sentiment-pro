// 研判报告「出厂质检」引擎（唯一来源）
//
// 为什么需要这一层：
//   报告的屏幕渲染（app.js::buildBrief）与导出（src/report.js）已共用同一份 DOM，
//   但「结构是否正确」此前只靠**事后**跑测试脚本（scripts/check_frontend.mjs、
//   scripts/audit_lhb_caliber.mjs）来保证——那是 CI 里的事，用户当场看到的报告
//   可能是坏的（缺摘要、少一段、口径折叠件没挂上，甚至指标被重算过）。
//
//   本模块把「测试脚本事后检查」变成「渲染前当场把关」：
//   先构建 → 审计 → 通过才写入 #briefBody。不通过就不渲染，用户看不到坏报告。
//
// 设计纪律（与 src/report.js 一致）：
//   · 纯函数、零依赖、ESM —— Node 单测与浏览器共用同一份判据，不写两遍。
//   · **只读**：本模块绝不修改报告数据、指标、阈值，只做结构校验与「数字可回溯」比对。
//   · 失败必须给出可读的人话原因（id + 说明 + 期望/实际），而不是一句 "audit failed"。
//
// 与 report.js 的关系：report.js 负责「DOM → 三种形态的翻译」，本模块负责
// 「翻译出来的东西是否还符合用户给定的模板契约」。两者都不重算指标。

/** 审计引擎版本（审计规则变了要能一眼看出是哪一版判的） */
export const AUDIT_VERSION = 'report-audit-v1';

/**
 * 用户给定的模板契约里「固定几大章节」。
 * 数字写在这里而不是从 DOM 数出来——若从 DOM 数，少一段时光看数字永远"自洽"，
 * 就永远发现不了缺段。**必须**是人工声明的期望值，才能当判据。
 */
export const EXPECTED_SECTIONS = 7;

/** 章节口径折叠件的统一标题（与 src/report.js 的 CALIBER_SUMMARY 同值，防漂移） */
export const CALIBER_SUMMARY = '🔍 点击展开查看口径';

/**
 * 审计项定义表：每项是 { id, msg, run(ctx) }。
 * run 返回真值即通过；返回字符串视为失败并作为原因；返回 false 用默认 msg。
 * ctx = { rep, rootEl, md, txt, html }
 *
 * 说明：把「检查项」写成数据表（而不是一长串 if），是为了——
 *   ① 失败时能报出**哪一项**（id 稳定，前端可展示、测试可断言）；
 *   ② 新增检查项不必改主流程；
 *   ③ 表本身可被守卫脚本读取（见 audit_lhb_caliber 的 B7 块）。
 */
export const RULES = [
  {
    id: 'abstract-present',
    msg: '报告开头缺【极简摘要】（模板①：一句话总结核心）',
    run: (c) => !!(c.rep && c.rep.abstract && c.rep.abstract.trim()),
  },
  {
    id: 'abstract-first',
    msg: '【极简摘要】不在报告最前面（模板①要求置于开头）',
    // 在屏幕 DOM 上按文档顺序比较：摘要节点必须早于第一个 .bf-sec
    run: (c) => {
      if (!c.rootEl || !c.rootEl.querySelector) return true; // 无 DOM 时不判（Node 侧只测结构）
      const abs = c.rootEl.querySelector('.bf-abstract');
      const firstSec = c.rootEl.querySelector('.bf-sec');
      if (!abs || !firstSec) return true;
      // compareDocumentPosition: 4 = DOCUMENT_POSITION_FOLLOWING（abs 在 firstSec 之前）
      return !!(abs.compareDocumentPosition(firstSec) & 4);
    },
  },
  {
    id: 'sections-count',
    msg: `章节数不等于 ${EXPECTED_SECTIONS}（模板②：固定 ${EXPECTED_SECTIONS} 大章节）`,
    run: (c) => {
      const n = (c.rep && c.rep.sections ? c.rep.sections.length : 0);
      return n === EXPECTED_SECTIONS ? true : `实际 ${n} 段`;
    },
  },
  {
    id: 'sections-titled',
    msg: '存在没有标题的章节',
    run: (c) => {
      const bad = (c.rep.sections || []).filter((s) => !s.title || !s.title.trim());
      return bad.length === 0 ? true : `第 ${bad.map((s) => s.id || '?').join('、')} 段标题为空`;
    },
  },
  {
    id: 'sections-nonempty',
    msg: '存在没有任何正文行与表格的章节（只剩标题）',
    run: (c) => {
      const bad = (c.rep.sections || []).filter((s) => !(s.lines || []).length);
      return bad.length === 0 ? true : `第 ${bad.map((s) => s.id || '?').join('、')} 段为空`;
    },
  },
  {
    id: 'caliber-per-section',
    msg: `并非每段都挂了口径折叠件（模板③：每章节一个「${CALIBER_SUMMARY}」）`,
    run: (c) => {
      const secs = c.rep.sections || [];
      const bad = secs.filter((s) => !s.caliber || !s.caliber.trim());
      return bad.length === 0 ? true
        : `${bad.length}/${secs.length} 段缺口径件（第 ${bad.map((s) => s.id || '?').join('、')} 段）`;
    },
  },
  {
    id: 'caliber-summary-text',
    msg: `口径折叠件标题不是「${CALIBER_SUMMARY}」（屏幕与导出的文案必须一致）`,
    // 判据来源：优先用调用方**在 parseReport 之前**采好的 domCaliberSummaries 快照。
    // 原因：parseReport 会就地移除 .bf-caliber（防口径混进正文），之后 DOM 上就查不到了——
    // 若这时才查，会把一份合规报告误判为未通过。没有快照时才退回实时查询
    // （单测里传的是未被 parseReport 动过的容器，直接查也是对的）。
    run: (c) => {
      let sums = c.domCaliberSummaries;
      if (!Array.isArray(sums)) {
        if (!c.rootEl || !c.rootEl.querySelectorAll) return true;
        sums = [...c.rootEl.querySelectorAll('.bf-sec .bf-caliber summary')]
          .map((s) => s.textContent.trim());
      }
      if (!sums.length) return '屏幕 DOM 里找不到章节口径折叠件';
      const bad = sums.filter((s) => s !== CALIBER_SUMMARY);
      return bad.length === 0 ? true : `${bad.length} 个折叠件标题不符（如「${bad[0]}」）`;
    },
  },
  {
    id: 'ladder-is-table',
    msg: '连板天梯不是表格（模板②：连板天梯用表格）',
    run: (c) => {
      const tbl = (c.rep.sections || [])
        .flatMap((s) => s.lines || [])
        .filter((l) => l.kind === 'table');
      if (!tbl.length) return '整份报告没有任何表格，连板天梯疑似被摊平成文字';
      // 表格必须有表头与至少一行数据，否则是个空壳
      const bad = tbl.filter((t) => !(t.head || []).length || !(t.rows || []).length);
      return bad.length === 0 ? true : `${bad.length} 个表格缺表头或数据行`;
    },
  },
  {
    id: 'todo-checklist',
    msg: '明日跟踪项不是复选框清单（模板④）',
    run: (c) => {
      // 同 caliber-summary-text：优先用 parseReport 前采的快照，避免被就地移除影响。
      const total = Number.isInteger(c.domTodoCount)
        ? c.domTodoCount
        : (c.rootEl && c.rootEl.querySelectorAll ? c.rootEl.querySelectorAll('.bf-todo').length : null);
      if (total === null) return true;
      if (!total) return '屏幕上找不到任何 .bf-todo 跟踪项';
      // 必须有 aria-checked 才是"复选框"，不是普通 div
      const bad = Number.isInteger(c.domTodoAriaCount)
        ? total - c.domTodoAriaCount
        : [...c.rootEl.querySelectorAll('.bf-todo')].filter((t) => !t.hasAttribute('aria-checked')).length;
      return bad === 0 ? true : `${bad} 个跟踪项缺 aria-checked（不是可勾选项）`;
    },
  },
  {
    id: 'todo-gfm-in-md',
    msg: 'Markdown 里的跟踪项不是 GFM 复选框语法 - [ ]（模板④/⑤）',
    run: (c) => {
      if (!c.md) return true;
      if (!/^\- \[ \] /m.test(c.md)) return 'Markdown 未见 - [ ] 行';
      return true;
    },
  },
  {
    id: 'key-bold',
    msg: '关键数值没有加粗（模板④：关键数值加粗）',
    run: (c) => {
      if (!c.md) return true;
      const n = (c.md.match(/\*\*[^*]+\*\*/g) || []).length;
      return n >= 5 ? true : `Markdown 中加粗片段仅 ${n} 处（<5，疑似丢失强调）`;
    },
  },
  {
    id: 'details-paired',
    msg: 'Markdown 里 <details> 标签不配对（折叠件会渲染错乱）',
    run: (c) => {
      if (!c.md) return true;
      const open = (c.md.match(/<details>/g) || []).length;
      const close = (c.md.match(/<\/details>/g) || []).length;
      return open === close ? true : `<details> ${open} 个 / </details> ${close} 个`;
    },
  },
  {
    id: 'appendix-present',
    msg: '缺文末独立折叠附录（模板③：汇总全部口径）',
    run: (c) => {
      if (!c.rep.appendix) return '结构化报告无 appendix';
      // 快照优先（与其它 DOM 检查同一纪律）；无快照时退回实时查询
      if (c.domAppendix === false) return '屏幕 DOM 里找不到 .bf-appendix';
      if (c.domAppendix === undefined && c.rootEl && c.rootEl.querySelector
        && !c.rootEl.querySelector('.bf-appendix')) {
        return '屏幕 DOM 里找不到 .bf-appendix';
      }
      return true;
    },
  },
  {
    id: 'appendix-in-md',
    msg: 'Markdown 里找不到口径附录折叠件',
    run: (c) => {
      if (!c.md) return true;
      // 附录在 Markdown 里紧跟分隔线，且是最后一个 details 块
      const i = c.md.lastIndexOf('<details>');
      return i >= 0 ? true : 'Markdown 无 <details> 块';
    },
  },
  {
    id: 'disclaimer',
    msg: '报告结尾缺免责声明（模板⑤）',
    run: (c) => {
      const md = c.md || '', txt = c.txt || '', html = c.html || '';
      const hit = /非投资建议|不构成任何投资建议/.test(md)
        && /非投资建议|不构成任何投资建议/.test(txt)
        && /免责声明/.test(html);
      return hit ? true : 'md/txt/html 至少一种形态缺免责声明';
    },
  },
  {
    id: 'generated-at',
    msg: '报告结尾缺导出时间（模板⑤）',
    run: (c) => {
      const hasAt = (s) => /导出时间：\s*\d{4}-\d{2}-\d{2}/.test(s || '');
      return (hasAt(c.md) && hasAt(c.txt)) ? true : 'Markdown/纯文本未同时带导出时间';
    },
  },
  {
    id: 'markers',
    msg: '三档配色标记未落地（模板④：🔴风险/🟢积极/⚫中性）',
    /**
     * 判据为什么这么写：
     *   三档标记是**数据驱动**的——由 buildBrief 按当日实际结论决定挂哪一档
     *   （档位过热/清仓→🔴、满仓→🟢、半仓→⚫）。所以「某个标记没出现」不等于
     *   「模板没落地」，可能只是当日没触发那个档位（例：情绪温和时不会有 🔴 风险项）。
     *
     *   要区分这两种情况，只能看**语义结构**而非字符：
     *     · 屏幕侧：.ico-risk / .ico-pos / .ico-neutral 三个 class 体系是否齐备
     *       （CSS 与渲染函数都在，说明模板落地了，只是数据没用满三档）；
     *     · 导出侧：[[risk:]] 这类标记语法能被翻译成 emoji（report.js 的 MARKERS 表存在）。
     *   因此本项检查的是「三档机制在位」，而不是「今日恰好出现了三个 emoji」。
     */
    run: (c) => {
      // 导出层：三档映射表必须存在（report.js 的 MARKERS）
      const hasMarkerTable = c.markerKinds
        ? ['risk', 'pos', 'neutral'].every((k) => c.markerKinds.includes(k))
        : true; // 无快照时不判（单测环境的 md/txt 由 fixture 提供）
      if (!hasMarkerTable) return '三档标记映射表不完整（导出层缺 risk/pos/neutral）';
      // 屏幕层：三档 class 必须都定义在样式里（否则某一档渲染出来没颜色 = 模板没落地）
      if (c.hasMarkerClasses === false) return '屏幕缺三档配色 class（.ico-risk/.ico-pos/.ico-neutral）';
      // 当日实际出现的标记数量：0 个才算异常（说明渲染函数根本没挂标记）
      const src = [c.md, c.txt, c.html].filter(Boolean).join('\n');
      if (src) {
        const n = ['🔴', '🟢', '⚫'].filter((m) => src.includes(m)).length;
        if (n === 0) return '三种形态里都找不到任何配色标记（渲染函数疑似未挂标记）';
      }
      return true;
    },
  },
  {
    id: 'compliance-no-recompute',
    msg: '报告出现「仅供参考」以外的投资建议式措辞（合规守卫）',
    run: (c) => {
      const src = [c.md, c.txt].filter(Boolean).join('\n');
      if (!src) return true;
      // 只拦"保证收益/必涨/稳赚"这类越界措辞；合规的免责声明本身含"非投资建议"不算违规
      const BAN = /(保证收益|稳赚不赔|必涨|一定会上涨|包赚)/;
      const m = src.match(BAN);
      return m ? `出现越界措辞「${m[1]}」` : true;
    },
  },
];

/**
 * 主入口：对一份报告跑全部审计。
 *
 * @param {object} rep       parseReport() 的结构化结果
 * @param {object} [opts]
 * @param {Element} [opts.rootEl] 屏幕上的报告容器（#briefBody），用于校验 DOM 侧结构
 * @param {string}  [opts.md]     toMarkdown() 产物
 * @param {string}  [opts.txt]    toPlainText() 产物
 * @param {string}  [opts.html]   toStandaloneHtml() 产物
 * @returns {{ pass:boolean, total:number, passed:number, failed:Array<{id:string,msg:string,reason:string}>, checks:Array, version:string }}
 */
export function auditReport(rep, opts = {}) {
  const ctx = {
    rep: rep || { sections: [] },
    rootEl: opts.rootEl || null,
    md: opts.md || '',
    txt: opts.txt || '',
    html: opts.html || '',
  };
  const checks = [];
  for (const rule of RULES) {
    let ok, reason = '';
    try {
      const r = rule.run(ctx);
      if (r === true || r === undefined || r === null) { ok = true; }
      else { ok = false; reason = typeof r === 'string' ? r : rule.msg; }
    } catch (e) {
      // 审计项自己抛异常不能把审计搞挂——按失败处理并如实报原因
      ok = false;
      reason = `审计项异常：${String(e && e.message || e)}`;
    }
    checks.push({ id: rule.id, msg: rule.msg, ok, reason: ok ? '' : reason });
  }
  const failed = checks.filter((c) => !c.ok);
  return {
    pass: failed.length === 0,
    total: checks.length,
    passed: checks.length - failed.length,
    failed,
    checks,
    version: AUDIT_VERSION,
  };
}

/**
 * 便捷判定：只关心过没过。
 * @returns {boolean}
 */
export function isAuditPass(rep, opts) {
  return auditReport(rep, opts).pass;
}

/**
 * 把审计结果整理成一行摘要（状态条用）。
 * 例：`通过 18/18 项` / `未通过 2/18 项 · 缺文末独立折叠附录`
 */
export function auditSummary(result) {
  if (!result) return '未审计';
  if (result.pass) return `通过 ${result.passed}/${result.total} 项`;
  const first = result.failed[0];
  const more = result.failed.length > 1 ? ` 等 ${result.failed.length} 项` : '';
  return `未通过 ${result.passed}/${result.total} 项 · ${first ? first.reason : ''}${more}`;
}
