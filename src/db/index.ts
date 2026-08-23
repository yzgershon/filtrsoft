import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.ASSYZE_DB ?? join(here, "../../assyze.db");

let _db: Database | null = null;

export function db(): Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { create: true });
  _db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  return _db;
}

export const now = () => new Date().toISOString();

/**
 * Insert a comp. Idempotent on (source, source_item_id) — re-pulling the same
 * item is a no-op rather than a duplicate.
 *
 * raw_json is REQUIRED, not optional. eBay's 90-day window means anything you
 * don't capture now is gone permanently, including fields you haven't thought
 * to use yet.
 */
export function insertComp(c: {
  source: string;
  source_item_id: string;
  url?: string;
  raw_title: string;
  sold_price_cents: number;
  shipping_cents?: number;
  currency?: string;
  condition_raw?: string;
  condition_norm?: string;
  sold_at?: string;
  seller_feedback?: number;
  region?: string;
  sku_id?: number | null;
  query?: string;
  raw: unknown;
}) {
  return db()
    .query(
      `INSERT INTO comps (source, source_item_id, url, raw_title, sold_price_cents,
         shipping_cents, currency, condition_raw, condition_norm, sold_at,
         captured_at, seller_feedback, region, sku_id, query, raw_json)
       VALUES ($source, $sid, $url, $title, $price, $ship, $cur, $craw, $cnorm,
         $sold, $cap, $fb, $region, $sku, $query, $raw)
       ON CONFLICT(source, source_item_id) DO NOTHING`,
    )
    .run({
      $source: c.source,
      $sid: c.source_item_id,
      $url: c.url ?? null,
      $title: c.raw_title,
      $price: c.sold_price_cents,
      $ship: c.shipping_cents ?? null,
      $cur: c.currency ?? "USD",
      $craw: c.condition_raw ?? null,
      $cnorm: c.condition_norm ?? null,
      $sold: c.sold_at ?? null,
      $cap: now(),
      $fb: c.seller_feedback ?? null,
      $region: c.region ?? null,
      $sku: c.sku_id ?? null,
      $query: c.query ?? null,
      $raw: JSON.stringify(c.raw),
    });
}

export function stats() {
  const one = (sql: string) => (db().query(sql).get() as { n: number }).n;
  return {
    comps: one("SELECT COUNT(*) n FROM comps"),
    comps_classified: one("SELECT COUNT(*) n FROM comps WHERE sku_id IS NOT NULL"),
    skus: one("SELECT COUNT(*) n FROM skus"),
    aliases: one("SELECT COUNT(*) n FROM sku_aliases"),
    listings: one("SELECT COUNT(*) n FROM listings"),
    verdicts: one("SELECT COUNT(*) n FROM verdicts"),
    judgments: one("SELECT COUNT(*) n FROM judgments"),
    outcomes: one("SELECT COUNT(*) n FROM outcomes"),
    oldest_comp:
      (db().query("SELECT MIN(sold_at) v FROM comps").get() as { v: string })?.v ?? null,
  };
}
