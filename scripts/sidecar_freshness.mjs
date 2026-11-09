#!/usr/bin/env node
/**
 * sidecar_freshness.mjs — 侧车新鲜度哨兵（2026-11-09 全系统审计发现项）
 *
 * 背景：freshness.mjs 门禁只覆盖老模块（宽度/主线/账本/亏钱效应/板块/市值/选股/ETF），
 *   EOD 链里以 `2>/dev/null || log` 挂载的侧车若静默失败，没人会读 run.log——
 *   ⑧c 三个月采样计划可能无声停摆。本哨兵把「侧车是否在长」变成一条告警。
 *
 * 检查对象与判据（均以 ztpool_history 最新日期为「应有日」，它是 EOD 每日必刷的锚）：
 *   - dragon_marks_history.json   最后标记日 == 锚日（⑧c 采样账本）
 *   - human_baseline.json         有锚日行（人机基线快照）
 *   - market_context_history.json 最后数据日 == 锚日（回场采集管道）
 *   - factor_health_history.json  周粒度，最后周内 10 天内（仪表账本）
 * 锚日不可得（池历史缺失）→ 跳过检查（fail-open），不产生噪音。
 *
 * 输出：全部新鲜 → exit 0 静默；有陈旧 → 发企微告警（OPS_WEBHOOK，pi_run source .env 后继承）并 exit 1。
 * 纪律：只读，不修改任何数据；不拦 EOD（调用方 || log）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', p), 'utf8'));
const exists = (p) => fs.existsSync(path.join(ROOT, 'data', p));

const problems = [];
try {
  // 锚日 = 涨停池历史最新日期（EOD 每日必刷）
  let anchor = null;
  try {
    const pool = readJson('ztpool_history.json');
    anchor = pool.map((d) => d.date).sort().pop() || null;
  } catch { /* 锚日不可得 */ }
  if (!anchor) {
    console.log('[sidecar_freshness] 锚日不可得（ztpool_history 缺失），跳过检查');
    process.exit(0);
  }

  const lastDate = (file, picker) => {
    if (!exists(file)) return null;
    try { return picker(readJson(file)); } catch { return null; }
  };

  const checks = [
    {
      file: 'dragon_marks_history.json',
      label: '⑧c 妖股标记账本',
      last: lastDate('dragon_marks_history.json', (j) => (j.days || []).map((d) => d.date).sort().pop() || null),
    },
    {
      file: 'market_context_history.json',
      label: '回场采集管道',
      last: lastDate('market_context_history.json', (j) => (j.rows || []).map((r) => r.date).sort().pop() || null),
    },
    {
      file: 'human_baseline.json',
      label: '人机对照基线',
      last: lastDate('human_baseline.json', (j) => (j.rows || []).map((r) => r.date).sort().pop() || null),
    },
  ];

  // 日期格式归一（不同侧车分别用 2026-11-06 / 20261106 两种写法，比较前统一去非数字）
  const norm = (d) => String(d || '').replace(/\D/g, '');
  for (const c of checks) {
    if (!c.last) problems.push(`${c.label}（${c.file}）缺失或为空——侧车未运行？`);
    else if (norm(c.last) !== norm(anchor)) problems.push(`${c.label}（${c.file}）最后日期 ${c.last} ≠ 锚日 ${anchor}`);
  }

  // 周粒度仪表：只查存在性与 10 天内
  try {
    const fh = readJson('factor_health_history.json');
    const week = (Array.isArray(fh.weeks) ? fh.weeks : (Array.isArray(fh) ? fh : [])).map((w) => w.week || w.date || w.asOf || '').sort().pop();
    if (!week) problems.push('因子健康仪表（factor_health_history.json）无周记录');
    else {
      const ageDays = (Date.now() - new Date(week.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).getTime()) / 86400000;
      if (ageDays > 10) problems.push(`因子健康仪表最后周 ${week} 已 ${ageDays.toFixed(0)} 天未更新`);
    }
  } catch {
    problems.push('因子健康仪表（factor_health_history.json）缺失或不可解析');
  }

  if (!problems.length) {
    console.log(`[sidecar_freshness] 全部新鲜（锚日 ${anchor}）`);
    process.exit(0);
  }

  const body = `⚠【侧车新鲜度】锚日 ${anchor}，发现 ${problems.length} 项停滞：\n` + problems.map((p) => `· ${p}`).join('\n')
    + '\n（EOD 链侧车静默失败信号；不影响本地数据与推送，排查 run.log 对应行）';
  console.error('[sidecar_freshness] ' + body.replace(/\n/g, ' | '));
  if (process.env.OPS_WEBHOOK) {
    try {
      const res = await fetch(process.env.OPS_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: body } }),
        signal: AbortSignal.timeout(10000),
      });
      console.log(`[sidecar_freshness] 告警已发送（HTTP ${res.status}）`);
    } catch (e) {
      console.error('[sidecar_freshness] 告警发送失败:', e.message);
    }
  }
  process.exit(1);
} catch (e) {
  console.error('[sidecar_freshness] 自身异常（fail-open）:', e.message);
  process.exit(0);
}
