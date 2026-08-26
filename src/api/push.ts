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
 * entered into a web form. Without `ASSYZE_PUSH_TOKEN` set on the server the
 * endpoint refuses every request, including empty ones — an unauthenticated
 * write path into the deals feed is a way for anyone to put anything in front
 * of a buyer.
 */
import type { Context } from "hono";
import { db, now } from "../db/index.ts";
import { checkStored, ENGINE_VERSION } from "../engine/index.ts";

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
  calls: Record<string, number>;
}

export function ingestPushed(listings: PushListing[]): PushResult {
  const d = db();
  const res: PushResult = { received: listings.length, inserted: 0, updated: 0, scored: 0, calls: {} };

  const findId = d.query(`SELECT id FROM listings WHERE source=$s AND source_id=$sid`);
  const ins = d.query(
    `INSERT INTO listings (source, source_id, url, title, description, asking_price_cents,
        location, posted_at, updated_at, captured_at, photo_count, seller_ref, raw_json, last_seen)
     VALUES ($s,$sid,$url,$t,$desc,$price,$loc,$posted,$now,$now,$pc,$seller,$raw,$now)`,
  );
  /**
   * An existing listing is UPDATED, not skipped. A re-push is how a price drop
   * arrives — and a price drop is the single most actionable event in this
   * whole system, so treating a known id as "nothing to do" would throw away
   * the best signal the crawler produces.
   */
  const upd = d.query(
    `UPDATE listings SET title=$t, description=$desc, asking_price_cents=$price,
        location=$loc, updated_at=$now, last_seen=$now, photo_count=$pc,
        last_price_cents=asking_price_cents, delisted_at=NULL, delist_reason=NULL
      WHERE id=$id`,
  );
  const delPhotos = d.query(`DELETE FROM listing_photos WHERE listing_id=$id`);
  const insPhoto = d.query(
    `INSERT INTO listing_photos (listing_id, url, position, captured_at)
     VALUES ($lid,$url,$pos,$now)`,
  );
  const insVerdict = d.query(
    `INSERT INTO verdicts (listing_id, engine_version, call, confidence, payload, created_at)
     VALUES ($lid,$v,$call,$conf,$p,$now)`,
  );

  const ids: number[] = [];
  d.transaction(() => {
    for (const l of listings) {
      if (!l.sourceId || !l.url || !l.title) continue;
      const p = {
        $s: l.source, $sid: l.sourceId, $url: l.url, $t: l.title,
        $desc: l.description ?? "", $price: l.askingPriceCents,
        $loc: l.location, $posted: l.postedAt, $now: now(),
        $pc: l.photoUrls?.length ?? 0, $seller: l.sellerRef,
        $raw: JSON.stringify(l.raw ?? {}),
      };
      const existing = findId.get({ $s: l.source, $sid: l.sourceId }) as { id: number } | null;
      let id: number;
      if (existing) {
        upd.run({ ...p, $id: existing.id });
        id = existing.id;
        res.updated++;
      } else {
        ins.run(p);
        id = (findId.get({ $s: l.source, $sid: l.sourceId }) as { id: number }).id;
        res.inserted++;
      }
      if (l.photoUrls?.length) {
        delPhotos.run({ $id: id });
        l.photoUrls.slice(0, 24).forEach((u, i) =>
          insPhoto.run({ $lid: id, $url: u, $pos: i, $now: now() }));
      }
      ids.push(id);
    }
  })();

  // Scored OUTSIDE the write transaction: valuation reads comps and can be slow
  // on a large push, and holding a write lock across it blocks the crawl loop.
  for (const id of ids) {
    try {
      const { verdict } = checkStored(id, {});
      insVerdict.run({
        $lid: id, $v: ENGINE_VERSION, $call: verdict.call,
        $conf: verdict.confidence, $p: JSON.stringify(verdict), $now: now(),
      });
      res.scored++;
      res.calls[verdict.call] = (res.calls[verdict.call] ?? 0) + 1;
    } catch {
      // One bad listing must not fail the batch.
    }
  }
  return res;
}

/** `POST /v1/push` — bearer-token guarded. */
export async function handlePush(c: Context) {
  const token = process.env.ASSYZE_PUSH_TOKEN;
  if (!token) return c.json({ error: "push not enabled on this server" }, 503);

  const auth = c.req.header("authorization") ?? "";
  if (auth !== `Bearer ${token}`) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json().catch(() => null) as { listings?: PushListing[] } | null;
  if (!body?.listings?.length) return c.json({ error: "no listings" }, 400);
  if (body.listings.length > 300) return c.json({ error: "max 300 per push" }, 400);

  return c.json(ingestPushed(body.listings));
}
