# Frontend redesign verification

These screenshots show a **synthetic local preview**, not the production feed. All listings, prices, counts and verdicts are fixtures; photos are existing repository test-set assets.

Run `node src/browser/frontend-redesign-check.mjs` after building `web` to regenerate the route/layout screenshots and `checks.json`. Chrome is driven under Node with a fresh context, blocked service workers and a localhost-only mock API. No account is created or signed into.

The app route matrix covers eight routes at six viewport dimensions. Additional scenarios verify errors, keyboard interactions, filters, sort order, review labels, long pagination restoration, and check completion. The results are grouped into 15 independently reported scenarios.

Screenshots are full-page captures; fixed navigation appears once in a long image. The interactive local preview is the appropriate way to assess scrolling and sticky controls.
