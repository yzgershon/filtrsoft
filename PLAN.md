# Assyze — Plan

**This plan has no dates.** Dates are fiction on a project where the product will change. Instead there are **phases with gates**: each phase answers exactly one question, and you move on when the gate opens, whenever that happens.

Every phase also has a **kill signal** — the thing that, if you see it, means stop and rethink rather than push harder.

Read `HANDOFF.md` for current state. Read `docs/research-2026-08-22.md` for why any of this is shaped the way it is.

---

## The invariants

Build these regardless of how the product morphs. They're valuable in every version of Assyze, so they're never wasted work:

1. **The comps archive.** eBay only exposes 90 days of sold data. Store every comp you ever pull, forever, starting with the first one. In 18 months this is an asset nobody can buy or copy. **Every day not storing is history you never get back.**
2. **The canonical catalog.** Resolving "MacBook pro 16in like new" into a real SKU with real attributes. Ugly, unglamorous, and it's why competitors stay shallow.
3. **The risk model.** Locks, blacklists, battery, mining, bans. Yish's actual domain knowledge, written down. This is the moat.
4. **Reliability over coverage.** Missing a deal costs nothing. One scam link ends the brand. This principle wins every argument it's in.

If a phase gets cut, these four survive.

---

## Phase 0 — Does the engine see?

**Question:** Can a vision pass read a real Marketplace listing?

**Build:** A script. No UI, no backend, no app. Feed it listing photos and text, get back structured output.

**Test set:** 30 real listings at real Marketplace photo quality. Roughly 10 phones, 10 laptops, 10 GPUs or prebuilt PCs. Include deliberately bad ones: dark photos, screens off, angled shots, listings whose entire description is "computer."

**Gate to open:**
- Correct model identification ≥ 70%
- Lock screens and activation-lock indicators detected when visible
- Refuses to guess when the photo genuinely doesn't show enough

**Kill signal:** Under ~50% accuracy, or confident wrong answers. Confident-and-wrong is worse than uncertain, because the entire product is trust.

**If the gate doesn't open:** the product isn't dead, it changes shape. Fallback is a guided flow where the user confirms the model and Assyze does valuation plus risk from there. Less magic, still valuable.

---

## Phase 1 — Is the engine right?

**Question:** Does it match Yish's judgment, and does it ever call a scam a good deal?

**Build:**
- Canonical catalog, first pass
- Comps ingestion, **and start the archive here**
- Risk model v1, written as a document before it becomes code
- Verdict output: value range, confidence level, risk flags, questions to ask
- **The eval set: 200 hand-labeled listings** with ground truth for what it is, what it's worth, what's wrong with it

**Gate to open:**
- Engine agrees with Yish on the calls that matter
- **Zero cases of a flagged scam being labeled a good deal.** This one is absolute, not a percentage.
- Ranges are honest: real value lands inside the stated range most of the time
- Every verdict cites the comps behind it

**Kill signal:** Comps too sparse to value common items, or accuracy that can't get past "sometimes."

**Note:** Yish personally reviews everything in this phase. That's not a stopgap, it's how his judgment becomes the model. He *is* the eval set until the eval set exists.

---

## Phase 2 — Do strangers trust it?

**Question:** Will people who don't know Yish use it twice?

**Build:** Web app. Paste a listing URL, get the verdict. That's the whole thing.

**Why web and not mobile:** deploy in seconds, no store review, no build step, and Yish already knows how to build it. Most importantly, **a link is the only thing a stranger will actually click.** Nobody installs an app from someone they've never heard of. Everybody opens a URL.

The web app is not a throwaway stepping stone. It stays permanently as the top of the funnel and as Yish's own cockpit for reviewing verdicts.

**Build as API plus thin client from day one.** All the value lives server-side. The client is a shell.

**Gate to open:**
- 20 to 50 real flippers have used it
- People return unprompted, without being asked
- At least one person says some version of *"this stopped me buying something bad"*

**Kill signal:** People try it once and never return. That means the verdict isn't better than their own gut, which is the whole product.

---

## Phase 3 — Will they pay?

**Question:** Is this a business or a free tool?

**Build:** Free tier with a hard scan cap, Stripe checkout, accounts.

**Pricing hypothesis:** free tier around 10 full analyses per month. Paid at **$14.99–19.99/mo**, above flippr's $12.99 on depth and far below Swoopa's $47.

**Gate to open:**
- 10 paying users
- They're still paying in month two

**Kill signal:** Heavy free usage, zero conversion. Means it's a nice-to-have, and the fix is depth on the flipper workflow rather than more features.

---

## Phase 4 — Mobile

**Question:** Does putting it in a pocket make it stickier?

**Only start after Phase 3.** An app nobody pays for on the web will not be paid for on a phone.

**Build:** React Native + Expo, **Google Play first.** No review queue like Apple's, $25 one time, and Yish can test on his own Galaxy S24 with zero friction. iOS follows via EAS Build once Android proves out. EAS means no Mac is needed.

**On "one swoop" from web to Play Store:** be clear-eyed. React and React Native share a language and a mental model but **not** components, so the UI gets rewritten. That's fine, because the UI is the cheap part — the engine, catalog, comps and risk model all port untouched. This is exactly why Phase 2 builds API-plus-thin-client.

There is a genuine shortcut: a PWA can be published to Google Play as a Trusted Web Activity, one codebase, no rewrite. Worth evaluating when you get here, but it's an Android-only trick and it tends to feel non-native. **Don't contort the architecture now to save a rewrite of the cheapest layer later.**

**Gate to open:** retention on mobile beats retention on web.

---

## Phase 5 — Discovery and the flywheel

**Question:** Can it find deals instead of just judging the ones you bring it?

This is where alerts and monitoring finally enter, **deliberately last**, because it's the commodity nine competitors already fight over on price. You earn the right to compete there by having the verdict quality nobody else has.

Also here:
- **The outcome loop.** "Did you buy it? What happened?" Real outcomes are the one dataset no competitor can purchase.
- **Content.** PC and tech flipping performs enormously on YouTube and TikTok, Yish has genuine receipts from flipping PCs off Marketplace, and the tool is naturally in every video. Product and audience point the same direction, which is the reason this idea beat everything else considered.

---

## How to work this plan when things change

- **Gates are non-negotiable, everything else is.** Features, scope, even the category can move. Do not ship past a closed gate because you're excited.
- **One phase at a time.** The main failure mode here is building Phase 4 during Phase 1 because it's more fun.
- **Log decisions as they happen** in `docs/sessions/`. Especially the things you decide *not* to build and why — that reasoning disappears otherwise.
- **Update `HANDOFF.md` before you stop working.** Every time.
- **When the product changes, ask which invariant it serves.** If the answer is none, it's probably a distraction.

---

## Immediate next action

**Phase 0.** 30 listings, one script, one afternoon. Everything downstream assumes it works, and it's cheap to find out.
