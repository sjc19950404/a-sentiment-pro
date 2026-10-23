#!/usr/bin/env bash
# pi_push.sh — 树莓派安全推送守卫（防复发核心）
# 只提交 data/ 目录；绝不碰 .github/、.env、代码、node_modules 或任何垃圾文件。
# 任何禁止文件混入即中止并回滚暂存，绝不推送。
set -uo pipefail

REPO_DIR="${REPO_DIR:-/opt/a-sentiment-pro}"
LOG_DIR="${LOG_DIR:-/var/log/aquant}"
mkdir -p "$LOG_DIR"
log() { echo "$(date '+%F %T %Z') [pi_push] $*" | tee -a "${LOG_DIR}/push.log"; }

cd "$REPO_DIR" || { log "仓库目录不存在 $REPO_DIR"; exit 1; }

# 单实例锁：避免两个 cron tick 同时 push 造成并发冲突
exec 9>/var/lock/aquant.pi_push.lock
if ! flock -n 9; then log "已有 push 实例在跑，跳过"; exit 0; fi

# 只暂存 data/（含 data/reports/）。.env / .github / dist / node_modules 一律不入库。
git add data/ || { log "git add data/ 失败"; exit 1; }

STAGED=$(git diff --cached --name-only)
if [ -z "$STAGED" ]; then log "data/ 无变化，无需推送"; exit 0; fi

# 安全闸（双保险，即便 .gitignore 失效也能拦住）：
# 任何 .github/ 开头、.env、shell_hunter、*.bak、波浪号结尾、.secret、node_modules/ 出现即中止。
BAD=$(printf '%s\n' "$STAGED" | grep -E '^(.github/|\.env|node_modules/)|shell_hunter|\.bak$|~$|\.secret' || true)
if [ -n "$BAD" ]; then
  log "⛔ 发现禁止文件，中止推送以防泄露/污染："
  printf '%s\n' "$BAD" | while read -r f; do log "   禁止: $f"; done
  git reset -q
  exit 1
fi

MSG="data: $(date -u +%Y-%m-%dT%H:%M:%SZ) [Pi $(hostname)]"
if ! git commit -m "$MSG" >/dev/null 2>&1; then
  log "commit 失败"; git reset -q; exit 1
fi

# 先拉后推（rebase 保持线性）。冲突则放弃本次，下个 tick 自动重试。
if ! git pull --rebase --autostash origin main >/dev/null 2>&1; then
  log "pull/rebase 失败，放弃本次推送（下个 tick 重试）"
  git reset --hard origin/main 2>/dev/null || true
  exit 1
fi

if git push origin main >/dev/null 2>&1; then
  log "推送成功：$MSG"
else
  log "push 被拒（远端已前进），下个 tick 重试"
  git reset --hard origin/main 2>/dev/null || true
  exit 1
fi
