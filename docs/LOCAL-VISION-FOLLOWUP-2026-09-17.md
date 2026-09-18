# Local photo evaluation follow-up, September 17–18, 2026

## Decision

Production local photo fact ingestion remains disabled. None of the three tested models passed the original zero unsupported identity/quantity/ECC, 95% precision and 80% recall gates on development and fresh holdout. No paid fallback, new budget, or deployment scope was enabled. The 4070 Ti had sufficient capacity for all three measured models; failure is factual accuracy, with some additional idle-GPU deferrals. A larger model is not established as more accurate.

## Data and audit method

The original 25 cases and outputs remain immutable under the private OMEN recovery-data directory. Image hashes match their case mapping; case 12 was excluded in the original selection, so position-based joins after it are wrong. All evaluation joins use case IDs and image filenames. The original held-out cases were exposed during error analysis and are now development data.

Prompt `photo-eval-v3-strict` was frozen at 01:45 UTC. Afterwards eight previously unused real listings across RAM, GPU, laptop and phone were selected and manually annotated before inference. All 15 photos stored for those listings at selection were included; no silent failed-photo drop. Some listings acquired additional source photos later during collection; these are fixed snapshot evaluations, not a claim to have tested those later photos. Holdout manifest SHA-256: `0fe06336d6cd6189a4ccc06e65ba1bee5599f7a5a8081ffc1a73837caf47ddd7`. Seller titles/descriptions were not passed to the image model.

The seven-case OCR-first and full-image-plus-center-region trials were development experiments, not holdout scores. The region trial added a fixed center enlargement while retaining the full original; it was not an automatic label detector. Neither fixed the disputed negative cases. Full strict-prompt comparisons use the same 25 development cases and the same fresh eight holdout cases.

Original exact-string mismatches were not all inventions. The audit separates placeholders, repeated facts, field placement, supported fragments and genuinely unsupported values. Frozen expected facts were preserved for the final comparison. Visible but misplaced labels still count against field precision. Cosmetic evaluation corrections accept literal (R)/(TM) markers and spaces before MB, without collapsing model suffixes, capacities, units or ECC. The same corrected evaluator was applied to all saved outputs: that rescoring is not new extraction. Each failed/GPU-deferred case retains all expected misses and is not a successful abstention. One bounded retry of deferred strict cases was also GPU-deferred; no idle threshold was bypassed.

## Measured results

Precision and recall count field/value facts, not whole-case accuracy. Unsupported counts below are unique unsupported field/value claims per case after manual placement review, including repeated mistakes in the synthetic conflict case.

| Run | Cases | Precision | Recall | Unsupported | Abstained | Failed/deferred | Median / p95 seconds | Peak total GPU MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| original-baseline | 25 | 12.0% | 7.7% | 11 | 10 | 3 | 6.41 / 9.09 | not captured |
| qwen35-ocr-strategy | 7 | 34.1% | 53.8% | 11 | 0 | 0 | 14.45 / 62.11 | 8711 |
| qwen35-context-strategy | 7 | 33.3% | 38.5% | 14 | 0 | 0 | 6.31 / 33.62 | 8705 |
| qwen3vl-4b-development-strict | 25 | 43.6% | 43.6% | 5 | 18 | 2 | 4.62 / 11.39 | 7525 |
| qwen35-9b-development-strict | 25 | 43.8% | 53.8% | 14 | 13 | 0 | 6.73 / 16.67 | 8761 |
| qwen3vl-4b-fresh-heldout | 8 | 38.5% | 50.0% | 5 | 3 | 1 | 11.32 / 15.35 | 7483 |
| qwen35-9b-fresh-heldout | 8 | 46.2% | 60.0% | 6 | 3 | 1 | 14.57 / 20.24 | 8507 |

GPU figures are sampled total device memory including background applications, not isolated model allocation. Latency covers completed cases and can include multiple photos. No out-of-memory failure was observed. Every retained new completed HTTP trace has stop reason `stop`; old HTTP/stop metadata was never saved, so historical truncation cannot be reconstructed. New truncation/HTTP errors are retained and fail the case rather than becoming an empty success.

## What the mistakes actually were

- **Flare X5 → X6:** the G.SKILL label says X5. The old 9B run and the strict 9B run changed the suffix to X6. This is a real model error, not a normalizer mismatch.
- **AMD laptop photo → Intel machine:** the image shows an AMD Ryzen palm-rest badge and a tiny unreadable spec display. ThinkPad X1 Carbon / Intel i7-1260P / 16GB / 512GB are not established by it. OCR-first also invented a different Intel CPU instead of fixing the evidence.
- **Samsung logo → exact phone/capacity:** the original negative supplied only the Samsung logo. Galaxy S21 5G / SM-G991B/DS / 8GB / 256GB were unsupported. New strict runs abstained on that negative, but retained other fatal errors.
- **Real text, wrong field:** printed AMD EXPO/Intel XMP compatibility is not an installed CPU/GPU. Corsair RAM branding beneath an EVGA GPU is not the GPU model. EVGA110 REV 1.0, the Corsair box sticker 781021 and ACX text are visibly present; they were separated from invented specifications rather than counted indiscriminately as hallucinations.
- **Kits and sticks:** printed 64GB / 2×32GB and 32GB / 2×16GB controls improved under the strict prompt. Two photographed loose sticks do not prove a printed matched kit. Fresh holdout still produced inferred quantity/kit claims and misread suffixes. The synthetic conflicting-kit pair retains both images and produces conflicts rather than choosing a convenient total.
- **Unsupported ECC:** both strict models emitted non-ECC despite no printed non-ECC statement. A RAM part code/rank such as RC0/1Rx4 does not establish explicit ECC evidence under this extraction contract. Positive explicitly printed ECC was not available; ECC is excluded from any validated scope. No scope was approved for deployment.
- **Fresh positives and negatives:** the Lenovo About screen explicitly supports i5-1335U, 16GB, 238GB displayed storage, Iris Xe, 128MB and 3200MT/s. Typography errors were rescored consistently. Closed Apple devices/phone backs provide no printed generation or storage and both models abstained on those fresh negatives. Fresh GPU mistakes still included an invented 4GB and dropped/changed manufacturer suffixes.

## Per-field strict comparison

C/M/W = correct/missed/wrong. A dash means no denominator, not a pass.

### qwen3vl-4b-development-strict

| Field | C / M / W | Precision | Recall |
|---|---:|---:|---:|
| model | 2 / 12 / 10 | 16.7% | 14.3% |
| ram | 4 / 2 / 0 | 100.0% | 66.7% |
| kitLayout | 4 / 1 / 0 | 100.0% | 80.0% |
| memorySpeed | 3 / 1 / 1 | 75.0% | 75.0% |
| memoryType | 3 / 3 / 0 | 100.0% | 50.0% |
| cpu | 0 / 0 / 6 | 0.0% | — |
| gpu | 1 / 2 / 3 | 25.0% | 33.3% |
| ecc | 0 / 0 / 2 | 0.0% | — |
| vram | 0 / 1 / 0 | — | 0.0% |

### qwen35-9b-development-strict

| Field | C / M / W | Precision | Recall |
|---|---:|---:|---:|
| model | 3 / 11 / 13 | 18.8% | 21.4% |
| ram | 5 / 1 / 3 | 62.5% | 83.3% |
| memorySpeed | 4 / 0 / 2 | 66.7% | 100.0% |
| memoryType | 4 / 2 / 1 | 80.0% | 66.7% |
| kitLayout | 5 / 0 / 1 | 83.3% | 100.0% |
| ecc | 0 / 0 / 2 | 0.0% | — |
| quantity | 0 / 0 / 2 | 0.0% | — |
| gpu | 0 / 3 / 1 | 0.0% | 0.0% |
| vram | 0 / 1 / 0 | — | 0.0% |
| cpu | 0 / 0 / 1 | 0.0% | — |
| storage | 0 / 0 / 1 | 0.0% | — |

### qwen3vl-4b-fresh-heldout

| Field | C / M / W | Precision | Recall |
|---|---:|---:|---:|
| model | 1 / 5 / 7 | 12.5% | 16.7% |
| ram | 2 / 1 / 0 | 100.0% | 66.7% |
| memorySpeed | 2 / 1 / 0 | 100.0% | 66.7% |
| memoryType | 0 / 1 / 2 | 0.0% | 0.0% |
| ecc | 0 / 0 / 1 | 0.0% | — |
| kitLayout | 0 / 0 / 1 | 0.0% | — |
| quantity | 0 / 0 / 1 | 0.0% | — |
| gpu | 1 / 2 / 2 | 33.3% | 33.3% |
| vram | 2 / 0 / 0 | 100.0% | 100.0% |
| cpu | 1 / 0 / 2 | 33.3% | 100.0% |
| storage | 1 / 0 / 0 | 100.0% | 100.0% |

### qwen35-9b-fresh-heldout

| Field | C / M / W | Precision | Recall |
|---|---:|---:|---:|
| model | 3 / 3 / 6 | 33.3% | 50.0% |
| ram | 3 / 0 / 0 | 100.0% | 100.0% |
| memorySpeed | 2 / 1 / 1 | 66.7% | 66.7% |
| kitLayout | 0 / 0 / 1 | 0.0% | — |
| memoryType | 0 / 1 / 1 | 0.0% | 0.0% |
| quantity | 0 / 0 / 1 | 0.0% | — |
| gpu | 1 / 2 / 0 | 100.0% | 33.3% |
| vram | 1 / 1 / 2 | 33.3% | 50.0% |
| cpu | 1 / 0 / 1 | 50.0% | 100.0% |
| storage | 1 / 0 / 1 | 50.0% | 100.0% |

## Reproducibility and limits

- Ollama 0.34.1 already installed; official [Qwen3-VL 4B Instruct](https://ollama.com/library/qwen3-vl:4b-instruct) downloaded under the existing explicit approval. Yish subsequently approved the official [Qwen3-VL 8B Instruct](https://ollama.com/library/qwen3-vl:8b-instruct) 6.1 GB download, which completed; its frozen comparison is below.
- Qwen3.5-9B digest: `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`. Qwen3-VL-4B Instruct digest: `ee4b975b58c17ce268cd19d40db35d5edc64603035d2ffc1fee1968eb0947f7b`.
- Loopback-only runtime, pinned installed digest, original photo hashes, deterministic temperature, schema, raw HTTP output, stop reasons/token counts, per-image timings, conflict fields and GPU samples are retained privately. `keep_alive:0` unloads each request; paused/busy GPUs defer rather than force inference.
- Private evidence: `C:\Dev\filtrsoft-recovery-data\followup\vision-final-audit.json`, corresponding raw result/trace files, development and holdout manifests, and `final-vision-audit.ts`. Never commit private photos or account exports.
- Tiny sample, snapshot photos, strict typed extraction and GPU-deferred cases limit coverage. No strongest-model claim, generalized production accuracy, ECC validation, or natural recommendation result follows from this experiment.

## Approved 8B comparison, 02:35 UTC

The same prompt, development annotations and pre-existing fresh holdout were used without further tuning. No new software, paid API, or production writer was enabled. All 25 development cases completed. Two holdout cases were GPU-deferred and remain failures, not abstentions. This larger model also failed factual accuracy, not demonstrated VRAM capacity.

| Split | Cases | Precision | Recall | Unsupported | Abstained | Failed | Median / p95 seconds | Peak total GPU MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| qwen3vl-8b-development-strict | 25 | 32.9% | 64.1% | 33 | 13 | 0 | 8.00 / 21.33 | 10154 |
| qwen3vl-8b-fresh-heldout | 8 | 19.0% | 40.0% | 23 | 3 | 2 | 22.68 / 26.82 | 10058 |

8B digest: `0533d74300e4f9bc367d675d4e64ffd073d50ff16a2b4096cc2e8a1cf8c96319`. All completed retained traces ended with `stop`; no out-of-memory failure. GPU guard was unchanged even after competing applications were paused. Original results and `vision-final-audit.json` remain intact; the uniformly audited three-model comparison is `vision-final-audit-v2.json`.

### qwen3vl-8b-development-strict: per-field results

| Field | C / M / W | Precision | Recall |
|---|---:|---:|---:|
| model | 5 / 9 / 14 | 26.3% | 35.7% |
| ram | 5 / 1 / 1 | 83.3% | 83.3% |
| kitLayout | 5 / 0 / 0 | 100.0% | 100.0% |
| memorySpeed | 4 / 0 / 12 | 25.0% | 100.0% |
| memoryType | 4 / 2 / 2 | 66.7% | 66.7% |
| cpu | 0 / 0 / 11 | 0.0% | — |
| ecc | 0 / 0 / 5 | 0.0% | — |
| quantity | 0 / 0 / 2 | 0.0% | — |
| gpu | 1 / 2 / 2 | 33.3% | 33.3% |
| vram | 1 / 0 / 1 | 50.0% | 100.0% |
| storage | 0 / 0 / 1 | 0.0% | — |

### qwen3vl-8b-fresh-heldout: per-field results

| Field | C / M / W | Precision | Recall |
|---|---:|---:|---:|
| model | 0 / 6 / 14 | 0.0% | 0.0% |
| ram | 2 / 1 / 1 | 66.7% | 66.7% |
| memorySpeed | 1 / 2 / 2 | 33.3% | 33.3% |
| memoryType | 0 / 1 / 2 | 0.0% | 0.0% |
| gpu | 2 / 1 / 10 | 16.7% | 66.7% |
| vram | 1 / 1 / 1 | 50.0% | 50.0% |
| cpu | 1 / 0 / 2 | 33.3% | 100.0% |
| storage | 1 / 0 / 1 | 50.0% | 100.0% |
| ecc | 0 / 0 / 1 | 0.0% | — |

No model meets the original gates. The 8B results do not establish it as the smartest option for this task; the 9B and 4B runs also remain far below acceptance. All three models remain installed for reproducibility, but the production fact writer remains disabled.
