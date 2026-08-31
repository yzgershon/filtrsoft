/**
 * bun run ou:photos [--limit 40] [--all] [--headless] [--dry]
 *
 * Replace OfferUp's 250x250 card thumbnail with every slide from the listing's
 * own detail page, at full resolution.
 *
 * Yish, 2026-08-31: *"OfferUp listings only show 1 photo in worse resolution
 * than the original, when the original listing has like 4 photos it will only
 * show me the hero photo."*
 *
 * ⚠ THIS IS A SECOND PASS, NOT PART OF THE CRAWL, AND THAT IS DELIBERATE.
 * The crawl reads a search results page and gets ~25 listings for one page
 * load. This costs ONE BROWSER VISIT PER LISTING, so folding it into `ou:crawl`
 * would turn a 30-second crawl into a ten-minute one whether or not the photos
 * were wanted. Run it after a crawl, on the backlog it leaves.
 *
 * Runs locally against his signed-in OfferUp profile; production has no
 * browser. `bun run push --source offerup` ships the result.
 */
import {
  runMarketWorker, bestPhotos, photoArea, OU_MIN_EDGE,
} from "../sources/marketplace.ts";
import { db, now } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);
const limit = Number(arg("limit")) || 40;

/**
 * Who needs this: any OfferUp listing whose photos are all card-sized.
 *
 * ⚠ THE TEST IS THE SIZE, NOT THE COUNT. "Fewer than two photos" would re-visit
 * a listing that genuinely has one, forever, and would skip one that has three
 * 250x250 thumbnails from an older crawl. `MAX(long edge) < 640` is the same
 * threshold `bestPhotos` uses to tell a gallery slide from a carousel
 * thumbnail, so a listing is "done" exactly when it has real slides.
 */
type Row = { id: number; url: string; title: string; urls: string };
const candidates = (db().query(`
  SELECT l.id, l.url, l.title,
         COALESCE((SELECT group_concat(p.url, '|') FROM listing_photos p WHERE p.listing_id = l.id), '') urls
  FROM listings l
  WHERE l.source = 'offerup' AND l.delisted_at IS NULL
  ORDER BY l.id DESC
`).all() as Row[]).filter((r) => {
  if (has("all")) return true;
  const urls = r.urls ? r.urls.split("|") : [];
  if (!urls.length) return true;
  return !urls.some((u) => photoArea(u) >= OU_MIN_EDGE * OU_MIN_EDGE * 0.4);
});

const work = candidates.slice(0, limit);
console.log(`\x1b[1mofferup photos\x1b[0m · ${candidates.length} listing(s) still on card thumbnails, doing ${work.length}`);
if (!work.length) process.exit(0);

const delPhotos = db().query("DELETE FROM listing_photos WHERE listing_id=$id");
const insPhoto = db().query(
  `INSERT INTO listing_photos (listing_id, url, position, captured_at)
   VALUES ($lid,$url,$pos,$now)`,
);
const setCount = db().query("UPDATE listings SET photo_count=$n WHERE id=$id");

let fixed = 0, empty = 0, gone = 0, failed = 0, photos = 0;

for await (const ev of runMarketWorker("offerup", {
  photosFor: work.map((r) => ({ id: r.id, url: r.url })),
  headless: has("headless"),
})) {
  if (ev.type === "log") { console.log(`  ${ev.msg}`); continue; }
  if (ev.type === "error") { console.error(`\x1b[31m  ${ev.msg}\x1b[0m`); continue; }
  if (ev.type !== "photos") continue;

  const row = work.find((r) => r.id === ev.id)!;
  const label = `#${ev.id} ${row.title.slice(0, 40)}`;

  if (ev.error) { failed++; console.log(`  \x1b[31mfail\x1b[0m  ${label} — ${ev.error.slice(0, 60)}`); continue; }

  /**
   * ⚠ A PAGE THAT IS NOT THIS LISTING MUST NOT WRITE PHOTOS.
   *
   * OfferUp answers a dead item by BOUNCING you to search or home rather than
   * 404ing (the same behaviour `probeVerdict` documents). Those pages are full
   * of `images.offerup.com` urls belonging to other people's listings, and
   * writing them here would give a delisted listing someone else's photos —
   * then vision would read specs off the wrong machine and produce a confident
   * wrong verdict. The worst failure available in this codebase.
   *
   * OfferUp titles the tab "<listing title> for Sale in <city> — OfferUp" while
   * the item exists, so the title carrying the item path is the cheap proof
   * that we are still on it.
   */
  const stillHere = ev.finalUrl.includes("/item/detail/") && /for sale in/i.test(ev.title);
  if (!stillHere) {
    gone++;
    console.log(`  \x1b[33mskip\x1b[0m  ${label} — bounced to ${ev.finalUrl.replace(/^https:\/\/[^/]+/, "") || "?"}`);
    continue;
  }

  const best = bestPhotos(ev.urls);
  if (!best.length) {
    empty++;
    console.log(`  \x1b[33mnone\x1b[0m  ${label} — ${ev.urls.length} urls, none above ${OU_MIN_EDGE}px`);
    continue;
  }

  const biggest = Math.max(...best.map(photoArea));
  console.log(`  \x1b[32mok\x1b[0m    ${label} — ${best.length} photo(s), largest ${Math.round(Math.sqrt(biggest))}px²`);
  photos += best.length;
  fixed++;

  if (has("dry")) continue;
  db().transaction(() => {
    delPhotos.run({ $id: ev.id });
    for (const [i, u] of best.entries()) {
      insPhoto.run({ $lid: ev.id, $url: u, $pos: i, $now: now() });
    }
    setCount.run({ $n: best.length, $id: ev.id });
  })();
}

console.log(
  `\n${fixed} listing(s) now carry ${photos} full-size photo(s)` +
  `${empty ? ` · ${empty} had none` : ""}${gone ? ` · ${gone} bounced` : ""}${failed ? ` · ${failed} failed` : ""}`,
);
if (fixed && !has("dry")) {
  console.log("Re-score with `bun run verdict`, then ship with `bun run push --source offerup`.");
}
