// 浏览器 ESM 模块统一打包入口 —— scripts/build_bundle.mjs 将其与整棵依赖树打包为 bundle.js。
//
// 原先 index.html 用 10 段 <script type="module"> 各自 import 一个 src/*.js（整棵依赖树在
// github.io 上逐个请求 → 慢链瀑布，首屏 37s）。现收敛为单个 bundle.js，一次请求拉完。
// 各模块仍按原语义挂到 window 并 dispatch ready 事件，app.js 消费方式不变。
//
// config.json 由 index.html 的独立桥 + 本入口桩（按文档根 fetch）负责，不在此处重复加载。

import * as ReportExport from './report.js';
window.ReportExport = ReportExport;
window.dispatchEvent(new Event('report-export-ready'));

import * as ReportAudit from './report_audit.js';
window.ReportAudit = ReportAudit;
window.dispatchEvent(new Event('report-audit-ready'));

import * as Seats from './seats.js';
window.Seats = Seats;
window.dispatchEvent(new Event('seats-ready'));

import * as PaperReview from './paper_review.js';
window.PaperReview = PaperReview;
window.dispatchEvent(new Event('paper-review-ready'));

import * as ReportCardLive from './report_card_live.js';
window.ReportCardLive = ReportCardLive;
window.dispatchEvent(new Event('report-card-live-ready'));

import * as DatasetExport from './dataset.js';
window.DatasetExport = DatasetExport;
window.dispatchEvent(new Event('dataset-export-ready'));

import * as ErrorBoundary from './error_boundary.js';
window.ErrorBoundary = ErrorBoundary;
window.dispatchEvent(new Event('error-boundary-ready'));

import * as ValidateExternal from './validate_snapshot.js';
window.ValidateExternal = ValidateExternal;
window.dispatchEvent(new Event('validate-external-ready'));

// 以下两个为「自激活」模块：不按 window 名被 app.js 消费，但须被 import 以触发副作用：
import '../paper_ui.js';            // 模拟交易台面：自挂 window.__paperSnapshot；配置由桩按文档根 fetch
import './intraday_sampler.js';     // 自挂 window.__intradayLive 并发布 'intraday-live-update'
