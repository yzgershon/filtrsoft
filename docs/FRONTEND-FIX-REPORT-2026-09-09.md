# Current-style frontend fixes

Yish chose to keep the shipped design. This pass puts search first, removes the Discover pitch and sidebar slogan, and makes functional page headings compact. The existing mobile cards, colors, menus and full desktop app remain the visual basis. UI/UX Pro Max informed accessibility and interaction checks; none of the three alternative layouts was selected.

## Corrections

| Area | Result |
| --- | --- |
| Search and navigation | Search is the first feed control. Saved searches are accessible beside active filters. Returning to a tab retains its query and position; Back restores card focus. Titles, Saved keyboard tabs and Settings section links work consistently. |
| Failed requests | Saved and Purchases distinguish errors from empty results and offer retry. Invalid payloads are rejected. Screens have error containment. Search edits retain drafts and removal waits for confirmation. |
| Saved searches | Account-owned searches save without notification permission and retain text, category, source, call segment, price and sort. Opening them reconstructs exact feed filters. Ownership guards, stable IDs and delivery history survive migration. Incomplete legacy criteria are visibly paused for review; editing them does not silently enable notifications. |
| Notification races | Changed matching criteria reset the delivery watermark; identical retries do not. Delayed partial edits cannot revert newer changes. Delivery rechecks current criteria and consent before each candidate. Expired endpoints preserve custom searches. Stale reads cannot overwrite confirmed mutations. |
| Outcomes and purchases | Gone sends `dead_listing`. Failed/uncertain responses do not claim success. One account-scoped submission ID prevents a retried prompt from duplicating a purchase; conflicting answers return 409. Paid amounts stay unknown when unrecorded. Current estimates, frozen decision evidence and complete realized profit are reported separately. Totals use only correctly paired records and disclose the latest-200 limit. |
| Listing evidence | Numbers and Offer calculator share the selected resale channel. Offer selection survives switching channels. Sold comps remain accessible without offer math. Exact matched identity, missing facts and verbatim seller descriptions are visible. |
| Photos and overlays | Gallery images preserve the full photograph. Unavailable photos have retry. Photos use the shared Back, Escape, focus and inert-background contract. The decorative sheet handle is removed. |
| Session and offline | Private API responses are network-only, including writes. Legacy Filtrsoft caches are retired without touching unrelated caches. Coherent public app shells update only when referenced assets exist and have the right MIME types. Storage failures do not discard valid network responses. Auth responses cannot override a newer sign-in/out; detail/share links wait for sign-in and resume. |
| Rendering | Critical metadata is more readable, search has visible focus, and the broad legacy card blur is removed. CSS is checked after minification. Reduced motion and large text remain supported. |

## Separate feature preview

Run `node src/browser/feature-preview.mjs`, then open **http://127.0.0.1:3194/**.

- Compare two or three saved examples, including explicit unknown values and pickup checks.
- Review a captured three-item batch, make a deliberate Your call choice, Undo it, or move Next without recording anything.
- Keep personal notes and inspection checks independently of seller/engine evidence.

This entry reuses current components and styles. It is excluded from the production entrypoint. Examples and state are synthetic and held in memory; reload resets them. No prototype writes to the API or requests notification permission. The old A/B/C studio remains historical and unselected.

## Verification

- **268 tests, 0 failures, 763 assertions**, locally and in the pinned native Linux ARM verification image with networking disabled.
- TypeScript and Vite production build pass; final serving image builds.
- **39 browser scenario groups pass:** existing redesign 15, mobile interaction 9, new frontend/session/feature checks 9, and real installed-service-worker checks 6.
- Built layouts checked at 360/390/430/768/1024/1440, with additional existing 375/landscape checks. Keyboard, Back/Forward, reduced motion, larger text, request failures, signed-out deep/share links, delayed auth, exact search edits, selected-channel math and photo containment are covered.
- Actual worker checks cover old-cache upgrade, A/B API identity, HTTP status preservation, offline writes, first offline launch, newer shell adoption, HTML masquerading as JS, and active-worker CacheStorage failures. Cache failures are injected after activation; these results do not claim quota-failure installation was verified.
- Screenshots and machine-readable results: `docs/qa/frontend-fixes`, `docs/qa/mobile-polish`, `docs/qa/frontend-redesign`. All use synthetic data. No authenticated production session, real handset performance, push delivery or seller interaction was claimed.
- Local amd64 cross-build hit the documented QEMU segmentation fault. Native Linux ARM builds/checks passed. Native amd64 CI is checked after the authorized push.

The engine stays at **0.3.34**. No comp filter, archive, crawl, shared checkout or shared local database was edited. Archive SHA-256 stays `0285af42b39f7d9105882ba52591d311823b6b8cf790aa871161862b1ea3e635`.

## Release

Application commit `b45769831645dc1826a7df6bb9ce214086897675` is pushed and live. Railway succeeded; public HTML and asset hashes matched the tested build at 2026-09-09T19:15:36.072Z. Health is engine 0.3.34, database ok, 31,900 total / 28,791 usable comps and scoring 0 pending / 0 failures. Initial CI had one existing isolated-fixture timeout at 5000ms; its allowance is being aligned with the existing Docker verification harness before rerunning. See HANDOFF and `docs/sessions/2026-09-09-frontend-fixes-release.json` for completion evidence.
