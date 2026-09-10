# Filtrsoft: competitor findings and the next useful features

Research date: September 9, 2026. Public first-party documentation and product descriptions were inspected. This is feature research, not an independent test of competitors' accuracy, alert latency or fraud protection. Recommendations below are proposals until Yish chooses them.

## What to borrow

| Product | Observed pattern | Useful Filtrsoft adaptation |
|---|---|---|
| [eBay Product Research](https://www.ebay.com/help/selling/selling-tools/product-research?id=4853) | Sold-price filters, accepted Best Offer prices, shipping and market activity | Make the evidence distribution, date range and matching exclusions inspectable. Never equate a visible completed price with the accepted offer without evidence. |
| [Facebook Marketplace](https://about.fb.com/news/2025/11/facebook-marketplace-gets-a-glow-up/) | Collections, collaborative shopping and suggested seller questions | Save a comparison with private notes and a short list of unresolved questions. Keep questions tied to the listing evidence. |
| [Craigslist alerts](https://www.craigslist.org/about/help/account/features/alerts) | Saved searches include new, edited, renewed and reposted matches | Show an ad's price and repost history. Label what actually changed; repetition alone does not establish fraud or a new physical item. |
| [OfferUp alerts](https://help.offerup.com/hc/en-us/articles/360031995332-Get-notified-about-items-you-want) | Separate search alerts and similar-item discovery | Offer exact-hardware and broader-alternative modes. Preview example matches and excluded variants before saving. |
| [Swappa verification](https://swappa.com/about/verification) | Verification photos, device criteria and review | Add Pickup mode: recorded claims, test steps and evidence of completion. Seller assertions never become verified device condition by default. |
| [Jawa PC Finder](https://www.jawa.gg/pc-finder), [trust](https://www.jawa.gg/trust) | Game/resolution/target-performance shopping and seller trust signals | Compare by gaming workload when supported data exists. Keep measured results, modeled results and seller claims distinct. |
| [PCPartPicker founder account](https://www.reddit.com/r/buildapc/comments/kd0f23/im_the_ownerfounder_of_pcpartpicker_celebrating/) | Structured part lists and compatibility | A My PC upgrade planner using exact motherboard/BIOS, power, dimensions and RAM support. The current site could not be inspected; this older source is not current UI verification. |
| [MarketplaceMonitor](https://marketplacemonitor.com/faq/) | Search exclusions, location/seller rules and configurable alerts | Give every exclusion a readable reason and Undo. Match hardware context instead of blindly blocking words such as “locked” inside “unlocked.” |
| [Flippah](https://play.google.com/store/apps/details?id=com.flippah) | New-item, price-drop and ending-auction alerts | Separate alert types and let Yish control urgency. Avoid notifying again for the same unchanged listing. |
| [BigFlippa](https://bigflippa.com/docs/overview/) | Natural-language shopping intent becomes search criteria and scored matches | Turn “4070 under $350 near Newton” into editable model, price and radius fields, then show sample matches. The rules should be visible. |

## Recommended order

1. **Exact-hardware alerts.** Extend the existing saved searches with variant/quantity exclusions and a preview. High daily usefulness, medium effort. Success means fewer irrelevant notifications while retaining real matching deals.
2. **Price and listing timeline.** Show first observed, price changes, text/spec changes and suspected repost links with their evidence. High usefulness, medium effort. A disappearing ad is “unavailable,” not automatically “sold.”
3. **Pickup mode.** A compact checklist for the exact device: required tests, questions, serial/lock/battery checks where applicable, and notes. High usefulness, medium effort. Do not claim a passed check without recorded evidence.
4. **Deal board and actual outcomes.** Build on existing saved/purchase records with considering/contacted/tested/bought/sold stages. Track purchase, repair, travel, fees and actual proceeds separately. High usefulness, medium effort; also supplies honest engine calibration.
5. **Market-evidence quality.** Show coverage, freshness, price distribution and precise matching rules. Add liquidity only when observations support a defined measure; no invented sell-through or days-to-sale. High usefulness, medium-to-large effort.
6. **My PC / upgrade planner.** Compare local upgrades against owned hardware and compatibility constraints. High usefulness, large effort because exact board/BIOS, dimensions, power and memory standards matter.
7. **Saved comparisons and collections.** Name, reopen and share a shortlist with private notes. Useful, small-to-medium effort. The current comparison URL already reopens selected IDs, but this is not an account-synced collection system.

I would choose exact-hardware alerts, listing history, then Pickup mode. They directly reduce missed opportunities and wasted drives.

## Comparison data decisions

Yish chose gaming performance and value, with **free data only**.

**UserBenchmark:** useful as an external reference. Its [GPU methodology](https://www.userbenchmark.com/Faq/What-is-the-effective-GPU-speed-index/82) describes a calibrated Effective Speed index using synthetic workloads. Its [CPU methodology](https://www.userbenchmark.com/Faq/What-is-the-effective-CPU-speed-index/55) explains relative weighting but does not disclose current numerical weights. Neither index is measured FPS for a specified game on the seller's PC. The [developer entry](https://www.userbenchmark.com/page/developer) returned a CAPTCHA; no supported free API/widget or score-redistribution grant was verified in its [public terms](https://www.userbenchmark.com/page/privacy). This is an access/permission uncertainty, not a claim that reuse is prohibited. The implementation links to verified model pages and does not scrape scores or bypass the challenge.

**Blender Open Data:** [public-domain benchmark data](https://www.blender.org/news/introducing-blender-benchmark/) supports a real native rendering comparison. The pinned snapshot is Blender 4.5.0 on Windows, with backend, median, submission count and retrieval date visible. [Score definitions](https://opendata.blender.org/about/) describe rendering throughput. Ten submissions is a minimum coverage rule, not a statistical confidence estimate; submissions are not necessarily independent machines. Laptop and collapsed memory families remain context, never exact-variant winners. The reference is not a test of the listed physical item.

**Gaming review suites:** [Tom's Hardware GPU tests](https://www.tomshardware.com/reviews/gpu-hierarchy,4388.html) and [CPU tests](https://www.tomshardware.com/reviews/cpu-hierarchy,4312.html) are useful original measured references. Different games, CPUs, resolution, ray tracing and upscaling settings must remain separate. Their publisher's [commercial terms](https://futureplc.com/terms-and-conditions-us/) do not establish a free bulk-republication path; no hierarchy was imported. UL's [retail solutions](https://benchmarks.ul.com/services/retail-solutions) provide a potential licensed FPS route, but are outside the free-only decision. No purchase, sales contact or API credentials were used.

**Unresolved requirement:** a broad native gaming-performance and gaming-value score has not been delivered. No sufficiently documented, free reusable dataset was established during this research. The feature instead exposes exact recorded specifications, real asking prices, existing sold-value estimates, linked gaming references, and a separately labeled native rendering comparison. Do not present that limitation as completed gaming scoring.

## Seller actions

Message seller opens the exact recorded platform listing. [Craigslist Reply](https://www.craigslist.org/about/help/replying_to_posts) supplies the seller's available contact choices; [Craigslist chat](https://www.craigslist.org/about/help/posting/features/contact-info/chat) depends on the poster enabling it. Facebook opens the actual Marketplace ad. No documented listing-specific composer link was verified, so no Messenger identity is guessed. Yish sends messages himself; the app does not send anything automatically.

## What to avoid

- A universal score blending CPU cores, VRAM, storage and clock speed, or guessed game FPS from those numbers.
- Applying the entire PC or multi-item asking price as the price of one component.
- Calling a profile, seller statement or old photo read verified condition.
- Treating every repost as fraud, every disappearance as a sale, or generic keyword matches as exact hardware.
- Copying a competitor's noisy feeds, pay-to-promote clutter, checkout or social network before the core deal workflow is reliable.

Generic AI deal scoring and suggested seller questions already exist elsewhere. Filtrsoft should compete on inspectable evidence, accurate configuration matching and risk checks that matter before a drive.
