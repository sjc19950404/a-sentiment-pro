// schedule 首次触发的机器化验收断言（2026-11-13 豆包复审质疑④）。
// 纯函数：不依赖网络/时间副作用，结果可单测。原因码：
//   pending          未到验收窗口起点（不算失败）
//   no_schedule_run  到点但没有任何 event=schedule 且 created_at>=fromMs 的 run
//   run_failed       有 run 但 conclusion!=success
//   ok               PASS
export function verifySchedule(runs, { nowMs, fromMs, acceptDay, tzOffsetMs = 8 * 3600000 }) {
  const today = new Date(nowMs + tzOffsetMs).toISOString().slice(0, 10);
  if (today < acceptDay) return { result: 'PENDING', code: 'pending' };
  const list = Array.isArray(runs) ? runs : [];
  const hit = list.find((r) => r && r.event === 'schedule' && Date.parse(r.created_at) >= fromMs);
  if (!hit) return { result: 'FAIL', code: 'no_schedule_run' };
  if ((hit.conclusion || hit.status) !== 'success') return { result: 'FAIL', code: 'run_failed', run: hit };
  return { result: 'PASS', code: 'ok', run: hit };
}
