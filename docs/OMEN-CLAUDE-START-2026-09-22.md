# Start here on the OMEN: Claude full-project pass, 2026-09-22

Written by a Claude Code session on the laptop (Yishai_XPS), which could not reach the OMEN.
Yish decided the full pass (docs/CLAUDE-FULL-PROJECT-PROMPT-2026-09-22.md) runs **on the OMEN**.
This laptop session made no code changes, deployments, collector changes or paid calls.

## Why the OMEN, not the laptop

- The OMEN (`yishpc`, Tailscale 100.71.210.34) answers ping, but it has no remote-exec channel: SSH, RDP and WinRM are closed and Ollama is not exposed.
- Everything the pass needs is on the OMEN: the installed runtime, the local model Yish calls "Gemma 31B", `C:\Dev\filtrsoft-recovery-data`, and **unpublished local commit `88363b9c04ff`**.
- The laptop's Ollama has only `gemma4:latest` = **8.0B, Q4_K_M**. That is not the 31B model. Do not evaluate it as the baseline.

## Measured from the laptop, 2026-09-22 22:52 UTC (read-only)

- Public health: engine **0.3.47**, db ok, storage pressure `low`, 686 SKUs, scoring **0 pending / 0 failures**, 392 ms.
- OMEN node `bc3313ad-0a65-4020-922c-e9a30505da21` ("Gaming desktop") is **online**, revision **`88363b9c04ff`**.
  - That revision is **not on origin**. origin/main is still `b8fa54c`.
  - It differs from the recorded installed merge `e73d1879`. Inspect it first. It may contain the Gemma integration or other desktop work. Preserve it and never reset it.
- OMEN maintenance: backup done 20:43 UTC (verified); comps, cohort and identity-comps all "Completed and verified" around 22:3x–22:5x UTC. Recent jobs go up to about #98.
- Laptop node `3d4eccad-…` is **paused** at `43c4fa744134`. Its supervisor is alive. Keep it paused.
- Source health: **Facebook = "attention"** (last success 22:20 UTC); OfferUp and Mercari healthy. Investigate the Facebook issue.
- Captures in the last 24 hours: Craigslist 30, Facebook 151, Mercari 253, OfferUp 92.
- Recent calls across all sources: 7 VERIFY, 0 BUY, about 2,300 INSUFFICIENT_DATA, 472 OUT_OF_SCOPE, 289 PASS, 171 RISK, 44 FAIR.
- The server-side crawl runs **every 3 minutes**: `discovered` stays at 1234 and `analysed` is about 0 per run. Check whether that is wasted work or the intended Craigslist freshness check.

## GPT-6 Luna, verified 2026-09-22 against the official model card

- Model ID `gpt-6-luna`; text and image input; structured outputs; 1.05M context; 128K max output.
- Reasoning effort: `none` / `low` / `medium` (default) / `high` / `xhigh` / `max`. Billable reasoning tokens count as output.
- Price per 1M tokens: input $0.10, cached input $0.01, cache writes $0.125, output $0.50.
  - Requests over 272K tokens: 2x input, 1.5x output.
  - Batch/Flex: -50%. Fast mode: 2x. Regional processing: +10%.
- The images/vision guide does **not** list Luna's image-token accounting (it lists only `gpt-6-astra`, at a 1.2x patch multiplier). **Measure image tokens from actual `usage` fields.** Do not assume them.

## Approvals already given (2026-09-22)

- **Luna benchmark: $5.00 hard cap, approved by Yish.** Enforce it with a concurrency-safe ledger, stop at the cap, and keep paid calls out of the test suite. This does **not** approve an operating budget; ask separately after the evaluation.
- **API key:** Yish sets `OPENAI_API_KEY` in the OMEN env himself.
  - A key was pasted into the laptop chat. Yish was advised to revoke it and create a new one.
  - Never copy a key from a transcript, and never commit one.
- Both paid Claude paths stay paused. Do not resume them.

## First steps on the OMEN

1. Read `HANDOFF.md` section 0 and this file. Record the host, `git -C C:\Dev\filtrsoft-agent log`, what `88363b9c04ff` contains, the runner config paths and the running processes.
2. Identify the Gemma model: `ollama list` and `ollama show <tag>` (tag, digest, quantization, context). Find any integration code or evaluation results in the unpublished commit and the recovery-data directory.
3. Publish the desktop work in the unpublished commit to a branch first, once it has been reviewed and contains no secrets or private data. Then reconcile it with main, so production and the runtime do not diverge further.
4. Then follow the full prompt. Plan, backlog, fixes and the Gemma/Luna evaluation all happen on the same frozen cases.
