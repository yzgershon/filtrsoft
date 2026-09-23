# Gemma vision fine-tuning feasibility and fresh comparison

## Request and current boundary

Yish requested a full fresh-image comparison of Haiku 4.5 API and the installed Gemma 4 31B QAT, then explicitly asked to wait and investigate training Gemma with Astra first. This session researches that option. **No new comparison inference, training, paid requests, installation, download, cloud job or production change has started.** Resume the comparison after resolving this training discussion. The installed collector and paused laptop are preserved.

## Findings

**Specializing Gemma is technically supported. Perfect performance is not established or guaranteed.** Google's [vision QLoRA guide](https://ai.google.dev/gemma/docs/core/huggingface_vision_finetune_qlora) describes image/text training with frozen quantized base weights and a smaller trainable adapter. Training can target evidence extraction, attribution, output structure and abstention. It cannot establish an identifier absent from the supplied pixels. Treat improved exact-character recognition as a hypothesis to measure, not an automatic consequence of fine-tuning.

The published example is a product-description demonstration, not validation for exact hardware labels. Use the processor/tokenizer matching the chosen checkpoint; its sample includes an E2B processor name even when the model selector offers larger variants. Preserve the matching image processing and chat template and verify loss masking. Do not paste a generic text-only training recipe into this vision task.

### What runs where

| Step | Proposed tool | What it does |
|---|---|---|
| Prepare examples | Astra plus source review | Draft structured facts with photo evidence, find uncertain labels, write validation code |
| Train | Unsloth or Transformers/TRL/PEFT | Learn adapter weights from reviewed image/answer pairs |
| Export and verify | Compatible merger, quantizer and vision exporter | Preserve processor, image projector, template and end-of-turn behavior |
| Serve locally | Existing Ollama, under a new model name | Run the resulting inference artifact after validation |

Ollama's [import documentation](https://docs.ollama.com/import) describes consuming Safetensors/GGUF weights. A Modelfile or system prompt alone does not constitute weight training. The current installed `gemma4:31b-it-qat` stays an immutable baseline; no in-place replacement. Google's compatible [unquantized QAT checkpoint](https://huggingface.co/google/gemma-4-31B-it-qat-q4_0-unquantized/tree/main) is published separately and is about 62.6 GB on disk. Its existence does not prove the chosen training/export recipe works on this host. Quantized loading can reduce residency, but merging/exporting has separate memory requirements.

Unsloth documents Gemma fine-tuning and GGUF export, but a successful export still needs image-based parity checks in the actual Ollama runtime. A language-only smoke test would miss a broken image projector. Re-quantization can change results; test the final deployed artifact, not just its training checkpoint. [Unsloth Gemma guide](https://unsloth.ai/docs/models/gemma-4/train)

### OMEN memory assessment

- This PC has a 12 GB RTX 4070 Ti and 32 GB system RAM. Our previous inference run used about 20.456 GB for Gemma 31B, including 8.912 GB in VRAM, and encountered a low-RAM stop during a warm batch. Those are inference measurements, not training measurements.
- Unsloth currently reports **22 GB VRAM for 31B QLoRA**. That is a recipe-dependent reference, not a universal minimum or a guarantee for our grouped images. Its smaller-model guidance makes E2B/E4B more plausible local experiments, but lists differing memory figures for configurations; do not promise that every E4B vision run fits 12 GB. [Training guide](https://unsloth.ai/docs/models/gemma-4/train)
- Google describes a GPU with more than 16 GB for its demonstration. Do not mistake that generic requirement for the full 31B requirement. [Google guide](https://ai.google.dev/gemma/docs/core/huggingface_vision_finetune_qlora)
- Training needs intermediate activations, gradients and optimizer state in addition to model weights. CPU/NVMe offloading exists in training frameworks, but it is a separate configuration with additional transfer costs and RAM demands. It is not Ollama's inference offload automatically carried into training. [DeepSpeed integration](https://huggingface.co/docs/transformers/deepspeed), [bitsandbytes training notes](https://huggingface.co/docs/transformers/quantization/bitsandbytes)

**Assessment:** no verified practical 31B vision-training recipe for this 12 GB/32 GB machine was found. Do not call it mathematically impossible, but do not promise it can be solved just by waiting longer. Disconnecting Remote Desktop does not close that VRAM gap. A larger-GPU training session is the more credible 31B path; afterward the tuned, quantized model can be tested for local inference with the same offload limitations as today.

Possible paths, none started:

1. **No training spend:** establish the requested Haiku/Gemma baseline first, improve evidence handling on separate development data, then validate. This is the recommended first step.
2. **Local training pilot:** an E2B/E4B adapter to prove data quality and the export path. This is a different, smaller candidate; it does not silently replace the requested 31B comparison.
3. **31B training elsewhere:** investigate a free allocation (the vendor links a Kaggle example) or a separately approved, fixed-budget GPU session. Free allocation, vision fit and runtime limits have not been verified. No subscription or rental has been created.

A read-only host check found no `python`, `py`, `uv` or `ollama` executable on this shell's PATH; Ollama remains installed at its known absolute path. `wsl --list --quiet` says WSL is not installed. This is not an exhaustive inventory of bundled Python environments. No training stack has been certified. Existing instructions require approval before installing missing software.

## Astra's role and the quality limit

[GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) accepts images and supports structured output. It can propose evidence-backed labels and help build the training/evaluation tools. The proposal is supervised training of Gemma on reviewed examples, sometimes called teacher/student distillation; it is not fine-tuning Astra itself or an OpenAI service that directly trains a Gemma model.

Use Astra's final structured observations as drafts, not unquestioned truth. Require source-image indices, exact visible text, full-versus-partial identity, selected-versus-other-option roles, kit/module distinction, explicit ECC evidence and unknowns. Independently review sensitive numbers, identifiers and disagreements. Retain difficult negatives and errors; do not train only on easy successful examples. Do not put hidden reasoning traces into the dataset. A pilot of a few hundred carefully reviewed examples is a proposed starting experiment, not a promised sufficient dataset size.

Training can reinforce a teacher's mistakes and can overfit repeated product photos. Keep the model away from current marketplace prices and verdict labels; the deterministic valuation engine and source evidence remain authoritative. A local specialist might outperform a general teacher on a narrow task, but that remains unmeasured for Filtrsoft.

## Fresh comparison and training-data separation

The requested candidates remain **Haiku 4.5 API versus the installed Gemma 4 31B QAT**. The current 14-case set is development data. No fresh comparison dataset has been frozen in this research session.

Proposed comparison protocol:

1. Start with roughly 100 distinct listings, enough photos per listing to preserve the available evidence, and explicit coverage of CPU screens, GPUs, RAM, storage, exact laptop/phone identities, positive ECC/quantity cases, accessories and unreadable negatives. Final size follows annotation availability; a small class must be reported as insufficiently measured.
2. Exclude all prior evaluation/training images using hashes, near-duplicate checks and listing/repost grouping. All views of the same item stay in one split. Fresh here means unseen in our inference/training workflow; public models' full pretraining corpora cannot be audited, so do not claim global never-seen status. Newly captured private photos give stronger assurance if available.
3. Freeze references and thresholds before outputs. Keep source-supported partials, unsupported claims, attribution, missing annotations and failed requests separate. Reference annotations must not simply be Haiku's or Astra's preferred answers.
4. Give both candidates the same logical task, original source evidence and grouped photos. Record any provider-required image transforms and model-specific request settings. No source title or answer-key leakage. Hide model names during claim adjudication where feasible.
5. Report usable-fact precision/recall, exact-identifier errors, unsupported sensitive claims, negative abstention, per-listing correctness, completed/failed counts, latency, memory and actual API cost. Retain the existing 95% precision, 80% recall and zero observed unsupported sensitive-fact gates; give uncertainty and class coverage, rather than claiming observed zero proves universal zero.
6. If training follows error analysis, that inspected comparison is no longer the final independent acceptance set. Train on separate examples; reserve another untouched final set for untuned Gemma, tuned Gemma and Haiku. Do not let the teacher label training examples from that final set or use it to select checkpoints. [Train/test guidance](https://developers.openai.com/api/docs/guides/fine-tuning-best-practices)

## Spending and preserved state

No new paid calls in this research. OpenAI ledger SHA-256 remains `5e5e6885e5a0694c7ebdf263d65423de270816f85a3fff33b9a843088d6c606c`, with $4.467635 conservative expenditure and $0.532365 guard headroom of the original $5. Do not treat model-download approval as a fresh Astra training-data budget. Current Astra standard token pricing is $10/M input and $50/M output; bulk labeling needs an estimate and a cap before execution. [Astra documentation](https://developers.openai.com/api/docs/models/gpt-6-astra)

Yish's requested isolated Haiku comparison does not authorize re-enabling recurring production Claude calls. Keep any future lab budget isolated and preserve the production pause. No secret was printed or changed; no collector/database/profile/identity/outbox/startup changes, push or deployment occurred. Installed runtime checkout remains clean. HANDOFF records this research-first sequencing.
