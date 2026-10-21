# P1 断供事件复盘 + 决策记录（2026-10-10 定稿）

## 事件时间线（档案证据）

| 日期 | 事实 |
|---|---|
| 10-08 起 | `archive.json` 涨破 `audit_lhb_caliber.mjs` 体积审计阈值 → build job 提交步被整条拦死 |
| 10-08 ~ 10-09 | 两个交易日所有数据产物（archive day / pain-latest / board_rank / signals 等）零提交 |
| 10-09 21:43 | 阈值修复（f19a1fc），此后 pipeline 恢复正常 |
| 10-09 16:00 | 本地 Windows 任务守住了 `ztpool_history.json` 的 10-09 收盘档（69 只，含 lbc/fund/fbt）——本次事件中**唯一完整抢救**的 10-09 数据 |
| 10-10 01:24 ~ 02:44 | v4 快照批（双池拆分 + 企微加固 + 新鲜度探针）三轮合码收口（e88648c / 9698c16 / 8e66e94） |
| 10-10 03:38 | 10-09 v4 拼盘报告经 CI 真实推送企微成功（errcode 0，结构性验收；main_net=fund 代理、量比腾讯拼盘两条毛刺已记台账） |
| 10-10 复盘 | 发现一字闸被 fbt 数字形态击穿（新华传媒 9 板一字漏闸进池，时代万恒/紫竹高科被量比闸碰巧拦下）——修复 2aa5da0（三处 padStart + 数字形态回归测试），回放终稿 `intraday_2026-10-09_v4_final.json`（8 只）入库未推送 |

## 根因与放大器

- **根因**：体积审计阈值拦死 CI 提交，10-08 / 10-09 两天整条数据管线断档。
- **放大器**：`fetch_pain` 拒写盘 exit 2 被 `continue-on-error` 吞掉；
  `board_rank` 无任何新鲜度检查；断供整整 8 天全绿零告警。
- **修复**：`MODULE_PROBES` 并入 pain（锚 `curDate`，勿用 `date` 昨日锚）与
  board_rank（末位日期键）两个探针，此后断供当天必红（6cb6986）。

## 决策：方案 A —— 接受 10-09 空档，自然恢复

拍板日期：2026-10-10。理由：为不影响验收结果的残留毛刺写 backfill 模式，
收益成本比极低。

### 10-09 空档的永久影响（不可回补）

- `archive.json` 无 10-09 day：emotion / hot / LHB / 行业涨幅当日数据永失。
- `pain-latest` 10-08→10-09 一档亏钱效应永缺；10-12 起的 `prev` 跳到 10-08。
- `board_rank` 永久跳过 10-09 一个交易日。
- `ztpool_history.json` 10-09 收盘档完整（已由本地任务抢救）——梯队长链不断。

### 残留毛刺（已知且接受）

- **周一 10-12 09:00 盘前清单**的连板梯队停在 10-08 口径（差一个交易日）。
  盘中候选池走 v4 实时源 `zt_lb`，不受影响。
- 周一 09:00 盘前清单的置信度标签等如常渲染，用户知悉梯队口径差一天。

## 周一 10-12 验收清单

| 时刻 | 动作 | 验收点 |
|---|---|---|
| 09:30 | weekly merge `staging → main` 自动跑 | 五道门禁全绿（含 1557 项测试） |
| 09:35 | 盘中候选池（v4 双池）首次真实数据运行 | ① 一字闸生效：若新华传媒仍一字（fbt≤09:25:00）必被剔（padStart 修复落地；对照基准 = 10-09 回放终稿 8 只） ② 主力净流入走 push2 真值，不再用封单代理 ③ 趋势池若仍为 0，日志注明「当日涨停面过窄」 ④ 跌停硬剔桶无漏网 ⑤ 推送全中文、置信度标签正确 |
| 09:35 | 企微推送链路 | 无 502；失败项走重试 + `failed_pushes` 补推 |
| 18:30 | 首次 fetch_pain 运行 | `curDate=10-12` 正常写盘；此后探针上岗，断供即红 |

## ⚠ 技术注记：历史档 fbt 消费规范（2026-10-10 一字闸事故追记）

`ztpool_history.json` 及所有 2026-10-10 之前落盘的历史档，`fbt`（首次封板时间）是
**东财原始数字形态**——一字板的 09:25:00 落成 `92500`，前导零丢失。直接
`String(fbt)` 得 `"92500"`，与判据 `'092500'` 做比较**恒不成立**，一字判定静默失效
（10-09 三只一字板全部漏闸的根因）。

**任何消费历史档 fbt 的代码，比较前必须规范化**：

```js
const fbt = ztd?.fbt != null ? String(ztd.fbt).padStart(6, '0') : null;
```

源头已修（`sources.js` 落盘即规范化，2026-10-10 起新档为字符串 HHMMSS 形态），
但**历史档不回改**——消费端防线永不可省。已落地的三处消费端：
`src/ai_report.js`（连板池装配）、`src/pool_verify.js`（推送前校验）、
`test/` 两个数字形态回归测试。别处再消费 fbt 时照此办理，防止同坑二踩。

## 后续决策点

- 若周一验收中发现梯队口径差一天造成实际误判（如连板池候选误入/误剔），
  再评估是否做 10-09 最小重建（backfill 模式）——当前明确不做。
  （注：此处 backfill 指 archive/pain/board_rank **数据**回补；10-09 **盘中报告**
  的 v4 拼盘回放已于 10-10 完成并推送/归档，见时间线，两者不是一回事。）
- 阈值修复后 `archive.json` 已回 6.57MB（< 7MB 门限），后续需持续盯档案
  增速，防止再次涨破拦死提交。

---

## 数据层迁移第一阶段（2026-10-10 凌晨追加）

旧接口直连全部退役（eastmoney-probe / push2his / 同花顺 getharen / 腾讯 qt.gtimg），
盘中六源改走 Python 数据层，`scripts/snapshot_intraday.mjs` 经 `src/sources_qd.mjs` 桥接
`python market_data.py intraday-raw`（契约与旧六 fetch 逐字段一致，组装/三态校验/落盘逻辑零改动）。

**降级链与实测（本机墙内网络）**：

| 环节 | 主路 | 兜底一 | 兜底二 | 本机实测 |
|---|---|---|---|---|
| 全市场快照 | QuantDash CN_Stock（**付费**，免费 403） | AkShare spot_em（push2 族，墙内不可达） | QuantDash symbols 500/批×8（免费可用） | ✅ 3309 行/13.9s |
| 候选二次校验 | QuantDash symbols POST | 快照切片 | — | ✅ 5/5 |
| 涨停/炸板/跌停池 | AkShare zt_pool 族（push2ex 可达） | — | — | ✅ 69/14/8 与 10-09 收盘档吻合 |
| 主力净流入 | AkShare fund_flow_rank（push2 族） | — | — | ⛔ 本机不可达 → null（CI 可达） |
| 历史日线 | BaoStock（收盘口径权威） | — | — | ✅ |

**关键事实（与外部口径的出入，均已按 API 自报为准）**：
- QuantDash 免费版配额实为 **10 次/分钟**（非 120）；universe 模式为付费功能。
  限速器按 10/min 阻塞式节流；universe 403 进程级短路省配额。
- 全市场 symbols 兜底 = 8 请求/轮，配额内刚好一轮；CI 上 AkShare 主路 1 请求搞定。
- `fbt` 从 AkShare 出来已是六位数字串（'092500'），与一字判据直接兼容；历史数字档防线不变。

**周一 9:35 验收新增核验点**：
1. CI intraday job 首跑新数据层：日志应见 `pip install -r requirements-data.txt` +
   降级链输出（CI 上预期 akshare 主路直通、无降级）；
2. 快照 `hot.rows` 带 `liangbi/pe_ttm/pb/main_net` 真值（CI 全源）——本地 dry 为 null
   属预期（宁缺毋假），**不要拿本地 dry 结果当验收失败**；
3. `QUANTDASH_API_KEY` 已入 GitHub secrets（免费 key 仅 symbols 模式可用，CI 量比/主力
   净流入实际由 AkShare 承担）；
4. 冒烟四项随时可跑：`python candidate_pool.py smoke`（快照/候选池/历史日线/降级日志）。

**顺带修复（迁移过程中暴露的预存缺陷）**：`buildIntradayPool` 宇宙为空早退分支缺
`streak_pool/streak_basis` 字段——旧架构下 hot+screener 双失败同样崩（正是「空数据导致
崩溃」同类），已补齐（`src/ai_report.js`），48/48 单测通过。

**未迁移边界（后续批次）**：盘后 EOD 管道（LHB/席位/行业/指数/量能——`src/sources.js`
其余函数）仍走原源直连；`datacenter`/`d.10jqka`/`qt.gtimg`（指数）不在本批禁用清单内的
调用暂保留，动它们会牵连 18:30/21:00 完整管道与题材 lineage，须单独立项。

---

*归档：2026-10-10（P1 数据源断供事件闭环）*
