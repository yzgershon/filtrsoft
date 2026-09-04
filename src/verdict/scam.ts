/**
 * The scam-farm detector.
 *
 * Yish, 2026-09-04, after hand-marking about twenty listings RISK on his phone:
 * *"a lot of verify firsts are coming in that are genuine scams ... like all of
 * them were $66 or $85 or $67 which are rare for those to be real and the
 * titles of all of the descriptions were too perfect like Iphone 14 Pro Max
 * Blue 128gb VXG9I ... no one has like the part number in your title."*
 *
 * He was describing a signature, and it is in the data at a scale that matters:
 * **30 of the 59 actionable listings on 2026-09-04 matched it.** Over half of
 * everything the app was telling him to act on was a farm. That is not a
 * precision problem, it is the product failing at its one job.
 *
 *     $52  0.07x median   Unlocked iPhone 16 Pro Max 256GB Desert Titanium 7DIT
 *     $55  0.09x          Unlocked iPhone 16 Pro 512GB Natural Titanium GSIE
 *     $37  0.03x          MacBook Pro M3 Max 16-core 48GB Memory 1TB Storage Q2632
 *
 * ── WHY THE ENGINE COULD NOT ALREADY SEE THIS ──────────────────────────────
 *
 * It could, and it said so out loud. The existing rule fires at
 * `ratio < 0.6` and its own comment reads: *"That gap is the strongest deal
 * signal AND the strongest scam signal; they're the same observation."* True —
 * and then it returns VERIFY for both, which is right at 0.55 and useless at
 * 0.07. Nothing legitimate sells at seven percent of its comps. The gap alone
 * stops being ambiguous long before zero.
 *
 * ── THE TWO SIGNALS ARE INDEPENDENT, AND THAT IS THE POINT ─────────────────
 *
 * ⚠ **THE TOKEN ALONE IS NOT A VERDICT.** Yish was explicit: *"im not telling
 * you that if the part listing is in there than its a scam but be warry."* He
 * is right, and the data agrees — a Gigabyte card genuinely titled
 * `... 32G GV-N5090` ends in a part number and is a real listing at 0.59 of
 * market. So the token RAISES SUSPICION and only convicts alongside a price
 * that cannot be real.
 *
 * The price alone convicts below `IMPOSSIBLE`, because there is no story where
 * a working phone goes for a fifth of its own comps to a stranger.
 */

/** What the seller is asking, against what the item actually fetches. */
export interface ScamInput {
  title: string;
  askCents: number | null;
  /**
   * The LOCAL-channel market value, not the eBay median.
   *
   * Same basis the `ratio < 0.6` rule already uses, and for the same reason:
   * local prices sit systematically below eBay, so measuring against an eBay
   * median makes every honest Craigslist listing look like a scam.
   */
  marketCents: number | null;
}

export interface ScamSignal {
  code: "TITLE_SERIAL" | "PRICE_IMPOSSIBLE" | "PRICE_TOKEN";
  label: string;
  detail: string;
}

/**
 * Below this, a discount stops being a discount.
 *
 * Picked off the real distribution rather than by feel: on 2026-09-04 the
 * genuine listings with no token ran 0.46 to 0.92; every listing carrying a
 * token ran 0.03 to 0.44. The two populations do not overlap, so the pair rule
 * can sit at 0.50 without touching an honest listing — and it has to, because
 * two farm phones sat at 0.44 and the first draft missed both.
 */
export const IMPOSSIBLE_RATIO = 0.50;

/**
 * And below THIS, the token does not even need to agree.
 *
 * A tenth of market is not a bargain anyone is having. Kept separate from
 * `IMPOSSIBLE_RATIO` so the pair rule can stay conservative while an outright
 * absurd price still lands on its own.
 */
export const ABSURD_RATIO = 0.22;

/**
 * Uppercase runs that are ordinary product vocabulary, not identifiers.
 *
 * ⚠ THIS LIST IS WHAT KEEPS THE DETECTOR OFF REAL TITLES, because an enormous
 * number of them legitimately END on a short uppercase run: "RTX 4090 FE",
 * "24GB GDDR6", "1TB SSD", "Series X". Every one of those would otherwise read
 * as a serial.
 */
const VOCABULARY = new Set([
  "FE", "OC", "TI", "XT", "XTX", "SUPER", "PRO", "MAX", "PLUS", "AIR", "MINI",
  "SSD", "HDD", "NVME", "GDDR5", "GDDR6", "GDDR6X", "GDDR7", "DDR3", "DDR4", "DDR5",
  "RAM", "CPU", "GPU", "PSU", "LCD", "OLED", "LED", "QHD", "UHD", "HD", "FHD",
  "USB", "HDMI", "WIFI", "LTE", "NEW", "OBO", "USED", "MINT", "OEM", "SEALED",
  "UNLOCKED", "LOCKED", "GAMING", "LAPTOP", "DESKTOP", "TOWER", "SETUP", "PC",
  "X", "S", "XL", "SE", "M1", "M2", "M3", "M4", "M5", "I5", "I7", "I9",
  "WD", "HP", "MSI", "EVGA", "ASUS", "ACER", "DELL", "LG", "TV", "VR",
]);

/** `256GB`, `1TB`, `45L`, `16X` — a number with a unit is a spec, never a serial. */
const UNIT_SUFFIX = /^\d+(GB|TB|MB|G|T|W|L|X|HZ|MM|IN|K)$/;

/**
 * ⚠ INTEL AND AMD PART NUMBERS LOOK EXACTLY LIKE THE FARM TOKENS.
 *
 * `8565U`, `10700K`, `5800X`, `12700H` are four-to-five digits and a suffix,
 * which is the same shape. A real ThinkPad titled `... 7th Gen i7-8565U` was
 * caught by the first draft of this and survived only because its price was
 * honest — i.e. the detector was one cheap ThinkPad away from libelling a real
 * listing. Excluded explicitly rather than left to the price to rescue.
 */
const CPU_MODEL = /^\d{4,5}[A-Z]{1,3}$/;

/**
 * Colours and conditions that legitimately end a title in caps.
 *
 * The first draft tried to separate words from noise by looking for a vowel,
 * which is wrong in both directions: it let `SAQR` through as a word and would
 * have convicted `GRY`. A short explicit list is duller and actually correct —
 * these are the words that show up at the end of a phone title.
 */
const TRAILING_WORDS = new Set([
  "RED", "BLUE", "GOLD", "PINK", "GRAY", "GREY", "BLACK", "WHITE", "GREEN",
  "SILVER", "PURPLE", "MIDNIGHT", "STARLIGHT", "TITANIUM", "GRAPHITE", "SIERRA",
  "SPACE", "ROSE", "CORAL", "YELLOW", "ORANGE", "TEAL", "LAVENDER", "CREAM",
  "MINT", "GOOD", "FAIR", "CLEAN", "WORKS", "PARTS", "REPAIR", "FIRM", "CASH",
  "ONLY", "READ", "LOOK", "DEAL", "SALE", "TRADE", "FREE", "BOX", "BUNDLE",
]);

/**
 * Is the last word of the title an opaque identifier rather than a word or a
 * spec?
 *
 * Exported because the shape of this decision is the part most likely to need
 * tuning against new farms, and it should be testable without a price.
 */
export function trailingSerial(title: string): string | null {
  const cleaned = String(title ?? "").trim().replace(/[)\].,!*-]+$/, "");
  const last = cleaned.split(/\s+/).pop() ?? "";

  // Case matters: these farms emit SHOUTED tokens. A lowercase tail is prose.
  if (!/^[A-Z0-9]{4,6}$/.test(last)) return null;
  if (VOCABULARY.has(last)) return null;
  if (TRAILING_WORDS.has(last)) return null;
  if (UNIT_SUFFIX.test(last)) return null;
  if (CPU_MODEL.test(last)) return null;

  /**
   * ⚠ PURE DIGITS ARE MODEL NUMBERS, NOT SERIALS — "RTX 4090", "iPhone 6500",
   * "Latitude 5420". Excluding them costs nothing: every farm token observed
   * carried at least one letter.
   */
  if (/^\d+$/.test(last)) return null;

  return last;
}

/** Everything suspicious about a listing's price and title, with no verdict attached. */
export function scamSignals(input: ScamInput): ScamSignal[] {
  const out: ScamSignal[] = [];
  const serial = trailingSerial(input.title);
  if (serial) {
    out.push({
      code: "TITLE_SERIAL",
      label: "Title ends in a serial-looking code",
      detail: `"${serial}" reads like a per-listing tag rather than part of the product name. Sellers do not write these; bulk-posted listings use them so duplicates are not collapsed.`,
    });
  }

  const ratio = ratioOf(input);
  /**
   * ⚠ THIS SIGNAL USES `ABSURD`, NOT `IMPOSSIBLE`, AND THE DIFFERENCE IS NOT
   * PEDANTRY. `IMPOSSIBLE_RATIO` is 0.50, and 0.46 of market is a genuine HP
   * OMEN somebody wants gone this weekend. Printing "priced far below anything
   * real" on that listing is a false accusation shown to the user. The pair
   * rule may lean on 0.50 because the token is carrying the weight; a signal
   * that stands alone on screen has to clear a bar it can defend by itself.
   */
  if (ratio != null && ratio < ABSURD_RATIO) {
    out.push({
      code: "PRICE_IMPOSSIBLE",
      label: "Priced far below anything real",
      detail: `Asking ${Math.round(ratio * 100)}% of what it actually fetches. Real discounts do not reach here.`,
    });
  }

  if (serial && ratio != null && ratio < IMPOSSIBLE_RATIO) {
    out.push({
      code: "PRICE_TOKEN",
      label: "Both scam markers together",
      detail: "An impossible price AND a bulk-posting tag in the title. These co-occur on listing farms and almost nowhere else.",
    });
  }
  return out;
}

function ratioOf(input: ScamInput): number | null {
  const { askCents: ask, marketCents: market } = input;
  if (ask == null || market == null) return null;
  if (ask <= 0 || market <= 0) return null;
  return ask / market;
}

/**
 * Should this be called a scam outright rather than sent for verification?
 *
 * ⚠ RISK, NOT A SILENT DROP. Yish still wants to see these — he was marking
 * them by hand, which means he was looking at them — and a feed that quietly
 * deletes half its listings is one nobody can audit. RISK says "this is why",
 * and leaves the listing where he can disagree with it.
 */
export function isScamFarm(input: ScamInput): boolean {
  const ratio = ratioOf(input);
  if (ratio == null) return false;
  if (ratio < ABSURD_RATIO) return true;
  return ratio < IMPOSSIBLE_RATIO && trailingSerial(input.title) != null;
}

/** One line for the verdict headline. */
export function scamHeadline(input: ScamInput): string {
  const ratio = ratioOf(input);
  const pct = ratio == null ? "far" : `${Math.round(ratio * 100)}%`;
  return trailingSerial(input.title)
    ? `Almost certainly a scam: ${pct} of market and a bulk-posting tag in the title.`
    : `Almost certainly a scam: ${pct} of market.`;
}
