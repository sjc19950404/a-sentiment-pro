// 临时采样脚本（Phase 2 验数用，非生产链路，勿提交/勿挂 CI）
//
// 目的：在 9:35 / 10:00 / 14:55 三个时点，抓取指定股票的东财 clist 原始 f5（成交量）、
//       f6（成交额）字段，连同上下文（f2 现价 / f3 涨幅 / f8 换手 / f9 PE静 / f10 量比 /
//       f23 PB / f115 PE-TTM）一并打印，供人工判断单位：
//         · f5 量级：判断是「手」还是「股」
//         · f6 量级：判断是「元」「千元」「万元」
//         · 同票相邻分钟 f5/f6 是否单调递增：判断是「累计值」还是「单分钟值」
//
// 用法：node scripts/sample_f5f6.mjs <code1> <code2> <code3> ...
//   不传参则使用占位标的（茅台/平安/宁德，流动性好、便于观察量级）；
//   实际验数时请把参数换成当日「涨停 / 跌停 / 平盘」各一只的真实代码。
//
// 注意：本脚本只打印原始值，不写入任何 data/*，不影响生产。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36';
// 东财 push2 镜像群（吸收偶发 TLS 抖动）
const EM_HOSTS = [
  'push2.eastmoney.com', '1.push2.eastmoney.com', '2.push2.eastmoney.com',
  '7.push2.eastmoney.com', '82.push2.eastmoney.com', '84.push2.eastmoney.com',
  'push2delay.eastmoney.com', 'hqdigi2.eastmoney.com',
];
const EM_PATH = '/api/qt/clist/get';
// 关键：显式带上 f5（成交量）、f6（成交额），生产 FIELDS 当前缺这两列
const FIELDS = 'f2,f3,f5,f6,f8,f9,f10,f12,f14,f23,f115';
const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'; // 沪深 A（主板/创业板/科创板）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bjNow() {
  // 北京时区（UTC+8）可读时间
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function fetchByCodes(codes) {
  const fs = codes.map((c) => 'b:' + c).join(',b:');
  let lastErr;
  for (const host of EM_HOSTS) {
    for (let att = 0; att < 2; att++) {
      try {
        const url = `https://${host}${EM_PATH}?pn=1&pz=${codes.length}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=${FIELDS}`;
        const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const diff = j && j.data && Array.isArray(j.data.diff) ? j.data.diff : null;
        if (!diff) throw new Error('clist 无 diff: ' + JSON.stringify(j).slice(0, 120));
        return diff;
      } catch (e) {
        lastErr = e;
        if (att === 0) await sleep(300);
      }
    }
  }
  throw lastErr || new Error('未知错误');
}

// ── 分时接口层（东财 push2his trends2：分时均价线真源；用于判断 f5/f6 单位 & 累计性）──
// trends2 字段（fields2）：f51 时间, f52 开, f53 收/最新, f54 高, f55 低,
//   f56 成交量(手?), f57 成交额(?元), f58 分时均价(真·VWAP，待核实字段序)。
const EM_TREND_HOSTS = ['push2his.eastmoney.com', '1.push2his.eastmoney.com', '2.push2his.eastmoney.com'];

function toSecid(code) {
  if (/^6/.test(code)) return '1.' + code;       // 沪市
  if (/^[03]/.test(code)) return '0.' + code;    // 深市 / 创业板
  if (/^8/.test(code)) return '0.' + code;       // 北交所（按深市 secid 试）
  throw new Error('无法识别市场码的代号: ' + code);
}

async function fetchTrends(code) {
  const secid = toSecid(code);
  const fields2 = 'f51,f52,f53,f54,f55,f56,f57,f58';
  let lastErr;
  for (const host of EM_TREND_HOSTS) {
    for (let att = 0; att < 2; att++) {
      try {
        const url = `https://${host}/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7&fields2=${fields2}&iscr=0&ndays=1`;
        const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const trends = j && j.data && Array.isArray(j.data.trends) ? j.data.trends : null;
        if (!trends) throw new Error('trends2 无 trends: ' + JSON.stringify(j).slice(0, 120));
        return trends;
      } catch (e) {
        lastErr = e;
        if (att === 0) await sleep(300);
      }
    }
  }
  throw lastErr || new Error('trends2 未知错误');
}

const DEFAULT = ['600519', '000001', '300750']; // 占位：茅台/平安/宁德；验数时替换

async function main() {
  const codes = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
  console.log(`\n===== 采样 @ ${bjNow()} (北京时间) =====`);
  console.log(`标的: ${codes.join(', ')}  （涨停/跌停/平盘各一只请替换参数）\n`);
  let rows;
  try {
    rows = await fetchByCodes(codes);
  } catch (e) {
    console.error('抓取失败:', e.message);
    process.exit(1);
  }
  // 按传入顺序对齐（clist 可能按涨幅排序）
  const byCode = new Map(rows.map((r) => [String(r.f12 ?? ''), r]));
  for (const code of codes) {
    const r = byCode.get(code);
    if (!r) { console.log(`[${code}] 未返回`); continue; }
    console.log(`[${code}] ${r.f14 ?? ''}`);
    console.log(`  f2  现价        : ${r.f2}`);
    console.log(`  f3  涨幅%        : ${r.f3}`);
    console.log(`  f5  成交量(原始) : ${r.f5}   <-- 量级判断：手 or 股`);
    console.log(`  f6  成交额(原始) : ${r.f6}   <-- 量级判断：元 / 千元 / 万元`);
    console.log(`  f8  换手%        : ${r.f8}`);
    console.log(`  f9  PE静(旧avg)  : ${r.f9}   <-- 即此前误当均价的字段`);
    console.log(`  f10 量比         : ${r.f10}`);
    console.log(`  f23 PB           : ${r.f23}`);
    console.log(`  f115 PE-TTM      : ${r.f115}`);
    console.log('');

    // ── 分时接口层：拉最近交易日分时序列，观察 f56/f57/f58 的量级与单调性 ──
    console.log('--- 分时接口（trends2）---');
    let trends;
    try { trends = await fetchTrends(code); }
    catch (e) { console.log(`  trends2 抓取失败: ${e.message}`); continue; }
    console.log(`  共 ${trends.length} 根分钟Bar（首: ${trends[0].split(',')[0]} / 末: ${trends[trends.length - 1].split(',')[0]}）`);
    const bar = (s) => s.split(',');
    const f = bar(trends[0]);
    const m = bar(trends[Math.floor(trends.length / 2)]);
    const l = bar(trends[trends.length - 1]);
    console.log(`  首Bar[${f[0]}] f56成交量=${f[5]} f57成交额=${f[6]} f58均价=${f[7]}`);
    console.log(`  中Bar[${m[0]}] f56成交量=${m[5]} f57成交额=${m[6]} f58均价=${m[7]}`);
    console.log(`  末Bar[${l[0]}] f56成交量=${l[5]} f57成交额=${l[6]} f58均价=${l[7]}`);
    console.log('  注：f58=分时接口给出的真实分时均价（待核实字段序）；若 f56 末>>首→累计成交量，');
    console.log('       VWAP=Σ成交额/Σ成交量（注意 手↔股 ×100 的单位换算）。');
  }
  console.log('提示：请把本段输出贴回，我据此判断 f5/f6 单位与是否累计值，再定 VWAP 公式。');
}

main();
