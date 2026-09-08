# Backend audit implementation plan

Authorized by Yish on 2026-09-07: implement all findings, use structured phases, and update HANDOFF frequently.

Source audit: C:/Dev/filtrsoft-backend-audit-2026-09-07/BACKEND-AUDIT.md. Worktree: C:/Dev/filtrsoft-backend. Branch: codex/backend-hardening. Base: e5a7023 plus saved inventory commit e7863ae, reconciled as 6d3b804. Shared main and original inventory worktree remain untouched.

Status meanings: pending, in progress, implemented (checks pending), verified locally, deployed. Only record a finding as verified when its acceptance evidence exists. Keep unresolved subparts explicit. No production result is implied by a local check.

## Phase 1: correctness barriers — verified locally

- F01 — verified locally: parts category contract; searchable catalog identities without aliases; exact part brand/model/configuration matching; correct storage queries and seed category. Legacy storage rows are interpreted compatibly rather than rewriting the active crawl DB.
- F02 — verified locally for audit regressions: complete GPU variants; strict known capacity and board-tier guards; RAM brand/layout/ECC/variant exclusions in comp acceptance and valuation. Broader provenance/AIB configuration work remains F15/F16.
- F04 — verified locally for core audit regressions: normalized stored facts, seller references and reusable current vision; stable refresh/re-score evidence; actual photo URLs and safe unchanged-hash reuse. Transport precedence and multi-process photo ownership remain F03/F17.
- F06 — verified locally: canonical price/history update, stale replay rejection and durable recheck queue on accepted sweep observations; missing-verdict recovery. Broader ingestion revisions remain F03/F09.
- F08 — verified locally: session ownership for subscriptions, searches/test-send, overrides, outcome writes/counts and purchases. Legacy push adoption proves browser-held keys. Only unambiguous single-account historical outcomes migrate automatically; ambiguous rows remain private and need explicit reconciliation. Frontend silently re-registers an existing browser subscription after upgrade.
- Acceptance: exact-product positive and negative fixtures, stored/fresh equivalence, price-drop regression, two-account route matrix, existing tests and typecheck. Bump ENGINE_VERSION before commit.

## Phase 2: reliable synchronization and delivery — verified locally

- F03 — verified locally: durable versioned local outbox, per-change server acknowledgement, retirement propagation, rich/newer evidence precedence, reconnect/replay convergence.
- F05 — verified locally: source-aware stored-photo enrichment, Mercari galleries, synced vision revisions and explicit outcomes.
- F07 — verified locally: match before limiting, persistent retryable/terminal/delivered states, concurrent claim leases, personal overrides and send-time availability revalidation. Remote acceptance followed by a crash can retry; existing notification tags deduplicate the visible listing notification.
- F11 — verified locally: consistent ISO comparisons for TTLs and rolling metrics; same-day, cross-midnight and exact-boundary tests. Heartbeats remain F12.
- Acceptance: forced transport failures and replays, missed-deal fixture, transient delivery retry exactly once, stale-job expiry. No real notification required.

## Phase 3: archive and scoring completion — code verified; final data artifact pending

- F09 — code verified locally; final current-crawl archive/rollback pending: data revisions including relinks/corrections/expiry; missing-verdict recovery; resumable scoring cursor and failures; fresh engine revision and archive manifest.
- F10 — verified locally: idempotent retail observations, newest availability wins, freshness of every corroborating quote.
- Saved inventory/Review changes integrated locally as 6d3b804; their older archive is not a replacement for newer shared data.
- Acceptance: comparison on an isolated consistent current snapshot, import twice and after a correction, simulated interrupted scoring, exact before/after counts and rollback artifact.
- Fresh archive generation requires a coordinated snapshot of current crawl data. Deployment is a final separate authorization step explicitly naming main and Railway.

## Phase 4: bounded work and useful collection — in progress

- F12 — core verified locally; actual browser/process/provider integration remains unexercised: persisted job heartbeats/stages, request deadlines, resumable batch work, independent discovery/enrichment cadence, profile ownership, Windows process-tree cleanup.
- F13: sold/date/provenance eligibility at ingestion and valuation; quarantine uncertain evidence and isolate provisional fixtures.
- F14: truthful priceability/funnel metrics, demand-ranked collection, zero-result backoff; exclude consoles from collection priority.
- F17 — verified locally for bounded intake, task ownership, probe fairness and undated expiry: bounded photo intake, owned temporary paths, preserve current hashes, fair probing and candid unknown dates.
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
- 2026-09-07: exact-identity batch, engine 0.3.34, 209 tests / 698 assertions / zero failures; typecheck passed. Test prices live only in temporary isolated databases. Fresh-check/stored-check equivalence and ownership are next, not yet complete.
- 2026-09-07: evidence and sweep-price batch, 213 tests / 702 assertions / zero failures; typecheck passed. Four process-isolated regressions cover preserved facts, current vs stale vision, no refetch for unchanged hashes, and price recheck recovery. Ownership is next.
- 2026-09-07: ownership batch completes phase 1 locally: 217 tests / 706 assertions / zero failures; typecheck and Vite production build passed. Actual router tested with two synthetic accounts and blocked transports. No production changes. Next F07/F11, then F03/F05.
- 2026-09-07: F07/F11 batch, 222 tests / 711 assertions / zero failures; typecheck passed. Five isolated delivery/time regressions. Next durable fact synchronization and source-aware enrichment.

- 2026-09-07: F03/F05 batch, 230 tests / 719 assertions / zero failures; typecheck passed. Eight isolated/pure regressions plus disposable snapshot queue coverage: 461 Facebook, 440 OfferUp, 109 Mercari. No transport, paid vision, shared data edits or deployment. Next F09/F10.

- 2026-09-07: F09/F10 code batch, 236 tests / 725 assertions / zero failures; typecheck passed. Six new process-isolated regressions. Final comparison on disposable audit copy: 4,416 live, zero failures, INSUFFICIENT_DATA 953 -> 998, BUY unchanged at 12. Caught and corrected laptop board-tier leakage and bare-case routing. Final current-crawl archive deferred to completed provenance/export guard, not replaced with the older snapshot. Next F12/F17.

- 2026-09-07: F12/F17 workflow batch, 242 tests / 731 assertions / zero failures; typecheck and browser-module Node syntax passed. Seven new isolated regressions; replaced the old source-string expiry assertion with a real feed/prune regression. No browser, paid model or actual process-tree kill run. Next F13/F14.
