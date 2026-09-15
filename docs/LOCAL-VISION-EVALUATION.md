# Local GPU evaluation

The local lab is implemented but no model has been installed or tested on the
gaming PC. It never writes engine facts, vision_results, valuations or prices.

An initial candidate is `qwen3-vl:4b-instruct`, whose official Ollama listing
reports a 3.3GB Q4_K_M package. This is download size, not runtime VRAM usage.
The 4070 Ti must be measured with actual listing photos before choosing a model.
Install Ollama and the selected model only after Yish approves that setup on the
desktop. Record its full installed digest from `/api/tags`; changing the model
requires a new evaluation. The lab neither downloads models nor falls back to a
cloud service.

Prepare a local JSON manifest with at least 20 manually annotated examples from
three or more product categories, including blurred labels, contradictory photos,
single sticks versus kits, ECC, and near-identical CPU/GPU model names. Each case
has `id`, `category`, `photos` (relative paths) and `expected` (field-to-values map).
For example, `expected: {"gpu":["RTX 4070 Ti"],"vram":["12GB"]}` is an annotation
format example, not a claim about any particular listing photo. Include all photos
for each selected listing; oversized batches fail instead of silently skipping.

Run `bun run vision:local-eval --manifest <file> --model <installed-name>
--digest <full-sha256> --out <new-report.json>`. The evaluator preserves exact
quotes, per-image hashes, unresolved conflicts, missed facts, unsupported claims
and failed cases. A schema-valid response is not proof it read the hardware right.

The lab requires an idle NVIDIA GPU before starting and unloads after each image.
Creating `pause-gpu` in the collector state directory aborts an active request.
This provides an explicit gaming pause; automatic detection of every game and
measured GPU contention remain desktop validation work. Failure to read GPU
status stops the experiment. Normal marketplace collection does not require the GPU.

Primary references checked September 15, 2026:
- [Model package](https://ollama.com/library/qwen3-vl:4b-instruct)
- [Image inputs](https://docs.ollama.com/capabilities/vision)
- [Structured responses](https://docs.ollama.com/capabilities/structured-outputs)
- [Chat API and model unloading](https://docs.ollama.com/api/chat)
