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
import { db } from "../db/index.ts";

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

export function valueSku(skuId: number | null, opts?: { windowDays?: number }): Valuation {
  if (!skuId) return { status: "no_comps", lowCents: null, highCents: null, medianCents: null, compCount: 0, confidence: "low" };

  const rows = db()
    .query(
      `SELECT sold_price_cents + COALESCE(shipping_cents,0) AS total
       FROM comps WHERE sku_id = $sku
         AND (sold_at IS NULL OR sold_at >= date('now', $win))
       ORDER BY total`,
    )
    .all({ $sku: skuId, $win: `-${opts?.windowDays ?? 90} days` }) as Array<{ total: number }>;

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

export function netByChannel(grossEbayCents: number, category: string): ChannelResult[] {
  const ship = SHIP_CENTS[category] ?? 1500;
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

  const fbGross = Math.round(grossEbayCents * FACEBOOK_GROSS_RATIO);
  out.push({
    channel: "facebook", grossCents: fbGross, feesCents: 0, shippingCents: 0,
    netCents: fbGross, available: true,
    note: "local pool only, but no fees and no shipping",
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
  parts: Array<{ role: string; query: string; skuId: number | null; medianCents: number | null; compCount: number }>;
  coverage: number;          // 0-1, share of expected components actually priced
  partsSumCents: number;
  wholeUnitCents: number | null;
}

const WHOLE_UNIT_RATIO = 0.6;   // midpoint of the 50-70% whole-unit band
const EXPECTED_ROLES = ["gpu", "cpu", "ram", "storage", "motherboard", "psu", "case"];

export function valueByParts(attributes: Record<string, string | number>): PartsValuation {
  const lookup = (q: string) => {
    const row = db()
      .query(
        `SELECT s.id, COUNT(c.id) n,
                CAST(AVG(c.sold_price_cents) AS INTEGER) med
         FROM skus s LEFT JOIN comps c ON c.sku_id = s.id
         WHERE LOWER(s.model) = LOWER($q) GROUP BY s.id`,
      )
      .get({ $q: q }) as { id: number; n: number; med: number } | null;
    return row && row.n > 0
      ? { skuId: row.id, medianCents: row.med, compCount: row.n }
      : { skuId: row?.id ?? null, medianCents: null, compCount: 0 };
  };

  const parts: PartsValuation["parts"] = [];
  for (const role of ["gpu", "cpu"] as const) {
    const q = attributes[role];
    if (!q) continue;
    parts.push({ role, query: String(q), ...lookup(String(q)) });
  }

  const priced = parts.filter((p) => p.medianCents != null);
  const partsSumCents = priced.reduce((s, p) => s + (p.medianCents ?? 0), 0);
  const coverage = priced.length / EXPECTED_ROLES.length;
  const wholeUnitCents = priced.length ? Math.round(partsSumCents / WHOLE_UNIT_RATIO * WHOLE_UNIT_RATIO) : null;

  return {
    parts, coverage: +coverage.toFixed(2), partsSumCents,
    wholeUnitCents: priced.length ? Math.round(partsSumCents) : null,
    status: coverage >= 0.4 ? "ok" : priced.length ? "sparse" : "no_comps",
    lowCents: priced.length ? Math.round(partsSumCents * 0.85) : null,
    highCents: priced.length ? Math.round(partsSumCents * 1.15) : null,
    medianCents: priced.length ? Math.round(partsSumCents) : null,
    compCount: priced.reduce((s, p) => s + p.compCount, 0),
    confidence: coverage >= 0.5 ? "medium" : "low",
  };
}
