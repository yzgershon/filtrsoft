/**
 * One small, self-hosted thumbnail per listing.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT A REVERSAL OF THE RETENTION RULE ────
 *
 * Yish, 2026-08-31: *"some images still aren't going through, primarily from
 * OfferUp but there are some stragglers from Facebook and Craigslist as well."*
 *
 * **MEASURED, NOT GUESSED: Facebook signs its CDN urls with a ~2-day life.**
 * Every failing url on the live feed carried `oe=` in the PAST and every
 * working one carried a timestamp about 40 hours ahead:
 *
 *     403  oe -> 2026-08-30T11:34   (checked at 2026-08-31T18:21)
 *     200  oe -> 2026-09-01T14:46 … 17:39
 *
 * The feed keeps a listing for 28 days. So after roughly day two, a Facebook
 * listing is guaranteed to render the broken-image placeholder, and nothing in
 * the app can prevent it: the token is dead, so a proxy 403s exactly the same
 * way the browser does. The only fix is to hold the bytes while the url is
 * still alive — and production cannot re-crawl Facebook, because that needs his
 * signed-in browser.
 *
 * ⚠ THIS IS DELIBERATELY NOT THE THING THAT CAUSED THE 2026-08 OUTAGE. That was
 * full-resolution photos on the volume: 316 MB for 654 listings, ~480 KB each,
 * unbounded, on the same disk as the database — it filled up and took the
 * crawler down for 13 hours while the feed still looked healthy. Every property
 * that made it dangerous is inverted here:
 *
 *   · ONE image per listing, not every photo. Enforced by the primary key.
 *   · A THUMBNAIL — 480px long edge, WebP q72 — not the original. ~20 KB
 *     against ~480 KB.
 *   · A hard `MAX_BYTES` refusal, so a pathological encode is dropped rather
 *     than stored.
 *   · Pruned by the same 28-day window the feed uses, so the working set is
 *     bounded by the feed rather than by time.
 *   · In the DATABASE, not on the filesystem. A crash between download and
 *     write cannot leave an orphan the way a directory of files could — that
 *     was one of the ways the old backlog accumulated.
 *   · `ASSYZE_NO_THUMB_CACHE=1` turns it off entirely.
 *
 * At ~20 KB and today's ~1,000 production listings that is about 20 MB, and the
 * prune holds it there.
 */
import sharp from "sharp";
import { db, now } from "../db/index.ts";

/** The long edge. The feed renders cards at 160 CSS px, so 480 covers 3x. */
export const THUMB_EDGE = 480;

/**
 * ⚠ A CEILING, NOT A TARGET. WebP at q72 puts a 480px product photo at 15-30
 * KB; anything that encodes past 200 KB is not a product photo (an enormous
 * PNG screenshot, an animation) and is refused rather than stored. A cache with
 * no refusal path is how the last one grew without bound.
 */
export const MAX_BYTES = 200_000;

export const THUMBS_OFF = process.env.ASSYZE_NO_THUMB_CACHE === "1";

export interface Thumb {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

/**
 * Fetch and shrink. Returns null for anything that is not a usable image —
 * including the 403 this whole module exists to get ahead of.
 *
 * ⚠ THE TIMEOUT IS LOAD-BEARING. This runs inside the push handler, once per
 * listing. A CDN that hangs would otherwise hold a request open for the
 * platform's full timeout and turn one slow image into a failed push.
 */
export async function fetchThumb(url: string, timeoutMs = 15_000): Promise<Thumb | null> {
  let buf: Buffer;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Facebook's CDN serves a 403 to a bare fetch with no Accept header.
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36",
      },
    });
    if (!res.ok) return null;
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
  if (!buf.length) return null;
  // Not an image, or a format sharp cannot read, comes back null from here —
  // not worth a log line per listing, `bun run thumbs` reports the counts.
  return thumbFromBytes(buf);
}

/**
 * Shrink bytes we ALREADY HAVE. No second request.
 *
 * ⚠ THIS IS THE CHEAP PATH AND IT IS THE ONE THE CRAWLER SHOULD USE.
 * `persistPhotos` downloads every photo anyway to compute its perceptual hash,
 * so the hero's bytes are sitting in memory at exactly the moment a thumbnail
 * is wanted. Calling `fetchThumb` there would re-request an image we are
 * holding — one extra round trip per listing, against a source we are already
 * trying not to hammer.
 */
export async function thumbFromBytes(buf: Buffer | Uint8Array): Promise<Thumb | null> {
  try {
    const out = await sharp(buf)
      .rotate()
      .resize(THUMB_EDGE, THUMB_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer({ resolveWithObject: true });
    if (out.data.length > MAX_BYTES) return null;
    return {
      bytes: new Uint8Array(out.data),
      mime: "image/webp",
      width: out.info.width,
      height: out.info.height,
    };
  } catch {
    return null;
  }
}

export function putThumb(listingId: number, src: string, t: Thumb): void {
  db().query(
    `INSERT INTO listing_thumbs (listing_id, bytes, mime, width, height, src, bytes_len, captured_at)
     VALUES ($id,$b,$m,$w,$h,$src,$len,$at)
     ON CONFLICT(listing_id) DO UPDATE SET
       bytes=excluded.bytes, mime=excluded.mime, width=excluded.width,
       height=excluded.height, src=excluded.src, bytes_len=excluded.bytes_len,
       captured_at=excluded.captured_at`,
  ).run({
    $id: listingId, $b: t.bytes, $m: t.mime, $w: t.width, $h: t.height,
    $src: src, $len: t.bytes.length, $at: now(),
  });
}

/**
 * ⚠ RETURNS AN `ArrayBuffer`, AND THE COPY IS NOT WASTE.
 *
 * `bun:sqlite` hands back a `Uint8Array<ArrayBufferLike>`, and ArrayBufferLike
 * includes SharedArrayBuffer — which is not transferable, so TypeScript refuses
 * it as a `BodyInit` or a `BlobPart`. `new Uint8Array(view)` allocates a plain
 * ArrayBuffer, which is the honest type for something about to become an HTTP
 * body. Exactly the same trap as `urlB64ToBytes` in the web app; `as any` there
 * would have hidden a real incompatibility rather than fixed one.
 *
 * ~20 KB per request.
 */
export function getThumb(listingId: number): { bytes: ArrayBuffer; mime: string; length: number } | null {
  const r = db().query("SELECT bytes, mime FROM listing_thumbs WHERE listing_id=?")
    .get(listingId) as { bytes: Uint8Array; mime: string } | null;
  if (!r) return null;
  const copy = new Uint8Array(r.bytes);
  return { bytes: copy.buffer, mime: r.mime, length: copy.length };
}

/**
 * Cache a listing's FIRST photo, if we do not already hold that exact url.
 *
 * ⚠ KEYED ON THE SOURCE URL, WHICH IS WHAT MAKES A RE-PUSH CHEAP AND A
 * RE-CRAWL CORRECT. Facebook re-signs the same photo with a new token every
 * crawl, so comparing urls would re-download everything; comparing the STORED
 * url to the incoming one and skipping when equal is not enough on its own.
 * The rule is: if we hold a thumb for this listing and the incoming url is the
 * same string, do nothing. A NEW url means the photo genuinely changed OR the
 * signature rotated, and re-downloading is correct either way — the bytes we
 * hold may be about to expire from under us anyway.
 *
 * Returns what happened, so the caller can report counts instead of guessing.
 */
export type ThumbOutcome = "cached" | "kept" | "unfetchable" | "skipped";

/**
 * ⚠ HOW MANY TIMES A URL MAY FAIL BEFORE THE BACKFILL STOPS OFFERING IT.
 *
 * A budget, NOT a tombstone. Measured on production: the crawl tick cached ~5
 * of 25 attempted while only 10% of the remaining urls were actually dead, and
 * the same urls fetched 40/40 from a laptop — so most failures are the small
 * container timing out under its own crawl-and-score load, not a dead image.
 * One strike would permanently discard rows that are perfectly fetchable. Three
 * separates "busy" from "gone".
 */
export const MISS_BUDGET = 3;

export async function cacheThumb(
  listingId: number, url: string | null | undefined, timeoutMs?: number,
): Promise<ThumbOutcome> {
  if (THUMBS_OFF || !url) return "skipped";
  const have = db().query("SELECT src FROM listing_thumbs WHERE listing_id=?")
    .get(listingId) as { src: string } | null;
  if (have && have.src === url) return "kept";

  const t = await fetchThumb(url, timeoutMs);
  if (!t) {
    /**
     * ⚠ RECORD THE FAILURE OR THE BACKFILL RETRIES IT FOREVER. `putThumb` is
     * never reached here, so without this row the listing stays eligible and
     * comes back on the next tick, and the next, for the 28 days it lives.
     *
     * `src` is part of the identity: a re-crawl re-signs a Facebook url, and a
     * NEW url deserves a fresh budget because it genuinely might work now.
     */
    db().query(
      `INSERT INTO listing_thumb_misses (listing_id, src, tries, last_try)
       VALUES ($id,$src,1,$at)
       ON CONFLICT(listing_id) DO UPDATE SET
         tries = CASE WHEN listing_thumb_misses.src = excluded.src
                      THEN listing_thumb_misses.tries + 1 ELSE 1 END,
         src = excluded.src,
         last_try = excluded.last_try`,
    ).run({ $id: listingId, $src: url, $at: now() });
    return "unfetchable";
  }
  putThumb(listingId, url, t);
  // It worked, so the budget is spent on nothing. Clear it.
  db().query("DELETE FROM listing_thumb_misses WHERE listing_id=?").run(listingId);
  return "cached";
}

/**
 * Drop thumbs the feed can no longer show.
 *
 * ⚠ THE WINDOW MUST MATCH `/v1/feed`'s. It excludes anything posted more than
 * 28 days ago, so a thumb older than that can never be rendered and is pure
 * cost. Delisted listings go too. Keeping these two numbers in agreement is
 * what bounds the cache by the FEED rather than by time — if the feed's window
 * changes, change this with it.
 */
export const THUMB_KEEP_DAYS = 28;

export function pruneThumbs(): { deleted: number; freedBytes: number; keptBytes: number } {
  const before = db().query("SELECT COUNT(*) n, COALESCE(SUM(bytes_len),0) b FROM listing_thumbs")
    .get() as { n: number; b: number };

  db().exec(`
    DELETE FROM listing_thumbs WHERE listing_id IN (
      SELECT t.listing_id FROM listing_thumbs t
      LEFT JOIN listings l ON l.id = t.listing_id
      WHERE l.id IS NULL
         OR l.delisted_at IS NOT NULL
         OR (l.posted_at IS NOT NULL
             AND julianday('now') - julianday(l.posted_at) > ${THUMB_KEEP_DAYS})
    )`);

  /**
   * ⚠ THE MISS ROWS GO WITH THEM. They are tiny, but they are keyed on
   * `listing_id` and nothing else would ever delete them — an unbounded table
   * is an unbounded table whatever its row size, and this cache exists under a
   * rule written after one filled a disk.
   */
  db().exec(`
    DELETE FROM listing_thumb_misses WHERE listing_id IN (
      SELECT m.listing_id FROM listing_thumb_misses m
      LEFT JOIN listings l ON l.id = m.listing_id
      WHERE l.id IS NULL
         OR l.delisted_at IS NOT NULL
         OR (l.posted_at IS NOT NULL
             AND julianday('now') - julianday(l.posted_at) > ${THUMB_KEEP_DAYS})
    )`);

  const after = db().query("SELECT COUNT(*) n, COALESCE(SUM(bytes_len),0) b FROM listing_thumbs")
    .get() as { n: number; b: number };
  return { deleted: before.n - after.n, freedBytes: before.b - after.b, keptBytes: after.b };
}

/**
 * Cache a few listings that have no thumbnail yet. Bounded, for the crawl loop.
 *
 * ⚠ ORDERED BY WHEN THE PHOTO WAS CAPTURED, NOT BY LISTING ID, AND THE
 * DIFFERENCE IS THE WHOLE POINT OF THE BACKFILL.
 *
 * The first version ordered `l.id DESC`, which is a proxy for how recently the
 * LISTING was created — and that put Facebook LAST, because those rows were
 * pushed earlier while the container keeps minting fresh Craigslist ids. Watched
 * running against production: 188 thumbnails cached, **0 of them Facebook**,
 * which is the one source whose urls expire. The backfill was working hardest
 * on the rows that needed it least.
 *
 * `listing_photos.captured_at` is literally "how fresh is this url", which is
 * the only thing that decides whether a fetch can still succeed. A re-crawl or
 * a re-push updates it, so a listing whose photo url was just re-signed goes
 * back to the front of the queue.
 *
 * ⚠ AND IT MUST STAY SMALL PER TICK. This is network I/O inside the loop that
 * also crawls and scores. 25 at 6-wide is a couple of seconds; it drains a
 * thousand-listing backlog over about two hours of ticks, which is the right
 * shape for something self-healing rather than something that blocks a tick.
 */
export async function backfillThumbs(limit = 25): Promise<{ cached: number; missed: number; tried: number }> {
  if (THUMBS_OFF) return { cached: 0, missed: 0, tried: 0 };
  const rows = db().query(`
    SELECT p.listing_id AS id, p.url, p.captured_at
    FROM listing_photos p
    JOIN listings l ON l.id = p.listing_id
    WHERE p.position = 0
      AND l.delisted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM listing_thumbs t WHERE t.listing_id = p.listing_id)
      /* Spent its retry budget on THIS url. A re-crawl changes the url and the
         budget resets, which is the only way a dead signature comes back. */
      AND NOT EXISTS(
        SELECT 1 FROM listing_thumb_misses m
        WHERE m.listing_id = p.listing_id AND m.src = p.url AND m.tries >= ${MISS_BUDGET})
    ORDER BY p.captured_at DESC
    LIMIT $n
  `).all({ $n: limit }) as Array<{ id: number; url: string | null }>;

  const queue = rows.filter((r) => r.url);
  let cached = 0, missed = 0;
  /**
   * ⚠ THREE WORKERS HERE, NOT SIX, AND A LONGER TIMEOUT.
   *
   * This runs at the END of a tick that has already crawled, scored and
   * possibly called vision, on a small container. Measured: at 6-wide with an
   * 8s abort it landed ~5 of 25, while the same urls fetched 40/40 from a
   * laptop — the failures were our own contention, not the images. Fewer in
   * flight and more patience trades wall-clock (which a 3-minute tick has) for
   * yield (which the 48-hour Facebook expiry does not).
   */
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (;;) {
      const r = queue.pop();
      if (!r) return;
      try {
        const outcome = await cacheThumb(r.id, r.url, 20_000);
        if (outcome === "cached") cached++;
        else if (outcome === "unfetchable") missed++;
      } catch { /* never let an image fail a tick */ }
    }
  }));
  return { cached, missed, tried: rows.length };
}

export function thumbStats(): { count: number; bytes: number } {
  const r = db().query("SELECT COUNT(*) n, COALESCE(SUM(bytes_len),0) b FROM listing_thumbs")
    .get() as { n: number; b: number };
  return { count: r.n, bytes: r.b };
}
