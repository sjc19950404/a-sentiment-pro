/*
 * s-selftest.js — A 方案阶段 0 自检脚本（设计 05 册 5.2.1 节）
 * 挂载到 window.S：S.runSelfTest() / S.collectCls()。
 * 注意：本文件只定义函数、不自动调用，故阶段 0（.s-scope 未挂载）下无任何行为/视觉副作用；
 * 调用方式（CDP / 控制台）：S.runSelfTest() 或 S.collectCls()。
 */
(function () {
  "use strict";

  // 把逗号分隔的选择器逐项加 .s-scope 前缀，避免「只有首项带前缀」导致的全文档误匹配
  function scoped(sel) {
    return sel.split(",").map(function (s) { return ".s-scope " + s.trim(); }).join(", ");
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function rgb(str) {
    var m = String(str || "").match(/rgba?\(([^)]+)\)/);
    if (!m) { return null; }
    var p = m[1].split(",").map(function (x) { return parseFloat(x); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function lum(c) {
    function f(v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function opaqueBg(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      var c = rgb(getComputedStyle(node).backgroundColor);
      if (c && c.a >= 0.99) { return c; }
      node = node.parentElement;
    }
    return rgb(getComputedStyle(document.documentElement).backgroundColor) || { r: 11, g: 14, b: 17, a: 1 };
  }

  function ratio(fg, bg) {
    var a = lum(fg);
    var b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function visible(el) {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }

  function path(el) {
    var out = [];
    var n = el;
    while (n && n.nodeType === 1 && out.length < 4) {
      out.unshift(n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/).slice(0, 2).join(".") : ""));
      n = n.parentElement;
    }
    return out.join(" > ");
  }

  function checkHorizontalOverflow() {
    var vw = document.documentElement.clientWidth;
    var bad = [];
    Array.prototype.forEach.call(document.querySelectorAll(".s-scope *"), function (el) {
      if (!visible(el)) { return; }
      var r = el.getBoundingClientRect();
      var ox = getComputedStyle(el).overflowX;
      var selfOverflow = el.scrollWidth > el.clientWidth + 1 && (ox === "visible" || ox === "auto" || ox === "scroll");
      if (r.right > vw + 1 || selfOverflow) {
        bad.push({ path: path(el), right: Math.round(r.right), vw: vw, scrollW: el.scrollWidth, clientW: el.clientWidth, overflowX: ox });
      }
    });
    return { count: bad.length, items: bad.slice(0, 20) };
  }

  function checkInnerScroll() {
    var allow = function (el) {
      return el.classList.contains("s-drawer__body") ||
        (el.classList.contains("s-table__viewport") && el.getAttribute("data-mode") === "virtual");
    };
    var all = [];
    Array.prototype.forEach.call(document.querySelectorAll(".s-scope *"), function (el) {
      if (!visible(el)) { return; }
      var oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 2) {
        all.push({ path: path(el), overflowY: oy, scrollH: el.scrollHeight, clientH: el.clientHeight, whitelisted: allow(el) });
      }
    });
    var violations = all.filter(function (x) { return !x.whitelisted; });
    return { count: all.length, whitelisted: all.length - violations.length, violations: violations.slice(0, 20) };
  }

  function collectCls() {
    return new Promise(function (resolve) {
      var sessions = {};
      var seen = {};
      var observer = null;
      function add(entry) {
        if (entry.hadRecentInput) { return; }
        var key = entry.startTime + ":" + (entry.sources || []).length;
        if (seen[key]) { return; }
        seen[key] = 1;
        var sid = entry.sessionId || "s0";
        if (!sessions[sid]) { sessions[sid] = { value: 0, last: 0, start: entry.startTime }; }
        var s = sessions[sid];
        if (entry.startTime - s.last > 1000 || entry.startTime - s.start > 5000) {
          s.value = 0;
        }
        s.value += entry.value;
        s.last = entry.startTime;
      }
      try {
        observer = new PerformanceObserver(function (list) {
          list.getEntries().forEach(add);
        });
        observer.observe({ type: "layout-shift", buffered: true });
      } catch (e) {
        resolve({ value: null, note: "layout-shift unsupported", target: 0.10, baseline: 0.174, pass: null, degraded: null });
        return;
      }
      setTimeout(function () {
        if (observer) { observer.disconnect(); }
        var max = 0;
        Object.keys(sessions).forEach(function (k) { max = Math.max(max, sessions[k].value); });
        resolve({
          value: Number(max.toFixed(4)),
          sessions: Object.keys(sessions).length,
          target: 0.10,
          baseline: 0.174,
          pass: max <= 0.10,
          degraded: max > 0.174
        });
      }, 5000);
    });
  }

  function checkTouchTargets() {
    var sel = "button, a[href], input, select, textarea, summary, [role='tab'], [role='button'], [tabindex='0']";
    var bad = [];
    var checked = 0;
    Array.prototype.forEach.call(document.querySelectorAll(scoped(sel)), function (el) {
      if (!visible(el)) { return; }
      if (el.closest(".s-prose__toc")) { return; }
      checked += 1;
      var r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) {
        bad.push({ path: path(el), w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    return { checked: checked, min: 44, violations: bad.length, items: bad.slice(0, 20) };
  }

  function checkContrast() {
    var sel = ".s-kpi__label, .s-kpi__value, .s-card__title, .s-section__title, .s-verdict__text, .s-btn, .s-table th, .s-table td, .s-ticker__item, .s-prose p, .s-badge";
    var bad = [];
    var checked = 0;
    var minRatio = 99;
    Array.prototype.forEach.call(document.querySelectorAll(scoped(sel)), function (el) {
      if (!visible(el)) { return; }
      var fg = rgb(getComputedStyle(el).color);
      if (!fg) { return; }
      var bg = opaqueBg(el);
      var r = ratio(fg, bg);
      var size = parseFloat(getComputedStyle(el).fontSize);
      var need = size >= 24 ? 3 : 4.5;
      checked += 1;
      minRatio = Math.min(minRatio, r);
      if (r < need) {
        bad.push({ path: path(el), ratio: Number(r.toFixed(2)), need: need, color: getComputedStyle(el).color });
      }
    });
    return { checked: checked, minRatio: Number(minRatio.toFixed(2)), violations: bad.length, items: bad.slice(0, 20) };
  }

  async function checkDrawerFocusTrap() {
    var out = { ok: false, steps: [] };
    var drawer = document.getElementById("sDrawer");
    var mask = document.getElementById("sDrawerMask");
    if (!drawer || !mask) {
      out.steps.push("drawer missing");
      return out;
    }
    if (!S || typeof S.openDrawer !== "function") {
      out.steps.push("S.openDrawer missing: static aria check only");
      out.ok = drawer.getAttribute("aria-modal") === "true" && drawer.getAttribute("role") === "dialog";
      return out;
    }
    var before = document.activeElement;
    S.openDrawer({
      title: "自检", sub: "自检", size: "md",
      render: function (body) { body.textContent = "自检内容"; }
    });
    await wait(80);
    out.steps.push("hidden after open = " + drawer.hidden);
    out.steps.push("aria-modal = " + drawer.getAttribute("aria-modal"));
    out.steps.push("focus inside = " + drawer.contains(document.activeElement));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(280);
    out.steps.push("closed by ESC = " + drawer.hidden);
    out.steps.push("focus restored = " + (document.activeElement === before));
    out.ok = !drawer.hidden === false && drawer.hidden === true && document.activeElement === before;
    return out;
  }

  function checkEmptyStates() {
    var list = [];
    Array.prototype.forEach.call(document.querySelectorAll(".s-scope .s-empty"), function (el) {
      if (!visible(el)) { return; }
      var r = el.getBoundingClientRect();
      list.push({
        path: path(el),
        hasTitle: !!el.querySelector(".s-empty__title"),
        hasHint: !!el.querySelector(".s-empty__hint"),
        height: Math.round(r.height),
        oversized: r.height > 320
      });
    });
    return {
      count: list.length,
      missingTitle: list.filter(function (x) { return !x.hasTitle; }).length,
      oversized: list.filter(function (x) { return x.oversized; }).length,
      items: list.slice(0, 20)
    };
  }

  function checkSkeletonSwap() {
    var wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;top:0;left:0;width:600px;contain:layout;visibility:hidden;pointer-events:none;z-index:-1";
    var host = document.createElement("div");
    host.className = "s-card__body";
    var anchor = document.createElement("div");
    anchor.textContent = "ANCHOR";
    var skel = document.createElement("span");
    skel.className = "s-skeleton s-skeleton--kpi";
    skel.setAttribute("data-skeleton", "");
    var real = document.createElement("div");
    real.className = "s-kpi";
    real.textContent = "38.4";
    host.appendChild(skel);
    wrap.appendChild(host);
    wrap.appendChild(anchor);
    document.body.appendChild(wrap);

    var t0 = anchor.getBoundingClientRect().top;
    host.insertBefore(real, skel);
    var t1 = anchor.getBoundingClientRect().top;
    host.removeChild(skel);
    var t2 = anchor.getBoundingClientRect().top;
    var skelH = skel.getBoundingClientRect().height;
    var realH = real.getBoundingClientRect().height;
    document.body.removeChild(wrap);

    var d1 = Math.abs(t1 - t0);
    var d2 = Math.abs(t2 - t0);
    return {
      skeletonH: Math.round(skelH), realH: Math.round(realH),
      duringInsert: Number(d1.toFixed(2)), afterReplace: Number(d2.toFixed(2)),
      maxShift: Number(Math.max(d1, d2).toFixed(2)),
      pass: Math.max(d1, d2) < 1 && Math.abs(skelH - realH) < 1
    };
  }

  S.runSelfTest = async function runSelfTest() {
    var horizontal = checkHorizontalOverflow();
    var innerScroll = checkInnerScroll();
    var touch = checkTouchTargets();
    var contrast = checkContrast();
    var empty = checkEmptyStates();
    var skeleton = checkSkeletonSwap();
    var clsP = collectCls();
    var drawer = await checkDrawerFocusTrap();
    var cls = await clsP;

    var report = {
      stamp: new Date().toISOString(),
      viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight, dpr: window.devicePixelRatio },
      horizontalOverflow: horizontal,
      innerScrollContainers: innerScroll,
      cls: cls,
      touchTargets: touch,
      contrast: contrast,
      drawerFocusTrap: drawer,
      emptyStates: empty,
      skeletonSwap: skeleton
    };

    report.pass =
      horizontal.count === 0 &&
      innerScroll.violations.length === 0 &&
      (cls.pass === true || cls.pass === null) &&
      touch.violations === 0 &&
      contrast.violations === 0 &&
      drawer.ok === true &&
      empty.missingTitle === 0 &&
      empty.oversized === 0 &&
      skeleton.pass === true;

    if (window.console && console.table) {
      console.table([
        { check: "横向溢出元素数", value: horizontal.count, pass: horizontal.count === 0 },
        { check: "盒内滚动容器数", value: innerScroll.count, pass: innerScroll.violations.length === 0 },
        { check: "CLS", value: cls.value, pass: cls.pass },
        { check: "触控目标违规", value: touch.violations, pass: touch.violations === 0 },
        { check: "对比度违规", value: contrast.violations, pass: contrast.violations === 0 },
        { check: "抽屉焦点陷阱", value: drawer.steps.join(" | "), pass: drawer.ok },
        { check: "空状态缺标题/超高", value: empty.missingTitle + "/" + empty.oversized, pass: empty.missingTitle === 0 && empty.oversized === 0 },
        { check: "骨架替换位移(px)", value: skeleton.maxShift, pass: skeleton.pass }
      ]);
    }
    console.log("[S.selfTest] PASS =", report.pass, report);
    return report;
  };

  // 导出 collectCls（05 册 5.2.1 的 8 项表引用它，但原稿未挂载到 S；阶段 1+ 的 CLS 门禁依赖 S.collectCls）
  S.collectCls = collectCls;
}(window.S = window.S || {}));
