# Recovering insufficient-data listings

Status: measured diagnosis and proposed next implementation, not a shipped change.

## September 17, 20:28-20:31 UTC baseline

The signed-in feed reports 2,549 INSUFFICIENT_DATA listings. The health endpoint
counts a broader population of all live stored listings, including rows outside
the feed window, and reports 2,962 first blocking reasons:

| Reported first blocker | Count |
| --- | ---: |
| Exact model or model | 1,117 |
| Storage, GPU, CPU or RAM | 1,243 |
| Seller description | 210 |
| Recent sold comps, matching builds or remaining component prices | 390 |
| Inventory item/quantity selection | 2 |

These are not mutually independent underlying causes. Resolving the first can
reveal a second. In particular, the no-comps branch in `src/verdict/index.ts`
uses `exact model` for some custom builds that intentionally have no whole-build
SKU. Do not claim every row in that group merely needs a model parser fix.

The rolling-day cohort contains 963 arrivals, all scored, but only 323 with a
description. Zero first-score requests are pending. Generic catalog coverage is
433/602 products; RAM's generic coverage is 0/13. Generic coverage does not prove
the exact configuration of a listing is priceable. The server's cloud-vision
loop reports its existing daily budget reached; no budget increase is proposed.
Server-side zero comp-attempt rows do not prove desktop comp collection is off,
because attempt telemetry and collected comps are different data flows.

## Priority implementation

1. **Schedule work from missing evidence.** Replace description-length eligibility
   as the primary repair signal. Both `dueDetails` and `repairTargets` exclude
   many non-actionable rows with 40+ characters even when decisive specs remain
   absent. Record all blockers and route each row to full seller-text capture,
   photo extraction, catalog resolution, exact comps, availability, or an explicit
   unresolved state. Never reread an unchanged empty description indefinitely.
2. **Give recovery its own collection budget.** Current per-source discovery caps
   are 18 cards versus 20 detail visits, before failed reads and recurring checks.
   Preserve a bounded fresh-deal lane while spending idle collector time clearing
   the backlog. Tune successful reads per new unique incomplete listing from real
   source timings, challenges and yield. Keep one owner per browser profile and
   do not run a duplicate laptop collector.
3. **Recover quoted specs from text and photos.** Audit a fixed representative
   cohort, repair deterministic parsing first, and use the existing local-vision
   evaluation harness for genuinely photo-only facts. Validate exact model names,
   capacities, memory layouts, ECC, conflicting images and unreadable labels before
   allowing a local model to write production facts. Preserve per-field provenance
   and reject guesses. GPU runtime/model installation still needs the standing
   software-install approval; do not assume it is installed on the OMEN.
4. **Collect evidence demanded by the backlog.** Extend the existing demand-based
   comp picker from generic catalog coverage to exact unresolved configurations.
   Separate missing catalog identity from missing sales and diagnose category/query
   mismatches, especially RAM and whole builds. Retain variant, capacity, kit,
   quantity, AIB and whole-machine guards. Sync accepted observations immediately
   and score the affected listings, recording rejection reasons and actual yield.
5. **Use bounded decisions only when justified.** Investigate whether a secondary
   unknown, such as storage capacity, actually changes the result. A finite set of
   supported compatible configurations may justify a PASS or cautious VERIFY when
   all defensible values agree. This requires a separately validated interval
   policy; never assume a missing GPU, create a price for an unknown part, or call
   a partial component sum a complete-machine value. Major identity/condition
   uncertainty continues to block BUY.
6. **Measure recovery on a fixed cohort.** Start with 250 live in-scope can’t-tells,
   recording every original blocker and available fact. Report newly priced rows,
   corrected risks, confirmed-unavailable retirements and unresolved rows
   separately. Retirements are not successful valuations. Track description
   coverage, exact identity, accepted comp yield, resolution per collector hour,
   false recommendations and newly actionable live listings. Audit errors before
   scaling. There is no measured recovery percentage or ETA yet.

Existing production storage/verified-backup recovery remains an operational
constraint. Reuse current rows, bound work and preserve histories; do not solve
the backlog with uncontrolled ingestion, a paid service, or destructive cleanup.

## Phone verification

Yish's account registered device 2 at 20:24:23 UTC. The push service accepted a
notification at 20:24:33 UTC. Account-scoped searches confirm an enabled standing
BUY/VERIFY alert. Yish then confirmed the notification appeared on his phone.
This proves the tested phone path; a naturally matched useful deal notification
is a separate observation still to collect.
