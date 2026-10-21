import { readFileSync } from 'fs';
import { pushReports } from '../src/ai_report_push.js';

const archive = JSON.parse(readFileSync('data/archive-recent.json', 'utf-8'));
const intraday = JSON.parse(readFileSync('data/intraday.json', 'utf-8'));

const days = archive.days[0] || {};
const factors = days.factors || {};
const hotRows = intraday.hot?.rows || [];

// 核心对齐：s_net 为百分比整数(如100)，模板 pct() 需小数(如1.0)
const pnlDailyVal = factors.s_net != null ? parseFloat(factors.s_net) / 100 : null;
const btPctVal = days.bt_pct != null ? parseFloat(days.bt_pct) : null;
const maxLbVal = days.max_lb != null ? parseInt(days.max_lb) : null;

const finalReport = {
  report_type: 'intraday',
  date: intraday.tradeDate,
  generated_at: intraday.capturedAtBJ,
  trigger: 'schedule',
  payload: {
    date: intraday.tradeDate,
    pnl_daily: pnlDailyVal,
    pnl_cumulative: null,
    close_drawdown: null,
    
    simulation_stock: {
      sentiment_cycle: {
        highest_chain: maxLbVal,
        broken_limit_ratio: btPctVal
      },
      candidate_pool: hotRows.map((row, i) => ({
        code: row.code,
        name: row.name,
        score: i + 1,
        selection_reason: row.reason || '全市场快照涨幅榜',
        themes: [row.name],
        intraday_chg: row.change_pct,
        fundamentals: { pe: row.pe_ttm, pb: row.pb }
      }))
    }
  }
};

console.log('[ai-report-push] Fused data: PnL:', finalReport.payload.pnl_daily, 'MaxLB:', maxLbVal, 'Stocks:', hotRows.length);
const { pushed, skipped } = await pushReports([finalReport], { now: new Date() });
console.log('[ai-report-push] Push complete. Pushed:', pushed, 'Skipped:', skipped);
