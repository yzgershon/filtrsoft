# Filtrsoft daily operating guide

Current as of September 23, 2026. Detailed history lives in `HANDOFF.md`; this page is
what to do, not what happened.

## What runs where

| Place | What it does | When |
|---|---|---|
| **Railway** (`filtrsoft.com`) | API and app; Craigslist discovery (about 5 requests every 3 minutes); scoring; push alerts every 30 s; daily availability sweep; backups | Always |
| **OMEN** (`C:\Dev\filtrsoft-agent`) | Facebook, OfferUp and Mercari search, full listing reads, availability probes, eBay sold comps, identity comps; uploads to Railway | Cycles with a 30-minute rest; primary collector |
| **Laptop** | Registered fallback collector | Paused; keep it paused |
| **Phone** | The app and push notifications | When you look |

Chrome for collection opens on a private Windows desktop (`FiltrsoftCollector`), so it
never takes focus from a game. Manual sign-ins still open visibly.

## Each day

1. Open the app. Start with **BUY**, then **VERIFY**. Those two calls are also what every
   push-enabled device receives, plus your saved searches.
2. For a VERIFY, read the questions it lists (IMEI, activation lock, financing, BIOS
   password, why it is cheap). Ask the seller before driving. A VERIFY is not a deal yet.
3. RISK means a disclosed or detected hard problem (not working, for parts, off-platform
   contact, bulk-posted scam pattern). Skip it unless you want parts.
4. FAIR means real margin that does not pay for the trip; PASS means overpriced.
   INSUFFICIENT_DATA means a deciding fact is missing and the app says which one.
5. Save or dismiss, and record a purchase or pass so later outcomes can be reviewed.

Engine 0.3.48 no longer sends VERIFY for tiny-margin items (a $10 GTX 960) and treats
phone numbers spelled out in words as an off-platform redirect (RISK). It runs on the
OMEN collector now; production gets it when the September 22 pull request is merged.

## When something changes on the OMEN

- **Gaming:** nothing to do. Collection uses the private desktop; no local AI model runs.
- **Pause / resume:** desktop shortcut *Filtrsoft Collector* (Pause, Resume, View
  collector), or in `C:\Dev\filtrsoft-agent`: `bun run pause --on` / `bun run pause --off`.
- **Sleep, reboot, network loss:** the supervisor restarts the worker; the logon task and
  the daily 10 AM task start it again; unsent uploads stay in the outbox and resend.
- **Marketplace sign-in or challenge:** the collector log states why an item was not
  read (`facebook detail <id>: <reason>`). Pause, sign in with the visible login command,
  then resume.
- **Installing an update:** only through the maintenance script (idle collector, owned
  stop, restore-verified backup, fast-forward, installed tests and doctor, preservation
  check, restart through *Filtrsoft Daily Crawl*). Example:
  `C:\Dev\filtrsoft-recovery-data\claude-20260922\maintain-0348.ps1`. Never `git pull` in
  the runtime and never reset it.

## Checking health

- Production: `https://filtrsoft.com/v1/health` (engine, database, scoring pending).
- Collector: `C:\Dev\filtrsoft-runner-state\status.json` and `agent.log`, or
  `bun --env-file=C:/Dev/filtrsoft-data/collector.env run agent:status --remote`.
- A source shown as "attention" now comes with a reason per item in `agent.log`.

## Paid AI

No paid model runs in production. Both Claude paths were verified paused at the
September 17/18 checkpoint (not re-verified on September 22). GPT-6 Luna was
benchmarked only (`docs/LUNA-GEMMA-EVALUATION-2026-09-22.md`). If an operating budget is
approved, photo reads run in shadow mode under a hard daily cap; when the cap is reached
the work waits unresolved, it never falls back to a more expensive model.

## Where changes go

Development happens in a separate checkout on a branch, merged to `main` after CI.
Railway deploys `main`. The OMEN runtime is updated from a reviewed commit only through the
maintenance script. Private configuration, databases, browser profiles and keys stay out
of Git.
