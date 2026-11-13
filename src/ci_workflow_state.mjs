// workflow 停用判定 + API 可用性分类（2026-11-13 豆包第十二轮，纯函数可单测）
// 起因：上一轮把「state 枚举」当主判据，但没查仓库有无「有意停用」的 workflow——
//   实测 15 个里 14 active + 1 disabled_manually（push-1009-verify）。扫全量必天天误报。
// 白名单：有意停用、不该报警的 workflow（值 = 原因，供日志与注释追溯）。
export const DISABLED_BY_DESIGN = Object.freeze({
  'push-1009-verify': '10-09 一次性验证 workflow，已完成使命，有意手动停用（disabled_manually）',
});

// 全量 state 一次判定：非 active 且不在白名单 → 报警（带 name + 实际 state）；白名单内 → 仅留痕。
export function classifyWorkflows(workflows, whitelist = DISABLED_BY_DESIGN) {
  const list = Array.isArray(workflows) ? workflows : [];
  const unexpected = [];
  const byDesign = [];
  for (const w of list) {
    if (!w || w.state === 'active') continue;
    const state = w.state || '未知';
    if (Object.prototype.hasOwnProperty.call(whitelist, w.name)) {
      byDesign.push({ name: w.name, state, reason: whitelist[w.name] });
    } else {
      unexpected.push({ name: w.name, state });
    }
  }
  return { total: list.length, unexpected, byDesign };
}

// API 三态分类（第四路径）：403/429 且 X-RateLimit-Remaining: 0 = 限流「未知」，
//   既不是正常也不是故障；其余 4xx/5xx = api_error（真故障，需告警）。
// headers 为普通对象（调用方从 fetch Response.headers 转换），保持纯函数可测。
export function classifyApiResponse(status, headers = {}) {
  const remaining = headers['x-ratelimit-remaining'] ?? null;
  const remainingNum = remaining === null ? null : Number(remaining);
  if (status === 403 || status === 429) {
    if (remainingNum === 0) return { code: 'api_unavailable', remaining: 0 };
    return { code: 'api_error', remaining: remainingNum };
  }
  if (status >= 400) return { code: 'api_error', remaining: remainingNum };
  return { code: 'ok', remaining: remainingNum };
}
