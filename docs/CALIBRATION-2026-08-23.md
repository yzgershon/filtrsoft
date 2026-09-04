# Calibration — Yish's Phase 0 Audit

**Source:** `testset/audit-results-2026-08-23.json` — 69 listings, audited 2026-08-23.

| | count |
|---|---|
| Agree | 35 |
| Partial | 4 |
| Disagree | 30 |
| **Direction of corrections** | **16 harsher, 10 softer, 6 out-of-scope** |

**51% agreement is the headline number and it is not the useful one.** The disagreements are *systematic*, which means they're rules I don't have yet rather than noise. Every pattern below is a change to the model.

---

## Finding 1 — The BUY threshold is fundamentally wrong ⚠️ **biggest one**

**I have been valuing at market. Yish buys at flip margin.** Those are completely different thresholds and I built the whole verdict taxonomy on the wrong one.

The clearest evidence, from his note on the $650 i7-6700K / RTX 3050 build:

> *"A good deal on this would be like **$250**."*

I priced fair whole-unit value at **$380–450** and called it PASS for being over that. He wants it at **$250** — roughly **55–65% of my "fair" number** — before it's worth his time.

That single ratio explains most of the 16 harsher corrections:

| Listing | Ask | Me | Yish |
|---|---|---|---|
| Dell Optiplex 7060 | $60 | BUY | **PASS** |
| Dell XPS 9300 | $250 | BUY | **PASS** |
| ThinkPad X1 Carbon | $250 | BUY | **PASS** |
| Dell Latitude E7470 | $95 | FAIR | **PASS** |
| ThinkPad X1 + dock | $500 | FAIR | **PASS** |
| Galaxy Z Flip 4 | $218 | FAIR | **PASS** |
| ROG Swift 27" | $300 | FAIR | **PASS** |
| Switch OLED lot | $300 | FAIR | **PASS** |
| Dell 7786 2-in-1 | $400 | FAIR | **PASS** |
| Dell 32" 4K | $300 | BUY | **FAIR** |
| iPad Magic Keyboard | $100 | BUY | **FAIR** |

**The fix:** `FAIR` must mean "at market, no edge, don't drive for it." `BUY` must require a **margin band after fees, time and risk**, not merely a price below comps.

### RESOLVED 2026-08-23 — and the answer reframes the whole verdict layer

**There is no fixed discount. Yish: *"it depends completely on the listing."* He's right, and his own audit proves percentage can't be the driver:**

- Dell Optiplex 7060 — $60 against a $100–180 market. A **40–65% discount**, and he **PASSED**.
- 2021 iMac M1 — $500 against $600–800. Only **17–37% off**, and he **BOUGHT**.

Percentage is an *output*, not an input. The real drivers, derived from his 69 calls:

**1. Absolute profit, not percent.** 60% off a $60 machine is $36 of margin, which doesn't pay for the drive. Every BUY cleared ~$100+ of spread, most cleared $250+:

| BUY | Spread |
|---|---|
| NZXT RTX 5070 build | $275–600 |
| iPhone 16 Pro Max (negotiated to $750) | $300–550 |
| Dell Latitude 7420 | $105–255 |
| 2021 iMac M1 | $100–300 |

vs. PASSes: Optiplex $40–120, XPS 9300 $50–200, E7470 ≈ $0.

**2. Liquidity vetoes margin.** Switch OLED lot and ROG Swift both had workable spreads. Both passed.

**3. Desirability, separate from age.** Bought current-gen gaming hardware, passed on every old business laptop even at good percentages. A $250 X1 Carbon has paper margin; it just sits.

**4. Condition vetoes price.** The Latitude 5520 was his best percentage on the board. Port damage killed it.

### The stated rule, and what it actually is

> *"if its under $100 profit im not leaving and if its under $150 profit im not driving more than 30min away from newton **but thats just me. others would drive 20min for $60 profit**"*

Those two points are internally consistent at a single implied rate:

- $100 ÷ ~0.75 hr (15 min each way + 15 min meet) = **$133/hr**
- $150 ÷ ~1.25 hr (30 min each way + 15 min meet) = **$120/hr**

**It's one parameter — an effective hourly floor of roughly $120–135 — expressed at two points.** That's far better than a step function: one number interpolates to every distance and every price tier.

### Architectural consequence ⚠️

**"But that's just me" means the BUY threshold is a USER SETTING, not a constant.** The same listing is legitimately a BUY for one user and a PASS for another. Required per-user profile:

```
user_economics
  home_location            -- Newton, MA
  min_absolute_profit      -- hard floor, don't leave the house ($100)
  effective_hourly_floor   -- the real parameter (~$120-135)
  max_drive_minutes        -- optional hard cap
  transaction_minutes      -- default 15
  relist_minutes           -- photograph, list, pack, ship (NOT yet modeled)
```

This makes `economics.effective_hourly_low/high_cents` in `VERDICT-SCHEMA.md` the **core** field, not a nice-to-have, and it means `verdict.call` must be computed **relative to the user**, not globally.

**Nobody in this market does this.** Every competitor emits a universal "HOT FLIP" label that ignores who's reading it and where they live.

### RESOLVED — the $100 is NET, and resale channel is part of the model

> *"for me the relisting work is just cleaning the item... **$100 profit after its sold**"*

**The floor is $100 net after sale, not gross spread.** Every "spread" figure in the table above is market-minus-ask — i.e. gross. Real margins are lower once fees and shipping land, so **several of my FAIR calls should probably be PASS.**

Relisting labor itself is small for him (clean it, photograph it), so `relist_minutes` stays minor. The thing that actually eats margin is **channel**.

### Channel routing — his stated rules

| Item | Channel |
|---|---|
| Bigger than a laptop | **Facebook Marketplace only** |
| Expensive laptop | Facebook **+ eBay** |
| Small (phones) | Facebook **+ eBay** |
| Default preference | **Facebook — "no shipping and fees"** |

**This retroactively explains two calls I couldn't account for.** The ROG Swift 27" and the Dell 32" 4K both had workable spreads and he passed. They're bulky → local-only → no access to a national buyer pool → slower and capped. Size is a **shippability threshold**, and it gates which market you can even reach.

(Not size alone though — he bought the 24" M1 iMac, which is bulky but has strong local demand. The real variable is **size × local demand**.)

### The fee asymmetry the engine must model

- **eBay:** higher gross (national pool, buyer protection) − **~13% final value fee** − shipping − packaging
- **Facebook Marketplace:** lower gross (local pool only) − **zero fees** − zero shipping

These can net out similarly or not at all depending on the item, and **the answer flips by weight**. Net-after-channel has to be computed per platform, then the best one selected. A single "resale value" number is wrong.

### ⚠️ The data problem this exposes

**There is no sold-comps source for Facebook Marketplace.** Facebook does not publish sold prices, has no API, and is login-walled. The archive can only ever be eBay-based.

So Facebook realized prices must be either (a) **derived** — eBay sold × a local-market discount factor — or (b) **learned from actual outcomes**.

**Option (b) is the moat.** The only way to know what things really clear for on Facebook Marketplace locally is to record what *users' own sales* actually got. That dataset does not exist anywhere and cannot be bought.

---

## Finding 9 — The relisting feature IS the outcome loop 🆕 **(Yish, 2026-08-23)**

> *"the app could have a button that automatically drafts the listing in an instant you just need to take photos... its always good practice to take at least 5 photos of the item and maybe even a video and all the person has to do is click publish listing."*

Good feature on its own — it extends Filtrsoft from "should I buy this" to the full flip cycle, and selling is the natural reason to *come back*, which is retention.

**But the strategic value is bigger than convenience.** Look at the data problem directly above: the one thing Filtrsoft cannot buy is what items actually sell for on Facebook Marketplace locally.

**If the app drafts and tracks the listing, the app knows what it sold for.** The relisting feature is not a convenience bolt-on — it is the **collection mechanism for the only proprietary dataset in the entire product.** Yish's feature idea and the data moat are the same thing.

It also closes the loop end to end: buy verdict → purchase → relist → realized price → feed back into valuation. That's a system that gets measurably better with use, which none of the nine competitors can claim.

**Implementation reality:**
- **eBay has a Sell API** → genuine one-click publish is possible
- **Facebook has no API** → "draft prepared, you paste and publish." Still saves most of the work; be honest that the last click is manual.

**Capture standard (his):** minimum 5 photos, ideally a short video. Worth enforcing in the UI, since it doubles as the input for the next buyer's Filtrsoft analysis.

Slots into **Phase 5** in `PLAN.md`, alongside the outcome loop it enables.

---

## Finding 2 — My component market data is stale ⚠️

On the overpriced-component cluster I called the Crucial 64GB DDR5 at $800 "~4× retail." Yish:

> *"its not 4x retail though **there is a crazy ram shortage** and you can expect to pay for ddr5 32 gb ram like **$400+**"*

If that holds, $800 for 64GB is roughly **market**, not 4×. He also raised both GPUs I'd called overpriced:

- ASUS ROG Strix RTX 3060 12GB — PASS → **FAIR**
- PNY RTX 5080 16GB — PASS → **FAIR**

**This is the single strongest argument for the comps archive.** My component pricing is baked-in static knowledge and the market moved underneath it. Live sold comps would have caught all three. Until the archive exists, **every component valuation I produce should be treated as unreliable.**

---

## Finding 3 — Sell-through is a hard filter, not a soft one ✅

Yish rejects entire categories on liquidity, independent of price:

> **VR** — *"I would stay away from VR... VR gets boring after 2 weeks and people know that, there also very hard to resell."* (PSVR2 at $120: my BUY → his **RISK**)

> **Pre-2019 Macs** — *"the only apple laptops that are worth reselling are the m processor ones so oldest id go is like 2019."*

> **Datacenter GPUs** — *"practically no market for this gpu... it would be hard to resell."* (Tesla P100: my RISK → his **PASS** — same conclusion, different reason. I said "not a GPU," he said "no buyers.")

**The rule: a good price on something that won't sell is not a deal.** The schema already has `sell_through_rate`; the engine wasn't weighting it. It needs a **category liquidity tier** that can veto a BUY regardless of margin.

❓ **Yish:** full list of dead categories, please. VR, pre-2019 Macs and datacenter GPUs are three. What else do you refuse on principle?

---

## Finding 4 — Camera and photo gear is out of scope ✅

Yish marked **all 8** camera listings UNKNOWN: Tamron 15-30, Tamron 70-200, Canon 16-35L, Sigma 16-300, Sony A1, Zeiss ZE 15mm, Nikon D5000, Epson V700.

That's not disagreement, it's **declining to judge outside his expertise** — and it means camera gear cannot be validated by the person building this.

**RESOLVED 2026-08-23 — cameras are CUT.** Yish confirmed: *"i dont know anything about cameras thats why."*

The precise split matters: camera gear **comps well** on eBay (specific models, high volume), so valuation isn't the blocker. The **risk layer** is — fungus, element separation, focus motor wear, mount play, what "mint-minus" actually means. Risk is the differentiator, so without domain knowledge there's no product, just a generic price lookup competing with everyone.

And the governing reason: **a category he can't audit is one where the engine can be wrong indefinitely and neither of us would find out.** That violates reliability-first.

Scope: laptops, phones, GPUs, prebuilts, consoles, tablets, components. Revisit only with a domain informant.

---

## Finding 5 — `UNKNOWN` is overloaded and must split ✅

The audit exposed that UNKNOWN currently means two unrelated things:

1. **INSUFFICIENT_DATA** — the listing doesn't contain enough to value it *(schema meaning)*
2. **OUT_OF_SCOPE** — the category isn't one we judge *(what Yish meant, 6–8 times)*

These need different handling: #1 generates questions for the seller, #2 shouldn't be surfaced to the user at all. **Add `OUT_OF_SCOPE` to the verdict taxonomy.**

---

## Finding 6 — Listing liveness is its own signal 🆕

> *"a common theme on craigslist is that theres a high chance that this isnt even available anymore since it was listed 3 months ago and **facebook marketplace are better at making sure listings are still live**."*

And on the $1,850 Xbox: *"if I had to guess I would say that this listing is no longer available."*

**New rule: time-on-market means different things per platform.** Craigslist does not aggressively prune, so an old listing is often simply dead. Facebook does, so an old Facebook listing is genuinely unsold — a much stronger signal.

**Platform-specific decay must be a parameter, not a constant.** This also partially rehabilitates several of my RISK calls: some of those listings aren't scams, they're corpses.

---

## Finding 7 — I read descriptions; Yish reads images. His catches were better. ⚠️

**Dell Latitude 5520** (my BUY → his FAIR):
> *"looking into the images the **bottom is super messed up and the side ports look in pretty bad shape**. refurbished on amazon goes for $425"*

The seller disclosed "heavy scratches on bottom cover." I logged that as **cosmetic**. Yish looked at the photos and saw **port damage**, which is *functional*. Different category of defect entirely, and it moves the verdict.

**New rule: port, hinge and connector condition is functional, never cosmetic**, regardless of how the seller frames it. Inspect these specifically in photos.

**iPhone 15 128GB** — a contradiction I completely missed:
> *"he also mentions a **lighting cable** in the description which is weird because **the phone is usb c**"*

**The iPhone 15 is USB-C.** A seller including a Lightning cable either doesn't have the phone, doesn't know what they have, or is describing a different device. That's a textbook section 3f impossible-spec contradiction and I walked straight past it.

**Build the accessory-compatibility check into 3f**: Lightning vs USB-C by model year, PCIe generation by socket, DDR4 vs DDR5 by platform, charger wattage by model.

---

## Finding 8 — Negotiation is part of the verdict 🆕

On the iPhone 16 Pro Max (my VERIFY → his **BUY**):

> *"Very good condition and it has apple care + and also **they agree to $750 cash** which is a great deal."*

**He contacted the seller and moved the price from $800 to $750.** My verdict treated the asking price as fixed. It isn't.

This also resolves Finding 10c (false positives): I was worried I'd flagged a real deal as a scam. **I had.** He bought the reasoning, ignored the payment-rail worry by simply insisting on cash, and closed lower.

**Implication:** the engine should output a **target offer price**, and `VERIFY` should mean "go ask," not "be afraid." Naming the question is the product; treating the question as a threat is not.

---

## What I got right

35 clean agreements, and the high-signal ones held:

- **NZXT RTX 5070 build, BUY** — *"honestly an amazing price one of the best ive seen in a while"*
- **Dell Latitude 7420, BUY** — *"a prime example of a trustworthy seller you can tell by the description"* (confirms section 3.5 directly)
- **Brockton iPhone 15 Pro Max** — fraud reasoning accepted, softened only to VERIFY on liveness grounds
- **2019 iMac, Xbox 2TB, Z Fold 5, iMac A1311** — all confirmed
- **Bedford 6700K build** — right call, wrong threshold

---

## Actions

- [x] **Redefine BUY around margin, not market** — RESOLVED 2026-08-23. No fixed discount; it is a per-user effective-hourly floor (~$120-135/hr for Yish). BUY is computed relative to the user, not globally.
- [x] `relist_minutes` — RESOLVED, minor for Yish (just cleaning). **The real cost is channel:** $100 floor is NET after sale. Model eBay (~13% fee + shipping) vs Facebook (no fees, local-only) per item.
- [ ] Size/shippability threshold — "bigger than a laptop" = local-only, gates the reachable buyer pool
- [ ] Listing auto-draft (Phase 5) — the collection mechanism for Facebook realized prices, the only unbuyable dataset
- [ ] Add `OUT_OF_SCOPE` to the verdict taxonomy
- [ ] Add category liquidity tiers with veto power over BUY
- [x] Cut camera and photo gear from scope — DONE 2026-08-23
- [ ] Platform-specific time-on-market decay
- [ ] Accessory/interface compatibility checks in 3f (Lightning vs USB-C, PCIe gen, DDR gen)
- [ ] Ports, hinges and connectors classified as functional damage
- [ ] Emit a target offer price on every verdict
- [ ] **Treat all component pricing as unreliable until the comps archive is live**
