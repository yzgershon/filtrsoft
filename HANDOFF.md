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
skus        89    (30 laptop · 28 phone · 14 gpu · 10 console · 7 component)
comps      270    (190 REAL from eBay · 80 legacy provisional — delete these)
           12 of 89 SKUs have comps
verdicts   305 INSUFFICIENT_DATA · 54 OUT_OF_SCOPE · 2 VERIFY · 2 FAIR
           1 RISK · 1 PASS · 1 BUY
judgments   69 (Yish's audit)  ·  outcomes 0
vision spend to date: $0.055
```

**Engine vs Yish's audit: 3/10 exact, 3 harsher, 3 softer.** No directional
bias. Still measured against mostly-provisional comps — re-run `bun run score`
once real comps cover the eval SKUs.

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
check; a bare `mdm` read it as a disclosure and turned the cleanest possible
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

1. **Enforce the risk model (P0-2).** Category-specific mandatory blockers;
   nothing reaches BUY without named evidence. Biggest correctness gap.
2. **Pull comps for the 30 laptop SKUs.** The search and the market now agree,
   so this is what turns 305 INSUFFICIENT_DATA into real verdicts.
3. **Delete the 80 provisional comps** once real ones cover those SKUs, then
   re-run `bun run score`.
4. **Handle variant suffixes** (Ti/Super/XT) before comps drive BUY calls.
5. **Set `ASSYZE_VISION_TOKEN` in Railway** to enable production vision.
6. **Run `bun run sweep` daily.** Every day it does not run is clearing-price
   history nobody can refetch.
7. **Write tests.** Start with `product-type`, `condition`, and the eBay
   parsers — all pure, all currently verified only by hand.

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
