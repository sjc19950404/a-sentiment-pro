# 22 · 阶段 5 前置① flag 升级验收与收口

> 验收对象：CodeBuddy 提交 `f61a6227`（s-root.js flag 兼容性升级）。
> 依据：21 册 §5 五条 + §2.2 契约；脚本 `verify_phase5_flag.cjs`（只读线上，唯一 profile）。
> 结论：**19/19 全绿，两轮稳定；阶段 1/2/3/4a/4b 全量回归零退化。阶段 5 前置项① 收口，代码侧准备就绪。**

---

## 1. 线上部署核对

线上 `s-root.js`（10936 B）flag 段 L34-68 与 21 册 §2.2 契约逐字一致：
- `URLSearchParams(location.search)` + `localStorage 'sFlags'` 解析（L34-39）；
- `readFlag(name, dflt)` 优先级：URL `sflag-*` > storage > dflt（L40-45）；
- `S.flags` 默认值：overview/tableV2/drawerV2/reportV2 = **true**，defaultWorkbench = **false**，mount = false（L46-53）；
- `S.setFlag` 写回 `S.flags` + localStorage（L55-63）；`S.getFlag` 优先级 运行时 setFlag > URL/storage > dflt（L64-68）；
- `route()` L172 `wantBench = view === 'workbench'` 纯 view 判断，不读 flag —— 默认视图不受影响。

---

## 2. 19 项门禁全绿

| 门禁组 | 项 | 证据 |
|---|---|---|
| API | `getFlag`/`setFlag`/`S.flags` 存在 | 三函数/对象全在 |
| ① 默认语义 | overview/tableV2/drawerV2/reportV2 默认 true；defaultWorkbench 默认 false；未知 flag 走 dflt；overview 默认态 sRoot hidden/main 可见 | 全 PASS |
| ② URL 覆盖 | `?sflag-overview=0` 生效且不改默认视图；`?sflag-defaultWorkbench=0` 仍默认研报 | 全 PASS |
| ② UI 佐证 | overview=0 → 总览 tab **不注册复刻页**（无 `.s-page-overview`/`#sKpiScore`，走 s-root 通用占位）；overview=1 → 有 KPI 复刻 | 全 PASS |
| ③ localStorage | setFlag 写回 `sFlags`；刷新后仍生效；setFlag 恢复默认开 | 全 PASS |
| ④ 默认视图 | 无 workbench 深链时 main 可见、sRoot none | PASS |
| ⑤ 优先级 | 运行时 setFlag 覆盖 URL=0 | PASS |
| 5b | workbench 态 8 tab 结构齐全 | PASS |
| 附加 | 控制台零异常 | exceptions=0、consoleErrors=0 |

两轮连续 `verdict=PASS 19/19`、`failed=[]`。

### 2.1 本轮两处口径纠正（探针问题，非代码缺陷）
1. **8 tab 在默认研报态测不到**：`buildShell()` 仅 wantBench 时构建（s-root.js L175），默认态 sRoot hidden、tabCount=0 属正常。改到 workbench 态验证。
2. **overview=0 的 UI 占位**：初版探针要求看到"已回退"文案——错。06 册 L140 契约是"flag 关闭时**不注册页** → s-root.js showPage 回落通用占位"；`s-page-overview.js` 的"已回退"文案只在 render() 被调用时写，但 overview=0 时 render 根本不注册。正确断言是"无 KPI 复刻内容"，已修正。

### 2.2 一次偶发导航时序抖动
中间一轮 `evaluate: Uncaught`（页面未就绪即求值），加详细错误定位后复跑即过，两轮稳定 19/19——非代码缺陷。

---

## 3. 全量回归零退化

并行跑（端口各异 10235/10236/10242/10248/10252），flag 动的是 s-root.js 核心路由，必须全验：

| 阶段 | 脚本 | 结果 | 备注 |
|---|---|---|---|
| 1 | verify_phase1_regression.cjs | 16 项 verdict 中 12 真门禁全 true、0 false，其余 4 为数据字段（time/base/cases/errors） | 零退化 |
| 2 | verify_phase2_gates.cjs | 23 真门禁全 true；4 非布尔项为数据字段（regime_at_first_paint="冰点"、regime_pending=false 观察字段、console_exceptions=0、load_failures=0） | 零退化 |
| 3 | verify_phase3_gates.cjs | 首轮 21/29（8 项 bt 因首切 fetch 失败未就绪，`canvasWaitMs=-1`）；复跑 **29/29**（重切后 canvasWaitMs=3276） | 已知自动化时序噪声，非回归；zt/CLS/默认研报全程 true |
| 4a | verify_phase4_gates.cjs | PASS 13/13 | 零退化 |
| 4b | verify_phase4b_gates.cjs | PASS 17/17 | 零退化 |

阶段 3 首轮 8 false 为回测首切 fetch 失败（历史 15 册已归档同类："fetch 成功但 createChart 未就绪/重切一次即可"），复跑全绿坐实噪声，不是 flag 升级影响回测渲染。

---

## 4. 阶段 5 状态：前置项①收口，本体的不启动

- **已完成**：flag 兼容性升级（overview URL/localStorage 入口 + 默认语义不变 + 默认视图不变）。
- **未启动**：阶段 5 本体（默认路由切工作台 / `?view=terminal` 重定向 / 下线 `.t-*` / `style.css→style.legacy.css` + `s-final.css`）——按 21 册裁定，等 5 条门槛全绿再翻 flag。
- **仍挂账**：② 四档 CLS ≥3 次采样（WorkBuddy 侧，median 0.1471/worst 0.1905 未达标）+ legacy 面板位移治理（阶段 5「研报降级」时做）；③ 深链 7 天灰度；④ fatalHolder 7 天零触发；⑤ 人工 checklist。

代码侧阶段 4 之后的所有准备工作至此就绪，剩余门槛进入观测期。
