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
- **SQLite** (`bun:sqlite`) on a Railway volume at `/data`. 32 MB locally,
  936 listings, 18,603 comps, 405 SKUs, 12,291 verdict rows, 55 vision results.
  The volume is 5 GB and filled once already — see below.
- The comps archive travels to production as a **committed gzipped file**
  (`data/archive.json.gz`, 1.2 MB) which the container imports on boot. That is
  deliberate: every other route to the volume needs a credential.
- One Hono API (`src/api/index.ts`) and, inside the same container: a **3-minute
  tick** (discover -> drain -> alerts -> vision), a **daily sweep** that detects
  delisting and price moves, and a photo prune. Engine is at **0.3.16**.
- The crawl is SPLIT: `discover()` queues new listing ids (5 requests, ~0.8s for
  the whole Boston feed), `drain(limit)` analyses from a queue TABLE. Read
  `src/crawler/queue.ts` before changing any of it.
- 62 TypeScript files under `src/`. **Zero tests.** That is not an oversight you
  need to point out; it is a known gap and fixing it is in scope.

## What to audit

Go wide. The brief is money, storage, time, and functionality, but do not treat
that as a checklist — anything that makes this system cheaper, faster, more
correct or more maintainable is in scope.

### Money
- **Anthropic vision** is the only per-unit cost. Haiku, capped at $2/day, and
  **measured at $0.0031 per listing** (~6k tokens, ~10s for 10 photos). It runs
  as its own pass (`src/crawler/vision-pass.ts`), 3 per tick, last in the tick
  so it never delays an alert. Is the cap enforced on EVERY path? Is the
  photo-fingerprint cache actually preventing re-reads? Is the candidate
  selector spending on the right listings? **Note the arithmetic trap**:
  per-tick limits must be re-derived whenever the tick interval changes —
  8/tick at 3 minutes would be ~$12/day against a $2 budget.
- **eBay Browse API** — 5,000 calls/day, currently barely used.
- **Railway** — one container, one 5 GB volume.
- Anything that re-fetches, re-computes or re-stores something it already had.

### Storage
- The volume filled once and took production down for 13 hours (reads kept
  working, writes failed, and one generic catch reported it as a database
  fault). See HANDOFF. Photos are now released after hashing — verify that
  actually holds on every path, including failure paths.
- **`verdicts` holds 12,291 rows for 936 listings — 13 per listing.** It gains a
  row on every re-score, and re-scores happen on every engine bump and every
  tick that finds newly-priceable listings. Only the MAX(id) per listing is ever
  read. That is a concrete, quantified waste; decide whether history has value
  and prune or cap accordingly.
- `comps`, `listing_photos`, `crawl_queue` and `vision_results` also grow
  without bound.
- The archive is committed to git, so every export adds ~1 MB to repo history
  forever. Is there a better shape?

### Time
- The split loop is **built and live** as of 2026-08-27: 3-minute ticks,
  detection latency ~90 seconds. Verify it behaves under load — the queue had
  **711 entries** when last measured, draining 40 per tick. Is that the right
  rate? Does a burst starve the sweep or the vision pass?
- `drain` runs `checkListing` at concurrency 3. Is that the right politeness
  ceiling against Craigslist, and is it the bottleneck?
- `checkStored` is called in loops in several places. Profile before assuming.
- SQLite indexes: several hot queries scan.

### Functionality and correctness
- Current verdict distribution over 936 listings: **OUT_OF_SCOPE 541,
  INSUFFICIENT_DATA 280, PASS 95, FAIR 11, VERIFY 6, BUY 2, RISK 1.**
  Two BUYs out of 936 is the number that matters commercially. Is the engine
  too conservative, is the inventory genuinely that thin, or is something
  upstream discarding good listings? **OUT_OF_SCOPE at 58% deserves its own
  scrutiny** — several filters were widened quickly and one of them ate 13
  previously-priced listings (judged correct at the time, but check).
- Inside INSUFFICIENT_DATA: ~120 "couldn't identify the model", ~49 "no recent
  sold comps", ~69 "a required field was not stated", the rest build/parts gaps.
- The generative matcher (`src/catalog/derive.ts`) parses a model out of a title
  and mints the SKU — 20 minted so far. It covers Dell/HP/Lenovo laptop lines,
  GPUs, and Apple desktops (via A-number). Remaining brands are open work, and
  so is whether minting from untrusted titles needs more guards than it has.
- The "not stated" cases cannot be fixed by the catalog — the seller did not
  write the spec and it is usually in a photo. Vision is the lever, and the
  vision pass now revisits them, which it never used to.
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
