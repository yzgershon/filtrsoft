import type {DecisionProvenance} from "../engine/provenance.ts";
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
import { valueSku, valueByParts, valueWholeBuild, netByChannel, requiredProfitCents, getEconomics, type UserEconomics, type ChannelResult, type PriceBasis } from "../valuation/index.ts";
import { normalizeCondition, type Condition } from "../valuation/condition.ts";
import { resolveProductType, isAppleWholeUnit, isUnsupportedPrinter } from "../signals/product-type.ts";
import { evaluateRisk, riskGate, type RiskCheck, type RiskGate } from "./risk-gates.ts";
import { latestRetail, retailMeaning, type RetailPrice } from "../sources/retail.ts";
import { boardTier } from "../signals/board-tier.ts";
import type { VisionResult } from "../vision/index.ts";
import { isScamFarm, scamSignals, scamHeadline } from "./scam.ts";
import { listingInventory } from "../signals/listing-offers.ts";
import { valueInventory, type PricedOffer } from "../valuation/inventory.ts";

const OUT_OF_SCOPE = /\b(lens|dslr|mirrorless|camera body|tripod|nikon|canon ef|sigma \d|tamron|zeiss|leica|scanner|camcorder)\b/i;

/**
 * Tech Filtrsoft does not trade. Not junk — just not Yish's market.
 *
 * Diagnosing the 259 INSUFFICIENT_DATA verdicts on the live feed, **46 were
 * monitors, TVs, routers, network switches and bare hard drives.** They are
 * genuinely tech, so `resolveProductType` correctly called them tech and they
 * fell through to "Couldn't identify the exact model" — which reads as a
 * failure when the honest answer is that a 24" Asus monitor is not something
 * Filtrsoft covers. It never will be: there are no comps for it because nobody
 * ever asked for any.
 *
 * Saying so plainly is better than implying we tried and failed. It also stops
 * them competing for space in a deals feed.
 */
const NOT_OUR_MARKET =
  /\b(monitor|display|smart ?tv|television|\d{2}" ?(class )?(tv|led|lcd|oled)\b|router|modem|access point|network switch|ethernet switch|gigabit switch|printer|projector|scanner|hard drive|external drive|nas\b|keyboard|webcam|speakers?|soundbar|headphones?)\b/i;

/**
 * Words that settle it NO MATTER what the head noun is.
 *
 * `NOT_OUR_MARKET` above is head-noun-gated on purpose, so "iMac ... keyboard
 * and mouse" is not thrown away as keyboard gear. But that gating also let two
 * things through:
 *
 *   "DELL Poweredge R900 SERVER computer PC"   head is "pc", so the title was
 *                                              never consulted
 *   "Cisco SG220-26 26-Port Gigabit Smart Switch"  no head noun at all
 *
 * A rack server IS a computer, which is exactly why the head noun cannot save
 * us here — it is a computer nobody in this market buys. These words never
 * appear as a bundled accessory on something we would price, so they are
 * decisive on the raw title.
 */
/**
 * ⚠ THE HOME-AUDIO WORDS WERE ADDED 2026-09-03, AND THEY ARE HERE — ON THE RAW
 * TITLE — BECAUSE HEAD-NOUN GATING DEMONSTRABLY DOES NOT WORK FOR THEM.
 *
 * Measured on the live feed while diagnosing Yish's *"all the listings that
 * have come in passively have been cant tells"*: the engine was demanding
 * computer specs from things that have none.
 *
 *     "Ion USB Turntable ... Converter To PC"   -> "gpu and cpu not stated"
 *     "Sony stereo cassette tape deck TC-WE475" -> "cpu and ram not stated"
 *
 * The first attempt put them in a head-noun-gated list. `resolveProductType`
 * returns **"pc"** for the turntable — its title ends "To PC" — and **null**
 * for the cassette deck, so both sailed straight through. Only the raw title
 * ever sees the word that decides.
 *
 * ⚠ WHICH IS ALSO WHY THIS LIST STOPS WHERE IT DOES. `booster`, `antenna`,
 * `mount`, `stereo` and `receiver` were each tried and are deliberately NOT
 * here: every one can legitimately appear in a computer listing's title
 * ("Gaming PC, WiFi antenna included"), and on a raw title that deletes a real
 * machine. **A word earns a place here only if it could never appear inside a
 * listing for something we would price** — a turntable never turns up in a PC
 * ad, a WiFi antenna does.
 */
const NEVER_OUR_MARKET =
  /\b(server|poweredge|proliant|rack ?mount(ed)?|blade server|kvm|(smart|network|ethernet|gigabit|managed|poe)[- ]?switch|switch[- ]?\d{1,2}[- ]?port|\d{1,2}[- ]port|turntable|record player|cassette|tape deck|vcr|subwoofer|amplifier|boombox)\b/i;

/**
 * ⚠ GAME CONSOLES ARE OUT ENTIRELY. Yish, 2026-09-04: *"get rid of all the
 * consoles on the app they are hard to resell. I dont want ANY consoles on it."*
 *
 * His call, and the data agreed before he made it: **110 of the 362 listings
 * blocked on "storage not stated" were consoles**, and they were the single
 * largest thing the engine kept asking questions about. A category he will not
 * buy costs the same crawl budget, description pass and photo read as one he
 * will.
 *
 * ⚠ THIS TAKES GAMES AND CONTROLLERS WITH IT, AND THAT IS INTENDED. Matching
 * the platform word means "Call of Duty ... Xbox 360" and "PS5 DualSense
 * controller" go too. They are the same market and worth less; the Mercari
 * crawl that finally worked came back mostly Xbox 360 discs.
 *
 * ⚠ VR IS DELIBERATELY NOT HERE. A Quest is a headset, not a console, and he
 * named consoles. If Quest and Vive should go too it is one word each — but
 * that is his call to make, not one to slip in under a rule about consoles.
 *
 * Raw title, like the rest of this list, and for the same reason: head-noun
 * gating cannot see the word that decides. "Xbox Series X Construction
 * Simulator" resolves to no head noun at all.
 */
const CONSOLES =
  /\b(xbox|playstation|\bps[2345]\b|nintendo|game ?cube|gamecube|\bwii\b|wii ?u|switch (oled|lite|console)|nintendo switch|steam ?deck|sega|dreamcast|atari|game ?boy|nintendo ?ds|\b3ds\b|\bpsp\b|ps vita)\b/i;

/**
 * Bulk and multi-item listings. "24 Computers, Printers, Monitors left starting
 * at just $30" is a shop's inventory dump, not a unit with a price, and pricing
 * it against one machine's comps is meaningless.
 */
const BULK_LISTING =
  /\b(\d{2,}\s+(computers|laptops|monitors|printers|phones)|lot of \d|wholesale|bulk|liquidation|starting at (just )?\$|do you need a|second one|another one)\b|\b(laptops|computers|desktops|phones|monitors|tablets)\b[^.]{0,20}\bfor sale\b|\bmultiple\s+(laptops|computers|phones)\b/i;

/**
 * A RESELLER'S INVENTORY AD — a bulk listing wearing a model number.
 *
 * These were the largest single group inside "couldn't identify the model".
 * The engine was trying to price a shop's whole stock as one machine and
 * honestly reporting that it could not. "Can't tell" is the wrong answer:
 * there is nothing to tell, because there is no unit.
 *
 * Three independent tells, any one of which is enough:
 *
 *   · **"up to"** — "8-Core i9, UP TO 64GB RAM" describes a RANGE of machines.
 *     A single laptop has an amount of RAM, not a ceiling. Strongest signal,
 *     and the one most of these share.
 *   · **Retail-event language** — "Spring Laptop Blowout Sale!", "Holiday
 *     Laptop Deals!", "Back To School!". Private sellers do not run seasonal
 *     promotions on the one laptop they own.
 *   · **A PLURAL product noun** — "Mobile Workstations", "Touchscreens".
 *     `\blaptop\b` famously does not match "laptops" (already a trap in this
 *     file); here the plural is exactly the thing worth matching on.
 *
 * Deliberately NOT matching on "i7, SSD, Windows 11" spec soup — a genuine
 * private listing reads the same way, and using it would delete real inventory.
 */
const RESELLER_AD =
  /\bup to \d+\s?(gb|tb)\b|\b(blowout|clearance)\b|\b(spring|summer|fall|winter|holiday|back to school)\b[^.]{0,24}\b(sale|deals?|special)\b|\b(laptop|computer|desktop|pc)\s+(deals?|blowout|sale)\b|\b(laptops|desktops|workstations|tablets|ultrabooks|chromebooks|touchscreens)\b|\b\d+\s+units?\b/i;

/**
 * ⚠ `best.channel` IS AN INTERNAL ID AND MUST NEVER BE PRINTED.
 *
 * Yish, 2026-08-30: *"it will say $625 net on facebook when it says on facebook
 * because I don't just buy or sell from facebook."* He is right and the bug is
 * ours, not his reading of it. The `facebook` channel does not mean Facebook
 * Marketplace: it means A LOCAL CASH SALE, no fees and no postage, which is
 * equally Craigslist, OfferUp, or a stranger in a parking lot. Naming one
 * marketplace states a fact about the world that is not true.
 *
 * `ebay` genuinely does mean eBay, because the fee and shipping arithmetic
 * behind it is eBay's.
 *
 * Two forms because English needs both: "nets $625 SELLING LOCALLY" and
 * "$625 net ON EBAY" do not take the same preposition.
 */
const CHANNEL_NAME: Record<string, string> = { facebook: "locally", ebay: "on eBay" };
const CHANNEL_VERB: Record<string, string> = {
  facebook: "selling it locally", ebay: "selling it on eBay",
};
const channelName = (c: string) => CHANNEL_NAME[c] ?? "locally";
const channelVerb = (c: string) => CHANNEL_VERB[c] ?? "selling it locally";

/** Reader-facing retailer names. "microcenter" is not how anyone says it. */
const RETAILER_NAME: Record<string, string> = {
  bestbuy: "Best Buy",
  newegg: "Newegg",
  microcenter: "Micro Center (Cambridge)",
};

export interface VerdictResult {
  provenance?:DecisionProvenance;
  inventory?: { sellerContext: string; offers: PricedOffer[] };
  call: Verdict;
  confidence: Confidence;
  headline: string;
  reasoning: string;
  decidingUnknown?: string;
  targetOfferCents?: number;
  valuation: ReturnType<typeof valueSku>;
  bestChannel?: ChannelResult;
  /**
   * BOTH channels, so the detail screen can offer a local/eBay switch instead
   * of quietly picking one. Yish sells locally and the eBay breakdown was being
   * presented as though it were the only arithmetic — a $183 fee and $15 of
   * shipping on a machine he hands over in a parking lot.
   *
   * For a local-only category there is exactly one usable channel and the UI
   * shows no switch at all.
   */
  channels?: ChannelResult[];
  netProfitCents?: number;
  requiredProfitCents?: number;
  blockers: string[];
  /** Copy-pasteable, ordered so the first "no" that matters comes first. */
  questions: string[];
  /**
   * Per-category hard-blocker state. Persisted and shown, so a VERIFY can say
   * WHICH check is open rather than being an unexplained refusal.
   */
  riskChecks: RiskCheck[];
  /**
   * What Best Buy charges for the same thing NEW, when we know. Carried on the
   * result even when it changes nothing, because "used at 88% of new" is the
   * kind of context a buyer wants to see stated rather than inferred.
   */
  retail?: RetailPrice | null;
}

/**
 * Unresolved checks lead, because they are what blocks a BUY.
 *
 * **CAPPED AT TWO, like everything else on this screen.** This used to return
 * the full union, so a verdict that already had two well-chosen questions came
 * out with six — the exact pile Yish asked to be cut. `gate.unresolved` is
 * remote-only by construction, so nothing here can ask for something that can
 * only be seen in person.
 */
function gateQuestions(gate: RiskGate, existing: string[]): string[] {
  const first = [...gate.failed, ...gate.unresolved].map((c) => c.question);
  return [...new Set([...first, ...existing])].slice(0, 2);
}

/** Named on a BUY, so a clean verdict shows its work rather than staying silent. */
function riskCleared(gate: RiskGate): string {
  return " Every hard blocker for this category is resolved in the listing.";
}

export function buildVerdict(input: {
  title: string;
  description: string;
  askingPriceCents: number | null;
  signals: SignalReport;
  match: Match;
  driveMinutes?: number;
  econ?: UserEconomics;
  /** Flattened vision text, so photo-read specs feed the risk checks too. */
  visionText?: string;
  vision?: VisionResult | null;
}): VerdictResult {
  const { signals, match } = input;
  const inventory = listingInventory(input.title, input.description, input.askingPriceCents);
  const econ = input.econ ?? getEconomics();
  const drive = input.driveMinutes ?? 15;
  const blockers = signals.signals.filter((s) => s.severity === "blocker").map((s) => s.evidence);
  /**
   * A custom build has no SKU — decompose and price the parts instead.
   *
   * APPLE IS THE EXCEPTION and it is not a special case so much as a different
   * market: an iMac is bought and sold as "2019 27-inch 5K", its GPU is
   * soldered, and nobody parts one out. Sending it down the bundle path made
   * the engine demand a GPU and CPU the listing will never state.
   */
  const isApple = isAppleWholeUnit(`${input.title} ${input.description}`);
  const isBundle = (match.category ?? signals.category) === "prebuilt" && !isApple;
  /**
   * WHOLE-MACHINE COMPS BEAT A PARTS SUM, ALWAYS, WHEN THEY EXIST.
   *
   * Summing parts requires two guesses — what fraction of the value we managed
   * to price, and what an assembled machine fetches relative to its components.
   * A comp for an actual RTX 5070 tower requires neither. On the NZXT build the
   * parts path said $890 and real whole-machine sales say $1,375.
   *
   * Parts remain the fallback for builds with no whole-machine comps, and for
   * deciding whether parting OUT beats selling whole — which is the actual flip.
   */
  const wholeVal = isBundle ? valueWholeBuild(match.attributes, "used") : null;
  const partsVal = isBundle ? valueByParts(match.attributes) : null;
  /**
   * A low-confidence match must never price anything. Defence in depth behind
   * the discriminating-token rule in `matchSku`: if a fuzzy match ever does slip
   * through to the wrong generation again, the worst outcome is
   * INSUFFICIENT_DATA rather than a confident number computed from another
   * product's comps. "Reliability over coverage" — missing a deal costs nothing,
   * quoting a 2019 Intel MacBook at M3 prices ends the brand.
   */
  /**
   * The listing's own condition decides what the comps are restated INTO.
   *
   * Vision's `physicalDamage` outranks the seller's adjective: a listing that
   * says "mint" while the photos show a cracked screen is a for-parts item that
   * has been described optimistically, and pricing it as `used` is exactly the
   * fake-BUY this engine exists to avoid.
   */
  const claimed = normalizeCondition(String(match.attributes.condition ?? "")) ?? "used";
  const damaged = signals.signals.some(
    (s) => s.code === "PHYSICAL_DAMAGE" || s.code === "PORT_DAMAGE",
  );
  const condition: Condition = damaged && claimed !== "for_parts" ? "used" : claimed;

  /**
   * The listing's own board tier, read from its title.
   *
   * Not a SKU attribute — the SKU is the CHIP, and which board partner built
   * the card is a fact about this listing. Same relationship storage has to a
   * phone model.
   */
  // "Dual" USB ports and "gaming" laptop copy are not GPU board identities.
  const tier = (match.category ?? signals.category)==="gpu" ? boardTier(`${input.title} ${input.description}`) : null;

  const skuVal = valueSku(match.confidence === "low" ? null : match.skuId, {
    condition,
    category: match.category ?? signals.category,
    // Storage tier reprices a SKU on its own — a 1TB phone is not a 256GB one.
    attributes: match.attributes,
    // And so does board tier on a GPU: $796-$1,670 for one RTX 5070 die.
    boardTier: tier,
  });
  const valuation =
    wholeVal ??
    (partsVal && (skuVal.status === "no_comps" || partsVal.compCount > skuVal.compCount)
      ? partsVal
      : skuVal);

  /**
   * Category risk state, computed from the listing text AND the photos.
   *
   * Vision matters here more than anywhere else: a device photographed only on
   * a boot screen proves power and rules out nothing, which is exactly what a
   * seller of a locked phone photographs.
   */
  const riskChecks = evaluateRisk(
    match.category ?? signals.category,
    `${input.title}\n${input.description}\n${input.visionText ?? ""}`,
    input.vision ?? null,
  );
  const gate = riskGate(riskChecks);

  /**
   * Questions are built AFTER the risk checks, not before, so the two we pick
   * can include a remote blocker — the highest-value thing a single message can
   * settle. Built before, `buildQuestions` could not see them and the gate had
   * to prepend its own on top, which is how the list reached seven.
   */
  const questions = buildQuestions(signals, match, { riskChecks });

  /**
   * New retail for the same SKU — the only number in this function that is not
   * derived from our own comps, which is exactly what makes it worth carrying.
   *
   * Stale prices are dropped rather than used. Retail moves; last year's launch
   * price would cap nothing and flag nothing, and a wrong ceiling is worse than
   * an absent one because it looks authoritative.
   */
  const retailRow = latestRetail(
    match.skuId ?? null,
    // The LISTING's capacity, the same field `valueSku` uses to pick a comp
    // tier. Without it a 128GB shelf price would cap a 512GB device.
    Number(match.attributes.storage_gb ?? match.attributes.storage_tier) || null,
    // And its board tier, so an ASUS TUF is capped by a TUF rather than by the
    // cheapest PNY on the page. Measured 1.40x new between the two.
    tier,
  );
  const retail = retailRow && !retailRow.stale ? retailRow : null;

  const categoryBlockers = gate.failed.map(
    (c) => `${c.label}: ${c.evidence ?? "disclosed in the listing"}`,
  );
  const base = {
    valuation,
    blockers: [...blockers, ...categoryBlockers],
    questions,
    riskChecks,
    retail,
  };

  /**
   * --- 0. Counterfeit. Checked FIRST, before anything can price it. ------
   *
   * An "iPhone 15 Pro Max 1TB CLONE" at $99 read as VERIFY with $433 of net
   * profit, because every layer downstream did its job correctly on the
   * assumption that the thing was real: the matcher resolved a genuine SKU, the
   * comps were genuine 1TB comps, and the margin was genuinely enormous.
   *
   * Nothing later in this function can undo that, because the whole rest of the
   * file reasons about price. A counterfeit is not mispriced — it is a
   * different object, worth nothing to resell at any price. So it has to be
   * settled before valuation, in the same position as out-of-scope.
   */
  const counterfeit = signals.signals.find((s) => s.code === "COUNTERFEIT");
  if (counterfeit) {
    return {
      ...base, call: "PASS", confidence: "high",
      headline: "Counterfeit. Not a deal at any price.",
      reasoning: counterfeit.evidence,
    };
  }

  /**
   * ⚠⚠ THE OFF-PLATFORM REDIRECT, SETTLED BEFORE PRICING — same position and
   * same reasoning as counterfeit, because there is no item to price.
   *
   * Confirmed live by Yish, 2026-08-28: he messaged two listings this feed was
   * RECOMMENDING, both replied instantly with a link to an outside "store", and
   * Facebook's own banner said the seller was likely in another country. The
   * $85 MacBook Air M2 had been reported as **VERIFY with $416 of net profit**.
   *
   * Surfacing a scam as an opportunity is the worst thing this product can do —
   * worse than missing a deal, because it spends the user's trust and their
   * money. It returns RISK rather than PASS: PASS reads "priced too high", and
   * this needs to read "do not engage".
   */
  const redirect = signals.signals.find((s) => s.code === "OFF_PLATFORM_REDIRECT");
  if (redirect) {
    return {
      ...base, call: "RISK", confidence: "high",
      headline: "Scam. The listing sends you off-platform.",
      reasoning: redirect.evidence,
      questions: [],
    };
  }

  // --- 1. Out of scope -------------------------------------------------
  // The title says what is being sold. Descriptions routinely mention trade
  // interests ("looking for a Nikon scanner") that are not the listed item.
  if (OUT_OF_SCOPE.test(input.title)) {
    return {
      ...base, call: "OUT_OF_SCOPE", confidence: "high",
      headline: "Not a category Filtrsoft judges.",
      reasoning: "Camera and photo gear is deliberately out of scope. Valuation is fine there, but the risk layer (fungus, element separation, focus motor wear, mount play) needs domain knowledge we don't have, and a category we can't audit is one we could be wrong about indefinitely.",
    };
  }

  if (isUnsupportedPrinter(input.title)) {
    return {
      ...base, call: "OUT_OF_SCOPE", confidence: "high",
      headline: "Not a category Filtrsoft covers.",
      reasoning: "That is printer gear. Filtrsoft does not have the failure-mode expertise or resale market depth to judge it reliably.",
    };
  }

  /**
   * Is the thing being sold even a piece of tech?
   *
   * A "gaming pc" search returns computer desks, computer chairs and laptop
   * carrying cases, because those listings genuinely contain the word computer.
   * `resolveProductType` decides by grammar — the head noun of the title — so
   * "computer desk" is a desk no matter how much tech vocabulary precedes it.
   */
  const product = resolveProductType(input.title, input.description);
  if (product.kind === "furniture" || product.kind === "accessory") {
    return {
      ...base, call: "OUT_OF_SCOPE", confidence: "high",
      headline: product.kind === "furniture"
        ? `That's furniture, not tech.`
        : `That's an accessory, not the device.`,
      reasoning: `Filtrsoft only judges tech. ${product.reason}.`,
    };
  }

  /**
   * `unknown` IS OUT OF SCOPE, and treating it as INSUFFICIENT_DATA was a bug
   * with a user-visible cost.
   *
   * An **autographed Aaron Rodgers jersey** reached the live deals feed reading
   * *"Couldn't identify the exact model"* — which is both wrong and faintly
   * ridiculous. A jersey has no model. Saying we could not identify one implies
   * we tried and failed at something worth trying.
   *
   * `unknown` is narrower than it sounds: `resolveProductType` returns `tech`
   * whenever the title carries anything model-ID-shaped, so `unknown` means no
   * recognisable product noun AND nothing that looks like a model number.
   * Measured over 400 stored listings it catches 90 — jerseys, trading cards,
   * book stands, messenger bags, ink cartridges — and the tech it declines
   * (webcams, cable locks, keyboards) was returning INSUFFICIENT_DATA anyway.
   * "Not something Filtrsoft covers" is the honest version of that answer.
   */
  /**
   * Real tech, wrong market — checked BEFORE the SKU lookup, because the
   * failure to find a SKU is the expected outcome, not a problem to report.
   */
  /**
   * ⚠ THE HEAD NOUN DECIDES, NOT A SUBSTRING MATCH.
   *
   * `NOT_OUR_MARKET` used to run straight over the raw title, so ANY mention
   * of a peripheral rejected the whole listing. "iMac 21.5, i5, 8gb, 1tb,
   * Catalina OS, keyboard and mouse" came back as OUT_OF_SCOPE with the
   * reasoning "that reads as keyboard gear" — a computer thrown away because
   * the seller listed what came in the box.
   *
   * That is not an edge case. "Comes with keyboard and mouse", "includes
   * monitor", "with headset" are among the most common things a Craigslist
   * computer listing says, and every one of them was being discarded.
   *
   * `resolveProductType` already solves this properly — it finds the HEAD noun
   * and reports `bundle listing led by "imac"`. The verdict layer simply was
   * not asking it. Now the regex only gets to reject when the head noun really
   * is an accessory, which is the same lesson as the `\blaptop\b` vs "laptops"
   * bug already recorded in this file.
   */
  /**
   * ⚠ THE HEAD NOUN DECIDES **WHEN THERE IS ONE**. Otherwise fall back to the
   * title.
   *
   * Testing `head.head` alone was a regression I introduced fixing the
   * iMac-plus-keyboard case. `resolveProductType` returns `head: null` for a
   * title with no recognised product noun — "AC1900 Wireless Dual Band Gigabit
   * Router", "Cisco SG220-26 26-Port Gigabit Smart Switch" — so the regex was
   * being run against the string "null" and every router and switch fell
   * through to "couldn't identify the exact model". They went from being
   * correctly out of scope to looking like an engine failure.
   *
   * Both halves are needed and neither alone is right:
   *   · a KNOWN head noun beats the title, so "iMac ... keyboard and mouse"
   *     stays a computer rather than becoming keyboard gear;
   *   · a MISSING head noun means the title's own words are the only evidence
   *     there is.
   */
  const head = resolveProductType(input.title, input.description ?? "");
  /**
   * ⚠ CHECKED BEFORE THE RULE BELOW AND *NOT* GATED ON `!match.skuId`.
   *
   * That gate is right for the rest of the list — a matched SKU is evidence we
   * do cover the thing — and it is exactly wrong here. **Consoles are in the
   * catalog**, with comps and a `console` entry in `VALUE_FIELDS`, so an
   * "Xbox Series X" matches a SKU and would sail straight past a rule written
   * to exclude it. Being well-known is not the same as being wanted.
   */
  if (CONSOLES.test(input.title)) {
    return {
      ...base, call: "OUT_OF_SCOPE", confidence: "high",
      headline: "Consoles are out of scope.",
      reasoning: `Yish's call on 2026-09-04: consoles are hard to resell, so Filtrsoft does not carry them. That includes their games and controllers, which trade in the same market for less. Nothing here is a judgement about the listing.`,
    };
  }

  if (!match.skuId && (NOT_OUR_MARKET.test(head.head ?? input.title) || NEVER_OUR_MARKET.test(input.title))) {
    return {
      ...base, call: "OUT_OF_SCOPE", confidence: "high",
      headline: "Not a category Filtrsoft covers.",
      // `head.head` is null whenever the title carries no recognised product
      // noun, which is exactly the router/switch case that reaches here via the
      // title fallback above. Name the matched word instead of crashing.
      reasoning: `That reads as ${(input.title.match(NEVER_OUR_MARKET)?.[0] ?? head.head ?? input.title.match(NOT_OUR_MARKET)?.[0] ?? "peripheral").toLowerCase()} gear. Filtrsoft covers phones, laptops, GPUs, tablets and PC components, the things with deep enough sold-comp data to price confidently. There are no comps here because nobody has ever asked for any.`,
    };
  }

  if (!inventory && (BULK_LISTING.test(input.title) || RESELLER_AD.test(input.title))) {
    return {
      ...base, call: "OUT_OF_SCOPE", confidence: "high",
      headline: "Bulk listing, not a single item.",
      reasoning: `"${input.title.slice(0, 60)}" is an inventory dump rather than one unit at one price. There is nothing single to compare against comps.`,
    };
  }

  if (product.kind === "unknown") {
    return {
      ...base, call: "OUT_OF_SCOPE", confidence: "high",
      headline: "Not something Filtrsoft covers.",
      reasoning: `Nothing in "${input.title.slice(0, 60)}" reads as a device Filtrsoft knows how to price: no recognisable product type and no model number. Filtrsoft covers phones, laptops, GPUs, tablets and PC components.`,
    };
  }

  // --- 2. Hard blockers override any price gap -------------------------
  if (base.blockers.length) {
    return {
      ...base, call: "RISK", confidence: "high",
      headline: "Hard blocker. Do not proceed on price alone.",
      reasoning: base.blockers.join(" "),
      decidingUnknown: "resolve the blocker before considering the price",
      questions: gateQuestions(gate, questions),
    };
  }

  // --- 3. Missing the field that determines value ----------------------
  if (inventory) {
    const offers = valueInventory(inventory);
    return {
      ...base,
      // A whole-listing median here would mix distinct products, while the
      // price arithmetic would subtract $1. Only individual offers get comps.
      valuation: { status: "no_comps", lowCents: null, highCents: null, medianCents: null, compCount: 0, confidence: "low" },
      retail: null,
      inventory: { sellerContext: inventory.sellerContext, offers },
      call: "INSUFFICIENT_DATA", confidence: "high",
      headline: "Item prices are in the description.",
      reasoning: `Found ${offers.length} separately priced offers. The headline price is a placeholder. Each quantity and price is shown below; resale values appear only where the archive has matching sold comps.`,
      decidingUnknown: "which item and quantity you want, and matching sold comps for it",
      questions: ["Which of these items are still available, and what is the total price for the quantity I choose?"],
    };
  }

  if (signals.missingValueFields.length) {
    return {
      ...base, call: "INSUFFICIENT_DATA", confidence: "high",
      headline: `Can't be valued: ${signals.missingValueFields.join(" and ")} not stated.`,
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
  if (partsVal && valuation === partsVal && partsVal.coverage < 0.55) {
    const known = partsVal.parts.filter((p) => p.medianCents != null).map((p) => p.query);
    const unknown = partsVal.parts.filter((p) => p.medianCents == null).map((p) => p.query);
    return {
      ...base, call: "INSUFFICIENT_DATA", confidence: "high",
      headline: `Specs are known, market prices aren't.`,
      reasoning: `Identified the full build (${Object.entries(match.attributes).filter(([k]) => ["cpu", "gpu", "ram_gb", "storage_gb"].includes(k)).map(([k, v]) => `${k.replace("_gb", "")} ${v}`).join(", ")}). But the comps archive only has sold prices for ${known.join(", ") || "none of it"}, and nothing for ${unknown.join(", ") || "the CPU"}, RAM, motherboard, PSU or case. Pricing a whole machine off one part would be a confident wrong answer, so this stays unpriced until the archive covers more components.`,
      decidingUnknown: "sold prices for the remaining components (not the specs, which are known)",
    };
  }

  /**
   * --- 4c. Retail says our own comps are wrong -------------------------
   *
   * A used median ABOVE the new price cannot be true of the same product in a
   * real market, so one of the two numbers is wrong — and retail is the one
   * that did not come from our archive. Every other confidence signal we have
   * (comp count, spread, recency) is computed FROM the comps, so none of them
   * can catch a systematically mis-matched comp set. This can.
   *
   * It refuses to price rather than pricing badly. That is the same call §4b
   * makes for thin part coverage, and for the same reason: a confident wrong
   * number is worse than no number.
   *
   * `implausible` is deliberately NOT handled here. A retail price at a third
   * of the used median is a parse escape (an accessory, a trade-in credit),
   * not evidence about the comps, and `retailMeaning` classifies it so that a
   * scraper bug can never masquerade as a data-quality finding.
   */
  /**
   * CORROBORATION IS REQUIRED HERE, and only here.
   *
   * Refusing to price a SKU at all is the biggest hammer in this function, so
   * it should not swing on one retailer's page. If Newegg and Micro Center both
   * say a card is $500 while our median says $700, that is a finding. If one
   * source says it alone, the likelier explanation is that the one source was
   * mis-parsed — and `retailMeaning` cannot tell those apart, because it only
   * sees a number.
   *
   * The asking-above-new branch below deliberately does NOT require this: it
   * quotes a specific real offer the reader can go and check, and being wrong
   * there costs one PASS rather than a whole SKU's worth of verdicts.
   */
  if (
    retail && retail.corroborated &&
    retailMeaning(retail.priceCents, valuation.medianCents) === "comps_wrong"
  ) {
    const $r = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;
    const others = retail.quotes.map((q) => `${q.source} ${$r(q.priceCents)}`).join(", ");
    return {
      ...base, call: "INSUFFICIENT_DATA", confidence: "high",
      headline: "Our comps disagree with new retail, so this stays unpriced.",
      reasoning: `The sold comps put this at ${$r(valuation.medianCents)} used, but it sells NEW for ${$r(retail.priceCents)} (${others}). Used cannot be worth more than new, so the ${valuation.compCount} comps behind that median are matching something else: a different capacity, a different variant, or a bundle. Retail is the only number here not derived from our own archive, which is why it can catch this and nothing else can, and more than one retailer agrees on it.`,
      decidingUnknown: "whether the sold comps are actually this exact model",
    };
  }

  /**
   * No asking price means no arithmetic. It used to fall back to ZERO, which
   * makes every unpriced listing look like free money — profit = full resale
   * value — and would have produced a maximally confident BUY on exactly the
   * listings that say "message me for price". It was masked by other
   * insufficiency checks firing first, which is luck, not a design.
   */
  if (input.askingPriceCents == null) {
    return {
      ...base, call: "INSUFFICIENT_DATA", confidence: "high",
      headline: "No asking price.",
      reasoning: "The listing has no price, so there is nothing to compare against market value. Ask the seller for a number before anything else.",
      decidingUnknown: "asking price",
    };
  }

  // --- 5. Money, relative to the user ----------------------------------
  /**
   * A parts-derived value is already a LOCAL price; a SKU-derived one is an eBay
   * price. Passing the basis is what stops an assembled PC being discounted for
   * "selling locally" when local IS the market it was priced in.
   */
  const basis = (valuation as { basis?: PriceBasis }).basis ?? "ebay";
  const channels = netByChannel(valuation.medianCents, match.category ?? signals.category, basis);
  const usable = channels.filter((c) => c.available);
  /**
   * ⚠ THE USER'S CHANNEL DECIDES, NOT THE HIGHEST NUMBER.
   *
   * This used to pick whichever channel netted most, which meant the verdict
   * prose could describe a sale Yish will never make: the RTX 4090 read
   * *"$653 net on ebay — after $332 fees and $15 shipping"* while the panel
   * underneath it said *"Selling locally, +$625"*. Two different answers on one
   * screen, and the louder one was for a channel he does not use.
   *
   * `prefers_channel` has been on `user_economics` from the beginning and was
   * never consulted. It is `facebook`, because he sells locally.
   *
   * Falls back to the best available when the preferred channel is not an
   * option — which for a phone or a GPU it always is, and for a tower eBay
   * never is.
   */
  const preferred = usable.find((c) => c.channel === econ.prefers_channel);
  const best = preferred ?? usable.reduce((a, b) => (b.netCents > a.netCents ? b : a));
  const ask = input.askingPriceCents;
  const net = best.netCents - ask;
  const required = requiredProfitCents(econ, drive);
  const $ = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;

  // Target offer: what they'd need to accept for this to clear the floor.
  const targetOfferCents = Math.max(0, best.netCents - required);

  const money = {
    ...base, bestChannel: best, channels, netProfitCents: net,
    requiredProfitCents: required, targetOfferCents,
    confidence: valuation.confidence,
  };

  // Dead liquidity vetoes BUY no matter the margin.
  if (match.liquidity === "dead" || match.deadReason) {
    return {
      ...money, call: "PASS", confidence: "high",
      headline: "Won't resell. Skip regardless of price.",
      reasoning: `${match.deadReason ?? "This category is a dead market."} It would net ${$(net)} ${channelName(best.channel)}, but a good price on something that sits is not a deal.`,
    };
  }

  /**
   * Asking at or above the price of a NEW one.
   *
   * THE FEATURE NO COMP SET CAN PROVIDE. Every competitor compares used to
   * used, so a seller who anchors on what they paid looks merely expensive
   * next to other used listings — the comps drift up with them. Retail is
   * outside that loop.
   *
   * The threshold is 95% of the shelf price rather than 100% because retail
   * excludes tax: at 95% pre-tax the used unit is already about 89% of what a
   * new one actually costs out the door, with no warranty and no return
   * window. Below that it is a judgement call and the normal margin math is
   * the better tool, so this stays a narrow, unambiguous rule.
   */
  if (retail && ask >= retail.priceCents * 0.95) {
    const where = RETAILER_NAME[retail.source] ?? retail.source;
    return {
      ...money, call: "PASS",
      confidence: retail.corroborated ? "high" : "medium",
      headline: `Buy it new instead: ${$(retail.priceCents)} at ${where}.`,
      reasoning: `Asking ${$(ask)} used, against ${$(retail.priceCents)} for a new one at ${where} ("${retail.title}", seen ${retail.observedAt.slice(0, 10)}). Add sales tax to the new price and it is still the better deal, with a warranty and a return window this has neither of. Nothing about the used market matters here. The seller is competing with a shelf.${retail.corroborated ? ` ${retail.quotes.length} retailers agree on the new price.` : " Only one retailer was checked, so verify the new price before walking away."}`,
    };
  }

  /**
   * A very large gap escalates scrutiny rather than excitement — but the gap has
   * to be measured against the RIGHT market.
   *
   * Comparing a local asking price to an eBay median makes every local listing
   * look suspiciously cheap, because local prices ARE systematically below eBay.
   * That is the whole reason the flip exists. The NZXT build read "53% of
   * market" and got escalated to VERIFY purely for being on Craigslist.
   *
   * `best.grossCents` is what the item fetches in the channel actually
   * available, so this compares like with like.
   */
  const localMarket = best.grossCents;

  /**
   * ⚠ CHECKED BEFORE THE "priced at N% of market" RULE, BECAUSE THAT RULE IS
   * WHERE THE SCAMS WERE LANDING.
   *
   * Its own comment concedes the ambiguity — *"the strongest deal signal AND
   * the strongest scam signal; they're the same observation"* — and then
   * resolves it as VERIFY, which is right at 0.55 and indefensible at 0.07.
   * On 2026-09-04, **34 of the 59 listings the app was telling Yish to act on
   * were farm postings**, and he was working through them by hand on his phone.
   *
   * A feed where the majority of the actionable items are fake is worse than
   * an empty one: it costs him the time to check each, and it teaches him to
   * distrust the calls that are real.
   */
  if (isScamFarm({ title: input.title, askCents: ask, marketCents: localMarket })) {
    const signals = scamSignals({ title: input.title, askCents: ask, marketCents: localMarket });
    return {
      ...money, call: "RISK", confidence: "high",
      headline: scamHeadline({ title: input.title, askCents: ask, marketCents: localMarket }),
      reasoning: `${signals.map((s) => s.detail).join(" ")} Asking ${$(ask)} against ${$(localMarket)} ${channelName(best.channel)}. Treat it as bait: the usual play is a deposit, a shipping fee, or a "my cousin has it" redirect off-platform.`,
      decidingUnknown: undefined,
    };
  }

  const ratio = ask && localMarket ? ask / localMarket : 1;
  if (ratio > 0 && ratio < 0.6) {
    return {
      ...money, call: "VERIFY", confidence: valuation.confidence,
      headline: `Priced at ${Math.round(ratio * 100)}% of market. Verify before driving.`,
      reasoning: `Asking ${$(ask)} against ${$(localMarket)} ${channelName(best.channel)}, from a ${$(valuation.medianCents)} median across ${valuation.compCount} comps. That gap is the strongest deal signal AND the strongest scam signal; they're the same observation. Resolve why it's cheap first.`,
      decidingUnknown: "why it is priced this far below market",
    };
  }

  if (net >= required) {
    /**
     * THE RULE THE PRODUCT RESTS ON. `RISK-MODEL.md`:
     *
     *   > An unresolved hard blocker overrides any price gap. A phone at 40% of
     *   > market with unknown lock status is never a BUY.
     *
     * The money says BUY. That is not sufficient. A discount cannot compensate
     * for a total loss, and an iCloud-locked phone is worth parts value at any
     * price. So BUY is only reachable when every required check for the
     * category is actually resolved.
     */
    if (gate.ceiling !== "BUY") {
      return {
        ...money,
        call: gate.ceiling,
        confidence: "high",
        headline: gate.ceiling === "RISK"
          ? `${$(net)} of margin, but a hard blocker is disclosed.`
          : `${$(net)} of margin, but ${gate.unresolved.length === 1 ? "one thing is" : `${gate.unresolved.length} things are`} unverified.`,
        reasoning: `${gate.reason} It would net ${$(net)} ${channelName(best.channel)}, and that is exactly why this needs settling first: the discount is what makes it tempting.`,
        decidingUnknown: (gate.failed[0] ?? gate.unresolved[0])?.label,
        questions: gateQuestions(gate, questions),
      };
    }

    /**
     * ⚠ THE HEADLINE STATES THE DEAL, NOT THE SETTING BEHIND IT.
     *
     * It used to read *"$625 net on facebook — clears your $135 floor."* Two
     * things wrong with one sentence, both from Yish on 2026-08-30.
     *
     * "on facebook" printed an internal channel id (see CHANNEL_NAME above).
     * And *"clears your $135 floor"* explains the verdict in terms of a number
     * he configured rather than the thing he wants to know: it is the app
     * talking about its own arithmetic. He asked what the listing is worth, not
     * how it scored against a threshold.
     *
     * The floor still decides the CALL, and it is still stated in the reasoning
     * and shown as its own row in The Numbers, where a number you can change
     * belongs. It just does not get the headline.
     */
    return {
      ...money, call: "BUY",
      headline: `Worth ${$(best.grossCents)}${net > 0 ? `, so you make ${$(net)}` : ""} ${channelName(best.channel)}.`,
      reasoning: `Median ${$(valuation.medianCents)} across ${valuation.compCount} comps. ${best.channel === "ebay" ? `After ${$(best.feesCents)} fees and ${$(best.shippingCents)} shipping` : "No fees, no shipping, cash on pickup"}, net is ${$(net)} against the ${$(required)} you need to clear for a ${drive}-minute drive.${riskCleared(gate)}`,
      questions,
    };
  }

  if (net > 0) {
    return {
      ...money, call: "FAIR",
      headline: `Only ${$(net)} in it, which doesn't pay for the trip.`,
      reasoning: `Worth about ${$(best.grossCents)} ${channelName(best.channel)} against ${$(ask)} asking, so there is real margin, just not enough to be worth ${drive} minutes each way. Around ${$(targetOfferCents)} would be.`,
    };
  }

  /**
   * "after fees" is only true when there ARE fees. On a local sale there are
   * none, and saying so anyway is the same class of error as charging them.
   */
  const hasFees = best.feesCents > 0 || best.shippingCents > 0;
  const where = channelVerb(best.channel);
  return {
    ...money, call: "PASS",
    headline: `Overpriced by ${$(Math.abs(net))}${hasFees ? " once fees are counted" : ""}.`,
    reasoning: `Asking ${$(ask)} against a ${$(valuation.medianCents)} median. Even ${where} it doesn't clear.`,
  };
}
