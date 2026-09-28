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
node --test            # 跑单元测试（情绪/校验/题材去噪）
node scripts/replay.mjs # 用 snapshot.html 离线重建 archive.json 并打印噪声对比
MODE=live node src/pipeline.js  # 线上模式（需外网）
```

## 结构

```
src/config.js     权重/阈值/数据源/节假日
src/util.js       fetch 重试、时间、数学
src/sources.js    多源抓取（东财/腾讯/同花顺），单源失败不影响整体
src/sentiment.js  七因子情绪模型 v5（缺失走代理，记录 imputedRatio）
src/themes.js     题材去噪 + 动量
src/validate.js   archive.json 结构/范围校验
src/pipeline.js   编排：抓取→去噪→情绪→校验→写出
index.html/app.js/style.css  前端看板（纯静态，零构建）
data/archive.json 生成数据（Actions 每日更新）
```

## 已知限制 / 诚实说明

- **零 bug 不存在**：凡拉第三方行情（东财/同花顺/腾讯）的系统，源方限流、改格式、封 IP 都无法在代码层根除。本系统的优势是**失败可降级**（不崩页、不误导）。
- **live 抓取需云端验证一次**：`src/sources.js` 在本地沙箱禁网，逻辑靠 unit test + 离线回放保证；真实字段解析要在 Actions 跑通一次（日志可见）。若某源解析有偏差，页面会标 `stale` 而非显示错误数据。
- 历史分位基于存档长度（默认窗口），样本越长越准；建议长期运行积累。
- 数据仅供参考，**非投资建议**。
