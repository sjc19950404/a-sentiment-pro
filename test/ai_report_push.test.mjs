// ═══ S2：AI 报告推送与调度闸门（src/ai_report_push.js）══════════════════
//
// 覆盖：① 指纹稳定性与敏感性（generated_at 剔除 / payload 变化感知）；
//   ② 防风暴：30 天同内容去重、TTL 过期放行、urgent（event:*）免防风暴直达；
//   ③ 状态文件 IO（坏档不炸、roundtrip、TTL/上限修剪）；
//   ④ 四类企微文本渲染（null → —，不冒充 0；超长截断；urgent 标记）；
//   ⑤ pushReports：无 webhook 静默跳过 / fetch 失败不 throw 且不记指纹（下拍
//      自愈重试）/ 成功记指纹并去重二次推送；
//   ⑥ 三调度闸门：盘前（交易日）、盘中（相位 live）、周报（本周最后交易日，
//      节前半周也能正确判定，不写死周五）；
//   ⑦ isoWeekStart（周报周一起点推导）+ 候选池 intraday_chg（不在强势榜 = null ≠ 0）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PUSH_CONSTS, fingerprintOf, shouldPush, pruneState, recordPushed,
  loadPushState, savePushState, renderPushText, pushReports,
  gatePreMarket, gateIntraday, gateWeekly,
} from '../src/ai_report_push.js';
import { isoWeekStart, buildCandidatePool } from '../src/ai_report.js';

// ── 夹具：最小信封（推送/渲染只消费这些字段）──────────────────────────
const mkReport = (over = {}) => ({
  schema_version: '1.0',
  report_type: 'post_market',
  trigger: 'schedule',
  urgent: false,
  date: '2026-09-30',
  generated_at: '2026-09-30T13:05:00.000Z',
  generated_by: 'ci',
  status: 'degraded',
  payload: {
    date: '2026-09-30',
    pnl_daily: 0.0002,
    pnl_cumulative: -0.015,
    close_drawdown: 0.1379,
    market_context: { up_down: '2600/2400/400', zt_dt: '52/3', pain: '晋级失败 40%' },
    backtest_deviation: { live_cum: -0.015, backtest_v52: -0.015, delta: 0, note: '执行轨 vs 回测 v52 锚点' },
    simulation_stock: {
      sentiment_cycle: { phase: 'fermentation', phase_label: '发酵期', regime_raw: 'recover', highest_chain: 6, broken_limit_ratio: 0.1875 },
      position_suggestion: 'neutral',
      candidate_pool: [{ code: '600825', name: '新华传媒', intraday_chg: null }],
    },
  },
  missing_notes: [{ field: 'grid_triggers', reason: '系统无网格交易引擎', ref: 'src/grid_parallel.js' }],
  ...over,
});

// ── 1. 指纹 ───────────────────────────────────────────────────────────
test('fingerprintOf：generated_at/易变字段不进指纹，payload 变化必换指纹', () => {
  const r = mkReport();
  const same = mkReport({ generated_at: '2026-09-30T18:35:00.000Z', generated_by: 'browser', data_health: { sources: { dual_track: 'stale' } } });
  assert.equal(fingerprintOf(r), fingerprintOf(same), '易变字段剔除 → 重跑同内容同指纹');
  const changed = mkReport({ payload: { ...r.payload, pnl_daily: 0.031 } });
  assert.notEqual(fingerprintOf(r), fingerprintOf(changed), '内容真变了 → 新指纹（宁可重推真变化）');
  const urgent = mkReport({ trigger: 'event:circuit_breaker', urgent: true });
  assert.notEqual(fingerprintOf(r), fingerprintOf(urgent), 'trigger 进指纹（事件版是另一份报告）');
});

// ── 1.5 MA20 降级红警（2026-10-08 推送前校验 ①）─────────────────────
// 主验证链：renderPushText 消费 report.payload.ma20_degraded——降级版（s_amt
// 中性 50）推送必现红警行；正常版（s_amt=44）不显示不添乱（老档无此键 → falsy 兼容）。
test('MA20 降级红警：ma20_degraded=true 推送含红警行，false 不含', () => {
  const base = mkReport();
  const degraded = renderPushText(mkReport({ payload: { ...base.payload, ma20_degraded: true } }));
  assert.match(degraded, /MA20 降级版/, '降级版红警行一定在');
  assert.match(degraded, /中性 50/, '量能因子中性 50 文案在场');
  const normal = renderPushText(base);
  assert.doesNotMatch(normal, /MA20/, '正常推送不出现 MA20 警示字样');
});

// ── 2. 防风暴判定 ─────────────────────────────────────────────────────
test('shouldPush：新内容放行 / 30 天内同内容拦截 / TTL 过期放行 / urgent 直达', () => {
  const r = mkReport();
  const fp = fingerprintOf(r);
  const hourAgo = '2026-10-06T12:00:00.000Z';
  assert.equal(shouldPush(r, { pushed: [] }, new Date('2026-10-06T13:00:00Z')).push, true, '空状态 → 新内容');
  const state = { pushed: [{ fingerprint: fp, type: 'post_market', date: r.date, pushed_at: hourAgo }] };
  assert.equal(shouldPush(r, state, new Date('2026-10-06T13:00:00Z')).push, false, '1 小时前推过同内容 → 拦');
  const stale = { pushed: [{ fingerprint: fp, type: 'post_market', date: r.date, pushed_at: '2026-09-01T00:00:00Z' }] };
  assert.equal(shouldPush(r, stale, new Date('2026-10-06T13:00:00Z')).push, true, '31 天前推过 → TTL 已过放行');
  const urgent = mkReport({ trigger: 'event:circuit_breaker', urgent: true });
  assert.equal(shouldPush(urgent, state, new Date('2026-10-06T13:00:00Z')).push, true, 'urgent 免防风暴直达（决议 3）');
});

// ── 3. 状态修剪与记录 ─────────────────────────────────────────────────
test('pruneState/recordPushed：TTL 清理 + 上限截断（保最新）+ 追加幂等可链', () => {
  const now = new Date('2026-10-06T13:00:00Z');
  const arr = Array.from({ length: PUSH_CONSTS.STATE_CAP + 5 }, (_, i) => ({
    fingerprint: `fp${i}`, pushed_at: new Date(now.getTime() - i * 3600_000).toISOString(),
  }));
  const pruned = pruneState({ pushed: arr }, now);
  assert.equal(pruned.pushed.length, PUSH_CONSTS.STATE_CAP, '上限截断');
  assert.equal(pruned.pushed[0].fingerprint, 'fp0', '保最新在前');
  const aged = pruneState({ pushed: [{ fingerprint: 'x', pushed_at: '2026-09-01T00:00:00Z' }] }, now);
  assert.equal(aged.pushed.length, 0, '超龄清理');
  const rec = recordPushed({ pushed: [] }, { fingerprint: 'ab', type: 'intraday', date: '2026-10-06' }, now);
  assert.equal(rec.pushed.length, 1);
  assert.equal(rec.pushed[0].pushed_at, now.toISOString());
});

// ── 4. 状态文件 IO ────────────────────────────────────────────────────
test('loadPushState/savePushState：roundtrip / 缺档空态 / 坏 JSON 空态不炸', () => {
  const dir = mkdtempSync(join(tmpdir(), 'airpt-state-'));
  try {
    const f = join(dir, 'push_state.json');
    assert.deepEqual(loadPushState(f), { schema_version: '1.0', pushed: [] }, '缺档 → 空态');
    writeFileSync(f, '{bad json', 'utf8');
    assert.deepEqual(loadPushState(f), { schema_version: '1.0', pushed: [] }, '坏 JSON → 空态不 throw');
    const state = recordPushed(loadPushState(f), { fingerprint: 'fp1', type: 'post_market', date: '2026-09-30' }, new Date('2026-10-06T13:00:00Z'));
    savePushState(f, state);
    assert.equal(loadPushState(f).pushed[0].fingerprint, 'fp1', 'save → load roundtrip');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 5. 文本渲染（四类）────────────────────────────────────────────────
test('renderPushText：四类各成版式；null → — 不冒充 0；工程告警不进决策正文', () => {
  const post = renderPushText(mkReport());
  assert.match(post, /【AI 报告 · 盘后】2026-09-30/);
  assert.match(post, /当日盈亏 \+0\.02%/);
  assert.match(post, /收盘回撤 \+13\.79%/);
  assert.match(post, /情绪周期: 发酵期\(recover\)/);
  assert.doesNotMatch(post, /缺失披露|数据状态/, '工程健康告警不进决策正文（2026-10-09 指令：归工程通道）');
  assert.match(post, /完整版见页面 · 不构成投资建议/, '免责声明尾行保留');
  assert.match(post, /候选池 1 只（按连板数排序，Top 1）：/, '候选池清单展开（盘后版）');
  assert.match(post, / 1\. 600825 新华传媒 · 得分 — · 入选理由 — · 估值 —/, 'null 字段按 — 占位（不造数纪律）');

  const pre = renderPushText(mkReport({
    report_type: 'pre_market',
    payload: { date: '2026-09-30', pnl_daily: null, pnl_cumulative: null, prev_nav: null, overseas: [{ key: 'a50', chgPct: 0.0009 }], overnight_exposure: { posGap: null }, simulation_stock: null,
      watchlist: { basis: 'pain.advance.detail 昨收口径连板梯队（不含操作建议）', ladder: [
        { code: '600825', name: '新华传媒', lb: 6, kept: true, chg: 9.99, appearances: 8 },
        { code: '603949', name: '雪龙集团', lb: 4, kept: false, chg: -9.98, appearances: null },
      ], overnight_sectors: null, max_lb: 6, broken_limit_ratio: 0.1875 } },
    missing_notes: [],
  }));
  assert.match(pre, /【AI 盘前 · 今日观察清单】2026-09-30/, '任务一标题（不叫候选池）');
  assert.match(pre, /今日观察清单（昨收口径 · 2 只，不含操作建议）：/);
  assert.match(pre, / 1\. 600825 新华传媒 · 6 连板 · 晋级成功 · 当日 \+9\.99% · 上榜 8 次/);
  assert.match(pre, / 2\. 603949 雪龙集团 · 4 连板 · 晋级失败 · 当日 -9\.98%/, 'appearances null → 无上榜段（—不硬塞）');
  assert.match(pre, /最高连板 6 · 炸板率 \+18\.75%/, 'sim 缺席回退 watchlist 数据源');
  assert.match(pre, /前日盈亏 — · 累计 —/, 'null → —，不冒充 0');
  assert.match(pre, /A50 \+0\.09%/);
  assert.doesNotMatch(pre, /建议仓位|情绪周期/, '观察清单不含操作建议（任务一语义）');
  assert.doesNotMatch(pre, /候选池/, '标题/正文不出现候选池字样（输出物理隔离）');
  assert.ok(pre.includes('数据截至 2026-09-30 收盘\n'), '盘前恒标数据截至（前收口径，头部日期即数据日期）');
  assert.ok(!pre.includes('假期无更新'), '常规隔夜（gap≤3 自然日）不加假期附注');
  const preHoliday = renderPushText(mkReport({
    report_type: 'pre_market', date: '2026-09-30', generated_at: '2026-10-08T01:05:00.000Z',
    payload: { date: '2026-09-30', pnl_daily: null, pnl_cumulative: null, prev_nav: null, overseas: [], overnight_exposure: { posGap: null }, simulation_stock: null },
    missing_notes: [],
  }));
  assert.ok(preHoliday.includes('数据截至 2026-09-30 收盘（距生成 8 天，假期无更新）'), '节后首日（gap>3）附假期无更新——10-08 盘前实况');

  // S3-5 外围收盘聚合行：有值渲染（cnh null → —）、老档/全缺整行省略、上限内
  const preFull = renderPushText(mkReport({
    report_type: 'pre_market',
    payload: { date: '2026-09-30', pnl_daily: null, pnl_cumulative: null, prev_nav: null, overseas: [{ key: 'a50', chgPct: 0.001853 }],
      overnight_exposure: { posGap: 4, us_close: { dji: 0.004942, spx: 0.005786, ixic: 0.004458 }, cn_overnight: { hxc: 0.003142, fxi: -0.002363 }, cnh_chgPct: null },
      simulation_stock: null },
    missing_notes: [],
  }));
  assert.match(preFull, /外围收盘: 道 \+0\.49% · 标普 \+0\.58% · 纳指 \+0\.45% · 金龙 \+0\.31% · FXI -0\.24% · 离岸人民币 —/, '聚合一行 + null → —');
  assert.ok(preFull.length <= PUSH_CONSTS.MSG_CAP, '企微 text 上限内（2000 留余量）');
  assert.ok(!pre.includes('外围收盘'), '无新字段段（fixture 夹具）→ 整行省略，不留一排 — 噪音行');

  const intra = renderPushText(mkReport({
    report_type: 'intraday', trigger: 'event:circuit_breaker', urgent: true,
    payload: { date: '2026-09-30', drawdown_vs_threshold: { dd_now: 0.088, distance_pp: 0.2, basis: '归档轨 trackA.maxDd' }, pnl_daily: 0.0002, pnl_cumulative: -0.015, overseas: [],
      simulation_stock: { ...mkReport().payload.simulation_stock, candidate_pool: [
        { code: '600825', name: '新华传媒', score: 0.87, themes: ['半导体投资', '国产替代'], selection_reason: '量比 3.2', intraday_chg: 5.2, fundamentals: { pe: 22, pb: null }, fund_flow_note: '主力净流入 +5210 万（东财 push2 盘中实时）', data_completeness: { level: 'full', missing: [] } },
        { code: '000002', name: '样本B', score: 0.5, themes: null, selection_reason: '量比 2.5', intraday_chg: 4.0, fundamentals: { pe: null, pb: null }, data_completeness: { level: 'partial', missing: ['估值'] } }] } },
    missing_notes: [],
  }));
  assert.match(intra, /【AI 盘中 · 候选池】2026-09-30 · event:circuit_breaker/, 'urgent 触发源进标题');
  assert.match(intra, /运行回撤 \+8\.80% · 距 DD 档位 0\.2pp/);
  assert.match(intra, /趋势池 2 只（按综合得分排序，Top 2 · 涨幅3-7% · 量比>2 · 未涨停未一字 · 主力净流入为正（已滤昨日涨停））：/, '趋势池标签+四条件进标题（2026-10-10 双池拆分；标题=该池实际筛选口径）');
  assert.match(intra, / 1\. 600825 新华传媒 · 得分 0\.87 · 题材：半导体投资\/国产替代 · 量比 3\.2 · PE 22x · 盘中 \+5\.2% · ✅/, '齐全股行尾 ✅（题材/估值/资金三要素清点通过）');
  assert.match(intra, / 2\. 000002 样本B · 得分 0\.5 · 量比 2\.5 · — · 盘中 \+4% · ⚠️ 缺估值/, '缺估值股行尾 ⚠️ 直标缺失项（部分数据不冒充完整画像）');

  // 0 只显式报（2026-10-09 用户指令）：候选池空 → 推送正文直接报「今日无符合条件标的」，
  //   绝不静默省略、绝不凑数塞垃圾。
  const intraEmpty = renderPushText(mkReport({
    report_type: 'intraday',
    payload: { date: '2026-09-30', drawdown_vs_threshold: { dd_now: 0.088, distance_pp: 0.2, basis: '归档轨 trackA.maxDd' }, pnl_daily: 0.0002, pnl_cumulative: -0.015, overseas: [],
      simulation_stock: { ...mkReport().payload.simulation_stock, candidate_pool: [] } },
    missing_notes: [],
  }));
  assert.match(intraEmpty, /趋势池 0 只 · 今日无符合条件标的（宁缺毋假）/, '空池显式话术，不静默省略候选池段');

  const week = renderPushText(mkReport({
    report_type: 'weekly',
    payload: { date: '2026-09-30', week_return: -0.011, max_drawdown_week: 0.02, profit_trade_ratio: 0.4, win_rate: null, trend_switch_hits: 2, trend_switch_effect: { shadow_note: 'trackC 影子线累计 -0.9 vs 执行轨 -1.5' } },
    missing_notes: [],
  }));
  assert.match(week, /【AI 报告 · 周报】截至 2026-09-30/);
  assert.match(week, /周收益 -1\.10% · 周最大回撤 \+2\.00% · 盈利日占比 \+40\.00%/);
  assert.match(week, /胜率 —（剧本口径，绑定缺席则 null）/, '胜率 null 口径如实披露');
  assert.match(week, /趋势切换 2 次/);

  // 超长截断：候选池塞爆（30 只 + 超长理由）→ Top 10 截取 + 不超企微上限
  const fatPool = Array.from({ length: 30 }, (_, i) => ({
    code: `6009${String(i).padStart(2, '0')}`, name: `压测票${i}`,
    selection_reason: `${i + 1} 连板（当日 9.99%，晋级成功，${'理由'.repeat(20)}）`,
  }));
  const base = mkReport();
  const fat = mkReport({ payload: { ...base.payload, simulation_stock: { ...base.payload.simulation_stock, candidate_pool: fatPool } } });
  const fatText = renderPushText(fat);
  assert.ok(fatText.length <= PUSH_CONSTS.MSG_CAP, '超长截断至上限内');
  assert.ok(Buffer.byteLength(fatText, 'utf8') <= 2000, '字节闸：企微 text 实测 2048 字节上限，2000 留余量（CJK 展开后字符闸挡不住）');
  assert.match(fatText, /超长截断/, '字节闸触发时如实标注');
  assert.doesNotMatch(fatText, /11\. /, '正文只展示 Top 10（指令口径）');
});

// ── 5.5 候选池清单（2026-10-09 指令：纯数字摘要 → 逐股清单）──────────
test('renderPushText：候选池清单——字段全有时完整展示（得分/题材/PE），缺失按 — 占位不造数', () => {
  const base = mkReport();
  const pool = [
    { code: '600519', name: '贵州茅台', score: 0.87, themes: ['消费龙头'], selection_reason: '3 连板（当日 10.00%，晋级成功）', fundamentals: { pe: 22, pb: null } },
    { code: '000001', name: '平安银行', score: 0.82, themes: null, selection_reason: '2 连板（当日 5.00%，晋级成功）', fundamentals: { pe: null, pb: 0.6 } },
    { code: '300750', name: null, selection_reason: null, fundamentals: null },
  ];
  const out = renderPushText(mkReport({ payload: { ...base.payload, simulation_stock: { ...base.payload.simulation_stock, candidate_pool: pool } } }));
  assert.match(out, /候选池 3 只（按连板数排序，Top 3）：/);
  assert.match(out, / 1\. 600519 贵州茅台 · 得分 0\.87 · 题材：消费龙头 · 入选：3 连板（当日 10\.00%，晋级成功） · 估值 PE 22x/, '字段齐全：得分/题材/入选理由/PE');
  assert.match(out, / 2\. 000001 平安银行 · 得分 0\.82 · 入选：2 连板（当日 5\.00%，晋级成功） · 估值 PB 0\.6x/, 'PE 缺 → PB 回退；themes null → 走入选理由');
  assert.match(out, / 3\. 300750 — · 得分 — · 入选理由 — · 估值 —/, '名称/理由/估值全缺 → —，不造数');
});

// ── 6. pushReports（fetch 注入零网络）─────────────────────────────────
test('pushReports：无 webhook 跳过 / 成功记指纹 / 二次去重 / 失败不记指纹自愈 / 不 throw', async () => {
  const r = mkReport();
  const dir = mkdtempSync(join(tmpdir(), 'airpt-push-'));
  const stateFile = join(dir, 'push_state.json');
  try {
    // 无 webhook → 静默跳过
    const none = await pushReports([r], { env: {}, stateFile });
    assert.equal(none.pushed, 0);
    assert.equal(none.skipped, 1);
    assert.match(none.results[0].reason, /未配置 OPS_WEBHOOK/);

    const calls = [];
    const fetchOk = { ok: true };
    const ok1 = await pushReports([r], { env: { OPS_WEBHOOK: 'https://example.test/hook' }, fetchImpl: async (u, init) => { calls.push({ u, init }); return fetchOk; }, stateFile, now: new Date('2026-10-06T13:00:00Z') });
    assert.equal(ok1.pushed, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].u, 'https://example.test/hook');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.msgtype, 'text');
    assert.match(body.text.content, /【AI 报告 · 盘后】/, '企微 text 消息体');
    assert.equal(loadPushState(stateFile).pushed.length, 1, '成功记指纹');

    // 同内容二次推送 → 指纹去重
    const ok2 = await pushReports([r], { env: { OPS_WEBHOOK: 'https://example.test/hook' }, fetchImpl: async () => fetchOk, stateFile, now: new Date('2026-10-06T13:30:00Z') });
    assert.equal(ok2.pushed, 0);
    assert.match(ok2.results[0].reason, /duplicate_fingerprint/);

    // 失败（网络断 / HTTP 500）→ 不 throw、不记指纹 → 下拍重试自愈
    for (const bad of [async () => { throw new Error('网络断'); }, async () => ({ ok: false, status: 500 })]) {
      const fdir = mkdtempSync(join(tmpdir(), 'airpt-retry-'));
      try {
        const fail = await pushReports([r], { env: { OPS_WEBHOOK: 'https://x.test' }, fetchImpl: bad, stateFile: join(fdir, 's.json'), now: new Date('2026-10-06T14:00:00Z') });
        assert.equal(fail.pushed, 0);
        assert.match(fail.results[0].reason, /重试/);
        assert.equal(loadPushState(join(fdir, 's.json')).pushed.length, 0, '失败不记指纹');
      } finally { rmSync(fdir, { recursive: true, force: true }); }
    }
    // urgent 免防风暴：同内容已推过也直达
    const urgent = mkReport({ trigger: 'event:trend_switch', urgent: true });
    const okU = await pushReports([urgent], { env: { OPS_WEBHOOK: 'https://example.test/hook' }, fetchImpl: async () => fetchOk, stateFile, now: new Date('2026-10-06T13:30:00Z') });
    assert.equal(okU.pushed, 1, 'urgent 同内容也直达（trigger 进指纹故本就为新；双保险）');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 6b. 企微 errcode 解析：HTTP OK 但 errcode≠0（93xxx 静默丢包）→ 不记指纹、重试自愈 ──
test('pushReports：企微 HTTP 200 + errcode≠0 静默丢包 → 不记指纹、不抛、reason 暴露 errcode', async () => {
  const r = mkReport();
  const dir = mkdtempSync(join(tmpdir(), 'airpt-errcode-'));
  const stateFile = join(dir, 's.json');
  try {
    // 模拟企微：HTTP 200 + errcode=93000（机器人被拉起/群解散——企微的"假成功"陷阱）
    const failWechat = async () => ({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ errcode: 93000, errmsg: '机器人被移除，请先补群' }),
    });
    const fail = await pushReports([r], { env: { OPS_WEBHOOK: 'https://x.test' }, fetchImpl: failWechat, stateFile, now: new Date('2026-10-08T13:30:00Z') });
    assert.equal(fail.pushed, 0, 'errcode≠0 → 不算成功');
    assert.match(fail.results[0].reason, /errcode=93000/, 'reason 暴露 errcode，便于排查（这是漏洞修复的核心证据）');
    assert.match(fail.results[0].reason, /未记指纹/, '同 HTTP 失败：失败不记指纹');
    assert.equal(loadPushState(stateFile).pushed.length, 0, '状态文件干净（不记指纹 → 下拍重试自愈）');

    // 模拟正常：HTTP 200 + errcode=0 → 成功 + 记指纹（与未升级前行为一致）
    const okWechat = async () => ({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
    });
    const ok = await pushReports([r], { env: { OPS_WEBHOOK: 'https://x.test' }, fetchImpl: okWechat, stateFile, now: new Date('2026-10-08T13:30:00Z') });
    assert.equal(ok.pushed, 1, 'errcode=0 → 推送成功');
    assert.match(ok.results[0].reason, /new_content/);
    assert.equal(loadPushState(stateFile).pushed.length, 1, '记指纹');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 6c. OPS_WEBHOOK BOM/零宽污染（2026-10-10 线上真实踩坑）：清洗自愈 + 非法不静默 ──
test('pushReports：webhook 带 BOM 清洗自愈；清洗后非法 → 值非法跳过（非静默）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'airpt-bom-'));
  const stateFile = join(dir, 's.json');
  try {
    const r = mkReport();
    // 事故原样：两个 U+FEFF 前缀 + 尾部零宽 → 清洗后照常推送，fetch 收到干净 URL
    const calls = [];
    const ok = await pushReports([r], {
      env: { OPS_WEBHOOK: '\uFEFF\uFEFFhttps://example.test/hook\u200B' },
      fetchImpl: async (u) => { calls.push(u); return { ok: true }; },
      stateFile, now: new Date('2026-10-08T13:30:00Z'),
    });
    assert.equal(ok.pushed, 1, 'BOM 剥除后推送成功（消费端自愈）');
    assert.equal(calls[0], 'https://example.test/hook', 'fetch 收到清洗后的 URL');
    assert.equal(loadPushState(stateFile).pushed.length, 1, '记指纹（干净推送）');

    // 清洗后仍非法（http:// 非 https）→ 全员标记「值非法」跳过，不 fetch 不记指纹
    const stateFile2 = join(dir, 's2.json');
    const bad = await pushReports([mkReport()], {
      env: { OPS_WEBHOOK: 'http://not-https.test/hook' },
      fetchImpl: async () => { throw new Error('不该 fetch'); },
      stateFile: stateFile2, now: new Date('2026-10-08T13:30:00Z'),
    });
    assert.equal(bad.pushed, 0);
    assert.match(bad.results[0].reason, /OPS_WEBHOOK 值非法/);
    assert.equal(loadPushState(stateFile2).pushed.length, 0, '不记指纹');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 6c. 缺 .json/.text 的旧 mock 仍能跑通（防御性解析不打破现有注入约定）────
test('pushReports：fetchImpl 返回 { ok, status } 无 body 方法时，行为与未升级前一致', async () => {
  const r = mkReport();
  const dir = mkdtempSync(join(tmpdir(), 'airpt-legacy-mock-'));
  try {
    // 失败路径（先做，避免被后置成功去重）：{ ok:false, status:502 } → 走原 HTTP reason
    const bad = await pushReports([r], { env: { OPS_WEBHOOK: 'https://x.test' }, fetchImpl: async () => ({ ok: false, status: 502 }), stateFile: join(dir, 'bad.json'), now: new Date('2026-10-08T13:30:00Z') });
    assert.equal(bad.pushed, 0);
    assert.match(bad.results[0].reason, /HTTP 502/, '无 body 方法时仍报 HTTP reason');

    // 成功路径（独立 stateFile）：{ ok: true } 无 .json → 仍应算成功（errcode 未暴露 → 不算失败）
    const ok = await pushReports([r], { env: { OPS_WEBHOOK: 'https://x.test' }, fetchImpl: async () => ({ ok: true }), stateFile: join(dir, 'ok.json'), now: new Date('2026-10-08T13:30:00Z') });
    assert.equal(ok.pushed, 1, '无 body 方法 + res.ok=true → 成功（与升级前兼容）');
    assert.equal(loadPushState(join(dir, 'ok.json')).pushed.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 7. 调度闸门 ───────────────────────────────────────────────────────
test('gatePreMarket/gateIntraday：交易日 + 相位三态（判据与 snapshot_intraday 同源）', () => {
  const THU_PRE = new Date('2026-10-08T01:05:00Z');  // 北京周四 09:05（pre）
  const THU_LIVE = new Date('2026-10-08T02:00:00Z'); // 北京周四 10:00（live）
  const THU_POST = new Date('2026-10-08T07:30:00Z'); // 北京周四 15:30（closed）
  const SAT = new Date('2026-10-10T01:05:00Z');      // 北京周六 09:05
  assert.equal(gatePreMarket(THU_PRE, []).ok, true, '交易日 09:05 → 出盘前报告');
  assert.equal(gatePreMarket(SAT, []).ok, false, '周六 → 跳过');
  assert.equal(gatePreMarket(THU_PRE, ['2026-10-08']).ok, false, '节假日列表命中 → 跳过');
  assert.equal(gateIntraday(THU_LIVE, []).ok, true, '盘中 10:00 → 出盘中报告');
  assert.equal(gateIntraday(THU_PRE, []).ok, false, '09:05 相位 pre → 跳过（盘中报告不抢盘前语义）');
  assert.equal(gateIntraday(THU_POST, []).ok, false, '15:30 相位 closed → 跳过');
});

test('gateWeekly：周五放行 / 周中拦截 / 节前最后交易日放行（不写死周五）', () => {
  assert.equal(gateWeekly('2026-10-09', []).ok, true, '普通周五 → 本周最后交易日');
  assert.equal(gateWeekly('2026-10-08', []).ok, false, '周四且周五开市 → 等周五');
  assert.equal(gateWeekly('2026-10-07', ['2026-10-08', '2026-10-09']).ok, true, '周四 + 周五休市 → 周四即最后交易日（节前半周）');
  assert.equal(gateWeekly('2026-10-09', ['2026-10-09']).ok, true, '周五本身休市不发生于本判据（tradeDate 来自真实数据，休市日无数据）');
  assert.equal(gateWeekly('国庆假期', []).ok, false, '非法日期 → 拦');
  assert.match(gateWeekly('2026-10-08', []).reason, /2026-10-09/, '拦截理由给出等待日');
});

// ── 8. isoWeekStart + 候选池盘中联查 ──────────────────────────────────
test('isoWeekStart：周三/周五/周一/非法 → 正确周一或 null', () => {
  assert.equal(isoWeekStart('2026-09-30'), '2026-09-28', '周三 → 本周一');
  assert.equal(isoWeekStart('2026-10-09'), '2026-10-05', '周五 → 本周一');
  assert.equal(isoWeekStart('2026-10-05'), '2026-10-05', '周一 → 自身');
  assert.equal(isoWeekStart('2026-10-04'), '2026-09-28', '周日 → 上周一（ISO 周归属）');
  assert.equal(isoWeekStart(null), null);
  assert.equal(isoWeekStart('bad'), null);
});

test('buildCandidatePool intraday_chg：在强势榜取真值 / 不在榜 null ≠ 0 / 未注入恒 null', () => {
  const signals = { pain: { advance: { failRate: 0.4, detail: [
    { code: '600825', lb: 6, chg: 9.99, kept: true },
    { code: '000678', lb: 3, chg: 9.98, kept: true },
  ] } } };
  const noHot = buildCandidatePool(signals, {});
  assert.equal(noHot[0].intraday_chg, null, '未注入（盘前/盘后语义）→ null');
  const hot = buildCandidatePool(signals, { intradayHot: { '600825': 5.2 } });
  assert.equal(hot[0].intraday_chg, 5.2, '强势榜在列 → 盘中真值');
  assert.equal(hot[1].intraday_chg, null, '不在强势榜 → null（缺席 ≠ 不涨，严格区分）');
  const badHot = buildCandidatePool(signals, { intradayHot: { '600825': 'NaN-ish' } });
  assert.equal(badHot[0].intraday_chg, null, '非数值守卫 → null');
});

// ── 8b. 双池推送（2026-10-10 用户指令）：标题与标的必须一致 ──────────────
//   连板池标题 = 连板池口径（绝不出现涨幅带/未涨停）；趋势池标题 = 四条件。
//   两池标的各归其块，头部计数与块内数量对得上——标题冒充口径 = 推送造假。
test('renderPushText 双池：连板池/趋势池分块渲染，各块标题=该池实际筛选口径', () => {
  const base = mkReport();
  const sim = {
    ...base.payload.simulation_stock,
    streak_pool: [
      { code: '600601', name: '三连板股', score: null, themes: ['电池'], selection_reason: '3 连板', intraday_chg: 10.02, fundamentals: { pe: 30, pb: 4 }, data_completeness: { level: 'full', missing: [] } },
    ],
    candidate_pool: [
      { code: '600603', name: '首板趋势股', score: 0.8, themes: ['出行'], selection_reason: '量比 3.2', intraday_chg: 5.0, fundamentals: { pe: 22, pb: 1.4 }, data_completeness: { level: 'full', missing: [] } },
    ],
  };
  const out = renderPushText(mkReport({
    report_type: 'intraday',
    payload: { ...base.payload, simulation_stock: sim },
    missing_notes: [],
  }));
  // 头部计数：两池数量都进首行
  assert.match(out, /情绪周期:.* · 建议仓位: .* · 连板池 1 · 趋势池 1 只/, '双池计数进情绪周期行');
  // 连板池标题 = 自身口径（不含涨幅带/未涨停）——标题与标的一致的硬断言
  assert.match(out, /连板池 1 只（按梯队分排序，Top 1 · 连板≥2 · 今日非一字 · 量比>2 · 主力净流入为正）：/, '连板池标题=连板池口径（只写筛选条件本身）');
  assert.match(out, / 1\. 600601 三连板股 · 梯队分 — · 题材：电池 · 3 连板/, '连板池标的行（streak_score 缺席 → 梯队分 —）');
  // 趋势池标题 = 四条件（原口径不变）
  assert.match(out, /趋势池 1 只（按综合得分排序，Top 1 · 涨幅3-7% · 量比>2 · 未涨停未一字 · 主力净流入为正（已滤昨日涨停））：/, '趋势池标题=四条件');
  assert.match(out, / 1\. 600603 首板趋势股 · 得分 0\.8 · 题材：出行 · 量比 3\.2/, '趋势池标的行');
  // 一致性反证：连板池标题行绝不含趋势池的涨幅带/未涨停字样
  const streakTitle = (out.match(/连板池 1 只（[^：]*）：/) || [''])[0];
  assert.ok(!/涨幅3-7%|未涨停/.test(streakTitle), '连板池标题绝不冒充趋势池口径（标题与标的必须一致）');
  // 字节闸：双池各 Top 5 后正文含免责尾行不被截断
  assert.ok(out.includes('不构成投资建议'), '免责尾行在场（双池不挤爆字节闸）');
});

test('renderPushText 双池：连板池缺席（盘后 pain 口径/旧档无字段）→ 行为与拆分前完全一致', () => {
  const base = mkReport();
  const out = renderPushText(mkReport({
    report_type: 'post_market',
    payload: { ...base.payload, simulation_stock: { ...base.payload.simulation_stock, streak_pool: null, streak_pool_basis: null } },
    missing_notes: [],
  }));
  assert.ok(!out.includes('连板池'), 'streak_pool null → 不渲染连板池块（盘后行为不变）');
  assert.match(out, /候选池 \d+ 只（按连板数排序/, '盘后候选池标签/排序口径不变');
});

// ── 8c. 实时情绪 + 收盘倒计时降级（2026-10-10 用户指令）────────────────
test('renderPushText：live_emotion 在场 → 情绪行渲染盘中实时六状态，昨收五期标签不再冒充今日', () => {
  const base = mkReport();
  const out = renderPushText(mkReport({
    report_type: 'intraday',
    payload: { ...base.payload, simulation_stock: { ...base.payload.simulation_stock,
      live_emotion: { date: '20261010', emotion: '主升', score: 72, metrics: null } } },
    missing_notes: [],
  }));
  assert.match(out, /情绪周期\(盘中实时\): 主升 · 强度 72 · 建议仓位:/, '实时六状态 + 强度分进情绪行');
  assert.ok(!/情绪周期: 发酵期\(recover\)/.test(out), '有实时值时昨收口径行退场（两行互斥，防误读）');
  // 缺席 → 回落昨收口径（不冒充、不静默省略）
  const fb = renderPushText(mkReport({ report_type: 'intraday', payload: { ...base.payload }, missing_notes: [] }));
  assert.match(fb, /情绪周期: [^（(]+\(recover\)/, 'live_emotion 缺席 → 昨收五期标签照旧');
});

test('renderPushText：trend_pool_mode=tomorrow_watch → 趋势池标签换「明日观察池」，口径行明示降级', () => {
  const base = mkReport();
  const sim = { ...base.payload.simulation_stock,
    trend_pool_mode: 'tomorrow_watch',
    candidate_pool: [
      { code: '600801', name: '尾盘趋势股', score: 0.7, themes: ['消费'], selection_reason: '量比 3.0', intraday_chg: 5.0, fundamentals: { pe: 20, pb: 1.2 }, data_completeness: { level: 'full', missing: [] } },
    ] };
  const out = renderPushText(mkReport({
    report_type: 'intraday',
    payload: { ...base.payload, simulation_stock: sim },
    missing_notes: [],
  }));
  assert.match(out, /明日观察池 1 只（按综合得分排序，Top 1 · 原四条件筛选·距收盘不足30分钟自动降级（明日观察，不作当日买入依据））：/, '降级标签+口径（标题=语义）');
  assert.match(out, / 1\. 600801 尾盘趋势股 · 得分 0\.7/, '标的行照常渲染（观察语义换标签，不换标的）');
  assert.ok(!out.includes('趋势池 1 只'), '降级后不再出现「趋势池」标签（一词一义，不混用）');
});

// ── 8d. 推送前校验台账行 + 指纹审计字段（2026-10-10 用户指令）────────────
test('renderPushText：push_verification（applied·有剔除/降级）→ 台账行；零变动/旧档 → 行缺席', () => {
  const base = mkReport();
  const sim = { ...base.payload.simulation_stock,
    candidate_pool: [
      { code: '600801', name: '尾盘趋势股', score: 0.7, themes: ['消费'], selection_reason: '量比 3.0', intraday_chg: 5.0, fundamentals: { pe: 20, pb: 1.2 }, data_completeness: { level: 'full', missing: [] } },
    ] };
  const out = renderPushText(mkReport({
    report_type: 'intraday',
    payload: { ...base.payload, simulation_stock: sim },
    push_verification: {
      applied: true, snapshotAtBJ: '2026-10-12 14:53', checkedAtBJ: '14:54',
      minutes_to_close: 6, mode_degraded: true, trend_pool_mode: 'tomorrow_watch',
      trend: { checked: 2, removed: [{ code: '600802', name: '已涨停股', reason: '已涨停（最新快照现 10%）', kind: 'structural' }] },
      streak: { checked: 0, removed: [] },
    },
    missing_notes: [],
  }));
  assert.match(out, /推送前校验（快照 2026-10-12 14:53）：⛔ 结构违背剔除 1 只（600802 已涨停（最新快照现 10%））；趋势池→明日观察池（距收盘 6 分钟）/, '台账行：结构剔除明细 + 降级');
  // 零变动（applied 但无剔除无降级）→ 不刷屏
  const quiet = renderPushText(mkReport({
    report_type: 'intraday',
    payload: { ...base.payload, simulation_stock: sim },
    push_verification: { applied: true, trend: { checked: 1, removed: [] }, streak: { checked: 0, removed: [] }, mode_degraded: false },
    missing_notes: [],
  }));
  assert.ok(!quiet.includes('推送前校验'), '零变动不渲染台账行');
  // 旧档（无 push_verification）/skipped（applied=false）→ 行缺席（不冒充校验过）
  const old = renderPushText(mkReport({ report_type: 'intraday', payload: { ...base.payload, simulation_stock: sim }, missing_notes: [] }));
  assert.ok(!old.includes('推送前校验'), '旧档无字段 → 台账行自然缺席');
  const skipped = renderPushText(mkReport({
    report_type: 'intraday',
    payload: { ...base.payload, simulation_stock: sim },
    push_verification: { applied: false, note: '复核快照缺席/非当日' },
    missing_notes: [],
  }));
  assert.ok(!skipped.includes('推送前校验'), 'skipped 不渲染台账行（不冒充校验过）');
});

test('renderPushText 置信度标签（2026-10-10 用户指令）：与 push_verification 三态同源', () => {
  const base = mkReport();
  const sim = { ...base.payload.simulation_stock,
    candidate_pool: [
      { code: '600801', name: '趋势股', score: 0.7, themes: ['消费'], selection_reason: '量比 3.0', intraday_chg: 5.0, fundamentals: { pe: 20, pb: 1.2 }, data_completeness: { level: 'full', missing: [] } },
    ] };
  // applied=true（同拍逐只核验通过）→ 头部行带「置信度 高」
  const high = renderPushText(mkReport({
    report_type: 'intraday',
    payload: { ...base.payload, simulation_stock: sim },
    push_verification: { applied: true, snapshotAtBJ: '2026-10-12 09:35', trend: { checked: 1, removed: [] }, streak: { checked: 0, removed: [] }, mode_degraded: false },
    missing_notes: [],
  }));
  assert.ok(high.includes('置信度 高（逐只核验通过）'), 'applied → 高（逐只核验通过）');
  // applied=false（跨拍仅审计/校验缺席）→ 低——如实显式，不冒充已核验
  const low = renderPushText(mkReport({
    report_type: 'intraday',
    payload: { ...base.payload, simulation_stock: sim },
    push_verification: { applied: false, note: '快照非报告构建拍 → 跨拍仅审计不剔除', trend: { checked: 1, removed: [] }, streak: { checked: 0, removed: [] } },
    missing_notes: [],
  }));
  assert.ok(low.includes('置信度 低（时点核验缺席，结构预筛已过）'), '未应用 → 低（不冒充）');
  // 无 push_verification（旧档）→ 不渲染置信度段（不冒充已校验）
  const old = renderPushText(mkReport({ report_type: 'intraday', payload: { ...base.payload, simulation_stock: sim }, missing_notes: [] }));
  assert.ok(!old.includes('置信度'), '旧档无台账 → 置信度标签缺席');
  // 盘后报告（simBlock 无 confidence 入参）→ 头部行零变化（行为不变）
  const post = renderPushText(mkReport({ payload: { ...base.payload, simulation_stock: { ...base.payload.simulation_stock, streak_pool: null } } }));
  assert.ok(!post.includes('置信度'), '盘后不带盘中置信度段');
});

test('pushReports：成功推送记指纹时携带 verified 审计摘要（每次推送写入指纹）', async () => {
  const base = mkReport();
  const r = mkReport({
    report_type: 'intraday',
    payload: { ...base.payload },
    push_verification: {
      applied: true, checkedAtBJ: '14:54', snapshotAtBJ: '2026-10-12 14:53',
      trend_pool_mode: 'tomorrow_watch', minutes_to_close: 6, mode_degraded: true,
      trend: { checked: 2, removed: [{ code: '600802', name: 'x', reason: '已涨停' }] },
      streak: { checked: 1, removed: [{ code: '600803', name: 'y', reason: '量比不足' }] },
    },
  });
  const dir = mkdtempSync(join(tmpdir(), 'airpt-verify-'));
  const stateFile = join(dir, 'push_state.json');
  try {
    const ok = await pushReports([r], {
      env: { OPS_WEBHOOK: 'https://example.test/hook' },
      fetchImpl: async () => ({ ok: true }),
      stateFile, now: new Date('2026-10-12T06:55:00Z'),
    });
    assert.equal(ok.pushed, 1);
    const entry = loadPushState(stateFile).pushed[0];
    assert.ok(entry.fingerprint, '指纹在场');
    assert.deepEqual(entry.verified, {
      checked_at: '14:54', snapshot_at: '2026-10-12 14:53',
      removed: 2, degraded: true, skipped: false,
    }, '指纹条目携带校验审计摘要');
    // 旧档/非盘中报告无 push_verification → 条目无 verified 字段（不冒充）
    const r2 = mkReport();
    const dir2 = mkdtempSync(join(tmpdir(), 'airpt-verify2-'));
    try {
      await pushReports([r2], {
        env: { OPS_WEBHOOK: 'https://example.test/hook' },
        fetchImpl: async () => ({ ok: true }),
        stateFile: join(dir2, 's.json'), now: new Date('2026-10-12T06:55:00Z'),
      });
      const e2 = loadPushState(join(dir2, 's.json')).pushed[0];
      assert.equal(e2.verified, undefined, '无校验台账 → verified 缺席（undefined 不入 JSON）');
    } finally { rmSync(dir2, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
