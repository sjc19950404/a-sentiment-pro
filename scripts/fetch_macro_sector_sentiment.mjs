#!/usr/bin/env node
// 场景二：宏观/行业新闻 → 板块情绪因子（V1）。
//   收盘后（或周末）抓取新浪滚动新闻（finance.sina.com.cn/roll，服务端渲染 UTF-8，本机可达），
//   用 GLM 把每条新闻映射到 A 股板块/概念 + 情绪方向 + 强度，再聚合成「板块情绪因子」
//   落盘 data/macro-sector-sentiment-latest.json；消费端 src/macro_sector_sentiment.js 经
//   src/engine/write.js 注入 signals.sectorSentiment。
//
// 数据流（照 fetch_llm_sentiment 三段式）：
//   本脚本（盘后/周末跑）→ data/macro-sector-sentiment-latest.json
//   → src/macro_sector_sentiment.js（纯函数转换 + 板块归一）
//   → src/engine/write.js sectorSentimentFn（只读 + 新鲜度守卫）→ signals.sectorSentiment
//
// 纪律（与 fetch_llm_sentiment 一致）：
//   · 缺 LLM 配置 → 打印指引退出非 0（诚实「未生成」，不落空档冒充中性）；
//   · 已配置但新闻抓取失败 / GLM 调用失败 / 超时 / 非法 JSON → 兜底落「获取失败，默认中性」档并退出 0，
//     绝不阻塞 EOD 主流程（pi_build 中本步骤即容错 step）。
//   · asOfDate 必须等于档案最新交易日（防伪：周末的新闻是为下一交易日蓄势，但证据锚点仍是最近交易日）。
//
// 用法：
//   node scripts/fetch_macro_sector_sentiment.mjs [--mock] [--limit 60] [--out data/macro-sector-sentiment-latest.json]
//   环境变量（真实模式）：LLM_API_URL / LLM_API_KEY / LLM_MODEL
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { decodeArchive } from '../src/lhb_codec.js';
import { bjStamp } from '../src/time.js';
import { fetchWithRetry, todayBeijing } from '../src/util.js';
import { loadEnv } from '../src/loadenv.js';
loadEnv(); // 幂等加载 .env（standalone / EOD 均可直接拿到 LLM_API_*）

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);
const MOCK = hasFlag('--mock');
const LIMIT = Math.max(10, (parseInt(argOf('--limit', '60'), 10) || 60));
const OUT = new URL('../data/macro-sector-sentiment-latest.json', import.meta.url);

// ── 0. 板块/概念口径（供 GLM 选词 + 聚合归一；与 A 股常用板块对齐）─────────────
const SECTORS = [
  '券商', '保险', '银行', '地产', '白酒', '食品饮料', '医药', 'CXO', '创新药', '中药', '医疗器械',
  '半导体', '芯片', '消费电子', '苹果产业链', 'AI', '算力', 'CPO', '光模块', 'PCB', '数据中心', '服务器',
  '机器人', '工业母机', '低空经济', '商业航天', '卫星互联网', '固态电池', '锂电', '储能', '光伏', '风电', '氢能源',
  '新能源汽车', '汽车', '智能驾驶', '军工', '航发', '船舶', '化工', '化肥', '农药', '钢铁', '煤炭', '有色', '铜', '铝', '黄金', '稀土',
  '石油', '石化', '燃气', '电力', '火电', '水电', '核电', '绿电', '基建', '建材', '水泥', '工程机械', '家电', '纺织服装',
  '农业', '种业', '猪周期', '传媒', '游戏', '出版', '教育', '计算机', '软件', '信创', '网络安全', '通信', '运营商', '6G',
  '物流', '快递', '港口', '航空', '航运', '旅游', '免税', '零售', '美容护理',
];

// ── 1. 抓新浪滚动新闻（服务端渲染，UTF-8）──────────────────────────────────
const SINA_ROLL = 'https://finance.sina.com.cn/roll/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

function parseSinaRoll(html) {
  const m = html.match(/<ul class="seo_data_list">([\s\S]*?)<\/ul>/);
  if (!m) return [];
  const re = /<a href="([^"]*(\d{4}-\d{2}-\d{2})[^"]*)"[^>]*target="_blank">([^<]{4,80})<\/a>/g;
  const out = [];
  let x;
  while ((x = re.exec(m[1]))) {
    out.push({ date: x[2], headline: x[3].trim(), url: x[1] });
  }
  return out;
}

async function fetchSinaRoll() {
  const html = await fetchWithRetry(SINA_ROLL, {
    headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' },
    timeout: 20000,
    read: async (r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      // roll 页为 UTF-8；兜底按 GBK 再解一次避免偶尔编码漂移
      const u = new TextDecoder('utf-8').decode(buf);
      if ((u.match(/[一-龥]/g) || []).length < 50) return new TextDecoder('gbk').decode(buf);
      return u;
    },
  }, 3, 1500);
  return parseSinaRoll(html);
}

// ── 1b. 离线 mock（无网络/无 GLM 也能验证聚合与落盘形状）────────────────────
function buildMockEvents() {
  // 预置一批带板块/方向/强度的事件，确定性验证聚合逻辑（不调 GLM）
  return [
    { headline: '公募、外资密集出手！持续布局港股创新药', date: '2026-10-24', sectors: ['创新药', 'CXO'], direction: 'positive', intensity: 0.7, reason: '资金流入创新药' },
    { headline: '美股科技巨头一份财报，引爆AI股抛售潮', date: '2026-10-24', sectors: ['AI', '算力', '半导体'], direction: 'negative', intensity: 0.8, reason: '美股科技利空传导' },
    { headline: '市场一夜不平静：金价跌破4000美元，油价大涨', date: '2026-10-24', sectors: ['黄金', '石油', '航空'], direction: 'negative', intensity: 0.6, reason: '金价跌利空黄金、油价涨利空航空' },
    { headline: '国产机器人出口迎爆发式增长', date: '2026-10-24', sectors: ['机器人'], direction: 'positive', intensity: 0.7, reason: '出口高增' },
    { headline: '飞天茅台零售均价小涨 洋河梦之蓝M6+三连跌创月新低', date: '2026-10-24', sectors: ['白酒'], direction: 'negative', intensity: 0.5, reason: '批价下行' },
    { headline: '一油轮在霍尔木兹海峡附近遇袭 船舶单周通航量下降', date: '2026-10-24', sectors: ['军工', '航运', '石油'], direction: 'positive', intensity: 0.6, reason: '地缘紧张' },
    { headline: '报道：美国将部分外交人员及其家属撤离中东驻地', date: '2026-10-24', sectors: ['军工'], direction: 'positive', intensity: 0.4, reason: '地缘升温' },
    { headline: '道指跌超650点！芯片股反弹', date: '2026-10-24', sectors: ['半导体'], direction: 'positive', intensity: 0.4, reason: '芯片反弹' },
  ];
}

// ── 2. GLM 分类（OpenAI 兼容协议）────────────────────────────────────────
function glmConfig() {
  const API_URL = process.env.LLM_API_URL
    || ((process.env.LLM_MODEL || '').startsWith('glm') ? 'https://open.bigmodel.cn/api/paas/v4' : '');
  return { API_URL, API_KEY: process.env.LLM_API_KEY || '', MODEL: process.env.LLM_MODEL || '' };
}

const SYSTEM = `你是 A 股宏观/行业新闻分析师。我会给你一批财经新闻标题（含日期，来自滚动新闻），请逐条判断它对 A 股板块/概念的影响。

要求：
1. sectors：从给定「板块列表」中选择最相关的 1~3 个板块；若新闻对 A 股无明确板块影响，填 []。
2. direction：positive=利好、negative=利空、neutral=中性（无关或尚不确定）。
3. intensity：影响强度 0~1（轻微 0.2~0.4，中等 0.5~0.7，重大 0.8~1）。
4. reason：一句话说明影响逻辑（≤40 字）。

映射提示（务必代入）：美股科技/AI 财报利空 → AI/算力/半导体/消费电子 利空；美股科技强 → 上述 利好；
油价大涨 → 石油石化/航运 利好、航空 利空；金价大跌 → 黄金 利空；地缘紧张/冲突 → 军工/石油 利好；
创新药政策或资金流入 → 创新药/CXO 利好；白酒批价下行 → 白酒 利空；机器人/低空经济政策或出口高增 → 对应板块 利好；
央行降准降息/财政扩张 → 券商/地产/基建 利好；监管处罚/立案 → 相关个股或板块 利空。

只输出一个 JSON 数组（不要任何其他文字），元素：
{"headline":"原标题","date":"YYYY-MM-DD","sectors":["板块"],"direction":"positive|negative|neutral","intensity":0.0,"reason":""}`;

async function callGLM(items, { API_URL, API_KEY, MODEL }, newsDate) {
  // 军规#3：写死当前时间，防止 GLM 用训练记忆替今日判断（防穿越）
  const user = `当前时间：${newsDate}（以下为当日滚动新闻，请据此而非训练记忆判断）。\n\n板块列表：${SECTORS.join('、')}\n\n新闻（编号. [日期] 标题）：\n`
    + items.map((it, i) => `${i + 1}. [${it.date}] ${it.headline}`).join('\n');
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
      max_tokens: 2500,
    }),
    timeout: 120000,
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

// ── 3. 聚合为板块情绪因子 ───────────────────────────────────────────────
function aggregate(events) {
  const dirSign = (d) => (d === 'positive' ? 1 : d === 'negative' ? -1 : 0);
  const bySector = new Map();
  let signedSum = 0, nAll = 0, intensitySum = 0, nSector = 0;
  for (const e of events) {
    const s = dirSign(e.direction);
    const it = Number(e.intensity);
    const intens = Number.isFinite(it) ? Math.max(0, Math.min(1, it)) : 0.3;
    nAll += 1;
    if (s !== 0) { signedSum += s * intens; intensitySum += intens; nSector += 1; }
    for (const sec of (Array.isArray(e.sectors) ? e.sectors : [])) {
      if (!sec) continue;
      const g = bySector.get(sec) || { sector: sec, signedSum: 0, count: 0, bullish: 0, bearish: 0, neutral: 0, headlines: [] };
      g.signedSum += s * intens;
      g.count += 1;
      if (e.direction === 'positive') g.bullish += 1;
      else if (e.direction === 'negative') g.bearish += 1;
      else g.neutral += 1;
      if (g.headlines.length < 4) g.headlines.push(e.headline);
      bySector.set(sec, g);
    }
  }
  const clamp = (x) => Math.max(-1, Math.min(1, x));
  const sectors = [...bySector.values()]
    .map((g) => {
      const score = g.count ? clamp(g.signedSum / g.count) : 0;
      return {
        sector: g.sector,
        score: Math.round(score * 100) / 100,
        score100: Math.round((score + 1) * 50),
        newsCount: g.count, bullish: g.bullish, bearish: g.bearish, neutral: g.neutral,
        headlines: g.headlines,
      };
    })
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || b.newsCount - a.newsCount);

  const overall = nAll ? clamp(signedSum / nAll) : 0;
  const label = overall > 0.15 ? '偏多' : overall < -0.15 ? '偏空' : '中性';
  const confidence = nSector ? Math.round((intensitySum / nSector) * 100) / 100 : 0;
  const topBull = sectors.filter((s) => s.score > 0.2).slice(0, 5)
    .map((s) => `${s.sector}(+${s.score})`).join('、') || '无';
  const topBear = sectors.filter((s) => s.score < -0.2).slice(0, 5)
    .map((s) => `${s.sector}(${s.score})`).join('、') || '无';
  const reason = `利好板块：${topBull}；利空板块：${topBear}`;
  return {
    macro: { sentiment: Math.round(overall * 100) / 100, score100: Math.round((overall + 1) * 50), label, confidence, reason },
    sectors,
  };
}

function getAsOfDate() {
  try {
    const arch = decodeArchive(JSON.parse(readFileSync(new URL('../data/archive.json', import.meta.url), 'utf8')));
    const days = (arch.all_days || []).filter((d) => d && d.trade_date);
    if (days.length) return days[days.length - 1].trade_date;
  } catch { /* 无档案 → 退回今天 */ }
  return todayBeijing();
}

function writePayload({ asOfDate, newsDate, model, macro, sectors, events, scanned, source, degraded }) {
  const payload = {
    kind: 'macro-sector-sentiment-latest',
    version: 1,
    asOfDate,                 // 证据锚点 = 档案最近交易日（防伪）
    newsDate,                 // 新闻实际日期
    generatedAt: bjStamp(),
    model: degraded ? null : model,
    macro,
    sectors,
    events,                   // 全量逐条判定（审计用）
    scanned,
    source,
    degraded: !!degraded,
    note: degraded
      ? '新闻抓取/GLM 获取失败兜底档（中性占位，不冒充真实情绪）。'
      : '板块情绪因子：新闻→GLM 映射板块/方向/强度→聚合。消费端按 signals.sectorSentiment 注入；'
        + 'score∈[-1,1]，score100∈[0,100]，仅作参考，不独立生成买卖信号。',
  };
  atomicWriteJSON(fileURLToPath(OUT), JSON.stringify(payload, null, 1));
  return payload;
}

// ── 4. 主流程 ───────────────────────────────────────────────────────────
async function main() {
  const asOfDate = getAsOfDate();
  const { API_URL, API_KEY, MODEL } = glmConfig();

  let rawItems, source, newsDate;
  if (MOCK) {
    rawItems = buildMockEvents();
    source = 'mock';
    newsDate = asOfDate;
  } else {
    try {
      rawItems = (await fetchSinaRoll()).slice(0, LIMIT);
      source = 'sina-roll';
      newsDate = rawItems[0]?.date || asOfDate;
    } catch (e) {
      console.error(`[macro-sent] ⚠ 新闻抓取失败：${e && e.message ? e.message : e}——兜底落中性档（不阻塞 EOD）`);
      writePayload({ asOfDate, newsDate: asOfDate, model: MODEL, macro: { sentiment: 0, score100: 50, label: '中性', confidence: 0, reason: '新闻抓取失败，默认中性' }, sectors: [], events: [], scanned: 0, source: 'sina-roll', degraded: true });
      process.exit(0);
    }
  }
  console.log(`[macro-sent] 新闻源=${source} 抓取 ${rawItems.length} 条 | 模式=${MOCK ? 'mock（预置事件）' : 'real（新浪滚动）'}`);

  let events;
  if (MOCK) {
    events = rawItems;
  } else {
    if (!API_URL || !API_KEY || !MODEL) {
      console.error('[macro-sent] ⚠ 缺 LLM 配置，无法分类（退出非 0，不落空档）。请设置：');
      console.error('    LLM_API_URL / LLM_API_KEY / LLM_MODEL');
      process.exit(2);
    }
    events = [];
    const BATCH = 20;
    for (let i = 0; i < rawItems.length; i += BATCH) {
      const batch = rawItems.slice(i, i + BATCH);
      try {
        const arr = await callGLM(batch, { API_URL, API_KEY, MODEL }, newsDate);
        (Array.isArray(arr) ? arr : []).forEach((x) => {
          if (x && typeof x.headline === 'string') {
            events.push({
              headline: x.headline,
              date: x.date || asOfDate,
              sectors: Array.isArray(x.sectors) ? x.sectors.filter((s) => SECTORS.includes(s)) : [],
              direction: x.direction === 'positive' || x.direction === 'negative' ? x.direction : 'neutral',
              intensity: Number(x.intensity) || 0.3,
              reason: typeof x.reason === 'string' ? x.reason.slice(0, 60) : '',
            });
          }
        });
      } catch (e) {
        console.error(`[macro-sent] ⚠ 批次分类失败：${e && e.message ? e.message : e}（继续，不阻塞）`);
      }
      await new Promise((r) => setTimeout(r, 300)); // 错峰，降低 GLM 免费档限流/超时概率
    }
    if (!events.length) {
      console.error('[macro-sent] ⚠ 全部批次分类失败——兜底落中性档（不阻塞 EOD）');
      writePayload({ asOfDate, newsDate, model: MODEL, macro: { sentiment: 0, score100: 50, label: '中性', confidence: 0, reason: 'GLM 分类失败，默认中性' }, sectors: [], events: [], scanned: rawItems.length, source, degraded: true });
      process.exit(0);
    }
  }

  const { macro, sectors } = aggregate(events);
  const payload = writePayload({ asOfDate, newsDate, model: MODEL, macro, sectors, events, scanned: rawItems.length, source, degraded: false });
  console.log(`[macro-sent] ${asOfDate} 宏观情绪=${payload.macro.label}(${payload.macro.sentiment}) | 涉及板块 ${sectors.length} 个`);
  sectors.slice(0, 8).forEach((s) => console.log(`   ${s.sector}: ${s.score} (${s.newsCount}条, 多${s.bullish}/空${s.bearish})`));
  console.log(`[macro-sent] 写出 ${fileURLToPath(OUT)}`);
}

main().catch((e) => { console.error('[macro-sent] 致命错误：', e); process.exit(1); });

export { parseSinaRoll, SECTORS, aggregate, buildMockEvents };
