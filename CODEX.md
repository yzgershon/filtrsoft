# Filtrsoft — master brief for Codex

Paste this whole file as your first message in a new Codex session, or point
Codex at `C:\Dev\filtrsoft\CODEX.md`. It is the front door. It does not contain
the current state on purpose — `HANDOFF.md` does, and duplicating it here would
create two sources of truth that drift.

---

## 0. Who you are working for

You are working for **Yish** (Yishai Gershon), 18, a junior at Newton North High
School in Newton, Massachusetts. He flips used tech locally and runs a mobile
car-detailing business. He is a competent engineer and an expert in this
specific market. Call him **Yish**, never "the user".

**His domain knowledge outranks yours.** He buys and sells this hardware every
week; you have a training cutoff. When he tells you a price, a chip, or a
market behaviour, he is almost certainly right and you are almost certainly
quoting something stale. Three real examples from one afternoon:

- You will think a 2TB NVMe costs about $90. It is $300+. NAND and DRAM ran up
  hard and every component price in your weights is low.
- The **Ryzen 5 7600X3D is a real chip** (Zen 4, 3D V-Cache, Micro Center
  launch exclusive). Claiming otherwise made him say *"You CANNOT make this
  mistake."*
- **ASUS and Gigabyte versions of the same GPU sell for different money.**

Check the database before you contradict him. If the database has nothing, say
it has nothing — do not fill the gap from memory.

---

## 1. What Filtrsoft is

**A used-tech listing scanner. It tells you what a listing is really worth and
what is wrong with it, before you drive.**

Live at **https://filtrsoft.com**. Mobile-first web app, one real user (Yish),
Greater Boston.

It crawls Craigslist, Facebook Marketplace, OfferUp and Mercari, prices each
listing against what the same thing actually SOLD for, checks a list of hidden
defects, and returns exactly one call:

    BUY IT · VERIFY FIRST · FAIR · PASS · RISKY · (or "I can't tell")

**The thesis, and the reason it is not just a price lookup:** used tech has
binary hidden value-destroyers that price comps never capture — iCloud
Activation Lock, blacklisted IMEI, carrier lock, EFI lock, battery health, a
mined GPU. Every competitor values the model. None value the risk.

**Reliability over coverage. The engine is allowed to say "I don't know."**
This is the single most important product rule in the codebase. A confident
wrong answer sends Yish across Boston for nothing. `INSUFFICIENT_DATA` is a
correct output, not a bug — do not "fix" it by loosening a comp filter.

---

## 2. Read these before writing code

1. **`HANDOFF.md`** — current state and every live trap. **Section 0 first, in
   order.** It supersedes anything later in the file that disagrees. Never
   quote a version, a count or a status from memory; read it there.
2. **`docs/`** — design system, research, session records.
3. `git log --oneline -20` — commit messages here are written to explain WHY,
   and they are often the only record of a decision.

**Update `HANDOFF.md` before you stop working.** A stale line in it is worse
than a missing one, because the next session will believe it.

---

## 3. Architecture, and the parts that will bite you

**Stack:** Bun + TypeScript backend, React 19 + Vite frontend, SQLite
(`bun:sqlite`), Playwright for browser work, deployed on Railway from `main`.

### Two runtimes, and it is not a style choice

**Playwright HANGS under Bun on this machine.** `chromium.launch()` never
resolves; identical code under Node 24 launches Chrome in about 3 seconds. Bun
cannot be dropped because `bun:sqlite` is the database.

So: **anything that drives a browser is a `.mjs` worker run by `node`.
Everything else is `bun`.** Workers are dumb — they emit raw text and links,
and all parsing lives in TypeScript where a fixture can test it. Do not
"simplify" a worker by moving parsing into it.

### What runs where

| | |
|---|---|
| **Railway** | the API, the web app, and the Craigslist crawler (plain `fetch`, no browser) |
| **Yish's laptop** | Facebook, OfferUp, Mercari, eBay comps. These need a logged-in Chrome profile he signs into by hand. **Session cookies do not go in a server image and never will.** |

The laptop half runs through `bun run agent`, which polls `/v1/jobs/next` every
15 seconds and executes what the server queued.

### Load-bearing details

- **`ENGINE_VERSION`** in `src/engine/index.ts` is a trigger, not a label.
  Bumping it makes `reverdictStale` re-score production. **If you change
  anything that affects a verdict, bump it, or your fix reaches nobody.**
- **Comps use a 90-day window** in `valueSku`, and ship to production frozen in
  `data/archive.json.gz`. Production does not crawl eBay.
- **SQLite is WAL with `busy_timeout = 5000`.** The default `busy_timeout` is
  0, which fails instantly — that killed a 120-listing probe mid-run.
- **Cloudflare fingerprints the browser, not the session.** Mercari needs a
  HEADED run every single time. A headed run does NOT leave clearance behind
  for a later headless one; measured back to back, headed read 28 links per
  query and headless immediately after read zero and was challenged 7 of 7.
- **Windows: `child.kill()` does not kill a process tree.** Use
  `taskkill /pid X /T /F`. A surviving Chrome renderer keeps the profile
  locked and the next crawl cannot open it.
- **Crawl browsers open OFF-SCREEN** (`--window-position=-32000,-32000`), so
  automation never steals focus while he is using the machine.

---

## 4. Rules of engagement — these are not negotiable

**Working with Yish**

- **Push freely when reasonable.** Do NOT tag a release, install anything,
  publish, or spend money without asking.
- **Never pass `-c user.email` on a commit.** A previous agent did and put 27
  commits under the wrong GitHub account, because GitHub attributes by email.
- **Never add `Co-Authored-By: Claude`** or any AI attribution to a commit.
- **No em dashes in anything written in his voice** — ads, replies, site copy,
  button labels. It is one of his tells for AI text. Prose about the work is
  yours and may use them.
- **When he supplies wording, use it verbatim.** Do not reword unless asked.
- **Never enter an API key or token into a web form.** Print it or copy it to
  the clipboard and let him paste it into Railway himself.
- **No credential handling, ever.** He signs into Facebook, eBay and OfferUp by
  hand in a real Chrome window. Do not automate a login.

**Settled decisions — do not re-litigate these**

- **Consoles are permanently out of scope.** Xbox, PlayStation, Switch, Steam
  Deck, retro. His call: they are hard to resell. The verdict engine refuses
  them outright and the crawl queries no longer include them.
- **Consumer tech only.** Not furniture, not clothes, not cars.
- **Craigslist and Facebook automation is green-lit.** He said *"Im not worried
  about getting caught or anything so go right ahead even if it is against
  their terms."* Do not raise it again.
- **The credential-location and account-ban concerns about background Facebook
  crawling are explicitly WAIVED.** Do not raise those again either.
- Standalone mobile app eventually, Google Play first. Web app is the testing
  surface and the permanent top of funnel.
- Photos stay remote. Do not retain photo bytes on the Railway volume.

---

## 5. How to be useful here

**Measure, then claim.** This project has a strong habit of checking things
against the database and the compiled output rather than reasoning about them,
and most of its real bugs were found that way. Some that were only visible by
looking:

- Vision was blamed for months of bad reads. It was fine. The engine was
  discarding `Intel UHD Graphics 630` because the accepted vocabulary was four
  words that missed the most common integrated GPU on earth.
- Mercari reported `ok` for nine days while returning nothing. A Cloudflare
  challenge page parsed as "no results" and exited 0.
- A comp guard rejected 81 of 122 correct rows because `6000MT/s` looked like a
  variant of `6000`.
- An HTML comment in an SVG contained `--` (from CSS variable names). That is
  illegal in XML, so the favicon was a broken image while every PNG beside it
  worked.

**Verify against the build, not the source.** For anything CSS, grep
`web/dist/assets/*.css`. A minifier has silently dropped a working property here
before while the source looked perfect.

**Write comments that explain WHY, with the evidence.** The codebase is dense
with them and that is deliberate — most say what broke, with the measurement
attached. Match that. A comment that only restates the code is noise; a comment
naming the bug it prevents is what stops the next person reintroducing it.

**Finish the whole ask.** Do not defer part of it by predicting it is too big.

---

## 6. Where things are headed

**Immediate, in priority order — this is section 0k of `HANDOFF.md`, read it
there for the detail:**

1. **Re-verdict everything.** Bump `ENGINE_VERSION` and let `reverdictStale`
   run. Five new component categories, 39 new build SKUs, roughly 3,400 new
   comps and three fixed comp-discarding bugs have all landed since the last
   scoring pass and **not one listing has seen any of it.** Measure
   `INSUFFICIENT_DATA` before and after. Do not assume it drops.
2. **Dealer spam: 151 listings across 45 repeated ads.** One Craigslist
   reseller posting microwaves and ice makers into the electronics category,
   the same title 4 to 14 times. **Not yet authorised — ask Yish first.**
3. **50 listings whose asking price is a placeholder** with the real prices in
   the description. His instruction: *"this is the exact scenerio where you
   need to go into the description and images and figure out what ram it is if
   you want to price it out."*
4. **Then: cut the feed to about 10 listings** so he can train the engine on
   which tech to skip. He was explicit this comes AFTER the can't-tells.

**Medium term**

- **AIB brand pricing.** One SKU per GPU chip today, but ASUS and Gigabyte sell
  for different money. The brand is already sitting in `comps.raw_title` and
  could be read at valuation time without exploding the catalog into 5 brands
  times 60 chips.
- **Always-on crawling.** The goal is a notification the moment a deal is
  posted, without his laptop being awake. He has a 2015 MacBook Air and an old
  Surface Pro as candidate always-on boxes.
- **Scam detection from his labels.** He hand-marks risky listings on his phone;
  those labels are training data. The existing detector came from ~20 of them.
- Google sign-in needs `GOOGLE_CLIENT_ID`. Apple needs the paid membership.
  Password reset needs outbound email.

**The long game:** a standalone mobile app, and a valuation engine good enough
that the feed is short and every item on it is worth driving for.

---

## 7. First moves in a new session

```bash
cd C:\Dev\filtrsoft
git log --oneline -15          # what just happened and why
bun test                       # 194 pass / 0 fail as of 2026-09-06
bun run typecheck              # tsc --noEmit
bun run stats                  # archive health
```

Then read `HANDOFF.md` section 0. Then ask Yish what he wants, or pick item 1
from section 6 and tell him you are starting it.

**One agent edits at a time.** Claude Code and Codex share `C:\Dev`. Check
`HANDOFF.md`, `git status` and recent commits before editing, and write
`HANDOFF.md` before you stop so the other one can continue.
