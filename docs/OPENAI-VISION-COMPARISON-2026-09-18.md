# OpenAI vision comparison, September 18, 2026

**Interpretation superseded by the September 18 [benchmark audit](VISION-BENCHMARK-AUDIT-2026-09-18.md).** The raw results below are preserved. Exact-string penalties, incomplete annotations and missing evidence/role validation make these aggregate scores unsuitable as factual-accuracy or hallucination rates. No model has newly passed; suitability needs a corrected benchmark and fresh validation. Do not use the old pass/fail labels alone to reject these models.

## Scope and authorization

Yish privately saved the API key and explicitly approved testing other OpenAI models. Testing retains the original **$5 total budget**, with no recurring paid production inference or production fact writes. The credential stays outside Git in the private collector data directory; it is not logged or included in results. Existing collector/database/profiles/identities and paused laptop are preserved.

The first Luna run used the already prepared $1 experiment ceiling. Additional tests share the same ledger, extended to the authorized $5 total. Every request durably reserves its model-specific worst-case token cost before sending; observed usage settles that reservation, and uncertain requests retain the whole reservation. A process lock prevents concurrent ledger writers. Five additional offline tests passed for per-model bounds, prior Luna spending, uncertain charges, invalid usage and the shared ceiling. No automatic paid retries or top-ups.

## Method

- Same audited development manifest, **25 cases / 29 original image requests / 41 expected fields**, SHA-256 `86096bb671dca21e49262ea490eb66c8aac65cc159a36836c327b0917b7227ae`.
- Frozen strict prompt `photo-eval-v3-strict`, SHA-256 `f7d6ac61c7c2c4abada5fd3216a62b8d05d0b927a956263cba0ae478bbb8b93c`; same Zod schema, reconciliation and exact field evaluator. Expected answers are never sent to the model.
- Responses API, standard service tier, `store=false`, no tools, 8,192 maximum output tokens including reasoning. Each original photo is sent separately; each case reconciles its photos afterward.
- GPT-5.6, GPT-5.4 and Astra use `detail=original`; GPT-4.1 mini supports `high`, not `original`, and uses its own documented internal image sizing. This model-dependent preprocessing is part of the comparison. [Image sizing documentation](https://developers.openai.com/api/docs/guides/images-vision).
- Reasoning models use `low` for the baseline; GPT-4.1 mini has no reasoning parameter. Request IDs, returned model names, usage, latency and raw structured responses are preserved privately.
- Strict precision measures complete expected values in the correct field; visible name fragments and extra qualifiers can fail that contract without being invented facts. Automated `unsupported` is a matching category, not proof of hallucination. Review source photos before describing individual errors.
- This is an already exposed development set, not a fresh holdout. Passing development alone does not authorize a production writer. Acceptance remains 95% precision, 80% recall and zero unsupported identity, quantity or ECC facts.

## Candidate prices

Standard USD per million tokens, verified from official documentation. Provider billing is authoritative; the ledger conservatively adds 25% to all input cost to cover cache writes where applicable.

| Model | Input | Cached input | Output | Documentation |
|---|---:|---:|---:|---|
| GPT-5.6 Luna | 0.20 | 0.02 | 1.20 | [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| GPT-5.4 nano | 0.20 | 0.02 | 1.25 | [5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano) |
| GPT-5.4 mini | 0.75 | 0.075 | 4.50 | [5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |
| GPT-4.1 mini | 0.40 | 0.10 | 1.60 | [4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) |
| GPT-5.6 Terra | 2.00 | 0.20 | 12.00 | [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| GPT-5.6 Sol | 4.00 | 0.40 | 20.00 | [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| GPT-6 Astra | 10.00 | 1.00 | 50.00 | [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) |

Older GPT-5 nano and mini were researched, but the current image guide marks them deprecated and scheduled for shutdown. The comparison prioritizes current candidates. Sol and Astra are quality reference points, not assumed cheap production choices. Reasoning tokens are included in output-token spending.

## Frozen-prompt baseline results

Each row completed all 25 cases / 29 image requests with zero HTTP, parser or truncated-response failures. Costs are for the complete 29-image run, not per image. Precision and recall use the unchanged strict field evaluator.

| Model / effort | Correct / missed / wrong | Precision | Recall | Median seconds/photo | Usage-based cost | Conservative cost |
|---|---:|---:|---:|---:|---:|---:|
| GPT-5.6 Luna / low | 23 / 18 / 7 | 76.67% | 56.10% | 2.966 | $0.02465 | $0.03422 |
| GPT-5.4 nano / low | 16 / 25 / 8 | 66.67% | 39.02% | 1.664 | $0.02332 | $0.03165 |
| GPT-5.4 mini / low | 21 / 20 / 10 | 67.74% | 51.22% | 2.497 | $0.09640 | $0.12832 |
| GPT-4.1 mini / no reasoning setting | 17 / 24 / 24 | 41.46% | 41.46% | 1.748 | $0.01980 | $0.02427 |
| GPT-5.6 Terra / low | 27 / 14 / 5 | 84.38% | 65.85% | 3.263 | $0.23392 | $0.32944 |
| GPT-5.6 Sol / low | 32 / 9 / 10 | 76.19% | 78.05% | 5.575 | $0.48767 | $0.67870 |
| GPT-6 Astra / low | 32 / 9 / 7 | 82.05% | 78.05% | 2.854 | $1.04942 | $1.52701 |

None passes the development gates with the original prompt. The seven baseline runs total 203 paid requests and $2.753608 conservative cost, with no unresolved reservations. The set is RAM-heavy, with 11 positive cases and 14 negative cases, and has no positive CPU, storage or ECC examples. Do not extrapolate these scores to all marketplace photos.

### What the errors mean

- Luna genuinely misread a Crucial label's 6000 MT/s as 5600 MT/s on one pass. GPT-4.1 mini also made unsupported hardware claims on unreadable photos; its low price does not compensate for that behavior here.
- All models sometimes omitted a readable brand or part of a marketing name. Exact matching counts these incomplete identities as wrong and the full identity as missed. This is a field-contract failure, not necessarily a fabricated product.
- Terra's five strict errors are three incomplete names, speed combined with the visibly printed CAS latency, and graphics-memory technology placed in a system-RAM field. They are not five proven hallucinations.
- Sol and Astra also transcribed an unselected 32 GB / 2 x 16 GB purchase option from a screenshot whose selected product is 64 GB / 2 x 32 GB. Those words are visible, but assigning them to the listed item would be wrong. Astra's other baseline errors were four incomplete names and a speed value containing CAS latency.
- GDDR7 on the small RTX 5070 box is a scope/legibility ambiguity in this annotation set. It is excluded from the system-RAM field contract; do not describe its extraction alone as a proven hallucination.

## Field-contract development experiment

The v4 prompt appends generic instructions to include visible brand and complete model identifiers, separate speed from CAS latency, keep graphics memory out of system-RAM fields, preserve printed module versus kit capacities, and exclude unselected shopping options. It contains no case identifiers, expected answers or product-specific examples. Original photos, expected annotations, reconciliation and evaluator remain frozen. Results from this prompt are development tuning, not independent validation.

Prompt SHA-256: `efecf9cebc87059ea8383bd215866d21d0e9860c59fd4ec3473dc6cd4f9fbfe9`. All four configurations completed 25 cases / 29 requests without transport, parser or truncation failures.

| Model / effort | Correct / missed / wrong | Precision | Recall | Median seconds/photo | Usage-based cost | Conservative cost |
|---|---:|---:|---:|---:|---:|---:|
| Luna / low | 29 / 12 / 5 | 85.29% | 70.73% | 2.547 | $0.02668 | $0.03677 |
| Luna / medium | 31 / 10 / 4 | 88.57% | 75.61% | 3.559 | $0.03106 | $0.04114 |
| Terra / low | 35 / 6 / 5 | 87.50% | 85.37% | 3.050 | $0.25363 | $0.35435 |
| Sol / low | 37 / 4 / 5 | 88.10% | 90.24% | 4.712 | $0.50747 | $0.70889 |

Sol recovers the most expected facts; Luna is much cheaper. None passes the unchanged strict precision threshold. One run per configuration does not establish the significance of small differences. Luna medium claimed readable installed RAM from the tiny Windows About image, whose text does not support a confident transcription at the source resolution. More reasoning did not remove that failure mode.

The v4 errors also reveal integration and benchmark limitations. Combining a visible manufacturer, series and GPU name may produce a semantically reasonable model value that does not match the expected separation into `model` and `gpu`. Sol's extra 16GB in the combined kit case comes from the printed `16GB x2` phrase, while the frozen annotation only expects the kit total and kit-layout field there. This is not evidence that the model invented the number. These ambiguities remain visible in the raw results; annotations and thresholds were not changed after inference to manufacture a pass. Strict scores should not be reported as literal hallucination rates, or as proof that API vision cannot work for Filtrsoft.

## Independent screening holdout

Selected the two newest unseen listings per available category with one to three saved photos, before looking at their images or running inference. Existing development and prior holdout listing IDs/URLs were excluded, and image hashes were checked against both sets. No eligible CPU listings were found in that query. One RAM listing was the same physical pair as the other, so it was excluded before inference, with the reason retained.

The resulting **nine listings / 17 original photos / 16 expected fields** span RAM, GPUs, storage, laptops and phone/accessory cases. Manual annotations were frozen at **14:53:44 UTC**, SHA-256 `0c1802bd909aaf08c4330198ce056d1761d3f503809bddc5fc0853b42ea2c6e1`. They include exact printed drive part numbers, actual module capacities without inferred kit totals, and negative cases without readable specifications. Listing titles are not sent to the models and are not photo evidence. Original full-resolution labels were reviewed when the contact sheet was insufficient.

This is a small independent screening set, with no positive CPU or ECC examples, not a production certification. Alternative assembly of visible marketing names can still fail exact matching. Report both strict metrics and source-photo error review; do not change annotations after seeing the holdout responses to manufacture a pass. Any subsequent tuning makes these exposed development cases for the next iteration.

All three finalists completed nine cases / 17 requests with the frozen v4 prompt and zero request/parser/truncation failures:

| Model / effort | Correct / missed / wrong | Strict precision | Recall | Median seconds/photo | Usage-based cost | Conservative cost |
|---|---:|---:|---:|---:|---:|---:|
| Sol / low | 13 / 3 / 8 | 61.90% | 81.25% | 6.980 | $0.30371 | $0.36414 |
| Terra / low | 11 / 5 / 8 | 57.89% | 68.75% | 3.944 | $0.15647 | $0.18669 |
| Luna / medium | 9 / 7 / 13 | 40.91% | 56.25% | 3.980 | $0.01902 | $0.02205 |

### Manual review of consequential holdout errors

- **Sol:** the RAM wide shot explicitly says 8GB on both modules, but one read claimed 16GB and dropped the B in the part number. The close-up then read 8GB and the complete part number. Raw results preserve both, including the conflict. Other strict errors include a correct part number prefixed with its visible brand, combined `DDR5 SODIMM`, and expanded but visible GPU/SSD marketing names. Those presentation differences are not fabricated hardware.
- **Terra:** changed SanDisk **Optimus** to **Optimum**, inserted an extra S into `SDSP51200TAN-000G1`, and assigned the rear packaging footnote **1TB** to a drive whose front says **2TB**. The footnote defines a terabyte; it is not this drive's capacity. This is an item-association failure even though the words are visible.
- **Luna:** read RAM part number `HMCG66AGBSA092N BA` as `HMCG64AGBSA092N BA`; changed a Seagate **Backup Plus** label to **Expansion**; transposed drive part number `1K9AP1-502`; and inserted the same extra S into the SSD identifier. It also placed an SSD transfer rate in the RAM-speed field. These are material failures for exact matching and valuation.
- Generic background iPhone text, raw RAM speed codes, naming extensions and combined type labels account for other strict-scoring failures. The reported wrong-field totals must not be described as counts of invented facts.

## Decision and next work

**No tested configuration is accepted for automatic fact ingestion.** This does not establish that OpenAI vision is unsuitable: the tests expose both genuine reading/association errors and weaknesses in the current extraction contract. Sol is the strongest measured coverage candidate; Luna is the inexpensive development candidate. Expensive Astra did not pass the original contract, and was not retested on the holdout. No claim is made that every possible model, effort or image strategy has been exhausted.

The next implementation experiment should address the measured failures: retain exact source-image evidence; use the clearest label view and compare other photos without silently resolving conflicts; distinguish the actual product from footnotes, compatibility text and other variants; and normalize equivalent presentation without changing part numbers, capacities or suffixes. Evaluate a grouped-photo approach separately from the present one-photo-per-request pipeline. Freeze that implementation before creating another untouched, broader holdout including positive CPU and ECC labels. Existing development and screening cases are now exposed and cannot be presented as fresh validation again.

## Final cost and operational receipt

At **15:03:05 UTC**, the final audit reconciled **14 complete reports, seven distinct models, 370 paid image requests and 370 distinct response IDs** against the ledger. Zero failed/truncated responses, unsettled charges or leftover process locks. Usage-based standard-price estimate **$3.23322216**; conservative settled total **$4.467635**, below the **$5** authorization. Provider billing is authoritative. The persistent guard has **$0.532365** remaining; do not reset it or treat the gap between estimated and conservative cost as a new budget. All adapters, manifests, requests and results retain hashes/receipts. No test process or local model remains running.

Production check at **15:03:11 UTC**: Gaming desktop remains primary and online, revision **`e73d18795a25`**, heartbeat **15:02:57 UTC**; collection rest interval **30 minutes**, fallback **five minutes**. Laptop is online but persistently **paused**. Local last error null, `visionLimit=0`, Ollama loaded-model list empty. The installed log ends with **job57** reporting Facebook/OfferUp/Mercari `ok`; its final OfferUp and Mercari batches each acknowledged **10 durable changes**. The installed collector checkout is clean. No configuration, database/profile/identity/startup reset, production photo writes, source-code deployment or recurring paid vision was enabled. Claude paths were not invoked or changed; their last independent verification remains the prior release checkpoint. This diagnostics endpoint does not expose both Claude switches.

Documentation and private evaluation adapters/results remain local, with existing local changes preserved. `HANDOFF.md` records this checkpoint.

## Private evidence

Private outputs are under `C:\Dev\filtrsoft-recovery-data\followup`. Each model gets a separate immutable result filename; the consolidated `openai-comparison-summary.json` is regenerated from saved responses. Original local-model outputs and failed thinking-mode attempts remain intact. Main receipts: `openai-comparison-final-audit.json`, `openai-holdout-freeze.json`, `openai-runtime-final.json`, persistent `openai-eval-budget.json`, per-run result files and `.traces.jsonl`. The credential file is outside this directory and was never copied into these artifacts.
