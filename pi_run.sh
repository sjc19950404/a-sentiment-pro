#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# pi_run.sh — 树莓派总调度（新架构：Pi=数据生产者 + 推送 + 隧道服务；GitHub=仓库 + Pages 展示）
#   用法：pi_run.sh <mode>    由 crontab 按「北京时间」调用
#     smoke       六源冒烟 + 跨源对账 + 守卫通知（盘前 08:30）
#     intraday    盘中轻量快照（09:30~15:00 每 30 分）
#     eod         盘后完整管道（18:30 首抓）
#     supplement  盘后补抓（21:00，数据更全时覆盖同日）
#     us_close    美股收盘档（北京次日 04:30）
#     a50         A50 夜盘收盘档（北京 05:20）
#     pre_open    盘前观察清单 + 推送（09:00）
#     candidates  盘中候选池 + 推送（09:35 / 10:30 / 14:00）
#
#   流程：校时 → git fetch + reset --hard origin/main（干净起点；.env / dist / node_modules 因 gitignore 保留）
#        → 跑对应任务（产生 data/）→ 渲染 dist/（供本地隧道）→ 安全推送 data/ 到 main → 推送企微报告
# ─────────────────────────────────────────────────────────────
set -uo pipefail
REPO_DIR="${REPO_DIR:-/opt/a-sentiment-pro}"
LOG_DIR="${LOG_DIR:-/var/log/aquant}"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/run.log"
log() { echo "$(date '+%F %T %Z') [pi_run:$1] $*" | tee -a "$LOG_FILE"; }
alert() { [ -z "${OPS_WEBHOOK:-}" ] && return 0; curl -s -X POST -H 'Content-Type: application/json' -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[Pi][$(hostname)] $1\"}}" "$OPS_WEBHOOK" >/dev/null 2>&1 || true; }

MODE="${1:-eod}"
cd "$REPO_DIR" || { alert "pi_run: 仓库不存在 $REPO_DIR"; exit 1; }
[ -f .env ] && { set -a; . ./.env; set +a; }   # 仅取 OPS_WEBHOOK（企微 key，非 repo 凭据）

# 校时闸（坏时间=脏数据）
[ -x /usr/local/bin/ensure_time.sh ] && { bash /usr/local/bin/ensure_time.sh || { log "校时失败，中止"; alert "pi_run: 校时失败"; exit 1; }; }

# 干净起点：拉最新代码并硬重置（丢弃本地旧 data/，已推送故无损失；.env/dist/node_modules 因 gitignore 保留）
git fetch origin main 2>/dev/null || log "git fetch 失败，用本地数据继续"
git reset --hard origin/main 2>/dev/null || { log "reset 失败"; alert "pi_run: reset 失败"; exit 1; }
# 执行位自愈：reset --hard 按 git 模式落盘，历史上出现过仓库内脚本执行位丢失
# （100644）→ cron 直接调用 pi_run.sh 全部 Permission denied → 调度全线停摆的事故。
# 这里在每次重置后显式补执行位，不依赖仓库里模式是否正确。
chmod +x "$REPO_DIR/pi_run.sh" "$REPO_DIR/scripts/pi_build.sh" "$REPO_DIR/scripts/pi_push.sh" 2>/dev/null || true

TODAY=$(date +%F)

case "$MODE" in
  smoke)
    node scripts/smoke_sources.mjs; SMOKE_RC=$?
    node scripts/cross_check.mjs 2>/dev/null || true
    OUTCOME=success; [ "$SMOKE_RC" -ne 0 ] && OUTCOME=failure
    node scripts/guard_notify.mjs --step-outcome "$OUTCOME" 2>/dev/null || true
    [ "$SMOKE_RC" -ne 0 ] && alert "pi_run: 六源冒烟失败"
    bash scripts/pi_push.sh
    ;;
  intraday)
    node scripts/snapshot_intraday.mjs || log "盘中快照失败"
    bash scripts/pi_push.sh
    ;;
  eod|supplement)
    if ! bash scripts/pi_build.sh; then
      log "pi_build 失败（守卫拦截），不推送"; alert "pi_run: 盘后管道守卫失败，未推送"; exit 1
    fi
    bash scripts/pi_push.sh || { log "data 推送失败"; alert "pi_run: data 推送失败"; }
    # 汇总推企微（盘前→盘中→盘后，push_ai_report 自带指纹去重防刷屏）
    ARGS=""
    PM=$(node -e "try{const i=require('./data/reports/index.json');console.log(i.reports&&i.reports.pre_market&&i.reports.pre_market.file||'')}catch(e){}" 2>/dev/null)
    [ -n "$PM" ] && [ -f "data/reports/$PM" ] && ARGS="data/reports/$PM"
    [ -f "data/reports/intraday_${TODAY}.json" ] && ARGS="$ARGS data/reports/intraday_${TODAY}.json"
    [ -f "data/reports/post_market_${TODAY}.json" ] && ARGS="$ARGS data/reports/post_market_${TODAY}.json"
    [ -n "$ARGS" ] && node scripts/push_ai_report.mjs $ARGS 2>/dev/null
    node scripts/push_ai_report.mjs --latest weekly 2>/dev/null || true
    ;;
  us_close|a50)
    node scripts/fetch_global.mjs || log "外围抓取失败"
    bash scripts/pi_push.sh
    ;;
  pre_open)
    node scripts/build_ai_report.mjs --type pre_market 2>/dev/null || true
    node scripts/push_ai_report.mjs --latest pre_market 2>/dev/null || true
    bash scripts/pi_push.sh
    ;;
  candidates)
    node scripts/build_ai_report.mjs --type intraday 2>/dev/null || true
    node scripts/push_ai_report.mjs --latest intraday 2>/dev/null || true
    bash scripts/pi_push.sh
    ;;
  *) log "未知 mode: $MODE"; exit 2;;
esac

# 心跳自检（时间/Swap/Node/cron/网络/data 新鲜度/磁盘）
bash "${REPO_DIR}/smoke_test.sh" plain 2>/dev/null || true
log "pi_run[$MODE] 结束"
