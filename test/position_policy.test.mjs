// V5.3 仓位区间策略层 position_policy.js —— 真调用断言
//   锁死的口径：① 区间数字唯一出处；② regime 保持纯分类（不含仓位字段）；
//   ③ unknown 不给区间（缺失显式化）；④ shift 为强制降仓档。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POSITION_BANDS, CONSERVATIVE_BAND, bandFor, formatBand, positionLine, DISCLAIMER,
} from '../src/position_policy.js';

test('bandFor: 七档映射齐全（含 V5.3 新增 shift），区间数字与需求文档一致', () => {
  assert.deepEqual(
    [bandFor('ice').minPos, bandFor('ice').maxPos], [0.0, 0.2], '冰点 0~20%');
  assert.deepEqual(
    [bandFor('ebb').minPos, bandFor('ebb').maxPos], [0.0, 0.2], '退潮 0~20%');
  assert.deepEqual(
    [bandFor('recover').minPos, bandFor('recover').maxPos], [0.3, 0.5], '复苏 30~50%');
  assert.deepEqual(
    [bandFor('neutral').minPos, bandFor('neutral').maxPos], [0.3, 0.5], '中性 30~50%');
  assert.deepEqual(
    [bandFor('climax').minPos, bandFor('climax').maxPos], [0.6, 1.0], '主升 60~100%');
  assert.deepEqual(
    [bandFor('shift').minPos, bandFor('shift').maxPos], [0.0, 0.3], '切换期 ≤30%');
});

test('bandFor: ★ shift 是强制降仓档（force=true，限制新开进攻仓）', () => {
  const b = bandFor('shift');
  assert.equal(b.force, true);
  assert.match(b.advice, /限制新开进攻仓/);
  // 其余档不得带 force（force 是切换期专属语义）
  for (const k of ['ice', 'ebb', 'recover', 'neutral', 'climax']) {
    assert.notEqual(bandFor(k).force, true, `${k} 不应带 force`);
  }
});

test('bandFor: ★ unknown / 未知 key / null → null（缺失显式化，绝不给区间）', () => {
  assert.equal(bandFor('unknown'), null);
  assert.equal(bandFor(null), null);
  assert.equal(bandFor('nope'), null);
  assert.equal(bandFor(''), null);
});

test('bandFor: 返回副本（改返回值不得污染唯一出处表）', () => {
  const b = bandFor('climax');
  b.maxPos = 0.123;
  assert.equal(POSITION_BANDS.climax.maxPos, 1.0);
});

test('formatBand: 百分比文案（0.2 → "0%~20%"）与缺失输入', () => {
  assert.equal(formatBand(bandFor('recover')), '30%~50%');
  assert.equal(formatBand(bandFor('shift')), '0%~30%');
  assert.equal(formatBand(null), null);
  assert.equal(formatBand({}), null);
});

test('positionLine: 一句话含区间与动作口径；shift 带强制语义', () => {
  const n = positionLine('neutral');
  assert.match(n.text, /推荐仓位区间 30%~50%/);
  assert.equal(n.force, false);
  const s = positionLine('shift');
  assert.match(s.text, /强制降仓/);
  assert.equal(s.force, true);
  assert.equal(positionLine('unknown'), null);
  assert.equal(positionLine(null), null);
});

test('CONSERVATIVE_BAND: 保守回退档为 0~20% 且带 fallback 标识', () => {
  assert.deepEqual([CONSERVATIVE_BAND.minPos, CONSERVATIVE_BAND.maxPos], [0.0, 0.2]);
  assert.equal(CONSERVATIVE_BAND.fallback, true);
});

test('★ 决策锁：regime 档位全部有区间或显式 unknown（新增档不漏配）', async () => {
  // 将来 regime 再加档（如拆分冰点/恐慌），若忘了配区间，这条测试会红
  const { REGIME_LABELS } = await import('../src/regime.js');
  for (const meta of Object.values(REGIME_LABELS)) {
    if (meta.key === 'unknown') continue; // unknown 走保守回退，明确豁免
    assert.ok(POSITION_BANDS[meta.key], `regime 档「${meta.key}」缺仓位区间配置`);
  }
});

test('★ 决策锁：区间是风控帽子非买卖信号（disclaimer 固定输出）', () => {
  assert.match(DISCLAIMER, /风控参考上限/);
  assert.match(DISCLAIMER, /不构成投资建议/);
  assert.match(DISCLAIMER, /仓位帽子/);
});

test('★ 决策锁：position_policy 不得反向依赖 regime（regime 保持纯分类）', async () => {
  // regime.js 的设计纪律是"标签是描述不是建议"——若 regime 反过来 import
  // position_policy，职责边界就被打破（分类层给建议）。锁依赖图。
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../src/regime.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/from\s+['"]\.\/position_policy\.js['"]/.test(code),
    'regime.js 引入了 position_policy.js —— 分类层不得包含仓位建议（职责边界）');
});

// ── 展示层合并（2026-10-24）：基础仓位 × 风控帽 合成 ───────────────────────
import {
  scoreToBand, reconcilePosition, positionNarrative,
} from '../src/position_policy.js';

test('scoreToBand: 情绪分 → 基础仓位（与 POSITION_BANDS 同尺度，阈值锁死）', () => {
  assert.deepEqual([scoreToBand(88.5).minPos, scoreToBand(88.5).maxPos], [0.6, 1.0], '≥80 → 进攻 60~100%');
  assert.deepEqual([scoreToBand(70).minPos, scoreToBand(70).maxPos], [0.3, 0.6], '65~80 → 偏多');
  assert.deepEqual([scoreToBand(55).minPos, scoreToBand(55).maxPos], [0.3, 0.5], '50~65 → 中性');
  assert.deepEqual([scoreToBand(40).minPos, scoreToBand(40).maxPos], [0.0, 0.3], '<50 → 防守');
});

test('scoreToBand: 缺失显式化（null / undefined / 非数 → null，绝不补 0）', () => {
  assert.equal(scoreToBand(null), null);
  assert.equal(scoreToBand(undefined), null);
  assert.equal(scoreToBand('nope'), null);
  assert.equal(scoreToBand(NaN), null);
});

test('reconcilePosition: 情绪喊冲 × 风控盖帽 → 冲突，最终以帽为准', () => {
  const r = reconcilePosition({ score: 88.5, regimeKey: 'shift' });
  assert.equal(r.conflict, true, '88.5(基础60~100) vs shift帽0~30 → 冲突');
  assert.equal(r.finalRange, '0%~30%', '最终执行 = 风控帽');
  assert.equal(r.force, true);
  assert.equal(r.baseRange, '60%~100%');
  assert.equal(r.cap.key, 'shift');
  // 偏多(30~60) 遇强制降仓帽同样冲突
  assert.equal(reconcilePosition({ score: 72, regimeKey: 'shift' }).conflict, true);
});

test('reconcilePosition: 同向 / 低风险场景不误报冲突', () => {
  assert.equal(reconcilePosition({ score: 88.5, regimeKey: 'climax' }).conflict, false, 'climax×climax 同向');
  assert.equal(reconcilePosition({ score: 55, regimeKey: 'neutral' }).conflict, false, '中性×中性');
  assert.equal(reconcilePosition({ score: 40, regimeKey: 'ebb' }).conflict, false, '低分防守遇 risk-off 帽不算冲突');
  assert.equal(reconcilePosition({ score: 72, regimeKey: 'recover' }).conflict, false, '偏多遇 30~50 帽不算冲突');
});

test('reconcilePosition: 任一口径缺失 → null（显式化，不猜）', () => {
  assert.equal(reconcilePosition({ score: null, regimeKey: 'shift' }), null);
  assert.equal(reconcilePosition({ score: 88.5, regimeKey: 'bogus' }), null);
  assert.equal(reconcilePosition({ score: 88.5, regimeKey: 'unknown' }), null);
});

test('positionNarrative: 冲突叙述含「假繁荣预警/强制降仓/只减仓不新建」', () => {
  const r = reconcilePosition({ score: 88.5, regimeKey: 'shift' });
  const t = positionNarrative(r, { regLabel: r.cap.label, divergence: true });
  assert.match(t, /假繁荣预警/);
  assert.match(t, /regime=shift 风控帽/);
  assert.match(t, /强制降仓/);
  assert.match(t, /只减仓不新建/);
  assert.match(t, /最终执行仓位：0%~30%/);
});

test('positionNarrative: 同向叙述不过度告警', () => {
  const r = reconcilePosition({ score: 55, regimeKey: 'neutral' });
  const t = positionNarrative(r, { regLabel: r.cap.label });
  assert.match(t, /最终执行仓位：30%~50%/);
  assert.ok(!/强制降仓/.test(t));
  assert.equal(positionNarrative(null), null);
});
