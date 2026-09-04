# Filtrsoft — Master Plan

**Written 2026-08-23.** Planning pass over the whole build-out. Executable detail: what gets built, why, what "done" means, what it depends on.

**Companion to `HANDOFF.md`**, which stays the live state doc. This is the plan; that is the status.

> **Note on authorship:** this was written by the same model that built the engine, not an independent planner. Sections 1 and 8 exist specifically to attack prior decisions rather than defend them. Two of them did not survive.

---

## 1. Pressure-tests — read this first, it changes the plan

### 1.1 The phase gates ❌ two of three are not usable as written

| Gate | Problem | Replacement |
|---|---|---|
| Ph2: *"people return unprompted"* | Not measurable. No number, no window. | **≥30% of users who complete a check return within 14 days**, measured on a rolling 50-user cohort |
| Ph3: *"10 paying users still paying in month two"* | Takes a **minimum of two months** to evaluate. That blocks Phase 4 on a calendar, not on evidence. | **Split it.** Ship gate: 10 payers AND ≥3% conversion of active users. Month-2 retention becomes a *confirming metric*, not a blocker. |
| Ph4: *"mobile retention beats web retention"* | Apples to oranges — different acquisition, different intent. Mobile could lose on this and still be right. | **Mobile does a job web can't:** ≥25% of mobile checks happen *away from home* (standing in front of the item). That's the actual thesis. |

**And a gate that's missing entirely: unit economics.** Every current gate could pass while losing money per user. Add to Phase 3: **blended cost per check ≤ $0.03 and gross margin ≥ 70%.**

### 1.2 The Facebook 0.85 ratio ❌ wrong as a flat number

A single ratio cannot be right, because the direction flips by shippability:

- **Small shippable** (phone, GPU): eBay's national pool genuinely gets more gross. Local is realistically **0.70–0.80**.
- **Bulky** (desktop, iMac, monitor): eBay is barely an option — shipping a tower is $60+ and damage risk is real. eBay's price *already embeds* that hassle, so local is **0.95–1.05**. Possibly above 1.0.
- **Hot current-gen**: strong local demand, ratio rises.
- **Niche**: thin local pool, ratio falls.

**Fix, in order of ambition:**
1. **Now:** per-category ratios instead of one constant, each tagged as an assumption.
2. **Now:** widen the verdict's confidence band when the Facebook path is the deciding channel. The uncertainty is real and should be visible.
3. **Later:** for local-only categories, stop deriving from eBay whole-unit comps at all — those are a bad proxy for a desktop PC. Use eBay *component* comps plus a local realization factor.
4. **Eventually:** replace with measured data from `outcomes`.

**This is the single most load-bearing guess in the system.** It sits inside every net-profit number, and net profit decides BUY vs FAIR.

### 1.3 The outcome loop as a moat ⚠️ real, but the claim needs reframing

Do the arithmetic. 50 users × ~2 purchases/month = **100 outcomes/month**, spread across hundreds of SKUs. That is approximately zero data per SKU. Per-SKU Facebook pricing needs thousands of users.

**But it becomes valuable far earlier at a coarser grain.** 100 outcomes is plenty to measure the **category-level Facebook-vs-eBay realization ratio** — which is exactly the §1.2 problem. And sell-through by category. Both are useful at n=100, not n=10,000.

**So:** the moat is real, but early it calibrates *ratios and velocity*, not individual prices. Don't promise SKU-level pricing from it in year one.

**The dependency that actually matters:** it only works if outcomes get recorded, and manual data entry retention is dismal. **The listing auto-draft is the collection mechanism** — if the app drafts the listing, the app knows the sale price without asking. That's why the two ship together and why neither works alone.

### 1.4 Ship the risk layer before valuation? ✅ **YES — this reverses my earlier position**

I previously said wait. That was wrong, for three reasons:

1. **The risk layer works today with zero comps.** Contradictions, payment rails, boot-screen-only, screenshot artifacts, listing age, seller sophistication, impossible specs — none of it needs a price.
2. **With a free/paid split where risk is free, "shipping risk alone" IS the free tier**, not a half-product. The concern was spending first impressions on something incomplete. But a free tool that says *"don't drive 45 minutes, this is a scam"* is complete at what it does.
3. **It builds the corpus the comps archive needs anyway.** Every user check is an ingested listing.

**This adds a new Phase 1.5 and accelerates everything.** It's the biggest single change this plan makes.

### 1.5 Pricing ⚠️ $19, not $14.99, and add two things

Field: flippr **$12.99** · Flipify **$5–10** · DealFlip **$14.99–49** · SuperFlip **$49** · Swoopa **$47–352**.

**Don't price at $12.99.** Undercutting flippr signals "cheaper flippr." Filtrsoft isn't cheaper-flippr, it's the one that admits uncertainty. Pricing below the incumbent contradicts the positioning.

**Don't price at $47.** Swoopa charges that for alert infrastructure at scale, which doesn't exist here yet.

Recommended:

| Tier | Price | Contents |
|---|---|---|
| **Free** | $0 | **Unlimited risk checks** + 5 full verdicts/mo |
| **Flipper** | **$19/mo** or **$149/yr** | Unlimited verdicts, history, saved economics, target offer price, buy mode |
| **Pro** | $39/mo *(only when alerts ship)* | Monitoring, batch, multi-market |

**Two additions worth having:**
- **Annual at $149** (~35% off). Flipping is seasonal; annual smooths churn through dead months.
- **Credit packs — $5 for 25 checks.** Captures the person buying *one* laptop who will never subscribe. That's the **buy-mode** user, a different segment from the flipper, and nobody in this market serves them.

---

## 2. Product design

### 2.1 Surfaces

| Surface | Purpose |
|---|---|
| **`/` — the tool** | One input: paste a listing URL. No signup, no marketing above it. Explainer sits *below* the fold. |
| **`/c/:id` — verdict page** | The core artifact. **Shareable permalink** — this is the growth loop. |
| **`/checks`** | History (auth) |
| **`/me`** | Economics profile — the thing that makes verdicts *yours* |
| **`/learn/*`** | The risk rules as public content. SEO, credibility, and the top of the content funnel. |

### 2.2 The verdict page, top to bottom

1. **Listing header** — photo strip, title, asking price, source, location, days on market
2. **The call** — large, colour-coded, with the one-sentence headline
3. **The number** — value range, net by channel, your floor. Or, when it can't price: *"Can't value this"* **plus the named deciding unknown.**
4. **Red flags** — each with its evidence and provenance (*which* photo, *which* phrase)
5. **What to ask the seller** — copy-pasteable, specific to this listing
6. **The comps** — every one linked out. **Show your work.** This is how trust is earned and it's the whole differentiator against black boxes.
7. **Target offer** — what to offer for this to clear your floor

**Two modes, toggled:** **Flip** (margin, sell-through, fees) and **Buy** (fair price, act-or-wait). Buy mode roughly doubles the addressable audience and **no competitor ships it.**

### 2.3 Free vs paid, and why the line sits there

- **Free, unlimited: risk analysis.** No price.
- **Free, 5/month: full verdict** with valuation.
- **Paid: unlimited** + history + economics + target offers + buy mode.

**The line is drawn on cost, not on generosity.** Risk is nearly free to compute (text rules + cached vision). Valuation costs comps. Price tracks cost, which makes the free tier sustainable at large numbers — and a genuinely useful free tier is what makes people share it.

---

## 3. Technical architecture

### 3.1 The latency problem — three fixes, all needed

**Current: ~30s.** Target: **useful in <0.5s, complete in <6s.**

**Fix 1 — Progressive streaming. Don't wait for the slowest stage.**

```
t+0.30s   listing parsed        → photos, title, price render
t+0.35s   cheap signals         → red flags appear (pure compute, no I/O)
t+0.50s   catalog + comps       → value range
t+3-6s    vision                → component facts fill in, verdict finalises
```

The page is **actionable in under half a second.** Vision landing at 5s is fine because nobody is staring at a spinner.

**Fix 2 — Delete the CLI overhead.** The 30s is mostly headless Claude Code startup plus *sequential* per-photo Read calls. Replace with the Anthropic SDK: **all photos in ONE multi-image request**, downscaled to 768px longest edge, Haiku. Expect **3–6s**. That is a 5–10× win and the single highest-leverage change in this document.

**Fix 3 — Cache by phash.** Photo already seen → reuse its vision result. Listing already checked → instant. Popular listings get checked repeatedly by different users, so hit rates should be meaningful.

### 3.2 Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite** | No SSR needed. Keeps the API boundary honest for the mobile rewrite. |
| Backend | **Bun + Hono** | Same runtime and language as the engine. Zero context switching. |
| Database | **Postgres (Neon)** | Migrate from SQLite here. Multi-instance needs shared state. |
| Jobs | **Inngest** | Comps ingestion is a pipeline. Don't run your own Redis solo. |
| Hosting | **Railway** (API) + **Cloudflare Pages** (static) | Cheap, simple, adequate |
| Auth | **better-auth**, magic link + Google | Do not hand-roll |
| Payments | **Stripe** | RevenueCat added at Phase 4 for mobile |

### 3.3 The API boundary — the most important structural decision

**Everything goes through a versioned HTTP API that mobile will later use unchanged.** No logic in the view layer. This is what makes Phase 4 a *UI rewrite* rather than a rebuild.

```
POST   /v1/checks              {url}         → {checkId}
GET    /v1/checks/:id                        → full verdict
GET    /v1/checks/:id/stream                 → SSE, one event per stage
GET    /v1/checks                            → history (auth)
GET    /v1/me/economics                      → the personalisation
PUT    /v1/me/economics
POST   /v1/outcomes                          → the moat (Phase 5)
```

### 3.4 Unit economics per check

| | |
|---|---|
| Vision — Haiku, 6 images @768px (~1.1k tok each) + text | ~6.6k in / 0.8k out ≈ **$0.011** |
| With ~20% phash cache hit | **≈ $0.009** |
| Comps | amortised ingestion, ~0 marginal |
| **Total** | **≈ $0.01/check** |

- **$19/mo power user @ 300 checks** = $3 cost → **84% gross margin**
- **Free user @ 5 verdicts** = **$0.05/month** → thousands of free users are affordable
- Risk-only checks (no valuation) are cheaper still

---

## 4. Go-to-market

**The asymmetry to exploit: the content and the product are the same artifact.** This was the deciding reason Filtrsoft beat every other idea considered, and the plan should lean on it hard.

### 4.1 Channels, ranked

1. **Short-form video (TikTok / Shorts / Reels).** Every scam teardown is a video. The Brockton iPhone alone — the Messages viewer chrome, the SAVE icon, the year-old lock screen — is a 45-second post. **There are already 69 analysed listings sitting in the repo.**
2. **Direct DM to active flippers.** Lowest scale, highest conversion. **Do this first**, before anything scalable.
3. **Facebook flipping groups.** Enormous and far less promo-hostile than Reddit.
4. **r/Flipping and adjacent.** Reddit punishes self-promotion — lead with the teardown, tool incidental.

### 4.2 The content thesis

**Scam teardowns are the hook; deal finds are the payoff.** Scam content gets *watched* (outrage, fear of being had). Deal content gets *saved* (utility). Post both, in roughly 2:1 favour of teardowns early.

### 4.3 The growth loop

**Verdict pages are shareable permalinks.** "Look what Filtrsoft said about this listing" is a natural post inside a flipping group. **Every shared verdict is an ad that a user wrote.** This is why the verdict page gets design attention disproportionate to its size.

### 4.4 Launch sequence

| When | What |
|---|---|
| **Now, pre-product** | Start posting. Build audience before the tool exists. |
| **v0 ships (risk-only)** | Free, no signup. Post teardowns with the tool visible in frame. |
| **First 50** | Direct DM + one strong video + one Reddit teardown post |
| **Paid** | Only once valuation is trustworthy |

---

## 5. Sequencing

### 🆕 Phase 1.5 — Ship the risk layer *(unblocked, start now)*

Web app, **risk analysis only, no valuation.** Free, no signup.

**Build:** Hono API · `/v1/checks` + SSE · React frontend · verdict page (risk sections only) · shareable permalinks · deploy to filtrsoft.com

**Done when:** a stranger can paste a Craigslist or Facebook URL and get red flags, evidence and questions in under a second, on a URL they can share.

**Gate:** 50 people have used it, **≥30% return within 14 days.**

**Kill signal:** people use it once and never come back — the risk layer isn't valuable enough alone, so fold it back into a valuation-first product.

### Phase 2 — Valuation *(needs eBay keys)*
Add the number. Free 5/month. Vision moves to the API. Postgres migration.
**Gate:** engine matches Yish's audit on money calls; **zero scam-labelled-as-deal** (absolute).

### Phase 3 — Money
Stripe, tiers, credit packs.
**Gate:** 10 payers, ≥3% conversion of actives, **cost/check ≤ $0.03, margin ≥ 70%.**

### Phase 4 — Mobile
React Native + Expo, Play Store first, iOS via EAS.
**Gate:** ≥25% of mobile checks happen away from home.

### Phase 5 — Sell side + outcome loop
Listing auto-draft (eBay Sell API = one click; Facebook = draft + paste). Outcomes recorded automatically.
**Gate:** measured Facebook realization ratios replace the guesses in §1.2.

### Phase 6 — Alerts
Last, deliberately. Earn the right by having verdict quality nobody else has.

### Parallel tracks
- **Content/audience** — runs alongside everything, starting today
- **Comps ingestion** — runs alongside the Phase 1.5 build the moment keys land

---

## 6. Engine improvements

Not a rewrite. These are gaps found by auditing the running code on 2026-08-23.

| # | Gap | Fix | Priority |
|---|---|---|---|
| 1 | **10 of 62 SKUs have any comps** | Make the catalog **comp-driven** — ingest comps first, derive SKUs from what actually sells, instead of hand-seeding a list and hoping comps match it | **P0** |
| 2 | **Every comp is condition `used`** — no condition adjustment exists at all | Normalise eBay condition IDs → `new/open_box/refurb/used/parts`, apply multipliers per category | **P0** |
| 3 | **Sell-through not implemented** despite being in the schema and cited as a hard filter | Compute active-vs-sold ratio and median days-to-sell from eBay | **P1** |
| 4 | **`learnAlias()` is defined but never called** — the catalog never actually learns | Call it on every confirmed resolution | **P1** |
| 5 | **`clusterSize` is accepted but never passed** — cluster detection is dead code | Group by `seller_ref` at ingest, pass the count | **P1** |
| 6 | **Sum-of-parts prices only CPU and GPU** | Add RAM, storage, motherboard, PSU, case | **P1** |
| 7 | **No vision cache by phash** — re-checking a listing re-pays for vision | Key vision results on photo hash | **P0** (cost) |
| 8 | Regional adjustment not implemented | Defer until outcomes data exists | P2 |

**P0s are prerequisites for Phase 2** — valuation can't be trusted without 1, 2 and 7.

---

## 7. Decisions needed before Opus starts

| # | Decision | Why it matters | Default if you don't answer |
|---|---|---|---|
| **1** | **Is this for other people, or mainly for you?** Everything so far is calibrated to *you* — your floor, your dead categories, your Newton drive times. Multi-user changes onboarding, defaults, and how much personalisation is required before the first verdict. | Largest single fork in this plan | **Multi-user.** Sensible defaults, personalisation optional and prompted after the first check. |
| **2** | **Monthly budget for paid data before revenue?** SoldComps starts ~$9/mo; volume pricing unknown. Keepa is €49/mo. | Determines comp depth, which determines verdict quality | **$50/mo ceiling** until first revenue |
| **3** | **Will you actually be on camera?** The GTM leans heavily on short-form video. Faceless works but converts worse. | Changes the whole channel plan if no | **Yes**, given the stated goal of building a following |
| **4** | **Hard deadline?** Senior year, AP exams May 2026. | Changes how much gets cut | **No deadline**, ship when gates open |
| **5** | **Accounts in v0?** | Anonymous-first is lower friction but loses history and attribution | **Anonymous first**, signup prompted at the 3rd check |

---

## 8. What I'd challenge in my own plan

Written by the same model that built the engine. The most likely blind spots:

- **The risk layer may be less valuable standalone than §1.4 argues.** Flippers may simply want a number, and "here are 4 red flags" without a price may not be worth returning for. **Phase 1.5's gate is designed to find this out cheaply**, which is the point — but if it fails, the whole free-tier structure in §1.5 has to be reconsidered.
- **$19 could be wrong in either direction.** It's reasoned from positioning, not from anyone paying anything. Test with a real price on a real page before treating it as settled.
- **The content plan assumes flipping content converts to tool signups.** It reliably gets *views*. View-to-signup for a utility like this is unproven and could be brutal.
- **Vision at 3–6s is an estimate, not a measurement.** Benchmark it before designing the UI around it.
- **The 69-listing eval set is small and all Boston Craigslist.** It cannot detect Facebook-specific failure modes, and Facebook is where the actual users are.
