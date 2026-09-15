# Collector recovery results

## Implemented

- A shared bounded subprocess runner drains stdout and stderr concurrently,
  preserves partial results, and terminates only the launched child tree.
- Browser event readers preserve final JSON without a trailing newline, report
  abnormal exits/missing completion, and release workers when consumers stop.
- Facebook, marketplace, detail and probe failures propagate to job status.
  A genuine successful search with no new listings can still succeed.
- Two category searches rotate per cycle, interleaved across sources. Each
  source gets a turn; a blocked source stops further visits for that job.
- Durable uploads run before collection and after every stage, including failed
  stages. Manual daily collection uses the same workflow and machine lease.
- Mercari/OfferUp cards are retained at every scroll position. Virtualized rows
  disappearing from the DOM no longer erase the first/newest results.
- Detail enrichment excludes out-of-scope titles. The Playwright probe wait now
  places its timeout in the options argument, where it actually takes effect.
- The Windows installer creates a hidden logon launcher and repoints the existing
  daily task to the same supervisor. It uses existing Node/Bun, does not change
  PowerShell execution policy, and backs up previous startup/task definitions.
- Supervisor restart backoff, rotating logs, persistent search cursor, machine
  locks and revision/status receipts make interrupted or stale runners observable.
- A narrowly authenticated collector diagnostics endpoint returns production
  arrival/verdict aggregates and runtime revisions, never account data. Reading
  diagnostics does not claim work or mark an offline collector online.

## Live recovery measurements before deployment

The ingestion DB was backed up consistently before current-schema migrations:
`C:/Dev/filtrsoft/backups/runner-recovery/before-current-runner-20260915T044846Z.db`.
Integrity check passed; 4,788 listings, 16,591 verdicts, 31,900 comps.
SHA-256: `68a253286e48954ae89bc49fc01df6b8769baea8c3fc5cb1b29ba3c26b9510cc`.

- Facebook: 41 cards, three newly captured listings, all insufficient-data.
- OfferUp: 60 cards, two newly captured listings, both insufficient-data at the
  card stage. Full descriptions and photos were subsequently uploaded.
- Mercari initially returned 27 parsed cards, all out of scope. UI inspection
  showed GPUs in the first viewport. After retaining each viewport, the same
  query returned 89 parsed cards and three new tech listings: two PASS, one
  insufficient-data. This was a collection bug, not a reason to loosen scope.
- All eight new captures were acknowledged by production. Initial recovery also
  acknowledged 529 Facebook, 479 OfferUp and 109 Mercari snapshots. Those counts
  include existing records/updates; they are not counts of new listings.
- 24 sold-status probes completed; one Mercari item was retired recoverably.
  Enrichment, observation and retirement updates were acknowledged too.
- No paid vision ran. No comp crawl, fabricated valuation, login automation,
  secret copying, or unrelated process termination occurred.

The three new Facebook uncertainty reasons were inspected against stored facts:
two PCs have no exact matching whole-build sold evidence; the base GTX 1650 is
absent from the current catalog (GTX 1650 Super exists, and is not equivalent).
Collection repairs do not manufacture matching sales for them.

## Validation

Final Windows suite: **346 passed, 0 failed, 996 assertions**. Typecheck and Vite
production build passed. Browser syntax checks and Git whitespace checks passed.
An isolated supervisor fixture verified environment loading, duplicate startup
exclusion and termination of its own child. The exact generated Windows shortcut
action was also exercised against a fake collector under paths containing spaces
and an apostrophe: launch succeeded and its child stopped on request.

Pinned Linux verification also passed **346/0/996**, including typecheck, with network disabled. Final deployment receipts follow below. Shared checkout source edits are preserved.

Setup and future gaming-PC capabilities: `DESKTOP-COLLECTOR.md`.

## Production receipt and release correction

Application commit `221e7a3` reached main and Railway reported success for
`7e2d7ec6-fd5e-412f-b294-3df7a7dc340a`. At 05:14 UTC, authenticated collector
aggregates confirmed 160 Craigslist captures in 24h plus the eight new desktop
captures. The last-week live Craigslist cohort held 3 VERIFY, 5 FAIR, 16 PASS,
5 RISK, 114 insufficient-data and 659 out of scope; no BUY. Craigslist collection
is active, while useful supply and exact sold evidence remain constraints.

Native CI `34931811775` caught a supervisor shutdown race not seen on Windows or
containerized ARM Linux: its parent exited before reaping its killed child.
The correction waits for the child close event before releasing ownership and
exiting. Targeted Windows/Linux collector tests pass. Final native amd64 CI
`34932156679` completed successfully on `d3d116eb28027e00200efe45d09287014fd48612`,
including full tests, typecheck, frontend build, network-disabled Docker tests
and the production image build. This is a real lifecycle fix, not a relaxed assertion.

The final application revision is on main. Railway deployment
`4fe80218-e48a-4f2c-9257-887d5b1dff25` succeeded; status was rechecked at
05:23 UTC. The 05:18 UTC production receipt confirms the eight new captures,
healthy database, low storage pressure and zero pending/failed scores. The
collector remains offline pending installation approval. Receipts are stored
in `docs/qa/collector/health.json`, `production.json` and `release.json`.

The permanent runtime is prepared and clean at `C:/Dev/filtrsoft-agent`, detached
at `d3d116e` and reusing existing dependencies. Automatic approval
review blocked its hidden logon installation, scheduled-task update and start,
citing missing exact authorization for persistent startup changes. The command
did not run. One direct approval question is pending; no alternate installation
route was used.

## September 15, approved permanent startup

Yish subsequently approved permanent automatic collection. The exact previously
blocked installation and start command succeeded on `Yishai_XPS` at 13:50 UTC.
The hidden logon shortcut and existing daily task both target the dedicated
`d3d116e` runtime through `C:/Dev/filtrsoft-runner-state/start.cjs`. Previous
startup/task definitions were backed up with timestamp `20260915095051`.

At 13:51 UTC, local and production status agreed: revision `d3d116eb2802`, online,
no local error, supervisor PID 15060 and collector PID 26088. Triggering the real
daily task completed with result 0 and left those same two processes in place.
The installation blocker is resolved. No restart of Windows, long-duration test
or gaming-PC installation has been performed. Follow-up recommendations are in
`AUTOMATIC-COLLECTION-ROADMAP.md`; these proposed features are not claimed shipped.

At 13:53 UTC the collector claimed automatically queued job #10. The 13:54 UTC
receipt shows `facebook/search-graphics-card` working and a fresh production
heartbeat. Automatic dispatch and work beginning are verified; the complete
multi-source cycle is still in progress. Receipt: `docs/qa/collector/startup.json`.
