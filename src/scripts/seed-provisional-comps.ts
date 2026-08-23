/**
 * PROVISIONAL COMPS — hand-entered, NOT market truth.
 *
 * Exists solely to prove the valuation -> verdict path end to end while the eBay
 * API is in review. Every row is source='manual-provisional' so it can be found
 * and deleted the moment real sold data lands:
 *
 *   DELETE FROM comps WHERE source = 'manual-provisional';
 *
 * Do NOT let these numbers reach a user. Yish's audit already proved my static
 * price knowledge is stale — he corrected three component calls, citing a DDR5
 * shortage I didn't know about. That is exactly why the archive has to be real.
 */
import { db, insertComp, now } from "../db/index.ts";

const d = db();
d.query("DELETE FROM comps WHERE source='manual-provisional'").run();

/** [model, condition, sold prices in dollars] — spreads are intentional. */
const DATA: Array<[string, string, number[]]> = [
  ["iPhone 16 Pro Max", "used", [1180, 1120, 1250, 1090, 1200, 1150, 1275, 1130]],
  ["iPhone 15 Pro Max", "used", [790, 750, 830, 720, 810, 775, 850, 760]],
  ["iPhone 15", "used", [480, 450, 510, 440, 495, 465, 520, 470]],
  ["Galaxy Z Flip 6", "used", [520, 480, 560, 460, 540, 500, 575, 490]],
  ["Galaxy Z Fold 5", "used", [640, 600, 690, 580, 660, 620, 710, 610]],
  ["Latitude 7420", "used", [430, 395, 470, 380, 450, 410, 490, 405]],
  ["Latitude 5520", "used", [360, 330, 395, 320, 375, 345, 410, 340]],
  ["RTX 5070", "used", [510, 480, 545, 465, 525, 495, 560, 500]],
  ["RTX 3050", "used", [155, 140, 170, 135, 160, 148, 178, 145]],
  ["Xbox Series X", "used", [340, 320, 365, 305, 350, 330, 375, 315]],
];

const skuByModel = new Map(
  (d.query("SELECT id, model FROM skus").all() as Array<{ id: number; model: string }>)
    .map((s) => [s.model, s.id]),
);

let n = 0, skipped: string[] = [];
for (const [model, cond, prices] of DATA) {
  const skuId = skuByModel.get(model);
  if (!skuId) { skipped.push(model); continue; }
  prices.forEach((p, i) => {
    insertComp({
      source: "manual-provisional",
      source_item_id: `${model}-${i}`,
      raw_title: `${model} ${cond}`,
      sold_price_cents: p * 100,
      shipping_cents: 0,
      condition_raw: cond,
      condition_norm: cond,
      sold_at: new Date(Date.now() - (i + 1) * 6 * 86_400_000).toISOString().slice(0, 10),
      sku_id: skuId,
      query: "provisional",
      raw: { provisional: true, model, note: "hand-entered, replace with eBay sold data" },
    });
    n++;
  });
}

console.log(`seeded ${n} PROVISIONAL comps across ${DATA.length - skipped.length} SKUs`);
if (skipped.length) console.log(`  no SKU match (skipped): ${skipped.join(", ")}`);
console.log(`\n⚠  These are hand-entered placeholders, not market data.`);
console.log(`   Remove with: DELETE FROM comps WHERE source='manual-provisional';`);
