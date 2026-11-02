#!/usr/bin/env node
// 方向 C：妖股逻辑推演（场景二衍生）——把 GLM 当「连板妖股逻辑分析师」用：
//   收盘后取连板梯队（archive.summary.zt_lb + ztpool 行业板块 hybk），复用场景二的板块情绪因子
//   （data/macro-sector-sentiment-latest.json）做 grounding，让 GLM 逐只推断「为什么涨停」并判断
//   是否纯情绪炒作，产出 data/llm-dragon-logic-latest.json。
//
// 三条铁血军规（用户 2026-10-24 确立）：
//   1. 绝对隔离（Side-car）：GLM 输出独立落盘 JSON，绝不修改 V5.2 原始情绪分 / regime 状态机；
//      它只提供一个「附加参考」，由下游代码（paper.js 等）决定采不采纳。
//   2. 强制 JSON 输出：Prompt 强制只输出合法 JSON 数组，无 Markdown；代码侧正则提取 + JSON.parse 兜底。
//   3. 严格时间戳（防穿越）：Prompt 写死「当前时间 = 最新交易日」，防止 GLM 用训练记忆替今日判断。
//
// 数据流（照 llm_sentiment 三段式）：
//   本脚本（收盘后跑）→ data/llm-dragon-logic-latest.json → src/dragon_logic.js（消费端纯函数 + 守卫）
//   → src/engine/write.js dragonLogicFn → signals.dragonLogic（纯参考，不改动 regime/emotion）。
//
// 用法：
//   node scripts/fetch_dragon_logic.mjs [--mock] [--limit 40] [--universe ladder]
//                                 [--archive data/archive.json] [--macro data/macro-sector-sentiment-latest.json]
//                                 [--out data/llm-dragon-logic-latest.json]
// 环境变量（真实模式）：LLM_API_URL / LLM_API_KEY / LLM_MODEL
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { decodeArchive } from '../src/lhb_codec.js';
import { bjStamp } from '../src/time.js';
import { fetchWithRetry, todayBeijing } from '../src/util.js';
import { loadEnv } from '../src/loadenv.js';
loadEnv();

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);
const MOCK = hasFlag('--mock');
const UNIVERSE = argOf('--universe', 'ladder'); // ladder | paper
const LIMIT = Math.max(1, (parseInt(argOf('--limit', '40'), 10) || 40));
const ROOT_URL = new URL('../', import.meta.url); // 项目根（scripts/ 上一级）
const resolvePath = (p) => (p && (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)))
  ? new URL('file://' + p) : new URL(p, ROOT_URL);
const ARCHIVE = argOf('--archive', 'data/archive.json');
const MACRO = argOf('--macro', 'data/macro-sector-sentiment-latest.json');
const OUT = resolvePath(argOf('--out', 'data/llm-dragon-logic-latest.json'));

function getTradeDate() {
  try {
    const arch = decodeArchive(JSON.parse(readFileSync(resolvePath(ARCHIVE), 'utf8')));
    const days = (arch.all_days || []).filter((d) => d && d.trade_date);
    return days.length ? days[days.length - 1].trade_date : todayBeijing();
  } catch { return todayBeijing(); }
}

// ── 1. 连板梯队（code/name/连板数/行业板块）──────────────────────────────────
function collectLadder(tradeDate) {
  let ztLb = {}, names = {}, hybk = {};
  try {
    const arch = decodeArchive(JSON.parse(readFileSync(resolvePath(ARCHIVE), 'utf8')));
    const day = (arch.all_days || []).filter((d) => d && d.trade_date).pop();
    ztLb = (day && day.summary && day.summary.zt_lb) || {};
  } catch { /* 无 archive → 空梯队 */ }
  try {
    const pu = JSON.parse(readFileSync(resolvePath('data/paper_universe.json'), 'utf8'));
    names = (pu.symbols || {});
  } catch { /* 无 universe → 仅 code */ }
  // hybk / 涨跌幅 / 成交额 / 炸板次数 来自 ztpool_history 最新交易日条目
  //   （注：当前 ztpool 快照无 换手率/封单量/龙虎榜席位，以 连板+涨跌幅+成交额+炸板 作代理推断）
  const ztMeta = {};
  try {
    const z = JSON.parse(readFileSync(resolvePath('data/ztpool_history.json'), 'utf8'));
    const entries = Object.values(z);
    const last = entries.reduce((a, b) => (b.date > a.date ? b : a), entries[0] || { pool: [] });
    (last.pool || []).forEach((p) => {
      if (p.c) {
        hybk[p.c] = p.hybk || '';
        ztMeta[p.c] = {
          chg: p.zdp != null ? +p.zdp : null,
          amountY: p.amount != null ? p.amount / 1e8 : null,
          zbc: p.zbc != null ? +p.zbc : null,
        };
      }
    });
  } catch { /* 无 ztpool → 空 */ }

  const nameOf = (c) => (names[c] && names[c].name) || c;
  let arr = Object.keys(ztLb).map((c) => ({
    code: c, name: nameOf(c), lb: Number(ztLb[c]) || 0, hybk: hybk[c] || '',
    chg: ztMeta[c] ? ztMeta[c].chg : null,
    amountY: ztMeta[c] ? ztMeta[c].amountY : null,
    zbc: ztMeta[c] ? ztMeta[c].zbc : null,
  }));
  // 连板梯队：优先连板≥2，不足 LIMIT 再用首板补足
  const ge2 = arr.filter((x) => x.lb >= 2).sort((a, b) => b.lb - a.lb);
  const eq1 = arr.filter((x) => x.lb < 2).sort((a, b) => b.lb - a.lb);
  arr = [...ge2, ...eq1].slice(0, LIMIT);
  return arr;
}

// ── 2. 板块情绪 grounding（复用场景二产物，可选）────────────────────────────
function readSectorMood() {
  if (!existsSync(resolvePath(MACRO))) return null;
  try {
    const m = JSON.parse(readFileSync(resolvePath(MACRO), 'utf8'));
    const sectors = Array.isArray(m.sectors) ? m.sectors : [];
    const bull = sectors.filter((s) => s.score > 0.2).slice(0, 8).map((s) => `${s.sector}+${s.score}`);
    const bear = sectors.filter((s) => s.score < -0.2).slice(0, 8).map((s) => `${s.sector}${s.score}`);
    return { bull: bull.join('、') || '无', bear: bear.join('、') || '无' };
  } catch { return null; }
}

// ── 3. GLM 逻辑推演 ────────────────────────────────────────────────────────
const SYSTEM = `你是 A 股"游资毒舌"筹码分析师。我会给你一批**连板股**（连续涨停的票），每只附：代码/名称、连板天数、行业板块，以及（若有）当日涨跌幅(%)、成交额(亿元)、炸板次数；另附全市场"板块情绪因子"（由另一模型从当日宏观/行业新闻聚合，score∈[-1,1]，正=利好、负=利空）。

请逐只给出一句 **≤30 字** 的"筹码定性"判词（游资复盘口吻、犀利、口语化、敢说真话），定性其筹码松紧与次日预期，例如：
- "拉萨天团接盘，高位爆量分歧，明日大概率核按钮"
- "机构与游资共振，缩量硬板，预期一字加速"
- "一字独食无换手，通道党游戏，散户别凑热闹"
同时判定驱动性质 logic_type 与是否纯情绪炒作 is_pure_sentiment、把握 confidence。

筹码定性依据（按优先级；某维度数据缺失则跳过该维度，**绝不编造具体席位名**）：
1. 连板高度越高 + 板块无利好 → 越偏纯情绪炒作、越危险。
2. 成交额(亿)极大且炸板次数多 → 爆量分歧、筹码松动；极小且缩量封死 → 硬板加速。
3. 炸板次数多 → 封单不坚决、抛压重。
4. 板块情绪明显为正/负 → 叠加题材/利空判定。
（换手率/封单量/龙虎榜席位若数据缺失，按 连板高度+量能+炸板 推断，用"游资/拉萨/机构"等泛称，不虚构席位。）

纪律：不编造未提及的题材；你只做定性，绝不修改任何分数或状态。

只输出一个 JSON 数组，元素：{"code":"","name":"","logic_type":"题材驱动|政策催化|基本面驱动|情绪驱动|纯情绪炒作|未知","is_pure_sentiment":false,"confidence":0.0,"reason":""}。reason 必须是 ≤30 字的游资毒舌筹码定性。不要任何其他文字。`;

function glmConfig() {
  const API_URL = process.env.LLM_API_URL
    || ((process.env.LLM_MODEL || '').startsWith('glm') ? 'https://open.bigmodel.cn/api/paas/v4' : '');
  return { API_URL, API_KEY: process.env.LLM_API_KEY || '', MODEL: process.env.LLM_MODEL || '' };
}

async function callGLM(stocksBatch, mood, tradeDate) {
  const moodText = mood
    ? `全市场板块情绪因子（score∈[-1,1]，正值=利好催化、负值=利空；若某股板块未在下述名单中，视为无数据）：\n利好板块：${mood.bull}\n利空板块：${mood.bear}`
    : '全市场板块情绪因子：无数据（未运行场景二）；请仅按连板与行业常识推断。';
  const user = `当前时间：${tradeDate}（A 股最新交易日；以下为当日连板股数据，请据此而非训练记忆判断）。\n\n`
    + moodText + '\n\n'
    + '连板股（编号. [连板数板] 代码 名称（行业：hybk）[涨跌幅%][成交额亿][炸板次数]）：\n'
    + stocksBatch.map((s, i) => `${i + 1}. [${s.lb}板] ${s.code} ${s.name}（行业：${s.hybk || '未知'}）`
      + `${s.chg != null ? ` 涨跌幅 ${s.chg}%` : ''}${s.amountY != null ? ` 成交额 ${s.amountY.toFixed(2)}亿` : ''}${s.zbc != null ? ` 炸板 ${s.zbc}次` : ''}`).join('\n');
  const { API_URL, API_KEY, MODEL } = glmConfig();
  const chat = await fetchWithRetry(`${API_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    }),
    timeout: 90000,
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

// mock：确定性预置，验证聚合/落盘（不调 GLM）
function buildMockDragons(stocks) {
  const seed = [
    { code: stocks[0] && stocks[0].code, logic_type: '纯情绪炒作', is_pure_sentiment: true, confidence: 0.7, reason: '高连板无实质催化' },
    { code: stocks[1] && stocks[1].code, logic_type: '题材驱动', is_pure_sentiment: false, confidence: 0.8, reason: '板块利好政策催化' },
    { code: stocks[2] && stocks[2].code, logic_type: '情绪驱动', is_pure_sentiment: true, confidence: 0.5, reason: '游资接力无题材' },
  ];
  const byCode = new Map(stocks.map((s) => [s.code, s]));
  return seed.filter((x) => x.code).map((x) => {
    const s = byCode.get(x.code);
    return { code: x.code, name: s ? s.name : x.code, lb: s ? s.lb : 0, hybk: s ? s.hybk : '', logic_type: x.logic_type, is_pure_sentiment: x.is_pure_sentiment, confidence: x.confidence, reason: x.reason };
  });
}

// ── 4. 主流程 ─────────────────────────────────────────────────────────────
async function main() {
  const tradeDate = getTradeDate();
  const stocks = collectLadder(tradeDate);
  if (!stocks.length) { console.error('[dragon] 无连板梯队，退出'); process.exit(1); }
  const mood = MOCK ? null : readSectorMood();

  console.log(`[dragon] 连板梯队 ${stocks.length} 只（limit=${LIMIT}）| 模式=${MOCK ? 'mock' : 'real'}`
    + `${mood ? ' | 板块情绪 grounding=有' : (MOCK ? '' : ' | 板块情绪 grounding=无（场景二未跑）')}`);

  if (!MOCK) {
    const { API_URL, API_KEY, MODEL } = glmConfig();
    if (!API_URL || !API_KEY || !MODEL) {
      console.error('[dragon] ⚠ 缺 LLM 配置，无法推演（退出非 0，不落空档）。请设置 LLM_API_URL / LLM_API_KEY / LLM_MODEL');
      process.exit(2);
    }
  }

  let dragons;
  if (MOCK) {
    dragons = buildMockDragons(stocks);
  } else {
    dragons = [];
    const BATCH = 10;
    for (let i = 0; i < stocks.length; i += BATCH) {
      const batch = stocks.slice(i, i + BATCH);
      try {
        const arr = await callGLM(batch, mood, tradeDate);
        const byCode = new Map(stocks.map((s) => [s.code, s]));
        (Array.isArray(arr) ? arr : []).forEach((x) => {
          if (!x || !x.code) return;
          const s = byCode.get(x.code) || {};
          dragons.push({
            code: x.code, name: x.name || s.name || x.code, lb: s.lb || 0, hybk: s.hybk || '',
            logic_type: ['题材驱动', '政策催化', '基本面驱动', '情绪驱动', '纯情绪炒作', '未知'].includes(x.logic_type) ? x.logic_type : '未知',
            is_pure_sentiment: x.is_pure_sentiment === true,
            confidence: Number(x.confidence) || 0.3,
            reason: typeof x.reason === 'string' ? x.reason.slice(0, 30) : '',
          });
        });
      } catch (e) {
        console.error(`[dragon] ⚠ 批次失败：${e && e.message ? e.message : e}（继续，不阻塞）`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!dragons.length) {
      console.error('[dragon] ⚠ 全部批次失败——兜底落空档（不阻塞 EOD）');
      const payload = { kind: 'llm-dragon-logic', version: 1, asOfDate: tradeDate, generatedAt: bjStamp(), model: glmConfig().MODEL || null, source: 'none', scanned: stocks.length, limit: LIMIT, dragons: [], degraded: true, note: '妖股逻辑推演：GLM 调用全失败，兜底空档（不冒充结论）。' };
      atomicWriteJSON(fileURLToPath(OUT), JSON.stringify(payload, null, 1));
      console.log(`[dragon] 写出 ${fileURLToPath(OUT)}（degraded）`);
      process.exit(0);
    }
  }

  const pureCount = dragons.filter((d) => d.is_pure_sentiment).length;
  const payload = {
    kind: 'llm-dragon-logic', version: 1, asOfDate: tradeDate, generatedAt: bjStamp(),
    model: MOCK ? 'mock' : (glmConfig().MODEL || null),
    source: MOCK ? 'mock' : (mood ? 'ztpool+macro-sector-sentiment' : 'ztpool'),
    scanned: stocks.length, limit: LIMIT, dragons,
    degraded: false,
    note: '妖股逻辑推演（方向C）：连板股→GLM 推断涨停逻辑/是否纯情绪炒作。纯参考，绝不修改 regime/emotion 原始分数；由下游代码（如 paper.js）决定采不采纳（例：对纯情绪炒作且高连板的票谨慎追高）。',
  };
  atomicWriteJSON(fileURLToPath(OUT), JSON.stringify(payload, null, 1));
  console.log(`[dragon] 推演 ${dragons.length} 只 | 纯情绪炒作 ${pureCount} 只`);
  dragons.slice(0, 10).forEach((d) => console.log(`   ${d.name}(${d.code}) ${d.lb}板 ${d.hybk} → ${d.logic_type} ${d.is_pure_sentiment ? '[纯情绪]' : ''} (${d.confidence})`));
  console.log(`[dragon] 写出 ${fileURLToPath(OUT)}`);
}

if (process.argv[1] && process.argv[1].endsWith('fetch_dragon_logic.mjs')) {
  main().catch((e) => { console.error('[dragon] 致命错误：', e); process.exit(1); });
}

export { SYSTEM, callGLM };
