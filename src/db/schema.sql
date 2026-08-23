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
CREATE TABLE IF NOT EXISTS vision_results (
  id          INTEGER PRIMARY KEY,
  listing_id  INTEGER NOT NULL REFERENCES listings(id),
  model       TEXT NOT NULL,          -- which model produced it
  payload     TEXT NOT NULL,          -- full VisionResult JSON
  duration_ms INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vision_listing ON vision_results(listing_id);
