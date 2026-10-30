import { readFileSync, writeFileSync } from "node:fs";
let s = readFileSync("scripts/paper_replay.mjs", "utf8");
if (s.includes("global.__bf")) {
  s = s.replace(
    "    fills += r.fills.length;\n    if (!global.__bf) global.__bf = 0;\n    for (const t of r.fills) if (t.side === 'buy' && t.status === 'filled') global.__bf++;\n",
    "    fills += r.fills.length;\n"
  );
  s = s.replace(
    "  if (collectTrades) res.trades = trades;\n  console.error('DEBUG buyFills=', global.__bf, 'totalFills=', fills);\n  return res;\n",
    "  if (collectTrades) res.trades = trades;\n  return res;\n"
  );
  writeFileSync("scripts/paper_replay.mjs", s);
  console.log("[ok] 移除调试桩");
} else {
  console.log("[skip] 无调试桩");
}
