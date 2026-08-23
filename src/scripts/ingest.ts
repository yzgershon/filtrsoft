/**
 * Fetch listings, run the signal layer, store everything.
 *   bun run src/scripts/ingest.ts <url> [url...]
 *   bun run src/scripts/ingest.ts --testset
 */
import { fetchListing } from "../sources/craigslist.ts";
import { analyze } from "../signals/index.ts";
import { db, now } from "../db/index.ts";

const CL = "https://www.craigslist.org/view/d/";
const TESTSET: Array<[string, string]> = [
  ["bedford-gaming-desktop-pc-intel-i7/nN7jrXTfv6AVCtnJ8Fpeiy", "expect IMPOSSIBLE_SPEC_CLAIM (Gen4 on LGA1151)"],
  ["northborough-nvidia-tesla-p100-16gb-ram/iX1r7ArBBtA8ZauspYRp2L", "expect NO_DISPLAY_OUTPUT + SPEC_SHEET_LANGUAGE"],
  ["cambridge-unlocked-samsung-galaxy-fold/tQetqP7FWBwPC8JrZzkTcy", "expect ZERO_PHOTOS + GEOGRAPHIC_CONTRADICTION"],
  ["boston-iphone-16-pro-max-1tb-black/b1emmvvtydfkcnd9QJj9qH", "expect IRREVERSIBLE_PAYMENT"],
  ["boston-a-inch-imac/uwTqk3oKnQq78VGAh7vxMy", "expect CONDITION_CONTRADICTION"],
  ["dedham-gaming-pc-specs-in-pictures/gMzZYgnKHvutP3SWCv4bbz", "expect MISSING_VALUE_FIELDS + LOW_SELLER_KNOWLEDGE"],
  ["cambridge-apple-iphone-gb/4tkkpAuBMH6YKnNsnrESoN", "expect IMPOSSIBLE_CONNECTOR if Lightning is mentioned"],
  ["sharon-dell-latitude-i7-32gb-512gb/8ELzrQjvshdzguCaKRoxne", "expect high quality + high sophistication, few negatives"],
];

const args = process.argv.slice(2);
const targets = args[0] === "--testset"
  ? TESTSET.map(([p, note]) => ({ url: CL + p, note }))
  : args.map((url) => ({ url, note: "" }));

if (!targets.length) {
  console.log("usage: bun run src/scripts/ingest.ts <url>... | --testset");
  process.exit(1);
}

const d = db();
const ins = d.query(
  `INSERT INTO listings (source, source_id, url, title, description, asking_price_cents,
     location, posted_at, updated_at, captured_at, photo_count, raw_json)
   VALUES ($src,$sid,$url,$title,$desc,$price,$loc,$posted,$updated,$cap,$photos,$raw)
   ON CONFLICT(source, source_id) DO UPDATE SET
     updated_at=excluded.updated_at, captured_at=excluded.captured_at,
     asking_price_cents=excluded.asking_price_cents
   RETURNING id`,
);
const insPhoto = d.query(
  `INSERT INTO listing_photos (listing_id, url, position, captured_at)
   VALUES ($lid,$url,$pos,$cap)`,
);

const SEV = { blocker: "!!", high: "!", medium: "~", low: ".", info: "+" } as const;

for (const { url, note } of targets) {
  try {
    const l = await fetchListing(url);
    const r = analyze(l);

    const row = ins.get({
      $src: l.source, $sid: l.sourceId, $url: l.url, $title: l.title,
      $desc: l.description, $price: l.askingPriceCents, $loc: l.location,
      $posted: l.postedAt, $updated: l.updatedAt, $cap: now(),
      $photos: l.photoUrls.length, $raw: JSON.stringify(l.raw),
    }) as { id: number };

    d.query("DELETE FROM listing_photos WHERE listing_id=$id").run({ $id: row.id });
    l.photoUrls.forEach((u, i) =>
      insPhoto.run({ $lid: row.id, $url: u, $pos: i, $cap: now() }));

    const price = l.askingPriceCents ? `$${(l.askingPriceCents / 100).toLocaleString()}` : "—";
    console.log(`\n\x1b[1m${l.title}\x1b[0m  ${price}  ${l.location ?? ""}`);
    console.log(
      `  ${r.category} · ${l.photoUrls.length} photos · ${r.daysOnMarket ?? "?"}d on market` +
      ` · quality ${r.listingQuality} · sophistication ${r.sellerSophistication}`,
    );
    if (note) console.log(`  \x1b[2m${note}\x1b[0m`);
    if (!r.signals.length) console.log("  (no signals)");
    for (const s of r.signals) {
      const color = s.polarity === "positive" ? "\x1b[32m" : s.polarity === "negative" ? "\x1b[33m" : "\x1b[36m";
      console.log(`  ${color}${SEV[s.severity]} ${s.code}\x1b[0m — ${s.evidence}`);
    }
  } catch (e) {
    console.error(`\n✗ ${url}\n  ${(e as Error).message}`);
  }
}

const n = d.query("SELECT COUNT(*) n FROM listings").get() as { n: number };
console.log(`\n${n.n} listings stored.`);
