/**
 * Re-score every stored listing through the engine.
 *   bun run verdict [--drive 15]
 */
import { db, now } from "../db/index.ts";
import { checkStored, ENGINE_VERSION } from "../engine/index.ts";

const drive = Number(process.argv[process.argv.indexOf("--drive") + 1]) || 15;
const d = db();
const ids = (d.query("SELECT id FROM listings ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);

const ins = d.query(
  `INSERT INTO verdicts (listing_id, engine_version, call, confidence, payload, created_at)
   VALUES ($lid,$v,$call,$conf,$p,$now)`,
);

const COLOR: Record<string, string> = {
  BUY: "\x1b[32m", FAIR: "\x1b[36m", PASS: "\x1b[33m",
  VERIFY: "\x1b[35m", RISK: "\x1b[31m",
  INSUFFICIENT_DATA: "\x1b[90m", OUT_OF_SCOPE: "\x1b[90m",
};
const tally: Record<string, number> = {};

for (const id of ids) {
  const { listing, signals, match, verdict: v } = checkStored(id, { driveMinutes: drive });
  tally[v.call] = (tally[v.call] ?? 0) + 1;
  ins.run({ $lid: id, $v: ENGINE_VERSION, $call: v.call, $conf: v.confidence, $p: JSON.stringify(v), $now: now() });

  const ask = listing.askingPriceCents ? `$${(listing.askingPriceCents / 100).toLocaleString()}` : "—";
  console.log(`\n${COLOR[v.call] ?? ""}${v.call}\x1b[0m  ${listing.title.slice(0, 58)}  ${ask}`);
  console.log(`  ${v.headline}`);
  console.log(`  \x1b[2m${v.reasoning}\x1b[0m`);
  console.log(
    `  \x1b[2mmatch: ${match.model ?? "unresolved"} (${match.method}/${match.confidence})` +
    `${match.liquidity ? ` · liquidity ${match.liquidity}` : ""}` +
    ` · comps ${v.valuation.compCount}\x1b[0m`,
  );
  if (Object.keys(match.attributes).length)
    console.log(`  \x1b[2mattrs: ${JSON.stringify(match.attributes)}\x1b[0m`);
  if (v.decidingUnknown) console.log(`  \x1b[2m→ deciding unknown: ${v.decidingUnknown}\x1b[0m`);
  void signals;
}

console.log(`\n${ids.length} listings scored:`);
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
