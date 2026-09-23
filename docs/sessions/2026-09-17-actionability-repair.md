# Listing evidence, availability and delivery repair

## Verified release outcome, 19:10 UTC

Main **526de33 / engine 0.3.38** is live. Railway deployment **6509836189**
succeeded at 18:49:40 UTC; CI **35261133021** passed the full Linux suite,
typecheck, frontend build, verification image and production image. Local full
suite passed **385 tests / zero failures / 1,259 assertions**. The 19:09:41 UTC
public receipt matches all six built assets and the HTML entry, checks anonymous
access is denied on private feed/push-status routes, and reports zero pending or
failed scores. Production #7579 now has RISK and a quoted DAMAGED_DISPLAY blocker.

Final measured signed-in feed: **3 BUY, 12 VERIFY, 30 FAIR, 172 PASS, 147 RISK,
2,555 INSUFFICIENT_DATA**. One BUY is an existing manual override. Collection was
active throughout; these are live counts, not a controlled comparison. The
unknown backlog remains unresolved. Six formerly recommended Facebook/OfferUp
items were directly verified gone after the new collector cycle; some fresh
source-checked recommendations also appeared.

Still outstanding: confirmation of the desktop's final Mercari item-panel
follow-up, physical-phone registration/delivery (deferred by Yish), and durable
production backup/physical space recovery. Do not claim the $529 Mercari ask was
uploaded merely because a browser extraction read it correctly. The laptop
collector remains paused. Final verification documentation is kept in a local
commit after the live source release, ready for the next code push.

## Final live-data regression: disclosed screen damage

Fresh OfferUp #7579 said "fully operable - there is a crack on the screen" but
had no damage signal and retained a working-screen profit estimate. Engine
**0.3.38** adds a quoted DAMAGED_DISPLAY blocker, separate from NON_WORKING.
It excludes negated damage, screen protectors and explicit repairs and does not
invent a repair bill. A real-input end-to-end regression verifies RISK for this
listing. The engine bump schedules existing stored disclosures for review; this
server rule needs no new collector protocol.

## Completed desktop cycle and Mercari follow-up

OMEN job **43** completed at **18:32:55 UTC**, all three sources reporting ok,
with production scoring at zero pending / zero failures afterward. The directly
verified unavailable recommendations are Facebook **#4129, #5868, #4124, #4125**
and OfferUp **#7089, #7124**. OfferUp #7093 was confirmed available; #5569 remains
unconfirmed. New Mercari seller text moved #8154 to **RISK** with a NON_WORKING
blocker quoting "Does not power on". This is actual production evidence, not
only synthetic regression output.

The same read exposed one remaining collection defect: Mercari repeats the exact
item title on a breadcrumb line before its h1. The old text boundary missed the
real item price and controls, returning unknown availability and retaining $599
despite the source's $529 ItemPrice. The follow-up emits the actual h1 panel and
enabled controls, keeps recommendations separate, and declines ambiguous old
captures. Its regression failed before the correction and passes after it.
Real-page extraction confirmed the correct panel and $529.00 price; no source
facts were manually injected into production. **384 tests, zero failures, 1,258
assertions**, typecheck and Node syntax pass. The OMEN still needs this final
follow-up update before a new capture can correct its stored price.

## Final server release and desktop verification

Main commit **363a269**, engine **0.3.37**, is live on Railway deployment
**6509118135** (18:09:43 UTC). GitHub CI **35256928941** passed; the final
Windows suite passed **383 tests / zero failures / 1,251 assertions**. The
18:17:19 UTC public receipt matched the HTML entry and all six JS/CSS assets
to the tested build, with private feed and push-status routes returning 401
without a session. Measured warm production health took 469ms and an ordinary
API read took 305ms.

Production re-scoring reached **zero pending / zero failures** at 18:16 UTC.
The signed-in feed then reported **2 BUY, 17 VERIFY, 30 FAIR, 168 PASS, 134 RISK,
2,519 INSUFFICIENT_DATA**. One BUY is Yish's existing manual override. Ongoing
collection and withdrawn unsupported valuations make these unsuitable for a
controlled before/after claim. The can't-tell backlog has not been shown to fall.

The updated OMEN (`b8730555bb8a`, original node identity preserved) started
automatic collection job **43** at 18:20:50 UTC. Search/upload stages advance;
the laptop remains paused. New incoming facts create fresh scoring requests
after the completed release pass. A completed new-runtime detail cycle still
needs to be observed. Its retained maintenance schedule has the next comp
attempt at 20:43 UTC; the new hourly interval applies after that attempt.

The first Facebook stages subsequently completed and synchronized. Production
marks **#4129, #5868, #4124 and #4125** unavailable, with check times from
18:23:45 to 18:24:17 UTC. These four former VERIFY listings left the live feed
recoverably. The rolling-day count with seller descriptions rose **198 -> 210**
while discoveries rose **1,013 -> 1,044**, and scoring again reached zero pending
and zero failures. This verifies incoming evidence and availability effects;
it does not yet establish completion of OfferUp or Mercari.

Yish explicitly deferred phone registration until he has the device. His signed-in
account has no registered push device, no standing alert and nine paused legacy
searches. Physical phone delivery therefore remains unverified. The separate
production storage and verified-backup problem also remains open.

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

Follow-up verification found the server's cold health check synchronously
revalued all 561 snapshot SKUs in 11.84 seconds, exceeding Bun's default HTTP idle
timeout. Coverage now refreshes cooperatively, shares concurrent work and reports
unknown readiness while refreshing. A real localhost HTTP experiment returned
the app in 581ms and health in 679ms while catalog work continued for 15.21s.
Scoring also prioritizes current recommendations and yields between transactions
after a 250ms budget instead of monopolizing HTTP for a 50-row pass. Tests cover
queue completion, retry behavior, refresh sharing and mid-refresh corrections.

On production, #8154 changed BUY to VERIFY with an explicit UNTESTED signal and
#5299 lost its unrelated laptop valuation and now correctly reports 8GB system
RAM separately from 6GB VRAM. The Craigslist recommendation sweep checked 12
listings and retired one. At 18:06 UTC the OMEN reported new revision b8730555bb8a,
same node identity and no pending uploads; a new-revision cycle was not yet
observed. These observations do not establish an improved overall can't-tell
count or physical-phone notification delivery.

Release `da71588` reached production at 17:41:38 UTC (Railway deployment
6508647200). GitHub CI 35254202916 passed, and the 17:43 UTC public receipt
verified engine 0.3.37 and all six built JS/CSS assets byte-for-byte. Signed-in
production UI verification confirmed the availability labels and notification
controls. Re-scoring was still processing the historical backlog, without errors.
The follow-up queue fix prioritizes new evidence and live recommendations before
historical rows; it does not alter the evidence rules or engine version.

The account-scoped push endpoint revealed no device or standing alert for Yish's
signed-in account and nine paused legacy searches. The site-wide subscription
count from the initial audit was not proof of his account's registration. Yish
will register his phone later and has sent the OMEN update instructions to Codex
there. New desktop collector operation and physical-phone delivery remain to be
observed. Do not treat the server deployment as a desktop software update.

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
