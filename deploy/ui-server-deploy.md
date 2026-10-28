# ui_server 常驻 + 云端穿透部署指南

让老板随时随地用手机/公司网络打开 github.io 网页，直接拉滑块、跑沙盒推演——永不手动敲 `node scripts/ui_server.mjs`，也固定用 8791。

## 1. 开机自启（systemd，树莓派）

把单元文件装到系统并启用：

```bash
sudo cp deploy/a-sentiment-ui.service /etc/systemd/system/
# 若 node 不在 /usr/bin/node 或仓库不在 /opt/a-sentiment-pro，先改单元里的路径：
#   which node          # 记下来，替换 ExecStart 里的 /usr/bin/node
#   pwd                 # 确认是仓库根，替换 /opt/a-sentiment-pro
sudo systemctl daemon-reload
sudo systemctl enable a-sentiment-ui          # 开机自启
sudo systemctl start  a-sentiment-ui          # 立即启动
sudo systemctl status a-sentiment-ui          # 看是否在跑
journalctl -u a-sentiment-ui -f               # 看日志（Ctrl-C 退出）
```

- 启动后固定监听 `0.0.0.0:8791`（本机/LAN/隧道都能访问）。
- 改代码/配置后重载：`sudo systemctl restart a-sentiment-ui`。
- 看进程：`systemctl status a-sentiment-ui` 或 `ss -ltnp | grep 8791`。

## 2. 端口防冲突（干掉旧的 _serve.cjs）

`_serve.cjs` 是旧静态服务（仅静态、无 API），已被 `ui_server.mjs` 取代，**已删除**。若树莓派上还残留它占用 8791：

```bash
# 找出占用 8791 的进程并杀掉（替换 <PID>）
sudo ss -ltnp | grep 8791          # 找到监听 8791 的 PID
sudo kill <PID>                    # 温和终止；顽固则 sudo kill -9 <PID>
# 确认空了
ss -ltnp | grep 8791 || echo "8791 已空闲"
```

之后只由 `a-sentiment-ui` 服务占用 8791，固定端口，不再需要 `--port 8792` 这类反人类操作。

## 3. 云端通道（Cloudflare Tunnel 挂接）

目标：github.io 网页的 `/api/*` 请求，自动改道到你家 `ui_server`（隧道），从而实现「云端也能拉滑块、跑沙盒」。

### 3.1 后端挂进隧道

家里 `ui_server` 已在 `localhost:8791`。把隧道 ingress 指向它即可（取代原来指向旧静态服务的配置）。

**方式 A — 命名隧道（推荐，域名稳定）** 编辑 `~/.cloudflared/config.yml`（或 `/etc/cloudflared/config.yml`）：

```yaml
tunnel: <你的隧道ID>
credentials-file: /root/.cloudflared/<你的隧道ID>.json
ingress:
  - hostname: a-sentiment-ui.<你的隧道域名>
    service: http://localhost:8791
  - service: http_status:404
```

```bash
sudo cloudflared service install            # 首次：把 cloudflared 也做成服务
sudo systemctl restart cloudflared
```

**方式 B — 临时快速隧道（测试用，重启即变地址）**：

```bash
cloudflared tunnel --url http://localhost:8791
# 终端会打印 https://xxxx.trycloudflare.com —— 这就是你的隧道地址
```

### 3.2 把隧道地址填进 config.json

把 3.1 拿到的隧道地址（如 `https://a-sentiment-ui.<域名>` 或 `https://xxxx.trycloudflared.com`）填到 `config.json` 顶层 `apiOrigin`：

```json
"apiOrigin": "https://a-sentiment-ui.<你的隧道域名>"
```

提交并推到 main，等 Pages 重新构建（约 1 分钟）。前端只在 `github.io` 域名 + `apiOrigin` 非空时才会把 `/api/*` 改道隧道（复用 `durl()` 同款门控）；Pi 本地/隧道直连仍走相对路径，**零改动、向后兼容**。

> ⚠ 临时快速隧道每次重启地址会变，需同步改 `apiOrigin` 再推 Pages。长期用请上**命名隧道（方式 A）**。

### 3.3 验证云端可用

1. 手机/公司网络打开 `https://sjc19950404.github.io/a-sentiment-pro/`（或你的 Pages 地址）。
2. 进 ⚙ 系统设置：顶部提示应为「参数来自 config.json（控制台实时生效）」（说明已连上隧道后端）；若显示「未连上本地服务端」且为只读，说明 `apiOrigin` 没填对或隧道没挂好。
3. 改一个参数点「保存」→ 应返回「已保存并备份 config.json.bak」；点「沙盒推演」→ 应返回新旧情绪分/选股差异。

## 4. 安全红线（务必读）

隧道会把 `/api/update-config` 写接口暴露到公网——任何拿到隧道地址的人都能改你家的交易参数（止损、仓位等）。**强烈建议**：

- 在 Cloudflare 给该隧道加 **Access（零信任）**：设置邮箱/PIN/设备登录，没登录进不来（Dashboard → Zero Trust → Access → Applications，匹配你的隧道主机名）。
- 或至少把 `ui_server` 的 CORS 收窄到 Pages 源：`Environment=UI_CORS_ORIGIN=https://sjc19950404.github.io`（单元文件里已留注释），但这只挡跨站脚本，挡不住直接拿地址 curl，故 Access 才是真防线。
- 绝不把 `.env`（含 OPS_WEBHOOK 等密钥）放进 `config.json` 或提交；`config.json` 只放公开配置。`ui_server` 代码零引用 `.env`，符合全局红线。
