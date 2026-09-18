# Evidence recovery follow-up, September 17–18, 2026

## Scope and evidence

This follow-up preserves the **same original 250 listings**, including the known Arcadia Flirt furniture chair. It does not replace difficult rows or treat source reads and generic comp volume as successful valuation recovery. All baseline snapshots, source receipts, model inputs/outputs, database backups and full per-listing blocker/action records remain private under `C:\Dev\filtrsoft-recovery-data\followup`.

Original cohort SHA-256: `4938bbb2f72a47f163e3f1430336adf2ca9299c3f6dbbe0205609d20f1202228`. The original was 250 insufficient, with 82 descriptions. The preceding release's final snapshot had 2 PASS, 1 RISK, 1 retired and 246 insufficient, 59 complete reads and 151 descriptions. The **new pre-follow-up production backup** had 3 PASS, 1 FAIR, 1 RISK, 2 retired and 243 insufficient. Changes between the preceding report and this fresh baseline came from ordinary intervening collection; they are not credited to this follow-up.

## Paid reads and production storage

Yish approved both pause switches. Railway now has `FILTRSOFT_VISION_ENABLED=0` and `FILTRSOFT_VISION=off`; authenticated production health confirms **scheduled loop off and interactive paid-read gate off**. Collector `visionLimit=0` is a separate setting and stayed unchanged. Recorded spend increased from $1.0021 at the initial inspection to **$1.9024 of the existing $2 UTC-day budget**, last paid read `2026-09-18T01:40:35.623Z`. No paid diagnostic call, budget increase or fallback was used. Existing cached Claude facts are retained.

A consistent **production**, not merely ingestion, backup was streamed to the OMEN. The owner-only endpoint uses one SQLite read transaction, backpressure, a 64 MB physical-headroom guard, a 180-second bound and an authenticated owner session. It writes no second database copy on Railway. The collector token cannot export private account data. The original same-volume backup guard is unchanged.

Snapshot started `2026-09-18T00:54:17.448Z`; compressed download 2,261,039,664 bytes, SHA `3fb5f6f62bdc732458f9d2a4edd2ac9228a34bd8ab9a4b6551638cbd7c109939`. Restore completed with integrity OK and zero foreign-key violations: **9,500 listings, 33,155 comps, 620 SKUs, 846,543 verdicts, 69 judgments and one outcome**. Private restored file is `production-before.db`. Neither this file nor account/session contents are committed. Railway physical free space was about 88.8 MB at the latest release checkpoint. This backup does not solve the underlying small remaining disk margin; no data cleanup or storage purchase was performed.

## Implemented recovery

- Durable deterministic identity jobs have fingerprint invalidation, ownership leases, bounded retries, quoted model evidence and explicit resolved, conflict, missing-model, missing-text, unavailable or deferred states. Resolver version changes re-evaluate old terminal work once, preserving unchanged retry backoff thereafter.
- Verified model identities create exact catalog entries/aliases and synchronize through independently validated production acknowledgements. Broad aliases cannot collapse Legion 15ACH6 into 15ACH6H, Yoga 7 into Yoga 2, or a LOQ laptop into its GPU. Specifications remain listing evidence, not inferred from a chassis name.
- Newly recovered cohort identities get bounded sold-query priority; saved comp transfers are captured and retried independently of new browser searches. Applied/duplicate receipts count as acknowledgements; rejected/deferred items do not. Obsolete catalog messages retain history and stop retrying only after an acknowledged current replacement.
- Cohort source visits honor complete-read fingerprints, availability, source backoff and the 28-day horizon. Idle chunks and ordinary discovery remain bounded. Actual seller descriptions and expansion completeness are retained.
- Availability recording takes SQLite write ownership before reading, eliminating the reproduced competing-writer read-to-write race from automatic cycle 52.

### Audited errors corrected before counting outcomes

1. The B860 seller said **“No bent, broken or missing pin”**, and that DDR5-only hardware **“does not work with DDR4”**. Neither establishes damage. Both condition paths now preserve that meaning. Actual failures with an included power adapter still count.
2. ASUS `TUF-GTX1650S-O4G-GAMING` conflicts with an unsuffixed GTX1650 title. It remains insufficient; unrelated board makers and GDDR generations cannot create an apparent price.
3. The i5-12400F listing includes **16GB DDR4 RAM and the processor**. A CPU-only median cannot price the bundle. The temporary PASS is reversed to insufficient; it is not a recovered valuation.
4. The RTX A2000 explicitly states **6GB**. An intermediate median pooled nine 6GB sales with six 12GB sales. Capacity extraction and sold filtering now retain 6GB.
5. The i5-10400F seller explicitly excludes DDR5/DDR4 RAM and other components. Excluded sale parts are not installed specifications or an impossible-platform claim.

Each new repaired gap has a failing-before regression. The end-to-end identity fixture goes from unresolved identity through a real parser/collector result, exact query, accepted sales, synchronization acknowledgements and a supported PASS. It is a fixture, not a claim that the live Legion found sales. Final functional suite: **432 tests, 1,397 assertions; typecheck, build and CI container checks passed**.

## Exact sold-evidence outcomes

The real Legion 5 quote resolves **15ACH6 / Ryzen 7 5800H / RTX 3050 Ti / 16GB / 1TB / 15.6-inch**. Its exact query fetched **122 results and accepted zero**: examples differed in 15ACH6H/S7 model, CPU, RAM, storage or screen evidence. It stays insufficient with query backoff. No generic Legion median replaces its configuration.

The Acer Nitro text gives i7-13620H, RTX4060, 16GB and 512GB, but still lacks its actual manufacturer code. Those components do not uniquely establish an ANV/AN chassis. It stays missing-model instead of receiving an invented SKU. Official examples demonstrate why configuration is not sufficient: [Acer ANV15-51](https://store.acer.com/es-es/acer-nitro-v-15-portatil-gaming-anv15-51-negro-nh-qnceb-00n), [Acer ANV15-52](https://br-store.acer.com/notebook-acer-anv155276np-core-i7-13620h-32gb-512gb-ssd-rtx-4060-15-6-fdh-preto-nh-u1ual-003/p).

Measured query batches included i5-12400F **112 saved**, i5-10400F **87 saved**, RTX A2000 **90 saved**, all **289 acknowledged**; then WX3200 **48 saved** and Yoga 7 14AHP9 **29 saved**, all **77 acknowledged**. Query acceptance is not the final valuation filter: exact capacity, condition, board and configuration requirements still apply. Generic Ryzen/iPhone/GPU volumes are reported in private receipts but are not counted as cohort recovery.

## Automatic collection

| Automatic job | Duration | Newly stored | Detail attempts / successful reads | Availability observations | Acknowledged listing snapshots | Result |
|---|---:|---:|---:|---:|---:|---|
| 51 | 21.35 min | 29 | 120 / 118 | 138 | 177 | All sources succeeded |
| 52 | 20.83 min | 33 | 120 / 105 | 134 | 172 | Partial Facebook SQLite race, corrected afterwards |
| 53 | 21.14 min | 37 | 120 / 111 | 138 | 186 | All sources succeeded; terminal report acknowledged |

Acknowledgements include previously queued catch-up snapshots, so they are not interchangeable with new discoveries. Failed/empty detail attempts are not complete reads. Job 53 ran `02:31:32.293–02:52:40.397 UTC`; Facebook/OfferUp/Mercari acknowledged 63/60/63 listing snapshots. Its source detail outcomes included five failures, three confirmed unavailable and one empty result; successful source stages do not mean every individual page succeeded. All 133 job reports reached production. The Facebook availability pass completed without the prior SQLite race. No clearing-time extrapolation is made. Scheduling retains a **30-minute rest after a completed crawl**, with bounded idle maintenance; total wall-clock spacing includes crawl duration.

## Local vision decision

**All three models fail acceptance. Production photo fact ingestion remains off.** The detailed methodology, original-error audit, per-field precision/recall, unsupported facts, abstentions, failures, latency, GPU memory and frozen manifests are in [the local vision report](LOCAL-VISION-FOLLOWUP-2026-09-17.md).

Fixed development: 25 cases. Fresh holdout selected and annotated after the prompt freeze: eight real listings, four categories, all 15 photos at selection. OCR-first and full-image-plus-center-region experiments did not fix the disputed hallucinations. Original image mapping is sound; original HTTP stop metadata was not saved and cannot be reconstructed. New traces retain raw outputs and stop reasons. Field placement corrections are distinguished from genuine extraction gains; GPU-deferred cases remain failures with misses.

Strict-prompt development precision/recall: Qwen3-VL4B **43.6% / 43.6%**, Qwen3.5-9B **43.8% / 53.8%**, Qwen3-VL8B **32.9% / 64.1%**. Fresh holdout: **38.5% / 50.0%**, **46.2% / 60.0%**, **19.0% / 40.0%**, respectively. All emit unsupported facts. The 8B model peaked around **10,154 MiB total GPU memory** and did not run out of memory. Larger did not mean more accurate here. Positive printed ECC remains unvalidated; no narrower scope or reduced threshold was approved. No production adapter was enabled. Models are unloaded after evaluation; all files remain for reproducibility.

## Same 250: cumulative and incremental results

Production receipt `cohort-final-retry.json`, **02:57:51.418 UTC**, preserves all original IDs. All 250 latest verdicts report engine **0.3.47**. Scoring has **zero pending, zero failures**, signature `9024|2026-09-18T02`.

| Outcome | Original frozen cohort | New follow-up baseline | Final | Additional this follow-up |
|---|---:|---:|---:|---:|
| Priced PASS | 0 | 3 | 6 | +3 |
| Priced FAIR | 0 | 1 | 4 | +3 |
| Supported RISK | 0 | 1 | 5 | +4 |
| Confirmed unavailable | 0 | 2 | 15 | +13 |
| Still insufficient | 250 | 243 | 220 | −23 |
| BUY / VERIFY | 0 | 0 | 0 | 0 |

**229 complete current reads, 15 unavailable and six deferred** account for every row. Complete coverage rose from 59 to 229 (**+170**); nonempty seller descriptions rose from 151 to 237 (**+86**), versus 82 in the original frozen sample. Source coverage: Facebook 70 complete / 5 unavailable / 5 deferred; OfferUp 57 / 4 / 1; Mercari 56 / 2 / 0; Craigslist 46 / 4 / 0. The known furniture chair is still included among the 220 insufficient rows and is explicitly marked out of scope in the private dossier; it is not a potential deal.

Of the **six newly priced listings**, only **two** were recovered by new sold evidence: RTX A2000 6GB and i5-10400F. The other four became priceable through complete seller facts against pre-existing matching sales. Generic comp collection and added sales on an already-RISK GTX1070 are not counted as recovered valuations.

| New priced result | Ask | Median / matching sales | Actual benefit |
|---|---:|---|---|
| RTX A2000 **6GB**, FAIR | $250 | $319.95 / 9 new matching 6GB sales | About $21.96 estimated net, below the existing trip/profit requirement; 12GB sales excluded |
| i5-10400F CPU, FAIR | $59.99 | $79 / 77 new eligible exact CPU sales | About $7.16 estimated net, too small to justify the trip |
| M3 MacBook Pro 14-inch, 8GB/512GB, PASS | $900 | $834.99 / 3 existing matches | Fresh seller configuration establishes a negative margin |
| M5 MacBook Air 15-inch, 24GB/1TB, PASS | $1,700 | $1,558.55 / 4 existing matches | Price exceeds matched resale evidence |
| M2 MacBook Air 13-inch, 8GB/256GB, FAIR | $549 | $559 / 5 existing matches | Only $10 estimated margin |
| M4 MacBook Air 13-inch, 16GB/256GB, PASS | $849 | $845.33 / 22 existing matches | No positive margin; seller does not specify GPU core count, so no claim that the evidence resolves that unstated dimension |

The four new supported risks are the MDM-bypassed/screen-glitch M1 MacBook, non-working iPhone12, cracked-screen/battery-problem iPad Pro, and $38 MacBook off-platform redirect. These risk flags are not appraisals of damaged or locked hardware. The corrected B860, CPU/RAM bundle and conflicting GTX1650/1650S remain insufficient, not recovered decisions. No new BUY/VERIFY qualified, no bounded-unknown real example appeared, and the natural alert path had no qualifying cohort recommendation to send. No fabricated notification or seller message was produced.

### Remaining blockers and actions

The private `cohort-dossier-final-retry.json` retains **all overlapping blockers**, source retries, availability, receipts, identity jobs and explicit next actions for every row. Counts overlap and must not be summed: 179 low-confidence catalog matches, 157 exact-identity blockers, 45 exact-configuration sold-evidence blockers, 33 recent-comp blockers, 17 whole-build/component-evidence blockers, seven identity conflicts, and one CPU/RAM bundle evidence gap. After complete source reads, still unstated/photo-dependent fields include CPU in 43, storage in 31, RAM in 24 and GPU in 17 rows. Failed local vision is not permission to fill them in.

Identity job states: **59 resolved, 171 missing-model, seven conflicting, one missing-text, ten unavailable and two not enqueued**. Eight resolved jobs carry explicit manufacturer/model quotes; the remainder resolve existing catalog entries. Resolved catalog identity does not imply complete configuration or usable sold evidence. All terminal/retry states remain durable; missing facts are not silently retried as if more generic searches could establish them.

Six source deferrals at the receipt: four Facebook reads returned no accepted same-item complete detail (Dell1650, ThinkPadT14s, iPhoneSE and iPhone13Pro); exact access/extraction causes were not retained, so authentication/challenge is **unconfirmed**. S25Ultra has an older read without a current complete receipt and a scheduled 03:23 UTC retry. The OfferUp 12GB GPU lacks confirmed description boundaries/expansion, with next retry September19 01:25 UTC. The Dell1650 and ThinkPadT14s were retried normally at 02:54:57 UTC and failed again; production acknowledged their next retries at 04:54:57 UTC. The iPhone retries remain at 03:34 UTC. No backoff is cleared or login automated.

## Installed state and remaining operational limitations

- Functional source **`3367d185b3268a182132b0f5466ccd9877ff182c`**, engine **0.3.47**; CI **`35300060743`** passed, including offline verification container and production image build. Railway functional deployment **`44a207d3-64f5-4840-b400-7cd8e043dd15`** was active and successful.
- Installed desktop merge **`e73d18795a256878fb96160cb5cea1f358e1e538`**. Installed 19 targeted tests / 34 assertions, typecheck and doctor passed. The doctor verifies configured tools/paths/profile presence; it does not claim to automate or independently prove sign-in. Actual successful collection provides session evidence.
- Final update followed completed job53, with restore-verified ingestion backup SHA **`aa4a191182c6b1671ada553fb9f6af7e9a1789248b018cf628076dffd1b8179c`**, 2,212 listings / 33,844 comps / 610 SKUs / zero FK violations. Existing local ancestry, saved documentation commit, node identity, sync identity, database, browser profiles and startup remain preserved. Runtime tree is clean.
- Production heartbeat at **02:54:26 UTC** confirmed the installed desktop online, primary unchanged, five-minute fallback grace. Laptop was connected and **persistently paused**. Configuration, private environment and launcher hashes are unchanged; scheduled task and logon shortcut remain installed.
- Listing outbox **empty**; comp transfers **1,900 applied + 44 duplicate, none unacknowledged**; comp capture cursor **33,844 equals the actual maximum**, so an empty queue does not hide uncaptured rows. All 2,948 accumulated job reports are acknowledged. These totals include earlier sessions; they are not this follow-up's new-comp count.
- Catalog history: **72 applied, nine duplicate, four safely superseded, four deferred**. Thus the overall catalog queue is **not empty**. The four are non-cohort local snapshots whose facts differ from production: DellOptiPlex3030, a MacBook M4Max listing, IdeaPadSlim1 and AlienwareR12. They await actual source-fact synchronization and their retained retry times; older blank local descriptions are not sent over fresher server facts merely to clear a metric.
- The identity maintenance status still records the earlier deployment-time transport timeout and its 03:27 UTC retry. The subsequent bounded validation independently succeeded and acknowledged 77 sales; the failed history is retained rather than rewritten. Cohort maintenance recovered successfully after restart and continues normally.
- Public health responsiveness: **HTTP200 at 478, 588 and 348 ms** at 02:43 UTC. Authenticated health at 02:53 UTC verified no scoring backlog/failures and both paid gates off. These are measured samples, not a latency guarantee.
- Models are unloaded (`api/ps` returned no models). The 8B holdout's two bounded retries were again GPU-deferred; they remain failures. No photo ingestion, paid fallback or reduced accuracy gate was enabled.

Remaining limits are genuine missing identity/spec/sold evidence, six source deferrals, four catalog synchronization deferrals, unvalidated local vision, and low Railway physical headroom. The verified collector stays running; no reinstall, reset, destructive cleanup or spending was performed.

