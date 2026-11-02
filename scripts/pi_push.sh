#!/usr/bin/env bash
# pi_push.sh — 树莓派安全推送守卫（防复发核心）
# 只提交 data/ 目录；绝不碰 .github/、.env、代码、node_modules 或任何垃圾文件。
# 任何禁止文件混入即中止并回滚暂存，绝不推送。
#
# 2026-10-24 同步失败友好化（用户需求）：push 因网络波动/代码冲突失败时，
#   · 先有限重试（3 次、间隔 10s）扛住瞬时网络抖动；
#   · 仍失败则**保留本地提交**（rebase --abort，不再 git reset --hard 丢弃数据），
#     并向企微发一条通俗中文系统通知，指明原因与修复命令；
#   · 绝不阻塞本地模拟交易与企微复盘推送（pi_run.sh 中本步骤失败不 exit）。
set -uo pipefail

REPO_DIR="${REPO_DIR:-/opt/a-sentiment-pro}"
LOG_DIR="${LOG_DIR:-/var/log/aquant}"
mkdir -p "$LOG_DIR"
log() { echo "$(date '+%F %T %Z') [pi_push] $*" | tee -a "${LOG_DIR}/push.log"; }

cd "$REPO_DIR" || { log "仓库目录不存在 $REPO_DIR"; exit 1; }

# 单实例锁：避免两个 cron tick 同时 push 造成并发冲突
exec 9>/var/lock/aquant.pi_push.lock
if ! flock -n 9; then log "已有 push 实例在跑，跳过"; exit 0; fi

# ── 企微系统通知（通俗中文；OPS_WEBHOOK 由 pi_run.sh source .env 时导出，本脚本继承）──
notify() {
  local body="$1"
  if [ -z "${OPS_WEBHOOK:-}" ]; then log "OPS_WEBHOOK 未配置，跳过企微通知"; return 0; fi
  if curl -s -m 15 -X POST -H 'Content-Type: application/json' \
      -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"${body}\"}}" \
      "$OPS_WEBHOOK" >/dev/null 2>&1; then
    log "企微同步失败通知已发送"
  else
    log "企微通知发送也失败（网络不通），仅记日志"
  fi
}

# 失败原因分类：把 git 的英文报错翻译成用户看得懂的中文
classify() {
  local err="$1"
  if printf '%s' "$err" | grep -qiE 'could not resolve host|network is unreachable|connection (refused|reset|timed out)|timed out|failed to connect|unable to access|ssl|tls|http/2|rpchung|empty reply|proxy'; then
    echo "网络波动"
  elif printf '%s' "$err" | grep -qiE 'non-fast-forward|fetch first|rejected|conflict|autostash|could not apply|already exists'; then
    echo "代码冲突"
  else
    echo "原因待查"
  fi
}

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

# ── 先拉后推（rebase 保持线性）+ 有限重试扛网络抖动 ─────────────────────────
MAX_TRY="${PUSH_MAX_TRY:-3}"
try=0
reason="原因待查"
while [ "$try" -lt "$MAX_TRY" ]; do
  try=$((try + 1))
  # 上一次若留下半截 rebase，先干净退回（保留本地提交，不丢数据）
  git rebase --abort >/dev/null 2>&1 || true

  if ! PULLOUT=$(git pull --rebase --autostash origin main 2>&1); then
    reason=$(classify "$PULLOUT")
    log "pull/rebase 第 ${try}/${MAX_TRY} 次失败（${reason}）：$(printf '%s' "$PULLOUT" | tail -1)"
    [ "$try" -lt "$MAX_TRY" ] && { sleep 10; continue; }
    break
  fi

  if PUSHOUT=$(git push origin main 2>&1); then
    log "推送成功：$MSG"
    exit 0
  else
    reason=$(classify "$PUSHOUT")
    log "push 第 ${try}/${MAX_TRY} 次失败（${reason}）：$(printf '%s' "$PUSHOUT" | tail -1)"
    [ "$try" -lt "$MAX_TRY" ] && { sleep 10; continue; }
    break
  fi
done

# ── 重试用尽仍失败：保留本地提交（数据不丢，下个 tick 还会带这份提交重试），发企微友好通知 ──
git rebase --abort >/dev/null 2>&1 || true
log "同步 GitHub 失败（${reason}），本地提交已保留（未 push），下个 tick 自动重试"
notify "⚠【系统通知】今日数据已生成成功，但同步至 GitHub 失败（${reason}），不影响本地模拟交易与复盘推送。请有空在终端运行 git pull --rebase 修复。"
exit 1
