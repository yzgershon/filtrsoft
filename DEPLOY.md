# Deploy — Railway

One service serves the API **and** the built frontend. One origin, no CORS, a
persistent volume for the database. Push to `main` → Railway builds → live.

---

## Why not Vercel

Two hard blockers, not preferences:

1. **SQLite dies on serverless.** Vercel's filesystem is ephemeral — `assyze.db` is
   wiped on every deploy and cold start. That file is the comps archive, the one
   asset here that compounds and cannot be rebuilt (eBay only exposes 90 days).
2. **Vision spawns a subprocess.** `analyzePhotos` shells out to `claude -p`. There
   is no CLI and no process spawning in a serverless function.

Soft blocker: SSE on Vercel Hobby caps around 10–25s; a cold vision check is 30–50s.

Vercel becomes viable *after* migrating SQLite→Postgres and swapping vision to the
Anthropic SDK. Both are on the roadmap; neither is worth doing just to change host.

---

## ⚠ Vision does NOT run in production

The container has no Claude CLI and no credentials, so `visionAccounts` is empty
and **the deployed app is text-layer only.** Photos are downloaded and hashed;
they are not read.

That is not a bug to fix by shipping credentials — subscription auth does not
belong in a server image, and it would be a security problem regardless.

Two honest options:
1. **Deploy text-only for now.** Every risk signal still works: contradictions,
   impossible specs, payment rails, listing age, seller sophistication,
   geographic contradictions, zero photos. That's Phase 1.5 and it is the
   differentiator.
2. **Get an Anthropic API key** and swap vision off the CLI. This is the same
   change that takes vision from ~60s to ~4s, so it pays twice.

Meanwhile vision runs locally, where the CLI and the three accounts live.

---

## Build: Dockerfile, not Nixpacks

**The first deploy failed because of the lockfile.** Nixpacks detects Bun by
looking for `bun.lockb`; this repo has the newer text `bun.lock`, so Nixpacks
fell back to Node and the build died on `bun: not found`.

`Dockerfile` pins `oven/bun:1` and removes the guessing. It is Debian-based on
purpose — sharp needs glibc, and alpine would need native build deps.

Verified locally with a real `docker build` + `docker run` against a fresh
volume: seeds on boot, serves `/`, `/c/:id` and `/v1/health`. Image is ~545 MB.

---

## First deploy

**1. Create the service**
- railway.app → **New Project** → **Deploy from GitHub repo** → `yzgershon/assyze`
- Railway reads `railway.json`: builds with `bun install && bun run build`,
  starts with `bun run start`, health-checks `/v1/health`.

**2. Add the volume — do this BEFORE the first successful deploy**
- Service → **Variables/Settings** → **New Volume**
- Mount path: **`/data`**

Without it the database lives on the container filesystem and **every deploy wipes
your comps archive.** That is the single most destructive mistake available here.

**3. Set environment variables**
```
ASSYZE_DB      = /data/assyze.db
ASSYZE_PHOTOS  = /data/photos
```
`PORT` is injected by Railway; the server already reads it.

**4. Deploy.** On an empty volume the server seeds itself:
```
empty database — seeding catalog + economics…
seeded skus: +62 (8 marked dead)
seeded user_economics: yish
seeded judgments: 69
assyze  :8080  engine 0.3.0  serving web/dist
```

**5. Domain**
- Service → **Settings → Networking → Custom Domain** → `assyze.com`
- Add the CNAME Railway gives you at your registrar
- Also add `www.assyze.com` pointing to the same target

---

## What a fresh deploy can and can't do

**Works with zero comps:** every risk signal — contradictions, impossible specs,
payment rails, listing age, seller sophistication, screenshot artifacts,
boot-screen-only, geographic contradictions. This is Phase 1.5 and it is the
differentiator.

**Won't work until comps exist:** every price. Verdicts will return
`INSUFFICIENT_DATA` with an honest reason. That is correct behaviour, not a bug.

**Do NOT seed provisional comps in production.** They are hand-typed placeholders
and must never reach a user:
```sql
DELETE FROM comps WHERE source = 'manual-provisional';
```

---

## Backups — set this up early

The volume holds the only copy of the comps archive. eBay's 90-day window means a
lost archive is *permanently* lost, not re-fetchable.

- Railway volume snapshots, or
- A scheduled job that copies `assyze.db` off-box

Do it before the archive is worth anything, because by the time it is, it's too
late to wish you had.

---

## Local production check

Reproduces the Railway setup exactly, including a cold volume:

```bash
bun run build
mkdir -p /tmp/vol
ASSYZE_DB=/tmp/vol/test.db ASSYZE_PHOTOS=/tmp/vol/photos PORT=3178 bun run start
```

Expect: self-seed on boot, `/` and `/c/:id` both serve the SPA, `/v1/health` returns JSON.

---

## Costs

| | |
|---|---|
| Railway | ~$5/mo |
| Domain | ~$15/yr |
| Anthropic API | $0 today (vision runs on the Claude subscription via headless CLI). Needed when vision moves to the SDK for speed. |
