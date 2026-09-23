# Gemma 4 31B QAT and bounded OpenAI evaluation

**Interpretation superseded by the September 18 [benchmark audit](VISION-BENCHMARK-AUDIT-2026-09-18.md).** Two of Gemma 31B's three legacy wrong flags are the same supported but incomplete part-number prefix. The old score is not a reliable factual-accuracy rate. The remaining exact CPU claim is unverified at source resolution; no automatic writer is validated. Raw outputs, timing and historical scores below remain preserved.

**Later September 18 update:** private API key entry is complete and seven OpenAI models were tested. Read [the OpenAI comparison](OPENAI-VISION-COMPARISON-2026-09-18.md) for measured results, the persistent $5 total budget and the new screening holdout. The pending-key and no-paid-requests statements below describe the earlier 13:18 UTC checkpoint.

## Authorization and scope

Yish requested Gemma 4 31B QAT and, if it is insufficient, a cheap OpenAI image-model comparison. He authorized an existing $5 API test budget. The first cloud experiment is limited to $1, with durable reservations before requests and no automatic retries. This is evaluation only; neither local nor cloud results are written into production facts. It does not authorize recurring paid inference.

The existing collector, database, identities, browser profiles, launcher and laptop pause are preserved. Evaluation files and source photos remain private under `C:\Dev\filtrsoft-recovery-data\followup`. The API credential is supplied privately through `C:\Dev\filtrsoft-data\openai-eval.env`; never copy it into documentation, logs, source control or chat.

## Local experiment

- Existing Ollama now reports **0.34.2**, versus 0.34.1 for the earlier model comparison. No runtime install was performed in this experiment; this version difference limits direct cross-run comparisons.
- Exact model **`gemma4:31b-it-qat`**, digest **`e0812a55773bfeac846b2d605b4d93638b8dfa7119d9587f3d91475afc78185e`**, artifact **18,851,736,234 bytes**, Q4_0, 30.7B parameters. Existing model artifacts remain installed. [Official distribution](https://ollama.com/library/gemma4:31b-it-qat).
- Frozen 25-case / 29-image development manifest SHA-256 **`6530a5d162c842dc944abfbaf373ed11d54a00c47b2a6acb609802c7f57bf648`**. This set has already been exposed to previous models; it is not fresh holdout evidence.
- The set contains 11 positive cases, 14 negative cases and 39 expected fields: 14 model identities, six RAM capacities, six memory types, five kit layouts, four speeds, three GPU names and one VRAM capacity. It contains no positive CPU, storage or ECC example, so it cannot establish general accuracy for those fields.
- Same `photo-eval-v3-strict` prompt, original photo bytes, strict evaluator and typed JSON schema. Temperature 0, thinking disabled, context 8,192, output bound 2,048. This measures a controlled configuration, not every possible setting of the model.
- `gemma31-vision-run.ts` changes the previous adapter only to record runtime/version and allow 600 seconds per image for CPU offload. GPU-idle, pause-file and RAM guards remain enabled. Every image unloads its model afterward; photo times include loading. Less than 2 GiB available RAM aborts active work; request start requires 4 GiB.
- Original acceptance gates: at least 95% strict field precision, at least 80% recall and zero unsupported identity/quantity/ECC facts. Exact suffixes are significant. A shortened part number may be scored unsupported even when its prefix is visible; that is an exact-identity failure, not necessarily invention of the entire string.

### Completed baseline

The full run completed **12:46:24–13:06:07 UTC**, about **19.71 minutes**, with **25/25 successful cases, 29 image reads and zero request failures or RAM aborts**.

| Same 25-case development set | Strict precision | Recall | Unsupported outputs |
|---|---:|---:|---:|
| Prior Gemma 4 12B QAT | 51.06% | 61.54% | 14 |
| Prior Gemma 4 26B-A4B QAT | 60.61% | 51.28% | 8 |
| Gemma 4 31B QAT, thinking disabled | **81.48%** | **56.41%** | **4** |
| Required | **95% or higher** | **80% or higher** | **0 sensitive unsupported facts** |

Frozen-v2 counts: **22 correct, 17 missed, five wrong**, including four classified as unsupported, and 17 case-level abstentions. These are reproducibility figures from the unchanged earlier benchmark. Manual review then found **two annotation omissions**, described below; they must not be presented as model errors. Genuine remaining failures are dropping the `.M8B1` suffix from the Crucial part number (also repeated in the multi-photo stress case) and an unsupported `AMD Ryzen 7 5800H` claim on the tiny Windows About screen. Original v2 annotations and model responses remain intact.

| Field | Correct | Missed | Wrong |
|---|---:|---:|---:|
| Exact model | 2 | 12 | 3 |
| RAM capacity | 5 | 1 | 0 |
| Kit layout | 5 | 0 | 0 |
| Memory speed | 4 | 0 | 1 |
| Memory type | 4 | 2 | 0 |
| GPU | 2 | 1 | 0 |
| VRAM | 0 | 1 | 0 |
| CPU | 0 | 0 | 1 |

The frozen-v2 figures fail the gates. The corrected audit below is the current accuracy conclusion, and also fails them.

### Source-photo annotation audit

Manual review of every wrong 31B output found two missing expected facts: **6000 MT/s** was present in the first photo of the synthetic two-kit case but absent from its combined annotation, and **EVGA110 REV 1.0** is visibly printed on the GPU board in case 10. The latter is a literal board identifier, not permission to infer a retail GPU variant. Both were added to a separate **v3 development audit**, without changing the evaluator, thresholds, source images or model responses. This is a post-exposure correction, not fresh validation.

All three saved Gemma runs were re-scored against the same corrected **41 expected fields**:

| Corrected development audit | Correct / missed / wrong | Precision | Recall | Unsupported |
|---|---|---:|---:|---:|
| Gemma 12B | 25 / 16 / 22 | 53.19% | 60.98% | 14 |
| Gemma 26B-A4B | 21 / 20 / 12 | 63.64% | 51.22% | 8 |
| **Gemma 31B** | **24 / 17 / 3** | **88.89%** | **58.54%** | **3** |

The 31B errors are one unsupported CPU claim and two instances of an incomplete exact part number. Corrected model-field counts are **3 correct / 12 missed / 2 wrong**; other field counts above change only memory speed, to **5 / 0 / 0**. The model remains below both accuracy gates and is not accepted for production ingestion.

Evidence: `development-manual-v3-audit.json`, SHA-256 **`86096bb671dca21e49262ea490eb66c8aac65cc159a36836c327b0917b7227ae`**, `gemma31-annotation-audit.json`, and `audit-gemma-annotations.ts`. No new inference or spending was needed. The pending API comparison should use this audited manifest and retain the original prompt and photos. Neither old benchmark result files nor historical documentation were overwritten.

Median image latency **28.470 seconds**, maximum **95.193 seconds**, median model load **19.226 seconds**, median decoding **2.75 tokens/second**. Many negative images return very short answers; the median is not a prediction for a detailed label read. Ollama reported **20.456 GB allocated: 8.912 GB GPU + 11.544 GB outside GPU memory**, at 8K context. Sampled whole-GPU peak **11,898 MiB**, minimum available system RAM **3.754 GiB**. CPU/RAM placement works on this machine, with substantially less RAM margin and slower decoding than the earlier mixture-of-experts 26B run. The different architectures and runtime versions prevent attributing the entire difference to offload alone. Disk paging was not separately measured.

Private receipts: `gemma31-model-download.json`, `gemma4-31b-development.json`, raw `.traces.jsonl`, resource samples and `gemma31-summary.json`. Baseline adapter SHA-256 **`7129d2933e9aee64b95544b46d4ffee027015cef088c1ae2dea9c580d6b30dad`**.

### Thinking-mode diagnostic: incomplete, not an accuracy result

A separate four-case smoke run enabled `think=true` and raised the output-token bound to 4,096, keeping the prompt, original photos, 8K context, annotations and GPU/RAM guards. It uses `alternative-smoke-cases.json`, two readable-label cases and two negative cases, already exposed development examples. It records final answers separately from thinking length and preserves raw traces privately.

The first unstreamed request failed after **359.963 seconds** with `TimeoutError: The operation timed out`, before the runner's intended 600-second total deadline. Bun documents a separate socket-idle timer for requests that send no response bytes. The evaluation client was stopped and its model unloaded before retrying; the collector stayed running. This was a transport failure, not evidence that Gemma answered incorrectly. Receipt: `gemma31-thinking-interruption.json` and preserved `.partial`. [Bun fetch socket timeout documentation](https://bun.com/reference/globals/BunFetchRequestInit/timeout).

The replacement `gemma31-thinking-stream-run.ts` streams private raw output, prints only progress counts, explicitly disables the socket-idle timer, allows a **30-minute whole-request deadline**, and retains the same RAM/GPU guards and 4,096-token limit. **All four requests were deferred before inference** because sampled GPU utilization remained 24–30% with no model loaded and only about 737–758 MiB GPU memory used. The source of that utilization was not established. These four deferrals are failures, not successful abstentions or a zero-accuracy model score. `gemma4-31b-thinking-stream-smoke.json` preserves this attempt. Yish was asked to pause competing GPU activity before a retry. No completed thinking-mode accuracy result is available yet; it must not be presented as a failed capability test of thinking mode.

## API candidate and cost controls

The official API catalog lists **`gpt-5.6-luna`**, with image input, structured output and reasoning effort `low`. Standard short-context prices are **$0.20 per million input tokens**, **$0.02 cached input**, **$1.20 output**, with cache writes at **$0.25 input**. This does not establish the private API project's access until its model-access check succeeds. [Model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [pricing](https://developers.openai.com/api/docs/pricing).

The prepared Responses API runner uses the unchanged prompt and evaluator, `reasoning.effort=low`, `detail=original`, strict JSON schema, `store=false`, standard service tier, no tools and at most 8,192 output tokens. Reasoning tokens count toward that output limit and cost; low effort does not itself cap the bill. Original detail preserves small label text, within the documented image-patch bounds. [Image input](https://developers.openai.com/api/docs/guides/images-vision), [reasoning limits](https://developers.openai.com/api/docs/guides/reasoning), [structured output](https://developers.openai.com/api/docs/guides/structured-outputs).

Every request reserves **$0.025** in a persistent ledger before sending. Unknown outcomes retain their whole reservation. Successful usage is conservatively charged with all input at the cache-write rate; a separate standard-price estimate is recorded. Five offline budget tests passed, including uncertain requests, maximum token bounds and refusal once the $1 ceiling cannot reserve another request. Full development preflight validated 29 image requests, with **$0.725** combined worst-case reservations. No paid request is made by preflight.

**GPT-5 nano** is a still cheaper researched alternative, **$0.05 input / $0.40 output per million tokens**, with image input and structured output. OpenAI recommends starting new cost-sensitive work with Luna. Nano has not been measured on these photos. [Official GPT-5 nano documentation](https://developers.openai.com/api/docs/models/gpt-5-nano).

Cloud status: adapter prepared; both original and audited-manifest preflights passed; **private key entry pending, no paid requests sent**. The runner also requires a completed Gemma result that fails the development gates before allowing cloud fallback; that condition is now met. It reads the private credential only in `--live` mode. Next cloud run should use `development-manual-v3-audit.json` and a new output filename, preserving the persistent $1 ledger. The credential directory is outside any Git repository. If a tuned candidate passes development, it still needs a newly annotated untouched holdout before an acceptance claim. No ECC-positive scope is validated by the present set.

## Operational verification and continuation

At **13:18:14 UTC**, production diagnostics showed Gaming desktop primary and online, revision **`e73d18795a25`**, heartbeat **13:18:00 UTC**, five-minute fallback unchanged. Laptop remained persistently **paused** and offline. Desktop `visionLimit=0`, local last error null, and Ollama reported **no loaded models**. Job55 completed Facebook, OfferUp and Mercari `ok` during this experiment; its final Mercari upload batch acknowledged **10 durable changes**. The collector continued writing its normal database and upload state; the evaluation did not reset or replace any of them. Receipt: `gemma31-runtime-final.json` and the installed `agent.log`.

The two pending inputs are an idle GPU for the thinking-mode retry and private OpenAI key entry for Luna. Model downloads and up to $5 API testing are already authorized; the prepared initial cloud experiment remains capped at $1. No paid inference occurred in this turn. The existing paid Claude switches were not changed or invoked and were last independently verified off in the preceding release; the collector diagnostic does not expose both switches. No new production release, push or deployment was performed. These documentation updates remain local in the follow-up checkout.
