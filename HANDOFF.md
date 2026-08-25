# HANDOFF — Assyze

**Master plan AND current state. Update before you stop working.** A stale line here
is worse than a missing one, because a fresh session will believe it.

Last updated **2026-08-24**.

---

## 1. What Assyze is

**A marketplace of only the good deals.** Open it, see used-tech listings the engine
actually verified, tap one for the full reasoning and a link to the seller.

It is **not** a paste-a-link tool. That flow exists as a secondary feature; the feed
is the product. This was corrected mid-build on 2026-08-24 — the first version had
it backwards.

**The thesis:** used tech has *binary, hidden value-destroyers* that price comps never
capture — iCloud Activation Lock, blacklisted IMEI, carrier lock, EFI lock, battery
health, mined GPUs, datacenter cards with no display outputs. Every competitor values
the **model**. None value the **risk**.

**Why a feed is not the commodity "alerts" nine competitors sell:** alerts are push,
keyword-configured, per-user setup. A feed is browse-first with zero setup, and it
requires **ranking** — which requires a verdict. They rank by price and keyword
because they have nothing else to rank by.

**Governing principle: reliability over coverage.** Missing a deal costs nothing.
Sending someone 45 minutes to a scam ends the brand. The engine is allowed to say
"I don't know."

**Scope:** laptops, phones, GPUs, prebuilt PCs, consoles, tablets, components.
**Out:** furniture, clothing, cars, and **cameras** (cut — no domain knowledge to audit against).

**Per-user later:** signup takes location + interests, feed is scoped to their area
and their profit floor. Yish's feed works standalone until then.

---

## 2. Current state — 2026-08-24

### Commands
```
bun run api                       HTTP API + serves web/dist        :3177
cd web && bun run dev             frontend dev server                :5177
bun run crawl [--pages N] [--limit N] [--vision N] [--cat sya,moa]
bun run check <url> [--vision]    one listing, staged timings
bun run verdict                   re-score every stored listing
bun run score                     engine vs Yish's 69-listing audit
bun run stats                     archive health
bun run sweep [--probe N] [--cat sya]  re-crawl, record delistings + price moves
bun run backup                    verified snapshot -> backups/ + OneDrive
bun run seed                      catalog + economics + judgments
bun run comps:provisional         placeholder comps — DELETE when eBay lands
```

### In the database
| | |
|---|---|
| SKUs | 62 (101 aliases, 8 dead-liquidity) |
| Comps | 80 — **all provisional/fake**, covering 10 of 62 SKUs |
| Listings | ~341 (crawled) |
| Verdicts | 332 INSUFFICIENT_DATA · 2 FAIR · 2 VERIFY · 1 BUY · 1 RISK · 1 PASS |
| Judgments (eval set) | 69 |
| **Engine vs Yish** | **3/10 exact · 3 harsher · 3 softer — no directional bias** |

**332 of 341 can't be priced because 52 of 62 SKUs have zero comps.** The pipeline is
right and the pantry is empty. Everything unblocks when eBay comps land.

### Built
- **Engine as a service** — `src/engine/`. `checkListing(url, {onStage})` and
  `checkStored(id)`. Extraction verified **byte-identical** to the old scripts.
- **Crawler** — `src/crawler/`. Funnel: discover → text pass (~5ms) → triage →
  vision only on survivors. Parallel batches of 6.
- **API** — `src/api/`. `POST /v1/checks`, `GET /v1/checks/stream` (SSE),
  `GET /v1/checks/:id`, `GET /v1/feed`, `GET /v1/health`. Serves `web/dist` in prod.
- **Web app** — `web/`. React + Vite, mobile-first, renders inside a phone frame on
  desktop. Bottom nav: Deals / Check / You. WCAG-verified contrast on all 13 pairs.
- **Vision** — `src/vision/`. **Anthropic API** (`@anthropic-ai/sdk`), ONE request
  with ALL photos, structured output enforced by a zod schema. Default model
  **claude-haiku-4-5**, PINNED as a constant (not an env var). Photos are sent as
  ORIGINAL BYTES — no resize, no re-encode. Cache-first by listing id.
  The 3-account subscription failover was DELETED on 2026-08-24 — see traps.
- **Signals, catalog, valuation, verdict** — unchanged from 2026-08-23, see that
  session log.

### Measured latency
```
 38ms  fetched     listing parsed
 43ms  signals     red flags — pure compute
 44ms  valued      match + comps + verdict
238ms  vision      when cached
  ~5s   vision      cold, Haiku 4.5 @1024px, 3 photos, $0.0055 measured
```

### Delisting tracker — BUILT 2026-08-24, running
`src/tracker/`. The comps source that needs nobody's approval, built because the
eBay developer application has already been rejected once and the archive is the
one asset the engine cannot work without.

**Craigslist states WHY a posting went, and that is the whole ballgame.** A dead
posting returns **HTTP 410** with an explicit sentence — measured, not assumed:

| body says | meaning |
|---|---|
| `deleted by its author` | the seller took it down. Sold, or gave up. |
| `expired` | aged out on its own. Says NOTHING about a sale. |
| `flagged` | removed by users. Says nothing about a sale. |

Without that split a disappearance is ambiguous and clearing prices are mush.
With it, author-deletions are a usable population. `inferOutcome()` grades on
reason + days on market: <=14 days at full ask is `likely_sold` high confidence;
near the 30-day expiry it drops to `possibly_sold` because that may be
housekeeping ahead of an auto-expiry.

**Price history is free.** The search page carries title + price + location for
~330 listings in ONE fetch, so tracking every live listing costs a handful of
requests instead of one per listing. Rows are written only on an actual change.

**First sweep, 2026-08-24** — 341 live, 337 still up, 13 probed, **4 delisted:
3 deleted-by-author, 1 expired**, 4 price moves. The NZXT gaming PC from Phase 0
sold at **$750 in 2 days**. Second sweep found 0 new delistings and 0 phantom
price moves, so it is idempotent.

**The confound that would ruin it:** sellers delete and repost to get back to the
top. That looks exactly like a sale and would bias every clearing price UPWARD —
"great deal" on things that never sold. `looksLikeRepost()` overrides every other
signal. It currently matches on title+price; **the right version keys on the
photo dhash already in `listing_photos`**, since a seller who edits the title
while reusing photos slips past the cheap check. That is the next upgrade.

### Facebook Marketplace — BUILT 2026-08-24, needs one manual login
`src/sources/facebook.ts` (Bun, parsing) + `src/browser/fb-worker.mjs` (NODE,
browser). `bun run fb:login` once, then `bun run fb:crawl`.

**⚠ PLAYWRIGHT HANGS UNDER BUN ON THIS MACHINE.** Measured: `chromium.launch()`
never resolves under Bun; the identical script under Node 24 launches Chrome in
~3s. Bun cannot be dropped (`bun:sqlite` is the database), so the two split:
**Node drives the browser, Bun owns the database**, talking over NDJSON on
stdout. Do not "simplify" this back into one process.

**`playwright-core`, not `playwright`, and `executablePath` to the installed
Chrome.** Playwright ships x64-only browser bundles on Windows and the ARM64
request was closed as not planned — its bundled Chromium would run emulated.
The installed Chrome is native ARM64 (PE machine type 0xAA64, v151), so we drive
that and download no browsers at all.

**Forward slashes in the Chrome path.** `"C:\Program Files\..."` in a JS string
silently becomes `C:Program FilesGoogleChromeApplicationchrome.exe`. Cost one
debugging round.

**No credential handling exists and none may be added.** Yish signs in by hand in
a real Chrome window; the session lives in `~/.assyze/browser-profile`, which is
OUTSIDE the repo on purpose — one `git add -A` with it inside and his live
Facebook session is on GitHub.

**Parsing is in TypeScript, the worker is dumb.** The worker emits raw card text
and raw body lines; `parseCard`/`detailToListing` do the work in Bun, so a
parser fix never needs a browser to verify. All parsers are pure and tested.

**Two browser passes per crawl, deliberately.** Pass 1 finds what is worth
opening, pass 2 opens only those. Opening 100 detail pages to discard 80 is the
traffic pattern that gets an account flagged.

**`checkFetched(listing)` is the seam** that lets Facebook into the engine.
Nothing after it may branch on `source` — the moment something does, the eval
set stops meaning anything.

### NOT built
Accounts · payments · mobile app · listing auto-draft · outcome loop · alerts · real comps.

---

## 3. Deployment — Railway

**Live config:** project `selfless-freedom`, service `assyze`, branch `main`,
auto-deploy on, volume `assyze-volume`, custom domain `assyze.com` pending DNS.

Build is a **Dockerfile** (not Nixpacks — see traps). Multi-stage: Node builds Vite,
Bun runs the server. One service serves API + frontend on one origin.

Env vars:
```
ASSYZE_DB          = /data/assyze.db
ASSYZE_PHOTOS      = /data/photos
ANTHROPIC_API_KEY  = <needed for vision — NOT set yet>
```

**⚠ The Railway volume is NOT the archive.** It holds a fresh seed — 62 SKUs,
**zero comps**. Every comp, listing, verdict and judgment lives in
`C:\Dev\assyze\assyze.db` on his PC, because the crawler and the comps pullers
run locally. Backing up the volume today backs up an empty database. Revisit
this only if ingestion ever moves into the container.

**Vision now runs anywhere `ANTHROPIC_API_KEY` is set.** Local `.env` has it.
**Railway does NOT yet — add it as a service variable and vision stays off in
production until you do.** `/v1/health` reports `vision.configured`, so the
deployed app tells you which state it is in rather than silently degrading.

See `DEPLOY.md` for full steps.

---

## 3b. Codex audit, 2026-08-24 — what I verified myself

Full report: `docs/AUDIT-FINDINGS-2026-08-24.md`. Product ideas deliberately
separated into `docs/ECOSYSTEM-EXPANSION-2026-08-24.md`.

**CONFIRMED and FIXED the same day:**
- **P0-1 anyone could spend Yish's Anthropic money.** Public GET, vision default
  on, no auth/limit/quota/ceiling. I had proved it myself hours earlier by
  running a paid vision check against production from an unauthenticated
  machine. Closed — see `src/api/guard.ts`.
- **P1-6 sum-of-parts was DEAD CODE.** Max coverage 2/7 = 0.286 against a 0.30
  gate, so every prebuilt returned INSUFFICIENT_DATA forever. `sum / R * R` was
  the identity function and the computed value was discarded anyway.
- **P1-5 missing asking price became ZERO**, making an unpriced listing look
  like free money. Masked by other checks firing first, which is luck.
- **P1-1 vision cache keyed on listing id** — stale after a photo swap, and
  re-paid for identical photos on a repost.

**CONFIRMED and NOT yet fixed — read these before planning:**
- **P0-5 eBay keys will NOT unlock sold comps.** Verified against eBay's own
  docs: Marketplace Insights is Limited Release, "restricted and not open to new
  users", needs business approval plus eBay Partner Network. Browse API is ACTIVE
  listings only. **Every earlier plan in this repo that says "waiting on eBay
  keys" is wrong.** The delisting tracker is now the PRIMARY comps path, not a
  hedge.
- **P0-4 Craigslist crawling conflicts with their Terms of Use.** A deliberate
  decision Yish has to make; not something to solve with better scraping.
- **P0-2 the risk model is documented but not enforced.** A device can reach BUY
  without activation-lock / IMEI / MDM / ban evidence. This is the biggest
  remaining correctness gap and it contradicts the product's core promise.
- **P0-6/P0-7** production DB is separate from the local archive, has no volume
  backup, and the local backup excludes ~117 MB of photos.

## 4. Live traps

### ⚠ Anchor every gitignore and dockerignore pattern
**This cost most of a day.** A bare `photos/` in `.gitignore` matches a directory of
that name **at any depth**, so it silently excluded `src/photos/` — source code —
from every commit. Railway crashed on `Cannot find module '../photos/index.ts'`
forever while local builds worked, because the file existed on disk but was never
in the repo.

**When a deploy says a module is missing, the FIRST check is `git ls-files <path>`,
not a theory about Docker.** Four rounds of architecture, memory, healthcheck and
ignore-semantics guessing were all wrong; one `git check-ignore -v` was right.

Audit with:
```bash
find src web/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.sql" \) \
  | while read f; do git ls-files --error-unmatch "$f" >/dev/null 2>&1 || echo "UNTRACKED: $f"; done
```

### ⚠ Never pass `-c user.email` on a commit
27 commits landed on GitHub attributed to a different person because the session's
`userEmail` was used instead of the repo config. **GitHub attributes by EMAIL**, so
the name looked right and the account was wrong. Repo config is correct; a
`.git/hooks/pre-commit` guard now blocks any commit with the wrong email.

### Deploy traps
- **Nixpacks can't detect Bun from `bun.lock`** (it looks for `bun.lockb`). It fell
  back to Node and died on `bun: not found`. Hence the Dockerfile.
- **Bun OOMs running Vite.** Node builds the frontend in stage 1; Bun runs the server
  in stage 2.
- **SQLite creates the file, never the directory.** `mkdirSync` the parent first or
  the process dies at import with no listener and the healthcheck times out silently.
- **Bind `0.0.0.0`.** Loopback inside a container is invisible to the platform.
- **`/v1/health` must not require the database.** It reports DB trouble in the
  payload; making it query SQLite turned a database problem into a silent 91s timeout.
- **Cross-building amd64 on this ARM64 machine is unreliable** — QEMU segfaults on
  memory-heavy JS builds regardless of code correctness. Don't trust it as a repro.
- **`pkill -f` does not kill the API on Windows.** Use
  `Get-NetTCPConnection -LocalPort 3177 | Stop-Process -Id $_.OwningProcess -Force`.
- **The API does not hot-reload** unless started with `--hot`. A stale process served
  verdicts missing a whole field for two test rounds.

### ⚠ Never back up SQLite by copying the .db file
WAL mode keeps recent writes in a separate `-wal` file until a checkpoint. On
2026-08-24 the database was **1.3 MB and the WAL was 4.1 MB** — copying only the
`.db` would have silently dropped most of the archive, and the copy would have
opened fine and looked healthy. `bun run backup` uses `VACUUM INTO`, which folds
the WAL in, is safe while the API is serving, and then **reopens the snapshot and
compares row counts** before reporting success. A backup nobody has read is a
guess about a file.

### ⚠ NEVER downscale or re-encode a source photo
MASTER-PLAN 3.1 specified 768px. Measured on listing 6 — the exact spec screen
Phase 0 skipped — 768px made Haiku read **"Ryzen 5 5600X" off a screen that says
"Ryzen 5 9600X"**: a Zen 5 chip read as a 4-year-old Zen 3, ~$110 of error on one
component, flowing straight into sum-of-parts. **The saving was a third of a cent.**

Yish's rule as of 2026-08-24: highest resolution possible, always. Originals now
go to the API byte-for-byte. The old code also re-encoded every JPEG at quality
82 — a SECOND lossy pass on an already-lossy source, which Anthropic's own
guidance warns makes small text unreadable. That is gone too.

**The ceiling is not ours to pick.** Haiku 4.5 is STANDARD-tier vision: long edge
**1568px** and **1568 visual tokens** (`ceil(w/28)*ceil(h/28)`), whichever binds
first; the API downscales anything larger before the model sees it, so sending a
4032px phone photo buys nothing. The high-res tier (2576px / 4784 tokens) is
Claude 4.7 and later — Haiku 4.5 does not get it. Craigslist serves ~900px, well
under both, so in practice nothing is ever touched.

### ⚠ The Craigslist search endpoint IGNORES its offset parameter
Measured 2026-08-24: `&s=120` returns the byte-identical 332 listings as `&s=0` —
same first item, zero new ids. The static results page is the whole result set.
**So `crawl --pages 3` has been doing 3x the requests for no extra coverage**,
and `sweep` now defaults to 1 page. If real pagination is ever needed it has to
come from the JS search UI, not this endpoint.

### ⚠ Wrong-generation matching — FIXED 2026-08-24, keep the rule
Found on listing 338. Vision read the spec screens correctly:
`model: "MacBook Pro 16-inch 2019"`, `cpu: "Intel Core i7 2.6 GHz 6-Core"`.
The matcher resolved it to **skuId 33, "MacBook Pro M3"** via `method: "token"`,
`confidence: "low"` — an Intel machine matched to Apple Silicon, roughly a 2-3x
price difference. It did NOT produce a bad number only because that SKU has no
comps. **The moment comps land, this prices a 2019 Intel MacBook as an M3.**

**The rule that fixes it, in `matchSku`: a SKU token containing a DIGIT is a
discriminator** (m3, 15, 5070, 6700k) and every one of them must appear in the
listing or the match is refused. Plain token overlap treated "macbook" and "m3"
as equally important when the generation IS the entire question. Ties now break
toward the MORE specific SKU so "iPhone 15 Pro Max" still beats "iPhone 15".

Defence in depth in `buildVerdict`: `valueSku` is passed null for any
`confidence: "low"` match, so if a fuzzy match ever slips through again the worst
case is INSUFFICIENT_DATA, never a confident number off another product's comps.

Verified: the 2019 Intel listing now resolves to no match, while M3 MacBook,
iPhone 15, iPhone 15 Pro Max and RTX 5070 all still hit their aliases. Eval set
unchanged at 3/10 exact with no directional bias.

### ⚠ The CPU regex demanded a part number — FIXED 2026-08-24
Vision returned `cpu: "Intel Core i7 2.6 GHz 6-Core"` and the verdict still said
"cpu not stated", because `VALUE_FIELDS.laptop` required a full part number
(`i7-9750H`). A Mac spec screen never shows one. So vision was being paid for and
then ignored on the single most common category. Both the laptop and prebuilt
patterns now also accept a bare `core i7`. `6-Core Processor` alone still does
NOT match — the family letter has to be there.

### ⚠ Full-resolution photos cost more on photo-heavy listings, as intended
Listing 338 has **17 photos**: 17,193 tokens, **$0.02**, 8.4s. A 3-photo listing
is $0.0066. This is the cost of the never-downscale rule and it is the right
trade — but per-check cost scales with photo count, so the MASTER-PLAN 3.4 figure
of ~$0.011 should be read as an average, not a ceiling.

### ⚠ The catalog has no CPUs, and that is why prebuilt PCs cannot be valued
62 SKUs: 28 phone, 12 laptop, 12 gpu, 10 console. **Zero CPUs, zero RAM, storage,
PSU or motherboard, zero prebuilt-PC SKUs.** So on listing 6 vision correctly
reads "Ryzen 5 9600X" and the matcher has nothing to match it against — only the
GPU resolves, the coverage guard refuses to price a whole PC off one part, and
the verdict is INSUFFICIENT_DATA. That is the guard working, not failing.
This is MASTER-PLAN engine gap #1, and its fix is to derive the catalog FROM
observed comps rather than hand-seeding a list and hoping comps match it.

### ⚠ Bigger models are NOT automatically better here
Same listing, same resolution: Haiku 4.5, Sonnet 5 and Opus 5 all read the CPU
correctly. Opus cost **10x** and took **4x** as long. Worse, the larger models
wrote hedging prose *into the component fields* ("RTX 5070 (12 GB) — Gigabyte
GeForce-branded card, exact SKU not legible"), which the catalog matcher cannot
match on. The system prompt now demands bare model strings. **Measure before
upgrading a model; on this task the cheap one wins.**

### ⚠ Subscriptions are no longer a fallback
`src/vision/accounts.ts` and the yish→robbie→amitai failover were deleted
2026-08-24 at Yish's instruction. If the API key runs dry, vision returns null
and the engine degrades to the text layer — it does not silently start billing
his personal Claude accounts. Do not re-add CLI spawning without asking.

### ⚠ Never let an endpoint spend money without a gate
`src/api/guard.ts`. Four independent layers: kill switch
(`ASSYZE_VISION_ENABLED=0`, no redeploy), bearer token, daily USD ceiling,
per-IP rate limit + single-flight coalescing. **It FAILS CLOSED** — if
`ASSYZE_VISION_TOKEN` is unset, paid vision is refused for everyone, including
in production. An unset secret must never mean "no security".

An unauthorised caller still gets a real text-layer verdict rather than an
error, so the safe default does not feel like a regression and nobody is
tempted to switch it off.

### ⚠ A SKU with no digit in its model is a FAMILY, not a product
`matchSku` requires every digit-bearing SKU token to appear in the listing. A
SKU like bare "MacBook Pro" therefore has nothing to discriminate on and matches
a 2012 and a 2024 equally — the same bug that matched a 2019 Intel machine to an
M3, reintroduced through the catalog where the matcher's guard cannot see it.
`deriveCandidates` refuses to create them.

### WORKING TRAP: python -c/heredoc patching mangles regexes in JS
Patching a .ts file through a Python string turns  into an actual BACKSPACE
(0x08) and silently corrupts the regex. It happened twice on 2026-08-24; the
second time `stripListedPrefix` returned its input unchanged while the identical
regex worked when typed inline, and `cat -A` was what finally showed
`/^listed^H.*?^Hin/`. **Use the editor tool for anything containing backslashes.**
Audit with: `grep -c $'' src/**/*.ts`

### Engine traps
- **Never sample photos.** The funnel may drop *listings*; once a listing reaches
  vision it must never drop *photos*. Phase 0's miss was a skipped third image
  holding the entire spec sheet.
- **Don't regex the model's prose — ask for a boolean.** A port check fired on
  "no visible damage."
- **A confident wrong number is worse than no number.** Sum-of-parts once priced a
  whole PC off its GPU alone and said PASS. Coverage guard prevents it.
- **Store every comp forever.** eBay exposes ~90 days; every day not running is
  history you never get back.
- **Verdicts are RELATIVE TO THE USER.** Same listing is honestly BUY for one person
  and PASS for another.
- **Never ask a user for Facebook credentials or a session token.**

---

## 4b. Decisions the maintainer made — do not re-litigate

- **Craigslist crawling proceeds despite their Terms of Use.** Green-lit by Yish
  2026-08-24 after the audit raised it (P0-4): "Im not worried about getting
  caught or anything so go right ahead even if it is against their terms."
  Do not raise it again.
- **Facebook Marketplace automation likewise.** Same call, same date. The
  realistic penalty is his account, not legal action, which is why the crawler
  runs at human pace in a visible window rather than headless and fast.

## 5. Open decisions

| Question | Status |
|---|---|
| Anthropic API key | **DONE 2026-08-24.** Wired, subscriptions removed, Haiku pinned. Measured $0.0066/listing at ~7s on 3 full-resolution photos. Still needs adding to Railway. |
| Bulk re-vision of the archive | 341 crawled listings have no vision. Re-running all of them is ~**$1.90**. Not done — Yish's spend, Yish's call. |
| Section 11 of `RISK-MODEL.md` | **Yish to fill** — the stories only he has |
| Facebook gross ratio (0.85) | A guess, and per-category is known to be more correct. Replaced by outcome data eventually. |
| Comps from delisting | **Tracker shipped 2026-08-24.** Needs daily runs to accumulate. eBay comps remain valuable but are no longer a hard dependency. |
| Archive backup | **Done 2026-08-24.** `bun run backup` -> `backups/` + `~/OneDrive/assyze-backups/`, 14 daily kept, verified on write. Run it manually; a scheduled task is offered but not installed. Railway volume snapshots still off, and irrelevant until ingestion runs server-side. |
| Dead-category list | 3 known: VR, pre-2019 Intel Macs, datacenter GPUs |

---

## 6. Immediate next actions

1. **Add `ANTHROPIC_API_KEY` to Railway** — vision is off in production until
   then, and `/v1/health` will keep reporting `vision.configured: false`.
2. **Run `bun run sweep` daily.** Every day it does not run is clearing-price
   history nobody can refetch. Not yet scheduled.
3. **Repost detection by photo dhash**, replacing the title+price check.
4. **Derive the catalog from observed listings** (engine gap #1) — the 62 hand-
   seeded SKUs have zero CPUs, which is why prebuilt PCs cannot be priced.
3. **eBay Production keys → `.env`** when the account clears review. **Run
   `bun run backup` the day comps first land** — that is the day the archive
   stops being reproducible.
4. Then: real comps → delete provisional → re-run `score`.

---

## 7. Key documents

| File | What it is |
|---|---|
| `DEPLOY.md` | Railway deploy, DNS, and why not Vercel |
| `docs/MASTER-PLAN.md` | Product design, architecture, GTM, pricing, sequencing, engine gaps |
| `docs/RISK-MODEL.md` | **The moat.** Hard blockers vs flags, listing signals, per-category rules |
| `docs/CALIBRATION-2026-08-23.md` | What Yish's 69-listing audit corrected. 9 findings. |
| `docs/VERDICT-SCHEMA.md` | Output contract |
| `docs/research-2026-08-22.md` | Market, competitors, legal, API landscape |
| `docs/testset/audit.html` | The audit tool, re-runnable |
| `docs/sessions/` | Session logs with rejected directions and why |
