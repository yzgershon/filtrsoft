/**
 * bun run mc:detail [--limit 40] [--headless] [--dry]
 *
 * Visit each Mercari listing and take the description, the Details block and
 * the full-size gallery slides.
 *
 * Yish, 2026-09-04: *"build the thing we need to analyze the descriptions for
 * mercari."*
 *
 * ── WHY IT IS WORTH A BROWSER VISIT PER LISTING ────────────────────────────
 *
 * A Mercari search card carries a title and a price. That is all. The first
 * working Mercari crawl brought in 99 listings and **90 of them scored
 * INSUFFICIENT_DATA** — the engine asking for a storage size or a GPU that the
 * card could not have told it under any circumstances.
 *
 * OfferUp had exactly this problem, `ou:photos` fixed it, and the effect was
 * measured on 2026-09-04: 146 OfferUp listings went from 2 descriptions to 143
 * and **two BUYs appeared that had been sitting there unreadable**. Same fix,
 * same reason, differently-shaped page.
 *
 * ⚠ A SECOND PASS, NOT PART OF THE CRAWL. One search page yields ~28 listings
 * for one page load; this costs one page load EACH. Folding it into `mc:crawl`
 * turns a one-minute crawl into a twenty-minute one whether the detail was
 * wanted or not.
 *
 * ⚠ AND IT RUNS HEADED BY DEFAULT, unlike its OfferUp counterpart. Mercari sits
 * behind Cloudflare and headless Chrome is served the "Just a moment..."
 * interstitial for every request — measured back to back on the same profile:
 * headed read 28 links per query, headless read zero and was challenged seven
 * times out of seven. `--headless` is accepted so the flag does not error, and
 * it will simply find nothing.
 */
import {
  runMarketWorker, bestPhotos, photoArea,
  parseMercariDetail, mercariDescription,
} from "../sources/marketplace.ts";
import { CHROME_PATH } from "../sources/facebook.ts";
import { db, now } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);
const limit = Number(arg("limit")) || 40;

/**
 * Who needs this: any live Mercari listing with no real description.
 *
 * ⚠ ORDERED BY WHAT HE WOULD ACT ON, not by id. The budget is bounded and a
 * listing the engine already likes is worth resolving before one it has no
 * opinion about — the same ordering `probe.ts` and the Craigslist sweep now
 * use, and for the same reason.
 *
 * `length(description) < 40` rather than `IS NULL`: a crawl can leave a stub
 * (a category breadcrumb, a price line) that is technically text and tells the
 * engine nothing.
 */
type Row = { id: number; url: string; title: string };
const work = db().query(`
  SELECT l.id, l.url, l.title
    FROM listings l
    LEFT JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
   WHERE l.source = 'mercari'
     AND l.delisted_at IS NULL
     AND l.url IS NOT NULL
     AND length(COALESCE(l.description, '')) < 40
   ORDER BY
     CASE v.call WHEN 'BUY' THEN 0 WHEN 'VERIFY' THEN 1 WHEN 'INSUFFICIENT_DATA' THEN 2 ELSE 3 END,
     l.id DESC
   LIMIT $lim
`).all({ $lim: limit }) as Row[];

if (!work.length) {
  console.log("every live Mercari listing already has a description");
  process.exit(0);
}
console.log(`mercari: reading ${work.length} listing page(s)\n`);

const delPhotos = db().query("DELETE FROM listing_photos WHERE listing_id=$id");
const insPhoto = db().query(
  `INSERT INTO listing_photos (listing_id, url, position, captured_at) VALUES ($lid,$url,$pos,$now)`,
);
const setCount = db().query("UPDATE listings SET photo_count=$n WHERE id=$id");
const setDesc = db().query("UPDATE listings SET description=$d WHERE id=$id");

let described = 0, withPhotos = 0, bounced = 0, blocked = 0, failed = 0;

for await (const ev of runMarketWorker("mercari", {
  photosFor: work.map((r) => ({ id: r.id, url: r.url })),
  chromePath: CHROME_PATH,
  headless: has("headless"),
})) {
  if (ev.type === "log") { console.log(`  ${ev.msg}`); continue; }
  if (ev.type === "error") { console.error(`\x1b[31m  ${ev.msg}\x1b[0m`); continue; }
  if (ev.type !== "photos") continue;

  const row = work.find((r) => r.id === ev.id);
  if (!row) continue;
  const label = `#${ev.id} ${row.title.slice(0, 40)}`;

  if (ev.error) { failed++; console.log(`  \x1b[31mfail\x1b[0m  ${label} — ${ev.error.slice(0, 60)}`); continue; }

  /**
   * ⚠ THE CHALLENGE PAGE IS NOT A LISTING, AND IT MUST NEVER BE STORED AS ONE.
   *
   * Cloudflare's interstitial has a title and a body, so a parser that only
   * checks "did we get text" happily writes "Performing security verification"
   * into a listing's description — where the signal layer would then read it,
   * find no specs, and the listing would look permanently unpriceable for a
   * reason nothing recorded.
   */
  if (/just a moment|attention required|security verification/i.test(`${ev.title} ${ev.text ?? ""}`.slice(0, 400))) {
    blocked++;
    console.log(`  \x1b[33mblock\x1b[0m ${label} — bot challenge; run without --headless`);
    continue;
  }

  /**
   * ⚠ A PAGE THAT IS NOT THIS LISTING MUST NOT WRITE ANYTHING. Same rule as
   * `ou:photos`, same reason: a dead item bounces to search or home, and those
   * pages are full of OTHER people's photos and prose. Writing them here gives
   * a delisted listing someone else's specs, and vision would then read the
   * wrong machine confidently. The worst failure available in this codebase.
   */
  if (!/\/item\//.test(ev.finalUrl)) {
    bounced++;
    console.log(`  \x1b[33mskip\x1b[0m  ${label} — bounced to ${ev.finalUrl.replace(/^https:\/\/[^/]+/, "") || "?"}`);
    continue;
  }

  const detail = parseMercariDetail(ev.text ?? "");
  const desc = mercariDescription(detail);
  if (desc) {
    described++;
    if (!has("dry")) setDesc.run({ $d: desc, $id: ev.id });
  }

  /**
   * Photos are a bonus here, not the point, so an empty gallery is not a
   * failure — the description is what makes the listing priceable and it has
   * already been written above.
   */
  const best = bestPhotos(ev.urls);
  if (best.length && !has("dry")) {
    delPhotos.run({ $id: ev.id });
    best.forEach((url, i) => insPhoto.run({ $lid: ev.id, $url: url, $pos: i, $now: now() }));
    setCount.run({ $n: best.length, $id: ev.id });
  }
  if (best.length) withPhotos++;

  const biggest = best.length ? Math.round(Math.sqrt(Math.max(...best.map(photoArea)))) : 0;
  console.log(
    `  \x1b[32mok\x1b[0m    ${label} — ${desc ? `${desc.length} chars` : "no description"}` +
    `${best.length ? `, ${best.length} photo(s) to ${biggest}px²` : ""}`,
  );
}

console.log(
  `\n${described} gained a description · ${withPhotos} got full-size photos` +
  `${bounced ? ` · ${bounced} bounced` : ""}${blocked ? ` · \x1b[33m${blocked} blocked\x1b[0m` : ""}` +
  `${failed ? ` · ${failed} failed` : ""}`,
);
if (described) console.log("Re-score with `bun run verdict`, then ship with `bun run push --source mercari`.");
if (blocked) {
  console.log("\x1b[33mRe-run WITHOUT --headless: Mercari challenges headless Chrome every time.\x1b[0m");
}
