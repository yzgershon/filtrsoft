# Tabbed listing details and light mode

Yish requested a structural restyle after rejecting the stacked report. Root edited only `C:\Dev\filtrsoft-backend` on `codex/frontend-redesign`, from clean commit `7271d9a`. Shared main/database/crawls were not edited or re-scored.

## Result

- Four panels: Decision (valuation and offer math), Specs (seller/recorded-photo facts), Evidence (comparable sales and original seller text), Inspect (concerns, seller questions, pickup checks). Tabs support keyboard navigation and reload via `?tab=` without adding Back stops.
- Swipe hero fills its frame, with count/pips and overlay Back. Full-screen photos retain uncropped viewing. Linked title replaces the separate external-listing action.
- Review, Share and recoverable Remove are in a compact action bar. The route animation no longer creates a containing block that pushes fixed controls below the screen. Removal filters account feeds, saved items, pulse and future alert delivery; Undo and Settings restoration are available. It does not globally delist or delete evidence, outcomes, saved state or training labels.
- Comparable sales shows three records by default, expands the remaining recorded examples and links valid recorded eBay item URLs. Unavailable URLs are explicitly unlinked, never fabricated. Read-only local audit found zero missing URLs among 31,900 eBay comp rows.
- One seller-question copy action, with exact text and confirmed clipboard success/error feedback.
- Light/Dark/System appearance persists, applies before first paint, responds to OS changes, and covers app chrome, menus, fields, verdicts and full-screen viewing.
- Specs preserve exact values/variants, separate drives and kit layout, sources, unresolved differences and missing fields. They use the displayed decision's frozen facts and recorded vision, not catalog defaults or a new paid run. Unreadable and unstructured photo evidence remain visible. No claim of exhaustive reading of unprovided or unread photos.
- Engine 0.3.35 removes optional-crypto false alarms. An exclusive payment demand is required for IRREVERSIBLE_PAYMENT; cash alternatives and mere platform checkboxes do not qualify.
- Cards try the cached thumbnail and up to three ordered gallery URLs. Facebook detail extraction preserves its own item-card thumbnail if the detail gallery has not loaded; it rejects a card from another item.

## Photo investigation

Read-only shared local snapshot: 4,481 non-delisted rows. Craigslist: 3,452 total, 3,187 with photos/cached thumbnails. Facebook: 459 with photos, 361 cached. Mercari: 92 total, 82 with photos/cached. OfferUp: 478 total, 476 with photos, 472 cached.

Ten sampled no-photo Craigslist pages returned 200 without product-image markup. Two checked in actual Chrome also had no gallery (only map tiles). Those blanks are not demonstrated parser failures. Three sampled uncached Facebook URLs returned 403; each signature expired August 29. A fresh capture through the existing browser agent is required for expired remote URLs. No duplicate crawl, login, credentials, paid vision, or data replacement was used here. The fallback prevents a broken first URL or cache response from hiding a working later photo; it cannot revive expired signatures or invent missing source photos.

## Verification before push

- Windows Bun: 280 passed, 0 failed, 814 assertions.
- Network-isolated Linux ARM64 Bun: same 280/0/814, typecheck passed.
- Vite production build and pinned Linux production image passed. No dependencies installed on the host.
- 53 built browser check groups: 15 frontend, 9 mobile polish, 9 workflow, 6 offline service-worker, 14 tabbed-detail checks. No browser page errors.
- Responsive cases at 360, 390, 430, 768, 1024 and 1440 px; large text, landscape, reduced motion, theme persistence/OS changes, clipboard denial, removal errors and account restore, tab keyboard/history, live selected-channel arithmetic and photo fallback.
- Manually inspected built dark/light screenshots, including mobile seller questions, three comp links, theme/filter/review menus and desktop detail.
- UI testing uses synthetic API fixtures. Public production health/assets will be checked after deployment; authenticated live workflows are not claimed as tested.
- Deployment archive unchanged: SHA256 `0285af42b39f7d9105882ba52591d311823b6b8cf790aa871161862b1ea3e635`.

Application commit `0c18f9fe6861288d682bdfcdcacce0551577a589` was pushed to main. Railway deployment `6361702793` succeeded at 2026-09-10 00:02:41 UTC. CI run `34419490476` passed on native amd64, including 280 tests / 814 assertions both directly and in the isolated Docker image. At 00:03:41 UTC the public JS/CSS hashes and worker/manifest matched the local build exactly; the private feed/pulse still returned 401 without a session. Production runs engine 0.3.35, database healthy, 31,900 total comps. The scheduler's stored re-score is still in progress with no failures; its completion is being monitored before closing the release.

## Final live-data correction

Read-only UI inspection used Yish's existing signed-in Chrome tab, without logging in, handling credentials, submitting labels or removing records. Actual listing 4254 displays the new tabs and gallery, a linked source title, three recorded eBay item links, and the single Copy questions action with the review/share/trash bar. The source text exposed two specification boundary failures: the flattened Extras section was included in Case, and a 3.5-inch AIO LCD was shown as the computer display. Extras now remain in additional evidence and component-labelled screens do not become host Display. Exact case, GPU variant, RAM kit and accessory preservation are covered by the live-text regression.

The same inspection found that clicking a pinned tab used its sticky viewport rectangle, leaving a new panel's beginning above the viewport. Tab changes now anchor to the workspace. A new built-browser regression switches from long expanded evidence at both 390 and 1440 px, with and without motion, and confirms the first panel content is below the tab strip.

Final local tests: **282 pass / 0 fail / 824 assertions**, Windows and network-disabled Linux ARM64. Typecheck and pinned build pass. **15 tabbed browser groups pass**, 54 groups across the release, with no browser page errors. Physical-phone testing and live account mutations are not claimed.

## Final release verification

Final correction `7e5374a1f2962d47761c613504d84809c8d43216` was pushed to main. Railway deployment **6361897832 succeeded at 2026-09-10T00:19:53Z**. Native amd64 CI **34420787710 passed**, including the complete host suite, TypeScript/Vite and the network-disabled Docker suite/build. At **2026-09-10T00:20:29.272Z**, served JS `index-1wGjf14k.js` and CSS `index-DhEv3KMU.css` match the tested bytes, worker/manifest match, and private feed/pulse remain 401. Production engine 0.3.35 has **0 pending / 0 failures / complete** re-scoring, database healthy, 31,900 total and 28,745 usable comps. The archive is unchanged.

Reloading the existing signed-in live tab verified the final correction on listing 4254. Case ends at `tempered glass`; cooler retains `3.5" LCD` without inventing a computer Display; all Extras are present in Additional evidence. After switching from expanded long Specs to Inspect, the first panel begins at y=151 below the tabs ending at y=136, with document width equal to the 1440px viewport. No account mutations were performed. Release is complete; closing evidence is committed locally without another production deployment.
