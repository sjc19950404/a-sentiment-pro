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
#   流程：校时 → git fetch + reset --hard origin/main（干净起点；网络不可达时自动降级为「本地代码继续」，绝不中断报告）
#        → 跑对应任务（产生 data/）→ 渲染 dist/（供本地隧道）→ 安全推送 data/ 到 main → 推送企微报告
# ─────────────────────────────────────────────────────────────
set -uo pipefail
REPO_DIR="${REPO_DIR:-/opt/a-sentiment-pro}"
LOG_DIR="${LOG_DIR:-/var/log/aquant}"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/run.log"
log() { local m="$(date '+%F %T %Z') [pi_run:$1] $*"; [ -t 1 ] && echo "$m"; printf '%s\n' "$m" >> "$LOG_FILE"; }
alert() { [ -z "${OPS_WEBHOOK:-}" ] && return 0; curl -s -X POST -H 'Content-Type: application/json' -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[Pi][$(hostname)] $1\"}}" "$OPS_WEBHOOK" >/dev/null 2>&1 || true; }

MODE="${1:-eod}"
cd "$REPO_DIR" || { alert "pi_run: 仓库不存在 $REPO_DIR"; exit 1; }
[ -f .env ] && { set -a; . ./.env; set +a; }   # 仅取 OPS_WEBHOOK（企微 key，非 repo 凭据）

# 单实例锁（与 pi_push.sh 同纪律）：并发调度撞车时（实例：14:00 盘中快照与候选池
# 同时触发）后来者优雅跳过——否则两个实例抢 git index.lock，把 reset 打挂。
# （注：reset 失败现已软化，仅发极简提示不中断；历史上曾因硬 exit 误发「reset 失败」
# 企微告警，2026-10-23 实测 candidates 当日因此整轮丢失——故「锁 + 软化」双保险）
exec 9>/tmp/pi_run.lock
flock -n 9 || { log "已有 pi_run 实例在跑，跳过本次（$MODE）"; exit 0; }

# 校时闸（坏时间=脏数据）
[ -x /usr/local/bin/ensure_time.sh ] && { bash /usr/local/bin/ensure_time.sh || { log "校时失败，中止"; alert "pi_run: 校时失败"; exit 1; }; }

# 干净起点（网络容错：树莓派稳定性 >> GitHub 连通性）
#   优先 fetch + reset --hard 到远端，得到干净最新代码；若 fetch / reset 任一失败
#   （通常是网络抖动或远端锁定），只记安静本地日志 + 一条极简运维提示，绝不以网络
#   问题 exit 1。网络不行就不拉取远端，直接用本地现有最新版代码跑 build_ai_report
#   （降级启动原则）；若本地存在未解决冲突（严重污染）也先清理到 HEAD 再继续。
git fetch origin main 2>>"$LOG_FILE" || log "git fetch 失败：远端不可达，将使用本地代码继续"
if ! git reset --hard origin/main >>"$LOG_FILE" 2>&1; then
  if git diff --name-only --diff-filter=U | grep -q .; then
    log "reset 远端失败且本地存在未解决冲突，git reset --hard HEAD 清理后继续"
    git reset --hard HEAD >>"$LOG_FILE" 2>&1 || true
  fi
  log "git reset --hard origin/main 失败：使用本地现有最新代码继续（未拉取远端）"
  alert "[提示] $(date +%H:%M) 代码同步网络抖动，已使用本地代码继续生成盘前简报。"
fi
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
    if ! bash scripts/pi_build.sh "${@:2}"; then
      log "pi_build 失败（守卫拦截），不推送"; alert "pi_run: 盘后管道守卫失败，未推送"; exit 1
    fi
    # data 同步 GitHub 失败不影响本地交易与复盘推送：pi_push.sh 已发企微友好通知并保留本地提交
    bash scripts/pi_push.sh || log "data 同步 GitHub 失败（已发企微通知，详见 push.log），继续复盘推送"
    # EOD 推送「优先级 + 时间错峰」引擎：月报 > 周报(+周盈利战报) > 盘后基础复盘 > AI盘后情报；
    #   多条错峰发送（默认 3s）。盘中紧急异动 / 盘前排雷与观察清单由各自独立 cron 模式推送，不受此 gate。
    node scripts/push_eod.mjs 2>/dev/null || true
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
