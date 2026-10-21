// 影子账本（paper trading 日志）——**只记账，不下单**。
//
// 为什么需要它（2026-10-11）：A 冰点反转是三策略里唯一跑赢基准的（持有 5 日
//   超额 +9.97%），但 242 个交易日里**只触发 27 次、成交 17 笔**——这个样本量
//   不足以支撑"自动下单"（那等于把样本不足的策略放大执行）。
//   ⇒ 影子模式：每天跑一次，把"如果按信号执行"的每一笔如实记下来。跑几个月攒到
//   100+ 次触发，再谈接 QMT 实战。这是**唯一能回答"策略到底行不行"**的方式。
//
// 与回测的区别（关键，别混为一谈）：
//   · 回测**重算历史**——每次跑都用已完成的 archive 全量重算，口径一改历史也跟着变；
//   · 影子账本**只向前走**——从游标逐日推进到最新可用交易日，已处理的日期**跳过**
//     （幂等）。记下的是"当时当刻的决策"，不会被后来的数据修订/口径改动重写。
//   ⇒ 回测回答"历史上这样能赚吗"，影子账本回答"从今天起这样能赚吗"。
//
// 纪律：
//   · 不产生任何真实订单——这是它存在的全部意义（要下单是另一条链路，且得先有样本）；
//   · 数据缺席就记"缺席"，不补不猜（宁缺毋假）：次日 K 线还没到 → 本笔挂起等下一天；
//   · 与回测共用 src/kline.js 取数、共用同一套阈值常量（口径一致才可比）。
//
// 用法：
//   node scripts/shadow_book.mjs                # 推进到最新交易日（幂等，可重复跑）
//   node scripts/shadow_book.mjs --hold 5       # 持有期（默认 5，A 策略最优档）
//   node scripts/shadow_book.mjs --reset        # 清空账本重来（会打印警告，需确认）
import { readFileSync, existsSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON } from '../src/fsutil.js';
import { getKline } from '../src/kline.js';
// 阈值常量与分位函数走单一来源（src/shadow_signal.js），与回测共享——
//   两边各定义一份迟早分叉，分叉了影子样本就没法跟回测样本比。
import { thresholdsAt, EMO_LO_Q } from '../src/shadow_signal.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BOOK = path.join(ROOT, 'data', 'shadow-book.json');
const ARCHIVE = path.join(ROOT, 'data', 'archive.json');

const argv = process.argv.slice(2);
const argOf = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const HOLD_N = Number(argOf('hold') || 5);
const RESET = argv.includes('--reset');

const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);

const arc = JSON.parse(readFileSync(ARCHIVE, 'utf8').replace(/^﻿/, ''));
// 真实交易日：与回测同一口径（排除回填/legacy 天）
const realDays = (arc.all_days || []).filter((d) => d.emotion && !d.emotion._backfill && !d.emotion._legacy);
if (!realDays.length) { console.error('[shadow] 无真实交易日，退出'); process.exit(0); }
const emoOf = (d) => (d && d.emotion && typeof d.emotion.value === 'number' ? d.emotion.value : null);

const kline = await getKline('sh000300', 100);
const kIdx = new Map(kline.map((x, i) => [x.date, i]));
const pxAt = (date) => (kIdx.has(date) ? kline[kIdx.get(date)] : null);

let book;
let startIdx;
if (!RESET && existsSync(BOOK)) {
  book = JSON.parse(readFileSync(BOOK, 'utf8').replace(/^﻿/, ''));
  startIdx = book.cursor ? realDays.findIndex((d) => d.trade_date === book.cursor) + 1 : 0;
} else {
  if (RESET) console.warn('[shadow] ⚠ --reset：清空账本重来');
  // 首次建账：**从最后一个交易日起步**，绝不重算历史——
  //   历史表现由回测负责；若这里从 0 跑一遍，影子账本就变成了第二个回测，
  //   而且会被日后的口径改动重写，丢掉它唯一的价值："当时当刻的决策记录"。
  //   hist 用起点**之前**的历史情绪填充：否则滚动分位 warmup(60) 不足，出不了信号。
  startIdx = realDays.length - 1;
  book = {
    kind: 'shadow-book', version: 1,
    strategy: 'A_ice_reversal', holdN: HOLD_N,
    startedAt: new Date().toISOString(),
    cursor: null,            // 已处理到的 trade_date
    hist: realDays.slice(0, startIdx).map(emoOf).filter((x) => x != null && Number.isFinite(x)),
    position: null,          // {signalDay, entryDate, entryPrice, daysHeld}
    pending: null,           // 信号已出但次日 K 未到 → 挂起（宁缺毋假，不猜价格）
    pendingExit: null,       // 过热已判，待次日开盘卖出
    trades: [],
    log: [],
  };
}
book.holdN = HOLD_N;
let acted = 0;

for (let i = Math.max(0, startIdx); i < realDays.length; i++) {
  const d = realDays[i];
  const date = d.trade_date;
  const v = emoOf(d);
  const k = pxAt(date);

  // ① 先算阈值（用截至昨日的历史），再把 T 日值入 hist —— 与回测同序，无前视
  const { lo, hi } = thresholdsAt(book.hist);
  if (v != null && Number.isFinite(v)) book.hist.push(v);

  // ② 先处理挂起的买单：昨日出了信号，今天（= 次日）开盘价成交
  if (book.pending) {
    const openPx = k ? k.open : null;
    if (openPx == null) {
      book.log.push({ date, action: 'pending-wait', note: `信号 ${book.pending.signalDay} 待成交：${date} 无沪深300 K线` });
    } else {
      book.position = { signalDay: book.pending.signalDay, entryDate: date, entryPrice: openPx, daysHeld: 0 };
      book.log.push({ date, action: 'buy', emotion: v, at: openPx, note: `信号日 ${book.pending.signalDay} T+1 开盘买入` });
      book.pending = null;
      acted++;
    }
  }

  // ③ 持仓检查：过热避险（次日开盘卖）优先于到期（当日收盘卖）
  if (book.position) {
    book.position.daysHeld += 1;
    const overheat = hi != null && v != null && v > hi;
    const matured = book.position.daysHeld >= HOLD_N;
    if (overheat || matured) {
      // 过热 → 次日开盘卖（今天先记，明天开盘价成交）；到期 → 今日收盘卖
      if (overheat) {
        book.pendingExit = { reason: 'overheat', signalDay: book.position.signalDay, at: null };
      } else if (k && k.close != null) {
        const p = book.position;
        const ret = (k.close - p.entryPrice) / p.entryPrice;
        book.trades.push({
          signalDay: p.signalDay, entryDate: p.entryDate, entryPrice: r4(p.entryPrice),
          exitDate: date, exitPrice: r4(k.close), ret: r4(ret), reason: 'matured',
        });
        book.log.push({ date, action: 'sell', emotion: v, at: k.close, ret: r4(ret), note: `持有满 ${HOLD_N} 日收盘卖出` });
        book.position = null;
        acted++;
      }
    }
  }
  // ④ 昨日挂起的卖单（过热）→ 今日开盘成交
  if (book.pendingExit && book.position) {
    const openPx = k ? k.open : null;
    if (openPx != null) {
      const p = book.position;
      const ret = (openPx - p.entryPrice) / p.entryPrice;
      book.trades.push({
        signalDay: p.signalDay, entryDate: p.entryDate, entryPrice: r4(p.entryPrice),
        exitDate: date, exitPrice: r4(openPx), ret: r4(ret), reason: 'overheat',
      });
      book.log.push({ date, action: 'sell', emotion: v, at: openPx, ret: r4(ret), note: '过热避险，次日开盘卖出' });
      book.position = null;
      book.pendingExit = null;
      acted++;
    }
  }

  // ⑤ 无持仓 → 判冰点入场（T 日收盘判，T+1 开盘买）
  if (!book.position && !book.pending && lo != null && v != null && v < lo) {
    book.pending = { signalDay: date, lo, emotion: v };
    book.log.push({ date, action: 'signal', emotion: v, lo, note: `冰点（< P${Math.round(EMO_LO_Q * 100)}）——明日开盘买入` });
    acted++;
  }

  book.cursor = date;
}

// 汇总
const rets = book.trades.map((t) => t.ret).filter((x) => x != null);
const wins = rets.filter((x) => x > 0).length;
book.summary = {
  trades: book.trades.length,
  signals: book.log.filter((l) => l.action === 'signal').length,
  winRate: rets.length ? r4(wins / rets.length) : null,
  avgRet: rets.length ? r4(rets.reduce((a, b) => a + b, 0) / rets.length) : null,
  totalRet: rets.length ? r4(rets.reduce((a, b) => a * (1 + b), 1) - 1) : null,
  open: !!book.position,
  cursor: book.cursor,
  updatedAt: new Date().toISOString(),
};
book.disclaimer = '影子账本 = 假设执行记录，非真实成交，不构成投资建议；样本足够前不作为任何自动下单依据。';

atomicWriteJSON(BOOK, JSON.stringify(book, null, 2) + '\n');
console.log(`[shadow] 推进至 ${book.cursor} · 本次动作 ${acted} 条`);
console.log(`  信号 ${book.summary.signals} 次 / 已平仓 ${book.summary.trades} 笔 · 胜率 ${book.summary.winRate ?? '—'} · 累计 ${book.summary.totalRet ?? '—'}`);
if (book.position) console.log(`  当前持仓：${book.position.entryDate} @ ${book.position.entryPrice}（已持有 ${book.position.daysHeld} 日）`);
if (book.pending) console.log(`  待成交买入信号：${book.pending.signalDay}`);
