// Lighthouse 自测脚本守卫（2026-11-14）
//
// 用户拍板「以后以树莓派上跑的为准」，故自测结果必须可信。实测发现两类陷阱：
//   ① 低速 4G 模拟下偶发 ERR_CONNECTION_RESET → 页面提前结束 trace →
//      「16~22 请求 / 性能 91~97 / CLS 0 / TBT 0」的虚高样本（看着像巨大改善，实为加载不全）。
//   ② 桌面同配置单次性能分见过 46~91 的跨度，单次噪声足以让「涨 5 分」变成误判。
// 本测试锁住脚本里的样本判废、重跑、中位数、回归门禁四层防线的**存在性与阈值**，
// 防止以后改脚本时把防线悄悄删掉、又拿不可信的分数下结论。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'scripts/lighthouse_selfcheck.mjs'), 'utf8');

test('lh自测: 固定版本与口径，保证前后可比', () => {
  assert.match(src, /const LH_VERSION = '13\.6\.0'/, '必须固定 Lighthouse 版本');
  assert.match(src, /--preset=desktop/, 'desktop 应显式指定 preset');
  assert.match(src, /150ms RTT \/ 1\.6Mbps \/ CPU 4x/, '头部须记录 mobile 节流口径');
  assert.match(src, /40ms RTT \/ 10Mbps \/ CPU 1x/, '头部须记录 desktop 节流口径');
});

test('lh自测: 样本有效性判据能拦住加载不完整的虚高样本', () => {
  assert.match(src, /const MIN_REQUESTS = 28/, '完整加载 35 请求，阈值须足以拦住 16~22 请求的虚高样本');
  assert.match(src, /ERR_CONNECTION_RESET\|ERR_FAILED\|ERR_TIMED_OUT\|ERR_NETWORK/, '必须识别网络重置/超时');
  assert.match(src, /s\.requests\.netErrors > 0/, '有网络错误的样本必须判废');
  assert.match(src, /s\.requests\.total < MIN_REQUESTS/, '请求数不足必须判废');
  assert.match(src, /s\.requests\.r2 < 15/, 'r2 请求过少说明数据档未完整加载');
  assert.match(src, /样本判废：/, '判废时须打印原因，不能静默丢弃');
});

test('lh自测: 判废自动重跑；多次样本取中位数，且只有全有效才写基线', () => {
  assert.match(src, /const MAX_ATTEMPTS = 3/, '判废后须有重跑次数上限');
  assert.match(src, /const RUNS = /, '应支持 --runs 多次采样');
  assert.match(src, /Math\.floor\(\(sorted\.length - 1\) \/ 2\)/, '偶数样本取偏低中位数（避免乐观偏差）');
  assert.match(src, /Object\.keys\(results\)\.length === PRESETS\.length && failures\.length === 0/,
    '只有全部 preset 有效且门禁通过才允许写基线');
});

test('lh自测: 回归门禁锁住本轮修复的不变量', () => {
  assert.match(src, /config\.json 请求 \$\{s\.requests\.configJson\} 次/, 'config.json 请求须为 0');
  assert.match(src, /errors4xx !== 0/, '4xx/5xx 须为 0（R2 漏档守卫）');
  assert.match(src, /r2 < 10/, '改道生效守卫');
  assert.match(src, /!s\.gzip\.ok/, 'R2 gzip 压缩生效守卫');
  assert.match(src, /transferSize < i\.resourceSize \/ 2/, 'gzip 判据须基于线上传输量 vs 解压后体积');
});

test('lh自测: 产物不入库、npm 别名存在', () => {
  const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(gitignore, /^\.lighthouse\//m, '.lighthouse/ 必须 gitignore（完整 JSON 报告不该入库）');
  assert.equal(pkg.scripts.lh, 'node scripts/lighthouse_selfcheck.mjs', 'npm run lh 别名须存在');
  assert.ok(!('lighthouse' in (pkg.devDependencies || {})) && !('lighthouse' in (pkg.dependencies || {})),
    'Lighthouse 走 npx 临时装，不应写进项目依赖（避免污染依赖树）');
});
