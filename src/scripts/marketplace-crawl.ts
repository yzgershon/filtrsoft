/**
 * bun run ou:crawl --query "rtx 4070"   [--limit 25] [--headless] [--dry]
 * bun run mc:crawl --query "iphone 15"
 *
 * OfferUp and Mercari. Used markets, so they feed the deal feed AND — once the
 * outcome loop is wired to them — a second opinion on clearing prices that does
 * not come from eBay.
 *
 * Basis matters here and is per SOURCE: Mercari is eBay-basis (national,
 * shipped, ~10% fee), OfferUp is local unless the card says shipping. See
 * `sources/marketplace.ts`.
 */
import { runMarketWorker, parseCards, cardToListing, MARKETPLACES, BASIS, type Marketplace } from "../sources/marketplace.ts";
import { checkFetched } from "../engine/index.ts";
import { resolveProductType } from "../signals/product-type.ts";
import { db } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const source = (arg("source") ?? "offerup") as Marketplace;
if (!MARKETPLACES.includes(source)) {
  console.error(`--source must be one of: ${MARKETPLACES.join(", ")}`);
  process.exit(1);
}

/**
 * Default queries are the categories Yish trades, not "electronics".
 * These sites have no useful category browse — search is the only way in.
 */
const DEFAULT_QUERIES = [
  "graphics card", "gaming pc", "macbook", "iphone", "laptop", "ps5", "xbox series",
];
const queries = arg("query") ? [arg("query")!] : DEFAULT_QUERIES;
const limit = Number(arg("limit")) || 25;

console.log(`\x1b[1m${source}\x1b[0m (${BASIS[source]}-basis) · ${queries.length} query(s)`);

const seen = new Set(
  (db().query("SELECT source_id FROM listings WHERE source=$s").all({ $s: source }) as Array<{ source_id: string }>)
    .map((r) => r.source_id),
);

let found = 0, analysed = 0, skipped = 0;
const tally: Record<string, number> = {};

for await (const ev of runMarketWorker(source, {
  queries, headless: has("headless"), scrolls: 3,
})) {
  if (ev.type === "log") console.log(`  ${ev.msg}`);
  else if (ev.type === "error") console.error(`\x1b[31m  ${ev.msg}\x1b[0m`);
  else if (ev.type === "cards") {
    const cards = parseCards(source, ev.links);
    found += cards.length;
    console.log(`  \x1b[1m${ev.query}\x1b[0m: ${ev.links.length} links -> ${cards.length} cards`);

    const fresh = cards.filter((c) => !seen.has(c.sourceId));
    // Grammar gate BEFORE the engine, same as the Craigslist crawler: a search
    // for "graphics card" returns brackets, waterblocks and RGB strips.
    const inScope = fresh.filter((c) => resolveProductType(c.title).kind === "tech");
    skipped += fresh.length - inScope.length;

    for (const c of inScope.slice(0, limit)) {
      seen.add(c.sourceId);
      if (has("dry")) {
        console.log(`    $${c.priceCents ? (c.priceCents / 100).toFixed(0) : "—"} ${c.title.slice(0, 58)}`);
        continue;
      }
      try {
        const r = await checkFetched(cardToListing(c), { persist: true });
        tally[r.verdict.call] = (tally[r.verdict.call] ?? 0) + 1;
        analysed++;
        const C: Record<string, string> = { BUY: "\x1b[32m", VERIFY: "\x1b[35m", FAIR: "\x1b[36m" };
        if (["BUY", "VERIFY", "FAIR"].includes(r.verdict.call)) {
          console.log(`    ${C[r.verdict.call]}${r.verdict.call}\x1b[0m $${c.priceCents ? (c.priceCents / 100).toFixed(0) : "—"} ${c.title.slice(0, 52)}`);
        }
      } catch (e) {
        console.error(`    \x1b[31mfailed: ${(e as Error).message.slice(0, 70)}\x1b[0m`);
      }
    }
  }
}

console.log(`\n${found} cards seen · ${analysed} analysed · ${skipped} out of scope`);
if (Object.keys(tally).length) {
  console.log("  " + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "));
}
