// ★ LLM 侧车输出缓存（2026-11-20 拍板：缓存治根）
// ── 背景 ────────────────────────────────────────────────────────────────────
// 板块雷达同日两次运行输出整个换血（11-19 实录：18:38 版利好 AI/算力/医药 0.3x，
// 21:07 版利好 白酒/食品/CPO 0.7）——根因不是"缺自检"，是**输入不确定**：
// sina-roll 抓取窗口的条数/时点不固定 + LLM 无缓存，同数据日重跑 = 两次不同采样。
// 自检只能给噪声贴标签，噪声还在。修法=以「数据日 + 输入快照哈希」为键落盘缓存：
// 同日同输入直接复读 LLM 结论（可复现），--force 才真重跑。舆情/妖股同理接入
// （输入是档案素材/连板梯队——确定性输入，缓存键同样成立）。
//
// 纪律（军规#1 边界不变）：缓存只让 LLM 输出**可复现**，不改变其"纯参考不进信号"
// 的地位；degraded 档不缓存（失败兜底不可复用，否则失败会被固化）；缓存目录
// data/llm-cache/ 随 data/ 提交（审计可追溯：同日为什么两次输出一致）。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const CACHE_DIR = join(process.cwd(), 'data', 'llm-cache');

/** 稳定哈希：对象键排序后序列化 → sha256 前 10 位（跨运行可复现） */
export function stableHash(input) {
  const canon = JSON.stringify(input, (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
  return createHash('sha256').update(canon).digest('hex').slice(0, 10);
}

const cacheFile = (name, asOfDate, hash) =>
  join(CACHE_DIR, `${name}-${asOfDate}-${hash}.json`);

/** 读缓存：命中且非 degraded 返回 { events, blackTalk, cachedAt, hash }，否则 null */
export function loadCache(name, asOfDate, hash) {
  const f = cacheFile(name, asOfDate, hash);
  if (!existsSync(f)) return null;
  try {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    if (d.degraded) return null;                    // 失败兜底不缓存（不可复用）
    if (d.asOfDate !== asOfDate || d.hash !== hash) return null;
    return d;
  } catch { return null; }
}

/** 写缓存（原子性要求不高：缓存丢了大不了重跑） */
export function saveCache(name, asOfDate, hash, data) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const rec = { kind: 'llm-cache', name, asOfDate, hash, cachedAt: new Date().toISOString(), ...data };
    writeFileSync(cacheFile(name, asOfDate, hash), JSON.stringify(rec, null, 1) + '\n');
  } catch { /* 缓存写失败不阻塞主链 */ }
}

/** 同日异哈希缓存查找（diff 日志用：报告"输入窗口变了"） */
export function findSameDayOther(name, asOfDate, hash) {
  try {
    if (!existsSync(CACHE_DIR)) return null;
    const prefix = `${name}-${asOfDate}-`;
    const other = readdirSync(CACHE_DIR)
      .filter((f) => f.startsWith(prefix) && !f.includes(`-${hash}.json`))
      .sort()
      .pop();
    if (!other) return null;
    const d = JSON.parse(readFileSync(join(CACHE_DIR, other), 'utf8'));
    return { hash: d.hash, cachedAt: d.cachedAt, macro: d.macro ?? null };
  } catch { return null; }
}
