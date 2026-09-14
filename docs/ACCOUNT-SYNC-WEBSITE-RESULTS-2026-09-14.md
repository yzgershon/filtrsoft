# Account sync, passwords and public website

Same-account workspace sync now includes saved listings, recent reports, preferences, notification history, read markers and follow-up reminder cooldowns. Existing account-owned reviews, inspections, purchases, dismissals, saved searches and market pins remain on the server. Read-only inspection, purchase, saved-search and pin views refresh while visible and on return; unsaved editor drafts are preserved.

Settings now exposes real sync status, last successful sync, pending edits, retry, and individual conflict choices showing both versions. A durable per-account outbox queues offline changes. Independent records merge; same-field edits need a choice. Server revisions and deletion tombstones prevent stale devices from restoring removed items. Import of legacy browser data requires verified device ownership and only fills absent records. A mismatched signed-in account is rejected before writes. Cache clearing requires successful sync and preserves the account, device binding, other users and cloud records. Browser permissions and unsaved drafts remain device-specific.

The shared password minimum is eight characters on the backend and sign-up form. Password hashing, rate limits and the upper bound remain intact. Public registration remains open. Google sign-in still requires the separately prepared client setup; this release does not claim that external setup is complete.

The public website has a new responsive editorial layout, two original hardware images, interactive value/hardware/risk tabs, product workflow, price-history and sync sections, archive counts from the API, FAQ, mobile navigation, entrance transitions and scroll reveals. Reduced-motion rules disable the animations. Artwork is conceptual, and no listing evidence, price history, performance score or testimonial was fabricated. The two WebP images total 245,548 bytes. Exact generation prompts and asset paths: `docs/WEBSITE-ARTWORK-2026-09-14.md`.

## Verification

- Windows: 337 tests, zero failures, 975 assertions; TypeScript and Vite pass.
- Linux: pinned Node 24.15.0 / Bun 1.3.14 Docker verification, network disabled: **337 pass / zero failures / 975 assertions**, followed by successful typecheck. Initial run found two test-only Hono imports resolving from a temporary directory; corrected to the established absolute fixture import.
- Two independent loopback origins against a disposable database: theme edit sync; save from A appears on B; removal from B restores A's Save button; separate account visibly opens an isolated workspace.
- Backend and browser-state regressions: account isolation, wrong-account write rejection, owner-only legacy import, stale resurrection rejection, idempotent retry, offline reload, in-flight edits, independent tab changes, corrupted cache, and individual conflict resolution. Actual API signup accepts eight and rejects seven.
- Desktop layout and 375px mobile frame inspected. Mobile menu, keyboard-operated report tabs, FAQ and both image loads passed. Mobile document client/scroll width both 356px, with the frame's desktop scrollbar accounting for the remaining width. No physical-phone or Safari test is claimed.
- Production **d922b11**: Railway **6429540507** succeeded at **2026-09-14T02:50:03Z**; native amd64 CI **34800487989** succeeded at **02:51:15Z** including Docker tests and production image build. `docs/qa/account-sync/production.json` at **02:51:06Z** matches six compiled JS/CSS files and both images, verifies anonymous API isolation, registration open, healthy DB, low storage pressure and zero pending/failed scores. The live website and actual signup minimum/helper visibly show eight. The available production browser was signed out, so authenticated production sync and physical-device tests are not claimed.

No shared main checkout edits, comp crawl, database re-score, archive replacement, seller message, software installation or credential handling was performed in this task.
