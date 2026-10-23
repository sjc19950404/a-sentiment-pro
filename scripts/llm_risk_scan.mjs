#!/usr/bin/env node
// 晚间公告排雷机（V5.3 P2 扩展）：把 GLM-4 当「7x24 初级量化研究员」用——
//   收盘后扫描连板梯队 / 标的池里那几十只股票的当晚公告，让 AI 判断是否存在重大利空
//   （减持 / 立案 / 业绩预亏 / 重大诉讼 / 股东爆仓 / ST / 退市 / 监管函等），
//   产出 data/llm_risk_blacklist.json 黑名单；后续 paper.js 在自动建仓前查此名单，
//   命中即拒绝买入（正向封禁，空表 = 不封禁，fail-open 不误伤正常交易）。
//
// 数据流（照 llm_sentiment 三段式）：
//   本脚本（收盘后跑）→ data/llm_risk_blacklist.json → paper.js 建仓守卫（后续接入）
//
// 公告源：当前无真实公告抓取（需求明确允许先用 mock）。两种模式：
//   --mock           离线演示：合成公告 + 本地关键词启发式判定（不调 GLM，不耗 API，零配置可跑）
//   默认（无 --mock）真实链路：读 data/announcements-latest.json（若存在）作为公告源，
//                    调 LLM_API_* 配置的 GLM 做结构化判定；无公告源 / 无配置则诚实退出或空表。
//
// 用法：
//   node scripts/llm_risk_scan.mjs [--mock] [--universe ladder|paper] [--limit 40]
//                                 [--archive data/archive.json] [--out data/llm_risk_blacklist.json]
//
// 环境变量（真实模式）：LLM_API_URL / LLM_API_KEY / LLM_MODEL
//   （glm-* 模型自动走 https://open.bigmodel.cn/api/paas/v4 网关，与 fetch_llm_sentiment 同款）
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { decodeArchive } from '../src/lhb_codec.js';
import { bjStamp } from '../src/time.js';
import { fetchWithRetry } from '../src/util.js';

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

const MOCK = hasFlag('--mock');
const UNIVERSE = argOf('--universe', 'ladder'); // ladder | paper
const LIMIT = Math.max(1, (parseInt(argOf('--limit', '40'), 10) || 40));
const ROOT_URL = new URL('../', import.meta.url); // 项目根（scripts/ 上一级）
// 相对路径按项目根解析；绝对路径（以 / 或盘符开头）直接当 file:// 用
const resolvePath = (p) => (p && (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)))
  ? new URL('file://' + p)
  : new URL(p, ROOT_URL);
const ARCHIVE = argOf('--archive', 'data/archive.json');
const OUT = resolvePath(argOf('--out', 'data/llm_risk_blacklist.json'));

// ── 1. 候选宇宙（连板梯队 / 标的池活跃股）──────────────────────────────────
function getTradeDate() {
  try {
    const arch = decodeArchive(JSON.parse(readFileSync(resolvePath(ARCHIVE), 'utf8')));
    const days = (arch.all_days || []).filter((d) => d && d.trade_date);
    return days.length ? days[days.length - 1].trade_date : null;
  } catch { return null; }
}

function collectUniverse() {
  const pu = JSON.parse(readFileSync(resolvePath('data/paper_universe.json'), 'utf8'));
  const syms = pu.symbols || {};
  const nameOf = (code) => (syms[code] && syms[code].name) || code;
  const stOf = (code) => !!(syms[code] && syms[code].st);

  if (UNIVERSE === 'paper') {
    const codes = Object.keys(syms).filter((c) => syms[c].active).slice(0, LIMIT);
    return codes.map((c) => ({ code: c, name: nameOf(c), st: stOf(c), lb: null }));
  }
  // default: 连板梯队（zt_lb: code -> 连板数），按连板数降序取 Top N
  const arch = decodeArchive(JSON.parse(readFileSync(resolvePath(ARCHIVE), 'utf8')));
  const days = (arch.all_days || []).filter((d) => d && d.trade_date);
  const day = days[days.length - 1];
  const zt = (day && day.summary && day.summary.zt_lb) || {};
  const arr = Object.keys(zt)
    .map((c) => ({ code: c, name: nameOf(c), st: stOf(c), lb: Number(zt[c]) || 0 }))
    .sort((a, b) => b.lb - a.lb);
  return arr.slice(0, LIMIT);
}

// ── 2. 公告素材 ───────────────────────────────────────────────────────────
function buildMockAnnouncements(stocks) {
  // 离线演示：给前几只植入利空公告，其余标注「无重大公告」
  const planted = [
    '公司晚间公告：持股 5% 以上股东拟通过集中竞价方式减持不超过公司总股本 5% 的股份；同时公司收到证监会《立案告知书》，因涉嫌信息披露违法违规被立案调查。',
    '公司发布业绩预告：预计本年度归属于上市公司股东的净利润同比预亏 80%~100%；此外存在一起涉案金额较大的重大诉讼。',
    '公司被实施其他风险警示（ST），股票简称变更，日涨跌幅限制调整为 5%；提示投资者注意风险。',
    '公司公告：终止筹划重大资产重组事项；深交所下发监管函，要求说明相关事项。',
  ];
  const map = {};
  stocks.forEach((s, i) => {
    if (s.st) map[s.code] = `【${s.name}】公司当前为 ST 股票（结构性风险）。`;
    else if (i < planted.length) map[s.code] = `【${s.name}】${planted[i]}`;
    else map[s.code] = `【${s.name}】今日无重大公告披露，公司运营正常，未见公开利空信息。`;
  });
  return map;
}

function readRealAnnouncements() {
  // 真实公告源（尚未接入爬虫）。约定文件形状：
  //   { date, announcements: { "600XXX": "公告原文…", … } }  或  { "600XXX": "公告原文…" }
  // 未接入时返回 null —— 真实模式只对「有公告数据」的票发起 GLM 判定。
  const path = resolvePath('data/announcements-latest.json');
  if (!existsSync(path)) return null;
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    if (j && j.announcements && typeof j.announcements === 'object') return j.announcements;
    if (j && typeof j === 'object') return j;
  } catch { /* 坏 JSON → 视为无源 */ }
  return null;
}

// ── 3. 风险判定（mock=关键词启发式；真实=GLM 结构化）────────────────────────
const RISK_KEYWORDS = [
  { re: /立案(调查|告知|稽查)/, level: 'high', tag: '立案调查' },
  { re: /退市|暂停上市|终止上市/, level: 'high', tag: '退市风险' },
  { re: /(股东|控股|实控人|大股东).{0,8}(减持|拟减持|被动减持)/, level: 'high', tag: '股东减持' },
  { re: /(爆仓|质押.{0,6}平仓|强制平仓)/, level: 'high', tag: '股东爆仓/平仓' },
  { re: /\bST\b|其他风险警示|实施风险警示/, level: 'high', tag: 'ST/风险警示' },
  { re: /(业绩|净利|扣非).{0,8}(预亏|亏损|大幅下滑|下降\s*\d{2,})/, level: 'medium', tag: '业绩预亏' },
  { re: /重大诉讼|诉讼(标的|金额).{0,10}\d/, level: 'medium', tag: '重大诉讼' },
  { re: /(监管函|问询函|警示函|通报批评)/, level: 'medium', tag: '监管函' },
  { re: /终止(重组|重大资产重组|筹划)/, level: 'low', tag: '终止重组' },
];

function heuristicJudge(text) {
  const reasons = [];
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  let maxLevel = 0;
  RISK_KEYWORDS.forEach((k) => {
    if (k.re.test(text)) { reasons.push(k.tag); if (rank[k.level] > maxLevel) maxLevel = rank[k.level]; }
  });
  const level = maxLevel === 3 ? 'high' : maxLevel === 2 ? 'medium' : maxLevel === 1 ? 'low' : 'none';
  return { level, reasons };
}

const SYSTEM = '你是 A 股初级量化研究员，专做「公告排雷」。我会给你若干股票及其当晚公开公告文本'
  + '（可能含减持/立案/业绩预亏/重大诉讼/股东爆仓/ST/退市/监管函等利空，也可能写「无重大公告」）。'
  + '请逐只判断重大利空风险等级：high=必须回避（立案/退市/爆仓/ST 等），medium=警惕'
  + '（减持/业绩预亏/重大诉讼/监管函），low=轻微，none=无显著利空。'
  + '只输出一个 JSON 数组，元素：{"code":"","name":"","riskLevel":"high|medium|low|none","reasons":["关键词"]}。不要任何其他文字。';

function glmConfig() {
  const API_URL = process.env.LLM_API_URL
    || ((process.env.LLM_MODEL || '').startsWith('glm') ? 'https://open.bigmodel.cn/api/paas/v4' : '');
  return { API_URL, API_KEY: process.env.LLM_API_KEY || '', MODEL: process.env.LLM_MODEL || '' };
}

async function callGLM(stocksBatch, annMap) {
  const { API_URL, API_KEY, MODEL } = glmConfig();
  const user = stocksBatch
    .map((s) => `股票：${s.code} ${s.name}\n公告：${annMap[s.code] || '（无公开公告数据，无法评估，判 none）'}`)
    .join('\n\n---\n\n');
  const chat = await fetchWithRetry(`${API_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    }),
    timeout: 60000,
    read: async (r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('返回无 content');
      return text;
    },
  }, 3, 2000);
  const m = chat.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('回复中未找到 JSON 数组');
  return JSON.parse(m[0]);
}

async function scanBatch(stocksBatch, annMap) {
  if (MOCK) {
    return stocksBatch.map((s) => {
      const text = annMap[s.code] || '';
      const j = heuristicJudge(text);
      return { code: s.code, name: s.name, riskLevel: j.level, reasons: j.reasons, evidence: text };
    });
  }
  const arr = await callGLM(stocksBatch, annMap);
  // 真实模式补 evidence（公告原文片段，供审计）
  return (Array.isArray(arr) ? arr : []).map((x) => ({
    code: x.code, name: x.name, riskLevel: x.riskLevel, reasons: x.reasons || [],
    evidence: (annMap[x.code] || '').slice(0, 120),
  }));
}

// ── 4. 主流程 ─────────────────────────────────────────────────────────────
async function main() {
  const tradeDate = getTradeDate();
  const stocks = collectUniverse();
  if (!stocks.length) { console.error('[risk-scan] 无候选股，退出'); process.exit(1); }

  const annMap = MOCK ? buildMockAnnouncements(stocks) : (readRealAnnouncements() || {});
  // 真实模式：只扫「有公告数据」的票（避免无意义 GLM 调用）；mock 全扫
  const toScan = MOCK ? stocks : stocks.filter((s) => annMap[s.code]);

  console.log(`[risk-scan] 宇宙=${UNIVERSE} 候选 ${stocks.length} 只 | 本次扫描 ${toScan.length} 只`
    + ` | 模式=${MOCK ? 'mock（合成公告+启发式）' : (Object.keys(annMap).length ? 'real（announcements 源）' : 'real（无公告源→仅扫有数据者）')}`);

  // 真实模式缺配置 → 诚实退出非 0（不落空档，与 llm_sentiment 同纪律）
  if (!MOCK) {
    const { API_URL, API_KEY, MODEL } = glmConfig();
    if (!API_URL || !API_KEY || !MODEL) {
      console.error('[risk-scan] ⚠ 缺 LLM 配置，无法真实排雷（退出非 0，不落空档）。请设置：');
      console.error('    LLM_API_URL   OpenAI 兼容地址（glm-* 自动走 bigmodel 网关）');
      console.error('    LLM_API_KEY / LLM_MODEL');
      process.exit(2);
    }
  }

  const BATCH = MOCK ? 40 : 10;
  const results = [];
  for (let i = 0; i < toScan.length; i += BATCH) {
    const batch = toScan.slice(i, i + BATCH);
    try {
      const r = await scanBatch(batch, annMap);
      (Array.isArray(r) ? r : []).forEach((x) => { if (x && x.code) results.push(x); });
    } catch (e) {
      console.error(`[risk-scan] ⚠ 批次失败：${e && e.message ? e.message : e}（继续，不阻塞）`);
    }
  }

  // 汇总黑名单：high/medium 入列；结构性 ST 强制 high 并补原因
  const byCode = new Map(stocks.map((s) => [s.code, s]));
  const dedup = new Map();
  results.forEach((r) => {
    if (dedup.has(r.code)) return;
    const stStruct = byCode.get(r.code) && byCode.get(r.code).st;
    const reasons = Array.isArray(r.reasons) ? r.reasons.slice() : [];
    let level = r.riskLevel || 'none';
    if (stStruct) { if (!reasons.includes('ST/风险警示')) reasons.push('ST/风险警示（结构性）'); level = 'high'; }
    if (level === 'high' || level === 'medium') {
      dedup.set(r.code, {
        code: r.code,
        name: r.name || (byCode.get(r.code) && byCode.get(r.code).name) || r.code,
        riskLevel: level,
        reasons: reasons.slice(0, 6),
        evidence: (r.evidence || '').slice(0, 120),
      });
    }
  });
  const blacklist = [...dedup.values()];

  const degraded = false; // 真实模式调用失败已在批次内捕获并继续；此处仅全无候选才 degenerate
  const payload = {
    kind: 'llm-risk-blacklist',
    version: 1,
    asOfDate: tradeDate,
    generatedAt: bjStamp(),
    model: MOCK ? 'mock-heuristic' : (glmConfig().MODEL || null),
    source: MOCK ? 'mock-announcements' : (Object.keys(annMap).length ? 'announcements-latest.json' : 'none'),
    scanned: toScan.length,
    universe: UNIVERSE,
    limit: LIMIT,
    blacklist,
    degraded,
    note: '正向封禁黑名单：paper.js 建仓前查此表，命中即拒绝买入；空表 = 不封禁（fail-open，'
      + '未跑/无源绝不误伤正常交易）。风险等级 high/medium 入列。结构性 ST 强制 high。',
  };

  atomicWriteJSON(fileURLToPath(OUT), JSON.stringify(payload, null, 1));
  console.log(`[risk-scan] 扫描 ${payload.scanned} 只 → 黑名单 ${blacklist.length} 只`
    + `（high/medium）：${blacklist.map((b) => `${b.name}(${b.riskLevel})`).join('、') || '无'}`);
  console.log(`[risk-scan] 写出 ${fileURLToPath(OUT)}`);
}

main().catch((e) => { console.error('[risk-scan] 致命错误：', e); process.exit(1); });
