#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# sync_public_data.sh —— 把「本地重/私数据」增量同步到 Cloudflare R2（方案一）
#
# 为什么存在：终端视图的个股K线（ui/kline，163MB/5554 分片）与聚合侧车档
#   （emotion_history / main_theme_history / announcements / paper-account /
#   llm_risk_blacklist）刻意不进 git（避免撑爆仓库 + churn），导致 GitHub Pages
#   上相对路径 404。本脚本把它们推到 R2，Pages 前端经 terminal.js 的 durl()
#   改道到 R2 公开读 URL 拉取 —— Git 仓库保持干净，Pages 终端全功能。
#
# 同步内容（目标键与前端 durl 路径一一对应，别改前缀）：
#   ui/kline/<code>.json                 → $R2_BUCKET/ui/kline/<code>.json
#   data/emotion_history.json            → $R2_BUCKET/data/emotion_history.json
#   data/main_theme_history.json         → $R2_BUCKET/data/main_theme_history.json
#   data/announcements-latest.json       → $R2_BUCKET/data/announcements-latest.json
#   data/paper/account.json              → $R2_BUCKET/data/paper/account.json
#   data/llm_risk_blacklist.json         → $R2_BUCKET/data/llm_risk_blacklist.json
#
# 一次性配置（在树莓派上做一次）：
#   1) Cloudflare 面板 → R2 → 建桶（如 a-sentiment-data）→ 公开访问开「r2.dev 开发 URL」
#      或绑自定义域；把公开读 URL 填进 terminal.js 的 DATA_ORIGIN（或 config.json dataOrigin）。
#   2) R2 → 管理 API 令牌 → 建「对象读写」令牌，拿到 Account ID / Access Key / Secret。
#   3) 安装并配置 rclone（一条命令）：
#        curl https://rclone.org/install.sh | sudo bash
#        rclone config   # 新建 remote 名 r2，类型 s3，provider=Cloudflare，
#                        # endpoint=https://<AccountID>.r2.cloudflarestorage.com，填 key/secret
#   4) 桶级 CORS（允许 Pages 域名跨域读 JSON）：
#        rclone 或面板给桶加 CORS 规则 AllowedOrigins=["https://sjc19950404.github.io"]
#
# 运行：EOD 数据生成后调用（已挂进 pi_run.sh 的 eod 分支，best-effort）。
#   依赖缺失/未配置 → 仅告警并 exit 0（绝不影响 EOD 主流程）。
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

R2_REMOTE="${R2_REMOTE:-r2}"                 # rclone config 里的 remote 名
R2_BUCKET="${R2_BUCKET:-a-sentiment-data}"   # R2 桶名
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "[sync_public_data] $*"; }

# 前置：rclone 可用且 remote 已配置；否则静默跳过（不拖累 EOD）。
if ! command -v rclone >/dev/null 2>&1; then
  log "rclone 未安装，跳过 R2 同步（见脚本头一次性配置）。"
  exit 0
fi
if ! rclone listremotes 2>/dev/null | grep -q "^${R2_REMOTE}:"; then
  log "rclone remote「${R2_REMOTE}」未配置（rclone config），跳过 R2 同步。"
  exit 0
fi

DEST="${R2_REMOTE}:${R2_BUCKET}"

# 1) 个股K线（大头，增量同步；--update 只传变化的，删掉本地已删的）
if [ -d ui/kline ]; then
  log "同步 ui/kline → ${DEST}/ui/kline （增量）…"
  rclone sync ui/kline "${DEST}/ui/kline" \
    --transfers 16 --checkers 16 --fast-list \
    --s3-upload-cutoff 10M --log-level NOTICE \
    && log "ui/kline 同步完成" || log "⚠ ui/kline 同步失败（不阻塞）"
else
  log "ui/kline 不存在，跳过"
fi

# 2) 聚合侧车档（小文件，逐个 copy；缺失就跳过——允许某档当日未生成）
AGG_FILES=(
  data/emotion_history.json
  data/main_theme_history.json
  data/announcements-latest.json
  data/paper/account.json
  data/llm_risk_blacklist.json
)
for f in "${AGG_FILES[@]}"; do
  if [ -f "$f" ]; then
    rclone copyto "$f" "${DEST}/${f}" --log-level NOTICE \
      && log "已同步 $f" || log "⚠ $f 同步失败（不阻塞）"
  else
    log "跳过（本地不存在）：$f"
  fi
done

log "R2 同步流程结束。"
exit 0
