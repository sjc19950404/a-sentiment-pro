/* =============================================================
 * 阶段 2 验收探针（只读线上，零改动）
 * 覆盖 10 册 §7 五条契约 + CodeBuddy 交付的 5 条验收重点：
 *   1) V2-1  #sKpiScore 与研报 #emScore 逐字一致
 *   2) 契约① 默认研报 6 KPI 逐字不变（旧节点原位不动）
 *   3) 白屏① 幂等重搬：重复 render / mutation 后新根不空、不回旧布局
 *   4) 契约③ CLS 按「不劣于 0.174」判（≤0.10 留阶段 5）
 *   5) 8 tab：「总览」走注册页，其余 7 个占位；来回切不抛错
 *   另：阶段 1 布局回归、控制台异常、数据源全局、06 册 L113 口径冲突实测
 *
 * 用法：node design/verify_phase2_gates.cjs
 * 产物：design/assets/阶段2验收.json
 * 依赖：Node 22（全局 WebSocket）+ 本机 Edge；无外部 npm 包
 * 缓存：与阶段 1 同口径——预热导航 + Network.setCacheDisabled + 唯一 query
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const ROOT = path.dirname(DIR);
const ASSETS = path.join(DIR, 'assets');
const OUT = path.join(ASSETS, '阶段2验收.json');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://sjc19950404.github.io/a-sentiment-pro/';
const PORT = 10236;
const PROFILE = path.join(ROOT, '_probe_p2_' + PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 同步状态快照：新旧 KPI、锚点、数据源、布局、异常面 */
const PROBE = `(() => {
  const q = s => document.querySelector(s);
  const t = s => { const n = q(s); return n ? n.textContent.trim() : null; };
  const sRoot = document.getElementById('sRoot');
  const panel = q('#sRoot .s-ph-panel');
  const host = q('.s-page-overview');
  const kpiIds = ['sKpiScore','sKpiRegime','sKpiPos','sKpiLimit','sKpiBreadth','sKpiLhb'];
  const kpis = Object.fromEntries(kpiIds.map(id => [id, t('#' + id)]));
  const old = {
    emScore: t('#emScore'), emPct: t('#emPct'), emTier: t('#emTier'), emNet: t('#emNet'),
    zoneOverviewExists: !!document.getElementById('zone-overview'),
    emScoreInZone: !!(document.getElementById('emScore') &&
      document.getElementById('emScore').closest('#zone-overview')),
    breadthPanelExists: !!document.getElementById('breadthPanel'),
    breadthInZone: !!(document.getElementById('breadthPanel') &&
      document.getElementById('breadthPanel').closest('#zone-overview')),
    breadthKpis: [...document.querySelectorAll('#breadthPanel .bw-kpi')]
      .map(e => (e.textContent || '').trim()).slice(0, 8)
  };
  const arc = window.__lastArc;
  const day = (() => {
    const all = (arc && arc.all_days) || [];
    const days = all.filter(d => !(d.emotion && d.emotion._backfill));
    return days[days.length - 1] || null;
  })();
  return {
    href: location.href,
    bodyView: document.body.dataset.view || '',
    innerHeight, innerWidth,
    sKeys: Object.keys(window.S || {}),
    // 页路由与锚点
    overviewExists: !!host,
    overviewChildren: host ? host.children.length : 0,
    overviewInPanel: !!(host && panel && panel.contains(host)),
    kpiAnchors: Object.fromEntries(kpiIds.map(id => [id, !!document.getElementById(id)])),
    kpis,
    // 06 册 L113 的原断言（要求 #emScore 在新根内）——契约①下预期为 false
    docL113_oldNodeInNewRoot: !!q('.s-page-overview #emScore'),
    // 旧视图
    old,
    mainHidden: !!(document.querySelector('main') || {}).hidden,
    mainDisplay: document.querySelector('main') ? getComputedStyle(document.querySelector('main')).display : null,
    // 数据源
    dataSrc: {
      hasLastArc: !!arc, arcDays: (arc && arc.all_days || []).length,
      hasDay: !!day,
      daySummary: day && day.summary ? {
        zt_count: day.summary.zt_count, dt_count: day.summary.dt_count,
        up_count: day.summary.up_count, down_count: day.summary.down_count
      } : null,
      dayEmotion: day && day.emotion ? {
        value: day.emotion.value, pct_rank: day.emotion.pct_rank, lhb_daily_net: day.emotion.lhb_daily_net
      } : null,
      hasSignals: !!window.__signals,
      regimeKey: (window.__signals && window.__signals.regime && window.__signals.regime.latest || {}).key || null
    },
    // 阶段 1 布局回归
    sRoot: sRoot ? { cls: sRoot.className, hidden: sRoot.hasAttribute('hidden'),
      display: getComputedStyle(sRoot).display, offsetHeight: sRoot.offsetHeight,
      rectTop: Math.round(sRoot.getBoundingClientRect().top) } : null,
    bodyScrollHeight: document.body.scrollHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    tabs: [...document.querySelectorAll('#sRoot .s-ph-tab')].map(b => ({
      text: (b.textContent || '').trim(), active: b.classList.contains('is-active'), disabled: b.disabled }))
  };
})()`;

/* 幂等重搬：模拟重复 render 后的 innerHTML 覆盖 + characterData 变化 */
const IDEM = `(async () => {
  const wait = () => new Promise(r => setTimeout(r, 120));
  const zone = document.getElementById('zone-overview');
  const em = document.getElementById('emScore');
  const host = document.querySelector('.s-page-overview');
  if (!zone || !em || !host) return { skipped: true, reason: 'zone/em/host 缺失' };
  const orig = em.textContent;
  const card = zone.querySelector('.card.emotion') || zone.firstElementChild;
  const bak = card ? card.innerHTML : null;   // 原始 HTML（在改动前取，才能真还原）
  const read = () => (document.getElementById('sKpiScore') || {}).textContent || null;
  const before = read();
  // ① characterData 变化（renderEmotion 的实际写法：改 textContent）
  em.textContent = 'SENTINEL-77';
  await wait();
  const afterChar = read();
  // ② 第二帧 childList 覆盖：重设 zone 内子容器 innerHTML（模拟重复 render 覆盖旧容器）
  if (card) { card.innerHTML = card.innerHTML; }
  await wait();
  const afterChild = read();
  // ③ 用原始 HTML 还原，确认 observer 仍活着且新旧值最终一致
  if (card && bak != null) card.innerHTML = bak;
  await wait();
  const afterRestore = read();
  const emNow = document.getElementById('emScore');
  const finalOld = emNow ? emNow.textContent.trim() : orig;
  return {
    skipped: false, before, afterChar, afterChild, afterRestore, finalOld,
    charSynced: afterChar === 'SENTINEL-77',
    childSurvived: !!document.querySelector('.s-page-overview #sKpiScore'),
    restored: afterRestore === finalOld,
    hostStillInPanel: !!document.querySelector('#sRoot .s-ph-panel .s-page-overview')
  };
})()`;

/* 8 tab 往返：总览 → 资金 → 总览 */
const TABS = `(async () => {
  const wait = () => new Promise(r => setTimeout(r, 160));
  const tabs = [...document.querySelectorAll('#sRoot .s-ph-tab')];
  if (tabs.length !== 8) return { skipped: true, tabs: tabs.length };
  const state = () => ({
    title: (document.querySelector('#sRoot .s-ph-title') || {}).textContent || null,
    overview: !!document.querySelector('#sRoot .s-ph-panel .s-page-overview'),
    kpiScore: (document.getElementById('sKpiScore') || {}).textContent || null
  });
  const a = state();
  tabs[2].click(); await wait();
  const b = state();
  tabs[0].click(); await wait();
  const c = state();
  return { skipped: false, initial: a, afterFund: b, backOverview: c,
    fundIsPlaceholder: !!b.title && /资金/.test(b.title),
    overviewRebuilt: c.overview && c.kpiScore != null };
})()`;

(async () => {
  const report = { time: new Date().toISOString(), base: BASE, cases: [], verdict: {}, errors: [], loadFailures: [] };
  if (!fs.existsSync(EDGE)) { console.error('未找到 Edge：' + EDGE); process.exitCode = 2; return; }
  const proxy = process.env.https_proxy || '';
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--allow-file-access-from-files', '--disable-background-networking',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1440,1000', 'about:blank'
  ];
  if (proxy) args.push('--proxy-server=' + proxy);
  const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
  try {
    let ver = null;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
      await sleep(300);
    }
    if (!ver) throw new Error('CDP 未启动（端口 ' + PORT + '）');
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pend = new Map();
    ws.onmessage = ev => {
      let s = ev.data;
      if (typeof s !== 'string') s = Buffer.from(s).toString('utf8');
      let m; try { m = JSON.parse(s); } catch (e) { return; }
      if (m.method === 'Runtime.exceptionThrown') {
        report.errors.push((m.params.exceptionDetails && m.params.exceptionDetails.text) || 'exception');
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        report.errors.push('console.error: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
      }
      if (m.method === 'Network.loadingFailed') {
        report.loadFailures.push((m.params.errorText || '') + ' type=' + (m.params.type || ''));
      }
      if (m.id && pend.has(m.id)) {
        const p = pend.get(m.id); pend.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
    const cmd = (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq; pend.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error(method + ' 超时')); } }, 25000);
    });
    const evaluate = async (expr, awaitPromise = false) => {
      const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
      if (r && r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.text || ''));
      return r && r.result && r.result.value;
    };
    await cmd('Page.enable'); await cmd('Runtime.enable');
    try { await cmd('Network.enable'); await cmd('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
    const CB = '_cb=' + Date.now();
    // 轮询等就绪：禁用缓存后 516KB bundle + 34 个 data JSON 全量回源，固定 sleep 不够。
    // 必须等 s-root.js 建出 #sRoot、且 renderAll 挂上 __lastArc，否则取样到的是静态占位页。
    const waitFor = async (expr, timeoutMs) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try { if (await evaluate(expr)) return Date.now() - t0; } catch (e) {}
        await sleep(400);
      }
      return -1;
    };
    // 预热导航：首次整页导航会命中旧 SW 外壳（cacheKeyOf 剥 query），第 2 次起才是本次部署资源
    await cmd('Page.navigate', { url: BASE + '?_warmup=' + Date.now() });
    await waitFor("!!(window.S && document.getElementById('sRoot'))", 18000);
    await sleep(1200);

    const nav = async (url, label) => {
      let readyMs = -1, dataMs = -1, s = null, attempts = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        attempts = attempt + 1;
        const u = BASE + url + (attempt ? '&_retry=' + Date.now() : '');
        await cmd('Page.navigate', { url: u });
        readyMs = await waitFor("!!(window.S && document.getElementById('sRoot'))", 18000);
        dataMs = await waitFor("!!window.__lastArc", 18000);
        await sleep(600);   // 让 MutationObserver 微任务与 render 收尾
        s = await evaluate(PROBE);
        // SW 旧外壳会给出 sKeys:[] / sRoot:null 的静态占位页，重试一次导航取新资源
        if (s && s.sRoot && (s.sKeys || []).length > 0) break;
        console.log('  (第 ' + attempts + ' 次取样未就绪，重试导航)');
      }
      report.cases.push({ label, url: BASE + url, readyMs, dataMs, attempts, state: s || null });
      console.log('\n--- ' + label + ' (readyMs=' + readyMs + ', dataMs=' + dataMs + ', attempts=' + attempts + ') ---');
      console.log(JSON.stringify(s, null, 2));
      return s;
    };

    // 1) 工作台（主验收）
    const wb = await nav('?view=workbench&' + CB, '?view=workbench');
    // 1a) 幂等重搬
    const idem = await evaluate(IDEM, true);
    report.idempotency = idem || null;
    console.log('\n--- 幂等重搬 ---\n' + JSON.stringify(idem, null, 2));
    // 1b) 8 tab 往返
    const tabs = await evaluate(TABS, true);
    report.tabs = tabs || null;
    console.log('\n--- 8 tab 往返 ---\n' + JSON.stringify(tabs, null, 2));
    // 1c) CLS（双档 + 5000ms，契约③按不劣于 0.174 判）
    let cls = null;
    try {
      cls = await evaluate('window.S && typeof S.collectCls === "function" ? S.collectCls() : null', true);
    } catch (e) { cls = { error: String(e.message || e) }; }
    report.cls = cls;
    console.log('\n--- CLS ---\n' + JSON.stringify(cls, null, 2));
    // 1d) 自检脚本（顺带看阶段 2 下有无新异常）
    let st = null;
    try { st = await evaluate('window.S && typeof S.runSelfTest === "function" ? S.runSelfTest() : null', true); }
    catch (e) { st = { error: String(e.message || e) }; }
    report.selfTest = st;
    console.log('\n--- runSelfTest ---\n' + JSON.stringify(st, null, 2));

    // 2) 同页 popstate 回默认（同一文档，数据未变 → 契约①最严格的比对）
    await evaluate(`history.pushState({}, '', '${BASE}?popstate=1'); window.dispatchEvent(new PopStateEvent('popstate'));`);
    await sleep(900);
    const pop = await evaluate(PROBE);
    report.cases.push({ label: '同页 popstate 回默认', url: BASE + '?popstate=1', state: pop || null });
    console.log('\n--- 同页 popstate 回默认 ---\n' + JSON.stringify(pop, null, 2));

    // 3) 整页导航回默认 /
    const def = await nav('?' + CB, '默认 /（整页）');

    // ---- 判定 ----
    const kpi = (s, id) => s && s.kpis ? s.kpis[id] : null;
    const oldKpi = s => s && s.old ? [s.old.emScore, s.old.emPct, s.old.emTier, s.old.emNet] : [];
    const clsNum = cls && typeof cls.value === 'number' ? cls.value : null;
    report.verdict = {
      // 1) V2-1
      v21_score_equal_old: !!(wb && kpi(wb, 'sKpiScore') != null && kpi(wb, 'sKpiScore') === wb.old.emScore),
      v21_score_not_placeholder: !!(wb && kpi(wb, 'sKpiScore') && !/^--|^—$/.test(kpi(wb, 'sKpiScore'))),
      // 2) 6 KPI 锚点与取值
      six_kpi_anchors_present: !!(wb && Object.values(wb.kpiAnchors || {}).every(Boolean)),
      six_kpi_all_filled: !!(wb && Object.values(wb.kpis || {}).every(v => v && v !== '—')),
      overview_in_panel: !!(wb && wb.overviewInPanel),
      // 3) 契约①：旧节点原位不动 + 默认研报 6 KPI 逐字不变
      old_nodes_untouched: !!(wb && wb.old.emScoreInZone && !wb.docL113_oldNodeInNewRoot),
      default_kpi_unchanged_vs_popstate: !!(pop && def &&
        JSON.stringify(oldKpi(pop)) === JSON.stringify(oldKpi(def)) &&
        JSON.stringify(oldKpi(wb)) === JSON.stringify(oldKpi(pop))),
      // 用同页 popstate 的真实状态判定；整页默认视图另由阶段 1 门禁 21/21 交叉验证
      default_sRoot_truly_hidden: !!(pop && pop.sRoot && pop.sRoot.hidden === true && pop.sRoot.offsetHeight === 0),
      // 4) 白屏① 幂等重搬
      idempotent_char_sync: !!(idem && idem.charSynced),
      idempotent_child_survived: !!(idem && idem.childSurvived && idem.hostStillInPanel),
      idempotent_restored: !!(idem && idem.restored),
      // 5) CLS 契约③
      cls_available: clsNum != null,
      cls_not_degraded: clsNum != null ? clsNum <= 0.174 : null,
      cls_pass_010: cls && cls.pass != null ? cls.pass : null,
      // 6) 8 tab
      tabs_count_8: !!(wb && wb.tabs && wb.tabs.length === 8),
      overview_tab_registered: !!(tabs && tabs.initial && tabs.initial.overview),
      other_tabs_placeholder: !!(tabs && tabs.fundIsPlaceholder && !tabs.afterFund.overview),
      overview_rebuilt_on_return: !!(tabs && tabs.overviewRebuilt),
      // 7) 阶段 1 布局回归 + 数据源 + 异常
      phase1_layout_intact: !!(wb && wb.sRoot && wb.sRoot.rectTop === 0 &&
        wb.bodyScrollHeight <= wb.innerHeight + 2),
      // __lastArc / __signals 是两批不同的 data/*.json，到达有先后，不要求首帧同时就绪
      data_source_ready: !!(wb && wb.dataSrc && wb.dataSrc.hasLastArc && wb.dataSrc.hasDay),
      signals_arrived_later: !!(pop && pop.dataSrc && pop.dataSrc.hasSignals),
      // 记录首帧「未生成」现象（详见 阶段2数据迟到时序.json），不作通过/失败
      regime_at_first_paint: kpi(wb, 'sKpiRegime'),
      regime_pending_at_first_paint: !!(wb && kpi(wb, 'sKpiRegime') === '未生成'),
      page_router_present: !!(wb && (wb.sKeys || []).includes('registerPage') && (wb.sKeys || []).includes('showPage')),
      console_exceptions: report.errors.length,
      load_failures: report.loadFailures.length,
      // 8) 06 册 L113 口径冲突（记录事实，不作通过/失败）
      doc_l113_assertion_false_by_contract: wb ? (wb.docL113_oldNodeInNewRoot === false) : null
    };
    ws.close();
  } catch (e) {
    report.error = String(e.message || e);
    console.error('探针异常：' + report.error);
  } finally {
    try { child.kill(); } catch (e) {}
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
  report.errors = report.errors.slice(0, 25);
  if (!fs.existsSync(ASSETS)) fs.mkdirSync(ASSETS, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n===== 判定 =====\n' + JSON.stringify(report.verdict, null, 2));
  console.log('报告：' + OUT);
})();
