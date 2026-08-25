/**
 * Derive the catalog from what is actually observed, instead of guessing a list.
 *
 * MASTER-PLAN engine gap #1, and the reason it is P0: the hand-seeded catalog is
 * 62 SKUs — 28 phones, 12 laptops, 12 GPUs, 10 consoles, and **zero CPUs**. So
 * the NZXT build whose spec screen clearly reads "Ryzen 5 9600X" has nothing to
 * match the CPU against, sum-of-parts can only price the GPU, and the coverage
 * guard correctly refuses to price the machine. The pipeline is right and the
 * pantry is empty.
 *
 * Seeding a list and hoping comps match it is backwards. The models worth having
 * are the ones that keep appearing in real listings and real sales, and both of
 * those are already in the database.
 *
 * DRY RUN BY DEFAULT. This writes to the catalog every other part of the system
 * trusts, so it prints what it would add and changes nothing until asked. A
 * silent auto-inserting catalog builder is how you end up with 400 SKUs, half of
 * them typos, and no idea which are real.
 */
import { resolveCategory } from "../signals/product-type.ts";
import { db, now } from "../db/index.ts";

export interface Candidate {
  category: string;
  brand: string;
  model: string;
  /** How many distinct listings/comps mentioned it. */
  seen: number;
  examples: string[];
  existing: boolean;
}

/**
 * One extractor per family. Each returns a CANONICAL model string — the same
 * spelling the matcher will look for — not whatever the seller typed.
 *
 * Canonicalisation is the entire point. "RTX3060ti", "rtx 3060 Ti" and
 * "GeForce RTX 3060TI" have to collapse to one SKU or the catalog fills with
 * near-duplicates that each hold a third of the comps.
 */
/** Product line -> maker, so a derived laptop SKU carries the right brand. */
/**
 * Which extractors may run for a listing of each category.
 *
 * `prebuilt` deliberately allows components: the GPU and CPU inside a desktop
 * DO trade separately and sum-of-parts needs them. `laptop` deliberately does
 * not — its CPU is soldered and its "GPU" is usually integrated.
 */
const ALLOWED_EXTRACTORS: Record<string, string[]> = {
  laptop: ["laptop"],
  prebuilt: ["gpu", "component", "prebuilt"],
  gpu: ["gpu"],
  component: ["component", "gpu"],
  phone: ["phone"],
  tablet: ["phone", "tablet"],
  console: ["console"],
  monitor: ["monitor"],
};

/** Product line -> maker, so a derived laptop SKU carries the right brand. */
const LAPTOP_BRAND: Record<string, string> = {
  latitude: "Dell", inspiron: "Dell", precision: "Dell", xps: "Dell",
  elitebook: "HP", probook: "HP", zbook: "HP", spectre: "HP", pavilion: "HP",
  envy: "HP", omen: "HP",
  thinkpad: "Lenovo", thinkbook: "Lenovo", ideapad: "Lenovo", yoga: "Lenovo",
  legion: "Lenovo",
  aspire: "Acer", nitro: "Acer", predator: "Acer",
  zenbook: "ASUS", vivobook: "ASUS",
  "macbook pro": "Apple", "macbook air": "Apple",
  "surface pro": "Microsoft", "surface laptop": "Microsoft", "surface book": "Microsoft",
};

/**
 * Is this a SOLDERED mobile CPU?
 *
 * Intel U/H/HQ/HK/Y/G-series and AMD U/H/HS/HX parts are soldered to the board.
 * They are not items anyone buys or sells on their own, which is exactly why an
 * eBay search for one returns laptops. Creating SKUs for them produced eight
 * unpriceable entries and 898 junk comps.
 *
 * Desktop parts — K, KF, F, T, X, or no suffix at all — genuinely do trade
 * standalone, and those SKUs are worth having.
 */
export function isMobileCpu(model: string): boolean {
  const m = model.toUpperCase();
  if (/\bI[3579]-\d{4,5}(U|H|HQ|HK|Y|G\d|P)\b/.test(m)) return true;
  if (/RYZEN\s*[3579]\s*\d{4}(U|H|HS|HX|E)\b/.test(m)) return true;
  return false;
}

const EXTRACTORS: Array<{
  category: string;
  brand: (m: RegExpMatchArray) => string;
  re: RegExp;
  model: (m: RegExpMatchArray) => string;
}> = [
  /**
   * LAPTOP MODELS. This extractor is the reason the whole file was restructured.
   *
   * Without it, "Dell Latitude 5530 15.6 FHD Laptop Intel i5-1235U" produced a
   * SKU for the **CPU**, because the CPU was the only pattern that matched. Then
   * pulling comps for that CPU returned laptops, and 898 laptop prices were
   * stored as the price of a chip — implying an i5-1235U is worth $250.
   *
   * The market's view is the correct one: what sells is the LAPTOP. So a laptop
   * listing must yield a laptop SKU.
   */
  {
    category: "laptop",
    brand: (m) => LAPTOP_BRAND[m[1].toLowerCase()] ?? "",
    re: new RegExp(
      String.raw`\b(latitude|inspiron|precision|xps|elitebook|probook|zbook|spectre|pavilion|envy|omen|thinkpad|thinkbook|ideapad|yoga|legion|aspire|nitro|predator|zenbook|vivobook|macbook\s+(?:pro|air)|surface\s+(?:pro|laptop|book))\s+((?:[a-z]?\d{1,5}[a-z]?\b\s*){1,2}(?:g\d{1,2}\b)?)`,
      "gi",
    ),
    model: (m) => {
      const line = m[1].replace(/\s+/g, " ").trim();
      // Stop at a decimal — "Latitude 5530 15.6" is a model then a SCREEN SIZE.
      const tok = m[2].trim().split(/\s+/).filter((t) => !/\./.test(t));
      if (!tok.length) return "";

      /**
       * ONE model token, not two — except for the two real two-token forms.
       *
       * Greedily taking two produced "Dell XPS 9310 2", "Dell Latitude 5300 2"
       * and "Dell XPS 9520 14": a screen size or a stray "2" from "2-in-1"
       * fused onto the model, creating near-duplicate SKUs that each hold a
       * fraction of the comps.
       */
      const out = [tok[0]];
      if (tok[1]) {
        // "EliteBook 840 G6" — the generation marker is part of the name.
        if (/^g\d{1,2}$/i.test(tok[1])) out.push(tok[1]);
        // "XPS 13 9310" — size first, THEN the model number.
        else if (/^\d{2}$/.test(tok[0]) && /^\d{4}$/.test(tok[1])) out.push(tok[1]);
      }
      // "XPS" is an acronym; title-casing it to "Xps" makes the catalog look
      // like it was generated by something that had never seen a Dell.
      const ACRONYM: Record<string, string> = { xps: "XPS", rog: "ROG" };
      const name = ACRONYM[line.toLowerCase()] ?? title(line);
      return name + " " + out.map((t) => t.toUpperCase()).join(" ");
    },
  },
  {
    category: "gpu", brand: (m) => (/^rx/i.test(m[1]) ? "AMD" : "NVIDIA"),
    re: /\b(rtx|gtx|rx)\s?(\d{3,4})\s?(ti|super|xt)?\b/gi,
    model: (m) => `${m[1].toUpperCase()} ${m[2]}${m[3] ? " " + m[3].replace(/^./, (c) => c.toUpperCase()) : ""}`,
  },
  {
    // The gap that matters most. Intel part numbers carry letter suffixes
    // ("i7-1185G7"), so no trailing \b — it can never match after one.
    category: "component", brand: () => "Intel",
    re: /\b(i[3579])([- ])(\d{4,5}[a-z]{0,2}\d?)/gi,
    model: (m) => (looksLikeYear(m[2], m[3]) ? "" : `${m[1].toLowerCase()}-${m[3].toUpperCase()}`),
  },
  {
    category: "component", brand: () => "AMD",
    re: /\bryzen\s?([3579])\s?(\d{4}[a-z0-9]{0,3})\b/gi,
    model: (m) => `Ryzen ${m[1]} ${m[2].toUpperCase()}`,
  },
  {
    category: "phone", brand: () => "Apple",
    re: /\biphone\s?(\d{1,2})\s?(pro max|pro|plus|mini|se)?\b/gi,
    model: (m) => `iPhone ${m[1]}${m[2] ? " " + title(m[2]) : ""}`,
  },
  {
    category: "phone", brand: () => "Samsung",
    re: /\bgalaxy\s?(s\d{2}\s?(?:ultra|plus|\+)?|z\s?(?:fold|flip)\s?\d|a\d{2})\b/gi,
    model: (m) => `Galaxy ${title(m[1].replace(/\s+/g, " ").replace(/\+/, "Plus"))}`,
  },
  {
    category: "laptop", brand: () => "Apple",
    re: /\bmacbook\s?(pro|air)\s?(m[1-4](?:\s?(?:pro|max|ultra))?)?\b/gi,
    model: (m) => `MacBook ${title(m[1])}${m[2] ? " " + m[2].toUpperCase().replace(/\s+/g, " ") : ""}`,
  },
  {
    category: "console", brand: () => "Sony",
    re: /\b(playstation\s?5|ps5|playstation\s?4|ps4)\s?(pro|slim|digital)?\b/gi,
    model: (m) => `PlayStation ${/5/.test(m[1]) ? "5" : "4"}${m[2] ? " " + title(m[2]) : ""}`,
  },
  {
    category: "console", brand: () => "Microsoft",
    re: /\bxbox\s?(series\s?[xs]|one\s?[xs]?)\b/gi,
    model: (m) => `Xbox ${title(m[1].replace(/\s+/g, " "))}`,
  },
  {
    category: "console", brand: () => "Nintendo",
    // NEVER a bare "switch" — it matched a joystick listing 18 times. Either the
    // brand is named, or a Switch-specific variant is.
    re: /\b(?:nintendo\s?switch|switch\s?(oled|lite))\s?(oled|lite|2)?\b/gi,
    model: (m) => `Switch${m[1] || m[2] ? " " + title(m[1] || m[2]) : ""}`,
  },
];

/** Lowercase FIRST, then capitalise — otherwise "MACBOOK AIR" stays "AIR". */
const title = (s: string) =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/**
 * Listings for ACCESSORIES name the device they fit, and that is not evidence
 * the device itself trades here. "Samsung Galaxy S10 Ultra Magnetic Case"
 * created a phone SKU on the first run, and a joystick listing created
 * "Nintendo Switch" eighteen times. Checked against the TITLE only — a genuine
 * phone listing that mentions an included case in its description still counts.
 */
const ACCESSORY = /\b(case|cover|screen protector|tempered glass|charger|cable|adapter|stand|mount|skin|sleeve|dock|holster|joystick|bracket)\b/i;

/**
 * A bare four-digit number after a CPU family is very often a YEAR rather than a
 * part number: `iMac 21" i5 2013` produced the SKU "Intel i5-2013". Hyphenated
 * forms ("i5-2500K") are unambiguous and always allowed.
 */
function looksLikeYear(sep: string, digits: string): boolean {
  if (sep !== " ") return false;
  const n = Number(digits);
  return digits.length === 4 && n >= 1995 && n <= 2030;
}

/**
 * Scan every text source we have: listing titles, listing descriptions, the
 * component strings vision read off spec screens, and comp titles.
 *
 * Vision output is included deliberately — a spec screen is where the exact CPU
 * appears, and it is precisely the model the title never mentions.
 */
export function deriveCandidates(opts: { minSeen?: number } = {}): Candidate[] {
  const minSeen = opts.minSeen ?? 2;
  const d = db();

  const sources: Array<{ text: string; label: string }> = [];
  for (const r of d.query(`SELECT title, description FROM listings`).all() as Array<{ title: string; description: string }>) {
    if (ACCESSORY.test(r.title ?? "")) continue;
    /**
     * TITLE ONLY, not the description.
     *
     * Dealer listings ("Spring Laptop Blowout Sale!") name forty models in
     * their body copy. Including descriptions created a SKU for every one and
     * inflated the counts — 17 sightings of "Dell XPS 9310" that were all the
     * same shop's catalogue, not seventeen laptops for sale. The title names
     * the thing actually being sold.
     */
    sources.push({ text: r.title ?? "", label: r.title ?? "" });
  }
  for (const r of d.query(`SELECT raw_title FROM comps`).all() as Array<{ raw_title: string }>) {
    if (ACCESSORY.test(r.raw_title ?? "")) continue;
    sources.push({ text: r.raw_title ?? "", label: r.raw_title ?? "" });
  }
  for (const r of d.query(`SELECT payload FROM vision_results`).all() as Array<{ payload: string }>) {
    try {
      const v = JSON.parse(r.payload);
      const parts = Object.values(v.components ?? {}).filter(Boolean).join(" ");
      if (parts) sources.push({ text: parts, label: `[vision] ${parts.slice(0, 60)}` });
    } catch { /* a corrupt payload must not stop the scan */ }
  }

  const found = new Map<string, Candidate>();
  for (const src of sources) {
    /**
     * DECIDE WHAT THE LISTING IS, THEN EXTRACT THE MATCHING MODEL.
     *
     * Previously every extractor ran against every listing, so a laptop
     * produced a CPU SKU — the CPU pattern matched and nothing checked whether
     * a CPU was what was for sale. That single omission is what put 898 laptop
     * prices into the archive as CPU comps.
     *
     * A prebuilt is the one case where component extraction is still right: the
     * GPU and CPU inside a desktop genuinely do trade separately, and
     * sum-of-parts needs them.
     */
    const listingCategory = resolveCategory(src.label || src.text);
    const allowed = ALLOWED_EXTRACTORS[listingCategory ?? ""] ?? null;

    for (const ex of EXTRACTORS) {
      if (allowed && !allowed.includes(ex.category)) continue;

      // Fresh lastIndex per source: a shared /g regex silently skips matches.
      ex.re.lastIndex = 0;
      for (const m of src.text.matchAll(ex.re)) {
        const model = ex.model(m);
        if (!model) continue;   // extractor rejected it (e.g. a year, not a part number)

        /**
         * A soldered mobile CPU is not a product. Skip it wherever it appears —
         * including inside a laptop listing, where it is a SPEC, not the item.
         */
        if (ex.category === "component" && isMobileCpu(model)) continue;

        const key = `${ex.category}|${model.toLowerCase()}`;
        const c = found.get(key) ?? {
          category: ex.category, brand: ex.brand(m), model,
          seen: 0, examples: [], existing: false,
        };
        c.seen++;
        if (c.examples.length < 3 && src.label && !c.examples.includes(src.label)) {
          c.examples.push(src.label.slice(0, 70));
        }
        found.set(key, c);
      }
    }
  }

  const have = new Set(
    (d.query(`SELECT LOWER(model) m FROM skus`).all() as Array<{ m: string }>).map((r) => r.m),
  );
  for (const c of found.values()) c.existing = have.has(c.model.toLowerCase());

  return [...found.values()]
    .filter((c) => c.seen >= minSeen)
    /**
     * REFUSE FAMILY NAMES. A model with no digit in it — bare "MacBook Pro",
     * bare "Galaxy" — is a product LINE, not a thing with a price. `matchSku`
     * treats a digit-bearing token as the discriminator that must be present,
     * so a SKU with no digits has nothing to discriminate on and would match a
     * 2012 and a 2024 MacBook Pro equally well.
     *
     * That is precisely the bug that matched a 2019 Intel machine to an M3.
     * Creating such a SKU would reintroduce it through the catalog rather than
     * through the matcher, where the guard could not see it.
     */
    .filter((c) => /\d/.test(c.model))
    .sort((a, b) => b.seen - a.seen);
}

/**
 * Insert the new ones. Liquidity is left NULL rather than guessed — it vetoes
 * BUY, and a wrong guess there either hides real deals or waves through dead
 * inventory. It gets set from measured days-to-sell once the tracker has data.
 */
export function applyCandidates(cands: Candidate[]): number {
  const ins = db().prepare(
    `INSERT INTO skus (category, brand, model, attributes, liquidity, created_at)
     VALUES ($cat,$brand,$model,'{}',NULL,$now)`,
  );
  const alias = db().prepare(
    `INSERT INTO sku_aliases (sku_id, alias, source, confidence, created_at)
     VALUES ($sku,$alias,'derived','high',$now) ON CONFLICT(alias) DO NOTHING`,
  );
  let n = 0;
  for (const c of cands) {
    if (c.existing) continue;
    const r = db()
      .query(
        `INSERT INTO skus (category, brand, model, attributes, liquidity, created_at)
         VALUES ($cat,$brand,$model,'{}',NULL,$now) RETURNING id`,
      )
      .get({ $cat: c.category, $brand: c.brand, $model: c.model, $now: now() }) as { id: number };
    // The canonical spelling is itself the first alias, so the fast exact path
    // works immediately instead of falling through to token matching.
    alias.run({ $sku: r.id, $alias: c.model.toLowerCase(), $now: now() });
    n++;
  }
  void ins;
  return n;
}
