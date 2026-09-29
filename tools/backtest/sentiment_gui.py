#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sentiment V5.0 一体化分析平台（Tkinter GUI）
薄封装 sentiment_backtest.py 全部能力：选 CSV → 一键跑全流程（回测/网格/阈值/鲁棒性/图/日报）。
依赖：pandas numpy matplotlib（tkinter 为 Python 自带）。CLI 用法见 sentiment_backtest.py。
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
        root.title("Sentiment V5.0 一体化分析平台")
        root.geometry("780x580")

        self.factor_path = tk.StringVar()
        self.out_path = tk.StringVar(value=os.path.join(os.getcwd(), "reports"))
        self.alert_text = tk.StringVar()
        self.fast_var = tk.BooleanVar(value=False)
        self.rf_var = tk.StringVar(value="0")
        self._running = False

        tk.Label(root, text="Sentiment V5.0 情绪模型流水线", font=("Microsoft YaHei", 15, "bold")).pack(pady=8)

        def file_row(label, var, btn_text, cmd):
            f = tk.Frame(root)
            f.pack(pady=3, fill="x", padx=12)
            tk.Label(f, text=label, width=10, anchor="w").pack(side="left")
            tk.Entry(f, textvariable=var).pack(side="left", padx=5, fill="x", expand=True)
            tk.Button(f, text=btn_text, command=cmd, width=6).pack(side="left")

        file_row("因子CSV:", self.factor_path, "选择", self._select_factor)
        file_row("输出目录:", self.out_path, "选择", self._select_out)

        f3 = tk.Frame(root)
        f3.pack(pady=3, fill="x", padx=12)
        tk.Label(f3, text="风险标记:", width=10, anchor="w").pack(side="left")
        tk.Entry(f3, textvariable=self.alert_text).pack(side="left", padx=5, fill="x", expand=True)
        tk.Label(f3, text="无风险利率:", width=10, anchor="e").pack(side="left")
        tk.Entry(f3, textvariable=self.rf_var, width=6).pack(side="left", padx=5)
        tk.Checkbutton(f3, text="快速模式(跳过网格)", variable=self.fast_var).pack(side="left", padx=5)

        self.run_btn = tk.Button(root, text="一键运行全部流程", command=self.run_pipeline,
                                 bg="#2A9D8F", fg="white", font=("Microsoft YaHei", 12, "bold"))
        self.run_btn.pack(pady=10, ipadx=20)

        tk.Label(root, text="输出日志：", anchor="w").pack(fill="x", padx=12)
        self.log_box = tk.Text(root, height=14, state="disabled")
        self.log_box.pack(padx=12, pady=4, fill="both", expand=True)

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
        self._running = True
        self.run_btn.configure(state="disabled", text="运行中…")
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            fp = self.factor_path.get()
            out = self.out_path.get() or "reports"
            os.makedirs(out, exist_ok=True)
            sb.RF = float(self.rf_var.get() or 0)

            self.log("读取因子数据…")
            df = pd.read_csv(fp)
            df.columns = [str(c).strip().lower() for c in df.columns]
            missing = [c for c in ["date", "f1", "f2", "f3", "f4", "f5", "close"] if c not in df.columns]
            if missing:
                raise ValueError(f"因子 CSV 缺列: {missing}（Excel 模板导出即所需格式）")
            df["date"] = pd.to_datetime(df["date"])
            df = df.sort_values("date").reset_index(drop=True)
            self.log(f"  {len(df)} 个交易日，{df['date'].iloc[0]:%Y-%m-%d} ~ {df['date'].iloc[-1]:%Y-%m-%d}")

            self.log("基准绩效（V5 权重 0.25/0.25/0.20/0.20/0.10）…")
            base_p = sb.perf(df, sb.BASE_W)
            self.log(f"  年化 {base_p.annual:.2%}｜最大回撤 {base_p.max_dd:.2%}｜夏普 {base_p.sharpe}｜"
                     f"胜率 {base_p.win_rate:.2%}｜盈亏比 {base_p.profit_ratio}｜空仓占比 {base_p.empty_ratio:.2%}")

            if self.fast_var.get():
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

            self.log("汇总报告 / 图表 / 日报 …")
            sb.write_report(out, base_p, best_w, best_p, th, noise, split, regime)
            sb.plot_results(df, best_w, out)
            alerts = [a.strip() for a in self.alert_text.get().split(",") if a.strip()]
            rp = sb.generate_daily_report(df, best_w, alerts, out)

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
