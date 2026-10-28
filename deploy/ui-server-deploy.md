# a-sentiment 部署与运维手册（ui_server 常驻 + 云端穿透）

目标：让老板随时随地用手机/公司网络打开 github.io 网页，直接拉滑块、跑沙盒推演——服务端开机自启、端口固定 8791、云端隧道连通、重启可一键恢复。

> 本手册为**本机实测**流程（仓库 `/home/sjc19950404/a-sentiment-pro`、node 走 nvm）。其他机器请按"环境事实"对应替换路径。

## 0. 环境事实（本机）
- 仓库根：`/home/sjc19950404/a-sentiment-pro`（不同机用 `find / -maxdepth 5 -type d -name a-sentiment-pro` 定位）
- node：`/home/sjc19950404/.nvm/versions/node/v22.23.3/bin/node`（**不要写 `/usr/bin/node`**，nvm 装的）
- 服务用户：`sjc19950404`
- 端口：**8791 固定**，仅 `a-sentiment-ui` 服务占用；旧 `scripts/_serve.cjs` 已退役删除
- 后端：`scripts/ui_server.mjs`（零依赖内置 http，静态托管 + `/api/config|/api/update-config|/api/dry-run`）
- 前端：github.io 的 ⚙ 系统设置页，经 `config.json` 的 `apiOrigin` 把 `/api/*` 改道隧道

## 1. 拉最新代码（含 ui_server / deploy / apiOrigin / 控制台）
```bash
REPO=$(dirname $(find /home/sjc19950404 /opt /srv /root -maxdepth 5 -type d -name "a-sentiment-pro" 2>/dev/null | head -1))
echo "仓库根 = $REPO"; cd "$REPO"
git pull                       # 若本地数据文件冲突：git stash && git pull && git stash pop
```

## 2. 释放 8791（干掉旧服务）
```bash
sudo ss -ltnp | grep 8791       # 找占用 PID（旧 _serve.cjs / 旧 ui_server 残留）
sudo kill <PID>                 # 顽固则 sudo kill -9 <PID>
ss -ltnp | grep 8791 || echo "✓ 8791 已空"
```

## 3. 开机自启（systemd：a-sentiment-ui）
直接用 heredoc 写单元，**路径按本机自动替换**（不要用仓库里 `deploy/a-sentiment-ui.service` 的 `/opt` 模板）：
```bash
REPO=$(你的仓库根); NODE=$(which node)
sudo tee /etc/systemd/system/a-sentiment-ui.service >/dev/null <<EOF
[Unit]
Description=a-sentiment 参数控制台 + 实时沙盒推演后端 (ui_server.mjs)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=sjc19950404
WorkingDirectory=$REPO
ExecStart=$NODE $REPO/scripts/ui_server.mjs --host 0.0.0.0 --port 8791
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable a-sentiment-ui     # 开机自启
sudo systemctl start  a-sentiment-ui     # 立即启动
systemctl status a-sentiment-ui --no-pager | head -12
ss -ltnp | grep 8791                     # 应 0.0.0.0:8791 被 node 占
journalctl -u a-sentiment-ui -n 15 --no-pager
```
- 重载代码后：`sudo systemctl restart a-sentiment-ui`
- 看日志：`journalctl -u a-sentiment-ui -f`

## 4. 验证后端
```bash
curl -s -o /dev/null -w "静态页 HTTP %{http_code}\n" http://127.0.0.1:8791/
curl -s http://127.0.0.1:8791/api/config | head -c 80 ; echo    # 应返回 config.json 内容
```

## 5. 云端通道（github.io 控制台改道隧道）
github.io 的 ⚙ 页读 `config.json` 顶层 `apiOrigin`；非空 + 处于 `github.io` 域名时，把 `/api/*` 改道到该地址。两种隧道任选：

### 方案 A：快速隧道（免费，当前在用）
```bash
nohup cloudflared tunnel --url http://localhost:8791 >/tmp/cf.log 2>&1 &
sleep 4
grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/cf.log | head -1   # 这就是地址
```
填进 `apiOrigin` 并提交：
```bash
sed -i 's|"apiOrigin": ""|"apiOrigin": "https://上面地址"|' config.json
git add config.json && git commit -m "deploy: apiOrigin 指向快速隧道" && git push
```
**重启恢复（一键）**：`bash scripts/refresh_tunnel.sh` —— 自动杀旧隧道→起新隧道→抓地址→改 `apiOrigin`→拉取变基→提交推送。
- 缺点：地址每次重启变，需重跑上面或脚本；写接口裸奔公网（随机地址不索引，风险低）。

### 方案 B：命名隧道（固定地址 + 可加登录保护，推荐长期）
需 Cloudflare 账号 + 一个域名（或免费 `eu.org` 子域，它允许把 NS 交 Cloudflare）。不要用 `us.kg`/`dpdns.org` 等——它们通常不允许改 NS，加不成 Cloudflare zone，`cloudflared login` 选不到。
```bash
cloudflared login                              # 浏览器授权，选你的 zone
cloudflared tunnel create a-sentiment-ui
cloudflared tunnel route dns a-sentiment-ui 你的域名   # 自动建 DNS
cloudflared tunnel list                         # 记 Tunnel ID
sudo mkdir -p /etc/cloudflared /root/.cloudflared
sudo cp /home/sjc19950404/.cloudflared/<ID>.json /root/.cloudflared/
sudo tee /etc/cloudflared/config.yml >/dev/null <<'YAML'
tunnel: a-sentiment-ui
credentials-file: /root/.cloudflared/<ID>.json
ingress:
  - hostname: 你的域名
    service: http://localhost:8791
  - service: http_status:404
YAML
sudo cloudflared service install                # 做成开机自启服务
sudo systemctl enable cloudflared && sudo systemctl start cloudflared
```
然后把 `apiOrigin` 换成固定域名提交（同方案 A 的 sed，只是地址换成 `https://你的域名`）。重启后 `ui_server` + `cloudflared` 都自动起。

## 6. 安全红线（强烈建议）
隧道把 `/api/update-config` 写接口暴露公网——任何拿到隧道地址的人都能改你家的交易参数（止损、仓位等）。**务必**：
- Cloudflare 控制台 → **Zero Trust（零信任）→ 访问(Access) → 应用程序(Applications)**，匹配隧道主机名，加邮箱/PIN/设备登录（没登录进不来）。
- 或至少把 CORS 收窄到 Pages 源：单元里加 `Environment=UI_CORS_ORIGIN=https://sjc19950404.github.io`（只能挡跨站脚本，挡不住直接拿地址 curl，故 Access 才是真防线）。
- 绝不把 `.env`（含 OPS_WEBHOOK 等密钥）放进 `config.json` 或提交；`config.json` 只放公开配置。`ui_server` 代码零引用 `.env`，符合全局红线。

## 7. 验收
手机/公司网络开 `https://sjc19950404.github.io/a-sentiment-pro/`（或你的 Pages 地址）→ ⚙ 系统设置：
- 顶部「参数来自 config.json（控制台实时生效）」= **已连上**后端
- 改参数点保存 → 「已保存并备份 config.json.bak」
- 点沙盒推演 → 返回新旧情绪分/选股差异

## 8. 排错
- **推送被拒（fetch first）**：管线常往 main 推数据文件，本地落后 → `git pull --rebase` 再 `git push`（脚本已内置）。
- **8791 被占**：`sudo ss -ltnp | grep 8791` 找 PID 杀掉（见第 2 步）。
- **控制台仍只读/提示未连上**：确认 `apiOrigin` 非空且正处于 github.io 域名；隧道可达（`curl https://你的隧道域名/api/config` 应 200）；CORS 默认 `*`（已被 ui_server 放行）。
- **cloudflared 未装**：`curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared`（Pi 是 arm64；若 `uname -m` 是 armv7l 换 `arm`）。

## 9. 配套文件
- `deploy/a-sentiment-ui.service`：systemd 单元模板（写死 `/opt` 路径，**本机请用第 3 步 heredoc 生成**）
- `scripts/refresh_tunnel.sh`：快速隧道一键重连（重启后跑一条命令）
- `scripts/ui_server.mjs`：后端服务（静态 + 三 API）
- `config.json`：`apiOrigin` 字段（云端通道开关）
