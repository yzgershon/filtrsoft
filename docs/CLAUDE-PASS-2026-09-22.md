# Claude full-project pass on the OMEN, September 22–23, 2026

Durable plan, findings ledger and decisions for the pass requested in
`docs/CLAUDE-FULL-PROJECT-PROMPT-2026-09-22.md`. Updated at each checkpoint.
Times are UTC. Private artifacts live under `C:\Dev\filtrsoft-recovery-data`
(`claude-20260922\` for baselines, `followup\luna6-20260922\` for the Luna
benchmark); they are outside Git and must not be committed.

## Starting state (measured 2026-09-23 00:3x UTC)

- Host `YishPC` (the OMEN). Installed runtime `C:\Dev\filtrsoft-agent`, branch
  `codex/omen-evidence-recovery-20260917`, HEAD **`88363b9c04ff`**, clean.
  Supervisor PID 17488, worker 13060, zero restarts, job 105 running.
  Runner config `C:\Dev\filtrsoft-runner-state\config.json`: database
  `C:\Dev\filtrsoft-data\ingestion.db`, env `C:\Dev\filtrsoft-data\collector.env`,
  `visionLimit=0`, comps enabled.
- `88363b9` and twelve merge/setup commits existed only on the OMEN. Main had
  never received the September 15 collector setup fixes (Windows startup,
  eBay login state, WAL snapshot contention, doctor) nor the September 20
  private-desktop launcher; the runtime had been absorbing main instead.
  **Published unchanged** as `origin/omen/runtime-88363b9-2026-09-22` after a
  secret/private-data scan of the runtime-only diff (only Yish's own email in
  prose and a test fixture token).
- `C:\Dev\filtrsoft-followup-20260917` held **uncommitted** September 18–20
  work: eight evaluation documents, `src/vision/evidence-evaluation.ts` and its
  tests, and the newest HANDOFF entries. Preserved in this branch; that
  checkout was left untouched.
- The laptop handoff branch `claude/omen-handoff-2026-09-22` forks from an old
  base (`526de33`); only its eight documentation changes were merged.
- "Gemma 31B" is **`gemma4:31b-it-qat`**, digest
  `e0812a55773bfeac846b2d605b4d93638b8dfa7119d9587f3d91475afc78185e`,
  Ollama 0.34.2, measured September 18 on the frozen 100-listing baseline.
  No Gemma integration exists in the product; the local writer remains off.
- The OpenAI key is **not** in `collector.env` (the runner's `envFile`). It is
  in `C:\Dev\filtrsoft-data\openai-eval.env` (written September 18). It works
  (`GET /v1/models/gpt-6-luna` = 200). If this is the key that was pasted into
  the laptop chat on September 22, it has not been revoked. **Yish to confirm.**
- Production `filtrsoft.com`: engine 0.3.47, db ok, storage pressure low.

Merged branch `claude/full-pass-2026-09-22` = main `b8fa54c` + runtime
`88363b9` + preserved follow-up work + handoff documents: **461 pass / 1 skip /
0 fail, typecheck clean** before any change of mine.

## Findings ledger

| # | Finding | Evidence | Impact | Status |
|---|---|---|---|---|
| F1 | Runtime-only commits never reached main | `git log HEAD --not --remotes` on the runtime | A main-based update would have dropped startup, eBay-login, WAL and desktop-isolation fixes | Published + merged in branch |
| F2 | Removed Facebook items were never retired | `probeVerdict` returned "no opinion" on any URL mismatch **before** the redirect-away check; Facebook sends removed items to `/marketplace/` (logged out: `login/?next=/marketplace/` instead of the item). 133 active Facebook listings in `failed` detail state, 96 after ≥3 attempts; every `facebook/recovery-1` batch reported `0/N` and failed the source → **"attention"** | Wasted browser time every cycle; stale listings kept for 28 days; source health noise | Fixed `efd6e7f`, regressions fail-before/pass-after; runtime deployment pending |
| F3 | Title-only Facebook listings could never be read | Seller text equal to the title repeats the h1; the Mercari carousel guard (`matches>1 && !itemText`) returned "unknown"; the Facebook worker never supplied the scoped panel | Same as F2; real listings never priced | Fixed `efd6e7f` (`detailItemText`) |
| F4 | Facebook detail failures were silent | Only `0/6 ... refreshed` reached `agent.log` | Every diagnosis needed a browser session | Fixed: each unread item logs its reason |
| F5 | Production re-scores every listing every hour and after every comp write | `pricingSignature` = revision + UTC hour; health went 0 → 11,031 pending at 01:00; drain ≈10 listings/s ≈ 19 min/hour; delisted/expired rows included | CPU/WAL churn on a small volume; `complete=false` a third of each hour | Backlog P2 (below) |
| F6 | `scoringStatus()` runs a full-table count every second | `scorePending` returns it on each 1 s pass | Constant read load | Backlog P2 |
| F7 | The 3-minute server crawl is intended | ~5 requests/1.4 s per tick for ~90 s Craigslist latency; `discovered` stores listings *seen* (1,234), not new ones | Metric reads like waste; it is not | Document; optional metric rename |
| F8 | Luna account limit is **200,000 TPM**, not the documented tier-1 500k | 429 bodies in the benchmark | Any production integration needs pacing | Benchmark runner paces; adapter exposes `rateLimitWaitMs` |
| F9 | Luna accepts `temperature` only with reasoning `none` | 400 `Unsupported parameter` at `low` | Reasoning efforts cannot be made deterministic | Recorded; `none` benchmarked at temperature 0 |
| F10 | Local collector verdicts are stale by engine | 1,437 latest local verdicts at 0.3.36 | Local BUY/VERIFY counts are not the feed | Production is authoritative; baseline re-scores a snapshot |

## Baseline before this pass (local collector population)

Consistent `VACUUM INTO` snapshot `claude-20260922\local-before.db`, SHA-256
`b7e9eda2ee3adcb7a3d3031efe8bdcdcdc587f58fef86adf1241cbe9a89697be`, quick_check
ok, zero FK violations, 4,542 listings / 35,065 comps. Current engine 0.3.47
re-scored against the snapshot only. Production cohort receipts need Yish's
owner session (`/v1/owner/recovery-snapshot`); not available to this session.

| Cohort | Rows | Insufficient | Retired | Out of scope | PASS | FAIR | RISK | BUY | VERIFY |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Original 250, collector part | 200 | 171 | 11 | 0 | 9 | 4 | 5 | 0 | 0 |
| Fresh 150 (newest 50/source, 72 h, frozen before scoring) | 150 | 113 | 0 | 19 | 7 | 0 | 11 | 0 | 0 |

Deciding unknowns — original: exact model 98, recent sold comps 18, storage
12, matching builds 12, cpu 10. Fresh: exact model 44, storage 23, gpu 15, ram
9, cpu 7. Recovery jobs on the fresh cohort: identity 88, photos 71, text 36,
comps 18. **Photos are the recovery path for 47% of fresh listings**, which
is the workload the vision benchmark below serves.

## GPT-6 Luna versus Gemma 31B (in progress)

Frozen September 18 baseline: 100 listings / 222 photos, manifest SHA
`50c60337…`, prompt SHA `41669d58…`, identical images and prompt, no titles.
Same scorer as Gemma/Haiku; it reproduces their published numbers exactly.

- Budget: **$5.00 hard cap** (approved 2026-09-22), separate SQLite ledger
  `luna6-20260922\ledger.sqlite`, scope `gpt6-luna-benchmark-2026-09-22`.
  Reservation before every call; uncertain charges retained; 429 rate-limit
  rejections released with the saved provider body as evidence.
- Claim review: prior decisions, exact-equivalence transfer, then
  auto-grounding against frozen reference evidence (agrees with the September 18
  manual review on **339/339** claims it accepts), then manual source review of
  everything else, blind to effort level.

Results, cost and the routing decision will be recorded here when complete.

## Backlog (prioritized)

| P | Item | Acceptance |
|---|---|---|
| P0 | Deploy F2–F4 to the installed collector via safe maintenance | Recovery batches report reasons; failed Facebook rows fall; retirements are URL-evidenced |
| P0 | Merge this branch to main and deploy | CI green incl. containers; production engine/assets verified |
| P1 | AI routing decision from the benchmark | Workload table with measured quality/latency/cost |
| P2 | Score only live listings on hourly expiry; historical rows on engine change | Hourly re-score limited to feed rows; health `complete` most of the hour |
| P2 | Cache `scoringStatus` instead of recounting every second | No per-second full count |
