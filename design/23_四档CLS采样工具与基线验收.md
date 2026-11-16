# 23 · 门槛② 四档 CLS 采样工具与基线验收

> 验收对象：门槛②（阶段 5 五条硬门槛之一）——「四档 CLS 各 ≥3 次采样、中位数且最差值 ≤0.10」。
> 依据：05 册 L722 / 06 册 L186 / 07 册 §7.4 / 08 册 L238 / 03 册 2.1；工具 `verify_cls_four_tiers.cjs`（只读线上，唯一 profile）。
> 结论：**工具已符合契约并产出合格证据；首轮基线 `verdict=FAIL`（3/4 档不达标），FAIL 属裁定预期——位移源全为 legacy 零 `s-*` 面板，治理归阶段 5「研报降级」。新增发现：SM 档 `#preMainPanels` 在 800px 冷启动有大位移（单次 0.9528）。**

---

## 1. 缘起：22 册挂账项②的工具缺口

22 册 §4 把门槛②列为「WorkBuddy 侧产出采样脚本」的挂账项，并引用 median 0.1471 / worst 0.1905 作为当前值。复核发现该值来自 `probe_cls_sources.cjs`，而该脚本**不满足门槛②契约**：

| 维度 | 契约要求 | 旧脚本 probe_cls_sources.cjs |
|---|---|---|
| 视口 | 四档（XS/SM/MD/LG，03 册 2.1） | 单档 1440×900 |
| 采样次数 | 每档 ≥3 次 | 单档 5 次（次数够，档数不够） |
| 观测窗口 | 5000ms（buffered） | 1200ms |
| 达标判定 | 中位数 ≤0.10 且最差值 ≤0.10 | `≤0.174` 记 PASS、`median≤0.174` 记 VOLATILE |
| 取值口径 | 线上 `S.collectCls()` | 自写 observer |

结论：旧脚本是**诊断归因工具**，可用于位移来源定位，但不能作为门槛②的放行证据。

---

## 2. 新工具规格（verify_cls_four_tiers.cjs）

- **四档视口**：XS 390×844 / SM 800×900 / MD 1280×800 / LG 1440×900，对应 03 册 2.1 四个断点区间的基准值。
- **每档独立导航 3 次**（`--runs=N` 可调，下限 3），唯一 query + `Network.setCacheDisabled`，规避 SW 缓存假红。
- **观测**：调线上 `S.collectCls()`（5000ms、buffered、双档 target 0.10 / baseline 0.174），与 `s-selftest.js` 同实现，避免工具与自检口径分叉；并行挂独立 observer 采 `layout-shift` sources 归因，两者互不干扰。
- **判据**：每档 `measured≥3 且 median≤0.10 且 worst≤0.10` → 该档 PASS；四档全 PASS → verdict PASS；`layout-shift unsupported` 记 UNMEASURED，不作通过。
- **记录**：每档 3 次的 value/pass/degraded、中位数、最差值、最佳值、方差、归因 top5。

---

## 3. 首轮基线实测（2026-11-16）

`verdict = FAIL`。四档 × 3 次 = 12 个样本：

| 档 | 视口 | 中位数 | 最差 | 最佳 | 判定 |
|---|---|---|---|---|---|
| XS | 390×844 | 0.3183 | 0.3188 | 0.2205 | FAIL |
| SM | 800×900 | 0.2339 | **0.9528** | 0.1966 | FAIL |
| MD | 1280×800 | 0.0329 | 0.0329 | 0.0022 | **PASS** |
| LG | 1440×900 | 0.1609 | 0.1821 | 0.1244 | FAIL |

逐次明细见 `design/assets/四档CLS采样.json`。此前 22 册引用的 0.1471 / 0.1905 是单档 1200ms 诊断值；本轮四档 5000ms 契约采样后，XS/SM/LG 三档均明显超标。

---

## 4. 位移归因

| 档 | 主要来源（按贡献排序，多 source 累加近似值） |
|---|---|
| XS | `#btStrategyPanel.btstrat-panel` 0.6615；`#preMainPanels` / `main` / `#zoneNav` 0.4476；`#loadScope` 0.1958 |
| SM | `#preMainPanels` / `main` / `#zoneNav` / `div.meta` 各 2.2141；`#btStrategyPanel` 0.3932 |
| MD | `div.meta` 0.0724；`.mom-group` / `#emScore` / `.pct` 0.0658 |
| LG | `#btStrategyPanel` 0.3732；`.mom-group` 0.3004；`div.meta` 0.1517 |

全部为 legacy 零 `s-*` 面板，与 03 册 §4「残余 CLS 来源」及 22 册归档一致。

> 归因数值说明：一个 `layout-shift` entry 可含多个 source，脚本对各 source 累加完整 entry value，故上表为**相对占比的近似**，仅用于来源排序定位，不作绝对量使用；`value` 本身取自线上 `S.collectCls()`，准确。

---

## 5. 判定：FAIL 属裁定预期，非新回归

- 位移治理按 22 册裁定归阶段 5「研报降级」时做；当前默认视图仍是研报、legacy 面板在位，门槛②结构上过不了。这个 FAIL 不是本轮引入的退化，而是把挂账项的真实状态用合格工具测了出来。
- 工具已合格，阶段 5 本体翻默认路由后原样复跑即可判定，无需改工具。
- 全程只读线上，不翻默认路由、不动 `app.js` / 研报样式，守住硬边界。

---

## 6. 新发现（需纳入阶段 5 治理范围）

SM 档 run1 出现 `value=0.9528`（`#preMainPanels` 在 800px 冷启动的一次性大位移），run2/run3 回落到 0.1966 / 0.2339，属冷启动时序抖动但量级远超既有归档。说明阶段 5 研报降级的位移治理范围**不能只覆盖 `#btStrategyPanel` 与 `.mom-group`，还须包含 `#preMainPanels`（含 `main` / `#zoneNav` 联动）在 SM 断点下的冷启动跳变**。

---

## 7. 产物与状态

| 产物 | 路径 | 状态 |
|---|---|---|
| 采样工具 | `design/verify_cls_four_tiers.cjs` | 本轮产出，只读线上 |
| 首轮基线证据 | `design/assets/四档CLS采样.json` | 本轮产出 |
| 本册 | `design/23_四档CLS采样工具与基线验收.md` | 本册 |

门槛②**工具侧收口、数值侧挂账**（等阶段 5 研报降级后复跑）。剩余门槛③深链 7 天灰度 / ④ `fatalHolder` 7 天零触发 / ⑤ 人工 checklist 仍为非代码侧，阶段 5 本体维持不启动。

> 入库说明：本地工作区无 git 仓库，提交在 CodeBuddy 侧远端。三份产物已落盘本地 `design/`，由 CodeBuddy 侧用目录级 `git add design/` 一并入库，规避中文文件名编码问题。
