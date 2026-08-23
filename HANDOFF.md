# HANDOFF — Assyze

**Update this before you stop working.** Keep it to CURRENT STATE and LIVE TRAPS. Permanent facts go in `README.md`, history goes in `docs/sessions/`, and shipped work goes in git.

Last updated **2026-08-22**.

## Current state

**PHASE 0 GATE IS OPEN as of 2026-08-23.** Results: `docs/testset/RESULTS-2026-08-23.md`.

35 Boston Craigslist listings screened, 9 deep-verified with photo analysis. Component ID from blurry side-panel photos worked on every listing where specs were visible. Lock-screen detection worked and dated a photo to the wrong year, exposing a scam. The engine correctly returned "insufficient data" on the one listing that genuinely could not be valued.

Facebook was inaccessible (login wall + extension not connected), so Craigslist was the proxy. **Not yet proven on Facebook.**

**Working capture pipeline, no browser extension needed:** WebFetch the listing page → extract `images.craigslist.org` URLs → swap the `_600x450` suffix for `_1200x900` → `curl` to `docs/testset/` → Read the local files. Test images are on disk and re-runnable as a regression suite.

**Still pre-build.** No repo, no code beyond the capture pipeline.

Research is complete and lives in `docs/research-2026-08-22.md`. The full origin story, including four rejected directions and why, is in `docs/sessions/2026-08-22-origin.md`.

Product is decided: **standalone mobile app** (React Native + Expo), consumer tech only, flipper-first with a buyer mode, no alerts in v1. Deep-links out to the source listing.

## The one thing gating everything

**The vision accuracy test has not been run.** 30 real listings across phones, laptops and GPUs: can the vision pass reliably pull the model and spot a lock screen from typical Marketplace photo quality? **Under roughly 70% and the product changes shape.** Do not write production code before this.

## Live traps

- **Do not AI-analyze every ingested listing.** At ~$0.0085/listing on Haiku, a million listings a month is $8,500. The funnel (hard filters → cheap classifier → vision → deep analysis on user tap) is load-bearing, not an optimization.
- **eBay's sold-comp window is 90 days and the free API is gone.** `findCompletedItems` was EOL'd Feb 2025; Marketplace Insights is closed to new applicants. **Store every comp you ever pull, starting with the first one.** The accumulated archive is the moat and every day not storing is history you never get back.
- **Never ask a user for Facebook credentials or a session token.** Security disaster, gets their account banned.
- **Meta v. Bright Data:** Meta lost and dropped it. Their ToS binds **logged-in** users; logged-out collection of public data was found not to violate it. Collection should run logged-out where possible.
- **Buy the collection layer, don't build it.** Apify or Bright Data behind an interface you own. Facebook randomizes CSS class names and runs behavioral anti-bot detection; that arms race is a permanent maintenance tax.
- **Every source is a swappable adapter behind one contract.** If Facebook dies you lose coverage, not the company.
- **Apple's 0% on external US payment links is a WINDOW, not a rate.** See payments section below.
- **Google charges 10% regardless of billing method.** External links do not avoid it.
- **Apple Developer Program and Stripe both need an adult or a registered entity.** This is on the critical path to shipping at all. Start it before writing code.

## Payments — verified 2026-08-22, and unstable

**Apple, US storefront only:** since May 2025 no entitlement is required and external links/buttons are allowed. Commission is currently **0%**. But the Ninth Circuit (Dec 2025) reversed the outright ban and sent the rate back to the lower court, the Supreme Court took the case on June 30 2026, and Apple has asked for **up to 15%**. Treat 0% as temporary. **Non-US storefronts still require IAP or an entitlement — the app must region-check or it fails review outside the US.**

**Google Play:** external payments allowed in US/UK/Europe since June 30 2026, but the new fee structure charges a **10% base service fee on the first $1M annual revenue regardless of billing method**, including external links. Google Play Billing adds a further 5%. So external billing saves 5%, not 30%. Reporting obligations began Oct 1 2026. Current order expires Nov 1 2027.

**Implication: do not model revenue on 0% fees.** Use RevenueCat, support both paths, assume 10–15% blended.

## Next actions

**Audit tool is built and loaded: `docs/testset/audit.html`** — open it in a browser. 15 deep-verified listings with full reasoning, 54 quick scores. Agree/Partly/Disagree per item, correct-verdict dropdown, notes box, autosaves to localStorage, exports JSON or Markdown. **Yish is auditing this next.**

Second Craigslist run (2026-08-23) added ~29 listings and produced four new risk signals (3k–3n), a **correction to the clustering rule (3e)**, and a new section on **the cost of false positives (10c)** — the model as written is probably too paranoid.

**Yish:**
1. eBay developer account → Browse API keys (free, 5k calls/day)
2. **Anthropic API key** at console.anthropic.com, load $20. His Claude Pro/Max subs do NOT include API access — separate product, separate billing.
3. Supabase project (free tier) for the comps archive
4. Private GitHub repo
5. **Audit `docs/testset/RESULTS-2026-08-23.md`** — disagreements with those verdicts are the most valuable input available
6. **Fill section 11 of `docs/RISK-MODEL.md`** — the gaps only he can write

**Then build, in this order:**
1. Comps ingestion + archive (the invariant — starts compounding immediately)
2. Catalog resolution (title → SKU, with an alias list that learns)
3. Cheap listing-signal layer (no vision needed, carried most of the weight in Phase 0)
4. Vision layer
5. Verdict assembly per `docs/VERDICT-SCHEMA.md`
6. Run against the 40 scored listings; compare to Yish's audit

**Do NOT buy yet:** hosting, Stripe, Play Console, Apple Developer, RevenueCat, or a paid sold-comps subscription. Confirm what eBay's free Browse API gives first. Total Phase 1 burn should be $20.
