# Evidence recovery release — September 17, 2026

## Plan and release gates

1. Freeze a 250-listing four-source cohort and a restore-verified, isolated database. Preserve original facts, all recorded blockers and provenance. Record new source reads separately.
2. Replace length-based detail eligibility with shared evidence routing and durable content-aware retries; preserve independent observation clocks and upload receipts.
3. Give recovery bounded, sequential capacity alongside discovery and availability; retain profile ownership, checkpoints and retry budgets.
4. Improve factual text extraction, exact demanded sold queries, rejection telemetry and conservative bounded decisions. No relaxed matching or invented specifications.
5. Evaluate local vision only after model approval, with annotations and acceptance gates fixed first. Keep the production writer disabled unless factual gates pass.
6. Run regressions, full tests, typecheck and build; audit the frozen cohort. Push the tested combined release, verify CI/container and Railway receipts, then maintenance-stop, back up and update the existing OMEN runtime. Verify cycles, acknowledgements and scoring before declaring completion.

## Baseline milestone

- Isolated development branch `codex/evidence-recovery-20260917`, base `526de337b0de6588582f6fe41ff0ff68b9c5fd7e` (engine 0.3.38).
- Actual runtime remains `4acecefff1fbd786872d9ba9f760e0db6e842e52`, including Mercari panel fix and desktop setup ancestry. No runtime reset or installation.
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

The new engine scored the exact same 250 listings against the frozen database: **250 remain INSUFFICIENT_DATA, zero valued transitions, zero new recommendations, zero retirements**. No fresh source reads or comp imports are included. Per-listing score latency was p50 1.47 ms, p95 24.04 ms, maximum 159.38 ms. Recovery selection took 65–98 ms per source on this desktop snapshot; of 40 selected per source, 33 Facebook, 11 Mercari and 20 OfferUp descriptions exceeded the former 40-character cutoff. This demonstrates repaired eligibility, not successful evidence recovery. Fresh collection results must be recorded separately.

## Compatibility and controls

Server deployment must precede new collector snapshots carrying recovery receipts and independent photo timestamps. Existing v2 envelopes remain accepted; exact hashes/sequence acknowledgements retain replay protection. Desktop telemetry records new persisted listings separately from known search cards. Health comp attempt counts explicitly represent server-local attempts; desktop accepted comp uploads remain a different measurement. Local GPU inference is evaluation-only, with no production fact adapter enabled.
