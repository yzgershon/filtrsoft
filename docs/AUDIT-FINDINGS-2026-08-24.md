# Filtrsoft Master Audit Findings

**Audit date:** 2026-08-24  
**Prepared for:** Claude Code project handoff  
**Scope:** Repository, backend, database, crawler, vision, valuation, verdict logic, API, frontend handoff, Docker/Railway deployment, GitHub controls, backups, DNS, live production behavior, and external data dependencies.  
**Change policy:** Read-only audit. No application code, configuration, data, deployment, DNS, or GitHub settings were changed. This document and the companion ecosystem document are the only files added by the audit.

## Executive conclusion

Filtrsoft has a strong product thesis and a sensible early pipeline: preserve raw evidence, identify the exact item before pricing it, separate signal detection from the verdict, and default to uncertainty instead of inventing a number. That foundation is better than most two-day prototypes.

It is not ready for a public launch yet. The biggest issue is not simply waiting for eBay keys. The current blockers are:

1. The public SSE endpoint can trigger paid Anthropic vision without authentication, rate limits, quotas, or concurrency control.
2. The documented risk model is not enforced by the verdict engine. A phone, Mac, laptop, or console can receive `BUY` without resolving activation locks, IMEI/finance status, MDM, BIOS locks, or console bans.
3. Vision findings are calculated but not delivered to the frontend or shared result pages, so important evidence disappears.
4. The main feed-crawling strategy conflicts with Craigslist's published Terms of Use. This is a platform dependency and business risk, not just a technical TODO.
5. Ordinary eBay production keys do not provide public sold-history data. eBay's sales-history product is limited/restricted, and there is currently no eBay integration code in the repository.
6. Production and the local research database are separate islands. Production has zero comps and only two checked listings, while the local database contains the actual crawl archive.
7. Main auto-deploys with no test suite, CI gate, protected branch, configured Railway health check, or current production backup.
8. Listing and vision caches can stay stale after sellers change titles, descriptions, prices, or photos.

**Recommended product posture:** keep Filtrsoft in private alpha until the P0 launch gates in this report are closed. The best near-term version is a trustworthy link checker plus a carefully controlled feed, not a broad marketplace with unsupported coverage.

## Current-state snapshot

| Area | Confirmed state on 2026-08-24 |
|---|---|
| Repository | Private GitHub repository `yzgershon/filtrsoft`; `main` auto-deploys to Railway |
| Current commit | `3281bc9` - `Refuse family-resemblance SKU matches; read bare 'core i7' from spec screens` |
| Working tree before audit docs | Claude had an edited `src/valuation/index.ts` and a new `src/valuation/condition.ts`; the audit did not touch them |
| Backend | Bun + Hono + SQLite/WAL; engine version `0.3.0` |
| Frontend | React + Vite; production build succeeds |
| Production | Railway project `selfless-freedom`, service `filtrsoft`, one replica, persistent volume, 2 vCPU / 1 GB |
| Live health | Database healthy, 62 SKUs, 0 comps, Anthropic configured with `claude-haiku-4-5` |
| Production feed | Two user-checked listings, both `INSUFFICIENT`; no crawler-fed inventory |
| Local database | 341 listings, 1,674 photos, 824 verdict rows, 80 comps, 69 judgments, 9 vision rows, 0 outcomes |
| Comp quality | All 80 local comps are provisional/fake test data; no real sold comp corpus yet |
| Domain | `filtrsoft.com` DNS resolves to Railway, but HTTPS certificate provisioning is not complete; `www.filtrsoft.com` is not registered as a Railway custom domain |
| Automated tests | None discovered; `bun test` reports no tests |
| CI/security controls | No GitHub Actions, branch protection, Dependabot alerts, or secret scanning |
| Railway backups | None; Railway UI says backups/PITR require Pro |
| Railway trial | UI displayed `30 days or $5.00 left` during the audit |

## Architecture reviewed

```text
Craigslist URL / crawler
        |
        v
fetch + parse listing
        |
        v
text signals -> catalog match -> provisional valuation -> verdict
        |                                      |
        | optional                             v
        +-> download photos -> Anthropic vision -> merge -> second verdict
                                                        |
                                                        v
                                          SQLite + SSE/API + React UI

Parallel local data jobs:
search crawl -> listing archive -> daily tracker/sweep -> lifecycle observations
seeded/provisional comps -> valuation
```

The layers are clear, but several handoffs are incomplete: source metadata is dropped, vision signals do not reach the UI, lifecycle observations do not become calibrated comps, and local crawl data does not reach production.

## Priority definitions

- **P0:** Stop-before-public issue. Can cause direct spend, materially false verdicts, legal/platform exposure, or loss of the core data asset.
- **P1:** Fix before inviting meaningful real-user traffic or making accuracy claims.
- **P2:** Important hardening, scale, or maintainability work after the core invariants are safe.
- **P3:** Cleanup or documentation drift that should be scheduled but does not block a private alpha.

## P0 findings

### P0-1: Any visitor can trigger paid vision work

**Evidence**

- Global permissive CORS is enabled in `src/api/index.ts:23`.
- `GET /v1/checks/stream` is public and defaults vision on in `src/api/index.ts:104-108`.
- A request can fetch a third-party page, persist data, download images, and call Anthropic.
- There is no authentication, IP/user rate limit, quota, queue, single-flight lock, maximum concurrent jobs, or spend ceiling.
- Production health confirms that Anthropic is configured.

**Impact**

One person or bot can open repeated EventSource connections and consume Anthropic credits, CPU, bandwidth, and volume space. A `GET` request also performs expensive state-changing work, which makes browser prefetching and automated scanners unsafe.

**Required fix**

- Change paid checks to `POST /v1/checks` and return a job/check ID.
- Stream progress from a separate read-only endpoint.
- Add per-IP and per-account limits, a global concurrency limit, duplicate-request coalescing, daily spend ceilings, and an emergency vision-off switch.
- Cache against normalized URL + current photo fingerprint + model + prompt version.
- Validate all inputs before any network or paid work begins.

**Acceptance test**

Twenty simultaneous requests for the same URL cause at most one source fetch/vision call, abusive clients receive `429`, and the daily budget can prevent new paid jobs without taking down cached results.

### P0-2: The core risk promise is documented but not enforced

**Evidence**

- `docs/RISK-MODEL.md` says unresolved activation lock, FRP, IMEI/finance/carrier status, EFI/MDM, BIOS/Computrace, and console-ban risks must block `BUY` or force verification.
- `docs/VERDICT-SCHEMA.md` says unresolved blockers forbid `BUY`.
- `src/verdict/index.ts:48` and `75-83` only gate on signals already marked `severity: "blocker"`.
- `src/signals/index.ts` does not create unresolved category-specific blocker signals. The questions mention some checks, but questions do not constrain the verdict.

**Impact**

A correctly identified and cheaply priced device can be labeled `BUY` without proof that it is usable, unfinanced, unlocked, or not remotely managed. This violates Filtrsoft's main trust claim.

**Required fix**

- Create an explicit category risk-state object with `resolved`, `unresolved`, `failed`, and `not_applicable` states.
- Generate mandatory blockers by category before pricing can produce a final call.
- Limit the strongest call to `VERIFY` until every required blocker is resolved with named evidence.
- Include blocker state and evidence in persisted/shared verdicts.

**Acceptance test**

Golden tests prove that an iPhone without activation-lock and IMEI/finance evidence, a Mac without MDM/EFI evidence, and a console without ban-status evidence can never return `BUY`, regardless of asking price.

### P0-3: Vision evidence disappears before the result reaches the user

**Evidence**

- `src/engine/index.ts:209-210` emits the updated vision payload and verdict but not the updated signal report.
- `web/src/App.tsx:333-336` updates the verdict at the vision stage but not the signals.
- `GET /v1/checks/:id` in `src/api/index.ts:205-230` returns the listing and verdict, not signals or evidence.
- Signals are not persisted as a durable result artifact.

**Impact**

Boot screens, model/spec evidence, screenshot detection, visible damage, port condition, and other photo-derived warnings can influence a verdict but remain invisible on the result and permalink. A shared link cannot show why Filtrsoft reached its answer.

**Required fix**

- Define one versioned result schema used by the engine, SSE stream, persistence layer, API, and frontend.
- Persist all signal/evidence objects used in the verdict.
- Emit updated signals with the vision stage.
- Render evidence source, confidence, and unresolved checks on both live and shared pages.
- Preserve the raw model output separately for audit/debugging.

**Acceptance test**

A fixture with a visible boot error and cracked screen displays both flags during the live check and after reopening the permalink from a new browser session.

### P0-4: Craigslist crawling is a direct platform-policy risk

**Evidence**

The current product uses automated search-page fetching, listing fetching, repeated sweeps, local archiving, and aggregation. Craigslist's published Terms of Use prohibit software/services that interact with Craigslist and automated collection through crawlers or scrapers, and the terms list liquidated damages for some forms of aggregation and high-volume access. See [Craigslist Terms of Use](https://www.craigslist.org/about/terms).

**Impact**

The primary feed/data source could be blocked or challenged at any point. Scaling the crawl deepens the dependency and risk. This is not a code-quality problem that retries, rotating headers, or proxies solve.

**Required decision**

This needs a business/legal decision before automated Craigslist crawling becomes the production moat. This report is informational, not legal advice. Safer product directions include:

- User-initiated link checks where the user supplies the listing.
- User browser/share-sheet extraction performed for that user's check.
- Licensed feeds, seller submissions, partner inventories, or sources with permitted APIs.
- Written permission or counsel-approved access rules before running a centralized crawler.

**Acceptance test**

Every production source has an owner-recorded access basis, permitted collection method, rate/retention rules, and shutdown plan. The app can remain useful if Craigslist access ends tomorrow.

### P0-5: eBay account approval will not by itself unlock sold comps

**Evidence**

- No eBay client, OAuth, ingestion job, parser, or API adapter exists in the repository. Only environment placeholders and TODO language exist.
- eBay's Browse API is for searchable active inventory/product data, not general public completed-sales history: [Browse API overview](https://developer.ebay.com/develop/api/buy/browse_api).
- eBay's buying-app guide says Marketplace Insights, the sales-history API, is Limited Release: [Get Started on a Buying Application](https://www.developer.ebay.com/develop/get-started/get-started-on-a-buying-application).
- eBay's current filter documentation says Marketplace Insights access is restricted and not open to new users: [Buy API field filters](https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html).

**Impact**

The project can receive production keys and still have no official sold-comp source. Waiting for account approval hides two separate tasks: obtaining a lawful sold-data source and implementing/validating ingestion.

**Required fix**

- Treat active eBay Browse data as catalog/asking-market enrichment, not verified sold prices.
- Select a real sold-data path: approved Marketplace Insights access, a licensed provider, a compliant user-contributed outcome system, or another permitted source.
- Build a source adapter with provenance, fees/shipping, condition normalization, deduplication, outlier handling, retention, and replayable raw payloads.
- Do not mix active asking prices or provisional rows into sold comps.

**Acceptance test**

Every comp shown to the valuation engine has verifiable source provenance, sale status, sale date, item total, condition, SKU match evidence, and raw payload; fake/provisional comps are excluded from production calls.

### P0-6: The production feed and local data asset are disconnected

**Evidence**

- Local: 341 listings, 1,674 photos, 80 provisional comps, 824 verdict records.
- Production: 62 SKUs, 0 comps, two checked listings, no crawler-fed inventory.
- Railway uses `/data/filtrsoft.db` on its own persistent volume.
- Local crawling, tracking, and backups operate on a separate workstation database.
- There is no promotion, replication, import, or API ingestion path between them.

**Impact**

The deployed product is described as a feed of the best local deals but contains only two insufficient user checks. Research, lifecycle data, and photo evidence remain on one computer. Running two independent databases also creates an unclear source of truth.

**Required fix**

Choose one deliberate architecture:

1. Run permitted ingestion in a controlled worker and write to the production data store.
2. Publish signed, versioned, idempotent batches from the research database through an authenticated import pipeline.
3. Move archive and serving data to a managed store while keeping raw artifacts in object storage.

Separate `research/provisional` data from `production-eligible` data in schema and API contracts.

**Acceptance test**

A known approved listing can move through a repeatable staging-to-production path, be traced to its source batch, be rolled back without hand-editing SQLite, and never import provisional comps as real evidence.

### P0-7: The only production database and photo evidence are not fully backed up

**Evidence**

- Railway shows no volume backups; its UI says backups/PITR require Pro. Railway documents volume backups here: [Railway volume backups](https://docs.railway.com/volumes/backups).
- The local SQLite backup is healthy but was created before later schema/data additions. It has 482 verdicts versus 824 current verdicts, 8 versus 9 vision rows, and no `listing_prices` or `sweeps` tables.
- `src/scripts/backup.ts` validates only comps, listings, and judgments.
- The backup copies the SQLite database but not the 1,674 downloaded photos, about 117 MB. Photo URLs may stop working after a listing disappears.

**Impact**

Volume loss, accidental deletion, or workstation failure can destroy production checks or the local evidence archive. A database-only backup cannot reproduce vision findings after source photos disappear.

**Required fix**

- Back up production automatically to a separate system/account with retention and restore drills.
- Include SQLite's full schema/data plus the photo/object corpus and any model artifacts needed to audit a result.
- Validate `PRAGMA quick_check`, all expected tables, row-count sanity, foreign keys, and a sample artifact hash.
- Reopen and validate the off-device copy, not only the local staging copy.
- Document RPO/RTO and retention before collecting accounts, paid checks, or outcomes.

**Acceptance test**

A clean environment can restore the latest database and a sample photo-backed verdict from the off-device backup, with measured recovery time and no missing tables.

### P0-8: Main deploys automatically without a quality or readiness gate

**Evidence**

- GitHub has no Actions workflow, test checks, protected branch, Dependabot alerts, or secret scanning.
- Railway automatically deploys `main`.
- `bun test` reports no tests.
- `railway.json` has no health-check path, and Railway service settings show Healthcheck Path unset.
- `/v1/health` always returns `ok: true`, even when it catches a database error, and exposes internal DB/error details.

**Impact**

Any push can deploy a parser, migration, pricing, or risk regression without a gate. Railway can mark a container active because it started listening even if its database is unusable.

**Required fix**

- Add CI for clean install, types, unit/golden tests, API contract tests, migration-from-copy tests, build, and dependency audit.
- Require CI before deploy, through branch controls or Railway's wait-for-CI option.
- Add `/livez` for process liveness and `/readyz` for database/schema readiness.
- Configure Railway to check readiness.
- Keep internal paths/errors out of public health responses.

**Acceptance test**

A deliberately broken migration and a risk-rule regression both fail CI and cannot reach production; Railway refuses readiness if the expected schema is unavailable.

## P1 findings

### P1-1: Listing metadata and vision cache can stay stale forever

`persistListing()` in `src/engine/index.ts:111-128` updates timestamp and asking price on conflict, but not title, description, URL, location, photo count, seller reference, or raw payload. `src/vision/merge.ts:12-17` caches by listing ID, not by the photo set, model, or prompt version.

**Fix:** update mutable listing fields on observation; append observation history; compute a content/photo fingerprint; version the vision prompt; invalidate only affected derived results.

### P1-2: Parallel checks can race and duplicate work

`persistPhotos()` deletes then reinserts photo rows (`src/engine/index.ts:133+`). Two checks for the same listing can interleave, overwrite rows, and both call vision. `listing_photos` has no unique `(listing_id, position)` constraint. When vision is off, photo persistence is launched without awaiting completion (`src/engine/index.ts:212-218`).

**Fix:** per-listing single-flight/transactional persistence, deterministic upserts, uniqueness constraints, an explicit job queue, and awaited lifecycle management.

### P1-3: Crawler candidates skipped by the vision quota are never reconsidered

The crawler filters to listings not already seen (`src/crawler/index.ts:97-106`), triages them, and runs vision only on the top `maxVision` candidates (`130-134`). The rest are now known listings and drop out of future `fresh` sets. Failed/no-key checks are also counted as vision runs.

**Fix:** persist workflow states such as `discovered`, `text_scored`, `vision_pending`, `vision_failed`, `vision_complete`, with retry/backfill rules and attempt metadata.

### P1-4: The feed filter and feed promise are incorrect

The category filter is a literal no-op at `src/api/index.ts:186`: `(cat ? true : true)`. The feed does not exclude `delisted_at` rows and includes weak calls such as `INSUFFICIENT`, even though the UI heading says “Worth driving for.” Production currently shows two “Can't tell” cards under that heading.

**Fix:** make category a real normalized field/filter; define feed eligibility; exclude delisted/stale/out-of-scope records; separate “new checks” from “verified deals”; show last observed/crawled time.

### P1-5: Missing asking price can become zero during verdict math

`src/verdict/index.ts:128` falls back to `0` when asking price is missing. Today the affected rows are insufficient for other reasons, but a future fully identified/compped listing with a parser failure could appear impossibly profitable.

**Fix:** missing or nonpositive asking price must be an explicit insufficiency/blocker and must never enter profit math.

### P1-6: Prebuilt-PC parts valuation is unreachable and mathematically wrong

- `valueByParts()` only prices GPU and CPU, while coverage uses seven roles. Maximum possible coverage is `2/7 = 0.286`, below the verdict engine's `0.3` acceptance threshold (`src/verdict/index.ts:113`).
- `partsSum / WHOLE_UNIT_RATIO * WHOLE_UNIT_RATIO` at `src/valuation/index.ts:198` cancels itself. The stated whole-unit ratio has no effect.
- Component lookup uses averages without robust condition, shipping, date, or outlier treatment.

**Fix:** specify whether the model estimates part-out value or whole-unit value, build testable role coverage, apply the conversion once in the correct direction, and add fixtures with known expected outputs.

### P1-7: Seller, geography, duplicate, and spec-screen signals are mostly dead

- `persistListing()` writes `seller_ref: null`, and the live pipeline calls `clusterSize(null)` (`src/engine/index.ts:126,178`). No local listing has `seller_ref` populated.
- Search result location is discarded before listing evaluation.
- Difference hashes are stored, but duplicate detection is not part of the main engine. The database already has 130 hashes repeated across different listings.
- `is_spec_screen` is never set; local count is zero.

**Fix:** preserve source/search metadata end to end, normalize seller IDs where lawfully available, promote duplicate detection into a real signal, and classify/persist spec screens from the vision result.

### P1-8: Text-only analysis makes a false photo claim

`MISSING_VALUE_FIELDS` says fields are “not in the description and not readable in photos” at `src/signals/index.ts:146-150`, even during the pre-vision pass when no photo has been analyzed.

**Fix:** evidence language must say exactly what was checked. Before vision: “not stated in the listing text.” After vision: list which photos/regions were read and what remained unresolved.

### P1-9: Vision-derived specifications are not used for contradiction checks

The signal layer can use vision text to fill missing value fields, but `findContradictions()` receives listing text only at `src/signals/index.ts:186`. A CPU/model/GPU read from a spec screen cannot trigger impossible-combination rules.

**Fix:** build a normalized evidence record with source attribution, then run deterministic compatibility rules over the merged field set while preserving conflicts between title, description, and photos.

### P1-10: Valuation still rests on provisional assumptions

- All 80 comps are provisional.
- eBay fee assumptions are fixed at 13.25% + $0.40 and should be dated/sourced by category and order total.
- Facebook value uses a flat 0.85 ratio.
- `measuredMultiplier()` compares category-level medians that may contain different SKU mixes, creating mix/Simpson's-paradox bias.
- Tracker outcomes are not integrated into comps or valuation.

**Fix:** no production price call from provisional rows; compute within-SKU channel ratios before robust aggregation; version all fee/channel assumptions; expose data window and sample provenance in every valuation.

### P1-11: Tracker “clearing price” is an inference, not a confirmed sale

The tracker uses last observed asking price and delist reason. “Deleted by author” does not prove a sale, and an expired listing does not reveal the transaction price. Exact-title/price repost detection is also weak.

**Fix:** call this an inferred outcome with probability/confidence; never insert it as a confirmed sold comp without additional evidence; use image/content fingerprints and user-confirmed outcomes; calibrate inference against labeled samples.

### P1-12: API inputs and outbound requests lack safety limits

- Request bodies/query values are not schema-validated; arbitrary numbers can become negative or `NaN` economics.
- Source and photo fetches have no explicit timeouts, response-size caps, or redirect-target revalidation (`src/sources/craigslist.ts`, `src/photos/index.ts:77-85`).

**Fix:** validate with a strict boundary schema and bounded ranges; use abort timeouts, byte caps, content-type checks, redirect limits, and post-redirect allowlisting.

### P1-13: Public shared results need a privacy model before accounts

`GET /v1/checks/:id` is publicly enumerable. Today the information is mostly public listing data, but future user history, seller notes, serials, location, or outcomes can become sensitive.

**Fix:** decide what is public, private, redactable, and deletable; use unguessable share tokens for shared artifacts; never expose raw device identifiers by default; define retention before accounts launch.

### P1-14: There is no useful cost, error, or quality observability

The `cost_cents` field is never populated. There are no structured request/job logs, model-spend dashboard, parser success metrics, source health metrics, or error tracking. Railway deploy logs only confirmed startup and database readiness.

**Fix:** instrument request ID, source latency/status, parse confidence, cache hit, images processed, model/tokens/cost, verdict transition, failure stage, and total latency. Never log secrets or unnecessarily retain submitted URLs/IPs.

## P2 and P3 findings

| ID | Priority | Finding | Recommended action |
|---|---|---|---|
| M-1 | P2 | Schema evolution is ad hoc. `src/db/index.ts:39-52` adds selected columns with no schema-version table, ordered migration history, or rollback plan. | Add numbered transactional migrations and test them against copies of old databases. |
| M-2 | P2 | `schema.sql` calls tables append-only, but scripts delete judgments, provisional comps, and listing-photo rows. | Correct the invariant or enforce append-only event tables. |
| M-3 | P2 | Replaced photo files are not removed when a listing's photo count shrinks. | Use content-addressed storage plus reference counting/garbage collection. |
| M-4 | P2 | URL-derived Craigslist IDs can be affected by query strings/trailing slashes. | Canonicalize URLs and parse source IDs structurally. |
| M-5 | P2 | Craigslist is parsed with regex and partial entity decoding, with no saved HTML fixtures. | Add parser fixtures, encoding tests, and explicit parser-version metrics. |
| M-6 | P2 | `POST /v1/checks` defaults vision off while SSE defaults it on. | Put policy in one job configuration path and expose the selected mode. |
| M-7 | P2 | The result contract differs from `VERDICT-SCHEMA.md`; runtime is a smaller camelCase object. | Pick one versioned external schema and add contract tests. |
| M-8 | P2 | No production analytics distinguish visitors, checks, useful answers, shares, or return use. | Add privacy-aware funnel events after the product contract stabilizes. |
| M-9 | P2 | SQLite on an attached Railway volume limits horizontal replication to one writable instance. | Keep this consciously for alpha; define the migration trigger for managed Postgres/object storage. See [Railway volumes](https://docs.railway.com/volumes). |
| M-10 | P2 | No retention/cleanup policy exists for listing HTML, raw JSON, photos, model output, or user submissions. | Add documented retention by artifact class and deletion tooling. |
| M-11 | P3 | `.env.example` exists locally but is ignored by `.gitignore` because `.env.*` matches it. | Explicitly unignore and track a secret-free example file. |
| M-12 | P3 | Docker frontend install uses `npm install` without the existing Bun lockfile; root install falls back from frozen to mutable resolution. | Use one package manager, copy lockfiles first, enforce frozen install, and pin base images/digests. |
| M-13 | P3 | `DEPLOY.md` is stale: it describes Claude CLI vision, production vision being off, and health checks that are not configured. | Update after architecture and launch-gate decisions are made. |
| M-14 | P3 | Railway's legacy config-as-code flow is deprecated for existing files after 2026-12-01. | Migrate `railway.json` settings to Railway's current Infrastructure as Code flow before the cutoff. |
| M-15 | P3 | Security headers are absent, including HSTS/CSP/frame protection/content-type/referrer/permissions policies. | Add a reviewed header policy after the custom domain is active; avoid HSTS until HTTPS is reliably correct. |

## Domain and deployment findings

### Current domain state

- `filtrsoft.com` resolves to Railway's current address.
- HTTP redirects to HTTPS.
- HTTPS validation for both `filtrsoft.com` and `www.filtrsoft.com` returned a certificate-name mismatch during the audit.
- Railway shows `filtrsoft.com` as “Waiting for DNS update,” so the custom domain is not ready even though public DNS has propagated to the resolver used in this audit.
- `www.filtrsoft.com` points at Railway in DNS but is not registered on the service. Railway currently reports that the custom-domain limit is reached, so Railway cannot issue a certificate for that hostname in the present setup.

**Recommended resolution:** use `filtrsoft.com` as the canonical production hostname. Finish Railway verification/certificate issuance for the root. Route `www` through a registrar/Cloudflare redirect to the canonical root or add it as a platform domain when the plan permits. Do not announce the custom domain until both HTTPS and redirect behavior pass from an outside network. Railway's domain documentation is [here](https://docs.railway.com/networking/domains).

### Railway status

- Latest deploy succeeded and mounted the persistent volume.
- Startup logs show engine `0.3.0`, `db=/data/filtrsoft.db`, and 62 SKUs.
- One replica is expected with the attached SQLite volume.
- Healthcheck Path is unset.
- No automatic volume backup is active.
- Production Anthropic configuration is already present. The handoff statement that it still needs to be added is stale.

## Database and artifact audit

### Integrity

- `PRAGMA quick_check`: `ok`
- Foreign-key violations: 0
- Journal mode: WAL
- Invalid checked JSON: 0
- Missing tracked photo files: 0
- Duplicate photo positions within a listing: 0

### Local row counts

| Table | Rows |
|---|---:|
| `skus` | 62 |
| `sku_aliases` | 101 |
| `comps` | 80 |
| `listings` | 341 |
| `listing_photos` | 1,674 |
| `verdicts` | 824 |
| `judgments` | 69 |
| `vision_results` | 9 |
| `listing_prices` | 7 |
| `sweeps` | 2 |
| `crawls` | 2 |
| `outcomes` | 0 |
| `user_economics` | 1 |

### Current latest-verdict distribution

| Call | Count |
|---|---:|
| `INSUFFICIENT` | 332 |
| `VERIFY` | 2 |
| `OUT_OF_SCOPE` | 2 |
| `FAIR` | 2 |
| `RISK` | 1 |
| `PASS` | 1 |
| `BUY` | 1 |

This distribution is useful for debugging, not an accuracy metric. Most listings are unresolved, and the only mapped scoring set has ten labeled rows.

## Test and build results

| Check | Result |
|---|---|
| Backend TypeScript check | Pass |
| Frontend TypeScript check | Pass |
| Production Vite build | Pass |
| Dependency audit (`bun audit`) | No reported vulnerabilities |
| Git whitespace check | Pass; line-ending warning only |
| SQLite quick/integrity checks | Pass |
| Automated tests | None found |
| Current scoring script | 3/10 exact mapped outcomes; not a complete accuracy evaluation |

The build passing means the current snapshot compiles. It does not validate parsers, migrations, risk invariants, valuation math, concurrency, backups, or the result contract.

## Minimum test program

Build this before adding broad feed coverage:

1. **Source parser fixtures:** saved HTML for valid, deleted, expired, edited, malformed, and layout-changed listings.
2. **Catalog matching goldens:** exact SKU, ambiguous family, storage/color variants, impossible combinations, and spec-screen evidence.
3. **Risk-invariant tests:** every category blocker proves the maximum allowed call in each evidence state.
4. **Valuation tests:** percentile math, missing ask, fees, shipping, condition normalization, outliers, provisional exclusion, and prebuilt coverage.
5. **Vision contract fixtures:** model response validation, partial/malformed output, prompt/model cache invalidation, and photo changes.
6. **API contract tests:** status codes, validation, CORS policy, SSE/job transitions, share privacy, and rate limits.
7. **Migration tests:** initialize new DB and migrate copies from every shipped schema version.
8. **Backup restore test:** restore DB + photo artifact to a clean directory and reopen a known permalink.
9. **Crawler state-machine tests:** quota-skipped, retryable, permanent failure, delisted, reposted, and edited listings.
10. **End-to-end goldens:** listing input to evidence to verdict to persisted/shared result.

## Current Claude work that the audit did not touch

Claude has uncommitted condition-adjustment work in:

- `src/valuation/index.ts`
- `src/valuation/condition.ts`

The new `valueSku()` signature accepts condition and category, but `src/verdict/index.ts:60` still calls it with only the SKU ID, so the adjustment is not active end to end yet. Treat this as in-progress work, not an audit regression, and do not discard it while fixing adjacent valuation issues.

## Recommended execution order

### Gate 1: Protect spend and truth

1. Disable or protect public paid vision.
2. Implement category blocker states and prove the no-`BUY` invariant.
3. Persist and display all evidence/signals.
4. Fix missing-price, stale-result, and concurrent-check behavior.

### Gate 2: Decide the data strategy

1. Decide the permitted Craigslist posture.
2. Choose a lawful sold-comp source independent of ordinary eBay keys.
3. Define local/staging/production data ownership and promotion.
4. Separate provisional data from production evidence.

### Gate 3: Make deployment recoverable

1. Add automated tests and CI.
2. Configure readiness checks and deploy gating.
3. Back up and restore both database and photos.
4. Add cost/error/source-quality observability.
5. Finish root-domain TLS and canonical `www` behavior.

### Gate 4: Earn the feed claim

1. Fix crawler queue/backfill, feed eligibility, delist filtering, and category filtering.
2. Build a real labeled evaluation set.
3. Calibrate valuation and lifecycle inference on non-provisional evidence.
4. Launch a small private Newton-area alpha before broader coverage.

## Suggested launch gates

Filtrsoft should not present a listing as a verified deal until all of these are true:

- The listing has a versioned evidence snapshot and current photo fingerprint.
- Exact SKU identity is high enough for the selected pricing model.
- Required category blockers are resolved or the call is capped at `VERIFY`.
- Asking price is present and positive.
- Comps are real, recent enough, provenance-backed, condition-aware, and not provisional.
- Every displayed number can be reconstructed from stored inputs and assumption versions.
- The listing is still live and recently observed.
- The result page shows both positive evidence and unresolved risks.
- The check passed the same API/schema contract used in automated tests.

## What is already worth preserving

- Reliability-over-coverage is the right product principle.
- Exact identification before pricing is the right order of operations.
- Raw comp payload retention is important and should remain mandatory.
- The two-pass text/vision pipeline is cost-aware and understandable.
- Asking questions instead of hiding uncertainty is a strong interaction pattern.
- SQLite/WAL is reasonable for a private alpha if backups and single-instance limits are explicit.
- Pinning a lower-cost vision model and storing model metadata are good foundations.
- The tracker is a promising local-market data moat if its outcomes remain probabilistic until validated.

## External references used

- [Craigslist Terms of Use](https://www.craigslist.org/about/terms)
- [eBay Browse API](https://developer.ebay.com/develop/api/buy/browse_api)
- [eBay buying application guide](https://www.developer.ebay.com/develop/get-started/get-started-on-a-buying-application)
- [eBay Buy API field filters and Marketplace Insights restriction](https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html)
- [Anthropic vision documentation](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Railway volume backups](https://docs.railway.com/volumes/backups)
- [Railway volumes](https://docs.railway.com/volumes)
- [Railway custom domains](https://docs.railway.com/networking/domains)

