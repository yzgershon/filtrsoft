/**
 * bun run seed:builds [--dry]
 *
 * A `Gaming PC <GPU>` prebuilt SKU for every gaming GPU in the catalog.
 * Idempotent.
 *
 * ── WHY THIS IS THE FIX FOR "CAN'T TELL" ON WHOLE DESKTOPS ─────────────────
 *
 * Yish, 2026-09-06: *"go through every listing thats a fully built pc or pc
 * parts and change them from cant tell."*
 *
 * A custom tower has no model number, so it cannot match a SKU the way a
 * MacBook does. `valueWholeBuild` handles that by looking up ONE row:
 *
 *     SELECT id FROM skus WHERE category='prebuilt' AND model = 'Gaming PC ' || <GPU>
 *
 * and returning null when it misses. Measured 2026-09-06: **50 of 64 GPUs had
 * no such row**, and 9 more had a row with zero comps — so only six GPUs in the
 * whole catalog could price a build. A listing reading "Gaming PC - Ryzen 7
 * 2700X / GTX 1660 Ti / 16GB RAM" had nothing to compare against and came back
 * INSUFFICIENT_DATA, which is 147 live listings.
 *
 * ⚠ THE MODEL STRING MUST BE EXACTLY `Gaming PC <gpu model>`. That lookup is a
 * literal equality on a built string, not a search — a SKU named "Gaming Desktop
 * RTX 3070" or "Gaming PC RTX3070" is invisible to it. The GPU half is read
 * straight out of the gpu SKUs so the two can never drift apart.
 *
 * ⚠ NOT EVERY GPU DESERVES ONE. A "Gaming PC GTX 480" search returns junk and
 * e-waste, and a comp set built from junk is worse than no comp set: the engine
 * would stop saying "I don't know" and start being confidently wrong, which is
 * the one thing this project refuses to do. Cut at the oldest cards people
 * still actually build and sell gaming machines around.
 */
import { db, now } from "../db/index.ts";

const dry = process.argv.includes("--dry");
const d = db();

/**
 * Anything older than these is e-waste in a tower, not a gaming PC. Named
 * explicitly rather than filtered by a number in the model, because "RTX 2000"
 * is a workstation card and "GTX 1650 Super" sorts nowhere near "GTX 980".
 */
const TOO_OLD = new Set([
  "GTX 260", "GTX 285", "GTX 480", "GTX 580", "GTX 660", "GTX 760",
  "GTX 960", "GTX 970", "GTX 980", "RX 460",
]);
/** Not gaming parts: mining cards and datacenter/workstation silicon. */
const NOT_GAMING = /CMP|Tesla|^RTX 2000$/i;

const gpus = (d.query(
  `SELECT model FROM skus WHERE category = 'gpu' ORDER BY model`,
).all() as Array<{ model: string }>)
  .map((r) => r.model)
  .filter((m) => !TOO_OLD.has(m) && !NOT_GAMING.test(m));

const existing = new Set(
  (d.query(`SELECT LOWER(model) m FROM skus WHERE category = 'prebuilt'`).all() as Array<{ m: string }>)
    .map((r) => r.m),
);

const insert = d.prepare(
  `INSERT INTO skus (category, brand, model, attributes, liquidity, created_at, source)
   VALUES ('prebuilt', 'Custom', $m, '{}', $l, $t, 'builds-catalog')`,
);

let added = 0, present = 0;
const names: string[] = [];
for (const gpu of gpus) {
  const model = `Gaming PC ${gpu}`;
  if (existing.has(model.toLowerCase())) { present++; continue; }
  /** Newer silicon moves faster, so it is worth re-crawling more often. */
  const liquidity = /RTX (40|50)|RX (79|90)/i.test(gpu) ? "hot" : "normal";
  if (!dry) insert.run({ $m: model, $l: liquidity, $t: now() });
  added++;
  names.push(model);
}

console.log(`${dry ? "[dry] " : ""}${added} added · ${present} already present · ${gpus.length} gaming GPUs considered`);
for (const n of names) console.log(`  + ${n}`);

const empty = d.query(
  `SELECT COUNT(*) n FROM skus s
   WHERE s.category = 'prebuilt' AND s.model LIKE 'Gaming PC %'
     AND NOT EXISTS (SELECT 1 FROM comps c WHERE c.sku_id = s.id)`,
).get() as { n: number };
console.log(`\n${empty.n} "Gaming PC" SKUs still have no comps.`);
console.log(`next: bun run ebay:comps --skus 16   (repeat until that reaches 0)`);
