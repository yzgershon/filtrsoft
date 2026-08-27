# Codex prompt — full backend audit of Assyze

Paste everything below the line into Codex, with the repo open at `C:\Dev\assyze`.

---

You are auditing and improving the backend of **Assyze**, a marketplace that
finds genuinely underpriced used tech and tells a buyer what a listing is
really worth before they drive to see it. It is live at https://assyze.com on
Railway. Repo root is `C:\Dev\assyze`.

**You have permission to edit this repository, commit, and push to `main`.**
Pushing auto-deploys to production, so treat `main` as live. The boundaries are
at the bottom and they are firm.

## Read these first, in this order

1. `HANDOFF.md` — current state and, in section 12, roughly forty **live traps**.
   Each one is a bug that already shipped and cost real time. It is long; read
   all of it. If you find yourself about to do something clever, check whether
   section 12 already says why it does not work.
2. `AGENTS.md` — engineering rules for this repo.
3. `docs/RISK-MODEL.md` — the product's actual moat: hard blockers vs flags.
4. `docs/MASTER-PLAN.md` §5 — phase sequencing and what is deliberately deferred.

`HANDOFF.md` is not decoration. It is written specifically so the next engineer
does not re-derive the same failures, and several entries exist because someone
ignored an earlier entry.

## What the system is, structurally

- **Bun** runs everything except browsers. **Node** drives Playwright, because
  Playwright hangs under Bun. They talk over NDJSON on stdout. Browser workers
  are deliberately dumb — they emit raw text lines and **all parsing happens in
  TypeScript**, so a site layout change is a pure-function fix with a fixture
  rather than another browser session.
- **SQLite** (`bun:sqlite`) on a Railway volume at `/data`. 31 MB locally,
  18,603 comps, 395 SKUs.
- The comps archive travels to production as a **committed gzipped file**
  (`data/archive.json.gz`, 1.2 MB) which the container imports on boot. That is
  deliberate: every other route to the volume needs a credential.
- One Hono API (`src/api/index.ts`), one crawl loop, one daily sweep, all inside
  the same container.
- 60 TypeScript files under `src/`. **Zero tests.** That is not an oversight you
  need to point out; it is a known gap and fixing it is in scope.

## What to audit

Go wide. The brief is money, storage, time, and functionality, but do not treat
that as a checklist — anything that makes this system cheaper, faster, more
correct or more maintainable is in scope.

### Money
- **Anthropic vision** is the only per-unit cost. Haiku, capped at $2/day, spent
  ~$0.22 today. `src/vision/`, `src/api/guard.ts`. Is the cap enforced on every
  path? Is the photo-fingerprint cache actually preventing re-reads? Is
  `deservesVision` spending on the right listings?
- **eBay Browse API** — 5,000 calls/day, currently barely used.
- **Railway** — one container, one 5 GB volume.
- Anything that re-fetches, re-computes or re-stores something it already had.

### Storage
- The volume filled once and took production down for 13 hours (reads kept
  working, writes failed, and one generic catch reported it as a database
  fault). See HANDOFF. Photos are now released after hashing — verify that
  actually holds on every path, including failure paths.
- `comps`, `listing_photos`, `verdicts`, `vision_results` all grow without
  bound. `verdicts` gains a row per re-score. Is any of that unnecessary?
- The archive is committed to git, so every export adds ~1 MB to repo history
  forever. Is there a better shape?

### Time
- Crawl loop is every 45 minutes, sweep daily. A *discovery-only* pass over all
  five Craigslist categories is **5 requests and 1.35 seconds** for 1,357
  listing ids — measured. There is a designed-but-unbuilt plan to split
  discovery from analysis so alert latency drops from ~22 min average to ~90
  seconds. Assess it, and build it if you agree.
- `checkStored` is called in loops in several places. Profile before assuming.
- SQLite indexes: several hot queries scan.

### Functionality and correctness
- **267 of ~900 analysed listings still cannot be priced.** Current composition:
  ~113 "couldn't identify the model", 41 "no recent sold comps", 62 "a required
  field was not stated", the rest build/parts gaps.
- The generative matcher (`src/catalog/derive.ts`) parses a model out of a title
  and mints the SKU. It covers Dell/HP/Lenovo laptop lines and GPUs. Extending
  it to Apple desktops, servers, and the remaining brands is open work.
- The 62 "not stated" cases cannot be fixed by the catalog — the seller did not
  write the spec and it is usually in a photo. Vision is the lever.
- Look hard for **silent wrongness**: numbers that are plausible but wrong.
  This codebase's worst bugs have all been that shape — a zero read as a price,
  a CPU comp set containing whole computers, an alias matching as a substring
  so a ThinkPad X13 priced as an X1.

## How to verify anything you change

There is no test suite, so **measure against the real database**:

```
bun run stats                     # catalog and comp coverage
bun run api                       # local server on :3177
bun run check <craigslist-url>    # one listing end to end
bun run review                    # eval listings beside their comps
```

The highest-value verification in this repo is: re-score every stored listing
before and after your change and diff the verdict distribution. If a change
moves listings between calls, know exactly which ones and why. Several real
bugs were caught by exactly that and nothing else.

If you add tests, start with the pure functions — `matchSku`, `parseModel`,
`detectCategory`, `resolveProductType`, the eBay and retail parsers. Fixtures
already exist in `docs/testset/*-lines.json`.

## Hard boundaries

These are not suggestions.

1. **Never spend money.** Do not raise the vision budget, add a paid service,
   or buy anything. Stripe billing exists in `src/api/billing.ts` and is
   deliberately OFF — leave it off.
2. **Never handle credentials.** No login flows, no storing passwords, no
   entering keys into forms. The owner signs into Facebook and eBay by hand in
   a real browser. `.env` is gitignored and stays that way. Do not print secret
   values into logs, commits or output — key LENGTHS are the established way to
   diagnose them.
3. **Bump `ENGINE_VERSION`** (`src/engine/index.ts`) whenever engine behaviour
   changes, or production keeps serving old verdicts. This trap has been hit
   more than once.
4. **Re-export the archive** (`bun run archive`) and commit it after any change
   to comps, SKUs or aliases, or production stays behind.
5. **Never pass `-c user.email`** on a commit. A pre-commit hook enforces this.
   **Never add `Co-Authored-By`.**
6. **Update `HANDOFF.md` in the same commit as the code**, not afterwards. If
   you find a trap, write it into section 12 with the measurement that proves
   it.
7. **Do not relitigate settled decisions**, listed in HANDOFF section 13:
   Craigslist and Facebook crawling proceed despite terms of use; the local
   sale ratio; `bypassPermissions`; photos are not retained. If you think one is
   wrong, say so in your write-up — do not change it.
8. **Do not delete the rollback directory** or the committed archive.

## What I want back

Work in small, reviewable commits with real commit messages that say **why**,
not what. Then a written summary containing:

- What you changed, and what it measurably improved — with before/after numbers.
- What you found and deliberately did **not** change, and why.
- Anything you believe is wrong that you were not allowed to touch.
- The three highest-value things still undone, ranked, with your reasoning.

Be blunt about anything that is over-engineered, dead, or wrong. Several
subsystems here were built fast under time pressure and have not been re-read
since. If something should be deleted, say so.
