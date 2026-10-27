// 红包ETF轮动策略 · 纯逻辑测试（合成数据，无网络/无文件/无实盘）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  momentumReturn, pickEtfByMomentum, isForcedClose, isEvaluationDay,
  decideEtfHedge, formatHedgeReport, ETF_CODES, DEFAULT_LOOKBACK,
} from '../src/etf_rotation.js';

// ── 动量收益 ──
test('momentumReturn：上升序列 → 正收益', () => {
  const p = [10, 11, 12, 13, 14]; // 近20→取全部，14/10-1=0.4
  assert.ok(Math.abs(momentumReturn(p) - 0.4) < 1e-9);
});
test('momentumReturn：下降序列 → 负收益', () => {
  const p = [20, 18, 16, 14];
  assert.ok(Math.abs(momentumReturn(p) - (-0.3)) < 1e-9); // 14/20-1=-0.3
});
test('momentumReturn：持平 → 0', () => {
  assert.equal(momentumReturn([5, 5, 5]), 0);
});
test('momentumReturn：不足回看长度 → 取可用长度', () => {
  const p = [10, 12]; // 仅2点，区间收益 0.2
  assert.ok(Math.abs(momentumReturn(p, 20) - 0.2) < 1e-9);
});
test('momentumReturn：空/缺/起点为0 → null', () => {
  assert.equal(momentumReturn([]), null);
  assert.equal(momentumReturn(null), null);
  assert.equal(momentumReturn([0, 1]), null);
});

// ── 双 ETF 动量择优 ──
test('pickEtfByMomentum：A 动量更强 → 选 510880', () => {
  const m = { '510880': [1, 1.1, 1.2], '510300': [2, 1.9, 1.8] };
  const r = pickEtfByMomentum(m);
  assert.equal(r.winner, '510880');
  assert.ok(r.returns['510880'] > r.returns['510300']);
});
test('pickEtfByMomentum：B 动量更强 → 选 510300', () => {
  const m = { '510880': [1.2, 1.1, 1.0], '510300': [1, 1.1, 1.2] };
  const r = pickEtfByMomentum(m);
  assert.equal(r.winner, '510300');
});
test('pickEtfByMomentum：并列 → 取 510880', () => {
  const m = { '510880': [1, 1.1], '510300': [2, 2.2] }; // 同 +10%
  assert.equal(pickEtfByMomentum(m).winner, '510880');
});
test('pickEtfByMomentum：仅 B 有数据 → 选 510300', () => {
  const m = { '510880': [], '510300': [1, 1.1] };
  assert.equal(pickEtfByMomentum(m).winner, '510300');
});
test('pickEtfByMomentum：双双无数据 → winner=null', () => {
  const m = { '510880': [], '510300': [] };
  assert.equal(pickEtfByMomentum(m).winner, null);
});

// ── 是否强制空仓 ──
test('isForcedClose：仓位上限=0 → true', () => {
  assert.equal(isForcedClose({ positionCap: 0 }), true);
});
test('isForcedClose：仓位上限<0 → true（系统异常下限）', () => {
  assert.equal(isForcedClose({ positionCap: -0.1 }), true);
});
test('isForcedClose：硬止损 → 无条件 true', () => {
  assert.equal(isForcedClose({ positionCap: 0.5, hardStop: true }), true);
});
test('isForcedClose：仓位>0 且无硬止损 → false', () => {
  assert.equal(isForcedClose({ positionCap: 0.2 }), false);
});
test('isForcedClose：仓位未知(null) → false（不误判空仓）', () => {
  assert.equal(isForcedClose({ positionCap: null }), false);
});

// ── 周五判定（注入 getDay 规避时区抖动）──
test('isEvaluationDay：周五(5) → true', () => {
  assert.equal(isEvaluationDay({ getDay: () => 5 }), true);
});
test('isEvaluationDay：周六(6)/周三(3) → false', () => {
  assert.equal(isEvaluationDay({ getDay: () => 6 }), false);
  assert.equal(isEvaluationDay({ getDay: () => 3 }), false);
});

// ── 避险仓核心决策 ──
test('decideEtfHedge：非强制空仓 → 不参与（active:false）', () => {
  const d = decideEtfHedge({ forcedClose: false, pricesMap: { '510880': [1, 1.2], '510300': [1, 1.1] } });
  assert.equal(d.active, false);
  assert.equal(d.hedge, null);
});
test('decideEtfHedge：强制空仓 + A 优胜 → 避险持 510880', () => {
  const d = decideEtfHedge({ forcedClose: true, pricesMap: { '510880': [1, 1.3], '510300': [2, 1.9] } });
  assert.equal(d.active, true);
  assert.equal(d.hedge, '510880');
  assert.match(d.reason, /红利低波ETF/);
});
test('decideEtfHedge：强制空仓 + B 优胜 → 避险持 510300', () => {
  const d = decideEtfHedge({ forcedClose: true, pricesMap: { '510880': [1.2, 1.1], '510300': [1, 1.25] } });
  assert.equal(d.active, true);
  assert.equal(d.hedge, '510300');
});
test('decideEtfHedge：强制空仓 + 双 ETF 均无数据 → 等权持双 ETF 兜底', () => {
  const d = decideEtfHedge({ forcedClose: true, pricesMap: { '510880': [], '510300': [] } });
  assert.equal(d.active, true);
  assert.equal(d.hedge, 'both');
  assert.match(d.reason, /等权持双 ETF/);
});
test('decideEtfHedge：强制空仓 + 仅 B 有数据 → 避险持 510300', () => {
  const d = decideEtfHedge({ forcedClose: true, pricesMap: { '510880': [], '510300': [1, 1.2] } });
  assert.equal(d.active, true);
  assert.equal(d.hedge, '510300');
});

// ── 报告文案（只读展示，无交易指令）──
test('formatHedgeReport：非激活 → 原 reason', () => {
  const d = { active: false, reason: '主策略在交易，避险仓不参与' };
  assert.equal(formatHedgeReport(d), '主策略在交易，避险仓不参与');
});
test('formatHedgeReport：激活 + 单标的 → 含标的名', () => {
  const d = { active: true, hedge: '510880', reason: '强制空仓；择优持有红利低波ETF' };
  assert.match(formatHedgeReport(d), /红利低波ETF/);
  assert.match(formatHedgeReport(d), /避险标的/);
});

// ── 契约：ETF_CODES 恰为两标的、默认回看 20 ──
test('导出契约：双标的 + 默认回看 20 天', () => {
  assert.deepEqual(ETF_CODES.sort(), ['510300', '510880']);
  assert.equal(DEFAULT_LOOKBACK, 20);
});
