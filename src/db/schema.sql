-- Assyze schema v1
--
-- THREE RULES BAKED IN HERE. Do not "clean them up":
--   1. raw_json is stored ALWAYS. You will want fields you don't know you need,
--      and eBay's 90-day window means you cannot go back for them.
--   2. captured_at (when WE pulled it) is separate from sold_at (when it sold).
--      Collapsing these destroys the ability to reason about data freshness.
--   3. sku_id is NULLABLE everywhere. Pull broadly now, classify later.
--      Classification can always be redone. Uncaptured data is gone forever.
--
-- This database is APPEND-ONLY by convention. Nothing here is ever deleted.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- catalog

CREATE TABLE IF NOT EXISTS skus (
  id          INTEGER PRIMARY KEY,
  category    TEXT NOT NULL,          -- phone|laptop|gpu|prebuilt|console|tablet|component
  brand       TEXT NOT NULL,
  model       TEXT NOT NULL,
  attributes  TEXT NOT NULL DEFAULT '{}',   -- JSON: storage, ram, cpu, carrier, year, vram
  liquidity   TEXT,                   -- hot|normal|slow|dead  (dead vetoes BUY, see RISK-MODEL 3)
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skus_cat   ON skus(category);
CREATE INDEX IF NOT EXISTS idx_skus_model ON skus(brand, model);

-- Every messy title that ever resolved to a SKU. This is how the catalog LEARNS.
CREATE TABLE IF NOT EXISTS sku_aliases (
  id          INTEGER PRIMARY KEY,
  sku_id      INTEGER NOT NULL REFERENCES skus(id),
  alias       TEXT NOT NULL UNIQUE,
  source      TEXT,
  confidence  TEXT,                   -- high|medium|low
  created_at  TEXT NOT NULL
);

-- ------------------------------------------------------------------ comps
-- THE INVARIANT. eBay exposes only ~90 days of sold data, so every row here
-- becomes history nobody else can buy or reconstruct. Never delete.

CREATE TABLE IF NOT EXISTS comps (
  id                INTEGER PRIMARY KEY,
  source            TEXT NOT NULL,    -- ebay
  source_item_id    TEXT NOT NULL,
  url               TEXT,
  raw_title         TEXT NOT NULL,
  sold_price_cents  INTEGER NOT NULL,
  shipping_cents    INTEGER,
  currency          TEXT NOT NULL DEFAULT 'USD',
  condition_raw     TEXT,
  condition_norm    TEXT,             -- new|open_box|refurb|used|for_parts
  sold_at           TEXT,             -- when it sold
  captured_at       TEXT NOT NULL,    -- when WE pulled it  (rule 2)
  seller_feedback   INTEGER,
  region            TEXT,
  sku_id            INTEGER REFERENCES skus(id),   -- nullable (rule 3)
  query             TEXT,             -- the search that surfaced it
  raw_json          TEXT NOT NULL,    -- (rule 1)
  UNIQUE(source, source_item_id)
);
CREATE INDEX IF NOT EXISTS idx_comps_sku    ON comps(sku_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_comps_sold   ON comps(sold_at);
CREATE INDEX IF NOT EXISTS idx_comps_title  ON comps(raw_title);

-- --------------------------------------------------------------- listings

CREATE TABLE IF NOT EXISTS listings (
  id                 INTEGER PRIMARY KEY,
  source             TEXT NOT NULL,   -- craigslist|facebook|offerup|ebay|mercari
  source_id          TEXT NOT NULL,
  url                TEXT NOT NULL,
  title              TEXT,
  description        TEXT,
  asking_price_cents INTEGER,
  location           TEXT,
  posted_at          TEXT,
  updated_at         TEXT,
  captured_at        TEXT NOT NULL,
  photo_count        INTEGER,
  seller_ref         TEXT,            -- for cluster detection (RISK-MODEL 3e)
  raw_json           TEXT,
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_ref);
CREATE INDEX IF NOT EXISTS idx_listings_posted ON listings(posted_at);

-- Photos, with perceptual hash for cross-platform duplicate detection.
-- See RISK-MODEL 3.4 — this catches both benign cross-posting AND photo theft.
CREATE TABLE IF NOT EXISTS listing_photos (
  id           INTEGER PRIMARY KEY,
  listing_id   INTEGER NOT NULL REFERENCES listings(id),
  url          TEXT NOT NULL,
  local_path   TEXT,
  phash        TEXT,
  position     INTEGER,
  is_spec_screen INTEGER DEFAULT 0,   -- highest-value photo type (RISK-MODEL, Phase 0 finding)
  captured_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_phash   ON listing_photos(phash);
CREATE INDEX IF NOT EXISTS idx_photos_listing ON listing_photos(listing_id);

-- --------------------------------------------------------------- verdicts

CREATE TABLE IF NOT EXISTS verdicts (
  id             INTEGER PRIMARY KEY,
  listing_id     INTEGER NOT NULL REFERENCES listings(id),
  engine_version TEXT NOT NULL,
  call           TEXT NOT NULL,       -- BUY|FAIR|PASS|VERIFY|RISK|INSUFFICIENT_DATA|OUT_OF_SCOPE
  confidence     TEXT,
  payload        TEXT NOT NULL,       -- full verdict JSON per VERDICT-SCHEMA.md
  cost_cents     REAL,                -- measured from run 1, decides if the business works
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verdicts_listing ON verdicts(listing_id);

-- Yish's audit answers and every future human correction. The eval set.
CREATE TABLE IF NOT EXISTS judgments (
  id            INTEGER PRIMARY KEY,
  listing_id    INTEGER REFERENCES listings(id),
  external_ref  TEXT,                 -- audit tool id, for rows predating listings
  engine_call   TEXT,
  human_call    TEXT,
  agreement     TEXT,                 -- agree|partial|disagree
  notes         TEXT,
  judged_by     TEXT NOT NULL DEFAULT 'yish',
  created_at    TEXT NOT NULL
);

-- --------------------------------------------------------------- outcomes
-- THE MOAT. There is no sold-comps source for Facebook Marketplace anywhere.
-- The only way to learn local realized prices is to record what actually happened.
-- See CALIBRATION-2026-08-23.md finding 9.

CREATE TABLE IF NOT EXISTS outcomes (
  id                   INTEGER PRIMARY KEY,
  listing_id           INTEGER REFERENCES listings(id),
  sku_id               INTEGER REFERENCES skus(id),
  action               TEXT NOT NULL, -- bought|passed|no_reply|dead_listing|was_scam
  purchase_price_cents INTEGER,
  sold_channel         TEXT,          -- facebook|ebay|other
  sold_price_cents     INTEGER,
  fees_cents           INTEGER,
  shipping_cents       INTEGER,
  sold_at              TEXT,
  days_to_sell         INTEGER,
  notes                TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outcomes_sku ON outcomes(sku_id);

-- ---------------------------------------------------------- user economics
-- Verdicts are computed RELATIVE TO THE USER, not globally.
-- See CALIBRATION-2026-08-23.md finding 1: "but thats just me."

CREATE TABLE IF NOT EXISTS user_economics (
  id                           INTEGER PRIMARY KEY,
  label                        TEXT NOT NULL UNIQUE,
  home_location                TEXT,
  min_absolute_profit_cents    INTEGER,   -- hard floor, don't leave the house
  effective_hourly_floor_cents INTEGER,   -- the real parameter
  max_drive_minutes            INTEGER,
  transaction_minutes          INTEGER NOT NULL DEFAULT 15,
  relist_minutes               INTEGER NOT NULL DEFAULT 20,
  prefers_channel              TEXT,      -- facebook|ebay
  updated_at                   TEXT NOT NULL
);

-- ----------------------------------------------------------------- vision
-- Structured facts extracted from photos. Kept separate from verdicts because
-- vision is expensive and re-runnable independently of valuation logic.
CREATE TABLE IF NOT EXISTS vision_spend (
  id              INTEGER PRIMARY KEY,
  reserved_micros INTEGER NOT NULL,
  actual_micros   INTEGER,
  created_at      TEXT NOT NULL,
  settled_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_vision_spend_created ON vision_spend(created_at);

CREATE TABLE IF NOT EXISTS vision_results (
  id          INTEGER PRIMARY KEY,
  listing_id  INTEGER NOT NULL REFERENCES listings(id),
  model       TEXT NOT NULL,          -- which model produced it
  payload     TEXT NOT NULL,          -- full VisionResult JSON
  duration_ms INTEGER,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  photo_fingerprint TEXT,
  prompt_version TEXT,
  budget_reservation_id INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vision_listing ON vision_results(listing_id);

-- ---------------------------------------------------------------- crawls
-- Crawl history, so feed freshness is observable rather than guessed at.
CREATE TABLE IF NOT EXISTS crawls (
  id          INTEGER PRIMARY KEY,
  started_at  TEXT NOT NULL,
  discovered  INTEGER,
  analysed    INTEGER,
  vision_run  INTEGER,
  failed      INTEGER,
  created_at  TEXT NOT NULL
);

-- ------------------------------------------------------- delisting tracker
-- The comps source that needs nobody's API approval.
--
-- eBay tells you what things sell for NATIONALLY, after shipping and 13% fees.
-- This tells you what they clear for in Boston, on the channel Yish actually
-- buys and sells on. Both matter; only one of them can be taken away.
--
-- A listing that disappears is not proof of a sale — but Craigslist says WHY it
-- went, and "deleted by its author" is a different population from "expired".
CREATE TABLE IF NOT EXISTS listing_prices (
  id          INTEGER PRIMARY KEY,
  listing_id  INTEGER NOT NULL REFERENCES listings(id),
  price_cents INTEGER NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prices_listing ON listing_prices(listing_id, observed_at);

-- Every sweep, so coverage gaps are visible rather than silently assumed away.
CREATE TABLE IF NOT EXISTS sweeps (
  id          INTEGER PRIMARY KEY,
  started_at  TEXT NOT NULL,
  live_before INTEGER,
  seen        INTEGER,
  probed      INTEGER,
  delisted    INTEGER,
  price_moves INTEGER,
  created_at  TEXT NOT NULL
);

-- ------------------------------------------------------------ retail prices
-- The CEILING. Every competitor compares used to used; a buyer can always walk
-- into Best Buy and pay for a NEW one today, which caps what any used unit can
-- fetch. Two uses, and the second is the one that was not obvious:
--
--   1. Catches "used priced at or above new" — a failure mode no comp set can
--      see, because the comps are all used too.
--   2. An independent check on OUR OWN comps. A used median above new retail
--      means the comps are wrong. Every other signal is derived from the same
--      comps, so nothing else in the system could have said so.
--
-- ONLY GENUINELY-NEW OFFERS BELONG HERE. Best Buy sells Pre-Owned and Geek
-- Squad Certified units; storing one would cap a used price with a used price,
-- which is circular AND looks authoritative. `is_new` is stored anyway so a
-- rejected row is auditable rather than silently absent.
--
-- Unlike comps, the LATEST row wins rather than the whole history: retail moves,
-- and last year's launch price would cap nothing and flag nothing.
CREATE TABLE IF NOT EXISTS retail_prices (
  id          INTEGER PRIMARY KEY,
  sku_id      INTEGER REFERENCES skus(id),
  source      TEXT NOT NULL,          -- bestbuy
  title       TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  is_new      INTEGER NOT NULL DEFAULT 1,
  -- Capacity the price is FOR. SKUs are capacity-agnostic (a listing's storage
  -- picks the comp tier at valuation time), so a ceiling without this would cap
  -- a 512GB phone with the 128GB shelf price. NULL = capacity is not a price
  -- driver for this product, e.g. a GPU.
  storage_gb  INTEGER,
  -- Board tier for GPUs: base | mid | premium. A chip is not a product — 42 new
  -- RTX 5070s ran $795.59 to $1,669 across three retailers on one day, and the
  -- ceiling takes the CHEAPEST, so an untiered ceiling always lands on the
  -- budget card. One row per tier per source, so a TUF listing can be compared
  -- to a TUF. See signals/board-tier.ts.
  board_tier  TEXT,
  query       TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retail_sku ON retail_prices(sku_id, observed_at);

/*
 * ONE small self-hosted thumbnail per listing.
 *
 * MEASURED: Facebook signs its CDN urls with a ~2-day life — every failing
 * image on the live feed carried an `oe=` expiry in the past and every working
 * one about 40 hours ahead. The feed keeps a listing for 28 days, so past day
 * two a Facebook card is guaranteed to render a broken image, and no proxy can
 * help because the token itself is dead.
 *
 * WARNING: THIS IS NOT THE FULL-PHOTO RETENTION THAT FILLED THE VOLUME IN
 * 2026-08 (316 MB / 654 listings, ~480 KB each, unbounded, 13 hours of crawler
 * downtime). Every property that made that dangerous is inverted: ONE image per
 * listing enforced by this primary key, a 480px WebP at ~20 KB rather than the
 * original, a hard size refusal in `photos/thumb.ts`, and a prune tied to the
 * same 28-day window the feed uses. Read that file before changing any of it.
 */
CREATE TABLE IF NOT EXISTS listing_thumbs (
  listing_id  INTEGER PRIMARY KEY REFERENCES listings(id),
  bytes       BLOB NOT NULL,
  mime        TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  -- The url these bytes came from. A push carrying the SAME url is a no-op; a
  -- new one means the photo changed or Facebook re-signed it, and re-fetching
  -- is right either way since what we hold may be about to expire.
  src         TEXT NOT NULL,
  bytes_len   INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);
