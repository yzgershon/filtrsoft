/**
 * bun run seed:parts [--dry]
 *
 * The PC-components catalog. Idempotent — safe to re-run, it only inserts what
 * is missing.
 *
 * Yish, 2026-09-06: *"you should definetly be tracking computer components
 * parts because they move frequently depending on shortages."* He is right and
 * the gap was total: before this, `category = "component"` held **56 CPUs and
 * nothing else**. No RAM, no storage, no boards, no PSUs, no cases. The comps
 * crawler is driven by this catalog, so 25,171 sold rows contained not one bare
 * stick of memory — not because eBay lacks them, but because nothing ever
 * asked. That is how a 32GB DDR5 kit got estimated at $95 when it sells for
 * $419.
 *
 * ── ONE SKU PER PART, NOT ONE PER BRAND OF THE SAME PART ───────────────────
 *
 * He also said *"asus gpus price differently than gigabyte"*, which is true and
 * measurable — within the existing RTX 4070 comp set:
 *
 *     ASUS $530 · MSI $510 · Gigabyte $500 · PNY $500 · ZOTAC $480 · FE $630
 *
 * But that is an argument for reading the brand out of `raw_title`, NOT for
 * `ASUS RTX 4070` and `Gigabyte RTX 4070` as separate SKUs. Splitting them
 * would multiply the catalog roughly fivefold, quintuple the crawl, and leave
 * each SKU with the 3-9 comps you see above instead of one pool of 50+. The
 * spread is a property to derive from a healthy comp set, not a reason to
 * shatter it.
 *
 * Same reasoning for board sockets and PSU efficiency: they live in the model
 * string, where the search finds them and a human can read them.
 */
import { db, now } from "../db/index.ts";

const dry = process.argv.includes("--dry");

type Sku = [category: string, brand: string, model: string, liquidity?: string];

/**
 * ⚠ THE MODEL STRING IS ALSO THE SEARCH STRING. `queryForSku` appends a
 * category suffix and nothing else, so anything that separates two products
 * that do not share a price has to be IN here — the capacity and speed on
 * memory, the wattage and efficiency rating on a PSU, the chipset on a board.
 * "Corsair Vengeance" alone would pool DDR4 and DDR5 and 16GB and 64GB into one
 * meaningless median.
 */
const SKUS: Sku[] = [
  // ── GPUs: only the three missing from 20/30/40/50 ─────────────────────────
  ["gpu", "NVIDIA", "RTX 3090 Ti", "normal"],
  ["gpu", "NVIDIA", "RTX 4070 SUPER", "hot"],
  ["gpu", "NVIDIA", "RTX 4070 Ti SUPER", "hot"],

  // ── Intel Core Ultra (Arrow Lake desktop) ─────────────────────────────────
  ["component", "Intel", "Core Ultra 5 245K"],
  ["component", "Intel", "Core Ultra 7 265K"],
  ["component", "Intel", "Core Ultra 7 265F"],
  ["component", "Intel", "Core Ultra 9 285K"],

  // ── Intel 10th gen and newer, the ones missing from the catalog ───────────
  ["component", "Intel", "i3-12100"],
  ["component", "Intel", "i3-13100"],
  ["component", "Intel", "i3-14100"],
  ["component", "Intel", "i5-10600K"],
  ["component", "Intel", "i5-11600K"],
  ["component", "Intel", "i5-13500"],
  ["component", "Intel", "i5-14400"],
  ["component", "Intel", "i5-14600K"],
  ["component", "Intel", "i7-11700"],
  ["component", "Intel", "i7-13700"],
  ["component", "Intel", "i7-14700"],
  ["component", "Intel", "i9-11900K"],
  ["component", "Intel", "i9-14900KF"],

  // ── AMD Ryzen 5000 / 7000 / 9000, the ones missing ────────────────────────
  ["component", "AMD", "Ryzen 5 5600G"],
  ["component", "AMD", "Ryzen 5 7500F"],
  ["component", "AMD", "Ryzen 5 7600"],
  ["component", "AMD", "Ryzen 7 5700G"],
  ["component", "AMD", "Ryzen 7 5700X3D"],
  ["component", "AMD", "Ryzen 7 7700"],
  ["component", "AMD", "Ryzen 9 7900"],
  ["component", "AMD", "Ryzen 9 7900X3D"],
  ["component", "AMD", "Ryzen 9 7950X"],
  ["component", "AMD", "Ryzen 9 7950X3D"],
  ["component", "AMD", "Ryzen 9 9900X"],
  ["component", "AMD", "Ryzen 9 9900X3D"],
  ["component", "AMD", "Ryzen 9 9950X"],
  ["component", "AMD", "Ryzen 9 9950X3D"],

  // ── RAM. Capacity and generation are the price, so both are in the model ──
  ["ram", "Corsair", "Vengeance 16GB DDR5-6000", "hot"],
  ["ram", "Corsair", "Vengeance 32GB DDR5-6000", "hot"],
  ["ram", "Corsair", "Vengeance 64GB DDR5-6000", "hot"],
  ["ram", "Corsair", "Vengeance 32GB DDR4-3200", "normal"],
  ["ram", "G.Skill", "Trident Z5 32GB DDR5-6000", "hot"],
  ["ram", "G.Skill", "Trident Z5 64GB DDR5-6000", "hot"],
  ["ram", "G.Skill", "Ripjaws S5 32GB DDR5-6000", "normal"],
  ["ram", "G.Skill", "Trident Z 32GB DDR4-3600", "normal"],
  ["ram", "Kingston", "Fury Beast 16GB DDR5-6000", "hot"],
  ["ram", "Kingston", "Fury Beast 32GB DDR5-6000", "hot"],
  ["ram", "Kingston", "Fury Beast 64GB DDR5-6000", "normal"],
  ["ram", "Crucial", "32GB DDR5-5600", "normal"],
  ["ram", "TEAMGROUP", "T-Force 32GB DDR5-6000", "normal"],

  // ── Storage. The gap that started all of this ─────────────────────────────
  ["ram", "Samsung", "990 PRO 1TB NVMe", "hot"],
  ["ram", "Samsung", "990 PRO 2TB NVMe", "hot"],
  ["ram", "Samsung", "980 PRO 1TB NVMe", "normal"],
  ["ram", "WD", "BLACK SN850X 1TB NVMe", "hot"],
  ["ram", "WD", "BLACK SN850X 2TB NVMe", "hot"],
  ["ram", "Crucial", "P3 Plus 1TB NVMe", "normal"],
  ["ram", "Crucial", "T705 2TB NVMe", "normal"],

  // ── PSUs. Wattage AND efficiency, because a 750W Gold and a 750W Bronze
  //    are not the same product and he named exactly that pair ──────────────
  ["psu", "Corsair", "RM1000x 1000W Gold"],
  ["psu", "Corsair", "RM850x 850W Gold"],
  ["psu", "Corsair", "RM750x 750W Gold"],
  ["psu", "Corsair", "HX1200 1200W Platinum"],
  ["psu", "Corsair", "CX650 650W Bronze"],
  ["psu", "EVGA", "SuperNOVA 750W Gold"],
  ["psu", "Seasonic", "Focus GX-750 750W Gold"],
  ["psu", "Thermaltake", "Smart 600W Bronze"],
  ["psu", "MSI", "MPG A1000G 1000W Gold"],

  // ── Motherboards. Socket rides in the chipset, which is the point ─────────
  ["motherboard", "ASUS", "ROG Strix Z790-E LGA1700"],
  ["motherboard", "ASUS", "TUF Gaming Z790-PLUS LGA1700"],
  ["motherboard", "MSI", "PRO B760M LGA1700"],
  ["motherboard", "Gigabyte", "B760 AORUS Elite LGA1700"],
  ["motherboard", "ASUS", "ROG Strix B550-F AM4"],
  ["motherboard", "MSI", "MAG B550 Tomahawk AM4"],
  ["motherboard", "ASUS", "TUF Gaming X570-PLUS AM4"],
  ["motherboard", "ASUS", "ROG Strix X670E-E AM5"],
  ["motherboard", "ASUS", "TUF Gaming B650-PLUS AM5"],
  ["motherboard", "MSI", "MAG B650 Tomahawk AM5"],
  ["motherboard", "ASUS", "TUF Gaming B850-PLUS AM5"],
  ["motherboard", "MSI", "MAG X870 Tomahawk AM5"],

  // ── Cases ─────────────────────────────────────────────────────────────────
  ["case", "Lian Li", "O11 Dynamic"],
  ["case", "Lian Li", "Lancool 216"],
  ["case", "NZXT", "H5 Flow"],
  ["case", "NZXT", "H7 Flow"],
  ["case", "Corsair", "4000D Airflow"],
  ["case", "Fractal Design", "Meshify 2"],
  ["case", "Fractal Design", "North"],
  ["case", "HP", "OMEN 45L"],
];

const d = db();
const existing = new Set(
  (d.query("SELECT LOWER(brand || ' ' || model) k FROM skus").all() as Array<{ k: string }>)
    .map((r) => r.k),
);

const insert = d.prepare(
  `INSERT INTO skus (category, brand, model, attributes, liquidity, created_at, source)
   VALUES ($c, $b, $m, '{}', $l, $t, 'parts-catalog')`,
);

let added = 0, skipped = 0;
const byCat: Record<string, number> = {};
for (const [category, brand, model, liquidity] of SKUS) {
  if (existing.has(`${brand} ${model}`.toLowerCase())) { skipped++; continue; }
  if (!dry) insert.run({ $c: category, $b: brand, $m: model, $l: liquidity ?? null, $t: now() });
  added++;
  byCat[category] = (byCat[category] ?? 0) + 1;
}

console.log(`${dry ? "[dry] " : ""}${added} added · ${skipped} already present`);
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(12)} ${n}`);
console.log(`\ncatalog is now ${(d.query("SELECT COUNT(*) n FROM skus").get() as { n: number }).n} SKUs`);
console.log("next: bun run ebay:comps --skus 20   (repeat; each SKU is one eBay search)");
