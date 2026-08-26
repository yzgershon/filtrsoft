/**
 * bun run ebay:search "rtx 4090" [--max 1400] [--limit 25] [--analyse]
 *
 * eBay Browse as a SOURCE. Without `--analyse` it only prints what the API
 * returns, which is the fast way to see how dirty a query is before spending
 * engine time on it.
 */
import { searchEbay, ebayConfigured } from "../sources/ebay-source.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const query = process.argv.slice(2).find((a) => !a.startsWith("--") && a !== arg("max") && a !== arg("limit"));

if (!ebayConfigured()) {
  console.error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set. See .env.");
  process.exit(1);
}
if (!query) {
  console.error('usage: bun run ebay:search "rtx 4090" [--max 1400] [--limit 25]');
  process.exit(1);
}

const items = await searchEbay({
  query,
  maxPriceCents: arg("max") ? Math.round(Number(arg("max")) * 100) : undefined,
  limit: Number(arg("limit")) || 25,
});

console.log(`\n\x1b[1m${items.length}\x1b[0m used fixed-price listings for "${query}"\n`);
for (const i of items) {
  const p = i.askingPriceCents ? `$${Math.round(i.askingPriceCents / 100)}` : "—";
  console.log(`  ${p.padStart(7)}  ${(i.attributes.condition || "").padEnd(12).slice(0, 12)}  ${i.title.slice(0, 62)}`);
}
console.log(`\n\x1b[90mBrowse returns ASKING prices on active listings, never sold comps.`);
console.log(`eBay-to-eBay pays fees on both ends — these are marked ebay-basis.\x1b[0m\n`);
