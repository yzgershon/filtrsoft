/** Re-score live listings from stored facts, without a crawl or paid vision.
 * bun run src/scripts/reverdict.ts [--apply]
 * Default is a comparison only; --apply persists answers using storeVerdict.
 */
import { db } from "../db/index.ts";
import { checkStored, ENGINE_VERSION } from "../engine/index.ts";
import { storeVerdict } from "../db/verdicts.ts";

const rows = db().query(`SELECT l.id,v.call FROM listings l
  LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
  WHERE l.delisted_at IS NULL ORDER BY l.id`).all() as Array<{id:number;call:string|null}>;
const before: Record<string,number> = {}, after: Record<string,number> = {};
const transitions: Record<string,number> = {};
const inventories: unknown[] = [];
let failed = 0;
for (const row of rows) {
  before[row.call ?? "NONE"] = (before[row.call ?? "NONE"] ?? 0) + 1;
  try {
    const { verdict } = checkStored(row.id);
    after[verdict.call] = (after[verdict.call] ?? 0) + 1;
    if (verdict.call !== row.call) {
      const key = `${row.call} -> ${verdict.call}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
    }
    if (verdict.inventory) inventories.push({id:row.id,offers:verdict.inventory.offers.length,priced:verdict.inventory.offers.filter((o)=>o.valuation).length});
    if (process.argv.includes("--apply")) storeVerdict(row.id, ENGINE_VERSION, verdict);
  } catch (error) {
    failed++;
    console.error(`#${row.id}: ${(error as Error).message}`);
  }
}
console.log(JSON.stringify({engine:ENGINE_VERSION,applied:process.argv.includes("--apply"),checked:rows.length,failed,before,after,transitions,inventories},null,2));
if (failed) process.exitCode = 1;
