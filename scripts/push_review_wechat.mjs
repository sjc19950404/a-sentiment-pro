#!/usr/bin/env node
// ── 复盘「选不出票」归因 → 企业微信（S2 运维机器人，独立通道 WECHAT_WEBHOOK_URL）──
// 与 src/ai_report_push.js 同哲学：推送失败不炸数据管线（未配置 → 跳过；推送失败 →
// 由调用方决定是否红，本步默认 continue-on-error）。内容取自 data/review/no_pick_*.json
// 最新一期（review_nopick.mjs 每日生成的台账）。
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = join(__dirname, '..', 'data', 'review');

function findLatestReview() {
  if (!existsSync(REVIEW_DIR)) return null;
  const files = readdirSync(REVIEW_DIR)
    .filter((f) => /^no_pick_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  const latest = files[0];
  return JSON.parse(readFileSync(join(REVIEW_DIR, latest), 'utf-8'));
}

// 消息拼装：优先吃真实字段，兼容草稿里假设的 date/candidates/eliminated/survived/reasons/suggestion。
function buildMessage(data) {
  const date = data.tradeDate || data.date || '—';
  const candidates = data.candidateRaw ?? data.candidates ?? '—';
  const eliminated = data.removedCount ?? data.eliminated ?? '—';
  const survived = data.selectedCount ?? data.survived ?? '—';

  const parts = [];
  if (Array.isArray(data.macroReasons)) {
    for (const r of data.macroReasons) {
      parts.push(typeof r === 'string' ? r : (r.label || `${r.key}: ${r.value}`));
    }
  }
  if (data.microRemovalReasons && typeof data.microRemovalReasons === 'object') {
    const micro = Object.entries(data.microRemovalReasons)
      .map(([k, v]) => `${k} ${v} 只`)
      .join('，');
    if (micro) parts.push('微观剔除：' + micro);
  }
  // 兼容草稿字段 reasons（字符串 / 对象 / 嵌套）
  if (!parts.length && data.reasons) {
    const rs = Array.isArray(data.reasons) ? data.reasons : [data.reasons];
    for (const r of rs) {
      if (typeof r === 'string') parts.push(r);
      else if (r && typeof r === 'object') parts.push(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join('，'));
      else parts.push(String(r));
    }
  }
  const reasonText = parts.length ? parts.join('；') : (data.conclusion || '—');

  let suggestion;
  if (Array.isArray(data.suggestionForTomorrow)) suggestion = data.suggestionForTomorrow.join('；');
  else if (Array.isArray(data.suggestion)) suggestion = data.suggestion.join('；');
  else suggestion = data.suggestion || data.conclusion || '—';

  const lines = [
    `昨日复盘（${date}）`,
    `候选 ${candidates} / 剔除 ${eliminated} / 存活 ${survived}`,
    `根因：${reasonText}`,
    `建议：${suggestion}`,
  ];
  return lines.join('\n');
}

async function pushToWechat() {
  const webhookUrl = process.env.WECHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('⚠️ WECHAT_WEBHOOK_URL 未配置，跳过企微推送');
    return;
  }

  const data = findLatestReview();
  if (!data) {
    console.log('⚠️ 未找到复盘文件（data/review/no_pick_*.json），跳过推送');
    return;
  }

  const content = buildMessage(data);
  console.log('— 推送内容预览 —\n' + content + '\n— — —');
  const payload = { msgtype: 'text', text: { content } };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (body.errcode === 0) {
      console.log('✅ 复盘已推送至企业微信');
    } else {
      console.error('❌ 企微推送失败:', body);
      process.exit(1);
    }
  } catch (e) {
    console.error('❌ 企微推送异常（网络/地址无效）:', e?.message || e);
    process.exit(1);
  }
}

pushToWechat();
