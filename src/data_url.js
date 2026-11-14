// 数据档 URL 改道（浏览器 / Node 通用纯函数，零 IO）
//
// 唯一口径与 app.js / terminal.js 内联的 durl 一致：仅 github.io 域名 + 配置了
// window.ASENT_CONFIG.dataOrigin 时，把 data/* 改道到 R2 快 CDN；Pi 本机 / localhost
// / Node 侧返回原相对路径（零回归）。
//
// 为什么需要独立模块：app.js 是经典脚本不能 import，故自带一份 durl；而 paper_ui.js、
// intraday_sampler.js 是 ESM、且已被打包进 bundle.js，它们原先是**裸取数调用（相对路径）**，
// 没走改道——2026-11-14 Lighthouse 复测发现首屏最重的几个档（paper_universe 147KB /
// ztpool_history 95KB / archive-recent 45KB）仍落在 github.io 慢链，正是关键路径 29s 的头部。
// 抽成纯函数供 ESM 侧复用，避免第二套口径漂移（项目纪律：规则只有一个出处）。
//
// 注意：ASENT_CONFIG 由 index.html <head> 的 #asent-config 哨兵在构建期同步注入
// （scripts/inject_config.mjs），故本函数在首屏第一个 fetch 发出时即能读到 dataOrigin。

export const durl = (p) => {
  const origin = (typeof window !== 'undefined' && window.ASENT_CONFIG && window.ASENT_CONFIG.dataOrigin) || '';
  if (!origin || typeof location === 'undefined' || !/(^|\.)github\.io$/.test(location.hostname)) return p;
  return origin.replace(/\/+$/, '') + '/' + String(p).replace(/^\.?\//, '');
};

// dget：数据档取数，自动经 durl() 改道；默认 no-store（每次向服务端校验最新）。
export const dget = (p, opts) => fetch(durl(p), opts || { cache: 'no-store' });
