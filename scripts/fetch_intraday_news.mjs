#!/usr/bin/env node
// 盘中新闻侧车（极轻量）：仅对「报价侧车中已触发急跌/异动的标的」fetch 新浪公司新闻，
// 用 GLM 生成 ≤30 字一句话快讯（无 GLM / 失败则退回头条标题），落盘 data/intraday-news-latest.json。
//
// 设计纪律（与项目军规一致）：
//   · 非极端不打扰：无标的触发 → 直接写空档、不联网、不调 GLM（fail-open）。
//   · 推送路径零 GLM：本脚本在「盘中 cron 推送前一步」跑，推送层 buildIntradayAlert 只读侧车，
//     不直连 GLM（保持推送模块确定性 / 离线安全 / 与军规#1 side-car 一致）。
//   · 轻量：触发标的封顶 5 只，每只至多抓 2 个新浪源（news.shtml + 公告页），错峰 400ms。
//
// 用法：
//   node scripts/fetch_intraday_news.mjs [--mock]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { fetchWithRetry, todayBeijing } from '../src/util.js';
import { bjStamp } from '../src/time.js';
import { loadEnv } from '../src/loadenv.js';
loadEnv();

const args = process.argv.slice(2);
const MOCK = args.includes('--mock');
const OUT = new URL('../data/intraday-news-latest.json', import.meta.url);
const ROOT = new URL('../', import.meta.url);
const resolve = (p) => (p.startsWith('/') ? new URL('file://' + p) : new URL(p, ROOT));

function marketOf(code) {
  const c = String(code);
  if (/^(6|9)/.test(c)) return 'sh';
  if (/^(0|3)/.test(c)) return 'sz';
  if (/^(8|4)/.test(c)) return 'bj';
  return 'sh';
}

// 触发标的 = 报价侧车中 chgPct <= -5 的（封顶 5）
function flaggedCodes() {
  let q = null;
  try { q = JSON.parse(readFileSync(resolve('data/intraday-quotes-latest.json'), 'utf8')); } catch { return []; }
  if (!q || q.degraded || !Array.isArray(q.quotes)) return [];
  return q.quotes
    .filter((s) => typeof s.chgPct === 'number' && s.chgPct <= -5)
    .map((s) => String(s.code))
    .slice(0, 5);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
function decodeSina(buf) {
  const u = new TextDecoder('utf-8').decode(buf);
  if ((u.match(/[一-龥]/g) || []).length < 30) { try { return new TextDecoder('gbk').decode(buf); } catch { return u; } }
  return u;
}

// 容忍式标题抽取：公司新闻页 + 公告页，抓 <a> 文本（6~40 字、含中文、去导航词、去重）
async function fetchHeadlines(code) {
  const mkt = marketOf(code);
  const urls = [
    `https://finance.sina.com.cn/realstock/company/${mkt}${code}/news.shtml`,
    `https://vip.stock.finance.sina.com.cn/corp/go.php/vCB_AllNewsStock/symbol/${code}.phtml`,
  ];
  const seen = new Set();
  const heads = [];
  const NAV = /^(新浪|财经|首页|登录|注册|股票|博客|视频|科技|财经头条|滚动|股票吧|股吧|行情中心|数据|理财|基金)/;
  for (const u of urls) {
    try {
      const html = await fetchWithRetry(u, {
        headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' },
        timeout: 15000,
        read: async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return decodeSina(Buffer.from(await r.arrayBuffer())); },
      }, 2, 800);
      const re = /<a[^>]*href="[^"]*"[^>]*>([^<]{6,40})<\/a>/g;
      let m;
      while ((m = re.exec(html))) {
        const t = m[1].trim();
        if (/[一-龥]/.test(t) && !NAV.test(t) && !seen.has(t)) { seen.add(t); heads.push(t); }
      }
    } catch { /* 该源失败跳过，试下一个 */ }
    if (heads.length >= 5) break;
  }
  return heads.slice(0, 5);
}

function glmConfig() {
  const API_URL = process.env.LLM_API_URL
    || ((process.env.LLM_MODEL || '').startsWith('glm') ? 'https://open.bigmodel.cn/api/paas/v4' : '');
  return { API_URL, API_KEY: process.env.LLM_API_KEY || '', MODEL: process.env.LLM_MODEL || '' };
}

const SYSTEM = `你是 A 股盘中快讯编辑。我会给你若干「触发急跌/异动的股票」及其最新新闻标题，请逐只写一句 ≤30 字 的盘中快讯（犀利、客观、不喊单），点明最新消息面。
只输出一个 JSON 数组（不要其他文字），元素：{"code":"股票代码","summary":"≤30字一句话"}。`;

async function callGLM(items, cfg, date) {
  const user = `当前时间：${date}（据此而非训练记忆）。\n\n急跌/异动标的与其最新新闻标题：\n`
    + items.map((it, i) => `${i + 1}. ${it.code} ${it.name}\n   标题：${(it.headlines || []).join('；') || '（无）'}`).join('\n');
  const chat = await fetchWithRetry(`${cfg.API_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.API_KEY}` },
    body: JSON.stringify({
      model: cfg.MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      temperature: 0.3, max_tokens: 600,
    }),
    timeout: 60000,
    read: async (r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const t = j?.choices?.[0]?.message?.content;
      if (typeof t !== 'string' || !t.trim()) throw new Error('返回无 content');
      return t;
    },
  }, 3, 1500);
  const m = chat.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('回复中未找到 JSON 数组');
  return JSON.parse(m[0]);
}

async function main() {
  const codes = flaggedCodes();
  if (!codes.length) {
    const p = { kind: 'intraday-news', version: 1, generatedAt: bjStamp(), news: {}, degraded: false, note: '无急跌/异动标的，未联网（非极端不打扰）' };
    atomicWriteJSON(fileURLToPath(OUT), JSON.stringify(p, null, 1));
    console.log('[intraday-news] 无触发标的，写空档（不联网、不调 GLM）');
    return;
  }
  console.log(`[intraday-news] ${codes.length} 只触发，fetch 新浪新闻 + GLM 一句话`);

  let q = null;
  try { q = JSON.parse(readFileSync(resolve('data/intraday-quotes-latest.json'), 'utf8')); } catch { q = null; }
  const nameOf = (c) => { const s = q && Array.isArray(q.quotes) ? q.quotes.find((x) => String(x.code) === String(c)) : null; return s && s.name ? s.name : c; };

  const items = [];
  for (const c of codes) {
    const headlines = await fetchHeadlines(c);
    items.push({ code: String(c), name: nameOf(c), headlines });
    await new Promise((r) => setTimeout(r, 400)); // 错峰，降新浪限流概率
  }

  const news = {};
  const cfg = glmConfig();
  const fallback = () => items.forEach((it) => { if (it.headlines.length) news[String(it.code)] = { summary: it.headlines[0].slice(0, 28), headlines: it.headlines }; });
  if (MOCK) {
    items.forEach((it) => { news[String(it.code)] = { summary: `${it.name}突发利空，资金出逃`, headlines: it.headlines }; });
  } else if (cfg.API_URL && cfg.API_KEY && cfg.MODEL) {
    try {
      const arr = await callGLM(items, cfg, todayBeijing());
      const byCode = new Map(items.map((it) => [String(it.code), it]));
      (Array.isArray(arr) ? arr : []).forEach((x) => {
        if (!x || !x.code) return;
        const it = byCode.get(String(x.code));
        news[String(x.code)] = { summary: typeof x.summary === 'string' ? x.summary.slice(0, 30) : '', headlines: it ? it.headlines : [] };
      });
      fallback(); // 未覆盖的标的 → 退回头条
    } catch (e) {
      console.error(`[intraday-news] ⚠ GLM 失败，退回头条标题：${e && e.message ? e.message : e}`);
      fallback();
    }
  } else {
    console.error('[intraday-news] ⚠ 缺 LLM 配置，退回头条标题');
    fallback();
  }

  atomicWriteJSON(fileURLToPath(OUT), JSON.stringify({
    kind: 'intraday-news', version: 1, generatedAt: bjStamp(), news, degraded: false,
    note: '盘中急跌/异动标的快讯（新浪新闻 + GLM 一句话，≤30 字）',
  }, null, 1));
  console.log(`[intraday-news] 写出 ${fileURLToPath(OUT)}，覆盖 ${Object.keys(news).length} 只`);
  Object.entries(news).forEach(([c, v]) => console.log(`   ${c}: ${v.summary}`));
}

main().catch((e) => { console.error('[intraday-news] 致命错误：', e); process.exit(1); });
