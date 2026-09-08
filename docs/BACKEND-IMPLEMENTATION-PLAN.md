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

## Phase 3: archive and scoring completion — verified locally

- F09 — verified locally including current archive, import replay and snapshot rollback drill: data revisions including relinks/corrections/expiry; missing-verdict recovery; resumable scoring cursor and failures; fresh engine revision and archive manifest.
- F10 — verified locally: idempotent retail observations, newest availability wins, freshness of every corroborating quote.
- Saved inventory/Review changes integrated locally as 6d3b804; their older archive is not a replacement for newer shared data.
- Acceptance: comparison on an isolated consistent current snapshot, import twice and after a correction, simulated interrupted scoring, exact before/after counts and rollback artifact.
- Final artifact generated from a consistent read-only snapshot on September 8: 31,900 comps / 559 SKUs / 35 retail. Old-to-new import adds 6,729 comps; repeat changes zero. Deployment is a final separate authorization step explicitly naming main and Railway.

## Phase 4: bounded work and useful collection — code verified locally; live transports unexercised

- F12 — core verified locally; actual browser/process/provider integration remains unexercised: persisted job heartbeats/stages, request deadlines, resumable batch work, independent discovery/enrichment cadence, profile ownership, Windows process-tree cleanup.
- F13 — verified locally: explicit sold/date/provenance eligibility at ingestion, valuation and export; recoverable quarantine, provisional seeder disabled, historical dated evidence retained.
- F14 — verified locally including provenance-backed stage cohort, first-score latency and unknown historical stages: actual generic used-condition priceability by category, raw linkage named separately, collection attempt funnel and insufficient reasons, demand/freshness/yield priority with zero-result backoff, consoles excluded.
- F17 — verified locally for bounded intake, task ownership, probe fairness and undated expiry: bounded photo intake, owned temporary paths, preserve current hashes, fair probing and candid unknown dates.
- Acceptance: deterministic timeout/cancellation/retry tests, bounded work under stalled inputs, meaningful query/coverage measurements. No duplicate comp crawl.

## Phase 5: explainable decisions and calibration — code verified locally; real-data calibration unclaimed

- F15 — verified locally for audited decision, economics, pagination and input regressions: recorded facts/engine/data/economics provenance and exact adjusted comp evidence, coherent detail responses, canonical/personal isolation, check/drive schemas. Account/filter-bound stable feed windows, first-eligible pulse cursors and bounded check/drive/feed/outcome inputs.
- F16 — verified locally: explicit matched-build vs GPU-family configuration evidence, labeled parts weights/unpriced roles, insufficient-data guard for unsupported estimates; pricing weights unchanged.
- F18 — verified locally: account-bound displayed-decision snapshots, append-only judgment history and immutable engine revisions, current-label evaluation/export/frozen replay, separate disappearance/transaction evidence, contemporaneous SKU and decision, known-cost realized-margin reporting. Legacy missing evidence remains unknown; no real-price calibration claimed.
- Acceptance: replayable decision evidence, concurrent economics isolation, pagination bursts, no inferred sale represented as a realized price. Report remaining data requirements honestly.

## Phase 6: operations and billing readiness — code verified locally; clean-image/provider checks pending

- F19 — verified locally; clean-install CI/image build and provider backup coverage pending: reproducible dependency/runtime build, consistent archive export, atomic verified backup and restore, build-context exclusions, CI checks.
- F20 — verified with synthetic transports; provider activation checks pending: billing account ownership, durable event processing, retryable webhook errors and out-of-order reconciliation before activation.
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

- 2026-09-08: F13/F14 core batch, 245 tests / 738 assertions / zero failures; typecheck passed. Disposable audit copy: 31,900 historical exportable comps, 28,871 eligible inside 90 days, zero quarantined, 492/547 in-scope SKUs generically priceable. Three new regressions and updated isolated positive fixtures. No current shared/production measurement or crawl. Next F15 including full stage funnel.

- 2026-09-08: F15 decision/economics batch, 247 tests / 740 assertions / zero failures; typecheck passed. New decisions retain evidence through later comp changes, and concurrent personalized results preserve the canonical shared verdict. Next feed/pulse cursors and full pipeline funnel.

- 2026-09-08: F15 pagination/F14 stage funnel, 250 tests / 743 assertions / zero failures; typecheck and Vite build passed. Full-population and inter-page mutation regression, same-time 51-row pulse burst, and explicit unknown-stage metrics. No browser/production workflow claim. Next F16/F18.

- 2026-09-08: F16/F18 batch, 253 tests / 746 assertions / zero failures; TypeScript and Vite build passed. Original dollar priors preserved, unsupported build estimates cannot drive actionable calls, and labels/outcomes retain contemporaneous evidence. Next phase 6 F19/F20 and final artifacts/comparison.

- 2026-09-08: F19/F20 batch, 259 tests / 752 assertions / zero failures; TypeScript passed. Backup/restore failure drills and four billing ownership/retry/order/fencing regressions. No provider call, installation, deployment or shared-data mutation. Final current snapshot/archive/comparison is next.

- 2026-09-08: final local verification, 260 tests / 755 assertions / zero failures, TypeScript and Vite passed. Snapshot-discovered Omen routing and health-readiness gaps fixed. Current archive/import/restore and 4,456-row comparison complete; snapshot/projected retirement results in docs/BACKEND-IMPLEMENTATION-REPORT.md. All 20 findings implemented locally; release gates and real-data/provider limitations remain explicit. No shared mutation or deployment.
