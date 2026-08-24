# HANDOFF — Assyze

**This file is the master plan AND the current state. Update it before you stop working.**
It replaces the old `PLAN.md`. If something here is stale it is worse than missing, because
a fresh session will believe it.

Last updated **2026-08-23**.

---

## 1. What Assyze is

**The app that tells you what a used tech listing is really worth and what's wrong with it, before you drive.**

**The thesis:** used tech has *binary, hidden value-destroyers* that price comps never capture — iCloud Activation Lock, blacklisted IMEI, carrier lock, EFI lock, battery health, mined GPUs, datacenter cards with no display outputs. Every competitor values the **model**. None of them value the **risk**.

**Governing principle: reliability over coverage.** Missing a good deal costs nothing. Sending someone 45 minutes to a scam ends the brand. The engine is allowed to say "I don't know" — every competitor always returns a number, and that is their weakness, not their strength.

**Scope:** laptops, phones, GPUs, prebuilt PCs, consoles, tablets, components.
**Out:** furniture, clothing, cars, and **cameras/photo gear** (cut 2026-08-23 — no domain knowledge to audit against).

---

## 2. Current state — 2026-08-23

### Working end to end
```
bun run ingest <url> [--vision]   fetch → parse → signals → photos → hash → store
bun run verdict                   match → value → verdict, over all stored listings
bun run score                     compare engine verdicts against Yish's audit
bun run stats                     archive health
bun run seed                      catalog + economics + judgments
bun run comps:provisional         hand-entered placeholder comps (DELETE when eBay lands)
bun run check <url> [--vision]    check ONE live url through the engine, staged timings
bun run api                       HTTP API on :3177
```

### The engine is now a callable service
`src/engine/index.ts` — `checkListing(url, {onStage})` and `checkStored(id)`. Everything
above this layer (API, mobile, batch) calls it and knows nothing about SQL or photo paths.
The extraction was verified **byte-identical** against the previous script output.

### The API — `src/api/index.ts`
```
POST /v1/checks              one-shot JSON      ~140ms text-only
GET  /v1/checks/stream       SSE, one event per stage
GET  /v1/checks/:id          permalink target (shareable verdict)
GET  /v1/health
```

**Measured stage latency (text-only):**
```
 38ms  fetched    listing parsed, photos, price
 43ms  signals    red flags — pure compute, no I/O
 44ms  valued     match + comps + verdict
 46ms  done
```
Photo download is backgrounded — blocking on it cost 1.1s for no user benefit.

### The web app — `web/`
React + Vite, dev on **:5177**, proxies `/v1` to the API so EventSource is same-origin.
`bun run dev` in `web/`. Routes: `/` (the tool) and `/c/:id` (shareable verdict permalink).
Streams via SSE and renders progressively — header, then flags, then the verdict.

**Run both:**
```
bun run api            # :3177   (use `bun run api` not `bun run src/api/index.ts` — it has --hot)
cd web && bun run dev  # :5177
```

**Trap:** the API does NOT hot-reload if started without `--hot`. A stale process silently
served verdicts missing the `questions` field for two test rounds before it was caught, and
`pkill -f` does not kill it on Windows — use
`Get-NetTCPConnection -LocalPort 3177 | Stop-Process -Id $_.OwningProcess -Force`.

### In the database
| | |
|---|---|
| SKUs | 62 (101 aliases, 8 dead-liquidity) |
| Comps | 80 — **all provisional/fake**, covering 10 of 62 SKUs |
| Listings | 10 |
| Vision results | 5 |
| Judgments (eval set) | 69 |
| **Engine vs Yish** | **3/10 exact · 3 harsher · 3 softer — no directional bias** |

### Built
- **Ingestion** — `src/sources/craigslist.ts`. Plain fetch works; no proxy needed.
- **Cheap-signals layer** — `src/signals/`. Listing age w/ platform decay, listing quality, seller sophistication, missing value fields, payment rails, geographic contradiction, zero photos, spec-sheet language, cluster detection.
- **Impossibility table** — `src/reference/compatibility.ts`. PCIe gen by socket, DDR gen by platform, iPhone connector by generation, condition contradictions, display-less compute cards.
- **Photos** — `src/photos/`. Download all, dHash (resize+recompress robustness measured at distance 3), duplicate detection at Hamming ≤ 10.
- **Catalog matching** — `src/catalog/match.ts`. Alias-first with longest-match, token fallback, category-aware (a whole machine never matches a component SKU), attribute extraction, alias learning.
- **Valuation** — `src/valuation/`. IQR bands from comps, sum-of-parts for bundles with a coverage guard, channel economics (eBay 13.25% + fixed + shipping by category vs Facebook zero-fee at 0.85 gross), required-profit from user economics.
- **Verdict** — `src/verdict/`. Precedence: out-of-scope → hard blocker → missing value field → no comps → bundle coverage → money.
- **Vision** — `src/vision/`. Headless Claude Code (subscription, not API). Reads spec screens, detects lock screens, boot-screen-only, screenshot artifacts, display outputs, port damage. Feeds matching and signals.

### NOT built
Web app · backend API · accounts · payments · mobile · listing auto-draft · alerts/discovery · real comps.

---

## 3. The master plan

Phases have **gates**, not dates. Move on when the gate opens. Each has a **kill signal** — the thing that means stop and rethink rather than push harder.

### The invariants
Build these regardless of how the product changes. They are valuable in every version:
1. **The comps archive.** eBay exposes only ~90 days. Every day not running is history you never get back.
2. **The canonical catalog.** Garbage title → real SKU. Ugly, and why competitors stay shallow.
3. **The risk model.** Yish's domain knowledge, written down. `docs/RISK-MODEL.md`.
4. **Reliability over coverage.** Wins every argument it's in.

---

### ✅ Phase 0 — Does the engine see? **GATE OPEN**
30+ listings, vision accuracy ≥70%, lock screens detected, refuses to guess when photos are insufficient.
**Result:** passed on all three. Findings in `docs/testset/RESULTS-2026-08-23.md`.

---

### 🟡 Phase 1 — Is the engine right? **IN PROGRESS**

**Done:** catalog matching · valuation logic · channel/fee math · verdict assembly · vision wired into matching · auto-scoring against the audit.

**Remaining:**
- [ ] **eBay comps ingestion** — blocked on Production keys (account under review)
- [ ] Delete provisional comps, backfill the archive properly
- [ ] Re-run `score` against real data
- [ ] Ingest the remaining ~59 audited listings so the eval set is fully scored
- [ ] Yish: fill section 11 of `docs/RISK-MODEL.md`

**Gate:** engine agrees with Yish on the calls that matter, and **zero cases of a flagged scam labelled a good deal** (absolute, not a percentage).

**Kill signal:** comps too sparse to value common items, or accuracy that can't get past "sometimes."

---

### ⬜ Phase 2 — Do strangers trust it?

**Build:** `assyze.com` **is the app**, not a brochure. Paste a listing URL, get a verdict. Explainer content sits *below* the tool. Backend API + thin client from day one — all value stays server-side so the mobile rewrite is only the UI.

**Why web first:** a link is the only thing a stranger will click. Nobody installs an app from someone they've never heard of. The web app is **not** a throwaway — it stays permanently as top-of-funnel and as Yish's own cockpit.

**Gate:** 20–50 real flippers have used it, people return unprompted, and at least one says some version of *"this stopped me buying something bad."*

**Kill signal:** people try it once and never return — the verdict isn't better than their gut.

---

### ⬜ Phase 3 — Will they pay?

Free tier with a hard scan cap, Stripe, accounts. Hypothesis: ~10 free analyses/month, paid at **$14.99–19.99** (above flippr's $12.99 on depth, far below Swoopa's $47).

**Gate:** 10 paying users still paying in month two.
**Kill signal:** heavy free usage, zero conversion.

---

### ⬜ Phase 4 — Mobile

React Native + Expo. **Google Play first** ($25, no review queue like Apple's, testable on Yish's S24). iOS after, via EAS Build — **no Mac required**.

Only start after Phase 3. An app nobody pays for on the web won't be paid for on a phone.

React and React Native share a language but not components, so the UI gets rewritten. That's fine — it's the cheap layer. Engine, catalog, comps and risk model port untouched.

**Gate:** mobile retention beats web retention.

---

### ⬜ Phase 5 — Sell side + discovery

- **Listing auto-draft** — photos in, complete listing out, one tap to publish. eBay has a Sell API (true one-click); Facebook has none (draft + paste).
- **The outcome loop** — this is the moat. **There is no sold-comps source for Facebook Marketplace anywhere.** The only way to learn local realized prices is to record what users' own sales actually got. If the app drafts the listing, the app knows what it sold for.
- **Alerts/monitoring** — deliberately LAST. It's the commodity nine competitors fight over on price. You earn the right to compete there by having verdict quality nobody else has.

---

### ⬜ Later — multi-platform

Three different jobs, do not conflate:
- **Supply** (find listings): Facebook, Craigslist, OfferUp, Mercari — none have APIs except eBay.
- **Used comps** (what it's worth): eBay sold only.
- **New retail** (the ceiling): Best Buy (open API — easy, do first), Walmart (needs approval), Amazon (PA-API deprecating → Keepa at €49/mo). B&H has no API and cameras are cut, so skip.

The retail ceiling alone catches 4 audit traps with zero comps: Xbox 2TB at 2.5× retail, Quest 3S at retail, ROG Ally X above retail, the RAM cluster.

---

## 4. Live traps

- **Never sample photos.** The funnel may drop *listings*; once a listing reaches vision it must never drop *photos*. Phase 0's miss was a skipped third image containing the entire spec sheet.
- **Don't regex the model's prose — ask for a boolean.** A port-damage check fired on "no visible damage." Second negation bug of the session.
- **eBay's sold window is 90 days and the free API is gone.** `findCompletedItems` EOL'd Feb 2025; Marketplace Insights is closed to new applicants. **Store every comp forever, from the first one.**
- **Never ask a user for Facebook credentials or a session token.**
- **Meta v. Bright Data:** Meta lost and dropped it. Their ToS binds *logged-in* users; logged-out collection of public data was found not to violate it.
- **Automating Facebook posting risks the account that sources everything.** Draft-and-hand-off gets ~all the value with none of the ban risk.
- **A confident wrong number is worse than no number.** Sum-of-parts once priced a whole PC off its GPU alone and said PASS. Coverage guard now prevents it.
- **Verdicts are computed RELATIVE TO THE USER.** Same listing is honestly BUY for one person and PASS for another. `user_economics` is not optional.
- **Apple's 0% on US external payment links is a window, not a rate** — SCOTUS took the case, Apple has asked for up to 15%. **Google charges 10% regardless of billing method.** Model 10–15% blended.
- **Craigslist no longer renders location on detail pages.** Geographic-contradiction only fires on search-page ingestion.

---

## 5. Open decisions

| Question | Status |
|---|---|
| Full dead-category list | 3 known: VR, pre-2019 Intel Macs, datacenter GPUs. More will surface from outcomes. |
| Section 11 of `RISK-MODEL.md` | **Yish to fill** — the stories only he has |
| Facebook gross ratio (0.85) | A guess. Gets replaced by real outcome data in Phase 5. |
| Archive backup | `.db` is gitignored and irreplaceable. Needs a real backup once comps flow. |
| Anthropic API key | Not needed yet — vision runs on the subscription via headless Claude Code. Needed at Phase 2 when a server answers users. |

---

## 6. Immediate next actions

**See `docs/MASTER-PLAN.md` for the full plan. Headlines from it:**

1. **NEW Phase 1.5 — ship the risk layer alone, free, no signup.** It works today with zero comps and is fully unblocked. This reverses the earlier "wait for valuation" position and accelerates everything.
2. **Yish:** eBay Production keys → `.env` when the account clears review.
3. **Vision must move off headless Claude Code to the Anthropic SDK** — one multi-image request at 768px instead of sequential CLI reads. 30s → 3-6s, the highest-leverage single change available.
4. **Five decisions are waiting on Yish** — `MASTER-PLAN.md` §7. Biggest: is this for other people or mainly for him?

**Gates were revised.** Two of the three original ones were not usable as written (unmeasurable, or blocked on a two-month calendar). See MASTER-PLAN §1.1.

**The Facebook 0.85 ratio is confirmed wrong** as a flat number — it should be per-category, and for bulky items it may exceed 1.0. MASTER-PLAN §1.2.

---

## 7. Key documents

| File | What it is |
|---|---|
| `DEPLOY.md` | **Railway deploy.** One service serves API + frontend. Volume at `/data` — set it BEFORE first deploy or every push wipes the comps archive. |
| `docs/MASTER-PLAN.md` | **The plan.** Product design, architecture, GTM, pricing, sequencing, engine gaps. Read alongside this file. |
| `docs/RISK-MODEL.md` | **The moat.** Hard blockers vs flags, listing signals, per-category rules. |
| `docs/CALIBRATION-2026-08-23.md` | What Yish's audit corrected. 9 findings, incl. the BUY-threshold reframe. |
| `docs/VERDICT-SCHEMA.md` | Output contract. |
| `docs/research-2026-08-22.md` | Market, competitors, legal, API landscape. |
| `docs/testset/RESULTS-2026-08-23.md` | Phase 0 findings, incl. the corrected NZXT verdict. |
| `docs/testset/audit.html` | The audit tool. Re-runnable. |
| `docs/sessions/` | Session logs, incl. four rejected directions and why. |
