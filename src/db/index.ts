import {installLearning} from "./learning.ts";
import {installWorkspace} from './workspace.ts';
import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { installCompEvidence, soldEvidence } from "./comp-evidence.ts";
import { installPricingRevisions } from "./revisions.ts";
import {logStorage} from './storage.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.FILTRSOFT_DB ?? join(here, "../../filtrsoft.db");

let _db: Database | null = null;

export function db(): Database {
  if (_db) return _db;
  // SQLite creates the FILE but never the DIRECTORY. On a fresh container with
  // FILTRSOFT_DB=/data/filtrsoft.db this threw at import time, the process died before
  // it ever listened, and the platform healthcheck just timed out with no clue.
  try {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  } catch (e) {
    console.error(`FATAL: cannot create database directory ${dirname(DB_PATH)}`);
    console.error(`  ${(e as Error).message}`);
    console.error(`  Is the volume mounted there? FILTRSOFT_DB=${DB_PATH}`);
    throw e;
  }
  carryOverTheRenamedDatabase();
  refuseToShadowAnExistingDatabase();

  _db = new Database(DB_PATH, { create: true });

  /**
   * ⚠ WITHOUT THESE TWO PRAGMAS, ANY SECOND PROCESS KILLS THE FIRST ONE
   * MID-RUN, AND IT KILLS IT WITH AN UNCAUGHT EXCEPTION.
   *
   * Measured 2026-09-04: a 120-listing Facebook delisting probe died at listing
   * ~40 with `SQLITE_BUSY: database is locked`, because an eBay comps backfill
   * happened to be writing at the same moment. It had already retired thirteen
   * sold listings and it threw away the rest of the run.
   *
   * That is not an exotic situation here, it is the normal one. This project
   * routinely has several writers against one file: the API's crawl loop and
   * sweep, `bun run agent` shelling out to a crawl, a probe, a photo pass and a
   * comps backfill — and the agent's own steps are sequential but nothing stops
   * the daily scheduled task overlapping with a manual command.
   *
   *   · **WAL** lets readers and one writer proceed at the same time instead of
   *     taking a whole-file lock. It is also a persistent property of the
   *     database file, so setting it once is enough — it is set on every open
   *     anyway because that is cheaper than remembering whether it took.
   *   · **`busy_timeout`** turns "locked" from an exception into a wait. Five
   *     seconds is far longer than any write here takes and far shorter than a
   *     human notices.
   *
   * The default is `busy_timeout = 0`, i.e. **fail instantly**, which is a
   * defensible default for a library and the wrong one for every program in
   * this repo.
   */
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA busy_timeout = 5000");
  _db.exec("PRAGMA journal_size_limit = 16777216");
  if(process.env.RAILWAY_ENVIRONMENT_ID)logStorage(_db,DB_PATH);

  _db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  migrate(_db);
  installPricingRevisions(_db);
  installCompEvidence(_db);
  installLearning(_db);
  installWorkspace(_db);
  return _db;
}

/**
 * One-shot: move the production database onto its new name after the
 * 2026-09-04 rebrand. **DELETE THIS ONCE THE RAILWAY VOLUME HOLDS
 * `filtrsoft.db`** — it is the only place the old name appears in the backend,
 * and it is confined to one function so removing it is a clean cut.
 *
 * ── WHY IT CANNOT BE A MANUAL STEP ─────────────────────────────────────────
 *
 * The real database lives on a Railway volume at `/data/assyze.db`, and the
 * Dockerfile now says `FILTRSOFT_DB=/data/filtrsoft.db`. There is no shell on
 * that volume without a deploy, so "just rename the file" is not something Yish
 * can do — the guard below would refuse to boot forever and the app would be
 * down until someone shipped exactly this code anyway.
 *
 * ⚠ THE `-wal` AND `-shm` FILES MOVE WITH IT, AND THAT IS THE WHOLE RISK.
 * SQLite derives their names from the main file, so renaming `assyze.db` alone
 * leaves the most recent committed transactions sitting in an `assyze.db-wal`
 * that nothing will ever replay. The database would open, look healthy, and be
 * missing its newest rows — silent partial data loss, which is worse than the
 * failure this function exists to prevent.
 *
 * Renames are atomic within a filesystem, so a crash mid-way leaves the trio
 * consistent rather than half-moved.
 */
function carryOverTheRenamedDatabase(): void {
  if (existsSync(DB_PATH)) return;
  const legacy = join(dirname(DB_PATH), "assyze.db");
  if (!existsSync(legacy)) return;

  for (const suffix of ["", "-wal", "-shm"]) {
    if (!existsSync(legacy + suffix)) continue;
    renameSync(legacy + suffix, DB_PATH + suffix);
    console.log(`carried over ${legacy + suffix} -> ${DB_PATH + suffix}`);
  }
}

/**
 * ⚠ NEVER CREATE A BLANK DATABASE BESIDE A REAL ONE.
 *
 * `{ create: true }` is right for a first boot and catastrophic for a typo: a
 * wrong `FILTRSOFT_DB` produces a brand new empty file, the container starts
 * perfectly, the healthcheck passes, and the app serves zero listings while the
 * real database sits untouched one filename away. Every symptom points at the
 * data being gone.
 *
 * That stopped being hypothetical on 2026-09-04, when the rebrand renamed this
 * variable from `ASSYZE_DB` — production's value has to be re-pointed by hand
 * in Railway, and the cost of getting it wrong should be a container that
 * refuses to boot and names the file it found, not a silently empty app.
 *
 * The rule is narrow on purpose: it only fires when the configured path does
 * NOT exist and a sibling `.db` does. A genuinely fresh volume is empty, so
 * first boots are unaffected.
 */
function refuseToShadowAnExistingDatabase(): void {
  if (existsSync(DB_PATH)) return;
  const dir = dirname(DB_PATH);
  let siblings: string[] = [];
  try {
    siblings = readdirSync(dir).filter((f) => f.endsWith(".db") && f !== basename(DB_PATH));
  } catch {
    return;   // unreadable directory is the mkdir path's problem, not this one
  }
  if (!siblings.length) return;

  console.error(`FATAL: ${DB_PATH} does not exist, but ${dir} already holds a database.`);
  console.error(`  found: ${siblings.join(", ")}`);
  console.error("  Creating a new empty one here would look like every listing vanished.");
  console.error("  Point FILTRSOFT_DB at the real file, or move the old one into place.");
  throw new Error(`refusing to create an empty database beside ${siblings[0]}`);
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
  addColumns(d,"crawl_jobs",[["heartbeat_at","TEXT"],["agent_id","TEXT"],["node_id","TEXT"]]);
  d.exec(`CREATE TABLE IF NOT EXISTS agent_presence(agent_id TEXT PRIMARY KEY,seen_at TEXT NOT NULL,job_id INTEGER);
    CREATE TABLE IF NOT EXISTS crawl_job_stages(job_id INTEGER,stage TEXT,status TEXT,started_at TEXT,finished_at TEXT,error TEXT,PRIMARY KEY(job_id,stage));`);
  addColumns(d,"comps",[["updated_at","TEXT"]]);
  d.exec(`CREATE TRIGGER IF NOT EXISTS comp_correction_clock AFTER UPDATE ON comps
    WHEN NEW.updated_at IS OLD.updated_at AND (NEW.sku_id IS NOT OLD.sku_id OR NEW.sold_price_cents IS NOT OLD.sold_price_cents
      OR NEW.raw_title IS NOT OLD.raw_title OR NEW.sold_at IS NOT OLD.sold_at OR NEW.raw_json IS NOT OLD.raw_json
      OR NEW.shipping_cents IS NOT OLD.shipping_cents OR NEW.currency IS NOT OLD.currency
      OR NEW.condition_norm IS NOT OLD.condition_norm OR NEW.condition_raw IS NOT OLD.condition_raw)
    BEGIN UPDATE comps SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;`);
  addColumns(d, "skus", SKU_COLUMNS);
  addColumns(d, "listings", LISTING_COLUMNS);
  addColumns(d,"listings",[["last_probed_at","TEXT"],["next_probe_at","TEXT"],["probe_failures","INTEGER NOT NULL DEFAULT 0"]]);
  addColumns(d, "vision_results", VISION_COLUMNS);
  addColumns(d, "retail_prices", RETAIL_COLUMNS);
  addColumns(d, "outcomes", [["user_id", "INTEGER REFERENCES users(id)"], ["request_id", "TEXT"], ["request_payload", "TEXT"]]);
  d.exec("CREATE UNIQUE INDEX IF NOT EXISTS outcome_request_id ON outcomes(user_id,request_id) WHERE request_id IS NOT NULL");
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
  const retailIdentity="2026-09-07-retail-observation-identity";
  if(!applied.get(retailIdentity)) d.transaction(()=>{
    // Keep historical rows intact. Ignore only exact repeats of an observation;
    // differing price/availability at the same timestamp remains inspectable.
    d.exec(`CREATE INDEX IF NOT EXISTS retail_observation_identity ON retail_prices(sku_id,source,observed_at);
      CREATE TRIGGER IF NOT EXISTS retail_observation_dedupe BEFORE INSERT ON retail_prices
      WHEN EXISTS(SELECT 1 FROM retail_prices r WHERE r.sku_id IS NEW.sku_id AND r.source=NEW.source
        AND r.query=NEW.query AND r.title=NEW.title AND r.observed_at=NEW.observed_at
        AND r.storage_gb IS NEW.storage_gb AND r.board_tier IS NEW.board_tier
        AND r.price_cents=NEW.price_cents AND r.is_new=NEW.is_new)
      BEGIN SELECT RAISE(IGNORE); END;`);
    mark.run(retailIdentity,new Date().toISOString());
  })();
  // Preserve the pre-account owner's personal records only when ownership is
  // unambiguous at upgrade. Multi-account legacy rows stay unassigned, private.
  const ownership = "2026-09-07-personal-outcome-ownership";
  if (!applied.get(ownership)) d.transaction(()=>{
    d.run(`UPDATE outcomes SET user_id=(SELECT id FROM users LIMIT 1)
      WHERE user_id IS NULL AND action IN ('bought','passed','no_reply','was_scam')
        AND (SELECT COUNT(*) FROM users)=1`);
    mark.run(ownership,new Date().toISOString());
  })();
  /**
   * ⚠ $100 AT A 20-MINUTE DRIVE. Yish, 2026-08-31: *"right now you're saying my
   * floor is $135 for a 15 min drive — can you change it to like $100 profit
   * with a 20 min drive."*
   *
   * `user_economics` is SEEDED ONCE, so production's row keeps whatever the
   * first `bun run seed` wrote and a change to `seed.ts` alone would never
   * reach it. That is the whole reason this mechanism exists.
   *
   * $125/hr made the clock the binding term at every distance — 15 minutes
   * asked $135.42 and 20 minutes asked MORE, $156.25. $80/hr puts the crossover
   * exactly at 20 minutes, so the floor is flat to there and only longer trips
   * cost more. Guarded on the old value so a hand-edited row is never clobbered.
   */
  const econ = "2026-08-31-hourly-floor-80-crossover-at-20min";
  if (!applied.get(econ)) {
    d.query(
      `UPDATE user_economics SET effective_hourly_floor_cents = 8000, updated_at = ?
        WHERE label = 'yish' AND effective_hourly_floor_cents = 12500`,
    ).run(new Date().toISOString());
    mark.run(econ, new Date().toISOString());
  }

  /**
   * $75 AT A 20-MINUTE DRIVE. Yish, 2026-09-24, after seeing that only ~8
   * in-scope listings a month cleared $100: the minimum is $75. The crossover
   * stays at 20 minutes ($60/hr), so longer trips still cost more, scaled by
   * the same 3/4. Guarded on the previous values, like the migration above.
   */
  const econ75 = "2026-09-24-min-profit-75-crossover-at-20min";
  if (!applied.get(econ75)) {
    d.query(
      `UPDATE user_economics SET min_absolute_profit_cents = 7500, effective_hourly_floor_cents = 6000, updated_at = ?
        WHERE label = 'yish' AND min_absolute_profit_cents = 10000 AND effective_hourly_floor_cents = 8000`,
    ).run(new Date().toISOString());
    mark.run(econ75, new Date().toISOString());
  }

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
   * while being entirely outside Filtrsoft's market. Match by identity rather than
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
  if (!soldEvidence(c)) {
    db().run("INSERT OR IGNORE INTO comp_quarantine(source,query,captured_at,reason,raw_json) VALUES(?,?,?,?,?)", [c.source,c.query ?? null,now(),"Unverified sold evidence, price or date",JSON.stringify(c)]);
    return {changes:0,lastInsertRowid:0};
  }
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
       WHERE comps.sku_id IS NULL AND excluded.sku_id IS NOT NULL`,
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
