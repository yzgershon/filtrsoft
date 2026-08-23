# Assyze Risk Model v1

**This is the moat.** Comps are a commodity you can buy. This document is the thing competitors have no reason to build, because none of them have actually driven across town to look at a used GPU.

**Status: DRAFT, needs Yish's audit.** Sections marked 🔶 are my domain knowledge and need your correction. Sections marked ✅ were validated by evidence in the Phase 0 run (`testset/RESULTS-2026-08-23.md`). Sections marked ❓ are gaps only you can fill.

Written as prose before code, deliberately. Rules get encoded once they're right, not before.

---

## 1. The core distinction

Every risk falls into one of two buckets, and they behave completely differently:

**HARD BLOCKERS** destroy value in a binary way. Not "worth 15% less" — worth **parts value or nothing**. An iCloud-locked iPhone is a $40 parts unit regardless of its cosmetic condition or what a price comp says. These are the reason Assyze exists.

**FLAGS** adjust value continuously. Battery at 78%, a cracked back, a mined GPU. Each has a rough dollar cost you subtract.

**The governing rule: an unresolved hard blocker overrides any price gap.** A phone at 40% of market with unknown lock status is never a BUY. It is a VERIFY. Discount size is irrelevant when the downside is total.

---

## 2. Verdict taxonomy

| Verdict | Meaning |
|---|---|
| **BUY** | Clear margin, risks identified and acceptable |
| **FAIR** | At market. No edge either way. |
| **PASS** | Overpriced relative to comps |
| **VERIFY** | Could be excellent, but one specific unknown decides it. Always name the unknown. |
| **RISK** | Hidden defect or fraud signal. Do not proceed without resolution. |
| **INSUFFICIENT DATA** | Cannot be valued from what's posted. **A first-class verdict, not an error.** |

Roughly 1 in 10 listings in the Phase 0 run genuinely could not be valued. Every competitor returns a confident number on those. Returning "I don't know" *is* the product.

---

## 3. Listing-level signals ✅

**Phase 0's biggest finding: the strongest fraud signals were not in the item photos at all.** These are near-free to compute, need no vision model, and nobody else does them.

### 3a. Screenshot artifacts in the image chrome ✅
Look at the *edges* of the image, not the item. iOS/Android status bars, photo counters ("2/2"), close buttons, share/reply/save toolbars, another app's UI.

**The save icon is the strongest single tell.** You do not save your own photos. A save icon means the seller received that image from someone else.

*Caught the Brockton iPhone 15 Pro Max.*

### 3b. Photo age versus listing age ✅
Visible clocks, lock screens, calendars, wall calendars, seasonal context. A photo materially older than the listing means the item may not exist, may already be sold, or is being relisted from someone else's post.

*The Brockton lock screen read "Tuesday, August 26" — that fell on a Tuesday in 2025, roughly nine months before the listing went up.*

### 3c. Time on market, weighted by listing quality ✅
**This is the refinement Phase 0 produced and it is not obvious.**

Underpriced and long-unsold usually means a hidden problem. But the Brockton scam and the Dell Latitude 5520 had both sat about three months — one was fraud, the other was the best deal on the board.

**The discriminator is listing quality.** Score it on photo count, description length, spec completeness, and whether the seller *voluntarily disclosed defects*.

- Long-unsold + **low** information → hidden problem. Weight heavily toward RISK.
- Long-unsold + **high** information + disclosed cosmetic flaws → consumers flinching at ugliness. **That's a flipper's opportunity.**

### 3d. Missing value-determining fields ✅
Omitting the single field that most determines value is itself a signal, distinct from omitting detail generally.

- Phone with no **storage tier** (a $200+ swing on a Pro Max)
- PC with no **GPU model** (a 3x swing)
- Mac with no **year**
- Laptop with no **CPU generation**

### 3e. Seller and location clustering ✅ — **CORRECTED 2026-08-23**

Multiple near-identical listings from one seller or one town. *Five "Unlocked iPhone" listings from Brockton, all round numbers, all under market.*

**v1 of this rule was wrong as written.** It treated clustering as a red flag full stop. The second Craigslist run turned up a cluster of Dell off-lease business laptops — the $199 Latitude 5520 and the $295 Latitude 7420 — that are almost certainly the same seller, and both are **among the best deals found.**

**Cluster must be weighted by listing quality, exactly like listing age (3c).**

- Cluster + **low** information + under market → bulk fraud pattern
- Cluster + **high** information + fair pricing → a professional refurbisher, which is frequently the **best source of deals on the board**

Same underlying principle both times: *the signal is never the pattern alone, it's the pattern crossed with how much the seller is willing to tell you.*

### 3f. Internal contradictions ✅
The listing arguing with itself. Two live examples from Phase 0:

- *"Like NEW"* in the same paragraph as "cracked bottom panel, LCD detached, tape applied" (2019 iMac)
- *"NVMe Gen 4 SSD"* on an i7-6700K / LGA1151 platform that **cannot do PCIe Gen 4** (Bedford gaming PC)

The second type is the more valuable one: **a spec claim that is physically impossible on the stated hardware.** Build a table of platform capabilities and check claims against it.

### 3g. Copy-pasted spec-sheet language ✅
Description reads like a manufacturer product page rather than a person describing their thing. Indicates the seller does not understand the item, which means their condition claims are worthless.

*The Tesla P100 seller called a display-less datacenter accelerator "designed for professionals in animation and video editing."*

### 3h. Round-number pricing 🔶
$500 / $400 / $300 correlates with bulk and flip sellers. $195 / $295 / $199 correlates with private sellers who looked up comps. Weak signal alone, useful in combination.

### 3i. Price far below market ✅
**The single strongest scam correlate.** Below roughly 60% of comp value on a liquid item should trigger scrutiny, not excitement.

**This is the structural insight: a deal-finder is inherently a scam-finder, because they surface the same listings.** Every competitor surfaces these and labels them HOT.

### 3j. Communication friction 🔶
"Text only," refusal to meet in public, pressure to decide fast, refusal to answer specific questions. **Weight lightly** — cash-only and text-only are completely normal on Craigslist and mean nothing on their own.

### 3k. Irreversible payment rails offered ✅ — **hard flag**
**PayPal Friends & Family, CashApp, Zelle, Venmo, gift cards, wire.** All strip buyer protection and all are the scammer's preferred rails.

A seller meeting locally for cash has no reason to offer any of them. The strength of this signal is that it's **an offer the seller volunteers** — it isn't inferred, it's stated.

*The Back Bay iPhone 16 Pro Max listing has meticulous, verifiable documentation and still offers PayPal F&F. The correct response is not "this is a scam," it's "cash in person, and if they push F&F, walk."*

### 3l. Geographic contradiction ✅
Stated location inconsistent with the board it's posted to, or self-contradictory within the listing.

*The Z Fold 5 listing reads "Austin, texas" on a Boston board while the description insists "cash only, locals only." Both cannot be true.*

### 3m. Zero photos on a high-value item ✅
No photos at all on anything meaningfully priced. Not "few photos" — **none**. On a $750 phone this is close to dispositive on its own.

### 3n. Boot-screen-only photography ✅ — **category-general**
A device photographed **only at its boot or logo screen**: Samsung Galaxy "Secured by Knox," the Apple logo, a BIOS splash, Windows loading.

**Boot logo proves power. It proves nothing else.**

It cannot rule out FRP lock, activation lock, carrier lock, reset lock, a failing panel, or dead pixels. Sellers do this innocently all the time — but it's also exactly what you'd photograph if the device *couldn't* get past that screen.

*Both Z Flip 6 photos are the Samsung boot logo, on a charger, in a case. Powers on; everything else unverified.*

**The real test per category:** phones → home screen. Laptops → desktop with an About/System screen open. GPUs → running with GPU-Z open. Consoles → dashboard, signed in.

---

## 4. Phones

### Hard blockers
| Blocker | Effect | How to detect |
|---|---|---|
| **iCloud Activation Lock** | Parts value only (~10%) | Cannot be bypassed. Must see it booted to the home screen. |
| **Google FRP lock** (Android) | Near-total | Same test |
| **IMEI blacklisted** (stolen or unpaid balance) | Won't activate on any US carrier | Free IMEI checkers; ask before meeting |
| **Unpaid carrier financing** | **Time bomb** — blacklists *after* you buy | Ask directly: "is it paid off in full?" |
| **Carrier locked** | 15–25% discount | Often disclosed vaguely |

🔶 **The Cambridge iPhone 15 in Phase 0 is the live example:** description said *"Original carrier T Mobile"* while the title said nothing about unlocked. At $250 against a $400–500 market, the entire verdict hinges on that one unresolved fact.

### Flags
- **Battery health under 80%** — replacement runs $50–90
- **"Unknown Part" warnings** (iOS flags non-genuine screen/battery/camera) — kills resale
- **Face ID not working** — not third-party repairable on most models
- **Cracked back glass** — on iPhone 12 and newer this is glued and expensive
- **Aftermarket screen** — kills True Tone, sometimes Face ID
- **Water damage indicator** — red dot in the SIM tray
- **OLED burn-in**

### The one rule that matters
> **Never buy an iPhone you have not personally seen booted past the lock screen to the home screen.** That single test rules out activation lock, and activation lock is the difference between a phone and a paperweight.

### Ask the seller
1. What's the exact storage size?
2. Is it fully paid off, no carrier balance?
3. Screenshot of Settings → General → About (shows IMEI, model, capacity)
4. Screenshot of Settings → Battery → Battery Health
5. Is it carrier locked or unlocked, and which carrier was it on?
6. Has the screen or battery ever been replaced?

---

## 5. Laptops — Apple

### Hard blockers
- **Activation Lock / Find My Mac** on T2 and Apple Silicon — unbypassable brick
- **EFI / firmware password** on pre-T2 Intel Macs — Apple can sometimes clear it with proof of purchase, otherwise near-brick
- **MDM / DEP enrollment** 🔶 — **the one people miss.** Corporate machines silently re-enroll on wipe. Very common on off-lease units that otherwise look clean.

### Flags
- **Swollen battery** — trackpad won't click, case bulges. Safety issue, expensive.
- **Butterfly keyboard** (2016–2019) — known failure, Apple's repair program has ended
- **Flexgate** (2016–2017 13" MBP) — display backlight cable failure
- **Last supported macOS** ✅ — the 2014 MBP in Phase 0 is stuck on Catalina, no security updates. Caps resale hard.
- Cycle count and "Service Recommended" battery status
- Liquid damage / logic board corrosion

### Ask the seller
1. Boot it to the desktop and show me Apple menu → About This Mac
2. System Report → Power, what's the cycle count?
3. Will you sign out of iCloud and turn off Find My in front of me?
4. Any Profiles or Device Management under System Settings → Privacy & Security?
5. Has the battery, screen, or keyboard ever been replaced?

---

## 6. Laptops — Windows

### Hard blockers
- **BIOS / supervisor password** (common on Dell, Lenovo, HP business units) — often needs manufacturer service
- **Computrace / Absolute persistence** enabled — corporate tracking baked into firmware

### Flags
- **Cracked hinges** 🔶 — extremely common, often invisible in listing photos, and structurally expensive
- Battery wear (`powercfg /batteryreport`)
- Soldered RAM and storage (caps upgrade value)
- Gaming laptops: thermal condition, sustained-load history
- Off-lease asset tags and engraving (cosmetic, but suppresses resale)

✅ The Dell Latitude 5520 at $199 is the model case for the *good* version of this: an off-lease machine with honest, disclosed cosmetic damage and full specs. Consumers flinch. That's the margin.

### Ask the seller
1. Photo of the BIOS screen (proves no supervisor password)
2. Boot to the Windows desktop
3. Open and close the lid, any hinge play or cracking?
4. Battery report screenshot

---

## 7. GPUs

### Hard blockers
- **Not a display GPU at all** ✅ — Tesla, datacenter, and CMP mining cards have **zero video outputs**. *Detected visually in Phase 0 on the Tesla P100: the I/O bracket is a solid vented grille.*
- **Passive cooling** ✅ — server cards have no fan and will overheat in a desktop case
- **Mac EFI ROM cards** — won't POST in a PC
- Artifacting or dead card

### The one rule that matters
> **A GPU listing without a clear photo of the I/O bracket is incomplete.** The bracket is where you see whether display outputs exist at all. Always request it.

### Flags
- **Mining history** 🔶 — the RX 580, 5700 XT, 3060 Ti, 3080 and 3090 eras were heavily mined. Tells: no original box, seller has several, replaced thermal pads, heavy dust, "came out of a rig"
- **GDDR6X VRAM degradation** on 3080/3090 — those modules run extremely hot
- **12VHPWR connector** on 4000/5000 series — seating and melting risk
- Repasted or repadded (could be maintenance, could be a repair)
- PCB sag damage, bent brackets, corrosion
- Aftermarket cooler swap
- Rebadged fakes 🔶 (usually overseas sellers, low-end cards flashed to report as something else)

### Ask the seller
1. Photo of the I/O bracket and the full card from both sides
2. Was this ever used for mining or any 24/7 workload?
3. Photo of it running with GPU-Z open
4. Do you have the original box?
5. How long have you owned it and why are you selling?

---

## 8. Prebuilt PCs and bundles

### The governing rule
> **Never value a bundle as a bundle.** Decompose into components, value each against its own comps, sum, then discount **10–25%** for whole-unit sale dynamics. Compare that against part-out value. Parting out realizes roughly 60–80% of component value; selling whole realizes 50–70%. **The spread is the flip.**

### Flags
- **Generational mismatch / bottleneck** ✅ — *i7-6700K (2015) paired with an RTX 3050 in Phase 0*
- **Dead-end platform** — old socket, no CPU upgrade path
- **Physically impossible spec claims** ✅ — *"Gen 4 NVMe" on LGA1151*
- **OEM prebuilt** (Dell, HP) with proprietary PSU and motherboard — effectively non-upgradeable
- **No PSU brand or wattage stated** 🔶 — a cheap PSU is both a real cost and a real risk to everything attached to it
- "Gaming PC" with no discrete GPU
- ✅ **Specs visible in photos are usually brand names, not specs.** The Dedham listing said "SPECS IN PICTURES" and the photos showed Gigabyte, NZXT, and T-Force logos and nothing that determined value.

### Ask the seller
1. **Screenshot of Task Manager → Performance** (shows CPU, GPU and RAM in one image — the single highest-value ask)
2. Exact GPU model and VRAM, not just the family
3. PSU brand and wattage
4. Will you boot it and run something while I'm there?

---

## 9. Consoles

### Hard blockers
- **Console ban** (Xbox / PlayStation) — permanently barred from online

### Flags
- **Revision matters enormously** — PS5 disc vs digital vs slim; Switch V1 vs V2 vs OLED vs Lite. 🔶 Note the inversion: **Switch V1 (2017) is worth *more* to some buyers** because it's the modchip-able revision.
- Joy-Con and DualSense stick drift
- Disc drive failure
- ✅ **"Brand new, factory sealed" at or above retail is a red flag, not a feature.** *The $1,850 Xbox Series X 2TB — retail was $600–730, six months unsold.*

---

## 10. Confidence rules

Never output a point estimate. Always a range with a stated confidence.

| Confidence | Requires |
|---|---|
| **High** | SKU resolved, ≥8 comps in 90 days, no unresolved hard blockers |
| **Medium** | SKU resolved, 3–7 comps, or minor unresolved flags |
| **Low** | SKU ambiguous, <3 comps, or a value-determining attribute unknown |

**Overrides, in priority order:**
1. Unresolved hard blocker → **VERIFY** or **RISK**, never BUY, regardless of price gap
2. Value-determining attribute unknown → **INSUFFICIENT DATA**, never a guessed midpoint
3. Price below ~60% of comps → scrutiny escalates, does not become excitement

---

## 10b. Foldables — their own category ✅

Z Flip and Z Fold devices have failure modes no other phone has, and generic phone comps miss all of them.

- **Inner screen failure line** at the crease — the signature Galaxy foldable failure
- **Hinge wear and grit ingress** — the mechanism is the weak point
- **Crease visibility** is normal and is not a defect; a seller claiming "perfect screens" on a foldable is either careless with language or hiding something
- Inner screen protector is **factory-applied and not user-removable** — peeling is a known issue and looks like damage
- Steep depreciation: the category scares buyers, so genuine bargains are more common here than elsewhere

**Ask:** unfold it, show the inner screen on with a white or light image, work the hinge fully, check for a line at the crease.

---

## 10c. The cost of a false positive ⚠️

**This model is currently tuned to avoid false negatives — calling a scam a good deal. That is the right priority, and it is not the only one.**

A false positive costs real money too. If Assyze flags every underpriced item as suspicious, it stops being a deal-finder and becomes an anxiety machine, and a flipper who misses three genuine bargains because the app cried wolf will delete it.

**The structural difficulty: underpriced is simultaneously the strongest deal signal and the strongest scam signal.** They are the same observation. Separating them is the actual product.

The discriminator is the same one that shows up in 3c and 3e: **what is the seller willing to tell you, and does it check out?**

*Live example — the Back Bay iPhone 16 Pro Max at ~40% under market. On text alone I called it a scam. The photos contained real iOS screenshots with an AppleCare agreement number, a battery-health screen showing 50 cycles, and manufacture and first-use dates that are internally consistent with a launch-day purchase. It may well be a genuine motivated seller. The right output was **VERIFY with a named test**, not RISK.*

**Rule: a large price gap escalates scrutiny. It does not by itself produce a RISK verdict.** RISK requires a gap **plus** an unresolved hard blocker, a contradiction, or a fraud artifact.

❓ **Yish: calibrate this.** What's the real number in your head where a discount stops being exciting and starts being suspicious? That threshold is a rule and I'd rather have yours than mine.

---

## 11. Gaps only Yish can fill ❓

These are the parts I can't write. This is where your actual experience goes, and it's the difference between a generic tool and a moat.

1. **What did you personally get burned by, or nearly get burned by?** Specific stories, not categories.
2. **What do you check first when you walk up to a used PC?** The order you do it in matters and it's not written down anywhere.
3. **What's the question that makes a fake seller disappear?** You presumably have one.
4. **What does a mined GPU actually look like in person** versus in a photo?
5. **What price gap makes you skeptical rather than excited?** You have a real number in your head. Write it down.
6. **What have you passed on that you wish you'd bought, and why did you pass?** Overcaution is a failure mode too and the engine will inherit yours.
7. **Local Boston specifics** — towns, patterns, seller types you'd already learned to avoid or seek out.

---

## Changelog
- **2026-08-23** — v1 drafted from Phase 0 findings.
- **2026-08-23 (2nd run)** — Added 3k–3n (irreversible payment rails, geographic contradiction, zero photos, boot-screen-only). **Corrected 3e** — clustering is not inherently negative. Added 10b (foldables) and 10c (cost of a false positive). Awaiting Yish's audit.
