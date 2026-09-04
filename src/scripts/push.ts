/**
 * bun run push [--source facebook] [--since 7] [--limit 200] [--dry]
 *
 * Send locally-crawled listings to production. This is how Facebook Marketplace
 * (and anything else needing a signed-in browser) reaches filtrsoft.com — the
 * container cannot log in, and session cookies do not belong in a server image.
 *
 * Sends FACTS only. The server re-scores everything with its own engine, so a
 * stale local engine can never put a stale verdict in front of a buyer.
 *
 * Needs `FILTRSOFT_PUSH_TOKEN` set in the local environment AND on Railway. Set it
 * in Railway's variables UI yourself — never paste a token into a chat.
 */
import { db } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const API = process.env.FILTRSOFT_API ?? "https://filtrsoft.com";
const TOKEN = process.env.FILTRSOFT_PUSH_TOKEN;
const source = arg("source") ?? "facebook";
const sinceDays = Number(arg("since")) || 14;
const limit = Math.min(Number(arg("limit")) || 200, 300);

if (!TOKEN && !has("dry")) {
  console.error("FILTRSOFT_PUSH_TOKEN is not set locally.");
  console.error("  Set the same value in Railway -> Variables, then export it here.");
  process.exit(1);
}

const rows = db().query(
  `SELECT l.id, l.source, l.source_id, l.url, l.title, l.description,
          l.asking_price_cents, l.location, l.posted_at, l.seller_ref
     FROM listings l
    WHERE l.source = $src
      AND l.delisted_at IS NULL
      AND (l.posted_at IS NULL OR l.posted_at >= date('now', $since))
    ORDER BY l.posted_at DESC
    LIMIT $lim`,
).all({ $src: source, $since: `-${sinceDays} days`, $lim: limit }) as Array<{
  id: number; source: string; source_id: string; url: string; title: string;
  description: string; asking_price_cents: number | null; location: string | null;
  posted_at: string | null; seller_ref: string | null;
}>;

if (!rows.length) {
  console.log(`no ${source} listings in the last ${sinceDays} days — run the crawler first`);
  process.exit(0);
}

const photos = db().query(`SELECT listing_id, url FROM listing_photos ORDER BY position`)
  .all() as Array<{ listing_id: number; url: string }>;
const byListing = new Map<number, string[]>();
for (const p of photos) {
  if (!byListing.has(p.listing_id)) byListing.set(p.listing_id, []);
  byListing.get(p.listing_id)!.push(p.url);
}

const listings = rows.map((r) => ({
  source: r.source, sourceId: r.source_id, url: r.url, title: r.title,
  description: r.description ?? "", askingPriceCents: r.asking_price_cents,
  location: r.location, postedAt: r.posted_at, sellerRef: r.seller_ref,
  photoUrls: byListing.get(r.id) ?? [],
}));

console.log(`${listings.length} ${source} listings -> ${API}`);
for (const l of listings.slice(0, 5)) {
  console.log(`  · $${l.askingPriceCents ? (l.askingPriceCents / 100).toFixed(0) : "—"} ${l.title.slice(0, 56)}`);
}
if (listings.length > 5) console.log(`  … and ${listings.length - 5} more`);

if (has("dry")) { console.log("\ndry run — nothing sent"); process.exit(0); }

const res = await fetch(`${API}/v1/push`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ listings }),
});

if (!res.ok) {
  console.error(`\npush failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const out = await res.json() as Record<string, unknown>;
console.log(`\nreceived ${out.received} · ${out.inserted} new · ${out.updated} updated · ${out.scored} scored`);
console.log("  calls:", out.calls);
