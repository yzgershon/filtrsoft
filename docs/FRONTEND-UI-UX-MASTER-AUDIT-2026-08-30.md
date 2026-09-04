# Filtrsoft frontend UI/UX master audit

**Date:** 2026-08-30  
**Scope:** Live production at `filtrsoft.com`, the React/Vite frontend, PWA shell, every reachable screen, and every safe interaction type.  
**Deliverable status:** Audit only. No production UI code was changed.

## Executive verdict

Filtrsoft has a good visual foundation, but it currently behaves like a polished mobile prototype stretched across a desktop browser. The verdict colors, price hierarchy, two-up mobile cards, inline SVG icons, and plain-language copy are worth keeping. The highest-priority problems are not aesthetic:

1. The Deals filter says there are 21 deals but exposes only 13 and removes the only pagination control.
2. Browser Back changes the URL without leaving a listing detail page.
3. Three settings visually change but do not change the product behavior they claim to control.
4. “Deals” includes `VERIFY` and `RISK`, while the page promises “Worth driving for” and “actually verified.” That is a trust problem.

Fix those before spending time on more gradients or animation. Once the interface tells the truth, a real responsive desktop layout and better marketplace discovery will make it feel like a serious product.

## What was tested

The live site was exercised at a 1920 × 962 browser viewport. The app column measured 560 px, with 528 px of usable content. The connected browser's device-viewport override did not take effect, so current mobile behavior was audited from the mobile-first CSS, the 520 px breakpoint, and the repository's phone-size reference captures. Those captures are stale and are not treated as proof of current functionality.

The following live interactions were completed:

| Area | Interaction | Result |
|---|---|---|
| Feed | All, Deals, and Under $500 segments | Visually switch; keyboard issue and incomplete filtered results found |
| Feed | Hero listing | Opens detail correctly |
| Feed | Standard grid listing | Opens detail correctly |
| Feed | Show more | Correctly moved from 60 to 120 of 587 |
| Detail | First and later gallery photos | Lightbox opens at the selected image |
| Detail | Close button and Escape | Both close the lightbox; focus is lost |
| Detail | Local and eBay switch | Numbers recompute correctly |
| Detail | Copy all and individual copy | Visible text changes to “copied” |
| Detail | Top copy-link and bottom Share | Copy, but show no success or failure feedback |
| Detail | New check | Returns to the fresh Check screen |
| Check | Typed unsupported URL | Clear inline `role=alert` error appears |
| Navigation | Deals, Check, Saved, You, Settings, logo | All destinations render |
| Settings | Drive stepper | 15m → 20m → 15m; restored after test |
| Settings | Three switches | Toggled and restored to their original states |
| Routing | Browser Back from a listing | URL changes to `/`, detail incorrectly remains open |
| PWA | `/?tab=check` shortcut | Incorrectly opens Deals |
| Build | `npm.cmd run build` | Passed in 301 ms |

The following controls were inspected but deliberately not fired because they create persistent or external state: saving/removing a listing, clearing saved data, creating/removing an alert, sending a test notification, enabling browser notifications, and recording an outcome. Billing controls do not render while billing is disabled. The original-marketplace link has a correct external URL and `target="_blank"`; the automated click did not complete, so only its markup and destination were verified.

No production console errors or warnings appeared during the pass.

## Measured evidence

| Measurement | Live result | Why it matters |
|---|---:|---|
| Feed total | 587 | Large enough to need real discovery controls |
| “Deals” count | 21 | What the control promises |
| Listings reachable after selecting Deals | 13 | Eight promised deals are unreachable |
| Show more under Deals | Missing | Cause of the reachability failure |
| First Show more under All | 60 → 120 | Base pagination itself works |
| Desktop app width | 560 px | 71% of a 1920 px screen is unused |
| Desktop bottom-nav item width | 475 px | Mobile navigation is stretched across the whole viewport |
| Feed document height | 5,882 px | Discovery/filtering matters more than more visual polish |
| Detail source image | 250 × 250 px | Displayed at 560 × 420, visibly upscaled |
| `--ink-3` on page background | 3.84:1 | Fails 4.5:1 for its small text |
| `--ink-3` on card surface | 3.59:1 | Fails 4.5:1 for its small text |
| Save target | 30 × 30 px | Below the 44 × 44 mobile minimum |
| Stepper targets | 30 × 30 px | Below the 44 × 44 mobile minimum |
| Channel tabs | about 54 × 29 px | Too short for reliable touch |
| “Copy all” | 28 px tall | Too short for reliable touch |
| Settings Add | about 49 × 35 px | Too short for reliable touch |
| Production JS | 231.12 kB / 71.66 kB gzip | Reasonable; bundle size is not the current problem |
| Production CSS | 34.40 kB / 7.36 kB gzip | Reasonable, though structurally messy |

## P0: fix before visual expansion

### 1. Filtered results are incomplete

`Feed` loads 60 rows, filters those rows in the browser, and only renders Show more when `filter === "ALL"`. The API count says 21 Deals, but the selected view contains one hero plus 12 cards.

**Files:** `web/src/App.tsx`, feed API implementation.

**Required fix:**

- Make the filter a server query, such as `?quality=actionable`, `?maxPrice=50000`, `limit`, and `offset`.
- Return global counts for every segment from the same filter model.
- Reset rows and offset when a filter changes.
- Keep Load more available for every filter until `items.length === total`.
- Add an integration test that asserts the displayed count, reachable rows, and pagination agree.

**Acceptance:** Selecting a segment must eventually make all rows represented by its count reachable. A label must never say 21 while the view dead-ends at 13.

### 2. Navigation state and browser history are broken

Opening `/c/3918` and pressing Back produces this state:

- URL: `/`
- visible screen: the same listing detail
- selected bottom tab: Check

Primary tabs also live only in React state. Refreshing Check, Saved, You, or Settings returns to Deals. The manifest shortcut points to `/?tab=check`, but that URL opens Deals. Opening Settings from a detail page resets the listing, and closing Settings sends the user to Deals rather than where they came from.

**Required fix:**

- Give destinations real routes: `/`, `/check`, `/saved`, `/settings`; remove `/you` if the recommendation below is followed.
- Make `popstate` derive the complete screen state, not just `path`.
- Clear detail state when the route stops matching `/c/:id`.
- Preserve feed scroll position, filter, and loaded-page count when returning from detail.
- Change the PWA shortcut to `/check`.
- Use a Back control on Settings that returns to the prior route.

**Acceptance:** Back from a detail returns to the same feed position. Refresh preserves the current primary screen. The PWA Check shortcut opens Check.

### 3. Settings claim behavior they do not control

This is silent wrongness, not a polish issue.

- **Willing to drive:** changes local storage, but the value is never sent to feed or check APIs. Verdict economics do not change.
- **Hide listings that are gone:** `Feed` never reads the setting.
- **Reduce motion:** the user currently has it enabled, but a detail `.rise` animation still computes to `0.32s`. Its help text also references a card-to-hero animation that was removed.
- **Ask what happened:** this is the only connected switch.

**Required fix:** Wire each control end to end or delete it until it is real. Do not leave a control that changes appearance but not outcomes.

If drive time becomes user-specific engine input, include it in the verdict cache key or force a re-score. That change affects engine behavior and must follow the engine-version rules.

### 4. “Deals” does not mean deals

The current segment is `BUY + VERIFY + RISK`. A risky listing is not a deal, and a listing that needs verification is not ready to act on. The surrounding copy compounds this:

- H1: “Worth driving for”
- Subtitle: “Only listings the engine actually verified”
- Default view: includes fair, pass, risky, and eventually unpriceable listings

**Recommended information model:**

- **Ready:** `BUY` only.
- **Verify:** `VERIFY` and any unusually cheap listing that needs one answer.
- **Browse all:** `FAIR`, `PASS`, and other priced inventory.
- **Risky:** its own explicit state, never counted as a deal.

If `BUY` is too sparse for a segment, call the broader segment **Worth a look**, not Deals.

### 5. Duplicate cards destroy trust

Three near-identical EVGA RTX 3090 cards appeared together in the first live screen, two with no image. Even if the duplicate source records are technically distinct, the interface looks broken and the Deal count is inflated in the user's mind.

Deduplicate upstream by source listing ID and canonical URL first. Add a conservative presentation-layer collapse for same normalized title + price + location + source when upstream cannot settle it. Never hide genuinely distinct listings solely because the titles match.

## P1: high-value UX and design work

### 6. Build a real desktop shell

At 1920 px, Filtrsoft is a 560 px phone column with a four-item bottom bar stretched across all 1920 px. Each navigation target is 475 px wide. This is the single strongest reason the live site feels unfinished on desktop.

**Desktop at 1024 px and above:**

- App shell max width: 1180 px.
- Horizontal padding: 24 px at 1024, 32 px at 1280+.
- Header height: 64 px.
- Move Deals, Check, and Saved into the desktop header as text/icon navigation.
- Keep Settings at the right edge.
- Hide the bottom tab bar.
- Use four card columns with 16 px gaps.
- Let the hero span two columns and two rows, or use a 7/5 hero + “price drops/newest” rail.

**Detail at 1024 px and above:**

- 56% gallery column, 44% decision column.
- Keep verdict and numbers visible beside the first photo.
- Use `position: sticky; top: 80px` on the decision column.
- Put questions, flags, provenance, and comps below the two-column hero.

Do not bring back the fake phone frame.

### 7. Fix muted contrast and tiny text

`--ink-3: #6e6a7c` is used for 10.5–12.5 px labels and measures only 3.59:1 on cards. Several selectors then apply more opacity, making the result worse.

**Change:**

- Replace `--ink-3` with at least `#858092` (4.92:1 on `--surface`).
- Do not apply `.65` or `.8` opacity to already-muted text.
- Raise card location text from 11 px to 12 px.
- Raise verdict chips from 9.5 px to at least 11 px.
- Raise bottom-nav labels from 10.5 px to 11.5–12 px.
- Keep JetBrains Mono for numeric values only. Do not adopt Orbitron, a monospace body, neon scanlines, or a cyberpunk treatment; that would reduce marketplace trust.

### 8. Enforce 44 px interaction targets

Keep visual controls compact, but make the hit boxes 44 × 44 px minimum with 8 px between adjacent targets.

- Bookmark: keep a 30–32 px visible circle inside a 44 px button.
- Stepper minus/plus: 44 × 44 px.
- Local/eBay tabs: 44 px tall.
- Per-question copy and Copy all: 44 px tall.
- Settings Add/Remove: 44 px tall.
- Logo/home button: at least 44 px tall.
- Add `touch-action: manipulation` to buttons and links.

### 9. Put enough context back on Check

The live fresh Check screen starts with the orange Paste button immediately under the header. It has no H1, no supported-source statement, and becomes a mostly empty black canvas on desktop. The first unsupported-source explanation appears only after failure.

Use this compact structure:

1. H1: **Check a listing**
2. One line: **Paste a Craigslist listing and get its real value, margin, and risks.**
3. Primary Paste link and check button.
4. Typed-URL fallback.
5. Visible note: **Manual checks support Craigslist links right now.**
6. Recent checks, if any.

Add 20–24 px between the sticky header and H1. Do not restore the old marketing pitch or three value-prop rows.

### 10. Use honest error, loading, and offline states

The unsupported-URL state is good: it is inline, specific, and announced. Other failures are silently converted into empty data:

- Feed fetch failure becomes “Nothing here yet.”
- Watchlist fetch failure becomes “Nothing saved yet.”
- A first-run offline API response looks like an empty feed.
- Detail fetch has no catch path.
- Alert errors are visual paragraphs without `role=alert`.

Create a shared state component with `loading`, `empty`, `offline`, `error`, and `retry`. Never show an empty-product message for a network failure.

Update the feed skeleton to match the real 16:10 hero plus two-column cards. The current 210 px hero + 90 px rows produces avoidable layout shift.

### 11. Make sharing truthful and observable

The top link icon and bottom Share button perform the same clipboard write. Neither confirms success, and “Share” is misleading when it only copies.

**Recommendation:**

- Keep one action.
- Use `navigator.share()` when available.
- Fall back to Copy link.
- Show **Link copied** in an `aria-live="polite"` toast for 1.5–2 seconds.
- Show a recoverable error if clipboard access fails.

### 12. Move alerts out of Settings

Alerts are one of the app's strongest reasons to return, but they are buried below Billing and Feed settings. Saved searches belong with discovery.

Recommended Saved information architecture:

- Header: Saved.
- Sub-tabs: **Listings** and **Alerts**.
- Empty Saved state: Browse deals button + Create an alert button.
- Feed/filter sheet: **Save this search** action that opens notification permission only after an explicit tap.

Keep permission requests user-triggered. Do not request notifications on page load.

### 13. Remove the You tab until it is real

You is a primary navigation destination containing four static server defaults and “Editing these is coming.” Only drive time can be edited, and that control is elsewhere and currently inert.

Merge real economics into Settings under **Your numbers**. Remove You from the bottom bar. Bring it back as an account/profile screen only when the values are editable or identity exists. A three-item mobile tab bar—Deals, Check, Saved—is clearer and gives each item more breathing room.

### 14. Hide Billing while it is disabled

The first Settings card explains that the product is free and paid plans may come later. That is honest but not useful, and it pushes active settings below the fold. Render Billing only when the server says billing is enabled or the user has an active entitlement.

### 15. Improve the photo path

The live OfferUp detail used a 250 × 250 source image displayed at 560 × 420. It is soft before the lightbox even opens.

- Fetch/source the highest available remote image URL; do not retain photo bytes on Filtrsoft storage.
- Use `srcset` and `sizes` when multiple remote sizes exist.
- Use `object-fit: contain` for the detail inspection gallery so spec sheets and damage are not cropped. Keep `cover` on feed cards.
- Add the same graceful `onError` fallback used by `Thumb` to Gallery and Lightbox.
- Add desktop previous/next buttons and a visible count in the lightbox.
- Preload only the next image, not all 20.

### 16. Repair modal focus and keyboard behavior

The photo dialog opens while focus remains on the underlying Photo button. Closing by Escape or X leaves focus on the document rather than returning it to the trigger. The dialog has no focus trap.

Use a native `<dialog>` or a small tested dialog primitive:

- Focus Close on open.
- Trap Tab/Shift+Tab inside.
- Restore focus to the triggering photo on close.
- Add ArrowLeft/ArrowRight navigation.
- Give the current image a useful accessible label such as “Photo 2 of 6.”

The deal-quality radiogroup has a related bug: ArrowRight changes the checked option but leaves DOM focus on the previous option. Move focus with the selected radio.

### 17. Correct heading and card semantics

- Fresh Check has no heading.
- Empty Saved has no heading.
- You and Detail begin at H2.
- Detail section headings begin at H4.

Every screen needs one H1 and a logical H2/H3 outline.

`Gcard` sets `aria-label="Open {title}"`, which overrides the visible price, verdict, profit, and location for assistive technology. Include the decision data in the accessible name or associate a visually hidden description with `aria-describedby`.

### 18. Add a bookmark to the hero

Every grid card can be saved, but the best listing on the page cannot. Add the same 44 px bookmark control to the hero's top-right corner. Keep it a sibling of the open button; do not nest buttons.

### 19. Show source on feed cards

Source changes how a buyer contacts the seller and how much confidence to place in photo availability. Add a subtle source label/icon beside location or age: Craigslist, Facebook, OfferUp, Mercari. Do not use source brand colors as the main card color; verdict color remains primary.

### 20. Add real marketplace discovery

Three segments are not enough for 587 listings. Add:

- Search by model/title.
- Category: GPUs, laptops, phones, consoles, desktops/components.
- Source.
- Maximum asking price.
- Distance/radius.
- Sort: best margin, newest, nearest, biggest price drop.

On mobile, use a Filters button with a bottom sheet and an active-filter count. On desktop, use a compact toolbar or 240 px sidebar. Reflect filter state in the URL so searches are shareable and restorable.

## Page-by-page design direction

### Deals

Keep the hero, but default to the most actionable promise rather than All. The first viewport should contain the title, quality controls, and most of the hero on a 390 × 844 screen.

Card changes:

- Mobile grid gap: 10 px instead of 8 px.
- Card body padding: 10–12 px.
- Title: 13 px minimum, two lines, consistent minimum height.
- Price: 18 px.
- Source/location/age: 12 px.
- Price-drop display: **↓ $20** and an old-price treatment that cannot be mistaken for an extra charge.
- Add accessible text for **+$625 estimated profit**; `+$625` alone is too cryptic.
- Preserve the 18 px card radius and photo-first hierarchy.

Do not show “Priced, not deals” and “Couldn't price these” in the default actionable feed. They belong behind Browse all.

### Detail

The current order—photo, identity/price, source link, verdict, numbers—is sound on mobile. Preserve it. On desktop, split it into gallery and decision columns.

Turn the verdict reasoning from one dense paragraph into three scannable rows when data exists:

- **Market:** median, range, comps, freshness.
- **Margin:** asking price, net, required floor.
- **Risk:** disclosed issue or one deciding unknown.

Keep the full reasoning available below or in an expandable Why this call section. Add a collapsible **Recent sold comps** section with 3–5 real examples; comp transparency is one of the strongest trust-building UI additions available.

Add a small offer sandbox: changing “What if I offer?” recomputes projected profit locally from the selected channel. It must be clearly labeled as a scenario, not a new verdict.

### Check

Use a centered task card on desktop, max width 640 px, rather than a control floating in empty space. On mobile, keep it full width. Keep Paste as the primary action.

### Saved and Alerts

Always render the Saved H1. Empty state should have a direct recovery action. Once populated, lead with change summary: price drops, gone listings, and new matching alerts.

### Settings

Recommended order:

1. Your numbers, only controls that actually affect verdicts.
2. Feed behavior, only connected controls.
3. Data/device note.
4. Billing only when enabled.

Remove the redundant `Filtrsoft · filtrsoft.com` footer and repeated “coming” promises. State present behavior: **Saved on this device.**

## Design-system specification

Keep the current dark, warm, verdict-led direction. The product should feel like a trustworthy market instrument, not a gaming HUD.

### Color

| Token | Recommendation |
|---|---|
| Background | Keep `#08070a` |
| Surface | Keep `#121116` |
| Elevated | Keep `#1b1a21` |
| Primary text | Keep `#f2f0f5` |
| Secondary text | Keep `#a8a4b4` |
| Muted text | Change to at least `#858092` |
| Brand | Keep `#ff8a3d` |
| BUY / FAIR / PASS / VERIFY / RISK | Keep the current semantic palette |

Color must never be the only verdict cue. The existing text labels already satisfy that; retain them.

### Type

- Body: system sans, 15–16 px.
- Numeric values: JetBrains Mono, tabular figures.
- Mobile H1: 28–30 px.
- Desktop H1: 36–40 px.
- Card title: 13–14 px.
- Metadata minimum: 12 px.
- Avoid all-caps longer than a short section label.

### Spacing and shape

- Base rhythm: 4/8 px, already good.
- Mobile horizontal padding: 16 px.
- Tablet: 20–24 px.
- Desktop: 24–32 px.
- Card radius: 18–20 px.
- Panel radius: 16–20 px.
- Primary button height: 52 px.
- Secondary/touch control height: 44 px minimum.
- Mobile bottom bar: 64 px plus safe area; give scroll content at least 80 px bottom padding.

### Motion

- Standard transition: 160–220 ms.
- Enter animation: no more than 240 ms and 6 px travel.
- Avoid `transition: all`; list properties explicitly.
- Honor both OS `prefers-reduced-motion` and the in-app setting if that setting remains.
- Do not animate long feed reordering while the user is reading.

## Code and maintainability audit

The frontend is one 1,831-line `App.tsx` and one 1,274-line CSS file. The CSS contains successive visual-pass sections that override earlier declarations instead of replacing them. The comments are often valuable history, but several now contradict the code:

- JSX comment says there is no bottom nav immediately before rendering a bottom nav.
- Source-support comment says supported sources are stated upfront, but no source list renders.
- Reduce-motion copy references an animation that was removed.
- Old repository screenshots show hard blockers and What happened on detail even though both placements changed.

There is also dead or stale implementation:

- Unused `Outcome` component and outcome CSS.
- Unused `Clock`, `Eye`, and `Shield` imports.
- Unused `fresh` variable.
- Likely dead style blocks for `.checkhead`, `.srcs`, `.pitch`, `.shots`, `.chips`, `.deal`, `.hcard`, and old outcomes.
- Undefined CSS variables `--ink-1` and `--dur-exit`; affected declarations are ignored by the browser.

**Refactor without adding a UI framework:**

- `screens/DealsScreen.tsx`
- `screens/CheckScreen.tsx`
- `screens/DetailScreen.tsx`
- `screens/SavedScreen.tsx`
- `screens/SettingsScreen.tsx`
- `components/ListingCard.tsx`
- `components/AppNav.tsx`
- `components/Toast.tsx`
- `components/PhotoDialog.tsx`
- `hooks/useRoute.ts`
- `hooks/useDeviceSettings.ts`
- CSS split into tokens, shell, components, and screens, or use CSS modules.

Move historical rationale to `HANDOFF.md` or short ADRs. Keep only comments that prevent a live trap. Delete superseded CSS rather than stacking a third visual pass below it.

Add a real TypeScript configuration and a typecheck script. The Vite build transpiles but does not provide a meaningful no-unused/typecheck gate.

## PWA and sharing

- Fix the manifest Check shortcut.
- Remove the portrait orientation lock unless a tested interaction truly requires it.
- Update the page description; it still describes Paste as the whole product while the feed is now primary.
- Add Open Graph and Twitter metadata with a real Filtrsoft share image.
- Add `color-scheme: dark`.
- Keep the service worker's network-first API strategy.
- Expose an offline indicator so cached prices are never mistaken for fresh data.
- Update or remove `docs/now-feed.png` and `docs/now-detail.png`; they show a prior product state and are misleading handoff artifacts.

## What to remove now

1. You as a primary tab, until it is editable.
2. Billing UI while billing is disabled.
3. One of the duplicate share controls.
4. Inert settings until wired.
5. “Coming” copy repeated across Saved, Settings, and You.
6. Default-feed sections for non-deals and unpriceable inventory.
7. Dead components, unused imports, dead CSS, and superseded visual-pass rules.
8. Stale current-state screenshots.

## What not to change

1. Keep the verdict palette and visible verdict words.
2. Keep system sans for prose and monospace only for numbers.
3. Keep the two-up mobile feed.
4. Keep the hero card as a single best opportunity.
5. Keep the mobile bottom navigation, reduced to real destinations.
6. Keep photos remote; do not retain photo bytes on the Railway volume.
7. Keep unresolved in-person checks quiet and disclosed defects prominent.
8. Do not reintroduce the fake phone frame.

## Recommended implementation sequence for Claude

### Commit 1: Make discovery and navigation tell the truth

- Server-backed filtered pagination.
- Honest segment names/call membership.
- Route every primary screen.
- Fix Back, refresh, PWA shortcut, and scroll restoration.
- Add interaction tests for all of the above.

### Commit 2: Remove fake controls and fix information architecture

- Wire or remove drive, hide-gone, and reduce-motion settings.
- Remove You from primary nav.
- Move alerts to Saved.
- Hide disabled Billing.
- Remove repeated future-tense copy.

### Commit 3: Accessibility and feedback

- Contrast token.
- 44 px targets.
- H1 hierarchy.
- Card accessible descriptions.
- Correct radiogroup focus.
- Toasts for copy/share.
- Error/offline/retry states.
- Photo-dialog focus trap and restore.

### Commit 4: Responsive shell

- Desktop header navigation.
- 1180 px feed shell and four-column grid.
- Two-column desktop detail.
- Mobile and tablet breakpoint verification at 375, 390, 768, 1024, and 1440 px.

### Commit 5: Marketplace depth

- Search, category/source/price/distance filters.
- Save-search action.
- Source labels.
- Hero bookmark.
- Comp transparency and offer sandbox.

### Commit 6: Delete the archaeology

- Split `App.tsx` and CSS by responsibility.
- Remove dead components, imports, selectors, undefined variables, and stale screenshots.
- Add `tsconfig`, typecheck, component tests, and Node-driven Playwright flows.

## Acceptance checklist

- [ ] Every visible count equals the reachable result set.
- [ ] RISK is never labeled a deal.
- [ ] Browser Back, Forward, refresh, and deep links preserve correct screens.
- [ ] Every setting demonstrably changes the behavior its copy promises.
- [ ] No mobile control has a hit area below 44 × 44 px.
- [ ] Muted small text reaches 4.5:1 contrast.
- [ ] Every screen has one H1.
- [ ] Every async failure has a distinct error/retry state.
- [ ] Copy/share produces announced feedback.
- [ ] Modal focus opens, traps, closes, and returns correctly.
- [ ] 375 px has no horizontal overflow and keeps two readable card columns.
- [ ] 1440 px uses desktop navigation and more than a 560 px phone column.
- [ ] The feed, detail, Check, Saved, and Settings have screenshots at mobile and desktop sizes.
- [ ] Production build, typecheck, interaction tests, and accessibility checks pass.

## Three highest-value additions after the repair

1. **Transparent sold comps.** Showing the actual evidence behind value is the clearest way to turn Filtrsoft from a verdict generator into a trusted buying instrument.
2. **Real discovery + save this search.** Search, category/source/radius filters, and alerts make 587 listings usable and create a reason to return.
3. **Offer sandbox.** Let a buyer test an offer and see channel-specific net profit instantly. It uses data Filtrsoft already has and directly supports the decision the product exists to make.
