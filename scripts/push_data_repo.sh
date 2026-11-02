#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# push_data_repo.sh —— 把「本地重/私数据」推送到独立数据仓 a-sentiment-kline
#                      （方案 B：jsDelivr + 独立仓库，绕开 Cloudflare）
#
# 为什么存在：终端视图的个股K线（ui/kline，163MB/5554 分片）与聚合侧车档
#   （emotion_history / main_theme_history / announcements / paper-account /
#   llm_risk_blacklist）刻意不进主仓 git（避免撑爆仓库 + churn），导致 GitHub
#   Pages 上相对路径 404。本脚本把它们推到一个**独立数据仓**，前端经 jsDelivr CDN
#   （免费、自带 CORS、国内可访问）拉取 —— 主仓保持干净，Pages 终端全功能。
#
# 数据仓内路径与主仓一致（jsDelivr 按同路径取用）：
#   ui/kline/<code>.json
#   data/{emotion_history,main_theme_history,announcements-latest}.json
#   data/paper/account.json
#   data/llm_risk_blacklist.json
#
# 前置（一次性，在 github.com 上做——只有 Cloudflare 被 403，github.com 正常）：
#   1) 建公开仓库 sjc19950404/a-sentiment-kline（可空，也可勾 README）。
#   2) 本机的 GitHub 凭证是 fine-grained PAT（默认只管 a-sentiment-pro）：
#      github.com → Settings → Developer settings → Fine-grained tokens → 选中该 token
#      → Repository access 加上 a-sentiment-kline，且 Contents 权限 = Read and write。
#      （或换一个 repo 全仓权限的 classic PAT 写进主仓 remote。）
#
# 运行：EOD 数据生成后由 pi_run.sh 的 eod 分支调用（best-effort，失败不阻塞 EOD）。
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

KREPO="a-sentiment-kline"
# 数据仓本地工作副本。注意：/opt 归 root 不可写，放用户可写的 XDG 数据目录（持久、跨重启保留，
# 使后续推送为增量）。
WORK="${XDG_DATA_HOME:-$HOME/.local/share}/a-sentiment-kline"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 0

log() { echo "[push_data_repo] $*"; }

# 复用主仓 remote 内嵌的凭证，拼出数据仓 remote（不打印 token）
MAIN_URL="$(git remote get-url origin 2>/dev/null || true)"
USERINFO="$(printf '%s' "$MAIN_URL" | sed -E 's#^https://([^@]*)@.*#\1#')"
if [ -z "$USERINFO" ] || [ "$USERINFO" = "$MAIN_URL" ]; then
  log "无法从主仓 remote 提取凭证，跳过。"
  exit 0
fi
KURL="https://${USERINFO}@github.com/sjc19950404/${KREPO}.git"

# 首次克隆数据仓工作副本（空仓或有 README 都能 clone；失败多为仓库未建/无权限 → 静默跳过）
if [ ! -d "$WORK/.git" ]; then
  rm -rf "$WORK"
  if ! git clone --quiet "$KURL" "$WORK" 2>/dev/null; then
    log "克隆 ${KREPO} 失败（仓库未建或 PAT 无权限）。请先在 github.com 建仓并授权，本次跳过。"
    exit 0
  fi
fi
cd "$WORK" || exit 0
git remote set-url origin "$KURL"
# 对齐远端（只有本脚本推送，正常不分叉；首次空仓 fetch 不到 main 也容错）
git fetch origin main --quiet 2>/dev/null && git reset --hard origin/main --quiet 2>/dev/null || true

# 同步数据：ui/kline 全量增量 + 聚合档（保持相对路径结构）
mkdir -p ui/kline data/paper
if [ -d "$ROOT/ui/kline" ]; then
  rsync -a --delete "$ROOT/ui/kline/" "ui/kline/"
fi
for f in data/emotion_history.json data/main_theme_history.json data/announcements-latest.json data/paper/account.json data/llm_risk_blacklist.json; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$f"
done

git add -A
if git diff --cached --quiet; then
  log "无变化，跳过推送。"
  exit 0
fi
git -c user.name="a-sentiment-pi" -c user.email="pi@local" commit -q -m "data: $(date -u +%Y-%m-%dT%H:%M:%SZ) [kline+agg sync]"
if git push origin main --quiet 2>/dev/null; then
  log "已推送 → sjc19950404/${KREPO}（jsDelivr 数据源，@main 约 12h CDN 缓存，EOD 数据足够）"
else
  log "⚠ 推送失败（best-effort；多为 PAT 无该仓权限或网络问题，不影响 EOD）"
fi
exit 0
