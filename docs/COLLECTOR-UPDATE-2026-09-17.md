# Apply the September 17 collector repairs on the OMEN

This is an update to the installed collector, not a new installation. The laptop
must remain paused. The server must already be serving engine **0.3.37** before
this runtime starts sending the new availability/enrichment sync fields.

## Follow-up after the first successful update

The OMEN on `b8730555bb8a` completed job 43 at 18:32:55 UTC, with all sources
reporting ok and production scoring caught up. Six previously recommended
Facebook/OfferUp listings were confirmed gone. Fresh Mercari seller text also
correctly changed #8154 to RISK.

That run exposed a remaining Mercari breadcrumb bug: its exact title appears
before the real item heading, causing unknown availability and withholding the
current ItemPrice. The final follow-up on main captures the actual h1 panel
separately from recommendations and passes 384 tests. Merge that follow-up into
the existing runtime using the preservation steps below. Recheck exact item
`m87685110404` from current source evidence, including its dedicated ItemPrice,
availability and broken-condition disclosure, then verify the upload. The source
showed $529 during the laptop's 18:34 UTC read; do not hardcode that historical
price or revive a listing based on this note. The production price remained $599
until a successful new read. Preserve all local state and keep the laptop paused.

## Inspect and preserve

Read `HANDOFF.md`, this document and the installed runner's `config.json` first.
Inspect actual host, runtime path, `git status`, recent commits and runner state.
Production last reported the desktop at `a91943a1c898`, which was not in the
laptop's fetched main. Preserve those commits and any uncommitted desktop work.
Do not reset to origin/main or replace its whole Dev directory.

Use configuration paths without printing the environment file or tokens. Keep
the existing node identity, ingestion database, outbox, browser profiles, startup
configuration and primary-host preference. Do not run the installer again.

## Update the existing runtime

1. Stop its own supervisor using the installed state folder's `stop` mechanism.
   Verify its recorded processes and browser children exit. Leave unrelated
   Chrome, Bun and other apps alone. A stopped supervisor must not race Git edits.
2. Make and restore-verify a consistent local ingestion backup using the existing
   backup script and configured database path. This is not a production-account
   backup. Do not copy an active SQLite database as a standalone `.db` file.
3. Fetch main from the existing private repository. Review the diff and merge
   the released main into a local update branch retaining the desktop's setup
   commits. Resolve real conflicts explicitly. If the runtime is clean and has
   no divergent local commits, an ordinary fast-forward is sufficient.
4. No dependency change is required by this release. Use the installed native
   Node/Bun and existing dependencies. Run typecheck and the collector, sync,
   actionability and ownership tests with isolated fixture databases.
5. Start the existing generated `start.cjs`. It clears its supervisor stop flag.
   Preserve the desktop's prior pause state; resume collection only if it was
   running before this maintenance. Keep paid desktop vision off.

## Verify actual operation

- The server reports the new desktop revision and the same node identity.
- It remains the only active primary; laptop collection stays paused.
- The job reports receiving production repair targets and runs up to 20 detail
  reads per source, with at most 18 discovery cards planned per source.
- Record actual successful detail counts, unavailable rows and upload receipts.
  A login/challenge is not a successful empty crawl; Yish handles sign-in manually.
- Confirm the server receives both seller text timestamps and availability
  outcomes; scoring finishes with no failed checks. Recheck live BUY/VERIFY
  listings, including source identity and current condition disclosures.
- Mercari #8154 (`m87685110404`) disclosed an untested RX 7900 XTX and later
  explicitly added "for parts". Read its current source facts before claiming
  that new wording or $529 ask reached production. Do not manually assert facts
  from this historical note. Facebook #5299 is a Legion T5 desktop, not a laptop.
- Observe the normal alert pipeline. A push-service acceptance is not proof of
  phone display. Settings now reports registered devices and last accepted push;
  verify the phone separately, without enabling another laptop subscription.

Record the merged runtime revision, collector receipts and live results at the
top of `HANDOFF.md`. Do not claim a decreasing can't-tell count from code alone:
missing descriptions and exact sold configurations require successful collection.

## Scope and limits

The release adds condition/identity guards, fair per-item detail retry, exact
source-page availability, production-to-collector repair work, independent sync
clocks, hourly bounded comp maintenance and independent notification delivery.
It does not increase vision budgets, loosen sold-product guards, import an older
comp archive, install software, change account credentials or alter billing.
Production backup/physical storage recovery remains a separate unresolved
operational item documented in `HOBBY-STORAGE-PLAN-2026-09-15.md`.
