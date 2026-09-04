/**
 * bun run photos:prune [--dry]
 *
 * Delete downloaded listing photos. The perceptual hashes in `listing_photos`
 * are untouched — those are what the risk model uses, and they are what makes
 * the images disposable.
 *
 * Exists for the backlog that built up before retention shipped, and as a
 * manual lever when a volume is already full.
 */
import { prunePhotos, PHOTO_DIR, KEEP_PHOTOS } from "../photos/index.ts";
import { db } from "../db/index.ts";

const dry = process.argv.includes("--dry");
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

if (KEEP_PHOTOS) {
  console.log("FILTRSOFT_KEEP_PHOTOS=1 is set — retention is disabled, pruning anyway on request.");
}

const before = db().query("SELECT COUNT(*) n FROM listing_photos WHERE phash IS NOT NULL").get() as { n: number };
const r = prunePhotos({ dryRun: dry });

console.log(`${dry ? "would delete" : "deleted"}  ${r.dirs} listing folders  ${mb(r.bytes)}`);
console.log(`photo dir: ${PHOTO_DIR}`);

if (!dry) {
  const n = db().run("UPDATE listing_photos SET local_path=NULL WHERE local_path IS NOT NULL");
  console.log(`local_path cleared on ${n.changes} rows (it pointed at files that are gone)`);
}

const after = db().query("SELECT COUNT(*) n FROM listing_photos WHERE phash IS NOT NULL").get() as { n: number };
console.log(`\nperceptual hashes: ${before.n} before, ${after.n} after — the part that matters is untouched.`);
