import { describe, test, expect } from "bun:test";
import { listingInventory } from "../src/signals/listing-offers.ts";
import { repeatedAppliances } from "../src/signals/repeated-appliances.ts";
import { applyQuality, segmentCounts } from "../src/api/query.ts";
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("placeholder inventory", () => {
  test("keeps flattened RAM offers and their part numbers separate", () => {
    const description = "Ram For Sale: All sticks are ECC RDIMM's. They will not work in a regular Desktop PC. 1x32gb SK Hynix DDR4-2400 $100 M393A4K40BB1 - CRCOQ S 2x32gb SK Hynix DDR4-2400 $200 HMA84GR7MFR4N - UH TD AA 8x32gb SK Hynix DDR4-2666 $800 HMA84GR7AFR4N - VK T3 AD";
    const inventory = listingInventory("Ram For Sale", description, 100)!;
    expect(inventory.sellerContext).toContain("ECC RDIMM");
    expect(inventory.offers.map((o) => [o.quantity, o.capacityPerStickGb, o.memoryGeneration, o.memorySpeed, o.askingPriceCents])).toEqual([
      [1,32,"DDR4",2400,10000], [2,32,"DDR4",2400,20000], [8,32,"DDR4",2666,80000],
    ]);
    expect(inventory.offers[0].evidence).toContain("M393A4K40BB1");
    expect(inventory.offers[0].evidence).not.toContain("HMA84");
  });
  test("preserves decimal prices and refuses to choose a discount tier", () => {
    const offers = listingInventory("Ram For Sale", "7x2gb Samsung DDR3-1600 $17.50 M391B5773DHO 30x8gb Axiom DDR3-1600 1-10 units for $15 per stick, $10 per stick if you buy 10+", 100)!.offers;
    expect(offers[0]).toMatchObject({ quantity: 7, askingPriceCents: 1750, priceBasis: "bundle" });
    expect(offers[1]).toMatchObject({ quantity: 30, askingPriceCents: null, priceBasis: "ambiguous" });
    expect(offers[1].evidence).toContain("$10 per stick if you buy 10+");
  });
  test("does not turn a price range or purchase cost into the asking price", () => {
    for (const text of ["1x8gb DDR3-1600 $10-15", "1x8gb DDR3-1600 originally cost $50"]) {
      expect(listingInventory("RAM", text, 100)!.offers[0].askingPriceCents).toBeNull();
    }
  });
  test("distinguishes unit prices in a real watercooling menu", () => {
    const offers = listingInventory("Custom PC Watercooling Components", "1 x Aquacomputer Waterblock - $20.00 ea 15 x Lian Li 120mm Fan Filters - $0.50 ea", 100)!.offers;
    expect(offers.map((o) => [o.quantity,o.askingPriceCents,o.priceBasis])).toEqual([[1,2000,"each"],[15,50,"each"]]);
  });
  test("leaves a normal PC parts list and an unpriced offer alone", () => {
    const text = "2x16gb Corsair Vengeance DDR5-6000 $350";
    expect(listingInventory("Gaming PC", text, 100)).toBeNull();
    expect(listingInventory("RAM", text, 35000)).toBeNull();
    expect(listingInventory("RAM", "2x16gb DDR5-6000 make an offer", 100)).toBeNull();
  });
});

describe("ten-listing review batch", () => {
  test("refills after a label, including agreement, without hiding other segments", () => {
    const rows = Array.from({ length: 15 }, (_, id) => ({ id, call: "BUY", reviewed: id < 2, gone: id === 2 }));
    const review = applyQuality(rows, "review");
    expect(review.map((r) => r.id)).toEqual([3,4,5,6,7,8,9,10,11,12]);
    expect(segmentCounts(rows).review).toBe(review.length);
    expect(applyQuality(rows, "all")).toHaveLength(15);
    rows[3].reviewed = true;
    expect(applyQuality(rows, "review").map((r) => r.id)).toEqual([4,5,6,7,8,9,10,11,12,13]);
  });
  test("never fills the review batch with risky or unpriceable listings", () => {
    const rows = ["RISK", "OUT_OF_SCOPE", "INSUFFICIENT_DATA", "FAIR", "PASS"].map((call) => ({ call }));
    expect(applyQuality(rows, "review").map((r) => r.call)).toEqual(["FAIR", "PASS"]);
  });
});

test("appliance retirement requires repeated appliance evidence", () => {
  const copies = (title: string, n: number) => Array.from({length:n}, () => ({title,source:"craigslist",asking_price_cents:10000}));
  const appliance = copies("Portable Ice Maker by Igloo.", 5);
  const rows = [...appliance, ...copies("Macbook Air 2017 @350", 10), ...copies("Gaming PC with ice maker", 5), ...copies("Portable Washing Machine", 3)];
  expect(repeatedAppliances(rows)).toEqual(appliance);
});

test("inventory valuation requires the same kit layout, not merely the same total GB", () => {
  // Separate process and newly-created temp DB: fixture prices must never enter
  // the live archive, and db() caches its connection across imports.
  const directory = mkdtempSync(join(tmpdir(), "filtrsoft-inventory-test-"));
  const databaseModule = new URL("../src/db/index.ts", import.meta.url).href;
  const valuationModule = new URL("../src/valuation/inventory.ts", import.meta.url).href;
  const parserModule = new URL("../src/signals/listing-offers.ts", import.meta.url).href;
  try {
    const code = `
      import {db} from ${JSON.stringify(databaseModule)};
      import {valueInventory} from ${JSON.stringify(valuationModule)};
      import {listingInventory} from ${JSON.stringify(parserModule)};
      const d=db();
      const at=new Date().toISOString();
      d.query("INSERT INTO skus(id,category,brand,model,created_at) VALUES(1,'ram','Corsair','Vengeance 32GB DDR5-6000',?)").run(at);
      const inventory=listingInventory('RAM','2x16gb Corsair Vengeance DDR5-6000 $100',100);
      const unknownLayout=valueInventory(inventory)[0].valuation;
      d.query("INSERT INTO skus(id,category,brand,model,created_at) VALUES(2,'ram','Corsair','Vengeance 32GB (2x16GB) DDR5-6000',?)").run(at);
      for(let i=0;i<5;i++) d.query("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,condition_norm,sold_at,captured_at,sku_id,raw_json) VALUES('ebay',?,'Corsair Vengeance 32GB (2x16GB) DDR5-6000 RAM',10000,'used',?,?,2,json_object('soldAt',?))").run(String(i),at,at,at);
      const exact=valueInventory(inventory)[0].valuation;
      const otherLayout=valueInventory(listingInventory('RAM','1x32gb Corsair Vengeance DDR5-6000 $100',100))[0].valuation;
      const server=valueInventory({...inventory,sellerContext:'All sticks are ECC RDIMMs.'})[0].valuation;
      const variant=valueInventory(listingInventory('RAM','2x16gb Corsair Vengeance RGB DDR5-6000 $100',100))[0].valuation;
      console.log(JSON.stringify({unknownLayout,exact,otherLayout,server,variant}));
      d.close();
    `;
    const result = Bun.spawnSync({cmd:[process.execPath,"--eval",code],cwd:directory,
      env:{...process.env,FILTRSOFT_DB:join(directory,"fixture.db")},stdout:"pipe",stderr:"pipe"});
    expect(result.exitCode).toBe(0);
    const got = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(got.unknownLayout).toBeNull();
    expect(got.exact).toMatchObject({medianCents:10000,compCount:5});
    expect(got.otherLayout).toBeNull();
    expect(got.server).toBeNull();
    expect(got.variant).toBeNull();
  } finally {
    // Only files created in this fresh test directory; no recursive deletion.
    for (const file of readdirSync(directory)) unlinkSync(join(directory,file));
    rmdirSync(directory);
  }
});
