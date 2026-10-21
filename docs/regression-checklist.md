# 回归检查清单 · 双池拆分 + 推送前校验 + 收盘复核

> **目的**：验证 2026-10-10 这批修复（连板/趋势双池拆分、盘中实时情绪、推送前逐只校验、
> 同拍守卫、指纹 verified 审计、收盘口径复核）在真实交易日是否全部生效。
> **建议时机**：下一交易日（周一 2026-10-12）全天跑一遍；§0 离线自检任何时刻可跑。
> 命令均在本仓库根执行；`D` 泛指交易日（如 `2026-10-12`）。

---

## §0 离线自检（现在/周末即可跑，约 15 秒）

```powershell
node --test                          # 预期 1531 用例全绿（0 fail）
node scripts/check_contract.mjs      # 预期 17/18：仅 intraday_2026-09-30 先存旧档违例（已知，与本批无关）
```

任一用例红 → 先修再上线，不要带病跑当日链路。

---

## §1 连板池不再错误套用趋势池规则

| 时点 | 怎么验 | 通过判据 |
|---|---|---|
| 任意 | `node --test test/ai_report_split.test.mjs test/pool_verify.test.mjs` | 全绿（含「连板池标题绝不冒充趋势池口径」） |
| 推送后 | 看盘中推送文案连板池标题行 | 「连板池 N 只（按连板数排序…）」——**不含**「涨幅3-7%」「未涨停」字样 |
| 推送后 | 查当日档案 `data/reports/intraday_D.json` | `streak_pool` 各标的 `intraday_chg` ≈ 10%（连板股当日必涨停） |
| 推送日志 | CI 日志「推送前校验」行 | 连板池剔除 reason **只允许**：连板身份消失（疑似炸板）/ 量比不足 / 主力净流入转负 |

**失败信号**：连板池剔除 reason 出现「已涨停」「涨幅出带」，或 streak 标的涨幅 3-7% —— 判据被趋势池规则污染。
**定位**：`src/ai_report.js` buildStreakPool / `src/pool_verify.js` verifyIntradayPools 连板分支。

---

## §2 趋势池不混入涨停或跌幅股

**当日 09:50 后对最新档案跑**（推送前校验的同口径复核）：

```powershell
node -e "const r=require('./data/reports/intraday_2026-10-12.json'),s=require('./data/intraday.json');const zt=new Set(s.pools.zt_codes.map(String));const bad=r.payload.simulation_stock.candidate_pool.filter(x=>zt.has(String(x.code))||!(x.intraday_chg>3&&x.intraday_chg<7));console.log('违例',bad.length,'只:',bad.map(x=>x.code+'@'+x.intraday_chg+'%').join(' ')||'无')"
```

| 检查 | 通过判据 |
|---|---|
| 上述命令输出 | `违例 0 只: 无`（涨幅恒在 3-7% 带内、不在涨停名单） |
| 推送文案 | 趋势池标题口径「涨幅3-7% · 量比>2 · 未涨停 · 主力净流入为正」与标的实际一致；若推送时点有标的已涨停 → 台账行「⚠ 推送前校验（快照 …）：剔除 X 只（…已涨停…）」 |
| 档案 | `push_verification.applied=true` 且 `trend.removed` 各项 reason 可解释 |

**失败信号**：池内出现 zt_codes 成员或涨幅出带标的 → 构建判据或校验器失效。
**定位**：`src/ai_report.js` INTRADAY_POOL_FILTERS / `src/pool_verify.js` 趋势分支（注意字段缺失按剔除处理——宁缺毋假）。

---

## §2.5 过滤前后数量与剔除原因落盘（复盘可见性）

**当日推送后跑**（每只被剔标的都必须留有理由，复盘时可逐只归因）：

```powershell
node -e "const r=require('./data/reports/intraday_2026-10-12.json');const pv=r.push_verification;if(!pv){console.log('无 push_verification 台账');process.exit(1)};console.log('快照拍:',pv.snapshotAtBJ,'| applied:',pv.applied);for(const[k,v]of[['趋势池',pv.trend],['连板池',pv.streak]]){console.log(`${k}: 核验 ${v.checked} → 存活 ${v.checked-v.removed.length}，剔除 ${v.removed.length}`);v.removed.forEach(x=>console.log('  剔',x.code,x.name,x.reason))}"
```

| 检查 | 通过判据 |
|---|---|
| 数量对账 | `checked − removed.length` = 推送/档案池中该池标的数（过滤前后数量可追溯） |
| 逐只 reason | `removed[]` 每条带 code/name/reason（无「未知剔除」） |
| 构建端台账 | 档案 `streak_pool_basis` 含统计行：「连板≥2 共 X 只，宇宙在榜 Y 只，剔除——量比/净流出/缺失各计数」 |
| 审计完整性 | 跨拍/跳过场景 `applied=false` + `note` 报因——「为什么没校验」与「剔了谁」同等留痕 |

**失败信号**：池标的数 ≠ checked − removed（剔除静默丢失），或 removed 有条目无 reason → 复盘断链。
**定位**：`src/pool_verify.js` applyVerification / `src/ai_report.js` streak_pool_basis 统计。

---

## §3 情绪标签与炸板率/连板数一致

**判据先明确**（`src/emotion_cycle.js` classifyEmotion，风险优先级：冰点>退潮>高潮>主升>复苏）：

| 状态 | 触发条件（全用 ztpool 收盘池口径） |
|---|---|
| 冰点 | 涨停 < 30 **且** 炸板率 > 40% |
| 退潮 | 炸板率 > 40% **且** 最高板较前日下降 |
| 高潮 | 涨停 > 100 **且** 硬板率 > 70% |
| 主升 | 涨停 > 60 **且** 连板 > 15 **且** 主线集中度 > 0.3 |
| 复苏 | 涨停较前日升 **且** 炸板率较前日降 |

⚠ 口径提醒：情绪判据是**炸板率 + 涨停数 + 最高板 + 主线集中度**——「晋级率」是盘后
pain 口径字段，不在情绪判据里，别拿它对标签。

**验证**（16:00 入库后跑，对照当日推送）：

```powershell
node -e "import('./src/emotion_cycle.js').then(m=>{const h=require('./data/ztpool_history.json');const t=h.at(-1),p=h.at(-2);const e=m.computeEmotion(t.pool,m.computeEmotionMetrics(p.pool),String(t.date));console.log('收盘情绪:',e.emotion,e.score,'分')})"
```

| 检查 | 通过判据 |
|---|---|
| 上述输出 vs 18:30/21:00 CI 日志 `[caliber-review] D 收盘情绪 X Y分` | 一致（收盘情绪从 ztpool 现算，两侧同源） |
| 推送文案「情绪周期(盘中实时): X · 强度 Y」 vs 收盘情绪 | 允许漂移（盘中→收盘数据变化），但 caliber_review 里两值都有记录、可解释 |
| 矛盾台账 | `caliber_review.conflicts` 为空（连板宣称 vs 收盘差 ≤1） |

**失败信号**：手工算出的状态与推送标签不符 → 优先级顺序被改，或 live_emotion 用了非当日快照。
**定位**：`src/emotion_cycle.js` classifyEmotion 优先级注释（冰点>退潮>高潮>主升>复苏）。

---

## §4 尾盘推送（~14:43）正确标记明日观察池

**背景**：14:00 report job 因 cron 延迟实推约 14:43，距收盘 17 分钟 < 30 分钟 → 降级窗。

| 时点 | 怎么验 | 通过判据 |
|---|---|---|
| 14:50 后 | 看当日推送文案 | 标签「**明日观察池** N 只（按综合得分排序…距收盘不足30分钟自动降级（明日观察，不作当日买入依据））」+ 台账行「趋势池→明日观察池（距收盘 X 分钟）」 |
| 14:50 后 | 查档案 | `simulation_stock.trend_pool_mode='tomorrow_watch'`、`push_verification.mode_degraded=true`、`minutes_to_close<30` |
| 14:50 后 | 查 `data/reports/push_state.json` 当日 14 点班条目 | `verified.degraded=true` |
| 09:35 班 | 反向检查 | 09:43 推送**不应**降级（距收盘远）→ `trend_pool_mode='trend'`、无降级口径行 |

**失败信号**：14:43 推送仍标「趋势池」且无降级口径 → `opts.nowBJ`（推送时刻）没传进校验器，或 `minutesToCloseBJ` 时区错。
**定位**：`scripts/push_ai_report.mjs`（`bjTime(new Date())` 传参）/ `src/pool_verify.js` 降级窗（只升不降）。

---

## §5 push_state 防重复发送旧快照

```powershell
node -e "const s=require('./data/reports/push_state.json');const d=s.pushed.filter(e=>e.date==='2026-10-12');console.log(d.length,'条');d.forEach(e=>console.log(e.type,'|',e.pushed_at,'| verified:',JSON.stringify(e.verified)))"
```

| 检查 | 通过判据 |
|---|---|
| 条目数 | 当日 intraday 各期**各 1 条**（09:35 班、14:00 班），无重复 |
| verified 字段 | 每条带 `{checked_at, snapshot_at, removed, degraded, skipped}`，`snapshot_at` = 当期快照拍（非旧快照） |
| 指纹去重 | CI 重跑同一报告 job（re-run）→ 日志「跳过（30 天内同内容已推）」，企微不重复收消息 |
| 同拍守卫 | 周末手动 `node scripts/push_ai_report.mjs data/reports/intraday_D.json` → 池**数量不变**、日志「跳过——快照非报告构建拍…跨拍仅审计不剔除」 |

**失败信号**：同内容重复推送（防风暴失效），或条目 `snapshot_at` 是别的时点（校验没跑或跑在旧快照上）。
**定位**：`src/ai_report_push.js` fingerprintOf/shouldPush / `src/pool_verify.js` 同拍守卫（`snapshotAtBJ` 比对）。

---

## §6 16:00 入库任务零影响（触发/范围/git 规则）

| 时点 | 怎么验 | 通过判据 |
|---|---|---|
| 现在 | `schtasks /query /tn "\ASentiment-dailyfetch-1600"` | 任务在、状态 Ready、下次触发周一 16:00 |
| 周一 16:05 后 | `git log --oneline -3` | 出现「data: 涨停池历史入库 2026-10-12（不可补采，幂等追加）」 |
| 同上 | `git status -sb` | `data/ztpool_history.json` 已被提交（工作区该文件干净）；**其余未提交改动（data/reports 等）不被它裹挟**——本地任务只 `git add data/ztpool_history.json` |
| 同上 | GitHub staging 分支 | 该 commit 已 push；18:30 CI 的收盘复核日志不再报「无当日收盘档」（说明读到当日行） |

**红线**：`ztpool_history.json` 脏档**绝不** `git checkout --` 丢弃（东财接口只回最近交易日，历史不可回补）。
**失败信号**：16:00 没跑 / commit message 变形 / add 了别的文件 → 入库任务被本轮改动波及（本批只加 CI build job 一步 + 只读 ztpool_history，理论零交集，出问题即回归）。

---

## 附：周一全天时序速查

| 北京时间 | 事件 | 看什么 |
|---|---|---|
| 09:00-15:00 | tick 快照每半小时（09:00 起） | `data/intraday.json` capturedAtBJ 刷新 |
| ~09:43 | 09:35 report job 实推 | §1 §2 §5（首推：applied、零剔除为常态） |
| ~14:43 | 14:00 report job 实推 | §4（降级窗：明日观察池 + verified.degraded） |
| 16:00 | 本地入库任务 | §6（ztpool_history 当日行入库） |
| 18:30 | CI 盘后 build | §3（收盘口径复核日志 + caliber_review 随 data/reports 入库） |
| 21:00 | CI 晚间补抓 | 复核幂等覆盖（若 18:30 时 ztpool 未入库，此班补上） |
