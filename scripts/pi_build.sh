#!/usr/bin/env bash
# pi_build.sh — 盘后完整数据管道（镜像 daily.yml 的 build job；非交易日脚本内部自动跳过）
# 调用：bash scripts/pi_build.sh
# 失败语义：GATE 步骤（日历 / 管道 / 龙虎榜口径守卫 / 契约守卫）失败 → 退出非 0 → 调用方中止推送。
#          其余步骤容错（失败不阻断，与 CI 的 continue-on-error 一致）。
set -uo pipefail

REPO_DIR="${REPO_DIR:-/opt/a-sentiment-pro}"
cd "$REPO_DIR" || exit 1
export MODE=live
# OPS_WEBHOOK 由 pi_run.sh 从 .env 导出；缺失则脚本内部静默跳过运维告警。

step() { echo "── $(date '+%T') $* ──"; }
gate() { # $1=步骤名  $2=命令；失败即退出
  step "$1"; if ! eval "$2"; then echo "❌ $1 失败，中止管道"; exit 1; fi
}

# 1 交易日历（必须最先，管道靠它判开市日）
gate "fetch_calendar"        "node scripts/fetch_calendar.mjs"
# 2 预跑管道（当日入档，供 pain/breadth 取当天）
gate "pipeline(early)"       "node src/pipeline.js"
# 3 亏钱效应（容错）
step "fetch_pain";           node scripts/fetch_pain.mjs || true
# 4 多维宽度（容错）
step "fetch_breadth";        node scripts/fetch_breadth.mjs --shards 8 || true
# 4.5 双轨账本重放（须在主管道写 signals-latest 之前！否则 dualTrack 段读到旧文件 → null）
step "dual_track";           node tools/backtest/paper_dual_track.mjs || true
# 4.6 LLM 舆情因子（容错；须在主管道写 signals-latest 之前——write.js 的 llmFn 在 buildSignals
#   时读 data/llm-sentiment-latest.json 注入 signals.llm）。fetch 脚本：缺配置 → 退出非 0 不落档
#   （简报八节显示「未生成」）；已配置但失败/超时/非法 JSON → 兜底落「获取失败，默认中性」档。
#   两种情形均不阻塞主管道（此处 step 容错）。
step "fetch_llm_sentiment";  node scripts/fetch_llm_sentiment.mjs || echo "⚠ LLM 舆情未落档（缺配置或调用失败），简报八节显示未生成/获取失败"
# 4.7 板块情绪因子（场景二）：抓新浪滚动新闻 + GLM 分类聚合 → data/macro-sector-sentiment-latest.json。
#   须在主管道写 signals-latest 之前（write.js 的 sectorSentimentFn 在 buildSignals 时读该档注入
#   signals.sectorSentiment）。fail-open：缺配置 → 退出非 0 不落档（简报显示「未生成」）；
#   已配置但新闻抓取/调用失败 → 兜底落「获取失败，默认中性」档。不阻断主管道。
step "fetch_macro_sector_sentiment"; node scripts/fetch_macro_sector_sentiment.mjs || echo "⚠ 板块情绪未落档（缺配置/网络/调用失败），简报显示未生成（fail-open）"
# 4.8 妖股逻辑推演（方向 C）：取连板梯队 + 复用场景二板块情绪 grounding → GLM 推演
#   → data/llm-dragon-logic-latest.json。须在主管道写 signals-latest 之前（write.js 的
#   dragonLogicFn 在 buildSignals 时读该档注入 signals.dragonLogic）。fail-open 同 4.6/4.7。
step "fetch_dragon_logic"; node scripts/fetch_dragon_logic.mjs || echo "⚠ 妖股逻辑未落档（缺配置/网络/调用失败），简报显示未生成（fail-open）"
# 5 主管道（live 嵌入 signals-latest）
gate "pipeline(main)"        "node src/pipeline.js"
# 6 新鲜度
step "freshness";            node scripts/freshness.mjs || true
# 7 外围行情（隔夜美股/汇率/商品）
step "fetch_global";         node scripts/fetch_global.mjs || true
# 8 回测档
step "backtest";             node scripts/backtest.mjs || true
# 10 策略收益回测
step "backtest_strategies";  node scripts/backtest_strategies.mjs || true
# 11 版本回归验证
step "version_regression";   node scripts/version_regression.mjs || true
# 12 模拟交易标的池
step "fetch_universe";       node scripts/fetch_universe.mjs || true
# 13 recalc LHB daily
step "recalc_lhb";           node scripts/recalc_lhb_daily.mjs || true
# 14 龙虎榜口径守卫（GATE）
gate "audit_lhb_caliber"     "node scripts/audit_lhb_caliber.mjs"
# 15 行业离群跨源核验（容错）
step "verify_industry_outliers"; node scripts/verify_industry_outliers.mjs || true
# 16 单元测试（容错，不阻断 Pi 推送）
step "unit_tests";           node --test --test-reporter=spec 2>/dev/null || true
# 17 前后端契约守卫（GATE）
gate "check_contract"        "node scripts/check_contract.mjs"
# 18 跨源一致性互证（容错）
step "fetch_crosscheck";     node scripts/fetch_crosscheck.mjs || true
# 19 K线分片增量
step "kline_all";            node ui/fetch_kline_all.mjs || true
# 19.5 涨停池历史入库（2026-10-23 修复：Pi 迁移漏步——ztpool_history 自 10-16 断更，
#   老龙头 ≥10 交易日冷却链断裂、Daily Data Health 门禁常红、窗口连板计算无历史可用）。
#   daily_fetch 自带交易日闸门（非交易日自动跳过）、幂等入库与端到端断言，失败自行
#   企微告警；此处刻意容错——archive 已落盘，涨停池当天可人工补跑，不该阻断主管道。
step "daily_fetch (ztpool入库)"; node scripts/daily_fetch.mjs || echo "⚠ ztpool 入库失败（已告警），可当日人工补跑：node scripts/daily_fetch.mjs"
# 20.7 切片重建（确定性安全网，2026-10-24 加）：pipeline(early) 写 signals-latest 时账本
#   必为昨日（stale 守卫如实置 null 并告警），依赖 pipeline(main) 前的 dual_track 补新鲜账本；
#   但那晚 push 瞬断会让"已写盘的新鲜账本"被 git reset --hard 回滚到 origin/main 旧值，下次
#   盘前时段 signals 就缺 dualTrack（10-23 即此）。这里固定用最终账本重建 signals-latest 与
#   切片，保证落盘/推送的 signals 永远是当日 dualTrack（与 CI daily.yml 同源、幂等、纯本地）。
#   失败不阻断——既有切片仍在，仅当次缺双轨披露，下轮自愈。
step "split_archive (切片重建)"; node scripts/split_archive.mjs || echo "⚠ 切片重建失败（不阻断，已有切片在）"
# 20.74 真实公告爬虫（V5.3 P2）：为排雷机提供真实公告源（东方财富官方公告接口，连板梯队 topN）。
#   fail-open：host 不可达/返回空 → 公告源为空 → 排雷机扫不到票 → 空黑名单（不误伤正常交易）。
step "fetch_announcements";  node scripts/fetch_announcements.mjs || echo "⚠ 公告爬虫未落档（网络限制/失败），本次排雷不封禁（fail-open）"
# 20.75 晚间公告排雷（V5.3 P2）：自动建仓前先扫描连板梯队/标的池公告，让 GLM 判定重大利空，
#   产出 data/llm_risk_blacklist.json；paper_daily 建仓前据此拒买（正向封禁，空表=fail-open）。
#   fail-open：缺 LLM 配置 → 退出非 0 不落档（本次不封禁）；已配置但无公告源/调用失败 → 空表。
#   两种情形均不阻断 EOD（不封禁 = 不误伤正常交易，与 fetch_llm_sentiment 同容错纪律）。
step "llm_risk_scan";        node scripts/llm_risk_scan.mjs || echo "⚠ 排雷扫描未落档（缺配置/无公告源/调用失败），本次不封禁（fail-open）"
# 20.8 纸面交易"最后一公里"（V5.3 P2）：每日结算（盯市 + T+1 解冻 + -8% 硬止损）+ 连板断板清仓
#   + 自动建仓（主线选股 topN@10%，仅当情绪档位允许新建且 regime 非盖帽）。落盘 data/paper/account.json
#   与 review-latest.json，供 build_ai_report 复盘段读取。缺档/失败均容错，不阻塞 EOD。
#
#   出场纪律 v1（PAPER_EXIT=strict_v1）已设为线上模拟默认：尸检证明它把净值从 -14% 翻到 +22%、胜率 17%→51%
#   （隔日强制了结连板 + 移动止盈 + 硬止损-5% + 亏损不过三 + 跌停逃生）。要回退到原 -8% 止损，删掉此行即可。
export PAPER_EXIT=strict_v1
step "paper_daily";          node scripts/paper_daily.mjs "$@" || echo "⚠ 纸面交易自动步失败（不阻断，下轮自愈）"
# 21 渲染 UI → dist/（供隧道服务；dist/ 已 gitignore，不参与推送）
step "build_ui";             node scripts/build_ui.mjs || { echo "⚠ build_ui 失败，但数据已落盘"; }
# 21/22 盘后 + 周报
step "report post_market";   node scripts/build_ai_report.mjs --type post_market || true
step "report weekly";        node scripts/build_ai_report.mjs --type weekly || true
# 23 盘前报告（供盘后汇总推送补齐）
step "report pre_market";    node scripts/build_ai_report.mjs --type pre_market || true

echo "✅ pi_build 完成"
