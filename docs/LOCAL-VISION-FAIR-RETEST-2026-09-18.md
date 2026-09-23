# Local vision retest after the grading audit

## Scope

Yish requested another test of the stronger installed local models after the [benchmark audit](VISION-BENCHMARK-AUDIT-2026-09-18.md). This is an evaluation-only change in the follow-up checkout. The installed collector, local database, profiles, identity, outbox, startup and paused laptop are preserved. No API requests, downloads or production photo writes are part of this retest.

Candidates: installed **Gemma 4 26B-A4B QAT**, **Qwen 3.5 9B**, and **Gemma 4 31B QAT**, through existing Ollama 0.34.2. Models run sequentially, temperature zero, thinking disabled, 8,192 context, 2,048 output-token limit. The result describes these configurations, not each model's maximum possible capability.

## What changed

`src/vision/evidence-evaluation.ts` adds an evaluation-only schema and grader alongside the preserved legacy grader. References carry photo identity, visible evidence text, field, semantic role, complete values, declared aliases and explicit partials. Compound DDR/form-factor text can represent both facts. Missing annotation matches require review; they are not automatically called hallucinations. Correct-looking values with a wrong photo or unsupported quote do not receive automatic credit. Kit total and module capacity have different roles. Part-number prefixes cannot satisfy complete-SKU references.

**18 focused regression tests / 39 assertions and TypeScript validation passed.** Tests cover the audit's false penalties and false acceptances, changed digits/suffixes, quantity/definition scope, partial IDs, duplicate observations, missing annotations, explicit unknowns, unresolved contradictions and failed-request abstention. No production module imports this new evaluator; no engine-version bump or deployment is needed for this lab work.

The grader's `wrong`/`contractErrors` measures typed-contract errors, not invented values. A separate, explicit source-review receipt classifies factual misreads, unsupported claims, incorrect attribution, supported partials and formatting/field problems. All completed claims are included, not only automated failures. Review rules are shared across models and exact saved claim hashes are retained. Single-reviewer source adjudication is not independent double annotation.

## Frozen inputs and honest limits

Private manifest `evidence-retest-v1.json`, frozen **15:59:41 UTC**, SHA-256 `07ef0a45521263b53deb3233c8058f13e347d323cdf090deaa9ad70b57138c4f`. Prompt SHA-256 `41669d58ff7c5b368c104a3f1880d4fea49aff956963083cee5a6c1c4503487d`.

- **14 cases, 15 unchanged source images, 48 required semantic facts.** Ten positive cases and four negative cases; each physical photo appears in one case only.
- Uses known development/previously exposed photos. One clear existing full photo per case, with the SanDisk front/back pair grouped. Selecting a clearer view is an input-condition change, not an improvement in reading identical old inputs.
- Includes a readable CPU/About screen, storage labels, a GPU box, RAM kit/module labels, selected-versus-alternative options, a laptop bezel and unreadable/non-hardware negatives.
- RAM still accounts for 29/48 target facts. There is only one GPU positive, one CPU screen and no positive ECC or phone identity. This focused screening set does not certify broad production accuracy.
- A printed `2x32GB` supplies the three explicit semantic facts of layout, count and module size during source review. No unprinted arithmetic total or part-number decoding receives credit. These correlated targets must not be treated as independent statistical trials.
- Product-family credit is distinct from exact-SKU credit. For example the ASUS family reference permits TUF Gaming; full OC-variant completeness is not separately measured. Extra supported background/brand text does not count toward required-fact recall.
- Quote punctuation, assembled text across separate printed regions, extra valid qualifiers and generic `item` versus specific kit roles are reviewed explicitly. Review decisions do not modify old outputs or silently replace the frozen references.
- Post-freeze grader corrections recognize explicit `unknown` as abstention, expose supported-text counts separately and block acceptance eligibility for unresolved scalar contradictions. These do not change the inference prompt or reference answer key. Final reports re-evaluate all candidates with the same revised grader. Saved in-run metrics remain historical.

## Resource and execution controls

Windows GPU counters identified **remoting_desktop** as the largest non-model engine user, with smaller DWM/ChatGPT activity. Yish reported no other activity. An evaluation-only baseline exception permits this observed remote-desktop load rather than falsely classifying it as a game; the installed collector's idle guard is unchanged. No process was killed or service stopped. Initial GPU utilization and memory are recorded.

The runner checks for competing Ollama models, verifies every source hash and the frozen prompt, records model digests, uses streaming with a 15-minute per-request deadline, and retains complete raw streams. It starts no inference with less than 3 GiB available RAM and aborts below 2 GiB or on the existing `pause-gpu` marker. The initial runs retain each model between cases and unload after its batch; models never overlap.

Gemma 26B's SanDisk front/back request repeated the same entry until the output-token limit. It is retained as **one failed request**, never scored as a successful abstention or partial success. The initial runner stopped there; a six-case continuation finished the remaining previously unrun cases with identical inputs/settings. No failed case was silently retried. Subsequent models continue to distinct cases after an ordinary output failure, while memory/pause stops still end the run.

Gemma 31B completed three warm cases, then the RAM guard aborted the fourth with 1.995 GiB free. Available RAM had fallen from 17.961 GiB at the first request to 3.245 GiB before the fourth. Unloading restored 19.247 GiB. A disclosed continuation retries that interrupted fourth case and runs the remaining cases with `keep_alive:0`, unloading between requests. The first three successful outputs and interrupted attempt remain intact; prompt, photos, decoding settings and grading are unchanged. This is an operational recovery, not an accuracy failure or a silent second chance at a wrong answer. Cold and warm latency must remain distinguishable.

While loaded, the dense 31B model reported 20.456 GB total and 8.912 GB in VRAM (11.544 GB outside VRAM). It generated roughly 2.4–2.5 tokens/second on its first warm positive cases. RAM offloading works here, but speed and sustained memory pressure both matter. Unloading between requests avoids the buildup observed during this run at the cost of repeated loading.

## Results

Completed **16:34 UTC**. Final source review is frozen in private `evidence-retest-review-final.json`, including every claim, reviewed classifications, missing facts, timing phases and artifact hashes. All image hashes still match. No claims remain awaiting initial review; one tiny ThinkPad family-logo claim remains explicitly **unresolved**, rather than being forced into correct or wrong.

| Candidate | Completed cases | Required facts recovered | Confirmed transcription errors | Unsupported/unverifiable core claims | Attribution mistakes | Median completed case |
|---|---:|---:|---:|---:|---:|---:|
| Gemma 4 26B-A4B QAT | 13/14 | 40/48 (83.3%) | 1 | 6 | 3 | 8.40 s |
| Qwen 3.5 9B | 14/14 | 40/48 (83.3%) | 1 | 10 | 3 | 6.09 s |
| Gemma 4 31B QAT | 14/14, after resource recovery | 43/48 (89.6%) | 1 | 2 | 2 | 87.32 s |

**These percentages measure target-fact coverage, not accuracy or precision.** Source review includes recoverable representation differences; these are not all normalized, production-ready facts. Unsupported means that the supplied source does not verify the claim, not that the physical hardware is proven different. Brand-only inferences are excluded from the core-error columns. Counts are claim-level, including duplicate option observations; they are not independent trials or a fair precision denominator. Thresholds remain 95% precision, 80% recall and zero unsupported sensitive identity/quantity/ECC claims, but this development screen does not certify those production gates.

### What each model actually did

- **Gemma 31B is the strongest candidate in this screening.** It correctly read the SSD's 2TB capacity and full `SDSP51200TAN-000G1` identifier with the correct front/back photo references, without turning the 1TB definition into the drive capacity. On the clear About screen it recovered the CPU, GPU, RAM, storage, reported graphics memory and RAM speed. It omitted the laptop family name there. It did not infer ECC or module count from Hynix's rank marking.
- Its confirmed misread is `HMCGG66AGBSA092N BA` instead of printed `HMCG66AGBSA092N BA`: an extra G, not an alias. Its unsupported claims are `AMD Ryzen 7 5800H` and `16.0 GB` on the 261-pixel About photo. The AMD badge does not establish the exact CPU suffix. Two duplicate selected-option observations are mislabeled `other_option`, although its primary selected 64GB/2x32GB reading is correct. This is an attribution error, not an invented capacity.
- **Gemma 26B** reads Flare X5 as X6 and interprets `1Rx16` as quantity one. Its two selected-option attribution mistakes are the same duplicate-button issue described above. On the tiny About image it supplies six unverified hardware specifications. The tiny ThinkPad family logo is separately unresolved and is not called a confirmed error. Its SSD request repeats until truncation; that output failure still needs isolation before using this configuration unattended.
- **Qwen 9B** changes characters in the Hynix code, infers non-ECC from UDIMM, uses CPU-compatibility text as actual CPU identity, and treats a rank marking as kit layout. It also supplies unprinted quantity claims and seven unverifiable hardware claims across the two tiny photos. Its explicit `unknown` values are counted as abstentions, never hallucinations.

Gemma 26B and 31B avoid unsupported core claims in **3/4 negative cases**; Qwen does so in **2/4**. These include the case-only and closed-laptop photos, where none invents a phone/laptop hardware identity. Printed CASETiFY branding is permitted non-target text, so an accessory brand alone does not fail a negative case. This set is too small for an abstention-rate guarantee.

### Timing and memory

Gemma 26B and Qwen retain their models between cases; their median decode rates are **33.16** and **68.98 tokens/s**. Gemma 31B's overall decode median is **2.48 tokens/s** with RAM offloading. Its first three cases take **171.12, 123.14 and 213.62 seconds**; the first includes an 18.41-second load, while the next two use an already loaded model. The cold continuation's median is **60.83 seconds**, including a median **18.52 seconds** loading. These are different case mixes; the lower continuation median does not mean cold execution is faster than warm execution. Failed/aborted requests are excluded from completed-case latency and retained separately.

### Decision and next step

Keep Gemma 31B as the lead local candidate, with Gemma 26B as the faster alternative to investigate. This is a materially more favorable picture than the invalid legacy pass/fail conclusions. It still does not justify automatic fact ingestion: exact identifiers and low-resolution evidence need independent corroboration or abstention, and the dense model needs bounded, unload-between-request execution on this PC.

Before enabling a writer, freeze a **new untouched, more balanced holdout**, including positive CPU/storage/ECC cases and difficult negatives. Evaluate the full path from source evidence to attributed, normalized facts. Any crop/preprocessing or inference-setting experiments belong in development first; do not silently replace these results or tune against that future holdout. No automatic writer was enabled in this retest.

## Final operational verification

- At **16:34:49 UTC**, production reports Gaming desktop primary, online and working job59 on `e73d18795a25`, heartbeat **16:34:26 UTC**, fallback five minutes. Laptop remains **paused**, currently offline. Local `visionLimit=0`; Ollama has no loaded models.
- At **16:35:22 UTC**, the recent log receipt includes acknowledged batches of **10 Mercari, 10 Facebook and 10 OfferUp durable changes**. The latest completed OfferUp pass reports **9 read, 1 unavailable, 0 failed**; preceding Mercari reports **10 read, 0 unavailable, 0 failed**. These are recent batches, not a claim that the whole cycle finished.
- Local status still retains `TimeoutError: The operation timed out.` despite ongoing work and uploads. Do not describe this as an error-free collector cycle. No reset/restart was performed to clear the status cosmetically.
- Installed runtime Git checkout remains clean at `e73d18795a256878fb96160cb5cea1f358e1e538`. Database, browser profiles, identity, outbox, launcher and local commits were preserved. Lab changes remain local in the follow-up checkout; no push, release or deployment.
- The OpenAI ledger hash is unchanged (`5e5e6885e5a0694c7ebdf263d65423de270816f85a3fff33b9a843088d6c606c`): **zero new paid calls**, existing conservative total **$4.467635**, guard headroom **$0.532365** of the original $5. Claude paths were not invoked or changed; the collector diagnostic does not independently expose both Railway Claude switches.

Private evidence lives in `C:\Dev\filtrsoft-recovery-data\followup`: `fair-local-v1*`, `evidence-retest-*`, `review-evidence-retest.ts`. Original benchmark artifacts remain intact. No OpenAI spending was incurred; preserve the existing $5 ledger and its remaining guard headroom.
