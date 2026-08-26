/**
 * Board tier — a chip is not a product.
 *
 * **Yish's observation, 2026-08-25, and the measurements back it hard.** An
 * "RTX 5070" is one GPU die sold by six board partners across three price
 * tiers, and the same is true of RAM, SSDs and PSUs. Measured across Newegg,
 * Micro Center and Best Buy on one day, 42 genuinely-new in-stock RTX 5070s:
 *
 *     $795.59  PNY Epic-X                    <- base
 *     $799.99  GIGABYTE WindForce
 *     $819.99  ASUS PRIME
 *     $839.99  GIGABYTE Gaming               <- mid
 *     $849.99  MSI Gaming / GIGABYTE AERO
 *     $899.99  GIGABYTE AORUS                <- premium
 *     $949.99  ASUS TUF Gaming
 *     $1,499   ASUS ROG STRIX
 *     $1,669   ASUS T1
 *
 * **$796 to $1,670 for the same silicon — 110%.** The used side matches: an
 * MSI Ventus 2X cleared at $450 while an ASUS TUF cleared at $1,555, both
 * filed under one SKU whose median is $639.
 *
 * WHAT THIS DOES AND DOES NOT FIX, because the honest answer is narrower than
 * that range suggests. The interquartile spread of used GPU comps is only
 * **1.08x-1.25x** — the median is robust, and the extremes are the tails, not
 * the bulk. So this is NOT a claim that every median is 110% wrong. It matters
 * in two specific places:
 *
 *   1. **Individual premium and budget cards.** A TUF listing priced off a
 *      pooled median is undervalued by most of that gap, and it is exactly the
 *      expensive listings where being wrong costs money.
 *   2. **The retail ceiling, which takes the CHEAPEST offer** and therefore
 *      always lands on the base tier. Comparing a TUF listing to a PNY ceiling
 *      is the worst case in the system, because the ceiling drives a PASS.
 *
 * THE LADDER IS NAMED, NOT INFERRED. Deriving tiers from observed prices needs
 * retail coverage for every chip, which we do not have — and it would be
 * circular for the ceiling, which is the thing being corrected. Product lines
 * are stable public facts, so they are listed. `validateLadder` checks them
 * against whatever retail we DO hold, so a wrong entry shows up as a number
 * rather than an opinion.
 */

export type BoardTier = "base" | "mid" | "premium";

/**
 * Brand line -> tier. Longest match wins, so "AORUS ELITE" beats "AORUS".
 *
 * Only lines that actually appear on cards are listed. A line we do not know
 * returns `null` rather than guessing a tier, and `null` means "do not filter"
 * everywhere downstream — an unknown card must never be silently treated as
 * budget, which is the direction that turns a good deal into a PASS.
 */
const LINES: Array<[string, BoardTier]> = [
  // ASUS — PRIME/DUAL are the value lines, TUF the middle, ROG the halo.
  ["rog astral", "premium"], ["astral", "premium"], ["rog strix", "premium"], ["rog matrix", "premium"],
  ["matrix", "premium"], ["strix", "premium"],
  ["tuf gaming", "mid"], ["tuf", "mid"], ["proart", "mid"],
  ["prime", "base"], ["dual", "base"], ["phoenix", "base"],

  // MSI — VENTUS/SHADOW value, GAMING middle, SUPRIM/VANGUARD halo.
  ["suprim liquid", "premium"], ["suprim", "premium"], ["vanguard", "premium"],
  ["lightning", "premium"],
  ["gaming trio", "mid"], ["gaming x", "mid"], ["gaming", "mid"], ["inspire", "mid"],
  ["ventus", "base"], ["shadow", "base"],

  // GIGABYTE — WINDFORCE/EAGLE value, GAMING/AERO middle, AORUS halo.
  ["aorus xtreme", "premium"], ["aorus master", "premium"], ["aorus elite", "mid"],
  ["aorus", "premium"],
  ["aero", "mid"], ["gaming oc", "mid"],
  ["windforce", "base"], ["eagle", "base"],

  // ZOTAC — SOLID/TWIN EDGE value, AMP middle, AMP EXTREME halo.
  ["amp extreme", "premium"], ["amp holo", "premium"], ["amp", "mid"],
  ["trinity", "mid"],
  ["solid", "base"], ["twin edge", "base"],

  // AMD-side partners.
  ["nitro+", "premium"], ["nitro", "premium"], ["red devil", "premium"],
  ["taichi", "premium"], ["pulse", "mid"], ["hellhound", "mid"],
  ["challenger", "base"], ["reaper", "base"], ["swft", "base"], ["steel legend", "mid"],

  // Others that appear on the pages we scrape.
  ["ichill", "premium"], ["igame", "mid"], ["gamerock", "premium"],
  ["gamingpro", "mid"], ["dual-x", "base"], ["verto", "base"], ["epic-x", "base"],
  /**
   * Added after the first validation run: these came back `unknown`, and the
   * unknown bucket's median was 1.27x the cheapest card for its chip — i.e.
   * they were not unclassifiable, they were PREMIUM cards missing from the
   * ladder, and leaving them unknown meant they were never filtered out of a
   * budget card's comp set.
   *
   * `founder edition` singular is deliberate and separate: NVIDIA's own cards
   * are written both ways and only the plural was listed.
   */
  ["arcticstorm", "premium"], ["apocalypse", "premium"], ["noctua", "premium"],
  ["master ice", "premium"], ["master", "premium"],
  ["founders edition", "mid"], ["founder edition", "mid"],
];

const BRANDS = [
  "asus", "msi", "gigabyte", "zotac", "pny", "evga", "sapphire", "powercolor",
  "xfx", "asrock", "inno3d", "palit", "gainward", "colorful", "acer", "nvidia",
  "yeston", "maxsun", "manli",
];

export interface BoardRead {
  brand: string | null;
  line: string | null;
  tier: BoardTier | null;
  /** Cooler fan count when stated: "Dual Fan", "3X", "Triple Fan". */
  fans: number | null;
  /** Factory-overclocked. Worth a little, and always stated when true. */
  oc: boolean;
  /**
   * White / special colourways. NOT cosmetic in price terms: an ASUS PRIME RTX
   * 5070 was $819.99 and the PRIME **White** $919.99 on the same page. $100 for
   * a colour, which is more than a whole tier step elsewhere in the ladder.
   */
  special: boolean;
}

/**
 * Brands with no premium line at all, so the BRAND is the tier.
 *
 * A bare "PNY GeForce RTX 5070 12GB GDDR7" names no line and would otherwise
 * read as unknown. PNY does not make a halo card — every PNY on the pages we
 * scraped was the cheapest offer for its chip, and PNY's Epic-X was the single
 * cheapest RTX 5070 in the whole 42-offer sample at $795.59. Leaving it unknown
 * throws away a fact we actually have.
 */
const VALUE_BRANDS = new Set(["pny", "maxsun", "manli", "yeston"]);

export function readBoard(title: string): BoardRead {
  const t = title.toLowerCase();

  const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(t)) ?? null;

  // Longest line name first, so "aorus elite" is not eaten by "aorus".
  let line: string | null = null;
  let tier: BoardTier | null = null;
  for (const [name, tr] of [...LINES].sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`\\b${name.replace(/[+]/g, "\\+")}`).test(t)) { line = name; tier = tr; break; }
  }
  if (!tier && brand && VALUE_BRANDS.has(brand)) tier = "base";

  const fanMatch = t.match(/\b(single|dual|twin|triple|quad)[- ]?fan\b/) ?? t.match(/\b([234])x\b/);
  const WORD: Record<string, number> = { single: 1, dual: 2, twin: 2, triple: 3, quad: 4 };
  const fans = fanMatch ? (WORD[fanMatch[1]] ?? Number(fanMatch[1]) ?? null) : null;

  const special = /\b(white|ice|snow|limited edition|anniversary|world of warcraft|midnight void)\b/.test(t);

  /**
   * A special colourway is worth a TIER STEP, not a footnote.
   *
   * On one Best Buy page an ASUS PRIME RTX 5070 was $819.99 and the PRIME
   * **White** $919.99 — $100 for a colour, which is a bigger step than base to
   * mid elsewhere in the ladder. Micro Center's ASUS Prime White was $919.99
   * against $819.99 for the plain Prime, independently. Treating a white card
   * as plain base is the same pooling error one level down.
   *
   * It only ever promotes one step, and never past premium.
   */
  if (special && tier === "base") tier = "mid";
  else if (special && tier === "mid") tier = "premium";

  return { brand, line, tier, fans, oc: /\b(oc|overclocked|overclock)\b/.test(t), special };
}

/** Convenience: just the tier, `null` when the card names no known line. */
export const boardTier = (title: string): BoardTier | null => readBoard(title).tier;

/**
 * Two cards are comparable when neither states a tier or both state the same.
 *
 * Unknown is permissive on purpose, exactly as the storage-tier filter treats
 * silence: an unnamed card is not evidence of disagreement, and excluding
 * everything unnamed would gut a 71-comp sample down to nothing.
 */
export function tierComparable(a: BoardTier | null, b: BoardTier | null): boolean {
  return a === null || b === null || a === b;
}
