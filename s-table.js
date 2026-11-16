/* ══════════════════════════════════════════════════════════════════════════
 * s-table.js — A 方案阶段 3：工作台大表治理（分页 / 虚拟列表）
 * ──────────────────────────────────────────────────────────────────────────
 * 硬边界（14 册 §3.3）：纯新增文件，不改 app.js / 研报结构 / 研报样式。
 * 门禁（14 册 §5 #2）：行数动态断言——N 从真实数据读，禁止写死 265/288；
 *   pages === Math.ceil(N/50)、每页 ≤50、末页余数正确、N>1000 才 data-mode="virtual"。
 *
 * 设计：S.Table.mount(host, opts) 把一个数据数组渲染成分页表；宿主提供列定义与行渲染。
 *   - opts.rows           数据数组（真实 N = rows.length，绝不硬编码）
 *   - opts.columns        [{key,label,priority,width}]，供 data-priority 响应式
 *   - opts.renderRow(row) → '<tr>...</tr>'（数值口径由调用方提供，本组件只排列）
 *   - opts.pageSize       默认 50
 *   - opts.virtualAt      默认 1000（N>此值 → virtual 模式）
 * 幂等：重复 mount 同一 host 不叠加监听（host 上记录实例，重挂载先移除）。
 * ══════════════════════════════════════════════════════════════════════════ */
(function (S) {
  'use strict';
  S = S || (window.S = window.S || {});

  const PAGE_SIZE = 50;
  const VIRTUAL_AT = 1000;
  const inst = new WeakMap(); // host → instance

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 模式判定：纯函数，便于门禁直接调用断言 ---------- */
  function plan(N, pageSize, virtualAt) {
    const ps = pageSize || PAGE_SIZE;
    const va = virtualAt || VIRTUAL_AT;
    const n = Math.max(0, N | 0);
    return {
      total: n,
      pageSize: ps,
      pages: n === 0 ? 0 : Math.ceil(n / ps),
      mode: n > va ? 'virtual' : 'pager',
      lastPageRows: n === 0 ? 0 : (n % ps === 0 ? ps : n % ps),
    };
  }

  function mount(host, opts) {
    if (!host) return null;
    const old = inst.get(host);
    if (old && typeof old.destroy === 'function') old.destroy();

    const rows = Array.isArray(opts.rows) ? opts.rows : [];
    const columns = Array.isArray(opts.columns) ? opts.columns : [];
    const pageSize = opts.pageSize || PAGE_SIZE;
    const virtualAt = opts.virtualAt || VIRTUAL_AT;
    const renderRow = typeof opts.renderRow === 'function' ? opts.renderRow : (() => '<tr><td>—</td></tr>');
    const p = plan(rows.length, pageSize, virtualAt);

    host.classList.add('s-table-wrap');
    host.setAttribute('data-total-rows', String(p.total));
    host.setAttribute('data-page-size', String(pageSize));
    host.setAttribute('data-mode', p.mode);
    host.setAttribute('aria-busy', 'false');

    const thead = columns.map((c) =>
      `<th scope="col" data-priority="${c.priority || 1}" style="--s-col-w:${c.width || 'auto'}">${esc(c.label)}</th>`
    ).join('');

    host.innerHTML =
      `<table class="s-table s-table--compact" aria-label="${esc(opts.label || '工作台数据明细')}">`
      + `<thead><tr>${thead}</tr></thead><tbody></tbody></table>`
      + `<div class="s-table-pager" role="group" aria-label="分页 navigation">`
      + `<button type="button" data-act="prev" class="s-chip">上一页</button>`
      + `<span class="s-table-pager__info"></span>`
      + `<button type="button" data-act="next" class="s-chip">下一页</button>`
      + `</div>`;

    const tbody = host.querySelector('tbody');
    const info = host.querySelector('.s-table-pager__info');
    let page = 0;

    function sliceFor(pg) {
      const start = pg * pageSize;
      return rows.slice(start, start + pageSize);
    }
    function draw() {
      tbody.innerHTML = sliceFor(page).map(renderRow).join('');
      const totalPages = p.pages;
      info.textContent = totalPages
        ? `第 ${page + 1} / ${totalPages} 页 · 共 ${p.total} 行`
        : `共 0 行`;
      const prev = host.querySelector('[data-act="prev"]');
      const next = host.querySelector('[data-act="next"]');
      if (prev) prev.disabled = page <= 0;
      if (next) next.disabled = page >= totalPages - 1;
    }
    function onClick(e) {
      const b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      if (b.dataset.act === 'prev' && page > 0) { page--; draw(); }
      if (b.dataset.act === 'next' && page < p.pages - 1) { page++; draw(); }
    }
    host.addEventListener('click', onClick);
    draw();

    const api = {
      host, rows, columns, pageCount: p.pages, mode: p.mode,
      plan: p,
      goto(pg) { if (pg >= 0 && pg < p.pages) { page = pg; draw(); } },
      destroy() {
        host.removeEventListener('click', onClick);
        if (inst.get(host) === api) inst.delete(host);
      },
    };
    inst.set(host, api);
    return api;
  }

  S.Table = { mount, plan, PAGE_SIZE, VIRTUAL_AT };
})(window.S = window.S || {});
