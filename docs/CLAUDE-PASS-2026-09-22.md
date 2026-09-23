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
| F2 | Removed Facebook items were never retired | `probeVerdict` returned "no opinion" on any URL mismatch **before** the redirect-away check; Facebook sends removed items to `/marketplace/` (logged out: `login/?next=/marketplace/` instead of the item). 133 active Facebook listings in `failed` detail state, 96 after ≥3 attempts; every `facebook/recovery-1` batch reported `0/N` and failed the source → **"attention"** | Wasted browser time every cycle; stale listings kept for 28 days; source health noise | Fixed `efd6e7f`; **installed on the OMEN** (job #107 all sources `ok`) |
| F3 | Title-only Facebook listings could never be read | Seller text equal to the title repeats the h1; the Mercari carousel guard (`matches>1 && !itemText`) returned "unknown"; the Facebook worker never supplied the scoped panel | Same as F2; real listings never priced | Fixed `efd6e7f` (`detailItemText`); installed |
| F4 | Facebook detail failures were silent | Only `0/6 ... refreshed` reached `agent.log` | Every diagnosis needed a browser session | Fixed: each unread item logs its reason; installed |
| F5 | Production re-scores every listing every hour and after every comp write | `pricingSignature` = revision + UTC hour; health went 0 → 11,031 pending at 01:00; drain ≈10 listings/s ≈ 19 min/hour; delisted/expired rows included | CPU/WAL churn on a small volume; `complete=false` a third of each hour | Fixed `256149d`: pricing changes re-price only live rows in the 28-day feed window; engine changes still re-score history. Deployed September 23 |
| F6 | `scoringStatus()` runs a full-table count every second | `scorePending` returns it on each 1 s pass | Constant read load | Fixed `256149d`: the per-second loop skips the count (`withStatus=false`); health still counts on request. Deployed September 23 |
| F7 | The 3-minute server crawl is intended | ~5 requests/1.4 s per tick for ~90 s Craigslist latency; `discovered` stores listings *seen* (1,234), not new ones | Metric reads like waste; it is not | Document; optional metric rename |
| F8 | Luna account limit is **200,000 TPM**, not the documented tier-1 500k | 429 bodies in the benchmark | Any production integration needs pacing | Benchmark runner paces; adapter exposes `rateLimitWaitMs` |
| F9 | Luna accepts `temperature` only with reasoning `none` | 400 `Unsupported parameter` at `low` | Reasoning efforts cannot be made deterministic | Recorded; `none` benchmarked at temperature 0 |
| F10 | Local collector verdicts are stale by engine | 1,437 latest local verdicts at 0.3.36 | Local BUY/VERIFY counts are not the feed | Production is authoritative; baseline re-scores a snapshot |
| F11 | VERIFY sent for trips that cannot pay | A $10 GTX 960 got VERIFY from the low-ratio branch although net margin was below the trip threshold | Push alerts for worthless items | Fixed engine **0.3.48** (`9fbcc72`): the ratio VERIFY branch also requires `net >= required` |
| F12 | Phone numbers spelled in words escaped the off-platform check | An RTX 3090 listing with its phone number written out in words scored as a normal lead | Scam bait reaches VERIFY/BUY | Fixed 0.3.48: `spelledContact` (≥10 digits, ≥3 number words in one run) → `OFF_PLATFORM_REDIRECT` / RISK |
| F13 | Facebook "Out of Stock" line not read as unavailable | Item 4201 after the F2 fix: the only "unknown" availability result, page shows a standalone `Out of Stock` line | One stale listing per occurrence | Fixed `267ddc4` (standalone line only; prose such as "was out of stock last week" does not match); installed |
| F14 | Scam-template VERIFYs (MacBook M5 $481 "77050", iPhone 12 $68 "0RMG") | Recommendation audit of the production feed | Possible bait in VERIFY | **Left as is.** Loosening scam thresholds from two examples risks retiring real listings; revisit with outcome data |

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

## GPT-6 Luna versus Gemma 31B (complete)

Full report: **`docs/LUNA-GEMMA-EVALUATION-2026-09-22.md`**. All six efforts ran on
the same 100 frozen listings as Gemma (none were skipped or subset). Fresh core,
91 listings / 230 facts:

| Reader | Supported | Usable precision | Usable recall | Unsupported sensitive | p50 | $/1,000 listings |
|---|---:|---:|---:|---:|---:|---:|
| Gemma 31B (local) | 95.4% | 90.4% | 77.4% | 6 | 79.3 s | $0 API |
| Luna `none` / `low` / `medium` | 81.9 / 92.8 / 94.3% | 70.8 / 86.5 / 89.0% | 61.3 / 72.2 / 73.5% | 31 / 9 / 8 | 2.8 / 5.0 / 7.8 s | $0.54 / $0.76 / $0.90 |
| **Luna `high`** | 93.3% | 92.0% | 81.3% | 9 | 10.1 s | **$1.04** |
| Luna `xhigh` / `max` | 93.4 / 95.8% | 90.7 / 93.6% | 78.7 / 83.5% | 10 / 6 | 31.8 / 32.9 s | $1.39 / $2.93 |
| **Luna high ∧ Gemma agree** | 100% | — | 56.5% | 0 | — | $1.04 + local |

- **Decision:** no single reader passes the gates; Luna `high` plus Gemma
  agreement is the only arrangement with zero unsupported claims. Shadow mode
  first; **nothing enabled** (no operating budget approved).
- Luna invents whole products on sideways/upside-down labels at every effort.
- Budget ledger: 665 settled calls **$0.902**, 4 uncertain (operator stop)
  **$0.262** kept at full reservation, 52 rate-limit rejections released;
  committed **$1.164 of $5.00**, never exceeded. Provider billing is authoritative.

## After this pass (measured 2026-09-23 02:04 UTC)

Snapshot `claude-20260922\local-after.db`, SHA-256
`6bb7e263ca44ff3795ea65c135ec9e323e443a299713a18159914a3621d02b3a`, quick_check ok,
zero FK violations, 4,579 listings / 35,065 comps, engine **0.3.48**.

| Cohort | Snapshot / engine | Insufficient | Retired | Out of scope | PASS | FAIR | RISK |
|---|---|---:|---:|---:|---:|---:|---:|
| Original 250, collector part (200) | before / 0.3.47 | 171 | 11 | 0 | 9 | 4 | 5 |
| | before / 0.3.48 | 171 | 11 | 0 | 9 | 4 | 5 |
| | after / 0.3.48 | 171 | 11 | 0 | 9 | 4 | 5 |
| Fresh 150 | before / 0.3.47 | 113 | 0 | 19 | 7 | 0 | 11 |
| | before / 0.3.48 | 113 | 0 | 19 | 7 | 0 | 11 |
| | after / 0.3.48 | 111 | 0 | 19 | 8 | 0 | 12 |

- **The engine change does not move either cohort** (identical counts on the same
  snapshot). Its fixes (F11, F12) target specific patterns found in the
  production feed audit; neither cohort contains them. The two fresh rows that
  moved did so from about an hour of new collection (more reads and comps).
- Neither cohort produces BUY or VERIFY locally; the deciding unknown is still
  **exact model** (98 original / 44 fresh), then storage and GPU. Photo reading
  (47% of fresh listings) and identity resolution remain the main levers, which is
  why the photo benchmark matters.
- **Facebook detail backlog:** active listings in `failed` state 133 → **108**;
  Facebook retirements dated September 22–23 UTC **28 → 54**. All 24
  retirements logged by the detail worker after the fix were redirects from the
  item to the marketplace index (three sampled by hand); one "no availability evidence" item led to F13. The 108 left
  are waiting out retry backoff and all come due by **2026-09-23 20:00 UTC**
  (three are overdue from September 19–22 and were not picked; check tomorrow).
- **Recovery batches:** before, every `facebook/recovery-1` reported `0/N` and
  failed the source (jobs #104–#106); after, `5/5` and `4/4`, job #107
  `{"facebook":"ok","offerup":"ok","mercari":"ok"}`.
- Branch suite **491 pass / 1 skip / 0 fail** (from 461), typecheck clean, CI
  `verify` green including container checks on `6546a82`.
- Production still runs engine 0.3.47 and hourly full re-scoring until PR #1 is
  merged; not measured after, because it is not deployed.

## Runtime receipts (OMEN, `C:\Dev\filtrsoft-agent`)

| Update | When (UTC) | From → to | Installed tests | Backup (restore-verified) |
|---|---|---|---|---|
| 1 | 2026-09-23 01:28 | `88363b9c04ff` → `9fbcc72` | 27 pass / 0 fail, typecheck, doctor | `pre-0348-update`, SHA `1aa02f57…` |
| 2 | 2026-09-23 02:01 | `9fbcc72` → `6546a82` | 37 pass / 0 fail, typecheck, doctor | `pre-0348b-update`, SHA `96c443f2…`, 4,579 listings, 0 FK violations |

Both runs: collector idle before stop, owned processes only, fast-forward only,
node identity / runner config / `start.cjs` / env file hashes unchanged,
restarted through *Filtrsoft Daily Crawl*, first status `online` with no error.
Script `claude-20260922\maintain.ps1 -target <commit> -tag <name>`; receipts
`maintenance-<tag>-receipt.json`. The first attempt at update 1 stopped on a
PowerShell stderr quirk before changing anything and restarted the collector
unchanged; the script now checks exit codes instead.

## Backlog (prioritized)

| P | Item | Acceptance | Status |
|---|---|---|---|
| P0 | Deploy F2–F4 to the installed collector via safe maintenance | Recovery batches report reasons; failed Facebook rows fall; retirements are URL-evidenced | **Done** (two receipts above) |
| P0 | Merge this branch to main and deploy | CI green incl. containers; production engine/assets verified | **Done** September 23 (`f5e19b0`, engine 0.3.48 live 03:16 UTC) |
| P1 | AI routing decision from the benchmark | Workload table with measured quality/latency/cost | **Done** (evaluation report) |
| P1 | Luna shadow mode for photo reads | Budget approved; `utc-day` cap; provenance stored; no verdict effect | **Running** display-only since 03:43 UTC September 23 (`7607701`); Gemma verification runs when the PC is idle |
| P2 | Score only live listings on hourly expiry; historical rows on engine change | Hourly re-score limited to feed rows; health `complete` most of the hour | **Deployed**; a pricing change queued 5,906 instead of ~11,000 |
| P2 | Cache `scoringStatus` instead of recounting every second | No per-second full count | **Deployed** (`256149d`) |
| P2 | Fresh untouched photo holdout (incl. rotated labels, CPU and ECC positives) | Frozen before any reader sees it; unchanged gates | Needed before any photo fact writer |
| P3 | Field-aware agreement normalization (`DDR4-3600` = `3600`) | Recall rises with no new unsupported claims on the holdout | Not started |
| P3 | Rename the `discovered` crawl metric (F7) | Reads as listings seen | Optional |

## September 23 follow-up (after Yish's decisions)

Yish: "lets do luna high + gemma. Merge PR #1. 2. yes. 3. ... its fine". So: PR #1 merged,
the Luna operating budget approved (hard cap $0.50 per UTC day), key location accepted.

| Step | Receipt |
|---|---|
| PR #1 merged (merge commit, runtime lineage kept) | `f5e19b0`; production engine **0.3.48** at 03:16 UTC |
| Engine re-score after deploy | 11,497 pending → 0 in ~13 min (03:16–03:29) |
| Scoring load after deploy | a pricing revision at 03:38 queued **5,906** re-prices (feed window only) instead of ~11,000 |
| PR #2 shadow photo reading | `7607701`, CI green, 501 pass / 1 skip; web bundle `index-C7WAhG9Z.js` live 03:42 UTC |
| Collector update 3 | `6546a82` → `7607701` at 03:43 UTC; 54 installed tests pass, typecheck, doctor, identities preserved; backup restore-verified (4,635 listings); env keys appended while stopped: `FILTRSOFT_PHOTO_SHADOW`, `FILTRSOFT_PHOTO_SHADOW_GEMMA`, `FILTRSOFT_OPENAI_ENV_FILE` (the key itself not copied) |
| First Luna pass | 10 listings read, **$0.0131** (avg $0.0013, 1.7–12.3 s); 26 recent listings not worth a read; 192 galleries over 6 photos skipped |
| First Gemma pass | refused correctly: "someone is using this PC"; 6 readings waiting |
| Sync to production | job #110 (~04:15 UTC): every push acknowledged, no rejection; a capture on a copy of the collector database showed 20 of 23 readings already uploaded, the 3 newest queued for the next job |

Smoke test before install (scratch copy, no paid call): real Facebook photo downloads
decoded and fingerprinted; Gemma refused while the PC was in use (GPU 31%, input 46 s ago).

## Decisions for Yish (as of September 22; resolved September 23 above)

1. **Merge PR #1** (https://github.com/yzgershon/filtrsoft/pull/1) or allow this
   workflow to push to `main`; Railway then deploys 0.3.48 and the scoring change.
2. **Luna operating budget** for shadow mode: estimated **$0.26/day ≈ $8/month** at
   ~250 listings/day, suggested hard cap **$0.50/day**. Not approved; nothing runs.
3. **OpenAI key:** it lives in `C:\Dev\filtrsoft-data\openai-eval.env`, not in the
   runner's `collector.env`. If it is the key pasted into the laptop chat on
   September 22, it still works and should be rotated.
