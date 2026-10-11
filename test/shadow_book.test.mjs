// 影子账本（scripts/shadow_book.mjs）单测
//
// 锁两件事：
//   ① 阈值常量与回测**逐字一致**——影子样本要跟回测样本比，口径分叉就不可比了
//      （历史上 pain 的假期旧对正是"多入口各自判断"造成的分叉）；
//   ② 滚动分位**无前视**：warmup 内不出信号、阈值只由之前的历史算出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { thresholdsAt, EMO_WIN, EMO_LO_Q, EMO_HI_Q, EMO_WARMUP } from '../src/shadow_signal.js';

// 回测若仍自带一份常量定义（未改为 import 共享），两边就会分叉——这里锁住。
const SRC = readFileSync(new URL('../scripts/backtest_strategies.mjs', import.meta.url), 'utf8');
const SRC2 = readFileSync(new URL('../src/shadow_signal.js', import.meta.url), 'utf8');

test('回测不再自带阈值常量（必须 import 共享模块，杜绝两份定义）', () => {
  for (const name of ['EMO_WIN', 'EMO_LO_Q', 'EMO_HI_Q', 'EMO_WARMUP']) {
    assert.ok(
      !new RegExp(`^const ${name} = `, 'm').test(SRC),
      `${name} 仍在回测里单独定义——应改为 import（两份定义迟早分叉）`,
    );
  }
});

test('共享模块导出的常量值与回测原值一致（防止改共享时改错数值）', () => {
  assert.equal(EMO_WIN, 120);
  assert.equal(EMO_LO_Q, 0.15);
  assert.equal(EMO_HI_Q, 0.85);
  assert.equal(EMO_WARMUP, 60);
  for (const name of ['EMO_WIN', 'EMO_LO_Q', 'EMO_HI_Q', 'EMO_WARMUP']) {
    const b = SRC2.match(new RegExp(`export const ${name} = ([^;]+);`));
    assert.ok(b, `${name} 应在共享模块里导出`);
  }
});

test('thresholdsAt：warmup 不足 → 不出信号（宁可不出，不硬凑）', () => {
  const hist = Array.from({ length: 59 }, (_, i) => 30 + (i % 20));
  const t = thresholdsAt(hist);
  assert.equal(t.lo, null);
  assert.equal(t.hi, null, '不足 60 天历史不该出阈值');
});

test('thresholdsAt：达到 warmup → 给出 P15/P85，且 lo < hi', () => {
  const hist = Array.from({ length: 120 }, (_, i) => 10 + i * 0.6); // 10 → 81.4 单调
  const t = thresholdsAt(hist);
  assert.ok(t.lo != null && t.hi != null);
  assert.ok(t.lo < t.hi, 'P15 必须低于 P85');
  assert.ok(t.lo > 10 && t.hi < 82, '分位应落在样本区间内');
});

test('thresholdsAt：只用窗口内的历史（120 日），更早的被裁掉', () => {
  const old = Array.from({ length: 200 }, () => 1);   // 极早的历史（全 1）
  const recent = Array.from({ length: 120 }, (_, i) => 50 + i * 0.1); // 近期 50~62
  const t = thresholdsAt([...old, ...recent]);
  assert.ok(t.lo >= 50, `窗口外(全1)不应拉低分位，实际 lo=${t.lo}`);
});

test('阈值不含 T 日自身（无前视）：同样的 hist 连续调用结果稳定', () => {
  const hist = Array.from({ length: 100 }, (_, i) => 20 + (i % 50));
  const a = thresholdsAt(hist);
  const b = thresholdsAt(hist);
  assert.deepEqual(a, b, '纯函数：不改动入参、同输入同输出');
  assert.equal(hist.length, 100, '不得就地修改传入的历史');
});
