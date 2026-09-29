#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sentiment V5.0 一体化分析平台（Tkinter GUI）
薄封装 sentiment_backtest.py 全部能力：选 CSV → 一键跑全流程（回测/网格/阈值/鲁棒性/图/日报/Excel）。
参数调参面板：w1~w5 权重 + 四档阈值（开仓/减仓/清仓/过热）界面直调，无需改源码；
勾选"自定义权重"即按面板权重回测（跳过 3876 组网格）；权重总和不等于 1 弹窗确认。
依赖：pandas numpy matplotlib openpyxl（tkinter 为 Python 自带）。CLI 用法见 sentiment_backtest.py。
用法：python sentiment_gui.py"""
import os
import threading
import tkinter as tk
from tkinter import filedialog, messagebox

import pandas as pd

import sentiment_backtest as sb


class SentimentGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("Sentiment V5.0 一体化分析平台｜参数调优版")
        root.geometry("820x640")

        self.factor_path = tk.StringVar()
        self.out_path = tk.StringVar(value=os.path.join(os.getcwd(), "reports"))
        self.alert_text = tk.StringVar()
        self.fast_var = tk.BooleanVar(value=False)
        self.custom_w_var = tk.BooleanVar(value=False)
        self.rf_var = tk.StringVar(value="0")
        self._running = False

        # 权重与阈值（默认 V5 基准，界面可覆盖）
        self.w_vars = [tk.StringVar(value=str(v)) for v in sb.BASE_W]
        self.th_vars = {k: tk.StringVar(value=str(v))
                        for k, v in (("lo", sb.BASE_LO), ("hi", sb.BASE_HI),
                                     ("panic", sb.PANIC), ("overheat", sb.OVERHEAT))}
        # 风控与滚动验证
        self.max_pos_var = tk.StringVar(value="1.0")
        self.stop_loss_var = tk.StringVar(value="0")
        self.roll_var = tk.BooleanVar(value=False)
        self.roll_refit_var = tk.BooleanVar(value=False)
        self.train_win_var = tk.StringVar(value="252")
        self.test_win_var = tk.StringVar(value="63")

        tk.Label(root, text="Sentiment V5.0 情绪模型流水线【参数调优版】",
                 font=("Microsoft YaHei", 15, "bold")).pack(pady=6)

        # ── 参数面板 ──
        panel = tk.LabelFrame(root, text="权重与阈值设置（权重总和建议 = 1；调阈值即调仓规则）")
        panel.pack(padx=12, pady=4, fill="x")
        fw = tk.Frame(panel)
        fw.pack(fill="x", padx=6, pady=2)
        labels = ["w1 情绪", "w2 盈亏", "w3 广度", "w4 题材", "w5 主线"]
        for i, (lab, var) in enumerate(zip(labels, self.w_vars)):
            tk.Label(fw, text=lab).grid(row=0, column=i * 2, padx=(10, 1))
            tk.Entry(fw, textvariable=var, width=6).grid(row=0, column=i * 2 + 1, pady=2)
        ft = tk.Frame(panel)
        ft.pack(fill="x", padx=6, pady=2)
        th_labels = [("lo", "开仓阈值 ≥"), ("hi", "减仓阈值 <"), ("panic", "清仓阈值 ≤"),
                     ("overheat", "过热阈值 ≥")]
        for i, (k, lab) in enumerate(th_labels):
            tk.Label(ft, text=lab).grid(row=0, column=i * 2, padx=(10, 1))
            tk.Entry(ft, textvariable=self.th_vars[k], width=6).grid(row=0, column=i * 2 + 1, pady=2)
        tk.Button(ft, text="恢复默认", command=self._reset_params).grid(row=0, column=9, padx=10)
        fr = tk.Frame(panel)
        fr.pack(fill="x", padx=6, pady=2)
        for c, (lab, var, w) in enumerate([("最大仓位", self.max_pos_var, 5),
                                           ("单笔止损", self.stop_loss_var, 6)]):
            tk.Label(fr, text=lab).grid(row=0, column=c * 2, padx=(10, 1))
            tk.Entry(fr, textvariable=var, width=w).grid(row=0, column=c * 2 + 1, pady=2)
        tk.Checkbutton(fr, text="滚动样本外验证", variable=self.roll_var).grid(row=0, column=4, padx=(16, 1))
        tk.Label(fr, text="训练窗").grid(row=0, column=5, padx=(4, 1))
        tk.Entry(fr, textvariable=self.train_win_var, width=5).grid(row=0, column=6)
        tk.Label(fr, text="测试窗").grid(row=0, column=7, padx=(4, 1))
        tk.Entry(fr, textvariable=self.test_win_var, width=5).grid(row=0, column=8)
        tk.Checkbutton(fr, text="逐窗重寻优", variable=self.roll_refit_var).grid(row=0, column=9, padx=(8, 1))

        def file_row(label, var, cmd):
            f = tk.Frame(root)
            f.pack(pady=2, fill="x", padx=12)
            tk.Label(f, text=label, width=10, anchor="w").pack(side="left")
            tk.Entry(f, textvariable=var).pack(side="left", padx=5, fill="x", expand=True)
            tk.Button(f, text="选择", command=cmd, width=6).pack(side="left")

        file_row("因子CSV:", self.factor_path, self._select_factor)
        file_row("输出目录:", self.out_path, self._select_out)

        f3 = tk.Frame(root)
        f3.pack(pady=2, fill="x", padx=12)
        tk.Label(f3, text="风险标记:", width=10, anchor="w").pack(side="left")
        tk.Entry(f3, textvariable=self.alert_text).pack(side="left", padx=5, fill="x", expand=True)
        tk.Label(f3, text="无风险利率:", width=10, anchor="e").pack(side="left")
        tk.Entry(f3, textvariable=self.rf_var, width=6).pack(side="left", padx=5)
        tk.Checkbutton(f3, text="快速模式(跳过网格)", variable=self.fast_var).pack(side="left", padx=5)
        tk.Checkbutton(f3, text="自定义权重(跳过网格)", variable=self.custom_w_var).pack(side="left", padx=5)

        self.run_btn = tk.Button(root, text="一键运行全部流程", command=self.run_pipeline,
                                 bg="#2A9D8F", fg="white", font=("Microsoft YaHei", 12, "bold"))
        self.run_btn.pack(pady=8, ipadx=20)

        tk.Label(root, text="输出日志：", anchor="w").pack(fill="x", padx=12)
        self.log_box = tk.Text(root, height=13, state="disabled")
        self.log_box.pack(padx=12, pady=4, fill="both", expand=True)

    # ── 参数面板 ──
    def _reset_params(self):
        for var, v in zip(self.w_vars, sb.BASE_W):
            var.set(str(v))
        for k, v in (("lo", sb.BASE_LO), ("hi", sb.BASE_HI),
                     ("panic", sb.PANIC), ("overheat", sb.OVERHEAT)):
            self.th_vars[k].set(str(v))

    def _read_params(self):
        """读面板参数并校验。返回 (w或None, th_kw, roll_kw)；非法值抛 ValueError。"""
        w = [float(v.get()) for v in self.w_vars]
        th = {k: float(v.get()) for k, v in self.th_vars.items()}
        for k, v in th.items():
            if not 0 <= v <= 100:
                raise ValueError(f"阈值 {k}={v} 超出 0~100")
        if not (th["panic"] < th["hi"] < th["lo"] < th["overheat"]):
            raise ValueError(f"阈值需满足 清仓{th['panic']:g} < 减仓{th['hi']:g} < 开仓{th['lo']:g} < 过热{th['overheat']:g}")
        max_pos = float(self.max_pos_var.get())
        if not 0 < max_pos <= 1:
            raise ValueError(f"最大仓位 {max_pos} 须在 (0,1]")
        stop_loss = float(self.stop_loss_var.get())
        if stop_loss > 0:
            raise ValueError("单笔止损须 ≤ 0（负数启用，如 -0.08；0 关闭）")
        th_kw = dict(hi=th["hi"], lo=th["lo"], panic=th["panic"], overheat=th["overheat"],
                     max_pos=max_pos, stop_loss=stop_loss)
        roll_kw = None
        if self.roll_var.get():
            try:
                tw, ew = int(self.train_win_var.get()), int(self.test_win_var.get())
            except ValueError:
                raise ValueError("滚动窗口须为整数交易日")
            if tw < 60 or ew < 10:
                raise ValueError("滚动窗口过小：训练窗≥60、测试窗≥10")
            roll_kw = dict(train_window=tw, test_window=ew, refit=self.roll_refit_var.get())
        use_custom = self.custom_w_var.get()
        if abs(sum(w) - 1) > 0.01:
            if not messagebox.askyesno("权重警告",
                                       f"权重总和 = {sum(w):.3f}，不等于 1。\n"
                                       f"（综合分会整体缩放，信号可能失真）确认继续？"):
                raise ValueError("用户取消：权重总和校验未通过")
        if not use_custom and abs(sum(w) - 1) <= 1e-9 and tuple(w) != tuple(sb.BASE_W):
            # 未勾自定义但改了权重 → 提示需要勾选才生效
            if not messagebox.askyesno("提示", "已修改权重但未勾选「自定义权重」。\n"
                                              "确定仍使用 V5 基准权重跑网格扫描吗？"):
                raise ValueError("用户取消：请勾选「自定义权重」后重试")
        return (tuple(w) if use_custom else None), th_kw, roll_kw

    # ── 文件选择 ──
    def _select_factor(self):
        p = filedialog.askopenfilename(filetypes=[("CSV", "*.csv"), ("全部文件", "*.*")])
        if p:
            self.factor_path.set(p)

    def _select_out(self):
        p = filedialog.askdirectory()
        if p:
            self.out_path.set(p)

    # ── 线程安全日志 ──
    def log(self, msg):
        self.root.after(0, self._append_log, msg)

    def _append_log(self, msg):
        self.log_box.configure(state="normal")
        self.log_box.insert(tk.END, msg + "\n")
        self.log_box.see(tk.END)
        self.log_box.configure(state="disabled")

    # ── 主流程 ──
    def run_pipeline(self):
        if self._running:
            return
        if not self.factor_path.get():
            messagebox.showerror("错误", "请先选择因子 CSV（date,f1..f5,close）")
            return
        try:
            self.w_custom, self.th_kw, self.roll_kw = self._read_params()
        except ValueError as e:
            if str(e):
                messagebox.showinfo("未运行", str(e))
            return
        except Exception as e:  # noqa: BLE001
            messagebox.showerror("参数错误", f"权重/阈值须为数字：{e}")
            return
        self._running = True
        self.run_btn.configure(state="disabled", text="运行中…")
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            fp = self.factor_path.get()
            out = self.out_path.get() or "reports"
            os.makedirs(out, exist_ok=True)
            sb.RF = float(self.rf_var.get() or 0)
            w_custom, th_kw, roll_kw = self.w_custom, self.th_kw, self.roll_kw
            if th_kw["max_pos"] < 1 or th_kw["stop_loss"] < 0:
                self.log(f"风控：最大仓位 {th_kw['max_pos']:g}｜单笔止损 {th_kw['stop_loss']:g}"
                         + ("（关闭）" if th_kw["stop_loss"] == 0 else ""))

            self.log("读取因子数据…")
            df = pd.read_csv(fp)
            df.columns = [str(c).strip().lower() for c in df.columns]
            missing = [c for c in ["date", "f1", "f2", "f3", "f4", "f5", "close"] if c not in df.columns]
            if missing:
                raise ValueError(f"因子 CSV 缺列: {missing}（Excel 模板导出即所需格式）")
            df["date"] = pd.to_datetime(df["date"])
            df = df.sort_values("date").reset_index(drop=True)
            self.log(f"  {len(df)} 个交易日，{df['date'].iloc[0]:%Y-%m-%d} ~ {df['date'].iloc[-1]:%Y-%m-%d}")

            base_w = w_custom or sb.BASE_W
            if w_custom:
                self.log(f"自定义权重回测 w={w_custom}（跳过网格）…")
            else:
                self.log("基准绩效（V5 权重 0.25/0.25/0.20/0.20/0.10）…")
            base_p = sb.perf(df, base_w, **th_kw)
            self.log(f"  年化 {base_p.annual:.2%}｜最大回撤 {base_p.max_dd:.2%}｜夏普 {base_p.sharpe}｜"
                     f"Calmar {base_p.calmar}｜Sortino {base_p.sortino}｜最大连亏 {base_p.max_consec_loss}天")
            self.log(f"  胜率 {base_p.win_rate:.2%}｜盈亏比 {base_p.profit_ratio}｜空仓占比 {base_p.empty_ratio:.2%}")

            if w_custom is not None:
                best_w, best_p = w_custom, base_p
            elif self.fast_var.get():
                best_w, best_p = sb.BASE_W, base_p
            else:
                self.log("权重网格扫描（3876 组）…")
                scan = sb.grid_search(df, verbose=False)
                scan.to_csv(os.path.join(out, "weights_scan.csv"), index=False, encoding="utf-8-sig")
                bw = scan.iloc[0]
                best_w = (bw.w1, bw.w2, bw.w3, bw.w4, bw.w5)
                best_p = sb.Perf(**{k: bw[k] for k in sb.Perf.__dataclass_fields__})
                self.log(f"  最优权重 {best_w}｜回撤 {best_p.max_dd:.2%}｜夏普 {best_p.sharpe}")

            self.log("阈值扫描 / 鲁棒性 / 失效场景 …")
            th = sb.threshold_scan(df, best_w)
            th.to_csv(os.path.join(out, "threshold_scan.csv"), index=False, encoding="utf-8-sig")
            noise = sb.noise_test(df, best_w)
            split = sb.split_test(df, best_w)
            regime = sb.regime_report(df, best_w)
            regime.to_csv(os.path.join(out, "regime.csv"), index=False, encoding="utf-8-sig")
            self.log(f"  噪声扰动夏普衰减 {noise['sharpe_decay_pct']}%｜回撤恶化 {noise['dd_mean_delta']}")
            for _, r in regime.iterrows():
                self.log(f"  {r['regime']:>7}: {r['days']}天 总收益{r['total_ret']:+.2%} 持仓踩错率{r['wrong_rate']:.2%}")

            self.log("汇总报告 / 图表 / 日报 / Excel …")
            roll = None
            if roll_kw:
                self.log(f"滚动样本外验证（train={roll_kw['train_window']} test={roll_kw['test_window']}"
                         f" refit={roll_kw['refit']}）…")
                roll = sb.rolling_test(df, best_w, **roll_kw, **th_kw)
                roll.attrs.update(train_window=roll_kw["train_window"],
                                  test_window=roll_kw["test_window"], refit=roll_kw["refit"])
                roll.to_csv(os.path.join(out, "rolling_test.csv"), index=False, encoding="utf-8-sig")
                rs = sb.rolling_summary(roll)
                self.log(f"  {len(roll)} 段样本外：夏普均值 {rs['sharpe_mean']}｜最差段回撤 {rs['dd_worst']:.2%}"
                         f"｜正收益段 {rs['win_seg_pct']:.0%}")
            sb.write_report(out, base_p, best_w, best_p, th, noise, split, regime,
                            roll=roll, **th_kw)
            sb.plot_results(df, best_w, out, **th_kw)
            alerts = [a.strip() for a in self.alert_text.get().split(",") if a.strip()]
            rp = sb.generate_daily_report(df, best_w, alerts, out)
            xlsx = sb.export_excel(df, best_w, out, **th_kw, rf=sb.RF)
            self.log(f"  Excel 三表已导出 → {os.path.basename(xlsx)}")

            last_sc = float(sb.score(df, best_w).iloc[-1])
            risk, signal = sb.risk_tier(last_sc)
            warn = sb.model_fail_warning(last_sc, alerts)
            self.log(f"末日({df['date'].iloc[-1]:%Y-%m-%d}) 综合分 {last_sc:.1f}｜{risk}")
            self.log(f"  {signal}")
            self.log(f"  {warn['flag']}")
            self.log(f"✅ 全部完成，输出目录：{os.path.abspath(out)}")
            self.root.after(0, lambda: messagebox.showinfo("完成", f"流水线执行完毕！\n输出：{os.path.abspath(out)}"))
        except Exception as e:  # noqa: BLE001
            self.log(f"❌ ERROR: {e}")
            self.root.after(0, lambda: messagebox.showerror("运行异常", str(e)))
        finally:
            self._running = False
            self.root.after(0, self._reset_btn)

    def _reset_btn(self):
        self.run_btn.configure(state="normal", text="一键运行全部流程")


def main():
    root = tk.Tk()
    SentimentGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
