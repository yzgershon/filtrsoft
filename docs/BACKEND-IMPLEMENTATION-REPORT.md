# Backend audit implementation and production release report

2026-09-08. All 20 audit findings are implemented and deployed to filtrsoft.com in **52433ce**, engine **0.3.34**, with **31,900 comps**. GitHub CI passed all release checks. Production scoring completed with zero pending rows and zero failures. The final wording follow-up **7f9f2ea** also deployed successfully, with [CI run 34265992387](https://github.com/yzgershon/filtrsoft/actions/runs/34265992387) passing. Its production asset matches the build byte for byte, and the corrected wording is visible in authenticated listing details. Health at 18:58:05Z still reports zero pending scoring and zero failures.

Work remains isolated in C:/Dev/filtrsoft-backend on codex/backend-hardening. The saved inventory/ten-listing Review commit is included. The shared local main checkout remains at its preserved e5a7023 state; remote main has advanced. Pinned dependencies were downloaded with Yish's authorization and a full same-volume production backup/restore copy was verified before deployment. No provider login, training label, seller message or manual paid vision request was made during release verification. Existing production schedules continued normally.


## What changed

| Audit findings | Implemented behavior |
| --- | --- |
| F01, F02 | Consistent part/storage categories, canonical catalog matching, complete GPU variants, strict memory brand/layout/ECC and capacity/tier guards. Omen laptop titles cannot inherit a replacement desktop mentioned in the description. |
| F03, F05 | Durable versioned sync outbox with exact acknowledgments, newer-fact precedence, retirement transport and portable current vision; source-aware enrichment and Mercari galleries. |
| F04, F06 | Shared fresh/stored facts, seller evidence and preserved photo hashes; accepted price changes update history and queue scoring atomically. |
| F07, F08, F11 | Persistent delivery retries/leases with eligibility before limits; account ownership for alerts, labels and outcomes; consistent UTC time comparisons. |
| F09, F10 | Pricing data revisions, resumable scoring/retry state, consistent versioned archives and ordered corrections; idempotent retail observations with current availability and strict configuration. |
| F12, F17 | Agent heartbeat/stage/report recovery, bounded network/provider/image work, independent background lanes, browser-profile ownership, process-tree cleanup, owned photo workspaces and fair delisting probes. |
| F13, F14 | Sold/date/provenance eligibility and recoverable quarantine; priceability through actual valuation, collection yield/backoff/demand priority, stage funnel and first-score latency. Health readiness follows suitable evidence. |
| F15 | Frozen facts, engine/data/economics and selected-comp evidence; personal economics isolated from canonical results; stable feed cursors, pulse burst draining and bounded request inputs. |
| F16, F18 | Matched-build vs broad-family uncertainty; original dollar priors preserved; append-only decision-bound judgments and transaction/disappearance distinction, frozen replay and known-cost margin reporting. |
| F19, F20 | Verified backup/restore and explicit secondary-copy failure; pinned runtimes, frozen lockfiles, CI/image checks and context exclusions; session-owned billing customers, durable signed-event retries, authoritative reconciliation and lease fencing. |

The [implementation plan](BACKEND-IMPLEMENTATION-PLAN.md) maps individual acceptance evidence. The [operations runbook](BACKEND-OPERATIONS.md) describes restore, billing and rollout procedures.

## Verification

- 260 tests passed, zero failed, 755 assertions. Full suite uses isolated databases and synthetic transports. TypeScript and Node/Vite production build passed.
- Current market/evaluation snapshot captured at 2026-09-08T12:56:14Z in a read-only SQLite transaction: 31,900 comps, 559 SKUs, 35 retail quotes, 4,728 listings and 16,531 verdicts. Account/session/token/config tables were excluded. The migration ledger was retained to avoid replaying historical cleanup.
- Backup and restored copy have identical hashes and counts, SQLite integrity is ok and foreign-key violations are zero. This proves recovery of the filtered local snapshot, not production recovery or offsite coverage.
- New archive: 31,900 comps / 559 SKUs / 35 retail quotes. Manifest SHA-256: `0f1a2363ffdbf3ac458ddcbe47d9e182052106f222d57aa20cb03afbe4a9386b`.
- Fresh-database upgrade from main's September 5 archive added 6,729 comps and 125 SKUs with zero skipped rows. Repeat import changed zero rows; integrity remained ok. The previous main archive is retained under backups/final-2026-09-08/main-before-archive.json.gz and in Git at e5a7023.
- Generic used-condition priceability: 492 of 547 in-scope SKUs; 28,871 date-eligible comps within 90 days, zero quarantined. Generic model coverage is not exact listing-configuration coverage. All 13 RAM SKUs lack the precise usable evidence required; no kit layout or price was guessed.

## Measured verdict effect

The combined comparison checked 4,456 live rows with zero failures. This comparison did not apply changes to the shared local database or production; the later production rollout is measured separately below. The third column excludes the 76 recoverable appliance candidates identified on the same snapshot; it is a projected post-cleanup population.

| Call | Stored baseline | New engine | New engine, excluding 76 appliances |
| --- | ---: | ---: | ---: |
| BUY | 12 | 6 | 6 |
| VERIFY | 27 | 33 | 33 |
| FAIR | 46 | 38 | 38 |
| PASS | 338 | 233 | 233 |
| RISK | 62 | 61 | 61 |
| INSUFFICIENT_DATA | 961 | 1,081 | 1,069 |
| OUT_OF_SCOPE | 3,010 | 3,004 | 2,940 |
| Live total | 4,456 | 4,456 | 4,380 |

This improves evidence discipline, not the raw count of priced listings. INSUFFICIENT_DATA rises from 961 to 1,081 before cleanup, or 1,069 after excluding appliances. Of 121 transitions into unknown, 73 need sold builds matching CPU/GPU/RAM/storage, 35 lack suitable recent sold comps, 11 lack an exact model, and two lack RAM or remaining component evidence. One prior unknown becomes out of scope, yielding the net increase of 120 before cleanup.

Six prior BUY listings (#371, #419, #430, #1074, #1108, #3908) relied on broad GPU-family desktop evidence. They now retain the broad estimate with its uncertainty and cannot trigger a profitability-based buy. A seventh, #1109, is an HP Omen 16 laptop previously priced as a desktop; it now correctly needs exact laptop evidence. #2696 changes PASS to BUY using four comps explicitly matching its stated CPU/GPU/RAM/storage; the detailed description supplies 9800X3D even though the title truncates it to 9800X. This is an engine result, not a new manual endorsement of the seller.

The four inventory ads still lack matching item-level sold comps. The item parser preserves 14, 3, 12 and 14 offers for #590, #648, #651 and #1984; it does not invent an aggregate asking price. The retired candidates are household appliances with repetition plus product evidence, not repeated computers.

## Production verification and remaining integration limits

At 2026-09-08T18:51:35Z, production reported engine 0.3.34, 31,900 comps, the exact new archive hash imported successfully, database ok, and scoring complete with **0 pending / 0 failures**. Root HTML and compiled JS/CSS returned 200; their hashes matched the verified local build. Private feed/pulse routes returned 401 without authentication. [GitHub CI run 34234175387](https://github.com/yzgershon/filtrsoft/actions/runs/34234175387) passed fresh frozen installs, all 260 tests / 755 assertions, typecheck, frontend build, network-disabled verification container and production image build.

Read-only queries at 18:52:25Z compared the predeployment backup's 6,124 live listing IDs with their current latest decisions:

| Call | Before deployment | Same IDs after scoring | Same IDs still live |
| --- | ---: | ---: | ---: |
| BUY | 4 | 3 | 3 |
| VERIFY | 22 | 35 | 35 |
| FAIR | 38 | 38 | 38 |
| PASS | 309 | 234 | 234 |
| RISK | 74 | 76 | 76 |
| INSUFFICIENT_DATA | 1,135 | 1,200 | 1,185 |
| OUT_OF_SCOPE | 4,546 | 4,538 | 4,454 |
| Total | 6,124 | 6,124 | 6,025 |

The scheduler retired **99 repeated appliance ads recoverably**, including 15 insufficient and 84 out-of-scope decisions. The complete current live population, including new arrivals, was 6,117: BUY 6, VERIFY 35, FAIR 38, PASS 234, RISK 77, INSUFFICIENT_DATA 1,209, OUT_OF_SCOPE 4,518. All live latest verdicts use 0.3.34. Crawling and enrichment continued during deployment, so these are observed before/after results, not an isolated causal experiment. This replaces any attempt to treat the earlier 76-appliance snapshot as production evidence.

An existing authenticated Chrome session showed ten Review listings and /c/4254's four recorded matching-build comps, profit explanation, expandable evidence and label choices. Back navigation worked. Label choices were canceled without writes. Comp evidence was not date sorted despite the prior copy; the final wording now describes recorded evidence without promising date order.

- Full production backup/restore-copy verification is complete on the existing volume; see the [backup record](sessions/2026-09-08-production-backup.json). Offsite recovery remains unverified.
- The laptop agent is offline. Its implementation is pushed, but reconnect, browser lifecycle/process-tree and real marketplace transports have not been exercised on the laptop. Shared local checkout changes were preserved.
- Live label persistence and pulse arrival bursts were exercised with isolated synthetic accounts/tests, not fabricated production training data. Production browser evidence above covers read-only interactions.
- Billing remains disabled. Signed Stripe test-mode events, portal/checkout ownership and legacy customer reconciliation are still required before activation; no payment/provider configuration was performed.
- Real transaction calibration needs recorded sale proceeds and costs. Legacy labels lacking frozen inputs remain unavailable for replay, and weights were not retuned without evidence.

Compact deployment evidence: [production release record](sessions/2026-09-08-production-release.json).

Detailed local evidence is under C:/Dev/filtrsoft-backend/backups/final-2026-09-08: facts-v2.db, comparison-v3.db, final-measurements.json, transitions.json, archive-upgrade.json and rollback-v3/. The compact [committed evidence](sessions/2026-09-08-backend-evidence.json) contains counts, manifests and timestamps.

The first filtered snapshot attempt omitted schema_migrations and therefore reran an old verdict deduplication on its disposable copy. It was superseded by facts-v2.db and comparison-v3.db, which preserve all 16,531 baseline verdict rows. Earlier facts.db/comparison.db/restore-drill.db artifacts are not the final evidence. Shared facts were never altered.
