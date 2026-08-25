import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.ASSYZE_DB ?? join(here, "../../assyze.db");

let _db: Database | null = null;

export function db(): Database {
  if (_db) return _db;
  // SQLite creates the FILE but never the DIRECTORY. On a fresh container with
  // ASSYZE_DB=/data/assyze.db this threw at import time, the process died before
  // it ever listened, and the platform healthcheck just timed out with no clue.
  try {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  } catch (e) {
    console.error(`FATAL: cannot create database directory ${dirname(DB_PATH)}`);
    console.error(`  ${(e as Error).message}`);
    console.error(`  Is the volume mounted there? ASSYZE_DB=${DB_PATH}`);
    throw e;
  }
  _db = new Database(DB_PATH, { create: true });
  _db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  migrate(_db);
  return _db;
}

/**
 * Columns added to `listings` after it already had rows.
 *
 * `schema.sql` is all CREATE TABLE IF NOT EXISTS, which is idempotent but does
 * NOT add a column to a table that already exists — so a new field would be
 * present on a fresh database and silently absent on the one holding all the
 * real data. Check pragma, add what is missing. ALTER TABLE ADD COLUMN is cheap
 * in SQLite and this runs on every open.
 */
const LISTING_COLUMNS: Array<[string, string]> = [
  ["last_seen", "TEXT"],       // last sweep that found it still up
  ["delisted_at", "TEXT"],     // when we first observed it gone
  ["delist_reason", "TEXT"],   // deleted_by_author | expired | flagged | gone
  ["last_price_cents", "INTEGER"], // asking price at the last observation
];

/**
 * Vision cost, in MICRO-dollars.
 *
 * Integer micros rather than a REAL number of cents: the daily spend ceiling
 * sums thousands of these, and accumulating float error into a money guard is
 * how a cap silently stops matching reality. One call is ~5,500 micros.
 */
const VISION_COLUMNS: Array<[string, string]> = [
  ["cost_micros", "INTEGER NOT NULL DEFAULT 0"],
  ["photo_fingerprint", "TEXT"],  // cache key: content, not listing id
  ["prompt_version", "TEXT"],
];

function addColumns(d: Database, table: string, cols: Array<[string, string]>) {
  const have = new Set(
    (d.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [name, type] of cols) {
    if (!have.has(name)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/**
 * Retail rows created before capacity mattered. `retail_prices` was added and
 * then USED in the same session, so `CREATE TABLE IF NOT EXISTS` silently
 * skipped the new column on a table that already existed — the first live pull
 * died on `no column named storage_gb`.
 */
const RETAIL_COLUMNS: Array<[string, string]> = [
  ["storage_gb", "INTEGER"],
];

function migrate(d: Database) {
  addColumns(d, "listings", LISTING_COLUMNS);
  addColumns(d, "vision_results", VISION_COLUMNS);
  addColumns(d, "retail_prices", RETAIL_COLUMNS);
  d.exec("CREATE INDEX IF NOT EXISTS idx_vision_fingerprint ON vision_results(photo_fingerprint)");
  d.exec("CREATE INDEX IF NOT EXISTS idx_vision_created ON vision_results(created_at)");
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
