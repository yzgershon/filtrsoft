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

Production verification is pending the application push. Final results will be written to `2026-09-09-tabbed-detail-release.json` and HANDOFF.
