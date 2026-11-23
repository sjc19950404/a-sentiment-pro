import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketTier, suggestWeight, marketTierVersion, TIER_MODE_FLAG } from '../src/picks.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* 【2026-11-24 端到端门禁（事故固化）】
 * 产物 marketTierVersion 含 alert_only ⇔ 产物中不存在任何非 null 的仓位档字段。
 * 今天的事故：flag=alert_only 但 marketTier() 仍返回 pos——版本戳写 alert_only、
 * 实际按旧档分仓——版本戳主动说假话，污染审计链。这条测试让同类漂移当场炸。 */
const POSITION_FIELDS = ['pos', 'allowNew', 'targetPos', 'tierPos', 'position', 'alloc'];
function walk(o, fn, path = '$') {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach((v, i) => walk(v, fn, path + '[' + i + ']')); return; }
  for (const [k, v] of Object.entries(o)) {
    fn(k, v, path + '.' + k);
    walk(v, fn, path + '.' + k);
  }
}

test('端到端：版本戳 alert_only ⇔ 无仓位档字段（双向断言）', () => {
  const ver = marketTierVersion();
  const isAlertMode = ver.includes('alert_only');
  assert.equal(TIER_MODE_FLAG.mode, isAlertMode ? 'alert_only' : TIER_MODE_FLAG.mode);

  // ① 判档函数层：alert_only 下 tier 必须保留，pos/allowNew 必须 null
  for (const score of [10, 30, 50, 70, 85.2, 95]) {
    const t = marketTier(score);
    assert.ok(t, '判档不得为空');
    assert.ok(t.tier && t.key && t.label, 'tier 标签字段必须保留（报告/告警要用）');
    if (isAlertMode) {
      assert.equal(t.pos, null, 'alert_only 下 pos 必须为 null');
      assert.equal(t.allowNew, null, 'alert_only 下 allowNew 必须为 null');
      assert.ok(t.alert && t.alert.text.includes('仅告警'), 'alert_only 下必须有告警文案');
    } else {
      assert.ok(typeof t.pos === 'number', '非 alert_only 下 pos 必须存在');
    }
  }

  // ② 产物层：扫描落档 json——版本戳 alert_only 的产物不得藏仓位档字段
  for (const f of ['data/reco_picks_latest.json', 'data/reconcile_picks_latest.json']) {
    const p = resolve(ROOT, f);
    if (!existsSync(p)) continue;
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    const docIsAlert = String(doc.marketTierVersion || '').includes('alert_only');
    assert.equal(docIsAlert, isAlertMode, `${f} 版本戳与运行时 flag 不一致`);
    if (docIsAlert) {
      const bad = [];
      walk(doc, (k, v, path) => {
        if (POSITION_FIELDS.includes(k) && v != null) bad.push(path + '=' + JSON.stringify(v));
      });
      assert.equal(bad.length, 0, `${f} 声明 alert_only 却存在非 null 仓位档字段: ${bad.slice(0, 5).join(', ')}`);
    }
  }
});

test('C 形态仓位：满仓 beta 1/n、无候选 0、硬风控可覆盖', () => {
  const t = marketTier(85.2);
  if (!marketTierVersion().includes('alert_only')) return;
  assert.equal(suggestWeight(t, 5), 0.2);
  assert.equal(suggestWeight(t, 0), 0, '无候选必须返回 0');
  assert.equal(suggestWeight(t, 5, { riskWeight: 0.5 }), 0.1, '回撤/止损硬风控必须可覆盖 1/n');
  assert.equal(suggestWeight(t, 5, { riskWeight: 0 }), 0, '硬风控可清零');
});
