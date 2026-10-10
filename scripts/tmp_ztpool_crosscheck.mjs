// 源对照 · 临时诊断脚本（2026-10-10）
//
// 定位：**只读** —— 不写 ztpool_history、不写 archive、不入库、不改任何生产档；
// 失败也不影响主任务（daily_fetch 以 optional 步骤调用它）。跑完看数据再决定留/删。
//
// 为什么要有它：涨停池目前是**单源裸奔**（东财 push2ex 直连），挂了就是静默丢一天
// （不可回补）。要接"东财主 → AkShare 备"降级链，先得回答一个问题：
// **两个源到底一不一致？** 本脚本就是把这个问题量化成数字，不靠印象拍板。
//
//   A 主测：东财（= ztpool_history 末条，即**实际入库的那份**，而非重新拉取）
//           vs AkShare（market_data.fetch_zt_pools，同源同端点 push2ex）
//           → 名单差集、逐票 lbc 差异、fbt/fund 齐全率、整体一致率
//   B 辅测：QuantDash 取少量票的 prev_close/price，用 **src/zt_rebuild.js 的
//           limitPctOf（幅度唯一出处，本脚本不复制判定）** 验涨停价公式是否同口径。
//           只做小样本——免费版 10 次/分钟、且无 fbt/fund/lbc，不适合全市场兜底。
//
// 用法：node scripts/tmp_ztpool_crosscheck.mjs [YYYY-MM-DD]
//       默认日期 = ztpool_history 末条日期（即最近入库的交易日）
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { limitPctOf } from '../src/zt_rebuild.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = process.platform === 'win32' ? 'python' : 'python3';
const ZT_PATH = path.join(ROOT, 'data', 'ztpool_history.json');

const run = (cmd, args, timeout = 240_000) =>
  spawnSync(cmd, args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, timeout,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

/** 跑一段 python，返回 stdout（python 未装依赖/退出非零 → throw） */
function py(code) {
  const r = run(PY, ['-c', code]);
  if (r.error) throw new Error(`python 启动失败：${r.error.message}`);
  if (r.status !== 0) throw new Error(`python 退出 ${r.status}：${String(r.stderr || '').slice(0, 300)}`);
  return r.stdout || '';
}

/** python 输出 → JSON（NaN 会让 JSON.parse 炸，先换成 null） */
function pyJson(code) {
  const out = py(code);
  // 从最靠前的 '[' 或 '{' 开始切（跳过 python 侧可能的日志前缀）。
  // ⚠ 不能只找 '{'：数组输出 [{...},{...}] 里第一个 '{' 在数组内部，
  //    从那里切会得到 "{...},{...}]" → JSON.parse 报 "after JSON"（2026-10-10 实测踩到）。
  const idx = [out.indexOf('['), out.indexOf('{')].filter((i) => i >= 0).sort((a, b) => a - b);
  const s = idx.length ? out.slice(idx[0]) : out;
  return JSON.parse(s.trim());
}

// 代码 → 带市场前缀（limitPctOf 认 sh/sz/bj 前缀；仅做代码→市场映射，涨停判据仍走 zt_rebuild）
const toPrefixed = (c) => {
  const s = String(c ?? '').trim();
  if (s.startsWith('60') || s.startsWith('68') || s.startsWith('9')) return `sh${s}`;
  if (s.startsWith('4') || s.startsWith('8')) return `bj${s}`;
  return `sz${s}`;
};
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ── 东财侧：读实际入库的那份 ────────────────────────────────────────────────
if (!existsSync(ZT_PATH)) {
  console.error('[xcheck] 缺 data/ztpool_history.json，无法对照');
  process.exit(1);
}
const hist = JSON.parse(readFileSync(ZT_PATH, 'utf8'));
const last = hist[hist.length - 1];
const emDate = String(last?.date ?? '').replace(/-/g, '');
const dateArg = (process.argv[2] ?? '').replace(/-/g, '') || emDate;
const dateYmd = `${dateArg.slice(0, 4)}-${dateArg.slice(4, 6)}-${dateArg.slice(6, 8)}`;
const emPool = Array.isArray(last?.pool) ? last.pool : [];

console.log(`\n════ 源对照（只读诊断）════`);
console.log(`  对照交易日：${dateYmd}`);
console.log(`  东财侧来源：data/ztpool_history.json 末条（date=${emDate}，${emPool.length} 只）`);
if (emDate !== dateArg) console.log(`  ⚠ 指定的 ${dateArg} 与末条 ${emDate} 不同：东财侧仍用末条（那是实际入库的那份）`);

// ── A 主测：AkShare 池 ─────────────────────────────────────────────────────
console.log(`\n── A 主测：东财 vs AkShare（market_data.fetch_zt_pools）──`);
let ak = null;
try {
  // ⚠ 日期必须无连字符（YYYYMMDD）：传 '2026-10-09' 会被 int() 解析失败 → 三池全降级 null
  //   （实测：ValueError invalid literal for int() with base 10 —— 2026-10-10 踩过）
  ak = pyJson(`
import json, market_data as m
r = m.fetch_zt_pools('${dateArg}')
print(json.dumps(r, ensure_ascii=False, default=str).replace('NaN','null'))
`);
} catch (e) {
  console.error(`[xcheck] AkShare 侧取数失败：${e.message}`);
  console.error('[xcheck] 主测无法进行（不重试、不降级——这是诊断脚本，如实报失败）');
  process.exit(1);
}

// zt_detail 契约与旧 fetchPools 一致：{c,n,lbc,zbc,hybk,fbt,fund}
const akDetail = Array.isArray(ak?.zt_detail) ? ak.zt_detail : [];
const akCodes = Array.isArray(ak?.zt_codes) ? ak.zt_codes.map(String) : akDetail.map((d) => String(d?.c));

const emMap = new Map(emPool.map((x) => [String(x?.c), x]));
const akMap = new Map(akDetail.map((x) => [String(x?.c), x]));
const emOnly = [...emMap.keys()].filter((c) => !akMap.has(c));
const akOnly = [...akMap.keys()].filter((c) => !emMap.has(c));
const common = [...emMap.keys()].filter((c) => akMap.has(c));

const lbcDiff = [];
const fbtMissing = { em: 0, ak: 0 };
const fundMissing = { em: 0, ak: 0 };
for (const c of common) {
  const e = emMap.get(c), a = akMap.get(c);
  if (Number(e?.lbc ?? NaN) !== Number(a?.lbc ?? NaN)) lbcDiff.push({ c, em: e?.lbc ?? null, ak: a?.lbc ?? null });
  if (e?.fbt == null) fbtMissing.em++;
  if (a?.fbt == null) fbtMissing.ak++;
  if (e?.fund == null) fundMissing.em++;
  if (a?.fund == null) fundMissing.ak++;
}
for (const c of emOnly) { if (emMap.get(c)?.fbt == null) fbtMissing.em++; if (emMap.get(c)?.fund == null) fundMissing.em++; }
for (const c of akOnly) { if (akMap.get(c)?.fbt == null) fbtMissing.ak++; if (akMap.get(c)?.fund == null) fundMissing.ak++; }

const denom = Math.max(emMap.size, akMap.size) || 1;
const nameAgree = common.length / denom;
const lbcAgree = (common.length - lbcDiff.length) / denom;

console.log(`  东财 ${emMap.size} 只 / AkShare ${akMap.size} 只`);
console.log(`  名单：共有 ${common.length} · 仅东财 ${emOnly.length}${emOnly.length ? `（${emOnly.slice(0, 8).join(',')}）` : ''} · 仅 AkShare ${akOnly.length}${akOnly.length ? `（${akOnly.slice(0, 8).join(',')}）` : ''}`);
console.log(`  名单一致率      ${(nameAgree * 100).toFixed(1)}%`);
console.log(`  连板数 lbc 一致 ${(lbcAgree * 100).toFixed(1)}%（差异 ${lbcDiff.length} 只${lbcDiff.length ? '：' + lbcDiff.slice(0, 6).map((d) => `${d.c}(东财${d.em}/AK${d.ak})`).join(' ') : ''}）`);
console.log(`  fbt 齐全率      东财 ${(((emMap.size - fbtMissing.em) / (emMap.size || 1)) * 100).toFixed(1)}% / AkShare ${(((akMap.size - fbtMissing.ak) / (akMap.size || 1)) * 100).toFixed(1)}%`);
console.log(`  fund 齐全率     东财 ${(((emMap.size - fundMissing.em) / (emMap.size || 1)) * 100).toFixed(1)}% / AkShare ${(((akMap.size - fundMissing.ak) / (akMap.size || 1)) * 100).toFixed(1)}%`);

// ── B 辅测：QuantDash 小样本验涨停价公式 ────────────────────────────────────
console.log(`\n── B 辅测：QuantDash 小样本（验涨停价公式，判定幅度走 zt_rebuild.limitPctOf）──`);
// 挑跨板块样本：主板 / 创业板 / 科创板 / 北交所 / ST（覆盖不同涨跌幅限制）
const pick = (pred) => emPool.find((x) => pred(String(x?.c), String(x?.n ?? '')));
const samples = [
  pick((c) => c.startsWith('60')),
  pick((c) => c.startsWith('00')),
  pick((c) => c.startsWith('30')),
  pick((c) => c.startsWith('68')),
  pick((c, n) => /ST/i.test(n)),
].filter(Boolean).slice(0, 5);

if (!samples.length) {
  console.log('  无可用样本，跳过');
} else {
  const codes = samples.map((x) => String(x.c));
  try {
    // ⚠ fetch_candidate_quotes 返回 pandas DataFrame，不是 dict —— 必须先 to_dict('records')
    const raw = pyJson(`
import json, market_data as m
r = m.fetch_candidate_quotes(${JSON.stringify(codes)})
rows = r.to_dict('records') if hasattr(r, 'to_dict') else r
print(json.dumps(rows, ensure_ascii=False, default=str).replace('NaN','null'))
`);
    const rows = Array.isArray(raw) ? raw : (raw?.rows ?? raw?.quotes ?? []);
    const byCode = new Map(rows.map((r) => [String(r?.symbol ?? r?.code ?? r?.c).replace(/^(sh|sz|bj)/, ''), r]));
    for (const s of samples) {
      const r = byCode.get(String(s.c));
      if (!r) { console.log(`  ${s.c} ${String(s.n ?? '').padEnd(6)} QuantDash 未返回`); continue; }
      const prev = Number(r.prev_close);
      const price = Number(r.price);
      const pct = limitPctOf(toPrefixed(s.c), s.n);       // 幅度唯一出处
      const up = round2(prev * (1 + pct));                // 与 zt_rebuild.classifyBar 同式
      const isZt = Math.abs(price - up) < 1e-6;
      console.log(`  ${s.c} ${String(s.n ?? '').padEnd(6)} 前收 ${prev} 现价 ${price} 幅度 ${(pct * 100).toFixed(0)}% 涨停价 ${up} → ${isZt ? '判定涨停 ✓' : '非涨停（' + (r.change_pct ?? '?') + '%）'}`);
    }
    console.log('  注：QuantDash 无 fbt/fund/lbc，只用于验证"能否用前收判定涨停"，不做全市场兜底');
  } catch (e) {
    console.error(`  QuantDash 侧失败：${e.message}（辅测失败不影响主测结论）`);
  }
}

console.log(`\n════ 对照结束（未写入任何文件）════\n`);
