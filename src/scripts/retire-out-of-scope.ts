/**
 * bun run retire:oos [--dry] [--yes]
 *
 * Retire every live listing the product-type classifier does not call `tech`.
 *
 * Yish, 2026-09-06: *"get rid of the 22 furniture completely"*.
 *
 * ── WHY IT ASKS THE CLASSIFIER INSTEAD OF MATCHING TITLES ───────────────────
 *
 * A regex for `desk|chair|stand|bag` finds the furniture, and it also finds
 * **"Hp Gaming computer with Brand new gaming monitor microphone and mount."**,
 * which is a real gaming PC that happens to mention a mount. Deleting a real
 * listing to clean up a fake one is a bad trade, and it is the trade any
 * keyword sweep makes eventually.
 *
 * `resolveProductType` already decides this for the crawler's grammar gate. The
 * only reason these rows are in the feed is that the gate had a bug — a tech
 * word glued to a furniture word ("computer desk") read as the product rather
 * than as an adjective. That is fixed; this clears what got in meanwhile, and
 * it uses the same judgement so the two can never disagree.
 *
 * ⚠ DELISTED, NOT DELETED, AND THE ROW STAYING IS THE POINT. The crawlers skip
 * a `source_id` they have already seen — including a delisted one — so the row
 * is what stops the same desk being re-added on the next Craigslist sweep. A
 * hard DELETE would clear the feed today and let every one of them back in
 * tonight.
 */
import { db, now } from "../db/index.ts";
import { resolveProductType } from "../signals/product-type.ts";

const dry = process.argv.includes("--dry");
/**
 * ⚠ FURNITURE AND ACCESSORIES ARE SEPARATE CALLS, SO THEY ARE SEPARATE RUNS.
 *
 * Yish authorised the furniture. Accessories are 869 rows — every mouse,
 * charger, webcam and cable lock in the feed — and clearing that many listings
 * on the strength of an instruction about desks would be reading a lot into a
 * short sentence. `--only furniture` is the default for exactly that reason.
 */
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? process.argv[onlyArg + 1] : "furniture";
const KINDS = only === "all" ? ["furniture", "accessory"] : [only];
const d = db();

const live = d.query(
  `SELECT id, title, description, asking_price_cents, source
     FROM listings WHERE delisted_at IS NULL`,
).all() as Array<{
  id: number; title: string; description: string | null;
  asking_price_cents: number | null; source: string;
}>;

const doomed: Array<{ id: number; kind: string; head: string; title: string; price: number | null }> = [];
for (const l of live) {
  let p;
  try { p = resolveProductType(l.title, l.description ?? ""); } catch { continue; }
  /**
   * `unknown` is NOT retired. It means the title had no product noun the
   * lexicon recognises, which is a gap in our vocabulary far more often than
   * it is a non-product — and retiring on it would quietly delete every
   * listing written in a way we have not seen yet.
   */
  if (KINDS.includes(p.kind)) {
    doomed.push({ id: l.id, kind: p.kind, head: String(p.head ?? "?"), title: l.title, price: l.asking_price_cents });
  }
}

const byKind: Record<string, number> = {};
for (const x of doomed) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;

console.log(`${live.length} live listings · ${doomed.length} match [${KINDS.join(", ")}]`);
for (const [k, n] of Object.entries(byKind)) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log("");
for (const x of doomed.slice(0, 40)) {
  console.log(`  #${String(x.id).padStart(4)} ${x.kind.padEnd(9)} $${String(((x.price ?? 0) / 100).toFixed(0)).padStart(4)}  ${x.title.slice(0, 58)}`);
}
if (doomed.length > 40) console.log(`  ...and ${doomed.length - 40} more`);

if (dry) { console.log("\n[dry] nothing written"); process.exit(0); }

const stmt = d.prepare(
  `UPDATE listings SET delisted_at = $t, delist_reason = 'out_of_scope' WHERE id = $id AND delisted_at IS NULL`,
);
const t = now();
let n = 0;
for (const x of doomed) { stmt.run({ $t: t, $id: x.id }); n++; }
console.log(`\nretired ${n} listing(s) as out_of_scope`);
