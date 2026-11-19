#!/usr/bin/env node
/**
 * 竞价打分 sidecar（2026-11-10 用户拍板 v1 口径，定稿）。
 * 读 data/auction_history.json 末条（9:25 定格快照）+ ztpool_history 昨日池（拿昨日 amount）
 *   → src/auction_score.js 三独立信号 → 落 data/auction_score.json（按日幂等覆盖）。
 * 阈值参数：config.paper.auctionScore（缺省用 AUCTION_DEFAULTS：±3% / 一字占比 2%）。
 * 纪律：只产标记+统计值，**不注入主情绪引擎、不影响仓位打分**；sidecar fail-open。
 * 调度：crontab 9:27（采集 9:26 后一分钟；纯计算秒级）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { scoreAuctionDay, AUCTION_DEFAULTS } from '../src/auction_score.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const hist = JSON.parse(readFileSync(join(ROOT, 'data/auction_history.json'), 'utf8'));
  const rec = Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null;
  if (!rec || !Array.isArray(rec.items) || !rec.items.length) {
    console.error('[auction-score] auction_history 无可用记录——不落档（等采集开档）');
    process.exit(2);
  }
  // 昨日全天成交额：ztpool_history 末条池记录（amount 字段=元）——与竞价档的 ztDate 同日基准
  const prevMap = new Map();
  try {
    const zt = JSON.parse(readFileSync(join(ROOT, 'data/ztpool_history.json'), 'utf8'));
    const zlast = Array.isArray(zt) && zt.length ? zt[zt.length - 1] : null;
    for (const s of (zlast && zlast.pool) || []) {
      if (s && s.c && Number.isFinite(+s.amount) && +s.amount > 0) prevMap.set(String(s.c), +s.amount);
    }
  } catch { /* 池档缺席 → amtRatio 全 null，如实标注 */ }
  // 阈值参数（config.paper.auctionScore 可覆盖；拍板：参数项独立可调）
  let cfgParams = {};
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
    cfgParams = (cfg.paper && cfg.paper.auctionScore) || {};
  } catch { cfgParams = {}; }
  const opts = {
    chgThreshold: Number.isFinite(+cfgParams.chgThreshold) ? +cfgParams.chgThreshold : AUCTION_DEFAULTS.chgThreshold,
    yiziRatioMax: Number.isFinite(+cfgParams.yiziRatioMax) ? +cfgParams.yiziRatioMax : AUCTION_DEFAULTS.yiziRatioMax,
    prevTurnoverByCode: prevMap,
  };
  const scored = scoreAuctionDay(rec, opts);
  if (!scored) { console.error('[auction-score] 计分返回空——不落档'); process.exit(2); }
  scored.generatedAt = new Date().toISOString();
  scored.note = 'v1 三独立信号（涨跌幅标记/竞价额占比/一字缩量），不合成总分；不注入主情绪引擎';
  const OUT = join(ROOT, 'data/auction_score.json');
  const outHist = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
  /* 【2026-11-19 后端评审意见落地】样本量随档披露：竞价档 11-10 才建（历史不可回查，
   * 11 个交易日仅 2 次成功、11-11 档又被 reset 吃掉——详见 fetch_auction.mjs 根因链），
   * 统计分布/分位阈值基本无样本支撑。任何消费方（未来引擎闸门/报表）拿到本档必须
   * 先看 sampleNote——样本攒到 ≥30 个交易日前，打分只作方向参考、禁作阈值判断。 */
  const nHist = Array.isArray(outHist) ? outHist.length : 0;
  scored.sampleNote = `样本 ${nHist} 个交易日（采集链 2026-11-10 建立+push2 断链修复后重建），` +
    (nHist >= 30 ? '已过 30 日门槛，可作统计参考' : '<30 日门槛：仅方向参考，禁作阈值/分位判断');
  const list = Array.isArray(outHist) ? outHist : [];
  const idx = list.findIndex((d) => d.trade_date === scored.trade_date);
  if (idx >= 0) list[idx] = scored; else list.push(scored);
  list.sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
  writeFileSync(OUT, JSON.stringify(list, null, 1) + '\n');
  const sg = scored.signals;
  console.log(`[auction-score] ${scored.trade_date}（窗口 ${scored.window}，参数 ±${(opts.chgThreshold * 100).toFixed(0)}% / 一字占比<${(opts.yiziRatioMax * 100).toFixed(0)}%）`
    + ` → 强势 ${sg.strong} / 走弱 ${sg.weak} / 中性 ${sg.neutral} / 一字缩量 ${sg.yiziShrink} / 一字放量 ${sg.yiziHeavy} / 占比缺失 ${sg.amtRatioMissing}`);
} catch (e) {
  console.error('[auction-score] 异常（fail-open，不影响主链）:', e && e.message);
  process.exit(1);
}
