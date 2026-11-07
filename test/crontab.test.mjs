// crontab 调度表守卫（2026-11-07，②号加固）。
//
// 背景：本周连续两起调度事故均因「手改 crontab 无测试兜底」——
//   ① eod 档写漏 1-5 工作日限定 → 周末 18:30 照跑，休市数据重复推送（2026-11-07 实证）；
//   ② pre_open(09:00) 与 intraday(09:00 整点) 撞车、candidates(10:30) 与 intraday 撞车
//      → pi_run.sh 单实例锁后者被静默跳过（2026-11-06 实证，盘前风向标消失）。
// 本测试从真实 crontab 读取并断言三条纪律，以后手滑立即红。
//
// 环境守卫：本测试依赖 Pi 上的真实 crontab，非 Pi 环境（CI/开发机）跳过。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ON_PI = process.platform === 'linux'
  && existsSync('/opt/a-sentiment-pro/pi_run.sh');

// 交易日业务档（必须 1-5 限定）。research_monthly 每月 1 号天然含周末，豁免。
const WEEKDAY_JOBS = ['us_close', 'a50', 'smoke', 'pre_open', 'candidates', 'intraday', 'eod', 'supplement'];
// 关键档齐全性（少一档 = 对应功能静默消失，11-06 盘前风向标事件实证过这个痛法）
const REQUIRED_JOBS = [...WEEKDAY_JOBS];

function parseCrontab() {
  const raw = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
  return raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = l.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\/\S+\s+\S+)(?:\s.*)?$/);
      if (!m) return null;
      return { min: m[1], hour: m[2], dom: m[3], mon: m[4], dow: m[5], cmd: m[6], raw: l };
    })
    .filter(Boolean);
}

test('cron：交易日业务档全部带 1-5 工作日限定（eod 周末重推事故守卫）', (t) => {
  if (!ON_PI) return t.skip('非 Pi 环境，无本机 crontab');
  const jobs = parseCrontab();
  const bad = [];
  for (const j of jobs) {
    const cmd = j.cmd.trim().split(/\s+/).pop();
    if (!WEEKDAY_JOBS.includes(cmd)) continue;
    if (j.dow !== '1-5') bad.push(`${cmd}: dow="${j.dow}"（应为 1-5）｜${j.raw}`);
  }
  assert.equal(bad.length, 0,
    `交易日业务档缺少 1-5 限定（周末会照跑重推休市数据）：\n${bad.join('\n')}`);
});

test('cron：关键档齐全（少一档 = 对应功能静默消失）', (t) => {
  if (!ON_PI) return t.skip('非 Pi 环境，无本机 crontab');
  const jobs = parseCrontab();
  const cmds = new Set(jobs.map((j) => j.cmd.trim().split(/\s+/).pop()));
  const missing = REQUIRED_JOBS.filter((c) => !cmds.has(c));
  assert.equal(missing.length, 0, `缺失档位：${missing.join(', ')}`);
});

test('cron：无同分钟重叠（pi_run.sh 单实例锁会静默跳过后档——撞车守卫）', (t) => {
  if (!ON_PI) return t.skip('非 Pi 环境，无本机 crontab');
  const jobs = parseCrontab();
  // 展开 cron 表达式为「分 时」触发点集合（本表只用 */列表/区间/单值，不含步进/日域逻辑）
  const expand = (f) => {
    if (f === '*') return null; // *（如 9-15 每 30 分的 hour=9-15）单独处理
    const out = [];
    for (const part of f.split(',')) {
      const [a, b] = part.split('-').map(Number);
      if (Number.isNaN(b)) out.push(a); else for (let i = a; i <= b; i++) out.push(i);
    }
    return out;
  };
  const fires = []; // { key: 'm/h', cmd }
  for (const j of jobs) {
    const cmd = j.cmd.trim().split(/\s+/).pop();
    const mins = expand(j.min);
    if (!mins) continue; // min 为 * 的档（本表不存在，防御性跳过）
    const hours = expand(j.hour);
    for (const mi of mins) {
      if (hours == null) { fires.push({ key: `${mi}/*`, cmd }); continue; }
      for (const hi of hours) fires.push({ key: `${mi}/${hi}`, cmd });
    }
  }
  // 同一「分/时」点上，若两档同在且都是 pi_run.sh 档 → 单实例锁必撞（后者跳过）
  const byKey = new Map();
  for (const f of fires) {
    if (!byKey.has(f.key)) byKey.set(f.key, []);
    byKey.get(f.key).push(f.cmd);
  }
  const clashes = [];
  for (const [key, cmds] of byKey) {
    const uniq = [...new Set(cmds)];
    if (uniq.length > 1) clashes.push(`${key} → ${uniq.join(' + ')}（同分钟多档，锁会吞掉后到者）`);
  }
  assert.equal(clashes.length, 0,
    `调度撞车（同分钟多档；需错峰 ≥5 分钟）:\n${clashes.join('\n')}`);
});
