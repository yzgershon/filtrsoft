# Evidence recovery release — September 17, 2026

## Verified release

### Final audit follow-up

Candidate engine **0.3.43** additionally normalizes equivalent CPU punctuation without collapsing suffixes, keeps GPU VRAM distinct from system RAM, and rejects bracket dimensions, bandwidth and laptop-memory kit capacities as display/storage specifications. These errors were found in a second 20-row remaining-unknown review; the CPU and dimension regressions demonstrably failed before correction. The same frozen-facts counterfactual remains 250 INSUFFICIENT_DATA (p50 1.632 ms, p95 41.197 ms, maximum 410.430 ms). The deployment/runtime receipt below is the verified 0.3.42 checkpoint until the follow-up finishes.

Functional source `e594d57ace6cf495309dcee2c17dd62f06857ae3`, engine **0.3.42**, is deployed. [CI 35284919930](https://github.com/yzgershon/filtrsoft/actions/runs/35284919930) passed tests, typecheck, production build and both container verification/build steps. Railway deployment `91d3a408-81b7-419d-8908-8c208da148d6` is active. Production assets remain `index-C0OAYHY3.js` and `index-LTRDxhkn.css`.

The installed OMEN runtime is `C:\Dev\filtrsoft-agent`, merge **`79ce68284207cf3c197b129d612ef5e4d0b5e029`**, retaining the original `4acecefff1fb` ancestry. It resumed through the existing launcher at **23:09:10 UTC**. Production confirmed its new revision and original node at 23:09:56 UTC. Configuration, environment and launcher SHA-256 hashes match their pre-maintenance values. The laptop still reports `paused`; Gaming desktop remains primary, with a five-minute fallback grace and **30 minutes of rest after a completed automatic cycle**.

Before the update, the supervisor and its owned processes exited through its stop mechanism. The consistent, restore-verified backup contained **2,036 listings, 32,777 comps, 602 SKUs and zero foreign-key violations**, SHA-256 `690490bce50f3e44c66f9b4d29dee9ea6feefef7539361e2a70ca9a6fa0f78d7`. All 2,004 listings present before the measured automatic cycle remain present. No archive import, reset, reinstall, profile replacement or private configuration publication occurred.

## What changed in the five workstreams

| Workstream | Implemented behavior | Measured boundary |
|---|---|---|
| Evidence recovery | Local and production queues share blocker routing. Long descriptions remain eligible when decisive evidence is missing. Full reads carry content fingerprints, completion, timing, unchanged-read state and retry times. Text, photos and availability keep independent clocks. | Final frozen-facts selection includes 34 Facebook, 11 Mercari and 20 OfferUp descriptions longer than 40 characters. A complete page without the needed specification advances or backs off; it is not a successful valuation. |
| Bounded collection | Sequential source-interleaved recovery follows fresh discovery/details and availability, with a checkpoint/upload after each stage. Per-source default budget is 360 seconds and at most 20 additional attempts, adjusted from observed duration/success; configurable caps are 600 seconds/40 attempts. | Job 48 completed in about 20 minutes. Existing complete-text acquisition exceeded new unique arrivals during that one cycle; sustained backlog reduction is not yet demonstrated. |
| Accurate facts | Deterministic parsing preserves quoted facts, exact suffixes, kit/quantity/ECC information and contradictions; trade wishes, compatibility and removed/historical components cannot become current specifications. Full text exposes damage disclosures. | A live Mercari Unicode failure was repaired and retested. Qwen3.5-9B failed factual acceptance, so local photo fact ingestion remains disabled. |
| Demanded sold evidence | Exact configuration queries, identity-resolution routing, query-specific backoff/fairness, taxonomy guards, rejection telemetry and prompt idempotent comp uploads. Known screen size/GPU-core counts now also constrain laptop comps. | Three bounded queries accepted 191 dated rows and stored/uploaded 167 new observations. A subsequent normal maintenance pass acknowledged another 324. Generic SKU coverage is not exact-configuration coverage. |
| Minor unknowns | Explicit exclusive seller alternatives can support a bounded PASS/VERIFY only when every alternative has at least five distinct recent matching sold observations, all risks are resolved and the complete supported interval agrees. No inferred domain and no bounded BUY. | Regression fixtures pass; **no real cohort listing qualified for this policy**. The two real PASS results use existing exact-configuration decision paths. |

## Plan and release gates

1. Freeze a 250-listing four-source cohort and a restore-verified, isolated database. Preserve original facts, all recorded blockers and provenance. Record new source reads separately.
2. Replace length-based detail eligibility with shared evidence routing and durable content-aware retries; preserve independent observation clocks and upload receipts.
3. Give recovery bounded, sequential capacity alongside discovery and availability; retain profile ownership, checkpoints and retry budgets.
4. Improve factual text extraction, exact demanded sold queries, rejection telemetry and conservative bounded decisions. No relaxed matching or invented specifications.
5. Evaluate local vision only after model approval, with annotations and acceptance gates fixed first. Keep the production writer disabled unless factual gates pass.
6. Run regressions, full tests, typecheck and build; audit the frozen cohort. Push the tested combined release, verify CI/container and Railway receipts, then maintenance-stop, back up and update the existing OMEN runtime. Verify cycles, acknowledgements and scoring before declaring completion.

## Baseline milestone

- Isolated development branch `codex/evidence-recovery-20260917`, base `526de337b0de6588582f6fe41ff0ff68b9c5fd7e` (engine 0.3.38).
- Runtime at baseline was `4acecefff1fbd786872d9ba9f760e0db6e842e52`, including Mercari panel fix and desktop setup ancestry. The final merge preserves it.
- OMEN node `bc3313ad-0a65-4020-922c-e9a30505da21`; sync identity `7c09031a-1f31-4057-a6ba-b89c33755c26`. Primary with five-minute fallback grace; laptop persistently paused.
- At 20:58 UTC, production feed reported 2,568 insufficient-data rows. This changing feed total is not a recovery cohort.
- Verified SQLite baseline: 1,968 listings, 32,244 comps, 591 SKUs, zero foreign-key violations. Backup SHA-256 `80aba0385073e0ccffc45be9d318a6f27144eaf98ba612e6d5fc766e0523192b`.
- Private cohort and analysis artifacts are outside Git under the recovery data directory. Craigslist facts came from owner-visible production detail responses, browser sources from the consistent collector snapshot. “Live” means not recorded unavailable, not a fresh availability visit.
- Production physical free space remained about 97 MB and its backup space guard failed. No cleanup, volume purchase or unbounded ingestion is authorized by this release.
- Ollama 0.34.1 was installed with no models at baseline. Yish approved the download and requested the strongest practical fit; the subsequent evaluation used Qwen3.5-9B, 6.6 GB, on the RTX 4070 Ti 12 GB. Local vision writer remains disabled after failed acceptance.
- Yish confirmed physical display of the test notification. A naturally matched useful deal alert remains a separate unverified result.

## Vision gates fixed before evaluation

At least 20 manually annotated real image cases, at least three categories, at least eight held-out cases. Include unreadable labels, contradictory photos, ECC, sticks versus kits and near-identical model names. Ground truth must come from pixels; ambiguous text is unknown. Require zero unsupported or contradictory accepted identity/quantity/ECC facts, zero invented price/value facts, at least 95% precision and 80% recall on legible annotated facts in both development and held-out splits. Report abstentions separately. Require valid photo provenance, repeat idempotency, GPU-idle gating, bounded request timeout and unload on pause/abort. Schema conformance alone does not pass the gate. Do not enable the adapter when any gate fails or cannot be measured.

## Frozen-facts counterfactual

Engine 0.3.42 scored the exact same 250 listings against the frozen database: **250 remain INSUFFICIENT_DATA, zero valued transitions, zero new recommendations, zero retirements**. No fresh source reads or comp imports are included. Per-listing score latency was p50 **1.344 ms**, p95 **32.915 ms**, maximum **398.917 ms**. Recovery selection took 62–105 ms per source; of 40 selected per source, 34 Facebook, 11 Mercari and 20 OfferUp descriptions exceeded the former 40-character cutoff. This demonstrates repaired eligibility, not successful evidence recovery.

## Frozen cohort after real collection

The original manifest was frozen at **20:55:52 UTC**: 200 collector browser-source rows and 50 production Craigslist rows, stratified across source/category/blocker. Manifest SHA-256 is `4938bbb2f72a47f163e3f1430336adf2ca9299c3f6dbbe0205609d20f1202228`. IDs were never replaced. A later scope audit found one chair misclassified as a tablet; keep it in the reproducible denominator of 250 and disclose that the actual tech denominator is 249. It is not a recovery success.

The owner-visible production receipt saved at **23:11:58 UTC** contains all 250 IDs. Reads occurred across several minutes, so this is an observation window rather than an atomic production snapshot. All 249 unretired rows have engine 0.3.42 provenance; the already-retired row retains its historical 0.3.41 verdict. The isolated counterfactual above is the controlled comparison.

| Mutually exclusive outcome | Listings |
|---|---:|
| Newly valued, both PASS | 2 |
| Newly supported RISK from fresh damage disclosure | 1 |
| Confirmed unavailable and retired | 1 |
| Still unresolved and not retired | 246 |
| Total original cohort | 250 |

Stored calls alone are 247 INSUFFICIENT_DATA, two PASS and one RISK; the 247 includes the separately retired item. There are **zero new BUY or VERIFY recommendations**, and no naturally useful alert was generated by these transitions. The false-recommendation rate cannot be estimated with zero recommendations. Do not present that as 100% accuracy or a solved backlog.

- Rows with nonempty seller text increased **82 → 151**. Nonempty text is not a completeness certificate. The local receipt has **58 complete-read certificates** in the frozen cohort, including 57 successful reads from the dedicated batch and one earlier read.
- Catalog matches above low confidence increased **52 → 57**. This is catalog resolution, not proof of every exact machine configuration.
- Availability: **66 checked, one gone, nine unknown, 174 unchecked**. The counterfactual's original “live” definition was merely not recorded gone. No universal source-freshness claim is warranted.
- Twenty remaining-unknown examples were manually reviewed from their seller facts and verdict evidence, five per source, then a second 20-row review used the final production receipt. Some changed as full text arrived: the Acer Nitro now states i7-13620H/RTX 4060/16 GB/512 GB but still lacks a resolved exact catalog identity; the Legion 5 now states 15ACH6/5800H/3050 Ti/16 GB/1 TB but still lacks matching sold evidence. GPU/RAM bundles, professional GPU catalog gaps and ambiguous multi-offer listings remain unresolved. These reviews are not fresh source visits. Numeric/CPU punctuation defects found in the second review are addressed by the final follow-up above.

### Audit of every changed call

| Production ID | Final result | Evidence and limitation |
|---|---|---|
| 7519, Facebook MacBook Air M5, 13 inch, 16/512 GB, 8-core GPU | PASS | Ten dated sold observations explicitly match those dimensions. Adjusted median $994 versus $1,100 ask. The earlier pooled 33-comp result mixed display/core variants and was rejected during audit. Existing condition adjustments remain visible in provenance. Activation/MDM checks remain unanswered; this is a skip-price call, not purchase clearance. |
| 7545, OfferUp MacBook Air M4, 13 inch, 24/512 GB | PASS, low confidence | Two matching sold observations remain after rejecting mixed display sizes. Adjusted median $1,036.51 versus $1,400 ask. This is explicitly **sparse** under the existing exact-configuration PASS path, not a five-comp bounded-unknown decision. No BUY/VERIFY is supported. |
| 7465, Mercari GTX 1070 | RISK | The complete seller text states “For parts/Not working” and intermittent display. Source availability checked at 22:42:48 UTC. Working-unit values cannot override that disclosure. |
| 7743, Facebook vintage Intel case | Retired | Positive gone observation at 22:18:24 UTC. Counted as retirement, not valuation. |

The initial 0.3.41 audit showed three PASS and three RISK transitions. It exposed three issues that were corrected before the final receipt: pooled laptop screen/core variants, a store financing offer mistaken for outstanding debt, and cached photo text saying ports were not visible mistaken for evidence of physically absent ports. Final 0.3.42 returns the conflicting iPhone 14 Pro/Plus, uncertain Radeon port case and unsupported M1 laptop comparison to INSUFFICIENT_DATA. No cached vision payload was edited to manufacture a result.

## Collection, uploads and recovery throughput

Automatic **job 48**, **22:12:38–22:32:38 UTC**, completed all three source stages with `ok` using compatible runtime `cd1a53a54ab3`. Later release fixes were applied and the same evidence re-scored in production.

| Source | New unique listings | Detail attempts | Complete reads | Gone on detail read | Failed/incomplete | Acknowledged listing snapshots |
|---|---:|---:|---:|---:|---:|---:|
| Facebook | 7 | 36 | 32 | 1 | 3 | 49 |
| OfferUp | 12 | 40 | 36 | 0 | 4 | 58 |
| Mercari | 13 | 40 | 28 | 12 | 0 | 59 |
| Total | **32** | **116** | **96** | **13** | **7** | **166** |

There were **134 distinct availability observations: 112 alive, 16 gone, six unknown**. This population includes probes and detail reads; do not add its gone count to detail-read gone counts. Search telemetry saw 601 cards, including 355 known appearances; those are not unique discoveries. Upload acknowledgements count durable changes, not distinct listings.

Complete text was acquired for **69 previously stored listings** (25 Facebook, 28 OfferUp, 16 Mercari), all with changed content fingerprints. Over the 0.3336-hour cycle that is approximately **207 existing complete reads per collector hour**, versus **96 new unique listings per collector hour**. Zero completed unchanged repeat reads were observed in that cycle. These are evidence-acquisition rates from one cycle, not sustained valuation-recovery rates or a projected time to clear the backlog.

The additional bounded frozen-cohort pass ran **22:36:48–22:45:47 UTC**, including its comp collection: Facebook 18/20 complete, OfferUp 20/20 and Mercari 19/20. All **60 listing changes were acknowledged**, including honest failed-read state. Three failures were retained with retry state. One was the Unicode worker framing defect; the corrected worker later read that real panel completely with zero malformed events. That verification was read-only and is not an extra uploaded success in this batch.

Outbox and job-report checks after job 48 and the frozen-cohort pass found no pending listing changes/reports. The resumed final runtime began automatic job 49; its final operational receipt is recorded in HANDOFF. Maintenance interruption/restart, checkpoint replay, failed sync and one-owner profile behavior are additionally covered by isolated regressions. No forced production network outage or laptop takeover was used to manufacture a test.

## Exact sold observations

The dedicated three-query pass saw **366 cards**, 354 with parseable price/date, **191 accepted product matches**, **163 rejected identities/variants**, and 12 unusable date/price rows. It stored and received acknowledgements for **167 new observations** (57 RTX 5060, 13 iPhone 16 Pro Max, 97 RTX 3070); the other accepted observations were already known. Rejection records preserve examples and reasons. Audit found the concatenated `NEW LISTINGApple` badge caused false rejection, now normalized before maker checks.

Normal scheduled maintenance then acknowledged **324 additional new comps** (111 RTX 3050, 107 Ryzen 7 7800X3D, 106 RX 6600 XT), for **491 acknowledged new observations across these two passes**. The collector had 32,777 comps at the final maintenance backup. Exact AIB, suffix, capacity, kit/ECC, condition and whole-machine guards remain. Sparse or unmatched configurations still need evidence; no asking price was imported as a sold value. Production's server-local attempt telemetry must not be reported as desktop query activity.

## Real source extraction checks

- **Mercari m87685110404 / production 8154:** the real item panel returned a dedicated $529 price, positive availability and full text stating that it does not power on and is sold as-is for parts. The normal collector persisted it and received one acknowledgement at 22:11:16 UTC. Production correctly returns RISK. The prior $599 was not hardcoded or retained as current evidence.
- **OfferUp source c05b46e1-e7c6-3780-869d-6d5c23aba7d3:** public seller text, positive availability and one acknowledged change verified after breadcrumb handling was fixed. No current-price claim is made without a dedicated OfferUp price field.
- **Mercari m77429356792:** the real mid-2012 MacBook seller text contained Unicode U+2028/U+2029. Bun readline split its JSON event and lost the detail read. LF-only streaming framing now preserves the entire 1,674-character panel, including storage, integrated/discrete graphics and the damaged hinge disclosure. Zero malformed events/errors in the fresh read. A regression failed before the fix and passes after it.
- Full-description/truncation fixtures cover Craigslist and the three browser sources. The fresh Craigslist cohort probe returned a 410 for one row; it was a read-only check and was **not** counted as a committed retirement or successful description recovery.

## Local vision result and gaming controls

The installed official [Qwen3.5-9B Ollama model](https://ollama.com/library/qwen3.5:9b) is a practical larger local candidate for this RTX 4070 Ti 12 GB; this experiment does not establish a universally smartest model. Download size **6,594,474,711 bytes**, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, Ollama **0.34.1**. No subscription or cloud budget increase.

Annotations were fixed before inference: 24 distinct real cases across RAM, GPU, laptop and phone, plus one explicitly synthetic pairing for contradiction testing; ten cases held out. Annotation SHA-256 `0b9529460fb2a0ad0ed338d3fc559ada4eecc1d37feeaa7d328c690ce9bf789f`. No usable positive ECC photo was available, so that gate remains unverified.

Of 25 cases, **22 completed, nine fully abstained and three deferred while the GPU was busy**. At 8,192 context / 1,024 output cap / temperature zero, completed latency was **6.406 seconds median, 9.087 seconds p95, 9.126 seconds maximum**. All 34 layers offloaded; logs recorded 4,717.38 MiB CUDA model allocation, 256 MiB KV, 50.25 MiB recurrent state and compute buffers. These are allocations, not an independently sampled peak memory/power benchmark. `keep_alive=0` unloads the model; no model remained loaded after evaluation.

Strict field/value scoring: development **two correct, 19 missed, 16 mismatched/unsupported field matches**; held-out **zero correct, three missed, 22 mismatched/unsupported field matches**. Those mismatch counts include placeholders and wrong field placement, so they are not a hallucination count. Manual review nevertheless found real unsupported claims: Flare X5 read as X6, fabricated Intel laptop specifications from an AMD-labelled photo, and invented Samsung model/capacity from an unlabeled back.

**Acceptance failed. No production adapter or photo fact writer is enabled.** The existing collector paid-vision limit remains zero. Photos and evaluation artifacts stayed local. Schema validity and model confidence were not accepted as factual accuracy.

## Validation and remaining limits

- Final functional release: **405 tests passed, zero failed, 1,334 assertions across 46 files**; typecheck and production build passed. Installed merged runtime: 39 focused collector/sync/actionability/ownership/audit tests passed, typecheck passed, doctor passed. Doctor verifies installation paths/tools, not marketplace authentication.
- Regressions include the original long-description exclusion on both queues; long/full/truncated text; unchanged-page advancement; retry ownership, timeout and interruption; independent observation clocks and idempotent sync; exact comp routing; bounded unknowns with sparse/stale/mismatched evidence and crossing intervals; damaged/conflicting condition precedence; live-audit financing, port, display/core and Unicode failures.
- Production cold cutovers did include 20-second timeouts and one 502 earlier in this release session. Later health responses were sub-second. Do not claim every request remained fast or that a warm latency proves cold-start behavior.
- **Durable production backup remains blocked by physical space**, approximately 97 MB free despite reusable SQLite pages. No destructive cleanup or storage purchase was performed. Local restore-verified backups are not a substitute for a production-account backup.
- Yish's phone physically received the earlier test. Registration/service acceptance/display are separate from a **naturally matched useful deal**, which was not observed. No fabricated deal, seller message or laptop alert subscription was used.
- The laptop remains paused as instructed. A live failover takeover was not performed in this release. The desktop retains the existing five-minute fallback policy.

## Reproducibility artifacts

Private artifacts remain outside Git in `C:\Dev\filtrsoft-recovery-data`: `cohort-250-before.json`, `cohort-250-counterfactual-after.json`, `production-details-041.json`, `production-details-final.json`, `cohort-production-042-summary.json`, `cycle-48-summary.json`, `cohort-run-result.json`, `unicode-panel-verified.json`, full test logs and the `vision` evaluation directory. Runtime/startup receipts live in `C:\Dev\filtrsoft-runner-state`. Do not publish the private environment, database or browser profiles.

## Compatibility and controls

Server deployment must precede new collector snapshots carrying recovery receipts and independent photo timestamps. Existing v2 envelopes remain accepted; exact hashes/sequence acknowledgements retain replay protection. Desktop telemetry records new persisted listings separately from known search cards. Health comp attempt counts explicitly represent server-local attempts; desktop accepted comp uploads remain a different measurement. Local GPU inference is evaluation-only, with no production fact adapter enabled.
