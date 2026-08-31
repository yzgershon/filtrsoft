/**
 * Every shape the API sends.
 *
 * One file, because these are a CONTRACT with `src/api`, not the private
 * business of any one screen. Split out of `App.tsx` (audit commit 6).
 */
// ---------------------------------------------------------------- types
export type Call = "BUY" | "FAIR" | "PASS" | "VERIFY" | "RISK" | "INSUFFICIENT_DATA" | "OUT_OF_SCOPE";
export interface Channel { channel: string; grossCents: number; feesCents: number; shippingCents: number; netCents: number; available?: boolean; note?: string }
/** A category hard-blocker and whether the listing resolved it. */
export interface RiskCheck { code: string; label: string; state: string; question: string; evidence?: string; remote?: boolean }
/** New-retail price for the same SKU. The only number not derived from comps. */
export interface Retail {
  priceCents: number; title: string; source: string; observedAt: string;
  ageDays: number; corroborated: boolean;
  quotes: Array<{ source: string; priceCents: number }>;
}
export interface Verdict {
  call: Call; confidence: string; headline: string; reasoning: string;
  decidingUnknown?: string; targetOfferCents?: number;
  netProfitCents?: number; requiredProfitCents?: number;
  bestChannel?: Channel; channels?: Channel[];
  questions: string[];
  blockers?: string[]; riskChecks?: RiskCheck[]; retail?: Retail | null;
  valuation: { medianCents: number | null; lowCents: number | null; highCents: number | null; compCount: number; confidence: string };
}
export interface Signal { code: string; severity: string; polarity: string; evidence: string }
/** What the engine decided the listing IS, shown so a wrong match is visible. */
export interface Meta {
  category?: string; daysOnMarket?: number | null; description?: string;
  missingValueFields?: string[];
  match?: { model: string | null; brand: string | null; confidence: string; method: string };
}
export interface FeedItem {
  id: number; title: string; url: string; source: string;
  askingPriceCents: number | null; location: string | null; postedAt: string | null;
  thumb: string | null; call: Call; headline: string | null; netProfitCents: number | null;
  /** From the daily sweep. The difference between a list and a tracker. */
  gone?: boolean; goneReason?: string | null;
  currentPriceCents?: number | null;
  priceDropCents?: number | null; priceWasCents?: number | null;
}
export interface Listing {
  title: string; url: string; askingPriceCents: number | null;
  location: string | null; postedAt: string | null; source: string; photoUrls: string[];
}

/** One entry in the local check history. */
export type Hist = { id: number; title: string; call: Call; at: number };

/** A sold comp behind the median, from `/v1/checks/:id`. */
export interface Comp {
  raw_title: string; total: number;
  condition_norm: string | null; sold_at: string | null; url: string | null;
}
