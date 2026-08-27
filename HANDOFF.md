# HANDOFF — Assyze

**Master plan AND current state. Update before you stop working.** A stale line
here is worse than a missing one, because a fresh session will believe it.

Last updated **2026-08-26**.

---

## 1. What Assyze is

**A marketplace of only the good deals.** Open it, see used-tech listings the
engine actually verified, tap one for the reasoning and a link to the seller.

It is **not** a paste-a-link tool. That flow exists as a secondary feature; the
feed is the product.

**The thesis:** used tech has *binary, hidden value-destroyers* that price comps
never capture — iCloud Activation Lock, blacklisted IMEI, carrier lock, EFI
lock, battery health, mined GPUs, datacenter cards with no display outputs.
Every competitor values the **model**. None value the **risk**.

**Governing principle: reliability over coverage.** Missing a deal costs
nothing. Sending someone 45 minutes to a scam ends the brand. The engine is
allowed to say "I don't know."

**Scope:** laptops, phones, GPUs, prebuilt PCs, consoles, tablets, desktop
components. **Out:** furniture, accessories, cameras.

---

## 2. Current state — 2026-08-26

**assyze.com is LIVE and pricing real listings.** `https://assyze.com` — use it
everywhere; `assyze-production.up.railway.app` is a debugging fallback, never
the address of the product.

```
listings   430 local  (345 craigslist · 62 facebook · 13 offerup · 10 mercari)
           ~1,025 in production, which crawls Craigslist on its own
skus       291    (173 laptop · 45 phone · 27 component · 24 gpu · 12 console · 10 prebuilt)
comps    13,981   ALL REAL, from eBay sold listings. 227 of 291 SKUs covered.
verdicts   181 INSUFFICIENT_DATA · 164 OUT_OF_SCOPE · 69 PASS · 11 FAIR
           2 BUY · 2 VERIFY · 1 RISK
judgments   79  (69 original + 10 re-reviewed WITH the comps visible)
outcomes     3  (observed, from delistings)
retail      35 quotes across 3 retailers (newegg · microcenter · bestbuy),
                per board tier. Every ceiling agrees with the archive.
vision spend to date: $0.055
```

### The 2026-08-26 session, in one table

Yish went through the live feed and found four wrong answers in about a minute.
Diagnosing them turned into the largest correctness pass so far.

| | before | after |
|---|---|---|
| comps | 6,247 | **13,981** |
| SKUs | 224 | **291** |
| SKUs with comps | 91 | **227** |
| INSUFFICIENT_DATA | 425 | **181** |
| OUT_OF_SCOPE | 54 | **164** |
| PASS | 35 | **69** |
| FAIR | 4 | **11** |

**The engine version went 0.3.0 -> 0.3.7 in one day.** Every bump is a
behaviour change that production re-scored itself for; the list in
`engine/index.ts` is the changelog.

### The eval set has two generations — `score` uses the newer one

**6/10 exact, 2 harsher, 1 softer.** Up from 1/10, and the improvement came from
BOTH sides moving:

The original 69 judgments were made from Yish's mental model of market value,
before a single real comp existed. `bun run review` puts the listing, the
engine's arithmetic and the actual sold comps on one page; re-grading with that
visible moved **6 of 10 grades, 5 of them TOWARD the engine** — including the
Tesla P100 (*"i didnt realize there was no video output"*) and the Latitude 7420
(*"good call"*). `score` prefers `judged_by='yish-rereview'` where it exists.

His notes on the other side found four real engine bugs, all now fixed and each
documented in Live traps: salvage comps in working medians, "NEW LISTING" read as
a condition, a partial parts sum discounted twice, and Apple machines sent down
the parts path.

**Do not tune the engine toward the eval set.** Ten cases cannot settle a
valuation dispute. `bun run outcomes` is the referee that is neither party —
observed clearing prices accumulate every time the sweep runs.

### Commands
```
bun run api                       HTTP API + serves web/dist          :3177
cd web && bun run dev             frontend dev server                 :5177

bun run crawl [--pages N] [--limit N] [--vision N] [--cat sya,moa]
bun run sweep [--probe N]         re-crawl; record delistings + price moves
bun run fb:login                  sign in to Facebook by hand (once)
bun run fb:crawl [--query ...] [--limit N] [--vision N] [--headless]
bun run ebay:login                sign in to eBay by hand (once)
bun run ebay:comps [--query ...] [--skus N]
bun run retail [--skus N] [--sku "RTX 5070"] [--source newegg] [--replay]
                                  NEW retail from Newegg / Micro Center / Best Buy
bun run archive [--check|--import]
                                  ship the comps archive to production
bun run catalog:derive [--min N] [--apply]    dry run by default

bun run ou:crawl --query "graphics card"      OfferUp   (local basis)
bun run mc:crawl --query "rtx 4070"           Mercari   (eBay basis)
bun run push --source facebook                local crawl -> assyze.com

bun run check <url>               one listing, staged timings
bun run verdict                   re-score every stored listing
bun run score                     engine vs Yish's 69-listing audit
bun run stats                     archive health
bun run backup                    verified snapshot -> backups/ + OneDrive
```

---

## 3. Architecture

### Two runtimes, and it is not a style choice
**Playwright HANGS under Bun on this machine.** Measured 2026-08-24:
`chromium.launch()` never resolves under Bun; identical code under Node 24
launches Chrome in ~3s. Bun cannot be dropped — `bun:sqlite` is the database.

```
src/browser/*.mjs     NODE.  Drives Chrome. Emits RAW text as NDJSON on stdout.
everything else       BUN.   Spawns it, and does ALL parsing + storage.
```

**Workers are dumb by design.** They emit raw card text, raw body lines, raw
row text. Every parser lives in TypeScript beside the rest of the code, so a
site's markup change is fixed with a pure function and a test — never by
launching a browser to see what happened.

### Browser setup
- **`playwright-core`, not `playwright`**, driving the INSTALLED Chrome via
  `executablePath`. Playwright ships x64-only browser bundles on Windows and
  the ARM64 request was closed as not planned; its bundled Chromium would run
  emulated. The installed Chrome is native ARM64 (PE machine type 0xAA64).
- **Forward slashes in the Chrome path.** `"C:\Program Files\..."` in a JS
  string silently becomes `C:Program FilesGoogleChromeApplicationchrome.exe`.
- **One profile per site**, under `~/.assyze/`, OUTSIDE the repo. They hold live
  session cookies; one `git add -A` with them inside and the sessions are on
  GitHub. Separate profiles so a challenge on one site cannot log out the other.
- **Headed by default.** eBay 403s headless outright; Facebook fingerprints it.
  A visible window at human pace looks like what it is.

### No credential handling exists, and none may be added
Yish signs in by hand in a real Chrome window. The browser holds the cookie; we
only drive the browser. **Do not add a login helper to any source file, ever.**

### `checkFetched(listing)` is the seam
Facebook needs a logged-in browser so it cannot hide behind `fetchListing`.
Once a source produces a `RawListing`, every stage after it is source-agnostic
and MUST stay that way. **Nothing after the fetch may branch on `source`** — the
moment something does, the eval set stops meaning anything.

---

## 4. Sources

### Craigslist — `src/sources/craigslist.ts`
Boston, 5 categories. **The search endpoint IGNORES its offset parameter**:
`&s=120` returns the byte-identical 332 listings as `&s=0`. So `--pages N` was
doing N× the requests for nothing; sweep defaults to 1 page.

### Facebook Marketplace — `src/sources/facebook.ts` + `browser/fb-worker.mjs`
- **Photos must be scoped to the listing.** A real page had 26 Facebook-CDN
  images of which **20 were "More like this" thumbnails** and 4 were 36px icons.
  Cut at the `Seller information` node; require width >= 200.
- **The carousel loads one photo at a time.** `View photo N` labels give the
  real count; click through until they are all collected. Never sample photos.
- **Text must be scoped to `[role="main"]` and sliced from the title.**
  `document.body.innerText` dragged in ~34 lines of Facebook nav as the
  "description", which the regex signal layer then scanned for red flags.
- **Location prefixes**: "Listed a day ago in / Pick up in / Located in".
- **Facebook's Condition dropdown is structured data** the seller PICKED —
  better than any regex over prose. Craigslist has no equivalent.
- Two browser passes per crawl: find what is worth opening, then open only
  those. Opening 100 pages to discard 80 is what gets an account flagged.

### eBay sold comps — `src/sources/ebay.ts` + `browser/ebay-worker.mjs`
**THE COMPS UNBLOCK, and Yish found it, not me.** I said repeatedly that sold
comps were gated behind the Marketplace Insights API — genuinely Limited
Release, genuinely closed to new users, and completely irrelevant: **eBay's own
website shows sold prices to any signed-in account.** Two sessions of planning
were built around the wrong constraint. `LH_Sold=1&LH_Complete=1`.

Measured, in this order, because each step failed differently:
```
headless, fresh profile   HTTP 403
headed, fresh profile     200 but "Security Measure" interstitial
headed, warmed profile    homepage OK, ACTIVE search returns 62 items
headed + sold filter      redirected to "Sign in or Register"
```
So: **headed, warmed, and signed in.** Warming is not superstition — going
straight to a search URL on a cold profile is what triggered the challenge.

---

### OfferUp — `src/sources/marketplace.ts` + `browser/marketplace-worker.mjs`
### Mercari — same files

**Both are USED markets, closer to eBay than to Craigslist.** Yish's
correction, 2026-08-25, and `BASIS` encodes it:

- **Mercari** is national, shipped, ~10% seller fee -> **eBay-basis**. Running
  its prices through the local discount takes ~15% off a number that already
  has eBay economics in it. That double-discount read the NZXT build at $890
  against a real $1,375.
- **OfferUp** is mostly local pickup but has shipped listings, so basis is
  decided **per listing** from what the card says, not per source.

Neither needs a login to browse, which is why they can eventually run in the
container — unlike Facebook. Both render client side, so they are browser-driven.

**Two parser bugs, each of which made a full page look EMPTY:**

- **OfferUp URLs are `/item/detail/<uuid>`.** A pattern of
  `/(item|p)/([A-Za-z0-9_-]+)` captured the literal string `"detail"` for every
  card — one shared id, 54 of 55 deduped away, reported as *"70 links -> 1
  card"*. The id is the LAST path segment.
- **Cards are PIPE-separated, not newline-separated**:
  `White Custom Gaming PC Build | $1,400 | Salem, MA`. Splitting on newlines
  left the whole card as one line, so the price was never isolated and the
  longest-line title rule returned the entire string.

    bun run ou:crawl --query "graphics card"
    bun run mc:crawl --query "rtx 4070"

### Facebook reaches production by PUSH — `POST /v1/push`

**Facebook cannot run in the container and that is architectural.** It needs a
logged-in Chrome profile Yish signs into by hand, and session cookies do not go
into a server image. So it crawls locally and pushes.

    bun run fb:crawl --query "rtx 4070"     # local, real browser
    bun run push --source facebook          # -> assyze.com

**The push carries FACTS ONLY — never verdicts.** The server re-scores
everything on arrival. If clients sent verdicts, the feed would mix calls from
whatever engine version happened to be on a laptop, and `reverdictStale` could
never correct them because they would already claim the current version. Facts
are portable; judgements are not.

Auth is `ASSYZE_PUSH_TOKEN`, set in BOTH the local `.env` and Railway
Variables. **Without it on the server the endpoint refuses every request** — an
unauthenticated write path into a deals feed lets anyone put anything in front
of a buyer. A re-push UPDATES rather than skips, because that is how a price
drop arrives, and a price drop is the most actionable event in the system.

---

## 5. The comps quality gates — every one from a real failure

`compMatchesQuery` rejects before storing. **Comps are kept FOREVER, so a bad
row poisons every future valuation of that SKU rather than one run.**

1. **Digit-token match, separator-insensitive.** A query for `rtx 3080` returned
   RTX 5090s at $4,876. The query's digit-bearing tokens must appear in the
   title. eBay writes `i5-10310U`, `i5 10310U` and `i5_10310U` for one part, so
   compare with separators stripped — a literal match dropped six real comps on
   punctuation alone.
2. **Category agreement.** The first bulk pull stored **898 laptop prices as CPU
   comps**, implying an i5-1335U is worth $321. `resolveCategory(title)` must
   match the SKU's category.
3. **Multi-unit rejection.** `LOT OF 10 HP ZBook` at $1,300 became the most
   expensive "CPU" in the archive. Quantity is a lie about price, not noise.
4. **Accessory rejection.** Waterblocks, backplates and brackets "for RTX 3080"
   are not an RTX 3080.
5. **Title from the ANCHOR, not the row.** "Longest non-price line" picked
   `tspence007 100% positive (41)` — the SELLER — as a product name.

Effect on the first pull: range went **$8–$4,876 → $108–$699**.

**`queryForSku` names the part type** — `"Intel i5-8365U CPU processor"`, not
the bare model — which is what surfaces boxed chips instead of laptops.

**KNOWN LIMITATION: "RTX 3080 Ti" passes an `rtx 3080` query.** "3080" is a
substring of "3080 Ti" and the Ti is materially more valuable. Variant suffixes
(Ti/Super/XT/Pro/Max) need handling before comps drive real BUY calls.

---

## 6. Product type is decided by GRAMMAR, not keywords

`src/signals/product-type.ts`. A `--query "gaming pc"` crawl returned computer
desks, chairs, a glass computer table and a laptop bag, and paid for VISION on
three of them. Yish: *"make it so it doesnt mindlessly scan for the keyword
computer"*.

**The rule: an English product title's HEAD NOUN comes last.** "computer desk"
is a desk; "desk computer" is a computer. It generalises to nouns nobody
enumerated — "computer hutch", "monitor riser", "PC trolley".

Refinements, each from a real miss:
- **Lists.** A separator BETWEEN two nouns means a bundle -> first tech noun
  wins. It must sit between them: "Glass and Metal Computer Table" joins
  adjectives; "PC gaming chair with RGB" introduces a feature.
- **"for X" is compatibility, never the product.** "Headset & Mic for
  PlayStation" is a headset. Without this the most impressive noun always won —
  backwards, since the pricier the named device, the more confidently a cheap
  accessory gets misclassified. `for sale|parts|repair|free` excluded.
- **Negation.** "Monitor - NO Power Adapter" is a monitor.
- **Product LINES are tech nouns** (precision, latitude, xps, ideapad...).
  Without them "Dell Precision 5760 + Charger" had one recognisable noun —
  "charger" — and five real laptops were thrown out.

### `resolveCategory` deliberately does NOT use head-last
Marketplace titles put specs at the END: "HP EliteBook 840 Laptop i5 8GB RAM
256GB SSD" is a LAPTOP, and head-last calls it an SSD. For CATEGORY, a
whole-device noun outranks a component noun wherever it appears. Furniture
detection still uses head-last, because "computer desk" really is a desk.

### Crawl triage is stricter than the verdict
The crawl requires `tech`; the verdict only rejects furniture/accessory.
Deliberate: a crawl is speculative spending, so an unrecognisable title is not
worth a page fetch, while a pasted link is a direct request and still gets
answered. Real tech with an odd title is rescued by the model-number rule.

---

## 7. The catalog is derived from observation

`src/catalog/derive.ts`, **dry run by default**.

**Decide what the LISTING is, then extract the matching model.** Previously
every extractor ran against every listing, so "Dell Latitude 5530 Laptop Intel
i5-1235U" produced a **CPU** SKU — the CPU pattern matched and nothing checked
whether a CPU was for sale. That one omission is what put 898 laptop prices into
the archive as CPU comps. `prebuilt` still allows component extraction, because
the GPU and CPU inside a desktop genuinely do trade separately.

**Soldered mobile CPUs are not products.** Intel U/H/HQ/HK/Y/G and AMD U/H/HS/HX
parts are soldered to the board — which is exactly why an eBay search for one
returns laptops. 13 such SKUs were created and then deleted. Desktop parts
(K, KF, F, T, X, or no suffix) do trade standalone and are kept.

**Refuse family names.** A model with no digit — bare "MacBook Pro" — is a
product LINE, not a thing with a price, and `matchSku` would match a 2012 and a
2024 equally. That is the same bug that matched a 2019 Intel machine to an M3.

**Title only, not description.** Dealer listings ("Spring Laptop Blowout Sale!")
name forty models in their body copy; including descriptions created a SKU for
each and inflated counts.

**One model token, not two** — except "EliteBook 840 G6" and "XPS 13 9310".
Greedy two-token capture produced "Dell XPS 9310 2" and "Dell XPS 9520 14",
fusing a stray "2-in-1" or a screen size onto the model.

---

## 8. Vision

`src/vision/index.ts`. Anthropic API, **`claude-haiku-4-5` PINNED as a
constant** — not an env var, so no stray Railway variable can move it onto a
model that costs ten times as much. Structured output via a zod schema.

**Measured 2026-08-24:** Haiku, Sonnet 5 and Opus 5 all read the CPU, GPU, RAM
and storage correctly off the same spec screen. Opus cost **10x** and took 4x as
long, and the bigger models wrote hedging prose INTO the component fields
("RTX 5070 (12 GB) — exact SKU not legible") which the catalog matcher cannot
match on. **Measure before upgrading a model; on this task the cheap one wins.**

### NEVER downscale or re-encode a source photo
MASTER-PLAN specified 768px. At 768 the model read **"Ryzen 5 5600X" off a
screen that says "Ryzen 5 9600X"** — a Zen 5 chip read as a 4-year-old Zen 3,
~$110 of error on one component. **The saving was a third of a cent.** Originals
now go byte-for-byte; the old code also re-encoded every JPEG at quality 82, a
second lossy pass on an already-lossy source.

**The ceiling is not ours to pick.** Haiku 4.5 is STANDARD-tier vision: long
edge **1568px** and **1568 visual tokens** (`ceil(w/28)*ceil(h/28)`), whichever
binds first; the API downscales anything larger before the model sees it. The
high-res tier (2576px / 4784 tokens) is Claude 4.7+. Craigslist serves ~900px,
so in practice nothing is touched.

Cost scales with photo count: 3 photos ≈ $0.0066, 17 photos ≈ $0.02.

### Cache by CONTENT, not listing id
Two tiers. Tier 1: same listing, photo URL set unchanged, same model and prompt
version — no download. Tier 2: same photo dhashes on ANY listing — catches
reposts and stolen photos. **`PROMPT_VERSION` is part of the key**; without it a
prompt fix keeps serving answers from the old prompt and looks inert.
Measured: repeat check 9,658ms -> 41ms.

---

## 9. Spend and abuse protection

`src/api/guard.ts`. **`GET /v1/checks/stream` was public, defaulted vision ON,
and had no auth, rate limit, quota or ceiling.** I demonstrated the exploit
myself against production from an unauthenticated machine. It was also a GET
doing paid state-changing work, so a link scanner or chat unfurler could spend
money by merely previewing a shared link.

Four independent layers:
1. `ASSYZE_VISION_ENABLED=0` — kill switch, no redeploy
2. Bearer token (`ASSYZE_VISION_TOKEN`)
3. Daily USD ceiling (`ASSYZE_DAILY_BUDGET_USD`, default 2), summed from
   `vision_results.cost_micros` — integer micros, because float drift in a money
   guard is how a cap stops matching reality
4. Per-IP token bucket + single-flight coalescing by URL

**It FAILS CLOSED.** With no token set, paid vision is refused for everyone
including production. An unset secret must never mean "no security". An
unauthorised caller still gets a real text-layer verdict, so the safe default
does not feel like a regression.

CORS was wildcard; it is now an explicit origin list.

---

## 10. Delisting tracker — the comps source nobody can revoke

`src/tracker/`. Craigslist states WHY a posting went, via **HTTP 410** plus an
explicit sentence:

| body says | meaning |
|---|---|
| `deleted by its author` | the seller took it down. Sold, or gave up. |
| `expired` | aged out. Says NOTHING about a sale. |
| `flagged` | removed by users. Says nothing. |

Without that split a disappearance is ambiguous. With it, author-deletions are a
usable population. First sweep: 341 live, 4 delisted (3 author, 1 expired). The
NZXT gaming PC sold at **$750 in 2 days**.

**Price history is free** — the search page carries price for ~330 listings in
one fetch. Rows written only on an actual change.

**The confound that would ruin it:** sellers delete and repost to get back to
the top, which looks identical to a sale and would bias every clearing price
UPWARD. `looksLikeRepost` uses photo dhash (>=2 photos within Hamming 10),
falling back to title+price.

---

## 11. Deployment — Railway

Project `selfless-freedom`, service `assyze`, branch `main`, auto-deploy on,
volume `assyze-volume`, custom domain `assyze.com`.

Build is a **Dockerfile** (not Nixpacks). Multi-stage: Node builds Vite, Bun
runs the server. One service serves API + frontend on one origin.

```
ASSYZE_DB          = /data/assyze.db
ASSYZE_PHOTOS      = /data/photos
ANTHROPIC_API_KEY  = set
ASSYZE_VISION_TOKEN = NOT SET -> paid vision refused in production
```

**⚠ The Railway volume is NOT the archive.** It holds a fresh seed. Every comp,
listing and verdict lives in `C:\Dev\assyze\assyze.db` on Yish's PC, because the
crawlers and comp pullers run locally with his browser sessions.

**⚠ Vision does not run in production** until `ASSYZE_VISION_TOKEN` is set.

---

## 11b. Risk enforcement — SHIPPED 2026-08-25 (audit P0-2)

`src/verdict/risk-gates.ts`. Per-category required checks with three states, and
**the default is `unresolved`** — silence is not safety. Most listings never
mention activation lock, and reading that absence as "probably fine" is exactly
what turns a $400 phone into a $40 paperweight.

**REMOTE vs IN-PERSON is what keeps the gate from killing the feed.** Requiring
every check resolved before BUY sounds safe and is useless: sellers never write
"clean IMEI, paid off, signed out of iCloud", so no phone would ever be BUY.

| | |
|---|---|
| **remote** unresolved | caps at VERIFY. Asking costs one message. |
| **in-person** unresolved | does NOT block BUY; becomes a MANDATORY condition on it. |
| **failed** | RISK, always. |

BUY means "worth leaving the house for" — Yish's floor is $100 profit to make a
trip, not a promise the money is safe to hand over. Activation lock genuinely
cannot be settled remotely; the rule is you never hand over cash without seeing
the home screen, not that you never go look.

**Vision overrides text.** `bootScreenOnly` forces ACTIVATION_LOCK back to
unresolved even when the description claims otherwise — sellers of locked phones
photograph exactly that.

**Negation matters.** "no MDM, no firmware password" is a seller CLEARING the
check; a bare `\bmdm\b` read it as a disclosure and turned the cleanest possible
MacBook listing into a RISK.

## 11c. Outcome loop — SHIPPED 2026-08-25

`src/tracker/outcomes.ts`, `bun run outcomes`. Two kinds, kept distinguishable:

- **OBSERVED** — the delisting tracker saw it vanish. Free, automatic, says the
  market cleared at a price. Only `likely_sold` is recorded; reposts and expiries
  are noise that would drag every measured clearing price around.
- **REPORTED** — Yish bought or passed. Rare, and the only source of true
  realised margin. Mixing the two would turn "what the market paid" into "what
  Yish earned", which are different numbers.

Headline metric is **valuation error**: predicted median vs actual clearing
price. Consistently positive means pricing HIGH and every BUY is overstated —
the failure that loses money quietly, because each verdict still looks fine.

## 11d. Retail ceiling — SHIPPED 2026-08-25, THREE SOURCES

### The three retailers, and why one was not enough

`RETAIL_SOURCES = ["newegg", "microcenter", "bestbuy"]`, best first for the
categories Yish trades. Yish's call, and the live numbers back it:

| SKU | Micro Center | Newegg | Best Buy | spread |
|---|---|---|---|---|
| RTX 5090 | **$4,339.99** | $4,900 | $4,830 | $560 |
| RTX 5080 | **$1,499.99** | $1,550 | $1,600 | $100 |
| RTX 5070 | $800 | $800 | **$795.59** | $4 |
| RTX 3060 | $480 | **$459.99** | $466 | $20 |

**Micro Center is the only source here that is a PLACE.** The Cambridge MA
store (`storeid=121`, pinned in the worker) is ~20 minutes from Newton, so for
a local buyer it is a genuine alternative rather than a theoretical one — which
is exactly what a ceiling is supposed to measure. It is also the only page that
states LOCAL STOCK (`14 IN STOCK`), so a ceiling from it means "you can drive
over and have one today at this price". Prices are per-store, which is why the
store id AND the store cookie are both set: without them the site answers for
whichever store it infers from the IP, and a Texas price is not a ceiling.

**A Best Buy markup was assumed and was wrong.** The first read of $795.59 for
an RTX 5070 looked like a 45% markup over a ~$549 MSRP. Newegg then said
$799.99 and Micro Center $799.99. The card's street price simply IS ~$800.
That correction is the cross-check paying for itself on its first run.

### The ceiling is the cheapest quote another retailer corroborates

Not `MIN(sources)`. Cheapest-wins is the right definition of a ceiling, but
with three sources it is three chances for a bad parse to win, and the cheapest
bad parse always does. Nine Best Buy ceilings could be hand-verified; thirty
across three retailers cannot.

`latestRetail` takes the latest NEW quote per source, then: if the cheapest is
below `CORROBORATION_FLOOR` (0.6) of the next, the retailers disagree by more
than retailers actually disagree, so the outlier is DISCARDED and reported. A
single-source quote is still used — it is real and it passed every gate — but
`corroborated: false` travels with it.

**Only the comps-disagree branch requires corroboration.** Refusing to price a
SKU is the biggest hammer in `buildVerdict` and should not swing on one page.
The asking-above-new branch does not require it: it quotes a specific real
offer the reader can go check, and being wrong there costs one PASS instead of
every verdict for that SKU.

`skusNeedingRetail` orders by **how many retailers we have asked, fewest
first** — not by whether we have any price. The same SKU list goes to all three
on every run, so corroboration accumulates. Ordering by "has any price" would
mark a SKU done the moment ONE retailer answered, which is the single-source
case the whole design exists to avoid.

### A PREBUILT HAS NO RETAIL TWIN — `NO_RETAIL_TWIN`

Caught live and it was about to do real damage. `--sku "RTX 5070"` also matched
the `Gaming PC RTX 5070` SKU, which pulled three "matching" new machines: a
Yeyian with a Core Ultra 7 270K, a PowerSpec with a Ryzen 5 7500X3D, and a
ViprTech with a Ryzen 7 8700F. **$1,400 to $1,950, sharing one component.** The
CPU, RAM, storage, PSU and case are most of the price and all of them vary, so
"a new gaming PC with an RTX 5070" is a CATEGORY, not a product.

At a $1,400 "ceiling" against a $1,599 used median, the comps-disagree branch
would have returned INSUFFICIENT_DATA for every RTX 5070 build in the feed —
and it would have read as a data-quality finding, which is precisely the trap
`retailMeaning` exists to avoid. `RETAIL_CATEGORIES` already excluded
prebuilts; `--sku` bypassed it. There is now a guard at the write boundary AND
a filter on `--sku`.

### Parser notes per source

- **Newegg** — cards run `QUICK VIEW` ... `Compare`, which also drops the
  SPONSORED block free (those carry no `QUICK VIEW`, and on a GPU search they
  are prebuilt PCs). The name is the line before `Model #:`. **Take the LAST
  bare price in a card, not the first** — Newegg prints the struck-through list
  price first. A `Save:` line is NOT a reliable marker of that pattern; the
  Newegg Refreshed cards show two prices with no Save line. `NEWEGG_PROMO`
  exists because promo text sits BETWEEN the title and `Model #:` and is long
  and word-like: *"Get CONTROL Resonant with selected purchase, limited offer"*
  was read as a $1,200 RTX 5070.
  **Known gap:** `Sold by Newegg` on the page is a FILTER toggle, not a
  per-card marker, so marketplace sellers cannot currently be excluded there.
- **Micro Center** — cards start at `Add SKU:NNNNN to wishlist`. The name is
  the first long line AFTER the card's `Compare` (`Compare Item <title>>` above
  it is a truncated duplicate with a stray `>`). **`Our price` beats `Original
  price`** — both are printed, in that order, so a positional rule takes the
  pre-discount number every time. Their search does loose matching and returns
  unrelated stock when a card is discontinued, which the comp gates handle.
- **Best Buy** — see the card-boundary notes below. Weak on phones.

### `main` can exist and still be EMPTY — a silent-zero trap

Micro Center returned zero lines for the RTX 5070 and 5090 while working for
the 4060, 5080 and 3060. `document.querySelector("main") || document.body`
found the `main` element and read an empty string out of it, because results
render into a sibling on some layouts. **An `||` fallback cannot help — the
element was found, it just had nothing in it.** The worker now checks LENGTH
(>200 chars) before preferring `main`, and retries once.

A silent zero was the worst possible shape: it reported as *"nothing parsed —
the page layout may have changed"*, which would send the next person to rewrite
a parser that was never wrong.

---

## 11e. Retail ceiling — the original Best Buy build

**The feature no comp set can provide.** Every competitor compares used to
used, so a seller who anchors on what they paid just looks expensive next to
other used listings and the comps drift up with them. A buyer can always walk
into Best Buy and pay for a NEW one, which caps what any used unit can fetch.

Two uses, and the second was not the plan:

1. **Asking at or above new.** `buildVerdict` returns PASS with
   *"Buy it new instead — $800 at Best Buy"* once the ask reaches 95% of the
   shelf price. 95% not 100% because retail excludes tax: at 95% pre-tax the
   used unit is already ~89% of what a new one costs out the door, with no
   warranty and no return window.
2. **An independent check on OUR OWN comps.** A used median ABOVE new retail
   cannot be true, so the comps are matching something else. Every other
   confidence signal (comp count, spread, recency) is computed FROM the comps
   and therefore cannot catch a systematically mis-matched set. This can, and
   it refuses to price rather than pricing badly.

`retailMeaning()` splits three ways: `ceiling`, `comps_wrong`, and
`implausible` (retail under 35% of the used median) — the last is a parse
escape, NOT evidence about the comps, so a scraper bug can never masquerade as
a data-quality finding.

**Nine ceilings pulled so far and all nine agree with the archive** — the used
median lands at 53-93% of new on every one. That is nine independent
confirmations that the comps are matching the right products.

### Best Buy is strong for consoles and GPUs, weak for phones

Found live, and it drives the `RETAIL_CATEGORIES` order (`console, gpu, laptop,
tablet, phone`). **Best Buy no longer sells carrier iPhones outright** — only on
a 36-month instalment, and every one of those cards is Sold Out for outright
purchase. The single new outright price on the whole iPhone 16 page was the
16e. The first queue was fourteen phones and would have returned nothing.

`saveNoRetail()` records the absence so the queue stops re-asking dead
questions. The Xbox One X is discontinued and Best Buy has never carried the
Valve Index; without a dated "we looked, there was nothing" row those two head
the never-observed list on every run forever.

### `--replay` re-scores archived pages instead of scraping

Every run writes the raw page lines to `docs/testset/retail-lines.json`. Every
parser fix so far came from staring at lines already captured, so re-running a
browser to re-test a pure function is slow, is another session Best Buy sees,
and re-introduces the one variable you were trying to hold still.
`bun run retail --replay` costs seconds.

### The gates are shaped differently from the comp gates, on purpose

**Cheapest-wins inverts the burden of proof.** A bad comp is one vote among
many; the ceiling takes the single cheapest offer, so anything that slips
through IS the answer. The comp gates say "reject if clearly wrong" — correct
there, insufficient here. `titleCoversQuery` says "require it to be clearly
right": every meaningful query word must appear, with the FIRST word optional
because it is the brand and Best Buy drops the manufacturer on first-party
hardware ("XBOX Series X", never "Microsoft Xbox Series X").

Caught in one live run. Every one of these was stored as a real ceiling before
the fix:

| Stored as a ceiling | Actually | Gate that now stops it |
|---|---|---|
| $12.99 KontrolFreek Thumbgrips | not a Valve Index | `titleCoversQuery` — "Valve Index" has no digits, so the digit gate had nothing to check |
| $39.99 Quest 3S Facial Interface | an accessory | named accessory + the 40%-of-page-median floor |
| $449.99 "Explore Nintendo Switch 2" | a navigation tile | `NAV_TILE` |
| $539.99 iPhone 16**e** | a cheaper sibling | `compMatchesQuery` digit boundary — the hand-rolled `includes` had to go |
| $599.99 PS5 Slim **Digital** | no disc drive | new `console` variant pattern |
| $0.00 sold-out iPhone 15 | financing-only | `available` / `financedOnly` |

**The page-median floor is the one that generalises.** The named-accessory list
only catches words I thought of, and Best Buy's accessory catalog is unbounded.
Results for a device query are mostly that device, so anything under 40% of the
page median is a different kind of object. It only ever removes CHEAP outliers
— an expensive one cannot win a cheapest-wins pick anyway.

**`parseBestBuy` segments on card boundaries, not price proximity.** The first
version walked backward from each price to the nearest plausible title; the live
capture killed it. The title-to-price gap is 3 lines on one card and 9 on
another, and the filler is review text long enough to look like a product name
(*"(1 review from bestbuy-ca)"* was parsed as a $449 phone). Every card ends
with the literal word `Compare`. Inside a card the name is the LAST plausible
line BEFORE the first price — not the first line of the segment, because the
first segment on any page is the whole filter sidebar plus the first product,
and reading forward picked up *"Brand new in the original packaging."* (the
Condition filter's help text) and priced it as a phone.

### Two catalog fixes fell out of this

- **VR headsets are devices.** `headset` sits in ACCESSORY because a gaming
  headset is a $40 peripheral, so a real $600 *"Meta - Quest 3 512GB | Virtual
  Reality Headset"* was thrown out as an accessory. The qualifier is what
  distinguishes them and it is always present on the device.
- **"Digital" is a variant only where a DISC sibling exists.** The Xbox Series
  S and every Switch are digital-only by design, so the retailer writes
  "All-Digital Console" as a description of the only model there is. Treating
  it as a variant rejected the sole new Series S on the shelf.
  `DIGITAL_ONLY_LINE` in `ebay.ts`. On a PS5 or a Series X the distinction is
  real and worth $80-100, so it stays enforced there.

**Retail is keyed on (sku, storage_gb).** SKUs are capacity-agnostic on purpose
— the LISTING's storage picks the comp tier at valuation time — so a ceiling
stored against the SKU alone would cap a 512GB phone with the 128GB shelf price
and look authoritative doing it.

**Stale ceilings are dropped, not used** (`RETAIL_STALE_DAYS = 45`). Retail
moves; last year's launch price would cap nothing and flag nothing.

**Still open: PSVR2 titles mistype as accessories.** *"Sony PlayStation VR2
Headset"* still resolves to `accessory` even with the lexicon terms added. It
costs nothing today — Best Buy's PSVR2 page is games and refurbs, so "no
ceiling" was already the right answer — but the term is not matching and the
reason has not been chased down.

---

## 11e2. A chip is not a product — board tier, 2026-08-25

**Yish's observation**, and the measurements back it. He said a graphics card
search returns a very broad price range because brands, fan counts and cooler
tiers differ, and the same is true of RAM and other parts.

Measured across Newegg, Micro Center and Best Buy on one day, 42 genuinely-new
in-stock RTX 5070s ran **$795.59 (PNY Epic-X) to $1,669 (ASUS T1) — 110% for
identical silicon.** Normalised against the cheapest card for each chip:

| tier | n | median vs cheapest card for the same chip |
|---|---|---|
| base | 66 | 1.07x |
| mid | 48 | 1.16x |
| premium | 54 | **1.40x** |

An ASUS PRIME RTX 5070 was $819.99 and the PRIME **White** $919.99 on the same
page — **$100 for a colour**, a bigger step than base-to-mid. Confirmed
independently at Micro Center. `special` promotes one tier for that reason.

### The used market COMPRESSES the tier premium, and that is the useful part

Measured within each chip, salvage excluded, on SKUs with >=6 comps in both
buckets: premium/base is **1.36x (5080), 1.03x (4090), 1.11x (3080 Ti)** —
3/3 positive, median **1.11x**. Against 1.40x new.

So the honest scope is narrower than the raw range suggests, and the
interquartile spread of used GPU comps is only **1.08x-1.25x** — the median is
robust and the extremes are the tails, not the bulk. Tier matters:

1. **Enormously for the retail ceiling**, which takes the CHEAPEST offer and so
   always lands on the budget card. Comparing an ASUS TUF listing to a PNY
   ceiling is the worst case in the system, because the ceiling drives a PASS.
   `retail_prices.board_tier` now stores one ceiling PER TIER per source — the
   offers are already on the page, so the extra rows cost nothing. Resolved
   RTX 5070: base $796, mid $810, premium $900.
2. **Modestly for the comps.** The filter is gated at **n>=8** rather than the
   storage filter's 5, precisely because tier is a weaker discriminator and a
   thin tier-matched sample trades a small bias for a large variance.

Cards naming no known line are KEPT in both places. Silence is not
disagreement, and treating an unnamed card as budget runs in the direction that
turns a good deal into a PASS.

**The ladder is NAMED, not inferred** (`signals/board-tier.ts`). Deriving tiers
from observed prices needs retail coverage for every chip, and would be
circular for the ceiling — the thing being corrected. Validation is empirical
though: the first run left 19 cards `unknown` whose median was 1.27x, i.e. they
were not unclassifiable but PREMIUM lines missing from the ladder (ZOTAC
Apocalypse/ARCTICSTORM, ASUS NOCTUA, Gigabyte MASTER). Adding them dropped
unknown to 12 at 1.16x — mixed, as unknown should be.

**Still to do: the same treatment for RAM, SSDs and PSUs.** Yish named them and
they have the identical shape — CL latency and kit brand for RAM, DRAM vs
DRAM-less and TLC vs QLC for SSDs, 80+ tier and modularity for PSUs. The
`component` SKUs are unsplit today.

---

## 11f. assyze.com is LIVE — 2026-08-26

**`https://assyze.com` is the production URL. Use it everywhere.** Valid
Let's Encrypt certificate (`CN=assyze.com`, issued 2026-08-26), HTTP 200,
health reports `canPrice: true`.

`assyze-production.up.railway.app` still works and is the Railway-generated
name. It is a fallback for debugging, **not the address of the product** —
never quote it to Yish or put it in user-facing copy.

**`www.assyze.com` does NOT work and is not a bug to chase.** Railway counts it
as a SECOND custom domain and the plan allows one; the Networking page says
*"You have hit the custom domain limit for your plan."* The `www` CNAME resolves
but Railway will not serve it — no binding, no certificate. Apex-only until the
plan changes. Leaving the DNS record in place is harmless.

### What was wrong: the TXT verify value was pasted TRUNCATED

Worth keeping, because nothing about it looked like a typo:

    railway-verify=a05568e0d5fb544fb073a78d0778cb…
                                                  ^ an ELLIPSIS, not a hex digit

It is the string Railway's "Configure DNS Records" modal DISPLAYS — the `…` is
the UI marking the value as cut off, and selecting the visible text copies it.
Railway never verified, never requested a certificate, and the dashboard sat on
*"Waiting for DNS update"* with a green tick on the CNAME row and a warning on
the TXT row. On :443 the edge fell back to its own `CN=*.up.railway.app`
wildcard, which does not cover `assyze.com` — the `SEC_E_WRONG_PRINCIPAL`
error. **Use the modal's copy control, never the visible text.**

### CORRECTION: `n3reqlxc.up.railway.app` was never stale

An earlier entry said that target was dead because it returns 404 `Application
not found`. **Wrong, and the mistake is worth keeping.** Railway's edge routes
by HOST HEADER, so the bare CNAME target has no app bound to it and 404s BY
DESIGN. With the right Host it always worked:

    curl -H "Host: assyze.com" http://n3reqlxc.up.railway.app/v1/health   -> 301

The DNS target was correct the whole time. Do not "fix" it.

### The working DNS, for reference

| Record | Host | Value |
|---|---|---|
| ALIAS | `@` | `n3reqlxc.up.railway.app.` |
| CNAME | `www` | `n3reqlxc.up.railway.app.` (resolves, not served) |
| TXT | `_railway-verify` | the FULL `railway-verify=...` token |

An **ALIAS** at the apex is correct — a CNAME there is invalid DNS, and
Namecheap's ALIAS is the right instrument. No CAA records, so nothing blocks
issuance.

### Production could not price anything — FIXED 2026-08-25

    before:  {"ok":true, "comps":0,  "skus":62}
    after:   {"ok":true, "canPrice":true, "comps":6247, "skus":221}

**Zero comps.** Live, healthy, serving the frontend, and returning
INSUFFICIENT_DATA for every single listing because it held not one sold price.
The boot seed fires only when `skus == 0` and plants only the hardcoded
catalog — it never carried a comp, so the empty-database check passed happily
forever and `/v1/health` said `ok: true` the whole time.

**Fix: `data/archive.json.gz` is COMMITTED** (390 KB: 221 SKUs, 258 aliases,
6,247 comps, 35 retail quotes). The container imports it on boot when its comp
count is materially below the archive's. See `src/db/archive.ts` and DEPLOY.md.

    bun run archive           export local -> data/archive.json.gz
    bun run archive --check   what the committed archive holds
    bun run archive --import  merge it into THIS database

**Why a committed file.** Every other route to the volume needs a credential —
CLI login, SSH, an upload endpoint with a shared secret. This travels the path
already authorised and already working: commit, push, Railway builds, import on
boot.

**Idempotent, verified.** `UNIQUE(source, source_item_id)` on comps and a
unique `alias`, so every insert is `ON CONFLICT DO NOTHING`; a second import
adds 0 rows. A newer archive MERGES, never replaces, and nothing is deleted.

**SKU IDS ARE REMAPPED, NEVER CARRIED.** Local and production `skus.id` are
independent autoincrements seeded in different orders, so copying
`comps.sku_id` verbatim would file thousands of comps against the WRONG
products — silently, with confident wrong medians as the only symptom. Comps
reference their SKU by `category|brand|model` and re-resolve on import.

Verified against a fresh database seeded exactly as production is: 62 catalog
SKUs, then +159 SKUs and +6,247 comps in 107ms, every spot-checked median
matching local to the dollar (RTX 5080 $1251/n=99, RTX 5070 $615/n=64, iPhone
16 Pro Max $756/n=51). Then verified LIVE — the same Craigslist URL returns the
identical verdict from production and local ("Overpriced — $392 underwater
after fees", 179 comps).

**`/v1/health` now sets `ok` from `canPrice`** (comps > 0 && skus > 0) rather
than the literal `true`. A liveness probe that cannot tell "working" from
"structurally unable to answer" is a ping, not a health check.

### The feed now REFRESHES — production crawls Craigslist itself

Fixed in the same pass, because a pricing engine with nothing to price is the
same bug one layer up. assyze.com was serving **three Craigslist listings, all
2+ weeks old, `lastCrawl: null`** — `crawl` is a CLI script and nothing in the
container ever called it.

`src/api/scheduler.ts` runs it on a self-rescheduling chain. Measured on a
fresh database: **1,376 live Craigslist listings discovered across the five
categories in 2 seconds**, and 160 analysed produced 18 PASS, 2 FAIR, 2 VERIFY,
24 OUT_OF_SCOPE and 114 INSUFFICIENT_DATA.

- **Backfill mode.** Under 400 listings it runs 4x the limit every 3 minutes;
  above that, 40 every 45. A day-long fill for an empty marketplace is not
  worth waiting for and the analysis is text-only and cheap.
- **A self-rescheduling chain, not `setInterval`.** The delay is decided AFTER
  each run so backfill can switch back to steady, and the next run is scheduled
  from the END of the last, so a slow crawl cannot stack up behind itself.
- **`maxVision: 0`.** The budget guard is $2/day and an unattended loop is
  exactly how it gets spent on listings nobody asked about. Vision runs on
  demand when someone opens a listing.
- **Never throws.** An unhandled rejection in the loop would take down the
  server; a failed crawl is not a reason to stop serving.
- `ASSYZE_CRAWL=off` disables it. `ASSYZE_CRAWL_LIMIT` / `ASSYZE_CRAWL_INTERVAL_MS` tune it.

**FACEBOOK CANNOT RUN IN THE CONTAINER, and that is architectural.**
`sources/craigslist.ts` is a plain `fetch()`. Facebook Marketplace needs a
logged-in Chrome profile that Yish signs into by hand, and shipping credentials
into a server image is both a security problem and against the standing rule
that no credential handling gets added. **Facebook listings must be crawled
locally and pushed** — no mechanism for that exists yet.

**71% of analysed listings come back INSUFFICIENT_DATA**, because most
Craigslist items do not resolve to a SKU that has comps. That is the real
coverage ceiling on the feed, and it is a catalog problem, not a crawler one.

Live state 2026-08-26, 523 analysed listings on assyze.com: 373
INSUFFICIENT_DATA, 109 OUT_OF_SCOPE, 35 PASS, 4 FAIR, 1 VERIFY, 1 RISK.
**Actionable calls are ~1%.** That is the honest yield of a Craigslist-only
feed against the current catalog, and growing the catalog — not crawling
harder — is what moves it.

### The live feed immediately exposed a matcher bug — FIXED 2026-08-26

The first production crawl put two network switches in the feed as **VERIFY at
$311 and $269 net on $5 and $50 asking prices.** A D-Link Ethernet switch was
matching the Nintendo Switch 2 SKU and being priced against console comps.

**Root cause, and it was much wider than one silly match.** `matchSku` filtered
model tokens with `w.length > 1`, which DROPPED the single most discriminating
token a model name can carry. `norm("Switch 2")` splits to `["switch","2"]`,
the `2` was filtered out, and the SKU was left with NO discriminators — so the
generation guard directly above it silently did nothing for any model whose
generation is one character:

    "Sony PlayStation 4 console"  -> priced as PlayStation 5
    "Sony PlayStation 3 slim"     -> priced as PlayStation 5 Slim
    "Xbox One S console"          -> priced as Xbox One X
    "D-Link Ethernet Switch"      -> priced as Nintendo Switch 2

It defeated the exact trap that guard was written to catch. Single characters
are now kept, and **a single character in a MODEL name is treated as a
discriminator** — digit or letter, because model names are curated catalog data
where a lone character is never noise and is usually the whole distinction
(Xbox One **X** vs **S**).

### Variants now gate the MATCHER, not just the comps

Found in the same pass. `n.includes(alias)` is a substring test, so **"ASUS TUF
RTX 5070 Ti" matched the plain RTX 5070 SKU at HIGH confidence** and was priced
~40% under what a Ti is worth — turning a genuinely good listing into a PASS.
"RTX 4070 Super" did the same against the base 4070.

`compMatchesQuery` had guarded the COMPS against this for weeks; the matcher
never learned it. The longest-alias rule cannot help either, because the more
specific SKU **does not exist in the catalog at all** — which is precisely when
being wrong is most expensive.

Both the alias path AND the token path check it. Guarding only the alias path
moved the bug rather than fixing it: "RTX 5070 Ti" fell through to token
matching, scored 2/2 = 1.0 against the plain 5070 and came back MEDIUM, which
`valueSku` happily prices since only `low` is refused.

`variantPattern` moved to **`src/signals/variants.ts`**. It lived in
`sources/ebay.ts`, and the catalog must not depend on a source.

Re-verdicting all 366 stored listings after the fix: 269 INSUFFICIENT_DATA, 54
OUT_OF_SCOPE, 36 PASS, 5 FAIR, 1 RISK, 1 BUY. More INSUFFICIENT_DATA than
before, which is the point — those were confident wrong numbers.

### ENGINE_VERSION IS LOAD-BEARING — bump it on any behaviour change

The matcher fix above deployed cleanly and **the two bad rows stayed on the
live feed anyway.** The feed reads STORED verdicts, and the crawler skips
listings it has already seen, so shipping an engine fix changed nothing a user
could see. That is the shape to watch for: the fix was correct, deployed, and
invisible.

`verdicts.engine_version` was already being recorded and never read.
`reverdictStale()` in `api/scheduler.ts` now compares it against
`ENGINE_VERSION` on every crawl tick and re-scores anything older —
`checkStored` re-runs signals, matching and valuation against listing text
already in the database, so no refetch and no source traffic.

**Forgetting the bump is now the way a fix silently fails to reach users.**

**THE ARCHIVE DRIFTS. `bun run stats` now says so.** Production prices off the
committed file, not your local db, so every comps pull widens the gap
silently — the same shape as the original bug. Re-export and commit after any
`ebay:comps` or `retail` run.

**Vision IS configured in production** — `visionEnabled: true`,
`tokenRequired: false`, `$2/day`, `claude-haiku-4-5`.

### `www` will not work on the current plan

The Networking page reads *"You have hit the custom domain limit for your
plan"* with one custom domain used. Railway treats `www.assyze.com` as a
SECOND custom domain, so the `www` CNAME resolves but Railway will not serve
it — no binding, no certificate. Apex-only until the plan changes. The record
is harmless to leave in place for later.

---

## 11g. The 2026-08-26 correctness pass — every bug the LIVE FEED found

**None of these were visible before the feed had real listings in it.** Yish
opened the "can't tell" verdicts, found four wrong answers in a minute, and
diagnosing them exposed several more. Counting outputs is not reading them.

### The matcher was blind to single characters

`matchSku` filtered model tokens with `w.length > 1`, dropping the single most
discriminating token a model name can carry. `norm("Switch 2")` splits to
`["switch", "2"]`, the `2` was filtered out, and the SKU was left with **no
discriminators at all** — so the generation guard sitting directly above it
silently did nothing for any model whose generation is one character:

    "Sony PlayStation 4 console"  -> priced as PlayStation 5
    "Sony PlayStation 3 slim"     -> priced as PlayStation 5 Slim
    "Xbox One S console"          -> priced as Xbox One X
    "D-Link Ethernet Switch"      -> priced as Nintendo Switch 2, $311 net on
                                     a $5 network switch

A single character in a MODEL name is now a discriminator, **digit or letter** —
model names are curated catalog data where a lone character is never noise and
is usually the whole distinction.

### Variants gate the MATCHER now, not just the comps

`n.includes(alias)` is a substring test, so **"ASUS TUF RTX 5070 Ti" matched the
plain RTX 5070 SKU at HIGH confidence** and was priced ~40% under what a Ti is
worth — turning a good listing into a PASS. `compMatchesQuery` had guarded the
COMPS against this for weeks; the matcher never learned it, and the
longest-alias rule cannot help when the more specific SKU **does not exist in
the catalog at all**, which is exactly when being wrong is most expensive.

**Both paths check it.** Guarding only the alias path moved the bug: the Ti fell
through to token matching, scored 1.0 against the plain 5070, and came back
MEDIUM — which `valueSku` prices, since only `low` is refused.

`variantPattern` now lives in **`src/signals/variants.ts`**. It was in
`sources/ebay.ts`, and the catalog must not depend on a source.

### The title decides the category; the description only breaks ties

    "NVIDIA GeForce RTX 4090 Founders Edition 24GB GDDR6X Graphics Card"
    -> category `prebuilt` -> "Can't be valued — cpu not stated."

The seller had pasted NVIDIA's own marketing copy into the description
("ultra-high performance gaming", "gamers and creators"), which trips the
prebuilt pattern. **Assyze asked a graphics card which CPU it had.** That
listing is a BUY at $653 net; the bug was hiding it.

### `laptop` runs BEFORE `prebuilt`

They are both whole machines, so the machines-before-parts ordering never
applied between them — and prebuilt's vocabulary swallows portable hardware.
**31 laptops were being priced as desktops**: "Dell 5540 Mobile Workstations
8-Core i9", "Lenovo P50 Mobile Workstation", "Dell Precision 7510 Workstation
Laptop". A mobile workstation is a laptop. `all-in-one` also needs a computer
word nearby, because "PRINTER HP ENVY 6055E---Wireless All In One" was a
prebuilt asked for its GPU.

### A bare "i7" is a stated CPU

"Lenovo P50 Mobile Workstation. Windows 10 Pro, i7, 32GB RAM" came back "cpu not
stated" with the CPU in the middle of the title. It is a weak spec, but the
field asks whether the seller SAID it — and the comp spread already expresses
the uncertainty.

### RAM was being read as STORAGE

The drive-word lookahead let the RAM figure claim the drive word sitting behind
the real storage figure. Fourteen characters is exactly enough to step over one:

    "Dell XPS 16GB RAM 512GB SSD"   -> storage 16
    "MacBook Air M3 8GB 256GB SSD"  -> storage 8
    "Gaming PC 32GB DDR5 1TB NVMe"  -> storage 32

`valueSku` filters comps by storage tier, so this quietly priced laptops and
phones against the wrong capacity band.

### `unknown` is OUT OF SCOPE, and so are monitors and bulk listings

An **autographed Aaron Rodgers jersey** reached the deals feed reading
*"Couldn't identify the exact model"*. A jersey has no model. `inScope()`
already existed and already returned false for it — `buildVerdict` just never
called it.

**46 monitors, TVs, routers and hard drives** said the same thing. They are
genuinely tech, so the grammar layer correctly called them tech and they fell
through to a failure message. A 24-inch Asus monitor is not something Assyze
covers and never will be: there are no comps because nobody ever asked for any.
`NOT_OUR_MARKET` says so plainly. `BULK_LISTING` catches inventory dumps
("24 Computers, Printers, Monitors left starting at just $30").

### COUNTERFEITS — checked FIRST, before anything can price them

*"Apple iPhone 15 Pro Max 1TB CLONE Unlocked"* at $99 read as **VERIFY with $433
of net profit**. Every layer downstream did its job correctly on the assumption
the thing was real: the matcher resolved a genuine SKU, the comps were genuine
1TB comps, the margin genuinely was enormous.

Nothing later in `buildVerdict` can undo that, because the rest of that function
reasons about PRICE. A counterfeit is not mispriced — it is a different object,
worth nothing to resell at any price, and reselling one is fraud. **There is no
asking price at which the answer changes, which is what makes it a blocker
rather than a discount.** So it is settled before valuation, alongside
out-of-scope.

Matched on the **title only**: a description reading "genuine, not a clone" or
"beware of clones on here" is a seller distinguishing themselves FROM one, and
reading that as a confession punishes the honest listing. `refurbished` and
`aftermarket battery` are deliberately absent — a repaired real phone is a real
phone.

### The scam signals the RTX 5090 exposed

A $2,500 Gigabyte RTX 5090 at 59% of market, in Nonantum, returned **zero
flags**. Three separate failures:

1. **The Craigslist parser dropped BARE attributes.** It required a `labl`
   span, and flag attributes render with no label — so `cryptocurrency ok` and
   `delivery available`, the two strongest signals on the page, were discarded
   as structured data Craigslist hands us for free.
2. **`analyze()` never read attributes at all**, only title and description.
3. **`IRREVERSIBLE_RAILS` had no crypto** — it listed Zelle, Venmo, Cash App
   and wire, but not the one rail that is untraceable as well as irreversible.

Added `SHIPS_ON_LOCAL_MARKET`: a pickup-market listing offering to ship, gated
at $400+. Not a veto on its own — some genuine sellers ship — but next to crypto
and a price far below market it is the whole pattern in one post.

**That card was never found on Facebook Marketplace** (two searches). The only
5090 results were people BUYING at $4,450-4,500 — nearly double what this seller
was asking, ten minutes from him.

---

## 11h. Production runs itself — crawl loop, re-verdict, archive

### `ENGINE_VERSION` IS LOAD-BEARING. BUMP IT ON ANY BEHAVIOUR CHANGE.

The matcher fix deployed cleanly and **the bad rows stayed on the live feed**,
because the feed reads STORED verdicts and the crawler skips listings it has
already seen. Shipping an engine fix changed nothing a user could see.

`reverdictStale` in `api/scheduler.ts` compares `verdicts.engine_version`
against `ENGINE_VERSION` on every crawl tick and re-scores anything older.
**Forgetting the bump is now the way a fix silently fails to reach users** — and
it happened again the same day, on the storage fix, which is why 0.3.6 exists.

It DRAINS the backlog rather than nibbling: 400 per tick was fine during
backfill (3-minute ticks) and useless in steady mode (45-minute ticks), where a
945-listing backlog took over two hours.

### The crawl loop — `src/api/scheduler.ts`

assyze.com served **three Craigslist listings, all 2+ weeks old, `lastCrawl:
null`** — `crawl` is a CLI script and nothing in the container ever called it.
Fixing the comps archive gave the engine the ability to price and nothing to
price. Same bug, one layer up.

- **Backfill mode.** Under 400 listings: 4x the limit every 3 minutes. Above:
  40 every 45. The first crawl found 1,376 live Craigslist listings in 2
  seconds.
- **A self-rescheduling chain, NOT `setInterval`** — the delay is decided AFTER
  each run so backfill can switch back, and the next run is scheduled from the
  END of the last, so a slow crawl cannot stack up behind itself.
- **`maxVision: 0`.** The guard is $2/day and an unattended loop is exactly how
  that gets spent on listings nobody asked about.
- **Never throws.** An unhandled rejection would take down the server.

### The comps archive ships as a COMMITTED FILE

Production ran for weeks reporting `comps: 0, skus: 62` — live, healthy, serving
the frontend, returning INSUFFICIENT_DATA for **every single listing**. The boot
seed fires only when `skus == 0` and plants only the hardcoded catalog, so the
empty-database check passed happily forever.

`data/archive.json.gz` is committed and imported on boot.

    bun run archive           export local -> data/archive.json.gz
    bun run archive --check   what the committed archive holds
    bun run archive --import  merge it into THIS database

**It imports UNCONDITIONALLY.** The old gate was `comps >= archive.comps * 0.9`
and it silently blocked everything that was not a comp: `MacBook Air M5` was
added, exported, deployed — and production kept answering "Couldn't identify the
exact model", because its comp count already matched. SKUs, aliases and retail
quotes were riding on a comp-count check that had nothing to do with them.

**SKU ids are REMAPPED, never carried.** Local and production `skus.id` are
independent autoincrements seeded in different orders, so copying `comps.sku_id`
verbatim would file thousands of comps against the WRONG products — silently,
with confident wrong medians as the only symptom. Comps reference their SKU by
`category|brand|model`.

**THE ARCHIVE DRIFTS and `bun run stats` says so.** Production prices off the
committed file, not your local database, so every comps pull widens the gap.

### `/v1/health` means something now

`ok` is computed from `canPrice` (comps > 0 && skus > 0) rather than the literal
`true`. A probe that cannot tell "working" from "structurally unable to answer"
is a ping, not a health check.

### The feed pages

It served 40 of 425 with no pager, so the rest was unreachable and the on-screen
count contradicted the header. `offset` + `total` on the API, a **Show more**
button in the web app. Ranking happens across the whole pool, so page 2 is the
continuation of one ordered list rather than a second-best bucket.

### The app shell — read this before touching any layout CSS

**THERE IS NO FAKE PHONE FRAME AND THERE MUST NEVER BE ONE AGAIN.** A
`.stage`/`.phone` pair used to draw a simulated iPhone at `min-width: 880px`
with a "Shown at iPhone 16 size" hint. It was a desktop preview aid and it
leaked onto real devices, causing three symptoms that all looked like separate
bugs:

- the document was WIDER than the viewport, so the page could only be scrolled
  with two fingers and pinch-zoom stayed enabled;
- the frame was a fixed-height box and `.tabs` was `position: absolute` inside
  it, so the bottom nav rendered at the END OF THE SCROLL CONTENT — Deals /
  Check / You were unreachable until you scrolled past 285 listings;
- every measurement taken in a desktop browser looked correct, because at
  desktop width the simulation is what you are supposed to see.

`.app` is now a plain `max-width: 560px` centred column and `.topbar` is
`position: sticky`. **Verify layout at 384x832, DPR 3, `isMobile: true`** — a
1280px headless check cannot see any of the above.

**There is no bottom nav.** Three tabs was one place and two actions: pasting a
link is something you DO and a profile is not a destination you visit. Both are
icon buttons in the top bar; the feed owns the screen.

**The grid card radius is hard-coded 18px, on purpose.** It does not read
`--r-lg`. It is deliberately rounder than Facebook Marketplace's ~8px and it is
the single shape decision that makes the feed read as an app rather than a web
grid, so it must not be able to change as a side effect of a token tweak
somewhere else.

**Stats are overlaid on the photo, not printed under it.** `.gshot::after` is a
scrim over the LOWER 58% only — it exists to make the numbers legible, not to
dim the product.

**The clipboard is the primary action on Check.** `navigator.clipboard
.readText()` behind "Paste link and check". You arrive there having just copied
a link elsewhere; tap-hold-wait-Paste is four gestures for something the browser
gives up in one. It throws when refused or unavailable, and the catch focuses
the input — the old behaviour, never a dead button.

**Supported sources are stated as chips before you paste.** `badUrl` accepts
Craigslist only, so an OfferUp link used to come back as an error that read like
the app was broken. When a source goes live, flip its chip in `App.tsx` AND
`SUPPORTED` in `src/api/index.ts` together.

#### A class rename that lands on one side is INVISIBLE

The feed hero rendered with no card, border or radius for a full session. The
JSX said `dealhero`; the CSS said `.fhero`. Every INNER class (`.hshot`,
`.hover`, `.hprice`) still matched, so it did not look broken — it looked like a
deliberately flat hero. Screenshots confirmed "the hero is there" while a
`document.querySelector` check kept returning null, and the contradiction got
written off as a hydration race. **Trust the selector, not the screenshot:** a
partially-styled component is the failure mode a screenshot cannot show you.

#### A disabled brand-fill button reads as BROKEN, not inactive

`.cta:disabled { opacity: .4 }` over a solid orange fill is still obviously
"the orange button", just dim — it reads as a button that failed rather than one
waiting for input. Disabled drops the fill entirely and falls back to a bordered
ghost.

---

## 11i. The tracker, alerts, billing — shipped 2026-08-26

### The sweep now RUNS. It never did before.

`sweep` was written, worked, had a script, and nothing in the container ever
called it, so the feed had never once checked whether its listings were still
up. Now on its own 24h chain (`startSweepLoop`) with a `sweeping` flag separate
from `running`, so a sweep and a crawl overlap without delaying each other.
First run at +10min; probes capped at `ASSYZE_SWEEP_PROBE` (60) so the first
production sweep does not fire hundreds of requests in one burst.

**Delisted listings are hidden from the feed by default**, `?gone=1` shows them.
They rank last rather than being deleted, because "sold in 4 days at $650" is
the clearing evidence the outcome loop is built on.

#### ⚠ `listing_prices` was NOT a history, and the drop read as zero

The move branch only writes on a CHANGE; the baseline branch only fires when a
listing had no price at all. So a listing captured at $1,800 and cut to $1,500
held ONE row, containing $1,500 — and `MIN(observed_at)` returned the CURRENT
price, giving a drop of zero. That is why the feed showed no price moves on the
day a sweep reported four. Sweep now seeds `(asking_price_cents, captured_at)`
where no row exists at or before capture: idempotent, backfills, and it is a
real observation rather than an invented one. Seeded 492 locally.

#### ⚠⚠ ZERO IS "NO PRICE SHOWN", NEVER A PRICE

A search card whose price fails to parse yields 0 and the guard only tested for
`null`, so two listings had a real `$145 -> $0` history — a 100% discount that
would have been the top-ranked deal on the site. Same family as the "missing
asking price became zero" trap. Guarded at the source AND in the feed. A drop
must clear **$5 and 3%** to be badged; below that it is a seller rounding their
own number, and badging it trains people to ignore the badge.

### The app shell has a bottom toolbar again

Removing it was wrong. The bug was `position: absolute` inside the fake phone
frame, which put it at the end of the scroll content. It is `position: fixed`
with `env(safe-area-inset-bottom)` now, `.scroll` reserves its height, and
there are four real destinations: Deals / Check / Saved / You. **Settings is
NOT a tab** — twice-a-year screen, and it would cost the room Saved needs.

**`.gcard` is a DIV, not a button.** It contains a save button, and a button
inside a button is invalid HTML that browsers "fix" by hoisting the inner one
out, detaching the tap target. `.gopen` fills the card; `.gsave` sits on top.

### Watchlist stores IDS, never listings

`/v1/watchlist?ids=` re-reads current state every visit. Storing a copy would
freeze the price at save time, which defeats the point — you save something to
be told when it CHANGES. localStorage means no account; ids the server no
longer resolves are pruned or the count drifts from the screen forever.

### Alerts: the push subscription IS the account

`src/api/alerts.ts`. VAPID + `web-push`. Rules, each one a way the feature gets
itself switched off:

- **Only listings captured AFTER the search was saved.** Matching the backlog
  sends fifteen notifications for week-old listings.
- **Every query word must appear**, not any. "rtx 4090" on "rtx" alone returns
  every GPU on the site.
- **A listing with no price never satisfies "under $1,400."**
- `alert_sent` is a real table: a re-verdict bumps a listing without changing
  its id, so "already sent" cannot be inferred from timestamps.
- Alerts run right after the crawl, not on a timer — the whole value is latency.

#### ⚠ TWO kinds of dead subscription

404/410 is the push service. But a bad `p256dh` fails while web-push is
ENCRYPTING, before any HTTP request, so there is **no status code** and the row
survives to be retried every crawl forever. Both are dropped now. Verified
against a real FCM 410.

`applicationServerKey` needs raw BYTES, not the base64 string — the string
fails with an opaque `InvalidCharacterError`.

### Billing is BUILT AND OFF

`src/api/billing.ts`. `billingEnabled()` is false until `STRIPE_PRICE_ID` is
set; every endpoint 503s and the UI shows the free plan. The Phase 3 gate is
"10 payers, >=3% conversion" and there are no users — a paywall in front of an
audience of one costs the only thing that matters. Flipping it on is one env
var.

**No card details ever reach this server** (hosted Checkout). **The webhook is
the ONLY thing that grants access** — `?paid=1` is a hint to refresh, never
proof, which is the most common way a checkout integration gives the product
away. Signature verification needs the RAW body; re-serialised JSON breaks it
and the usual "fix" is to skip verification, which makes the endpoint a free
subscription generator. Verified both ways: forged event -> 400 and no
entitlement, HMAC-signed -> 200 and active.

Subscription id is stored on the way in because `customer.subscription.*` carry
no `client_reference_id`, so without it a cancellation can never be matched and
access is never revoked.

### Share target — ANDROID ONLY

`share_target` in the manifest -> `/share`. **The link arrives in `text`, not
`url`**, on the most common path (Chrome's page share sends a text blob), so
all three params are joined and a URL extracted from anywhere in the string.
History is REPLACED, or Back re-runs the check. **iOS cannot do this** — Web
Share Target is Chromium-only and Safari has never shipped it.

### eBay is now a SOURCE

`src/sources/ebay-source.ts`, Browse API, `bun run ebay:search "rtx 4090"`.
Asking prices on active listings — never comps. Marked `basis: ebay` because
eBay-to-eBay pays fees on BOTH ends.

#### ⚠ `conditions:` IS SILENTLY IGNORED — use `conditionIds:`

The `conditions` filter takes a fixed enum (USED_EXCELLENT, USED_VERY_GOOD, …).
The obvious `conditions:{USED|VERY_GOOD|GOOD|ACCEPTABLE}` is not rejected, it is
IGNORED — the request succeeds unfiltered. A live search returned a $1,453 NEW
card and a $465 open-box one, i.e. retail inventory in an arbitrage feed. Now
`conditionIds:{3000|4000|5000|6000}`; 1000 (New) and 1500 (Open box) are
deliberately absent. FIXED_PRICE only — an auction's current bid is not a price
you can buy at.

### Environment variables added

    VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT   push alerts
    STRIPE_SECRET_KEY / STRIPE_PRICE_ID / STRIPE_WEBHOOK_SECRET   billing (off)
    ASSYZE_SWEEP=off · ASSYZE_SWEEP_INTERVAL_MS · ASSYZE_SWEEP_PROBE

---

## 12. Live traps

### ⚠⚠ A RESELLER'S INVENTORY AD IS NOT A LISTING

The largest single group inside "couldn't identify the model" was shops, not
products. The engine was trying to price a whole stock as one machine and
honestly reporting that it could not — but "can't tell" is the wrong answer
when there is no unit to tell about. `RESELLER_AD` in `verdict/index.ts`.

Three tells, any one sufficient:

- **"up to N GB"** — a RANGE of machines. A single laptop has an amount of RAM,
  not a ceiling. Strongest signal and the one most of them share.
- **Retail-event language** — "Spring Laptop Blowout Sale!", "Holiday Laptop
  Deals!". Private sellers do not run seasonal promotions on one laptop.
- **A PLURAL product noun** — "Mobile Workstations", "Touchscreens".

**Do NOT extend this to spec soup** ("i7, SSD, Windows 11"). A genuine private
listing reads identically and matching on it deletes real inventory.

### ⚠ USED LAPTOPS ARE A LONG TAIL — enumerating SKUs does not scale

Measured on the live feed: **44 unmatched laptops spanned ~17 distinct models,
almost all appearing once or twice.** Adding rows fixes the seventeen you saw
and not the seventeen next week.

What IS worth enumerating is the recurring LINES — Latitude, ThinkPad,
EliteBook, XPS are the bulk of the off-lease market. 39 added on 2026-08-26.
The genuine tail needs a GENERATIVE matcher (brand + line + model number
parsed from the title, SKU created on demand), not more catalog rows.

**Matching is not pricing.** These now resolve to a SKU and still return
INSUFFICIENT_DATA until comps exist — which is the honest intermediate state,
and it changes the headline from "couldn't identify the model" to "no recent
sold comps". Pull comps after adding SKUs or nothing visible changes.


### ⚠ `setVapidDetails` THROWS — never call it outside a try/catch

`web-push` validates hard: the subject must be `mailto:` or `https:`, the public
key must decode to 65 bytes, the private key to 32. A key pasted into a hosting
dashboard with a trailing newline fails all of that, and the failure surfaced as

    POST /v1/push/test  ->  500 Internal Server Error   (no body)

which names none of the three. It also killed `runAlerts` on every crawl,
silently, because that calls the same function.

`configure()` catches, caches the reason, and returns false. Env values are
TRIMMED — copy-paste through a browser picks up whitespace constantly and a
trailing newline in a base64url key is invisible in every UI that shows it.

`/v1/health.push` now reports `usable`, `error`, and the key LENGTHS (expect
**87** public, **43** private). Lengths, never values: a truncated or padded key
IS the failure mode, so the number is the whole diagnosis.

`/v1/push/vapid` returns `configured: false` and a null key when the server
cannot load the pair, so the app never offers to subscribe against a keypair
that can never deliver.


### ⚠⚠ COMP THE WHOLE MACHINE — and make sure the SKU EXISTS

This rule was already written down and was still unreachable in practice:
exactly ONE build SKU existed (`Gaming PC RTX 5070`), so every other build fell
through to the parts sum **by default rather than by judgement**. Yish rejected
a $467 valuation on an i7-10700/RTX 2080 build and was right.

The parts path prices components at eBay SOLD prices and then takes 25% off via
`WHOLE_UNIT_RATIO`. That is a PART-OUT valuation. An assembled, tested,
Windows-installed machine sold to a gamer is not a bag of parts.

    parts sum      $467, 22 comps, LOW confidence
    whole machine  $549, 18 comps, HIGH confidence

14 `Gaming PC <GPU>` SKUs now exist (5090 down to GTX 1660).
**When you add a GPU tier, add the matching build SKU and pull its comps**, or
that tier silently reverts to the parts sum.

### ⚠⚠ A COMP MUST BE THE PRODUCT, NOT A MACHINE CONTAINING IT

Sold listings for `i7-10700` return bare CPUs AND every Dell OptiPlex, XPS,
Precision and G5 built around one. Measured: **26 bare chips at $140, 38 whole
computers at $275, combined median $199** — the CPU was valued 40% high.

Filtered in `valueSku` for `component` and `gpu` only, by HEAD NOUN via
`resolveProductType`. Prebuilt SKUs are exempt: whole machines are the point
there. A substring match on "desktop" is WRONG — it throws away
"i7-10700 Desktop Processor" along with "Dell G5 Desktop i7-10700".

### ⚠⚠ NO LOCAL DISCOUNT ON SOMETHING THAT CANNOT SHIP

`FACEBOOK_GROSS_RATIO = 0.85` is a BUYER-POOL penalty — eBay reaches the
country, Facebook reaches your metro. Real for a phone or a GPU.

**Not real for a tower.** `ship === null` already means eBay is not an
available channel, and the eBay comps we hold for it are overwhelmingly
local-pickup sales — the small-pool constraint is ALREADY priced in, because it
is why the thing cannot ship. Charging it twice valued every gaming PC 15%
under its own observed sales, on the only channel it has: 18 sold RTX 2080
builds at a $549 median reported as $467.

Facebook charges no fee, so the discount can only be justified by pool size,
and for local-only categories it cannot be. `fbRatio` is 1 when
`basis === "local"` OR the item cannot ship.

**The 0.85 that remains is still an assumption, never measured.** The outcome
loop replaces it. Do not treat it as fact.


### ⚠⚠ NEVER pool a category to measure a ratio — Simpson's paradox
`measuredMultiplier` pooled all component comps and computed new/used = **6.07x**.
That is not a condition premium; 59 of the "new" rows were an expensive current-gen
i7-14700KF while "used" was dominated by cheap 6700K/6700/8500 sales. **It measured
the SKU MIX.** Within the 14700KF alone the ratio is 1.12x.

The pooled figure then "adjusted" a $425 new chip down to ~$53 and pushed that
SKU's used median to **$62 for a CPU that plainly sells for ~$250** — a
confidently-derived four-fold error with real data on both sides and nothing
anywhere reporting a problem.

Fix: compute the ratio **within each SKU**, then take the median across SKUs.
Requires 3+ comps on each side per SKU and 3+ SKUs, else fall back to the prior.

### ⚠ A SKU is not a price point — storage tiers differ by hundreds
An "iPhone 16 Pro Max 1TB" was valued against a median that included 256GB
sales. `valueSku` now drops comps whose title states a DIFFERENT capacity, keeps
ones that state none (silence is not disagreement), and abandons the filter
below 5 survivors rather than returning a confident number from four rows.

**Still open: RAM and CPU tier do the same thing on laptops.** A "Latitude 7420
i7 32GB" is priced against i5/8GB units in the same SKU.

### ⚠⚠ SALVAGE IS A DIFFERENT MARKET — exclude it, never adjust it
Yish, reading the comps table: *"you cant calculate that into the median when
the listing doesnt say it has any problems."* He is right, and the bug beneath
it was worse than a modelling choice.

**`normalizeCondition` could not parse its own output.** The stored enum is
`for_parts` with an UNDERSCORE; the pattern looked for `for parts` with a space.
So it returned null, `adjustPrice` returns its input unchanged when `from` is
null, and **every for_parts and open_box comp went into every median at face
value** — $75 and $91 no-boot iPhones sitting in a working phone's median.

Even fixed, adjusting is wrong. The phone multiplier is 0.18, so restating a $75
salvage sale as "used" DIVIDES by 0.18 — inventing a $417 data point and
multiplying the prior's error by 5.6x. `comparable()` now refuses to mix working
and salvage in either direction, and `BROKEN_TITLE` catches sellers who write
"No Boot" in the title while eBay's condition field says used.

### ⚠ eBay's "NEW LISTING" badge is not a condition
It is glued to the title with no separator — `NEW LISTINGApple iPhone 15
Unlocked` — and `^new` matched it. Recently-listed USED phones were stored as
`new`, dragged through the new->used multiplier, AND corrupted the measured
multiplier itself: phone new/used read **1.03** because half the "new" bucket was
used phones. After repair it reads 1.24.

**The `raw_json` rule saved this one.** A first fix rejected any condition line
over 40 characters and destroyed 2,141 good rows — eBay writes
`Open Box · Nintendo Switch · ...`, condition first, specifics after. All 5,940
were restored from the archived payload. Split on `·` and test the FIRST field.

### ⚠ A partial parts sum must be scaled UP before the whole-unit discount
Yish on a $650 build valued at $130: *"its an entire pc not just the gpu I think
you didnt add all of the parts together."* The error compounded — gpu $175 + cpu
$42 = $216 at 64% coverage, then x0.6 whole-unit = $130. **The 0.6 assumes a
COMPLETE parts list**, so applying it to 64% coverage charged the discount twice.
Divide by coverage first, then discount once.

`valueByParts` also priced components with a raw SQL `AVG` (in a column named
`med`), bypassing condition adjustment, salvage exclusion and the 90-day window —
an RTX 5070 read $674 inside a build and $615 standalone. It now calls
`valueSku` per part. **A component's price cannot depend on which path asked.**

### ⚠⚠ COMP THE WHOLE MACHINE. A parts sum is the FALLBACK, not the method.
Yish, twice, before the data agreed with him: *"its an entire pc not just the
gpu"* and then *"there shouldnt be any % of ebay at all because im not buying it
from ebay."* He was right about the number and about the method.

```
NZXT build (RTX 5070 + Ryzen 5 9600X), asking $750
  parts sum, scaled and discounted        $890
  USED whole PCs with an RTX 5070         $1,375 median, n=25
  nearest comps   $1,140 (RTX 5070 + 9700X + NZXT case)
                  $1,200 (RTX 5070 + 7600X)
```

**The assumption underneath the parts path was backwards.** It discounted an
assembled machine below its components. For current-gen gaming PCs the market
pays a PREMIUM for built-and-working — iBUYPOWER and Skytech towers clear ABOVE
component cost. `valueWholeBuild` looks up a `Gaming PC <GPU>` SKU and uses real
tower sales; the GPU is the anchor because it sets the tier and every listing
names it. Parts remain the fallback, and the parts-vs-whole spread is still what
tells you whether parting OUT beats selling whole.

Verdict went $890/PASS -> $1,416 market, $454 profit, **BUY** — matching Yish.

### ⚠ `??` DESTROYS A DELIBERATE null
`SHIP_CENTS.prebuilt` is `null` meaning "a tower cannot be shipped, so eBay is
not a channel". `SHIP_CENTS[category] ?? 1500` evaluates that to **1500** —
nullish coalescing cannot distinguish an intentional null from a missing key — so
the local-sale-only branch was UNREACHABLE and every gaming PC was priced as if
you could post it for $15. Use `category in SHIP_CENTS`.

### ⚠ Compare the asking price to the RIGHT market
The below-60%-of-market escalation compared a LOCAL asking price against an eBay
median. Local prices are systematically under eBay — that gap IS the flip — so
every Craigslist listing looked suspiciously cheap. The NZXT build read "53% of
market" and was escalated purely for being local. Now compares against
`best.grossCents`, the price in the channel actually available.

### ⚠ A check that fires on everything carries no information
The BIOS/supervisor-password check ran on every prebuilt and held a custom NZXT
gaming build at VERIFY with $454 of margin, waiting on a question about a
password no enthusiast builder sets. `RISK-MODEL.md` lists it under BUSINESS
off-lease units, where corporate IT sets them. Now gated on `BUSINESS_OEM`
(OptiPlex, EliteDesk, ThinkCentre, off-lease, asset tag). This is the
over-flagging CALIBRATION 10c warns about.

### ⚠ Know what market a price is denominated in
Yish: *"why did you * 0.6 and then *0.85 the build? theres no fees if i resell
it on marketplace."* Two separate double-counts, stacked:

**1. The local discount was applied twice.** `FACEBOOK_GROSS_RATIO` (0.85) is
NOT a fee — eBay's 13.25% is charged separately — it is a claim that the same
item fetches ~15% less locally. But a tower cannot be shipped
(`SHIP_CENTS.prebuilt` is null), so an assembled PC only ever sells locally and
the whole-unit ratio already lands in that market. `netByChannel` now takes a
`PriceBasis`; a parts valuation declares itself `local` and is not re-discounted.

**2. The whole-unit ratio was applied to the wrong base.** The research reads
*"parting out realises 60-80% of component value; selling whole realises
50-70%"* — both are percentages of COMPONENT VALUE, but our parts sum is built
from eBay SOLD prices, which is the realised part-out figure already. The ratio
that actually applies is whole-versus-part-out: 60/70 = 0.86, times ~0.87 for
the eBay fees a real part-out would pay = **~0.75**, not 0.6.

Effect on the NZXT build: $712 -> **$890**, and the verdict moved PASS -> VERIFY
with $140 of margin against a $135 floor. Yish graded it BUY; the remaining gap
is the GPU display-output check, which is in-person and correctly still open.

**0.75 is a PRIOR, not a measurement.** The outcome loop replaces it: a build we
valued and then watched clear is the only honest source for this number.

### ⚠ Apple machines are whole units, never part sums
Yish: *"its an apple imac, your not supposed to grade it off of just gpu and cpu
because most of the time its not gonna give that info."* The GPU is soldered,
nobody parts one out, and the listing says "2019 27-inch 5K". Routing it down the
prebuilt path made the engine demand two fields that do not exist and return
INSUFFICIENT_DATA on every Mac desktop ever crawled. `isAppleWholeUnit()` gates
both the bundle path and the missing-value-field check.

### ⚠ Anchor every gitignore and dockerignore pattern
A bare `photos/` matched `src/photos/` at any depth and silently excluded source
code from every commit. Railway crashed on `Cannot find module` forever while
local builds worked. **When a deploy says a module is missing, the FIRST check
is `git ls-files <path>`, not a theory about Docker.**

### ⚠ Never pass `-c user.email` on a commit
27 commits landed attributed to a different person. GitHub attributes by EMAIL.
A `.git/hooks/pre-commit` guard now blocks the wrong email.

### ⚠ Do NOT patch source files through Python heredocs
`\b` in a non-raw Python string is a literal **BACKSPACE (0x08)**. It silently
corrupted three regexes across this session — `stripListedPrefix` returned its
input unchanged while the identical regex worked inline, and `cat -A` showing
`/^listed^H.*?^Hin/` was what finally revealed it. **Use the editor tool for
anything containing backslashes.** Audit: `grep -c $'\010' src/**/*.ts`

### ⚠ Index spaces must match when comparing positions
`findNouns` searched a NORMALISED copy (punctuation stripped, whitespace
collapsed) and returned indices into it, which were compared against separators
found in the RAW title. Offsets never lined up, and stripping punctuation
deleted the very commas the list rule needs.

### ⚠ `\blaptop\b` does not match "laptops"
A laptop listing resolved to "keyboard" for want of an `s?`.

### ⚠ `Date.parse("Aug 20")` returns YEAR 2001, silently
It does not fail. That comp then sits 9,000 days outside the 90-day window and
is dropped from every valuation with nothing reporting a problem. eBay omits the
year on recent sales — most of them. Only trust `Date.parse` when a 4-digit year
is present.

### ⚠ A SKU with no digit in its model is a FAMILY, not a product
`matchSku` requires every digit-bearing SKU token to appear in the listing, so a
bare "MacBook Pro" SKU matches a 2012 and a 2024 equally.

### ⚠ Wrong-generation matching — FIXED, keep the rule
A 2019 Intel MacBook matched "MacBook Pro M3" on `{macbook, pro}` = 0.67
overlap. A **SKU token containing a DIGIT is a discriminator** and every one
must appear in the listing. Ties break toward the MORE specific SKU. Defence in
depth: `valueSku` gets null for any `confidence: "low"` match.

### ⚠ The CPU regex demanded a part number
Vision returned `cpu: "Intel Core i7 2.6 GHz 6-Core"` and the verdict still said
"cpu not stated" — `VALUE_FIELDS.laptop` required `i7-9750H`, and a Mac spec
screen never shows one. Both patterns now accept a bare `core i7`.

### ⚠ Missing asking price became ZERO
Making every unpriced listing look like free money. It was masked by other
checks firing first, which is luck.

### ⚠ Sum-of-parts was unreachable dead code
`EXPECTED_ROLES` had 7 entries, only gpu+cpu were priced, max coverage
2/7 = 0.286 against a 0.30 gate. And `sum / R * R` is the identity function
while the computed value was discarded anyway. Coverage is now weighted by what
components are actually worth (GPU 42%, CPU 22%).

### Deploy traps
- Nixpacks cannot detect Bun from `bun.lock`; Bun OOMs running Vite.
- **SQLite creates the FILE, never the DIRECTORY.**
- **Bind `0.0.0.0`.** Loopback in a container is invisible to the platform.
- **`/v1/health` must not require the database** — it turned a DB fault into a
  silent 91s timeout.
- Cross-building amd64 on this ARM64 machine is unreliable (QEMU segfaults).

### Engine traps
- **Never sample photos.** The funnel may drop LISTINGS; once a listing reaches
  vision it must never drop PHOTOS.
- **Don't regex the model's prose — ask for a boolean.** A port check fired on
  "no visible damage."
- **Store every comp forever.** eBay exposes ~90 days.
- **Verdicts are RELATIVE TO THE USER.**
- **Never ask a user for Facebook or eBay credentials.**

---

## 13. Decisions the maintainer made — do not re-litigate

- **Craigslist crawling proceeds despite their Terms of Use.** Green-lit
  2026-08-24: *"Im not worried about getting caught or anything so go right
  ahead even if it is against their terms."*
- **Facebook Marketplace automation likewise.** Same call. The realistic penalty
  is his account, which is why the crawler runs at human pace in a visible
  window rather than headless and fast.
- **Pushing to GitHub needs no permission** (and it auto-deploys). Still ask
  before tagging, installing, publishing a release, or spending money.
- **Highest resolution always** on source photos.
- **Haiku for vision**, pinned.

---

## 14. Codex audit — status

`docs/AUDIT-FINDINGS-2026-08-24.md` (technical) and
`docs/ECOSYSTEM-EXPANSION-2026-08-24.md` (product ideas).

**Fixed:** P0-1 (unauthenticated paid vision), P1-6 (dead sum-of-parts),
P1-5 (asking price -> 0), P1-1 (stale vision cache).

**Confirmed and still open:**
- **P0-2 the risk model is documented but NOT enforced.** A device can reach BUY
  without activation-lock / IMEI / MDM / ban evidence. **This is the biggest
  remaining correctness gap and it contradicts the product's core promise.**
- **P0-6/P0-7** production DB is disconnected from the local archive, has no
  volume backup, and the local backup excludes ~117 MB of photos.
- **No tests exist.** Everything verified this session was by hand.
- P0-4 Craigslist ToU — decided, see §13.
- P0-5 eBay API — see "The eBay production keyset" below. **Codex was right:**
  a keyset does NOT unlock sold comps.

### The eBay production keyset — LIVE as of 2026-08-26

`bun run ebay:auth` proves it end to end. Credentials in the gitignored `.env`.

**WHAT DISABLED IT, AND WHY THE ERROR LIES.** A production keyset with neither
a deletion endpoint nor a granted exemption **cannot authenticate at all**, and
eBay reports that as `invalid_client — client authentication failed`. The keys
were byte-exact the whole time; the portal carried a "Your keyset is currently
disabled" banner that nobody had read. **Never debug eBay credentials without
looking at the keyset page first.**

Satisfied by `src/api/ebay-deletion.ts` at `https://assyze.com/v1/ebay/deletion`.
Endpoint over exemption because an exemption is a review queue with no deadline
and we already run HTTPS on a stable domain. `EBAY_VERIFICATION_TOKEN` and
`EBAY_DELETION_ENDPOINT` are set in Railway; `/v1/health` reports
`ebay.deletionConfigured` so it can be checked without letting eBay fail a
challenge (which disables the keyset again).

**Measured surface, 2026-08-26:**

| API | Status | Use |
|---|---|---|
| Buy → Browse | **200** | active listings, with condition / price / buying-option filters |
| Commerce → Taxonomy | **200** | category tree AND per-category item aspects |
| Buy → Marketplace Insights | **403 Access denied** | sold comps. Closed, as documented. |

**SO THE BROWSER COMP SCRAPER STAYS.** Nothing about the 13,981 comps changes.
What the keyset actually buys is eBay as a SOURCE (next actions §6, which was
going to need another crawler and is now an API call), the Sell APIs for the
Phase 5 sell side, and Taxonomy aspects as an authoritative schema for the
catalog.

**⚠ Browse search is as dirty as any scraped title.** A `q=rtx 4090` query
returns laptops CONTAINING a 4090, external GPU docks, 4080s, and a $29.99
1:1 scale REPLICA. Browse results must go through `matchSku` and the counterfeit
signals exactly like every other source — a filtered `total` is not a count of
the product you asked for.

---

## 15. Next actions

**Yish's stated order, 2026-08-26: UI and the Codex-audit features are next.**
Everything below the line is engine work he has already asked to be deferred
until after that.

1. **UI + the features Codex flagged.** His words: *"after all of that we will
   focus on UI and features such as the ones that Codex pointed out."* See
   section 14 for the audit status.

---

2. **Keep filling the comps queue.** 64 SKUs still have zero comps.
   `bun run ebay:comps --skus 10` orders itself worst-first; ten batches is
   about thirty minutes and moved INSUFFICIENT_DATA from 425 to 181 in one
   session. **Re-export the archive afterwards or production stays behind** —
   `bun run stats` reports the drift.

3. **The remaining INSUFFICIENT_DATA is mostly real coverage now**, not bugs.
   The composition after the 2026-08-26 pass: unmatched laptops (Latitudes,
   Chromebooks, Inspirons the catalog lacks) and custom builds whose CPU is
   named only as "Ryzen 5" with no part number. `bun run catalog:derive
   --apply` mines new SKUs from observed listings and added 67 last run.

4. **Retail coverage is GPU-heavy.** Newegg and Micro Center are shipped and
   cover gpu/component well. Phones and laptops have no usable ceiling — Best
   Buy sells carrier phones on financing only, and neither of the other two
   sells phones at all. Walmart is the obvious next source. **Yish ruled out
   Apple deliberately on 2026-08-25.**

5. **Phone comps are the open valuation dispute.** iPhone 15 128GB and iPhone
   16 Pro Max are the two remaining eval disagreements and Yish reads the
   medians as low. Retail cannot referee this one, so it needs better comps or
   `bun run outcomes`.

6. **eBay as a SOURCE, not just a comp feed.** Yish raised it 2026-08-25: good
   deals exist there if you are alerted the moment they post. **It changes the
   margin math** — eBay-to-eBay means fees on both ends, so it needs a
   different basis from local arbitrage. Alerts come after the UI, his call.

7. **Write tests.** Still none, and this session shipped seven engine versions
   in a day. Start with `product-type`, `condition`, `matchSku`, the eBay
   parsers, `parseBestBuy` and `parseCards` — all pure, all currently verified
   only by hand, and `docs/testset/*-lines.json` are ready-made fixtures.

8. **Run `bun run sweep` daily.** Every day it does not run is clearing-price
   history nobody can refetch.

9. **`/v1/checks` still only accepts Craigslist URLs.** Facebook, OfferUp and
   Mercari need a browser to fetch a single listing, so the paste-a-link box
   cannot serve them the way the crawlers do. `badUrl` says so honestly.

10. **`retail` and `riskChecks` do not reach the web API.** Both are carried on
    the verdict and rendered by `bun run review`, but the site never sees them.

---

## 16. Key documents

| File | What it is |
|---|---|
| `DEPLOY.md` | Railway deploy, DNS, and why not Vercel |
| `docs/MASTER-PLAN.md` | Product design, architecture, GTM, sequencing |
| `docs/RISK-MODEL.md` | **The moat.** Hard blockers vs flags, per-category rules |
| `docs/CALIBRATION-2026-08-23.md` | What Yish's 69-listing audit corrected |
| `docs/VERDICT-SCHEMA.md` | Output contract |
| `docs/AUDIT-FINDINGS-2026-08-24.md` | Codex's technical audit |
| `docs/ECOSYSTEM-EXPANSION-2026-08-24.md` | Product/ecosystem ideas |
| `docs/sessions/` | Session logs with rejected directions and why |
