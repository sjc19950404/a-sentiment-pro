// 盘中快照兜底源（2026-10-29 加固）：单次抓取任一源（hot/screener/pools/breadth）瞬时失败
// 时，回落「同交易日 + TTL 内」的上次成功快照，避免单源抖动把候选池/盘面整体抹成空白。
//
// 设计要点（与系统既有「宁缺毋假」纪律兼容）：
//   ① 只在「本次该字段为 null」时回落——本次抓到（哪怕更少）一律用本次（更新鲜），不回退；
//   ② 兜底源必须是「同交易日」且「距现在 ≤ ttlMin」——跨交易日或太旧一律不兜底；
//   ③ 兜底后**保留 prev 的真实 capturedAtBJ**（数据真实年龄，不冒充实时），并在
//      dataHealth.fallbackUsed 留痕，供推送如实披露；超出 TTL 则继续走 anyOk 判空。
//   ④ 纯函数、零 IO、零副作用（除就地改 snapshot），便于单测与推送层复用。
const FALLBACK_KEYS = ['hot', 'screener', 'pools', 'breadth'];

export function applySnapshotFallback(snapshot, prev, opts = {}) {
  const ttlMin = opts.ttlMin ?? 60;
  const tradeDate = opts.tradeDate ?? null;
  const nowMs = opts.nowMs ?? Date.now();
  const prevUsable = !!prev
    && prev.tradeDate === tradeDate
    && typeof prev.capturedAt === 'string'
    && Number.isFinite(new Date(prev.capturedAt).getTime())
    && (nowMs - new Date(prev.capturedAt).getTime()) / 60000 <= ttlMin;
  const fallbackUsed = [];
  if (prevUsable && snapshot && typeof snapshot === 'object') {
    for (const k of FALLBACK_KEYS) {
      if (!snapshot[k] && prev[k]) {
        snapshot[k] = prev[k]; // prev[k] 已是落盘时的完整对象（含 rows），直接复用
        fallbackUsed.push(k);
      }
    }
    if (fallbackUsed.length) {
      // 保留真实数据年龄：兜底字段是旧的，capturedAt 不应冒充实时时刻
      snapshot.capturedAt = prev.capturedAt;
      snapshot.capturedAtBJ = prev.capturedAtBJ ?? snapshot.capturedAtBJ;
      if (snapshot.dataHealth && typeof snapshot.dataHealth === 'object') {
        snapshot.dataHealth.fallbackUsed = fallbackUsed;
      }
    }
  }
  return { fallbackUsed, prevUsable };
}

export { FALLBACK_KEYS };
