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

---

## 9. 收尾记录（2026-10-12 · B+B2 全部完成）

方案 B 四步全部落地，本次会话完成第 1/2/4 步（第 3 步状态组件由并行批次先行完成）：

| 步骤 | commit | 内容 |
|---|---|---|
| 1. 语义 token | 86c11fd | 登记 7 个业务语义色：--hot/--alert/--ice/--info/--recover/--ebb/--northbound。⚠ 同色不同义拆名：#e8843c 按 .st-chip.hot→--hot、其余警示→--alert 分流；#6ea8d8 按 rg-/rp-→--ice、dv-→--info 分流 |
| 2. 硬编码色收敛 | 1d7083c + 53d4d65 | BODY 正文区 183 → **0**（总 191→58，余量为 token 定义区 37 + @media print 打印色板 21，均属"必须写死"）。另清 4 处无效 var() fallback |
| 3. 状态组件 | 6599377（先行批次） | .skeleton / .empty / :disabled 统一 |
| 4. 尺寸收敛 | 08641bc | 字号 19→8 档（剔全部半档；**保留 11px 数据密集基准**，proposal 原 6 档案会撑破表格，经确认改 8 档）；间距 20→6 档（4px 下限归并，56/60 布局级单列）；圆角 12→3 档 + 99px pill |

**验收结果**：
- [x] BODY 硬编码色 = 0（token 定义区与打印区按设计保留）
- [x] 字号零半档（10/11/12/13/14/16/20/26 + 52px 特例）
- [x] 间距落在 4/6/8/12/16/24（+56/60 结构值）
- [x] 圆角 4/8/12 + 99 pill
- [x] 云端 style.css / 本地 template.html / tokens.css 三处同源，一致性测试 3/3 绿
- [x] 键盘焦点环 :focus-visible 全局生效（0 处 outline:none）
- [x] 本地 8123 截图复核：概览/明细/回测/报告四区渲染正常，密集表格未被尺寸归并撑破

**验证留痕**：shots/ui-final/01-detail.png ~ 04-brief.png

**基线对照说明**：merge_ui.test.mjs 在本次改动前的备份点(864d31d)上同样失败
（spawnSync 返回 null，本机环境问题，与 UI 改动无关）；手动执行同命令 build_ui 正常
（exit=0，产物 27.7MB 完整）。CI 环境不受影响。

**改动边界**：仅 style.css / ui/tokens.css / ui/template.html 三个样式层文件 +
docs；行情/选股/情绪计算/caliber/复盘模块代码零触碰。

---

## 10. 私有化终端质感（2026-10-12 · feat/tech-visual）

B+B2 规范收敛完成后，用户反馈"没有那种科技感、缺黑客私有定制的味道"。
在**只改视觉层**的边界内追加装饰层，选定「克制的科技感 + 私有化专属质感」。

**提交序列**（已推送 origin/main）：

| commit | 内容 |
|---|---|
| 2bd9ed8 | v1 科技感装饰层（网格底纹 + 标题发光 + 角标）—— 因偏"通用产品味"被 v2 取代 |
| 74e49eb | v2 私有化终端质感（选型微调落地，零新增 DOM） |
| 413c444 | 清理 v1 遗留 token + 补正被引用的高光 token（三处 :root 重新对齐） |

**v2 设计要点**（全部纯 CSS，无图片、无新增 DOM，不碰 JS/分片/布局）：

1. **低饱和暗基底**：重定义别名 `--bg/--card/--card2/--line` 指向 `--*-p` 私有化色
   （`#0a0d12 / #12161d / #171c24 / #1d232c`），整体下压一档明度 + 降彩度，
   压掉"公开行情网页"的商业亮色味。别名写法便于单独回退整层。
2. **极淡专属暗纹**：`--hatch: rgba(255,255,255,.012)` 斜向 1px 细纹（`repeating-linear-gradient(-45deg)`），
   `background-attachment: fixed` 不随滚动。比通用方格更"内网自研系统"。
3. **情绪档位指示灯**：`regime-panel` 的 `.rg-fold::before` 左上角 6px 圆点，
   颜色随档位类切换（rg-cold→--ice / rg-warm→--recover / rg-hot→--up / rg-cool→--ebb /
   rg-flat→--lamp-off / rg-unknown→--warn）。把"今天这盘什么状态"凝成一颗角灯，
   是外面通用模板没有的专属标识。
4. **弱水印**：`body::after` 右上角双圈圆环，`opacity:.07`，纯 CSS 径向渐变绘制，看得见存在、看不见内容。
5. **内敛高光**：仅保留极轻的顶栏扫描线（`--scan-line`）、数字微光（`--num-glow`，仅数据列）、
   卡片悬停能量辉光（`--glow-acc`）；**标题发光已移除**（去通用产品味）。

**边界守则复核**：
- [x] 未升级到"视觉层 + 装饰件"方案（避免新增 DOM 影响 5554 分片加载性能与 CI 布局偏移）
- [x] 装饰层整体置于 `@media print` 块之前，打印时由白底 `!important` 接管，不污染打印稿
- [x] `prefers-reduced-motion: reduce` 下动画降级（卡片/指示灯 transition 关闭）
- [x] 零新增 DOM、零图片依赖、零 JS 改动
- [x] token 单一事实源三处同源，`ui_tokens_consistency` 3/3 绿

**修复要点（413c444）**：v2 删掉 v1 网格方案后，`--grid-line/--grid-size` 变成无人引用的死 token
（已删）；而仍在被装饰层引用的 `--glow-soft/--scan-line/--num-glow/--glow-acc` 此前只裸定义在
style.css / template.html 副本里、未登记进单一事实源，导致三处漂移。本次统一登记进 `ui/tokens.css`
并对齐三处 `:root`。

**验收**：远端 main = `413c444`，云端 `https://sjc19950404.github.io/a-sentiment-pro/` 部署验证通过。

### 10.1 事故与恢复（2026-10-12 · PR #21 误合并）

**事故**：并行会话从**陈旧分支尖 `fda727b`（v1 网格版）**发起 PR #21 合并进 main。
该 PR 的 style.css 以 v1 内容覆盖了已提交的 `74e49eb`(v2 私有化版)，导致：
- main 上 style.css 退回网格装饰（`--grid-line/--grid-size` 双层渐变方格 + 标题发光）
- 云端 Pages 部署后线上跑的是 v1，非用户要求的 v2 私有化终端质感

**恢复**（commit `fd5161e`）：
1. 三文件从 `74e49eb` 检回 v2 内容（斜向细纹 / `--bg-p` 私有化暗基底 /
   情绪档位指示灯 `.rg-fold::before` / 弱水印 `body::after`）
2. 重新应用 `413c444` 的 token 修复（删死 token、登记被引用的高光 token）
3. 三处 `:root` 对齐 → `ui_tokens_consistency` 3/3 绿 → 重建 dist → 推送

**验证**：远端 main = `fd5161e`，deploy-pages success，线上 style.css
与本地 1690 行逐行一致（仅 CRLF/LF 差异），v2 特征齐全、死 token 为零。

**教训**：多会话并行时，**开 PR 必须从最新 main 拉分支**。旧分支尖的 PR 会把
后续提交"合并回去"（git 视角是合法合并，但语义上是内容回退）。识别信号：
PR 的文件改动统计里出现"删除行数远大于新增"，且触及的正是后续 commit 改过的文件。

### 10.1 事故与恢复（2026-10-12 · PR #21 误合并）

**事故**：并行会话从**陈旧分支尖 `fda727b`（v1 网格版）**发起 PR #21 合并进 main。
该 PR 的 style.css 以 v1 内容覆盖了已提交的 `74e49eb`(v2 私有化版)，导致：
- main 上 style.css 退回网格装饰（`--grid-line/--grid-size` 双层渐变方格 + 标题发光）
- 云端 Pages 部署后线上跑的是 v1，非用户要求的 v2 私有化终端质感

**恢复**（commit `fd5161e`）：
1. 三文件从 `74e49eb` 检回 v2 内容（斜向细纹 / `--bg-p` 私有化暗基底 /
   情绪档位指示灯 `.rg-fold::before` / 弱水印 `body::after`）
2. 重新应用 `413c444` 的 token 修复（删死 token、登记被引用的高光 token）
3. 三处 `:root` 对齐 → `ui_tokens_consistency` 3/3 绿 → 重建 dist → 推送

**验证**：远端 main = `fd5161e`，deploy-pages success，线上 style.css
与本地 1690 行逐行一致（仅 CRLF/LF 差异），v2 特征齐全、死 token 为零。

**教训**：多会话并行时，**开 PR 必须从最新 main 拉分支**。旧分支尖的 PR 会把
后续提交"合并回去"（git 视角是合法合并，但语义上是内容回退）。识别信号：
PR 的文件改动统计里出现"删除行数远大于新增"，且触及的正是后续 commit 改过的文件。
