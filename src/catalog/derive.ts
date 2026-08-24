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
const EXTRACTORS: Array<{
  category: string;
  brand: (m: RegExpMatchArray) => string;
  re: RegExp;
  model: (m: RegExpMatchArray) => string;
}> = [
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
    sources.push({ text: `${r.title ?? ""} ${r.description ?? ""}`, label: r.title ?? "" });
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
    for (const ex of EXTRACTORS) {
      // Fresh lastIndex per source: a shared /g regex silently skips matches.
      ex.re.lastIndex = 0;
      for (const m of src.text.matchAll(ex.re)) {
        const model = ex.model(m);
        if (!model) continue;   // extractor rejected it (e.g. a year, not a part number)
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
