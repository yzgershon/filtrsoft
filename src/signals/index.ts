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
import { isAppleWholeUnit } from "./product-type.ts";
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
  /**
   * `laptop` MUST come before `prebuilt`. They are both whole machines, so the
   * "machines before their parts" ordering below does not apply between them —
   * and prebuilt's vocabulary swallows portable hardware.
   *
   * Measured on the live feed: **31 laptops were being priced as desktops.**
   * "Dell 5540 Windows 11 Mobile Workstations 8-Core i9", "Lenovo P50 Mobile
   * Workstation", "Dell Precision 7510 Workstation Laptop" all matched
   * `workstation` and were then asked which GPU they had, as though they were
   * towers. A mobile workstation is a laptop.
   */
  ["laptop",   /\b(laptop|macbook|thinkpad|latitude|xps|notebook|chromebook|inspiron|precision|elitebook|pavilion|mobile workstations?|workstation laptops?)\b/i],
  /**
   * `all-in-one` is printer vocabulary too, and the printers won.
   * "PRINTER HP ENVY 6055E---Wireless All In One" was classified as a prebuilt
   * PC and asked for its GPU and CPU. Requiring a computer word nearby, and
   * excluding an explicit printer, keeps the iMac-style listings it was added
   * for. `workstation` now requires it NOT be a mobile one.
   */
  ["prebuilt", /\b(gaming (pc|desktop|computer)|desktop (pc|computer)|prebuilt|imac|mac (mini|studio|pro)|tower)\b|\ball[- ]in[- ]one\b(?=.*\b(pc|computer|desktop|imac)\b)|(?<!mobile )\bworkstation\b/i],
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
  // "core i7" with NO part number is the common form on a Mac spec screen
  // ("Intel Core i7 2.6 GHz 6-Core") and in many listings. Requiring a full
  // part number meant vision could read the CPU straight off a photo and the
  // verdict would still say "cpu not stated" — paying for vision, then
  // ignoring it. Found 2026-08-24 on listing 338.
  /**
   * A BARE "i7" IS A STATED CPU. Requiring "core i7" or a part number meant
   * "Lenovo P50 Mobile Workstation. Windows 10 Pro, i7, 32GB RAM" came back
   * "cpu not stated" with the CPU sitting in the middle of the title.
   *
   * It is a weak spec — an i7 spans a decade of silicon — but the field asks
   * whether the seller SAID it, and they did. Refusing to price something the
   * seller told us is worse than pricing it with a wide band, which is what the
   * comp spread already expresses.
   */
  laptop:   [["cpu", /\bi[3579]\b|\b(i[3579][- ]\d{4,5}[a-z0-9]*|ryzen \d|m[1-9]\b|celeron|core ultra|snapdragon|mediatek|exynos)/i],
             ["ram", /\b\d{1,3}\s?gb\b/i]],
  gpu:      [["model", /\b(rtx|gtx|rx|tesla|quadro)\s?[a-z]?\d{3,4}/i]],
  prebuilt: [["gpu", /\b(rtx|gtx|rx)\s?\d{3,4}|\b(integrated|igpu|iris|radeon graphics)\b/i],
             // Same reasoning as laptop above: a bare i7 is a stated CPU.
             ["cpu", /\bi[3579]\b|\b(i[3579][- ]\d{4,5}[a-z0-9]*|ryzen \d|m[1-9]\b|core ultra|xeon|threadripper)/i]],
  console:  [["storage", /\b(\d{3,4}\s?gb|\d{1,2}\s?tb)\b/i]],
  tablet:   [["storage", /\b(\d{1,4})\s?(gb|tb)\b/i]],
};

/**
 * Payment rails with no recall. **Crypto was missing and it is the worst one.**
 *
 * Found 2026-08-25 on a live listing Yish wanted to buy: a $2,500 RTX 5090
 * (59% of market) whose Craigslist attributes read *"cryptocurrency ok"* and
 * *"delivery available"*. The engine returned **zero flags**. A crypto payment
 * is not merely irreversible like Zelle — it is untraceable and off-platform,
 * which is why it is the rail of choice for exactly this scam.
 *
 * Craigslist prints the attribute as the literal phrase "cryptocurrency ok",
 * so that form is matched directly rather than relying on the word appearing
 * in prose.
 */
const IRREVERSIBLE_RAILS =
  /\b(friends\s*(and|&)\s*family|f\s*&\s*f|cash\s?app|cashapp|zelle|venmo|gift ?card|wire transfer|western union|apple ?pay only|crypto(currency)?( ok)?|bitcoin|btc|usdt|ethereum)\b/i;

/**
 * A LOCAL listing offering to SHIP is the classic remote-seller pattern.
 *
 * Craigslist and Facebook Marketplace are pickup markets. A private seller
 * offering flat-rate shipping on a four-figure GPU is either a business — rare
 * on Craigslist and usually stated — or the item is not where the post says it
 * is, and the local town name is there purely to make the deal look reachable.
 *
 * On its own this is worth a flag, not a veto: some genuine sellers ship. Next
 * to crypto and a price far below market it is the whole scam in one post.
 */
const SHIPS_ON_LOCAL_MARKET =
  /\b(flat[- ]rate shipping|shipping (is )?(available|included|only)|will ship|can ship|ships? (nationwide|anywhere|to you)|delivery available|i deliver)\b/i;

/**
 * COUNTERFEITS. The seller usually says so, and Assyze was not listening.
 *
 * Live on assyze.com: *"Apple iPhone 15 Pro Max 1TB **CLONE** Unlocked"* at $99
 * came back **VERIFY with $433 of net profit**, because the matcher resolved it
 * to a real 1TB Pro Max and priced it against real comps. The word "CLONE" was
 * in the title in capitals.
 *
 * This is not a discount, it is a different object. A clone has no resale
 * value at any price — you cannot flip it, and listing one yourself is fraud.
 * So it is a BLOCKER rather than a risk flag: there is no asking price at which
 * the answer changes, which is exactly what separates a blocker from a discount.
 *
 * `1:1`, `AAA` and "master copy" are the replica-trade's own vocabulary.
 * "Goophone" is a specific line of iPhone clones. `refurbished` and `aftermarket
 * battery` are NOT here — a repaired real phone is a real phone.
 */
const COUNTERFEIT =
  /\b(clone|replica|counterfeit|knock ?off|fake|goophone|1:1 (copy|version)|master copy|aaa\+? (quality|grade)|not (a )?(genuine|original|real) (apple|samsung|iphone)|mirror (copy|grade))\b/i;

const SPEC_SHEET_LANGUAGE =
  /\b(designed for professionals|features include|is a high-performance|delivers (up to|exceptional)|engineered (for|to)|ideal for (creators|professionals))\b/i;

const LOW_KNOWLEDGE =
  /\b(works good|works great|runs good|found in storage|was my (son|daughter|husband|wife)'?s?|cleaning out|moving must go|no longer needed|dont know much|not sure what)\b/i;

const HIGH_KNOWLEDGE =
  /\b(never mined|no mining|battery health|clean imei|paid off|no financing|off[- ]lease|passed diagnostics|cycle count|original box|comps?|retail|below ebay)\b/i;

/**
 * THE TITLE DECIDES THE CATEGORY. The description only breaks ties.
 *
 * Running the patterns over title + description let a seller's PROSE outvote
 * what they were actually selling. Live on assyze.com, 2026-08-26:
 *
 *   "NVIDIA GeForce RTX 4090 Founders Edition 24GB GDDR6X Graphics Card"
 *   -> category `prebuilt` -> "Can't be valued — cpu not stated."
 *
 * The seller had pasted NVIDIA's own marketing copy into the description
 * ("ultra-high performance gaming", "gamers and creators", "productivity"),
 * which trips the prebuilt pattern. So Assyze asked which CPU a graphics card
 * has. The title says "Graphics Card" in plain English.
 *
 * A title is what someone is selling; a description is what they say about it.
 * Falling back to the full text only when the title is genuinely unclassifiable
 * keeps the recall the combined pass was there for.
 */
function detectCategory(title: string, description = ""): Category {
  for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(title)) return cat;
  if (!description) return "unknown";
  for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(`${title}\n${description}`)) return cat;
  return "unknown";
}

/**
 * `visionText` is what the photos revealed. It is kept SEPARATE from the listing
 * text on purpose:
 *   - it CAN satisfy a missing value field (the spec exists, just not in words)
 *   - it must NOT inflate listingQuality or sellerSophistication, which measure
 *     what the SELLER chose to tell you — and a seller who didn't write the specs
 *     is exactly the low-knowledge case that tends to underprice (RISK-MODEL 3.5)
 */
export function analyze(l: RawListing, opts?: { clusterSize?: number; visionText?: string }): SignalReport {
  /**
   * ATTRIBUTES ARE PART OF THE LISTING TEXT, and leaving them out cost us the
   * single best signal on a live scam.
   *
   * Craigslist states "cryptocurrency ok" and "delivery available" as
   * STRUCTURED attributes, not prose. Reading only title + description threw
   * both away, so a $2,500 RTX 5090 at 59% of market — crypto accepted,
   * shipping offered, Nonantum — came back with zero flags. The seller told us
   * exactly what they were; we just were not listening.
   *
   * Included as `key value` so a bare flag reads as "cryptocurrency ok yes"
   * and a real pair as "condition like new".
   */
  const attrText = Object.entries(l.attributes ?? {})
    .map(([k, v]) => `${k} ${v}`)
    .join("\n");
  const text = `${l.title}\n${l.description}\n${attrText}`;
  const t = text.toLowerCase();
  const signals: Signal[] = [];
  const category = detectCategory(l.title, l.description ?? "");

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
  /**
   * An Apple machine's value-determining fields are its MODEL and YEAR, not a
   * GPU and CPU it will never name. Demanding those returned INSUFFICIENT_DATA
   * on every iMac and Mac mini ever crawled.
   */
  const appleWhole = isAppleWholeUnit(text);
  const recoveredFromPhotos: string[] = [];
  for (const [field, re] of VALUE_FIELDS[category] ?? []) {
    if (appleWhole && (field === "gpu" || field === "cpu")) continue;
    if (re.test(text)) continue;
    if (opts?.visionText && re.test(opts.visionText)) { recoveredFromPhotos.push(field); continue; }
    missingValueFields.push(field);
  }
  if (missingValueFields.length) {
    signals.push({
      code: "MISSING_VALUE_FIELDS", severity: "high", polarity: "neutral",
      evidence: `Missing the field(s) that most determine value: ${missingValueFields.join(", ")}. Not in the description and not readable in the photos.`,
    });
  }
  if (recoveredFromPhotos.length) {
    signals.push({
      code: "SPECS_ONLY_IN_PHOTOS", severity: "info", polarity: "positive",
      evidence: `${recoveredFromPhotos.join(" and ")} readable in the photos but never written in the description. The seller didn't put the value-determining spec in words — that's the low-knowledge pattern that tends to underprice, and it means most buyers scrolling past never saw it.`,
    });
  }

  /**
   * Counterfeit, stated by the seller. A blocker, not a discount — see
   * `COUNTERFEIT`. Title only: a description saying "not a clone" or "beware of
   * clones on here" is the seller distinguishing themselves FROM one, and
   * reading that as a confession would punish the honest listing.
   */
  if (COUNTERFEIT.test(l.title)) {
    signals.push({
      code: "COUNTERFEIT", severity: "blocker", polarity: "negative",
      evidence: `The listing says "${l.title.match(COUNTERFEIT)?.[0]}". That is a counterfeit, not a cheap genuine unit — it has no resale value at any price, and reselling one is fraud. There is no asking price that makes this a deal.`,
    });
  }

  // ------------------------------------------------- payment rails (3k)
  if (IRREVERSIBLE_RAILS.test(text)) {
    signals.push({
      code: "IRREVERSIBLE_PAYMENT", severity: "high", polarity: "negative",
      evidence: `Seller offers an irreversible payment rail (${text.match(IRREVERSIBLE_RAILS)?.[0]}). These strip buyer protection. Insist on cash in person; if they push back, walk.`,
    });
  }

  /**
   * Shipping offered on a pickup market, on something worth stealing.
   *
   * Gated on price because a $30 keyboard shipping is unremarkable and a
   * $2,500 GPU shipping is the whole scam. $400 is roughly where "post it and
   * hope" stops being worth a scammer's time.
   */
  if (
    SHIPS_ON_LOCAL_MARKET.test(text) &&
    (l.askingPriceCents ?? 0) >= 40000
  ) {
    signals.push({
      code: "SHIPS_ON_LOCAL_MARKET", severity: "high", polarity: "negative",
      evidence: `A local pickup listing offering to ship ("${text.match(SHIPS_ON_LOCAL_MARKET)?.[0]}") on a ${l.askingPriceCents ? `$${Math.round(l.askingPriceCents / 100).toLocaleString()}` : "high-value"} item. Craigslist and Marketplace are pickup markets; the usual reason to offer shipping is that the item is not where the post says it is. Insist on seeing it in person at the stated location before any money moves.`,
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
