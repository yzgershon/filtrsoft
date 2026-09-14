# Market history, access and storage recovery

## Implemented

- Price history is a dedicated desktop navigation item and mobile More destination, connected from listing details and hardware comparisons. Search the existing catalog, pin up to 50 products per account, and share or revisit a product's URL selection.
- Ranges: 1 month, 3 months, 6 months, 1 year, 3 years, all available history. Charts use observed sold prices, medians, middle-50% ranges and recorded sample counts. Missing periods are gaps. Empty charts show no dollar scale. Inspect intervals by pointer or keyboard, open actual eBay source links, view a data table or export all matching rows within the disclosed collection cap. Export preserves the selected configuration even if the default changes later.
- Explicit hardware configurations and conditions remain separate. RAM layout/latency/RGB/ECC, GPU board/series/memory, phone storage/network, and stated whole-machine specifications are retained. Conflicting capacities, different variants, bundles and whole machines cannot silently price a component chart. Unstated specifications are labeled; no seller specification is filled from a manufacturer assumption.
- Shipping is optional and explicit: delivered-price charts omit unknown shipping instead of treating it as free. Period change requires at least three observations in both endpoint intervals. The chart does not alter verdict rules.
- Follow-up questions require the account's actual click to the original seller ad, wait at least one day, expire after fourteen days, and respect dismissals, outcomes and removed listings. Report views alone never qualify. The browser shows at most one eligible prompt per day. Settings copy describes the new behavior.
- Signup is open again by default. Google sign-in shares a retryable script loader between signup and signin, handles loading/timeouts/errors, and avoids duplicate submissions. Public privacy details describe actual account and seller-click data. Google configuration is a separate pending external step below.
- Fixed a global `.active` style leaking into selected navigation and chart controls. Mobile charts retain readable labels and aligned 44px range buttons. Both themes use existing app tokens. The unused background animation is retired.

## What the archive actually supports

The unchanged archive contains 31,900 comp rows. The September 14 01:19 UTC read-only audit accepted **25,354 historical sale observations across 496 of 547 non-console catalog products**, with 5,699 excluded. These counts span conditions and configurations; they do not mean every product has a complete chart.

Memory coverage is particularly thin: 18 accepted observations across five memory products, and zero accepted storage observations. Older observations are sparse. **The feature has a three-year range, but universal three-year history and the requested measured RAM price spike are not supplied by this archive.** No history was invented or sourced by loosening comp guards. Detailed counts: `docs/qa/market/archive-audit.json`.

Free longer-history sources researched: [eBay Product Research](https://www.ebay.com/help/selling/selling-tools/terapeak-research?id=4853) offers up to three years for sellers; [Pangoly](https://pangoly.com/en/price-trends) tracks retail prices. Links in the app label retail evidence separately. No paid provider or new comp crawl was launched.

## Storage recovery

The feed outage was SQLITE_FULL on the 5 GB Railway volume. Recovery removed only a proven byte-identical backup verification copy, retained the original backup/manifest, and introduced bounded in-memory feed cursors. Hourly scheduling revisions no longer duplicate otherwise identical evidence.

After the pilot and full lossless maintenance, **714,958 historical payloads** were compressed. All **739,094 rows observed in the final readback** decoded without checksum failure, **zero latest payloads were compressed**, and SQLite `quick_check` returned **ok** at 2026-09-14T01:17:03.683Z. Normal application writes continued during recovery. Reusable SQLite capacity measured **1,203,003,392 bytes**; filesystem available space was **97,718,272 bytes**. These are different measurements: the physical database file did not shrink. Historical IDs, versions, calls and timestamps remain; no unique verdict was deleted.

New changed verdicts now compress the superseded payload in the same transaction, while the latest answer remains normal JSON. A failed archival update rolls back the new answer too. Reversal and maintenance commands: `docs/STORAGE-RECOVERY-2026-09-13.md`. Keep decoder compatibility when rolling back application code while historical compressed rows exist. Filesystem headroom remains low and should remain visible in operations; reusable pages are not a claim of extra volume capacity.

## Verification and remaining boundary

Final Windows and network-disabled Linux ARM64 suites passed **328 tests / 0 failures / 951 assertions**. TypeScript, Vite and the pinned Linux image build passed. The built image also served the public privacy document correctly, rather than returning the SPA fallback. The final release source includes automatic atomic archival and the complete CLI regression.

Browser QA used the real local API, disposable accounts and the packaged archive. Verified catalog search, CPU/phone/memory selection, retained pins, URL range changes, a compact picker, keyboard inspection, empty-history honesty, and mobile/desktop light and dark presentation. Measured phone viewport 360 CSS pixels with 12px chart text; app content matched its client width. Browser emulation is not a physical-phone test. Authenticated production checks and final public release hashes are recorded separately after deployment.

Google Cloud project **filtrsoft** and branding exist with Yish's approved support/developer address. The Web application client **Filtrsoft Web**, origin **https://filtrsoft.com**, no redirect URIs, is prepared but awaits Yish's Create click under his credential rule. Configure only the public `GOOGLE_CLIENT_ID`, then verify both forms and let Yish perform actual Google sign-in. No personal auth token, client secret, mailbox/Drive access, purchase, login automation or hosting-plan change is needed. Google sign-in is **not claimed live** until that configuration and manual sign-in are verified.
