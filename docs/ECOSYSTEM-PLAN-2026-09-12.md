# Filtrsoft ecosystem improvement pass

Yish authorized a sustained implementation pass across the product and backend, plus research into a software business that does not compete for the same local deals. The scanner is now intended for private use. Existing authorization to push main and trigger Railway remains in force. No purchases, new paid services, credentials, messages or duplicate crawls.

## Baseline and ownership

- Sole editor: Codex, `C:\Dev\filtrsoft-backend`, branch `codex/frontend-redesign`, clean start at `75fc352`. Remote main remains `c85a75b`.
- Preserve shared `C:\Dev\filtrsoft`: main is `e5a7023`, with existing changes in `web/src/detail.tsx` and `web/src/types.ts`. Do not edit it or its database.
- Public health on September 12: engine 0.3.35, database healthy, 31,900 total / 28,567 usable comps. 118 discoveries and scores in the last day; laptop agent last polled September 10. Scoring has 554 pending / 0 failures at the observation, so the previous release's complete-scoring claim is not current. No crawl launched.
- Native gaming scores remain unavailable with the verified free data. Rendering is not gaming. Exact identity guards stay intact.

## Work plan

1. **Private access and trustworthy operations.** Close new public registration consistently for password and social signup, retain existing logins, and explain the private workspace clearly. Inspect expensive health/work queue behavior and stale data reporting. Verify changes with isolated fixtures.
2. **Evidence in the buying workflow.** Expose actual recorded asking-price observations, without pretending disappearance proves a sale. Add an account-owned inspection workspace with notes, explicit pass/fail/not checked answers, source context and concurrent-edit protection. Manual checks never change engine facts or silently resolve its risks.
3. **Close the money loop.** Let a purchase record receive a sale, explicit fees/shipping/other costs, notes and corrections. Keep the original decision snapshot, account ownership, unknown costs and a revision history. Add a compact mobile editing UI and useful inventory/sold filters. Reuse the existing outcomes ledger instead of a competing second purchase database.
4. **Quality sweep and release.** Review shared frontend request handling, responsiveness, comparison matching, pipeline/storage invariants. Fix measured defects. Run focused regressions, complete suite, TypeScript, compiled UI/browser checks, container/CI gates; push and verify actual production assets. Record remaining operational constraints candidly.
5. **Non-arbitrage product research.** Compare realistic adjacent opportunities against current competitors and pricing. Recommend one narrow paid workflow, with an evidence-backed differentiation hypothesis, economics, a testable MVP and a customer-validation plan. Do not build a public business or turn on billing before Yish chooses it.

## Design and verification

Use UI/UX Pro Max as interaction guidance while retaining Filtrsoft's existing visual tokens and tabbed detail layout. No marketing headlines in app screens. Compact data hierarchy, 44px targets, visible labels, both themes, keyboard access, reduced motion, failure recovery and source fidelity. Test APIs with isolated databases and blocked external transports. Never claim a screenshot fixture is live or a screen-size emulation is a physical phone.

## Checkpoints

- Orientation and current production read complete. Implementation begins with private access, listing history and the inspection/outcome contracts. Baseline test suite running.
- First integrated batch: **307 tests / 0 failures / 898 assertions**, TypeScript and Vite passed. **Six end-to-end browser groups** passed against the real Bun API with a disposable database: private entry, real price history, saved inspections/account isolation, draft recovery/failed saves, exact-cent sale editing, ten viewport/theme combinations. No external transports or real account mutation.
- Implemented private registration (existing accounts remain usable), private thumbnail access and diagnostic health details, asking-price history, revisioned inspections, actual purchase/sale costs and corrections, inventory/sold views, and a visible pipeline status panel. The shared formatter rounded cents; corrected with a regression. Browser QA also reproduced a rate-limit collision: stored reads consumed the source-crawl/sign-in bucket. Separate bounded buckets now allow normal review without reducing the remote-source limit.
- Additional data integrity: listing facts/history commit atomically; pending purchase facts withhold stale current estimates; manual inspection checks reset when the question/evidence or listing identity changes. The original decision and historical costs are preserved. Small comparison-spacing correction and final review/packaged checks next.

- Release review: **311 tests / 0 failures / 907 assertions** on Windows and Linux ARM64. Added archive-status metadata caching (340–539 ms per uncached read; 0.03–0.18 ms warm), chronological history cursors that survive later backfills, exact GPU suffix spacing, unsaved sale draft recovery, inventory-only totals and lazy screen download recovery. More status and private thumbnails verified through the real API. Existing 15 detail and 6 comparison groups pass; final workspace suite includes rejected downloads and touch-target checks.
- Business research and an interactive, synthetic-only AfterBuild concept are complete. This is a proposal for small builders' delivery-to-support workflow, not a public launch. Existing diagnostic/snapshot competitors are explicitly acknowledged. Pilot demand and the proposed $29 price remain unvalidated.
