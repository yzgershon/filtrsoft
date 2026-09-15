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

Pinned Linux verification also passed **346/0/996**, including typecheck, with network disabled. Deployment/runtime switch is next; append actual receipts below. Shared checkout source edits are preserved.

Setup and future gaming-PC capabilities: `DESKTOP-COLLECTOR.md`.
