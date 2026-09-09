# Frontend redesign, 2026-09-08

Yish requested a complete redesign using UI/UX Pro Max, including a full desktop app. Work lives on `codex/frontend-redesign` in `C:\Dev\filtrsoft-backend`. The backend audit is already deployed; this work preserves its decisions and exact evidence.

## Direction

A dark, restrained workspace with clear typography, structured surfaces, blue actions, and readable product photography. Full desktop navigation and multi-column discovery; a separate responsive mobile layout with bottom navigation. Preserve Filtrsoft's wordmark and semantic verdict colors. All prices and evidence come from the existing API; synthetic preview records are explicitly test fixtures.

## Work sequence

1. **Layout and design system, complete for the first redesign.** Desktop sidebar, responsive shell, discovery search, filters, verdict navigation, hero and listing cards, detail evidence layout, settings and account surfaces, public landing/auth.
2. **Interaction correctness, verified.** Cancel obsolete detail requests, recoverable network errors, all five review labels, explicit sort order, query navigation, Back/Forward history and restoration beyond 200 rows.
3. **Built preview and checks, passed.** Node browser harness using an isolated static preview and mocked API. Check 360/375/768/1024/1440 widths, landscape, reduced motion, larger text, focus, failure and empty states. No automated login or production training labels. Run TypeScript and relevant tests and inspect compiled styles.
4. **Mobile refinement and release, authorized and verified locally.** Yish requested compact menus, better mobile hierarchy and purposeful motion, then explicitly asked for a push to production. Implemented and checked the refinement below. Next is the non-force main push and production/CI verification; HANDOFF records the measured release outcome.

## Mobile refinement, 2026-09-08 evening

- Compact Discover header and search/filter row. The featured card shows the first asking price within 430px on a 360px phone, with the remaining review cards immediately below.
- Reusable animated panels for More, Account, Notifications, Sort, Filters and Your call, with direct choices leading to their full destinations. Notification preview does not mark alerts read. Filters retain a draft until Apply.
- Focus trap, inert background, scroll/focus restoration, Escape/backdrop/phone Back dismissal, and closed-panel Forward handling. Saved tabs follow menu and browser query navigation. A delayed successful review refreshes even after its panel closes.
- Brief route/card/tab/bookmark/press transitions. Both OS and in-app reduced-motion settings disable them. Landscape panels and enlarged text keep their final options reachable.
- Full suite: 260 tests, 0 failures, 755 assertions locally and inside a network-isolated pinned Linux verification image. TypeScript, Vite and both Docker image builds pass. Local and Linux builds produce identical asset names.
- The two browser harnesses pass 24 scenario groups with zero page errors. `node src/browser/mobile-polish-check.mjs` covers nine new groups; its screenshots and measurements are in `docs/qa/mobile-polish`. The existing 15 groups continue to cover all routes, sorting, 360-row restoration, network failures, review tokens and check completion.

## Current constraints

Only the root agent edits this checkout. Shared `C:\Dev\filtrsoft` and the inventory worktree are preserved. No crawl, database re-score, paid vision, or account changes belong to this frontend pass.

## Verified results

- TypeScript: passed. Vite production build: passed. Compiled CSS retains standard `backdrop-filter` and the desktop grid/navigation rules.
- 49 Bun tests passed, 0 failed, 151 assertions (`web-shell.test.ts`, `inventory.test.ts`). The existing Bun executable required sandbox elevation; nothing was installed.
- 15 browser scenario groups passed with no page errors. App routes `/`, `/c/101`, `/check`, `/saved`, `/settings`, `/account`, `/notifications`, `/more` checked at 360, 375, 768, 1024 and 1440 pixels plus 844x390 landscape. Additional public landing/auth checks, keyboard focus, reduced motion and larger text.
- Explicit price ordering and filter dialogs verified. Back/Forward retains filters. A 360-row feed restores via requests for 200 + 160 and continues to 420. Failures, stale requests, reconnects, bounded cursor expiry recovery, the FAIR decision token and completed check routing are exercised by the harness.

## Preview and limits

Build with `node web/node_modules/vite/bin/vite.js build web`. Run `node src/browser/frontend-preview.mjs`, then open `http://127.0.0.1:3188`. Add `?preview=landing` for the public site. Run the checks with `node src/browser/frontend-redesign-check.mjs`.

Every API response in the preview is synthetic. Existing local test-set photos are reused only for layout checks. No login, real review submission, crawler, SQLite connection, paid vision or production operation occurs. Screenshots and results live in `docs/qa/frontend-redesign`. Browser simulations do not establish production authentication, image availability, push delivery or payment behavior.
