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

# 2026-11-09 修复：pre-push 推送确认闸（2026-11-07 装）注释明确 cron 自动化链
#    走 ASPRO_AUTO_PUSH=1 免交互通道，但 crontab 与本脚本均未设置 → 11-07 起自动推送
#    全部被闸拦截（11-09 04:30 企微告警的病根）。在此统一补上：本脚本只承载机器
#    自动链，人工终端推送仍走 /dev/tty 交互确认，闸的防护边界不变。
#    ⚠ 本文件为 git 跟踪文件且 pi_run 每次运行 reset --hard origin/main——
#    对本文件的任何修改必须立即 commit+push，否则下个 tick 会被静默还原。
export ASPRO_AUTO_PUSH=1
MODE="${1:-eod}"
cd "$REPO_DIR" || { alert "pi_run: 仓库不存在 $REPO_DIR"; exit 1; }
[ -f .env ] && { set -a; . ./.env; set +a; }   # 仅取 OPS_WEBHOOK（企微 key，非 repo 凭据）

# 2026-10-30 加固：限制 Node 堆上限，防止 EOD 大档（archive 6.9MB + 241 天重算）被 OOM-killer 静默杀进程。
# 树莓派物理内存有限（1~2GB），不设上限时 GC 目标超物理内存 → 进程被杀且无报错（脚本多 || true 吞错）。
# 按 Pi 物理内存可上调到 1536（1.5G）；此处按 1G 设，覆盖绝大多数 Pi 场景。
# Pi 默认走 IPv6 连东财(push2)会 socket 失败 → breadth/mcap 等面板静默滞后。
#   强制 IPv4 解析优先（curl -4 验证东财源可达），修复这类面板刷新。
export NODE_OPTIONS="--max-old-space-size=1024 --dns-result-order=ipv4first"

# 修复（2026-11-04）：~/.gitconfig 里 http.sslBackend=schannel（Windows 专用后端，疑 fastgithub
#   加速器遗留）在本 Linux Pi 不受支持 → 所有 git HTTPS fetch/pull/push 立刻 aborted（被 pi_push
#   误判为"网络波动"）。用 GIT_CONFIG_* 环境变量对本进程及子进程（pi_push.sh 等）的 git 强制
#   gnutls（已实测可用）。不改任何 git 配置文件；即使 .gitconfig 再被改回 schannel 也免疫。
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=http.sslBackend
export GIT_CONFIG_VALUE_0=gnutls

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
# 干净起点 v2（2026-11-12 根治）：reset 仅限代码路径——data/ 永不被重置、堆积提交
#   不因 reset 丢分支指针（pathspec 版 reset 不动 HEAD）。此前的「reset 前先推」防护
#   因 heredoc 展开事故实为死代码（if [ -n "" ]），且 pi_push 失败时仍会吃数据——根治于此。
# 代码路径重置到远端（git restore：不动 HEAD 分支指针、不碰 data/，堆积提交安全）
git restore --source=origin/main --worktree --staged -- src scripts test pi_run.sh crontab.example config.json package.json terminal.js index.html >>"$LOG_FILE" 2>&1 \
  || log "git restore 代码路径失败：使用本地现有代码继续（未拉取远端代码）"
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
    node scripts/fetch_global.mjs 2>>"$LOG_FILE" || log "外围抓取失败（best-effort，继续）"
    node scripts/snapshot_intraday.mjs || log "盘中快照失败"
    bash scripts/pi_push.sh
    ;;
  eod|supplement)
    node scripts/fetch_global.mjs 2>>"$LOG_FILE" || log "外围抓取失败（best-effort，继续）"
    if ! bash scripts/pi_build.sh "${@:2}"; then
      log "pi_build 失败（守卫拦截），不推送"; alert "pi_run: 盘后管道守卫失败，未推送"; exit 1
    fi
    # 方案B（2026-10-27）：EOD 数据生成后，把 K线+聚合侧车档推送到独立数据仓 a-sentiment-kline，
    #   供 GitHub Pages 终端经 terminal.js 的 durl() + jsDelivr CDN 拉取（这些档刻意不入主仓 git）。
    #   数据仓未建/PAT 未授权时脚本内部静默跳过（exit 0），绝不影响 EOD 主流程。
    bash scripts/push_data_repo.sh || log "数据仓推送失败（best-effort，不影响 EOD）"
    # 修复（route A）：report_etf_hedge / report_reco_picks 产出 etf_hedge_signal.json /
    #   reco_picks_latest.json，必须在 pi_push 之前生成，否则当轮不提交、下轮 reset 冲掉 → Pages 永远停旧版。
    # 2026-10-27 用户指令：EOD 盘前生成 ETF 防守反击避险信号（只读 dual_track + ETF k线，绝不交易）；
    #   写出 data/etf_hedge_signal.json，供下方 push_eod 经副报文整合进盘后企微推送。
    node scripts/report_etf_hedge.mjs 2>>"$LOG_FILE" || log "ETF 避险信号生成失败（best-effort，不影响 EOD 推送）"
    # 2026-10-27 用户指令：实战化「可交易性」只读报告——复用 recommendPicks（内置剔除买不进的票 +
    #   买点预期标注 + 烂板弱转强偏好），落盘 data/reco_picks_latest.json，供终端展示「买点预期」。
    #   只读 dual_track + ztpool_history，绝不交易。
    node scripts/report_reco_picks.mjs 2>>"$LOG_FILE" || log "可交易性选股报告生成失败（best-effort，不影响 EOD 推送）"
    # 数据已全部生成（含上面的 etf_hedge_signal / reco_picks_latest），一次性提交并推 GitHub/Pages。
    # data 同步 GitHub 失败不影响本地交易与复盘推送：pi_push.sh 已发企微友好通知并保留本地提交。
    bash scripts/pi_push.sh || log "data 同步 GitHub 失败（已发企微通知，详见 push.log），继续复盘推送"
    # 数据新鲜度门禁（激活）：对比各离线模块档日期与档案锚日，落后/缺失即企微告警（不 exit 1，避免阻断推送）。
    #   覆盖 宽度/主线/账本/亏钱效应/板块排行/市值/今日选股/ETF防守 —— 旧值不得静默顶替当日值（设计即"诚实红"）。
    node scripts/freshness.mjs --require-fresh >>"$LOG_FILE" 2>&1 || { alert "数据新鲜度门禁：存在今日未刷新的离线模块（宽度/主线/账本/亏钱效应/板块排行/市值/今日选股/ETF防守），旧值可能顶替当日值——详见 run.log 的 freshness 门禁输出"; true; }
    # EOD 推送「优先级 + 时间错峰」引擎：月报 > 周报(+周盈利战报) > 盘后基础复盘 > AI盘后情报；
    #   多条错峰发送（默认 3s）。盘中紧急异动 / 盘前排雷与观察清单由各自独立 cron 模式推送，不受此 gate。
    # ⑧c 妖股标记历史留存（2026-11-07）：GLM 标记每日被覆盖，先落账本再推送，
    #    供 dragon_purity_validation.mjs 做 T+1 续板率验证（判断必须能被回测检验）。
    node scripts/dragon_marks_history.mjs 2>/dev/null || log "妖股标记留存失败（best-effort，继续）"
    # 因子健康度仪表（2026-11-09 外部拍板）：alpha 序列/胜率/基准差三表针 + 三态
    #    预警（✅健康 ⚠️观察 ❌告警）+ 分 regime 基准校验；周粒度账本
    #    data/factor_health_history.json（幂等同周覆盖）。纪律：仪表只读只报警，
    #    系统禁止自动修改规则；告警仅供人工评估，独立风控闸口（各 gate/锚点门禁）
    #    不受其影响。失败 best-effort 不拦 EOD。
    node scripts/factor_health.mjs 2>/dev/null || log "因子健康度仪表失败（best-effort，继续）"
    # 回场研究采集管道（2026-11-09 建）：成交额250日分位+20日波动分位+指数位置分位，
    #    自包含东财指数日K全量重建（幂等），供回场触发日直接使用完整历史；
    #    只读只留存不产生信号，回场触发判定仍为人工/事件信号。
    node scripts/market_context_history.mjs 2>/dev/null || log "市场背景采集失败（best-effort，继续）"
    # ⑧c 人机对照基线（2026-11-09 建）：同 GLM 标记批改口径攒"人的盘感"样本，
    #    人工每天在 data/human_baseline.json 给 guess 填 cont/break（约30秒），
    #    快照+T+1自动批改全自动；与 GLM 命中率双份对照。
    node scripts/dragon_human_baseline.mjs 2>/dev/null || log "人机基线侧车失败（best-effort，继续）"
    # 侧车新鲜度哨兵（2026-11-09 全系统审计）：⑧c账本/人机基线/回场管道/仪表账本是否仍在长。
    #    旧 freshness 门禁不覆盖这些新侧车，静默失败无人知晓（⑧c 三个月采样会无声停摆）。
    #    停滞 → 自行发企微告警（OPS_WEBHOOK）；全新鲜 → 静默 exit 0。
    node scripts/sidecar_freshness.mjs 2>/dev/null || log "侧车新鲜度告警（已发企微，详见检查输出）"
    # 2026-11-09：supplement（21:00 补抓档）与 eod 共用本分支，重跑推送时抑制 AI 副报文——
    #   AI 情报每次 GLM 现场生成、内容指纹必不同 → 每天双份 AI（实测 40 只/36 只各一份）。
    #   主报文照常重推：数据更全时内容更新（指纹不同会发），未变则被指纹去重拦截。
    if [ "$MODE" = "supplement" ]; then ASPRO_SUPPRESS_AI_BRIEF=1 node scripts/push_eod.mjs 2>/dev/null || true; else node scripts/push_eod.mjs 2>/dev/null || true; fi
    # 2026-10-27 用户指令：EOD 结束后把本地 ui/kline + 聚合侧车档增量同步到 Cloudflare R2（S3 协议），
    #   供 Pages 终端经 terminal.js durl() 改道 R2 公共地址拉取（config.json dataOrigin 已切到 R2）。
    #   脚本内部容错：缺凭证 / SDK 未装 / 桶连不通 仅告警并 exit 0，绝不破坏 EOD 主流程。
    node scripts/sync_to_r2.mjs 2>>"$LOG_FILE" || log "R2 同步失败（best-effort，不影响 EOD）"
    # 归档日快照（2026-11-09 B2）：archive 系列已移出 git（云端走 R2），本地留最近 7 天可回滚副本
    node scripts/archive_snapshot.mjs 2>/dev/null || log "归档快照失败（best-effort，继续）"
    ;;
  us_close|a50)
    node scripts/fetch_global.mjs || log "外围抓取失败"
    bash scripts/pi_push.sh
    ;;
  pre_open)
    node scripts/fetch_global.mjs 2>>"$LOG_FILE" || log "外围抓取失败（best-effort，继续）"
    node scripts/build_ai_report.mjs --type pre_market 2>/dev/null || true
    node scripts/push_ai_report.mjs --latest pre_market 2>/dev/null || true
    bash scripts/pi_push.sh
    ;;
  candidates)
    node scripts/fetch_global.mjs 2>>"$LOG_FILE" || log "外围抓取失败（best-effort，继续）"
    # 2026-10-28 紧急修复：推送前强制刷新实时盘中快照（涨跌家数/涨停池），争取推送那一刻最新；
    #   即便失败也不阻断推送——freshIntradayMarket 闸门会让陈旧值"暂不可用"而非糊弄老板。
    node scripts/snapshot_intraday.mjs 2>>"$LOG_FILE" || log "盘中实时快照失败（best-effort，按滞后处理）"
    node scripts/build_ai_report.mjs --type intraday 2>/dev/null || true
    node scripts/push_ai_report.mjs --latest intraday 2>/dev/null || true
    bash scripts/pi_push.sh
    ;;
  research_monthly)
    # 只读聚合研究验证月报（tools/research/monthly_report.mjs）：双轨 P2 / 模拟盘 / 统一基线 / 周报健康度。
    # 先重算统一基线（只读、快速），再生成月报；产物 data/research_monthly_YYYY-MM.json + tools/research/reports/...md。
    # 不重算回测、不写生产；best-effort，失败不阻断。
    node tools/research/baseline.mjs 2>>"$LOG_FILE" || log "统一基线生成失败（best-effort）"
    node tools/research/monthly_report.mjs 2>>"$LOG_FILE" || log "研究月报生成失败（best-effort）"
    # pi_push 只提交 data/；月报 md 在 tools/，这里先暂存再交给 pi_push 一并提交（不碰禁止文件）。
    git add data/research_baseline.json tools/research/reports/research_baseline.md data/research_monthly_*.json tools/research/reports/research_monthly_*.md 2>/dev/null || true
    bash scripts/pi_push.sh
    ;;

  *) log "未知 mode: $MODE"; exit 2;;
esac

# 心跳自检（时间/Swap/Node/cron/网络/data 新鲜度/磁盘）
bash "${REPO_DIR}/smoke_test.sh" plain 2>/dev/null || true
log "pi_run[$MODE] 结束"
