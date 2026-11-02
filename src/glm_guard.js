// 场景三：GLM 附加过滤守卫（买前三合一闸门）。
//
// 把方向 A/B/C 三个 GLM 侧车档（军规#1：独立落盘、绝不改 emotion/regime 原始分数/状态机）
// 汇成一道「自动建仓前的附加过滤条件」，由 paper_daily 的自动买路径采纳——命中即拒买。
//   · 方向 A 排雷黑名单（data/llm_risk_blacklist.json）→ 确定性正向封禁（复用 src/risk_blacklist.js）；
//   · 方向 C 妖股逻辑（data/llm-dragon-logic-latest.json）→ 纯情绪炒作 / 高连板情绪驱动，谨慎不追高；
//   · 方向 B 板块情绪（data/macro-sector-sentiment-latest.json）→ 个股行业板块若属强利空板块，回避。
//
// 全部 fail-open：档缺失 / 空 / degraded / asOfDate 不符 → 该子闸不拦（绝不误伤正常候选）。
// 纯读档、零 LLM 调用、不改任何分数或状态机。

import { readFileSync, existsSync } from 'node:fs';
import { riskBlacklistReason } from './risk_blacklist.js';

const DRAGON_PATH = 'data/llm-dragon-logic-latest.json';
const SECTOR_PATH = 'data/macro-sector-sentiment-latest.json';

// 板块情绪过滤阈值：个股所属标准板块 score < 此值 → 自动建仓回避（强利空）。
const SECTOR_BEARISH_BLOCK = -0.4;

// 东财行业板块（细粒度 hybk）→ 场景二标准板块标签 的关键词映射（保守：仅高置信匹配；
// 匹配不上=不拦，fail-open，避免错杀正常候选）。
const HYBK_SECTOR_RULES = [
  { sector: '农业/种业/猪周期', kw: ['养殖', '种业', '种植', '饲料', '化肥', '农'] },
  { sector: '零售', kw: ['零售'] },
  { sector: '工程机械', kw: ['工程机械', '重工'] },
  { sector: '工业母机', kw: ['机床', '母机', '数控', '通用设备', '专用设备'] },
  { sector: '半导体/芯片', kw: ['半导体', '芯片', '集成电路', '封测', '光刻'] },
  { sector: '软件开发/AI应用', kw: ['软件', '计算机', 'IT', '互联网'] },
  { sector: '消费电子', kw: ['消费电子', '电子', '光学', '智能终端'] },
  { sector: '汽车', kw: ['汽车', '汽配', '整车'] },
  { sector: '锂电/新能源车', kw: ['锂电', '电池', '新能源车', '电动车'] },
  { sector: '光伏', kw: ['光伏', '太阳能', '硅'] },
  { sector: '军工', kw: ['军工', '航空装备', '航天', '国防', '卫星导航', '船舶'] },
  { sector: '航运/港口', kw: ['航运', '海运', '港口'] },
  { sector: '黄金/贵金属', kw: ['黄金', '贵金属', '珠宝'] },
  { sector: '创新药/CXO', kw: ['制药', '生物', '医药', '医疗', 'CXO', '创新药'] },
  { sector: '机器人', kw: ['机器人', '自动化'] },
  { sector: '低空经济', kw: ['低空', '无人机', '通航'] },
  { sector: '白酒/食饮', kw: ['白酒', '食品', '饮料', '乳业'] },
  { sector: '地产链', kw: ['地产', '物业', '家居', '建材'] },
  { sector: '银行', kw: ['银行'] },
  { sector: '保险', kw: ['保险'] },
  { sector: '证券', kw: ['证券', '券商'] },
  { sector: '电力', kw: ['电力', '发电', '电网'] },
  { sector: '煤炭', kw: ['煤炭'] },
  { sector: '钢铁', kw: ['钢铁'] },
  { sector: '化工', kw: ['化工', '化学'] },
  { sector: '家电', kw: ['家电', '电器'] },
  { sector: '油气', kw: ['石油', '石化', '油气'] },
  { sector: '有色', kw: ['有色', '金属', '铜', '铝', '稀土'] },
  { sector: '传媒', kw: ['传媒', '游戏', '影视'] },
  { sector: '通信', kw: ['通信', '5G', '光通信'] },
  { sector: '基建', kw: ['基建', '建筑', '路桥'] },
];

/** 把东财行业板块（hybk）映射到场景二标准板块标签；匹配不上返回 null（→ 不拦）。 */
export function sectorOfHybk(hybk) {
  if (!hybk) return null;
  const h = String(hybk);
  for (const r of HYBK_SECTOR_RULES) {
    if (r.kw.some((k) => h.includes(k))) return r.sector;
  }
  return null;
}

// 进程内缓存（paper_daily 单进程内多次调用，避免重复读盘）。
let _dragon = null;
let _sector = null;
function loadDragon() {
  if (_dragon === undefined) return _dragon; // 已探明缺失
  if (_dragon === null) {
    _dragon = (() => {
      if (!existsSync(DRAGON_PATH)) return undefined;
      try { return JSON.parse(readFileSync(DRAGON_PATH, 'utf8')); } catch { return undefined; }
    })();
  }
  return _dragon;
}
function loadSector() {
  if (_sector === undefined) return _sector;
  if (_sector === null) {
    _sector = (() => {
      if (!existsSync(SECTOR_PATH)) return undefined;
      try { return JSON.parse(readFileSync(SECTOR_PATH, 'utf8')); } catch { return undefined; }
    })();
  }
  return _sector;
}

/**
 * 买前 GLM 附加过滤（方向 A+B+C 三合一）。
 * @param {string} code 候选代码
 * @param {{hybk?:string, asOfDate?:string}} [opts]
 *        hybk     候选行业板块（来自 recommendPicks，用于方向 B 映射）
 *        asOfDate 当前交易日；若提供则与侧车档 asOfDate 比对，不符 → 该子闸跳过（防陈旧数据误杀）
 * @returns {{pass:boolean, reasons:string[], hits:{risk:boolean,dragon:boolean,sector:boolean}}}
 */
export function glmBuyGuard(code, opts = {}) {
  const { hybk, asOfDate } = opts;
  const reasons = [];
  const hits = { risk: false, dragon: false, sector: false };

  // ── 方向 A：排雷黑名单（确定性正向封禁；持续有效，不按 asOfDate 过期——立案/ST/减持属真实风险）──
  const rb = riskBlacklistReason(code);
  if (rb) { reasons.push(`排雷黑名单(${rb})`); hits.risk = true; }

  // ── 方向 C：妖股逻辑（纯情绪炒作 / 高连板情绪驱动 → 谨慎不自动追高）──
  const dl = loadDragon();
  if (dl && dl.degraded !== true && (!asOfDate || dl.asOfDate === asOfDate)) {
    const d = (Array.isArray(dl.dragons) ? dl.dragons : []).find((x) => String(x.code) === String(code));
    if (d && d.is_pure_sentiment) {
      reasons.push(`妖股逻辑·纯情绪炒作(${d.lb}板·${d.logic_type}${d.reason ? '·' + d.reason : ''})`);
      hits.dragon = true;
    }
  }

  // ── 方向 B：板块情绪（个股行业板块属强利空板块 → 回避）──
  //   注：宏观档板块标签可能是简化词（"黄金"）或复合词（"黄金/贵金属"），与 hybk 映射的复合标签
  //   不能直接相等。故按「复合标签拆 '/' 后的 token 是否在文件标签中出现」做匹配（前向，保守）。
  if (hybk) {
    const sm = loadSector();
    if (sm && sm.degraded !== true && (!asOfDate || sm.asOfDate === asOfDate)) {
      const rule = HYBK_SECTOR_RULES.find((r) => r.kw.some((k) => String(hybk).includes(k)));
      if (rule) {
        const tokens = rule.sector.split('/');
        const s = (Array.isArray(sm.sectors) ? sm.sectors : []).find((x) => tokens.some((t) => (x.sector || '').includes(t)));
        if (s && typeof s.score === 'number' && s.score < SECTOR_BEARISH_BLOCK) {
          reasons.push(`板块情绪利空(${s.sector} ${s.score})`);
          hits.sector = true;
        }
      }
    }
  }

  return { pass: reasons.length === 0, reasons, hits };
}
