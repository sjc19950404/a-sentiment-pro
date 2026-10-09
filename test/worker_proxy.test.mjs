// ══ Cloudflare Worker 推送代理（worker/push_proxy.js + worker/index.js）════
//
// 覆盖：① 路由（healthz/404/OPTIONS 预检）；② 无 webhook 静默跳过；
//   ③ 成功推送记 KV（指纹 + 日计数）；④ 同内容 30 天去重；⑤ urgent（决议 3）
//   免指纹直达；⑥ 来源闸（ALLOWED_ORIGIN）；⑦ 请求体校验（方法/JSON/类型/超限）；
//   ⑧ 每日上限；⑨ webhook 失败不记指纹（自愈语义）；⑩ 企微静默丢包判据
//   （HTTP 200 + errcode≠0 → 拒收不记指纹不计数，2026-10-09 线上真实踩坑补齐）。
// 全部用 Node 18+ 原生 Request/Response（与 Workers 同构），Mock KV/fetch——
//   零网络零磁盘，CI 与本地 node --test 直跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {
  handlePush, handleHealth, proxyFingerprint, PROXY_CONSTS,
  sendWithRetry, replayFailedPushes, isRetryable, RETRY_CONSTS,
} from '../worker/push_proxy.js';
import { renderPushText, PUSH_CONSTS } from '../src/push_text.js';

// ── 夹具 ─────────────────────────────────────────────────────────────
const NOW = new Date('2026-10-07T12:00:00.000Z');
const mkReport = (over = {}) => ({
  report_type: 'intraday', trigger: 'schedule', urgent: false, date: '2026-10-08',
  generated_at: '2026-10-08T02:01:00.000Z', status: 'ok',
  payload: { pnl_daily: 0.001, pnl_cumulative: -0.015, drawdown_vs_threshold: { dd_now: 0.05, distance_pp: 3.2, basis: '即时轨' }, overseas: [{ key: 'a50', chgPct: 0.002 }] },
  missing_notes: [],
  ...over,
});
const mkKV = () => {
  const m = new Map();
  return {
    m,
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name })) }),
  };
};
const mkFetch = (ok = true, wechatBody = null) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok, status: ok ? 200 : 500, ...(wechatBody ? { json: async () => wechatBody } : {}) };
  };
  return { calls, fn };
};
const post = (body, { origin, env = {} } = {}) => new Request('http://w/push', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

// ── 1. 路由（经 worker/index.js 默认导出，不 mock 任何运行时）──────────
test('路由：healthz / OPTIONS 预检 / 未知路径 404', async () => {
  const h = await worker.fetch(new Request('http://w/healthz'), {});
  assert.equal(h.status, 200);
  assert.equal((await h.json()).ok, true);
  const pre = await worker.fetch(new Request('http://w/push', { method: 'OPTIONS' }), {});
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  const nf = await worker.fetch(new Request('http://w/nope'), {});
  assert.equal(nf.status, 404);
});

// ── 2. 无 webhook → 静默跳过（与 CI 同纪律，本地零打扰）────────────────
test('无 OPS_WEBHOOK → 200 + pushed:false，不碰 KV 与网络', async () => {
  const kv = mkKV(); const f = mkFetch();
  const r = await handlePush(post(mkReport()), { PUSH_STATE: kv }, { now: NOW, fetchImpl: f.fn });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.pushed, false);
  assert.match(body.reason, /未配置 OPS_WEBHOOK/);
  assert.equal(f.calls.length, 0);
  assert.equal(kv.m.size, 0);
});

// ── 2b. sanitizeWebhookUrl：BOM/零宽清洗（2026-10-10 线上真实踩坑根治）─────
test('sanitizeWebhookUrl：剥 BOM/零宽/首尾控制；内部控制/非 https 拒绝', async () => {
  const { sanitizeWebhookUrl } = await import('../src/push_text.js');
  const GOOD = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k';
  // 线上事故原样：两个 U+FEFF 前缀 → 清洗后恢复可用
  assert.equal(sanitizeWebhookUrl(`\uFEFF\uFEFF${GOOD}`), GOOD);
  assert.equal(sanitizeWebhookUrl(`\u200B\u200C${GOOD}\u200D\uFEFF`), GOOD);
  assert.equal(sanitizeWebhookUrl(`  \n\t${GOOD}\r\n `), GOOD);
  assert.equal(sanitizeWebhookUrl(GOOD), GOOD);
  // 非法：非字符串/空/非 https/内部控制字符（重度污染不静默修）
  assert.equal(sanitizeWebhookUrl(undefined), null);
  assert.equal(sanitizeWebhookUrl(''), null);
  assert.equal(sanitizeWebhookUrl(`http://${GOOD.slice(8)}`), null);
  assert.equal(sanitizeWebhookUrl(`https://a\u0001b.c`), null);
});

// ── 2c. BOM 污染的 secret 自愈：Worker 收到的 URL 是干净的（事故回归）─────
test('OPS_WEBHOOK 带 BOM/零宽污染 → 清洗自愈推送，fetch 收到干净 URL', async () => {
  const kv = mkKV(); const f = mkFetch();
  const r = await handlePush(post(mkReport()), { OPS_WEBHOOK: `\uFEFF\uFEFFhttps://wecom/example\u200B`, PUSH_STATE: kv }, { now: NOW, fetchImpl: f.fn });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.pushed, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://wecom/example', 'fetch 必须收到清洗后的 URL（BOM 已剥）');
});

// ── 2d. 重度污染不静默：非 https/内部脏 → 502 明确报错，不 fetch 不记指纹 ───
test('OPS_WEBHOOK 清洗后仍非法 → 502 值非法报错（不降级为静默跳过）', async () => {
  const kv = mkKV(); const f = mkFetch();
  const r = await handlePush(post(mkReport()), { OPS_WEBHOOK: '\u0001http://not-https.example', PUSH_STATE: kv }, { now: NOW, fetchImpl: f.fn });
  const body = await r.json();
  assert.equal(r.status, 502);
  assert.equal(body.pushed, false);
  assert.match(body.reason, /OPS_WEBHOOK 值非法/);
  assert.equal(f.calls.length, 0, '不 fetch');
  assert.equal(kv.m.size, 0, '不记指纹');
});


// ── 3. 成功推送：文案经 renderPushText、KV 记指纹 + 日计数 ─────────────
test('成功推送：msgtype=text + renderPushText 文案；KV 记 fp 与 day 计数', async () => {
  const kv = mkKV(); const f = mkFetch();
  const report = mkReport();
  const r = await handlePush(post(report), { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv }, { now: NOW, fetchImpl: f.fn });
  const body = await r.json();
  assert.equal(body.pushed, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://wecom/example');
  const sent = JSON.parse(f.calls[0].init.body);
  assert.equal(sent.msgtype, 'text');
  assert.equal(sent.text.content, renderPushText(report), '文案必须与 Node 侧渲染逐字一致（同一渲染层）');
  assert.ok([...kv.m.keys()].some((k) => k.startsWith('fp:')), '指纹已记');
  assert.ok([...kv.m.keys()].some((k) => k.startsWith('day:')), '日计数已记');
});

// ── 4. 同内容去重 / urgent 免指纹（决议 3 对齐）──────────────────────
test('同内容二推被拦；urgent（trigger≠schedule）免指纹直达', async () => {
  const kv = mkKV(); const f = mkFetch();
  const env = { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv };
  await handlePush(post(mkReport()), env, { now: NOW, fetchImpl: f.fn });
  const dup = await handlePush(post(mkReport()), env, { now: NOW, fetchImpl: f.fn });
  assert.equal((await dup.json()).pushed, false, '同内容 30 天内去重');
  assert.equal(f.calls.length, 1);
  // urgent：事件版是另一份报告（trigger 进指纹域）
  const urgent = await handlePush(post(mkReport({ trigger: 'event:circuit_breaker' })), env, { now: NOW, fetchImpl: f.fn });
  assert.equal((await urgent.json()).pushed, true, 'urgent 免指纹直达');
  assert.equal(f.calls.length, 2);
  const urgent2 = await handlePush(post(mkReport({ trigger: 'event:circuit_breaker' })), env, { now: NOW, fetchImpl: f.fn });
  assert.equal((await urgent2.json()).pushed, true, 'urgent 重复触发也直达（事件时效性优先，429/日上限兜底）');
});

// ── 5. 来源闸 ─────────────────────────────────────────────────────────
test('ALLOWED_ORIGIN 配置后：跨源 403 / 同源放行 / 未配置放行', async () => {
  const f = mkFetch();
  const env = { OPS_WEBHOOK: 'https://wecom/example', ALLOWED_ORIGIN: 'https://page.example', PUSH_STATE: mkKV() };
  const bad = await handlePush(post(mkReport(), { origin: 'https://evil.example' }), env, { now: NOW, fetchImpl: f.fn });
  assert.equal(bad.status, 403);
  const good = await handlePush(post(mkReport(), { origin: 'https://page.example' }), env, { now: NOW, fetchImpl: f.fn });
  assert.equal((await good.json()).pushed, true);
  const noGate = await handlePush(post(mkReport()), { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: mkKV() }, { now: NOW, fetchImpl: f.fn });
  assert.equal((await noGate.json()).pushed, true, '未配置来源闸（本地 dev）放行');
});

// ── 6. 请求体校验 ────────────────────────────────────────────────────
test('请求体校验：GET 405 / 坏 JSON 400 / 类型不合法 400 / 超限 413', async () => {
  const env = { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: mkKV() };
  const f = mkFetch();
  assert.equal((await handlePush(new Request('http://w/push'), env, { now: NOW, fetchImpl: f.fn })).status, 405);
  assert.equal((await handlePush(post('{bad'), env, { now: NOW, fetchImpl: f.fn })).status, 400);
  assert.equal((await handlePush(post({ report_type: 'webhook_spam', payload: {} }), env, { now: NOW, fetchImpl: f.fn })).status, 400);
  const big = { ...mkReport(), payload: { ...mkReport().payload, junk: 'x'.repeat(PROXY_CONSTS.BODY_CAP) } };
  assert.equal((await handlePush(post(big), env, { now: NOW, fetchImpl: f.fn })).status, 413);
});

// ── 7. 每日上限 / webhook 失败自愈 ────────────────────────────────────
test('每日上限 429；webhook 失败 502 且不记指纹（重试自愈）', async () => {
  const dayKey = `day:${new Date(NOW.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)}`;
  const kv = mkKV(); kv.m.set(dayKey, String(PROXY_CONSTS.DAILY_CAP));
  const capped = await handlePush(post(mkReport()), { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv }, { now: NOW, fetchImpl: mkFetch().fn });
  assert.equal(capped.status, 429);
  const kv2 = mkKV(); const bad = mkFetch(false);
  const fail = await handlePush(post(mkReport()), { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv2 }, { now: NOW, fetchImpl: bad.fn, sleepImpl: async () => {} });
  assert.equal(fail.status, 502);
  assert.equal(bad.calls.length, 4, '首发 + 3 次退避重试（2s→4s→8s 注入假 sleep）');
  assert.ok(![...kv2.m.keys()].some((k) => k.startsWith('fp:')), '失败不记指纹');
  assert.ok([...kv2.m.keys()].some((k) => k.startsWith('failed:')), '重试耗尽 → failed_pushes 落盘（不丢消息）');
  const retry = await handlePush(post(mkReport()), { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv2 }, { now: NOW, fetchImpl: mkFetch(true).fn });
  assert.equal((await retry.json()).pushed, true, '重试同内容照推（自愈）');
});

// ── 8. 指纹稳定性 ────────────────────────────────────────────────────
test('proxyFingerprint：易变字段剔除（generated_at 不影响）/ 内容变化必换', () => {
  const a = mkReport();
  assert.equal(proxyFingerprint(a), proxyFingerprint({ ...a, generated_at: '2027-01-01T00:00:00Z', generated_by: 'x' }));
  assert.notEqual(proxyFingerprint(a), proxyFingerprint({ ...a, trigger: 'event:circuit_breaker' }));
  assert.notEqual(proxyFingerprint(a), proxyFingerprint(mkReport({ payload: { ...a.payload, pnl_daily: 0.009 } })));
});

// ── 9. 三端渲染一致性（Worker 侧 import 的就是同一纯模块）────────────
test('渲染层三端同源：push_text.js 与 ai_report_push.js re-export 是同一函数对象', async () => {
  const nodeSide = await import('../src/ai_report_push.js');
  assert.strictEqual(nodeSide.renderPushText, renderPushText, 'Node 侧 re-export 即 Worker 侧直取');
  assert.strictEqual(nodeSide.PUSH_CONSTS, PUSH_CONSTS);
  assert.equal(handleHealth().status, 200);
});

// ── 10. 企微静默丢包判据（HTTP 200 + errcode≠0 → 拒收；2026-10-09 线上踩坑）──
test('HTTP 200 + errcode 93000 → pushed:false + 502，不记 KV 指纹不计日配额（换 key 后同内容可重推）', async () => {
  const kv = mkKV();
  const env = { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv };
  const f = mkFetch(true, { errcode: 93000, errmsg: 'invalid webhook url' });
  const r = await handlePush(post(mkReport()), env, { now: NOW, fetchImpl: f.fn });
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.pushed, false, '企微拒收不算送达');
  assert.match(body.reason, /errcode 93000/);
  assert.match(body.reason, /invalid webhook url/);
  assert.ok(![...kv.m.keys()].some((k) => k.startsWith('fp:')), '拒收不记指纹');
  assert.ok(![...kv.m.keys()].some((k) => k.startsWith('day:')), '拒收不计日配额');
  // 换 key 后（errcode 0）同内容重推 → 送达并补记指纹（自愈语义）
  const f2 = mkFetch(true, { errcode: 0, errmsg: 'ok' });
  const retry = await handlePush(post(mkReport()), env, { now: NOW, fetchImpl: f2.fn });
  assert.equal((await retry.json()).pushed, true, 'errcode 0 → 送达，同内容可重推');
  assert.ok([...kv.m.keys()].some((k) => k.startsWith('fp:')), '送达后补记指纹');
});

test('HTTP 200 + errcode 0（显式成功响应体）→ 正常送达', async () => {
  const kv = mkKV();
  const f = mkFetch(true, { errcode: 0, errmsg: 'ok' });
  const r = await handlePush(post(mkReport()), { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv }, { now: NOW, fetchImpl: f.fn });
  const body = await r.json();
  assert.equal(body.pushed, true);
  assert.ok([...kv.m.keys()].some((k) => k.startsWith('fp:')), '成功记指纹');
});

// ── 11. 通道加固（2026-10-10 用户指令第二轮）：指数退避 + failed_pushes 补推 ──
test('sendWithRetry：瞬时 5xx×2 → 第 3 次自愈；退避序列 2s→4s（白名单内）', async () => {
  const sleeps = [];
  const seq = [500, 500, 200];
  const fn = async () => { const s = seq.shift(); return { ok: s === 200, status: s }; };
  const r = await sendWithRetry(fn, 'https://x.test', {}, { sleepImpl: async (ms) => sleeps.push(ms) });
  assert.equal(r.ok, true, '瞬时 5xx 重试可自愈');
  assert.equal(r.attempts, 3);
  assert.deepEqual(sleeps, [2000, 4000], '指数退避 2s → 4s（第 3 次成功不再睡 8s）');
});

test('isRetryable 白名单：4xx/93xxx 永久不重试（零无效消耗）；网络异常/-1/5xx/429 可重试', async () => {
  assert.equal(isRetryable({ httpStatus: 400 }), false);
  assert.equal(isRetryable({ httpStatus: 403 }), false);
  assert.equal(isRetryable({ errcode: 93000 }), false, 'key 失效类重试无效');
  assert.equal(isRetryable({ httpStatus: 500 }), true);
  assert.equal(isRetryable({ httpStatus: 502 }), true);
  assert.equal(isRetryable({ httpStatus: 429 }), true, '限频退避后再试');
  assert.equal(isRetryable({ errcode: -1 }), true, '企微系统繁忙官方建议重试');
  assert.equal(isRetryable({}), true, 'fetch throw（网络异常）按瞬时处理');
  // 白名单外零重试实证：4xx 一次即终
  let n = 0;
  const r = await sendWithRetry(async () => { n += 1; return { ok: false, status: 400 }; }, 'https://x.test', {}, { sleepImpl: async () => {} });
  assert.equal(r.attempts, 1);
  assert.equal(n, 1);
});

test('重试耗尽 → failed_pushes 落盘；replayFailedPushes 恢复后自动补推清账', async () => {
  const kv = mkKV();
  const env = { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv };
  const always500 = async () => ({ ok: false, status: 500 });
  const fail = await handlePush(post(mkReport()), env, { now: NOW, fetchImpl: always500, sleepImpl: async () => {} });
  assert.equal(fail.status, 502);
  const body = await fail.json();
  assert.match(body.reason, /已落 failed_pushes/, '响应如实披露补推安排');
  const failedKey = [...kv.m.keys()].find((k) => k.startsWith('failed:'));
  assert.ok(failedKey, '信封落 KV');
  const entry = JSON.parse(kv.m.get(failedKey));
  assert.equal(entry.report.report_type, 'intraday', '失败信封含完整报告（补推可原样重发）');
  assert.equal(entry.attempts, 4, '首发 + 3 次重试耗尽');
  assert.ok(entry.failedAt && entry.reason, '失败时间与原因入账');
  // 补推：通道恢复 → 后台补投成功、failed 账清
  const f = mkFetch(true);
  const replay = await replayFailedPushes(env, { fetchImpl: f.fn, sleepImpl: async () => {} });
  assert.equal(replay.replayed, 1, '补推成功 1 条');
  assert.equal(f.calls.length, 1, '补推只送失败信封');
  assert.ok(JSON.parse(f.calls[0].init.body).text.content.includes('【AI 盘中'), '补推文案经同一渲染层');
  assert.ok(![...kv.m.keys()].some((k) => k.startsWith('failed:')), '补推成功清账');
});

test('补推防重：失败期间同内容已被直推成功（fp 已记）→ 补推弃单不重复进群', async () => {
  const kv = mkKV();
  const env = { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv };
  const always500 = async () => ({ ok: false, status: 500 });
  await handlePush(post(mkReport()), env, { now: NOW, fetchImpl: always500, sleepImpl: async () => {} });
  // 模拟期间调用方直推成功（记 fp、清 failed 残账——handlePush 成功路径职责）
  const fp = [...kv.m.keys()].find((k) => k.startsWith('failed:')).slice('failed:'.length);
  kv.m.set(`fp:${fp}`, NOW.toISOString());
  const f = mkFetch(true);
  const replay = await replayFailedPushes(env, { fetchImpl: f.fn, sleepImpl: async () => {} });
  assert.equal(replay.replayed, 0, '同指纹已送达 → 不补');
  assert.equal(replay.skippedDup, 1, '弃单计数如实');
  assert.equal(f.calls.length, 0, '未向企微发任何请求');
});

test('handlePush：ctx.waitUntil 调度补推（不阻塞本次）；成功推送顺手清 failed 残账', async () => {
  const kv = mkKV();
  const env = { OPS_WEBHOOK: 'https://wecom/example', PUSH_STATE: kv };
  // 先制造一笔 failed 账
  const always500 = async () => ({ ok: false, status: 500 });
  await handlePush(post(mkReport({ trigger: 'event:circuit_breaker' })), env, { now: NOW, fetchImpl: always500, sleepImpl: async () => {} });
  // 正常请求 + ctx：waitUntil 必须被调用（补推后台调度），主响应即时返回
  let waited = null;
  const ctx = { waitUntil: (p) => { waited = p; } };
  const f = mkFetch(true);
  const r = await handlePush(post(mkReport({ date: '2026-10-09' })), env, { now: NOW, fetchImpl: f.fn, sleepImpl: async () => {}, ctx });
  assert.equal((await r.json()).pushed, true, '主推送不受补推影响');
  assert.ok(waited, 'waitUntil 已调度补推（后台执行）');
  await waited; // 补推消化 failed 账（urgent 信封不走 fp 去重，直接重发）
  assert.ok(![...kv.m.keys()].some((k) => k.startsWith('failed:')), 'failed 账已消化');
});
