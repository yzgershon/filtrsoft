/**
 * Condition normalisation and price adjustment.
 *
 * THE GAP THIS CLOSES: every comp in the archive is condition `used` and no
 * adjustment existed anywhere, so "for parts, water damaged, no power" and
 * "sealed in box" priced IDENTICALLY. That is not a rounding error — on a phone
 * it is the difference between $40 and $700, and it would have shown up as a
 * spectacular fake BUY on the worst listings on the site. MASTER-PLAN engine
 * gap #2, P0 and a prerequisite for Phase 2.
 *
 * TWO SEPARATE JOBS, deliberately not merged:
 *   1. normalise a messy string into one of five buckets
 *   2. convert a price in one bucket into a price in another
 */
import { db } from "../db/index.ts";

export type Condition = "new" | "open_box" | "refurb" | "used" | "for_parts";

export const CONDITIONS: Condition[] = ["new", "open_box", "refurb", "used", "for_parts"];

/**
 * Messy text to a bucket. Handles eBay's condition strings, eBay's numeric
 * condition IDs, and the free text sellers write in a listing.
 *
 * ORDER MATTERS AND IT IS NOT ALPHABETICAL. "for parts" is tested before
 * everything because a parts listing very often ALSO says "new screen" or
 * "like new otherwise", and reading that as `new` is the single most expensive
 * mistake this function can make. Damage always wins.
 */
export function normalizeCondition(raw: string | null | undefined): Condition | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).toLowerCase().trim();
  if (!t) return null;

  /**
   * ROUND-TRIP ITS OWN OUTPUT FIRST. This function normalises human text, and
   * for months it could not parse the values it had itself written: the stored
   * enum is `for_parts` with an UNDERSCORE, while the pattern below looks for
   * `for parts` with a space, so `\bfor parts\b` never matched.
   *
   * The damage was silent and total. `adjustPrice` returns its input unchanged
   * when `from` is null, so **every for_parts and open_box comp went into every
   * median at face value** — a $75 broken iPhone priced alongside working ones.
   * Yish caught it by reading the comps table: "you cant calculate that into
   * the median when the listing doesnt say it has any problems".
   */
  if ((CONDITIONS as string[]).includes(t)) return t as Condition;

  // eBay numeric condition IDs, which arrive as bare numbers.
  const byId: Record<string, Condition> = {
    "1000": "new", "1500": "open_box", "1750": "open_box",
    "2000": "refurb", "2010": "refurb", "2020": "refurb", "2030": "refurb", "2500": "refurb",
    "3000": "used", "4000": "used", "5000": "used", "6000": "used",
    "7000": "for_parts",
  };
  if (byId[t]) return byId[t];

  if (/\b(for parts|parts only|parts\/repair|not working|doesn'?t work|does not work|as[- ]is|broken|cracked|water damage|no power|won'?t (turn on|boot)|salvage|repair)\b/.test(t)) {
    return "for_parts";
  }
  if (/\b(refurb|refurbished|renewed|reconditioned|certified pre[- ]?owned)\b/.test(t)) return "refurb";
  if (/\b(open box|open[- ]box|opened never used|new other)\b/.test(t)) return "open_box";
  // "like new" and "mint" are USED. Sellers apply them to two-year-old hardware
  // constantly; treating them as new-adjacent would inflate half the archive.
  if (/\b(like new|mint|excellent|barely used|gently used)\b/.test(t)) return "used";
  if (/\b(brand new|sealed|unopened|bnib|new in box|factory sealed)\b/.test(t)) return "new";
  if (/\bnew\b/.test(t)) return "new";
  if (/\b(used|pre[- ]?owned|second[- ]hand|good condition|fair)\b/.test(t)) return "used";
  return null;
}

/**
 * Priors, expressed as a multiple of `used`.
 *
 * THESE ARE ASSUMPTIONS, NOT MEASUREMENTS, and they are written here in one
 * place so they can be found and killed. `measuredMultiplier` below replaces any
 * of them the moment the archive can support the number, and `conditionReport`
 * prints prior-vs-measured side by side so the drift is visible instead of
 * quietly living forever like the Facebook 0.85 ratio nearly did.
 *
 * The per-category overrides encode the one thing that is genuinely different
 * across categories rather than pretending precision everywhere:
 * **a broken phone is worth far less of its working self than a broken GPU is**,
 * because a locked or water-damaged phone is nearly unsellable while a dead
 * card still has a cooler, a backplate and a board someone wants.
 */
const PRIOR: Record<Condition, number> = {
  new: 1.35, open_box: 1.2, refurb: 1.05, used: 1.0, for_parts: 0.35,
};

const PRIOR_BY_CATEGORY: Partial<Record<string, Partial<Record<Condition, number>>>> = {
  phone: { new: 1.45, for_parts: 0.18 },     // activation lock makes a dead phone nearly worthless
  laptop: { new: 1.4, for_parts: 0.22 },
  gpu: { new: 1.25, for_parts: 0.45 },       // parts value survives on a dead card
  console: { new: 1.3, for_parts: 0.3 },
  prebuilt: { new: 1.2, for_parts: 0.4 },    // a dead build is still a bag of working parts
};

export function priorMultiplier(category: string | null, c: Condition): number {
  return PRIOR_BY_CATEGORY[category ?? ""]?.[c] ?? PRIOR[c];
}

/**
 * The measured ratio, or null when the archive cannot support one.
 *
 * The bar is deliberately high: at least 5 comps in the bucket, 5 in the `used`
 * baseline, and **at least 3 distinct SKUs on each side**. Without the SKU
 * requirement a single popular model with an odd price spread would set the
 * multiplier for a whole category, which is how you get a confident wrong number
 * that looks like it came from data.
 */
export function measuredMultiplier(category: string | null, c: Condition): number | null {
  if (c === "used") return 1;

  /**
   * MEASURE WITHIN EACH SKU, THEN AGGREGATE. Never pool a category and divide.
   *
   * Pooling produced **6.07x** for component `new`, which is not a condition
   * premium at all — it is Simpson's paradox. 59 of the "new" comps were an
   * expensive current-gen i7-14700KF while "used" was dominated by cheap
   * 6700K/6700/8500 sales. The ratio measured the SKU MIX.
   *
   * Within the 14700KF alone, new/used is **1.12x**. The pooled figure then
   * "adjusted" a $425 new chip down to about $53, which pushed the whole SKU's
   * used median to $62 for a CPU that plainly sells for ~$250 — a
   * confidently-derived, four-fold error, with real data on both sides.
   *
   * Per-SKU ratios cancel the mix. The median across SKUs then resists the one
   * model with a weird spread setting the multiplier for a whole category.
   */
  const rows = db()
    .query(
      `SELECT c.sku_id, c.condition_norm cond,
              c.sold_price_cents + COALESCE(c.shipping_cents,0) AS total
       FROM comps c JOIN skus s ON s.id = c.sku_id
       WHERE ($cat IS NULL OR s.category = $cat)
         AND c.sold_price_cents > 0
         AND c.condition_norm IN ($c, 'used')`,
    )
    .all({ $cat: category, $c: c }) as Array<{ sku_id: number; cond: string; total: number }>;

  const bySku = new Map<number, { target: number[]; base: number[] }>();
  for (const r of rows) {
    const b = bySku.get(r.sku_id) ?? { target: [], base: [] };
    (r.cond === "used" ? b.base : b.target).push(r.total);
    bySku.set(r.sku_id, b);
  }

  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };

  const ratios: number[] = [];
  for (const { target, base } of bySku.values()) {
    // Both sides need enough rows for a median to mean anything.
    if (target.length < 3 || base.length < 3) continue;
    const b = med(base);
    if (b > 0) ratios.push(med(target) / b);
  }

  // Three SKUs minimum, so one model's odd spread cannot set a category's rate.
  if (ratios.length < 3) return null;
  return med(ratios);
}

/** Measured if the archive can support it, prior otherwise. */
export function conditionMultiplier(category: string | null, c: Condition): number {
  return measuredMultiplier(category, c) ?? priorMultiplier(category, c);
}

/**
 * Restate a price observed in condition `from` as the equivalent in `to`.
 *
 * Used to pull a mixed bag of comps onto one condition before taking a median.
 * Without it a SKU whose comps happen to skew refurb quietly reads high, and
 * nothing in the output would say so.
 */
export function adjustPrice(
  cents: number, from: Condition | null, to: Condition | null, category: string | null,
): number {
  // An unknown condition is left ALONE rather than assumed to be `used`.
  // Assuming would silently apply a 1.0 that looks like a real adjustment.
  if (!from || !to || from === to) return cents;
  const f = conditionMultiplier(category, from);
  const t = conditionMultiplier(category, to);
  if (!f) return cents;
  return Math.round((cents / f) * t);
}

/** A device that works, as opposed to one sold for salvage. */
export const isWorking = (c: Condition | null): boolean =>
  c !== null && c !== "for_parts";

/**
 * Can a comp in condition `from` legitimately inform a price for `to`?
 *
 * **`for_parts` is a DIFFERENT MARKET, not a point on a condition scale**, and
 * this is the rule Yish articulated: you cannot put a "No Boot / For Parts"
 * sale into the median for a listing that describes no faults at all.
 *
 * Adjusting across the boundary is worse than useless. The phone multiplier is
 * 0.18, so restating a $75 salvage sale as "used" means DIVIDING by 0.18 —
 * multiplying it, and every bit of error in that prior, by 5.6x. It invents a
 * $417 data point out of a broken phone. Excluding is the honest operation.
 *
 * The reverse holds too: pricing a genuinely broken device off working comps
 * would be wildly optimistic, so a `for_parts` target only accepts `for_parts`.
 */
export function comparable(from: Condition | null, to: Condition | null): boolean {
  if (!from || !to) return true;          // unknown: keep, and do not adjust
  return isWorking(from) === isWorking(to);
}

/** Prior vs measured, per category, so the priors cannot hide. */
export function conditionReport(): Array<{
  category: string; condition: Condition; prior: number; measured: number | null; comps: number;
}> {
  const cats = (db().query("SELECT DISTINCT category FROM skus ORDER BY category").all() as Array<{ category: string }>)
    .map((r) => r.category);
  const out = [];
  for (const category of cats) {
    for (const condition of CONDITIONS) {
      if (condition === "used") continue;
      const comps = (db()
        .query(
          `SELECT COUNT(*) n FROM comps c JOIN skus s ON s.id=c.sku_id
           WHERE c.condition_norm=$c AND s.category=$cat`,
        )
        .get({ $c: condition, $cat: category }) as { n: number }).n;
      out.push({
        category, condition,
        prior: priorMultiplier(category, condition),
        measured: measuredMultiplier(category, condition),
        comps,
      });
    }
  }
  return out;
}
