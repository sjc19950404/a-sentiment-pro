// lhb 上榜原因（reason/reasons）的码表压缩
//
// ── 为什么 ──────────────────────────────────────────────────────────────────
// archive 里 lhb 占 80.5%，而其中 reasons + reason 两个字段占**全档 46.2%**（2.87MB）。
// 根因：上榜原因是**高度重复的枚举文本**（全档只有 77 个唯一字符串，
// 却被引用上万次，如「连续三个交易日内，涨幅偏离值累计达到20%的证券」出现 1566 次）。
// 每条记录存一遍完整中文句子（40+ 字符）是纯浪费。
//
// ── 实测（241 天全档，主档 7.60MB）───────────────────────────────────────────
//   lhb              6.115 MB  80.5%   ← 其中 reason+reasons 文本占 46.2%（2.87MB）
//   lhb_aggr         0.654 MB   8.6%
//   hot              0.281 MB   3.7%
//   summary          0.248 MB   3.3%   ← 其中 seats.detail 单日 51KB，但首屏报告要用，不提
//   其余             0.30  MB   4.0%
// 码表压缩只作用于 reason/reasons：2910.4KB → 226.6KB（压缩率 92.2%），
// 全档 7.60MB → **4.99MB**。lhb 编码后仍有 3.49MB（占主档 70%），
// 剩余体积是每条记录重复的 code/name/数值字段——见文件末尾「体积的真实构成」。
//
// ── 怎么做 ──────────────────────────────────────────────────────────────────
// 落盘/传输层把文本换成**码表下标**：
//   · 码表（77 条字符串）放档案级 `meta.reasonCodes`，全局只存一份
//   · 每条记录 `rc: [0,3]`（数字下标数组）代替 `reasons: ["...","..."]`
//   · 兼容旧格式：仍然读 reason/reasons，压缩只是**存储优化**，不是口径变更
//
// ── 铁律：只在存储层压缩，内存里必须还原成原文 ────────────────────────────────
// 口径守卫、RANGE_BOARD_RE、NEW_STOCK_RE 全部依赖**中文原文**做正则匹配。
// 若内存里留着下标，`isRangeBoard()` 会静默失配——而失配的表现是
// 「区间榜被当成当日榜」，会直接把区间累计值算进日度因子，是最严重的一类错。
// 故：encode 只用于写盘，decode 在读盘后**必须立即调用**，且 decode 后不得再有 encode。
//
// 不变量（守卫会验）：decode(encode(x)) 与 x 逐字段等价。

/** 从全档收集唯一上榜原因，按下标建码表。排序保证码表稳定（同样输入必得同样码表）。 */
export function buildReasonCodes(days) {
  const set = new Set();
  for (const d of Array.isArray(days) ? days : []) {
    for (const l of (d && d.lhb) || []) {
      const rs = Array.isArray(l.reasons) && l.reasons.length ? l.reasons : (l.reason ? [l.reason] : []);
      for (const r of rs) if (r) set.add(r);
    }
  }
  return [...set].sort();
}

/**
 * 压缩一天的 lhb 记录：reason/reasons → rc（下标数组）。
 * 幂等：已压缩（有 rc、无 reasons/reason 文本）的记录原样返回。
 */
export function encodeDay(day, codes) {
  if (!day || !Array.isArray(day.lhb)) return day;
  const idx = new Map(codes.map((c, i) => [c, i]));
  const lhb = day.lhb.map((l) => {
    if (Array.isArray(l.rc)) return l; // 已压缩
    const rs = Array.isArray(l.reasons) && l.reasons.length ? l.reasons : (l.reason ? [l.reason] : []);
    const rc = [...new Set(rs)].map((r) => (idx.has(r) ? idx.get(r) : -1));
    // reason 是 reasons 的首条（同源），故只存 rc 即可还原；不再单独存 reason 文本
    const { reason, reasons, ...rest } = l;
    return { ...rest, rc };
  });
  return { ...day, lhb };
}

/**
 * 还原：rc → reason / reasons（保持原有语义：reasons 数组 + reason 取首条）。
 * 未压缩的天（有 reasons 无 rc）原样返回，保证兼容存量档案。
 */
export function decodeDay(day, codes) {
  if (!day || !Array.isArray(day.lhb)) return day;
  const lhb = day.lhb.map((l) => {
    if (!Array.isArray(l.rc)) return l; // 旧格式，已是明文
    const reasons = l.rc.map((i) => codes[i]).filter((x) => typeof x === 'string');
    const { rc, ...rest } = l;
    return { ...rest, reasons, reason: reasons[0] ?? '—' };
  });
  return { ...day, lhb };
}

/**
 * 整档序列化（写盘/传输前调用一次）。返回新对象，不修改入参。
 *
 * 默认**只做码表压缩**（这是唯一真正省体积的一级）。提子（deflateDay）默认关闭，
 * 因为它对体积零收益却会让 `day.lhb` 变成 `day._sub.lhb`——多一层间接，读到的人
 * 还得先 inflate 才能用。传 `{ deflate: true }` 才启用，供**切片滚动窗**这类
 * 真的想把 lhb 挡在首屏之外的地方使用。
 */
export function encodeArchive(archive, codes, opts = {}) {
  const list = Array.isArray(archive?.all_days) ? archive.all_days : [];
  const enc = (d) => encodeDay(d, codes);
  const out = {
    ...archive,
    all_days: opts.deflate ? list.map((d) => deflateDay(enc(d))) : list.map(enc),
  };
  out.meta = { ...(archive.meta || {}), reasonCodes: codes, reasonEncoding: 'rc-v1' };
  return out;
}

/**
 * 还原 rc → reasons，但先把「原子级」的粗字段还原回父对象。
 * 序列化时用同一条「提子」规则，故两者天然互逆。
 */
export function decodeArchive(archive) {
  const codes = archive?.meta?.reasonCodes;
  const hasCodes = Array.isArray(codes) && codes.length;
  const list = Array.isArray(archive?.all_days) ? archive.all_days : [];
  if (!hasCodes && !list.some((d) => Array.isArray(d?._sub))) return archive;
  return {
    ...archive,
    all_days: list.map((d) => {
      const inflated = inflateDay(d);
      return hasCodes ? decodeDay(inflated, codes) : inflated;
    }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 惰性字段提子（lazy extraction）
//
// ── ⚠ 实证修正：提子对「主档体积」零收益 ─────────────────────────────────────
// 本节最初的设计意图是"把大字段移出主档以省体积"。实测（241 天全档，编码后）：
//
//     仅码表        4.99 MB
//     码表 + 提子   4.99 MB   （差 0.0 KB）
//
// 原因是**提子只是改名**：`day.lhb` → `day._sub.lhb`，字节数几乎不变（多 7 字节/天
// 的 `_sub` 包装）。真正的"省体积"需要**把 lhb 从主档删掉、只留在别的文件里**——
// 但那会让 `audit_lhb_caliber.mjs`（读主档验 241 天不变量）失去输入，
// 也就是"用审计完整性换体积"，不可接受。
//
// 所以本节的真实价值**不在主档，而在切片**：
//   · 主档：保留 lhb 内联，提子恒为空转（deflateDay 返回原对象），体积由码表负责
//   · 切片：`archive-recent.json` 的**滚动窗历史日**用 trendPoint 裁字段，
//            `lhb` 天然不在其中；只有 `latest` 一天带 lhb
//   · 前端：`pendingFields`/`pickDay` 让"某天还没加载 lhb"可被显式查询，
//            而不是"读出来是 undefined，所以当成没有"
// 保留下面的函数是因为 `pickDay`/`pendingFields` 是前端**按需加载**所需的能力，
// 而 `deflateDay`/`inflateDay` 是它的互逆对，删掉会让 `decodeArchive`
// 在读到"真被提过的档"时无法还原（向后兼容）。
//
// ── 为什么不提 seats ───────────────────────────────────────────────────────
// `summary.seats`（单日 51KB，曾是最大的一块）**曾被提走又被放回**，原因值得记下：
//   提走的动机是省流量；放回是因为**研判报告的「席位分项」与「锁仓统计」需要它**——
//   而报告是首屏就要渲染的。提走后报告里那两段会静默消失（`if (seats && seats.cover)`
//   直接跳过），表现为"报告少了结论"，用户无从察觉。
// 结论：**惰性字段的判定标准不是"大不大"，而是"首屏渲染是否用到"**。
//   用到 → 不能提；只有用户主动下钻才用 → 才提。
// 此处按用户决策（首屏一并拉）保留 seats 内联。
//
// ── 体积的真实构成（供后人少走弯路）─────────────────────────────────────────
// 全档 7.60 MB 中 `lhb` 占 6.12 MB（80.5%）；其中 reason/reasons 文本占 46.2%，
// 码表压缩后 lhb 降到 3.49 MB（仍占主档 70%），剩下的几乎全是**每条记录都重复的
// 数值与名称字段**（code/name/buy_wan/sell_wan/deal_wan/net_buy_wan/close/
// change_pct/turnover_pct）。下一轮若要继续瘦身，方向是这些字段的**列式/增量编码**
// 或 `code → name` 名称表，而不是"提子"。
// ════════════════════════════════════════════════════════════════════════════

/** 需提到 `_sub` 的字段（唯一出处）。 */
export const SUBSCRIBE_FIELDS = ['lhb'];

/**
 * 从 day 顶层「提子」：把 SUBSCRIBE_FIELDS 搬到 day._sub。无内容则不产生 _sub。
 *
 * 目前只提 `lhb`。提走 `lhb` 后 `quotesFromDay`（模拟器结算要读 day.lhb 取收盘价）
 * 会取不到值——那条路径已在消费端用 liftSeats（paper_ui.js）/ inflateDay 显式还原，
 * 不是"静默变空"。
 */
export function deflateDay(day) {
  if (!day || typeof day !== 'object') return day;
  const sub = {};
  let moved = 0;
  const rest = { ...day };
  for (const f of SUBSCRIBE_FIELDS) {
    const v = day[f];
    if (v == null) continue;
    sub[f] = v;
    delete rest[f];
    moved++;
  }
  if (!moved) return day;
  return { ...rest, _sub: sub };
}

/** inflateDay 的逆操作：把 `_sub` 里的字段搬回顶层。读盘后**必须**先调用一次。 */
export function inflateDay(day) {
  if (!day || !day._sub || typeof day._sub !== 'object') return day;
  const { _sub, ...rest } = day;
  for (const f of SUBSCRIBE_FIELDS) {
    if (_sub[f] != null) rest[f] = _sub[f];
  }
  return rest;
}

/**
 * 按需取字段：若字段还在 `_sub` 里，返回**已还原该字段**的新 day（其余不动）。
 * 前端加载切片后先 pickDay(d, ['lhb']) 再消费即可，不必拉整档。
 */
export function pickDay(day, fields = SUBSCRIBE_FIELDS) {
  if (!day || !day._sub) return day;
  const want = new Set(fields);
  const merged = { ...day, _sub: { ...day._sub } };
  let moved = 0;
  for (const f of SUBSCRIBE_FIELDS) {
    if (!want.has(f) || merged._sub[f] == null) continue;
    merged[f] = merged._sub[f];
    delete merged._sub[f];
    moved++;
  }
  if (!moved) return day;
  if (!Object.keys(merged._sub).length) delete merged._sub;
  return merged;
}

/** 该 day 是否仍有未加载的惰性字段。 */
export function pendingFields(day) {
  return day && day._sub ? Object.keys(day._sub) : [];
}

/** 统计：码表压缩前后的体积（供 CI/报告留痕）。 */
export function compressionStats(archive) {
  const days = (archive?.all_days || []);
  const codes = buildReasonCodes(days);
  const idx = new Map(codes.map((c, i) => [c, i]));
  const pick = (l, withCodes) => {
    const rs = Array.isArray(l.reasons) && l.reasons.length ? l.reasons : (l.reason ? [l.reason] : []);
    return withCodes
      ? { rc: [...new Set(rs)].map((r) => (idx.has(r) ? idx.get(r) : -1)) }
      : { reason: l.reason, reasons: l.reasons };
  };
  const size = (withCodes) => Buffer.byteLength(JSON.stringify(
    days.map((d) => (d.lhb || []).map((l) => pick(l, withCodes))),
  ), 'utf8');
  const before = size(false), after = size(true);
  return { codes: codes.length, before, after, savedRatio: before ? 1 - after / before : 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// 落盘助手：所有**会回写主档**的脚本必须用它，不得手写 JSON.stringify
//
// ── 为什么要有这个 ─────────────────────────────────────────────────────────
// 存档是压缩态（reason → rc 码表 + lhb 提子）。任何"读进来 → 改一点 → 写回去"
// 的脚本若直接 `writeFileSync(FILE, JSON.stringify(a, null, 2))`，会产生两份坏档：
//   ① 缩进：紧凑 4.99MB → 缩进 9.22MB，压缩收益全丢
//   ② 更致命：档里记录仍是 rc 下标，但重编码这一步被跳过——若同时把
//      meta.reasonCodes 也写丢（或写成了明文混下标），解码会整体回退成
//      `reasons: [undefined]`，表现是 **reason 全变 '—'、RANGE_BOARD_RE 静默失配**，
//      即「区间累计榜被当成当日榜」，区间值混进日度因子。这是本项目最严重的一类错。
// 本项目已发生过一次同类事故（"从已被污染的档二次迁移"丢了 2 天 seats），
// 故把往返封在这里，并带**写盘前自检**：往返不一致就拒绝写。
//
// 用法：
//   const a = readArchiveForEdit(FILE);   // 解码 → 改 → 这里
//   ...
//   writeArchiveSafely(FILE, a);          // 重编码 + 自检 + 紧凑写盘
// ════════════════════════════════════════════════════════════════════════════

/** 读主档并**还原成明文态**（供"改一点再写回"的脚本使用）。 */
export function readArchiveForEdit(filePath, readFileSync) {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  return decodeArchive(raw);
}

/** 占位符：decodeDay 在 rc 解析不出字符串时给出的值（即"原因丢失"的信号）。 */
export const REASON_PLACEHOLDER = '\u2014'; // —

/**
 * 把（明文态的）存档**重编码后紧凑写盘**，写前做往返自检。
 *
 * 自检判据（任一命中即拒绝写盘）：
 *   ① 天数变化 —— 丢天
 *   ② lhb 记录条数变化 —— 丢榜
 *   ③ 解码后出现**占位符 reason**（'—'）—— 这是"原因文本丢了"的唯一信号。
 *      必须查占位符而不是查"是不是字符串"：decodeDay 在 rc 解析失败时恰好会写 '—'，
 *      于是"类型检查"永远通过，坏档照样落盘。这是本条自检真正要拦的东西。
 *   ④ 编码前后 reason 文本集合不一致 —— 最直接的整体等价判据
 * @returns {{codes:number, days:number, bytes:number}} 写出信息
 * @throws 往返不一致时抛错，**不写盘**
 */
export function writeArchiveSafely(filePath, archive, fsMod) {
  const { writeFileSync } = fsMod;
  const days = archive.all_days || [];
  // 编码前：收集每天的 (日期 → reason 文本集合)，作为"语义指纹"
  const fingerprint = (list) => list.map((d) => [
    d.trade_date,
    (d.lhb || []).map((r) => (Array.isArray(r.reasons) && r.reasons.length ? r.reasons.join('\u0000') : String(r.reason ?? ''))).join('\u0001'),
  ].join('\u0002')).join('\u0003');

  const codes = buildReasonCodes(days);
  // 落盘态统一「码表 + 提子」两级（与 pipeline.writeArchive 一致，审计按此断言）。
  // 提子对体积零收益（只是 lhb → _sub.lhb 改名），但它是**审计的输入形态**：
  // audit_lhb_caliber 断言"主档写盘态 lhb 已提子"，且分片/前端按 _sub 语义处理。
  // 若此处不提子，就与 split_archive / pipeline 写出的形态不一致，属"两套口径"。
  const packed = encodeArchive(archive, codes, { deflate: true });
  const back = decodeArchive(JSON.parse(JSON.stringify(packed)));
  const backDays = back.all_days || [];
  const count = (list) => list.reduce((n, d) => n + (d.lhb || []).length, 0);
  const placeholder = backDays.some((d) => (d.lhb || []).some((r) => r.reason === REASON_PLACEHOLDER));
  const fpBefore = fingerprint(days);
  const fpAfter = fingerprint(backDays);
  if (days.length !== backDays.length || count(days) !== count(backDays) || placeholder || fpBefore !== fpAfter) {
    const e = new Error('[lhb_codec] 往返自检失败，拒绝写盘：'
      + `天数 ${days.length}→${backDays.length}、lhb ${count(days)}→${count(backDays)}`
      + `、reason 丢失 ${placeholder}、文本指纹一致 ${fpBefore === fpAfter}`);
    e.code = 'ROUNDTRIP_MISMATCH';
    throw e;
  }
  const text = JSON.stringify(packed); // 紧凑：缩进会白吃压缩收益（4.99MB → 9.22MB）
  writeFileSync(filePath, text, 'utf8');
  return { codes: codes.length, days: days.length, bytes: Buffer.byteLength(text) };
}
