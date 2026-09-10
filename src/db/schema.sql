-- Filtrsoft schema v1
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

-- Pending fact changes survive a crash before the derived verdict is stored.
CREATE TABLE IF NOT EXISTS listing_rechecks (
  listing_id INTEGER PRIMARY KEY REFERENCES listings(id),
  reason TEXT NOT NULL,
  requested_at TEXT NOT NULL
);

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

/*
 * Thumbnails we tried to fetch and could not.
 *
 * WARNING: WITHOUT THIS THE BACKFILL RETRIES A DEAD URL ON EVERY TICK, FOREVER.
 * `cacheThumb` writes nothing on failure, so a row that cannot succeed stays
 * eligible and is attempted again three minutes later, and again, for the 28
 * days the listing lives. As the fetchable rows drain the queue converges on
 * exactly the rows that can never succeed, and the loop settles into 25 pointless
 * requests every three minutes against three CDNs — about 12,000 a day, growing
 * with the feed.
 *
 * Measured on production 2026-08-31: the tick cached ~5 of 25 attempted while
 * only 10% of the remaining urls were actually dead. The same urls fetched
 * 40/40 from a laptop, so the failures are the CONTAINER (a small box running
 * this alongside crawling, scoring and vision), not the images.
 *
 * That is why this is a RETRY BUDGET rather than a tombstone. A one-strike rule
 * would permanently discard rows that failed once to a timeout under load,
 * which is most of them. Three attempts distinguishes "busy" from "gone".
 *
 * `src` is part of the identity: a re-crawl re-signs a Facebook url, and a new
 * url deserves a fresh budget because it genuinely might work now.
 */
CREATE TABLE IF NOT EXISTS listing_thumb_misses (
  listing_id INTEGER PRIMARY KEY REFERENCES listings(id),
  src        TEXT NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 1,
  last_try   TEXT NOT NULL
);

/*
 * ─────────────────────────────────────── LISTINGS VISION COULD NOT READ
 *
 * ⚠ WITHOUT THIS TABLE THE VISION PASS DEADLOCKS, AND IT DID — SILENTLY, FOR
 * THREE DAYS.
 *
 * Yish, 2026-09-03: *"there hasnt been a verify first or buy it listing thats
 * come in in the past 3 days."* Production health showed `reads24h: 0`,
 * `lastReadAt` three days earlier, and a **645-listing backlog**.
 *
 * The mechanism: `visionCandidates` orders BUY/VERIFY/RISK first, and on this
 * feed those are overwhelmingly Facebook and OfferUp (Risky was 33 of 34
 * Facebook). Production has no browser and no marketplace session, so fetching
 * one throws — and the catch in `visionPass` swallowed it. A failed read wrote
 * no `vision_results` row, so `NOT EXISTS` kept the same three listings at the
 * head of the queue, and every tick for three days retried exactly those three
 * and read nothing else.
 *
 * The fix is the one this codebase already uses for dead photo urls
 * (`listing_thumb_misses`): count the attempts and stop offering a listing that
 * has burned its budget. A BUDGET, not a tombstone — a container hiccup must
 * not permanently blacklist a listing his own machine could read fine.
 */
CREATE TABLE IF NOT EXISTS vision_misses (
  listing_id INTEGER PRIMARY KEY REFERENCES listings(id),
  tries      INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  last_try   TEXT NOT NULL
);

/*
 * Yish's own call, overriding the engine's.
 *
 * "I noticed some scams were labelled as verify first, so I want there to be an
 * option for me to manually change the label of things in the app so I can
 * manually change them to risky." — 2026-08-31, after a seller running two
 * listings at once sent him the same scripted message on both.
 *
 * WARNING: KEYED ON A DEVICE REF, NOT GLOBAL, AND THAT IS A SECURITY DECISION.
 * filtrsoft.com is public. An unauthenticated write that changed the verdict
 * everyone sees would let anyone relabel a scam as a buy. `deviceRef()` already
 * exists in the web app as Stripe's client_reference_id — a random uuid minted
 * once per browser — so an override is scoped to the person who made it and
 * needs no login and no token in a form.
 *
 * WARNING: A SEPARATE TABLE, NEVER AN UPDATE TO `verdicts`. reverdictAll
 * rewrites that table on every engine bump, so an override written into it
 * would be silently erased by the next deploy — and erased overrides are worse
 * than no overrides, because the listing goes back to looking safe.
 */
CREATE TABLE IF NOT EXISTS verdict_overrides (
  device_ref  TEXT NOT NULL,
  listing_id  INTEGER NOT NULL REFERENCES listings(id),
  call        TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (device_ref, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_overrides_listing ON verdict_overrides(listing_id);

/*
 * ─────────────────────────────────────────────────────────────── ACCOUNTS
 *
 * Yish, 2026-09-01: *"right now anyone who goes to filtrsoft.com can just have
 * full access to all the deals so lets add some personalization and security."*
 *
 * ⚠ THE DEVICE REF DOES NOT GO AWAY, IT GETS ADOPTED. Saved listings, verdict
 * overrides and the billing entitlement are all keyed on `device_ref` today,
 * and a sign-in that orphaned them would erase his own labels at the exact
 * moment he was told the product got more personal. `account_devices` links a
 * ref to a user, so the existing tables keep working unchanged and the account
 * becomes the thing that owns the refs.
 */
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  -- Stored lowercased and trimmed; UNIQUE is what makes "already registered"
  -- a database fact rather than a race between two signup requests.
  email         TEXT NOT NULL UNIQUE,
  -- NULL for accounts created purely through Google or Apple. Such an account
  -- has no password to guess, which is a feature; "forgot password" for one of
  -- those has to send them back to the provider, not offer a reset.
  password_hash TEXT,
  name          TEXT,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT
);

/*
 * One row per external identity. A user can hold several: signing in with
 * Google and later with Apple on the same verified email lands on ONE account
 * rather than silently creating a second one that has none of your saved work.
 */
CREATE TABLE IF NOT EXISTS identities (
  provider   TEXT NOT NULL,          -- google | apple
  subject    TEXT NOT NULL,          -- the provider's stable user id ("sub")
  user_id    INTEGER NOT NULL REFERENCES users(id),
  email      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);

/*
 * ⚠ OPAQUE RANDOM TOKENS IN A TABLE, NOT JWTs, and the reason is revocation.
 * A signed token cannot be withdrawn before it expires without a
 * denylist — which is a session table with extra steps. Signing out, "sign out
 * everywhere", and a stolen-laptop story all need a DELETE, so the row IS the
 * session.
 *
 * The token is never logged and never appears in a URL; it lives in an
 * httpOnly cookie so page JavaScript cannot read it either.
 */
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

/*
 * Which devices belong to which account.
 *
 * ⚠ A REF IS CLAIMED BY THE FIRST ACCOUNT THAT SIGNS IN ON IT AND IS NOT
 * REASSIGNED. Two people sharing a phone would otherwise pull each other's
 * overrides across on every switch. `PRIMARY KEY (device_ref)` makes that a
 * constraint rather than a convention.
 */
CREATE TABLE IF NOT EXISTS account_devices (
  device_ref TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_devices_user ON account_devices(user_id);

/*
 * ───────────────────────────────────────── CRAWL JOBS HE STARTS FROM THE APP
 *
 * Yish, 2026-09-03: *"code a button in Filtrsoft that I click and put in a pin ...
 * that automatically starts the crawl ... so I dont need to waste my claude
 * usage asking you to crawl."*
 *
 * ⚠ THE SERVER CANNOT REACH HIS PC, SO HIS PC ASKS THE SERVER. This is the one
 * architectural fact the whole feature turns on. filtrsoft.com runs in a Railway
 * container; his desktop is behind a home router with no inbound route and no
 * fixed address. A button that tried to CALL his machine could never work.
 *
 * So the button only ever writes a row here, and `bun run agent` on his PC
 * polls for it. Facebook, OfferUp and Mercari need a logged-in browser, which
 * only that machine has — the container could not run these crawls even if it
 * could be reached.
 *
 * ⚠ WHICH MEANS "queued" IS NOT "RUNNING". If his PC is off, the row sits here
 * until it is on. The UI has to say that plainly rather than showing a spinner
 * for something nothing is working on, or the first time he taps it with the
 * machine asleep the feature looks broken.
 */
CREATE TABLE IF NOT EXISTS crawl_jobs (
  id          INTEGER PRIMARY KEY,
  -- queued | running | done | failed | expired
  status      TEXT NOT NULL DEFAULT 'queued',
  sources     TEXT NOT NULL,          -- json array: facebook, offerup, mercari
  requested_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  -- Progress the agent reports as it goes, so the app can show something real
  -- rather than a spinner: "offerup: 24 listings pushed".
  progress    TEXT,
  result      TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs(status, id);

-- Personal removal is recoverable and must survive crawls/re-scoring.
CREATE TABLE IF NOT EXISTS listing_dismissals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,listing_id)
);
