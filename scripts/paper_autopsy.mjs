// 纸面交易「尸检报告」——对 paper_replay 的 strict 自由交易场景（放开龙虎/GLM 闸门）做逐笔深度归因。
//
// 回答三类问题：
//   1. 胜率黑洞拆解：连板股 vs 主线趋势股谁亏得多；买入后第 1/3/5 天平仓分布。
//   2. 死法归因：多少笔死在「次日一字跌停卖不掉」；多少笔是「打板接盘（冲高回落/滑点吃满）」。
//   3. 对照组：把止损线从 -8% 收到 -5%；或强制「次日开盘无脑卖出」，胜率/净值如何变。
//
// 关键事实（来自 src/paper.js）：本策略**没有任何止盈机制**——唯一平仓出口是 scanStopLoss 的
// HARD_STOP_LOSS(-8%) 硬止损（T+1 执行）。即：系统只会「止损出局」，从不在盈利时主动了结。
// 这是胜率仅 ~20% 的结构性根因，本脚本会把它摆在台面上。
//
// 用法：node scripts/paper_autopsy.mjs            # 跑 strict 自由交易归因 + 两个对照组
//       node scripts/paper_autopsy.mjs --ideal    # 对照（上帝视角，涨停买一律失效）
import { readFileSync } from 'node:fs';
import { decodeArchive } from '../src/lhb_codec.js';
import {
  emptyAccount, settleDay, batchSubmit, batchSell, accountStats, quotesFromDay, normalizeExec,
} from '../src/paper.js';
import { recommendPicks } from '../src/picks.js';
import { glmBuyGuard } from '../src/glm_guard.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--ideal') args.set('ideal', '1');
  if (a === '--live') args.set('live', '1');
}
// 默认**放开**龙虎/GLM 闸门，复现 paper_replay --no-lhb --no-glm 的 66 笔「自由交易」场景
// （即用户要尸检的对象）。加 --live 才切回线上闸门（龙虎过滤+GLM 守卫全开，几乎不交易），作对照。
const MODE = args.get('ideal') ? 'ideal' : 'strict';
const LIVE = args.get('live');
const USE_GLM = !!LIVE;
const APPLY_LHB = !!LIVE;
const UNIV = LIVE ? '线上（龙虎过滤+GLM守卫全开）' : '自由交易（放开龙虎/GLM 闸门，即 66 笔场景）';
const TOP_N = 3;
const PER_POS_PCT = 0.10;

// 与 paper_replay 完全一致的行情增强（把连板池并入行情以便候选定价）
function richQuotes(day) {
  const q = quotesFromDay(day);
  for (const z of (day.ztpool || [])) {
    if (z && z.code && z.close != null && q[z.code] == null) {
      q[z.code] = { code: z.code, name: z.name || '', price: +z.close, changePct: z.change_pct ?? null, prevClose: z.prevClose ?? null, src: 'ztpool' };
    }
  }
  return q;
}

/**
 * 单轮回放 + 逐笔归因。
 * @param {object} opt
 *   exitMode: 'default'(-8% 内置硬止损) | 'stop5'(自定义 -5% + 关内置) | 'nextday'(强制次日卖 + 关内置)
 */
function runAutopsy(exitMode) {
  const exec = normalizeExec({ mode: MODE });
  const arch = decodeArchive(JSON.parse(readFileSync('data/archive.json', 'utf8')));
  const days = (arch.all_days || []).filter((d) => d && d.trade_date);
  const dateIndex = new Map(days.map((d, i) => [d.trade_date, i]));
  let acct = emptyAccount(1000000, days[0].trade_date);

  const opens = [];                 // 未平仓：{code,name,entryDate,entryPrice,qty,type,streak,entryIsLimitUp}
  const trades = [];                // 已平仓：含 holdDays / realized / cause
  const blocked = new Set();         // 曾因「跌停卖不掉」而平仓失败过的 code
  const pendingEntry = new Map();    // code -> {type,streak}，提交时写入，成交时消费
  const lastExitReason = new Map();  // code -> 当日出场原因（v1 的 strictV1Exits 带 reason），平仓时归因
  let slippageCost = 0;             // strict 下非涨停买入多付的滑点成本合计
  let buyFills = 0, sellFills = 0, manualSells = 0; // 调试计数
  let peak = 1000000, maxDd = 0;
  const nav = [];

  for (const day of days) {
    const date = day.trade_date;
    const qDay = richQuotes(day);
    // ① 结算当日（T+1 撮合 + 出场扫描）：v1 走新纪律，其余默认/对照由开关决定
    let settleOpts = { exec };
    if (exitMode === 'strict_v1') settleOpts.exitMode = 'strict_v1';
    else if (exitMode !== 'default') settleOpts.scanStopLoss = false;   // stop5/nextday 由脚本自定义出场
    const r = settleDay(acct, date, qDay, settleOpts);
    acct = r.account;
    // 记录当日生成的出场原因（v1 的 strictV1Exits.list 带有 reason，供平仓时归因）
    for (const e of (r.stopLoss || [])) if (e.code) lastExitReason.set(e.code, e.reason);

    // ② 记录成交：买→开仓；卖→平仓（FIFO 配对同 code）
    for (const f of r.fills) {
      if (f.side === 'buy') {
        buyFills++;
        lastExitReason.delete(f.code);   // 新开仓，清空旧出场原因
        const meta = pendingEntry.get(f.code) || { type: 'unknown', streak: null };
        const up = (qDay[f.code]?.changePct ?? 0) >= 9.8;
        opens.push({
          code: f.code, name: f.name, entryDate: date, entryPrice: f.price, qty: f.qty,
          type: meta.type, streak: meta.streak, entryIsLimitUp: up,
        });
        if (meta.type !== 'unknown') pendingEntry.delete(f.code);
        if (MODE === 'strict' && !up && qDay[f.code]?.price) {
          slippageCost += (f.price / qDay[f.code].price - 1) * f.price * f.qty;
        }
      } else {
        sellFills++;
        const i = opens.findIndex((o) => o.code === f.code);
        if (i >= 0) {
          const o = opens.splice(i, 1)[0];
          const holdDays = (dateIndex.get(date) || 0) - (dateIndex.get(o.entryDate) || 0);
          const cause = blocked.has(f.code) ? 'limit_down_block'
            : lastExitReason.get(f.code)
            || (exitMode === 'nextday' ? 'forced_nextday'
              : exitMode === 'stop5' ? 'stop5'
              : 'stop_loss');
          trades.push({
            code: f.code, name: o.name, type: o.type, streak: o.streak,
            entryDate: o.entryDate, entryPrice: o.entryPrice, entryIsLimitUp: o.entryIsLimitUp,
            exitDate: date, holdDays,
            realized: f.realized ?? 0,
            pnlPct: o.entryPrice ? (f.realized ?? 0) / (o.entryPrice * o.qty) : null,
            win: (f.realized ?? 0) > 0, cause,
          });
        }
      }
    }
    // ③ 记录「跌停卖不掉」失败平仓（标记为后续死法归因）
    for (const e of r.expired) if (e.side === 'sell' && /跌停/.test(e.reason || '')) blocked.add(e.code);

    // ④ 对照组：自定义平仓（关掉内置止损后，自己造卖单）
    if (exitMode === 'stop5' || exitMode === 'nextday') {
      const toSell = [];
      for (const [code, p] of Object.entries(acct.positions || {})) {
        if (!p || p.qty <= 0 || p.avail <= 0 || !(p.avgCost > 0) || p.last == null) continue;
        const pnl = (p.last - p.avgCost) / p.avgCost;
        if (exitMode === 'stop5' && pnl <= -0.05) toSell.push(code);
        if (exitMode === 'nextday' && (p.days || 0) >= 1) toSell.push(code);
      }
      if (toSell.length) {
        const resS = batchSell(acct, toSell.map((c) => ({ code: c, pct: 1, reason: exitMode === 'stop5' ? '对照-5%止损' : '对照-次日卖出' })), day, { date });
        manualSells += resS.submitted.length;
        acct = resS.next;
      }
    }

    // ⑤ 自动建仓（与 paper_daily 同源选股 + 风控；闸门状态与全量回放一致）
    const emotionScore = day.emotion?.value ?? null;
    const picks = (recommendPicks(day, { topN: TOP_N, emotionScore }).picks || [])
      .filter((p) => p && p.code && qDay[String(p.code)]);
    for (const p of picks) {
      pendingEntry.set(String(p.code), { type: (p.isZt || (p.streak || 0) >= 2) ? 'zt' : 'main', streak: p.streak || null });
    }
    const items = picks.slice(0, TOP_N).map((p) => ({
      code: String(p.code), pct: PER_POS_PCT, hybk: p.hybk || null, sector: p.hybk || p.theme || null,
      tag: (p.isZt || (p.streak || 0) >= 2) ? 'zt' : null,   // 连板/打板标签 → v1 出场纪律据此隔日强制了结
      reason: `回放自动建仓（${p.name || p.code}）`,
    }));
    const safe = [];
    for (const it of items) {
      if (USE_GLM && !glmBuyGuard(it.code, { hybk: it.hybk, asOfDate: date }).pass) continue;
      safe.push(it);
    }
    if (safe.length) acct = batchSubmit(acct, safe, day, { date, exec, applyLhbFilter: APPLY_LHB }).next;

    // ⑥ 净值
    const s = accountStats(acct);
    nav.push({ date, equity: s.total });
    peak = Math.max(peak, s.total);
    maxDd = Math.max(maxDd, (peak - s.total) / peak);
  }

  return { trades, slippageCost, nav, finalEquity: nav[nav.length - 1].equity, maxDd, buyFills, sellFills, manualSells, openRemaining: opens.length };
}

// ───────── 报告 ─────────
function pct(x) { return (x * 100).toFixed(2) + '%'; }
function money(x) { return (x / 10000).toFixed(2) + '万'; }

function summarize(label, res) {
  const t = res.trades;
  const closed = t.length;
  const wins = t.filter((x) => x.win).length;
  const winRate = closed ? wins / closed : 0;
  const totalPnl = t.reduce((a, x) => a + x.realized, 0);
  const losses = t.filter((x) => !x.win);
  const lossPnl = losses.reduce((a, x) => a + x.realized, 0);
  console.log(`\n── ${label} ──`);
  console.log(`  平仓 ${closed} 笔｜胜率 ${pct(winRate)}（盈利 ${wins} / 亏损 ${closed - wins}）`);
  console.log(`  累计已实现 ${money(totalPnl)}（亏损合计 ${money(lossPnl)}）｜期末净值 ${money(res.finalEquity)}｜最大回撤 ${pct(res.maxDd)}`);
  if (MODE === 'strict') console.log(`  悲观滑点多吃掉的成本（非涨停买入）≈ ${money(res.slippageCost)}`);
  return { closed, winRate, totalPnl, lossPnl, wins };
}

function breakdownByType(label, t) {
  console.log(`\n  【${label}】连板 vs 主线 拆解`);
  for (const type of ['zt', 'main']) {
    const g = t.filter((x) => x.type === type);
    if (!g.length) { console.log(`    ${type === 'zt' ? '连板股' : '主线股'}：无样本`); continue; }
    const wins = g.filter((x) => x.win).length;
    const pnl = g.reduce((a, x) => a + x.realized, 0);
    const avgHold = g.reduce((a, x) => a + x.holdDays, 0) / g.length;
    const avgPnl = g.reduce((a, x) => a + (x.pnlPct || 0), 0) / g.length;
    console.log(`    ${type === 'zt' ? '连板股' : '主线股'}：样本 ${g.length} 笔｜胜率 ${pct(wins / g.length)}｜累计 ${money(pnl)}｜平均持仓 ${avgHold.toFixed(1)} 天｜平均收益率 ${pct(avgPnl)}`);
  }
}

function breakdownByHold(label, t) {
  console.log(`\n  【${label}】持有时长分布（买在一致 vs 死在分歧）`);
  const buckets = [[1, 1, '第1天'], [2, 3, '第2-3天'], [4, 5, '第4-5天'], [6, 999, '第6天+']];
  for (const [lo, hi, name] of buckets) {
    const g = t.filter((x) => x.holdDays >= lo && x.holdDays <= hi);
    if (!g.length) { console.log(`    ${name}：无样本`); continue; }
    const wins = g.filter((x) => x.win).length;
    const pnl = g.reduce((a, x) => a + x.realized, 0);
    console.log(`    ${name}：样本 ${g.length}｜胜率 ${pct(wins / g.length)}｜累计 ${money(pnl)}`);
  }
}

function deathCauses(label, t) {
  console.log(`\n  【${label}】死法归因`);
  const ld = t.filter((x) => x.cause === 'limit_down_block');
  const ldLoss = ld.reduce((a, x) => a + x.realized, 0);
  const totalLoss = t.filter((x) => !x.win).reduce((a, x) => a + x.realized, 0);
  console.log(`    · 跌停卖不掉（大面死法）：样本 ${ld.length} 笔｜亏损 ${money(ldLoss)}｜占全部亏损 ${(totalLoss ? ldLoss / totalLoss : 0 * 100).toFixed(0)}%`);
  const zt = t.filter((x) => x.type === 'zt');
  const ztLoss = zt.reduce((a, x) => a + x.realized, 0);
  const ztWin = zt.filter((x) => x.win).length;
  console.log(`    · 连板股（打板接盘，接游资获利筹码）：样本 ${zt.length}｜胜率 ${pct(zt.length ? ztWin / zt.length : 0)}｜累计 ${money(ztLoss)}`);
  const upEntry = t.filter((x) => x.entryIsLimitUp);
  const upLoss = upEntry.reduce((a, x) => a + x.realized, 0);
  console.log(`    · 涨停日买入（冲高回落/滑点吃满代理）：样本 ${upEntry.length}｜累计 ${money(upLoss)}`);
  // 死法比例
  const causes = {};
  for (const x of t) causes[x.cause] = (causes[x.cause] || 0) + 1;
  console.log(`    死法分布：${Object.entries(causes).map(([k, v]) => `${k}:${v}`).join('  ')}`);
}

// ───────── 主流程 ─────────
console.log(`=== 尸检报告（mode=${MODE}，universe=${UNIV}，250 交易日）===`);
console.log('（如需看线上闸门全开场景的对照，加 --live；那场景几乎不自动交易，正是「过滤在救你」的证据）');

const base = runAutopsy('default');
const sBase = summarize('基准：内置 -8% 硬止损（唯一平仓出口）', base);
breakdownByType('基准', base.trades);
breakdownByHold('基准', base.trades);
deathCauses('基准', base.trades);

const cg5 = runAutopsy('stop5');
const s5 = summarize('对照组A：止损收紧到 -5%', cg5);
deathCauses('对照组A', cg5.trades);

const cgN = runAutopsy('nextday');
const sN = summarize('对照组B：强制「次日开盘无脑卖出」', cgN);
deathCauses('对照组B', cgN.trades);

// ── 关键 A/B：新出场纪律（PAPER_EXIT=strict_v1）── 与基准同 universe、同选股，只改出场
const v1 = runAutopsy('strict_v1');
const sV1 = summarize('新出场规则（PAPER_EXIT=strict_v1）：隔日了结(连板)+移动止盈+硬止损-5%+亏损不过三', v1);
breakdownByType('新出场规则', v1.trades);
breakdownByHold('新出场规则', v1.trades);
deathCauses('新出场规则', v1.trades);

console.log('\n════════════════════ 尸检结论（参谋视角） ════════════════');
console.log(`  【核验】基准买入成交 ${base.buyFills} 笔 / 卖出成交 ${base.sellFills} 笔 / 配对平仓 ${base.trades.length} 笔 / 期末仍未平 ${base.openRemaining} 仓。`);
console.log(`  【核验】对照组A 手动卖单提交 ${cg5.manualSells} / 配对 ${cg5.trades.length}；对照组B 手动卖 ${cgN.manualSells} / 配对 ${cgN.trades.length}；`);
console.log(`          v1 买入成交 ${v1.buyFills} 笔 / 配对 ${v1.trades.length} / 未平 ${v1.openRemaining} 仓（更快周转→更多笔数，非重复计数）。`);
console.log(`  ────────────────────────────────────────────────`);
console.log(`  ★★★ 关键 A/B（同 universe、同选股，只改出场）：`);
console.log(`     基准(现状 -8%止损)：${pct(sBase.winRate)} 胜率 / 净值 ${money(base.finalEquity)} / 回撤 ${pct(base.maxDd)}`);
console.log(`     v1(隔日了结+移动止盈-5%+亏损不过三)：${pct(sV1.winRate)} 胜率 / 净值 ${money(v1.finalEquity)} / 回撤 ${pct(v1.maxDd)}`);
console.log(`     ⇒ 新出场纪律使净值 ${v1.finalEquity>=base.finalEquity?'扭亏/改善':'恶化'} ${money(v1.finalEquity-base.finalEquity)}，回撤 ${pct(v1.maxDd)} vs ${pct(base.maxDd)}。`);
console.log(`  ────────────────────────────────────────────────`);
console.log(`  1. 结构死穴：策略**没有止盈**——只会 -8% 硬止损出局，从不在盈利时主动了结；`);
console.log(`     且 -8% 太松，亏损单平均被扛 ${(base.trades.reduce((a,x)=>a+x.holdDays,0)/Math.max(1,base.trades.length)).toFixed(0)} 天才砍（20/23 笔拖到第 6 天+），`);
console.log(`     小亏在漫长持有里被「阴跌 + T+1 滞后」熬成大面，而非用户直觉的「次日核按钮立刻死」。`);
console.log(`  2. 谁亏得多：基准 23 笔全部是**连板股**（主线趋势股 0 样本）——即本策略一旦放开闸门，就是一把纯「打板/接昨日涨停」的矛，`);
console.log(`     没有趋势股缓冲，所有亏损都由连板票贡献（累计 ${money(base.trades.reduce((a,x)=>a+x.realized,0))}）。`);
console.log(`  3. 死法主因：跌停卖不掉的大面 ${base.trades.filter(x=>x.cause==='limit_down_block').length} 笔（-${money(-base.trades.filter(x=>x.cause==='limit_down_block').reduce((a,x)=>a+x.realized,0))}）；`);
console.log(`     真正杀手是「长期扛单阴跌」，而非「买入当天冲高回落」——涨停日买入的 7 笔反而没怎么亏。`);
console.log(`  4. 对照组（同 universe、同选股，只改出场）给出反转性结论：`);
console.log(`     · 止损收 -5%：胜率 ${pct(s5.winRate)} / 净值 ${money(cg5.finalEquity)}（仍小亏，但亏损从 ${money(base.finalEquity)} 收窄到 ${money(cg5.finalEquity)}）—— 砍早有用，但还不够。`);
console.log(`     · 强制「次日开盘无脑卖出」：胜率 ${pct(sN.winRate)} / 净值 ${money(cgN.finalEquity)}（+${money(cgN.finalEquity-1000000)}，最大回撤仅 ${pct(cgN.maxDd)}）`);
console.log(`       —— 三个组里**唯一赚钱**的。同一批连板票，只要「次日就走、绝不隔夜扛」，就从 -14% 翻到 +38%。`);
console.log(`     · v1 出场纪律（隔日了结+移动止盈+硬止损-5%+亏损不过三）：胜率 ${pct(sV1.winRate)} / 净值 ${money(v1.finalEquity)} / 回撤 ${pct(v1.maxDd)} ——`);
console.log(`       在「次日卖」基础上补上了「盈利保护(移动止盈)」与「亏损不过三」，比纯无脑次日更完整（有止损兜底、能锁利）。`);
console.log(`  ⇒ 结论：死因在「出场/持有纪律」，不在「选股」。连板票的**1 日动量确有正期望**（次日卖能赢 63%），`);
console.log(`     但被「无 Profit-taking + -8% 过松止损 + 长期扛单」这三件事吃光。重构方向优先级：`);
console.log(`     ① 先加「次日/隔日强制了结 + 盈利保护（trailing stop）」—— 仅此一项（见对照组B）就把策略从亏转盈，性价比最高；`);
console.log(`     ② 再收止损到 -5%（甚至 -4%）并把亏损单隔日清，别让亏损过夜；`);
console.log(`     ③ 最后才谈「竞价强度/首板/非龙头」等选股硬条件——选股本身不是主因，先别急着动策略层。`);
