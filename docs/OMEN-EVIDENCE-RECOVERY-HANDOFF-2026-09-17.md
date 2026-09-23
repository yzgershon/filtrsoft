# OMEN implementation prompt: missing-evidence recovery

I am Yish, the owner and actual user of Filtrsoft. Continue the existing project on this OMEN. Implement all five workstreams below, verify their effect on real listings, and deploy the tested changes. This is an implementation task, not another audit or a request for recommendations. Make a structured plan, keep HANDOFF.md current after each meaningful milestone, and continue through validation and a measured final report.

## Start from the actual installed state

This OMEN is the primary collector. Keep the laptop collector paused. Locate the installed runner and its configured repository/database paths; do not assume the runtime is whichever checkout opened in Codex. Read applicable AGENTS.md files, HANDOFF.md section 0, git status, recent history, runner configuration and current job state before editing. Inspect configuration without printing secrets.

Read docs/COLLECTOR-UPDATE-2026-09-17.md, docs/DESKTOP-COLLECTOR.md, docs/LOCAL-VISION-EVALUATION.md and docs/HOBBY-STORAGE-PLAN-2026-09-15.md if present. The laptop also prepared docs/COVERAGE-RECOVERY-2026-09-17.md, but it may not be in your checkout: it is in laptop-only commit 7cc6721. This prompt contains the essential findings, so its absence is not a reason to stop or reconstruct the conversation.

Preserve desktop-specific commits, dirty files, database, node identity, pending outbox, browser profiles, startup configuration, labels and user overrides. Do not hard-reset, reinstall the collector, replace Dev, or import an older database/archive. Develop in an isolated checkout when appropriate. Before changing the installed runtime, use its own maintenance/stop mechanism, confirm its owned processes exit, and make and restore-verify a consistent SQLite backup. Do not copy only the .db file from an active WAL database. Leave unrelated processes alone. Resume through the existing supervisor with the same node identity. Maintain one owner per browser profile and one primary collector.

The last laptop-verified production source was 526de33, engine 0.3.38. Later server presence reported OMEN revision 4acecefff1fb, but its ancestry was not verified from the laptop. Fetch and inspect actual history and production health; preserve newer work and do not reset to these historical hashes. The Mercari item-panel fix was 9d25046; verify it is present rather than blindly reapplying it. Browser workers run under Node .mjs; Bun runs backend/database code. Use this machine's installed native tools, not the laptop's ARM executable path.

## Measured baseline, not guaranteed current state

September 17 at approximately 20:28-20:31 UTC:

- Feed: 2,549 INSUFFICIENT_DATA listings.
- Rolling-day cohort: 963 arrivals, all scored, only 323 with seller descriptions, zero pending first scores. This was primarily missing evidence, not a first-score backlog.
- Broader all-live stored population: 2,962 first reported blockers. These are NOT the same population as the feed: 1,117 model/exact model; 1,243 CPU/GPU/RAM/storage; 210 seller description; 390 sold comps/matching builds/remaining component prices; 2 inventory item/quantity.
- Those are first blockers, not complete root causes. A custom build can be labelled missing exact model when its actual problem is missing component prices.
- Generic catalog coverage was 433/602; RAM generic coverage was 0/13. Neither figure proves exact-configuration coverage or zero RAM comp rows.
- Current source caps were 18 discovery cards versus 20 detail reads per cycle, before failed reads and recurring checks.
- Existing cloud vision had reached its daily budget. Do not increase it or add a paid service.
- Production had about 97 MB physical free space with reusable SQLite pages. Durable production backup/space recovery remained unresolved. Recheck before writes and avoid unbounded ingestion or destructive cleanup.
- My phone received the test notification. Registration, push-service acceptance and physical display are confirmed. A naturally matched useful deal alert is still a separate result to verify.

Take fresh baselines and distinguish local, collector-uploaded and production evidence throughout.

## 1. Replace description-length eligibility with evidence-driven recovery

Inspect src/db/enrichment.ts (dueDetails), src/agent/targets.ts (repairTargets), their API/sync paths and existing retry state. Both queues generally exclude non-actionable listings once the description reaches 40 characters, even when decisive specs remain missing. Fix both sides together.

Important: the 40-character rule is an eligibility condition, not proof that stored text is truncated to 40 characters. Separately audit full-description extraction on Craigslist, Facebook Marketplace, OfferUp and Mercari. Expand the seller description when necessary, including See more, and capture the complete available seller text. Preserve paragraphs, prices, quantity tiers and condition disclosures. Keep actual listing content separate from recommendations, breadcrumbs, comments and surrounding page text. Identify login walls, challenges, timeouts and incomplete extraction honestly; do not mark them as successfully read empty descriptions. If a protective size limit is needed, make truncation explicit and do not silently treat the result as complete.

Represent all actionable blockers and route them to the correct next job: full text, photo facts, identity/catalog resolution, exact comps, availability, or explicitly unresolved. Separate missing whole-product identity from missing prices for known custom-build components. Integrate with existing queues instead of creating competing pipelines.

Track attempts, source/content changes, completion and next eligible retry. An unchanged page that genuinely omits a GPU must not be reread forever. Failed/incomplete reads need bounded retries; unchanged complete reads should advance to another evidence source or back off. Reopen work when relevant evidence changes. Preserve independently timed text, photos and availability updates and idempotent upload acknowledgements.

## 2. Give backlog recovery its own bounded collection capacity

Inspect src/agent/collection.ts and the supervisor. Add a recovery lane that can make progress faster than new unique incomplete listings accumulate, using observed read times, success rates and source challenges. Preserve a bounded fresh-deal and availability lane so catch-up does not miss new deals or keep sold recommendations alive.

Use configurable per-source time/attempt budgets, fair scheduling, backoff, durable checkpoints and resumable sync. Track unique discoveries separately from duplicate search cards. Do not indiscriminately raise every crawl limit, parallelize the same browser profile or start a second collector. Test interruption, restart and upload failure without losing facts or duplicating work. Keep the desktop usable for gaming.

## 3. Recover accurate specs from full text and photos

Fix deterministic text parsing first, using representative real listings as fixtures. Cover custom PCs, laptops, phones and components; exact model suffixes, kit layouts, capacity, quantity, ECC/registered memory, integrated versus discrete graphics, inventory ads and damaged/non-working disclosures. Do not treat a desired trade, compatibility list, historical configuration or negated component as the item being sold. Keep field-level quotes and provenance and preserve contradictions.

Then evaluate the existing local-vision harness on this OMEN's RTX 4070 Ti. Inspect what is actually installed. The laptop had not verified an installed model or its accuracy. No new monthly service or increased cloud budget. If software/model installation is necessary and not already authorized, ask once with the exact download/setup required while continuing independent work.

Use manually annotated real photos and held-out cases across at least three categories, including unreadable labels, contradictory photos, ECC, individual sticks versus kits and near-identical model names. Record model/version/digest, latency, resource use, missed facts and unsupported claims. Define factual acceptance gates before using the evaluation results. A schema-valid response or model confidence is not accuracy evidence. Validate any eventual production adapter as well as the lab.

Only enable fact ingestion after those gates pass, initially on a bounded cohort. Preserve photo provenance, uncertainty, conflict handling and idempotency; never let the model invent asking prices or sold values. Use idle-GPU controls, bounded resource use and pause/unload behavior. Keep photo bytes off the Railway volume. If accurate local extraction cannot be demonstrated, leave that writer disabled and report the measured limitation, while completing the other workstreams.

## 4. Collect exact sold evidence demanded by unresolved listings

Extend the existing demand-based comp picker in src/sources/comp-priority.ts and src/scripts/comp-refresh.ts. It already exists; the task is to close its gaps, including unmatched catalog identity and exact configurations that generic SKU coverage misses.

Separate identity resolution from price collection. Resolve category/query mismatches and investigate the RAM/storage taxonomy issues using actual current code and rejection logs. Correct misleading desktop-memory queries for storage if still present. Support the unresolved configurations and known custom-build components actually demanded by the backlog, without starvation, tight empty-query loops or invented SKUs.

Keep exact model/variant, capacity, quantity, kit, ECC, condition, AIB identity and whole-machine guards. Do not relax those guards, use asking prices as sold prices or splice unrelated parts into a fictional sold build. Preserve dated evidence and source URLs. Record rejection reasons, attempt outcomes and accepted yield. Sync accepted observations promptly and re-score affected listings without repeatedly blocking the API. Distinguish server-local attempt telemetry from desktop comp uploads.

## 5. Implement conservative bounded decisions for minor unknowns

Build and separately test an explicit policy for secondary unknowns. A PASS or cautious VERIFY can be justified only if the compatible configuration set is demonstrably bounded, every relevant possibility is represented by adequate valid evidence, and all supported outcomes agree. A finite sample of observed configurations is not proof it covers every possible configuration.

Otherwise retain INSUFFICIENT_DATA with the precise unresolved blocker. Never fill in a CPU, GPU, storage capacity or price from memory, value a whole machine from a partial component sum, conceal contradictory condition evidence, or promote a listing to BUY while major identity/condition uncertainty remains. Preserve existing risk/condition precedence and manual user overrides. Expose supported ranges, provenance and limitations clearly wherever the verdict is shown or used for alerts.

Regression-test unsupported and unbounded configurations, sparse/outdated/mismatched comps, threshold-crossing intervals, contradictory evidence and damaged listings, alongside valid bounded cases. Ship only the provably supported cases; document why other cases remain unresolved.

## Prove the improvement, release it, and leave collection running

Before recovery, freeze a reproducible cohort of 250 live in-scope can’t-tells, stratified across sources, categories and blocker types. Save IDs, facts, verdicts, timestamps and all blockers. Use consistent isolated snapshots for counterfactual scoring and record fresh-source changes separately.

Report transitions separately: newly valued listings, corrected RISK calls, confirmed-unavailable retirements, unresolved listings and new arrivals. Retirement is not successful valuation. Compare cohort outcomes rather than two changing feed totals. Manually audit recovered recommendations and a sample of remaining unknowns. Measure description completeness, exact identity, accepted comp yield, recovery per collector hour, repeat no-progress reads, request latency and false recommendations. Do not promise a recovery percentage before measuring it.

Add meaningful regressions that fail on the original long-description queue bug and on truncated/full-description extraction, plus retry/backoff, queue ownership, sync/restart, comp-routing and interval-policy cases. Run the relevant tests, full suite, typecheck, production build and required CI/container checks using isolated databases. Bump ENGINE_VERSION for verdict-affecting changes. Preserve cooperative scoring and cold-health responsiveness.

I authorize committing and pushing the tested combined changes to main, triggering the Railway production deployment. Reconcile remote changes and preserve desktop setup commits; do not force-push or publish machine-specific configuration. Deploy compatible server support before any collector protocol change requires it, then update the actual installed OMEN runtime safely.

Verify CI, deployment, live engine/source receipt, matching web assets where applicable, same collector identity/new runtime revision, upload acknowledgements, bounded recovery cycles, scoring completion and absence of failed checks. Recheck current availability of recovered BUY/VERIFY listings. Observe the normal account-scoped alert pipeline; do not fabricate deals or send seller messages to prove it works. A lack of a qualifying new deal must be reported honestly.

No spending, new paid subscriptions, credential entry, automatic login, seller messaging, destructive data deletion or unrelated infrastructure changes. Ordinary reversible development, tests, recoverable retirement, authorized collection and deployment should proceed autonomously. Ask only for an actual missing approval or access, explain the blocker, and continue unaffected work.

Update HANDOFF.md at milestones and before stopping with exact revisions, tests, cohort results, deployment/runtime receipts and remaining limitations. Finish with what changed across all five workstreams, measured recovery and error counts, what remains unresolved, and whether the OMEN is running the verified release. Do not call local tests proof of production behavior or declare the entire backlog solved because code shipped.
