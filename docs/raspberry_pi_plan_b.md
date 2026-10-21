# 树莓派方案 B（v4 · 2026-10-22 架构定稿）

> **架构定位（用户拍板）**：GitHub = 仓库 + Pages 网站展示；**树莓派 7×24 = 全部数据生产 + 推送 + 隧道服务**。
> 与旧 v3 的「Pi 只读镜像 + 只推报告」相反——本版 Pi 是**唯一的数据生产者**，会 `commit/push data/` 到 main。
> 因此安全闸从「不给 Pi 写权限」翻转为「**给写权限但用白名单+禁止文件中止死死锁住推送范围**」。

---

## 1. 为什么这样更稳
- CI 之前频繁被平台源取消（10-12/10-13 的停更事故根因），Pi 7×24 本地跑无此问题。
- `deploy-pages.yml` 已配置 `on: push` 命中 `data/**` 即部署 → **Pi 把 data/ 推到 main，Pages 自动刷新**，GitHub 纯展示。
- 本地隧道（cloudflared）服务 `dist/`（由 `build_ui.mjs` 渲染），与 Pages 双通道展示，任一路挂了还有另一路。

## 2. 组件清单（本版）
| 文件 | 作用 |
|---|---|
| `pi_run.sh` | 总调度：校时 → fetch+reset → 按 mode 跑任务 → 渲染 → 安全推送 → 企微报告 → 心跳 |
| `scripts/pi_build.sh` | 盘后完整管道（镜像 daily.yml build job 的 23 步；口径/契约守卫失败即中止） |
| `scripts/pi_push.sh` | **安全推送守卫**：只 `git add data/`，混入 `.github/.env/shell_hunter/*.bak/~` 立即中止回滚 |
| `ensure_time.sh` / `smoke_test.sh` | 校时闸 / 心跳自检（沿用） |
| `.env`（**gitignored**） | 仅放 `OPS_WEBHOOK`（企微 key，非 repo 凭据） |

## 3. 安全闸（防 2026-10-22 事故复发，最关键）
1. **`.env` 必须 gitignore**（已加：`.env` / `.env.*` / `!`.env.example` 保留模板）。Pi 的 repo 凭据**绝不**放进 `.env`。
2. **推送白名单**：`pi_push.sh` 只 `git add data/`，显式不碰其他。`.github/`/代码/密钥天然不会被加入。
3. **禁止文件中止**：即便 `.gitignore` 失效，`pi_push.sh` 在 commit 前扫描暂存区，命中 `.github/`/`.env`/`shell_hunter`/`*.bak`/`~`/`.secret`/`node_modules/` 立即 `git reset` 回滚并退出，绝不推送。
4. **凭据隔离**：Pi 用 **fine-grained PAT**（仅本仓库 `Contents: Read and write`）经 git credential helper 存储；`.env` 只装企微 webhook key。
5. **干净起点**：每轮 `git reset --hard origin/main` 再从零生产 —— 任何本地杂改/上次的垃圾都被丢弃（`.env`/`dist`/`node_modules` 因 gitignore 保留）。
6. **口径/契约守卫**：`audit_lhb_caliber` 与 `check_contract` 失败 → `pi_build` 退出非 0 → 调用方**不推送**，坏数据绝不上线。

## 4. 推荐 crontab（北京时间；Pi 系统请 `sudo timedatectl set-timezone Asia/Shanghai`，否则用下方 UTC 版）
```
PATH=/usr/local/bin:/usr/bin:/bin
30  0  * * 1-5  /opt/a-sentiment-pro/pi_run.sh smoke        >>/var/log/aquant/run.log 2>&1
0,30 1-7 * * 1-5  /opt/a-sentiment-pro/pi_run.sh intraday   >>/var/log/aquant/run.log 2>&1
30 10 * * *      /opt/a-sentiment-pro/pi_run.sh eod         >>/var/log/aquant/run.log 2>&1
0  13 * * 1-5  /opt/a-sentiment-pro/pi_run.sh supplement   >>/var/log/aquant/run.log 2>&1
30 20 * * 1-5  /opt/a-sentiment-pro/pi_run.sh us_close     >>/var/log/aquant/run.log 2>&1
20 21 * * 1-5  /opt/a-sentiment-pro/pi_run.sh a50          >>/var/log/aquant/run.log 2>&1
0   1 * * 1-5  /opt/a-sentiment-pro/pi_run.sh pre_open     >>/var/log/aquant/run.log 2>&1
35  1 * * 1-5  /opt/a-sentiment-pro/pi_run.sh candidates   >>/var/log/aquant/run.log 2>&1
30  2 * * 1-5  /opt/a-sentiment-pro/pi_run.sh candidates   >>/var/log/aquant/run.log 2>&1
0   6 * * 1-5  /opt/a-sentiment-pro/pi_run.sh candidates   >>/var/log/aquant/run.log 2>&1
```
> UTC 版（Pi 保持 UTC 时）：把上方「时:分」按 北京−8h 换算（22:30→14:30 / 08:30→00:30 / 09:00→01:00 / 09:35→01:35 / 10:30→02:30 / 14:00→06:00 / 18:30→10:30 / 21:00→13:00 / 04:30→20:30 / 05:20→21:20 / 盘中 01:00~07:30→同值）。

## 5. host 安装步骤（树莓派执行一次）
```bash
# 1) Node 22（CI 同版本，避免语法/行为漂移）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
# 2) 克隆（depth=1 即可，Pi 不保留长历史）
sudo mkdir -p /opt/a-sentiment-pro && sudo chown $USER /opt/a-sentiment-pro
git clone --depth 1 https://github.com/sjc19950404/a-sentiment-pro.git /opt/a-sentiment-pro
cd /opt/a-sentiment-pro
# 3) repo 写凭据（fine-grained PAT：本仓库 Contents:RW，不含任何其他权限）
git config --global credential.helper store
git config --global user.name "a-sentiment-pi"
git config --global user.email "pi@local"
git remote set-url origin https://<PAT>@github.com/sjc19950404/a-sentiment-pro.git
git push origin main   # 首次输入即被 store 记住；之后无需再输
# 4) host 脚本
sudo cp ensure_time.sh /usr/local/bin/ensure_time.sh && sudo chmod +x /usr/local/bin/ensure_time.sh
# 5) .env（仅 OPS_WEBHOOK，gitignored）
cp .env.example .env && vi .env
# 6) 日志/状态目录
sudo mkdir -p /var/log/aquant /var/lib/aquant
# 7) 脚本可执行
chmod +x pi_run.sh scripts/pi_build.sh scripts/pi_push.sh
# 8) 隧道服务（已有则跳过）：cloudflared tunnel 指向本地静态服务（serve dist/）
# 9) crontab（见 §4）
crontab -e
```

## 6. 切到 Pi 前必须做的（避免双写冲突）
- **关掉 CI 自动调度**：把 `daily.yml` 的 `on.schedule` 整段删除、保留 `workflow_dispatch`（手动兜底）。`battle-orders-*` 三个 workflow 的 schedule 同样处理（或暂留 CI 跑、但会与 Pi 抢推 main —— 推荐一并关）。
- **关掉 Windows 定时任务**：`\ASentiment-dailyfetch-1600`（推 staging）、`\ASentiment-pipeline-1530`（本地管道）会和新 Pi 抢写 main，必须停用；`\ASentiment-opslog-2000` 哨兵迁到 Pi（用 `pi_run` 心跳 + `smoke_test.sh` 替代）。
- **软切换**：先让 Pi 跑几天确认稳定推送，再关 CI/Windows 调度；过程中两者并存会有偶发 push 冲突，但 `pi_push.sh` 的 rebase+重试可自愈。

## 7. 验证
- `bash ensure_time.sh && echo OK`：校时通过。
- 手动 `bash pi_run.sh eod`，查 `/var/log/aquant/run.log` 与 `/var/log/aquant/push.log`：管道跑完 → 推送成功 → 企微收到报告。
- GitHub 上 `data/signals-latest.json` 的 `latest.trade_date` 随 Pi 推进；Pages 站点自动刷新。
- 故意在仓库根放一个 `.env` 再 `bash scripts/pi_push.sh`：应见「⛔ 禁止文件」中止，绝不推送。
- 连续两次 `eod`：第二次 `data/` 无变化应「无需推送」。
