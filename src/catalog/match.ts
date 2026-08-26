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
  method: "alias" | "token" | "none";
  deadReason?: string;
  /** Extracted regardless of whether a SKU matched — these drive valuation. */
  attributes: Record<string, string | number>;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

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
  const explicit = t.match(/\bstorage\s*[:=]\s*(\d{1,4})\s?(gb|tb)\b/)
    ?? t.match(/\b(\d{1,4})\s?(gb|tb)\b(?=[^.]{0,14}\b(?:ssd|hdd|nvme|storage|drive|flash)\b)/);
  if (explicit) {
    a.storage_gb = explicit[2] === "tb" ? Number(explicit[1]) * 1024 : Number(explicit[1]);
  } else {
    const claimed = new Set([a.ram_gb, a.vram_gb].filter(Boolean));
    const all = [...t.matchAll(/\b(\d{1,4})\s?(gb|tb)\b/g)]
      .map((m) => (m[2] === "tb" ? Number(m[1]) * 1024 : Number(m[1])))
      .filter((n) => !claimed.has(n));
    if (all.length) a.storage_gb = Math.max(...all);
  }

  const cpu = t.match(/\b(i[3579][- ]\d{4,5}[a-z0-9]*|ryzen \d \d{4}[a-z0-9]*|m[1-9](?:\s(?:pro|max|ultra))?)\b/);
  if (cpu) a.cpu = cpu[1].trim();

  const gpu = t.match(/\b((?:rtx|gtx|rx)\s?\d{3,4}\s?(?:ti|super|xt)?)\b/);
  if (gpu) a.gpu = gpu[1].replace(/\s+/g, " ").trim();

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
    const same = aliasRows.filter((r) => r.category === categoryHint);
    aliasRows = same.length ? same : aliasRows.filter((r) => WHOLE.has(r.category));
  }

  // Longest alias wins — "iphone 15 pro max" must beat "iphone 15".
  const hits = aliasRows
    .filter((r) => n.includes(r.alias))
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
   * Found live on assyze.com's first production feed, 2026-08-26:
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

  return { ...base, skuId: null, brand: null, model: null, category: null, liquidity: null, confidence: "low", method: "none" };
}

/** Teach the catalog. Called after a confirmed resolution so next time is exact. */
export function learnAlias(skuId: number, title: string, confidence: Match["confidence"]) {
  db().query(
    `INSERT INTO sku_aliases (sku_id, alias, source, confidence, created_at)
     VALUES ($sku,$alias,'learned',$conf,$now) ON CONFLICT(alias) DO NOTHING`,
  ).run({ $sku: skuId, $alias: norm(title), $conf: confidence, $now: now() });
}
