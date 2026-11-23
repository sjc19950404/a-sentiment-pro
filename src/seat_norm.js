/* seat_norm.js —— 席位名称标准化（2026-11-24 用户拍板：A 的目标——双字段 seatCode+seatName，
 * 匹配用标准化后的 seatName，seatCode 只做校验和去重）
 *
 * 【数据形态】archive.json 落盘时 lhb_codec 把席位名换成 meta.seatCodes 下标（数字），
 * archive-recent.latest 保留原名。读档侧必须 decodeArchive() 还原 seatName；seatCode
 * 只用于校验/去重，绝不参与匹配（数字 code 匹配任何文字 pattern 都不会命中——这正是
 * "因子上线起从未生效"的根因）。
 *
 * 【标准化规则（落库，唯一出处）】
 * 1. 全角→半角、去首尾/连续空白
 * 2. 去公司后缀：股份有限公司/有限责任公司/有限公司/证券营业部/营业部/分公司
 * 3. 去括号内容（含地区括注，如「(上海)」）
 * 4. 保留地名/路名/券商简称（patterns 依赖关键词命中：华鑫/拉萨/溧阳路…）
 * 5. 不做拼音、不做别名映射（清单自身用简称即可，避免引入不可核验的推断）
 *
 * 例："国投证券股份有限公司梅州分公司" → "国投证券梅州"
 *     "华鑫证券有限责任公司上海分公司" → "华鑫证券上海"
 */
export function normalizeSeatName(raw) {
  let s = String(raw == null ? '' : raw);
  // 1. 全角 ASCII → 半角
  s = s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  // 3. 去括号内容（中英文括号）
  s = s.replace(/[（(][^）)]*[）)]/g, '');
  // 2. 去公司/机构后缀——按长到短，只去尾部重复结构
  for (const suffix of ['证券营业部', '营业部', '股份有限公司', '有限责任公司', '有限公司', '分公司']) {
    s = s.split(suffix).join('');
  }
  // 1b. 压缩空白
  s = s.replace(/\s+/g, '').trim();
  return s;
}

/* 命中判定：标准化后的席位名 vs 标准化后的 pattern，任一 includes 即命中。
 * pattern 也标准化（清单里的"上海江苏路"等不受影响）。 */
export function seatMatchesPatterns(rawName, patterns) {
  const name = normalizeSeatName(rawName);
  if (!name) return false;
  return (Array.isArray(patterns) ? patterns : []).some((p) => {
    const pat = normalizeSeatName(p);
    return !!pat && name.includes(pat);
  });
}
