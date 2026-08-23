/**
 * Run the full chain over stored listings: match -> signals -> verdict.
 *   bun run src/scripts/verdict.ts [--drive 15]
 */
import { db, now } from "../db/index.ts";
import { analyze } from "../signals/index.ts";
import { matchSku } from "../catalog/match.ts";
import { buildVerdict } from "../verdict/index.ts";
import type { RawListing } from "../types.ts";

const drive = Number(process.argv[process.argv.indexOf("--drive") + 1]) || 15;
const d = db();

const rows = d.query(
  `SELECT id, source, source_id, url, title, description, asking_price_cents,
          location, posted_at, updated_at, photo_count FROM listings ORDER BY id`,
).all() as any[];

const ins = d.query(
  `INSERT INTO verdicts (listing_id, engine_version, call, confidence, payload, created_at)
   VALUES ($lid,'0.2.0',$call,$conf,$p,$now)`,
);

const COLOR: Record<string, string> = {
  BUY: "\x1b[32m", FAIR: "\x1b[36m", PASS: "\x1b[33m",
  VERIFY: "\x1b[35m", RISK: "\x1b[31m",
  INSUFFICIENT_DATA: "\x1b[90m", OUT_OF_SCOPE: "\x1b[90m",
};

const tally: Record<string, number> = {};

for (const r of rows) {
  const l: RawListing = {
    source: r.source, sourceId: r.source_id, url: r.url, title: r.title ?? "",
    description: r.description ?? "", askingPriceCents: r.asking_price_cents,
    location: r.location, postedAt: r.posted_at, updatedAt: r.updated_at,
    photoUrls: new Array(r.photo_count ?? 0).fill(""), attributes: {}, raw: {},
  };

  const signals = analyze(l);
  const match = matchSku(l.title, l.description, signals.category);
  const v = buildVerdict({
    title: l.title, description: l.description,
    askingPriceCents: l.askingPriceCents, signals, match, driveMinutes: drive,
  });

  tally[v.call] = (tally[v.call] ?? 0) + 1;
  ins.run({ $lid: r.id, $call: v.call, $conf: v.confidence, $p: JSON.stringify(v), $now: now() });

  const ask = l.askingPriceCents ? `$${(l.askingPriceCents / 100).toLocaleString()}` : "—";
  console.log(`\n${COLOR[v.call] ?? ""}${v.call}\x1b[0m  ${l.title.slice(0, 58)}  ${ask}`);
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
}

console.log(`\n${rows.length} listings scored:`);
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
