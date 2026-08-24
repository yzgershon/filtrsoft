# HANDOFF — Assyze

**Master plan AND current state. Update before you stop working.** A stale line here
is worse than a missing one, because a fresh session will believe it.

Last updated **2026-08-24**.

---

## 1. What Assyze is

**A marketplace of only the good deals.** Open it, see used-tech listings the engine
actually verified, tap one for the full reasoning and a link to the seller.

It is **not** a paste-a-link tool. That flow exists as a secondary feature; the feed
is the product. This was corrected mid-build on 2026-08-24 — the first version had
it backwards.

**The thesis:** used tech has *binary, hidden value-destroyers* that price comps never
capture — iCloud Activation Lock, blacklisted IMEI, carrier lock, EFI lock, battery
health, mined GPUs, datacenter cards with no display outputs. Every competitor values
the **model**. None value the **risk**.

**Why a feed is not the commodity "alerts" nine competitors sell:** alerts are push,
keyword-configured, per-user setup. A feed is browse-first with zero setup, and it
requires **ranking** — which requires a verdict. They rank by price and keyword
because they have nothing else to rank by.

**Governing principle: reliability over coverage.** Missing a deal costs nothing.
Sending someone 45 minutes to a scam ends the brand. The engine is allowed to say
"I don't know."

**Scope:** laptops, phones, GPUs, prebuilt PCs, consoles, tablets, components.
**Out:** furniture, clothing, cars, and **cameras** (cut — no domain knowledge to audit against).

**Per-user later:** signup takes location + interests, feed is scoped to their area
and their profit floor. Yish's feed works standalone until then.

---

## 2. Current state — 2026-08-24

### Commands
```
bun run api                       HTTP API + serves web/dist        :3177
cd web && bun run dev             frontend dev server                :5177
bun run crawl [--pages N] [--limit N] [--vision N] [--cat sya,moa]
bun run check <url> [--vision]    one listing, staged timings
bun run verdict                   re-score every stored listing
bun run score                     engine vs Yish's 69-listing audit
bun run stats                     archive health
bun run backup                    verified snapshot -> backups/ + OneDrive
bun run seed                      catalog + economics + judgments
bun run comps:provisional         placeholder comps — DELETE when eBay lands
```

### In the database
| | |
|---|---|
| SKUs | 62 (101 aliases, 8 dead-liquidity) |
| Comps | 80 — **all provisional/fake**, covering 10 of 62 SKUs |
| Listings | ~341 (crawled) |
| Verdicts | 332 INSUFFICIENT_DATA · 2 FAIR · 2 VERIFY · 1 BUY · 1 RISK · 1 PASS |
| Judgments (eval set) | 69 |
| **Engine vs Yish** | **3/10 exact · 3 harsher · 3 softer — no directional bias** |

**332 of 341 can't be priced because 52 of 62 SKUs have zero comps.** The pipeline is
right and the pantry is empty. Everything unblocks when eBay comps land.

### Built
- **Engine as a service** — `src/engine/`. `checkListing(url, {onStage})` and
  `checkStored(id)`. Extraction verified **byte-identical** to the old scripts.
- **Crawler** — `src/crawler/`. Funnel: discover → text pass (~5ms) → triage →
  vision only on survivors. Parallel batches of 6.
- **API** — `src/api/`. `POST /v1/checks`, `GET /v1/checks/stream` (SSE),
  `GET /v1/checks/:id`, `GET /v1/feed`, `GET /v1/health`. Serves `web/dist` in prod.
- **Web app** — `web/`. React + Vite, mobile-first, renders inside a phone frame on
  desktop. Bottom nav: Deals / Check / You. WCAG-verified contrast on all 13 pairs.
- **Vision** — `src/vision/`. Headless Claude Code with **3-account failover**
  (yish → robbie → amitai), usage-limit detection, 30-min cooldowns. Cache-first.
- **Signals, catalog, valuation, verdict** — unchanged from 2026-08-23, see that
  session log.

### Measured latency
```
 38ms  fetched     listing parsed
 43ms  signals     red flags — pure compute
 44ms  valued      match + comps + verdict
238ms  vision      when cached
~60s   vision      cold (CLI). API+Haiku would be ~4s.
```

### NOT built
Accounts · payments · mobile app · listing auto-draft · outcome loop · alerts · real comps.

---

## 3. Deployment — Railway

**Live config:** project `selfless-freedom`, service `assyze`, branch `main`,
auto-deploy on, volume `assyze-volume`, custom domain `assyze.com` pending DNS.

Build is a **Dockerfile** (not Nixpacks — see traps). Multi-stage: Node builds Vite,
Bun runs the server. One service serves API + frontend on one origin.

Env vars:
```
ASSYZE_DB      = /data/assyze.db
ASSYZE_PHOTOS  = /data/photos
```

**⚠ The Railway volume is NOT the archive.** It holds a fresh seed — 62 SKUs,
**zero comps**. Every comp, listing, verdict and judgment lives in
`C:\Dev\assyze\assyze.db` on his PC, because the crawler and the comps pullers
run locally. Backing up the volume today backs up an empty database. Revisit
this only if ingestion ever moves into the container.

**⚠ Vision does NOT run in production.** The container has no Claude CLI and no
credentials, so `visionAccounts` is empty and the deployed app is **text-layer only**.
Do not fix this by shipping credentials into an image. Fix it with an Anthropic API
key, which is the same change that takes vision from 60s to 4s.

See `DEPLOY.md` for full steps.

---

## 4. Live traps

### ⚠ Anchor every gitignore and dockerignore pattern
**This cost most of a day.** A bare `photos/` in `.gitignore` matches a directory of
that name **at any depth**, so it silently excluded `src/photos/` — source code —
from every commit. Railway crashed on `Cannot find module '../photos/index.ts'`
forever while local builds worked, because the file existed on disk but was never
in the repo.

**When a deploy says a module is missing, the FIRST check is `git ls-files <path>`,
not a theory about Docker.** Four rounds of architecture, memory, healthcheck and
ignore-semantics guessing were all wrong; one `git check-ignore -v` was right.

Audit with:
```bash
find src web/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.sql" \) \
  | while read f; do git ls-files --error-unmatch "$f" >/dev/null 2>&1 || echo "UNTRACKED: $f"; done
```

### ⚠ Never pass `-c user.email` on a commit
27 commits landed on GitHub attributed to a different person because the session's
`userEmail` was used instead of the repo config. **GitHub attributes by EMAIL**, so
the name looked right and the account was wrong. Repo config is correct; a
`.git/hooks/pre-commit` guard now blocks any commit with the wrong email.

### Deploy traps
- **Nixpacks can't detect Bun from `bun.lock`** (it looks for `bun.lockb`). It fell
  back to Node and died on `bun: not found`. Hence the Dockerfile.
- **Bun OOMs running Vite.** Node builds the frontend in stage 1; Bun runs the server
  in stage 2.
- **SQLite creates the file, never the directory.** `mkdirSync` the parent first or
  the process dies at import with no listener and the healthcheck times out silently.
- **Bind `0.0.0.0`.** Loopback inside a container is invisible to the platform.
- **`/v1/health` must not require the database.** It reports DB trouble in the
  payload; making it query SQLite turned a database problem into a silent 91s timeout.
- **Cross-building amd64 on this ARM64 machine is unreliable** — QEMU segfaults on
  memory-heavy JS builds regardless of code correctness. Don't trust it as a repro.
- **`pkill -f` does not kill the API on Windows.** Use
  `Get-NetTCPConnection -LocalPort 3177 | Stop-Process -Id $_.OwningProcess -Force`.
- **The API does not hot-reload** unless started with `--hot`. A stale process served
  verdicts missing a whole field for two test rounds.

### ⚠ Never back up SQLite by copying the .db file
WAL mode keeps recent writes in a separate `-wal` file until a checkpoint. On
2026-08-24 the database was **1.3 MB and the WAL was 4.1 MB** — copying only the
`.db` would have silently dropped most of the archive, and the copy would have
opened fine and looked healthy. `bun run backup` uses `VACUUM INTO`, which folds
the WAL in, is safe while the API is serving, and then **reopens the snapshot and
compares row counts** before reporting success. A backup nobody has read is a
guess about a file.

### Engine traps
- **Never sample photos.** The funnel may drop *listings*; once a listing reaches
  vision it must never drop *photos*. Phase 0's miss was a skipped third image
  holding the entire spec sheet.
- **Don't regex the model's prose — ask for a boolean.** A port check fired on
  "no visible damage."
- **A confident wrong number is worse than no number.** Sum-of-parts once priced a
  whole PC off its GPU alone and said PASS. Coverage guard prevents it.
- **Store every comp forever.** eBay exposes ~90 days; every day not running is
  history you never get back.
- **Verdicts are RELATIVE TO THE USER.** Same listing is honestly BUY for one person
  and PASS for another.
- **Never ask a user for Facebook credentials or a session token.**

---

## 5. Open decisions

| Question | Status |
|---|---|
| Anthropic API key | **The single highest-leverage unblock.** Vision 60s→4s, works in production, ends subscription-quota dependence. ~$20. |
| Section 11 of `RISK-MODEL.md` | **Yish to fill** — the stories only he has |
| Facebook gross ratio (0.85) | A guess, and per-category is known to be more correct. Replaced by outcome data eventually. |
| Archive backup | **Done 2026-08-24.** `bun run backup` -> `backups/` + `~/OneDrive/assyze-backups/`, 14 daily kept, verified on write. Run it manually; a scheduled task is offered but not installed. Railway volume snapshots still off, and irrelevant until ingestion runs server-side. |
| Dead-category list | 3 known: VR, pre-2019 Intel Macs, datacenter GPUs |

---

## 6. Immediate next actions

1. **Redeploy on Railway** — `src/photos/index.ts` is finally in the repo.
2. **Add the Namecheap DNS records** (ALIAS not CNAME at apex — see DEPLOY.md).
3. **eBay Production keys → `.env`** when the account clears review. **Run
   `bun run backup` the day comps first land** — that is the day the archive
   stops being reproducible.
4. Then: real comps → delete provisional → re-run `score`.

---

## 7. Key documents

| File | What it is |
|---|---|
| `DEPLOY.md` | Railway deploy, DNS, and why not Vercel |
| `docs/MASTER-PLAN.md` | Product design, architecture, GTM, pricing, sequencing, engine gaps |
| `docs/RISK-MODEL.md` | **The moat.** Hard blockers vs flags, listing signals, per-category rules |
| `docs/CALIBRATION-2026-08-23.md` | What Yish's 69-listing audit corrected. 9 findings. |
| `docs/VERDICT-SCHEMA.md` | Output contract |
| `docs/research-2026-08-22.md` | Market, competitors, legal, API landscape |
| `docs/testset/audit.html` | The audit tool, re-runnable |
| `docs/sessions/` | Session logs with rejected directions and why |
