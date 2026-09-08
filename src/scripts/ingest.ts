import {createPhotoWorkspace,type PhotoWorkspace} from "../photos/index.ts";
/**
 * Fetch listings, run the signal layer, store everything.
 *   bun run src/scripts/ingest.ts <url> [url...]
 *   bun run src/scripts/ingest.ts --testset
 */
import { fetchListing } from "../sources/craigslist.ts";
import { analyze } from "../signals/index.ts";
import { db, now } from "../db/index.ts";
import { upsertListingFacts } from "../db/listings.ts";
import { downloadPhoto, dhash, distance, KEEP_PHOTOS, releasePhotos } from "../photos/index.ts";
import { analyzePhotos, PROMPT_VERSION, VISION_MODEL } from "../vision/index.ts";
import { photoFingerprint } from "../vision/merge.ts";

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

const argv = process.argv.slice(2);
const useVision = argv.includes("--vision");
const args = argv.filter((a) => a !== "--vision");
const targets = args[0] === "--testset"
  ? TESTSET.map(([p, note]) => ({ url: CL + p, note }))
  : args.map((url) => ({ url, note: "" }));

if (!targets.length) {
  console.log("usage: bun run src/scripts/ingest.ts <url>... | --testset");
  process.exit(1);
}

const d = db();
const insPhoto = d.query(
  `INSERT INTO listing_photos (listing_id, url, local_path, phash, position, captured_at)
   VALUES ($lid,$url,$path,$phash,$pos,$cap)`,
);

/**
 * Cross-platform / cross-listing duplicate check (RISK-MODEL 3.4).
 * Hamming distance <= 10 on a 64-bit dhash is a near-duplicate. Same seller
 * cross-posting tells you the TRUE time on market; different seller means one
 * of them stole the photos.
 */
function findDuplicates(phash: string, listingId: number) {
  const rows = d
    .query(
      `SELECT p.phash, p.listing_id, l.url, l.source, l.posted_at, l.title
       FROM listing_photos p JOIN listings l ON l.id = p.listing_id
       WHERE p.phash IS NOT NULL AND p.listing_id != $id`,
    )
    .all({ $id: listingId }) as Array<{
      phash: string; listing_id: number; url: string; source: string; posted_at: string; title: string;
    }>;
  return rows.filter((r) => distance(phash, r.phash) <= 10);
}

const SEV = { blocker: "!!", high: "!", medium: "~", low: ".", info: "+" } as const;

for (const { url, note } of targets) {
  let listingId: number | null = null;
  let workspace:PhotoWorkspace|undefined;
  try {
    const l = await fetchListing(url);
    const r = analyze(l);

    const row = upsertListingFacts(d, {
      source: l.source,
      sourceId: l.sourceId,
      url: l.url,
      title: l.title,
      description: l.description,
      askingPriceCents: l.askingPriceCents,
      location: l.location,
      postedAt: l.postedAt,
      updatedAt: l.updatedAt,
      photoCount: l.photoUrls.length,
      raw: l.raw,
    });
    listingId = row.id;
    workspace=createPhotoWorkspace(row.id);

    // Download EVERY photo and hash it. Never sample — the Phase 0 miss was a
    // skipped third photo that contained the entire spec sheet.
    d.query("DELETE FROM listing_photos WHERE listing_id=$id").run({ $id: row.id });
    const dupes: string[] = [];
    for (const [i, u] of l.photoUrls.entries()) {
      let path: string | null = null, phash: string | null = null;
      try {
        const got = await downloadPhoto(u, row.id, i,workspace);
        path = got.path;
        phash = await dhash(got.buf);
        for (const dup of findDuplicates(phash, row.id)) {
          const msg = `photo ${i} matches ${dup.source} listing "${dup.title.slice(0, 40)}" (posted ${dup.posted_at?.slice(0, 10)})`;
          if (!dupes.includes(msg)) dupes.push(msg);
        }
      } catch { /* a dead image URL must not kill the ingest */ }
      insPhoto.run({ $lid: row.id, $url: u, $path: path, $phash: phash, $pos: i, $cap: now() });
    }

    const price = l.askingPriceCents ? `$${(l.askingPriceCents / 100).toLocaleString()}` : "—";
    console.log(`\n\x1b[1m${l.title}\x1b[0m  ${price}  ${l.location ?? ""}`);
    console.log(
      `  ${r.category} · ${l.photoUrls.length} photos · ${r.daysOnMarket ?? "?"}d on market` +
      ` · quality ${r.listingQuality} · sophistication ${r.sellerSophistication}`,
    );
    if (note) console.log(`  \x1b[2m${note}\x1b[0m`);
    for (const dmsg of dupes) {
      console.log(`  \x1b[35m! DUPLICATE_PHOTOS\x1b[0m — ${dmsg}. Same seller cross-posting means the real time-on-market is the OLDER date; a different seller means one of them took the other's photos.`);
    }
    if (!r.signals.length && !dupes.length) console.log("  (no signals)");

    for (const s of r.signals) {
      const color = s.polarity === "positive" ? "\x1b[32m" : s.polarity === "negative" ? "\x1b[33m" : "\x1b[36m";
      console.log(`  ${color}${SEV[s.severity]} ${s.code}\x1b[0m — ${s.evidence}`);
    }
    if (useVision) {
      const t0 = Date.now();
      const v = await analyzePhotos(row.id,workspace.path);
      const ms = Date.now() - t0;
      if (v) {
        d.query(
          `INSERT INTO vision_results (
             listing_id, model, payload, duration_ms, created_at, cost_micros,
             photo_fingerprint, prompt_version, budget_reservation_id
           ) VALUES ($lid,$model,$p,$ms,$now,$cost,$fp,$prompt,$reservation)`,
        ).run({
          $lid: row.id,
          $model: v.model ?? VISION_MODEL,
          $p: JSON.stringify(v),
          $ms: ms,
          $now: now(),
          $cost: Math.round((v.usage?.costUsd ?? 0) * 1e6),
          $fp: photoFingerprint(row.id),
          $prompt: PROMPT_VERSION,
          $reservation: v.budgetReservationId ?? null,
        });

        const found = Object.entries(v.components).filter(([, x]) => x);
        console.log(`  \x1b[36m→ vision (${(ms / 1000).toFixed(0)}s)\x1b[0m ${found.map(([k, x]) => `${k}=${x}`).join(" · ") || "nothing legible"}`);
        if (v.specScreens?.length) console.log(`    spec screen in photo ${v.specScreens.join(", ")}`);
        if (v.displayOutputsVisible === false)
          console.log(`    \x1b[33m!! no display outputs on the I/O bracket — not usable as a graphics card\x1b[0m`);
        if (v.bootScreenOnly)
          console.log(`    \x1b[33m! boot screen only — proves power, rules out nothing (lock status unverified)\x1b[0m`);
        if (v.screenshotArtifacts)
          console.log(`    \x1b[33m! screenshot artifacts — ${v.screenshotArtifacts}\x1b[0m`);
        if (v.portDamage && v.portCondition)
          console.log(`    \x1b[33m! port condition (FUNCTIONAL, not cosmetic) — ${v.portCondition.slice(0, 120)}\x1b[0m`);
        if (v.unreadable?.length) console.log(`    \x1b[2munreadable photos: ${v.unreadable.join(", ")}\x1b[0m`);
      } else {
        console.log(`  \x1b[2m→ vision failed or timed out\x1b[0m`);
      }
    }
  } catch (e) {
    console.error(`\n✗ ${url}\n  ${(e as Error).message}`);
  } finally {
    if (listingId !== null && !KEEP_PHOTOS) {
      releasePhotos(listingId,workspace);
      d.query("UPDATE listing_photos SET local_path=NULL WHERE listing_id=? AND substr(local_path,1,length(?))=?")
        .run(listingId,workspace?.path??"",workspace?.path??"");
    }
  }
}

const n = d.query("SELECT COUNT(*) n FROM listings").get() as { n: number };
console.log(`\n${n.n} listings stored.`);
