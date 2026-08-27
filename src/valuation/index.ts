/**
 * Valuation and channel economics.
 *
 * Two things the market gets wrong and this doesn't:
 *
 * 1. A single "resale value" number is meaningless. Net depends on CHANNEL —
 *    eBay is a bigger buyer pool minus ~13% and shipping; Facebook is a local
 *    pool with zero fees. Which wins flips by item weight.
 * 2. BUY is not "below market." It's "clears MY floor after fees, drive time
 *    and risk." That floor is a per-user setting. See CALIBRATION finding 1.
 */
import { resolveProductType } from "../signals/product-type.ts";
import { db } from "../db/index.ts";
import { adjustPrice, normalizeCondition, comparable, type Condition } from "./condition.ts";
import { boardTier, tierComparable, type BoardTier } from "../signals/board-tier.ts";

export type Channel = "ebay" | "facebook";

export interface UserEconomics {
  label: string;
  min_absolute_profit_cents: number;
  effective_hourly_floor_cents: number;
  transaction_minutes: number;
  relist_minutes: number;
  prefers_channel: Channel;
}

/** eBay final value fee for electronics, plus the per-order fixed fee. */
const EBAY_FVF = 0.1325;
const EBAY_FIXED_CENTS = 40;

/** Shipping by category. `null` = not practically shippable, so Facebook-only. */
const SHIP_CENTS: Record<string, number | null> = {
  phone: 1000, tablet: 1200, component: 1000, gpu: 1500,
  laptop: 2000, console: 2500, prebuilt: null,
};

/**
 * Facebook gross runs below eBay: local buyer pool, no buyer protection.
 * 0.85 is a STARTING ASSUMPTION, not a measured number — there is no sold-comp
 * source for Facebook anywhere. It gets replaced by real data from the outcomes
 * table once the sell side ships. See CALIBRATION finding 9.
 */
const FACEBOOK_GROSS_RATIO = 0.85;

export interface Valuation {
  status: "ok" | "sparse" | "no_comps";
  lowCents: number | null;
  highCents: number | null;
  medianCents: number | null;
  compCount: number;
  confidence: "high" | "medium" | "low";
}

/**
 * Storage capacity in GB from a title. "1TB" -> 1024, "256GB" -> 256.
 *
 * Deliberately ignores small figures: RAM is written the same way ("16GB") and
 * reading it as storage would put a 16GB-RAM laptop in the 16GB-phone bucket.
 */
export function storageOf(title: string): number | null {
  const t = title.toLowerCase();
  const tb = t.match(/\b(\d(?:\.\d)?)\s?tb\b/);
  if (tb) return Math.round(Number(tb[1]) * 1024);
  const gb = [...t.matchAll(/\b(\d{2,4})\s?gb\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 64);
  return gb.length ? Math.max(...gb) : null;
}

export function valueSku(
  skuId: number | null,
  opts?: {
    windowDays?: number;
    condition?: Condition | null;
    category?: string | null;
    /** Listing attributes. Storage is the one that reprices a SKU on its own. */
    attributes?: Record<string, string | number>;
    /**
     * The LISTING's board tier, for GPUs. Yish's point: a chip is not a
     * product. See `signals/board-tier.ts` for the measurements.
     */
    boardTier?: BoardTier | null;
  },
): Valuation {
  if (!skuId) return { status: "no_comps", lowCents: null, highCents: null, medianCents: null, compCount: 0, confidence: "low" };

  let raw = db()
    .query(
      `SELECT sold_price_cents + COALESCE(shipping_cents,0) AS total, condition_norm, raw_title
       FROM comps WHERE sku_id = $sku
         AND (sold_at IS NULL OR sold_at >= date('now', $win))`,
    )
    .all({ $sku: skuId, $win: `-${opts?.windowDays ?? 90} days` }) as Array<{ total: number; condition_norm: string | null; raw_title: string }>;

  /**
   * A SKU IS NOT A PRICE POINT. Storage tiers inside one model differ by
   * hundreds of dollars, and pooling them values every unit as the average one.
   *
   * Measured: an "iPhone 16 Pro Max 1TB" was valued against a median that
   * included 256GB sales, came out looking overpriced, and the engine said PASS
   * where Yish said BUY. The comps were correct; the bucket was too coarse.
   *
   * Comps whose title states a DIFFERENT capacity are dropped. Comps that state
   * none are kept — silence is not disagreement, and dropping them would gut
   * the sample. If too few survive, the filter is abandoned rather than
   * returning a confident number from four rows.
   */
  const want = opts?.attributes?.storage_gb ?? opts?.attributes?.storage_tier;
  if (typeof want === "number" && want >= 64) {
    const matched = raw.filter((r) => {
      const got = storageOf(r.raw_title);
      return got === null || Math.abs(got - want) / want < 0.2;
    });
    if (matched.length >= 5) raw = matched;
  }

  /**
   * BOARD TIER, same shape as the storage filter and for the same reason.
   *
   * Yish, 2026-08-25: a graphics card search returns a very broad price range
   * because board partners and cooler tiers differ. Measured across three
   * retailers on one day, 42 new RTX 5070s ran $795.59 (PNY Epic-X) to $1,669
   * (ASUS T1) — 110% for identical silicon — and premium lines sit ~32% above
   * base at the median. On the used side an MSI Ventus 2X cleared $450 and an
   * ASUS TUF $1,555, both filed under one SKU whose median is $639.
   *
   * The threshold is 8, not the storage filter's 5, because tier is a WEAKER
   * discriminator than capacity: the interquartile spread of used GPU comps is
   * only 1.08x-1.25x, so the median already absorbs most of this, and a thin
   * tier-matched sample would trade a small bias for a large variance.
   *
   * Cards naming no known line are KEPT — silence is not disagreement, and
   * treating an unnamed card as budget is the direction that turns a good deal
   * into a PASS.
   */
  if (opts?.boardTier) {
    const matched = raw.filter((r) => tierComparable(boardTier(r.raw_title), opts.boardTier!));
    if (matched.length >= 8) raw = matched;
  }

  /**
   * Restate every comp in the LISTING's condition before taking a median.
   *
   * Before this, a for-parts comp and a sealed comp went into the same pile and
   * the median came out somewhere meaningless in between. Sorting has to happen
   * AFTER adjustment — sorting first and adjusting second would return
   * percentiles of the wrong ordering, which is the kind of bug that produces a
   * plausible number and no error.
   */
  const target = opts?.condition ?? null;

  /**
   * Some listings are salvage even though eBay's condition field says
   * otherwise — the seller writes it in the title instead. "No Boot", "Turns on
   * - Lights only", "cracked", "water damaged". Trust either signal.
   */
  const BROKEN_TITLE =
    /\b(for parts|parts\/repair|parts only|not working|no boot|won'?t (boot|turn on|power)|does ?n'?t (boot|work|turn on)|dead|cracked|shattered|water damage|salvage|as[- ]is|broken|damaged|repair)\b/i;

  /**
   * ⚠ A COMP MUST BE THE PRODUCT, NOT A MACHINE CONTAINING IT.
   *
   * Searching sold listings for "i7-10700" returns bare CPUs AND every Dell
   * OptiPlex, XPS, Precision and G5 built around one. Measured on the live
   * archive: 26 bare chips at a $140 median, 38 whole computers at $275, and
   * the combined median the engine was using came out at $199 — a CPU valued
   * 40% high because complete PCs were sitting in its comp set.
   *
   * That is the same family as the salvage rule below: a price is only a comp
   * for the thing it was actually paid for. It matters most for CPUs, where
   * the part is cheap and the machines around it are not.
   *
   * `resolveProductType` decides by HEAD NOUN, so "i7-10700 Desktop Processor"
   * is kept (head: "desktop processor") while "Dell G5 5000 Desktop i7-10700"
   * is dropped (head: "desktop"). A substring match on "desktop" would throw
   * away both — which is exactly the mistake I made reaching for a regex first.
   *
   * ONLY for component-shaped categories. A prebuilt SKU WANTS whole machines;
   * they are the entire point of `Gaming PC RTX 2080`.
   */
  const partLike = opts?.category === "component" || opts?.category === "gpu";
  const MACHINE_HEAD = /^(desktop|tower|pc|computer|laptop|notebook|optiplex|precision|thinkcentre|thinkpad|prodesk|elitedesk|workstation|all-in-one|aio|imac|macbook|server)$/i;

  const rows = raw
    .filter((r) => {
      if (!partLike) return true;
      try {
        const head = resolveProductType(r.raw_title, "");
        return !MACHINE_HEAD.test(String(head.head ?? ""));
      } catch { return true; }
    })
    .map((r) => {
      const stated = normalizeCondition(r.condition_norm);
      // Title evidence downgrades, never upgrades. A seller calling a cracked
      // phone "used" does not make it working.
      const cond = stated !== "for_parts" && BROKEN_TITLE.test(r.raw_title) ? "for_parts" : stated;
      return { cond, total: r.total };
    })
    /**
     * SALVAGE IS A DIFFERENT MARKET. Excluded, not adjusted — see `comparable`.
     * Before this, broken units sat in working medians at face value and pulled
     * every price down; an iPhone 15 median carried $75 and $91 no-boot sales.
     */
    .filter((r) => comparable(r.cond, target))
    .map((r) => ({ total: adjustPrice(r.total, r.cond, target, opts?.category ?? null) }))
    .sort((a, b) => a.total - b.total);

  const n = rows.length;
  if (n === 0) return { status: "no_comps", lowCents: null, highCents: null, medianCents: null, compCount: 0, confidence: "low" };

  const at = (p: number) => rows[Math.min(n - 1, Math.floor(p * n))].total;
  const median = n % 2 ? rows[(n - 1) / 2].total : Math.round((rows[n / 2 - 1].total + rows[n / 2].total) / 2);

  return {
    // Interquartile band, not min/max — one junk comp shouldn't set the range.
    status: n >= 3 ? "ok" : "sparse",
    lowCents: at(0.25),
    highCents: at(0.75),
    medianCents: median,
    compCount: n,
    confidence: n >= 8 ? "high" : n >= 3 ? "medium" : "low",
  };
}

export interface ChannelResult {
  channel: Channel;
  grossCents: number;
  feesCents: number;
  shippingCents: number;
  netCents: number;
  available: boolean;
  note?: string;
}

/**
 * What market is the input price denominated in?
 *
 * `ebay`  a price from eBay sold comps. Facebook is assumed to fetch ~15% less.
 * `local` a price that is ALREADY what it sells for locally. Do not discount.
 *
 * Yish: *"why did you * 0.6 and then *0.85 the build? theres no fees if i
 * resell it on marketplace."* The 0.85 is not a fee — eBay's 13.25% is charged
 * separately — but he is right that it was applied twice over.
 *
 * A tower cannot be shipped economically, so `SHIP_CENTS.prebuilt` is null and
 * an assembled PC only ever sells LOCALLY. The whole-unit ratio that produced
 * the price was itself derived from whole-machine sales, which are local sales.
 * Discounting a local price by "the local discount" charges it a second time.
 */
export type PriceBasis = "ebay" | "local";

export function netByChannel(
  grossEbayCents: number, category: string, basis: PriceBasis = "ebay",
): ChannelResult[] {
  /**
   * `??` WOULD DESTROY THE MEANING OF THE null HERE.
   *
   * `SHIP_CENTS.prebuilt` is `null` on purpose: a tower cannot be shipped
   * economically, so eBay is not an available channel at all. But `null ?? 1500`
   * evaluates to 1500 — nullish coalescing cannot tell a deliberate null from a
   * missing key — so the "local sale only" branch below was UNREACHABLE and
   * every gaming PC was quietly priced as if you could post it for $15.
   *
   * `in` distinguishes "we set this to null on purpose" from "no entry".
   */
  const ship = category in SHIP_CENTS ? SHIP_CENTS[category] : 1500;
  const out: ChannelResult[] = [];

  if (ship !== null) {
    const fees = Math.round(grossEbayCents * EBAY_FVF) + EBAY_FIXED_CENTS;
    out.push({
      channel: "ebay", grossCents: grossEbayCents, feesCents: fees, shippingCents: ship,
      netCents: grossEbayCents - fees - ship, available: true,
    });
  } else {
    out.push({
      channel: "ebay", grossCents: grossEbayCents, feesCents: 0, shippingCents: 0,
      netCents: 0, available: false,
      note: "too bulky to ship economically — local sale only, which caps the buyer pool",
    });
  }

  /**
   * A `local` price is ALREADY what it fetches on Facebook. Discounting it again
   * charged the local penalty twice — on the NZXT build that was 0.6 x 0.85, so
   * the machine was valued at 51% of its parts and read PASS against an asking
   * price Yish judged a clear BUY.
   */
  /**
   * ⚠ NO LOCAL DISCOUNT ON SOMETHING THAT CANNOT SHIP. Same double-count as
   * above, one level out — and Yish caught it on a gaming PC.
   *
   * The 15% is a BUYER-POOL penalty: eBay reaches the country, Facebook reaches
   * your metro, so the gross clears lower. That is a real effect for a phone or
   * a graphics card, where eBay genuinely is the bigger market.
   *
   * It is NOT a real effect for a tower. `ship === null` means we have already
   * decided eBay is not an available channel for this item, and the eBay comps
   * we hold for it are overwhelmingly local-pickup sales — they ALREADY have
   * the small-pool constraint priced in, because that constraint is why the
   * item cannot ship in the first place. Charging it again values every gaming
   * PC 15% under its own observed sales, forever, on the ONLY channel it has.
   *
   * Concretely: 18 sold RTX 2080 builds median $549, and the engine reported
   * the machine as worth $467.
   *
   * The fee argument does not rescue the 0.85 either — Facebook takes no fee,
   * so the discount has to be justified purely by pool size, and here it is not.
   */
  const localOnly = ship === null;
  const fbRatio = basis === "local" || localOnly ? 1 : FACEBOOK_GROSS_RATIO;
  const fbGross = Math.round(grossEbayCents * fbRatio);
  out.push({
    channel: "facebook", grossCents: fbGross, feesCents: 0, shippingCents: 0,
    netCents: fbGross, available: true,
    note: basis === "local"
      ? "no fees, no shipping — and this value is already a local price"
      : localOnly
        ? "local sale is the only channel, so these comps are already local prices"
        : "local pool only, but no fees and no shipping",
  });

  return out;
}

export function getEconomics(label = "yish"): UserEconomics {
  return db().query("SELECT * FROM user_economics WHERE label=$l").get({ $l: label }) as UserEconomics;
}

/**
 * Minimum net profit required to justify a trip, given the user's hourly floor.
 * Yish's two stated points ($100 local, $150 at 30min) resolve to ~$120-135/hr,
 * so one parameter reproduces both instead of a step function.
 */
export function requiredProfitCents(econ: UserEconomics, driveMinutesOneWay: number): number {
  const hours = (driveMinutesOneWay * 2 + econ.transaction_minutes + econ.relist_minutes) / 60;
  return Math.max(econ.min_absolute_profit_cents, Math.round(econ.effective_hourly_floor_cents * hours));
}

/**
 * Sum-of-parts valuation for bundles (prebuilt PCs).
 *
 * A custom build is not a SKU — there is no single sold comp for it. Value it by
 * decomposing into components, pricing each, summing, then applying a whole-unit
 * realisation ratio. Research: parting out realises ~60-80% of component value,
 * selling whole ~50-70%. The spread between those IS the flip.
 *
 * Coverage is reported honestly. Pricing one component out of six and calling it
 * a valuation would be worse than returning nothing.
 */
export interface PartsValuation extends Valuation {
  /** Parts valuations land in the LOCAL market — a tower cannot be shipped. */
  basis: PriceBasis;
  parts: Array<{ role: string; query: string; skuId: number | null; medianCents: number | null; compCount: number }>;
  coverage: number;          // 0-1, share of expected components actually priced
  partsSumCents: number;
  /** partsSum scaled up for the roles we could NOT price. */
  impliedPartsCents: number;
  wholeUnitCents: number | null;
}

/**
 * THIS FUNCTION WAS DEAD CODE AND NOTHING SAID SO. Found by audit 2026-08-24,
 * confirmed by arithmetic:
 *
 *   EXPECTED_ROLES had 7 entries; only gpu and cpu were ever priced.
 *   Maximum achievable coverage = 2/7 = 0.286.
 *   The verdict gate required coverage >= 0.30.
 *
 * So EVERY prebuilt PC returned INSUFFICIENT_DATA permanently, no matter how
 * many comps existed. Two more thresholds (0.40 for `ok`, 0.50 for medium
 * confidence) were unreachable by even more. And `partsSum / RATIO * RATIO`
 * is the identity function, so the whole-unit ratio never applied — while the
 * value actually RETURNED ignored that computed variable entirely and used the
 * raw parts sum.
 *
 * THE REAL FIX IS TO DEFINE WHAT THE NUMBER MEANS. Two different numbers were
 * being conflated:
 *
 *   part-out value   sell the components separately. Higher gross, much more
 *                    work, and it is what the sum of component comps literally
 *                    measures.
 *   whole-unit value what the assembled machine sells for. LOWER than the sum
 *                    of parts, because a buyer pays for convenience, not for
 *                    your afternoon on eBay.
 *
 * `medianCents` is the WHOLE-UNIT value, because that is what the verdict
 * compares against an asking price for an assembled machine. Part-out is
 * reported alongside so the spread is visible — that spread IS the flip.
 *
 * Coverage is now weighted by what each role is actually worth. Pricing the GPU
 * and CPU of a gaming PC is most of the machine's value; pricing the case and
 * PSU is not. Counting roles equally treated "I know the GPU and CPU" as 2/7 of
 * the answer when it is closer to two thirds of the money.
 */
/**
 * Whole-machine price as a fraction of what its parts SELL for.
 *
 * **The old 0.6 was applied to the wrong base.** The research line it came from
 * reads: *"parting out realises roughly 60-80% of component value; selling whole
 * realises 50-70%."* Both percentages are of COMPONENT VALUE — but our parts sum
 * is built from eBay SOLD prices, which is already the realised part-out figure,
 * not component value. So 0.6 discounted a number that had been discounted once
 * already.
 *
 * The ratio that actually applies here is whole-versus-part-out:
 *
 *   whole / part-out  =  60% / 70%  =  0.86     (band midpoints)
 *   part-out on eBay also loses ~13% in fees, which our gross sum does not
 *   subtract, so                       0.86 x 0.87  =  ~0.75
 *
 * STILL A PRIOR, not a measurement, and Yish is the domain authority here — he
 * flipped gaming PCs. The outcome loop is what will eventually replace it: a
 * build we valued and then watched clear at a real price is the only honest
 * source for this number.
 */
const WHOLE_UNIT_RATIO = 0.75;

/**
 * Share of a typical gaming build's resale value by component. Priors, and
 * labelled as such — but far closer to reality than treating a case as equal to
 * a graphics card. Sums to 1.0.
 */
const ROLE_VALUE_WEIGHT: Record<string, number> = {
  gpu: 0.42, cpu: 0.22, ram: 0.09, storage: 0.09, motherboard: 0.1, psu: 0.05, case: 0.03,
};
const EXPECTED_ROLES = Object.keys(ROLE_VALUE_WEIGHT);
/** Roles the catalog can currently price at all. See engine gap #1. */
const PRICEABLE_ROLES = ["gpu", "cpu", "ram", "storage"] as const;

/**
 * Price a prebuilt against WHOLE-MACHINE sales, not a sum of its parts.
 *
 * **This exists because the parts-sum method was badly wrong, and Yish said so
 * before the data did.** On the NZXT build:
 *
 *   parts sum, scaled and discounted     $890
 *   USED whole PCs with an RTX 5070      $1,375 median (n=25)
 *   nearest comps                        $1,140 (RTX 5070 + 9700X + NZXT case)
 *                                        $1,200 (RTX 5070 + 7600X)
 *
 * The assumption underneath the old path was that an assembled machine sells
 * for LESS than its parts. For current-gen gaming PCs that is backwards —
 * buyers pay a premium for built, tested and ready to game, which is why
 * iBUYPOWER and Skytech towers clear above the cost of their components.
 *
 * The GPU is the anchor: it dominates the price of a gaming build and it is the
 * one part every listing names. CPU and RAM move the number within a tier; the
 * tier itself is set by the card.
 */
export function valueWholeBuild(
  attributes: Record<string, string | number>,
  condition: Condition | null,
): (Valuation & { basis: PriceBasis; sku: string | null }) | null {
  const gpu = attributes.gpu;
  if (!gpu) return null;

  const row = db()
    .query(
      `SELECT id, model FROM skus
       WHERE category = 'prebuilt' AND LOWER(model) = LOWER($m) LIMIT 1`,
    )
    .get({ $m: `Gaming PC ${String(gpu).toUpperCase()}` }) as { id: number; model: string } | null;
  if (!row) return null;

  const v = valueSku(row.id, { condition, category: "prebuilt" });
  if (v.status === "no_comps") return null;
  /**
   * These comps are eBay sold prices for whole towers — an eBay-denominated
   * number, so the local discount DOES apply here, unlike the parts path.
   */
  return { ...v, basis: "ebay", sku: row.model };
}

export function valueByParts(attributes: Record<string, string | number>): PartsValuation {
  /**
   * Price each component THROUGH `valueSku`, not with a raw SQL average.
   *
   * The old lookup did `AVG(sold_price_cents)` — a mean, in a column named
   * `med` — and bypassed every protection the rest of the file has: no
   * condition adjustment, no salvage exclusion, no 90-day window, no shipping.
   * So an RTX 5070 read **$674 inside a build and $615 on its own**, with the
   * difference being broken cards and stale sales that `valueSku` excludes.
   *
   * A component's price cannot depend on which code path asked for it.
   */
  /**
   * ⚠ SEPARATORS ARE NOISE IN A PART NUMBER, AND EXACT MATCH TREATED THEM AS
   * MEANING.
   *
   * The catalog stores CPUs hyphenated (`i7-9700`) because that is how Intel
   * writes them. Sellers do not: "GAMING PC: I7 10700 / RTX 2080" is a real
   * Facebook title, and extraction faithfully returns `i7 10700` with a space.
   * `LOWER(model) = LOWER(q)` then misses — **even when the catalog has the
   * part.** Proven directly: `i7-9700` FOUND, `i7 9700` MISS, same row.
   *
   * The same bug runs the other way for GPUs, where sellers close the gap
   * instead of opening it: `rtx3070` was extracted from a live listing and the
   * catalog's "RTX 3070" never matched it.
   *
   * So: exact match first, then a separator-insensitive retry. Stripping
   * spaces and hyphens does NOT collapse distinct parts — "rtx 4070" becomes
   * `rtx4070` and "rtx 4070 ti" becomes `rtx4070ti`, which stay different — so
   * this recovers real misses without inventing matches.
   */
  const lookup = (q: string, category: string) => {
    const flat = (s: string) => s.toLowerCase().replace(/[\s-]/g, "");
    const row = (db()
      .query(`SELECT id FROM skus WHERE LOWER(model) = LOWER($q) LIMIT 1`)
      .get({ $q: q })
      ?? db()
        .query(
          `SELECT id FROM skus
           WHERE REPLACE(REPLACE(LOWER(model), ' ', ''), '-', '') = $f LIMIT 1`,
        )
        .get({ $f: flat(q) })) as { id: number } | null;
    if (!row) return { skuId: null, medianCents: null, compCount: 0 };
    const v = valueSku(row.id, { condition: "used", category });
    return { skuId: row.id, medianCents: v.medianCents, compCount: v.compCount };
  };

  const parts: PartsValuation["parts"] = [];
  for (const role of PRICEABLE_ROLES) {
    // RAM and storage arrive as numbers ("32", "512") from attribute
    // extraction; the catalog stores them as models. Skip rather than look up
    // a bare number and match something absurd.
    const q = attributes[role] ?? attributes[`${role}_gb`];
    if (!q) continue;
    const query = String(q);
    if (/^\d+$/.test(query)) continue;
    parts.push({ role, query, ...lookup(query, role === "gpu" ? "gpu" : "component") });
  }

  const priced = parts.filter((p) => p.medianCents != null);
  const partsSumCents = priced.reduce((s, p) => s + (p.medianCents ?? 0), 0);

  /**
   * Coverage weighted by VALUE, not by role count. Knowing the GPU and CPU of a
   * gaming build is ~64% of the money; the old count-based version called it
   * 2/7 = 29% and refused to price anything, forever.
   */
  const coverage = priced.reduce((s, p) => s + (ROLE_VALUE_WEIGHT[p.role] ?? 0), 0);

  /**
   * SCALE THE PARTIAL SUM UP TO A WHOLE MACHINE BEFORE DISCOUNTING IT.
   *
   * Yish, on a $650 i7-6700K + RTX 3050 build the engine valued at $130:
   * "its an entire pc not just the gpu I think you didnt add all of the parts
   * together before giving the median." Exactly right, and the error compounded:
   *
   *   gpu $174.52 + cpu $41.50           = $216.02   (64% of the value)
   *   x 0.6 whole-unit ratio             = $129.61   <- reported as the market
   *
   * The 0.6 ratio assumes a COMPLETE parts list. Applying it to 64% coverage
   * charges the discount twice: 0.64 x 0.6 = 38% of what the machine is worth.
   * RAM, storage, motherboard, PSU and case were simply missing from the sum.
   *
   * So divide by coverage first — if the priced roles account for 64% of a
   * typical build's value, the implied full parts total is sum / 0.64 — and
   * only then apply the whole-unit ratio, once.
   */
  const impliedPartsCents = coverage > 0 ? Math.round(partsSumCents / coverage) : 0;
  const wholeUnitCents = priced.length ? Math.round(impliedPartsCents * WHOLE_UNIT_RATIO) : null;

  return {
    basis: "local" as PriceBasis,
    parts, coverage: +coverage.toFixed(2), partsSumCents, impliedPartsCents, wholeUnitCents,
    status: coverage >= 0.6 ? "ok" : priced.length ? "sparse" : "no_comps",
    // The band widens as coverage falls: pricing 64% of a machine is a rougher
    // estimate than pricing 90% of it, and the range should say so rather than
    // presenting both with the same false precision.
    lowCents: wholeUnitCents ? Math.round(wholeUnitCents * (1 - 0.3 * (1 - coverage))) : null,
    highCents: wholeUnitCents ? Math.round(wholeUnitCents * (1 + 0.3 * (1 - coverage))) : null,
    medianCents: wholeUnitCents,
    compCount: priced.reduce((s, p) => s + p.compCount, 0),
    confidence: coverage >= 0.75 ? "medium" : "low",
  };
}
