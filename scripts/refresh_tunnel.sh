#!/usr/bin/env bash
# 快速隧道一键重连（Pi 重启后运行）：重建 Cloudflare 快速隧道 + 更新 config.json 的 apiOrigin + 推送。
# 用法：bash scripts/refresh_tunnel.sh
# 前提：ui_server 已通过 systemd 开机自启（端口 8791）；cloudflared 已安装且在 PATH。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG=/tmp/cf.log
CF="$(command -v cloudflared || echo /usr/local/bin/cloudflared)"

echo "==> 仓库: $REPO"

# 0) 确认本地 ui_server(8791) 在跑（systemd 开机自启应确保它已起）
if ! curl -s -o /dev/null http://127.0.0.1:8791/api/config; then
  echo "✗ ui_server(8791) 没响应。请先: sudo systemctl start a-sentiment-ui"
  exit 1
fi

# 1) 杀掉旧快速隧道（避免重复占用）
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
sleep 1

# 2) 起新快速隧道
echo "==> 启动快速隧道..."
nohup "$CF" tunnel --url http://localhost:8791 >"$LOG" 2>&1 &
sleep 6

# 3) 取地址（形如 https://xxxx.trycloudflare.com）
NEW="$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" | head -1 || true)"
if [ -z "$NEW" ]; then
  echo "✗ 没拿到隧道地址，日志尾巴："; tail -8 "$LOG"; exit 1
fi
echo "==> 新隧道地址: $NEW"

# 4) 更新 apiOrigin 并提交推送（stash 绕开管线可能正在写的数据文件）
cd "$REPO"
git stash push -m "refresh-tunnel-temp" 2>/dev/null || true
git pull --rebase || { echo "✗ git pull 失败"; exit 1; }
git stash pop 2>/dev/null || { git checkout -- data/ 2>/dev/null; git stash drop 2>/dev/null || true; }
git checkout -- config.json 2>/dev/null || true   # 确保基于已提交版本改，避免冲突标记污染
sed -i "s|\"apiOrigin\": \"[^\"]*\"|\"apiOrigin\": \"$NEW\"|" config.json
git add config.json
git commit -m "deploy: 更新快速隧道地址 $NEW"
git push || { git pull --rebase && git push; }

echo "✓ 完成：apiOrigin=$NEW 已推送。等 Pages 重建约 1 分钟，github.io 控制台即恢复『已连上』。"
