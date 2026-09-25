# Filtrsoft daily operating guide

Current as of September 23, 2026 (photo readings added). Detailed history lives in `HANDOFF.md`; this page is
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

**What the feed carries (Yish, September 24):** GPUs and gaming PCs, laptops and
MacBooks, and PC parts, from about 2020 on (Intel 10th gen, Ryzen 3000, RTX 20 /
GTX 16, RX 5000, Apple M1). Phones, tablets, wearables and VR, accessories, office
and basic Windows machines without a gaming GPU, and older hardware are marked out
of scope and never shown. **BUY/VERIFY need at least $75 net** for a trip of up to
20 minutes (more for longer drives), with a local sale assumed to bring the eBay sold
price less eBay's ~13.5% cut. Engine 0.3.49.

## When something changes on the OMEN

- **Gaming:** nothing to do. Collection uses the private desktop. The local photo reader
  (Gemma) waits until you have been away for 10 minutes with the GPU idle, and stops
  when you return (see *Photo readings* below).
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
  `powershell -NoProfile -File C:\Dev\filtrsoft-recovery-data\claude-20260922\maintain.ps1 -target <commit> -tag <name>`,
  then read `maintenance-<name>-receipt.json` beside it. Never `git pull` in the runtime
  and never reset it.

## Checking health

- Production: `https://filtrsoft.com/v1/health` (engine, database, scoring pending,
  storage pressure). Verdict history older than 14 days is pruned automatically
  (current verdicts and anything a decision record names are kept). The volume is
  small: on-server backups need room for a full copy and stay off until it grows.
- Collector: `C:\Dev\filtrsoft-runner-state\status.json` and `agent.log`, or
  `bun --env-file=C:/Dev/filtrsoft-data/collector.env run agent:status --remote`.
- A source shown as "attention" now comes with a reason per item in `agent.log`.

## Photo readings (shadow mode, approved September 23)

The OMEN reads listing photos in the background and shows the result in a listing's
**Specs** tab under **Read from photos**. It never changes BUY/VERIFY/RISK or a price.

- **GPT-6 Luna (high)** reads new Facebook, OfferUp and Mercari listings with 1–6 photos
  whose call a photo could settle (a missing spec or exact model), plus BUY and VERIFY.
  Budget: **hard cap $0.50 per UTC day** (expected about $0.20–0.30/day, ~$8/month). At
  the cap, reads wait for the next day; nothing falls back to another model.
- **Gemma 31B** on the OMEN re-reads the same photos. Only facts both readers report the
  same way are shown as **Both readers agree**; differences are shown as **Readers
  disagree**; everything else is collapsed as one reader only, unchecked.
- **Gaming:** Gemma starts only when nobody has touched the keyboard or mouse for 10
  minutes *and* the GPU is idle. If you come back it stops within about 20 seconds and
  unloads. To keep the GPU free even while away, create an empty file
  `C:\Dev\filtrsoft-runner-state\pause-gpu` (delete it to allow reads again). Pausing
  the collector also stops both readers.
- **Check spend:** in `C:\Dev\filtrsoft-agent`,
  `bun --env-file=C:/Dev/filtrsoft-data/collector.env run photo:shadow --status`
  (today, this month, reads, waiting for Gemma). Per-pass logs:
  `C:\Dev\filtrsoft-runner-state\maintenance-photo-shadow.log` and `…photo-verify.log`.
- **Turn off:** remove `FILTRSOFT_PHOTO_SHADOW=1` (Luna) or `FILTRSOFT_PHOTO_SHADOW_GEMMA=1`
  (Gemma) from `collector.env` and restart through the maintenance script.

Both paid Claude paths stay paused (verified at the September 17/18 checkpoint). No paid
model runs on Railway.

## Where changes go

Development happens in a separate checkout on a branch, merged to `main` after CI.
Railway deploys `main`. The OMEN runtime is updated from a reviewed commit only through the
maintenance script. Private configuration, databases, browser profiles and keys stay out
of Git.
