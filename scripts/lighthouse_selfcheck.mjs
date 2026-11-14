#!/usr/bin/env node
// scripts/lighthouse_selfcheck.mjs
//
// 无 GUI 环境下的 Lighthouse 自测（树莓派 5 / Debian aarch64 + 无头 Chromium）。
// 与 Chrome DevTools 的 Lighthouse 面板是同一个引擎，只是走 CLI；不需要显示器。
//
// 口径纪律（重要）：
//   · 固定 Lighthouse 13.6.0 + CLI 标准 preset，保证前后可比：
//       desktop = 40ms RTT / 10Mbps / CPU 1x / 1350x940
//       mobile  = 150ms RTT / 1.6Mbps / CPU 4x / Moto G Power
//   · 用户 DevTools 用的是「自定义节流」+ Chromium 157 + 不同主机，绝对值**不可比**；
//     本工具只用于「同一配置下的前后变化」与「请求/字节/状态码等结构化事实」。
//   · 2026-11-14 用户拍板：以后以本自测为准，不再依赖上传的 PDF 报告。
//
// 用法（仓库根执行）：
//   npm run lh                                  # desktop + mobile，与基线对比
//   npm run lh -- --save-baseline              # 跑完把本次结果存为新基线
//   npm run lh -- --preset=desktop             # 只跑桌面
//   npm run lh -- --url=https://...            # 换目标地址
//   npm run lh -- --runs=3 --save-baseline     # 建基线推荐：3 次有效样本取中位数，压单次噪声
//
// 稳定性纪律（2026-11-14 实测）：低速 4G 模拟下偶发 ERR_CONNECTION_RESET 会让页面
// 在数据全部到达前结束 trace，出现「16~22 请求 / 性能 91~97 / CLS 0 / TBT 0」的虚高样本；
// 桌面单次性能分也见过 46~91 的跨度。故：① 样本有效性判据（请求数/网络错误/r2 数）
// 判废并自动重跑；② 基线建议 --runs=3 取中位数；③ 不要用单次分数差 <5 分下结论。
//
// 产物（.lighthouse/ 已 gitignore，不入库）：
//   .lighthouse/baseline.json                  # 对比基线
//   .lighthouse/<preset>-latest.json          # 最近一次完整 Lighthouse JSON
//   .lighthouse/<preset>-<timestamp>.json     # 历史归档
//
// 回归门禁（不变量，任一不满足 → exit 1）：
//   config.json 请求 0（构建期同步内联）、4xx/5xx 0（R2 漏档已补）、
//   至少 10 个请求走 r2.dev（改道生效）、至少一个大档 transferSize < resourceSize/2（gzip 生效）。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '.lighthouse');
const BASELINE = join(OUT_DIR, 'baseline.json');
const LH_VERSION = '13.6.0';
const URL_DEFAULT = 'https://sjc19950404.github.io/a-sentiment-pro/';

const args = process.argv.slice(2);
const argOf = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const hasFlag = (k) => args.includes(`--${k}`);
const TARGET = argOf('url', URL_DEFAULT);
const PRESETS = argOf('preset', 'both') === 'both' ? ['desktop', 'mobile'] : [argOf('preset', 'desktop')];
const SAVE = hasFlag('save-baseline');

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    if (existsSync(p)) return p;
  }
  throw new Error('未找到 Chromium/Chrome；可设 CHROME_PATH 指定。');
}

const num = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '—');

function summarize(j) {
  const a = j.audits;
  const items = a['network-requests']?.details?.items || [];
  const u = (i) => i.url || '';
  const cfg = items.filter((i) => /config\.json/.test(u(i))).length;
  const bad = items.filter((i) => (i.statusCode || 0) >= 400);
  const r2 = items.filter((i) => /r2\.dev/.test(u(i)));
  const gh = items.filter((i) => /github\.io/.test(u(i)));
  const consoleErrors = a['errors-in-console']?.details?.items || [];
  const shifts = a['layout-shifts']?.details?.items || [];
  // 低速 4G 模拟下偶发连接重置会让页面「看起来加载完了」但只发了十几个请求，
  // 分数虚高（实测 16 请求 / 97 分 vs 完整 35 请求 / 21~25 分）。这类样本必须判废重跑。
  const netErrors = consoleErrors.filter((e) => /ERR_CONNECTION_RESET|ERR_FAILED|ERR_TIMED_OUT|ERR_NETWORK/i
    .test(String(e.description || '')));

  // gzip 生效判据：至少一个大档的线上传输量小于解压后体积的一半
  const big = r2.filter((i) => (i.resourceSize || 0) > 50000);
  const gzipOk = big.some((i) => i.transferSize > 0 && i.transferSize < i.resourceSize / 2);
  const gzipSample = big
    .filter((i) => i.transferSize > 0 && i.transferSize < i.resourceSize / 2)
    .sort((x, y) => y.resourceSize - x.resourceSize)[0];

  return {
    scores: Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo']
      .map((k) => [k, j.categories[k] ? Math.round(j.categories[k].score * 100) : null])),
    metrics: {
      FCP: a['first-contentful-paint']?.numericValue,
      LCP: a['largest-contentful-paint']?.numericValue,
      TBT: a['total-blocking-time']?.numericValue,
      CLS: a['cumulative-layout-shift']?.numericValue,
      SI: a['speed-index']?.numericValue,
    },
    display: Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint',
      'total-blocking-time', 'cumulative-layout-shift', 'speed-index']
      .map((k) => [k, a[k]?.displayValue || '—'])),
    requests: {
      total: items.length, configJson: cfg, errors4xx: bad.length, r2: r2.length, github: gh.length,
      consoleErrors: consoleErrors.length, netErrors: netErrors.length,
      totalBytes: a['total-byte-weight']?.numericValue || 0,
    },
    gzip: { ok: gzipOk, sample: gzipSample ? { url: u(gzipSample).split('/').pop(),
      transfer: gzipSample.transferSize, resource: gzipSample.resourceSize } : null },
    clsTop: shifts.slice(0, 3).map((i) => ({ selector: i.node?.selector || '?', score: i.score })),
    badRequests: bad.slice(0, 5).map((i) => ({ status: i.statusCode, url: u(i).slice(0, 120) })),
    consoleErrorSamples: consoleErrors.slice(0, 3).map((e) => String(e.description || '').slice(0, 120)),
    _env: { lighthouse: j.lighthouseVersion, formFactor: j.configSettings?.formFactor,
      throttling: j.configSettings?.throttling },
  };
}

// 样本有效性：低速 4G 下连接重置会让页面提前「看起来加载完」，只发十几个请求、
// 分数虚高（实测 16 请求 / 97 分 vs 完整 35 请求 / 21~25 分）。这类样本判废并自动重跑。
// 阈值取完整加载实测下界：35 请求、25 个 r2、880KiB；留余量避免误杀正常波动。
const MIN_REQUESTS = 28;
function sampleValid(s) {
  const reasons = [];
  if (s.requests.total < MIN_REQUESTS) reasons.push(`请求仅 ${s.requests.total} 个（<${MIN_REQUESTS}，页面疑似提前结束）`);
  if (s.requests.netErrors > 0) reasons.push(`网络错误 ${s.requests.netErrors} 条（连接重置/TIMEOUT）`);
  if (s.requests.r2 < 15) reasons.push(`r2 请求仅 ${s.requests.r2} 个（数据档未完整加载）`);
  return { ok: reasons.length === 0, reasons };
}

function gate(name, s) {
  const problems = [];
  if (s.requests.configJson !== 0) problems.push(`config.json 请求 ${s.requests.configJson} 次（应为 0：构建期同步内联失效）`);
  if (s.requests.errors4xx !== 0) problems.push(`4xx/5xx ${s.requests.errors4xx} 个（R2 漏档/资源缺失）`);
  if (s.requests.r2 < 10) problems.push(`走 r2.dev 的请求仅 ${s.requests.r2} 个（改道失效）`);
  if (!s.gzip.ok) problems.push('未发现压缩生效的大档（R2 gzip 预压缩失效）');
  return { name, ok: problems.length === 0, problems };
}

function printOne(name, s, prev) {
  console.log(`\n── ${name} ──${s.attempts > 1 ? ` (第 ${s.attempts} 次取得有效样本)` : ''}`);
  console.log(`评分  性能 ${s.scores.performance} | 无障碍 ${s.scores.accessibility} | 最佳做法 ${s.scores['best-practices']} | SEO ${s.scores.seo}`
    + (prev ? `   (基线性能 ${prev.scores.performance}, ${s.scores.performance - prev.scores.performance >= 0 ? '+' : ''}${s.scores.performance - prev.scores.performance})` : ''));
  console.log(`指标  FCP ${s.display['first-contentful-paint']} | LCP ${s.display['largest-contentful-paint']}`
    + ` | TBT ${s.display['total-blocking-time']} | CLS ${s.display['cumulative-layout-shift']} | SI ${s.display['speed-index']}`);
  const r = s.requests;
  console.log(`请求  总 ${r.total} | config.json ${r.configJson} | 4xx/5xx ${r.errors4xx} | r2 ${r.r2} | github.io ${r.github}`
    + ` | 控制台错误 ${r.consoleErrors}`);
  console.log(`传输  ${(r.totalBytes / 1024).toFixed(0)} KiB`
    + (prev ? `  (基线 ${(prev.requests.totalBytes / 1024).toFixed(0)} KiB)` : '')
    + (s.gzip.sample ? ` | gzip 抽样 ${s.gzip.sample.url}: ${s.gzip.sample.transfer}→${s.gzip.sample.resource}B` : ''));
  if (s.clsTop.length) console.log('CLS归因  ' + s.clsTop.map((c) => `${c.selector} ${num(c.score, 3)}`).join(' | '));
  if (s.requests.consoleErrors) console.log('控制台  ' + s.consoleErrorSamples.join(' / '));
  if (s.badRequests.length) console.log('失败请求  ' + JSON.stringify(s.badRequests));
}

function printDelta(name, s, prev) {
  if (!prev) return;
  const rows = [
    ['性能分', prev.scores.performance, s.scores.performance, ''],
    ['LCP(s)', prev.metrics.LCP / 1000, s.metrics.LCP / 1000, 's'],
    ['TBT(ms)', prev.metrics.TBT, s.metrics.TBT, 'ms'],
    ['CLS', prev.metrics.CLS, s.metrics.CLS, ''],
    ['SI(s)', prev.metrics.SI / 1000, s.metrics.SI / 1000, 's'],
    ['传输(KiB)', prev.requests.totalBytes / 1024, s.requests.totalBytes / 1024, 'KiB'],
  ];
  console.log(`\n── ${name} 与基线差值（负数=改善）──`);
  for (const [k, a, b, unit] of rows) {
    const d = b - a;
    console.log(`  ${k.padEnd(12)} ${num(a, 2)} → ${num(b, 2)}   ${d >= 0 ? '+' : ''}${num(d, 2)}${unit}`);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const CHROME = findChrome();
console.log(`Lighthouse ${LH_VERSION} | Chromium ${CHROME} | 目标 ${TARGET}`);
console.log(`preset: ${PRESETS.join(', ')}${SAVE ? ' | 本次结果将存为新基线' : ''}`);

let baseline = {};
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* 首次运行无基线 */ }

const MAX_ATTEMPTS = 3;   // 单个样本最多重跑次数（判废后重试）
const RUNS = Math.max(1, Math.min(5, Number(argOf('runs', '1')) || 1));  // 有效样本数，取中位数
const results = {};
const failures = [];

/** 跑一次 Lighthouse，判废则重跑，返回有效样本或 null */
function collectOne(preset, out, label) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const cmd = ['--yes', `lighthouse@${LH_VERSION}`, TARGET,
      ...(preset === 'desktop' ? ['--preset=desktop'] : []),
      '--output=json', `--output-path=${out}`,
      '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage --disable-gpu',
      '--quiet'];
    process.stdout.write(`\n[${preset}] ${label} 第 ${attempt}/${MAX_ATTEMPTS} 次运行中…`);
    try {
      execFileSync('npx', cmd, {
        cwd: ROOT, env: { ...process.env, CHROME_PATH: CHROME },
        stdio: ['ignore', 'ignore', 'pipe'], timeout: 420000,
      });
      console.log(' 完成');
    } catch (e) {
      console.log(' 失败');
      console.error(`  ${String(e.stderr || e.message).slice(0, 300)}`);
      continue;
    }
    const j = JSON.parse(readFileSync(out, 'utf8'));
    const cur = summarize(j);
    const v = sampleValid(cur);
    if (!v.ok) {
      console.log(` 样本判废：${v.reasons.join('；')} → 重跑`);
      continue;
    }
    cur.attempts = attempt;
    copyFileSync(out, join(OUT_DIR, `${preset}-${Date.now()}.json`));
    return cur;
  }
  return null;
}

for (const preset of PRESETS) {
  const out = join(OUT_DIR, `${preset}-latest.json`);
  const samples = [];
  for (let run = 1; run <= RUNS; run++) {
    const s = collectOne(preset, out, RUNS > 1 ? `样本 ${run}/${RUNS}` : '');
    if (s) samples.push(s);
  }
  if (!samples.length) {
    failures.push({ name: preset, ok: false, problems: [`连续 ${MAX_ATTEMPTS} 次均未取得有效样本（页面加载不完整）`] });
    continue;
  }
  // 按性能分排序取中位数（偶数取偏低的那个，避免乐观偏差）
  const sorted = [...samples].sort((a, b) => a.scores.performance - b.scores.performance);
  const s = sorted[Math.floor((sorted.length - 1) / 2)];
  s.runs = { collected: samples.length, requested: RUNS,
    performanceAll: sorted.map((x) => x.scores.performance) };
  results[preset] = s;
  printOne(preset, s, baseline[preset]);
  if (RUNS > 1) console.log(`样本性能分分布  ${s.runs.performanceAll.join(', ')} → 取中位数 ${s.scores.performance}`);
  printDelta(preset, s, baseline[preset]);
  const g = gate(preset, s);
  console.log(`门禁  ${g.ok ? 'PASS' : 'FAIL'}${g.ok ? '' : ' → ' + g.problems.join('；')}`);
  if (!g.ok) failures.push(g);
}

// 只有全部 preset 都拿到有效样本时才允许写基线，避免把异常样本固化成基准。
if (SAVE && Object.keys(results).length === PRESETS.length && failures.length === 0) {
  writeFileSync(BASELINE, JSON.stringify({ savedAt: new Date().toISOString(),
    url: TARGET, chrome: CHROME, lighthouse: LH_VERSION, ...results }, null, 2));
  console.log(`\n基线已保存 → ${BASELINE}`);
} else if (!existsSync(BASELINE)) {
  console.log('\n提示：尚无基线，跑一次 `npm run lh -- --save-baseline` 建立基线后才能看差值。');
}

if (failures.length) {
  console.error(`\n自检失败 ${failures.length} 项：`);
  for (const f of failures) for (const p of f.problems) console.error(`  [${f.name}] ${p}`);
  process.exit(1);
}
console.log('\n自检通过。');
