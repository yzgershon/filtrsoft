# Missing fresh deals: read-only diagnosis

Observed September 15, 2026, around 04:24 UTC (12:24 a.m. EDT). No crawl started, pause changed, credentials read, engine modified, shared checkout edited, or database re-scored.

## Confirmed

- Public production health: engine 0.3.35, DB healthy, storage pressure low, scoring pending 0 / failures 0 / complete true. Comps 31,900 total, 28,313 usable, 492 of 563 catalog models priceable. This rules out a reported scoring backlog or current full-storage condition, not inaccurate individual verdicts.
- The machine-local `C:/Users/yzger/.filtrsoft/paused` flag is absent. At least one older daily-log entry explicitly skipped because paused; subsequent dated runs were attempted. No exact historical pause duration is established.
- `Filtrsoft Daily Crawl` still invokes `C:/Dev/filtrsoft/scripts/daily.cmd`. Both daily and startup-agent wrappers change directory to `C:/Dev/filtrsoft`, still commit **e5a7023**, engine 0.3.33. The updated production/backend implementation is in `C:/Dev/filtrsoft-backend`; deployment did not update these laptop launchers. Shared checkout has preexisting detail.tsx and types.ts edits; preserve them.
- The old daily runner uses `p.kill()` on timeout. The newer runner fixes Windows process-tree cleanup, but the scheduled laptop task is not running it. Recent daily logs contain Facebook timeouts, Chrome launch failures and interrupted/incomplete runs. Last complete combined Facebook/OfferUp summary in this log is September 8. September 14 started at 10:00 EDT, reported a Facebook gaming-PC timeout around 10:21, then began graphics-card search with no later completion summary.
- Task Scheduler last run: September 14 10:00:10 EDT; result `0xC000013A`; state Ready, next September 15 10:00 EDT. Machine booted September 14 21:40 EDT; startup agent log records a launch at 21:41, but no active Filtrsoft crawler was found at diagnosis time. The log does not establish who or what terminated the process.

## Local ingestion measurements (not production arrival counts)

Read `C:/Dev/filtrsoft/filtrsoft.db` with SQLite URI `mode=ro`, without importing application modules or applying migrations.

| Source | Latest newly captured listing (UTC) | New in 24h | New in 7 days |
| --- | --- | ---: | ---: |
| Facebook | September 13 17:18:50 | 0 | 45 |
| OfferUp | September 8 14:44:49 | 0 | 15 |
| Mercari | September 4 23:04:23 | 0 | 0 |

The local Craigslist copy was last captured September 5. This does **not** diagnose production Craigslist; Railway collects it separately. Local captures also do not prove a completed upload, especially where the daily job stopped before its push phase.

## Conclusion and remaining boundary

There is a demonstrated collection/reliability gap beyond a pause: missing current laptop runner, stale launch targets and incomplete browser crawls. Fix and verify laptop collection and acknowledged upload before changing valuation thresholds. The remaining engine question requires authenticated production arrival/verdict cohorts, including current Craigslist and the reasons recent listings receive insufficient-data or pass. Public health cannot answer that. The browser diagnostic attempt was unavailable; no session or access controls were bypassed.

Next implementation: preserve the shared checkout edits, prepare a current dedicated laptop runtime using the existing database/profile ownership, update both launch paths, verify one bounded unpaid crawl and its upload acknowledgement, then inspect production new-arrival verdicts. Do not start duplicate browsers or loosen exact-product comp guards.
