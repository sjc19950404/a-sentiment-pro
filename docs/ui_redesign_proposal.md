# UI 重设计提案与落地记录（B + B2）

> 状态：已落地（2026-10-12）。仅样式规范化，未动任何行情/选股/情绪业务代码。

## 1. 背景与根因

线上 Pages 部署用的是仓库根 `style.css`（云端版）；本地 / CI 合并版 UI 用的是
`ui/template.html` 内联样式（本地版）。**两套各自定义一套设计 token（命名 + 取值都不同）**，
这是"双端界面不一致"的根本原因——而非某个组件写错了。

典型漂移示例：

| 语义 | 云端 `style.css` | 本地 `template.html` |
|---|---|---|
| 涨红 | `#f0616d` | `#ff5a5a` |
| 跌绿 | `#3fb950` | `#2fbf8f` |
| 弱化文字 | `--muted` `#8b949e` | `--dim` `#8a94a6` |
| 警示金 | `--warn` `#d29922` | `--gold` `#e8b04b` |
| 强调蓝 | `--acc` `#58a6ff` | `--accent` `#5b8cff` |

每次新增组件、改颜色，两套各写各的，迟早再次漂移。

## 2. 方案选型（2026-10-12 拍板）

- **选 B（token 化 + 双端收口）+ 子方案 B2（构建时注入 token 到本地模板）**
- 放弃 A（临时堵漏，治标不治本）；放弃 C（完整重构，挤占核心业务迭代）
- **边界**：只统一基础设计 token（颜色 / 字号 / 间距）；页面布局、组件结构**完全不动**；
  不新增花哨美化；不改动任何业务代码。

### B2 落地机制

- `ui/tokens.css` = **单一事实源**：所有语义 token 的命名与取值只在此处维护。
- 云端 `style.css` 顶部**内联**该 token 副本（方案 Y，规避 `@import` 在 GitHub Pages
  路径伺服的不确定性，稳定性优先）。
- 本地 `ui/template.html` 的 `:root` 同步为统一 token；`scripts/build_ui.mjs` 在构建时
  把 `ui/tokens.css` 注入本地模板（保留 dist 单文件离线开箱即用的能力，幂等兜底）。
- `test/ui_tokens_consistency.test.mjs` 在 CI（`npm test`）守护：云端内联副本与单一源
  变量集合 / 取值必须一致，本地不得残留旧变量名。

## 3. 颜色基准决策

全部以**云端现有取值**为准（云端是正式线上形态，配色更成熟）：

| 语义 | 取值 |
|---|---|
| 涨红 | `#f0616d` |
| 跌绿 | `#3fb950` |
| 正文 | `#e6edf3` |
| 背景 | `#0d1117` |
| 强调蓝 | `#58a6ff` |
| 警示金 | `#d29922` |

## 4. 落地批次

### 第1批 P0（阻断 bug 修复）
- 补 `--panel` 定义（`.scope-note` 背景原引用未定义变量静默失效）
- 删除 6 处 `:focus` 的 `outline:none`，让全局 `:focus-visible` 环在键盘导航时生效
- 提升辅助文字对比度：`.rel-hint .7→.85`、`.pq-sub .72→.85`、`.pq-pct-unit .78→.9`
- 删除冗余 860px 断点，gutter 收紧 + topbar/meta 换行并入 820px 块
- 本地 `template.html` 补 `:focus-visible` 环 + 删 textarea `outline:none`
- commit `322fc7e`

### 第2批 B2 核心
- 新建 `ui/tokens.css` 单一事实源
- 云端 `style.css` 内联统一 token（方案 Y）
- 本地 `template.html` 同步 + 消费侧重命名
  `--dim/--accent/--gold/--panel2 → --muted/--acc/--warn/--card2`
- `build_ui.mjs` 注入 tokens（保留 dist 单文件能力）
- 新增 `test/ui_tokens_consistency.test.mjs` 守护
- commit（见 git log `feat(ui-b2)`）

### 第3批 组件态规范化
- 空态统一：基础 `.empty` 用 `--faint` 弱文字、居中、统一间距
- 禁用态统一：通用 `:disabled` 外观（opacity:.5 / cursor:not-allowed / color:--muted），
  消除 `.mini`/`.bt-modeseg`/`.rp-btn` 零散值漂移（.65/.45/.42/.6 → 收敛）
- 骨架加载态：新增 `@keyframes skel` + `.skeleton` 工具类（用统一 token），
  分层加载提示 `.lazy-note` 复用骨架动画作可视加载态
- 本地 `template.html` 同步 `.skeleton` 副本
- commit `6599377`

## 5. token 映射表（旧名 → 新名）

| 旧（本地） | 新（统一） | 取值 |
|---|---|---|
| `--dim` | `--muted` | `#8b949e` |
| `--accent` | `--acc` | `#58a6ff` |
| `--gold` | `--warn` | `#d29922` |
| `--panel2` | `--card2` | `#1b232c` |
| `--panel` | `--card`（别名保留 `var(--card2)`） | `#1b232c` |

## 6. 一致性守护

`test/ui_tokens_consistency.test.mjs`（CI `npm test` 覆盖，3 个用例）：

1. 云端 `style.css` 内联 `:root` 与 `ui/tokens.css` 的变量名集合 + 取值完全一致
2. 本地 `template.html` 消费侧不得残留旧变量名（`--dim/--accent/--gold/--panel2`）
3. `build_ui` 注入后 `dist/index.html` 的 `:root` 与单一源一致（双端同源）

改 token 只动 `ui/tokens.css` 一处，漏同步的副本会被 CI 抓住。

## 7. 验收

- 单测 **1593 / 0**、契约 **21 / 0**、`build_ui` 自测通过
- 仅样式规范化，未动任何行情 / 选股 / 情绪计算业务代码

## 8. 后续（已知留白，非本次范围）

- 组件专用硬编码色（`#121826` / `#0e1320` / `#1a2233` 等模态框 / 输入框底色）暂未 token 化：
  它们是本地独有、云端无对应项的"组件 surface 色"，不构成双端 token 漂移，留待后续按需收口。
- 骨架加载态已定义工具类，目前接入点为分层加载提示 `.lazy-note`；如需在图表 / 数据卡片
  首屏也用骨架占位，后续在对应容器加 `.skeleton` 类即可（纯展示，不破坏结构）。
