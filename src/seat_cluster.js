/**
 * 席位聚类（2026-11-10，六方向 #2，用户拍板「一步步落实」）。
 *
 * 定位：离线批量（深夜跑一次出一次标签），盘中只查表——本模块是纯函数，
 *   scripts/seat_cluster.mjs 负责 IO（读 archive → 落 data/seat_labels.json）。
 *
 * 特征（v1，全部来自 seats.detail × seatCodes × seats.js 结构性分类，可核验）：
 *   activeDays   上榜天数
 *   buyWan/sellWan 买卖累计额（万元）
 *   instShare/northShare  机构专用 / 沪深股通 席位出现占比（seats.js seatTypeOf 口径）
 *   avgBuyWan    单次买方均额（万元）
 *   singleStockConc  单票集中度（出现次数最多的票占比）——衡量「票路宽度」
 *   ⚠ 连板偏好（上榜标的连板数）v1 缺席：lhb 明细在分片层、考古成本高，且 ztpool_history
 *     仅 17 天——按「缺席特征重归一」纪律（C5/C8 同款），本版不造数，留 v2 接。
 *
 * 聚类：L2 标准化（对数尺度压金额长尾）+ 确定性 k-means（k=5，固定首簇种子，
 *   30 轮）。**不引入任何 ML 依赖**——树莓派零安装负担，算法透明可审计。
 * 标签：按簇质心特征规则命名（可解释优先，不追求统计最优）：
 *   机构通道 / 北向通道 / 高频活跃席位 / 大额主力 / 一般营业部。
 * 游资点名归属**不做**（seats.js 头注明文：不可核验，只输出结构性事实）。
 */

import { brokerOf, seatTypeOf } from './seats.js';

/** 从 archive days（含 summary.seats.detail + meta.seatCodes）聚合席位原始统计。 */
export function collectSeatStats(days, seatCodes) {
  const list = Array.isArray(days) ? days : [];
  const codes = Array.isArray(seatCodes) ? seatCodes : [];
  const acc = new Map(); // seatName -> stats
  const touch = (name) => {
    if (!acc.has(name)) acc.set(name, { days: new Set(), codes: new Map(), buyWan: 0, sellWan: 0, buyCnt: 0, sellCnt: 0, instCnt: 0, northCnt: 0 });
    return acc.get(name);
  };
  for (const d of list) {
    const detail = d && d.summary && d.summary.seats && d.summary.seats.detail;
    if (!detail) continue;
    const date = d.trade_date || d.date;
    for (const code of Object.keys(detail)) {
      const pair = detail[code] || {};
      for (const side of ['b', 's']) {
        for (const row of Array.isArray(pair[side]) ? pair[side] : []) {
          if (!Array.isArray(row) || row.length < 2) continue;
          const id = row[0];
          const wan = Number.isFinite(+row[1]) ? +row[1] : 0;
          const name = codes[id] != null ? String(codes[id]) : null;
          if (!name) continue; // 码表外的 id：跳过（宁缺毋假）
          const st = touch(name);
          st.days.add(date);
          st.codes.set(code, (st.codes.get(code) || 0) + 1);
          if (side === 'b') { st.buyWan += wan; st.buyCnt++; } else { st.sellWan += wan; st.sellCnt++; }
          const t = seatTypeOf(name);
          if (t === 'inst') st.instCnt++;
          else if (t === 'north') st.northCnt++;
        }
      }
    }
  }
  const out = [];
  for (const [name, st] of acc) {
    const cnt = st.buyCnt + st.sellCnt;
    const topCode = [...st.codes.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({
      name,
      broker: brokerOf(name),
      activeDays: st.days.size,
      buyWan: +st.buyWan.toFixed(1),
      sellWan: +st.sellWan.toFixed(1),
      buyCnt: st.buyCnt,
      sellCnt: st.sellCnt,
      instShare: cnt ? +(st.instCnt / cnt).toFixed(3) : 0,
      northShare: cnt ? +(st.northCnt / cnt).toFixed(3) : 0,
      avgBuyWan: st.buyCnt ? +(st.buyWan / st.buyCnt).toFixed(1) : 0,
      singleStockConc: cnt ? +((topCode ? topCode[1] : 0) / cnt).toFixed(3) : 0,
    });
  }
  return out;
}

/** 对数压缩 + min-max 标准化（金额长尾压扁；零方差列恒 0）。 */
export function normalizeFeatures(rows, keys) {
  const lg = (v) => Math.log10(1 + Math.max(0, v));
  const cols = keys.map((k) => rows.map((r) => lg(Number.isFinite(+r[k]) ? +r[k] : 0)));
  const out = rows.map(() => ({}));
  keys.forEach((k, j) => {
    const col = cols[j];
    const mn = Math.min(...col), mx = Math.max(...col);
    const span = mx - mn;
    rows.forEach((r, i) => { out[i][k] = span > 0 ? +((col[i] - mn) / span).toFixed(4) : 0; });
  });
  return out;
}

const dist2 = (a, b, keys) => keys.reduce((s, k) => s + (a[k] - b[k]) ** 2, 0);

/** 确定性 k-means（首簇=前 k 个相互最远的样本；30 轮；空簇并入最远样本）。 */
export function kmeans(feats, keys, k = 5, rounds = 30) {
  if (feats.length <= k) return feats.map((_, i) => i);
  // 首簇：从样本[0]出发，贪心取相互欧氏距离最远的 k 个（确定性，无随机）
  const centers = [feats[0]];
  while (centers.length < k) {
    let best = -1, bestD = -1;
    for (let i = 0; i < feats.length; i++) {
      const d = Math.min(...centers.map((c) => dist2(feats[i], c, keys)));
      if (d > bestD) { bestD = d; best = i; }
    }
    centers.push(feats[best]);
  }
  let assign = new Array(feats.length).fill(0);
  for (let r = 0; r < rounds; r++) {
    // 分配
    assign = feats.map((f) => {
      let bi = 0, bd = Infinity;
      centers.forEach((c, ci) => { const d = dist2(f, c, keys); if (d < bd) { bd = d; bi = ci; } });
      return bi;
    });
    // 更新质心
    for (let ci = 0; ci < k; ci++) {
      const members = feats.filter((_, i) => assign[i] === ci);
      if (!members.length) continue;
      for (const key of keys) centers[ci][key] = members.reduce((s, m) => s + m[key], 0) / members.length;
    }
  }
  return assign;
}

/** 按簇质心规则命名（可解释优先）。 */
export function labelClusters(rows, assign, k = 5) {
  const KEYS = ['activeDays', 'buyWan', 'instShare', 'northShare', 'avgBuyWan'];
  const clusters = [];
  for (let ci = 0; ci < k; ci++) {
    const mem = rows.filter((_, i) => assign[i] === ci);
    if (!mem.length) { clusters.push({ id: ci, label: '空簇', size: 0, centroid: {} }); continue; }
    const cent = {};
    for (const key of KEYS) cent[key] = +(mem.reduce((s, m) => s + m[key], 0) / mem.length).toFixed(2);
    let label;
    if (cent.northShare >= 0.4) label = '北向通道';
    else if (cent.instShare >= 0.4) label = '机构通道';
    else if (cent.activeDays >= 15) label = '高频活跃席位';
    else if (cent.avgBuyWan >= 3000) label = '大额主力';
    else if (cent.activeDays >= 5) label = '活跃营业部';
    else label = '偶发席位';
    clusters.push({ id: ci, label, size: mem.length, centroid: cent });
  }
  return clusters;
}

/** 一站式：rows = collectSeatStats 输出 → { clusters, labels }。 */
export function clusterSeats(rows, k = 5) {
  const KEYS = ['activeDays', 'buyWan', 'sellWan', 'instShare', 'northShare', 'avgBuyWan', 'singleStockConc'];
  const feats = normalizeFeatures(rows, KEYS);
  const assign = kmeans(feats, KEYS, Math.min(k, rows.length));
  const clusters = labelClusters(rows, assign, Math.min(k, rows.length));
  const labels = {};
  rows.forEach((r, i) => {
    const c = clusters[assign[i]];
    labels[r.name] = { cluster: c.id, label: c.label, activeDays: r.activeDays, buyWan: r.buyWan, sellWan: r.sellWan, broker: r.broker };
  });
  return { clusters: clusters.filter((c) => c.size > 0), labels };
}
