# SSD 写入卫生与运维加固

适配对象：树莓派（SSD 固态硬盘）上的 a-sentiment-pro 生产部署。
记录日期：2026-10-25 · 版本 `v1.0.1_Network_Stable` 之后。

---

## 0. 本机现状（已实测，可直接对照）

| 项 | 实测值 | 结论 |
|---|---|---|
| SSD 型号 | `SAMSUNG MZALQ128HBHQ-000L1`（NVMe 119.2G） | 固态盘，需考虑写入寿命 |
| 文件系统 | `/dev/nvme0n1p2` **ext4** | — |
| 挂载选项 | `rw,noatime` | ✅ 已启用 `noatime`，避免了「每次读取都写一次 atime」的写放大——这是 SSD 上最划算的一档优化，无需再动 |
| fstrim.timer | **enabled + active** | ✅ 已开启，无需处理（见 §3） |
| 日志 | `run.log` / `push.log` | ✅ **滚动已装**：用户级 systemd timer，每日 00:14±30min |
| 日志归档保留 | `rotate 14` + `maxsize 20M` + `compress` | ✅ 2 周历史，压缩归档，单档不再无限涨 |
| 操作系统 | Debian + FastGithub 相关 | ℹ 本环境 **sudo 需密码**，故选用户级方案（§2.1） |

一句话结论：**没有对 SSD 造成无意义损耗的硬伤**，只有日志滚动这一项待装。

---

## 1. 写入卫生：避免无意义重写

### 1.1 已有机制：`writeJsonStable`（剥时间戳后比对，内容未变则跳过）

位置：`src/lhb_codec.js:466`。

```js
// 流程（源码节选）
const nextStable = JSON.stringify(strip(data));       // 递归剥掉 stampKeys（默认 generatedAt）
const prev = JSON.parse(readFileSync(filePath, 'utf8'));
if (JSON.stringify(strip(prev)) === nextStable) {
  return { skipped: true, reason: 'unchanged' };        // ← 不写盘
}
// 内容真的变了才落盘（tmp + rename 原子替换）
```

**已在使用的写点**（每日高频重跑的档）：

| 脚本 | 落盘档 |
|---|---|
| `scripts/fetch_universe.mjs` | `data/paper_universe.json`（1.1MB，compact）+ `-lite` |
| `scripts/smoke_sources.mjs` | 冒烟报告 |
| `scripts/version_regression.mjs` | 回归数字档 |

**实测生效证据**：`push.log` 里在非交易日 tick 频繁出现 `data/ 无变化，无需推送`——正是因为 `writeJsonStable` 把时间戳抖动挡在了落盘之前，git 侧因此零 diff。

### 1.2 已知例外（属预期，不算硬伤）

- 含时延/耗时类字段的档（如冒烟的毫秒延迟）内容天然每次都变，用本函数不会误跳，只是起不到降噪作用。
- 主档 `archive.json`（6.7MB）、切片、`signals-latest.json` 走的是 `atomicWriteJSON`（只保证原子性、不做内容比对）。它们**只在有新交易日数据时才变化**，属于必须落盘的写，不是无意义重写。

> 纪律：绝不为「省 SSD」而牺牲原子性。中途被杀留半截档的代价，远大于多写几次。

---

## 2. 日志滚动（待装，一次性）

配置文件已入库：`scripts/logrotate-aquant.conf`。

### 2.1 安装（用户级，**无需 sudo**）—— 已在树莓派装好并实测通过

`/var/log/aquant` 归属 `sjc19950404`，因此用**用户级 systemd timer** 即可，
完全不需要 root（本环境 sudo 需密码，系统级方案反而装不上）：

```bash
mkdir -p ~/.config/systemd/user ~/.local/state
cp scripts/systemd/aquant-logrotate.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now aquant-logrotate.timer

# 验证
systemctl --user is-active aquant-logrotate.timer     # → active
systemctl --user list-timers aquant-logrotate.timer  # → 看下次执行时间
```

**实测结果**（2026-10-25 01:32）：

```
push.log  2.2K → push.log-20261025      （新 push.log 归零）
run.log   522K → run.log-20261025      （新 run.log  归零）
service   status=0/SUCCESS
```

> ⚠ **踩过的坑**：Debian / Raspberry Pi OS 上 `logrotate` 在 **`/usr/sbin/logrotate`**，
> **不在 `/usr/bin`**。单元里写 `/usr/bin/logrotate` 会直接报
> `status=203/EXEC · Unable to locate executable`。单元文件已用绝对路径 `/usr/sbin/logrotate`。
>
> 另外，**首次运行只写状态、不轮转**（logrotate 标准行为）——新装后想立刻看到归档，
> 需 `logrotate -f` 强制一次。

### 2.2 配置要点

```
/var/log/aquant/*.log {
    daily            # 每日一滚
    rotate 14        # 保留 2 周历史
    maxsize 20M      # 单日暴涨超 20M 立即滚（双触发）
    missingok
    notifempty
    compress         # 压缩归档
    delaycompress    # 延迟一周期压缩，避免压缩「正在被追加的档」
    dateext          # 轮转档带日期后缀，便于定位「10-24 晚 EOD 为什么失败」
    copytruncate     # 见下方取舍
    create 0664 sjc19950404 sjc19950404
}
```

**为什么用 `copytruncate`**：写日志的是 shell 脚本（`pi_run.sh` / `pi_push.sh` 的 `log()` 每次「开-追加-关」），虽不长期持有 fd，用 `copytruncate` 可彻底规避「进程仍持旧 inode 导致日志被写到已轮转文件」的风险；代价是轮转瞬间可能丢极少几行，对运维日志可接受。

### 2.3 巡检

```bash
systemctl --user is-active aquant-logrotate.timer   # 定时器活着没
systemctl --user list-timers aquant-logrotate.timer # 下次执行时间
ls -lh /var/log/aquant/                             # 看归档是否生成

# 想立刻看到效果（不等到点）：强制轮转一次
logrotate -f --state ~/.local/state/aquant-logrotate.state \
          /opt/a-sentiment-pro/scripts/logrotate-aquant.conf

# 只读校验（不实际轮转、不写状态）
logrotate --debug --state ~/.local/state/aquant-logrotate.state \
          /opt/a-sentiment-pro/scripts/logrotate-aquant.conf
```

定时器配置：`OnCalendar=daily` + `RandomizedDelaySec=30min`（错开其他定时任务，
避免刚好撞上 EOD 管道写日志）+ `Persistent=true`（关机漏跑，开机补跑）。

---

## 3. SSD TRIM（已开启，本节仅作备查）

本机 `fstrim.timer` **已 enabled + active**，无需操作。以下为换机/重装时的开启方法：

```bash
# 确认支持
lsblk -d -o NAME,ROTA,MODEL          # ROTA=0 即非机械盘（SSD）
sudo fstrim -v /                     # 手动跑一次，验证可用

# 开启每周自动 TRIM（Debian / Raspberry Pi OS 通常默认已开）
sudo systemctl enable --now fstrim.timer
systemctl list-timers fstrim.timer   # 确认下次执行时间
```

**不推荐**的做法：在 `/etc/fstab` 里加 `discard` 挂载选项（连续 discard，每次删文件都触发 TRIM，某些老 SSD 固件上反而会卡顿）。用 `fstrim.timer` 的**周期 TRIM** 是官方推荐且更稳。

---

## 4. 巡检清单（建议每周跑一次）

```bash
# ① 日志体积是否失控
du -sh /var/log/aquant/

# ② SSD 剩余与 TRIM 状态
df -h / ; systemctl is-active fstrim.timer

# ③ 数据档体积（异常增长通常意味着误把派生字段写进了主档）
ls -lhS data/*.json | head -5

# ④ 写入卫生是否仍生效（非交易日应看到「无需推送」）
grep -c "无变化，无需推送" /var/log/aquant/push.log
```

---

## 5. 结论

| 需求 | 状态 |
|---|---|
| ① 避免无意义重写 | ✅ `writeJsonStable` 已在用并实测生效；仅原子性需求处保留必写 |
| ② 日志滚动 | ✅ **已安装并实测通过**（用户级 timer，无需 sudo；§2.1） |
| ③ fstrim 定时 TRIM | ✅ 已 enabled + active，无需处理 |
| 附带：`noatime` 挂载 | ✅ 已是 `rw,noatime`，无需处理 |
