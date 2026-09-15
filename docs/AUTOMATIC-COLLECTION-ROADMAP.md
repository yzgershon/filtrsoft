# Reliable automatic collection

Yish approved permanent automatic collection and all six pieces on September 15,
2026, then clarified: **prepare here; migrate the gaming desktop later**.
Read the newest HANDOFF checkpoint for the deployed revision and actual receipts.

## Implemented in the agreed order

1. **Collection health in Settings.** Owner-only source cards distinguish a
   successful search, new captures and successful uploads. Connected machines
   show their revision, last contact and queued listing changes. Login,
   challenge, timeout and upload failures stay visible until that phase recovers.
   A heartbeat alone never implies successful collection. Status refreshes while
   Settings is visible; the existing notification system is unchanged.
2. **Failure recovery.** Tests cover durable uploads and job reports across
   network failure, duplicate exclusion, actual child-process crash/restart,
   stage timeouts, lost job ownership and pause. Recovery tests do not establish
   multi-day uptime or physical Windows sleep/reboot reliability.
3. **Primary computer and fallback.** Each installation has a stable node ID.
   Settings selects a registered primary and a 3-60 minute offline grace
   (default five). An explicit pause allows fallback. Server claims remain
   atomic; a runner stops browser work if its job lease cannot be confirmed for
   two minutes. Existing jobs finish before a preference change takes effect.
   See [desktop setup](GAMING-DESKTOP-SETUP.md) and `bun run agent:doctor`.
4. **Discovery before enrichment.** Facebook search cards persist and upload
   before detail visits. All discovery queries precede bounded detail passes
   (four per source) and probes (six). Challenges/login failures/timeouts retain
   exponential source backoff across cycles while other sources and saved
   uploads continue. The 45-minute gap after each browser job is unchanged;
   faster cadence needs measured useful-capture and throttling results.
5. **Verified backups and controlled updates.** Idle collectors create daily
   WAL-consistent snapshots, integrity/hash-check and restore them, retaining
   three. The server independently attempts a daily snapshot with a free-space
   guard and two-snapshot retention. Failure retries after an hour. Updates
   require a clean reviewed revision and stopped runtime; no live-source
   auto-pull. Same-disk/volume backups do not cover loss of that disk/volume.
6. **Sold comps and local photo trial.** The installed collector configuration
   enables one free eBay SKU refresh every four hours while idle, yielding to
   listing work. A durable queue sends new verified sales directly to the
   server, remapping exact SKU identities and repeating variant, kit and sold
   evidence guards. No fabricated historical prices or widened matching.
   [Local photo evaluation](LOCAL-VISION-EVALUATION.md) accepts only an already
   installed, digest-pinned loopback model, retains per-photo conflicts and
   scores held-out annotations. It refuses a busy GPU before starting and
   supports a manual pause. It cannot write valuation facts.

## Verification and migration boundaries

The September 15 release checks include the full Windows and pinned Linux test
suites, TypeScript, production frontend build and real Settings/API fixture UI
checks at mobile/desktop sizes in both themes. Current totals and production
receipts belong in HANDOFF. The laptop's hidden logon launcher and daily recovery
task were already installed and duplicate-tested in the preceding release.

The HP OMEN is not configured yet. Use the existing private GitHub repo for code;
keep environment files, databases and browser sessions outside Git. Set up fresh
manual marketplace sign-ins, then select that connected machine in Settings.
Measure a complete cycle and controlled fallback before retiring the laptop role.

Remaining device-dependent checks: sleep/resume, reboot/logon, sustained network
loss, multiple unattended cycles, actual 4070 Ti latency/VRAM/accuracy and gaming
contention. No local model has been installed or downloaded. Model memory size
does not prove VRAM use or performance. A separate backup destination still needs
configuration and a restore check.

Windows must be signed in and awake. Marketplace challenges may need manual
attention. Reliable collection cannot guarantee new BUY calls: exact sold
evidence and actual local supply remain constraints.
