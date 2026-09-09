# Filtrsoft frontend: deep dive and the next design

**2026-09-09 · Audit and interactive design exploration · Layout choice pending**

Filtrsoft's next improvement should make it easier to decide, remember and follow through. The current app has useful valuation depth and much stronger navigation than before, but it still makes a short daily task feel like operating a large dashboard. Important evidence competes with controls, some screens lose their place, and several failure paths undermine what the interface says happened.

My recommendation is **A: Shortlist as the home screen, B: Market as Browse, and C: Workbench as a later deal workspace**. These are complementary jobs. They do not need to become three separate products.

## What this review covers

The starting checkout was clean at `ff9bb8a` on `codex/frontend-redesign` in `C:\Dev\filtrsoft-backend`. Its application code includes `c4515e3`, the previously deployed mobile refinement. Three agents independently reviewed structure, interaction quality and feature feasibility; root reviewed findings, reproduced selected cases and built the prototypes. Root was the only editor.

Reviewed surfaces include:

| Surface | Files and associated behavior |
| --- | --- |
| Application shell, routing, menus, auth entry and Check | `web/src/App.tsx`, `nav.ts`, `history.ts`, `popup.tsx` |
| Discovery and review queue | `feed.tsx`, URL filters, cursor restoration, saved-search creation |
| Listing decision and evidence | `detail.tsx`, `types.ts`, photos, channel math, simulator, Your call |
| Saved, purchases, outcomes, alerts and settings | `screens.tsx`, `more.tsx`, corresponding API handlers |
| Local state and shared primitives | `lib.tsx`, `migrate.ts`, `icons.tsx`, `brand.tsx` |
| Visual system and public entry | `styles.css`, imported CSS layers, `landing.tsx` |
| Installed/offline behavior | `web/public/sw.js`, manifest, browser test configuration |

This is a source review with targeted browser reproductions against synthetic local API responses. It is **not an authenticated production audit, a real-device certification, or a benchmark of actual phone frame rates**. No real labels, saved searches, purchases, account settings or database facts were changed. The production application was not replaced by a prototype.

## What is already working well

Preserve these foundations:

- Conservative exact-product valuation, explicit unknowns, inventory price bases and seller evidence. `INSUFFICIENT_DATA` remains a valid result.
- The existing popup primitive already handles Back, Escape, focus containment/restoration, background isolation and reduced motion. Reuse its behavior instead of inventing a second system.
- The feed already has substantial retry, reconnect, race handling and cursor/scroll restoration, including larger result sets. The tab-return issue below is narrower than saying browser Back is broken.
- Your call already has deliberate choices, decision-token handling and important late-success/retry safeguards. Outcome recording is a separate path that has not received the same treatment.
- The full desktop shell and mobile safe-area work should survive the next design. Phone frames in the design studio are presentation devices, not the proposed desktop application.

## Fix trust and completion before expanding the product

### 1. One channel selection must control all offer math

**Reproduced.** At 390 × 844, switching the synthetic listing to eBay changed The numbers to **+$70**, while the offer simulator continued to show **$165** and a favorable trip decision. The simulator uses `bestChannel` independently of the channel selected in Numbers.

Evidence: `web/src/detail.tsx`, Numbers around lines 194–214 and CompsAndOffer around 310–345.

**Change:** share selected channel state across resale proceeds, fees, net profit, target offer and the simulator. Show the channel next to dependent figures. Test a case where local and shipped channels produce different recommendations. Do not change valuation guards to make the numbers align.

### 2. Failed requests must remain distinguishable from empty results

**Reproduced.** A Saved request failure can display “Nothing saved yet.” A JSON 503 response from Purchases can cause `Cannot read properties of undefined (reading 'length')` and unmount the app.

Evidence: `web/src/screens.tsx:66–83` parses without checking status and falls back to an empty list; `191–196` accepts arbitrary JSON and then reads `d.items.length`.

**Change:** loading, confirmed-empty, populated, stale and failed states for each screen. Preserve useful previous data and expose Retry. Validate response shapes at the frontend boundary and isolate screen-level rendering failures. Empty-state illustrations must not hide service failures.

### 3. Outcome and alert writes need confirmed completion

**Source-confirmed contract defects.** OutcomePrompt marks a prompt as asked and displays “Thanks, that trains the engine” before the POST succeeds. “Gone” sends `gone`, while the strict API accepts `dead_listing`. The alert form can stay busy after a rejected fetch, and a failed DELETE can still remove an alert from the visible list.

Evidence: `web/src/screens.tsx:339–368`, `641–656`; `src/api/check-input.ts:9`.

**Change:** use the correct enum, preserve drafts, check HTTP results, reset pending state in `finally`, and keep failed actions retryable. Only mark an outcome answered after confirmed persistence. Match the existing deliberate Your call behavior; do not silently discard these failures.

### 4. A saved search must enforce the criteria in its name

**Source-confirmed frontend/API mismatch.** The saved-search label includes category and marketplace, but the POST stores text and maximum price, with BUY/VERIFY hardcoded. Category and source are not sent or supported by the existing search contract. A category-only search can therefore be broader than its name suggests.

Evidence: `web/src/feed.tsx:290–303`; `src/api/alerts.ts:520–545`.

The same flow requires push permission/subscription just to save criteria, and the save control is placed after the fully expanded feed (`feed.tsx:268–287`, `748`).

**Change:** account-owned saved criteria with exact text, category, source, price and applicable call filters; make selected sort explicit where retained. Saving and notification delivery are separate choices. Put Save search next to the active query. Show a criterion summary before saving and test actual matching, not just the displayed label. This needs an API/schema update.

### 5. Offline data needs account boundaries and visible freshness

**Source-confirmed risk; an actual cross-account exposure was not reproduced.** The service worker caches successful GET responses for every `/v1/` route in a shared cache. The generic fallback includes identity/private routes such as account and purchases; cached responses are not visibly marked stale. Sign-out does not clear these caches.

Evidence: `web/public/sw.js:64–77`; `web/src/more.tsx:325`. Existing redesign and mobile browser harnesses explicitly block service workers.

**Change:** exclude identity/private endpoints from generic API caching. If offline personal data is offered, use an explicit account-owned snapshot contract, expiry/observed time and session-transition cleanup. A cached listing needs a visible “last checked” state. Add service-worker-enabled tests for offline, reconnect, sign-out/account transition and application updates before advertising offline inspection as reliable.

### 6. Purchase totals must describe actual money accurately

**Source-confirmed.** Missing purchase price falls back to the seller's asking price. The UI totals that as Spent and labels current estimated worth minus that amount as Ahead. Current valuation is also different from the estimate at the original decision. This does not establish realized profit.

Evidence: `src/api/index.ts:767–815`, particularly the paid fallback around 785; `web/src/screens.tsx:210–244`.

**Change:** retain unknown paid amounts. Separate actual paid, actual sale proceeds, recorded fees/costs, current estimate and the frozen decision evidence. Show incomplete records explicitly. Realized profit should appear only when the necessary actual amounts exist. The tracker already has sale fields; a complete editing flow is still needed.

## Make navigation and evidence feel settled

### 7. Preserve each primary destination's place

**Reproduced.** Open `/?quality=all&q=NZXT`, move to Check, then tap Deals: the query resets to `/`. This differs from the existing browser Back restoration, which already works in tested paths.

Evidence: `web/src/App.tsx:77–80`, `341–346`.

**Change:** retain each tab's filter, scroll position and useful nested destination. Make tapping the current tab the explicit return-to-top action. Forward navigation should focus the new page heading; Back should restore the originating control where possible. In the current browser check, focus stayed on the navigation control and the document title remained generic after moving to Check/Settings.

### 8. Give each menu and settings item one clear destination

There are overlapping More, Account, Settings, Alerts and How paths. Some rows promise a specific destination but open the beginning of a larger settings screen. Ordinary preferences also compete with billing and crawler/operator controls.

Evidence: `web/src/App.tsx:895`, `web/src/more.tsx:109,124`, `web/src/screens.tsx:301,851`.

**Change:** stable primary content tabs; an avatar menu for account/preferences; compact previews for activity and quick choices; focused settings subpages for appearance, notifications, drive/profit assumptions and account. Operator controls belong in a clearly separate tools area. Keep the existing compact-menu-to-full-page behavior, but make labels and destinations exact.

### 9. Put identity and the deciding unknown before optional arithmetic

**Measured on a synthetic detail at 390 px width.** The numbers began around y=792, the simulator at 1248, risks at 1623, questions at 1781, Your call at 2010 and matched identity at 2157. The complete page was about 2366 px tall. These are fixture measurements, not universal offsets for every listing.

Evidence: `web/src/detail.tsx:894–936`. `Meta.description` and `missingValueFields` exist in `types.ts` but are not exposed as a clear seller/evidence surface in the detail.

**Change:** show the exact matched product, ask, valuation availability, call and decisive unresolved issue early. Use **Decision / Evidence / Inspect** sections. Keep the seller description verbatim, extracted facts separate, and conflicts visible. Offer simulation is a secondary tool. A persistent Your call action may open deliberate choices; scrolling, swiping or ticking a checklist must never train the engine automatically.

### 10. Use one overlay contract, including photos

**Reproduced.** The photo lightbox leaves the main app uninert, and browser Back can leave the listing rather than first closing the photo. It is implemented independently of the newer popup primitive. Detail images also lack the existing card thumbnail's unavailable-image recovery.

Evidence: `web/src/detail.tsx:501,548,620`; compare `web/src/popup.tsx:34` and `web/src/lib.tsx:376`.

**Change:** shared Back/Escape/focus/background behavior; visible photo controls, zoom and a useful unavailable-photo state. The current sheet handle is decorative (`popup.tsx:77`): either implement real drag-to-dismiss with scroll arbitration and an accessible close alternative, or remove the drag affordance.

## Visual and mobile quality standard

The aim is quiet confidence: clearer product names, aligned prices, predictable surfaces, fewer competing outlines and more useful content in the first screen. A permanent tutorial paragraph, crowded filter bar or decorative statistic consumes space that could show the next candidate.

- **Layout:** four stable primary destinations at most for the proposed flows. The selected design decides which jobs deserve a tab. Keep filter/sort controls together; expose only the most useful category shortcuts.
- **Typography:** 14–16 px for normal reading and around 12 px for secondary metadata as the production target. Important verdict/count/net information should not depend on the current 9–11 px treatment (`css/14-mobile-polish.css:119–121`). Allow wrapping and text expansion.
- **Touch:** choose 44–48 px targets for frequent mobile controls, with sufficient separation. This is our design standard; WCAG 2.2 AA's target-size criterion is 24 CSS px with defined exceptions, not a universal 44 px requirement. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- **Navigation:** content destinations should be stable, and temporary choices should behave as temporary choices. Apple's navigation guidance supports a clear distinction between top-level content and modal tasks. It informs the interaction model here without requiring a React Native migration. [Apple navigation design](https://developer.apple.com/videos/play/wwdc2022/10001/)
- **Focus and keyboards:** route titles, visible search focus, complete tabs semantics and keyboard-aware sheets. Saved currently declares tab roles without the complete arrow-key/selection/panel association behavior (`screens.tsx:121`); reuse the stronger existing segmented primitive. Sticky bars must not hide focused controls. [W3C focus visibility guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- **Motion:** roughly 150–240 ms for press, sheet and navigation feedback in these prototypes. Movement explains a state change; it should not replay across the whole screen after every save. Respect both OS and in-app reduced motion. Swipe-to-save can be additive later; swipe-to-label should not be a shortcut.
- **Safe areas:** derive navigation/action offsets from shared dimensions plus safe-area insets. Test keyboard open, landscape, installed mode and larger text. Do not infer iPhone behavior from a desktop viewport alone.
- **Performance:** consolidate semantic tokens and component rules as surfaces are migrated. `styles.css` layers legacy and newer redesign sheets; older broad blur rules remain in `css/08-polish.css:462`. Avoid another blanket override file. Measure rendering and loading on a real phone before claiming frame-rate gains.

UI/UX Pro Max informed this pass. Its generic landing-page recommendation did not match Filtrsoft's task, so the designs use the relevant navigation, accessibility, hierarchy and motion guidance rather than adopting an unrelated marketing layout.

## Three layouts to try

Open the local studio at **http://127.0.0.1:3192/**. Source: [design-lab/index.html](design-lab/index.html). It runs with `node docs/design-lab/serve.mjs` and serves only static prototype files and existing local photo fixtures.

| Direction | Primary job and navigation | Character | Desktop translation | Tradeoff |
| --- | --- | --- | --- | --- |
| **A · Shortlist** | Review, Browse, Saved, Check | Cool neutral surfaces, cobalt accent, one-column listing rows, deciding issue on each card | Persistent sidebar with a wide list and an adjacent selected-listing pane | Best daily starting point; photography is secondary to decisions |
| **B · Market** | Explore, Searches, Saved, Check | Warm neutral surfaces, forest accent, uniform photo grid, query and categories first | Wide catalog grid with a filter rail and detail route/pane | Better exploration, but less pressure to finish a short review queue |
| **C · Workbench** | Discover, My deals, Activity, Check | Dark charcoal, mint accent, followed deals grouped by next stage | Full-width stage columns or list with an inspection/detail pane | Most useful after finding candidates; largest persistence/API expansion |

All three retain Filtrsoft's mark and core evidence rules. They use the same authored example listings so layout is the comparison, not which prototype happened to receive better deals. **Every price, comp count, call and workflow state shown is example data, not a new valuation.** Photos are local test fixtures. Nothing is submitted to Filtrsoft.

Try opening a listing, expanding a photo, reading evidence, using a personal checklist, saving/undoing, comparing saved candidates, creating a search and opening it again, recording/undoing a review, and changing a Workbench stage. Settings opens through a compact account menu; dark appearance and reduced motion work in each concept.

The prototypes deliberately keep the unresolved desktop implementation separate from the phone comparison frames. The selected design must ship as a **full desktop application**, consistent with Yish's earlier instruction.

## Features worth building, in order

| Feature | User benefit | What is available / what is needed |
| --- | --- | --- |
| Guided review with progress and Next | Finish a small daily queue without losing the next candidate | Existing feed/detail/label APIs support an initial frontend version. Capture a fixed batch: the live Review endpoint replenishes its ten eligible rows, so session progress must not imply the entire backlog is finished. Durable session history needs storage. No automatic label on advance. |
| Compare two or three selected candidates | Compare price, exact specs and unresolved checks together | Existing detail data supports a temporary comparison. Preserve unknowns; persist comparison sets only with an explicit storage contract. |
| Account-synced saved listings | The phone and desktop share the same shortlist | Current IDs are in browser storage (`lib.tsx:73–93`); watchlist hydrates supplied IDs (`src/api/index.ts:1179–1227`). Needs account-owned saves and careful migration. |
| Exact saved searches with optional alerts | Return to a useful query even with notifications disabled | Requires the corrected search model described above, plus permission only when enabling delivery. |
| Followed-deal stages, notes and inspection checks | Keep answers and next steps with the candidate | Existing questions/risks can seed the UI. Persistent personal notes, stages and checklist results need account-owned APIs; they must not overwrite engine facts. |
| Actual purchase/resale recording | Learn from real outcomes and see real profit | Purchase input and tracker sale fields exist. Add validated editing and complete costs/proceeds presentation. Never substitute an ask for paid money. |
| Activity inbox | Find meaningful price changes and search matches later | Pulse/watch changes exist; durable events and read state across devices need backend support. Avoid manufactured urgency. |
| Observed listing-price history | Know whether the seller actually reduced the ask | `listing_prices` exists. Expose a bounded read API with observation times. Do not invent a continuous market-price chart. |
| Better share-to-check and optional inspection reminders | Bring listings in quickly and remember a planned inspection | Manifest share-target support already exists: verify/improve it on devices rather than claim it is new. Reminders need explicit user-entered time/place and delivery support. |
| Offline inspection view | Retain clearly timestamped evidence in a weak signal area | Only after cache ownership, stale-data presentation and installed-mode tests are complete. A local personal checklist does not establish fresh seller availability. |

## Implementation sequence after the layout choice

1. **Trust pass:** channel consistency; Saved/Purchases failures; outcome enum and confirmed writes; alert completion; cache ownership/freshness; truthful purchase totals. Add targeted regressions using different channels, rejected requests, account transitions and missing actual amounts.
2. **Shared interaction system:** routing context, focus/title, overlay/photo contract, complete tabs, safe-area offsets, tokens and component rules. Preserve the successful existing feed/history/label behavior.
3. **Selected shell and detail:** implement A/B/C selection in the real React app; build mobile and full desktop together. Put identity and deciding unknowns before optional tools. Verify compiled CSS.
4. **Useful expansion:** guided review and temporary comparison first; exact saved searches and account saves next; stages, notes, inspections and actual transactions with their persistence contracts.
5. **Release validation:** realistic network failures and slow responses, 360/390/430 mobile and 768/1024/1440 layouts, text expansion, keyboard/focus, reduced motion, installed service worker, expired photos, offline/reconnect and an actual phone pass. Run application typecheck/build and applicable regression suites. Inspect deployment and production assets when the chosen implementation ships.

Acceptance is observable: a failed write never claims success; a saved filter returns its actual criteria; switching tabs preserves context; the deciding issue is easy to find; unknown prices and actual money remain distinct. Those are stronger release criteria than adding a certain number of animations.

## Evidence and current status

- [Prototype browser results](qa/design-directions/checks.json) and [screenshots](qa/design-directions/README.md) record the latest static-prototype checks.
- Reusable check: `node docs/design-lab/check.mjs` while the design server is running. It uses Node Playwright, never Bun browser automation.
- The prototype exercises real local state changes with no application API calls. It is not wired to production, and its preferences reset on reload.
- No application source, dependencies, database, archive, engine version or deployment changed during this exploration. Full backend/release suites were not rerun for static design documents.
- The previously recorded production verification remains in `HANDOFF.md`; it was not remeasured for this design exercise.

**Next decision: choose the primary layout. Recommendation: A home + B Browse, then add C's deal workspace after persistent state is ready.**
