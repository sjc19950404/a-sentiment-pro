# 每日定时采集部署说明（crontab）

收盘后自动执行「涨停池入库 → 情绪历史计算 → 老龙头扫描」三步，入口脚本 `scripts/daily_fetch.mjs`。

## 1. 安装定时任务

```bash
crontab -e
```

把 `crontab.example` 中的行粘贴进去，**替换 `/你的项目路径` 为项目绝对路径**（例如 `/srv/a-sentiment-pro`）：

```
30 15 * * 1-5 cd /你的项目路径 && /usr/local/bin/node scripts/daily_fetch.mjs >> logs/daily_fetch.log 2>&1
```

- 15:30 执行（收盘后，东财涨停池已生成当日快照），周一至周五
- node 路径用 `which node` 确认；若非 `/usr/local/bin/node` 一并替换
- 保存退出即生效；`crontab -l` 可核对

## 2. 手动验证

在项目根目录执行（与定时任务同一命令）：

```bash
node scripts/daily_fetch.mjs
```

预期输出：两步各自摘要后，最后一行 `daily fetch done`。任一步失败会打印 `[daily_fetch] ✗ ...` 并以非零码退出（cron 环境可据此接告警）。

非交易日（周末/法定休市，按 `data/calendar.json` 交易日历判定）自动跳过：打印 `[skip] … 非交易日，跳过涨停池入库` 后直接退出，不调 API、不做任何 git 操作（2026-10-10 起）。注意：这也关闭了旧版「交易日班次失败、非交易日补跑仍能取到最近交易日的池」的兜底路径——交易日当天任务失败即永久缺该日（§4），失败告警（非零退出码）必须当日处理。

## 3. 日志位置

`logs/daily_fetch.log`（追加式，含两步全部输出）。

## 4. 数据积累说明

- `data/ztpool_history.json` 自 **2026-09-30** 起积累（东财 `getTopicZTPool` 只能取最近交易日，历史不可回补，2026-10-08 实测）
- 老龙头判定要求「距最后出现在涨停池 ≥ 10 个交易日」的冷却期，因此**首批候选最早出现在数据积累的第 11 个交易日**（约 2026-10 中下旬）；此前扫描结果恒为 0 属预期，不是故障
- 停更后再恢复：中间缺失的交易日无法补采，冷却天数按现有数据计算（缺采期间不出现在池中同样计入冷却，判定偏保守而非误报）

## 5. 产物

| 文件 | 内容 |
|---|---|
| `data/ztpool_history.json` | 每日涨停池原始快照（`{date, pool}` 数组，幂等追加） |
| `data/emotion_history.json` | 全部交易日情绪历史（精确/近似双轨，口径见文件 `meta`） |
| `data/old_dragon_history.json` | 逐日老龙头候选（五条件口径见文件 `meta`） |

## 6. 本地任务与 CI 的分工（免死金牌，2026-10-09）

> **`\ASentiment-dailyfetch-1600`（Windows 计划任务，每日 16:00）是与 GitHub Actions CI 并存的必要本地任务，不是冗余，不要禁用。**

- **CI 完全不覆盖本入口**：`.github/workflows/*` 中搜不到 `daily_fetch / emotion_history / scan_old_dragon / main_theme_history` 任何一个（2026-10-09 已逐一核实）。CI 只负责 archive/信号/报告链路（daily.yml 的 18:30 盘后首抓、21:00 补抓等）。
- **数据不可回补**：`ztpool_history.json` 依赖东财 `getTopicZTPool`，只返回最近交易日（见 §4）。本地任务停更一天 = 永久缺一天，老龙头判定所需的 ≥10 交易日冷却链直接断裂。
- **入库规则**：仅 `ztpool_history.json` 入库；`emotion_history / old_dragon_history / main_theme_history` 三档可由 ztpool + archive 完全重建，`.gitignore` 已规定不入库。当日采集需人工（或后续自动化）`git add data/ztpool_history.json` 提交。
- **入库前只读核验（2026-10-10 新增，先核后入库）**：任务跑完后、`git add` 之前，按以下判据核验变更范围，任一不满足则**停下排查、不提交**：
  1. **幂等追加**：`git diff` 仅末尾新增行——HEAD 中已有行（含既有交易日全部字段）逐行不变；出现历史行改写/删除/重排即为回补或污染，拒绝入库。
  2. **新增行日期**：恰为最近交易日且此前不存在（非交易日运行应无 diff，无 diff 则跳过提交，不造空 commit）。
  3. **结构不变**：顶层 keys、数组字段名与 HEAD 一致（防写入器升级引入结构漂移）。
  4. **范围隔离**：本任务不应产生 `ztpool_history.json` 以外的新脏文件（工作区既有的未提交改动与它无关，`git add` 仍只加本文件）。
- **当前部署**：本机 Windows 计划任务 `\ASentiment-dailyfetch-1600`（每日 16:00，SYSTEM 主体，XML 备份存仓外 brain 目录）。`crontab.example` 的 15:30 是 Linux 部署示例，语义等价。
- **姊妹任务 `\ASentiment-pipeline-1530`**（每日 15:30，`MODE=live` 写 archive.json）产物被 CI 完整覆盖（daily.yml:294 会提交），属真冗余，已于 2026-10-09 禁用——**它和本任务命运相反，勿混淆**。
- **历史教训（2026-10-09）**：本任务曾差点被误判为"CI 冗余"而禁用，且当日 `ztpool_history.json`（+1454 行）差点被 `git checkout --` 丢弃，拦截依据即以上各条。**清理工作区前先核对这份清单。**
- **长期方向**：把本入口迁进 CI（runner 跑 + 自动 commit）是终极解法，但需先验证 GitHub runner 对东财接口的连通性，验证通过前不动。
