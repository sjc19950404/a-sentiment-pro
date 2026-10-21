import { readFileSync } from 'fs';
import { renderPushText } from '../src/ai_report_push.js';

const archive = JSON.parse(readFileSync('data/archive-recent.json', 'utf-8'));
const intraday = JSON.parse(readFileSync('data/intraday.json', 'utf-8'));

const days = archive.days[0] || {};
const factors = days.factors || {};
const hotRows = intraday.hot?.rows || [];

// A 组：原样（pnl 用整数 100）
const repA = {
  report_type: 'intraday', date: intraday.tradeDate, trigger: 'schedule', urgent: true,
  payload: {
    date: intraday.tradeDate,
    pnl_daily: factors.s_net ?? null,
    pnl_cumulative: null, close_drawdown: null,
    simulation_stock: {
      sentiment_cycle: { highest_chain: days.max_lb ?? null, broken_limit_ratio: days.bt_pct ?? null, breadth: factors.s_brd ?? null, position: factors.s_pos ?? null },
      candidate_pool: hotRows.slice(0,5).map((r,i)=>({ code:r.code, name:r.name, score:i+1, selection_reason:'x', themes:[r.name], intraday_chg:r.change_pct, fundamentals:{pe:r.pe_ttm,pb:r.pb} }))
    }
  }
};

// B 组：pnl 改用小数 1.0，对照 pct() 到底吃哪种
const repB = JSON.parse(JSON.stringify(repA));
repB.payload.pnl_daily = 1.0;

for (const [tag, rep] of [['A(整数100)', repA], ['B(小数1.0)', repB]]) {
  console.log(`\n===== 渲染结果 ${tag} =====`);
  let txt;
  try { txt = renderPushText(rep); } catch (e) { txt = 'RENDER ERROR: ' + e.message; }
  console.log(typeof txt === 'string' ? txt : JSON.stringify(txt));
}
