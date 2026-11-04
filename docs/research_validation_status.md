# 研究验证状态总览（Research Validation Status）

> **单一入口。** 系统启用至今的验证证据、结论边界、P0–P3 产物与再生方式，集中在此，避免散落在十几个 JSON、过时注释和聊天记录里。
> 本文件是索引 + 边界红线；逐项的详细数值见其指向的产物文件（随月度报告滚动更新）。
> 最近更新：2026-11-04。

---

## 0. 一句话结论（边界红线，先读）

- **工程验证扎实**：系统能稳定跑、持续记录、诚实否掉坏方案（契约 / 单测 / 跨语言夹具 / 参数冻结 / 数据新鲜度门禁都完整）。
- **策略有效性尚未被实盘证据证实**。可验证样本极小：
  - 系统启用后仅 **~19 个交易日**；模拟盘仅 **~8 个净值点、0 成交**；
  - 双轨 P2 晋升门槛（≥10 个**实盘** shift 生效日 + ≥30 笔平仓）**尚未开始积累**（P2 启动后实盘 shift = 0）。
- 在达到上述样本前，**不下"系统能稳定赚钱"的结论**。任何结论必须满足：多种子 × 分年 / regime × 扣费后仍稳定，且保留集绝不进 prompt / 记忆 / 搜索。

---

## 1. 三个时间口径（必须分开看）

| 口径 | 起点 | 至今 | 含义 |
|---|---|---|---|
| 仓库 / 系统启用 | **2026-09-28** | ~19 个交易日 | 首次提交、最早报告 9/30 |
| 主档数据 | **2025-10-09** | 257 个交易日（其中 223 天 ≈ 86.8% 为 K 线重建口径） | 回溯 / 重建数据，**不等于实盘观察** |
| 模拟盘账户 | **2026-10-23** | 8 个净值点 | 100 万本金，2 笔委托均 expired / rejected，`trades = 0` |

"过去那么久"主要是日历时间（约 5 周）；换算成交易样本其实很短。

---

## 2. P0–P3 路线图与产物

| 阶段 | 做什么 | 产物 / 命令 | 状态 |
|---|---|---|---|
| **P0** | 只读统一研究基线，聚散落证据 | `tools/research/baseline.mjs` → `data/research_baseline.json` + `tools/research/reports/research_baseline.md` | ✅ 已提交 |
| **P1** | 257 天无偏预测重校准（外部前复权 K 线，替代档案内查表的存活偏差） | 并入 `baseline.mjs`（读 `data/streak_backtest.json`） | ✅ 已提交 |
| **P2** | 正式启动双轨 P2：回填 `p2Start=2026-10-23` + P2 实盘计数 / 第二套累计 | `tools/backtest/paper_dual_track.mjs`（由 `pi_build` 调用） | ✅ 已提交并生效 |
| **P3** | 首份月度研究验证报告 + 周报 `win_rate` 绑定真实平仓胜率 + 月度 cron + 文档陈旧数字校正 | `tools/research/monthly_report.mjs`；`src/ai_report.js`；`pi_run.sh research_monthly` 模式 + 系统 cron | ✅ 已提交并经生产演练 |

---

## 3. 已核实的关键数值（截至 2026-11-04，快照）

> 滚动真值在月度报告 `tools/research/reports/research_monthly_YYYY-MM.md` 与 `research_baseline.md`；此处为当时快照，便于快速核对。

### 3.1 预测校准（257 天 · 外部前复权 K 线 · 无偏差）
来自 `data/streak_backtest.json`（脚本 `scripts/backtest_limit_up_streak.mjs`）：

| 分组 | n | T+1 中位 | 上涨% | 再涨停% |
|---|---|---|---|---|
| 全部涨停股 | 18044 | +1.2% | 57.5% | 17.6% |
| 首板 & 换手<10% | 2392 | **+0.89%** | **55.6%** | 16.5% |
| 3 连板 & 换手<10% | 107 | +9.95% | 69.2% | 50.5% |
| 换手 ≥25% 涨停 | 759 | **−0.04%** | 49.8% | 15.7% |

**结论**：方向成立、幅度温和——低换手首板次日约 56% 上涨、中位 +0.9%；原 `predict.js` 的"低换手首板最优、高换手最差"判断**正确**，但收益预期需下调。档案内次日查表（有存活偏差）曾高估至 90% 上涨，已降级为次要交叉校验。

### 3.2 指数回测 / 版本回归
- 主信号全样本 **V5.2 −5.94%**（年化 −5.83%、Sharpe −0.33、最大回撤 17.62%）；同期持有 −14.76% → **相对抗跌，非正收益策略**。
- 版本回归 `version-regression.json`：v4.5~v5.3 与次日收益 Pearson ≈ −0.0096~0.0118、方向准确率 47.7%~50.0% → 情绪分对次日指数方向**无统计显著预测证据**。

### 3.3 双轨 P2（实盘框架）
- `p2Start = 2026-10-23`（模拟盘启动日），门禁只认该日之后的影子生效日。
- **P2 实盘 shift 生效日 = 0**；历史全样本 18 个 shift 日（全部在系统启用前）**不计入 P2 门禁**。
- 晋升门槛（`docs/dual_track_framework.md`）：≥10 个 P2 影子生效日 + 三条影子线同号 + 生效日贡献 ≥50% + 残差纪律合格。

### 3.4 模拟盘账户（`data/paper/account.json`）
- 本金 100 万；净值 9 点、恒 1,000,000；持仓 0、委托 2（均 expired / rejected）、**成交 0**。
- 真实平仓胜率（周报 `win_rate` 新口径）= `null`（样本不足，0 笔平仓）。

### 3.5 周报健康度
- 4 份周报，状态全 `degraded`；高频缺失字段集中在结构性缺失项。
- `win_rate` 已由"剧本命中率（绑定缺席→恒 null）"改为**绑定模拟盘平仓胜率**（`reviewTrades`），0 笔时仍 null（原因诚实），成交后自动填充。

---

## 4. 已证伪 / 已验证（proven vs rejected）

**已证伪（不得回流）**：
- 动量加速 M8：仓位残差延迟爆炸，满仓崩盘日多扛 0.07 仓位。
- 0.7 分区帽：完整样本收益 −1.50% → −2.28%。
- 尾部介入 T2 / T3：保费 > 保额。
- V5.3 全量 regime 帽：回撤改善但收益 / 夏普代价过大，降级为参考轨。
- v5.3 分位归一：确消除 `s_net` 饱和，但**非预测力增强**。

**已验证（工程 / 相对）**：
- 主信号在下跌样本相对基准少跌约 8–9pp（相对抗跌，非正收益）。
- 预测分层方向正确（低换手首板最优、高换手最差），幅度温和。
- 契约、单测、跨语言一致性夹具、参数冻结、数据新鲜度门禁完整（工程可信度，非策略可信度）。

---

## 5. 剩余缺口与下一步

1. **P2 攒样本**：让模拟盘在实盘里自然积累成交与 shift 生效日；达到"≥30 笔平仓 + ≥10 个实盘 shift 日"前不下结论。
2. **不提前加新因子 / 新模型**：当前优先级低于补齐个股长期数据 + 严格样本外评估（含 purge / embargo、分年 / regime 稳定性、多重搜索惩罚）。
3. **保留集永不可进 prompt / 记忆 / 搜索**：重校准与任何未来因子搜索都要严格 embargo。
4. **月度报告已自动化**（见 §6），持续滚动即可，无需手动重算。

---

## 6. 产物与再生（别再散落）

| 产物 | 生成 / 命令 | 落盘 |
|---|---|---|
| 统一研究基线 | `node tools/research/baseline.mjs` | `data/research_baseline.json` + `tools/research/reports/research_baseline.md` |
| 月度研究验证报告 | `pi_run.sh research_monthly`（**系统 cron：每月 1 日 19:00**） | `data/research_monthly_YYYY-MM.json` + `tools/research/reports/research_monthly_YYYY-MM.md` |
| 双轨 P2 账本 | `pi_build` 内调用 `tools/backtest/paper_dual_track.mjs` | `data/paper/dual_track.json` + `data/paper/dual_track_latest.json` |
| 周报（含 `win_rate`） | `scripts/build_ai_report.mjs`（每日 / 周五周报） | `data/reports/weekly_*.json` |
| 参数治理日志 | 手动维护 | `data/params_changelog.json`（曾于 git reset 中丢失，已 recovered 重新入库） |

> 月度报告模式会先重算统一基线再生成月报，并把 `tools/` 下的报告 md 一并暂存交给 `pi_push`（因 `pi_push` 本身只提交 `data/`）。

---

## 7. 工程纪律（踩过的坑）

- **eod 管道 `git reset --hard origin/main` 会冲掉未提交改动** → 任何改动**改完立即提交并推送**，不要留本地。
- **参数治理日志必须入库**：`params_changelog.json` 曾因上述 reset 丢失，研究治理产物一律入库。
- **外部方案评估**：AlphaMemo（arXiv:2606.20625）经评估**决定不接入**——需离线复现 + 约十年数据 + 严格 OOS，与当前约一年小样本、短线规则系统不匹配；其"失败模式否决"的记忆机制值得未来离线借鉴，但非现在。

---

## 8. 相关文档

- 双轨框架与晋升门禁：`docs/dual_track_framework.md`
- P2 启动清单：`docs/p2_paper_trading_checklist.md`
- 滚动真值：月度报告 `tools/research/reports/research_monthly_YYYY-MM.md`、基线 `tools/research/reports/research_baseline.md`
