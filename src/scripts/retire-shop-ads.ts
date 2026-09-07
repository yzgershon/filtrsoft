/**
 * bun run retire:ads [--dry]
 *
 * Retire SHOP ADVERTISEMENTS — a storefront's standing ad, not a listing for
 * one item.
 *
 * ── WHY THIS IS NOT A DUPLICATE-TITLE SWEEP ────────────────────────────────
 *
 * The obvious detector is "same title posted 4+ times", and it is wrong.
 * Measured 2026-09-06: 45 titles repeat 4+ times across 151 live listings, and
 * that set contains **"Macbook Air 2017 @350" ten times** — a Facebook seller
 * with ten real MacBook Airs, which is a listing worth keeping, not spam.
 *
 * The second-obvious detector is the seller. `seller_ref` is NULL on all 4,499
 * live rows; the crawlers never populate it.
 *
 * The third is the description sign-off. One Cambridge/Allston reseller ends
 * every description with "Thank you." — 316 live listings carry it. That one is
 * close, but it would take **a genuine Gigabyte RTX 5090 at $2,500** posted
 * from Nonantum by an unrelated seller whose description happens to end the
 * same way. Losing a real 5090 to clean up microwave ads is a bad trade.
 *
 * ── WHAT ACTUALLY SEPARATES THEM ───────────────────────────────────────────
 *
 * **A shop ad does not name one product.** It asks a question, welcomes you to
 * a storefront, quotes a price floor, or lists whole categories joined by "or":
 *
 *     "Do you need a printer or Laptop, Desktop Computer or just a monitor?"
 *     "24 Computers, Printers, Monitors left starting at just $30"
 *     "Welcome to Computer City: High End Computers at new affordable prices"
 *
 * There is nothing to value because there is no item. That is a property of the
 * TITLE, it needs no seller identity, and it cannot take a listing that names a
 * real product — which is why it is the rule this file uses.
 *
 * ⚠ THE OPENERS AND THE CATEGORY-LIST RULE BOTH HAVE TO MATCH SOMETHING REAL.
 * Do not loosen `SHOP_AD` into a keyword list. "Do you need" is safe because a
 * private seller does not open that way; "computer" is not safe under any
 * circumstances.
 */
import { db, now } from "../db/index.ts";

const dry = process.argv.includes("--dry");
const d = db();

/**
 * A storefront's voice. Each of these was read off a real live listing, and
 * each names no item.
 */
const SHOP_AD: RegExp[] = [
  /^\s*(do|did) you (need|want|have)\b/i,
  /^\s*welcome to\b/i,
  /^\s*(get ready|come (in|on down)|stop by|visit us)\b/i,
  /\bnow open\b.*\b(sunday|monday|daily|weekend)/i,
  /\b(starting|prices start|start) at (just )?\$\d/i,
  /\b\d+\s+(computers|laptops|monitors|printers|units)\b.*\bleft\b/i,
  /\bat half (price|off)\b/i,
  /\b(we|us) (buy|sell|repair|service)\b.*\b(any|all)\b/i,
  /\bshowroom\b/i,
  /\b(30|thirty) day money back\b/i,
];

/**
 * Three or more DIFFERENT product categories offered as alternatives is an
 * inventory list, not an item. "or" is what makes it a menu.
 */
const CATEGORY = /\b(computers?|laptops?|desktops?|monitors?|printers?|tvs?|televisions?|tablets?|phones?)\b/gi;
const menuOfCategories = (title: string): boolean => {
  const hits = new Set((title.match(CATEGORY) ?? []).map((w) => w.toLowerCase().replace(/s$/, "")));
  return hits.size >= 3 && /\bor\b|,/.test(title);
};

const live = d.query(
  `SELECT id, title, asking_price_cents, location FROM listings WHERE delisted_at IS NULL`,
).all() as Array<{ id: number; title: string; asking_price_cents: number | null; location: string | null }>;

const doomed = live.filter(
  (l) => SHOP_AD.some((re) => re.test(l.title)) || menuOfCategories(l.title),
);

console.log(`${live.length} live · ${doomed.length} read as a shop advertisement\n`);
for (const l of doomed) {
  console.log(`  #${String(l.id).padStart(4)} $${String(((l.asking_price_cents ?? 0) / 100).toFixed(0)).padStart(4)}  ${(l.location ?? "").slice(0, 12).padEnd(12)} ${l.title.slice(0, 56)}`);
}

if (dry) { console.log("\n[dry] nothing written"); process.exit(0); }

const stmt = d.prepare(
  `UPDATE listings SET delisted_at = $t, delist_reason = 'shop_ad' WHERE id = $id AND delisted_at IS NULL`,
);
const t = now();
for (const l of doomed) stmt.run({ $t: t, $id: l.id });
console.log(`\nretired ${doomed.length} shop advertisement(s)`);
