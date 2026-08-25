# HANDOFF — Assyze

**Master plan AND current state. Update before you stop working.** A stale line
here is worse than a missing one, because a fresh session will believe it.

Last updated **2026-08-25**.

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

## 2. Current state — 2026-08-25

```
listings   366    (341 craigslist · 25 facebook)
skus       220    (120 laptop · 45 phone · 21 gpu · 14 component · 12 console · 8 prebuilt)
comps     6169    ALL REAL, from eBay sold listings. 89 SKUs covered.
                  The 80 hand-typed provisional rows are DELETED.
verdicts   255 INSUFFICIENT_DATA · 54 OUT_OF_SCOPE · 43 PASS · 7 VERIFY
           6 FAIR · 1 RISK
judgments   79  (69 original + 10 re-reviewed WITH the comps visible)
outcomes     3  (observed, from delistings)
retail      20  9 NEW ceilings from Best Buy + 11 dated "we looked, nothing"
                All 9 agree with the archive: used median at 53-93% of new.
vision spend to date: $0.055
```

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
bun run retail [--skus N] [--query ...] [--replay] [--dry]
                                  NEW retail prices from Best Buy (the ceiling)
bun run catalog:derive [--min N] [--apply]    dry run by default

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

## 11d. Retail ceiling — SHIPPED 2026-08-25

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

## 12. Live traps

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
- P0-5 eBay API — resolved a different way, see §4.

---

## 15. Next actions

1. **OfferUp / Mercari sources.** The last two channels Yish asked for. The
   two-runtime Playwright pattern from Facebook and Best Buy carries over, and
   both are local-price sources like the delisting tracker, not eBay-basis.
2. **Phone comps are the open valuation dispute.** iPhone 15 128GB and iPhone
   16 Pro Max are the two remaining eval disagreements and Yish reads the
   medians as low. **Best Buy cannot referee this one** — it stopped selling
   carrier iPhones outright — so it needs better comps or `bun run outcomes`.
3. **Write tests.** Still none. Start with `product-type`, `condition`, the
   eBay parsers and `parseBestBuy` — all pure, all currently verified only by
   hand, and `docs/testset/retail-lines.json` is already a ready-made fixture.
4. **Set `ASSYZE_VISION_TOKEN` in Railway.** Production vision is off until
   this is done. Yish's action, not mine — never paste a key into a web form.
5. **Run `bun run sweep` daily.** Every day it does not run is clearing-price
   history nobody can refetch.
6. **Extend the retail ceiling past Best Buy.** Walmart and Amazon were on
   Yish's original list and would cover the categories Best Buy is weak in —
   above all unlocked phones, where Best Buy returns almost nothing.
7. **Surface `retail` and `riskChecks` in the web API.** Both are carried on
   the verdict and rendered by `bun run review`, but neither reaches the site.

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
