/**
 * Catalog matching — messy listing title to canonical SKU.
 *
 * This is the unglamorous part that makes comps usable. "MacBook pro 15in like
 * new" and "Gaming Desktop PC – Intel i7-6700K / NVIDIA RTX 3050 8GB" have to
 * resolve to something you can look up prices for.
 *
 * Every successful resolution writes an ALIAS back, so the catalog learns. A
 * title that took fuzzy matching this time is an exact hit next time.
 */
import { parseModel, findOrCreateSku } from "./derive.ts";
import { db, now } from "../db/index.ts";
import { DEAD_PATTERNS } from "../reference/catalog.ts";
import { variantPattern } from "../signals/variants.ts";

export interface Match {
  skuId: number | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  liquidity: string | null;
  confidence: "high" | "medium" | "low";
  method: "alias" | "token" | "derived" | "none";
  deadReason?: string;
  /** Extracted regardless of whether a SKU matched — these drive valuation. */
  attributes: Record<string, string | number>;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Return the catalog brand the seller explicitly named, if any.
 *
 * Token overlap must not cross a stated brand boundary. A live Dell laptop
 * title containing "Pro" and "14" was otherwise resolving to Apple's
 * MacBook Pro 14 SKU: the family tokens happened to overlap even though the
 * seller had written "Dell" in the title. Brands come from the catalog rather
 * than a second hard-coded vocabulary. Only the opening three words count:
 * component makers and bundled software later in a title ("Intel Core",
 * "Microsoft Office") are not necessarily the device maker.
 */
export function namedCatalogBrand(title: string, brands: string[]): string | null {
  const prefix = norm(title).split(" ").slice(0, 3).join(" ");
  const padded = ` ${prefix} `;
  let best: { brand: string; index: number } | null = null;

  for (const brand of new Set(brands.filter(Boolean))) {
    const normalized = norm(brand);
    if (!normalized) continue;
    const index = padded.indexOf(` ${normalized} `);
    if (index >= 0 && (!best || index < best.index)) best = { brand, index };
  }

  return best?.brand ?? null;
}

/**
 * The base model, without its variant suffix. `9800x3d` and `9800x` share
 * `ryzen 7 9800`; `3080 ti` and `3080` share `rtx 3080`.
 */
const CPU_BASE = /^(?:i[3579][- ]\d{4,5}|ryzen \d \d{4}|m[1-9])/;

/**
 * ─────────────────────────────────────── "AMD 7600X" is a Ryzen 5 7600X
 *
 * ⚠ EVERY CPU PATTERN IN THIS CODEBASE REQUIRED THE LITERAL WORD "RYZEN", AND
 * SELLERS ROUTINELY DO NOT WRITE IT.
 *
 * Found 2026-09-03 on a live $1,155 listing: *"RTX 3080 Ti Gaming PC 32GB
 * DDR5, AMD 7600X, ROG Strix"*. GPU, RAM and storage all extracted correctly;
 * `cpu` came back empty and the verdict was "Can't be valued: cpu not stated"
 * on a build whose CPU is in its own title.
 *
 * AMD's four-digit desktop numbering is `<gen><tier><sku><suffix>` and the
 * SECOND DIGIT gives the tier, which is what makes this recoverable rather
 * than a guess: 3 -> Ryzen 3, 4-6 -> Ryzen 5, 7-8 -> Ryzen 7, 9 -> Ryzen 9.
 * Checked against this catalog: 7600X is a Ryzen 5, 7800X3D a Ryzen 7, 7900X a
 * Ryzen 9, 9700X a Ryzen 7.
 *
 * ⚠ THE EXCLUSIONS ARE THE LOAD-BEARING PART, because a wrong CPU is a
 * confident wrong price inside a number somebody drives on:
 *
 *   · `RX 7600`, `Radeon RX 7900 XTX` are GPUs, and the word "AMD" sits right
 *     beside them. Mapping those to a Ryzen prices a graphics card as a chip.
 *   · `FX 8350` is the pre-Ryzen FX line. Second digit 3 would call it a
 *     Ryzen 7; it is not a Ryzen at all.
 *   · `Athlon 3000G` is an Athlon. Same shape, different product.
 *   · `EPYC 7443` is a server part nobody in this market buys.
 *
 * So a bare number is read as a Ryzen only when AMD or Ryzen is stated nearby
 * AND none of those words claims it first. `X3D` is accepted alone because no
 * other product line has ever used that suffix.
 */
const RYZEN_TIER: Record<string, string> = {
  "3": "3", "4": "5", "5": "5", "6": "5", "7": "7", "8": "7", "9": "9",
};

/** Words meaning this number belongs to something that is not a Ryzen. */
const NOT_RYZEN_BEFORE = /(rtx|gtx|\brx\b|radeon|\bfx\b|athlon|epyc|threadripper|geforce|arc)\s*$/i;

/** Every Ryzen spelled without the word, normalised to `ryzen <tier> <model>`. */
export function amdCpusIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{4})\s?(x3d|xt|x|g|ge|f|hx|hs|h|u)?\b/gi)) {
    const digits = m[1]!;
    const suffix = (m[2] ?? "").toLowerCase();
    const before = text.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0);

    if (NOT_RYZEN_BEFORE.test(before)) continue;
    /**
     * X3D stands alone; anything else needs AMD or Ryzen nearby, because a
     * bare "7600" in a title is far more often a model year or a part number.
     */
    if (!/\b(amd|ryzen)\b/i.test(before) && suffix !== "x3d") continue;

    const tier = RYZEN_TIER[digits[1]!];
    if (!tier) continue;
    out.push(`ryzen ${tier} ${digits}${suffix}`);
  }
  return out;
}
const GPU_BASE = /^(?:rtx|gtx|rx)\s?\d{3,4}/;

/**
 * Of every mention of the SAME model, the fullest spelling.
 *
 * ⚠ IT KEEPS THE FIRST MODEL AND ONLY LENGTHENS IT, which is what makes this
 * safe. A listing can legitimately name two chips ("upgraded from an i5-9400 to
 * an i7-12700K") and simply taking the longest string anywhere would pick
 * whichever happened to have more characters. The base of the FIRST match
 * decides which product this is; later mentions may only add a suffix to it.
 *
 * Suffixes only ever ADD — X3D, Ti, Super, XT, K, KF. No variant's full name is
 * shorter than its base, so "longest wins within a base" is not a heuristic, it
 * is the complete rule.
 */
export function fullestVariant(matches: string[], base: RegExp): string {
  if (!matches.length) return "";
  const baseOf = (s: string) => s.match(base)?.[0] ?? s;
  const want = baseOf(matches[0]);
  return matches
    .filter((m) => baseOf(m) === want)
    .reduce((best, m) => (m.length > best.length ? m : best), matches[0]);
}

/** Attributes that change value materially, pulled straight from text. */
export function extractAttributes(text: string): Record<string, string | number> {
  const a: Record<string, string | number> = {};
  const t = text.toLowerCase();

  // RAM and VRAM first, so their GB figures can't be mistaken for storage.
  // Before this, "RTX 3050 8GB" read as 8GB of storage and "32GB 512GB" read
  // the RAM as the drive.
  // "ram: 16.0 GB (15.6 GB usable)" — vision emits labelled, parenthesised text,
  // so match the LABEL first before falling back to proximity heuristics.
  const ramLabelled = t.match(/\bram\s*[:=]\s*(\d{1,3})(?:\.\d)?\s?gb\b/);
  const ram = ramLabelled
    ?? t.match(/\b(\d{1,3})\s?gb\b(?=[^.]{0,18}\b(?:ram|ddr[45]|memory)\b)/)
    ?? t.match(/\b(\d{1,3})\s?gb\s*(?:of\s*)?(?:ddr[45]\s*)?ram\b/);
  if (ram) a.ram_gb = Number(ram[1]);

  // "(12 GB)" trailing a card name is VRAM, not system memory.
  const vramMatch =
    t.match(/\b(?:rtx|gtx|rx)\s?\d{3,4}\s?(?:ti|super|xt)?\s*\(?\s*(\d{1,2})\s?gb\b/)
    ?? t.match(/\bvram\s*[:=]\s*(\d{1,2})\s?gb\b/);
  if (vramMatch) a.vram_gb = Number(vramMatch[1]);

  // Storage: prefer an explicit drive mention; otherwise take the largest GB
  // figure that isn't already claimed by RAM or VRAM.
  /**
   * THE DRIVE-WORD LOOKAHEAD MUST NOT REACH PAST ANOTHER CAPACITY.
   *
   * `(?=[^.]{0,14}...ssd...)` let the RAM figure claim the drive word sitting
   * behind the real storage figure, because 14 characters is exactly enough to
   * step over one. Every one of these was wrong:
   *
   *     "Dell XPS 16GB RAM 512GB SSD"        -> storage 16
   *     "MacBook Air M3 8GB 256GB SSD"       -> storage 8
   *     "Gaming PC 32GB DDR5 1TB NVMe"       -> storage 32
   *
   * `valueSku` filters comps by storage tier, so this was quietly pricing
   * laptops against the wrong capacity band. The added negative lookahead
   * rejects a candidate when ANOTHER capacity figure sits between it and the
   * drive word — which is precisely the "RAM then storage" shape.
   */
  const explicit = t.match(/\bstorage\s*[:=]\s*(\d{1,4})\s?(gb|tb)\b/)
    ?? t.match(
      /\b(\d{1,4})\s?(gb|tb)\b(?![^.]{0,14}\b\d{1,4}\s?(?:gb|tb)\b)(?=[^.]{0,14}\b(?:ssd|hdd|nvme|storage|drive|flash)\b)/,
    );
  if (explicit) {
    a.storage_gb = explicit[2] === "tb" ? Number(explicit[1]) * 1024 : Number(explicit[1]);
  } else {
    const claimed = new Set([a.ram_gb, a.vram_gb].filter(Boolean));
    const all = [...t.matchAll(/\b(\d{1,4})\s?(gb|tb)\b/g)]
      .map((m) => (m[2] === "tb" ? Number(m[1]) * 1024 : Number(m[1])))
      .filter((n) => !claimed.has(n));
    // Sellers abbreviate phone capacity as "256G" constantly. Require at
    // least 64 so GPU VRAM shorthand ("RTX 3080 10G") cannot become storage.
    all.push(...[...t.matchAll(/\b(\d{2,4})\s?g\b/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n >= 64 && !claimed.has(n)));
    if (all.length) a.storage_gb = Math.max(...all);
  }

  /**
   * ⚠ THE FULLEST SPELLING, NOT THE FIRST ONE. `.match()` returns the first
   * hit, and on a marketplace the first mention is the TITLE — which truncates.
   *
   * Found 2026-08-31 on a Craigslist build titled "… RTX 5080 / Ryzen 7 9800X"
   * whose description said "AMD Ryzen 7 9800X3D". The regex handles `9800x3d`
   * perfectly; it never saw it, because `9800x` appeared sixty characters
   * earlier. The engine recorded `cpu: "ryzen 7 9800x"`, found no SKU, could
   * not price the CPU, and the build fell to 0.42 coverage — under the 0.55
   * gate — and came back "Specs are known, market prices aren't."
   *
   * ⚠ AND THE DANGEROUS CASE IS THE ONE THAT DOES MATCH. A 9800X3D priced as a
   * 9800X, or a 3080 Ti as a 3080, is a confident wrong number rather than no
   * number — the variant trap `variants.ts` guards on the SKU side and HANDOFF
   * §5 records as a known limitation. This closes the attribute half of it.
   */
  const cpu = fullestVariant(
    [
      ...[...t.matchAll(/\b(i[3579][- ]\d{4,5}[a-z0-9]*|ryzen \d \d{4}[a-z0-9]*|m[1-9](?:\s(?:pro|max|ultra))?)\b/g)]
        .map((m) => m[1].trim()),
      /**
       * ⚠ APPENDED, NOT PREPENDED. `fullestVariant` keeps the fullest spelling
       * of whatever the FIRST match names, so an explicitly written
       * "Ryzen 7 9800X3D" must stay first and win. This only supplies a
       * candidate for the case where the seller never wrote the word.
       */
      ...amdCpusIn(t),
    ],
    CPU_BASE,
  );
  if (cpu) a.cpu = cpu;

  const gpu = fullestVariant(
    [...t.matchAll(/\b((?:rtx|gtx|rx)\s?\d{3,4}\s?(?:ti|super|xt)?)\b/g)]
      .map((m) => m[1].replace(/\s+/g, " ").trim()),
    GPU_BASE,
  );
  if (gpu) a.gpu = gpu;

  // Model year only. Exclude dates the seller mentions in passing ("reset on
  // 8/12/2026", "installed 7/8/2026") and anything at or past the current year.
  const thisYear = new Date().getFullYear();
  const years = [...t.matchAll(/\b(20[0-2]\d)\b/g)]
    .filter((m) => !/[/-]\s*$/.test(t.slice(Math.max(0, m.index! - 2), m.index!)))
    .map((m) => Number(m[1]))
    .filter((y) => y < thisYear);
  if (years.length) a.year = Math.max(...years);

  // Carrier is a phone concept. It was landing on laptops via "unlocked".
  const isPhone = /\b(iphone|galaxy|pixel|phone)\b/.test(t);
  if (isPhone) {
    if (/\bunlocked\b/.test(t)) a.carrier = "unlocked";
    else {
      const car = t.match(/\b(t[- ]?mobile|verizon|at&t|att|sprint)\b/);
      if (car) a.carrier = car[1];
    }
  }

  const cond = t.match(/\b(for parts|parts only|not working|refurbished|refurb|open box|brand new|sealed|like new|mint|used)\b/);
  if (cond) a.condition = cond[1];

  return a;
}

/**
 * `categoryHint` comes from the signal layer. Without it a "Gaming Desktop PC /
 * RTX 3050" resolves to the GPU inside it, which prices the part instead of the
 * machine. A whole machine must never match a component SKU.
 */
export function matchSku(title: string, description = "", categoryHint?: string): Match {
  const text = `${title} ${description}`;
  const attributes = extractAttributes(text);
  const d = db();

  // Dead-category patterns fire regardless of whether a SKU resolves.
  let deadReason: string | undefined;
  for (const [re, why] of DEAD_PATTERNS) if (re.test(text)) { deadReason = why; break; }

  const base = {
    attributes,
    ...(deadReason ? { deadReason } : {}),
  };

  // --- 1. Exact alias hit. Fastest path, and the one the catalog grows into.
  const n = norm(title);
  let aliasRows = d
    .query(
      `SELECT a.alias, s.id, s.brand, s.model, s.category, s.liquidity
       FROM sku_aliases a JOIN skus s ON s.id = a.sku_id`,
    )
    .all() as Array<{ alias: string; id: number; brand: string; model: string; category: string; liquidity: string }>;

  // A whole machine is not the sum of a component SKU. Filter parts out.
  const WHOLE = new Set(["prebuilt", "laptop", "phone", "tablet", "console"]);
  if (categoryHint && WHOLE.has(categoryHint)) {
    // Within a whole-device category, a leading maker is stronger evidence
    // than coincidental family tokens. Do not apply this to GPUs: an ASUS card
    // correctly resolves to an NVIDIA-chip SKU, for example.
    const namedBrand = namedCatalogBrand(title, aliasRows.map((r) => r.brand));
    if (namedBrand) {
      const normalizedBrand = norm(namedBrand);
      aliasRows = aliasRows.filter((r) => norm(r.brand) === normalizedBrand);
    }

    const same = aliasRows.filter((r) => r.category === categoryHint);
    aliasRows = same.length ? same : aliasRows.filter((r) => WHOLE.has(r.category));
  }

  /**
   * ⚠ AN ALIAS MUST MATCH ON WORD BOUNDARIES, NOT AS A BARE SUBSTRING.
   *
   * `n.includes("thinkpad x1")` is TRUE for "Lenovo ThinkPad **X13** Gen 2",
   * so an X13 resolved to the X1 Carbon SKU and got priced against a
   * different, more expensive machine. Caught 2026-08-26 while testing the
   * generative matcher; it had been live the whole time.
   *
   * Same family as the RTX-variant trap below, and the reason both exist is
   * that model numbers are PREFIXES of each other constantly: x1/x13,
   * 840/8400, t14/t14s, 5480/54801.
   *
   * `n` is already normalised to lowercase alphanumerics and single spaces, so
   * padding both sides with a space turns `includes` into a whole-token test
   * with no regex and no escaping. It stays permissive where it should:
   * " iphone 15 pro max " still contains " iphone 15 ", so a longer title
   * matching a shorter alias is unaffected.
   *
   * Longest alias still wins — "iphone 15 pro max" must beat "iphone 15".
   */
  const padded = ` ${n} `;
  const hits = aliasRows
    .filter((r) => padded.includes(` ${r.alias} `))
    .sort((a, b) => b.alias.length - a.alias.length);

  /**
   * AN ALIAS HIT IS NOT ENOUGH IF THE TITLE CARRIES A VARIANT THE SKU LACKS.
   *
   * `n.includes(alias)` is a substring test, so "ASUS TUF RTX 5070 **Ti** 16GB"
   * contains "rtx 5070" and matched the plain RTX 5070 SKU at HIGH confidence —
   * then got priced against 5070 comps, roughly 40% under what a Ti is worth,
   * which turns a genuinely good listing into a PASS. "RTX 4070 **Super**" did
   * the same against the base 4070.
   *
   * `compMatchesQuery` has guarded the COMPS against this for weeks. The
   * matcher never learned it, and the longest-alias rule cannot help when the
   * more specific SKU does not exist in the catalog at all — which is exactly
   * when being wrong is most expensive.
   *
   * One direction only: a variant in the TITLE that the MODEL lacks. The
   * reverse is already impossible, since the alias would not have matched.
   */
  const variantsIn = (s: string, cat?: string | null) =>
    new Set((s.toLowerCase().match(variantPattern(cat)) ?? []).map((v) => v.toLowerCase()));

  const clean = hits.filter((h) => {
    const tv = variantsIn(n, h.category);
    const mv = variantsIn(norm(h.model), h.category);
    for (const v of tv) if (!mv.has(v)) return false;
    return true;
  });

  if (clean.length) {
    const h = clean[0];
    return {
      ...base, skuId: h.id, brand: h.brand, model: h.model, category: h.category,
      liquidity: h.liquidity, confidence: "high", method: "alias",
    };
  }

  // --- 2. Token overlap against model names.
  //
  // THE GENERATION TRAP, found 2026-08-24 and it was one dataset away from
  // quoting a real price. A listing reading "Macbook Pro *32GB RAM* 16" I7"
  // matched the SKU "MacBook Pro M3" on {macbook, pro} = 2/3 = 0.67 overlap. An
  // Intel machine matched to Apple Silicon, a 2-3x price difference, and the
  // ONLY token that carried that difference — "m3" — was the one that did not
  // match. Plain overlap treats the family name and the generation as equally
  // important, when the generation is the entire question.
  //
  // So: a SKU token containing a DIGIT is a discriminator (m3, 15, 5070, 6700k).
  // If the listing does not contain every one of them, this is a family
  // resemblance, not a match, and it is refused outright.
  /**
   * KEEP SINGLE-CHARACTER TOKENS WHEN THEY ARE DIGITS.
   *
   * `w.length > 1` was dropping the single most discriminating token a model
   * name can have. `norm("Switch 2")` splits to `["switch", "2"]`, the "2" was
   * filtered out, and the SKU was left with NO discriminators — so the whole
   * generation guard below silently did nothing for any model whose generation
   * is one digit. It defeated the exact trap that guard exists to catch.
   *
   * Found live on filtrsoft.com's first production feed, 2026-08-26:
   *
   *     "Sony PlayStation 4 console"   -> priced as PlayStation 5
   *     "Sony PlayStation 3 slim"      -> priced as PlayStation 5 Slim
   *     "Xbox One S console"           -> priced as Xbox One X
   *     "D-Link Ethernet Switch"       -> priced as Nintendo Switch 2, and a
   *                                       $5 network switch showed $311 net
   *
   * The length filter exists to drop noise words like "a" and "of". A digit is
   * never noise.
   */
  const keep = (w: string) => w.length > 1 || /[a-z0-9]/.test(w);
  const tokens = new Set(n.split(" ").filter(keep));

  /**
   * A SINGLE CHARACTER IN A MODEL NAME IS A DISCRIMINATOR, digit or letter.
   *
   * Model names are curated catalog data, not scraped text, so a lone character
   * in one is never noise — it is the whole distinction. "Xbox One X" vs "Xbox
   * One S" and "PlayStation 5" vs "PlayStation 4" are different consoles at
   * different prices, and the entire difference is one character.
   *
   * Requiring a digit was not enough: with digits only, "Xbox One S console"
   * still matched "Xbox One X" on {xbox, one} because the "x" was neither kept
   * nor treated as discriminating.
   */
  const hasDigit = (w: string) => /\d/.test(w) || w.length === 1;

  let best: { r: (typeof aliasRows)[number]; score: number; matched: number } | null = null;
  for (const r of aliasRows) {
    const mt = norm(r.model).split(" ").filter(keep);
    if (!mt.length) continue;

    const discriminators = mt.filter(hasDigit);
    if (discriminators.some((w) => !tokens.has(w))) continue;

    /**
     * The variant rule applies HERE TOO, and leaving it off the token path
     * only moved the bug rather than fixing it: with the alias path guarded,
     * "RTX 5070 Ti" simply fell through to token matching, scored 2/2 = 1.0
     * against the plain RTX 5070, and came back MEDIUM — which `valueSku`
     * prices, because only `low` is refused. Same wrong number, one confidence
     * level down.
     */
    const tv = variantsIn(n, r.category);
    const mv = variantsIn(norm(r.model), r.category);
    if ([...tv].some((v) => !mv.has(v))) continue;

    const matched = mt.filter((w) => tokens.has(w)).length;
    const overlap = matched / mt.length;
    // Tie-break toward the MORE SPECIFIC sku: "iPhone 15 Pro Max" and
    // "iPhone 15" both score 1.0 against a Pro Max listing, and the specific
    // one is the right answer.
    if (overlap >= 0.6 && (!best || overlap > best.score ||
        (overlap === best.score && matched > best.matched))) {
      best = { r, score: overlap, matched };
    }
  }
  if (best) {
    return {
      ...base, skuId: best.r.id, brand: best.r.brand, model: best.r.model,
      category: best.r.category, liquidity: best.r.liquidity,
      // Never "high" — that is reserved for an exact alias hit. Every surviving
      // token match now has all its discriminators present, so the floor is
      // medium; below 0.85 overlap it stays low and valuation refuses it.
      confidence: best.score >= 0.85 ? "medium" : "low", method: "token",
    };
  }

  /**
   * --- 3. GENERATIVE FALLBACK. Parse a model rather than look one up.
   *
   * "Couldn't identify the exact model" is the single largest reason a listing
   * cannot be priced — 132 of 267 on 2026-08-26 — and it does not respond to
   * hand-written catalog rows. 39 laptop SKUs were added for the lines that
   * recur most and the count went 125 -> 132. Used laptops are a long tail: 44
   * unmatched titles spanned ~17 models, almost all seen once.
   *
   * So the catalog grows from what walks past instead. `parseModel` is
   * deliberately strict and refuses far more than it accepts — see the safety
   * rules in `derive.ts`, all four of which exist to stop untrusted seller text
   * minting rows that then misprice real listings.
   *
   * **Confidence is MEDIUM, never high.** A derived SKU is a name parsed out of
   * a title, not a product anyone has confirmed exists, and `valueSku` already
   * refuses `low` — medium lets it price while keeping it below an alias hit if
   * one ever appears for the same machine.
   *
   * The immediate effect is honesty even before comps exist: the verdict goes
   * from "couldn't identify the exact model" to "no recent sold comps for this
   * model", which is a true statement and puts the model in the queue the comps
   * puller drains worst-first.
   */
  const derived = parseModel(title, categoryHint ?? null);
  if (derived) {
    try {
      const { id } = findOrCreateSku(derived);
      return {
        ...base, skuId: id, brand: derived.brand, model: derived.model,
        category: derived.category, liquidity: null,
        confidence: "medium", method: "derived",
      };
    } catch (e) {
      // A catalog write must never break a check. Falling through returns the
      // same "no match" the engine handled before this existed.
      console.error(`derive: could not create ${derived.model}: ${(e as Error).message}`);
    }
  }

  return { ...base, skuId: null, brand: null, model: null, category: null, liquidity: null, confidence: "low", method: "none" };
}

/** Teach the catalog. Called after a confirmed resolution so next time is exact. */
export function learnAlias(skuId: number, title: string, confidence: Match["confidence"]) {
  db().query(
    `INSERT INTO sku_aliases (sku_id, alias, source, confidence, created_at)
     VALUES ($sku,$alias,'learned',$conf,$now) ON CONFLICT(alias) DO NOTHING`,
  ).run({ $sku: skuId, $alias: norm(title), $conf: confidence, $now: now() });
}
