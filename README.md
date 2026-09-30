# A股情绪系统 · PRO（云端版）

一个比参考系统更稳的 A 股市场情绪看板：**多源数据 → 七因子情绪 → 题材去噪 → 缺失代理 → 多源容灾**，跑在 GitHub Pages + Actions（零服务器、零费用、自动每日更新）。

## 它比参考系统好在哪（四个已知坑全修）

| 问题 | 参考系统 | 本系统 |
|---|---|---|
| 题材噪声 | 单只票专属诱因被当热门题材，新晋106/退潮155 | 标准词典归一 + 个股去重 + 全局孤点剔除 → 新晋24 / 退潮18 |
| 缺失数据 | 静默填 50，不告诉你 | 用代理指标推算；推不出则中性50并**显式标记** `imputedRatio` + 页面告警 |
| 单点故障 | 数据源挂就断更 | 多源容灾：主源失败自动回退已存档数据并标 `stale`；非交易日自动跳过 |
| 可维护性 | 公式/权重藏在页面里 | 权重/阈值集中在 `src/config.js`，七因子模型透明可审计，带单元测试 |

## 部署（3 步）

1. 把本仓库推到你 GitHub（或 fork 后改名 `a-sentiment-pro`）。
2. 仓库 **Settings → Pages → Source: Deploy from a branch → `main` / root**。
3. **Actions** 默认开启，每日北京 18:40 自动跑管道并更新 `data/archive.json`，Pages 自动刷新。
   - 首次会看到 `data/archive.json`（已随仓库附带演示种子数据），之后由 live 模式覆盖为真实数据。
   - 想立刻看到效果：Actions 页点 `Run workflow` 手动触发一次。

## 本地开发

```bash
node --test            # 跑单元测试（情绪/校验/题材去噪 + V5.2 回测引擎，含 Python↔JS 一致性夹具）
node scripts/replay.mjs # 用 snapshot.html 离线重建 archive.json 并打印噪声对比
node scripts/backtest.mjs   # 生成 data/backtest.json（回测/网格帕累托/滚动/主线选股）
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
src/pipeline.js   编排：抓取→去噪→情绪→校验→写出
scripts/backtest.mjs  读 archive.json → 预计算 data/backtest.json
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

## 已知限制 / 诚实说明

- **零 bug 不存在**：凡拉第三方行情（东财/同花顺/腾讯）的系统，源方限流、改格式、封 IP 都无法在代码层根除。本系统的优势是**失败可降级**（不崩页、不误导）。
- **live 抓取需云端验证一次**：`src/sources.js` 在本地沙箱禁网，逻辑靠 unit test + 离线回放保证；真实字段解析要在 Actions 跑通一次（日志可见）。若某源解析有偏差，页面会标 `stale` 而非显示错误数据。
- 历史分位基于存档长度（默认窗口），样本越长越准；建议长期运行积累。
- 数据仅供参考，**非投资建议**。
