# Relevance and deals pass, September 24–25, 2026

Yish: *"a ton of listings that I don't even care about … random windows computers
and really old computers and phones … barely any new buys or new verify's."* He
asked for a multi-hour pass over all of Filtrsoft. Times are UTC. Production data
was read through his signed-in browser session (read-only `GET` requests); private
working files are in `C:\Dev\filtrsoft-recovery-data\claude-20260924\` (not in Git).

## Decisions Yish made during the pass

| Question | Answer |
|---|---|
| Categories he flips | GPUs and gaming PCs, laptops and MacBooks, PC parts (**not** phones or tablets) |
| Age cutoff for computers and parts | About 2020: Intel 10th gen, Ryzen 3000, RTX 20 / GTX 16, RX 5000, Apple M1 and newer |
| Office / basic Windows computers without a gaming GPU | Hide them |
| Phone cutoff (if phones return) | iPhone 13 / Galaxy S22 / Pixel 7 and newer |
| Minimum profit for BUY/VERIFY | **$75** (was $100) |
| Local resale versus eBay | "eBay takes around 13.5%" → local price = eBay sold price less eBay's cut (86.5%, was a guessed 85%) |
| Production disk nearly full | **Prune verdict history older than 14 days** |

## Baseline (production feed, 2026-09-24 ~22:00)

4,671 listings in the 28-day feed: **3 BUY, 11 VERIFY**, 80 FAIR, 521 PASS, 4,056
INSUFFICIENT_DATA (87%). By category: phones 1,045, laptops 947, prebuilt 906,
GPUs 342, RAM 315, tablets 298. Mercari 1,792, Facebook 1,350, OfferUp 1,009,
Craigslist 520. Top "can't tell" reasons: exact model 1,638, storage 612, no
sold comps 353, GPU and CPU not stated 323, build configuration not covered 278.

## Findings and fixes

| # | Finding | Evidence | Fix |
|---|---|---|---|
| R1 | Half the feed was outside Yish's market | Relevance rules over the 4,671 production titles: 876 phones, 522 office PCs, 297 tablets, 180 Intel Macs, 167 accessories (cases, screen protectors, stickers), 91 non-computer items, 83 pre-2020 GPUs, 69 wearables/VR, old CPUs/RAM/boards | `src/signals/relevance.ts`; OUT_OF_SCOPE in the verdict (engine **0.3.49**). Newest named part decides; unknown age is kept. 2,258 of 4,671 remain |
| R2 | Searches spent capacity on phones, tablets and monitors | 600 logged searches: 7,210 new eligible cards, 2,078 read; the phone/tablet/monitor queries were among the most capped | Removed those queries and Craigslist cell phones; added `rtx` and `mac mini`; out-of-scope titles skipped before a detail visit (office PCs and old whole computers still read, since a description can name an RTX card) |
| R3 | Detail reads, availability probes and comp collection followed stale collector verdicts | Local verdicts predate the scope | All three now apply the scope; comp collection also weights GPUs/CPUs/whole machines and boosts wanted models with no sales (RX 7900 XT, RX 6800, GTX 1660 had listings and zero comps) |
| R4 | Mercari/OfferUp intake capped at 6 cards per search | Same 600 searches | 8 cards per search, detail budget 25 (still reads more than it captures); Facebook unchanged at 6/20 |
| R5 | Gaming PCs and laptops priced as their GPU | "RTX 4080 Super / i9 14900KF Pc Gaming" $2,250 vs $1,000 card median → PASS; "ZOTAC RTX 5070 GPU and Ryzen 7 9800X3D CPU" $700 → PASS; Alienware m17/m15, TUF F17, Razer Blade as "gpu" | Laptop lines, CPU+GPU titles, "PC gaming/build/set up" and boutique builders are laptops/PCs |
| R6 | Most-traded GPUs unpriced because every sale had to name the same board maker | Gigabyte RTX 4060 Ti: 85 chip sales, 1 Gigabyte; PNY RTX 3070: 277 and 1 | Same maker used only when ≥5 sales; memory generation never mixes (conflict excludes); VRAM size stays strict; board tier unchanged |
| R7 | Deals rare mostly because of the thresholds | Priced in-scope listings: 36 at 55–85% of market were FAIR ("doesn't pay for the trip") | $75 minimum (20-minute crossover, $60/hr) via guarded migration; local resale 86.5% |
| R8 | **Production volume 98% full** | 88 MB free of 4.69 GB, DB 4.45 GB, server backup failing "Not enough verified free space"; verdict history 95% of the September 17 copy (846,543 rows, up to 170,000 rows/day on September 8–12) | Same-decision re-scores update the latest row in place; retention deletes history older than 14 days except current and referenced rows (approved); first pass runs before scoring while storage is pressured |

## Measured and deliberately not built

- **MacBook RAM floor** (value at the chip's minimum RAM when RAM is missing): 138 of
  157 RAM-missing Apple laptops name no chip at all; the 19 that do gave 7 PASS,
  11 still insufficient, 1 FAIR. The real unknown is which MacBook it is; photo
  reading is the lever.
- **Gaming PC GPU+CPU part-out floor** (VERIFY when ask + $100 ≤ 0.8 × GPU+CPU used
  value): 297 in-scope PCs with a priced GPU, 2 would qualify (one a scam pattern).
  Sellers price builds near market.
- Existing build gates, board tier and seller-bounded decisions were kept. Note:
  laptop RAM bounded decisions cannot trigger because the seller's own "8GB or
  16GB" sentence satisfies the RAM field (backlog).

## Effect on the collector population (engine 0.3.49 over the collector copy)

In scope 2,209 of 4,901. Calls before the deal fixes: BUY 1, VERIFY 4, FAIR 36;
after categories + GPU rule + economics: BUY 1, **VERIFY 6**, FAIR 38 — new VERIFYs:
MacBook Air M4 15" ($90 margin), MacBook Pro M4 Pro ($131), Gaming PC RTX 3070
($75). 8 systems no longer mis-PASSed as bare cards. Production (with Craigslist)
over 28 days: listings with ≥$75 margin 11 (was 8 at ≥$100).

## Photo readings status (shadow mode)

494 Luna reads, $0.62 total (September 23 $0.45, 24 $0.13); 75 Gemma
verifications; 256 waiting for the PC to be idle. Display-only, unchanged.

## Deployment and results (2026-09-25 UTC)

| Step | Receipt |
|---|---|
| PR #4 → `21b5c6e`, engine 0.3.49 | live 03:00; first prune pass 03:00–03:05 (scoring held); full re-score 03:05–03:21 |
| Collector `76077010` → `21b5c6e` | safe maintenance; 70 installed tests pass, typecheck, doctor, identities preserved; backup restore-verified (5,601 listings) |
| Review of the live 0.3.49 feed | keyboards, monitors, boxes, desks, SD cards, a VHF radio, a 2014 ThinkPad VERIFY, a NAS passed as a CPU, a Legion Go hidden by non-breaking spaces |
| PR #5 → `8339e32`, engine 0.3.50 | live 03:37; re-score complete 03:53; 30 production titles newly out of scope, each reviewed |
| Collector `21b5c6e` → `8339e32` | 72 installed tests pass, typecheck, doctor, preserved, backup verified |
| Storage through two full re-scores | database file **4,447 MB before and after**, WAL 13 MB, 89 MB free: new rows reuse pruned pages |

| Production feed | Before (02:57, 0.3.48) | After (03:54, 0.3.50) |
|---|---:|---:|
| Listings in the feed | 4,649 | **2,224** |
| BUY | 3 | **4** |
| VERIFY | 10 (6 were iPhone 17 Pro Max) | **7** (all in scope) |
| FAIR / PASS / RISK | 81 / 529 / 304 | 43 / 223 / 168 |
| INSUFFICIENT_DATA | 4,026 | 1,947 |

Current deals: RTX 4090 Suprim Liquid $1,500 (net $706), RTX 5090 FE $2,800 ($723),
RTX 3090 FE $900 ($289), MSI RTX 5070 Gaming Trio $600 ($91); VERIFY Mac Pro M2 Ultra,
Mac mini M2, Ryzen 5 9000-series, MacBook Air M2, MacBook Pro M4 Pro, MacBook Air M4 15",
Gaming PC RTX 3070.

**Alerts were off.** The account has no push subscription and all 9 saved searches
are paused ("needs review" after the criteria-version change), so no BUY or VERIFY
has reached the phone. Only Yish can re-enable it on the device: More →
Notifications → Deal notifications → Enable, then turn on "Include Verify first".

## Remaining decisions and notes for Yish

1. **Six of the eleven VERIFYs were iPhone 17 Pro Max listings.** Phones are now
   hidden as he chose; one switch in `relevance.ts` brings them back (with the
   iPhone 13 / S22 / Pixel 7 cutoff he gave).
2. **Server backups stay off until the volume has room for a copy.** Pruning frees
   pages inside the database (growth stops) but the file cannot shrink without free
   space to VACUUM. Enlarging the Railway volume restores backups; off-host owner
   backups still work.
3. **The OMEN sleeps overnight** (00:12–10:58 Eastern on September 23–24): no
   collection, comps or photo checks during that time.
4. Backlog: attribute-based RAM/SSD/PSU valuation (low margin), laptop family + GPU
   valuation, photo-reading holdout before facts are written, laptop RAM bounded
   decisions; a single unreadable Facebook item (1394: no price or message control)
   fails the whole recovery stage; six "Pending ·" Facebook titles; office laptops
   named only by "Ryzen 5" (Surface, Extensa) are still kept.
