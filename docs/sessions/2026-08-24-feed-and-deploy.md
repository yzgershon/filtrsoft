# Session Log — 2026-08-24 — Feed, Deploy, and Two Expensive Traps

Read `HANDOFF.md` for state. This is the reasoning and the mistakes.

---

## 1. The product was mis-scoped, and Yish corrected it

I built a paste-a-link tool. He wanted **a marketplace** — a browsable feed of only the
good deals, tap one for the full reasoning and a link to the seller. Like eBay, but
curated to what's actually worth driving for.

**Why this is not the commodity "alerts" I'd dismissed in the master plan:** alerts are
push, keyword-configured, per-user setup. A feed is browse-first with zero setup, and
it requires **ranking** — which requires a verdict. The nine competitors rank by price
and keyword because they have nothing else to rank by.

The paste-a-link flow survives as a secondary feature for listings the crawler hasn't
reached. The feed is the front door.

**Per-user is the eventual shape:** signup takes location + interests, feed scoped to
their area and their profit floor. Yish's own feed works standalone until then.

---

## 2. Built this session

- **Engine as a service** (`src/engine/`) — extracted from scripts, verified
  **byte-identical** output before anything was built on top.
- **HTTP API** (`src/api/`) — one-shot JSON, SSE streaming, permalinks, feed, health.
  Serves the frontend from the same origin in production.
- **Web app** (`web/`) — React + Vite, mobile-first, phone frame on desktop so the
  mobile layout is judgeable without devtools. Bottom nav, WCAG-verified contrast.
- **Crawler** (`src/crawler/`) — the funnel that makes a feed possible: discover →
  text pass (~5ms) → triage → vision only on survivors. 341 listings analysed.
- **Ranked feed** — verdict quality → net profit → freshness decay.
- **Ask-the-seller questions** (`src/verdict/questions.ts`) — signal-driven first, then
  value-blocking unknowns, then category standards. No competitor ships this.
- **3-account Claude failover** (`src/vision/accounts.ts`) — yish → robbie → amitai,
  usage-limit detection, 30-min cooldowns. Only switches on a real quota signal;
  malformed JSON is a model problem and must not burn three accounts.
- **Vision on by default, cache-first** — it had been opt-in and the web path never
  asked, so the app ignored photos entirely. Yish caught this from a screenshot.

### Measured
```
 38ms  fetched      43ms  signals      44ms  valued
238ms  vision (cached)          ~60s  vision (cold, CLI)
```

---

## 3. Trap one: git identity — 27 commits under the wrong account

I passed `-c user.email` on every commit, using the session's `userEmail`
(`amitaiszur@gmail.com`) instead of the repo config. **GitHub attributes by EMAIL**, so
the name read `yzgershon` while the account shown was a friend Yish didn't know had a
GitHub. He found it on the repo page.

Fixed by rewriting all 27 commits, deleting a stale `master` branch, and setting the
default to `main`. Every other repo under `C:\Dev` was clean — filtrsoft was the only one
without an explicit repo-local `user.email`, because I created it.

**Prevention:** `.git/hooks/pre-commit` blocks any commit whose author email isn't his.
It catches `-c` overrides because those propagate into hooks. Tested both directions.

**The rule: never pass `-c` on a commit. Set identity once at repo creation.**

---

## 4. Trap two: gitignore ate a source file — and cost most of a day

The Railway deploy failed for **six rounds**. Every round I had a theory:

1. Nixpacks can't detect Bun from `bun.lock` → real, fixed with a Dockerfile
2. Bun OOMs running Vite on amd64 → real, fixed with a multi-stage Node build
3. SQLite creates the file but not the directory → real, fixed with `mkdirSync`
4. `/v1/health` querying the DB turns a DB fault into a silent timeout → real, fixed
5. Boot seed at module load blocks startup entirely → real, fixed
6. `.dockerignore` pattern too broad → **wrong theory**

All six were genuine improvements. **None of them were the bug.**

```
git check-ignore -v src/photos/index.ts
→ .gitignore:9:photos/    src/photos/index.ts
```

`photos/` — added for the downloaded-images folder at root — matched
**a directory of that name at any depth**, so it silently excluded `src/photos/`,
which is source code. **That file had never been committed.** It wasn't on GitHub.
Railway cloned, the file was absent, the container crashed on import, restarted,
crashed, forever.

It worked locally every single time because the file was on my disk.

### The lesson, stated plainly

**The deploy log said `Cannot find module '../photos/index.ts'` in the FIRST
screenshot.** The correct first question was *"is that file committed?"* — one command,
ten seconds. I asked it on round six.

**When a deploy reports a missing module, check `git ls-files <path>` before forming
any theory about the platform.**

Audit command now in HANDOFF:
```bash
find src web/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.sql" \) \
  | while read f; do git ls-files --error-unmatch "$f" >/dev/null 2>&1 || echo "UNTRACKED: $f"; done
```

Both traps are the same shape: **an ignore pattern that matched more than intended,
silently.** Anchor everything with a leading slash.

---

## 5. Deployment decisions

- **Railway, not Vercel.** Vercel's filesystem is ephemeral (kills the comps archive)
  and serverless can't spawn the `claude` subprocess vision needs.
- **One service serves API + frontend.** One origin, no CORS, one deploy.
- **Vision does not run in production.** No CLI, no credentials in the container. The
  deployed app is text-layer only. Do NOT fix this by shipping credentials — fix it
  with an Anthropic API key, which also takes vision from 60s to 4s.
- **Cross-building amd64 on this ARM64 machine is not a valid repro.** QEMU segfaults
  on memory-heavy JS builds regardless of code correctness. It sent me down theory 2.

---

## 6. Where it stands

The image is verified: `--no-cache` build, every source file present, `/v1/health`,
`/`, and `/v1/feed` all 200 on a clean volume. `src/photos/index.ts` is finally on
GitHub. Redeploy should be green.

**The highest-leverage remaining unblock is still the Anthropic API key** (~$20):
vision 60s → 4s, works in production, and ends the dependence on three subscriptions
staying under quota.
