# Backend audit implementation plan

Authorized by Yish on 2026-09-07: implement all findings, use structured phases, and update HANDOFF frequently.

Source audit: C:/Dev/filtrsoft-backend-audit-2026-09-07/BACKEND-AUDIT.md. Worktree: C:/Dev/filtrsoft-backend. Branch: codex/backend-hardening. Base: e5a7023 plus saved inventory commit e7863ae, reconciled as 6d3b804. Shared main and original inventory worktree remain untouched.

Status meanings: pending, in progress, implemented (checks pending), verified locally, deployed. Only record a finding as verified when its acceptance evidence exists. Keep unresolved subparts explicit. No production result is implied by a local check.

## Phase 1: correctness barriers — in progress

- F01: one category contract; searchable catalog identities without aliases; exact part brand/model/configuration matching; correct storage queries.
- F02: complete GPU variants; strict known capacity and board-tier guards; RAM brand/layout/ECC/variant exclusions at common boundaries.
- F04: normalized stored facts and reusable current vision; stable refresh/re-score evidence; explicit unknown seller context.
- F06: canonical price/history update and scoring invalidation on accepted observations.
- F08: account ownership for subscriptions, searches, overrides and outcomes; preserve existing legitimate device data without an insecure claim-by-ID shortcut.
- Acceptance: exact-product positive and negative fixtures, stored/fresh equivalence, price-drop regression, two-account route matrix, existing tests and typecheck. Bump ENGINE_VERSION before commit.

## Phase 2: reliable synchronization and delivery — pending

- F03: durable versioned local outbox, per-change server acknowledgement, retirement propagation, rich/newer evidence precedence, reconnect/replay convergence.
- F05: source-aware stored-photo enrichment, Mercari galleries, synced vision revisions and explicit outcomes.
- F07: match before limiting, persistent retryable alert deliveries, deduplication and personal overrides.
- F11: consistent sortable timestamps, correct TTLs, cross-midnight boundary tests.
- Acceptance: forced transport failures and replays, missed-deal fixture, transient delivery retry exactly once, stale-job expiry. No real notification required.

## Phase 3: archive and scoring completion — pending

- F09: data revisions including relinks/corrections/expiry; missing-verdict recovery; resumable scoring cursor and failures; fresh engine revision and archive manifest.
- F10: idempotent retail observations, newest availability wins, freshness of every corroborating quote.
- Saved inventory/Review changes integrated locally as 6d3b804; their older archive is not a replacement for newer shared data.
- Acceptance: comparison on an isolated consistent current snapshot, import twice and after a correction, simulated interrupted scoring, exact before/after counts and rollback artifact.
- Fresh archive generation requires a coordinated snapshot of current crawl data. Deployment is a final separate authorization step explicitly naming main and Railway.

## Phase 4: bounded work and useful collection — pending

- F12: persisted job heartbeats/stages, request deadlines, resumable batch work, independent discovery/enrichment cadence, profile ownership, Windows process-tree cleanup.
- F13: sold/date/provenance eligibility at ingestion and valuation; quarantine uncertain evidence and isolate provisional fixtures.
- F14: truthful priceability/funnel metrics, demand-ranked collection, zero-result backoff; exclude consoles from collection priority.
- F17: bounded photo intake, owned temporary paths, preserve current hashes, fair probing and candid unknown dates.
- Acceptance: deterministic timeout/cancellation/retry tests, bounded work under stalled inputs, meaningful query/coverage measurements. No duplicate comp crawl.

## Phase 5: explainable decisions and calibration — pending

- F15: coherent versioned decision/provenance, selected comps and adjustments, account economics isolation, stable filter-before-page cursors and input schemas.
- F16: explicit whole-build configuration uncertainty and parts fallback evidence; preserve pricing policy until labeled evidence supports calibration changes.
- F18: contemporaneous labeled verdicts, current label regression set, distinguish disappearance from real sales and purchases, correct SKU linkage and reporting.
- Acceptance: replayable decision evidence, concurrent economics isolation, pagination bursts, no inferred sale represented as a realized price. Report remaining data requirements honestly.

## Phase 6: operations and billing readiness — pending

- F19: reproducible dependency/runtime build, consistent archive export, atomic verified backup and restore, build-context exclusions, CI checks.
- F20: billing account ownership, durable event processing, retryable webhook errors and out-of-order reconciliation before activation.
- Acceptance: local restore/integrity drill, build checks possible with existing tools, simulated duplicate/out-of-order webhooks; document provider configuration checks not accessible locally. No installation, paid action, or account login without authorization.

## Checkpoint discipline

Update HANDOFF and this file after each verified batch and before stopping. Commit small coherent units with why/evidence. Each checkpoint records actual commands/results, remaining gaps and next action. Tests use isolated databases; never default a diagnostic/re-score to the shared database. Preserve all unrelated changes and running processes.

## Completed checkpoints

- 2026-09-07: inspected current main and active process inventory; created isolated worktree; reconciled saved inventory commit. No shared data edits, crawl, or deployment.
