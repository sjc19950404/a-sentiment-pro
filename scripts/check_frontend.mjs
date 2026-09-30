// 前端渲染校验（开发用）：在 jsdom 里真跑 index.html + app.js，读取磁盘上的 data/*.json，
// 断言 V5.2 四个新卡片确实被渲染、且原有卡片未被破坏。
// 依赖 jsdom（非仓库依赖，CI 不跑本脚本）：
//   npm i -g jsdom 或在任意 node_modules 下有 jsdom；缺失时脚本自动跳过并以 0 退出。
// 用法：node scripts/check_frontend.mjs [--root .]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const rootArg = process.argv.indexOf('--root');
const ROOT = resolve(rootArg >= 0 ? process.argv[rootArg + 1] : '.');

// 依赖解析：先 ESM import，再 CJS require（require 才认 NODE_PATH，便于指向任意 node_modules）
let jsdom;
try {
  jsdom = await import('jsdom');
} catch {
  try {
    jsdom = createRequire(import.meta.url)('jsdom');
  } catch {
    console.log('[check_frontend] 未安装 jsdom，跳过（安装：npm i jsdom，或用 NODE_PATH 指向已装目录）');
    process.exit(0);
  }
}
const { JSDOM, VirtualConsole } = jsdom;

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

const dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  virtualConsole: vc,
});
const { window } = dom;

// 用本地文件系统实现 fetch（相对路径 → 仓库文件），避免依赖静态服务器
window.fetch = async (url) => {
  const rel = String(url).replace(/^\.\//, '').split('?')[0];
  try {
    const txt = readFileSync(join(ROOT, rel), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
  } catch (e) {
    return { ok: false, status: 404, json: async () => { throw e; }, text: async () => '' };
  }
};

const fail = [];
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fail.push(name);
};

try {
  window.eval(readFileSync(join(ROOT, 'app.js'), 'utf8'));
} catch (e) {
  check('app.js 执行不抛异常', false, e.message);
}
await new Promise((r) => setTimeout(r, 400)); // 等异步 fetch/渲染落地

const $ = (id) => window.document.getElementById(id);
const rows = (id) => $(id)?.querySelectorAll('tbody tr').length ?? 0;
const txt = (id) => ($(id)?.textContent || '').trim();

check('原有区块未受影响：情绪分已渲染', txt('emScore') !== '' && txt('emScore') !== '--', `emScore=${txt('emScore')}`);
check('原有区块未受影响：研判报告已生成', txt('briefBody').length > 300, `${txt('briefBody').length} 字`);
check('原有区块未受影响：热点表已填充', rows('hotTable') > 0, `${rows('hotTable')} 行`);
check('新增·策略回测：指标对比表 6 行', rows('btMetrics') === 6, `${rows('btMetrics')} 行`);
check('新增·策略回测：净值曲线 3 条序列', $('btNavSvg')?.querySelectorAll('polyline').length === 3,
  `${$('btNavSvg')?.querySelectorAll('polyline').length} 条`);
check('新增·策略回测：参数行已渲染', txt('btParams').includes('信号'), txt('btParams').slice(0, 40));
check('新增·策略回测：数据加载成功（非降级提示）',
  !txt('btNote').includes('加载失败') && !txt('btNote').includes('未生成'), txt('btNote').slice(0, 40));
check('新增·帕累托：结果表已填充', rows('paretoTable') > 0, `${rows('paretoTable')} 行`);
check('新增·帕累托：摘要含扫描组数', /扫描\s*\d+\s*组/.test(txt('paretoSummary')), txt('paretoSummary').slice(0, 50));
check('新增·滚动样本外：分段表已填充', rows('rollTable') > 0, `${rows('rollTable')} 行`);
check('新增·主线选股：主线题材已渲染', txt('mainLineBody').includes('主线题材'), txt('mainLineBody').slice(0, 40));
check('新增·主线选股：口径备注已渲染', txt('mainLineBody').includes('强度分'), '');

// 研判报告与引擎同源（V5.2）：报告结论必须用引擎口径（七因子情绪分 = archive.emotion.value）
// 套引擎阈值，不能再用自算的五模块分当结论——实测过两套分套同一阈值会给出相反结论
// （83.8 →「过热」 vs 76.8 →「满仓持有」）。
const bt = JSON.parse(readFileSync(join(ROOT, 'data/backtest.json'), 'utf8'));
const arcAll = JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8'));
const lastEmo = (arcAll.all_days || []).slice(-1)[0]?.emotion?.value;
const th = bt.params?.thresholds || { panic: 24, hi: 44, lo: 65, overheat: 80 };
const expectTier = lastEmo == null ? null
  : lastEmo >= th.overheat ? '过热 · 只减仓不新建'
    : lastEmo >= th.lo ? '满仓持有'
      : lastEmo > th.panic ? '半仓' : '清仓';
const brief = txt('briefBody');
const tierSeg = (() => {
  const i = brief.indexOf('仓位档位（V5.2 引擎口径）');
  const j = brief.indexOf('因子分解');
  return (i >= 0 && j > i) ? brief.slice(i, j) : '';
})();
check('研判报告·数据日期与抓取状态落款', brief.includes('数据日期') && brief.includes('抓取状态'), '');
check(`研判报告·仓位档位与引擎一致（情绪分 ${lastEmo} → ${expectTier}）`,
  expectTier != null && tierSeg.includes(expectTier), tierSeg.slice(0, 80) || '缺「仓位档位」段');
check('研判报告·档位阈值与引擎阈值同源',
  tierSeg.includes(`≥${th.overheat}`) && tierSeg.includes(`≥${th.lo}`) && tierSeg.includes(`≤${th.panic}`), '');
check('研判报告·因子分解已降级（标注不参与档位判定）',
  brief.includes('因子分解') && brief.includes('不参与档位判定'), '');
check('研判报告·含 V5.2 实盘约束（止损/降仓/成本）',
  brief.includes('实盘约束') && brief.includes('止损') && brief.includes('印花税'), '');
check('研判报告·含主线强度分（与引擎 selectMainLine 同式）', /主线强度分\s*[\d.\u2014-]+/.test(brief), '');
check('研判报告·不含与引擎冲突的 V5.0「极低/极高风险」措辞',
  !brief.includes('极低风险') && !brief.includes('极高风险'), '');
check(`研判报告·落款版本与回测档一致（${bt.meta?.formulaVersion}）`,
  brief.includes(bt.meta?.formulaVersion || 'v5.2-pro'), '');

// 告警口径：stale（或客户端已过预期更新时刻）才允许出现「告警」级别的条；
// 仅「字段级修补 note / 跳过 / 非交易日」只能是 info，不能把正常等待说成抓取失败。
const meta = JSON.parse(readFileSync(join(ROOT, 'data/archive.json'), 'utf8')).meta || {};
const warns = window.document.querySelectorAll('#alerts .alert:not(.info)').length;
const infos = window.document.querySelectorAll('#alerts .alert.info').length;
const pastDeadline = !!(meta.freshness?.publishDeadline && Date.now() > Date.parse(meta.freshness.publishDeadline));
const expectWarn = !!meta.stale || pastDeadline;
check(`告警口径：stale=${!!meta.stale} / 已过预期更新时刻=${pastDeadline} → 告警条 ${warns} 条`,
  expectWarn ? warns >= 1 : warns === 0, `告警 ${warns} 条、info ${infos} 条`);
if (meta.note) check('告警口径：字段级修补 note 以 info 展示', infos >= 1, `${infos} 条 info`);

check('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

dom.window.close();

console.log(fail.length ? `\n[check_frontend] 失败 ${fail.length} 项：${fail.join('、')}` : '\n[check_frontend] 全部通过');
process.exit(fail.length ? 1 : 0);
