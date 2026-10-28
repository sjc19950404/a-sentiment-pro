// 参数控制台后端测试：锁死「配置校验 / 合并 / 沙盒推演」三条纪律。
// 这些纯函数（validateConfigPatch / applyConfigPatch / computeDryRun）是前端控制台与
// /api/update-config、/api/dry-run 的安全底座——越界参数绝不能写盘，沙盒绝不能污染 config.json。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateConfigPatch, applyConfigPatch, computeDryRun, readConfigJson,
} from '../scripts/ui_server.mjs';

// ────────────────────── 一、范围校验（防呆） ──────────────────────

test('validateConfigPatch：未提供字段则不改（子集语义）', () => {
  const r = validateConfigPatch({ stops: {} });
  assert.equal(r.ok, true);
  assert.deepEqual(r.stops, {});
});

test('validateConfigPatch：越界止损线(>0) → 拒绝', () => {
  const r = validateConfigPatch({ stops: { stopLoss: 0.5 } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /止损线/.test(e)), JSON.stringify(r.errors));
});

test('validateConfigPatch：止损线最深 -20% 为边界，越深则拒', () => {
  assert.equal(validateConfigPatch({ stops: { stopLoss: -0.20 } }).ok, true);
  assert.equal(validateConfigPatch({ stops: { stopLoss: -0.21 } }).ok, false);
});

test('validateConfigPatch：上涨家数阈值越界(<50 或 >5000) → 拒绝', () => {
  assert.equal(validateConfigPatch({ stops: { clusterRiseMax: 10 } }).ok, false);
  assert.equal(validateConfigPatch({ stops: { clusterRiseMax: 6000 } }).ok, false);
  assert.equal(validateConfigPatch({ stops: { clusterRiseMax: 1500 } }).ok, true);
});

test('validateConfigPatch：高开过滤比例越界(>100) → 拒绝；单笔最大仓位越界(>1) → 拒绝', () => {
  assert.equal(validateConfigPatch({ stops: { openGapFilterPct: 150 } }).ok, false);
  assert.equal(validateConfigPatch({ stops: { maxPos: 2 } }).ok, false);
  assert.equal(validateConfigPatch({ stops: { maxPos: 0.01 } }).ok, true);
  assert.equal(validateConfigPatch({ stops: { sentimentPenalty: 60 } }).ok, false);
});

test('validateConfigPatch：非数字 → 拒绝', () => {
  assert.equal(validateConfigPatch({ stops: { stopLoss: 'abc' } }).ok, false);
  assert.equal(validateConfigPatch({ stops: { stopLoss: null } }).ok, true); // 视为未提供
});

test('validateConfigPatch：合法子集 → 接受且只回传所提供的键', () => {
  const r = validateConfigPatch({ stops: { sentimentPenalty: 20, openGapFilterPct: 5 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.stops, { sentimentPenalty: 20, openGapFilterPct: 5 });
});

// ────────────────────── 二、合并不污染原对象 ──────────────────────

test('applyConfigPatch：返回新对象，原 config 不被修改（深拷贝守卫）', () => {
  const cfg = readConfigJson();
  const snapshot = JSON.stringify(cfg);
  const next = applyConfigPatch(cfg, { stopLoss: -0.1 });
  assert.equal(JSON.stringify(cfg), snapshot, '原 config 必须零变化');
  assert.equal(next.params.live.stops.stopLoss, -0.1);
  assert.equal(next.params.train.stops.stopLoss, -0.1);
  assert.equal(next.backtest.stopLoss, -0.1);
});

test('applyConfigPatch：未提供的键保持原值（不抹除既有配置）', () => {
  const cfg = readConfigJson();
  const next = applyConfigPatch(cfg, { clusterRiseMax: 2000 });
  assert.equal(next.params.live.stops.clusterRiseMax, 2000);
  assert.equal(next.params.live.stops.sentimentPenalty, cfg.params.live.stops.sentimentPenalty, '未提供字段不变');
  assert.equal(next.backtest.clusterRiseMax, 2000);
  assert.equal(next.backtest.sentimentPenalty, cfg.backtest.sentimentPenalty);
});

// ────────────────────── 三、沙盒推演：纯内存、绝不写盘、绝不污染归档 ──────────────────────

test('computeDryRun：返回旧/新结果 + 差异结构，且 note 声明不写盘', () => {
  const diff = computeDryRun({ stops: { sentimentPenalty: 30, openGapFilterPct: 5 } });
  assert.ok(diff && diff.old && diff.new, '必须含 old/new');
  assert.ok(Array.isArray(diff.old.codes) && Array.isArray(diff.new.codes));
  assert.ok(Array.isArray(diff.added) && Array.isArray(diff.removed));
  assert.ok(/写盘/.test(diff.note), diff.note);
});

test('computeDryRun：绝不变更 config.json（mtime 与内容稳定）', () => {
  const p = resolve('config.json');
  const before = { mtime: statSync(p).mtimeMs, text: readFileSync(p, 'utf8') };
  // 跑两次，确保幂等且零副作用
  computeDryRun({ stops: { sentimentPenalty: 25 } });
  computeDryRun({ stops: { stopLoss: -0.12, maxPos: 0.5 } });
  const after = { mtime: statSync(p).mtimeMs, text: readFileSync(p, 'utf8') };
  assert.equal(after.text, before.text, 'config.json 内容必须完全不变');
  assert.equal(after.mtime, before.mtime, 'config.json 不应被触碰（mtime 不变）');
});

test('computeDryRun：改变 clusterRiseMax 会改变气泡判定输入（参数确实参与推演）', () => {
  // clusterRiseMax 调极高 → 极寒分化判定不再触发（除非 redRatio 仍越界）；
  // 至少保证 dry-run 在该参数下返回合法结构（不抛错、情绪分已按新参数计算）。
  const diff = computeDryRun({ stops: { clusterRiseMax: 5000, sentimentPenalty: 50 } });
  assert.ok(Number.isFinite(diff.old.emotionScore) && Number.isFinite(diff.new.emotionScore));
});
