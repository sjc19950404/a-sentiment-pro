// 运行时环境自检（2026-11-13）：把「声明」变成「启动时刻的硬约束」。
//
// 事故背景：package.json 已写 engines.node >=22，jsdom@31 的 engines 也要求 ^22.22.2+，
//   但 crontab 无 PATH → 10 条 cron 跑系统 node v20.19.2 → jsdom 加载失败 → 47 个 DOM 测试
//   被静默 skip，短报却显示「0 fail」看起来全绿。声明没被执行时刻校验，等于没有。
// 本模块提供纯函数 checkRuntime（可单测），由每日 CI 体检在启动时刻调用：
//   不满足 → 原因码 runtime_mismatch，硬失败（不把 skip 当成 pass）。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const RUNTIME_CODE = Object.freeze({
  OK: 'runtime_ok',
  MISMATCH: 'runtime_mismatch',
});

/** 解析 major 版本；接受 'v22.23.3' / '22.23.3'。 */
export function majorOf(version) {
  const m = String(version || '').match(/^v?(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 从 engines.node 的 '>=N' / '^N' / 'N' 里取最低 major。 */
export function minMajorOf(range) {
  const m = String(range || '').match(/(?:>=|\^|~|v)?(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * 纯函数：环境是否满足项目声明。
 * @param {{version?: string, enginesRange?: string, jsdomEnginesRange?: string}} input
 * @returns {{ok: boolean, code: string, reason: string, node: string, min: number|null}}
 */
export function checkRuntime(input = {}) {
  const node = input.version || process.version;
  // 只有「未传参」才回退读 package.json；显式传入空值代表声明缺失，必须判不匹配而非静默放行。
  let enginesRange = input.enginesRange;
  if (enginesRange === undefined) {
    try { enginesRange = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines?.node; } catch { enginesRange = null; }
  }
  const min = minMajorOf(enginesRange);
  const major = majorOf(node);
  if (!min || !major) {
    return { ok: false, code: RUNTIME_CODE.MISMATCH, reason: `无法解析运行时版本（node=${node}, engines=${enginesRange}）`, node, min };
  }
  if (major < min) {
    return { ok: false, code: RUNTIME_CODE.MISMATCH, reason: `node ${node} 低于 package.json engines.node ${enginesRange}；依赖可能加载失败并被静默 skip`, node, min };
  }
  return { ok: true, code: RUNTIME_CODE.OK, reason: '', node, min };
}
