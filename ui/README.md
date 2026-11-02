# ui/ — 合并版 UI 资产（原 a-sentiment 系统展示层）

本目录是 PRO 管线的**展示层**资产：`scripts/build_ui.mjs` 把它们与 `data/*.json`
合并构建成 `dist/index.html`（单文件成品，供本地隧道/Pages 伺服）。

## 目录内容

| 路径 | 性质 | 说明 |
|---|---|---|
| `src/lab-*.js` | **入库** | 实验室 15 模块（K线/实时/选股等） |
| `template.html` / `guide.html` | **入库** | 页面模板与指南 |
| `fetch_kline_all.mjs` | **入库** | 日K分片抓取脚本（见下） |
| `kline/` | **不入库**（gitignore，2026-10-24 起） | 全市场日K分片缓存，163MB/5554 片 |

## kline/ 为什么不入库（2026-10-24 决策）

1. **纯本地缓存，可完整重建**：分片内容 = 各股票日K，随时可从公开行情源重抓
   （`--init` 全量约 10 分钟；日常增量每个交易日追加一根 bar）；
2. **入库反而制造故障**：分片被跟踪时，`pi_run.sh` 每次 `git reset --hard origin/main`
   都会把未提交的增量**回滚**——实测分片因此停在 2026-10-20（Pi 迁移后增量全部丢失）；
3. **163MB 入库拖累所有人**：克隆/拉取/搬树莓派都要背着这 163MB，且每次改动
   都让历史体积继续膨胀。

## 分片生成方式

```bash
# 全量初始化（新机器/缓存丢失时；约 10 分钟，内置磁盘缓存断点续跑）
node ui/fetch_kline_all.mjs --init

# 日常增量（盘后跑一次，追加当日 bar；pi_build.sh 的 kline_all 步骤已在调）
node ui/fetch_kline_all.mjs
```

注意：抓取走腾讯行情，突发并发会触发限流（封 IP 60+ 分钟），脚本内置 3 次重试
与 700ms  pacing；万一被封，等冷却后重跑即可（断点续跑不重复劳动）。

## 消费者

- `scripts/build_ui.mjs`：把分片打进 `dist/`（合并版 UI 单文件）；
- `scripts/backtest_limit_up_streak.mjs`：连板概率回溯的本地磁盘缓存
  （分片缺失时自动重抓，只是慢）。

云端实际页面（仓库根 `index.html` + `app.js`）**不引用**本目录——它只消费
`data/*.json`。分片只服务于本地 dist 构建与回溯脚本。
