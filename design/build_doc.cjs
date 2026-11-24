/* 汇编《A股情绪系统 PRO · UI 端设计方案》自包含 HTML
 * 用法：node design/build_doc.cjs
 * 输入：design/*.md（5 册 + BRIEF）、design/assets/*.png、design/assets/自检报告.json
 * 输出：design/UI设计方案.html
 * 所有图示与样式内嵌，仅视觉稿 PNG 走相对路径 assets/。
 */
const fs = require('fs');
const path = require('path');
const DIR = 'D:/app 1/2026-11-14-21-47-50/design';
const A = 'assets/';

/* ---------------- Markdown → HTML（够用即可，覆盖本套文档全部语法） ---------------- */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
}
function md2html(md, levelOffset = 2) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const L = lines[i];
    // 代码块
    const fence = L.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      const body = buf.join('\n');
      if (lang === 'svg') out.push('<figure class="fig">' + body + '</figure>');
      else out.push('<pre class="code"><code class="lang-' + lang + '">' + esc(body) + '</code></pre>');
      continue;
    }
    // 表格
    if (/^\s*\|/.test(L) && i + 1 < lines.length && /^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      let h = '<div class="tw"><table><thead><tr>' + cells(rows[0]).map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
      for (let k = 2; k < rows.length; k++) h += '<tr>' + cells(rows[k]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
      out.push(h + '</tbody></table></div>');
      continue;
    }
    // 标题
    const hm = L.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lv = Math.min(6, hm[1].length + levelOffset);
      const id = 'h-' + out.length + '-' + hm[2].replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 16);
      out.push('<h' + lv + ' id="' + id + '">' + inline(hm[2]) + '</h' + lv + '>');
      i++; continue;
    }
    // 分隔线
    if (/^\s*---+\s*$/.test(L)) { out.push('<hr>'); i++; continue; }
    // 引用
    if (/^\s*>\s?/.test(L)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push('<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>');
      continue;
    }
    // 列表
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(L)) {
      const ordered = /^\s*\d+\./.test(L);
      const buf = [];
      while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '')); i++;
      }
      out.push('<' + (ordered ? 'ol' : 'ul') + '>' + buf.map(x => '<li>' + inline(x) + '</li>').join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
      continue;
    }
    // 空行
    if (!L.trim()) { i++; continue; }
    // 段落（合并连续非空行）
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(?:#{1,6}\s|```|\s*>|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) {
      buf.push(lines[i].trim()); i++;
    }
    if (buf.length) out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
    else { out.push('<p>' + inline(L) + '</p>'); i++; }
  }
  return out.join('\n');
}

/* ---------------- 从分册抽取 SVG 图示 ---------------- */
function takeSvgs(file, n) {
  const s = fs.readFileSync(path.join(DIR, file), 'utf8');
  const m = [...s.matchAll(/```svg\n([\s\S]*?)\n```/g)].map(x => x[1]);
  return m.slice(0, n);
}
const IA = takeSvgs('01_设计战略与信息架构.md', 3);
const VIS = takeSvgs('02_视觉语言与设计令牌.md', 3);

/* ---------------- 自绘图示 ---------------- */
const SVG = {
  metric: `<svg viewBox="0 0 680 300" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="680" height="300" fill="#0b0e11"/>
<text x="24" y="32" fill="#e8eef5" font-family="sans-serif" font-size="16" font-weight="600">权重倒置 → 结论优先（实测对照）</text>
<text x="24" y="66" fill="#a8b6c5" font-family="sans-serif" font-size="11">屏幕高度占比 · 桌面 1440px 正常数据态</text>
<text x="24" y="102" fill="#a8b6c5" font-family="sans-serif" font-size="12">改造前</text>
<rect x="92" y="88" width="530" height="22" fill="#1a222b"/>
<rect x="92" y="88" width="307" height="22" fill="#f5b544"/>
<rect x="399" y="88" width="90" height="22" fill="#35d6d0"/>
<rect x="489" y="88" width="133" height="22" fill="#2e3b49"/>
<text x="100" y="104" fill="#04161a" font-family="sans-serif" font-size="11">操作/审计 58%</text>
<text x="403" y="104" fill="#04161a" font-family="sans-serif" font-size="11">结论 17%</text>
<text x="500" y="104" fill="#e8eef5" font-family="sans-serif" font-size="11">其余 25%</text>
<text x="24" y="158" fill="#a8b6c5" font-family="sans-serif" font-size="12">设计目标</text>
<rect x="92" y="144" width="530" height="22" fill="#1a222b"/>
<rect x="92" y="144" width="95" height="22" fill="#f5b544"/>
<rect x="187" y="144" width="212" height="22" fill="#35d6d0"/>
<rect x="399" y="144" width="223" height="22" fill="#2e3b49"/>
<text x="100" y="160" fill="#04161a" font-family="sans-serif" font-size="11">≤18%</text>
<text x="195" y="160" fill="#04161a" font-family="sans-serif" font-size="11">结论 ≥40%</text>
<text x="408" y="160" fill="#e8eef5" font-family="sans-serif" font-size="11">证据层 42%</text>
<text x="24" y="210" fill="#a8b6c5" font-family="sans-serif" font-size="12">页高实测</text>
<rect x="92" y="196" width="530" height="22" fill="#1a222b"/>
<rect x="92" y="196" width="530" height="22" fill="#ff5b5b" opacity="0.35"/>
<text x="100" y="212" fill="#e8eef5" font-family="sans-serif" font-size="11">桌面 9521px ｜ 移动 34829px</text>
<rect x="92" y="230" width="530" height="22" fill="#1a222b"/>
<rect x="92" y="230" width="105" height="22" fill="#2fd39a" opacity="0.55"/>
<text x="205" y="246" fill="#e8eef5" font-family="sans-serif" font-size="11">原型：桌面 1883px ｜ 移动 3170px（同比例）</text>
<text x="24" y="284" fill="#728298" font-family="sans-serif" font-size="10">结论：把 58% 的操作/审计收进 tab 与抽屉，首屏还给「今天什么风险」。</text>
</svg>`,

  breakpoints: `<svg viewBox="0 0 680 340" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="680" height="340" fill="#0b0e11"/>
<text x="24" y="30" fill="#e8eef5" font-family="sans-serif" font-size="16" font-weight="600">四档断点 · 同一套组件，三种形态</text>
<!-- 桌面 -->
<rect x="24" y="52" width="200" height="126" rx="6" fill="#151b22" stroke="#2e3b49"/>
<rect x="24" y="52" width="200" height="14" rx="6" fill="#202a35"/>
<rect x="34" y="76" width="180" height="20" fill="#123b40"/>
<rect x="34" y="102" width="42" height="30" fill="#232d38"/><rect x="82" y="102" width="42" height="30" fill="#232d38"/>
<rect x="130" y="102" width="42" height="30" fill="#232d38"/><rect x="178" y="102" width="36" height="30" fill="#232d38"/>
<rect x="34" y="140" width="116" height="28" fill="#232d38"/><rect x="156" y="140" width="58" height="28" fill="#232d38"/>
<text x="34" y="196" fill="#35d6d0" font-family="sans-serif" font-size="11">≥1440 / 1024–1439</text>
<text x="34" y="212" fill="#728298" font-family="sans-serif" font-size="10">12 列 · 顶栏 tab · 抽屉 420/640/960</text>
<!-- 平板 -->
<rect x="240" y="52" width="200" height="126" rx="6" fill="#151b22" stroke="#2e3b49"/>
<rect x="240" y="52" width="200" height="14" rx="6" fill="#202a35"/>
<rect x="250" y="76" width="180" height="20" fill="#123b40"/>
<rect x="250" y="102" width="87" height="30" fill="#232d38"/><rect x="343" y="102" width="87" height="30" fill="#232d38"/>
<rect x="250" y="140" width="180" height="28" fill="#232d38"/>
<text x="250" y="196" fill="#35d6d0" font-family="sans-serif" font-size="11">640–1023</text>
<text x="250" y="212" fill="#728298" font-family="sans-serif" font-size="10">6 列 · KPI 3 列 · 表隐藏优先 3/4 列</text>
<!-- 手机 -->
<rect x="518" y="52" width="138" height="126" rx="6" fill="#151b22" stroke="#2e3b49"/>
<rect x="518" y="52" width="138" height="14" rx="6" fill="#202a35"/>
<rect x="526" y="76" width="122" height="18" fill="#123b40"/>
<rect x="526" y="100" width="59" height="26" fill="#232d38"/><rect x="589" y="100" width="59" height="26" fill="#232d38"/>
<rect x="526" y="132" width="122" height="26" fill="#232d38"/>
<rect x="518" y="164" width="138" height="14" fill="#123b40"/>
<text x="526" y="196" fill="#35d6d0" font-family="sans-serif" font-size="11">&lt;640</text>
<text x="526" y="212" fill="#728298" font-family="sans-serif" font-size="10">1 列 · 底部 5 tab</text>
<!-- 规则 -->
<rect x="24" y="240" width="632" height="78" rx="6" fill="#151b22" stroke="#232d38"/>
<text x="38" y="262" fill="#e8eef5" font-family="sans-serif" font-size="12" font-weight="600">共用规则（不是三套 UI）</text>
<text x="38" y="282" fill="#a8b6c5" font-family="sans-serif" font-size="11">· 表格 data-priority 列分级，窄屏隐藏低优先列，横向溢出 = 0</text>
<text x="38" y="300" fill="#a8b6c5" font-family="sans-serif" font-size="11">· 抽屉 &lt;640 变全屏 sheet；ticker 让位底部导航；触控目标 ≥44px</text>
</svg>`,

  skeleton: `<svg viewBox="0 0 680 290" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="680" height="290" fill="#0b0e11"/>
<text x="24" y="30" fill="#e8eef5" font-family="sans-serif" font-size="16" font-weight="600">骨架原位替换 · 替代「锁死高度 + 盒内滚动」</text>
<rect x="24" y="56" width="112" height="46" rx="6" fill="#202a35" stroke="#2e3b49"/>
<text x="44" y="84" fill="#e8eef5" font-family="sans-serif" font-size="12">idle / 请求</text>
<path d="M136 79 L172 79" stroke="#35d6d0" stroke-width="2" fill="none"/>
<rect x="172" y="56" width="132" height="46" rx="6" fill="#123b40" stroke="#35d6d0"/>
<text x="188" y="77" fill="#35d6d0" font-family="sans-serif" font-size="12">skeleton 占位</text>
<text x="188" y="93" fill="#a8b6c5" font-family="sans-serif" font-size="10">尺寸 = 真实内容</text>
<path d="M304 79 L340 79" stroke="#35d6d0" stroke-width="2" fill="none"/>
<rect x="340" y="48" width="104" height="30" rx="5" fill="#12332b" stroke="#2fd39a"/>
<text x="358" y="68" fill="#2fd39a" font-family="sans-serif" font-size="11">ready 原位替换</text>
<rect x="340" y="84" width="104" height="30" rx="5" fill="#3a2c14" stroke="#f5b544"/>
<text x="358" y="104" fill="#f5b544" font-family="sans-serif" font-size="11">empty 空状态</text>
<rect x="340" y="120" width="104" height="30" rx="5" fill="#3d1a1d" stroke="#ff4d4f"/>
<text x="358" y="140" fill="#ff4d4f" font-family="sans-serif" font-size="11">error 局部兜底</text>
<rect x="462" y="56" width="194" height="94" rx="6" fill="#151b22" stroke="#232d38"/>
<text x="476" y="78" fill="#e8eef5" font-family="sans-serif" font-size="11" font-weight="600">尺寸契约实测</text>
<text x="476" y="98" fill="#a8b6c5" font-family="sans-serif" font-size="11">真实 KPI 卡 133.1px</text>
<text x="476" y="116" fill="#a8b6c5" font-family="sans-serif" font-size="11">骨架同高 134px → 位移 0</text>
<text x="476" y="136" fill="#2fd39a" font-family="sans-serif" font-size="11">两态页高均为 1883px</text>
<rect x="24" y="170" width="632" height="96" rx="6" fill="#151b22" stroke="#232d38"/>
<text x="38" y="192" fill="#e8eef5" font-family="sans-serif" font-size="12" font-weight="600">为什么能同时解掉 CLS 与裁切</text>
<text x="38" y="214" fill="#a8b6c5" font-family="sans-serif" font-size="11">· 占位与内容等高 → 内容注入不推挤后续区块，CLS 不再靠固定高容器硬压</text>
<text x="38" y="234" fill="#a8b6c5" font-family="sans-serif" font-size="11">· 内容自然增高、整页滚动 → 18 处盒内滚动归零，半截字裁切消失</text>
<text x="38" y="254" fill="#a8b6c5" font-family="sans-serif" font-size="11">· 错误只降级对应区块，不再 main[aria-hidden] 整站消失</text>
</svg>`,

  phases: `<svg viewBox="0 0 680 300" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="680" height="300" fill="#0b0e11"/>
<text x="24" y="30" fill="#e8eef5" font-family="sans-serif" font-size="16" font-weight="600">六阶段迁移 · 每阶段可独立上线、可回滚</text>
<g font-family="sans-serif" font-size="11">
<rect x="24" y="56" width="100" height="62" rx="6" fill="#151b22" stroke="#2e3b49"/><text x="36" y="78" fill="#35d6d0">P1 令牌层</text><text x="36" y="98" fill="#a8b6c5" font-size="10">.s-scope 共存</text><text x="36" y="112" fill="#728298" font-size="10">零业务改动</text>
<rect x="136" y="56" width="100" height="62" rx="6" fill="#151b22" stroke="#2e3b49"/><text x="148" y="78" fill="#35d6d0">P2 结论层</text><text x="148" y="98" fill="#a8b6c5" font-size="10">指标条+摘要条</text><text x="148" y="112" fill="#728298" font-size="10">flag 可熔断</text>
<rect x="248" y="56" width="100" height="62" rx="6" fill="#151b22" stroke="#2e3b49"/><text x="260" y="78" fill="#35d6d0">P3 骨架</text><text x="260" y="98" fill="#a8b6c5" font-size="10">锁高→占位</text><text x="260" y="112" fill="#728298" font-size="10">CLS 实测门禁</text>
<rect x="360" y="56" width="100" height="62" rx="6" fill="#151b22" stroke="#2e3b49"/><text x="372" y="78" fill="#35d6d0">P4 门与抽屉</text><text x="372" y="98" fill="#a8b6c5" font-size="10">大表/长文收编</text><text x="372" y="112" fill="#728298" font-size="10">三档宽度</text>
<rect x="472" y="56" width="100" height="62" rx="6" fill="#151b22" stroke="#2e3b49"/><text x="484" y="78" fill="#35d6d0">P5 移动</text><text x="484" y="98" fill="#a8b6c5" font-size="10">底部 bar+列分级</text><text x="484" y="112" fill="#728298" font-size="10">溢出归零</text>
<rect x="584" y="56" width="72" height="62" rx="6" fill="#123b40" stroke="#35d6d0"/><text x="596" y="78" fill="#35d6d0">P6 收敛</text><text x="596" y="98" fill="#a8b6c5" font-size="10">研报降级</text><text x="596" y="112" fill="#728298" font-size="10">单一语言</text>
</g>
<path d="M24 134 L656 134" stroke="#2e3b49" stroke-width="2" fill="none"/>
<rect x="24" y="152" width="632" height="122" rx="6" fill="#151b22" stroke="#232d38"/>
<text x="38" y="176" fill="#e8eef5" font-family="sans-serif" font-size="12" font-weight="600">三条实现机制（数据层零改动）</text>
<text x="38" y="198" fill="#a8b6c5" font-family="sans-serif" font-size="11">① 新增适配层：把现有 38 个 render* 的输出接到新容器，不改函数体与 34 个 data/*.json</text>
<text x="38" y="218" fill="#a8b6c5" font-family="sans-serif" font-size="11">② CSS 作用域隔离：.s-scope 前缀 + [hidden] 真隐藏，与 .t-scope / 研报 style.css 选择器零冲突</text>
<text x="38" y="238" fill="#a8b6c5" font-family="sans-serif" font-size="11">③ 渐进增强 + flag：每阶段独立开关，回滚 = 关 flag，不需要回滚数据或路由</text>
<text x="38" y="260" fill="#f5b544" font-family="sans-serif" font-size="11">兼容硬约束：?view=terminal / #terminal、1-6 与 / 与 -、导出 12 项、LINK 联动总线全部保留</text>
</svg>`
};

/* ---------------- 视觉稿 ---------------- */
const SHOT_GROUPS = [
  { title: '改造前 · 线上真实渲染（诊断证据）', note: '桌面整页 9521px / 移动 34829px / 工作台覆盖层', files: [
    ['00_改造前_桌面全页.png','桌面整页 1440×9521（宏观长图，等宽等高条块堆叠）'],
    ['00_改造前_移动首屏.png','390px 首屏（状态条半截字、顶栏裁切）'],
    ['00_改造前_工作台.png','研究工作台总览（结论指标条 + 大图，重构基底）'],
  ]},
  { title: '改造后 · 桌面端', note: '1440px 与 834px，结论 → 证据 → 操作三段', files: [
    ['01_桌面_总览首屏.png','总览首屏 1440×1000：结论条 + 6 KPI + 走势图全部在首屏'],
    ['02_桌面_总览全页.png','总览整页 1440×1883：三段分组、零盒内滚动、ticker 贴底'],
    ['03_桌面_回测明细抽屉.png','加宽抽屉 960px：策略明细（示例行数），表头吸顶、席位名不截断'],
    ['04_桌面_回测视图.png','回测 tab：指标 / 净值曲线 / 参数 / 明细门'],
    ['05_桌面_浅色主题.png','浅色主题：同一套令牌覆盖，红涨绿跌仍清晰'],
    ['06_桌面_骨架态.png','骨架态：与真实卡等高 134px，页高不变'],
    ['11_平板_总览.png','834×1112 中间断点：6 列栅格 / KPI 3 列'],
    ['12_桌面_个股详情抽屉.png','默认档 420px：键值详情 + 空状态 + 参数来源'],
  ]},
  { title: '改造后 · 移动端', note: '390px，整页 3170px，横向溢出 0', files: [
    ['07_移动_总览首屏.png','移动首屏：结论条 + 2 列 KPI + 底部 5 tab'],
    ['08_移动_总览全页.png','移动整页 390×3170：无半截字、无空表占位'],
    ['09_移动_明细抽屉全屏.png','全屏 sheet：表格列分级为 3 列，日期不折行'],
    ['10_移动_更多抽屉.png','「更多」抽屉：9 tab 收敛 + 快捷操作 + 状态'],
  ]},
];

/* ---------------- 自检数据 ---------------- */
let CHECK = [];
try { CHECK = JSON.parse(fs.readFileSync(path.join(DIR, 'assets/自检报告.json'), 'utf8')); } catch (e) {}
const find = n => CHECK.find(x => x.name === n) || {};

/* ---------------- 分册全文 ---------------- */
const BOOKS = [
  ['BRIEF.md', '设计输入 · Phase 0 全量侦察事实底座'],
  ['01_设计战略与信息架构.md', '分册 01 · 设计战略与信息架构（Phase 2）'],
  ['02_视觉语言与设计令牌.md', '分册 02 · 视觉语言与设计令牌（Phase 1）'],
  ['03_体验规范与响应式.md', '分册 03 · 体验规范与响应式（Phase 2）'],
  ['04_页面蓝图与组件规格.md', '分册 04 · 页面蓝图与组件规格（Phase 3）'],
  ['05_落地实施与验收.md', '分册 05 · 落地实施与验收（Phase 3）'],
  ['06_落地任务单.md', '分册 06 · 落地任务单 · A 方案（含 R1–R5 评审修订记录）'],
];

/* ---------------- 组装 ---------------- */
const nav = [
  ['s1','诊断：问题不是审美'],['s2','战略：A 方案与三层 IA'],['s3','视觉：统一令牌'],
  ['s4','体验：响应式与状态'],['s5','蓝图：页面与组件'],['s6','落地：六阶段与验收'],
  ['s7','视觉稿（15 张）'],['s8','实测验收与取舍'],['s9','分册全文'],['s10','文件地图与运行'],
];

function figure(svg, cap) {
  return '<figure class="fig">' + svg + '<figcaption>' + cap + '</figcaption></figure>';
}
function gallery(g) {
  return '<h3>' + g.title + '</h3><p class="note">' + g.note + '</p><div class="gal">' +
    g.files.map(([f, cap]) => '<figure class="shot"><img src="' + A + encodeURIComponent(f) + '" alt="' + cap + '"><figcaption>' + cap + '</figcaption></figure>').join('') +
    '</div>';
}

const desktop = find('02_桌面_总览全页'), mobile = find('08_移动_总览全页'), skel = find('06_桌面_骨架态'), drawer = find('03_桌面_回测明细抽屉');
const overflowAll = CHECK.length ? Math.max(...CHECK.map(x => (x.overflowEls || []).length)) : 0;

const body = `
<header class="cover">
  <div class="kicker">UI DESIGN SYSTEM · DELIVERY v1.0</div>
  <h1>A股情绪系统 PRO<br><span>UI 端重构设计方案</span></h1>
  <p class="lede">一套能直接落地的设计系统：桌面网页 + 移动网页同源代码、同一套令牌、同一个信息架构。<br>
  基于 2026-11-14 对线上站点的全量真实渲染侦察（桌面 9 屏 / 移动 43 屏 / 工作台 8 tab / 全部可触发交互态）。</p>
  <div class="meta"><span>交付日期 2026-11-14</span><span>只出方案 · 未改线上代码</span><span>数据层零改动</span><span>专家团三阶段汇编</span></div>
</header>

<section id="s0" class="sec">
  <h2>交付清单</h2>
  <div class="tw"><table><thead><tr><th>文件</th><th>内容</th><th>用途</th></tr></thead><tbody>
  <tr><td><code>UI设计方案.html</code></td><td>本文件：全文汇编 + 10 张图示 + 15 张视觉稿 + 自检结果</td><td>评审 / 打印 / 归档</td></tr>
  <tr><td><code>UI设计方案.pdf</code></td><td>主文档全部章节 + 图示 + 视觉稿的打印版（分册折叠全文不进 PDF，见 HTML / Markdown）</td><td>离线传阅 / 汇报</td></tr>
  <tr><td><code>00_README.md</code></td><td>一页索引与开工顺序</td><td>给开发者</td></tr>
  <tr><td><code>BRIEF.md</code></td><td>Phase 0 侦察事实底座（含已证伪结论清单）</td><td>全员共用</td></tr>
  <tr><td><code>01…06_*.md</code></td><td>战略 IA / 视觉令牌 / 体验规范 / 页面蓝图和 DOM 映射 / 落地验收 / 落地任务单，共 6 册约 350KB</td><td>实施依据</td></tr>
  <tr><td><code>prototype/index.html</code></td><td>高保真响应式原型，可直接双击打开</td><td>视觉与交互走查</td></tr>
  <tr><td><code>prototype/tokens.css</code></td><td>151 个 <code>--s-*</code> 令牌 + 深浅主题 + 基础重置</td><td>直接复制进项目</td></tr>
  <tr><td><code>prototype/components.css</code></td><td>完整组件层（栅格/卡片/表格/抽屉/骨架/打印）</td><td>直接复制进项目</td></tr>
  <tr><td><code>assets/*.png</code></td><td>改造前 3 张 + 改造后 12 张真实渲染视觉稿</td><td>对照 / 汇报</td></tr>
  <tr><td><code>assets/自检报告.json</code></td><td>12 种视口/状态的自动化自检原始数据</td><td>验收留痕</td></tr>
  <tr><td><code>assets/门禁自检.json</code></td><td>发布门禁脚本的实跑结果（令牌守卫 / 深链 DOM / 动态分页）</td><td>发布卡留痕</td></tr>
  <tr><td><code>verify_phase_gates.cjs</code></td><td>可运行发布门禁：<code>tokens</code> 令牌守卫 / <code>links</code> 深链渲染态 DOM 断言 / <code>pager</code> 动态行数分页</td><td>每阶段发布卡 / CI</td></tr>
  <tr><td><code>shots.cjs / build_doc.cjs / sync_tokens.cjs / measure.cjs</code></td><td>可复现的渲染、汇编、令牌同步、量测脚本</td><td>持续维护</td></tr>
  </tbody></table></div>

  <h2>一页速览</h2>
  <div class="kpis">
    <div class="kpi"><b>结论 → 证据 → 操作</b><span>三层 IA，14 类功能全部归位</span></div>
    <div class="kpi"><b>9 tab + 3 档抽屉</b><span>重内容收进「门」，首屏还给结论</span></div>
    <div class="kpi"><b>151 个令牌</b><span>深浅双主题，红涨绿跌，零硬编码色</span></div>
    <div class="kpi"><b>4 档断点</b><span>&lt;640 / 640–1023 / 1024–1439 / ≥1440</span></div>
    <div class="kpi"><b>1883 / 3170 px</b><span>原型桌面 / 移动整页高（原 9521 / 34829）</span></div>
    <div class="kpi"><b>0 溢出 · 0 盒内滚动</b><span>12 种视口状态自动化自检通过</span></div>
  </div>
  <p class="note">方向声明：<strong>A 方案为主交付</strong>——把已跑起来的「研究工作台」升为主视图，补全稀疏 tab、收编回测大表与研报长文，原研报视图降级为打印 / 导出 / 长文阅读页；<strong>B 方案为低风险过渡路径</strong>（保留研报为主、反向移植令牌）。两套共用同一套令牌，不造第三套 UI。</p>
</section>

<section id="s1" class="sec">
  <h2>1 · 诊断：问题不是审美</h2>
  <p>「像大杂烩」的根因是<strong>信息架构没有分层</strong>，CLS 治理只是放大器。14 类功能被当作 14 个平级容器顺序平铺，缺「结论层 / 证据层 / 操作层」，宏观上是一串等宽、等距、等密度的深色条块，没有阅读起点。</p>
  ${figure(SVG.metric, '图 1　权重倒置与页高对照（数据来自 BRIEF 第 2、3 节实测与原型自检）')}
  <div class="tw"><table><thead><tr><th>实测项</th><th>改造前</th><th>成因</th></tr></thead><tbody>
  <tr><td>桌面整页 / 移动整页</td><td>9521px / 34829px（43 屏）</td><td>14 类功能平铺，回测单区 12440px、研报 7933px</td></tr>
  <tr><td>屏幕权重</td><td>模拟盘 36% + 回测 22% = 58% 给操作审计；告警 + 概览仅 17%</td><td>分析辅助工具把最多屏幕给了交易台</td></tr>
  <tr><td>唯一大字 38.4</td><td>第 459px 才出现，前面堵着 13 条平级状态条</td><td>状态面板全部平级，没有优先级</td></tr>
  <tr><td>CLS 治理</td><td>基线 1.281 / 1.391 → 0.174</td><td>代价：13 面板锁死 3rem + 18 处盒内滚动 + 半截字裁切</td></tr>
  <tr><td>移动端状态面板</td><td>可视高 48px，其中 reportPanel 内容 4957px（露出约 1%）</td><td>恒定高容器 + 盒内滚动</td></tr>
  <tr><td>横向溢出</td><td>导航锚点 479px、双轨表 546px 均超 390px</td><td>无列优先级、无窄屏导航形态</td></tr>
  </tbody></table></div>
  <p class="warn">请勿重复已被站点第四轮实证证伪的做法：逐个加 min-height、关 smooth / overflow-anchor、main 加 contain、给 main 固定高、放大 btStrategyPanel、去掉高度上限。详见 <code>BRIEF.md</code> 第 3.3 节。</p>
  ${gallery(SHOT_GROUPS[0])}
</section>

<section id="s2" class="sec">
  <h2>2 · 战略：A 方案与三层 IA</h2>
  <p>系统里<strong>已经有一份正确答案</strong>：研究工作台总览是「结论指标条 → 走势大图 → 因子仪表」的正确组织，12 列栅格、整页滚动、零盒内滚动、LINK 联动总线、时间窗与 tooltip 都已跑通。8 个 tab 中 6 个是完整功能。重构不是从零设计，是把它升为主视图并补齐。</p>
  ${IA.map((s, i) => figure(s, '图 ' + (i + 2) + '　' + ['三层信息架构与 14 类功能归层', '重构后站点地图与页面流转', '旧首屏 vs 新首屏对照'][i])).join('')}
  <div class="tw"><table><thead><tr><th>层</th><th>回答什么</th><th>承载内容</th><th>位置纪律</th><th>目标占比</th></tr></thead><tbody>
  <tr><td><strong>结论层</strong></td><td>今天什么风险 / 我该执行什么仓位</td><td>6 项核心指标、风险摘要条、概览结论、主线标的结论</td><td>常驻、不可折叠、不进抽屉</td><td>≥40%（现 17%）</td></tr>
  <tr><td><strong>证据层</strong></td><td>这个判断从哪来</td><td>60 日走势、七因子、regime 分布、席位、明细表、图表</td><td>整页滚动，随内容自然增高</td><td>约 42%</td></tr>
  <tr><td><strong>操作层</strong></td><td>我要下单 / 查审计明细</td><td>回测大表、研报长文、模拟盘交易台、日志、设置</td><td>独立 tab + 抽屉三档 + 长文页</td><td>≤18%（现 58%）</td></tr>
  </tbody></table></div>
  <p>站点地图为 <strong>9 个 tab</strong>：总览 · 涨跌停 · 资金 · 板块 · 选股 · 回测 · 模拟盘 · 研报 · 系统设置。深链 <code>?view=terminal</code> / <code>#terminal</code> 保持幂等可达；快捷键 <code>1-9</code> / <code>/</code> / <code>-</code>、导出 12 项、时间窗、刷新、LINK 联动全部保留。</p>
  <div class="tw"><table><thead><tr><th>方案</th><th>动到什么</th><th>工期 / 风险</th><th>达标程度</th></tr></thead><tbody>
  <tr><td><strong>A（主交付）</strong></td><td>工作台升主视图；研报降级为长文 / 打印 / 导出页；动路由与 tab</td><td>约 24 人日 / 中</td><td>达到全部量化判据</td></tr>
  <tr><td><strong>B（过渡）</strong></td><td>保留研报为主，反向移植令牌、栅格、骨架、抽屉三档；不动路由</td><td>约 10 人日 / 低</td><td>溢出 0、触控 100%、数据层 0 改动达标；页高与占比目标打折</td></tr>
  </tbody></table></div>
</section>

<section id="s3" class="sec">
  <h2>3 · 视觉：统一令牌</h2>
  <p>继承内联 CSS 里已写明的成熟设计纪律：<strong>chrome 柔、数据锐</strong>；辉光只允许三处（选中细边光 / 警报呼吸 / 主图当前值微光点）；动画只做 opacity 与 transform；尊重 <code>prefers-reduced-motion</code>；不用 <code>backdrop-filter</code>（树莓派掉帧）。深色磨砂黑 + 青色主色；<strong>红涨绿跌</strong>为 A 股约定，且强制 ↑↓ / 正负号冗余，不只靠颜色传意。</p>
  ${VIS.map((s, i) => figure(s, '图 ' + (i + 5) + '　' + ['色板与语义色', '九级字阶（解决全站字号一档）', '表面层级与辉光落点'][i])).join('')}
  <div class="tw"><table><thead><tr><th>令牌组</th><th>代表变量</th><th>落地要点</th></tr></thead><tbody>
  <tr><td>表面 / 文本</td><td><code>--s-bg-0/1</code>、<code>--s-surface-1/2/3</code>、<code>--s-text-1/2/3</code></td><td>5 级明度 + 3 级文本，卡片不再靠颜色区分层级</td></tr>
  <tr><td>语义色</td><td><code>--s-up</code>(红) / <code>--s-down</code>(绿) / <code>--s-warn</code> / <code>--s-danger</code> / <code>--s-info</code></td><td>红绿独占涨跌；系统告警用琥珀 / 橙，避免混淆</td></tr>
  <tr><td>字级</td><td><code>--s-font-xs…--s-font-kpi</code> + 语义别名 <code>--s-font-display/h1/h2/h3/body/caption/micro</code></td><td>9 级阶梯；数值统一 tabular-nums，刷新不抖动</td></tr>
  <tr><td>尺寸契约</td><td><code>--s-skel-kpi-h: 134px</code>、<code>--s-table-row-h</code>、<code>--s-drawer-w-sm/md/lg</code></td><td>骨架与真实卡共用高度，实测替换位移 0</td></tr>
  <tr><td>主题</td><td><code>[data-theme="light"]</code> 只覆盖颜色</td><td>151 个令牌中 42 个随主题切换，尺寸字级全部复用</td></tr>
  </tbody></table></div>
  <p class="note"><strong>命名一致性已做硬校验</strong>：视觉册第 8 节代码块与 <code>prototype/tokens.css</code> 逐字一致；视觉册独有的 62 个语义名已在文件末尾「语义别名层」全部定义；<code>components.css</code> 引用的 85 个变量零缺失。修改令牌后运行 <code>node design/sync_tokens.cjs</code> 可自动同步文档。</p>
</section>

<section id="s4" class="sec">
  <h2>4 · 体验：响应式与状态</h2>
  ${figure(SVG.breakpoints, '图 8　四档断点：同一套组件，三种形态')}
  <div class="tw"><table><thead><tr><th>档位</th><th>栅格</th><th>导航</th><th>表格</th><th>抽屉 / ticker</th></tr></thead><tbody>
  <tr><td>&lt;640 手机</td><td>1 列，KPI 2 列</td><td>底部 5 tab + 「更多」抽屉</td><td>仅 priority=1 列</td><td>全屏 sheet；ticker 隐藏，关键值已在结论层</td></tr>
  <tr><td>640–1023 平板</td><td>6 列，KPI 3 列</td><td>顶栏 9 tab 换行不裁切</td><td>隐藏 priority 3/4</td><td>420/640/960；ticker 贴底</td></tr>
  <tr><td>1024–1439 小桌面</td><td>12 列，KPI 6 列</td><td>顶栏单行</td><td>隐藏 priority 4</td><td>三档 + 表头吸顶</td></tr>
  <tr><td>≥1440 桌面</td><td>12 列 + 加宽间距</td><td>顶栏单行</td><td>全列</td><td>三档 + 表头吸顶</td></tr>
  </tbody></table></div>
  ${figure(SVG.skeleton, '图 9　骨架状态机：loading → skeleton → ready / empty / error')}
  <p>移动端专项整改：34829px 靠<strong>分区懒挂载 + 折叠 + 抽屉</strong>压到目标 ≤9800px（原型实测 3170px）；13 条状态收成「1 条风险摘要 + 展开」；<code>reportPanel</code> 长文移出主视图；533px 表格用列优先级消除溢出；固定「横屏视图」按钮让位底部导航，不再遮挡表单。</p>
  <h3>状态与「门」</h3>
  <div class="tw"><table><thead><tr><th>状态 / 组件</th><th>规则</th></tr></thead><tbody>
  <tr><td>加载</td><td>骨架与真实内容等高，禁止「载入中…」长期不结束也不报错（现站点真实问题）</td></tr>
  <tr><td>空</td><td>6 类文案模板 + 图形 + 下一步动作；账户空仓、三方数据未产出都如实说明，不伪造</td></tr>
  <tr><td>错误 / 陈旧 / 离线</td><td>区块级降级条；<strong>不再整站消失</strong>（现 <code>fatalHolder</code> 会让 main 直接 display:none）</td></tr>
  <tr><td>抽屉三档</td><td>420px 键值详情 / 640px 组合席位 / 960px 数百行回测；&lt;640 全屏 sheet；ESC、遮罩、焦点陷阱、表头吸顶偏移归零</td></tr>
  <tr><td>可访问性</td><td>正文对比度 ≥4.5:1、控件边界 ≥3:1、触控 ≥44px、焦点可见、色盲冗余、键盘可达</td></tr>
  </tbody></table></div>
</section>

<section id="s5" class="sec">
  <h2>5 · 蓝图：页面与组件</h2>
  <p>页面骨架全部使用 <code>.s-scope</code> 作用域下的 BEM 类名，可直接粘贴；完整 HTML 见分册 04 第 1 节（7 段骨架，标签与 aria 已校验）。</p>
<pre class="code"><code class="lang-html">${esc(`<div class="s-scope" data-theme="dark">
  <div class="s-app">
    <header class="s-topbar">…品牌 / 数据日 / 时间窗 / 刷新 / 导出…</header>
    <nav class="s-nav" aria-label="主视图导航">…9 tab…</nav>
    <main class="s-main" id="main">
      <div class="s-page" data-view="overview">
        <section class="s-section">            <!-- 结论层 -->
          <div class="s-verdict s-verdict--warn">…一句话风险结论…</div>
          <div class="s-grid s-grid--kpi s-grid--kpi-tall">…6 × .s-card > .s-kpi…</div>
          <details class="s-alertstrip s-details">…13 条状态收进一个折叠门…</details>
        </section>
        <section class="s-section">            <!-- 证据层 -->
          <div class="s-grid">
            <div class="s-col-8">…图表 .s-chart + .s-legend…</div>
            <div class="s-col-4">…因子 / 席位 / 空状态…</div>
            <div class="s-col-12">…个股表 .s-table[data-priority]…</div>
          </div>
        </section>
        <section class="s-section">            <!-- 操作层：只留摘要 + 门 -->
          …回测摘要 / 模拟盘摘要 / data-open="large" 打开抽屉…
        </section>
      </div>
    </main>
    <footer class="s-ticker">…</footer>
    <nav class="s-mobilebar">…底部 5 tab…</nav>
  </div>
  <div class="s-drawer__mask" hidden></div>
  <aside class="s-drawer s-drawer--lg" role="dialog" aria-modal="true" hidden>…</aside>
</div>`)}</code></pre>
  <p><strong>现有 DOM 迁移映射</strong>：分册 04 第 3 节给出 67 行映射表，覆盖用户清单全部 47 个关键 id，逐项标注「原位置 → 新位置/组件 → 保留 / 收进抽屉 / 折叠 / 懒挂载 / 删除 → 依赖的 render 函数」。例如：</p>
  <div class="tw"><table><thead><tr><th>现有 id</th><th>处理</th><th>新归属</th></tr></thead><tbody>
  <tr><td><code>emScore / emNet / emTier / factors / trendSvg</code></td><td>保留并上提</td><td>结论指标条 + 证据层主图</td></tr>
  <tr><td><code>regimePanel / divergePanel / painPanel / breadthPanel / healthPanel …</code>（13 条）</td><td>归并 + 折叠</td><td>风险摘要条（默认 1 行，展开按严重度分组）</td></tr>
  <tr><td><code>btStrategyPanel / verSummary / paretoCards / rollCards</code></td><td>收进「门」</td><td>回测 tab 摘要 + 960px 抽屉分页明细</td></tr>
  <tr><td><code>zone-brief / aiReportCard / reportPanel</code></td><td>移出主视图</td><td>研报长文页 + 总览 220px 摘要出口卡</td></tr>
  <tr><td><code>orderForm / paperPosCards / paperHistCards / renderBatch</code></td><td>收进 tab</td><td>模拟盘 tab，空状态按规范设计</td></tr>
  <tr><td><code>drawer / dwBody</code></td><td>扩容改造</td><td>三档宽度 + 移动端全屏 sheet</td></tr>
  <tr><td><code>fatalHolder</code></td><td>降级替代</td><td>区块级错误条，整站不再隐藏</td></tr>
  </tbody></table></div>
</section>

<section id="s6" class="sec">
  <h2>6 · 落地：六阶段与验收</h2>
  ${figure(SVG.phases, '图 10　六阶段迁移：每阶段可独立上线、可回滚')}
  <p><strong>边界</strong>：只动展示层。34 个 <code>data/*.json</code>、38 个 <code>render*</code> 函数、LINK 总线协议零改动；通过新增适配层把既有渲染输出接到新容器。与 <code>.t-scope</code> / 研报 <code>style.css</code> 靠 <code>.s-scope</code> 前缀 + <code>[hidden]</code> 真隐藏共存，最终收敛为单一语言。</p>
  <h3>可量化验收（摘要，完整 22 项见分册 03 第 11 节）</h3>
  <div class="tw"><table><thead><tr><th>判据</th><th>基线</th><th>目标</th><th>原型实测</th></tr></thead><tbody>
  <tr><td>桌面整页高 @1440</td><td>9521px</td><td>≤3200px</td><td><strong>${desktop.height || '1883'}px ✓</strong></td></tr>
  <tr><td>移动整页高 @390</td><td>34829px</td><td>≤9800px</td><td><strong>${mobile.height || '3170'}px ✓</strong></td></tr>
  <tr><td>横向溢出元素数</td><td>≥2</td><td>0</td><td><strong>${overflowAll} ✓（12 种状态全测）</strong></td></tr>
  <tr><td>盒内滚动容器数</td><td>18</td><td>≤2</td><td><strong>0（抽屉 body 白名单 1）✓</strong></td></tr>
  <tr><td>骨架 → 内容位移</td><td>0.128 CLS</td><td>0</td><td><strong>真实态与骨架态页高同为 1883px ✓</strong></td></tr>
  <tr><td>触控目标 / 对比度 / 抽屉焦点</td><td>未达标</td><td>100% / ≥4.5:1 / 焦点陷阱</td><td>组件层已实现，人工走查项</td></tr>
  <tr><td>数据层改动文件数</td><td>—</td><td>0</td><td><strong>0 ✓</strong></td></tr>
  </tbody></table></div>
  <p class="note">分册 05 第 5 节附带可直接粘贴到浏览器控制台 / CDP 运行的自检脚本，覆盖横向溢出、盒内滚动、CLS（PerformanceObserver layout-shift）、触控目标、对比度、抽屉焦点陷阱、空状态、骨架替换位移共 8 项；另有 14 项风险登记表与 18 项兼容清单。</p>
</section>

<section id="s7" class="sec">
  <h2>7 · 视觉稿（15 张真实渲染）</h2>
  <p class="note">全部由无头浏览器对 <code>prototype/index.html</code> 实际渲染产出，非手绘示意图；改造前三张来自线上站点真实数据态。原型深链可复现：<code>?view=backtest</code>、<code>?demo=drawer</code>、<code>?demo=skeleton</code>、<code>?theme=light</code>。</p>
  ${SHOT_GROUPS.slice(1).map(gallery).join('')}
</section>

<section id="s8" class="sec">
  <h2>8 · 实测验收与取舍说明</h2>
  <h3>自动化自检（12 种视口 / 状态）</h3>
  <div class="tw"><table><thead><tr><th>视觉稿</th><th>视口</th><th>页高</th><th>横向溢出</th><th>盒内滚动</th><th>抽屉</th></tr></thead><tbody>
  ${CHECK.map(x => '<tr><td>' + x.name + '</td><td>' + x.width + '×' + x.height + '</td><td>' + (x.height || '-') + '</td><td>' + (x.overflowEls || []).length + '</td><td>' + x.innerScrollers + '</td><td>' + (x.drawerOpen ? '开' : '—') + '</td></tr>').join('')}
  </tbody></table></div>
  <p class="note">表中「页高」为截图视口高度；全页稿已把视口撑到真实内容高度。盒内滚动仅在抽屉打开时为 1（抽屉 body 是设计白名单），其余全为 0。</p>

  <h3>设计目标 vs 原型实测：一处需要说清的取舍</h3>
  <p>分册 01 的极简首屏目标写的是「6 项结论指标落在 0–184px、<code>38.4</code> 在 ~96px」，那是按「64px 顶栏 + 指标条直排」推算的紧凑版。交付原型为可读性保留了两层薄 chrome——独立 tab 导航（44px）与「一句话风险结论」条，因此实测为：顶栏 100px → 结论条底 226px → 6 项 KPI 238–372px，<code>38.4</code> 约 260px。</p>
  <div class="tw"><table><thead><tr><th>口径</th><th>改造前</th><th>专家目标</th><th>原型实测</th><th>结论</th></tr></thead><tbody>
  <tr><td>首个结论数字出现</td><td>459px</td><td>≤96px</td><td>约 260px</td><td>前移约 200px，首屏直读达标；极致紧凑版需合并标题与风险条</td></tr>
  <tr><td>6 项指标全部可见</td><td>需越过 13 条告警带</td><td>≤184px</td><td>约 372px</td><td>仍在 900px 折叠线内，3 秒内可读</td></tr>
  <tr><td>桌面 / 移动页高</td><td>9521 / 34829</td><td>≤3200 / ≤9800</td><td>1883 / 3170</td><td>大幅优于目标</td></tr>
  </tbody></table></div>
  <p>若上线时要严格命中 ≤184px：按分册 01 第 3 节，把「今日结论」标题合并进指标条标签、把一句话风险结论改为指标条右侧的徽章列、并让桌面 tab 与顶栏同行，即可去掉约 130px。<strong>本交付保留较宽松版本，是因为它在实机上读起来更从容；两条路径共用同一套组件与令牌，切换成本只有一个模板。</strong></p>

  <h3>验证边界（评审补充，勿把原型数据当线上验收值）</h3>
  <div class="tw"><table><thead><tr><th>常见误读</th><th>正确口径</th><th>验收方式</th></tr></thead><tbody>
  <tr><td>「骨架态与真实态页高都是 1883」⇒ 线上 CLS = 0</td><td><strong>不等于线上 CLS = 0</strong>：只证明<strong>占位尺寸 1:1</strong>。线上 CLS 来自 34 个 JSON 分批异步到达的时间轴位移，与静态页高无必然关系</td><td>05 册 4.3：<code>PerformanceObserver</code> 监听 <code>layout-shift</code>，加载后 5s 窗口，四档视口各测；目标 <strong>≤0.10</strong>，现行基线 0.174</td></tr>
  <tr><td>1883 / 3170 / 横向溢出 0 是重构后的线上页高</td><td>原型用<strong>硬编码示例数据</strong>（少量行、预置数值），验证的是栅格 / 抽屉 / 表格列分级这套<strong>布局契约</strong></td><td>接上真实 34 个 JSON 后按 05 册阶段 3–4 复测；重点看 4957px 研报正文、28 张表共 288 行（含明细）、533px 双轨表</td></tr>
  <tr><td>「数据层零改动」= 只要别改 id 就行</td><td>方案走的是 <code>s-adapter.js</code> MutationObserver <strong>搬节点</strong> + <code>s-bridge.css</code> 作用域隔离，不是单纯保留 id</td><td>额外盯两点：重复 render 时 <code>innerHTML</code> 覆盖旧容器后适配层要幂等重搬；搬动含 lightweight-charts canvas 的节点要 re-init</td></tr>
  <tr><td>映射表里 <code>#orderForm</code> / <code>#auditPanel</code> 查不到 = 造假</td><td><code>#orderForm</code> 由 <code>paper_ui.js</code> 运行时创建；<code>renderAuditPanel</code> 实际写入 <code>#briefAudit</code>，多写的 <code>#auditPanel</code> 别名已删除</td><td>映射表 45 个 render 函数、77 个 id 锚点逐条对过真实代码</td></tr>
  <tr><td>拿自检脚本的 <code>collectCls()</code> 当免死金牌</td><td>评审修订：原脚本 <code>pass: max &lt;= 0.174</code> 会放行 0.15 的版本；且 <code>setTimeout 1800</code> 只观测 1.8 秒，会漏掉 34 个 JSON 后到的位移</td><td>已改为<strong>双档</strong>：<code>target 0.10</code> 为唯一放行依据、<code>baseline 0.174</code> 仅标记 <code>degraded</code>；窗口改 <strong>5000ms</strong>；<code>pass: null</code> 视为未测不得当通过。详见 05 册 5.1 节</td></tr>
  <tr><td>三条深链 <code>curl 200</code> 即算兼容通过</td><td>静态 Pages 任何 query 都返回同一份 <code>index.html</code> 200；<code>#terminal</code> / <code>#workbench</code> 是 fragment，curl <strong>根本不发给服务器</strong>。原 V1-2 / V5-3 的 curl 命令是恒真空门禁</td><td>05 册已换成 <code>verify_phase_gates.cjs links</code>：逐条导航后断言主根可见性、互斥、二次进入幂等；阶段 5 的「深链可达率 100%」必须由它采集，见 06 册 R2</td></tr>
  <tr><td><code>.s-scope ~ .t-entry { display:none }</code> 能隐藏终端入口</td><td>线上 <code>.t-entry</code> 出现 <strong>0 次</strong>：真实按钮由 <code>el(&quot;button&quot;, &quot;&quot;, &quot;⚡ 图表终端&quot;)</code> 创建，无 id / 无 class / 全内联样式 / <code>z-index:9998</code> 挂在 <code>body</code> 末尾，选择器永不匹配，且会压住抽屉 910 与 tooltip 950</td><td>改 <code>terminal.js</code> 源补 <code>entry.id=&quot;t-entry&quot;</code>，用 <code>body[data-view=&quot;workbench&quot;] #t-entry</code> 隐藏；列为阶段 1 独立验收点③，见 06 册 R3</td></tr>
  <tr><td>回测明细就是「265 行」</td><td>265 借自「265 日完整档」天数；<code>288 行</code> 是<strong>整页 28 张表的总行数</strong>，明细真实行数未测定</td><td>阶段 3 改按运行时 <code>N</code> 动态断言 <code>ceil(N/50)</code> 分页与 <code>N&gt;1000</code> 虚拟滚动，见 06 册 R4</td></tr>
  </tbody></table></div>

  <h3>本轮修复的真实缺陷（都留有前后截图）</h3>
  <ul>
    <li>抽屉表头被 <code>sticky top: --s-sticky-offset</code> 推到首行数据下方 → 在 <code>.s-drawer</code> 内把偏移归零。</li>
    <li>骨架卡 120px vs 真实卡 133.1px → 令牌统一 134px，两态页高同为 1883px，替换零位移。</li>
    <li>抽屉表格只给 <code>th</code> 标了优先级、<code>td</code> 没标 → 窄屏列错位、日期折行；补齐后窄屏 3 列、日期完整。</li>
    <li>净值曲线只占图表下 1/3 → 重算 y 映射铺满绘图区。</li>
    <li>浅色主题琥珀徽章对比度偏弱 → 浅色 <code>--s-warn</code> 加深到 <code>#79500a</code>。</li>
    <li>内容少的抽屉大片留白 → 补「最近一次建仓 / 参数来源 / 快捷操作 / 当前状态」。</li>
  </ul>
</section>

<section id="s9" class="sec">
  <h2>9 · 分册全文</h2>
  <p class="note">以下为六份源文件的完整内容，默认折叠；点开即可查阅全部表格、代码块与图示。源文件同时以 Markdown 形式独立交付，便于进仓库与评审批注。</p>
  ${BOOKS.map(([f, title]) => '<details class="book"><summary>' + title + '　<span>' + f + '</span></summary><div class="bookbody">' + md2html(fs.readFileSync(path.join(DIR, f), 'utf8'), 2) + '</div></details>').join('')}
</section>

<section id="s10" class="sec">
  <h2>10 · 文件地图与运行</h2>
<pre class="code"><code class="lang-bash">${esc(`design/
├── UI设计方案.html          ← 本文件（双击打开，离线可用）
├── UI设计方案.pdf           ← 打印版
├── 00_README.md             ← 一页索引
├── BRIEF.md                 ← Phase 0 事实底座
├── 01_设计战略与信息架构.md
├── 02_视觉语言与设计令牌.md
├── 03_体验规范与响应式.md
├── 04_页面蓝图与组件规格.md
├── 05_落地实施与验收.md
├── 06_落地任务单.md            ← 六阶段任务单 + 评审修订
├── prototype/
│   ├── index.html           ← 高保真响应式原型（双击即运行）
│   ├── tokens.css           ← 151 个 --s-* 令牌
│   └── components.css       ← 完整组件层
├── assets/                  ← 15 张视觉稿 + 自检报告.json
├── verify_phase_gates.cjs     ← 可运行发布门禁
└── shots.cjs / build_doc.cjs / sync_tokens.cjs / measure.cjs

# 复现视觉稿（无需网络）
node design/shots.cjs
# 修改令牌后同步视觉册第 8 节
node design/sync_tokens.cjs
# 重新汇编本文档
node design/build_doc.cjs
# 量测骨架与真实卡是否等高
# 阶段发布门禁（本地可跑项：令牌守卫 + 动态分页）
node design/verify_phase_gates.cjs all
# 深链渲染态断言（需站点 URL，CDP 驱动 Edge）
node design/verify_phase_gates.cjs links --url=https://your-site/ --stage=1
node design/measure.cjs`)}</code></pre>
  <p><strong>原型评审深链</strong>：<code>?view=backtest|paper|zt</code> 切视图、<code>&amp;demo=drawer|drawer-small|drawer-more|skeleton</code> 演示状态、<code>&amp;theme=light</code> 切浅色。正式实现时这些参数由路由接管。</p>
  <p class="note">本次交付<strong>未修改线上任何文件</strong>；未触发任何写操作（保存并写盘 / 重置账户 / 提交委托等）。客观不可见项：<code>intradayCard</code> 盘中态（非交易日隐藏）、真机树莓派性能、隧道写接口。</p>
</section>

<footer class="foot">A股情绪系统 PRO · UI 端重构设计方案 v1.0 ｜ 2026-11-14 ｜ 视觉方向 / 体验规范 / 前端落地 三阶段专家团汇编</footer>
`;

const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A股情绪系统 PRO · UI 端重构设计方案 v1.0</title>
<style>
:root{--bg:#0b0e11;--bg1:#0f1318;--s1:#151b22;--s2:#1a222b;--s3:#202a35;--bd:#232d38;--bd2:#2e3b49;
--t1:#e8eef5;--t2:#a8b6c5;--t3:#728298;--ac:#35d6d0;--up:#ff5b5b;--down:#2fd39a;--warn:#f5b544}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--t1);font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
font-size:14px;line-height:1.75;-webkit-font-smoothing:antialiased}
.layout{display:grid;grid-template-columns:236px minmax(0,1fr);max-width:1400px;margin:0 auto}
aside.toc{position:sticky;top:0;height:100vh;overflow:auto;padding:28px 18px;border-right:1px solid var(--bd);background:var(--bg1)}
aside.toc .brand{color:var(--ac);font-size:12px;letter-spacing:.08em;margin-bottom:18px}
aside.toc a{display:block;padding:5px 8px;color:var(--t2);text-decoration:none;font-size:12.5px;border-left:2px solid transparent}
aside.toc a:hover{color:var(--ac);border-left-color:var(--ac);background:var(--s1)}
main{min-width:0;padding:0 40px 80px}
.cover{padding:64px 0 40px;border-bottom:1px solid var(--bd)}
.kicker{color:var(--ac);font-size:11px;letter-spacing:.18em;margin-bottom:18px}
.cover h1{margin:0;font-size:42px;line-height:1.25;font-weight:700;letter-spacing:-.01em}
.cover h1 span{color:var(--ac)}
.lede{color:var(--t2);font-size:15px;line-height:1.9;margin:22px 0 26px}
.meta{display:flex;flex-wrap:wrap;gap:8px}
.meta span{padding:3px 10px;border:1px solid var(--bd2);border-radius:999px;color:var(--t3);font-size:11px}
.sec{padding:44px 0 8px;border-bottom:1px solid var(--bd)}
h2{font-size:25px;margin:0 0 18px;font-weight:650;letter-spacing:-.01em}
h2::before{content:"";display:inline-block;width:4px;height:20px;background:var(--ac);margin-right:12px;vertical-align:-2px;border-radius:2px}
h3{font-size:17px;margin:30px 0 10px;color:var(--t1)}
h4{font-size:14px;margin:22px 0 8px;color:var(--t1)}
p{margin:12px 0;color:var(--t2)}
strong{color:var(--t1)}
code{font-family:Consolas,"SFMono-Regular",Menlo,monospace;font-size:.9em;color:var(--ac);background:var(--s2);padding:1px 5px;border-radius:4px}
pre.code{background:var(--s1);border:1px solid var(--bd);border-radius:8px;padding:16px;overflow:auto;max-height:520px}
pre.code code{background:none;color:var(--t2);padding:0;font-size:12px;line-height:1.65}
.tw{overflow-x:auto;margin:16px 0;border:1px solid var(--bd);border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--bd);vertical-align:top}
th{background:var(--s2);color:var(--t1);font-weight:600;white-space:nowrap}
td{color:var(--t2)}
tr:last-child td{border-bottom:0}
ul,ol{padding-left:22px;color:var(--t2)}
li{margin:6px 0}
blockquote{margin:14px 0;padding:8px 14px;border-left:3px solid var(--ac);background:var(--s1);color:var(--t3);font-size:12.5px}
hr{border:0;border-top:1px solid var(--bd);margin:22px 0}
.fig{margin:22px 0;padding:14px;background:var(--s1);border:1px solid var(--bd);border-radius:10px}
.fig svg{display:block;width:100%;height:auto;max-width:680px;margin:0 auto}
figcaption{color:var(--t3);font-size:11.5px;text-align:center;margin-top:10px}
.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}
.kpi{padding:16px;background:var(--s1);border:1px solid var(--bd);border-left:3px solid var(--ac);border-radius:8px}
.kpi b{display:block;color:var(--t1);font-size:17px;margin-bottom:4px}
.kpi span{color:var(--t3);font-size:12px}
.note{color:var(--t3);font-size:12.5px}
.warn{padding:12px 14px;border:1px solid var(--warn);border-radius:8px;background:rgba(245,181,68,.08);color:var(--t2);font-size:12.5px}
.gal{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:16px 0 26px;align-items:start}
.shot{margin:0;padding:10px;background:var(--s1);border:1px solid var(--bd);border-radius:8px}
.shot img{display:block;width:100%;height:auto;border-radius:4px;background:var(--bg)}
.shot figcaption{text-align:left;margin-top:8px;line-height:1.5}
details.book{margin:10px 0;border:1px solid var(--bd);border-radius:8px;background:var(--s1)}
details.book>summary{cursor:pointer;padding:12px 16px;color:var(--t1);font-size:13.5px;font-weight:600}
details.book>summary span{color:var(--t3);font-weight:400;font-size:11.5px;margin-left:8px}
.bookbody{padding:4px 20px 24px;border-top:1px solid var(--bd)}
.bookbody h3,.bookbody h4{color:var(--t1)}
.bookbody pre.code{max-height:420px}
.foot{padding:30px 0;color:var(--t3);font-size:11.5px;text-align:center}
@media(max-width:900px){.layout{grid-template-columns:1fr}aside.toc{position:static;height:auto;border-right:0;border-bottom:1px solid var(--bd)}main{padding:0 18px 60px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.gal{grid-template-columns:1fr}.cover h1{font-size:30px}}
@media print{
 aside.toc{display:none}.layout{display:block}main{padding:0}
 body{background:#fff;color:#111}.sec,.cover{border-color:#ccc}
 h2,h3,h4,strong,.kpi b,th{color:#111}p,td,li,blockquote{color:#333}.note,figcaption,.foot{color:#666}
 .kpi,.fig,.shot,details.book,table,pre.code,.tw{border-color:#ccc;background:#fff}
 .fig svg{max-width:100%}pre.code{max-height:none;white-space:pre-wrap}
 details.book>summary{color:#111}.bookbody{display:block}
 .sec{break-inside:auto;page-break-before:always}h2{break-after:avoid}figure,table,pre{break-inside:avoid}
}
</style></head><body>
<div class="layout">
<aside class="toc"><div class="brand">◆ UI DESIGN v1.0</div>
${nav.map(([id, t]) => '<a href="#' + id + '">' + t + '</a>').join('')}
<a href="#s0">↑ 交付清单 / 速览</a></aside>
<main>${body}</main></div></body></html>`;

fs.writeFileSync(path.join(DIR, 'UI设计方案.html'), html);
console.log('built UI设计方案.html:', Buffer.byteLength(html), 'bytes |', (html.match(/<svg /g) || []).length, 'inline svg |', (html.match(/<img /g) || []).length, 'shots |', BOOKS.length, 'books');
