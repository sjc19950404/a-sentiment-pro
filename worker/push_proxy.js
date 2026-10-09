// ── Cloudflare Worker 推送代理（决议 2 · P0 · 2026-10-07）──────────────────
//
// 定位：页面即时轨报告的「复制 → 云端推送」代理端。浏览器拿不到 secret、
//   直连企微 Webhook 还有 CORS 墙——所以报告信封 POST 到本代理，由 Worker
//   持有 OPS_WEBHOOK 完成推送（与 CI 同一机器人同一通道，决议 2 原文：
//   「页面即时轨的云端推送走云函数代理，不经 Node 模块」）。
//
// 零 Node API：只 import 纯渲染层 src/push_text.js（零依赖）+ 标准 fetch/
//   Request/Response/URL——Workers/Node 18+/浏览器三环境同构，单测可直跑。
//
// 推送纪律（与 src/ai_report_push.js::pushReports 同一哲学）：
//   · 未配置 OPS_WEBHOOK → 静默跳过（200 + pushed:false，本地零打扰）；
//   · 内容指纹去重（同稳定域哈希，KV 存 30 天）——同内容重推被拦；
//   · urgent（trigger ≠ 'schedule'，决议 3 四类事件）免指纹直达；
//   · 指数退避重试（2026-10-10 通道加固）：瞬时 5xx/网络抖动/企微系统繁忙
//     2s→4s→8s 就地重试；白名单外（4xx/93xxx）零重试不消耗；
//   · 重试耗尽不丢消息：失败信封落 KV failed_pushes（TTL 7 天），下次任意
//     推送请求经 ctx.waitUntil 后台自动补推（不阻塞本次推送）；
//   · 企微静默丢包判据：HTTP 2xx ≠ 送达——body errcode≠0（93xxx：key 失效/
//     群变更/机器人被移除）视为失败，不记指纹（对齐 ai_report_push.js）；
//   · 滥用面三闸：来源校验（ALLOWED_ORIGIN）/ 请求体上限 / 每日推送上限。
//
// 防护说明（个人系统威胁模型，如实记录）：secret 只在 Worker 侧；
//   ALLOWED_ORIGIN 未配置时放行（本地 dev / 初次部署期），上线后应在
//   wrangler.toml [vars] 设页面部署域——这不是强认证，是低摩擦滥用闸。
export { PUSH_CONSTS, renderPushText, sanitizeWebhookUrl } from '../src/push_text.js';
import { renderPushText, sanitizeWebhookUrl } from '../src/push_text.js'; // re-export 不入本模块作用域，本地渲染/清洗需显式 import

export const PROXY_CONSTS = {
  BODY_CAP: 64 * 1024,            // 请求体上限（信封 JSON 远小于此，防投毒）
  DEDUP_TTL_S: 30 * 86400,        // 指纹记忆 30 天（对齐 PUSH_CONSTS.STATE_TTL_MS）
  DAILY_CAP: 100,                 // 每日推送上限（KV 计数兜底，防代理被滥用刷量）
  REPORT_TYPES: ['pre_market', 'intraday', 'post_market', 'weekly'],
};

// ── 通道加固（2026-10-10 用户指令第二轮）：重试退避 + failed_pushes 落盘 + 补推 ──
export const RETRY_CONSTS = {
  BACKOFF_MS: [2000, 4000, 8000], // 指数退避：2s → 4s → 8s（1 次首发 + 3 次重试）
  RETRYABLE_ERRCODES: [-1],       // 企微 errcode -1 = 系统繁忙（官方判据建议重试）；93xxx 参数/配置错误不重试
  FAILED_TTL_S: 7 * 86400,         // failed_pushes 落盘保存 7 天（过期即弃，防无限堆积）
  REPLAY_LIMIT: 5,                // 单轮补推上限（防失败堆积风暴一次灌爆群）
};

/** 可重试白名单：网络异常（fetch throw）/ 5xx / 429 / 企微系统繁忙（errcode -1）
 *  → 瞬时，重试可自愈；4xx 参数错误 / 93xxx → 永久，重试只是无效消耗（不重试，
 *  但同样落 failed_pushes——换 key / 修配置后补推仍能救回，不丢消息）。 */
export function isRetryable(outcome = {}) {
  if (outcome.errcode != null) return RETRY_CONSTS.RETRYABLE_ERRCODES.includes(outcome.errcode);
  if (outcome.httpStatus != null) return outcome.httpStatus === 429 || outcome.httpStatus >= 500;
  return true; // fetch throw（网络异常）按瞬时处理
}

/**
 * 指数退避发送（2s → 4s → 8s）：瞬时失败逐次退避重试，白名单外失败立即返回。
 * @returns {{ok:boolean, res?:object, wechat?:object, threw?:Error,
 *   attempts:number, retryable:boolean}} ok=true 才记指纹；false 由调用方落
 *   failed_pushes（重试耗尽不丢消息）。
 */
export async function sendWithRetry(fetchImpl, url, init, opts = {}) {
  const backoff = opts.backoffMs ?? RETRY_CONSTS.BACKOFF_MS;
  const sleep = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const onAttempt = opts.onAttempt ?? null;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const res = await fetchImpl(url, init);
      let wechat = {};
      try {
        if (typeof res?.json === 'function') wechat = await res.json();
        else if (typeof res?.text === 'function') { try { wechat = JSON.parse(await res.text()); } catch { wechat = {}; } }
      } catch { wechat = {}; }
      const errcode = wechat?.errcode;
      if (res.ok && errcode === undefined) return { ok: true, res, wechat, attempts: attempt, retryable: false };
      if (res.ok && errcode === 0) return { ok: true, res, wechat, attempts: attempt, retryable: false };
      const retryable = isRetryable({ httpStatus: res.status, errcode: errcode ?? null });
      if (retryable && attempt <= backoff.length) {
        if (onAttempt) onAttempt({ attempt, retryable, httpStatus: res.status, errcode: errcode ?? null });
        await sleep(backoff[attempt - 1]);
        continue;
      }
      return { ok: false, res, wechat, attempts: attempt, retryable };
    } catch (e) {
      if (attempt <= backoff.length) {
        if (onAttempt) onAttempt({ attempt, retryable: true, error: e?.message ?? String(e) });
        await sleep(backoff[attempt - 1]);
        continue;
      }
      return { ok: false, threw: e, attempts: attempt, retryable: true };
    }
  }
}

/** 补推（ctx.waitUntil 后台执行，不阻塞本次推送）：遍历 failed:* 落盘信封，
 *  非 urgent 且期间已有同指纹直推成功的 → 弃（防重复进群）；其余照送，
 *  成功即清账。单轮上限 REPLAY_LIMIT。 */
export async function replayFailedPushes(env, opts = {}) {
  const kv = env?.PUSH_STATE ?? null;
  if (!kv) return { replayed: 0, note: '无 KV 绑定，无账可补' };
  const url = env?.OPS_WEBHOOK ? sanitizeWebhookUrl(env.OPS_WEBHOOK) : null;
  if (!url) return { replayed: 0, note: 'webhook 未配置/非法，无通道可补' };
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return { replayed: 0, note: '当前环境无 fetch' };
  let listed;
  try { listed = await kv.list({ prefix: 'failed:' }); } catch { return { replayed: 0, note: 'KV list 故障，本轮跳过' }; }
  const keys = (listed?.keys ?? []).slice(0, opts.limit ?? RETRY_CONSTS.REPLAY_LIMIT);
  let replayed = 0; let skippedDup = 0; const remained = [];
  for (const { name } of keys) {
    let entry = null;
    try { entry = JSON.parse((await kv.get(name)) || 'null'); } catch { entry = null; }
    if (!entry?.report) { try { await kv.delete(name); } catch { /* 脏账清不掉留着下轮 */ } continue; }
    const fp = proxyFingerprint(entry.report);
    const urgent = entry.report?.trigger && entry.report.trigger !== 'schedule';
    if (!urgent) {
      let dup = false;
      try { dup = Boolean(await kv.get(`fp:${fp}`)); } catch { dup = false; }
      if (dup) { skippedDup += 1; try { await kv.delete(name); } catch { /* 同上 */ } continue; }
    }
    const sent = await sendWithRetry(fetchImpl, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: renderPushText(entry.report) } }),
    }, { sleepImpl: opts.sleepImpl });
    if (sent.ok) { replayed += 1; try { await kv.delete(name); } catch { /* 下轮幂等再清 */ } }
    else remained.push({ key: name, attempts: sent.attempts });
  }
  return { replayed, skippedDup, remaining: remained.length + Math.max(0, (listed?.keys ?? []).length - keys.length) };
}

/** 稳定域抽取（与 ai_report_push.js::fingerprintOf 同域：易变字段剔除）。 */
function stableOf(report) {
  return JSON.stringify({
    report_type: report?.report_type,
    date: report?.date,
    trigger: report?.trigger,
    status: report?.status,
    payload: report?.payload,
    missing_notes: report?.missing_notes,
  });
}

/** 轻量内容指纹（djb2 双轮 + 长度，16 hex）：**去重用**，非安全哈希——
 *  Worker 免费层无 node:crypto，WebCrypto 摘要则是异步且此处非安全场景。 */
export function proxyFingerprint(report) {
  const s = stableOf(report);
  let h1 = 5381; let h2 = 52711;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = (h1 * 33 + c) >>> 0; // eslint-disable-line no-bitwise
    h2 = (h2 * 31 + c) >>> 0; // eslint-disable-line no-bitwise
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`.slice(0, 16) + `_${s.length.toString(16)}`;
}

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
});

export function corsHeaders(env) {
  const origin = env?.ALLOWED_ORIGIN || '*';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

/** GET /healthz —— 存活探针（wrangler dev 验收端点）。 */
export function handleHealth() {
  return json({ ok: true, ts: new Date().toISOString(), service: 'a-sentiment-push-proxy' });
}

/** 北京时区日期键（每日计数用；仅键名，粗粒度日界足够）。 */
function bjDayKey(now) {
  const d = now instanceof Date ? now : new Date(now);
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return `day:${bj.toISOString().slice(0, 10)}`;
}

/**
 * POST /push —— 报告信封 → 企微推送（KV 去重 + 每日限额 + 来源闸）。
 * @param {Request} request 标准 Fetch Request
 * @param {{OPS_WEBHOOK?:string, ALLOWED_ORIGIN?:string, PUSH_STATE?:object}} env
 *   Worker 绑定：OPS_WEBHOOK=secret，ALLOWED_ORIGIN=var，PUSH_STATE=KV namespace
 * @param {{now?:Date, fetchImpl?:Function, sleepImpl?:Function, ctx?:object}} opts
 *   测试注入；ctx = Workers 执行上下文（waitUntil 后台补推，不阻塞本次推送）
 */
export async function handlePush(request, env, { now = new Date(), fetchImpl, sleepImpl, ctx } = {}) {
  if (request.method !== 'POST') return json({ ok: false, reason: '仅接受 POST' }, 405, corsHeaders(env));
  const allow = env?.ALLOWED_ORIGIN;
  if (allow) {
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer') || '';
    if (origin !== allow && !referer.startsWith(`${allow}/`)) {
      return json({ ok: false, reason: '来源未授权' }, 403, corsHeaders(env));
    }
  }
  const len = Number(request.headers.get('content-length') || 0);
  if (len > PROXY_CONSTS.BODY_CAP) return json({ ok: false, reason: '请求体超限' }, 413, corsHeaders(env));
  let report;
  try {
    const body = await request.text();
    if (body.length > PROXY_CONSTS.BODY_CAP) return json({ ok: false, reason: '请求体超限' }, 413, corsHeaders(env));
    report = JSON.parse(body);
  } catch {
    return json({ ok: false, reason: '请求体不是合法 JSON' }, 400, corsHeaders(env));
  }
  if (!PROXY_CONSTS.REPORT_TYPES.includes(report?.report_type) || typeof report?.payload !== 'object' || !report.payload) {
    return json({ ok: false, reason: '报告信封不合法（report_type/payload 缺失）' }, 400, corsHeaders(env));
  }

  const rawWebhook = env?.OPS_WEBHOOK;
  // secret 值清洗（2026-10-10 BOM 踩坑根治）：零宽/首尾控制剥除——轻度污染自愈；
  //   raw 非空但清洗后非法（重度污染/非 https）→ 502 明确报错，不静默跳过。
  const url = rawWebhook ? sanitizeWebhookUrl(rawWebhook) : null;
  if (!rawWebhook) return json({ ok: true, pushed: false, reason: '未配置 OPS_WEBHOOK，仅校验通过' }, 200, corsHeaders(env));
  if (!url) return json({ ok: false, pushed: false, reason: 'OPS_WEBHOOK 值非法（不可见字符清洗后仍不合法）——用 scripts/set_ops_webhook.mjs 码位验证后重写' }, 502, corsHeaders(env));
  const fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) return json({ ok: false, reason: '当前环境无 fetch' }, 500, corsHeaders(env));

  const kv = env?.PUSH_STATE ?? null;
  // 补推调度（ctx.waitUntil · 2026-10-10 通道加固）：上一轮重试耗尽落盘的失败
  //   推送，本轮任意请求顺带补投——不 await，补推绝不阻塞本次推送；无 ctx
  //   （本地直调/旧测试）→ 跳过不炸。
  if (kv && ctx?.waitUntil) {
    try { ctx.waitUntil(replayFailedPushes(env, { fetchImpl, sleepImpl }).catch(() => {})); } catch { /* waitUntil 抛错不挡主流程 */ }
  }
  const fp = proxyFingerprint(report);
  const urgent = report?.trigger && report.trigger !== 'schedule'; // 决议 3：urgent 免指纹直达
  const fpKey = `fp:${fp}`;
  const dayKey = bjDayKey(now);
  if (!urgent && kv) {
    try { if (await kv.get(fpKey)) return json({ ok: true, pushed: false, reason: '同内容 30 天内已推过（指纹去重）', fingerprint: fp }, 200, corsHeaders(env)); } catch { /* KV 故障不拦推送 */ }
  }
  if (kv) {
    try {
      const used = Number(await kv.get(dayKey)) || 0;
      if (used >= PROXY_CONSTS.DAILY_CAP) return json({ ok: false, reason: `已达每日上限 ${PROXY_CONSTS.DAILY_CAP} 条` }, 429, corsHeaders(env));
    } catch { /* KV 故障不拦推送 */ }
  }

  // 指数退避重试（2s → 4s → 8s · 2026-10-10 通道加固）：瞬时 5xx / 网络抖动 /
  //   企微系统繁忙（errcode -1）就地自愈；白名单外（4xx / 93xxx）零重试。
  //   终态失败一律 failed_pushes 落盘（TTL 7 天）——下次任意推送请求经
  //   ctx.waitUntil 自动补推，重试耗尽不丢消息；指纹照旧不记（同内容可重推）。
  const sent = await sendWithRetry(fetchFn, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: renderPushText(report) } }),
  }, { sleepImpl });
  if (sent.ok) {
    if (kv) {
      try {
        if (!urgent) await kv.put(fpKey, now.toISOString(), { expirationTtl: PROXY_CONSTS.DEDUP_TTL_S });
        const used = (Number(await kv.get(dayKey)) || 0) + 1;
        await kv.put(dayKey, String(used), { expirationTtl: 86400 });
        // 直推成功顺手清 failed 残账（防后台补推把同内容再送一遍进群）
        try { await kv.delete(`failed:${fp}`); } catch { /* 清账失败不挡主流程，补推侧有 fp 去重兜底 */ }
      } catch { /* 记账失败不影响已完成的推送 */ }
    }
    return json({ ok: true, pushed: true, fingerprint: fp, urgent, attempts: sent.attempts }, 200, corsHeaders(env));
  }
  const failReason = sent.wechat?.errcode !== undefined && sent.wechat.errcode !== 0
    ? `企微拒收 errcode ${sent.wechat.errcode}: ${sent.wechat.errmsg || '无 errmsg'}`
    : sent.threw ? `网络异常: ${sent.threw?.message || sent.threw}`
      : `webhook HTTP ${sent.res?.status}`;
  if (kv) {
    try {
      await kv.put(`failed:${fp}`, JSON.stringify({
        failedAt: now.toISOString(), attempts: sent.attempts, retryable: sent.retryable, reason: failReason, report,
      }), { expirationTtl: RETRY_CONSTS.FAILED_TTL_S });
    } catch {
      return json({ ok: false, pushed: false, reason: `${failReason}（重试 ${Math.max(0, sent.attempts - 1)} 次耗尽；⚠ failed_pushes 落盘亦失败，本次消息丢失）`, fingerprint: fp }, 502, corsHeaders(env));
    }
  }
  return json({ ok: false, pushed: false, reason: `${failReason}（重试 ${Math.max(0, sent.attempts - 1)} 次耗尽，已落 failed_pushes，下次推送自动补推）`, fingerprint: fp }, 502, corsHeaders(env));
}
