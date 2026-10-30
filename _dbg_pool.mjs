import { readFileSync, writeFileSync } from "node:fs";
import { decodeArchive } from "./src/lhb_codec.js";
import { recommendPicks } from "./src/picks.js";

const arch = decodeArchive(JSON.parse(readFileSync("data/archive.json", "utf8")));
const days = (arch.all_days || []).filter(d => d && d.trade_date);
const TOP_N = 3;
const isFB = (p) => Number.isFinite(+p.streak) && +p.streak <= 1;

let legacyFB = 0, fbReserveFB = 0, daysChanged = 0, samples = [];
for (const d of days) {
  try {
    const r0 = recommendPicks(d, { topN: TOP_N, emotionScore: d.emotion?.value, minProb: 0 });
    const r1 = recommendPicks(d, { topN: TOP_N, emotionScore: d.emotion?.value, minProb: 0, firstBoardReserve: 1 });
    const a = r0.picks.filter(isFB).length, b = r1.picks.filter(isFB).length;
    legacyFB += a; fbReserveFB += b;
    if (a !== b) { daysChanged++; if (samples.length < 3) samples.push({ date: d.trade_date, legacyStreaks: r0.picks.map(p=>p.streak), fbStreaks: r1.picks.map(p=>p.streak) }); }
  } catch (e) {
    samples.push({ err: d.trade_date + ": " + (e && e.message) });
  }
}
writeFileSync("_dbg_pool_out.json", JSON.stringify({ TOP_N, legacyFB, fbReserveFB, daysChanged, totalDays: days.length, samples }, null, 2));
