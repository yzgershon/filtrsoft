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
  ["budget_reservation_id", "INTEGER"],
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
  ["board_tier", "TEXT"],
];

/**
 * Where a SKU came from. `derived` means the generative matcher minted it from
 * a listing title rather than a human writing it into `reference/catalog.ts`.
 *
 * Worth distinguishing: derived rows are the ones to audit if the catalog ever
 * starts producing odd prices, and they are the ones a comps queue should
 * prioritise, since a SKU nobody has pulled comps for cannot price anything.
 */
const SKU_COLUMNS: Array<[string, string]> = [
  ["source", "TEXT"],
];

function migrate(d: Database) {
  addColumns(d, "skus", SKU_COLUMNS);
  addColumns(d, "listings", LISTING_COLUMNS);
  addColumns(d, "vision_results", VISION_COLUMNS);
  addColumns(d, "retail_prices", RETAIL_COLUMNS);
  d.exec("CREATE INDEX IF NOT EXISTS idx_vision_fingerprint ON vision_results(photo_fingerprint)");
  d.exec("CREATE INDEX IF NOT EXISTS idx_vision_created ON vision_results(created_at)");
  d.exec("CREATE INDEX IF NOT EXISTS idx_vision_spend_created ON vision_spend(created_at)");

  /**
   * Named, one-shot data migrations. CREATE TABLE IF NOT EXISTS handles shape;
   * this handles bounded cleanup that must run exactly once on an existing
   * production volume.
   */
  d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = d.query("SELECT 1 FROM schema_migrations WHERE name=?");
  const mark = d.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?,?)");
  const name = "2026-08-27-prune-consecutive-verdict-duplicates";
  if (!applied.get(name)) {
    d.transaction(() => {
      /**
       * Keep the LAST row in every run of identical answers. That preserves the
       * engine version production was actually serving while removing repeats.
       * A-B-A remains three rows because each transition carries information.
       */
      d.exec(`
        WITH ordered AS (
          SELECT id, call, confidence, payload,
                 LEAD(call) OVER (PARTITION BY listing_id ORDER BY id) next_call,
                 LEAD(confidence) OVER (PARTITION BY listing_id ORDER BY id) next_confidence,
                 LEAD(payload) OVER (PARTITION BY listing_id ORDER BY id) next_payload
            FROM verdicts
        )
        DELETE FROM verdicts
         WHERE id IN (
           SELECT id FROM ordered
            WHERE call = next_call
              AND confidence IS next_confidence
              AND payload = next_payload
         )
      `);
      mark.run(name, now());
    })();
  }

  /**
   * A printer was entered as a laptop SKU, then a comp pull faithfully attached
   * 15 printer sales to it. The resulting $55 median looked internally valid
   * while being entirely outside Assyze's market. Match by identity rather than
   * local id because archive imports can assign a different id on another DB.
   */
  const printerName = "2026-08-27-remove-hp-envy-6055e-printer-sku";
  if (!applied.get(printerName)) {
    d.transaction(() => {
      const bad = d.query(
        "SELECT id FROM skus WHERE category='laptop' AND brand='HP' AND model='Envy 6055E'",
      ).get() as { id: number } | null;
      if (bad) {
        d.query("UPDATE outcomes SET sku_id=NULL WHERE sku_id=?").run(bad.id);
        d.query("DELETE FROM retail_prices WHERE sku_id=?").run(bad.id);
        d.query("DELETE FROM comps WHERE sku_id=?").run(bad.id);
        d.query("DELETE FROM sku_aliases WHERE sku_id=?").run(bad.id);
        d.query("DELETE FROM skus WHERE id=?").run(bad.id);
      }
      mark.run(printerName, now());
    })();
  }
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
       /**
        * ADOPT AN ORPHAN, NEVER RE-FILE AN ATTACHED COMP.
        *
        * This was DO NOTHING, and that quietly made --query pulls
        * permanently useless. A raw query has no SKU to attach to, so its
        * comps land with sku_id = NULL; they then occupy the
        * UNIQUE(source, source_item_id) slot forever, so a later
        * SKU-TARGETED run re-fetches the same eBay items, hits the conflict,
        * does nothing, and the comps stay orphaned. 64 real i7-10700 sold
        * prices sat in the archive unreachable by valueSku for exactly this
        * reason, and the pull reported "64 new comps stored" both times.
        *
        * COALESCE(comps.sku_id, excluded.sku_id) only ever fills a NULL. An
        * already-attached comp keeps its SKU, so this can never silently move
        * a sold price from one product to another — which would be far worse
        * than leaving it orphaned.
        */
       ON CONFLICT(source, source_item_id) DO UPDATE SET
         sku_id = excluded.sku_id
       WHERE comps.sku_id IS NULL`,
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
