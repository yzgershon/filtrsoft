# Vision benchmark audit, September 18, 2026

## Finding and corrected conclusion

Yish challenged the poor scores across both local and OpenAI models. The audit confirmed substantial defects in **what the test measures**. The previous aggregate pass/fail interpretation was too strong. These results do not establish that Qwen, Gemma, Luna, Terra or Astra are inherently unsuitable for Filtrsoft.

The legacy numbers remain reproducible measures of matching a particular field/value answer key. They are **not reliable factual-accuracy or hallucination rates**. The grader penalizes supported partial text and different representations, assumes incomplete annotations are exhaustive, and never validates evidence quotes or photo attribution. Some genuine misreads remain. Neither those failures nor the grading defects justify declaring any model production-ready.

**Status:** audit complete. Follow-up: the [corrected local-model development retest](LOCAL-VISION-FAIR-RETEST-2026-09-18.md) is now complete with an evidence-aware evaluation module; fresh holdout acceptance remains outstanding. The original grader, manifests, prompts and raw model responses were not overwritten. This document supersedes categorical model-rejection language in earlier evaluation notes. It does not change the 95% precision, 80% recall, or zero unsupported identity/quantity/ECC requirements, and it does not enable a photo writer.

## Scope and evidence

Read the evaluator, schema, prompt, reconciliation and local/cloud adapters; inventoried three annotated datasets; reviewed source photos and saved claims; applied the same explicit value-review rules to **17 saved development reports**; and ran **10 offline characterization probes** against the original evaluator. No new inference, API spending, model download, production fact write or deployment occurred.

Private evidence directory: `C:\Dev\filtrsoft-recovery-data\followup`.

| Artifact | What it establishes |
|---|---|
| `benchmark-audit-inventory.json` | Case/image dimensions, SHA-256 hashes, expected facts and duplicate photographs for development and two earlier holdouts |
| `benchmark-claim-catalog.json` / `.txt` | 212 distinct case/field/value claims across 17 development reports, with saved quotes and image references |
| `benchmark-review-rules.mjs` | Explicit, model-independent rules for the reviewed values; no blanket acceptance of unreviewed outputs |
| `benchmark-error-adjudication.json` | Original metrics plus retrospective classification of old wrong flags; **not replacement accuracy scores** |
| `benchmark-audit-reproductions.json` | Ten confirmed demonstrations of the original scorer's limitations |
| `benchmark-integrity-audit.json` | 578 image/hash checks across 17 reports, zero mapping mismatches; Gemma 31B timing and stop reasons |
| `benchmark-ollama-log-excerpts.txt` | Existing runtime evidence for Gemma renderer/parser, visual token processing and context handling |
| `benchmark-audit-quote-followup.json` | Astra's quoted 32GB option disambiguates the value-only review; Sol's shorter quote remains ambiguous |
| `benchmark-audit-runtime-final.json` | Read-only production/collector receipt at 15:25:59 UTC |

The retrospective rules review values, not every character in every quote, nor every previously accepted claim. Unreviewed outputs stay unreviewed. No adjusted headline precision was calculated by simply moving old errors into the correct column.

## 1. Matching defects, with executable demonstrations

The relevant implementation is `src/vision/evaluation.ts`, especially `evaluateFacts`. Normalization handles casing, whitespace, some units and kit notation. Correctness otherwise requires exact normalized text in the expected field. Unlisted outputs default to `unsupported`; a recognized `fragment` still adds one wrong output and leaves the full expected value missed.

| Reference / situation | Model output | Legacy result | Appropriate interpretation |
|---|---|---|---|
| `DDR5` and `SODIMM` in memory type | `DDR5 SODIMM` | 0 correct, 2 missed, 1 unsupported | Both facts transcribed; combined representation needs parsing |
| `G.SKILL Flare X5` | `Flare X5` | Wrong and missed | Supported family, omitted brand; incomplete identity is distinct from fabrication |
| `HMCG66AGBSA092N BA` | `SK hynix HMCG66AGBSA092N BA` | Unsupported | Correct part number with visible brand; prompt actually asks for brand |
| `CP32G60C40U5W.M8B1` | `CP32G60C40U5W` | Unsupported | Supported prefix, incomplete exact SKU; never promote it to the complete variant |
| `6000MHz` | `6000MHz CL30` | Unsupported | Printed speed plus printed timing; original prompt did not define separate CAS fields |
| Package explicitly says `16GB x2`; gold includes only 32GB total | `16GB` module capacity | Unsupported | Annotation omission; the text is visible |
| Expected capacity with fabricated evidence quote | Correct capacity | Perfect score | False acceptance: quote content is ignored |
| Correct value assigned to the wrong photo | Correct capacity, wrong image | Perfect score | False acceptance: reference format and grader do not check photo provenance |

The last two probes matter as much as the false penalties. Merely making string matching more permissive would make this test easier without making it trustworthy.

`src/vision/local-lab.ts::reconcileReads` also calls any two different values within one field a conflict. Consequently 64GB kit total plus 32GB per module becomes a RAM conflict, and a product name plus its own part number becomes a model conflict. The schema has no entity or capacity role with which to distinguish these legitimate pairs from actual contradictory claims. The scorer does not validate the reported conflicts.

## 2. Answer-key and prompt problems

- **Inconsistent capacity annotations.** The Crucial 64GB / 2x32GB case includes both total and per-module capacity. The Corsair 32GB / 16GBx2 case includes only total capacity despite the equally explicit module size. Printed module count two is also omitted. Models receive unsupported-quantity penalties for transcribing an explicit count.
- **Unstated item-selection rule.** The original prompt asks to transcribe visible hardware specifications and preserve contradictory values. An Amazon screenshot includes a selected 64GB / 2x32GB item and a visible unselected 32GB / 2x16GB option. The answer key silently excludes the latter. The selected-item rule only became explicit in prompt v4. Extracting those words is correct OCR but unsafe listing attribution; both should be measured separately.
- **Quotes can resolve some ambiguity.** A bare 32GB value might be the selected per-module capacity or the alternative kit total. Astra's actual quote is `32GB (2 x 16GB)`, establishing the alternative option. Sol quotes only `32GB`, leaving that claim ambiguous. The initial value-only audit intentionally did not use quotes; the supplemental receipt records this refinement. Neither is proof that the model invented the number.
- **Arbitrary combined names.** Some labels require brand, family and technology as one exact name, while other gold values are part numbers without brand. The prompt asks for complete printed models including brand. Expanding a correct name can therefore fail one case while being required in another.
- **No partial-identity representation.** The schema cannot distinguish “these characters are readable, suffix unknown” from an assertion that a short code is a complete exact SKU. That limits both fair grading and safe downstream use.
- **No entity roles.** Printed compatibility text, selected product, alternative options, per-module capacity, kit total and background signage need explicit associations. Flat text fields cannot fully express the intended distinction.
- **Annotation absence is treated as proof of falsity.** Manual gold is not exhaustive, as the omissions show. An unlisted claim needs source review before being called fabricated.

## 3. Measured effect on earlier conclusions

These are classifications of the old **development wrong flags**, not corrected scores or fresh validation. Reused-photo flags are not independent mistakes.

| Saved run | Old wrong flags | Audit findings |
|---|---:|---|
| Astra, original prompt / low | 7 | Four supported but shortened names; one printed speed-plus-timing representation; two claims from the visible unselected option. No invented text confirmed among these seven flags. This does not validate all accepted claims or exact-identity completeness. |
| Terra, original prompt / low | 5 | Three shortened names; one speed-plus-timing representation; one GDDR7 scope/legibility question needing review. Not five proven hallucinations. |
| Luna, original prompt / low | 7 | Four shortened names; one speed-plus-timing representation; one GDDR7 question; **one confirmed 6000 to 5600 MT/s misread**. |
| Gemma 26B | 12 | Four representation differences, three annotation omissions, three partial identities, one field-assignment difference, **one confirmed Flare X5 to X6 misread**. |
| Gemma 31B | 3 | Two occurrences of the same correct but incomplete Crucial part-number prefix; one exact CPU claim that cannot be validated from the 261-pixel source. The CPU claim remains unusable evidence. |

Astra, Terra, Sol and baseline Luna each returned no asserted fields on **all 14 annotated negative development cases**. Gemma 26B did so on 14/14 and Gemma 31B on 13/14. The aggregate field score hides this useful behavior. The source annotations themselves still need the stronger audit described below.

The Qwen runs were included in the same 17-report review, not excluded after criticizing the local models. Many Qwen flags remain unadjudicated; no claim that Qwen now passes is supported. All model families deserve evaluation under a consistent corrected rubric.

Real failures from the earlier OpenAI screening holdout also remain relevant: an 8GB module was read as 16GB in a wide shot; exact drive/part-number characters changed; and a 1TB definition footnote was assigned to a 2TB drive. A format correction must not forgive those errors. Per-photo union also loses an opportunity for a clear close-up to resolve an ambiguous wide view, so listing-level evidence handling needs its own evaluation.

## 4. Dataset and runtime limitations

### The development set is not broad evidence of product accuracy

- **25 cases, 29 image occurrences, only 27 distinct photo hashes.** Thirteen occurrences have a short edge below 400 pixels, including 261x261 marketplace thumbnails. These are original saved files, not necessarily original camera-resolution photos. No decoder can reliably recover text that the source does not establish.
- **41 expected field values: 32 from RAM cases, seven GPU, two laptop.** RAM accounts for 78% of the denominator. There are no positive CPU, storage, phone-identity or ECC annotations in development.
- **Eleven expected values, 26.8% of the denominator, are in a synthetic contradictory-kit case reusing two photos already present separately.** This is useful stress material, but it must not be weighted as independent marketplace coverage. Related Flare X5 photos add further subject correlation.
- Fourteen negative cases versus eleven positive cases makes abstention important, but says little about extraction across all needed hardware classes.
- The later OpenAI holdout has nine listings, 17 images and 16 target values; it remains too small and lacks positive CPU/ECC cases. It is now exposed. Reusing it after tuning is development, not fresh validation.
- No confidence interval or category-specific adequacy supported the earlier categorical model-rejection language. Fixed pass thresholds alone do not establish that the tiny sample estimates general reliability.

### No evidence of a general broken image transport

**578 saved image/hash checks across 17 reports found zero mapping mismatches.** Source inspection shows those image bytes are serialized in the requests. This establishes saved-file/request association, not the providers' internal pixel processing or subjective legibility.

Gemma 31B's 29 saved image responses all ended with `stop`; maximum reported prompt tokens were 1,390 against an 8,192 context setting. Reviewed Ollama log excerpts show Gemma4 renderer/parser selection, variable visual token batches and `truncated=0` on the displayed requests. A nominal `image_size=224` log field does **not** prove a 224-pixel-only input: the same log declares image pixel bounds 161,280–2,580,480 and processes variable-sized visual embeddings. No wrong-template or universal-truncation defect was established.

Earlier cloud reports recorded 370 successful requests with no transport, parser or response-truncation failures. This audit did not send another request or rerun the provider-side execution.

### Timing and configuration must be described honestly

- Local baseline requests disable thinking; most cloud baselines use low reasoning effort. These are named configurations, not each family's maximum capability. Gemma 31B thinking trials timed out or deferred before a completed evaluation; they do not establish failed thinking-mode accuracy.
- Local `keep_alive:0` unloads the model after each photo. Gemma 31B median end-to-end latency is **28.470 s**, median reported loading **19.226 s**. Median per-request time after subtracting its own reported load is **7.767 s**. The latter is neither a measured warm benchmark nor a guaranteed production latency; it demonstrates that cold loading dominates the reported timing.
- One photo per inference is a legitimate controlled task but differs from evaluating all views of a listing together. Grouped-view inference remains untested.
- GPU deferral lowers aggregate recall despite no model answer. That is valid as end-to-end coverage accounting; it must be reported separately from factual accuracy conditional on completed inference. A deferred or failed request is never a successful abstention.

## 5. Required fair retest contract

Use the exposed images to develop the repaired contract; freeze it before selecting an untouched validation set. Do not lower thresholds to make favored models pass.

1. **Separate three tasks:** literal transcription, assignment to the correct object/variant, and conversion into normalized Filtrsoft facts. Report separate errors and end-to-end usable facts. Product safety still depends on the complete pipeline.
2. **Annotate source evidence per image and object.** Record hash, region, exact visible text, readability, entity, semantic role, completeness and explicitly allowed cosmetic aliases. Separate brand, family and part number; RAM generation and form factor; kit total, module capacity and explicit count. Preserve unknowns and exact suffixes.
3. **Distinguish supported partial from complete and incorrect.** Partial identifiers earn only partial-transcription coverage; they cannot satisfy an exact-SKU gate. Different digits, capacities, ECC claims and meaningful suffixes remain errors. Count each semantic fact once and report partial coverage separately rather than creating easy extra correct facts.
4. **Verify evidence and attribution.** A correct-looking value with a fabricated quote, wrong image, wrong item, compatibility-only mention or definition-footnote source fails grounding. Differences among legitimate roles are not conflicts. Genuine conflicts stay unresolved until valid evidence resolves them.
5. **Treat unlisted claims as review-needed.** Independently inspect their source without model names before deciding whether they are supported, unsupported or genuinely unreadable. Ambiguity remains explicit. Include previously accepted claims in the review, not just old wrong flags.
6. **Freeze balanced positives and negatives.** Include clear CPU/GPU/RAM/storage/phone/laptop labels, positive ECC and non-ECC evidence, exact suffixes, kits versus loose sticks, same-family variants, option selectors and true conflicts. Group duplicate hashes and same-listing views into one split; score synthetic stress cases separately. Report category denominators and uncertainty; untested classes are unvalidated.
7. **Measure realistic image access without inventing detail.** Retain actual source files. Compare full-view input with reproducible label crops plus context, recording coordinates and hashes. Any recovered higher-resolution source is a new input condition, not an invisible change to old results. Grouped-photo inference is a separate controlled experiment.
8. **Separate resource and accuracy results.** Report failed/deferred/completed counts, negative-case abstention, cold load and warmed latency. Record model digest, prompt/schema versions, thinking/effort, context and image processing. Keep GPU-idle guards; warm tests must not reinterpret memory already occupied by their own model as unrelated gaming load.
9. **Recheck old outputs offline first, then rerun local candidates.** Re-annotation is a retrospective audit, not improved model extraction. Once the rubric is frozen, retry Gemma and Qwen under comparable settings and use a newly annotated, untouched holdout for acceptance. Broader API retests must respect the existing budget ledger.

At audit completion this contract was not implemented. The linked follow-up now implements the evidence-aware development grader and completes three local retests; broader, untouched holdout validation remains outstanding. The original ten probes characterize old defects; their passing means the defects were reproduced, not repaired. The follow-up's 18 regression tests verify the new evaluator separately.

## 6. Budget, operations and continuation

- No new model requests or paid spending in this audit. Existing ledger: **370 settled calls**, **$4.467635 conservative total of $5**, **$0.532365 guard headroom**. Provider billing remains authoritative. Do not reset or replace the ledger.
- At **15:25:59 UTC**, production showed Gaming desktop primary and working on job58, revision `e73d18795a25`, heartbeat **15:25:52 UTC**, five-minute fallback. Laptop was online but **paused**. Local last error was null, `visionLimit=0`, and Ollama had no loaded models. This receipt does not independently expose both Railway Claude switches; they were not changed or invoked here.
- Collector database, profiles, identities, outbox, launcher and local commits were preserved. The installed runtime checkout has no audit code changes. Earlier raw results and downloads remain intact.
- This work consists of private audit receipts and local documentation changes in `C:\Dev\filtrsoft-followup-20260917`. No release, push or deployment is claimed.

**Next step after the completed follow-up:** use a newly frozen, untouched and more balanced holdout to evaluate safe evidence-to-fact handling. Gemma 31B leads the development screening; no automatic writer is accepted. The old score still does not establish categorical model unsuitability.
