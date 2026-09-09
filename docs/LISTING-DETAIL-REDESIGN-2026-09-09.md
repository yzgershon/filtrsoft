# Listing detail redesign, September 9, 2026

Yish asked for an organized, premium listing information screen. The report now groups information by what it helps him decide: the item, valuation, inspection and source evidence. The existing mobile feed, colors and full desktop app remain the design baseline.

## Implemented

- One listing card holds the full photo, visible previous/next controls, source, category, title, location, exact asking price and original-listing action. Photos remain uncropped. A no-photo state still has Back.
- One assessment card holds the call, reasoning, disclosed defects, missing details, exact matched identity and valuation. Estimated resale range, projected profit at asking and offer ceiling have a consistent numeric hierarchy. Local/eBay selection drives both summary and calculator.
- Native disclosure rows contain the resale breakdown, offer calculator, sold-price records and retail evidence. Seller wording and listing metadata have their own rows. No hidden text is discarded or replaced with invented specifications.
- Seller questions and pickup checks share an inspection group. All in-person checks are available, replacing the old two-check slice. High-severity negative signals stay visible; secondary observations expand on request. A missing fact is not presented as a disclosed defect.
- Inventory offers have separate quantity, price, price basis, valuation and exact-quote fields. Conditional quantity tiers remain conditional. Headline placeholders cannot populate the whole-listing profit calculator. All detail prices retain cents, including negative margins.
- Review remains a deliberate five-option popup with confirmed writes, error retry and the displayed decision token. The engine's original call is shown when a personal label is active. Outcomes remain on the feed after the trip.
- Fixed copy feedback that previously said success before a clipboard write completed. Fixed a legacy photo gradient dimming the new gallery controls. Duplicate image URLs now have distinct React keys.

No backend valuation, comp filter, database, crawl, shared checkout, archive, engine version, credential or notification setting changed. UI/UX Pro Max informed hierarchy, touch targets and progressive disclosure; its generic landing-page palette/layout suggestions were not substituted for Yish's chosen app style.

## Verification

| Check | Result |
| --- | --- |
| Existing Bun suite, Windows | 268 pass, 0 fail, 763 assertions |
| Pinned native Linux ARM container, network disabled | 268 pass, 0 fail, 763 assertions; TypeScript passed |
| TypeScript and Vite | Passed |
| Verification and production Docker images | Built successfully |
| Existing frontend redesign harness | 15 groups passed |
| Existing mobile interaction harness | 9 groups passed |
| Existing frontend workflow harness | 9 groups passed |
| Real installed service-worker harness | 6 groups passed |
| New detail harness | 9 groups passed, including 30 report/viewport combinations |

The new harness checks 360/390/430/768/1024/1440px widths, priced/unknown/risky/14-offer/long-text cases, exact decimal values, quantity tiers, selected-channel arithmetic, keyboard disclosures, exact seller text, gallery navigation and Back, photo retries, denied clipboard writes, failed reviews, retained decision tokens, landscape, larger text and reduced motion. No browser page errors. An initial test selected `Close` instead of the existing `Close photos` accessible name; the corrected test verifies its viewport bounds, hit target and actual dismissal.

Visual evidence is under `docs/qa/listing-report/`, including the new `decision-mobile.png`. Screenshots use synthetic data and existing repository photo fixtures. Full-page browser captures show fixed navigation at the original viewport position; this is a capture artifact, not another navigation bar in the document. These checks do not claim an authenticated production account session or physical handset verification.

Production asset names: `index-BOtPGx8i.js`, `index-6DxMC26D.css`. Native Linux emits the same names. Archive SHA-256 remains `0285af42b39f7d9105882ba52591d311823b6b8cf790aa871161862b1ea3e635`.

## Preview and release

Run `node src/browser/detail-preview.mjs`. Open `http://127.0.0.1:3197/c/101`; IDs 102, 103, 104 and 105 show unknown, risk, inventory and long-text scenarios. This server is entirely synthetic and imports no database/API engine code. It remains running for Yish's review.

Application commit `57f80c5932c33a2efb33a193e47d7f11f2ec56a6` is pushed to main. Railway deployment `6360954276` reports success. At `2026-09-09T22:59:15.885Z`, production HTML references the tested JavaScript and CSS, and both live asset hashes exactly match the local build. Service worker and manifest match; private feed and pulse return 401 without authentication. Health reports engine 0.3.34, database ok, 31,900 total / 28,791 usable comps and no pending/failed scoring. Full evidence: `docs/sessions/2026-09-09-listing-detail-release.json`. Native amd64 CI run `34414722201` succeeded, including tests, typecheck, Vite, both Docker builds and the network-disabled test container. The final release evidence and handoff are saved locally after deployment; no application work remains unpublished. Shared main and concurrent crawl work are preserved.
