# Local vision and RAM offload evaluation, September 18, 2026 UTC

**Interpretation superseded by the September 18 [benchmark audit](VISION-BENCHMARK-AUDIT-2026-09-18.md).** Eleven of Gemma 26B's twelve audited-v3 wrong flags concern supported text, omitted annotations or field representation; one is a confirmed changed digit. The old scores do not establish broad model unsuitability. Preserve the raw evidence and runtime measurements below; a corrected benchmark and fresh validation are still required.

## Scope and authorization

Yish explicitly approved downloading candidate models, including larger ones that use system RAM in addition to the RTX 4070 Ti's 12 GB VRAM. This experiment uses installed Ollama 0.34.1 and the existing Bun/Node runtimes. It does not reinstall anything, write model facts into production, invoke paid vision, change collector scheduling, or unpause the laptop. Raw photos, answers and evaluation artifacts stay private under `C:\Dev\filtrsoft-recovery-data\followup`.

## What RAM offload means here

Ollama can place part of a model on the GPU and part in system RAM for CPU processing. This is supported behavior, not a memory allocation failure. It usually reduces speed; the unchanged model does not lose accuracy merely because some layers run on the CPU. Quantization, image processing, decoding configuration and insufficient context are separate potential accuracy effects. The 12 GB VRAM and 32 GB RAM are not one uniform 44 GB GPU memory pool. Windows, browsers, the collector, model execution buffers and context also need memory. Falling through to disk paging is a different, much slower condition.

The PC reported 31.09 GiB usable system RAM and about 16.16 GiB available before this experiment. GPU total is 12,282 MiB. Downloads run separately from sequential inference. Each request uses 8,192 context tokens and a 2,048-token output bound; large advertised maximum contexts were not enabled.

Sources: [Ollama CPU/GPU placement and memory controls](https://docs.ollama.com/faq), [context-length memory requirements](https://docs.ollama.com/context-length), [running-model allocation fields](https://docs.ollama.com/api/ps).

## Reproducibility and limits

- Download receipts: `alternative-model-downloads.json` and `larger-model-downloads.json`; existing Qwen files remain installed.
- Private adapter: `alternative-vision-run.ts`; same frozen 25-case development manifest and existing strict field evaluator. Four development cases form a separate smoke subset. This is not a new unseen holdout.
- The direct structured task uses the unchanged `photo-eval-v3-strict` prompt, temperature zero, JSON schema and `think=false`. These are controlled baseline measurements, not proof of each model's maximum performance after tuning.
- Dedicated OCR uses each model's native task prompt through `/api/generate`, not the hardware JSON prompt: GLM `Text Recognition:`; Paddle `OCR:`. Text recognition is not scored as equivalent to structured field extraction.
- Every original photo is retained and hashed. No expected answers were revised to fit a model's output. The evaluator separates unsupported values from field-placement and fragment errors.
- GPU-idle guard remains below 15% utilization and below 2,000 MiB used before inference. Free RAM is checked before and during requests; a pause or less than 2 GiB available aborts work. Errors, truncation and busy-GPU deferrals are failures, not successful abstentions.
- `keep_alive=0` unloads after each image. Reported per-image latency therefore includes model reload, image/prompt processing and generation; token-generation speed is reported separately. Resource figures are sampled every two seconds, not exact continuous peaks.
- Acceptance remains at least 95% strict field precision, at least 80% recall and zero unsupported identity, quantity or ECC facts. No candidate is accepted merely because it is larger or more conservative.

## Measured results

### Installed artifacts

| Model | Local artifact size, decimal GB | Quantization | SHA-256 manifest digest |
|---|---:|---|---|
| GLM-OCR | 2.219 | F16/BF16 distribution | `6effedd0dc8aec66ad86c94b8099395376e212f22c87a9d7147c422f7e447be4` |
| PaddleOCR-VL 1.6, official PaddlePaddle GGUF | 1.818 | BF16 | `db2f86a3a317cfaf26097507016dd8f9174a77f12a82cd79dc8528f95ab5059b` |
| Gemma 4 12B QAT | 7.151 | Q4_0 | `38044be4f923e5a55264ed7df4eaac2676651a905f735197c504045140c02bd3` |
| Gemma 4 26B-A4B QAT | 15.634 | Q4_0 | `2dd70431afed94dd3688d790443768c1487ed086b57147ff083851116ae4c4e4` |
| Mistral Small 3.2 24B | 15.177 | Q4_K_M | `5a408ab55df5c1b5cf46533c368813b30bf9e4d8fc39263bf2a3338cfa3b895b` |

Sizes are registry artifacts and may share blobs; they are neither required VRAM nor exact extra disk consumption. Sources: [Gemma 26B](https://ollama.com/library/gemma4:26b-a4b-it-qat), [Mistral 24B distribution](https://ollama.com/library/mistral-small3.2), [Mistral model card](https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506); smaller-model sources are in the alternatives note.

### Dedicated OCR diagnostics

**GLM-OCR:** all four smoke images failed to produce a complete usable response through `/api/chat`; the documented native `/api/generate` retry also failed all four. Results include HTTP 500 `prediction aborted, token repeat limit reached` and output-length truncation after repeated text. Native task prompt and documented deterministic sampling were used on the second attempt. No transcription accuracy score is claimed from these failures. Preserve `glm-ocr-smoke.json` and `glm-ocr-native-smoke.json` with their raw traces. Similar repetition/termination errors have been reported in the upstream [Ollama issue](https://github.com/ollama/ollama/issues/14117) and [GLM issue](https://github.com/zai-org/GLM-OCR/issues/220). A [still-open documentation proposal](https://github.com/zai-org/GLM-OCR/pull/239) suggests a code-fence stop sequence; that is not a demonstrated repair here and can truncate output. No runtime downgrade or replacement was installed.

**PaddleOCR-VL 1.6:** all four native OCR requests completed. Case wall times, including idle checks, were 23.177, 3.449, 3.351 and 2.944 seconds. It copied the Crucial package's 64 GB and 2 x 32 GB wording but read **6000 MT/s as 5000 MT/s**, and **FLARE X5 as FLAREX6**. It copied only `System | About` from the tiny screen and returned empty text for the Samsung negative. These are smoke diagnostics, not a structured-fact accuracy evaluation. Direct full-photo OCR is not accepted for automatic hardware facts. Source: `paddle-ocr-native-smoke.json` and traces. The full layout/crop pipeline remains untested.

### General vision models

Gemma 12B completed 25 cases / 29 images with no failed requests. Strict counts: **24 correct, 15 missed, 23 wrong**, including **14 unsupported** outputs. Precision **51.06%**, recall **61.54%**, 13 case-level abstentions. Median per-image latency **4.990 seconds**, median decoding **50.53 tokens/second**. Ollama reported **7.967 GB entirely GPU-resident** at 8K context; sampled whole-GPU peak **9,668 MiB**, minimum available system RAM **15.04 GiB**. It invented CPU, RAM, VRAM and storage values on an unreadable screen and generated a nonexistent part-number transcription. It fails the unchanged acceptance gates. Source: `gemma4-12b-development.json`.

Gemma 26B completed the same 25 cases / 29 images with no failed requests or RAM aborts. Strict counts: **20 correct, 19 missed, 13 wrong**, including **eight unsupported** outputs. Precision **60.61%**, recall **51.28%**, 15 case-level abstentions. It correctly abstained on the unreadable screen, but still generated unsupported model/quantity facts. It fails the unchanged acceptance gates.

Median per-image latency was **18.407 seconds**, including median model load **15.910 seconds**; median decoding **43.25 tokens/second**. Most of the extra latency in this unload-after-each-image experiment was reloading, not slow token generation. Keeping the model resident for a batch could reduce reload overhead, but warm-batch throughput and gaming coexistence were not measured. Ollama reported **15.862 GB allocated: 9.223 GB GPU + 6.638 GB outside GPU memory**, about 58%/42% GPU/CPU placement. Sampled whole-GPU peak was **11,886 MiB**, minimum available system RAM **9.16 GiB**. This is direct evidence that hybrid execution fits on this PC at the tested context. Source: `gemma4-26b-development.json`.

The earlier four-case 26B smoke run had two busy-GPU deferrals and two completed negative cases. Preserve that failed-run history in `gemma4-26b-smoke.json`; the full development run separately retried every case after the GPU became available. No guard was disabled.

| Same 25-case development set | Strict field precision | Recall | Unsupported outputs |
|---|---:|---:|---:|
| Prior Qwen3.5 9B strict | 43.75% | 53.85% | 14 |
| Prior Qwen3-VL 8B strict | 32.89% | 64.10% | 33 |
| Gemma 4 12B QAT | 51.06% | 61.54% | 14 |
| Gemma 4 26B-A4B QAT | 60.61% | 51.28% | 8 |

Historical Qwen values come from the preserved `vision-final-audit-v2.json`, using the same frozen annotations and evaluator. These are small development-set results; no general superiority claim or production acceptance follows. The eight previously exposed holdout cases were not relabeled as fresh evidence.

**Mistral Small 3.2 24B:** all four smoke requests completed, with **three correct, six missed and 12 wrong fields**, including 11 classified as unsupported; **20% precision / 33.33% recall on this four-case subset only**. Do not compare those percentages directly with the 25-case table. It read 6000 MT/s as 5600 MT/s, treated compatibility wording as installed CPU/GPU facts, guessed an EliteBook configuration on the unreadable screen, and emitted a brand as a model. The existing strict prompt explicitly prohibits those operations. A full 25-case run was not needed to establish that this configuration fails the zero-unsupported-identity gate. Source: `mistral-small32-smoke.json`.

Ollama reported **16.055 GB allocated: 9.350 GB GPU + 6.705 GB outside GPU memory** at 8K context. Per-image latency was **78.866, 30.945, 68.305 and 23.592 seconds**, median **49.625 seconds**. Median decoding **4.31 tokens/second**, median load **11.241 seconds**, sampled whole-GPU peak **10,914 MiB**, minimum available system RAM **11.33 GiB**. This dense model ran successfully but was much slower than the Gemma mixture-of-experts model under the tested hybrid placement. No RAM abort or request timeout occurred.

## Conclusion and next experiment

RAM offload is a viable option on this PC. Gemma 26B is the more practical larger candidate from this comparison, and improved strict precision over the earlier Qwen baselines, while sacrificing recall. No tested configuration meets the unchanged acceptance gates, so automatic photo-fact ingestion remains disabled. A model fitting in memory is not evidence that it identifies hardware reliably.

Potential follow-ups are a bounded Gemma 31B comparison and a proper OCR layout/label-crop pipeline with original-photo context and separate transcription/field-mapping scores. Neither is an established fix. Any tuned candidate needs a newly annotated untouched holdout before a production claim; the already exposed cases remain development/comparison data. No ECC-positive scope is validated. Original source photos, exact variants and unknowns remain authoritative.

The five approved candidate artifacts total **41.999 GB** before shared-blob accounting. They are retained for reproducibility and possible tuning, as are all existing Qwen models. No new monthly service or paid inference was used. The private consolidated result is `alternative-summary.json`; adapter SHA-256 **`6ad02871f662df5f8ce990ff01eb4a5159b4e884711f8e49a8c3baa2b138c7b9`**. Raw `.json`, `.partial` and `.traces.jsonl` files are retained, including failed attempts.

## Final operational verification

At **03:58:58 UTC**, local Ollama reported **no loaded models**. Production collector diagnostics showed Gaming desktop primary, online, revision **`e73d18795a25`**, last heartbeat **03:58:56 UTC**, five-minute fallback unchanged. Yishai XPS remained **paused** and was offline at that final snapshot. Desktop `visionLimit=0`, local last error null. Job54 completed with all three sources `ok` during the evaluation; the log records its last Mercari batch of **10 acknowledged durable changes**. No collector stop, runtime merge, database/profile/identity reset or startup change occurred. Existing paid-vision settings were not changed or invoked; this diagnostic endpoint does not independently expose both paid-path switches.

Receipt: `alternative-runtime-final.json`. These documentation changes are local in the follow-up checkout; no new release, push or deployment was performed for the model comparison.

## Further larger option

**Gemma 4 31B QAT**, published around 19 GB, is a plausible next hybrid CPU/GPU experiment with less RAM margin and more CPU work. It has not been downloaded or tested in this comparison. Do not infer fit, speed or better hardware-label accuracy from its file size. [Official distribution](https://ollama.com/library/gemma4:31b-it-qat).
