# Search precision and the desktop harness

Yish asked for fewer irrelevant results on Mercari, OfferUp, Facebook and Craigslist, and an explanation of what his gaming desktop can run locally. No additional monthly spend is authorized. Physical desktop setup remains deferred.

## What the harness does

The collector is the worker; the harness manages its work. The existing supervisor starts and restarts it, machine/profile leases prevent overlapping browser runs, the server assigns work to an available primary host, the runner saves progress, and durable upload retries survive temporary network failures. Source failures remain visible rather than being reported as empty successful searches. The desktop will run browser collection and free comp refreshes. Railway continues serving the app while the desktop is off. A stopped/sleeping desktop does not collect until it resumes or another configured host takes over.

The RTX 4070 Ti can later run a local photo model. That requires a separately approved model installation and evaluation against labeled real listing photos, including exact module layouts, variants and seller/photo conflicts. Neither throughput nor accuracy on this physical PC has been measured. Local inference adds no API subscription, but still uses electricity, disk space and GPU resources. Ordinary browser crawls depend mainly on network and browser responsiveness, not GPU compute.

## Changes

- Mercari searches use live-verified Electronics category 7 and Computer Components & Parts category 775, retaining newest-first, for-sale filtering.
- OfferUp uses Computers & Accessories 1.6 or Cellphones & Accessories 1.2, retaining Greater Boston coordinates, 30-mile radius and recent-first sorting. Other explicit electronics queries use category 1.
- Facebook's scheduled GPU slot alternates `nvidia geforce` and `amd radeon`. No undocumented Facebook category ID was guessed.
- Each collector cycle still has two core query slots and now one extra rotating search for DDR5/DDR4 RAM, Ryzen/Intel processors, NVMe, motherboards, PSUs, cases, monitors, iPads, Galaxy and Pixel phones. The additional slot adds bounded work; the original five core searches retain their rotation. A persisted monotonic cursor prevents the larger rotation from repeatedly resetting at five.
- Craigslist retains its computer, part, phone and electronics categories. Video gaming gets a Boolean hardware/VR query that was verified against the live endpoint. The title gate rejects obvious furniture, accessories and consoles before queueing detail work. Existing listing tracking remains broad, so absence from a narrower discovery query cannot delist an item.
- Short titles such as GTX960 are no longer replaced with a city name. Unknown titles such as `3080` and `Samsung 990 Pro` can proceed from a verified hardware category for further evidence. A real broken RX 5700 XT labeled `For Parts No Display` is retained without removing those words from the stored listing. No query/category supplies fabricated specifications or prices.
- Each browser search logs parsed, known, eligible, rejected and selected counts. `src/scripts/audit-searches.ts` provides a bounded search-only audit, uses the same leases, opens no database and never visits seller details, runs vision or uploads data.
- The earlier local backup change in 7e055ce ships with this release: checksums use bounded 1 MiB reads. This does not complete the separately documented production storage recovery or establish durable production backup coverage.

## Measured verification

September 15 live samples used the existing off-screen Node browser workers. OfferUp/Mercari before-and-after checks used the same parser and three-scroll budget. The final discovery policy was then applied to the captured titles. These are small current samples, not universal search precision, total-market coverage, valuation accuracy or newly found good deals.

| Search sample | Parsed cards | Retained for analysis | Of retained, title still unknown |
| --- | ---: | ---: | ---: |
| Mercari, former unfiltered GPU search | 91 | 9 | 0 |
| Mercari, filtered GPU search | 92 | 90 | 2 |
| OfferUp, former unfiltered GPU search | 69 | 54 | 0 |
| OfferUp, filtered GPU search | 75 | 74 | 12 |
| Facebook, GeForce search | 38 | 33 | 0 |
| Craigslist, whole video-gaming category | 190 | 13 | 0 |
| Craigslist, hardware/VR query within it | 21 | 8 | 0 |
| Craigslist, computer parts | 319 | 186 | 61 |

The Craigslist reduction also removes some title-gate false positives: PC software and peripherals previously looked like devices. The narrower query was amended to retain a real `monitor and pc` title and Quest headsets. A separate manual UI check found 15 GPU listings and one mini PC in Mercari's first 16 filtered cards. All audited searches completed without a browser challenge. No database ingestion occurred during these audits. Aggregate receipt: `docs/qa/searches/2026-09-15-samples.json`.

Pricing, comp matching and engine version 0.3.36 are unchanged. No existing listings were retired by this work. Windows and Linux tests each passed 366/0 with 1,198 assertions, with Linux network disabled. TypeScript and the production frontend build passed. Deployment and installed collector revision will be recorded in HANDOFF after completion.
