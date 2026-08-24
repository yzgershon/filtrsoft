# Assyze Ecosystem and Expansion Map

**Date:** 2026-08-24  
**Purpose:** A product opportunity map for Claude and Yish. This is intentionally separate from the technical audit so good ideas do not blur the launch blockers.

## The strongest version of Assyze

Assyze should not become another broad classifieds site. Its strongest position is:

> **The trust and decision layer for buying used technology locally.**

Marketplaces help a buyer find listings. Assyze should help the buyer answer the harder questions:

- Is this the exact model the seller claims?
- Is anything important hidden, locked, damaged, fake, or missing?
- What evidence is still needed before meeting?
- Is the asking price actually good after travel, repair, resale friction, and risk?
- What should I ask the seller, test in person, offer, and walk away from?

That position lets Assyze work across Craigslist, Facebook Marketplace, OfferUp, eBay, local stores, university surplus, repair shops, and direct seller submissions without needing to own every listing.

## AI leverage boundary

AI can likely handle **80-90%** of collection, OCR, field extraction, catalog matching assistance, photo triage, question generation, explanation, and internal quality review. It should not silently decide the last 10-20% when only a human test can prove activation status, serial/IMEI cleanliness, account removal, battery health, liquid damage, or whether the device works under load.

The product advantage comes from making that boundary visible. “AI could not prove this; run this exact test” is more trustworthy than a confident-looking score.

## Product system

```text
                    ASSYZE TRUST GRAPH
                           |
        +------------------+------------------+
        |                  |                  |
   Assyze Check       Assyze Feed       Assyze Passport
   one listing        verified deals    shareable evidence
        |                  |                  |
        +---------+--------+--------+---------+
                  |                 |
            Assyze Seller      Assyze Pro
            better listings    reseller workspace
                  |                 |
                  +--------+--------+
                           |
                    Assyze Data/API
             normalized models, evidence,
              prices, lifecycle, outcomes
```

Each surface should strengthen the same data asset instead of creating a separate product with separate truth.

## Recommended product families

### 1. Assyze Check

The current link checker is the best wedge because it gives value before Assyze has its own complete feed.

**Core result**

- Exact model and variant, with evidence source.
- Current call: `BUY`, `FAIR`, `VERIFY`, `RISK`, `PASS`, or `INSUFFICIENT`.
- Unresolved blockers that cap the call.
- Price range and dated comp provenance.
- Seller questions ranked by what could change the decision.
- In-person test plan by device category.
- Suggested offer range only when the evidence is strong enough.
- “What would change this verdict?” section.

**High-leverage additions**

- Browser extension and mobile share sheet: “Check with Assyze” from any marketplace page.
- Paste screenshots when a marketplace blocks direct fetching.
- Photo-change detection so an edited listing automatically invalidates old evidence.
- Evidence crops: tap a field to see the photo region or sentence that supports it.
- Side-by-side source conflicts: title says 1 TB, spec screen says 512 GB.
- Private notes and a meeting checklist.
- A lightweight “check without vision” mode plus paid/limited deep check.

### 2. Assyze Feed

The feed should be a consequence of verified checks, not a raw scrape with a score added.

**Feed rules**

- Only show listings that meet a published eligibility threshold.
- Separate `Verified deals`, `Needs one answer`, and `Recently checked` instead of mixing weak calls under one promise.
- Show last-observed time and confidence decay.
- Remove or clearly mark delisted and stale inventory.
- Personalize by radius, travel time, category, budget, risk tolerance, repair skill, and resale intent.
- Let users filter by unresolved blocker, not only category and price.

**Feature opportunities**

- Watchlists and instant alerts after quality is reliable.
- “New evidence changed the verdict” notifications.
- Map/radius view with travel-cost-aware net value.
- Deal comparison tray: compare two or three listings on evidence, not specs alone.
- “Best verified deal under $500 within 25 minutes.”
- Price-drop and seller-edit timelines.
- Local demand/competition indicator for resellers.

### 3. Assyze Passport

A Passport is a versioned, shareable evidence record for one physical device or listing.

**What it contains**

- Model/variant and how it was identified.
- Condition photos and timestamp.
- Completed lock/account/health checks.
- Known defects and unresolved questions.
- Repair/service receipts when supplied.
- Battery/cycle/diagnostic snapshots.
- Price evidence and Assyze result version.
- A QR/share link with public and private fields separated.

**Why it matters**

- Buyers can verify what a seller claims.
- Good sellers can prove a device is cleaner than competing listings.
- Outcomes create labeled data for Assyze.
- The result becomes shareable, which creates organic distribution.
- The Passport can travel with the device through resale without pretending prior checks are still current.

Avoid calling it a guarantee. It is an evidence record with dates, sources, and clear limits.

### 4. Assyze Seller

Seller tools create permitted first-party supply and better evidence.

**Features**

- Guided photo capture that asks for the exact angles/screens buyers need.
- Automatic model/variant extraction.
- Listing completeness and trust score.
- Suggested honest description built only from seller-approved facts.
- Missing-evidence checklist before publishing.
- Price range with confidence and source window.
- Passport/QR generation.
- Buyer-question inbox organized by unresolved evidence.
- Optional distribution links to external marketplaces where allowed.

This can reduce dependence on centralized marketplace crawling: sellers submit structured inventory because verification helps them sell.

### 5. Assyze Pro

For flippers, repair shops, refurbishers, and power buyers.

**Workspace features**

- Deal pipeline: found, contacted, meeting, bought, repairing, listed, sold.
- Actual acquisition, repair, travel, fees, time, and sale outcome.
- Inventory and cash tied up.
- Category-specific inspection forms.
- Batch link/screenshot checks.
- Team assignments and notes.
- Margin prediction that learns from the operator's actual outcomes.
- Source/channel performance by profit, not listing count.
- Receipt and serial storage with privacy controls.
- Export/API for bookkeeping and inventory systems.

Assyze Pro can monetize before a consumer marketplace reaches scale because it saves measurable time and prevents bad buys.

### 6. Assyze Data/API

This is a later product, but the schema should make it possible now.

**Potential data products**

- Model/variant normalization API.
- Listing completeness and contradiction API.
- Risk-question generator by category.
- Local asking-price and lifecycle indices.
- Evidence-backed valuation endpoint.
- Device Passport verification API.
- Market heat, time-to-delist, and price-drop data for local shops.

Do not sell raw scraped marketplace data unless the collection and licensing basis clearly permits it. The defensible asset is normalized first-party evidence and outcomes.

## Feature backlog ranked by leverage

| Idea | User value | Data/moat value | Complexity | Recommended stage |
|---|---:|---:|---:|---|
| Evidence-complete result + unresolved blockers | Very high | High | Medium | Now |
| Browser extension/share sheet | Very high | High | Medium | Next after safe API |
| Seller question generator with answer capture | High | Very high | Low-medium | Now |
| In-person test checklist | High | High | Low | Now |
| User-confirmed buy/pass/sale outcome | High | Very high | Medium | Now |
| Photo/content change invalidation | High | High | Medium | Now |
| Saved searches and verified alerts | High | Medium | Medium | After feed quality |
| Assyze Passport | High | Very high | Medium-high | Next |
| Guided seller photo capture | High | Very high | Medium | Next |
| Reseller deal/inventory workspace | High | Very high | High | Next |
| Map and travel-cost ranking | Medium-high | Medium | Medium | After feed quality |
| Local price/lifecycle index | Medium | Very high | High | After real outcomes |
| Shop/refurbisher inventory partnerships | High | Very high | Medium | Next |
| Public data/API | Medium-high | High | High | Later |
| Native mobile app | Medium | Low by itself | High | Later |
| Payments/escrow | Unclear | Low initially | Very high | Do not build yet |

## The data moat to build

Raw listings are copyable and unstable. The defensible data is the relationship between evidence and outcomes.

### Evidence graph

For each device/listing, capture:

- Normalized SKU and variant.
- Exact supporting source: title, description, photo region, diagnostic screen, seller answer, receipt, or user test.
- Conflicts between sources.
- Required checks and their state.
- Listing observations over time.
- Photo/content fingerprints and changes.
- Assyze model/rule/prompt versions.
- Final user action and eventual outcome.

### Outcome loop

Ask users small, well-timed questions:

1. Did the seller answer?
2. What did they say or show?
3. Did you meet?
4. Which tests passed or failed?
5. Did you buy it, and at what price?
6. What repair cost appeared later?
7. If resold, when and for how much?

Each answer should say why it helps the user, allow “skip,” and separate confirmed facts from inference. This loop can eventually outperform generic national comp data for local decisions.

### Trust calibration

Track not only whether the predicted price was close, but:

- False `BUY` rate.
- Blocker miss rate.
- Percentage of questions that change the verdict.
- Identity accuracy by category and evidence type.
- Calibration: whether “80% confidence” is right about 80% of the time.
- Expected versus actual repair/travel/fee cost.
- User regret and prevented-bad-buy reports.

The safest KPI is not the number of deals shown. It is the percentage of strong calls that remain correct after the buyer inspects the item.

## Source strategy

Assyze should be source-agnostic at the product layer and strict at the access layer.

### Better source mix

- **User-supplied listing links/screenshots:** fastest lawful wedge and works across closed marketplaces.
- **Seller submissions:** first-party, structured, and naturally supports Passport.
- **Local refurbishers/repair shops:** inventory feeds plus trusted inspection data.
- **University, municipal, school, and business surplus:** often structured and locally relevant.
- **Estate/auction partners:** high-value local inventory if data access is permitted.
- **Retail open-box/trade-in inventory:** predictable fields and partnership potential.
- **eBay active inventory:** useful for catalog and asking-market context through the Browse API.
- **Licensed sold-data provider:** required if national sold comps remain central.
- **User-confirmed outcomes:** slow at first, but the most aligned long-term asset.

### Access registry

Create one table/document for every source:

| Field | Meaning |
|---|---|
| Source owner | Who owns/operates the data source |
| Access basis | API terms, written permission, user-directed action, partner feed, or license |
| Allowed use | Display, analysis, retention, derivative values, resale |
| Rate limits | Technical and contractual limits |
| Retention | How long raw pages/photos/payloads may be kept |
| Attribution | Required source links/branding |
| Shutdown plan | What Assyze does if access ends |

No new source adapter should launch without this record.

## AI and computer-vision opportunities

### Near-term

- OCR first, vision reasoning second. Use deterministic OCR/device parsers before paying a general model.
- Route only uncertain/high-value photos to Anthropic.
- Ask the model to cite exact image index and region for each field.
- Compare title, description, and photos instead of merging conflicts away.
- Detect screenshots, stock photos, duplicate images, missing angles, cracks, port damage, boot errors, and diagnostic screens.
- Version prompts and evaluate them against a frozen image set.
- Show the user when AI confidence is low or evidence is unreadable.

### Later

- Active photo capture: camera overlays guide the user to serial-free proof screens, ports, hinges, lens glass, and chassis corners.
- Model disagreement for high-risk cases: cheap model first, stronger second opinion only when needed.
- Automated inspection session that listens for fan noise, sees display defects, and records benchmark/health outputs.
- Repair estimate ranges linked to visible defects and local shop pricing.
- Fraud-network signals from repeated photos/content while minimizing storage of personal seller identity.

Never treat photo-only inference as proof of account unlock, stolen status, finance status, or an internal defect that requires a device test.

## Growth loops

### Buyer loop

```text
check listing -> get questions -> seller provides evidence
      -> improved result -> share Passport -> another buyer checks
```

### Outcome loop

```text
result -> meeting checklist -> buy/pass outcome
      -> better calibration -> stronger future results
```

### Seller loop

```text
guided evidence -> trusted Passport -> faster/cleaner sale
      -> more sellers submit -> better verified inventory
```

### Local-partner loop

```text
shop inventory/inspection -> Assyze qualified demand
      -> measured conversions -> more partner inventory
```

These loops produce first-party evidence. A generic content feed does not.

## Monetization paths

Monetization should match where Assyze creates measurable value and where variable AI cost occurs.

### Consumer

- Free limited text checks.
- A monthly allowance of deep photo checks.
- Paid check credits for occasional buyers.
- Premium watchlists/instant verified alerts.
- Optional Passport creation for sellers.

### Pro

- Monthly reseller workspace.
- Team/shop plan.
- Batch checks and higher alert limits.
- Inventory/outcome analytics.
- API or export access.

### Partners

- Qualified-lead or SaaS fee from refurbishers/repair shops, with clear labeling.
- White-label inspection/Passport tooling.
- Data/API contracts based on permitted first-party/partner data.

Avoid building a business model that requires hiding sponsored ranking or pushing a questionable listing because it pays an affiliate fee. Trust is the product.

## Small features with outsized value

- “Copy these three questions” button.
- Seller-answer paste box that reruns only the affected rules.
- “Ask for this photo” examples by category.
- Meeting-mode checklist with large tap targets and offline availability.
- One-tap `Bought`, `Passed`, `Seller stopped replying`, and `Listing disappeared` outcomes.
- Price/description/photo-change badges.
- Confidence decay when a check is old.
- “Why not BUY?” explanation.
- “Cheapest missing proof” ordering: ask for the fastest evidence first.
- Evidence freshness timestamps.
- Private serial/IMEI redaction before upload.
- Result export as a compact share card.
- “Report wrong model/value/risk” feedback tied to the exact engine version.
- A local-time meeting safety reminder and public-place checklist.

## Decisions to make early

### 1. Who is the first customer?

The likely options are:

- Local consumer buying one device.
- Student/parent buying affordable electronics.
- Part-time flipper.
- Professional reseller/repair shop.

The current pipeline most naturally serves a careful flipper or informed consumer. Trying to serve all four immediately will weaken the evidence flow and copy.

### 2. What does “verified” mean?

Write a strict definition before using the word in public. It should specify identity confidence, evidence age, blocker status, comp quality, and what still requires an in-person test.

### 3. What is Assyze responsible for?

Decide whether it is:

- A research tool.
- A risk/valuation opinion.
- A seller evidence record.
- A marketplace participant.
- A transaction intermediary.

Moving toward payments, warranties, inspections, or guarantees changes operational and legal responsibility. Do not drift into those accidentally.

### 4. What is the canonical data asset?

Choose whether the long-term center is the listing, physical device, SKU, Passport, or transaction. The strongest answer is likely the physical device/Passport linked to listings and observations, because listings disappear but devices and outcomes continue.

## What not to build yet

- A generic all-category marketplace.
- Centralized scraping of closed platforms as the only supply strategy.
- Payments, escrow, shipping, insurance, or warranties.
- A native app before the web/share workflow proves repeat use.
- Alerts before feed eligibility and stale-listing handling are reliable.
- A public “Assyze Score” that compresses unresolved blockers into one number.
- Social profiles, comments, likes, or a content feed.
- A conversational AI wrapper that cannot show evidence.
- Broad geographic expansion before one local market has labeled outcomes.
- Seller auto-posting before source/platform rules and seller approval are explicit.

## Phase-gated roadmap

This avoids false calendar promises. Each phase unlocks only after its evidence gate passes.

### Phase A: Trustworthy private checker

Ship when:

- Paid work is protected and bounded.
- Category blockers cap verdicts correctly.
- Result evidence survives streaming, persistence, and sharing.
- Real comp provenance is separated from provisional data.
- A labeled test set catches regressions.

Then add:

- Seller-question workflow.
- In-person checklist.
- Outcome capture.
- Screenshot input.

### Phase B: Controlled Newton-area feed

Ship when:

- Every source has a permitted access basis.
- The crawler/import pipeline is recoverable and freshness-aware.
- Feed eligibility excludes stale, delisted, and weak results.
- Backups and observability are proven.
- At least one category has enough real evidence to calibrate calls.

Then add:

- Watchlists.
- Radius/travel personalization.
- Change notifications.
- Partner inventories.

### Phase C: Passport and seller supply

Ship when:

- Public/private evidence fields and retention are defined.
- Seller-submitted evidence can be verified and versioned.
- Buyers understand what the Passport does and does not prove.

Then add:

- Guided seller capture.
- QR/share pages.
- Repair-shop/refurbisher workflows.
- First-party verified inventory.

### Phase D: Pro and data products

Ship when:

- Real acquisition/repair/sale outcomes exist.
- Unit economics and model cost are measured.
- The result quality is calibrated by category.
- Data rights allow the intended commercial use.

Then add:

- Reseller pipeline and inventory.
- Team/shop accounts.
- Analytics and exports.
- Carefully scoped API products.

## Best first experiments

These are decision tests, not large builds:

1. Have five local buyers run real listings through the checker and record which question changed their decision.
2. Have one flipper use the meeting checklist and outcome log for ten deals.
3. Test whether sellers will upload the missing three photos in exchange for a shareable Passport.
4. Compare a text-only check with a selective-vision check to measure how often vision changes the call and what it costs.
5. Ask a local repair/refurbisher shop whether structured verified inventory or buyer qualification is more valuable.
6. Measure whether users return for another check without alerts. If not, learn why before building a native app.

## Recommended north-star metrics

Use a small set that rewards truth:

- **Decision-changing checks:** percent of completed checks that cause a useful action: ask, verify, offer, buy, or pass.
- **Strong-call survival:** percent of `BUY`/`FAIR` calls still judged correct after inspection/outcome.
- **Prevented bad buys:** confirmed cases where a blocker/question caught a real problem.
- **Evidence completion rate:** percent of unresolved checks that receive usable evidence.
- **Cost per useful decision:** source + compute + vision cost divided by decision-changing checks.
- **Outcome capture rate:** completed checks that later receive buy/pass and price/repair feedback.

Page views, raw listings crawled, and total checks are supporting metrics, not the product truth.

## Final product recommendation

Build Assyze outward from **Check -> Evidence -> Outcome -> Passport -> Feed**, not from **Scrape -> Rank -> Scale**.

The first path compounds trust and first-party data. The second creates a fragile aggregation business that is easy to copy and dependent on platforms Assyze does not control.

