# Frontend redesign, 2026-09-08

Yish requested a complete redesign using UI/UX Pro Max, including a full desktop app. Work lives on `codex/frontend-redesign` in `C:\Dev\filtrsoft-backend`. The backend audit is already deployed; this work preserves its decisions and exact evidence.

## Direction

A dark, restrained workspace with clear typography, structured surfaces, blue actions, and readable product photography. Full desktop navigation and multi-column discovery; a separate responsive mobile layout with bottom navigation. Preserve Filtrsoft's wordmark and semantic verdict colors. All prices and evidence come from the existing API; synthetic preview records are explicitly test fixtures.

## Work sequence

1. **Layout and design system, complete for the first redesign.** Desktop sidebar, responsive shell, discovery search, filters, verdict navigation, hero and listing cards, detail evidence layout, settings and account surfaces, public landing/auth.
2. **Interaction correctness, verified.** Cancel obsolete detail requests, recoverable network errors, all five review labels, explicit sort order, query navigation, Back/Forward history and restoration beyond 200 rows.
3. **Built preview and checks, passed.** Node browser harness using an isolated static preview and mocked API. Check 360/375/768/1024/1440 widths, landscape, reduced motion, larger text, focus, failure and empty states. No automated login or production training labels. Run TypeScript and relevant tests and inspect compiled styles.
4. **Reviewable delivery, ready.** Record screenshots and verification, update HANDOFF, present the local redesign. Saved on the local redesign branch; no push or production deployment.

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
