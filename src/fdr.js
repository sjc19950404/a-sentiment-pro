// 多重检验校正（2026-11-09 外部拍板②：分别落实——先建工具，⑧c 验证账本样本攒够即用）
// 用途：任何「一次检验 N 个假设、然后挑选通过者」的场景——典型是 ⑧c 妖股验证账本
// 将来从 N 个被验证特征中挑选保留项时。背景（「因子挖掘工程框架」第七章第二类选择
// 性过拟合）：同期检验 N 个假设，5% 显著性下纯噪音也会产出约 N/20 个假阳性——
// 「样本外选因子」本身就是过拟合，必须按检验总数收紧阈值。
// 纪律：纯函数零 IO 零副作用；不接入任何现有判定链，供验证流程显式调用。

// Bonferroni：阈值 = α/n。最保守（控制族错误率 FWER），适合「确认性验证」——
// 挑选结果要直接进生产规则时用这个。
export function bonferroni(pValues, alpha = 0.05) {
  const n = pValues.length;
  if (!n) return { method: 'bonferroni', n: 0, alpha, threshold: null, rejected: [], k: 0, note: '空输入' };
  const threshold = alpha / n;
  const rejected = pValues.map((p) => p <= threshold);
  return {
    method: 'bonferroni', n, alpha, threshold, rejected,
    k: rejected.filter(Boolean).length,
    note: `Bonferroni：阈值 α/n = ${threshold.toPrecision(3)}（${n} 个同期检验）——最保守，控制族错误率；挑选结果将进生产规则时用此法`,
  };
}

// Benjamini-Hochberg：步进法控制错误发现率 FDR（期望的假阳性占比 ≤ α）。
// 比 Bonferroni 宽松，适合「探索性筛选」——先放宽捞候选，入围者再用确认性检验复核。
export function benjaminiHochberg(pValues, alpha = 0.05) {
  const n = pValues.length;
  if (!n) return { method: 'benjamini-hochberg', n: 0, alpha, k: 0, rejected: [], threshold: null, note: '空输入' };
  const idx = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  // 从最大秩往回找第一个满足 p(k) ≤ (k/n)·α 的 k，其排序前缀全部拒绝（BH 1995 步进法）
  let k = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (idx[i].p <= ((i + 1) / n) * alpha) { k = i + 1; break; }
  }
  const rejected = pValues.map(() => false);
  for (let i = 0; i < k; i++) rejected[idx[i].i] = true;
  return {
    method: 'benjamini-hochberg', n, alpha, k, rejected,
    threshold: k ? idx[k - 1].p : null,
    note: `BH-FDR：拒绝 ${k}/${n}——控制错误发现率（期望假阳性占比 ≤ α）；探索性筛选用此法，入围者建议再过 Bonferroni 复核`,
  };
}
