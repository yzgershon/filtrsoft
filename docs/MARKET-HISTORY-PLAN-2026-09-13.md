# Filtrsoft repair and market history

September 13, 2026. Root is the sole editor; shared checkout and live database are preserved.

1. Reproduce and repair the authenticated feed error. Add a real API regression and give server failures accurate, recoverable UI messages.
2. Reopen signup by default. Finish Google sign-in/signup states, error handling and configuration instructions, retaining session and account isolation. Configure the actual public client ID when available; never substitute a personal token.
3. Replace outcome eligibility with account-owned original-listing click records. Do not migrate ordinary viewing history into interest. Keep dismissal and completed outcomes durable, with a sensible delay and expiry.
4. Measure the archive's sale dates and variant fidelity. Research free long-term data. Add a market catalog and interactive exact-product price chart with ranges, touch/keyboard inspection, sample counts, source links and honest gaps. Separate sold evidence from retail asking prices.
5. Integrate market history into listings and comparisons; add useful market navigation and controls without changing conservative verdict guards.
6. Verify real API flows, adverse data, both themes and mobile/desktop; run appropriate release gates, update handoff, push main and verify Railway plus authenticated production feed.

Current progress: application release **20df920** is pushed to main and verified live, Railway **6428823295** succeeded, and native CI **34796210266** passed. Final Windows and Linux suites passed **328 tests / 951 assertions**, plus TypeScript, Vite and pinned image checks. Production Review renders ten listings without a random outcome prompt; the new market catalog and 3M/3Y CPU chart load real sales. Public asset hashes match the build and registration is open. Storage recovery preserved every historical verdict and created about 1.2 GB reusable SQLite capacity; physical free space remains low and the file did not shrink. Google project and branding exist, but the prepared OAuth client Create click and public client ID configuration remain with Yish. Historical RAM/storage coverage remains sparse; universal three-year history is not supplied by the archive. Shared checkout/database and crawl/archive remain untouched. Results and release receipts: `docs/MARKET-HISTORY-RESULTS-2026-09-13.md` and `docs/qa/market/production.json`.

Earlier recovery checkpoint (superseded): Railway logs identified SQLITE_FULL in feed cursor persistence and background crawls, with the 5 GB volume full. The initial 314-test recovery release preceded the completed feature release above; no hosting plan change was made.
