# GPT-6 Luna versus Gemma 31B on the frozen photo baseline, September 22–23, 2026

## Decision

**No single model passes the unattended photo-fact gates** (95% precision, 80% recall,
zero unsupported sensitive facts). The measured best arrangement is **two independent
readers that must agree**: GPT-6 Luna at reasoning effort **high** plus the installed
**Gemma 31B** (`gemma4:31b-it-qat`). On this development set their agreement kept
**134 claims, 100% source-supported, zero unsupported** (usable recall 56.5%).
Single-reader output is suitable only as a visibly unverified suggestion.

- **Luna effort: `high`.** Quality rises steeply from `none` to `high`; `xhigh` is not
  better; `max` adds about two points of precision and recall at 2.8x the cost and 3.3x
  the latency, from one non-deterministic run each. Under the agreement design `max`
  changes little (58.7% vs 56.5% recall, both 100% supported).
- **Luna alone is not safe.** On sideways or upside-down label text it invents whole
  products that are not in the photo, at every effort (details below). Gemma's
  errors are digit-level misreads of text that is really there.
- **Nothing is enabled in production.** Luna needs an operating budget that is not
  approved, and a fresh untouched holdout must pass before any fact writer.

## What was run

- Frozen September 18 baseline: 100 listings, 222 original photos, manifest SHA
  `50c60337f8b92560c9011d32eb0039517542dc56125811b14ab2ef8255cd163d`, prompt SHA
  `41669d58ff7c5b368c104a3f1880d4fea49aff956963083cee5a6c1c4503487d`, same logical
  schema, no titles or IDs sent. Primary cohort: **91 fresh core listings / 230
  required facts** (same exclusions as September 18).
- Luna: `gpt-6-luna`, Responses API, `store:false`, no tools, no retries,
  `detail:"original"`, all photos of a listing in one request. Efforts `none`, `low`,
  `medium`, `high`, `xhigh`, `max`, 100 listings each, one run each. `none` at
  temperature 0; Luna rejects `temperature` with any reasoning effort
  (`Unsupported parameter`), so reasoning runs use provider sampling. A 29-case
  default-temperature `none` run and a 2-case probe are kept separately as exploratory.
- Gemma 31B and Haiku 4.5: the September 18 outputs on the same inputs (not rerun).
- Scoring: the September 18 scorer and summarizer, unchanged; it reproduces the
  published Gemma and Haiku figures exactly.

## Results (fresh core, 91 listings / 230 required facts)

| Configuration | Source-supported | Usable precision | Raw recall | Usable recall | Unsupported | …sensitive | p50 | p95 | Tokens in / out / reasoning per listing | $ per 1,000 listings |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| Gemma 31B QAT (OMEN, cold load per listing) | 95.4% | 90.4% | 80.0% | 77.4% | 6 | 6 | 79.3 s | 184 s | local | $0 API |
| Haiku 4.5 | 76.6% | 54.6% | 73.9% | 60.4% | 59 | 46 | 1.7 s | 3.0 s | — | $4.71 |
| Luna `none`, temp 0 | 81.9% | 70.8% | 67.4% | 61.3% | 39 | 31 | 2.8 s | 9.3 s | 6,261 / 114 / 0 | $0.54 |
| Luna `low` | 92.8% | 86.5% | 76.5% | 72.2% | 12 | 9 | 5.0 s | 42 s | 6,261 / 268 / 158 | $0.76 |
| Luna `medium` | 94.3% | 89.0% | 77.8% | 73.5% | 10 | 8 | 7.8 s | 34 s | 6,261 / 537 / 427 | $0.90 |
| **Luna `high`** | 93.3% | 92.0% | 83.5% | 81.3% | 12 | 9 | 10.1 s | 24 s | 6,261 / 864 / 748 | **$1.04** |
| Luna `xhigh` | 93.4% | 90.7% | 80.4% | 78.7% | 12 | 10 | 31.8 s | 69 s | 6,261 / 1,519 / 1,403 | $1.39 |
| Luna `max` | 95.8% | 93.6% | 84.3% | 83.5% | 7 | 6 | 32.9 s | 112 s | 6,261 / 4,604 / 4,486 | $2.93 |

Costs are standard-rate estimates from observed usage ($0.10/M input, $0.01/M cached,
$0.50/M output incl. reasoning; cache writes reported separately and billed at $0.125/M in
the ledger). Gemma latency is the September 18 cold-load protocol while the collector and
remote desktop ran; it is not warm throughput. Local energy was not measured.

### Two-reader agreement (a claim is kept only if both readers give the same field and value)

| Readers | Kept claims | Source-supported | Unsupported (sensitive) | Usable recall |
|---|---:|---:|---:|---:|
| Luna high ∧ Gemma | 134 | 100.0% | 0 (0) | 56.5% |
| Luna max ∧ Gemma | 140 | 100.0% | 0 (0) | 58.3% |
| Luna high ∧ Luna medium | 174 | 99.4% | 1 (1) | 70.0% |
| Luna high ∧ Luna max | 192 | 98.4% | 2 (2) | 74.3% |
| Luna high ∧ Luna xhigh | 187 | 98.4% | 3 (3) | 73.0% |

Agreement within one model family repeats the same misreads (`HFS512GD9TNG-620A`,
`JC403`, GeForce RTX for a printed GTX). Cross-model agreement removed every
unsupported claim here. Exact-string agreement loses correct facts written
differently (`DDR4-3600` vs `3600`), so recall can rise with field-aware normalization;
that is future development work, not measured here.

## Failure modes that matter for Filtrsoft

1. **Phantom products on rotated labels (Luna).** The photos carry no EXIF (marketplaces
   strip it), so sideways labels reach the model as taken. A diagnostic sent the four
   affected photos at 0/90/180/270 degrees (development only, `rotation-diagnostic/`):
   when the text is upright Luna reads it correctly even at `none` ("SanDisk Ultra SDHC
   16 GB", "SanDisk X400 SD8SN8U-256G-1012 256GB", "KIOXIA KBG50ZNS512G 512GB"); when it
   is sideways or upside down Luna invents GeForce RTX 2060, GTX 760, Radeon RX 7900 XTX,
   AORUS boards and Ryzen CPUs with OPN codes, **even at `high`**. In the main runs this
   produced G.SKILL Flare X5 on a Patriot kit, Ryzen CPUs and an RTX 3060 Ti on a KIOXIA
   SSD photo, a 6TB Ultrastar on a 500GB laptop drive and an Intel Xeon (`max`).
2. **Prompt-example contamination (Luna `none`).** "Flare X5", the prompt's own example
   family, appeared with a real G.SKILL part number on unrelated photos.
3. **Digit-level misreads (all models).** Exact part numbers lose, gain or transpose
   characters (`62A0A`→`620A`, `JCD403`→`JC403`, `HAHQ`→`HAJQ`). Exact identifiers must
   be corroborated before they drive valuation.
4. **Role and field placement.** Kit totals as module capacities, GPU names in the
   model field, background roles for the item's own specifications. The evidence schema
   records these as supported-but-unusable rather than invented.

## Measured provider facts (verify again before relying on them)

- Model access `GET /v1/models/gpt-6-luna` = 200 with the key in
  `C:\Dev\filtrsoft-data\openai-eval.env`. The key is **not** in `collector.env`.
- `detail:"original"` accepted. **Image tokens = 535 + 1.2 per 32×32 patch + 1 per image**
  (least squares over 100 listings, maximum residual 1.7 tokens). The images guide does
  not list Luna; this is measured.
- Account rate limit **200,000 TPM** (429 bodies), below the documented tier-1 figure.
  The runner paces a sliding window and treats `rate_limit_exceeded` as not billed.
- `usage.input_tokens_details.cache_write_tokens` is reported; repeated identical images
  were served from cache in later runs.

## Budget and receipts

- Approval: $5.00 hard cap for this benchmark (Yish, 2026-09-22). Separate SQLite ledger
  `C:\Dev\filtrsoft-recovery-data\followup\luna6-20260922\ledger.sqlite`, scope
  `gpt6-luna-benchmark-2026-09-22`. The September 18 GPT-5.6 Luna ledger was not touched.
- Every request reserved its worst case inside an IMMEDIATE transaction before sending.
  Final: **665 settled calls, $0.902 settled (conservative)**; 4 calls interrupted by an
  operator stop kept as uncertain at their full $0.262 reservation; 52 HTTP 429
  rejections released with the saved provider body as evidence. Committed total
  **$1.164 of $5.00**. Provider billing is authoritative.
- Private artifacts: per-case outputs, raw redacted responses, `run.json` per effort,
  `score-progress.json`, `summary-final.json`, `review-queue.json` (empty),
  `luna6-adjudications.ts`.

## How claims were reviewed

Every Luna claim was decided by one of: an existing September 18 decision (exact claim);
transfer from an identical reviewed claim (field, value, role, image, quote, completeness);
auto-grounding against frozen reference evidence (agrees with the September 18 manual
review on **339/339** claims it would accept); or manual source review of the original
photos, blind to effort, under the September 18 rules. References touched by a source
correction were excluded from auto-grounding. A LPX mark and tiny macOS storage digits
were left **unresolved** rather than forced. One notes-only decision (case 66) was
checked against the photo and corrected, which lowered every Luna effort that made it.
This is single-reviewer adjudication, not an independent panel. The set is now exposed
to four readers and cannot serve as acceptance evidence again.

## Recommended rollout (needs Yish's approval)

1. **Shadow mode** (no verdict effect): Luna `high` reads the photos of listings whose
   deciding unknown is a spec or identity (about 47% of fresh listings). Store results
   with provenance; show them in the detail view labelled "read from photo, unverified".
   Estimated **$0.26/day at ~250 listings/day (≈$8/month)**, hard daily cap suggested
   $0.50, using `src/ai/spend-cap.ts` (`utc-day` window).
2. **Verification**: Gemma 31B re-reads only listings where the Luna reading would change
   a call, during GPU-idle windows (existing idle guard). Facts where both agree become
   candidate facts; conflicts stay visible.
3. **Acceptance**: freeze a fresh, balanced, untouched holdout (including positive CPU
   and ECC labels and rotated labels) and require the unchanged gates before any writer.

## Other workloads

| Workload | Choice | Evidence / reason |
|---|---|---|
| Deterministic extraction (capacities, CPU/GPU names, price tiers, negations, scam patterns) | Code | Existing parsers; this pass added spelled-out phone numbers and trip-worthy VERIFY (engine 0.3.48) |
| Image transcription and spec extraction | Luna high + Gemma agreement, shadow first | This report |
| Seller-text interpretation, bundles, inventories | Code | No frozen text benchmark with Gemma exists; not measured, not adopted |
| Identity candidates and resolution | Code resolver + catalog | Models must not supply identities without catalog and comp validation |
| Condition, lock and risk evidence | Code (text); photos unmeasured | Damage from photos needs its own evaluation |
| Prices, arithmetic, access control | Code only | Never delegated to a model |
