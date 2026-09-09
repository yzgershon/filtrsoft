# Frontend fixes with the current design

Yish chose to keep Filtrsoft's current visual design. The visible design changes are limited to search at the top, removal of promotional mobile headlines, and restrained functional page titles where useful. The three alternative layouts are not selected. Potential features will be shown separately in the existing style.

## Work plan

1. **Current shell and navigation:** top search, concise page titles, restore each tab's query/position, route title/focus, accurate settings destinations, complete Saved tabs. Preserve desktop layout and the current card/colour system.
2. **Read/write reliability:** explicit loading/error/empty states and retry for Saved/Purchases; screen error containment; confirmed outcome and alert writes; correct outcome enum; preserve drafts on failure.
3. **Data contracts:** exact saved-search text/category/source/price/call criteria independent of notification permission; safe legacy handling; purchase totals distinguish unknown paid amounts, estimates and actual transactions.
4. **Listing detail and offline:** consistent selected-channel math, shared photo overlay and image recovery, show exact identity/missing facts/seller evidence using current components, account-safe service-worker behavior with real offline/session-transition tests.
5. **Feature preview:** optional comparison, captured-batch review progress, personal notes/inspection or deal stages in the existing visual system. Synthetic local state only; future feature previews do not become live product features automatically.
6. **Verification and completion:** targeted API/browser regressions, existing tests/typecheck/production build, compiled CSS, 360/390/430 mobile and 768/1024/1440 desktop/tablet, keyboard/Back/reduced motion/network failures, handoff and commit. Standing authorization to push main/Railway exists; verify the concrete release before shipping.

Root is the only editor in `C:\Dev\filtrsoft-backend`, branch `codex/frontend-redesign`, starting clean at `46abf65`. Three agents provide read-only implementation reviews. Shared checkout, databases, archive, crawling and exact comp guards are preserved.

## Progress

- [x] Scope and current Git state confirmed; alternative designs superseded.
- [x] Shell, headlines, navigation and accessibility.
- [x] Read/write reliability.
- [x] Saved-search and purchase contracts.
- [x] Detail and offline correctness.
- [x] Current-style feature preview.
- [x] Regression, build and visual verification.
- [ ] Final handoff, commit and release status.

Implementation checkpoint: source changes are complete for phases 1–4. Targeted regression and browser review exposed and fixed overlapping PATCH, paused legacy notifications, auth/deep-link timing, hash scrolling, photo cropping, stale reads, and outcome retry duplication. Validation and feature preview are in progress. Nothing from this pass is deployed yet.

Release checkpoint: all 268 tests / 763 assertions pass locally and in network-isolated native Linux ARM, typecheck/build pass, both Linux images build, and all 39 browser groups pass. Final assets: index-CIJd4S-Z.js and index-DJ892ZD4.css. Full changes and limits: FRONTEND-FIX-REPORT-2026-09-09.md. Next is the authorized non-force main push and verification of CI, Railway status and live asset hashes.
