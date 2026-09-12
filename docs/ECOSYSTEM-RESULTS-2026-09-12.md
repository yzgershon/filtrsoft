# Filtrsoft ecosystem release: September 12, 2026

**Pushed and live:** `d04ce5d5db783ffa91ac3df3f28f025d7cb4d788` on main. Railway deployment **6412820697** succeeded at 18:13:54 UTC. [Native Linux CI 34710515278](https://github.com/yzgershon/filtrsoft/actions/runs/34710515278) passed. Production verification completed at **18:17:02 UTC**. The feature release changed 44 files, with 1,169 insertions and 79 deletions, including tests, research and the synthetic concept.

## What changed for Yish

| Workflow | Result |
| --- | --- |
| Private access | New password/social registrations are closed by default. Existing accounts retain access. Private entry replaces public signup. Thumbnails and detailed diagnostics require a session. |
| Listing evidence | Evidence tab includes asking-price history with exact cents, observation dates and paged chronological records. Later historical backfills do not look like new price changes. Unavailability never becomes a claimed sale. |
| Pickup | Inspect tab has account-owned checklist answers, per-check observations and private notes. Saves survive reload. Changed questions, listing text or photo URLs invalidate stale answers. Engine concerns remain independent. |
| Buying and selling | Purchases supports inventory/sold filters, sale price/date/platform, fees, shipping, repairs/travel/other costs and corrections. Recorded profit requires every cost to be known. The original engine decision stays frozen. |
| Drafts | Inspection and sale forms retain unsaved work in the current browser tab. Stale revisions are offered for recovery. Failed saves do not claim success. Other devices cannot silently overwrite a newer revision. |
| Purchase totals | Inventory totals exclude sold records. Realized profit is separate from estimates. Missing historical costs stay unknown until entered. The latest-200-record limit and summary scope remain explicit. |
| Operations | More > Pipeline status shows laptop connectivity, comp coverage, scoring backlog/failures and recent collection/sweep information. Offline laptop collection is distinguished from server Craigslist collection. |
| Money and comparisons | Shared money formatting preserves decimal cents instead of rounding them away. Compact GPU spellings retain exact Ti/Super/XTX/D-v2 variants. No comp filter or gaming-data guard was relaxed. |

## Backend and frontend reliability

- Listing facts and their price history now commit atomically. A failed history write rolls back the changed facts.
- Stored listing reads/writes, remote source checks and authentication use separate bounded rate buckets. Ordinary review no longer exhausts the crawl/sign-in allowance.
- JSON requests have a 15-second deadline including stalled response bodies, with a visible recovery path.
- Archive status caches verified metadata, invalidates when the file changes and reads import acknowledgements freshly. Full import validation remains.
- Inspection and purchase editor code loads when opened. Recovery boundaries handle a rejected screen download without blanking the rest of the interface.
- Mobile forms use explicit accessible labels, complete touch targets and sticky sale actions. Both themes and phone/landscape/tablet/desktop layouts were checked against the compiled bundle.

**Performance measurement:** six local archive-status reads originally took 539, 427, 401, 424, 358 and 340 ms. With the cache, the cold read took 345.47 ms and warm reads took 0.18, 0.04, 0.04, 0.03 and 0.03 ms. This measures one function on the ARM laptop, not general app speed or a production latency guarantee. Final initial JS is 351.85 kB / 104.77 kB gzip; the new workspace and sale editor are separate deferred chunks.

## Verification and its limits

- **311 tests, 0 failures, 907 Bun assertions** on Windows and Linux ARM64. The final photo-change regression also passed locally; final native amd64 CI passed its full suite, typecheck, Vite, network-disabled verification container and production image.
- **31 browser groups passed:** 10 real-API workspace groups, 15 existing listing-detail groups, 6 comparison groups. Workspace checks used synthetic accounts, generated thumbnail pixels and a disposable database with external fetches disabled.
- Separate AfterBuild concept checks passed at 360, 768 and 1440 px, including both perspectives, both sample cases and source/reply dialogs.
- The actual production image booted in an isolated container, imported 31,900 archived comps and served the compiled UI. Collection was disabled and no host database or volume was mounted.
- Live production served all five JS/CSS assets with matching SHA-256 hashes. Anonymous data endpoints returned 401; an empty signup request returned 403 with registration closed. No real account was created and no production inspection or sale record was edited during verification.
- Live health at the final read: engine **0.3.35**, DB healthy, **31,900 total / 28,567 usable comps**, **492 priceable models**, **0 pending / 0 failed re-scores**. The archive was not refreshed by this pass.

The receipt is `docs/qa/workspace/production.json`. Browser receipts live beside their harnesses' screenshot output under `docs/qa`. An early deployment verification request timed out; subsequent endpoint reads and full asset verification succeeded. No continuous latency claim is made. These checks are not a physical-phone test or an authenticated production workflow test.

## What remains an operational constraint

The last pre-deployment production observation showed the laptop agent offline, with its last contact on September 10. No laptop process, browser session or scheduled crawl was started by this pass. Evidence still ages out of the 90-day valuation window. More > Pipeline status now exposes these constraints to the signed-in account.

Verified free native gaming FPS coverage remains unavailable. Rendering references are still labeled as rendering, and missing exact hardware data remains unknown. New registration closure is not an allowlist: it does not revoke previously existing accounts.

Shared `C:\Dev\filtrsoft` and its database were preserved. Its existing `web/src/detail.tsx` and `web/src/types.ts` edits remain. Work was implemented in `C:\Dev\filtrsoft-backend`; no shared checkout reset, database re-score, duplicate crawl, paid vision call, seller message, credential handling or new service purchase was performed by Codex. Deployment starts the project's existing production scheduler as usual.

## The non-arbitrage business

Recommended experiment: **AfterBuild**, a delivery and after-sale support workspace for independent gaming-PC builders. Each buyer gets the exact machine's handoff; support later compares supplied evidence with that baseline and preserves actual resolutions. Revenue would come from builder subscriptions, not distributing the same scarce local deals.

The [opportunity report](AFTERBUILD-OPPORTUNITY-2026-09-12.md) includes first-party competitor evidence, the proposed $29/month paid pilot, explicit counterarguments and validation thresholds. Existing products already offer diagnostics and snapshot comparisons. The proposed advantage is a focused, low-friction customer handoff/support workflow, and demand has not been established.

The [interactive local concept](prototypes/afterbuild.html) is synthetic and separate from the production app. Serve it with `node src/browser/afterbuild-preview.mjs` at `http://127.0.0.1:3212/`. It does not scan hardware, collect data or send replies. Product naming, customer outreach, a paid pilot and any public launch remain future decisions.
