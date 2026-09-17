# Listing evidence, availability and delivery repair

## What production showed

At 13:54-14:01 UTC, Yish's signed-in feed had 2,159 can't-tells, 6 Buy it,
22 Verify, 54 Fair, 318 Pass and 99 Risk. One Buy it was his manual override.
The desktop was collecting and uploading on a 30-minute cycle. Scoring was
complete with zero failures. Only 151 of 839 arrivals in the last day had any
description. Push was configured, but its last accepted delivery was September 9.

Those observations distinguish insufficient input from a stopped scoring queue.

## Implemented

- Balance discovery and enrichment: 18 search cards versus up to 20 detail reads
  per source; missing text qualifies even with good photos. Persist individual
  retry schedules, prioritize recommendations, and avoid repeatedly selecting the
  same unreachable item. Production sends bounded repair work to updated PCs,
  covering listings absent from a replacement collector's database.
- Read deeper Mercari pages, preserve marketplace condition fields, exclude
  recommendations from availability evidence, and require the exact item URL.
  Sold badges retire recoverably; challenges/timeouts remain unknown. Recheck
  recommended Craigslist listings independently every 30 minutes.
- Synchronize seller details, search sightings, availability and retry state on
  separate observation clocks. An old description cannot erase a newer defect
  disclosure merely because its collector saw a newer search card.
- Treat explicit non-working/parts disclosures as risk. Untested items cannot
  receive Buy it. Search-card-only browser listings cannot be recommended before
  reading seller conditions. Optional crypto payment behavior is unchanged.
- Keep desktop and laptop identities separate, distinguish VRAM from system RAM,
  recognize explicit Radeon and Ryzen shorthand, preserve MacBook silicon tiers,
  and distinguish Windows Pro from a hardware variant. Explicit desktop RAM
  remains RAM. Legion Go and ROG Ally stay outside the chosen market.
- Revalidate old imported comps. Reject unrelated product families, replacement
  components, laptop configuration mismatches and suffix collisions. Keep all
  quantity, capacity, memory layout, board-tier and whole-machine guards.
- Collect missing laptop configurations with specific CPU/GPU search text and
  increase bounded free comp maintenance from one SKU every four hours to three
  per hour, interruptible for discovery. No archive replacement or paid provider.
- Run notification matching independently of Craigslist. Gate alerts on recent
  seller evidence and availability, reconcile existing push subscriptions on
  sign-in/return, and expose account-scoped delivery status without endpoint keys.
- Show checked, unconfirmed and unchecked availability in cards, the featured
  listing and details. Stop treating Facebook MP4 URLs as photos. Settings no
  longer promises an unmeasured number of deals per week.

## Evidence and limits

The live RX 7900 XTX (#8154) was Buy it despite its stored untested disclosure.
Its later source page also said for parts and showed a changed ask. The repaired
engine handles both disclosures; the new source text/price still requires an
actual collector upload. The Legion T5 desktop (#5299) borrowed a laptop SKU and
unrelated laptop comps, including a NIMO device. Exact regressions cover these
failures with known inputs and matching/nonmatching sold observations.

Full Windows and Linux runs passed 379 tests with 1,247 assertions. The final
MacBook purchase-year regression passed in the final Linux full run and targeted
Windows run. Typecheck, Vite and production-image builds passed. Built UI was
checked with a disposable local account in dark/light settings and at 390 CSS
pixels in details; no physical-phone behavior is inferred from that preview.

`docs/qa/actionability/isolated-comparison.json` compares both engines on separate
fresh copies of one consistent snapshot, scoring 5,212 rows without exceptions.
It includes both repaired calls and newly withheld unsupported valuations. It
does not measure production or the effect of the new collector's future reads.

Server deployment must precede the desktop update described in
`docs/COLLECTOR-UPDATE-2026-09-17.md`. Preserve the desktop's divergent local
setup commits, database and browser profiles. Do not restart laptop collection.
Useful phone notification delivery and a falling live missing-evidence backlog
must be observed after real collection, not inferred from passing tests.

Production still has about 97.6 MB physical free space. Existing reusable SQLite
pages make that different from having no room for any new row, but verified
production backup/physical compaction remains unresolved. No billing or volume
changes, destructive data cleanup, paid vision run or seller messaging occurred.
