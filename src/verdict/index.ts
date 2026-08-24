/**
 * Verdict assembly — where everything converges.
 *
 * Precedence is deliberate and comes from CALIBRATION-2026-08-23.md:
 *   1. Out of scope short-circuits everything.
 *   2. An unresolved hard blocker forbids BUY at ANY price gap. A phone at 40%
 *      of market with unknown lock status is VERIFY, never BUY.
 *   3. A missing value-determining field means INSUFFICIENT_DATA, not a guess.
 *   4. Dead liquidity vetoes BUY regardless of margin — a good price on
 *      something that won't sell is not a deal.
 *   5. Only then does money decide, and it decides RELATIVE TO THE USER.
 */
import type { SignalReport, Verdict, Confidence } from "../types.ts";
import type { Match } from "../catalog/match.ts";
import { buildQuestions } from "./questions.ts";
import { valueSku, valueByParts, netByChannel, requiredProfitCents, getEconomics, type UserEconomics, type ChannelResult } from "../valuation/index.ts";

const OUT_OF_SCOPE = /\b(lens|dslr|mirrorless|camera body|tripod|nikon|canon ef|sigma \d|tamron|zeiss|leica|scanner|camcorder)\b/i;

export interface VerdictResult {
  call: Verdict;
  confidence: Confidence;
  headline: string;
  reasoning: string;
  decidingUnknown?: string;
  targetOfferCents?: number;
  valuation: ReturnType<typeof valueSku>;
  bestChannel?: ChannelResult;
  netProfitCents?: number;
  requiredProfitCents?: number;
  blockers: string[];
  /** Copy-pasteable, ordered so the first "no" that matters comes first. */
  questions: string[];
}

export function buildVerdict(input: {
  title: string;
  description: string;
  askingPriceCents: number | null;
  signals: SignalReport;
  match: Match;
  driveMinutes?: number;
  econ?: UserEconomics;
}): VerdictResult {
  const { signals, match } = input;
  const econ = input.econ ?? getEconomics();
  const drive = input.driveMinutes ?? 15;
  const blockers = signals.signals.filter((s) => s.severity === "blocker").map((s) => s.evidence);
  // A custom build has no SKU — decompose and price the parts instead.
  const isBundle = (match.category ?? signals.category) === "prebuilt";
  const partsVal = isBundle ? valueByParts(match.attributes) : null;
  const skuVal = valueSku(match.skuId);
  const valuation = partsVal && (skuVal.status === "no_comps" || partsVal.compCount > skuVal.compCount)
    ? partsVal : skuVal;
  const questions = buildQuestions(signals, match);
  const base = { valuation, blockers, questions };

  // --- 1. Out of scope -------------------------------------------------
  if (OUT_OF_SCOPE.test(`${input.title} ${input.description}`)) {
    return {
      ...base, call: "OUT_OF_SCOPE", confidence: "high",
      headline: "Not a category Assyze judges.",
      reasoning: "Camera and photo gear is deliberately out of scope — valuation is fine there, but the risk layer (fungus, element separation, focus motor wear, mount play) needs domain knowledge we don't have, and a category we can't audit is one we could be wrong about indefinitely.",
    };
  }

  // --- 2. Hard blockers override any price gap -------------------------
  if (blockers.length) {
    return {
      ...base, call: "RISK", confidence: "high",
      headline: "Hard blocker — do not proceed on price alone.",
      reasoning: blockers.join(" "),
      decidingUnknown: "resolve the blocker before considering the price",
    };
  }

  // --- 3. Missing the field that determines value ----------------------
  if (signals.missingValueFields.length) {
    return {
      ...base, call: "INSUFFICIENT_DATA", confidence: "high",
      headline: `Can't be valued — ${signals.missingValueFields.join(" and ")} not stated.`,
      reasoning: `The listing never says the ${signals.missingValueFields.join(" or ")}, which is the single biggest driver of value here. Ask before doing anything else.`,
      decidingUnknown: signals.missingValueFields[0],
    };
  }

  // --- 4. No comps -----------------------------------------------------
  if (valuation.status === "no_comps" || valuation.medianCents == null) {
    return {
      ...base, call: "INSUFFICIENT_DATA", confidence: "medium",
      headline: isBundle
        ? "Custom build — not enough component comps to price it."
        : match.skuId ? "No recent sold comps for this model." : "Couldn't identify the exact model.",
      reasoning: isBundle
        ? `Identified ${Object.entries(match.attributes).filter(([k]) => ["cpu","gpu","ram_gb","storage_gb"].includes(k)).map(([k,v]) => `${k} ${v}`).join(", ") || "no components"}, but the archive can't price enough of them yet. A build is worth the sum of its parts and there is no single comp for it.`
        : match.skuId ? "Identified the model but the archive has no recent sales to price it against."
        : "The title didn't resolve to a known model, so there is nothing to look up.",
      decidingUnknown: match.skuId ? "recent sold comps" : "exact model",
    };
  }

  // --- 4b. A bundle priced off too few of its parts is not priced ------
  // Valuing a whole build from just its GPU and calling the result "overpriced"
  // is a confident wrong answer, which is worse than no answer.
  if (partsVal && valuation === partsVal && partsVal.coverage < 0.3) {
    const known = partsVal.parts.filter((p) => p.medianCents != null).map((p) => p.query);
    const unknown = partsVal.parts.filter((p) => p.medianCents == null).map((p) => p.query);
    return {
      ...base, call: "INSUFFICIENT_DATA", confidence: "high",
      headline: `Specs are known — market prices aren't.`,
      reasoning: `Identified the full build (${Object.entries(match.attributes).filter(([k]) => ["cpu", "gpu", "ram_gb", "storage_gb"].includes(k)).map(([k, v]) => `${k.replace("_gb", "")} ${v}`).join(", ")}). But the comps archive only has sold prices for ${known.join(", ") || "none of it"} — nothing for ${unknown.join(", ") || "the CPU"}, RAM, motherboard, PSU or case. Pricing a whole machine off one part would be a confident wrong answer, so this stays unpriced until the archive covers more components.`,
      decidingUnknown: "sold prices for the remaining components (not the specs — those are known)",
    };
  }

  // --- 5. Money, relative to the user ----------------------------------
  const channels = netByChannel(valuation.medianCents, match.category ?? signals.category);
  const usable = channels.filter((c) => c.available);
  const best = usable.reduce((a, b) => (b.netCents > a.netCents ? b : a));
  const ask = input.askingPriceCents ?? 0;
  const net = best.netCents - ask;
  const required = requiredProfitCents(econ, drive);
  const $ = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;

  // Target offer: what they'd need to accept for this to clear the floor.
  const targetOfferCents = Math.max(0, best.netCents - required);

  const money = {
    ...base, bestChannel: best, netProfitCents: net,
    requiredProfitCents: required, targetOfferCents,
    confidence: valuation.confidence,
  };

  // Dead liquidity vetoes BUY no matter the margin.
  if (match.liquidity === "dead" || match.deadReason) {
    return {
      ...money, call: "PASS", confidence: "high",
      headline: "Won't resell — skip regardless of price.",
      reasoning: `${match.deadReason ?? "This category is a dead market."} Net would be ${$(net)} on ${best.channel}, but a good price on something that sits is not a deal.`,
    };
  }

  // A very large gap escalates scrutiny rather than excitement.
  const ratio = ask && valuation.medianCents ? ask / valuation.medianCents : 1;
  if (ratio > 0 && ratio < 0.6) {
    return {
      ...money, call: "VERIFY", confidence: valuation.confidence,
      headline: `Priced at ${Math.round(ratio * 100)}% of market — verify before driving.`,
      reasoning: `Asking ${$(ask)} against a ${$(valuation.medianCents)} median across ${valuation.compCount} comps. That gap is the strongest deal signal AND the strongest scam signal; they're the same observation. Resolve why it's cheap first.`,
      decidingUnknown: "why it is priced this far below market",
    };
  }

  if (net >= required) {
    return {
      ...money, call: "BUY",
      headline: `${$(net)} net on ${best.channel} — clears your ${$(required)} floor.`,
      reasoning: `Median ${$(valuation.medianCents)} across ${valuation.compCount} comps. ${best.channel === "ebay" ? `After ${$(best.feesCents)} fees and ${$(best.shippingCents)} shipping` : "No fees, no shipping, local sale"}, net is ${$(net)} against ${$(required)} required for a ${drive}-minute drive.`,
    };
  }

  if (net > 0) {
    return {
      ...money, call: "FAIR",
      headline: `Only ${$(net)} net — below your ${$(required)} floor.`,
      reasoning: `Real margin exists but doesn't pay for the trip. Would need roughly ${$(targetOfferCents)} to be worth it.`,
    };
  }

  return {
    ...money, call: "PASS",
    headline: `Overpriced — ${$(Math.abs(net))} underwater after fees.`,
    reasoning: `Asking ${$(ask)} against a ${$(valuation.medianCents)} median. Best channel is ${best.channel} and it still doesn't clear.`,
  };
}
