// s-selftest.cdp.cjs
// 用法: node s-selftest.cdp.cjs "https://sjc19950404.github.io/a-sentiment-pro/?view=workbench"
// 前置: chrome --headless --remote-debugging-port=9222 --window-size=1440,900 about:blank
// 依赖: Node >= 22（全局 WebSocket），或 npm i ws 后把 new WebSocket 改为 require("ws")
//
// 说明：s-selftest.js 本身不自动调用 S.runSelfTest()（阶段 0 零副作用），故此处显式把
// 文件内容 + "S.runSelfTest()" 作为 Runtime.evaluate 的 expression，使完成值为报告 Promise，
// awaitPromise:true 即可拿到 report（避免 05 册旧稿「只 readFileSync 整文件当表达式」导致完成值 undefined、report && report.pass 恒 false）。
const http = require("http");
const fs = require("fs");
const path = require("path");

function getJSON(url) {
  return new Promise(function (resolve, reject) {
    http.get(url, function (res) {
      let data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function main() {
  const targetUrl = process.argv[2] || "https://sjc19950404.github.io/a-sentiment-pro/?view=workbench";
  const list = await getJSON("http://127.0.0.1:9222/json/list");
  const page = list.find(function (x) { return x.type === "page"; });
  if (!page) { throw new Error("no page target on port 9222"); }

  const WS = globalThis.WebSocket || require("ws");
  const ws = new WS(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.onmessage = function (ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  };

  function send(method, params) {
    return new Promise(function (resolve, reject) {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params: params || {} }));
    });
  }

  await new Promise(function (resolve, reject) {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: targetUrl });
  await new Promise(function (r) { setTimeout(r, 4000); });

  const file = fs.readFileSync(path.join(__dirname, "..", "s-selftest.js"), "utf8");
  const expression = file + "\nS.runSelfTest()";
  const result = await send("Runtime.evaluate", {
    expression: expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });

  if (result.exceptionDetails) {
    console.error("EVALUATE ERROR", JSON.stringify(result.exceptionDetails));
    process.exitCode = 1;
  } else {
    const report = result.result.value;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report && report.pass ? 0 : 1;
  }
  ws.close();
}

main().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
