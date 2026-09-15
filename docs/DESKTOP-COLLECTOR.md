# Desktop collector

The website/API and Craigslist run on Railway. The desktop supplies Facebook,
OfferUp and Mercari visits from local browser profiles. Keep the computer awake,
signed into Windows and connected to the internet. Turning the screen off is
fine; sleep stops work. Nothing listens for inbound connections to the PC.

## Reliability

- One hidden Node supervisor restarts the Bun collector with backoff. Both the
  logon shortcut and existing daily task ensure the same supervisor is running.
- A machine lease excludes a second collector/manual daily crawl. Server job
  claims coordinate separate computers. Site profile leases remain in place.
- Each cycle rotates two of five searches. Sources take turns; one source's
  challenge stops further visits to it in that job while the others continue.
- Existing unacknowledged captures sync first; every crawl/detail/probe stage
  checkpoints facts, including partial failures. No date window drops old work.
- Browser stages have four-minute ceilings and terminate only their own child
  tree. Both output pipes are drained. Missing completion and failed detail
  reads cannot report a successful crawl.
- Pause stops new work and interrupts a current browser stage. A final upload
  may finish because it opens no browser and preserves already collected facts.
- Paid desktop vision defaults off. It requires an explicit per-machine budget;
  the local and Railway databases do not share a spending ledger.

The 45-minute server cadence is measured after job completion. It is not an
instant or guaranteed notification SLA. A healthy run with zero new listings
can succeed; a blocked/failed run cannot.

## Install or update on Windows

Use a dedicated checkout of the reviewed commit, not a dirty development
checkout. Keep the ingestion database outside that checkout's update lifecycle.
Back up and verify the existing database before upgrading its schema. Reuse the
already installed Node/Bun on this machine. Do not install/download new tools or
models without Yish's authorization.

From that checkout, run `bun run agent:install` with explicit `--node`, `--env-file`, `--database` and `--state` paths.
The running Bun binary supplies its own absolute path. `--prepare`
writes reviewable configuration and a launcher without changing startup/tasks.
The installer reads no secret values. Bun loads the existing environment file.

The state folder contains `config.json` (paths only), `start.cjs`, `status.json`,
`supervisor.json` and rotating `agent.log`/`agent.log.previous`. The installer
backs up the prior startup command and scheduled-task XML before replacing them.
No scheduled task is created on a new PC; the logon shortcut is sufficient.

Run `node start.cjs` to start or recover the supervisor. Creating an empty `stop` file
in its state folder stops its own tree. Starting it clears this file. For a
persistent pause across restart, use the existing `bun run pause --on` command;
`--off` resumes. A scheduled recovery never clears the pause flag.

`bun run agent:status` reads local receipts. Add `--remote` with the collector's
existing environment loaded to read authenticated aggregate production arrivals
and recent verdict counts. This endpoint neither claims jobs nor exposes user
accounts, notes, listing bodies or credentials. It does not make a stopped
collector appear online.

To update: stop the supervisor, verify its processes exited, advance the dedicated
checkout to the reviewed commit, run the release checks, and start it again. Do
not update source under a live crawler. Preserve the state directory and DB.

## Yish's gaming PC

Supplied configuration: HP OMEN MAX 45L, Ryzen 7 9700X, RTX 4070 Ti, 32GB
DDR5-6000, 1TB NVMe, 1200W PSU, 360mm AIO. Not remotely provisioned yet.

It can host the existing collector while the laptop is asleep, maintain more
consistent listing/price observations and sold-status checks, and run background
comp collection when scheduled within source/profile limits. It does not recover
unobserved historical prices or guarantee more BUY calls.

The GPU enables experiments with local OCR and vision for model labels, BIOS/
spec screens and listing photos. Validate exact-model, quantity, capacity and
conflict detection against held-out seller examples before using results in
valuation. A small local model is not automatically as accurate as the current
vision provider. GPU-heavy work should yield while gaming; browser collection
usually needs CPU/RAM/network rather than sustained GPU compute.

On a second PC, sign into each marketplace manually in its own local profile.
Do not copy cookies or credentials from the laptop. Authentication/configuration
is completed by Yish; no personal token is requested here.
