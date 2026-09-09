# Design direction review, 2026-09-09

These screenshots show **static interactive prototypes with example data**. They are not production screenshots or new engine valuations. Existing local fixture photos are used; no account/API writes occur.

Run the studio from the repository with:

```powershell
node docs/design-lab/serve.mjs
```

Open `http://127.0.0.1:3192/`. Run `node docs/design-lab/check.mjs` in a second terminal to repeat the checks. The server is loopback-only; `127.0.0.1` on another device will not reach it.

## Layout choices

- [All three directions](compare-all.png): desktop comparison studio. The phone frames are presentation only; the selected design retains a full desktop app.
- [A: Shortlist](shortlist.png): deliberate daily review, readable rows and a deciding issue.
- [B: Market](market.png): product discovery, photos and exact saved filters.
- [C: Workbench](workbench.png): manually followed deals, stages and next actions.

## Interactions

- [Account menu](account-menu.png)
- [Decision detail](shortlist-detail.png)
- [Review choices](review-choices.png)
- [Saved comparison](compare-candidates.png)
- [Workbench deal](workbench-deal.png)

## Validation scope

[checks.json](checks.json) records **10 passing scenario groups** and zero uncaught page errors/application API requests:

1. Three home layouts at 360, 390 and 430 px, intact initial photos and visible first asking prices.
2. Comparison studio at 375, 768, 1024 and 1440 px.
3. Dialog focus, scroll locking, Escape, backdrop, browser Back and a focused Settings destination.
4. Save/remove/Undo and comparison that preserves unknown values.
5. Search category, text and sort round-trip without requesting push permission.
6. Deliberate review, accessible Undo inside its confirmation, explicit Next, progress, personal notes and checklist retention.
7. Manually recorded deal stage and note, with actual paid/sold amounts still unrecorded.
8. Reversible light/dark appearance and reduced motion in all three concepts.
9. 844 × 390 landscape, 150% text expansion and OS reduced-motion sheets.
10. No application API requests and no uncaught browser errors.

Root visually inspected the comparison, all home screens, detail and account menu. Read-only peer review found prototype focus, Undo, search persistence, appearance and motion problems; they were corrected before the final check.

Browser emulation does not establish physical-phone rendering, VoiceOver/TalkBack behavior, installed PWA safe-area/keyboard behavior, or production persistence. Those remain release checks for the chosen real implementation. Prototype state resets when its document reloads.
