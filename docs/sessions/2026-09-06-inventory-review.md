# Placeholder inventory and ten-listing review

The brief was older than the last two commits. `ee9c3d8` had already bumped
the engine to 0.3.32 and measured 1,007 -> 988 local live can't-tells; `918567a`
had retired 83 shop ads. The session preserved the other agent's comp-picker
work (`9ea4392`) by moving its changes into a separate worktree.

## What the $1 ads actually contain

There were **42 live asks at $1 or less**, not the historical 50. Only seven
were outside OUT_OF_SCOPE. Four contain explicit quantity/price menus:

| Listing | Read from the stored description | Outcome |
|---|---|---|
| 590, 1984 | 14 watercooling offers in each duplicate ad; per-item asks from $0.50 | Show each price with its unit basis; no matching resale comps |
| 648 | 1x32GB DDR4-2400 $100; 2x32GB DDR4-2400 $200; 8x32GB DDR4-2666 $800 | Seller explicitly says ECC RDIMM and not regular desktop-compatible; no desktop kit valuation |
| 651 | 12 DDR3 offers, including 7x2GB at $17.50 and 30x8GB with a $15/$10 per-stick tier | Preserve fixed bundle asks; keep the tier unresolved |
| 840 | RAM/CPU shop inventory linked to an external spreadsheet, with no item prices in the listing | Remains unresolved; external inventory is not parsed by this change |
| 1762 | CyberPower PC, make an offer, incomplete specs | Remains unresolved; no real asking price was supplied |
| 3292 | TV offered for trade for a PC | Remains unresolved; the existing classifier reads the desired trade as the item |

The four parsed ads still return INSUFFICIENT_DATA, with actionable itemization
instead of merging every specification into one fictional machine. Their
headline $1 is shown as a placeholder. The parser does not overwrite raw listing
facts, invent SKUs, select the cheapest tier, or run paid vision.

## Photo check

Photos were inspected directly in a hidden browser tab, without retaining image
bytes or logging into any marketplace.

- #648's [single-module photo](https://images.craigslist.org/00000_cxh6muhWPBt_0CI0t2_1200x900.jpg)
  visibly says **Samsung**, while its description calls that first offer SK
  Hynix. Preserve the discrepancy; do not silently treat the description as a
  verified manufacturer. The [tray photo](https://images.craigslist.org/00c0c_8HRJxdUZTkw_0CI0t2_1200x900.jpg)
  shows eight SK Hynix modules with PC4 labels.
- #651's [Axiom close-up](https://images.craigslist.org/01313_5IdTi99FAej_0CI0t2_1200x900.jpg)
  says **8GB DDR3-1600 NON-ECC**. The final offer's written part number repeats
  the Hynix string from #648's DDR4 offer; that number should not be used for a
  confident SKU attachment. The [overview](https://images.craigslist.org/00707_cxNmm737eVV_0t20CI_1200x900.jpg)
  supports that this is actual module inventory.

These observations are an audit record, not a new persisted vision result. The
UI labels the extracted data as seller claims. It does not claim automatic
photo verification of individual inventory rows.

## Measurement and delivery

Production health before delivery: **0.3.32 / 25,171 comps**, despite more than
30,000 locally. Exporting the data is necessary; a code bump alone cannot import
unshipped comps. Prepared archive: **31,210 comps, 559 SKUs, 35 retail quotes**.

On a consistent local snapshot, before vs after archive import, re-score, and
76 recoverable appliance retirements:

| Call | Before | After |
|---|---:|---:|
| BUY | 5 | 13 |
| VERIFY | 22 | 25 |
| FAIR | 38 | 42 |
| PASS | 322 | 334 |
| RISK | 62 | 62 |
| INSUFFICIENT_DATA | 988 | 949 |
| OUT_OF_SCOPE | 2,979 | 2,915 |

The 39 fewer can't-tells split into 27 newly priced listings and 12 retired
appliances. The parser itself changes the explanation, not those four calls.
No comp filter was loosened. The new default Review segment caps its final
filtered population at ten, excluding risky, unpriceable, gone and personally
labelled rows. Other segments remain available and keep consistent counts.

Verification: 203 tests passed; TypeScript and Vite builds passed. The built
stylesheet and real inventory components were inspected at 360px, including
exact $17.50 / $7.50 rendering and the seller-quote disclosure. Component render
verification used a local fixture, not a production login.

Reproducible commands, using the existing Bun installation:

```text
bun run src/scripts/reverdict.ts           # compare, no stored verdict changes
bun run src/scripts/reverdict.ts --apply   # persist through storeVerdict
bun run src/scripts/retire-repeated-appliances.ts --dry
bun run src/scripts/retire-repeated-appliances.ts
bun run src/scripts/archive.ts --check
```

`checkStored` may learn catalog aliases even in comparison mode, as it already
does elsewhere. Use an isolated database snapshot for read-only audits of
production facts. No API keys or live session cookies are needed for these
local checks.
