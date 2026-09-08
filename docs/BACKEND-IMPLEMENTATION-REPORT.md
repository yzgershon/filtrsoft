# Backend audit implementation: local completion report

2026-09-08. All 20 audit findings have local implementations on codex/backend-hardening in C:/Dev/filtrsoft-backend. Engine 0.3.34 has not been deployed. Release validation remains open: clean-image/CI build, private backup coverage and authenticated production checks. This report distinguishes finished code from those external checks.

The branch includes the saved inventory/ten-listing Review implementation from e7863ae, reconciled as 6d3b804, and preserves the original worktree. Main remains e5a7023. Its two modified-status frontend files showed no content diff during final inspection; no shared files were changed or staged. No comp crawl, paid model call, real notification, provider login, installation or production mutation was performed.

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

The combined comparison checked 4,456 live rows with zero failures. No re-score or retirement was applied to the shared local database or production. The third column excludes the 76 recoverable appliance candidates identified on the same snapshot; it is a projected post-cleanup population.

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

## Production and remaining release checks

Public production health read at 2026-09-08T12:54:33Z reported engine 0.3.33, 25,171 comps, 443 runtime SKUs and the September 5 archive (434 SKUs). Billing was disabled. These are timestamped production observations; the new 31,900-comp artifact is still local.

1. Run the committed clean-install/container workflow before promotion. Pinned Node/Bun images are not cached; no image pull or fresh dependency installation was performed. Local builds used existing linked dependencies, so they do not prove the clean Docker build.
2. Verify a production database backup and provider/offsite restore coverage before deployment. The filtered local drill cannot preserve private production accounts or substitute for that backup. An older additive archive alone is not a database rollback.
3. After authorized push to main and Railway deployment, verify imported artifact/version, scoring completion/errors, authenticated Review/detail/label behavior, feed/pulse cursors and agent reconnect. Actual browser/process-tree and provider transports were covered by isolated fixtures or syntax checks, not live integration runs.
4. Before enabling billing, reconcile any legacy customer ownership and exercise signed Stripe test-mode events and portal/checkout ownership. Billing remains disabled; no payment action was taken.
5. Real transaction calibration needs Yish's recorded sale proceeds and costs. Legacy labels without frozen inputs stay unavailable for replay. Existing weights were not retuned without that evidence.

Detailed local evidence is under C:/Dev/filtrsoft-backend/backups/final-2026-09-08: facts-v2.db, comparison-v3.db, final-measurements.json, transitions.json, archive-upgrade.json and rollback-v3/. The compact [committed evidence](sessions/2026-09-08-backend-evidence.json) contains counts, manifests and timestamps.

The first filtered snapshot attempt omitted schema_migrations and therefore reran an old verdict deduplication on its disposable copy. It was superseded by facts-v2.db and comparison-v3.db, which preserve all 16,531 baseline verdict rows. Earlier facts.db/comparison.db/restore-drill.db artifacts are not the final evidence. Shared facts were never altered.
