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
//
// 用法：node scripts/sync_to_r2.mjs [--force]   （仓库根执行；读 .env 的 R2_* 变量）

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// 待同步源（相对仓库根）——与 push_data_repo.sh 推送清单一致
const SRC_DIRS = ['ui/kline'];
const SRC_FILES = [
  'data/emotion_history.json',
  'data/main_theme_history.json',
  'data/announcements-latest.json',
  'data/paper/account.json',
  'data/llm_risk_blacklist.json',
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
    if (!FORCE && prev && prev.size === st.size && prev.mtimeMs === mtime) skipped++;
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
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET, Key: item.rp, Body: body,
          ContentType: contentType(item.rp), CacheControl: 'public, max-age=300',
        }));
        manifest[item.rp] = { size: item.size, mtimeMs: item.mtimeMs };
        ok++; bytes += item.size;
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
  console.log(`[r2] 完成 · 上传 ${ok} · 跳过(未变) ${skipped} · 失败 ${fail} · 字节 ${(bytes / 1e6).toFixed(1)}MB · 本地共 ${sources.length}`);
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
