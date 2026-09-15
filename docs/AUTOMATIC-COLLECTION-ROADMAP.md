# Reliable automatic collection

Yish approved permanent automatic collection on September 15, 2026. The existing
Windows laptop now runs the reviewed collector. The gaming PC remains a future
host; no software or marketplace sessions have been configured there.

## Installed foundation

- Dedicated runtime: `C:/Dev/filtrsoft-agent`, revision `d3d116e`.
- A hidden logon shortcut starts the supervisor. The existing daily task recovers
  that same supervisor; a real task invocation exited 0 and retained the same
  supervisor and child PIDs, without a second collector.
- Existing startup command and task XML are backed up in
  `C:/Dev/filtrsoft-runner-state` with the `20260915095051` timestamp.
- Production observed the current collector online at 13:51 UTC. This verifies
  connectivity, not a completed unattended collection cycle or reboot test.
- Automatically scheduled job #10 was claimed at 13:53 UTC and its Facebook
  search was running at 13:54 UTC; the full cycle was still in progress.
- Process restart, stage deadlines, incremental uploads and single-owner locks
  are already implemented. Paid desktop vision is disabled.

## Recommended next work, in order

1. **Make collection health visible in the app.** An owner-only settings panel
   should show each source's last successful search, newest capture, challenge
   or login status, current work, pending uploads and collector revision. An
   online heartbeat alone must not imply successful collection. Escalate only
   sustained actionable failures and clear an incident after recovery.
2. **Establish unattended reliability.** Measure multiple complete cycles, then
   controlled sleep/resume, network interruption, child crash and logon recovery.
   Check that saved facts survive failures, duplicate work does not start, and
   stalled sources do not stop others. Keep actual receipts; elapsed time alone
   is not evidence of a successful long-running test.
3. **Make the gaming PC primary, with laptop fallback.** Use a dedicated runtime,
   separate local database and manually signed-in browser profiles. Add explicit
   preferred-host and fallback behavior; existing atomic server claims prevent
   duplicate job claims but do not implement a preferred host. Keep the PC awake
   while collection is desired. Turning off the display is fine; sleep prevents
   browser collection. Do not silently change Windows power settings.
4. **Improve discovery latency using measured capacity.** Start with the current
   45-minute gap after each completed browser collection job. Separate quick
   discovery from slower enrichment and sold-status probes, prioritize useful
   searches, and back off challenged sources. Choose a faster cadence from run
   duration, throttling and useful-capture measurements rather than assuming
   more parallel browsers improve results. Craigslist remains on Railway.
5. **Automate recoverable backups and tested updates.** Use consistent SQLite
   backups with retention and a restore check. Stop and verify the current
   runtime before advancing its checkout; preserve ingestion state outside it.
   Never update an actively running crawler's source or copy browser sessions.
6. **Add comp maintenance and local photo analysis.** Schedule bounded sold-comp
   refreshes separately from urgent listing discovery. Retain real dated price
   observations, including sparse periods. Trial local OCR/vision on the 4070 Ti
   against held-out examples before allowing results into valuation, and yield
   GPU work while gaming. These features are not enabled by this installation.

## Operating limits

Automatic startup works while signed into this Windows account and awake. It
does not turn a daytime PC into a 24-hour machine. Marketplace session expiry
and challenges can still need Yish's manual attention. No system can guarantee
new BUY calls: exact sold evidence and actual local supply remain constraints.

The next implementation priority is the source-health panel and measured
recovery checks, before expanding crawl frequency or adding GPU workloads.
