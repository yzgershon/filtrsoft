# Fresh Haiku 4.5 / Gemma 31B baseline

## Result

**Completed September 18, 2026. Gemma 4 31B QAT performed better on this printed-evidence extraction task, but neither configuration passes the existing unattended-ingestion gate.** This is a comparison of these exact model/integration configurations, with the schema-adapter and source-review limitations described below. It is not an overall intelligence ranking or a validation of the previous production Haiku prompt.

Both providers completed 100 requests using the same 222 input photo files. The primary comparison contains **91 fresh core listings and 230 required facts**, after uniformly excluding five possible prior-photo matches and separating four exploratory console/watch listings. All 615 distinct pooled claims were adjudicated; no unreviewed claims remain. Optional brands are excluded from the primary claim metrics.

| Primary metric | Gemma 4 31B QAT | Haiku 4.5 |
|---|---:|---:|
| Source-supported assertions / all assertions, including partial and unresolved | 208/218 (95.4%) | 206/269 (76.6%) |
| Conditional support, excluding partial/unresolved | 208/214 (97.2%) | 206/265 (77.7%) |
| Fully usable assertions / all assertions | 197/218 (90.4%) | 147/269 (54.6%) |
| Required facts read, including raw schema-failed responses | 184/230 (80.0%) | 170/230 (73.9%) |
| Required facts from schema-valid responses | 184/230 (80.0%) | 168/230 (73.0%) |
| Required facts with usable evidence | 178/230 (77.4%) | 139/230 (60.4%) |
| Unsupported non-brand assertions | 6 | 59 |
| Of those: sensitive spec/code/count claims | 6 | 46 |
| Of those: model identities | 0 | 13 |
| Partial / unresolved assertions | 2 / 2 | 3 / 1 |
| Listings with an unsupported non-brand assertion | 4/91 | 32/91 |
| Schema-valid responses, all requests | 100/100 | 98/100 |

“Unsupported” means unsupported under the frozen **literal printed-evidence** instruction. It includes definite misreads and unprinted inferences, some of which could be true in ordinary object recognition. It does not mean every such answer is a fabricated real-world fact. The raw-reading rows above do not punish correct text merely for a wrong role, field or photo citation; the usable rows do.

Gemma meets the raw 95% conservative support and 80% recall point thresholds here, but has six unsupported sensitive assertions and only **90.4% usable precision / 77.4% usable recall**. Haiku also fails. The zero-unsupported-sensitive requirement remains unchanged. A small assistant-reviewed sample is not proof of future error rates, and these are point estimates rather than certified accuracy.

### Concrete findings

- Gemma read the SK hynix RAM part number in case 79 and Apple case code in case 81 correctly where Haiku changed characters. It also preserved exact phone capacities without substituting available free space in the final phone cases.
- Gemma's six unsupported sensitive assertions occur in four listings: case 11 misread RAM part-number characters; case 19 wrong part number, a SKU substring mistaken for 48 GB capacity, and 8GBx1 read as RGB x 1; case 76 misread receipt code; case 85 physical count of three boxes despite the printed-count-only rule.
- Gemma also read some text correctly but assigned it incorrectly: SSD model in GPU, battery mAh in storage, or a part-code suffix in the RAM field. These are recorded as source-supported but unusable, not invented text.
- Haiku's failures were broader: exact-code substitutions, unprinted specifications and models, role errors, plus six invalid photo references. Case 76 asserted ASUS/Vivobook and capacities inconsistent with the Lenovo receipt. Its two schema failures are separately confounded by the SDK adapter, not evidence of intrinsically poorer formatting.
- Gemma missed the cable model in the phone-and-cable bundle (97), and other required details. Abstention helps precision but does not erase missing-fact penalties.

### Runtime and cost, all 100 requests

| Measurement | Gemma | Haiku |
|---|---:|---:|
| Wall time | 2 h 21 m 53 s | 3 m 9 s |
| Median request | 79.30 s | 1.75 s |
| 95th-percentile request | 183.97 s | 3.04 s |
| Median decode | 2.43 tokens/s | Not measured |
| Median cold load | 18.38 s | N/A |
| Median prompt processing | 6.52 s | N/A |
| API charge | $0; local electricity not measured | **$0.4705** |
| Runtime failures | 0 | 0; two response-schema failures |

Gemma ran under the frozen cold-load-per-listing protocol while the collector and remote desktop continued. This is not warm throughput. RAM offload worked: Ollama reported 19.11 GiB total model allocation, of which 8.07 GiB was on GPU and approximately 11.04 GiB outside GPU. The 211-sample window from 19:00:56 to 20:46:23 UTC recorded a minimum 5.33 GiB free RAM, maximum 11,747 MiB total GPU memory used, 75 C GPU temperature and 222.98 W GPU power. Sampling began after the initial cases; these are sampled extrema, not guaranteed whole-run peaks. No RAM guard triggered. Ollama was unloaded at the final check.

Haiku used 385,690 input and 16,962 output tokens. All 100 ledger entries settled; no retries and no uncertain reservations. Its $2 lab cap was respected. No OpenAI requests were made and its existing budget was not reset.

### Supplemental cohorts

| Cohort | Model | Supported / all | Usable precision | Raw recall | Usable recall |
|---|---|---:|---:|---:|---:|
| All 100 | gemma | 95.8% | 91.1% | 80.7% | 78.3% |
| All 100 | haiku | 77.1% | 55.5% | 74.7% | 61.0% |
| Fresh 95 including exploratory | gemma | 95.5% | 90.6% | 80.4% | 77.9% |
| Fresh 95 including exploratory | haiku | 76.8% | 55.1% | 74.5% | 60.9% |

### Fresh core categories

These small category subsets are descriptive, not independent acceptance tests.

| Category | Listings | Required facts | Gemma raw / usable recall | Haiku raw / usable recall |
|---|---:|---:|---:|---:|
| storage | 16 | 43 | 79.1% / 72.1% | 67.4% / 65.1% |
| ram | 14 | 68 | 88.2% / 88.2% | 77.9% / 64.7% |
| bundle | 2 | 13 | 30.8% / 30.8% | 61.5% / 53.8% |
| laptop | 19 | 44 | 93.2% / 90.9% | 70.5% / 40.9% |
| accessory_bundle | 1 | 3 | 66.7% / 66.7% | 100.0% / 100.0% |
| desktop | 3 | 6 | 83.3% / 83.3% | 66.7% / 66.7% |
| gpu | 16 | 31 | 71.0% / 64.5% | 71.0% / 61.3% |
| accessory | 7 | 7 | 85.7% / 85.7% | 85.7% / 57.1% |
| phone | 13 | 15 | 66.7% / 66.7% | 93.3% / 80.0% |

### Recommendation

Keep Gemma as the leading local candidate. This result does not support dismissing it as too weak; it supports improving field/role validation and exact-code handling before unattended use. Treat Haiku as a candidate requiring its own integration/prompt work, not an automatic truth source.

For the next experiment, normalize schema enforcement across providers, preserve source-supported text separately from validated product facts, and evaluate changes on another untouched holdout. If fine-tuning follows, use source-verified development labels; neither candidate's outputs are gold. Do not train on this baseline and then cite its reused score as fresh evidence. Broader condition, lock and risk analysis needs a separate evaluation. No training or production enablement was performed here.

## Frozen experiment

- Private artifacts: `C:\Dev\filtrsoft-recovery-data\followup\fresh-baseline-20260918`.
- Manifest SHA256: `50c60337f8b92560c9011d32eb0039517542dc56125811b14ab2ef8255cd163d`.
- 100 distinct listings, 222 original photos, all available photos for each listing (1–6). Twenty listings were selected deterministically from each original database category before candidate outputs. Actual image content sometimes belongs to a different category.
- Original reference set: 250 required facts. Source review removes one unsupported arithmetic total, leaving **249** across all 100 cases. Other corrections change text, not counts.
- Actual categories: 17 storage, 14 RAM, 16 GPU, 22 laptop, 14 phone, 3 desktop, 2 bundle, 7 accessory, 1 accessory bundle, 2 console and 2 watch listings. Console/watch cases 53, 57, 96 and 100 are exploratory and separated from the core score.
- No standalone CPU cohort or positive printed ECC case. Those capabilities remain unvalidated.
- Exact printed hardware extraction is the task. This does **not** validate broader condition, lock, fraud or valuation judgments.
- Both candidates receive identical original image bytes, the same prompt and logical schema, with no listing titles, IDs, reference answers or other metadata. Native provider image processing can differ.
- Prompt SHA256: `41669d58ff7c5b368c104a3f1880d4fea49aff956963083cee5a6c1c4503487d`.
- References were annotated by the assistant from images before inference. They are not certified exhaustive human gold.

## Freshness evidence and limitations

Selection excluded prior local test IDs, source URLs, exact image hashes, perceptual dHash distance <=4 and normalized duplicate titles.

A current owner snapshot at **18:31:03 UTC** passed footer, stream-hash and table-count checks. All 100 selected listing IDs were present, with **zero overlap against 1,849 recorded production vision reads**. This closes the earlier snapshot history gap. The latest recorded production read was still 01:40:35.623 UTC. See `freshness-current-snapshot.json`.

The image-level check found perceptual hashes for 4,723 of 5,727 historical photos attached to production-read listings. Using the production cubic-resize algorithm, 17 distance <=4 candidates appeared across cases **38, 47, 67, 80 and 89**, including two distance-zero matches. All five are conservatively excluded from the primary fresh score for both candidates, independent of their results.

Report all 100 requests as a supplement, **95 potentially fresh listings**, and **91 fresh core listings** after separating the four exploratory cases. Hash similarity is not proof of an identical image. The 1,004 unhashed historical photos, changed crops, unrecorded historical requests and undisclosed pretraining exposure cannot be ruled out. Fresh means no observed exposure under these checks, not a pretraining guarantee.

## Candidates and operating conditions

| Setting | Gemma | Haiku |
|---|---|---|
| Model | `gemma4:31b-it-qat` | `claude-haiku-4-5-20251001` |
| Context | 16,384 | Provider context |
| Max output tokens | 4,096 | 4,096 |
| Temperature | 0 | 0 |
| Thinking | Off | Off |
| Request deadline | 15 minutes | 5 minutes |
| Automatic retries | None | None |
| Placement | Existing OMEN, GPU/RAM split | Anthropic API |
| Between cases | Cold load/unload | Independent requests |

Gemma digest: `e0812a55773bfeac846b2d605b4d93638b8dfa7119d9587f3d91475afc78185e`. Existing Ollama reports 0.34.2. The existing remote-desktop baseline exception allows up to 65% GPU utilization with under 2 GB VRAM before the first load. Start requires at least 3 GiB free system RAM; abort below 2 GiB; `pause-gpu` is honored. Production collector guards were not changed.

Haiku has an isolated **$2 cap**. The ledger reserves the full 200k input context plus maximum output before each call and settles measured token usage; uncertain charges remain reserved. Rates are $1/M input and $5/M output. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). Lab spending is separate from Filtrsoft's production spend display.

A 30-second RAM/GPU sampler began after the initial cases. Its extrema describe the sampled window, not whole-run peaks. Per-case latency includes cold loading and actual simultaneous collector/remote-desktop conditions; it is not a warm-model throughput benchmark.

## Review and scoring rules

**Schema-adapter limitation discovered during review:** installed Anthropic SDK 0.120.0's `zodOutputFormat` moves enums, string lengths, numeric bounds and maximum array length into descriptions. Ollama received the original constraints as strict JSON schema. Both received the same logical contract, but native enforcement was not equivalent. This can contribute to Haiku's invalid field enum and empty quotes. Those two failures are integration outcomes, not clean proof of inferior model formatting ability. Raw factual scores retain their readable content. `schema-adapter-audit.json` saves both actual schema shapes. This run compares these exact model/integration configurations, not perfectly isolated model capability. No runner, SDK, model prompt or payload was changed after discovery.

Original inputs, candidate outputs and reference manifest remain immutable. `source-corrections.json` records uniform source fixes; `adjudications.ts` records every reviewed claim and its reason.

Confirmed reference corrections:

1. Case 1: 16 GB, not 8 GB.
2. Case 4: VENGEANCE, without an unprinted LPX suffix.
3. Case 10: `PVVR548G600C30K`, including the missing R. Printed `24GBx2` gives module size and explicit count; 48 GB was not printed and is removed as a required total.
4. Case 50: 9100 PRO with Heatsink, not the mistyped 9110.

Valid extra facts get credit even when absent from the initial references. A final contract audit removed five inappropriate penalties for complete printed CPU/GPU family names (24, 25, 66 twice and 78); the frozen prompt explicitly permits complete families. This gives family-level credit only, never an exact unprinted SKU. Original-resolution review also resolved the Pavilion word in case 66 for both providers. All changes are logged in adjudications.ts. Tiny unresolved text remains unresolved, not automatically false. Sensible combined fields and aliases are reviewed against the original source. Printed module size, kit total and installed system RAM remain distinct. Arithmetic totals and guessed specifications are not accepted.

Review displays pooled claims without provider labels where possible. Most Haiku responses finished before Gemma, so timing and available-only review can reveal which provider supplied a new claim. This is a **single-assistant source review with imperfect blinding**, not an independent human panel.

Report separately:

- **Source-supported text:** value can be verified in the supplied photos, regardless of a wrong field, role, quote or photo citation.
- **Unsupported:** the asserted value is absent, wrong or inferred beyond the printed evidence.
- **Partial/unresolved:** incomplete identity or source ambiguity, shown separately from definite errors.
- **Usable evidence:** supported value, correct field/role/evidence and valid response schema.
- **Raw semantic recall:** required facts present even in a schema-invalid response.
- **Pipeline semantic recall:** raw supported facts from schema-valid responses.
- **Usable recall:** required facts with valid evidence and schema.

Brand claims are optional and excluded from primary precision. Identical claims and reviewed aliases deduplicate across photos; a later valid citation can rescue the same fact's earlier invalid citation. Every individual evidence defect remains recorded. Different roles remain distinct. Recall counts each required fact once.

Conditional source-supported precision excludes partial/unresolved cases from its denominator and must not be presented alone as overall accuracy. Conservative support and usable precision retain them in the denominator. Missing-reference cases are not proof that a photo contains no possible readable facts.

Existing acceptance requirements remain **95% precision, 80% recall and zero observed unsupported sensitive facts**. Report usability, raw reading quality and unsupported model identities separately. A favorable subset or valid JSON alone does not authorize production use.

## Validation and live boundary

- Existing evaluator: 18 tests / 39 assertions passed.
- Lab budget: 2 tests / 5 assertions passed.
- New offline scoring: 9 tests / 29 assertions passed, covering duplicate evidence ordering, invalid image references, raw vs pipeline schema failure, aliases, role separation, unresolved sources and unique recall.
- Runner imports/syntax validated without model calls. Runner hash is recorded in each provider's `run.json`.

Final collector check at **20:47:28 UTC**: Gaming desktop remained primary and online, heartbeat 20:47:25.063, no error, desktop visionLimit=0; XPS remained paused/offline; fallback grace remained five minutes. Existing collector checkout e73d18795a25 stayed clean. Both production paid paths were rechecked off; production spend stayed $1.9024 and last read stayed 01:40:35.623 UTC. No model remained loaded.

## Reproducibility and state

- Final private receipts: score-final.json, measurements-final.json, input-integrity-audit.json, collector-final.json, schema-adapter-audit.json, the two provider directories, source-corrections.json and adjudications.ts under the private artifact root above.
- Every original photo hash still matches. Both providers' 100 per-case photo orders/hashes match the manifest. Runner SHA256 remains 5a7f9bb15af326d7727ed622ab7f9206407872a86234f79c01696cfb2f6aab36.
- Offline scorer deduplicates exact claims and supported aliases, keeps different roles separate, and lets valid later evidence rescue an identical earlier bad citation. Tests cover these behaviors and raw-vs-pipeline schema failures.
- Both inference processes and the resource sampler completed. No automatic rerun is needed. Preserve the immutable inputs and outputs.
- Collector DB, identity, outbox, profiles, launcher and local commits were preserved. Production vision remained disabled. No training, installation, reset, deployment, push or recurring paid path was introduced.

