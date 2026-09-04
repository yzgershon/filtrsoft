/**
 * bun run thumbs [--limit 200] [--prune] [--stats] [--refresh]
 *
 * Take our own copy of each listing's first photo, so the feed keeps showing it
 * after the source url dies.
 *
 * ⚠ **FACEBOOK SIGNS ITS CDN URLS WITH A ~2-DAY LIFE.** Measured on the live
 * feed on 2026-08-31: every failing image carried an `oe=` expiry in the PAST
 * and every working one about 40 hours ahead. The feed keeps a listing for 28
 * days, so from roughly day two a Facebook card is guaranteed to render the
 * broken-image placeholder — Yish: *"some images still aren't going through …
 * there are some stragglers from facebook and craigslist as well."*
 *
 * ⚠ RUN IT SOON AFTER A CRAWL. This is the pass that races the expiry, and it
 * can only save what is still fetchable. Production does this automatically at
 * push time (`api/push.ts`), which is minutes after the crawl; this script is
 * the backfill and the local equivalent.
 *
 * The bounds that keep this from repeating the 2026-08 volume outage are in
 * `photos/thumb.ts`. Read them before raising anything.
 */
import { cacheThumb, pruneThumbs, thumbStats, THUMB_EDGE, THUMBS_OFF } from "../photos/thumb.ts";
import { db } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const show = () => {
  const s = thumbStats();
  const avg = s.count ? Math.round(s.bytes / s.count / 1024) : 0;
  console.log(`cache: ${s.count} thumbnail(s), ${(s.bytes / 1e6).toFixed(1)} MB, ${avg} KB each`);
};

if (THUMBS_OFF) {
  console.log("FILTRSOFT_NO_THUMB_CACHE=1 — the cache is switched off.");
  process.exit(0);
}

if (has("stats")) { show(); process.exit(0); }

if (has("prune")) {
  const r = pruneThumbs();
  console.log(`pruned ${r.deleted} (${(r.freedBytes / 1e6).toFixed(1)} MB freed)`);
  show();
  process.exit(0);
}

/**
 * ⚠ ORDERED BY WHEN THE PHOTO WAS CAPTURED, NOT BY LISTING ID.
 *
 * The only thing that decides whether a fetch can still succeed is how fresh
 * the url is, and `l.id DESC` is a proxy for how recently the LISTING was
 * created — a different quantity. Measured against production: ordering by id
 * cached 188 thumbnails and **none of them Facebook**, because those rows were
 * pushed earlier while the container keeps minting fresh Craigslist ids. It was
 * working hardest on the source that needed it least.
 */
type Row = { id: number; source: string; url: string };
const rows = db().query(`
  SELECT p.listing_id AS id, l.source, p.url
  FROM listing_photos p
  JOIN listings l ON l.id = p.listing_id
  WHERE p.position = 0
    AND l.delisted_at IS NULL
    ${has("refresh") ? "" : "AND NOT EXISTS(SELECT 1 FROM listing_thumbs t WHERE t.listing_id = p.listing_id)"}
  ORDER BY p.captured_at DESC
`).all().filter((r) => (r as Row).url) as Row[];

const limit = Number(arg("limit")) || 200;
const work = rows.slice(0, limit);
console.log(`\x1b[1mthumbnails\x1b[0m · ${rows.length} listing(s) without one, doing ${work.length} at ${THUMB_EDGE}px`);
show();

const tally: Record<string, Record<string, number>> = {};
const bump = (src: string, k: string) => {
  (tally[src] ??= {})[k] = (tally[src][k] ?? 0) + 1;
};

/**
 * Six at a time. Enough to be quick over a few hundred, few enough that three
 * different CDNs do not read it as a burst — the same reason the sweep caps its
 * probes.
 */
const queue = [...work];
let done = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  for (;;) {
    const r = queue.pop();
    if (!r) return;
    const outcome = await cacheThumb(r.id, r.url).catch(() => "unfetchable" as const);
    bump(r.source, outcome);
    if (++done % 25 === 0) process.stdout.write(`  ${done}/${work.length}\r`);
  }
}));

console.log(`\n`);
for (const [src, counts] of Object.entries(tally).sort()) {
  const line = Object.entries(counts).sort().map(([k, n]) => `${k} ${n}`).join(" · ");
  console.log(`  ${src.padEnd(12)} ${line}`);
}
console.log("");
show();
console.log(
  "\n`unfetchable` is a url that already died. For facebook that is the ~2-day\n" +
  "signature expiring, and re-crawling is the only way to get those back.",
);
