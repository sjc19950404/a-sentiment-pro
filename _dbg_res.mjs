import { readFileSync, writeFileSync } from "node:fs";
import { recommendPicks } from "./src/picks.js";

const day = (over = {}) => ({
  trade_date: '2026-09-30', hot: [], lhb: [], themes: {}, summary: {}, ...over,
});
const lhbRow = (code, name, netWan, over = {}) => ({
  code, name, net_buy_wan: netWan, buy_wan: Math.max(netWan, 0) * 2, sell_wan: Math.max(netWan, 0),
  close: 10, change_pct: 5, turnover_pct: 8, reason: '日涨幅偏离值达7%', is_range: false, ...over,
});

const d = day({
  hot: [
    lhbRow('600010', 'LianA', 90000, { change_pct: 10, close: 12, reason: 'X' }),
    lhbRow('600011', 'LianB', 90000, { change_pct: 10, close: 12, reason: 'X' }),
    lhbRow('600012', 'Shou',  90000, { change_pct: 10, close: 12, reason: 'X' }),
  ],
  themes: { X: 3 },
  summary: { main_theme: { name: 'X' }, zt_codes: ['600010', '600011', '600012'], zt_lb: { 600010: 3, 600011: 2, 600012: 1 } },
});
const r = recommendPicks(d, { topN: 2, emotionScore: 70, minProb: 0, firstBoardReserve: 1 });
writeFileSync("_dbg_res.json", JSON.stringify({
  picks: (r.picks||[]).map(p=>p.code+':'+p.streak),
  overflow: (r.overflow||[]).map(p=>p.code+':'+p.streak),
  rejected: (r.rejected||[]).map(p=>(p.code||'?')+':'+(p.reason||'')),
}, null, 2));
