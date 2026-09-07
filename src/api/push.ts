/**
 * Pushing locally-crawled listings to production.
 *
 * **WHY THIS EXISTS AT ALL.** Craigslist is a plain `fetch()`, so the container
 * crawls it itself. Facebook Marketplace is not: it needs a logged-in Chrome
 * profile that Yish signs into by hand, and putting session cookies in a server
 * image is both a security problem and a line this project does not cross. So
 * Facebook listings are crawled on his machine and pushed here.
 *
 * **THE SERVER RE-SCORES EVERYTHING IT RECEIVES.** The push carries listing
 * FACTS — title, description, price, photos — and never a verdict. Production
 * runs its own engine over them on arrival.
 *
 * That is deliberate. If the client sent verdicts, the feed would silently mix
 * calls from whatever engine version happened to be on a laptop, and the
 * `reverdictStale` mechanism could never correct them because they would
 * already claim the current version. Facts are portable; judgements are not.
 *
 * **AUTH IS A SHARED SECRET IN AN ENV VAR**, never in the repo and never
 * entered into a web form. Without `FILTRSOFT_PUSH_TOKEN` set on the server the
 * endpoint refuses every request, including empty ones — an unauthenticated
 * write path into the deals feed is a way for anyone to put anything in front
 * of a buyer.
 */
import type { Context } from "hono";
import { db, now } from "../db/index.ts";
import { upsertListingFacts } from "../db/listings.ts";
import { storeVerdict } from "../db/verdicts.ts";
import { checkStored, ENGINE_VERSION } from "../engine/index.ts";
import { receiveChanges } from "../sync/receive.ts";
import { syncPhotoUrls } from "../vision/merge.ts";

export interface PushListing {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  description: string;
  askingPriceCents: number | null;
  location: string | null;
  postedAt: string | null;
  sellerRef: string | null;
  photoUrls: string[];
  raw?: unknown;
}

export interface PushResult {
  received: number;
  inserted: number;
  updated: number;
  scored: number;
  /** Thumbnails we took our own copy of. See `cacheThumbs` below. */
  thumbed?: number;
  calls: Record<string, number>;
}

export async function ingestPushed(listings: PushListing[]): Promise<PushResult> {
  const d = db();
  const res: PushResult = { received: listings.length, inserted: 0, updated: 0, scored: 0, calls: {} };

  const ids: number[] = [];
  d.transaction(() => {
    for (const l of listings) {
      if (!l.sourceId || !l.url || !l.title) continue;
      const photoUrls = [...new Set(l.photoUrls ?? [])];
      const existing = d.query("SELECT last_seen,captured_at FROM listings WHERE source=? AND source_id=?").get(l.source,l.sourceId) as {last_seen:string|null;captured_at:string}|null;
      const at = existing?.last_seen ?? existing?.captured_at ?? now();
      const stored = upsertListingFacts(d, {
        source: l.source,
        sourceId: l.sourceId,
        url: l.url,
        title: l.title,
        description: l.description ?? "",
        askingPriceCents: l.askingPriceCents,
        location: l.location,
        postedAt: l.postedAt,
        updatedAt: null,
        photoCount: photoUrls.length,
        sellerRef: l.sellerRef,
        raw: l.raw,
        partial: true,
      }, at);
      if (stored.inserted) res.inserted++;
      else res.updated++;

      // Replace even when the new set is empty. Keeping yesterday's thumbnails
      // after a seller removes every photo is stale evidence, not a cache.
      if (stored.inserted) syncPhotoUrls(stored.id,photoUrls);
      d.run("INSERT INTO listing_rechecks VALUES(?, 'legacy_sync', ?) ON CONFLICT(listing_id) DO UPDATE SET requested_at=excluded.requested_at",[stored.id,now()]);
      ids.push(stored.id);
    }
  })();

  // Scored OUTSIDE the write transaction: valuation reads comps and can be slow
  // on a large push, and holding a write lock across it blocks the crawl loop.
  for (const id of ids) {
    try {
      const { verdict } = checkStored(id, {});
      storeVerdict(id, ENGINE_VERSION, verdict);
      res.scored++;
      res.calls[verdict.call] = (res.calls[verdict.call] ?? 0) + 1;
    } catch {
      // One bad listing must not fail the batch.
    }
  }
  // The scheduler thumbnail backfill owns image I/O after the facts are accepted.
  return res;
}

/** `POST /v1/push` — bearer-token guarded. */
export async function handlePush(c: Context) {
  const token = process.env.FILTRSOFT_PUSH_TOKEN;
  if (!token) return c.json({ error: "push not enabled on this server" }, 503);

  const auth = c.req.header("authorization") ?? "";
  if (auth !== `Bearer ${token}`) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json().catch(() => null) as { version?:number; listings?: PushListing[] } | null;
  if(body?.version===2) {
    try { return c.json(receiveChanges(body)); }
    catch { return c.json({error:"invalid sync envelope or conflicting revision"},400); }
  }
  if (!body?.listings?.length) return c.json({ error: "no listings" }, 400);
  if (body.listings.length > 300) return c.json({ error: "max 300 per push" }, 400);

  return c.json(await ingestPushed(body.listings));
}
