/**
 * What IS this listing selling?
 *
 * THE BUG THIS FIXES, in Yish's words: "it is taking the word computer no matter
 * what the actual product is". A `--query "gaming pc"` crawl returned a computer
 * desk, a computer chair, a glass computer table and a laptop carrying case —
 * and vision read the photos of the desk, the table and the chair before anyone
 * noticed, at about 3.4 cents.
 *
 * Keyword matching cannot fix this, and a blocklist of "desk|chair" only fixes
 * the three words you thought of. The actual rule is grammatical:
 *
 *   **In an English product title, the HEAD NOUN comes last.**
 *
 *     "computer desk"        -> a DESK that is for computers
 *     "desk computer"        -> a COMPUTER that sits on a desk
 *     "Glass and Metal Computer Table"  -> a TABLE
 *     "Gaming PC"            -> a PC
 *
 * The last product noun wins. That is a property of the language, so it
 * generalises to nouns nobody has enumerated yet — "computer hutch", "monitor
 * riser", "PC trolley" all resolve correctly without ever being listed.
 *
 * THE ONE EXCEPTION IS LISTS. "Acer Predator XB271HU Monitor, Black Desk, and
 * Chair" is not a compound noun, it is a bundle, and the head-last rule would
 * call it a chair. A separator (`,` `and` `&` `+` `with` `w/`) marks a list, and
 * in a list the FIRST tech noun is the item being sold — the rest are extras.
 */

export type ProductKind = "tech" | "furniture" | "accessory" | "unknown";

export interface ProductType {
  kind: ProductKind;
  /** The noun the decision rests on. */
  head: string | null;
  /** Human-readable, and shown in the verdict so a rejection is never mysterious. */
  reason: string;
}

/** Printers are devices, but not a market Filtrsoft has chosen to judge. */
export function isUnsupportedPrinter(title: string): boolean {
  return /\b(printer|laserjet|officejet|deskjet|inkjet|ecotank)\b/i.test(title);
}

/**
 * Nouns that name the thing being sold, by class.
 *
 * ORDER WITHIN A CLASS DOES NOT MATTER; position in the TITLE does. Multi-word
 * entries are matched first so "graphics card" is not read as "card".
 */
const TECH = [
  "gaming pc", "desktop computer", "all-in-one", "all in one", "gaming desktop",
  "graphics card", "video card", "hard drive", "solid state drive", "power supply",
  // "Desktop Processor" is a CPU, not a desktop. Longest-match ordering makes
  // this beat the bare "desktop" that would otherwise classify it as a machine.
  "desktop processor", "mobile processor", "mini pc", "nuc",
  "pc", "computer", "desktop", "tower", "laptop", "notebook", "chromebook",
  "macbook", "imac", "mac mini", "mac studio", "mac pro", "workstation", "server",
  "monitor", "display", "gpu", "cpu", "processor", "motherboard", "mobo",
  "ssd", "hdd", "nvme", "ram", "memory", "psu",
  "phone", "iphone", "ipad", "tablet", "galaxy", "pixel",
  "console", "playstation", "ps4", "ps5", "xbox", "nintendo switch",
  /**
   * VR headsets are DEVICES, and the bare noun says the opposite. "headset"
   * sits in ACCESSORY because a gaming headset is a $40 peripheral, so a real
   * $600 "Meta - Quest 3 512GB | Virtual Reality Headset" was thrown out as an
   * accessory. The qualifier is what distinguishes them, and it is always
   * present on the device — nobody sells a bare "headset" meaning a Quest.
   */
  "vr headset", "virtual reality headset", "mixed reality headset",
  "vr", "quest", "psvr", "psvr2", "playstation vr", "playstation vr2", "index",
  "steam deck", "thinkpad", "thinkcentre", "optiplex", "latitude", "elitedesk",
  /**
   * Product-LINE names. Without these, "Dell Precision 5760 + Charger" has
   * exactly one recognisable noun — "charger" — and a $900 laptop is thrown out
   * as an accessory. Five real listings were lost to this before it was added.
   */
  "precision", "inspiron", "xps", "elitebook", "probook", "pavilion", "envy",
  "ideapad", "yoga", "legion", "surface", "aspire", "predator", "nitro",
  "omen", "zenbook", "vivobook", "rog", "alienware", "prodesk", "elitedesk",
];

/**
 * Furniture. The listing may be entirely about computers and still be a table.
 */
const FURNITURE = [
  "desk", "chair", "table", "stand", "cart", "shelf", "shelving", "bookcase",
  "bookshelf", "cabinet", "hutch", "stool", "riser", "workbench", "trolley",
  "rack", "furniture", "dresser", "nightstand", "couch", "sofa", "futon",
  "bed", "mattress", "wardrobe", "credenza", "sideboard", "ottoman", "bench",
  "armoire", "recliner",
];

/**
 * Accessories and peripherals. Out of scope TODAY because the catalog cannot
 * price them and they are mostly sub-$40 — not because they are worthless.
 * Moving "keyboard" or "headset" into TECH is a one-line change if the catalog
 * ever covers them.
 */
const ACCESSORY = [
  "macbook battery", "laptop battery", "notebook battery",
  "case", "bag", "sleeve", "backpack", "cover", "skin", "strap", "lanyard",
  "cable", "adapter", "charger", "power cord", "dock", "hub", "splitter",
  "mousepad", "mouse pad", "cooling pad", "pad", "mat", "screen protector", "bracket", "mount",
  "keyboard", "mouse", "headset", "headphones", "earbuds", "microphone", "mic",
  "webcam", "speaker", "remote", "controller", "carrying case",
  /**
   * PC-part accessories. A search for a graphics card returns waterblocks,
   * backplates and mounting brackets FOR that card, and each one stored as a
   * comp drags the median toward $10. Bare "fan" is deliberately absent — real
   * GPU titles say "Quad Fan" mid-title and end with "Graphics Card", so the
   * head-noun rule already resolves those correctly.
   */
  "waterblock", "water block", "backplate", "back plate", "heatsink",
  "heat sink", "shroud", "thermal paste", "riser cable", "extender",
  "cooling fan", "case fan", "cooler", "mounting kit", "support bracket",
];

const CLASSES: Array<[ProductKind, string[]]> = [
  ["tech", TECH], ["furniture", FURNITURE], ["accessory", ACCESSORY],
];

/** Longest first, so "graphics card" beats "card" and "gaming pc" beats "pc". */
const LEXICON: Array<{ term: string; kind: ProductKind }> = CLASSES
  .flatMap(([kind, terms]) => terms.map((term) => ({ term, kind })))
  .sort((a, b) => b.term.length - a.term.length);

/**
 * A model identifier — "RTX 3080", "i7-8700", "XB271HU", "M3".
 *
 * Strong evidence a real device is being sold rather than furniture named after
 * one. Nobody puts a part number on a desk.
 */
const MODEL_ID =
  /\b(rtx|gtx|rx)\s?\d{3,4}|\bi[3579][- ]\d{4,5}|\b(?:screen\s*)?i[3579]\s+\d{1,2}(st|nd|rd|th)\s+gen(eration)?\b|\bryzen\s?\d\s?\d{4}|\bm[1-9]\b|\b[a-z]{2,3}\d{3,4}[a-z]{0,3}\b|\b\d{2,4}\s?(gb|tb)\b/i;

/**
 * A separator only makes a LIST when it sits BETWEEN two product nouns.
 *
 * Naive separator detection was wrong on three real titles at once: "Glass and
 * Metal Computer Table" joins two ADJECTIVES, and "PC gaming chair with RGB"
 * introduces a FEATURE. Both were read as bundles and escaped as tech. The
 * separator has to actually separate two things being sold.
 */
const LIST_SEPARATOR = /,| - |\band\b|&|\+|\bwith\b|\bw\/|\bplus\b|\bincludes?\b/gi;

/**
 * "for X" / "compatible with X" / "fits X" — X is what the product WORKS WITH,
 * never the product.
 *
 * "Gaming Headset & Mic for PlayStation 4 & 5" is a headset. "Case for iPhone
 * 15" is a case. Without this rule the platform name is the most impressive
 * noun in the title and wins every time, which is exactly backwards: the more
 * valuable the named device, the more confidently we would misclassify the
 * cheap accessory attached to it.
 */
const COMPATIBILITY =
  /\b(?:compatible with|fits|works with|designed for|for(?!\s+(?:sale|parts|repair|free|trade|pickup|pick\s?up)\b))\b/i;

/**
 * A noun the listing says it does NOT include.
 *
 * "Apple Cinema Display Monitor - NO Power Adapter" is a MONITOR, and reading
 * the head noun literally made it an adapter. Negated nouns are dropped before
 * anything else looks at them.
 */
const NEGATED = /\b(no|without|missing|not included|minus|lacks|excludes)\b/i;

interface Found { term: string; kind: ProductKind; index: number }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Noun positions, in the SAME coordinate space as the original title.
 *
 * This used to search a normalised copy — punctuation stripped, whitespace
 * collapsed — and return indices into THAT string, which were then compared
 * against separator positions found in the raw title. The offsets did not line
 * up, so "Dell Precision 5760 (Non-Touch Screen) + Charger" never registered
 * its `+` as sitting between two nouns and a laptop was classified as a
 * charger. Stripping punctuation also deleted the very commas the list rule
 * depends on.
 *
 * Lowercasing preserves length and word boundaries handle the rest, so every
 * index here is directly comparable to a match on the original string.
 */
function findNouns(title: string): Found[] {
  const t = title.toLowerCase();
  const found: Found[] = [];
  const claimed: Array<[number, number]> = [];

  for (const { term, kind } of LEXICON) {
    /**
     * Multi-word terms tolerate any whitespace run; every term tolerates a
     * plural. "Dell 7480 laptops, i7, i5, Backlit keyboard" found only
     * "keyboard" without the `s?` — `\blaptop\b` does not match "laptops" — so
     * a listing for laptops was classified as a keyboard.
     */
    const re = new RegExp(`\\b${escapeRe(term).replace(/\s+/g, "\\s+")}s?\\b`, "g");
    for (const m of t.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      // A longer term already covered this span ("graphics card" vs "card").
      if (!claimed.some(([s, e]) => start < e && end > s)) {
        found.push({ term, kind, index: start });
        claimed.push([start, end]);
      }
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export function resolveProductType(title: string, description = ""): ProductType {
  const all = findNouns(title);

  /**
   * Everything after a compatibility marker names what the item WORKS WITH.
   * Dropped before any other reasoning, so the platform can never win.
   */
  const compatAt = title.toLowerCase().search(COMPATIBILITY);
  const afterCompat = compatAt >= 0 ? all.filter((n) => n.index < compatAt) : all;

  /**
   * Drop nouns the listing explicitly says are ABSENT. "…Monitor - NO Power
   * Adapter" is a monitor; the adapter is the thing you are NOT getting.
   * Checked against the ~24 characters before the noun, which covers
   * "no power adapter" and "without charger" without reaching back into an
   * unrelated clause.
   */
  const lower = title.toLowerCase();
  const nouns = afterCompat.filter((n) => !NEGATED.test(lower.slice(Math.max(0, n.index - 24), n.index)));
  if (!nouns.length && all.length) {
    return {
      kind: "accessory", head: all[0].term,
      reason: `everything in the title sits after "for", so it is an accessory for ${all[0].term}`,
    };
  }

  if (!nouns.length) {
    // Nothing recognisable in the title. The description is a weaker signal —
    // it is full of shipping terms and boilerplate — so only a model number
    // counts, and even then this stays "unknown" rather than becoming "tech".
    return {
      kind: MODEL_ID.test(title) ? "tech" : "unknown",
      head: null,
      reason: MODEL_ID.test(title)
        ? "no product noun, but the title carries a model number"
        : "no recognisable product noun in the title",
    };
  }

  /**
   * A real list needs a separator sitting BETWEEN two product nouns — not one
   * joining adjectives ("Glass and Metal Computer Table") or introducing a
   * feature ("PC gaming chair with RGB").
   */
  const seps: number[] = [];
  LIST_SEPARATOR.lastIndex = 0;
  for (const m of title.matchAll(LIST_SEPARATOR)) seps.push(m.index ?? 0);
  const isList =
    nouns.length > 1 &&
    seps.some((s) => s > nouns[0].index && s < nouns[nouns.length - 1].index);

  if (isList) {
    /**
     * A bundle. The first tech noun is the item; furniture after a comma is a
     * thrown-in extra. "Acer XB271HU Monitor, Black Desk, and Chair" is a
     * monitor sale, and head-last would have called it a chair.
     */
    const firstTech = nouns.find((n) => n.kind === "tech");
    if (firstTech) {
      return {
        kind: "tech", head: firstTech.term,
        reason: `bundle listing led by "${firstTech.term}"`,
      };
    }
  }

  const head = nouns[nouns.length - 1];

  /**
   * Furniture or an accessory as the head noun means that IS the product, no
   * matter how much tech vocabulary sits in front of it. The model-number
   * escape hatch is deliberately NOT applied here: "Dell 16in computer Laptop
   * Padded Carrying Case" has a brand and a size and is still a bag.
   */
  if (head.kind === "furniture" || head.kind === "accessory") {
    const techBefore = nouns.filter((n) => n.kind === "tech").map((n) => n.term);
    return {
      kind: head.kind,
      head: head.term,
      reason: techBefore.length
        ? `"${head.term}" is the head noun, and ${techBefore.map((t) => `"${t}"`).join(", ")} only describes what it is FOR`
        : `"${head.term}" is the head noun`,
    };
  }

  return { kind: "tech", head: head.term, reason: `"${head.term}" is the head noun` };
}

/** Is this worth spending money analysing? */
export function inScope(title: string, description = ""): boolean {
  return resolveProductType(title, description).kind === "tech";
}

/**
 * WHOLE devices outrank COMPONENTS, wherever they appear in the title.
 *
 * The head-last rule is right for furniture ("computer desk") and wrong for
 * spec-laden marketplace titles, where the specs come last:
 *
 *   "HP EliteBook 840 G6 Laptop Intel i5-8365U 8GB RAM 256GB SSD"
 *
 * Head-last calls that an SSD. It is a LAPTOP whose specs are listed after it.
 * So for deciding WHAT CATEGORY a listing belongs to, a whole-device noun beats
 * a component noun regardless of position — you cannot sell a laptop and its
 * CPU as the same object, and whichever is named, the laptop is the product.
 */
const DEVICE_CATEGORY: Array<[string, string[]]> = [
  ["laptop", ["laptop", "notebook", "macbook", "chromebook", "thinkpad", "elitebook",
              "probook", "ideapad", "latitude", "precision", "inspiron", "xps",
              "pavilion", "envy", "zenbook", "vivobook", "aspire", "yoga", "surface"]],
  ["prebuilt", ["gaming pc", "desktop computer", "gaming desktop", "pc", "desktop",
                "tower", "workstation", "all-in-one", "all in one", "imac",
                "thinkcentre", "optiplex", "elitedesk", "prodesk", "nuc", "mini pc",
                "mac mini", "mac studio", "mac pro", "alienware", "server"]],
  ["phone", ["iphone", "phone", "galaxy", "pixel"]],
  ["tablet", ["ipad", "tablet"]],
  ["console", ["console", "playstation", "ps4", "ps5", "xbox", "nintendo switch", "steam deck",
               "vr headset", "virtual reality headset", "mixed reality headset", "quest", "psvr", "psvr2", "playstation vr", "playstation vr2"]],
  ["monitor", ["monitor", "display"]],
  ["gpu", ["graphics card", "video card", "gpu"]],
  ["component", ["cpu", "processor", "desktop processor", "mobile processor",
                 "motherboard", "mobo", "ssd", "hdd", "nvme",
                 "ram", "memory", "psu", "power supply", "hard drive", "solid state drive"]],
];

/**
 * "Desktop Processor" must beat "desktop". Both are present in the title, and
 * the ranked list above would otherwise return `prebuilt` for a boxed CPU.
 */
const COMPONENT_OVERRIDE = /\b(desktop|mobile)\s+processor\b|\bboxed\s+(cpu|processor)\b/i;

/**
 * Best-guess category for a listing title. Whole devices first, in the order
 * above, so a laptop containing a CPU is a laptop.
 */
export function resolveCategory(title: string): string | null {
  if (COMPONENT_OVERRIDE.test(title)) return "component";

  const nouns = findNouns(title);
  const present = new Set(nouns.filter((n) => n.kind === "tech").map((n) => n.term));
  for (const [category, terms] of DEVICE_CATEGORY) {
    if (terms.some((t) => present.has(t))) return category;
  }

  /**
   * A bare card name — "EVGA GeForce RTX 3080 10GB XC3 Ultra" — contains no
   * product noun at all. The model number IS the identification, and without
   * this fallback every graphics-card comp comes back uncategorised and cannot
   * be checked against its SKU.
   */
  if (/\b(rtx|gtx|radeon\s*rx|\brx)\s?\d{3,4}/i.test(title)) return "gpu";
  if (/\b(i[3579][- ]\d{4,5}|ryzen\s?[3579]\s?\d{4})/i.test(title) && !present.size) return "component";
  return null;
}

/**
 * Apple machines are sold as MODELS, never as a sum of parts.
 *
 * Yish, on a 2019 iMac the engine refused to value: *"its an apple imac, your
 * not supposed to grade it off of just gpu and cpu because most of the time its
 * not gonna give that info, its apple so you just have to compare it with the
 * same model imac comps."*
 *
 * He is describing how the market actually works. Nobody parts out an iMac, the
 * GPU is soldered, and the listing will say "2019 27-inch 5K" rather than naming
 * a graphics chip. Treating one as a prebuilt PC made the engine demand two
 * fields that do not exist and return INSUFFICIENT_DATA forever.
 */
export function isAppleWholeUnit(text: string): boolean {
  return /\b(imac|mac\s?mini|mac\s?studio|mac\s?pro|macbook|apple\s+(desktop|all[- ]in[- ]one))\b/i.test(text);
}

/**
 * Multi-unit listings. "LOT OF 10 HP ZBook Firefly" sold for $1,300 and was
 * stored as one comp — a 10x overstatement of a single unit, and it landed in
 * the archive as the most expensive "CPU" on record. Quantity is not something
 * to average away; these have to be excluded.
 */
export function isMultiUnit(title: string): boolean {
  // "i7-6700t cpu Amount: 3  i7-7700 Amount: 2" — a mixed multi-unit lot that
  // never says the word "lot". It sold for $199 against a $40 median.
  if (/\bamount\s*[:.]?\s*\d/i.test(title)) return true;
  return /\b(lot of|lot\s*\d|bundle of|set of|\d+\s*[-\s]?pack|qty\s*[:.]?\s*\d|x\s?\d{2,}\s*(units?|pcs?|pieces?)|wholesale|pallet)\b/i.test(title)
    || /^\s*lot\b/i.test(title);
}
