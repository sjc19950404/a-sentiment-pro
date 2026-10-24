// 轻量 .env 加载器（项目无 dotenv 依赖）。
// 仅当变量未设置时填充，幂等、绝不覆盖已有 env —— 因此 standalone 运行与 EOD 流水线都安全。
// 解决：直接 `node scripts/xxx.mjs` 或 EOD 未导出 .env 时，LLM_API_* 缺失导致真实模式退出非 0。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadEnv(path = '.env') {
  const root = new URL('../', import.meta.url); // 项目根（src/ 上一级）
  const url = (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path))
    ? new URL('file://' + path)
    : new URL(path, root);
  if (!existsSync(url)) return false;
  try {
    const txt = readFileSync(url, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const k = m[1];
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
    return true;
  } catch { return false; }
}
