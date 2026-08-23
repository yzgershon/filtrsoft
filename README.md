# Assyze

**The app that tells you what a used tech listing is really worth and what's wrong with it, before you drive.**

Used tech marketplaces (Facebook Marketplace, OfferUp, Craigslist, eBay, Mercari) are full of listings whose real value is nothing like their asking price. Every existing tool values the *model*. None of them value the *risk*.

## Why "Assyze"

Respelling of **assize** (pronounced "uh-SIZE"). From Old French *assise*, "a sitting," via Latin *assidere*, to sit beside. Three layered meanings, all of which fit:

1. **A formal session of judgment.** The English Assizes were traveling courts where judges rode a circuit through the counties to hear serious cases, from the 12th century until they were abolished in 1971.
2. **A fixed standard of measure, weight, or price.** The **Assize of Bread and Ale** (1266) fixed what a loaf had to weigh and what ale could cost, with penalties for bakers and brewers who cheated. The **Assize of Weights and Measures** standardized weights across the realm.
3. **The market inspection that enforced it.** Officers physically checked goods and scales in the market to confirm merchants weren't shortchanging buyers. Among the earliest consumer protection law in English history.

So: *a formal judgment, a true standard of value, and the inspection that keeps buyers from being cheated in a marketplace.* The whole product in one 13th-century word.

Sibling word: **assess**, same Latin root, originally "to sit beside a judge and fix an amount." (Unrelated to *assay*, which comes from *exagium*, "a weighing.")

Inspection is the brand, not deal volume. Name chosen 2026-08-22. Domain: assyze.com

## The thesis

Used tech has **binary, hidden value-destroyers** that price comps cannot capture. Not "worth 15% less." Worth nothing:

- iCloud Activation Lock — a $400 iPhone becomes a $40 parts unit
- IMEI blacklisted (reported stolen, or unpaid carrier balance)
- Carrier locked vs unlocked
- EFI / firmware lock on a MacBook
- Battery health under 80%
- Mined-on GPU, banned console, refurb sold as sealed

Plus, on bundled listings (a "gaming PC" is seven components), value swings 10x on which parts are inside, and there is **no single sold comp for a custom build**.

## Governing principle

**Reliability over coverage.** Missing a good deal costs nothing. Sending someone 45 minutes to a scam ends the brand. The engine is allowed to say "I don't know." Every competitor always gives a number; that is their weakness, not their strength.

## Scope

**In:** laptops, phones, GPUs, prebuilt PCs, consoles, tablets, components.
**Out:** furniture, clothing, cars, everything else.
**Out as of 2026-08-23: cameras and photo/video gear.** Yish marked all 8 camera listings UNKNOWN in the Phase 0 audit — he doesn't know the category. Lenses and bodies comp *well* on eBay, so valuation isn't the problem; the **risk layer** is (fungus, element separation, focus motor wear, mount play, cosmetic grading conventions). Risk is the differentiator, and a category he can't audit is one where the engine could be wrong indefinitely without either of us noticing. Revisit only if a domain informant turns up.
**Not in v1:** alerts and monitoring (commoditized), cross-listing, auto-messaging.

## Status

Phase 0 complete. Phase 1 engine built and self-scoring against Yish's audit. See `HANDOFF.md`.

## Docs

- `docs/research-2026-08-22.md` — full market, competitor, technical and legal research
- `docs/sessions/` — session logs, newest last
- `HANDOFF.md` — **master plan + current state.** Start here.
