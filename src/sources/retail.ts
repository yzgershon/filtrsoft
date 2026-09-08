/**
 * Retail prices — the ceiling nobody else checks.
 *
 * Every competitor compares used to used. A buyer, though, can always walk into
 * Best Buy and get a NEW one today, which puts a hard cap on what any used unit
 * can fetch. Two things fall out of that, and the second is the one I did not
 * expect to need:
 *
 *   1. **Used priced at or above new.** Common on phones and consoles when a
 *      seller anchors on what they paid. No comp set catches it, because the
 *      comps are all used too.
 *   2. **An independent check on our own comps.** If a used median lands ABOVE
 *      new retail, the comps are wrong. Nothing else in the system could have
 *      told us that — every other signal is derived from the same comps.
 *
 * THE TRAP, found in the first probe: **Best Buy sells refurbished units.** The
 * top result for "iphone 15 128gb" was *"Apple - Pre-Owned Excellent iPhone 15
 * Pro 5G 128GB"* at $659.99. Storing that as a retail ceiling would mean
 * capping used prices with a used price, which is worse than having no ceiling
 * — it would look authoritative and be circular.
 */
import { join } from "node:path";
import { db, now } from "../db/index.ts";
import { isMultiUnit } from "../signals/product-type.ts";
import { compMatchesQuery } from "./ebay.ts";
import { boardTier, type BoardTier } from "../signals/board-tier.ts";

const WORKER = join(import.meta.dir, "../browser/retail-worker.mjs");

export const CHROME_PATH =
  process.env.FILTRSOFT_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

/**
 * The three retailers, BEST FIRST for the categories Yish trades.
 *
 * Order is a finding, not a preference. Best Buy quoted $795.59 for an RTX
 * 5070 against a ~$549 MSRP — a ceiling that high never binds on anything.
 * Newegg is where PC parts are actually priced, and Micro Center Cambridge is
 * a twenty-minute drive from Newton, which makes it the only source here that
 * a local buyer could literally walk into today.
 */
export const RETAIL_SOURCES = ["newegg", "microcenter", "bestbuy"] as const;
export type RetailSource = (typeof RETAIL_SOURCES)[number];

export interface RetailOffer {
  source: string;
  title: string;
  priceCents: number;
  /** false for anything the retailer is selling second-hand. */
  isNew: boolean;
  /** false when out of stock. A price you cannot pay caps nothing. */
  available: boolean;
  /** Set when the ONLY price on the card was a financing instalment. */
  financedOnly?: boolean;
  /** Micro Center only: units on the shelf at the pinned store. */
  stockCount?: number;
}

/** Best Buy's own words for "this is not new". */
const NOT_NEW =
  /\b(pre-?owned|refurb(ished)?|geek squad certified|open-?box|renewed|used|certified refurbished)\b/i;

/** Badges Best Buy prints ABOVE a product name inside the card. */
const BADGE = /^(sponsored|pre-?owned|best selling|new|clearance|deal of the day|top rated|only at best buy)$/i;

/**
 * Lines that are page furniture, never a product name. Every one of these was
 * observed in a real capture; the review lines in particular are long enough
 * and word-like enough to pass any generic "looks like a title" test.
 */
const NOISE =
  /^(sponsored|not yet reviewed|rating \d|syndicated rating|\(\d+ reviews?|\d+(\.\d)?$|esrb ratings?:|add to cart|save \$|the comparable value|comp\.? value|more options from|get it (by|tomorrow)|see details|compare|sold out|pick up|shipping|free$|\+ ?\d+ (more|offers?)|for \d+ months|\/mo\.?$|\$|\d+$|sort by|best match|search all)/i;

/** A price on its own line: `$659.99`. The split `$ / 659 / 99` rows are noise. */
const PRICE_LINE = /^\$([\d,]+\.\d{2})$/;

/** `$17.49 per month` — financing, and never a ceiling. */
const FINANCED = /^\$[\d,]+\.\d{2}\s*(per month|\/mo)/i;

/** Best Buy closes every result card with this. It is the card boundary. */
const CARD_END = /^compare$/i;

/**
 * Parse a Best Buy results page from its text lines.
 *
 * SEGMENTS ON CARD BOUNDARIES rather than walking backward from each price.
 * The first version did the backward walk, and the live capture showed why that
 * cannot hold: the gap between a title and its price is 3 lines on one card and
 * 9 on another, and the filler is review text long enough to look like a
 * product name. *"(1 review from bestbuy-ca)"* was parsed as a $449 phone.
 *
 * Every card ends with the literal word `Compare`, which makes the grouping
 * exact instead of heuristic. Inside a card the first non-badge, non-noise line
 * is the name and the first bare price line is the price.
 */
export function parseBestBuy(lines: string[]): RetailOffer[] {
  const out: RetailOffer[] = [];
  const seen = new Set<string>();

  let card: string[] = [];
  const flush = () => {
    const c = card;
    card = [];
    if (!c.length) return;

    /**
     * The name is the LAST plausible line before the card's first price, not
     * the first line of the segment.
     *
     * The first segment on any page is not a card — it is the whole filter
     * sidebar plus the first product, because there is no `Compare` before it.
     * Taking the first line there picked up *"Brand new in the original
     * packaging."* (Best Buy's Condition filter help text) and priced it as a
     * phone. Anchoring on the price and reading backward inside the segment
     * makes the preamble irrelevant.
     */
    const priceAt = c.findIndex((l) => PRICE_LINE.test(l) || FINANCED.test(l));
    const before = priceAt >= 0 ? c.slice(0, priceAt) : c;
    let title: string | undefined;
    for (let i = before.length - 1; i >= 0; i--) {
      const l = before[i];
      if (l.length > 18 && !BADGE.test(l) && !NOISE.test(l) && !PRICE_LINE.test(l)) { title = l; break; }
    }
    if (!title || seen.has(title)) return;

    const priced = c.find((l) => PRICE_LINE.test(l));
    const financedOnly = !priced && c.some((l) => FINANCED.test(l));
    if (!priced) {
      // Worth surfacing rather than dropping: a model sold ONLY on a carrier
      // instalment plan has no outright new price, which is a real answer.
      if (financedOnly) {
        seen.add(title);
        out.push({
          source: "bestbuy", title, priceCents: 0, financedOnly: true,
          isNew: !NOT_NEW.test(title), available: false,
        });
      }
      return;
    }

    const priceCents = Math.round(Number(priced.match(PRICE_LINE)![1].replace(/,/g, "")) * 100);
    if (!priceCents) return;
    seen.add(title);

    out.push({
      source: "bestbuy", title, priceCents,
      isNew: !NOT_NEW.test(title),
      available: !c.some((l) => /^sold out$/i.test(l)),
    });
  };

  for (const line of lines) {
    if (CARD_END.test(line)) { flush(); continue; }
    card.push(line);
  }
  // No trailing flush: the tail after the last `Compare` is page footer, not a
  // card, and treating it as one invents an offer out of navigation links.
  return out;
}

/* ------------------------------------------------------------------ newegg */

/**
 * Newegg. **The price reference for PC parts, and the reason Best Buy alone
 * was not good enough.**
 *
 * Best Buy quoted $795.59 for an RTX 5070 against a ~$549 MSRP. A ceiling 45%
 * too high never binds on anything — it is not wrong so much as useless, which
 * is harder to notice. Newegg is where these parts are actually priced, and it
 * covers the `gpu` and `component` SKUs that also feed `valueByParts`.
 *
 * Cards run `QUICK VIEW` ... `Compare`. Segmenting that way also drops the
 * SPONSORED block at the top of every page for free — those cards carry no
 * `QUICK VIEW`, and on a GPU search they are prebuilt PCs, which would
 * otherwise price a $1,099 tower as the ceiling for a graphics card.
 */
const NEWEGG_MODEL = /^model\s*#\s*:/i;
const NEWEGG_BADGE =
  /^(newegg select|newegg refreshed|sponsored|quick view|add to cart|compare|free shipping|from united states|best seller|save:|more options from|release date:|\(\d)/i;

/**
 * Promo lines sit BETWEEN the title and `Model #:`, so a backward scan from
 * the model number lands on them first. They are long, capitalised and
 * word-like, so no generic "looks like a title" test rejects them — every one
 * of these was read as a product name in the first live capture, which paired
 * a $1,200 price with *"Get CONTROL Resonant with selected purchase, limited
 * offer"* and called it an RTX 5070.
 */
const NEWEGG_PROMO =
  /(limited offer|w\/ ?purchase|with selected purch|promotional gift|free (gift|game|bundle)|save an extra|price after)/i;

export function parseNewegg(lines: string[]): RetailOffer[] {
  const out: RetailOffer[] = [];
  const seen = new Set<string>();
  let card: string[] | null = null;

  const flush = () => {
    const c = card;
    card = null;
    if (!c?.length) return;

    /**
     * The name is the line immediately BEFORE `Model #:`.
     *
     * Every real catalog card carries that line and nothing else does, which
     * makes it a far better anchor than counting lines — the gap between the
     * title and the price varies with promo banners ("Get CONTROL Resonant
     * with selected purchase") that appear on some cards and not others.
     */
    const mi = c.findIndex((l) => NEWEGG_MODEL.test(l));
    let title: string | undefined;
    if (mi > 0) {
      for (let i = mi - 1; i >= 0; i--) {
        const l = c[i];
        if (l.length > 18 && !NEWEGG_BADGE.test(l) && !NEWEGG_PROMO.test(l) && !PRICE_LINE.test(l)) { title = l; break; }
      }
    }
    if (!title) {
      const pi = c.findIndex((l) => PRICE_LINE.test(l));
      const before = pi >= 0 ? c.slice(0, pi) : c;
      for (let i = before.length - 1; i >= 0; i--) {
        const l = before[i];
        if (l.length > 18 && !NEWEGG_BADGE.test(l) && !NEWEGG_PROMO.test(l)) { title = l; break; }
      }
    }
    if (!title || seen.has(title)) return;

    /**
     * The LAST bare price in the card, not the first.
     *
     * Newegg prints the struck-through list price first and the price you
     * actually pay second: `$1,299.99` / `$1,149.99` / `Save: $150.00 (11%)`.
     * Taking the first would inflate every discounted card, and discounts are
     * most of them. A `Save:` line is NOT a reliable marker of the pattern —
     * the Newegg Refreshed cards show two prices with no Save line at all.
     */
    const prices = c.filter((l) => PRICE_LINE.test(l));
    if (!prices.length) return;
    const priceCents = Math.round(
      Number(prices[prices.length - 1].match(PRICE_LINE)![1].replace(/,/g, "")) * 100,
    );
    if (!priceCents) return;
    seen.add(title);

    const text = c.join(" ");
    out.push({
      source: "newegg", title, priceCents,
      // "Newegg Refreshed" is Newegg's refurbished programme — the same
      // used-priced-as-new trap Best Buy's "Pre-Owned" was.
      isNew: !/\b(refurbished|newegg refreshed|open box|pre-?owned|used)\b/i.test(text),
      available: !/\b(out of stock|sold out|coming soon)\b/i.test(text),
    });
  };

  for (const line of lines) {
    if (/^quick view$/i.test(line)) { flush(); card = []; continue; }
    if (/^compare$/i.test(line)) { flush(); continue; }
    card?.push(line);
  }
  flush();
  return out;
}

/* ------------------------------------------------------------- microcenter */

/**
 * Micro Center — the only source here that is a PLACE.
 *
 * Yish's call, and it is a local one: the Cambridge MA store is ~20 minutes
 * from Newton, so for a Boston-area buyer it is a genuine alternative rather
 * than a theoretical one, which is exactly what a ceiling is supposed to
 * measure. Their GPU pricing is usually the lowest anywhere.
 *
 * It is also the richest page of the three, because it states LOCAL STOCK:
 * `14 IN STOCK` means you can drive over and have one today at that price.
 * That is a stronger ceiling than an online listing that might ship next week.
 *
 * Prices are PER STORE, which is why the worker pins `storeid=121` and sets
 * the store cookie — without it the site answers for whichever store it infers
 * from the IP, and a Texas price is not a ceiling Yish's buyer can act on.
 *
 * Card shape, from a live capture:
 *   Add SKU:044594 to wishlist   <- start
 *   SKU: 044594
 *   Compare Item <short title>>
 *   Compare
 *   <FULL TITLE with specs>      <- the name
 *   14 IN STOCK
 *   Original price / $15,999.99
 *   Our price     / $14,399.99   <- the price
 */
const MC_START = /^add sku:\s*\d+\s+to wishlist$/i;
const MC_STOCK = /^(\d+)\s+in stock$/i;

export function parseMicroCenter(lines: string[]): RetailOffer[] {
  const out: RetailOffer[] = [];
  const seen = new Set<string>();
  let card: string[] | null = null;

  const flush = () => {
    const c = card;
    card = null;
    if (!c?.length) return;

    /**
     * The name is the first long line AFTER the card's `Compare`.
     *
     * `Compare Item <title>>` sits just above it and is a truncated duplicate
     * with a stray `>` on the end; the line below `Compare` is the full one
     * with the specs, which is what the comp gates need to discriminate a
     * 12GB card from a 16GB one.
     */
    const ci = c.findIndex((l) => /^compare$/i.test(l));
    const after = ci >= 0 ? c.slice(ci + 1) : c;
    const title = after.find(
      (l) => l.length > 18 && !MC_STOCK.test(l) && !PRICE_LINE.test(l) &&
             !/^(our price|original price|quick view|add to cart|in store only|- item:)/i.test(l),
    );
    if (!title || seen.has(title)) return;

    /**
     * `Our price` wins over `Original price`. Micro Center prints both, in
     * that order, so a positional rule would take the pre-discount number on
     * every discounted item.
     */
    const oi = c.findIndex((l) => /^our price$/i.test(l));
    const priceLine = (oi >= 0 ? c.slice(oi + 1) : c).find((l) => PRICE_LINE.test(l));
    if (!priceLine) return;
    const priceCents = Math.round(Number(priceLine.match(PRICE_LINE)![1].replace(/,/g, "")) * 100);
    if (!priceCents) return;
    seen.add(title);

    const text = c.join(" ");
    const stock = c.map((l) => l.match(MC_STOCK)).find(Boolean);
    out.push({
      source: "microcenter", title, priceCents,
      isNew: !/\b(refurbished|open box|pre-?owned|used|clearance unit)\b/i.test(text),
      // Stock is stated per store. No count and no "in stock" means you cannot
      // walk in and buy it, so it caps nothing.
      available: stock ? Number(stock[1]) > 0 : /\bin stock\b/i.test(text),
      stockCount: stock ? Number(stock[1]) : undefined,
    });
  };

  for (const line of lines) {
    if (MC_START.test(line)) { flush(); card = []; continue; }
    card?.push(line);
  }
  flush();
  return out;
}

/** Parse whichever source produced the page. */
export function parseRetail(source: RetailSource, lines: string[]): RetailOffer[] {
  if (source === "newegg") return parseNewegg(lines);
  if (source === "microcenter") return parseMicroCenter(lines);
  return parseBestBuy(lines);
}

/**
 * Retail-only accessory guard, on top of the shared grammar.
 *
 * `resolveProductType` reads head-noun-LAST, which is correct for marketplace
 * titles ("iPhone 15 case" is a case). Best Buy's grammar is not that — its
 * titles are brand-first and often end in a compatibility clause, so *"Best Buy
 * essentials - USB-C Cable iPhone 15 128GB compatible"* parses as a phone.
 *
 * That miss is cheap everywhere else and expensive HERE, because the ceiling
 * takes the CHEAPEST match: one $12.99 cable that slips through becomes the
 * "new price" of an iPhone and caps every used comp we own. Best Buy's
 * accessory vocabulary is narrow and reliable, so match it directly rather than
 * loosening a grammar that is load-bearing for the crawlers.
 */
const RETAIL_ACCESSORY =
  /\b(case|cover|sleeve|skin|screen protector|tempered glass|cable|cord|adapter|charger|charging|power bank|mount|holder|stand|dock|strap|band|stylus|keyboard|mouse pad|earbuds?|headphones?|airtag|lens protector|car kit|compatible|replacement (battery|screen)|warranty|protection plan|gift card|installation|facial interface|head ?strap|thumb ?grips?|grips?|controller charging|carrying|remote|memory card|expansion card|accessor(y|ies)|\w* ?kit)\b/i;

/**
 * Best Buy's own navigation, rendered inside the results grid.
 *
 * *"Explore Nintendo Switch 2"* is a category tile, not a product, and it sat
 * next to a real $449.99 price — close enough to the truth that it would have
 * been stored and believed. *"Related to your search"* and *"Package - ..."*
 * are the same shape.
 */
const NAV_TILE = /^(explore|shop|browse|related to your search|package\b|save on|top deals|new to)/i;

/**
 * Every meaningful word of the query must actually appear.
 *
 * THE HOLE THIS CLOSES, and it is the biggest one in this file: every other
 * gate here says "reject if clearly wrong", which is the correct shape for
 * comps — a bad comp is one vote among many. The ceiling takes the CHEAPEST
 * single offer, so one thing slipping through is not diluted, it IS the answer.
 * Cheapest-wins needs a gate that says "require it to be clearly right".
 *
 * `compMatchesQuery` gates on DIGIT tokens, so a query with no digits in it has
 * no discriminating gate at all: *"Valve Index"* (a product Best Buy does not
 * carry) returned a page of unrelated stock and a $12.99 pack of thumbgrips
 * became the Index's "new retail price".
 *
 * The FIRST word is optional because it is the brand, and Best Buy drops the
 * manufacturer on first-party hardware — its Xbox listings say "XBOX Series X",
 * never "Microsoft Xbox Series X". Requiring it would reject the right answer.
 */
const GENERIC = new Set(["console", "gaming", "gaming pc", "laptop", "computer", "the", "and", "with", "edition"]);

function titleCoversQuery(title: string, query: string): boolean {
  const t = title.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words
    .slice(1)                                    // first word = brand, optional
    .filter((w) => w.length >= 3 && !GENERIC.has(w) && !/\d/.test(w))
    .every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t));
}

/**
 * The NEW price for a SKU: the cheapest genuinely-new offer that is actually
 * the product we asked about.
 *
 * Cheapest, not median: a ceiling is "what could I pay instead", and the honest
 * answer is the lowest price a buyer could walk in and get today.
 */
export function retailCeiling(
  offers: RetailOffer[], query: string, category?: string | null,
): { offer: RetailOffer | null; rejected: Array<{ title: string; why: string }> } {
  const rejected: Array<{ title: string; why: string }> = [];
  const usable = offers.filter((o) => {
    if (!o.isNew) return false;                       // reported separately
    // A price you cannot actually pay is not a ceiling. Sold-out stock and
    // carrier-instalment-only listings both look like offers and are not:
    // the iPhone 15 probe had two of them, at $0, and one became "the ceiling".
    if (!o.available || o.financedOnly || !o.priceCents) return false;
    if (RETAIL_ACCESSORY.test(o.title)) {
      rejected.push({ title: o.title, why: "retail accessory" });
      return false;
    }
    if (NAV_TILE.test(o.title)) {
      rejected.push({ title: o.title, why: "navigation tile, not a product" });
      return false;
    }
    if (!titleCoversQuery(o.title, query)) {
      rejected.push({ title: o.title, why: "title is missing words the query asked for" });
      return false;
    }
    /**
     * REUSE THE COMP GATE, do not re-implement it.
     *
     * The first version here did its own flattened `includes` on digit tokens,
     * which is the exact bug `compMatchesQuery` was written to fix: it matched
     * *"iPhone 16e 128GB"* for an iPhone 16 query and, because the ceiling
     * takes the CHEAPEST, the 16e's $539.99 became the iPhone 16's new price.
     * Cheapest-wins makes this source MORE variant-sensitive than comps are,
     * not less — every cheaper cousin in the family is a candidate.
     */
    const m = compMatchesQuery(o.title, query, category ?? null);
    if (!m.ok) { rejected.push({ title: o.title, why: m.why }); return false; }
    return true;
  });
  // Return the rejection log even with no ceiling — that is when it MATTERS.
  // Ten of fourteen queries land here, and "no ceiling" is silent about whether
  // Best Buy stopped stocking the thing or the parser broke.
  if (!usable.length) return { offer: null, rejected };

  /**
   * A candidate priced like an add-on is an add-on, whatever it is called.
   *
   * The named-accessory list can only catch words I thought of, and Best Buy's
   * accessory catalog is effectively unbounded — *"Quest 3S Breathable Facial
   * Interface"* at $39.99 passed every named gate and became the Quest 3S's new
   * price against real headsets at $350. Rather than keep growing the list,
   * compare each candidate to the page's OWN median: the results for a device
   * query are mostly that device, so the median is a decent stand-in for what
   * one costs, and anything under 40% of it is a different kind of object.
   *
   * Needs at least three candidates to mean anything, and it only ever REMOVES
   * cheap outliers — an expensive outlier cannot win a cheapest-wins pick, so
   * there is nothing to guard on that side.
   */
  let pool = usable;
  if (usable.length >= 3) {
    const sorted = [...usable].map((o) => o.priceCents).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const floor = median * 0.4;
    for (const o of usable) {
      if (o.priceCents < floor) {
        rejected.push({
          title: o.title,
          why: `$${(o.priceCents / 100).toFixed(0)} is under 40% of the $${(median / 100).toFixed(0)} page median — an add-on, not the device`,
        });
      }
    }
    const kept = usable.filter((o) => o.priceCents >= floor);
    if (kept.length) pool = kept;
  }

  return { offer: pool.reduce((a, b) => (b.priceCents < a.priceCents ? b : a)), rejected };
}

/**
 * One ceiling PER BOARD TIER, plus the untiered one.
 *
 * **Yish's point, and the reason a single ceiling was not enough.** The ceiling
 * takes the cheapest matching offer, so an untiered ceiling for a GPU always
 * lands on the budget card — measured, PNY's Epic-X at $795.59 was the cheapest
 * of 42 new RTX 5070s while an ASUS T1 was $1,669. Comparing an ASUS TUF
 * listing to a PNY ceiling is the worst case in the system, because the ceiling
 * drives a PASS and the error runs in the direction that kills a real deal.
 *
 * The tier premium is much larger NEW than used — 1.40x vs 1.11x measured — so
 * this matters more here than it does in the comps. Storing one row per tier
 * costs nothing extra: the offers are already on the page we scraped.
 *
 * The untiered entry is kept under `any` as the fallback for a listing whose
 * own tier cannot be read, and for every non-GPU category, where tier is
 * meaningless and `readBoard` returns null anyway.
 */
export function retailCeilingsByTier(
  offers: RetailOffer[], query: string, category?: string | null,
): Map<string, RetailOffer> {
  const out = new Map<string, RetailOffer>();
  const any = retailCeiling(offers, query, category).offer;
  if (any) out.set("any", any);
  if (category !== "gpu") return out;

  for (const tier of ["base", "mid", "premium"] as const) {
    const sub = offers.filter((o) => boardTier(o.title) === tier);
    if (!sub.length) continue;
    const found = retailCeiling(sub, query, category).offer;
    if (found) out.set(tier, found);
  }
  return out;
}

/** Reasons a query produced no ceiling, most useful first. Purely for output. */
export function noCeilingReason(
  offers: RetailOffer[], rejected: Array<{ title: string; why: string }>,
): string {
  if (!offers.length) return "nothing parsed — the page layout may have changed, check the fixture";
  const blocked = offers.filter((o) => o.isNew && (!o.available || o.financedOnly)).length;
  const tally = new Map<string, number>();
  for (const r of rejected) {
    const key = r.why.replace(/"[^"]*"/g, "…").replace(/\$[\d,]+/g, "$…");
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const top = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([why, n]) => `${n}× ${why}`);
  if (top.length) return `every candidate rejected — ${top.join("; ")}`;
  if (blocked) return `no longer sold new outright (${blocked} listing(s), all sold out or carrier-financed)`;
  return "Best Buy carries this second-hand only";
}

/**
 * What a retail price MEANS next to our own used median. Three outcomes, and
 * the middle one is the reason this feature is worth more than a price tag.
 *
 *   · `ceiling`     — retail sits above the used median, as it should. Now we
 *                     can flag any listing asking at or above new.
 *   · `comps_wrong` — retail sits BELOW the used median. For the same config
 *                     that cannot happen in a real market, so one of the two is
 *                     wrong, and retail is the one number not derived from our
 *                     comps. This is the check nothing else in the system could
 *                     have performed. It must NOT be silently dropped just
 *                     because it is inconvenient.
 *   · `implausible` — retail is a small fraction of the used median. Nothing
 *                     real looks like that; it is a parse escape (an accessory,
 *                     a trade-in credit, a monthly payment) and believing it
 *                     would cap a $700 phone at $30.
 *
 * The 0.35 line is a judgement call, set where a genuine clearance stops and a
 * mis-parse starts: real new-vs-used spreads bottom out around half, and every
 * accessory miss observed so far came in under a fifth.
 */
export type RetailMeaning = "ceiling" | "comps_wrong" | "implausible";

export function retailMeaning(retailCents: number, usedMedianCents: number | null): RetailMeaning {
  if (!usedMedianCents || !retailCents) return "ceiling";
  const ratio = retailCents / usedMedianCents;
  if (ratio < 0.35) return "implausible";
  if (ratio < 1) return "comps_wrong";
  return "ceiling";
}

/**
 * Capacity a retail title is quoting, in GB. `null` when it says nothing.
 *
 * Needed because a SKU is capacity-agnostic on purpose — the LISTING's storage
 * picks the comp tier at valuation time — so a ceiling stored against the SKU
 * alone would cap a 512GB phone with the 128GB shelf price and call it proof.
 */
export function capacityOf(title: string): number | null {
  const tb = title.match(/(\d+(?:\.\d+)?)\s*TB\b/i);
  if (tb) return Math.round(Number(tb[1]) * 1024);
  /**
   * Scan EVERY `NNGB` and take the largest valid capacity, not the first.
   *
   * A GPU's "12GB GDDR7" and a laptop's RAM are memory, not storage, and they
   * come first in the title: *"MacBook Air 16GB 512GB"* read as 16 and then
   * fell out of the valid-capacity list entirely, returning null for a machine
   * whose capacity is right there. Storage is the larger of the two in every
   * real configuration.
   */
  const all = [...title.matchAll(/(\d+)\s*GB\b/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => [64, 128, 256, 512, 1024, 2048].includes(n));
  return all.length ? Math.max(...all) : null;
}

/**
 * Record that we LOOKED and found no new offer.
 *
 * Without this the queue re-asks the same dead questions forever: the Xbox One
 * X has been discontinued for years and Best Buy has never carried the Valve
 * Index, so those two would head the "never observed" list on every single run
 * and crowd out SKUs that would actually answer.
 *
 * Stored as `is_new = 0` so `latestRetail` — which filters on `is_new = 1` —
 * can never mistake it for a $0 ceiling. It is a dated record of an absence,
 * which is also the honest thing to show in the UI.
 */
export function saveNoRetail(
  skuId: number | null, query: string, why: string, source: RetailSource = "bestbuy",
): void {
  db()
    .query(
      `INSERT INTO retail_prices (sku_id, source, title, price_cents, is_new, storage_gb, query, observed_at)
       VALUES ($sku,$src,$title,0,0,NULL,$q,$now)`,
    )
    .run({
      $sku: skuId, $src: source, $title: `(no new offer) ${why}`.slice(0, 200),
      $q: query, $now: now(),
    });
}

/**
 * **A PREBUILT HAS NO RETAIL TWIN, and storing one is actively harmful.**
 *
 * Caught live. The `Gaming PC RTX 5070` SKU pulled three "matching" new
 * machines: a Yeyian with a Core Ultra 7 270K, a PowerSpec with a Ryzen 5
 * 7500X3D, and a ViprTech with a Ryzen 7 8700F — $1,400 to $1,950. They share
 * one component. The CPU, RAM, storage, PSU and case are most of the price and
 * all of them vary, so "a new gaming PC with an RTX 5070" is a category, not a
 * product, and its cheapest member is not a ceiling on anything.
 *
 * It was about to do real damage rather than just be useless: at a $1,400
 * "ceiling" against a $1,599 used median, the comps-disagree branch would have
 * returned INSUFFICIENT_DATA for every RTX 5070 build in the feed — and it
 * would have looked like a data-quality finding, which is the trap
 * `retailMeaning` exists to avoid.
 *
 * `RETAIL_CATEGORIES` already excludes prebuilts; this is the write-boundary
 * guard, because `--sku` reaches `saveRetail` without passing that filter.
 */
export const NO_RETAIL_TWIN = ["prebuilt"];

export function retailApplies(category: string | null | undefined): boolean {
  return !!category && !NO_RETAIL_TWIN.includes(category);
}

export function saveRetail(
  skuId: number | null, offer: RetailOffer, query: string, tier: string | null = null,
): void {
  db()
    .query(
      `INSERT INTO retail_prices (sku_id, source, title, price_cents, is_new, storage_gb, board_tier, query, observed_at)
       VALUES ($sku,$src,$title,$price,$new,$gb,$tier,$q,$now)`,
    )
    .run({
      $sku: skuId, $src: offer.source, $title: offer.title,
      $price: offer.priceCents, $new: offer.isNew ? 1 : 0,
      $gb: capacityOf(offer.title),
      // The tier this row is the ceiling FOR, not the tier of the title —
      // "any" rows are stored with NULL so the tier filter ignores them.
      $tier: tier === "any" ? null : tier,
      $q: query, $now: now(),
    });
}

/** How old a retail observation may be before it stops meaning anything. */
export const RETAIL_STALE_DAYS = 45;

export interface RetailQuote {
  source: string;
  priceCents: number;
  title: string;
  observedAt: string;
  ageDays: number;
}

export interface RetailPrice {
  priceCents: number;
  title: string;
  source: string;
  observedAt: string;
  ageDays: number;
  stale: boolean;
  /** Another retailer independently priced it within range of this one. */
  corroborated: boolean;
  /** Every fresh quote we hold, cheapest first. Shown, not just used. */
  quotes: RetailQuote[];
  /** Set when a suspiciously cheap quote was thrown out. */
  discarded?: RetailQuote;
}

/**
 * A quote this far below the next-cheapest is treated as a mis-parse.
 *
 * Real spread between retailers is meaningful but bounded — the RTX 5070 came
 * back at $795.59 from Best Buy and $799.99 from Newegg, half a percent apart.
 * A gap of 40%+ is not competition, it is one of the two parsers having picked
 * up an accessory, a bundle component or a promo line.
 */
const CORROBORATION_FLOOR = 0.6;

/**
 * Latest NEW-retail price for a SKU, if one was ever captured.
 *
 * Retail moves, so the most recent observation wins — unlike comps, where the
 * whole history is the asset. A stale retail price is worse than none: last
 * year's launch price would cap nothing and flag nothing, so age travels with
 * the number and callers decide rather than being silently misled.
 */
export function latestRetail(
  skuId: number | null, storageGb?: number | null, tier?: BoardTier | null,
): RetailPrice | null {
  if (!skuId) return null;

  // A known tier cannot inherit a cheaper untiered ceiling.
  return latestRetailRows(skuId, storageGb, tier ?? null);
}

function latestRetailRows(
  skuId: number, storageGb: number | null | undefined, tier: BoardTier | null,
): RetailPrice | null {
  /**
   * The latest NEW quote FROM EACH RETAILER, then one ceiling chosen from them.
   *
   * Capacity must AGREE when both sides state one. A stored row with no
   * capacity still applies — that is a product where capacity is not a price
   * driver, like a GPU — but a 128GB shelf price must never cap a 512GB device.
   */
  const rows = db()
    .query(
      `SELECT source, price_cents, title, observed_at FROM retail_prices r
        WHERE sku_id=$id AND is_new=1 AND price_cents>0
          AND storage_gb IS $gb AND board_tier IS $tier
          AND observed_at >= $cutoff
          AND observed_at <= $now
          AND id = (
            SELECT id FROM retail_prices r2
             WHERE r2.sku_id=r.sku_id AND r2.source=r.source
               AND ((r2.storage_gb IS $gb AND r2.board_tier IS $tier)
                 OR (r2.is_new=0 AND r2.price_cents=0 AND (r2.storage_gb IS NULL OR r2.storage_gb IS $gb)))
             ORDER BY observed_at DESC,id DESC LIMIT 1)
        ORDER BY price_cents ASC`,
    )
    .all({ $id:skuId,$gb:storageGb??null,$tier:tier,
      $cutoff:new Date(Date.now()-RETAIL_STALE_DAYS*86_400_000).toISOString(),$now:new Date().toISOString() }) as Array<
      { source: string; price_cents: number; title: string; observed_at: string }
    >;
  if (!rows.length) return null;

  const age = (iso: string) => Math.max(0, (Date.now() - Date.parse(iso)) / 86_400_000);
  const quotes: RetailQuote[] = rows.map((r) => ({
    source: r.source, priceCents: r.price_cents, title: r.title,
    observedAt: r.observed_at, ageDays: Math.round(age(r.observed_at)),
  }));

  /**
   * THE CEILING IS THE CHEAPEST QUOTE ANOTHER RETAILER CORROBORATES.
   *
   * Cheapest-wins is the right definition — a ceiling is "what could I pay
   * instead" — but with three sources it means three chances for a bad parse
   * to become the answer, and the cheapest bad parse always wins. Nine Best
   * Buy ceilings could be hand-checked; thirty across three retailers cannot.
   *
   * So: if the cheapest is far below the next one, the retailers disagree by
   * more than retailers actually disagree, and the outlier is discarded rather
   * than trusted. A single-source quote is still used — it is real, it passed
   * every gate — but it is marked uncorroborated so the caller can weigh it.
   */
  let chosen = quotes[0];
  let discarded: RetailQuote | undefined;
  if (quotes.length > 1 && quotes[0].priceCents < quotes[1].priceCents * CORROBORATION_FLOOR) {
    discarded = quotes[0];
    chosen = quotes[1];
  }
  const corroborated = quotes.some(
    (q) => q !== chosen && q !== discarded && q.priceCents <= chosen.priceCents / CORROBORATION_FLOOR,
  );

  return {
    priceCents: chosen.priceCents,
    title: chosen.title,
    source: chosen.source,
    observedAt: chosen.observedAt,
    ageDays: chosen.ageDays,
    stale: chosen.ageDays > RETAIL_STALE_DAYS,
    corroborated,
    quotes,
    discarded,
  };
}

/**
 * What to type into Best Buy for a SKU.
 *
 * NOT `queryForSku` from ebay.ts. That one appends "graphics card" / "CPU
 * processor" to fight eBay's habit of returning whole laptops for a chip
 * search; Best Buy's catalog is already product-typed and the extra words just
 * shrink the result set. Storage DOES belong here, because Best Buy lists every
 * capacity of a phone separately and the 512GB price would cap the 128GB.
 */
export function retailQueryForSku(sku: {
  brand: string; model: string; category: string; attributes?: string | null;
}): string {
  let q = `${sku.brand} ${sku.model}`;
  const attrs = ((): Record<string, unknown> => {
    try { return JSON.parse(sku.attributes ?? "{}"); } catch { return {}; }
  })();
  const storage = attrs.storage_gb ?? attrs.storageGb ?? attrs.storage;
  if (storage && ["phone", "tablet", "laptop"].includes(sku.category)) {
    const n = Number(storage);
    if (Number.isFinite(n) && n > 0) q += n >= 1024 ? ` ${n / 1024}TB` : ` ${n}GB`;
  }
  return q;
}

/**
 * Categories Best Buy is worth asking, BEST FIRST — and the order is a finding,
 * not a preference.
 *
 * The first live run queued fourteen phones and would have returned almost
 * nothing: Best Buy no longer sells carrier iPhones outright, only on a 36-month
 * instalment, and every one of those cards is Sold Out for outright purchase.
 * The single new outright price on the whole iPhone 16 page was the 16e. Phones
 * stay in the list because SOME (unlocked, Samsung, Pixel) do have shelf prices,
 * but they must not be what a short run spends itself on.
 *
 * Prebuilts and loose components are excluded outright — there is no retail twin
 * for a Craigslist build, and an empty result there is indistinguishable from a
 * scraper that broke.
 */
export const RETAIL_CATEGORIES = [ "gpu", "laptop", "tablet", "phone"];

/**
 * Ordered by HOW MANY RETAILERS WE HAVE ASKED, fewest first — not by whether
 * we have any price at all.
 *
 * That ordering is what makes corroboration accumulate. The same SKU list goes
 * to all three retailers on every run, so a SKU nobody has priced gets three
 * quotes at once, and one that only Best Buy answered comes back around before
 * a SKU that already has three. Ordering by "has any price" instead would mark
 * a SKU done the moment ONE retailer answered — which is exactly the
 * single-source case `latestRetail` cannot corroborate.
 */
export function skusNeedingRetail(limit = 10): Array<{
  id: number; brand: string; model: string; category: string; attributes: string;
  observed: string | null; sources: number;
}> {
  const marks = RETAIL_CATEGORIES.map((_, i) => `$c${i}`).join(",");
  const order = RETAIL_CATEGORIES.map((c, i) => `WHEN $c${i} THEN ${i}`).join(" ");
  const params: Record<string, unknown> = { $lim: limit };
  RETAIL_CATEGORIES.forEach((c, i) => { params[`$c${i}`] = c; });
  return db()
    .query(
      `SELECT s.id, s.brand, s.model, s.category, s.attributes,
              (SELECT MAX(observed_at) FROM retail_prices r WHERE r.sku_id = s.id) observed,
              (SELECT COUNT(DISTINCT source) FROM retail_prices r WHERE r.sku_id = s.id) sources
         FROM skus s
        WHERE s.category IN (${marks})
        ORDER BY sources ASC, CASE s.category ${order} ELSE 99 END,
                 observed ASC, s.id
        LIMIT $lim`,
    )
    .all(params as never) as never;
}

export type RetailEvent =
  | { type: "log"; msg: string }
  | { type: "retail"; source: string; query: string; lines: string[] }
  | { type: "error"; msg: string }
  | { type: "done"; stats: Record<string, unknown> };

export async function* runRetailWorker(
  command: RetailSource,
  opts: Record<string, unknown>,
): AsyncGenerator<RetailEvent> {
  const proc = Bun.spawn(
    ["node", WORKER, command, JSON.stringify({ chromePath: CHROME_PATH, ...opts })],
    { stdout: "pipe", stderr: "pipe", stdin: "inherit" },
  );
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line) as RetailEvent; }
      catch { yield { type: "log", msg: `unparseable: ${line.slice(0, 120)}` }; }
    }
  }
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    yield { type: "error", msg: `worker exited ${code}${err ? `: ${err.slice(0, 200)}` : ""}` };
  }
}
