/**
 * bun run retail [--skus N] [--sku "RTX 5070"] [--query ...] [--source newegg]
 *                [--headless] [--dry] [--replay]
 *
 * NEW retail prices — the ceiling on what a used unit can fetch, and the only
 * check on our comps that is not derived from our comps.
 *
 * THREE RETAILERS, because one lies about the categories Yish trades. Best Buy
 * alone shipped first and its GPU coverage was thin; Newegg is where PC parts
 * are actually priced, and Micro Center Cambridge is a twenty-minute drive from
 * Newton, which makes it the only source here a local buyer can walk into.
 *
 * The real payoff is not coverage, it is CROSS-CHECKING: with one source a bad
 * parse becomes the ceiling silently, and thirty ceilings across three sources
 * cannot be hand-verified the way nine could. `latestRetail` takes the cheapest
 * quote another retailer corroborates, so an outlier gets outvoted instead of
 * winning.
 *
 * Every run archives raw page lines to `docs/testset/<source>-lines.json`, so a
 * parser fix costs seconds via `--replay` instead of another live session.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  runRetailWorker, parseRetail, retailCeiling, saveRetail, saveNoRetail,
  noCeilingReason, retailQueryForSku, skusNeedingRetail, latestRetail,
  retailApplies, RETAIL_SOURCES, type RetailSource,
} from "../sources/retail.ts";
import { db } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const fixtureFor = (s: string) => join(import.meta.dir, `../../docs/testset/${s}-lines.json`);

const onlySource = arg("source") as RetailSource | undefined;
if (onlySource && !RETAIL_SOURCES.includes(onlySource)) {
  console.error(`--source must be one of: ${RETAIL_SOURCES.join(", ")}`);
  process.exit(1);
}
const sources: readonly RetailSource[] = onlySource ? [onlySource] : RETAIL_SOURCES;

/**
 * `--sku "RTX 5070"` targets a NAMED sku, same flag `ebay:comps` already has.
 *
 * The queue orders by fewest-retailers-asked, which is right for accumulating
 * corroboration but puts every obsolete card first — nothing stocks a GTX 1080,
 * so a first run spends itself proving that three times over. This is how you
 * point it at something on a shelf.
 */
const skuName = arg("sku");
const named = skuName
  ? db().query(
      `SELECT id, brand, model, category, attributes FROM skus
        WHERE LOWER(brand || ' ' || model) LIKE $q OR LOWER(model) LIKE $q
        ORDER BY LENGTH(model) LIMIT 4`,
    ).all({ $q: `%${skuName.toLowerCase()}%` }) as Array<{
      id: number; brand: string; model: string; category: string; attributes: string;
    }>
  : null;
if (skuName && !named?.length) { console.error(`no SKU matching "${skuName}"`); process.exit(1); }

/**
 * `--sku` must respect the same category rule the queue does.
 *
 * It did not, and `--sku "RTX 5070"` picked up the `Gaming PC RTX 5070`
 * prebuilt alongside the card. See `NO_RETAIL_TWIN` — that SKU stored a $1,400
 * "ceiling" against a $1,599 used median and would have made every RTX 5070
 * build in the feed read INSUFFICIENT_DATA.
 */
const skipped = named?.filter((s) => !retailApplies(s.category)) ?? [];
for (const s of skipped) {
  console.log(`[33mskipping ${s.brand} ${s.model} — a ${s.category} has no retail twin[0m`);
}
const usable = named?.filter((s) => retailApplies(s.category)) ?? null;
if (skuName && !usable?.length) { console.error("nothing left to look up"); process.exit(1); }

const single = arg("query");
const targets = usable
  ? usable.map((s) => ({
      id: s.id, label: `${s.brand} ${s.model}`,
      query: retailQueryForSku(s), category: s.category as string | null,
    }))
  : single
  ? [{ id: null as number | null, label: single, query: single, category: arg("category") ?? null }]
  : skusNeedingRetail(Number(arg("skus")) || 8).map((s) => ({
      id: s.id,
      label: `${s.brand} ${s.model} [${s.sources}/${RETAIL_SOURCES.length} priced]`,
      query: retailQueryForSku(s),
      category: s.category as string | null,
    }));

if (!targets.length) { console.log("nothing to look up"); process.exit(0); }

console.log(`${targets.length} SKU(s) × ${sources.length} retailer(s)`);
for (const t of targets) console.log(`  · ${t.label}  ->  "${t.query}"`);
console.log();

const bySku = new Map(targets.map((t) => [t.query, t.id]));
const catBy = new Map(targets.map((t) => [t.query, t.category ?? null]));
let saved = 0, absent = 0;

for (const src of sources) {
  const FIXTURE = fixtureFor(src);
  const archive: Record<string, string[]> = existsSync(FIXTURE)
    ? JSON.parse(readFileSync(FIXTURE, "utf8"))
    : {};

  console.log(`\x1b[1m\x1b[36m── ${src} ──\x1b[0m`);

  /**
   * `--replay` re-scores ARCHIVED pages instead of scraping.
   *
   * Every parser fix so far came from staring at lines already captured — the
   * accessory that became a ceiling, the nav tile, the Newegg promo line read
   * as a product name. Re-running a browser to re-test a pure function is slow,
   * is another session the retailer sees, and re-introduces the one variable
   * you were trying to hold still.
   */
  const events = has("replay")
    ? (async function* () {
        for (const t of targets) {
          const lines = archive[t.query];
          if (!lines) { console.log(`  \x1b[90mno archived ${src} page for "${t.query}"\x1b[0m`); continue; }
          yield { type: "retail" as const, source: src, query: t.query, lines };
        }
      })()
    : runRetailWorker(src, { queries: targets.map((t) => t.query), headless: has("headless") });

  for await (const ev of events) {
    if (ev.type === "log") console.log(`  ${ev.msg}`);
    else if (ev.type === "error") console.error(`\x1b[31m  ${ev.msg}\x1b[0m`);
    else if (ev.type === "retail") {
      archive[ev.query] = ev.lines;

      const offers = parseRetail(src, ev.lines);
      const found = retailCeiling(offers, ev.query, catBy.get(ev.query) ?? null);
      const ceiling = found.offer;
      const newOffers = offers.filter((o) => o.isNew).length;

      console.log(
        `  \x1b[1m${ev.query}\x1b[0m: ${ev.lines.length} lines -> ${offers.length} offers ` +
        `(${newOffers} new, ${offers.length - newOffers} second-hand)`,
      );

      if (!ceiling) {
        const why = noCeilingReason(offers, found.rejected);
        console.log(`    \x1b[90mno ceiling: ${why}\x1b[0m`);
        // Record the absence so the queue stops re-asking dead questions.
        if (!has("dry")) { saveNoRetail(bySku.get(ev.query) ?? null, ev.query, why, src); absent++; }
        continue;
      }

      const stock = ceiling.stockCount != null ? `  \x1b[90m(${ceiling.stockCount} in stock)\x1b[0m` : "";
      console.log(`    \x1b[32mnew from $${(ceiling.priceCents / 100).toFixed(2)}\x1b[0m  ${ceiling.title.slice(0, 62)}${stock}`);
      // Show what the gate threw out. A wrong ceiling is otherwise silent, and
      // the iPhone 16e nearly became the iPhone 16's new price exactly this way.
      for (const r of found.rejected.slice(0, 3)) {
        console.log(`    \x1b[90m  rejected: ${r.title.slice(0, 52)} — ${r.why}\x1b[0m`);
      }
      if (!has("dry")) { saveRetail(bySku.get(ev.query) ?? null, ceiling, ev.query); saved++; }
    }
  }

  mkdirSync(join(import.meta.dir, "../../docs/testset"), { recursive: true });
  writeFileSync(FIXTURE, JSON.stringify(archive, null, 1));
}

/**
 * Print the resolved ceiling per SKU, not just the raw quotes.
 *
 * This is where multiple sources earn their keep, so it has to be visible: a
 * disagreement between retailers is either real spread worth knowing or a
 * parser bug worth fixing, and both are invisible in a per-source log.
 */
console.log(`\n\x1b[1mResolved ceilings\x1b[0m`);
for (const t of targets) {
  if (!t.id) continue;
  const r = latestRetail(t.id);
  if (!r) { console.log(`  \x1b[90m${t.label.padEnd(34)} no ceiling\x1b[0m`); continue; }
  const others = r.quotes.map((q) => `${q.source} $${(q.priceCents / 100).toFixed(0)}`).join(" · ");
  const flag = r.corroborated ? "\x1b[32m✓\x1b[0m" : "\x1b[33m?\x1b[0m";
  console.log(`  ${flag} ${t.label.padEnd(34)} \x1b[1m$${(r.priceCents / 100).toFixed(2)}\x1b[0m via ${r.source}   \x1b[90m${others}\x1b[0m`);
  if (r.discarded) {
    console.log(`      \x1b[33mdiscarded ${r.discarded.source} $${(r.discarded.priceCents / 100).toFixed(2)} — too far below the others to be the same product\x1b[0m`);
    console.log(`      \x1b[90m${r.discarded.title.slice(0, 74)}\x1b[0m`);
  }
}

const n = db().query("SELECT COUNT(*) n FROM retail_prices WHERE is_new=1").get() as { n: number };
const covered = db().query(
  "SELECT COUNT(DISTINCT sku_id) n FROM retail_prices WHERE sku_id IS NOT NULL AND is_new=1",
).get() as { n: number };
console.log(`\n${saved} quotes stored · ${absent} absences recorded · ${n.n} retail prices · ${covered.n} SKUs with a ceiling`);
