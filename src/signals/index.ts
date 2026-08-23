/**
 * The cheap-signals layer.
 *
 * Phase 0's biggest finding: the strongest signals are not in the item photos.
 * They're in listing age, missing spec fields, contradictions, seller clusters
 * and payment rails. All of this is near-free — no model call, no comps — and
 * no competitor computes it.
 *
 * See RISK-MODEL.md section 3.
 */
import type { RawListing, Signal, SignalReport, Category } from "../types.ts";
import { findContradictions } from "../reference/compatibility.ts";

/**
 * Platform-specific staleness. Yish: Craigslist doesn't aggressively prune, so
 * an old listing there is often simply dead. Facebook does prune, so an old
 * Facebook listing is genuinely unsold — a much stronger signal.
 */
const STALE_DAYS: Record<string, number> = {
  craigslist: 45, facebook: 21, offerup: 30, mercari: 30, ebay: 30,
};

/**
 * ORDER IS LOAD-BEARING. Complete machines must be matched before the parts
 * inside them. A "Gaming Desktop PC / RTX 3050" is a prebuilt, not a GPU —
 * getting that backwards applies the wrong value fields and the wrong risk set.
 * Matched against the TITLE first, then the full text.
 */
const CATEGORY_PATTERNS: Array<[Category, RegExp]> = [
  ["phone",    /\b(iphone|galaxy s\d|pixel \d|z ?flip|z ?fold|smartphone|note ?\d{2})\b/i],
  ["tablet",   /\b(ipad|galaxy tab|surface pro|tablet)\b/i],
  ["console",  /\b(playstation|ps[45]\b|xbox|nintendo switch|steam deck)\b/i],
  ["prebuilt", /\b(gaming (pc|desktop|computer)|desktop (pc|computer)|prebuilt|imac|all[- ]in[- ]one|mac (mini|studio|pro)|workstation|tower)\b/i],
  ["laptop",   /\b(laptop|macbook|thinkpad|latitude|xps|notebook|chromebook|inspiron|precision|elitebook|pavilion)\b/i],
  ["gpu",      /\b(rtx|gtx|radeon|rx ?[5-9]\d{3}|quadro|tesla|graphics card|gpu|video card)\b/i],
  ["component",/\b(ddr[45]|ram\b|ssd|nvme|motherboard|cpu|processor|power supply|psu)\b/i],
];

/** The one field whose absence most destroys the ability to value the item. */
// NOTE: \d{1,4} not \d{2,4} — "1TB" and "2TB" are single-digit and were being
// reported as missing storage on listings that clearly stated it.
const VALUE_FIELDS: Partial<Record<Category, Array<[string, RegExp]>>> = {
  phone:    [["storage", /\b(\d{1,4})\s?(gb|tb)\b/i]],
  // No trailing \b — real CPU model numbers carry letter suffixes ("i7-1185G7",
  // "i7-6700K") and a closing boundary can never match after them.
  laptop:   [["cpu", /\b(i[3579][- ]\d{4,5}[a-z0-9]*|ryzen \d|m[1234]\b|celeron|core ultra|snapdragon)/i],
             ["ram", /\b\d{1,3}\s?gb\b/i]],
  gpu:      [["model", /\b(rtx|gtx|rx|tesla|quadro)\s?[a-z]?\d{3,4}/i]],
  prebuilt: [["gpu", /\b(rtx|gtx|rx)\s?\d{3,4}|\b(integrated|igpu|iris|radeon graphics)\b/i],
             ["cpu", /\b(i[3579][- ]\d{4,5}[a-z0-9]*|ryzen \d|m[1234]\b|core ultra|xeon)/i]],
  console:  [["storage", /\b(\d{3,4}\s?gb|\d{1,2}\s?tb)\b/i]],
  tablet:   [["storage", /\b(\d{1,4})\s?(gb|tb)\b/i]],
};

const IRREVERSIBLE_RAILS =
  /\b(friends\s*(and|&)\s*family|f\s*&\s*f|cash\s?app|cashapp|zelle|venmo|gift ?card|wire transfer|western union|apple ?pay only)\b/i;

const SPEC_SHEET_LANGUAGE =
  /\b(designed for professionals|features include|is a high-performance|delivers (up to|exceptional)|engineered (for|to)|ideal for (creators|professionals))\b/i;

const LOW_KNOWLEDGE =
  /\b(works good|works great|runs good|found in storage|was my (son|daughter|husband|wife)'?s?|cleaning out|moving must go|no longer needed|dont know much|not sure what)\b/i;

const HIGH_KNOWLEDGE =
  /\b(never mined|no mining|battery health|clean imei|paid off|no financing|off[- ]lease|passed diagnostics|cycle count|original box|comps?|retail|below ebay)\b/i;

function detectCategory(text: string): Category {
  for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(text)) return cat;
  return "unknown";
}

export function analyze(l: RawListing, opts?: { clusterSize?: number }): SignalReport {
  const text = `${l.title}\n${l.description}`;
  const t = text.toLowerCase();
  const signals: Signal[] = [];
  const category = detectCategory(text);

  // ---------------------------------------------------------- age (3c)
  let daysOnMarket: number | null = null;
  if (l.postedAt) {
    daysOnMarket = Math.floor((Date.now() - Date.parse(l.postedAt)) / 86_400_000);
    const stale = STALE_DAYS[l.source] ?? 30;
    if (daysOnMarket > stale) {
      signals.push({
        code: "LONG_ON_MARKET", severity: "medium", polarity: "negative",
        evidence: `${daysOnMarket} days on ${l.source} (stale past ~${stale}). On Craigslist this often means the listing is simply dead — confirm it's still available before driving.`,
      });
    }
  }

  // ------------------------------------------- listing quality (3c/3e)
  const photoCount = l.photoUrls.length;
  const descLen = l.description.length;
  const q =
    Math.min(photoCount / 8, 1) * 0.4 +
    Math.min(descLen / 400, 1) * 0.4 +
    (/\b(scratch|dent|crack|wear|blemish|flaw|issue|note that)\b/i.test(t) ? 0.2 : 0);
  const listingQuality = Math.round(q * 100) / 100;

  if (photoCount === 0) {
    signals.push({
      code: "ZERO_PHOTOS", severity: "high", polarity: "negative",
      evidence: "No photos at all. On anything meaningfully priced this is close to dispositive on its own.",
    });
  }

  // ------------------------------ seller sophistication (3.5 — Yish's)
  let soph = 0.5;
  const hasModelNum = /\b([a-z]{1,4}[- ]?\d{3,5}[a-z]{0,3})\b/i.test(text);
  const vagueCpu = /\bi[3579]\b(?![- ]?\d)/i.test(text);
  if (hasModelNum) soph += 0.2;
  if (HIGH_KNOWLEDGE.test(text)) soph += 0.25;
  if (LOW_KNOWLEDGE.test(text)) soph -= 0.25;
  if (vagueCpu) soph -= 0.15;
  if (descLen < 60) soph -= 0.15;
  const sellerSophistication = Math.max(0, Math.min(1, Math.round(soph * 100) / 100));

  if (sellerSophistication <= 0.35) {
    signals.push({
      code: "LOW_SELLER_KNOWLEDGE", severity: "info", polarity: "positive",
      evidence: "Seller shows little knowledge of what they have. Mispricing is likely — and the direction is random, so this is worth a close look rather than a skip.",
    });
  }

  // --------------------------------------------- missing value fields (3d)
  const missingValueFields: string[] = [];
  for (const [field, re] of VALUE_FIELDS[category] ?? []) {
    if (!re.test(text)) missingValueFields.push(field);
  }
  if (missingValueFields.length) {
    signals.push({
      code: "MISSING_VALUE_FIELDS", severity: "high", polarity: "neutral",
      evidence: `Missing the field(s) that most determine value: ${missingValueFields.join(", ")}. Cannot price confidently without them.`,
    });
  }

  // ------------------------------------------------- payment rails (3k)
  if (IRREVERSIBLE_RAILS.test(text)) {
    signals.push({
      code: "IRREVERSIBLE_PAYMENT", severity: "high", polarity: "negative",
      evidence: `Seller offers an irreversible payment rail (${text.match(IRREVERSIBLE_RAILS)?.[0]}). These strip buyer protection. Insist on cash in person; if they push back, walk.`,
    });
  }

  // ---------------------------------------- geographic contradiction (3l)
  const locOutOfRegion =
    l.location && !/\b(ma|mass|boston|newton|cambridge|somerville|quincy|waltham|medford|brockton|lowell|worcester|providence|nh|ri)\b/i.test(l.location);
  if (locOutOfRegion && /\blocals? only\b/i.test(t)) {
    signals.push({
      code: "GEOGRAPHIC_CONTRADICTION", severity: "high", polarity: "negative",
      evidence: `Listing says "locals only" but the stated location is "${l.location}", which is not in this market. Both cannot be true.`,
    });
  }

  // -------------------------------------------- spec-sheet language (3g)
  if (SPEC_SHEET_LANGUAGE.test(text)) {
    signals.push({
      code: "SPEC_SHEET_LANGUAGE", severity: "medium", polarity: "negative",
      evidence: "Description reads like a manufacturer product page rather than a person describing their own item. The seller likely doesn't understand it, which makes their condition claims unreliable.",
    });
  }

  // ---------------------------------------------- contradictions (3f)
  for (const c of findContradictions(text)) {
    signals.push({
      code: c.code,
      severity: c.code === "NO_DISPLAY_OUTPUT" ? "blocker" : "high",
      polarity: "negative",
      evidence: c.evidence,
    });
  }

  // ------------------------------------------------ seller cluster (3e)
  if (opts?.clusterSize && opts.clusterSize >= 3) {
    const positive = listingQuality >= 0.6;
    signals.push({
      code: positive ? "REFURBISHER_CLUSTER" : "BULK_SELLER_CLUSTER",
      severity: positive ? "info" : "medium",
      polarity: positive ? "positive" : "negative",
      evidence: positive
        ? `${opts.clusterSize} listings from this seller, all detailed and well-specified. Reads as a professional refurbisher — often the best deal source on the board.`
        : `${opts.clusterSize} near-identical low-information listings from this seller. Bulk pattern, treat with suspicion.`,
    });
  }

  return { signals, daysOnMarket, listingQuality, sellerSophistication, category, missingValueFields };
}
