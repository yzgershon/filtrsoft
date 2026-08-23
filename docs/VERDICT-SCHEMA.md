# Verdict Schema v1

The output contract. Fixed before anything produces it, so the engine, the eval harness, the web app and the mobile app all agree on what a verdict *is*.

**Design rules, in priority order:**
1. **Never a point estimate.** Always a range with stated confidence.
2. **"Insufficient data" is a verdict**, not an error.
3. **Every number cites its evidence.** A user must be able to verify any claim in five seconds.
4. **Hard blockers are structurally separate from pricing.** They override it, so they cannot live inside it.

---

## The object

```jsonc
{
  "schema_version": 1,
  "listing": {
    "source": "craigslist",           // craigslist | facebook | offerup | ebay | mercari
    "source_id": "7955149593",
    "url": "https://...",
    "title": "Gaming PC SPECS IN PICTURES",
    "asking_price_cents": 75000,
    "location": "Dedham, MA",
    "posted_at": "2026-08-22T10:38:00Z",
    "updated_at": "2026-08-22T10:38:00Z",
    "days_on_market": 1,
    "photo_count": 3,
    "captured_at": "2026-08-23T04:18:00Z"
  },

  "identification": {
    "category": "prebuilt_pc",        // phone | laptop | gpu | prebuilt_pc | console | tablet | component
    "sku_id": null,                   // null when unresolved
    "resolved": false,
    "confidence": "low",              // high | medium | low
    "attributes": {                   // per-category; null means UNKNOWN, never guessed
      "gpu_model": null,
      "cpu_model": null,
      "ram_gb": null,
      "storage_gb": null,
      "psu": null
    },
    "observed": [                     // what was actually seen, with provenance
      { "fact": "Gigabyte motherboard",    "source": "photo:b.jpg", "confidence": "high" },
      { "fact": "Gigabyte GeForce RTX GPU","source": "photo:b.jpg", "confidence": "high" },
      { "fact": "NZXT Kraken AIO w/ LCD",  "source": "photo:b.jpg", "confidence": "high" },
      { "fact": "T-Force RAM x2",          "source": "photo:b.jpg", "confidence": "medium" }
    ],
    "missing_critical": ["gpu_model", "cpu_model"]   // drives INSUFFICIENT_DATA
  },

  "valuation": {
    "status": "insufficient_data",    // ok | sparse_comps | insufficient_data
    "low_cents": null,
    "high_cents": null,
    "confidence": "low",
    "method": "sum_of_parts",         // direct_comps | sum_of_parts
    "comp_count": 0,
    "comp_window_days": 90,
    "comps": [],                      // every comp used, with a link. See below.
    "components": [],                 // sum_of_parts only. See below.
    "whole_unit_discount_pct": null,  // 10-25 typical
    "part_out_value_cents": null,     // the spread vs whole-unit IS the flip
    "region_adjusted": false,
    "sell_through_rate": null,        // 0-1, share of comps that sold vs listed
    "median_days_to_sell": null
  },

  "risk": {
    "hard_blockers": [
      {
        "code": "NO_DISPLAY_OUTPUT",
        "severity": "blocker",
        "status": "confirmed",        // confirmed | suspected | unresolved | cleared
        "evidence": "I/O bracket is solid vented grille, zero display connectors",
        "source": "photo:a.jpg",
        "value_effect": "unusable_for_stated_purpose"
      }
    ],
    "flags": [
      {
        "code": "IMPOSSIBLE_SPEC_CLAIM",
        "severity": "high",           // high | medium | low
        "evidence": "Listing claims PCIe Gen 4 NVMe; i7-6700K / LGA1151 cannot do Gen 4",
        "source": "description",
        "value_effect_cents": null
      }
    ],
    "listing_signals": {              // the cheap layer. No vision required.
      "quality_score": 0.2,           // 0-1: photos, length, spec completeness, disclosed defects
      "days_on_market": 1,
      "price_vs_market_pct": null,    // null when valuation is insufficient
      "screenshot_artifacts": false,
      "photo_age_mismatch": false,
      "seller_cluster_size": 1,
      "missing_value_fields": ["gpu_model", "cpu_model"],
      "internal_contradictions": [],
      "spec_sheet_language": false
    }
  },

  "verdict": {
    "call": "INSUFFICIENT_DATA",      // BUY | FAIR | PASS | VERIFY | RISK | INSUFFICIENT_DATA
    "confidence": "high",             // confidence in the CALL, not the price
    "headline": "Can't be valued from this listing.",
    "reasoning": "Photos show brand names, not specs. GPU model is unknown and swings value from roughly $600 to $1,800.",
    "deciding_unknown": "gpu_model"   // required for VERIFY and INSUFFICIENT_DATA
  },

  "economics": {                      // flipper mode only
    "est_profit_low_cents": null,
    "est_profit_high_cents": null,
    "fees_modeled": ["ebay_final_value", "shipping"],
    "drive_time_minutes": null,
    "effective_hourly_low_cents": null,   // nobody else computes this
    "effective_hourly_high_cents": null
  },

  "questions": [                      // copy-pasteable, model-specific
    "What's the exact GPU model and how much VRAM?",
    "What CPU is under the AIO?",
    "How much RAM and what speed?",
    "What brand and wattage is the PSU?",
    "Can you send a screenshot of Task Manager on the Performance tab?"
  ],

  "modes": {                          // same engine, two audiences
    "flip": { "call": "INSUFFICIENT_DATA", "headline": "..." },
    "buy":  { "call": "INSUFFICIENT_DATA", "headline": "..." }
  },

  "meta": {
    "engine_version": "0.1.0",
    "model_calls": [
      { "stage": "triage", "model": "haiku", "cost_cents": 0.1 },
      { "stage": "vision", "model": "haiku", "cost_cents": 0.8 }
    ],
    "total_cost_cents": 0.9,
    "generated_at": "2026-08-23T04:18:00Z"
  }
}
```

---

## Sub-shapes

**A comp** — every one links out. This is how trust gets earned.

```jsonc
{
  "source": "ebay",
  "source_item_id": "...",
  "url": "https://...",
  "title": "MSI RTX 3050 Gaming X 8GB",
  "sold_price_cents": 15500,
  "shipping_cents": 1200,
  "condition": "used",
  "sold_at": "2026-08-14",
  "captured_at": "2026-08-23T04:18:00Z",
  "match_confidence": "high"
}
```

**A component** — sum-of-parts only.

```jsonc
{
  "role": "gpu",                  // gpu | cpu | ram | storage | psu | motherboard | case | peripheral
  "identified_as": "MSI RTX 3050 Gaming X 8GB",
  "source": "photo:c.jpg",        // photo | description | title | inferred
  "confidence": "high",
  "value_low_cents": 13000,
  "value_high_cents": 17000,
  "comp_count": 11
}
```

---

## Rules the schema enforces

1. **`attributes` uses `null` for unknown. Never a guessed default.** A guessed midpoint that reads as a fact is the exact failure this product exists to avoid.
2. **`missing_critical` non-empty forces `valuation.status = "insufficient_data"`.**
3. **Any `hard_blockers` entry with status `confirmed` or `unresolved` forbids a `BUY` call**, whatever the price gap says.
4. **`VERIFY` and `INSUFFICIENT_DATA` both require `deciding_unknown`.** If you can't name what would resolve it, you don't understand the listing well enough to return a verdict.
5. **`verdict.confidence` is confidence in the CALL, not the price.** "This is definitely unvaluable" is a high-confidence INSUFFICIENT_DATA. Those are different axes and collapsing them loses information.
6. **`comps` is never empty when `valuation.status = "ok"`.** No comps, no price.
7. **`meta.model_calls` is always populated.** Cost per listing is the number that decides whether the business works, so it gets measured from the first run, not retrofitted.

---

## Why `modes` exists

Same engine, two audiences, different questions:

- **Flip mode** asks "what's my margin, and will it actually sell?" Needs sell-through, fees, drive time.
- **Buy mode** asks "is this a fair price, and should I act now or wait?" Needs price trend, not margin.

Both read from identical `identification`, `valuation` and `risk` blocks. Only the framing and the surfaced fields differ. Nobody in the market does buy mode.

---

## Changelog
- **2026-08-23** — v1 drafted alongside `RISK-MODEL.md`.
