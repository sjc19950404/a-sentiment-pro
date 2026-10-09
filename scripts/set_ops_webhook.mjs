#!/usr/bin/env node
// ── OPS_WEBHOOK 官方换 key 工具（2026-10-10 BOM 踩坑后固化）──────────────────
//
// 用法：node scripts/set_ops_webhook.mjs <完整webhook_url>
//   值只走 argv（绝不交互/管道读——上次 BOM 事故正是管道写入混入不可见字符）。
//   一条命令写两处：① Cloudflare Worker secret（wrangler，临时文件重定向 stdin）
//   ② GitHub repo secret（libsodium sealed box）。写入前强制码位验证。
//
// 写完自检（工具自动做）：
//   · GET /workers/scripts/{name}/secrets 确认 Worker 侧存在
//   · GET /repos/{owner}/{repo}/actions/secrets 确认 GitHub 侧存在
// 人工终验（工具尾部提示，需手动执行）：
//   · Worker 通道：workflow_dispatch worker-verify（若临时启用了该工具）或群实收
//   · CI 通道：下一轮盘中/盘后 CI 推送日志看 errcode: 0
import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAW = process.argv[2];
if (!RAW) {
  console.error('用法：node scripts/set_ops_webhook.mjs <完整webhook_url>');
  console.error('  例：node scripts/set_ops_webhook.mjs "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx"');
  process.exit(1);
}

// ── 1. 清洗 + 码位验证（消费端同款判据唯一出处：src/push_text.js）──────────
const { sanitizeWebhookUrl } = await import('../src/push_text.js');
const URL_ = sanitizeWebhookUrl(RAW);
if (!URL_) {
  console.error('❌ 值非法：清洗（剥 BOM/零宽/首尾控制）后仍不以 https:// 开头，或含内部控制字符。');
  console.error('   原始值前 8 字节:', Buffer.from(RAW, 'utf8').slice(0, 8).toString('hex'), '首字符码位:', RAW.charCodeAt(0).toString(16));
  process.exit(1);
}
const buf = Buffer.from(URL_, 'utf8');
console.log('✅ 码位验证通过：首 8 字节', buf.slice(0, 8).toString('hex'), '| 首字符', URL_.charCodeAt(0).toString(16), '(应为 68=h) | 长度', buf.length);
if (URL_ !== RAW) console.log('⚠️ 输入含不可见字符，已清洗（清洗前后差', RAW.length - URL_.length, '字符）——建议排查复制来源');
if (!/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[0-9a-f-]{36}$/.test(URL_)) {
  console.error('❌ 非典型企微 webhook 形态（https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<36位>），中止防手滑。');
  process.exit(1);
}
const MASKED = URL_.replace(/key=.{8}.*$/, `key=${URL_.slice(-4)}****`);

// ── 2. Worker secret（临时文件 + shell 重定向 stdin——管道直写是事故源，禁用）──
const TMP = join(tmpdir(), `ops_webhook_${Date.now()}.txt`);
writeFileSync(TMP, URL_ + '\n', { encoding: 'utf8' }); // fs.writeFileSync 无 BOM（Node 不写 BOM）
try {
  // 统一 shell 命令字符串 + <file 重定向（管道直写是 BOM 事故源，此路已验证可靠）
  const res = process.platform === 'win32'
    ? spawnSync(`npx wrangler secret put OPS_WEBHOOK < "${TMP}"`, { shell: 'cmd.exe', encoding: 'utf8' })
    : spawnSync(`npx wrangler secret put OPS_WEBHOOK < "${TMP}"`, { shell: '/bin/sh', encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  console.log(/success|✨|Uploaded/i.test(out) ? `✅ Worker secret 已写入（${MASKED}）` : `⚠️ wrangler 输出需人工确认:\n${out.slice(-400)}`);
} finally {
  if (existsSync(TMP)) unlinkSync(TMP);
}

// ── 3. GitHub repo secret（libsodium sealed box，端到端二进制安全）────────────
const TMP_DEPS = join(tmpdir(), 'sealedbox_deps');
if (!existsSync(join(TMP_DEPS, 'node_modules', 'libsodium-wrappers'))) {
  execSync(`npm install --prefix "${TMP_DEPS}" libsodium-wrappers --no-audit --no-fund --loglevel=error`, { stdio: 'ignore' });
}
const { pathToFileURL } = await import('node:url');
const mod = await import(pathToFileURL(join(TMP_DEPS, 'node_modules', 'libsodium-wrappers', 'dist', 'modules-esm', 'libsodium-wrappers.mjs')).href);
const sodium = mod.default ?? mod;
await sodium.ready;

const cred = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n' }).toString();
const token = (cred.match(/password=(.+)/) || [])[1]?.trim();
const H = { 'Authorization': 'token ' + token, 'User-Agent': 'set-ops-webhook', 'Accept': 'application/vnd.github+json' };
const REPO = 'sjc19950404/a-sentiment-pro';

const pk = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, { headers: H }).then(r => r.json());
if (!pk?.key) { console.error('❌ GitHub public-key 获取失败:', JSON.stringify(pk).slice(0, 200)); process.exit(1); }
const enc = sodium.crypto_box_seal(sodium.from_string(URL_), sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL));
const put = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/OPS_WEBHOOK`, {
  method: 'PUT',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ encrypted_value: sodium.to_base64(enc, sodium.base64_variants.ORIGINAL), key_id: pk.key_id }),
});
console.log(put.status === 201 || put.status === 204 ? `✅ GitHub secret 已写入（${MASKED}）` : `❌ GitHub secret 写入失败: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);

// ── 4. 自检：两侧 secret 存在性 ─────────────────────────────────────────
const cfToml = readFileSync(process.env.APPDATA + '/xdg.config/.wrangler/config/default.toml', 'utf8');
const cfToken = (cfToml.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const ACCOUNT = 'd66df5bb1540326724c0ece3053677af';
const cfSecrets = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/a-sentiment-push/secrets`, {
  headers: { Authorization: 'Bearer ' + cfToken },
}).then(r => r.json()).catch(() => null);
console.log(cfSecrets?.result?.some(s => s.name === 'OPS_WEBHOOK') ? '✅ 自检：Worker 侧 OPS_WEBHOOK 存在' : '⚠️ 自检：Worker 侧确认失败（' + JSON.stringify(cfSecrets?.errors ?? cfSecrets).slice(0, 120) + '）——可能是 token 过期，跑任意 wrangler 命令刷新后重查');

const ghSecrets = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets?per_page=100`, { headers: H }).then(r => r.json()).catch(() => null);
console.log(ghSecrets?.secrets?.some(s => s.name === 'OPS_WEBHOOK') ? '✅ 自检：GitHub 侧 OPS_WEBHOOK 存在' : '⚠️ 自检：GitHub 侧确认失败');

console.log('── 终验提示 ──');
console.log('· Worker 通道：dispatch 临时启用的 worker-verify workflow，或从页面即时轨点「云端推送」看群实收');
console.log('· CI 通道：下一轮盘中/盘后 CI 推送日志看「errcode: 0」');
