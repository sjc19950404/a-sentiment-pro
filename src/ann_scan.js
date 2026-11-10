/**
 * 公告轻量关键词避雷扫描（2026-11-10，六方向 #6，用户拍板「一步步落实」）。
 *
 * 定位：纯函数，只扫**公告标题**（不碰 PDF 正文——标题+摘要足够识别避雷信号，
 *   正文抽取是重活且引入 PDF 依赖）。消费方后续接线（拍板制）：本模块只产证据，
 *   不直接改任何选股/仓位逻辑——「披露不判定」纪律同因子仪表。
 *
 * 词库两级（避雷器，不做利好面）：
 *   high 红线级：立案/留置/退市/终止上市/处罚/冻结/无法表示意见 等——出现即高危；
 *   mid  观察级：减持/质押/诉讼/问询/预亏/减值/逾期 等——常见且常中性，需人工看语境。
 * 豁免规则：
 *   1. 「股票交易异常波动」公告——连板票人人都有，非风险信号，跳过；
 *   2. 标题含「澄清」且命中 mid 词 → 该命中降级为 low（公司已回应语境），
 *      high 词不降级（立案/退市澄清不了）。
 *
 * 命中判定用简单的 includes 全匹配（词库即正则转义后的字面量），毫秒级、零依赖。
 */

export const ANN_WORDS = {
  high: [
    '立案', '留置', '逮捕', '刑事拘留', '强制退市', '终止上市', '退市风险',
    '行政处罚', '纪律处分', '司法冻结', '股份冻结', '被冻结',
    '无法表示意见', '否定意见', '重大违法', '强制措施',
  ],
  mid: [
    '减持', '质押', '诉讼', '仲裁', '问询函', '关注函', '监管函',
    '业绩预亏', '预亏', '商誉减值', '减值准备', '债务逾期', '担保逾期',
    '资金占用', '违规担保', '暂停上市', '业绩下修', '平仓',
  ],
  // 中性/流程性公告词——命中它整体跳过（在 high/mid 之前判定）
  skip: ['股票交易异常波动', '异常波动公告'],
};

/** 词面量安全匹配（词库是字面量，不做正则）。 */
const hitWords = (title, words) => words.filter((w) => String(title).includes(w));

/**
 * 扫描单条公告标题 → { level: 'high'|'mid'|'low'|null, words, skipReason }。
 * level=null = 无风险信号（或整体跳过）。
 */
export function scanTitle(title) {
  const t = String(title || '');
  if (!t) return { level: null, words: [] };
  const skip = hitWords(t, ANN_WORDS.skip);
  if (skip.length) return { level: null, words: [], skipReason: skip[0] };
  const high = hitWords(t, ANN_WORDS.high);
  if (high.length) return { level: 'high', words: high };
  const mid = hitWords(t, ANN_WORDS.mid);
  if (!mid.length) return { level: null, words: [] };
  // 澄清豁免：mid 命中 + 标题含「澄清」→ 降级 low（公司已回应）；high 不降级
  if (t.includes('澄清')) return { level: 'low', words: mid };
  return { level: 'mid', words: mid };
}

/**
 * 扫描 details 数组（announcements-latest.json 的 details 字段同构）。
 * 返回 { scanned, flagged, ok } —— flagged 按 high > mid > low 排序。
 */
export function scanAnnouncements(details) {
  const list = Array.isArray(details) ? details : [];
  const flagged = [];
  let scanned = 0;
  for (const d of list) {
    if (!d || !Array.isArray(d.announcements)) continue;
    for (const a of d.announcements) {
      const r = scanTitle(a && a.title);
      if (r.skipReason) continue;
      scanned++;
      if (r.level) {
        flagged.push({
          code: String(d.code || ''), name: d.name || null,
          level: r.level, words: r.words,
          title: a.title || '', date: a.date || null, url: a.url || null,
        });
      }
    }
  }
  const rank = { high: 0, mid: 1, low: 2 };
  flagged.sort((x, y) => rank[x.level] - rank[y.level]);
  return { scanned, flagged, ok: scanned - flagged.length };
}
