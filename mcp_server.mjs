#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// a-sentiment-pro · MCP server（⑩，2026-11-07）
// ─────────────────────────────────────────────────────────────────────────────
// 让 AI 客户端（Claude Desktop / CodeBuddy 等支持 MCP 的宿主）直接查询系统档案，
// 不需要人肉翻 JSON——例如「最近 20 天 ebb 几天」「11-05 当日封板率多少」。
//
// 设计纪律：
// - 零依赖：MCP 核心就是 JSON-RPC 2.0 over stdio（initialize / tools/list /
//   tools/call），手写 ~250 行，不引入 @modelcontextprotocol/sdk（树莓派轻量路线）。
// - 只读：所有工具只读 data/ 与跑白名单内只读诊断脚本，不写任何档。
// - fail-open：档缺失/字段缺失一律返回结构化说明（"未采集/未计算"），不猜不补 0。
//
// 接入示例（宿主的 mcpServers 配置）：
//   {
//     "mcpServers": {
//       "a-sentiment-pro": {
//         "command": "node",
//         "args": ["/opt/a-sentiment-pro/mcp_server.mjs"]
//       }
//     }
//   }
// 协议日志走 stderr；stdout 只输出 JSON-RPC 帧。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

// ── 档案读取（复用生产 codec——写盘态是码表压缩形态，必须 decodeArchive 还原）──
import { decodeArchive } from './src/lhb_codec.js';
import { classifySeries } from './src/regime.js';

let _arch = null;
function archive() {
  if (!_arch) {
    const p = join(ROOT, 'data', 'archive.json');
    _arch = decodeArchive(JSON.parse(readFileSync(p, 'utf8')));
  }
  return _arch;
}
const num = (v) => (Number.isFinite(+v) ? +v : null);
const f1 = (v) => (v == null ? '—' : (+v).toFixed(1));

// ── 工具实现 ─────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'emotion_recent',
    description: '近 N 个交易日的情绪分/历史分位/regime 序列与分布统计。回答如「最近 20 天 ebb 几天」「情绪分走势如何」。',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: '回看交易日数，默认 20，上限 260' } },
    },
  },
  {
    name: 'day_detail',
    description: '指定交易日（YYYY-MM-DD）的盘面摘要：涨跌家数/涨停跌停/封板率/炸板/晋级/主线/龙虎净买/宽度判定。不传 date = 最新交易日。',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD；缺省取最新' } },
    },
  },
  {
    name: 'signals_snapshot',
    description: '当前 signals-latest 的关键读数快照（最新交易日情绪分/分位/regime 标签/宽度/亏钱效应/交叉源一致性）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_diagnostic',
    description: '跑一个白名单内的只读诊断脚本并返回输出。当前白名单：dragon_purity（妖股纯情绪标记 T+1 续板率对照）。',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', enum: ['dragon_purity'], description: '诊断脚本名' },
      },
      required: ['script'],
    },
  },
];

function toolEmotionRecent(args) {
  const want = Math.min(Math.max(Math.floor(num(args?.days) || 20), 1), 260);
  const days = (archive().all_days || []).filter((d) => d?.emotion?.value != null);
  const win = days.slice(-want);
  // 档案不固化 regime key（daily_report/dual_track 都是现场算）——同款口径：
  // classifySeries(value/pct_rank/seal_pct)，与 paper_dual_track.mjs:107 逐行同构。
  const regimeDays = days.map((d) => ({
    trade_date: d.trade_date,
    value: d.emotion ? d.emotion.value : null,
    pct_rank: d.emotion ? d.emotion.pct_rank : null,
    seal_pct: d.summary ? d.summary.seal_pct : null,
  }));
  const keys = classifySeries(regimeDays).map((r) => r.key).slice(-win.length);
  const dist = {};
  for (const k of keys) dist[k] = (dist[k] || 0) + 1;
  const rows = win.map((d, i) => ({
    date: d.trade_date,
    value: d.emotion.value,
    pctRank: d.emotion.pct_rank ?? null,
    regime: keys[i],
  }));
  return {
    window: `${win[0]?.trade_date} ~ ${win[win.length - 1]?.trade_date}（${win.length} 个交易日）`,
    distribution: dist,
    rows,
    note: 'regime 为 classifySeries 现场口径（与日报/回测同源）；ebb=退潮/ice=冰点/climax=高潮/recover=回暖/neutral=中性/shift=切换期',
  };
}

function toolDayDetail(args) {
  const days = archive().all_days || [];
  const d = args?.date ? days.find((x) => x.trade_date === args.date) : days[days.length - 1];
  if (!d) return { error: `无 ${args?.date || ''} 的档案日（可用范围 ${days[0]?.trade_date} ~ ${days[days.length - 1]?.trade_date}）` };
  const s = d.summary || {};
  const lhb = d.lhb || [];
  const netWan = lhb.reduce((a, x) => a + (num(x.net_buy_wan) || 0), 0);
  return {
    date: d.trade_date,
    涨跌: s.up_count != null ? `${s.up_count}/${s.down_count}${s.flat_count != null ? '/' + s.flat_count : ''}` : '—',
    涨停跌停: s.zt_count != null ? `${s.zt_count}/${s.dt_count ?? '—'}` : '—',
    封板率: s.seal_pct != null ? f1(s.seal_pct) + '%' : '—',
    炸板: s.zb_count ?? '—',
    晋级: s.pain?.advance ? `${s.pain.advance.kept}/${s.pain.advance.n}（失败率 ${f1((s.pain.advance.failRate || 0) * 100)}%）` : '—',
    龙虎净买: lhb.length ? (netWan / 10000).toFixed(2) + ' 亿' : '—',
    主线: s.main_theme?.name ? `${s.main_theme.name}（${f1(s.main_theme.pct)}%，净买 ${s.main_theme.main_yi ?? '—'} 亿）` : '—',
    情绪分: d.emotion ? `${f1(d.emotion.value)}（分位 ${f1(d.emotion.pct_rank)}）` : '—',
    regime: d.regime?.key || d.summary?.regime?.key || null,
    宽度: s.breadth?.verdict?.label || d.summary?.breadth?.label || null,
  };
}

function toolSignalsSnapshot() {
  const p = join(ROOT, 'data', 'signals-latest.json');
  if (!existsSync(p)) return { error: 'data/signals-latest.json 不存在' };
  const s = JSON.parse(readFileSync(p, 'utf8'));
  const L = s.latest || {};
  return {
    tradeDate: s.tradeDate || L.trade_date || null,
    情绪分: L.value != null ? `${f1(L.value)}（分位 ${f1(L.pct_rank)}）` : null,
    涨停跌停: L.zt_count != null ? `${L.zt_count}/${L.dt_count ?? '—'}` : null,
    封板率: L.seal_pct != null ? f1(L.seal_pct) + '%' : null,
    宽度: s.breadth?.verdict?.label || null,
    亏钱效应: s.pain?.verdict?.label || null,
    交叉源一致性: s.crosscheck?.verdict?.label || null,
    采集时间: s.meta?.generatedAt || null,
  };
}

function toolRunDiagnostic(args) {
  const WHITELIST = { dragon_purity: 'scripts/dragon_purity_validation.mjs' };
  const rel = WHITELIST[args?.script];
  if (!rel) return { error: `未知诊断脚本（白名单：${Object.keys(WHITELIST).join(', ')}）` };
  return new Promise((res) => {
    execFile('node', [join(ROOT, rel)], { cwd: ROOT, timeout: 60000 }, (err, stdout, stderr) => {
      res({ script: args.script, ok: !err, output: (stdout || '').trim() || (stderr || '').trim() || '(无输出)' });
    });
  });
}

const IMPL = {
  emotion_recent: toolEmotionRecent,
  day_detail: toolDayDetail,
  signals_snapshot: () => toolSignalsSnapshot(),
  run_diagnostic: (a) => toolRunDiagnostic(a),
};

// ── JSON-RPC 2.0 over stdio（MCP 协议核心）──
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyErr(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

const SERVER_INFO = {
  name: 'a-sentiment-pro',
  version: '1.0.0',
};
const CAPS = {
  protocolVersion: '2024-11-05',
  capabilities: { tools: {} },
  serverInfo: SERVER_INFO,
};

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch (e) { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') return reply(id, CAPS);
  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return; // 通知不回
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const impl = IMPL[name];
    if (!impl) return replyErr(id, -32602, `未知工具：${name}`);
    Promise.resolve(impl(params?.arguments || {}))
      .then((data) => reply(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        isError: !!data?.error,
      }))
      .catch((e) => reply(id, { content: [{ type: 'text', text: '执行失败：' + e.message }], isError: true }));
    return;
  }
  if (id != null) replyErr(id, -32601, `未知方法：${method}`);
});
process.stderr.write(`[mcp] a-sentiment-pro MCP server 就绪（${TOOLS.length} 个工具；只读）\n`);
