/** Shared listing-fact persistence for crawls, checks and authenticated pushes. */
import type { Database } from "bun:sqlite";
import { now } from "./index.ts";
import { rawObject } from "./facts.ts";

export interface ListingFacts {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  description: string;
  askingPriceCents: number | null;
  location: string | null;
  postedAt: string | null;
  updatedAt?: string | null;
  photoCount: number;
  sellerRef?: string | null;
  raw?: unknown;
  /** Discovery cards cannot erase details previously read from the item page. */
  partial?: boolean;
}

export interface UpsertListingResult { id: number; inserted: boolean; stale?: boolean }

const positivePrice = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;

/**
 * Upsert current facts while preserving the first-observed timestamp and a real
 * price history.
 *
 * `captured_at` is immutable: resetting it on every vision revisit made an old
 * listing look newly captured and destroyed the baseline used by the tracker.
 * A positive price change writes one history row; zero is normalised to NULL
 * because zero means "no price parsed", never "free".
 */
export function upsertListingFacts(
  d: Database,
  facts: ListingFacts,
  observedAt = now(),
): UpsertListingResult {
  const price = positivePrice(facts.askingPriceCents);
  const existing = d.query(
    `SELECT id, asking_price_cents, last_price_cents, captured_at, last_seen, raw_json
       FROM listings WHERE source=$source AND source_id=$sourceId`,
  ).get({ $source: facts.source, $sourceId: facts.sourceId }) as {
    id: number;
    asking_price_cents: number | null;
    last_price_cents: number | null;
    captured_at: string;
    last_seen: string | null;
    raw_json: string | null;
  } | null;

  if (!existing) {
    const row = d.query(
      `INSERT INTO listings (
         source, source_id, url, title, description, asking_price_cents,
         location, posted_at, updated_at, captured_at, photo_count, seller_ref,
         raw_json, last_seen, last_price_cents
       ) VALUES (
         $source,$sourceId,$url,$title,$description,$price,$location,$postedAt,
         $updatedAt,$observedAt,$photoCount,$sellerRef,$raw,$observedAt,$price
       ) RETURNING id`,
    ).get({
      $source: facts.source,
      $sourceId: facts.sourceId,
      $url: facts.url,
      $title: facts.title,
      $description: facts.description,
      $price: price,
      $location: facts.location,
      $postedAt: facts.postedAt,
      $updatedAt: facts.updatedAt ?? null,
      $observedAt: observedAt,
      $photoCount: facts.photoCount,
      $sellerRef: facts.sellerRef ?? null,
      $raw: JSON.stringify(facts.raw ?? {}),
    }) as { id: number };
    if (price !== null) {
      d.query(
        `INSERT INTO listing_prices (listing_id, price_cents, observed_at)
         VALUES ($id,$price,$at)`,
      ).run({ $id: row.id, $price: price, $at: observedAt });
    }
    return { id: row.id, inserted: true };
  }

  if (observedAt < (existing.last_seen ?? existing.captured_at)) return {id:existing.id,inserted:false,stale:true};

  const prior = positivePrice(existing.last_price_cents) ?? positivePrice(existing.asking_price_cents);
  if (prior !== null) {
    d.query(
      `INSERT INTO listing_prices (listing_id, price_cents, observed_at)
       SELECT $id,$price,$at
        WHERE NOT EXISTS (
          SELECT 1 FROM listing_prices WHERE listing_id=$id AND price_cents > 0
        )`,
    ).run({ $id: existing.id, $price: prior, $at: existing.captured_at });
  }

  d.query(
    `UPDATE listings SET
       url=$url,
       title=CASE WHEN $title != '' THEN $title ELSE title END,
       description=CASE WHEN $partial=1 AND $description='' THEN description ELSE $description END,
       asking_price_cents=CASE WHEN $partial=1 THEN COALESCE($price,asking_price_cents) ELSE $price END,
       location=COALESCE($location, location),
       posted_at=COALESCE($postedAt, posted_at),
       updated_at=COALESCE($updatedAt, updated_at),
       photo_count=CASE WHEN $partial=1 THEN MAX(photo_count,$photoCount) ELSE $photoCount END,
       seller_ref=COALESCE($sellerRef, seller_ref),
       raw_json=$raw,
       last_seen=$observedAt,
       last_price_cents=COALESCE($price, last_price_cents),
       delisted_at=CASE WHEN delist_reason IN ('gone','expired','deleted_by_author') AND $observedAt > delisted_at THEN NULL ELSE delisted_at END,
       delist_reason=CASE WHEN delist_reason IN ('gone','expired','deleted_by_author') AND $observedAt > delisted_at THEN NULL ELSE delist_reason END
     WHERE id=$id`,
  ).run({
    $id: existing.id,
    $url: facts.url,
    $title: facts.title,
    $description: facts.description,
    $price: price,
    $location: facts.location,
    $postedAt: facts.postedAt,
    $updatedAt: facts.updatedAt ?? null,
    $photoCount: facts.photoCount,
    $sellerRef: facts.sellerRef ?? null,
    $raw: JSON.stringify({...rawObject(existing.raw_json),...rawObject(facts.raw),attributes:{...rawObject(rawObject(existing.raw_json).attributes),...rawObject(rawObject(facts.raw).attributes)}}),
    $partial: facts.partial || !facts.description ? 1 : 0,
    $observedAt: observedAt,
  });

  if (price !== null && price !== prior) {
    d.query(
      `INSERT INTO listing_prices (listing_id, price_cents, observed_at)
       VALUES ($id,$price,$at)`,
    ).run({ $id: existing.id, $price: price, $at: observedAt });
  }
  return { id: existing.id, inserted: false };
}
