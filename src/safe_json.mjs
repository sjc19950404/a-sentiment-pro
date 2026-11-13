// 对齐 fetch_announcements.parseEM 的容错规范（2026-11-14）。
// 东财/LLM 在封禁或限流时返回 HTML 错误页而非 JSON，res.json() 会直接 reject 冒泡，
//   击穿下游结构校验、把「第三方接口异常」变成整条采集脚本崩溃。
// 统一改为 res.text() + JSON.parse 包 try/catch → fail-open 返回 fallback（默认 {}），
//   与 fetch_announcements「解析失败返回 {}」语义一致，错误被下游 !Array/!ok 分支自然兜住。
// 用法：const j = await safeJson(res); 或期望数组时 const j = await safeJson(res, []);
// 实现：json() 优先（兼容既有测试 mock 与正常 JSON 响应），失败时降级 res.text()+parse
//   （东财/LLM 封禁或限流时返回 HTML 错误页，res.json() 会直接 reject）→ 仍失败则 fail-open 返回 fallback。
export async function safeJson(res, fallback = {}) {
  try {
    try {
      return await res.json();
    } catch {
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return fallback;
      }
    }
  } catch {
    return fallback;
  }
}
