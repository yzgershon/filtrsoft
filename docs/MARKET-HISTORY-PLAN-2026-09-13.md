# Filtrsoft repair and market history

September 13, 2026. Root is the sole editor; shared checkout and live database are preserved.

1. Reproduce and repair the authenticated feed error. Add a real API regression and give server failures accurate, recoverable UI messages.
2. Reopen signup by default. Finish Google sign-in/signup states, error handling and configuration instructions, retaining session and account isolation. Configure the actual public client ID when available; never substitute a personal token.
3. Replace outcome eligibility with account-owned original-listing click records. Do not migrate ordinary viewing history into interest. Keep dismissal and completed outcomes durable, with a sensible delay and expiry.
4. Measure the archive's sale dates and variant fidelity. Research free long-term data. Add a market catalog and interactive exact-product price chart with ranges, touch/keyboard inspection, sample counts, source links and honest gaps. Separate sold evidence from retail asking prices.
5. Integrate market history into listings and comparisons; add useful market navigation and controls without changing conservative verdict guards.
6. Verify real API flows, adverse data, both themes and mobile/desktop; run appropriate release gates, update handoff, push main and verify Railway plus authenticated production feed.

Current progress: storage recovery is applied and audited, preserving every historical verdict and creating about 1.2 GB reusable SQLite capacity. Physical free space remains low; the file did not shrink. Signup is open. Seller-click follow-ups and Market are implemented, integrated and browser-checked against an isolated real API. Both Windows and Linux passed 327 tests before the final automatic-archival addition; final gates are running. Google project and branding exist; Yish must complete the prepared client creation. Market/auth/follow-up feature deployment and authenticated live verification are next. Shared checkout/database and crawl/archive remain untouched.

Recovery checkpoint: Railway logs identify SQLITE_FULL in feed cursor persistence and background crawls. Volume at 5 GB / 100%. Bounded in-memory cursor windows remove writes from feed reads; signup defaults open; storage health and guarded SQLite checkpoint plus startup diagnostics are prepared. 314 tests / 915 assertions pass on Windows and Linux ARM64, with TypeScript and Vite. No records deleted or hosting plan changed. A small recovery release comes first; Google, outbound follow-up and market history remain active work.
