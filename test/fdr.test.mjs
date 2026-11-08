// 多重检验校正测试（2026-11-09 外部拍板②）：Bonferroni + Benjamini-Hochberg 经典例
import test from 'node:test';
import assert from 'node:assert/strict';
import { bonferroni, benjaminiHochberg } from '../src/fdr.js';

test('Bonferroni：阈值 α/n——4 个同期检验 0.05 → 0.0125', () => {
  const r = bonferroni([0.001, 0.006, 0.02, 0.5], 0.05);
  assert.equal(r.n, 4);
  assert.equal(r.threshold.toFixed(6), (0.05 / 4).toFixed(6));
  assert.deepEqual(r.rejected, [true, true, false, false]); // 0.006 ≤ 0.0125 也被拒
  assert.equal(r.k, 2);
});

test('Bonferroni：全噪音均匀 p 值大多被正确拒之门外', () => {
  // 20 个独立均匀噪音，Bonferroni 阈值 0.0025——期望拒绝数 ~0.05 个，几乎必为 0
  const ps = Array.from({ length: 20 }, (_, i) => 0.01 + i * 0.05); // 全部 > 0.0025
  const r = bonferroni(ps, 0.05);
  assert.equal(r.k, 0);
});

test('BH-FDR：多拒绝构造例——前 5 个 p 极小、其余噪音 → 拒绝前 5', () => {
  const ps = [0.001, 0.002, 0.003, 0.004, 0.02, 0.9, 0.9, 0.9, 0.9, 0.9];
  const r = benjaminiHochberg(ps, 0.05);
  // 步进：p(5)=0.02 ≤ (5/10)*0.05=0.025 ✓，p(6)=0.9 > 0.03 ✗ → k=5
  assert.equal(r.k, 5);
  assert.deepEqual(r.rejected, [true, true, true, true, true, false, false, false, false, false]);
});

test('BH-FDR：稀疏真信号例（0.001 在 n=30 下仅拒绝 1 个）', () => {
  const ps = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216, 0.222, 0.251,
    0.269, 0.275, 0.34, 0.341, 0.384, 0.569, 0.569, 0.574, 0.579, 0.586, 0.605, 0.624, 0.678,
    0.715, 0.842, 0.854, 0.902, 0.972];
  const r = benjaminiHochberg(ps, 0.05);
  // p(2)=0.008 > (2/30)*0.05=0.00333 → 只有 p(1)=0.001 ≤ 0.00167 成立 → k=1
  assert.equal(r.k, 1);
  assert.equal(r.rejected[0], true);
});

test('BH-FDR：全噪音不产生假发现（均匀 p，n=100）', () => {
  const ps = Array.from({ length: 100 }, (_, i) => (i + 1) / 100); // 均匀铺满 (0,1]
  const r = benjaminiHochberg(ps, 0.05);
  assert.equal(r.k, 0);
});

test('BH-FDR：单检验退化为普通检验', () => {
  const r = benjaminiHochberg([0.03], 0.05);
  assert.equal(r.k, 1);
});

test('空输入：两方法都安全返回', () => {
  assert.equal(bonferroni([], 0.05).n, 0);
  assert.equal(benjaminiHochberg([], 0.05).n, 0);
});
