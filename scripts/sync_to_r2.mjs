// scripts/sync_to_r2.mjs
// 把本地 ui/kline/ 与聚合侧车档（emotion_history / main_theme_history /
// announcements / paper-account / llm_risk_blacklist）同步到 Cloudflare R2（S3 协议）。
//
// 设计要点：
//   1. 仅同步「Pages 终端走 dataOrigin 的那批文件」——与 push_data_repo.sh 推到 jsDelivr 数据仓的
//      清单完全一致，路径也一致（ui/kline/<code>.json、data/<sidecar>.json），保证前端 durl() 改道
//      R2 后路径对得上。
//   2. 增量：用本地 .r2_sync_manifest.json（size+mtimeMs）比对，仅上传「变化/新增」文件，避免每日
//      重传 163MB/5554 分片（首跑 manifest 为空 → 全量推送）。
//   3. 容错：单文件失败仅记录并继续；缺凭证 / SDK 未装 / 桶连不通 都只告警并 exit 0，
//      绝不抛出 → 不破坏 pi_run.sh 的 EOD 流程。
//   4. 删除本地已不存在的对象需显式开启 R2_DELETE_STALE=true（默认关，避免误删）。
//   5. gzip 预压缩（2026-11-14）：github.io 会自动 gzip，R2 不会——Lighthouse 实测同一档
//      archive-recent 264KB / version-regression 195KB / seat_labels 89KB 在 R2 是 github.io
//      的 5.7~10.8 倍，改道后总网络负载 916→1470 KiB、关键路径 29.2→34.4s、性能 65→46。
//      故上传时把文本档预压缩成 gzip 对象 + ContentEncoding:'gzip'；浏览器带
//      Accept-Encoding:gzip 时 R2 返回 84B 压缩体（fetch 自动解压），不带/identity 时
//      R2 自动返回明文（实测 20027B 且无 CE 头）——向后兼容，旧客户端不会拿到乱码。
//
// 用法：node scripts/sync_to_r2.mjs [--force]   （仓库根执行；读 .env 的 R2_* 变量）

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pushOpsAlerts } from '../src/opsalerts.js';   // 复用项目统一企微告警通道（#7/#15）

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const MANIFEST = join(ROOT, '.r2_sync_manifest.json');

// ── 轻量 .env 加载（与 src/loadenv.js 同思路，避免引入 dotenv 依赖）──
function loadEnv(p = join(ROOT, '.env')) {
  try {
    const txt = readFileSync(p, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const k = m[1];
      const v = m[2].replace(/^["']|["']$/g, '');
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch { /* .env 不存在则仅靠环境变量 */ }
}
loadEnv();

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
const FORCE = process.argv.includes('--force');
const DELETE_STALE = process.env.R2_DELETE_STALE === 'true';

const CT = {
  '.json': 'application/json', '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.txt': 'text/plain', '.csv': 'text/csv',
};
const contentType = (p) => CT[extname(p).toLowerCase()] || 'application/octet-stream';

// 仅对 CT 里的文本档压缩（二进制/已压缩格式不碰）；太小（<1KB）压缩无收益，跳过以免
// gzip 头开销反而变大。R2 会按 Accept-Encoding 协商：带 gzip 返回压缩体，不带返回明文。
const GZIP_MIN_BYTES = 1024;
const ENC_VERSION = 'gzip-1';   // manifest 编码版本：变更时强制全量重传（避免存量对象编码不一致）
const shouldGzip = (p, size) => size >= GZIP_MIN_BYTES && Object.hasOwn(CT, extname(p).toLowerCase());
const encodeBody = (p, buf) => {
  if (!shouldGzip(p, buf.length)) return { Body: buf, ContentEncoding: undefined };
  const gz = gzipSync(buf, { level: 9 });
  // 极端情况（已是高熵数据）压缩反而更大：回退原样，不写 CE 头
  if (gz.length >= buf.length) return { Body: buf, ContentEncoding: undefined };
  return { Body: gz, ContentEncoding: 'gzip' };
};

// 待同步源（相对仓库根）——与 push_data_repo.sh 推送清单一致
const SRC_DIRS = ['ui/kline'];
const SRC_FILES = [
  'data/emotion_history.json',
  'data/main_theme_history.json',
  'data/announcements-latest.json',
  'data/paper/account.json',
  'data/llm_risk_blacklist.json',
  // 2026-11-14 补漏：durl() 改道全面生效后，这三档在 R2 上 404（返回 text/html 错误页），
  //   Lighthouse 控制台抓到 3 条 404 → 最佳做法 100→96，且标的池/双轨账本前端缺数据。
  //   本地都有文件，但漏在清单外；test/r2_sync.test.mjs 已加守卫防再次漏档。
  'data/paper_universe.json',
  'data/paper_universe-lite.json',
  'data/paper/dual_track_latest.json',
  // 2026-11-14：前端研究工作台首屏/各面板实际会拉的全部 data/*（含重档），统一改道 R2 以绕开 github.io 慢链。
  //   首屏真正加载的（app.js 376KB 缓存后次要）多为小档，但 market_context_history/board_rank/ztpool_history 等
  //   也可能经动态路径加载，全部同步进 R2 可保证 durl() 改道后零 404。
  'data/market_context_history.json',
  'data/board_rank.json',
  'data/ztpool_history.json',
  'data/crosscheck-latest.json',
  'data/risk_budget_preview.json',
  'data/theme_graph.json',
  'data/first_board_live.json',
  'data/first_board_watch.json',
  'data/breadth-latest.json',
  'data/etf_hedge_signal.json',
  'data/reco_picks_latest.json',
  'data/global.json',
  'data/signals-latest.json',
  'data/factor_health_history.json',
  'data/backtest.json',
  'data/backtest-strategies.json',
  'data/version-regression.json',
  'data/intraday.json',
  'data/seat_labels_compact.json',
  'data/ann_risk_scan.json',
  // 2026-11-09 B2（用户拍板）：时序归档移出 git，云端留存走 R2（约 25MB/日，增量按 size+mtime）
  'data/archive.json',
  'data/archive-2025.json',
  'data/archive-2026.json',
  'data/archive-recent.json',
  'data/archive-index.json',
];

function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rp = join(dir, e.name);
    if (e.isDirectory()) walk(rp, out);
    else if (e.isFile()) out.push(rp);
  }
  return out;
}

function collectSources() {
  const files = [];
  for (const d of SRC_DIRS) files.push(...walk(d));
  for (const f of SRC_FILES) if (existsSync(join(ROOT, f))) files.push(f);
  return [...new Set(files)];
}

function loadManifest() {
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
}
function saveManifest(m) {
  try { writeFileSync(MANIFEST, JSON.stringify(m)); } catch { /* 不致命 */ }
}

function finish(code) { process.exit(code); }

async function main() {
  console.log(`[r2] 同步启动 · bucket=${BUCKET} · account=${ACCOUNT_ID ? ACCOUNT_ID.slice(0, 8) + '…' : '(空)'} · force=${FORCE} · deleteStale=${DELETE_STALE}`);

  if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET) {
    console.warn('[r2] 缺少 R2_* 环境变量（ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET_NAME），跳过同步（best-effort）。');
    return finish(0);
  }

  // 动态加载 SDK：未安装时优雅跳过，不崩 EOD
  let S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand;
  try {
    const s3mod = await import('@aws-sdk/client-s3');
    S3Client = s3mod.S3Client;
    PutObjectCommand = s3mod.PutObjectCommand;
    ListObjectsV2Command = s3mod.ListObjectsV2Command;
    DeleteObjectsCommand = s3mod.DeleteObjectsCommand;
  } catch (e) {
    console.warn('[r2] 未能加载 @aws-sdk/client-s3（未安装？请 npm install @aws-sdk/client-s3），跳过同步。', e.message);
    return finish(0);
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    forcePathStyle: true, // R2 自定义端点用 path-style
  });

  // 连通性 / 凭证校验：列一个对象即可，失败则 best-effort 跳过
  try {
    await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
  } catch (e) {
    console.warn('[r2] 桶连接失败（凭证/桶名/网络/CORS），跳过同步：', e.message);
    return finish(0);
  }

  const sources = collectSources();
  console.log(`[r2] 本地待同步文件：${sources.length} 个`);
  const manifest = loadManifest();
  const toUpload = [];
  let skipped = 0;
  for (const rp of sources) {
    const st = statSync(join(ROOT, rp));
    const prev = manifest[rp];
    const mtime = Math.floor(st.mtimeMs);
    // enc 不匹配也必须重传：存量对象是未压缩的（ENC_VERSION 之前），若不强制刷新则
    // size+mtime 一致会被跳过，R2 上永远留着未压缩的大档，压缩改动形同没做。
    if (!FORCE && prev && prev.size === st.size && prev.mtimeMs === mtime && prev.enc === ENC_VERSION) skipped++;
    else toUpload.push({ rp, size: st.size, mtimeMs: mtime });
  }

  let ok = 0, fail = 0, bytes = 0;
  const failed = [];
  const CONC = Math.max(1, Number(process.env.R2_CONCURRENCY || 16));
  let idx = 0;
  async function worker() {
    while (idx < toUpload.length) {
      const item = toUpload[idx++];
      try {
        const body = readFileSync(join(ROOT, item.rp));
        const { Body, ContentEncoding } = encodeBody(item.rp, body);
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET, Key: item.rp, Body,
          ContentType: contentType(item.rp), CacheControl: 'public, max-age=300',
          ...(ContentEncoding ? { ContentEncoding } : {}),
        }));
        manifest[item.rp] = { size: item.size, mtimeMs: item.mtimeMs, enc: ENC_VERSION };
        ok++; bytes += Body.length;
        if (toUpload.length < 50 || ok % 200 === 0) console.log(`[r2] 进度 ${ok}/${toUpload.length} · 失败 ${fail}`);
      } catch (e) {
        fail++;
        if (failed.length < 50) failed.push(`${item.rp}: ${e.message}`);
        console.warn(`[r2] 上传失败 ${item.rp}: ${e.message}`);
        delete manifest[item.rp];   // #7 显式标为未完成 → 下个周期自动重试（避免被旧条目误判已传而永久跳过）
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, Math.max(toUpload.length, 1)) }, worker));

  // 本地已不存在的对象：默认仅清理 manifest 元数据；R2_DELETE_STALE=true 才真正删桶内对象
  const localSet = new Set(sources);
  const stale = Object.keys(manifest).filter((k) => !localSet.has(k));
  if (DELETE_STALE && stale.length) {
    for (let i = 0; i < stale.length; i += 1000) {
      const batch = stale.slice(i, i + 1000).map((Key) => ({ Key }));
      try { await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: batch } })); }
      catch (e) { console.warn('[r2] 批量删除失败:', e.message); }
    }
    console.log(`[r2] 删除过期对象 ${stale.length} 个`);
  }
  for (const k of stale) delete manifest[k];

  saveManifest(manifest);
  // bytes 是压缩后实际上传字节（encodeBody 之后的 Body.length），不是本地源文件体积。
  console.log(`[r2] 完成 · 上传 ${ok} · 跳过(未变) ${skipped} · 失败 ${fail} · 上传字节(gzip后) ${(bytes / 1e6).toFixed(1)}MB · 本地共 ${sources.length}`);
  if (failed.length) console.warn(`[r2] 失败明细(前20):\n  ` + failed.slice(0, 20).join('\n  '));
  if (PUBLIC_URL && toUpload.length) console.log(`[r2] 公共地址示例：${PUBLIC_URL}/${encodeURI(toUpload[0].rp)}`);
  // #7/#15：同步不完整 → 非静默 exit(0)。发企微告警 + 非零退出（pi_run.sh 已用 || log 容错，不阻断 EOD）。
  if (fail > 0) {
    const detail = `R2 同步有 ${fail} 个文件上传失败（本批待传 ${toUpload.length}）。失败项已在 manifest 标为未完成，下个周期自动重试。\n失败明细(前20):\n` + failed.slice(0, 20).join('\n');
    console.error(`[r2] ❌ 同步不完整：失败 ${fail} 个文件，已发企微告警，退出码 1（pi_run.sh 已容错）`);
    try {
      const r = await pushOpsAlerts([{ severity: 'error', kind: 'r2-sync-failed', source: 'r2', detail }]);
      if (r && r.error) console.error('[r2] 告警推送失败：', r.error);
    } catch (e) { console.error('[r2] 告警推送异常：', e?.message || e); }
    return finish(1);
  }
  return finish(0);
}

main().catch((e) => {
  console.warn('[r2] 未预期异常（best-effort，不报错退出）：', (e && e.stack) || e);
  process.exit(0);
});
