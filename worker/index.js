// ── Worker 入口（fetch 路由；scheduled 见 P2 计划）─────────────────────────
// 路由：GET /healthz · POST /push（其余 404）。
//   部署：wrangler deploy（见 wrangler.toml 头注释）；本地：wrangler dev。
import { handlePush, handleHealth, corsHeaders } from './push_proxy.js';

const notFound = () => new Response(JSON.stringify({ ok: false, reason: 'not found' }), {
  status: 404,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

export default {
  // ctx = Workers 执行上下文：waitUntil 供 handlePush 后台补推 failed_pushes
  //   （2026-10-10 通道加固）——补推不阻塞本次推送，主响应即时返回。
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
    if (pathname === '/healthz') return handleHealth();
    if (pathname === '/push' || pathname === '/api/push') return handlePush(request, env, { ctx });
    return notFound();
  },
};
