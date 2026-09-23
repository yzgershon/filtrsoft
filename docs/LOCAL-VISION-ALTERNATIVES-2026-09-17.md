# Local vision alternatives researched September 17/18, 2026

## Decision and scope

The initial research below preceded Yish's explicit approval to download the candidate models, including models larger than the GPU's 12 GB VRAM. That approval now covers local model downloads for this comparison. Follow-up measurements are recorded in `LOCAL-VISION-OFFLOAD-2026-09-18.md`. The original Qwen failures do not establish that all local vision models fail, and published benchmarks do not establish Filtrsoft accuracy. No replacement runtime, collection setting or paid-vision configuration is changed by this experiment.

Initial local inspection found Ollama **0.34.1**, RTX 4070 Ti **12,282 MiB total GPU memory**, and the three previously evaluated Qwen models installed. The new downloads are recorded separately with full digests. The prior evaluation and immutable results remain in `LOCAL-VISION-FOLLOWUP-2026-09-17.md` and the private recovery-data directory. Available GPU memory varies with desktop applications; model download size is not runtime VRAM.

## Recommended first comparison

| Candidate | Published distribution | Why test it | Remaining uncertainty |
|---|---|---|---|
| **GLM-OCR 0.9B** | Official Ollama `glm-ocr:bf16`, about **2.2 GB** | Dedicated transcription baseline for printed model codes, RAM labels and hardware screens. Its small size permits full-precision weights. | Primarily document-trained; photographed hardware labels and unreadable negatives still need our test. Direct model calls are not the full layout-analysis pipeline used for published document results. |
| **PaddleOCR-VL 1.6 0.9B** | Official PaddlePaddle GGUF weights **936 MB** plus projector **882 MB**, about **1.82 GB** | Supports text recognition and text spotting, which can associate transcribed text with its image location. A useful alternative for tiny or angled labels. | Official docs support llama.cpp and Transformers; the Hugging Face distribution lists an Ollama route. Image/projector/template compatibility in installed Ollama must pass a smoke test. Do not install a replacement runtime without approval if it fails. |
| **Gemma 4 12B QAT** | Official Ollama `gemma4:12b-it-qat`, about **7.2 GB** | Independent general vision model for contextual interpretation and the same typed fact-extraction task. QAT means the model was trained to tolerate compressed weights. | Full GPU residence on this 12 GB card is plausible with bounded context but unverified. Google's launch guidance describes 16 GB configurations. Measure loaded VRAM, CPU offload, latency and factual errors; do not promise fit from file size. |

The first three model files total approximately **11.2 GB**, excluding small metadata and possible download staging. Yish approved downloading them and larger local candidates. Run inference sequentially using loopback-local requests, with the existing GPU-idle guard and unload behavior. No monthly service or API spending is required.

Sources: [GLM-OCR Ollama distribution](https://ollama.com/library/glm-ocr), [GLM-OCR architecture and pipeline](https://github.com/zai-org/GLM-OCR), [PaddleOCR-VL 1.6 model card](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6), [official Paddle weights and projector](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/tree/main), [Paddle supported runtimes](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PaddleOCR-VL.html), [Gemma QAT Ollama distribution](https://ollama.com/library/gemma4:12b-it-qat), [Google QAT model card](https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf), [Google 12B launch and memory guidance](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/). Checked September 18 UTC.

These recommendations are engineering judgments about task fit and deployment practicality. Manufacturer benchmark claims are not Filtrsoft accuracy measurements. In particular, document-parsing scores, reasoning benchmarks and our field-level precision are different metrics.

## Other credible alternatives reviewed

- **Ministral 3 8B / 14B:** independent vision family with official Ollama distributions around **6.0 / 9.1 GB**. Worth a later general-vision comparison; the 14B leaves less memory margin for photos and context. Neither is established as better at our exact labels. [Ollama](https://ollama.com/library/ministral-3), [Mistral vision documentation](https://docs.mistral.ai/studio/conversations/vision).
- **MiniCPM-V 4.5 8B:** official Ollama distribution around **6.1 GB**, with high-resolution image handling and OCR-oriented training. It uses a Qwen3 language backbone with a different vision system, so it is not simply the Qwen3-VL model already tested. The newer **4.6** is a much smaller 1.3B efficiency-oriented model; a newer version number alone does not establish greater accuracy. [4.5 distribution](https://ollama.com/library/minicpm-v4.5), [current project and 4.6 architecture](https://github.com/OpenBMB/MiniCPM-V).
- **InternVL3.5 8B:** different vision encoder and dynamic high-resolution handling, with a Qwen3 component. A plausible later comparison, but not the first independent architecture choice. Quantized Windows deployment needs separate validation. [Official model card](https://huggingface.co/OpenGVLab/InternVL3_5-8B).
- **GLM-4.6V-Flash 9B:** local-oriented general vision model; quantized deployment could be relevant. Its own card acknowledges perception/counting limitations and possible repetitive reasoning. It needs runtime/quantization validation before a specific install recommendation. [Official model card](https://huggingface.co/zai-org/GLM-4.6V-Flash).

## Why change the experiment, not just the model name

The previous `ocr-first` trial still used Qwen to perform both transcription and interpretation. It did **not** evaluate a dedicated OCR model. The prior region experiment added a fixed central crop; it was not a text/label detector. These are concrete gaps the new comparison can address without rewriting the earlier results.

Use dedicated OCR in its documented transcription/spotting mode. Preserve raw text, source photo hash and coordinates when available. Score transcription separately from mapping text into hardware fields. Deterministic parsers must retain exact suffixes, capacity, speed units and explicit kit/ECC wording. A general model's added interpretation must not supply missing printed evidence. Agreement between two models is not independent proof.

For Gemma, test documented image ordering, image-detail settings and decoding behavior on development cases before freezing the configuration. Do not assume every model accepts the same Qwen-specific request flags. Keep OCR-native and direct structured-output experiments labeled separately. Preserve full photos and all per-listing images when testing crops so conflicts remain visible.

The practical hypothesis is that dedicated transcription plus conservative field validation can recover printed evidence more reliably. It cannot reveal an unpictured laptop's installed RAM or a phone's unstated storage. General object/condition recognition would require a separately declared and evaluated scope.

## Evaluation protocol

1. Pin the downloaded artifacts/digests and smoke-test local image input, raw output, stopping behavior, CPU/GPU placement and unloading. Never auto-download missing dependencies.
2. Reuse the frozen 25-case development set and the eight-case previously tested holdout as historical comparison sets. The eight cases have now been inspected and must not be called a new untouched holdout.
3. Freeze each candidate's adapter, prompt, image preprocessing and parser. Then select and manually annotate a genuinely new held-out set before running inference, with exact photo hashes and every selected image retained. Include legible positives, tiny suffixes, kit/loose-stick distinctions, contradictory photos, logos without specs and unreadable negatives. Add explicitly printed positive ECC if available; otherwise disclose its exclusion.
4. Retain the original **at least 95% field precision, at least 80% recall, and zero unsupported identity/quantity/ECC facts** acceptance gates. Report per-field and per-case metrics, transcription errors, unsupported inferences, abstentions, errors, GPU deferrals, latency and measured memory. Failed cases are not successful abstentions. No general accuracy claim from a tiny sample.
5. Keep production photo writing off during evaluation. Any narrower proposed production scope needs its own declared coverage and acceptance test. A passing experiment would still require the provenance, idempotent sync, conflict, offline-job and gaming-pause checks already required by the project.

Research is complete and model-download approval is recorded. See the offload report for measured follow-up results and unresolved candidates. Collector operation and the laptop pause are preserved. These notes and the HANDOFF checkpoint are local documentation changes, not a new release or deployment.
