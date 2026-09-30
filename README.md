# A股情绪系统 · PRO（云端版）

一个比参考系统更稳的 A 股市场情绪看板：**多源数据 → 七因子情绪 → 题材去噪 → 缺失代理 → 多源容灾**，跑在 GitHub Pages + Actions（零服务器、零费用、自动每日更新）。

## 它比参考系统好在哪（四个已知坑全修）

| 问题 | 参考系统 | 本系统 |
|---|---|---|
| 题材噪声 | 单只票专属诱因被当热门题材，新晋106/退潮155 | 标准词典归一 + 个股去重 + 全局孤点剔除 → 新晋24 / 退潮18 |
| 缺失数据 | 静默填 50，不告诉你 | 用代理指标推算；推不出则中性50并**显式标记** `imputedRatio` + 页面告警 |
| 单点故障 | 数据源挂就断更 | 多源容灾：主源失败自动回退已存档数据并记录原因；新鲜度按交易日历判定（不再粘滞误报）；非交易日自动跳过 |
| 可维护性 | 公式/权重藏在页面里 | 权重/阈值集中在 `src/config.js`，七因子模型透明可审计，带单元测试 |

## 部署（3 步）

1. 把本仓库推到你 GitHub（或 fork 后改名 `a-sentiment-pro`）。
2. 仓库 **Settings → Pages → Source: Deploy from a branch → `main` / root**。
3. **Actions** 默认开启，每日北京 18:40 自动跑管道并更新 `data/archive.json`，Pages 自动刷新。
   - 首次会看到 `data/archive.json`（已随仓库附带演示种子数据），之后由 live 模式覆盖为真实数据。
   - 想立刻看到效果：Actions 页点 `Run workflow` 手动触发一次。

## 本地开发

```bash
node --test            # 跑单元测试（情绪/校验/题材去噪 + V5.2 回测引擎 + 新鲜度三态，含 Python↔JS 一致性夹具）
node scripts/replay.mjs # 用 snapshot.html 离线重建 archive.json 并打印噪声对比
node scripts/backtest.mjs   # 生成 data/backtest.json（回测/网格帕累托/滚动/主线选股）
node scripts/freshness.mjs  # 数据新鲜度自查（--write 落盘刷新判定 / --require-fresh 滞后即退出码 1）
NODE_PATH=<任意含 jsdom 的 node_modules> node scripts/check_frontend.mjs  # 前端渲染校验（可选）
MODE=live node src/pipeline.js  # 线上模式（需外网）
```

## 结构

```
src/config.js     权重/阈值/数据源/节假日 + 回测默认参数（阈值/成本/风控/网格步长）
src/util.js       fetch 重试、时间、数学
src/sources.js    多源抓取（东财/腾讯/同花顺），单源失败不影响整体
src/sentiment.js  七因子情绪模型 v5（缺失走代理，记录 imputedRatio）
src/themes.js     题材去噪 + 动量
src/validate.js   archive.json 结构/范围校验
src/backtest.js   V5.2 回测引擎（仓位/成本/绩效/网格帕累托/滚动/主线选股，纯函数）
src/freshness.js  数据新鲜度三态判定（fresh/pending/behind，按交易日历，纯函数）
src/pipeline.js   编排：抓取→去噪→情绪→校验→写出
scripts/backtest.mjs  读 archive.json → 预计算 data/backtest.json
scripts/freshness.mjs 新鲜度自查/落盘刷新/CI 门禁（--write / --require-fresh）
index.html/app.js/style.css  前端看板（纯静态，零构建）
data/archive.json 生成数据（Actions 每日更新）
data/backtest.json 回测档（Actions 每日更新）
test/fixtures/parity_v52.json  Python↔JS 一致性夹具（由 tools/backtest/make_parity_fixture.py 生成）
```

## 策略回测（V5.2）

页面新增四块：**策略回测 / 网格寻优·帕累托 / 滚动样本外 / 主线自动选股**，数据由 `node scripts/backtest.mjs`
在服务端预计算进 `data/backtest.json`，前端只渲染、零构建。

- **信号**：七因子加权情绪分（权重取 `src/config.js`，与页面 `emotion.value` 同口径）；阈值沿用页面五档分界
  80/65/44/24，收盘打分、**T+1 生效**，过热区只减仓不新建
- **标的**：三大指数（上证/深证/创业板）各自独立按同规则回测 → 日收益等权合成组合（多标的轮动）
- **V5.2 增强口径**：交易成本（佣金万3双边/印花税万5卖出/滑点万2，按仓位变动幅度计提）、
  单日仓位变动上限（平滑，止损不受其约束）、单笔止损、回撤动态降仓、最大仓位约束
- **网格寻优**：七因子权重以基准为锚做倍数扰动后归一化（默认 5 档 → 78,125 组），
  双目标帕累托（夏普↑ × 最大回撤↓）；不同权重常落在同一阈值档位平台、目标值重复，故结果表按目标去重并标 `非支配`
- **滚动样本外**：固定权重切段评估 vs 逐窗重寻优（walk-forward，每段用训练窗重选权重再评测试窗）
- **主线自动选股**：按当日题材榜涨停家数取主线题材 → 热点榜中诱因含该题材的强势股为标的清单，
  强度分 = 主线涨停家数 × 题材密集度（与离线 Python 版 `find_main_line` 同形，数据源不同故量级不可直接比较）

引擎语义与离线 Python 工具 `tools/backtest/sentiment_backtest.py` 严格对齐，并由 `test/backtest.test.mjs`
的跨语言一致性用例逐位比对（夹具 `test/fixtures/parity_v52.json` 由 Python 侧生成）；
改任一端语义后需重跑 `tools/backtest/make_parity_fixture.py` 并提交新夹具。

> 诚实说明：回测样本仅随存档累积（当前 32 个交易日），年化/夏普等指标的统计意义有限，
> 仅用于管线自检与参数对比，**不构成投资建议**。样本短时两目标可能同向、前沿退化为单点，页面会显式标注。

## 数据更新与故障排查

- **生成链路**：Actions 定时（北京 18:30 / 21:00，周一至五）跑 `MODE=live node src/pipeline.js` →
  抓多源数据 → 合并进历史 → 写出 `data/archive.json`。当日**重跑**（如 21:00 补抓）走 `pipeline.js`
  的 `mergeNewDays(history, newDays)`：同日替换、涨跌家数缺失时用旧档回填、席位明细取覆盖率更高的一份。
### 新鲜度口径（`meta.freshness`）——「滞后」不是一个粘滞的布尔标记

旧口径把 `meta.stale` 当作「上一次尝试是否失败」的标记：只在回退路径置 `true`，成功路径重建 meta 时才会清掉。
于是只要某次回退之后运行一直走「跳过」（龙虎榜未公布 → `main()` 直接 `return null`、不写存档），
`stale` 就会一直粘着，**页面长期误报「数据滞后」，而数据其实已是最新收盘会话**。

现在由 `src/freshness.js` 按交易日历算出三态（成功 / 回退 / 跳过三条路径统一口径）：

| 状态 | 含义 | 页面表现 |
|---|---|---|
| `fresh` | 存档交易日 ≥ 最近一个已收盘交易日 | 无告警 |
| `pending` | 落后 1 个交易日，但预期更新时刻（次交易日 19:30）未到 | 无告警（正常等待 18:30 首抓 / 21:00 补抓） |
| `behind` | 已过预期更新时刻仍然落后 | ⚠ 滞后告警，带落后交易日数与最近已收盘交易日 |

- 「抓取动作的结果」与「数据是否滞后」已解耦：失败/跳过记在 `meta.lastAttempt`（`outcome`/`reason`）。
  即使这次抓取失败，只要数据仍是最新收盘会话就**不会**误报滞后；反之判为 `behind` 一定是真滞后。
- `meta.stale` 保留为派生字段（`= state === 'behind'`）以兼容旧读法；`meta.staleReason` 是人读原因。
- 前端另做一次**纯时间比较**：`meta.freshness.publishDeadline` 是绝对时间戳（带 `+08:00` 偏移），
  客户端本地时钟一过该时刻就提示「尚未更新至最新交易日」。这样页面无需内置交易日历，也不受时区影响。
- 自查：`npm run freshness`（只读；`--write` 落盘刷新判定字段，`--require-fresh` 滞后则退出码 1）。

### 交易日历必须跟上交易所公告

`src/config.js` 的 `manualHolidays` 是手动休市日清单（周末由星期判断）。**漏登记会把休市日误判为交易日**
→ 抓不到数据 → 反复回退/误报滞后。已按沪深北交易所 2026-09-17 休市公告登记：
中秋 9-25~9-27、**国庆 10-1~10-7**（10-8 起开市）。**新公告发布后请同步更新，否则假期会重演误报。**

### 告警排查顺序

1. `npm run freshness` —— 先看**判定**，而不是只看 `meta.stale` 字段（该字段可能是旧口径写入的）
2. 读 `data/archive.json` 的 `meta`：`freshness.state` / `staleReason` / `lastAttempt` / `note` / `generatedAt` / `tradeDate`
3. 拉最近一次 Actions 日志看真实报错：`python scripts/fetch_run_log.py <run_id>`
   （run_id 从仓库 Actions 页面取；依赖 Windows 凭据管理器里的 GitHub token）
4. 怀疑某源不可达：`node scripts/probe_sources.mjs` —— 逐源打印 HTTP 状态与关键字段，
   并对照「强制 IPv4 优先」前后差异以排除本机路由问题

### 三条硬规矩（都是被真实故障教出来的）

- **降级 ≠ 成功**：`fallbackArchive` 是容错设计（不崩页、不误导），本身不会让 job 失败。
  故 workflow 末尾加了**新鲜度门禁** `node scripts/freshness.mjs --require-fresh`：真滞后则本次运行标红
  （GitHub 会发失败通知）。`pending` 不误伤——18:30 因龙虎榜未公布而跳过不会判红，21:00 补抓仍不成才会红。
  另外「跳过」路径现在也会打 `::warning::` 注解，Actions 里不再静默。
- **push 必须比对 SHA**：`git rev-parse HEAD` 与 `git ls-remote origin main` 必须一致，曾经出现「以为推上去了其实没有」。
- **本机直跑要防静默**：`if (import.meta.url === 'file://' + argv[1])` 在 Windows 上恒不成立（`argv[1]` 是 `C:\…`），
  会让 `node src/pipeline.js` 一行不输出地"成功退出"。已改用 `pathToFileURL(argv[1]).href` 比较。
- 教训（2026-09-29「数据滞后」告警）：第一层根因不是网络故障，而是 `pipeline.js` 里一个**未定义变量**
  （`old` 应为 `history[i]`）使 `runLive` 每次重跑当日数据都抛 `ReferenceError` → 整体回退 → `stale` 恒为 `true`、
  数据永不更新，而 job 始终显示成功。第二层根因是 `stale` 本身是**粘滞标记**（见上），故在修 bug 之外重做了新鲜度口径。
  回归测试：`test/merge.test.mjs`（合并语义）、`test/freshness.test.mjs`（三态判定与节假日）。

## 已知限制 / 诚实说明

- **零 bug 不存在**：凡拉第三方行情（东财/同花顺/腾讯）的系统，源方限流、改格式、封 IP 都无法在代码层根除。本系统的优势是**失败可降级**（不崩页、不误导）。
- **live 抓取需云端验证一次**：`src/sources.js` 在本地沙箱禁网，逻辑靠 unit test + 离线回放保证；真实字段解析要在 Actions 跑通一次（日志可见）。解析失败时 pipeline 走回退档、本次抓取记入 `meta.lastAttempt`（不展示错误数据）；**只有因此落后于最近已收盘交易日且已过预期更新时刻**才显示滞后告警，并由 workflow 末尾的新鲜度门禁让该次运行标红（详见「数据更新与故障排查」）。
- 历史分位基于存档长度（默认窗口），样本越长越准；建议长期运行积累。
- 数据仅供参考，**非投资建议**。
