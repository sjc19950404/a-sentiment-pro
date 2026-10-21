// sources_qd.mjs — 新数据层桥接（2026-10-10 数据层迁移第一阶段）
//
// 盘中六源唯一入口改为 `python market_data.py intraday-raw`（QuantDash 主 + AkShare 兜底
// + BaoStock 历史；eastmoney-probe/push2his/同花顺 getharen/腾讯 qt.gtimg 全部退役）。
// 输出契约与旧 src/sources.js 的 fetchHot/fetchPools/fetchBreadth/fetchHotQuotes/fetchMainNet/
// fetchScreenerTopMainNet 逐字段一致——snapshot_intraday.mjs 的组装/三态校验/落盘逻辑零改动。
//
// 纪律：python 不可用/退出非零 = 整体失败（调用方三态校验按「全失败保留上次快照」处理，
// 与旧版单源独立失败略有差异——新链是单进程多源，进程死即全源死，不冒充部分成功）。
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PY = process.platform === 'win32' ? 'python' : 'python3';

/**
 * 拉取盘中六源（一次 python 进程内完成全部批量请求与降级决策）。
 * @returns {Promise<{hot:Array|null, pools:object|null, breadth:object|null,
 *                     quotes:Object, mainNet:Object, screener:Array|null, meta:object}>}
 * @throws {Error} python 未装依赖 / 进程超时 / 输出损坏——交给调用方整体降级。
 */
export async function fetchIntradayRaw() {
  const r = spawnSync(PY, ['market_data.py', 'intraday-raw'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 96 * 1024 * 1024,
    timeout: 240_000,          // 全市场 8 批 + 三池 + 资金榜，慢网络下限
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  if (r.error) throw new Error(`market_data.py 启动失败（${PY}）: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`market_data.py 退出码 ${r.status}: ${String(r.stderr || '').slice(0, 300)}`);
  }
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (e) {
    throw new Error(`intraday-raw 输出损坏（JSON parse 失败）: ${String(e.message).slice(0, 120)}`);
  }
  if (!j || typeof j !== 'object' || !j.meta) throw new Error('intraday-raw 输出缺 meta 结构');
  return j;
}
