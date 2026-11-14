var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node-stub:node:fs
var node_fs_exports = {};
__export(node_fs_exports, {
  default: () => node_fs_default,
  dirname: () => dirname,
  existsSync: () => existsSync,
  fileURLToPath: () => fileURLToPath,
  join: () => join,
  mkdirSync: () => mkdirSync,
  readFileSync: () => readFileSync,
  writeFileSync: () => writeFileSync
});
var node_fs_default, readFileSync, existsSync, mkdirSync, writeFileSync, join, dirname, fileURLToPath;
var init_node_fs = __esm({
  "node-stub:node:fs"() {
    node_fs_default = {};
    readFileSync = () => {
      throw new Error("node-only");
    };
    existsSync = () => false;
    mkdirSync = () => {
    };
    writeFileSync = () => {
    };
    join = (...a) => a.join("/");
    dirname = (p) => String(p).split("/").slice(0, -1).join("/");
    fileURLToPath = (p) => String(p).replace("file://", "");
  }
});

// node-stub:node:url
var node_url_exports = {};
__export(node_url_exports, {
  default: () => node_url_default,
  dirname: () => dirname2,
  existsSync: () => existsSync2,
  fileURLToPath: () => fileURLToPath2,
  join: () => join2,
  mkdirSync: () => mkdirSync2,
  readFileSync: () => readFileSync2,
  writeFileSync: () => writeFileSync2
});
var node_url_default, readFileSync2, existsSync2, mkdirSync2, writeFileSync2, join2, dirname2, fileURLToPath2;
var init_node_url = __esm({
  "node-stub:node:url"() {
    node_url_default = {};
    readFileSync2 = () => {
      throw new Error("node-only");
    };
    existsSync2 = () => false;
    mkdirSync2 = () => {
    };
    writeFileSync2 = () => {
    };
    join2 = (...a) => a.join("/");
    dirname2 = (p) => String(p).split("/").slice(0, -1).join("/");
    fileURLToPath2 = (p) => String(p).replace("file://", "");
  }
});

// node-stub:node:path
var node_path_exports = {};
__export(node_path_exports, {
  default: () => node_path_default,
  dirname: () => dirname3,
  existsSync: () => existsSync3,
  fileURLToPath: () => fileURLToPath3,
  join: () => join3,
  mkdirSync: () => mkdirSync3,
  readFileSync: () => readFileSync3,
  writeFileSync: () => writeFileSync3
});
var node_path_default, readFileSync3, existsSync3, mkdirSync3, writeFileSync3, join3, dirname3, fileURLToPath3;
var init_node_path = __esm({
  "node-stub:node:path"() {
    node_path_default = {};
    readFileSync3 = () => {
      throw new Error("node-only");
    };
    existsSync3 = () => false;
    mkdirSync3 = () => {
    };
    writeFileSync3 = () => {
    };
    join3 = (...a) => a.join("/");
    dirname3 = (p) => String(p).split("/").slice(0, -1).join("/");
    fileURLToPath3 = (p) => String(p).replace("file://", "");
  }
});

// config-json:./config.json
var config_exports = {};
__export(config_exports, {
  default: () => config_default2
});
var config_default2;
var init_config = __esm({
  async "config-json:./config.json"() {
    config_default2 = window.ASENT_CONFIG || await fetch(new URL("config.json", document.baseURI)).then((r) => r.json());
  }
});

// src/report.js
var report_exports = {};
__export(report_exports, {
  CALIBER_SUMMARY: () => CALIBER_SUMMARY,
  CALIBER_SUMMARY_DOC: () => CALIBER_SUMMARY_DOC,
  DOC_SPEC: () => DOC_SPEC,
  MARKERS: () => MARKERS,
  REPORT_ORG: () => REPORT_ORG,
  REPORT_TITLE: () => REPORT_TITLE,
  REPORT_VERSION: () => REPORT_VERSION,
  STANDALONE_CSS: () => STANDALONE_CSS,
  briefSerial: () => briefSerial,
  cnBracket: () => cnBracket,
  docDate: () => docDate,
  foldTitle: () => foldTitle,
  h1Mark: () => h1Mark,
  h2Mark: () => h2Mark,
  h3Mark: () => h3Mark,
  h4Mark: () => h4Mark,
  parseReport: () => parseReport,
  reportFileName: () => reportFileName,
  sectionNo: () => sectionNo,
  sectionTitle: () => sectionTitle,
  toMarkdown: () => toMarkdown,
  toPlainText: () => toPlainText,
  toStandaloneHtml: () => toStandaloneHtml
});
var REPORT_VERSION = "report-v3";
var REPORT_TITLE = "A\u80A1\u5E02\u573A\u60C5\u7EEA\u7814\u5224\u7B80\u62A5";
var REPORT_ORG = "A\u80A1\u60C5\u7EEA\u7CFB\u7EDF \xB7 PRO";
var DOC_SPEC = {
  version: "gb-brief-v1",
  /** 整体：A4 纸与页边距（上 37 / 下 35 / 左 28 / 右 26，单位 mm） */
  page: { size: "A4", w: "210mm", h: "297mm", top: "37mm", bottom: "35mm", left: "28mm", right: "26mm" },
  /** 字号阶梯：与公文体例一一对应（pt） */
  font: { h1: "22pt", abstract: "16pt", body: "16pt", table: "16pt", page: "14pt", note: "14pt" },
  /** 字体族 */
  family: {
    xbs: '"\u65B9\u6B63\u5C0F\u6807\u5B8B\u7B80\u4F53", "STZhongsong", "\u534E\u6587\u4E2D\u5B8B", "SimSun", serif',
    hei: '"SimHei", "Microsoft YaHei", sans-serif',
    kai: '"KaiTi", "Kaiti SC", "STKaiti", serif',
    fs: '"FangSong", "FangSong_GB2312", "STFangsong", "SimSun", serif'
  },
  /** 标题最多排版成几行（超过就压成一行，梯形/菱形排布的行数是有限的） */
  titleMaxLines: 4,
  /** 正文「左空 2 字符」= 首行缩进 2 字（回行顶格是缩进的天然结果，无需另设） */
  indentChars: 2,
  /** 落款日期「右空四字」 */
  dateRightChars: 4,
  /** 层次序号体系：一、（黑体）→（一）（楷体）→ 1.（仿宋）→（1）（仿宋） */
  numbering: {
    level1: "cn",
    // 中文数字 + 顿号
    level2: "cnPar",
    // 中文数字 + 全角括号
    level3: "arabic",
    // 阿拉伯数字 + 半角点
    level4: "arabicPar",
    family: ["hei", "kai", "fs", "fs"]
  },
  /** 公告年份编号用六角括号（U+3014 / U+3015），不是方括号 —— 公文硬规定 */
  bracket: ["\u3014", "\u3015"],
  /** 页码：4 号半角阿拉伯数字，居版心下边缘之下、版心之外，单页右放、双页左放 */
  pageNo: { family: "fs", single: "right", double: "left", showTotal: false }
};
var cnBracket = (s) => DOC_SPEC.bracket[0] + String(s == null ? "" : s) + DOC_SPEC.bracket[1];
function docDate(text) {
  const m = String(text == null ? "" : text).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return String(text == null ? "" : text);
  return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
}
var CN_NUM = ["\u96F6", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D", "\u5341"];
var cnNum = (n) => n <= 10 ? CN_NUM[n] : String(n);
function h1Mark(index1) {
  return `${cnNum(index1)}\u3001`;
}
var h2Mark = (index2) => `\uFF08${cnNum(index2)}\uFF09`;
var h3Mark = (index3) => `${index3}.`;
var h4Mark = (index4) => `\uFF08${index4}\uFF09`;
function sectionNo(level, index) {
  if (level === "cn" || level === "cnPar") {
    return level === "cn" ? h1Mark(index) : h2Mark(index);
  }
  if (level === "arabic" || level === "arabicPar") {
    return level === "arabic" ? h3Mark(index) : h4Mark(index);
  }
  return h1Mark(index);
}
var stripOldNo = (s) => String(s || "").replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*/, "");
function foldTitle(text, max = DOC_SPEC.titleMaxLines, lineLen = 18) {
  const chars = [...stripOldNo(String(text || ""))];
  if (chars.length <= lineLen) return [chars.join("")];
  const lines = [];
  let cur = [];
  for (let i = 0; i < chars.length; i++) {
    cur.push(chars[i]);
    const isBreak = "\u3001\uFF0C\uFF1B\uFF1A".includes(chars[i]) || chars[i] === "\xB7" && /[\u4e00-\u9fa5]/.test(chars[i + 1] || "") || chars[i] === "\uFF09" && cur.length >= 8;
    if (isBreak && chars.length - i - 1 > 2 && lines.length < max - 1) {
      lines.push(cur.join(""));
      cur = [];
    }
  }
  if (cur.length) lines.push(cur.join(""));
  if (lines.length < 2) {
    const per = Math.ceil(chars.length / Math.min(max, Math.ceil(chars.length / lineLen)));
    const eq = [];
    for (let i = 0; i < chars.length; i += per) eq.push(chars.slice(i, i + per).join(""));
    return eq;
  }
  return lines;
}
function sectionTitle(secTitle) {
  return stripOldNo(String(secTitle || "")).replace(/^[一二三四五六七八九十]+、\s*/, "");
}
var CALIBER_SUMMARY = "\u{1F50D} \u70B9\u51FB\u5C55\u5F00\u67E5\u770B\u53E3\u5F84";
var CALIBER_SUMMARY_DOC = "\u{1F4CE} \u53E3\u5F84\u8BF4\u660E\uFF08\u9644\uFF09";
var MARKERS = { risk: "\u{1F534}", pos: "\u{1F7E2}", neutral: "\u26AB" };
function parseReport(rootEl) {
  if (!rootEl) return { meta: null, abstract: null, sections: [], appendix: null, foot: null };
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const tidyWarn = (s) => s.replace(/(?:⚠\s*){2,}/g, "\u26A0 ").replace(/([^\s（【「『])⚠/g, "$1 \u26A0").replace(/⚠([^\s，。；：、）】」』！？])/g, "\u26A0 $1").replace(/([（【「『])\s+/g, "$1").replace(/\s{2,}/g, " ").trim();
  const inline = (node) => {
    let out2 = "";
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        out2 += n.nodeValue;
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === "br") {
        out2 += " ";
        continue;
      }
      const inner = inline(n);
      const cls2 = n.className || "";
      if (tag === "b" || tag === "strong") out2 += `**${clean(inner)}**`;
      else if (/\bbf-up\b/.test(cls2)) out2 += `\u3010\u6DA8\u3011${clean(inner)}`;
      else if (/\bbf-dn\b/.test(cls2)) out2 += `\u3010\u8DCC\u3011${clean(inner)}`;
      else if (/\bbf-warn\b/.test(cls2)) out2 += `\u26A0 ${clean(inner)}`;
      else if (/\bmuted\b/.test(cls2)) out2 += clean(inner);
      else out2 += inner;
    }
    return out2;
  };
  const metaEl = rootEl.querySelector(".bf-meta");
  const meta = metaEl ? clean(inline(metaEl).replace(/\*\*/g, "")) : null;
  const absEl = rootEl.querySelector(".bf-abstract");
  const abstract = absEl ? clean(inline(absEl.querySelector(".bf-ab-text") || absEl).replace(/\*\*/g, "")) : null;
  const extractLines = (bodyEl) => {
    const lines = [];
    if (!bodyEl) return lines;
    for (const child of bodyEl.children) {
      const cls2 = child.className || "";
      const tblEl = /\bbf-table\b/.test(cls2) ? child : /\bbf-li\b/.test(cls2) && child.querySelectorAll(".bf-table").length === 1 ? child.querySelector(".bf-table") : null;
      if (tblEl) {
        const head = [...tblEl.querySelectorAll("thead th, thead td")].map((th) => clean(th.textContent));
        const rows = [...tblEl.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => tidyWarn(clean(inline(td)))));
        lines.push({ kind: "table", head, rows, caption: clean(tblEl.getAttribute("data-caption") || "") });
      } else if (/\bbf-todo\b/.test(cls2)) {
        lines.push({ kind: "todo", text: tidyWarn(clean(inline(child))) });
      } else if (/\bbf-li\b/.test(cls2)) {
        lines.push({ kind: "li", text: tidyWarn(clean(inline(child))) });
      } else if (/\bbf-h2\b/.test(cls2)) {
        const inner = child.querySelector(".bf-sec-t") || child.querySelector(".bf-h-t");
        lines.push({ kind: "sub", text: clean((inner || child).textContent) });
      }
    }
    return lines;
  };
  const sections = [];
  for (const sec of rootEl.querySelectorAll(".bf-sec")) {
    const h = sec.querySelector(".bf-h");
    const inner = h && (h.querySelector(".bf-sec-t") || h.querySelector(".bf-h-t"));
    const title = h ? clean((inner || h).textContent) : "";
    const calEl = sec.querySelector(".bf-caliber");
    const calBody = calEl ? calEl.querySelector(".bf-cal-body") : null;
    const caliber = calBody ? tidyWarn(clean(inline(calBody))) : null;
    if (calEl) calEl.remove();
    const lines = extractLines(sec.querySelector(".bf-body"));
    sections.push({ id: sec.id || "", title, lines, caliber });
  }
  const appxEl = rootEl.querySelector(".bf-appendix");
  const appxBody = appxEl ? appxEl.querySelector(".bf-cal-body") : null;
  const appendix = appxEl ? {
    title: clean(appxEl.querySelector("summary")?.textContent || "\u53E3\u5F84\u9644\u5F55"),
    body: appxBody ? clean(inline(appxBody)) : clean(inline(appxEl))
  } : null;
  const footEl = rootEl.querySelector(".bf-foot:not(.bf-appendix)");
  const foot = footEl ? clean(inline(footEl).replace(/\*\*/g, "")) : null;
  return { meta, abstract, sections, appendix, foot };
}
var stripMark = (s, keepBold = false) => String(s || "").replace(/【涨】\s*/g, "\u2191").replace(/【跌】\s*/g, "\u2193").replace(/\[\[(risk|pos|neutral):([^\]]*)\]\]/g, (_, k, t) => MARKERS[k] + t).replace(/\*\*([^*]+)\*\*/g, keepBold ? "**$1**" : "$1");
function toPlainText(rep, opts = {}) {
  const { dataDate = "", generatedAt = "", issueNo = 1 } = opts;
  const L = [];
  L.push(REPORT_TITLE);
  const serial = briefSerial(dataDate, issueNo);
  if (serial) L.push(serial);
  if (dataDate) L.push(`\u6570\u636E\u65E5\u671F\uFF1A${docDate(dataDate)}`);
  L.push("");
  if (rep.abstract) {
    L.push(`\u3010\u6458\u8981\u3011${stripMark(rep.abstract)}`);
    L.push("");
  }
  if (rep.meta) {
    L.push(rep.meta);
    L.push("");
  }
  rep.sections.forEach((sec, i) => {
    L.push(`${sectionNo("cn", i + 1)}${sectionTitle(sec.title)}`);
    let subNo = 0;
    for (const ln of sec.lines) {
      if (ln.kind === "sub") {
        subNo += 1;
        L.push(`  ${sectionNo("cnPar", subNo)}${sectionTitle(ln.text)}`);
      } else if (ln.kind === "todo") L.push(`  [ ] ${stripMark(ln.text)}`);
      else if (ln.kind === "table") {
        if (ln.caption) L.push(`  ${ln.caption}`);
        if (ln.head.length) L.push("  " + ln.head.join(" \uFF5C "));
        for (const r of ln.rows) L.push("  " + r.map((c) => stripMark(c)).join(" \uFF5C "));
      } else L.push(`  \xB7 ${stripMark(ln.text)}`);
    }
    if (sec.caliber) L.push(`  [\u53E3\u5F84] ${stripMark(sec.caliber)}`);
    L.push("");
  });
  if (rep.appendix) {
    L.push(`\u3010${stripMark(rep.appendix.title)}\u3011`);
    L.push(`[\u53E3\u5F84] ${stripMark(rep.appendix.body)}`);
    L.push("");
  }
  if (rep.foot) {
    L.push("\u53E3\u5F84\u5907\u6CE8");
    L.push(stripMark(rep.foot));
    L.push("");
  }
  L.push(`\u672C\u7B80\u62A5\u7531 ${REPORT_ORG} \u89C4\u5219\u5F15\u64CE\u81EA\u52A8\u751F\u6210\uFF0C\u6570\u636E\u6765\u6E90\u4E8E\u516C\u5F00\u884C\u60C5\u63A5\u53E3\uFF0C\u4EC5\u4F9B\u7814\u7A76\u53C2\u8003\uFF0C\u975E\u6295\u8D44\u5EFA\u8BAE\u3002`);
  if (dataDate) L.push(docDate(dataDate));
  if (generatedAt) L.push(`\u5BFC\u51FA\u65F6\u95F4\uFF1A${generatedAt}`);
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
var mdCell = (s) => stripMark(s, true).replace(/\|/g, "\\|").replace(/\n+/g, " ");
function toMarkdown(rep, opts = {}) {
  const { dataDate = "", generatedAt = "", issueNo = 1 } = opts;
  const L = [];
  L.push(`# ${REPORT_TITLE}`);
  L.push("");
  const serial = briefSerial(dataDate, issueNo);
  if (serial) {
    L.push(`<p align="right">${serial}</p>`);
    L.push("");
  }
  if (dataDate) L.push(`**\u6570\u636E\u65E5\u671F**\uFF1A${docDate(dataDate)}\u3000\u3000**\u751F\u6210\u65B9\u5F0F**\uFF1A\u89C4\u5219\u5F15\u64CE\u81EA\u52A8\u751F\u6210`);
  L.push("");
  if (rep.abstract) {
    L.push(`> **\u3010\u6458\u8981\u3011** ${stripMark(rep.abstract, true)}`);
    L.push("");
  }
  if (rep.meta) {
    L.push(`> ${rep.meta.replace(/\|/g, "\\|")}`);
    L.push("");
  }
  rep.sections.forEach((sec, i) => {
    L.push(`## ${sectionNo("cn", i + 1)}${sectionTitle(sec.title)}`);
    L.push("");
    let subNo = 0;
    for (const ln of sec.lines) {
      if (ln.kind === "sub") {
        subNo += 1;
        L.push(`### ${sectionNo("cnPar", subNo)}${sectionTitle(ln.text)}`);
        L.push("");
      } else if (ln.kind === "todo") {
        L.push(`- [ ] ${stripMark(ln.text, true)}`);
      } else if (ln.kind === "table") {
        if (ln.caption) {
          L.push(`**${mdCell(ln.caption)}**`);
          L.push("");
        }
        if (ln.head.length) {
          L.push(`| ${ln.head.map(mdCell).join(" | ")} |`);
          L.push(`| ${ln.head.map(() => "---").join(" | ")} |`);
        }
        for (const r of ln.rows) L.push(`| ${r.map(mdCell).join(" | ")} |`);
        L.push("");
      } else L.push(`- ${stripMark(ln.text, true)}`);
    }
    if (sec.caliber) {
      L.push("");
      L.push(`<details>`);
      L.push(`<summary>${CALIBER_SUMMARY_DOC}</summary>`);
      L.push("");
      L.push(stripMark(sec.caliber, true));
      L.push("");
      L.push(`</details>`);
    }
    L.push("");
  });
  if (rep.appendix) {
    L.push("---");
    L.push("");
    L.push("<details>");
    L.push(`<summary>${stripMark(rep.appendix.title, true)}</summary>`);
    L.push("");
    L.push(stripMark(rep.appendix.body, true));
    L.push("");
    L.push("</details>");
    L.push("");
  }
  if (rep.foot) {
    L.push("---");
    L.push("");
    L.push("<details>");
    L.push(`<summary>${CALIBER_SUMMARY_DOC}\uFF08\u5907\u6CE8\uFF09</summary>`);
    L.push("");
    L.push(rep.foot);
    L.push("");
    L.push("</details>");
    L.push("");
  }
  L.push("---");
  L.push("");
  L.push(`> \u672C\u7B80\u62A5\u7531 ${REPORT_ORG} \u89C4\u5219\u5F15\u64CE\u81EA\u52A8\u751F\u6210\uFF0C\u6570\u636E\u6765\u6E90\u4E8E\u516C\u5F00\u884C\u60C5\u63A5\u53E3\uFF0C\u4EC5\u4F9B\u7814\u7A76\u53C2\u8003\uFF0C**\u975E\u6295\u8D44\u5EFA\u8BAE**\u3002`);
  if (dataDate) L.push(`<p align="right">${docDate(dataDate)}</p>`);
  if (generatedAt) L.push(`> \u5BFC\u51FA\u65F6\u95F4\uFF1A${generatedAt}`);
  L.push("");
  return L.join("\n");
}
var escHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function inlineToHtml(raw) {
  let s = escHtml(raw);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(
    /\[\[(risk|pos|neutral):([^\]]*)\]\]/g,
    (_, k, t) => `<span class="ico ico-${k}">${MARKERS[k]} ${t}</span>`
  );
  s = s.replace(/【涨】\s*([+-]?[\d,.]+%?)/g, '<span class="chg"><i>\u25B2</i> $1</span>');
  s = s.replace(/【跌】\s*([+-]?[\d,.]+%?)/g, '<span class="chg chg-dn"><i>\u25BC</i> $1</span>');
  s = s.replace(/(?:⚠\s*)+([^。；;]*)(?=[。；;]|$)/g, '<span class="warn">\u26A0 $1</span>');
  return s;
}
function briefSerial(dataDate, issueNo) {
  const y = (String(dataDate || "").match(/\d{4}/) || [])[0] || "";
  if (!y) return "";
  const n = Number.isFinite(+issueNo) && +issueNo > 0 ? +issueNo : 1;
  return `${cnBracket(y)}\u7B2C ${n} \u53F7`;
}
function toStandaloneHtml(rep, opts = {}) {
  const { dataDate = "", generatedAt = "", url = "", issueNo = 1 } = opts;
  const css = STANDALONE_CSS;
  const body = [];
  body.push(`<header class="doc-head">`);
  body.push(`<p class="serial">${escHtml(briefSerial(dataDate, issueNo))}</p>`);
  body.push(`<p class="masthead">${escHtml(REPORT_TITLE)}</p>`);
  body.push(`</header>`);
  const titleLines = foldTitle(REPORT_ORG);
  body.push(`<h1 class="doc-title" data-line-count="${titleLines.length}">` + titleLines.map((l) => `<span class="t-line">${escHtml(l)}</span>`).join("") + `</h1>`);
  if (rep.abstract) {
    body.push(`<p class="doc-abstract"><span class="abs-lead">\u3014\u6458\u8981\u3015</span>${inlineToHtml(rep.abstract)}</p>`);
  }
  if (rep.meta) body.push(`<p class="doc-meta">${escHtml(rep.meta)}</p>`);
  body.push(`<main class="doc-body">`);
  rep.sections.forEach((sec, i) => {
    body.push(`<section class="sec">`);
    body.push(`<h2 class="h1">${escHtml(sectionNo("cn", i + 1))}${escHtml(sectionTitle(sec.title))}</h2>`);
    const bullets = [];
    const todos = [];
    const flush = () => {
      if (bullets.length) {
        body.push(`<ul>${bullets.join("")}</ul>`);
        bullets.length = 0;
      }
      if (todos.length) {
        body.push(`<ul class="todo">${todos.join("")}</ul>`);
        todos.length = 0;
      }
    };
    let subNo = 0;
    for (const ln of sec.lines) {
      if (ln.kind === "sub") {
        flush();
        subNo += 1;
        body.push(`<h3 class="h2">${escHtml(sectionNo("cnPar", subNo))}${escHtml(sectionTitle(ln.text))}</h3>`);
      } else if (ln.kind === "todo") {
        if (bullets.length) {
          body.push(`<ul>${bullets.join("")}</ul>`);
          bullets.length = 0;
        }
        todos.push(`<li><span class="cb">\u2610</span>${inlineToHtml(ln.text)}</li>`);
      } else if (ln.kind === "table") {
        flush();
        if (ln.caption) body.push(`<p class="tbl-cap">${escHtml(ln.caption)}</p>`);
        const th = ln.head.map((c) => `<th>${escHtml(c)}</th>`).join("");
        const trs = ln.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineToHtml(c)}</td>`).join("")}</tr>`).join("");
        body.push(`<table class="rep-tbl">${th ? `<thead><tr>${th}</tr></thead>` : ""}<tbody>${trs}</tbody></table>`);
      } else bullets.push(`<li>${inlineToHtml(ln.text)}</li>`);
    }
    flush();
    if (sec.caliber) {
      body.push(`<details class="caliber"><summary>${escHtml(CALIBER_SUMMARY_DOC)}</summary>`);
      body.push(`<p>${inlineToHtml(sec.caliber)}</p>`);
      body.push(`</details>`);
    }
    body.push(`</section>`);
  });
  body.push(`</main>`);
  if (rep.appendix) {
    body.push(`<details class="caliber appendix" open><summary>${escHtml(rep.appendix.title)}</summary>`);
    body.push(`<p>${escHtml(rep.appendix.body)}</p>`);
    body.push(`</details>`);
  }
  if (rep.foot) {
    body.push(`<details class="caliber appendix"><summary>${escHtml(CALIBER_SUMMARY_DOC)}\uFF08\u5907\u6CE8\uFF09</summary>`);
    body.push(`<p>${escHtml(rep.foot)}</p>`);
    body.push(`</details>`);
  }
  body.push(`<p class="sign-date">${escHtml(docDate(dataDate))}</p>`);
  body.push(`<footer class="doc-foot">`);
  body.push(`<p class="disclaimer"><b>\u514D\u8D23\u58F0\u660E</b>\uFF1A\u672C\u7B80\u62A5\u7531 ${escHtml(REPORT_ORG)} \u89C4\u5219\u5F15\u64CE\u6839\u636E\u516C\u5F00\u884C\u60C5\u6570\u636E\u81EA\u52A8\u751F\u6210\uFF0C\u4EC5\u4F9B\u7814\u7A76\u53C2\u8003\uFF0C<b>\u4E0D\u6784\u6210\u4EFB\u4F55\u6295\u8D44\u5EFA\u8BAE</b>\u3002\u6570\u636E\u53EF\u80FD\u5B58\u5728\u5EF6\u8FDF\u6216\u8BEF\u5DEE\uFF0C\u636E\u6B64\u64CD\u4F5C\u98CE\u9669\u81EA\u62C5\u3002</p>`);
  if (url) body.push(`<p class="src">\u6570\u636E\u6765\u6E90\uFF1A${escHtml(url)}</p>`);
  if (generatedAt) body.push(`<p class="src">\u5BFC\u51FA\u65F6\u95F4\uFF1A${escHtml(generatedAt)}</p>`);
  body.push(`</footer>`);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(REPORT_TITLE)}${dataDate ? " \xB7 " + escHtml(dataDate) : ""}</title>
<style>${css}</style>
</head>
<body>
<article class="doc">
${body.join("\n")}
</article>
</body>
</html>
`;
}
var STANDALONE_CSS = `
@page { size: ${DOC_SPEC.page.size}; margin: ${DOC_SPEC.page.top} ${DOC_SPEC.page.right} ${DOC_SPEC.page.bottom} ${DOC_SPEC.page.left}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { color: #000; font-family: ${DOC_SPEC.family.fs}; font-size: ${DOC_SPEC.font.body}; line-height: 1.7; }
/* \u7248\u5FC3\u5BBD\u5EA6 = A4\u5BBD 210 \u2212 \u5DE6 28 \u2212 \u53F3 26 = 156mm\uFF0C\u4E0E @page \u9875\u8FB9\u8DDD\u4E25\u683C\u4E00\u81F4 */
.doc { width: 156mm; margin: 0 auto; padding: 0 0 12mm; }

/* \u2500\u2500 \u62A5\u5934\uFF1A\u7B80\u62A5\u540D\u79F0\uFF082 \u53F7\u5C0F\u6807\u5B8B\uFF0C\u5C45\u4E2D\uFF09+ \u7B80\u62A5\u7F16\u53F7\uFF08\u5C45\u53F3\uFF09 \u2500\u2500 */
.doc-head { margin: 0 0 6mm; }
.doc-head .serial { margin: 0; text-align: right; font-family: ${DOC_SPEC.family.fs}; font-size: ${DOC_SPEC.font.note}; color: #000; }
.doc-head .masthead { margin: 1mm 0 0; text-align: center; font-family: ${DOC_SPEC.family.xbs};
  font-size: ${DOC_SPEC.font.h1}; font-weight: 700; letter-spacing: .1em; line-height: 1.4; }

/* \u2500\u2500 \u4E3B\u6807\u9898\uFF1A2 \u53F7\u5C0F\u6807\u5B8B\uFF0C\u5C45\u4E2D\uFF1B\u591A\u884C\u68AF\u5F62/\u83F1\u5F62\uFF08\u53F0\u9636\u5C45\u4E2D\uFF0C\u9010\u884C\u6536\u7A84\uFF09 \u2500\u2500 */
.doc-title { margin: 4mm 0 ${DOC_SPEC.font.body}; padding: 0; text-align: center; font-family: ${DOC_SPEC.family.xbs};
  font-size: ${DOC_SPEC.font.h1}; font-weight: 700; line-height: 1.5; }
.doc-title .t-line { display: block; }
/* \u68AF\u5F62/\u83F1\u5F62\uFF1A\u4E24\u884C\u65F6\u4E0A\u5BBD\u4E0B\u7A84\uFF1B\u4E09\u884C\u53CA\u4EE5\u4E0A\u65F6\u4E2D\u95F4\u6700\u5BBD\u3001\u9996\u5C3E\u6536\u7A84\uFF08\u83F1\u5F62\uFF09 */
.doc-title[data-line-count="2"] .t-line + .t-line { width: 74%; margin: 0 auto; }
.doc-title[data-line-count="3"] .t-line:first-child { width: 78%; margin: 0 auto; }
.doc-title[data-line-count="3"] .t-line:last-child { width: 78%; margin: 0 auto; }
.doc-title[data-line-count="4"] .t-line:first-child,
.doc-title[data-line-count="4"] .t-line:last-child { width: 72%; margin: 0 auto; }
.doc-title[data-line-count="4"] .t-line:nth-child(2),
.doc-title[data-line-count="4"] .t-line:nth-child(3) { width: 92%; margin: 0 auto; }

/* \u2500\u2500 \u6458\u8981\u680F\uFF1A\u6807\u9898\u4E0B\u7A7A\u4E00\u884C\u30013 \u53F7\u6977\u4F53\u3001\u5DE6\u7A7A 2 \u5B57\u7B26 \u2500\u2500 */
.doc-abstract { margin: 0 0 3mm; text-indent: 2em; text-align: justify; font-family: ${DOC_SPEC.family.kai};
  font-size: ${DOC_SPEC.font.abstract}; line-height: 1.7; }
.doc-abstract .abs-lead { font-weight: 700; }

/* \u2500\u2500 \u6570\u636E\u843D\u6B3E\u6761\uFF1A\u751F\u6210\u4F9D\u636E\uFF0C4 \u53F7\u4EFF\u5B8B\uFF0C\u4E0D\u5360\u6458\u8981\u680F \u2500\u2500 */
.doc-meta { margin: 0 0 5mm; text-indent: 2em; font-family: ${DOC_SPEC.family.fs};
  font-size: ${DOC_SPEC.font.note}; color: #333; }

/* \u2500\u2500 \u6B63\u6587\uFF1A3 \u53F7\u4EFF\u5B8B\uFF0C\u6BCF\u6BB5\u5DE6\u7A7A 2 \u5B57\u7B26\u3001\u56DE\u884C\u9876\u683C \u2500\u2500 */
.doc-body { font-family: ${DOC_SPEC.family.fs}; font-size: ${DOC_SPEC.font.body}; }
.sec { margin: 0 0 4mm; break-inside: auto; }
/* \u4E00\u7EA7\u6807\u9898\uFF1A\u4E00\u3001\uFF08\u9ED1\u4F53\uFF09 */
.sec h2.h1 { margin: 4mm 0 2mm; text-indent: 2em; font-family: ${DOC_SPEC.family.hei};
  font-size: ${DOC_SPEC.font.body}; font-weight: 700; line-height: 1.6; }
/* \u4E8C\u7EA7\u6807\u9898\uFF1A\uFF08\u4E00\uFF09\uFF08\u6977\u4F53\uFF09 */
.sec h3.h2 { margin: 3mm 0 1mm; text-indent: 2em; font-family: ${DOC_SPEC.family.kai};
  font-size: ${DOC_SPEC.font.body}; font-weight: 700; line-height: 1.6; }
/* \u6B63\u6587\u884C\uFF1A\u5DE6\u7A7A 2 \u5B57\u7B26\uFF0C\u56DE\u884C\u9876\u683C\uFF08text-indent \u53EA\u7BA1\u9996\u884C\uFF0C\u56DE\u884C\u81EA\u7136\u9876\u683C\uFF09 */
.sec ul { margin: 0; padding: 0; list-style: none; }
.sec li { text-indent: 2em; margin: 0 0 1mm; text-align: justify; break-inside: avoid; }

/* \u2500\u2500 \u9644\u8868\uFF1A\u6587\u5B57 3 \u53F7\u4EFF\u5B8B\uFF0C\u8868\u683C\u6807\u9898\u5728\u8868\u683C\u4E0A\u65B9\u5C45\u4E2D \u2500\u2500 */
.tbl-cap { margin: 3mm 0 1mm; text-align: center; font-family: ${DOC_SPEC.family.hei}; font-weight: 700;
  font-size: ${DOC_SPEC.font.table}; }
.rep-tbl { width: 100%; border-collapse: collapse; margin: 0 0 3mm; font-family: ${DOC_SPEC.family.fs};
  font-size: ${DOC_SPEC.font.table}; break-inside: avoid; table-layout: auto; }
.rep-tbl th, .rep-tbl td { border: 1px solid #000; padding: 1mm 2mm; text-align: left; vertical-align: top;
  line-height: 1.5; }
.rep-tbl thead th { background: #f2f2f2; font-family: ${DOC_SPEC.family.hei}; font-weight: 700; text-align: center; }
.rep-tbl td:first-child { white-space: nowrap; }

/* \u2500\u2500 \u660E\u65E5\u8DDF\u8E2A\u9879\uFF1A\u590D\u9009\u6846\u6E05\u5355\uFF08\u6A21\u677F\u2463\uFF09 \u2500\u2500 */
.sec ul.todo li { text-indent: 2em; }
.sec ul.todo .cb { margin-right: .3em; }

/* \u2500\u2500 \u53E3\u5F84\u6298\u53E0\u4EF6\uFF08<details> \u539F\u751F\u6298\u53E0\uFF0C\u65E0\u9700\u811A\u672C\uFF1B\u{1F4CC} \u6253\u5370\u65F6\u5F3A\u5236\u5C55\u5F00\uFF09 \u2500\u2500 */
details.caliber { margin: 2mm 0 0; border: 1px solid #bbb; background: #fafafa; break-inside: avoid; }
details.caliber > summary { cursor: pointer; padding: 1mm 2mm; font-family: ${DOC_SPEC.family.kai};
  font-size: ${DOC_SPEC.font.note}; color: #333; user-select: none; }
details.caliber > summary:hover { color: #000; }
details.caliber > p { margin: 0; padding: 1mm 2mm 2mm; font-family: ${DOC_SPEC.family.kai};
  font-size: ${DOC_SPEC.font.note}; line-height: 1.7; text-align: justify; text-indent: 2em; }
details.caliber.appendix { margin-top: 5mm; }

/* \u2500\u2500 \u843D\u6B3E\uFF1A\u751F\u6210\u65E5\u671F\uFF0C\u963F\u62C9\u4F2F\u6570\u5B57\u5199\u5168\u5E74\u6708\u65E5\u3001\u4E0D\u7F16\u865A\u4F4D\u3001\u53F3\u7A7A\u56DB\u5B57 \u2500\u2500 */
.sign-date { margin: 6mm 0 0; text-align: right; padding-right: ${DOC_SPEC.dateRightChars}em;
  font-family: ${DOC_SPEC.family.fs}; font-size: ${DOC_SPEC.font.body}; }

/* \u2500\u2500 \u8BED\u4E49\u5F3A\u8C03\uFF08\u6CE8\u610F\uFF1A\u672C\u6587\u4EF6\u662F\u6253\u5370\u6587\u6863\uFF0C\u6DA8\u7EA2\u8DCC\u7EFF\u6CBF\u7528\u4E2D\u6587\u60EF\u4F8B\uFF09 \u2500\u2500 */
b, strong { font-weight: 700; color: #000; }
.chg { color: #c0392b; white-space: nowrap; }
.chg-dn { color: #1e7e34; }
.chg i { font-style: normal; font-size: .8em; }
.warn { color: #9a6b00; font-weight: 700; }
/* \u4E09\u6863\u914D\u8272\u6807\u8BB0\uFF1A\u767D\u5E95\u6253\u5370\u6587\u6863\u91CC emoji \u4F1A\u8F6C\u9ED1\u767D\uFF0C\u6545\u540C\u65F6\u7ED9\u6587\u5B57\u8272\u505A\u533A\u5206 */
.ico { white-space: nowrap; }
.ico-risk { color: #c0392b; font-weight: 700; }
.ico-pos { color: #1e7e34; font-weight: 700; }
.ico-neutral { color: #333; }

/* \u2500\u2500 \u9875\u811A\uFF08\u514D\u8D23\u58F0\u660E\u7B49\uFF0C\u4F4D\u4E8E\u843D\u6B3E\u4E4B\u540E\u3001\u7248\u5FC3\u4E4B\u5185\uFF09 \u2500\u2500 */
.doc-foot { margin-top: 4mm; padding-top: 2mm; border-top: 1px solid #999; }
.disclaimer { font-size: ${DOC_SPEC.font.note}; color: #333; line-height: 1.7; text-indent: 2em;
  font-family: ${DOC_SPEC.family.fs}; margin: 0 0 1mm; }
.src { font-size: ${DOC_SPEC.font.note}; color: #555; margin: 0; text-indent: 2em;
  font-family: ${DOC_SPEC.family.fs}; }

/* \u2500\u2500 \u9875\u7801\uFF1A4 \u53F7\u534A\u89D2\u963F\u62C9\u4F2F\u6570\u5B57\uFF0C\u5C45\u7248\u5FC3\u4E0B\u8FB9\u7F18\u4E4B\u4E0B\u3001\u7248\u5FC3\u4E4B\u5916\uFF1B\u5355\u9875\u53F3\u653E\u3001\u53CC\u9875\u5DE6\u653E \u2500\u2500
   \u5B9E\u73B0\u8BF4\u660E\uFF08\u8FD9\u662F\u672C\u9879\u76EE\u5DF2\u77E5\u7684\u6D4F\u89C8\u5668\u80FD\u529B\u8FB9\u754C\uFF0C\u4E0D\u7C89\u9970\uFF09\uFF1A
     \xB7 \u300C\u5C45\u7248\u5FC3\u4E0B\u8FB9\u7F18\u4E4B\u4E0B / \u7248\u5FC3\u4E4B\u5916\u300D\u7531 @page \u7684 @bottom-* \u9875\u8FB9\u8DDD\u6846\u5B9E\u73B0\u2014\u2014\u8FD9\u6B63\u662F\u9875\u811A\u533A\uFF0C
       \u843D\u5728\u4E0B\u65B9 35mm \u9875\u8FB9\u8DDD\u5185\uFF0C\u4E0D\u9700\u8981 footer \u53C2\u4E0E\u5206\u9875\uFF1B
     \xB7 \u300C\u5355\u9875\u53F3\u653E\u3001\u53CC\u9875\u5DE6\u653E\u300D\u7531 @page :right / :left \u533A\u5206\uFF1B
     \xB7 counter(page) \u53D6\u5F53\u524D\u9875\u7801\uFF0Cdecorator \u91CC\u7ED9 ::after \u6302\u5185\u5BB9\uFF08\u6539 counter(page)+'/'+counter(pages)
       \u4E5F\u53EA\u662F\u52A0\u5206\u6BCD\uFF0C\u6545\u672C\u7A3F\u4E0D\u52A0\uFF0C\u4FDD\u6301\u300C4 \u53F7\u534A\u89D2\u963F\u62C9\u4F2F\u6570\u5B57\u300D\u7684\u6781\u7B80\u5F62\u6001\uFF09\u3002
   \u26A0 Chromium \u6253\u5370\u4F1A\u5FFD\u7565 @page :left/:right \u7684 margin box\uFF0C\u6B64\u65F6\u9000\u5316\u4E3A\u6D4F\u89C8\u5668\u9ED8\u8BA4\u9875\u811A\u4F4D\u7F6E\uFF1B
     \u5185\u5BB9\u5B8C\u6574\uFF0C\u53EA\u662F\u5DE6\u53F3\u5206\u7F6E\u4E0D\u751F\u6548\u3002\u82E5\u9700\u4E25\u683C\u5206\u7F6E\uFF0C\u7528\u6253\u5370\u5BF9\u8BDD\u6846\u300C\u9875\u7709\u548C\u9875\u811A\u300D\u6216\u53E6\u884C\u540E\u5904\u7406\u3002 */
@page :right { @bottom-right { content: counter(page); font-family: ${DOC_SPEC.family.fs}; font-size: ${DOC_SPEC.font.page}; } }
@page :left { @bottom-left { content: counter(page); font-family: ${DOC_SPEC.family.fs}; font-size: ${DOC_SPEC.font.page}; } }
.pg-no { display: none; }

/* \u2500\u2500 \u6253\u5370\u5FAE\u8C03 \u2500\u2500 */
@media print {
  .doc { width: auto; margin: 0; padding: 0; }
  a { color: inherit; text-decoration: none; }
  .sec h2.h1, .sec h3.h2 { break-after: avoid; }
  .doc-foot { break-inside: avoid; }

  /* \u2605 \u6298\u53E0\u7740\u6253\u5370\u4F1A\u7F3A\u5185\u5BB9\u2014\u2014\u8FD9\u662F\u672C\u8F6E\u4FEE\u7684\u7B2C\u4E8C\u4E2A\u771F\u5B9E bug\u3002
     \u65E7\u5199\u6CD5\u53EA\u5BF9 "> p" \u4E0E "> ul" \u52A0\u4E86 display:block\uFF0C\u770B\u8D77\u6765\u300C\u5C55\u5F00\u300D\u4E86\uFF0C\u4F46\u5176\u5B9E\u6CA1\u7528\uFF1A
     \u4E00\u4E2A**\u672A open** \u7684 <details> \u5728 Chromium \u91CC\u6839\u672C\u4E0D\u4E3A\u5B50\u5185\u5BB9\u751F\u6210\u76D2\u5B50
     \uFF08\u5185\u5BB9\u843D\u5728 UA \u7684 slot \u91CC\u88AB content-visibility \u9690\u6389\uFF09\uFF0C
     \u6240\u4EE5\u65E0\u8BBA\u540E\u4EE3\u600E\u4E48\u5199 display\uFF0C\u6253\u5370\u51FA\u6765\u90FD\u8FD8\u662F\u7F3A\u7684\u3002
     \u6B63\u786E\u505A\u6CD5\u662F\u8BA9 details **\u81EA\u8EAB**\u5728\u6253\u5370\u65F6\u8868\u73B0\u4E3A\u5E38\u5F00\u5BB9\u5668\uFF1A
       \u2460 \u628A <summary> \u7684\u4E09\u89D2\u6807\u8BB0\u53BB\u6389\uFF08\u7EB8\u9762\u4E0A\u6CA1\u6709\u53EF\u6298\u53E0\u7684\u8BED\u4E49\uFF09\uFF1B
       \u2461 \u7528 "details.caliber > *:not(summary)" \u5168\u91CF\u515C\u4F4F\uFF0C\u800C\u4E0D\u662F\u9010\u4E2A\u6570 p/ul\u2014\u2014
          \u53E3\u5F84\u6B63\u6587\u53EF\u80FD\u542B\u8868\u683C\u3001\u5217\u8868\u3001\u591A\u6BB5\uFF0C\u6F0F\u4E00\u79CD\u5C31\u5C11\u4E00\u5757\uFF08\u8FD9\u6B63\u662F"\u6253\u5370\u770B\u4E0D\u5230\u5168\u90E8\u5185\u5BB9"\u7684\u7531\u6765\uFF09\u3002
     \u4E0D\u4F9D\u8D56 JS\u3001\u4E0D\u4F9D\u8D56\u6587\u6863\u91CC\u662F\u5426\u5199\u4E86 open\uFF0C\u7EAF CSS \u4FDD\u8BC1\u7EB8\u9762\u5B8C\u6574\u3002 */
  details.caliber { border: none; background: transparent; }
  details.caliber > summary { list-style: none; }
  details.caliber > summary::-webkit-details-marker { display: none; }
  details.caliber > summary::marker { content: ''; }
  /* \u5173\u952E\uFF1A\u628A\u6298\u53E0\u4EF6\u7684\u5168\u90E8\u5185\u5BB9\u5F3A\u5236\u663E\u793A\uFF08\u542B\u672A open \u7684 details\uFF09 */
  details.caliber > *:not(summary) { display: block !important; }
  details.caliber > :not(summary) { break-inside: avoid; }

  .rep-tbl { break-inside: avoid; }
  .rep-tbl thead { display: table-header-group; }
  .rep-tbl tr { break-inside: avoid; }
}
`;
function reportFileName(dataDate, ext) {
  const d = String(dataDate || "").replace(/[^\d-]/g, "") || "unknown";
  return `A\u80A1\u7814\u5224\u62A5\u544A_${d}.${ext}`;
}

// src/report_audit.js
var report_audit_exports = {};
__export(report_audit_exports, {
  AUDIT_VERSION: () => AUDIT_VERSION,
  CALIBER_SUMMARY: () => CALIBER_SUMMARY2,
  EXPECTED_SECTIONS: () => EXPECTED_SECTIONS,
  MASTHEAD: () => MASTHEAD,
  RULES: () => RULES,
  auditReport: () => auditReport,
  auditSummary: () => auditSummary,
  isAuditPass: () => isAuditPass
});
var AUDIT_VERSION = "report-audit-v2";
var EXPECTED_SECTIONS = 10;
var MASTHEAD = "A\u80A1\u5E02\u573A\u60C5\u7EEA\u7814\u5224\u7B80\u62A5";
var CALIBER_SUMMARY2 = "\u{1F50D} \u70B9\u51FB\u5C55\u5F00\u67E5\u770B\u53E3\u5F84";
var CJK_L1 = /^(一|二|三|四|五|六|七|八|九|十)、/;
var CJK_L2 = /^（(一|二|三|四|五|六|七|八|九|十)）/;
var ARABIC_L3 = /^\d+\.\s/;
var ARABIC_L4 = /^（\d+）/;
function headingTexts(html) {
  const out2 = [];
  const re = /<h([23])\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let m;
  while (m = re.exec(html)) {
    const text = m[3].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    out2.push({ level: m[1] === "2" ? 1 : 2, text });
  }
  return out2;
}
var RULES = [
  {
    id: "abstract-present",
    msg: "\u62A5\u544A\u5F00\u5934\u7F3A\u3010\u6781\u7B80\u6458\u8981\u3011\uFF08\u6A21\u677F\u2460\uFF1A\u4E00\u53E5\u8BDD\u603B\u7ED3\u6838\u5FC3\uFF09",
    run: (c) => !!(c.rep && c.rep.abstract && c.rep.abstract.trim())
  },
  {
    id: "abstract-first",
    msg: "\u3010\u6781\u7B80\u6458\u8981\u3011\u4E0D\u5728\u62A5\u544A\u6700\u524D\u9762\uFF08\u6A21\u677F\u2460\u8981\u6C42\u7F6E\u4E8E\u5F00\u5934\uFF09",
    // 在屏幕 DOM 上按文档顺序比较：摘要节点必须早于第一个 .bf-sec
    run: (c) => {
      if (!c.rootEl || !c.rootEl.querySelector) return true;
      const abs = c.rootEl.querySelector(".bf-abstract");
      const firstSec = c.rootEl.querySelector(".bf-sec");
      if (!abs || !firstSec) return true;
      return !!(abs.compareDocumentPosition(firstSec) & 4);
    }
  },
  {
    id: "sections-count",
    msg: `\u7AE0\u8282\u6570\u4E0D\u7B49\u4E8E ${EXPECTED_SECTIONS}\uFF08\u6A21\u677F\u2461\uFF1A\u56FA\u5B9A ${EXPECTED_SECTIONS} \u5927\u7AE0\u8282\uFF09`,
    run: (c) => {
      const n = c.rep && c.rep.sections ? c.rep.sections.length : 0;
      return n === EXPECTED_SECTIONS ? true : `\u5B9E\u9645 ${n} \u6BB5`;
    }
  },
  {
    id: "sections-titled",
    msg: "\u5B58\u5728\u6CA1\u6709\u6807\u9898\u7684\u7AE0\u8282",
    run: (c) => {
      const bad = (c.rep.sections || []).filter((s) => !s.title || !s.title.trim());
      return bad.length === 0 ? true : `\u7B2C ${bad.map((s) => s.id || "?").join("\u3001")} \u6BB5\u6807\u9898\u4E3A\u7A7A`;
    }
  },
  {
    id: "sections-nonempty",
    msg: "\u5B58\u5728\u6CA1\u6709\u4EFB\u4F55\u6B63\u6587\u884C\u4E0E\u8868\u683C\u7684\u7AE0\u8282\uFF08\u53EA\u5269\u6807\u9898\uFF09",
    run: (c) => {
      const bad = (c.rep.sections || []).filter((s) => !(s.lines || []).length);
      return bad.length === 0 ? true : `\u7B2C ${bad.map((s) => s.id || "?").join("\u3001")} \u6BB5\u4E3A\u7A7A`;
    }
  },
  {
    id: "caliber-per-section",
    msg: `\u5E76\u975E\u6BCF\u6BB5\u90FD\u6302\u4E86\u53E3\u5F84\u6298\u53E0\u4EF6\uFF08\u6A21\u677F\u2462\uFF1A\u6BCF\u7AE0\u8282\u4E00\u4E2A\u300C${CALIBER_SUMMARY2}\u300D\uFF09`,
    run: (c) => {
      const secs = c.rep.sections || [];
      const bad = secs.filter((s) => !s.caliber || !s.caliber.trim());
      return bad.length === 0 ? true : `${bad.length}/${secs.length} \u6BB5\u7F3A\u53E3\u5F84\u4EF6\uFF08\u7B2C ${bad.map((s) => s.id || "?").join("\u3001")} \u6BB5\uFF09`;
    }
  },
  {
    id: "caliber-summary-text",
    // 注意本规则查的是**屏幕** DOM（#briefBody 下的 .bf-sec .bf-caliber summary），
    // 故判据是屏幕串 CALIBER_SUMMARY。导出侧用的是 report.js 的 CALIBER_SUMMARY_DOC，
    // 两者**刻意不同**（屏幕说"点击展开"，静态文档说"口径说明"），由 audit_lhb_caliber 的
    // 模板契约块反向锁死"必须不同"。所以这里不能写"屏幕与导出必须一致"——那句话现在是错的。
    msg: `\u5C4F\u5E55\u53E3\u5F84\u6298\u53E0\u4EF6\u6807\u9898\u4E0D\u662F\u300C${CALIBER_SUMMARY2}\u300D`,
    // 判据来源：优先用调用方**在 parseReport 之前**采好的 domCaliberSummaries 快照。
    // 原因：parseReport 会就地移除 .bf-caliber（防口径混进正文），之后 DOM 上就查不到了——
    // 若这时才查，会把一份合规报告误判为未通过。没有快照时才退回实时查询
    // （单测里传的是未被 parseReport 动过的容器，直接查也是对的）。
    run: (c) => {
      let sums = c.domCaliberSummaries;
      if (!Array.isArray(sums)) {
        if (!c.rootEl || !c.rootEl.querySelectorAll) return true;
        sums = [...c.rootEl.querySelectorAll(".bf-sec .bf-caliber summary")].map((s) => s.textContent.trim());
      }
      if (!sums.length) return "\u5C4F\u5E55 DOM \u91CC\u627E\u4E0D\u5230\u7AE0\u8282\u53E3\u5F84\u6298\u53E0\u4EF6";
      const bad = sums.filter((s) => s !== CALIBER_SUMMARY2);
      return bad.length === 0 ? true : `${bad.length} \u4E2A\u6298\u53E0\u4EF6\u6807\u9898\u4E0D\u7B26\uFF08\u5982\u300C${bad[0]}\u300D\uFF09`;
    }
  },
  {
    id: "ladder-is-table",
    msg: "\u8FDE\u677F\u5929\u68AF\u4E0D\u662F\u8868\u683C\uFF08\u6A21\u677F\u2461\uFF1A\u8FDE\u677F\u5929\u68AF\u7528\u8868\u683C\uFF09",
    run: (c) => {
      const tbl = (c.rep.sections || []).flatMap((s) => s.lines || []).filter((l) => l.kind === "table");
      if (!tbl.length) return "\u6574\u4EFD\u62A5\u544A\u6CA1\u6709\u4EFB\u4F55\u8868\u683C\uFF0C\u8FDE\u677F\u5929\u68AF\u7591\u4F3C\u88AB\u644A\u5E73\u6210\u6587\u5B57";
      const bad = tbl.filter((t) => !(t.head || []).length || !(t.rows || []).length);
      return bad.length === 0 ? true : `${bad.length} \u4E2A\u8868\u683C\u7F3A\u8868\u5934\u6216\u6570\u636E\u884C`;
    }
  },
  {
    id: "todo-checklist",
    msg: "\u660E\u65E5\u8DDF\u8E2A\u9879\u4E0D\u662F\u590D\u9009\u6846\u6E05\u5355\uFF08\u6A21\u677F\u2463\uFF09",
    run: (c) => {
      const total = Number.isInteger(c.domTodoCount) ? c.domTodoCount : c.rootEl && c.rootEl.querySelectorAll ? c.rootEl.querySelectorAll(".bf-todo").length : null;
      if (total === null) return true;
      if (!total) return "\u5C4F\u5E55\u4E0A\u627E\u4E0D\u5230\u4EFB\u4F55 .bf-todo \u8DDF\u8E2A\u9879";
      const bad = Number.isInteger(c.domTodoAriaCount) ? total - c.domTodoAriaCount : [...c.rootEl.querySelectorAll(".bf-todo")].filter((t) => !t.hasAttribute("aria-checked")).length;
      return bad === 0 ? true : `${bad} \u4E2A\u8DDF\u8E2A\u9879\u7F3A aria-checked\uFF08\u4E0D\u662F\u53EF\u52FE\u9009\u9879\uFF09`;
    }
  },
  {
    id: "todo-gfm-in-md",
    msg: "Markdown \u91CC\u7684\u8DDF\u8E2A\u9879\u4E0D\u662F GFM \u590D\u9009\u6846\u8BED\u6CD5 - [ ]\uFF08\u6A21\u677F\u2463/\u2464\uFF09",
    run: (c) => {
      if (!c.md) return true;
      if (!/^\- \[ \] /m.test(c.md)) return "Markdown \u672A\u89C1 - [ ] \u884C";
      return true;
    }
  },
  {
    id: "key-bold",
    msg: "\u5173\u952E\u6570\u503C\u6CA1\u6709\u52A0\u7C97\uFF08\u6A21\u677F\u2463\uFF1A\u5173\u952E\u6570\u503C\u52A0\u7C97\uFF09",
    run: (c) => {
      if (!c.md) return true;
      const n = (c.md.match(/\*\*[^*]+\*\*/g) || []).length;
      return n >= 5 ? true : `Markdown \u4E2D\u52A0\u7C97\u7247\u6BB5\u4EC5 ${n} \u5904\uFF08<5\uFF0C\u7591\u4F3C\u4E22\u5931\u5F3A\u8C03\uFF09`;
    }
  },
  {
    id: "details-paired",
    msg: "Markdown \u91CC <details> \u6807\u7B7E\u4E0D\u914D\u5BF9\uFF08\u6298\u53E0\u4EF6\u4F1A\u6E32\u67D3\u9519\u4E71\uFF09",
    run: (c) => {
      if (!c.md) return true;
      const open = (c.md.match(/<details>/g) || []).length;
      const close = (c.md.match(/<\/details>/g) || []).length;
      return open === close ? true : `<details> ${open} \u4E2A / </details> ${close} \u4E2A`;
    }
  },
  {
    id: "appendix-present",
    msg: "\u7F3A\u6587\u672B\u72EC\u7ACB\u6298\u53E0\u9644\u5F55\uFF08\u6A21\u677F\u2462\uFF1A\u6C47\u603B\u5168\u90E8\u53E3\u5F84\uFF09",
    run: (c) => {
      if (!c.rep.appendix) return "\u7ED3\u6784\u5316\u62A5\u544A\u65E0 appendix";
      if (c.domAppendix === false) return "\u5C4F\u5E55 DOM \u91CC\u627E\u4E0D\u5230 .bf-appendix";
      if (c.domAppendix === void 0 && c.rootEl && c.rootEl.querySelector && !c.rootEl.querySelector(".bf-appendix")) {
        return "\u5C4F\u5E55 DOM \u91CC\u627E\u4E0D\u5230 .bf-appendix";
      }
      return true;
    }
  },
  {
    id: "appendix-in-md",
    msg: "Markdown \u91CC\u627E\u4E0D\u5230\u53E3\u5F84\u9644\u5F55\u6298\u53E0\u4EF6",
    run: (c) => {
      if (!c.md) return true;
      const i = c.md.lastIndexOf("<details>");
      return i >= 0 ? true : "Markdown \u65E0 <details> \u5757";
    }
  },
  {
    id: "disclaimer",
    msg: "\u62A5\u544A\u7ED3\u5C3E\u7F3A\u514D\u8D23\u58F0\u660E\uFF08\u6A21\u677F\u2464\uFF09",
    run: (c) => {
      const md = c.md || "", txt = c.txt || "", html = c.html || "";
      const hit = /非投资建议|不构成任何投资建议/.test(md) && /非投资建议|不构成任何投资建议/.test(txt) && /免责声明/.test(html);
      return hit ? true : "md/txt/html \u81F3\u5C11\u4E00\u79CD\u5F62\u6001\u7F3A\u514D\u8D23\u58F0\u660E";
    }
  },
  {
    id: "generated-at",
    msg: "\u62A5\u544A\u7ED3\u5C3E\u7F3A\u5BFC\u51FA\u65F6\u95F4\uFF08\u6A21\u677F\u2464\uFF09",
    run: (c) => {
      const hasAt = (s) => /导出时间：\s*\d{4}-\d{2}-\d{2}/.test(s || "");
      return hasAt(c.md) && hasAt(c.txt) ? true : "Markdown/\u7EAF\u6587\u672C\u672A\u540C\u65F6\u5E26\u5BFC\u51FA\u65F6\u95F4";
    }
  },
  {
    id: "markers",
    msg: "\u4E09\u6863\u914D\u8272\u6807\u8BB0\u672A\u843D\u5730\uFF08\u6A21\u677F\u2463\uFF1A\u{1F534}\u98CE\u9669/\u{1F7E2}\u79EF\u6781/\u26AB\u4E2D\u6027\uFF09",
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
      const hasMarkerTable = c.markerKinds ? ["risk", "pos", "neutral"].every((k) => c.markerKinds.includes(k)) : true;
      if (!hasMarkerTable) return "\u4E09\u6863\u6807\u8BB0\u6620\u5C04\u8868\u4E0D\u5B8C\u6574\uFF08\u5BFC\u51FA\u5C42\u7F3A risk/pos/neutral\uFF09";
      if (c.hasMarkerClasses === false) return "\u5C4F\u5E55\u7F3A\u4E09\u6863\u914D\u8272 class\uFF08.ico-risk/.ico-pos/.ico-neutral\uFF09";
      const src = [c.md, c.txt, c.html].filter(Boolean).join("\n");
      if (src) {
        const n = ["\u{1F534}", "\u{1F7E2}", "\u26AB"].filter((m) => src.includes(m)).length;
        if (n === 0) return "\u4E09\u79CD\u5F62\u6001\u91CC\u90FD\u627E\u4E0D\u5230\u4EFB\u4F55\u914D\u8272\u6807\u8BB0\uFF08\u6E32\u67D3\u51FD\u6570\u7591\u4F3C\u672A\u6302\u6807\u8BB0\uFF09";
      }
      return true;
    }
  },
  {
    id: "compliance-no-recompute",
    msg: "\u62A5\u544A\u51FA\u73B0\u300C\u4EC5\u4F9B\u53C2\u8003\u300D\u4EE5\u5916\u7684\u6295\u8D44\u5EFA\u8BAE\u5F0F\u63AA\u8F9E\uFF08\u5408\u89C4\u5B88\u536B\uFF09",
    run: (c) => {
      const src = [c.md, c.txt].filter(Boolean).join("\n");
      if (!src) return true;
      const BAN = /(保证收益|稳赚不赔|必涨|一定会上涨|包赚)/;
      const m = src.match(BAN);
      return m ? `\u51FA\u73B0\u8D8A\u754C\u63AA\u8F9E\u300C${m[1]}\u300D` : true;
    }
  },
  // ── 公文体例（用户给定「A股市场研究分析简报 · 报告标准格式」）─────────────
  // 这一组的意义：公文格式是**规范**，不是"好看就行"。规范一旦被重构改掉，
  // 报告就不再是公文了。所以每条硬性注意都有对应的机检项。
  {
    id: "doc-masthead",
    msg: `\u62A5\u5934\u7F3A\u7B80\u62A5\u540D\u79F0\u300C${MASTHEAD}\u300D\uFF08\u516C\u6587\u786C\u89C4\u5B9A\uFF09`,
    run: (c) => {
      if (!c.html) return true;
      const m = c.html.match(/<p class="masthead">([\s\S]*?)<\/p>/);
      if (!m) return "\u5BFC\u51FA\u6587\u6863\u91CC\u627E\u4E0D\u5230 .masthead \u62A5\u5934";
      const text = m[1].replace(/<[^>]*>/g, "").trim();
      return text === MASTHEAD ? true : `\u62A5\u5934\u540D\u79F0\u662F\u300C${text}\u300D\uFF0C\u5E94\u4E3A\u300C${MASTHEAD}\u300D`;
    }
  },
  {
    id: "doc-serial-right",
    msg: "\u7B80\u62A5\u7F16\u53F7\u672A\u5C45\u53F3\u6216\u65E0\u516D\u89D2\u62EC\u53F7\u5E74\u4EFD\u3014YYYY\u3015\uFF08\u516C\u6587\u786C\u89C4\u5B9A\uFF09",
    run: (c) => {
      if (!c.html) return true;
      const m = c.html.match(/<p class="serial">([\s\S]*?)<\/p>/);
      if (!m) return "\u5BFC\u51FA\u6587\u6863\u91CC\u627E\u4E0D\u5230 .serial \u7B80\u62A5\u7F16\u53F7";
      const text = m[1].replace(/<[^>]*>/g, "").trim();
      if (!/〔\d{4}〕/.test(text)) return `\u7F16\u53F7\u300C${text}\u300D\u7F3A\u516D\u89D2\u62EC\u53F7\u5E74\u4EFD`;
      if (!/\.doc-head \.serial\s*\{[^}]*text-align:\s*right/.test(c.html)) return "\u7F16\u53F7\u672A\u58F0\u660E\u5C45\u53F3";
      return true;
    }
  },
  {
    id: "doc-date-arabic",
    msg: "\u751F\u6210\u65E5\u671F\u4E0D\u662F\u963F\u62C9\u4F2F\u6570\u5B57\u5168\u5E74\u6708\u65E5\uFF08\u516C\u6587\u786C\u89C4\u5B9A\uFF1A\u4E0D\u7F16\u865A\u4F4D\u3001\u4E0D\u7528\u6C49\u5B57\u6570\u5B57\uFF09",
    run: (c) => {
      if (!c.html) return true;
      const m = c.html.match(/<p class="sign-date">([\s\S]*?)<\/p>/);
      if (!m) return "\u5BFC\u51FA\u6587\u6863\u91CC\u627E\u4E0D\u5230 .sign-date \u751F\u6210\u65E5\u671F\u843D\u6B3E";
      const text = m[1].replace(/<[^>]*>/g, "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return `\u65E5\u671F\u300C${text}\u300D\u4E0D\u662F YYYY-MM-DD \u5F62\u6001`;
      if (/[一二三四五六七八九十〇]/.test(text)) return `\u65E5\u671F\u300C${text}\u300D\u7528\u4E86\u6C49\u5B57\u6570\u5B57`;
      if (!/\.sign-date\s*\{[^}]*padding-right:\s*4em/.test(c.html)) return "\u65E5\u671F\u672A\u58F0\u660E\u53F3\u7A7A\u56DB\u5B57";
      return true;
    }
  },
  {
    id: "doc-numbering-order",
    msg: "\u6B63\u6587\u5C42\u7EA7\u5E8F\u53F7\u6DF7\u7528\uFF08\u516C\u6587\u786C\u89C4\u5B9A\uFF1A\u4E00\u3001\u2192\uFF08\u4E00\uFF09\u2192 1.\u2192\uFF081\uFF09\uFF0C\u4E0D\u5F97\u8DF3\u7EA7\uFF09",
    run: (c) => {
      if (!c.html) return true;
      const hs = headingTexts(c.html);
      if (!hs.length) return "\u5BFC\u51FA\u6587\u6863\u91CC\u627E\u4E0D\u5230\u4EFB\u4F55\u5C42\u7EA7\u6807\u9898";
      const badL1 = hs.filter((h) => h.level === 1 && !CJK_L1.test(h.text));
      if (badL1.length) return `\u4E00\u7EA7\u6807\u9898\u4E0D\u662F\u300C\u4E00\u3001\u300D\u5F62\u6001\uFF1A${badL1[0].text}`;
      const badL2 = hs.filter((h) => h.level === 2 && !CJK_L2.test(h.text));
      if (badL2.length) return `\u4E8C\u7EA7\u6807\u9898\u4E0D\u662F\u300C\uFF08\u4E00\uFF09\u300D\u5F62\u6001\uFF1A${badL2[0].text}`;
      for (let i = 0; i < hs.length; i++) {
        if (hs[i].level !== 1) continue;
        const nxt = hs[i + 1];
        if (nxt && (ARABIC_L3.test(nxt.text) || ARABIC_L4.test(nxt.text))) {
          return `\u300C${hs[i].text}\u300D\u7684\u4E0B\u4E00\u7EA7\u76F4\u63A5\u662F\u300C${nxt.text}\u300D\uFF08\u8DF3\u8FC7\u4E86\u300C\uFF08\u4E00\uFF09\u300D\u8FD9\u4E00\u5C42\uFF09`;
        }
      }
      return true;
    }
  },
  {
    id: "doc-numbering-single",
    msg: "\u540C\u4E00\u6807\u9898\u51FA\u73B0\u53CC\u5E8F\u53F7\uFF08\u5982\u300C\u4E00\u3001\u2460 \u60C5\u7EEA\u5B9A\u4F4D\u300D\uFF09\uFF0C\u5E8F\u53F7\u88AB\u53E0\u52A0\u4E86",
    run: (c) => {
      if (!c.html) return true;
      const hs = headingTexts(c.html);
      const bad = hs.filter((h) => (h.text.match(/^[一二三四五六七八九十]+、/g) || []).length > 1 || /^[一二三四五六七八九十]+、\s*[①②③④⑤⑥⑦⑧⑨⑩]/.test(h.text) || /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(h.text));
      return bad.length === 0 ? true : `\u6807\u9898\u5E8F\u53F7\u53E0\u52A0\uFF1A${bad[0].text}`;
    }
  },
  {
    id: "doc-page-margin",
    msg: "\u7248\u5FC3\u9875\u8FB9\u8DDD\u4E0D\u7B26\u516C\u6587\u4F53\u4F8B\uFF08\u4E0A 37 / \u4E0B 35 / \u5DE6 28 / \u53F3 26 mm\uFF09",
    run: (c) => {
      if (!c.html) return true;
      return /@page\s*\{[^}]*size:\s*A4[^}]*margin:\s*37mm\s+26mm\s+35mm\s+28mm/.test(c.html) ? true : "\u5BFC\u51FA\u6587\u6863\u7684 @page \u8FB9\u8DDD\u4E0D\u662F\u300C\u4E0A37 \u53F326 \u4E0B35 \u5DE628\u300D";
    }
  },
  {
    id: "doc-font-ladder",
    msg: "\u516C\u6587\u5B57\u53F7\u9636\u68AF\u4E0D\u5B8C\u6574\uFF08\u62A5\u5934/\u4E3B\u6807\u9898 2 \u53F7\u3001\u6458\u8981 3 \u53F7\u6977\u4F53\u3001\u6B63\u6587 3 \u53F7\u4EFF\u5B8B\u3001\u9875\u7801 4 \u53F7\uFF09",
    run: (c) => {
      if (!c.html) return true;
      const need = [
        [/\.doc-head \.masthead\s*\{[^}]*font-size:\s*22pt/, "\u62A5\u5934\u672A\u7528 2 \u53F7\uFF0822pt\uFF09"],
        [/\.doc-title\s*\{[^}]*font-size:\s*22pt/, "\u4E3B\u6807\u9898\u672A\u7528 2 \u53F7\uFF0822pt\uFF09"],
        [/\.doc-abstract\s*\{[^}]*font-size:\s*16pt/, "\u6458\u8981\u680F\u672A\u7528 3 \u53F7\uFF0816pt\uFF09"],
        [/\.doc-body\s*\{[^}]*font-size:\s*16pt/, "\u6B63\u6587\u672A\u7528 3 \u53F7\uFF0816pt\uFF09"],
        [/@page :right\s*\{\s*@bottom-right\s*\{[^}]*font-size:\s*14pt/, "\u9875\u7801\u672A\u7528 4 \u53F7\uFF0814pt\uFF09"]
      ];
      const bad = need.filter(([re]) => !re.test(c.html));
      return bad.length === 0 ? true : bad.map(([, m]) => m).join("\uFF1B");
    }
  },
  {
    id: "doc-font-family",
    msg: "\u516C\u6587\u672A\u4F7F\u7528\u89C4\u5B9A\u5B57\u4F53\u65CF\uFF08\u5C0F\u6807\u5B8B / \u9ED1\u4F53 / \u6977\u4F53 / \u4EFF\u5B8B\uFF09",
    run: (c) => {
      if (!c.html) return true;
      const need = [
        [/\.doc-head \.masthead\s*\{[^}]*font-family:[^;}]*STZhongsong/, "\u62A5\u5934\u672A\u7528\u5C0F\u6807\u5B8B"],
        [/\.sec h2\.h1\s*\{[^}]*font-family:[^;}]*SimHei/, "\u4E00\u7EA7\u6807\u9898\u672A\u7528\u9ED1\u4F53"],
        [/\.sec h3\.h2\s*\{[^}]*font-family:[^;}]*KaiTi/, "\u4E8C\u7EA7\u6807\u9898\u672A\u7528\u6977\u4F53"],
        [/\.doc-body\s*\{[^}]*font-family:[^;}]*FangSong/, "\u6B63\u6587\u672A\u7528\u4EFF\u5B8B"]
      ];
      const bad = need.filter(([re]) => !re.test(c.html));
      return bad.length === 0 ? true : bad.map(([, m]) => m).join("\uFF1B");
    }
  },
  {
    id: "doc-page-number",
    msg: "\u9875\u7801\u89C4\u5219\u7F3A\u5931\uFF08\u5355\u9875\u53F3\u653E @page :right / \u53CC\u9875\u5DE6\u653E @page :left\uFF09",
    run: (c) => {
      if (!c.html) return true;
      const right = /@page :right\s*\{\s*@bottom-right\s*\{\s*content:\s*counter\(page\)/.test(c.html);
      const left = /@page :left\s*\{\s*@bottom-left\s*\{\s*content:\s*counter\(page\)/.test(c.html);
      if (!right || !left) return `\u5355\u9875\u53F3\u653E=${right} \u53CC\u9875\u5DE6\u653E=${left}`;
      return true;
    }
  },
  {
    id: "doc-title-indent",
    msg: "\u6B63\u6587/\u6458\u8981\u672A\u5DE6\u7A7A 2 \u5B57\u7B26\uFF08text-indent: 2em\uFF09",
    run: (c) => {
      if (!c.html) return true;
      const need = [
        [/\.doc-abstract\s*\{[^}]*text-indent:\s*2em/, "\u6458\u8981\u680F\u672A\u5DE6\u7A7A 2 \u5B57\u7B26"],
        [/\.sec li\s*\{[^}]*text-indent:\s*2em/, "\u6B63\u6587\u884C\u672A\u5DE6\u7A7A 2 \u5B57\u7B26"],
        [/\.sec h2\.h1\s*\{[^}]*text-indent:\s*2em/, "\u4E00\u7EA7\u6807\u9898\u672A\u5DE6\u7A7A 2 \u5B57\u7B26"]
      ];
      const bad = need.filter(([re]) => !re.test(c.html));
      return bad.length === 0 ? true : bad.map(([, m]) => m).join("\uFF1B");
    }
  },
  {
    id: "doc-table-caption-centered",
    msg: "\u9644\u8868\u6807\u9898\u672A\u5728\u8868\u683C\u4E0A\u65B9\u5C45\u4E2D\uFF08\u516C\u6587\u786C\u89C4\u5B9A\uFF09",
    run: (c) => {
      if (!c.html) return true;
      if (!/\.tbl-cap\s*\{[^}]*text-align:\s*center/.test(c.html)) return "\u8868\u683C\u6807\u9898\u672A\u5C45\u4E2D";
      const iCap = c.html.indexOf('class="tbl-cap"');
      const iTbl = c.html.indexOf('<table class="rep-tbl"');
      if (iCap >= 0 && iTbl >= 0 && iCap > iTbl) return "\u8868\u683C\u6807\u9898\u8DD1\u5230\u4E86\u8868\u683C\u4E0B\u65B9";
      return true;
    }
  },
  {
    id: "doc-checklist-brackets",
    msg: "\u8DDF\u8E2A\u6E05\u5355\u672A\u7528\u590D\u9009\u6846 [ ]\uFF08\u516C\u6587\u786C\u89C4\u5B9A\uFF09",
    run: (c) => {
      if (!c.md) return true;
      if (!/^\- \[ \] /m.test(c.md)) return "Markdown \u672A\u89C1 - [ ] \u590D\u9009\u6846\u884C";
      if (!c.html) return true;
      return /<span class="cb">☐<\/span>/.test(c.html) ? true : "\u5BFC\u51FA HTML \u672A\u89C1 \u2610 \u590D\u9009\u6846\u5360\u4F4D";
    }
  }
];
function auditReport(rep, opts = {}) {
  const ctx = {
    rep: rep || { sections: [] },
    rootEl: opts.rootEl || null,
    md: opts.md || "",
    txt: opts.txt || "",
    html: opts.html || ""
  };
  const checks = [];
  for (const rule of RULES) {
    let ok, reason = "";
    try {
      const r = rule.run(ctx);
      if (r === true || r === void 0 || r === null) {
        ok = true;
      } else {
        ok = false;
        reason = typeof r === "string" ? r : rule.msg;
      }
    } catch (e) {
      ok = false;
      reason = `\u5BA1\u8BA1\u9879\u5F02\u5E38\uFF1A${String(e && e.message || e)}`;
    }
    checks.push({ id: rule.id, msg: rule.msg, ok, reason: ok ? "" : reason });
  }
  const failed = checks.filter((c) => !c.ok);
  return {
    pass: failed.length === 0,
    total: checks.length,
    passed: checks.length - failed.length,
    failed,
    checks,
    version: AUDIT_VERSION
  };
}
function isAuditPass(rep, opts) {
  return auditReport(rep, opts).pass;
}
function auditSummary(result) {
  if (!result) return "\u672A\u5BA1\u8BA1";
  if (result.pass) return `\u901A\u8FC7 ${result.passed}/${result.total} \u9879`;
  const first = result.failed[0];
  const more = result.failed.length > 1 ? ` \u7B49 ${result.failed.length} \u9879` : "";
  return `\u672A\u901A\u8FC7 ${result.passed}/${result.total} \u9879 \xB7 ${first ? first.reason : ""}${more}`;
}

// src/seats.js
var seats_exports = {};
__export(seats_exports, {
  SEAT_TYPE_LABEL: () => SEAT_TYPE_LABEL,
  SIDE: () => SIDE,
  brokerOf: () => brokerOf,
  buySeatsOf: () => buySeatsOf,
  cityOf: () => cityOf,
  isAggregateSeatRow: () => isAggregateSeatRow,
  isForeignBroker: () => isForeignBroker,
  seatIdentity: () => seatIdentity,
  seatTypeOf: () => seatTypeOf,
  seatsOf: () => seatsOf,
  sellSeatsOf: () => sellSeatsOf,
  sideStats: () => sideStats
});
var SIDE = { BUY: "b", SELL: "s" };
var AGGREGATE_ROW_NAMES = /* @__PURE__ */ new Set([
  "\u81EA\u7136\u4EBA",
  "\u673A\u6784",
  "\u4E2D\u5C0F\u6295\u8D44\u8005",
  "\u5176\u4ED6\u81EA\u7136\u4EBA",
  "\u5176\u4ED6\u673A\u6784",
  "\u4E13\u4E1A\u673A\u6784",
  "\u4E2A\u4EBA\u6295\u8D44\u8005",
  "\u975E\u91D1\u878D\u7C7B\u4E0A\u5E02\u516C\u53F8"
]);
function isAggregateSeatRow(name) {
  return AGGREGATE_ROW_NAMES.has(String(name || "").trim());
}
function seatsOf(detailMap, code) {
  const raw = detailMap && code != null ? detailMap[code] : null;
  if (!raw) return { b: [], s: [], hasSell: false };
  if (Array.isArray(raw)) return { b: raw.map(normPair).filter(keepSeat), s: [], hasSell: false };
  const b = Array.isArray(raw.b) ? raw.b.map(normPair).filter(keepSeat) : [];
  const s = Array.isArray(raw.s) ? raw.s.map(normPair).filter(keepSeat) : [];
  return { b, s, hasSell: s.length > 0 };
}
var keepSeat = ([nm]) => !isAggregateSeatRow(nm);
var normPair = (p) => Array.isArray(p) ? [String(p[0] ?? ""), Number(p[1]) || 0] : [String(p?.name ?? ""), Number(p?.v ?? p?.amount ?? 0) || 0];
function buySeatsOf(detailMap, code) {
  return seatsOf(detailMap, code).b.slice().sort((x, y) => y[1] - x[1]);
}
function sellSeatsOf(detailMap, code) {
  return seatsOf(detailMap, code).s.slice().sort((x, y) => y[1] - x[1]);
}
function sideStats(pairs) {
  const rows = Array.isArray(pairs) ? pairs : [];
  const sum = rows.reduce((a, x) => a + (Number(x[1]) || 0), 0);
  const top3 = rows.slice().sort((x, y) => y[1] - x[1]).slice(0, 3).reduce((a, x) => a + (Number(x[1]) || 0), 0);
  return { n: rows.length, sum, top3Pct: sum > 0 ? top3 / sum * 100 : null };
}
function brokerOf(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  if (/机构专用/.test(s) || /(沪|深)股通/.test(s)) return "";
  const INST = "\u8D44\u4EA7\u7BA1\u7406|\u8BC1\u5238|\u57FA\u91D1|\u8D44\u7BA1|\u671F\u8D27";
  const TAIL = "(?:\u80A1\u4EFD)?\u6709\u9650(?:\u8D23\u4EFB)?\u516C\u53F8|\u7BA1\u7406|\u63A7\u80A1";
  const m = s.match(new RegExp("^(.{2,30}?(?:" + INST + "))(?:" + TAIL + "|\\(|\uFF08|$)"));
  if (m) return m[1].trim();
  const m2 = s.match(/^(.{2,30}?)(?:股份有限公司|有限责任公司|有限公司)/);
  if (m2) return m2[1].trim();
  return s.slice(0, 6);
}
function seatTypeOf(name) {
  const s = String(name || "").trim();
  if (!s) return "other";
  if (/机构专用/.test(s)) return "inst";
  if (/(沪|深)股通/.test(s)) return "north";
  if (/总部/.test(s) || /自营/.test(s) || /证券投资部/.test(s)) return "prop";
  if (/营业部/.test(s)) return "sales";
  if (/分公司|分公司$/.test(s)) return "branch";
  if (/证券|基金|资管/.test(s)) return "sales";
  return "other";
}
var SEAT_TYPE_LABEL = {
  inst: "\u673A\u6784\u4E13\u7528",
  north: "\u6CAA\u6DF1\u80A1\u901A",
  prop: "\u5238\u5546\u603B\u90E8/\u81EA\u8425",
  branch: "\u5206\u516C\u53F8",
  sales: "\u8BC1\u5238\u8425\u4E1A\u90E8",
  other: "\u5176\u4ED6"
};
var FOREIGN_BROKERS = ["\u9AD8\u76DB", "\u745E\u94F6", "\u6469\u6839", "\u745E\u4FE1", "\u91CE\u6751", "\u5927\u548C", "\u6C47\u4E30", "\u82B1\u65D7", "\u5FB7\u610F\u5FD7", "\u661F\u5C55", "\u6CD5\u5174", "\u5DF4\u9ECE"];
function isForeignBroker(name) {
  const b = brokerOf(name) || String(name || "");
  return FOREIGN_BROKERS.some((f) => b.includes(f));
}
var CITY_LIST = [
  // 直辖市
  "\u5317\u4EAC",
  "\u4E0A\u6D77",
  "\u5929\u6D25",
  "\u91CD\u5E86",
  // 计划单列市
  "\u6DF1\u5733",
  "\u5B81\u6CE2",
  "\u9752\u5C9B",
  "\u5927\u8FDE",
  "\u53A6\u95E8",
  // 省会
  "\u5E7F\u5DDE",
  "\u676D\u5DDE",
  "\u5357\u4EAC",
  "\u6B66\u6C49",
  "\u6210\u90FD",
  "\u897F\u5B89",
  "\u957F\u6C99",
  "\u90D1\u5DDE",
  "\u6D4E\u5357",
  "\u5408\u80A5",
  "\u798F\u5DDE",
  "\u6606\u660E",
  "\u5357\u660C",
  "\u8D35\u9633",
  "\u5357\u5B81",
  "\u5170\u5DDE",
  "\u592A\u539F",
  "\u77F3\u5BB6\u5E84",
  "\u6C88\u9633",
  "\u54C8\u5C14\u6EE8",
  "\u957F\u6625",
  "\u547C\u548C\u6D69\u7279",
  "\u94F6\u5DDD",
  "\u897F\u5B81",
  "\u4E4C\u9C81\u6728\u9F50",
  "\u6D77\u53E3",
  "\u62C9\u8428",
  // 主要地级市 / 江浙沪粤等营业部密集城市
  "\u82CF\u5DDE",
  "\u65E0\u9521",
  "\u5E38\u5DDE",
  "\u5357\u901A",
  "\u5F90\u5DDE",
  "\u626C\u5DDE",
  "\u76D0\u57CE",
  "\u6CF0\u5DDE",
  "\u9547\u6C5F",
  "\u6DEE\u5B89",
  "\u8FDE\u4E91\u6E2F",
  "\u5BBF\u8FC1",
  "\u6E29\u5DDE",
  "\u5609\u5174",
  "\u7ECD\u5174",
  "\u91D1\u534E",
  "\u53F0\u5DDE",
  "\u6E56\u5DDE",
  "\u4E3D\u6C34",
  "\u8862\u5DDE",
  "\u821F\u5C71",
  "\u4E1C\u839E",
  "\u4F5B\u5C71",
  "\u73E0\u6D77",
  "\u4E2D\u5C71",
  "\u60E0\u5DDE",
  "\u6C5F\u95E8",
  "\u6C55\u5934",
  "\u6E5B\u6C5F",
  "\u8087\u5E86",
  "\u6CC9\u5DDE",
  "\u6F33\u5DDE",
  "\u8386\u7530",
  "\u9F99\u5CA9",
  "\u4E09\u660E",
  "\u5357\u5E73",
  "\u5B81\u5FB7",
  "\u70DF\u53F0",
  "\u6F4D\u574A",
  "\u4E34\u6C82",
  "\u6DC4\u535A",
  "\u6D4E\u5B81",
  "\u6CF0\u5B89",
  "\u5A01\u6D77",
  "\u4E1C\u8425",
  "\u65E5\u7167",
  "\u6D1B\u9633",
  "\u5F00\u5C01",
  "\u65B0\u4E61",
  "\u5357\u9633",
  "\u8BB8\u660C",
  "\u7126\u4F5C",
  "\u5B89\u9633",
  "\u5E73\u9876\u5C71",
  "\u5546\u4E18",
  "\u4FE1\u9633",
  "\u5468\u53E3",
  "\u9A7B\u9A6C\u5E97",
  "\u6F2F\u6CB3",
  "\u4E09\u95E8\u5CE1",
  "\u8944\u9633",
  "\u5B9C\u660C",
  "\u8346\u5DDE",
  "\u9EC4\u77F3",
  "\u5341\u5830",
  "\u8346\u95E8",
  "\u5B5D\u611F",
  "\u5CB3\u9633",
  "\u682A\u6D32",
  "\u6E58\u6F6D",
  "\u8861\u9633",
  "\u5E38\u5FB7",
  "\u90F4\u5DDE",
  "\u7EF5\u9633",
  "\u5FB7\u9633",
  "\u5B9C\u5BBE",
  "\u6CF8\u5DDE",
  "\u5357\u5145",
  "\u4E50\u5C71",
  "\u81EA\u8D21",
  "\u5185\u6C5F",
  "\u9042\u5B81",
  "\u7709\u5C71",
  "\u9075\u4E49",
  "\u516D\u76D8\u6C34",
  "\u66F2\u9756",
  "\u7389\u6EAA",
  "\u5927\u7406",
  "\u6842\u6797",
  "\u67F3\u5DDE",
  "\u5317\u6D77",
  "\u68A7\u5DDE",
  "\u7389\u6797",
  "\u6E5B\u6C5F",
  "\u5B9D\u9E21",
  "\u54B8\u9633",
  "\u6E2D\u5357",
  "\u6986\u6797",
  "\u5EF6\u5B89",
  "\u6C49\u4E2D",
  "\u5510\u5C71",
  "\u4FDD\u5B9A",
  "\u5ECA\u574A",
  "\u6CA7\u5DDE",
  "\u90AF\u90F8",
  "\u90A2\u53F0",
  "\u8861\u6C34",
  "\u79E6\u7687\u5C9B",
  "\u5F20\u5BB6\u53E3",
  "\u627F\u5FB7",
  "\u5927\u540C",
  "\u4E34\u6C7E",
  "\u8FD0\u57CE",
  "\u957F\u6CBB",
  "\u5305\u5934",
  "\u9102\u5C14\u591A\u65AF",
  "\u978D\u5C71",
  "\u629A\u987A",
  "\u672C\u6EAA",
  "\u9526\u5DDE",
  "\u8425\u53E3",
  "\u76D8\u9526",
  "\u5409\u6797",
  "\u9F50\u9F50\u54C8\u5C14",
  "\u5927\u5E86",
  "\u7261\u4E39\u6C5F",
  "\u829C\u6E56",
  "\u868C\u57E0",
  "\u5B89\u5E86",
  "\u9A6C\u978D\u5C71",
  "\u961C\u9633",
  "\u5BBF\u5DDE",
  "\u516D\u5B89",
  "\u6EC1\u5DDE",
  "\u5BA3\u57CE",
  "\u94DC\u9675",
  "\u9EC4\u5C71",
  "\u4E5D\u6C5F",
  "\u8D63\u5DDE",
  "\u4E0A\u9976",
  "\u5B9C\u6625",
  "\u5409\u5B89",
  "\u629A\u5DDE",
  "\u666F\u5FB7\u9547",
  "\u840D\u4E61",
  "\u65B0\u4F59",
  "\u9E70\u6F6D",
  "\u4E09\u4E9A",
  "\u510B\u5DDE"
];
var CITY_SORTED = CITY_LIST.slice().sort((a, b) => b.length - a.length);
function findCity(s) {
  let best = null;
  let bestPos = Infinity;
  for (const c of CITY_SORTED) {
    const p = s.indexOf(c);
    if (p === -1) continue;
    if (p < bestPos || p === bestPos && best && c.length > best.length) {
      best = c;
      bestPos = p;
    }
  }
  return best || "";
}
function cityOf(name) {
  const s = String(name || "").trim();
  if (!s || /机构专用|(沪|深)股通/.test(s)) return "";
  let seg = s.replace(new RegExp("^(.*?(?:\u8D44\u4EA7\u7BA1\u7406|\u8BC1\u5238|\u57FA\u91D1|\u8D44\u7BA1|\u671F\u8D27))(?:(?:\u80A1\u4EFD)?\u6709\u9650(?:\u8D23\u4EFB)?\u516C\u53F8|\u7BA1\u7406|\u63A7\u80A1|$)"), "");
  if (!seg) seg = s;
  seg = seg.replace(/^[（(][^）)]*[）)]/, "");
  return findCity(seg);
}
function seatIdentity(name) {
  const s = String(name || "").trim();
  const type = seatTypeOf(s);
  return {
    name: s,
    broker: brokerOf(s),
    type,
    typeLabel: SEAT_TYPE_LABEL[type] || "\u5176\u4ED6",
    foreign: isForeignBroker(s),
    city: cityOf(s)
  };
}

// src/paper_review.js
var paper_review_exports = {};
__export(paper_review_exports, {
  ADVICE_LEVELS: () => ADVICE_LEVELS,
  MARKET_CFG: () => MARKET_CFG,
  POS_CFG: () => POS_CFG,
  REVIEW_CFG: () => REVIEW_CFG,
  REVIEW_TITLE: () => REVIEW_TITLE,
  REVIEW_VERSION: () => REVIEW_VERSION,
  TIER_THRESHOLDS: () => TIER_THRESHOLDS,
  buildAdvice: () => buildAdvice,
  buildPaperReview: () => buildPaperReview,
  reviewAccount: () => reviewAccount,
  reviewPositions: () => reviewPositions,
  reviewTrades: () => reviewTrades
});

// src/limit_caliber.js
var LIMIT_CALIBER = Object.freeze({
  OLD: "v5.2-pro-old-limit",
  FIX: "v5.2-pro-fix-limit"
});
function limitUpPct({ code = "", name = "" } = {}) {
  const c = String(code ?? "").replace(/\D/g, "").padStart(6, "0");
  const n = String(name ?? "");
  if (/^(4|8|920)/.test(c)) return 30;
  if (/ST/i.test(n)) return 5;
  if (/^(688|689)/.test(c)) return 20;
  if (/^(300|301)/.test(c)) return 20;
  return 10;
}
function isLimitUp(chgPct, stock = {}, tolerance = 0.5) {
  const x = +chgPct;
  if (!Number.isFinite(x)) return false;
  return x >= limitUpPct(stock) - tolerance;
}

// src/lhb.js
var RANGE_BOARD_RE = /连续\s*[0-9一二三四五六七八九十]+\s*个交易日|严重异常期间/;
var NEW_STOCK_RE = /无价格涨跌幅限制/;
function isNewStock(l) {
  if (!l) return false;
  const list = Array.isArray(l.reasons) && l.reasons.length ? l.reasons : [l.reason || ""];
  return list.some((r) => NEW_STOCK_RE.test(String(r)));
}

// src/admission.js
var MAIN_BOARD_PREFIX = /^(00|60)/;
var RISK_NAME_RE = /(^|\s)\*?ST(?![A-Za-z])|退/;
var ETF_ALLOWLIST = ["510880", "511010"];
function isRiskName(name) {
  return RISK_NAME_RE.test(String(name || ""));
}
function isAdmissible(code, name, klineDays, opts = {}) {
  const c = String(code || "");
  if (opts.allowEtfs && ETF_ALLOWLIST.includes(c)) return true;
  if (!MAIN_BOARD_PREFIX.test(c)) return false;
  if (isRiskName(name)) return false;
  if (Number.isFinite(klineDays) && klineDays < 5) return false;
  return true;
}

// src/lhbfilter.js
var LHBFILTER_VERSION = "lhbfilter-v1";
var MAX_SHARE_OF_MARKET = 0.25;
var MAX_TOP3_CONC = 75;
var MAX_TOP3_CONC_STRICT = 80;
var ADMIT = {
  netBuyRate: 0.04,
  // 龙虎净买率 ≥4%（分母口径见文件头「数据边界①」）
  top3ConcMax: 0.75
  // 买方前三席位集中度 ≤75%
};
var REJECT_LHB = {
  NEW_STOCK: "\u4E0A\u5E025\u65E5\u5185\u65E0\u6DA8\u8DCC\u5E45\u9650\u5236\u80A1\u7968",
  SHARE_TOO_HIGH: "\u9F99\u864E\u51C0\u4E70\u5360\u5168\u5E02\u573A\u9F99\u864E\u603B\u51C0\u989D > 25%",
  HOT_ONLY_AND_CONC: "\u4E70\u65B9\u4EC5\u6E38\u8D44\uFF08\u673A\u6784\u4E0E\u5317\u5411\u5747\u51C0\u5356\u51FA\uFF09\u4E14\u4E70\u65B9\u524D\u4E09\u5E2D\u4F4D\u96C6\u4E2D\u5EA6 > 80%",
  NET_BUY_RATE_TOO_LOW: "\u9F99\u864E\u51C0\u4E70\u7387\u4F4E\u4E8E\u51C6\u5165\u95E8\u69DB\uFF08\u89C4\u5219\u2466\u8054\u52A8\u6761\u6B3E\uFF09",
  THEME_TOO_WEAK: "\u4E3B\u7EBF\u9898\u6750\u5F3A\u5EA6\u5206 < 0.5"
};
var LHB_NET_OUTFLOW_PENALTY = {
  SCORE: 10,
  // picks.js 综合分扣减（0~100 分制），减法后夹在 0~100
  PROB: 8
  // predict.js 上涨概率扣减（百分点；基准 55.3，多数票落在 55~72）
};
var FLAG_LHB = {
  NET_OUTFLOW: "\u26A0\u9F99\u864E\u5F53\u65E5\u8D44\u91D1\u51C0\u6D41\u51FA\uFF0C\u8C28\u614E\u5F00\u4ED3"
};
function isNetOutflow(netWan) {
  if (netWan == null || !Number.isFinite(+netWan)) return { hit: true, kind: "null", value: null };
  const v = +netWan;
  if (v < 0) return { hit: true, kind: "negative", value: v };
  if (v === 0) return { hit: true, kind: "zero", value: 0 };
  return { hit: false, kind: null, value: v };
}
function netOutflowText(f) {
  const v = f && f.netWan;
  const head = v == null ? "\u5F53\u65E5\u9F99\u864E\u699C\u65E0\u51C0\u4E70\u8BB0\u5F55" : v < 0 ? `\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70 ${(Math.abs(+v) / 1e4).toFixed(2)} \u4EBF\uFF08\u8D44\u91D1\u51C0\u6D41\u51FA\uFF09` : "\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70\u4E3A 0";
  return `${FLAG_LHB.NET_OUTFLOW} \u2014\u2014 ${head}\uFF0C\u6A21\u578B\u6253\u5206\u5DF2\u6263 \u7EFC\u5408\u5206 ${LHB_NET_OUTFLOW_PENALTY.SCORE} \u5206 / \u4E0A\u6DA8\u6982\u7387 ${LHB_NET_OUTFLOW_PENALTY.PROB} \u4E2A\u767E\u5206\u70B9\uFF08\u964D\u4F4E\u5165\u9009\u4F18\u5148\u7EA7\uFF0C\u4E0D\u7981\u6B62\u59D4\u6258\uFF09\uFF1B\u8BF7\u4EBA\u5DE5\u590D\u6838\u540E\u518D\u51B3\u5B9A\u662F\u5426\u5F00\u4ED3\u3002`;
}
var SKIPPED_RULES = {
  LOCKUP_RATIO: "\u9501\u4ED3\u8D44\u91D1\u5360\u5F53\u65E5\u4E70\u5165\u6BD4\u4F8B\u2014\u2014\u5B58\u6863\u65E0\u300C\u9501\u4ED3\u300D\u5B9A\u4E49\u4E0E\u5B57\u6BB5\uFF0C\u9700\u8DE8\u65E5\u5E2D\u4F4D\u6BD4\u5BF9\uFF0C\u672C\u7CFB\u7EDF\u4EC5\u6709\u5355\u65E5\u660E\u7EC6",
  GAIN_60D: "\u8FD160\u65E5\u6DA8\u5E45\u2014\u2014\u5B58\u6863\u4EC5 33 \u4E2A\u4EA4\u6613\u65E5\uFF0C\u7269\u7406\u4E0A\u7B97\u4E0D\u51FA 60 \u4EA4\u6613\u65E5\u6DA8\u5E45"
};
var BUCKET = {
  MAIN: "main",
  // 主候选池：可自动下单
  WATCH: "watch",
  // 备选观察池：仅页面展示，禁止自动下单
  REJECTED: "rejected"
  // 被强制剔除：禁止生成买入委托
};
var finite = (v) => v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(+v);
var r2 = (v) => Math.round(v * 100) / 100;
var r3 = (v) => Math.round(v * 1e3) / 1e3;
function featuresOf(code, day) {
  const c = String(code || "");
  if (!c) return null;
  const d = day || {};
  const s = d.summary || {};
  const rows = Array.isArray(d.lhb) ? d.lhb : [];
  const daily = rows.filter((l) => {
    if (!l || String(l.code) !== c) return false;
    const isRange = l.is_range != null ? !!l.is_range : RANGE_BOARD_RE.test(String(l.reason || ""));
    return !isRange;
  });
  let rec = null;
  if (daily.length) {
    rec = daily.slice().sort((a, b) => Math.abs(b.net_buy_wan || 0) - Math.abs(a.net_buy_wan || 0))[0];
  }
  const lhbRow = rows.find((l) => l && String(l.code) === c) || null;
  const isNew = lhbRow ? isNewStock(lhbRow) : false;
  const hot = (Array.isArray(d.hot) ? d.hot : []).find((h) => h && String(h.code) === c) || null;
  const ztCodes = new Set(Array.isArray(s.zt_codes) ? s.zt_codes.map(String) : []);
  const isZt = ztCodes.has(c);
  const detail = (s.seats || {}).detail || null;
  const buySeats = buySeatsOf(detail, c);
  const sellSeats = sellSeatsOf(detail, c);
  const buySide = sideStats(buySeats);
  const sellSide = sideStats(sellSeats);
  const byType = (pairs) => {
    const out2 = { inst: 0, north: 0, hot: 0 };
    for (const [nm, amt] of pairs) {
      const t = seatTypeOf(nm);
      if (t === "inst") out2.inst += Number(amt) || 0;
      else if (t === "north") out2.north += Number(amt) || 0;
      else out2.hot += Number(amt) || 0;
    }
    return out2;
  };
  const buyByType = byType(buySeats);
  const sellByType = byType(sellSeats);
  const netWan = rec ? +rec.net_buy_wan || 0 : null;
  const buyWan = rec ? +rec.buy_wan || 0 : null;
  const sellWan = rec ? +rec.sell_wan || 0 : null;
  const lhbAmtWan = (buyWan || 0) + (sellWan || 0);
  return {
    code: c,
    name: rec && rec.name || lhbRow && lhbRow.name || hot && hot.name || c,
    onLhb: !!(rec || lhbRow),
    isNewStock: isNew,
    // 当日涨停（当日榜名单口径）。无龙虎记录但涨停的票仍算「有真实依据」——
    // 降级规则据此把它与「查无此票」区分开。
    isZt,
    netWan,
    buyWan,
    sellWan,
    lhbAmtWan,
    // 净买率（分母 = 龙虎榜成交额，口径见文件头①）
    netBuyRate: lhbAmtWan > 0 && netWan != null ? r3(netWan / lhbAmtWan) : null,
    buyTop3Pct: buySide.top3Pct != null ? r2(buySide.top3Pct) : null,
    buySeatCount: buySide.n,
    sellSeatCount: sellSide.n,
    hasSellDetail: sellSeats.length > 0,
    buyByType: { inst: r2(buyByType.inst), north: r2(buyByType.north), hot: r2(buyByType.hot) },
    sellByType: { inst: r2(sellByType.inst), north: r2(sellByType.north), hot: r2(sellByType.hot) },
    // 机构/北向 净买（万元）：只用逐票明细，无明细时回退 null（不猜）
    instNetWan: sellSeats.length ? r2(buyByType.inst - sellByType.inst) : null,
    northNetWan: sellSeats.length ? r2(buyByType.north - sellByType.north) : null,
    hotNetWan: sellSeats.length ? r2(buyByType.hot - sellByType.hot) : null,
    changePct: finite(rec?.change_pct) ? +rec.change_pct : finite(hot?.change_pct) ? +hot.change_pct : null,
    turnoverPct: finite(rec?.turnover_pct) ? +rec.turnover_pct : finite(hot?.huanshou) ? +hot.huanshou : null,
    reason: rec && rec.reason || lhbRow && lhbRow.reason || hot && hot.reason || "",
    close: finite(rec?.close) ? +rec.close : finite(hot?.close) ? +hot.close : null
  };
}
var THEME_FULL_PCT = 20;
function themeStrengthOf(day) {
  const mt = (day?.summary || {}).main_theme;
  if (!mt || !mt.name) return null;
  const pct2 = finite(mt.pct) ? +mt.pct : null;
  const yi2 = finite(mt.main_yi) ? +mt.main_yi : null;
  const tot = finite(mt.tot_yi) ? +mt.tot_yi : null;
  if (yi2 != null && yi2 <= 0) return 0;
  if (tot != null && tot <= 0) return null;
  if (pct2 == null) return null;
  return r3(Math.max(0, Math.min(1, pct2 / THEME_FULL_PCT)));
}
function filterOne(code, day, opts = {}) {
  const f = featuresOf(code, day);
  const skipped = [
    { key: "LOCKUP_RATIO", text: SKIPPED_RULES.LOCKUP_RATIO, blocking: false },
    { key: "GAIN_60D", text: SKIPPED_RULES.GAIN_60D, blocking: false }
  ];
  if (!f) {
    return {
      code: String(code || ""),
      name: String(code || ""),
      bucket: BUCKET.REJECTED,
      passed: false,
      rejectedBy: [{ code: "NO_RECORD", text: "\u5F53\u65E5\u5B58\u6863\u65E0\u8BE5\u6807\u7684\u4EFB\u4F55\u8BB0\u5F55", value: null }],
      admit: { met: [], unmet: [] },
      skipped,
      features: null,
      themeStrength: null,
      text: "\u65E0\u5F53\u65E5\u8BB0\u5F55\uFF0C\u7981\u6B62\u751F\u6210\u4E70\u5165\u59D4\u6258\u3002"
    };
  }
  const s = day?.summary || {};
  const skipSeatRules = opts.skipSeatRules === true;
  const marketNetWan = finite(opts.marketNetWan) ? +opts.marketNetWan : finite(s.lhb_daily_net) ? +s.lhb_daily_net * 1e4 : null;
  const themeStrength = themeStrengthOf(day);
  const rejectedBy = [];
  const push = (code_, text2, value) => rejectedBy.push({ code: code_, text: text2, value });
  if (f.isNewStock) push("NEW_STOCK", REJECT_LHB.NEW_STOCK, f.reason);
  const klineDays = day && day.klineLens && day.klineLens[code] != null ? day.klineLens[code] : void 0;
  if (!isAdmissible(code, f.name, klineDays, { allowEtfs: true })) {
    push("NON_ADMISSIBLE", "\u5B9E\u76D8\u6743\u9650\uFF1A\u4EC5\u4E3B\u677F(00/60)\u53EF\u4EA4\u6613\uFF0C\u5254\u9664\u5317\u4EA4\u6240/\u521B\u4E1A\u677F/\u79D1\u521B\u677F/ST/\u9000\uFF08ETF 510880/511010 \u9664\u5916\uFF09", f.name);
  }
  const outflow = isNetOutflow(f.netWan);
  const hasAnyRecord = f.onLhb || f.isZt === true;
  const netOutflow = outflow.hit && hasAnyRecord ? { code: "NET_BUY_NON_POSITIVE", kind: outflow.kind, value: outflow.value, text: netOutflowText(f) } : null;
  if (outflow.hit && !hasAnyRecord) {
    push("NO_RECORD", "\u5F53\u65E5\u5F52\u6863\u65E0\u8BE5\u6807\u7684\u4EFB\u4F55\u8BB0\u5F55\uFF08\u9F99\u864E\u699C\u4E0E\u6DA8\u505C\u540D\u5355\u5747\u65E0\uFF09", null);
  }
  let sharePct = null;
  if (!skipSeatRules && marketNetWan != null && marketNetWan > 0 && f.netWan != null) {
    sharePct = f.netWan / marketNetWan;
    if (sharePct > MAX_SHARE_OF_MARKET) {
      push("SHARE_TOO_HIGH", REJECT_LHB.SHARE_TOO_HIGH, r3(sharePct * 100));
    }
  }
  let hotOnlyConc = null;
  if (!skipSeatRules && f.hasSellDetail && f.instNetWan != null && f.northNetWan != null && f.hotNetWan != null) {
    const instOut = f.instNetWan <= 0;
    const northOut = f.northNetWan <= 0;
    const hotIn = f.hotNetWan > 0;
    const conc = f.buyTop3Pct;
    if (instOut && northOut && hotIn && conc != null && conc > MAX_TOP3_CONC_STRICT) {
      hotOnlyConc = { inst: f.instNetWan, north: f.northNetWan, hot: f.hotNetWan, conc };
      push("HOT_ONLY_AND_CONC", REJECT_LHB.HOT_ONLY_AND_CONC, r2(conc));
    }
  } else {
    skipped.push({
      key: "HOT_ONLY_AND_CONC",
      blocking: false,
      text: "\u4E70\u65B9\u4EC5\u6E38\u8D44\u4E14\u96C6\u4E2D\u5EA6>80% \u7684\u5224\u5B9A\uFF1A\u8BE5\u7968\u7F3A\u53CC\u4FA7\u5E2D\u4F4D\u660E\u7EC6\uFF08\u5B58\u6863\u4EC5\u6709\u4E70\u65B9\uFF09\uFF0C\u65E0\u6CD5\u5224\u5B9A\u673A\u6784/\u5317\u5411\u51C0\u5356\u51FA"
    });
  }
  if (themeStrength != null && themeStrength < 0.5) {
    push("THEME_TOO_WEAK", REJECT_LHB.THEME_TOO_WEAK, themeStrength);
  } else if (themeStrength == null) {
    skipped.push({ key: "THEME_TOO_WEAK", blocking: false, text: "\u4E3B\u7EBF\u9898\u6750\u5F3A\u5EA6\u5206\u7F3A\u5931\uFF08\u5F53\u65E5\u65E0\u4E3B\u7EBF\u5224\u5B9A\uFF09\uFF0C\u8BE5\u6761\u672A\u751F\u6548" });
  }
  const passed = rejectedBy.length === 0;
  const met = [], unmet = [];
  const check = (key, label, ok, value) => (ok ? met : unmet).push({ key, label, ok: !!ok, value });
  check(
    "netBuyRate",
    `\u9F99\u864E\u51C0\u4E70\u7387 \u2265${ADMIT.netBuyRate * 100}%`,
    f.netBuyRate != null && f.netBuyRate >= ADMIT.netBuyRate,
    f.netBuyRate != null ? r3(f.netBuyRate * 100) + "%" : null
  );
  const lockupSkipped = skipped.find((s2) => s2.key === "LOCKUP_RATIO");
  if (lockupSkipped) lockupSkipped.text += "\uFF08\u51C6\u5165\u6761\u4EF6\u540C\u6B64\uFF0C\u672A\u8BA1\u5165\u672A\u6EE1\u8DB3\u9879\uFF09";
  check(
    "top3Conc",
    `\u4E70\u65B9\u524D\u4E09\u5E2D\u4F4D\u96C6\u4E2D\u5EA6 \u2264${MAX_TOP3_CONC}%`,
    f.buyTop3Pct != null && f.buyTop3Pct <= MAX_TOP3_CONC,
    f.buyTop3Pct != null ? r2(f.buyTop3Pct) + "%" : null
  );
  check(
    "instOrNorth",
    "\u673A\u6784\u51C0\u4E70 >0 \u6216 \u5317\u5411\u51C0\u4E70 >0",
    f.instNetWan != null && f.instNetWan > 0 || f.northNetWan != null && f.northNetWan > 0,
    f.hasSellDetail ? `\u673A\u6784 ${f.instNetWan} / \u5317\u5411 ${f.northNetWan} \u4E07` : "\u65E0\u53CC\u4FA7\u5E2D\u4F4D\u660E\u7EC6"
  );
  const allAdmit = unmet.length === 0;
  let bucket, text;
  if (!passed) {
    bucket = BUCKET.REJECTED;
    text = "\u5F3A\u5236\u5254\u9664\uFF1A" + rejectedBy.map((x) => x.text).join("\uFF1B") + "\u3002\u7981\u6B62\u751F\u6210\u4E70\u5165\u59D4\u6258\u3002";
  } else if (netOutflow) {
    bucket = BUCKET.WATCH;
    text = `\u964D\u7EA7\uFF08\u4E0D\u963B\u65AD\uFF09\uFF1A\u9F99\u864E\u699C\u51C0\u4E70\u5165 \u2264 0 \u2014\u2014 \u5DF2\u6263\u7EFC\u5408\u5206 ${LHB_NET_OUTFLOW_PENALTY.SCORE} \u5206 / \u4E0A\u6DA8\u6982\u7387 ${LHB_NET_OUTFLOW_PENALTY.PROB} \u4E2A\u767E\u5206\u70B9\uFF0C\u8FDB\u5165\u5907\u9009\u89C2\u5BDF\u6C60\uFF08\u7981\u6B62\u81EA\u52A8\u4E0B\u5355\uFF09\uFF1B${FLAG_LHB.NET_OUTFLOW}\uFF0C\u4EBA\u5DE5\u590D\u6838\u540E\u65B9\u53EF\u4E0B\u5355\u3002`;
  } else if (allAdmit) {
    bucket = BUCKET.MAIN;
    text = "\u901A\u8FC7\u5168\u90E8\u5F3A\u5236\u5254\u9664\u4E0E\u51C6\u5165\u6761\u4EF6\uFF0C\u8FDB\u5165\u4E3B\u5019\u9009\u6C60\uFF08\u53EF\u81EA\u52A8\u4E0B\u5355\uFF09\u3002";
  } else {
    bucket = BUCKET.WATCH;
    text = "\u901A\u8FC7\u5F3A\u5236\u5254\u9664\uFF0C\u4F46\u672A\u6EE1\u8DB3\u51C6\u5165\u6761\u4EF6\uFF08" + unmet.map((x) => x.label).join("\uFF1B") + "\uFF09\uFF0C\u4EC5\u9875\u9762\u5C55\u793A\u3001\u7981\u6B62\u81EA\u52A8\u4E0B\u5355\u3002";
  }
  return {
    code: f.code,
    name: f.name,
    bucket,
    passed,
    rejectedBy,
    admit: { met, unmet, all: allAdmit },
    // 降级规则（不阻断）：命中 = 该票被打告警标签 + 扣分 + 强制人工复核。
    // needReview 恒为 true（命中即复核），单列一个字段是为了让 UI 不必
    // 自己判断「哪些命中项属于降级类」——那是规则，不是渲染。
    netOutflow,
    flags: netOutflow ? [netOutflow.text] : [],
    needReview: !!netOutflow,
    skipped,
    features: f,
    themeStrength,
    sharePct: sharePct != null ? r3(sharePct * 100) : null,
    hotOnlyConc,
    text
  };
}

// src/predict.js
var PREDICT_VERSION = "predict-v2";
var finite2 = (v) => v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(+v);
var PROB_BANDS = [
  { min: 65, key: "high", label: "\u8F83\u9AD8", desc: "\u5386\u53F2\u540C\u7279\u5F81\u7EC4\u4E0A\u6DA8\u5360\u6BD4 \u226565%" },
  { min: 57, key: "mid", label: "\u4E2D\u7B49", desc: "\u5386\u53F2\u540C\u7279\u5F81\u7EC4\u4E0A\u6DA8\u5360\u6BD4 57%~65%" },
  { min: 50, key: "low", label: "\u504F\u4F4E", desc: "\u5386\u53F2\u540C\u7279\u5F81\u7EC4\u4E0A\u6DA8\u5360\u6BD4 50%~57%" },
  { min: 0, key: "poor", label: "\u4E0D\u4F73", desc: "\u5386\u53F2\u540C\u7279\u5F81\u7EC4\u4E0A\u6DA8\u5360\u6BD4 <50%" }
];
function probBand(score) {
  if (!Number.isFinite(+score)) return PROB_BANDS[PROB_BANDS.length - 1];
  const s = +score;
  for (const b of PROB_BANDS) if (s >= b.min) return b;
  return PROB_BANDS[PROB_BANDS.length - 1];
}
var REJECT_RULES = [
  {
    key: "high_turnover",
    label: "\u6362\u624B\u8FC7\u9AD8",
    test: (c) => finite2(c && c.turnoverPct) && +c.turnoverPct >= 25,
    why: "\u6362\u624B \u226525% \u7684\u6DA8\u505C\u80A1 T+1 \u5747\u6536\u76CA\u4EC5 +0.65%\u3001\u4E0A\u6DA8\u5360\u6BD4 46.2%\uFF0CT+3 \u8F6C\u4E3A \u22122.65%\uFF1B3 \u65E5\u5185\u5E73\u5747\u6700\u5927\u56DE\u64A4 \u22128.40%\uFF08\u662F\u4F4E\u6362\u624B\u7EC4\u7684 2 \u500D\uFF09\u3002\u7B79\u7801\u9AD8\u5EA6\u6DA3\u6563\uFF0C\u5151\u73B0\u538B\u529B\u5927\u3002",
    stat: { n: 78, t1: 0.65, t3: -2.65, up: 46.2, dd: -8.4 }
  },
  {
    key: "high_streak",
    label: "\u8FDE\u677F\u8FC7\u9AD8",
    test: (c) => finite2(c && c.streak) && +c.streak >= 5,
    why: "5 \u8FDE\u677F\u53CA\u4EE5\u4E0A\u6837\u672C\u6781\u5C11\uFF08\u5168\u6863\u4EC5 10 \u4F8B\uFF09\u4E14\u79BB\u6563\u5EA6\u6781\u5927\uFF0CT+1 \u8868\u73B0\u65E0\u6CD5\u4E0E\u300C\u968F\u673A\u300D\u533A\u5206\uFF1B\u9AD8\u4F4D\u65AD\u677F\u5F53\u65E5\u56DE\u64A4\u53EF\u8FBE \u221220%\uFF0C\u5355\u7B14\u6B62\u635F \u22128% \u65E0\u6CD5\u8986\u76D6\u8DF3\u7A7A\u7F3A\u53E3\u3002\u6837\u672C\u4E0D\u8DB3\u5373\u4E0D\u53EF\u4F9D\u8D56\u3002",
    stat: { n: 10, t1: null, t3: null, up: null, dd: null }
  },
  {
    key: "bj_board",
    label: "\u5317\u4EA4\u6240\u6807\u7684",
    test: (c) => /^(4|8|920)/.test(String(c && c.code || "")),
    why: "\u5317\u4EA4\u6240 \xB130% \u6DA8\u8DCC\u5E45\u3001\u6D41\u52A8\u6027\u663E\u8457\u5F31\u4E8E\u6CAA\u6DF1\uFF0C\u4EF7\u683C\u51B2\u51FB\u6210\u672C\u9AD8\uFF0C\u4E14\u672C\u6A21\u62DF\u5668\u7684\u677F\u6BB5\u5224\u5B9A\u53E3\u5F84\u4E0D\u9002\u7528\u3002",
    stat: { n: 0, t1: null, t3: null, up: null, dd: null }
  },
  {
    key: "st_stock",
    label: "ST / *ST",
    test: (c) => /ST/i.test(String(c && c.name || "")),
    why: "ST \u80A1 \xB15% \u6DA8\u8DCC\u5E45\u4E0E\u6B63\u5E38\u80A1\u4E0D\u53EF\u6BD4\uFF0C\u4E14\u5B58\u5728\u9000\u5E02\u98CE\u9669\uFF0C\u4E0D\u9002\u5408\u4F5C\u4E3A\u6A21\u62DF\u76D8\u8BAD\u7EC3\u6807\u7684\u3002",
    stat: { n: 0, t1: null, t3: null, up: null, dd: null }
  },
  {
    key: "no_limit_evidence",
    label: "\u65E0\u6DA8\u505C\u4E5F\u65E0\u6709\u6548\u51C0\u4E70",
    test: (c) => !c || !c.isZt && !(finite2(c && c.netWan) && +c.netWan > 0),
    why: "\u65E2\u6CA1\u6709\u6DA8\u505C\uFF08\u5E02\u573A\u5171\u8BC6\uFF09\u4E5F\u6CA1\u6709\u6B63\u5411\u51C0\u4E70\uFF08\u771F\u5B9E\u8D44\u91D1\uFF09\uFF0C\u4E24\u4E2A\u5B9E\u6D4B\u6709\u6548\u8BC1\u636E\u90FD\u4E0D\u5177\u5907\u3002",
    stat: { n: 0, t1: null, t3: null, up: null, dd: null }
  },
  {
    key: "weak_fund_only",
    label: "\u4EC5\u5C0F\u989D\u5916\u8D44\u91D1\u3001\u65E0\u6DA8\u505C",
    test: (c) => !!c && !c.isZt && finite2(c.netWan) && +c.netWan > 0 && +c.netWan < 2e4,
    why: "\u9F99\u864E\u699C\u51C0\u4E70\u4E3A\u6B63\u4F46\u4E0D\u8DB3 2 \u4EBF\uFF08\u4E14\u5F53\u65E5\u672A\u6DA8\u505C\uFF09\uFF1A\u5B9E\u6D4B\u51C0\u4E70>0 \u7EC4 T+1 \u4EC5 +0.81%\u3001T+3 \u22120.41%\uFF0C\u5F31\u4E8E\u300C\u5168\u90E8\u6DA8\u505C\u80A1\u300D\u57FA\u51C6\uFF08+1.59% / +0.69%\uFF09\u3002\u51C0\u4E70\u91D1\u989D\u4E0D\u591F\u5927\u65F6\uFF0C\u4E0A\u699C\u672C\u8EAB\u4E0D\u6784\u6210\u4E70\u5165\u7406\u7531\u3002",
    stat: { n: 764, t1: 0.81, t3: -0.41, up: 50.5, dd: null }
  }
];
function screenCandidate(c) {
  const hits = [];
  for (const r of REJECT_RULES) {
    let hit = false;
    try {
      hit = !!r.test(c);
    } catch (e) {
      hit = false;
    }
    if (hit) hits.push({ key: r.key, label: r.label, why: r.why, stat: r.stat });
  }
  return { rejected: hits.length > 0, hits };
}
var BASELINE_UP = 55.3;
var BASELINE_N = 975;
var PREDICT_FACTORS = [
  {
    key: "streak2",
    label: "2 \u8FDE\u677F",
    test: (c) => +c.streak === 2,
    adj: 3.9,
    // 59.2% − 55.3%
    n: 130,
    note: "2 \u8FDE\u677F T+1 \u4E0A\u6DA8\u5360\u6BD4 59.2%\u3001\u5747\u6DA8 +2.73%\uFF08\u57FA\u51C6 +1.59%\uFF09"
  },
  {
    key: "streak34",
    label: "3~4 \u8FDE\u677F",
    test: (c) => +c.streak >= 3 && +c.streak <= 4,
    adj: 8.3,
    // 63.6% − 55.3%
    n: 77,
    note: "3 \u8FDE\u677F\u53CA\u4EE5\u4E0A T+1 \u4E0A\u6DA8\u5360\u6BD4 63.6%\u3001\u4E2D\u4F4D\u6DA8\u5E45 +4.77%"
  },
  {
    key: "low_turnover",
    label: "\u6362\u624B\u4F4E\uFF08<10%\uFF09",
    test: (c) => finite2(c.turnoverPct) && +c.turnoverPct < 10,
    adj: 4,
    // 59.3% − 55.3%
    n: 622,
    note: "\u6DA8\u505C\u4E14\u6362\u624B <10% \u7684\u7968 T+1 \u4E0A\u6DA8\u5360\u6BD4 59.3%\uFF0C3 \u65E5\u5E73\u5747\u6700\u5927\u56DE\u64A4\u4EC5 \u22124.19%\uFF08\u4F4E\u98CE\u9669\uFF09"
  },
  {
    key: "big_fund",
    label: "\u51C0\u4E70 \u22652 \u4EBF",
    test: (c) => finite2(c.netWan) && +c.netWan >= 2e4,
    adj: 9.5,
    // 64.8% − 55.3%
    n: 108,
    note: "\u9F99\u864E\u699C\u51C0\u4E70 \u22652 \u4EBF\u7684\u7968 T+1 \u4E0A\u6DA8\u5360\u6BD4 64.8%\u3001\u5747\u6DA8 +1.96%\uFF08\u51C0\u4E70 5000 \u4E07~2 \u4EBF\u7EC4\u4EC5 53.9%\uFF09"
  },
  {
    key: "scarcity",
    label: "\u5E02\u573A\u6DA8\u505C\u7A00\u5C11",
    test: (c, ctx) => finite2(ctx && ctx.ztCount) && +ctx.ztCount < 40,
    adj: 8.2,
    // 63.5% − 55.3%
    n: 137,
    note: "\u5168\u573A\u6DA8\u505C <40 \u5BB6\uFF08\u7A00\u7F3A\uFF09\u65F6\uFF0C\u6DA8\u505C\u80A1 T+1 \u4E0A\u6DA8\u5360\u6BD4 63.5%\u3001\u5747\u6DA8 +2.85%"
  },
  {
    key: "gem_star",
    label: "20% \u6DA8\u8DCC\u5E45\u54C1\u79CD",
    test: (c) => /^(30|688)/.test(String(c.code || "")),
    adj: 4.7,
    // 60.0% − 55.3%
    n: 65,
    note: "\u521B\u4E1A\u677F/\u79D1\u521B\u677F\u6DA8\u505C\u80A1 T+1 \u4E0A\u6DA8\u5360\u6BD4 60.0%\u3001\u5747\u6DA8 +2.79%\uFF0C\u4F46\u6CE2\u52A8\u4E5F\u66F4\u5927\uFF08\u8DCC>3% \u5360 26.2%\uFF09"
  }
];
function predictUpProb(c, ctx = {}) {
  const c1 = c || {};
  const hits = [];
  for (const f of PREDICT_FACTORS) {
    if (f.key === "streak2" || f.key === "streak34") {
      if (!finite2(c1.streak)) continue;
    }
    let hit = false;
    try {
      hit = !!f.test(c1, ctx);
    } catch (e) {
      hit = false;
    }
    if (hit) hits.push(f);
  }
  const rawAdj = hits.reduce((a, f) => a + f.adj, 0);
  const adj = Math.min(rawAdj, 18);
  const base = Math.max(0, Math.min(95, Math.round((BASELINE_UP + adj) * 10) / 10));
  const outflow = isNetOutflow(c1.netWan);
  const penalty = outflow.hit ? LHB_NET_OUTFLOW_PENALTY.PROB : 0;
  const score = Math.max(0, Math.round((base - penalty) * 10) / 10);
  const sample = hits.length ? Math.min(...hits.map((f) => f.n)) : BASELINE_N;
  return {
    score,
    band: probBand(score),
    factors: hits,
    sample,
    baseline: BASELINE_UP,
    // 扣分明细：UI 要能展示「扣前是多少」，否则被扣过的分会看起来像模型的原始判断
    rawScore: base,
    penalty,
    netOutflow: outflow.hit,
    outflowKind: outflow.hit ? outflow.kind : null,
    penaltyNote: outflow.hit ? `\u9F99\u864E\u699C\u51C0\u4E70\u5165 \u2264 0\uFF08${outflow.kind === "zero" ? "\u51C0\u4E70\u4E3A 0" : outflow.kind === "null" ? "\u65E0\u51C0\u4E70\u8BB0\u5F55" : "\u51C0\u4E70\u4E3A\u8D1F"}\uFF09 \u2192 \u4E0A\u6DA8\u6982\u7387\u6263 ${penalty} \u4E2A\u767E\u5206\u70B9\uFF08${base} \u2192 ${score}\uFF09\uFF1B${FLAG_LHB.NET_OUTFLOW}` : null
  };
}
function expectedReturn(c) {
  const c1 = c || {};
  const streak = +c1.streak || 0;
  const turn = finite2(c1.turnoverPct) ? +c1.turnoverPct : null;
  const lowTurn = turn != null && turn < 10;
  let atClose = { median: 0, n: 0, group: "\u672A\u77E5" };
  if (streak === 2 && lowTurn) atClose = { median: 4.99, n: 72, group: "2 \u8FDE\u677F + \u4F4E\u6362\u624B" };
  else if (streak >= 3 && lowTurn) atClose = { median: 4.77, n: 77, group: "3 \u8FDE\u677F\u4EE5\u4E0A + \u4F4E\u6362\u624B" };
  else if (streak === 1 && lowTurn) atClose = { median: 0.97, n: 515, group: "\u9996\u677F + \u4F4E\u6362\u624B" };
  else if (streak === 2) atClose = { median: 2.54, n: 130, group: "2 \u8FDE\u677F" };
  else if (streak >= 3) atClose = { median: 4.77, n: 77, group: "3 \u8FDE\u677F\u4EE5\u4E0A" };
  else if (streak === 1) atClose = { median: 0.64, n: 768, group: "\u9996\u677F" };
  else if (finite2(c1.netWan) && +c1.netWan >= 2e4) atClose = { median: 1.74, n: 108, group: "\u51C0\u4E70 \u22652 \u4EBF\uFF08\u672A\u6DA8\u505C\uFF09" };
  const atOpenMedian = streak === 2 && lowTurn ? 0 : streak === 1 && lowTurn ? -0.34 : lowTurn ? -0.28 : -0.28;
  const atOpen = { median: atOpenMedian, n: 975, group: "\u5168\u90E8\u6DA8\u505C\u80A1\uFF08T+1 \u5F00\u76D8\u4E70\u5165\uFF09" };
  let verdict;
  let warn = null;
  const openDesc = atOpenMedian < 0 ? `${atOpenMedian.toFixed(2)}%\uFF08\u8D1F\u671F\u671B\uFF09` : atOpenMedian === 0 ? "0.00%\uFF08\u65E0\u6B63\u671F\u671B\uFF0C\u5C5E\u7EAF\u7CB9\u7684\u6CE2\u52A8\u8D4C\u6CE8\uFF09" : `${atOpenMedian.toFixed(2)}%\uFF08\u5F31\u6B63\u671F\u671B\uFF09`;
  if (atClose.median > 2 && atClose.n >= 50) {
    verdict = "positive";
    warn = `\u26A0 \u8FD9\u4E2A\u6B63\u671F\u671B**\u53EA\u5728\u300CT \u65E5\u6536\u76D8\u4EF7\u300D\u53E3\u5F84\u4E0B\u6210\u7ACB**\u3002\u5B9E\u6D4B T+1 \u5F00\u76D8\u4EF7\u4E70\u5165\u3001\u5F53\u65E5\u6536\u76D8\u5356\u51FA\u7684\u5747\u6536\u76CA\u662F ${openDesc}\u2014\u2014\u6DA8\u505C\u80A1\u6B21\u65E5\u666E\u904D\u9AD8\u5F00\uFF0C\u5F00\u76D8\u8FFD\u8FDB\u53BB\u7684\u80DC\u7387\u660E\u663E\u4F4E\u4E8E\u6536\u76D8\u4EF7\u4E70\u5165\u3002\u52A1\u5FC5\u7B49\u56DE\u843D\u3001\u522B\u5728\u5F00\u76D8\u4EF7\u9644\u8FD1\u76F4\u63A5\u4E70\u5165\u3002`;
  } else if (atClose.median >= 0.5 && atClose.n >= 50) {
    verdict = "weak";
    warn = "\u671F\u671B\u4E3A\u6B63\u4F46\u5E45\u5EA6\u4E0D\u5927\uFF08\u4E2D\u4F4D\u6DA8\u5E45\u4E0D\u5230 1%\uFF09\uFF0C\u6263\u6389\u53CC\u8FB9\u8D39\u7528\u4E0E\u6ED1\u70B9\u540E\u6240\u5269\u6709\u9650\uFF1B\u540C\u6837\u4E0D\u8981\u5F00\u76D8\u8FFD\u9AD8\u3002";
  } else {
    verdict = "flat";
    warn = atClose.n < 50 ? `\u8BE5\u7279\u5F81\u5206\u7EC4\u6837\u672C\u91CF\u4EC5 ${atClose.n} \u4F8B\uFF0C\u4E0D\u8DB3\u4EE5\u4E0B\u7ED3\u8BBA\u2014\u2014\u5F53\u4F5C\u300C\u65E0\u5B9E\u6D4B\u4F9D\u636E\u300D\u770B\u5F85\u66F4\u5B89\u5168\u3002` : "\u8BE5\u7279\u5F81\u5206\u7EC4\u5B9E\u6D4B\u4E2D\u4F4D\u6DA8\u5E45\u63A5\u8FD1\u96F6\u6216\u4E3A\u8D1F\uFF0C\u6CA1\u6709\u7EDF\u8BA1\u4E0A\u7684\u4E70\u5165\u4EF7\u503C\u3002";
  }
  return { atClose, atOpen, verdict, warn };
}
function suggestStop(c, opts = {}) {
  const c1 = c || {};
  const code = String(c1.code || "");
  const wide = /^(30|688)/.test(code);
  const base = finite2(opts && opts.stopLossPct) ? +opts.stopLossPct : -0.08;
  const dd = wide ? -7.5 : -5.2;
  const maxPosFactor = wide ? 0.6 : 1;
  return {
    stopLossPct: Math.round(base * 1e4) / 1e4,
    maxDD: dd,
    maxPosFactor,
    reason: wide ? `\u521B\u4E1A\u677F/\u79D1\u521B\u677F 20% \u6DA8\u8DCC\u5E45\u54C1\u79CD\uFF0C\u5B9E\u6D4B 3 \u65E5\u5E73\u5747\u6700\u5927\u56DE\u64A4 ${dd}%\uFF0C\u5DF2\u63A5\u8FD1\u5355\u7B14\u6B62\u635F\u7EBF ${(base * 100).toFixed(0)}%\u3002**\u4E0D\u653E\u5BBD\u6B62\u635F**\uFF08\u653E\u5BBD\u7B49\u4E8E\u653E\u5927\u5355\u7B14\u98CE\u9669\uFF09\uFF0C\u6539\u4E3A\u628A\u5EFA\u8BAE\u4ED3\u4F4D\u6253 6 \u6298\u4EE5\u63A7\u5236\u5355\u7B14\u6700\u5927\u4E8F\u635F\u3002` : `\u6CBF\u7528\u7CFB\u7EDF\u5355\u7B14\u6B62\u635F\u7EAA\u5F8B ${(base * 100).toFixed(0)}%\uFF1B\u5B9E\u6D4B\u5168\u6863 3 \u65E5\u5E73\u5747\u6700\u5927\u56DE\u64A4 ${dd}%\uFF0C\u8BE5\u6B62\u635F\u4F4D\u591A\u6570\u60C5\u51B5\u4E0B\u53EF\u5148\u4E8E\u6DF1\u8DCC\u79BB\u573A\u3002`
  };
}
function predictPicks(candidates, ctx = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const topN = finite2(ctx.topN) && +ctx.topN > 0 ? Math.floor(+ctx.topN) : 5;
  const minProb = finite2(ctx.minProb) ? +ctx.minProb : 57;
  const streakTopMin = finite2(ctx.streakTopMin) ? +ctx.streakTopMin : STREAK_TOP_MIN;
  const stopOpts = { stopLossPct: ctx.stopLossPct };
  const rejected = [];
  const scored = [];
  for (const c of list) {
    if (!c) continue;
    const scr = screenCandidate(c);
    if (scr.rejected) {
      rejected.push({
        code: c.code,
        name: c.name || c.code,
        reason: scr.hits[0].label,
        why: scr.hits[0].why,
        stat: scr.hits[0].stat,
        allHits: scr.hits.map((h) => h.label),
        // 保留原始字段，便于 UI 展示「它本来长什么样」
        changePct: c.changePct ?? null,
        netWan: c.netWan ?? null,
        turnoverPct: c.turnoverPct ?? null,
        streak: c.streak ?? null
      });
      continue;
    }
    const prob = predictUpProb(c, ctx);
    const exp = expectedReturn(c);
    const stop = suggestStop(c, stopOpts);
    const limitUp = limitUpProb(c);
    const streakTop = isStreakTop(limitUp.prob, streakTopMin);
    const fbBoost = Number.isFinite(+ctx.firstBoardBoost) && +ctx.firstBoardBoost > 1 && Number.isFinite(+c.streak) && +c.streak <= 1 ? Math.min(100, prob.score * +ctx.firstBoardBoost) : prob.score;
    scored.push({ ...c, prob: fbBoost === prob.score ? prob : { ...prob, score: fbBoost, band: probBand(fbBoost) }, exp, stop, limitUp, streakTop });
  }
  scored.sort((a, b) => {
    if (a.streakTop !== b.streakTop) return a.streakTop ? -1 : 1;
    const ka = a.streakTop ? a.limitUp.prob || 0 : a.prob.score;
    const kb = b.streakTop ? b.limitUp.prob || 0 : b.prob.score;
    return kb - ka || (b.prob.score || 0) - (a.prob.score || 0) || (b.netWan || 0) - (a.netWan || 0) || String(a.code).localeCompare(String(b.code));
  });
  const kept = [];
  const below = [];
  for (const s of scored) {
    if (s.prob.score >= minProb) kept.push(s);
    else below.push(s);
  }
  const picks = kept.slice(0, topN);
  const overflow = kept.slice(topN);
  const streakKept = kept.filter((s) => s.streakTop);
  return {
    picks,
    rejected,
    belowThreshold: below,
    overflow,
    stats: {
      pool: list.length,
      kept: kept.length,
      rejected: rejected.length,
      below: below.length,
      minProb,
      baselineUp: BASELINE_UP,
      baselineN: BASELINE_N,
      // 连板维度统计（UI 显示「其中 N 只大概率连板」）
      streakTop: streakKept.length,
      streakTopMin,
      streakBaseline: STREAK_BASELINE,
      streakBaselineN: STREAK_BASELINE_N
    }
  };
}
function probBandText(score) {
  const b = probBand(score);
  return `${b.label}\uFF08${b.desc}\uFF09`;
}
var STREAK_BASELINE = 21.8;
var STREAK_BASELINE_N = 976;
var STREAK_BANDS = [
  { min: 45, key: "high", label: "\u8F83\u9AD8", desc: "\u5386\u53F2\u540C\u7279\u5F81\u7EC4 T+1 \u518D\u6DA8\u505C\u7387 \u226545%" },
  { min: 30, key: "mid", label: "\u4E2D\u7B49", desc: "\u5386\u53F2\u540C\u7279\u5F81\u7EC4 T+1 \u518D\u6DA8\u505C\u7387 30%~45%" },
  { min: 22, key: "low", label: "\u504F\u4F4E", desc: "\u5386\u53F2\u540C\u7279\u5F81\u7EC4 T+1 \u518D\u6DA8\u505C\u7387 22%~30%" },
  { min: 0, key: "poor", label: "\u4E0D\u4F73", desc: "\u5386\u53F2\u540C\u7279\u5F81\u7EC4 T+1 \u518D\u6DA8\u505C\u7387 <22%" }
];
function streakBand(score) {
  if (!Number.isFinite(+score)) return STREAK_BANDS[STREAK_BANDS.length - 1];
  const s = +score;
  for (const b of STREAK_BANDS) if (s >= b.min) return b;
  return STREAK_BANDS[STREAK_BANDS.length - 1];
}
var STREAK_TABLE = [
  // streakMin, streakMax（含），换手档 → 实测再涨停率与样本量
  { streak: 1, label: "\u9996\u677F", rows: { low: { p: 18.2, n: 577 }, mid: { p: 13, n: 139 }, high: { p: 15.1, n: 53 } }, all: { p: 17, n: 769 } },
  { streak: 2, label: "2 \u8FDE\u677F", rows: { low: { p: 43.3, n: 90 }, mid: { p: 32.1, n: 28 }, high: { p: 16.7, n: 12 } }, all: { p: 38.5, n: 130 } },
  { streak: 3, label: "3 \u8FDE\u677F", rows: { low: { p: 54.2, n: 24 }, mid: { p: 30.8, n: 13 }, high: { p: 33.3, n: 9 } }, all: { p: 43.5, n: 46 } },
  { streak: 4, label: "4 \u8FDE\u677F\u53CA\u4EE5\u4E0A", rows: { low: { p: 50, n: 20 }, mid: { p: 14.3, n: 7 }, high: { p: 25, n: 4 } }, all: { p: 38.7, n: 31 } }
];
function turnoverBandOf(turnoverPct) {
  if (!finite2(turnoverPct)) return null;
  const t = +turnoverPct;
  if (t < 12) return "low";
  if (t < 20) return "mid";
  return "high";
}
function streakRowOf(streak) {
  if (!finite2(streak)) return null;
  const s = +streak;
  if (s < 1) return null;
  if (s >= 4) return STREAK_TABLE[3];
  return STREAK_TABLE.find((r) => r.streak === s) || null;
}
function limitUpProb(c) {
  const c1 = c || {};
  const miss = {
    prob: null,
    band: null,
    n: 0,
    turnoverBand: null,
    group: "\u672A\u6DA8\u505C",
    isStreak: false,
    note: "\u5F53\u65E5\u672A\u6DA8\u505C\uFF0C\u4E0D\u5B58\u5728\u300C\u8FDE\u677F\u300D\u8FD9\u4E00\u8BF4\u2014\u2014\u4E0D\u7ED9\u8FDE\u677F\u6982\u7387\uFF0C\u907F\u514D\u628A\u4E24\u4EF6\u4E8B\u6DF7\u4E3A\u4E00\u8C08\u3002",
    t3Med: null
  };
  if (!c1.isZt) return miss;
  const row = streakRowOf(c1.streak);
  if (!row) return { ...miss, group: "\u8FDE\u677F\u6570\u672A\u77E5", note: "\u8FDE\u677F\u6570\u7F3A\u5931\uFF0C\u65E0\u6CD5\u5B9A\u4F4D\u5B9E\u6D4B\u5206\u7EC4\u2014\u2014\u4E0D\u7ED9\u8FDE\u677F\u6982\u7387\u3002" };
  const tb = turnoverBandOf(c1.turnoverPct);
  const cell = tb ? row.rows[tb] : row.all;
  if (!cell || !Number.isFinite(cell.p)) {
    return { ...miss, group: row.label, note: "\u8BE5\u5206\u7EC4\u6837\u672C\u4E0D\u8DB3\uFF0C\u4E0D\u7ED9\u8FDE\u677F\u6982\u7387\u3002" };
  }
  const t3 = row.streak === 1 ? -1.03 : row.streak === 2 ? -1.83 : row.streak === 3 ? -3.1 : -4;
  const tbTxt = tb === "low" ? "\u6362\u624B<12%" : tb === "mid" ? "\u6362\u624B12~20%" : tb === "high" ? "\u6362\u624B\u226520%" : "\u6362\u624B\u672A\u77E5";
  const band = streakBand(cell.p);
  return {
    prob: cell.p,
    band,
    n: cell.n,
    turnoverBand: tb,
    group: `${row.label} \xB7 ${tbTxt}`,
    isStreak: true,
    t3Med: t3,
    note: `${row.label}\u4E14${tbTxt}\u7684\u5B9E\u6D4B\u6837\u672C ${cell.n} \u4F8B\uFF0CT+1 \u518D\u6DA8\u505C\u7387 ${cell.p}%\uFF08\u57FA\u51C6\uFF1A\u5168\u90E8\u6DA8\u505C\u80A1 ${STREAK_BASELINE}%\uFF0Cn=${STREAK_BASELINE_N}\uFF09\u3002\u8BE5\u7EC4 T+3 \u4E2D\u4F4D ${t3}%\u2014\u2014\u8FDE\u677F\u662F\u77ED\u6253\u903B\u8F91\uFF0C\u4E0D\u662F\u6301\u6709\u903B\u8F91\u3002`
  };
}
var STREAK_TOP_MIN = 30;
function isStreakTop(prob, min) {
  const m = finite2(min) ? +min : STREAK_TOP_MIN;
  return finite2(prob) && +prob >= m;
}
function streakBandText(prob) {
  if (prob == null || !Number.isFinite(+prob)) return "\u65E0\u8FDE\u677F\u4F9D\u636E";
  const b = streakBand(prob);
  return `${b.label}\uFF08${b.desc}\uFF09`;
}
function streakTagText(lp) {
  if (!lp || !lp.isStreak || lp.prob == null) return null;
  return `\u5927\u6982\u7387\u8FDE\u677F ${lp.prob}%`;
}

// src/main_theme.js
var MAIN_THEME_RULES = {
  min_zt_count: 3,
  // 主线门槛：板块涨停家数 ≥3
  min_lb_count: 1,
  // 主线门槛：板块连板家数 ≥1
  weak_max: 5,
  // 弱主线上界（含）
  strong_max: 10,
  // 强主线上界（含）；≥ strong_max+1 为绝对主线
  continuous_min_days: 3,
  // 持续主线门槛：连续 ≥3 天
  rotation_drop_ratio: 0.5
  // 旧主线衰减线：今日 < 昨日 × 50%
};
var intOr = (v, dft) => Number.isFinite(+v) ? Math.trunc(+v) : dft;
var validFund = (v) => v != null && Number.isFinite(+v) ? +v : null;
function clusterThemes(pool) {
  if (!Array.isArray(pool)) return [];
  const groups = /* @__PURE__ */ new Map();
  for (const s of pool) {
    if (!s) continue;
    const bk = typeof s.hybk === "string" ? s.hybk.trim() : "";
    if (!bk) continue;
    const code = s.c != null ? String(s.c) : null;
    let g = groups.get(bk);
    if (!g) {
      g = { name: bk, zt_count: 0, lb_count: 0, fundSum: 0, fundCnt: 0, stocks: [] };
      groups.set(bk, g);
    }
    g.zt_count++;
    if (intOr(s.lbc, 1) >= 2) g.lb_count++;
    const f = validFund(s.fund);
    if (f != null) {
      g.fundSum += f;
      g.fundCnt++;
    }
    if (code) g.stocks.push(code);
  }
  return [...groups.values()].map((g) => ({
    name: g.name,
    zt_count: g.zt_count,
    lb_count: g.lb_count,
    avg_fund: g.fundCnt ? Math.round(g.fundSum / g.fundCnt) : null,
    stocks: g.stocks
  })).sort((a, b) => b.zt_count - a.zt_count || (a.name < b.name ? -1 : 1));
}
function classifyThemeStrength(ztCount) {
  const n = +ztCount;
  if (!Number.isFinite(n)) return null;
  if (n <= MAIN_THEME_RULES.weak_max) return "\u5F31\u4E3B\u7EBF";
  if (n <= MAIN_THEME_RULES.strong_max) return "\u5F3A\u4E3B\u7EBF";
  return "\u7EDD\u5BF9\u4E3B\u7EBF";
}

// src/picks.js
var DEFAULT_HOTMONEY_SEAT_PATTERNS = ["\u534E\u946B", "\u62C9\u8428", "\u7AE0\u5EFA\u5E73", "\u8D22\u901A", "\u56FD\u6CF0\u541B\u5B89", "\u4E1C\u65B9\u8D22\u5BCC", "\u65B9\u65B0\u4FA0", "\u8D75\u8001\u54E5", "\u4F5C\u624B\u65B0\u4E00", "\u5B81\u6CE2", "\u6EA7\u9633\u8DEF", "\u53E4\u5317\u8DEF", "\u91D1\u7530\u8DEF", "\u82CF\u5357\u5E2E", "\u4E0A\u5858\u8DEF", "\u4F5B\u5C71", "\u6210\u90FD", "\u6B4C\u795E", "\u7092\u65B0\u4E00\u65CF", "\u8457\u540D\u523A\u5BA2", "\u5C0F\u9CC4\u9C7C", "\u4E0A\u6D77\u6C5F\u82CF\u8DEF", "\u6851\u7530\u8DEF", "\u8679\u6865\u8DEF", "\u6EA7\u9633"];
function hotMoneyNetWanOf(detailMap, code, patterns) {
  if (!detailMap || code == null) return 0;
  const { b } = seatsOf(detailMap, code);
  if (!Array.isArray(b)) return 0;
  let net = 0;
  for (const row of b) {
    const name = String(row && row[0] != null ? row[0] : "");
    const wan = Number(row && row[1] != null ? row[1] : 0) || 0;
    if (patterns.some((pat) => name.includes(pat))) net += wan;
  }
  return net;
}
var NET_OUTFLOW_TAG = FLAG_LHB.NET_OUTFLOW;
var PICK_TOP_N = 5;
var CLIMAX_STRENGTHS = /* @__PURE__ */ new Set(["\u5F3A\u4E3B\u7EBF", "\u7EDD\u5BF9\u4E3B\u7EBF"]);
var GATE_CORE_TOP = 2;
var GATE_BACKROW_TOP = 2;
var OPEN_RECHECK_TIPS = "\u6B21\u65E5\u5F00\u76D85\u5206\u949F\uFF1A\u9F99\u5934\u9AD8\u5F00\u62A2\u7B79/\u653E\u91CF\u627F\u63A5=\u63A5\u529B\u6709\u6548\u53EF\u6301\u6709\uFF1B\u82E5\u4F4E\u5F00\u4F4E\u8D70\u4E14\u4E3B\u529B\u51C0\u6D41\u51FA=\u63A5\u529B\u5931\u6548\uFF0C\u64A4\u9500\u8DDF\u8FDB\u3002";
var SCORE_WEIGHTS = {
  fund: 0.4,
  // 龙虎榜当日净买额（真实资金，最强证据）
  streak: 0.25,
  // 连板高度（市场共识强度）
  theme: 0.2,
  // 是否归属当日主线题材（板块效应）
  liquidity: 0.15
  // 龙虎榜成交额占当日全榜比重（可交易性/关注度）
};
var NET_STEPS = [
  { min: 5e4, s: 1 },
  // ≥5 亿
  { min: 2e4, s: 0.9 },
  // ≥2 亿
  { min: 1e4, s: 0.8 },
  // ≥1 亿
  { min: 5e3, s: 0.65 },
  // ≥5000 万
  { min: 2e3, s: 0.5 },
  // ≥2000 万
  { min: 1, s: 0.35 }
  // 任何正的净买
];
var TIER_THRESHOLDS = { overheat: 80, full: 65, half: 24 };
var POSITION_TIERS = [
  { key: "overheat", label: "\u8FC7\u70ED\uFF08\u53EA\u51CF\u4ED3\u4E0D\u65B0\u5EFA\uFF09", pos: 0.4, allowNew: false },
  { key: "full", label: "\u6EE1\u4ED3", pos: 1, allowNew: true },
  { key: "half", label: "\u534A\u4ED3", pos: 0.5, allowNew: true },
  { key: "clear", label: "\u6E05\u4ED3", pos: 0, allowNew: false }
];
var r22 = (v) => Math.round(v * 100) / 100;
var finite3 = (v) => Number.isFinite(+v);
function marketTier(score) {
  if (score == null || score === "" || typeof score === "boolean") return null;
  if (!finite3(score)) return null;
  const s = +score;
  const t = TIER_THRESHOLDS;
  if (s >= t.overheat) return POSITION_TIERS[0];
  if (s >= t.full) return POSITION_TIERS[1];
  if (s > t.half) return POSITION_TIERS[2];
  return POSITION_TIERS[3];
}
function buildCandidates(day, opts = {}) {
  const d = day || {};
  const s = d.summary || {};
  const hot = Array.isArray(d.hot) ? d.hot : [];
  const lhbRows = Array.isArray(d.lhb) ? d.lhb : [];
  const minNet = finite3(opts.minNetWan) ? +opts.minNetWan : 0;
  const ztCodes = new Set(Array.isArray(s.zt_codes) ? s.zt_codes : []);
  const ztLb = s.zt_lb && typeof s.zt_lb === "object" ? s.zt_lb : {};
  const mainTheme = s.main_theme && s.main_theme.name ? s.main_theme.name : null;
  const byCode = /* @__PURE__ */ new Map();
  const klineLens = d && d.klineLens || null;
  const ensure = (code, seed) => {
    if (!code) return null;
    let c = byCode.get(code);
    if (!c) {
      c = { code, name: seed.name || code, ...seed };
      byCode.set(code, c);
    } else if (seed.name && (!c.name || c.name === c.code)) c.name = seed.name;
    if (klineLens && klineLens[code] != null && c.klineDays == null) c.klineDays = klineLens[code];
    return c;
  };
  for (const l of lhbRows) {
    if (!l || !l.code) continue;
    const isRange = l.is_range != null ? !!l.is_range : RANGE_BOARD_RE.test(String(l.reason || ""));
    if (isRange) continue;
    if (isNewStock(l)) continue;
    const c = ensure(l.code, {
      name: l.name,
      close: l.close,
      changePct: l.change_pct,
      netWan: l.net_buy_wan,
      buyWan: l.buy_wan,
      sellWan: l.sell_wan,
      turnoverPct: l.turnover_pct,
      reason: l.reason,
      source: ["lhb"]
    });
    if (!c) continue;
    c.close = l.close ?? c.close;
    c.changePct = l.change_pct ?? c.changePct;
    c.netWan = l.net_buy_wan;
    c.buyWan = l.buy_wan;
    c.sellWan = l.sell_wan;
    c.turnoverPct = l.turnover_pct ?? c.turnoverPct;
    c.lhbReason = l.reason;
  }
  for (const code of ztCodes) {
    const h = hot.find((x) => x && x.code === code) || null;
    const c = ensure(code, {
      name: h ? h.name : code,
      close: h ? h.close : null,
      changePct: h ? h.change_pct : null,
      turnoverPct: h ? h.huanshou : null,
      reason: h ? h.reason : "",
      source: []
    });
    if (!c) continue;
    if (!c.source.includes("zt")) c.source.push("zt");
    c.isZt = true;
    c.streak = finite3(ztLb[code]) ? +ztLb[code] : 1;
    if (!finite3(c.netWan)) c.netWan = null;
  }
  const hotByCode = /* @__PURE__ */ new Map();
  for (const h of hot) if (h && h.code) hotByCode.set(h.code, h);
  for (const c of byCode.values()) {
    const h = hotByCode.get(c.code);
    if (!h) continue;
    if (h.reason) c.hotReason = h.reason;
    if (!c.reason || c.reason === c.lhbReason) c.reason = h.reason || c.reason;
    if (!finite3(c.turnoverPct) && finite3(h.huanshou)) c.turnoverPct = h.huanshou;
    if (c.close == null && h.close != null) c.close = h.close;
    if (c.changePct == null && h.change_pct != null) c.changePct = h.change_pct;
    if (!c.name || c.name === c.code) c.name = h.name || c.name;
    if (!c.source.includes("hot")) c.source.push("hot");
  }
  const themeWords = Object.keys(d.themes || {}).filter((t) => t && t.length >= 2);
  const stemOf = (w) => String(w).length >= 2 ? String(w).slice(0, 2) : String(w);
  const mainStem = mainTheme ? stemOf(mainTheme) : null;
  const out2 = [];
  for (const c of byCode.values()) {
    const text = [c.reason, c.hotReason, c.lhbReason].filter(Boolean).join(" ");
    c.themes = themeWords.filter((t) => text.includes(t)).slice(0, 4);
    let match = null;
    if (mainTheme && c.themes.includes(mainTheme)) match = "exact";
    else if (mainStem && themeWords.some((t) => t !== mainTheme && stemOf(t) === mainStem && text.includes(t))) match = "stem";
    c.inMainTheme = !!match;
    c.mainThemeMatch = match;
    const hasFund = finite3(c.netWan) && c.netWan > minNet;
    const hasZt = !!c.isZt;
    if (!hasFund && !hasZt) continue;
    if (!c.source.length) continue;
    out2.push(c);
  }
  return out2;
}
function scoreFund(netWan) {
  if (!finite3(netWan)) return 0;
  const v = +netWan;
  if (v <= 0) return 0;
  for (const st of NET_STEPS) if (v >= st.min) return st.s;
  return 0;
}
function scoreStreak(streak) {
  if (!finite3(streak) || +streak < 1) return 0;
  return Math.min(1, 0.35 + (+streak - 1) * 0.25);
}
function scoreCandidate(c, ctx = {}) {
  const totalDeal = finite3(ctx.totalDealWan) && +ctx.totalDealWan > 0 ? +ctx.totalDealWan : null;
  const deal = (finite3(c.buyWan) ? +c.buyWan : 0) + (finite3(c.sellWan) ? +c.sellWan : 0);
  const liq = totalDeal && deal > 0 ? Math.min(1, Math.sqrt(deal / totalDeal / 0.1)) : 0;
  const parts = {
    fund: scoreFund(c.netWan),
    streak: scoreStreak(c.streak),
    // 精确命中主线给满分；词根命中（主线名为聚合桶标签时）给 0.6——证据弱于精确命中，但不为 0
    theme: c.mainThemeMatch === "exact" ? 1 : c.inMainTheme ? 0.6 : c.themes && c.themes.length ? 0.4 : 0,
    liquidity: liq
  };
  const raw = Object.entries(SCORE_WEIGHTS).reduce((a, [k, w]) => a + w * (parts[k] || 0), 0);
  const outflow = isNetOutflow(c.netWan);
  const penalty = outflow.hit ? LHB_NET_OUTFLOW_PENALTY.SCORE : 0;
  const score = Math.max(0, Math.min(100, Math.round(raw * 1e3 / 10) - penalty));
  return {
    score,
    parts,
    penalty,
    netOutflow: outflow.hit,
    // 保留扣分前的原始分，便于页面上说清「这一分是怎么被扣掉的」（可核验性）
    rawScore: Math.round(raw * 1e3) / 10,
    outflowText: outflow.hit ? `\u9F99\u864E\u699C\u51C0\u4E70\u5165 \u2264 0 \u2192 \u7EFC\u5408\u5206\u6263 ${penalty} \u5206\uFF08${Math.round(raw * 1e3) / 10} \u2192 ${score}\uFF09` : null
  };
}
var yi = (wan) => finite3(wan) ? (Math.abs(+wan) / 1e4).toFixed(2) : "\u2014";
function reasonsOf(c) {
  const out2 = [];
  if (finite3(c.netWan) && c.netWan > 0) {
    out2.push({ kind: "fund", text: `\u9F99\u864E\u699C\u51C0\u4E70 ${yi(c.netWan)} \u4EBF`, tone: "up" });
  }
  if (c.isZt) {
    out2.push({ kind: "zt", text: c.streak > 1 ? `\u6DA8\u505C\uFF08${c.streak} \u8FDE\u677F\uFF09` : "\u6DA8\u505C", tone: "up" });
  }
  if (c.inMainTheme) {
    out2.push({
      kind: "theme",
      // 词根命中不得说成「属主线」——主线名是聚合桶标签时，只能说「与主线同源」
      text: c.mainThemeMatch === "exact" ? "\u5C5E\u5F53\u65E5\u4E3B\u7EBF\u9898\u6750" : "\u4E0E\u4E3B\u7EBF\u9898\u6750\u540C\u6E90\uFF08\u8BCD\u6839\u5339\u914D\uFF09",
      tone: "up"
    });
  } else if (c.themes && c.themes.length) out2.push({ kind: "theme", text: `\u9898\u6750\uFF1A${c.themes.slice(0, 2).join("\u3001")}`, tone: "muted" });
  if (isNetOutflow(c.netWan).hit) {
    out2.push({ kind: "outflow", text: NET_OUTFLOW_TAG, tone: "warn" });
  }
  if (finite3(c.turnoverPct) && c.turnoverPct >= 20) {
    out2.push({ kind: "turn", text: `\u6362\u624B ${r22(c.turnoverPct)}%\uFF08\u9AD8\u6362\u624B\uFF09`, tone: "warn" });
  }
  return out2;
}
function risksOf(c) {
  const out2 = [];
  if (finite3(c.streak) && c.streak >= 3) {
    out2.push(`${c.streak} \u8FDE\u677F\u9AD8\u4F4D\uFF0C\u65AD\u677F\u5F53\u65E5\u56DE\u64A4\u53EF\u80FD\u5F88\u5927`);
  }
  if (finite3(c.turnoverPct) && c.turnoverPct >= 25) {
    out2.push(`\u6362\u624B ${r22(c.turnoverPct)}% \u504F\u9AD8\uFF0C\u7B79\u7801\u4E0D\u7A33\u5B9A`);
  }
  if (finite3(c.changePct) && c.changePct >= 9.8) {
    out2.push("\u5F53\u65E5\u5DF2\u6DA8\u505C\uFF0C\u6B21\u65E5\u5B58\u5728\u51B2\u9AD8\u56DE\u843D\u98CE\u9669");
  }
  if (!finite3(c.netWan) || c.netWan <= 0) {
    out2.push("\u65E0\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70\u8BB0\u5F55\uFF0C\u4EC5\u6709\u6DA8\u505C\u8BC1\u636E\uFF0C\u8BC1\u636E\u5F3A\u5EA6\u5F31\u4E8E\u699C\u9996\u6807\u7684");
  }
  const code = String(c.code || "");
  if (/^(30|301|688)/.test(code)) out2.push("20% \u6DA8\u8DCC\u5E45\u54C1\u79CD\uFF0C\u6CE2\u52A8\u5929\u7136\u5927\u4E8E\u4E3B\u677F");
  if (/^(4|8|920)/.test(code)) out2.push("\u5317\u4EA4\u6240\u6807\u7684\uFF0C\u6D41\u52A8\u6027\u5F31\u4E8E\u6CAA\u6DF1");
  return out2;
}
function suggestWeight(tier, n, opts = {}) {
  if (!tier || !tier.allowNew || !(n > 0)) return 0;
  const cap = finite3(opts.perStockCap) ? +opts.perStockCap : 0.2;
  const avg = tier.pos / n;
  return Math.round(Math.min(cap, avg) * 1e4) / 1e4;
}
function applyEmotionGates(picks, ctx = {}) {
  const ztpool = ctx && Array.isArray(ctx.ztpool) ? ctx.ztpool : null;
  if (!ztpool || !ztpool.length || !Array.isArray(picks)) {
    return { picks: picks || [], climaxWarnings: [], climaxBlocked: [], sectorTrimmed: [] };
  }
  const byCode = /* @__PURE__ */ new Map();
  for (const s of ztpool) {
    if (s && s.c != null) byCode.set(String(s.c), s);
  }
  const clusters = clusterThemes(ztpool);
  const mainLine = /* @__PURE__ */ new Map();
  const climax = [];
  for (const c of clusters) {
    const st = classifyThemeStrength(c.zt_count);
    mainLine.set(c.name, { ztCount: c.zt_count, strength: st });
    if (CLIMAX_STRENGTHS.has(st)) climax.push({ name: c.name, ztCount: c.zt_count, strength: st });
  }
  const climaxSet = new Set(climax.map((c) => c.name));
  const structKey = (s) => {
    const zbc = s && finite3(s.zbc) ? +s.zbc : 99;
    const fbt = s && finite3(s.fbt) ? +s.fbt : 999999;
    const fund = s && finite3(s.fund) ? +s.fund : -1;
    return [zbc, fbt, -fund];
  };
  const groups = /* @__PURE__ */ new Map();
  for (const p of picks) {
    const ps = byCode.get(String(p.code));
    if (!ps || !ps.hybk) continue;
    if (!mainLine.has(ps.hybk)) continue;
    if (!groups.has(ps.hybk)) groups.set(ps.hybk, []);
    groups.get(ps.hybk).push({ p, ps });
  }
  const kept = [];
  const climaxBlocked = [];
  const sectorTrimmed = [];
  const climaxWarnings = climax.map((c) => ({
    sector: c.name,
    strength: c.strength,
    ztCount: c.ztCount,
    message: `\u60C5\u7EEA\u9AD8\u6F6E\uFF08${c.strength}\uFF0C\u677F\u5757 ${c.ztCount} \u5BB6\u6DA8\u505C\uFF09\uFF1A\u6B21\u65E5\u8C28\u9632\u5206\u6B67\u2014\u2014\u5DF2\u7981\u63A8\u8BE5\u677F\u5757\u524D\u6392\u9AD8\u6807\uFF0C\u4EC5\u7559\u4F4E\u4F4D\u9996\u677F\u8865\u6DA8\u3002`
  }));
  for (const [sec, arr] of groups) {
    const isClimax = climaxSet.has(sec);
    arr.sort((a, b) => {
      const ka = structKey(a.ps), kb = structKey(b.ps);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    });
    if (isClimax) {
      for (const x of arr) {
        const lbc = finite3(x.ps.lbc) ? +x.ps.lbc : 0;
        if (lbc >= 2) {
          climaxBlocked.push({
            code: x.p.code,
            name: x.p.name,
            sector: sec,
            reason: `\u60C5\u7EEA\u9AD8\u6F6E\u677F\u5757\u524D\u6392\u9AD8\u6807\uFF08\u8FDE\u677F ${lbc}\uFF09\uFF0C\u6B21\u65E5\u5206\u6B67\u98CE\u9669\u9AD8\uFF0C\u5DF2\u7981\u63A8`
          });
        }
      }
      const backrow = arr.filter((x) => finite3(x.ps.lbc) && +x.ps.lbc === 1 && finite3(x.ps.zbc) && +x.ps.zbc === 0);
      const weak = arr.filter((x) => finite3(x.ps.lbc) && +x.ps.lbc === 1 && !(finite3(x.ps.zbc) && +x.ps.zbc === 0));
      const chosen = backrow.slice(0, GATE_BACKROW_TOP);
      for (const x of chosen) {
        x.p.gateTags = ["\u540E\u6392\u8865\u6DA8"];
        x.p.openRecheck = { need: true, tips: OPEN_RECHECK_TIPS, climax: true };
        kept.push(x.p);
      }
      for (const x of backrow.slice(GATE_BACKROW_TOP)) {
        x.p.gateTags = ["\u540E\u6392\u8865\u6DA8"];
        x.p.openRecheck = { need: true, tips: OPEN_RECHECK_TIPS, climax: true };
        sectorTrimmed.push(x.p);
      }
      for (const x of weak) {
        x.p.openRecheck = { need: true, tips: OPEN_RECHECK_TIPS, climax: true };
        sectorTrimmed.push(x.p);
      }
    } else {
      const chosen = arr.slice(0, GATE_CORE_TOP);
      for (const x of chosen) {
        x.p.gateTags = ["\u6838\u5FC3\u9F99\u5934"];
        x.p.openRecheck = { need: true, tips: OPEN_RECHECK_TIPS, climax: false };
        kept.push(x.p);
      }
      for (const x of arr.slice(GATE_CORE_TOP)) {
        x.p.gateTags = ["\u6838\u5FC3\u9F99\u5934"];
        x.p.openRecheck = { need: true, tips: OPEN_RECHECK_TIPS, climax: false };
        sectorTrimmed.push(x.p);
      }
    }
  }
  const inGroups = /* @__PURE__ */ new Set();
  for (const arr of groups.values()) for (const x of arr) inGroups.add(String(x.p.code));
  for (const p of picks) if (!inGroups.has(String(p.code))) kept.push(p);
  const order = new Map(picks.map((p, i) => [String(p.code), i]));
  kept.sort((a, b) => (order.get(String(a.code)) ?? 0) - (order.get(String(b.code)) ?? 0));
  return { picks: kept, climaxWarnings, climaxBlocked, sectorTrimmed };
}
function applyTradabilityFilters(picks, ztpool) {
  const pool = Array.isArray(ztpool) ? ztpool : null;
  if (!Array.isArray(picks)) return { picks: [], rejected: [], weakToStrong: [] };
  const MIN_BUYABLE_HS = 5;
  if (!pool || !pool.length) {
    const kept2 = [];
    const rejected2 = [];
    for (const p of picks) {
      const zdp = finite3(p.changePct) ? +p.changePct : null;
      const tpHs = finite3(p.turnoverPct) ? +p.turnoverPct : finite3(p.hs) ? +p.hs : null;
      const isLimitUp2 = zdp != null && zdp >= 9.5;
      if (isLimitUp2 && (tpHs == null || tpHs < MIN_BUYABLE_HS)) {
        rejected2.push({ code: p.code, name: p.name, reasons: [`\u26A0 \u6DA8\u505C\u4F46\u6362\u624B\u7387${tpHs == null ? "\u2014" : tpHs.toFixed(1) + "%"}<${MIN_BUYABLE_HS}%\uFF08\u4E00\u5B57/\u7F29\u91CF\u786C\u677F\uFF09\u2192 \u5B9E\u76D8\u4E70\u4E0D\u8FDB\uFF0C\u5DF2\u5254\u9664`] });
        continue;
      }
      kept2.push(p);
    }
    return { picks: kept2, rejected: rejected2, weakToStrong: [] };
  }
  const byCode = /* @__PURE__ */ new Map();
  for (const s of pool) if (s && s.c != null) byCode.set(String(s.c), s);
  const HIGH_LIANBAN_MIN = 4;
  const LATE_SEAL_TIME = 1e5;
  const WEAK_TO_STRONG_HS = 15;
  const rejected = [];
  const kept = [];
  for (const p of picks) {
    const ps = byCode.get(String(p.code));
    if (!ps) {
      if (!p.buyPoint) p.buyPoint = "\u975E\u6DA8\u505C\u6C60\u6807\u7684\uFF08\u9F99\u864E\u699C\u9A71\u52A8\uFF09\uFF0C\u6309\u5E38\u89C4\u4E70\u70B9";
      kept.push(p);
      continue;
    }
    const hs = finite3(ps.hs) ? +ps.hs : null;
    const lbc = finite3(ps.lbc) ? +ps.lbc : 0;
    const fund = finite3(ps.fund) ? +ps.fund : 0;
    const ltsz = finite3(ps.ltsz) ? +ps.ltsz : 0;
    const zdp = finite3(ps.zdp) ? +ps.zdp : 0;
    const zbc = finite3(ps.zbc) ? +ps.zbc : 0;
    const fbt = finite3(ps.fbt) ? +ps.fbt : 999999;
    const isLimitUp2 = zdp >= 9.5;
    const sealRatio = ltsz > 0 && fund > 0 ? fund / ltsz : 0;
    const shrinkBoard = isLimitUp2 && hs != null && hs < 5;
    const lockedSeal = isLimitUp2 && sealRatio > 0.05;
    const highLianbanNoTurn = lbc >= HIGH_LIANBAN_MIN && (hs == null || hs < 8);
    if (shrinkBoard || lockedSeal || highLianbanNoTurn) {
      const why = [];
      if (shrinkBoard) why.push(`\u7F29\u91CF\u786C\u677F(\u6362\u624B\u7387${hs.toFixed(1)}%<5%)`);
      if (lockedSeal) why.push(`\u5C01\u5355\u9501\u6B7B(\u5C01\u5355\u5360\u6D41\u901A\u5E02\u503C${(sealRatio * 100).toFixed(1)}%>5%)`);
      if (highLianbanNoTurn) why.push(`\u9AD8\u4F4D\u8FDE\u677F(${lbc}\u677F)\u65E0\u6362\u624B(\u6362\u624B\u7387${hs == null ? "\u2014" : hs.toFixed(1) + "%"})`);
      rejected.push({ code: p.code, name: p.name, reasons: [`\u26A0 ${why.join("\uFF1B")} \u2192 \u5B9E\u76D8\u4E70\u4E0D\u8FDB\uFF0C\u5DF2\u5254\u9664`] });
      continue;
    }
    const isWeakBoard = zbc > 0 || fbt >= LATE_SEAL_TIME;
    let buyPoint;
    if (isWeakBoard && hs != null && hs >= 8) {
      buyPoint = "\u5F31\u8F6C\u5F3A\uFF1A\u4ECA\u65E5\u653E\u91CF\u70C2\u677F\uFF0C\u660E\u65E5\u65E9\u76D8\u4F4E\u5F00/\u56DE\u8E29\u5747\u7EBF\u53EF\u4F4E\u5438";
    } else if (isLimitUp2 && hs != null && hs < 8) {
      buyPoint = "\u26A0 \u504F\u7F29\u91CF\u786C\u677F\uFF0C\u6B21\u65E5\u6613\u4E00\u5B57/\u79D2\u677F\uFF0C\u5B9E\u76D8\u4E70\u70B9\u82DB\u523B\uFF0C\u8C28\u614E";
    } else if (isLimitUp2) {
      buyPoint = "\u6B63\u5E38\u6362\u624B\u6DA8\u505C\uFF0C\u7ADE\u4EF7/\u5F00\u76D8\u5206\u6B67\u8F6C\u4E00\u81F4\u53EF\u53C2\u4E0E";
    } else {
      buyPoint = "\u975E\u6DA8\u505C\uFF08\u9F99\u864E\u699C\u9A71\u52A8\uFF09\uFF0C\u6309\u5E38\u89C4\u4E70\u70B9";
    }
    p.buyPoint = buyPoint;
    const weakToStrong = isLimitUp2 && hs != null && hs > WEAK_TO_STRONG_HS && (zbc > 0 || fbt >= LATE_SEAL_TIME);
    p.weakToStrong = weakToStrong;
    if (weakToStrong) {
      p.gateTags = [...p.gateTags || [], "\u70C2\u677F\u5F31\u8F6C\u5F3A"];
      p.buyPoint = `\u70C2\u677F\u5F31\u8F6C\u5F3A\uFF1A\u4ECA\u65E5\u7206\u91CF\u6362\u624B(${hs.toFixed(0)}%) \u5C3E\u76D8\u5C01\u677F \u2192 \u660E\u65E5\u65E9\u76D8\u6781\u5927\u6982\u7387\u7ED9\u4F4E\u5438\u4E70\u70B9`;
    }
    kept.push(p);
  }
  const wts = kept.filter((p) => p.weakToStrong);
  const rest = kept.filter((p) => !p.weakToStrong);
  return { picks: [...wts, ...rest], rejected, weakToStrong: wts };
}
function recommendPicks(day, ctx = {}) {
  const d = day || {};
  const tier = marketTier(ctx.emotionScore);
  const topN = finite3(ctx.topN) && +ctx.topN > 0 ? Math.floor(+ctx.topN) : PICK_TOP_N;
  const candidates = buildCandidates(d).filter((c) => isAdmissible(c.code, c.name, c.klineDays));
  const totalDealWan = candidates.reduce((a, c) => a + (finite3(c.buyWan) ? +c.buyWan : 0) + (finite3(c.sellWan) ? +c.sellWan : 0), 0);
  const enriched = candidates.map((c) => {
    const sc = scoreCandidate(c, { totalDealWan });
    return {
      ...c,
      score: sc.score,
      scoreParts: sc.parts,
      // 扣分链路透出（页面要能说清「这一分是怎么被扣的」，不能只给一个变小了的数）
      scorePenalty: sc.penalty,
      scoreRaw: sc.rawScore,
      scoreOutflow: sc.netOutflow,
      reasons: reasonsOf(c),
      risks: risksOf(c)
    };
  });
  const ztCount = finite3(d.summary && d.summary.zt_count) ? +d.summary.zt_count : null;
  const pred = predictPicks(enriched, {
    topN,
    ztCount,
    minProb: ctx.minProb,
    stopLossPct: ctx.stopLossPct,
    streakTopMin: ctx.streakTopMin,
    firstBoardBoost: ctx.firstBoardBoost
  });
  const gate = applyEmotionGates(pred.picks, ctx);
  let picks = gate.picks;
  const tradPool = Array.isArray(ctx.ztpool) ? ctx.ztpool : null;
  const trad = applyTradabilityFilters(picks, tradPool);
  picks = trad.picks;
  let clusterFilterNote = null;
  if (ctx.isClusteringBubble) {
    const mainLine = ctx.mainLine && typeof ctx.mainLine === "object" ? ctx.mainLine : null;
    const validMain = !!(mainLine && mainLine.isValidMain === true && Number.isFinite(mainLine.longHuNet) && mainLine.longHuNet > 0);
    const kept = [];
    for (const p of picks) {
      p.theme = mainLine ? structuredClone(mainLine) : null;
      if (validMain) {
        kept.push(p);
      } else {
        if (p.inMainTheme === true) continue;
        if (Number.isFinite(p.netWan) && p.netWan > 0) kept.push(p);
      }
    }
    const filteredOut = picks.length - kept.length;
    if (filteredOut > 0) {
      clusterFilterNote = {
        reason: "clustering_bubble_mainline_filter",
        count: filteredOut,
        note: "\u6781\u5BD2\u5206\u5316\u6E29\u548C\u98CE\u63A7\uFF1A\u5254\u9664\u65E0\u6548\u4E3B\u7EBF\u8DDF\u98CE\u7968\uFF1B\u975E\u4E3B\u7EBF\u4E14\u9F99\u864E\u699C\u51C0\u4E70\u4E3A\u6B63\u7684\u5F3A\u52BF\u7968\u4FDD\u7559"
      };
    }
    picks = kept;
  }
  if (ctx.openGapFilterPct != null && +ctx.openGapFilterPct > 0) {
    const gapMax = +ctx.openGapFilterPct;
    const before = picks.length;
    picks = picks.filter((p) => {
      const isLimitUp2 = p.isZt === true || isLimitUp(p.changePct, { code: p.code, name: p.name });
      if (isLimitUp2) return true;
      return !(Number.isFinite(+p.changePct) && +p.changePct >= gapMax);
    });
    const removed = before - picks.length;
    if (removed > 0) {
      clusterFilterNote = clusterFilterNote || { reason: "open_gap_filter", count: 0, note: "" };
      clusterFilterNote.reason = "open_gap_filter";
      clusterFilterNote.count = (clusterFilterNote.count || 0) + removed;
      clusterFilterNote.note = `\u9AD8\u5F00/\u6025\u62C9\u8FC7\u6EE4\uFF1A\u5254\u9664\u975E\u6DA8\u505C\u4E14\u5FEB\u7167\u6DA8\u5E45\u2265${gapMax}% \u7684\u5019\u9009\uFF08\u9632\u8FFD\u9AD8\uFF1B\u6DA8\u505C\u80A1\u8C41\u514D\uFF09`;
    }
  }
  const weight = suggestWeight(tier, picks.length);
  for (const p of picks) {
    p.suggestWeight = weight;
    const factor = p.stop && finite3(p.stop.maxPosFactor) ? +p.stop.maxPosFactor : 1;
    p.suggestWeight = Math.round(weight * factor * 1e4) / 1e4;
    p.probText = probBandText(p.prob.score);
    p.streakText = streakTagText(p.limitUp);
    p.streakBandText = p.limitUp && p.limitUp.prob != null ? streakBandText(p.limitUp.prob) : null;
  }
  const hmCfg = ctx && ctx.hotmoney || { seatPatterns: DEFAULT_HOTMONEY_SEAT_PATTERNS, doubleWeight: 2 };
  const hmPatterns = Array.isArray(hmCfg.seatPatterns) && hmCfg.seatPatterns.length ? hmCfg.seatPatterns : DEFAULT_HOTMONEY_SEAT_PATTERNS;
  const hmDbl = Number.isFinite(+hmCfg.doubleWeight) && +hmCfg.doubleWeight > 0 ? +hmCfg.doubleWeight : 2;
  if (ctx && ctx.seatsDetail) {
    for (const p of picks) {
      const net = hotMoneyNetWanOf(ctx.seatsDetail, p.code, hmPatterns);
      if (net > 0) {
        p.hotMoney = true;
        p.hotMoneyNetWan = net;
        const base = Number.isFinite(p.prob?.score) ? p.prob.score : Number.isFinite(p.score) ? p.score : 0;
        p.score = Math.round(Math.min(100, base * hmDbl) * 100) / 100;
        if (!Array.isArray(p.tags)) p.tags = [];
        if (!p.tags.includes("\u6E38\u8D44\u51C0\u4E70")) p.tags.push("\u6E38\u8D44\u51C0\u4E70");
      }
    }
  }
  if (Number.isFinite(+ctx.firstBoardReserve) && +ctx.firstBoardReserve > 0) {
    const reserve = Math.min(Math.floor(+ctx.firstBoardReserve), Math.max(0, picks.length));
    const isFirstBoard = (p) => Number.isFinite(+p.streak) && +p.streak <= 1;
    const inFirst = picks.filter(isFirstBoard).length;
    if (inFirst < reserve) {
      const need = reserve - inFirst;
      const ranked = (pred.picks || []).concat(pred.overflow || []);
      const candFirst = ranked.filter((p) => !picks.includes(p) && isFirstBoard(p)).sort((a, b) => (b.prob?.score ?? b.score ?? 0) - (a.prob?.score ?? a.score ?? 0));
      const toAdd = candFirst.slice(0, need);
      if (toAdd.length) {
        const nonFirst = picks.filter((p) => !isFirstBoard(p)).sort((a, b) => (a.prob?.score ?? a.score ?? 0) - (b.prob?.score ?? b.score ?? 0));
        const removeCodes = new Set(nonFirst.slice(0, toAdd.length).map((p) => p.code));
        picks = picks.filter((p) => !removeCodes.has(p.code)).concat(toAdd);
      }
    }
  }
  let note;
  if (!picks.length && pred.picks.length > 0) {
    note = {
      level: "blocked",
      text: `\u9884\u6D4B\u5F15\u64CE\u7B5B\u51FA ${pred.picks.length} \u53EA\uFF0C\u4F46\u7ECF\u60C5\u7EEA\u95F8\u95E8\u5168\u90E8\u62E6\u622A\uFF08\u9AD8\u6F6E\u677F\u5757\u524D\u6392\u9AD8\u6807\u7981\u63A8\u3001\u6216\u677F\u5757\u5185\u53BB\u5F31\u7559\u5F3A\u540E\u65E0\u8FBE\u6807\u6807\u7684\uFF09\uFF0C\u5F53\u524D\u4E0D\u63A8\u8350\u3002`
    };
  } else if (!candidates.length) {
    note = { level: "empty", text: "\u5F53\u65E5\u6CA1\u6709\u540C\u65F6\u6EE1\u8DB3\u300C\u9F99\u864E\u699C\u51C0\u4E70\u4E3A\u6B63\u300D\u6216\u300C\u6DA8\u505C\u300D\u7684\u6807\u7684\uFF0C\u672C\u65E5\u4E0D\u4EA7\u751F\u63A8\u8350\u3002" };
  } else if (!picks.length) {
    note = {
      level: "empty",
      text: `\u5F53\u65E5\u5019\u9009\u6C60 ${candidates.length} \u53EA\uFF0C\u4F46\u6309\u9884\u6D4B\u89C4\u5219\u5168\u90E8\u672A\u8FBE\u63A8\u8350\u95E8\u69DB\uFF08\u5254\u9664 ${pred.stats.rejected} \u53EA\u3001\u6982\u7387\u5206\u4E0D\u8DB3 ${pred.stats.minProb} \u7684 ${pred.stats.below} \u53EA\uFF09\u3002\u5B81\u53EF\u4E0D\u63A8\u8350\uFF0C\u4E5F\u4E0D\u63A8\u5927\u6982\u7387\u4E8F\u7684\u7968\u3002`
    };
  } else if (tier && !tier.allowNew) {
    note = {
      level: "blocked",
      text: `\u5F53\u524D\u5E02\u573A\u6863\u4F4D\u4E3A\u300C${tier.label}\u300D\uFF0C\u7CFB\u7EDF\u5EFA\u8BAE\u603B\u4ED3\u4F4D ${Math.round(tier.pos * 100)}%\u3001\u4E0D\u65B0\u5EFA\u4ED3\u3002\u4E0B\u5217\u6807\u7684\u4EC5\u4F9B\u89C2\u5BDF\uFF0C\u4E0D\u5EFA\u8BAE\u6B64\u65F6\u5EFA\u4ED3\u3002`
    };
  } else if (tier) {
    note = {
      level: "ok",
      text: `\u5F53\u524D\u5E02\u573A\u6863\u4F4D\u300C${tier.label}\u300D\uFF0C\u5EFA\u8BAE\u603B\u4ED3\u4F4D ${Math.round(tier.pos * 100)}%\uFF0C\u6309 ${picks.length} \u53EA\u5747\u5206\u5373\u6BCF\u53EA\u7EA6 ${(weight * 100).toFixed(1)}%\uFF08\u5355\u53EA\u4E0A\u9650 20%\uFF09\u3002` + (pred.stats.streakTop ? `\u5176\u4E2D ${pred.stats.streakTop} \u53EA T+1 \u8FDE\u677F\u6982\u7387 \u2265${pred.stats.streakTopMin}%\uFF0C\u5DF2\u7F6E\u9876\u5E76\u6253\u6807\u7B7E\u3002` : "\u5F53\u65E5\u65E0\u8FDE\u677F\u6982\u7387\u8FBE\u95E8\u69DB\u7684\u6807\u7684\u3002")
    };
  } else {
    note = { level: "unknown", text: "\u5E02\u573A\u60C5\u7EEA\u5206\u7F3A\u5931\uFF0C\u65E0\u6CD5\u7ED9\u51FA\u4ED3\u4F4D\u5EFA\u8BAE\uFF1B\u4E0B\u5217\u6807\u7684\u4EC5\u6309\u9884\u6D4B\u4E0A\u6DA8\u6982\u7387\u6392\u5E8F\u3002" };
  }
  return {
    tier,
    score: finite3(ctx.emotionScore) ? +ctx.emotionScore : null,
    picks,
    // 三个「非推荐」桶全部透出，保证进池的每一只票都能被用户看见，不被静默丢弃：
    //   rejected       —— 命中剔除规则（大概率亏），必须展示原因
    //   belowThreshold —— 概率分不足门槛（没把握，宁可不推）
    //   overflow       —— 达门槛但被 topN 截断（够格，只是名额有限）
    // 可交易性剔除（买不进的票）优先透出，再接预测引擎的剔除（总计 ≤12）
    rejected: trad.rejected.concat(pred.rejected).concat(clusterFilterNote ? [clusterFilterNote] : []).slice(0, 12),
    belowThreshold: pred.belowThreshold.slice(0, 8),
    overflow: pred.overflow.slice(0, 8),
    note,
    pool: candidates.length,
    asOf: d.trade_date || null,
    pred: pred.stats,
    version: PREDICT_VERSION,
    baseline: BASELINE_UP,
    streakBaseline: STREAK_BASELINE,
    // 情绪闸门产物：高潮预警横幅 / 高潮禁推的前排高标 / 板块内去弱留强被挤出的票
    climaxWarnings: gate.climaxWarnings,
    climaxBlocked: gate.climaxBlocked,
    sectorTrimmed: gate.sectorTrimmed
  };
}

// src/config.js
var isNode = typeof process !== "undefined" && !!(process.versions && process.versions.node) && typeof window === "undefined";
var cfg;
if (isNode) {
  const { readFileSync: readFileSync7 } = await Promise.resolve().then(() => (init_node_fs(), node_fs_exports));
  const { fileURLToPath: fileURLToPath4 } = await Promise.resolve().then(() => (init_node_url(), node_url_exports));
  const { dirname: dirname4, join: join5 } = await Promise.resolve().then(() => (init_node_path(), node_path_exports));
  const __dirname = dirname4(fileURLToPath4(import.meta.url));
  cfg = JSON.parse(readFileSync7(join5(__dirname, "..", "config.json"), "utf8"));
} else {
  try {
    const fromWindow = typeof window !== "undefined" && window.ASENT_CONFIG || null;
    if (fromWindow) {
      cfg = fromWindow;
    } else {
      const res = await fetch(new URL("config.json", document.baseURI));
      if (!res.ok) throw new Error("HTTP " + res.status);
      cfg = await res.json();
    }
  } catch (e) {
    console.error("[config] \u6D4F\u89C8\u5668\u4FA7\u52A0\u8F7D config.json \u5931\u8D25\uFF0C\u56DE\u9000\u7A7A\u914D\u7F6E\uFF1A", e && e.message);
    cfg = {};
  }
}
if (!(cfg.formulaVersion && typeof cfg.formulaVersion === "string")) {
  throw new Error("[config] formulaVersion \u7F3A\u5931\u6216\u975E\u5B57\u7B26\u4E32");
}
if (!cfg.params || !cfg.params.live || !cfg.params.train) {
  throw new Error("[config] params.live / params.train \u7F3A\u5931\uFF08\u53C2\u6570\u552F\u4E00\u4F4F\u6240\uFF0C\u4E0D\u5F97\u7701\u7565\uFF09");
}
var BLOCKS = ["weights", "thresholds", "stops", "lookback", "costModel"];
for (const side of ["live", "train"]) {
  for (const b of BLOCKS) {
    if (!cfg.params[side][b] || typeof cfg.params[side][b] !== "object") {
      throw new Error(`[config] params.${side}.${b} \u7F3A\u5931`);
    }
  }
  for (const b of BLOCKS) {
    const kl = Object.keys(cfg.params.live[b]).sort();
    const kt = Object.keys(cfg.params.train[b]).sort();
    if (JSON.stringify(kl) !== JSON.stringify(kt)) {
      throw new Error(`[config] params.${b} \u952E\u96C6\u5408 live \u4E0E train \u4E0D\u4E00\u81F4: ${kl} vs ${kt}`);
    }
  }
  const wsum = Object.values(cfg.params[side].weights).reduce((a, b) => a + (+b || 0), 0);
  if (Math.abs(wsum - 1) > 1e-9) {
    throw new Error(`[config] params.${side}.weights \u6743\u91CD\u548C\u5FC5\u987B\u4E3A 1, \u5B9E\u9645 ${wsum}`);
  }
  const th = ["panic", "hi", "lo", "overheat"].map((k) => +cfg.params[side].thresholds[k]);
  if (th.some((v) => !Number.isFinite(v)) || !(th[0] < th[1] && th[1] < th[2] && th[2] < th[3])) {
    throw new Error(`[config] params.${side}.thresholds \u5FC5\u987B\u4E3A\u5347\u5E8F\u56DB\u6863 panic < hi < lo < overheat`);
  }
}
if (typeof cfg.params.live.costModel.priceLimit?.enabled !== "boolean") {
  throw new Error("[config] params.live.costModel.priceLimit.enabled \u5FC5\u987B\u4E3A\u5E03\u5C14\uFF08\u6DA8\u8DCC\u505C\u7EA6\u675F\u5360\u4F4D\uFF09");
}
if (!Array.isArray(cfg.manualHolidays) || cfg.manualHolidays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
  throw new Error("[config] manualHolidays \u5FC5\u987B\u4E3A YYYY-MM-DD \u6570\u7EC4");
}
if (cfg.mainLine != null) {
  if (typeof cfg.mainLine !== "object" || Array.isArray(cfg.mainLine)) {
    throw new Error("[config] mainLine \u5FC5\u987B\u4E3A\u5BF9\u8C61");
  }
  const ML_NUMS = [
    ["lookback_days", 1],
    ["sigma_multiplier", 0],
    ["min_sample_days", 1]
  ];
  for (const [k, min] of ML_NUMS) {
    const v = cfg.mainLine[k];
    if (!Number.isFinite(+v) || +v < min) {
      throw new Error(`[config] mainLine.${k} \u5FC5\u987B\u4E3A \u2265${min} \u7684\u6709\u9650\u6570\uFF0C\u5B9E\u9645 ${v}`);
    }
  }
  if (+cfg.mainLine.min_sample_days > +cfg.mainLine.lookback_days) {
    throw new Error("[config] mainLine.min_sample_days \u4E0D\u5F97\u5927\u4E8E lookback_days\uFF08\u964D\u7EA7\u7EBF\u6C38\u8FDC\u4E0D\u53EF\u8FBE\uFF09");
  }
  const fb = cfg.mainLine.fixedFallback;
  if (fb == null || typeof fb !== "object" || !Number.isFinite(+fb.up_count_threshold) || +fb.up_count_threshold < 0 || !Number.isFinite(+fb.density_threshold) || +fb.density_threshold < 0 || +fb.density_threshold > 1) {
    throw new Error("[config] mainLine.fixedFallback \u5FC5\u987B\u542B up_count_threshold\u22650 \u4E0E density_threshold\u2208[0,1]");
  }
  if (cfg.mainLine.market_weak_volume_ratio != null && (!Number.isFinite(+cfg.mainLine.market_weak_volume_ratio) || +cfg.mainLine.market_weak_volume_ratio <= 0)) {
    throw new Error("[config] mainLine.market_weak_volume_ratio \u5FC5\u987B\u4E3A >0 \u7684\u6709\u9650\u6570");
  }
  if (cfg.mainLine.market_weak_index_below_ma != null && typeof cfg.mainLine.market_weak_index_below_ma !== "boolean") {
    throw new Error("[config] mainLine.market_weak_index_below_ma \u5FC5\u987B\u4E3A\u5E03\u5C14");
  }
  const ML_GATE = ["sentiment_old_dragon_drop", "sentiment_rise_pct", "weak_mode_threshold_boost", "dragon_retreat_density_boost"];
  for (const k of ML_GATE) {
    if (cfg.mainLine[k] != null && !Number.isFinite(+cfg.mainLine[k])) {
      throw new Error(`[config] mainLine.${k} \u5FC5\u987B\u4E3A\u6709\u9650\u6570`);
    }
  }
  if (cfg.mainLine.weak_mode_max_output != null && (!Number.isInteger(+cfg.mainLine.weak_mode_max_output) || +cfg.mainLine.weak_mode_max_output < 1)) {
    throw new Error("[config] mainLine.weak_mode_max_output \u5FC5\u987B\u4E3A \u22651 \u7684\u6574\u6570");
  }
  if (cfg.mainLine.atr_period != null && (!Number.isInteger(+cfg.mainLine.atr_period) || +cfg.mainLine.atr_period < 1)) {
    throw new Error("[config] mainLine.atr_period \u5FC5\u987B\u4E3A \u22651 \u7684\u6574\u6570");
  }
  if (cfg.mainLine.atr_low_threshold != null && !Number.isFinite(+cfg.mainLine.atr_low_threshold)) {
    throw new Error("[config] mainLine.atr_low_threshold \u5FC5\u987B\u4E3A\u6709\u9650\u6570");
  }
  if (cfg.mainLine.atr_high_threshold != null && !Number.isFinite(+cfg.mainLine.atr_high_threshold)) {
    throw new Error("[config] mainLine.atr_high_threshold \u5FC5\u987B\u4E3A\u6709\u9650\u6570");
  }
  if (cfg.mainLine.atr_low_threshold != null && cfg.mainLine.atr_high_threshold != null && +cfg.mainLine.atr_low_threshold > +cfg.mainLine.atr_high_threshold) {
    throw new Error("[config] mainLine.atr_low_threshold \u4E0D\u5F97\u5927\u4E8E atr_high_threshold\uFF08mid \u533A\u95F4\u4E3A\u7A7A\uFF09");
  }
  for (const k of ["weight_low_vol", "weight_mid_vol", "weight_high_vol"]) {
    if (cfg.mainLine[k] != null && (!Number.isFinite(+cfg.mainLine[k]) || +cfg.mainLine[k] < 0)) {
      throw new Error(`[config] mainLine.${k} \u5FC5\u987B\u4E3A \u22650 \u7684\u6709\u9650\u6570`);
    }
  }
}
var __freeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === "object") __freeze(v);
  return Object.freeze(o);
};
var LIVE = __freeze(cfg.params.live);
var TRAIN = cfg.params.train;
var out = { ...cfg };
out.params = { live: LIVE, train: TRAIN, governance: cfg.params.governance };
out.paper = cfg.paper || { autoSinglePct: 0.1 };
out.weights = LIVE.weights;
out.lookback = LIVE.lookback;
out.backtest = {
  ...cfg.backtest,
  thresholds: LIVE.thresholds,
  costs: LIVE.costModel,
  rolling: LIVE.lookback.rolling,
  maxPos: LIVE.stops.maxPos,
  stopLoss: LIVE.stops.stopLoss,
  ddTrigger: LIVE.stops.ddTrigger,
  maxPosChg: LIVE.stops.maxPosChg,
  // 控制台新增参数镜像（2026-10-28）：与 params.live.stops 逐位相等，杜绝第二份口径
  sentimentPenalty: LIVE.stops.sentimentPenalty,
  clusterRiseMax: LIVE.stops.clusterRiseMax,
  openGapFilterPct: LIVE.stops.openGapFilterPct,
  trailingStopPct: LIVE.stops.trailingStopPct,
  // 移动止盈回撤比例（控制台 2026-10-29）
  trailingTriggerPct: LIVE.stops.trailingTriggerPct
  // 移动止盈激活阈值（控制台 2026-10-29）
};
out.momentumRecent = LIVE.lookback.momentumRecent;
out.momentumPrev = LIVE.lookback.momentumPrev;
out.mainLine = cfg.mainLine || {
  lookback_days: 60,
  sigma_multiplier: 1,
  min_sample_days: 20,
  fixedFallback: { up_count_threshold: 6, density_threshold: 0.1 }
};
var config_default = out;

// src/alerts.js
var RISK = config_default.backtest;
var MARKET_CFG = {
  band: 0.1,
  minActionPos: 0.05
};
var POS_CFG = {
  stopLoss: Number.isFinite(+RISK.stopLoss) ? +RISK.stopLoss : -0.08,
  ddTrigger: Number.isFinite(+RISK.ddTrigger) ? +RISK.ddTrigger : -0.15,
  concMax: 0.2,
  nearStopRatio: 0.6,
  ddArmPct: 0.08,
  effMinPct: 0.1,
  /** 回撤降仓比例（该票可卖数量的比例）——与 src/paper.js CUT_TIERS 的「减 1/2」一致 */
  cutPct: 0.5
};
var LEVELS = ["risk", "opp", "tip"];
var finite4 = (v) => v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(+v);
var yuan = (v) => finite4(v) ? Math.round(+v).toLocaleString("en-US") : "0";
var pp = (v, d = 1) => `${(+v * 100).toFixed(d)}%`;
var pp0 = (v) => pp(v, 0);
var sp = (v, d = 1) => `${+v > 0 ? "+" : ""}${(+v * 100).toFixed(d)}%`;
function marketAlerts({ emotionScore, total, marketValue } = {}) {
  const out2 = [];
  const tier = marketTier(emotionScore);
  const T = finite4(total) ? +total : 0;
  const MV = finite4(marketValue) ? +marketValue : 0;
  const cur = T > 0 ? MV / T : 0;
  const base = {
    layer: "market",
    weight: 0,
    quote: {
      "\u60C5\u7EEA\u5206": finite4(emotionScore) ? (+emotionScore).toFixed(1) : "\u7F3A\u5931",
      "\u5E02\u573A\u6863\u4F4D": tier ? tier.label : "\u672A\u77E5",
      "\u5EFA\u8BAE\u603B\u4ED3\u4F4D": tier ? pp0(tier.pos) : "\u65E0\u6CD5\u7ED9\u51FA\uFF08\u60C5\u7EEA\u5206\u7F3A\u5931\uFF09",
      "\u5F53\u524D\u6301\u4ED3\u5360\u6BD4": T > 0 ? pp(cur, 1) : "\u65E0\u8D44\u4EA7",
      "\u6301\u4ED3\u5E02\u503C": `${yuan(MV)} \u5143`,
      "\u603B\u8D44\u4EA7": `${yuan(T)} \u5143`
    }
  };
  if (!tier) {
    out2.push({
      ...base,
      level: "tip",
      type: "market-unknown",
      action: "watch",
      text: "\u5E02\u573A\u60C5\u7EEA\u5206\u7F3A\u5931\uFF0C\u65E0\u6CD5\u5224\u5B9A\u6863\u4F4D\uFF0C\u672C\u65E5\u4E0D\u7ED9\u5927\u76D8\u4ED3\u4F4D\u5EFA\u8BAE\uFF08\u4E0D\u731C\u6863\uFF09\u3002",
      why: "\u6863\u4F4D\u7531\u4E03\u56E0\u5B50\u60C5\u7EEA\u5206\u6309 \u226580 \u8FC7\u70ED / \u226565 \u6EE1\u4ED3 / 24~65 \u534A\u4ED3 / \u226424 \u6E05\u4ED3 \u5212\u6863\uFF1B\u60C5\u7EEA\u5206\u672A\u7B97\u51FA\u65F6\u4EFB\u4F55\u4ED3\u4F4D\u5EFA\u8BAE\u90FD\u662F\u65E0\u4F9D\u636E\u7684\u3002"
    });
    return out2;
  }
  const gap = cur - tier.pos;
  if (tier.key === "clear") {
    if (MV > 0) {
      out2.push({
        ...base,
        level: "risk",
        type: "market-exit",
        action: "clear",
        weight: 90,
        text: `\u60C5\u7EEA\u5206 ${(+emotionScore).toFixed(1)} \u2264 ${TIER_THRESHOLDS.half} \u2192 \u5E02\u573A\u6863\u4F4D\u300C\u6E05\u4ED3\u300D\uFF0C\u5EFA\u8BAE\u7A7A\u4ED3\uFF1B\u5F53\u524D\u4ECD\u6301\u6709 ${pp(cur, 1)}\uFF08${yuan(MV)} \u5143\uFF09\uFF0C\u5E94\u6E05\u4ED3\u79BB\u573A\u3002`,
        why: `\u6E05\u4ED3\u6863\u9608\u503C\u4E3A\u60C5\u7EEA\u5206 \u2264 ${TIER_THRESHOLDS.half}\uFF08\u4E0E V5.2 \u56DE\u6D4B\u5F15\u64CE\u540C\u4E00\u9608\u503C\u8868\uFF09\uFF0C\u8BE5\u533A\u95F4\u5386\u53F2\u4E0A\u5C5E\u4E8E\u60C5\u7EEA\u51B0\u70B9\uFF0C\u6301\u6709\u98CE\u9669\u663E\u8457\u5927\u4E8E\u673A\u4F1A\u3002`
      });
    } else {
      out2.push({
        ...base,
        level: "tip",
        type: "market-stay-flat",
        action: "hold",
        weight: 40,
        text: `\u5E02\u573A\u6863\u4F4D\u300C\u6E05\u4ED3\u300D\uFF0C\u5EFA\u8BAE\u7A7A\u4ED3\uFF1B\u5F53\u524D\u5DF2\u7A7A\u4ED3\uFF0C\u4FDD\u6301\u4E0D\u65B0\u5EFA\u5373\u53EF\u3002`,
        why: `\u60C5\u7EEA\u5206 \u2264 ${TIER_THRESHOLDS.half} \u5224\u4E3A\u6E05\u4ED3\u6863\uFF0C\u6B64\u65F6\u4E0D\u65B0\u5EFA\u4ED3\u5373\u662F\u6B63\u786E\u64CD\u4F5C\uFF0C\u65E0\u9700\u989D\u5916\u52A8\u4F5C\u3002`
      });
    }
    return out2;
  }
  if (tier.key === "overheat") {
    const over = cur - tier.pos;
    if (over > MARKET_CFG.band) {
      const targetMV = T * tier.pos;
      const cutMV = Math.max(0, MV - targetMV);
      out2.push({
        ...base,
        level: "risk",
        type: "market-trim",
        action: "reduce",
        weight: 85,
        text: `\u60C5\u7EEA\u5206 ${(+emotionScore).toFixed(1)} \u2265 ${TIER_THRESHOLDS.overheat} \u2192 \u5E02\u573A\u6863\u4F4D\u300C${tier.label}\u300D\uFF0C\u5EFA\u8BAE\u603B\u4ED3\u4F4D\u964D\u81F3 ${pp0(tier.pos)}\uFF1B\u5F53\u524D ${pp(cur, 1)}\uFF0C\u8D85\u51FA ${pp(over, 1)}\uFF08\u7EA6 ${yuan(cutMV)} \u5143\uFF09\u3002`,
        why: `\u8FC7\u70ED\u6863\u7684\u7EAA\u5F8B\u662F\u300C\u53EA\u51CF\u4ED3\u3001\u4E0D\u65B0\u5EFA\u300D\u2014\u2014\u9AD8\u4F4D\u52A0\u4ED3\u7684\u671F\u671B\u6536\u76CA\u4E3A\u8D1F\u3002\u6863\u4F4D\u9608\u503C \u2265 ${TIER_THRESHOLDS.overheat} \u5206\uFF0C\u4E0E V5.2 \u5F15\u64CE\u540C\u6E90\u3002`
      });
    } else {
      out2.push({
        ...base,
        level: "tip",
        type: "market-no-new",
        action: "watch",
        weight: 50,
        text: `\u5E02\u573A\u6863\u4F4D\u300C${tier.label}\u300D\uFF0C\u4ED3\u4F4D ${pp(cur, 1)} \u672A\u8D85 ${pp0(tier.pos)}\uFF0C\u4F46**\u8FC7\u70ED\u6863\u53EA\u51CF\u4ED3\u4E0D\u65B0\u5EFA**\uFF0C\u4E0D\u518D\u4E70\u5165\u3002`,
        why: `\u60C5\u7EEA\u5206 \u2265 ${TIER_THRESHOLDS.overheat} \u65F6\u65B0\u589E\u4ED3\u4F4D\u7684\u98CE\u9669\u6536\u76CA\u6BD4\u4E0D\u4F73\uFF0C\u5F15\u64CE\u4E0D\u7ED9\u51FA\u52A0\u4ED3\u5EFA\u8BAE\uFF08\u5373\u4FBF\u5F53\u524D\u4ED3\u4F4D\u4F4E\u4E8E\u5EFA\u8BAE\u503C\uFF09\u3002`
      });
    }
    return out2;
  }
  if (gap > MARKET_CFG.band) {
    const targetMV = T * tier.pos;
    const cutMV = Math.max(0, MV - targetMV);
    const strong = gap >= MARKET_CFG.minActionPos;
    out2.push({
      ...base,
      level: strong ? "risk" : "tip",
      type: "market-trim",
      action: "reduce",
      weight: strong ? 70 : 45,
      text: `\u5E02\u573A\u6863\u4F4D\u300C${tier.label}\u300D\u5EFA\u8BAE\u603B\u4ED3\u4F4D ${pp0(tier.pos)}\uFF0C\u5F53\u524D ${pp(cur, 1)}\uFF0C\u8D85\u914D ${pp(gap, 1)}\uFF08\u7EA6 ${yuan(cutMV)} \u5143\uFF09\uFF0C${strong ? "\u5E94\u51CF\u4ED3\u81F3\u5EFA\u8BAE\u4ED3\u4F4D" : "\u7565\u8D85\u5EFA\u8BAE\u4ED3\u4F4D\uFF0C\u53EF\u62E9\u673A\u5FAE\u8C03"}\u3002`,
      why: `\u6EE1\u4ED3\u6863\u5EFA\u8BAE 100%\u3001\u534A\u4ED3\u6863\u5EFA\u8BAE 50%\uFF08\u4E0E V5.2 \u5F15\u64CE\u4ED3\u4F4D\u6863\u4F4D\u540C\u6E90\uFF09\u3002\u504F\u79BB\u8D85\u8FC7\u5BB9\u5FCD\u5E26 ${pp0(MARKET_CFG.band)} \u5373\u63D0\u793A\uFF1B\u8D85\u8FC7 ${pp0(MARKET_CFG.minActionPos)} \u624D\u5347\u7EA7\u4E3A\u98CE\u9669\u7EA7\u2014\u2014\u4F4E\u4E8E\u8FD9\u4E2A\u5DEE\u989D\uFF0C100 \u80A1\u6574\u624B\u7EA6\u675F\u4E0B\u5E38\u5E38\u6839\u672C\u8C03\u6574\u4E0D\u4E86\u3002`
    });
  } else if (gap < -MARKET_CFG.band) {
    const addMV = Math.max(0, T * tier.pos - MV);
    out2.push({
      ...base,
      level: "opp",
      type: "market-add",
      action: "add",
      weight: 65,
      text: `\u5E02\u573A\u6863\u4F4D\u300C${tier.label}\u300D\u5EFA\u8BAE\u603B\u4ED3\u4F4D ${pp0(tier.pos)}\uFF0C\u5F53\u524D\u4EC5 ${pp(cur, 1)}\uFF0C\u4F4E\u4E8E\u5EFA\u8BAE ${pp(-gap, 1)}\uFF08\u7EA6 ${yuan(addMV)} \u5143\u53EF\u52A0\u4ED3\u7A7A\u95F4\uFF09\u3002`,
      why: `\u60C5\u7EEA\u5206 ${(+emotionScore).toFixed(1)} \u843D\u5728\u300C${tier.label}\u300D\u533A\u95F4\uFF08\u9608\u503C\u8868 \u2265${TIER_THRESHOLDS.overheat} \u8FC7\u70ED / \u2265${TIER_THRESHOLDS.full} \u6EE1\u4ED3 / ${TIER_THRESHOLDS.half}~${TIER_THRESHOLDS.full} \u534A\u4ED3\uFF09\uFF0C\u6863\u4F4D\u5141\u8BB8\u65B0\u5EFA\u4ED3\uFF1B\u52A0\u4ED3\u65B9\u5411\u7531\u300C\u7814\u5224\u63A8\u8350\u300D\u5C0F\u6A21\u5757\u6309\u8D44\u91D1\u8BC1\u636E\u7ED9\u51FA\u5177\u4F53\u6807\u7684\uFF08\u672C\u5F15\u64CE\u4E0D\u8350\u80A1\uFF09\u3002`
    });
  } else {
    out2.push({
      ...base,
      level: "tip",
      type: "market-on-target",
      action: "hold",
      weight: 20,
      text: `\u4ED3\u4F4D ${pp(cur, 1)} \u4E0E\u6863\u4F4D\u5EFA\u8BAE ${pp0(tier.pos)} \u8D34\u5408\uFF08\u5DEE\u8DDD\u5728 ${pp0(MARKET_CFG.band)} \u5BB9\u5FCD\u5E26\u5185\uFF09\uFF0C\u65E0\u9700\u8C03\u6574\u603B\u4ED3\u4F4D\u3002`,
      why: `\u5BB9\u5FCD\u5E26\u7528\u4E8E\u5438\u6536\u96F6\u624B\u4E0E\u5EFA\u4ED3\u65E5\u4EF7\u683C\u6CE2\u52A8\u9020\u6210\u7684\u65E5\u5E38\u6296\u52A8\uFF0C\u907F\u514D\u53CD\u590D\u63D0\u793A\u540C\u4E00\u4E2A\u300C\u4E0D\u7528\u505A\u300D\u7684\u7ED3\u8BBA\u3002`
    });
  }
  return out2;
}
function positionAlerts({ positions, stats, tier, pickCodes } = {}) {
  const out2 = [];
  const pos = positions && typeof positions === "object" ? positions : {};
  const T = stats && finite4(stats.total) && +stats.total > 0 ? +stats.total : 0;
  const pickSet = new Set(Array.isArray(pickCodes) ? pickCodes.map(String) : []);
  for (const [code, p] of Object.entries(pos)) {
    if (!p || !(p.qty > 0)) continue;
    const name = p.name || code;
    const last = finite4(p.last) ? +p.last : null;
    const avgCost = finite4(p.avgCost) ? +p.avgCost : null;
    const qty = +p.qty;
    const avail = Math.max(0, Math.floor(+p.avail || 0));
    const frozenSell = 0;
    const freeSell = Math.max(0, avail - frozenSell);
    const mv = last != null ? last * qty : avgCost != null ? avgCost * qty : 0;
    const cost = finite4(p.cost) ? +p.cost : avgCost != null ? avgCost * qty : 0;
    const pnl = mv - cost;
    const pnlPct = cost > 0 ? pnl / cost : 0;
    const conc = T > 0 ? mv / T : 0;
    const quote = {
      "\u6240\u5C5E\u5C42": "\u6301\u4ED3",
      "\u4EE3\u7801": code,
      "\u540D\u79F0": name,
      "\u6301\u4ED3/\u53EF\u5356": `${qty} / ${avail} \u80A1`,
      "\u6210\u672C\u5747\u4EF7": avgCost != null ? `${avgCost.toFixed(3)} \u5143` : "\u2014",
      "\u6700\u65B0\u4EF7": last != null ? `${last.toFixed(2)} \u5143${p.pxStale ? "\uFF08\u65E0\u5F53\u65E5\u884C\u60C5\uFF0C\u6309\u6700\u8FD1\u4EF7\u4F30\uFF09" : ""}` : "\u2014",
      "\u6D6E\u52A8\u76C8\u4E8F": `${yuan(pnl)} \u5143\uFF08${sp(pnlPct)}\uFF09`,
      "\u5360\u603B\u8D44\u4EA7": T > 0 ? pp(conc, 1) : "\u2014"
    };
    const base = { layer: "position", code, name, quote, heldQty: qty };
    const brokeStop = pnlPct <= POS_CFG.stopLoss;
    if (brokeStop) {
      out2.push({
        ...base,
        level: "risk",
        type: "pos-stop-loss",
        action: "sell",
        weight: 100,
        // qty 必须严格等于**可卖**数量：写成 `freeSell || qty` 会在可卖为 0 时回退成全部持仓，
        // 于是预警给出「卖出 100 股」，用户照着下单却被 T+1 拒绝——这是最坏的一类误导。
        // 可卖为 0 时报 0，并在文案里说明原因（下面的 T+1 条目会补全理由）。
        qty: freeSell,
        text: `${name}\uFF08${code}\uFF09\u6D6E\u4E8F ${sp(pnlPct)} \u5DF2\u51FB\u7A7F\u6B62\u635F\u7EBF ${sp(POS_CFG.stopLoss)}\uFF0C\u6309\u7EAA\u5F8B\u5E94\u6B62\u635F\u79BB\u573A${freeSell ? `\uFF08\u53EF\u5356 ${freeSell} \u80A1\uFF09` : "\uFF08\u5F53\u524D\u65E0\u53EF\u5356\u6570\u91CF\uFF0C\u89C1 T+1 \u63D0\u793A\uFF09"}\u3002`,
        why: `\u6B62\u635F\u7EBF ${sp(POS_CFG.stopLoss)} \u4E0E V5.2 \u56DE\u6D4B\u5F15\u64CE\u7684\u98CE\u63A7\u53C2\u6570\u540C\u6E90\uFF08src/config.js backtest.stopLoss\uFF09\u3002\u6D6E\u4E8F = \uFF08\u6700\u65B0\u4EF7 ${last != null ? last.toFixed(2) : "\u2014"} \u2212 \u6210\u672C\u5747\u4EF7 ${avgCost != null ? avgCost.toFixed(3) : "\u2014"}\uFF09\xF7 \u6210\u672C\u5747\u4EF7 = ${sp(pnlPct)}\u3002`
      });
    } else if (pnlPct <= POS_CFG.stopLoss * POS_CFG.nearStopRatio) {
      out2.push({
        ...base,
        level: "tip",
        type: "pos-near-stop",
        action: "watch",
        weight: 55,
        text: `${name}\uFF08${code}\uFF09\u6D6E\u4E8F ${sp(pnlPct)}\uFF0C\u5DF2\u8FBE\u6B62\u635F\u7EBF ${sp(POS_CFG.stopLoss)} \u7684 ${Math.round(POS_CFG.nearStopRatio * 100)}%\uFF0C\u8BF7\u76EF\u4F4F\u3002`,
        why: `\u63A5\u8FD1\u7EBF\u8BBE\u4E3A\u6B62\u635F\u7EBF\u7684 ${Math.round(POS_CFG.nearStopRatio * 100)}%\uFF08\u5373 ${sp(POS_CFG.stopLoss * POS_CFG.nearStopRatio)}\uFF09\uFF0C\u76EE\u7684\u662F\u7ED9\u300C\u51C6\u5907\u6B62\u635F\u300D\u7559\u51FA\u53CD\u5E94\u65F6\u95F4\uFF0C\u800C\u4E0D\u662F\u7B49\u5230\u51FB\u7A7F\u624D\u7B2C\u4E00\u6B21\u63D0\u9192\u3002`
      });
    }
    if (!brokeStop && T > 0 && conc > POS_CFG.concMax) {
      const targetMV = T * POS_CFG.concMax;
      const cutMV = mv - targetMV;
      const cutQtyRaw = last && last > 0 ? Math.floor(cutMV / last / 100) * 100 : 0;
      const cutQty = Math.min(freeSell, Math.max(0, cutQtyRaw));
      out2.push({
        ...base,
        level: "risk",
        type: "pos-concentration",
        action: "reduce",
        weight: 75,
        qty: cutQty,
        text: `${name}\uFF08${code}\uFF09\u5360\u8D26\u6237 ${pp(conc, 1)}\uFF0C\u8D85\u8FC7\u5355\u7968\u4E0A\u9650 ${pp0(POS_CFG.concMax)}\uFF08\u5E02\u503C ${yuan(mv)} \u5143 / \u603B\u8D44\u4EA7 ${yuan(T)} \u5143\uFF09${cutQty ? `\uFF0C\u5EFA\u8BAE\u51CF ${cutQty} \u80A1\u81F3\u4E0A\u9650\u9644\u8FD1` : "\uFF0C\u4F46\u5F53\u524D\u53EF\u5356\u6570\u91CF\u4E0D\u8DB3\uFF0C\u89C1 T+1 \u63D0\u793A"}\u3002`,
        why: `\u5355\u7968\u4E0A\u9650 ${pp0(POS_CFG.concMax)} \u4E0E\u300C\u7814\u5224\u63A8\u8350\u300D\u7684\u4E2A\u80A1\u5EFA\u8BAE\u4ED3\u4F4D\u4E0A\u9650\uFF08picks.suggestWeight \u7684 perStockCap\uFF09\u4E00\u81F4\uFF1A\u7CFB\u7EDF\u7ED9\u4E0D\u51FA\u300C\u8FD9\u53EA\u8BE5\u6BD4\u90A3\u53EA\u591A\u62FF\u300D\u7684\u53EF\u9760\u4F9D\u636E\uFF0C\u56E0\u6B64\u5168\u7CFB\u7EDF\u7EDF\u4E00\u6309\u7B49\u6743 + 20% \u5C01\u9876\u3002\u5355\u7968\u8D85\u914D\u4F1A\u8BA9\u8D26\u6237\u6536\u76CA\u88AB\u4E00\u53EA\u7968\u7684\u4E2A\u4F53\u98CE\u9669\u4E3B\u5BFC\uFF0C\u4E0E\u300C\u5206\u6563\u300D\u81EA\u76F8\u77DB\u76FE\u3002`
      });
    }
    if (qty > avail) {
      const locked = qty - avail;
      out2.push({
        ...base,
        level: "tip",
        type: "pos-t1-locked",
        action: "wait",
        weight: 35,
        qty: 0,
        text: `${name}\uFF08${code}\uFF09\u6301\u4ED3 ${qty} \u80A1\u4E2D ${locked} \u80A1\u5F53\u65E5\u4E70\u5165\u672A\u89E3\u51BB\uFF0C\u4ECA\u65E5\u4E0D\u53EF\u5356\uFF1B\u53EF\u5356 ${avail} \u80A1\uFF0C\u6B21\u4E00\u4EA4\u6613\u65E5\u81EA\u52A8\u89E3\u51BB\u3002`,
        why: `A \u80A1 T+1\uFF1AsettleDay \u53EA\u5728\u300C\u660E\u786E\u7684\u6210\u4EA4\u65E5\u300D\u89E3\u51BB\uFF08\u6301\u4ED3\u5B57\u6BB5 lastBuyDate \u2260 \u7ED3\u7B97\u65E5\u624D\u628A avail \u7F6E\u4E3A qty\uFF09\u3002\u8FD9\u4E0D\u662F\u9650\u5236\uFF0C\u800C\u662F\u5982\u5B9E\u544A\u77E5\u2014\u2014\u907F\u514D\u7528\u6237\u4E0B\u4E86\u5356\u5355\u5374\u56E0\u53EF\u5356\u4E0D\u8DB3\u88AB\u62D2\u3002`
      });
    }
    if (tier && tier.allowNew && conc >= POS_CFG.concMax * 0.8) {
      out2.push({
        ...base,
        level: "tip",
        type: "pos-at-target",
        action: "hold",
        weight: 25,
        text: `${name}\uFF08${code}\uFF09\u5DF2\u8FBE\u5355\u7968\u76EE\u6807\u4ED3\u4F4D\u9644\u8FD1\uFF08${pp(conc, 1)} / \u4E0A\u9650 ${pp0(POS_CFG.concMax)}\uFF09\uFF0C\u6301\u6709\u5373\u53EF\uFF0C\u4E0D\u518D\u52A0\u4ED3\u3002`,
        why: `\u5F53\u524D\u5E02\u573A\u6863\u4F4D\u300C${tier.label}\u300D\u5141\u8BB8\u65B0\u5EFA\uFF0C\u4F46\u5355\u7968\u4E0A\u9650 ${pp0(POS_CFG.concMax)} \u662F\u786C\u7EA6\u675F\uFF1B\u628A\u4ED3\u4F4D\u52A0\u6EE1\u4E00\u53EA\u7968\u4F1A\u727A\u7272\u5206\u6563\u5EA6\uFF0C\u6536\u76CA\u5E76\u4E0D\u56E0\u6B64\u66F4\u597D\u3002`
      });
    }
    if (pickSet.size > 0 && !pickSet.has(String(code))) {
      out2.push({
        ...base,
        level: "tip",
        type: "pos-not-in-picks",
        action: "watch",
        weight: 15,
        text: `${name}\uFF08${code}\uFF09\u4E0D\u5728\u4ECA\u65E5\u7814\u5224\u63A8\u8350\u6C60\u5185`,
        why: `\u4ECA\u65E5\u63A8\u8350\u6C60\u7531\u300C\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70\u4E3A\u6B63\u6216\u6DA8\u505C\u300D\u7B5B\u51FA\uFF08\u533A\u95F4\u7D2F\u8BA1\u699C\u4E0E\u65B0\u80A1\u5DF2\u5254\u9664\uFF09\u3002\u4E0D\u5728\u6C60\u5185\u53EA\u8BF4\u660E\u300C\u4ECA\u5929\u6CA1\u6709\u65B0\u7684\u8D44\u91D1\u8BC1\u636E\u652F\u6301\u52A0\u4ED3\u300D\uFF0C**\u4E0D\u6784\u6210\u5356\u51FA\u4F9D\u636E**\u2014\u2014\u6301\u4ED3\u51B3\u7B56\u4ECD\u770B\u6210\u672C\u3001\u6B62\u635F\u7EBF\u4E0E\u6863\u4F4D\u3002`
      });
    }
    if (p.pxStale || last == null) {
      out2.push({
        ...base,
        level: "tip",
        type: "pos-stale-px",
        action: "watch",
        weight: 30,
        text: `${name}\uFF08${code}\uFF09\u53D6\u4E0D\u5230\u5F53\u65E5\u771F\u5B9E\u884C\u60C5\uFF08\u505C\u724C\u6216\u6570\u636E\u7F3A\u5931\uFF09\uFF0C\u5E02\u503C\u6309${last != null ? "\u6700\u8FD1\u6210\u4EA4\u4EF7" : "\u6210\u672C\u4EF7"}\u4F30\u7B97\uFF0C\u6D6E\u76C8\u4E0E\u5360\u6BD4\u53EF\u80FD\u5931\u771F\u3002`,
        why: `\u8D26\u6237\u5E02\u503C\u53E3\u5F84\uFF1A\u6709\u6700\u65B0\u4EF7\u6309\u6700\u65B0\u4EF7\u3001\u65E0\u4EF7\u6309\u6210\u672C\uFF08src/paper.js accountStats\uFF09\u3002\u65E0\u4EF7\u65F6\u8BE5\u7968\u7684\u6D6E\u52A8\u76C8\u4E8F\u4E0E\u4ED3\u4F4D\u5360\u6BD4\u90FD\u662F\u4F30\u7B97\u503C\uFF0C\u4E0D\u5E94\u636E\u6B64\u505A\u5F3A\u5224\u65AD\u3002`
      });
    }
    if (isNetOutflow(p.netWan).hit) {
      const v = p.netWan;
      const amt = v == null ? "\u5F53\u65E5\u9F99\u864E\u699C\u65E0\u51C0\u4E70\u8BB0\u5F55" : v < 0 ? `\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70 \u2212${(Math.abs(+v) / 1e4).toFixed(2)} \u4EBF` : "\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70\u4E3A 0";
      out2.push({
        ...base,
        level: "tip",
        type: "pos-net-outflow",
        action: "watch",
        weight: 40,
        netWan: v == null ? null : +v,
        text: `${name}\uFF08${code}\uFF09${FLAG_LHB.NET_OUTFLOW} \u2014\u2014 ${amt}\u3002${qty > 0 ? "\u6301\u4ED3\u5DF2\u5728\uFF0C" : ""}\u5982\u9700\u52A0\u4ED3\u8BF7\u5148\u4EBA\u5DE5\u590D\u6838\uFF0C\u4E0D\u8981\u7167\u63A8\u8350\u4F4D\u6B21\u76F4\u63A5\u4E0B\u5355\u3002`,
        why: `\u5224\u636E\uFF1A\u4E2A\u80A1\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70\u5165 \u2264 0\uFF08\u4E0E\u300C\u7814\u5224\u63A8\u8350\u300D\u7684\u964D\u7EA7\u89C4\u5219\u540C\u4E00\u6761\uFF0C\u552F\u4E00\u51FA\u5904 src/lhbfilter.js::isNetOutflow\uFF09\u3002\u8BE5\u7968\u5728\u63A8\u8350\u94FE\u8DEF\u91CC\u4F1A\u88AB\u6263\u7EFC\u5408\u5206/\u4E0A\u6DA8\u6982\u7387\u3001\u964D\u5230\u5907\u9009\u89C2\u5BDF\u6C60\uFF08\u7981\u6B62\u81EA\u52A8\u4E0B\u5355\uFF09\uFF0C\u5E76\u8981\u6C42\u4EBA\u5DE5\u590D\u6838\u540E\u624D\u5141\u8BB8\u4E0B\u5355\u3002**\u51C0\u6D41\u51FA\u4E0D\u7B49\u4E8E\u6B21\u65E5\u5FC5\u8DCC**\uFF0C\u7CFB\u7EDF\u56E0\u6B64\u53EA\u6807\u98CE\u9669\u3001\u4E0D\u7981\u59D4\u6258\u3002`
      });
    }
  }
  return out2;
}
function buildAlerts({ emotionScore, account, stats, pickCodes, asOf, limit } = {}) {
  const tier = marketTier(emotionScore);
  const st = stats || (account ? accountStatsLite(account) : null) || { total: 0, marketValue: 0, cash: 0 };
  const raw = [
    ...marketAlerts({ emotionScore, total: st.total, marketValue: st.marketValue }),
    ...positionAlerts({ positions: account?.positions, stats: st, tier, pickCodes })
  ];
  const lv = (l) => LEVELS.indexOf(l);
  const sorted = raw.map((a, i) => ({ ...a, _i: i })).sort((a, b) => lv(a.level) - lv(b.level) || (b.weight || 0) - (a.weight || 0) || String(a.code || "").localeCompare(String(b.code || "")) || a._i - b._i).map(({ _i, ...a }) => a);
  const counts = { risk: 0, opp: 0, tip: 0 };
  for (const a of sorted) counts[a.level] = (counts[a.level] || 0) + 1;
  const cap = finite4(limit) && +limit > 0 ? Math.floor(+limit) : 12;
  const alerts = sorted.slice(0, cap);
  return {
    asOf: asOf || null,
    tier,
    score: finite4(emotionScore) ? +emotionScore : null,
    alerts,
    counts,
    total: sorted.length,
    truncated: sorted.length > alerts.length
  };
}
function accountStatsLite(acct) {
  const positions = Object.values(acct?.positions || {});
  const marketValue = positions.reduce((a, p) => a + (p.last != null ? p.last * p.qty : (p.avgCost || 0) * p.qty), 0);
  const cash = +acct?.cash || 0;
  const freeze = +acct?.freeze || 0;
  return { cash, freeze, marketValue, total: cash + freeze + marketValue };
}

// src/paper.js
var PAPER_VERSION = "paper-v1";
var LOT = 100;
var MIN_COMMISSION = 5;
var COMMISSION_RATE = 3e-4;
var TRANSFER_FEE_RATE = 1e-5;
var STAMP_TAX_RATE = 5e-4;
var DEFAULT_SLIP = 2e-4;
var EXEC_DEFAULTS = {
  mode: "ideal",
  slipNonLimit: 0.01,
  limitCancelRate: 0.3,
  limitCapacityRatio: 0.1,
  sectorLimitRatio: 0,
  seed: 20261024,
  // ── 滑点剖面插件（执行层·可配置挂件，slipModel 开关对比基线）──
  //   slipModel:
  //     'flat'   = 基线：沿用旧行为（理想模式万二、悲观模式 ±1%），不改任何历史回测数字。
  //     'profile'= 差异化滑点：按「标的类型(连板小票 small / 趋势中大票 trend) × 开仓/平仓 × 涨停买入/跌停卖出特殊规则」取滑点。
  slipModel: "flat",
  slipLimitUpBuy: 0,
  // 涨停板买入特殊：按涨停价成交，滑点≈0（容量/撤单由 limitBuyOutcome 另管）
  slipOpenSmall: 0.012,
  // 开仓·连板小票流动性滑点（追涨冲击大）
  slipOpenTrend: 3e-3,
  // 开仓·趋势中大票滑点（流动性好）
  slipCloseSmall: 8e-3,
  // 平仓·连板小票滑点
  slipCloseTrend: 3e-3,
  // 平仓·趋势中大票滑点
  slipCloseLimitDown: 0.02,
  // 跌停卖出特殊：流动性枯竭，被迫折价
  tranche: 1,
  // 分批建仓：把单票 pct 拆成 N 日等额建仓（1=不拆）
  // ── 涨跌停排队成交概率插件（执行层·可配置挂件，limitFillProb 开关，默认关）──
  //   默认关=沿用旧逻辑；开启后更贴实盘排队现实：涨停买入按前排比例概率成交、余单当日撤单；
  //   跌停卖出按成交概率成交、未成交则排队次日重试；保守档把比例设 0 即封死涨跌停开平仓。
  limitFillProb: false,
  // 总开关
  limitUpFillRatio: 0.5,
  // 涨停买入前排成交比例（0~1）
  limitDownFillProb: 0.5,
  // 跌停卖出成交概率（0~1）
  // ── 动态成交量冲击滑点 + 单笔成交量上限（执行层·随 --slip-model profile 生效）──
  volImpactCoef: 0.02,
  // 冲击系数：名义额达到参考成交额时附加的滑点比例
  volCapRatio: 0.03,
  // 单笔上限=当日成交额的该比例（有 amount 时硬拒超量）
  maxOrderNotional: 2e6,
  // 无 amount 时的单笔名义额上限（元）兜底拒超量
  refAmountSmall: 5e7,
  // 小票代理参考日成交额（元）
  refAmountTrend: 5e8
  // 趋势中大票代理参考日成交额（元）
};
function normalizeExec(exec) {
  if (!exec || typeof exec !== "object") return { ...EXEC_DEFAULTS };
  const m = { ...EXEC_DEFAULTS, ...exec };
  m.mode = m.mode === "strict" ? "strict" : "ideal";
  m.slipNonLimit = Number.isFinite(+m.slipNonLimit) ? +m.slipNonLimit : EXEC_DEFAULTS.slipNonLimit;
  m.limitCancelRate = Number.isFinite(+m.limitCancelRate) ? Math.min(1, Math.max(0, +m.limitCancelRate)) : EXEC_DEFAULTS.limitCancelRate;
  m.limitCapacityRatio = Number.isFinite(+m.limitCapacityRatio) ? Math.min(1, Math.max(0, +m.limitCapacityRatio)) : EXEC_DEFAULTS.limitCapacityRatio;
  m.sectorLimitRatio = Number.isFinite(+m.sectorLimitRatio) ? Math.min(1, Math.max(0, +m.sectorLimitRatio)) : 0;
  m.seed = Number.isFinite(+m.seed) ? +m.seed : EXEC_DEFAULTS.seed;
  m.slipModel = m.slipModel === "profile" ? "profile" : "flat";
  m.slipLimitUpBuy = Number.isFinite(+m.slipLimitUpBuy) ? +m.slipLimitUpBuy : 0;
  m.slipOpenSmall = Number.isFinite(+m.slipOpenSmall) ? +m.slipOpenSmall : 0.012;
  m.slipOpenTrend = Number.isFinite(+m.slipOpenTrend) ? +m.slipOpenTrend : 3e-3;
  m.slipCloseSmall = Number.isFinite(+m.slipCloseSmall) ? +m.slipCloseSmall : 8e-3;
  m.slipCloseTrend = Number.isFinite(+m.slipCloseTrend) ? +m.slipCloseTrend : 3e-3;
  m.slipCloseLimitDown = Number.isFinite(+m.slipCloseLimitDown) ? +m.slipCloseLimitDown : 0.02;
  m.tranche = Math.max(1, Number.isFinite(+m.tranche) ? Math.floor(+m.tranche) : 1);
  m.limitFillProb = !!m.limitFillProb;
  m.limitUpFillRatio = Math.min(1, Math.max(0, Number.isFinite(+m.limitUpFillRatio) ? +m.limitUpFillRatio : 0.5));
  m.limitDownFillProb = Math.min(1, Math.max(0, Number.isFinite(+m.limitDownFillProb) ? +m.limitDownFillProb : 0.5));
  m.volImpactCoef = Number.isFinite(+m.volImpactCoef) ? Math.max(0, +m.volImpactCoef) : 0;
  m.volCapRatio = Number.isFinite(+m.volCapRatio) ? Math.min(1, Math.max(0, +m.volCapRatio)) : 0;
  m.maxOrderNotional = Number.isFinite(+m.maxOrderNotional) ? Math.max(0, +m.maxOrderNotional) : 0;
  m.refAmountSmall = Number.isFinite(+m.refAmountSmall) ? Math.max(0, +m.refAmountSmall) : 5e7;
  m.refAmountTrend = Number.isFinite(+m.refAmountTrend) ? Math.max(0, +m.refAmountTrend) : 5e8;
  return m;
}
function pickSlip(exec, { side, profile = "trend", isLimitUp: isLimitUp2 = false, isLimitDown = false } = {}) {
  if (side === "buy") {
    if (isLimitUp2) return exec.slipLimitUpBuy;
    return profile === "small" ? exec.slipOpenSmall : exec.slipOpenTrend;
  }
  if (isLimitDown) return exec.slipCloseLimitDown;
  return profile === "small" ? exec.slipCloseSmall : exec.slipCloseTrend;
}
var EXEC_SLIP_MAX = 0.05;
function effectiveRefAmount(exec, { amount = null, huanshou = null, freeFloatCap = null, profile = "trend" } = {}) {
  if (amount != null && amount > 0) return { amt: amount, src: "real" };
  if (freeFloatCap != null && freeFloatCap > 0 && huanshou != null && huanshou > 0) {
    return { amt: huanshou / 100 * freeFloatCap, src: "proxy" };
  }
  let ref = (profile === "small" ? exec.refAmountSmall : exec.refAmountTrend) || 1e8;
  if (huanshou != null && huanshou > 0) {
    const medianHs = 5;
    ref = ref * Math.min(2, Math.max(0.5, medianHs / huanshou));
  }
  return { amt: ref, src: "fallback" };
}
function impactSlip(exec, { side, notional = 0, amount = null, huanshou = null, freeFloatCap = null, profile = "trend" } = {}) {
  const coef = exec.volImpactCoef || 0;
  if (!(coef > 0)) return 0;
  const { amt } = effectiveRefAmount(exec, { amount, huanshou, freeFloatCap, profile });
  const ratio = Math.min(1, notional / amt);
  return coef * ratio;
}
var _execCtx = null;
function setExecContext(e) {
  _execCtx = e ? normalizeExec(e) : null;
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function fillRng(orderId, date, seed) {
  return mulberry32(hashStr(`${orderId}|${date}|${seed}`) >>> 0 || 1);
}
function limitBuyOutcome(p, q, exec, date) {
  const rng = fillRng(p.id, date, exec.seed);
  if (q && Number.isFinite(+q.limitVol) && +q.limitVol > 0) {
    if (p.qty > exec.limitCapacityRatio * +q.limitVol) {
      return { fill: false, reason: `\u6253\u677F\u5BB9\u91CF\u95E8\uFF1A\u4E70\u5165 ${p.qty} \u80A1 > \u5C01\u5355 ${+q.limitVol | 0} \u80A1\u7684 ${exec.limitCapacityRatio * 100 | 0}%\uFF0C\u672A\u6210\u4EA4\uFF08\u5403\u4E0D\u4E0B\uFF09` };
    }
  }
  if (rng() < exec.limitCancelRate) {
    return { fill: false, reason: `\u6253\u677F\u64A4\u5355\u7387\u547D\u4E2D\uFF08${exec.limitCancelRate * 100 | 0}%\uFF09\uFF0C\u5F53\u65E5\u672A\u6210\u4EA4` };
  }
  return { fill: true, reason: "\u6253\u677F\u6210\u4EA4" };
}
var LIMIT_PCT = {
  main: 0.1,
  // 沪深主板 ±10%
  gem: 0.2,
  // 创业板 300xxx ±20%
  star: 0.2,
  // 科创板 688xxx ±20%
  bj: 0.3,
  // 北交所 8xxxxx/4xxxxx/92xxxx ±30%
  st: 0.05
  // ST / *ST ±5%
};
function boardOf(code) {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) return { board: "unknown", label: "\u672A\u77E5", limitPct: null, tradable: false };
  if (/^(11|12)/.test(c)) return { board: "cb", label: "\u53EF\u8F6C\u503A\uFF08\u6682\u4E0D\u652F\u6301\uFF09", limitPct: null, tradable: false };
  if (/^(15|16|50|51|52|56|58)/.test(c)) return { board: "fund", label: "\u57FA\u91D1/ETF\uFF08\u6682\u4E0D\u652F\u6301\uFF09", limitPct: null, tradable: false };
  if (/^(92|4[0-9]|8[0-9])/.test(c)) return { board: "bj", label: "\u5317\u4EA4\u6240", limitPct: LIMIT_PCT.bj, tradable: true };
  if (/^68[89]/.test(c)) return { board: "star", label: "\u79D1\u521B\u677F", limitPct: LIMIT_PCT.star, tradable: true };
  if (/^30[01]/.test(c)) return { board: "gem", label: "\u521B\u4E1A\u677F", limitPct: LIMIT_PCT.gem, tradable: true };
  if (/^(60[0135])/.test(c)) return { board: "shb", label: "\u6CAA\u5E02\u4E3B\u677F", limitPct: LIMIT_PCT.main, tradable: true };
  if (/^(00[0123])/.test(c)) return { board: "szb", label: "\u6DF1\u5E02\u4E3B\u677F", limitPct: LIMIT_PCT.main, tradable: true };
  if (/^(900|200)/.test(c)) return { board: "b", label: "B\u80A1\uFF08\u6682\u4E0D\u652F\u6301\uFF09", limitPct: null, tradable: false };
  return { board: "unknown", label: "\u672A\u77E5\u677F\u6BB5\uFF08\u6682\u4E0D\u652F\u6301\uFF09", limitPct: null, tradable: false };
}
var isStName = (name) => /^(\*ST|S\*?ST|ST)(?![A-Za-z])/.test(String(name || "").trim());
function limitPctOf(code, name) {
  if (isStName(name)) return LIMIT_PCT.st;
  const b = boardOf(code);
  return b.limitPct;
}
function isLimitHit(changePct, code, name, tol = 0.5, price = null, prevClose = null) {
  const lim = limitPctOf(code, name);
  if (lim == null) return null;
  if (Number.isFinite(+prevClose) && +prevClose > 0 && Number.isFinite(+price) && +price > 0) {
    const up = round2(+prevClose * (1 + lim));
    const down = round2(+prevClose * (1 - lim));
    if (+price >= up - 5e-3) return "up";
    if (+price <= down + 5e-3) return "down";
    return null;
  }
  if (changePct == null || !Number.isFinite(+changePct)) return null;
  const p = Math.abs(+changePct);
  if (p >= lim * 100 - tol) return +changePct > 0 ? "up" : "down";
  return null;
}
var round2 = (x) => Math.round(x * 100) / 100;
function fees(gross, side) {
  const comm = Math.max(MIN_COMMISSION, round2(gross * COMMISSION_RATE));
  const transfer = round2(gross * TRANSFER_FEE_RATE);
  const stamp = side === "sell" ? round2(gross * STAMP_TAX_RATE) : 0;
  return { comm, transfer, stamp, total: round2(comm + transfer + stamp) };
}
function fillPrice(price, side, slip = DEFAULT_SLIP) {
  const p = +price;
  if (!Number.isFinite(p) || p <= 0) return 0;
  const adj = side === "buy" ? p * (1 + slip) : p * (1 - slip);
  let out2 = round2(adj);
  if (side === "buy" && out2 <= p) out2 = round2(p + 0.01);
  if (side === "sell" && out2 >= p) out2 = round2(p - 0.01);
  return Math.max(0.01, out2);
}
var POS_TIERS = [
  { key: "light", label: "\u8F7B\u4ED3", pct: 0.1, note: "10% \u603B\u8D44\u4EA7" },
  { key: "half", label: "\u534A\u4ED3", pct: 0.5, note: "50% \u603B\u8D44\u4EA7" },
  { key: "heavy", label: "\u91CD\u4ED3", pct: 0.8, note: "80% \u603B\u8D44\u4EA7" },
  { key: "full", label: "\u6EE1\u4ED3", pct: 1, note: "100% \u603B\u8D44\u4EA7\uFF08\u4E70\u5165\u53E3\u5F84\uFF0C\u975E\u6E05\u7A7A\u8D44\u91D1\uFF09" }
];
var CUT_TIERS = [
  { key: "cut25", label: "\u51CF 1/4", pct: 0.25 },
  { key: "cut50", label: "\u51CF 1/2", pct: 0.5 },
  { key: "cut75", label: "\u51CF 3/4", pct: 0.75 }
];
function qtyByAssetPct(totalAssets, pct2, price, opts = {}) {
  const P = +price;
  const T = +totalAssets;
  const p = Math.max(0, Math.min(1, +pct2 || 0));
  if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(T) || T <= 0) {
    return { qty: 0, gross: 0, fee: 0, need: 0, capped: false };
  }
  const budget = T * p;
  let lots = Math.floor(budget / (P * LOT));
  for (; lots > 0; lots--) {
    const gross2 = round2(lots * LOT * P);
    const fee2 = fees(gross2, "buy").total;
    if (gross2 + fee2 <= budget + 1e-6) break;
  }
  let qty = Math.max(0, lots) * LOT;
  if (qty <= 0) return { qty: 0, gross: 0, fee: 0, need: 0, capped: false };
  let gross = round2(qty * P);
  let fee = fees(gross, "buy").total;
  let capped = false;
  const cash = opts.cash;
  if (Number.isFinite(+cash)) {
    while (qty > 0 && gross + fee > +cash) {
      qty -= LOT;
      if (qty <= 0) return { qty: 0, gross: 0, fee: 0, need: 0, capped: true };
      gross = round2(qty * P);
      fee = fees(gross, "buy").total;
    }
    if (qty < Math.max(0, lots) * LOT) capped = true;
  }
  return { qty, gross, fee, need: round2(gross + fee), capped };
}
function qtyByHoldPct(avail, pct2) {
  const a = Math.floor(+avail || 0);
  if (a <= 0) return 0;
  const p = Math.max(0, Math.min(1, +pct2 || 0));
  const q = Math.floor(a * p / LOT) * LOT;
  if (q <= 0) return a;
  return Math.min(a, q);
}
var toCents = (yuan4) => Math.round(yuan4 * 100);
var toYuan = (cents) => cents / 100;
function applyBuy(pos, { qty, price, fee }) {
  const grossCents = toCents(price) * qty;
  const feeCents = toCents(fee);
  const totalCents = grossCents + feeCents;
  const newQty = pos.qty + qty;
  const newCostCents = toCents(pos.cost) + totalCents;
  return {
    qty: newQty,
    cost: toYuan(newCostCents),
    // 累计买入总成本（含费）
    avgCost: newQty > 0 ? toYuan(newCostCents / newQty) : 0,
    grossBuyCents: toCents(pos.grossBuy || 0) + grossCents,
    feeCents: toCents(pos.fee || 0) + feeCents
    // 可卖数量属于「时点状态」，由 settleFreeze() 按持仓日推进，不在这里改
  };
}
function applySell(pos, { qty, price, fee }) {
  const avgCost = pos.avgCost || 0;
  const grossCents = toCents(price) * qty;
  const feeCents = toCents(fee);
  const netCents = grossCents - feeCents;
  const costCents = toCents(pos.cost || 0);
  const costOutCents = pos.qty > 0 ? qty === pos.qty ? costCents : Math.round(costCents * qty / pos.qty) : 0;
  const realized = toYuan(netCents - costOutCents);
  const newQty = pos.qty - qty;
  const newCostCents = Math.max(0, costCents - costOutCents);
  return {
    qty: newQty,
    cost: newQty > 0 ? toYuan(newCostCents) : 0,
    avgCost: newQty > 0 ? toYuan(newCostCents / newQty) : 0,
    realized,
    feeCents: toCents(pos.fee || 0) + feeCents
  };
}
function emptyAccount(cash = 1e6, startDate = null) {
  return {
    version: PAPER_VERSION,
    initCash: cash,
    // 虚拟本金（唯一「假」的东西）
    cash,
    // 可用资金
    freeze: 0,
    // 冻结资金（买入挂单待成交时冻结，成交/失效后释放）
    positions: {},
    // code → { code, name, qty, avail, avgCost, cost, last, openDate, days }
    orders: [],
    // 全部委托（含被拒、含待成交）
    trades: [],
    // 全部成交
    pending: [],
    // 待成交委托（T+1 撮合队列）
    logs: [],
    // 委托与拦截日志流（V5.2-pro 规则第六块）：每笔委托/每次拦截一条
    realized: 0,
    // 累计已实现盈亏
    totalFee: 0,
    // 累计费用
    startDate,
    lastSettle: null,
    // 最近一次结算的交易日
    nav: [],
    // [{date, equity, cash, marketValue}] 每日净值（绩效与曲线用）
    note: "\u521D\u59CB\u8D44\u91D1\u4E3A\u865A\u62DF\u8D44\u91D1\uFF1B\u4EF7\u683C\u3001\u4EA4\u6613\u65E5\u5386\u3001\u4EA4\u6613\u89C4\u5219\u5747\u53D6\u81EA\u771F\u5B9E\u6570\u636E\u4E0E A \u80A1\u73B0\u884C\u5236\u5EA6\u3002"
  };
}
function accountStats(acct) {
  const positions = Object.values(acct.positions || {});
  const marketValue = positions.reduce((a, p) => a + (p.last != null ? p.last * p.qty : p.avgCost * p.qty), 0);
  const costValue = positions.reduce((a, p) => a + (p.cost || 0), 0);
  const total = acct.cash + (acct.freeze || 0) + marketValue;
  let peak = Math.max(+acct.initCash || 0, total);
  for (const r of acct.nav || []) {
    if (r && Number.isFinite(+r.equity)) peak = Math.max(peak, +r.equity);
  }
  const drawdown = peak > 0 ? Math.max(0, (peak - total) / peak) : 0;
  return {
    cash: acct.cash,
    freeze: acct.freeze || 0,
    marketValue,
    costValue,
    floatPnl: marketValue - costValue,
    floatPnlPct: costValue > 0 ? (marketValue - costValue) / costValue : 0,
    realized: acct.realized || 0,
    totalFee: acct.totalFee || 0,
    total,
    initCash: acct.initCash,
    // 峰值与回撤（风控与展示共用，唯一出处）
    peak,
    drawdown,
    // 0~1
    drawdownPct: drawdown * 100,
    ret: acct.initCash > 0 ? (total - acct.initCash) / acct.initCash : 0,
    retPct: acct.initCash > 0 ? (total - acct.initCash) / acct.initCash * 100 : 0,
    posCount: positions.length
  };
}
var MAX_DAILY_POSITION_CHANGE = 0.2;
var DD_TIERS = [
  { threshold: 0.15, cap: 0.4, label: "\u56DE\u64A4 \u226515%\uFF1A\u4ED3\u4F4D\u4E0A\u9650\u964D\u81F3 40%" },
  { threshold: 0.09, cap: 0.7, label: "\u56DE\u64A4 \u22659%\uFF1A\u4ED3\u4F4D\u4E0A\u9650\u964D\u81F3 70%" },
  { threshold: 0, cap: 1, label: "\u56DE\u64A4\u6B63\u5E38\uFF1A\u4ED3\u4F4D\u4E0A\u9650 100%" }
];
var HARD_STOP_LOSS = -0.08;
var EXIT_V1 = {
  ztNextDay: true,
  trailTrigger: 0.05,
  trailPullback: 0.03,
  hardStop: -0.05,
  lossMaxDays: 3,
  escape: true
  // 跌停逃生：v1 的紧急卖单带 escape 标记，触及跌停时改以跌停价挂单排队（9:25 前抢排队），尽量在首个跌停日脱身，避免后续跌停瀑布
};
function ddTier(drawdown) {
  const dd = Math.max(0, +drawdown || 0);
  for (const t of DD_TIERS) if (dd >= t.threshold) return t;
  return DD_TIERS[DD_TIERS.length - 1];
}
var RISK_REJECT = {
  DAILY_CHANGE: "\u5355\u65E5\u8D26\u6237\u4ED3\u4F4D\u53D8\u52A8\u8D85\u8FC7 20% \u603B\u8D44\u4EA7\u4E0A\u9650",
  DD_CAP: "\u8D26\u6237\u56DE\u64A4\u89E6\u53D1\u52A8\u6001\u964D\u4ED3\uFF0C\u672C\u6B21\u59D4\u6258\u5C06\u7A81\u7834\u5F53\u524D\u4ED3\u4F4D\u4E0A\u9650",
  SECTOR_LIMIT: "\u677F\u5757\u66B4\u9732\u8D85\u8FC7\u4E0A\u9650\uFF0C\u5F3A\u884C\u62D2\u7EDD\u4E70\u5165\uFF08\u7CFB\u7EDF\u6027\u98CE\u9669\uFF09",
  SINGLE_STOCK_CAP: "\u5355\u7968\u6301\u4ED3\u5360\u6BD4\u8D85\u8FC7\u786C\u4E0A\u9650\uFF08\u540C\u7968\u591A\u5355/\u8DE8\u65E5\u5408\u5E76\u4E0D\u5F97\u7A81\u7834\uFF09"
};
function riskGuard(acct, order, quote, ctx = {}) {
  const stats = accountStats(acct);
  const total = stats.total;
  const exec = normalizeExec(ctx.exec);
  if (!(total > 0)) return { ok: false, reason: "BAD_ACCOUNT", detail: "\u8D26\u6237\u603B\u8D44\u4EA7 \u2264 0\uFF0C\u65E0\u6CD5\u505A\u98CE\u63A7\u6821\u9A8C" };
  if (order?.side === "sell") {
    return { ok: true, cap: 1, drawdown: stats.drawdown, note: "\u5356\u51FA\u65B9\u5411\u4E0D\u53D7\u4ED3\u4F4D\u53D8\u52A8\u4E0E\u964D\u4ED3\u4E0A\u9650\u7EA6\u675F" };
  }
  const px = fillPrice(+(quote || {}).price, "buy", order?.slip ?? DEFAULT_SLIP);
  const qty = Math.max(0, Math.floor(+order?.qty || 0));
  const gross = round2(px * qty);
  const fee = qty > 0 ? fees(gross, "buy").total : 0;
  const amount = round2(gross + fee);
  const tier = ddTier(stats.drawdown);
  const todayBuy = Math.max(0, +ctx.todayBuyAmount || 0);
  const regimeCap = ctx.regimeCap;
  const effCap = regimeCap != null && Number.isFinite(+regimeCap) && +regimeCap >= 0 ? Math.min(tier.cap, +regimeCap) : tier.cap;
  const changePct = (todayBuy + amount) / total;
  if (changePct > MAX_DAILY_POSITION_CHANGE + 1e-9) {
    return {
      ok: false,
      reason: RISK_REJECT.DAILY_CHANGE,
      detail: `\u4ECA\u65E5\u5DF2\u4E70\u5165 ${todayBuy.toFixed(2)} \u5143 + \u672C\u7B14 ${amount.toFixed(2)} \u5143 = ${(changePct * 100).toFixed(2)}% \u603B\u8D44\u4EA7\uFF0C\u8D85\u8FC7 ${MAX_DAILY_POSITION_CHANGE * 100}% \u4E0A\u9650`,
      cap: effCap,
      drawdown: stats.drawdown,
      thisChangePct: changePct,
      tier
    };
  }
  const heldValue = stats.marketValue;
  const afterPosPct = (heldValue + (stats.freeze || 0) + amount) / total;
  if (afterPosPct > effCap + 1e-9) {
    return {
      ok: false,
      reason: RISK_REJECT.DD_CAP,
      detail: `\u4E0B\u5355\u540E\u4ED3\u4F4D\u5C06\u8FBE ${(afterPosPct * 100).toFixed(2)}% \u603B\u8D44\u4EA7\uFF0C\u5F53\u524D\u4E0A\u9650 ${(effCap * 100).toFixed(0)}%\uFF08\u56DE\u64A4\u6863\u4F4D ${(tier.cap * 100).toFixed(0)}% \u2229 regime \u5E3D ${Number.isFinite(+regimeCap) ? (effCap * 100).toFixed(0) + "%" : "\u672A\u63D0\u4F9B"}\uFF1B${tier.label}\uFF0C\u56DE\u64A4 ${(stats.drawdown * 100).toFixed(2)}%\uFF09`,
      cap: effCap,
      drawdown: stats.drawdown,
      afterPosPct,
      tier
    };
  }
  const singleStockCap = ctx.singleStockCap;
  if (Number.isFinite(+singleStockCap) && +singleStockCap > 0) {
    const pos0 = acct.positions && acct.positions[String(order?.code)];
    const codeVal = pos0 ? pos0.last != null ? pos0.last * pos0.qty : (pos0.avgCost || 0) * pos0.qty : 0;
    const afterCodePct = (codeVal + amount) / total;
    if (afterCodePct > +singleStockCap + 1e-9) {
      return {
        ok: false,
        reason: RISK_REJECT.SINGLE_STOCK_CAP,
        detail: `\u4E0B\u5355\u540E\u5355\u7968 ${order?.code} \u6301\u4ED3\u5C06\u8FBE ${(afterCodePct * 100).toFixed(2)}% \u603B\u8D44\u4EA7\uFF0C\u8D85\u8FC7\u5355\u7968\u4E0A\u9650 ${(+singleStockCap * 100).toFixed(0)}%`,
        cap: effCap,
        drawdown: stats.drawdown,
        afterCodePct,
        tier
      };
    }
  }
  if (exec.sectorLimitRatio > 0 && order?.side === "buy" && order?.sector) {
    const sector = String(order.sector);
    let sectorVal = 0;
    for (const pos of Object.values(acct.positions || {})) {
      if (String(pos.sector || "") === sector) {
        sectorVal += pos.last != null ? pos.last * pos.qty : (pos.avgCost || 0) * pos.qty;
      }
    }
    const afterVal = sectorVal + (amount || 0);
    if (total > 0 && afterVal / total > exec.sectorLimitRatio + 1e-9) {
      return {
        ok: false,
        reason: RISK_REJECT.SECTOR_LIMIT,
        detail: `\u677F\u5757\u300C${sector}\u300D\u66B4\u9732\u5C06\u8FBE ${(afterVal / total * 100).toFixed(1)}% > \u4E0A\u9650 ${(exec.sectorLimitRatio * 100).toFixed(0)}%\uFF0C\u5F3A\u884C\u62D2\u7EDD\u4E70\u5165\uFF08\u7CFB\u7EDF\u6027\u98CE\u9669\uFF09`,
        cap: tier.cap,
        drawdown: stats.drawdown,
        afterPosPct,
        tier
      };
    }
  }
  return {
    ok: true,
    cap: tier.cap,
    drawdown: stats.drawdown,
    afterPosPct,
    thisChangePct: changePct,
    amount,
    tier
  };
}
var REJECT = {
  BAD_CODE: "\u4EE3\u7801\u975E\u6CD5",
  NOT_TRADABLE: "\u8BE5\u4EE3\u7801\u4E0D\u5728\u6A21\u62DF\u5668\u53EF\u4EA4\u6613\u8303\u56F4\uFF08B\u80A1/\u672A\u77E5\u677F\u6BB5\uFF09",
  NO_QUOTE: "\u5F53\u65E5\u65E0\u771F\u5B9E\u884C\u60C5\uFF0C\u65E0\u6CD5\u9884\u4F30\u8D44\u91D1\u5360\u7528",
  BAD_QTY: "\u6570\u91CF\u975E\u6CD5",
  LOT: `\u4E70\u5165\u6570\u91CF\u987B\u4E3A ${LOT} \u80A1\u6574\u6570\u500D`,
  ODD_SELL: "\u5356\u51FA\u96F6\u80A1\u65F6\u987B\u4E00\u6B21\u6027\u5356\u51FA\u5168\u90E8\u6301\u4ED3",
  NO_POSITION: "\u65E0\u8BE5\u80A1\u6301\u4ED3",
  OVER_AVAIL: "\u8D85\u8FC7\u53EF\u5356\u6570\u91CF\uFF08T+1\uFF1A\u5F53\u65E5\u4E70\u5165\u6B21\u4E00\u4EA4\u6613\u65E5\u624D\u53EF\u5356\uFF09",
  NO_CASH: "\u53EF\u7528\u8D44\u91D1\u4E0D\u8DB3\uFF08\u6309\u4ECA\u6536\u4EF7 + \u8D39\u7528\u9884\u51BB\u7ED3\uFF09",
  PENDING_SAME: "\u8BE5\u80A1\u5DF2\u6709\u5F85\u6210\u4EA4\u59D4\u6258\uFF0C\u8BF7\u5148\u64A4\u5355"
};
function validateOrder(acct, order, quote) {
  const { code, side, qty } = order;
  const nominalSlip = _execCtx && _execCtx.mode === "strict" ? _execCtx.slipNonLimit : DEFAULT_SLIP;
  const b = boardOf(code);
  if (!/^\d{6}$/.test(String(code || ""))) return reject(REJECT.BAD_CODE, `\u4EE3\u7801 ${code}`);
  if (!b.tradable) return reject(REJECT.NOT_TRADABLE, b.label);
  if (!Number.isInteger(qty) || qty <= 0) return reject(REJECT.BAD_QTY, `\u6570\u91CF ${qty}`);
  if (!quote || quote.price == null || !Number.isFinite(+quote.price) || +quote.price <= 0) {
    return reject(REJECT.NO_QUOTE, quote?.reason || "\u5B58\u6863\u65E0\u8BE5\u80A1\u6536\u76D8\u4EF7");
  }
  const dup = (acct.pending || []).find((p) => p.code === code);
  if (dup) return reject(REJECT.PENDING_SAME, `\u5DF2\u6709 ${dup.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"} ${dup.qty} \u80A1\u5F85\u6210\u4EA4`);
  if (side === "buy") {
    if (qty % LOT !== 0) return reject(REJECT.LOT, `${qty} \u80A1`);
    const px2 = fillPrice(+quote.price, "buy", nominalSlip);
    const gross2 = round2(px2 * qty);
    const fee2 = fees(gross2, "buy").total;
    const need = round2(gross2 + fee2);
    if (acct.cash + 1e-9 < need) {
      return reject(REJECT.NO_CASH, `\u9700\u51BB\u7ED3 ${need.toFixed(2)} \u5143\uFF0C\u53EF\u7528 ${acct.cash.toFixed(2)} \u5143`);
    }
    return { ok: true, price: px2, gross: gross2, fee: fee2, need };
  }
  const pos = acct.positions[code];
  if (!pos || pos.qty <= 0) return reject(REJECT.NO_POSITION, code);
  const frozen = (acct.pending || []).filter((p) => p.code === code && p.side === "sell").reduce((a, p) => a + p.qty, 0);
  const freeAvail = Math.max(0, (pos.avail || 0) - frozen);
  if (qty > freeAvail) {
    return reject(REJECT.OVER_AVAIL, `\u53EF\u5356 ${freeAvail} \u80A1 / \u6301\u4ED3 ${pos.qty} \u80A1\uFF08\u5F53\u65E5\u4E70\u5165 ${pos.qty - (pos.avail || 0)} \u80A1\uFF09`);
  }
  if (qty % LOT !== 0 && qty !== pos.qty) return reject(REJECT.ODD_SELL, `\u96F6\u80A1\u5356\u51FA\u4EC5\u9650\u4E00\u6B21\u6027\u6E05\u4ED3\uFF08${pos.qty} \u80A1\uFF09`);
  if (qty > pos.qty) return reject(REJECT.BAD_QTY, `\u5356\u51FA ${qty} > \u6301\u4ED3 ${pos.qty}`);
  const px = fillPrice(+quote.price, "sell", nominalSlip);
  const gross = round2(px * qty);
  const fee = fees(gross, "sell").total;
  return { ok: true, price: px, gross, fee, need: 0 };
}
function reject(reason, detail) {
  return { ok: false, reason, detail: detail || "" };
}
function submitOrder(acct, order, quote, ctx = {}) {
  const date = ctx.date || acct.lastSettle || null;
  const v = validateOrder(acct, order, quote);
  const id = (acct.orders?.length || 0) + 1;
  const base = {
    id,
    submitDate: date,
    code: order.code,
    name: quote?.name || "",
    side: order.side,
    qty: order.qty,
    reason: order.reason || "\u624B\u52A8\u4E0B\u5355",
    tag: order.tag || null,
    // 选股侧传来的分类标签（如 'zt' 连板/打板），仅透传，不参与任何校验
    escape: order.escape || null,
    // 跌停逃生标记：v1 紧急卖单置 true，触及跌停时改以跌停价排队成交
    iceTrial: order.iceTrial || null,
    // 挂件一：冰点试错仓标记（极小仓位试错首板烂板弱转强）
    antiNuke: order.antiNuke || null,
    // 挂件三：反核标记（放宽 -8% 硬止损至跌停才砍，给一日反杀机会）
    streak: order.streak || null,
    // 入场连板数（主线第1步·分级止损匹配用，仅透传，不参与校验）
    submitPrice: quote?.price != null ? +quote.price : null
  };
  let slipBase = order.slip;
  let profileMode = false;
  let prof = "trend";
  if (slipBase == null && _execCtx && _execCtx.slipModel === "profile") {
    profileMode = true;
    const pos = acct.positions && acct.positions[String(order.code)];
    prof = order.slipProfile || pos && pos.slipProfile || "trend";
    const isLimitUp2 = quote && quote.changePct != null && +quote.changePct >= 9;
    const isLimitDown = pos && pos.changePct != null && +pos.changePct <= -9;
    slipBase = pickSlip(_execCtx, { side: order.side, profile: prof, isLimitUp: isLimitUp2, isLimitDown });
  }
  if (!v.ok) {
    const rec2 = { ...base, status: "rejected", reject: v.reason, detail: v.detail };
    return {
      next: {
        ...acct,
        orders: [...acct.orders, rec2],
        logs: appendLog(acct, { date, code: order.code, name: base.name, side: order.side, qty: order.qty, stage: "order", result: "rejected", reason: v.reason, text: `\u59D4\u6258\u88AB\u62D2\uFF1A${v.reason}${v.detail ? "\uFF08" + v.detail + "\uFF09" : ""}` })
      },
      order: rec2
    };
  }
  let slipImpact = 0;
  if (profileMode) {
    slipImpact = impactSlip(_execCtx, { side: order.side, notional: v.gross, amount: quote && quote.amount != null ? +quote.amount : null, huanshou: quote && quote.huanshou != null ? +quote.huanshou : null, freeFloatCap: quote && quote.freeFloatCap != null ? +quote.freeFloatCap : null, profile: prof });
  }
  const baseSlip = slipBase != null ? slipBase : order.slip ?? null;
  const slip = Math.min(EXEC_SLIP_MAX, (baseSlip != null ? baseSlip : DEFAULT_SLIP) + slipImpact);
  const rec = {
    ...base,
    status: "pending",
    estPrice: v.price,
    estFee: v.fee,
    estGross: v.gross,
    need: v.need,
    slip,
    slipBase: baseSlip,
    slipImpact: profileMode ? slipImpact : 0,
    sector: order.sector || null
  };
  return {
    next: {
      ...acct,
      freeze: toYuan(toCents(acct.freeze || 0) + toCents(v.need)),
      cash: order.side === "buy" ? toYuan(toCents(acct.cash) - toCents(v.need)) : acct.cash,
      pending: [...acct.pending || [], rec],
      orders: [...acct.orders, rec],
      logs: appendLog(acct, {
        date,
        code: order.code,
        name: base.name,
        side: order.side,
        qty: order.qty,
        stage: "order",
        result: "submitted",
        reason: rec.reason,
        text: `\u59D4\u6258\u63D0\u4EA4\u6210\u529F\uFF1A${order.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"} ${order.qty} \u80A1 @\u9884\u4F30 ${v.price} \u5143\uFF0C` + (order.side === "buy" ? `\u51BB\u7ED3 ${v.need.toFixed(2)} \u5143` : "\u5F85\u6210\u4EA4\u540E\u56DE\u6B3E") + "\uFF0CT+1 \u6B21\u4E00\u4EA4\u6613\u65E5\u6309\u771F\u5B9E\u6536\u76D8\u4EF7\u64AE\u5408"
      })
    },
    order: rec
  };
}
var MAX_LOGS = 2e3;
function appendLog(acct, entry) {
  const logs = Array.isArray(acct?.logs) ? acct.logs : [];
  const row = {
    ts: Date.now(),
    date: entry.date ?? acct?.lastSettle ?? null,
    code: entry.code ?? null,
    name: entry.name ?? null,
    side: entry.side ?? null,
    qty: entry.qty ?? null,
    stage: entry.stage || "order",
    result: entry.result || "info",
    reason: entry.reason ?? null,
    text: entry.text || ""
  };
  const out2 = [...logs, row];
  return out2.length > MAX_LOGS ? out2.slice(out2.length - MAX_LOGS) : out2;
}
function readLogs(acct, filter = {}) {
  let rows = Array.isArray(acct?.logs) ? acct.logs : [];
  if (filter.date) rows = rows.filter((r) => r.date === filter.date);
  if (filter.stage) rows = rows.filter((r) => r.stage === filter.stage);
  if (filter.result) rows = rows.filter((r) => r.result === filter.result);
  if (filter.code) rows = rows.filter((r) => r.code === filter.code);
  if (filter.limit > 0) rows = rows.slice(-filter.limit);
  return rows;
}
function logsToReport(acct, filter = {}) {
  const rows = readLogs(acct, filter);
  if (!rows.length) return "";
  const STAGE = { lhb: "\u9F99\u864E\u8FC7\u6EE4", risk: "\u98CE\u63A7", order: "\u59D4\u6258", settle: "\u7ED3\u7B97", stop: "\u6B62\u635F", glm: "AI\u9884\u68C0" };
  const RESULT = { pass: "\u901A\u8FC7", rejected: "\u62E6\u622A", submitted: "\u5DF2\u63D0\u4EA4", filled: "\u5DF2\u6210\u4EA4", expired: "\u5931\u6548", cancelled: "\u5DF2\u64A4\u5355", info: "\u8BB0\u5F55" };
  const lines = rows.map((r) => {
    const head = `- \`${r.date || "\u2014"}\` ${r.code ? r.code + " " + (r.name || "") : ""} [${STAGE[r.stage] || r.stage}/${RESULT[r.result] || r.result}]`;
    return head + " " + r.text;
  });
  return `### \u4EA4\u6613\u5F15\u64CE\u4E8B\u4EF6\u65E5\u5FD7\uFF08${rows.length} \u6761\uFF09

` + lines.join("\n");
}
function cancelOrder(acct, id) {
  const p = (acct.pending || []).find((x) => x.id === id);
  if (!p) return { next: acct, ok: false, error: "\u8BE5\u59D4\u6258\u4E0D\u5728\u5F85\u6210\u4EA4\u961F\u5217" };
  const rec = { ...p, status: "cancelled", cancelDate: acct.lastSettle || null };
  return {
    ok: true,
    next: {
      ...acct,
      cash: toYuan(toCents(acct.cash) + toCents(p.need || 0)),
      freeze: toYuan(Math.max(0, toCents(acct.freeze || 0) - toCents(p.need || 0))),
      pending: acct.pending.filter((x) => x.id !== id),
      orders: acct.orders.map((o) => o.id === id ? rec : o)
    }
  };
}
function batchSubmit(acct, items, day, opts = {}) {
  const date = opts.date || day?.trade_date || acct.lastSettle || null;
  const quotes = quotesFromDay(day);
  const applyLhb = opts.applyLhbFilter !== false;
  const checkRisk = opts.checkRisk !== false;
  const exec = normalizeExec(opts.exec);
  let cur = acct;
  const results = [];
  let todayBuy = (acct.pending || []).filter((p) => p.side === "buy" && p.submitDate === date).reduce((a, p) => a + (p.estGross || 0) + (p.estFee || 0), 0);
  const doneCodes = /* @__PURE__ */ new Set();
  const lhbCache = /* @__PURE__ */ new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const code = String(raw?.code || raw?.symbol || "").trim();
    const row = { code, name: "", side: "buy", qty: null, status: "blocked", stage: null, reason: null, detail: null, order: null };
    if (!code) {
      row.reason = "\u4EE3\u7801\u4E3A\u7A7A";
      results.push(row);
      continue;
    }
    if (doneCodes.has(code)) {
      row.reason = "\u672C\u6279\u6B21\u5185\u91CD\u590D\u6807\u7684\uFF0C\u5DF2\u8DF3\u8FC7";
      results.push(row);
      continue;
    }
    doneCodes.add(code);
    const quote = quotes[code] || null;
    row.name = quote?.name || code;
    if (applyLhb) {
      let f = lhbCache.get(code);
      if (!f) {
        try {
          f = filterOne(code, day, { marketNetWan: day?.summary?.lhb_daily_net != null ? +day.summary.lhb_daily_net * 1e4 : null });
        } catch (e) {
          f = { bucket: "rejected", text: "\u8FC7\u6EE4\u5F02\u5E38\uFF1A" + (e?.message || e), rejectedBy: [{ code: "FILTER_ERROR", text: "\u8FC7\u6EE4\u5F02\u5E38" }], features: null };
        }
        lhbCache.set(code, f);
      }
      if (f.bucket !== "main") {
        row.status = "blocked";
        row.stage = "lhb";
        row.reason = f.bucket === "watch" ? "\u5907\u9009\u89C2\u5BDF\u6C60\uFF08\u7981\u6B62\u81EA\u52A8\u4E0B\u5355\uFF09" : "\u9F99\u864E\u699C\u524D\u7F6E\u8FC7\u6EE4\u672A\u901A\u8FC7";
        row.detail = f.text;
        row.filter = f;
        cur = { ...cur, logs: appendLog(cur, { date, code, name: row.name, side: "buy", qty: raw?.qty ?? null, stage: "lhb", result: "rejected", reason: row.reason, text: row.detail }) };
        results.push(row);
        continue;
      }
      row.filter = f;
      cur = { ...cur, logs: appendLog(cur, { date, code, name: row.name, side: "buy", qty: raw?.qty ?? null, stage: "lhb", result: "pass", reason: null, text: `\u9F99\u864E\u699C\u524D\u7F6E\u8FC7\u6EE4\u901A\u8FC7\uFF1A${f.text}` }) };
    }
    if (!quote || quote.price == null || !Number.isFinite(+quote.price)) {
      row.status = "blocked";
      row.stage = "quote";
      row.reason = REJECT.NO_QUOTE;
      results.push(row);
      continue;
    }
    let qty = Number.isInteger(raw?.qty) ? raw.qty : null;
    if (qty == null && Number.isFinite(+raw?.pct)) {
      const stats = accountStats(cur);
      const sizingSlip = exec.mode === "strict" ? exec.slipNonLimit : DEFAULT_SLIP;
      const px = fillPrice(+quote.price, "buy", sizingSlip);
      const r = qtyByAssetPct(stats.total, +raw.pct, px, { cash: cur.cash });
      qty = r.qty;
      row.capped = r.capped;
    }
    if (exec.slipModel === "profile" && (exec.volCapRatio > 0 || exec.maxOrderNotional > 0) && qty != null && qty > 0 && quote && quote.price > 0) {
      const p0 = +quote.price;
      const { amt: refAmt } = effectiveRefAmount(exec, {
        amount: quote.amount != null ? quote.amount : null,
        huanshou: quote.huanshou != null ? quote.huanshou : null,
        freeFloatCap: quote.freeFloatCap != null ? quote.freeFloatCap : null,
        profile: raw.slipProfile || "trend"
      });
      let maxQty = Infinity;
      if (exec.volCapRatio > 0 && refAmt > 0) {
        maxQty = Math.min(maxQty, Math.floor(exec.volCapRatio * refAmt / p0 / LOT) * LOT);
      }
      if (exec.maxOrderNotional > 0) {
        maxQty = Math.min(maxQty, Math.floor(exec.maxOrderNotional / p0 / LOT) * LOT);
      }
      if (maxQty < qty) {
        qty = Math.max(0, maxQty);
        row.capped = true;
      }
    }
    row.qty = qty;
    if (!qty || qty <= 0) {
      row.status = "blocked";
      row.stage = "qty";
      row.reason = "\u6362\u7B97\u540E\u80A1\u6570\u4E3A 0\uFF08\u8D44\u91D1\u4E0D\u8DB3\u6216\u6BD4\u4F8B\u8FC7\u5C0F\uFF09";
      cur = { ...cur, logs: appendLog(cur, { date, code, name: row.name, side: "buy", qty: 0, stage: "risk", result: "rejected", reason: row.reason, text: row.reason }) };
      results.push(row);
      continue;
    }
    if (checkRisk) {
      const sizingSlip = exec.mode === "strict" ? exec.slipNonLimit : DEFAULT_SLIP;
      const g = riskGuard(cur, { side: "buy", qty, slip: sizingSlip, sector: raw?.sector || raw?.hybk || null }, quote, { todayBuyAmount: todayBuy, exec, regimeCap: opts.regimeCap, singleStockCap: opts.singleStockCap != null ? opts.singleStockCap : opts.perStockCap != null ? opts.perStockCap : 0.2 });
      if (!g.ok) {
        row.status = "blocked";
        row.stage = "risk";
        row.reason = g.reason;
        row.detail = g.detail;
        row.risk = g;
        cur = { ...cur, logs: appendLog(cur, { date, code, name: row.name, side: "buy", qty, stage: "risk", result: "rejected", reason: g.reason, text: g.detail }) };
        results.push(row);
        continue;
      }
      row.risk = g;
    }
    const sub = submitOrder(cur, { code, side: "buy", qty, reason: raw?.reason || "\u6279\u91CF\u4E70\u5165\u59D4\u6258", slip: raw?.slip, sector: raw?.sector || raw?.hybk || null, tag: raw?.tag || null, streak: raw?.streak || null }, { ...quote, name: row.name }, { date });
    cur = sub.next;
    row.order = sub.order;
    row.status = sub.order.status === "pending" ? "submitted" : "blocked";
    row.reason = sub.order.status === "pending" ? null : sub.order.reject;
    if (sub.order.status === "pending") {
      todayBuy += (sub.order.estGross || 0) + (sub.order.estFee || 0);
      row.detail = `\u51BB\u7ED3 ${(sub.order.need || 0).toFixed(2)} \u5143\uFF0C\u5F85\u6B21\u4E00\u4EA4\u6613\u65E5\u64AE\u5408`;
    } else {
      row.stage = "order";
    }
    results.push(row);
  }
  cur = { ...cur, logs: appendLog(cur, {
    date,
    code: null,
    name: null,
    side: "buy",
    qty: null,
    stage: "order",
    result: "info",
    text: `\u6279\u91CF\u4E70\u5165\u59D4\u6258\u5B8C\u6210\uFF1A\u63D0\u4EA4 ${results.filter((r) => r.status === "submitted").length} \u7B14 / \u5171 ${results.length} \u53EA\uFF0C\u62E6\u622A ${results.filter((r) => r.status === "blocked").length} \u7B14\uFF08\u5176\u4E2D\u9F99\u864E\u8FC7\u6EE4 ${results.filter((r) => r.stage === "lhb").length} \u7B14\u3001\u98CE\u63A7 ${results.filter((r) => r.stage === "risk").length} \u7B14\uFF09`
  }) };
  return {
    next: cur,
    results: results.map((r) => ({ ...r, detail8: r.order ? orderDetail(r.order, cur) : null })),
    submitted: results.filter((r) => r.status === "submitted").map((r) => ({ ...r, detail8: orderDetail(r.order, cur) })),
    blocked: results.filter((r) => r.status === "blocked"),
    summary: {
      total: results.length,
      submitted: results.filter((r) => r.status === "submitted").length,
      blocked: results.filter((r) => r.status === "blocked").length,
      blockedByLhb: results.filter((r) => r.stage === "lhb").length,
      blockedByRisk: results.filter((r) => r.stage === "risk").length,
      todayBuyAmount: round2(todayBuy),
      todayBuyPct: round2(todayBuy / Math.max(1e-9, accountStats(cur).total) * 100)
    }
  };
}
function batchSell(acct, items, day, opts = {}) {
  const date = opts.date || day?.trade_date || acct.lastSettle || null;
  const quotes = quotesFromDay(day);
  let cur = acct;
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of Array.isArray(items) ? items : []) {
    const code = String(raw?.code || raw?.symbol || "").trim();
    const row = { code, name: "", side: "sell", qty: null, status: "blocked", stage: null, reason: null, order: null };
    if (!code) {
      row.reason = "\u4EE3\u7801\u4E3A\u7A7A";
      results.push(row);
      continue;
    }
    if (seen.has(code)) {
      row.reason = "\u672C\u6279\u6B21\u5185\u91CD\u590D\u6807\u7684\uFF0C\u5DF2\u8DF3\u8FC7";
      results.push(row);
      continue;
    }
    seen.add(code);
    const quote = quotes[code] || null;
    const pos = cur.positions[code];
    row.name = quote?.name || pos?.name || code;
    if (!pos || pos.qty <= 0) {
      row.status = "blocked";
      row.stage = "position";
      row.reason = REJECT.NO_POSITION;
      results.push(row);
      continue;
    }
    if (!quote || quote.price == null) {
      row.status = "blocked";
      row.stage = "quote";
      row.reason = REJECT.NO_QUOTE;
      results.push(row);
      continue;
    }
    const frozen = (cur.pending || []).filter((p) => p.code === code && p.side === "sell").reduce((a, p) => a + p.qty, 0);
    const freeAvail = Math.max(0, (pos.avail || 0) - frozen);
    let qty = Number.isInteger(raw?.qty) ? raw.qty : null;
    if (qty == null) {
      const p = Number.isFinite(+raw?.pct) ? +raw.pct : 1;
      qty = p >= 1 ? freeAvail : qtyByHoldPct(freeAvail, p);
    }
    qty = Math.min(qty, freeAvail);
    row.qty = qty;
    if (!qty || qty <= 0) {
      row.status = "blocked";
      row.stage = "qty";
      row.reason = "\u53EF\u5356\u6570\u91CF\u4E3A 0\uFF08T+1 \u672A\u89E3\u51BB\u6216\u5DF2\u5168\u90E8\u6302\u5355\uFF09";
      results.push(row);
      continue;
    }
    const sub = submitOrder(cur, { code, side: "sell", qty, reason: raw?.reason || "\u6279\u91CF\u5356\u51FA\u59D4\u6258", slip: raw?.slip }, { ...quote, name: row.name }, { date });
    cur = sub.next;
    row.order = sub.order;
    row.status = sub.order.status === "pending" ? "submitted" : "blocked";
    row.reason = sub.order.status === "pending" ? null : sub.order.reject;
    if (row.status === "submitted") row.detail = "\u5F85\u6B21\u4E00\u4EA4\u6613\u65E5\u6309\u771F\u5B9E\u6536\u76D8\u4EF7\u64AE\u5408\u540E\u56DE\u6B3E";
    results.push(row);
  }
  cur = { ...cur, logs: appendLog(cur, {
    date,
    code: null,
    side: "sell",
    qty: null,
    stage: "order",
    result: "info",
    text: `\u6279\u91CF\u5356\u51FA\u59D4\u6258\u5B8C\u6210\uFF1A\u63D0\u4EA4 ${results.filter((r) => r.status === "submitted").length} \u7B14 / \u5171 ${results.length} \u53EA`
  }) };
  return {
    next: cur,
    results,
    submitted: results.filter((r) => r.status === "submitted"),
    blocked: results.filter((r) => r.status === "blocked"),
    summary: {
      total: results.length,
      submitted: results.filter((r) => r.status === "submitted").length,
      blocked: results.filter((r) => r.status === "blocked").length
    }
  };
}
function orderDetail(rec, acct) {
  if (!rec) return null;
  const side = rec.side;
  const status = rec.status || (rec.fillDate ? "filled" : "unknown");
  const settled = status === "filled";
  const settleDate = rec.settleDate ?? rec.fillDate ?? null;
  const qty = +rec.qty || 0;
  const fillPrice2 = rec.fillPrice != null ? +rec.fillPrice : settled && rec.price != null ? +rec.price : null;
  const price = fillPrice2 != null ? fillPrice2 : rec.estPrice != null ? +rec.estPrice : rec.price != null ? +rec.price : rec.submitPrice != null ? +rec.submitPrice : null;
  const gross = rec.gross != null ? +rec.gross : price != null ? round2(price * qty) : null;
  const feeTotal = rec.fee != null ? +rec.fee : rec.estFee != null ? +rec.estFee : null;
  const feeBreak = gross != null && gross > 0 ? fees(gross, side) : { comm: 0, transfer: 0, stamp: 0, total: 0 };
  let frozenOrReturn = null;
  if (side === "buy") {
    const amount = gross != null && feeTotal != null ? round2(gross + feeTotal) : rec.need != null ? +rec.need : null;
    frozenOrReturn = { kind: "freeze", amount, label: settled ? "\u5B9E\u9645\u5360\u7528" : "\u51BB\u7ED3\u8D44\u91D1" };
  } else {
    const amount = gross != null && feeTotal != null ? round2(gross - feeTotal) : null;
    frozenOrReturn = { kind: "return", amount, label: settled ? "\u5B9E\u9645\u56DE\u6B3E" : "\u9884\u4F30\u56DE\u6B3E" };
  }
  let matchNote;
  if (status === "pending") {
    matchNote = `\u6536\u76D8\u63D0\u4EA4\uFF0C\u5C06\u4E8E\u6B21\u4E00\u4EA4\u6613\u65E5\u6309\u771F\u5B9E\u6536\u76D8\u4EF7\u64AE\u5408\uFF08T+1\uFF09\uFF1B\u9884\u4F30\u6210\u4EA4\u4EF7 ${price} \u5143\uFF08\u542B\u6ED1\u70B9 ${((rec.slip ?? DEFAULT_SLIP) * 1e4).toFixed(0)}\u2031\uFF09`;
  } else if (settled) {
    matchNote = `\u5DF2\u4E8E ${settleDate || "\u2014"} \u6309\u771F\u5B9E\u6536\u76D8\u4EF7\u64AE\u5408\uFF0C\u5B9E\u9645\u6210\u4EA4\u4EF7 ${price} \u5143` + (rec.driftPct != null ? `\uFF08\u76F8\u5BF9\u63D0\u4EA4\u4EF7\u6F02\u79FB ${rec.driftPct > 0 ? "+" : ""}${rec.driftPct}%\uFF09` : "");
  } else if (status === "rejected") {
    matchNote = `\u672A\u63D0\u4EA4\uFF1A${rec.reject || "\u672A\u77E5\u539F\u56E0"}${rec.detail ? "\uFF08" + rec.detail + "\uFF09" : ""}`;
  } else if (status === "expired") {
    matchNote = `\u59D4\u6258\u5931\u6548\uFF1A${rec.reject || "\u672A\u77E5\u539F\u56E0"}${rec.detail ? "\uFF08" + rec.detail + "\uFF09" : ""}`;
  } else if (status === "cancelled") {
    matchNote = `\u5DF2\u64A4\u5355\uFF08${rec.cancelDate || "\u2014"}\uFF09\uFF0C\u51BB\u7ED3\u8D44\u91D1\u5DF2\u91CA\u653E`;
  } else {
    matchNote = "";
  }
  return {
    id: rec.id ?? null,
    code: rec.code,
    name: rec.name || "",
    side,
    sideLabel: side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA",
    status,
    ok: status === "pending" || status === "filled",
    qty,
    submitDate: rec.submitDate ?? null,
    settleDate,
    submitPrice: rec.submitPrice ?? null,
    estPrice: rec.estPrice ?? null,
    fillPrice: fillPrice2,
    price,
    grossAmount: gross,
    fee: {
      commission: feeBreak.comm,
      transfer: feeBreak.transfer,
      stampTax: feeBreak.stamp,
      total: feeTotal != null ? feeTotal : feeBreak.total
    },
    frozenOrReturn,
    reason: rec.reason || "",
    text: matchNote,
    // 冻结/回款资金的扁平字段（规则原文口径，便于直接展示）
    freezeAmount: side === "buy" ? frozenOrReturn.amount : 0,
    returnAmount: side === "sell" ? frozenOrReturn.amount : 0,
    holdingQty: acct?.positions?.[rec.code]?.qty ?? null
  };
}
function settleDay(acct, date, quotes = {}, opts = {}) {
  const log = [];
  let cur = acct;
  const exec = normalizeExec(opts.exec);
  const settledIds = /* @__PURE__ */ new Set();
  const markDone = (id) => settledIds.add(id);
  let t1Hold = 0;
  for (const p of cur.pending || []) {
    if (p.submitDate && date && String(p.submitDate) >= String(date)) {
      t1Hold++;
      continue;
    }
    const q = quotes[p.code];
    if (!q || q.price == null || !Number.isFinite(+q.price)) {
      log.push({ id: p.id, code: p.code, name: p.name, side: p.side, qty: p.qty, status: "expired", reason: REJECT.NO_QUOTE, detail: `${date} \u65E0\u8BE5\u80A1\u771F\u5B9E\u884C\u60C5\uFF0C\u59D4\u6258\u5931\u6548\u5E76\u91CA\u653E\u51BB\u7ED3` });
      cur = { ...cur, cash: toYuan(toCents(cur.cash) + toCents(p.need || 0)), freeze: toYuan(Math.max(0, toCents(cur.freeze || 0) - toCents(p.need || 0))), orders: cur.orders.map((o) => o.id === p.id ? { ...o, status: "expired", settleDate: date, reject: REJECT.NO_QUOTE, detail: "\u8BE5\u4EA4\u6613\u65E5\u65E0\u771F\u5B9E\u884C\u60C5" } : o) };
      markDone(p.id);
      continue;
    }
    const name = q.name || p.name || "";
    const hit = isLimitHit(q.changePct, p.code, name, 0.5, q.price, q.prevClose ?? null);
    if (p.side === "buy" && hit === "up") {
      if (exec.limitFillProb) {
        const rng = fillRng(p.id, date, exec.seed);
        if (rng() >= exec.limitUpFillRatio) {
          log.push({ ...pick(p), status: "expired", reason: "\u6DA8\u505C\u6392\u961F\u672A\u6392\u5230", detail: `${date} ${q.changePct}% \u6DA8\u505C\uFF0C\u524D\u6392\u6210\u4EA4\u6BD4\u4F8B ${exec.limitUpFillRatio * 100 | 0}%\uFF0C\u672C\u5355\u672A\u6392\u5230\uFF0C\u5F53\u65E5\u64A4\u5355` });
          cur = releaseFreeze(cur, p, { status: "expired", settleDate: date, reject: "\u6DA8\u505C\u6392\u961F\u672A\u6392\u5230", detail: "\u5F53\u65E5\u64A4\u5355" });
          markDone(p.id);
          continue;
        }
      } else if (exec.mode === "strict") {
        const oc = limitBuyOutcome(p, q, exec, date);
        if (!oc.fill) {
          log.push({ ...pick(p), status: "expired", reason: "\u6253\u677F\u672A\u6210\u4EA4", detail: `${date} ${q.changePct}% \u6DA8\u505C\u6253\u677F\uFF1A${oc.reason}` });
          cur = releaseFreeze(cur, p, { status: "expired", settleDate: date, reject: "\u6253\u677F\u672A\u6210\u4EA4", detail: oc.reason });
          markDone(p.id);
          continue;
        }
      } else {
        log.push({ ...pick(p), status: "expired", reason: "\u6DA8\u505C\u4EF7\u65E0\u6CD5\u4E70\u5165", detail: `${date} ${q.changePct}% \u4E00\u5B57/\u89E6\u677F\u6DA8\u505C\uFF0C\u65E0\u5356\u76D8\uFF0C\u59D4\u6258\u5931\u6548` });
        cur = releaseFreeze(cur, p, { status: "expired", settleDate: date, reject: "\u6DA8\u505C\u4EF7\u65E0\u6CD5\u4E70\u5165", detail: `${date} \u89E6\u53CA\u6DA8\u505C\uFF0C\u65E0\u5356\u76D8` });
        markDone(p.id);
        continue;
      }
    }
    if (p.side === "sell" && hit === "down") {
      if (p.escape || p.requeue) {
        log.push({ ...pick(p), status: "queued", reason: "\u8DCC\u505C\u4EF7\u65E0\u6CD5\u5356\u51FA\uFF0C\u4FDD\u7559\u59D4\u6258\u6B21\u65E5\u91CD\u8BD5", detail: `${date} ${q.changePct}% \u89E6\u53CA\u8DCC\u505C\uFF0C\u65E0\u4E70\u76D8\uFF0C\u59D4\u6258\u4FDD\u7559\u6392\u961F` });
        continue;
      }
      if (exec.limitFillProb) {
        const rng = fillRng(p.id, date, exec.seed);
        if (rng() >= exec.limitDownFillProb) {
          log.push({ ...pick(p), status: "queued", reason: "\u8DCC\u505C\u5356\u51FA\u672A\u6210\u4EA4\uFF0C\u4FDD\u7559\u59D4\u6258\u6B21\u65E5\u91CD\u8BD5", detail: `${date} ${q.changePct}% \u89E6\u53CA\u8DCC\u505C\uFF0C\u6210\u4EA4\u6982\u7387 ${exec.limitDownFillProb * 100 | 0}%\uFF0C\u672C\u5355\u672A\u7838\u51FA\uFF0C\u6392\u961F` });
          continue;
        }
      } else {
        log.push({ ...pick(p), status: "expired", reason: "\u8DCC\u505C\u4EF7\u65E0\u6CD5\u5356\u51FA", detail: `${date} ${q.changePct}% \u89E6\u53CA\u8DCC\u505C\uFF0C\u65E0\u4E70\u76D8\uFF0C\u59D4\u6258\u5931\u6548` });
        cur = { ...cur, orders: cur.orders.map((o) => o.id === p.id ? { ...o, status: "expired", settleDate: date, reject: "\u8DCC\u505C\u4EF7\u65E0\u6CD5\u5356\u51FA", detail: `${date} \u89E6\u53CA\u8DCC\u505C\uFF0C\u65E0\u4E70\u76D8` } : o) };
        markDone(p.id);
        continue;
      }
    }
    const escaped = false;
    const slip = exec.mode === "strict" && hit == null ? exec.slipNonLimit : Number.isFinite(p.slip) ? p.slip : DEFAULT_SLIP;
    const px = fillPrice(+q.price, p.side, slip);
    const gross = round2(px * p.qty);
    const fee = fees(gross, p.side).total;
    const need = p.side === "buy" ? round2(gross + fee) : 0;
    if (p.side === "buy") {
      const cashBack = toCents(cur.cash) + toCents(p.need || 0);
      const freezeAfter = Math.max(0, toCents(cur.freeze || 0) - toCents(p.need || 0));
      if (cashBack + 1e-9 < toCents(need)) {
        log.push({ ...pick(p), status: "expired", reason: REJECT.NO_CASH, detail: `${date} \u5B9E\u9645\u6210\u4EA4\u4EF7 ${px} \u5143\u9700 ${need.toFixed(2)} \u5143\uFF0C\u51BB\u7ED3 ${(p.need || 0).toFixed(2)} \u5143\u4E0D\u8DB3` });
        cur = { ...cur, cash: toYuan(cashBack), freeze: toYuan(freezeAfter), orders: cur.orders.map((o) => o.id === p.id ? { ...o, status: "expired", settleDate: date, reject: REJECT.NO_CASH, detail: `\u5B9E\u9645\u6210\u4EA4\u4EF7 ${px} \u5143\uFF0C\u8D44\u91D1\u4E0D\u8DB3` } : o) };
        markDone(p.id);
        continue;
      }
      const pos = cur.positions[p.code] || { code: p.code, name, qty: 0, avail: 0, avgCost: 0, cost: 0, grossBuy: 0, fee: 0, openDate: date, days: 0, lastBuyDate: null };
      const applied = applyBuy(pos, { qty: p.qty, price: px, fee });
      const isZtLb = !!(pos.isZtLb || p.tag === "zt" || q.changePct != null && q.changePct >= 9.8);
      const newPos = { ...pos, ...applied, name, avail: pos.avail || 0, openDate: pos.openDate || date, lastBuyDate: date, last: +q.price, lastDate: date, pxStale: false, sector: p.sector || pos.sector || null, isZtLb, iceTrial: p.iceTrial || pos.iceTrial || null, antiNuke: p.antiNuke || pos.antiNuke || null, streak: p.streak != null ? p.streak : pos.streak != null ? pos.streak : null, slipProfile: p.slipProfile != null ? p.slipProfile : pos.slipProfile != null ? pos.slipProfile : null, changePct: q && q.changePct != null ? +q.changePct : pos.changePct != null ? pos.changePct : null };
      cur = {
        ...cur,
        cash: toYuan(cashBack - toCents(need)),
        freeze: toYuan(freezeAfter),
        positions: { ...cur.positions, [p.code]: newPos },
        totalFee: toYuan(toCents(cur.totalFee || 0) + toCents(fee)),
        orders: cur.orders.map((o) => o.id === p.id ? fillRec(o, { date, px, gross, fee }) : o),
        trades: [...cur.trades, tradeRec(p, { date, px, gross, fee, name })]
      };
      log.push({ ...pick(p), status: "filled", price: px, gross, fee, slip: p.slip ?? null, slipBase: p.slipBase ?? null, slipImpact: p.slipImpact ?? null });
      markDone(p.id);
    } else {
      const pos = cur.positions[p.code];
      if (!pos) {
        log.push({ ...pick(p), status: "expired", reason: REJECT.NO_POSITION, detail: `${date} \u5DF2\u65E0\u6301\u4ED3` });
        cur = { ...cur, orders: cur.orders.map((o) => o.id === p.id ? { ...o, status: "expired", settleDate: date, reject: REJECT.NO_POSITION } : o) };
        markDone(p.id);
        continue;
      }
      const applied = applySell(pos, { qty: p.qty, price: px, fee });
      const positions2 = { ...cur.positions };
      if (applied.qty === 0) delete positions2[p.code];
      else positions2[p.code] = { ...pos, ...applied, avail: Math.max(0, (pos.avail || 0) - p.qty), last: +q.price, lastDate: date, pxStale: false };
      cur = {
        ...cur,
        cash: toYuan(toCents(cur.cash) + toCents(gross) - toCents(fee)),
        realized: toYuan(toCents(cur.realized || 0) + toCents(applied.realized)),
        totalFee: toYuan(toCents(cur.totalFee || 0) + toCents(fee)),
        positions: positions2,
        orders: cur.orders.map((o) => o.id === p.id ? fillRec(o, { date, px, gross, fee }) : o),
        trades: [...cur.trades, tradeRec(p, { date, px, gross, fee, name })]
      };
      log.push({ ...pick(p), status: "filled", price: px, gross, fee, realized: applied.realized, slip: p.slip ?? null, slipBase: p.slipBase ?? null, slipImpact: p.slipImpact ?? null, reason: escaped ? "\u8DCC\u505C\u9003\u751F(\u6392\u961F\u6210\u4EA4)" : p.reason || null });
      markDone(p.id);
    }
  }
  cur = { ...cur, pending: (cur.pending || []).filter((x) => !settledIds.has(x.id)) };
  const positions = {};
  const missing = [];
  for (const [code, p] of Object.entries(cur.positions || {})) {
    const q = quotes[code];
    const px = q && q.price != null && Number.isFinite(+q.price) ? +q.price : null;
    if (px == null) missing.push(code);
    const boughtToday = p.lastBuyDate === date;
    positions[code] = {
      ...p,
      last: px != null ? px : p.last,
      lastDate: px != null ? date : p.lastDate,
      pxStale: px == null,
      changePct: q && q.changePct != null ? +q.changePct : p.changePct,
      avail: boughtToday ? p.avail || 0 : p.qty,
      days: (p.days || 0) + 1
    };
  }
  const next0 = { ...cur, positions, lastSettle: date };
  let logged = next0;
  for (const x of log) {
    const isFill = x.status === "filled";
    logged = {
      ...logged,
      logs: appendLog(logged, {
        date,
        code: x.code,
        name: x.name,
        side: x.side,
        qty: x.qty,
        stage: "settle",
        result: isFill ? "filled" : "expired",
        reason: isFill ? null : x.reason || null,
        text: isFill ? `\u6210\u4EA4\uFF1A${x.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"} ${x.qty} \u80A1 @${x.price} \u5143\uFF0C\u6210\u4EA4\u989D ${(x.gross || 0).toFixed(2)} \u5143\uFF0C\u8D39\u7528 ${(x.fee || 0).toFixed(2)} \u5143` + (x.side === "buy" ? `\uFF0C\u5360\u7528 ${((x.gross || 0) + (x.fee || 0)).toFixed(2)} \u5143` : `\uFF0C\u56DE\u6B3E ${((x.gross || 0) - (x.fee || 0)).toFixed(2)} \u5143`) : `\u59D4\u6258\u5931\u6548\uFF1A${x.reason || "\u672A\u77E5\u539F\u56E0"}${x.detail ? "\uFF08" + x.detail + "\uFF09" : ""}`
      })
    };
  }
  let exitList = [];
  if (opts.exitMode === "strict_v1") {
    const ex = strictV1Exits(logged, date);
    logged = ex.next;
    exitList = ex.list;
  } else {
    const stops = opts.scanStopLoss === false ? { list: [], apply: (a) => a } : scanStopLoss(logged, date, opts.stops);
    if (stops.list.length) logged = stops.apply(logged, date);
    exitList = stops.list || [];
    if (opts.trailingStopPct > 0) {
      const tr = trailingStopExits(logged, date, quotes, { trigger: opts.trailingTriggerPct ?? 0.06, pullback: opts.trailingStopPct ?? 0.025 });
      logged = tr.apply(logged, date);
      exitList = exitList.concat(tr.list);
    }
  }
  const stats = accountStats(logged);
  const navRow = { date, equity: round2(stats.total), cash: round2(stats.cash + stats.freeze), marketValue: round2(stats.marketValue) };
  const nav = [...acct.nav || []];
  if (!nav.some((r) => r.date === date)) nav.push(navRow);
  return {
    account: { ...logged, nav },
    fills: log.filter((x) => x.status === "filled"),
    expired: log.filter((x) => x.status !== "filled"),
    t1Hold,
    // 因 T+1 门禁顺延的委托数（留在 pending，未失效）
    stopLoss: exitList,
    missing,
    ...navRow
  };
}
function strictV1Exits(acct, date, cfg2 = EXIT_V1) {
  const list = [];
  let cur = acct;
  for (const [code, p] of Object.entries(cur.positions || {})) {
    if (!p || p.qty <= 0 || !(p.avgCost > 0) || p.last == null) continue;
    const pnl = (p.last - p.avgCost) / p.avgCost;
    const days = p.days || 0;
    const isZt = !!p.isZtLb;
    let peak = p.peak != null ? p.peak : p.last;
    let trailActive = !!p.trailActive;
    if (!isZt) {
      if (pnl > 0) peak = Math.max(peak, p.last);
      if (pnl > cfg2.trailTrigger) trailActive = true;
      if (pnl <= 0) trailActive = false;
    }
    if (!isZt && (peak !== p.peak || trailActive !== p.trailActive)) {
      cur = { ...cur, positions: { ...cur.positions, [code]: { ...p, peak, trailActive } } };
    }
    let reason = null;
    if (isZt && cfg2.ztNextDay && days >= 2) {
      reason = "\u9694\u65E5\u5F3A\u5236\u4E86\u7ED3(\u8FDE\u677F)";
    } else if (!isZt) {
      if (trailActive && pnl > 0 && (peak - p.last) / peak >= cfg2.trailPullback) reason = "\u79FB\u52A8\u6B62\u76C8(\u56DE\u64A43%)";
      else if (pnl <= cfg2.hardStop) reason = "\u786C\u6B62\u635F(-5%)";
      else if (pnl < 0 && days >= cfg2.lossMaxDays) reason = "\u4E8F\u635F\u4E0D\u8FC7\u4E09(\u5F3A\u5236\u5E73\u4ED3)";
    }
    if (!reason) continue;
    const avail = Math.max(0, p.avail || 0);
    const frozen = (cur.pending || []).filter((x) => x.code === code && x.side === "sell").reduce((a, x) => a + x.qty, 0);
    const freeAvail = Math.max(0, avail - frozen);
    const item = {
      code,
      name: p.name || code,
      pnlPct: round2(pnl * 100),
      last: p.last,
      avgCost: p.avgCost,
      qty: p.qty,
      avail,
      freeAvail,
      willSell: Math.min(freeAvail, p.qty),
      reason,
      skipped: null
    };
    if (freeAvail <= 0) {
      item.skipped = frozen > 0 ? "\u5DF2\u6709\u5356\u51FA\u59D4\u6258\u5F85\u6210\u4EA4" : "T+1 \u7EA6\u675F\uFF1A\u5F53\u65E5\u4E70\u5165\u6B21\u4E00\u4EA4\u6613\u65E5\u624D\u53EF\u5356";
    } else if ((cur.pending || []).some((x) => x.code === code)) {
      item.skipped = "\u8BE5\u80A1\u5DF2\u6709\u5F85\u6210\u4EA4\u59D4\u6258";
    }
    list.push(item);
  }
  for (const it of list) {
    if (it.skipped || it.willSell <= 0) {
      cur = { ...cur, logs: appendLog(cur, {
        date,
        code: it.code,
        name: it.name,
        side: "sell",
        qty: it.qty,
        stage: "exit",
        result: "expired",
        reason: it.skipped,
        text: `\u89E6\u53D1\u300C${it.reason}\u300D\uFF08\u6D6E\u4E8F ${it.pnlPct}%\uFF09\uFF0C\u4F46\u65E0\u6CD5\u751F\u6210\u5356\u51FA\u59D4\u6258\uFF1A${it.skipped}`
      }) };
      continue;
    }
    const q = { code: it.code, name: it.name, price: it.last };
    const sub = submitOrder(cur, { code: it.code, side: "sell", qty: it.willSell, reason: it.reason, escape: cfg2.escape, requeue: true }, q, { date });
    cur = sub.next;
    if (sub.order.status !== "pending") {
      cur = { ...cur, logs: appendLog(cur, {
        date,
        code: it.code,
        name: it.name,
        side: "sell",
        qty: it.willSell,
        stage: "exit",
        result: "rejected",
        reason: sub.order.reject,
        text: `\u89E6\u53D1\u300C${it.reason}\u300D\uFF0C\u4F46\u5356\u51FA\u59D4\u6258\u88AB\u62D2\uFF1A${sub.order.reject}${sub.order.detail ? "\uFF08" + sub.order.detail + "\uFF09" : ""}`
      }) };
    } else {
      cur = { ...cur, logs: appendLog(cur, {
        date,
        code: it.code,
        name: it.name,
        side: "sell",
        qty: it.willSell,
        stage: "exit",
        result: "submitted",
        reason: it.reason,
        text: `\u89E6\u53D1\u300C${it.reason}\u300D\uFF08\u6D6E\u4E8F ${it.pnlPct}% / \u6210\u672C ${it.avgCost} / \u73B0\u4EF7 ${it.last}\uFF09\uFF0C\u5DF2\u751F\u6210 T+1 \u5356\u51FA\u59D4\u6258 ${it.willSell} \u80A1`
      }) };
    }
  }
  return { next: cur, list };
}
function scanStopLoss(acct, date, stops) {
  const list = [];
  const positions = acct?.positions || {};
  for (const [code, p] of Object.entries(positions)) {
    if (!p || p.qty <= 0 || !(p.avgCost > 0) || p.last == null) continue;
    const pnlPct = (p.last - p.avgCost) / p.avgCost;
    if (p.trendMa60 != null && p.last != null && p.last < p.trendMa60) {
      const avail2 = Math.max(0, p.avail || 0);
      const frozen2 = (acct.pending || []).filter((x) => x.code === code && x.side === "sell").reduce((a, x) => a + x.qty, 0);
      const freeAvail2 = Math.max(0, avail2 - frozen2);
      list.push({
        code,
        name: p.name || code,
        pnlPct: round2(pnlPct * 100),
        last: p.last,
        avgCost: p.avgCost,
        qty: p.qty,
        avail: avail2,
        freeAvail: freeAvail2,
        willSell: Math.min(freeAvail2, p.qty),
        skipped: null,
        exitKind: "trend"
      });
      continue;
    }
    let floor = HARD_STOP_LOSS;
    if (stops && stops.baseHardStopPct != null) floor = stops.baseHardStopPct;
    let tierStop = null;
    const sEntry = Number.isFinite(+p.streak) ? +p.streak : 0;
    if (stops && stops.streakTier && Array.isArray(stops.tier) && stops.tier.length) {
      const tiers = [...stops.tier].sort((a, b) => +b.streak - +a.streak);
      const hit = tiers.find((t) => sEntry >= +t.streak);
      if (hit != null && hit.stop != null) {
        floor = Math.min(floor, hit.stop);
        tierStop = hit.stop;
      }
    }
    if (p.antiNuke) {
      floor = -0.1;
      tierStop = null;
    }
    if (pnlPct > floor + 1e-12) continue;
    const avail = Math.max(0, p.avail || 0);
    const frozen = (acct.pending || []).filter((x) => x.code === code && x.side === "sell").reduce((a, x) => a + x.qty, 0);
    const freeAvail = Math.max(0, avail - frozen);
    const item = {
      code,
      name: p.name || code,
      pnlPct: round2(pnlPct * 100),
      last: p.last,
      avgCost: p.avgCost,
      qty: p.qty,
      avail,
      freeAvail,
      willSell: Math.min(freeAvail, p.qty),
      skipped: null,
      tierStop,
      streak: sEntry
    };
    if (freeAvail <= 0) {
      item.skipped = frozen > 0 ? "\u5DF2\u6709\u5356\u51FA\u59D4\u6258\u5F85\u6210\u4EA4" : "T+1 \u7EA6\u675F\uFF1A\u5F53\u65E5\u4E70\u5165\u6B21\u4E00\u4EA4\u6613\u65E5\u624D\u53EF\u5356";
    } else if ((acct.pending || []).some((x) => x.code === code)) {
      item.skipped = "\u8BE5\u80A1\u5DF2\u6709\u5F85\u6210\u4EA4\u59D4\u6258";
    }
    list.push(item);
  }
  return {
    list,
    apply: (account, d) => {
      let cur = account;
      for (const it of list) {
        const stopReason = it.exitKind === "trend" ? `\u8D8B\u52BF\u7834\u4F4D\uFF08\u8DCC\u7834MA60\uFF0C\u73B0\u4EF7${it.last}\uFF09` : it.tierStop != null ? `\u6B62\u635F\uFF08\u5206\u7EA7\u6D6E\u4E8F ${it.pnlPct}%\uFF0C\u8FDE\u677F${it.streak}\u677F\uFF09` : `\u6B62\u635F\uFF08\u6D6E\u4E8F ${it.pnlPct}%\uFF09`;
        if (it.skipped || it.willSell <= 0) {
          cur = { ...cur, logs: appendLog(cur, {
            date: d,
            code: it.code,
            name: it.name,
            side: "sell",
            qty: it.qty,
            stage: "stop",
            result: "expired",
            reason: it.skipped,
            text: `\u89E6\u53D1 ${stopReason}\uFF08\u6D6E\u4E8F ${it.pnlPct}%\uFF09\uFF0C\u4F46\u65E0\u6CD5\u751F\u6210\u5356\u51FA\u59D4\u6258\uFF1A${it.skipped}`
          }) };
          continue;
        }
        const q = { code: it.code, name: it.name, price: it.last };
        const sub = submitOrder(cur, { code: it.code, side: "sell", qty: it.willSell, reason: stopReason, requeue: true }, q, { date: d });
        cur = sub.next;
        if (sub.order.status !== "pending") {
          cur = { ...cur, logs: appendLog(cur, {
            date: d,
            code: it.code,
            name: it.name,
            side: "sell",
            qty: it.willSell,
            stage: "stop",
            result: "rejected",
            reason: sub.order.reject,
            text: `\u89E6\u53D1 ${stopReason}\uFF0C\u4F46\u5356\u51FA\u59D4\u6258\u88AB\u62D2\uFF1A${sub.order.reject}${sub.order.detail ? "\uFF08" + sub.order.detail + "\uFF09" : ""}`
          }) };
        } else {
          cur = { ...cur, logs: appendLog(cur, {
            date: d,
            code: it.code,
            name: it.name,
            side: "sell",
            qty: it.willSell,
            stage: "stop",
            result: "submitted",
            reason: stopReason,
            text: `\u89E6\u53D1 ${stopReason}\uFF08\u6D6E\u4E8F ${it.pnlPct}%\uFF0C\u73B0\u4EF7 ${it.last} \u5143 / \u6210\u672C ${it.avgCost} \u5143\uFF09\uFF0C\u5DF2\u751F\u6210 T+1 \u5356\u51FA\u59D4\u6258 ${it.willSell} \u80A1`
          }) };
        }
      }
      return cur;
    }
  };
}
function trailingStopExits(acct, date, quotes, { trigger = 0.06, pullback = 0.025 } = {}) {
  const list = [];
  const positions = acct?.positions || {};
  let curTrack = acct;
  for (const [code, p] of Object.entries(positions)) {
    if (!p || p.qty <= 0 || !(p.avgCost > 0) || p.last == null) continue;
    const pnl = (p.last - p.avgCost) / p.avgCost;
    let peak = p.peak != null ? p.peak : p.last;
    let trailActive = !!p.trailActive;
    if (pnl > 0) peak = Math.max(peak, p.last);
    if (pnl > trigger) trailActive = true;
    if (pnl <= 0) trailActive = false;
    if (peak !== p.peak || trailActive !== p.trailActive) {
      curTrack = { ...curTrack, positions: { ...curTrack.positions, [code]: { ...p, peak, trailActive } } };
    }
    const q = quotes?.[code];
    const hit = q ? isLimitHit(q.changePct, code, p.name, 0.5, q.price, q.prevClose ?? null) : null;
    if (trailActive && pnl > 0 && hit !== "up" && (peak - p.last) / peak >= pullback) {
      const avail = Math.max(0, p.avail || 0);
      const frozen = (curTrack.pending || []).filter((x) => x.code === code && x.side === "sell").reduce((a, x) => a + x.qty, 0);
      const freeAvail = Math.max(0, avail - frozen);
      const item = {
        code,
        name: p.name || code,
        pnlPct: round2(pnl * 100),
        last: p.last,
        avgCost: p.avgCost,
        qty: p.qty,
        avail,
        freeAvail,
        willSell: Math.min(freeAvail, p.qty),
        skipped: null,
        reason: `\u79FB\u52A8\u6B62\u76C8(\u56DE\u64A4${(pullback * 100).toFixed(0)}%)`
      };
      if (freeAvail <= 0) {
        item.skipped = frozen > 0 ? "\u5DF2\u6709\u5356\u51FA\u59D4\u6258\u5F85\u6210\u4EA4" : "T+1 \u7EA6\u675F\uFF1A\u5F53\u65E5\u4E70\u5165\u6B21\u4E00\u4EA4\u6613\u65E5\u624D\u53EF\u5356";
      } else if ((curTrack.pending || []).some((x) => x.code === code)) {
        item.skipped = "\u8BE5\u80A1\u5DF2\u6709\u5F85\u6210\u4EA4\u59D4\u6258";
      }
      list.push(item);
    }
  }
  return {
    list,
    apply: (account, d) => {
      let cur = account;
      if (curTrack !== acct) cur = { ...cur, positions: curTrack.positions };
      for (const it of list) {
        if (it.skipped || it.willSell <= 0) {
          cur = { ...cur, logs: appendLog(cur, {
            date: d,
            code: it.code,
            name: it.name,
            side: "sell",
            qty: it.qty,
            stage: "exit",
            result: "expired",
            reason: it.skipped,
            text: `\u89E6\u53D1\u300C${it.reason}\u300D\uFF08\u6D6E\u76C8 ${it.pnlPct}%\uFF09\uFF0C\u4F46\u65E0\u6CD5\u751F\u6210\u5356\u51FA\u59D4\u6258\uFF1A${it.skipped}`
          }) };
          continue;
        }
        const q = { code: it.code, name: it.name, price: it.last };
        const sub = submitOrder(cur, { code: it.code, side: "sell", qty: it.willSell, reason: it.reason }, q, { date: d });
        cur = sub.next;
        if (sub.order.status !== "pending") {
          cur = { ...cur, logs: appendLog(cur, {
            date: d,
            code: it.code,
            name: it.name,
            side: "sell",
            qty: it.willSell,
            stage: "exit",
            result: "rejected",
            reason: sub.order.reject,
            text: `\u89E6\u53D1\u300C${it.reason}\u300D\uFF0C\u4F46\u5356\u51FA\u59D4\u6258\u88AB\u62D2\uFF1A${sub.order.reject}${sub.order.detail ? "\uFF08" + sub.order.detail + "\uFF09" : ""}`
          }) };
        } else {
          cur = { ...cur, logs: appendLog(cur, {
            date: d,
            code: it.code,
            name: it.name,
            side: "sell",
            qty: it.willSell,
            stage: "exit",
            result: "submitted",
            reason: it.reason,
            text: `\u89E6\u53D1\u300C${it.reason}\u300D\uFF08\u6D6E\u76C8 ${it.pnlPct}% / \u6210\u672C ${it.avgCost} / \u73B0\u4EF7 ${it.last}\uFF09\uFF0C\u5DF2\u751F\u6210 T+1 \u5356\u51FA\u59D4\u6258 ${it.willSell} \u80A1`
          }) };
        }
      }
      return cur;
    }
  };
}
function pick(p) {
  return { id: p.id, code: p.code, name: p.name, side: p.side, qty: p.qty };
}
function releaseFreeze(acct, p, patch) {
  return {
    ...acct,
    cash: toYuan(toCents(acct.cash) + toCents(p.need || 0)),
    freeze: toYuan(Math.max(0, toCents(acct.freeze || 0) - toCents(p.need || 0))),
    orders: acct.orders.map((o) => o.id === p.id ? { ...o, ...patch } : o)
  };
}
function fillRec(o, { date, px, gross, fee }) {
  return { ...o, status: "filled", settleDate: date, fillPrice: px, gross, fee, amount: o.side === "buy" ? round2(gross + fee) : round2(gross - fee) };
}
function tradeRec(p, { date, px, gross, fee, name }) {
  return {
    id: p.id,
    code: p.code,
    name,
    side: p.side,
    qty: p.qty,
    submitDate: p.submitDate,
    fillDate: date,
    submitPrice: p.submitPrice,
    price: px,
    gross,
    fee,
    slip: p.slip ?? null,
    slipBase: p.slipBase ?? null,
    slipImpact: p.slipImpact ?? null,
    net: p.side === "buy" ? round2(gross + fee) : round2(gross - fee),
    reason: p.reason || "\u624B\u52A8\u4E0B\u5355",
    // 委托价 → 成交价的漂移：T+1 撮合的必然结果，如实展示（真实交易也是这个体验）
    driftPct: p.submitPrice ? +((px - p.submitPrice) / p.submitPrice * 100).toFixed(2) : null
  };
}
var ANN = 252;
function paperMetrics(nav) {
  const n = nav.length;
  if (!n) return null;
  const rets = [];
  for (let i = 1; i < n; i++) rets.push(nav[i] / nav[i - 1] - 1);
  const total = nav[n - 1] / nav[0] - 1;
  const annual = n > 1 ? (1 + total) ** (ANN / (n - 1)) - 1 : 0;
  let peak = nav[0], maxDd = 0;
  for (const v of nav) {
    peak = Math.max(peak, v);
    maxDd = Math.max(maxDd, 1 - v / peak);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) : 0;
  const sharpe = sd > 1e-12 ? mean / sd * Math.sqrt(ANN) : 0;
  const winDays = rets.filter((r) => r > 0).length;
  return {
    days: n,
    total,
    annual,
    maxDd,
    sharpe,
    winRate: rets.length ? winDays / rets.length : 0,
    ddPct: maxDd * 100
  };
}
function exportAccount(acct) {
  return JSON.stringify({
    version: PAPER_VERSION,
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    initCash: acct.initCash,
    cash: acct.cash,
    freeze: acct.freeze || 0,
    realized: acct.realized,
    totalFee: acct.totalFee,
    positions: acct.positions,
    pending: acct.pending || [],
    orders: acct.orders,
    trades: acct.trades,
    // 事件日志必须随档迁移：委托/拦截/止损的时间线是「可核验存档」的一半，
    //   只带账本不带日志，跨设备复盘就断了（orders/trades 都在、偏偏日志丢，口径残缺）
    logs: Array.isArray(acct.logs) ? acct.logs.slice(-MAX_LOGS) : [],
    nav: acct.nav || [],
    startDate: acct.startDate,
    lastSettle: acct.lastSettle
  }, null, 2);
}
function importAccount(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "\u4E0D\u662F\u5408\u6CD5 JSON\uFF1A" + e.message };
  }
  if (!d || typeof d !== "object") return { ok: false, error: "\u9876\u5C42\u4E0D\u662F\u5BF9\u8C61" };
  if (d.version !== PAPER_VERSION) return { ok: false, error: `\u7248\u672C\u4E0D\u5339\u914D\uFF08\u6587\u4EF6 ${d.version || "\u65E0"} / \u5F53\u524D ${PAPER_VERSION}\uFF09` };
  if (!Number.isFinite(+d.cash) || +d.cash < 0) return { ok: false, error: "cash \u975E\u6CD5" };
  if (!Number.isFinite(+d.initCash) || +d.initCash <= 0) return { ok: false, error: "initCash \u975E\u6CD5" };
  const positions = d.positions && typeof d.positions === "object" ? d.positions : {};
  for (const [code, p] of Object.entries(positions)) {
    if (!Number.isInteger(p.qty) || p.qty <= 0) return { ok: false, error: `\u6301\u4ED3 ${code} \u6570\u91CF\u975E\u6CD5` };
    if (!Number.isFinite(+p.avgCost) || +p.avgCost < 0) return { ok: false, error: `\u6301\u4ED3 ${code} \u6210\u672C\u975E\u6CD5` };
    if (!Number.isInteger(p.avail) || p.avail < 0 || p.avail > p.qty) return { ok: false, error: `\u6301\u4ED3 ${code} \u53EF\u5356\u6570\u91CF\u975E\u6CD5` };
  }
  const pending = Array.isArray(d.pending) ? d.pending : [];
  for (const p of pending) {
    if (!Number.isInteger(p.qty) || p.qty <= 0) return { ok: false, error: `\u5F85\u6210\u4EA4\u59D4\u6258 ${p.id} \u6570\u91CF\u975E\u6CD5` };
    if (p.side !== "buy" && p.side !== "sell") return { ok: false, error: `\u5F85\u6210\u4EA4\u59D4\u6258 ${p.id} \u65B9\u5411\u975E\u6CD5` };
  }
  const nav = Array.isArray(d.nav) ? d.nav.filter((r) => r && typeof r.date === "string" && Number.isFinite(+r.equity)) : [];
  const logs = Array.isArray(d.logs) ? d.logs.filter((x) => x && typeof x === "object" && typeof x.text === "string").slice(-MAX_LOGS) : [];
  return {
    ok: true,
    account: {
      ...emptyAccount(+d.initCash, d.startDate || null),
      cash: +d.cash,
      freeze: +d.freeze || 0,
      realized: +d.realized || 0,
      totalFee: +d.totalFee || 0,
      positions,
      pending,
      orders: Array.isArray(d.orders) ? d.orders : [],
      trades: Array.isArray(d.trades) ? d.trades : [],
      logs,
      nav,
      lastSettle: d.lastSettle || null
    }
  };
}
function quotesFromDay(day) {
  const out2 = {};
  for (const h of day?.hot || []) {
    if (h?.code && h.close != null && Number.isFinite(+h.close)) {
      out2[h.code] = { code: h.code, name: h.name || "", price: +h.close, changePct: h.change_pct ?? null, huanshou: h.huanshou ?? null, src: "hot" };
    }
  }
  for (const l of day?.lhb || []) {
    if (l?.code && l.close != null && Number.isFinite(+l.close)) {
      out2[l.code] = { code: l.code, name: l.name || "", price: +l.close, changePct: l.change_pct ?? null, reason: l.reason || "", amount: l.deal_wan != null ? +l.deal_wan * 1e4 : null, huanshou: l.turnover_pct ?? null, freeFloatCap: l.free_float_cap ?? null, src: "lhb" };
    }
  }
  for (const [code, q] of Object.entries(day?.quotes || {})) {
    if (!code || !q || q.price == null || !Number.isFinite(+q.price)) continue;
    out2[code] = {
      code,
      name: q.name || out2[code] && out2[code].name || "",
      price: +q.price,
      changePct: q.changePct ?? null,
      prevClose: q.prevClose ?? null,
      src: q.src || "live"
    };
  }
  return out2;
}

// src/alert_log.js
var LOG_CAP = 400;
var ACTION_DIR = {
  sell: 1,
  clear: 1,
  exit: 1,
  reduce: 1,
  buy: -1,
  add: -1,
  hold: 0,
  wait: 0,
  watch: 0
};
var LOG_CFG = {
  minQty: LOT,
  hitBand: 5e-3
};
var finite5 = (v) => v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(+v);
var yuan2 = (v) => finite5(v) ? Math.round(+v).toLocaleString("en-US") : "\u2014";
var keyOf = (s) => [s.asOf || "?", s.layer || "?", s.code || "_", s.type].join("|");
function appendSignals(log, alerts, ctx = {}) {
  const cur = Array.isArray(log) ? log : [];
  const seen = new Set(cur.map((e) => e.key));
  const out2 = [];
  let added = 0;
  let skipped = 0;
  for (const a of Array.isArray(alerts) ? alerts : []) {
    if (!a || !a.type) {
      skipped++;
      continue;
    }
    const dir = ACTION_DIR[a.action];
    if (dir === void 0) {
      skipped++;
      continue;
    }
    if (dir === 0) {
      skipped++;
      continue;
    }
    if (a.layer === "position" && !a.code) {
      skipped++;
      continue;
    }
    const scoreQty = a.layer === "position" ? Math.floor(finite5(a.heldQty) && a.heldQty > 0 ? +a.heldQty : a.qty > 0 ? a.qty : 0) : 0;
    if (dir !== 0 && scoreQty < LOG_CFG.minQty && a.layer === "position") {
      skipped++;
      continue;
    }
    const asOf = ctx.asOf || null;
    const px = a.layer === "position" ? typeof ctx.priceOf === "function" ? ctx.priceOf(a.code, a) : null : null;
    if (a.layer === "position" && !finite5(px)) {
      skipped++;
      continue;
    }
    const entry = {
      key: keyOf({ asOf, layer: a.layer, code: a.code, type: a.type }),
      asOf,
      layer: a.layer,
      code: a.code || null,
      name: a.name || null,
      type: a.type,
      level: a.level,
      action: a.action,
      dir,
      /** 下单股数（今天能卖多少；T+1 全锁时为 0） */
      qty: a.qty > 0 ? Math.floor(a.qty) : 0,
      /** 计分股数（本应保护多少 = 该票全部持仓），归因按这个算 */
      scoreQty,
      /** 触发时刻的价格基准（归因分母，绝不改写） */
      px: finite5(px) ? +px : null,
      /** 触发时刻该票占总资产比例（大盘层／减仓比例口径共用） */
      conc: finite5(a.conc) ? +a.conc : null,
      /** 触发时刻账户总资产（算「减仓节省的金额」需要） */
      total: finite5(ctx.total) ? +ctx.total : null,
      /** 触发时刻的建议目标仓位（大盘层用：目标 − 当前 = 需要调整的比例） */
      targetPos: finite5(ctx.targetPos) ? +ctx.targetPos : null,
      curPos: finite5(ctx.curPos) ? +ctx.curPos : null,
      text: a.text || "",
      loggedAt: ctx.now || null
    };
    if (seen.has(entry.key)) {
      skipped++;
      continue;
    }
    seen.add(entry.key);
    out2.push(entry);
    added++;
  }
  let merged = [...cur, ...out2];
  if (merged.length > LOG_CAP) merged = trimLog(merged);
  return { log: merged, added, skipped };
}
function trimLog(log) {
  const settled = log.filter((e) => finite5(e.finalPx));
  const pending = log.filter((e) => !finite5(e.finalPx));
  const keep = LOG_CAP - pending.length;
  if (keep <= 0) {
    return [...pending].sort((a, b) => String(b.asOf).localeCompare(String(a.asOf))).slice(0, LOG_CAP);
  }
  const keptSettled = [...settled].sort((a, b) => String(b.asOf).localeCompare(String(a.asOf))).slice(0, keep);
  return [...keptSettled, ...pending];
}
function evaluateEntry(e, finalPx) {
  if (!e) return null;
  const dir = ACTION_DIR[e.action];
  if (!dir) return null;
  const px = finite5(e.px) ? +e.px : null;
  const fx = finite5(finalPx) ? +finalPx : null;
  if (px == null || px <= 0 || fx == null) return null;
  const qty = finite5(e.scoreQty) && e.scoreQty > 0 ? Math.floor(+e.scoreQty) : e.qty > 0 ? Math.floor(e.qty) : 0;
  if (qty < LOG_CFG.minQty) return null;
  const pct2 = fx / px - 1;
  const pnl = dir > 0 ? qty * (px - fx) : qty * (fx - px);
  let verdict;
  if (Math.abs(pct2) <= LOG_CFG.hitBand) verdict = "flat";
  else verdict = (dir > 0 ? pct2 < 0 : pct2 > 0) ? "hit" : "miss";
  return { pct: pct2, pnl, dir, verdict, qty, px, finalPx: fx };
}
function evaluateMarketEntry(e) {
  if (!e) return null;
  const dir = ACTION_DIR[e.action];
  if (!dir) return null;
  const mv = finite5(e.total) && finite5(e.curPos) ? e.total * e.curPos : null;
  const target = finite5(e.total) && finite5(e.targetPos) ? e.total * e.targetPos : null;
  const amount = mv != null && target != null ? Math.abs(mv - target) : null;
  return { pct: null, pnl: null, dir, verdict: "tracked", amount };
}
function summarizeLog(log, priceMap, opts = {}) {
  const entries = Array.isArray(log) ? log : [];
  const getPx = typeof opts.priceOf === "function" ? opts.priceOf : (code) => priceMap && code != null ? priceMap[code] : null;
  const byType = /* @__PURE__ */ new Map();
  let avoidedLoss = 0, missedGain = 0, net = 0;
  let hit = 0, miss = 0, flat = 0, pending = 0, tracked = 0;
  const details = [];
  for (const e of entries) {
    const isMarket = e.layer === "market";
    const r = isMarket ? evaluateMarketEntry(e) : evaluateEntry(e, getPx(e.code));
    const t = byType.get(e.type) || { type: e.type, action: e.action, count: 0, net: 0, hit: 0, miss: 0, pending: 0 };
    t.count++;
    if (r && r.verdict === "tracked") {
      tracked++;
      t.pending++;
    } else if (!r) {
      pending++;
      t.pending++;
    } else {
      net += r.pnl;
      if (r.pnl > 0) avoidedLoss += r.pnl;
      else if (r.pnl < 0) missedGain += -r.pnl;
      if (r.verdict === "hit") {
        hit++;
        t.hit++;
      } else if (r.verdict === "miss") {
        miss++;
        t.miss++;
      } else flat++;
      t.net += r.pnl;
    }
    byType.set(e.type, t);
    details.push({ ...e, result: r });
  }
  const judged = hit + miss;
  return {
    n: entries.length,
    net,
    avoidedLoss,
    missedGain,
    hit,
    miss,
    flat,
    pending,
    tracked,
    hitRate: judged > 0 ? hit / judged : null,
    byType: [...byType.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.count - a.count),
    details
  };
}
function summarizeText(s) {
  if (!s || !s.n) return "\u5C1A\u65E0\u9884\u8B66\u8BB0\u5F55\u2014\u2014\u9884\u8B66\u89E6\u53D1\u540E\u4F1A\u9010\u6761\u8BB0\u8D26\uFF0C\u7528\u540E\u7EED\u771F\u5B9E\u4EF7\u683C\u8BA1\u5206\u3002";
  const parts = [];
  if (s.avoidedLoss > 0) parts.push(`\u5DF2\u89C4\u907F\u4E8F\u635F\u7EA6 ${yuan2(s.avoidedLoss)} \u5143`);
  if (s.missedGain > 0) parts.push(`\u9519\u6740/\u9519\u8FC7\u7684\u673A\u4F1A\u7EA6 ${yuan2(s.missedGain)} \u5143`);
  if (!parts.length) parts.push("\u6682\u65E0\u53EF\u7ED3\u7B97\u7684\u76C8\u4E8F");
  const netTxt = `\u51C0\u8D21\u732E ${s.net >= 0 ? "+" : "\u2212"}${yuan2(Math.abs(s.net))} \u5143`;
  const rateTxt = s.hitRate == null ? "\u547D\u4E2D\u7387\u5F85\u79EF\u7D2F" : `\u547D\u4E2D\u7387 ${(s.hitRate * 100).toFixed(0)}%\uFF08${s.hit} \u5BF9 / ${s.miss} \u9519\uFF09`;
  const pendTxt = s.pending + s.tracked > 0 ? `\uFF0C\u53E6\u6709 ${s.pending + s.tracked} \u6761\u5F85\u4EF7\u683C\u9A8C\u8BC1` : "";
  return `${parts.join("\uFF0C")}\uFF1B${netTxt}\uFF0C${rateTxt}${pendTxt}\u3002`;
}

// src/paper_review.js
var REVIEW_CFG = {
  minTradesForWinRate: 3,
  minTradeForEdge: 2e-3,
  concWarnRatio: 0.8,
  feeDragWarn: 0.01,
  lossStreakWarn: 3,
  staleWinRateFloor: 0.4,
  disciplineFloor: 0.6
};
var ADVICE_LEVELS = ["risk", "opp", "tip"];
var REVIEW_VERSION = "paper-review-v1";
var REVIEW_TITLE = "\u6A21\u62DF\u4EA4\u6613\u590D\u76D8";
var finite6 = (v) => v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(+v);
var yuan3 = (v) => finite6(v) ? Math.round(+v).toLocaleString("en-US") : "\u2014";
var syuan = (v) => finite6(v) ? (v >= 0 ? "+" : "\u2212") + yuan3(Math.abs(v)) : "\u2014";
var pp2 = (v, d = 1) => finite6(v) ? `${(+v * 100).toFixed(d)}%` : "\u2014";
var sp2 = (v, d = 1) => finite6(v) ? `${+v > 0 ? "+" : ""}${(+v * 100).toFixed(d)}%` : "\u2014";
var r23 = (v) => Math.round((+v || 0) * 100) / 100;
function reviewAccount(account, stats) {
  const acct = account || {};
  const st = stats || {};
  const initCash = finite6(st.initCash) ? +st.initCash : finite6(acct.initCash) ? +acct.initCash : 0;
  const total = finite6(st.total) ? +st.total : 0;
  const floatPnl = finite6(st.floatPnl) ? +st.floatPnl : 0;
  const floatPnlPct = finite6(st.floatPnlPct) ? +st.floatPnlPct : 0;
  const realized = finite6(st.realized) ? +st.realized : 0;
  const totalFee = finite6(st.totalFee) ? +st.totalFee : 0;
  const netPnl = initCash > 0 ? total - initCash : 0;
  const retPct = initCash > 0 ? netPnl / initCash : null;
  const explained = floatPnl + realized - totalFee;
  const residual = r23(netPnl - explained);
  const feeDrag = initCash > 0 ? totalFee / initCash : null;
  const items = [
    { key: "float", label: "\u6301\u4ED3\u6D6E\u52A8\u76C8\u4E8F", value: floatPnl, note: "\u5C1A\u672A\u5356\u51FA\u7684\u6301\u4ED3\u6309\u6700\u65B0\u771F\u5B9E\u4EF7\u91CD\u4F30" },
    { key: "realized", label: "\u5DF2\u5B9E\u73B0\u76C8\u4E8F", value: realized, note: "\u51CF\u4ED3/\u6E05\u4ED3\u7ED3\u8F6C\uFF0C\u542B\u4E70\u5165\u6210\u672C\u5206\u644A" },
    { key: "fee", label: "\u4EA4\u6613\u8D39\u7528\u62D6\u7D2F", value: -totalFee, note: "\u4F63\u91D1 + \u8FC7\u6237\u8D39 + \u5370\u82B1\u7A0E\uFF1B\u786E\u5B9A\u6027\u7684\u8D1F\u6536\u76CA" }
  ];
  const dominant = items.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0] || null;
  return {
    initCash,
    total,
    netPnl,
    retPct,
    floatPnl,
    floatPnlPct,
    realized,
    totalFee,
    feeDrag,
    residual,
    items,
    dominant,
    /** 是否已开始交易（有持仓或有成交或已实现非零）—— 报告据此决定是否如实降级 */
    started: Object.keys(acct.positions || {}).length > 0 || (acct.trades || []).length > 0 || Math.abs(realized) > 1e-9,
    /**
     * 收益方向定性。**用「净盈亏」而不是「收益率」判**：初始本金 100 万，
     * 赚 3000 元收益率只有 0.3%，但它确实是赚了，不该被说成「基本持平」。
     * 阈值取 1 元，只为吸收浮点误差。
     */
    direction: netPnl > 1 ? "gain" : netPnl < -1 ? "loss" : "flat"
  };
}
var orphanSell = 0;
var partialSell = 0;
function reviewTrades(trades, opts = {}) {
  orphanSell = 0;
  partialSell = 0;
  const list = (Array.isArray(trades) ? trades : []).filter((t) => t && Number.isFinite(+t.qty) && +t.qty > 0 && Number.isFinite(+t.price) && +t.price > 0).map((t, i) => ({ ...t, _i: i })).sort((a, b) => String(a.fillDate || a.submitDate || "").localeCompare(String(b.fillDate || b.submitDate || "")) || a._i - b._i);
  const initCash = finite6(opts.initCash) && +opts.initCash > 0 ? +opts.initCash : 0;
  const minEdge = initCash > 0 ? REVIEW_CFG.minTradeForEdge * initCash : 0;
  const open = /* @__PURE__ */ new Map();
  const closed = [];
  for (const t of list) {
    const code = String(t.code || "");
    const qty = Math.floor(+t.qty);
    const gross = finite6(t.gross) ? +t.gross : +t.price * qty;
    const fee = finite6(t.fee) ? +t.fee : 0;
    if (t.side === "buy") {
      const pxPerShare = qty > 0 ? (gross + fee) / qty : 0;
      const q2 = open.get(code) || [];
      q2.push({ qty, pxPerShare, date: t.fillDate || t.submitDate || null });
      open.set(code, q2);
      continue;
    }
    if (t.side !== "sell") continue;
    let remain = qty;
    const q = open.get(code) || [];
    let costOut = 0;
    let buyDate = null;
    while (remain > 0 && q.length) {
      const lot = q[0];
      if (buyDate == null) buyDate = lot.date || null;
      const take = Math.min(remain, lot.qty);
      costOut += take * lot.pxPerShare;
      lot.qty -= take;
      remain -= take;
      if (lot.qty <= 0) q.shift();
    }
    if (remain > 0 && remain === qty) {
      orphanSell++;
      continue;
    }
    if (remain > 0) {
      partialSell++;
      costOut += 0;
    }
    const netIn = gross - fee;
    const pnl = netIn - costOut;
    const basis = costOut > 0 ? costOut : 0;
    const sellDate = t.fillDate || t.submitDate || null;
    closed.push({
      code,
      name: t.name || code,
      qty,
      date: sellDate,
      sellPx: +t.price,
      costPx: qty > 0 ? costOut / qty : null,
      pnl: r23(pnl),
      pct: basis > 0 ? pnl / basis : null,
      fee: r23(fee),
      // 持仓天数（成交口径）= 卖出成交日 − 买入成交日；用于 1/3/5 日胜率分桶
      holdDays: buyDate && sellDate ? Math.max(0, Math.round((new Date(sellDate) - new Date(buyDate)) / 864e5)) : null,
      reason: t.reason || null
    });
  }
  const wins = closed.filter((c) => c.pnl > 0);
  const losses = closed.filter((c) => c.pnl < 0);
  const flats = closed.filter((c) => c.pnl === 0);
  const judged = wins.length + losses.length;
  const sumWin = wins.reduce((a, c) => a + c.pnl, 0);
  const sumLoss = losses.reduce((a, c) => a + c.pnl, 0);
  const avgWin = wins.length ? sumWin / wins.length : null;
  const avgLoss = losses.length ? sumLoss / losses.length : null;
  const plRatio = avgWin != null && avgLoss != null && avgLoss < 0 ? avgWin / Math.abs(avgLoss) : null;
  const profitFactor = sumWin > 0 && sumLoss < 0 ? sumWin / Math.abs(sumLoss) : null;
  let streak = 0, maxLossStreak = 0;
  for (const c of closed) {
    if (c.pnl < 0) {
      streak++;
      maxLossStreak = Math.max(maxLossStreak, streak);
    } else if (c.pnl > 0) streak = 0;
  }
  const byPnl = closed.slice().sort((a, b) => b.pnl - a.pnl);
  const best = byPnl[0] || null;
  const worst = byPnl[byPnl.length - 1] || null;
  const bucket = (maxHold) => {
    const sub = closed.filter((c) => c.holdDays != null && c.holdDays <= maxHold);
    const judged2 = sub.filter((c) => c.pnl > 0).length + sub.filter((c) => c.pnl < 0).length;
    return {
      n: sub.length,
      winRate: judged2 > 0 ? sub.filter((c) => c.pnl > 0).length / judged2 : null
    };
  };
  const byHold = { d1: bucket(1), d3: bucket(3), d5: bucket(5) };
  const edges = minEdge > 0 ? closed.filter((c) => Math.abs(c.pnl) >= minEdge) : closed;
  return {
    nTrades: list.length,
    closed,
    closedCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    flats: flats.length,
    judged,
    winRate: judged > 0 ? wins.length / judged : null,
    samplesEnough: judged >= REVIEW_CFG.minTradesForWinRate,
    avgWin: avgWin != null ? r23(avgWin) : null,
    avgLoss: avgLoss != null ? r23(avgLoss) : null,
    plRatio: plRatio != null ? r23(plRatio) : null,
    profitFactor: profitFactor != null ? r23(profitFactor) : null,
    sumWin: r23(sumWin),
    sumLoss: r23(sumLoss),
    best,
    worst,
    maxLossStreak,
    edges,
    // 1/3/5 日持仓胜率（用户 P2 要求）：持有 ≤N 日的平仓胜率，样本不足为 null
    byHold,
    orphanSell: orphanSell || 0,
    partialSell: partialSell || 0
  };
}
function reviewPositions(positions, stats, tier) {
  const pos = positions && typeof positions === "object" ? positions : {};
  const st = stats || {};
  const T = finite6(st.total) && +st.total > 0 ? +st.total : 0;
  const rows = [];
  for (const [code, p] of Object.entries(pos)) {
    if (!p || !(p.qty > 0)) continue;
    const qty = +p.qty;
    const last = finite6(p.last) ? +p.last : null;
    const cost = finite6(p.cost) ? +p.cost : finite6(p.avgCost) ? +p.avgCost * qty : 0;
    const mv = last != null ? last * qty : cost;
    const pnl = mv - cost;
    const pnlPct = cost > 0 ? pnl / cost : null;
    const conc = T > 0 ? mv / T : null;
    rows.push({
      code,
      name: p.name || code,
      qty,
      last,
      avgCost: finite6(p.avgCost) ? +p.avgCost : null,
      cost: r23(cost),
      mv: r23(mv),
      pnl: r23(pnl),
      pnlPct,
      conc,
      pxStale: !!p.pxStale,
      days: finite6(p.days) ? +p.days : null
    });
  }
  rows.sort((a, b) => b.pnl - a.pnl);
  const totalMv = rows.reduce((a, r) => a + r.mv, 0);
  const totalPnl = rows.reduce((a, r) => a + r.pnl, 0);
  const warnLine = POS_CFG.concMax * REVIEW_CFG.concWarnRatio;
  const overConc = rows.filter((r) => r.conc != null && r.conc > POS_CFG.concMax);
  const heavy = rows.filter((r) => r.conc != null && r.conc > warnLine && r.conc <= POS_CFG.concMax);
  const targetPos = tier ? tier.pos : null;
  const curPos = T > 0 ? totalMv / T : null;
  const tierGap = targetPos != null && curPos != null ? curPos - targetPos : null;
  let tierVerdict = null;
  if (tierGap != null) {
    if (tierGap > MARKET_CFG.band) tierVerdict = "over";
    else if (tierGap < -MARKET_CFG.band) tierVerdict = "under";
    else tierVerdict = "fit";
  }
  return {
    rows,
    posCount: rows.length,
    totalMv: r23(totalMv),
    totalPnl: r23(totalPnl),
    contributors: rows.filter((r) => r.pnl > 0),
    drags: rows.filter((r) => r.pnl < 0),
    overConc,
    heavy,
    cashRatio: T > 0 ? finite6(st.cash) ? +st.cash / T : null : null,
    targetPos,
    curPos,
    tierGap,
    tierVerdict
  };
}
function buildAdvice(ctx = {}) {
  const out2 = [];
  const { stats, accountReview: ar, tradeReview: tr, posReview: pr, tier } = ctx;
  const st = stats || {};
  const initCash = ar && ar.initCash ? ar.initCash : 0;
  for (const row of pr?.rows || []) {
    if (row.pnlPct == null) continue;
    if (row.pnlPct <= POS_CFG.stopLoss) {
      out2.push({
        level: "risk",
        rule: "A1",
        action: "sell",
        code: row.code,
        title: `${row.name}\uFF08${row.code}\uFF09\u51FB\u7A7F\u6B62\u635F\u7EBF\u4ECD\u6301\u6709`,
        text: `\u6D6E\u4E8F ${sp2(row.pnlPct)} \u5DF2\u4F4E\u4E8E\u6B62\u635F\u7EBF ${sp2(POS_CFG.stopLoss)}\uFF0C\u5C5E\u4E8E\u7EAA\u5F8B\u672A\u6267\u884C\uFF1A\u6B62\u635F\u7684\u610F\u4E49\u662F\u5728\u5C0F\u4E8F\u65F6\u79BB\u573A\uFF0C\u800C\u4E0D\u662F\u7B49\u5B83\u53D8\u6210\u5927\u4E8F\u3002`,
        why: `\u6B62\u635F\u7EBF ${sp2(POS_CFG.stopLoss)} \u4E0E V5.2 \u56DE\u6D4B\u5F15\u64CE\u540C\u6E90\uFF08src/config.js backtest.stopLoss\uFF09\u3002\u5F53\u524D\u6D6E\u4E8F = \uFF08\u6700\u65B0\u4EF7 ${row.last != null ? row.last.toFixed(2) : "\u2014"} \u2212 \u5747\u4EF7 ${row.avgCost != null ? row.avgCost.toFixed(3) : "\u2014"}\uFF09\xF7 \u5747\u4EF7 = ${sp2(row.pnlPct)}\u3002`
      });
    }
  }
  for (const row of pr?.overConc || []) {
    const targetMV = (finite6(st.total) ? +st.total : 0) * POS_CFG.concMax;
    const cutQtyRaw = row.last && row.last > 0 ? Math.floor((row.mv - targetMV) / row.last / LOT) * LOT : 0;
    out2.push({
      level: "risk",
      rule: "A2",
      action: "reduce",
      code: row.code,
      qty: Math.max(0, cutQtyRaw),
      title: `${row.name}\uFF08${row.code}\uFF09\u5355\u7968\u8D85\u914D`,
      text: `\u5360\u603B\u8D44\u4EA7 ${pp2(row.conc)}\uFF0C\u8D85\u8FC7\u5355\u7968\u4E0A\u9650 ${pp2(POS_CFG.concMax)}${cutQtyRaw > 0 ? `\uFF0C\u5EFA\u8BAE\u51CF ${cutQtyRaw} \u80A1\u81F3\u4E0A\u9650\u9644\u8FD1` : "\uFF08\u5F53\u524D\u6301\u4ED3\u4E0D\u8DB3\u4E00\u624B\u53EF\u51CF\uFF0C\u9700\u6574\u4F53\u8BC4\u4F30\uFF09"}\u3002`,
      why: `\u5355\u7968\u4E0A\u9650 ${pp2(POS_CFG.concMax)} \u4E0E\u300C\u7814\u5224\u63A8\u8350\u300D\u7684\u4E2A\u80A1\u5EFA\u8BAE\u4ED3\u4F4D\u4E0A\u9650\uFF08picks.suggestWeight \u7684 perStockCap\uFF09\u4E00\u81F4\u3002\u8D26\u6237\u6536\u76CA\u88AB\u4E00\u53EA\u7968\u4E3B\u5BFC = \u653E\u5F03\u5206\u6563\u5316\uFF0C\u6CE2\u52A8\u4F1A\u663E\u8457\u653E\u5927\u800C\u671F\u671B\u6536\u76CA\u4E0D\u53D8\u3002`
    });
  }
  if (tr && tr.maxLossStreak >= REVIEW_CFG.lossStreakWarn) {
    out2.push({
      level: "risk",
      rule: "A3",
      action: "hold",
      title: `\u51FA\u73B0 ${tr.maxLossStreak} \u7B14\u8FDE\u7EED\u4E8F\u635F`,
      text: `\u8FDE\u7EED\u4E8F\u635F\u8FBE\u5230 ${tr.maxLossStreak} \u7B14\uFF08\u9608\u503C ${REVIEW_CFG.lossStreakWarn} \u7B14\uFF09\uFF0C\u5EFA\u8BAE\u6682\u505C\u5F00\u65B0\u4ED3\u3001\u5148\u590D\u76D8\u8FD9 ${tr.maxLossStreak} \u7B14\u7684\u4E70\u5165\u7406\u7531\u662F\u5426\u6210\u7ACB\u3002`,
      why: `\u8FDE\u7EED\u4E8F\u635F\u901A\u5E38\u610F\u5473\u7740\u300C\u5F53\u671F\u9009\u80A1\u903B\u8F91\u4E0E\u5E02\u573A\u98CE\u683C\u4E0D\u5339\u914D\u300D\uFF0C\u800C\u4E0D\u662F\u8FD0\u6C14\u5DEE\u3002\u6B64\u65F6\u7EE7\u7EED\u52A0\u4ED3\u6216\u644A\u5E73\u6210\u672C\uFF0C\u4F1A\u628A\u5355\u4E00\u98CE\u683C\u7684\u9519\u8BEF\u653E\u5927\u2014\u2014\u505C\u624B\u4E00\u5929\u7684\u6210\u672C\u8FDC\u4F4E\u4E8E\u7EE7\u7EED\u505A\u9519\u7684\u6210\u672C\u3002`
    });
  }
  if (ar && finite6(ar.feeDrag) && ar.feeDrag >= REVIEW_CFG.feeDragWarn) {
    const feePct = ar.feeDrag;
    out2.push({
      level: "tip",
      rule: "A4",
      action: "hold",
      title: "\u4EA4\u6613\u8D39\u7528\u4FB5\u8680\u6536\u76CA",
      text: `\u7D2F\u8BA1\u8D39\u7528 ${yuan3(ar.totalFee)} \u5143\uFF0C\u5360\u521D\u59CB\u672C\u91D1 ${pp2(feePct)}\uFF08\u76F8\u5F53\u4E8E ${pp2(feePct, 2)} \u7684\u786E\u5B9A\u6027\u4E8F\u635F\uFF09\u3002\u964D\u4F4E\u6362\u624B\u662F\u552F\u4E00\u80FD\u7ACB\u523B\u6539\u5584\u7684\u65B9\u6CD5\u3002`,
      why: `\u8D39\u7528\u662F**\u786E\u5B9A\u6027**\u7684\u8D1F\u6536\u76CA\uFF0C\u4E0E\u884C\u60C5\u65E0\u5173\uFF1A\u4F63\u91D1\u4E073\uFF08\u6700\u4F4E5\u5143\uFF09+ \u8FC7\u6237\u8D39\u4E070.1 + \u5370\u82B1\u7A0E\u4E075\uFF08\u4EC5\u5356\u51FA\uFF09\u3002\u9891\u7E41\u8FDB\u51FA\u4F1A\u8BA9\u300C\u624B\u7EED\u8D39 + \u6ED1\u70B9\u300D\u5403\u6389\u672C\u5C31\u4E0D\u539A\u7684\u4EF7\u5DEE\uFF1B\u540C\u6837\u7684\u7B56\u7565\uFF0C\u6362\u624B\u51CF\u534A \u2248 \u6536\u76CA\u76F4\u63A5\u6539\u5584\u3002`
    });
  }
  if (tr && tr.samplesEnough && tr.winRate != null && tr.winRate < REVIEW_CFG.staleWinRateFloor) {
    out2.push({
      level: "risk",
      rule: "A5",
      action: "hold",
      title: `\u5E73\u4ED3\u80DC\u7387 ${pp2(tr.winRate, 0)} \u504F\u4F4E`,
      text: `${tr.judged} \u7B14\u5E73\u4ED3\u4E2D\u4EC5 ${tr.wins} \u7B14\u76C8\u5229\uFF0C\u80DC\u7387 ${pp2(tr.winRate, 0)}\uFF08\u4F4E\u4E8E ${pp2(REVIEW_CFG.staleWinRateFloor, 0)}\uFF09\u3002${tr.plRatio != null ? `\u5E73\u5747\u76C8\u5229 ${yuan3(tr.avgWin)} \u5143 / \u5E73\u5747\u4E8F\u635F ${yuan3(Math.abs(tr.avgLoss))} \u5143\uFF08\u76C8\u4E8F\u6BD4 ${tr.plRatio}\uFF09\u3002` : ""}`,
      why: `\u80DC\u7387\u4F4E\u4E0D\u5FC5\u7136\u4E8F\u94B1\uFF08\u9AD8\u76C8\u4E8F\u6BD4\u53EF\u4EE5\u8986\u76D6\uFF09\uFF0C\u4F46\u524D\u63D0\u662F\u76C8\u4E8F\u6BD4 > 1\u3002` + (tr.plRatio != null ? `\u5F53\u524D\u76C8\u4E8F\u6BD4 ${tr.plRatio}\u2014\u2014\u82E5\u5B83\u540C\u65F6 < 1\uFF0C\u8BF4\u660E\u662F\u300C\u4E8F\u5F97\u6BD4\u8D5A\u5F97\u591A\u3001\u8FD8\u8D5A\u5F97\u5C11\u300D\uFF0C\u5FC5\u987B\u6539\u9009\u80A1\u6216\u6539\u6B62\u635F\uFF0C\u800C\u4E0D\u662F\u52A0\u5927\u4ED3\u4F4D\u3002` : `\u5F53\u524D\u5C1A\u65E0\u76C8\u5229\u6837\u672C\uFF08\u5E73\u4ED3\u5168\u662F\u4E8F\u635F\uFF09\uFF0C\u76C8\u4E8F\u6BD4\u65E0\u4ECE\u8BA1\u7B97\u2014\u2014\u5FC5\u987B\u5148\u89E3\u51B3\u300C\u4E3A\u4EC0\u4E48\u4F1A\u4E8F\u300D\uFF0C\u518D\u8C08\u4ED3\u4F4D\u3002`)
    });
  }
  if (pr && pr.tierVerdict && tier) {
    if (pr.tierVerdict === "over") {
      const cutMV = (finite6(st.total) ? +st.total : 0) * Math.max(0, (pr.curPos || 0) - tier.pos);
      out2.push({
        level: "risk",
        rule: "A6",
        action: "reduce",
        title: `\u4ED3\u4F4D\u8D85\u914D\uFF1A\u5B9E\u9645 ${pp2(pr.curPos)} vs \u6863\u4F4D\u5EFA\u8BAE ${pp2(tier.pos, 0)}`,
        text: `\u5E02\u573A\u6863\u4F4D\u300C${tier.label}\u300D\u5EFA\u8BAE\u603B\u4ED3\u4F4D ${pp2(tier.pos, 0)}\uFF0C\u5F53\u524D ${pp2(pr.curPos)}\uFF0C\u8D85\u51FA ${pp2(pr.tierGap)}\uFF08\u7EA6 ${yuan3(cutMV)} \u5143\uFF09\uFF0C\u5E94\u964D\u56DE\u5EFA\u8BAE\u4ED3\u4F4D\u3002`,
        why: `\u6863\u4F4D\u7531\u4E03\u56E0\u5B50\u60C5\u7EEA\u5206\u6309 \u2265${TIER_THRESHOLDS.overheat} \u8FC7\u70ED / \u2265${TIER_THRESHOLDS.full} \u6EE1\u4ED3 / ${TIER_THRESHOLDS.half}~${TIER_THRESHOLDS.full} \u534A\u4ED3 / \u2264${TIER_THRESHOLDS.half} \u6E05\u4ED3\u5212\u6863\uFF0C\u4E0E\u7814\u5224\u62A5\u544A\u3001\u56DE\u6D4B\u5F15\u64CE\u540C\u4E00\u9608\u503C\u8868\u3002\u504F\u79BB\u8D85\u8FC7\u5BB9\u5FCD\u5E26 ${pp2(MARKET_CFG.band, 0)} \u5373\u4E3A\u300C\u4E0E\u7CFB\u7EDF\u7ED3\u8BBA\u4E0D\u4E00\u81F4\u300D\u3002`
      });
    } else if (pr.tierVerdict === "under") {
      out2.push({
        level: tier.allowNew ? "opp" : "tip",
        rule: "A6",
        action: tier.allowNew ? "add" : "hold",
        title: `\u4ED3\u4F4D\u4F4E\u4E8E\u6863\u4F4D\u5EFA\u8BAE\uFF1A\u5B9E\u9645 ${pp2(pr.curPos)} vs ${pp2(tier.pos, 0)}`,
        text: `\u5F53\u524D\u4ED3\u4F4D ${pp2(pr.curPos)} \u4F4E\u4E8E\u6863\u4F4D\u5EFA\u8BAE ${pp2(tier.pos, 0)}${tier.allowNew ? "\uFF0C\u6863\u4F4D\u5141\u8BB8\u65B0\u5EFA\uFF0C\u53EF\u62E9\u673A\u8865\u8DB3\uFF08\u6807\u7684\u89C1\u300C\u7814\u5224\u63A8\u8350\u300D\uFF09" : "\uFF0C\u4F46\u5F53\u524D\u6863\u4F4D\u4E0D\u5141\u8BB8\u65B0\u5EFA\u4ED3\uFF0C\u4FDD\u6301\u5373\u53EF"}\u3002`,
        why: `\u6863\u4F4D\u4E3A\u300C${tier.label}\u300D\u3002${tier.allowNew ? "\u60C5\u7EEA\u5206\u5904\u4E8E\u5141\u8BB8\u5EFA\u4ED3\u533A\u95F4\uFF0C\u957F\u671F\u4F4E\u914D\u4F1A\u9519\u8FC7\u6863\u4F4D\u672C\u8EAB\u60F3\u6355\u83B7\u7684\u6536\u76CA\u3002" : "\u8BE5\u6863\u4F4D\u7684\u7EAA\u5F8B\u662F\u300C\u53EA\u51CF\u4ED3\u4E0D\u65B0\u5EFA\u300D\uFF0C\u6B64\u65F6\u7F3A\u53E3\u4E0D\u662F\u8981\u8865\uFF0C\u800C\u662F\u8981\u63A5\u53D7\u3002"}`
      });
    }
  }
  if (tr && tr.avgWin != null && tr.avgLoss != null && tr.avgWin < Math.abs(tr.avgLoss) && tr.judged >= 2) {
    out2.push({
      level: "tip",
      rule: "A7",
      action: "hold",
      title: "\u5E73\u5747\u4E8F\u635F\u5927\u4E8E\u5E73\u5747\u76C8\u5229",
      text: `\u5E73\u5747\u76C8\u5229 ${yuan3(tr.avgWin)} \u5143 < \u5E73\u5747\u4E8F\u635F ${yuan3(Math.abs(tr.avgLoss))} \u5143\uFF0C\u5373\u300C\u8D5A\u7684\u65F6\u5019\u8D5A\u5F97\u5C11\u3001\u4E8F\u7684\u65F6\u5019\u4E8F\u5F97\u591A\u300D\u3002`,
      why: `\u8FD9\u662F\u300C\u622A\u65AD\u5229\u6DA6\u3001\u653E\u4EFB\u4E8F\u635F\u300D\u7684\u5178\u578B\u7279\u5F81\uFF1A\u76C8\u5229\u5355\u8FC7\u65E9\u6B62\u76C8\uFF0C\u4E8F\u635F\u5355\u4E00\u76F4\u7B49\u56DE\u672C\u3002\u4FEE\u6B63\u65B9\u5411\u662F\u4E25\u683C\u6267\u884C\u6B62\u635F\u7EBF ${sp2(POS_CFG.stopLoss)}\uFF08\u5148\u780D\u6389\u5927\u4E8F\uFF09\uFF0C\u5E76\u7ED9\u76C8\u5229\u5355\u7559\u51FA\u7A7A\u95F4\uFF08\u800C\u4E0D\u662F\u4E00\u89C1\u7EA2\u5C31\u5356\uFF09\u3002`
    });
  }
  if (ctx.log && ctx.log.length) {
    const sum = summarizeLog(ctx.log, ctx.priceMap || null);
    const pend = (sum.pending || 0) + (sum.tracked || 0);
    if (sum.hitRate != null && sum.hitRate < 0.5 && sum.hit + sum.miss >= REVIEW_CFG.minTradesForWinRate) {
      out2.push({
        level: "tip",
        rule: "A8",
        action: "hold",
        title: `\u4EA4\u6613\u9884\u8B66\u547D\u4E2D\u7387 ${pp2(sum.hitRate, 0)}`,
        text: `\u53F0\u8D26\u4E2D\u5DF2\u7ED3\u7B97\u7684 ${sum.hit + sum.miss} \u6761\u9884\u8B66\u91CC\u547D\u4E2D ${sum.hit} \u6761\uFF0C\u51C0\u8D21\u732E ${syuan(sum.net)} \u5143\u3002\u547D\u4E2D\u7387\u504F\u4F4E\u8BF4\u660E\u5F53\u671F\u89C4\u5219\u4E0E\u5E02\u573A\u4E0D\u5339\u914D\uFF0C\u5E94\u7F29\u5C0F\u4ED3\u4F4D\u800C\u975E\u52A0\u5927\u3002`,
        why: `\u9884\u8B66\u547D\u4E2D\u7387 = \u65B9\u5411\u88AB\u540E\u7EED\u4EF7\u683C\u9A8C\u8BC1\u7684\u6BD4\u4F8B\uFF08\u4E0D\u542B\u300C\u5E73\u300D\u4E0E\u300C\u672A\u7ED3\u7B97\u300D\uFF09\u3002\u5B83\u662F\u9884\u8B66\u7CFB\u7EDF\u7684**\u8BA1\u5206\u677F**\uFF1A\u547D\u4E2D\u7387\u6301\u7EED\u4F4E\u4E8E 50% \u65F6\u5E94\u964D\u4F4E\u4F9D\u8D56\uFF0C\u800C\u4E0D\u662F\u65E0\u89C6\u3002`
      });
    }
    if (pend > 0 && sum.n > 0 && pend === sum.n) {
      out2.push({
        level: "tip",
        rule: "A8b",
        action: "hold",
        title: "\u9884\u8B66\u5C1A\u65E0\u4E00\u6761\u88AB\u4EF7\u683C\u9A8C\u8BC1",
        text: `\u53F0\u8D26 ${sum.n} \u6761\u9884\u8B66\u5168\u90E8\u5F85\u4EF7\u683C\u9A8C\u8BC1\uFF08\u672A\u7ED3\u7B97 ${pend} \u6761\uFF09\uFF0C\u6682\u65E0\u6CD5\u7ED9\u51FA\u547D\u4E2D\u7387\u3002`,
        why: `\u9884\u8B66\u5F52\u56E0\u9700\u8981\u300C\u89E6\u53D1\u65E5\u4EF7\u683C \u2192 \u4E4B\u540E\u4EF7\u683C\u300D\u7684\u65F6\u95F4\u6C89\u6DC0\u3002\u53EA\u6709\u4E00\u6761\u9884\u8B66\u65F6\u4E0D\u7ED9\u547D\u4E2D\u7387\uFF0C\u662F\u907F\u514D\u7528\u5355\u6B21\u7ED3\u679C\u5192\u5145\u7EDF\u8BA1\u7ED3\u8BBA\u3002`
      });
    }
  }
  if (pr && pr.rows && pr.rows.length) {
    const neverCut = pr.rows.filter((r) => r.pnl > 0 && r.pnlPct != null && r.pnlPct > 0.1);
    if (neverCut.length && (tr ? tr.closedCount : 0) === 0) {
      out2.push({
        level: "tip",
        rule: "A9",
        action: "hold",
        title: "\u5C1A\u65E0\u4EFB\u4F55\u5E73\u4ED3\u8BB0\u5F55\uFF0C\u6D6E\u76C8\u672A\u843D\u888B",
        text: `${neverCut.map((r) => r.name).join("\u3001")} \u5DF2\u6709\u6D6E\u76C8\u4F46\u4ECE\u672A\u51CF\u4ED3\uFF0C\u8D26\u9762\u5229\u6DA6\u968F\u65F6\u53EF\u80FD\u56DE\u5410\u3002`,
        why: `\u6D6E\u52A8\u76C8\u4E8F\u4E0D\u662F\u5DF2\u5B9E\u73B0\u6536\u76CA\u2014\u2014\u5B83\u968F\u4EF7\u683C\u6CE2\u52A8\uFF0C\u672A\u5356\u51FA\u524D\u90FD\u53EF\u80FD\u5F52\u96F6\u3002\u5BF9\u6709\u660E\u663E\u6D6E\u76C8\u7684\u4ED3\u4F4D\uFF0C\u6309\u6863\u4F4D\u51CF\u4E00\u90E8\u5206\u662F\u300C\u628A\u4E0D\u786E\u5B9A\u7684\u8D26\u9762\u5229\u6DA6\u6362\u6210\u786E\u5B9A\u7684\u73B0\u91D1\u300D\uFF0C\u4EE3\u4EF7\u53EA\u662F\u53EF\u80FD\u5C11\u8D5A\u540E\u7EED\u6DA8\u5E45\uFF0C\u4F46\u907F\u514D\u4E86\u300C\u5750\u7535\u68AF\u300D\u56DE\u53BB\u3002`
      });
    }
  }
  const lv = (l) => ADVICE_LEVELS.indexOf(l);
  return out2.sort((a, b) => lv(a.level) - lv(b.level) || String(a.rule).localeCompare(String(b.rule)));
}
function buildPaperReview({ account, stats, log, priceMap, emotionScore, asOf } = {}) {
  const acct = account && typeof account === "object" ? account : null;
  const hasAccount = !!acct;
  const st = stats || (acct ? liteStats(acct) : { total: 0, marketValue: 0, cash: 0, initCash: 0, realized: 0, totalFee: 0, floatPnl: 0 });
  const tier = marketTier(emotionScore);
  const accountReview = reviewAccount(acct || {}, st);
  orphanSell = 0;
  partialSell = 0;
  const tradeReview = reviewTrades(acct?.trades, { initCash: accountReview.initCash });
  const posReview = reviewPositions(acct?.positions, st, tier);
  const attribution = Array.isArray(log) && log.length ? summarizeLog(log, priceMap || null) : null;
  const metrics = acct && Array.isArray(acct.nav) && acct.nav.length > 1 ? { days: acct.nav.length, equity: acct.nav[acct.nav.length - 1].equity } : null;
  const advice = buildAdvice({
    account: acct,
    stats: st,
    trades: acct?.trades,
    accountReview,
    tradeReview,
    posReview,
    log,
    priceMap,
    emotionScore,
    tier,
    asOf
  });
  const started = accountReview.started;
  return {
    asOf: asOf || null,
    hasAccount,
    started,
    tier,
    score: finite6(emotionScore) ? +emotionScore : null,
    account: accountReview,
    trades: tradeReview,
    positions: posReview,
    attribution,
    advice,
    metrics,
    headline: buildHeadline({ started, hasAccount, accountReview, tradeReview, posReview, attribution })
  };
}
function buildHeadline({ started, hasAccount, accountReview: ar, tradeReview: tr, posReview: pr, attribution }) {
  if (!hasAccount) return "\u5C1A\u672A\u5F00\u59CB\u6A21\u62DF\u4EA4\u6613\u2014\u2014\u5148\u5728\u4E0B\u5355\u533A\u5EFA\u4ED3\uFF0C\u672C\u6BB5\u4F1A\u5728\u6709\u4EA4\u6613\u540E\u81EA\u52A8\u7ED9\u51FA\u590D\u76D8\u3002";
  if (!started) return "\u6A21\u62DF\u8D26\u6237\u5DF2\u5C31\u7EEA\u4F46\u5C1A\u65E0\u6210\u4EA4\u8BB0\u5F55\uFF0C\u6682\u65E0\u53EF\u590D\u76D8\u7684\u6536\u76CA\u5F52\u56E0\u3002";
  const dirTxt = ar.direction === "gain" ? "\u6574\u4F53\u76C8\u5229" : ar.direction === "loss" ? "\u6574\u4F53\u4E8F\u635F" : "\u57FA\u672C\u6301\u5E73";
  const parts = [`\u6A21\u62DF\u8D26\u6237${dirTxt} ${syuan(ar.netPnl)} \u5143\uFF08${sp2(ar.retPct)}\uFF09`];
  if (ar.dominant && Math.abs(ar.dominant.value) > 1) {
    const sameSign = ar.dominant.value > 0 === ar.netPnl > 0;
    if (sameSign) {
      parts.push(`\u4E3B\u8981\u6765\u81EA\u300C${ar.dominant.label}\u300D${syuan(ar.dominant.value)} \u5143`);
    } else {
      parts.push(`\u6700\u5927${ar.dominant.value < 0 ? "\u62D6\u7D2F" : "\u7F13\u51B2"}\u662F\u300C${ar.dominant.label}\u300D${syuan(ar.dominant.value)} \u5143`);
    }
  }
  if (tr.closedCount > 0) {
    parts.push(`\u5DF2\u5E73\u4ED3 ${tr.closedCount} \u7B14\u3001\u80DC\u7387 ${tr.winRate == null ? "\u2014" : pp2(tr.winRate, 0)}`);
  }
  if (pr.overConc.length) parts.push(`\u6709 ${pr.overConc.length} \u53EA\u7968\u8D85\u914D\u9700\u5904\u7406`);
  const pend = attribution ? attribution.pending + attribution.tracked : 0;
  if (attribution && attribution.net !== 0) parts.push(`\u9884\u8B66\u51C0\u8D21\u732E ${syuan(attribution.net)} \u5143`);
  else if (pend > 0) parts.push(`\u9884\u8B66 ${pend} \u6761\u5F85\u4EF7\u683C\u9A8C\u8BC1`);
  return parts.join("\uFF0C") + "\u3002";
}
function liteStats(acct) {
  const positions = Object.values(acct?.positions || {});
  const marketValue = positions.reduce((a, p) => a + (p.last != null ? p.last * p.qty : (p.avgCost || 0) * p.qty), 0);
  const costValue = positions.reduce((a, p) => a + (p.cost || 0), 0);
  const cash = +acct?.cash || 0;
  const freeze = +acct?.freeze || 0;
  const initCash = +acct?.initCash || 0;
  const total = cash + freeze + marketValue;
  return {
    cash,
    freeze,
    marketValue,
    costValue,
    floatPnl: marketValue - costValue,
    floatPnlPct: costValue > 0 ? (marketValue - costValue) / costValue : 0,
    realized: +acct?.realized || 0,
    totalFee: +acct?.totalFee || 0,
    total,
    initCash,
    ret: initCash > 0 ? (total - initCash) / initCash : 0,
    retPct: initCash > 0 ? (total - initCash) / initCash * 100 : 0,
    posCount: positions.length
  };
}

// src/report_card_live.js
var report_card_live_exports = {};
__export(report_card_live_exports, {
  INTRADAY_TTL_MS: () => INTRADAY_TTL_MS,
  buildLiveReport: () => buildLiveReport,
  cardData: () => cardData,
  resetReportCardCache: () => resetReportCardCache
});

// src/calendar.js
var isNode2 = typeof process !== "undefined" && !!(process.versions && process.versions.node) && typeof window === "undefined";
var ROOT = "";
var readFileSync4 = null;
var existsSync4 = null;
var path = null;
if (isNode2) {
  ({ readFileSync: readFileSync4, existsSync: existsSync4 } = await Promise.resolve().then(() => (init_node_fs(), node_fs_exports)));
  path = await Promise.resolve().then(() => (init_node_path(), node_path_exports));
  const { fileURLToPath: fileURLToPath4 } = await Promise.resolve().then(() => (init_node_url(), node_url_exports));
  ROOT = path.resolve(path.dirname(fileURLToPath4(import.meta.url)), "..");
}
var CALENDAR_FILE = "data/calendar.json";
var DAY_KIND = {
  trading: "trading",
  // 明确为交易日
  closed: "closed",
  // 明确为休市日（法定节假日，或周末）
  unknown: "unknown"
  // 日历未覆盖（超出年份范围）→ 回退到「非周末即交易日」的旧规则
};
var SEED_CLOSED = {
  2025: [
    // 2025 元旦 / 春节 / 清明 / 劳动 / 端午 / 中秋国庆（国务院办公厅 2024-11 公告）
    "2025-01-01",
    "2025-01-28",
    "2025-01-29",
    "2025-01-30",
    "2025-01-31",
    "2025-02-03",
    "2025-02-04",
    "2025-04-04",
    "2025-05-01",
    "2025-05-02",
    "2025-05-05",
    "2025-06-02",
    "2025-10-01",
    "2025-10-02",
    "2025-10-03",
    "2025-10-06",
    "2025-10-07",
    "2025-10-08"
  ],
  2026: [
    // 沪深北交易所《2026 年中秋节、国庆节休市安排》（证监办发〔2025〕130 号）
    "2026-01-01",
    "2026-01-02",
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-02-19",
    "2026-02-20",
    "2026-02-23",
    "2026-04-06",
    "2026-05-01",
    "2026-05-04",
    "2026-05-05",
    "2026-06-19",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
    "2026-10-05",
    "2026-10-06",
    "2026-10-07"
  ]
};
var _cache = null;
var _cacheKey = null;
function loadCalendar(opts = {}) {
  const fallback = Array.isArray(opts.fallbackHolidays) ? opts.fallbackHolidays : [];
  const seedClosed = [];
  for (const arr of Object.values(SEED_CLOSED)) seedClosed.push(...arr);
  if (!isNode2) {
    const raw = typeof window !== "undefined" && window.ASENT_CALENDAR || null;
    return fromRaw(raw, fallback, seedClosed);
  }
  const file = opts.file || path.join(ROOT, CALENDAR_FILE);
  const key = file + "|" + fallback.join(",");
  if (!opts.reload && _cache && _cacheKey === key) return _cache;
  let cal = null;
  if (existsSync4(file)) {
    try {
      const raw = JSON.parse(readFileSync4(file, "utf8"));
      cal = fromRaw(raw, fallback, seedClosed);
    } catch (e) {
      cal = fromRaw(null, fallback, seedClosed);
      cal.meta.degraded = true;
      cal.meta.degradedReason = "\u65E5\u5386\u6587\u4EF6\u89E3\u6790\u5931\u8D25\uFF1A" + e.message;
    }
  } else {
    cal = fromRaw(null, fallback, seedClosed);
    cal.meta.degraded = true;
    cal.meta.degradedReason = "\u65E5\u5386\u6587\u4EF6\u4E0D\u5B58\u5728\uFF08" + CALENDAR_FILE + "\uFF09\uFF0C\u5DF2\u56DE\u9000\u5230\u79CD\u5B50 + config.manualHolidays";
  }
  _cache = cal;
  _cacheKey = key;
  return cal;
}
function fromRaw(raw, fallback, seedClosed) {
  const closed = new Set(seedClosed);
  const trading = /* @__PURE__ */ new Set();
  let years = [];
  let source = "seed";
  const meta = {};
  for (const d of fallback) closed.add(d);
  if (raw && typeof raw === "object") {
    source = raw.source || "file";
    meta.source = raw.source || null;
    meta.generatedAt = raw.generatedAt || null;
    meta.note = raw.note || null;
    meta.upstream = raw.upstream || null;
    if (Array.isArray(raw.years)) years = raw.years.map(Number).filter(Number.isFinite);
    if (Array.isArray(raw.closed)) for (const d of raw.closed) closed.add(d);
    if (Array.isArray(raw.holidays)) for (const d of raw.holidays) closed.add(d);
    if (raw.days && typeof raw.days === "object") {
      for (const [d, k] of Object.entries(raw.days)) {
        if (k === DAY_KIND.closed) closed.add(d);
        else if (k === DAY_KIND.trading) {
          trading.add(d);
          closed.delete(d);
        }
      }
    }
    if (Array.isArray(raw.trading)) {
      for (const d of raw.trading) {
        trading.add(d);
        closed.delete(d);
      }
    }
  }
  if (!years.length) {
    const ys = /* @__PURE__ */ new Set();
    for (const d of closed) ys.add(Number(String(d).slice(0, 4)));
    for (const d of trading) ys.add(Number(String(d).slice(0, 4)));
    years = [...ys].filter(Number.isFinite).sort();
  }
  return {
    kind: "calendar",
    source,
    closed,
    trading,
    years,
    meta,
    fallbackCount: fallback.length,
    seedCount: seedClosed.length
  };
}
function dow(dateStr) {
  const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d.getDay();
}
function dayKind(dateStr, cal) {
  const c = cal || loadCalendar();
  if (c.trading.has(dateStr)) return DAY_KIND.trading;
  if (c.closed.has(dateStr)) return DAY_KIND.closed;
  const w = dow(dateStr);
  if (w === 0 || w === 6) return DAY_KIND.closed;
  const y = Number(String(dateStr).slice(0, 4));
  if (c.years.includes(y)) return DAY_KIND.trading;
  return DAY_KIND.unknown;
}
function isTradingDay(dateStr, calendarOrHolidays) {
  if (Array.isArray(calendarOrHolidays)) {
    const w2 = dow(dateStr);
    if (w2 === 0 || w2 === 6) return false;
    return !calendarOrHolidays.includes(dateStr);
  }
  const kind = dayKind(dateStr, calendarOrHolidays);
  if (kind === DAY_KIND.trading) return true;
  if (kind === DAY_KIND.closed) return false;
  const w = dow(dateStr);
  return w !== 0 && w !== 6;
}

// src/time.js
var BJ_OFFSET_MS = 8 * 3600 * 1e3;
function bjDate(now = /* @__PURE__ */ new Date()) {
  return new Date(now.getTime() + BJ_OFFSET_MS).toISOString().slice(0, 10);
}
function bjTime(now = /* @__PURE__ */ new Date()) {
  return new Date(now.getTime() + BJ_OFFSET_MS).toISOString().slice(11, 16);
}
function bjInstant(dateStr, hhmm) {
  return Date.parse(`${dateStr}T${hhmm}:00+08:00`);
}

// src/util.js
function todayBeijing(now = /* @__PURE__ */ new Date()) {
  return bjDate(now);
}
function isTradingDay2(dateStr, calendarOrHolidays) {
  if (calendarOrHolidays === void 0) return isTradingDay(dateStr, void 0);
  return isTradingDay(dateStr, calendarOrHolidays);
}

// src/freshness.js
var MARKET_CLOSE = "15:00";
var PUBLISH_HHMM = "19:30";
function shift(dateStr, n) {
  const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function prevSession(dateStr, holidays = []) {
  let d = shift(dateStr, -1);
  for (let i = 0; i < 400; i++) {
    if (isTradingDay2(d, holidays)) return d;
    d = shift(d, -1);
  }
  return null;
}
function nextSession(dateStr, holidays = []) {
  let d = shift(dateStr, 1);
  for (let i = 0; i < 400; i++) {
    if (isTradingDay2(d, holidays)) return d;
    d = shift(d, 1);
  }
  return null;
}
function lastClosedSession(now = /* @__PURE__ */ new Date(), holidays = []) {
  const today = bjDate(now);
  if (isTradingDay2(today, holidays) && bjTime(now) >= MARKET_CLOSE) return today;
  return prevSession(today, holidays);
}
function countSessions(from, to, holidays = []) {
  if (!from || !to || from >= to) return 0;
  let n = 0;
  let d = from;
  for (let i = 0; i < 400; i++) {
    d = shift(d, 1);
    if (d > to) break;
    if (isTradingDay2(d, holidays)) n++;
  }
  return n;
}
function publishDeadline(tradeDate, holidays = []) {
  const n = nextSession(tradeDate, holidays);
  return n ? bjInstant(n, PUBLISH_HHMM) : null;
}
function assessFreshness(meta = {}, now = /* @__PURE__ */ new Date(), holidays = []) {
  const tradeDate = meta.tradeDate || null;
  const latestClosed = lastClosedSession(now, holidays);
  const behindSessions = countSessions(tradeDate, latestClosed, holidays);
  const deadline = tradeDate ? publishDeadline(tradeDate, holidays) : null;
  let state;
  if (!tradeDate) state = "unknown";
  else if (behindSessions <= 0) state = "fresh";
  else if (deadline != null && now.getTime() < deadline) state = "pending";
  else state = "behind";
  return {
    state,
    stale: state === "behind",
    tradeDate,
    latestClosed,
    behindSessions,
    publishDeadline: deadline == null ? null : new Date(deadline).toISOString(),
    checkedAt: now.toISOString()
  };
}

// src/module_freshness.js
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var isDateStr = (v) => typeof v === "string" && DATE_RE.test(v);
function guardModuleFreshness(moduleDate, archiveDate) {
  if (!isDateStr(archiveDate)) {
    return { ok: false, reason: "anchor-missing", moduleDate: isDateStr(moduleDate) ? moduleDate : null, archiveDate: null };
  }
  if (!isDateStr(moduleDate)) {
    return { ok: false, reason: "module-date-missing", moduleDate: null, archiveDate };
  }
  if (moduleDate < archiveDate) {
    return { ok: false, reason: "stale", moduleDate, archiveDate };
  }
  return { ok: true, reason: null, moduleDate, archiveDate };
}

// src/validate_snapshot.js
var validate_snapshot_exports = {};
__export(validate_snapshot_exports, {
  EXTERNAL_CACHE_TAG: () => EXTERNAL_CACHE_TAG,
  STALE_DAYS: () => STALE_DAYS,
  validateExternal: () => validateExternal
});
var STALE_DAYS = 2;
var EXTERNAL_CACHE_TAG = "\u3010\u5386\u53F2\u7F13\u5B58\uFF0C\u4ECA\u65E5\u5916\u56F4\u91C7\u96C6\u5931\u8D25\u3011";
function quoteDateStr(q) {
  if (!q || !q.quoteTime) return null;
  const s = String(q.quoteTime).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function dayDiff(a, b) {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round((db - da) / 864e5);
}
function validateExternal(global, opts = {}) {
  const today = opts.today || bjDate();
  const lastAttempt = global && global.meta && global.meta.lastAttempt;
  const fetchFailed = !!(lastAttempt && lastAttempt.outcome === "failed");
  const quotes = global && Array.isArray(global.quotes) ? global.quotes : [];
  const results = {};
  const alerts = [];
  for (const q of quotes) {
    if (!q || !q.key) continue;
    const name = q.name || q.key;
    const qd = quoteDateStr(q);
    const age = qd ? dayDiff(qd, today) : null;
    const ok = q.ok !== false;
    let action = "keep";
    let note = null;
    if (!ok) {
      action = "null";
    } else if (qd == null) {
      if (fetchFailed) {
        action = "keep_tag";
        note = EXTERNAL_CACHE_TAG;
      }
    } else if (age <= 0) {
      action = "keep";
    } else if (age < STALE_DAYS) {
      if (fetchFailed) {
        action = "keep_tag";
        note = EXTERNAL_CACHE_TAG;
      } else action = "keep";
    } else {
      action = "null";
    }
    const chgPct = action !== "null" && q.chgPct != null && Number.isFinite(q.chgPct) ? q.chgPct / 100 : null;
    const state = action === "null" ? "stale" : q.state || (ok ? "ok" : "unknown");
    if (action === "null") {
      if (age != null && age >= STALE_DAYS) {
        alerts.push(`\u5916\u56F4\u300C${name}\u300D\u5DF2\u9648\u65E7 ${age} \u5929\uFF08\u672A\u5237\u65B0\uFF09\uFF0C\u5DF2\u7F6E\u7A7A`);
      } else {
        const failNote = fetchFailed ? "\uFF08\u91C7\u96C6\u5931\u8D25\u672A\u5237\u65B0\uFF09" : "\uFF08\u5916\u56F4\u672A\u5237\u65B0\u5230\u6700\u65B0\u4F1A\u8BDD\uFF09";
        alerts.push(`\u5916\u56F4\u300C${name}\u300D${failNote}\uFF0C\u5DF2\u7F6E\u7A7A`);
      }
    } else if (action === "keep_tag") {
      alerts.push(`\u5916\u56F4\u300C${name}\u300D\u4E3A\u5386\u53F2\u7F13\u5B58\uFF08\u4ECA\u65E5\u91C7\u96C6\u5931\u8D25\uFF09\uFF0C\u4EC5\u4F9B\u53C2\u8003`);
    }
    results[q.key] = { key: q.key, name, chgPct, state, stale: action === "keep_tag", action, note };
  }
  return { results, alerts, today, fetchFailed };
}

// src/global.js
var GLOBAL_SYMBOLS = [
  // ① A 股外盘代理（权重最高）：长假期间唯一还在交易、且直接定价 A 股权重的品种
  {
    key: "a50",
    code: "hf_CHA50CFD",
    name: "\u5BCC\u65F6\u4E2D\u56FDA50\u671F\u8D27",
    kind: "hf",
    role: "a_share_proxy",
    // ★ 夜盘收盘锚点（2026-10-13 拍板）：SGX 夜盘 17:00–次日 05:15（北京），
    //   05:15 收盘集合竞价出结算价。报告口径取「富时A50期货夜盘」——仅在北京 05:15
    //   后的抓取才采信为夜盘收盘；早于此时点 = 夜盘未收，显示「夜盘未收」、绝不取盘中瞬时价。
    sessionAnchor: { closeBeijing: "05:15" },
    note: "\u65B0\u52A0\u5761\u4EA4\u6613\u6240\u3002\u591C\u76D8 17:00\u2013\u6B21\u65E5 05:15\uFF08\u5317\u4EAC\uFF09\uFF0C05:15 \u6536\u76D8\u96C6\u5408\u7ADE\u4EF7\u3001\u7ED3\u7B97\u4EF7\u51FA\u6E05\u3002\u62A5\u544A\u53E3\u5F84\u53D6\u300C\u5BCC\u65F6A50\u671F\u8D27\u591C\u76D8\u300D\u2014\u2014\u4EC5\u5728\u5317\u4EAC 05:15 \u540E\u7684\u6293\u53D6\u624D\u91C7\u4FE1\u4E3A\u591C\u76D8\u6536\u76D8\uFF0C\u65E9\u4E8E\u6B64\u65F6\u70B9\u663E\u793A\u300C\u591C\u76D8\u672A\u6536\u300D\u3001\u7EDD\u4E0D\u53D6\u76D8\u4E2D\u77AC\u65F6\u4EF7"
  },
  // ② 美股宽基
  {
    key: "dji",
    code: "gb_$dji",
    name: "\u9053\u743C\u65AF",
    kind: "us",
    role: "us_index",
    note: "\u91D1\u878D/\u6D88\u8D39\u6743\u91CD\u9AD8\uFF0C\u4E0E A \u80A1\u6210\u957F\u4E3B\u7EBF\u5173\u8054\u6700\u5F31\u2014\u2014\u53EA\u4F5C\u5E7F\u5EA6\u53C2\u8003\uFF0C\u4E0D\u4F5C\u65B9\u5411\u951A"
  },
  { key: "spx", code: "gb_$inx", name: "\u6807\u666E500", kind: "us", role: "us_index" },
  {
    key: "ixic",
    code: "gb_$ixic",
    name: "\u7EB3\u65AF\u8FBE\u514B",
    kind: "us",
    role: "us_index",
    note: "\u4E0E\u521B\u4E1A\u677F/\u79D1\u521B\u7684\u6210\u957F\u98CE\u683C\u540C\u5411"
  },
  { key: "ndx", code: "gb_$ndx", name: "\u7EB3\u65AF\u8FBE\u514B100", kind: "us", role: "us_index" },
  // ③ 美股行业 / 中国资产
  {
    key: "sox",
    code: "gb_sox",
    name: "\u8D39\u57CE\u534A\u5BFC\u4F53\u6307\u6570",
    kind: "us",
    role: "us_sector",
    note: "\u4E0E A \u80A1 PCB/\u5143\u4EF6/\u534A\u5BFC\u4F53\u540C\u6E90\u5EA6\u6700\u9AD8\uFF08\u540C\u4E00\u6279\u7EC8\u7AEF\u9700\u6C42\u4E0E\u5BA2\u6237\uFF09"
  },
  { key: "hxc", code: "gb_$hxc", name: "\u7EB3\u65AF\u8FBE\u514B\u4E2D\u56FD\u91D1\u9F99\u6307\u6570", kind: "us", role: "china_adr" },
  {
    key: "fxi",
    code: "gb_fxi",
    name: "\u5BCC\u65F6\u4E2D\u56FDETF\uFF08FXI\uFF09",
    kind: "us",
    role: "china_adr",
    note: "\u7F8E\u80A1\u4E0A\u5E02\u7684\u4E2D\u56FD\u5927\u76D8\u80A1 ETF\uFF0C\u5916\u8D44\u5BF9\u4E2D\u56FD\u6743\u91CD\u7684\u5B9A\u4EF7"
  },
  // ④ 中国香港（与 A 股共用假期，节前/节后对照用）
  { key: "hsi", code: "rt_hkHSI", name: "\u6052\u751F\u6307\u6570", kind: "hk", role: "hk_index" },
  { key: "hstech", code: "rt_hkHSTECH", name: "\u6052\u751F\u79D1\u6280", kind: "hk", role: "hk_index" },
  // ⑤ 汇率（分母端 / 外资流向）
  {
    key: "dxy",
    code: "DINIW",
    name: "\u7F8E\u5143\u6307\u6570",
    kind: "dxy",
    role: "fx",
    note: "\u65B0\u6D6A\u53E3\u5F84\uFF0C\u4E0E ICE \u5B98\u65B9\u6216\u6709\u4E2A\u4F4D\u5C0F\u6570\u5DEE\u5F02"
  },
  { key: "cnh", code: "fx_susdcnh", name: "\u7F8E\u5143/\u79BB\u5CB8\u4EBA\u6C11\u5E01", kind: "fx", role: "fx" },
  { key: "cny", code: "fx_susdcny", name: "\u7F8E\u5143/\u5728\u5CB8\u4EBA\u6C11\u5E01", kind: "fx", role: "fx" },
  // ⑥ 商品
  { key: "gold", code: "hf_GC", name: "COMEX\u9EC4\u91D1", kind: "hf", role: "commodity" },
  { key: "wti", code: "hf_CL", name: "WTI\u539F\u6CB9", kind: "hf", role: "commodity" },
  {
    key: "brent",
    code: "hf_OIL",
    name: "\u5E03\u4F26\u7279\u539F\u6CB9",
    kind: "hf",
    role: "commodity",
    note: "\u65B0\u6D6A\u62A5\u7684\u662F**\u6D3B\u8DC3\u5408\u7EA6**\uFF1B\u5A92\u4F53\u5E38\u5F15\u7528\u5373\u5C06\u5230\u671F\u5408\u7EA6\uFF08\u4E24\u8005\u53EF\u5DEE\u6570\u7F8E\u5143\uFF0C\u89C1 2026-09-30 \u5B9E\u4F8B\uFF09"
  }
];
var SINA_CODES = GLOBAL_SYMBOLS.map((s) => s.code).join(",");
var QUOTE_STATE = {
  OK: "ok",
  // 有成交、可现算涨跌幅
  PREOPEN: "preopen",
  // 会话未开盘（open/high/low 全 0）→ chgPct = null
  NO_TRADE: "no-trade",
  // 数据源给的是平盘占位（last==prevClose 且 量=0 且 振幅=0）
  MISSING: "missing",
  // 字段缺失/解析不出 latest
  NIGHT_OPEN: "night-open"
  // 连续合约（如 A50）夜盘尚未收盘，取到的是盘中瞬时价，不当收盘用
};
var US_CLOSE_ET_MIN = 16 * 60;
var US_SETTLE_BUFFER_MIN = 30;
var US_READY_ET_MIN = US_CLOSE_ET_MIN + US_SETTLE_BUFFER_MIN;

// src/position_policy.js
var POSITION_BANDS = {
  ice: {
    key: "ice",
    minPos: 0,
    maxPos: 0.2,
    label: "\u51B0\u70B9",
    advice: "\u4F18\u5148\u7A7A\u4ED3\uFF0C\u4EC5\u6781\u7AEF\u9519\u6740\u624D\u503C\u5F97\u8BD5\u63A2",
    tone: "defend"
  },
  ebb: {
    key: "ebb",
    minPos: 0,
    maxPos: 0.2,
    label: "\u9000\u6F6E",
    advice: "\u9AD8\u4F4D\u4E0B\u884C\uFF0C\u9632\u8865\u8DCC\u4F18\u5148\uFF0C\u53EA\u51CF\u4E0D\u52A0",
    tone: "defend"
  },
  recover: {
    key: "recover",
    minPos: 0.3,
    maxPos: 0.5,
    label: "\u590D\u82CF/\u915D\u917F\u671F",
    advice: "\u4E2D\u6027\u9707\u8361\u8BD5\u4ED3\uFF0C\u8DDF\u968F\u786E\u8BA4\u518D\u52A0",
    tone: "balanced"
  },
  neutral: {
    key: "neutral",
    minPos: 0.3,
    maxPos: 0.5,
    label: "\u4E2D\u6027\u9707\u8361",
    advice: "\u57FA\u51C6\u60C5\u666F\uFF1A\u534A\u4ED3\u4E0A\u4E0B\uFF0C\u7ED3\u6784\u673A\u4F1A\u4E3A\u4E3B",
    tone: "balanced"
  },
  climax: {
    key: "climax",
    minPos: 0.6,
    maxPos: 1,
    label: "\u4E3B\u5347\u884C\u60C5",
    advice: "\u987A\u52BF\u6301\u6709\u4E3A\u4E3B\uFF0C\u8FFD\u9AD8\u9700\u7559\u7ED9\u6B62\u635F\u7EAA\u5F8B",
    tone: "attack"
  },
  shift: {
    key: "shift",
    minPos: 0,
    maxPos: 0.3,
    label: "\u9AD8\u6F6E\u5206\u6B67/\u72B6\u6001\u5207\u6362\u671F",
    advice: "\u5F3A\u5236\u964D\u4ED3\uFF1A\u9650\u5236\u65B0\u5F00\u8FDB\u653B\u4ED3\uFF0C\u53EA\u7559\u6838\u5FC3\u4ED3",
    tone: "defend",
    force: true
    // force = 需求语义"强制降仓"，前端显著标识
  }
};
function bandFor(key) {
  if (key == null) return null;
  const b = POSITION_BANDS[String(key)];
  return b ? { ...b } : null;
}
function formatBand(band) {
  if (!band || typeof band.minPos !== "number" || typeof band.maxPos !== "number") return null;
  return `${Math.round(band.minPos * 100)}%~${Math.round(band.maxPos * 100)}%`;
}
function scoreToBand(score) {
  if (score == null) return null;
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s >= 80) return { key: "base_attack", minPos: 0.6, maxPos: 1, label: "\u8FDB\u653B\uFF08\u60C5\u7EEA\u6781\u9AD8\u4F4D\uFF09" };
  if (s >= 65) return { key: "base_bull", minPos: 0.3, maxPos: 0.6, label: "\u504F\u591A" };
  if (s >= 50) return { key: "base_neutral", minPos: 0.3, maxPos: 0.5, label: "\u4E2D\u6027" };
  return { key: "base_defend", minPos: 0, maxPos: 0.3, label: "\u9632\u5B88" };
}
function reconcilePosition({ score, regimeKey }) {
  const base = scoreToBand(score);
  const cap = bandFor(regimeKey);
  if (!base || !cap) return null;
  return {
    score: score == null ? null : Math.round(Number(score) * 10) / 10,
    base,
    baseRange: formatBand(base),
    cap,
    capRange: formatBand(cap),
    force: cap.force === true,
    // 冲突 = 情绪喊冲（进攻/偏多，建议 ≥30%）却遇风控盖帽（帽 ≤30% 或强制降仓）。
    //   专指"精神分裂"场景；低分(防守)遇 risk-off 帽不算冲突（两者都叫防守）。
    conflict: (base.key === "base_attack" || base.key === "base_bull") && cap.maxPos <= 0.3,
    finalRange: formatBand(cap)
  };
}

// src/mainline_guard.js
var _liveStops = config_default && config_default.params && config_default.params.live && config_default.params.live.stops || {};
var SENTIMENT_PENALTY = Number.isFinite(+_liveStops.sentimentPenalty) ? +_liveStops.sentimentPenalty : 10;
var CLUSTER_RISE_COUNT_MAX = Number.isFinite(+_liveStops.clusterRiseMax) ? +_liveStops.clusterRiseMax : 1500;
var CLUSTER_RED_INDUSTRY_RATIO_MAX = Number.isFinite(+_liveStops.clusterRedIndustryRatioMax) ? +_liveStops.clusterRedIndustryRatioMax : 0.1;
function detectClusteringBubble({ upCount, redIndustryRatio, riseCountMax, penaltyOverride } = {}) {
  const rise = Number.isFinite(upCount) ? upCount : null;
  const red = Number.isFinite(redIndustryRatio) ? redIndustryRatio : null;
  const riseMax = Number.isFinite(+riseCountMax) ? +riseCountMax : CLUSTER_RISE_COUNT_MAX;
  const penalty = Number.isFinite(+penaltyOverride) ? +penaltyOverride : SENTIMENT_PENALTY;
  const isClusteringBubble = rise != null && red != null && rise < riseMax && red < CLUSTER_RED_INDUSTRY_RATIO_MAX;
  return {
    isClusteringBubble,
    // 仅当触发时返回扣分（正数），调用方从情绪分里减去；未触发返回 0（无扣分）
    penalty: isClusteringBubble ? penalty : 0
  };
}
function penaltyApplies(isClusteringBubble, regimeKey) {
  return isClusteringBubble && (regimeKey === "recover" || regimeKey === "climax");
}
function computeRedIndustryRatio(industry) {
  if (!Array.isArray(industry) || !industry.length) return null;
  const red = industry.filter((x) => x && Number.isFinite(x.change_pct) && x.change_pct > 0).length;
  return red / industry.length;
}

// src/ai_report.js
var SCHEMA_VERSION = "1.0";
var REPORT_TYPES = ["pre_market", "intraday", "post_market", "weekly"];
var TRIGGER_ENUM = ["schedule", "event:circuit_breaker", "event:trend_switch", "event:drawdown_near", "event:script_hit"];
var AI_REPORT_DISCLAIMER = "\u672C\u62A5\u544A\u53EA\u63CF\u8FF0\u7CFB\u7EDF\u72B6\u6001\u4E0E\u98CE\u9669\u7279\u5F81\uFF0C\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE\uFF1B\u7F3A\u5931\u9879\u6807\u6CE8\u672A\u77E5\u800C\u975E\u8865 0\u3002";
var DD_TIER_EDGES = [0.09, 0.15];
var STRUCTURAL_NULL = /* @__PURE__ */ new Set([
  "grid_triggers",
  "grid_trigger_detail",
  "counter_trend_losses",
  "counter_trend_loss_ratio",
  "key_levels",
  "events_today",
  "atr",
  "suggested_step"
]);
var BASE_MISSING_NOTES = [
  { field: "grid_triggers / grid_trigger_detail", reason: "\u7CFB\u7EDF\u65E0\u7F51\u683C\u4EA4\u6613\u5F15\u64CE\uFF08grid_parallel \u662F\u53C2\u6570\u5BFB\u4F18\u5E76\u884C\u5668\uFF0C\u975E\u4EA4\u6613\u7F51\u683C\uFF09", ref: "src/grid_parallel.js" },
  { field: "counter_trend_losses / counter_trend_loss_ratio", reason: "\u65E0\u9006\u52BF\u52A0\u4ED3/\u4E8F\u635F\u8BB0\u8D26\uFF1B\u53C2\u8003 divergence.posGap\uFF08\u4FDD\u8D39\u655E\u53E3\uFF09", ref: "data/paper/dual_track_latest.json" }
];
var LIVE_ONLY_NOTE = { field: "max_drawdown_daily / fee_total / net_pnl / cost_ratio / slippage \u5B9E\u6D4B", reason: "\u4E2A\u4EBA\u8D26\u672C\u6210\u4EA4\u4E0E\u65E5\u5185 equity \u4EC5\u5B58\u5728\u4E8E\u6D4F\u89C8\u5668 localStorage\uFF08\u5373\u65F6\u8F68\u4E00\u7B49\u516C\u6C11\uFF0C\u51B3\u8BAE 1\uFF09", ref: "paper_ui.js __paperSnapshot" };
var WEEKLY_WIN_RATE_NOTE = "\u53E3\u5F84 = \u6A21\u62DF\u76D8\u5E73\u4ED3\u80DC\u7387\uFF08reviewTrades\uFF0C\u6765\u81EA data/paper/account.json \u7684 trades\uFF1BP3 \u8D77\u7ED1\u5B9A\u771F\u5B9E\u6210\u4EA4\uFF09\uFF1B0 \u7B14\u5E73\u4ED3 \u2192 null\uFF08\u6837\u672C\u4E0D\u8DB3\uFF0C\u4E0D\u964D\u7EA7\u4E3A\u65E5\u6536\u76CA\u53E3\u5F84\uFF09\u3002\u539F\u300C\u5267\u672C\u547D\u4E2D\u7387\u300D\u6570\u636E\u6E90 airpt_sim_bindings \u4ECD\u7F3A\u5E2D\u3002";
var CONCEPTS = {
  trend_switch: "regime \u72B6\u6001\u673A\uFF08src/regime.js\uFF09",
  circuit_breaker: "DD_TIERS + HARD_STOP_LOSS + ops-alerts\uFF08src/paper.js / src/opsalerts.js\uFF09"
};
var SOURCE_REFS = {
  date: "data/paper/dual_track_latest.json::day.date",
  pnl_daily: "data/paper/dual_track_latest.json::day.dayReturns.A\uFF08\u5373\u65F6\u8F68\u8986\u76D6\u4E3A\u8D26\u672C nav \u5F53\u65E5\u53D8\u5316\uFF09",
  pnl_cumulative: "data/paper/dual_track_latest.json::summary.trackA.total\uFF08\u5373\u65F6\u8F68\u8986\u76D6\u4E3A accountStats.ret\uFF09",
  close_drawdown: "live \u5B9E\u65F6\u8D26\u6237\u5F53\u524D\u56DE\u64A4 accountStats.drawdown\uFF08\u51B3\u8BAE A\uFF1A\u7981\u6DF7\u53CC\u8F68 trackA.maxDd\uFF09\uFF1B\u7A7A\u4ED3\u2192null\uFF1B\u5F52\u6863\u8F68\u56DE\u9000 dual_track trackA.maxDd",
  max_drawdown_daily: "\u5373\u65F6\u8F68\u5F53\u65E5 equity \u5E8F\u5217\u5CF0\u8C37\uFF08S3-1 \u6CE8\u5165\uFF1Aopts.drawdownDaily \u2190 window.__intradayLive.drawdownDaily \u2190 src/intraday_live.js::dailyDrawdown\uFF09",
  trend_switch_hits: "data/signals-latest.json::regime.turns",
  overseas: "data/global.json::quotes\uFF08A50 + \u8D39\u534A\uFF1B\u7F8E\u80A1\u4EC5\u7F8E\u4E1C 16:30 \u540E\u53EF\u4FE1\uFF09",
  backtest_deviation: "data/backtest.json::v52 vs dual_track summary.trackA",
  market_context: "data/signals-latest.json::latest / breadth / pain / seats",
  circuit_breaker: "data/ops-alerts-latest.json::events + src/paper.js::DD_TIERS",
  regime: "data/paper/dual_track_latest.json::day.regime + signals.dailyReport\uFF08\u4ED3\u4F4D\u533A\u95F4\uFF09",
  slippage_avg: "src/paper.js::DEFAULT_SLIP\uFF08\u5F52\u6863\u8F68\u5047\u8BBE\u5E38\u91CF\uFF09/ orders\xD7trades \u9010\u7B14\u5B9E\u6D4B\uFF08\u5373\u65F6\u8F68\uFF09",
  cost_ratio: "\u5373\u65F6\u8F68\u5F53\u65E5 trades \u8D39\u7528\u5408\u8BA1 / \u6210\u4EA4\u989D\u5408\u8BA1\uFF1B\u5F52\u6863\u8F68\u65E0\u6210\u4EA4\u660E\u7EC6 \u2192 null",
  win_rate: WEEKLY_WIN_RATE_NOTE
  // P3：改为模拟盘平仓胜率（reviewTrades）
};
var num = (v) => Number.isFinite(v) ? v : null;
var pick2 = (o, path3) => path3.split(".").reduce((a, k) => a == null ? a : a[k], o);
function sourceHealth(v, dateField, expectDate) {
  if (v == null || typeof v !== "object") return "missing";
  if (expectDate && dateField) {
    const d = pick2(v, dateField);
    if (typeof d === "string" && d !== expectDate) return "stale";
  }
  return "fresh";
}
function buildInput(s = {}) {
  const tradeDate = pick2(s, "signals.meta.tradeDate") ?? pick2(s, "dualTrack.day.date") ?? null;
  const gDt = guardModuleFreshness(pick2(s, "dualTrack.day.date"), tradeDate);
  const gBt = guardModuleFreshness(pick2(s, "backtest.meta.tradeDate"), tradeDate);
  const dualTrack = gDt.ok ? s.dualTrack : null;
  const backtest = gBt.ok ? s.backtest : null;
  const sources = {
    dual_track: gDt.ok ? sourceHealth(s.dualTrack, "day.date", tradeDate) : "stale",
    signals: sourceHealth(s.signals, "meta.tradeDate", tradeDate),
    global: sourceHealth(s.global, "meta.aShareTradeDate", tradeDate),
    backtest: gBt.ok ? sourceHealth(s.backtest, "meta.tradeDate", tradeDate) : "stale",
    ops_alerts: sourceHealth(s.opsAlerts, null, null),
    intraday: sourceHealth(s.intraday, "tradeDate", tradeDate),
    paper_account: s.paperAccount && typeof s.paperAccount === "object" ? "live" : "missing"
  };
  return { ...s, dualTrack, backtest, tradeDate, sources, live: sources.paper_account === "live" };
}
function deriveStatus(input, payload) {
  if (input.sources.dual_track === "missing") return "missing";
  const variablyNull = Object.entries(payload).filter(([k, v]) => v == null && !STRUCTURAL_NULL.has(k)).map(([k]) => k);
  return variablyNull.length ? "degraded" : "ok";
}
function structuralNulls() {
  return {
    grid_triggers: null,
    counter_trend_losses: null
  };
}
function buildOverseas(global, ext) {
  if (!global || !Array.isArray(global.quotes)) return null;
  const gqOf = (key) => (Array.isArray(global.quotes) ? global.quotes : []).find((x) => x && x.key === key);
  const mk = (key) => {
    const gq = gqOf(key);
    if (key === "a50" && gq && gq.state === QUOTE_STATE.NIGHT_OPEN) {
      return { key: "a50", name: gq.name || "\u5BCC\u65F6A50\u671F\u8D27", chgPct: null, state: QUOTE_STATE.NIGHT_OPEN, nightOpen: true };
    }
    const r = ext?.results?.[key];
    if (!r) return null;
    return {
      key: r.key,
      name: r.name,
      // 单位换算（S3-5 逮住的 S1 既有 bug）：data/global.json 的 chgPct 是**百分数值**
      // （src/global.js::normalizeQuote 现算 chg/prevClose×100，如 0.4942 = +0.4942%），
      // 报告层约定小数（push_text pct() 再 ×100）——搬运边界必须 ÷100，否则虚报 100 倍。
      // action==='null'（陈旧≥阈值/单 quote 失败）→ 强制 null，渲染 —，杜绝旧值误读。
      chgPct: r.action === "null" ? null : r.chgPct,
      state: r.state,
      // 陈旧但保留（当日抓取失败、<阈值）：cacheNote 强制标注，push_text 渲染时追加。
      stale: r.stale,
      cacheNote: r.note || null
    };
  };
  const out2 = [mk("a50"), mk("sox")].filter(Boolean);
  return out2.length ? out2 : null;
}
function buildRegime(input) {
  const day = pick2(input, "dualTrack.day");
  if (!day) return null;
  const range = (pick2(input, "signals.dailyReport.sections") || []).find((x) => x && x.id === "regime" && x.position && x.position.range);
  const capKey = pick2(input, "signals.dailyReport.tag.key") || day.regime?.key || null;
  const posRec = reconcilePosition({ score: day.score, regimeKey: capKey });
  const regime = {
    key: capKey ?? day.regime?.key ?? null,
    label: posRec && posRec.cap && posRec.cap.label || day.regime?.label || null,
    score: day && Number.isFinite(day.score) ? day.score : null,
    // 大盘情绪分（0-100，任务一·盘中温度计播报用）
    cap: posRec && posRec.cap && Number.isFinite(posRec.cap.maxPos) ? posRec.cap.maxPos : Number.isFinite(day.regime?.cap) ? day.regime.cap : null,
    position_range: posRec ? posRec.finalRange : range ? range.position.range : null,
    positionReconcile: posRec
  };
  return applyClusteringBubbleOverride(regime, input);
}
function applyClusteringBubbleOverride(regime, input) {
  const day = pick2(input, "dualTrack.day") || {};
  const signals = input?.signals || {};
  const upCount = Number.isFinite(day?.summary?.up_count) ? day.summary.up_count : Number.isFinite(pick2(signals, "latest.up_count")) ? pick2(signals, "latest.up_count") : null;
  const redIndustryRatio = computeRedIndustryRatio(day?.industry);
  const { isClusteringBubble, penalty } = detectClusteringBubble({ upCount, redIndustryRatio });
  regime.clustering_bubble = isClusteringBubble;
  const applyPenalty = penaltyApplies(isClusteringBubble, regime.key);
  regime.sentiment_penalty = applyPenalty ? penalty : 0;
  if (regime.score != null) regime.score_adjusted = applyPenalty ? regime.score - penalty : regime.score;
  const ratioTxt = redIndustryRatio != null ? `${(redIndustryRatio * 100).toFixed(1)}%` : "?";
  if (applyPenalty) {
    const fromLabel = regime.label || regime.key;
    regime.key = "neutral";
    regime.label = "\u4E2D\u6027(\u62B1\u56E2\u5206\u5316)";
    regime.clustering_bubble_downgraded = true;
    regime.clustering_bubble_note = `\u6807\u8BB0\uFF1A\u62B1\u56E2\u5206\u5316\uFF0C\u53D6\u6D88${fromLabel}\u5224\u5B9A\uFF08\u4E0A\u6DA8\u5BB6\u6570 ${upCount ?? "?"} < 1500 \u4E14 \u7EA2\u76D8\u884C\u4E1A\u5360\u6BD4 ${ratioTxt} < 10%\uFF09`;
  } else if (isClusteringBubble) {
    regime.clustering_bubble_note = `\u62B1\u56E2\u5206\u5316\u6CE1\u6CAB\uFF08\u4E0A\u6DA8\u5BB6\u6570 ${upCount ?? "?"} < 1500 \u4E14 \u7EA2\u76D8\u884C\u4E1A\u5360\u6BD4 ${ratioTxt} < 10%\uFF09\uFF1B\u539F\u5468\u671F\u975E\u56DE\u6696/\u9AD8\u6F6E\uFF08\u672C\u5C31\u4FDD\u5B88\uFF09\uFF0C\u4E0D\u989D\u5916\u964D\u7EA7`;
  }
  return regime;
}
function turnsIn(input, from, to) {
  const turns = pick2(input, "signals.regime.turns");
  if (!Array.isArray(turns)) return [];
  return turns.filter((t) => t && typeof t.date === "string" && t.date >= from && t.date <= to);
}
function buildCircuitBreaker(input, opts = {}) {
  const events = Array.isArray(pick2(input, "opsAlerts.events")) ? input.opsAlerts.events : null;
  const riskEvents = events ? events.length : null;
  if (!input.live) {
    return {
      dd_tier: null,
      hard_stop_triggered: null,
      risk_events: riskEvents,
      note: "\u5F52\u6863\u8F68\u65E0\u8D26\u6237\u65E5\u5185\u56DE\u64A4\u4E0E\u6B62\u635F\u8BB0\u5F55\uFF0C\u6863\u4F4D\u672A\u77E5\uFF1Bops-alerts \u4E8B\u4EF6\u8BA1\u6570\u5982\u4E0A"
    };
  }
  const stats = opts.stats;
  const ddNow = Math.abs(Number.isFinite(stats?.drawdown) ? stats.drawdown : 0);
  const ddTier2 = ddNow >= DD_TIER_EDGES[1] ? 2 : ddNow >= DD_TIER_EDGES[0] ? 1 : 0;
  const logs = Array.isArray(input.paperAccount?.logs) ? input.paperAccount.logs : [];
  const stopHit = logs.some((l) => l && l.date === input.tradeDate && (l.stage === "stop" || l.stage === "risk") && l.result === "rejected");
  return {
    dd_tier: ddTier2,
    hard_stop_triggered: stopHit,
    risk_events: riskEvents,
    note: `\u5373\u65F6\u8F68\uFF1A\u8FD0\u884C\u56DE\u64A4 ${(ddNow * 100).toFixed(2)}%\uFF0C\u8DDD\u6863\u4F4D\u8FB9\u754C\u89C1 drawdown_vs_threshold\uFF1B\u5355\u7B14\u6B62\u635F/\u98CE\u63A7\u62E6\u622A\u5F53\u65E5 ${stopHit ? "\u6709" : "\u65E0"}`
  };
}
function buildMarketContext(signals) {
  const latest = pick2(signals, "latest");
  if (!latest) return null;
  const verdict = (p, k) => pick2(signals, `${p}.verdict.${k}`) ?? null;
  const breadthDetail = pick2(signals, "breadth.snapshot.verdict.detail") ?? pick2(signals, "breadth.snapshot.verdict.label");
  return {
    emotion: num(pick2(signals, "signals.latestEmotion.value")),
    pct_rank: num(latest.pct_rank),
    indexes: latest.indexes && typeof latest.indexes === "object" ? latest.indexes : null,
    up_down: Number.isFinite(latest.up_count) ? `${latest.up_count}/${latest.down_count}/${latest.flat_count}` : null,
    amount_yi: num(latest.amount_yi),
    zt_dt: Number.isFinite(latest.zt_count) ? `${latest.zt_count}/${latest.dt_count}` : null,
    breadth: breadthDetail ?? null,
    pain: verdict("pain", "label") ?? verdict("pain", "reason"),
    seats: verdict("seats", "label")
  };
}
var INTRADAY_MARKET_FRESH_MS = 25 * 60 * 1e3;
function freshIntradayMarket(snapshot, nowISO) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const now = nowISO ? new Date(nowISO) : /* @__PURE__ */ new Date();
  const today = bjDate(now);
  if (snapshot.tradeDate !== today) return null;
  if (!snapshot.breadth || !Number.isFinite(snapshot.breadth.up)) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(snapshot.capturedAtBJ || "");
  if (!m) return null;
  const capMs = bjInstant(m[1], m[2]);
  const nowMs = bjInstant(today, bjTime(now));
  if (!Number.isFinite(capMs) || !Number.isFinite(nowMs)) return null;
  if (capMs > nowMs || nowMs - capMs > INTRADAY_MARKET_FRESH_MS) return null;
  const failed = Array.isArray(snapshot.sourcesFailed) ? snapshot.sourcesFailed : [];
  if (failed.some((e) => /breadth|快照|snapshot|snapshotSource/i.test(String(e)))) return null;
  return { breadth: snapshot.breadth, pools: snapshot.pools || null };
}
var FIELD_SOURCE_DEFAULTS = {
  date: "derived",
  status: "derived",
  pnl_daily: "archived",
  pnl_cumulative: "archived",
  max_drawdown_daily: "live",
  grid_triggers: "missing",
  counter_trend_losses: "missing",
  trend_switch_hits: "archived",
  cost_ratio: "live",
  slippage_avg: "assumed",
  slippage_source: "derived",
  regime: "archived",
  circuit_breaker: "archived",
  overseas: "archived",
  prev_nav: "derived",
  positions: "archived",
  overnight_exposure: "archived",
  key_levels: "missing",
  events_today: "missing",
  atr: "missing",
  suggested_step: "missing",
  nav_realtime: "live",
  approx: "derived",
  drawdown_vs_threshold: "derived",
  fee_total: "live",
  slippage_total: "live",
  net_pnl: "live",
  grid_trigger_detail: "missing",
  counter_trend_loss_ratio: "missing",
  max_drawdown_intraday: "live",
  close_drawdown: "archived",
  backtest_deviation: "derived",
  market_context: "archived",
  ma20_degraded: "derived",
  week_return: "derived",
  nav_series: "archived",
  max_drawdown_week: "derived",
  win_rate: "live",
  win_rate_note: "derived",
  profit_trade_ratio: "live",
  cost_ratio_week: "live",
  trend_switch_effect: "archived",
  param_suggestions: "archived"
};
var CONFIDENCE_BY_SOURCE = { assumed: "assumed", missing: "missing" };
function buildDataCompleteness(payload, overrides = {}) {
  const out2 = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v == null) {
      out2[k] = { source: "missing", confidence: "missing" };
      continue;
    }
    const source = overrides[k] ?? FIELD_SOURCE_DEFAULTS[k] ?? "derived";
    out2[k] = { source, confidence: CONFIDENCE_BY_SOURCE[source] ?? "measured" };
  }
  return out2;
}
function envelope({ type, trigger, date, generatedAt, generatedBy, payload, input, extraNotes = [], sourceOverrides = {}, simulationStock = null }) {
  if (!REPORT_TYPES.includes(type)) throw new Error(`\u975E\u6CD5 report_type: ${type}`);
  if (!TRIGGER_ENUM.includes(trigger)) throw new Error(`\u975E\u6CD5 trigger: ${trigger}\uFF08urgent \u89E6\u53D1\u6761\u4EF6\u9650\u5B9A\u56DB\u7C7B\uFF0C\u51B3\u8BAE 3\uFF09`);
  const status = deriveStatus(input, payload);
  payload.simulation_stock = simulationStock ?? null;
  payload.ma20_degraded = pick2(input, "signals.latest.factors.s_amt") == null;
  const base = BASE_MISSING_NOTES;
  const notes = [...base, ...extraNotes];
  if (!input.live) notes.push(LIVE_ONLY_NOTE);
  return {
    schema_version: SCHEMA_VERSION,
    report_type: type,
    trigger,
    urgent: trigger !== "schedule",
    date,
    generated_at: generatedAt,
    generated_by: generatedBy === "browser" ? "browser" : "ci",
    status,
    track: "A",
    data_health: { sources: input.sources },
    data_completeness: buildDataCompleteness(payload, sourceOverrides),
    payload: { ...payload, status },
    missing_notes: notes,
    concepts: CONCEPTS,
    sources: SOURCE_REFS,
    disclaimer: AI_REPORT_DISCLAIMER
  };
}
function buildBase(input, opts = {}) {
  const day = pick2(input, "dualTrack.day");
  const summary = pick2(input, "dualTrack.summary");
  const ext = validateExternal(input.global, { today: todayBeijing() });
  const payload = {
    date: input.tradeDate,
    ...structuralNulls(),
    pnl_daily: num(pick2(day, "dayReturns.A")),
    pnl_cumulative: num(pick2(summary, "trackA.total")),
    max_drawdown_daily: null,
    // 恒 null 底座：盘中报告由 generateIntraday 注入（opts.drawdownDaily，S3-1），其余类型无日内语义不造数
    trend_switch_hits: input.tradeDate ? turnsIn(input, input.tradeDate, input.tradeDate).length : null,
    cost_ratio: null,
    slippage_avg: DEFAULT_SLIP,
    // 归档轨假设常量（口径唯一出处 src/paper.js）
    slippage_source: "assumed_constant",
    regime: buildRegime(input),
    circuit_breaker: null,
    overseas: buildOverseas(input.global, ext),
    externalStale: ext.alerts
    // 恒为数组（可能空），不入 status 降级判定
  };
  const overrides = {};
  if (input.live) {
    const acct = input.paperAccount;
    const stats = accountStats(acct);
    opts.stats = stats;
    const nav = Array.isArray(acct.nav) ? acct.nav.filter((n) => n && Number.isFinite(n.equity)) : [];
    const last = nav[nav.length - 1];
    if (nav.length >= 2 && last && last.date === input.tradeDate) {
      const prev = nav[nav.length - 2];
      payload.pnl_daily = (last.equity - prev.equity) / prev.equity;
      overrides.pnl_daily = "live";
      payload.pnl_cumulative = Number.isFinite(stats.ret) ? stats.ret : payload.pnl_cumulative;
      overrides.pnl_cumulative = "live";
      const tradesToday = (Array.isArray(acct.trades) ? acct.trades : []).filter((t) => t && t.date === input.tradeDate);
      const fee = tradesToday.reduce((a, t) => a + (Number.isFinite(t.fee) ? t.fee : 0), 0);
      const gross = tradesToday.reduce((a, t) => a + Math.abs(Number.isFinite(t.gross) ? t.gross : 0), 0);
      if (tradesToday.length) {
        payload.cost_ratio = gross > 0 ? fee / gross : null;
        overrides.cost_ratio = "live";
        payload.fee_total = fee;
        overrides.fee_total = "live";
        payload.net_pnl = last.equity - prev.equity;
        overrides.net_pnl = "live";
      }
      const filled = (Array.isArray(acct.orders) ? acct.orders : []).filter((o) => o && o.status === "filled" && o.settleDate === input.tradeDate && Number.isFinite(o.estPrice));
      const byCode = new Map(tradesToday.filter((t) => t.code).map((t) => [t.code, t]));
      const slips = filled.map((o) => {
        const t = byCode.get(o.code);
        return t && Number.isFinite(t.px) ? Math.abs(t.px - o.estPrice) / o.estPrice : null;
      }).filter((v) => v != null);
      if (slips.length) {
        payload.slippage_avg = slips.reduce((a, b) => a + b, 0) / slips.length;
        payload.slippage_source = "measured";
        overrides.slippage_avg = "live";
      }
    }
    payload.nav_realtime = Number.isFinite(stats.total) ? stats.total : null;
    overrides.nav_realtime = "live";
  }
  payload.circuit_breaker = buildCircuitBreaker(input, { stats: opts.stats });
  return { payload, overrides, ext };
}
function generateIntraday(input, opts = {}) {
  const { payload, overrides, ext } = buildBase(input);
  if (payload.market_context == null) payload.market_context = buildMarketContext(input.signals);
  if (payload.market_context) payload.market_context.highest_chain = num(pick2(input, "signals.pain.advance.maxLb"));
  if (!input.live) payload.nav_realtime = null;
  payload.max_drawdown_daily = input.live ? num(opts.drawdownDaily) : null;
  const extraNotes = [];
  const intraFresh = freshIntradayMarket(input.intraday, opts.generatedAt || (/* @__PURE__ */ new Date()).toISOString());
  if (payload.market_context) {
    if (intraFresh) {
      payload.market_context.up_down = `${intraFresh.breadth.up}/${intraFresh.breadth.down}/${intraFresh.breadth.flat}`;
      payload.market_context.zt_dt = intraFresh.pools && Number.isFinite(intraFresh.pools.zt) && Number.isFinite(intraFresh.pools.dt) ? `${intraFresh.pools.zt}/${intraFresh.pools.dt}` : payload.market_context.zt_dt;
      payload.market_context.breadth_stale = false;
    } else {
      payload.market_context.up_down = null;
      payload.market_context.zt_dt = null;
      payload.market_context.breadth_stale = true;
      extraNotes.push({
        field: "market_context.up_down",
        reason: "\u76D8\u4E2D\u5B9E\u65F6\u6DA8\u8DCC\u5BB6\u6570\u5FEB\u7167\u7F3A\u5931/\u8DE8\u4EA4\u6613\u65E5/\u91C7\u96C6\u6EDE\u540E/\u6E90\u5931\u8D25\u2014\u2014\u5DF2\u9690\u85CF\u9648\u65E7 EOD \u503C\uFF0C\u5B81\u53EF\u4E0D\u62A5\u4E5F\u4E0D\u7CCA\u5F04",
        ref: "src/ai_report.js::generateIntraday"
      });
    }
  }
  const fbUsed = input.intraday?.dataHealth?.fallbackUsed;
  if (Array.isArray(fbUsed) && fbUsed.length && payload.market_context) {
    payload.market_context.fallbackUsed = fbUsed;
    payload.market_context.fallbackFromAt = input.intraday?.capturedAt ?? null;
  }
  if (input.live && payload.max_drawdown_daily == null) {
    extraNotes.push({ field: "max_drawdown_daily", reason: "\u5373\u65F6\u8F68\u5F53\u65E5\u6743\u76CA\u5E8F\u5217\u4E0D\u8DB3\u4E24\u70B9\uFF08\u91C7\u6837\u521A\u542F\u52A8/\u5B9E\u65F6\u884C\u60C5\u964D\u7EA7\uFF09\uFF0C\u65E0\u65E5\u5185\u56DE\u64A4\u8BED\u4E49", ref: "src/intraday_live.js::dailyDrawdown" });
  }
  payload.approx = false;
  const stats = opts.stats ?? (input.live ? accountStats(input.paperAccount) : null);
  const ddNow = input.live && Number.isFinite(stats?.drawdown) ? Math.abs(stats.drawdown) : num(pick2(input, "dualTrack.summary.trackA.maxDd"));
  const nearest = DD_TIER_EDGES.find((e) => e >= (ddNow ?? 0)) ?? DD_TIER_EDGES[DD_TIER_EDGES.length - 1];
  payload.drawdown_vs_threshold = {
    dd_now: ddNow,
    tier_edges: DD_TIER_EDGES,
    distance_pp: ddNow != null ? Math.round(((nearest - ddNow) * 100 + Number.EPSILON) * 100) / 100 : null,
    // 全中文（2026-10-10 用户指令）：字段名 trackA.maxDd 不进推送文案——运行回撤语义不变
    basis: input.live ? "\u5373\u65F6\u8F68\xB7\u8FD0\u884C\u56DE\u64A4" : "\u5F52\u6863\u8F68\xB7\u8FD0\u884C\u56DE\u64A4\uFF08\u975E\u5F53\u65E5\uFF09"
  };
  const intraDate = pick2(input, "intraday.tradeDate") ?? null;
  return envelope({
    type: "intraday",
    trigger: opts.trigger || "schedule",
    date: intraDate ?? input.tradeDate,
    generatedAt: opts.generatedAt || (/* @__PURE__ */ new Date()).toISOString(),
    generatedBy: opts.generatedBy,
    payload,
    input: { ...input, sources: { ...input.sources, intraday: sourceHealth(input.intraday, null, null) } },
    extraNotes,
    sourceOverrides: overrides,
    simulationStock: opts.simulationStock ?? null
  });
}
var PHASE_LABELS = { startup: "\u542F\u52A8\u671F", fermentation: "\u53D1\u9175\u671F", climax: "\u9AD8\u6F6E\u671F", decline: "\u9000\u6F6E\u671F", freezing: "\u51B0\u70B9\u671F" };
var PHASE_ENUM = Object.keys(PHASE_LABELS);
var _poolFilters = config_default?.params?.live?.poolFilters || {};
var INTRADAY_POOL_FILTERS = _poolFilters.intraday || { chg_min: 3, chg_max: 7, liangbi_min: 2, top: 10 };
var STREAK_POOL_FILTERS = _poolFilters.streak || { min_lb: 2, liangbi_min: 2, main_net_min: 0, top: 10 };
var STREAK_POOL_MIN_LB = STREAK_POOL_FILTERS.min_lb;

// src/report_card_live.js
var INTRADAY_TTL_MS = 30 * 60 * 1e3;
var DAY_SOURCES = [
  ["dualTrack", "data/paper/dual_track_latest.json"],
  ["signals", "data/signals-latest.json"],
  ["global", "data/global.json"],
  ["backtest", "data/backtest.json"],
  ["opsAlerts", "data/ops-alerts-latest.json"]
];
var dayCache = null;
var intradayCache = null;
function resetReportCardCache() {
  dayCache = null;
  intradayCache = null;
}
var defaultGetJson = async (url) => {
  const res = await fetch(url + "?_=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.json();
};
async function buildLiveReport(live, io = {}) {
  const getJson = io.getJson || defaultGetJson;
  const now = io.now || (() => Date.now());
  const today = io.today || bjDate;
  if (!live || !live.account || typeof live.account !== "object") return null;
  const dayKey = today();
  const needDay = !dayCache || dayCache.dayKey !== dayKey;
  const needIntraday = !intradayCache || now() - intradayCache.at > INTRADAY_TTL_MS;
  if (needDay || needIntraday) {
    const jobs = [];
    const keys = [];
    if (needDay) for (const [k, url] of DAY_SOURCES) {
      jobs.push(getJson(url));
      keys.push(k);
    }
    if (needIntraday) {
      jobs.push(getJson("data/intraday.json"));
      keys.push("__intraday__");
    }
    let results;
    try {
      results = await Promise.all(jobs);
    } catch {
      return null;
    }
    const next = needDay ? { dayKey, data: {} } : null;
    results.forEach((v, i) => {
      const k = keys[i];
      if (k === "__intraday__") intradayCache = { at: now(), data: v };
      else next.data[k] = v;
    });
    if (next) dayCache = next;
  }
  const input = buildInput({
    ...dayCache.data,
    intraday: intradayCache.data,
    paperAccount: live.account
  });
  return generateIntraday(input, {
    drawdownDaily: live.drawdownDaily,
    stats: live.stats,
    generatedBy: "browser",
    trigger: "schedule"
  });
}
function cardData(env) {
  if (!env || typeof env !== "object" || !env.payload) return null;
  const p = env.payload;
  const dd = p.drawdown_vs_threshold || {};
  return {
    date: p.date ?? null,
    generatedAt: env.generated_at ?? null,
    generatedBy: env.generated_by ?? null,
    status: p.status ?? null,
    navRealtime: p.nav_realtime ?? null,
    maxDrawdownDaily: p.max_drawdown_daily ?? null,
    pnlDaily: p.pnl_daily ?? null,
    pnlCumulative: p.pnl_cumulative ?? null,
    ddNow: dd.dd_now ?? null,
    tierEdges: dd.tier_edges ?? null,
    distancePp: dd.distance_pp ?? null,
    basis: dd.basis ?? null,
    trendSwitchHits: p.trend_switch_hits ?? null,
    overseas: p.overseas ?? null,
    missingNotes: Array.isArray(env.missing_notes) ? env.missing_notes : [],
    // generated_by 'browser' = 浏览器即时估值轨 → 卡面必须标注"估值非结算"
    isValuation: env.generated_by === "browser"
  };
}

// src/dataset.js
var dataset_exports = {};
__export(dataset_exports, {
  CELL: () => CELL,
  DATASETS: () => DATASETS,
  buildCsv: () => buildCsv,
  buildDataset: () => buildDataset,
  buildSpreadsheetXml: () => buildSpreadsheetXml,
  cellText: () => cellText,
  csvField: () => csvField,
  datasetById: () => datasetById,
  datasetFileName: () => datasetFileName,
  datasetMeta: () => datasetMeta,
  exportAsCsv: () => exportAsCsv,
  exportAsExcel: () => exportAsExcel,
  exportManifest: () => exportManifest,
  has: () => has,
  sheetName: () => sheetName
});
var CELL = Object.freeze({ NUM: "num", TXT: "txt" });
function pick3(obj, path3) {
  if (!obj) return void 0;
  let cur = obj;
  for (const k of String(path3).split(".")) {
    if (cur == null || typeof cur !== "object") return void 0;
    cur = cur[k];
  }
  return cur;
}
function has(v) {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
function cellText(v, type) {
  if (!has(v)) return "";
  if (typeof v === "boolean") return v ? "\u662F" : "\u5426";
  if (type === CELL.NUM) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return "";
    return String(Math.round(n * 1e6) / 1e6);
  }
  return String(v);
}
function csvField(s) {
  const t = String(s == null ? "" : s);
  return /[",\r\n]|^\s|\s$/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
function buildCsv(columns, rows, opts = {}) {
  const cols = Array.isArray(columns) ? columns : [];
  const list = Array.isArray(rows) ? rows : [];
  const lines = [];
  const meta = opts.meta || {};
  for (const [k, v] of Object.entries(meta)) {
    if (!has(v)) continue;
    lines.push("# " + csvField(k + "\uFF1A" + String(v)));
  }
  lines.push(cols.map((c) => csvField(c.label)).join(","));
  for (const r of list) {
    lines.push(cols.map((c) => csvField(cellText(pick3(r, c.key), c.type || CELL.TXT))).join(","));
  }
  const body = lines.join("\r\n") + "\r\n";
  return (opts.bom === false ? "" : "\uFEFF") + body;
}
function datasetFileName(base, ext, stamp) {
  const s = String(stamp || "").replace(/[^\dA-Za-z-]/g, "") || "unknown";
  return `${base}-${s}.${ext}`;
}
function xmlEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}
function sheetName(s) {
  const t = String(s || "Sheet1").replace(/[:\\/?*[\]]/g, "_").slice(0, 31);
  return t || "Sheet1";
}
function buildSpreadsheetXml(sheets, opts = {}) {
  const list = Array.isArray(sheets) ? sheets : [];
  const meta = opts.meta || {};
  const metaRows = Object.entries(meta).filter(([, v]) => has(v));
  const out2 = [];
  out2.push('<?xml version="1.0" encoding="UTF-8"?>');
  out2.push('<?mso-application progid="Excel.Sheet"?>');
  out2.push('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
  out2.push(' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">');
  out2.push('<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EEEEEE" ss:Pattern="Solid"/></Style><Style ss:ID="txt"><NumberFormat ss:Format="@"/></Style></Styles>');
  for (const sh of list) {
    const cols = Array.isArray(sh.columns) ? sh.columns : [];
    const rows = Array.isArray(sh.rows) ? sh.rows : [];
    out2.push(`<Worksheet ss:Name="${xmlEsc(sheetName(sh.name))}"><Table>`);
    out2.push(cols.map((c) => {
      const w = Math.min(220, Math.max(60, String(c.label || "").length * 9 + 30));
      return `<Column ss:Width="${w}"/>`;
    }).join(""));
    if (metaRows.length) {
      out2.push('<Row ss:StyleID="txt">');
      metaRows.forEach(([k, v], i) => {
        if (i === 0) out2.push('<Cell ss:StyleID="txt"><Data ss:Type="String">' + xmlEsc(k + "\uFF1A" + String(v)) + "</Data></Cell>");
      });
      out2.push("</Row>");
    }
    out2.push('<Row ss:StyleID="hdr">');
    for (const c of cols) {
      out2.push('<Cell ss:StyleID="hdr"><Data ss:Type="String">' + xmlEsc(c.label) + "</Data></Cell>");
    }
    out2.push("</Row>");
    for (const r of rows) {
      out2.push("<Row>");
      for (const c of cols) {
        const t = cellText(pick3(r, c.key), c.type || CELL.TXT);
        if (t === "") {
          out2.push("<Cell/>");
          continue;
        }
        if ((c.type || CELL.TXT) === CELL.NUM) {
          out2.push(`<Cell><Data ss:Type="Number">${xmlEsc(t)}</Data></Cell>`);
        } else {
          out2.push(`<Cell ss:StyleID="txt"><Data ss:Type="String">${xmlEsc(t)}</Data></Cell>`);
        }
      }
      out2.push("</Row>");
    }
    out2.push("</Table></Worksheet>");
  }
  out2.push("</Workbook>");
  return out2.join("\n");
}
var D_DAILY = {
  id: "daily",
  label: "\u60C5\u7EEA\u5206\xB7\u9010\u65E5",
  fileBase: "sentiment-daily",
  note: "\u9010\u4EA4\u6613\u65E5\u60C5\u7EEA\u5206\u4E0E\u4E03\u4E2A\u56E0\u5B50\u3002\u56DE\u586B\u65E5\uFF08isBackfill=\u662F\uFF09\u7684\u60C5\u7EEA\u5206\u662F s_net \u5355\u56E0\u5B50\u5360\u4F4D\u503C\uFF0C\u4E0D\u662F\u7EFC\u5408\u5206\u2014\u2014\u6309\u6B64\u5217\u6392\u5E8F\u4F1A\u628A\u56DE\u586B\u65E5\u6392\u5230\u524D\u9762\uFF0C\u8BF7\u5148\u6309 isBackfill \u8FC7\u6EE4\u3002",
  columns: [
    { key: "trade_date", label: "\u4EA4\u6613\u65E5" },
    { key: "value", label: "\u60C5\u7EEA\u5206", type: CELL.NUM },
    { key: "pct_rank", label: "\u5386\u53F2\u5206\u4F4D%", type: CELL.NUM },
    { key: "net_daily_pct_rank", label: "\u51C0\u4E70\u5206\u4F4D%", type: CELL.NUM },
    { key: "s_net", label: "s_net \u8D44\u91D1", type: CELL.NUM },
    { key: "s_pos", label: "s_pos \u6DA8\u8DCC", type: CELL.NUM },
    { key: "s_brd", label: "s_brd \u5E7F\u5EA6", type: CELL.NUM },
    { key: "s_hot", label: "s_hot \u70ED\u5EA6", type: CELL.NUM },
    { key: "s_zdt", label: "s_zdt \u6DA8\u505C\u8DCC\u505C", type: CELL.NUM },
    { key: "s_zbl", label: "s_zbl \u5C01\u677F", type: CELL.NUM },
    { key: "s_amt", label: "s_amt \u91CF\u80FD", type: CELL.NUM },
    { key: "missing_count", label: "\u7F3A\u5931\u56E0\u5B50\u6570", type: CELL.NUM },
    { key: "imputedRatio", label: "\u8865\u4F4D\u7387", type: CELL.NUM },
    { key: "isBackfill", label: "\u56DE\u586B\u65E5" },
    { key: "zt_count", label: "\u6DA8\u505C\u6570", type: CELL.NUM },
    { key: "dt_count", label: "\u8DCC\u505C\u6570", type: CELL.NUM },
    { key: "zb_count", label: "\u70B8\u677F\u6570", type: CELL.NUM },
    { key: "seal_pct", label: "\u5C01\u677F\u7387%", type: CELL.NUM },
    { key: "up_count", label: "\u4E0A\u6DA8\u5BB6\u6570", type: CELL.NUM },
    { key: "down_count", label: "\u4E0B\u8DCC\u5BB6\u6570", type: CELL.NUM },
    { key: "amount_yi", label: "\u6210\u4EA4\u989D(\u4EBF)", type: CELL.NUM },
    { key: "lhb_daily_net", label: "\u9F99\u864E\u51C0\u4E70(\u4E07)", type: CELL.NUM },
    { key: "ind_count", label: "\u884C\u4E1A\u6570", type: CELL.NUM },
    { key: "main_theme", label: "\u4E3B\u7EBF\u9898\u6750" }
  ],
  rows(arc) {
    return (arc && arc.all_days || []).map((d) => {
      const e = d.emotion || {}, s = d.summary || {};
      return {
        trade_date: d.trade_date,
        value: e.value ?? e.score,
        pct_rank: e.pct_rank,
        net_daily_pct_rank: e.net_daily_pct_rank,
        s_net: e.s_net,
        s_pos: e.s_pos,
        s_brd: e.s_brd,
        s_hot: e.s_hot,
        s_zdt: e.s_zdt,
        s_zbl: e.s_zbl,
        s_amt: e.s_amt,
        missing_count: Array.isArray(e.missing) ? e.missing.length : void 0,
        imputedRatio: e.imputedRatio,
        isBackfill: !!e._backfill,
        zt_count: s.zt_count,
        dt_count: s.dt_count,
        zb_count: s.zb_count,
        seal_pct: s.seal_pct,
        up_count: s.up_count,
        down_count: s.down_count,
        amount_yi: s.amount_yi,
        lhb_daily_net: s.lhb_daily_net,
        ind_count: s.ind_count,
        main_theme: s.main_theme
      };
    });
  }
};
var D_HOT = {
  id: "hot",
  label: "\u4E2A\u80A1\u660E\u7EC6",
  fileBase: "stock-detail",
  note: "\u5F53\u65E5\u5F3A\u52BF\u80A1\u5F52\u56E0\u6E05\u5355\uFF08\u4E0E\u9875\u9762\u300C\u5F3A\u52BF\u80A1\u5F52\u56E0\u300D\u8868\u540C\u6E90\uFF09\u3002\u6DA8\u8DCC\u5E45\u4E3A\u5F53\u65E5\u6536\u76D8\u53E3\u5F84\u3002",
  columns: [
    { key: "trade_date", label: "\u4EA4\u6613\u65E5" },
    { key: "code", label: "\u4EE3\u7801" },
    { key: "name", label: "\u540D\u79F0" },
    { key: "change_pct", label: "\u6DA8\u8DCC\u5E45%", type: CELL.NUM },
    { key: "close", label: "\u6536\u76D8\u4EF7", type: CELL.NUM },
    { key: "huanshou", label: "\u6362\u624B\u7387%", type: CELL.NUM },
    { key: "reason", label: "\u4E0A\u699C\u8BF1\u56E0" }
  ],
  rows(arc) {
    const d = lastDayOf(arc);
    if (!d) return [];
    return (d.hot || []).map((h) => ({ trade_date: d.trade_date, ...h }));
  }
};
var D_LHB = {
  id: "lhb",
  label: "\u9F99\u864E\u699C\u8D44\u91D1",
  fileBase: "lhb-daily",
  note: "\u6309\u4EE3\u7801\u805A\u5408\u540E\u7684\u9F99\u864E\u699C\u8D44\u91D1\u3002caliber=daily \u4E3A\u5F53\u65E5\u699C\uFF08\u6743\u5A01\u53E3\u5F84\uFF09\uFF0Crange \u4E3A\u533A\u95F4\u7D2F\u8BA1\u699C\uFF08\u6210\u4EA4\u989D\u662F\u533A\u95F4\u7D2F\u8BA1\u503C\uFF0C\u4E0D\u53EF\u4E0E\u5F53\u65E5\u699C\u76F8\u52A0\uFF09\u3002",
  columns: [
    { key: "trade_date", label: "\u4EA4\u6613\u65E5" },
    { key: "code", label: "\u4EE3\u7801" },
    { key: "name", label: "\u540D\u79F0" },
    { key: "caliber", label: "\u53E3\u5F84" },
    { key: "close", label: "\u6536\u76D8\u4EF7", type: CELL.NUM },
    { key: "change_pct", label: "\u6DA8\u8DCC\u5E45%", type: CELL.NUM },
    { key: "net_buy_wan", label: "\u51C0\u4E70(\u4E07)", type: CELL.NUM },
    { key: "buy_wan", label: "\u4E70\u5165(\u4E07)", type: CELL.NUM },
    { key: "sell_wan", label: "\u5356\u51FA(\u4E07)", type: CELL.NUM },
    { key: "deal_wan", label: "\u6210\u4EA4(\u4E07)", type: CELL.NUM },
    { key: "turnover_pct", label: "\u6362\u624B\u7387%", type: CELL.NUM },
    { key: "reason", label: "\u4E0A\u699C\u539F\u56E0" }
  ],
  rows(arc) {
    const d = lastDayOf(arc);
    if (!d) return [];
    const rows = Array.isArray(d.lhb_aggr) ? d.lhb_aggr : Array.isArray(d.lhb) ? d.lhb : [];
    return rows.map((r) => ({ trade_date: d.trade_date, ...r }));
  }
};
var D_THEMES = {
  id: "themes",
  label: "\u9898\u6750\u5206\u5E03",
  fileBase: "themes",
  note: "\u5F53\u65E5\u9898\u6750\u51FA\u73B0\u6B21\u6570\uFF08\u5DF2\u53BB\u566A\uFF0C\u4E0E\u9875\u9762\u300C\u6700\u65B0\u65E5\u9898\u6750\u300D\u540C\u6E90\uFF09\u3002",
  columns: [
    { key: "trade_date", label: "\u4EA4\u6613\u65E5" },
    { key: "theme", label: "\u9898\u6750" },
    { key: "count", label: "\u4E2A\u80A1\u6570", type: CELL.NUM }
  ],
  rows(arc) {
    const d = lastDayOf(arc);
    const t = d && d.themes || null;
    if (!t) return [];
    return Object.entries(t).map(([theme, count]) => ({ trade_date: d.trade_date, theme, count }));
  }
};
var D_INDUSTRY = {
  id: "industry",
  label: "\u884C\u4E1A\u6DA8\u8DCC\u5E45",
  fileBase: "industry",
  note: "\u5F53\u65E5\u5404\u884C\u4E1A\u6DA8\u8DCC\u5E45\uFF08\u540C\u82B1\u987A\u884C\u4E1A\u53E3\u5F84\uFF0C\u4E3B\u6E90\uFF09\u3002\u4E0E\u300C\u8DE8\u6E90\u4E92\u8BC1\u300D\u9762\u677F\u7684\u7B2C\u4E8C\u6E90\uFF08\u7533\u4E07\u4E8C\u7EA7\uFF09\u5206\u7C7B\u4F53\u7CFB\u4E0D\u540C\uFF0C\u4E24\u8005\u4E0D\u53EF\u76F4\u63A5\u6BD4\u8F83\u3002",
  columns: [
    { key: "trade_date", label: "\u4EA4\u6613\u65E5" },
    { key: "name", label: "\u884C\u4E1A" },
    { key: "change_pct", label: "\u6DA8\u8DCC\u5E45%", type: CELL.NUM }
  ],
  rows(arc) {
    const d = lastDayOf(arc);
    if (!d) return [];
    return (d.industry || []).map((x) => ({ trade_date: d.trade_date, ...x }));
  }
};
var D_BREADTH = {
  id: "breadth",
  label: "\u5E02\u573A\u5BBD\u5EA6\xB7\u9010\u65E5",
  fileBase: "breadth",
  note: "\u5BBD\u5EA6\u7531\u5168\u5E02\u573A\u771F\u5B9E\u524D\u590D\u6743\u65E5K\u8BA1\u7B97\uFF08\u975E hot \u699C\u5355\u6837\u672C\uFF09\u3002\u6BD4\u4F8B\u4E3A\u7A7A\u7684\u542B\u4E49\u662F\u300C\u672A\u8BA1\u7B97\u300D\uFF08\u6837\u672C\u4E0D\u8DB3\u6216 PB \u6E90\u4E0D\u53EF\u7528\uFF09\uFF0C\u4E0D\u662F 0\u3002",
  columns: [
    { key: "date", label: "\u4EA4\u6613\u65E5" },
    { key: "scanned", label: "\u6709\u6548\u6837\u672C", type: CELL.NUM },
    { key: "maRatio", label: "\u7AD9\u4E0A20\u65E5\u7EBF", type: CELL.NUM },
    { key: "newHighRatio", label: "\u65B0\u9AD8\u5360\u6BD4", type: CELL.NUM },
    { key: "newLowRatio", label: "\u65B0\u4F4E\u5360\u6BD4", type: CELL.NUM },
    { key: "brokenRatio", label: "\u7834\u51C0\u7387", type: CELL.NUM },
    { key: "up", label: "\u4E0A\u6DA8\u5BB6\u6570", type: CELL.NUM },
    { key: "down", label: "\u4E0B\u8DCC\u5BB6\u6570", type: CELL.NUM },
    { key: "verdict", label: "\u7ED3\u8BBA" }
  ],
  rows(_arc, sig) {
    const b = sig && sig.breadth || null;
    if (!b) return [];
    const series = Array.isArray(b.series) ? b.series : [];
    if (series.length) return series;
    return b.snapshot ? [b.snapshot] : [];
  }
};
var D_XCHECK = {
  id: "crosscheck",
  label: "\u8DE8\u6E90\u4E92\u8BC1\xB7\u504F\u79BB\u884C\u4E1A",
  fileBase: "crosscheck",
  note: "\u4E3B\u6E90\uFF08\u540C\u82B1\u987A\u884C\u4E1A\uFF0C90 \u4E2A\uFF09\u4E0E\u7B2C\u4E8C\u6E90\uFF08\u7533\u4E07\u4E8C\u7EA7\uFF0C100 \u4E2A\uFF09\u7ECF\u522B\u540D\u8868\u5F52\u4E00\u5316\u540E\u7684\u53EF\u6BD4\u884C\u4E1A\u3002devPp \u662F**\u5DF2\u6263\u9664\u5E38\u6001\u7CFB\u7EDF\u6027\u504F\u79FB**\u540E\u7684\u504F\u5DEE\u3002\u672A\u88AB\u4E24\u4E2A\u6E90\u540C\u65F6\u8986\u76D6\u7684\u884C\u4E1A\u4E0D\u5728\u672C\u8868\u4E2D\u2014\u2014\u90A3\u662F\u300C\u672A\u6838\u5BF9\u300D\uFF0C\u4E0D\u662F\u300C\u4E00\u81F4\u300D\u3002",
  columns: [
    { key: "date", label: "\u4EA4\u6613\u65E5" },
    { key: "name", label: "\u884C\u4E1A" },
    { key: "primaryPct", label: "\u4E3B\u6E90%", type: CELL.NUM },
    { key: "secondaryPct", label: "\u7B2C\u4E8C\u6E90%", type: CELL.NUM },
    { key: "devPp", label: "\u53BB\u504F\u504F\u5DEE(pp)", type: CELL.NUM },
    { key: "kind", label: "\u5224\u5B9A" },
    { key: "reason", label: "\u8BF4\u660E" }
  ],
  rows(_arc, sig) {
    const x = sig && sig.crosscheck || null;
    if (!x) return [];
    return Array.isArray(x.flagged) ? x.flagged : [];
  }
};
var D_DIRTY = {
  id: "dirty",
  label: "\u6570\u636E\u8D28\u91CF\u7559\u75D5",
  fileBase: "data-quality",
  note: "\u5355\u6E90\u5185\u90E8\u6821\u9A8C\u7684\u7559\u75D5\u3002status=dirty \u8868\u793A\u8BE5\u5B57\u6BB5\u5DF2\u88AB\u6392\u9664\u5728\u56E0\u5B50\u5165\u53C2\u4E4B\u5916\uFF08\u539F\u503C\u4ECD\u4FDD\u7559\u5728\u6863\u91CC\uFF09\uFF1Bwarn \u8868\u793A\u4EC5\u6807\u8BB0\u9700\u4EBA\u5DE5\u590D\u6838\uFF0C\u672A\u5254\u9664\u4EFB\u4F55\u6570\u636E\u3002",
  columns: [
    { key: "date", label: "\u4EA4\u6613\u65E5" },
    { key: "status", label: "\u72B6\u6001" },
    { key: "field", label: "\u5B57\u6BB5" },
    { key: "rule", label: "\u89C4\u5219" },
    { key: "severity", label: "\u7EA7\u522B" },
    { key: "reason", label: "\u539F\u56E0" }
  ],
  rows(_arc, sig) {
    const dd = sig && sig.dirty || null;
    if (!dd) return [];
    const out2 = [];
    for (const r of Array.isArray(dd.recent) ? dd.recent : []) {
      const issues = Array.isArray(r.issues) && r.issues.length ? r.issues : [{}];
      for (const it of issues) {
        out2.push({
          date: r.date,
          status: r.status,
          field: it.field,
          rule: it.rule,
          severity: it.severity,
          reason: it.reason
        });
      }
    }
    return out2;
  }
};
var D_SEATS = {
  id: "seats",
  label: "\u8D44\u91D1\u5C5E\u6027\xB7\u9010\u65E5\u51C0\u4E70",
  fileBase: "seats-daily",
  note: "\u4E09\u7C7B\u5E2D\u4F4D\u9010\u65E5\u51C0\u4E70\uFF08\u4EBF\u5143\uFF09\u3002\u4EC5\u4E70\u65B9\u53E3\u5F84\u2014\u2014\u9501\u4ED3/\u65B0\u8FDB\u95EE\u7684\u662F\u300C\u4E70\u76D8\u662F\u4E0D\u662F\u8001\u9762\u5B54\u300D\u3002\u7A7A\u503C\uFF1D\u8BE5\u65E5\u65E0\u5E2D\u4F4D\u660E\u7EC6\u3002",
  columns: [
    { key: "date", label: "\u4EA4\u6613\u65E5" },
    { key: "instNet", label: "\u673A\u6784\u51C0\u4E70(\u4EBF)", type: CELL.NUM },
    { key: "northNet", label: "\u5317\u5411\u51C0\u4E70(\u4EBF)", type: CELL.NUM },
    { key: "hotNet", label: "\u6E38\u8D44\u51C0\u4E70(\u4EBF)", type: CELL.NUM }
  ],
  rows(_arc, sig) {
    const s = sig && sig.seats || null;
    if (!s) return [];
    return Array.isArray(s.series) ? s.series : [];
  }
};
var D_GLOBAL = {
  id: "global",
  label: "\u5916\u56F4\u884C\u60C5\xB7\u9694\u591C",
  fileBase: "global-quotes",
  note: "\u5916\u56F4\u54C1\u79CD\u9694\u591C\u884C\u60C5\u3002A \u80A1\u4F11\u5E02\u671F\u95F4\u7167\u5E38\u66F4\u65B0\uFF0C\u4E0E A \u80A1\u5B58\u6863\u8282\u594F\u4E0D\u540C\u3002",
  columns: [
    { key: "name", label: "\u54C1\u79CD" },
    { key: "code", label: "\u4EE3\u7801" },
    { key: "role", label: "\u89D2\u8272" },
    { key: "last", label: "\u6700\u65B0\u4EF7", type: CELL.NUM },
    { key: "prevClose", label: "\u524D\u6536", type: CELL.NUM },
    { key: "chg", label: "\u6DA8\u8DCC", type: CELL.NUM },
    { key: "chgPct", label: "\u6DA8\u8DCC\u5E45%", type: CELL.NUM },
    { key: "sessionDate", label: "\u4F1A\u8BDD\u65E5\u671F" },
    { key: "quoteTime", label: "\u62A5\u4EF7\u65F6\u95F4" },
    { key: "note", label: "\u8BF4\u660E" }
  ],
  rows(_arc, _sig, g) {
    const q = g && g.quotes || null;
    return Array.isArray(q) ? q.filter((x) => x && x.ok !== false) : [];
  }
};
var DATASETS = Object.freeze([
  D_DAILY,
  D_HOT,
  D_THEMES,
  D_INDUSTRY,
  D_BREADTH,
  D_SEATS,
  D_GLOBAL,
  D_LHB,
  D_XCHECK,
  D_DIRTY
]);
function datasetById(id) {
  return DATASETS.find((d) => d.id === id) || null;
}
function lastDayOf(arc) {
  const days = arc && arc.all_days || [];
  return days.length ? days[days.length - 1] : null;
}
function buildDataset(id, ctx = {}) {
  const def = datasetById(id);
  if (!def) return null;
  let rows = [];
  try {
    rows = def.rows(ctx.archive || null, ctx.signals || null, ctx.global || null) || [];
    rows = rows.filter((r) => r && Object.keys(r).length);
  } catch {
    rows = [];
  }
  return {
    id: def.id,
    label: def.label,
    fileBase: def.fileBase,
    columns: def.columns,
    rows,
    note: def.note,
    count: rows.length,
    empty: rows.length === 0
  };
}
function datasetMeta(ctx = {}) {
  const meta = ctx.archive && ctx.archive.meta || {};
  const sig = ctx.signals || {};
  const m = {
    \u6570\u636E\u65E5\u671F: meta.tradeDate || sig.meta && sig.meta.tradeDate || "",
    \u751F\u6210\u65F6\u523B: meta.generatedAt || sig.meta && sig.meta.generatedAt || "",
    \u516C\u5F0F\u7248\u672C: meta.formulaVersion || sig.meta && sig.meta.formulaVersion || "",
    \u6570\u636E\u65B0\u9C9C\u5EA6: meta.freshness && meta.freshness.state || "",
    \u7F3A\u5931\u8BED\u4E49: "\u7A7A\u5355\u5143\u683C\uFF1D\u672A\u8BA1\u7B97/\u65E0\u6570\u636E\uFF0C\u4E0D\u7B49\u4E8E 0",
    \u53E3\u5F84\u5F52\u5C5E: "A\u80A1\u60C5\u7EEA\u7CFB\u7EDF PRO \xB7 \u5BFC\u51FA\u4EF6\u4E0E\u9875\u9762\u540C\u6E90"
  };
  return m;
}
function exportAsCsv(id, ctx = {}) {
  const ds = buildDataset(id, ctx);
  if (!ds) return null;
  const text = buildCsv(ds.columns, ds.rows, { meta: datasetMeta(ctx) });
  return { ...ds, text, ext: "csv", mime: "text/csv", fileName: datasetFileName(ds.fileBase, "csv", ctx.archive?.meta?.tradeDate) };
}
function exportAsExcel(ids, ctx = {}) {
  const want = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  const sets = want.map((id) => buildDataset(id, ctx)).filter(Boolean);
  if (!sets.length) return null;
  const sheets = sets.map((s) => ({ name: s.label, columns: s.columns, rows: s.rows }));
  const text = buildSpreadsheetXml(sheets, { meta: datasetMeta(ctx) });
  const base = sets.length === 1 ? sets[0].fileBase : "sentiment-all";
  return {
    sets,
    text,
    ext: "xls",
    mime: "application/vnd.ms-excel",
    fileName: datasetFileName(base, "xls", ctx.archive?.meta?.tradeDate)
  };
}
function exportManifest(ctx = {}) {
  return DATASETS.map((d) => {
    const ds = buildDataset(d.id, ctx);
    return { id: d.id, label: d.label, count: ds ? ds.count : 0, empty: ds ? ds.empty : true };
  });
}

// src/error_boundary.js
var error_boundary_exports = {};
__export(error_boundary_exports, {
  LEVEL: () => LEVEL,
  LEVEL_LABEL: () => LEVEL_LABEL,
  REQUIRED_ON_BOOT: () => REQUIRED_ON_BOOT,
  classifyLoadError: () => classifyLoadError,
  classifyLoadResults: () => classifyLoadResults,
  needsBanner: () => needsBanner,
  nowFrame: () => nowFrame,
  renderBannerHtml: () => renderBannerHtml,
  renderFatalHtml: () => renderFatalHtml,
  runtimeErrorModel: () => runtimeErrorModel,
  staleBannerModel: () => staleBannerModel
});
var HOLIDAYS = [];
var LEVEL = Object.freeze({
  OK: "ok",
  DEGRADED: "degraded",
  STALE: "stale",
  FATAL: "fatal",
  UNKNOWN: "unknown"
});
var LEVEL_LABEL = Object.freeze({
  ok: "\u6B63\u5E38",
  degraded: "\u90E8\u5206\u964D\u7EA7",
  stale: "\u6570\u636E\u9648\u65E7",
  fatal: "\u52A0\u8F7D\u5931\u8D25",
  unknown: "\u672A\u8BC4\u4F30"
});
var SEVERITY = Object.freeze({ ok: 0, unknown: 1, degraded: 2, stale: 3, fatal: 4 });
function needsBanner(level) {
  return level === LEVEL.FATAL || level === LEVEL.STALE;
}
var REQUIRED_ON_BOOT = Object.freeze(["archive-index"]);
function classifyLoadError(what, err) {
  const key = String(what || "");
  const msg2 = err && err.message ? String(err.message) : String(err || "\u672A\u77E5\u9519\u8BEF");
  const required = REQUIRED_ON_BOOT.includes(key);
  return {
    level: required ? LEVEL.FATAL : LEVEL.DEGRADED,
    what: key,
    message: msg2,
    required,
    // 给用户的自查路径要**具体**（"请重试"不是指引，是敷衍）
    hint: required ? "\u9996\u5C4F\u6863\u6848\uFF08archive-index.json\uFF09\u662F\u552F\u4E00\u5FC5\u9700\u6863\uFF1A\u8BF7\u786E\u8BA4\u5B83\u5DF2\u751F\u6210\u5E76\u90E8\u7F72\uFF08\u91CD\u8DD1 node scripts/split_archive.mjs\uFF09\uFF0C\u6216\u70B9\u51FB\u300C\u21BB \u5237\u65B0\u300D\u91CD\u8BD5\u3002" : "\u8BE5\u533A\u5757\u4F9D\u8D56\u72EC\u7ACB\u6570\u636E\u6587\u4EF6\uFF0C\u7F3A\u5931\u53EA\u5F71\u54CD\u672C\u5361\uFF0C\u5176\u5B83\u533A\u5757\u7167\u5E38\u53EF\u7528\u3002"
  };
}
function classifyLoadResults(results) {
  const list = Array.isArray(results) ? results : [];
  const failed = list.filter((r) => r && r.ok === false);
  if (!failed.length) return { level: LEVEL.OK, failed: [], items: [] };
  const items = failed.map((r) => classifyLoadError(r.what, r.error));
  const worst = items.reduce((a, b) => SEVERITY[b.level] > SEVERITY[a.level] ? b : a, items[0]);
  return { level: worst.level, failed: failed.map((r) => r.what), items };
}
function nowFrame(now = /* @__PURE__ */ new Date(), opts = {}) {
  const t = now instanceof Date ? now : new Date(now);
  const valid = !Number.isNaN(t.getTime());
  return {
    iso: valid ? t.toISOString() : null,
    // 本地展示串（YYYY-MM-DD HH:MM）。刻意用本地时区——读者对齐的是自己手表。
    local: valid ? t.toISOString().replace("T", " ").slice(0, 16) : null,
    offline: !!opts.offline,
    offlineSince: opts.offlineSince || null
  };
}
function staleBannerModel(meta = {}, health = null, frame = {}, loadState = {}) {
  const m = meta || {};
  const f = m.freshness || null;
  const ls = loadState || {};
  const lsLevel = ls.level || LEVEL.OK;
  if (lsLevel === LEVEL.FATAL) {
    const it = (ls.items || []).find((x) => x.level === LEVEL.FATAL) || {};
    return {
      show: true,
      level: LEVEL.FATAL,
      chips: [{ kind: "fatal", text: "\u52A0\u8F7D\u5931\u8D25" }],
      lines: [
        it.message ? `\u65E0\u6CD5\u52A0\u8F7D\u5FC5\u9700\u6570\u636E\uFF1A${it.message}` : "\u65E0\u6CD5\u52A0\u8F7D\u5FC5\u9700\u6570\u636E\u3002",
        "\u9875\u9762**\u6CA1\u6709**\u53EF\u7528\u7ED3\u8BBA \u2014\u2014 \u7A7A\u767D\u4E0D\u7B49\u4E8E\u300C\u4ECA\u5929\u6CA1\u4EC0\u4E48\u53EF\u8BF4\u7684\u300D\u3002",
        it.hint || ""
      ].filter(Boolean),
      actions: ["\u91CD\u8BD5"]
    };
  }
  const chips = [];
  const lines = [];
  let recompute = null;
  if (f && f.publishDeadline && frame && frame.iso && Date.parse(f.publishDeadline) < Date.parse(frame.iso)) {
    recompute = assessFreshness({ tradeDate: m.tradeDate || f.tradeDate }, new Date(frame.iso), HOLIDAYS);
  }
  const behind = recompute ? recompute.behindSessions : f && Number.isFinite(+f.behindSessions) ? +f.behindSessions : 0;
  const isStale = !!m.stale || f && f.state === "behind" || recompute && recompute.state === "behind";
  const unknownFresh = !m.tradeDate || !f;
  if (isStale) {
    chips.push({ kind: "stale", text: "\u6570\u636E\u9648\u65E7" });
    lines.push(m.staleReason || `\u26A0 \u5DF2\u505C\u66F4 ${behind} \u4E2A\u4EA4\u6613\u65E5\uFF08\u6700\u8FD1\u5DF2\u6536\u76D8\u4EA4\u6613\u65E5 ${recompute?.latestClosed || f.latestClosed || "\u672A\u77E5"}\uFF09\u3002\u6570\u636E\u9648\u65E7\u672A\u66F4\u65B0\uFF0C\u8BF7\u52FF\u636E\u6B64\u64CD\u4F5C\u3002`);
    if (f && f.publishDeadline) {
      lines.push(`\u9884\u671F\u66F4\u65B0\u65F6\u523B ${String(f.publishDeadline).replace("T", " ").slice(0, 16)}\uFF08UTC\uFF09\u3002`);
    }
  } else if (unknownFresh) {
    chips.push({ kind: "unknown", text: "\u65B0\u9C9C\u5EA6\u672A\u8BC4\u4F30" });
    lines.push("\u6CA1\u6709\u65B0\u9C9C\u5EA6\u5224\u5B9A\u7ED3\u679C \u2014\u2014 \u8FD9\u662F\u300C\u6CA1\u68C0\u67E5\u300D\uFF0C\u4E0D\u7B49\u4E8E\u300C\u6570\u636E\u662F\u6700\u65B0\u7684\u300D\u3002");
  } else if (f && f.state === "pending") {
    chips.push({ kind: "pending", text: "\u7B49\u5F85\u66F4\u65B0" });
    lines.push("\u6570\u636E\u5C1A\u672A\u5230\u53D1\u5E03\u65F6\u95F4\uFF0C\u5C5E\u6B63\u5E38\u7B49\u5F85\uFF08\u975E\u6545\u969C\uFF09\u3002");
  } else if (f && f.state === "fresh") {
    chips.push({ kind: "fresh", text: "\u6570\u636E\u6700\u65B0" });
  }
  if (lsLevel === LEVEL.DEGRADED) {
    chips.push({ kind: "degraded", text: "\u90E8\u5206\u533A\u5757\u672A\u52A0\u8F7D" });
    lines.push(`\u672A\u52A0\u8F7D\uFF1A${(ls.failed || []).join("\u3001") || "\u672A\u77E5\u533A\u5757"}\uFF08\u53EA\u5F71\u54CD\u5BF9\u5E94\u5361\u7247\uFF0C\u5176\u5B83\u533A\u5757\u7167\u5E38\u53EF\u7528\uFF09\u3002`);
  }
  if (m.phase && m.phase !== "closed") {
    chips.push({ kind: "phase-" + m.phase, text: m.phase === "live" ? "\u76D8\u4E2D" : "\u5F00\u76D8\u524D" });
  }
  if (frame && frame.offline) {
    chips.push({ kind: "offline", text: "\u79BB\u7EBF" });
    lines.push(`\u5F53\u524D\u5904\u4E8E\u79BB\u7EBF\u72B6\u6001\uFF0C\u5C55\u793A\u7684\u662F\u6700\u8FD1\u4E00\u6B21\u6210\u529F\u7F13\u5B58\u7684\u6570\u636E\uFF08\u7F13\u5B58\u65F6\u523B ${frame.offlineSince || "\u672A\u77E5"}\uFF09\u3002\u884C\u60C5\u4E0D\u4F1A\u81EA\u52A8\u66F4\u65B0\uFF0C\u8BF7\u52FF\u636E\u6B64\u4E0B\u5355\u3002`);
  }
  if (health && health.level && health.level !== "ok" && health.items) {
    const bad = health.items.filter((i) => i.level && i.level !== "ok");
    if (bad.length) lines.push(`\u6570\u636E\u5065\u5EB7\uFF1A${bad.map((i) => i.label).join("\u3001")} \u9700\u5173\u6CE8\uFF08\u8BE6\u89C1\u300C\u6570\u636E\u5065\u5EB7\u300D\u9762\u677F\uFF09\u3002`);
  }
  const show = chips.some((c) => !/^(fresh)$/.test(c.kind)) || !!frame.offline;
  const level = isStale ? LEVEL.STALE : lsLevel === LEVEL.DEGRADED ? LEVEL.DEGRADED : unknownFresh ? LEVEL.UNKNOWN : LEVEL.OK;
  return {
    show,
    level,
    chips,
    lines: lines.filter(Boolean),
    actions: isStale ? ["\u5237\u65B0", "\u67E5\u770B\u6570\u636E\u5065\u5EB7"] : ["\u5237\u65B0"]
  };
}
function runtimeErrorModel(err, frame = {}) {
  const msg2 = err && err.message ? String(err.message) : typeof err === "string" ? err : "\u672A\u77E5\u8FD0\u884C\u671F\u9519\u8BEF";
  const stack = err && err.stack ? String(err.stack).split("\n").slice(0, 4).join("\n") : "";
  return {
    title: "\u9875\u9762\u8FD0\u884C\u51FA\u9519",
    level: LEVEL.DEGRADED,
    // 已渲染的内容仍在，不该整页清空
    message: msg2,
    stack,
    frame,
    lines: [
      "\u9875\u9762\u5DF2\u6E32\u67D3\u7684\u90E8\u5206\u4ECD\u7136\u53EF\u7528\uFF1B\u51FA\u9519\u7684\u662F\u540E\u7EED\u67D0\u4E00\u6B65\u6E32\u67D3\u3002",
      "\u82E5\u5185\u5BB9\u660E\u663E\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u70B9\u300C\u21BB \u5237\u65B0\u300D\u91CD\u8F7D\u6570\u636E\u3002",
      "\u672C\u6761\u9519\u8BEF\u4E0D\u6539\u53D8\u4EFB\u4F55\u5DF2\u5C55\u793A\u6570\u503C\u7684\u53E3\u5F84\u3002"
    ]
  };
}
function renderBannerHtml(model, esc2 = (s) => String(s == null ? "" : s)) {
  const b = model || {};
  if (!b.show) return "";
  const chips = (b.chips || []).map((c) => `<span class="ob-chip ${esc2(c.kind)}">${esc2(c.text)}</span>`).join("");
  const lines = (b.lines || []).map((l) => `<div class="ob-line">${esc2(l)}</div>`).join("");
  return `<div class="ob-inner ob-${esc2(b.level || "unknown")}"><div class="ob-head">${chips}</div><div class="ob-lines">${lines}</div><div class="ob-note">\u6570\u636E\u4EC5\u4F9B\u53C2\u8003\uFF0C\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE\u3002</div></div>`;
}
function renderFatalHtml(info, esc2 = (s) => String(s == null ? "" : s)) {
  const i = info || {};
  return `<div class="fatal-card"><div class="fc-title">\u26A0 \u9996\u5C4F\u6570\u636E\u52A0\u8F7D\u5931\u8D25</div><div class="fc-msg">${esc2(i.message || "\u672A\u77E5\u9519\u8BEF")}</div><div class="fc-hint">${esc2(i.hint || "")}</div><div class="fc-note">\u9875\u9762**\u6CA1\u6709**\u663E\u793A\u4EFB\u4F55\u7ED3\u8BBA \u2014\u2014 \u8FD9\u662F\u300C\u6CA1\u6709\u6570\u636E\u300D\uFF0C\u4E0D\u662F\u300C\u4ECA\u5929\u6CA1\u4EC0\u4E48\u53EF\u8BF4\u7684\u300D\u3002\u8BF7\u4E0D\u8981\u628A\u7A7A\u767D\u7406\u89E3\u6210\u4EFB\u4F55\u884C\u60C5\u542B\u4E49\u3002\u672C\u7CFB\u7EDF\u6240\u6709\u5185\u5BB9\u4EC5\u4F9B\u53C2\u8003\uFF0C\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE\u3002</div><button class="mini primary" type="button" data-act="retry-boot">\u91CD\u8BD5\u52A0\u8F7D</button></div>`;
}

// src/relative.js
var REL_BASE = {
  INDEX: "index",
  // vs 上证指数（大盘超额）
  MEDIAN: "median"
  // vs 全行业涨幅中位数（板块内超额）
};
var REL_BASE_LABEL = {
  [REL_BASE.INDEX]: "\u4E0A\u8BC1\u6307\u6570",
  [REL_BASE.MEDIAN]: "\u884C\u4E1A\u4E2D\u4F4D\u6570"
};
var REL_SIDE = {
  ATTACK: "attack",
  // 超额进攻：相对基准最强的 N 个行业
  DEFENSE: "defense"
  // 超额防御：相对基准最弱的 N 个行业（跌得比基准多的那些）
};
var REL_SIDE_LABEL = {
  [REL_SIDE.ATTACK]: "\u8D85\u989D\u8FDB\u653B",
  [REL_SIDE.DEFENSE]: "\u8D85\u989D\u9632\u5FA1"
};

// src/ztpool_window.js
var isNode3 = typeof process !== "undefined" && !!(process.versions && process.versions.node) && typeof window === "undefined";
var readFileSync5 = null;
var existsSync5 = null;
var join4 = null;
if (isNode3) {
  ({ readFileSync: readFileSync5, existsSync: existsSync5 } = await Promise.resolve().then(() => (init_node_fs(), node_fs_exports)));
  join4 = (await Promise.resolve().then(() => (init_node_path(), node_path_exports))).join;
}

// src/zt_rebuild.js
var isNode4 = typeof process !== "undefined" && !!(process.versions && process.versions.node) && typeof window === "undefined";
var readFileSync6 = null;
var readdirSync = null;
var path2 = null;
if (isNode4) {
  ({ readFileSync: readFileSync6, readdirSync } = await Promise.resolve().then(() => (init_node_fs(), node_fs_exports)));
  path2 = await Promise.resolve().then(() => (init_node_path(), node_path_exports));
}

// src/sources.js
var isNode5 = typeof process !== "undefined" && !!(process.versions && process.versions.node) && typeof window === "undefined";
var ROOT2 = "";
if (isNode5) {
  const { fileURLToPath: fileURLToPath4 } = await Promise.resolve().then(() => (init_node_url(), node_url_exports));
  const path3 = await Promise.resolve().then(() => (init_node_path(), node_path_exports));
  ROOT2 = path3.resolve(path3.dirname(fileURLToPath4(import.meta.url)), "..");
}
function quoteSymbol(code) {
  const c = String(code ?? "").trim();
  if (!/^\d{6}$/.test(c)) return null;
  if (c[0] === "6" || c.startsWith("900")) return "sh" + c;
  if (c[0] === "0" || c[0] === "3" || c[0] === "2") return "sz" + c;
  if (c[0] === "4" || c[0] === "8" || c.startsWith("92")) return "bj" + c;
  return null;
}
var RANK_WINDOW = config_default.lookback.rankWindow;
var RANK_MIN = config_default.lookback.rankMin;

// src/quote.js
var QUOTE_ENDPOINT = "https://qt.gtimg.cn/q=";
var BATCH_SIZE = 60;
var SESSIONS = [
  [9 * 60 + 15, 11 * 60 + 30],
  [13 * 60, 15 * 60]
];
function minutesOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getHours() * 60 + d.getMinutes();
}
function inTradingSession(date = /* @__PURE__ */ new Date()) {
  const m = minutesOf(date);
  return SESSIONS.some(([a, b]) => m >= a && m <= b);
}
function parseQuoteLine(line, name) {
  const m = String(line || "").match(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/);
  if (!m) return null;
  const sym = m[1];
  const f = m[2].split("~");
  const code = f[2] || sym.slice(2);
  const price = parseFloat(f[3]);
  if (!Number.isFinite(price) || price <= 0) return null;
  const prevClose = parseFloat(f[4]);
  const chg = parseFloat(f[32]);
  const ts = String(f[30] || "");
  const tickTime = /^\d{14}$/.test(ts) ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}` : null;
  return {
    code,
    symbol: sym,
    name: name || f[1] || "",
    price,
    prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : null,
    open: (() => {
      const v = parseFloat(f[5]);
      return Number.isFinite(v) && v > 0 ? v : null;
    })(),
    high: (() => {
      const v = parseFloat(f[33]);
      return Number.isFinite(v) && v > 0 ? v : null;
    })(),
    low: (() => {
      const v = parseFloat(f[34]);
      return Number.isFinite(v) && v > 0 ? v : null;
    })(),
    // 涨跌幅优先用源给的 [32]；源没给就用昨收现算（两者都是真实数据，不是推算价格）
    changePct: Number.isFinite(chg) ? chg : Number.isFinite(prevClose) && prevClose > 0 ? Math.round((price / prevClose - 1) * 1e4) / 100 : null,
    turnover: (() => {
      const v = parseFloat(f[38]);
      return Number.isFinite(v) ? v : null;
    })(),
    tickTime,
    tickDate: tickTime ? tickTime.slice(0, 10) : null,
    src: "qt"
  };
}
function parseQuoteText(text) {
  const out2 = {};
  for (const m of String(text || "").matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/g)) {
    const q = parseQuoteLine(m[0]);
    if (q) out2[q.code] = q;
  }
  return out2;
}
async function fetchQuotes(codes, opts = {}) {
  const f = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const batchSize = opts.batchSize || BATCH_SIZE;
  const list = [...new Set((codes || []).map((c) => String(c).trim()).filter((c) => /^\d{6}$/.test(c)))];
  const quotes = {};
  const failed = [];
  if (!f) return { quotes, failed: list, requested: list.length, at: (/* @__PURE__ */ new Date()).toISOString() };
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const syms = batch.map(quoteSymbol).filter(Boolean);
    if (!syms.length) continue;
    try {
      const ctrl = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(1e4) : void 0;
      const res = await f(QUOTE_ENDPOINT + syms.join(","), {
        // 腾讯行情对 Referer 敏感：带上才稳定返回（实测无 Referer 偶发空响应）
        headers: { Referer: "https://finance.qq.com" },
        ...ctrl ? { signal: ctrl } : {}
      });
      let text;
      if (res && typeof res.arrayBuffer === "function") {
        const buf = await res.arrayBuffer();
        text = decodeGBK(buf);
      } else {
        text = String(res && res.text || "");
      }
      const parsed = parseQuoteText(text);
      for (const b of batch) if (parsed[b]) quotes[b] = parsed[b];
      for (const b of batch) if (!parsed[b]) failed.push(b);
    } catch (e) {
      for (const b of batch) failed.push(b);
    }
  }
  return { quotes, failed, requested: list.length, at: (/* @__PURE__ */ new Date()).toISOString() };
}
function decodeGBK(buf) {
  try {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("gbk").decode(buf);
  } catch (e) {
  }
  try {
    return Buffer.from(buf).toString("latin1");
  } catch (e) {
    return String(buf);
  }
}
function priceKind(q, now = /* @__PURE__ */ new Date()) {
  if (!q) return { kind: "close", label: "\u65E0\u62A5\u4EF7", tickTime: null };
  const live = inTradingSession(now) && q.tickDate === toDateStr(now);
  return {
    kind: live ? "live" : "close",
    label: live ? "\u5B9E\u65F6\u4EF7" : "\u6700\u8FD1\u6536\u76D8\u4EF7",
    tickTime: q.tickTime
  };
}
function toDateStr(d) {
  const t = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}
function normalizeCodes(codes) {
  return [...new Set((codes || []).map((c) => String(c || "").trim()).filter((c) => /^\d{6}$/.test(c)))];
}

// src/data_url.js
var durl = (p) => {
  const origin = typeof window !== "undefined" && window.ASENT_CONFIG && window.ASENT_CONFIG.dataOrigin || "";
  if (!origin || typeof location === "undefined" || !/(^|\.)github\.io$/.test(location.hostname)) return p;
  return origin.replace(/\/+$/, "") + "/" + String(p).replace(/^\.?\//, "");
};
var dget = (p, opts) => fetch(durl(p), opts || { cache: "no-store" });

// src/lhb_codec.js
function decodeStrField(rows, table, field) {
  if (!Array.isArray(table) || !table.length) return rows;
  return rows.map((r) => {
    if (!r || r[`${field}Idx`] == null) return r;
    const { [`${field}Idx`]: i, ...rest } = r;
    return { ...rest, [field]: table[i] };
  });
}

// paper_ui.js
init_config().then(() => config_exports).then((m) => {
  window.ASENT_CONFIG = m.default;
}).catch(() => {
});
var $ = (id) => document.getElementById(id);
var esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var num2 = (v, d = 2) => v == null || !Number.isFinite(+v) ? "\u2014" : (+v).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
var pct = (v, d = 2) => v == null || !Number.isFinite(+v) ? "\u2014" : `${v > 0 ? "+" : ""}${(+v).toFixed(d)}%`;
function readExecSettings() {
  const on = (id) => !!($(id) && $(id).checked);
  const rd = (id, d) => {
    const v = parseFloat($(id)?.value);
    return Number.isFinite(v) ? v : d;
  };
  const profile = on("execProfile");
  const limitFill = on("execLimitFill");
  const regimeOn = on("execRegime");
  const trancheOn = on("execTranche");
  const tranche = trancheOn ? Math.max(1, Math.floor(rd("execTrancheN", 3))) : 1;
  const capRaw = $("execTrancheCapLimit")?.value;
  const trancheCapLimit = capRaw != null && String(capRaw).trim() !== "" ? Math.max(1, Math.floor(rd("execTrancheCapLimit", 12))) : null;
  const exec = {
    slipModel: profile ? "profile" : "flat",
    limitFillProb: !!limitFill,
    limitUpFillRatio: Math.min(1, Math.max(0, rd("execUpRatio", 0.5))),
    limitDownFillProb: Math.min(1, Math.max(0, rd("execDownProb", 0.5))),
    tranche
  };
  const regimeCap = regimeOn ? Math.min(1, Math.max(0, rd("execRegimeCap", 0.6))) : null;
  return { exec, regimeCap, tranche, trancheCapLimit };
}
function getExec() {
  const s = readExecSettings();
  setExecContext(s.exec);
  return s;
}
function splitLots(qty, n) {
  const total = Math.max(0, Math.floor(qty / LOT) * LOT);
  if (n <= 1 || total <= 0) return [total];
  const per = Math.max(LOT, Math.floor(total / n / LOT) * LOT);
  const out2 = [];
  for (let i = 0; i < n - 1; i++) out2.push(per);
  out2.push(total - per * (n - 1));
  return out2.filter((x) => x > 0);
}
function wireExecControls() {
  const map = [
    ["execProfile", []],
    ["execLimitFill", ["execUpRatio", "execDownProb"]],
    ["execRegime", ["execRegimeCap"]],
    ["execTranche", ["execTrancheN", "execTrancheCapLimit"]]
  ];
  const note = $("paperExecNote");
  const sync = () => {
    for (const [toggle, deps] of map) {
      const on = !!$(toggle)?.checked;
      for (const d of deps) {
        const el = $(d);
        if (el) el.disabled = !on;
      }
    }
    if (note) note.innerHTML = "\u5B9E\u9A8C\u6027\u6267\u884C\u6469\u64E6\u6302\u4EF6\uFF1A\u5168\u90E8\u5173\u95ED = \u751F\u4EA7\u57FA\u7EBF\uFF08flat \u6ED1\u70B9\u3001\u65E0\u538B\u4ED3\u3001\u65E0\u6392\u961F\u3001\u4E0D\u62C6\u5355\uFF09\u3002\u5F00\u542F\u540E\u6309\u66F4\u5199\u5B9E\u7684\u53E3\u5F84\u64AE\u5408\u2014\u2014\u4EC5\u5F71\u54CD\u672C\u9875\u6A21\u62DF\u5668\uFF0C\u4E0D\u6539\u5F15\u64CE\u9009\u80A1/\u51FA\u573A\u903B\u8F91\u3002";
  };
  for (const [toggle] of map) {
    const el = $(toggle);
    if (el) el.addEventListener("change", sync);
  }
  sync();
}
var cls = (v) => v == null || !Number.isFinite(+v) ? "muted" : v > 0 ? "hl" : v < 0 ? "hl-dn" : "muted";
var LS_KEY = "paper-acct-" + PAPER_VERSION;
var AL_KEY = "paper-alerts-log";
var INIT_CASH = 1e6;
var INIT_KEY = "paper-init-cash";
var INIT_MIN = 1e3;
var INIT_MAX = 1e9;
var SLIP = DEFAULT_SLIP;
var ACCT = null;
var UNI = null;
var UNI_META = {};
var QMAP = {};
var LIVEQ = {};
var LIVE_AT = null;
var LIVE_FAIL = [];
var LIVE_BUSY = false;
var LAST_DATE = null;
var ARC_DAYS = [];
var ZT_POOL_MAP = null;
var ORDER = { side: "buy", code: "", qty: 0 };
var PQ_PCT = null;
var HIST = { view: "trade" };
var BATCH = { side: "buy", mode: "pct", defaultPct: 5, applyLhb: true, checkRisk: true, result: null };
var LOG = { stage: "" };
var ALOG = [];
var REVIEW_OK = /* @__PURE__ */ new Set();
function outflowOf(code) {
  const c = String(code || "");
  if (!c) return null;
  try {
    const day = ARC_DAYS[ARC_DAYS.length - 1];
    if (!day) return null;
    const f = filterOne(c, day, {
      marketNetWan: day.summary && day.summary.lhb_daily_net != null ? +day.summary.lhb_daily_net * 1e4 : null
    });
    return f && f.netOutflow ? f : null;
  } catch (e) {
    return null;
  }
}
function reviewPassed(code) {
  return REVIEW_OK.has(String(code || ""));
}
function markReviewed(code) {
  REVIEW_OK.add(String(code || ""));
}
function clearReview() {
  REVIEW_OK.clear();
}
function loadInitCash() {
  try {
    const raw = localStorage.getItem(INIT_KEY);
    if (raw == null) return INIT_CASH;
    const v = Math.round(+raw);
    if (!Number.isFinite(v) || v < INIT_MIN || v > INIT_MAX) return INIT_CASH;
    return v;
  } catch (e) {
    return INIT_CASH;
  }
}
function saveInitCash(v) {
  const n = Math.round(+v);
  if (!Number.isFinite(n) || n < INIT_MIN || n > INIT_MAX) {
    msg(`\u521D\u59CB\u8D44\u91D1\u9700\u5728 ${INIT_MIN.toLocaleString()} ~ ${INIT_MAX.toLocaleString()} \u5143\u4E4B\u95F4\uFF08\u5F53\u524D\u586B\u7684\u662F ${v}\uFF09`, "err");
    return null;
  }
  try {
    localStorage.setItem(INIT_KEY, String(n));
  } catch (e) {
  }
  return n;
}
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ACCT));
  } catch (e) {
    msg("\u4FDD\u5B58\u5931\u8D25\uFF1A" + e.message + "\uFF08\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\u6216\u5DF2\u6EE1\uFF09", "err");
  }
}
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const r = importAccount(raw);
    if (!r.ok) {
      msg("\u672C\u5730\u8D26\u672C\u65E0\u6CD5\u8BFB\u53D6\uFF08" + r.error + "\uFF09\uFF0C\u5DF2\u91CD\u65B0\u5F00\u59CB", "err");
      return null;
    }
    return r.account;
  } catch (e) {
    return null;
  }
}
function persistRaw(acct) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...acct, version: PAPER_VERSION }));
  } catch (e) {
  }
}
function validLogEntry(e) {
  return !!e && typeof e === "object" && typeof e.key === "string" && e.key && (e.layer === "market" || e.layer === "position") && typeof e.type === "string" && e.type && typeof e.action === "string" && e.action && (e.layer === "market" || Number.isFinite(+e.px));
}
function loadAlertLog() {
  try {
    const raw = localStorage.getItem(AL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(validLogEntry).slice(-LOG_CAP);
  } catch (e) {
    return [];
  }
}
function saveAlertLog() {
  try {
    localStorage.setItem(AL_KEY, JSON.stringify(ALOG));
  } catch (e) {
    msg("\u9884\u8B66\u53F0\u8D26\u4FDD\u5B58\u5931\u8D25\uFF08" + e.message + "\uFF09\uFF1A\u672C\u4F1A\u8BDD\u7684\u6218\u7EE9\u4E0D\u4F1A\u88AB\u8BB0\u4F4F", "warn");
  }
}
function msg(text, kind) {
  const el = $("paperMsg");
  if (!el) return;
  el.textContent = text || "";
  el.className = kind === "err" ? "hl-dn" : kind === "ok" ? "hl" : kind === "warn" ? "bf-warn" : "muted";
  const ms = kind === "warn" || kind === "err" ? 12e3 : 6e3;
  if (text) setTimeout(() => {
    if (el.textContent === text) {
      el.textContent = "";
      el.className = "muted";
    }
  }, ms);
}
async function refreshLive(codes) {
  const list = normalizeCodes(codes);
  if (!list.length) return { ok: 0, failed: [] };
  LIVE_BUSY = true;
  try {
    const r = await fetchQuotes(list);
    const got = Object.keys(r.quotes).length;
    if (got) {
      LIVEQ = { ...LIVEQ, ...r.quotes };
      LIVE_AT = /* @__PURE__ */ new Date();
    }
    LIVE_FAIL = r.failed || [];
    return { ok: got, failed: LIVE_FAIL };
  } catch (e) {
    LIVE_FAIL = list;
    return { ok: 0, failed: list };
  } finally {
    LIVE_BUSY = false;
  }
}
async function refreshAllLive() {
  const codes = [
    ORDER.code,
    ...Object.keys(ACCT?.positions || {}),
    ...(ACCT?.pending || []).map((p) => p.code)
  ];
  const uniq = normalizeCodes(codes);
  if (!uniq.length) return { ok: 0, failed: [] };
  const r = await refreshLive(uniq);
  syncPositionsLive();
  return r;
}
function syncPositionsLive() {
  if (!ACCT?.positions) return;
  let changed = false;
  const positions = { ...ACCT.positions };
  for (const code of Object.keys(positions)) {
    const q = LIVEQ[code];
    if (!q || !Number.isFinite(+q.price)) continue;
    if (positions[code].last !== q.price || positions[code].lastDate !== q.tickDate) {
      positions[code] = { ...positions[code], last: q.price, lastDate: q.tickDate || LAST_DATE, pxStale: false };
      changed = true;
    }
  }
  if (changed) {
    ACCT = { ...ACCT, positions };
    save();
  }
}
function liftSeats(day) {
  if (!day || !day._sub) return day;
  const { _sub, ...rest } = day;
  const out2 = { ...rest };
  if (_sub.lhb != null) out2.lhb = _sub.lhb;
  if (_sub.seats != null) out2.summary = { ...rest.summary || {}, seats: _sub.seats };
  return out2;
}
function loadRecentArchive() {
  if (typeof window !== "undefined" && typeof window.__loadRecentArchive === "function") {
    return window.__loadRecentArchive();
  }
  if (typeof window !== "undefined") {
    if (!window.__recentPromise) {
      window.__recentPromise = dget("./data/archive-recent.json?_=" + Date.now(), { cache: "no-store" }).then((res) => res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))).then((d) => {
        window.__recentPromiseAt = Date.now();
        return d;
      }).catch((e) => {
        window.__recentPromise = null;
        window.__recentPromiseAt = null;
        throw e;
      });
    }
    return window.__recentPromise;
  }
  return dget("./data/archive-recent.json?_=" + Date.now(), { cache: "no-store" }).then((res) => res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status)));
}
function recentDays(arc) {
  return (arc && arc.kind === "archive-recent" ? [...arc.days || [], ...arc.latest ? [arc.latest] : []] : arc && arc.all_days || []).map(liftSeats).sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
}
var UNI_LITE_FILE = "./data/paper_universe-lite.json";
var UNI_FULL_FILE = "./data/paper_universe.json";
var UNI_FULL_READY = false;
var UNI_FULL_ERROR = null;
function liteUniverse(lite) {
  const m = {};
  for (const r of lite && lite.symbols || []) {
    if (r && r.code) m[r.code] = { code: r.code, name: r.name || "" };
  }
  return m;
}
function fullUniverse(uni) {
  return uni.meta && Array.isArray(uni.meta.reasonCodes) ? decodeStrField(Object.values(uni.symbols || {}), uni.meta.reasonCodes, "reason").reduce((m, r) => {
    m[r.code] = r;
    return m;
  }, {}) : uni.symbols || {};
}
function loadUniverseStaged() {
  const bust = "?_=" + Date.now();
  const liteP = dget(UNI_LITE_FILE + bust, { cache: "no-store" }).then((res) => res.ok ? res.json() : null).catch(() => null);
  return { liteP };
}
var SYS = null;
async function loadSysAccount() {
  try {
    const r = await dget("./data/paper/account.json?_=" + Date.now(), { cache: "no-store" });
    SYS = r.ok ? await r.json() : null;
  } catch {
    SYS = null;
  }
  renderSysPanel();
}
function renderSysPanel() {
  const el = document.getElementById("sysPanel");
  if (!el) return;
  if (!SYS || !Array.isArray(SYS.nav) || !SYS.nav.length) {
    el.innerHTML = '<div class="dw-empty">\u5F15\u64CE\u8D26\u672C\u672A\u5C31\u7EEA\uFF08\u670D\u52A1\u5668\u7AEF EOD \u94FE\u5C1A\u672A\u843D\u76D8\uFF0C\u6216\u7EBF\u4E0A\u6863\u672A\u90E8\u7F72\uFF09</div>';
    return;
  }
  const nav = SYS.nav, last = nav[nav.length - 1], prev = nav[nav.length - 2];
  const dayPnl = prev ? last.equity - prev.equity : null;
  const dayPct = prev && prev.equity ? dayPnl / prev.equity * 100 : null;
  const posRows = Object.entries(SYS.positions || {}).map(([code, p]) => {
    const mv = (p.last ?? p.avgCost) * p.qty;
    const pnl = mv - (p.cost || 0);
    return { code, p, mv, pnl, pnlPct: p.cost ? pnl / p.cost * 100 : null };
  }).sort((a, b) => b.mv - a.mv);
  const trades = (SYS.trades || []).slice(-5).reverse();
  const logs = (SYS.logs || []).slice(-3).reverse();
  el.innerHTML = `
    <div class="bf-foot" style="margin-bottom:8px">
      \u603B\u8D44\u4EA7 <b>${num2(last.equity / 1e4, 2)} \u4E07</b>
      \xB7 \u5F53\u65E5 <span class="${cls(dayPnl)}">${dayPnl == null ? "\u2014" : `${dayPnl >= 0 ? "+" : ""}${num2(dayPnl)}\uFF08${pct(dayPct)}\uFF09`}</span>
      \xB7 \u73B0\u91D1 ${num2((last.cash ?? 0) / 1e4, 2)} \u4E07
      \xB7 \u6700\u540E\u7ED3\u7B97 ${esc(last.date || SYS.lastSettle || "\u2014")}
      <span class="tag-mini">\u7CFB\u7EDF\u81EA\u52A8</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>\u4EE3\u7801</th><th>\u540D\u79F0</th><th class="num">\u6301\u4ED3</th><th class="num">\u6210\u672C</th><th class="num">\u73B0\u4EF7</th><th class="num">\u5E02\u503C</th><th class="num">\u6D6E\u52A8\u76C8\u4E8F</th></tr></thead>
        <tbody>
        ${posRows.length ? posRows.map(({ code, p, mv, pnl, pnlPct }) => `<tr>
          <td>${esc(code)}</td><td>${esc(p.name || UNI?.[code]?.name || "")}</td>
          <td class="num">${p.qty}</td><td class="num">${num2(p.avgCost, 3)}</td>
          <td class="num">${num2(p.last)}</td><td class="num">${num2(mv)}</td>
          <td class="num ${cls(pnl)}">${num2(pnl)}<span class="psub">${pnlPct == null ? "" : pct(pnlPct)}</span></td>
        </tr>`).join("") : '<tr class="empty-row"><td colspan="7" class="muted">\u5F15\u64CE\u7A7A\u4ED3\u7B49\u5F85\u2014\u2014regime \u98CE\u63A7\u76D6\u5E3D\u671F\uFF08ice/ebb/shift\uFF09\u4E0D\u5EFA\u4ED3\uFF1B\u5C1D\u8BD5\u88AB\u98CE\u63A7\u95F8\u62E6\u622A\u7684\u8BB0\u5F55\u89C1\u4E0B\u65B9\u65E5\u5FD7</td></tr>'}
        </tbody>
      </table>
    </div>
    ${trades.length ? `<div class="bf-foot" style="margin-top:8px">\u6700\u8FD1\u6210\u4EA4\uFF08\u7CFB\u7EDF\u81EA\u52A8\uFF09\uFF1A</div>
    <div class="table-wrap"><table><thead><tr><th>\u6210\u4EA4\u65E5</th><th>\u4EE3\u7801</th><th>\u540D\u79F0</th><th>\u65B9\u5411</th><th class="num">\u80A1\u6570</th><th class="num">\u6210\u4EA4\u4EF7</th><th class="num">\u51C0\u989D</th></tr></thead><tbody>
      ${trades.map((t) => `<tr><td>${esc(t.fillDate)}</td><td>${esc(t.code)}</td><td>${esc(t.name || "")}</td>
      <td>${t.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"}</td><td class="num">${t.qty}</td>
      <td class="num">${num2(t.price, 3)}</td><td class="num">${num2(t.net)}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
    ${logs.length ? `<div class="bf-foot" style="margin-top:8px">\u5F15\u64CE\u65E5\u5FD7\uFF08\u672B 3 \u6761\uFF09\uFF1A</div>${logs.map((l) => `<div class="dw-note">${esc(l.date || "")} ${esc(l.text || "")}</div>`).join("")}` : ""}
  `;
}
async function boot() {
  try {
    const { liteP } = loadUniverseStaged();
    const [lite, arc] = await Promise.all([liteP, loadRecentArchive()]);
    if (lite && lite.symbols) {
      UNI = liteUniverse(lite);
      UNI_META = lite.meta || {};
      if (typeof window !== "undefined") window.__uniStaged = true;
      if (typeof window !== "undefined" && typeof window.__renderScope === "function") {
        try {
          window.__renderScope(window.__lastArc || null);
        } catch {
        }
      }
    } else {
      const res = await dget(UNI_FULL_FILE + "?_=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("\u6807\u7684\u6C60 HTTP " + res.status);
      const uni = await res.json();
      UNI = fullUniverse(uni);
      UNI_META = uni.meta || {};
      UNI_FULL_READY = true;
      UNI_FULL_ERROR = "\u7CBE\u7B80\u6C60\u7F3A\u5931\uFF0C\u5DF2\u76F4\u63A5\u8F7D\u5165\u5B8C\u6574\u6C60";
    }
    const days = recentDays(arc);
    ARC_DAYS = days;
    const last = days[days.length - 1] || {};
    LAST_DATE = last.trade_date || null;
    QMAP = quotesFromDay(last);
    try {
      const ztRes = await dget("./data/ztpool_history.json?_=" + Date.now(), { cache: "no-store" });
      if (ztRes.ok) {
        const ztArr = await ztRes.json();
        const norm = (s) => String(s == null ? "" : s).replace(/\D/g, "");
        ZT_POOL_MAP = new Map((Array.isArray(ztArr) ? ztArr : []).map((d) => [norm(d.date), d.pool || []]));
      }
    } catch {
    }
    ACCT = load() || emptyAccount(loadInitCash(), LAST_DATE);
    ALOG = loadAlertLog();
    autoCatchUp(days);
    syncInitCashInput();
    renderAllPaper();
    setTimeout(() => {
      if (typeof window !== "undefined") window.__paperFirstPaint = Date.now();
      document.documentElement?.setAttribute("data-paper-first-paint", String(Date.now()));
    }, 0);
    loadSysAccount();
    refreshAllLive().then(() => renderAllPaper());
    if (!UNI_FULL_READY) scheduleIdleUniverse();
  } catch (e) {
    const box = $("paperSub");
    if (box) box.textContent = `\u6A21\u62DF\u5668\u6570\u636E\u672A\u5C31\u7EEA\uFF08${e.message}\uFF09\u2014\u2014\u5148\u8FD0\u884C node scripts/fetch_universe.mjs \u751F\u6210 data/paper_universe.json`;
    msg("\u52A0\u8F7D\u5931\u8D25\uFF1A" + e.message, "err");
  }
}
function scheduleIdleUniverse() {
  const run = () => {
    if (!UNI_FULL_READY) loadFullUniverse().then(() => renderAllPaper());
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3e3 });
  else setTimeout(run, 2e3);
}
function loadFullUniverse() {
  if (UNI_FULL_READY) return Promise.resolve(UNI);
  if (!window.__uniFullPromise) {
    window.__uniFullPromise = dget(UNI_FULL_FILE + "?_=" + Date.now(), { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then((uni) => {
      const full = fullUniverse(uni);
      const merged = { ...UNI };
      for (const [code, r] of Object.entries(full)) merged[code] = { ...merged[code] || {}, ...r };
      UNI = merged;
      UNI_META = { ...uni.meta || {}, staged: true };
      UNI_FULL_READY = true;
      UNI_FULL_ERROR = null;
      if (typeof window !== "undefined") {
        window.__uniStaged = false;
        if (typeof window.__renderScope === "function") {
          try {
            window.__renderScope(window.__lastArc || null);
          } catch {
          }
        }
      }
      renderAllPaper();
      return UNI;
    }).catch((e) => {
      window.__uniFullPromise = null;
      UNI_FULL_ERROR = e.message;
      msg("\u6807\u7684\u6C60\u660E\u7EC6\u672A\u8F7D\u5165\uFF08" + e.message + "\uFF09\uFF1A\u53EF\u4E0B\u5355\u6027\u5224\u5B9A\u6682\u4E0D\u53EF\u7528\uFF0C\u53EF\u7A0D\u540E\u91CD\u65B0\u8F93\u5165\u4EE3\u7801\u91CD\u8BD5", "warn");
      renderAllPaper();
      return UNI;
    });
  }
  return window.__uniFullPromise;
}
function autoCatchUp(days) {
  if (!ACCT.lastSettle) {
    ACCT = { ...ACCT, lastSettle: LAST_DATE };
    return;
  }
  const todo = days.filter((d) => d.trade_date > ACCT.lastSettle);
  if (!todo.length) {
    if (!(ACCT.nav || []).length && LAST_DATE) {
      const st = accountStats(ACCT);
      ACCT = { ...ACCT, nav: [{ date: LAST_DATE, equity: Math.round(st.total * 100) / 100, cash: Math.round((st.cash + st.freeze) * 100) / 100, marketValue: Math.round(st.marketValue * 100) / 100 }] };
    }
    return;
  }
  let cur = ACCT;
  let filled = 0, expired = 0;
  for (const d of todo) {
    const r = settleDay(cur, d.trade_date, quotesFromDay(d), { exec: readExecSettings().exec });
    cur = r.account;
    filled += r.fills.length;
    expired += r.expired.length;
  }
  ACCT = cur;
  save();
  if (filled || expired) {
    msg(`\u5DF2\u6309\u5B58\u6863\u8865\u9F50\u7ED3\u7B97\uFF08${todo[0].trade_date} ~ ${todo[todo.length - 1].trade_date}\uFF09\uFF1A\u6210\u4EA4 ${filled} \u7B14\u3001\u5931\u6548 ${expired} \u7B14`, "ok");
  }
}
function lookup(code) {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) return null;
  const b = boardOf(c);
  const u = UNI?.[c] || null;
  if (!UNI_FULL_READY) loadFullUniverse();
  const live = LIVEQ[c] || null;
  const arch = QMAP[c] || null;
  const q = live || arch;
  const name = q?.name || u?.name || "";
  const kind = live ? priceKind(live) : null;
  return {
    code: c,
    name,
    board: b,
    st: isStName(name),
    limitPct: limitPctOf(c, name),
    price: q?.price ?? null,
    changePct: q?.changePct ?? null,
    turnover: q?.turnover ?? u?.huanshou ?? null,
    prevClose: q?.prevClose ?? null,
    // 价格来源与时间：界面据此如实标注是「实时价」还是「最近收盘价」
    src: live ? "live" : arch ? "archive" : null,
    srcLabel: live ? kind?.kind === "live" ? "\u5B9E\u65F6\u4EF7" : "\u6700\u8FD1\u6536\u76D8\u4EF7" : arch ? "\u5B58\u6863\u6536\u76D8\u4EF7" : null,
    tickTime: live?.tickTime || null,
    quoteDate: live ? live.tickDate || LAST_DATE : arch ? LAST_DATE : u?.asOf || null,
    fresh: !!q,
    history: u,
    inUniverse: !!u,
    // 标的池明细是否已就位。界面据此区分「确实不在池里」与「池子还在补全」——
    // 后者若不区分，用户会以为代码打错了。
    universeReady: UNI_FULL_READY,
    universeError: UNI_FULL_ERROR
  };
}
function renderAllPaper() {
  renderSub();
  renderStats();
  renderAlerts();
  renderPicks();
  renderPositions();
  renderPending();
  renderHist();
  renderPerf();
  renderOrderForm();
  renderQuick();
  renderBatch();
  renderLogs();
  publishSnapshot();
}
function renderSub() {
  const sub = $("paperSub");
  if (!sub) return;
  const cash = ACCT?.initCash || loadInitCash();
  sub.textContent = `\u4EC5\u521D\u59CB\u8D44\u91D1\u4E3A\u865A\u62DF\uFF08${num2(cash)} \u5143\uFF09\xB7 \u884C\u60C5\u6765\u6E90\uFF1A\u817E\u8BAF\u5B9E\u65F6\u884C\u60C5 \xB7 \u89C4\u5219\u5BF9\u9F50 A \u80A1\u73B0\u884C\u5236\u5EA6\uFF08T+1\u3001\u6574\u624B\u3001\u6DA8\u8DCC\u505C\u3001\u771F\u5B9E\u8D39\u7528\uFF09`;
}
function publishSnapshot() {
  if (!ACCT) {
    delete window.__paperSnapshot;
    return;
  }
  const day = ARC_DAYS[ARC_DAYS.length - 1] || {};
  const priceMap = {};
  for (const code of Object.keys(ACCT.positions || {})) {
    const q = lookup(code);
    if (q && q.price != null && Number.isFinite(+q.price)) priceMap[code] = +q.price;
  }
  window.__paperSnapshot = {
    version: REVIEW_VERSION,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    asOf: day.trade_date || LAST_DATE || null,
    emotionScore: day.emotion && day.emotion.value != null ? +day.emotion.value : null,
    account: JSON.parse(JSON.stringify({ ...ACCT, orders: void 0, pending: void 0 })),
    log: JSON.parse(JSON.stringify(ALOG)),
    priceMap,
    meta: {
      liveAt: LIVE_AT,
      liveCount: Object.keys(LIVEQ).length,
      lastDate: LAST_DATE
    }
  };
  try {
    window.dispatchEvent(new Event("paper-snapshot"));
  } catch (e) {
  }
  try {
    window.__paperCtx = { account: () => ACCT, lookup: (c) => lookup(c), stats: () => accountStats(ACCT) };
    window.__paperInitTest = {
      saveInitCash,
      loadInitCash,
      newAccountWith,
      INIT_CASH,
      INIT_MIN,
      INIT_MAX,
      INIT_KEY
    };
    window.__reviewGate = {
      outflowOf: (c) => outflowOf(c),
      passed: (c) => reviewPassed(c),
      mark: (c) => markReviewed(c),
      clear: () => clearReview(),
      // 常量从 lhbfilter 取，绝不在这里另写字面量
      PENALTY: LHB_NET_OUTFLOW_PENALTY,
      TAG: FLAG_LHB.NET_OUTFLOW
    };
  } catch (e) {
  }
}
function renderStats() {
  const box = $("paperStats");
  if (!box) return;
  const st = accountStats(ACCT);
  const rows = [
    ["\u603B\u8D44\u4EA7", num2(st.total), "", `\u73B0\u91D1 + \u51BB\u7ED3 + \u6301\u4ED3\u5E02\u503C`, "stat-total"],
    ["\u53EF\u7528\u8D44\u91D1", num2(st.cash), "", "\u53EF\u7528\u4E8E\u65B0\u5F00\u4ED3", ""],
    ["\u51BB\u7ED3\u8D44\u91D1", num2(st.freeze), "", "\u4E70\u5165\u6302\u5355\u5360\u7528\uFF0C\u64A4\u5355/\u6210\u4EA4\u540E\u91CA\u653E", ""],
    ["\u6301\u4ED3\u5E02\u503C", num2(st.marketValue), "", "\u6309\u6700\u65B0\u771F\u5B9E\u884C\u60C5\u4EF7\u8BA1", ""],
    ["\u6D6E\u52A8\u76C8\u4E8F", num2(st.floatPnl), cls(st.floatPnl), `\u6210\u672C ${num2(st.costValue)} \xB7 ${pct(st.floatPnlPct * 100)}`, ""],
    ["\u5DF2\u5B9E\u73B0\u76C8\u4E8F", num2(st.realized), cls(st.realized), "\u6E05\u4ED3\u7ED3\u8F6C\uFF0C\u542B\u4E70\u5165\u6210\u672C\u5206\u644A", ""],
    ["\u7D2F\u8BA1\u8D39\u7528", num2(st.totalFee), "", "\u4F63\u91D1 + \u8FC7\u6237\u8D39 + \u5370\u82B1\u7A0E", ""],
    ["\u8D26\u6237\u6536\u76CA\u7387", pct(st.retPct), cls(st.retPct), `\u521D\u59CB ${st.initCash.toLocaleString()} \u5143`, ""]
  ];
  box.innerHTML = rows.map(([k, v, c, note, extra]) => `<div class="ps-cell ${extra}" data-act="pstat" data-k="${esc(k)}" tabindex="0" role="button">
      <div class="ps-k">${esc(k)}</div>
      <div class="ps-v ${c}">${esc(v)}</div>
      <div class="ps-n muted">${esc(note)}</div>
    </div>`).join("");
}
function renderPositions() {
  const tb = $("paperPosTable")?.querySelector("tbody");
  const cards = $("paperPosCards");
  const note = $("paperPosNote");
  const rows = Object.values(ACCT.positions || {}).sort((a, b) => b.last * b.qty - a.last * a.qty);
  const html = rows.map((p) => {
    const mv = (p.last ?? p.avgCost) * p.qty;
    const pnl = mv - (p.cost || 0);
    const pnlPct = p.cost ? pnl / p.cost * 100 : 0;
    const frozen = (ACCT.pending || []).filter((x) => x.code === p.code && x.side === "sell").reduce((a, x) => a + x.qty, 0);
    return { p, mv, pnl, pnlPct, frozen };
  });
  if (tb) {
    tb.innerHTML = rows.length ? html.map(({ p, mv, pnl, pnlPct, frozen }) => `<tr class="clickable" data-act="ppos" data-code="${esc(p.code)}" tabindex="0">
          <td>${esc(p.code)}</td><td>${esc(p.name || UNI?.[p.code]?.name || "")}</td>
          <td class="num">${p.qty}</td>
          <td class="num">${Math.max(0, (p.avail || 0) - frozen)}${frozen ? `<span class="tag-mini">\u51BB${frozen}</span>` : ""}</td>
          <td class="num">${num2(p.avgCost, 3)}</td>
          <td class="num">${num2(p.last)}${p.pxStale ? '<span class="tag-mini warn">\u65E7\u4EF7</span>' : ""}</td>
          <td class="num ${cls(pnl)}">${num2(pnl)}<span class="psub">${pct(pnlPct)}</span></td>
        </tr>`).join("") : '<tr class="empty-row"><td colspan="7" class="muted">\u6682\u65E0\u6301\u4ED3\u2014\u2014\u5728\u4E0A\u65B9\u300C\u4E0B\u5355\u300D\u63D0\u4EA4\u59D4\u6258\uFF0C\u6B21\u65E5\u6309\u771F\u5B9E\u6536\u76D8\u4EF7\u6210\u4EA4</td></tr>';
  }
  if (cards) {
    cards.innerHTML = rows.length ? html.map(({ p, pnl, pnlPct, frozen }) => `<div class="card-row" data-act="ppos" data-code="${esc(p.code)}" tabindex="0" role="button">
          <div class="cr-top"><b>${esc(p.name || p.code)}</b><span class="${cls(pnl)}">${num2(pnl)} (${pct(pnlPct)})</span></div>
          <div class="cr-bot muted">${esc(p.code)} \xB7 ${p.qty} \u80A1 \xB7 \u53EF\u5356 ${Math.max(0, (p.avail || 0) - frozen)} \xB7 \u6210\u672C ${num2(p.avgCost, 3)} \xB7 \u73B0\u4EF7 ${num2(p.last)}</div>
        </div>`).join("") : '<div class="dw-empty">\u6682\u65E0\u6301\u4ED3</div>';
  }
  if (note) {
    const stale = rows.filter((x) => x.pxStale).map((x) => x.code);
    note.innerHTML = `\u6210\u672C\u542B\u4E70\u5165\u8D39\u7528\uFF08\u52A0\u6743\u5E73\u5747\uFF09\xB7 \u300C\u53EF\u5356\u300D\u5DF2\u6263\u9664\u5F85\u6210\u4EA4\u5356\u5355\u7684\u51BB\u7ED3 \xB7 T+1\uFF1A\u5F53\u65E5\u4E70\u5165\u6B21\u4E00\u4EA4\u6613\u65E5\u624D\u53EF\u5356` + (stale.length ? ` \xB7 <span class="bf-warn">${esc(stale.join("\u3001"))} \u6700\u8FD1\u4E00\u6863\u65E0\u884C\u60C5\uFF0C\u6CBF\u7528\u4E0A\u4E00\u4EF7\uFF08\u5DF2\u6807\u300C\u65E7\u4EF7\u300D\uFF09</span>` : "");
  }
}
function renderPending() {
  const tb = $("paperPendTable")?.querySelector("tbody");
  const cards = $("paperPendCards");
  const note = $("paperPendNote");
  const list = ACCT.pending || [];
  if (tb) {
    tb.innerHTML = list.length ? list.map((p) => `<tr class="clickable" data-act="ppend" data-id="${p.id}" tabindex="0">
          <td>${esc(p.submitDate || "\u2014")}</td><td>${esc(p.code)}</td><td>${esc(p.name || "")}</td>
          <td class="${p.side === "buy" ? "hl" : "hl-dn"}">${p.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"}</td>
          <td class="num">${p.qty}</td><td class="num">${num2(p.estPrice)}</td>
          <td class="num">${num2(p.need)}</td>
          <td><button class="mini" type="button" data-act="pcancel" data-id="${p.id}">\u64A4\u5355</button></td>
        </tr>`).join("") : '<tr class="empty-row"><td colspan="8" class="muted">\u65E0\u5F85\u6210\u4EA4\u59D4\u6258</td></tr>';
  }
  if (cards) {
    cards.innerHTML = list.length ? list.map((p) => `<div class="card-row" data-act="ppend" data-id="${p.id}" tabindex="0" role="button">
          <div class="cr-top"><b>${esc(p.name || p.code)}</b><span class="${p.side === "buy" ? "hl" : "hl-dn"}">${p.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"} ${p.qty}</span></div>
          <div class="cr-bot muted">${esc(p.code)} \xB7 \u9884\u4F30 ${num2(p.estPrice)} \xB7 \u51BB\u7ED3 ${num2(p.need)} \xB7 \u70B9\u6B64\u64A4\u5355</div>
        </div>`).join("") : '<div class="dw-empty">\u65E0\u5F85\u6210\u4EA4\u59D4\u6258</div>';
  }
  if (note) {
    note.innerHTML = `\u59D4\u6258\u5728<b>\u6B21\u4E00\u4EA4\u6613\u65E5</b>\u6309\u8BE5\u65E5\u771F\u5B9E\u6536\u76D8\u4EF7\u64AE\u5408\uFF08\u9632\u524D\u89C6\u504F\u5DEE\uFF09\xB7 \u4E70\u5165\u9884\u51BB\u7ED3\u8D44\u91D1\u3001\u5356\u51FA\u9884\u51BB\u7ED3\u80A1\u4EFD \xB7 \u6DA8\u505C\u4E70\u4E0D\u8FDB / \u8DCC\u505C\u5356\u4E0D\u6389 / \u8D44\u91D1\u4E0D\u8DB3 \u4F1A\u5728\u7ED3\u7B97\u65F6\u81EA\u52A8\u5931\u6548\u5E76\u91CA\u653E\u51BB\u7ED3`;
  }
}
var HIST_COLS = {
  trade: [
    ["fillDate", "\u6210\u4EA4\u65E5"],
    ["code", "\u4EE3\u7801"],
    ["name", "\u540D\u79F0"],
    ["side", "\u65B9\u5411"],
    ["qty", "\u6570\u91CF"],
    ["price", "\u6210\u4EA4\u4EF7"],
    ["drift", "\u59D4\u6258\u4EF7\u5DEE"],
    ["gross", "\u6210\u4EA4\u989D"],
    ["fee", "\u8D39\u7528"]
  ],
  order: [
    ["submitDate", "\u63D0\u4EA4\u65E5"],
    ["code", "\u4EE3\u7801"],
    ["name", "\u540D\u79F0"],
    ["side", "\u65B9\u5411"],
    ["qty", "\u6570\u91CF"],
    ["estPrice", "\u9884\u4F30/\u6210\u4EA4\u4EF7"],
    ["status", "\u72B6\u6001"],
    ["detail", "\u8BF4\u660E"]
  ]
};
function renderHist() {
  const view = HIST.view;
  const cols = HIST_COLS[view];
  const head = $("paperHistHead");
  const tb = $("paperHistTable")?.querySelector("tbody");
  const cards = $("paperHistCards");
  const list = view === "trade" ? [...ACCT.trades || []].reverse() : [...ACCT.orders || []].reverse();
  if (head) head.innerHTML = cols.map(([, label]) => `<th>${esc(label)}</th>`).join("");
  const cnt = $("paperHistCount");
  if (cnt) {
    cnt.textContent = view === "trade" ? `\u5171 ${(ACCT.trades || []).length} \u7B14\u6210\u4EA4` : `\u5171 ${(ACCT.orders || []).length} \u5F20\u59D4\u6258\uFF08\u88AB\u62D2 ${(ACCT.orders || []).filter((o) => o.status === "rejected").length} \u5F20\uFF09`;
  }
  const emptyTxt = view === "trade" ? "\u6682\u65E0\u6210\u4EA4\u2014\u2014\u59D4\u6258\u5728\u6B21\u4E00\u4EA4\u6613\u65E5\u64AE\u5408" : "\u6682\u65E0\u59D4\u6258\u8BB0\u5F55";
  const cell = (t, c) => {
    switch (c) {
      case "side":
        return `<td class="${t.side === "buy" ? "hl" : "hl-dn"}">${t.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"}</td>`;
      case "price":
        return `<td class="num">${num2(t.price)}</td>`;
      case "drift":
        return `<td class="num ${cls(t.driftPct)}">${t.driftPct == null ? "\u2014" : pct(t.driftPct)}</td>`;
      case "gross":
        return `<td class="num">${num2(t.gross)}</td>`;
      case "fee":
        return `<td class="num">${num2(t.fee)}</td>`;
      case "estPrice":
        return `<td class="num">${num2(t.fillPrice ?? t.estPrice)}</td>`;
      case "status":
        return `<td>${statusTag(t)}</td>`;
      case "detail":
        return `<td class="muted">${esc(t.detail || t.reject || "\u2014")}</td>`;
      default:
        return `<td class="num">${esc(t[c] ?? "\u2014")}</td>`;
    }
  };
  if (tb) {
    tb.innerHTML = list.length ? list.map((t, i) => `<tr class="clickable" data-act="phist" data-view="${view}" data-i="${list.length - 1 - i}" tabindex="0">` + cols.map(([, c]) => cell(t, c)).join("") + "</tr>").join("") : `<tr class="empty-row"><td colspan="${cols.length}" class="muted">${emptyTxt}</td></tr>`;
  }
  if (cards) {
    cards.innerHTML = list.length ? list.map((t, i) => `<div class="card-row" data-act="phist" data-view="${view}" data-i="${list.length - 1 - i}" tabindex="0" role="button">
          <div class="cr-top"><b>${esc(t.name || t.code)}</b><span class="${t.side === "buy" ? "hl" : "hl-dn"}">${t.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"} ${t.qty}</span></div>
          <div class="cr-bot muted">${esc(view === "trade" ? t.fillDate : t.submitDate)} \xB7 ${esc(t.code)}
            \xB7 ${view === "trade" ? `\u6210\u4EA4 ${num2(t.price)}\uFF08\u59D4\u6258 ${num2(t.submitPrice)}\uFF09` : statusText(t)}</div>
        </div>`).join("") : `<div class="dw-empty">${emptyTxt}</div>`;
  }
}
var STATUS_LABEL = {
  filled: "\u5DF2\u6210",
  pending: "\u5F85\u6210\u4EA4",
  rejected: "\u5DF2\u62D2\u7EDD",
  cancelled: "\u5DF2\u64A4\u5355",
  expired: "\u5DF2\u5931\u6548"
};
function statusText(t) {
  return STATUS_LABEL[t.status] || t.status || "\u2014";
}
function statusTag(t) {
  const clsMap = { filled: "ok", pending: "wait", rejected: "bad", cancelled: "mut", expired: "warn" };
  return `<span class="stag ${clsMap[t.status] || "mut"}">${esc(statusText(t))}</span>`;
}
function renderPerf() {
  const box = $("paperPerf");
  const note = $("paperPerfNote");
  const nav = (ACCT.nav || []).map((r) => r.equity);
  const m = nav.length >= 2 ? paperMetrics(nav) : null;
  if (box) {
    if (!m) {
      box.innerHTML = `<div class="ps-cell wide"><div class="ps-k">\u51C0\u503C\u6837\u672C\u4E0D\u8DB3</div>
        <div class="ps-v">\u2014</div>
        <div class="ps-n muted">\u6309\u5B58\u6863\u4EA4\u6613\u65E5\u9010\u65E5\u7D2F\u79EF\uFF1B\u81F3\u5C11\u9700\u8981 2 \u4E2A\u4EA4\u6613\u65E5\u624D\u80FD\u7B97\u6536\u76CA\u4E0E\u56DE\u64A4</div></div>`;
    } else {
      const rows = [
        ["\u533A\u95F4\u6536\u76CA", pct(m.total * 100), cls(m.total), `${m.days} \u4E2A\u4EA4\u6613\u65E5`],
        ["\u5E74\u5316\u6536\u76CA", pct(m.annual * 100), cls(m.annual), `\u6309 252 \u4EA4\u6613\u65E5\u5E74\u5316\uFF08\u6837\u672C\u77ED\uFF0C\u53C2\u8003\u610F\u4E49\u6709\u9650\uFF09`],
        ["\u6700\u5927\u56DE\u64A4", pct(-m.ddPct), m.ddPct > 0 ? "hl-dn" : "muted", "\u5CF0\u503C\u5230\u8C37\u5E95\u7684\u6700\u5927\u8DCC\u5E45"],
        ["\u590F\u666E\u6BD4\u7387", num2(m.sharpe), m.sharpe >= 1 ? "hl" : m.sharpe > 0 ? "" : "hl-dn", "\u4E0E\u7B56\u7565\u56DE\u6D4B\u540C\u53E3\u5F84"],
        ["\u65E5\u80DC\u7387", pct(m.winRate * 100), cls(m.winRate - 0.5), "\u4E0A\u6DA8\u4EA4\u6613\u65E5\u5360\u6BD4"]
      ];
      box.innerHTML = rows.map(([k, v, c, n]) => `<div class="ps-cell" data-act="pperf" data-k="${esc(k)}" tabindex="0" role="button">
        <div class="ps-k">${esc(k)}</div><div class="ps-v ${c}">${esc(v)}</div>
        <div class="ps-n muted">${esc(n)}</div></div>`).join("");
    }
  }
  drawNavChart($("paperNavSvg"), ACCT.nav || []);
  if (note) {
    note.innerHTML = `\u51C0\u503C = \u73B0\u91D1 + \u51BB\u7ED3 + \u6301\u4ED3\u5E02\u503C\uFF08\u6309\u6BCF\u65E5\u771F\u5B9E\u6536\u76D8\u4EF7\uFF09\xB7 \u6307\u6807\u5B9A\u4E49\u4E0E <b>src/backtest.js</b> \u7684 metrics() \u5B8C\u5168\u4E00\u81F4\uFF0C\u56E0\u6B64\u53EF\u4E0E\u4E0A\u65B9\u300C\u7B56\u7565\u56DE\u6D4B\u300D\u7684\u590F\u666E/\u56DE\u64A4\u76F4\u63A5\u5BF9\u6BD4`;
  }
}
function drawNavChart(svg, rows) {
  if (!svg) return;
  const W = 300, H = 90, P = 6;
  let tip = svg.nextElementSibling;
  if (!tip || !tip.classList.contains("nav-empty")) {
    tip = document.createElement("div");
    tip.className = "nav-empty empty";
    tip.textContent = "\u51C0\u503C\u66F2\u7EBF\u9700\u8981\u81F3\u5C11 2 \u4E2A\u4EA4\u6613\u65E5";
    svg.after(tip);
  }
  if (!rows || rows.length < 2) {
    svg.innerHTML = "";
    svg.style.display = "none";
    tip.style.display = "";
    return;
  }
  svg.style.display = "";
  tip.style.display = "none";
  const vals = rows.map((r) => r.equity);
  const base = ACCT.initCash || vals[0];
  const lo = Math.min(...vals, base), hi = Math.max(...vals, base);
  const span = hi - lo || 1;
  const x = (i) => P + i / (rows.length - 1) * (W - 2 * P);
  const y = (v) => H - P - (v - lo) / span * (H - 2 * P);
  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${P},${H - P} ${line} ${(W - P).toFixed(1)},${H - P}`;
  const up = vals[vals.length - 1] >= base;
  const color = up ? "#f0616d" : "#3fb950";
  const baseY = y(base).toFixed(1);
  svg.innerHTML = `
    <polygon points="${area}" fill="${color}" opacity="0.12"></polygon>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6"></polyline>
    <line x1="${P}" y1="${baseY}" x2="${W - P}" y2="${baseY}" stroke="#8b949e" stroke-width="0.7" stroke-dasharray="3 3"></line>
    ${rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.equity).toFixed(1)}" r="2.4" fill="${color}"
        class="pnav-pt" data-date="${esc(r.date)}" data-eq="${esc(r.equity)}" tabindex="0" role="button"><title>${esc(r.date)} \u51C0\u503C ${esc(r.equity)}</title></circle>`).join("")}
    <text x="${P}" y="9" fill="#8b949e" font-size="8">${esc(rows[0].date)}</text>
    <text x="${W - P}" y="9" text-anchor="end" fill="#8b949e" font-size="8">${esc(rows[rows.length - 1].date)}</text>
    <text x="${P}" y="${H - 1}" fill="#8b949e" font-size="8">\u57FA\u51C6 ${base}</text>`;
}
function renderOrderForm() {
  const info = ORDER.code ? lookup(ORDER.code) : null;
  const qbox = $("poQuote");
  if (qbox) {
    if (!ORDER.code) {
      qbox.className = "po-quote muted";
      qbox.textContent = "\u8F93\u5165 6 \u4F4D\u4EE3\u7801\u67E5\u8BE2\u5B9E\u65F6\u884C\u60C5\uFF08\u5168\u5E02\u573A A \u80A1\uFF0C\u6CAA/\u6DF1/\u5317\u4EA4\u6240\u5747\u53EF\uFF09";
    } else if (!info || !info.board.tradable) {
      qbox.className = "po-quote bad";
      qbox.textContent = info ? `${ORDER.code}\uFF1A${info.board.label} \u2014\u2014 \u6A21\u62DF\u5668\u4E0D\u7EB3\u5165\u6B64\u7C7B\u54C1\u79CD` : `${ORDER.code}\uFF1A\u4EE3\u7801\u683C\u5F0F\u975E\u6CD5\uFF08\u9700 6 \u4F4D\u6570\u5B57\uFF09`;
    } else {
      const hit = isLimitHit(info.changePct, info.code, info.name);
      qbox.className = "po-quote";
      const badge = info.src === "live" ? info.srcLabel === "\u5B9E\u65F6\u4EF7" ? '<span class="gtag live">\u5B9E\u65F6\u4EF7</span>' : '<span class="gtag close">\u6700\u8FD1\u6536\u76D8\u4EF7</span>' : info.src === "archive" ? '<span class="gtag close">\u5B58\u6863\u6536\u76D8\u4EF7</span>' : "";
      qbox.innerHTML = `<b>${esc(info.name || "\uFF08\u540D\u79F0\u672A\u77E5\uFF09")}</b> <span class="muted">${esc(info.code)}</span><span class="gtag">${esc(info.board.label)}</span>${info.st ? '<span class="gtag n">ST</span>' : ""}<span class="gtag">\xB1${(info.limitPct * 100).toFixed(0)}%</span>${badge}` + (info.fresh ? `<div class="pq-line">${info.srcLabel === "\u5B9E\u65F6\u4EF7" ? "\u6700\u65B0" : "\u6536\u76D8"} <b>${num2(info.price)}</b> \u5143 <span class="${cls(info.changePct)}">${pct(info.changePct)}</span>` + (hit === "up" ? ' <span class="gtag d">\u6DA8\u505C</span>' : hit === "down" ? ' <span class="gtag u">\u8DCC\u505C</span>' : "") + (info.turnover != null ? `<span class="muted"> \xB7 \u6362\u624B ${num2(info.turnover)}%</span>` : "") + `<span class="muted"> \xB7 ${esc(info.tickTime || info.quoteDate || "\u2014")}</span></div>` : `<div class="pq-line bf-warn">\u53D6\u4E0D\u5230 ${esc(ORDER.code)} \u7684\u884C\u60C5\uFF08\u5B9E\u65F6\u6E90\u4E0E\u5B58\u6863\u90FD\u6CA1\u6709\u8BE5\u4EE3\u7801\u7684\u4EF7\u683C\uFF09\u2014\u2014\u8BF7\u6838\u5BF9\u4EE3\u7801\u662F\u5426\u5B58\u5728/\u662F\u5426\u5DF2\u505C\u724C\uFF1B\u5DF2\u6709\u6301\u4ED3\u4ECD\u53EF\u6B63\u5E38\u5356\u51FA\u3002</div>`) + (info.universeReady ? "" : `<div class="pq-line muted">\u6807\u7684\u6C60\u660E\u7EC6\u8F7D\u5165\u4E2D\uFF08\u9996\u5C4F\u53EA\u52A0\u8F7D\u4E86\u4EE3\u7801\u4E0E\u540D\u79F0\uFF09\uFF1B\u677F\u6BB5\u4E0E\u6DA8\u8DCC\u505C\u5E45\u5EA6\u7531\u4EE3\u7801\u89C4\u5219\u76F4\u63A5\u5224\u5B9A\u3001\u59CB\u7EC8\u6709\u6548${info.universeError ? ` \xB7 \u4E0A\u6B21\u5931\u8D25\uFF1A${esc(info.universeError)}` : ""}</div>`);
    }
  }
  const gate = $("poGate");
  if (gate) {
    const od = ORDER.side === "buy" ? outflowOf(ORDER.code) : null;
    if (!od) {
      gate.innerHTML = "";
      gate.hidden = true;
    } else {
      const netWan = od.netOutflow ? od.netOutflow.value : null;
      const amt = netWan == null ? "\u5F53\u65E5\u9F99\u864E\u699C\u65E0\u51C0\u4E70\u8BB0\u5F55" : netWan < 0 ? `\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70 \u2212${(Math.abs(+netWan) / 1e4).toFixed(2)} \u4EBF` : "\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70\u4E3A 0";
      const done = reviewPassed(ORDER.code);
      gate.hidden = false;
      gate.className = "po-gate" + (done ? " ok" : "");
      gate.innerHTML = `<div class="po-gate-h">${esc(FLAG_LHB.NET_OUTFLOW)}</div><div class="po-gate-b">${esc(amt)}\u3002\u8BE5\u7968\u5DF2\u88AB\u89C4\u5219\u5F15\u64CE\u964D\u7EA7\uFF1A\u7EFC\u5408\u5206 \u2212${LHB_NET_OUTFLOW_PENALTY.SCORE} \u5206\u3001\u4E0A\u6DA8\u6982\u7387 \u2212${LHB_NET_OUTFLOW_PENALTY.PROB} \u4E2A\u767E\u5206\u70B9\uFF0C\u843D<b>\u5907\u9009\u89C2\u5BDF\u6C60\uFF08\u7981\u6B62\u81EA\u52A8\u4E0B\u5355\uFF09</b>\u3002${esc(String(od.netOutflow ? od.netOutflow.text : ""))}</div>` + (done ? `<div class="po-gate-a muted">\u2713 \u672C\u6B21\u4F1A\u8BDD\u5DF2\u786E\u8BA4\u590D\u6838\uFF08\u6362\u4EE3\u7801/\u6539\u65B9\u5411\u540E\u9700\u91CD\u65B0\u786E\u8BA4\uFF09\u3002</div>` : `<div class="po-gate-a"><button class="mini po-gate-btn" type="button" data-act="review-ok" data-code="${esc(ORDER.code)}">\u6211\u5DF2\u77E5\u6089\u8BE5\u7968\u5F53\u65E5\u8D44\u91D1\u51C0\u6D41\u51FA\uFF0C\u786E\u8BA4\u590D\u6838\u5E76\u4E0B\u5355</button><span class="muted">\u3000\u70B9\u6B64\u4EC5\u4E3A**\u6388\u6743**\u4E0B\u5355\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u63D0\u4EA4\uFF1B\u6570\u91CF\u4ECD\u9700\u4F60\u81EA\u884C\u586B\u5199\u3002</span></div>`);
    }
  }
  const glmGate = $("poGlmGate");
  if (glmGate) {
    const d = ORDER.code && ORDER.side === "buy" && window.__glm ? window.__glm.dragonOf(ORDER.code) : null;
    if (d) {
      const pure = !!d.is_pure_sentiment;
      glmGate.hidden = false;
      glmGate.innerHTML = `<div class="po-gate-h">\u{1F575} \u5996\u80A1\u903B\u8F91\u63A8\u6F14${pure ? " \xB7 \u7EAF\u60C5\u7EEA\u7092\u4F5C\u9884\u8B66" : ""}</div><div class="po-gate-b">${esc(d.name || d.code)}\uFF08${d.lb}\u677F\xB7${esc(d.hybk || "\u2014")}\uFF09\u2192 ${esc(d.reason || (pure ? "\u7EAF\u60C5\u7EEA\u535A\u5F08\uFF0C\u660E\u65E5\u664B\u7EA7\u98CE\u9669\u6781\u5927\uFF0C\u5EFA\u8BAE\u5217\u4E3A\u9AD8\u5371\u89C2\u5BDF" : "\uFF08\u65E0\u5224\u8BCD\uFF09"))}</div>`;
    } else {
      glmGate.hidden = true;
      glmGate.innerHTML = "";
    }
  }
  const qty = ORDER.qty;
  const prev = $("poPreview");
  if (prev) {
    if (!info || !info.board.tradable || !info.fresh || !qty) {
      prev.innerHTML = '<div class="muted">\u586B\u5199\u4EE3\u7801\u4E0E\u6570\u91CF\u540E\u663E\u793A\u9884\u4F30\u8D39\u7528\u4E0E\u51BB\u7ED3\u91D1\u989D</div>';
    } else {
      const px = fillPrice(info.price, ORDER.side, SLIP);
      const gross = Math.round(px * qty * 100) / 100;
      const f = fees(gross, ORDER.side);
      const v = validateOrder(ACCT, { code: info.code, side: ORDER.side, qty, slip: SLIP }, { code: info.code, price: info.price, name: info.name, changePct: info.changePct });
      prev.innerHTML = `<table class="po-tb"><tbody>
          <tr><td>\u9884\u4F30\u6210\u4EA4\u4EF7</td><td class="num">${num2(px)} \u5143 <span class="muted">\uFF08${info.srcLabel === "\u5B9E\u65F6\u4EF7" ? "\u6700\u65B0" : "\u6536\u76D8"} ${num2(info.price)} ${ORDER.side === "buy" ? "+" : "\u2212"} \u6ED1\u70B9 ${SLIP * 1e4}\u2031\uFF09</span></td></tr>
          <tr><td>\u6210\u4EA4\u91D1\u989D</td><td class="num">${num2(gross)} \u5143</td></tr>
          <tr><td>\u4F63\u91D1</td><td class="num">${num2(f.comm)} \u5143 <span class="muted">\uFF08\u4E07\u4E09\uFF0C\u6700\u4F4E ${MIN_COMMISSION} \u5143\uFF09</span></td></tr>
          <tr><td>\u8FC7\u6237\u8D39</td><td class="num">${num2(f.transfer)} \u5143 <span class="muted">\uFF08\u4E070.1\uFF0C\u53CC\u8FB9\uFF09</span></td></tr>
          ${ORDER.side === "sell" ? `<tr><td>\u5370\u82B1\u7A0E</td><td class="num">${num2(f.stamp)} \u5143 <span class="muted">\uFF08\u4E07\u4E94\uFF0C\u4EC5\u5356\u51FA\uFF09</span></td></tr>` : ""}
          <tr class="po-sum"><td>${ORDER.side === "buy" ? "\u9700\u51BB\u7ED3" : "\u9884\u8BA1\u5230\u8D26"}</td><td class="num"><b>${num2(ORDER.side === "buy" ? gross + f.total : gross - f.total)} \u5143</b></td></tr>
          ${v.ok ? "" : `<tr><td colspan="2" class="bf-warn">\u2717 ${esc(v.reason)}${v.detail ? "\uFF1A" + esc(v.detail) : ""}</td></tr>`}
        </tbody></table>`;
    }
  }
  const hint = $("poHint");
  if (hint) {
    hint.innerHTML = `\u4E0B\u4E00\u53EF\u64AE\u5408\u65E5\uFF1A<b>${esc(nextSessionLabel())}</b>\uFF08\u6309\u8BE5\u65E5\u771F\u5B9E\u6536\u76D8\u4EF7\u6210\u4EA4\uFF09 \xB7 \u4E70\u5165\u987B ${LOT} \u80A1\u6574\u6570\u500D \xB7 \u53EF\u7528 ${num2(ACCT.cash)} \u5143` + (LIVE_AT ? ` \xB7 <span class="muted">\u884C\u60C5 ${esc(fmtClock(LIVE_AT))} \u6293\u53D6</span>` : "");
  }
}
function nextSessionLabel() {
  const d = /* @__PURE__ */ new Date(bjToday() + "T00:00:00Z");
  for (let i = 0; i < 30; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w === 0 || w === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (HOLIDAYS2.has(iso)) continue;
    return iso;
  }
  return "\u2014";
}
var HOLIDAYS2 = /* @__PURE__ */ new Set([
  "2026-09-25",
  "2026-09-26",
  "2026-09-27",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07"
]);
function isTradingDay3(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return false;
  const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
  const w = d.getUTCDay();
  if (w === 0 || w === 6) return false;
  return !HOLIDAYS2.has(iso);
}
function renderQuick() {
  const box = $("poQuick");
  if (!box) return;
  const info = ORDER.code ? lookup(ORDER.code) : null;
  const btns = (items) => items.filter((x) => x && (x.qty > 0 || x.disabled)).map((x) => {
    const dis = x.qty > 0 ? "" : " disabled";
    return `<button class="mini${x.primary ? " primary-ghost" : ""}" type="button" data-act="pqty" data-qty="${x.qty}"${dis}${x.note ? ` title="${esc(x.note)}"` : ""}>${esc(x.label)}${x.sub ? `<span class="pq-sub">${esc(x.sub)}</span>` : ""}</button>`;
  }).join("");
  if (ORDER.side === "sell") {
    const pos = ACCT.positions?.[ORDER.code];
    if (!pos) {
      box.innerHTML = '<span class="muted">\u8BE5\u80A1\u65E0\u6301\u4ED3\uFF0C\u6682\u65E0\u53EF\u5356\u6570\u91CF</span>';
      return;
    }
    const frozen = (ACCT.pending || []).filter((x) => x.code === ORDER.code && x.side === "sell").reduce((a, x) => a + x.qty, 0);
    const free = Math.max(0, (pos.avail || 0) - frozen);
    if (!free) {
      box.innerHTML = `<span class="muted">\u5F53\u524D\u65E0\u53EF\u5356\u6570\u91CF\uFF08\u6301\u4ED3 ${pos.qty} \u80A1${frozen ? `\uFF0C\u5176\u4E2D ${frozen} \u80A1\u5DF2\u6302\u5356\u5355` : ""}${pos.avail === 0 ? "\uFF0C\u5F53\u65E5\u4E70\u5165\u9700\u6B21\u65E5\u624D\u53EF\u5356" : ""}\uFF09</span>`;
      return;
    }
    const cut = CUT_TIERS.map((t) => ({ label: t.label, qty: qtyByHoldPct(free, t.pct) }));
    box.innerHTML = `<span class="muted">\u53EF\u5356 ${free} \u80A1\uFF1A</span>` + btns(cut) + btns([{ label: "\u6E05\u4ED3", qty: free, primary: true, note: "\u5356\u51FA\u8BE5\u7968\u5168\u90E8\u53EF\u5356\u6570\u91CF" }]);
    return;
  }
  const canSize = info && info.board.tradable && info.fresh && info.price;
  if (!canSize) {
    box.innerHTML = '<span class="muted">\u586B\u5165\u6709\u6548\u4EE3\u7801\u540E\u53EF\u6309\u4ED3\u4F4D\u6863\u4F4D\u5FEB\u901F\u4F30\u91CF</span>';
    return;
  }
  if (!ACCT) {
    box.innerHTML = "";
    return;
  }
  const st = accountStats(ACCT);
  const px = fillPrice(info.price, "buy", SLIP);
  const lotCost = px * LOT + MIN_COMMISSION;
  const tiers = POS_TIERS.map((t) => {
    const r = qtyByAssetPct(st.total, t.pct, px, { cash: ACCT.cash });
    if (r.qty <= 0) {
      return {
        label: t.label,
        qty: 0,
        disabled: true,
        sub: "\u4E0D\u8DB3\u4E00\u624B",
        note: `${t.note} \u2192 \u9884\u7B97 ${num2(st.total * t.pct)} \u5143\uFF0C\u4E0D\u8DB3\u4E00\u624B\uFF08\u7EA6 ${num2(lotCost)} \u5143\uFF09`
      };
    }
    return { label: t.label, qty: r.qty, sub: r.capped ? "\u53D7\u53EF\u7528\u8D44\u91D1\u9650" : t.note, note: `${t.note}\uFF1A${num2(r.need)} \u5143\uFF08\u542B\u8D39\u7528\uFF09` };
  });
  const head = `<span class="muted">\u6309\u4ED3\u4F4D\uFF08\u603B\u8D44\u4EA7 ${num2(st.total)} \u5143\uFF0C\u4E00\u624B\u7EA6 ${num2(lotCost)} \u5143\uFF09\uFF1A</span>`;
  const any = tiers.some((t) => t.qty > 0);
  const html = btns(tiers);
  box.innerHTML = head + (any ? html : `<span class="muted">\u603B\u8D44\u4EA7 ${num2(st.total)} \u5143\u4E70\u4E0D\u8D77 ${esc(info.name || info.code)} \u4E00\u624B\uFF08\u7EA6 ${num2(lotCost)} \u5143\uFF09\uFF0C\u56DB\u6863\u5747\u4E0D\u53EF\u5EFA\u4ED3</span>`) + pctRow();
}
function pctRow() {
  return `<div class="pq-pct">
    <span class="muted">\u6216\u6309\u6BD4\u4F8B\u4E70\u5165\uFF1A</span>
    <label class="pq-pct-in">
      <input id="poPct" type="number" inputmode="decimal" min="0" max="100" step="1"
        value="${PQ_PCT || ""}" placeholder="\u5982 15" aria-label="\u6309\u603B\u8D44\u4EA7\u767E\u5206\u6BD4\u4E70\u5165" />
      <span class="pq-pct-unit">% \u603B\u8D44\u4EA7</span>
    </label>
    <button class="mini" type="button" data-act="pqty-pct">\u7B97\u6570\u91CF</button>
    <span class="pq-pct-hint muted" id="poPctHint"></span>
  </div>`;
}
function qtyByPct(pct2) {
  const p = Math.max(0, Math.min(100, +pct2 || 0)) / 100;
  if (!(p > 0)) return { qty: 0, need: 0, capped: false, budget: 0, reason: "\u8BF7\u8F93\u5165 0~100 \u4E4B\u95F4\u7684\u6BD4\u4F8B" };
  const info = ORDER.code ? lookup(ORDER.code) : null;
  if (!info || !info.board.tradable || !info.fresh || !info.price) {
    return { qty: 0, need: 0, capped: false, budget: 0, reason: "\u5148\u586B\u5165\u6709\u6548\u4EE3\u7801\u5E76\u53D6\u5230\u5B9E\u65F6\u884C\u60C5" };
  }
  if (!ACCT) return { qty: 0, need: 0, capped: false, budget: 0, reason: "\u6A21\u62DF\u8D26\u6237\u672A\u5C31\u7EEA" };
  const st = accountStats(ACCT);
  const px = fillPrice(info.price, "buy", SLIP);
  const budget = st.total * p;
  const r = qtyByAssetPct(st.total, p, px, { cash: ACCT.cash });
  if (r.qty <= 0) {
    return {
      qty: 0,
      need: 0,
      capped: false,
      budget,
      reason: `\u9884\u7B97 ${num2(budget)} \u5143\u4E0D\u8DB3\u4E00\u624B\uFF08\u4E00\u624B\u7EA6 ${num2(px * LOT + MIN_COMMISSION)} \u5143\uFF09`
    };
  }
  return { qty: r.qty, need: r.need, capped: !!r.capped, budget, reason: null };
}
function syncOrderInputs() {
  const c = $("poCode"), q = $("poQty");
  if (c) c.value = ORDER.code;
  if (q) q.value = ORDER.qty || "";
  document.querySelectorAll("#poSide button").forEach((b) => {
    const on = b.dataset.side === ORDER.side;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}
function currentAlerts() {
  if (!ACCT) return null;
  const day = ARC_DAYS[ARC_DAYS.length - 1] || {};
  const score = day.emotion && day.emotion.value != null ? day.emotion.value : null;
  const st = accountStats(ACCT);
  const picks = currentPicks();
  const pickCodes = picks && picks.picks ? picks.picks.map((p) => p.code) : [];
  return buildAlerts({
    emotionScore: score,
    account: ACCT,
    stats: st,
    pickCodes,
    asOf: day.trade_date || LAST_DATE || null
  });
}
var AL_LABEL = { risk: "\u98CE\u9669", opp: "\u673A\u4F1A", tip: "\u63D0\u793A" };
function recordAlerts(r) {
  if (!r || !r.alerts || !r.alerts.length) return 0;
  const st = accountStats(ACCT);
  const tier = r.tier || null;
  const res = appendSignals(ALOG, r.alerts, {
    asOf: r.asOf,
    // 大盘层的「当前/目标仓位」必须由 UI 提供——引擎的 quote 是给人看的字符串，
    // 反解字符串算金额是极易出错的做法（且改文案就会静默算错）。
    curPos: st.total > 0 ? st.marketValue / st.total : 0,
    targetPos: tier ? tier.pos : null,
    total: st.total,
    now: (/* @__PURE__ */ new Date()).toISOString(),
    priceOf: (code) => {
      const q = lookup(code);
      const px = q && q.price != null && Number.isFinite(+q.price) ? +q.price : null;
      return px;
    }
  });
  if (res.added > 0) {
    ALOG = res.log;
    saveAlertLog();
  }
  return res.added;
}
function currentAttribution() {
  return summarizeLog(ALOG, null, { priceOf: (code) => {
    const q = lookup(code);
    return q && q.price != null && Number.isFinite(+q.price) ? +q.price : null;
  } });
}
function renderAlerts() {
  const meta = $("alertsMeta");
  const box = $("alertsList");
  const note = $("alertsNote");
  if (!box) return;
  const r = currentAlerts();
  if (!r) {
    if (meta) meta.innerHTML = '<span class="muted">\u6570\u636E\u672A\u5C31\u7EEA</span>';
    box.innerHTML = '<div class="alerts-empty muted">\u7B49\u5F85\u8D26\u6237\u4E0E\u884C\u60C5\u5B58\u6863\u52A0\u8F7D\u2026</div>';
    if (note) note.textContent = "";
    return;
  }
  recordAlerts(r);
  if (meta) {
    const tierTxt = r.tier ? `<span class="pk-tier ${r.tier.allowNew ? "" : "warn"}">${esc(r.tier.label)}</span>` : '<span class="pk-tier warn">\u6863\u4F4D\u672A\u77E5</span>';
    meta.innerHTML = `\u6570\u636E\u65E5\u671F <b>${esc(r.asOf || "\u2014")}</b> \xB7 \u60C5\u7EEA\u5206 <b>${r.score == null ? "\u2014" : r.score.toFixed(1)}</b> \u2192 ${tierTxt} \xB7 \u5171 <b>${r.total}</b> \u6761${r.truncated ? `\uFF08\u6309\u4E25\u91CD\u5EA6\u663E\u793A\u524D ${r.alerts.length} \u6761\uFF09` : ""} \xB7 <span class="hl">\u98CE\u9669 ${r.counts.risk || 0}</span> / <span class="hl-dn">\u673A\u4F1A ${r.counts.opp || 0}</span> / <span class="muted">\u63D0\u793A ${r.counts.tip || 0}</span>`;
  }
  renderAttribution();
  if (!r.alerts.length) {
    box.innerHTML = '<div class="alerts-empty muted">\u5F53\u524D\u65E0\u9884\u8B66\uFF1A\u4ED3\u4F4D\u8D34\u5408\u5E02\u573A\u6863\u4F4D\uFF0C\u6301\u4ED3\u672A\u89E6\u53CA\u6B62\u635F\u7EBF\u6216\u96C6\u4E2D\u5EA6\u4E0A\u9650\u3002</div>';
  } else {
    box.innerHTML = r.alerts.map((a, i) => {
      const canFill = a.action === "sell" || a.action === "reduce";
      const fillQty = a.qty > 0 ? ` data-qty="${a.qty}"` : "";
      return `<div class="alert-row ${esc(a.level)}" data-act="alert" data-i="${i}" tabindex="0" role="button"
          title="\u70B9\u51FB\u67E5\u770B\u8BE5\u6761\u9884\u8B66\u7684\u89E6\u53D1\u4F9D\u636E">
        <span class="al-badge ${esc(a.level)}">${esc(AL_LABEL[a.level] || a.level)}</span>
        <div class="al-main">
          <div class="al-head">
            <span class="al-act">${esc(ACTIONS_CN[a.action] || a.action)}</span>
            ${a.code ? `<b class="al-code">${esc(a.name || a.code)} ${esc(a.code)}</b>` : '<b class="al-code">\u5927\u76D8</b>'}
          </div>
          <div class="al-text">${esc(a.text)}</div>
        </div>
        ${canFill ? `<div class="al-actions"><button class="mini al-fill" type="button"
            data-act="alert-fill" data-i="${i}"${fillQty}
            title="\u628A\u8BE5\u80A1\u4E0E\u5EFA\u8BAE\u6570\u91CF\u586B\u5165\u4E0B\u5355\u533A\uFF08\u4E0D\u81EA\u52A8\u63D0\u4EA4\uFF09">\u586B\u5165\u5356\u51FA</button></div>` : ""}
      </div>`;
    }).join("");
  }
  if (note) {
    note.innerHTML = `<span class="muted">\u5927\u76D8\u5C42\uFF1A\u6863\u4F4D\u504F\u79BB\u5BB9\u5FCD\u5E26 ${(MARKET_CFG.band * 100).toFixed(0)}%\u3001\u6700\u5C0F\u53EF\u6267\u884C\u5DEE\u989D ${(MARKET_CFG.minActionPos * 100).toFixed(0)}% \xB7 \u6301\u4ED3\u5C42\uFF1A\u6B62\u635F\u7EBF ${(POS_CFG.stopLoss * 100).toFixed(0)}%\u3001\u5355\u7968\u4E0A\u9650 ${(POS_CFG.concMax * 100).toFixed(0)}%\u3001\u56DE\u64A4\u964D\u4ED3\u7EBF ${(POS_CFG.ddTrigger * 100).toFixed(0)}%</span> \u9608\u503C\u4E0E V5.2 \u56DE\u6D4B\u5F15\u64CE\u540C\u6E90\uFF1B\u9884\u8B66\u7531\u89C4\u5219\u5F15\u64CE\u6309\u5F53\u6863\u6570\u636E\u4E0E\u8D26\u6237\u5B9E\u51B5\u751F\u6210\uFF0C<b>\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE</b>\uFF0C\u6309\u952E\u53EA\u628A\u53C2\u6570\u586B\u5165\u4E0B\u5355\u533A\uFF0C\u662F\u5426\u4E0B\u5355\u7531\u4F60\u51B3\u5B9A\u3002`;
  }
}
var ACTIONS_CN = {
  buy: "\u4E70\u5165",
  sell: "\u5356\u51FA",
  add: "\u52A0\u4ED3",
  reduce: "\u51CF\u4ED3",
  clear: "\u7A7A\u4ED3",
  exit: "\u6E05\u4ED3",
  hold: "\u6301\u6709",
  wait: "\u7B49\u5F85",
  watch: "\u89C2\u671B"
};
function renderAttribution() {
  const box = $("alertsAttr");
  if (!box) return;
  const s = currentAttribution();
  if (!s || !s.n) {
    box.innerHTML = `<div class="al-attr-empty muted">\u5C1A\u65E0\u9884\u8B66\u6218\u7EE9\u2014\u2014\u6BCF\u89E6\u53D1\u4E00\u6761\u9884\u8B66\u5C31\u4F1A\u6309\u5F53\u523B\u771F\u5B9E\u4EF7\u8BB0\u8D26\uFF0C\u540E\u7EED\u7528\u771F\u5B9E\u884C\u60C5\u7ED3\u7B97\uFF0C\u7528\u6765\u56DE\u7B54\u300C\u8FD9\u5957\u9884\u8B66\u5230\u5E95\u5E2E\u6211\u5C11\u4E8F\u4E86\u591A\u5C11\u3001\u591A\u8D5A\u4E86\u591A\u5C11\u300D\u3002</div>`;
    return;
  }
  const judged = s.hit + s.miss;
  const netCls = s.net > 0 ? "al-blue" : s.net < 0 ? "hl-dn" : "muted";
  const cells = [
    {
      k: "\u5DF2\u89C4\u907F\u4E8F\u635F",
      v: s.avoidedLoss > 0 ? `+${num2(s.avoidedLoss, 0)}` : "0",
      c: "al-blue",
      note: "\u5356\u51FA/\u51CF\u4ED3\u540E\u5728\u4E0B\u8DCC\u4E2D\u907F\u514D\u7684\u635F\u5931",
      act: "attr-detail",
      extra: "pos"
    },
    {
      k: "\u9519\u6740 / \u9519\u8FC7",
      v: s.missedGain > 0 ? `\u2212${num2(s.missedGain, 0)}` : "0",
      c: "hl-dn",
      note: "\u5356\u98DE\uFF08\u53CD\u5F39\uFF09\u6216\u52A0\u4ED3\u540E\u4E0B\u8DCC",
      act: "attr-detail",
      extra: "neg"
    },
    {
      k: "\u51C0\u8D21\u732E",
      v: `${s.net >= 0 ? "+" : "\u2212"}${num2(Math.abs(s.net), 0)}`,
      c: netCls,
      note: `\u89C4\u907F \u2212 \u9519\u6740\uFF0C\u6309\u771F\u5B9E\u884C\u60C5\u7ED3\u7B97`,
      act: "attr-detail",
      extra: "net"
    },
    {
      k: "\u547D\u4E2D\u7387",
      v: s.hitRate == null ? "\u5F85\u79EF\u7D2F" : `${(s.hitRate * 100).toFixed(0)}%`,
      c: s.hitRate == null ? "muted" : s.hitRate >= 0.5 ? "al-blue" : "hl-dn",
      note: judged ? `${s.hit} \u5BF9 / ${s.miss} \u9519\uFF0C\u53E6\u6709 ${s.flat + s.pending + s.tracked} \u6761\u672A\u5B9A` : "\u6682\u65E0\u5DF2\u7ED3\u7B97\u6761\u76EE",
      act: "attr-detail",
      extra: "rate"
    }
  ];
  box.innerHTML = `<div class="al-attr">
      <div class="al-attr-hd">
        <b>\u9884\u8B66\u6218\u7EE9</b>
        <span class="muted">\u5171\u8BB0\u8D26 ${s.n} \u6761 \xB7 \u70B9\u6570\u5B57\u770B\u9010\u6761\u660E\u7EC6</span>
      </div>
      <div class="al-attr-cells">${cells.map((c) => `<div class="al-cell" data-act="${c.act}" data-k="${esc(c.k)}" tabindex="0" role="button">
          <div class="al-k">${esc(c.k)}</div>
          <div class="al-v ${c.c}">${esc(c.v)}</div>
          <div class="al-n muted">${esc(c.note)}</div>
        </div>`).join("")}</div>
      <div class="al-attr-txt">${esc(summarizeText(s))}</div>
    </div>`;
}
function attrDetail() {
  const s = currentAttribution();
  if (!s || !s.n) return null;
  const rows = s.byType.map((t) => {
    const rate = t.hit + t.miss > 0 ? `${(t.hit / (t.hit + t.miss) * 100).toFixed(0)}%` : "\u2014";
    const netCls = t.net > 0 ? "al-blue" : t.net < 0 ? "hl-dn" : "muted";
    return `<tr>
      <td>${esc(t.type)}</td>
      <td>${esc(ACTIONS_CN[t.action] || t.action)}</td>
      <td class="num">${t.count}</td>
      <td class="num ${netCls}">${t.net >= 0 ? "+" : "\u2212"}${num2(Math.abs(t.net), 0)}</td>
      <td class="num">${esc(rate)}</td>
      <td class="num muted">${t.pending || 0}</td>
    </tr>`;
  }).join("");
  const settled = s.details.filter((d) => d.result && d.result.pnl != null);
  const list = settled.map((d) => {
    const r = d.result;
    const cls2 = r.pnl > 0 ? "al-blue" : r.pnl < 0 ? "hl-dn" : "muted";
    return `<div class="al-line">
      <span class="al-line-d">${esc(d.asOf || "\u2014")}</span>
      <span class="al-line-c">${esc(d.code ? `${d.name || d.code} ${d.code}` : "\u5927\u76D8")}</span>
      <span class="al-line-t">${esc(d.type)}</span>
      <span class="al-line-p">${num2(r.px)} \u2192 ${num2(r.finalPx)}\uFF08${pct(r.pct)}\uFF09</span>
      <span class="al-line-v ${cls2}">${r.pnl >= 0 ? "+" : "\u2212"}${num2(Math.abs(r.pnl), 0)} \u5143</span>
      <span class="al-line-b muted">${r.verdict === "hit" ? "\u65B9\u5411\u5BF9" : r.verdict === "miss" ? "\u65B9\u5411\u9519" : "\u51E0\u4E4E\u6CA1\u52A8"}</span>
    </div>`;
  }).join("") || '<div class="muted">\u6682\u65E0\u5DF2\u7ED3\u7B97\u6761\u76EE\uFF08\u9884\u8B66\u9700\u8981\u540E\u7EED\u771F\u5B9E\u4EF7\u683C\u624D\u80FD\u9A8C\u8BC1\uFF09\u3002</div>';
  const body = dwSection(
    "\u6218\u7EE9\u603B\u89C8",
    `<div class="dw-note">${esc(summarizeText(s))}</div>` + dwKv([
      ["\u5DF2\u89C4\u907F\u4E8F\u635F", `${num2(s.avoidedLoss, 0)} \u5143`],
      ["\u9519\u6740 / \u9519\u8FC7", `${num2(s.missedGain, 0)} \u5143`],
      ["\u51C0\u8D21\u732E", `${s.net >= 0 ? "+" : "\u2212"}${num2(Math.abs(s.net), 0)} \u5143`],
      ["\u547D\u4E2D\u7387", s.hitRate == null ? "\u5F85\u79EF\u7D2F" : `${(s.hitRate * 100).toFixed(0)}%\uFF08${s.hit} \u5BF9 / ${s.miss} \u9519\uFF09`],
      ["\u8BB0\u8D26\u6761\u6570", `${s.n} \u6761\uFF08\u5DF2\u7ED3\u7B97 ${s.hit + s.miss + s.flat} \xB7 \u5F85\u9A8C\u8BC1 ${s.pending + s.tracked}\uFF09`]
    ])
  ) + dwSection("\u6309\u89C4\u5219\u62C6\u89E3", `<table class="dw-tb"><thead><tr>
        <th>\u89C4\u5219</th><th>\u52A8\u4F5C</th><th class="num">\u6761\u6570</th><th class="num">\u51C0\u8D21\u732E(\u5143)</th><th class="num">\u547D\u4E2D\u7387</th><th class="num">\u5F85\u9A8C\u8BC1</th>
      </tr></thead><tbody>${rows}</tbody></table>`) + dwSection("\u9010\u6761\u660E\u7EC6", `<div class="al-lines">${list}</div>`) + dwSection(
    "\u8BA1\u5206\u53E3\u5F84",
    `<div class="dw-note">\u5F52\u56E0\u53EA\u505A\u300C\u7167\u505A vs \u4E0D\u52A8\u300D\u7684\u5DEE\u989D\uFF0C\u6309<b>\u80A1\u6570 \xD7 \u4EF7\u5DEE</b>\u8BA1\u7B97\uFF0C\u4E0D\u542B\u8D39\u7528\uFF08\u8D39\u7528\u5728\u4E24\u8FB9\u90FD\u53D1\u751F\uFF0C\u505A\u5DEE\u4F1A\u62B5\u6D88\uFF09\u3002\u89E6\u53D1\u4EF7\u5728\u8BB0\u8D26\u65F6\u51BB\u7ED3\u3001\u6C38\u4E0D\u88AB\u540E\u7EED\u884C\u60C5\u6539\u5199\uFF1B\u4E0D\u8DB3 100 \u80A1\uFF08\u4E00\u624B\uFF09\u7684\u5EFA\u8BAE\u4E0D\u8BA1\u5206\u2014\u2014A \u80A1\u6267\u884C\u4E0D\u4E86\u3002\u5927\u76D8\u5C42\u6CA1\u6709\u5355\u4E00\u6807\u7684\u4EF7\u683C\uFF0C\u53EA\u8BB0\u300C\u5E94\u8C03\u6574\u591A\u5C11\u91D1\u989D\u300D\uFF0C<b>\u4E0D\u7F16\u9020\u6536\u76CA\u6570\u5B57</b>\u3002</div>`
  );
  return {
    title: "\u9884\u8B66\u6218\u7EE9\u660E\u7EC6",
    sub: `\u8BB0\u8D26 ${s.n} \u6761 \xB7 \u51C0\u8D21\u732E ${s.net >= 0 ? "+" : "\u2212"}${num2(Math.abs(s.net), 0)} \u5143`,
    body
  };
}
function fillAlertToOrder(i) {
  const r = currentAlerts();
  const a = r && r.alerts[i];
  if (!a) return;
  if (a.action === "clear" || a.action === "exit") {
    msg("\u300C\u7A7A\u4ED3\u300D\u6D89\u53CA\u5168\u90E8\u6301\u4ED3\uFF0C\u8BF7\u7528\u8D26\u6237\u603B\u89C8\u7684\u300C\u4E00\u952E\u7A7A\u4ED3\u300D\uFF0C\u907F\u514D\u53EA\u5356\u4E00\u53EA\u9020\u6210\u8BEF\u89E3", "ok");
    return;
  }
  if (!a.code) return;
  ORDER = { ...ORDER, code: a.code, side: "sell", qty: a.qty > 0 ? a.qty : 0 };
  syncOrderInputs();
  renderOrderForm();
  renderQuick();
  const nm = LIVEQ[a.code]?.name || a.name || "";
  if (!LIVEQ[a.code] && !LIVE_BUSY) {
    refreshLive([a.code]).then((res) => {
      renderOrderForm();
      renderQuick();
      msg(res.ok ? `\u5DF2\u586B\u5165 ${a.code} ${LIVEQ[a.code]?.name || nm} \u5356\u51FA\uFF0C\u8BF7\u6838\u5BF9\u6570\u91CF\u540E\u63D0\u4EA4` : `${a.code} \u53D6\u4E0D\u5230\u884C\u60C5\uFF0C\u8BF7\u6838\u5BF9\u4EE3\u7801`, res.ok ? "ok" : "err");
    });
  } else {
    msg(`\u5DF2\u586B\u5165 ${a.code} ${nm} \u5356\u51FA${a.qty > 0 ? ` ${a.qty} \u80A1` : ""}\uFF0C\u8BF7\u6838\u5BF9\u540E\u63D0\u4EA4`, "ok");
  }
  $("poQty")?.focus?.();
}
function alertDetail(i) {
  const r = currentAlerts();
  const a = r && r.alerts[i];
  if (!a) return null;
  const title = a.code ? `${a.name || a.code} ${a.code}` : "\u5927\u76D8\u4ED3\u4F4D";
  const body = dwSection(
    "\u5EFA\u8BAE\u52A8\u4F5C",
    `<div class="dw-note"><b>${esc(ACTIONS_CN[a.action] || a.action)}</b>${a.qty > 0 ? ` \xB7 \u6570\u91CF ${a.qty} \u80A1` : ""} \xB7 \u4E25\u91CD\u5EA6 ${esc(AL_LABEL[a.level] || a.level)} \xB7 \u89C4\u5219\u51FA\u5904 ${esc(a.layer === "market" ? "src/alerts.js marketAlerts()" : "src/alerts.js positionAlerts()")}</div>`
  ) + dwSection("\u89E6\u53D1\u4F9D\u636E", `<div class="dw-note">${esc(a.why || "\u2014")}</div>`) + dwSection("\u5F53\u65F6\u7684\u5B57\u6BB5\u53D6\u503C", dwKv(Object.entries(a.quote || {}).map(([k, v]) => [k, esc(v)]))) + alertTrackRecord(a, r);
  return {
    title: `${esc(title)}`,
    sub: `${AL_LABEL[a.level] || a.level} \xB7 ${ACTIONS_CN[a.action] || a.action} \xB7 \u6570\u636E\u65E5 ${esc(r.asOf || "\u2014")}`,
    body
  };
}
function alertTrackRecord(a, r) {
  const s = currentAttribution();
  const t = s && s.byType ? s.byType.find((x) => x.type === a.type) : null;
  if (!t) {
    return dwSection(
      "\u8FD9\u6761\u89C4\u5219\u7684\u5386\u53F2\u6218\u7EE9",
      `<div class="dw-note muted">\u672C\u6761\u89C4\u5219\u5C1A\u65E0\u5F80\u671F\u8BB0\u8D26\u2014\u2014\u672C\u6B21\u89E6\u53D1\u5DF2\u5199\u5165\u6218\u7EE9\u53F0\u8D26\uFF0C\u540E\u7EED\u7528\u771F\u5B9E\u884C\u60C5\u7ED3\u7B97\u540E\uFF0C\u8FD9\u91CC\u4F1A\u663E\u793A\u300C\u7167\u505A vs \u4E0D\u52A8\u300D\u7684\u7D2F\u8BA1\u5DEE\u989D\u3002</div>`
    );
  }
  const judged = t.hit + t.miss;
  const netCls = t.net > 0 ? "al-blue" : t.net < 0 ? "hl-dn" : "muted";
  return dwSection(
    "\u8FD9\u6761\u89C4\u5219\u7684\u5386\u53F2\u6218\u7EE9",
    `<div class="dw-note">\u6309\u89C4\u5219 <code>${esc(t.type)}</code> \u7D2F\u8BA1\uFF0C\u4E0D\u542B\u672C\u6B21\u672A\u7ED3\u7B97\u7684\u90E8\u5206\u3002</div>` + dwKv([
      ["\u7D2F\u8BA1\u89E6\u53D1", `${t.count} \u6B21`],
      ["\u7D2F\u8BA1\u8D21\u732E", `${t.net >= 0 ? "+" : "\u2212"}${num2(Math.abs(t.net), 0)} \u5143`],
      ["\u65B9\u5411\u5BF9/\u9519", judged ? `${t.hit} \u5BF9 / ${t.miss} \u9519` : "\u2014"],
      ["\u5F85\u9A8C\u8BC1", `${t.pending || 0} \u6B21`]
    ]) + `<div class="dw-note ${netCls}">${esc(
      t.net > 0 ? "\u5386\u53F2\u770B\uFF0C\u6309\u8FD9\u6761\u89C4\u5219\u64CD\u4F5C\u6574\u4F53\u662F\u300C\u7701\u4E0B/\u8D5A\u5230\u300D\u7684\u3002" : t.net < 0 ? "\u5386\u53F2\u770B\uFF0C\u8FD9\u6761\u89C4\u5219\u6709\u8FC7\u300C\u5356\u98DE\u300D\u6216\u300C\u770B\u9519\u300D\uFF0C\u8BF7\u7ED3\u5408\u5F53\u524D\u4F9D\u636E\u81EA\u884C\u5224\u65AD\u3002" : "\u5386\u53F2\u770B\uFF0C\u7D2F\u8BA1\u8D21\u732E\u63A5\u8FD1\u96F6\u3002"
    )}</div>`
  );
}
var PICKS = null;
function currentPicks() {
  const day = ARC_DAYS[ARC_DAYS.length - 1];
  if (!day) return null;
  const score = day.emotion && day.emotion.value != null ? day.emotion.value : null;
  if (!PICKS || PICKS.asOf !== (day.trade_date || null)) {
    const ztpool = ZT_POOL_MAP && day.trade_date ? ZT_POOL_MAP.get(String(day.trade_date).replace(/\D/g, "")) || [] : [];
    PICKS = recommendPicks(day, {
      emotionScore: score,
      topN: PICK_TOP_N,
      stopLossPct: POS_CFG.stopLoss,
      ztpool
    });
  }
  return PICKS;
}
var TONE_CLS = { up: "hl", warn: "bf-warn", muted: "muted" };
function renderPicks() {
  const meta = $("picksMeta");
  const box = $("picksList");
  const rejBox = $("picksRejected");
  const note = $("picksNote");
  if (!box) return;
  const r = currentPicks();
  if (!r) {
    if (meta) meta.innerHTML = '<span class="muted">\u6570\u636E\u672A\u5C31\u7EEA</span>';
    box.innerHTML = '<div class="picks-empty muted">\u7B49\u5F85\u884C\u60C5\u5B58\u6863\u52A0\u8F7D\u2026</div>';
    if (rejBox) rejBox.innerHTML = "";
    if (note) note.textContent = "";
    return;
  }
  if (meta) {
    const tierTxt = r.tier ? `<span class="pk-tier ${r.tier.allowNew ? "" : "warn"}">${esc(r.tier.label)}</span>` : '<span class="pk-tier warn">\u6863\u4F4D\u672A\u77E5</span>';
    const st = r.pred || {};
    meta.innerHTML = `\u6570\u636E\u65E5\u671F <b>${esc(r.asOf || "\u2014")}</b> \xB7 \u60C5\u7EEA\u5206 <b>${r.score == null ? "\u2014" : r.score.toFixed(1)}</b> \u2192 \u5E02\u573A\u6863\u4F4D ${tierTxt} \xB7 \u5019\u9009\u6C60 <b>${r.pool}</b> \u53EA \u2192 \u9884\u6D4B\u7B5B\u9009\uFF1A\u63A8\u8350 <b class="hl">${r.picks.length}</b> \u53EA\u3001\u5254\u9664 <b class="hl-dn">${st.rejected == null ? "\u2014" : st.rejected}</b> \u53EA\uFF08\u5927\u6982\u7387\u4E8F\uFF09\u3001\u672A\u8FBE\u6982\u7387\u95E8\u69DB ${st.below == null ? "\u2014" : st.below} \u53EA` + (st.streakTop ? ` \xB7 \u5176\u4E2D <b class="hl">${st.streakTop}</b> \u53EA T+1 \u8FDE\u677F\u6982\u7387 \u2265${st.streakTopMin}%\uFF08\u5DF2\u7F6E\u9876\u6253\u6807\u7B7E\uFF09` : ` \xB7 \u65E0\u8FDE\u677F\u6982\u7387 \u2265${st.streakTopMin == null ? 30 : st.streakTopMin}% \u7684\u6807\u7684`);
  }
  if (!r.picks.length) {
    box.innerHTML = `<div class="picks-empty muted">${esc(r.note.text)}</div>`;
  } else {
    const topCnt = r.picks.filter((p) => p.streakTop).length;
    let rendered = 0;
    box.innerHTML = (r.climaxWarnings && r.climaxWarnings.length ? `<div class="bf-warn pk-climax-banner">\u26A0 \u60C5\u7EEA\u9AD8\u6F6E\u9884\u8B66\uFF1A${esc(r.climaxWarnings.map((w) => w.sector).join("\u3001"))} \u677F\u5757\u6B21\u65E5\u8C28\u9632\u5206\u6B67\u2014\u2014\u5DF2\u7981\u63A8\u8BE5\u677F\u5757\u524D\u6392\u9AD8\u6807\uFF0C\u4EC5\u7559\u4F4E\u4F4D\u9996\u677F\u8865\u6DA8\u3002</div>` : "") + r.picks.map((p, i) => {
      let sep = "";
      if (topCnt > 0 && rendered === topCnt && i === topCnt) {
        sep = `<div class="pk-sep"><span>\u4EE5\u4E0B\u6309\u4E0A\u6DA8\u6982\u7387\u6392\u5E8F\uFF08\u672A\u8FBE\u8FDE\u677F\u95E8\u69DB\uFF09</span></div>`;
      }
      if (p.streakTop) rendered++;
      const chg = p.changePct == null ? null : +p.changePct;
      const chgCls = chg == null ? "muted" : chg > 0 ? "hl" : chg < 0 ? "hl-dn" : "muted";
      const prob = p.prob || {};
      const band = prob.band || {};
      const bandCls = band.key === "high" ? "pb-high" : band.key === "mid" ? "pb-mid" : band.key === "low" ? "pb-low" : "pb-poor";
      const lp = p.limitUp || {};
      const sb = lp.band || {};
      const sbCls = sb.key === "high" ? "pb-high" : sb.key === "mid" ? "pb-mid" : sb.key === "low" ? "pb-low" : "pb-poor";
      const exp = p.exp || {};
      const expC = exp.atClose || {};
      const factorTxt = (prob.factors || []).map((f) => f.label).join(" + ") || "\u65E0\u5B9E\u6D4B\u6709\u6548\u56E0\u5B50";
      return sep + `<div class="pk-row${p.streakTop ? " pk-row-top" : ""}" data-act="pick" data-code="${esc(p.code)}"
          data-suggest-weight="${p.suggestWeight > 0 ? p.suggestWeight : 0}" tabindex="0" role="button"
          title="\u70B9\u51FB\u67E5\u770B ${esc(p.name || p.code)} \u7684\u8BE6\u60C5">
        <span class="pk-rank${i === 0 ? " top" : ""}">${i + 1}</span>
        <div class="pk-main">
          <div class="pk-line1">
            <b class="pk-name">${esc(p.name || p.code)}</b>${window.__glm ? window.__glm.tagSpan(p) : ""}
            <span class="pk-code muted">${esc(p.code)}</span>
            ${chg == null ? "" : `<span class="pk-chg ${chgCls}">${pct(chg)}</span>`}
            ${p.streakTop ? `<span class="pk-streak ${sbCls}" title="\u8FDE\u677F\u6982\u7387\uFF1A\u5386\u53F2\u540C\u7279\u5F81\u7EC4\uFF08${esc(lp.group || "")}\uFF09\u91CC T+1 \u518D\u6B21\u6DA8\u505C\u7684\u5360\u6BD4\u3002\u57FA\u51C6 ${r.streakBaseline == null ? 21.8 : r.streakBaseline}%\u3002">${esc(p.streakText || "\u5927\u6982\u7387\u8FDE\u677F")}</span>` : ""}
            <span class="pk-prob ${bandCls}" title="\u4E0A\u6DA8\u6982\u7387\u5206\uFF1A\u5386\u53F2\u540C\u7279\u5F81\u7EC4\u7684\u5B9E\u9645\u4E0A\u6DA8\u5360\u6BD4\uFF08\u4E0D\u662F\u4E3B\u89C2\u7F6E\u4FE1\u5EA6\uFF09">\u4E0A\u6DA8\u6982\u7387 ${prob.score == null ? "\u2014" : prob.score.toFixed(1)}</span>
            ${p.gateTags && p.gateTags.length ? p.gateTags.map((t) => `<span class="pk-tag ${t === "\u540E\u6392\u8865\u6DA8" ? "hl" : "bf-warn"}" title="${t === "\u540E\u6392\u8865\u6DA8" ? "\u9AD8\u6F6E\u677F\u5757\u4F4E\u4F4D\u9996\u677F\u8865\u6DA8\uFF08\u8FDE\u677F1\u3001\u5C01\u6B7B\uFF09" : "\u677F\u5757\u5185\u7ED3\u6784\u6700\u4F18\u6838\u5FC3\u9F99\u5934\uFF08\u5C01\u6B7B/\u9996\u5C01\u6700\u65E9/\u5C01\u5355\u6700\u5927\uFF09"}">${esc(t)}</span>`).join("") : ""}
            ${p.openRecheck && p.openRecheck.need ? `<span class="pk-tag hl" title="${esc(p.openRecheck.tips)}">\u5F00\u76D8\u987B\u590D\u6838</span>` : ""}
            ${p.netOutflow ? `<span class="pk-outflow" title="${esc(NET_OUTFLOW_TAG)}\uFF1A\u8BE5\u7968\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70\u5165 \u2264 0\uFF0C\u5DF2\u6263\u7EFC\u5408\u5206 ${LHB_NET_OUTFLOW_PENALTY.SCORE} \u5206 / \u4E0A\u6DA8\u6982\u7387 ${LHB_NET_OUTFLOW_PENALTY.PROB} \u4E2A\u767E\u5206\u70B9\uFF0C\u4E14\u987B\u4EBA\u5DE5\u590D\u6838\u540E\u624D\u80FD\u4E0B\u5355\u3002">${esc(NET_OUTFLOW_TAG)}</span>` : ""}
          </div>
          <div class="pk-reasons">
            <span class="pk-tag muted">\u4F9D\u636E\uFF1A${esc(factorTxt)}</span>
            ${expC.median == null ? "" : `<span class="pk-tag hl" title="T \u65E5\u6536\u76D8\u4EF7\u4E70\u5165 \u2192 T+1 \u6536\u76D8\u7684\u5B9E\u6D4B\u4E2D\u4F4D\u6DA8\u5E45\uFF08\u540C\u7279\u5F81\u5206\u7EC4\uFF09">\u5386\u53F2\u540C\u7EC4\u4E2D\u4F4D ${expC.median > 0 ? "+" : ""}${expC.median}%</span>`}
            <span class="pk-tag muted" title="\u8BE5\u5206\u7EC4\u7684\u5B9E\u6D4B\u6837\u672C\u91CF\uFF0C\u6837\u672C\u8D8A\u5C0F\u53EF\u4FE1\u5EA6\u8D8A\u4F4E">\u6837\u672C ${prob.sample || "\u2014"} \u4F8B</span>
            ${lp.isStreak && lp.n ? `<span class="pk-tag muted" title="\u8FDE\u677F\u6982\u7387\u7684\u5B9E\u6D4B\u6837\u672C\u91CF\uFF08\u8FDE\u677F\u6863 \xD7 \u6362\u624B\u6863\u5206\u5C42\uFF09">\u8FDE\u677F\u6837\u672C ${lp.n} \u4F8B</span>` : ""}
            ${p.reasons.map((x) => `<span class="pk-tag ${TONE_CLS[x.tone] || "muted"}">${esc(x.text)}</span>`).join("")}
          </div>
          ${p.risks.length ? `<div class="pk-risks muted">\u98CE\u9669\uFF1A${esc(p.risks.join("\uFF1B"))}</div>` : ""}
          ${exp.warn ? `<div class="pk-risks bf-warn">${esc(exp.warn.replace(/\*\*/g, ""))}</div>` : ""}
        </div>
        <div class="pk-actions">
          <span class="pk-w" title="\u5EFA\u8BAE\u4ED3\u4F4D\uFF08\u5360\u603B\u8D44\u4EA7\uFF09">${p.suggestWeight > 0 ? (p.suggestWeight * 100).toFixed(1) + "%" : "\u89C2\u5BDF"}</span>
          <span class="pk-stop muted" title="\u6B62\u635F\u4F4D\uFF08\u7CFB\u7EDF\u5355\u7B14\u6B62\u635F\u7EAA\u5F8B\uFF09">\u6B62\u635F ${p.stop ? (p.stop.stopLossPct * 100).toFixed(0) : "\u2014"}%</span>
          <button class="mini pk-buy" type="button" data-act="pick-fill" data-code="${esc(p.code)}"
            title="\u628A\u8BE5\u80A1\u4EE3\u7801\u586B\u5165\u4E0B\u65B9\u4E0B\u5355\u533A">\u586B\u5165\u4E0B\u5355</button>
        </div>
      </div>`;
    }).join("");
  }
  const blocked = r.climaxBlocked || [];
  const trimmed = r.sectorTrimmed || [];
  if (box && (blocked.length || trimmed.length)) {
    box.innerHTML += `<details class="pk-rej"><summary>\u60C5\u7EEA\u95F8\u95E8\u62E6\u622A ${blocked.length + trimmed.length} \u53EA\uFF08\u70B9\u5F00\u770B\u539F\u56E0\uFF09</summary><div class="pk-rej-body">` + blocked.map((x) => `<div class="pk-rej-row"><span class="pk-rej-name">${esc(x.name)}</span><span class="pk-code muted">${esc(x.code)}</span><span class="pk-rej-why bf-warn">${esc(x.reason)}</span></div>`).join("") + trimmed.map((x) => `<div class="pk-rej-row"><span class="pk-rej-name">${esc(x.name)}</span><span class="pk-code muted">${esc(x.code)}</span><span class="pk-rej-why muted">${x.gateTags && x.gateTags.join("/") || "\u677F\u5757\u5185\u53BB\u5F31\u7559\u5F3A"}\uFF1A\u672A\u5165\u9009\u6838\u5FC3 1-2 \u53EA</span></div>`).join("") + `</div></details>`;
  }
  if (rejBox) {
    const rj = r.rejected || [];
    if (!rj.length) {
      rejBox.innerHTML = "";
    } else {
      rejBox.innerHTML = `<details class="pk-rej"><summary>\u5DF2\u5254\u9664 ${rj.length} \u53EA\u300C\u5927\u6982\u7387\u4E8F\u300D\u6807\u7684\uFF08\u70B9\u5F00\u770B\u539F\u56E0\uFF09</summary><div class="pk-rej-body">` + rj.map((p) => {
        const d = [];
        if (p.changePct != null) d.push(`\u5F53\u65E5 ${p.changePct > 0 ? "+" : ""}${p.changePct}%`);
        if (p.turnoverPct != null) d.push(`\u6362\u624B ${p.turnoverPct}%`);
        if (p.streak != null && p.streak > 1) d.push(`${p.streak} \u8FDE\u677F`);
        return `<div class="pk-rej-row"><span class="pk-rej-name">${esc(p.name || p.code)}</span><span class="pk-code muted">${esc(p.code)}</span><span class="pk-rej-why bf-warn">${esc(p.reason)}</span><span class="muted">${esc(d.join(" \xB7 "))}</span><div class="pk-rej-detail muted">${esc(String(p.why || "").replace(/\*\*/g, ""))}</div></div>`;
      }).join("") + `</div></details>`;
    }
  }
  if (note) {
    const n = r.note;
    note.innerHTML = `<span class="${n.level === "blocked" ? "bf-warn" : "muted"}">${esc(n.text)}</span> \u6392\u5E8F\u4F9D\u636E\uFF1A<b>\u8FDE\u677F\u6982\u7387\u8FBE\u95E8\u69DB\u7684\u7F6E\u9876\u6253\u6807\u7B7E</b>\uFF0C\u5176\u4F59\u6309\u9884\u6D4B\u4E0A\u6DA8\u6982\u7387\u964D\u5E8F\uFF08\u57FA\u4E8E ${r.pred && r.pred.baselineN || 975} \u4E2A\u6DA8\u505C\u6837\u672C\uFF0C\u57FA\u51C6\u4E0A\u6DA8\u5360\u6BD4 ${r.pred && r.pred.baselineUp || 55.3}%\uFF1B\u8FDE\u677F\u6982\u7387\u57FA\u4E8E\u540C\u6279\u6837\u672C\u7684 ${r.pred && r.pred.streakBaselineN || 976} \u4F8B\u5206\u5C42\u7EDF\u8BA1\uFF0C\u57FA\u51C6\u518D\u6DA8\u505C\u7387 ${r.streakBaseline == null ? 21.8 : r.streakBaseline}%\uFF09\u3002\u5254\u9664\u89C4\u5219\uFF1A\u6362\u624B\u226525%\u3001\u8FDE\u677F\u22655\u3001\u5317\u4EA4\u6240\u3001ST\u3001\u4EC5\u5C0F\u989D\u5916\u8D44\u91D1\u4E14\u65E0\u6DA8\u505C\u3002\u6570\u636E\u53D6\u81EA\u5F53\u65E5\u699C\uFF08\u533A\u95F4\u7D2F\u8BA1\u699C\u4E0E\u65B0\u80A1\u5DF2\u5254\u9664\uFF09\u3002<b>\u6982\u7387\u662F\u5386\u53F2\u7EDF\u8BA1\uFF0C\u4E0D\u662F\u6536\u76CA\u627F\u8BFA</b>\uFF0C\u4E14<b>\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE</b>\uFF0C\u4EC5\u4F9B\u6A21\u62DF\u76D8\u7EC3\u4E60\u53C2\u8003\uFF1B\u4E70\u5356\u7531\u4F60\u81EA\u884C\u5224\u65AD\u3002`;
  }
}
function qtyBySuggestWeight(code) {
  const c = String(code || "");
  const p = (currentPicks()?.picks || []).find((x) => x.code === c) || null;
  const pct2 = p && Number.isFinite(+p.suggestWeight) ? +p.suggestWeight : 0;
  const od = outflowOf(c);
  if (od) {
    return {
      qty: 0,
      pct: pct2,
      px: null,
      need: 0,
      capped: false,
      needReview: true,
      reason: `${FLAG_LHB.NET_OUTFLOW}\uFF1A\u5DF2\u6263\u7EFC\u5408\u5206 ${LHB_NET_OUTFLOW_PENALTY.SCORE} \u5206 / \u4E0A\u6DA8\u6982\u7387 ${LHB_NET_OUTFLOW_PENALTY.PROB} \u4E2A\u767E\u5206\u70B9\uFF0C\u8FDB\u5165\u5907\u9009\u89C2\u5BDF\u6C60\u3002\u7CFB\u7EDF\u4E0D\u4EE3\u586B\u6570\u91CF\u2014\u2014\u8BF7\u5148\u4EBA\u5DE5\u590D\u6838\uFF0C\u5E76\u81EA\u884C\u51B3\u5B9A\u4E70\u591A\u5C11`
    };
  }
  if (!(pct2 > 0)) {
    return {
      qty: 0,
      pct: pct2,
      px: null,
      need: 0,
      capped: false,
      reason: "\u5F53\u524D\u6863\u4F4D\u4E0D\u5EFA\u8BAE\u65B0\u5EFA\u4ED3\uFF08\u5EFA\u8BAE\u6BD4\u4F8B\u4E3A 0\uFF09\u2014\u2014\u53EF\u624B\u52A8\u586B\u6570\u91CF"
    };
  }
  const info = lookup(c);
  if (!info || !info.board.tradable || !info.fresh || !info.price) {
    return {
      qty: 0,
      pct: pct2,
      px: null,
      need: 0,
      capped: false,
      reason: "\u53D6\u4E0D\u5230\u8BE5\u80A1\u771F\u5B9E\u4EF7\u683C\uFF0C\u65E0\u6CD5\u6309\u6BD4\u4F8B\u4F30\u91CF\u2014\u2014\u8BF7\u5148\u62C9\u5230\u884C\u60C5"
    };
  }
  if (!ACCT) {
    return { qty: 0, pct: pct2, px: null, need: 0, capped: false, reason: "\u6A21\u62DF\u8D26\u6237\u672A\u5C31\u7EEA" };
  }
  const px = fillPrice(info.price, "buy", SLIP);
  const st = accountStats(ACCT);
  const r = qtyByAssetPct(st.total, pct2, px, { cash: ACCT.cash });
  if (r.qty <= 0) {
    return {
      qty: 0,
      pct: pct2,
      px,
      need: 0,
      capped: true,
      reason: `\u9884\u7B97 ${num2(st.total * pct2)} \u5143\u4E0D\u8DB3\u4E00\u624B\uFF08\u4E00\u624B\u7EA6 ${num2(px * LOT + MIN_COMMISSION)} \u5143\uFF0C\u542B\u6700\u4F4E\u4F63\u91D1\uFF09`
    };
  }
  return { qty: r.qty, pct: pct2, px, need: r.need, capped: !!r.capped, reason: null };
}
function fillPickToOrder(code) {
  const c = String(code || "");
  if (!c) return;
  if (ORDER.code !== c) clearReview();
  const s = qtyBySuggestWeight(c);
  ORDER = { ...ORDER, code: c, qty: s.qty, side: "buy" };
  syncOrderInputs();
  renderOrderForm();
  renderQuick();
  const nm = LIVEQ[c]?.name || lookup(c)?.name || "";
  if (s.needReview) {
    msg(`\u5DF2\u586B\u5165 ${c} ${nm}\uFF0C\u4F46**\u6570\u91CF\u7559\u7A7A**\uFF1A${s.reason}`, "err");
    $("poQty")?.focus?.();
    return;
  }
  const said = s.qty > 0 ? `\u5DF2\u586B\u5165 ${c} ${nm} \u5EFA\u8BAE ${(s.pct * 100).toFixed(1)}% \u2192 ${s.qty} \u80A1\uFF08\u7EA6 ${num2(s.need)} \u5143\u542B\u8D39\u7528\uFF09${s.capped ? "\uFF0C\u5DF2\u53D7\u53EF\u7528\u8D44\u91D1\u9650\u5236" : ""}` : `\u5DF2\u586B\u5165 ${c} ${nm}\uFF0C\u4F46\u6570\u91CF\u7559\u7A7A\uFF1A${s.reason}`;
  if (!LIVEQ[c] && !LIVE_BUSY) {
    msg(`\u6B63\u5728\u83B7\u53D6 ${c} \u5B9E\u65F6\u884C\u60C5\u2026`, "ok");
    refreshLive([c]).then((r) => {
      const s2 = r.ok ? qtyBySuggestWeight(c) : s;
      if (s2.needReview) {
        ORDER = { ...ORDER, qty: 0 };
        syncOrderInputs();
        renderOrderForm();
        renderQuick();
        msg(`${c} ${FLAG_LHB.NET_OUTFLOW}\uFF0C\u6570\u91CF\u7559\u7A7A\uFF1A${s2.reason}`, "err");
        return;
      }
      if (r.ok && s2.qty !== s.qty) {
        ORDER = { ...ORDER, qty: s2.qty };
        syncOrderInputs();
        renderOrderForm();
      }
      renderQuick();
      msg(r.ok ? `\u5DF2\u586B\u5165 ${c} ${LIVEQ[c]?.name || nm}` + (s2.qty > 0 ? ` \u5EFA\u8BAE ${(s2.pct * 100).toFixed(1)}% \u2192 ${s2.qty} \u80A1\uFF08\u6309\u5B9E\u65F6\u4EF7\u91CD\u7B97\uFF09` : `\uFF0C\u6570\u91CF\u7559\u7A7A\uFF1A${s2.reason}`) : `${c} \u53D6\u4E0D\u5230\u884C\u60C5\uFF0C\u8BF7\u6838\u5BF9\u4EE3\u7801`, r.ok ? "ok" : "err");
    });
  } else {
    msg(said, s.qty > 0 ? "ok" : "err");
  }
  $("poQty")?.focus?.();
}
function pickDetail(code) {
  const r = currentPicks();
  const p = r && r.picks.find((x) => x.code === code);
  if (!p) return null;
  const info = lookup(code);
  const netTxt = p.netWan == null || !Number.isFinite(+p.netWan) ? '<span class="muted">\u65E0\u5F53\u65E5\u9F99\u864E\u699C\u51C0\u4E70\u8BB0\u5F55</span>' : `<span class="${p.netWan > 0 ? "hl" : "hl-dn"}">${(p.netWan / 1e4).toFixed(2)} \u4EBF</span>`;
  const parts = p.scoreParts || {};
  const prob = p.prob || {};
  const exp = p.exp || {};
  const expC = exp.atClose || {};
  const expO = exp.atOpen || {};
  const stop = p.stop || {};
  const bar = (label, w, v) => [
    `${label}\uFF08\u6743\u91CD ${Math.round(w * 100)}%\uFF09`,
    `${(v * 100).toFixed(0)} \u5206 <span class="muted">\u2192 \u8D21\u732E ${(w * v * 100).toFixed(1)}</span>`
  ];
  const bandCls = (prob.band && prob.band.key) === "high" ? "pb-high" : (prob.band && prob.band.key) === "mid" ? "pb-mid" : (prob.band && prob.band.key) === "low" ? "pb-low" : "pb-poor";
  const lp = p.limitUp || {};
  const sbCls = (lp.band && lp.band.key) === "high" ? "pb-high" : (lp.band && lp.band.key) === "mid" ? "pb-mid" : (lp.band && lp.band.key) === "low" ? "pb-low" : "pb-poor";
  return {
    title: `${esc(p.name || code)}\u3000${esc(code)}`,
    sub: `\u7814\u5224\u63A8\u8350\u7B2C ${r.picks.indexOf(p) + 1} \u4F4D \xB7 \u4E0A\u6DA8\u6982\u7387 ${prob.score == null ? "\u2014" : prob.score.toFixed(1)}${lp.isStreak && lp.prob != null ? ` \xB7 \u8FDE\u677F\u6982\u7387 ${lp.prob}%` : ""} \xB7 \u6570\u636E\u65E5\u671F ${esc(r.asOf || "\u2014")}`,
    body: (p.streakTop ? dwSection(
      "\u8FDE\u677F\u9884\u6D4B\uFF1AT+1 \u5927\u6982\u7387\u518D\u6DA8\u505C\uFF08\u5DF2\u7F6E\u9876\uFF09",
      dwKv([
        ["\u8FDE\u677F\u6982\u7387", `<span class="${sbCls}">${lp.prob == null ? "\u2014" : lp.prob}%</span>\u3000<span class="muted">${esc(lp.band && lp.band.label || "")}\u3000${esc(lp.band && lp.band.desc || "")}</span>`],
        ["\u8FD9\u4E2A\u6570\u662F\u4EC0\u4E48", `<span class="muted">\u5386\u53F2\u540C\u7279\u5F81\u7EC4\u91CC <b>T+1 \u518D\u6B21\u6DA8\u505C\u7684\u5360\u6BD4</b>\u2014\u2014\u4E0E\u4E0A\u9762\u7684\u300C\u4E0A\u6DA8\u6982\u7387\u300D\u662F\u4E24\u4E2A\u76EE\u6807\u3002\u57FA\u51C6\uFF08\u5168\u90E8\u6DA8\u505C\u80A1\uFF09\u4E3A ${r.streakBaseline == null ? 21.8 : r.streakBaseline}%\u3002</span>`],
        ["\u5B9E\u6D4B\u5206\u7EC4", `${esc(lp.group || "\u2014")}\u3000<span class="muted">\u6837\u672C ${lp.n || "\u2014"} \u4F8B\uFF08\u8FDE\u677F\u6863 \xD7 \u6362\u624B\u6863\u5206\u5C42\u8868\uFF09</span>`],
        ["\u26A0 \u6301\u6709\u98CE\u9669", `<span class="bf-warn">\u8BE5\u7EC4 T+3 \u4E2D\u4F4D ${lp.t3Med == null ? "\u2014" : lp.t3Med}%</span>\u3000<span class="muted">\u8FDE\u677F\u662F<b>\u77ED\u6253\u903B\u8F91</b>\uFF1AT+1 \u51B2\u9AD8\u4E0D\u5C01\u677F\u5C31\u8BE5\u8D70\uFF0C\u4E0D\u662F\u300C\u5F3A\u52BF\u53EF\u6301\u6709\u300D\u3002</span>`]
      ]) + `<div class="dw-note">${esc(lp.note || "")}</div><div class="dw-note muted">\u8FDE\u677F\u6982\u7387\u9AD8 \u2260 \u76C8\u5229\u786E\u5B9A\uFF1A\u5B9E\u6D4B 3 \u677F\u4F4E\u6362\u624B\u7EC4\u7684\u518D\u6DA8\u505C\u7387\u867D\u6709 54.2%\uFF0C\u4F46\u8BE5\u7EC4 T+3 \u4E2D\u4F4D \u22123.10%\u2014\u2014<b>\u8FDE\u5F97\u4E0A\u4E0D\u4EE3\u8868\u62FF\u5F97\u4F4F</b>\uFF0C\u8BF7\u6309\u6B21\u65E5\u4E0D\u5C01\u677F\u5373\u79BB\u573A\u7684\u7EAA\u5F8B\u6267\u884C\u3002</div>`
    ) : "") + dwSection("\u9884\u6D4B\uFF1A\u4E3A\u4EC0\u4E48\u8BA4\u4E3A\u5B83\u5927\u6982\u7387\u4F1A\u6DA8", dwKv([
      ["\u4E0A\u6DA8\u6982\u7387\u5206", `<span class="${bandCls}">${prob.score == null ? "\u2014" : prob.score.toFixed(1)}</span>\u3000<span class="muted">${esc(prob.band && prob.band.label || "\u2014")}\u3000${esc(prob.band && prob.band.desc || "")}</span>`],
      ["\u8FD9\u4E2A\u5206\u662F\u4EC0\u4E48", `<span class="muted">\u5386\u53F2\u540C\u7279\u5F81\u7EC4\u7684<b>\u5B9E\u9645\u4E0A\u6DA8\u5360\u6BD4</b>\u2014\u2014\u4E0D\u662F\u4E3B\u89C2\u7F6E\u4FE1\u5EA6\uFF0C\u4E5F\u4E0D\u662F\u6536\u76CA\u9884\u6D4B\u3002\u57FA\u51C6\uFF08\u5168\u90E8\u6DA8\u505C\u80A1\uFF09\u4E3A ${prob.baseline == null ? "\u2014" : prob.baseline}%\u3002</span>`],
      ["\u547D\u4E2D\u7684\u5B9E\u6D4B\u56E0\u5B50", prob.factors && prob.factors.length ? prob.factors.map((f) => `<span class="pk-tag hl">${esc(f.label)} ${f.adj > 0 ? "+" : ""}${f.adj}pt</span>`).join(" ") : '<span class="muted">\u65E0\uFF08\u6309\u57FA\u51C6\u6982\u7387\u5904\u7406\uFF09</span>'],
      ["\u6700\u5F31\u8BC1\u636E\u6837\u672C\u91CF", `${prob.sample == null ? "\u2014" : prob.sample} \u4F8B\u3000<span class="muted">\u53D6\u6240\u6709\u547D\u4E2D\u56E0\u5B50\u91CC\u6700\u5C0F\u7684\u6837\u672C\u91CF\uFF08\u6728\u6876\u539F\u7406\uFF09</span>`]
    ]) + (prob.factors && prob.factors.length ? `<div class="dw-note">${prob.factors.map((f) => "\xB7 " + esc(f.note)).join("<br>")}</div>` : "")) + dwSection("\u9884\u671F\u6536\u76CA\uFF08\u5B9E\u6D4B\u5206\u7EC4\u4E2D\u4F4D\u6570\uFF09", dwKv([
      ["T \u65E5\u6536\u76D8\u4E70\u5165 \u2192 T+1 \u6536\u76D8", expC.median == null ? "\u2014" : `<span class="${expC.median > 0 ? "hl" : "hl-dn"}">${expC.median > 0 ? "+" : ""}${expC.median}%</span>\u3000<span class="muted">${esc(expC.group || "")}\u3000n=${expC.n || "\u2014"}</span>`],
      ["T+1 \u5F00\u76D8\u4E70\u5165 \u2192 T+1 \u6536\u76D8", expO.median == null ? "\u2014" : `<span class="${expO.median > 0 ? "hl" : "hl-dn"}">${expO.median > 0 ? "+" : ""}${expO.median}%</span>\u3000<span class="muted">${esc(expO.group || "")}\u3000n=${expO.n || "\u2014"}</span>`]
    ]) + (exp.warn ? `<div class="dw-note bf-warn">${esc(String(exp.warn).replace(/\*\*/g, ""))}</div>` : '<div class="dw-note muted">\u8BE5\u5206\u7EC4\u65E0\u5B9E\u6D4B\u6B63\u671F\u671B\u8BB0\u5F55\u3002</div>')) + dwSection("\u6B62\u635F\u4E0E\u4ED3\u4F4D", dwKv([
      ["\u6B62\u635F\u4F4D", `<span class="bf-warn">${(stop.stopLossPct * 100).toFixed(0)}%</span>\u3000<span class="muted">\u7CFB\u7EDF\u5355\u7B14\u6B62\u635F\u7EAA\u5F8B</span>`],
      ["\u5B9E\u6D4B 3 \u65E5\u5E73\u5747\u6700\u5927\u56DE\u64A4", stop.maxDD == null ? "\u2014" : `${stop.maxDD}%`],
      ["\u4ED3\u4F4D\u7CFB\u6570", `${stop.maxPosFactor == null ? 1 : stop.maxPosFactor} \u500D\u3000<span class="muted">\u5BBD\u6CE2\u52A8\u54C1\u79CD\u81EA\u52A8\u6253\u6298</span>`],
      ["\u672C\u80A1\u5EFA\u8BAE", p.suggestWeight > 0 ? `${(p.suggestWeight * 100).toFixed(1)}% \u603B\u8D44\u4EA7\uFF08${num2(p.suggestWeight * accountStats(ACCT).total)} \u5143\uFF09` : '<span class="bf-warn">\u5F53\u524D\u6863\u4F4D\u4E0D\u5EFA\u8BAE\u65B0\u5EFA\u4ED3\uFF0C\u4EC5\u4F9B\u89C2\u5BDF</span>']
    ]) + `<div class="dw-note">${esc(String(stop.reason || "").replace(/\*\*/g, ""))}</div>`) + dwSection("\u4E3A\u4EC0\u4E48\u5165\u9009\uFF08\u539F\u59CB\u8BC1\u636E\uFF09", dwKv([
      ["\u9F99\u864E\u699C\u5F53\u65E5\u51C0\u4E70", netTxt],
      ["\u6DA8\u505C / \u8FDE\u677F", p.isZt ? p.streak > 1 ? `\u6DA8\u505C\uFF08${p.streak} \u8FDE\u677F\uFF09` : "\u6DA8\u505C" : '<span class="muted">\u672A\u6DA8\u505C</span>'],
      ["\u4E3B\u7EBF\u9898\u6750", p.mainThemeMatch === "exact" ? "\u5C5E\u5F53\u65E5\u4E3B\u7EBF\u9898\u6750" : p.mainThemeMatch === "stem" ? '<span class="bf-warn">\u4E0E\u4E3B\u7EBF\u9898\u6750\u540C\u6E90\uFF08\u8BCD\u6839\u5339\u914D\uFF0C\u975E\u7CBE\u786E\u547D\u4E2D\uFF09</span>' : '<span class="muted">\u4E0D\u5728\u5F53\u65E5\u4E3B\u7EBF\u5185</span>'],
      ["\u6240\u5C5E\u9898\u6750", p.themes && p.themes.length ? esc(p.themes.join("\u3001")) : '<span class="muted">\u2014</span>'],
      ["\u6362\u624B\u7387", p.turnoverPct == null ? "\u2014" : `${p.turnoverPct}%`],
      ["\u73B0\u4EF7\uFF08\u5F53\u6863\u6536\u76D8\uFF09", p.close == null ? "\u2014" : `${p.close} \u5143`]
    ])) + (p.netOutflow ? dwSection(`\u26A0 \u89C4\u5219\u964D\u7EA7\uFF1A${NET_OUTFLOW_TAG}`, dwKv([
      ["\u547D\u4E2D\u89C4\u5219", `<span class="bf-warn">\u9F99\u864E\u699C\u5F53\u65E5\u51C0\u4E70\u5165 \u2264 0</span>\u3000<span class="muted">\u552F\u4E00\u51FA\u5904 src/lhbfilter.js\uFF08\u7968\u6570\u6876 + \u6263\u5206\uFF09</span>`],
      ["\u7EFC\u5408\u5206\u6263\u51CF", `\u2212${LHB_NET_OUTFLOW_PENALTY.SCORE} \u5206\u3000<span class="muted">${p.scoreRaw == null ? "\u2014" : p.scoreRaw} \u2192 ${p.score == null ? "\u2014" : p.score}${p.scorePenalty ? "\uFF08\u5DF2\u751F\u6548\uFF09" : "\uFF08\u8BE5\u5206\u5236\u4E0B\u6263\u51CF\u4E3A\u5C55\u793A\u53E3\u5F84\uFF09"}</span>`],
      ["\u4E0A\u6DA8\u6982\u7387\u6263\u51CF", `\u2212${LHB_NET_OUTFLOW_PENALTY.PROB} \u4E2A\u767E\u5206\u70B9\u3000<span class="muted">${prob.rawScore == null ? "\u2014" : prob.rawScore} \u2192 ${prob.score == null ? "\u2014" : prob.score}</span>`],
      ["\u5904\u7F6E", `<span class="bf-warn">\u8FDB\u5165\u5907\u9009\u89C2\u5BDF\u6C60\uFF08\u7981\u6B62\u81EA\u52A8\u4E0B\u5355\uFF09\uFF1B<b>\u4EBA\u5DE5\u590D\u6838\u540E\u65B9\u53EF\u4E0B\u5355</b></span>\u3000<span class="muted">\u7CFB\u7EDF\u4E0D\u4F1A\u4EE3\u586B\u4E70\u5165\u6570\u91CF</span>`]
    ]) + `<div class="dw-note bf-warn">${esc(String(p.scoreOutflow || ""))}</div><div class="dw-note muted">\u8FD9\u4E0D\u662F"\u4E0D\u5EFA\u8BAE\u5173\u6CE8"\uFF0C\u800C\u662F"\u4ECA\u5929\u5B83\u6CA1\u6709\u8D44\u91D1\u8BC1\u636E\u652F\u6301"\uFF1A\u89C4\u5219\u53EA\u964D\u4F18\u5148\u7EA7\u3001\u4E0D\u7981\u6B62\u59D4\u6258\u2014\u2014\u82E5\u4F60\u53E6\u6709\u4F9D\u636E\uFF0C\u53EF\u4EE5\u4EBA\u5DE5\u590D\u6838\u540E\u81EA\u884C\u51B3\u5B9A\u4E0B\u5355\u6570\u91CF\u3002\u4F46\u586B\u91CF\u4E0E\u4E0B\u5355\u7684\u8D23\u4EFB\u968F\u590D\u6838\u4E00\u5E76\u56DE\u5230\u4F60\u624B\u4E0A\uFF0C\u7CFB\u7EDF\u4E0D\u518D\u4EE3\u52B3\u3002</div>`) : "") + dwSection("\u5C55\u793A\u5206\uFF08\u65E7\u53E3\u5F84\uFF0C\u4EC5\u4F9B\u53C2\u8003\uFF09", dwKv([
      bar("\u8D44\u91D1\u9762 \xB7 \u9F99\u864E\u699C\u51C0\u4E70", SCORE_WEIGHTS.fund, parts.fund || 0),
      bar("\u8FDE\u677F\u9AD8\u5EA6", SCORE_WEIGHTS.streak, parts.streak || 0),
      bar("\u4E3B\u7EBF\u9898\u6750", SCORE_WEIGHTS.theme, parts.theme || 0),
      bar("\u6D41\u52A8\u6027 \xB7 \u5360\u5168\u699C\u6BD4\u91CD", SCORE_WEIGHTS.liquidity, parts.liquidity || 0)
    ]) + '<div class="dw-note muted">\u8FD9\u662F\u5347\u7EA7\u524D\u7684\u52A0\u6743\u5206\uFF08\u6743\u91CD\u548C\u4E3A 1\uFF09\uFF0C\u73B0\u5728**\u4E0D\u518D\u7528\u4E8E\u6392\u5E8F**\u2014\u2014\u5B9E\u6D4B\u663E\u793A\u300C\u8D44\u91D1\u9762/\u9898\u6750\u300D\u8FD9\u7C7B\u56E0\u5B50\u7684\u8FB9\u9645\u9884\u6D4B\u529B\u5F31\u4E8E\u8FDE\u677F\u4E0E\u6362\u624B\uFF0C\u6545\u6392\u5E8F\u5DF2\u6539\u4E3A\u4E0A\u6DA8\u6982\u7387\u5206\u3002</div>') + dwSection("\u98CE\u9669\u63D0\u793A", p.risks.length ? `<div class="dw-note">${p.risks.map((x) => "\xB7 " + esc(x)).join("<br>")}</div>` : '<div class="dw-empty">\u6309\u5F53\u524D\u89C4\u5219\u672A\u547D\u4E2D\u98CE\u9669\u7279\u5F81\uFF08\u4E0D\u4EE3\u8868\u65E0\u98CE\u9669\uFF09</div>') + dwSection("\u5B9E\u65F6\u884C\u60C5", info ? dwKv([["\u6700\u65B0\u4EF7", `${num2(info.price)} \u5143`], ["\u6DA8\u8DCC\u5E45", `<span class="${(info.changePct || 0) >= 0 ? "hl" : "hl-dn"}">${pct(info.changePct)}</span>`], ["\u4EF7\u683C\u6765\u6E90", esc(info.srcLabel || "\u2014")]]) : '<div class="dw-empty">\u53D6\u4E0D\u5230\u5B9E\u65F6\u884C\u60C5</div>') + `<div class="dw-note"><b>\u6982\u7387\u662F\u5386\u53F2\u7EDF\u8BA1\uFF0C\u4E0D\u662F\u6536\u76CA\u627F\u8BFA\u3002</b>\u672C\u63A8\u8350\u7531\u89C4\u5219\u5F15\u64CE\u6309\u5F53\u6863\u6570\u636E\u81EA\u52A8\u751F\u6210\uFF0C<b>\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE</b>\u3002\u662F\u5426\u4E70\u5356\u3001\u4E70\u591A\u5C11\uFF0C\u7531\u4F60\u81EA\u884C\u5224\u65AD\u3002</div>`
  };
}
function drawerEl() {
  return document.getElementById("drawer");
}
function dwSection(h, body) {
  return `<div class="dw-sec"><div class="dw-h">${esc(h)}</div>${body}</div>`;
}
function dwKv(pairs) {
  return `<div class="dw-kv">${pairs.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${v}</div>`).join("")}</div>`;
}
function openPaperDrawer(v) {
  const d = drawerEl();
  if (!d || !v) return;
  document.getElementById("dwTitle").innerHTML = v.title || "";
  document.getElementById("dwSub").innerHTML = v.sub || "";
  document.getElementById("dwBody").innerHTML = v.body || "";
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  document.getElementById("drawerMask")?.classList.add("open");
}
function statDetail(k) {
  const st = accountStats(ACCT);
  const common = [["\u521D\u59CB\u8D44\u91D1", `${st.initCash.toLocaleString()} \u5143\uFF08\u865A\u62DF\uFF09`], ["\u5F53\u524D\u603B\u8D44\u4EA7", `${num2(st.total)} \u5143`]];
  const M = {
    \u603B\u8D44\u4EA7: {
      pairs: [
        ...common,
        ["\u6784\u6210", `\u53EF\u7528 ${num2(st.cash)} + \u51BB\u7ED3 ${num2(st.freeze)} + \u5E02\u503C ${num2(st.marketValue)}`],
        ["\u6052\u7B49\u5F0F", `\u603B\u8D44\u4EA7 \u2212 \u521D\u59CB = \u5DF2\u5B9E\u73B0 ${num2(st.realized)} + \u6D6E\u52A8 ${num2(st.floatPnl)}`]
      ],
      note: "\u5E02\u503C\u6309\u6700\u65B0\u771F\u5B9E\u6536\u76D8\u4EF7\u8BA1\uFF1B\u51BB\u7ED3\u6765\u81EA\u672A\u6210\u4EA4\u7684\u4E70\u5165\u59D4\u6258\u3002"
    },
    \u53EF\u7528\u8D44\u91D1: { pairs: [...common, ["\u53EF\u7528", `${num2(st.cash)} \u5143`], ["\u51BB\u7ED3\u4E2D", `${num2(st.freeze)} \u5143`]], note: "\u4E70\u5165\u6302\u5355\u4F1A\u9884\u51BB\u7ED3\u8D44\u91D1\uFF08\u4ECA\u6536\u4EF7 + \u8D39\u7528\uFF09\uFF0C\u64A4\u5355\u6216\u6210\u4EA4\u540E\u91CA\u653E\u3002" },
    \u51BB\u7ED3\u8D44\u91D1: { pairs: [...common, ["\u51BB\u7ED3", `${num2(st.freeze)} \u5143`], ["\u6765\u6E90", `${(ACCT.pending || []).filter((p) => p.side === "buy").length} \u5F20\u5F85\u6210\u4EA4\u4E70\u5355`]], note: "\u771F\u5B9E\u5238\u5546\u7684\u540C\u4E00\u884C\u4E3A\uFF1A\u59D4\u6258\u63D0\u4EA4\u5373\u51BB\u7ED3\uFF0C\u6210\u4EA4\u65F6\u6309\u5B9E\u9645\u4EF7\u7ED3\u7B97\u3002" },
    \u6301\u4ED3\u5E02\u503C: { pairs: [...common, ["\u5E02\u503C", `${num2(st.marketValue)} \u5143`], ["\u6301\u4ED3\u6210\u672C", `${num2(st.costValue)} \u5143`], ["\u6301\u4ED3\u6570", `${st.posCount} \u53EA`]], note: "\u53D6\u4E0D\u5230\u6700\u65B0\u884C\u60C5\u7684\u7968\u6CBF\u7528\u4E0A\u4E00\u4EF7\u5E76\u6807\u300C\u65E7\u4EF7\u300D\uFF0C\u4E0D\u4F1A\u5F52\u96F6\u3002" },
    \u6D6E\u52A8\u76C8\u4E8F: { pairs: [...common, ["\u6D6E\u52A8\u76C8\u4E8F", `${num2(st.floatPnl)} \u5143`], ["\u5E45\u5EA6", pct(st.floatPnlPct * 100)]], note: "\uFF1D\u6700\u65B0\u5E02\u503C \u2212 \u6301\u4ED3\u6210\u672C\uFF1B\u6210\u672C\u542B\u4E70\u5165\u65F6\u7684\u4F63\u91D1\u4E0E\u8FC7\u6237\u8D39\uFF0C\u6240\u4EE5\u300C\u5E73\u4EF7\u5356\u51FA\u300D\u4E5F\u662F\u4E8F\u7684\u3002" },
    \u5DF2\u5B9E\u73B0\u76C8\u4E8F: { pairs: [...common, ["\u5DF2\u5B9E\u73B0", `${num2(st.realized)} \u5143`]], note: "\u6E05\u4ED3\u6216\u90E8\u5206\u5356\u51FA\u65F6\u7ED3\u8F6C\uFF1A\u5356\u51FA\u51C0\u6536\u5165\uFF08\u6263\u4F63\u91D1/\u8FC7\u6237\u8D39/\u5370\u82B1\u7A0E\uFF09\u2212 \u5BF9\u5E94\u80A1\u4EFD\u7684\u6301\u4ED3\u6210\u672C\u3002" },
    \u7D2F\u8BA1\u8D39\u7528: {
      pairs: [
        ...common,
        ["\u7D2F\u8BA1", `${num2(st.totalFee)} \u5143`],
        ["\u5360\u521D\u59CB\u8D44\u91D1", pct(st.totalFee / st.initCash * 100)],
        ["\u4F63\u91D1\u8D39\u7387", `\u4E07\u4E09\uFF08\u5355\u7B14\u6700\u4F4E ${MIN_COMMISSION} \u5143\uFF09`],
        ["\u8FC7\u6237\u8D39", "\u4E070.1\uFF08\u53CC\u8FB9\uFF09"],
        ["\u5370\u82B1\u7A0E", "\u4E07\u4E94\uFF08\u4EC5\u5356\u51FA\uFF09"],
        ["\u6ED1\u70B9", `\u4E07${SLIP * 1e4}\uFF08\u4E70\u5165\u62AC\u4EF7 / \u5356\u51FA\u538B\u4EF7\uFF09`]
      ],
      note: "\u6ED1\u70B9\u662F\u6A21\u62DF\u7684\u51B2\u51FB\u6210\u672C\uFF0C\u4E0D\u8FDB\u5165\u300C\u7D2F\u8BA1\u8D39\u7528\u300D\uFF08\u5B83\u4E0D\u662F\u4ED8\u7ED9\u5238\u5546\u7684\u8D39\u7528\uFF0C\u800C\u662F\u6210\u4EA4\u4EF7\u7684\u8BA9\u4EF7\uFF09\u3002"
    },
    \u8D26\u6237\u6536\u76CA\u7387: { pairs: [...common, ["\u6536\u76CA\u7387", pct(st.retPct)], ["\u7EDD\u5BF9\u6536\u76CA", `${num2(st.total - st.initCash)} \u5143`]], note: "\uFF1D\uFF08\u603B\u8D44\u4EA7 \u2212 \u521D\u59CB\u8D44\u91D1\uFF09\xF7 \u521D\u59CB\u8D44\u91D1\u3002" }
  };
  const d = M[k];
  if (!d) return null;
  return { title: `\u8D26\u6237\u6307\u6807 \xB7 ${k}`, sub: `\u6570\u636E\u65E5 ${LAST_DATE || "\u2014"} \xB7 \u5168\u90E8\u6309\u771F\u5B9E\u884C\u60C5\u4E0E A \u80A1\u73B0\u884C\u5236\u5EA6\u8BA1\u7B97`, body: dwSection("\u53E3\u5F84", dwKv(d.pairs)) + `<div class="dw-note">${d.note}</div>` };
}
function posDetail(code) {
  const p = ACCT.positions?.[code];
  if (!p) return null;
  const info = lookup(code);
  const mv = (p.last ?? p.avgCost) * p.qty;
  const pnl = mv - (p.cost || 0);
  const frozen = (ACCT.pending || []).filter((x) => x.code === code && x.side === "sell").reduce((a, x) => a + x.qty, 0);
  const trades = (ACCT.trades || []).filter((t) => t.code === code);
  const buyGross = trades.filter((t) => t.side === "buy").reduce((a, t) => a + t.gross, 0);
  const buyFee = trades.filter((t) => t.side === "buy").reduce((a, t) => a + t.fee, 0);
  return {
    title: `${esc(p.name || code)}\u3000${esc(code)}`,
    sub: `\u6301\u4ED3 ${p.qty} \u80A1 \xB7 \u6210\u672C ${num2(p.avgCost, 3)} \xB7 \u73B0\u4EF7 ${num2(p.last)} \xB7 \u6D6E\u52A8 ${num2(pnl)}`,
    body: dwSection("\u6301\u4ED3\u660E\u7EC6", dwKv([
      ["\u4EE3\u7801 / \u540D\u79F0", `${esc(code)} ${esc(p.name || "")}`],
      ["\u677F\u6BB5 / \u6DA8\u8DCC\u505C", `${esc(info?.board?.label || "\u2014")} \xB1${info?.limitPct != null ? (info.limitPct * 100).toFixed(0) : "\u2014"}%${info?.st ? "\uFF08ST\uFF09" : ""}`],
      ["\u6301\u4ED3\u6570\u91CF", `${p.qty} \u80A1`],
      ["\u53EF\u5356\u6570\u91CF", `${Math.max(0, (p.avail || 0) - frozen)} \u80A1${frozen ? `\uFF08\u53E6\u6709 ${frozen} \u80A1\u88AB\u5356\u5355\u51BB\u7ED3\uFF09` : ""}`],
      ["T+1 \u8BF4\u660E", (p.avail || 0) < p.qty ? `<span class="bf-warn">${p.qty - (p.avail || 0)} \u80A1\u4E3A\u5F53\u65E5\u4E70\u5165\uFF0C\u6B21\u4E00\u4EA4\u6613\u65E5\u53EF\u5356</span>` : "\u5168\u90E8\u53EF\u5356"],
      ["\u52A0\u6743\u5E73\u5747\u6210\u672C", `${num2(p.avgCost, 4)} \u5143\uFF08\u542B\u4E70\u5165\u8D39\u7528\uFF09`],
      ["\u6301\u4ED3\u603B\u6210\u672C", `${num2(p.cost)} \u5143`],
      ["\u6700\u65B0\u4EF7", `${num2(p.last)} \u5143${p.pxStale ? ' <span class="bf-warn">\uFF08\u6700\u8FD1\u4E00\u6863\u65E0\u884C\u60C5\uFF0C\u6CBF\u7528\u4E0A\u4E00\u4EF7\uFF09</span>' : ""}`],
      ["\u5E02\u503C", `${num2(mv)} \u5143`],
      ["\u6D6E\u52A8\u76C8\u4E8F", `<span class="${cls(pnl)}">${num2(pnl)} \u5143\uFF08${pct(p.cost ? pnl / p.cost * 100 : 0)}\uFF09</span>`],
      ["\u5EFA\u4ED3\u65E5 / \u6301\u6709", `${esc(p.openDate || "\u2014")} \xB7 ${p.days || 0} \u4E2A\u4EA4\u6613\u65E5`]
    ])) + dwSection("\u4E70\u5165\u6210\u672C\u6784\u6210", dwKv([
      ["\u7D2F\u8BA1\u4E70\u5165\u91D1\u989D", `${num2(buyGross)} \u5143`],
      ["\u7D2F\u8BA1\u4E70\u5165\u8D39\u7528", `${num2(buyFee)} \u5143`],
      ["\u8D39\u7528\u5360\u6BD4", buyGross ? pct(buyFee / buyGross * 100, 3) : "\u2014"]
    ]) + `<div class="dw-note">\u6210\u672C = \u4E70\u5165\u91D1\u989D + \u4E70\u5165\u8D39\u7528\uFF1B\u56E0\u6B64\u628A\u6301\u4ED3\u6309\u6210\u672C\u4EF7\u5356\u51FA\u4ECD\u662F\u4E8F\u7684\uFF08\u8FD8\u8981\u518D\u6263\u4E00\u904D\u5356\u51FA\u8D39\u7528\u4E0E\u5370\u82B1\u7A0E\uFF09\u3002</div>`) + (trades.length ? dwSection(
      "\u8BE5\u80A1\u6210\u4EA4\u8BB0\u5F55",
      `<table class="dw-tb"><thead><tr><th>\u6210\u4EA4\u65E5</th><th>\u65B9\u5411</th><th class="num">\u6570\u91CF</th><th class="num">\u4EF7\u683C</th><th class="num">\u8D39\u7528</th></tr></thead><tbody>` + trades.map((t) => `<tr><td>${esc(t.fillDate)}</td><td class="${t.side === "buy" ? "hl" : "hl-dn"}">${t.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"}</td><td class="num">${t.qty}</td><td class="num">${num2(t.price)}</td><td class="num">${num2(t.fee)}</td></tr>`).join("") + "</tbody></table>"
    ) : "") + `<div class="dw-note">\u6A21\u62DF\u5668\u4E0D\u63D0\u4F9B\u81EA\u52A8\u4EA4\u6613\uFF1A\u4E70\u5356\u4E00\u5F8B\u7531\u4F60\u51B3\u5B9A\uFF0C\u5F15\u64CE\u53EA\u8D1F\u8D23\u6309\u771F\u5B9E\u5236\u5EA6\u64AE\u5408\u4E0E\u8BB0\u8D26\u3002</div>`
  };
}
function pendingDetail(id) {
  const p = (ACCT.pending || []).find((x) => x.id === id);
  if (!p) return null;
  const info = lookup(p.code);
  return {
    title: `\u5F85\u6210\u4EA4\u59D4\u6258 #${p.id}`,
    sub: `${p.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"} ${esc(p.name || p.code)} ${p.qty} \u80A1 \xB7 \u63D0\u4EA4\u4E8E ${p.submitDate}`,
    body: dwSection("\u59D4\u6258\u8BE6\u60C5", dwKv([
      ["\u4EE3\u7801 / \u540D\u79F0", `${esc(p.code)} ${esc(p.name || "")}`],
      ["\u65B9\u5411 / \u6570\u91CF", `${p.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"} ${p.qty} \u80A1`],
      ["\u63D0\u4EA4\u65E5", esc(p.submitDate || "\u2014")],
      ["\u63D0\u4EA4\u65F6\u4EF7", `${num2(p.submitPrice)} \u5143<span class="muted">\uFF08\u4E0B\u5355\u77AC\u95F4\u7684\u771F\u5B9E\u884C\u60C5\uFF09</span>`],
      ["\u9884\u4F30\u6210\u4EA4\u4EF7", `${num2(p.estPrice)} \u5143\uFF08\u542B\u6ED1\u70B9\uFF09`],
      ["\u51BB\u7ED3\u91D1\u989D", `${num2(p.need)} \u5143`],
      ["\u64AE\u5408\u89C4\u5219", "\u6B21\u4E00\u4EA4\u6613\u65E5\u6309\u8BE5\u65E5<b>\u771F\u5B9E\u6536\u76D8\u4EF7</b>\u6210\u4EA4"]
    ])) + dwSection("\u53EF\u80FD\u5931\u6548\u7684\u60C5\u5F62", `<div class="dw-note">
        \xB7 \u6B21\u65E5<b>\u6DA8\u505C</b>\uFF08\u4E70\u5355\uFF09\u6216<b>\u8DCC\u505C</b>\uFF08\u5356\u5355\uFF09\u2192 \u65E0\u5BF9\u624B\u76D8\uFF0C\u59D4\u6258\u5931\u6548\u5E76\u91CA\u653E\u51BB\u7ED3<br>
        \xB7 \u6B21\u65E5\u4EF7\u683C\u8DF3\u7A7A\u5BFC\u81F4<b>\u8D44\u91D1\u4E0D\u8DB3</b> \u2192 \u59D4\u6258\u5931\u6548\uFF08\u4E0D\u4F1A\u900F\u652F\uFF09<br>
        \xB7 \u6B21\u65E5\u8BE5\u80A1<b>\u65E0\u771F\u5B9E\u884C\u60C5</b> \u2192 \u59D4\u6258\u5931\u6548\u5E76\u91CA\u653E\u51BB\u7ED3<br>
        \u4EE5\u4E0A\u90FD\u662F\u771F\u5B9E\u4EA4\u6613\u91CC\u4F1A\u9047\u5230\u7684\u60C5\u51B5\uFF0C\u4E0D\u662F\u7CFB\u7EDF\u6545\u969C\u3002</div>`) + `<div class="dw-note">\u70B9\u62BD\u5C49\u5E95\u90E8\u300C\u64A4\u9500\u59D4\u6258\u300D\u6216\u5217\u8868\u91CC\u7684\u64A4\u5355\u6309\u94AE\u53EF\u7ACB\u5373\u91CA\u653E\u51BB\u7ED3\u3002</div>`
  };
}
function histDetail(view, i) {
  const t = (view === "trade" ? ACCT.trades : ACCT.orders)?.[i];
  if (!t) return null;
  const isTrade = view === "trade";
  const px = isTrade ? t.price : t.fillPrice ?? t.estPrice;
  const gross = isTrade ? t.gross : t.gross ?? (px ? Math.round(px * t.qty * 100) / 100 : null);
  const f = gross ? fees(gross, t.side) : null;
  return {
    title: isTrade ? `\u6210\u4EA4\u8BE6\u60C5 \xB7 ${esc(t.name || t.code)}` : `\u59D4\u6258 #${t.id} \xB7 ${statusText(t)}`,
    sub: `${t.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"} ${t.qty} \u80A1 \xB7 ${esc(t.code)} \xB7 ${esc(isTrade ? t.fillDate : t.submitDate)}`,
    body: (t.status && t.status !== "filled" && !isTrade ? dwSection("\u7ED3\u679C", dwKv([["\u72B6\u6001", statusTag(t)], ["\u539F\u56E0", esc(t.reject || "\u2014")], ["\u8BF4\u660E", esc(t.detail || "\u2014")]])) : "") + dwSection("\u4EF7\u683C\u4E0E\u91D1\u989D", dwKv([
      ["\u59D4\u6258\u4EF7\uFF08\u63D0\u4EA4\u65E5\u6536\u76D8\uFF09", `${num2(t.submitPrice)} \u5143`],
      ["\u6210\u4EA4\u4EF7", `${num2(px)} \u5143`],
      ["\u4EF7\u683C\u6F02\u79FB", t.driftPct != null ? `<span class="${cls(t.driftPct)}">${pct(t.driftPct)}</span>\uFF08T+1 \u64AE\u5408\u7684\u5FC5\u7136\u7ED3\u679C\uFF1A\u4E0B\u5355\u65F6\u53EA\u80FD\u770B\u5230\u4ECA\u6536\uFF09` : "\u2014"],
      ["\u6210\u4EA4\u91D1\u989D", gross ? `${num2(gross)} \u5143` : "\u2014"],
      ["\u6ED1\u70B9", `\u4E07${SLIP * 1e4}\uFF08\u4E70\u5165\u62AC\u4EF7 / \u5356\u51FA\u538B\u4EF7\uFF09`]
    ])) + (f ? dwSection("\u8D39\u7528\u660E\u7EC6\uFF08\u6309\u771F\u5B9E\u8D39\u7387\u91CD\u7B97\uFF0C\u53EF\u4E0E\u8D26\u672C\u6838\u5BF9\uFF09", dwKv([
      ["\u4F63\u91D1", `${num2(f.comm)} \u5143\uFF08\u4E07\u4E09\uFF0C\u6700\u4F4E ${MIN_COMMISSION} \u5143\uFF09`],
      ["\u8FC7\u6237\u8D39", `${num2(f.transfer)} \u5143\uFF08\u4E070.1\uFF09`],
      ["\u5370\u82B1\u7A0E", `${num2(f.stamp)} \u5143${t.side === "buy" ? "\uFF08\u4E70\u5165\u4E0D\u6536\uFF09" : "\uFF08\u4E07\u4E94\uFF0C\u4EC5\u5356\u51FA\uFF09"}`],
      ["\u8D39\u7528\u5408\u8BA1", `<b>${num2(f.total)} \u5143</b>`],
      ["\u8D26\u672C\u8BB0\u8D26\u8D39\u7528", t.fee != null ? `${num2(t.fee)} \u5143 ${Math.abs(t.fee - f.total) < 0.02 ? "\u2713 \u4E00\u81F4" : '<span class="bf-warn">\u2717 \u4E0E\u91CD\u7B97\u4E0D\u4E00\u81F4</span>'}` : "\u2014"]
    ])) : "") + `<div class="dw-note">\u8BF4\u660E\uFF1A${esc(t.reason || "\u624B\u52A8\u4E0B\u5355")}\u3002\u6210\u4EA4\u7531\u5F15\u64CE\u6309 T+1 \u89C4\u5219\u64AE\u5408\uFF0C\u8D39\u7528\u6309 A \u80A1\u73B0\u884C\u8D39\u7387\u9010\u7B14\u8BA1\u4EF7\u3002</div>`
  };
}
function perfDetail(k) {
  const nav = (ACCT.nav || []).map((r) => r.equity);
  if (nav.length < 2) return null;
  const m = paperMetrics(nav);
  return {
    title: `\u8D26\u6237\u7EE9\u6548 \xB7 ${k}`,
    sub: `${m.days} \u4E2A\u4EA4\u6613\u65E5 \xB7 \u533A\u95F4\u6536\u76CA ${pct(m.total * 100)} \xB7 \u6700\u5927\u56DE\u64A4 ${pct(-m.ddPct)}`,
    body: dwSection("\u5168\u90E8\u6307\u6807", dwKv([
      ["\u6837\u672C\u4EA4\u6613\u65E5", `${m.days} \u65E5\uFF08${esc(ACCT.nav[0].date)} ~ ${esc(ACCT.nav[ACCT.nav.length - 1].date)}\uFF09`],
      ["\u533A\u95F4\u603B\u6536\u76CA", `<span class="${cls(m.total)}">${pct(m.total * 100)}</span>`],
      ["\u5E74\u5316\u6536\u76CA", pct(m.annual * 100)],
      ["\u6700\u5927\u56DE\u64A4", pct(-m.ddPct)],
      ["\u590F\u666E\u6BD4\u7387", num2(m.sharpe)],
      ["\u65E5\u80DC\u7387", pct(m.winRate * 100)],
      ["\u6700\u65B0\u51C0\u503C", `${num2(nav[nav.length - 1])} \u5143`]
    ])) + dwSection("\u51C0\u503C\u5E8F\u5217", `<table class="dw-tb"><thead><tr><th>\u4EA4\u6613\u65E5</th><th class="num">\u51C0\u503C</th><th class="num">\u73B0\u91D1</th><th class="num">\u5E02\u503C</th><th class="num">\u65E5\u53D8\u52A8</th></tr></thead><tbody>` + ACCT.nav.slice(-20).reverse().map((r, idx, arr) => {
      const prev = ACCT.nav[ACCT.nav.length - 1 - idx - 1];
      const chg = prev ? (r.equity / prev.equity - 1) * 100 : null;
      return `<tr><td>${esc(r.date)}</td><td class="num">${num2(r.equity)}</td><td class="num">${num2(r.cash)}</td><td class="num">${num2(r.marketValue)}</td><td class="num ${cls(chg)}">${chg == null ? "\u2014" : pct(chg)}</td></tr>`;
    }).join("") + "</tbody></table>") + `<div class="dw-note">\u6307\u6807\u5B9A\u4E49\u4E0E <b>src/backtest.js</b> metrics() \u4E00\u81F4\uFF08\u5E74\u5316 252\u3001\u56DE\u64A4\u6309\u5CF0\u503C\u3001\u590F\u666E\u6309\u65E5\u6536\u76CA\u6807\u51C6\u5DEE\uFF09\u3002\u6837\u672C\u4EC5 ${m.days} \u4E2A\u4EA4\u6613\u65E5\uFF0C\u5E74\u5316/\u590F\u666E\u7684\u7EDF\u8BA1\u610F\u4E49\u6709\u9650\u3002</div>`
  };
}
function batchDay() {
  const day = ARC_DAYS[ARC_DAYS.length - 1] || {};
  const quotes = {};
  for (const code of Object.keys(LIVEQ)) {
    const q = LIVEQ[code];
    if (!q || !Number.isFinite(+q.price)) continue;
    quotes[code] = { code, name: q.name, price: +q.price, changePct: q.changePct ?? null, prevClose: q.prevClose ?? null, src: "live" };
  }
  return { ...day, quotes: { ...day.quotes || {}, ...quotes } };
}
function parseBatchInput(text, { mode, side, defaultPct }) {
  const items = [];
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = line.match(/^(\d{6})/);
    if (!m) {
      errors.push(`\u7B2C ${i + 1} \u884C\u300C${line}\u300D\uFF1A\u627E\u4E0D\u5230 6 \u4F4D\u80A1\u7968\u4EE3\u7801`);
      return;
    }
    const code = m[1];
    const rest = line.slice(m[0].length).replace(/^[\s,，]+/, "").trim();
    const val = rest ? Number(String(rest).replace(/[%％]/g, "")) : null;
    const row = { code };
    if (side === "buy") {
      if (mode === "qty") {
        if (val != null && Number.isFinite(val) && val > 0) row.qty = Math.floor(val);
        else if (val != null) {
          errors.push(`\u7B2C ${i + 1} \u884C\u300C${line}\u300D\uFF1A\u80A1\u6570\u9700\u4E3A\u6B63\u6574\u6570`);
          return;
        } else row.pct = defaultPct;
      } else {
        if (val != null && Number.isFinite(val) && val > 0) row.pct = val / 100;
        else if (val != null) {
          errors.push(`\u7B2C ${i + 1} \u884C\u300C${line}\u300D\uFF1A\u6BD4\u4F8B\u9700\u4E3A\u6B63\u6570`);
          return;
        } else row.pct = defaultPct / 100;
      }
    } else if (val != null && Number.isFinite(val) && val > 0) {
      errors.push(`\u7B2C ${i + 1} \u884C\u300C${line}\u300D\uFF1A\u6279\u91CF\u5356\u51FA\u76EE\u524D\u6309\u300C\u5168\u90E8\u53EF\u5356\u6570\u91CF\u300D\u6267\u884C\uFF0C\u4E0D\u652F\u6301\u6307\u5B9A\u6570\u503C`);
      return;
    }
    items.push(row);
  });
  return { items, errors };
}
async function runBatch() {
  const ta = $("btInput");
  const text = ta ? ta.value : "";
  const side = BATCH.side;
  const mode = BATCH.mode;
  const defPctEl = $("btDefaultPct");
  const defaultPct = Math.max(0.1, +(defPctEl && defPctEl.value || 5) || 5);
  const applyLhbEl = $("btApplyLhb");
  const checkRiskEl = $("btCheckRisk");
  const applyLhb = applyLhbEl ? !!applyLhbEl.checked : true;
  const checkRisk = checkRiskEl ? !!checkRiskEl.checked : true;
  const { items, errors } = parseBatchInput(text, { mode, side, defaultPct });
  if (!items.length) {
    msg(errors.length ? `\u6CA1\u6709\u53EF\u63D0\u4EA4\u7684\u6807\u7684 \u2014\u2014 ${errors[0]}` : "\u8BF7\u5148\u5728\u8F93\u5165\u6846\u586B\u5199\u81F3\u5C11\u4E00\u53EA\u6807\u7684\uFF08\u6BCF\u884C\u300C\u4EE3\u7801,\u503C\u300D\uFF09", "err");
    BATCH = { ...BATCH, result: { side, items: [], errors, summary: null } };
    renderBatch();
    return;
  }
  msg(`\u6B63\u5728\u83B7\u53D6 ${items.length} \u53EA\u6807\u7684\u7684\u5B9E\u65F6\u884C\u60C5\u2026`, "ok");
  await refreshLive(items.map((it) => it.code));
  const day = batchDay();
  const glmBlocked = side === "buy" ? items.filter((it) => window.__glm && window.__glm.riskOf(it.code)) : [];
  const passItems = glmBlocked.length ? items.filter((it) => !glmBlocked.some((b) => b.code === it.code)) : items;
  if (glmBlocked.length) {
    glmBlocked.forEach((b) => {
      const rr = (window.__glm.riskOf(b.code) || {}).reason || "\u547D\u4E2D AI \u665A\u95F4\u6392\u96F7\u9ED1\u540D\u5355";
      ACCT = { ...ACCT, logs: appendLog(ACCT, { stage: "glm", result: "rejected", code: b.code, name: b.name, side: "buy", reason: rr, text: `[AI\u9884\u68C0\u62E6\u622A] \u62D2\u5355 ${b.code}\uFF1A${rr}` }) };
    });
  }
  const execSettings = getExec();
  const { exec, regimeCap, tranche: execTranche, trancheCapLimit } = execSettings;
  let itemsForBatch = passItems;
  if (execTranche > 1 && side === "buy") {
    const expanded = [];
    for (const it of passItems) {
      if (it.qty != null && it.qty > 0) {
        for (const lot of splitLots(it.qty, execTranche)) expanded.push({ ...it, qty: lot });
      } else {
        expanded.push(it);
      }
    }
    itemsForBatch = expanded;
  }
  if (trancheCapLimit != null && side === "buy") {
    const openCodes = new Set(Object.keys(ACCT.positions || {}));
    const planned = /* @__PURE__ */ new Set();
    const filtered = [];
    for (const it of itemsForBatch) {
      const c = String(it.code);
      if (!openCodes.has(c) && !planned.has(c) && openCodes.size + planned.size >= trancheCapLimit) continue;
      planned.add(c);
      filtered.push(it);
    }
    itemsForBatch = filtered;
  }
  const opts = { date: bjToday(), applyLhbFilter: applyLhb, checkRisk, exec, ...regimeCap != null ? { regimeCap } : {} };
  const r = side === "buy" ? batchSubmit(ACCT, itemsForBatch, day, opts) : batchSell(ACCT, items, day, { date: opts.date });
  const glmResults = glmBlocked.map((b) => ({
    code: b.code,
    name: b.name,
    side: "buy",
    qty: null,
    status: "blocked",
    stage: "glm",
    reason: (window.__glm.riskOf(b.code) || {}).reason || "\u547D\u4E2D AI \u665A\u95F4\u6392\u96F7\u9ED1\u540D\u5355"
  }));
  const summaryAug = r.summary ? { ...r.summary, blocked: (r.summary.blocked || 0) + glmResults.length } : { submitted: 0, blocked: glmResults.length };
  ACCT = r.next;
  save();
  BATCH = { ...BATCH, result: { side, items: [...r.results, ...glmResults], errors, summary: summaryAug } };
  renderAllPaper();
  syncPositionsLive();
  const s = summaryAug || {};
  const okN = s.submitted ?? 0;
  const blkN = s.blocked ?? 0;
  if (okN && !blkN) {
    msg(`\u6279\u91CF${side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"}\u5B8C\u6210\uFF1A${okN} \u7B14\u5DF2\u6302\u5355\uFF0C\u5C06\u4E8E\u4E0B\u4E00\u4EA4\u6613\u65E5\u6309\u771F\u5B9E\u6536\u76D8\u4EF7\u64AE\u5408`, "ok");
  } else if (okN && blkN) {
    msg(`\u6279\u91CF\u5B8C\u6210\uFF1A${okN} \u7B14\u5DF2\u6302\u5355\u3001${blkN} \u7B14\u88AB\u62E6` + (s.blockedByLhb ? `\uFF08\u9F99\u864E\u8FC7\u6EE4 ${s.blockedByLhb}\uFF09` : "") + (s.blockedByRisk ? `\uFF08\u98CE\u63A7 ${s.blockedByRisk}\uFF09` : "") + ` \u2014\u2014 \u9010\u53EA\u539F\u56E0\u89C1\u4E0B\u8868`, "warn");
  } else {
    msg(`\u5168\u90E8 ${blkN} \u7B14\u88AB\u62E6\uFF0C\u672A\u4EA7\u751F\u4EFB\u4F55\u59D4\u6258 \u2014\u2014 \u9010\u53EA\u539F\u56E0\u89C1\u4E0B\u8868`, "err");
  }
}
var BT_STAGE_LABEL = { lhb: "\u9F99\u864E\u8FC7\u6EE4", risk: "\u98CE\u63A7", quote: "\u884C\u60C5", position: "\u6301\u4ED3", qty: "\u80A1\u6570", order: "\u59D4\u6258" };
var BT_STATUS_LABEL = { submitted: "\u5DF2\u6302\u5355", blocked: "\u5DF2\u62E6\u622A" };
function renderBatch() {
  const box = $("btSummary");
  const tb = $("btTable")?.querySelector("tbody");
  const hint = $("btHint");
  document.querySelectorAll("#btSide button").forEach((b) => {
    const on = b.dataset.side === BATCH.side;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("#btMode button").forEach((b) => {
    const on = b.dataset.mode === BATCH.mode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.disabled = BATCH.side === "sell";
  });
  const pctWrap = $("btDefaultPct")?.closest("label");
  if (pctWrap) pctWrap.style.display = BATCH.side === "sell" ? "none" : "";
  const r = BATCH.result;
  if (box) {
    if (!r) {
      box.innerHTML = '<div class="muted">\u586B\u5199\u6807\u7684\u540E\u70B9\u300C\u6279\u91CF\u63D0\u4EA4\u59D4\u6258\u300D\u2014\u2014\u6BCF\u53EA\u72EC\u7ACB\u8D70\u9F99\u864E\u8FC7\u6EE4\u4E0E\u8D26\u6237\u98CE\u63A7\uFF0C\u7ED3\u679C\u9010\u6761\u5217\u51FA\uFF08\u542B\u88AB\u62E6\u539F\u56E0\uFF09\uFF0C\u4E0D\u4F1A\u66FF\u4F60\u81EA\u52A8\u6210\u4EA4\u3002</div>';
    } else {
      const s = r.summary;
      const errN = (r.errors || []).length;
      box.innerHTML = `<div class="bt-sum-line"><span class="bt-chip ${r.side === "buy" ? "hl" : "hl-dn"}">\u6279\u91CF${r.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"}</span><span class="bt-chip">\u5171 ${r.items.length + errN} \u884C\u8F93\u5165</span>` + (s ? `<span class="bt-chip ok">\u5DF2\u6302\u5355 <b>${s.submitted}</b></span><span class="bt-chip ${s.blocked ? "bad" : ""}">\u88AB\u62E6 <b>${s.blocked}</b></span>` + (s.blockedByLhb ? `<span class="bt-chip warn">\u9F99\u864E\u8FC7\u6EE4 ${s.blockedByLhb}</span>` : "") + (s.blockedByRisk ? `<span class="bt-chip warn">\u98CE\u63A7 ${s.blockedByRisk}</span>` : "") + (r.side === "buy" && s.todayBuyPct != null ? `<span class="bt-chip">\u5F53\u65E5\u5DF2\u4E70\u5165 ${num2(s.todayBuyAmount)} \u5143\uFF08\u5360\u603B\u8D44\u4EA7 ${s.todayBuyPct.toFixed(2)}%\uFF0C\u4E0A\u9650 ${(MAX_DAILY_POSITION_CHANGE * 100).toFixed(0)}%\uFF09</span>` : "") : '<span class="bt-chip">\u672A\u63D0\u4EA4</span>') + (errN ? `<span class="bt-chip bad">\u8F93\u5165\u89E3\u6790\u5931\u8D25 ${errN} \u884C</span>` : "") + `</div>` + (errN ? `<ul class="bt-errs">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "");
    }
  }
  if (tb) {
    if (!r || !r.items.length) {
      tb.innerHTML = '<tr class="empty-row"><td colspan="6" class="muted">\u6682\u65E0\u6279\u91CF\u63D0\u4EA4\u8BB0\u5F55</td></tr>';
    } else {
      tb.innerHTML = r.items.map((it) => {
        const st = it.status === "submitted" ? "submitted" : "blocked";
        const stage = it.stage ? BT_STAGE_LABEL[it.stage] || it.stage : "\u2014";
        const why = it.status === "submitted" ? it.detail || "\u5DF2\u6302\u5355\uFF0C\u5F85\u6B21\u4E00\u4EA4\u6613\u65E5\u64AE\u5408" : `${stage}\uFF1A${it.reason || "\u672A\u901A\u8FC7"}${it.detail ? "\uFF08" + it.detail + "\uFF09" : ""}`;
        return `<tr class="${it.status === "submitted" ? "" : "bt-blocked-row"}"><td>${esc(it.code)}</td><td>${esc(it.name || "\u2014")}</td><td class="${it.side === "buy" ? "hl" : "hl-dn"}">${it.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"}</td><td class="num">${it.qty == null ? "\u2014" : it.qty}</td><td><span class="stag ${st === "submitted" ? "ok" : "bad"}">${esc(BT_STATUS_LABEL[st])}</span></td><td class="muted">${esc(why)}</td></tr>`;
      }).join("");
    }
  }
  if (hint) {
    const s = r && r.summary;
    hint.innerHTML = `\u9F99\u864E\u699C\u524D\u7F6E\u8FC7\u6EE4\u7248\u672C <b>${esc(LHBFILTER_VERSION)}</b> \xB7 \u8FC7\u6EE4\u6863\u4F4D\uFF1A\u4E3B\u6C60 <b>${esc(BUCKET.MAIN)}</b>\uFF08\u53EF\u4E0B\u5355\uFF09/ \u5907\u9009\u89C2\u5BDF <b>${esc(BUCKET.WATCH)}</b>\uFF08\u7981\u6B62\u81EA\u52A8\u4E0B\u5355\uFF09/ \u5254\u9664 <b>${esc(BUCKET.REJECTED)}</b> \xB7 \u786C\u6B62\u635F\u7EBF <b>${(HARD_STOP_LOSS * 100).toFixed(0)}%</b>\uFF08\u6536\u76D8\u626B\u63CF\uFF0C\u89E6\u53D1\u5373\u751F\u6210 T+1 \u5356\u5355\uFF09` + (s && s.todayBuyPct != null ? ` \xB7 \u672C\u6279\u6B21\u540E\u5F53\u65E5\u4ED3\u4F4D\u53D8\u52A8 <b>${s.todayBuyPct.toFixed(2)}%</b> / \u4E0A\u9650 ${(MAX_DAILY_POSITION_CHANGE * 100).toFixed(0)}%` : "") + ` \xB7 <span class="muted">\u6279\u91CF\u5356\u51FA\u4E0D\u505A\u9F99\u864E\u8FC7\u6EE4\uFF08\u8BE5\u89C4\u5219\u53EA\u7EA6\u675F\u4E70\u5165\uFF09\uFF1B\u5168\u90E8\u59D4\u6258\u4ECD\u4E3A T+1 \u6B21\u65E5\u6309\u771F\u5B9E\u6536\u76D8\u4EF7\u64AE\u5408</span>`;
  }
}
var LOG_STAGE_LABEL = { lhb: "\u9F99\u864E\u8FC7\u6EE4", risk: "\u98CE\u63A7", order: "\u59D4\u6258", settle: "\u7ED3\u7B97", stop: "\u6B62\u635F", glm: "AI\u9884\u68C0" };
var LOG_STAGE_CLS = { lhb: "warn", risk: "bad", order: "mut", settle: "ok", stop: "warn", glm: "bad" };
var LOG_RESULT_LABEL = {
  pass: "\u901A\u8FC7",
  rejected: "\u62E6\u622A",
  submitted: "\u5DF2\u63D0\u4EA4",
  filled: "\u5DF2\u6210\u4EA4",
  expired: "\u5931\u6548",
  cancelled: "\u5DF2\u64A4\u5355",
  info: "\u8BB0\u5F55"
};
var LOG_RESULT_CLS = {
  pass: "ok",
  submitted: "ok",
  filled: "ok",
  rejected: "bad",
  expired: "warn",
  cancelled: "mut",
  info: "mut"
};
function renderLogs() {
  const tb = $("logTable")?.querySelector("tbody");
  const cards = $("logCards");
  const cnt = $("logCount");
  const note = $("logNote");
  if (!tb && !cards) return;
  const all = readLogs(ACCT, {});
  const rows = LOG.stage ? all.filter((r) => r.stage === LOG.stage) : all;
  document.querySelectorAll("#logTabs button").forEach((b) => {
    const on = (b.dataset.stage || "") === LOG.stage;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (cnt) {
    cnt.textContent = LOG.stage ? `${LOG_STAGE_LABEL[LOG.stage] || LOG.stage} ${rows.length} \u6761 / \u5168\u90E8 ${all.length} \u6761\uFF08\u4E0A\u9650 ${MAX_LOGS}\uFF09` : `\u5171 ${all.length} \u6761\uFF08\u4E0A\u9650 ${MAX_LOGS}\uFF0C\u8D85\u51FA\u81EA\u52A8\u4E22\u5F03\u6700\u65E9\u7684\u8BB0\u5F55\uFF09`;
  }
  const list = [...rows].reverse();
  if (tb) {
    tb.innerHTML = list.length ? list.map((r) => {
      const ts = r.ts ? fmtClock(new Date(r.ts)) : "\u2014";
      const stCls = LOG_STAGE_CLS[r.stage] || "mut";
      const rsCls = LOG_RESULT_CLS[r.result] || "mut";
      return `<tr><td class="muted">${esc(ts)}</td><td>${esc(r.date || "\u2014")}</td><td>${esc(r.code || "\u2014")}</td><td>${esc(r.name || "\u2014")}</td><td class="${r.side === "buy" ? "hl" : r.side === "sell" ? "hl-dn" : "muted"}">${r.side === "buy" ? "\u4E70\u5165" : r.side === "sell" ? "\u5356\u51FA" : "\u2014"}</td><td class="num">${r.qty == null ? "\u2014" : r.qty}</td><td><span class="stag ${stCls}">${esc(LOG_STAGE_LABEL[r.stage] || r.stage)}</span></td><td><span class="stag ${rsCls}">${esc(LOG_RESULT_LABEL[r.result] || r.result)}</span></td><td class="muted">${esc(r.text || r.reason || "\u2014")}</td></tr>`;
    }).join("") : `<tr class="empty-row"><td colspan="9" class="muted">\u6682\u65E0\u65E5\u5FD7\u2014\u2014\u4E0B\u5355\u3001\u7ED3\u7B97\u6216\u89E6\u53D1\u62E6\u622A\u540E\u4F1A\u81EA\u52A8\u8BB0\u5F55</td></tr>`;
  }
  if (cards) {
    cards.innerHTML = list.length ? list.slice(0, 60).map((r) => {
      const ts = r.ts ? fmtClock(new Date(r.ts)) : "\u2014";
      return `<div class="card-row"><div class="cr-top"><b>${esc(r.name || r.code || "\u8D26\u6237\u4E8B\u4EF6")}</b><span class="stag ${LOG_STAGE_CLS[r.stage] || "mut"}">${esc(LOG_STAGE_LABEL[r.stage] || r.stage)}</span><span class="stag ${LOG_RESULT_CLS[r.result] || "mut"}">${esc(LOG_RESULT_LABEL[r.result] || r.result)}</span></div><div class="cr-bot muted">${esc(r.date || "\u2014")} ${esc(ts)} \xB7 ${esc(r.text || r.reason || "")}</div></div>`;
    }).join("") : '<div class="dw-empty">\u6682\u65E0\u65E5\u5FD7</div>';
  }
  if (note) {
    note.innerHTML = `\u65E5\u5FD7\u7531\u4EA4\u6613\u5F15\u64CE\u5728\u6BCF\u6B21\u59D4\u6258\u6D41\u8F6C\u4E0E\u62E6\u622A\u65F6**\u81EA\u52A8\u5199\u5165**\uFF08\u4E0D\u4F9D\u8D56\u672C\u9762\u677F\u662F\u5426\u6253\u5F00\uFF09\u3002\u9636\u6BB5\u53E3\u5F84\uFF1A\u9F99\u864E\u8FC7\u6EE4\uFF08\u4E70\u5165\u524D\u7F6E\uFF09/ \u98CE\u63A7\uFF08\u4ED3\u4F4D\u53D8\u52A8\u4E0E\u964D\u4ED3\u4E0A\u9650\uFF09/ \u59D4\u6258\uFF08\u63D0\u4EA4\u4E0E\u88AB\u62D2\uFF09/ \u7ED3\u7B97\uFF08\u6210\u4EA4\u4E0E\u5931\u6548\uFF09/ \u6B62\u635F\uFF08\u6536\u76D8\u626B\u63CF \u2212${Math.abs(HARD_STOP_LOSS * 100).toFixed(0)}%\uFF09\u3002\u70B9\u300C\u5BFC\u51FA\u65E5\u5FD7\u300D\u53EF\u628A\u5F53\u524D\u8FC7\u6EE4\u7ED3\u679C\u8FFD\u52A0\u8FDB\u6BCF\u65E5\u7814\u5224\u62A5\u544A\u3002`;
  }
}
function logText() {
  const txt = logsToReport(ACCT, LOG.stage ? { stage: LOG.stage } : {});
  if (!txt) return "";
  return txt;
}
function doLogExport() {
  const txt = logText();
  if (!txt) {
    msg("\u5F53\u524D\u8FC7\u6EE4\u6761\u4EF6\u4E0B\u6CA1\u6709\u65E5\u5FD7\u53EF\u5BFC\u51FA", "err");
    return;
  }
  const blob = new Blob([txt], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `paper-logs-${LOG.stage || "all"}-${LAST_DATE || "unknown"}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2e3);
  msg("\u4E8B\u4EF6\u65E5\u5FD7\u5DF2\u5BFC\u51FA\uFF08Markdown\uFF0C\u53EF\u76F4\u63A5\u7C98\u8D34\u8FDB\u6BCF\u65E5\u7814\u5224\u62A5\u544A\uFF09", "ok");
}
async function doLogCopy() {
  const txt = logText();
  if (!txt) {
    msg("\u5F53\u524D\u8FC7\u6EE4\u6761\u4EF6\u4E0B\u6CA1\u6709\u65E5\u5FD7\u53EF\u590D\u5236", "err");
    return;
  }
  try {
    await navigator.clipboard.writeText(txt);
    msg("\u4E8B\u4EF6\u65E5\u5FD7\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F", "ok");
  } catch (e) {
    doLogExport();
    msg("\u6D4F\u89C8\u5668\u4E0D\u5141\u8BB8\u76F4\u63A5\u5199\u526A\u8D34\u677F\uFF0C\u5DF2\u6539\u4E3A\u4E0B\u8F7D\u6587\u4EF6", "warn");
  }
}
function doLogClear() {
  const n = (ACCT?.logs || []).length;
  if (!n) {
    msg("\u5F53\u524D\u6CA1\u6709\u65E5\u5FD7", "ok");
    return;
  }
  if (!window.confirm(`\u5C06\u6E05\u7A7A\u5168\u90E8 ${n} \u6761\u4E8B\u4EF6\u65E5\u5FD7\u3002
\u65E5\u5FD7\u662F\u300C\u8FD9\u7B14\u59D4\u6258\u5F53\u65F6\u4E3A\u4EC0\u4E48\u88AB\u62E6\u300D\u7684\u552F\u4E00\u51ED\u636E\uFF0C\u6E05\u7A7A\u540E\u4E0D\u53EF\u6062\u590D\u3002

\u786E\u5B9A\u7EE7\u7EED\uFF1F`)) return;
  ACCT = { ...ACCT, logs: [] };
  save();
  renderAllPaper();
  msg("\u4E8B\u4EF6\u65E5\u5FD7\u5DF2\u6E05\u7A7A", "ok");
}
async function submit() {
  const info = ORDER.code ? lookup(ORDER.code) : null;
  if (!info) {
    msg("\u8BF7\u5148\u8F93\u5165 6 \u4F4D\u80A1\u7968\u4EE3\u7801", "err");
    return;
  }
  if (!ORDER.qty) {
    msg("\u8BF7\u586B\u5199\u59D4\u6258\u6570\u91CF", "err");
    return;
  }
  if (ORDER.side === "buy") {
    const od = outflowOf(ORDER.code);
    if (od && !reviewPassed(ORDER.code)) {
      msg(`\u5DF2\u62E6\u622A\uFF1A${info.name || ORDER.code} \u547D\u4E2D\u300C${FLAG_LHB.NET_OUTFLOW}\u300D\uFF0C\u987B\u4EBA\u5DE5\u590D\u6838\u540E\u624D\u80FD\u4E0B\u5355\u3002\u8BE5\u7968\u5DF2\u6263\u7EFC\u5408\u5206 ${LHB_NET_OUTFLOW_PENALTY.SCORE} \u5206 / \u4E0A\u6DA8\u6982\u7387 ${LHB_NET_OUTFLOW_PENALTY.PROB} \u4E2A\u767E\u5206\u70B9\uFF0C\u5F53\u524D\u843D\u5165\u5907\u9009\u89C2\u5BDF\u6C60\uFF08\u7981\u6B62\u81EA\u52A8\u4E0B\u5355\uFF09\u3002\u8BF7\u5148\u786E\u8BA4\u4E0B\u65B9\u544A\u8B66\u8BE6\u60C5\uFF0C\u518D\u70B9\u4E00\u6B21\u300C\u786E\u8BA4\u590D\u6838\u5E76\u4E0B\u5355\u300D\u3002`, "err");
      renderOrderForm();
      return;
    }
  }
  if (ORDER.side === "buy") {
    const risk = window.__glm ? window.__glm.riskOf(ORDER.code) : null;
    if (risk) {
      const reason = `\u547D\u4E2D AI \u665A\u95F4\u6392\u96F7\u9ED1\u540D\u5355${risk.riskLevel ? "\uFF08" + risk.riskLevel + "\uFF09" : ""}\uFF1A${risk.reason || "\u8BE5\u7968\u88AB\u5224\u5B9A\u6709\u96F7\uFF0C\u5DF2\u7981\u6B62\u81EA\u52A8\u5EFA\u4ED3"}`;
      ACCT = { ...ACCT, logs: appendLog(ACCT, { stage: "glm", result: "rejected", code: info.code, name: info.name, side: "buy", qty: ORDER.qty, reason, text: `[AI\u9884\u68C0\u62E6\u622A] \u62D2\u5355 ${ORDER.code}\uFF1A${reason}` }) };
      save();
      renderLogs();
      msg(`\u26D4 AI \u6392\u96F7\u62E6\u622A\uFF1A${reason}`, "err");
      return;
    }
  }
  if (!LIVEQ[info.code]) {
    msg(`\u6B63\u5728\u83B7\u53D6 ${info.code} \u6700\u65B0\u884C\u60C5\u2026`, "ok");
    await refreshLive([info.code]);
    const fresh = lookup(ORDER.code);
    if (!fresh || !fresh.fresh) {
      msg(`${info.code} \u53D6\u4E0D\u5230\u884C\u60C5\uFF08\u5B9E\u65F6\u6E90\u65E0\u6B64\u4EE3\u7801\u6216\u5DF2\u505C\u724C\uFF09\uFF0C\u65E0\u6CD5\u4E0B\u5355\uFF1B\u5DF2\u6709\u6301\u4ED3\u4ECD\u53EF\u5356\u51FA`, "err");
      renderOrderForm();
      return;
    }
    Object.assign(info, fresh);
    renderOrderForm();
  }
  const q = { code: info.code, name: info.name, price: info.price, changePct: info.changePct };
  const { exec, tranche } = getExec();
  const slip = exec.slipModel === "profile" ? void 0 : SLIP;
  const lots = splitLots(ORDER.qty, tranche);
  let lastR = null, okCount = 0, rejCount = 0;
  for (const lot of lots) {
    if (lot <= 0) continue;
    const r = submitOrder(ACCT, { code: info.code, side: ORDER.side, qty: lot, slip }, q, { date: bjToday() });
    ACCT = r.next;
    lastR = r;
    if (r.order.status === "rejected") rejCount++;
    else okCount++;
  }
  if (!lastR) {
    msg("\u59D4\u6258\u6570\u91CF\u4E3A 0\uFF0C\u672A\u4E0B\u5355", "err");
    return;
  }
  save();
  renderAllPaper();
  syncOrderInputs();
  const pxSrc = info.src === "live" ? `\u6309${info.srcLabel} ${num2(info.price)} \u5143` : `\u6309${info.srcLabel || "\u884C\u60C5"} ${num2(info.price)} \u5143`;
  if (rejCount && !okCount) {
    msg(`\u59D4\u6258\u88AB\u62D2\uFF1A${lastR.order.reject}${lastR.order.detail ? "\uFF08" + lastR.order.detail + "\uFF09" : ""}`, "err");
  } else if (rejCount) {
    msg(`\u5206 ${lots.length} \u7B14\u6302\u5355\uFF0C\u5176\u4E2D ${rejCount} \u7B14\u88AB\u62D2\uFF08\u89C1\u4E8B\u4EF6\u65E5\u5FD7\uFF09`, "warn");
  } else {
    const tag = lots.length > 1 ? `\uFF08\u5206 ${lots.length} \u7B14\u6302\u5355\uFF09` : "";
    msg(`${ORDER.side === "buy" ? "\u4E70\u5165" : "\u5356\u51FA"} ${info.name || ORDER.code} ${ORDER.qty} \u80A1\u5DF2\u6302\u5355${tag}\uFF08${pxSrc}\u9884\u4F30\u51BB\u7ED3\uFF09\uFF0C\u5C06\u4E8E\u4E0B\u4E00\u4EA4\u6613\u65E5\u6309\u771F\u5B9E\u6536\u76D8\u4EF7\u64AE\u5408`, "ok");
  }
}
function cancel(id) {
  const r = cancelOrder(ACCT, id);
  if (!r.ok) {
    msg(r.error, "err");
    return;
  }
  ACCT = r.next;
  save();
  renderAllPaper();
  msg(`\u59D4\u6258 #${id} \u5DF2\u64A4\u9500\uFF0C\u51BB\u7ED3\u8D44\u91D1\u5DF2\u91CA\u653E`, "ok");
}
async function closeAll() {
  const positions = Object.values(ACCT?.positions || {});
  if (!positions.length) {
    msg("\u5F53\u524D\u65E0\u6301\u4ED3\uFF0C\u65E0\u9700\u7A7A\u4ED3", "ok");
    return;
  }
  const frozenOf = (code) => (ACCT.pending || []).filter((x) => x.code === code && x.side === "sell").reduce((a, x) => a + x.qty, 0);
  await refreshLive(positions.map((p) => p.code));
  const sold = [];
  const skipped = [];
  for (const p of positions) {
    const free = Math.max(0, (p.avail || 0) - frozenOf(p.code));
    if (free <= 0) {
      const why = p.qty > 0 && (p.avail || 0) === 0 ? "\u5F53\u65E5\u4E70\u5165\uFF0CT+1 \u672A\u89E3\u51BB" : frozenOf(p.code) > 0 ? "\u5DF2\u5168\u90E8\u6302\u5356\u5355" : "\u53EF\u5356\u6570\u91CF\u4E3A 0";
      skipped.push(`${p.name || p.code}\uFF1A${why}`);
      continue;
    }
    const info = lookup(p.code);
    if (!info || !info.fresh || !Number.isFinite(+info.price) || +info.price <= 0) {
      skipped.push(`${p.name || p.code}\uFF1A\u53D6\u4E0D\u5230\u5B9E\u65F6\u884C\u60C5\uFF0C\u65E0\u6CD5\u6302\u5355`);
      continue;
    }
    const q = { code: info.code, name: info.name, price: info.price, changePct: info.changePct };
    const slip = getExec().exec.slipModel === "profile" ? void 0 : SLIP;
    const r = submitOrder(ACCT, { code: p.code, side: "sell", qty: free, slip }, q, { date: LAST_DATE });
    if (r.order.status === "rejected") {
      skipped.push(`${p.name || p.code}\uFF1A${r.order.reject}${r.order.detail ? "\uFF08" + r.order.detail + "\uFF09" : ""}`);
      continue;
    }
    ACCT = r.next;
    sold.push(`${p.name || p.code} ${free} \u80A1`);
  }
  save();
  renderAllPaper();
  syncPositionsLive();
  if (sold.length && !skipped.length) {
    msg(`\u5DF2\u6309\u5B9E\u65F6\u4EF7\u6302\u51FA\u5356\u5355\uFF1A${sold.join("\u3001")}\uFF08\u4E0B\u4E00\u4EA4\u6613\u65E5\u6309\u771F\u5B9E\u6536\u76D8\u4EF7\u64AE\u5408\uFF09`, "ok");
  } else if (sold.length && skipped.length) {
    msg(`\u5DF2\u6302\u5356 ${sold.length} \u53EA\uFF1A${sold.join("\u3001")}\uFF1B\u672A\u6302 ${skipped.length} \u53EA \u2014\u2014 ${skipped.join("\uFF1B")}`, "warn");
  } else {
    msg(`\u672A\u80FD\u6302\u51FA\u4EFB\u4F55\u5356\u5355 \u2014\u2014 ${skipped.join("\uFF1B")}`, "err");
  }
}
function newAccountWith(cash) {
  let a = emptyAccount(cash, LAST_DATE);
  if (LAST_DATE) {
    a = { ...a, nav: [{ date: LAST_DATE, equity: cash, cash, marketValue: 0 }] };
  }
  return a;
}
function syncInitCashInput() {
  const inp = $("paperInitCash");
  if (!inp) return;
  const v = ACCT?.initCash || loadInitCash();
  inp.value = String(Math.round(v));
}
function applyInitCash() {
  const inp = $("paperInitCash");
  if (!inp) return;
  const n = saveInitCash(inp.value);
  if (n == null) return;
  if (ACCT && !window.confirm(
    `\u5C06\u6309 ${n.toLocaleString()} \u5143\u65B0\u5EFA\u8D26\u6237\uFF0C\u73B0\u6709\u6301\u4ED3\u3001\u6210\u4EA4\u4E0E\u59D4\u6258\u8BB0\u5F55\u4F1A\u88AB\u6E05\u7A7A\uFF08\u4E0D\u53EF\u6062\u590D\uFF09\u3002

\u786E\u5B9A\u7EE7\u7EED\uFF1F`
  )) return;
  ACCT = newAccountWith(n);
  save();
  renderAllPaper();
  syncInitCashInput();
  msg(`\u5DF2\u6309 ${n.toLocaleString()} \u5143\u65B0\u5EFA\u6A21\u62DF\u8D26\u6237`, "ok");
}
function reset() {
  const cash = ACCT?.initCash || loadInitCash();
  if (!window.confirm(
    `\u91CD\u7F6E\u8D26\u6237\u5C06\u6E05\u7A7A\u5168\u90E8\u6301\u4ED3\u3001\u6210\u4EA4\u4E0E\u59D4\u6258\u8BB0\u5F55\uFF0C\u4E14\u4E0D\u53EF\u6062\u590D\u3002

\u5C06\u6309\u539F\u521D\u59CB\u8D44\u91D1 ${cash.toLocaleString()} \u5143\u91CD\u5EFA\u3002
\u786E\u5B9A\u7EE7\u7EED\uFF1F`
  )) return;
  ACCT = newAccountWith(cash);
  save();
  renderAllPaper();
  syncInitCashInput();
  msg("\u8D26\u6237\u5DF2\u91CD\u7F6E\u4E3A " + cash.toLocaleString() + " \u5143\u865A\u62DF\u8D44\u91D1", "ok");
}
function doExport() {
  const text = exportAccount(ACCT);
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `paper-account-${LAST_DATE || "unknown"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2e3);
  msg("\u8D26\u672C\u5DF2\u5BFC\u51FA\uFF08\u53EF\u7528\u4E8E\u79BB\u7EBF\u6838\u9A8C\u6216\u8FC1\u79FB\u5230\u53E6\u4E00\u53F0\u8BBE\u5907\uFF09", "ok");
}
function doImport() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "application/json,.json";
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const r = importAccount(String(rd.result || ""));
      if (!r.ok) {
        msg("\u5BFC\u5165\u88AB\u62D2\u7EDD\uFF1A" + r.error, "err");
        return;
      }
      ACCT = r.account;
      persistRaw(ACCT);
      renderAllPaper();
      msg("\u8D26\u672C\u5DF2\u5BFC\u5165", "ok");
    };
    rd.readAsText(f);
  };
  inp.click();
}
async function settleByLive(date) {
  const pending = ACCT?.pending || [];
  if (!pending.length) return { ok: false, reason: "\u5F53\u524D\u6CA1\u6709\u5F85\u6210\u4EA4\u59D4\u6258" };
  const today = date || bjToday();
  if (ACCT.lastSettle && today <= ACCT.lastSettle) {
    return { ok: false, reason: `\u4ECA\u65E5\uFF08${today}\uFF09\u5DF2\u7ED3\u7B97\u8FC7\uFF0C\u4E0B\u4E00\u4EA4\u6613\u65E5\u518D\u7ED3\u7B97` };
  }
  if (!isTradingDay3(today)) {
    return { ok: false, tone: "warn", reason: `\u4ECA\u65E5\uFF08${today}\uFF09\u975E A \u80A1\u4EA4\u6613\u65E5\uFF0C\u5B9E\u65F6\u6E90\u53EA\u6709\u4E0A\u4E00\u6536\u76D8\u4EF7\u2014\u2014\u6309\u5DF2\u77E5\u4EF7\u7ED3\u7B97\u4F1A\u51FB\u7A7F\u9632\u524D\u89C6\u8BBE\u8BA1\uFF0C\u62D2\u7EDD\u3002\u4E0B\u4E00\u53EF\u64AE\u5408\u65E5 ${nextSessionLabel()}` };
  }
  const codes = normalizeCodes(pending.map((p) => p.code));
  const r = await refreshLive(codes);
  if (!r.ok) return { ok: false, reason: "\u53D6\u4E0D\u5230\u5B9E\u65F6\u884C\u60C5\uFF0C\u65E0\u6CD5\u7ED3\u7B97\uFF08\u8BF7\u7A0D\u540E\u91CD\u8BD5\uFF09" };
  const quotes = {};
  for (const c of codes) {
    const q = LIVEQ[c];
    if (q && Number.isFinite(+q.price)) quotes[c] = { code: c, name: q.name, price: +q.price, changePct: q.changePct ?? null, prevClose: q.prevClose ?? null, tickDate: q.tickDate ?? null, src: "live" };
  }
  const stale = Object.values(quotes).filter((q) => q.tickDate && q.tickDate !== today);
  if (stale.length) {
    return { ok: false, tone: "warn", reason: `\u884C\u60C5\u8FD8\u662F ${stale[0].tickDate} \u7684\uFF08\u4ECA\u65E5 ${today} \u5C1A\u65E0\u6210\u4EA4\u4EF7\uFF1A\u672A\u5F00\u76D8\u6216\u4F11\u5E02\uFF09\u2014\u2014\u7528\u65E7\u4EF7\u7ED3\u7B97\u4F1A\u51FB\u7A7F\u9632\u524D\u89C6\u8BBE\u8BA1\uFF0C\u62D2\u7EDD\u3002\u4ECA\u65E5\u5F00\u76D8\u540E\u518D\u7ED3\u7B97` };
  }
  const res = settleDay(ACCT, today, quotes, { exec: readExecSettings().exec });
  ACCT = res.account;
  save();
  renderAllPaper();
  return { ok: true, date: today, filled: res.fills.length, expired: res.expired.length, t1Hold: res.t1Hold || 0 };
}
function bjToday() {
  const d = new Date(Date.now() + 8 * 36e5);
  return d.toISOString().slice(0, 10);
}
function fmtClock(d) {
  const t = new Date(d);
  if (isNaN(t)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}
function settleNow() {
  settleByLive().then((r) => {
    if (r.ok) {
      msg(`\u7ED3\u7B97\u5B8C\u6210\uFF08${r.date} \u5B9E\u65F6\u4EF7\uFF09\uFF1A\u6210\u4EA4 ${r.filled} \u7B14\u3001\u5931\u6548 ${r.expired} \u7B14${r.t1Hold ? `\u3001\u987A\u5EF6 ${r.t1Hold} \u7B14\uFF08T+1 \u672A\u5230\uFF0C\u4E0B\u4E00\u4EA4\u6613\u65E5\u64AE\u5408\uFF09` : ""}`, "ok");
      return;
    }
    loadRecentArchive().then((arc) => {
      const days = recentDays(arc);
      const todo = days.filter((d) => d.trade_date > (ACCT.lastSettle || ""));
      if (!todo.length) {
        msg(r.reason || "\u5DF2\u662F\u6700\u65B0\uFF0C\u65E0\u9700\u7ED3\u7B97", r.tone || "ok");
        return;
      }
      const from = days[0]?.trade_date;
      if (ACCT.lastSettle && from && from > ACCT.lastSettle) {
        msg(`\u8D26\u6237\u6700\u540E\u7ED3\u7B97\u65E5 ${ACCT.lastSettle} \u65E9\u4E8E\u672C\u5730\u6EDA\u52A8\u7A97\u8D77\u70B9 ${from}\uFF0C\u4EC5\u7ED3\u7B97\u7A97\u53E3\u5185\u4EA4\u6613\u65E5\uFF1B\u5982\u9700\u8865\u9F50\u66F4\u65E9\u65E5\u671F\uFF0C\u8BF7\u91CD\u8DD1 node scripts/split_archive.mjs \u540E\u5237\u65B0`, "err");
      }
      let cur = ACCT, filled = 0, expired = 0, held = 0;
      for (const d of todo) {
        const rr = settleDay(cur, d.trade_date, quotesFromDay(d), { exec: readExecSettings().exec });
        cur = rr.account;
        filled += rr.fills.length;
        expired += rr.expired.length;
        held += rr.t1Hold || 0;
      }
      ACCT = cur;
      QMAP = { ...QMAP, ...quotesFromDay(days[days.length - 1]) };
      LAST_DATE = days[days.length - 1].trade_date;
      save();
      renderAllPaper();
      msg(`\u7ED3\u7B97\u5B8C\u6210\uFF08\u5B58\u6863\u65E5\uFF09\uFF1A\u6210\u4EA4 ${filled} \u7B14\u3001\u5931\u6548 ${expired} \u7B14${held ? `\u3001\u987A\u5EF6 ${held} \u7B14\uFF08T+1 \u672A\u5230\uFF0C\u4E0B\u4E00\u4EA4\u6613\u65E5\u64AE\u5408\uFF09` : ""}`, "ok");
    }).catch((e) => msg("\u7ED3\u7B97\u5931\u8D25\uFF1A" + e.message, "err"));
  });
}
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!t || typeof t.closest !== "function") return;
  const sideBtn = t.closest("#poSide button");
  if (sideBtn) {
    if (sideBtn.dataset.side !== ORDER.side) clearReview();
    ORDER = { ...ORDER, side: sideBtn.dataset.side, qty: 0 };
    syncOrderInputs();
    renderOrderForm();
    renderQuick();
    return;
  }
  const tab = t.closest("#paperTabs button");
  if (tab) {
    HIST = { view: tab.dataset.view };
    document.querySelectorAll("#paperTabs button").forEach((b) => {
      const on = b.dataset.view === HIST.view;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    renderHist();
    return;
  }
  const btSide = t.closest("#btSide button");
  if (btSide) {
    const side = btSide.dataset.side;
    if (side !== BATCH.side) BATCH = { ...BATCH, side, result: null };
    renderBatch();
    return;
  }
  const btMode = t.closest("#btMode button");
  if (btMode) {
    if (!btMode.disabled) BATCH = { ...BATCH, mode: btMode.dataset.mode, result: null };
    renderBatch();
    return;
  }
  const logTab = t.closest("#logTabs button");
  if (logTab) {
    LOG = { stage: logTab.dataset.stage || "" };
    renderLogs();
    return;
  }
  const el = t.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "pqty") {
    ORDER = { ...ORDER, qty: +el.dataset.qty || 0 };
    syncOrderInputs();
    renderOrderForm();
    return;
  }
  if (act === "pqty-pct") {
    const inp = $("poPct");
    PQ_PCT = inp ? inp.value : PQ_PCT;
    const r = qtyByPct(PQ_PCT);
    if (r.qty > 0) {
      ORDER = { ...ORDER, qty: r.qty };
      syncOrderInputs();
      msg(`${(+PQ_PCT).toFixed(1)}% \u603B\u8D44\u4EA7 \u2192 ${r.qty} \u80A1\uFF08\u7EA6 ${num2(r.need)} \u5143\u542B\u8D39\u7528${r.capped ? "\uFF0C\u5DF2\u53D7\u53EF\u7528\u8D44\u91D1\u9650\u5236" : ""}\uFF09`, "ok");
    } else {
      ORDER = { ...ORDER, qty: 0 };
      syncOrderInputs();
      msg(`\u6309 ${PQ_PCT}% \u7B97\u4E0D\u51FA\u6570\u91CF\uFF1A${r.reason}`, "err");
    }
    renderOrderForm();
    return;
  }
  if (act === "pcancel") {
    e.stopPropagation();
    cancel(+el.dataset.id);
    return;
  }
  if (act === "review-ok") {
    e.stopPropagation();
    markReviewed(el.dataset.code || ORDER.code);
    renderOrderForm();
    msg(`\u5DF2\u8BB0\u5F55\u590D\u6838\uFF1A${ORDER.code} \u5141\u8BB8\u672C\u6B21\u4E0B\u5355\u3002\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u63D0\u4EA4\uFF0C\u8BF7\u81EA\u884C\u586B\u5199\u6570\u91CF\u540E\u70B9\u300C\u63D0\u4EA4\u59D4\u6258\u300D\u3002`, "ok");
    return;
  }
  if (act === "pstat") {
    openPaperDrawer(statDetail(el.dataset.k));
    return;
  }
  if (act === "ppos") {
    openPaperDrawer(posDetail(el.dataset.code));
    return;
  }
  if (act === "ppend") {
    openPaperDrawer(pendingDetail(+el.dataset.id));
    return;
  }
  if (act === "phist") {
    openPaperDrawer(histDetail(el.dataset.view, +el.dataset.i));
    return;
  }
  if (act === "pperf") {
    openPaperDrawer(perfDetail(el.dataset.k));
    return;
  }
  if (act === "pick-fill") {
    e.stopPropagation();
    fillPickToOrder(el.dataset.code);
    return;
  }
  if (act === "pick") {
    openPaperDrawer(pickDetail(el.dataset.code));
    return;
  }
  if (act === "alert-fill") {
    e.stopPropagation();
    fillAlertToOrder(+el.dataset.i);
    return;
  }
  if (act === "alert") {
    openPaperDrawer(alertDetail(+el.dataset.i));
    return;
  }
  if (act === "attr-detail") {
    openPaperDrawer(attrDetail());
    return;
  }
});
var codeTimer = null;
$("poCode")?.addEventListener("input", (e) => {
  const v = String(e.target.value || "").replace(/\D/g, "").slice(0, 6);
  e.target.value = v;
  if (v !== ORDER.code) PQ_PCT = null;
  if (v !== ORDER.code) clearReview();
  ORDER = { ...ORDER, code: v, qty: 0 };
  renderOrderForm();
  renderQuick();
  if (codeTimer) clearTimeout(codeTimer);
  if (v.length === 6) {
    codeTimer = setTimeout(async () => {
      if (!LIVEQ[v] && !LIVE_BUSY) {
        msg(`\u6B63\u5728\u83B7\u53D6 ${v} \u5B9E\u65F6\u884C\u60C5\u2026`, "ok");
        const r = await refreshLive([v]);
        renderOrderForm();
        renderQuick();
        if (r.ok) {
          const q = LIVEQ[v];
          msg(`\u5DF2\u83B7\u53D6 ${v} ${q?.name || ""} \u5B9E\u65F6\u884C\u60C5`, "ok");
        } else {
          msg(`${v} \u53D6\u4E0D\u5230\u884C\u60C5\uFF08\u8BF7\u6838\u5BF9\u4EE3\u7801\u662F\u5426\u6B63\u786E / \u662F\u5426\u505C\u724C\uFF09`, "err");
        }
      } else if (LIVEQ[v]) {
        renderOrderForm();
        renderQuick();
      }
    }, 250);
  }
});
$("poQty")?.addEventListener("input", (e) => {
  ORDER = { ...ORDER, qty: Math.max(0, Math.floor(+e.target.value || 0)) };
  renderOrderForm();
});
document.addEventListener("input", (e) => {
  if (!e.target || e.target.id !== "poPct") return;
  PQ_PCT = e.target.value;
  const hint = $("poPctHint");
  if (!hint) return;
  const r = qtyByPct(PQ_PCT);
  if (r.qty > 0) {
    hint.className = "pq-pct-hint";
    hint.textContent = `= ${r.qty} \u80A1\uFF08\u9884\u7B97 ${num2(r.budget)} \u5143 \u2192 \u5360\u7528 ${num2(r.need)} \u5143\u542B\u8D39\u7528${r.capped ? "\uFF0C\u53D7\u53EF\u7528\u8D44\u91D1\u9650\u5236" : ""}\uFF09`;
  } else {
    hint.className = "pq-pct-hint bad";
    hint.textContent = r.reason || "";
  }
});
$("poSubmit")?.addEventListener("click", submit);
$("paperReset")?.addEventListener("click", reset);
$("paperInitCash")?.addEventListener("change", (e) => {
  const n = saveInitCash(e.target.value);
  if (n == null) {
    const why = $("paperMsg")?.textContent;
    syncInitCashInput();
    if (why) msg(why, "err");
    return;
  }
  msg(`\u521D\u59CB\u8D44\u91D1\u5DF2\u8BBE\u4E3A ${n.toLocaleString()} \u5143\uFF08\u70B9\u300C\u6309\u6B64\u91D1\u989D\u65B0\u5EFA\u8D26\u6237\u300D\u751F\u6548\uFF09`, "ok");
});
$("paperApplyInit")?.addEventListener("click", applyInitCash);
$("paperExport")?.addEventListener("click", doExport);
$("paperImport")?.addEventListener("click", doImport);
$("paperSettle")?.addEventListener("click", settleNow);
wireExecControls();
$("paperCloseAll")?.addEventListener("click", () => {
  const n = Object.keys(ACCT?.positions || {}).length;
  if (!n) {
    msg("\u5F53\u524D\u65E0\u6301\u4ED3\uFF0C\u65E0\u9700\u7A7A\u4ED3", "ok");
    return;
  }
  if (!window.confirm(`\u5C06\u5BF9 ${n} \u53EA\u6301\u4ED3\u5168\u90E8\u6302\u51FA\u5356\u5355\uFF08\u6309\u5404\u81EA\u53EF\u5356\u6570\u91CF\u3001\u6309\u5B9E\u65F6\u4EF7\uFF09\u3002
T+1 \u4E0B\u5F53\u65E5\u4E70\u5165\u7684\u80A1\u4EFD\u5356\u4E0D\u6389\uFF0C\u4F1A\u5982\u5B9E\u544A\u77E5\u3002

\u786E\u5B9A\u7EE7\u7EED\uFF1F`)) return;
  closeAll();
});
$("btSubmit")?.addEventListener("click", runBatch);
$("btClear")?.addEventListener("click", () => {
  const ta = $("btInput");
  if (ta) ta.value = "";
  BATCH = { ...BATCH, result: null };
  renderBatch();
});
$("btFillPicks")?.addEventListener("click", () => {
  const r = currentPicks();
  if (!r || !r.picks.length) {
    msg("\u6682\u65E0\u7814\u5224\u63A8\u8350\uFF08\u9700\u5148\u6709\u884C\u60C5\u5B58\u6863\uFF09\uFF0C\u65E0\u6CD5\u586B\u5165", "err");
    return;
  }
  const ta = $("btInput");
  if (!ta) return;
  const pct2 = Math.max(0.1, +($("btDefaultPct")?.value || 5) || 5);
  ta.value = r.picks.map((p) => `${p.code},${pct2}`).join("\n");
  BATCH = { ...BATCH, side: "buy", result: null };
  renderBatch();
  msg(`\u5DF2\u586B\u5165 ${r.picks.length} \u53EA\u7814\u5224\u63A8\u8350\uFF08\u6BCF\u53EA ${pct2}% \u4ED3\u4F4D\u9884\u89C8\uFF09\u2014\u2014\u8BF7\u6838\u5BF9\u540E\u70B9\u300C\u6279\u91CF\u63D0\u4EA4\u59D4\u6258\u300D`, "ok");
});
$("btFillPos")?.addEventListener("click", () => {
  const codes = Object.keys(ACCT?.positions || {});
  if (!codes.length) {
    msg("\u5F53\u524D\u65E0\u6301\u4ED3\uFF0C\u65E0\u6CD5\u586B\u5165", "err");
    return;
  }
  const ta = $("btInput");
  if (!ta) return;
  ta.value = codes.join("\n");
  BATCH = { ...BATCH, side: "sell", result: null };
  renderBatch();
  msg(`\u5DF2\u586B\u5165 ${codes.length} \u53EA\u6301\u4ED3\uFF08\u6309\u5404\u81EA\u53EF\u5356\u6570\u91CF\u5356\u51FA\uFF09\u2014\u2014\u8BF7\u6838\u5BF9\u540E\u70B9\u300C\u6279\u91CF\u63D0\u4EA4\u59D4\u6258\u300D`, "ok");
});
$("logExport")?.addEventListener("click", doLogExport);
$("logCopy")?.addEventListener("click", doLogCopy);
$("logClear")?.addEventListener("click", doLogClear);
$("btDefaultPct")?.addEventListener("change", (e) => {
  BATCH = { ...BATCH, defaultPct: Math.max(0.1, +e.target.value || 5) };
});
document.addEventListener("keydown", (e) => {
  const t = e.target;
  const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "6") {
    const z = document.getElementById("zone-paper");
    if (z) {
      e.preventDefault();
      z.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }
});
boot();

// src/intraday_live.js
var PORTFOLIO_CODE = "__PORTFOLIO__";
var DD_EDGES = DD_TIERS.map((t) => t.threshold).filter((t) => t > 0).sort((a, b) => a - b);
function riskTierDistance(drawdown) {
  if (drawdown == null || !Number.isFinite(+drawdown) || +drawdown < 0) return null;
  const dd = +drawdown;
  const nearest = DD_EDGES.find((e) => e >= dd) ?? DD_EDGES[DD_EDGES.length - 1];
  return nearest - dd;
}
var SERIES_KEY_PREFIX2 = "asent-ilv-";
function seriesKey(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return SERIES_KEY_PREFIX2 + date;
}
var fin = (v) => Number.isFinite(+v);
var num3 = (v) => fin(v) ? +v : null;
function intradayEquity({ equityPrev, posToday, quotes }) {
  const base = num3(equityPrev);
  if (base == null || base <= 0 || !posToday || typeof posToday !== "object") return null;
  const names = Object.keys(posToday);
  if (!names.length) return null;
  let weighted = 0;
  for (const name of names) {
    const pct2 = num3(quotes?.[name]?.pct);
    if (pct2 == null) return null;
    weighted += (fin(posToday[name]) ? +posToday[name] : 0) * (pct2 / 100);
  }
  const dayRet = weighted / names.length;
  return { equity: base * (1 + dayRet), dayRet };
}
function buildLiveAccount({ navSeries, equityRealtime, tradeDate, initCash }) {
  const eq = num3(equityRealtime);
  const cash0 = num3(initCash);
  if (eq == null || eq <= 0 || cash0 == null || cash0 <= 0 || typeof tradeDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || !Array.isArray(navSeries) || !navSeries.length) return null;
  const nav = navSeries.filter((s) => s && typeof s.date === "string" && fin(s.equity)).map((s) => ({ date: s.date, equity: +s.equity }));
  if (!nav.length) return null;
  if (nav[nav.length - 1].date !== tradeDate) nav.push({ date: tradeDate, equity: eq });
  return {
    initCash: cash0,
    cash: 0,
    freeze: 0,
    positions: { [PORTFOLIO_CODE]: { code: PORTFOLIO_CODE, name: "\u8F68\u9053A\u7EC4\u5408\uFF08\u6307\u6570\u6C60\xD7\u4ED3\u4F4D\uFF09", qty: 1, last: eq, avgCost: cash0, cost: cash0 } },
    nav
  };
}
function liveAccountStats(account) {
  return accountStats(account);
}
function appendSample(series, sample) {
  const arr = Array.isArray(series) ? series.filter((s) => s && fin(s.equity)) : [];
  if (!sample || !fin(sample.equity) || typeof sample.date !== "string") return arr;
  if (arr.length && arr[0].date !== sample.date) arr.length = 0;
  arr.push({ date: sample.date, ts: num3(sample.ts) ?? Date.now(), equity: +sample.equity });
  return arr;
}
function deserializeSeries(stored, key) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
  if (stored.key !== key || !Array.isArray(stored.samples)) return [];
  return stored.samples.filter((s) => s && typeof s.date === "string" && fin(s.equity));
}
function dailyDrawdown(series) {
  const arr = (Array.isArray(series) ? series : []).filter((s) => s && fin(s.equity));
  if (arr.length < 2) return null;
  const high = Math.max(...arr.map((s) => +s.equity));
  const now = +arr[arr.length - 1].equity;
  if (!(high > 0)) return null;
  return Math.max(0, (high - now) / high);
}

// src/intraday_sampler.js
var TICK_MS = 60 * 1e3;
var LS_KEY2 = "asent-ilv-store";
function jsonpVar(url, varNames) {
  return new Promise((resolve, reject2) => {
    const s = document.createElement("script");
    const tmo = setTimeout(() => {
      s.remove();
      reject2(new Error("timeout"));
    }, 9e3);
    s.onload = () => {
      clearTimeout(tmo);
      const out2 = {};
      varNames.forEach((n) => {
        try {
          out2[n] = window[n];
        } catch {
        }
      });
      s.remove();
      resolve(out2);
    };
    s.onerror = () => {
      clearTimeout(tmo);
      s.remove();
      reject2(new Error("network"));
    };
    s.referrerPolicy = "no-referrer";
    s.src = url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    document.head.appendChild(s);
  });
}
async function fetchPoolQuotes(pool) {
  const codes = pool.filter((p) => p && p.code).map((p) => p.code);
  if (!codes.length) return null;
  try {
    const res = await jsonpVar("https://qt.gtimg.cn/q=" + codes.join(","), codes.map((c) => "v_" + c));
    const byCode = {};
    for (const p of pool) {
      if (!p || !p.code) continue;
      const f = String(res["v_" + p.code] || "").split("~");
      if (f.length > 32 && Number.isFinite(+f[32])) byCode[p.name] = { pct: +f[32] };
    }
    return Object.keys(byCode).length ? byCode : null;
  } catch {
    return null;
  }
}
var anchor = null;
var samples = [];
var lastKey = null;
var timer = null;
function todayStr() {
  return bjDate();
}
function loadSeries(key) {
  try {
    return deserializeSeries(JSON.parse(localStorage.getItem(LS_KEY2) || "null"), key);
  } catch {
    return [];
  }
}
function persistSeries(key) {
  try {
    localStorage.setItem(LS_KEY2, JSON.stringify({ key, samples }));
  } catch {
  }
}
function publish() {
  const account = anchor && samples.length ? buildLiveAccount({
    navSeries: anchor.nav_series,
    equityRealtime: samples[samples.length - 1].equity,
    tradeDate: todayStr(),
    initCash: anchor.init_cash
  }) : null;
  const stats = account ? liveAccountStats(account) : null;
  window.__intradayLive = account ? {
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    valuation: anchor,
    // 估值锚（equity_prev / pos_today / pool）
    samples,
    // 当日权益序列
    account,
    // accountStats 形态（generateIntraday input.live）
    stats,
    // 便捷快照（total / drawdown / …）
    drawdownDaily: dailyDrawdown(samples),
    // 当日高点回撤（null = 不足两点）
    ddDistance: riskTierDistance(stats.drawdown)
    // 距下一档风控线（总回撤实时版口径，与报告同尺）
  } : null;
  window.dispatchEvent(new Event("intraday-live-update"));
}
async function tick() {
  if (!anchor || !inTradingSession()) return;
  const quotes = await fetchPoolQuotes(anchor.pool);
  if (!quotes) return;
  const val = intradayEquity({ equityPrev: anchor.equity_prev, posToday: anchor.pos_today, quotes });
  if (!val) return;
  const key = seriesKey(todayStr());
  if (key && key !== lastKey) {
    lastKey = key;
    samples = loadSeries(key);
  }
  samples = appendSample(samples, { date: todayStr(), ts: Date.now(), equity: val.equity });
  persistSeries(key || SERIES_KEY_PREFIX + "unknown");
  publish();
}
async function loadAnchor() {
  try {
    const res = await dget("./data/paper/dual_track_latest.json", { cache: "no-store" });
    if (!res.ok) return;
    const doc = await res.json();
    const v = doc && doc.intraday_valuation;
    if (v && Number.isFinite(+v.equity_prev) && v.pos_today && Array.isArray(v.nav_series) && v.nav_series.length) {
      anchor = v;
      publish();
    }
  } catch {
  }
}
loadAnchor();
timer = setInterval(() => {
  loadAnchor();
  tick();
}, TICK_MS);
if (document.visibilitychange !== void 0) {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
}

// src/_browser_bundle_entry.js
window.ReportExport = report_exports;
window.dispatchEvent(new Event("report-export-ready"));
window.ReportAudit = report_audit_exports;
window.dispatchEvent(new Event("report-audit-ready"));
window.Seats = seats_exports;
window.dispatchEvent(new Event("seats-ready"));
window.PaperReview = paper_review_exports;
window.dispatchEvent(new Event("paper-review-ready"));
window.ReportCardLive = report_card_live_exports;
window.dispatchEvent(new Event("report-card-live-ready"));
window.DatasetExport = dataset_exports;
window.dispatchEvent(new Event("dataset-export-ready"));
window.ErrorBoundary = error_boundary_exports;
window.dispatchEvent(new Event("error-boundary-ready"));
window.ValidateExternal = validate_snapshot_exports;
window.dispatchEvent(new Event("validate-external-ready"));
